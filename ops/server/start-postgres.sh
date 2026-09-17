#!/bin/sh
# Postgres in the foreground, so launchd can supervise and restart it.
#
# NOT `exec`: launchd stops a service with SIGTERM, and Postgres treats SIGTERM as a SMART shutdown
# — it waits for every client to disconnect. The app's connection pool never does, so launchd would
# give up after its timeout and SIGKILL the postmaster, making every restart and every reboot an
# unclean shutdown followed by crash recovery. This wrapper turns launchd's SIGTERM into SIGINT,
# which Postgres treats as a FAST shutdown: it disconnects clients and checkpoints cleanly.
set -eu
"$(dirname "$0")/wait-for-clock.sh"

# Loopback only. Nothing off this machine talks to the database; the app does, on the same host.
"$HOME/opt/pg16/bin/postgres" -D "$HOME/pgdata" -h 127.0.0.1 -k /tmp &
PG=$!
trap 'kill -INT "$PG" 2>/dev/null' TERM INT
# `wait` returns early when a trapped signal arrives, so wait again for Postgres to finish exiting.
wait "$PG" || true
wait "$PG" 2>/dev/null || true
