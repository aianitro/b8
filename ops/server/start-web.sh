#!/bin/sh
# The app, from Next's standalone build, in the foreground for launchd.
#
# Standalone rather than `next start`: with `output: 'standalone'` set, Next warns that `next start`
# "does not work" and names server.js as the entry point. It happened to work in the trial run;
# relying on a path the framework says is unsupported is how an upgrade breaks a server silently.
set -eu
APP="$HOME/b8"
"$APP/ops/server/wait-for-clock.sh"

# P1-10a MOVED ALL OF THESE. The Next app is a workspace at `apps/web`, and because
# `outputFileTracingRoot` is the repo root, the standalone output nests the app under its own path
# and hoists node_modules beside it:
#
#   apps/web/.next/standalone/apps/web/server.js      <- the entry point
#   apps/web/.next/standalone/node_modules/           <- hoisted, shared
#
# Verified by building and booting it: /login answered 200 and /api/v1/overview answered 401.
WEB="$APP/apps/web"
STANDALONE="$WEB/.next/standalone/apps/web"

# Standalone output omits these two directories by design; they must sit beside server.js.
rm -rf "$STANDALONE/public" "$STANDALONE/.next/static"
cp -R "$WEB/public" "$STANDALONE/public"
cp -R "$WEB/.next/static" "$STANDALONE/.next/static"

# Wait for the database, so the first request after a power cut is not a 500.
until "$HOME/opt/pg16/bin/pg_isready" -h 127.0.0.1 -q; do sleep 2; done

cd "$STANDALONE"
# Loopback only. Phones reach this through `tailscale serve`, which terminates TLS — passkeys need a
# secure context, so the app must never be reached over plain http from another machine.
export HOSTNAME=127.0.0.1
# 3000, the same port as everywhere else in this repo. It was briefly 3100 while an old Grafana held
# 3000 on this machine; that was removed on 2026-09-17. B8_PORT overrides it if anything claims 3000
# again.
export PORT="${B8_PORT:-3000}"
exec "$HOME/opt/node/bin/node" --env-file="$APP/.env.local" server.js
