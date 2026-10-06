/**
 * League Office's views for the Mac app (SWIFTUI_REBUILD.md section 9, N12 Track B; D-072): Standings, Leaders, Org
 * Comparison, Franchise History and Us vs Them, each one payload under `/api/v2/views/:org/league/<view>`. They are built
 * from what the React pages' routes already compute (`computeStandings`, the leaderboards, `computeOrgComparison`, the
 * franchise and tenure reads), worded once here: no rule, threshold, rank or verdict is made in these adapters or in
 * Swift (D-001, D-056).
 *
 * They reuse N8's and N9's small shapes (a head, a block of lines, a player who opens) and add one table that can name a
 * club as well as a player (`OfficeRow`), which Scouting's views use too. Standings is the one place the season's odds
 * and the deadline posture appear (D-060): as the staff's rough read, labelled with its basis, never the headline.
 */
import type { Cell, Claim, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { MlbBlock, MlbColumn, MlbRow, MlbViewHead } from '../majorLeague/types.js';

// ── What League Office and Scouting share ───────────────────────────────────

/** A club a view names: its id, its name, whether it is ours, and where it opens (its club window). */
export interface OfficeClub {
  teamId: Integer;
  name: string;
  abbr: string | null;
  ours: boolean;
  open: Target;
}

/**
 * A row of a League Office or Scouting table: N8's row (its cells and sort keys, the player it is about with his OSA
 * mark, its detail and what it offers to open), the club it is about when it is about one (a standings line), and
 * whether it is ours (drawn marked, never the only signal: the club's or player's cell says so too).
 */
export interface OfficeRow extends MlbRow {
  club?: OfficeClub;
  ours?: boolean;
}

/** A table, ready to show: its columns, its rows in the served order, and its sentence when it has none. */
export interface OfficeTable {
  columns: MlbColumn[];
  rows: OfficeRow[];
  empty: Cell | null;
}

/** A titled table of a view (a division, a leader category, the season by season): its line above it and a note under it. */
export interface OfficeSection {
  /** Structural: where the app keeps the table's columns, never shown. */
  id: string;
  title: Cell;
  summary: Cell | null;
  table: OfficeTable;
  note: Claim | null;
}

/** One choice of a group, sent back exactly as served (`?<group id>=<value>`). */
export interface OfficeChoice {
  text: Cell;
  selected: boolean;
  value: string;
}

/** A group of the GM's choices for a view (the opponent, the batters or the pitchers): the query parameter it sets. */
export interface OfficeChoiceGroup {
  /** The query parameter the choice is sent as (`team`). */
  id: string;
  title: Cell;
  choices: OfficeChoice[];
}

// ── Standings ───────────────────────────────────────────────────────────────

/** A league's half (a sub-league, "American League"), its divisions each a table. */
export interface LeagueStandingsGroup {
  title: Cell;
  divisions: OfficeSection[];
}

/**
 * The staff's rough read of the season (D-060): the postseason odds and the deadline posture, shown only here, never the
 * view's headline, each with its basis (a two-club race on run differential against a rival of a stated strength, a
 * provisional number never fitted), and what it leaves out in a sentence.
 */
export interface LeagueStaffRead {
  title: Cell;
  odds: Claim;
  posture: Claim;
  /** What the read rests on, one line each (the record, the runs, the race, the games left, the deadline). */
  reasons: Cell[];
  /** What it leaves out, in a sentence. */
  caveat: Cell;
}

export interface LeagueStandingsView extends MlbViewHead {
  groups: LeagueStandingsGroup[];
  /** Our club's place in the race as facts (the division, the wild card); empty when it isn't in these standings. */
  race: Claim[];
  /** The staff's rough read (odds and posture, D-060); null when it can't be read (no game played, no race). */
  staffRead: LeagueStaffRead | null;
  /** Why the staff's rough read isn't shown, in a sentence (no game played yet, no race to read); absent when it is shown. */
  staffReadWhy?: Cell;
  /** How to read the columns (pace, magic number, run differential), the full words in its basis. */
  note: Claim;
  empty: Cell | null;
}

// ── Leaders ─────────────────────────────────────────────────────────────────

/** Batting or pitching: its categories, each a table of the top ten. */
export interface LeagueLeaderGroup {
  id: string;
  title: Cell;
  sections: OfficeSection[];
}

export interface LeagueLeadersView extends MlbViewHead {
  /** The season the leaders are for, in words; null when the export names none. */
  season: Cell | null;
  /** Who qualifies for a rate (plate appearances and innings), with how it is worked out in its basis. */
  qualifier: Claim | null;
  groups: LeagueLeaderGroup[];
  empty: Cell | null;
}

// ── Org Comparison ──────────────────────────────────────────────────────────

export interface LeagueOrgComparisonView extends MlbViewHead {
  /** How current the export is, with what it leaves out in its basis; null when it is current. */
  freshness: Claim | null;
  /** Our organization's figures (the roster's wins, the farm's, contract value, payroll), each a range with the league's middle. */
  figures: Claim[];
  /** Every major league club of the league, ours marked, in the specialist's order. */
  clubs: OfficeTable;
  note: Claim;
  empty: Cell | null;
}

// ── Franchise History ───────────────────────────────────────────────────────

/** One season on the record chart: its year, wins and losses, how it ended (`title`, `playoffs`, `none`) and its words. */
export interface LeagueSeasonPoint {
  year: Integer;
  wins: Integer;
  losses: Integer;
  /** `title`, `playoffs` or `none`: which of the chart's fixed marks draws it. */
  result: string;
  /** The season in words, for the chart's help and VoiceOver ("1987: 96-66, won it all"). */
  display: string;
}

/** The season record as a chart: its title, what its marks mean, the seasons oldest first, and the whole in a sentence. */
export interface LeagueSeasonChart {
  title: Cell;
  caption: Claim;
  axis: Cell;
  points: LeagueSeasonPoint[];
  /** The chart in a sentence, for VoiceOver's chart summary. */
  summary: string;
  /** What each mark means, one entry per result code (`title`, `playoffs`, `none`, in that order): the legend's words. */
  legend: LeagueChartLegend[];
}

/** One entry of a season chart's legend: the result code it draws and its served words ("Won it all"). */
export interface LeagueChartLegend {
  result: string;
  text: Cell;
}

/** The GM's own seasons (OOTP's manager history): a line per season, whichever club. */
export interface LeagueTenure {
  title: Cell;
  lede: Cell;
  figures: Claim[];
  seasons: OfficeSection;
}

export interface LeagueFranchiseView extends MlbViewHead {
  club: OfficeClub;
  /** Seasons, all-time record, titles, best and worst season. */
  figures: Claim[];
  chart: LeagueSeasonChart | null;
  /** Every season, latest first (finish, best players, payroll and attendance served hidden when no season has them). */
  seasons: OfficeSection;
  tenure: LeagueTenure | null;
  empty: Cell | null;
}

// ── Us vs Them ──────────────────────────────────────────────────────────────

/** Which club ours is set beside. */
export interface LeagueOpponentQuery {
  team: Integer;
}

/**
 * Our club beside one other, as facts (D-060: no odds, no posture, no verdict on who is better): the season, at the
 * plate, on the mound, each line with both clubs' figures and their league places, and how they have done against each
 * other.
 */
export interface LeagueUsVsThemView extends MlbViewHead {
  query: LeagueOpponentQuery;
  us: OfficeClub;
  them: OfficeClub | null;
  /** The clubs ours can be set beside (the next opponent first chosen), sent back as `team`. */
  opponents: OfficeChoiceGroup;
  /** Their meetings this season, as a fact; null before they have met (said in `meetings`). */
  headToHead: Claim | null;
  /** The meetings' detail and the next series, as lines. */
  meetings: MlbBlock | null;
  sections: OfficeSection[];
  note: Claim;
  empty: Cell | null;
  /** How the club beside ours was chosen when the GM didn't choose ("Opened on your next opponent"); absent when chosen. */
  opened?: Cell;
}
