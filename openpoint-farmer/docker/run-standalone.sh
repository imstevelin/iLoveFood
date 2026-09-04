#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi

IMAGE_REF="${FARMER_IMAGE:-imstevelin/ilovefood-openpoint-farmer:2026.09.2}"
CONTAINER_NAME="${FARMER_CONTAINER_NAME:-ilovefood-op-farmer}"
DATA_VOLUME="${FARMER_DATA_VOLUME:-ilovefood-op-farmer-data}"
SECRET_PATH="$SCRIPT_DIR/private/farmer_api_key.txt"

if docker info >/dev/null 2>&1; then
    DOCKER=(docker)
elif sudo -n docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
else
    echo "Cannot access the Docker daemon as the current user or through passwordless sudo." >&2
    exit 77
fi

if [[ ! -s "$SECRET_PATH" ]]; then
    echo "Missing $SECRET_PATH" >&2
    exit 66
fi

"${DOCKER[@]}" pull "$IMAGE_REF"

if "${DOCKER[@]}" container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    "${DOCKER[@]}" container rm --force "$CONTAINER_NAME" >/dev/null
fi
"${DOCKER[@]}" volume create "$DATA_VOLUME" >/dev/null

"${DOCKER[@]}" run -d \
    --name "$CONTAINER_NAME" \
    --privileged \
    --restart unless-stopped \
    --cpus "${FARMER_CPUS:-2.0}" \
    --memory "${FARMER_MEMORY_LIMIT:-1280m}" \
    --pids-limit 2048 \
    --stop-timeout 30 \
    -p "${FARMER_API_BIND:-127.0.0.1}:${FARMER_API_PORT:-5000}:5000" \
    -p "127.0.0.1:${FARMER_ADB_PORT:-5555}:5555" \
    -e FARMER_API_KEY_FILE=/run/secrets/farmer_api_key \
    -e FARMER_BIND_HOST=0.0.0.0 \
    -e "FARMER_TOKEN_TTL_SECONDS=${FARMER_TOKEN_TTL_SECONDS:-240}" \
    -e "FARMER_TOKEN_REFRESH_SECONDS=${FARMER_TOKEN_REFRESH_SECONDS:-180}" \
    -e "FARMER_MIN_HOST_AVAILABLE_MIB=${FARMER_MIN_HOST_AVAILABLE_MIB:-128}" \
    -e "FARMER_ANDROID_BOOT_TIMEOUT_SECONDS=${FARMER_ANDROID_BOOT_TIMEOUT_SECONDS:-300}" \
    -e "FARMER_FETCH_JOB_TIMEOUT_SECONDS=${FARMER_FETCH_JOB_TIMEOUT_SECONDS:-120}" \
    --mount "type=bind,source=$SECRET_PATH,target=/farmer-rootfs/run/secrets/farmer_api_key,readonly" \
    -v "$DATA_VOLUME:/data" \
    --tmpfs /cache:size=64m,mode=0770 \
    "$IMAGE_REF"

echo "Started $CONTAINER_NAME from $IMAGE_REF"
