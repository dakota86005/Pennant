/**
 * The reads behind Player Development's ceiling-line measurement (`stakesLines.ts`), and its registration with the per-save refit
 * (D-053; cycle 4). Measured once per export game date, in the refit worker, off the server's event loop.
 *
 * It reads the league's ACTIVE major leaguers (the active list of each of its clubs, all-star sides excluded, retired players excluded)
 * and their current visible composite through the scouted-evidence adapter, never a rating column (D-017). Nothing else: no result,
 * no usage, no philosophy, no Player Value and no MLB Operations answer.
 */

import { db, tableColumns, tableExists } from './db.js';
import { loadScoutedAbilities } from './scoutedEvidence.js';
import { registerCalibration, type CalibrationBasis } from './saveCalibration.js';
import { latestCalibrationAttempt } from './saveCalibrationStore.js';
import {
  measureCeilingLines, startingLines, STAKES_LINES_COMPONENT, STAKES_LINES_METHOD, STAKES_SUBSYSTEM,
  type CeilingLinesInForce, type MajorLeaguer, type StakesLinesModel,
} from './stakesLines.js';

/** The active list in `team_roster` (the export's list id for a club's active roster). */
const ACTIVE_LIST = 2;

/** The league's active major leaguers with a visible composite, by kind. Schema-tolerant: a missing table or column reads nobody. */
export function leagueMajorLeaguers(leagueId: number): MajorLeaguer[] {
  if (!tableExists('players') || !tableExists('teams') || !tableExists('team_roster')) return [];
  const teams = new Set(tableColumns('teams'));
  if (!teams.has('level') || !teams.has('league_id')) return [];
  const allstar = teams.has('allstar_team') ? ' AND t.allstar_team = 0' : '';
  const retired = tableColumns('players').includes('retired') ? ' AND p.retired = 0' : '';
  const rows = db.prepare(
    `SELECT p.player_id AS id, p.position AS position, t.team_id AS club
     FROM players p JOIN teams t ON t.team_id = p.team_id
     JOIN team_roster r ON r.team_id = t.team_id AND r.player_id = p.player_id AND r.list_id = ?
     WHERE t.level = 1 AND t.league_id = ?${allstar}${retired}`
  ).all(ACTIVE_LIST, leagueId) as Array<{ id: number; position: number | null; club: number }>;
  const abilities = loadScoutedAbilities(rows.map((r) => r.id));
  const out: MajorLeaguer[] = [];
  for (const r of rows) {
    const a = abilities.for(r.id);
    if (a.current === null || a.kind === 'unknown') continue;
    out.push({ clubId: r.club, kind: a.kind, composite: a.current });
  }
  return out;
}

/** The day before an export's game date (ISO), so the lines "before" a measurement never include one at its own date (a forced re-measure). */
function dayBefore(gameDate: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(gameDate);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The lines in force before this export's measurement: what the latest earlier measurement left in force (its own lines, or the lines
 * it carried), else the starting lines.
 */
function inForceBefore(leagueId: number, gameDate: string | null): CeilingLinesInForce {
  const before = gameDate === null ? null : dayBefore(gameDate);
  if (before === null) return startingLines('not_measured');
  const latest = latestCalibrationAttempt<StakesLinesModel>(leagueId, STAKES_SUBSYSTEM, STAKES_LINES_COMPONENT, STAKES_LINES_METHOD, { gameDateMax: before });
  return latest?.model?.inForce ?? startingLines('not_measured');
}

export function computeStakesLines(b: CalibrationBasis) {
  const players = leagueMajorLeaguers(b.leagueId);
  if (players.length === 0) return { skip: 'The league has no active major leaguers with a visible composite in the export.' };
  return measureCeilingLines(players, { leagueId: b.leagueId, gameDate: b.gameDate, throughSeason: b.throughSeason }, inForceBefore(b.leagueId, b.gameDate));
}

registerCalibration({
  subsystem: STAKES_SUBSYSTEM, component: STAKES_LINES_COMPONENT, method: STAKES_LINES_METHOD, trigger: 'each_import',
  compute: (b) => computeStakesLines(b),
});

/** Loaded for its registration; the worker and the harness import it. */
export const STAKES_LINES_REGISTERED = true;
