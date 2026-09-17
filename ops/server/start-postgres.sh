#!/bin/sh
# Postgres in the foreground, so launchd can supervise and restart it.
set -eu
"$(dirname "$0")/wait-for-clock.sh"
# Loopback only. Nothing off this machine talks to the database; the app does, on the same host.
exec "$HOME/opt/pg16/bin/postgres" -D "$HOME/pgdata" -h 127.0.0.1 -k /tmp
