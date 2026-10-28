/**
 * What League Office's and Scouting's views are built from (N12 Track B, D-072): their context (the department's, as
 * the clubhouse tools have it), a club that opens its window, and a club's row. Pure: it words what it is handed and
 * reads nothing (D-056). The clubhouse tools' helpers (`head`, `factClaim`, `player`, the season-line cells) are reused
 * from `../clubhouse/common.ts`.
 */
import type { ClubhouseContext } from '../clubhouse/common.js';

/** A League Office or Scouting view's context: the department's (its source, the build), as the clubhouse tools' is. */
export type OfficeContext = ClubhouseContext;

export { clubCell, clubRow, column, officeClub, openClub } from './office.js';

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
