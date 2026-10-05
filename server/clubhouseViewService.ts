/**
 * Major League Ops' clubhouse tools, kept (N9; SWIFTUI_REBUILD.md sections 4.2 and 9; D-069): built once per state of the
 * club's inputs in the Front Office's worker (`clubhouseViewsBuild.ts`), so a view switch is a cached read and no
 * request waits behind a build.
 *
 * - **Keyed on what the answer depends on**, the Front Office's own key (`frontOfficeInputsKey`: the club, the import,
 *   the settings and configuration files, the live log, the calibration revision). A request whose key moved never gets
 *   the old answer, and a build that read across an import's swap is handed to the requests waiting on it and not kept.
 * - **Warmed** after each kept build of the club's Front Office (`onFrontOfficeKept`): after an import, the club's
 *   clubhouse tools are ready by the time the GM opens them: every view, the card for each hand, ordering and basis,
 *   the next games' plans and the major league roster.
 * - **Asked on a click** (a card with the DH the league doesn't use, another game's plan, an affiliate's roster): read
 *   in the worker and kept with its build. **Bounded:** two builds and 48 asked views each, oldest dropped first.
 */
import {
  buildClubhouseAsk, buildClubhouseViews, lineupKey, type ClubhouseAsk, type ClubhouseViewsResult,
} from './clubhouseViewsBuild.js';
import { databaseGeneration, leagueUpgradeUnderWay, tableExists } from './db.js';
import { FrontOfficeRefusal, NO_DATA, frontOfficeInputsKey, frontOfficeStampOf, onFrontOfficeKept, resolveOrg, runDepartmentJob } from './frontOfficeService.js';
import type { LineupAsk } from './lineup.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored } from './presentation/claim.js';
import type {
  MlbDepthChartView, MlbFortyManView, MlbGamePlanView, MlbLineupView, MlbPitchingAvailabilityView, MlbRostersView, MlbScheduleView,
  MlbSeasonTrendsView,
} from './presentation/clubhouse/types.js';
import { currentOrganization } from './viewingOrganization.js';

interface Kept {
  key: string;
  stamp: string;
  orgId: number;
  importStamp: string | null;
  result: ClubhouseViewsResult;
  /** Every view kept with this build, ahead or asked: `lineup:<ask>`, `plan:<game>`, `roster:<team>`. */
  views: Map<string, MlbLineupView | MlbGamePlanView | MlbRostersView>;
  /** How many were asked on a click (only those are dropped when the bound is reached). */
  asked: string[];
}

const MAX_BUILDS = 2;
const MAX_ASKED = 48;
const kept = new Map<string, Kept>();
const building = new Map<string, Promise<Kept>>();
const asking = new Map<string, Promise<MlbLineupView | MlbGamePlanView | MlbRostersView>>();
const stats = { builds: 0, hits: 0, asks: 0, askHits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function clubhouseViewStats(): Readonly<typeof stats & { cached: number }> {
  return { ...stats, cached: kept.size };
}

/** For the tests: an empty cache and zero counts. */
export function resetClubhouseViews(): void {
  kept.clear();
  building.clear();
  asking.clear();
  Object.assign(stats, { builds: 0, hits: 0, asks: 0, askHits: 0 });
}

export const NOT_OUR_GAME = 'That game isn\'t on the club\'s schedule.';
export const NOT_OUR_CLUB = 'That club isn\'t one of the organization\'s.';

/** The club's clubhouse tools for the current inputs: the kept ones, the ones being built, or a new build. */
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
  const job = runDepartmentJob<ClubhouseViewsResult>({ kind: 'clubhouseViews', request }, () => buildClubhouseViews(request))
    .then((result) => {
      stats.builds += 1;
      // What a worker posts back is checked again claim by claim and registered before a route sends it
      adoptAuthored(result);
      const views = new Map<string, MlbLineupView | MlbGamePlanView | MlbRostersView>();
      for (const l of result.lineups) views.set(`lineup:${l.key}`, l.view);
      for (const p of result.plans) views.set(`plan:${p.gameId}`, p.view);
      for (const r of result.rosters) views.set(`roster:${r.teamId}`, r.view);
      const entry: Kept = { key, stamp, orgId, importStamp: request.importStamp, result, views, asked: [] };
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

/** A view of the build, kept ahead or asked before; else read on the click in the worker, then kept. */
async function viewFor<T extends MlbLineupView | MlbGamePlanView | MlbRostersView>(entry: Kept, id: string, ask: ClubhouseAsk): Promise<T> {
  const hit = entry.views.get(id);
  if (hit) {
    stats.askHits += 1;
    return hit as T;
  }
  const key = `${entry.key}#${id}`;
  let pending = asking.get(key);
  if (!pending) {
    const request = { orgId: entry.orgId, importStamp: entry.importStamp, reportStamp: entry.stamp, ask };
    pending = runDepartmentJob<MlbLineupView | MlbGamePlanView | MlbRostersView>({ kind: 'clubhouseAsk', request }, () => buildClubhouseAsk(request))
      .then((view) => {
        stats.asks += 1;
        adoptAuthored(view);
        entry.views.set(id, view);
        entry.asked.push(id);
        while (entry.asked.length > MAX_ASKED) entry.views.delete(entry.asked.shift()!);
        return view;
      })
      .finally(() => asking.delete(key));
    asking.set(key, pending);
  }
  return (await pending) as T;
}

const one = (value: unknown): string | undefined => (typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined);

/** A lineup ask from a request's query: each part as asked, else the card the view opens on. */
export function lineupAskFrom(query: Record<string, unknown>, fallback: LineupAsk): LineupAsk {
  const vs = one(query.vs);
  const style = one(query.style);
  const dh = one(query.dh);
  const sort = one(query.sort);
  return {
    vs: vs === 'l' || vs === 'r' ? vs : fallback.vs,
    style: style === 'saber' || style === 'trad' ? style : fallback.style,
    dh: dh === 'auto' || dh === 'on' || dh === 'off' ? dh : fallback.dh,
    sort: sort === 'talent' || sort === 'production' ? sort : fallback.sort,
  };
}

/** The lineup card for an ask (the view's own card when the query asks nothing). */
export async function clubhouseLineupNow(org: string, query: Record<string, unknown> = {}): Promise<MlbLineupView> {
  const entry = await current(resolveOrg(org));
  const ask = lineupAskFrom(query, entry.result.defaultAsk);
  return viewFor<MlbLineupView>(entry, `lineup:${lineupKey(ask)}`, { kind: 'lineup', ask });
}

export async function clubhousePitchingNow(org: string): Promise<MlbPitchingAvailabilityView> {
  return (await current(resolveOrg(org))).result.pitching;
}

export async function clubhouseScheduleNow(org: string): Promise<MlbScheduleView> {
  return (await current(resolveOrg(org))).result.schedule;
}

const idOf = (param: unknown, refusal: string): number => {
  const id = Number(one(param) ?? param);
  if (!Number.isInteger(id) || id <= 0) throw new FrontOfficeRefusal(refusal, 404);
  return id;
};

/** One game's plan: worked out ahead for the next games, else on the click (in the worker), then kept. */
export async function clubhouseGamePlanNow(org: string, game: unknown): Promise<MlbGamePlanView> {
  const gameId = idOf(game, NOT_OUR_GAME);
  const entry = await current(resolveOrg(org));
  if (!entry.result.games.includes(gameId)) throw new FrontOfficeRefusal(NOT_OUR_GAME, 404);
  return viewFor<MlbGamePlanView>(entry, `plan:${gameId}`, { kind: 'plan', gameId });
}

export async function clubhouseDepthNow(org: string): Promise<MlbDepthChartView> {
  return (await current(resolveOrg(org))).result.depth;
}

export async function clubhouseFortyManNow(org: string): Promise<MlbFortyManView> {
  return (await current(resolveOrg(org))).result.fortyMan;
}

/** One of the organization's clubs' roster: the major league club's ahead, an affiliate's on the click, then kept. */
export async function clubhouseRostersNow(org: string, team?: unknown): Promise<MlbRostersView> {
  const entry = await current(resolveOrg(org));
  const teamId = team === undefined || team === '' ? entry.orgId : idOf(team, NOT_OUR_CLUB);
  if (!entry.result.clubs.some((c) => c.teamId === teamId)) throw new FrontOfficeRefusal(NOT_OUR_CLUB, 404);
  return viewFor<MlbRostersView>(entry, `roster:${teamId}`, { kind: 'roster', teamId, clubs: entry.result.clubs });
}

export async function clubhouseTrendsNow(org: string): Promise<MlbSeasonTrendsView> {
  return (await current(resolveOrg(org))).result.trends;
}

/** Builds the club's clubhouse tools ahead (never throws): after a kept build of its Front Office, and at a start. */
export async function warmClubhouseViews(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? currentOrganization()?.id ?? null : org;
    if (orgId === null || !tableExists('players')) return;
    await current(orgId);
  } catch (err) {
    console.error('[clubhouse] the clubhouse tools could not be built ahead:', err);
  }
}

// After an import (and any rebuild of the club's Front Office), the club's clubhouse tools are built next, in the worker
onFrontOfficeKept((built) => {
  if (currentOrganization()?.id === built.orgId) void warmClubhouseViews(built.orgId);
});
