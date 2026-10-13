#!/bin/bash
# Packs a (signed, stapled) Pennant.app into a compressed DMG with hdiutil, the system's own tool:
#
#   make-dmg.sh APP OUT_DMG [IDENTITY]
#
# The volume holds the app and a link to /Applications, so installing is one drag. With a Developer ID IDENTITY the
# DMG itself is signed too (notarize.sh then notarizes and staples it); "-" or none leaves it unsigned (the dry run).
# A designed window (background picture, icon positions) would need a further tool, which is not approved.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

APP="${1:?an app bundle}"
DMG="${2:?an output .dmg path}"
IDENTITY="${3:--}"
[ -d "${APP}/Contents" ] || release_fail "${APP} is not an app bundle."

ROOT="$(mktemp -d)"
LOG="$(mktemp)"
trap 'rm -rf "${ROOT}" "${LOG}"' EXIT
/usr/bin/ditto "${APP}" "${ROOT}/$(basename "${APP}")"
ln -s /Applications "${ROOT}/Applications"

# hdiutil's chatter is kept out of the log, but never its error: a failure prints everything it said
hdiutil_loud_on_failure() {
  if ! /usr/bin/hdiutil "$@" >"${LOG}" 2>&1; then
    cat "${LOG}" >&2
    release_fail "hdiutil $1 failed for ${DMG}."
  fi
}

# The output's folder may not exist yet (a fresh CI checkout has no build/mac-release/unsigned/)
mkdir -p "$(dirname "${DMG}")"
rm -f "${DMG}"
hdiutil_loud_on_failure create -volname "Pennant" -srcfolder "${ROOT}" -fs APFS -format UDZO -ov "${DMG}"
if [ "${IDENTITY}" != "-" ]; then
  KEYCHAIN=(); if [ -n "${PENNANT_SIGN_KEYCHAIN:-}" ]; then KEYCHAIN=(--keychain "${PENNANT_SIGN_KEYCHAIN}"); fi
  /usr/bin/codesign --force --timestamp --sign "${IDENTITY}" ${KEYCHAIN[@]+"${KEYCHAIN[@]}"} "${DMG}"
fi
hdiutil_loud_on_failure verify "${DMG}"
echo "[dmg] ${DMG} ($(du -h "${DMG}" | cut -f1))"
