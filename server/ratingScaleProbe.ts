import { db, tableExists } from './db.js';
import { rememberFact, rememberedFact } from './servedFacts.js';

/**
 * The scale OOTP is set to display ratings on.
 *
 * The setting is the user's, not the league's, and the export carries whatever
 * they chose — 20-80, 1-20, 1-10, 2-8 or 1-5 — with no column saying which. A
 * reader running the 1-to-5 scale found his best contact hitter drawn as a
 * sliver, because the bars divided by eighty regardless: a 5 came out at six
 * per cent of the width instead of full.
 *
 * So it is read off the data. The top of the scale is the largest rating
 * anywhere in the file, which needs no setting to be right and is correct for
 * a custom scale nobody has thought of.
 */
let scaleCache: number | null = null;

export function ratingScaleMax(): number {
  if (scaleCache !== null) return scaleCache;
  // Worked out for this league on an earlier start (`servedFacts.ts`): the status serves it without the scan
  const remembered = rememberedFact('ratingScaleMax');
  if (typeof remembered === 'number' && Number.isFinite(remembered)) {
    scaleCache = remembered;
    return scaleCache;
  }
  const columns: Array<[string, string]> = [
    ['players_batting', 'batting_ratings_overall_contact'],
    ['players_batting', 'batting_ratings_overall_power'],
    ['players_pitching', 'pitching_ratings_overall_stuff'],
    ['players_fielding', 'fielding_ratings_infield_range'],
  ];
  let observed = 0;
  for (const [table, column] of columns) {
    if (!tableExists(table)) continue;
    try {
      const row = db.prepare(`SELECT MAX("${column}") AS m FROM "${table}"`).get() as { m: number | null };
      observed = Math.max(observed, Number(row?.m ?? 0));
    } catch {
      // A save without that column simply contributes nothing
    }
  }
  // Snap to the scale OOTP actually offers; nobody tops out at exactly the
  // maximum on a small scale, so the bands are generous at the bottom
  const known = [5, 8, 10, 20, 80];
  scaleCache = known.find((max) => observed <= max) ?? 80;
  // Only a served league's scale is remembered (a test's or a script's writable league changes under it)
  if (db.readonly) rememberFact('ratingScaleMax', scaleCache);
  return scaleCache;
}

/** Called after an import, since a new save may use a different scale. */
export function clearScaleCache(): void {
  scaleCache = null;
}
