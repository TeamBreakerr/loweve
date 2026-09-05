#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTAINER="loweve-hot-reviews-layout-check"
BASE_URL="${BASE_URL:-http://loweve:18083}"
CHECK_NETWORK="${CHECK_NETWORK:-web-internal}"
SCREENSHOT_DIR="${SCREENSHOT_DIR:-}"
DOUBAN_FILM_ID="${DOUBAN_FILM_ID:-13}"
BANGUMI_FILM_ID="${BANGUMI_FILM_ID:-16}"
GAME_ID="${GAME_ID:-1}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run -d --rm --name "$CONTAINER" --shm-size=1g \
  -p 127.0.0.1:9231:9222 chromedp/headless-shell:latest --disable-checker-imaging >/dev/null
docker network connect "$CHECK_NETWORK" "$CONTAINER"
node scripts/visual-diff/assert_hot_reviews_layout.mjs \
  http://127.0.0.1:9231 "$BASE_URL" "$SCREENSHOT_DIR" "$DOUBAN_FILM_ID" "$BANGUMI_FILM_ID" "$GAME_ID"
