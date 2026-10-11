#!/bin/bash
# Writes the appcast Sparkle reads, for one notarized DMG, with Sparkle's own generate_appcast (the pinned release):
#
#   make-appcast.sh DMG NOTES_MD OUT_DIR       writes OUT_DIR/appcast.xml
#
# The DMG is signed with the owner's EdDSA private key, read from SPARKLE_ED_PRIVATE_KEY and handed over on standard
# input (never a file, never an argument). NOTES_MD is the GitHub release's body, embedded as Markdown release notes
# (Sparkle 2.9+); an empty one gives an update with no notes. The enclosure points at the asset on the release
# tagged pennant-v<version>; the feed itself is served from releases/latest/download/appcast.xml (lib.sh).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DMG="${1:?a DMG}"
NOTES="${2:?a release notes file (may be empty)}"
OUT="${3:?an output folder}"
"$(dirname "$0")/check-secrets.sh" appcast
VERSION="$(release_version)"
TAG="${RELEASE_TAG_PREFIX}${VERSION}"
[ "$(basename "${DMG}")" = "$(release_dmg_name "${VERSION}")" ] \
  || release_fail "$(basename "${DMG}") is not this version's DMG ($(release_dmg_name "${VERSION}"))."

TOOLS="$("$(dirname "$0")/fetch-sparkle-tools.sh")"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
cp "${DMG}" "${WORK}/"
if [ -s "${NOTES}" ]; then cp "${NOTES}" "${WORK}/$(basename "${DMG}" .dmg).md"; fi

mkdir -p "${OUT}"
printf '%s' "${SPARKLE_ED_PRIVATE_KEY}" | "${TOOLS}/bin/generate_appcast" --ed-key-file - \
  --download-url-prefix "https://github.com/${RELEASE_GITHUB_REPO}/releases/download/${TAG}/" \
  --link "https://github.com/${RELEASE_GITHUB_REPO}/releases/tag/${TAG}" \
  --embed-release-notes -o "${OUT}/appcast.xml" "${WORK}"

# What a client needs, or the release is not finished
for want in "sparkle:edSignature=" "<sparkle:version>${VERSION}</sparkle:version>" \
  "releases/download/${TAG}/$(basename "${DMG}")"; do
  grep -qF "${want}" "${OUT}/appcast.xml" || release_fail "appcast.xml lacks ${want}"
done
echo "[appcast] ${OUT}/appcast.xml (${TAG})"
