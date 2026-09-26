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
SOURCE="$SCRIPT_DIR/pull-backups.sh"

# ─── THE SCRIPTS ARE COPIED OUT OF ~/Documents, AND THEY HAVE TO BE ───────────────────────────
#
# macOS TCC protects ~/Documents, ~/Desktop and ~/Downloads, and a LaunchAgent is granted access to
# none of them. Pointing the agent at the checkout inside ~/Documents installs cleanly, loads
# cleanly, and then fails every single run with
#
#     /bin/sh: .../ops/laptop/pull-backups.sh: Operation not permitted
#
# and exit code 126. Note EPERM, not EACCES: the file's own 755 is irrelevant, launchd is refused by
# the privacy layer before the mode is ever consulted. The alternative — granting Full Disk Access —
# would mean granting it to /bin/sh, which is both useless as a boundary and absurd as a request.
#
# So the agent runs an INSTALLED COPY in ~/opt/b8, the same convention the server uses for node,
# pg16 and age. The copy is deliberate rather than a symlink, which TCC would follow back into the
# protected directory and refuse identically. Consequence worth knowing: the installed copy does not
# track the repo, so re-run this script after changing either script.
#
# The same trap caught the BACKUP directory earlier, which is why it lives at ~/b8-backups; it simply
# was not obvious that an executable is subject to exactly the same rule as a data file.
LIBEXEC="${B8_LIBEXEC:-$HOME/opt/b8}"
SCRIPT="$LIBEXEC/pull-backups.sh"
LOCAL_DIR="${B8_LOCAL_BACKUPS:-$HOME/b8-backups}"
LOG="$LOCAL_DIR/pull.log"
PLIST="$HOME/Library/LaunchAgents/com.b8.backup-pull.plist"
SERVER="${B8_SERVER:-aanpilogov@100.118.130.37}"
KEY="${B8_SERVER_KEY:-$HOME/.ssh/b8_server}"
AGE_KEY="$HOME/.config/b8/backup-key.txt"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

fail=0
say() { printf '%s %s\n' "$1" "$2"; }

[ -f "$SOURCE" ]  && say ok "pull script at $SOURCE"              || { say NO "no pull script at $SOURCE"; fail=1; }
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

# Offsite is reported, never fatal. Two working copies today are worth more than three copies that
# wait on a browser sign-in nobody has got round to; the pull is useful on its own and the offsite
# step starts contributing the hour after it is authorised, with no reinstall.
OFFSITE_REMOTE="${B8_OFFSITE_REMOTE:-b8remote}"
if ! command -v rclone >/dev/null; then
  say WARN "rclone not installed — no offsite copy (brew install rclone)"
elif rclone listremotes 2>/dev/null | grep -q "^${OFFSITE_REMOTE}:$"; then
  say ok "offsite remote '$OFFSITE_REMOTE' is configured"
else
  say WARN "offsite remote '$OFFSITE_REMOTE' not configured — run 'rclone config' to add the third copy"
fi

if ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$SERVER" 'ls ~/b8/apps/backups >/dev/null' 2>/dev/null; then
  say ok "server reachable and the backup directory is readable"
else
  say NO "cannot reach $SERVER over the tailnet, or its backup directory is missing"
  fail=1
fi

[ "$fail" -eq 0 ] || { echo; echo "Nothing installed — fix the NO lines above and re-run. Re-running is safe."; exit 1; }

mkdir -p "$LOCAL_DIR" "$HOME/Library/LaunchAgents" "$LIBEXEC"
# Both scripts: pull-backups.sh invokes push-offsite.sh from its own directory, so they must travel
# together or the offsite step silently stops existing.
for f in pull-backups.sh push-offsite.sh; do
  [ -f "$SCRIPT_DIR/$f" ] || continue
  cp "$SCRIPT_DIR/$f" "$LIBEXEC/$f"
  chmod 755 "$LIBEXEC/$f"
done
say ok "installed the scripts to $LIBEXEC (outside the TCC-protected ~/Documents)"
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
  echo "scripts: $LIBEXEC  (re-run this installer after editing them in the repo)"
  echo "log:     $LOG"
  echo "run now: launchctl kickstart gui/$(id -u)/com.b8.backup-pull"
  echo "remove:  launchctl bootout gui/$(id -u)/com.b8.backup-pull && rm $PLIST"
  rclone listremotes 2>/dev/null | grep -q "^${OFFSITE_REMOTE}:$" \
    || echo "next:    rclone config   # add remote '$OFFSITE_REMOTE' (drive) for the offsite copy"
else
  echo "FAILED to load the agent" >&2
  exit 1
fi
