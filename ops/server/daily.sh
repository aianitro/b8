#!/bin/sh
# The morning run on the home server: verified backup first, then sync, snapshot and digest.
#
# Backup first, so the dump predates the day's mutations. `;` rather than `&&` between them, so a
# backup failure costs the backup and not the sync, the snapshot and the mail.
set -u
APP="$HOME/b8"
"$APP/ops/server/wait-for-clock.sh"

export PATH="$HOME/opt/node/bin:$HOME/opt/pg16/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# The backup's restore rehearsal calls createdb/psql/dropdb with no connection string. On this
# server the only role is `b8` and the socket is /tmp, so without these they would try to connect
# as the macOS user and fail — every night, silently, with no backup kept.
export PGHOST=127.0.0.1 PGUSER=b8

# The scripts live in the web workspace after P1-10a; `npm run job:daily` at the root would
# also work (it delegates with -w @b8/web) but this keeps the process's cwd where its
# relative imports and .env.local resolution expect it.
cd "$APP/apps/web"
until pg_isready -q; do sleep 2; done
npm run backup
npm run job:daily
