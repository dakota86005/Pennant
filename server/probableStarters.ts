/**
 * Who is projected to start a game that has not been played (SWIFTUI_REBUILD.md N9): one reading for the schedule, a
 * game's plan and the next game, so the three never disagree about who is pitching.
 *
 * OOTP's `projected_starting_pitchers` is a club's next starts in order, `starter_0` for its next game, `starter_1` for
 * the one after, and so on (an export carries eight: a five-man rotation's five and the first three again). So a game's
 * projected starter is the slot of its place among the club's own games still to play, counted across every opponent,
 * not within one series; a game past the projection's last slot has no projected starter yet (unknown, D-018), never
 * the last slot repeated.
 */
import { db, tableColumns, tableExists } from './db.js';
import { DATE_KEY } from './dashboard.js';

/** The projection's slots in this export (`starter_0` … `starter_N`), in order; none without the table. */
function slots(): string[] {
  if (!tableExists('projected_starting_pitchers')) return [];
  const columns = new Set(tableColumns('projected_starting_pitchers'));
  if (!columns.has('team_id')) return [];
  const out: string[] = [];
  for (let i = 0; columns.has(`starter_${i}`); i++) out.push(`starter_${i}`);
  return out;
}

/** Every club's games still to play, in order: the club, then each game's place among them (0 is its next game). */
function upcomingPlaces(teams: ReadonlySet<number>): Map<number, Map<number, number>> {
  const places = new Map<number, Map<number, number>>();
  if (!tableExists('games') || teams.size === 0) return places;
  const rows = db
    .prepare(
      `SELECT game_id, home_team, away_team FROM games WHERE played = 0
       ORDER BY ${DATE_KEY('date')}, time, game_id`,
    )
    .all() as Array<{ game_id: number; home_team: number; away_team: number }>;
  for (const g of rows) {
    for (const team of [g.home_team, g.away_team]) {
      if (!teams.has(team)) continue;
      const mine = places.get(team) ?? new Map<number, number>();
      mine.set(g.game_id, mine.size);
      places.set(team, mine);
    }
  }
  return places;
}

/**
 * A reader of projected starters for some clubs' unplayed games: `starterOf(team, game)` is the projected starter's id,
 * or null when the export projects nobody that far ahead (or has no projection for the club, or the game is played).
 */
export function projectedStarters(teams: Iterable<number>): { starterOf: (teamId: number, gameId: number) => number | null } {
  const wanted = new Set(teams);
  const columns = slots();
  if (columns.length === 0) return { starterOf: () => null };
  const places = upcomingPlaces(wanted);
  const projections = new Map<number, Record<string, number | null>>();
  const read = db.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM projected_starting_pitchers WHERE team_id = ?`);
  for (const team of wanted) {
    const row = read.get(team) as Record<string, number | null> | undefined;
    if (row) projections.set(team, row);
  }
  return {
    starterOf(teamId: number, gameId: number): number | null {
      const place = places.get(teamId)?.get(gameId);
      const row = projections.get(teamId);
      if (place === undefined || !row || place >= columns.length) return null;
      const id = Number(row[columns[place]] ?? 0);
      return Number.isInteger(id) && id > 0 ? id : null;
    },
  };
}
