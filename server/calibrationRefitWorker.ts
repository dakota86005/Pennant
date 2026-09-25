/**
 * The per-save calibration refit, in a worker thread (D-053; like Player Value's, A-17): the refit can never block the import, nor
 * the server. It loads the subsystems' registrations, COMPUTES every component the export calls for and hands the results back;
 * it records nothing. The main thread records them (`recordCalibrationRefits`), and only if no import started while they were read.
 */

import { parentPort } from 'node:worker_threads';
import './mlbCalibrationRefit.js';
import { computeCalibrationRefits } from './saveCalibration.js';

try {
  const pending = computeCalibrationRefits();
  parentPort?.postMessage({ ok: true, pending });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
