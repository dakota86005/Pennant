#!/bin/bash
# Refuses an app that could never update itself (D-076). A release without a working updater strands every copy
# installed from it, because only an update could fix that. Asserts, on the built app:
#
#   check-updater.sh APP
#
#   1. Sparkle is inside it (Contents/Frameworks/Sparkle.framework);
#   2. its Info.plist's SUFeedURL is the feed the appcast is published at (lib.sh, RELEASE_FEED_URL);
#   3. its SUPublicEDKey is the committed public key (macos/Support/sparkle-public-key.txt), so it accepts updates
#      signed with the owner's private key and no other.
#
# Fails naming every problem. Nothing here reads a secret.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

APP="${1:?an app bundle}"
PLIST="${APP}/Contents/Info.plist"
[ -f "${PLIST}" ] || release_fail "${APP} has no Contents/Info.plist."
read_plist() { /usr/libexec/PlistBuddy -c "Print :$1" "${PLIST}" 2>/dev/null || true; }

problems=()
if [ ! -d "${APP}/Contents/Frameworks/Sparkle.framework" ]; then
  problems+=("Sparkle isn't in the app yet: Contents/Frameworks/Sparkle.framework is missing.")
fi
feed="$(read_plist SUFeedURL)"
if [ "${feed}" != "${RELEASE_FEED_URL}" ]; then
  problems+=("SUFeedURL is '${feed}', not ${RELEASE_FEED_URL}.")
fi
if key="$(release_public_key)"; then
  got="$(read_plist SUPublicEDKey)"
  [ "${got}" = "${key}" ] \
    || problems+=("SUPublicEDKey is '${got}', not the committed key in macos/Support/sparkle-public-key.txt.")
else
  problems+=("macos/Support/sparkle-public-key.txt holds no valid public key.")
fi

if [ ${#problems[@]} -gt 0 ]; then
  for p in "${problems[@]}"; do echo "::error::${p}" >&2; done
  release_fail "$(basename "${APP}") could never update itself; it is not released."
fi
echo "[updater] $(basename "${APP}"): Sparkle, the feed ${RELEASE_FEED_URL} and the committed key"
