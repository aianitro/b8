#!/bin/sh
# Block until the system clock is plausible.
#
# The server's battery is dead, so a power cut also resets its clock — on 2026-09-16 it booted
# believing it was 31 December 2021. Anything that starts before network time corrects that writes
# the wrong date into the world: session rows, sync_log timestamps, and backup filenames — and the
# backup pruner deletes the OLDEST-named files first, so a backup stamped 2021 would be the first
# thing it threw away.
#
# "Plausible" is deliberately crude: a year at or after the one this was written in. Anything
# finer would need a trusted time source, which is exactly what is missing at this moment.
MIN_YEAR=2026
i=0
while [ "$(date +%Y)" -lt "$MIN_YEAR" ]; do
  [ $((i % 12)) -eq 0 ] && echo "wait-for-clock: clock says $(date), waiting for network time" >&2
  i=$((i + 1))
  sleep 5
done
