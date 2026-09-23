/**
 * Player Value's reader of the league's playing history (phase 3a; PLAYER_VALUE.md Parts 2.3 and 7).
 *
 * Opens `league.db` read-only, every column checked before it is read (D-007): the league's clubs
 * and standings, where this season stands, the major-league lines of the players asked about (or of
 * every player, for a fit), dates of birth and the season's calendar. Only the major-league level
 * (`level_id = 1`) and the overall split are read: minor-league and amateur WAR never stand in for a
 * major-league record (owner, Q-9). A season's WAR is summed over the clubs he played for (R-4).
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
