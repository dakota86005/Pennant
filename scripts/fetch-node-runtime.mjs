/**
 * Fetches the Node runtime the Mac app bundles as `Contents/Helpers/pennant-server` (D-055, SWIFTUI_REBUILD.md
 * section 5.2), pinned by version and SHA-256.
 *
 *   npm run sidecar:node      writes build/node-runtime/pennant-server and build/node-runtime/LICENSE
 *
 * The official darwin-arm64 build of Node 24 LTS (owner-approved, SWIFTUI_REBUILD.md section 9). The archive is
 * checked against the SHA-256 pinned below before anything is extracted, and the binary must then report the
 * pinned version, so a changed or substituted download fails the build instead of shipping. The checksum was read
 * from nodejs.org's SHASUMS256.txt for this release on 2026-09-25. Moving to a newer 24.x release means changing
 * both constants together, from that release's SHASUMS256.txt; `npm run abi:node` under the same Node keeps
 * better-sqlite3 built for its ABI.
 *
 * The download is cached in build/node-runtime/, so a second run is offline. Node's MIT licence ships beside the
 * binary, as its licence requires.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NODE_VERSION = '24.21.0';
export const NODE_ARCHIVE = `node-v${NODE_VERSION}-darwin-arm64.tar.gz`;
export const NODE_SHA256 = 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057';

const OUT = 'build/node-runtime';
const archivePath = path.join(OUT, NODE_ARCHIVE);
const url = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}`;

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

mkdirSync(OUT, { recursive: true });

if (!existsSync(archivePath) || sha256(archivePath) !== NODE_SHA256) {
  console.log(`[node-runtime] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));
}
const actual = sha256(archivePath);
if (actual !== NODE_SHA256) {
  rmSync(archivePath, { force: true });
  throw new Error(`${NODE_ARCHIVE} has SHA-256 ${actual}, not the pinned ${NODE_SHA256}. Nothing was extracted.`);
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'pennant-node-'));
try {
  const root = `node-v${NODE_VERSION}-darwin-arm64`;
  execFileSync('tar', ['-xzf', archivePath, '-C', scratch, `${root}/bin/node`, `${root}/LICENSE`]);
  const binary = path.join(OUT, 'pennant-server');
  copyFileSync(path.join(scratch, root, 'bin', 'node'), binary);
  chmodSync(binary, 0o755);
  copyFileSync(path.join(scratch, root, 'LICENSE'), path.join(OUT, 'LICENSE'));
  const reported = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  if (reported !== `v${NODE_VERSION}`) throw new Error(`The extracted binary reports ${reported}, not v${NODE_VERSION}.`);
  console.log(`[node-runtime] ${binary} (${reported}, SHA-256 of the archive verified)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
