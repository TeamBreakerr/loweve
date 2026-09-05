#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTAINER="loweve-space-switch-home-check"
BASE_URL="${BASE_URL:-http://loweve:18083}"
CHECK_NETWORK="${CHECK_NETWORK:-web-internal}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run -d --rm --name "$CONTAINER" --shm-size=1g \
  -p 127.0.0.1:9231:9222 chromedp/headless-shell:latest --disable-checker-imaging >/dev/null
docker network connect "$CHECK_NETWORK" "$CONTAINER"
node scripts/visual-diff/assert_space_switch_home.mjs http://127.0.0.1:9231 "$BASE_URL"
