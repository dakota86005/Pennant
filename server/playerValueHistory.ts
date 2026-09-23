/**
 * Player Value's reader of the league's playing history (phases 3a and 3b; PLAYER_VALUE.md Parts 2.3 and 7).
 *
 * Opens `league.db` read-only, every column checked before it is read (D-007): the league's clubs
 * and standings, where this season stands, the major-league lines of the players asked about (or of
 * every player, for a fit), dates of birth and the season's calendar. WAR is read only at the
 * major-league level (`level_id = 1`) and the overall split: minor-league and amateur WAR never stand in
 * for a major-league record (owner, Q-9). A season's WAR is summed over the clubs he played for (R-4).
 * Phase 3b adds, for players not yet in the majors, where and how much they played in the minors (usage
 * only, `MINOR_USAGE_COLUMNS`), the save's minor levels, listed positions and batting hands, and how
 * often each hand faces left-handers (plate appearances only).
 *
 * It reads no rating, no `players_value`, no philosophy and no tier, and writes nothing. Dates are
 * compared only through `parseGameDate`.
 */

import { db, tableColumns, tableExists } from './db.js';
import { daysBetween, parseGameDate } from './dataFreshness.js';
import type { SeasonRecord } from './playerValueFinances.js';
import type { ProductionLine } from './playerValueProduction.js';
import type { FitPlayer, FitSeason } from './playerValueProductionFit.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
 * This season's calendar in days, measured from the save: days since the league's start date over
 * games each club has played. Unknown (null) where the export does not state the dates or no game
 * has been played.
 */
export function seasonCalendar(leagueId: number, now: SeasonRecord | null, gamesPerTeam: number | null): { daysLeft: number | null; seasonDays: number | null } {
  const none = { daysLeft: null, seasonDays: null };
  if (!tableExists('leagues') || now === null || gamesPerTeam === null || now.clubs.size === 0) return none;
  const present = new Set(tableColumns('leagues'));
  if (!present.has('start_date') || !present.has('current_date')) return none;
  const row = db.prepare(`SELECT start_date AS s, "current_date" AS d FROM leagues WHERE league_id = ?`).get(leagueId) as { s: unknown; d: unknown } | undefined;
  const start = parseGameDate(row?.s ?? null);
  const today = parseGameDate(row?.d ?? null);
  const played = now.games / now.clubs.size;
  if (!start || !today || played <= 0) return none;
  const elapsed = daysBetween(start, today);
  if (elapsed <= 0) return none;
  const perGame = elapsed / played;
  return { daysLeft: Math.max(0, perGame * (gamesPerTeam - played)), seasonDays: perGame * gamesPerTeam };
}

// ── major-league lines ────────────────────────────────────────────────────────

const BATTING = ['player_id', 'year', 'level_id', 'split_id', 'league_id', 'pa', 'war'] as const;
const PITCHING = ['player_id', 'year', 'level_id', 'split_id', 'league_id', 'bf', 'war', 'g', 'gs'] as const;

export interface MajorLeagueLines {
  byPlayer: Map<number, { batting: ProductionLine[]; pitching: ProductionLine[]; lastLeague: number | null; lastSeason: number | null }>;
  /** Why the lines cannot be read at all; null when they can. */
  unavailable: string | null;
}

/**
 * Major-league lines (level 1, overall split), one per player and season, summed over clubs, for
 * the seasons asked about. `leagueId` restricts to one league (a fit); null reads every league at the
 * major-league level (a player's projection). A WAR the export leaves blank stays null.
 */
export function majorLeagueLines(ids: number[] | null, fromSeason: number, throughSeason: number, leagueId: number | null): MajorLeagueLines {
  const byPlayer: MajorLeagueLines['byPlayer'] = new Map();
  const tables = [['players_career_batting_stats', BATTING], ['players_career_pitching_stats', PITCHING]] as const;
  for (const [table, wanted] of tables) {
    if (!tableExists(table)) return { byPlayer, unavailable: `${table} is not in the export, so major-league results cannot be read.` };
    const present = new Set(tableColumns(table));
    // WAR may be absent (then every figure is unknown); the rest are needed to read a line at all
    const lacking = wanted.filter((c) => c !== 'war' && c !== 'g' && c !== 'gs' && !present.has(c));
    if (lacking.length > 0) return { byPlayer, unavailable: `${table} has no ${lacking.join(', ')} column, so major-league results cannot be read.` };
  }
  const read = (table: string, side: 'batting' | 'pitching', opp: string, extra: string[]) => {
    const present = new Set(tableColumns(table));
    const war = present.has('war') ? 'SUM(war)' : 'NULL';
    // A blank WAR in any club's row leaves the season's WAR unknown, never a partial sum
    const blankWar = present.has('war') ? 'SUM(CASE WHEN war IS NULL THEN 1 ELSE 0 END)' : '1';
    const cols = extra.filter((c) => present.has(c)).map((c) => `, SUM("${c}") AS "${c}"`).join('');
    const where = [`level_id = 1`, `split_id = 1`, `year BETWEEN ? AND ?`, ...(leagueId !== null ? ['league_id = ?'] : [])];
    const base = `SELECT player_id, year, MAX(league_id) AS league_id, SUM(${opp}) AS opp, ${war} AS war, ${blankWar} AS blank${cols}
                  FROM ${table} WHERE ${where.join(' AND ')}`;
    const params = [fromSeason, throughSeason, ...(leagueId !== null ? [leagueId] : [])];
    const take = (rows: Array<Record<string, unknown>>) => {
      for (const r of rows) {
        const id = numberOrNull(r.player_id);
        const season = numberOrNull(r.year);
        const opportunities = numberOrNull(r.opp);
        if (id === null || season === null || opportunities === null) continue;
        const entry = byPlayer.get(id) ?? { batting: [], pitching: [], lastLeague: null, lastSeason: null };
        const line: ProductionLine = {
          season, opportunities, war: numberOrNull(r.blank) === 0 ? numberOrNull(r.war) : null,
          ...(side === 'pitching' && present.has('g') ? { games: numberOrNull(r.g) ?? 0 } : {}),
          ...(side === 'pitching' && present.has('gs') ? { starts: numberOrNull(r.gs) ?? 0 } : {}),
        };
        entry[side].push(line);
        const lg = numberOrNull(r.league_id);
        if (lg !== null && opportunities > 0 && (entry.lastSeason === null || season >= entry.lastSeason)) {
          entry.lastLeague = lg;
          entry.lastSeason = season;
        }
        byPlayer.set(id, entry);
      }
    };
    if (ids === null) take(db.prepare(`${base} GROUP BY player_id, year`).all(...params) as Array<Record<string, unknown>>);
    else {
      for (let at = 0; at < ids.length; at += 500) {
        const chunk = ids.slice(at, at + 500);
        take(db.prepare(`${base} AND player_id IN (${chunk.map(() => '?').join(',')}) GROUP BY player_id, year`).all(...params, ...chunk) as Array<Record<string, unknown>>);
      }
    }
  };
  read('players_career_batting_stats', 'batting', 'pa', []);
  read('players_career_pitching_stats', 'pitching', 'bf', ['g', 'gs']);
  return { byPlayer, unavailable: null };
}

// ── the minor-league levels a player played at: usage only, never WAR (phase 3b, Q-9) ─────────

/**
 * The columns the minor-league reader may select. No WAR, ever: minor-league and amateur WAR never
 * stand in for a major-league record (owner, Q-9). What a player not yet in the majors is expected to
 * play there comes from how often players at his LEVEL and AGE reached the majors on this save, so the
 * reader needs where he played and how much, and nothing about how well.
 */
const MINOR_USAGE_COLUMNS = ['player_id', 'year', 'level_id', 'split_id', 'pa', 'bf', 'g', 'gs'] as const;

export interface LevelSeason {
  season: number;
  level: number;
  /** Plate appearances (batting) and batters faced (pitching) at that level in that season. */
  pa: number;
  bf: number;
  /** Pitching games and starts at that level (a pitcher's role without a major-league line). */
  games: number;
  starts: number;
}

/**
 * Every line at the levels asked about (the minor levels of the save's affiliated clubs), one per
 * player, season and level, summed over clubs, for the seasons asked about: usage only (MINOR_USAGE_COLUMNS).
 */
export function minorLeagueUsage(ids: number[] | null, levels: number[], fromSeason: number, throughSeason: number): Map<number, LevelSeason[]> {
  const out = new Map<number, LevelSeason[]>();
  if (levels.length === 0) return out;
  const merged = new Map<string, LevelSeason & { player: number }>();
  for (const [table, opp] of [['players_career_batting_stats', 'pa'], ['players_career_pitching_stats', 'bf']] as const) {
    if (!tableExists(table)) continue;
    const present = new Set(tableColumns(table));
    const usable = MINOR_USAGE_COLUMNS.filter((c) => present.has(c));
    if (!['player_id', 'year', 'level_id', 'split_id', opp].every((c) => usable.includes(c as typeof usable[number]))) continue;
    const games = opp === 'bf' && usable.includes('g') ? 'SUM(g)' : '0';
    const starts = opp === 'bf' && usable.includes('gs') ? 'SUM(gs)' : '0';
    const base = `SELECT player_id, year, level_id, SUM(${opp}) AS opp, ${games} AS games, ${starts} AS starts
                  FROM ${table} WHERE split_id = 1 AND level_id IN (${levels.map(() => '?').join(',')}) AND year BETWEEN ? AND ?`;
    const take = (rows: Array<Record<string, unknown>>) => {
      for (const r of rows) {
        const player = numberOrNull(r.player_id);
        const season = numberOrNull(r.year);
        const level = numberOrNull(r.level_id);
        const n = numberOrNull(r.opp) ?? 0;
        if (player === null || season === null || level === null) continue;
        const key = `${player}:${season}:${level}`;
        const had = merged.get(key) ?? { player, season, level, pa: 0, bf: 0, games: 0, starts: 0 };
        if (opp === 'pa') had.pa += n;
        else { had.bf += n; had.games += numberOrNull(r.games) ?? 0; had.starts += numberOrNull(r.starts) ?? 0; }
        merged.set(key, had);
      }
    };
    const params = [...levels, fromSeason, throughSeason];
    if (ids === null) take(db.prepare(`${base} GROUP BY player_id, year, level_id`).all(...params) as Array<Record<string, unknown>>);
    else {
      for (let at = 0; at < ids.length; at += 500) {
        const chunk = ids.slice(at, at + 500);
        take(db.prepare(`${base} AND player_id IN (${chunk.map(() => '?').join(',')}) GROUP BY player_id, year, level_id`).all(...params, ...chunk) as Array<Record<string, unknown>>);
      }
    }
  }
  for (const x of merged.values()) {
    const list = out.get(x.player) ?? [];
    list.push({ season: x.season, level: x.level, pa: x.pa, bf: x.bf, games: x.games, starts: x.starts });
    out.set(x.player, list);
  }
  return out;
}

/**
 * The levels below the majors that the market league's own affiliates play at: the levels of clubs in
 * leagues whose parent is the market league. Where the export does not name parents, every club level
 * other than the major league's.
 */
export function affiliatedLevels(marketLeagueId: number): number[] {
  if (!tableExists('teams')) return [];
  const teams = new Set(tableColumns('teams'));
  if (!teams.has('level') || !teams.has('league_id')) return [];
  const byParent = tableExists('leagues') && tableColumns('leagues').includes('parent_league_id');
  const rows = byParent
    ? db.prepare(`SELECT DISTINCT t.level AS level FROM teams t JOIN leagues l ON l.league_id = t.league_id WHERE l.parent_league_id = ?`).all(marketLeagueId)
    : db.prepare(`SELECT DISTINCT level FROM teams WHERE league_id <> ?`).all(marketLeagueId);
  return (rows as Array<{ level: unknown }>).map((r) => numberOrNull(r.level)).filter((l): l is number => l !== null && l > 1).sort((a, b) => a - b);
}

/** Objective facts a ratings projection needs about each player: his listed position and the hand he bats with. */
export function listedFacts(ids: number[] | null): Map<number, { position: number | null; bats: 'L' | 'R' | 'S' | null }> {
  const out = new Map<number, { position: number | null; bats: 'L' | 'R' | 'S' | null }>();
  if (!tableExists('players')) return out;
  const present = new Set(tableColumns('players'));
  if (!present.has('player_id')) return out;
  const cols = ['position', 'bats'].filter((c) => present.has(c));
  const select = `SELECT player_id${cols.map((c) => `, "${c}"`).join('')} FROM players`;
  // OOTP's code for the batting hand: 1 right, 2 left, 3 both
  const hand = (v: unknown): 'L' | 'R' | 'S' | null => (v === 1 ? 'R' : v === 2 ? 'L' : v === 3 ? 'S' : null);
  const take = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const id = numberOrNull(r.player_id);
      if (id !== null) out.set(id, { position: numberOrNull(r.position ?? null), bats: hand(r.bats ?? null) });
    }
  };
  if (ids === null) take(db.prepare(select).all() as Array<Record<string, unknown>>);
  else {
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500);
      take(db.prepare(`${select} WHERE player_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<Record<string, unknown>>);
    }
  }
  return out;
}

/**
 * How often each batting hand faced left-handed pitching in the league's major-league lines over the
 * seasons asked about: plate appearances against left- and right-handers (batting splits 2 and 3),
 * summed by the hand the batter is listed with. Plate appearances only; no result is read.
 */
export function platoonExposure(leagueId: number, fromSeason: number, throughSeason: number): Record<'L' | 'R' | 'S', { vsLeft: number; vsRight: number }> | null {
  const table = 'players_career_batting_stats';
  if (!tableExists(table) || !tableExists('players')) return null;
  const present = new Set(tableColumns(table));
  if (!['player_id', 'year', 'level_id', 'split_id', 'league_id', 'pa'].every((c) => present.has(c)) || !tableColumns('players').includes('bats')) return null;
  const rows = db.prepare(
    `SELECT p.bats AS bats, s.split_id AS split, SUM(s.pa) AS pa FROM ${table} s JOIN players p ON p.player_id = s.player_id
     WHERE s.level_id = 1 AND s.split_id IN (2, 3) AND s.league_id = ? AND s.year BETWEEN ? AND ? GROUP BY p.bats, s.split_id`
  ).all(leagueId, fromSeason, throughSeason) as Array<{ bats: unknown; split: unknown; pa: unknown }>;
  const out = { L: { vsLeft: 0, vsRight: 0 }, R: { vsLeft: 0, vsRight: 0 }, S: { vsLeft: 0, vsRight: 0 } };
  for (const r of rows) {
    const hand = r.bats === 1 ? 'R' : r.bats === 2 ? 'L' : r.bats === 3 ? 'S' : null;
    const pa = numberOrNull(r.pa) ?? 0;
    if (!hand) continue;
    if (r.split === 2) out[hand].vsLeft += pa;
    else if (r.split === 3) out[hand].vsRight += pa;
  }
  return out;
}

// ── age ─────────────────────────────────────────────────────────────────────

export interface AgeFacts {
  /** Date of birth, parsed through `parseGameDate`. */
  birth: FitPlayer['birth'];
  /** `players.age` as exported (today's age), used only where no date of birth is exported. */
  age: number | null;
}

export function ageFacts(ids: number[] | null): Map<number, AgeFacts> {
  const out = new Map<number, AgeFacts>();
  if (!tableExists('players')) return out;
  const present = new Set(tableColumns('players'));
  if (!present.has('player_id')) return out;
  const cols = ['date_of_birth', 'age'].filter((c) => present.has(c));
  const select = `SELECT player_id${cols.map((c) => `, "${c}"`).join('')} FROM players`;
  const take = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const id = numberOrNull(r.player_id);
      if (id === null) continue;
      const iso = parseGameDate(r.date_of_birth ?? null);
      const birth = iso ? { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) } : null;
      out.set(id, { birth, age: numberOrNull(r.age) });
    }
  };
  if (ids === null) take(db.prepare(select).all() as Array<Record<string, unknown>>);
  else {
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500);
      take(db.prepare(`${select} WHERE player_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<Record<string, unknown>>);
    }
  }
  return out;
}

// ── the league's seasons ─────────────────────────────────────────────────────

/** The seasons with major-league results in a league, up to `through`, with the share of a schedule each played. */
export function leagueSeasons(leagueId: number, through: number, gamesPerTeam: number | null): FitSeason[] {
  if (!tableExists('players_career_batting_stats')) return [];
  const present = new Set(tableColumns('players_career_batting_stats'));
  if (!['year', 'level_id', 'split_id', 'league_id'].every((c) => present.has(c))) return [];
  const years = (db.prepare(
    `SELECT DISTINCT year FROM players_career_batting_stats WHERE level_id = 1 AND split_id = 1 AND league_id = ? AND year <= ? ORDER BY year`
  ).all(leagueId, through) as Array<{ year: unknown }>).map((r) => numberOrNull(r.year)).filter((y): y is number => y !== null);
  // Games per club in each season, from the standings history
  const shares = new Map<number, number>();
  if (gamesPerTeam !== null && gamesPerTeam > 0 && tableExists('team_history_record')) {
    const cols = new Set(tableColumns('team_history_record'));
    if (cols.has('year') && cols.has('team_id') && (cols.has('g') || (cols.has('w') && cols.has('l')))) {
      const games = cols.has('g') ? 'g' : 'w + l';
      const byLeague = cols.has('league_id') ? ' WHERE league_id = ?' : '';
      const rows = db.prepare(`SELECT year, AVG(${games}) AS g FROM team_history_record${byLeague} GROUP BY year`)
        .all(...(byLeague ? [leagueId] : [])) as Array<{ year: unknown; g: unknown }>;
      for (const r of rows) {
        const y = numberOrNull(r.year);
        const g = numberOrNull(r.g);
        if (y !== null && g !== null) shares.set(y, g / gamesPerTeam);
      }
    }
  }
  return years.map((season) => ({ season, scheduleShare: shares.get(season) ?? null }));
}
