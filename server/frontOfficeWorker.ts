/**
 * The Front Office's worker thread (SWIFTUI_REBUILD.md section 4.2): one build, or one evidence trail, off the server's
 * event loop, so no request waits behind it (better-sqlite3 opens its own connection here, as the refit workers do). It
 * reads and words; it records nothing and caches nothing. The main thread takes what it posts back (`adoptAuthored`
 * checks every claim again) and decides whether to keep it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { buildClubReport, buildFrontOffice, buildTrail, type BuildRequest, type ClubRequest, type TrailRequest } from './frontOfficeBuild.js';
import { buildFarmDecision, buildFarmViews, type FarmDecisionRequest, type FarmViewsRequest } from './farmViewsBuild.js';

type Job = { kind: 'build'; request: BuildRequest } | { kind: 'trail'; request: TrailRequest } | { kind: 'club'; request: ClubRequest }
  // Farm & Development's views (N10), the same way
  | { kind: 'farmViews'; request: FarmViewsRequest } | { kind: 'farmDecision'; request: FarmDecisionRequest };

async function run(job: Job): Promise<unknown> {
  if (job.kind === 'farmViews') return buildFarmViews(job.request);
  if (job.kind === 'farmDecision') return buildFarmDecision(job.request);
  if (job.kind === 'build') return buildFrontOffice(job.request);
  if (job.kind === 'club') return buildClubReport(job.request);
  return buildTrail(job.request);
}

run(workerData as Job)
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((err: unknown) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }));
