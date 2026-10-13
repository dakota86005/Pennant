#!/bin/bash
# Notarizes a signed Pennant.app or DMG with notarytool and staples the ticket to it (SWIFTUI_REBUILD.md section 5.2):
#
#   notarize.sh PATH            PATH is an .app (sent as a zip) or a .dmg
#
# Signs in with a notarytool keychain profile, never a password on the command line: PENNANT_NOTARY_PROFILE names it,
# and PENNANT_SIGN_KEYCHAIN, when set, is the keychain holding it (on CI, `ci-keychain.sh notary` stores APPLE_ID,
# APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID there; DEVELOPMENT.md "Releasing Pennant for Mac"). Fails, naming
# what is missing, without one. A rejection prints Apple's log and fails.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

TARGET="${1:?an .app or .dmg}"
[ -n "${PENNANT_NOTARY_PROFILE:-}" ] || release_fail "Cannot notarize: no PENNANT_NOTARY_PROFILE, the stored \
APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID (ci-keychain.sh notary; DEVELOPMENT.md, \"Releasing Pennant for Mac\")."

SCRATCH="$(mktemp -d)"
trap 'rm -rf "${SCRATCH}"' EXIT
case "${TARGET}" in
  *.app) SUBMIT="${SCRATCH}/$(basename "${TARGET}" .app).zip"; /usr/bin/ditto -c -k --keepParent "${TARGET}" "${SUBMIT}" ;;
  *.dmg) SUBMIT="${TARGET}" ;;
  *) release_fail "notarize.sh takes an .app or a .dmg, not ${TARGET}" ;;
esac

AUTH=(--keychain-profile "${PENNANT_NOTARY_PROFILE}")
if [ -n "${PENNANT_SIGN_KEYCHAIN:-}" ]; then AUTH+=(--keychain "${PENNANT_SIGN_KEYCHAIN}"); fi
echo "[notarize] submitting $(basename "${TARGET}") and waiting for Apple"
/usr/bin/xcrun notarytool submit "${SUBMIT}" "${AUTH[@]}" --wait --timeout 45m --output-format json \
  > "${SCRATCH}/result.json" || true
status="$(/usr/bin/plutil -extract status raw -o - "${SCRATCH}/result.json" 2>/dev/null || echo unknown)"
id="$(/usr/bin/plutil -extract id raw -o - "${SCRATCH}/result.json" 2>/dev/null || true)"
if [ "${status}" != "Accepted" ]; then
  cat "${SCRATCH}/result.json" >&2 || true
  if [ -n "${id}" ]; then /usr/bin/xcrun notarytool log "${id}" "${AUTH[@]}" >&2 || true; fi
  release_fail "Notarization of $(basename "${TARGET}") ended '${status}'. A 403 means the account holder must accept the latest Program License Agreement at developer.apple.com."
fi

/usr/bin/xcrun stapler staple "${TARGET}"
/usr/bin/xcrun stapler validate "${TARGET}"
echo "[notarize] $(basename "${TARGET}") notarized (${id}) and stapled"
