#!/bin/sh

set -eu

PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/root
export PATH HOME

if [ -r /run/docker-env.b64 ]; then
    while IFS= read -r env_line; do
        env_name="${env_line%%=*}"
        encoded="${env_line#*=}"
        case "$env_name" in
            FARMER_API_KEY|FARMER_BIND_HOST|FARMER_TOKEN_TTL_SECONDS|FARMER_TOKEN_REFRESH_SECONDS|FARMER_FETCH_TIMEOUT_SECONDS|FARMER_FETCH_JOB_TIMEOUT_SECONDS|FARMER_API_WAIT_TIMEOUT_SECONDS|FARMER_MAX_CONSECUTIVE_FAILURES|FARMER_MIN_HOST_AVAILABLE_MIB|FARMER_RESOURCE_PRESSURE_SAMPLES|FARMER_ANDROID_BOOT_TIMEOUT_SECONDS|FARMER_ADB_TIMEOUT_MULTIPLIER)
                env_value="$(printf '%s' "$encoded" | base64 -d)"
                export "$env_name=$env_value"
                ;;
        esac
    done </run/docker-env.b64
fi

ADB_BIN="${ADB_BIN:-/usr/bin/adb}"
ADB_CONNECT_ADDRESS="${ADB_CONNECT_ADDRESS:-}"
EMULATOR_SERIAL="${EMULATOR_SERIAL:-emulator-5554}"
FARMER_BIND_HOST="${FARMER_BIND_HOST:-0.0.0.0}"
FARMER_API_KEY_FILE="${FARMER_API_KEY_FILE:-/run/secrets/farmer_api_key}"
FARMER_BOOTSTRAP_PREFS_FILE=/opt/farmer/assets/bootstrap-prefs.xml

export ADB_BIN ADB_CONNECT_ADDRESS EMULATOR_SERIAL FARMER_BIND_HOST FARMER_BOOTSTRAP_PREFS_FILE
FARMER_SKIP_ADB_FORWARD=1
export FARMER_SKIP_ADB_FORWARD

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

if [ -z "${FARMER_API_KEY:-}" ] && [ -r "$FARMER_API_KEY_FILE" ]; then
    FARMER_API_KEY="$(sed -n '1p' "$FARMER_API_KEY_FILE" | tr -d '\r\n')"
    export FARMER_API_KEY
fi

if [ -z "${FARMER_API_KEY:-}" ]; then
    log "[!] FARMER_API_KEY 或 $FARMER_API_KEY_FILE 必須提供其一"
    exit 78
fi

log "[*] 等待容器內 Android ADB..."
"$ADB_BIN" start-server >/dev/null 2>&1 || true
android_services_ready() {
    [ "$(timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] \
        || return 1
    timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell cmd package list packages android 2>/dev/null \
        | tr -d '\r' | grep -qx 'package:android' \
        || return 1
    timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell settings get global device_provisioned >/dev/null 2>&1 \
        || return 1
}

boot_timeout="${FARMER_ANDROID_BOOT_TIMEOUT_SECONDS:-300}"
boot_deadline=$(( $(date +%s) + boot_timeout ))
while [ "$(date +%s)" -lt "$boot_deadline" ]; do
    if [ -n "$ADB_CONNECT_ADDRESS" ]; then
        "$ADB_BIN" connect "$ADB_CONNECT_ADDRESS" >/dev/null 2>&1 || true
    fi
    if android_services_ready; then
        break
    fi
    sleep 2
done

if ! android_services_ready; then
    log "[!] Android 在 ${boot_timeout} 秒內未能提供完整的 ADB/Package Manager/Settings 服務"
    exit 75
fi

# reDroid initially exposes adbd as the shell user. Package installation works
# in that mode, but restoring the minimal app bootstrap state does not.
adb_root_ready=0
adb_root_deadline=$(( $(date +%s) + 90 ))
while [ "$(date +%s)" -lt "$adb_root_deadline" ]; do
    timeout 20 "$ADB_BIN" -s "$EMULATOR_SERIAL" root >/dev/null 2>&1 || true
    timeout 20 "$ADB_BIN" -s "$EMULATOR_SERIAL" wait-for-device >/dev/null 2>&1 || true
    if [ "$(timeout 10 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell id -u 2>/dev/null | tr -d '\r')" = "0" ]; then
        adb_root_ready=1
        break
    fi
    log "[*] ADB root 尚未就緒，5 秒後重試"
    sleep 5
done
if [ "$adb_root_ready" -ne 1 ]; then
    log "[!] 容器內 ADB 無法取得 root 權限"
    exit 75
fi

# OPENPOINT encrypts a locally formatted timestamp into mid_v. reDroid defaults
# to UTC, which makes otherwise well-formed tokens eight hours stale in Taiwan.
timezone_ready=0
timezone_deadline=$(( $(date +%s) + 60 ))
while [ "$(date +%s)" -lt "$timezone_deadline" ]; do
    timeout 20 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell \
        setprop persist.sys.timezone Asia/Taipei >/dev/null 2>&1 || true
    android_timezone="$(timeout 10 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell \
        getprop persist.sys.timezone 2>/dev/null | tr -d '\r' || true)"
    if [ "$android_timezone" = "Asia/Taipei" ]; then
        timezone_ready=1
        break
    fi
    sleep 5
done
if [ "$timezone_ready" -ne 1 ]; then
    log "[!] Android 時區設定失敗: ${android_timezone:-empty}"
    exit 75
fi

desired_apk_sha="$(sha256sum /opt/farmer/assets/openpoint.apk | awk '{print $1}')"
installed_apk_sha="$(timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell cat /data/local/tmp/openpoint-apk.sha256 2>/dev/null | tr -d '\r\n' || true)"

if ! timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell pm path ecowork.seven >/dev/null 2>&1 \
   || [ "$desired_apk_sha" != "$installed_apk_sha" ]; then
    log "[*] 安裝已驗證的 OPENPOINT APK..."
    install_ok=0
    install_deadline=$(( $(date +%s) + 180 ))
    while [ "$(date +%s)" -lt "$install_deadline" ]; do
        if timeout 120 "$ADB_BIN" -s "$EMULATOR_SERIAL" install -r -d -g /opt/farmer/assets/openpoint.apk >/dev/null 2>&1; then
            install_ok=1
            break
        fi
        log "[*] Package Manager 暫時未接受 APK，5 秒後重試"
        sleep 5
    done
    if [ "$install_ok" -ne 1 ]; then
        log "[!] OPENPOINT APK 在 180 秒內無法安裝"
        exit 75
    fi
    timeout 20 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell \
        "printf '%s' '$desired_apk_sha' > /data/local/tmp/openpoint-apk.sha256" \
        || true
fi

# Installing the package can start its Firebase components. Stop every package
# process before the farmer attaches so initialization is deterministic.
timeout 20 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell am force-stop ecowork.seven
for _ in 1 2 3 4 5; do
    if ! timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell pidof ecowork.seven \
        2>/dev/null | grep -q .; then
        break
    fi
    sleep 1
done
if timeout 5 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell pidof ecowork.seven \
    2>/dev/null | grep -q .; then
    log "[!] OPENPOINT 背景程序無法停止"
    exit 75
fi

timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell settings put global window_animation_scale 0.0 >/dev/null 2>&1 || true
timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell settings put global transition_animation_scale 0.0 >/dev/null 2>&1 || true
timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell settings put global animator_duration_scale 0.0 >/dev/null 2>&1 || true
timeout 8 "$ADB_BIN" -s "$EMULATOR_SERIAL" shell svc power stayon true >/dev/null 2>&1 || true

log "[+] Android 與 OPENPOINT 已就緒，啟動農場 API"
cd /opt/farmer
exec /usr/local/bin/python -u reactive_farmer.py
