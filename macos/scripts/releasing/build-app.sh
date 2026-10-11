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
# entitlements file its target names (CODE_SIGN_ENTITLEMENTS), so sign-app.sh signs each with its own.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OUT="${1:?an output folder}"
mkdir -p "${OUT}"
OUT="$(cd "${OUT}" && pwd)"
DERIVED="${OUT}/DerivedData"
PROJECT="${RELEASE_REPO_ROOT}/macos/Pennant.xcodeproj"
VERSION="$(release_version)"

echo "[build] Pennant ${VERSION}, Release, unsigned"
LOG="${OUT}/xcodebuild.log"
if ! /usr/bin/xcodebuild -project "${PROJECT}" -scheme Pennant -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "${DERIVED}" -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO build >"${LOG}" 2>&1; then
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

# Each target's entitlements file, read from the project's own settings (no list to keep in step)
/usr/bin/xcodebuild -project "${PROJECT}" -scheme Pennant -configuration Release -showBuildSettings -json 2>/dev/null \
  | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        for (const { buildSettings: b } of JSON.parse(s)) {
          if (!["app", "appex"].includes(b.WRAPPER_EXTENSION)) continue;
          const c = b.CODE_SIGN_ENTITLEMENTS || "";
          const e = !c || c.startsWith("/") ? c : `${b.SRCROOT}/${c}`;
          console.log(`${b.FULL_PRODUCT_NAME}\t${e}`);
        }
      });' > "${OUT}/entitlements.tsv"
echo "[build] ${APP}"
