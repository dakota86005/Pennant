/**
 * How an affiliate has actually been using its players. Objective facts, read from the export.
 *
 * The adapter for `playingTime.ts`: innings at each position, starts and relief appearances,
 * appearances against the club's games. Who has the job is what usage shows (D-033's rule, applied
 * to the farm), so this is where "the regular at shortstop" comes from rather than from a roster
 * label.
 *
 * Statistics are objective save facts and are read directly. Nothing here touches a rating.
 */

import { db, tableColumns, tableExists } from './db.js';
import { POSITION_CODES } from './gloves.js';

export interface RawUsage {
  playerId: number;
  games: number;
  /** Position code → innings played there. */
  inningsByPosition: Record<string, number>;
  starts: number;
  reliefAppearances: number;
  inningsPitched: number;
}

export interface ClubUsage {
  teamId: number;
  games: number;
  /** Position code → the club's total innings at it, the denominator a share is taken against. */
  inningsByPosition: Record<string, number>;
  players: Map<number, RawUsage>;
}

const cache = new Map<string, ClubUsage>();

/** Cleared whenever a fresh export is imported. */
export function clearFarmUsageCaches(): void {
  cache.clear();
}

function gamesPlayed(teamId: number): number {
  if (!tableExists('team_record') || !tableColumns('team_record').includes('g')) return 0;
  const row = db.prepare('SELECT g FROM team_record WHERE team_id = ?').get(teamId) as { g: number | null } | undefined;
  return Number(row?.g ?? 0);
}

/**
 * OOTP's fielding position numbers are 1 to 9 with 1 the pitcher. `POSITION_CODES` is the same
 * order without the pitcher, so index 1 is the catcher.
 */
const codeOf = (position: number): string | null => POSITION_CODES[position - 1] ?? null;

export function clubUsage(teamId: number, year: number): ClubUsage {
  const key = `${teamId}:${year}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const out: ClubUsage = {
    teamId,
    games: gamesPlayed(teamId),
    inningsByPosition: {},
    players: new Map(),
  };

  const ensure = (playerId: number): RawUsage => {
    let row = out.players.get(playerId);
    if (!row) {
      row = { playerId, games: 0, inningsByPosition: {}, starts: 0, reliefAppearances: 0, inningsPitched: 0 };
      out.players.set(playerId, row);
    }
    return row;
  };

  if (tableExists('players_career_fielding_stats')) {
    const c = new Set(tableColumns('players_career_fielding_stats'));
    /*
     * Schema-tolerant (D-007): an export that lacks one of these columns loses the usage reading, not
     * the response. The shared synthetic fixture has no `team_id` on the fielding table, and a real
     * export from another OOTP version may differ again.
     */
    if (c.has('ip') && c.has('position') && c.has('team_id') && c.has('year') && c.has('player_id')) {
      const rows = db
        .prepare(
          `SELECT player_id, position, SUM(ip) AS ip, ${c.has('g') ? 'SUM(g)' : '0'} AS g
           FROM players_career_fielding_stats
           WHERE year = ? AND team_id = ?
           GROUP BY player_id, position`
        )
        .all(year, teamId) as Array<{ player_id: number; position: number; ip: number | null; g: number | null }>;
      for (const r of rows) {
        const code = codeOf(Number(r.position));
        const innings = Number(r.ip ?? 0);
        if (Number(r.position) === 1) continue; /* pitchers are counted from the pitching line */
        if (!code) continue;
        out.inningsByPosition[code] = (out.inningsByPosition[code] ?? 0) + innings;
        const row = ensure(Number(r.player_id));
        row.inningsByPosition[code] = (row.inningsByPosition[code] ?? 0) + innings;
      }
    }
  }

  if (tableExists('players_career_batting_stats')) {
    const c = new Set(tableColumns('players_career_batting_stats'));
    if (c.has('g') && c.has('team_id') && c.has('year') && c.has('split_id') && c.has('player_id')) {
      const rows = db
        .prepare(
          `SELECT player_id, SUM(g) AS g FROM players_career_batting_stats
           WHERE year = ? AND team_id = ? AND split_id = 1 GROUP BY player_id`
        )
        .all(year, teamId) as Array<{ player_id: number; g: number | null }>;
      for (const r of rows) ensure(Number(r.player_id)).games += Number(r.g ?? 0);
    }
  }

  if (
    tableExists('players_career_pitching_stats') &&
    ['team_id', 'year', 'split_id', 'player_id', 'outs'].every((column) =>
      new Set(tableColumns('players_career_pitching_stats')).has(column)
    )
  ) {
    const c = new Set(tableColumns('players_career_pitching_stats'));
    const col = (name: string) => (c.has(name) ? `SUM(${name})` : '0');
    const rows = db
      .prepare(
        `SELECT player_id, ${col('g')} AS g, ${col('gs')} AS gs, SUM(outs) AS outs
         FROM players_career_pitching_stats
         WHERE year = ? AND team_id = ? AND split_id = 1 GROUP BY player_id`
      )
      .all(year, teamId) as Array<{ player_id: number; g: number | null; gs: number | null; outs: number | null }>;
    for (const r of rows) {
      const row = ensure(Number(r.player_id));
      const games = Number(r.g ?? 0);
      const starts = Number(r.gs ?? 0);
      row.games += games;
      row.starts += starts;
      row.reliefAppearances += Math.max(0, games - starts);
      row.inningsPitched += Number(r.outs ?? 0) / 3;
    }
  }

  cache.set(key, out);
  return out;
}

/** An empty usage record, for a player the export has no line for. Zero appearances is a fact. */
export function noUsage(playerId: number): RawUsage {
  return { playerId, games: 0, inningsByPosition: {}, starts: 0, reliefAppearances: 0, inningsPitched: 0 };
}
