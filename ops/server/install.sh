#!/bin/sh
# Installs b8's Postgres and web server as boot-time services. Run once, with sudo, on the server.
#
#   sudo ~/b8/ops/server/install.sh
#
# Reversible: the removal commands are printed at the end.
set -u
FAILED=0
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }

USER_NAME="${SUDO_USER:?run via sudo from the account that owns ~/b8}"
USER_HOME=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | awk '{print $2}')
APP="$USER_HOME/b8"

sudo -u "$USER_NAME" mkdir -p "$USER_HOME/b8-logs"

for svc in postgres web daily; do
  target="/Library/LaunchDaemons/com.b8.$svc.plist"
  sed -e "s|__USER__|$USER_NAME|g" -e "s|__HOME__|$USER_HOME|g" -e "s|__APP__|$APP|g" \
    "$APP/ops/server/com.b8.$svc.plist" > "$target"
  chown root:wheel "$target"; chmod 644 "$target"
  # `bootout` RETURNS BEFORE THE SERVICE HAS STOPPED. Bootstrapping straight after it fails with
  # "Bootstrap failed: 5: Input/output error" whenever the old instance is still shutting down —
  # which Postgres now always is for a moment, because it stops cleanly. The first run of this
  # script on 2026-09-17 did exactly that and left the database stopped. So: wait until launchd
  # no longer knows the service, bounded at 90 seconds.
  if launchctl print "system/com.b8.$svc" >/dev/null 2>&1; then
    launchctl bootout "system/com.b8.$svc" 2>/dev/null || true
    i=0
    while launchctl print "system/com.b8.$svc" >/dev/null 2>&1; do
      i=$((i + 1))
      [ "$i" -gt 90 ] && { echo "com.b8.$svc did not stop within 90s; not reloading it" >&2; FAILED=1; continue 2; }
      sleep 1
    done
  fi
  if launchctl bootstrap system "$target"; then
    echo "started com.b8.$svc"
  else
    echo "FAILED to start com.b8.$svc" >&2
    FAILED=1
  fi
done

[ "$FAILED" -eq 0 ] || { echo; echo "One or more services failed to start — see above. Re-running this script is safe."; }
echo
echo "logs:   $USER_HOME/b8-logs/"
echo "remove: sudo launchctl bootout system/com.b8.daily; sudo launchctl bootout system/com.b8.web; sudo launchctl bootout system/com.b8.postgres"
echo "        sudo rm /Library/LaunchDaemons/com.b8.daily.plist /Library/LaunchDaemons/com.b8.web.plist /Library/LaunchDaemons/com.b8.postgres.plist"
