#!/usr/bin/env bash
# Runs every browser check against retro-terminal/. Starts a static server,
# runs the suites, stops the server, and exits non-zero if anything failed.
#
#   ./tests/run.sh
#
# Requires node and playwright (with a chromium build). If playwright is
# installed globally rather than locally, point node at it:
#
#   NODE_PATH=$(npm root -g) ./tests/run.sh
#
# ESM ignores NODE_PATH, so run.sh symlinks node_modules into tests/ instead.

set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8781}"
export BASE_URL="http://127.0.0.1:${PORT}"

if [ ! -e tests/node_modules ] && [ -d "$(npm root -g)/playwright" ]; then
  ln -sfn "$(npm root -g)" tests/node_modules
fi

npx --yes http-server retro-terminal -p "$PORT" -s >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

for _ in $(seq 1 30); do
  curl -sf -o /dev/null "$BASE_URL/index.html" && break
  sleep 0.5
done

FAILED=0
for suite in verify verify-dst verify-storage sums sweep; do
  echo "=============================== $suite"
  node "tests/$suite.mjs" || FAILED=1
done

echo
[ "$FAILED" -eq 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED"
exit "$FAILED"
