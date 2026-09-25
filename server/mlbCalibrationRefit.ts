/**
 * MLB Operations' per-save refits (D-053, cycle 1): the reads each fit needs, and their registration with the neutral refit registry
 * (`saveCalibration.ts`). Loaded by the refit worker and the harness, never by a request.
 *
 *   standards  the production review of every club of the league, as it stands (through `mlbOperations.ts`, so every lens comes
 *              from the same specialists and ports as the page), and the league's past seasons on the results lens
 *   aging      consecutive seasons of the league's own major-league lines, with dates of birth
 *   defense    the seasons whose fielding rows carry zone-rating runs, with each regular's batting and fielding runs
 *
 * Objective statistics only (season lines, fielding runs, starts, dates of birth): no rating column and no `players_value`
 * (`tests/saveCalibrationBoundary.test.ts`). Ratings enter only as the review's own lenses, which read them through
 * `scoutedEvidence.ts`. Every column is checked before it is read (D-007); nothing is written here.
 */

import { db, tableColumns, tableExists } from './db.js';
import { leagueBaseline } from './stats.js';
import { battingHistory, pitchingHistory, seasonEnvironments } from './resultsEvidence.js';
import { percentileAmong, POPULATION_MINIMUM, SEASON_WEIGHTS, weightedBatting, weightedPitching, wobaOf } from './resultsMetrics.js';
import { PITCHER_RESULTS_MIX } from './roleReview.js';
import { REGULAR_SHARE } from './lineupPicture.js';
import { hitterKey, relieverKey, STARTER_KEY } from './roleStandards.js';
import { leagueClubs, leagueSeasons, marketLevels, seasonSchedules } from './saveIdentity.js';
import { registerCalibration, type CalibrationBasis } from './saveCalibration.js';
import { reviewClub } from './mlbReview.js';
import { loadClubView } from './mlbRoster.js';
import { reviewPorts } from './mlbOperations.js';
import {
  AGING_METHOD, DEFENSE_METHOD, fitAging, fitDefense, measureStandards, MLB_CALIBRATION_SUBSYSTEM, ROSTER_REVIEW_FIT_POLICY, STANDARDS_METHOD,
  type AgingInput, type AgingPair, type DefenseSeason, type ResultsLensSeason, type StandardHolder, type StandardsSample,
} from './mlbCalibrationFit.js';

const has = (table: string, cols: string[]) => tableExists(table) && cols.every((c) => new Set(tableColumns(table)).has(c));
const levelOf = (leagueId: number) => marketLevels().get(leagueId) ?? 1;

/** The league's completed full seasons up to `through` (a season under the policy's share of its schedule is skipped, with why). */
export function fullSeasons(leagueId: number, through: number, minShare: number): { seasons: number[]; skipped: Array<{ season: number; reason: string }> } {
  const seasons: number[] = [];
  const skipped: Array<{ season: number; reason: string }> = [];
  for (const s of leagueSeasons(leagueId, through)) {
    if (s.scheduleShare !== null && s.scheduleShare < minShare) skipped.push({ season: s.season, reason: `a short season (${Math.round(s.scheduleShare * 100)}% of a full schedule)` });
    else seasons.push(s.season);
  }
  return { seasons, skipped };
}

// ── standards ────────────────────────────────────────────────────────────────

/** A club's games played this season from its standings; null when the export does not say (unknown, never zero). */
function gamesPlayed(teamId: number): number | null {
  if (!tableExists('team_record')) return null;
  const cols = new Set(tableColumns('team_record'));
  if (!cols.has('team_id')) return null;
  const expr = cols.has('g') ? 'g' : cols.has('w') && cols.has('l') ? 'w + l' : null;
  if (expr === null) return null;
  const row = db.prepare(`SELECT ${expr} AS g FROM team_record WHERE team_id = ?`).get(teamId) as { g: unknown } | undefined;
  return typeof row?.g === 'number' && Number.isFinite(row.g) ? row.g : null;
}

/** Every club of the league reviewed as it stands: each holder's role, working estimate, bat and lenses. */
export function standardsSample(leagueId: number): StandardsSample {
  if (!has('teams', ['team_id', 'league_id', 'level'])) return { clubs: [] };
  // The league's own clubs (all-star sides excluded, as everywhere), at its top level
  const own = leagueClubs(leagueId);
  const teams = (db.prepare(`SELECT team_id FROM teams WHERE league_id = ? AND level = ? ORDER BY team_id`).all(leagueId, levelOf(leagueId)) as Array<{ team_id: number }>)
    .filter((t) => own.has(t.team_id));
  const clubs: StandardsSample['clubs'] = [];
  for (const t of teams) {
    const ports = reviewPorts(t.team_id);
    const groups = reviewClub(loadClubView(t.team_id), ports);
    const lineup = groups.find((g) => g.role === 'lineup regular');
    if (!lineup || lineup.holders.length < 5) continue;
    const holders: StandardHolder[] = [];
    const add = (role: string, h: (typeof lineup.holders)[number]) => {
      if (h.estimate.value === null) return;
      holders.push({ role, estimate: h.estimate.value, bat: h.estimate.batValue ?? null, tools: h.estimate.ratingsPct, results: h.estimate.resultsPct });
    };
    for (const h of lineup.holders) if (h.position !== undefined) add(hitterKey(h.position), h);
    for (const g of groups) {
      if (g.kind === 'starting_pitcher') for (const h of g.holders) add(STARTER_KEY, h);
      if (g.kind === 'relief_pitcher') for (const h of g.holders) add(relieverKey(h.tier ?? 'unknown'), h);
    }
    clubs.push({ clubId: t.team_id, gamesPlayed: gamesPlayed(t.team_id), holders });
  }
  return { clubs };
}

/** Relievers are one pool on the history's results lens: past usage roles cannot be rebuilt (no leverage exported for past seasons). */
export const HISTORY_RELIEVER_POOL = 'rel:pool';

/**
 * One past season on the results lens: its regulars by position (the club's most starts there, at least `REGULAR_SHARE` of its games;
 * designated-hitter starts are batting starts less fielding starts), each club's rotation (top five by starts, 8 or more) and its
 * relievers (20 or more games, starts at most a fifth of them), each ranked as the review ranks results at a season's end.
 */
export function resultsLensSeason(leagueId: number, t: number): ResultsLensSeason | { skip: string } {
  const level = levelOf(leagueId);
  const holders: ResultsLensSeason['holders'] = [];
  // The season's schedule, games per club (the standings, else the lines): never an assumed length (D-018)
  const schedule = seasonSchedules(leagueId, t).get(t) ?? null;
  if (schedule === null) return { skip: "its schedule is not established in the export" };
  if (!has('players_career_fielding_stats', ['player_id', 'team_id', 'year', 'position', 'gs', 'level_id', 'league_id'])
    || !has('players_career_batting_stats', ['player_id', 'team_id', 'year', 'gs', 'level_id', 'league_id', 'split_id'])) return { season: t, holders };
  const env = seasonEnvironments(leagueId, t);
  const games = new Map<number, number>();
  if (has('team_history_record', ['team_id', 'year', 'g'])) {
    const byLeague = new Set(tableColumns('team_history_record')).has('league_id') ? ' AND league_id = ?' : '';
    for (const r of db.prepare(`SELECT team_id, g FROM team_history_record WHERE year = ?${byLeague}`).all(t, ...(byLeague ? [leagueId] : [])) as Array<{ team_id: number; g: number }>) games.set(r.team_id, r.g);
  }
  const f = db.prepare(`SELECT player_id id, team_id team, position pos, SUM(gs) gs FROM players_career_fielding_stats WHERE level_id = ? AND league_id = ? AND year = ? AND position BETWEEN 2 AND 9 GROUP BY 1, 2, 3`).all(level, leagueId, t) as Array<{ id: number; team: number; pos: number; gs: number }>;
  const b = db.prepare(`SELECT player_id id, team_id team, SUM(gs) gs FROM players_career_batting_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year = ? GROUP BY 1, 2`).all(level, leagueId, t) as Array<{ id: number; team: number; gs: number }>;
  const fielded = new Map<string, number>();
  for (const r of f) fielded.set(`${r.id}:${r.team}`, (fielded.get(`${r.id}:${r.team}`) ?? 0) + r.gs);
  const slots = new Map<string, { id: number; gs: number; team: number }>();
  const offer = (key: string, id: number, gs: number, team: number) => { const cur = slots.get(key); if (!cur || gs > cur.gs) slots.set(key, { id, gs, team }); };
  for (const r of f) offer(`${r.team}:${r.pos}`, r.id, r.gs, r.team);
  for (const r of b) { const dh = r.gs - (fielded.get(`${r.id}:${r.team}`) ?? 0); if (dh > 0) offer(`${r.team}:10`, r.id, dh, r.team); }
  const ids = (db.prepare(`SELECT DISTINCT player_id id FROM players_career_batting_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year BETWEEN ? AND ?`).all(level, leagueId, t - 2, t) as Array<{ id: number }>).map((r) => r.id);
  const values = new Map<number, number>();
  const population: number[] = [];
  for (const [id, lines] of battingHistory(ids, leagueId, t)) {
    const w = weightedBatting(lines, env, t);
    if (w.value !== null && w.sample >= POPULATION_MINIMUM.hitter) { values.set(id, w.value); population.push(w.value); }
  }
  for (const [key, v] of slots) {
    if (v.gs < REGULAR_SHARE * (games.get(v.team) ?? schedule)) continue;
    const value = values.get(v.id);
    if (value !== undefined) holders.push({ role: hitterKey(Number(key.split(':')[1])), value: percentileAmong(population, value, true) as number });
  }
  if (!has('players_career_pitching_stats', ['player_id', 'team_id', 'year', 'g', 'gs', 'level_id', 'league_id', 'split_id'])) return { season: t, holders };
  const pids = (db.prepare(`SELECT DISTINCT player_id id FROM players_career_pitching_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year BETWEEN ? AND ?`).all(level, leagueId, t - 2, t) as Array<{ id: number }>).map((r) => r.id);
  const history = pitchingHistory(pids, leagueId, t);
  const pops = { starter: { sk: [] as number[], ru: [] as number[] }, reliever: { sk: [] as number[], ru: [] as number[] } };
  for (const lines of history.values()) {
    const g = lines.reduce((n, l) => n + l.g, 0);
    const gs = lines.reduce((n, l) => n + l.gs, 0);
    const usage = g > 0 && gs / g >= 0.5 ? 'starter' : 'reliever';
    const w = weightedPitching(lines, env, t, SEASON_WEIGHTS[usage]);
    if (w.skills.value === null || w.runs.value === null || w.skills.sample < POPULATION_MINIMUM.pitcher) continue;
    pops[usage].sk.push(w.skills.value); pops[usage].ru.push(w.runs.value);
  }
  const lens = (id: number, usage: 'starter' | 'reliever'): number | null => {
    const lines = history.get(id);
    if (!lines) return null;
    const w = weightedPitching(lines, env, t, SEASON_WEIGHTS[usage]);
    if (w.skills.value === null || w.runs.value === null || w.skills.sample < POPULATION_MINIMUM.pitcher) return null;
    const p = pops[usage];
    return PITCHER_RESULTS_MIX.skills * (percentileAmong(p.sk, w.skills.value, false) as number) + PITCHER_RESULTS_MIX.runs * (percentileAmong(p.ru, w.runs.value, false) as number);
  };
  const rows = db.prepare(`SELECT player_id id, team_id team, SUM(g) g, SUM(gs) gs FROM players_career_pitching_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year = ? GROUP BY 1, 2`).all(level, leagueId, t) as Array<{ id: number; team: number; g: number; gs: number }>;
  const byTeam = new Map<number, typeof rows>();
  for (const r of rows) byTeam.set(r.team, [...(byTeam.get(r.team) ?? []), r]);
  for (const list of byTeam.values()) {
    for (const r of [...list].filter((x) => x.gs >= 8).sort((a, c) => c.gs - a.gs).slice(0, 5)) { const v = lens(r.id, 'starter'); if (v !== null) holders.push({ role: STARTER_KEY, value: v }); }
    for (const r of list.filter((x) => x.g >= 20 && x.gs <= 0.2 * x.g)) { const v = lens(r.id, 'reliever'); if (v !== null) holders.push({ role: HISTORY_RELIEVER_POOL, value: v }); }
  }
  return { season: t, holders };
}

/** The league's last completed full seasons on the results lens: enough for the history check's origins and the season after each. */
export function resultsLensHistory(leagueId: number, through: number | null): { seasons: ResultsLensSeason[]; skipped: Array<{ season: number; reason: string }> } {
  if (through === null) return { seasons: [], skipped: [] };
  const policy = ROSTER_REVIEW_FIT_POLICY.standards;
  const full = fullSeasons(leagueId, through, policy.history.minShare);
  const out: ResultsLensSeason[] = [];
  const considered = full.seasons.slice(-(policy.history.maxOrigins + 2));
  // Only the short seasons inside the span read are named (the league's whole history is not the check's)
  const skipped = full.skipped.filter((x) => considered.length > 0 && x.season >= considered[0]);
  for (const t of considered) {
    const s = resultsLensSeason(leagueId, t);
    if ('skip' in s) skipped.push({ season: t, reason: s.skip });
    else if (s.holders.length === 0) skipped.push({ season: t, reason: 'no holders could be read from its lines' });
    else out.push(s);
  }
  return { seasons: out, skipped: skipped.sort((a, b) => a.season - b.season) };
}

// ── aging ────────────────────────────────────────────────────────────────────

/** Consecutive full seasons of the league's own major-league lines, 300+ PA or BF in both, league-relative, with each player's age. */
export function agingInput(leagueId: number, through: number): AgingInput {
  const policy = ROSTER_REVIEW_FIT_POLICY.aging;
  const { seasons, skipped } = fullSeasons(leagueId, through, policy.minShare);
  const full = new Set(seasons);
  const from = through - policy.windowSeasons - policy.maxOrigins - policy.originStart - 1;
  const level = levelOf(leagueId);
  const born = new Map<number, number>();
  if (has('players', ['player_id', 'date_of_birth'])) {
    for (const r of db.prepare(`SELECT player_id, date_of_birth d FROM players`).all() as Array<{ player_id: number; d: unknown }>) {
      const m = typeof r.d === 'string' ? /^(\d{4})/.exec(r.d) : null;
      if (m) born.set(r.player_id, Number(m[1]));
    }
  }
  const env = new Map<number, { woba: number; fipRaw: number }>();
  for (let y = from; y <= through; y += 1) { const b = leagueBaseline(leagueId, y, level); if (b.lgWOBA > 0) env.set(y, { woba: b.lgWOBA, fipRaw: b.lgFIPRaw }); }
  const pairs = (rows: Array<{ id: number; year: number; n: number; v: number | null }>): AgingPair[] => {
    const by = new Map(rows.map((r) => [`${r.id}:${r.year}`, r]));
    const out: AgingPair[] = [];
    for (const a of rows) {
      const b = by.get(`${a.id}:${a.year + 1}`);
      const birth = born.get(a.id);
      if (!b || birth === undefined || a.v === null || b.v === null || a.n < policy.minSample || b.n < policy.minSample || !full.has(a.year) || !full.has(b.year)) continue;
      out.push({ playerId: a.id, season: a.year, age: a.year - birth, change: b.v - a.v, weight: (a.n * b.n) / (a.n + b.n) });
    }
    return out;
  };
  const hitters: Array<{ id: number; year: number; n: number; v: number | null }> = [];
  if (has('players_career_batting_stats', ['player_id', 'year', 'pa', 'ab', 'h', 'level_id', 'league_id', 'split_id'])) {
    const rows = db.prepare(`SELECT player_id id, year, SUM(pa) pa, SUM(ab) ab, SUM(h) h, SUM(d) d, SUM(t) t, SUM(hr) hr, SUM(bb) bb, SUM(ibb) ibb, SUM(hp) hp, SUM(sf) sf
      FROM players_career_batting_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year BETWEEN ? AND ? GROUP BY player_id, year`).all(level, leagueId, from, through) as Array<Record<string, number>>;
    for (const r of rows) {
      const e = env.get(r.year);
      const w = wobaOf(r as never);
      hitters.push({ id: r.id, year: r.year, n: r.pa, v: e && w !== null ? w - e.woba : null });
    }
  }
  const pitchers: Array<{ id: number; year: number; n: number; v: number | null }> = [];
  if (has('players_career_pitching_stats', ['player_id', 'year', 'bf', 'outs', 'hra', 'bb', 'k', 'level_id', 'league_id', 'split_id'])) {
    const rows = db.prepare(`SELECT player_id id, year, SUM(bf) bf, SUM(outs) outs, SUM(hra) hra, SUM(bb) bb, SUM(hp) hp, SUM(k) k
      FROM players_career_pitching_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year BETWEEN ? AND ? GROUP BY player_id, year`).all(level, leagueId, from, through) as Array<Record<string, number>>;
    for (const r of rows) {
      const e = env.get(r.year);
      const fip = r.outs > 0 && e ? (13 * r.hra + 3 * (r.bb + (r.hp ?? 0)) - 2 * r.k) / (r.outs / 3) - e.fipRaw : null;
      pitchers.push({ id: r.id, year: r.year, n: r.bf, v: fip });
    }
  }
  return { hitter: pairs(hitters), pitcher: pairs(pitchers), seasons, skipped };
}

// ── defense ──────────────────────────────────────────────────────────────────

/**
 * The completed seasons whose fielding rows carry zone-rating runs at positions 3 to 9 (a season the export leaves at zero has none),
 * each with its regulars' batting runs per 600 PA and fielding runs per 1,300 innings at their main position. Results only.
 */
export function defenseSeasons(leagueId: number, through: number): DefenseSeason[] {
  if (!has('players_career_fielding_stats', ['player_id', 'year', 'position', 'ip', 'zr', 'level_id', 'league_id'])) return [];
  const level = levelOf(leagueId);
  const framing = new Set(tableColumns('players_career_fielding_stats')).has('framing') ? 'SUM(framing)' : '0';
  const years = (db.prepare(`SELECT year FROM players_career_fielding_stats WHERE level_id = ? AND league_id = ? AND year <= ? AND position BETWEEN 3 AND 9
    GROUP BY year HAVING SUM(ABS(zr)) > 0 ORDER BY year`).all(level, leagueId, through) as Array<{ year: number }>).map((r) => r.year);
  const out: DefenseSeason[] = [];
  for (const year of years) {
    // The season's own wOBA scale (`leagueBaseline`, derived from its totals; the labelled fallback where they cannot give one)
    const base = leagueBaseline(leagueId, year, level);
    const lgWoba = base.lgWOBA;
    const scale = base.wobaScale.value;
    const fielding = db.prepare(`SELECT player_id id, position pos, SUM(ip) ip, SUM(zr) zr, ${framing} fr FROM players_career_fielding_stats
      WHERE level_id = ? AND league_id = ? AND year = ? AND position BETWEEN 2 AND 9 GROUP BY 1, 2`).all(level, leagueId, year) as Array<{ id: number; pos: number; ip: number; zr: number; fr: number }>;
    const main = new Map<number, { pos: number; ip: number; runs: number }>();
    for (const r of fielding) {
      const cur = main.get(r.id);
      if (!cur || r.ip > cur.ip) main.set(r.id, { pos: r.pos, ip: r.ip, runs: r.zr + (r.pos === 2 ? r.fr : 0) });
    }
    const bat = db.prepare(`SELECT player_id id, SUM(pa) pa, SUM(ab) ab, SUM(h) h, SUM(d) d, SUM(t) t, SUM(hr) hr, SUM(bb) bb, SUM(ibb) ibb, SUM(hp) hp, SUM(sf) sf
      FROM players_career_batting_stats WHERE level_id = ? AND split_id = 1 AND league_id = ? AND year = ? GROUP BY 1`).all(level, leagueId, year) as Array<Record<string, number>>;
    const lines: DefenseSeason['lines'] = [];
    for (const r of bat) {
      const m = main.get(r.id);
      const w = wobaOf(r as never);
      if (!m || w === null || r.pa <= 0 || m.ip <= 0 || lgWoba <= 0) continue;
      lines.push({ playerId: r.id, position: m.pos, pa: r.pa, batRuns600: ((w - lgWoba) / scale) * 600, innings: m.ip, fieldRuns1300: (m.runs / m.ip) * 1300 });
    }
    out.push({ season: year, lines });
  }
  return out;
}

// ── registration ─────────────────────────────────────────────────────────────

const need = (b: CalibrationBasis) => b.throughSeason;

registerCalibration({
  subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'standards', method: STANDARDS_METHOD, trigger: 'each_import',
  compute: (b) => {
    const history = resultsLensHistory(b.leagueId, b.throughSeason);
    return measureStandards(standardsSample(b.leagueId), history.seasons, b, undefined, undefined, history.skipped);
  },
});

registerCalibration({
  subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'aging', method: AGING_METHOD, trigger: 'completed_season',
  compute: (b) => (need(b) === null ? { skip: 'No completed season.' } : fitAging(agingInput(b.leagueId, b.throughSeason as number), b)),
});

registerCalibration({
  subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'defense', method: DEFENSE_METHOD, trigger: 'completed_season',
  compute: (b) => (need(b) === null ? { skip: 'No completed season.' } : fitDefense(defenseSeasons(b.leagueId, b.throughSeason as number), b)),
});

/** Loaded for its registrations; the worker and the harness import it. */
export const MLB_CALIBRATION_REGISTERED = true;
