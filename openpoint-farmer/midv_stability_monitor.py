#!/usr/bin/env python3
"""Six-hour black-box and host-side stability monitor for the mid_v farm."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import socket
import statistics
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


STOP_REQUESTED = False
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)


def iso_now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def run_command(command: list[str], timeout_seconds: float = 5) -> tuple[int, str, str]:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except (subprocess.TimeoutExpired, OSError) as error:
        return 124, "", str(error)


def matching_pids(pattern: str) -> list[int]:
    return_code, output, _ = run_command(["pgrep", "-f", pattern])
    if return_code not in (0, 1):
        return []
    return sorted(int(value) for value in output.splitlines() if value.strip().isdigit())


def process_metrics(pid: int | None) -> dict[str, Any]:
    if pid is None:
        return {}
    return_code, output, _ = run_command(
        ["ps", "-p", str(pid), "-o", "pcpu=,pmem=,rss=,etimes="]
    )
    if return_code != 0 or not output:
        return {}
    parts = output.split()
    if len(parts) < 4:
        return {}
    try:
        return {
            "cpu_percent": float(parts[0]),
            "memory_percent": float(parts[1]),
            "rss_kib": int(parts[2]),
            "uptime_seconds": int(parts[3]),
        }
    except ValueError:
        return {}


def adb_pid(adb_path: str, serial: str, package_name: str) -> int | None:
    return_code, output, _ = run_command(
        [adb_path, "-s", serial, "shell", "pidof", package_name], timeout_seconds=4
    )
    if return_code != 0 or not output:
        return None
    first_pid = output.split()[0]
    return int(first_pid) if first_pid.isdigit() else None


def adb_device_count(adb_path: str) -> int:
    return_code, output, _ = run_command([adb_path, "devices"], timeout_seconds=4)
    if return_code != 0:
        return 0
    return sum(1 for line in output.splitlines() if line.rstrip().endswith("\tdevice"))


def memory_available_kib() -> int | None:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1])
    except (OSError, ValueError):
        pass
    return None


def percentile(values: list[float], percentile_value: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    index = max(0, min(len(sorted_values) - 1, int((len(sorted_values) - 1) * percentile_value + 0.5)))
    return round(sorted_values[index], 2)


def latency_summary(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {
            "min_ms": None,
            "average_ms": None,
            "p50_ms": None,
            "p95_ms": None,
            "p99_ms": None,
            "max_ms": None,
        }
    return {
        "min_ms": round(min(values), 2),
        "average_ms": round(statistics.fmean(values), 2),
        "p50_ms": percentile(values, 0.50),
        "p95_ms": percentile(values, 0.95),
        "p99_ms": percentile(values, 0.99),
        "max_ms": round(max(values), 2),
    }


class IncrementalLogMonitor:
    PATTERNS = {
        "prefetch_success": "預取成功",
        "prefetch_failure": "預取失敗",
        "api_return": "API 回傳 Token",
        "frida_injected": "Frida 注入成功",
        "frida_ready": "Frida Server 運行中",
        "token_timeout": "未擷取到 Token",
        "traceback": "Traceback",
        "error": "ERROR",
        "exception": "Exception",
    }

    def __init__(self, path: Path) -> None:
        self.path = path
        self.offset = path.stat().st_size if path.exists() else 0
        self.total_counts: Counter[str] = Counter()
        self.rotations = 0

    def read_new_counts(self) -> dict[str, int]:
        if not self.path.exists():
            return {key: 0 for key in self.PATTERNS}
        size = self.path.stat().st_size
        if size < self.offset:
            self.offset = 0
            self.rotations += 1
        with self.path.open("rb") as handle:
            handle.seek(self.offset)
            content = handle.read().decode("utf-8", errors="replace")
            self.offset = handle.tell()
        counts = {key: content.count(pattern) for key, pattern in self.PATTERNS.items()}
        self.total_counts.update(counts)
        return counts


def request_mid_v(
    endpoint: str, response_path: Path, timeout_seconds: int, api_key: str
) -> dict[str, Any]:
    response_path.unlink(missing_ok=True)
    write_out = "\t".join(
        [
            "%{http_code}",
            "%{time_namelookup}",
            "%{time_connect}",
            "%{time_starttransfer}",
            "%{time_total}",
            "%{size_download}",
        ]
    )
    command = [
        "curl",
        "--silent",
        "--show-error",
        "--max-time",
        str(timeout_seconds),
        "--output",
        str(response_path),
        "--write-out",
        write_out,
        "--request",
        "POST",
        endpoint,
        "--header",
        "content-type: application/json",
        "--header",
        f"authorization: Bearer {api_key}",
        "--header",
        f"user-agent: {BROWSER_USER_AGENT}",
        "--data",
        "{}",
    ]
    started = time.monotonic()
    return_code, metrics_output, stderr = run_command(command, timeout_seconds + 3)
    wall_latency_ms = round((time.monotonic() - started) * 1000, 2)
    metric_parts = metrics_output.split("\t")
    result: dict[str, Any] = {
        "valid": False,
        "curl_exit_code": return_code,
        "http_code": 0,
        "dns_ms": None,
        "connect_ms": None,
        "ttfb_ms": None,
        "latency_ms": wall_latency_ms,
        "size_bytes": 0,
        "mid_v_hash": None,
        "error": stderr[:240] if stderr else None,
    }
    if len(metric_parts) == 6:
        try:
            result.update(
                {
                    "http_code": int(metric_parts[0]),
                    "dns_ms": round(float(metric_parts[1]) * 1000, 2),
                    "connect_ms": round(float(metric_parts[2]) * 1000, 2),
                    "ttfb_ms": round(float(metric_parts[3]) * 1000, 2),
                    "latency_ms": round(float(metric_parts[4]) * 1000, 2),
                    "size_bytes": int(float(metric_parts[5])),
                }
            )
        except ValueError:
            result["error"] = "curl metrics could not be parsed"

    try:
        payload = json.loads(response_path.read_text(encoding="utf-8"))
        mid_v = payload.get("mid_v")
        result["valid"] = (
            result["curl_exit_code"] == 0
            and result["http_code"] == 200
            and payload.get("status") == "success"
            and isinstance(mid_v, str)
            and len(mid_v) > 0
        )
        if isinstance(mid_v, str) and mid_v:
            result["mid_v_hash"] = hashlib.sha256(mid_v.encode("utf-8")).hexdigest()[:16]
            # Private, in-memory only. The caller removes this before writing
            # samples so no credential reaches disk.
            result["_mid_v"] = mid_v
        if not result["valid"] and not result["error"]:
            result["error"] = str(payload.get("message") or payload.get("status") or "invalid response")[:240]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        if not result["error"]:
            result["error"] = f"response parse error: {error}"[:240]
    finally:
        response_path.unlink(missing_ok=True)
    return result


def request_access_token(mid_v: str, timeout_seconds: int) -> dict[str, Any]:
    endpoint = (
        "https://lovefood.openpoint.com.tw/LoveFood/api/"
        "Auth/FrontendAuth/AccessToken?"
        + urllib.parse.urlencode({"mid_v": mid_v})
    )
    request = urllib.request.Request(
        endpoint,
        data=b"{}",
        method="POST",
        headers={
            "User-Agent": BROWSER_USER_AGENT,
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://lovefood.openpoint.com.tw",
            "Referer": "https://lovefood.openpoint.com.tw/",
        },
    )
    started = time.monotonic()
    result: dict[str, Any] = {
        "valid": False,
        "http_code": 0,
        "latency_ms": None,
        "is_success": False,
        "access_token_present": False,
        "error": None,
    }
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            payload = json.load(response)
            result["http_code"] = response.status
        result["is_success"] = payload.get("isSuccess") is True
        result["access_token_present"] = bool(payload.get("element"))
        result["valid"] = (
            result["http_code"] == 200
            and result["is_success"]
            and result["access_token_present"]
        )
        if not result["valid"]:
            result["error"] = str(payload.get("message") or "invalid response")[:240]
    except urllib.error.HTTPError as error:
        result["http_code"] = error.code
        result["error"] = f"HTTP {error.code}"
    except (OSError, ValueError, json.JSONDecodeError) as error:
        result["error"] = str(error)[:240]
    finally:
        result["latency_ms"] = round((time.monotonic() - started) * 1000, 2)
    return result


def request_health(timeout_seconds: int = 4) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(
            "http://127.0.0.1:5000/health", timeout=timeout_seconds
        ) as response:
            payload = json.load(response)
            payload["http_code"] = response.status
            return payload
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
        except (ValueError, json.JSONDecodeError):
            payload = {}
        payload["http_code"] = error.code
        return payload
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return {"http_code": 0, "status": "unreachable", "error": str(error)[:240]}


def systemd_restart_count() -> int | None:
    return_code, output, _ = run_command(
        ["systemctl", "show", "-p", "NRestarts", "--value", "op-farmer.service"]
    )
    try:
        return int(output) if return_code == 0 else None
    except ValueError:
        return None


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(path)


def build_summary(
    samples: list[dict[str, Any]],
    started_at: str,
    expected_samples: int,
    elapsed_seconds: float,
    farmer_log: IncrementalLogMonitor,
    emulator_log: IncrementalLogMonitor,
    completion_reason: str,
) -> dict[str, Any]:
    requests = [sample["request"] for sample in samples]
    valid_requests = [request for request in requests if request["valid"]]
    latencies = [float(request["latency_ms"]) for request in valid_requests]
    error_categories = Counter(
        request.get("error") or f"http_{request.get('http_code', 0)}"
        for request in requests
        if not request["valid"]
    )
    token_hashes = [request["mid_v_hash"] for request in valid_requests if request.get("mid_v_hash")]
    token_changes = sum(
        1 for index in range(1, len(token_hashes)) if token_hashes[index] != token_hashes[index - 1]
    )
    redemptions = [
        sample["access_token_validation"]
        for sample in samples
        if sample.get("access_token_validation") is not None
    ]
    valid_redemptions = [result for result in redemptions if result["valid"]]
    health_samples = [sample.get("health", {}) for sample in samples]
    return {
        "started_at": started_at,
        "updated_at": iso_now(),
        "completion_reason": completion_reason,
        "elapsed_seconds": round(elapsed_seconds, 1),
        "expected_samples": expected_samples,
        "samples": len(samples),
        "valid_samples": len(valid_requests),
        "failed_samples": len(requests) - len(valid_requests),
        "availability_percent": round((len(valid_requests) / len(requests) * 100), 4) if requests else 0,
        "latency": latency_summary(latencies),
        "slow_samples": {
            "over_1000_ms": sum(1 for value in latencies if value > 1000),
            "over_1500_ms": sum(1 for value in latencies if value > 1500),
            "over_3000_ms": sum(1 for value in latencies if value > 3000),
            "over_10000_ms": sum(1 for value in latencies if value > 10000),
        },
        "error_categories": dict(error_categories),
        "unique_token_hashes": len(set(token_hashes)),
        "token_hash_changes": token_changes,
        "farm_outage_samples": sum(1 for sample in samples if not sample["farm"]["farmer_pids"]),
        "emulator_outage_samples": sum(1 for sample in samples if not sample["farm"]["qemu_pids"]),
        "adb_outage_samples": sum(1 for sample in samples if sample["farm"]["adb_device_count"] == 0),
        "access_token_validation": {
            "attempts": len(redemptions),
            "successes": len(valid_redemptions),
            "failures": len(redemptions) - len(valid_redemptions),
            "latency": latency_summary(
                [float(result["latency_ms"]) for result in valid_redemptions]
            ),
        },
        "health_degraded_samples": sum(
            1 for health in health_samples if health.get("status") != "ok"
        ),
        "fetch_watchdog_risk_samples": sum(
            1
            for health in health_samples
            if health.get("fetch_age_seconds") is not None
            and health.get("fetch_timeout_seconds") is not None
            and float(health["fetch_age_seconds"])
            >= float(health["fetch_timeout_seconds"])
        ),
        "app_present_while_hibernating_samples": sum(
            1
            for sample in samples
            if sample.get("health", {}).get("app_state") == "hibernating"
            and sample["farm"]["android_app_pid"] is not None
        ),
        "app_missing_while_active_samples": sum(
            1
            for sample in samples
            if sample.get("health", {}).get("app_state") == "active"
            and sample["farm"]["android_app_pid"] is None
        ),
        "farmer_pid_changes": sum(
            1
            for index in range(1, len(samples))
            if samples[index]["farm"]["farmer_pids"] != samples[index - 1]["farm"]["farmer_pids"]
        ),
        "log_events": {
            "farmer": dict(farmer_log.total_counts),
            "farmer_rotations": farmer_log.rotations,
            "emulator": dict(emulator_log.total_counts),
            "emulator_rotations": emulator_log.rotations,
        },
    }


def handle_stop_signal(_signal_number: int, _frame: Any) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration-seconds", type=int, default=21600)
    parser.add_argument("--interval-seconds", type=int, default=30)
    parser.add_argument("--request-timeout-seconds", type=int, default=25)
    parser.add_argument("--redemption-interval-samples", type=int, default=10)
    parser.add_argument("--endpoint", default="http://127.0.0.1:5000/get_token")
    parser.add_argument("--api-key", default=os.environ.get("FARMER_API_KEY", ""))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--farm-dir", type=Path, default=Path("/home/imstevelin/op-farmer"))
    parser.add_argument(
        "--adb-path", default="/home/imstevelin/android_sdk/platform-tools/adb"
    )
    parser.add_argument("--adb-serial", default="emulator-5554")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if not arguments.api_key:
        raise SystemExit("FARMER_API_KEY or --api-key is required")
    output_dir: Path = arguments.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    samples_path = output_dir / "samples.jsonl"
    events_path = output_dir / "events.jsonl"
    response_path = output_dir / ".response.tmp"
    summary_path = output_dir / "summary.json"
    checkpoint_path = output_dir / "checkpoint.json"
    metadata_path = output_dir / "metadata.json"
    pid_path = output_dir / "monitor.pid"

    signal.signal(signal.SIGTERM, handle_stop_signal)
    signal.signal(signal.SIGINT, handle_stop_signal)

    started_at = iso_now()
    started_monotonic = time.monotonic()
    expected_samples = max(1, arguments.duration_seconds // arguments.interval_seconds)
    farmer_log = IncrementalLogMonitor(arguments.farm_dir / "farmer_live.log")
    emulator_log = IncrementalLogMonitor(arguments.farm_dir / "emulator.log")
    samples: list[dict[str, Any]] = []
    pid_path.write_text(f"{os.getpid()}\n", encoding="utf-8")
    atomic_write_json(
        metadata_path,
        {
            "host": socket.gethostname(),
            "pid": os.getpid(),
            "started_at": started_at,
            "duration_seconds": arguments.duration_seconds,
            "interval_seconds": arguments.interval_seconds,
            "request_timeout_seconds": arguments.request_timeout_seconds,
            "redemption_interval_samples": arguments.redemption_interval_samples,
            "expected_samples": expected_samples,
            "endpoint": arguments.endpoint,
            "farm_dir": str(arguments.farm_dir),
        },
    )

    previous_farmer_pids: list[int] | None = None
    completion_reason = "completed"
    with samples_path.open("a", encoding="utf-8", buffering=1) as samples_file, events_path.open(
        "a", encoding="utf-8", buffering=1
    ) as events_file:
        sample_index = 0
        while not STOP_REQUESTED:
            cycle_started = time.monotonic()
            elapsed = cycle_started - started_monotonic
            if elapsed >= arguments.duration_seconds:
                break

            request_result = request_mid_v(
                arguments.endpoint,
                response_path,
                arguments.request_timeout_seconds,
                arguments.api_key,
            )
            mid_v = request_result.pop("_mid_v", None)
            access_token_validation = None
            if (
                sample_index % max(1, arguments.redemption_interval_samples) == 0
                and isinstance(mid_v, str)
            ):
                access_token_validation = request_access_token(
                    mid_v, arguments.request_timeout_seconds
                )
            health_result = request_health()
            farmer_pids = matching_pids("[r]eactive_farmer.py")
            qemu_pids = matching_pids("[q]emu-system.*token_farmer")
            device_count = adb_device_count(arguments.adb_path)
            farmer_counts = farmer_log.read_new_counts()
            emulator_counts = emulator_log.read_new_counts()
            sample = {
                "index": sample_index,
                "timestamp": iso_now(),
                "elapsed_seconds": round(time.monotonic() - started_monotonic, 2),
                "request": request_result,
                "farm": {
                    "farmer_pids": farmer_pids,
                    "farmer_process": process_metrics(farmer_pids[0] if farmer_pids else None),
                    "qemu_pids": qemu_pids,
                    "qemu_process": process_metrics(qemu_pids[0] if qemu_pids else None),
                    "adb_device_count": device_count,
                    "android_frida_pid": adb_pid(
                        arguments.adb_path, arguments.adb_serial, "asdf"
                    )
                    if device_count
                    else None,
                    "android_app_pid": adb_pid(
                        arguments.adb_path, arguments.adb_serial, "ecowork.seven"
                    )
                    if device_count
                    else None,
                    "systemd_restarts": systemd_restart_count(),
                },
                "health": health_result,
                "access_token_validation": access_token_validation,
                "system": {
                    "load_average": [round(value, 3) for value in os.getloadavg()],
                    "memory_available_kib": memory_available_kib(),
                },
                "new_log_events": {
                    "farmer": farmer_counts,
                    "emulator": emulator_counts,
                },
            }
            samples.append(sample)
            samples_file.write(json.dumps(sample, ensure_ascii=False) + "\n")

            event_reasons: list[str] = []
            if not request_result["valid"]:
                event_reasons.append("request_failed")
            if float(request_result["latency_ms"]) > 1500:
                event_reasons.append("request_slow")
            if not farmer_pids:
                event_reasons.append("farmer_missing")
            if not qemu_pids:
                event_reasons.append("emulator_missing")
            if device_count == 0:
                event_reasons.append("adb_offline")
            if health_result.get("status") != "ok":
                event_reasons.append("health_degraded")
            if (
                health_result.get("app_state") == "hibernating"
                and sample["farm"]["android_app_pid"] is not None
            ):
                event_reasons.append("app_present_while_hibernating")
            if access_token_validation is not None and not access_token_validation["valid"]:
                event_reasons.append("access_token_validation_failed")
            if previous_farmer_pids is not None and farmer_pids != previous_farmer_pids:
                event_reasons.append("farmer_pid_changed")
            if farmer_counts["prefetch_failure"] or farmer_counts["token_timeout"]:
                event_reasons.append("farmer_prefetch_failure")
            if farmer_counts["traceback"] or farmer_counts["error"] or farmer_counts["exception"]:
                event_reasons.append("farmer_log_error")
            if event_reasons:
                events_file.write(
                    json.dumps(
                        {
                            "timestamp": sample["timestamp"],
                            "sample_index": sample_index,
                            "reasons": event_reasons,
                            "request": request_result,
                            "access_token_validation": access_token_validation,
                            "farm": sample["farm"],
                            "new_log_events": sample["new_log_events"],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
            previous_farmer_pids = farmer_pids

            current_summary = build_summary(
                samples,
                started_at,
                expected_samples,
                time.monotonic() - started_monotonic,
                farmer_log,
                emulator_log,
                "running",
            )
            atomic_write_json(checkpoint_path, current_summary)
            sample_index += 1

            sleep_seconds = arguments.interval_seconds - (time.monotonic() - cycle_started)
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

    if STOP_REQUESTED:
        completion_reason = "interrupted"
    final_summary = build_summary(
        samples,
        started_at,
        expected_samples,
        time.monotonic() - started_monotonic,
        farmer_log,
        emulator_log,
        completion_reason,
    )
    atomic_write_json(checkpoint_path, final_summary)
    atomic_write_json(summary_path, final_summary)
    pid_path.unlink(missing_ok=True)
    response_path.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
