import os
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import frida
from flask import Flask, jsonify, request
from flask_cors import CORS
from waitress import serve


BASE_DIR = Path(__file__).resolve().parent
ADB_BIN = os.environ.get(
    "ADB_BIN", str(Path.home() / "android_sdk" / "platform-tools" / "adb")
)
EMULATOR_SERIAL = os.environ.get("EMULATOR_SERIAL", "emulator-5554")
PKG_NAME = "ecowork.seven"
APP_NAME = "7-ELEVEN"


def env_int(name, default, *, minimum=1):
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


TOKEN_TTL_SECONDS = env_int("FARMER_TOKEN_TTL_SECONDS", 240, minimum=60)
TOKEN_REFRESH_SECONDS = min(
    env_int("FARMER_TOKEN_REFRESH_SECONDS", 180, minimum=30),
    TOKEN_TTL_SECONDS - 15,
)
# mid_v can be reused until it expires. Keep one active value and replace it
# atomically in the background instead of consuming one value per request.
TOKEN_POOL_CAPACITY = 1
TOKEN_FETCH_TIMEOUT_SECONDS = env_int("FARMER_FETCH_TIMEOUT_SECONDS", 18, minimum=5)
API_WAIT_TIMEOUT_SECONDS = env_int("FARMER_API_WAIT_TIMEOUT_SECONDS", 15, minimum=1)
MAX_CONSECUTIVE_FETCH_FAILURES = env_int(
    "FARMER_MAX_CONSECUTIVE_FAILURES", 3, minimum=1
)
RESOURCE_CHECK_INTERVAL_SECONDS = env_int(
    "FARMER_RESOURCE_CHECK_INTERVAL_SECONDS", 30, minimum=5
)
RESOURCE_PRESSURE_SAMPLES = env_int("FARMER_RESOURCE_PRESSURE_SAMPLES", 4, minimum=2)
MIN_HOST_AVAILABLE_MIB = env_int("FARMER_MIN_HOST_AVAILABLE_MIB", 640, minimum=128)
MAX_QEMU_RSS_MIB = env_int("FARMER_MAX_QEMU_RSS_MIB", 4608, minimum=1024)

# 320x640 emulator coordinates.
SAFE_BLANK_X, SAFE_BLANK_Y = 288, 139
HOME_TAB_X, HOME_TAB_Y = 160, 583
I_MAP_X, I_MAP_Y = 96, 583
log_lock = threading.Lock()


def log(message):
    # Waitress and the refresh worker log concurrently. Serialize whole lines so
    # operational messages never interleave and become misleading.
    with log_lock:
        print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}", flush=True)


def safe_subprocess_run(command, *, timeout=15, **kwargs):
    try:
        return subprocess.run(command, timeout=timeout, **kwargs)
    except subprocess.TimeoutExpired:
        log(f"[!] 指令逾時 ({timeout}s): {' '.join(command[:4])}")
        raise


def reset_adb_transport():
    """Restart only ADB first; this is much faster than rebooting Android."""
    log("[*] 正在重建 ADB 連線...")
    for command, timeout in (
        ([ADB_BIN, "kill-server"], 5),
        ([ADB_BIN, "start-server"], 10),
        ([ADB_BIN, "-s", EMULATOR_SERIAL, "wait-for-device"], 15),
    ):
        try:
            subprocess.run(
                command,
                timeout=timeout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass


def adb_command(
    args,
    *,
    shell=False,
    timeout=10,
    capture_output=False,
    check=True,
    retry=True,
):
    prefix = [ADB_BIN, "-s", EMULATOR_SERIAL]
    if shell:
        prefix.append("shell")
    command = prefix + list(args)

    for attempt in range(2 if retry else 1):
        try:
            run_kwargs = (
                {"capture_output": True, "text": True}
                if capture_output
                else {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
            )
            result = safe_subprocess_run(command, timeout=timeout, **run_kwargs)
            if check and result.returncode != 0:
                detail = (
                    (result.stderr or result.stdout or "").strip()
                    if capture_output
                    else ""
                )
                raise RuntimeError(
                    f"ADB 指令失敗 (exit={result.returncode})"
                    + (f": {detail[-300:]}" if detail else "")
                )
            return result
        except (subprocess.TimeoutExpired, RuntimeError) as exc:
            if attempt == 0 and retry:
                log(f"[!] ADB 暫時失去回應，準備重試: {exc}")
                reset_adb_transport()
                continue
            raise


def adb_shell(args, **kwargs):
    return adb_command(args, shell=True, **kwargs)


app = Flask(__name__)
CORS(app)


@dataclass(frozen=True)
class TokenEntry:
    value: str
    created_at: float


class TokenPool:
    def __init__(self):
        self.tokens = deque()
        self.is_fetching = False
        self.consecutive_failures = 0
        self.last_error = None
        self.last_success_at = 0.0
        self.last_fetch_duration = None
        self.fetch_durations = deque(maxlen=100)
        self.successful_fetches = 0
        self.failed_fetches = 0
        self.total_requests = 0
        self.served_requests = 0
        self.timeout_requests = 0
        self.waiting_requests = 0
        self.app_state = "starting"
        self.host_available_mib = None
        self.qemu_rss_mib = None
        self.started_at = time.monotonic()
        self.lock = threading.Lock()
        self.condition = threading.Condition(self.lock)

    def prune_expired_locked(self, now=None):
        now = now or time.monotonic()
        removed = 0
        while self.tokens and now - self.tokens[0].created_at >= TOKEN_TTL_SECONDS:
            self.tokens.popleft()
            removed += 1
        return removed

    def needs_prefetch_locked(self, now=None):
        now = now or time.monotonic()
        self.prune_expired_locked(now)
        if len(self.tokens) < TOKEN_POOL_CAPACITY:
            return True
        oldest_age = now - self.tokens[0].created_at
        return oldest_age >= TOKEN_REFRESH_SECONDS


pool = TokenPool()
captured_data = {"token": None, "sequence": 0}
captured_lock = threading.Lock()
emulator_lock = threading.Lock()
frida_session = None
frida_script = None


def normalize_token(value):
    token = "".join(str(value or "").split())
    if 32 <= len(token) <= 2048:
        return token
    return None


def on_message(message, data):
    if message.get("type") == "send":
        payload = message.get("payload") or {}
        if payload.get("type") == "token_captured":
            token = normalize_token(payload.get("mid_v"))
            if token:
                with captured_lock:
                    captured_data["token"] = token
                    captured_data["sequence"] += 1
                return

    if message.get("type") == "error":
        description = message.get("description", "未知 Frida 錯誤")
        log(f"[!] Frida hook 錯誤: {description}")


def cleanup_frida_client():
    global frida_session, frida_script
    if frida_script is not None:
        try:
            frida_script.unload()
        except Exception:
            pass
    if frida_session is not None:
        try:
            frida_session.detach()
        except Exception:
            pass
    frida_script = None
    frida_session = None


FRIDA_SERVER_CMD = (
    "setenforce 0; chmod 755 /data/local/tmp/asdf; "
    "export LD_LIBRARY_PATH=/apex/com.android.runtime/lib64:"
    "/apex/com.android.art/lib64:/system/lib64:/vendor/lib64; "
    "nohup /data/local/tmp/asdf -l 0.0.0.0:12345 "
    ">/data/local/tmp/frida-server.log 2>&1 &"
)


def ensure_frida_server():
    """Verify Frida by PID and start it when needed."""
    try:
        result = adb_shell(
            ["pidof", "asdf"], timeout=6, capture_output=True, retry=False
        )
        if result.stdout.strip():
            return
    except Exception:
        pass

    log("[*] Frida Server 未運行，正在啟動...")
    adb_command(["root"], timeout=12, check=False)
    adb_command(["wait-for-device"], timeout=15)
    adb_shell([FRIDA_SERVER_CMD], timeout=10)

    for _ in range(10):
        time.sleep(1)
        try:
            result = adb_shell(
                ["pidof", "asdf"], timeout=5, capture_output=True, retry=False
            )
            if result.stdout.strip():
                log(f"[+] Frida Server 啟動成功 (PID {result.stdout.strip()})")
                return
        except Exception:
            pass
    raise RuntimeError("Frida Server 啟動後未出現程序")


def wait_for_app_pid(timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = adb_shell(
            ["pidof", PKG_NAME],
            timeout=5,
            capture_output=True,
            check=False,
            retry=False,
        )
        pid = result.stdout.strip()
        if pid:
            return int(pid.split()[0])
        time.sleep(0.5)
    raise RuntimeError(f"{PKG_NAME} 在 {timeout}s 內未啟動")


def launch_app():
    log(f"[*] 啟動 {APP_NAME} 進行 Token 補貨...")
    adb_shell(["am", "force-stop", PKG_NAME], timeout=8)
    time.sleep(0.5)
    adb_shell(
        ["monkey", "-p", PKG_NAME, "-c", "android.intent.category.LAUNCHER", "1"],
        timeout=12,
    )
    return wait_for_app_pid()


def prepare_home_screen():
    # Blocking the forced-update navigation leaves this old APK on SplashActivity.
    # Enter MainActivity explicitly after the hook is active, then park on Home.
    adb_shell(
        ["am", "start", "-n", f"{PKG_NAME}/.activity.MainActivity"], timeout=8
    )
    time.sleep(4)
    adb_shell(["input", "tap", str(SAFE_BLANK_X), str(SAFE_BLANK_Y)], timeout=6)
    time.sleep(0.5)
    adb_shell(["input", "tap", str(HOME_TAB_X), str(HOME_TAB_Y)], timeout=6)
    time.sleep(1)


def set_app_state(state):
    with pool.condition:
        pool.app_state = state
        pool.condition.notify_all()


def init_frida():
    global frida_session, frida_script
    set_app_state("starting")
    try:
        log("====================================")
        cleanup_frida_client()

        # A shell round-trip catches the common state where wait-for-device says
        # "device" but the emulator transport is actually wedged.
        result = adb_shell(["echo", "FARMER_ADB_OK"], timeout=6, capture_output=True)
        if "FARMER_ADB_OK" not in result.stdout:
            raise RuntimeError("ADB shell 健康檢查失敗")

        ensure_frida_server()
        adb_command(["forward", "tcp:12345", "tcp:12345"], timeout=8)
        app_pid = launch_app()
        log(f"[+] 找到 {PKG_NAME} PID: {app_pid}")

        device = frida.get_device_manager().add_remote_device("127.0.0.1:12345")
        frida_session = device.attach(app_pid)
        hook_path = BASE_DIR / "hook_mid.js"
        frida_script = frida_session.create_script(hook_path.read_text(encoding="utf-8"))
        frida_script.on("message", on_message)
        frida_script.load()
        prepare_home_screen()

        set_app_state("active")
        log("[+] Frida 注入成功，補貨引擎就緒")
        log("====================================")
        return True
    except Exception as exc:
        cleanup_frida_client()
        set_app_state("error")
        log(f"[!] Frida 初始化失敗: {exc}")
        return False


def hibernate_app():
    """Stop the rendering-heavy app while preserving the already-filled pool."""
    log("[*] Token 快取已就緒，休眠 App 以釋放 WebView / CPU 資源")
    cleanup_frida_client()
    try:
        adb_shell(["am", "force-stop", PKG_NAME], timeout=8)
        adb_shell(["input", "keyevent", "3"], timeout=6, check=False)
    finally:
        set_app_state("hibernating")


def request_full_recovery(reason):
    """Exit for systemd/start_farmer.sh to rebuild the emulator."""
    log(f"[!] {reason}，交由監督程序完整重啟模擬器...")
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(75)


def current_capture_sequence():
    with captured_lock:
        return captured_data["sequence"]


def read_new_capture(after_sequence, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with captured_lock:
            if captured_data["sequence"] > after_sequence and captured_data["token"]:
                return captured_data["token"]
        time.sleep(0.1)
    return None


def record_fetch_success(token, duration):
    now = time.monotonic()
    with pool.condition:
        pool.prune_expired_locked(now)
        if any(entry.value == token for entry in pool.tokens):
            raise RuntimeError("擷取到重複 Token")
        pool.tokens.append(TokenEntry(token, now))
        while len(pool.tokens) > TOKEN_POOL_CAPACITY:
            pool.tokens.popleft()
        pool.consecutive_failures = 0
        pool.last_error = None
        pool.last_success_at = now
        pool.last_fetch_duration = duration
        pool.fetch_durations.append(duration)
        pool.successful_fetches += 1
        inventory = len(pool.tokens)
        pool.condition.notify_all()
    log(
        f"[+] 預取成功，擷取 {duration:.2f}s；"
        f"快取 {inventory}/{TOKEN_POOL_CAPACITY}"
    )


def capture_one_token():
    started_at = time.monotonic()
    after_sequence = current_capture_sequence()
    adb_shell(["input", "tap", str(I_MAP_X), str(I_MAP_Y)], timeout=6)
    token = read_new_capture(after_sequence, TOKEN_FETCH_TIMEOUT_SECONDS)
    capture_duration = time.monotonic() - started_at
    if not token:
        raise RuntimeError(f"{TOKEN_FETCH_TIMEOUT_SECONDS}s 內未擷取到 Token")

    # Publish first so a waiting API request is not charged for UI parking time.
    record_fetch_success(token, capture_duration)
    adb_shell(["input", "tap", str(HOME_TAB_X), str(HOME_TAB_Y)], timeout=6)
    time.sleep(0.6)


def record_fetch_failure(exc):
    error = str(exc)
    with pool.condition:
        pool.consecutive_failures += 1
        pool.failed_fetches += 1
        pool.last_error = error
        failure_count = pool.consecutive_failures
        pool.condition.notify_all()
    log(f"[!] 預取失敗 ({failure_count}/{MAX_CONSECUTIVE_FETCH_FAILURES}): {error}")
    return failure_count


def fetch_token_job():
    with emulator_lock:
        try:
            # A time-based refresh replaces the complete cohort in one App
            # session. Otherwise two similarly-aged entries would expire a few
            # seconds apart and wake the heavy App twice.
            with pool.condition:
                now = time.monotonic()
                pool.prune_expired_locked(now)
                refresh_remaining = (
                    TOKEN_POOL_CAPACITY
                    if pool.tokens
                    and now - pool.tokens[0].created_at >= TOKEN_REFRESH_SECONDS
                    else 0
                )

            if pool.app_state != "active" and not init_frida():
                record_fetch_failure("App / Frida 無法啟動")
                request_full_recovery("App / Frida 自癒失敗")

            while True:
                with pool.condition:
                    needs_token = refresh_remaining > 0 or pool.needs_prefetch_locked()
                    if not needs_token:
                        break

                try:
                    log("[*] 開始預取 Token...")
                    capture_one_token()
                    if refresh_remaining > 0:
                        refresh_remaining -= 1
                except Exception as exc:
                    failure_count = record_fetch_failure(exc)
                    if failure_count >= MAX_CONSECUTIVE_FETCH_FAILURES:
                        request_full_recovery("Token 連續擷取失敗")
                    if not init_frida():
                        request_full_recovery("App / Frida 自癒失敗")

            hibernate_app()
        finally:
            with pool.condition:
                pool.is_fetching = False
                pool.condition.notify_all()


def start_prefetch():
    with pool.condition:
        if pool.is_fetching or not pool.needs_prefetch_locked():
            return False
        pool.is_fetching = True

    try:
        threading.Thread(
            target=fetch_token_job, name="token-prefetch", daemon=True
        ).start()
        return True
    except Exception:
        with pool.condition:
            pool.is_fetching = False
            pool.condition.notify_all()
        raise


def read_host_resources():
    available_mib = None
    qemu_rss_mib = None
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemAvailable:"):
                available_mib = round(int(line.split()[1]) / 1024, 1)
                break
    except (OSError, ValueError, IndexError):
        pass

    try:
        result = subprocess.run(
            ["pgrep", "-o", "-f", "qemu-system-x86_64.*-avd token_farmer"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        pid = result.stdout.strip().splitlines()[0]
        for line in Path(f"/proc/{pid}/status").read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                qemu_rss_mib = round(int(line.split()[1]) / 1024, 1)
                break
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        pass
    return available_mib, qemu_rss_mib


def maintain_pool():
    next_resource_check = 0.0
    pressure_samples = 0
    while True:
        if start_prefetch():
            log("[*] Token 池補貨已排程")

        now = time.monotonic()
        if now >= next_resource_check:
            available_mib, qemu_rss_mib = read_host_resources()
            with pool.condition:
                pool.host_available_mib = available_mib
                pool.qemu_rss_mib = qemu_rss_mib

            under_pressure = (
                available_mib is not None and available_mib < MIN_HOST_AVAILABLE_MIB
            ) or (qemu_rss_mib is not None and qemu_rss_mib > MAX_QEMU_RSS_MIB)
            if under_pressure:
                pressure_samples += 1
                log(
                    f"[!] 資源壓力 {pressure_samples}/{RESOURCE_PRESSURE_SAMPLES}: "
                    f"host_available={available_mib}MiB, qemu_rss={qemu_rss_mib}MiB"
                )
                if pressure_samples >= RESOURCE_PRESSURE_SAMPLES:
                    request_full_recovery("主機記憶體長時間低於安全線")
            else:
                pressure_samples = 0
            next_resource_check = now + RESOURCE_CHECK_INTERVAL_SECONDS
        time.sleep(0.5)


def percentile(values, percentile_value):
    if not values:
        return None
    ordered = sorted(values)
    index = round((len(ordered) - 1) * percentile_value)
    return round(ordered[index], 3)


@app.after_request
def add_no_store_headers(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/health", methods=["GET"])
def health():
    now = time.monotonic()
    with pool.condition:
        pool.prune_expired_locked(now)
        token_ages = [round(now - entry.created_at, 1) for entry in pool.tokens]
        durations = list(pool.fetch_durations)
        ready = bool(pool.tokens)
        payload = {
            "status": "ok" if ready else "degraded",
            "token_ready": ready,
            "pool_size": len(pool.tokens),
            "pool_capacity": TOKEN_POOL_CAPACITY,
            "oldest_token_age_seconds": token_ages[0] if token_ages else None,
            "newest_token_age_seconds": token_ages[-1] if token_ages else None,
            # Backwards-compatible alias used by the first-generation monitor.
            "token_age_seconds": token_ages[0] if token_ages else None,
            "fetching": pool.is_fetching,
            "app_state": pool.app_state,
            "consecutive_failures": pool.consecutive_failures,
            "last_error": pool.last_error,
            "last_fetch_seconds": (
                round(pool.last_fetch_duration, 3)
                if pool.last_fetch_duration is not None
                else None
            ),
            "fetch_p50_seconds": percentile(durations, 0.50),
            "fetch_p95_seconds": percentile(durations, 0.95),
            "successful_fetches": pool.successful_fetches,
            "failed_fetches": pool.failed_fetches,
            "served_requests": pool.served_requests,
            "timeout_requests": pool.timeout_requests,
            "waiting_requests": pool.waiting_requests,
            "host_available_mib": pool.host_available_mib,
            "qemu_rss_mib": pool.qemu_rss_mib,
            "uptime_seconds": round(now - pool.started_at, 1),
        }
    return jsonify(payload), 200 if ready else 503


@app.route("/get_token", methods=["POST", "OPTIONS"])
def get_token():
    if request.method == "OPTIONS":
        return jsonify({"status": "ok"}), 200

    started_at = time.monotonic()
    deadline = started_at + API_WAIT_TIMEOUT_SECONDS
    waiting_registered = False
    token = None

    with pool.condition:
        pool.total_requests += 1

    start_prefetch()
    try:
        while token is None:
            with pool.condition:
                pool.prune_expired_locked()
                if pool.tokens:
                    # mid_v is reusable. All concurrent callers receive the
                    # same current value until the background refresh swaps it.
                    token_entry = pool.tokens[-1]
                    token = token_entry.value
                    token_age = time.monotonic() - token_entry.created_at
                    pool.served_requests += 1
                    remaining_inventory = len(pool.tokens)
                    break

                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    pool.timeout_requests += 1
                    error = pool.last_error or "Token 暫時無法取得"
                    log(f"[!] API 等待逾時: {error}")
                    response = jsonify(
                        {
                            "status": "error",
                            "message": "Token service is recovering; please retry",
                        }
                    )
                    response.headers["Retry-After"] = "2"
                    return response, 503

                if not waiting_registered:
                    pool.waiting_requests += 1
                    waiting_registered = True
                pool.condition.wait(timeout=min(remaining, 0.5))
            start_prefetch()
    finally:
        if waiting_registered:
            with pool.condition:
                pool.waiting_requests = max(0, pool.waiting_requests - 1)

    start_prefetch()
    elapsed = time.monotonic() - started_at
    log(
        f"[+] API 回傳 Token，等待 {elapsed:.3f}s；"
        f"快取年齡 {token_age:.1f}s，快取 {remaining_inventory}/{TOKEN_POOL_CAPACITY}"
    )
    return jsonify({"status": "success", "mid_v": token})


if __name__ == "__main__":
    max_init_retries = 3
    for attempt in range(1, max_init_retries + 1):
        log(f"[*] 初始化嘗試 {attempt}/{max_init_retries}")
        if init_frida():
            threading.Thread(
                target=maintain_pool, name="pool-maintainer", daemon=True
            ).start()
            log(
                f"[+] 啟動 Waitress 服務 (Port 5000, 8 threads, "
                f"pool={TOKEN_POOL_CAPACITY})"
            )
            serve(app, host="0.0.0.0", port=5000, threads=8)
            break

        if attempt < max_init_retries:
            log("[!] 初始化失敗，5 秒後重試")
            time.sleep(5)
        else:
            request_full_recovery("連續初始化失敗")
