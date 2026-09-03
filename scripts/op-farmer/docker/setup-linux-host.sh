#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "The farmer runtime requires a Linux host with Binder; build-only use on macOS is supported." >&2
    exit 64
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker Engine is not installed." >&2
    exit 69
fi

sudo install -d -m 0755 /etc/modules-load.d /etc/modprobe.d
printf '%s\n' 'binder_linux' | sudo tee /etc/modules-load.d/ilovefood-binder.conf >/dev/null
printf '%s\n' 'options binder_linux devices=binder,hwbinder,vndbinder' \
    | sudo tee /etc/modprobe.d/ilovefood-binder.conf >/dev/null

sudo modprobe binder_linux devices=binder,hwbinder,vndbinder

if ! grep -qE '(^|,)binder(,|$)' /sys/module/binder_linux/parameters/devices 2>/dev/null; then
    echo "binder_linux was already loaded without Android devices; reboot once, then rerun this script." >&2
    exit 75
fi

if ! grep -qw binder /proc/filesystems; then
    echo "The active kernel does not expose BinderFS. Install a kernel with CONFIG_ANDROID_BINDER_IPC and CONFIG_ANDROID_BINDERFS." >&2
    exit 78
fi

sudo systemctl enable --now docker
docker info >/dev/null
echo "Linux host is ready for the iLoveFood farmer container."
