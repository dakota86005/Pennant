#!/bin/bash
# Says, before anything is signed, which of the release's inputs are missing, and fails naming every one:
#
#   check-secrets.sh sign       the Developer ID certificate and the notarization account
#   check-secrets.sh appcast    the Sparkle private key
#
# Both need the Sparkle public key committed in macos/Support/sparkle-public-key.txt: a signed app seals the key its
# Info.plist carries, and an app without one could never check an update.
#
# The owner's one-time setup (DEVELOPMENT.md, "Releasing Pennant for Mac") makes them. Nothing here prints a value.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

case "${1:-}" in
  sign) names=(APPLE_CERTIFICATE_P12 APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID)
    what="signed and notarized" ;;
  appcast) names=(SPARKLE_ED_PRIVATE_KEY); what="given an appcast" ;;
  *) release_fail "check-secrets.sh sign|appcast" ;;
esac
missing=()
for name in "${names[@]}"; do
  [ -n "${!name:-}" ] || missing+=("${name}")
done
problems=()
[ ${#missing[@]} -eq 0 ] || problems+=("the repository secrets ${missing[*]}")
if ! grep -Eq '^[A-Za-z0-9+/]{43}=$' "${RELEASE_PUBLIC_KEY_FILE}" 2>/dev/null; then
  problems+=("Sparkle's public key in macos/Support/sparkle-public-key.txt")
fi
if [ ${#problems[@]} -gt 0 ]; then
  for p in "${problems[@]}"; do echo "::error::Missing ${p}." >&2; done
  release_fail "Pennant for Mac cannot be ${what} without them; the one-time setup is in DEVELOPMENT.md, \"Releasing Pennant for Mac\"."
fi
echo "[secrets] ${1}: everything is present"
