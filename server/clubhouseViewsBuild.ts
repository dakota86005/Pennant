/**
 * Major League Ops' clubhouse tools, read and worded (N9; SWIFTUI_REBUILD.md section 9; D-069): each view reads what the
 * React page's route computes, through the extracted module (`computeLineup`, `computeNextGame`,
 * `computePitchingStaff`, `computeSchedule`, `computeGamePlan`, `computeDepthChart`, `computeRosterCrunchIssues`,
 * `computeRoster`, `computeTrends`), and hands it to the pure adapters in `presentation/clubhouse/`. The service
 * (`clubhouseViewService.ts`) runs it in the Front Office's worker thread, so no request waits behind it.
 *
 * Built ahead for the club: every view, the lineup card for each opposing hand, ordering and basis (the league's own DH
 * rule), the plans for the next games, and the major league club's roster. Asked on a click and kept: a card with the
 * DH the league doesn't use, another game's plan, an affiliate's roster.
 */
import type { Computed } from './computed.js';
import type { DeptId } from './contract/presentation.js';
import { computeNextGame } from './dashboard.js';
import { getDataStatus } from './dataStatus.js';
import { computeGamePlan } from './gameplan.js';
import { computeLineup, type LineupAsk, type LineupCard } from './lineup.js';
import { catalogClubs, computeDepthChart } from './org.js';
import { computePitchingStaff } from './pitching.js';
import { departmentOffice, servedDepartments } from './presentation/catalog.js';
import {
  depthChartView, fortyManView, gamePlanView, lineupView, pitchingAvailabilityView, rostersView, scheduleView, seasonTrendsView,
  type ClubhouseContext, type RatingFill,
} from './presentation/clubhouse/index.js';
import type {
  MlbDepthChartView, MlbFortyManView, MlbGamePlanView, MlbLineupView, MlbPitchingAvailabilityView, MlbRostersView, MlbScheduleView,
  MlbSeasonTrendsView,
} from './presentation/clubhouse/types.js';
import type { BuildContext, DepartmentContext } from './presentation/frontOffice/desk.js';
import { computeRoster } from './roster.js';
import { computeRosterCrunchIssues } from './rosterops.js';
import { computeSchedule } from './schedule.js';
import { ratingFillOf } from './scoutedEvidence.js';
import { loadSettings } from './settings.js';
import { computeTrends } from './trends.js';
import { ratingScaleMax } from './valuation.js';

const MLB: DeptId = 'majorLeague';
/** How many of the club's next games have their plan worked out ahead. */
export const PLANS_AHEAD = 6;

/** What one build of the clubhouse tools is asked for. */
export interface ClubhouseViewsRequest {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
}

/** A lineup card's key: its ask, as one string. */
export const lineupKey = (ask: LineupAsk): string => `${ask.vs}.${ask.style}.${ask.dh}.${ask.sort}`;

/** What a build hands back (plain data, so a worker can post it). */
export interface ClubhouseViewsResult {
  /** The card the view opens on: against the next game's starter's hand, the staff's ordering, built from talent. */
  defaultAsk: LineupAsk;
  lineups: Array<{ key: string; view: MlbLineupView }>;
  pitching: MlbPitchingAvailabilityView;
  schedule: MlbScheduleView;
  plans: Array<{ gameId: number; view: MlbGamePlanView }>;
  depth: MlbDepthChartView;
  fortyMan: MlbFortyManView;
  rosters: Array<{ teamId: number; view: MlbRostersView }>;
  trends: MlbSeasonTrendsView;
  /** The organization's clubs (the roster's choices), the major league club first. */
  clubs: Array<{ teamId: number; label: string; levelName: string }>;
  /** The club's games, by id (a plan is asked only for one of them). */
  games: number[];
  /** How long each part took, in milliseconds. */
  ms: Record<string, number>;
}

/** One view asked on a click: a lineup another way, a game's plan, a club's roster. */
export type ClubhouseAsk =
  | { kind: 'lineup'; ask: LineupAsk }
  | { kind: 'plan'; gameId: number }
  | { kind: 'roster'; teamId: number; clubs: ClubhouseViewsResult['clubs'] };

export interface ClubhouseAskRequest extends ClubhouseViewsRequest {
  ask: ClubhouseAsk;
}

function contextFor(request: ClubhouseViewsRequest): ClubhouseContext {
  const status = getDataStatus({ importedAt: request.importStamp });
  const club = catalogClubs().find((c) => c.team_id === request.orgId)?.label ?? null;
  const build: BuildContext = {
    orgId: request.orgId,
    club,
    importStamp: request.importStamp,
    reportStamp: request.reportStamp,
    gameDate: status.csv.simulatedThrough ?? status.csv.currentDate,
  };
  const department = servedDepartments(request.orgId).find((d) => d.id === MLB)!;
  const ctx: DepartmentContext = { build, department, office: departmentOffice(MLB) };
  return { ctx };
}

/** A computed answer, or the sentence it was refused with. */
const bodyOr = <T>(c: Computed<T>): T | string => (c.ok ? c.body : c.error);

/** OSA's view filling in for our scouts, for each player named (D-067). */
function fillsFor(ids: Iterable<number>): Map<number, RatingFill> {
  const out = new Map<number, RatingFill>();
  for (const id of ids) if (!out.has(id)) out.set(id, ratingFillOf(id));
  return out;
}

/** The lineup cards one build reads, by ask: each is read once (the run search is most of a card's cost). */
type Cards = Map<string, LineupCard | string>;

function cardFor(cards: Cards, orgId: number, ask: LineupAsk): LineupCard | string {
  const key = lineupKey(ask);
  let card = cards.get(key);
  if (card === undefined) {
    card = bodyOr(computeLineup(orgId, ask));
    cards.set(key, card);
  }
  return card;
}

function lineupOf(v: ClubhouseContext, orgId: number, ask: LineupAsk, next: ReturnType<typeof computeNextGame>, cards: Cards = new Map()): MlbLineupView {
  const card = cardFor(cards, orgId, ask);
  const ids = typeof card === 'string' ? [] : card.lineup.map((l) => l.player_id);
  return lineupView(v, { ask, card, next, fills: fillsFor(ids) });
}

function planOf(v: ClubhouseContext, orgId: number, gameId: number, cards: Cards = new Map()): MlbGamePlanView {
  const plan = bodyOr(computeGamePlan(orgId, gameId));
  let card: LineupCard | string | null = null;
  if (typeof plan !== 'string') {
    // The lineup builder already ranks hitters by platoon split, so the plan's card is its answer for the starter's hand
    card = cardFor(cards, orgId, { vs: plan.lineupVs === 'l' ? 'l' : 'r', style: 'saber', dh: 'auto', sort: 'talent' });
  }
  return gamePlanView(v, { plan, card, gameId });
}

function rosterOf(v: ClubhouseContext, teamId: number, clubs: ClubhouseViewsResult['clubs']): MlbRostersView {
  return rostersView(v, { teamId, roster: bodyOr(computeRoster(teamId)), clubs });
}

export function buildClubhouseViews(request: ClubhouseViewsRequest): ClubhouseViewsResult {
  const ms: Record<string, number> = {};
  const timed = <T>(name: string, run: () => T): T => {
    const started = performance.now();
    try {
      return run();
    } finally {
      ms[name] = Math.round((performance.now() - started) * 10) / 10;
    }
  };
  const v = contextFor(request);
  const orgId = request.orgId;
  const next = timed('nextGame', () => computeNextGame(orgId));
  const defaultAsk: LineupAsk = { vs: next?.theirStarter?.throws === 'L' ? 'l' : 'r', style: 'saber', dh: 'auto', sort: 'talent' };
  const cards: Cards = new Map();
  const lineups = timed('lineups', () => {
    const out: ClubhouseViewsResult['lineups'] = [];
    for (const vs of ['r', 'l'] as const) {
      for (const style of ['saber', 'trad'] as const) {
        for (const sort of ['talent', 'production'] as const) {
          const ask: LineupAsk = { vs, style, dh: 'auto', sort };
          out.push({ key: lineupKey(ask), view: lineupOf(v, orgId, ask, next, cards) });
        }
      }
    }
    return out;
  });
  const pitching = timed('pitching', () => pitchingAvailabilityView(v, { staff: bodyOr(computePitchingStaff(orgId)) }));
  const scheduleBody = timed('scheduleRead', () => bodyOr(computeSchedule(orgId)));
  const schedule = timed('schedule', () => scheduleView(v, { schedule: scheduleBody }));
  const games = typeof scheduleBody === 'string' || !('series' in scheduleBody)
    ? []
    : scheduleBody.series.flatMap((s) => s.games.map((g) => ({ id: g.game_id, played: g.played })));
  const plans = timed('plans', () => games.filter((g) => !g.played).slice(0, PLANS_AHEAD).map((g) => ({ gameId: g.id, view: planOf(v, orgId, g.id, cards) })));
  const chart = timed('depthRead', () => bodyOr(computeDepthChart(orgId)));
  const depth = timed('depth', () => depthChartView(v, {
    chart,
    fills: fillsFor(typeof chart === 'string' ? [] : chart.players.map((p) => p.player_id)),
    rating: { scaleMax: ratingScaleMax(), roundToFive: loadSettings().roundRatingsToFive === true },
  }));
  const clubs = typeof chart === 'string'
    ? [{ teamId: orgId, label: v.ctx.build.club ?? 'The major league club', levelName: 'MLB' }]
    : chart.teams.filter((t) => t.team_id > 0).map((t) => ({ teamId: t.team_id, label: `${t.label}`.trim() || t.name, levelName: t.levelName }));
  const fortyMan = timed('fortyMan', () => fortyManView(v, { crunch: bodyOr(computeRosterCrunchIssues(orgId)) }));
  const rosters = timed('rosters', () => [{ teamId: orgId, view: rosterOf(v, orgId, clubs) }]);
  const trends = timed('trends', () => seasonTrendsView(v, { trends: bodyOr(computeTrends(orgId)) }));
  return { defaultAsk, lineups, pitching, schedule, plans, depth, fortyMan, rosters, trends, clubs, games: games.map((g) => g.id), ms };
}

/** One view asked on a click (in the worker): a lineup another way, a game's plan, or a club's roster. */
export function buildClubhouseAsk(request: ClubhouseAskRequest): MlbLineupView | MlbGamePlanView | MlbRostersView {
  const v = contextFor(request);
  const { ask } = request;
  if (ask.kind === 'lineup') return lineupOf(v, request.orgId, ask.ask, computeNextGame(request.orgId));
  if (ask.kind === 'plan') return planOf(v, request.orgId, ask.gameId);
  return rosterOf(v, ask.teamId, ask.clubs);
}
