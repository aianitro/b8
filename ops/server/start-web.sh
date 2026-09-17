#!/bin/sh
# The app, from Next's standalone build, in the foreground for launchd.
#
# Standalone rather than `next start`: with `output: 'standalone'` set, Next warns that `next start`
# "does not work" and names server.js as the entry point. It happened to work in the trial run;
# relying on a path the framework says is unsupported is how an upgrade breaks a server silently.
set -eu
APP="$HOME/b8"
"$APP/ops/server/wait-for-clock.sh"

# Standalone output omits these two directories by design; they must sit beside server.js.
rm -rf "$APP/.next/standalone/public" "$APP/.next/standalone/.next/static"
cp -R "$APP/public" "$APP/.next/standalone/public"
cp -R "$APP/.next/static" "$APP/.next/standalone/.next/static"

# Wait for the database, so the first request after a power cut is not a 500.
until "$HOME/opt/pg16/bin/pg_isready" -h 127.0.0.1 -q; do sleep 2; done

cd "$APP/.next/standalone"
# Loopback only. Phones reach this through `tailscale serve`, which terminates TLS — passkeys need a
# secure context, so the app must never be reached over plain http from another machine.
export HOSTNAME=127.0.0.1
# 3100, not 3000: Grafana already holds 3000 on this machine.
export PORT="${B8_PORT:-3100}"
exec "$HOME/opt/node/bin/node" --env-file="$APP/.env.local" server.js
