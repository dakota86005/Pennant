/**
 * Player Value's refit, in a worker thread (A-17, D-053: the refit can never block the import, nor the
 * server). It opens its own read connections (better-sqlite3 works in a worker), COMPUTES the production and
 * ratings fits the export calls for and hands them back; it records nothing. The main thread records them
 * (`recordRefits`), and only if no import started while they were read.
 */

import { parentPort } from 'node:worker_threads';
import { computeRefits } from './playerValue.js';

try {
  const pending = computeRefits();
  parentPort?.postMessage({ ok: true, pending });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
