/**
 * The Front Office's worker thread (SWIFTUI_REBUILD.md section 4.2): one build, or one evidence trail, off the server's
 * event loop, so no request waits behind it (better-sqlite3 opens its own connection here, as the refit workers do). It
 * reads and words; it records nothing and caches nothing. The main thread takes what it posts back (`adoptAuthored`
 * checks every claim again) and decides whether to keep it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { buildFrontOffice, buildTrail, type BuildRequest, type TrailRequest } from './frontOfficeBuild.js';

type Job = { kind: 'build'; request: BuildRequest } | { kind: 'trail'; request: TrailRequest };

async function run(job: Job): Promise<unknown> {
  return job.kind === 'build' ? buildFrontOffice(job.request) : buildTrail(job.request);
}

run(workerData as Job)
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((err: unknown) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }));
