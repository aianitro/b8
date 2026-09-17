#!/bin/sh
# Installs b8's Postgres and web server as boot-time services. Run once, with sudo, on the server.
#
#   sudo ~/b8/ops/server/install.sh
#
# Reversible: the removal commands are printed at the end.
set -eu
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }

USER_NAME="${SUDO_USER:?run via sudo from the account that owns ~/b8}"
USER_HOME=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | awk '{print $2}')
APP="$USER_HOME/b8"

sudo -u "$USER_NAME" mkdir -p "$USER_HOME/b8-logs"

for svc in postgres web; do
  target="/Library/LaunchDaemons/com.b8.$svc.plist"
  sed -e "s|__USER__|$USER_NAME|g" -e "s|__HOME__|$USER_HOME|g" -e "s|__APP__|$APP|g" \
    "$APP/ops/server/com.b8.$svc.plist" > "$target"
  chown root:wheel "$target"; chmod 644 "$target"
  launchctl bootout "system/com.b8.$svc" 2>/dev/null || true
  launchctl bootstrap system "$target"
  echo "started com.b8.$svc"
done

echo
echo "logs:   $USER_HOME/b8-logs/"
echo "remove: sudo launchctl bootout system/com.b8.web; sudo launchctl bootout system/com.b8.postgres"
echo "        sudo rm /Library/LaunchDaemons/com.b8.web.plist /Library/LaunchDaemons/com.b8.postgres.plist"
