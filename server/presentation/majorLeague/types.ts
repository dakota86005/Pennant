/**
 * Major League Ops' views for the Mac app (SWIFTUI_REBUILD.md section 9, N8): the bench coach's department as served
 * words. Each view is one payload under `/api/v2/views/:org/majorLeague/<view>`, built from what Major League Ops
 * already answered (`mlbOverview`, `mlbResponses`) and nothing else: no rule, threshold, rank or verdict is made here or
 * in Swift (D-001, D-024). The shapes are deliberately few and generic (a table of rows, blocks of lines, a choice) so
 * the app draws every view with the same handful of components, and every sentence it shows is in these payloads.
 *
 * Every visible string is a `Cell`, or a `Claim` where the line has a basis worth opening. Nothing here carries the
 * season's odds or the deadline posture (D-060); the club's philosophy and season shade a flag or the staff's call only
 * as a lean in a claim's basis.
 */
import type { Cell, Claim, Row, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';

/** A player a view names: his id and name, and where his name opens (his organization's club, until player windows). */
export interface MlbPlayer {
  playerId: Integer;
  name: string;
  /** A player target with his organization's club; null when the export doesn't place him. */
  open: Target | null;
}

/** One line of words: its text, the chips drawn before it, and the players it names (each can be opened or followed). */
export interface MlbLine {
  text: Cell;
  /** Quieter: a note under a line, drawn in the secondary style. */
  quiet: boolean;
  chips: Cell[];
  players: MlbPlayer[];
}

/**
 * A titled group of lines (a detail's section, a plan, a clearing option): its title or the player it is about, its
 * chips, the lines with a basis (claims) and the plain lines. `collapsed` is drawn closed at first (a disclosure).
 */
export interface MlbBlock {
  title: Cell | null;
  player: MlbPlayer | null;
  chips: Cell[];
  claims: Claim[];
  lines: MlbLine[];
  collapsed: boolean;
}

/** Something a view offers to open: its words and where it leads (a decision, another view). */
export interface MlbAction {
  text: Cell;
  open: Target;
}

/** A table's column: its id (the key of each row's cells and sort keys), its title, and whether it holds numbers. */
export interface MlbColumn {
  id: string;
  title: Cell;
  numeric: boolean;
}

/**
 * A table row: a cell and a raw sort key per column (null is unknown and sorts last both ways), the player the row is
 * about, what a scout would say if asked (its detail, drawn when the row is selected) and what it offers to open.
 */
export interface MlbRow extends Row<string> {
  player: MlbPlayer | null;
  detail: MlbBlock[];
  actions: MlbAction[];
}

/** A table, ready to show: its columns, its rows in the specialist's own order, and its sentence when it has none. */
export interface MlbTable {
  columns: MlbColumn[];
  rows: MlbRow[];
  empty: Cell | null;
}

/** What every Major League Ops view carries: its build, its title and the one line saying what it is. */
export interface MlbViewHead {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  title: Cell;
  /** What the view is and how to read it: one line, the full explanation in its basis. */
  lede: Claim;
  /** Where the review's yardsticks come from (fitted on this save, or the starting values), with the detail in its basis. */
  yardsticks: Claim | null;
}

/** One of the staff's views at a glance on the report: its title, its count, a line or three, and where it opens. */
export interface MlbGlance {
  title: Cell;
  /** How many things it flags (the sidebar's and the card's count); null when the view could not be read. */
  count: Integer | null;
  lines: Cell[];
  open: Target;
}

/** One open need in the decision list: its badge, kind, title and first sentence, and the decision it opens. */
export interface MlbNeedEntry {
  needId: string;
  badge: Cell;
  kind: Cell;
  title: Cell;
  summary: Cell;
  open: Target;
}

/** A group of open needs, as the department groups them (the roster first, then the strongest cases, then the rest). */
export interface MlbNeedGroup {
  title: Cell;
  /** Drawn closed at first (the "also worth a look" group when something more pressing is open). */
  collapsed: boolean;
  needs: MlbNeedEntry[];
}

/** A player the GM can pose "what if he's out?" about, with the decision that scenario opens. */
export interface MlbWhatIfChoice {
  player: MlbPlayer;
  role: Cell | null;
  open: Target;
}

/** The report's companion: the staff's views at a glance, the what-if, the inbox of open needs and what lean there is. */
export interface MlbOverviewView extends MlbViewHead {
  /** Roster data when it is not current, in words; null when it is. */
  freshness: Cell | null;
  glances: MlbGlance[];
  /** How the club's philosophy leans on the department's advice: one line, what it reads in its basis; null when nothing is set. */
  philosophy: Claim | null;
  inbox: MlbNeedGroup[];
  /** The sentence when nothing is open. */
  inboxEmpty: Cell | null;
  whatIf: { title: Cell; prompt: Cell; note: Cell; players: MlbWhatIfChoice[] };
  unknowns: Cell[];
}

/** Position players: the lineup as usage shows it, each regular read against the standard for his job. */
export interface MlbPositionPlayersView extends MlbViewHead {
  lineup: MlbTable;
  /** How the lineup was read from usage. */
  basisNote: Cell | null;
}

/** A section of the pitching staff: the rotation or the bullpen. */
export interface MlbStaffSection {
  title: Cell;
  /** The bullpen's deployment findings (what his role is now, what the evidence supports, why it matters). */
  findings: MlbBlock[];
  findingsEmpty: Cell | null;
  table: MlbTable;
  /** A note under the table (how a reliever's role is read), with its detail in the basis. */
  note: Claim | null;
}

export interface MlbPitchingStaffView extends MlbViewHead {
  sections: MlbStaffSection[];
  /** The sentence when there are no pitchers to review. */
  empty: Cell | null;
}

/** One function a bench is for: who covers it and how well, and the decision that looks for a cover where nobody does. */
export interface MlbBenchFunction {
  key: string;
  title: Cell;
  strength: Cell;
  text: Cell;
  by: MlbLine[];
  action: MlbAction | null;
}

export interface MlbBenchView extends MlbViewHead {
  functions: MlbBenchFunction[];
  bench: MlbTable;
  findings: Cell[];
  hands: Cell | null;
  /** The sentence when there is no bench review at all. */
  empty: Cell | null;
}

/** What a decision is asked for: the need and the GM's choices so far. The app sends it back exactly as served. */
export interface MlbDecisionQuery {
  need: string;
  role?: string;
  context?: string;
  days?: Integer;
}

/** One of the GM's choices in a decision (a duration, the assignment to judge, the role to explore). */
export interface MlbChoice {
  text: Cell;
  selected: boolean;
  query: MlbDecisionQuery;
}

export interface MlbChoices {
  title: Cell;
  note: Cell | null;
  choices: MlbChoice[];
}

/** Where he stands against his role's line, as numbers on one scale (the app draws the geometry, nothing more). */
export interface MlbGauge {
  deepFloor: number;
  floor: number;
  typical: number;
  estimate: number;
  typicalLabel: Cell;
  estimateLabel: Cell;
  key: Cell;
  /** The whole gauge in one sentence, for VoiceOver. */
  spoken: string;
}

/** Why it was flagged: the reading with its basis, the gauge when there is a line, and the sections under it. */
export interface MlbWhy {
  title: Cell;
  claim: Claim;
  gauge: MlbGauge | null;
  blocks: MlbBlock[];
}

/** One lens of a player's read: its label, its value on a 0 to 100 scale (null when unknown) and its words. */
export interface MlbLens {
  label: Cell;
  value: number | null;
  display: Cell;
}

/** A person in the role's picture: who he is, his lenses and the lines about him. */
export interface MlbPerson {
  player: MlbPlayer;
  status: Cell;
  /** The man under review, set apart. */
  subject: boolean;
  lenses: MlbLens[];
  lines: MlbLine[];
}

export interface MlbPicture {
  title: Cell;
  note: Cell | null;
  people: MlbPerson[];
  basisNote: Cell;
}

/** The staff's call: its stance, how sure, the headline with its rubric and leans in the basis, and the sections. */
export interface MlbCall {
  title: Cell;
  stance: Cell;
  confidence: Cell;
  headline: Claim;
  blocks: MlbBlock[];
}

/** A way to respond, followed through: its title, how certain the path is, and its sections. */
export interface MlbPlan {
  title: Cell;
  /** How certain the path is (open, needs a clearing move, not established, blocked), as a chip. */
  pathState: Cell;
  blocks: MlbBlock[];
}

export interface MlbResponses {
  title: Cell;
  order: Cell | null;
  plans: MlbPlan[];
}

export interface MlbCandidateGroup {
  title: Cell;
  collapsed: boolean;
  table: MlbTable;
}

export interface MlbCandidates {
  title: Cell;
  count: Integer;
  groups: MlbCandidateGroup[];
  notConsidered: Cell[];
  empty: Cell | null;
}

/** One way to clear a roster spot: the constraint, its note, and its options by kind of cost. */
export interface MlbConstraint {
  title: Cell;
  note: Cell;
  flags: Cell[];
  /** Each kind of move (routine, costs something lasting, disruptive, not established): its options as blocks. */
  classes: Array<{ title: Cell; description: Cell; collapsed: boolean; options: MlbBlock[] }>;
}

/** The roster mechanics: activating a returning player, the chain of moves, and every way to clear a spot. */
export interface MlbMechanics {
  title: Cell;
  blocks: MlbBlock[];
  constraints: MlbConstraint[];
}

/**
 * A decision: one need, opened, in the GM's order: the problem, why it was flagged, the staff's call, the ways to respond
 * followed through, every candidate, and the roster mechanics. It ranks nobody and makes no move.
 */
export interface MlbDecisionView extends MlbViewHead {
  needId: string;
  /** A what-if the GM posed, not a current problem. */
  scenario: boolean;
  kicker: Cell;
  headline: Claim;
  badges: Cell[];
  notes: Cell[];
  duration: MlbChoices | null;
  problem: MlbBlock;
  why: MlbWhy | null;
  picture: MlbPicture | null;
  read: MlbBlock | null;
  call: MlbCall | null;
  assignment: MlbChoices | null;
  responses: MlbResponses | null;
  roleChoice: MlbChoices | null;
  candidates: MlbCandidates | null;
  mechanics: MlbMechanics | null;
  footnote: Cell;
}
