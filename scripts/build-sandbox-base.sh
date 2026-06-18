#!/usr/bin/env bash
# Build the codewright/sandbox-base image used by the Docker sandbox provider.
#
# Run this once on every worker host before the first task, and again whenever
# docker/Dockerfile.sandbox-base changes or a new tag is cut.
#
# Usage:
#   scripts/build-sandbox-base.sh          # builds codewright/sandbox-base:1
#   TAG=2 scripts/build-sandbox-base.sh    # builds codewright/sandbox-base:2
set -euo pipefail

TAG="${TAG:-1}"
IMAGE="codewright/sandbox-base:${TAG}"

cd "$(dirname "$0")/.."

echo "Building ${IMAGE}..."
docker build \
    --tag "${IMAGE}" \
    --file docker/Dockerfile.sandbox-base \
    docker/

echo "Done. Image: ${IMAGE}"
docker image inspect "${IMAGE}" --format 'Size: {{.Size}} bytes ({{.Created}})'
