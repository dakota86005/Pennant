#!/bin/bash
# The Mac app's release version, derived from package.json (the one place the version lives, D-049).
#
#   version.sh                  prints the version (0.1.0)
#   version.sh --tag            prints the release tag (pennant-v0.1.0)
#   version.sh --check-tag T    fails unless T is pennant-v + package.json's version
#   version.sh --check-app A    fails unless app A (and each extension in it) carries that version as both
#                               CFBundleShortVersionString and CFBundleVersion
set -euo pipefail
source "$(dirname "$0")/lib.sh"

VERSION="$(release_version)"
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || release_fail "package.json's version '${VERSION}' is not plain X.Y.Z (DEVELOPMENT.md \"Versions\")."

case "${1:-}" in
  "") echo "${VERSION}" ;;
  --tag) echo "${RELEASE_TAG_PREFIX}${VERSION}" ;;
  --check-tag)
    [ "${2:-}" = "${RELEASE_TAG_PREFIX}${VERSION}" ] \
      || release_fail "Tag '${2:-}' does not match package.json (${RELEASE_TAG_PREFIX}${VERSION})." ;;
  --check-app)
    APP="${2:?an app bundle}"
    plists=("${APP}/Contents/Info.plist")
    while IFS= read -r -d '' p; do plists+=("${p}"); done \
      < <(find "${APP}/Contents" -path '*/PlugIns/*.appex/Contents/Info.plist' -print0 2>/dev/null)
    for plist in "${plists[@]}"; do
      for key in CFBundleShortVersionString CFBundleVersion; do
        got="$(/usr/libexec/PlistBuddy -c "Print :${key}" "${plist}" 2>/dev/null || true)"
        [ "${got}" = "${VERSION}" ] || release_fail "${plist#"${APP}/"} has ${key} '${got}', not ${VERSION}."
      done
    done
    echo "Version ${VERSION} in ${#plists[@]} Info.plist file(s)." ;;
  *) release_fail "Unknown option $1" ;;
esac
