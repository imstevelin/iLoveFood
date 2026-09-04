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

virtualization="$(systemd-detect-virt --container 2>/dev/null || true)"
if [[ "$virtualization" == "lxc" ]]; then
    missing_devices=()
    for binder_device in /dev/binder /dev/hwbinder /dev/vndbinder; do
        [[ -c "$binder_device" ]] || missing_devices+=("$binder_device")
    done

    if (( ${#missing_devices[@]} > 0 )); then
        cat >&2 <<EOF
This server is a Proxmox LXC container and cannot load host kernel modules.
Missing Binder devices: ${missing_devices[*]}

Run the PVE-host steps in openpoint-farmer/DEPLOYMENT.md, then restart this
LXC container. Alternatively deploy the farmer in a full Linux VM whose
kernel provides binder_linux and BinderFS.
EOF
        exit 78
    fi

    sudo systemctl enable --now docker
    if docker info >/dev/null 2>&1; then
        :
    elif sudo -n docker info >/dev/null 2>&1; then
        echo "Docker is available through sudo for the current user."
    else
        echo "Docker is installed but the current user cannot access its daemon." >&2
        exit 77
    fi
    echo "Linux LXC guest is ready with Binder devices supplied by its PVE host."
    exit 0
fi

if [[ ! -d "/lib/modules/$(uname -r)" ]]; then
    echo "Kernel modules for $(uname -r) are unavailable; install the matching modules package or use a full Linux VM." >&2
    exit 78
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
if docker info >/dev/null 2>&1; then
    :
elif sudo -n docker info >/dev/null 2>&1; then
    echo "Docker is available through sudo for the current user."
else
    echo "Docker is installed but the current user cannot access its daemon." >&2
    exit 77
fi
echo "Linux host is ready for the iLoveFood farmer container."
