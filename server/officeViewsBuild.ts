/**
 * Finance's and Medical's views, read and worded (N12, D-071): each view reads what the React page's route computes,
 * through its module (`computePayroll`, `computeContracts`, `computeFreeAgents`, Club Finances' `clubFinances`,
 * `leagueFinances` and its route's `marketPriceHistory`, `orgInjuries`), and the Horizon Board reads Player Value's control timelines
 * (`playerValues`) and the farm's next men (`farmNextByPosition`, as the roster map does), all handed to the pure
 * adapters in `presentation/finance/` and `presentation/medical/`. The service (`officeViewService.ts`) runs it in the
 * Front Office's worker thread, so no request waits behind it. Each part is read on its own: a part that throws is
 * logged and its view says it couldn't be read this time, never taking down the others.
 */
import { marketPriceHistory } from './clubFinanceRoutes.js';
import { computeContracts } from './contracts.js';
import type { DeptId } from './contract/presentation.js';
import { orgInjuries } from './dashboard.js';
import { getDataStatus, freshnessCue, type DataStatus } from './dataStatus.js';
import { computeFreeAgents } from './freeagents.js';
import { farmNextByPosition } from './mlbEvidence.js';
import { computePayroll } from './payroll.js';
import { organizationPlayerStates } from './playerState.js';
import { clubFinances, controlSeasonLabel, leagueFinances, marketLeagueOfClub, playerValues } from './playerValue.js';
import { servedDepartments } from './presentation/catalog.js';
import { cell } from './presentation/claim.js';
import { contractsView } from './presentation/finance/contracts.js';
import { freeAgentsView } from './presentation/finance/freeAgents.js';
import { horizonView, type HorizonPlayerInput } from './presentation/finance/horizon.js';
import { payrollView } from './presentation/finance/payroll.js';
import type { FinanceContractsView, FinanceFreeAgentsView, FinanceHorizonView, FinancePayrollView } from './presentation/finance/types.js';
import { farmMan } from './presentation/frontOffice/morning.js';
import { injuryReportView, type MedicalInjuryReportView } from './presentation/medical/injuryReport.js';
import type { OfficeContext, OfficeFreshness } from './presentation/officeTable.js';
import { ratingFillOf } from './scoutedEvidence.js';

/** What one build of Finance's and Medical's views is asked for. */
export interface OfficeViewsRequest {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
}

/** A view, or why it couldn't be read: the sentence the route answers with and its status. */
export type OfficePart<T> = { ok: true; view: T } | { ok: false; reason: string };

/** What a build hands back (plain data, so a worker can post it). */
export interface OfficeViewsResult {
  payroll: OfficePart<FinancePayrollView>;
  contracts: OfficePart<FinanceContractsView>;
  freeAgents: OfficePart<FinanceFreeAgentsView>;
  horizon: OfficePart<FinanceHorizonView>;
  injuryReport: OfficePart<MedicalInjuryReportView>;
  /** The parts that couldn't be read this time (each logged). */
  failed: string[];
  /** How long each part took, in milliseconds. */
  ms: Record<string, number>;
}

export const NOT_READ = "couldn't be read this time.";
/** The seasons the Horizon Board lays out after this one. */
export const HORIZON_SEASONS = 3;

function contextFor(request: OfficeViewsRequest, department: DeptId, freshness: OfficeFreshness, status: DataStatus): OfficeContext {
  const dept = servedDepartments(request.orgId).find((d) => d.id === department);
  return {
    orgId: request.orgId,
    importStamp: request.importStamp,
    reportStamp: request.reportStamp,
    gameDate: status.csv.simulatedThrough ?? status.csv.currentDate,
    preparedBy: dept?.preparedBy ?? cell(department === 'medical' ? 'Prepared by the medical staff' : 'Prepared by the front office'),
    department,
    freshness,
  };
}

/**
 * A part read on its own. A refusal the route itself words (a missing table, an unknown club: an error with a
 * `status`, or one of the routes' own sentences) is answered as worded; anything else is logged and said plainly.
 */
function partOf<T>(failed: string[], ms: Record<string, number>, name: string, what: string, read: () => T): OfficePart<T> {
  const started = performance.now();
  try {
    return { ok: true, view: read() };
  } catch (err) {
    const e = err as Error & { status?: number };
    const worded = typeof e.status === 'number' || /^(No |Unknown |The league's current season|The export's)/.test(e.message ?? '');
    if (!worded) {
      console.error(`[finance] ${name} could not be read:`, err);
      failed.push(name);
    }
    return { ok: false, reason: worded ? e.message : `${what} ${NOT_READ}` };
  } finally {
    ms[name] = Math.round((performance.now() - started) * 10) / 10;
  }
}

/** The Horizon Board's reading: the major leaguers' control over the next seasons, the farm's next men and the money. */
function horizonOf(ctx: OfficeContext, orgId: number, payroll: ReturnType<typeof computePayroll> | null, payrollWhy: string | null, state: string): FinanceHorizonView {
  const thisSeason = payroll?.seasonYear ?? null;
  const majors = organizationPlayerStates(orgId).filter((s) => s.level.value === 1);
  const values = playerValues(majors.map((s) => s.playerId), { currentState: state as never });
  const anySeason = thisSeason ?? [...values.values()].map((v) => v.control.thisSeason).find((x): x is number => typeof x === 'number') ?? null;
  if (anySeason === null) throw Object.assign(new Error("The league's current season is not in the export, so the seasons ahead can't be laid out."), { status: 404 });
  const seasons = Array.from({ length: HORIZON_SEASONS }, (_, i) => anySeason + 1 + i);
  const players: HorizonPlayerInput[] = majors.map((s) => {
    const v = values.get(s.playerId);
    const timeline = v?.control ?? null;
    const read = timeline !== null && timeline.standing !== 'unknown';
    return {
      playerId: s.playerId,
      name: s.name,
      position: s.position.value,
      role: s.role.value,
      seasons: read ? timeline!.seasons.filter((c) => seasons.includes(c.season)).map((c) => ({
        season: c.season, status: c.status, label: controlSeasonLabel(c), between: [...c.between], basis: c.basis,
      })) : [],
      controlEnds: read ? timeline!.controlEnds : null,
      unknown: read ? null : (timeline?.notes[0] ?? 'His control is not established from the export.'),
    };
  });
  const next = farmNextByPosition(orgId);
  const farmNext = new Map([...next].map(([pos, list]) => [pos, list.map(farmMan)]));
  const budget = payroll?.finances.budget.value ?? null;
  return horizonView(ctx, {
    thisSeason: anySeason,
    seasons,
    players,
    farmNext,
    payroll: payroll
      ? payroll.commitments.filter((c) => c.year >= anySeason && c.year <= anySeason + HORIZON_SEASONS).map((c) => ({
          season: c.year,
          committed: c.total,
          budget: c.year > anySeason ? (payroll.nextSeasonBudget ?? budget) : budget,
        }))
      : [],
    budget,
    payrollUnknown: payroll ? null : payrollWhy ?? `Payroll ${NOT_READ}`,
    fillOf: ratingFillOf,
  });
}

/** Builds Finance's and Medical's views for one club. */
export function buildOfficeViews(request: OfficeViewsRequest): OfficeViewsResult {
  const failed: string[] = [];
  const ms: Record<string, number> = {};
  const status = getDataStatus({ importedAt: request.importStamp });
  const cue = freshnessCue(status);
  const orgId = request.orgId;
  const plain = (department: DeptId, limitations: readonly string[] = []) => contextFor(request, department, { ...cue, limitations }, status);

  const read: { payroll: ReturnType<typeof computePayroll> | null } = { payroll: null };
  const payroll = partOf(failed, ms, 'payroll', 'Payroll', () => {
    const p = computePayroll(orgId, status);
    read.payroll = p;
    const marketId = marketLeagueOfClub(orgId);
    return payrollView(plain('finance', p.freshness.limitations), {
      payroll: p,
      club: clubFinances(orgId),
      league: marketId === null ? null : leagueFinances(marketId),
      history: marketId === null ? [] : marketPriceHistory(marketId),
    });
  });
  const payrollWhy = payroll.ok ? null : payroll.reason;
  const contracts = partOf(failed, ms, 'contracts', 'Contracts', () => {
    const c = computeContracts(orgId, status);
    return contractsView(plain('finance', c.freshness.limitations), c);
  });
  const freeAgents = partOf(failed, ms, 'freeAgents', 'Free agents', () => {
    const f = computeFreeAgents(orgId, status);
    return freeAgentsView(plain('finance', f.freshness.limitations), f, ratingFillOf);
  });
  const horizon = partOf(failed, ms, 'horizon', 'The horizon board', () => horizonOf(plain('finance'), orgId, read.payroll, payrollWhy, cue.state));
  const injuryReport = partOf(failed, ms, 'injuryReport', 'The injury report', () => injuryReportView(plain('medical'), orgInjuries(orgId)));
  return { payroll, contracts, freeAgents, horizon, injuryReport, failed, ms };
}
