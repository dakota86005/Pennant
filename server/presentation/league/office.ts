/**
 * The Office kit's server half (N12 Track B, D-072): the few shapes League Office's and Scouting's tables are served
 * in, and their helpers, kept in their own file so the front office's other tracks can share them (N12 Track A's
 * `presentation/officeTable.ts` is the same kit for Finance and Medical; the merge makes them one, SWIFTUI_REBUILD.md
 * "As built at N12 (Track B)"). A table is its columns, its rows in the served order (a cell and a sort key per column,
 * null when unknown so it sorts last both ways) and its sentence when it has none; a row names the player or the club
 * it is about, so either opens its own window. Pure: it words what it is handed and decides nothing (D-001, D-056).
 */
import type { Cell, Claim, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import { cell, target } from '../claim.js';
import type { MlbAction, MlbColumn, MlbRow } from '../majorLeague/types.js';

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

/**
 * A table's column: N8's column (its id, title with its hint, whether it holds numbers, hidden until shown), whether it
 * sorts (a column of mixed units, Us vs Them's figures, doesn't), and whether it sorts by its cells' words: then its rows
 * carry no sort key for it (they would only repeat the words), and the app sorts by the words, an unknown cell last.
 */
export interface OfficeColumn extends MlbColumn {
  sortable: boolean;
  byWords?: boolean;
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

/** A column of a League Office or Scouting table: sortable unless said, by its rows' keys unless it sorts by its words. */
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
