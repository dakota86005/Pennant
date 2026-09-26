/**
 * Builds the Mac app's server (D-055, SWIFTUI_REBUILD.md section 5.2) into `build/sidecar/`:
 *
 *   server.cjs                      the sidecar entry (`server/sidecar.ts`) and the whole server
 *   value-refit-worker.cjs          Player Value's refit worker, found beside server.cjs
 *   calibration-refit-worker.cjs    the per-save calibration worker, found the same way
 *   package.json                    the version, and the runtime dependencies the bundle leaves external
 *
 * The Xcode build (N3) copies this folder into `Contents/Resources/server/` with a production `node_modules`
 * built for the bundled Node (`npm run sidecar:node` fetches it). In the repository the bundle resolves its
 * dependencies from the repository's own `node_modules`, so `node build/sidecar/server.cjs` runs as it is.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { bundleRefitWorkers, bundleServerEntry, pkg } from './lib/serverBundle.mjs';

const OUT = 'build/sidecar';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await bundleServerEntry('server/sidecar.ts', `${OUT}/server.cjs`);
await bundleRefitWorkers(OUT);

// The updater belongs to the Electron shell; the Mac app updates through Sparkle (N14)
const ELECTRON_ONLY = new Set(['electron-updater']);
const dependencies = Object.fromEntries(
  Object.entries(pkg.dependencies ?? {}).filter(([name]) => !ELECTRON_ONLY.has(name))
);
// The held npm name (D-049) and the one version, read from the repository's package.json, never typed here
writeFileSync(
  `${OUT}/package.json`,
  `${JSON.stringify({ name: pkg.name, version: pkg.version, private: true, license: pkg.license, dependencies }, null, 2)}\n`
);
console.log(`[sidecar] built ${OUT}/ (version ${pkg.version})`);
