#!/bin/bash
# The Pennant target's "Embed the server" build phase (SWIFTUI_REBUILD.md section 5.2). It:
#   1. sets the app's version from package.json, the one place the version lives;
#   2. copies the staged server (npm run mac:stage → build/macos-server/) into Contents/Helpers and
#      Contents/Resources/server, failing with the command to run when it is missing or stale: another version, a
#      server source newer than its bundle, or a stage whose content stamp (stage-stamp.sh: build/sidecar/,
#      package-lock.json, the Node version) differs from the current inputs;
#   3. when the build signs, signs the server's native code inside out: each .node, then the Node binary with
#      the hardened runtime and only V8's two entitlements. Xcode signs the app itself last.
#
# PENNANT_SKIP_SERVER=YES (a build setting, used by CI) builds an app without the server; it starts, and says the
# server is missing. Every other build needs the staged server.
set -euo pipefail

REPO="${SRCROOT}/.."
STAGE="${REPO}/build/macos-server"
CONTENTS="${TARGET_BUILD_DIR}/${CONTENTS_FOLDER_PATH}"
PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"

# 1. The version, read from package.json (plutil reads JSON)
VERSION="$(/usr/bin/plutil -extract version raw -o - "${REPO}/package.json")"
for key in CFBundleShortVersionString CFBundleVersion; do
  /usr/libexec/PlistBuddy -c "Set :${key} ${VERSION}" "${PLIST}" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :${key} string ${VERSION}" "${PLIST}"
done

# 1b. Sparkle's feed and public key (D-076), in Release builds only, so a Debug build never checks for updates. The
# public key is the owner's (macos/Support/sparkle-public-key.txt, DEVELOPMENT.md "Releasing Pennant for Mac"); until
# it is committed a Release build has none, and the release workflow refuses to sign such an app.
if [ "${CONFIGURATION:-}" = "Release" ]; then
  source "${SRCROOT}/scripts/releasing/lib.sh"
  set_plist() {
    /usr/libexec/PlistBuddy -c "Set :$1 $2" "${PLIST}" 2>/dev/null \
      || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "${PLIST}"
  }
  set_plist SUFeedURL "${RELEASE_FEED_URL}"
  PUBLIC_KEY="$(tr -d '[:space:]' < "${RELEASE_PUBLIC_KEY_FILE}" 2>/dev/null || true)"
  if [[ "${PUBLIC_KEY}" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    set_plist SUPublicEDKey "${PUBLIC_KEY}"
  else
    echo "warning: No Sparkle public key in macos/Support/sparkle-public-key.txt: this build cannot check for updates."
  fi
fi

# 2. The server
if [ "${PENNANT_SKIP_SERVER:-NO}" = "YES" ]; then
  echo "warning: PENNANT_SKIP_SERVER=YES: this app has no server inside and will say so when it starts."
  rm -rf "${CONTENTS}/Helpers/pennant-server" "${CONTENTS}/Resources/server"
  exit 0
fi
if [ ! -x "${STAGE}/Helpers/pennant-server" ] || [ ! -f "${STAGE}/Resources/server/server.cjs" ] \
  || [ ! -d "${STAGE}/Resources/server/node_modules/better-sqlite3" ]; then
  echo "error: The server is not staged for the app bundle (build/macos-server/ is missing or incomplete). From the repository root run: npm ci && npm run mac:stage   (it runs npm run build:sidecar and npm run sidecar:node, then stages the server). To build without the server, set PENNANT_SKIP_SERVER=YES."
  exit 1
fi
STAGED_VERSION="$(/usr/bin/plutil -extract version raw -o - "${STAGE}/Resources/server/package.json")"
if [ "${STAGED_VERSION}" != "${VERSION}" ]; then
  echo "error: The staged server is version ${STAGED_VERSION} but package.json says ${VERSION}. Run: npm run mac:stage"
  exit 1
fi
# Stale: the server source is newer than its bundle, or the stage was not made from the current bundle, lockfile
# and Node (a content stamp, stage-stamp.sh)
if [ -n "$(find "${REPO}/server" -name '*.ts' -newer "${REPO}/build/sidecar/server.cjs" -print -quit 2>/dev/null)" ]; then
  echo "error: The server's source has changed since it was bundled for the app. Run: npm run mac:stage"
  exit 1
fi
EXPECTED_STAMP="$("${SRCROOT}/scripts/stage-stamp.sh" "${REPO}" 2>/dev/null || true)"
if [ ! -f "${STAGE}/.stamp" ] || [ -z "${EXPECTED_STAMP}" ] || [ "$(cat "${STAGE}/.stamp")" != "${EXPECTED_STAMP}" ]; then
  echo "error: The staged server does not match build/sidecar/, package-lock.json and the pinned Node. Run: npm run mac:stage"
  exit 1
fi

mkdir -p "${CONTENTS}/Helpers" "${CONTENTS}/Resources/server"
/usr/bin/rsync -a --delete "${STAGE}/Resources/server/" "${CONTENTS}/Resources/server/"
/bin/cp -p "${STAGE}/Helpers/pennant-server" "${CONTENTS}/Helpers/pennant-server"

# 3. Inside-out signing, when this build signs
if [ "${CODE_SIGNING_ALLOWED:-NO}" = "YES" ] && [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then
  IDENTITY="${EXPANDED_CODE_SIGN_IDENTITY}"
  RUNTIME=(--options runtime)
  # An ad-hoc identity has no team for library validation to match, so it runs without the hardened runtime
  if [ "${IDENTITY}" = "-" ]; then RUNTIME=(); fi
  find "${CONTENTS}/Resources/server/node_modules" -type f -name '*.node' -print0 \
    | xargs -0 -n 1 /usr/bin/codesign --force --timestamp=none --sign "${IDENTITY}" ${RUNTIME[@]+"${RUNTIME[@]}"}
  /usr/bin/codesign --force --timestamp=none --sign "${IDENTITY}" ${RUNTIME[@]+"${RUNTIME[@]}"} \
    --entitlements "${SRCROOT}/Support/pennant-server.entitlements" "${CONTENTS}/Helpers/pennant-server"
fi
echo "Embedded the server (version ${VERSION})."
