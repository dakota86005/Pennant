#!/bin/bash
# The release job's throwaway keychain, holding the Developer ID Application certificate for one run. CI only: it
# refuses to run unless CI=true, so it never touches a developer's own keychains.
#
#   ci-keychain.sh create       imports APPLE_CERTIFICATE_P12 (base64) with APPLE_CERTIFICATE_PASSWORD into
#                               $RUNNER_TEMP/pennant-signing.keychain-db; prints the keychain path and identity
#                               as PENNANT_SIGN_KEYCHAIN=… and PENNANT_SIGN_IDENTITY=… lines (for $GITHUB_ENV)
#   ci-keychain.sh delete       removes it and puts the search list back
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ "${CI:-}" = "true" ] || release_fail "ci-keychain.sh runs on CI only."
KEYCHAIN="${RUNNER_TEMP:?}/pennant-signing.keychain-db"
SAVED="${RUNNER_TEMP}/pennant-signing.search-list"

case "${1:-}" in
  create)
    for name in APPLE_CERTIFICATE_P12 APPLE_CERTIFICATE_PASSWORD; do
      [ -n "${!name:-}" ] || release_fail "Missing the repository secret ${name} (DEVELOPMENT.md, \"Releasing Pennant for Mac\")."
    done
    pass="$(/usr/bin/openssl rand -hex 24)"
    p12="${RUNNER_TEMP}/pennant-signing.p12"
    trap 'rm -f "${p12}"' EXIT
    printf '%s' "${APPLE_CERTIFICATE_P12}" | /usr/bin/base64 --decode > "${p12}"
    /usr/bin/security list-keychains -d user | tr -d '"' | awk '{$1=$1};1' > "${SAVED}"
    /usr/bin/security create-keychain -p "${pass}" "${KEYCHAIN}"
    /usr/bin/security set-keychain-settings -lut 21600 "${KEYCHAIN}"
    /usr/bin/security unlock-keychain -p "${pass}" "${KEYCHAIN}"
    /usr/bin/security import "${p12}" -k "${KEYCHAIN}" -P "${APPLE_CERTIFICATE_PASSWORD}" -f pkcs12 \
      -T /usr/bin/codesign -T /usr/bin/security >/dev/null
    /usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k "${pass}" "${KEYCHAIN}" >/dev/null
    # shellcheck disable=SC2046
    /usr/bin/security list-keychains -d user -s "${KEYCHAIN}" $(cat "${SAVED}")
    identity="$(/usr/bin/security find-identity -v -p codesigning "${KEYCHAIN}" \
      | awk -F'"' '/Developer ID Application/ { print $2; exit }')"
    [ -n "${identity}" ] || release_fail "The certificate in APPLE_CERTIFICATE_P12 is not a Developer ID Application identity."
    echo "PENNANT_SIGN_KEYCHAIN=${KEYCHAIN}"
    echo "PENNANT_SIGN_IDENTITY=${identity}" ;;
  delete)
    if [ -f "${SAVED}" ]; then
      # shellcheck disable=SC2046
      /usr/bin/security list-keychains -d user -s $(cat "${SAVED}") || true
    fi
    /usr/bin/security delete-keychain "${KEYCHAIN}" 2>/dev/null || true
    echo "[keychain] removed" ;;
  *) release_fail "ci-keychain.sh create|delete" ;;
esac
