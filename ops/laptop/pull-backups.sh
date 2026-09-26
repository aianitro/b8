#!/bin/sh
# Pull the server's backups down to this laptop, over the tailnet.
#
#   ~/Documents/b8/app/ops/laptop/pull-backups.sh
#
# Run hourly by `com.b8.backup-pull`. Almost every run copies nothing and exits in a second.
#
# ─── WHY THE LAPTOP PULLS RATHER THAN THE SERVER PUSHING ──────────────────────────────────────
#
# A push needs the server to hold a key to this laptop. That machine is the one at risk — nine
# years old, a battery the system reports as failing, and it lives in a flat it could be carried
# out of. Pulling keeps the trust one-directional: this laptop can reach the server, the server
# cannot reach back, and losing the server never costs anything here.
#
# ─── IT NEVER DELETES ─────────────────────────────────────────────────────────────────────────
#
# `rsync --delete` would mirror the server, which for a backup is precisely wrong: the server
# prunes to thirty days, and the copies worth having on the day it matters are the ones it has
# already thrown away. So this only ever adds, and prunes on its own longer schedule below.
#
# ─── NOT IN ~/Documents ───────────────────────────────────────────────────────────────────────
#
# `~/Library/Mobile Documents/com~apple~CloudDocs/Documents` is a symlink to `~/Documents` on this
# machine, so anything placed there is in iCloud within the minute. That was found the hard way
# when iCloud restored four files a commit had deleted. Backups going to Apple may be a fine
# decision, but it should be a decision — not a side effect of a path. `~/b8-backups` is outside
# every synced folder.
set -u

# launchd gives a scheduled job `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so Homebrew's
# `age` is not on it. Prepending rather than replacing keeps this script working when run by hand
# from a normal shell too.
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

SERVER="${B8_SERVER:-aanpilogov@100.118.130.37}"
KEY="${B8_SERVER_KEY:-$HOME/.ssh/b8_server}"
REMOTE_DIR="${B8_REMOTE_BACKUPS:-b8/apps/backups}"
LOCAL_DIR="${B8_LOCAL_BACKUPS:-$HOME/b8-backups}"
# Deeper than the server's thirty, because depth is the reason this copy exists and 175KB a day
# makes ninety of them about 16MB.
KEEP="${B8_BACKUP_KEEP:-90}"
AGE_KEY="$HOME/.config/b8/backup-key.txt"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
# macOS only shows this when someone is logged in, which is the only time it is useful. Reserved
# for the state that needs a human: backups that have stopped arriving.
notify() { osascript -e "display notification \"$1\" with title \"b8 backups\"" >/dev/null 2>&1 || true; }

mkdir -p "$LOCAL_DIR"

before=$(ls -1 "$LOCAL_DIR" 2>/dev/null | wc -l | tr -d ' ')

# `-e ssh -i` rather than an agent: this runs unattended from launchd, where there is no agent.
# BatchMode so a prompt fails fast instead of hanging a scheduled job forever.
# Stderr is captured rather than discarded. Throwing it away would make an unreachable server and a
# permission error look identical in the log, which is the position this would be debugged from at
# the worst possible moment; it is printed below only when the transfer actually failed, so a healthy
# hourly run still says nothing.
err=$(mktemp -t b8pull)
rsync -az --timeout=60 \
  -e "ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20" \
  "$SERVER:$REMOTE_DIR/" "$LOCAL_DIR/" 2>"$err"
rc=$?

after=$(ls -1 "$LOCAL_DIR" 2>/dev/null | wc -l | tr -d ' ')

if [ "$rc" -ne 0 ]; then
  # A laptop that was asleep, or a server that was, is the ordinary case and not worth shouting
  # about — the next run catches up. Staleness below is what actually matters.
  log "could not reach the server (rsync exit $rc): $(tr '\n' ' ' < "$err" | cut -c1-300)"
else
  [ "$after" -gt "$before" ] && log "pulled $((after - before)) new file(s); $after held locally"
fi
rm -f "$err"

# ─── THE NEWEST FILE MUST STILL DECRYPT ───────────────────────────────────────────────────────
#
# Checked on the newest only — it is the one that just arrived, and re-reading ninety files an
# hour would be work for nothing. It tests the whole chain at once: the transfer was complete,
# the file is intact, and the private key on this laptop still opens what the server is producing.
# A backup nobody has ever opened is a hope, not a backup.
newest=$(ls -1 "$LOCAL_DIR"/*.age 2>/dev/null | sort | tail -1)
if [ -n "$newest" ] && [ -f "$AGE_KEY" ]; then
  if age -d -i "$AGE_KEY" -o /dev/null "$newest" 2>/dev/null; then
    :
  else
    log "ALARM: $(basename "$newest") did not decrypt"
    notify "Newest backup did not decrypt"
  fi
fi

# ─── AND THE CREDENTIALS CAPTURE, WHICH NOTHING ELSE EVER READS BACK ──────────────────────────
#
# `b8_env_*.env.age` is the only artifact here that no other step opens: the dump gets a rehearsal on
# the server and a decrypt above, the offsite copy gets fetched back and checked. Without this the
# credentials backup would be the one file in the system that has never been proven readable -- and
# it is the file wanted on the worst day, restoring onto a machine that has nothing.
#
# Checked for a `=` rather than just a clean exit, because age succeeding says the ciphertext was
# well-formed, not that what came out is a configuration file.
newest_env=$(ls -1 "$LOCAL_DIR"/b8_env_*.env.age 2>/dev/null | sort | tail -1)
if [ -n "$newest_env" ] && [ -f "$AGE_KEY" ]; then
  if ! age -d -i "$AGE_KEY" "$newest_env" 2>/dev/null | grep -q '='; then
    log "ALARM: $(basename "$newest_env") did not decrypt to a readable env file"
    notify "Credentials backup did not decrypt"
  fi
fi

# ─── HAVE THEY STOPPED ARRIVING? ──────────────────────────────────────────────────────────────
#
# The failure mode of every backup system is silence. The server writes one a day, so nothing
# newer than two days means something is broken — the daily job, the disk, the machine — and the
# only place that would otherwise show is a log nobody reads.
if [ -n "$newest" ]; then
  if [ -z "$(find "$LOCAL_DIR" -name '*.age' -mtime -2 2>/dev/null | head -1)" ]; then
    log "ALARM: no backup newer than two days; the server may have stopped producing them"
    notify "No new b8 backup in over two days"
  fi
elif [ "$after" -gt 0 ]; then
  log "note: backups are present but none are encrypted yet"
fi

# ─── THE THIRD COPY, BEFORE ANYTHING IS DELETED ───────────────────────────────────────────────
#
# Offsite runs BEFORE the prune below, and the order is the point: pruning first could delete a file
# on its way out, the one run where the two happen to coincide. Upload, then delete. It is a separate
# script so that a Drive outage, or a sign-in nobody has done yet, cannot cost the local copy — this
# one has already done its job by the time that one is called.
[ -x "$(dirname "$0")/push-offsite.sh" ] && "$(dirname "$0")/push-offsite.sh"

# ─── PRUNE, LAST AND BY NAME ──────────────────────────────────────────────────────────────────
#
# Same rule the server uses: only files this system's own naming pattern matches, sorted by the
# timestamp IN the name rather than by mtime — a file copied here gets a fresh mtime and would
# sort as new. Anything else in the directory is left alone forever.
#
# WHICH INCLUDES THE `b8_env_*` CAPTURES, ON PURPOSE. They are written only when the configuration
# changes and run to a few hundred bytes, so the entire history of them is smaller than one dump and
# unbounded is the right answer — where ninety dumps are already about 16 MB. Deliberate, not an
# oversight in the pattern.
# `head -n -N` is a GNU extension; BSD head refuses a negative count outright ("illegal line
# count"), so the first draft of this would have failed silently on every run and never pruned
# anything. Counting first and taking that many from the front is portable and says the same thing.
kept=$(ls -1 "$LOCAL_DIR" 2>/dev/null | grep -cE '^b8_finance_[0-9]{8}T[0-9]{6}Z\.dump(\.age)?$')
excess=$((kept - KEEP))
if [ "$excess" -gt 0 ]; then
  ls -1 "$LOCAL_DIR" 2>/dev/null \
    | grep -E '^b8_finance_[0-9]{8}T[0-9]{6}Z\.dump(\.age)?$' \
    | sort \
    | head -n "$excess" \
    | while IFS= read -r old; do
        [ -n "$old" ] && rm -f "$LOCAL_DIR/$old" && log "pruned $old"
      done
fi

exit 0
