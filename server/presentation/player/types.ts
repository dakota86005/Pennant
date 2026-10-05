/**
 * The player window's payloads (SWIFTUI_REBUILD.md section 9, N11): the dossier (`GET /api/v2/player/:id`), the GM's
 * notes on him (`/api/v2/player/:id/notes`) and two to four players side by side (`GET /api/v2/compare`). Every visible
 * sentence is a served `Cell` or `Claim` with its basis; the Mac app lays them out, draws the served numbers as bars,
 * ranges and lines, and computes nothing about the player (D-001, D-056).
 */
import type { Cell, Claim, Row, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { GameDate } from '../../dataFreshness.js';

/** One labelled fact ("Bats / throws" · "R / R"), with its basis where it has one. */
export interface PlayerFact {
  label: Cell;
  value: Cell;
  claim: Claim | null;
}

/** A served table's column: its id (a key of each row's cells), its title and whether it holds numbers. */
export interface PlayerColumn {
  id: string;
  title: Cell;
  numeric: boolean;
}

/** A table row: a cell and a raw sort key per column (null is unknown and sorts last both ways). */
export interface PlayerTableRow extends Row<string> {}

/** A table, ready to show: its rows in the served order, and its sentence when it has none. */
export interface PlayerTable {
  id: string;
  title: Cell;
  columns: PlayerColumn[];
  rows: PlayerTableRow[];
  empty: Cell | null;
  /** One quiet line under it (what the table leaves out, how to read it). */
  note: Cell | null;
}

/** A small tile in the header: what it is (its hover says more), the figure as a claim, and its lines. */
export interface PlayerTile {
  id: string;
  title: Cell;
  figure: Claim;
  lines: Cell[];
}

/** The window's header: who he is, where he plays, and the three tiles (his deal, his value, his scouted tools). */
export interface PlayerHeaderView {
  name: string;
  /** "#27", when he wears a number. */
  number: Cell | null;
  /** His nickname as the export writes it (a name, not Pennant's words). */
  nickname: string | null;
  /** "SS · Two-way · Bats R, throws R · Age 27". */
  line: Cell;
  /** His club as the export places him ("Reno Aces (AAA)"), or "No club". */
  club: Cell;
  /** His organization's club window, when the export names one. */
  clubOpen: Target | null;
  injury: Claim | null;
  tiles: PlayerTile[];
  /** How current the data is ("As of May 16, 2026"), with what may be out of date. */
  freshness: Claim;
  /** OSA's view filling in for our scouts (D-067): the mark ("OSA") and its sentence, null when our scouts rate him. */
  ratingsFill: Cell | null;
}

/** Why he is where he is, as the export and the transaction log establish it, with its source. */
export interface PlayerAssignmentView {
  claim: Claim;
  lines: Cell[];
}

/** The overview: the facts a GM reads first, why he is where he is, and this season's line. */
export interface PlayerOverview {
  facts: PlayerFact[];
  assignment: PlayerAssignmentView | null;
  /** This season's line at his highest level ("AAA · 312 PA · .281/.355/.470 · 14 HR"). */
  thisSeason: Claim | null;
  /** His honours in a line ("3× All-Star · MVP 2031"). */
  honours: Cell | null;
  /** The roster moves worth knowing about, from Player Rights (the full statement is on Contract & rights). */
  rights: PlayerRightsAction[];
}

/** One grade: the tool, and the grade now and at its ceiling as served. Bars are drawn from `now` and `ceiling`. */
export interface PlayerRatingRow extends Row<'tool' | 'grade'> {
  now: number | null;
  ceiling: number | null;
}

/** A group of grades (Batting, Pitching, Arsenal, Positions, Fielding). */
export interface PlayerRatingGroup {
  id: string;
  title: Cell;
  rows: PlayerRatingRow[];
  note: Cell | null;
}

/** One snapshot on the rating-history chart, in the order taken (a game date is never parsed by the app). */
export interface PlayerHistoryPoint {
  index: Integer;
  date: GameDate;
  label: Cell;
  now: number | null;
  ceiling: number | null;
}

/** His rating history in this save: the points, a table of them, and a change of source said (D-067). */
export interface PlayerRatingHistory {
  title: Cell;
  points: PlayerHistoryPoint[];
  table: PlayerTable | null;
  empty: Cell | null;
  sourceSwitch: Claim | null;
  /** The chart's served words for VoiceOver (each snapshot's figures). */
  summary: string;
}

/** The Ratings section: whose grades they are, every group, and the history. */
export interface PlayerRatingsView {
  /** The scale's ends, for the bars and the chart's axis ("On the 20–80 scale"). */
  scale: { low: Integer; high: Integer; words: Cell };
  /** Whose reports these are ("Your scouts' reports", or OSA's view for him, D-067), with its basis. */
  source: Claim;
  ratingsFill: Cell | null;
  velocity: Cell | null;
  groups: PlayerRatingGroup[];
  empty: Cell | null;
  history: PlayerRatingHistory;
}

/** A value total ("Contract value" · "Most likely $28.0M" · "could be $9.0M to $41.0M"), or why it isn't valued. */
export interface PlayerValueTotal {
  id: 'contract' | 'keeping' | 'wins';
  title: Cell;
  headline: Claim;
  couldBe: Cell | null;
  /** The known seasons only, when the total isn't valued over his control. */
  established: Cell | null;
  gloss: Cell;
  known: boolean;
}

/** "Our view": the same figures through the club's philosophy, every lean named with its amount. */
export interface PlayerOurView {
  title: Cell;
  figures: Cell[];
  leans: Claim[];
  line: Cell | null;
}

/** One season of the production cone: its two ranges and expected wins, or a slot with its reason (no range, no zero). */
export interface PlayerConeSeason {
  season: Integer;
  label: Cell;
  established: boolean;
  expected: number | null;
  outer: { low: number; high: number } | null;
  inner: { low: number; high: number } | null;
  banked: number | null;
  control: Cell;
  cost: Cell | null;
  /** The season's detail: its figures and what they rest on. */
  detail: Claim;
}

/** Expected production by season (the cone), with the words for its two ranges. */
export interface PlayerConeView {
  title: Cell;
  established: boolean;
  /** Why there is no cone, when there isn't. */
  empty: Claim | null;
  seasons: PlayerConeSeason[];
  legend: { outer: Cell; inner: Cell; expected: Cell };
  /** The chart's axis, in wins. */
  axis: { low: number; high: number };
  checked: Claim | null;
  notes: Cell[];
  summary: string;
}

/** The Value section: the totals, our view, the cone and the season-by-season breakdown. */
export interface PlayerValueView {
  status: 'valued' | 'wins_only' | 'unknown' | 'not_held';
  note: Claim | null;
  totals: PlayerValueTotal[];
  ourView: PlayerOurView | null;
  cone: PlayerConeView;
  breakdown: PlayerTable | null;
  /** Seasons not valued, or that depend on how they go, each with its reason in the basis. */
  seasonNotes: Claim[];
  restsOn: Cell[];
}

/** One roster move Player Rights states for him: what it is, whether it can be done now, and why. */
export interface PlayerRightsAction {
  action: string;
  status: Cell;
  claim: Claim;
}

/** Contract & rights: his deal, the seasons it covers and what Player Rights says may be done with him. */
export interface PlayerContractView {
  facts: PlayerFact[];
  schedule: PlayerTable | null;
  empty: Cell | null;
  rightsNote: Cell | null;
  rights: PlayerRightsAction[];
  rightsFacts: PlayerFact[];
}

/** One line of the transaction log about him, in the log's own words, with its date. */
export interface PlayerLogEntry {
  id: string;
  date: Cell;
  line: Claim;
}

/** Contact quality: every batted ball's numbers against the league's. */
export interface PlayerContactView {
  title: Claim;
  figures: PlayerFact[];
  line: Cell;
  reading: Claim | null;
}

/** History: where he is now (the export), what happened (the log), and his record, kept apart (D-020). */
export interface PlayerHistoryView {
  now: PlayerFact[];
  nowSource: Cell;
  log: PlayerLogEntry[];
  logNote: Cell | null;
  tables: PlayerTable[];
  contact: PlayerContactView | null;
}

/** The player window's payload: one dossier, every section, served from the per-import cache. */
export interface PlayerDossierView {
  playerId: Integer;
  /** The club the window reads him for (our view, our scouts). */
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  name: string;
  open: Target;
  header: PlayerHeaderView;
  overview: PlayerOverview;
  ratings: PlayerRatingsView;
  value: PlayerValueView;
  contract: PlayerContractView;
  history: PlayerHistoryView;
}

/** One note the staff filed on him (from a chat), as written, with who and when. */
export interface PlayerStaffNote {
  id: Integer;
  who: Cell;
  when: Cell | null;
  /** The note as filed: the staff's words, not Pennant's. */
  body: string;
}

/** The GM's notes on a player: his own note (on his follow) and the staff's. */
export interface PlayerNotesView {
  playerId: Integer;
  following: boolean;
  /** The GM's note exactly as he typed it; null when there is none. */
  note: string | null;
  explain: Cell;
  staff: PlayerStaffNote[];
  staffEmpty: Cell | null;
}

/** `PUT /api/v2/player/:id/notes`: the note as typed (an empty one clears it). */
export interface PlayerNoteUpdate {
  note: string;
}

/** What a note change answers: the words, the notes now, and the request that undoes it. */
export interface PlayerNoteChange {
  done: Cell;
  notes: PlayerNotesView;
  undo: PlayerNoteUpdate;
  /** Whether undoing it also stops following him (the note was what followed him). */
  undoUnfollows: boolean;
}

/** A staff note put back (the undo of a removal), as it was filed. */
export interface StaffNoteRestore {
  source: string | null;
  body: string;
  gameDate: string | null;
}

/** What removing a staff note answers: the words, the notes now, and the request that puts it back. */
export interface StaffNoteChange {
  done: Cell;
  notes: PlayerNotesView;
  undo: StaffNoteRestore | null;
}

/** One player in a comparison: his name, his line and where he opens. */
export interface ComparePlayer {
  playerId: Integer;
  name: string;
  line: Cell;
  open: Target;
  ratingsFill: Cell | null;
}

/** One player's figure on a compared line: as served for him, with its range for drawing where it has one. */
export interface CompareCell {
  display: Cell;
  range: { low: number; high: number; mid: number | null } | null;
}

/** One line of the comparison: the same field for every player, and what the ranges allow saying, if anything. */
export interface CompareRow {
  id: string;
  label: Cell;
  cells: CompareCell[];
  reading: Claim | null;
}

export interface CompareSection {
  id: string;
  title: Cell;
  rows: CompareRow[];
}

/** Two to four players side by side (`GET /api/v2/compare?players=`): no verdict, no combined score (D-052). */
export interface PlayerCompareView {
  orgId: Integer;
  importStamp: string | null;
  players: ComparePlayer[];
  note: Cell;
  sections: CompareSection[];
}
