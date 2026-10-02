/**
 * Farm & Development's views for the Mac app (N10; SWIFTUI_REBUILD.md sections 3.5 and 4.2): Organization, Affiliates,
 * Assignments, Decision, Prospects and Development tracking, each a payload of served words. Every sentence, word, tone
 * and sort key here is the server's; the Mac app draws them and decides nothing (D-056).
 *
 * What each view says is what the specialists already decided: Minor League Operations (placement, playing time,
 * cascades, the clubs' readings; D-044 to D-048, D-051), Player Development (whether a level is developing a man, the
 * prospect calls, the stakes; D-003, D-019, D-025, D-050) and the rating history of this save (D-064). Nothing is
 * ranked by a hidden score; the developmental stakes are never a sort key (D-050).
 */
import type { Cell, Claim, Row, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';

/** What every farm view carries: the club, the import and build it was read from, and its date. */
export interface FarmViewHead {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  /** "Through May 5, 2040". */
  asOf: Cell;
  /** "Prepared by the minor league staff". */
  preparedBy: Cell;
  /** The two as one line, for a pane with no masthead: "Prepared by the minor league staff · Through May 5, 2040". */
  byline: Cell;
}

/** A level of the organization, for a view's level filter (its id is the level's number as a string). */
export interface FarmLevelChoice {
  id: string;
  name: string;
}

/** A player named in a line, with where his name opens. */
export interface FarmPlayerLine {
  playerId: Integer;
  name: string;
  line: Cell;
  open: Target;
}

/** One line of a finding's evidence, or any label, value and the basis it rests on. */
export interface FarmEvidenceRow extends Row<'label' | 'value' | 'why'> {}

/** A label and its value. */
export interface FarmFactRow extends Row<'label' | 'value'> {}

/** One finding of Minor League Operations or Player Development, with its evidence, never a score. */
export interface FarmFindingView {
  id: string;
  /** "Short", "Needs attention" or "Noted", toned. */
  severity: Cell;
  /** The farm's sentence; its evidence, what is missing and what would settle it are its basis. */
  headline: Claim;
  /** Who raised it: "Minor League Operations" or "Player Development". */
  owner: Cell;
  evidence: FarmEvidenceRow[];
  players: FarmPlayerLine[];
  missing: Cell[];
  wouldSettle: Cell[];
  /** Drawn open (a shortage) rather than folded. */
  expanded: boolean;
}

// ── Organization ────────────────────────────────────────────────────────────

/** One position's depth across the levels: how many can play it at each, and in the upper minors. */
export interface FarmDepthRow {
  id: string;
  position: Cell;
  /** One cell per level, in the order of `FarmOrganizationView.levels`. */
  atLevels: Cell[];
  upperMinors: Cell;
  /** The sort keys: the position's place in the field, each level's count, the upper minors' count. */
  sort: FarmDepthSort;
}

export interface FarmDepthSort {
  position: Integer;
  atLevels: Integer[];
  upperMinors: Integer;
}

/** Starters each level is using against its rotation spots. */
export interface FarmStartersRow extends Row<'level' | 'starters' | 'spots' | 'state'> {}

/** A player in a table, with where he opens (his Decision). */
export interface FarmPlayerRow extends Row<'player' | 'age' | 'level' | 'club'> {
  playerId: Integer;
  open: Target;
}

/** One line the farm's reading used, as Minor League Operations states it. */
export interface FarmLineRow extends Row<'name' | 'value' | 'kind' | 'why'> {}

export interface FarmPastWindow {
  title: Cell;
  note: Cell;
  rows: FarmPlayerRow[];
}

/** The farm as one organization: where it is piled up, where it is thin, and the lines its reading used. */
export interface FarmOrganizationView extends FarmViewHead {
  /** "247 players across 7 affiliates. Player Development can read 180 of them; …". */
  scope: Claim;
  findings: FarmFindingView[];
  findingsEmpty: Cell | null;
  levels: FarmLevelChoice[];
  depth: FarmDepthRow[];
  depthNote: Cell;
  starters: FarmStartersRow[];
  startersNote: Cell;
  pastWindow: FarmPastWindow | null;
  lines: FarmLineRow[];
  unknowns: Cell[];
}

// ── Affiliates ──────────────────────────────────────────────────────────────

/** One club of the organization, top to bottom: the major-league club first, then each affiliate by level. */
export interface FarmClubStep {
  teamId: Integer;
  name: string;
  /** "Major leagues", "Triple-A". */
  level: Cell;
  /** The league it plays in; null when the export does not name it. */
  league: Cell | null;
  /** The level and the league as one line: "Triple-A · International League". */
  levelLine: Cell;
  /** Can it field a team: "Able", "Thin", "Short", toned; null for the major-league club (Major League Ops reads it). */
  operational: Cell | null;
  /** Are its players developing: "No issue found", "Worth a look", "Costing development"; null for the major-league club. */
  developmental: Cell | null;
  /** "28 on the active list". */
  players: Cell | null;
  /** Whether this is the major-league club (drawn at the top, opening Major League Ops' report). */
  majorLeague: boolean;
  open: Target | null;
}

export interface FarmCoverRow extends Row<'position' | 'graded' | 'listedOnly' | 'strong'> {}

/** A player whose assignment at this club is worth reviewing. */
export interface FarmConcernRow extends Row<'player' | 'age' | 'verdict' | 'question' | 'summary'> {
  playerId: Integer;
  open: Target;
}

/** One affiliate, read twice: can the club do its job, and are its players developing (D-045). */
export interface FarmAffiliateDetail {
  teamId: Integer;
  name: string;
  /** "Triple-A · Pacific Coast League · 98 games played · 28 on the active list (14 position players, 14 pitchers)". */
  line: Cell;
  operational: Claim;
  developmental: Claim;
  operationalFindings: FarmFindingView[];
  operationalEmpty: Cell | null;
  cover: FarmCoverRow[];
  coverNote: Cell;
  pitching: Cell;
  assessment: Cell;
  developmentalFindings: FarmFindingView[];
  developmentalEmpty: Cell | null;
  concerns: FarmConcernRow[];
  /** Players here who are not counted as ordinary members (injured, on rehab, or unclear), each with why. */
  rosterContext: FarmPlayerLine[];
  rosterContextNote: Cell | null;
  unknowns: Cell[];
}

export interface FarmAffiliatesView extends FarmViewHead {
  /** The organization from the major-league club down, in the stated order. */
  clubs: FarmClubStep[];
  order: Cell;
  affiliates: FarmAffiliateDetail[];
  empty: Cell | null;
}

// ── Assignments ─────────────────────────────────────────────────────────────

/** Every minor leaguer's assignment and what the organization makes of it. The stakes column has no sort key (D-050). */
export interface FarmAssignmentRow extends Row<'player' | 'age' | 'club' | 'level' | 'results' | 'work' | 'stakes' | 'conclusion'> {
  playerId: Integer;
  teamId: Integer;
  /** The level filter's id this row belongs to. */
  levelId: string;
  /** Whether his assignment is in question (needs attention or worth a look), as the farm says. */
  inQuestion: boolean;
  /** His developmental stakes with every reason for them in the basis (the stakes cell opens it). */
  stakes: Claim;
  open: Target;
}

/** "12 of 40 players": how many rows a choice of the view's filters shows, said. */
export interface FarmShownCount {
  levelId: string | null;
  inQuestionOnly: boolean;
  label: Cell;
}

export interface FarmAssignmentsView extends FarmViewHead {
  note: Cell;
  /** The stated order: whether the GM needs to look, then name. */
  order: Cell;
  levels: FarmLevelChoice[];
  rows: FarmAssignmentRow[];
  /** How many rows show, for each choice of the level filter (null: every level) and of "in question only". */
  shown: FarmShownCount[];
  /** When no assignment is in question (the default filter) and when there are no players at all. */
  emptyInQuestion: Cell;
  emptyAll: Cell;
}

// ── Decision ────────────────────────────────────────────────────────────────

export interface FarmAlternativeRow extends Row<'assignment' | 'development' | 'philosophy' | 'play'> {
  /** Player Development's reasons it is not defensible, and what it could not see. */
  notes: Cell[];
}

export interface FarmWorkRow extends Row<'read' | 'level' | 'why'> {}

export interface FarmCascadeStepView {
  index: Integer;
  /** Player Development on this exact move: "Defensible", "Not defensible", "Can't be judged", "Not looked at". */
  judgment: Cell;
  /** "Amarillo needs SS (1 of 2)". */
  vacancy: Cell;
  candidate: FarmPlayerLine | null;
  /** Why no one fills it, when no one does. */
  noCandidate: Cell | null;
  /** Philosophy's preference, only beside a defensible step. */
  preference: Cell | null;
  /** The others as defensible, and that choosing among them is the GM's. */
  alternatives: Cell | null;
  consequences: Cell[];
  notes: Cell[];
}

export interface FarmCascadeView {
  steps: FarmCascadeStepView[];
  /** When no move follows at all. */
  noSteps: Cell | null;
  /** Where the chain stops, and why. */
  stop: Claim;
  /** Holes the chain leaves open: information, never a refusal of the move (D-045). */
  unresolved: Cell[];
  unresolvedNote: Cell | null;
  /** Said when one step can't be judged: the chain is only as sure as that step. */
  howSure: Cell | null;
}

export interface FarmReplacementLine {
  playerId: Integer;
  name: string;
  judgment: Cell;
  from: Cell;
  preference: Cell | null;
  open: Target;
}

/** What follows if he moves: Minor League Operations' consequence (the farm side of the MLB contract). */
export interface FarmConsequenceView {
  summary: Claim;
  impact: FarmFactRow[];
  playingTime: Cell[];
  replacements: FarmReplacementLine[];
  cascade: FarmCascadeView | null;
  measured: Cell[];
}

export interface FarmRetentionView {
  note: Cell;
  rows: FarmEvidenceRow[];
  guardrails: Cell[];
}

/** One player's assignment, in the order a GM decides; nothing on it is a transaction. */
export interface FarmDecisionView extends FarmViewHead {
  playerId: Integer;
  teamId: Integer;
  name: string;
  /** "23, position player · Double-A · Amarillo Sod Poodles · Texas League". */
  line: Cell;
  conclusion: Claim;
  /** Developmental stakes: how careful the organization is with his development; never a verdict on where he plays. */
  stakes: Claim;
  stakesReasons: Cell[];
  why: Cell[];
  verdict: Claim;
  verdictParts: FarmEvidenceRow[];
  results: FarmFactRow[];
  alternativesNote: Cell;
  alternatives: FarmAlternativeRow[];
  alternativesEmpty: Cell | null;
  opportunityNote: Cell;
  opportunity: Cell | null;
  work: FarmWorkRow[];
  workMissing: Cell | null;
  roleChange: Cell | null;
  ahead: Cell | null;
  aheadPlayers: FarmPlayerLine[];
  gone: Cell | null;
  consequenceNote: Cell;
  consequence: FarmConsequenceView | null;
  /** Why the consequence could not be read this time, when it could not. */
  consequenceProblem: Cell | null;
  retention: FarmRetentionView | null;
  uncertain: Cell[];
  uncertainEmpty: Cell | null;
  wouldSettle: Cell[];
  yours: Cell[];
  owners: FarmEvidenceRow[];
}

// ── Prospects ───────────────────────────────────────────────────────────────

export interface FarmFilter {
  id: string;
  name: string;
  count: Integer;
  /** The filter as a menu shows it, with its count ("Meetings · 4"). */
  label: string;
}

/** One minor leaguer on the development board. */
export interface FarmProspectRow extends Row<'player' | 'age' | 'club' | 'role' | 'ratings' | 'pace' | 'call'> {
  playerId: Integer;
  teamId: Integer;
  levelId: string;
  /** The board's filters this row belongs to (`attention`, `eligible`, `watch`, `behind`; every row is in `all`). */
  filters: string[];
  /** His age, role and club as one line: "21 · SS · Double-A · Club". */
  listLine: Cell;
  open: Target;
}

export interface FarmNextAssignment {
  /** "Normal promotion to Triple-A". */
  move: Cell;
  /** Each club it could go to, with how the man fits there. */
  destinations: Cell[];
}

export interface FarmEvaluationRow extends Row<'move' | 'judgment' | 'philosophy'> {
  notes: Cell[];
}

/** A development meeting: one player Player Development raised, with its call and the evidence behind it. */
export interface FarmProspectCard {
  playerId: Integer;
  name: string;
  /** "21 · SS · Double-A · Amarillo Sod Poodles". */
  line: Cell;
  /** "Double-A → Triple-A", "Double-A · stay" or "Double-A · not settled". */
  queueLine: Cell;
  /** Player Development's call, with what it means as its help tag and its evidence as its basis. */
  call: Claim;
  /** What the call means, in a sentence. */
  means: Cell;
  facts: FarmFactRow[];
  supporting: Cell[];
  cautions: Cell[];
  next: FarmNextAssignment[];
  nextEmpty: Cell | null;
  placeTitle: Cell;
  place: Cell;
  scoresNote: Cell;
  scores: FarmFactRow[];
  evaluations: FarmEvaluationRow[];
  open: Target;
}

export interface FarmProspectsView extends FarmViewHead {
  summary: Claim;
  figures: Claim[];
  guide: FarmFactRow[];
  meetingsNote: Cell;
  meetings: FarmProspectCard[];
  meetingsEmpty: Cell | null;
  boardNote: Cell;
  order: Cell;
  filters: FarmFilter[];
  levels: FarmLevelChoice[];
  rows: FarmProspectRow[];
  empty: Cell;
  model: Cell;
  unknowns: Cell[];
}

// ── Development tracking ────────────────────────────────────────────────────

export interface FarmDevelopmentTab {
  id: string;
  name: string;
  count: Integer;
  /** The tab as a menu shows it, with its count ("Ahead · 3"). */
  label: string;
  /** The list's heading for this tab ("Ahead of his peers"). */
  title: Cell;
  /** The rows in this tab, in its stated order (their ids). */
  order: string[];
  /** How the tab is ordered, said. */
  rule: Cell;
}

export interface FarmDevelopmentRow extends Row<'player' | 'age' | 'club' | 'role' | 'current' | 'change' | 'pace' | 'history'> {
  playerId: Integer;
  teamId: Integer;
  levelId: string;
  /** "22 · Double-A · Amarillo Sod Poodles", for the list beside the detail. */
  listLine: Cell;
  open: Target;
}

export interface FarmSnapshotRow extends Row<'date' | 'level' | 'current' | 'ceiling'> {}

export interface FarmMovementRow extends Row<'tool' | 'from' | 'to' | 'change'> {}

/** One player's scouting history in this save: what our scouts saw, first to latest. */
export interface FarmDevelopmentDetail extends FarmViewHead {
  playerId: Integer;
  teamId: Integer;
  name: string;
  line: Cell;
  pace: Cell;
  first: Cell;
  latest: Cell;
  change: Claim;
  ceilingChange: Cell;
  summary: Claim;
  snapshots: FarmSnapshotRow[];
  movement: FarmMovementRow[];
  movementEmpty: Cell | null;
  peers: Cell[];
  fogNote: Cell;
  /** Where his name opens: his Decision. */
  open: Target;
}

export interface FarmDevelopmentView extends FarmViewHead {
  /** Whether there are two snapshots or more to compare. */
  ready: boolean;
  /** With fewer than two snapshots: what there is, and what would start the comparison. */
  building: Claim | null;
  figures: Claim[];
  /** This save's history notes: a fresh start or a carry-over (D-064), a switch in the kind of ratings (D-061). */
  historyNotes: Cell[];
  guide: FarmFactRow[];
  tabs: FarmDevelopmentTab[];
  initialTab: string;
  levels: FarmLevelChoice[];
  rows: FarmDevelopmentRow[];
  empty: Cell;
  tableNote: Cell;
  model: Cell;
}
