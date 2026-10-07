/**
 * League Office's and Scouting's views, read and worded (N12 Track B; SWIFTUI_REBUILD.md section 9; D-072). Each view
 * reads what the React page's route computes, through its extracted module, and hands it to the pure adapters in
 * `presentation/league/` and `presentation/scouting/`. The service (`leagueViewService.ts`) runs it in the Front
 * Office's worker thread, so no request waits behind it.
 *
 * Built ahead for the club: Standings, Leaders, Franchise History, Us vs Them against the default opponent, the Draft
 * Board, and Player Search as it opens; then Org Comparison on its own (`buildLeagueAsk`), so its 1.7 s on a real save
 * holds up no other view. Asked on a click and kept: Us vs Them against another club.
 * Player Search with words or tokens is read in process (`leagueViewService.ts`): it is a bounded query.
 */
import type { DeptId } from './contract/presentation.js';
import { getDataStatus } from './dataStatus.js';
import { catalogClubs } from './org.js';
import { departmentOffice, servedDepartments } from './presentation/catalog.js';
import type { BuildContext } from './presentation/frontOffice/desk.js';
import type { OfficeContext } from './presentation/league/common.js';
import type {
  LeagueFranchiseView, LeagueLeadersView, LeagueOrgComparisonView, LeagueStandingsView, LeagueUsVsThemView,
} from './presentation/league/types.js';
import type { ScoutingDraftBoardView, ScoutingPlayerSearchView } from './presentation/scouting/types.js';
import { franchiseUnread, franchiseViewOf, orgComparisonUnread, orgComparisonViewOf } from './leagueHistoryViews.js';
import { leadersUnread, leadersViewOf } from './leagueLeadersViews.js';
import { opponentsOf, standingsUnread, standingsViewOf, usVsThemOf, usVsThemUnread } from './leagueStandingsViews.js';
import {
  DEFAULT_SEARCH, draftBoardUnread, draftBoardViewOf, playerSearchUnread, playerSearchViewOf, type PlayerSearchAsk,
} from './scoutingViews.js';

/** What one build of the League Office and Scouting views is asked for. */
export interface LeagueViewsRequest {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
}

/** What a build hands back (plain data, so a worker can post it). */
export interface LeagueViewsResult {
  standings: LeagueStandingsView;
  leaders: LeagueLeadersView;
  franchise: LeagueFranchiseView;
  /** Us vs Them against the club it opens on (the next opponent, else the nearest in the standings). */
  usVsThem: LeagueUsVsThemView;
  /** The clubs Us vs Them can set beside ours (a club outside them is refused in words). */
  opponents: number[];
  draftBoard: ScoutingDraftBoardView;
  /** Player Search as it opens (no words, no tokens). */
  playerSearch: ScoutingPlayerSearchView;
  /** The parts that couldn't be read this time (each logged, its view worded as such). */
  failed: string[];
  /** How long each part took, in milliseconds. */
  ms: Record<string, number>;
}

/** One view built on its own: Us vs Them against another club (asked on a click), or Org Comparison (after the rest). */
export type LeagueAsk = { kind: 'usVsThem'; team: number } | { kind: 'orgComparison' };

export interface LeagueAskRequest extends LeagueViewsRequest {
  ask: LeagueAsk;
}

/** A view's context for its department (League Office or Scouting), with the build's stamps and game date. */
export function officeContextFor(request: LeagueViewsRequest, dept: DeptId): OfficeContext {
  const status = getDataStatus({ importedAt: request.importStamp });
  const club = catalogClubs().find((c) => c.team_id === request.orgId)?.label ?? null;
  const build: BuildContext = {
    orgId: request.orgId,
    club,
    importStamp: request.importStamp,
    reportStamp: request.reportStamp,
    gameDate: status.csv.simulatedThrough ?? status.csv.currentDate,
  };
  const department = servedDepartments(request.orgId).find((d) => d.id === dept)!;
  return { ctx: { build, department, office: departmentOffice(dept) } };
}

/**
 * One part of a build, on its own (as the clubhouse tools' are): a part that throws is logged and becomes its view's
 * worded "couldn't be read", never a failed build, so one part can't take down the other views.
 */
function partOf<T>(failed: string[], name: string, what: string, read: () => T, instead: (why: string) => T): T {
  try {
    return read();
  } catch (err) {
    console.error(`[league] ${name} could not be read:`, err);
    failed.push(name);
    return instead(`${what} couldn't be read this time`);
  }
}

export function buildLeagueViews(request: LeagueViewsRequest): LeagueViewsResult {
  const ms: Record<string, number> = {};
  const failed: string[] = [];
  const part = <T>(name: string, what: string, read: () => T, instead: (why: string) => T): T => {
    const started = performance.now();
    try {
      return partOf(failed, name, what, read, instead);
    } finally {
      ms[name] = Math.round((performance.now() - started) * 10) / 10;
    }
  };
  const league = officeContextFor(request, 'league');
  const scouting = officeContextFor(request, 'scouting');
  const orgId = request.orgId;
  const standings = part('standings', 'The standings', () => standingsViewOf(league, orgId), (why) => standingsUnread(league, why));
  const leaders = part('leaders', 'The league leaders', () => leadersViewOf(league, orgId), (why) => leadersUnread(league, why));
  const franchise = part('franchise', 'The franchise\'s history', () => franchiseViewOf(league, orgId), (why) => franchiseUnread(league, why));
  const opponents = part('opponents', 'The other clubs', () => opponentsOf(orgId), () => []);
  const usVsThem = part('usVsThem', 'Us vs Them', () => usVsThemOf(league, orgId, null), (why) => usVsThemUnread(league, null, why));
  const draftBoard = part('draftBoard', 'The draft board', () => draftBoardViewOf(scouting, orgId), (why) => draftBoardUnread(scouting, why));
  const playerSearch = part('playerSearch', 'Player search', () => playerSearchViewOf(scouting, orgId, DEFAULT_SEARCH),
    (why) => playerSearchUnread(scouting, DEFAULT_SEARCH, why));
  return { standings, leaders, franchise, usVsThem, opponents, draftBoard, playerSearch, failed, ms };
}

/** One view built on its own (in the worker): Us vs Them against another club, or Org Comparison. */
export function buildLeagueAsk(request: LeagueAskRequest): LeagueUsVsThemView | LeagueOrgComparisonView {
  const league = officeContextFor(request, 'league');
  const failed: string[] = [];
  const ask = request.ask;
  if (ask.kind === 'orgComparison') {
    return partOf(failed, 'orgComparison', 'The organizations\' comparison', () => orgComparisonViewOf(league, request.orgId),
      (why) => orgComparisonUnread(league, why));
  }
  return partOf(failed, `usVsThem ${ask.team}`, 'Us vs Them', () => usVsThemOf(league, request.orgId, ask.team),
    (why) => usVsThemUnread(league, ask.team, why));
}

/** Player Search for one ask, read in process (a bounded query); its words are the scouting staff's. */
export function buildPlayerSearch(request: LeagueViewsRequest, ask: PlayerSearchAsk): ScoutingPlayerSearchView {
  const scouting = officeContextFor(request, 'scouting');
  const failed: string[] = [];
  return partOf(failed, 'playerSearch', 'Player search', () => playerSearchViewOf(scouting, request.orgId, ask),
    (why) => playerSearchUnread(scouting, ask, why));
}
