#!/bin/sh
# Bring the server up to origin/main, if it is not already there.
#
#   ~/b8/ops/server/pull-deploy.sh          # one pass; does nothing when already current
#   ~/b8/ops/server/pull-deploy.sh --force  # rebuild and restart even with no new commit
#
# Run every two minutes by `com.b8.deploy`. Almost every run exits in under a second having found
# nothing to do; the noisy path only happens after a push.
#
# ─── WHY PULL AND NOT PUSH ────────────────────────────────────────────────────────────────────
#
# Three constraints, and together they leave one answer.
#
# THE RUNNERS CANNOT REACH THIS MACHINE. It is behind NAT and published only inside the tailnet —
# `tailscale serve status` says "tailnet only" and Funnel is off, which docs/DEPLOY.md calls for
# deliberately: opening the only public surface in the system is a decision that needs its own
# argument, not a side effect of wanting deployments.
#
# THE BUILD HAS TO HAPPEN HERE. This is Darwin x86_64 and the build resolves `sharp-darwin-x64`.
# GitHub has retired its x86_64 macOS runners, so no hosted runner can produce a `.next` this
# machine can load. Building elsewhere means containerising for Linux first.
#
# THE MACHINE SLEEPS. Its battery reports "Service Recommended" and it has already lost power
# once mid-session. A push-based deploy fails whenever the lid is down; a pull catches up on wake
# with nobody watching.
#
# It also needs no credential at all: the repo is public, so `git fetch` is unauthenticated, and
# nothing about this adds a secret to GitHub or a port to this machine.
#
# ─── ORDER, AND WHY THIS ORDER ────────────────────────────────────────────────────────────────
#
# fetch → reset → install (only if the lockfile moved) → BUILD → migrate → restart → health check.
#
# Build before migrate, so a commit that does not compile never reaches the database. Migrate
# before restart, so the new code never starts against the old schema. This repo's migrations have
# all been additive, which is what makes that order safe: the running old code tolerates a column
# it does not know about for the few seconds before it is replaced.
set -u

APP="$HOME/b8"
BRANCH="${B8_DEPLOY_BRANCH:-main}"
HEALTH_URL="http://127.0.0.1:${B8_PORT:-3000}/login"
LOCK="$APP/.deploy.lock"
export PATH="$HOME/opt/node/bin:$HOME/opt/pg16/bin:$PATH"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
fail() { log "FAILED: $*"; rmdir "$LOCK" 2>/dev/null; exit 1; }

# `mkdir` is the atomic test-and-set every POSIX shell has; macOS ships no `flock`. A crashed run
# would leave this behind, so it is cleared when older than an hour — long enough that it cannot
# collide with a real build, short enough that a wedged deploy heals itself before morning.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    log "clearing a stale lock over an hour old"
    rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null || { log "another deploy holds the lock"; exit 0; }
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

cd "$APP" || fail "no $APP"
[ -d .git ] || fail "$APP is not a git clone — see docs/DEPLOY.md"

git fetch --quiet origin "$BRANCH" || fail "git fetch"

CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse "origin/$BRANCH")

if [ "$CURRENT" = "$TARGET" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

# ─── NOTHING RED REACHES THE SERVER ───────────────────────────────────────────────────────────
#
# CI was red for about twenty hours and seven commits went to this machine anyway, because the
# deployer had no opinion about it: `origin/main` moved, so it deployed. One of those commits
# carried a migration with no down section, which only the migrate job could have caught and did,
# into a log nobody read.
#
# So the gate is here rather than in a habit of checking. Unauthenticated against the public repo
# — no token, no secret, and the 60-per-hour anonymous limit is never close: this only runs when a
# new commit appears, and at worst re-checks one commit every two minutes.
#
# FOUR VERDICTS, AND ONLY ONE OF THEM DEPLOYS. Red refuses. Pending waits, because CI usually
# finishes within a minute of the push and the next pass will find it green. Unknown — the API
# unreachable, or no checks reported for the commit — also waits, which is the conservative
# reading: a stalled deploy is visible in this log and recoverable with --force, where deploying
# an unverified commit is the thing this exists to prevent.
REPO=$(git config --get remote.origin.url | sed -e 's|.*github.com[:/]||' -e 's|\.git$||')

ci_verdict() {
  curl -s --max-time 15 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/commits/$1/check-runs" 2>/dev/null | python3 -c '
import json, sys
try:
    runs = json.load(sys.stdin).get("check_runs", [])
except Exception:
    print("unknown"); raise SystemExit
if not runs:
    print("unknown")
elif any(r.get("status") != "completed" for r in runs):
    print("pending")
# `neutral` and `skipped` are not failures: a job that chose not to run has not condemned anything.
elif all(r.get("conclusion") in ("success", "neutral", "skipped") for r in runs):
    print("green")
else:
    print("red")
' 2>/dev/null || echo unknown
}

if [ "${1:-}" != "--force" ]; then
  VERDICT=$(ci_verdict "$TARGET")
  if [ "$VERDICT" != "green" ]; then
    # Logged ONCE per commit-and-verdict, not on every pass. A red commit sits until the next push
    # — some twenty minutes of identical lines before breakfast if this said it each time.
    SAID="$APP/.deploy-last-said"
    if [ "$(cat "$SAID" 2>/dev/null)" != "$TARGET $VERDICT" ]; then
      printf '%s %s' "$TARGET" "$VERDICT" > "$SAID"
      case "$VERDICT" in
        red)     log "NOT deploying ${TARGET%${TARGET#???????}}: CI is red. Fix it, or --force." ;;
        pending) log "holding ${TARGET%${TARGET#???????}}: CI has not finished" ;;
        unknown) log "holding ${TARGET%${TARGET#???????}}: cannot read CI for it" ;;
      esac
    fi
    exit 0
  fi
fi

# `--force` on an unchanged commit read "deploying 108ee22..108ee22", which describes a move
# that did not happen and reads like a bug in the range. Say what it is instead.
if [ "$CURRENT" = "$TARGET" ]; then
  log "forced rebuild at ${TARGET%${TARGET#???????}}"
else
  log "deploying ${CURRENT%${CURRENT#???????}}..${TARGET%${TARGET#???????}}"
fi

# The lockfile is compared BEFORE the reset moves it, so `npm ci` runs only when dependencies
# actually changed. It takes about a minute; most deploys touch no dependency at all.
LOCK_BEFORE=$(shasum package-lock.json 2>/dev/null | cut -d' ' -f1)

# `--hard` discards anything modified on the server, which is the point: this tree is a deploy
# target and the only honest answer to "what is running" is a commit. Untracked files are NOT
# touched — `.env.local`, `apps/backups/` and `node_modules/` all survive, which is why this is a
# reset and never a `clean`.
git reset --hard --quiet "$TARGET" || fail "git reset"

if [ "$(shasum package-lock.json 2>/dev/null | cut -d' ' -f1)" != "$LOCK_BEFORE" ]; then
  log "lockfile changed; installing"
  npm ci || fail "npm ci"
fi

# The build writes into `apps/web/.next`, which nothing serves from any more — `publish.sh` copies
# what it produces into `~/b8-run` and the app runs from there. So a build no longer disturbs the
# running app at all, and the outage is the restart below rather than the twenty seconds this used
# to cost.
log "building"
npm run build >/dev/null 2>&1 || fail "build"

# The swap is a rename, so the running process keeps serving from the tree it already has open
# until it is deliberately restarted. The tree it was using is kept as `b8-run.previous`, which is
# what lets the rollback below be a rename rather than another build.
log "publishing"
"$APP/ops/server/publish.sh" >/dev/null 2>&1 || fail "publish"

log "migrating"
npm run migrate:up >/dev/null 2>&1 || fail "migrate"

log "restarting"
# launchd owns the process and will bring it straight back; killing it IS the restart. Matched on
# the name Next reports rather than the script path, which never appears in `ps`.
pkill -f "next-server" 2>/dev/null

# THE HEALTH CHECK IS THE POINT OF HAVING A PIPELINE AT ALL. Without it a bad build leaves launchd
# flapping every ten seconds and nothing says so until the phone is opened. `/login` is pre-auth
# and server-rendered, so a 200 proves Next is up AND rendering, which a TCP connect does not.
i=0
while [ "$i" -lt 45 ]; do
  sleep 2
  i=$((i + 2))
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "$HEALTH_URL" 2>/dev/null)
  [ "$code" = "200" ] && { log "up at $TARGET"; exit 0; }
done

# ─── ROLLBACK ─────────────────────────────────────────────────────────────────────────────────
#
# A RENAME, NOT A REBUILD. `publish.sh` keeps the tree that was serving as `b8-run.previous`, so
# recovery restores the exact bytes that were working a minute ago — no compile, and nothing that
# depends on the broken commit building a second time. It used to rebuild from git, which took
# another twenty seconds and could itself fail.
#
# Git is reset alongside it so the checkout and the running tree agree about which commit this is.
log "no 200 from $HEALTH_URL after ${i}s — rolling back to ${CURRENT%${CURRENT#???????}}"
git reset --hard --quiet "$CURRENT" || log "WARNING: could not reset the checkout; the running tree is still restored below"

if [ -d "$HOME/b8-run.previous" ]; then
  rm -rf "$HOME/b8-run.failed"
  mv "$HOME/b8-run" "$HOME/b8-run.failed" 2>/dev/null
  mv "$HOME/b8-run.previous" "$HOME/b8-run" || fail "rollback could not restore the previous tree"
else
  # Nothing kept — the first deploy after this change, or a publish that never completed. Rebuild,
  # which is slower and is why the previous tree is kept at all.
  log "no previous tree kept; rebuilding ${CURRENT%${CURRENT#???????}}"
  npm run build >/dev/null 2>&1 || fail "rollback build"
  "$APP/ops/server/publish.sh" >/dev/null 2>&1 || fail "rollback publish"
fi

pkill -f "next-server" 2>/dev/null
sleep 10
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$HEALTH_URL")" = "200" ]; then
  fail "$TARGET was bad; rolled back and the previous commit is serving"
fi
fail "$TARGET was bad AND the rollback did not come up — the app is down"
