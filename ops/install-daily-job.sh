#!/bin/sh
# Installs the daily job as a launchd agent and hands the schedule to the OS.
#
# Reversible in one command, printed at the end. Run from the repo root.
set -eu

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
LABEL=com.b8.daily-job
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__APP_DIR__|$APP_DIR|g" "$APP_DIR/ops/$LABEL.plist" > "$TARGET"

# bootout first so re-running this is safe; it fails when nothing is loaded, which is fine.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"

echo "installed: $TARGET"
echo "runs:      06:00 daily, while logged in"
echo "log:       $APP_DIR/ops/daily-job.log"
echo
echo "IMPORTANT — turn the in-process timer off, or the job runs twice:"
echo "  echo 'SCHEDULER_IN_PROCESS=false' >> $APP_DIR/.env.local"
echo "  then restart the dev server"
echo
echo "to remove:  launchctl bootout gui/$(id -u)/$LABEL && rm $TARGET"
