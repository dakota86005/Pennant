/**
 * Major League Ops' clubhouse tools for the Mac app (SWIFTUI_REBUILD.md section 9, N9; D-069): Lineup, Pitching
 * Availability, Schedule & Game Plans, Depth Chart, 40-Man & Options, Rosters and Season Trends, each one payload under
 * `/api/v2/views/:org/majorLeague/<view>`. They are built from what the React pages' routes already compute (the
 * extracted `computeLineup`, `computePitchingStaff`, `computeSchedule`, `computeGamePlan`, `computeDepthChart`,
 * `computeRosterCrunch`, `computeRoster`, `computeTrends`), worded once here: no rule, threshold, rank or verdict is made
 * in these adapters or in Swift (D-001, D-024, D-056).
 *
 * They reuse N8's shapes (a table of rows with their detail, blocks of lines, a player who opens) so the app draws them
 * with the components it already has; what is new here is a view's own choices (sent back exactly as served), a section
 * of a view (a titled table), a depth chart's positions and a season's lines for a chart. Nothing here carries the
 * season's odds or a deadline posture (D-060).
 */
import type { Cell, Claim } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { MlbBlock, MlbLine, MlbPlayer, MlbTable, MlbViewHead } from '../majorLeague/types.js';

/** A titled table of a view (the bullpen, the 40-man, a club's hitters): its words above it and a note under it. */
export interface MlbTableSection {
  /** Structural: where the app keeps the table's columns, never shown. */
  id: string;
  title: Cell;
  /** One line about the section ("3 of 8 limited or unavailable"); null when there is nothing to say. */
  summary: Cell | null;
  table: MlbTable;
  /** A note under the table, with its detail in the basis; null when there is none. */
  note: Claim | null;
}

// ── Lineup ──────────────────────────────────────────────────────────────────

/** What a lineup card is asked for: the opposing hand, the ordering, the DH and what the order is built from. */
export interface MlbLineupQuery {
  vs: string;
  style: string;
  dh: string;
  sort: string;
}

/** One of the GM's choices for the card, sent back exactly as served (the server builds the card again). */
export interface MlbLineupChoice {
  text: Cell;
  selected: boolean;
  query: MlbLineupQuery;
}

/** A group of choices (against which hand, how the order is written, what it is built from, the DH). */
export interface MlbLineupChoices {
  title: Cell;
  choices: MlbLineupChoice[];
}

/**
 * The staff's lineup card for one ask (D-001: the staff's view, never an order; Pennant never writes it to OOTP): the
 * next game and its starters, the GM's choices, the order with each slot's reason, the bench, who is unavailable and
 * who the scouts have not graded.
 */
export interface MlbLineupView extends MlbViewHead {
  query: MlbLineupQuery;
  /** The next game: when, where, and each side's projected starter; null when none is scheduled. */
  tonight: MlbBlock | null;
  /** The card against the next game's starter, when it is not the one shown. */
  againstTonight: MlbLineupChoice | null;
  choices: MlbLineupChoices[];
  /** The staff's view of the card in one line; how it was written, ranked and searched in its basis. */
  headline: Claim | null;
  /** What else the card says about itself (the run search, a DH the league doesn't use). */
  notes: Claim[];
  order: MlbTable;
  /** The bench, who is unavailable and who isn't scouted: each man once, a line of his own that opens him. */
  bench: MlbBlock | null;
  notScouted: MlbBlock | null;
  unavailable: MlbBlock | null;
  /** Why there is no card (too few position players, nothing imported); null when there is one. */
  empty: Cell | null;
}

// ── Pitching Availability ───────────────────────────────────────────────────

/**
 * Who can pitch tonight: the bullpen as a rest calendar (each of the last days' pitches, the last three days' load and
 * the availability it reads, toned rested, limited or down), the rotation and the starting depth.
 */
export interface MlbPitchingAvailabilityView extends MlbViewHead {
  /** The day the calendar counts back from (the last game played), in words; null when no game has been played. */
  through: Cell | null;
  sections: MlbTableSection[];
  empty: Cell | null;
}

// ── Schedule & Game Plans ───────────────────────────────────────────────────

/** What a game's plan is asked for. */
export interface MlbGamePlanQuery {
  game: Integer;
}

/** The season's schedule: the record, how the club has done against each opponent, and every game with its plan. */
export interface MlbScheduleView extends MlbViewHead {
  /** The record as figures (overall, home and away, runs); empty with no game played. */
  record: Claim[];
  headToHead: MlbTableSection | null;
  games: MlbTableSection;
  /** The filters (full season, still to play, played), each naming the rows it keeps in its own order (played: the latest first). */
  filters: Array<{ text: Cell; rows: string[] }>;
  /** The row the view opens on: the next game to play; null when the season is over or unscheduled. */
  nextRow: string | null;
  note: Claim;
  empty: Cell | null;
  /** What the plan's place says before a game is chosen. */
  choose: Cell;
}

/** One game's plan: their starter, our card against his hand, how our hitters have fared, and their dangerous bats. */
export interface MlbGamePlanView extends MlbViewHead {
  /** The schedule row it belongs to. */
  rowId: string;
  query: MlbGamePlanQuery;
  game: Cell;
  starter: MlbLine;
  /** What this export could not supply, in a sentence; null when nothing is missing. */
  missing: Cell | null;
  card: MlbBlock;
  sections: MlbTableSection[];
}

// ── Depth Chart ─────────────────────────────────────────────────────────────

/** A man at a position: who, and his age and scouted now and ceiling in words, with the OSA mark where it applies. */
export interface MlbDepthEntry {
  player: MlbPlayer;
  line: Cell;
}

/** A position's depth at one club, deepest-first as the scouts grade them now. */
export interface MlbDepthPosition {
  /** The position's short name ("SS", "SP"): the field's place for it. */
  id: string;
  title: Cell;
  players: MlbDepthEntry[];
  /** How many more there are past the first three (a plate on the field shows three), with their names; null with none. */
  more: Cell | null;
  /** The sentence when nobody plays it here. */
  empty: Cell | null;
}

/** One club of the organization (or the players nobody has assigned yet) and its depth at every position. */
export interface MlbDepthClub {
  teamId: Integer;
  title: Cell;
  level: Cell;
  positions: MlbDepthPosition[];
}

export interface MlbDepthChartView extends MlbViewHead {
  clubs: MlbDepthClub[];
  /**
   * The organization's depth at each position, every level in one table (N9 review): who is behind a man at his
   * position, from the major league club down, deepest first at each club. The same reading as `clubs`.
   */
  byPosition: MlbTableSection[];
  /** How the depth is ordered, with what it leaves out in its basis. */
  note: Claim;
  empty: Cell | null;
}

// ── 40-Man & Options ────────────────────────────────────────────────────────

export interface MlbFortyManView extends MlbViewHead {
  /** The roster's counts against the league's limits, as figures. */
  figures: Claim[];
  sections: MlbTableSection[];
  empty: Cell | null;
}

// ── Rosters ─────────────────────────────────────────────────────────────────

/** What a club's roster is asked for: the organization's club, by team id. */
export interface MlbRosterQuery {
  team: Integer;
}

/** One of the organization's clubs, as a choice. */
export interface MlbRosterChoice {
  text: Cell;
  selected: boolean;
  query: MlbRosterQuery;
}

/** A club's roster: its hitters and its pitchers, each a table with the scouts' grades and the season's lines. */
export interface MlbRostersView extends MlbViewHead {
  query: MlbRosterQuery;
  clubs: MlbRosterChoice[];
  sections: MlbTableSection[];
  empty: Cell | null;
}

// ── Season Trends ───────────────────────────────────────────────────────────

/** A point on a line: the game's number in the season, its date in words, the value (null: the line has none yet). */
export interface MlbTrendPoint {
  game: Integer;
  date: string;
  value: number | null;
  display: string;
}

/** One line of a chart: its name, its role (the app's fixed colour for it) and its points. */
export interface MlbTrendSeries {
  id: string;
  title: Cell;
  /** `main`, `scored` or `allowed`: which of the chart's fixed colours draws it. */
  role: string;
  points: MlbTrendPoint[];
}

/** One chart: its title and headline, what its lines mean, its axis's name and a rule it draws (the zero, .500). */
export interface MlbTrendChart {
  id: string;
  title: Cell;
  headline: Cell | null;
  caption: Claim;
  axis: Cell;
  baseline: number | null;
  series: MlbTrendSeries[];
  /** The whole chart in a sentence, for VoiceOver's chart summary. */
  summary: string;
}

export interface MlbSeasonTrendsView extends MlbViewHead {
  summary: Claim | null;
  charts: MlbTrendChart[];
  empty: Cell | null;
}
