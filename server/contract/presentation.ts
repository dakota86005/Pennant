/**
 * The presentation types (D-056, SWIFTUI_REBUILD.md section 4.1): how the server hands the Mac app every sentence it
 * shows. A `Claim` is one visible line with its basis; a `Row` of `Cell`s is a table row ready to show; a `Target` is
 * where a claim or row leads. Swift renders these and never writes a sentence of its own (D-001, D-008).
 *
 * Author claims through `claim()` and `basis()` in `server/presentation/claim.ts`, never as object literals: the builder
 * makes a claim without a basis impossible to write, and keeps "not known" a list of sentences (D-018).
 *
 * The contract generator cannot name a generic (`Row<K>`), so a payload exports a concrete interface for each row it
 * serves, extending it with its columns (`export interface DataStatusRow extends Row<'source' | 'state'> {}`), which
 * becomes one named component. (A type alias of an exported generic would name the instantiation, `Row<…>`, which is
 * no component name.)
 */
import type { GameDate } from '../dataFreshness.js';
import type { Integer } from './primitives.js';

/**
 * A department of the club, as the Mac app's sidebar has them (SWIFTUI_REBUILD.md section 3.5). An open enum in the
 * spec: a newer server may name a department an older app does not know.
 */
export type DeptId =
  | 'frontOffice'
  | 'majorLeague'
  | 'farm'
  | 'scouting'
  | 'trades'
  | 'finance'
  | 'medical'
  | 'league'
  | 'philosophy';

/**
 * How a claim's number or line is called (D-041): `calibrated` (fitted on the save's own history), `provisional` (a model
 * parameter that ought to be fitted and has not been), `policy` (a line chosen and stated, never fitted), `unknown`
 * (the basis cannot say), and `fact`: an objective fact read from the export or the save (a record, a date, how many
 * days one source is behind another), which no fitted number and no chosen line decided. Section 4.1 listed the first
 * four; `fact` was added at N4 so a plain fact is never stamped as policy.
 */
export type Certainty = 'fact' | 'calibrated' | 'provisional' | 'policy' | 'unknown';

/** How a line reads at a glance. Colour is never the only signal: the app pairs a tone with a symbol and a word. */
export type Tone = 'good' | 'bad' | 'caution' | 'neutral' | 'unknown';

/** What a served number counts, so the app formats it (a share as a percentage, dollars as money). */
export type Unit = 'count' | 'share' | 'rate' | 'dollars' | 'wins' | 'runs' | 'games' | 'days' | 'years' | 'place';

/**
 * A number a claim shows, with its range when it has one. `n` null is a value the evidence cannot give; `display`
 * always says something (the sentence for a missing value, never a zero or a dash).
 */
export interface ServedValue {
  n: number | null;
  unit: Unit;
  /** The low end of the range, when the value is a range (the most likely value is `n`). */
  low?: number;
  high?: number;
  /** The value as the app shows it ("4.8 runs a game", "Not known yet"). */
  display: string;
}

/**
 * A league place, stated (D-057): `rank` among `of` clubs that have the figure, `tiedWith` the number of other clubs on
 * the same figure, and, for a Player Value place, `overlap`: how many clubs' ranges overlap this one.
 */
export interface Place {
  rank: Integer;
  of: Integer;
  tiedWith: Integer;
  overlap?: Integer;
}

/** One line of a claim's evidence: what was read and what it said. */
export interface BasisLine {
  label: string;
  value: string;
}

/** Who answered: the department and its specialist, and how current the evidence is. */
export interface BasisSource {
  department: DeptId;
  /** The specialist, in words ("Data status", "Player Value"). */
  specialist: string;
  /** When the evidence was read (an import's time, ISO 8601), or null when it has not been. */
  asOf: string | null;
  /** The game date the evidence reflects, as the export wrote it, or null. */
  gameDate: GameDate | null;
  /** How much evidence there is, in words ("30 games"), when that matters. */
  sample?: string;
}

/**
 * The organization's philosophy leaning on a reading (D-052's lens): the neutral reading beside the reasons for the lean.
 * A claim with no lean says so with `null`; an absent lean is never read as "neutral".
 */
export interface Lean {
  neutral: string;
  why: string[];
}

/** Why a claim says what it says (D-018, D-023, D-031, D-044: show the basis). */
export interface Basis {
  because: BasisLine[];
  source: BasisSource;
  /** What is not known, as sentences. An empty list means nothing is missing, never "not checked". */
  unknown: string[];
  /** What would change the reading, as sentences. */
  wouldChange: string[];
  lean: Lean | null;
  certainty: Certainty;
  /** The D-041 stamp shown in the evidence view (a breakdown, where a method word may help). */
  stamp?: string;
}

/** What a target opens. */
export type TargetKind = 'department' | 'view' | 'player' | 'club' | 'decision';

/**
 * Where a claim or a row leads: a department, one of its views, a player, a club or a decision. Flat, with the fields
 * its kind needs, so the app reads one shape.
 */
export interface Target {
  kind: TargetKind;
  department?: DeptId;
  /** A view's id inside its department (`fortyManOptions`). */
  view?: string;
  playerId?: Integer;
  teamId?: Integer;
  /** A decision's key inside its department. */
  key?: string;
}

/** One visible line, in the GM's voice, with its basis. */
export interface Claim {
  /** The visible line. */
  text: string;
  /** The help tag: one line, at most about 75 characters. */
  hint?: string;
  value?: ServedValue;
  tone: Tone;
  place?: Place;
  basis: Basis;
  links: Target[];
}

/** One cell of a served table: what it shows, and its tone and help tag when it has them. */
export interface Cell {
  display: string;
  tone?: Tone;
  hint?: string;
  /** A claim elsewhere in the payload that explains this cell. */
  claimRef?: string;
}

/**
 * One row of a served table (SWIFTUI_REBUILD.md section 4.1): a cell per column, the raw sort key per column (null is
 * unknown and sorts last in both directions, `contract/fixtures/sort-cases.json`), and a claim when the row has a basis.
 * Generic over its columns; a payload exports a concrete interface extending it.
 */
export interface Row<K extends string = string> {
  id: string;
  cells: Record<K, Cell>;
  sort: Record<K, number | string | null>;
  claim?: Claim;
}
