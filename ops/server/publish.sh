#!/bin/sh
# Assemble a complete, runnable copy of the app and swap it into place.
#
#   ~/b8/ops/server/publish.sh
#
# ─── WHY THE APP RUNS FROM A COPY ─────────────────────────────────────────────────────────────
#
# It used to run straight out of `apps/web/.next/standalone`, which is inside the directory
# `npm run build` rewrites. So every deploy spent its whole build — about twenty seconds — serving
# from a folder that was half old and half new, and a request landing on a file mid-replacement got
# a 500. Measured: a request nine seconds into one build returned 500; another sixteen seconds into
# the next returned 200. Intermittent, because it depends on whether the file asked for was one
# being swapped at that instant.
#
# The obvious fix does not work and is worth recording so nobody tries it twice. Building into a
# side directory via `distDir` and renaming it in fails because NEXT WRITES THE DIRECTORY'S NAME
# INTO THE BUILD: the generated `server.js` carries `"distDir":"./.next-incoming"` and the inner
# folder keeps that name, so after the rename the server hunts for its static assets under a name
# that no longer exists and every stylesheet and script 404s. A permanently unstyled app is worse
# than twenty seconds of honest 500s.
#
# So the build stays where it is, and what it produces is COPIED somewhere the build never touches.
# 56MB, a couple of seconds on local disk.
#
# ─── THE SWAP IS A RENAME, AND THE OLD TREE IS KEPT ───────────────────────────────────────────
#
# Renaming is atomic, and a running process keeps serving from the directory it already has open —
# macOS resolves an open cwd by inode, not by path — so publishing disturbs nothing at all. The
# outage becomes exactly the restart that follows, a couple of seconds, and nothing else.
#
# The tree that was serving is kept as `b8-run.previous` rather than deleted, which is what makes
# rollback a rename instead of a rebuild: the exact bytes that were working are still on disk.
set -eu

APP="$HOME/b8"
WEB="$APP/apps/web"
RUN="$HOME/b8-run"
INCOMING="$RUN.incoming"
PREVIOUS="$RUN.previous"

[ -f "$WEB/.next/standalone/apps/web/server.js" ] || {
  echo "publish: no build to publish — run npm run build first" >&2
  exit 1
}

rm -rf "$INCOMING"
mkdir -p "$INCOMING"

# The standalone ROOT holds `apps/web/` and a hoisted `node_modules/`, because
# `outputFileTracingRoot` is the repo root. Both are needed; copy the lot.
cp -R "$WEB/.next/standalone/." "$INCOMING/"

# Next omits these two from standalone output by design, so they are placed beside `server.js`
# exactly as the old start script did.
rm -rf "$INCOMING/apps/web/public" "$INCOMING/apps/web/.next/static"
cp -R "$WEB/public" "$INCOMING/apps/web/public"
cp -R "$WEB/.next/static" "$INCOMING/apps/web/.next/static"

# What this tree is, so a running server can be identified without guessing from timestamps.
(cd "$APP" && git rev-parse HEAD 2>/dev/null) > "$INCOMING/COMMIT" || true

rm -rf "$PREVIOUS"
[ -d "$RUN" ] && mv "$RUN" "$PREVIOUS"
mv "$INCOMING" "$RUN"

echo "publish: $RUN is now $(cat "$RUN/COMMIT" 2>/dev/null | cut -c1-7)"
