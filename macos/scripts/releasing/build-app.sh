#!/bin/bash
# Builds the Release configuration of Pennant.app, unsigned, with the staged server inside, into OUT_DIR:
#
#   build-app.sh OUT_DIR        writes OUT_DIR/Pennant.app and OUT_DIR/entitlements.tsv
#
# Signing is a separate step (sign-app.sh), so the identity never reaches Xcode and the same signing code runs on CI
# and in the local, ad-hoc dry run. The server must be staged first (npm ci && npm run mac:stage); the "Embed the
# server" phase fails, naming that command, when it is not. The version comes from package.json at build time (the
# embed phase sets the app's; this sets each extension's) and is checked before the script ends.
#
# entitlements.tsv maps each signed bundle Xcode builds (the app, and any app extension, such as the widgets) to the
# entitlements its target names (CODE_SIGN_ENTITLEMENTS), with the target's build settings filled in, so sign-app.sh
# signs each with its own. With APPLE_TEAM_ID set (CI), the build uses that team (DEVELOPMENT_TEAM), so the App Group
# in the Info.plist files and the entitlements carries the signing team's prefix.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OUT="${1:?an output folder}"
mkdir -p "${OUT}"
OUT="$(cd "${OUT}" && pwd)"
DERIVED="${OUT}/DerivedData"
PROJECT="${RELEASE_REPO_ROOT}/macos/Pennant.xcodeproj"
VERSION="$(release_version)"
# The team the release is signed by, so the App Group the app and its widget share carries its prefix
TEAM=(); if [ -n "${APPLE_TEAM_ID:-}" ]; then TEAM=("DEVELOPMENT_TEAM=${APPLE_TEAM_ID}"); fi

echo "[build] Pennant ${VERSION}, Release, unsigned"
LOG="${OUT}/xcodebuild.log"
if ! /usr/bin/xcodebuild -project "${PROJECT}" -scheme Pennant -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "${DERIVED}" -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO ${TEAM[@]+"${TEAM[@]}"} build >"${LOG}" 2>&1; then
  grep -E 'error:|BUILD FAILED' "${LOG}" | head -40 >&2
  release_fail "The Release build failed; the full log is ${LOG}"
fi

APP="${OUT}/Pennant.app"
rm -rf "${APP}"
/usr/bin/ditto "${DERIVED}/Build/Products/Release/Pennant.app" "${APP}"

# Each extension's version, from the same package.json (the embed phase set the app's)
while IFS= read -r -d '' plist; do
  for key in CFBundleShortVersionString CFBundleVersion; do
    /usr/libexec/PlistBuddy -c "Set :${key} ${VERSION}" "${plist}" 2>/dev/null \
      || /usr/libexec/PlistBuddy -c "Add :${key} string ${VERSION}" "${plist}"
  done
done < <(find "${APP}/Contents" -path '*/PlugIns/*.appex/Contents/Info.plist' -print0)
"$(dirname "$0")/version.sh" --check-app "${APP}"

# Each target's entitlements, with its build settings filled in (entitlements.mjs; no list to keep in step)
/usr/bin/xcodebuild -project "${PROJECT}" -scheme Pennant -configuration Release -showBuildSettings -json \
  ${TEAM[@]+"${TEAM[@]}"} 2>/dev/null \
  | node "$(dirname "$0")/entitlements.mjs" "${OUT}/entitlements" > "${OUT}/entitlements.tsv"
echo "[build] ${APP}"
