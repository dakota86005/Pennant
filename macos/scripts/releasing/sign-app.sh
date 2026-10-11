#!/bin/bash
# Signs Pennant.app inside out (SWIFTUI_REBUILD.md section 5.2, D-076):
#
#   sign-app.sh APP IDENTITY [ENTITLEMENTS_TSV]
#
#   1. every Mach-O file under Contents/Resources (each .node of the server's node_modules);
#   2. the Node binary, Contents/Helpers/pennant-server, with only V8's two entitlements;
#   3. each framework's helpers (Sparkle's XPC services, Autoupdate and Updater.app), then the framework;
#   4. each app extension (the widgets), with its own target's entitlements;
#   5. the app last: hardened runtime, no JIT entitlements, no App Sandbox.
#
# Every item gets the hardened runtime. IDENTITY "-" signs ad hoc, without a timestamp (the local dry run and the
# tests); anything else is a Developer ID identity, signed with a secure timestamp. ENTITLEMENTS_TSV (build-app.sh)
# names each bundle's entitlements file; $(TeamIdentifierPrefix) in one becomes APPLE_TEAM_ID + ".". The script ends
# with codesign --verify --deep --strict and refuses an app whose own entitlements carry the sandbox, JIT or
# get-task-allow. PENNANT_SIGN_KEYCHAIN, when set, is the keychain codesign finds the identity in.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

APP="${1:?an app bundle}"
IDENTITY="${2:?a signing identity, or - for ad hoc}"
TSV="${3:-}"
CONTENTS="${APP}/Contents"
NODE_ENTITLEMENTS="${RELEASE_REPO_ROOT}/macos/Support/pennant-server.entitlements"
[ -d "${CONTENTS}" ] || release_fail "${APP} is not an app bundle."

ARGS=(--force --options runtime --sign "${IDENTITY}")
if [ "${IDENTITY}" = "-" ]; then ARGS+=(--timestamp=none); else ARGS+=(--timestamp); fi
if [ -n "${PENNANT_SIGN_KEYCHAIN:-}" ]; then ARGS+=(--keychain "${PENNANT_SIGN_KEYCHAIN}"); fi
SCRATCH="$(mktemp -d)"
trap 'rm -rf "${SCRATCH}"' EXIT

sign() {
  local target="$1" out; shift
  if [ "${target}" = "${APP}" ]; then echo "[sign] $(basename "${APP}")"; else echo "[sign] ${target#"${APP}/"}"; fi
  out="$(/usr/bin/codesign "${ARGS[@]}" "$@" "${target}" 2>&1)" || { echo "${out}" >&2; release_fail "codesign refused ${target}"; }
}

# ENT: the codesign arguments for a bundle's entitlements (its target's file, the team prefix filled in), or none.
# Set in this shell, never a subshell, so a missing file stops the script.
ENT=()
entitlements_for() {
  local name="$1" file="" team="${APPLE_TEAM_ID:-}"
  ENT=()
  if [ -n "${TSV}" ]; then file="$(awk -F '\t' -v n="${name}" '$1 == n { print $2 }' "${TSV}")"; fi
  [ -n "${file}" ] || return 0
  [ -f "${file}" ] || release_fail "${name}'s entitlements file ${file} is missing."
  if grep -q 'TeamIdentifierPrefix\|AppIdentifierPrefix' "${file}" && [ -z "${team}" ]; then
    [ "${IDENTITY}" = "-" ] || release_fail "${file} needs the team prefix; set APPLE_TEAM_ID."
    team="ADHOC"
  fi
  sed -e "s/\$(TeamIdentifierPrefix)/${team}./g" -e "s/\$(AppIdentifierPrefix)/${team}./g" \
    "${file}" > "${SCRATCH}/${name}.entitlements"
  ENT=(--entitlements "${SCRATCH}/${name}.entitlements")
}
is_macho() { /usr/bin/file -b "$1" | grep -q '^Mach-O'; }

# 1. Native code the server carries
if [ -d "${CONTENTS}/Resources" ]; then
  while IFS= read -r -d '' f; do
    if is_macho "${f}"; then sign "${f}"; fi
  done < <(find "${CONTENTS}/Resources" -type f \( -name '*.node' -o -name '*.dylib' -o -perm -u+x \) -print0 | sort -z)
fi

# 2. The Node binary
[ -x "${CONTENTS}/Helpers/pennant-server" ] || release_fail "The app has no server (Contents/Helpers/pennant-server)."
sign "${CONTENTS}/Helpers/pennant-server" --entitlements "${NODE_ENTITLEMENTS}"

# 3. Frameworks: their helpers first, keeping the entitlements their authors gave them (Sparkle's Downloader.xpc)
if [ -d "${CONTENTS}/Frameworks" ]; then
  while IFS= read -r -d '' fw; do
    if [ -d "${fw}/Versions/Current" ]; then
      current="${fw}/Versions/Current"
      main="$(basename "${fw}" .framework)"
      while IFS= read -r -d '' helper; do
        sign "${helper}" --preserve-metadata=entitlements
      done < <(find "${current}/" -mindepth 1 -maxdepth 2 \( -path '*/XPCServices/*.xpc' -o -name '*.app' \) -print0 | sort -z)
      while IFS= read -r -d '' exe; do
        if [ "$(basename "${exe}")" != "${main}" ] && is_macho "${exe}"; then
          sign "${exe}" --preserve-metadata=entitlements
        fi
      done < <(find "${current}/" -mindepth 1 -maxdepth 1 -type f -perm -u+x -print0 | sort -z)
    fi
    sign "${fw}" --preserve-metadata=entitlements
  done < <(find "${CONTENTS}/Frameworks" -mindepth 1 -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0 | sort -z)
fi

# 4. App extensions (the widgets)
if [ -d "${CONTENTS}/PlugIns" ]; then
  while IFS= read -r -d '' appex; do
    entitlements_for "$(basename "${appex}")"
    sign "${appex}" ${ENT[@]+"${ENT[@]}"}
  done < <(find "${CONTENTS}/PlugIns" -mindepth 1 -maxdepth 1 -name '*.appex' -print0 | sort -z)
fi

# 5. The app, last
entitlements_for "$(basename "${APP}")"
sign "${APP}" ${ENT[@]+"${ENT[@]}"}

own="$(/usr/bin/codesign -d --entitlements - --xml "${APP}" 2>/dev/null || true)"
for key in com.apple.security.app-sandbox com.apple.security.cs.allow-jit \
  com.apple.security.cs.allow-unsigned-executable-memory com.apple.security.get-task-allow; do
  if grep -q "${key}" <<<"${own}"; then release_fail "The app itself must not carry ${key} (section 5.2)."; fi
done
/usr/bin/codesign --verify --deep --strict "${APP}"
echo "[sign] verified: codesign --verify --deep --strict ${APP}"
