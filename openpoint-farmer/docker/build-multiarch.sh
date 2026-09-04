#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_REF="${FARMER_IMAGE:-imstevelin/ilovefood-openpoint-farmer:2026.09.4}"
BUILDER_NAME="${FARMER_BUILDER_NAME:-ilovefood-multiarch}"
MODE="${1:---oci}"

if [[ ! -s "$SCRIPT_DIR/private/openpoint.apk" ]]; then
    echo "Missing $SCRIPT_DIR/private/openpoint.apk" >&2
    exit 66
fi

if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
    docker buildx create \
        --name "$BUILDER_NAME" \
        --driver docker-container >/dev/null
fi
docker buildx inspect --builder "$BUILDER_NAME" --bootstrap >/dev/null

case "$MODE" in
    --oci)
        mkdir -p "$SCRIPT_DIR/dist"
        docker buildx build \
            --builder "$BUILDER_NAME" \
            --platform linux/amd64,linux/arm64 \
            --tag "$IMAGE_REF" \
            --output "type=oci,dest=$SCRIPT_DIR/dist/op-farmer-multiarch.oci.tar" \
            --file "$SCRIPT_DIR/Dockerfile" \
            "$CONTEXT_DIR"
        echo "Created $SCRIPT_DIR/dist/op-farmer-multiarch.oci.tar"
        ;;
    --push)
        docker buildx build \
            --builder "$BUILDER_NAME" \
            --platform linux/amd64,linux/arm64 \
            --tag "$IMAGE_REF" \
            --push \
            --file "$SCRIPT_DIR/Dockerfile" \
            "$CONTEXT_DIR"
        ;;
    --load)
        platform="linux/$(docker version --format '{{.Server.Arch}}')"
        docker buildx build \
            --builder "$BUILDER_NAME" \
            --platform "$platform" \
            --tag "$IMAGE_REF" \
            --load \
            --file "$SCRIPT_DIR/Dockerfile" \
            "$CONTEXT_DIR"
        ;;
    *)
        echo "Usage: $0 [--oci|--push|--load]" >&2
        exit 64
        ;;
esac
