/**
 * Finance's and Medical's views, kept (N12, D-071; SWIFTUI_REBUILD.md sections 4.2 and 9): built once per state of the
 * club's inputs in the Front Office's worker (`officeViewsBuild.ts`), so a view switch is a cached read and no request
 * waits behind a build.
 *
 * - **Keyed on what the answer depends on** (`officeViewsKey`): the club, the import, the settings and configuration
 *   files and the calibration revision (the Front Office's key without OOTP's live log), and the export's freshness as
 *   derived (its state and how many days behind). The views read the live log only through that freshness (Payroll and
 *   Contracts leave service time blank when the export is behind), so a write to the log that leaves it as it was keeps
 *   them (N12 review, M1). The budget the GM expects next season is a setting, so entering it moves the key and the next
 *   read builds again. A build that read across an import's swap is handed to the requests waiting on it and not kept.
 * - **Warmed** after each kept build of the club's Front Office (`onFrontOfficeKept`): after an import, the club's
 *   Finance and Medical views are ready by the time the GM opens them. Another club's are built on its first open, then
 *   kept until the next import. **Bounded:** four builds, oldest dropped first.
 */
import { databaseGeneration, leagueUpgradeUnderWay, tableExists } from './db.js';
import { freshnessCue, getDataStatus } from './dataStatus.js';
import { FrontOfficeRefusal, NO_DATA, frontOfficeInputsKeyWithoutLog, frontOfficeStampOf, onFrontOfficeKept, resolveOrg, runDepartmentJob } from './frontOfficeService.js';
import { buildOfficeViews, type OfficePart, type OfficeViewsResult } from './officeViewsBuild.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored } from './presentation/claim.js';
import type {
  FinanceBudgetChange, FinanceContractsView, FinanceFreeAgentDetail, FinanceFreeAgentsView, FinanceHorizonView, FinancePayrollView,
} from './presentation/finance/types.js';
import type { MedicalInjuryReportView } from './presentation/medical/injuryReport.js';
import { budgetChange } from './presentation/finance/payroll.js';
import { loadSettings, setNextSeasonBudget } from './settings.js';
import { currentOrganization } from './viewingOrganization.js';

interface Kept {
  key: string;
  result: OfficeViewsResult;
}

const MAX_BUILDS = 4;
const kept = new Map<string, Kept>();
const building = new Map<string, Promise<Kept>>();
const stats = { builds: 0, hits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function officeViewStats(): Readonly<typeof stats & { cached: number }> {
  return { ...stats, cached: kept.size };
}

/** For the tests: an empty cache and zero counts. */
export function resetOfficeViews(): void {
  kept.clear();
  building.clear();
  Object.assign(stats, { builds: 0, hits: 0 });
}

/**
 * What the club's views depend on, as one string: the Front Office's inputs without the live log, and the export's
 * freshness as derived from the save and the log (never the log's raw file stats).
 */
export function officeViewsKey(orgId: number): string {
  const cue = freshnessCue(getDataStatus({ importedAt: importedAt.value }));
  return `${frontOfficeInputsKeyWithoutLog(orgId)}|${cue.state}/${cue.lagDays}`;
}

/** The club's Finance and Medical views for the current inputs: the kept ones, the ones being built, or a new build. */
async function current(orgId: number): Promise<Kept> {
  if (!tableExists('players')) throw new FrontOfficeRefusal(NO_DATA, 404);
  const upgrade = leagueUpgradeUnderWay();
  if (upgrade) {
    await upgrade;
    return current(orgId);
  }
  const key = officeViewsKey(orgId);
  const hit = kept.get(key);
  if (hit) {
    stats.hits += 1;
    return hit;
  }
  const pending = building.get(key);
  if (pending) return pending;
  const startedGeneration = databaseGeneration();
  const request = { orgId, importStamp: importedAt.value, reportStamp: frontOfficeStampOf(key) };
  const job = runDepartmentJob<OfficeViewsResult>({ kind: 'officeViews', request }, () => buildOfficeViews(request))
    .then((result) => {
      stats.builds += 1;
      // What a worker posts back is checked again claim by claim and registered before a route sends it
      adoptAuthored(result);
      const entry: Kept = { key, result };
      // Kept only when nothing moved under it: no swap to another import, the same inputs
      if (databaseGeneration() === startedGeneration && officeViewsKey(orgId) === key) {
        kept.delete(key);
        kept.set(key, entry);
        while (kept.size > MAX_BUILDS) kept.delete(kept.keys().next().value!);
      }
      return entry;
    })
    .finally(() => {
      if (building.get(key) === job) building.delete(key);
    });
  building.set(key, job);
  return job;
}

/** A view of the build, or the refusal it was read with (the route's own sentence and status). */
function viewOf<T>(part: OfficePart<T>): T {
  if (part.ok) return part.view;
  throw new FrontOfficeRefusal(part.reason, 404);
}

export async function financePayrollNow(org: string): Promise<FinancePayrollView> {
  return viewOf((await current(resolveOrg(org))).result.payroll);
}

export async function financeContractsNow(org: string): Promise<FinanceContractsView> {
  return viewOf((await current(resolveOrg(org))).result.contracts);
}

export async function financeFreeAgentsNow(org: string): Promise<FinanceFreeAgentsView> {
  return viewOf((await current(resolveOrg(org))).result.freeAgents);
}

/**
 * One listed free agent's detail (his facts and claims, each with its basis), read from the kept build when the GM
 * chooses his row: the lists never carry it.
 */
export async function financeFreeAgentNow(org: string, player: string): Promise<FinanceFreeAgentDetail> {
  const built = await current(resolveOrg(org));
  viewOf(built.result.freeAgents);
  const detail = /^\d+$/.test(player) ? built.result.freeAgentDetails[String(Number(player))] : undefined;
  if (!detail) throw new FrontOfficeRefusal(FREE_AGENT_NOT_LISTED, 404);
  return detail;
}

/** What a player not on the lists is answered with (a 404). */
export const FREE_AGENT_NOT_LISTED = "He isn't on the free-agent lists.";

export async function financeHorizonNow(org: string): Promise<FinanceHorizonView> {
  return viewOf((await current(resolveOrg(org))).result.horizon);
}

export async function medicalInjuryReportNow(org: string): Promise<MedicalInjuryReportView> {
  return viewOf((await current(resolveOrg(org))).result.injuryReport);
}

/**
 * The budget the GM expects next season, as the React page sets it (`settings.json`, the same entry): a positive amount
 * in dollars keeps it (to the dollar, up to `BUDGET_MAX`), zero clears it (today's budget then holds flat). It answers
 * what it did and the request that puts back what was there (the Mac app's ⌘Z). The settings move the views' key, so
 * the next read of Payroll builds again with it.
 */
export function setFinanceBudget(org: string, body: unknown): FinanceBudgetChange | { refused: string } {
  const orgId = resolveOrg(org);
  const raw = (body as { amount?: unknown } | null)?.amount;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > BUDGET_MAX) return { refused: BUDGET_REFUSED };
  const before = loadSettings().nextSeasonBudget?.[String(orgId)] ?? null;
  return budgetChange(setNextSeasonBudget(orgId, Math.round(raw)), before);
}

/** The most a budget may be: $10 billion, far past any club's, so a slip of the keyboard is refused, never kept. */
export const BUDGET_MAX = 10_000_000_000;

/** What a budget that isn't an amount, or is past the most, is answered with (a 400). */
export const BUDGET_REFUSED = 'The budget is an amount in dollars, up to $10 billion: zero clears it.';

/** Builds the club's views ahead (never throws): after a kept build of its Front Office, and at a start. */
export async function warmOfficeViews(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? currentOrganization()?.id ?? null : org;
    if (orgId === null || !tableExists('players')) return;
    await current(orgId);
  } catch (err) {
    console.error('[finance] the Finance and Medical views could not be built ahead:', err);
  }
}

// After an import (and any rebuild of the club's Front Office), the club's Finance and Medical views are built next
onFrontOfficeKept((built) => {
  if (currentOrganization()?.id === built.orgId) void warmOfficeViews(built.orgId);
});
