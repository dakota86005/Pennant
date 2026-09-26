/**
 * The one way to author a `Claim`, a `Row` or a `Cell` (D-056, SWIFTUI_REBUILD.md section 4.1).
 *
 * - `claim()` takes only a basis made by `basis()`: a branded type at compile time, and at run time a registry of the
 *   bases `basis()` made (frozen, so a spread makes a new, unregistered object). `claim()` refuses any other basis and
 *   validates it again. An object literal typed as `Claim` still compiles, so `assertAuthored()` walks a payload before
 *   a `/v2` route sends it and refuses a claim or basis this module did not make, and
 *   `tests/presentationBoundary.test.ts` catches the hand-built forms in the source.
 * - `basis()` asks for "not known", "would change if" and the lean every time, with no default: an author says `[]`
 *   (nothing is missing) or `null` (no lean) on purpose, and an absent field is never read as either (D-018).
 * - Every sentence is checked as it is built: none empty, a help tag at most `HINT_MAX` characters, a range that holds
 *   its value, a place inside its "of N". A basis has at least one evidence line unless its certainty is `unknown`,
 *   and its stamp goes with its certainty (D-041): required for calibrated, provisional and policy, refused for a fact.
 *   A breach throws: it is an authoring defect, never something to show.
 *
 * Presentation authors words about what the specialists decided; it decides nothing (D-001). Nothing here reads the
 * database.
 */
import type {
  Basis, BasisLine, BasisSource, Cell, Certainty, Claim, DeptId, Lean, Place, Row, ServedValue, Target, Tone, Unit,
} from '../contract/presentation.js';
import type { Integer } from '../contract/primitives.js';

declare const builtBasis: unique symbol;

/** A basis made by `basis()`: the only kind `claim()` takes. The brand exists only in the type; the JSON is a `Basis`. */
export type BuiltBasis = Basis & { readonly [builtBasis]: true };

/** The bases `basis()` made and the claims `claim()` made: the brand, at run time. */
const BUILT_BASES = new WeakSet<object>();
const BUILT_CLAIMS = new WeakSet<object>();

/** The HIG's help tag: one line, at most about 75 characters (SWIFTUI_REBUILD.md section 3.3). */
export const HINT_MAX = 75;

export interface BasisInput {
  because: readonly BasisLine[];
  source: BasisSource;
  /** What is not known, as sentences; `[]` only when nothing is missing. Required, so it is never left out by accident. */
  unknown: readonly string[];
  /** What would change the reading, as sentences; `[]` when nothing named would. */
  wouldChange: readonly string[];
  /** The philosophy's lean beside the neutral reading, or `null` for none. */
  lean: Lean | null;
  certainty: Certainty;
  stamp?: string;
}

export interface ClaimInput {
  text: string;
  tone: Tone;
  basis: BuiltBasis;
  hint?: string;
  value?: ServedValue;
  place?: Place;
  /** Made with `target()`. */
  links?: readonly Target[];
}

class AuthoringError extends Error {
  constructor(message: string) {
    super(`Presentation authoring defect: ${message}`);
    this.name = 'AuthoringError';
  }
}

function sentence(text: string, what: string): string {
  if (typeof text !== 'string' || text.trim() === '') throw new AuthoringError(`${what} is empty`);
  if (text !== text.trim()) throw new AuthoringError(`${what} has spaces around it: "${text}"`);
  return text;
}

/** A hint, checked against the help tag's length. */
function hintOf(hint: string | undefined, what: string): string | undefined {
  if (hint === undefined) return undefined;
  sentence(hint, what);
  if (hint.length > HINT_MAX) throw new AuthoringError(`${what} is ${hint.length} characters; a help tag is at most ${HINT_MAX}: "${hint}"`);
  return hint;
}

/** Every rule a basis must meet, as the reasons it does not (empty when it does). Used on built and served bases alike. */
export function basisProblems(b: Basis): string[] {
  const problems: string[] = [];
  const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '' || v !== v.trim();
  if (!Array.isArray(b.because)) problems.push('because is not a list');
  else {
    if (b.because.length === 0 && b.certainty !== 'unknown') problems.push('a basis needs at least one evidence line (or certainty unknown)');
    b.because.forEach((l, i) => {
      if (blank(l?.label)) problems.push(`because[${i}].label is empty`);
      if (blank(l?.value)) problems.push(`because[${i}].value is empty`);
    });
  }
  for (const field of ['unknown', 'wouldChange'] as const) {
    const list = b[field];
    if (!Array.isArray(list)) problems.push(`${field} is not a list of sentences`);
    else {
      list.forEach((t, i) => { if (blank(t)) problems.push(`${field}[${i}] is empty`); });
      if (new Set(list).size !== list.length) problems.push(`${field} repeats a sentence`);
    }
  }
  if (!b.source || blank(b.source.specialist)) problems.push('source.specialist is empty');
  if (b.source?.sample !== undefined && blank(b.source.sample)) problems.push('source.sample is empty');
  if (b.lean === undefined) problems.push('lean must be stated: a lean, or null for none');
  else if (b.lean !== null) {
    if (blank(b.lean.neutral)) problems.push('lean.neutral is empty');
    if (!Array.isArray(b.lean.why) || b.lean.why.some(blank)) problems.push('lean.why has an empty sentence');
  }
  const stamped = b.stamp !== undefined;
  if (stamped && blank(b.stamp)) problems.push('stamp is empty');
  if (['calibrated', 'provisional', 'policy'].includes(b.certainty) && !stamped) problems.push(`a ${b.certainty} basis needs its stamp (D-041)`);
  if (b.certainty === 'fact' && stamped) problems.push('a fact carries no stamp (D-041)');
  return problems;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** A basis: why a claim says what it says, who answered, what is not known and how it is called. */
export function basis(input: BasisInput): BuiltBasis {
  if (input.lean === undefined) throw new AuthoringError('lean must be stated: a lean, or null for none');
  for (const field of ['unknown', 'wouldChange'] as const) {
    if (!Array.isArray(input[field])) throw new AuthoringError(`${field} must be a list of sentences`);
  }
  const source: BasisSource = {
    department: input.source.department,
    specialist: input.source.specialist,
    asOf: input.source.asOf,
    gameDate: input.source.gameDate,
  };
  if (input.source.sample !== undefined) source.sample = input.source.sample;
  const out: Basis = {
    because: input.because.map((line) => ({ label: line.label, value: line.value })),
    source,
    unknown: [...input.unknown],
    wouldChange: [...input.wouldChange],
    lean: input.lean === null ? null : { neutral: input.lean.neutral, why: [...input.lean.why] },
    certainty: input.certainty,
  };
  if (input.stamp !== undefined) out.stamp = input.stamp;
  const problems = basisProblems(out);
  if (problems.length) throw new AuthoringError(problems.join('; '));
  BUILT_BASES.add(deepFreeze(out));
  return out as BuiltBasis;
}

function placeOf(place: Place | undefined): Place | undefined {
  if (!place) return undefined;
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  if (!whole(place.rank) || !whole(place.of) || !whole(place.tiedWith) || (place.overlap !== undefined && !whole(place.overlap))) {
    throw new AuthoringError(`a place is counted in whole clubs: ${JSON.stringify(place)}`);
  }
  if (place.of < 1 || place.rank < 1 || place.rank > place.of) throw new AuthoringError(`place ${place.rank} is not inside "of ${place.of}"`);
  if (place.rank + place.tiedWith > place.of) throw new AuthoringError(`place ${place.rank} tied with ${place.tiedWith} does not fit in ${place.of}`);
  return { ...place };
}

function valueOf(value: ServedValue | undefined): ServedValue | undefined {
  if (!value) return undefined;
  sentence(value.display, 'value.display');
  const { n, low, high } = value;
  if (n !== null && !Number.isFinite(n)) throw new AuthoringError(`value ${n} is not a number; an unknown value is null`);
  if ((low === undefined) !== (high === undefined)) throw new AuthoringError('a range has both ends or neither');
  if (low !== undefined && high !== undefined) {
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) throw new AuthoringError(`range ${low} to ${high} is not a range`);
    if (n !== null && (n < low || n > high)) throw new AuthoringError(`the most likely value ${n} is outside its range ${low} to ${high}`);
  }
  const out: ServedValue = { n, unit: value.unit, display: value.display };
  if (low !== undefined && high !== undefined) {
    out.low = low;
    out.high = high;
  }
  return out;
}

/** One visible line with its basis. */
export function claim(input: ClaimInput): Claim {
  if (!input.basis) throw new AuthoringError('a claim needs its basis');
  if (!BUILT_BASES.has(input.basis)) throw new AuthoringError('a claim\'s basis must come from basis(), unchanged (a spread or a hand-built basis is refused)');
  const problems = basisProblems(input.basis);
  if (problems.length) throw new AuthoringError(problems.join('; '));
  const out: Claim = {
    text: sentence(input.text, 'text'),
    tone: input.tone,
    basis: input.basis,
    links: [...(input.links ?? [])],
  };
  const hint = hintOf(input.hint, 'hint');
  if (hint !== undefined) out.hint = hint;
  const value = valueOf(input.value);
  if (value) out.value = value;
  const place = placeOf(input.place);
  if (place) out.place = place;
  BUILT_CLAIMS.add(deepFreeze(out));
  return out;
}

/**
 * Refuses a payload holding a claim or basis this module did not make, or one that no longer meets the rules: the last
 * check before a `/v2` route sends it. A claim is any object with a `basis`, or with `text`, `tone` and `links`.
 */
export function assertAuthored(payload: unknown): void {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const claimLike = 'basis' in o || ('text' in o && 'tone' in o && 'links' in o);
    if (claimLike) {
      if (!BUILT_CLAIMS.has(o)) throw new AuthoringError(`${path} is a claim claim() did not make`);
      const b = o.basis as Basis;
      if (!BUILT_BASES.has(b)) throw new AuthoringError(`${path}.basis did not come from basis()`);
      const problems = basisProblems(b);
      if (problems.length) throw new AuthoringError(`${path}.basis: ${problems.join('; ')}`);
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  walk(payload, '$');
}

/** Where a claim or a row leads, with the fields its kind needs (a player target without a player is refused). */
export type TargetInput =
  | { kind: 'department'; department: DeptId }
  | { kind: 'view'; department: DeptId; view: string }
  | { kind: 'player'; playerId: Integer }
  | { kind: 'club'; teamId: Integer }
  | { kind: 'decision'; department: DeptId; key: string };

export function target(input: TargetInput): Target {
  const whole = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0;
  switch (input.kind) {
    case 'department':
      return { kind: 'department', department: input.department };
    case 'view':
      return { kind: 'view', department: input.department, view: sentence(input.view, 'target.view') };
    case 'player':
      if (!whole(input.playerId)) throw new AuthoringError(`a player target needs a player id, not ${String(input.playerId)}`);
      return { kind: 'player', playerId: input.playerId };
    case 'club':
      if (!whole(input.teamId)) throw new AuthoringError(`a club target needs a team id, not ${String(input.teamId)}`);
      return { kind: 'club', teamId: input.teamId };
    case 'decision':
      return { kind: 'decision', department: input.department, key: sentence(input.key, 'target.key') };
    default:
      throw new AuthoringError(`unknown target kind ${String((input as { kind: unknown }).kind)}`);
  }
}

/** A served number. */
export function servedValue(n: number, unit: Unit, display: string, range?: { low: number; high: number }): ServedValue {
  return valueOf({ n, unit, display, ...(range ?? {}) })!;
}

/** A value the evidence cannot give: null, with the sentence the app shows in its place (never a zero or a dash). */
export function unknownValue(unit: Unit, display: string): ServedValue {
  return valueOf({ n: null, unit, display })!;
}

/** One table cell. */
export function cell(display: string, extra: { tone?: Tone; hint?: string; claimRef?: string } = {}): Cell {
  const out: Cell = { display: sentence(display, 'cell.display') };
  if (extra.tone !== undefined) out.tone = extra.tone;
  const hint = hintOf(extra.hint, 'cell.hint');
  if (hint !== undefined) out.hint = hint;
  if (extra.claimRef !== undefined) out.claimRef = sentence(extra.claimRef, 'cell.claimRef');
  return out;
}

/** One table row: a cell and a sort key for every column, the same columns in both. */
export function row<K extends string>(
  id: string,
  cells: Record<K, Cell>,
  sort: Record<K, number | string | null>,
  rowClaim?: Claim,
): Row<K> {
  const cellKeys = Object.keys(cells).sort();
  const sortKeys = Object.keys(sort).sort();
  if (cellKeys.join('|') !== sortKeys.join('|')) {
    throw new AuthoringError(`row ${id}: every column needs a cell and a sort key (cells ${cellKeys.join(', ')}; sort ${sortKeys.join(', ')})`);
  }
  for (const [key, value] of Object.entries(sort) as Array<[string, unknown]>) {
    if (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw new AuthoringError(`row ${id}: sort key ${key} is ${String(value)}; an unknown sorts as null`);
    }
  }
  const out: Row<K> = { id: sentence(id, 'row.id'), cells, sort };
  if (rowClaim) out.claim = rowClaim;
  return out;
}
