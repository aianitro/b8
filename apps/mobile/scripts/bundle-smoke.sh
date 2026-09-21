#!/bin/sh
# Does the app actually BUNDLE, with the shared contract resolved into it?
#
# WHY THIS EXISTS. `tsc --noEmit` proves the types agree. It does not prove Metro can BUNDLE the
# app — a different resolver, at a different time, over the real module graph. Asking Metro for a
# bundle over HTTP runs that resolver, and needs no device, no simulator and no Xcode.
#
# WHAT IT CATCHES, measured rather than assumed: a cross-package import Metro cannot resolve. Point
# `lib/api.ts` at `@b8/contracts/no-such-module` and this exits non-zero.
#
# WHAT IT DOES NOT CATCH, and this was found by trying: a broken `metro.config.js`. Gutting
# watchFolders and nodeModulesPaths still bundles, because npm workspaces symlinks
# `node_modules/@b8/contracts` and Metro follows it through ordinary lookup. A first version of this
# header claimed otherwise. There is no automated check for the config today; what it buys is
# cross-package hot reload, which needs a running device to observe.
#
#   sh scripts/bundle-smoke.sh            # ios
#   sh scripts/bundle-smoke.sh android
#
# Exits 0 only if the bundle builds AND carries a symbol that could only have come from
# packages/contracts.
set -eu

PLATFORM="${1:-ios}"
PORT="${SMOKE_PORT:-8099}"
PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
WORKSPACE_ROOT=$(cd "$PROJECT_DIR/../.." && pwd)

# THE ENTRY PATH IS RELATIVE TO METRO'S SERVER ROOT, NOT TO THE PROJECT.
#
# `metro.config.js` sets `watchFolders` to the workspace root, and Metro then treats that as the
# server root — so `/index.bundle` 404s with "Unable to resolve ./index from <workspace root>" and
# the real path is `/apps/mobile/index.bundle`. Derived here rather than hardcoded, so moving this
# package does not silently turn the check into a 404 that nobody reads.
ENTRY_PATH=$(printf '%s' "${PROJECT_DIR#"$WORKSPACE_ROOT"/}")
BUNDLE_URL="http://127.0.0.1:$PORT/$ENTRY_PATH/index.bundle?platform=$PLATFORM&dev=true&minify=false"

LOG=$(mktemp)
OUT=$(mktemp)
METRO_PID=""

cleanup() {
  [ -n "$METRO_PID" ] && kill "$METRO_PID" 2>/dev/null || true
  rm -f "$LOG" "$OUT"
}
trap cleanup EXIT INT TERM

echo "bundling $PLATFORM from $ENTRY_PATH on port $PORT"

# A base URL is required by lib/config.ts only at REQUEST time, not at bundle time, but Expo
# inlines EXPO_PUBLIC_* at build time — so set a deliberately unreachable one. A bundle smoke test
# must never be able to talk to the real server.
cd "$PROJECT_DIR"
EXPO_PUBLIC_B8_BASE_URL="https://bundle-smoke.invalid" \
  npx expo start --port "$PORT" > "$LOG" 2>&1 &
METRO_PID=$!

# Wait for Metro to listen rather than sleeping a guessed interval.
i=0
until nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "FAIL: Metro never listened on $PORT after 60s" >&2
    sed -n '1,20p' "$LOG" >&2
    exit 1
  fi
  sleep 1
done

STATUS=$(curl -s -o "$OUT" -w '%{http_code}' --max-time 300 "$BUNDLE_URL" || echo 000)

if [ "$STATUS" != "200" ]; then
  echo "FAIL: Metro answered HTTP $STATUS" >&2
  # Metro returns its resolution error as JSON in the body, which is the useful part.
  head -c 600 "$OUT" >&2
  echo >&2
  exit 1
fi

BYTES=$(wc -c < "$OUT" | tr -d ' ')

# THE ASSERTION THAT MAKES THIS MORE THAN A 200. A bundle that built without the shared package
# would still be a valid 200 — this symbol exists only in packages/contracts, so its presence is
# proof the cross-package resolution happened.
if ! grep -q 'OverviewResponseSchema' "$OUT"; then
  echo "FAIL: the bundle built ($BYTES bytes) but carries no symbol from packages/contracts." >&2
  echo "      Metro resolved the app without the shared schemas — check metro.config.js." >&2
  exit 1
fi

echo "PASS: $PLATFORM bundle built, $BYTES bytes, @b8/contracts resolved into it"
