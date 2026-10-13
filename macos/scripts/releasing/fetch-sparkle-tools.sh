#!/bin/bash
# Fetches Sparkle's release tools (generate_appcast, sign_update), pinned by version and SHA-256 like the Node runtime
# (scripts/fetch-node-runtime.mjs):
#
#   fetch-sparkle-tools.sh      prints the folder holding bin/generate_appcast
#
# The archive is the one Sparkle published for this version, checked against the SHA-256 GitHub records for that
# asset (read 2026-10-10) before anything is extracted. The app links the same Sparkle version through Swift Package
# Manager, pinned exactly; moving to a newer 2.x changes both, and this checksum, together. Cached in
# build/sparkle-tools/, so a second run is offline.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SPARKLE_VERSION="2.10.0"
SPARKLE_SHA256="c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c"
ARCHIVE_NAME="Sparkle-${SPARKLE_VERSION}.tar.xz"
URL="https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/${ARCHIVE_NAME}"

DIR="${RELEASE_REPO_ROOT}/build/sparkle-tools"
ARCHIVE="${DIR}/${ARCHIVE_NAME}"
TOOLS="${DIR}/${SPARKLE_VERSION}"
mkdir -p "${DIR}"
sha() { /usr/bin/shasum -a 256 "$1" | cut -d' ' -f1; }

if [ ! -f "${ARCHIVE}" ] || [ "$(sha "${ARCHIVE}")" != "${SPARKLE_SHA256}" ]; then
  echo "[sparkle] downloading ${URL}" >&2
  /usr/bin/curl --fail --silent --show-error --location --output "${ARCHIVE}" "${URL}"
fi
actual="$(sha "${ARCHIVE}")"
if [ "${actual}" != "${SPARKLE_SHA256}" ]; then
  rm -f "${ARCHIVE}"
  release_fail "${ARCHIVE_NAME} has SHA-256 ${actual}, not the pinned ${SPARKLE_SHA256}. Nothing was extracted."
fi
if [ ! -x "${TOOLS}/bin/generate_appcast" ]; then
  rm -rf "${TOOLS}"; mkdir -p "${TOOLS}"
  /usr/bin/tar -xJf "${ARCHIVE}" -C "${TOOLS}"
fi
[ -x "${TOOLS}/bin/generate_appcast" ] || release_fail "${ARCHIVE_NAME} has no bin/generate_appcast."
echo "${TOOLS}"
