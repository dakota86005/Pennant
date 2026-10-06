/**
 * The Front Office's worker thread (SWIFTUI_REBUILD.md section 4.2): one build, or one evidence trail, off the server's
 * event loop, so no request waits behind it (better-sqlite3 opens its own connection here, as the refit workers do). It
 * reads and words; it records nothing and caches nothing. The main thread takes what it posts back (`adoptAuthored`
 * checks every claim again) and decides whether to keep it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { buildClubReport, buildDecision, buildFrontOffice, buildTrail, type WorkerJob } from './frontOfficeBuild.js';
import { buildFarmDecision, buildFarmViews } from './farmViewsBuild.js';
import { buildClubhouseAsk, buildClubhouseViews } from './clubhouseViewsBuild.js';

async function run(job: WorkerJob): Promise<unknown> {
  if (job.kind === 'farmViews') return buildFarmViews(job.request);
  if (job.kind === 'farmDecision') return buildFarmDecision(job.request);
  if (job.kind === 'clubhouseViews') return buildClubhouseViews(job.request);
  if (job.kind === 'clubhouseAsk') return buildClubhouseAsk(job.request);
  if (job.kind === 'build') return buildFrontOffice(job.request);
  if (job.kind === 'club') return buildClubReport(job.request);
  if (job.kind === 'decision') return buildDecision(job.request);
  return buildTrail(job.request);
}

run(workerData as WorkerJob)
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((err: unknown) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }));
