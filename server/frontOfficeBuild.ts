/**
 * One club's Front Office, read and worded (V2 plan section 4.4): each department's specialist through its public
 * module, handed to the pure adapters in `presentation/frontOffice/`. And the evidence trail behind one Major League Ops
 * need. The service (`frontOfficeService.ts`) runs these in a worker thread (`frontOfficeWorker.ts`), so no request waits
 * behind a build, and in-process only when no worker can be started.
 *
 * A department whose export lacks what it reads says so in a sentence (D-018): the export has no contracts, no roster
 * status or no season, which no later read would change. Any other failure is "couldn't be read this time", with the
 * raw error in the log. Neither is ever read as all clear.
 */
import { computeContracts } from './contracts.js';
import type { DeptId } from './contract/presentation.js';
import { orgInjuries } from './dashboard.js';
import { getDataStatus } from './dataStatus.js';
import { tableExists } from './db.js';
import { computeFarmSystem } from './farmOperations.js';
import { leagueRulesForOrganization } from './leagueRules.js';
import { mlbOverview, mlbResponses } from './mlbOperations.js';
import { catalogClubs } from './org.js';
import { computePayroll } from './payroll.js';
import { departmentOffice, servedDepartments } from './presentation/catalog.js';
import { needTrail } from './presentation/frontOffice/claims.js';
import { assemble, type BuildContext, type DepartmentAnswer, type DepartmentContext } from './presentation/frontOffice/desk.js';
import { farmMaterial } from './presentation/frontOffice/farm.js';
import { financeMaterial } from './presentation/frontOffice/finance.js';
import { majorLeagueMaterial, type MajorLeagueInput } from './presentation/frontOffice/majorLeague.js';
import { medicalMaterial } from './presentation/frontOffice/medical.js';
import type { ClaimTrail, DepartmentReport, FrontOfficeSummary } from './presentation/frontOffice/types.js';
import { readDepartment } from './presentation/severity.js';
import { computeRosterCrunchIssues } from './rosterops.js';
import { LEVEL_NAMES } from './valuation.js';

/** What a build hands back (plain data, so a worker can post it). */
export interface BuildResult {
  summary: FrontOfficeSummary;
  reports: Array<[DeptId, DepartmentReport]>;
  /** What Major League Ops answered, kept for the evidence trails (null when it could not be read). */
  majorLeague: MajorLeagueInput['overview'] | null;
  /** How long each department took to read and word, in milliseconds. */
  ms: Record<string, number>;
}

/** What one build is asked for. */
export interface BuildRequest {
  orgId: number;
  /** The import it reads (`importedAt`), passed in so a worker never guesses it. */
  importStamp: string | null;
  /** The stamp of this build's inputs, served in every payload (`reportStamp`). */
  reportStamp: string;
}

/** Each department's "couldn't be read" sentence for a failure no one can name (the raw error goes to the log). */
const UNREADABLE: Record<string, string> = {
  majorLeague: 'Major League Ops couldn\'t be read this time.',
  farm: 'The farm couldn\'t be read this time.',
  finance: 'Contracts and payroll couldn\'t be read this time.',
  medical: 'The injury report couldn\'t be read this time.',
};

/** What the export lacks for a department, in a sentence; null when it has what the department reads. */
export function missingFor(department: 'finance' | 'medical', orgId: number): string | null {
  if (department === 'medical') {
    return tableExists('players_roster_status') ? null : 'The export has no roster status, so the injured list can\'t be read.';
  }
  if (!tableExists('players_contract')) return 'The export has no contracts, so Finance can\'t report on them.';
  if (!tableExists('players_roster_status')) return 'The export has no roster status, so Finance can\'t tell who is on the roster.';
  let season: number | null = null;
  try {
    season = leagueRulesForOrganization(orgId).contract.season.value;
  } catch {
    season = null;
  }
  return season === null ? 'The export doesn\'t say which season it is, so Finance can\'t report on contracts.' : null;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function contextFor(orgId: number, importStamp: string | null, reportStamp: string): { build: BuildContext; departments: ReturnType<typeof servedDepartments> } {
  const status = getDataStatus({ importedAt: importStamp });
  const club = catalogClubs().find((c) => c.team_id === orgId)?.label ?? null;
  return {
    build: { orgId, club, importStamp, reportStamp, gameDate: status.csv.simulatedThrough ?? status.csv.currentDate },
    departments: servedDepartments(orgId),
  };
}

/** Reads every department and words it, yielding to the event loop between departments. */
export async function buildFrontOffice(request: BuildRequest): Promise<BuildResult> {
  const { orgId, importStamp, reportStamp } = request;
  const ms: Record<string, number> = {};
  const timed = <T>(name: string, run: () => T): T => {
    const started = performance.now();
    try {
      return run();
    } finally {
      ms[name] = Math.round((performance.now() - started) * 10) / 10;
    }
  };
  const status = timed('dataStatus', () => getDataStatus({ importedAt: importStamp }));
  const { build, departments } = contextFor(orgId, importStamp, reportStamp);
  const ctxOf = (id: DeptId): DepartmentContext => ({ build, department: departments.find((d) => d.id === id)!, office: departmentOffice(id) });
  const answers: Partial<Record<DeptId, DepartmentAnswer>> = {};

  await tick();
  let majorLeague: MajorLeagueInput['overview'] | null = null;
  answers.majorLeague = timed('majorLeague', () => readDepartment(() => {
    const overview = mlbOverview(orgId);
    const material = majorLeagueMaterial(ctxOf('majorLeague'), { overview, fortyMan: computeRosterCrunchIssues(orgId) });
    majorLeague = { needs: overview.needs, roster: overview.roster, unknowns: overview.unknowns, yardsticks: overview.yardsticks };
    return [material];
  }, UNREADABLE.majorLeague));

  await tick();
  answers.farm = timed('farm', () => readDepartment(() => [farmMaterial(ctxOf('farm'), computeFarmSystem(orgId))], UNREADABLE.farm));

  await tick();
  const financeMissing = missingFor('finance', orgId);
  answers.finance = financeMissing
    ? { status: 'unavailable', reason: financeMissing }
    : timed('finance', () => readDepartment(() => {
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
    ((majorLeague as MajorLeagueInput['overview'] | null)?.needs ?? [])
      .filter((n) => n.kind === 'il_return_crunch' && n.returning)
      .map((n) => n.returning!.playerId),
  );
  const medicalMissing = missingFor('medical', orgId);
  answers.medical = medicalMissing
    ? { status: 'unavailable', reason: medicalMissing }
    : timed('medical', () => readDepartment(
      () => [medicalMaterial(ctxOf('medical'), { injuries: orgInjuries(orgId), returnsOnMajorLeagueDesk: returns })],
      UNREADABLE.medical,
    ));

  const { summary, reports } = timed('words', () => assemble(build, departments, departmentOffice, answers));
  return { summary, reports: [...reports.entries()], majorLeague, ms };
}

/** What one evidence trail is asked for. */
export interface TrailRequest {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
  key: string;
  needId: string;
  /** Major League Ops' answer the build kept (the need is read from it, never re-derived). */
  overview: MajorLeagueInput['overview'];
}

/** The staff's responses to one Major League Ops need, worded; null when the need is no longer open. */
export function buildTrail(request: TrailRequest): ClaimTrail | null {
  const need = request.overview.needs.find((n) => n.id === request.needId) ?? null;
  if (!need) return null;
  const packet = mlbResponses(request.orgId, need.id);
  if (!packet) return null;
  const { build, departments } = contextFor(request.orgId, request.importStamp, request.reportStamp);
  const ctx: DepartmentContext = { build, department: departments.find((d) => d.id === 'majorLeague')!, office: departmentOffice('majorLeague') };
  return needTrail(ctx, request.key, need, packet, request.overview, (level) => LEVEL_NAMES[level] ?? null);
}
