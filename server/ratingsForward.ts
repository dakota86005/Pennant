/**
 * Ratings as a FORECAST (D-053, cycle 4 of the per-save calibration): the save's own rating snapshots, each paired with a season that
 * came after it. Neutral: any subsystem that asks whether visible ratings forecast results reads its cases here, and none imports
 * another's fit (MLB Operations' tools fit, `mlbToolsFit.ts`, is the first; Player Value keeps its own reader of the same snapshots,
 * which is not migrated).
 *
 * A forward case pairs the ratings a snapshot kept with a season that began after it: the latest snapshot taken BEFORE the season's first
 * game (an offseason or spring import stands for the season about to start) and no more than `FORWARD_POLICY.maxDays` before it. A
 * snapshot taken once the season is under way is never used for it (the ratings could already reflect part of it). The first game is
 * the export's own date for the season where it holds one, else a stated policy date (`FORWARD_POLICY.openingDay`). Every other test of ratings against results on a save with one snapshot is
 * same-time: the ratings were formed from those very results, so it describes, it does not forecast.
 *
 * Ratings only through the adapter (`loadScoutedObservations`, D-017). A snapshot whose age disagrees with the player's own date of birth
 * is another person under a reused id (a regenerated league under the same save name) and is not read as his.
 */

import { db, tableColumns, tableExists } from './db.js';
import { parseGameDate } from './dataFreshness.js';
import { loadScoutedObservations, type ScoutedObservation } from './scoutedEvidence.js';

/** POLICY. The oldest a snapshot may be at the target season's first day to stand for the ratings before it (Player Value's pair window). */
export const FORWARD_POLICY = {
  maxDays: 430,
  /**
   * When the export does not date a season's first game (it keeps the current season's schedule only), a snapshot must be taken before
   * this month-day of the season's year to stand for it: before any opening day in the imported history (March 20), so a spring import
   * stands for its own season and one taken after opening day never does.
   */
  openingDay: { month: 3, day: 20 },
} as const;

/** The first scheduled regular-season game of each season the export dates for a league (ISO), schema-tolerant. */
export function firstGames(leagueId: number): Map<number, string> {
  const out = new Map<number, string>();
  if (!tableExists('games')) return out;
  const cols = new Set(tableColumns('games'));
  if (!cols.has('date') || !cols.has('league_id')) return out;
  const type = cols.has('game_type') ? ' AND COALESCE(game_type, 0) = 0' : '';
  for (const r of db.prepare(`SELECT date FROM games WHERE league_id = ?${type}`).all(leagueId) as Array<{ date: unknown }>) {
    const iso = parseGameDate(r.date ?? null);
    if (!iso) continue;
    const y = Number(iso.slice(0, 4));
    const had = out.get(y);
    if (!had || iso < had) out.set(y, iso);
  }
  return out;
}

/** The day a season begins, for pairing: the export's first game where it dates one, else the policy opening day (ISO). */
export function seasonStart(season: number, firstGame: string | null | undefined): string {
  if (firstGame) return firstGame;
  const { month, day } = FORWARD_POLICY.openingDay;
  return `${season}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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
 * The ratings a player carried into a season: his latest snapshot taken before the season's start (`seasonStart`), no more than `maxDays`
 * before it, with how many days before it was taken. Null when none qualifies.
 */
export function snapshotBefore(list: readonly ScoutedObservation[], season: number, firstGame: string | null = null, maxDays: number = FORWARD_POLICY.maxDays): { observation: ScoutedObservation; gapDays: number } | null {
  const start = epoch(seasonStart(season, firstGame));
  let best: { observation: ScoutedObservation; gapDays: number } | null = null;
  for (const o of list) {
    const days = Math.round((start - epoch(o.gameDate)) / DAY);
    if (days <= 0 || days > maxDays) continue;
    if (!best || o.gameDate > best.observation.gameDate) best = { observation: o, gapDays: days };
  }
  return best;
}

/** The distinct snapshot dates the save holds (ISO), for a record's notes. */
export function snapshotDates(observations: Map<number, ScoutedObservation[]>): string[] {
  const dates = new Set<string>();
  for (const list of observations.values()) for (const o of list) dates.add(o.gameDate);
  return [...dates].sort();
}
