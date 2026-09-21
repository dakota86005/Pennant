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
import { addDays, parseGameDate } from './dataFreshness.js';
import { ROTATION_SPOTS } from './farmCalibration.js';
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

/* ── the game log: what happened, and when ───────────────────────────────────────────────────── */

/*
 * Everything above is the season to date, and a club is not. The export also carries a line for
 * every player in every game (`players_game_batting`, `players_game_pitching_stats`), which on the
 * real import reconciles with the season tables exactly — 3,717 of 3,717 batting and 3,767 of 3,767
 * pitching player-clubs, all 3,124 played games, every minor-league level — and has exactly one
 * starter at each fielding position and one on the mound per club-game
 * (docs/MINOR_LEAGUE_OPERATIONS.md §8.1). It is what lets a recent read exist.
 *
 * Two limits are part of the contract. The log records ONE position per player per game — where he
 * started, or where he entered — so there are no defensive INNINGS by date and a mid-game move is
 * invisible: a recent share is in starts, the season's is in innings. And it says who played, never
 * why a man did not.
 *
 * Nothing here is cached across requests: the farm reads it once per `FarmSession`.
 */

/** One game a club played. */
export interface ClubGame {
  gameId: number;
  /** ISO. OOTP writes `2026-5-9`, which sorts after `2026-5-10` as text; this is the parsed date. */
  date: string;
}

/** One man's work for the club in one of its games. */
export interface GameLine {
  /** Index into `ClubGameLog.games`. */
  game: number;
  /** He was in the starting lineup. */
  started: boolean;
  /** Where: a fielding position code, `DH`, `P`, or null for a pinch appearance with no position. */
  position: string | null;
  plateAppearances: number;
  pitched: boolean;
  /** He started on the mound. */
  pitchingStart: boolean;
  outs: number;
}

export interface ClubGameLog {
  teamId: number;
  /**
   * Whether the export carries a game log at all. False is a real answer — an older export, a
   * fixture — and means the recent read is unavailable, never that nobody has played.
   */
  available: boolean;
  /** Every game the club has played this season, oldest first. */
  games: ClubGame[];
  /** Every man who appeared for it, whether or not he is still on its roster. */
  lines: Map<number, GameLine[]>;
}

const LINE_POSITION: Record<number, string> = { 1: 'P', 10: 'DH' };
const linePosition = (position: number): string | null =>
  LINE_POSITION[position] ?? (position >= 2 && position <= 9 ? codeOf(position) : null);

/** The game logs of several clubs in three reads, keyed by club. */
export function clubGameLogs(teamIds: readonly number[]): Map<number, ClubGameLog> {
  const out = new Map<number, ClubGameLog>();
  for (const teamId of teamIds) out.set(teamId, { teamId, available: false, games: [], lines: new Map() });
  if (teamIds.length === 0) return out;

  const gamesOk = hasAll('games', ['game_id', 'date', 'played', 'home_team', 'away_team']);
  const battingOk = hasAll('players_game_batting', ['player_id', 'team_id', 'game_id', 'position', 'gs', 'pa']);
  const pitchingOk = hasAll('players_game_pitching_stats', ['player_id', 'team_id', 'game_id', 'gs', 'outs']);
  if (!gamesOk || (!battingOk && !pitchingOk)) return out;

  const marks = teamIds.map(() => '?').join(',');
  const hasTime = tableColumns('games').includes('time');
  const played = db
    .prepare(
      `SELECT game_id, date, ${hasTime ? 'time' : '0'} AS time, home_team, away_team FROM games
       WHERE played = 1 AND (home_team IN (${marks}) OR away_team IN (${marks}))`
    )
    .all(...teamIds, ...teamIds) as Array<{ game_id: number; date: unknown; time: number | null; home_team: number; away_team: number }>;

  /* Doubleheaders exist, so a day is not an order: date, then first pitch, then the game's id. */
  const ordered = new Map<number, Array<{ gameId: number; date: string; time: number }>>();
  for (const g of played) {
    const date = parseGameDate(g.date);
    if (!date) continue;
    for (const club of [Number(g.home_team), Number(g.away_team)]) {
      const log = out.get(club);
      if (!log) continue;
      const list = ordered.get(club) ?? [];
      list.push({ gameId: Number(g.game_id), date, time: Number(g.time ?? 0) });
      ordered.set(club, list);
    }
  }
  const indexOf = new Map<number, Map<number, number>>();
  for (const [club, list] of ordered) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.time - b.time || a.gameId - b.gameId);
    const log = out.get(club)!;
    log.available = true;
    log.games = list.map(({ gameId, date }) => ({ gameId, date }));
    indexOf.set(club, new Map(list.map((g, i) => [g.gameId, i])));
  }

  const lineFor = (club: number, playerId: number, gameId: number): GameLine | null => {
    const game = indexOf.get(club)?.get(gameId);
    if (game === undefined) return null;
    const lines = out.get(club)!.lines;
    const mine = lines.get(playerId) ?? [];
    if (!lines.has(playerId)) lines.set(playerId, mine);
    let line = mine.find((l) => l.game === game);
    if (!line) {
      line = { game, started: false, position: null, plateAppearances: 0, pitched: false, pitchingStart: false, outs: 0 };
      mine.push(line);
    }
    return line;
  };

  if (battingOk) {
    const rows = db
      .prepare(`SELECT player_id, team_id, game_id, position, gs, pa FROM players_game_batting WHERE team_id IN (${marks})`)
      .all(...teamIds) as Array<{ player_id: number; team_id: number; game_id: number; position: number | null; gs: number | null; pa: number | null }>;
    for (const r of rows) {
      const line = lineFor(Number(r.team_id), Number(r.player_id), Number(r.game_id));
      if (!line) continue;
      line.started = Number(r.gs ?? 0) > 0;
      line.position = linePosition(Number(r.position ?? 0));
      line.plateAppearances = Number(r.pa ?? 0);
    }
  }

  if (pitchingOk) {
    const rows = db
      .prepare(`SELECT player_id, team_id, game_id, gs, outs FROM players_game_pitching_stats WHERE team_id IN (${marks})`)
      .all(...teamIds) as Array<{ player_id: number; team_id: number; game_id: number; gs: number | null; outs: number | null }>;
    for (const r of rows) {
      const line = lineFor(Number(r.team_id), Number(r.player_id), Number(r.game_id));
      if (!line) continue;
      line.pitched = true;
      line.pitchingStart = Number(r.gs ?? 0) > 0;
      line.outs = Number(r.outs ?? 0);
    }
  }

  for (const log of out.values()) for (const lines of log.lines.values()) lines.sort((a, b) => a.game - b.game);
  return out;
}

const hasAll = (table: string, columns: readonly string[]): boolean => {
  if (!tableExists(table)) return false;
  const present = new Set(tableColumns(table));
  return columns.every((c) => present.has(c));
};

/**
 * The last day each man appeared for a club OTHER than the one he is on now, this season.
 *
 * The game log's own bound on an arrival: he cannot have joined his club before the day after he last
 * played for somebody else. It is the fallback when OOTP's transaction log is unavailable, and it is
 * blind to a man who came from somewhere that played no games — which the transaction log is not.
 */
export function lastGamesElsewhere(players: ReadonlyArray<{ playerId: number; teamId: number }>): Map<number, string> {
  const out = new Map<number, string>();
  if (players.length === 0 || !hasAll('games', ['game_id', 'date', 'played'])) return out;
  const current = new Map(players.map((p) => [p.playerId, p.teamId]));
  const marks = players.map(() => '?').join(',');
  const ids = players.map((p) => p.playerId);

  for (const table of ['players_game_batting', 'players_game_pitching_stats']) {
    if (!hasAll(table, ['player_id', 'team_id', 'game_id'])) continue;
    const rows = db
      .prepare(
        `SELECT l.player_id, l.team_id, g.date FROM "${table}" l JOIN games g ON g.game_id = l.game_id
         WHERE g.played = 1 AND l.player_id IN (${marks})`
      )
      .all(...ids) as Array<{ player_id: number; team_id: number; date: unknown }>;
    for (const r of rows) {
      const id = Number(r.player_id);
      if (Number(r.team_id) === current.get(id)) continue;
      const date = parseGameDate(r.date);
      if (date && date > (out.get(id) ?? '')) out.set(id, date);
    }
  }
  return out;
}

/** A stretch in which a man could not have played, as ISO dates: from the first day out to the first day back. */
export interface Absence {
  from: string;
  to: string;
}

/**
 * The injury spells this season that kept a man off the field.
 *
 * Only spells OOTP does NOT flag day-to-day. On the real import nobody appeared in a game during any
 * of 119 such spells, and 87% were back within three days of the stated end; of the day-to-day spells
 * a third were played through, so they say nothing about whether a man was available. An injury is a
 * fact and is read as exported (D-007): a missing table is no absences, never a guess.
 */
export function injuryAbsences(playerIds: readonly number[], year: number): Map<number, Absence[]> {
  const out = new Map<number, Absence[]>();
  if (playerIds.length === 0 || !hasAll('players_injury_history', ['player_id', 'date', 'length', 'day_to_day'])) return out;
  const wanted = new Set(playerIds);
  const rows = db
    .prepare(`SELECT player_id, date, length FROM players_injury_history WHERE day_to_day = 0 AND length > 0`)
    .all() as Array<{ player_id: number; date: unknown; length: number | null }>;
  for (const r of rows) {
    const id = Number(r.player_id);
    if (!wanted.has(id)) continue;
    const from = parseGameDate(r.date);
    if (!from || !from.startsWith(`${year}-`)) continue;
    const list = out.get(id) ?? [];
    list.push({ from, to: addDays(from, Number(r.length ?? 0)) });
    out.set(id, list);
  }
  return out;
}

/** The last day the export reflects: the day before the one its leagues are about to play. */
export function exportThrough(): string | null {
  if (!hasAll('leagues', ['current_date'])) return null;
  const rows = db.prepare(`SELECT "current_date" AS d FROM leagues`).all() as Array<{ d: unknown }>;
  const dates = rows.map((r) => parseGameDate(r.d)).filter((d): d is string => d !== null).sort();
  return dates.length > 0 ? addDays(dates[dates.length - 1], -1) : null;
}

/**
 * The men OOTP has lined up to start the club's next games: the first five slots of its projected
 * rotation.
 *
 * Current state, not usage, and the only such statement the export makes about a role — it has no
 * lineup or depth-chart table, so nothing like it exists for a hitter. On the real import every
 * full-season club lists five distinct men, all of them on its active list; 92% started for it in its
 * last fifteen games, and the rest are the arrivals and conversions usage has not caught up with.
 * null when the export does not say.
 */
export function projectedRotation(teamId: number): Set<number> | null {
  if (!hasAll('projected_starting_pitchers', ['team_id', 'starter_0'])) return null;
  const row = db.prepare(`SELECT * FROM projected_starting_pitchers WHERE team_id = ?`).get(teamId) as Record<string, number | null> | undefined;
  if (!row) return null;
  const men = new Set<number>();
  for (let slot = 0; slot < ROTATION_SPOTS; slot++) {
    const id = Number(row[`starter_${slot}`] ?? 0);
    if (id > 0) men.add(id);
  }
  return men.size > 0 ? men : null;
}

/** Names, and the club each man is on now, for men in a club's log who are no longer on its roster. */
export function whereabouts(playerIds: readonly number[]): Map<number, { name: string; teamId: number | null; team: string | null; level: number | null }> {
  const out = new Map<number, { name: string; teamId: number | null; team: string | null; level: number | null }>();
  if (playerIds.length === 0 || !tableExists('players')) return out;
  const teamsOk = hasAll('teams', ['team_id', 'name', 'nickname', 'level']);
  const marks = playerIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      teamsOk
        ? `SELECT p.player_id, p.first_name, p.last_name, p.team_id, t.name AS team_name, t.nickname, t.level
           FROM players p LEFT JOIN teams t ON t.team_id = p.team_id WHERE p.player_id IN (${marks})`
        : `SELECT p.player_id, p.first_name, p.last_name, p.team_id, NULL AS team_name, NULL AS nickname, NULL AS level
           FROM players p WHERE p.player_id IN (${marks})`
    )
    .all(...playerIds) as Array<{ player_id: number; first_name: string; last_name: string; team_id: number | null; team_name: string | null; nickname: string | null; level: number | null }>;
  for (const r of rows) {
    const team = r.team_name ? (r.team_name === r.nickname || !r.nickname ? r.team_name : `${r.team_name} ${r.nickname}`) : null;
    out.set(Number(r.player_id), {
      name: `${r.first_name} ${r.last_name}`,
      teamId: r.team_id === null || Number(r.team_id) <= 0 ? null : Number(r.team_id),
      team,
      level: r.level === null ? null : Number(r.level),
    });
  }
  return out;
}
