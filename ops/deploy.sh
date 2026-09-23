#!/usr/bin/env bash
# Push this working tree to the server, build it there, and restart the app.
#
# ─── WHY THIS EXISTS: A HAND-WRITTEN rsync DELETED THE SERVER'S BACKUPS ────────────────────────
#
# On 2026-09-23 a deploy was typed at the prompt as `rsync -az --delete` with the obvious excludes
# — `.git`, `node_modules`, `.next`, `.env.local`. It worked, and it also removed `apps/backups/`,
# which is where `scripts/backup.ts` writes on this server (`BACKUP_DIR` unset resolves to
# `<cwd>/../backups`, and the workspace script runs with `apps/web` as cwd). That directory exists
# only on the server, so `--delete` saw it as local cruft. Three days of dumps went.
#
# Nothing was lost beyond the copies — the database was untouched and a fresh verified dump was
# taken within the minute — but the lesson is about where the exclude list lives, not about
# backups. An exclude list that is retyped each time is a list that is eventually retyped wrong,
# and `--delete` is unforgiving about server-only paths in a tree that is otherwise a mirror.
#
# So: THE EXCLUDE LIST IS CODE NOW. Anything the server owns and this repo does not goes in the
# block below, with a reason.
#
#   ops/deploy.sh            # sync, build, restart
#   ops/deploy.sh --dry-run  # print what would be sent and deleted, change nothing
#
# The build runs ON the server on purpose: this laptop is arm64 and the server is x86_64, and a
# `.next` built here carries `sharp-darwin-arm64` into a machine that cannot load it.
set -euo pipefail

HOST="${B8_SERVER:-aanpilogov@100.118.130.37}"
KEY="${B8_SERVER_KEY:-$HOME/.ssh/b8_server}"
REMOTE="${B8_SERVER_PATH:-b8}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# `${DRY[@]+...}` rather than a bare `"${DRY[@]}"`: macOS ships bash 3.2, where expanding an EMPTY
# array under `set -u` is an unbound-variable error. It failed on the first real run, after the
# dry run passed — the dry run is the only path where the array is non-empty.
DRY=()
[ "${1:-}" = "--dry-run" ] && DRY=(--dry-run)

# Server-owned paths. Each one is here because deleting it would destroy something this repo
# cannot recreate, or because it is per-machine configuration.
EXCLUDES=(
  --exclude '.git/'                # history; the server is a deploy target, not a clone
  --exclude 'node_modules/'        # installed per-arch on the server
  --exclude '.next/'               # built on the server, see above
  --exclude '.env.local'           # the server's own credentials — NEVER send this
  --exclude '.env.local.*'         # ...or the backups of it made when it was edited
  --exclude 'apps/backups/'        # DATABASE DUMPS. The directory this script exists because of.
  --exclude 'backups/'             # the older dump location, still holding pre-cutover dumps
  --exclude '.DS_Store'
  --exclude 'tsconfig.tsbuildinfo'
  --exclude '*.log'
)

echo "→ syncing $ROOT to $HOST:$REMOTE"
rsync -az --delete --itemize-changes ${DRY[@]+"${DRY[@]}"} \
  -e "ssh -i $KEY" \
  "${EXCLUDES[@]}" \
  "$ROOT/" "$HOST:$REMOTE/"

if [ "${#DRY[@]}" -gt 0 ]; then
  echo "→ dry run; nothing built, nothing restarted"
  exit 0
fi

echo "→ building on the server"
ssh -i "$KEY" "$HOST" "export PATH=\$HOME/opt/node/bin:\$PATH; cd ~/$REMOTE && npm run build"

# launchd owns the process (KeepAlive), so killing it IS the restart — and it re-runs
# `start-web.sh`, which copies `public` and `.next/static` beside the standalone server.
# Matched on the process name Next actually reports, `next-server`, not on the script path:
# the standalone entry point does not appear in `ps` output.
echo "→ restarting"
ssh -i "$KEY" "$HOST" 'pkill -f "next-server" || true'
sleep 8
ssh -i "$KEY" "$HOST" 'pgrep -fl "next-server" || { echo "app did not come back up" >&2; exit 1; }'
echo "→ up"
