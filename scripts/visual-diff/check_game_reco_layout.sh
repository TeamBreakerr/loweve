#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTAINER="loweve-layout-check"
BASE_URL="${BASE_URL:-http://loweve:18083}"
CHECK_NETWORK="${CHECK_NETWORK:-web-internal}"
SCREENSHOT_PATH="${SCREENSHOT_PATH:-}"
VIEWPORT_WIDTH="${VIEWPORT_WIDTH:-1600}"
VIEWPORT_HEIGHT="${VIEWPORT_HEIGHT:-1100}"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run -d --rm --name "$CONTAINER" --shm-size=1g \
  -p 127.0.0.1:9224:9222 chromedp/headless-shell:latest --disable-checker-imaging >/dev/null
docker network connect "$CHECK_NETWORK" "$CONTAINER"
node scripts/visual-diff/assert_game_reco_layout.mjs http://127.0.0.1:9224 "$BASE_URL" "$SCREENSHOT_PATH" "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
