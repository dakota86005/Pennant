/**
 * OOTP's level numbers in the GM's words: a served sentence names a level, never its id ("Triple-A", not "level 2";
 * B-11). The one table every writer reads.
 *
 * Checked against a real save (N6 review): level 4 holds both the High-A and the Low-A leagues (the Northwest, South
 * Atlantic and Midwest with the California, Carolina and Florida State), level 5 holds none, and level 6 the complex
 * and Dominican leagues, so 4 and 5 are both "Single-A": the level number cannot tell the two A levels apart, and the
 * words never claim to. A number the table does not name is said to be unnamed, never guessed and never shown as a
 * number.
 */
export const LEVEL_WORDS: Readonly<Record<number, string>> = { 2: 'Triple-A', 3: 'Double-A', 4: 'Single-A', 5: 'Single-A', 6: 'Rookie ball' };

/** What a level the table does not name is called. */
export const UNNAMED_LEVEL = 'an unnamed level';

/** A level in words: "Majors", "Triple-A" … "Rookie ball"; an unnamed one is said to be unnamed; none is "level not known". */
export function levelWord(level: number | null | undefined): string {
  if (level === null || level === undefined || !Number.isFinite(level)) return 'level not known';
  if (level === 1) return 'Majors';
  return LEVEL_WORDS[level] ?? UNNAMED_LEVEL;
}

/** The short label (a table's level column: "AAA", "AA" …) of a level its table does not name: never "L7". */
export const UNNAMED_LEVEL_SHORT = 'Other';

/** OOTP's short level labels, as a table's level column writes them ("AAA", "AA" …), the same as `valuation.ts`'s. */
const LEVEL_SHORT: Readonly<Record<number, string>> = { 1: 'MLB', 2: 'AAA', 3: 'AA', 4: 'A', 5: 'A', 6: 'R' };

/** A level's short label; one the table does not name is `UNNAMED_LEVEL_SHORT`, never "L7". */
export function levelShort(level: number | null | undefined): string {
  return level === null || level === undefined ? UNNAMED_LEVEL_SHORT : LEVEL_SHORT[level] ?? UNNAMED_LEVEL_SHORT;
}
