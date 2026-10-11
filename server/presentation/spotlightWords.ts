/**
 * What the Mac app puts in Spotlight (N14, Stage A, D-075): our organization's players (every level the search index
 * holds: the majors and the farm) and the league's major-league clubs, each in the search's own words and with where it
 * opens. The app indexes exactly this list after each import; it decides nothing about who matters.
 *
 * Pure: `glanceService.ts` hands in the search index's entries.
 */
import type { Integer } from '../contract/primitives.js';
import type { Cell } from '../contract/presentation.js';
import type { SearchEntry } from '../search.js';
import { cell } from './claim.js';
import type { SearchResult } from './frontOffice/leagueTypes.js';
import { resultOf } from './searchWords.js';

/** The list Spotlight is given (`GET /api/v2/spotlight/:org`). */
export interface SpotlightList {
  orgId: Integer;
  importStamp: string | null;
  /** Our organization's players, by name; each `line` is the search's ("SS · Hometown Hawks · Majors"). */
  players: SearchResult[];
  /** The league's major-league clubs, by name. */
  clubs: SearchResult[];
  /** What the list holds, in a sentence, for Settings and the log. */
  about: Cell;
}

const BY_NAME = new Intl.Collator('en', { sensitivity: 'base' });

/** The list for a club, from the search index's entries. */
export function spotlightWords(entries: readonly SearchEntry[], orgId: number, importStamp: string | null): SpotlightList {
  const byName = (a: SearchEntry, b: SearchEntry) => BY_NAME.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const players = entries.filter((e) => e.kind === 'player' && e.orgId === orgId).sort(byName).map((e) => resultOf(e, false));
  const clubs = entries.filter((e) => e.kind === 'club').sort(byName).map((e) => resultOf(e, false));
  return {
    orgId,
    importStamp,
    players,
    clubs,
    about: cell('Your organization\'s players and the league\'s clubs', { hint: 'Names, positions and clubs only: no ratings or values' }),
  };
}
