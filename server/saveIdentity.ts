/**
 * The save's identity and its league's seasons: a neutral module (D-053, per-save calibration).
 *
 * Every subsystem that keeps a fit per save needs the same three answers, and none of them belongs to one
 * subsystem: which save this is (its id, D-079: the served save's folder, so a renamed save or league keeps its fits
 * and a new save under a reused name never inherits another's), which seasons the league has played and how long
 * each was, and the last season the league has completed. They were first written for Player Value and moved
 * here unchanged (the fingerprint is byte-identical: `tests/saveIdentity.test.ts`), so MLB Operations and the other
 * subsystems reach them without importing Player Value's files (`tests/saveCalibrationBoundary.test.ts`).
 *
 * Opens `league.db` read-only, every column checked before it is read (D-007). Reads no rating, no
 * `players_value` and no philosophy. Its only write is the one-time carry-over of rows filed under the identity before
 * D-079 (`carryLegacyIdentity`). Dates are compared only through `parseGameDate`.
 */

import { db, tableColumns, tableExists } from './db.js';
import { parseGameDate } from './dataFreshness.js';
import { isMainThread } from 'node:worker_threads';
import { loadConfig } from './config.js';
import { historyDb } from './history.js';
import { servedSaveKey, servedSource } from './servedSave.js';
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

/**
 * The tables in `history.db` that keep a save's fits and market records under its identity (in their `save_name`
 * column, with `league_id` beside it), as each store registers its own when it loads, so the identity's one-time
 * carry-over (below) reaches every one without this module naming another subsystem's tables.
 */
const identityTables = new Set<string>();

/** A store keeps rows under the save's identity in `table` (`save_name`, `league_id`): they are carried over to its id once. */
export function registerIdentityTable(table: string): void {
  identityTables.add(table);
}

/* Which tables' rows were carried over to a save's id (D-079), so each is done once per save, league and table. */
historyDb.exec(`
  CREATE TABLE IF NOT EXISTS save_identity_carried (
    identity TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    table_name TEXT NOT NULL,
    legacy TEXT NOT NULL,
    rows INTEGER NOT NULL,
    carried_at TEXT NOT NULL,
    PRIMARY KEY (identity, league_id, table_name)
  );
`);

/** The identity this build's predecessors filed a save's fits under: its configured name and the league's fingerprint. */
export function legacySaveIdentity(leagueId: number, saveName: string | null): string {
  return `${saveName ?? 'unknown'}|${leagueFingerprint(leagueId)}`;
}

/** The tables already carried (or found carried) for a league in this process. */
const carriedHere = new Map<number, Set<string>>();

/**
 * Carries a save's fits and market records from the identity they were filed under before D-079 (the configured name and
 * the league's fingerprint) to its id, once per save, league and table: rows are moved, never copied or deleted, and a
 * row its id already has stays where it was. Only while the configuration names the served save (its configured name is
 * then the name the rows were filed under); otherwise it is tried again later. Returns the rows moved.
 */
export function carryLegacyIdentity(leagueId: number, identity: string): number {
  const done = carriedHere.get(leagueId) ?? new Set<string>();
  carriedHere.set(leagueId, done);
  const waiting = [...identityTables].filter((t) => !done.has(t));
  if (waiting.length === 0) return 0;
  const source = servedSource();
  if (!source.csvDir || !source.configured || !tableExists('players')) return 0;
  const present = new Set((historyDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name));
  let legacy: string | null = null;
  const carry = historyDb.transaction((): number => {
    let moved = 0;
    for (const table of waiting) {
      if (historyDb.prepare(`SELECT 1 FROM save_identity_carried WHERE identity = ? AND league_id = ? AND table_name = ?`).get(identity, leagueId, table)) continue;
      legacy ??= legacySaveIdentity(leagueId, loadConfig().saveName);
      const rows = present.has(table)
        ? historyDb.prepare(`UPDATE OR IGNORE ${table} SET save_name = ? WHERE save_name = ? AND league_id = ?`).run(identity, legacy, leagueId).changes
        : 0;
      historyDb.prepare(`INSERT OR IGNORE INTO save_identity_carried (identity, league_id, table_name, legacy, rows, carried_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(identity, leagueId, table, legacy, rows, new Date().toISOString());
      moved += rows;
    }
    return moved;
  });
  const moved = carry.immediate();
  for (const t of waiting) done.add(t);
  if (moved > 0 && isMainThread) console.log(`[calibration] carried ${moved} stored fit and market rows of league ${leagueId} from "${legacy}" to the save's id`);
  return moved;
}

/**
 * A different league in the same save folder (a save deleted and made again under its name, a league regenerated) must
 * never inherit the fits and market records of the one before (D-01, F1). The save's id can't tell them apart, so each
 * league in a save keeps the players it was first seen with: the first players (by id, with their birth dates) of its
 * first season with major-league lines, as the fingerprint reads them. The test only ever refuses, on clear evidence
 * (like D-064's): at least `minPlayers` on both sides and fewer than `sameShare` of them in common starts a new
 * generation of the identity; too few to tell (day one) keeps it. A renamed league or save, or an old player leaving the
 * export, keeps it. A policy line, not a fit.
 */
export const LINEAGE_POLICY = { minPlayers: 20, sameShare: 0.5 } as const;

historyDb.exec(`
  CREATE TABLE IF NOT EXISTS save_identity_leagues (
    save_key TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    first_season INTEGER,
    players TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (save_key, league_id, generation)
  );
`);

/** The players a league's identity is anchored on: its first season with lines and that season's first players. */
export function leagueAnchor(leagueId: number): { firstSeason: number | null; players: string[] } {
  const first = firstLeagueSeason(leagueId);
  if (first === null || !tableExists('players') || !new Set(tableColumns('players')).has('date_of_birth')) return { firstSeason: first, players: [] };
  const level = marketLevels().get(leagueId) ?? 1;
  const rows = db.prepare(
    `SELECT p.player_id AS id, p.date_of_birth AS dob FROM players p WHERE p.player_id IN
       (SELECT player_id FROM players_career_batting_stats WHERE level_id = ? AND league_id = ? AND year = ?)
     ORDER BY p.player_id LIMIT 64`
  ).all(level, leagueId, first) as Array<{ id: unknown; dob: unknown }>;
  return { firstSeason: first, players: rows.map((r) => `${String(r.id)}@${parseGameDate(r.dob ?? null) ?? ''}`) };
}

/** Whether two anchors show different leagues: only on clear evidence, never for too few players to tell. */
export function differentLeague(stored: readonly string[], now: readonly string[]): boolean {
  if (stored.length < LINEAGE_POLICY.minPlayers || now.length < LINEAGE_POLICY.minPlayers) return false;
  const have = new Set(stored);
  const shared = now.filter((p) => have.has(p)).length;
  return shared / Math.min(stored.length, now.length) < LINEAGE_POLICY.sameShare;
}

/** The identity of a save's league: its save key, with the generation after the first (`save:<id>#2`). */
function resolveIdentity(leagueId: number): string {
  const base = servedSaveKey();
  const now = leagueAnchor(leagueId);
  const resolve = historyDb.transaction((): string => {
    const row = historyDb.prepare(`SELECT generation, players FROM save_identity_leagues WHERE save_key = ? AND league_id = ? ORDER BY generation DESC LIMIT 1`)
      .get(base, leagueId) as { generation: number; players: string } | undefined;
    const at = new Date().toISOString();
    const insert = historyDb.prepare(`INSERT OR IGNORE INTO save_identity_leagues (save_key, league_id, generation, first_season, players, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    if (!row) {
      if (tableExists('players')) insert.run(base, leagueId, 1, now.firstSeason, JSON.stringify(now.players), at);
      return base;
    }
    let stored: string[] = [];
    try {
      stored = JSON.parse(row.players) as string[];
    } catch {
      stored = [];
    }
    let generation = row.generation;
    if (differentLeague(stored, now.players)) {
      generation += 1;
      insert.run(base, leagueId, generation, now.firstSeason, JSON.stringify(now.players), at);
      if (isMainThread) console.log(`[calibration] league ${leagueId} in this save has other players than before: its fits start afresh (generation ${generation})`);
    } else if (stored.length === 0 && now.players.length > 0) {
      // Seen first before it had lines (day one): anchored once it has them
      historyDb.prepare(`UPDATE save_identity_leagues SET first_season = ?, players = ? WHERE save_key = ? AND league_id = ? AND generation = ?`)
        .run(now.firstSeason, JSON.stringify(now.players), base, leagueId, generation);
    }
    return generation === 1 ? base : `${base}#${generation}`;
  });
  return resolve.immediate();
}

const identities = new Map<number, string>();

/**
 * The save's identity for a league (D-053, D-079): the served save's id (`servedSaveKey`: its folder, as the save list
 * and rating history identify it), and a generation when another league has since been made in that folder
 * (`LINEAGE_POLICY`), cached until an import. The league id is kept beside it in every store. It no longer moves when
 * the save is renamed, the league is renamed, an old player leaves the export or the first season's lines appear; what
 * was filed under the old identity is carried over once, table by table as each store is loaded.
 */
export function saveIdentity(leagueId: number): string {
  let id = identities.get(leagueId);
  if (id === undefined) {
    id = resolveIdentity(leagueId);
    identities.set(leagueId, id);
  }
  if ((carriedHere.get(leagueId)?.size ?? 0) < identityTables.size) {
    try {
      carryLegacyIdentity(leagueId, id);
    } catch (err) {
      console.warn('[calibration] the stored fits were not carried to the save\'s id this time:', (err as Error).message);
    }
  }
  return id;
}

/** Forget the cached identities: the export changed (an import), or a test rebuilt the league. */
export function clearSaveIdentityCache(): void {
  identities.clear();
  carriedHere.clear();
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
