/**
 * The save's identity and its league's seasons: a neutral module (D-053, per-save calibration).
 *
 * Every subsystem that keeps a fit per save needs the same three answers, and none of them belongs to one
 * subsystem: which save this is (its configured name and a fingerprint of the league's own history, so a new
 * save under a reused name never inherits another's fits), which seasons the league has played and how long
 * each was, and the last season the league has completed. They were first written for Player Value and moved
 * here unchanged (byte-identical identity: `tests/saveIdentity.test.ts`), so MLB Operations and the other
 * subsystems reach them without importing Player Value's files (`tests/saveCalibrationBoundary.test.ts`).
 *
 * Opens `league.db` read-only, every column checked before it is read (D-007). Reads no rating, no
 * `players_value` and no philosophy, and writes nothing. Dates are compared only through `parseGameDate`.
 */

import { db, tableColumns, tableExists } from './db.js';
import { parseGameDate } from './dataFreshness.js';
import { currentSaveName } from './history.js';
import { allLeagueRules, type LeagueRules } from './leagueRules.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One season of the league's standings. */
export interface SeasonRecord {
  season: number;
  clubs: Set<number>;
  wins: number;
  games: number;
  source: string;
}

/** A season with major-league results, its schedule, and its share of a full one. */
export interface LeagueSeason {
  season: number;
  /** Games played per club over that season's schedule, against its neighbours'; null when not established. */
  scheduleShare: number | null;
  /** That season's schedule, games per club; null or absent when not established. */
  games?: number | null;
}

// ── clubs, standings and where the season stands ─────────────────────────────

/** The clubs that play in a league (all-star sides excluded where the export marks them). */
export function leagueClubs(leagueId: number): Set<number> {
  const out = new Set<number>();
  if (!tableExists('teams')) return out;
  const columns = new Set(tableColumns('teams'));
  if (!columns.has('team_id') || !columns.has('league_id')) return out;
  const allStar = columns.has('allstar_team') ? ' AND COALESCE(allstar_team, 0) = 0' : '';
  for (const r of db.prepare(`SELECT team_id FROM teams WHERE league_id = ?${allStar}`).all(leagueId) as Array<{ team_id: unknown }>) {
    const id = numberOrNull(r.team_id);
    if (id !== null) out.add(id);
  }
  return out;
}

/**
 * The league's standings for a season: this season from `team_record`, a past one from
 * `team_history_record`. Games are `g` where exported, else wins plus losses (plus ties).
 */
export function leagueRecord(leagueId: number, clubs: Set<number>, season: number, current: boolean): SeasonRecord | null {
  const table = current ? 'team_record' : 'team_history_record';
  if (!tableExists(table)) return null;
  const present = new Set(tableColumns(table));
  if (!present.has('team_id') || !present.has('w')) return null;
  if (!current && !present.has('year')) return null;
  const games = present.has('g') ? 'g' : present.has('l') ? `w + l${present.has('t') ? ' + COALESCE(t, 0)' : ''}` : null;
  if (games === null) return null;
  // A past season names its own league where the export says so; otherwise the club's league today
  const byLeague = !current && present.has('league_id');
  const where = current ? '1 = 1' : byLeague ? 'year = ? AND league_id = ?' : 'year = ?';
  const params = current ? [] : byLeague ? [season, leagueId] : [season];
  const rows = db.prepare(`SELECT team_id, w, ${games} AS games FROM ${table} WHERE ${where}`).all(...params) as
    Array<{ team_id: unknown; w: unknown; games: unknown }>;
  const out: SeasonRecord = { season, clubs: new Set(), wins: 0, games: 0, source: table };
  for (const r of rows) {
    const team = numberOrNull(r.team_id);
    const w = numberOrNull(r.w);
    const g = numberOrNull(r.games);
    if (team === null || w === null || g === null) continue;
    if (!byLeague && !clubs.has(team)) continue;
    out.clubs.add(team);
    out.wins += w;
    out.games += g;
  }
  return out.clubs.size > 0 ? out : null;
}

/** The share of this season played: team games played over clubs × games per team. */
export function seasonPlayedOf(now: SeasonRecord | null, gamesPerTeam: Sourced<number>): Sourced<number> {
  if (now === null) return unknownBecause('not_exported_by_ootp', 'team_record.g', "This season's standings are not in the export.");
  if (gamesPerTeam.value === null) {
    return unknownBecause('not_exported_by_ootp', 'leagues.rules_schedule_games_per_team', `The schedule length is not established (${gamesPerTeam.note ?? 'not exported'}).`);
  }
  const scheduled = now.clubs.size * gamesPerTeam.value;
  return derivedFrom(now.games / scheduled,'team_record.g + leagues.rules_schedule_games_per_team',
    `${now.games} of ${scheduled} team-games played (${now.clubs.size} clubs × ${gamesPerTeam.value}).`);
}

/** The league's current game date, as an ISO date (`parseGameDate`), or null. */
export function leagueGameDate(leagueId: number): string | null {
  if (!tableExists('leagues')) return null;
  const present = new Set(tableColumns('leagues'));
  if (!present.has('league_id') || !present.has('current_date')) return null;
  const row = db.prepare(`SELECT "current_date" AS d FROM leagues WHERE league_id = ?`).get(leagueId) as { d: unknown } | undefined;
  return parseGameDate(row?.d ?? null);
}


/**
 * The top level of each league that is a market of its own (no parent league): its "majors". A league whose
 * top clubs play at a level other than 1 (an independent league) has its majors at that level (D-16).
 */
export function marketLevels(): Map<number, number> {
  const out = new Map<number, number>();
  if (!tableExists('leagues')) return out;
  const present = new Set(tableColumns('leagues'));
  if (!present.has('league_id') || !present.has('league_level')) return out;
  const parent = present.has('parent_league_id') ? 'COALESCE(parent_league_id, 0) = 0' : '1 = 1';
  for (const r of db.prepare(`SELECT league_id, league_level FROM leagues WHERE ${parent}`).all() as Array<{ league_id: unknown; league_level: unknown }>) {
    const id = numberOrNull(r.league_id);
    const level = numberOrNull(r.league_level);
    if (id !== null && level !== null && level > 0) out.set(id, level);
  }
  return out;
}

/**
 * Each season's schedule, games per club: the most common games played among the league's clubs in that
 * season's standings (a strike or a pandemic shows as its own short schedule); failing the standings, the
 * most games any player played at the league's top level that season (a lower bound, said so by the caller).
 */
export function seasonSchedules(leagueId: number, through: number): Map<number, number> {
  const out = new Map<number, number>();
  if (tableExists('team_history_record')) {
    const cols = new Set(tableColumns('team_history_record'));
    if (cols.has('year') && cols.has('team_id') && (cols.has('g') || (cols.has('w') && cols.has('l')))) {
      const games = cols.has('g') ? 'g' : 'w + l';
      const byLeague = cols.has('league_id') ? ' AND league_id = ?' : '';
      const rows = db.prepare(`SELECT year, ${games} AS g, COUNT(*) AS n FROM team_history_record WHERE year <= ?${byLeague} GROUP BY year, ${games}`)
        .all(through, ...(byLeague ? [leagueId] : [])) as Array<{ year: unknown; g: unknown; n: unknown }>;
      const best = new Map<number, { g: number; n: number }>();
      for (const r of rows) {
        const y = numberOrNull(r.year);
        const g = numberOrNull(r.g);
        const n = numberOrNull(r.n) ?? 0;
        if (y === null || g === null || g <= 0) continue;
        const had = best.get(y);
        if (!had || n > had.n || (n === had.n && g > had.g)) best.set(y, { g, n });
      }
      for (const [y, x] of best) out.set(y, x.g);
    }
  }
  if (tableExists('players_career_batting_stats')) {
    const present = new Set(tableColumns('players_career_batting_stats'));
    if (['year', 'level_id', 'split_id', 'league_id', 'g', 'player_id'].every((c) => present.has(c))) {
      const rows = db.prepare(
        `SELECT year, MAX(g) AS g FROM (SELECT player_id, year, SUM(g) AS g FROM players_career_batting_stats
         WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year <= ? GROUP BY player_id, year) GROUP BY year`
      ).all(marketLevels().get(leagueId) ?? 1, leagueId, through) as Array<{ year: unknown; g: unknown }>;
      for (const r of rows) {
        const y = numberOrNull(r.year);
        const g = numberOrNull(r.g);
        if (y !== null && g !== null && g > 0 && !out.has(y)) out.set(y, g);
      }
    }
  }
  return out;
}

/**
 * The seasons with major-league results in a league, up to `through`, each with its schedule and its share of
 * a full schedule. A season is measured against its NEIGHBOURS' schedules (the seasons either side), never
 * against today's: a league that lengthened its schedule keeps its history (D-06), and a genuinely short
 * season (1981, 2020) is short against both sides.
 */
export function leagueSeasons(leagueId: number, through: number, _gamesPerTeam?: number | null): LeagueSeason[] {
  if (!tableExists('players_career_batting_stats')) return [];
  const present = new Set(tableColumns('players_career_batting_stats'));
  if (!['year', 'level_id', 'split_id', 'league_id'].every((c) => present.has(c))) return [];
  const years = (db.prepare(
    `SELECT DISTINCT year FROM players_career_batting_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year <= ? ORDER BY year`
  ).all(marketLevels().get(leagueId) ?? 1, leagueId, through) as Array<{ year: unknown }>).map((r) => numberOrNull(r.year)).filter((y): y is number => y !== null);
  const schedules = seasonSchedules(leagueId, through);
  const span = 3;
  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  return years.map((season) => {
    const games = schedules.get(season) ?? null;
    if (games === null) return { season, scheduleShare: null, games: null };
    const side = (dir: number) => median(Array.from({ length: span }, (_, i) => schedules.get(season + dir * (i + 1))).filter((g): g is number => typeof g === 'number'));
    const before = side(-1);
    const after = side(1);
    const refs = [before, after].filter((x): x is number => x !== null);
    // Short only when short against both sides; with no neighbours at all it is its own schedule
    const share = refs.length === 0 ? 1 : Math.max(...refs.map((r) => games / r));
    return { season, scheduleShare: share, games };
  });
}

/** The league's first season with major-league lines: a season before it did not exist, and is unknown, never zero (D-02). */
export function firstLeagueSeason(leagueId: number): number | null {
  if (!tableExists('players_career_batting_stats')) return null;
  const present = new Set(tableColumns('players_career_batting_stats'));
  if (!['year', 'level_id', 'league_id'].every((c) => present.has(c))) return null;
  const level = marketLevels().get(leagueId) ?? 1;
  const row = db.prepare(`SELECT MIN(year) AS y FROM players_career_batting_stats WHERE level_id = ? AND league_id = ?`).get(level, leagueId) as { y: unknown } | undefined;
  return numberOrNull(row?.y ?? null);
}

/** Whether the league has major-league lines for a season: a season is complete only with its lines (D-08). */
export function hasSeasonLines(leagueId: number, season: number): boolean {
  if (!tableExists('players_career_batting_stats')) return false;
  const present = new Set(tableColumns('players_career_batting_stats'));
  if (!['year', 'level_id', 'league_id'].every((c) => present.has(c))) return false;
  const level = marketLevels().get(leagueId) ?? 1;
  return db.prepare(`SELECT 1 FROM players_career_batting_stats WHERE level_id = ? AND league_id = ? AND year = ? LIMIT 1`).get(level, leagueId, season) !== undefined;
}

/**
 * The league's games this season from the schedule itself (`games`): the regular-season games per club, and
 * how many of them are played. The schedule is an objective fact where the rules row lacks its length (D-15).
 */
export function scheduledGames(leagueId: number, clubs: number): { perClub: number; played: number; unplayed: number } | null {
  if (!tableExists('games') || clubs <= 0) return null;
  const present = new Set(tableColumns('games'));
  if (!present.has('played')) return null;
  const where = [present.has('league_id') ? 'league_id = ?' : null, present.has('game_type') ? 'COALESCE(game_type, 0) = 0' : null].filter(Boolean) as string[];
  if (!present.has('league_id')) return null;
  const row = db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN played = 1 THEN 1 ELSE 0 END) AS p FROM games WHERE ${where.join(' AND ')}`).get(leagueId) as { n: unknown; p: unknown } | undefined;
  const n = numberOrNull(row?.n ?? null) ?? 0;
  const p = numberOrNull(row?.p ?? null) ?? 0;
  if (n <= 0) return null;
  return { perClub: (2 * n) / clubs, played: (2 * p) / clubs, unplayed: n - p };
}

/**
 * A fingerprint of the league's identity in this save: its id and name, its first season with major-league
 * lines, and the first players of that season with their dates of birth. A new save under a reused name and
 * league id (a restarted or regenerated league) differs, and never inherits another save's fits (D-01).
 */
export function leagueFingerprint(leagueId: number): string {
  const parts: string[] = [String(leagueId)];
  if (tableExists('leagues') && new Set(tableColumns('leagues')).has('name')) {
    const r = db.prepare(`SELECT name FROM leagues WHERE league_id = ?`).get(leagueId) as { name: unknown } | undefined;
    parts.push(String(r?.name ?? ''));
  }
  const first = firstLeagueSeason(leagueId);
  parts.push(String(first ?? ''));
  if (first !== null && tableExists('players') && new Set(tableColumns('players')).has('date_of_birth')) {
    const level = marketLevels().get(leagueId) ?? 1;
    const rows = db.prepare(
      `SELECT p.player_id AS id, p.date_of_birth AS dob FROM players p WHERE p.player_id IN
         (SELECT player_id FROM players_career_batting_stats WHERE level_id = ? AND league_id = ? AND year = ?)
       ORDER BY p.player_id LIMIT 64`
    ).all(level, leagueId, first) as Array<{ id: unknown; dob: unknown }>;
    parts.push(rows.map((r) => `${String(r.id)}@${parseGameDate(r.dob ?? null) ?? ''}`).join(','));
  }
  // A small stable hash (FNV-1a), never a secret: an identity, printed with the save's name
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── the save's identity and the last completed season ─────────────────────────

const identities = new Map<number, string>();

/** The save's identity for a league: its configured name and the league's fingerprint (cached until an import). */
export function saveIdentity(leagueId: number): string {
  let id = identities.get(leagueId);
  if (id === undefined) {
    id = `${currentSaveName()}|${leagueFingerprint(leagueId)}`;
    identities.set(leagueId, id);
  }
  return id;
}

/** Forget the cached identities: the export changed (an import), or a test rebuilt the league. */
export function clearSaveIdentityCache(): void {
  identities.clear();
}

/** The games per club this season: the rules' schedule where exported, else the schedule itself (D-15). */
export function gamesThisSeason(leagueId: number, league: LeagueRules | undefined, clubs: Set<number>): number | null {
  const rule = league?.gamesPerTeam.value ?? null;
  if (rule !== null && rule > 0) return rule;
  return scheduledGames(leagueId, clubs.size)?.perClub ?? null;
}

/**
 * The last completed season in a league: this season once every game is played AND the league has its
 * major-league lines (a season number bumped over last season's standings is not complete, D-08), else the
 * one before. Null when the league's season is not established in the export.
 */
export function completedThrough(leagueId: number, rules: Map<number, LeagueRules> = allLeagueRules()): { season: number | null; current: boolean } {
  const league = rules.get(leagueId);
  const season = league?.contract.season.value ?? null;
  if (!league || season === null) return { season: null, current: false };
  const clubs = leagueClubs(leagueId);
  const games = gamesThisSeason(leagueId, league, clubs);
  const played = seasonPlayedOf(leagueRecord(leagueId, clubs, season, true), games === null ? league.gamesPerTeam : derivedFrom(games, 'games', 'The schedule.')).value;
  const schedule = scheduledGames(leagueId, clubs.size);
  const allPlayed = played !== null && played >= 1 && (schedule === null || schedule.unplayed === 0);
  return allPlayed && hasSeasonLines(leagueId, season) ? { season, current: true } : { season: season - 1, current: false };
}

/** The leagues that are markets of their own (no parent league) and have clubs: the leagues a save's fits are kept for. */
export function topLeagues(): number[] {
  return [...marketLevels().keys()].filter((id) => leagueClubs(id).size > 0).sort((a, b) => a - b);
}
