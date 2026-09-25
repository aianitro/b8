#!/bin/sh
# The app, from Next's standalone build, in the foreground for launchd.
#
# Standalone rather than `next start`: with `output: 'standalone'` set, Next warns that `next start`
# "does not work" and names server.js as the entry point. It happened to work in the trial run;
# relying on a path the framework says is unsupported is how an upgrade breaks a server silently.
set -eu
APP="$HOME/b8"
"$APP/ops/server/wait-for-clock.sh"

# ─── IT RUNS FROM A COPY, NOT FROM THE BUILD DIRECTORY ────────────────────────────────────────
#
# `~/b8-run` is a complete standalone tree assembled by `publish.sh`. The app used to run straight
# out of `apps/web/.next/standalone`, which is inside the folder `npm run build` rewrites — so a
# deploy served from a half-replaced directory for the whole build and returned intermittent 500s
# for about twenty seconds. Running from a copy the build never touches reduces the outage to the
# restart below.
#
# The old copying of `public` and `.next/static` moved into `publish.sh` with it; this script now
# starts a tree that is already complete.
#
# PUBLISHES IF THERE IS NOTHING TO RUN. On a machine that has never deployed — a fresh install, or
# the first boot after this change — `~/b8-run` does not exist yet, and a start script that simply
# failed would leave launchd restarting it every ten seconds forever. Building is NOT attempted
# here: if there is no build either, that is a real failure and the log should say so rather than
# have a service quietly compile the app at boot.
WEB="$APP/apps/web"
RUN="$HOME/b8-run"

if [ ! -f "$RUN/apps/web/server.js" ]; then
  echo "start-web: no published tree at $RUN; publishing from the current build"
  "$APP/ops/server/publish.sh"
fi

until "$HOME/opt/pg16/bin/pg_isready" -h 127.0.0.1 -q; do sleep 2; done

cd "$RUN/apps/web"
# Loopback only. Phones reach this through `tailscale serve`, which terminates TLS — passkeys need a
# secure context, so the app must never be reached over plain http from another machine.
export HOSTNAME=127.0.0.1
# 3000, the same port as everywhere else in this repo. It was briefly 3100 while an old Grafana held
# 3000 on this machine; that was removed on 2026-09-17. B8_PORT overrides it if anything claims 3000
# again.
export PORT="${B8_PORT:-3000}"
# `$WEB/.env.local`, not `$APP/.env.local`. P1-10a moved it into the web workspace because Next
# loads it from the app root — and this line was missed in that change, which took the app down:
# launchd restarted it every ten seconds and node exited each time with ".env.local: not found".
exec "$HOME/opt/node/bin/node" --env-file="$WEB/.env.local" server.js
