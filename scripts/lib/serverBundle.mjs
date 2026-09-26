/**
 * Bundles one server entry point into a CJS file, the way both desktop builds need it: the Electron main process
 * (`scripts/build-desktop.mjs`) and the Mac app's sidecar (`scripts/build-sidecar.mjs`).
 *
 * Only our own source is bundled: every runtime dependency stays external and ships from node_modules. That avoids
 * bundling surprises with packages that use dynamic requires, and is required for better-sqlite3, which is a native
 * module that cannot be inlined.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** Every runtime dependency, plus Electron (present in the Electron build only). */
export const serverExternal = ['electron', ...Object.keys(pkg.dependencies ?? {})];

export async function bundleServerEntry(entry, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: serverExternal,
    sourcemap: true,
    logLevel: 'info',
    // The server modules are ESM and read import.meta.url; CJS output has no
    // import.meta, so shim it from __filename.
    banner: {
      js: "const import_meta_url = require('url').pathToFileURL(__filename).href;",
    },
    define: { 'import.meta.url': 'import_meta_url' },
  });
}

/**
 * The two refit workers. They are found beside the file that starts them (`playerValue.ts` `refitWorkerUrl`,
 * `saveCalibration.ts` `calibrationWorkerUrl`), so each build writes them into its own output folder.
 */
export async function bundleRefitWorkers(outDir) {
  // Player Value's refit runs in a worker thread (A-17)
  await bundleServerEntry('server/playerValueRefitWorker.ts', `${outDir}/value-refit-worker.cjs`);
  // The per-save calibration refit (D-053, cycle 1) runs in its own worker thread the same way
  await bundleServerEntry('server/calibrationRefitWorker.ts', `${outDir}/calibration-refit-worker.cjs`);
}

export { pkg };
