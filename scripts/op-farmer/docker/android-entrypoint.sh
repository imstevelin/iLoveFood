#!/bootstrap/busybox sh
set -eu

BB=/bootstrap/busybox
ENV_FILE=/farmer-rootfs/run/docker-env.b64

# Android init intentionally creates a minimal service environment. Preserve
# only the farmer's allowlisted Docker variables in a base64 file; this avoids
# shell-quoting bugs for API keys containing punctuation.
$BB mkdir -p /farmer-rootfs/run
: >"$ENV_FILE"
capture_env() {
    env_name="$1"
    env_value="$2"
    if [ -n "$env_value" ]; then
        encoded="$($BB printf '%s' "$env_value" | $BB base64 | $BB tr -d '\n')"
        $BB printf '%s=%s\n' "$env_name" "$encoded" >>"$ENV_FILE"
    fi
}
capture_env FARMER_API_KEY "${FARMER_API_KEY:-}"
capture_env FARMER_BIND_HOST "${FARMER_BIND_HOST:-}"
capture_env FARMER_TOKEN_TTL_SECONDS "${FARMER_TOKEN_TTL_SECONDS:-}"
capture_env FARMER_TOKEN_REFRESH_SECONDS "${FARMER_TOKEN_REFRESH_SECONDS:-}"
capture_env FARMER_FETCH_TIMEOUT_SECONDS "${FARMER_FETCH_TIMEOUT_SECONDS:-}"
capture_env FARMER_FETCH_JOB_TIMEOUT_SECONDS "${FARMER_FETCH_JOB_TIMEOUT_SECONDS:-}"
capture_env FARMER_API_WAIT_TIMEOUT_SECONDS "${FARMER_API_WAIT_TIMEOUT_SECONDS:-}"
capture_env FARMER_MAX_CONSECUTIVE_FAILURES "${FARMER_MAX_CONSECUTIVE_FAILURES:-}"
capture_env FARMER_MIN_HOST_AVAILABLE_MIB "${FARMER_MIN_HOST_AVAILABLE_MIB:-}"
capture_env FARMER_RESOURCE_PRESSURE_SAMPLES "${FARMER_RESOURCE_PRESSURE_SAMPLES:-}"
$BB chmod 0600 "$ENV_FILE"

# Prefer a private binderfs mount so several farmers never share Binder state.
# The Linux host only has to load binder_linux; no host device bind-mounts are
# required. Legacy pre-created nodes remain supported as a fallback.
if [ ! -c /dev/binder ] || [ ! -c /dev/hwbinder ] || [ ! -c /dev/vndbinder ]; then
    $BB mkdir -p /dev/binderfs
    if ! $BB mount -t binder binder /dev/binderfs 2>/dev/null; then
        echo "Cannot mount binderfs; load binder_linux on the Linux Docker host." >&2
        exit 78
    fi
    $BB ln -sf /dev/binderfs/binder /dev/binder
    $BB ln -sf /dev/binderfs/hwbinder /dev/hwbinder
    $BB ln -sf /dev/binderfs/vndbinder /dev/vndbinder
fi

for binder_node in /dev/binder /dev/hwbinder /dev/vndbinder; do
    if [ ! -c "$binder_node" ]; then
        echo "Missing $binder_node after mounting binderfs." >&2
        exit 78
    fi
    $BB chmod 0666 "$binder_node"
done

exec /init qemu=1 androidboot.hardware=redroid "$@"
