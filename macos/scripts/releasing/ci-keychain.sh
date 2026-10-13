#!/bin/bash
# The release job's throwaway keychain, holding the Developer ID Application certificate for one run. CI only: it
# refuses to run unless CI=true, so it never touches a developer's own keychains.
#
#   ci-keychain.sh create       imports APPLE_CERTIFICATE_P12 (base64) with APPLE_CERTIFICATE_PASSWORD into
#                               $RUNNER_TEMP/pennant-signing.keychain-db; prints the keychain path and identity
#                               as PENNANT_SIGN_KEYCHAIN=… and PENNANT_SIGN_IDENTITY=… lines (for $GITHUB_ENV)
#   ci-keychain.sh notary       stores the notarization account (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
#                               in that keychain as a notarytool profile, checked with Apple first; prints
#                               PENNANT_NOTARY_PROFILE=… (for $GITHUB_ENV), so notarize.sh never puts the password on a
#                               command line
#   ci-keychain.sh delete       removes it and puts the search list back
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ "${CI:-}" = "true" ] || release_fail "ci-keychain.sh runs on CI only."
KEYCHAIN="${RUNNER_TEMP:?}/pennant-signing.keychain-db"
SAVED="${RUNNER_TEMP}/pennant-signing.search-list"
NOTARY_PROFILE="pennant-notary"

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
    if [ -z "${identity}" ]; then
      # Without -v the list keeps identities macOS does not trust, and why (a missing intermediate certificate shows as
      # CSSMERR_TP_NOT_TRUSTED); counts and reasons only, never a name
      all="$(/usr/bin/security find-identity -p codesigning "${KEYCHAIN}" || true)"
      echo "[keychain] $(grep -c ') [0-9A-F]\{40\} ' <<<"${all}" || true) code-signing identities in the p12, $(
        /usr/bin/security find-identity -v -p codesigning "${KEYCHAIN}" | grep -c ') [0-9A-F]\{40\} ' || true) valid" >&2
      sed -n 's/.*(\(CSSMERR_[A-Z_]*\)).*/[keychain] not valid: \1/p' <<<"${all}" | sort -u >&2
      release_fail "The certificate in APPLE_CERTIFICATE_P12 is not a valid Developer ID Application identity."
    fi
    echo "PENNANT_SIGN_KEYCHAIN=${KEYCHAIN}"
    echo "PENNANT_SIGN_IDENTITY=${identity}" ;;
  notary)
    for name in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
      [ -n "${!name:-}" ] || release_fail "Missing the repository secret ${name} (DEVELOPMENT.md, \"Releasing Pennant for Mac\")."
    done
    [ -f "${KEYCHAIN}" ] || release_fail "No signing keychain yet; run ci-keychain.sh create first."
    # notarytool's own output goes to the log, never to $GITHUB_ENV
    /usr/bin/xcrun notarytool store-credentials "${NOTARY_PROFILE}" --apple-id "${APPLE_ID}" --team-id "${APPLE_TEAM_ID}" \
      --password "${APPLE_APP_SPECIFIC_PASSWORD}" --keychain "${KEYCHAIN}" >&2 \
      || release_fail "Apple refused the notarization account. A 403 means the account holder must accept the latest Program License Agreement at developer.apple.com."
    echo "PENNANT_NOTARY_PROFILE=${NOTARY_PROFILE}" ;;
  delete)
    if [ -f "${SAVED}" ]; then
      # shellcheck disable=SC2046
      /usr/bin/security list-keychains -d user -s $(cat "${SAVED}") || true
    fi
    /usr/bin/security delete-keychain "${KEYCHAIN}" 2>/dev/null || true
    echo "[keychain] removed" ;;
  *) release_fail "ci-keychain.sh create|notary|delete" ;;
esac
