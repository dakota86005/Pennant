/**
 * Bundles the Electron main process and the Express server into a single CJS
 * file for packaging (the shared options are in `lib/serverBundle.mjs`).
 */
import { build } from 'esbuild';
import { bundleRefitWorkers, bundleServerEntry } from './lib/serverBundle.mjs';

// The preload bridge is a separate entry: it runs in the renderer's isolated
// context, not the main process.
await build({
  entryPoints: ['electron/preload.ts'],
  outfile: 'build/preload.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'info',
});

await bundleServerEntry('electron/main.ts', 'build/main.cjs');

// The worker threads ship beside the bundle, which finds them next to itself: ./value-refit-worker.cjs,
// ./calibration-refit-worker.cjs, ./front-office-worker.cjs, ./import-worker.cjs, ./snapshot-worker.cjs and ./transaction-log-worker.cjs.
await bundleRefitWorkers('build');
