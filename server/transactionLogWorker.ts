/**
 * Copies and reads OOTP's live transaction log off the server's event loop (N3.5 Stage B2): the same private copy and
 * validation as ever (`liveLogSnapshot.ts`, `transactionLog.ts`), in a worker thread, so a page never waits while a
 * log OOTP has just written is copied. It reads and posts back; the main thread keeps it (`dataStatus.ts`).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { LiveLogError } from './liveLogSnapshot.js';
import type { LiveDatabaseFiles } from './ootpSave.js';
import { readTransactionLog } from './transactionLog.js';

try {
  const log = readTransactionLog(workerData as LiveDatabaseFiles);
  parentPort?.postMessage({ ok: true, log });
} catch (err) {
  parentPort?.postMessage({
    ok: false,
    code: err instanceof LiveLogError ? err.code : null,
    message: err instanceof Error ? err.message : String(err),
  });
}
