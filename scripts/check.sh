#!/usr/bin/env bash
# 一键跑两端 lint + typecheck + 测试。本机无 node，全部经 docker。
set -euo pipefail
cd "$(dirname "$0")/.."

RUN=(docker run --rm -v "$PWD:/repo" node:20-bookworm-slim)

echo '── web: lint ──';        "${RUN[@]}" sh -c 'cd /repo/web && npm run lint'
echo '── web: typecheck ──';   "${RUN[@]}" sh -c 'cd /repo/web && npm run typecheck'
echo '── web: vitest ──';      "${RUN[@]}" sh -c 'cd /repo/web && npm run test:run'
echo '── server: lint ──';     "${RUN[@]}" sh -c 'cd /repo/server && npm run lint'
echo '── server: typecheck ──';"${RUN[@]}" sh -c 'cd /repo/server && npm run typecheck'
echo '── server: mocha ──';    "${RUN[@]}" sh -c 'cd /repo/server && npm test'
echo '✅ all checks green'
