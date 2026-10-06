/**
 * League Office's and Scouting's views, kept (N12 Track B; SWIFTUI_REBUILD.md sections 4.2 and 9; D-072): built once per
 * state of the club's inputs in the Front Office's worker (`leagueViewsBuild.ts`), so a view switch is a cached read and
 * no request waits behind a build. The same rules as the clubhouse tools' (`clubhouseViewService.ts`):
 *
 * - **Keyed on what the answer depends on**, the Front Office's own key (`frontOfficeInputsKey`). A request whose key
 *   moved never gets the old answer, and a build that read across an import's swap is handed to the requests waiting on
 *   it and not kept.
 * - **Warmed** after each kept build of the club's Front Office (`onFrontOfficeKept`). Another club (`:org` is any major
 *   league club) is built on its first open, then kept. **Bounded:** two builds.
 * - **Asked on a click:** Us vs Them against another club, read in the worker and kept with its build (48 at most).
 * - **Player Search** with words or tokens is a bounded query, read in process and kept with its build (64 at most,
 *   oldest dropped first); as it opens, it is the build's own.
 */
import { buildLeagueAsk, buildLeagueViews, buildPlayerSearch, type LeagueAsk, type LeagueViewsResult } from './leagueViewsBuild.js';
import { databaseGeneration, leagueUpgradeUnderWay, tableExists } from './db.js';
import { FrontOfficeRefusal, NO_DATA, frontOfficeInputsKey, frontOfficeStampOf, onFrontOfficeKept, resolveOrg, runDepartmentJob } from './frontOfficeService.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored, assertAuthored } from './presentation/claim.js';
import type {
  LeagueFranchiseView, LeagueLeadersView, LeagueOrgComparisonView, LeagueStandingsView, LeagueUsVsThemView,
} from './presentation/league/types.js';
import type { ScoutingDraftBoardView, ScoutingPlayerSearchView } from './presentation/scouting/types.js';
import { playerSearchAskFrom, playerSearchKey } from './scoutingViews.js';
import { currentOrganization } from './viewingOrganization.js';

interface Kept {
  key: string;
  stamp: string;
  orgId: number;
  importStamp: string | null;
  result: LeagueViewsResult;
  /** Us vs Them against a club asked on a click, by its team id. */
  asked: Map<number, LeagueUsVsThemView>;
  /** Player Search by its ask's key, oldest first. */
  searches: Map<string, ScoutingPlayerSearchView>;
}

const MAX_BUILDS = 2;
const MAX_ASKED = 48;
const MAX_SEARCHES = 64;
const kept = new Map<string, Kept>();
const building = new Map<string, Promise<Kept>>();
const asking = new Map<string, Promise<LeagueUsVsThemView>>();
const stats = { builds: 0, hits: 0, asks: 0, askHits: 0, searches: 0, searchHits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function leagueViewStats(): Readonly<typeof stats & { cached: number }> {
  return { ...stats, cached: kept.size };
}

/** For the tests: an empty cache and zero counts. */
export function resetLeagueViews(): void {
  kept.clear();
  building.clear();
  asking.clear();
  Object.assign(stats, { builds: 0, hits: 0, asks: 0, askHits: 0, searches: 0, searchHits: 0 });
}

export const NOT_AN_OPPONENT = 'That club isn\'t one Us vs Them can set beside yours.';

/** The club's League Office and Scouting views for the current inputs: the kept ones, the ones being built, or a new build. */
async function current(orgId: number): Promise<Kept> {
  if (!tableExists('players')) throw new FrontOfficeRefusal(NO_DATA, 404);
  const upgrade = leagueUpgradeUnderWay();
  if (upgrade) {
    await upgrade;
    return current(orgId);
  }
  const key = frontOfficeInputsKey(orgId);
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
  const job = runDepartmentJob<LeagueViewsResult>({ kind: 'leagueViews', request }, () => buildLeagueViews(request))
    .then((result) => {
      stats.builds += 1;
      // What a worker posts back is checked again claim by claim and registered before a route sends it
      adoptAuthored(result);
      const entry: Kept = { key, stamp, orgId, importStamp: request.importStamp, result, asked: new Map(), searches: new Map() };
      // Kept only when nothing moved under it: no swap to another import, the same inputs
      if (databaseGeneration() === startedGeneration && frontOfficeInputsKey(orgId) === key) {
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

export async function leagueStandingsNow(org: string): Promise<LeagueStandingsView> {
  return (await current(resolveOrg(org))).result.standings;
}

export async function leagueLeadersNow(org: string): Promise<LeagueLeadersView> {
  return (await current(resolveOrg(org))).result.leaders;
}

export async function leagueOrgComparisonNow(org: string): Promise<LeagueOrgComparisonView> {
  return (await current(resolveOrg(org))).result.orgComparison;
}

export async function leagueFranchiseNow(org: string): Promise<LeagueFranchiseView> {
  return (await current(resolveOrg(org))).result.franchise;
}

const one = (value: unknown): string | undefined => (typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined);

/** Us vs Them: against the club it opens on, or (`?team=`) another the GM chose, read on its first ask and kept. */
export async function leagueUsVsThemNow(org: string, team?: unknown): Promise<LeagueUsVsThemView> {
  const entry = await current(resolveOrg(org));
  const asked = one(team) ?? (typeof team === 'number' ? String(team) : undefined);
  if (asked === undefined || asked === '') return entry.result.usVsThem;
  const teamId = Number(asked);
  if (!Number.isInteger(teamId) || !entry.result.opponents.includes(teamId)) throw new FrontOfficeRefusal(NOT_AN_OPPONENT, 404);
  if (teamId === entry.result.usVsThem.query.team) return entry.result.usVsThem;
  const hit = entry.asked.get(teamId);
  if (hit) {
    stats.askHits += 1;
    return hit;
  }
  const key = `${entry.key}#${teamId}`;
  let pending = asking.get(key);
  if (!pending) {
    const ask: LeagueAsk = { kind: 'usVsThem', team: teamId };
    const request = { orgId: entry.orgId, importStamp: entry.importStamp, reportStamp: entry.stamp, ask };
    const startedGeneration = databaseGeneration();
    pending = runDepartmentJob<LeagueUsVsThemView>({ kind: 'leagueAsk', request }, () => buildLeagueAsk(request))
      .then((view) => {
        stats.asks += 1;
        adoptAuthored(view);
        // Kept with its build only when nothing moved under it, as the build itself is
        if (databaseGeneration() !== startedGeneration || frontOfficeInputsKey(entry.orgId) !== entry.key) return view;
        entry.asked.set(teamId, view);
        while (entry.asked.size > MAX_ASKED) entry.asked.delete(entry.asked.keys().next().value!);
        return view;
      })
      .finally(() => asking.delete(key));
    asking.set(key, pending);
  }
  return pending;
}

export async function scoutingDraftBoardNow(org: string): Promise<ScoutingDraftBoardView> {
  return (await current(resolveOrg(org))).result.draftBoard;
}

/**
 * Player Search for the words and tokens asked (`?q=&tokens=`): as it opens, the build's own; otherwise read in process
 * (a bounded query) and kept with the build.
 */
export async function scoutingPlayerSearchNow(org: string, query: Record<string, unknown> = {}): Promise<ScoutingPlayerSearchView> {
  const entry = await current(resolveOrg(org));
  const ask = playerSearchAskFrom(query);
  const key = playerSearchKey(ask);
  if (key === playerSearchKey(playerSearchAskFrom({}))) return entry.result.playerSearch;
  const hit = entry.searches.get(key);
  if (hit) {
    stats.searchHits += 1;
    entry.searches.delete(key);
    entry.searches.set(key, hit);
    return hit;
  }
  const startedGeneration = databaseGeneration();
  const view = buildPlayerSearch({ orgId: entry.orgId, importStamp: entry.importStamp, reportStamp: entry.stamp }, ask);
  stats.searches += 1;
  assertAuthored(view);
  if (databaseGeneration() === startedGeneration && frontOfficeInputsKey(entry.orgId) === entry.key) {
    entry.searches.set(key, view);
    while (entry.searches.size > MAX_SEARCHES) entry.searches.delete(entry.searches.keys().next().value!);
  }
  return view;
}

/** Builds the club's views ahead (never throws): after a kept build of its Front Office, and at a start. */
export async function warmLeagueViews(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? currentOrganization()?.id ?? null : org;
    if (orgId === null || !tableExists('players')) return;
    await current(orgId);
  } catch (err) {
    console.error('[league] the League Office and Scouting views could not be built ahead:', err);
  }
}

// After an import (and any rebuild of the club's Front Office), the club's League Office and Scouting views are built next
onFrontOfficeKept((built) => {
  if (currentOrganization()?.id === built.orgId) void warmLeagueViews(built.orgId);
});
