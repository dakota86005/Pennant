#!/bin/bash
# Notarizes a signed Pennant.app or DMG with notarytool and staples the ticket to it (SWIFTUI_REBUILD.md section 5.2):
#
#   notarize.sh PATH            PATH is an .app (sent as a zip) or a .dmg
#
# Needs APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (the owner's one-time setup, DEVELOPMENT.md
# "Releasing Pennant for Mac"); fails naming any that is missing. A rejection prints Apple's log and fails.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

TARGET="${1:?an .app or .dmg}"
missing=()
for name in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!name:-}" ] || missing+=("${name}")
done
[ ${#missing[@]} -eq 0 ] || release_fail "Cannot notarize: missing ${missing[*]} (DEVELOPMENT.md, \"Releasing Pennant for Mac\")."

SCRATCH="$(mktemp -d)"
trap 'rm -rf "${SCRATCH}"' EXIT
case "${TARGET}" in
  *.app) SUBMIT="${SCRATCH}/$(basename "${TARGET}" .app).zip"; /usr/bin/ditto -c -k --keepParent "${TARGET}" "${SUBMIT}" ;;
  *.dmg) SUBMIT="${TARGET}" ;;
  *) release_fail "notarize.sh takes an .app or a .dmg, not ${TARGET}" ;;
esac

AUTH=(--apple-id "${APPLE_ID}" --password "${APPLE_APP_SPECIFIC_PASSWORD}" --team-id "${APPLE_TEAM_ID}")
echo "[notarize] submitting $(basename "${TARGET}") and waiting for Apple"
/usr/bin/xcrun notarytool submit "${SUBMIT}" "${AUTH[@]}" --wait --timeout 45m --output-format json \
  > "${SCRATCH}/result.json" || true
status="$(/usr/bin/plutil -extract status raw -o - "${SCRATCH}/result.json" 2>/dev/null || echo unknown)"
id="$(/usr/bin/plutil -extract id raw -o - "${SCRATCH}/result.json" 2>/dev/null || true)"
if [ "${status}" != "Accepted" ]; then
  cat "${SCRATCH}/result.json" >&2 || true
  if [ -n "${id}" ]; then /usr/bin/xcrun notarytool log "${id}" "${AUTH[@]}" >&2 || true; fi
  release_fail "Notarization of $(basename "${TARGET}") ended '${status}'."
fi

/usr/bin/xcrun stapler staple "${TARGET}"
/usr/bin/xcrun stapler validate "${TARGET}"
echo "[notarize] $(basename "${TARGET}") notarized (${id}) and stapled"
