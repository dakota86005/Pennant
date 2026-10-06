/**
 * What League Office's and Scouting's views are built from (N12 Track B, D-072): their context (the department's, as
 * the clubhouse tools have it), a club that opens its window, and a club's row. Pure: it words what it is handed and
 * reads nothing (D-056). The clubhouse tools' helpers (`head`, `factClaim`, `player`, the season-line cells) are reused
 * from `../clubhouse/common.ts`.
 */
import type { Cell } from '../../contract/presentation.js';
import { cell, target } from '../claim.js';
import type { ClubhouseContext } from '../clubhouse/common.js';
import type { MlbAction, MlbColumn } from '../majorLeague/types.js';
import type { OfficeClub, OfficeRow } from './types.js';

/** A League Office or Scouting view's context: the department's (its source, the build), as the clubhouse tools' is. */
export type OfficeContext = ClubhouseContext;

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

/** A column of a League Office or Scouting table. */
export function column(id: string, title: string, numeric = false, extra: { hint?: string; hidden?: boolean } = {}): MlbColumn {
  return {
    id,
    title: cell(title, extra.hint ? { hint: extra.hint } : {}),
    numeric,
    ...(extra.hidden ? { hidden: true } : {}),
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

/** An ordinal ("1st", "2nd", "3rd", "11th"). */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const one = n % 10;
  return `${n}${one === 1 ? 'st' : one === 2 ? 'nd' : one === 3 ? 'rd' : 'th'}`;
}

/** A winning percentage as baseball writes it (".512"); null when there is none. */
export function pctText(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  return pct.toFixed(3).replace(/^0\./, '.');
}

/** A signed whole number ("+12", "-4", "0"). */
export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
