/**
 * The Front Office service (V2 plan section 4.4; SWIFTUI_REBUILD.md section 4.2): builds each club's desk, cards and
 * department reports (`frontOfficeBuild.ts`) off the server's event loop, keeps the result, and serves it, so the GM's
 * click is a cached read and no request waits behind a build.
 *
 * - **Keyed on what the answer depends on:** the club, the import (`importedAt`, the stamp the Mac app's stores key on),
 *   the settings and configuration files (the philosophy, the budget, the save folder), the live transaction log's
 *   files, and a revision moved when a per-save calibration actually changes. A request whose key moved never gets the
 *   old answer. Every payload carries its build's `reportStamp`; `/api/status` serves the current one and a
 *   `front-office-updated` event says when a new build is kept, so the Mac app reloads on it.
 * - **Built once per key, in a worker thread** (`frontOfficeWorker.ts`): concurrent requests wait on the same build; the
 *   server keeps answering meanwhile. With no worker (the TypeScript sources under a test runner) it builds in-process,
 *   yielding between departments.
 * - **Never keeps a build read during an import:** the database is then partly two exports, and a failed import does
 *   not move the stamp. Such a build is handed to the requests waiting on it and dropped; a build kept from before the
 *   import is served meanwhile.
 * - **Warmed** at start, after every import (N3.5's post-import hook list registers `warmFrontOffice`) and after a
 *   calibration changes. **Bounded:** four builds and 32 evidence trails, oldest dropped first.
 *
 * It lives outside `presentation/` because it reads the specialists; the landing folders never import them, and no
 * odds, posture or window label reaches the payload (D-060, `tests/frontOfficeLanding.test.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { clubOwed } from './clubOwed.js';
import { DATA_DIR } from './config.js';
import type { DeptId } from './contract/presentation.js';
import { currentSaveLocation } from './dataStatus.js';
import { databaseGeneration, tableExists } from './db.js';
import { buildClubReport, buildFrontOffice, buildTrail, type BuildRequest, type BuildResult, type ClubRequest, type TrailRequest } from './frontOfficeBuild.js';
import { catalogClubs } from './org.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored } from './presentation/claim.js';
import { REPORTING } from './presentation/frontOffice/desk.js';
import type { ClaimTrail, DepartmentReport, FrontOfficeSummary } from './presentation/frontOffice/types.js';
import type { ClubReport } from './presentation/frontOffice/leagueTypes.js';
import { onCalibrationRecorded } from './saveCalibration.js';
import { publish } from './serverEvents.js';
import { currentOrganization } from './viewingOrganization.js';

/** One club's Front Office for one state of its inputs. */
interface Built {
  key: string;
  stamp: string;
  orgId: number;
  /** The import it was built from (`importedAt` when it began). */
  importStamp: string | null;
  summary: FrontOfficeSummary;
  reports: Map<DeptId, DepartmentReport>;
  majorLeague: BuildResult['majorLeague'];
  ms: Record<string, number>;
  season: BuildResult['season'];
}

/** A kept build as the rest of the server reads it (N7: the GM's attention is put on it when served). */
export type FrontOfficeBuilt = Readonly<Omit<Built, 'majorLeague'>>;

const keptListeners = new Set<(built: FrontOfficeBuilt) => void>();

/**
 * Called after a build is kept, off the request's turn (N7: the snapshot of what it served is recorded then, once the
 * requests that waited on it have their answer). Returns the unsubscribe.
 */
export function onFrontOfficeKept(listener: (built: FrontOfficeBuilt) => void): () => void {
  keptListeners.add(listener);
  return () => keptListeners.delete(listener);
}

const MAX_BUILDS = 4;
const MAX_TRAILS = 32;
const builds = new Map<string, Built>();
const building = new Map<string, Promise<Built>>();
const trails = new Map<string, ClaimTrail>();
const trailsBuilding = new Map<string, Promise<ClaimTrail | null>>();
/** Other clubs' reports (N7, D-059), kept per club and inputs like the Front Office; the oldest dropped first. */
const MAX_CLUB_REPORTS = 12;
const clubReports = new Map<string, { report: ClubReport; ms: number }>();
const clubReportsBuilding = new Map<string, Promise<{ report: ClubReport; ms: number }>>();
let revision = 0;
const stats = { builds: 0, hits: 0, trailBuilds: 0, trailHits: 0, workerRuns: 0, inlineRuns: 0, clubBuilds: 0, clubHits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function frontOfficeStats(): Readonly<typeof stats & { cached: number; trailsCached: number }> {
  return { ...stats, cached: builds.size, trailsCached: trails.size };
}

/** Forgets every build and trail, and moves the revision, so the next request builds again. */
export function invalidateFrontOffice(): void {
  revision += 1;
  builds.clear();
  building.clear();
  clubReports.clear();
  clubReportsBuilding.clear();
  trails.clear();
  trailsBuilding.clear();
}

/** How many times the cache was forgotten (for the tests: a carry-over of rating history rebuilds the Front Office). */
export function frontOfficeRevision(): number {
  return revision;
}

/** For the tests: empty cache and zero counts. */
export function resetFrontOfficeCache(): void {
  invalidateFrontOffice();
  Object.assign(stats, { builds: 0, hits: 0, trailBuilds: 0, trailHits: 0, workerRuns: 0, inlineRuns: 0, clubBuilds: 0, clubHits: 0 });
}

const statKey = (file: string | null | undefined): string => {
  if (!file) return '-';
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return 'absent';
  }
};

/**
 * The save's live-log files, found off every request's path: at start, at the minute's look at the saves, when a save
 * is chosen and when an import lands (`lookAtTheServedSave`). A request only reads what was last found: `/api/status`
 * serves the stamp and never locates a save (N6 B1 review M3). A save not found is looked for again at the next look.
 */
let located: { live: { db: string; wal: string } | null } | null = null;
export function relocateLiveLog(): void {
  let live: { db: string; wal: string } | null = null;
  try {
    const where = currentSaveLocation();
    live = where.found && where.live ? { db: where.live.db, wal: where.live.wal } : null;
  } catch {
    live = null;
  }
  located = { live };
}
const liveLogFiles = (): { db: string; wal: string } | null => located?.live ?? null;

/** Everything the answer for this club depends on, as one string. */
function inputsKey(orgId: number): string {
  const config = statKey(path.join(DATA_DIR, 'config.json'));
  const live = liveLogFiles();
  return [
    orgId,
    importedAt.value ?? 'none',
    revision,
    statKey(path.join(DATA_DIR, 'settings.json')),
    config,
    live ? `${statKey(live.db)}/${statKey(live.wal)}` : 'no-log',
  ].join('|');
}

/** A build's stamp: a short hash of its key (FNV-1a), the same for the same inputs. */
function stampOf(key: string): string {
  let h = 0x811c9dc5;
  for (const ch of key) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `r${h.toString(36)}`;
}

// ── off the event loop ──────────────────────────────────────────────────────

/** The worker's entry: the bundled builds ship it beside the bundle; the source runs it through tsx. */
function workerUrl(): URL {
  const here = new URL(import.meta.url);
  return here.pathname.endsWith('.cjs') ? new URL('./front-office-worker.cjs', here) : new URL('./frontOfficeWorker.ts', here);
}

/** Whether a worker can load: the bundle always; the TypeScript sources only under tsx (a test runner has no loader for a thread). */
function workerAvailable(): boolean {
  if (workerBroken) return false;
  if (process.env.OOTP_FO_FRONT_OFFICE_WORKER === '0') return false;
  const url = workerUrl();
  return url.pathname.endsWith('.cjs') || process.execArgv.some((a) => a.includes('tsx'));
}
let workerBroken = false;

type Job = { kind: 'build'; request: BuildRequest } | { kind: 'trail'; request: TrailRequest } | { kind: 'club'; request: ClubRequest };

function inWorker<T>(job: Job): Promise<T> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl(), { workerData: job });
    } catch (err) {
      reject(err);
      return;
    }
    worker.once('message', (m: { ok: boolean; result?: T; error?: string }) => {
      if (m.ok) resolve(m.result as T);
      else reject(new Error(m.error ?? 'the Front Office worker failed'));
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`the Front Office worker exited with ${code}`)); });
  });
}

/** Takes in what the worker built: its payloads' claims are checked again and registered (`adoptAuthored`). */
function adopt<T>(job: Job, result: T): T {
  if (job.kind === 'trail') return result === null ? result : adoptAuthored(result);
  if (job.kind === 'club') {
    adoptAuthored((result as unknown as { report: ClubReport }).report);
    return result;
  }
  const built = result as unknown as BuildResult;
  adoptAuthored(built.summary);
  adoptAuthored(built.reports);
  return result;
}

/** Runs a job in a worker thread; in-process when none can start (logged once), never on the request's own turn. */
async function run<T>(job: Job): Promise<T> {
  if (workerAvailable()) {
    let result: T | undefined;
    try {
      stats.workerRuns += 1;
      result = await inWorker<T>(job);
    } catch (err) {
      workerBroken = true;
      console.error('[front office] worker unavailable, building in-process from now on:', err);
    }
    // An authoring defect in what it built throws here, as it would have in-process
    if (result !== undefined) return adopt(job, result);
  }
  stats.inlineRuns += 1;
  await new Promise((resolve) => setImmediate(resolve));
  if (job.kind === 'club') return buildClubReport(job.request) as T;
  return (job.kind === 'build' ? await buildFrontOffice(job.request) : buildTrail(job.request)) as T;
}

// ── the cache ───────────────────────────────────────────────────────────────

/** The club's build for the current inputs: the kept one, the one being built, or a new build. */
async function current(orgId: number): Promise<Built> {
  const key = inputsKey(orgId);
  const hit = builds.get(key);
  if (hit) {
    stats.hits += 1;
    return hit;
  }
  const pending = building.get(key);
  if (pending) return pending;
  const startedRevision = revision;
  // The served database this build reads (N3.5): an import builds its own file and changes what is served only at its
  // swap, so a build is kept unless a swap happened while it ran (its worker may then have read either file)
  const startedGeneration = databaseGeneration();
  const stamp = stampOf(key);
  const importStamp = importedAt.value;
  const job = run<BuildResult>({ kind: 'build', request: { orgId, importStamp, reportStamp: stamp } })
    .then((result) => {
      stats.builds += 1;
      const built: Built = {
        key, stamp, orgId, importStamp, summary: result.summary, reports: new Map(result.reports), majorLeague: result.majorLeague, ms: result.ms,
        season: result.season ?? null,
      };
      // Kept only when nothing moved under it: no invalidation, no swap to another import, the same inputs
      const keep = revision === startedRevision && databaseGeneration() === startedGeneration && inputsKey(orgId) === key;
      if (keep) {
        builds.delete(key);
        builds.set(key, built);
        while (builds.size > MAX_BUILDS) builds.delete(builds.keys().next().value!);
        publish({ type: 'front-office-updated', orgId, reportStamp: stamp });
        // After the requests waiting on it are answered (their continuations run first)
        setImmediate(() => {
          for (const listener of keptListeners) {
            try {
              listener(built);
            } catch (err) {
              console.error('[front office] a listener on a kept build failed:', err);
            }
          }
        });
      }
      return built;
    })
    .finally(() => {
      if (building.get(key) === job) building.delete(key);
    });
  building.set(key, job);
  return job;
}

/** The stamp of the kept build for the club the app follows, for `/api/status`; null when none is kept yet. */
export function currentReportStamp(): string | null {
  try {
    const org = currentOrganization()?.id ?? null;
    return org === null ? null : builds.get(inputsKey(org))?.stamp ?? null;
  } catch {
    return null;
  }
}

/** Why a Front Office request cannot be answered, as a sentence. */
export class FrontOfficeRefusal extends Error {
  constructor(message: string, readonly status: 404) {
    super(message);
    this.name = 'FrontOfficeRefusal';
  }
}

export const NO_DATA = 'Nothing is imported yet, so there is no report to read.';
export const NO_CLUB = 'No club is chosen, and the save doesn\'t say which club you run. Choose one in Settings.';
export const UNKNOWN_CLUB = 'Pennant doesn\'t know that club in this save.';
export const UNKNOWN_DEPARTMENT = 'Pennant doesn\'t know that department.';
export const UNKNOWN_CLAIM = 'That item isn\'t open in the current export. It may have been resolved, or the export changed.';

/** The club a request names: a team id, or `automatic` (the served resolution: configured, else the human's club). */
export function resolveOrg(param: string): number {
  if (!tableExists('players') || !tableExists('teams')) throw new FrontOfficeRefusal(NO_DATA, 404);
  // The club question still open (N7): the automatic club is not served as if it had been chosen
  const owed = param === 'automatic' ? clubOwed() : null;
  if (owed) throw new FrontOfficeRefusal(owed.text, 404);
  const id = param === 'automatic' ? currentOrganization()?.id ?? null : Number(param);
  if (id === null) throw new FrontOfficeRefusal(NO_CLUB, 404);
  if (!Number.isInteger(id) || id <= 0 || !catalogClubs().some((c) => c.team_id === id)) throw new FrontOfficeRefusal(UNKNOWN_CLUB, 404);
  return id;
}

/** The Morning Report's desk and department cards, as built (the GM's attention is put on it by `frontOfficeAttention.ts`). */
export async function frontOfficeSummary(orgId: number): Promise<FrontOfficeSummary> {
  return (await current(orgId)).summary;
}

/** The club's build for the current inputs (kept, being built, or built now). */
export async function frontOfficeBuilt(orgId: number): Promise<FrontOfficeBuilt> {
  return current(orgId);
}

/** The kept build for the club's current inputs, without building one; null when none is kept. */
export function keptFrontOffice(orgId: number): FrontOfficeBuilt | null {
  return builds.get(inputsKey(orgId)) ?? null;
}

const DEPARTMENTS = new Set<string>(['frontOffice', ...REPORTING]);

/** One department's full report (an unknown department is refused before anything is built). */
export async function departmentReport(orgId: number, dept: string): Promise<DepartmentReport> {
  if (!DEPARTMENTS.has(dept)) throw new FrontOfficeRefusal(UNKNOWN_DEPARTMENT, 404);
  const report = (await current(orgId)).reports.get(dept as DeptId);
  if (!report) throw new FrontOfficeRefusal(UNKNOWN_DEPARTMENT, 404);
  return report;
}

/**
 * The evidence trail behind an item (`<org>.<item key>`), built on demand in the worker and kept with the club's build.
 * Only a Major League Ops need has one today (its responses); any other key is refused in a sentence.
 */
export async function claimTrail(key: string): Promise<ClaimTrail> {
  const match = /^(\d+)\.majorLeague:need:(.+)$/.exec(key);
  if (!match) throw new FrontOfficeRefusal(UNKNOWN_CLAIM, 404);
  const orgId = resolveOrg(match[1]);
  const built = await current(orgId);
  const cacheKey = `${built.key}#${key}`;
  const hit = trails.get(cacheKey);
  if (hit) {
    stats.trailHits += 1;
    return hit;
  }
  const overview = built.majorLeague;
  if (!overview?.needs.some((n) => n.id === match[2])) throw new FrontOfficeRefusal(UNKNOWN_CLAIM, 404);
  let pending = trailsBuilding.get(cacheKey);
  if (!pending) {
    const startedRevision = revision;
    pending = run<ClaimTrail | null>({
      kind: 'trail',
      request: { orgId, importStamp: built.summary.importStamp, reportStamp: built.stamp, key, needId: match[2], overview },
    }).then((trail) => {
      stats.trailBuilds += 1;
      if (trail && revision === startedRevision && builds.get(built.key) === built) {
        trails.set(cacheKey, trail);
        while (trails.size > MAX_TRAILS) trails.delete(trails.keys().next().value!);
      }
      return trail;
    }).finally(() => trailsBuilding.delete(cacheKey));
    trailsBuilding.set(cacheKey, pending);
  }
  const trail = await pending;
  if (!trail) throw new FrontOfficeRefusal(UNKNOWN_CLAIM, 404);
  return trail;
}

/**
 * Another club's report (N7, D-059): built in the worker on its first open for the current inputs (the club, the import,
 * the settings, the live log) and kept, like the Front Office; `ourTeamId` is the report's "us". A request that arrives
 * during a build waits on it. The GM's attention (what he follows, the club's moves on the wire) is put on it when served.
 *
 * The live log stays in its key (checked for the review, M5): the report reads the log, though not through Player Rights
 * (`playerRights.ts` reads no log; the report never calls `rightsFor`). `buildClubReport` reads the data status
 * (`getDataStatus` → `currentTransactionLog`), whose freshness weighs the log's last transaction against the export's
 * day (`assessFreshness`); an export the log shows to be behind turns Player Value's control and costs on the roster
 * map to "not known". So a new copy of the log can change a club report, and a report kept past one would be stale.
 */
export async function clubReportBuilt(teamId: number, ourTeamId: number | null): Promise<{ report: ClubReport; ms: number }> {
  const key = `club|${ourTeamId ?? '-'}|${inputsKey(teamId)}`;
  const hit = clubReports.get(key);
  if (hit) {
    stats.clubHits += 1;
    return hit;
  }
  const pending = clubReportsBuilding.get(key);
  if (pending) return pending;
  const startedRevision = revision;
  const startedGeneration = databaseGeneration();
  const job = run<{ report: ClubReport; ms: number }>({
    kind: 'club', request: { teamId, ourTeamId, importStamp: importedAt.value, reportStamp: stampOf(key) },
  }).then((result) => {
    stats.clubBuilds += 1;
    if (revision === startedRevision && databaseGeneration() === startedGeneration && `club|${ourTeamId ?? '-'}|${inputsKey(teamId)}` === key) {
      clubReports.delete(key);
      clubReports.set(key, result);
      while (clubReports.size > MAX_CLUB_REPORTS) clubReports.delete(clubReports.keys().next().value!);
    }
    return result;
  }).finally(() => {
    if (clubReportsBuilding.get(key) === job) clubReportsBuilding.delete(key);
  });
  clubReportsBuilding.set(key, job);
  return job;
}

/** Resolves once no Front Office build of ours is running (the kept ones and the requests' come first). */
async function ourBuildsSettled(): Promise<void> {
  while (building.size) await Promise.allSettled([...building.values()]);
}

/**
 * Builds other clubs' reports in the background, one at a time (after an import: our division's), each after any build
 * of our own Front Office that is running: a rival's report never holds up ours (M5). Never throws.
 */
export async function warmClubReports(teamIds: readonly number[], ourTeamId: number | null): Promise<void> {
  for (const teamId of teamIds) {
    await ourBuildsSettled();
    try {
      await clubReportBuilt(teamId, ourTeamId);
    } catch (err) {
      console.error(`[front office] club ${teamId}'s report could not be built ahead:`, err);
    }
  }
}

/**
 * Builds the club's Front Office in the background so the GM's first look is a cached read: at start, after every
 * import (N3.5's post-import hook list registers it) and after a calibration changes. `org` defaults to the served club
 * (configured, else the human's). An import running meanwhile does not matter: it changes nothing served until its swap. Never throws.
 */
export async function warmFrontOffice(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? (clubOwed() ? null : currentOrganization()?.id ?? null) : org;
    if (orgId === null || !tableExists('players') || !tableExists('teams')) return;
    const started = performance.now();
    const built = await current(orgId);
    console.log(`[front office] warmed club ${orgId} in ${Math.round(performance.now() - started)} ms (${Object.entries(built.ms).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  } catch (err) {
    console.error('[front office] warm-up failed; the next request builds:', err);
  }
}

/** The cold build's timing per department, for the measurements (null when the club has no kept build). */
export function frontOfficeTimings(orgId: number): Record<string, number> | null {
  const built = builds.get(inputsKey(orgId));
  return built ? { ...built.ms } : null;
}

let rebuildHolds = 0;
let rebuildOwed = false;
let holdWaiters: Array<() => void> = [];

/**
 * Resolves when no refit holds the rebuilds (straight away when none does), after the rebuild a released hold owes has
 * started: the work that should follow the refits (N7: our division's club reports, built ahead once per import) waits
 * on it, so it is built on the fits the refits leave, once.
 */
export function rebuildHoldsReleased(): Promise<void> {
  if (rebuildHolds === 0) return Promise.resolve();
  return new Promise((resolve) => holdWaiters.push(resolve));
}

/**
 * Drops the kept builds at once, so no request is answered from the old one, and builds the club's again in the
 * background: straight away, or once when the last hold is released (N6 review, L3). Player Value's adopted refit and a
 * recorded calibration both call it.
 */
export function rebuildFrontOfficeLater(): void {
  invalidateFrontOffice();
  if (rebuildHolds > 0) {
    rebuildOwed = true;
    return;
  }
  void warmFrontOffice();
}

/**
 * Holds the background rebuilds while the refits after an import run (`api.ts`), so the two that each ask for one (Player
 * Value's and the calibrations') cost one build, after both, not two. Invalidation is never held: a request meanwhile
 * builds on the fits then in force. Returns the release (idempotent).
 */
export function holdFrontOfficeRebuilds(): () => void {
  rebuildHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rebuildHolds -= 1;
    if (rebuildHolds === 0 && rebuildOwed) {
      rebuildOwed = false;
      void warmFrontOffice();
    }
    if (rebuildHolds === 0) {
      const waiting = holdWaiters;
      holdWaiters = [];
      for (const resolve of waiting) resolve();
    }
  };
}

/**
 * Player Value's refits after an import (N6): an adopted fit moves every expected-wins figure the roster map shows (and
 * its places), so the kept builds are dropped and the club's is built again in the background, which moves the served
 * stamp and sends `front-office-updated`. A refit that was not adopted leaves the fits in force, and nothing is rebuilt.
 * Returns whether it rebuilt. Called by the import's refit step (`api.ts`), after the fits are recorded.
 */
export function valueRefitsRecorded(outcomes: ReadonlyArray<{ refit: boolean; adopted: boolean | null }>): boolean {
  if (!outcomes.some((o) => o.refit && o.adopted === true)) return false;
  rebuildFrontOfficeLater();
  return true;
}

// A calibration that changed moves the review's yardsticks, so what Major League Ops raises: build again, in the background
onCalibrationRecorded(() => rebuildFrontOfficeLater());
