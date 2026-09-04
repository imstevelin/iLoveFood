#!/usr/bin/env bash
# Supervised one-click launcher for the 7-ELEVEN token farmer.

set -uo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/android_sdk}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

ADB_BIN="$ANDROID_HOME/platform-tools/adb"
EMULATOR_BIN="$ANDROID_HOME/emulator/emulator"
EMULATOR_SERIAL="emulator-5554"
AVD_NAME="token_farmer"
EMULATOR_GPU_MODE="${FARMER_GPU_MODE:-swiftshader_indirect}"
export ADB_BIN EMULATOR_SERIAL

if [[ -z "${FARMER_API_KEY:-}" ]]; then
    printf 'FARMER_API_KEY is required\n' >&2
    exit 78
fi

case "$EMULATOR_GPU_MODE" in
    auto|host|software|lavapipe|swiftshader|swiftshader_indirect|swangle) ;;
    *)
        printf 'Unsupported FARMER_GPU_MODE: %s\n' "$EMULATOR_GPU_MODE" >&2
        exit 64
        ;;
esac

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

stop_farmer_processes() {
    if [[ -n "${child_pid:-}" ]] && kill -0 "$child_pid" 2>/dev/null; then
        kill -TERM "$child_pid" 2>/dev/null || true
        # Frida native calls may ignore SIGTERM. Never let systemd stop hang
        # forever waiting for a wedged worker.
        for _ in $(seq 1 20); do
            if ! kill -0 "$child_pid" 2>/dev/null; then
                break
            fi
            sleep 0.25
        done
        if kill -0 "$child_pid" 2>/dev/null; then
            log "[!] 農場工作程序未回應 SIGTERM，強制終止"
            kill -KILL "$child_pid" 2>/dev/null || true
        fi
        wait "$child_pid" 2>/dev/null || true
    fi
    timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" emu kill >/dev/null 2>&1 || true
    sleep 1
    pkill -9 -f "qemu-system-x86_64.*-avd $AVD_NAME" >/dev/null 2>&1 || true
}

# The outer process is a lightweight supervisor. FARMER_WORKER prevents a
# recovery launched by the child from creating nested supervisors.
if [[ "${FARMER_WORKER:-0}" != "1" ]]; then
    exec 9>"$BASE_DIR/.farmer-supervisor.lock"
    if ! flock -n 9; then
        log "[!] 農場監督程序已在運行，本次啟動略過"
        exit 0
    fi

    child_pid=""
    trap 'stop_farmer_processes; exit 0' INT TERM
    log "[+] 農場監督程序已啟動"
    while true; do
        FARMER_WORKER=1 "$0" &
        child_pid=$!
        wait "$child_pid"
        status=$?
        child_pid=""
        log "[!] 農場程序結束 (exit=$status)，5 秒後自動重建"
        sleep 5
    done
fi

# The singleton lock belongs only to the outer supervisor. Without explicitly
# closing it here, a newly spawned ADB server inherits fd 9 and can keep the
# farm locked even after the supervisor is stopped.
exec 9>&- 2>/dev/null || true

log "[1/4] 清理舊的農場與 token_farmer 模擬器程序..."
pkill -f "$BASE_DIR/reactive_farmer.py" >/dev/null 2>&1 || true
timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" emu kill >/dev/null 2>&1 || true
sleep 2
pkill -9 -f "qemu-system-x86_64.*-avd $AVD_NAME" >/dev/null 2>&1 || true
pkill -9 -f "emulator.*-avd $AVD_NAME" >/dev/null 2>&1 || true
# qemu may exit before its console/gRPC sockets and AVD locks are released.
# A short cooldown avoids a false first boot failure during self-recovery.
sleep 5
"$ADB_BIN" kill-server >/dev/null 2>&1 || true
fuser -k 5000/tcp >/dev/null 2>&1 || true
rm -f "$HOME/.android/avd/$AVD_NAME.avd/"*.lock

log "[2/4] 啟動模擬器 (2GB RAM / 1 vCPU / GPU=$EMULATOR_GPU_MODE)..."
nohup "$EMULATOR_BIN" \
    -avd "$AVD_NAME" \
    -no-window \
    -no-audio \
    -no-boot-anim \
    -gpu "$EMULATOR_GPU_MODE" \
    -writable-system \
    -memory 2048 \
    -cores 1 \
    -no-snapshot-load \
    -no-metrics \
    -no-passive-gps \
    >>"$BASE_DIR/emulator.log" 2>&1 &
emulator_pid=$!
log "[*] 模擬器 PID: $emulator_pid；等待 Android 完成開機..."

"$ADB_BIN" start-server >/dev/null 2>&1 || true
boot_deadline=$((SECONDS + 180))
boot_ready=0
while (( SECONDS < boot_deadline )); do
    state="$(timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" get-state 2>/dev/null || true)"
    if [[ "$state" == "device" ]]; then
        boot_completed="$(timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
        if [[ "$boot_completed" == "1" ]]; then
            boot_ready=1
            break
        fi
    fi
    if ! kill -0 "$emulator_pid" 2>/dev/null; then
        log "[!] 模擬器程序在開機期間退出"
        exit 75
    fi
    sleep 3
done

if [[ "$boot_ready" != "1" ]]; then
    log "[!] Android 在 180 秒內未完成開機"
    exit 75
fi
log "[+] Android 已完成開機"

log "[3/4] 啟動並驗證 Frida Server..."
timeout 15 "$ADB_BIN" -s "$EMULATOR_SERIAL" root >/dev/null 2>&1 || true
timeout 20 "$ADB_BIN" -s "$EMULATOR_SERIAL" wait-for-device >/dev/null 2>&1 || true

if ! timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell test -s /data/local/tmp/asdf; then
    log "[!] /data/local/tmp/asdf 不存在或檔案為空"
    exit 75
fi

timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell \
    'setenforce 0; chmod 755 /data/local/tmp/asdf; export LD_LIBRARY_PATH=/apex/com.android.runtime/lib64:/apex/com.android.art/lib64:/system/lib64:/vendor/lib64; nohup /data/local/tmp/asdf -l 0.0.0.0:12345 >/data/local/tmp/frida-server.log 2>&1 &' \
    >/dev/null 2>&1 || true

frida_ready=0
for _ in $(seq 1 15); do
    frida_pid="$(timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell pidof asdf 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$frida_pid" ]]; then
        frida_ready=1
        log "[+] Frida Server 啟動成功 (PID $frida_pid)"
        break
    fi
    sleep 1
done

if [[ "$frida_ready" != "1" ]]; then
    log "[!] Frida Server 啟動失敗；監督程序將自動重試"
    exit 75
fi

timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" forward tcp:12345 tcp:12345 >/dev/null

log "[4/4] 啟動農場 API 服務..."
cd "$BASE_DIR"
source "$BASE_DIR/venv/bin/activate"
exec python -u "$BASE_DIR/reactive_farmer.py"
