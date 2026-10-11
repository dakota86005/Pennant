#!/bin/bash
# Shared by the Mac app's release scripts (macos/scripts/releasing/, DEVELOPMENT.md "Releasing Pennant for Mac", D-076).
# Sourced, never run. Holds the few facts every step agrees on; the version is read from package.json, never kept here.

RELEASE_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# The release tag prefix (D-049; server/project.ts RELEASE_TAG_PREFIX, a test keeps them in agreement)
RELEASE_TAG_PREFIX="pennant-v"
# Pennant's repository (origin), where releases, the DMG and the appcast live (server/project.ts)
RELEASE_GITHUB_REPO="dakota86005/Pennant"
# The appcast Sparkle reads: always the newest published release's asset, so the URL never changes
RELEASE_FEED_URL="https://github.com/${RELEASE_GITHUB_REPO}/releases/latest/download/appcast.xml"
# The public half of the owner's Sparkle EdDSA key pair (one-time setup, DEVELOPMENT.md); not a secret
RELEASE_PUBLIC_KEY_FILE="${RELEASE_REPO_ROOT}/macos/Support/sparkle-public-key.txt"
# The DMG's name. Spaces are refused by the publish step; the Electron app's DMG is Pennant-<version>-<arch>.dmg,
# so the native app's needs its own name until the N15 cutover.
release_dmg_name() { echo "Pennant-for-Mac-$1.dmg"; }

# The one version, from package.json (plutil reads JSON)
release_version() {
  /usr/bin/plutil -extract version raw -o - "${RELEASE_REPO_ROOT}/package.json"
}

release_fail() { echo "error: $*" >&2; exit 1; }
