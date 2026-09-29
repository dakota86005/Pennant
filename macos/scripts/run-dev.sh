#!/bin/bash
# Runs a Debug build of Pennant for Mac on a scratch folder, as a GM would meet it (DEVELOPMENT.md "The SwiftUI
# rebuild"):
#
#   macos/scripts/run-dev.sh <scratch folder> [path to the Debug Pennant.app]
#
#   1. writes the synthetic league and its CSV export into <scratch>/league (npm run synthetic:league), once;
#   2. makes a pretend home, <scratch>/home, holding one pretend OOTP 27 save that exports that league, last played an
#      hour ago, so the server finds saves there and nowhere else: a Debug build finds and chooses a save by itself only
#      with a pretend home (PENNANT_DEV_HOME), so it never imports the developer's own saves;
#   3. launches the app by its path (never through LaunchServices, which may open another worktree's build) with its
#      data folder, log, caches and home all inside <scratch>.
#
# The first launch finds the pretend save and sets up by itself; later launches open on the report kept last. Quit the
# app normally. Nothing outside <scratch> is written. The app path defaults to the scheme's own DerivedData build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="${1:?usage: macos/scripts/run-dev.sh <scratch folder> [Pennant.app]}"
case "$SCRATCH" in
  "$HOME/Library/Application Support"*|"$ROOT/data"*) echo "run-dev: $SCRATCH looks like a real data folder; give it a scratch folder" >&2; exit 1 ;;
esac
mkdir -p "$SCRATCH"
SCRATCH="$(cd "$SCRATCH" && pwd)"
APP="${2:-}"
if [ -z "$APP" ]; then
  # This checkout's own DerivedData (each worktree has its own; another's build is never launched)
  for dd in "$HOME"/Library/Developer/Xcode/DerivedData/Pennant-*; do
    if [ -f "$dd/info.plist" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print :WorkspacePath' "$dd/info.plist" 2>/dev/null)" = "$ROOT/macos/Pennant.xcodeproj" ]; then
      APP="$dd/Build/Products/Debug/Pennant.app"
    fi
  done
fi
[ -x "$APP/Contents/MacOS/Pennant" ] || { echo "run-dev: no Debug Pennant.app at '$APP'; build the Pennant scheme, or pass its path" >&2; exit 1; }

if [ ! -f "$SCRATCH/league/league.db" ]; then
  (cd "$ROOT" && npm run --silent synthetic:league -- "$SCRATCH/league" > /dev/null)
fi

# The pretend save, where OOTP 27 (direct download) keeps saves, played an hour ago, with its export switched on
LG="$SCRATCH/home/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Synthetic League.lg"
if [ ! -d "$LG" ]; then
  mkdir -p "$LG/import_export/csv" "$LG/settings"
  cp -p "$SCRATCH/league/export/"*.csv "$LG/import_export/csv/"
  printf 'Show real player ratings,1\n' > "$LG/settings/db_dump_standard_csv.cfg"
  at="$(date -v-1H +%Y%m%d%H%M.%S)"
  for f in players.dat flag_save_completed.dat; do echo x > "$LG/$f"; touch -t "$at" "$LG/$f"; done
fi

mkdir -p "$SCRATCH/data"
PENNANT_DEV_DATA_DIR="$SCRATCH/data" \
PENNANT_DEV_HOME="$SCRATCH/home" \
PENNANT_DEV_LOG_DIR="$SCRATCH/logs" \
PENNANT_DEV_CACHES_DIR="$SCRATCH/caches" \
  exec "$APP/Contents/MacOS/Pennant"
