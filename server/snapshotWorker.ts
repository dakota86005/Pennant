/**
 * The import's snapshots, in a worker thread (N3.5): the rating, roster-state and market snapshots read the whole
 * league for about two seconds, and the server keeps answering meanwhile. It opens its own connections (the new
 * league database, read-only, and `history.db`) and writes only `history.db`, as the same code on the server's thread did.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { takeImportSnapshots, type SnapshotRequest } from './importSnapshots.js';

takeImportSnapshots(workerData as SnapshotRequest, async () => {})
  .then((outcome) => parentPort?.postMessage({ ok: true, outcome }))
  .catch((err) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }));
