#!/bin/sh
# Installs the backup pull on THIS LAPTOP. Run once, WITHOUT sudo.
#
#   ~/Documents/b8/app/ops/laptop/install.sh
#
# Reversible; the removal commands are printed at the end.
#
# It CHECKS BEFORE IT INSTALLS. A scheduled job that cannot work is worse than no scheduled job,
# because it looks like one: launchd reports it as loaded, the log fills with the same failure every
# hour, and nobody reads an hourly log. So each prerequisite is tested first and nothing is
# scheduled unless they all pass.
set -u

[ "$(id -u)" -ne 0 ] || { echo "run WITHOUT sudo — this is a per-user agent, not a system daemon" >&2; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/pull-backups.sh"
LOCAL_DIR="${B8_LOCAL_BACKUPS:-$HOME/b8-backups}"
LOG="$LOCAL_DIR/pull.log"
PLIST="$HOME/Library/LaunchAgents/com.b8.backup-pull.plist"
SERVER="${B8_SERVER:-aanpilogov@100.118.130.37}"
KEY="${B8_SERVER_KEY:-$HOME/.ssh/b8_server}"
AGE_KEY="$HOME/.config/b8/backup-key.txt"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

fail=0
say() { printf '%s %s\n' "$1" "$2"; }

[ -f "$SCRIPT" ]  && say ok "pull script at $SCRIPT"              || { say NO "no pull script at $SCRIPT"; fail=1; }
command -v age >/dev/null && say ok "age $(age --version 2>/dev/null)" || { say NO "age not installed (brew install age)"; fail=1; }
[ -f "$AGE_KEY" ] && say ok "private key present (not read, not printed)" || say WARN "no private key at $AGE_KEY — the pull will still run, but cannot verify that what arrives decrypts"
[ -f "$KEY" ]     && say ok "ssh key at $KEY"                     || { say NO "no ssh key at $KEY"; fail=1; }

# THE DESTINATION MUST NOT BE IN iCLOUD. `~/Library/Mobile Documents/com~apple~CloudDocs/Documents`
# is a symlink to `~/Documents` on this machine, so a backup directory anywhere under Documents or
# Desktop is uploaded to Apple within the minute. That may be a fine choice, but it must be a choice
# — not something a default path did quietly. Refused rather than warned, because the whole point of
# encrypting these was to control who holds them.
case "$LOCAL_DIR" in
  "$HOME"/Documents/*|"$HOME"/Desktop/*|"$HOME"/Library/Mobile\ Documents/*)
    say NO "$LOCAL_DIR is inside an iCloud-synced folder; choose a path outside Documents and Desktop"
    fail=1 ;;
  *) say ok "$LOCAL_DIR is outside the iCloud-synced folders" ;;
esac

if ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$SERVER" 'ls ~/b8/apps/backups >/dev/null' 2>/dev/null; then
  say ok "server reachable and the backup directory is readable"
else
  say NO "cannot reach $SERVER over the tailnet, or its backup directory is missing"
  fail=1
fi

[ "$fail" -eq 0 ] || { echo; echo "Nothing installed — fix the NO lines above and re-run. Re-running is safe."; exit 1; }

mkdir -p "$LOCAL_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$LOCAL_DIR"   # dumps of every transaction, even encrypted: no reason for other accounts to list them
sed -e "s|__SCRIPT__|$SCRIPT|g" -e "s|__LOG__|$LOG|g" "$SCRIPT_DIR/com.b8.backup-pull.plist" > "$PLIST"
chmod 644 "$PLIST"

# `bootout` returns before the job is gone, the same way it does on the server — where bootstrapping
# straight after it left Postgres stopped. Wait until launchd no longer knows the label.
if launchctl print "gui/$(id -u)/com.b8.backup-pull" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/com.b8.backup-pull" 2>/dev/null || true
  i=0
  while launchctl print "gui/$(id -u)/com.b8.backup-pull" >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -gt 30 ] && { echo "the old agent did not stop within 30s" >&2; exit 1; }
    sleep 1
  done
fi

if launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  echo
  echo "installed — it runs now and every hour after"
  echo "backups: $LOCAL_DIR"
  echo "log:     $LOG"
  echo "run now: launchctl kickstart gui/$(id -u)/com.b8.backup-pull"
  echo "remove:  launchctl bootout gui/$(id -u)/com.b8.backup-pull && rm $PLIST"
else
  echo "FAILED to load the agent" >&2
  exit 1
fi
