/**
 * The front office's served tables (N12, D-071): Finance's and Medical's views draw their lists with these few shapes,
 * so the Mac app draws every one of them with the same native table (`OfficeTable` in FeatureCore). A table is its
 * columns, its rows in the specialist's own order (each a cell and an ordinal sort key per column, null when unknown so
 * it sorts last both ways) and the sentence it says when it has no rows. A row about a player names him, so he opens
 * his own window, compares and follows; what goes with a chosen row (its facts and its claims) is drawn beneath the
 * table. A filter's choices name no rows: each row names the choice it falls under (`filterKeys`). Every word is served; nothing here decides anything (D-001).
 */
import type { GameDate } from '../dataFreshness.js';
import type { BasisLine, Cell, Claim, DeptId, Row, Target } from '../contract/presentation.js';
import type { Integer } from '../contract/primitives.js';
import { basis, cell, claim, HINT_MAX, row, target } from './claim.js';

/** A player a front-office table names: his id and name, and his window (`open`, a player target). */
export interface OfficePlayer {
  playerId: Integer;
  name: string;
  open: Target;
}

/**
 * A table's column: its id (the key of each row's cells and sort keys), its title (its hint says how to read it), whether
 * it holds numbers, and whether it sorts (a column of words with no order, such as a contract's notes, does not).
 */
export interface OfficeColumn {
  id: string;
  title: Cell;
  numeric: boolean;
  sortable: boolean;
  /** Hidden until the GM shows it from the table's columns; absent is shown. */
  hidden?: boolean;
}

/** One labelled fact beneath a chosen row ("Signed through", "2031"). */
export interface OfficeFact {
  label: Cell;
  value: Cell;
}

/**
 * A row: a cell and a sort key per column, the player it is about (null for none), what is drawn beneath the table when
 * it is chosen (its facts, claims and short table; each left out when it has none, and a long list's served on its own
 * when the row is chosen), the choice of each filter group it falls under, and the OSA mark when the grades it shows are
 * OSA's view filling in for our scouts (D-067).
 */
export interface OfficeRow extends Row<string> {
  player: OfficePlayer | null;
  facts?: OfficeFact[];
  claims?: Claim[];
  /** A short table beneath the chosen row (a contract's seasons under control). */
  grid?: OfficeGrid;
  /**
   * The choice it falls under in each of its table's filter groups, by group id (`{ side: 'pitchers', age: 'prime' }`);
   * a group it falls under no choice of (his age not known) is left out, so only that group's first choice keeps him.
   */
  filterKeys?: Record<string, string>;
  ratingsFill?: Cell;
}

/** A short table drawn as a grid (its columns' titles and its rows' cells), never sorted. */
export interface OfficeGrid {
  title: Cell;
  columns: Cell[];
  rows: Cell[][];
  /** The sentence when it has no rows. */
  empty: Cell | null;
}

/** A table ready to show: its columns, its rows in the served order, and its sentence when it has none. */
export interface OfficeTable {
  columns: OfficeColumn[];
  rows: OfficeRow[];
  empty: Cell | null;
}

/** A choice that narrows a table to some of its rows (Contracts' groups, Free Agents' positions): its words. */
export interface OfficeFilter {
  id: string;
  title: Cell;
  /** What the choice means, when it needs more than its title (its explanation in the basis); null when it doesn't. */
  explain: Claim | null;
}

/**
 * One way of narrowing a table (Contracts' groups, all players or pitchers, an age band): its title and its choices. The
 * first choice keeps every row; another keeps the rows whose `filterKeys` name it for this group. A table shows the rows
 * every group's chosen choice keeps. The rows are never listed in the choice: a long table's would double the payload.
 */
export interface OfficeFilterGroup {
  id: string;
  title: Cell;
  choices: OfficeFilter[];
}

/** A choice. */
export const filterChoice = (id: string, title: Cell, explain: Claim | null = null): OfficeFilter => ({ id, title, explain });

/** What every Finance and Medical view carries: its build, its title, its byline and the one line saying what it is. */
export interface OfficeViewHead {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  title: Cell;
  /** "The front office · Through May 5, 2040". */
  byline: Cell;
  /**
   * The byline's parts (who prepared it, how current), so a narrow column sets each on a line of its own rather than
   * breaking the byline inside a date.
   */
  bylineParts: Cell[];
  /** What the view is and how to read it: one line, the full explanation in its basis. */
  lede: Claim;
  /** How current the league data is, when it is not current (the React pages' freshness cue); null when it is. */
  freshness: Claim | null;
}

/** A column. */
export function column(id: string, title: string, options: { numeric?: boolean; sortable?: boolean; hint?: string; hidden?: boolean } = {}): OfficeColumn {
  const out: OfficeColumn = {
    id,
    title: cell(title, options.hint ? { hint: options.hint } : {}),
    numeric: options.numeric ?? false,
    sortable: options.sortable ?? true,
  };
  if (options.hidden) out.hidden = true;
  return out;
}

/** A player a table names, opening his window (with his organization's club when known). */
export function officePlayer(playerId: number, name: string, teamId?: number | null): OfficePlayer {
  return { playerId, name, open: target({ kind: 'player', playerId, teamId: teamId ?? null }) };
}

/** A fact beneath a row. */
export const fact = (label: string, value: string, hint?: string): OfficeFact => ({ label: cell(label), value: cell(value, hint ? { hint } : {}) });

/** A row: its cells and sort keys (the same columns in both), with what goes with it. */
export function officeRow(
  id: string,
  cells: Record<string, Cell>,
  sort: Record<string, number | string | null>,
  extra: {
    player?: OfficePlayer | null; facts?: OfficeFact[]; claims?: Claim[]; claim?: Claim; grid?: OfficeGrid | null; ratingsFill?: Cell | null;
    filterKeys?: Record<string, string | null>;
  } = {},
): OfficeRow {
  const base = row(id, cells, sort, extra.claim);
  const out: OfficeRow = { ...base, player: extra.player ?? null };
  if (extra.facts && extra.facts.length > 0) out.facts = extra.facts;
  if (extra.claims && extra.claims.length > 0) out.claims = extra.claims;
  if (extra.grid) out.grid = extra.grid;
  const keys = Object.entries(extra.filterKeys ?? {}).filter((e): e is [string, string] => e[1] !== null);
  if (keys.length > 0) out.filterKeys = Object.fromEntries(keys);
  if (extra.ratingsFill) out.ratingsFill = extra.ratingsFill;
  return out;
}

// ── what every view shares ──────────────────────────────────────────────────

/** How current the league data is (`freshnessCue`), with the limitations a page adds. */
export interface OfficeFreshness {
  state: string;
  asOf: string | null;
  line: string | null;
  detail: string;
  limitations?: readonly string[];
}

/** What a Finance or Medical view is worded for: the club, the build, the export's day, and who prepared it. */
export interface OfficeContext {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
  gameDate: GameDate | null;
  preparedBy: Cell;
  department: DeptId;
  freshness: OfficeFreshness;
}

/** A help tag when the words fit one (at most `HINT_MAX`); longer words belong in a basis, never cut. */
export const hintIf = (text: string | null | undefined): string | undefined =>
  (text && text.trim() && text.trim().length <= HINT_MAX ? text.trim() : undefined);

/** The source a claim of the view names. */
export function officeSource(ctx: OfficeContext, specialist: string) {
  return { department: ctx.department, specialist, asOf: ctx.importStamp, gameDate: ctx.gameDate };
}

/** A basis of facts read from the export (or a count of them). */
export function officeFacts(ctx: OfficeContext, specialist: string, because: BasisLine[], unknown: string[] = []) {
  return basis({
    because: because.length > 0 ? because : [{ label: 'Read from', value: 'The imported export' }],
    source: officeSource(ctx, specialist),
    unknown,
    wouldChange: [],
    lean: null,
    certainty: 'fact',
  });
}

/** A line saying what a view is and how to read it, its explanation (each column's meaning) in the basis. */
export function officeLede(ctx: OfficeContext, specialist: string, text: string, because: BasisLine[], unknown: string[] = []) {
  return claim({ text, tone: 'neutral', basis: officeFacts(ctx, specialist, because, unknown) });
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "As of May 16, 2026" from an ISO date. */
function asOfWords(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso) : null;
  return m ? `As of ${MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

/**
 * How current the league data is, as the React pages' freshness cue says it ("As of May 16, 2026 · Data may be out of
 * date: …"), its explanation and the page's limitations in the basis; null when the export is current.
 */
export function freshnessClaim(ctx: OfficeContext, specialist: string) {
  const cue = ctx.freshness;
  if (cue.state === 'current' || !cue.line) return null;
  const asOf = asOfWords(cue.asOf);
  return claim({
    text: [asOf, cue.line].filter(Boolean).join(' · '),
    tone: cue.state === 'unverified' ? 'unknown' : 'caution',
    basis: basis({
      because: [{ label: 'How current', value: cue.detail }, ...(cue.limitations ?? []).map((l) => ({ label: 'What it leaves out', value: l }))],
      source: officeSource(ctx, specialist),
      unknown: cue.state === 'behind' ? ['Service time, control and the figures built on them, until the export is current.'] : [],
      wouldChange: ['Exporting the database from OOTP again and importing it.'],
      lean: null,
      certainty: 'fact',
    }),
  });
}

/** The head every view carries. */
export function officeHead(ctx: OfficeContext, title: string, lede: Claim, specialist: string): OfficeViewHead {
  const day = asOfWords(ctx.freshness.asOf)?.replace(/^As of /, '') ?? null;
  const through = day ? `Through ${day}` : 'Game date not known';
  return {
    orgId: ctx.orgId,
    importStamp: ctx.importStamp,
    reportStamp: ctx.reportStamp,
    title: cell(title),
    byline: cell(`${ctx.preparedBy.display} · ${through}`, ctx.preparedBy.hint ? { hint: ctx.preparedBy.hint } : {}),
    bylineParts: [ctx.preparedBy, cell(through, day ? { hint: 'The last game day in the imported export' } : { tone: 'unknown' })],
    lede,
    freshness: freshnessClaim(ctx, specialist),
  };
}

/** "3 players", "1 player". */
export const counted = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
