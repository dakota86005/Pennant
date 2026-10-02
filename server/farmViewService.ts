/**
 * Farm & Development's views, kept (N10; SWIFTUI_REBUILD.md sections 4.2 and 9): built once per state of the club's
 * inputs in the Front Office's worker (`farmViewsBuild.ts`), so a view switch is a cached read and no request waits
 * behind a build.
 *
 * - **Keyed on what the answer depends on**, the Front Office's own key (`frontOfficeInputsKey`: the club, the import,
 *   the settings and configuration files, the live log, the calibration revision) and where the save's rating history
 *   stands (`snapshotWriteCount`): the snapshot is written by a post-import hook after the swap, so the farm may warm
 *   before it, and the next request then builds again rather than missing the newest snapshot for a whole import. A request whose key moved never gets
 *   the old answer, and a build that read across an import's swap is handed to the requests waiting on it and not kept.
 *   This keeps D-047's promise: the organization is read once per build (one `FarmSession`), and nothing is served across
 *   an export, a philosophy setting or the live log.
 * - **Warmed** after each kept build of the club's Front Office (`onFrontOfficeKept`): after an import, the club's farm
 *   views are ready by the time the GM opens them. The players the desk raises have their decisions worked out ahead.
 * - **A decision for anyone else** is read on the click, in the worker (about a quarter of a second on a real save), and
 *   kept with its build. **Bounded:** two builds and 48 decisions, oldest dropped first.
 */
import { databaseGeneration, leagueUpgradeUnderWay, tableExists } from './db.js';
import { buildFarmDecision, buildFarmViews, type FarmViewsResult } from './farmViewsBuild.js';
import { FrontOfficeRefusal, NO_DATA, frontOfficeInputsKey, frontOfficeStampOf, onFrontOfficeKept, resolveOrg, runDepartmentJob } from './frontOfficeService.js';
import { snapshotWriteCount } from './history.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored } from './presentation/claim.js';
import type {
  FarmAffiliatesView, FarmAssignmentsView, FarmDecisionView, FarmDevelopmentDetail, FarmDevelopmentView, FarmOrganizationView, FarmProspectsView,
} from './presentation/farm/types.js';
import { currentOrganization } from './viewingOrganization.js';

interface Kept {
  key: string;
  stamp: string;
  orgId: number;
  importStamp: string | null;
  result: FarmViewsResult;
  decisions: Map<number, FarmDecisionView>;
  details: Map<number, FarmDevelopmentDetail>;
}

const MAX_BUILDS = 2;
const MAX_DECISIONS = 48;
const kept = new Map<string, Kept>();
const building = new Map<string, Promise<Kept>>();
const decisionsBuilding = new Map<string, Promise<FarmDecisionView | null>>();
const stats = { builds: 0, hits: 0, decisionBuilds: 0, decisionHits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function farmViewStats(): Readonly<typeof stats & { cached: number }> {
  return { ...stats, cached: kept.size };
}

/** For the tests: an empty cache and zero counts. */
export function resetFarmViews(): void {
  kept.clear();
  building.clear();
  decisionsBuilding.clear();
  Object.assign(stats, { builds: 0, hits: 0, decisionBuilds: 0, decisionHits: 0 });
}

export const NOT_ON_THE_FARM = 'He isn\'t on one of the organization\'s minor-league clubs in this export.';
export const NOT_TRACKED = 'There is no scouting history for him in this save.';

/** The farm's key: the Front Office's inputs and where the save's rating history stands (Development tracking reads it). */
const farmKey = (orgId: number): string => `${frontOfficeInputsKey(orgId)}|h${snapshotWriteCount()}`;

/** The club's farm views for the current inputs: the kept ones, the ones being built, or a new build. */
async function current(orgId: number): Promise<Kept> {
  if (!tableExists('players')) throw new FrontOfficeRefusal(NO_DATA, 404);
  const upgrade = leagueUpgradeUnderWay();
  if (upgrade) {
    await upgrade;
    return current(orgId);
  }
  const key = farmKey(orgId);
  const hit = kept.get(key);
  if (hit) {
    stats.hits += 1;
    return hit;
  }
  const pending = building.get(key);
  if (pending) return pending;
  const startedGeneration = databaseGeneration();
  const stamp = frontOfficeStampOf(key);
  const request = { orgId, importStamp: importedAt.value, reportStamp: stamp };
  const job = runDepartmentJob<FarmViewsResult>({ kind: 'farmViews', request }, () => buildFarmViews(request))
    .then((result) => {
      stats.builds += 1;
      // What a worker posts back is checked again claim by claim and registered before a route sends it
      adoptAuthored(result.views);
      const entry: Kept = {
        key, stamp, orgId, importStamp: request.importStamp, result,
        decisions: new Map(result.views.decisions.map((d) => [d.playerId, d])),
        details: new Map(result.views.developmentDetails.map((d) => [d.playerId, d])),
      };
      // Kept only when nothing moved under it: no swap to another import, the same inputs
      if (databaseGeneration() === startedGeneration && farmKey(orgId) === key) {
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

export async function farmOrganizationNow(org: string): Promise<FarmOrganizationView> {
  return (await current(resolveOrg(org))).result.views.organization;
}

export async function farmAffiliatesNow(org: string): Promise<FarmAffiliatesView> {
  return (await current(resolveOrg(org))).result.views.affiliates;
}

export async function farmAssignmentsNow(org: string): Promise<FarmAssignmentsView> {
  return (await current(resolveOrg(org))).result.views.assignments;
}

export async function farmProspectsNow(org: string): Promise<FarmProspectsView> {
  return (await current(resolveOrg(org))).result.views.prospects;
}

export async function farmDevelopmentNow(org: string): Promise<FarmDevelopmentView> {
  return (await current(resolveOrg(org))).result.views.development;
}

const playerIdOf = (param: string): number => {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) throw new FrontOfficeRefusal('That isn\'t a player Pennant knows.', 404);
  return id;
};

/** One player's development history in this save, from the kept build. */
export async function farmDevelopmentDetailNow(org: string, player: string): Promise<FarmDevelopmentDetail> {
  const id = playerIdOf(player);
  const detail = (await current(resolveOrg(org))).details.get(id);
  if (!detail) throw new FrontOfficeRefusal(NOT_TRACKED, 404);
  return detail;
}

/** One player's Decision: worked out ahead for the desk's players, else on the click (in the worker), then kept. */
export async function farmDecisionNow(org: string, player: string): Promise<FarmDecisionView> {
  const id = playerIdOf(player);
  const entry = await current(resolveOrg(org));
  const hit = entry.decisions.get(id);
  if (hit) {
    stats.decisionHits += 1;
    return hit;
  }
  if (!entry.result.system.assignments.some((a) => a.playerId === id)) throw new FrontOfficeRefusal(NOT_ON_THE_FARM, 404);
  const key = `${entry.key}#${id}`;
  let pending = decisionsBuilding.get(key);
  if (!pending) {
    const request = { orgId: entry.orgId, importStamp: entry.importStamp, reportStamp: entry.stamp, playerId: id, system: entry.result.system };
    pending = runDepartmentJob<FarmDecisionView | null>({ kind: 'farmDecision', request }, () => buildFarmDecision(request))
      .then((view) => {
        stats.decisionBuilds += 1;
        if (view) {
          adoptAuthored(view);
          entry.decisions.set(id, view);
          while (entry.decisions.size > MAX_DECISIONS) entry.decisions.delete(entry.decisions.keys().next().value!);
        }
        return view;
      })
      .finally(() => decisionsBuilding.delete(key));
    decisionsBuilding.set(key, pending);
  }
  const view = await pending;
  if (!view) throw new FrontOfficeRefusal(NOT_ON_THE_FARM, 404);
  return view;
}

/** Builds the club's farm views ahead (never throws): after a kept build of its Front Office, and at a start. */
export async function warmFarmViews(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? currentOrganization()?.id ?? null : org;
    if (orgId === null || !tableExists('players')) return;
    await current(orgId);
  } catch (err) {
    console.error('[farm] the farm\'s views could not be built ahead:', err);
  }
}

// After an import (and any rebuild of the club's Front Office), the club's farm views are built next, in the worker
onFrontOfficeKept((built) => {
  if (currentOrganization()?.id === built.orgId) void warmFarmViews(built.orgId);
});
