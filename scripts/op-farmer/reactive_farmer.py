import os
import subprocess
import sys
import threading
import time
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

TOKEN_TTL_SECONDS = 240
TOKEN_FETCH_TIMEOUT_SECONDS = 18
API_WAIT_TIMEOUT_SECONDS = 25
MAX_CONSECUTIVE_FETCH_FAILURES = 3

# 320x640 emulator coordinates.
SAFE_BLANK_X, SAFE_BLANK_Y = 288, 139
HOME_TAB_X, HOME_TAB_Y = 160, 583
I_MAP_X, I_MAP_Y = 96, 583


def log(message):
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
            result = safe_subprocess_run(
                command,
                timeout=timeout,
                **run_kwargs,
            )
            if check and result.returncode != 0:
                detail = (result.stderr or result.stdout or "").strip() if capture_output else ""
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


class TokenPool:
    def __init__(self):
        self.token = None
        self.updated_at = 0.0
        self.is_fetching = False
        self.consecutive_failures = 0
        self.last_error = None
        self.lock = threading.Lock()
        self.condition = threading.Condition(self.lock)


pool = TokenPool()
captured_data = {"token": None, "updated_at": 0.0}
captured_lock = threading.Lock()
emulator_lock = threading.Lock()
frida_session = None
frida_script = None


def on_message(message, data):
    if message.get("type") == "send":
        payload = message.get("payload") or {}
        if payload.get("type") == "token_captured" and payload.get("mid_v"):
            token = "".join(str(payload["mid_v"]).split())
            with captured_lock:
                captured_data["token"] = token
                captured_data["updated_at"] = time.time()
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
            log("[+] Frida Server 運行中")
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
    log(f"[*] 強制停止並啟動 {APP_NAME}...")
    adb_shell(["am", "force-stop", PKG_NAME], timeout=8)
    time.sleep(1)
    adb_shell(
        [
            "monkey",
            "-p",
            PKG_NAME,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ],
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
    time.sleep(1)
    adb_shell(["input", "tap", str(HOME_TAB_X), str(HOME_TAB_Y)], timeout=6)
    time.sleep(2)


def init_frida():
    global frida_session, frida_script
    try:
        log("====================================")
        cleanup_frida_client()

        # A shell round-trip catches the common state where wait-for-device says
        # "device" but the emulator transport is actually wedged.
        result = adb_shell(
            ["echo", "FARMER_ADB_OK"], timeout=6, capture_output=True
        )
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

        log("[+] Frida 注入成功，系統就緒")
        log("====================================")
        return True
    except Exception as exc:
        cleanup_frida_client()
        log(f"[!] Frida 初始化失敗: {exc}")
        return False


def request_full_recovery(reason):
    """Exit for start_farmer.sh's supervisor to rebuild the emulator."""
    log(f"[!] {reason}，交由監督程序完整重啟模擬器...")
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(75)


def read_new_capture(after_timestamp, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with captured_lock:
            if (
                captured_data["token"]
                and captured_data["updated_at"] > after_timestamp
            ):
                return captured_data["token"]
        time.sleep(0.2)
    return None


def fetch_token_job():
    with emulator_lock:
        token = None
        started_at = time.monotonic()
        try:
            log("[*] 開始預取 Token...")
            request_timestamp = time.time()
            adb_shell(["input", "tap", str(I_MAP_X), str(I_MAP_Y)], timeout=6)
            token = read_new_capture(request_timestamp, TOKEN_FETCH_TIMEOUT_SECONDS)

            # Always return the app to a known idle screen.
            adb_shell(["input", "tap", str(HOME_TAB_X), str(HOME_TAB_Y)], timeout=6)
            time.sleep(1)
            if not token:
                raise RuntimeError(f"{TOKEN_FETCH_TIMEOUT_SECONDS}s 內未擷取到 Token")

            elapsed = time.monotonic() - started_at
            with pool.condition:
                pool.token = token
                pool.updated_at = time.time()
                pool.consecutive_failures = 0
                pool.last_error = None
                pool.condition.notify_all()
            log(f"[+] 預取成功，耗時 {elapsed:.2f}s")
        except Exception as exc:
            error = str(exc)
            with pool.condition:
                pool.consecutive_failures += 1
                failure_count = pool.consecutive_failures
                pool.last_error = error
                pool.condition.notify_all()
            log(f"[!] 預取失敗 ({failure_count}/{MAX_CONSECUTIVE_FETCH_FAILURES}): {error}")

            if failure_count >= MAX_CONSECUTIVE_FETCH_FAILURES:
                request_full_recovery("Token 連續擷取失敗")
            elif not init_frida():
                request_full_recovery("App / Frida 自癒失敗")
        finally:
            with pool.condition:
                pool.is_fetching = False
                pool.condition.notify_all()


def start_prefetch():
    with pool.condition:
        if pool.is_fetching:
            return False
        if pool.token is not None and time.time() - pool.updated_at < TOKEN_TTL_SECONDS:
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


def maintain_pool():
    while True:
        if start_prefetch():
            log("[*] Token 池補貨已排程")
        time.sleep(1)


@app.route("/health", methods=["GET"])
def health():
    with pool.lock:
        token_age = time.time() - pool.updated_at if pool.updated_at else None
        ready = pool.token is not None and token_age < TOKEN_TTL_SECONDS
        payload = {
            "status": "ok" if ready or pool.is_fetching else "degraded",
            "token_ready": ready,
            "fetching": pool.is_fetching,
            "token_age_seconds": round(token_age, 1) if token_age is not None else None,
            "consecutive_failures": pool.consecutive_failures,
            "last_error": pool.last_error,
        }
    return jsonify(payload), 200 if payload["status"] == "ok" else 503


@app.route("/get_token", methods=["POST", "OPTIONS"])
def get_token():
    if request.method == "OPTIONS":
        return jsonify({"status": "ok"}), 200

    started_at = time.monotonic()
    deadline = started_at + API_WAIT_TIMEOUT_SECONDS

    while True:
        start_prefetch()
        with pool.condition:
            token_age = time.time() - pool.updated_at if pool.updated_at else None
            if pool.token is not None and token_age < TOKEN_TTL_SECONDS:
                token = pool.token
                pool.token = None
                pool.updated_at = 0.0
                pool.condition.notify_all()
                break

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                error = pool.last_error or "Token 暫時無法取得"
                log(f"[!] API 等待逾時: {error}")
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Token service is recovering; please retry",
                        }
                    ),
                    503,
                )
            pool.condition.wait(timeout=min(remaining, 1.0))

    # Refill immediately after consumption instead of waiting for the old 5s poll.
    start_prefetch()
    elapsed = time.monotonic() - started_at
    log(f"[+] API 回傳 Token，等待 {elapsed:.3f}s；已立即補貨")
    return jsonify({"status": "success", "mid_v": token})


if __name__ == "__main__":
    max_init_retries = 3
    for attempt in range(1, max_init_retries + 1):
        log(f"[*] 初始化嘗試 {attempt}/{max_init_retries}")
        if init_frida():
            threading.Thread(
                target=maintain_pool, name="pool-maintainer", daemon=True
            ).start()
            log("[+] 啟動 Waitress 服務 (Port 5000, 8 threads)")
            serve(app, host="0.0.0.0", port=5000, threads=8)
            break

        if attempt < max_init_retries:
            log("[!] 初始化失敗，10 秒後重試")
            time.sleep(10)
        else:
            request_full_recovery("連續初始化失敗")
