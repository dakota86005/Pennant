/**
 * Who is projected to start a game that has not been played (SWIFTUI_REBUILD.md N9, D-069): one reading for the
 * schedule, a game's plan, the next game, the dashboard and the Morning Report's Tonight, so they never disagree about
 * who is pitching.
 *
 * What OOTP's `projected_starting_pitchers` is, as far as the exports show it: per club, `starter_0` … `starter_7`, and
 * the observed pattern is a five-man turn and then its first three again. Pennant reads `starter_N` as the club's
 * starter N games from now, counted along the club's own games still to play across every opponent, not within one
 * series. That is a reading of the observed pattern, not a documented rule: OOTP does not say how it fills the slots,
 * off days are not modelled (whether a day off lets the turn skip a fifth starter is not known), and a game past the
 * last slot has no projected starter yet (unknown, D-018), never the last slot repeated.
 *
 * Which games count: the regular season's (`game_type` 0, the schedule's and the next game's own filter). A club with an
 * unplayed game of another type ahead of a regular one (an exhibition, say) has its later games read as not projected,
 * because whether OOTP's turn counts that game is not known; a guessed place would name the wrong man.
 */
import { db, tableColumns, tableExists } from './db.js';
import { DATE_KEY } from './dataFreshness.js';

/** The projection's slots in this export (`starter_0` … `starter_N`), in order; none without the table. */
function slots(): string[] {
  if (!tableExists('projected_starting_pitchers')) return [];
  const columns = new Set(tableColumns('projected_starting_pitchers'));
  if (!columns.has('team_id')) return [];
  const out: string[] = [];
  for (let i = 0; columns.has(`starter_${i}`); i++) out.push(`starter_${i}`);
  return out;
}

/**
 * Every club's regular-season games still to play, in order: the club, then each game's place among them (0 is its next
 * game). A club's games after an unplayed game of another type get no place (not known; see the head of this file).
 */
function upcomingPlaces(teams: ReadonlySet<number>): Map<number, Map<number, number>> {
  const places = new Map<number, Map<number, number>>();
  if (!tableExists('games') || teams.size === 0) return places;
  const typed = tableColumns('games').includes('game_type');
  const rows = db
    .prepare(
      `SELECT game_id, home_team, away_team, ${typed ? 'COALESCE(game_type, 0)' : '0'} AS game_type FROM games WHERE played = 0
       ORDER BY ${DATE_KEY('date')}, time, game_id`,
    )
    .all() as Array<{ game_id: number; home_team: number; away_team: number; game_type: number }>;
  const stopped = new Set<number>();
  for (const g of rows) {
    for (const team of [g.home_team, g.away_team]) {
      if (!teams.has(team) || stopped.has(team)) continue;
      if (g.game_type !== 0) {
        stopped.add(team);
        continue;
      }
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

/** The clubs the export projects any starter for (a club with no row, or only empty slots, has none at all). */
export function projectedClubs(): number[] {
  const columns = slots();
  if (columns.length === 0) return [];
  const rows = db.prepare(`SELECT team_id, ${columns.map((c) => `"${c}"`).join(', ')} FROM projected_starting_pitchers`).all() as Array<Record<string, number | null>>;
  return rows.filter((r) => columns.some((c) => Number(r[c] ?? 0) > 0)).map((r) => Number(r.team_id));
}
