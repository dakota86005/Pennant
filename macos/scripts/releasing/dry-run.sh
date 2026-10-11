#!/bin/bash
# The release pipeline without the owner's secrets, on any Mac: builds the Release app, signs it inside out ad hoc,
# and packs the DMG, into OUT_DIR. Nothing is notarized, published or launched, and no keychain is read.
#
#   npm ci && npm run mac:stage
#   macos/scripts/releasing/dry-run.sh OUT_DIR
#
# The ad-hoc app is for inspection (codesign -dvv, the DMG's layout), not for running: with the hardened runtime and
# no team, macOS would refuse to load the server's native module.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OUT="${1:?an output folder (a scratch folder)}"
HERE="$(dirname "$0")"
VERSION="$(release_version)"
"${HERE}/build-app.sh" "${OUT}"
"${HERE}/sign-app.sh" "${OUT}/Pennant.app" - "${OUT}/entitlements.tsv"
"${HERE}/make-dmg.sh" "${OUT}/Pennant.app" "${OUT}/$(release_dmg_name "${VERSION}")" -
echo "[dry run] ${OUT}/$(release_dmg_name "${VERSION}") (ad hoc, not notarized)"
