/**
 * The Office kit's server half (N12, D-071 and D-072; D-071's amendment): the few shapes every front-office table outside
 * Major League Ops is served in, Finance's, Medical's, League Office's and Scouting's alike, so the Mac app draws them
 * all with one native table (FeatureCore's `OfficeKit.swift`). A table is its columns, its rows in the specialist's own
 * order (a cell and an ordinal sort key per column, null when unknown so it sorts last both ways) and the sentence it says
 * when it has none. A row names the player or the club it is about, so either opens its own window; what goes with a
 * chosen row (N8's detail blocks, or Finance's facts, claims and short table) is drawn beneath the table. A filter's
 * choices name no rows: each row names the choice it falls under (`filterKeys`). Every word is served; nothing here
 * decides anything (D-001, D-056).
 */
import type { GameDate } from '../dataFreshness.js';
import type { BasisLine, Cell, Claim, DeptId, Target } from '../contract/presentation.js';
import type { Integer } from '../contract/primitives.js';
import { basis, cell, claim, HINT_MAX, row, target } from './claim.js';
import type { MlbAction, MlbColumn, MlbPlayer, MlbRow } from './majorLeague/types.js';

/** A club a view names: its id, its name, whether it is ours, and where it opens (its club window). */
export interface OfficeClub {
  teamId: Integer;
  name: string;
  abbr: string | null;
  ours: boolean;
  open: Target;
}

/**
 * A table's column: N8's column (its id, title with its hint, whether it holds numbers, hidden until shown), whether it
 * sorts (a column of mixed units, Us vs Them's figures, or a contract's notes, doesn't), and whether it sorts by its
 * cells' words: then its rows carry no sort key for it (they would only repeat the words), and the app sorts by the
 * words, an unknown cell last.
 */
export interface OfficeColumn extends MlbColumn {
  sortable: boolean;
  byWords?: boolean;
}

/** One labelled fact beneath a chosen row ("Signed through", "2031"). */
export interface OfficeFact {
  label: Cell;
  value: Cell;
}

/**
 * A row: N8's row (its cells and sort keys, the player it is about with his OSA mark, its detail blocks and what it
 * offers to open), the club it is about when it is about one (a standings line) and whether it is ours (drawn marked,
 * never the only signal: its words say so too); Finance's facts, claims and short table drawn beneath it when chosen
 * (each left out when it has none, and a long list's served on its own when the row is chosen); and the choice of each
 * filter group it falls under.
 */
export interface OfficeRow extends MlbRow {
  club?: OfficeClub;
  ours?: boolean;
  facts?: OfficeFact[];
  claims?: Claim[];
  /** A short table beneath the chosen row (a contract's seasons under control). */
  grid?: OfficeGrid;
  /**
   * The choice it falls under in each of its table's filter groups, by group id (`{ side: 'pitchers', age: 'prime' }`);
   * a group it falls under no choice of (his age not known) is left out, so only that group's first choice keeps him.
   */
  filterKeys?: Record<string, string>;
}

/** A short table drawn as a grid (its columns' titles and its rows' cells), never sorted. */
export interface OfficeGrid {
  title: Cell;
  columns: Cell[];
  rows: Cell[][];
  /** The sentence when it has no rows. */
  empty: Cell | null;
}

/** A table, ready to show: its columns, its rows in the served order, and its sentence when it has none. */
export interface OfficeTable {
  columns: OfficeColumn[];
  rows: OfficeRow[];
  empty: Cell | null;
  /**
   * The server sorts this table, over more rows than it serves (Player Search's whole league): a column's sort is asked
   * for (`sort`, `dir`), its rows carry no sort keys, and the app shows them as served. Absent: the app sorts by the keys.
   */
  serverSorts?: boolean;
  /** A table drawn with a chosen row's detail beneath it: what it says when the filters keep none of its rows. */
  noneKept?: Cell;
  /** And what it says beneath it while no row is chosen. */
  choose?: Cell;
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

/**
 * A group of the GM's choices for a view that the server answers (the opponent, the batters or the pitchers): the query
 * parameter it sets. Apart from `OfficeFilterGroup`, which narrows a served table in the app by its rows' `filterKeys`.
 */
export interface OfficeChoiceGroup {
  /** The query parameter the choice is sent as (`team`). */
  id: string;
  title: Cell;
  choices: OfficeChoice[];
}

/** A table drawn with its chosen row's detail beneath it, with the two sentences that go with that (N12 review, L6). */
export function paneTable(table: OfficeTable, noun = 'players'): OfficeTable {
  return choosable({ ...table, noneKept: cell(`No ${noun} match these filters.`) });
}

/**
 * A table drawn with its chosen row's detail beneath it and no filters of its own (League Office's, Scouting's): what it
 * says beneath it while no row is chosen. Served, so the app writes no sentence of its own (D-056).
 */
export function choosable<T extends OfficeTable>(table: T): T {
  return { ...table, choose: cell('Select a row to see more.') };
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

/** A column: sortable unless said, by its rows' keys unless it sorts by its words. */
export function column(
  id: string,
  title: string,
  numeric = false,
  extra: { hint?: string; hidden?: boolean; sortable?: boolean; byWords?: boolean } = {},
): OfficeColumn {
  return {
    id,
    title: cell(title, extra.hint ? { hint: extra.hint } : {}),
    numeric,
    sortable: extra.sortable ?? true,
    ...(extra.hidden ? { hidden: true } : {}),
    ...(extra.byWords ? { byWords: true } : {}),
  };
}

/** A club a view names, opening its club window; "Unnamed club" when the export names none. */
export function officeClub(teamId: number, name: string | null | undefined, abbr: string | null | undefined, ours: boolean): OfficeClub {
  return {
    teamId,
    name: (name ?? '').trim() || 'Unnamed club',
    abbr: (abbr ?? '').trim() || null,
    ours,
    open: target({ kind: 'club', teamId }),
  };
}

/** What a club's row offers to open: its club window. */
export function openClub(club: OfficeClub): MlbAction {
  return { text: cell(`Open the ${club.name}`), open: club.open };
}

/** A club's cell: its name, marked as ours in words when it is (never colour alone). */
export function clubCell(club: OfficeClub): Cell {
  return club.ours ? cell(club.name, { hint: 'Your club' }) : cell(club.name);
}

/** A row about a club: its cells and sort keys, the club, ours marked, opening its window, with any detail given. */
export function clubRow(
  id: string,
  club: OfficeClub,
  cells: Record<string, Cell>,
  sort: Record<string, number | string | null>,
  extra: Partial<Pick<OfficeRow, 'detail' | 'claim' | 'players'>> = {},
): OfficeRow {
  return {
    id,
    cells,
    sort,
    player: null,
    detail: extra.detail ?? [],
    actions: [openClub(club)],
    club,
    ...(club.ours ? { ours: true } : {}),
    ...(extra.claim ? { claim: extra.claim } : {}),
    ...(extra.players ? { players: extra.players } : {}),
  };
}

/**
 * A row with only the sort keys its table serves (N12 Track B review, M2): built with every key (`row()`'s rule), then
 * none for a column that sorts by its words (they would only repeat the words), and none at all when the server sorts.
 */
export function keysServed<R extends MlbRow>(row: R, columns: OfficeColumn[], serverSorts = false): R {
  if (serverSorts) return { ...row, sort: {} };
  const words = columns.filter((c) => c.byWords).map((c) => c.id);
  if (!words.length) return row;
  const sort = { ...row.sort };
  for (const id of words) delete sort[id];
  return { ...row, sort };
}

/** A player a table names, opening his window (with his organization's club when known). */
export function officePlayer(playerId: number, name: string, teamId?: number | null): MlbPlayer {
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
    player?: MlbPlayer | null; facts?: OfficeFact[]; claims?: Claim[]; claim?: Claim; grid?: OfficeGrid | null; ratingsFill?: Cell | null;
    filterKeys?: Record<string, string | null>;
  } = {},
): OfficeRow {
  const base = row(id, cells, sort, extra.claim);
  const out: OfficeRow = { ...base, player: extra.player ?? null, detail: [], actions: [] };
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
