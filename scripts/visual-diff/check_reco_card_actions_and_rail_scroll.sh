#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTAINER="loweve-reco-card-actions-check"
BASE_URL="${BASE_URL:-http://loweve:18083}"
CHECK_NETWORK="${CHECK_NETWORK:-web-internal}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run -d --rm --name "$CONTAINER" --shm-size=1g \
  -p 127.0.0.1:9233:9222 chromedp/headless-shell:latest --disable-checker-imaging >/dev/null
docker network connect "$CHECK_NETWORK" "$CONTAINER"
node scripts/visual-diff/assert_reco_card_actions_and_rail_scroll.mjs http://127.0.0.1:9233 "$BASE_URL"
