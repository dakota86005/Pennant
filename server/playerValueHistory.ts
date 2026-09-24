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
import type { InSeasonFacts, ProductionLine } from './playerValueProduction.js';
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

// ── major-league lines ────────────────────────────────────────────────────────

const BATTING = ['player_id', 'year', 'level_id', 'split_id', 'league_id', 'pa', 'war'] as const;
const PITCHING = ['player_id', 'year', 'level_id', 'split_id', 'league_id', 'bf', 'war', 'g', 'gs'] as const;

export interface MajorLeagueLines {
  byPlayer: Map<number, { batting: ProductionLine[]; pitching: ProductionLine[]; lastLeague: number | null; lastSeason: number | null }>;
  /** Why the lines cannot be read at all (neither side); null when at least one side can. */
  unavailable: string | null;
  /** Why one side's lines cannot be read (a missing table or column): one side fails alone (D-13). */
  sides: { batting: string | null; pitching: string | null };
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
 * Major-league lines (a market league's top level, overall split), one per player and season, summed over
 * clubs, for the seasons asked about. `leagueId` restricts to one league (a fit); null reads every league at
 * the major-league level, and an independent league at its own top level (a player's projection). A WAR the
 * export leaves blank stays null. Each side is read on its own: a side whose table or column is missing is
 * unavailable with its reason and the other side is still read (D-13).
 */
export function majorLeagueLines(ids: number[] | null, fromSeason: number, throughSeason: number, leagueId: number | null): MajorLeagueLines {
  const byPlayer: MajorLeagueLines['byPlayer'] = new Map();
  const sides: MajorLeagueLines['sides'] = { batting: null, pitching: null };
  const tables = [['players_career_batting_stats', BATTING, 'batting'], ['players_career_pitching_stats', PITCHING, 'pitching']] as const;
  for (const [table, wanted, side] of tables) {
    if (!tableExists(table)) { sides[side] = `${table} is not in the export, so major-league ${side} results cannot be read.`; continue; }
    const present = new Set(tableColumns(table));
    // WAR may be absent (then every figure is unknown); the rest are needed to read a line at all
    const lacking = wanted.filter((c) => c !== 'war' && c !== 'g' && c !== 'gs' && !present.has(c));
    if (lacking.length > 0) sides[side] = `${table} has no ${lacking.join(', ')} column, so major-league ${side} results cannot be read.`;
  }
  if (sides.batting && sides.pitching) return { byPlayer, unavailable: `${sides.batting} ${sides.pitching}`, sides };
  // The majors: level 1, and an independent market league's own top level
  const levels = marketLevels();
  const own = leagueId !== null ? levels.get(leagueId) ?? 1 : null;
  const independent = [...levels.entries()].filter(([, level]) => level !== 1);
  const levelWhere = own !== null
    ? { sql: 'level_id = ?', params: [own] }
    : independent.length === 0
      ? { sql: 'level_id = 1', params: [] as number[] }
      : { sql: `(level_id = 1 OR ${independent.map(() => '(league_id = ? AND level_id = ?)').join(' OR ')})`, params: independent.flatMap(([id, level]) => [id, level]) };
  const read = (table: string, side: 'batting' | 'pitching', opp: string, extra: string[]) => {
    if (sides[side]) return;
    const present = new Set(tableColumns(table));
    const war = present.has('war') ? 'SUM(war)' : 'NULL';
    // A blank WAR in any club's row leaves the season's WAR unknown, never a partial sum
    const blankWar = present.has('war') ? 'SUM(CASE WHEN war IS NULL THEN 1 ELSE 0 END)' : '1';
    const cols = extra.filter((c) => present.has(c)).map((c) => `, SUM("${c}") AS "${c}"`).join('');
    const where = [levelWhere.sql, `split_id = 1`, `year BETWEEN ? AND ?`, ...(leagueId !== null ? ['league_id = ?'] : [])];
    const base = `SELECT player_id, year, MAX(league_id) AS league_id, SUM(${opp}) AS opp, ${war} AS war, ${blankWar} AS blank${cols}
                  FROM ${table} WHERE ${where.join(' AND ')}`;
    const params = [...levelWhere.params, fromSeason, throughSeason, ...(leagueId !== null ? [leagueId] : [])];
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
  return { byPlayer, unavailable: null, sides };
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
 * `excludeLeagues` leaves out the lines of those leagues (another market league's farm, an independent league:
 * hardening F4, D-07); a league the export no longer lists (a defunct affiliate) is not known to be another's
 * and is kept. Null or absent reads every league at those levels.
 */
export function minorLeagueUsage(ids: number[] | null, levels: number[], fromSeason: number, throughSeason: number, excludeLeagues: number[] | null = null): Map<number, LevelSeason[]> {
  const out = new Map<number, LevelSeason[]>();
  if (levels.length === 0) return out;
  const excluding = excludeLeagues !== null && excludeLeagues.length > 0 ? excludeLeagues : null;
  const merged = new Map<string, LevelSeason & { player: number }>();
  for (const [table, opp] of [['players_career_batting_stats', 'pa'], ['players_career_pitching_stats', 'bf']] as const) {
    if (!tableExists(table)) continue;
    const present = new Set(tableColumns(table));
    const usable = MINOR_USAGE_COLUMNS.filter((c) => present.has(c));
    if (!['player_id', 'year', 'level_id', 'split_id', opp].every((c) => usable.includes(c as typeof usable[number]))) continue;
    // Leaving leagues out needs the table's league column; without it the lines cannot be placed, so none are read
    if (excluding !== null && !present.has('league_id')) continue;
    const games = opp === 'bf' && usable.includes('g') ? 'SUM(g)' : '0';
    const starts = opp === 'bf' && usable.includes('gs') ? 'SUM(gs)' : '0';
    const base = `SELECT player_id, year, level_id, SUM(${opp}) AS opp, ${games} AS games, ${starts} AS starts
                  FROM ${table} WHERE split_id = 1 AND level_id IN (${levels.map(() => '?').join(',')}) AND year BETWEEN ? AND ?${excluding !== null ? ` AND league_id NOT IN (${excluding.map(() => '?').join(',')})` : ''}`;
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
    const params = [...levels, fromSeason, throughSeason, ...(excluding ?? [])];
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

/**
 * Whether the export names each league's parent (`leagues.parent_league_id`): only then can a minor league be
 * told apart as one market league's farm or another's (hardening F4, D-07); otherwise the levels alone place a
 * minor leaguer, as `affiliatedLevels` does.
 */
export function leagueParentsNamed(): boolean {
  if (!tableExists('leagues')) return false;
  const columns = tableColumns('leagues');
  return columns.includes('parent_league_id') && columns.includes('league_id');
}

/** Objective facts a ratings projection needs about each player: his listed position and the hand he bats with. */
export function listedFacts(ids: number[] | null): Map<number, { position: number | null; role: number | null; bats: 'L' | 'R' | 'S' | null }> {
  const out = new Map<number, { position: number | null; role: number | null; bats: 'L' | 'R' | 'S' | null }>();
  if (!tableExists('players')) return out;
  const present = new Set(tableColumns('players'));
  if (!present.has('player_id')) return out;
  const cols = ['position', 'role', 'bats'].filter((c) => present.has(c));
  const select = `SELECT player_id${cols.map((c) => `, "${c}"`).join('')} FROM players`;
  // OOTP's code for the batting hand: 1 right, 2 left, 3 both
  const hand = (v: unknown): 'L' | 'R' | 'S' | null => (v === 1 ? 'R' : v === 2 ? 'L' : v === 3 ? 'S' : null);
  const take = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const id = numberOrNull(r.player_id);
      if (id !== null) out.set(id, { position: numberOrNull(r.position ?? null), role: numberOrNull(r.role ?? null), bats: hand(r.bats ?? null) });
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
export function leagueSeasons(leagueId: number, through: number, _gamesPerTeam?: number | null): FitSeason[] {
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

// ── the calendar, this season's own games, and the save's facts (hardening, 2026-09-23) ──────────

export interface SeasonCalendar {
  /** Days from today to the last scheduled regular-season game (0 once it is played). */
  daysLeft: number | null;
  /** Days from the first scheduled game to the last. */
  seasonDays: number | null;
  /** Days until the first scheduled game (0 once the season has begun). */
  daysToOpening: number | null;
  /** Days from the last scheduled game to the next season's first, the year's calendar measured from this schedule. */
  offseasonDays: number | null;
}

/**
 * This season's calendar in days, measured from the save's own schedule (`games`: its first and last
 * regular-season game) and today; failing the schedule, from the league's start date and the games played so
 * far. Every edge is honest: before Opening Day the days until it are counted, after the last game none are
 * left and the off-season follows (A-09). Unknown (null) where the export does not state the dates.
 */
export function seasonCalendar(leagueId: number, now: SeasonRecord | null, gamesPerTeam: number | null): SeasonCalendar {
  const none: SeasonCalendar = { daysLeft: null, seasonDays: null, daysToOpening: null, offseasonDays: null };
  if (!tableExists('leagues')) return none;
  const present = new Set(tableColumns('leagues'));
  if (!present.has('current_date')) return none;
  const row = db.prepare(`SELECT ${present.has('start_date') ? 'start_date' : 'NULL'} AS s, "current_date" AS d FROM leagues WHERE league_id = ?`).get(leagueId) as { s: unknown; d: unknown } | undefined;
  const today = parseGameDate(row?.d ?? null);
  if (!today) return none;
  // The schedule itself: the first and last regular-season games
  if (tableExists('games')) {
    const g = new Set(tableColumns('games'));
    if (g.has('date') && g.has('league_id')) {
      const type = g.has('game_type') ? ' AND COALESCE(game_type, 0) = 0' : '';
      const dates = (db.prepare(`SELECT date FROM games WHERE league_id = ?${type}`).all(leagueId) as Array<{ date: unknown }>)
        .map((r) => parseGameDate(r.date ?? null)).filter((d): d is string => d !== null).sort();
      if (dates.length > 0) {
        const first = dates[0];
        const last = dates[dates.length - 1];
        const seasonDays = daysBetween(first, last) + 1;
        const toOpening = Math.max(0, daysBetween(today, first));
        const from = toOpening > 0 ? first : today;
        return {
          daysLeft: Math.max(0, daysBetween(from, last) + (toOpening > 0 ? 1 : 0)),
          seasonDays,
          daysToOpening: toOpening,
          offseasonDays: Math.max(0, 365 - seasonDays),
        };
      }
    }
  }
  // Failing the schedule: days since the league's start date over games each club has played
  const start = parseGameDate(row?.s ?? null);
  if (!start || now === null || gamesPerTeam === null || now.clubs.size === 0) return none;
  const played = now.games / now.clubs.size;
  if (played <= 0) return none;
  const elapsed = daysBetween(start, today);
  if (elapsed <= 0) return none;
  const perGame = elapsed / played;
  return { daysLeft: Math.max(0, perGame * (gamesPerTeam - played)), seasonDays: perGame * gamesPerTeam, daysToOpening: 0, offseasonDays: null };
}

/**
 * How much playing time holds within this season, measured on this season's own games (B-07): the games
 * played so far are split in two halves by date; of the players who played in the first half, their
 * opportunities per club game in the second half against the first, per kind (a pitcher by his starts in
 * the first half). Null where the game logs are not exported or either half is under the policy's games.
 */
export function inSeasonContinuation(leagueId: number, clubs: number, gamesPerTeam: number | null, minimumGames: number, starterShare: number): InSeasonFacts | null {
  if (clubs <= 0 || gamesPerTeam === null || gamesPerTeam <= 0 || !tableExists('games')) return null;
  const g = new Set(tableColumns('games'));
  if (!['game_id', 'date', 'played', 'league_id'].every((c) => g.has(c))) return null;
  const type = g.has('game_type') ? ' AND COALESCE(game_type, 0) = 0' : '';
  const games = (db.prepare(`SELECT game_id, date FROM games WHERE league_id = ? AND played = 1${type}`).all(leagueId) as Array<{ game_id: unknown; date: unknown }>)
    .map((r) => ({ id: numberOrNull(r.game_id), date: parseGameDate(r.date ?? null) }))
    .filter((x): x is { id: number; date: string } => x.id !== null && x.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (games.length === 0) return null;
  const half = games[Math.floor(games.length / 2)].date;
  const firstIds = new Set(games.filter((x) => x.date < half).map((x) => x.id));
  const secondCount = games.length - firstIds.size;
  const perClub1 = (2 * firstIds.size) / clubs;
  const perClub2 = (2 * secondCount) / clubs;
  if (perClub1 < minimumGames || perClub2 < minimumGames) return null;
  const all = new Set(games.map((x) => x.id));
  const sums = new Map<string, { a: number; b: number }>();
  const add = (kind: string, first: boolean, n: number) => {
    const s = sums.get(kind) ?? { a: 0, b: 0 };
    if (first) s.a += n; else s.b += n;
    sums.set(kind, s);
  };
  const read = (table: string, opp: string, pitching: boolean) => {
    if (!tableExists(table)) return false;
    const c = new Set(tableColumns(table));
    if (!['player_id', 'game_id', 'level_id', opp].every((x) => c.has(x))) return false;
    const gs = pitching && c.has('gs') ? 'gs' : '0';
    const rows = db.prepare(`SELECT player_id, game_id, ${opp} AS n, ${gs} AS gs FROM ${table} WHERE level_id = 1`).all() as Array<{ player_id: unknown; game_id: unknown; n: unknown; gs: unknown }>;
    const byPlayer = new Map<number, { a: number; b: number; starts: number; apps: number }>();
    for (const r of rows) {
      const id = numberOrNull(r.player_id);
      const game = numberOrNull(r.game_id);
      const n = numberOrNull(r.n) ?? 0;
      if (id === null || game === null || !all.has(game)) continue;
      const p = byPlayer.get(id) ?? { a: 0, b: 0, starts: 0, apps: 0 };
      if (firstIds.has(game)) { p.a += n; p.apps += 1; p.starts += numberOrNull(r.gs) ?? 0; } else p.b += n;
      byPlayer.set(id, p);
    }
    for (const p of byPlayer.values()) {
      if (!(p.a > 0)) continue;
      const kind = !pitching ? 'hitter' : p.apps > 0 && p.starts / p.apps >= starterShare ? 'starter' : 'reliever';
      add(kind, true, p.a / perClub1);
      add(kind, false, p.b / perClub2);
    }
    return true;
  };
  const batting = read('players_game_batting', 'pa', false);
  const pitching = read('players_game_pitching_stats', 'bf', true);
  if (!batting && !pitching) return null;
  const continuation: InSeasonFacts['continuation'] = {};
  for (const [kind, s] of sums) if (s.a > 0) continuation[kind as keyof InSeasonFacts['continuation']] = s.b / s.a;
  const share = perClub2 / gamesPerTeam;
  return {
    continuation, measuredShare: share, games: perClub1 + perClub2,
    note: `Measured on this season's own games: of the players who played in its first ${Math.round(perClub1)} games per club, their playing time per game in the next ${Math.round(perClub2)} (${Object.entries(continuation).map(([k, v]) => `${k}s ${((v as number) * 100).toFixed(0)}%`).join(', ')}), carried to the rest of the season at the same rate of loss per game.`,
  };
}

/**
 * The league's own rates, per kind, over the seasons asked about: the mean WAR per 600 opportunities, the
 * spread of player rates (players with 200 or more), and the most opportunities per scheduled game any
 * player played (the physical ceiling). Plain measurements of the export, used where the fallback prior is in
 * force (D-12): no backtest is needed to average what happened.
 */
export function leagueRateFacts(leagueId: number, from: number, through: number, schedules: Map<number, number>, starterShare: number, minimumOpportunities: number): {
  kinds: Record<'hitter' | 'starter' | 'reliever', { mean600: number | null; spread600: number | null; opportunities: number; ceiling: number | null }>;
} {
  const lines = majorLeagueLines(null, from, through, leagueId);
  const listed = listedFacts([...lines.byPlayer.keys()]);
  const acc = { hitter: [] as Array<{ o: number; w: number; g: number }>, starter: [] as Array<{ o: number; w: number; g: number }>, reliever: [] as Array<{ o: number; w: number; g: number }> };
  for (const [id, p] of lines.byPlayer) {
    const pitcher = listed.get(id)?.position === 1;
    if (!pitcher) for (const l of p.batting) if (l.war !== null) acc.hitter.push({ o: l.opportunities, w: l.war, g: schedules.get(l.season) ?? 0 });
    for (const l of p.pitching) {
      if (l.war === null || !(l.games && l.games > 0)) continue;
      const kind = (l.starts ?? 0) / l.games >= starterShare ? 'starter' : 'reliever';
      acc[kind].push({ o: l.opportunities, w: l.war, g: schedules.get(l.season) ?? 0 });
    }
  }
  const out = {} as ReturnType<typeof leagueRateFacts>['kinds'];
  for (const kind of ['hitter', 'starter', 'reliever'] as const) {
    const xs = acc[kind];
    const O = xs.reduce((t, x) => t + x.o, 0);
    const W = xs.reduce((t, x) => t + x.w, 0);
    const mean = O > 0 ? (W / O) * 600 : null;
    const big = xs.filter((x) => x.o >= minimumOpportunities);
    const BO = big.reduce((t, x) => t + x.o, 0);
    const spread = mean !== null && big.length >= 2 && BO > 0
      ? Math.sqrt(big.reduce((t, x) => t + x.o * ((x.w / x.o) * 600 - mean) ** 2, 0) / BO) : null;
    const ceilings = xs.filter((x) => x.g > 0).map((x) => x.o / x.g);
    out[kind] = { mean600: mean, spread600: spread, opportunities: O, ceiling: ceilings.length > 0 ? Math.max(...ceilings) : null };
  }
  return { kinds: out };
}

/**
 * Days-out figures the export states for many injured players at exactly one value over a year, which some
 * of those players' own state contradicts (a day-to-day injury, or active on the roster): not read as days
 * (A-10). On the Arizona import, `injury_left = 1000` is held by 54 injured players, 24 flagged day-to-day
 * and 3 active; the next largest value is 841. What OOTP means by it is not established.
 */
export function injuryDurationSentinels(minimumHolders: number, minimumDays: number): Map<number, string> {
  const out = new Map<number, string>();
  if (!tableExists('players')) return out;
  const present = new Set(tableColumns('players'));
  if (!present.has('injury_left') || !present.has('injury_is_injured')) return out;
  const dtd = present.has('injury_dtd_injury') ? 'SUM(CASE WHEN injury_dtd_injury = 1 THEN 1 ELSE 0 END)' : '0';
  const rows = db.prepare(
    `SELECT injury_left AS d, COUNT(*) AS n, ${dtd} AS dtd FROM players WHERE injury_is_injured = 1 AND injury_left >= ? GROUP BY injury_left HAVING COUNT(*) >= ?`
  ).all(minimumDays, minimumHolders) as Array<{ d: unknown; n: unknown; dtd: unknown }>;
  const active = new Map<number, number>();
  if (tableExists('players_roster_status') && new Set(tableColumns('players_roster_status')).has('is_active')) {
    for (const r of db.prepare(
      `SELECT p.injury_left AS d, COUNT(*) AS n FROM players p JOIN players_roster_status s ON s.player_id = p.player_id
       WHERE p.injury_is_injured = 1 AND s.is_active = 1 AND p.injury_left >= ? GROUP BY p.injury_left`
    ).all(minimumDays) as Array<{ d: unknown; n: unknown }>) {
      const d = numberOrNull(r.d);
      if (d !== null) active.set(d, numberOrNull(r.n) ?? 0);
    }
  }
  for (const r of rows) {
    const d = numberOrNull(r.d);
    const n = numberOrNull(r.n) ?? 0;
    const dtdCount = numberOrNull(r.dtd) ?? 0;
    const activeCount = d === null ? 0 : active.get(d) ?? 0;
    if (d === null || dtdCount + activeCount === 0) continue;
    out.set(d, `injury_left ${d} is held by ${n} injured players, ${dtdCount} of them day-to-day and ${activeCount} active on the roster: not read as days`);
  }
  return out;
}

/** Players the export states were injured this season: injured now, or on the injured list this season. */
export function injuredThisSeason(ids: number[]): Set<number> {
  const out = new Set<number>();
  if (ids.length === 0) return out;
  const chunks = (f: (chunk: number[]) => void) => { for (let at = 0; at < ids.length; at += 500) f(ids.slice(at, at + 500)); };
  if (tableExists('players') && new Set(tableColumns('players')).has('injury_is_injured')) {
    chunks((chunk) => {
      for (const r of db.prepare(`SELECT player_id FROM players WHERE injury_is_injured = 1 AND player_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<{ player_id: unknown }>) {
        const id = numberOrNull(r.player_id);
        if (id !== null) out.add(id);
      }
    });
  }
  if (tableExists('players_roster_status') && new Set(tableColumns('players_roster_status')).has('dl_days_this_year')) {
    chunks((chunk) => {
      for (const r of db.prepare(`SELECT player_id FROM players_roster_status WHERE dl_days_this_year > 0 AND player_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<{ player_id: unknown }>) {
        const id = numberOrNull(r.player_id);
        if (id !== null) out.add(id);
      }
    });
  }
  return out;
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
