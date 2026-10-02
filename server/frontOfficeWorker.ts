/**
 * The Front Office's worker thread (SWIFTUI_REBUILD.md section 4.2): one build, or one evidence trail, off the server's
 * event loop, so no request waits behind it (better-sqlite3 opens its own connection here, as the refit workers do). It
 * reads and words; it records nothing and caches nothing. The main thread takes what it posts back (`adoptAuthored`
 * checks every claim again) and decides whether to keep it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { buildClubReport, buildDecision, buildFrontOffice, buildTrail, type BuildRequest, type ClubRequest, type DecisionRequest, type TrailRequest } from './frontOfficeBuild.js';

type Job =
  | { kind: 'build'; request: BuildRequest }
  | { kind: 'trail'; request: TrailRequest }
  | { kind: 'club'; request: ClubRequest }
  | { kind: 'decision'; request: DecisionRequest };

async function run(job: Job): Promise<unknown> {
  if (job.kind === 'build') return buildFrontOffice(job.request);
  if (job.kind === 'club') return buildClubReport(job.request);
  if (job.kind === 'decision') return buildDecision(job.request);
  return buildTrail(job.request);
}

run(workerData as Job)
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((err: unknown) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }));
