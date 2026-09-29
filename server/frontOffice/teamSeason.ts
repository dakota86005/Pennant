/**
 * The club's season as the export states it (N6, D-057, D-060): the objective facts the Morning Report's masthead and
 * "How we win and lose" read, for every club of the club's own league. Record and standings, the clubs' season totals
 * (batting, pitching, the rotation's and the bullpen's, fielding), the games played and the next one, the projected
 * starters, the per-game log for the recent window, and the trade deadline. Nothing here is a judgment: each figure is
 * read as exported, and one the export lacks is null with its reason (D-018), never a zero, a default or a major-league
 * rule by assumption (a deadline comes only from the league's own row).
 *
 * The export's team tables hold every level and placeholder rows (year 0), and each table has its own `split_id` for the
 * whole season, so a total is the club's one row at the major league, in the league's season and league, never picked
 * by `split_id`; a club with two such rows is not established (V2 plan, finding R2). A league is its own size: the
 * clubs are read, never assumed to be thirty.
 *
 * In the landing folders (`tests/presentationBoundary.test.ts`): it reaches neither the odds nor the posture.
 */
import { db, tableColumns, tableExists } from '../db.js';
import { daysBetween, parseGameDate, type GameDate } from '../dataFreshness.js';

export type TotalsTable = 'batting' | 'pitching' | 'starting' | 'bullpen' | 'fielding';

/** Each season-totals table, as the export names it. */
export const TOTALS_TABLES: Readonly<Record<TotalsTable, string>> = {
  batting: 'team_batting_stats',
  pitching: 'team_pitching_stats',
  starting: 'team_starting_pitching_stats',
  bullpen: 'team_bullpen_pitching_stats',
  fielding: 'team_fielding_stats_stats',
};

export interface ClubRecord {
  w: number;
  l: number;
  t: number;
  g: number;
  /** OOTP's place in the division, as exported; null when it states none. */
  pos: number | null;
  /** The winning percentage as exported; null when it states none. */
  pct: number | null;
  /** Games back in the division, as exported; null when it states none. */
  gb: number | null;
  /** The streak as OOTP writes it: +3 won three, -2 lost two; null when not exported. */
  streak: number | null;
}

export interface ClubFacts {
  teamId: number;
  name: string;
  abbr: string | null;
  subLeagueId: number | null;
  divisionId: number | null;
  record: ClubRecord | null;
  /** Each table's one row for the club at the major league this season, or null (not exported, or given twice). */
  totals: Record<TotalsTable, Record<string, number | null> | null>;
  /** The tables that gave the club more than one row (so its totals there are not established). */
  duplicated: TotalsTable[];
  /** Base-running runs summed over the club's players' season lines; null when the export has no such column. */
  baserunningRuns: number | null;
}

export interface PlayedGame {
  gameId: number;
  date: string;
  home: number;
  away: number;
  homeRuns: number;
  awayRuns: number;
}

export interface NextGame {
  gameId: number;
  date: string;
  /** OOTP's start time as exported (1905 is 7:05 PM); null when not exported. */
  time: number | null;
  home: number;
  away: number;
}

/** A pitcher's season line at the major league, summed over his clubs this season. */
export interface PitcherLine {
  playerId: number;
  name: string;
  w: number | null;
  l: number | null;
  saves: number | null;
  er: number | null;
  outs: number | null;
  games: number | null;
  starts: number | null;
}

/** One club's lines in one game, from the per-game log. */
export interface GameLogLine {
  teamId: number;
  gameId: number;
  values: Record<string, number | null>;
}

export interface TeamSeasonFacts {
  orgId: number;
  leagueId: number | null;
  season: number | null;
  /** The league's current day, as OOTP wrote it. */
  currentDate: GameDate | null;
  scheduledGames: number | null;
  clubs: ClubFacts[];
  divisions: Array<{ subLeagueId: number; divisionId: number; name: string }>;
  subLeagues: Array<{ subLeagueId: number; name: string | null; abbr: string | null; dh: boolean | null }>;
  /** The league's regular-season games played, in order. */
  games: PlayedGame[];
  /** Why the games cannot be read; null when they can. */
  gamesWhy: string | null;
  next: NextGame | null;
  nextWhy: string | null;
  /** OOTP's projected starters, next start first, per club. */
  projected: Array<{ teamId: number; starters: number[] }>;
  projectedWhy: string | null;
  deadline: { raw: string; date: GameDate } | null;
  deadlineWhy: string | null;
  /** The per-game log of every club: batting, and pitching split into starters (a line with a start) and relievers. */
  log: { batting: GameLogLine[] | null; starting: GameLogLine[] | null; relief: GameLogLine[] | null; why: string | null };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** OOTP dates are unpadded (2026-4-9), so ordering by the text is wrong: order by this key. */
const DATE_KEY = (col: string) => `(
  CAST(substr(${col}, 1, 4) AS INTEGER) * 10000 +
  CAST(substr(${col}, 6, CASE WHEN substr(${col}, 7, 1) = '-' THEN 1 ELSE 2 END) AS INTEGER) * 100 +
  CAST(substr(${col}, 6 + CASE WHEN substr(${col}, 7, 1) = '-' THEN 2 ELSE 3 END) AS INTEGER)
)`;

const has = (table: string): Set<string> => (tableExists(table) ? new Set(tableColumns(table)) : new Set<string>());

/** A table's WHERE for the league's season at the major league, on the columns the table has. */
function seasonWhere(cols: Set<string>, leagueId: number, season: number | null): { sql: string; params: number[] } | null {
  const parts: string[] = [];
  const params: number[] = [];
  if (cols.has('level_id')) parts.push('level_id = 1');
  if (cols.has('year')) {
    if (season === null) return null;
    parts.push('year = ?');
    params.push(season);
  }
  if (cols.has('league_id')) {
    parts.push('league_id = ?');
    params.push(leagueId);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', params };
}

/** Reads the club's league for the Morning Report. Throws only when the database cannot be read at all. */
export function readTeamSeason(orgId: number): TeamSeasonFacts {
  const teams = has('teams');
  const out: TeamSeasonFacts = {
    orgId, leagueId: null, season: null, currentDate: null, scheduledGames: null, clubs: [], divisions: [], subLeagues: [],
    games: [], gamesWhy: null, next: null, nextWhy: null, projected: [], projectedWhy: null, deadline: null, deadlineWhy: null,
    log: { batting: null, starting: null, relief: null, why: null },
  };
  if (!teams.has('team_id') || !teams.has('league_id')) {
    out.gamesWhy = 'The export has no clubs table.';
    return out;
  }
  const leagueId = num((db.prepare(`SELECT league_id FROM teams WHERE team_id = ?`).get(orgId) as { league_id?: unknown } | undefined)?.league_id);
  if (leagueId === null) return out;
  out.leagueId = leagueId;

  // The league's own row: its season, its current day, its schedule and its trade deadline
  const leagues = has('leagues');
  if (leagues.has('league_id')) {
    const cols = ['season_year', 'current_date', 'rules_schedule_games_per_team', 'trade_deadline_date'].filter((c) => leagues.has(c));
    const row = cols.length
      ? db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM leagues WHERE league_id = ?`).get(leagueId) as Record<string, unknown> | undefined
      : undefined;
    out.season = num(row?.season_year);
    out.currentDate = text(row?.current_date);
    out.scheduledGames = num(row?.rules_schedule_games_per_team);
    if (!leagues.has('trade_deadline_date')) out.deadlineWhy = 'The export doesn\'t carry the league\'s trade deadline.';
    else {
      const raw = text(row?.trade_deadline_date);
      const date = parseGameDate(raw);
      if (raw && date) out.deadline = { raw, date: raw };
      else out.deadlineWhy = raw ? `The league's trade deadline (${raw}) isn't a date Pennant can read.` : 'The league\'s row gives no trade deadline.';
    }
  } else out.deadlineWhy = 'The export has no leagues table, so the trade deadline isn\'t known.';

  // The clubs of the league at the major league (a league is its own size)
  const label = teams.has('nickname') && teams.has('name')
    ? `CASE WHEN nickname IS NULL OR nickname = '' OR name = nickname THEN name ELSE name || ' ' || nickname END`
    : teams.has('name') ? 'name' : `'Club ' || team_id`;
  const where = ['league_id = ?', ...(teams.has('level') ? ['level = 1'] : []), ...(teams.has('allstar_team') ? ['COALESCE(allstar_team, 0) = 0'] : [])];
  const clubRows = db.prepare(`SELECT team_id, ${label} AS label, ${teams.has('abbr') ? 'abbr' : 'NULL'} AS abbr,
      ${teams.has('sub_league_id') ? 'sub_league_id' : 'NULL'} AS sub, ${teams.has('division_id') ? 'division_id' : 'NULL'} AS div
    FROM teams WHERE ${where.join(' AND ')} ORDER BY team_id`).all(leagueId) as Array<{ team_id: number; label: unknown; abbr: unknown; sub: unknown; div: unknown }>;
  const ids = clubRows.map((r) => r.team_id);
  const inClubs = ids.length ? `team_id IN (${ids.join(',')})` : '1 = 0';

  const records = new Map<number, ClubRecord>();
  const rec = has('team_record');
  if (rec.has('team_id') && rec.has('w') && rec.has('l')) {
    const pick = (c: string) => (rec.has(c) ? c : 'NULL');
    for (const r of db.prepare(`SELECT team_id, w, l, ${pick('t')} AS t, ${pick('g')} AS g, ${pick('pos')} AS pos, ${pick('pct')} AS pct, ${pick('gb')} AS gb, ${pick('streak')} AS streak
      FROM team_record WHERE ${inClubs}`).all() as Array<Record<string, unknown>>) {
      const w = num(r.w);
      const l = num(r.l);
      if (w === null || l === null) continue;
      const t = num(r.t) ?? 0;
      const pos = num(r.pos);
      records.set(r.team_id as number, { w, l, t, g: num(r.g) ?? w + l + t, pos: pos !== null && pos > 0 ? pos : null, pct: num(r.pct), gb: num(r.gb), streak: num(r.streak) });
    }
  }

  // The season totals: the club's one row at the major league this season
  const totals = new Map<number, ClubFacts['totals']>(ids.map((id) => [id, { batting: null, pitching: null, starting: null, bullpen: null, fielding: null }]));
  const duplicated = new Map<number, TotalsTable[]>(ids.map((id) => [id, []]));
  for (const [kind, table] of Object.entries(TOTALS_TABLES) as Array<[TotalsTable, string]>) {
    const cols = has(table);
    if (!cols.has('team_id')) continue;
    const w = seasonWhere(cols, leagueId, out.season);
    if (!w) continue;
    const seen = new Map<number, number>();
    const rows = db.prepare(`SELECT * FROM "${table}" WHERE ${inClubs} AND ${w.sql}`).all(...w.params) as Array<Record<string, unknown>>;
    for (const r of rows) seen.set(r.team_id as number, (seen.get(r.team_id as number) ?? 0) + 1);
    for (const r of rows) {
      const id = r.team_id as number;
      if ((seen.get(id) ?? 0) > 1) continue;
      totals.get(id)![kind] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));
    }
    for (const [id, n] of seen) if (n > 1) duplicated.get(id)!.push(kind);
  }

  // Base-running runs: the club's players' season lines at the major league (the whole-season split), summed
  const baserunning = new Map<number, number>();
  const career = has('players_career_batting_stats');
  let baserunningRead = false;
  if (career.has('ubr') && career.has('team_id') && career.has('split_id')) {
    const w = seasonWhere(career, leagueId, out.season);
    if (w) {
      baserunningRead = true;
      for (const r of db.prepare(`SELECT team_id, SUM(ubr) AS ubr FROM players_career_batting_stats WHERE ${inClubs} AND split_id = 1 AND ${w.sql} GROUP BY team_id`)
        .all(...w.params) as Array<{ team_id: number; ubr: unknown }>) {
        const v = num(r.ubr);
        if (v !== null) baserunning.set(r.team_id, v);
      }
    }
  }

  out.clubs = clubRows.map((r) => ({
    teamId: r.team_id,
    name: text(r.label) ?? `Club ${r.team_id}`,
    abbr: text(r.abbr),
    subLeagueId: num(r.sub),
    divisionId: num(r.div),
    record: records.get(r.team_id) ?? null,
    totals: totals.get(r.team_id)!,
    duplicated: duplicated.get(r.team_id)!,
    baserunningRuns: baserunningRead ? baserunning.get(r.team_id) ?? null : null,
  }));

  const div = has('divisions');
  if (div.has('league_id') && div.has('sub_league_id') && div.has('division_id') && div.has('name')) {
    out.divisions = (db.prepare(`SELECT sub_league_id, division_id, name FROM divisions WHERE league_id = ?`).all(leagueId) as Array<Record<string, unknown>>)
      .map((d) => ({ subLeagueId: num(d.sub_league_id) ?? 0, divisionId: num(d.division_id) ?? 0, name: text(d.name) ?? '' }))
      .filter((d) => d.name !== '');
  }
  const subs = has('sub_leagues');
  if (subs.has('league_id') && subs.has('sub_league_id')) {
    out.subLeagues = (db.prepare(`SELECT sub_league_id, ${subs.has('name') ? 'name' : 'NULL'} AS name, ${subs.has('abbr') ? 'abbr' : 'NULL'} AS abbr,
        ${subs.has('designated_hitter') ? 'designated_hitter' : 'NULL'} AS dh FROM sub_leagues WHERE league_id = ?`).all(leagueId) as Array<Record<string, unknown>>)
      .map((s) => ({ subLeagueId: num(s.sub_league_id) ?? 0, name: text(s.name), abbr: text(s.abbr), dh: num(s.dh) === null ? null : num(s.dh) === 1 }));
  }

  // The games: the league's regular season, played, in order; and the club's next
  const games = has('games');
  const needed = ['game_id', 'home_team', 'away_team', 'date', 'played', 'runs0', 'runs1'];
  if (!needed.every((c) => games.has(c))) out.gamesWhy = 'The export has no game-by-game schedule.';
  else {
    const regular = games.has('game_type') ? 'AND game_type = 0' : '';
    const inLeague = games.has('league_id') ? 'AND league_id = ?' : '';
    const params = games.has('league_id') ? [leagueId] : [];
    const order = `ORDER BY ${DATE_KEY('date')}${games.has('time') ? ', time' : ''}, game_id`;
    out.games = (db.prepare(`SELECT game_id, date, home_team, away_team, runs0, runs1 FROM games WHERE played = 1 ${regular} ${inLeague} ${order}`)
      .all(...params) as Array<Record<string, unknown>>)
      .filter((g) => ids.includes(g.home_team as number) && ids.includes(g.away_team as number))
      .map((g) => ({
        gameId: g.game_id as number, date: String(g.date), home: g.home_team as number, away: g.away_team as number,
        // runs0 is the visitors' score, runs1 the home club's (verified against the standings)
        awayRuns: num(g.runs0) ?? 0, homeRuns: num(g.runs1) ?? 0,
      }));
    // The next game is on or after the league's day: an unplayed game dated before it (a postponement) is never next
    const today = parseGameDate(out.currentDate);
    const fromToday = today ? `AND ${DATE_KEY('date')} >= ${Number(today.replace(/-/g, ''))}` : '';
    const next = db.prepare(`SELECT game_id, date, ${games.has('time') ? 'time' : 'NULL'} AS time, home_team, away_team FROM games
      WHERE played = 0 ${regular} AND (home_team = ? OR away_team = ?) ${fromToday} ${order} LIMIT 1`).get(orgId, orgId) as Record<string, unknown> | undefined;
    if (next) out.next = { gameId: next.game_id as number, date: String(next.date), time: num(next.time), home: next.home_team as number, away: next.away_team as number };
    else out.nextWhy = today ? 'The export schedules no more games for the club from the league\'s day on.' : 'The export schedules no more games for the club this season.';
  }
  if (out.gamesWhy) out.nextWhy = out.gamesWhy;

  const projected = has('projected_starting_pitchers');
  if (!projected.has('team_id') || !projected.has('starter_0')) out.projectedWhy = 'The export has no projected starters.';
  else {
    const slots = Array.from({ length: 8 }, (_, i) => `starter_${i}`).filter((c) => projected.has(c));
    out.projected = (db.prepare(`SELECT team_id, ${slots.join(', ')} FROM projected_starting_pitchers WHERE ${inClubs}`).all() as Array<Record<string, unknown>>)
      .map((r) => ({ teamId: r.team_id as number, starters: slots.map((s) => num(r[s])).filter((id): id is number => id !== null && id > 0) }));
  }

  out.log = readGameLog(leagueId, out.season, inClubs);
  return out;
}

/** The per-game log summed per club and game (batting; pitching by starters and relievers), or why it cannot be read. */
function readGameLog(leagueId: number, season: number | null, inClubs: string): TeamSeasonFacts['log'] {
  const log: TeamSeasonFacts['log'] = { batting: null, starting: null, relief: null, why: null };
  const sums = (cols: Set<string>, wanted: string[]) => wanted.filter((c) => cols.has(c)).map((c) => `SUM(${c}) AS ${c}`).join(', ');
  const lines = (rows: Array<Record<string, unknown>>): GameLogLine[] => rows.map((r) => ({
    teamId: r.team_id as number, gameId: r.game_id as number,
    values: Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'team_id' && k !== 'game_id' && k !== 'starter').map(([k, v]) => [k, num(v)])),
  }));
  const bat = has('players_game_batting');
  const batWhere = seasonWhere(bat, leagueId, season);
  if (bat.has('team_id') && bat.has('game_id') && batWhere) {
    const cols = sums(bat, ['ab', 'h', 'd', 't', 'hr', 'bb', 'hp', 'sf', 'sb', 'cs', 'ubr']);
    if (cols) log.batting = lines(db.prepare(`SELECT team_id, game_id, ${cols} FROM players_game_batting WHERE ${inClubs} AND ${batWhere.sql} GROUP BY team_id, game_id`).all(...batWhere.params) as Array<Record<string, unknown>>);
  }
  const pit = has('players_game_pitching_stats');
  const pitWhere = seasonWhere(pit, leagueId, season);
  if (pit.has('team_id') && pit.has('game_id') && pit.has('gs') && pitWhere) {
    const outs = pit.has('outs') ? 'SUM(outs) AS outs' : pit.has('ip') ? `SUM(ip * 3${pit.has('ipf') ? ' + COALESCE(ipf, 0)' : ''}) AS outs` : null;
    const cols = [outs, sums(pit, ['er', 'ha', 'hra', 'bf', 'k', 'bb', 'hp'])].filter(Boolean).join(', ');
    const rows = db.prepare(`SELECT team_id, game_id, CASE WHEN gs > 0 THEN 1 ELSE 0 END AS starter, ${cols}
      FROM players_game_pitching_stats WHERE ${inClubs} AND ${pitWhere.sql} GROUP BY team_id, game_id, CASE WHEN gs > 0 THEN 1 ELSE 0 END`).all(...pitWhere.params) as Array<Record<string, unknown>>;
    log.starting = lines(rows.filter((r) => r.starter === 1));
    log.relief = lines(rows.filter((r) => r.starter === 0));
  }
  if (!log.batting && !log.starting) log.why = 'The export has no game-by-game player lines.';
  return log;
}

/**
 * Each club's starts by position this season, from its own game log (`players_game_batting`: a line with a start, `gs`,
 * at the position it was played, 2 catcher ... 10 designated hitter), and how many of each man's starts fall in the
 * club's last `window` games played. Rows are counted once per game whatever splits the export repeats them in. Null
 * with why when the log cannot say who started where (no log, or no position or start column).
 */
export function positionStartsOf(facts: TeamSeasonFacts, window: number): {
  byClub: Map<number, { games: number; at: Map<number, Array<{ playerId: number; season: number; recent: number }>> }>;
  why: string | null;
} {
  const out = new Map<number, { games: number; at: Map<number, Array<{ playerId: number; season: number; recent: number }>> }>();
  const cols = has('players_game_batting');
  if (!['player_id', 'team_id', 'game_id', 'position', 'gs'].every((c) => cols.has(c))) {
    return { byClub: out, why: 'The export\'s game log doesn\'t say who started where.' };
  }
  if (facts.leagueId === null) return { byClub: out, why: 'The club\'s league isn\'t in the export.' };
  const w = seasonWhere(cols, facts.leagueId, facts.season);
  if (!w) return { byClub: out, why: 'The season isn\'t known, so its game log can\'t be read.' };
  const ids = facts.clubs.map((c) => c.teamId);
  if (!ids.length) return { byClub: out, why: null };
  const rows = db.prepare(`SELECT DISTINCT team_id, position, player_id, game_id FROM players_game_batting
    WHERE team_id IN (${ids.join(',')}) AND ${w.sql} AND gs > 0 AND position BETWEEN 2 AND 10`).all(...w.params) as Array<Record<string, unknown>>;
  // Each club's last games played, from the schedule's order (the league's games are already in order)
  const recent = new Map<number, Set<number>>();
  const played = new Map<number, number>();
  for (const id of ids) {
    const mine = facts.games.filter((g) => g.home === id || g.away === id);
    played.set(id, Math.min(window, mine.length));
    recent.set(id, new Set(mine.slice(-window).map((g) => g.gameId)));
  }
  const counts = new Map<string, { teamId: number; position: number; playerId: number; season: number; recent: number }>();
  for (const r of rows) {
    const teamId = num(r.team_id);
    const position = num(r.position);
    const playerId = num(r.player_id);
    const gameId = num(r.game_id);
    if (teamId === null || position === null || playerId === null || gameId === null) continue;
    const key = `${teamId}:${position}:${playerId}`;
    const c = counts.get(key) ?? { teamId, position, playerId, season: 0, recent: 0 };
    c.season += 1;
    if (recent.get(teamId)?.has(gameId)) c.recent += 1;
    counts.set(key, c);
  }
  for (const id of ids) out.set(id, { games: played.get(id) ?? 0, at: new Map() });
  for (const c of counts.values()) {
    const club = out.get(c.teamId);
    if (!club) continue;
    const list = club.at.get(c.position) ?? [];
    list.push({ playerId: c.playerId, season: c.season, recent: c.recent });
    club.at.set(c.position, list);
  }
  return { byClub: out, why: null };
}

/** Players' names, as the export has them. */
export function playerNames(ids: readonly number[]): Map<number, string> {
  const cols = has('players');
  const out = new Map<number, string>();
  if (!ids.length || !cols.has('player_id')) return out;
  const name = cols.has('first_name') && cols.has('last_name') ? `TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))` : `'Player ' || player_id`;
  for (const r of db.prepare(`SELECT player_id, ${name} AS name FROM players WHERE player_id IN (${[...new Set(ids)].join(',')})`).all() as Array<{ player_id: number; name: unknown }>) {
    out.set(r.player_id, text(r.name) ?? `Player ${r.player_id}`);
  }
  return out;
}

/** Pitchers' season lines at the major league (the whole-season split), summed over their clubs this season. */
export function pitcherLines(ids: readonly number[], leagueId: number, season: number | null): Map<number, PitcherLine> {
  const out = new Map<number, PitcherLine>();
  const names = playerNames(ids);
  const cols = has('players_career_pitching_stats');
  const w = seasonWhere(cols, leagueId, season);
  const sum = (c: string) => (cols.has(c) ? `SUM(${c})` : 'NULL');
  const outs = cols.has('outs') ? 'SUM(outs)' : cols.has('ip') ? `SUM(ip * 3${cols.has('ipf') ? ' + COALESCE(ipf, 0)' : ''})` : 'NULL';
  const rows = ids.length && cols.has('player_id') && w
    ? db.prepare(`SELECT player_id, ${sum('w')} AS w, ${sum('l')} AS l, ${sum('s')} AS s, ${sum('er')} AS er, ${outs} AS outs, ${sum('g')} AS g, ${sum('gs')} AS gs
        FROM players_career_pitching_stats WHERE player_id IN (${[...new Set(ids)].join(',')}) ${cols.has('split_id') ? 'AND split_id = 1' : ''} AND ${w.sql}
        GROUP BY player_id`).all(...w.params) as Array<Record<string, unknown>>
    : [];
  const byId = new Map(rows.map((r) => [r.player_id as number, r]));
  for (const id of ids) {
    const r = byId.get(id);
    out.set(id, {
      playerId: id, name: names.get(id) ?? `Player ${id}`,
      w: num(r?.w), l: num(r?.l), saves: num(r?.s), er: num(r?.er), outs: num(r?.outs), games: num(r?.g), starts: num(r?.gs),
    });
  }
  return out;
}

// ── the masthead's facts (pure) ─────────────────────────────────────────────

/**
 * The club's place in its division, in the exported standings' own order (`team_record.pos`) where every club of the
 * division has one, games back the number beside it (N6 review, M2). Two clubs share a place only when their winning
 * percentages are equal (as exported, else won over decided, at the standings' three decimals), never because their games
 * back are level. Where the standings give no order, the place is counted from the records (winning percentage, then
 * wins less losses) and says so.
 */
export interface DivisionPlace {
  rank: number;
  of: number;
  tiedWith: number;
  /** Games back of the leader, as exported (or from the records where the export states none). */
  gamesBack: number;
  /** When it leads alone: games ahead of the next club. */
  gamesAhead: number | null;
  /** The division's name as the export has it, with its sub-league ("AL West"); null for a league with no divisions. */
  division: string | null;
  /** How games back was read. */
  source: 'exported' | 'records';
  /** How the place was read: the standings' own order, or counted from the records. */
  order: 'standings' | 'records';
  /** The division's clubs with a record, in that order (team ids). */
  members: number[];
  /** The clubs sharing the place with ours (team ids). */
  levelWith: number[];
}

const gbFromRecords = (leader: ClubRecord, r: ClubRecord) => ((leader.w - leader.l) - (r.w - r.l)) / 2;

/** A club's winning percentage at the standings' three decimals: as exported, else won over decided; null with none decided. */
export function pctOf(r: ClubRecord): number | null {
  const raw = r.pct ?? (r.w + r.l > 0 ? r.w / (r.w + r.l) : null);
  return raw === null ? null : Number(raw.toFixed(3));
}

/** The division's clubs with a record, in the order the place is read (the standings' own, else the records'). */
export function divisionOrder(facts: TeamSeasonFacts, me: ClubFacts): { members: ClubFacts[]; order: 'standings' | 'records' } {
  const members = facts.clubs.filter((c) => c.subLeagueId === me.subLeagueId && c.divisionId === me.divisionId && c.record);
  const standings = members.every((c) => c.record!.pos !== null);
  const wl = (c: ClubFacts) => c.record!.w - c.record!.l;
  const sorted = standings
    ? [...members].sort((a, b) => a.record!.pos! - b.record!.pos! || a.name.localeCompare(b.name))
    : [...members].sort((a, b) => (pctOf(b.record!) ?? -1) - (pctOf(a.record!) ?? -1) || wl(b) - wl(a) || a.name.localeCompare(b.name));
  return { members: sorted, order: standings ? 'standings' : 'records' };
}

export function divisionPlace(facts: TeamSeasonFacts): DivisionPlace | null {
  const me = facts.clubs.find((c) => c.teamId === facts.orgId);
  if (!me?.record) return null;
  const { members, order } = divisionOrder(facts, me);
  const exported = members.every((c) => c.record!.gb !== null);
  const best = members.reduce((a, b) => ((b.record!.w - b.record!.l) > (a.record!.w - a.record!.l) ? b : a));
  const gb = (c: ClubFacts) => (exported ? c.record!.gb! : gbFromRecords(best.record!, c.record!));
  const mine = gb(me);
  const myPct = pctOf(me.record);
  const wl = (c: ClubFacts) => c.record!.w - c.record!.l;
  // Level: the same winning percentage (and, read from the records, the same wins less losses)
  const level = members.filter((c) => c.teamId !== me.teamId && myPct !== null && pctOf(c.record!) === myPct
    && (order === 'standings' || wl(c) === wl(me)));
  const rank = order === 'standings'
    ? Math.min(me.record.pos!, ...level.map((c) => c.record!.pos!))
    : members.indexOf(me) + 1 - members.slice(0, members.indexOf(me)).filter((c) => level.includes(c)).length;
  const others = members.filter((c) => c.teamId !== me.teamId).map(gb);
  const sub = facts.subLeagues.find((s) => s.subLeagueId === me.subLeagueId);
  const div = facts.divisions.find((d) => d.subLeagueId === me.subLeagueId && d.divisionId === me.divisionId);
  const subName = facts.subLeagues.length > 1 ? sub?.abbr ?? sub?.name ?? null : null;
  const divName = div ? div.name.replace(/\s+Division$/i, '') : null;
  const division = divName ? [subName, divName].filter(Boolean).join(' ') : subName;
  return {
    rank, of: members.length, tiedWith: level.length, gamesBack: mine,
    gamesAhead: rank === 1 && level.length === 0 && others.length ? Math.max(0, Math.min(...others) - mine) : null,
    division, source: exported ? 'exported' : 'records', order,
    members: members.map((c) => c.teamId), levelWith: level.map((c) => c.teamId),
  };
}

/** The club's games, in order, from its side: its runs, the other club's, where it played. */
export function clubGames(facts: TeamSeasonFacts, teamId: number): Array<{ gameId: number; date: string; scored: number; allowed: number; home: boolean; opponent: number }> {
  return facts.games
    .filter((g) => g.home === teamId || g.away === teamId)
    .map((g) => g.home === teamId
      ? { gameId: g.gameId, date: g.date, scored: g.homeRuns, allowed: g.awayRuns, home: true, opponent: g.away }
      : { gameId: g.gameId, date: g.date, scored: g.awayRuns, allowed: g.homeRuns, home: false, opponent: g.home });
}

/** Whole days from the league's current day to a date; null when either is not a date. */
export function daysFrom(current: string | null, to: string | null): number | null {
  const a = parseGameDate(current);
  const b = parseGameDate(to);
  return a && b ? daysBetween(a, b) : null;
}

/**
 * Every club's line in the standings at this import, for the snapshot Pennant keeps of it (N7, D-058): the record as
 * exported, the club's place in its division as the Morning Report reads it (`divisionPlace`), games back, and its runs
 * scored and allowed from the games played. A club with no record keeps its name and nothing else (never zeros).
 */
export interface StandingsLine {
  teamId: number;
  name: string;
  abbr: string | null;
  leagueId: number | null;
  subLeagueId: number | null;
  divisionId: number | null;
  division: string | null;
  w: number | null;
  l: number | null;
  t: number | null;
  pos: number | null;
  divisionClubs: number | null;
  gb: number | null;
  runsScored: number | null;
  runsAllowed: number | null;
}

export function standingsLines(facts: TeamSeasonFacts): StandingsLine[] {
  const gamesRead = facts.gamesWhy === null;
  return facts.clubs.map((c) => {
    const place = c.record ? divisionPlace({ ...facts, orgId: c.teamId }) : null;
    const games = gamesRead ? clubGames(facts, c.teamId) : null;
    return {
      teamId: c.teamId, name: c.name, abbr: c.abbr, leagueId: facts.leagueId, subLeagueId: c.subLeagueId, divisionId: c.divisionId,
      division: place?.division ?? null,
      w: c.record?.w ?? null, l: c.record?.l ?? null, t: c.record?.t ?? null,
      pos: place?.rank ?? null, divisionClubs: place?.of ?? null, gb: place?.gamesBack ?? null,
      runsScored: games ? games.reduce((sum, g) => sum + g.scored, 0) : null,
      runsAllowed: games ? games.reduce((sum, g) => sum + g.allowed, 0) : null,
    };
  });
}
