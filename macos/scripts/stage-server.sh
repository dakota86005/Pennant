#!/bin/bash
# Stages the server the Mac app carries (SWIFTUI_REBUILD.md section 5.2) into build/macos-server/, laid out as the
# bundle holds it:
#
#   build/macos-server/Helpers/pennant-server           the pinned Node 24 binary   -> Contents/Helpers/
#   build/macos-server/Resources/server/server.cjs      the bundled server           -> Contents/Resources/server/
#   build/macos-server/Resources/server/*-worker.cjs    the worker threads (refits, import, snapshots)
#   build/macos-server/Resources/server/package.json    the version and runtime dependencies
#   build/macos-server/Resources/server/node_modules/   production only, better-sqlite3 built for Node's ABI
#   build/macos-server/Resources/server/NODE_LICENSE    Node's licence, which must ship with the binary
#
#   npm run mac:stage
#
# The Xcode build copies this folder into the app ("Embed the server" in the Pennant target) and fails, naming this
# command, when it is missing. The production node_modules is installed in its own folder
# (build/macos-server-install/) with the pinned Node binary first on PATH, so better-sqlite3 matches the Node that
# runs it and the repository's own node_modules (and its Electron or Node ABI) is never touched. The install is
# reused until package-lock.json, the runtime dependencies or the Node version change.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
STAGE="$ROOT/build/macos-server"
INSTALL="$ROOT/build/macos-server-install"
NODE="$ROOT/build/node-runtime/pennant-server"

# Each step's output is shown only when it fails
quiet() {
  local log
  log="$(mktemp)"
  if ! "$@" >"$log" 2>&1; then cat "$log" >&2; rm -f "$log"; return 1; fi
  rm -f "$log"
}
echo "[stage] building the server bundle (npm run build:sidecar)"
quiet npm run build:sidecar
echo "[stage] fetching the pinned Node runtime (npm run sidecar:node)"
quiet npm run sidecar:node
[ -x "$NODE" ] || { echo "[stage] error: $NODE is missing after npm run sidecar:node" >&2; exit 1; }

node_version="$("$NODE" --version)"
stamp="$(cat package-lock.json build/sidecar/package.json | shasum -a 256 | cut -c1-64) $node_version"

if [ ! -f "$INSTALL/.stamp" ] || [ "$(cat "$INSTALL/.stamp")" != "$stamp" ]; then
  echo "[stage] installing production dependencies with Node $node_version"
  rm -rf "$INSTALL"
  mkdir -p "$INSTALL"
  # The sidecar's own package.json (no electron-updater), resolved against the repository's lockfile
  cp build/sidecar/package.json "$INSTALL/package.json"
  cp package-lock.json "$INSTALL/package-lock.json"
  shim="$(mktemp -d)"
  trap 'rm -rf "$shim"' EXIT
  ln -s "$NODE" "$shim/node"
  (cd "$INSTALL" && PATH="$shim:$PATH" quiet npm install --omit=dev --no-audit --no-fund --no-save)
  echo "$stamp" > "$INSTALL/.stamp"
fi

# The native module must load under the Node that will run it
"$NODE" -e "
  const Database = require('$INSTALL/node_modules/better-sqlite3');
  const db = new Database(':memory:');
  if (db.prepare('select 1 as one').get().one !== 1) process.exit(1);
" || { echo "[stage] error: better-sqlite3 does not load under $node_version; delete $INSTALL and run again" >&2; exit 1; }

echo "[stage] assembling $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE/Helpers" "$STAGE/Resources/server"
cp -p "$NODE" "$STAGE/Helpers/pennant-server"
cp build/node-runtime/LICENSE "$STAGE/Resources/server/NODE_LICENSE"
# The bundle and every worker thread beside it (the refits, the import, the snapshots)
cp build/sidecar/*.cjs build/sidecar/package.json "$STAGE/Resources/server/"
# Pruned: build intermediates and sources of the native module, type declarations, source maps, docs and the
# install-time .bin links. Licences stay.
rsync -a \
  --exclude '.bin/' \
  --exclude 'better-sqlite3/deps/' \
  --exclude 'better-sqlite3/src/' \
  --exclude 'better-sqlite3/build/Release/obj/' \
  --exclude 'better-sqlite3/build/Release/obj.target/' \
  --exclude 'better-sqlite3/build/Release/.deps/' \
  --exclude 'better-sqlite3/build/Release/test_extension.node' \
  --exclude 'better-sqlite3/build/deps/' \
  --exclude '*.d.ts' --exclude '*.d.mts' --exclude '*.d.cts' --exclude '*.map' \
  --exclude 'README*' --exclude 'CHANGELOG*' --exclude 'HISTORY*' \
  "$INSTALL/node_modules" "$STAGE/Resources/server/"

# Proof the staged layout runs: the bundle's entry resolves its dependencies from the staged node_modules
"$NODE" -e "
  const root = '$STAGE/Resources/server';
  for (const name of Object.keys(require(root + '/package.json').dependencies)) require.resolve(name, { paths: [root] });
  new (require(require.resolve('better-sqlite3', { paths: [root] })))(':memory:');
" || { echo "[stage] error: the staged node_modules is incomplete" >&2; exit 1; }

# The stamp the build checks the stage against (embed-server.sh)
"$ROOT/macos/scripts/stage-stamp.sh" "$ROOT" > "$STAGE/.stamp"

version="$("$NODE" -p "require('$STAGE/Resources/server/package.json').version")"
size="$(du -sh "$STAGE" | cut -f1)"
echo "[stage] staged the server for version $version ($size) in build/macos-server/"
