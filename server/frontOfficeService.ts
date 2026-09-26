/**
 * The Front Office service (V2 plan section 4.4; SWIFTUI_REBUILD.md section 4.2): reads each department's specialist
 * through its public module, hands the answers to the pure adapters in `presentation/frontOffice/`, and keeps the result
 * so the GM's click is a cached read, never a computation.
 *
 * The cache:
 * - **Keyed on what the answer depends on:** the club, the import (`importedAt`, the last import's finish time, the stamp
 *   the Mac app's stores key on), the settings and configuration files (the philosophy, the budget, the save folder), the
 *   live transaction log's files, and a revision moved whenever a per-save calibration is recorded (the review's
 *   yardsticks change what Major League Ops raises). A request whose key moved never gets the old answer: it builds.
 * - **Built once per key:** concurrent requests during a build wait on the same build.
 * - **Warmable:** `warmFrontOffice(org)` builds it in the background, after an import (the import calls it; N3.5's
 *   post-import hook list registers it) and after a calibration is recorded. The build yields to the event loop between
 *   departments, so the server keeps answering while it runs.
 * - **Bounded:** a few clubs' builds and a few dozen evidence trails, oldest dropped first.
 *
 * It lives outside `presentation/` because it reads the specialists, some of which reach the season's odds for their
 * own reasons (Major League Ops' urgency leans on the season, D-036); the landing folders never import them, and no
 * odds, posture or window label reaches the payload (D-060, `tests/frontOfficeLanding.test.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeContracts } from './contracts.js';
import type { DeptId } from './contract/presentation.js';
import { DATA_DIR } from './config.js';
import { orgInjuries } from './dashboard.js';
import { currentSaveLocation, getDataStatus } from './dataStatus.js';
import { tableExists } from './db.js';
import { computeFarmSystem } from './farmOperations.js';
import { mlbOverview, mlbResponses } from './mlbOperations.js';
import { catalogClubs } from './org.js';
import { computePayroll } from './payroll.js';
import { importedAt } from './playerStateRoutes.js';
import { departmentOffice, servedDepartments } from './presentation/catalog.js';
import { needTrail } from './presentation/frontOffice/claims.js';
import { assemble, type BuildContext, type DepartmentAnswer } from './presentation/frontOffice/desk.js';
import { farmMaterial } from './presentation/frontOffice/farm.js';
import { financeMaterial } from './presentation/frontOffice/finance.js';
import { majorLeagueMaterial, type MajorLeagueInput } from './presentation/frontOffice/majorLeague.js';
import { medicalMaterial } from './presentation/frontOffice/medical.js';
import type { ClaimTrail, DepartmentReport, FrontOfficeSummary } from './presentation/frontOffice/types.js';
import { readDepartment } from './presentation/severity.js';
import { computeRosterCrunchIssues } from './rosterops.js';
import { onCalibrationRecorded } from './saveCalibration.js';
import { currentOrganization } from './viewingOrganization.js';

/** One club's Front Office for one state of its inputs. */
interface Built {
  key: string;
  orgId: number;
  summary: FrontOfficeSummary;
  reports: Map<DeptId, DepartmentReport>;
  /** What Major League Ops answered, kept for the evidence trails (null when it could not be read). */
  majorLeague: MajorLeagueInput | null;
  /** How long each department took to read and word, in milliseconds (for the measurements). */
  ms: Record<string, number>;
}

const MAX_BUILDS = 4;
const MAX_TRAILS = 32;
const builds = new Map<string, Built>();
const building = new Map<string, Promise<Built>>();
const trails = new Map<string, ClaimTrail>();
let revision = 0;
const stats = { builds: 0, hits: 0, trailBuilds: 0, trailHits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function frontOfficeStats(): Readonly<typeof stats & { cached: number; trailsCached: number }> {
  return { ...stats, cached: builds.size, trailsCached: trails.size };
}

/** Forgets every build and trail, and moves the revision, so the next request builds again. */
export function invalidateFrontOffice(): void {
  revision += 1;
  builds.clear();
  building.clear();
  trails.clear();
}

/** For the tests: empty cache and zero counts. */
export function resetFrontOfficeCache(): void {
  invalidateFrontOffice();
  Object.assign(stats, { builds: 0, hits: 0, trailBuilds: 0, trailHits: 0 });
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

/** The save's location, re-found only when the configuration file changes (a few stats per request, no folder walk). */
let located: { config: string; live: { db: string; wal: string } | null } | null = null;
function liveLogFiles(configKey: string): { db: string; wal: string } | null {
  if (located?.config !== configKey) {
    let live: { db: string; wal: string } | null = null;
    try {
      const where = currentSaveLocation();
      live = where.found && where.live ? { db: where.live.db, wal: where.live.wal } : null;
    } catch {
      live = null;
    }
    located = { config: configKey, live };
  }
  return located.live;
}

/** Everything the answer for this club depends on, as one string. */
function inputsKey(orgId: number): string {
  const config = statKey(path.join(DATA_DIR, 'config.json'));
  const live = liveLogFiles(config);
  return [
    orgId,
    importedAt.value ?? 'none',
    revision,
    statKey(path.join(DATA_DIR, 'settings.json')),
    config,
    live ? `${statKey(live.db)}/${statKey(live.wal)}` : 'no-log',
  ].join('|');
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Each department's "couldn't be read" sentence (the raw error goes to the log). */
const UNREADABLE: Record<string, string> = {
  majorLeague: 'Major League Ops couldn\'t be read this time.',
  farm: 'The farm couldn\'t be read this time.',
  finance: 'Contracts and payroll couldn\'t be read this time.',
  medical: 'The injury report couldn\'t be read this time.',
};

/** Reads every department and words it, yielding to the event loop between departments. */
async function buildFor(orgId: number, key: string): Promise<Built> {
  const ms: Record<string, number> = {};
  const timed = <T>(name: string, run: () => T): T => {
    const started = performance.now();
    try {
      return run();
    } finally {
      ms[name] = Math.round((performance.now() - started) * 10) / 10;
    }
  };
  const status = timed('dataStatus', () => getDataStatus({ importedAt: importedAt.value }));
  const club = catalogClubs().find((c) => c.team_id === orgId)?.label ?? null;
  const build: BuildContext = {
    orgId,
    club,
    importStamp: importedAt.value,
    gameDate: status.csv.simulatedThrough ?? status.csv.currentDate,
  };
  const departments = servedDepartments(orgId);
  const ctxOf = (id: DeptId) => ({ build, department: departments.find((d) => d.id === id)!, office: departmentOffice(id) });
  const answers: Partial<Record<DeptId, DepartmentAnswer>> = {};

  await tick();
  let majorLeague: MajorLeagueInput | null = null;
  answers.majorLeague = timed('majorLeague', () => readDepartment(() => {
    const overview = mlbOverview(orgId);
    const input: MajorLeagueInput = { overview, fortyMan: computeRosterCrunchIssues(orgId) };
    const material = majorLeagueMaterial(ctxOf('majorLeague'), input);
    majorLeague = input;
    return [material];
  }, UNREADABLE.majorLeague));

  await tick();
  answers.farm = timed('farm', () => readDepartment(() => [farmMaterial(ctxOf('farm'), computeFarmSystem(orgId))], UNREADABLE.farm));

  await tick();
  answers.finance = timed('finance', () => readDepartment(() => {
    const contracts = computeContracts(orgId, status);
    let payroll: Parameters<typeof financeMaterial>[1]['payroll'];
    try {
      payroll = { ok: true, body: computePayroll(orgId, status) };
    } catch (err) {
      console.error('[front office] payroll could not be read:', err);
      payroll = { ok: false, reason: 'The payroll couldn\'t be read this time, so the payroll figures are not shown.' };
    }
    return [financeMaterial(ctxOf('finance'), { contracts, payroll })];
  }, UNREADABLE.finance));

  await tick();
  const returns = new Set<number>(
    ((majorLeague as MajorLeagueInput | null)?.overview.needs ?? [])
      .filter((n) => n.kind === 'il_return_crunch' && n.returning)
      .map((n) => n.returning!.playerId),
  );
  answers.medical = timed('medical', () => readDepartment(
    () => [medicalMaterial(ctxOf('medical'), { injuries: orgInjuries(orgId), returnsOnMajorLeagueDesk: returns })],
    UNREADABLE.medical,
  ));

  const { summary, reports } = timed('words', () => assemble(build, departments, departmentOffice, answers));
  return { key, orgId, summary, reports, majorLeague, ms };
}

/** The club's build for the current inputs: the cached one, the one being built, or a new build. */
async function current(orgId: number): Promise<Built> {
  const key = inputsKey(orgId);
  const hit = builds.get(key);
  if (hit) {
    stats.hits += 1;
    return hit;
  }
  const pending = building.get(key);
  if (pending) return pending;
  const started = revision;
  const run = buildFor(orgId, key)
    .then((built) => {
      stats.builds += 1;
      // A build that read across an invalidation is handed to its waiters but not kept
      if (revision === started && inputsKey(orgId) === key) {
        builds.delete(key);
        builds.set(key, built);
        while (builds.size > MAX_BUILDS) builds.delete(builds.keys().next().value!);
      }
      return built;
    })
    .finally(() => {
      if (building.get(key) === run) building.delete(key);
    });
  building.set(key, run);
  return run;
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
  const id = param === 'automatic' ? currentOrganization()?.id ?? null : Number(param);
  if (id === null) throw new FrontOfficeRefusal(NO_CLUB, 404);
  if (!Number.isInteger(id) || id <= 0 || !catalogClubs().some((c) => c.team_id === id)) throw new FrontOfficeRefusal(UNKNOWN_CLUB, 404);
  return id;
}

/** The Morning Report's desk and department cards. */
export async function frontOfficeSummary(orgId: number): Promise<FrontOfficeSummary> {
  return (await current(orgId)).summary;
}

/** One department's full report. */
export async function departmentReport(orgId: number, dept: string): Promise<DepartmentReport> {
  const report = (await current(orgId)).reports.get(dept as DeptId);
  if (!report) throw new FrontOfficeRefusal(UNKNOWN_DEPARTMENT, 404);
  return report;
}

/**
 * The evidence trail behind an item (`<org>.<item key>`), built on demand and kept with the club's build. Only a Major
 * League Ops need has one today (its responses); any other key is refused in a sentence.
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
  const input = built.majorLeague;
  const need = input?.overview.needs.find((n) => n.id === match[2]) ?? null;
  if (!input || !need) throw new FrontOfficeRefusal(UNKNOWN_CLAIM, 404);
  const packet = mlbResponses(orgId, need.id);
  if (!packet) throw new FrontOfficeRefusal(UNKNOWN_CLAIM, 404);
  const departments = servedDepartments(orgId);
  const ctx = {
    build: { orgId, club: built.summary.club, importStamp: built.summary.importStamp, gameDate: built.reports.get('majorLeague')?.summary.basis.source.gameDate ?? null },
    department: departments.find((d) => d.id === 'majorLeague')!,
    office: departmentOffice('majorLeague'),
  };
  const trail = needTrail(ctx, key, need, packet, input.overview);
  stats.trailBuilds += 1;
  trails.set(cacheKey, trail);
  while (trails.size > MAX_TRAILS) trails.delete(trails.keys().next().value!);
  return trail;
}

/**
 * Builds the club's Front Office in the background so the GM's first look is a cached read: after an import (today's
 * import calls it; N3.5's post-import hook list registers it) and after a calibration is recorded. `org` defaults to the
 * served club (configured, else the human's). Never throws: a failure is logged, and the next request builds.
 */
export async function warmFrontOffice(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? currentOrganization()?.id ?? null : org;
    if (orgId === null || !tableExists('players') || !tableExists('teams')) return;
    const started = performance.now();
    const built = await current(orgId);
    console.log(`[front office] warmed club ${orgId} in ${Math.round(performance.now() - started)} ms (${Object.entries(built.ms).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  } catch (err) {
    console.error('[front office] warm-up failed; the next request builds:', err);
  }
}

/** The cold build's timing per department, for the measurements (null when the club has no build). */
export function frontOfficeTimings(orgId: number): Record<string, number> | null {
  const built = builds.get(inputsKey(orgId));
  return built ? { ...built.ms } : null;
}

// A recorded calibration changes the review's yardsticks, so what Major League Ops raises: build again, in the background
onCalibrationRecorded(() => {
  invalidateFrontOffice();
  void warmFrontOffice();
});
