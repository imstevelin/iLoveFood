#!/bootstrap/busybox sh

BB=/bootstrap/busybox
ROOT=/farmer-rootfs
LOG_DIR=/data/ilovefood-farmer
LOG_FILE="$LOG_DIR/farmer_live.log"

$BB mkdir -p "$LOG_DIR" "$ROOT/dev" "$ROOT/proc" "$ROOT/sys"

mount_if_needed() {
    source_path="$1"
    target_path="$2"
    if ! $BB mountpoint -q "$target_path" 2>/dev/null; then
        $BB mount --rbind "$source_path" "$target_path"
    fi
}

mount_if_needed /dev "$ROOT/dev"
mount_if_needed /proc "$ROOT/proc"
mount_if_needed /sys "$ROOT/sys"

if [ -e /etc/resolv.conf ]; then
    $BB touch "$ROOT/etc/resolv.conf"
    $BB mount --bind /etc/resolv.conf "$ROOT/etc/resolv.conf" 2>/dev/null || true
fi

$BB cp /bootstrap/frida-server /data/local/tmp/asdf
$BB chmod 0755 /data/local/tmp/asdf

echo "$(date '+%Y-%m-%d %H:%M:%S') [*] 容器農場監督程序啟動" >>"$LOG_FILE"
$BB chroot "$ROOT" /opt/farmer/container-supervisor.sh >>"$LOG_FILE" 2>&1
status=$?

echo "$(date '+%Y-%m-%d %H:%M:%S') [!] 農場退出 (exit=$status)" >>"$LOG_FILE"
if [ "$status" -eq 75 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [*] 要求容器完整重啟" >>"$LOG_FILE"
    /system/bin/setprop sys.powerctl reboot,farmer-recovery
    $BB sleep 10
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [*] 異常退出後等待 10 秒再重試" >>"$LOG_FILE"
    $BB sleep 10
fi
exit "$status"
