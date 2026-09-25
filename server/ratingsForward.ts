/**
 * Ratings as a FORECAST (D-053, cycle 4 of the per-save calibration): the save's own rating snapshots, each paired with a season that
 * came after it. Neutral: any subsystem that asks whether visible ratings forecast results reads its cases here, and none imports
 * another's fit (MLB Operations' tools fit, `mlbToolsFit.ts`, is the first; Player Value keeps its own reader of the same snapshots,
 * which is not migrated).
 *
 * A forward case pairs the ratings a snapshot kept with a season that began after it: the latest snapshot taken in an EARLIER season and
 * no more than `FORWARD_POLICY.maxDays` before the target season's first day. A snapshot taken during the target season is never used
 * for it (the ratings could already reflect part of it). Every other test of ratings against results on a save with one snapshot is
 * same-time: the ratings were formed from those very results, so it describes, it does not forecast.
 *
 * Ratings only through the adapter (`loadScoutedObservations`, D-017). A snapshot whose age disagrees with the player's own date of birth
 * is another person under a reused id (a regenerated league under the same save name) and is not read as his.
 */

import { db, tableColumns, tableExists } from './db.js';
import { parseGameDate } from './dataFreshness.js';
import { loadScoutedObservations, type ScoutedObservation } from './scoutedEvidence.js';

/** POLICY. The oldest a snapshot may be at the target season's first day to stand for the ratings before it (Player Value's pair window). */
export const FORWARD_POLICY = { maxDays: 430 } as const;

/** Birth years from the export (objective facts), schema-tolerant: a missing column reads nobody's. */
function birthYears(): Map<number, number> {
  const out = new Map<number, number>();
  if (!tableExists('players') || !tableColumns('players').includes('date_of_birth')) return out;
  for (const r of db.prepare(`SELECT player_id, date_of_birth AS d FROM players`).all() as Array<{ player_id: number; d: unknown }>) {
    const iso = parseGameDate(r.d ?? null);
    if (iso) out.set(Number(r.player_id), Number(iso.slice(0, 4)));
  }
  return out;
}

/** Every rating snapshot of the save that belongs to the player it names (the identity guard), oldest first per player. */
export function forwardObservations(): Map<number, ScoutedObservation[]> {
  const all = loadScoutedObservations(null);
  const births = birthYears();
  const out = new Map<number, ScoutedObservation[]>();
  for (const [id, list] of all) {
    const born = births.get(id);
    const kept = list.filter((o) => {
      if (born === undefined || typeof o.age !== 'number' || !Number.isFinite(o.age)) return true;
      return Math.abs(o.age - (Number(o.gameDate.slice(0, 4)) - born)) <= 1;
    });
    if (kept.length) out.set(id, kept);
  }
  return out;
}

const DAY = 86_400_000;
const epoch = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/**
 * The ratings a player carried into a season: his latest snapshot taken in an earlier season, no more than `maxDays` before the season's
 * first day (January 1 of it: the export dates no past season's first game). Null when none qualifies.
 */
export function snapshotBefore(list: readonly ScoutedObservation[], season: number, maxDays: number = FORWARD_POLICY.maxDays): ScoutedObservation | null {
  const start = Date.UTC(season, 0, 1);
  let best: ScoutedObservation | null = null;
  for (const o of list) {
    if (Number(o.gameDate.slice(0, 4)) >= season) continue;
    const days = (start - epoch(o.gameDate)) / DAY;
    if (days < 0 || days > maxDays) continue;
    if (!best || o.gameDate > best.gameDate) best = o;
  }
  return best;
}

/** The distinct snapshot dates the save holds (ISO), for a record's notes. */
export function snapshotDates(observations: Map<number, ScoutedObservation[]>): string[] {
  const dates = new Set<string>();
  for (const list of observations.values()) for (const o of list) dates.add(o.gameDate);
  return [...dates].sort();
}
