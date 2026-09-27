#!/bin/bash
# Prints the content stamp of what the server stage is built from (SWIFTUI_REBUILD.md section 5.2): the sidecar
# bundle (build/sidecar/), package-lock.json and the pinned Node's version. stage-server.sh writes it into the stage;
# embed-server.sh recomputes it and refuses a stage whose stamp differs.
#
#   macos/scripts/stage-stamp.sh <repository root>
set -euo pipefail
ROOT="$1"
node_version="$("$ROOT/build/node-runtime/pennant-server" --version)"
{
  cat "$ROOT/build/sidecar/server.cjs" "$ROOT/build/sidecar/value-refit-worker.cjs" \
    "$ROOT/build/sidecar/calibration-refit-worker.cjs" "$ROOT/build/sidecar/front-office-worker.cjs" \
    "$ROOT/build/sidecar/package.json" "$ROOT/package-lock.json"
  echo "$node_version"
} | shasum -a 256 | cut -c1-64
