#!/bin/sh
# Copy the encrypted backups off this laptop to Google Drive. Called at the end of
# pull-backups.sh, so the offsite copy happens right after new files arrive.
#
# One-time authorisation, done by the owner in a browser, not by any script here:
#
#   rclone config     # n) new remote -> name it b8remote -> "drive" -> scope 3 (drive.file) -> y) auto config
#
# SCOPE `drive.file`, not full access: it confines this token to files rclone itself created, so the
# credential sitting in ~/.config/rclone/rclone.conf cannot read the owner's personal Drive at all.
# Everything here only ever writes its own backups and reads those same files back, so the narrower
# scope costs nothing. Same reasoning as the server not holding the key to its own backups.
#
# ─── WHY AN UNTRUSTED PROVIDER IS FINE ────────────────────────────────────────────────────────
#
# Because these files are age-encrypted to a key that exists only on this laptop and in the
# password manager. Google stores ciphertext it cannot open, so the decision about where the third
# copy lives stops being a question of trust and becomes one of reliability and cost. That is the
# whole return on having done encryption first.
#
# ─── IT UPLOADS ONLY `.age`, AND THAT IS A SAFETY PROPERTY, NOT A TIDINESS ONE ─────────────────
#
# `backup.ts` still writes a PLAINTEXT dump when BACKUP_AGE_RECIPIENT is unset — deliberately, so a
# missing variable costs the encryption and not the backup. But that means one unset variable on the
# server would put readable dumps in the backup directory, the pull would bring them here, and an
# unfiltered `rclone copy` would then hand every transaction to Google in the clear. The filter
# below is the thing standing between those two facts. It is an allowlist on the extension, never a
# denylist, so a name nobody anticipated is excluded rather than included.
#
# `*.env.age` rides along on the same allowlist. There is deliberately NO plaintext form of that name
# -- `backup.ts` skips the capture rather than writing credentials in the clear -- so a bare `.env`
# in this directory is somebody else's file and is not ours to ship anywhere.
#
# Written with `--filter` and NOT with `--include` plus `--exclude`. rclone logs that pairing at
# ERROR level -- "the order they are parsed in is indeterminate" -- which is exactly the property
# being relied on here. A pair of rules whose precedence the tool declines to promise is not an
# allowlist, whatever it does on the day you test it. `--filter` rules are first-match in the order
# given, so `+ *.dump.age` then `- *` means what it reads as.
#
# ─── copy, NEVER sync ─────────────────────────────────────────────────────────────────────────
#
# `rclone sync` would make Drive mirror this laptop, and a mirror is not a backup: the laptop prunes
# at ninety days, and deleting the offsite copy of everything older is the exact opposite of what an
# offsite copy is for. `copy` only ever adds. Drive therefore accumulates every backup ever taken,
# which at roughly 171 KB a file is about 62 MB a year — small enough that unbounded is the right
# answer, and deep history is the point.
set -u

PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

LOCAL_DIR="${B8_LOCAL_BACKUPS:-$HOME/b8-backups}"
REMOTE="${B8_OFFSITE_REMOTE:-b8remote}"
REMOTE_PATH="${B8_OFFSITE_PATH:-b8-backups}"
AGE_KEY="$HOME/.config/b8/backup-key.txt"
MARKER="$LOCAL_DIR/.offsite-verified"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) offsite: $*"; }
notify() { osascript -e "display notification \"$1\" with title \"b8 backups\"" >/dev/null 2>&1 || true; }

command -v rclone >/dev/null || { log "rclone not installed; skipping"; exit 0; }

# NOT YET AUTHORISED IS A NORMAL STATE, NOT A FAILURE. This runs from the hourly agent, which may be
# installed before anyone has sat down to do the browser sign-in. Saying so once and exiting 0 keeps
# the pull healthy and keeps an un-run setup step from looking like a broken backup every hour.
if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:$"; then
  log "remote '$REMOTE' is not configured yet — run: rclone config"
  exit 0
fi

# --include with an explicit --exclude of everything else: rclone's filter rules are first-match, so
# this cannot be widened by a filename. `--no-traverse` keeps it from listing the whole remote when
# there are only a handful of new files to consider.
# The output goes to a file and the status is read straight from rclone. Writing this as a pipe into
# `grep -c` put grep's status in `$?` instead — and `grep -c` exits 1 when the count is zero, so the
# ordinary case of "nothing new to upload" would have been logged as a failed upload every hour.
out=$(mktemp -t b8offsite)
rclone copy "$LOCAL_DIR" "$REMOTE:$REMOTE_PATH" \
  --filter '+ *.dump.age' --filter '+ *.env.age' --filter '- *' \
  --no-traverse --transfers 2 --retries 3 --low-level-retries 5 \
  --stats 0 -v >"$out" 2>&1
rc=$?
# `: Copied` rather than `Copied (new)`: rclone also reports `Copied (replaced existing)`, and both
# are real uploads worth counting.
copied=$(grep -c ': Copied' "$out" 2>/dev/null || true)

if [ "$rc" -ne 0 ]; then
  log "ALARM: upload failed (rclone exit $rc): $(tr '\n' ' ' < "$out" | cut -c1-300)"
  notify "Offsite backup upload failed"
  rm -f "$out"
  exit 0
fi
rm -f "$out"
[ "$copied" -gt 0 ] && log "uploaded $copied new file(s) to $REMOTE:$REMOTE_PATH"

# ─── VERIFY BY RESTORING FROM THE REMOTE, NOT BY LISTING IT ────────────────────────────────────
#
# A listing proves a filename exists. What has to be true is that the bytes IN Drive decrypt — which
# is only knowable by fetching them back and opening them. So the newest remote object is downloaded
# and decrypted, once per new object rather than hourly: the marker file records which one was last
# verified, so this costs one 171 KB round trip a day and nothing on the other twenty-three runs.
#
# This is the same reasoning as the server's restore rehearsal. An offsite copy nobody has ever read
# back is a directory of files that merely look like backups.
newest=$(rclone lsf "$REMOTE:$REMOTE_PATH" --filter '+ *.dump.age' --filter '- *' 2>/dev/null | sort | tail -1)
[ -n "$newest" ] || { log "nothing offsite yet"; exit 0; }

last=$(cat "$MARKER" 2>/dev/null || echo '')
if [ "$newest" = "$last" ]; then exit 0; fi

if [ ! -f "$AGE_KEY" ]; then
  log "cannot verify $newest — no private key on this machine"
  exit 0
fi

tmp=$(mktemp -d -t b8offsite)
if rclone copyto "$REMOTE:$REMOTE_PATH/$newest" "$tmp/$newest" --retries 3 2>/dev/null \
   && age -d -i "$AGE_KEY" "$tmp/$newest" 2>/dev/null | head -c 5 | grep -q 'PGDMP'; then
  # `PGDMP` is pg_dump's custom-format magic. Checking it rather than just "age exited 0" is what
  # makes this a restore test instead of a decryption test: a file could decrypt to anything.
  log "verified $newest — fetched back from Drive and decrypts to a Postgres dump"
  echo "$newest" > "$MARKER"
else
  log "ALARM: $newest is in Drive but did not come back as a readable dump"
  notify "Offsite backup failed verification"
fi
rm -rf "$tmp"
exit 0
