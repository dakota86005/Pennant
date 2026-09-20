/**
 * The database-facing reader of OBJECTIVE results: season statistics, batting
 * splits, fielding usage and handedness.
 *
 * These are facts the game recorded, not judgments about ability, so they may be
 * read directly (the ratings boundary in `scoutedEvidence.ts` is about opinions
 * of ability). Nothing here reads a rating column, `players_value`, a roster
 * flag or the transaction log. The arithmetic is in `resultsMetrics.ts`; this
 * file only fetches, groups by season (summing stints and clubs), and ranks a
 * player against the league's own population.
 *
 * Schema tolerant: OOTP's export changes shape between versions, so every
 * column that is not certain to exist is read only when present and is 0
 * otherwise. A season with no rows is absent, never zero.
 */

import { db, tableColumns, tableExists } from './db.js';
import { leagueBaseline } from './stats.js';
import {
  blendStabilization, defenseResult, percentileAmong, POPULATION_MINIMUM, reliability, RESULTS_CALIBRATION, SEASON_WEIGHTS, weightedBaserunning,
  weightedBatting, weightedPitching, wobaOf,
  type BaserunningResult, type BattingLine, type DefenseLine, type DefenseResult, type PitchingLine, type SeasonEnvironment, type WeightedResult,
} from './resultsMetrics.js';

const CHUNK = 400;
/** Seasons read: the current one and the two before it, matching the recency weights. */
const SEASONS_BACK = 2;
/** Seasons of batting splits read for platoon (current plus this many before). */
const PLATOON_SEASONS_BACK = 4;

const has = (table: string) => new Set(tableColumns(table));
const sum = (cols: Set<string>, column: string, alias = column): string =>
  cols.has(column) ? `COALESCE(SUM("${column}"), 0) AS "${alias}"` : `0 AS "${alias}"`;

/** The current season of a league, from the export; null when there is no league row. */
export function currentSeason(leagueId: number): number | null {
  if (!tableExists('leagues') || !tableColumns('leagues').includes('season_year')) return null;
  const row = db.prepare('SELECT season_year FROM leagues WHERE league_id = ?').get(leagueId) as { season_year: number | null } | undefined;
  return row?.season_year ?? null;
}

/** The major-league league id of an organization, from its top club. */
export function majorLeagueId(orgId: number): number | null {
  if (!tableExists('teams')) return null;
  const row = db.prepare('SELECT league_id FROM teams WHERE team_id = ?').get(orgId) as { league_id: number | null } | undefined;
  return row?.league_id ?? null;
}

// ── league environment ──────────────────────────────────────────────────────

const envCache = new Map<string, Map<number, SeasonEnvironment>>();
const populationCache = new Map<string, Population>();

/** Cleared with the other statistics caches whenever a fresh export is imported. */
export function clearResultsCaches(): void {
  envCache.clear();
  populationCache.clear();
  platoonEffectCache.clear();
}

export function seasonEnvironments(leagueId: number, currentYear: number): Map<number, SeasonEnvironment> {
  const key = `${leagueId}:${currentYear}`;
  const hit = envCache.get(key);
  if (hit) return hit;
  const out = new Map<number, SeasonEnvironment>();
  for (let year = currentYear - SEASONS_BACK; year <= currentYear; year += 1) {
    const b = leagueBaseline(leagueId, year, 1);
    if (b.lgWOBA > 0 || b.lgERA > 0) out.set(year, { year, woba: b.lgWOBA, fipRaw: b.lgFIPRaw, era: b.lgERA });
  }
  envCache.set(key, out);
  return out;
}

/** Run-scoring park factor by club for a season (1 is neutral, already halved for a half-home schedule). */
function parkFactorsFor(leagueId: number, year: number): Map<number, number> {
  return leagueBaseline(leagueId, year, 1).parkFactor;
}

/** Combine one player-season's stints into a line, with the park factor of the clubs he played for weighted by opportunities. */
function withPark<T extends { year: number }>(rows: Array<T & { team_id: number }>, leagueId: number, weight: (r: T) => number): T[] {
  const byYear = new Map<number, Array<T & { team_id: number }>>();
  for (const r of rows) byYear.set(r.year, [...(byYear.get(r.year) ?? []), r]);
  const out: T[] = [];
  for (const [year, stints] of byYear) {
    const parks = parkFactorsFor(leagueId, year);
    const known = stints.filter((r) => parks.has(r.team_id) && weight(r) > 0);
    const total = known.reduce((n, r) => n + weight(r), 0);
    const park = total > 0 ? known.reduce((n, r) => n + (parks.get(r.team_id) as number) * weight(r), 0) / total : undefined;
    const merged: Record<string, number | undefined> = {};
    for (const r of stints) {
      for (const [k, v] of Object.entries(r)) {
        if (k === 'team_id' || k === 'year') continue;
        merged[k] = (merged[k] ?? 0) + Number(v);
      }
    }
    out.push({ ...(merged as unknown as T), year, ...(park !== undefined ? { park } : {}) });
  }
  return out;
}

// ── raw histories ───────────────────────────────────────────────────────────

/** One line per player per season at the major-league level, summing stints and clubs; the line carries the park factor of the clubs he played for. */
export function battingHistory(playerIds: number[], leagueId: number, currentYear: number, split = 1, back = SEASONS_BACK): Map<number, BattingLine[]> {
  const out = new Map<number, BattingLine[]>();
  if (!tableExists('players_career_batting_stats') || playerIds.length === 0) return out;
  const c = has('players_career_batting_stats');
  if (!['player_id', 'year', 'level_id', 'split_id', 'pa', 'ab', 'h'].every((x) => c.has(x))) return out;
  const league = c.has('league_id') ? 'AND league_id = ?' : '';
  const team = c.has('team_id') ? 'team_id' : '0 AS team_id';
  const params = (ids: number[]) => [...ids, split, ...(league ? [leagueId] : []), currentYear - back, currentYear];
  for (let at = 0; at < playerIds.length; at += CHUNK) {
    const ids = playerIds.slice(at, at + CHUNK);
    const rows = db.prepare(
      `SELECT player_id, year, ${team}, ${sum(c, 'g')}, ${sum(c, 'gs')}, ${sum(c, 'pa')}, ${sum(c, 'ab')}, ${sum(c, 'h')}, ${sum(c, 'd')}, ${sum(c, 't')},
              ${sum(c, 'hr')}, ${sum(c, 'bb')}, ${sum(c, 'ibb')}, ${sum(c, 'hp')}, ${sum(c, 'sf')}, ${sum(c, 'k')}, ${sum(c, 'sb')},
              ${sum(c, 'cs')}, ${sum(c, 'gdp')}, ${sum(c, 'war')}, ${sum(c, 'ubr')}
       FROM players_career_batting_stats
       WHERE player_id IN (${ids.map(() => '?').join(',')}) AND level_id = 1 AND split_id = ? ${league} AND year BETWEEN ? AND ?
       GROUP BY player_id, year, team_id`
    ).all(...params(ids)) as Array<BattingLine & { player_id: number; team_id: number }>;
    const byPlayer = new Map<number, Array<BattingLine & { player_id: number; team_id: number }>>();
    for (const r of rows) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
    for (const [id, list] of byPlayer) {
      out.set(id, withPark(list.map((r) => { const { player_id: _p, ...l } = r as typeof r & { player_id: number }; return l as BattingLine & { team_id: number }; }), leagueId, (l) => l.pa));
    }
  }
  return out;
}

export function pitchingHistory(playerIds: number[], leagueId: number, currentYear: number): Map<number, PitchingLine[]> {
  const out = new Map<number, PitchingLine[]>();
  if (!tableExists('players_career_pitching_stats') || playerIds.length === 0) return out;
  const c = has('players_career_pitching_stats');
  if (!['player_id', 'year', 'level_id', 'split_id', 'outs', 'er'].every((x) => c.has(x))) return out;
  const league = c.has('league_id') ? 'AND league_id = ?' : '';
  const team = c.has('team_id') ? 'team_id' : '0 AS team_id';
  for (let at = 0; at < playerIds.length; at += CHUNK) {
    const ids = playerIds.slice(at, at + CHUNK);
    const rows = db.prepare(
      `SELECT player_id, year, ${team}, ${sum(c, 'g')}, ${sum(c, 'gs')}, ${sum(c, 'gf')}, ${sum(c, 'outs')}, ${sum(c, 'bf')}, ${sum(c, 'er')},
              ${sum(c, 'r')}, ${sum(c, 'ha')}, ${sum(c, 'hra')}, ${sum(c, 'bb')}, ${sum(c, 'hp')}, ${sum(c, 'k')}, ${sum(c, 's', 'sv')},
              ${sum(c, 'hld')}, ${sum(c, 'war')}, ${sum(c, 'li')}
       FROM players_career_pitching_stats
       WHERE player_id IN (${ids.map(() => '?').join(',')}) AND level_id = 1 AND split_id = 1 ${league} AND year BETWEEN ? AND ?
       GROUP BY player_id, year, team_id`
    ).all(...ids, ...(league ? [leagueId] : []), currentYear - SEASONS_BACK, currentYear) as Array<PitchingLine & { player_id: number; team_id: number }>;
    const byPlayer = new Map<number, Array<PitchingLine & { player_id: number; team_id: number }>>();
    for (const r of rows) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
    for (const [id, list] of byPlayer) {
      out.set(id, withPark(list.map((r) => { const { player_id: _p, ...l } = r as typeof r & { player_id: number }; return l as PitchingLine & { team_id: number }; }), leagueId, (l) => l.bf));
    }
  }
  return out;
}

export type Hand = 'R' | 'L' | 'S';
const HAND: Record<number, Hand> = { 1: 'R', 2: 'L', 3: 'S' };

export interface Handedness { bats: Hand | null; throws: 'R' | 'L' | null }

/** Who bats and throws which way: objective facts about the player. */
export function handedness(playerIds: number[]): Map<number, Handedness> {
  const out = new Map<number, Handedness>();
  if (!tableExists('players') || playerIds.length === 0 || !has('players').has('bats')) return out;
  for (let at = 0; at < playerIds.length; at += CHUNK) {
    const ids = playerIds.slice(at, at + CHUNK);
    const rows = db.prepare(`SELECT player_id, bats, throws FROM players WHERE player_id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ player_id: number; bats: number | null; throws: number | null }>;
    for (const r of rows) out.set(r.player_id, { bats: HAND[Number(r.bats)] ?? null, throws: r.throws === 1 ? 'R' : r.throws === 2 ? 'L' : null });
  }
  return out;
}

// ── population: the league's own players, for percentiles ───────────────────

interface Population {
  hitters: number[];
  /** Baserunning runs per 600 PA among hitters with a sample, ascending order not guaranteed. */
  baserunning: number[];
  /** Zone-rating runs per 1300 innings at each position among fielders with a sample this season. */
  defense: Record<number, number[]>;
  /** FIP-style peripherals relative to the league (runs, lower is better) among pitchers used as starters and as relievers. */
  starterSkills: number[]; starterRuns: number[];
  relieverSkills: number[]; relieverRuns: number[];
  /** Innings per start among qualified starters, ascending. */
  inningsPerStart: number[];
}

/** Fewest innings at a position, this season, before a fielder's zone-rating rate joins the peer population. */
const DEFENSE_POPULATION_MINIMUM = 150;

function population(leagueId: number, currentYear: number): Population {
  const key = `${leagueId}:${currentYear}`;
  const hit = populationCache.get(key);
  if (hit) return hit;
  const env = seasonEnvironments(leagueId, currentYear);
  const pop: Population = { hitters: [], baserunning: [], defense: {}, starterSkills: [], starterRuns: [], relieverSkills: [], relieverRuns: [], inningsPerStart: [] };
  const ids = (table: string): number[] => {
    if (!tableExists(table) || !has(table).has('level_id')) return [];
    const league = has(table).has('league_id') ? 'AND league_id = ?' : '';
    return (db.prepare(`SELECT DISTINCT player_id FROM ${table} WHERE level_id = 1 AND split_id = 1 ${league} AND year BETWEEN ? AND ?`)
      .all(...(league ? [leagueId] : []), currentYear - SEASONS_BACK, currentYear) as Array<{ player_id: number }>).map((r) => r.player_id);
  };
  const batterIds = ids('players_career_batting_stats');
  const batters = battingHistory(batterIds, leagueId, currentYear);
  for (const lines of batters.values()) {
    const w = weightedBatting(lines, env, currentYear);
    if (w.value !== null && w.sample >= POPULATION_MINIMUM.hitter) pop.hitters.push(w.value);
    const run = weightedBaserunning(lines, currentYear);
    if (run.perSixHundred !== null && run.sample >= POPULATION_MINIMUM.hitter) pop.baserunning.push(run.perSixHundred);
  }
  for (const rows of fieldingResultLines(batterIds, leagueId, currentYear).values()) {
    for (const position of new Set(rows.map((r) => r.position))) {
      const d = defenseResult(rows, position);
      if (d.per1300 !== null && d.innings >= DEFENSE_POPULATION_MINIMUM) (pop.defense[position] ??= []).push(d.per1300);
    }
  }
  const pitchers = pitchingHistory(ids('players_career_pitching_stats'), leagueId, currentYear);
  for (const lines of pitchers.values()) {
    const g = lines.reduce((n, l) => n + l.g, 0);
    const gs = lines.reduce((n, l) => n + l.gs, 0);
    const starter = g > 0 && gs / g >= 0.5;
    const w = weightedPitching(lines, env, currentYear, starter ? SEASON_WEIGHTS.starter : SEASON_WEIGHTS.reliever);
    if (w.skills.value === null || w.runs.value === null || w.skills.sample < POPULATION_MINIMUM.pitcher) continue;
    if (starter) {
      pop.starterSkills.push(w.skills.value); pop.starterRuns.push(w.runs.value);
      const outs = lines.reduce((n, l) => n + l.outs, 0);
      if (gs > 0) pop.inningsPerStart.push(outs / 3 / gs);
    } else { pop.relieverSkills.push(w.skills.value); pop.relieverRuns.push(w.runs.value); }
  }
  pop.inningsPerStart.sort((a, b) => a - b);
  populationCache.set(key, pop);
  return pop;
}

// ── the answers callers use ─────────────────────────────────────────────────

export interface PitcherResults {
  playerId: number;
  usage: 'starter' | 'reliever';
  seasons: PitchingLine[];
  /** This season's line, when he has one. */
  current: PitchingLine | null;
  skills: WeightedResult;
  runs: WeightedResult;
  /** Percentile among the league's pitchers used the same way; higher is better. Null without a qualifying sample. */
  skillsPercentile: number | null;
  runsPercentile: number | null;
  /** Effective sample (batters faced) behind the multi-season read, and how far to trust it against his tools. */
  sample: number;
  reliability: number;
  /** Innings per start across the weighted seasons, for a starter. */
  inningsPerStart: number | null;
  /** Average leverage per batter faced this season (1.0 is neutral); null when the export carries none. */
  leverage: number | null;
  calibration: typeof RESULTS_CALIBRATION;
}

export function loadPitcherResults(playerIds: number[], leagueId: number, usage: 'starter' | 'reliever'): Map<number, PitcherResults> {
  const out = new Map<number, PitcherResults>();
  const year = currentSeason(leagueId);
  if (year === null) return out;
  const env = seasonEnvironments(leagueId, year);
  const pop = population(leagueId, year);
  const skillsPop = usage === 'starter' ? pop.starterSkills : pop.relieverSkills;
  const runsPop = usage === 'starter' ? pop.starterRuns : pop.relieverRuns;
  for (const [id, lines] of pitchingHistory(playerIds, leagueId, year)) {
    const w = weightedPitching(lines, env, year, SEASON_WEIGHTS[usage]);
    const current = lines.find((l) => l.year === year) ?? null;
    const gs = lines.reduce((n, l) => n + l.gs, 0);
    const outs = lines.reduce((n, l) => n + l.outs, 0);
    out.set(id, {
      playerId: id, usage, seasons: [...lines].sort((a, b) => b.year - a.year), current, skills: w.skills, runs: w.runs,
      skillsPercentile: w.skills.value !== null && w.skills.sample >= POPULATION_MINIMUM.pitcher ? percentileAmong(skillsPop, w.skills.value, false) : null,
      runsPercentile: w.runs.value !== null && w.runs.sample >= POPULATION_MINIMUM.pitcher ? percentileAmong(runsPop, w.runs.value, false) : null,
      sample: w.skills.sample, reliability: reliability(w.skills.sample, blendStabilization(usage)),
      inningsPerStart: gs > 0 ? outs / 3 / gs : null,
      leverage: current && current.bf > 0 && current.li > 0 ? current.li / current.bf : null,
      calibration: RESULTS_CALIBRATION,
    });
  }
  return out;
}

export interface HitterResults {
  playerId: number;
  seasons: BattingLine[];
  current: BattingLine | null;
  /** wOBA above (positive) or below the league's, park adjusted and recency weighted. */
  woba: WeightedResult;
  /** Percentile among the league's hitters; higher is better. */
  percentile: number | null;
  sample: number;
  /** How far to trust the batting results against his tools (0 to 1). */
  reliability: number;
  /** Baserunning runs per 600 PA (UBR and stolen-base runs), recency weighted, and where that ranks among hitters. */
  baserunning: BaserunningResult & { percentile: number | null };
  calibration: typeof RESULTS_CALIBRATION;
}

export function loadHitterResults(playerIds: number[], leagueId: number): Map<number, HitterResults> {
  const out = new Map<number, HitterResults>();
  const year = currentSeason(leagueId);
  if (year === null) return out;
  const env = seasonEnvironments(leagueId, year);
  const pop = population(leagueId, year);
  for (const [id, lines] of battingHistory(playerIds, leagueId, year)) {
    const w = weightedBatting(lines, env, year);
    const run = weightedBaserunning(lines, year);
    out.set(id, {
      playerId: id, seasons: [...lines].sort((a, b) => b.year - a.year), current: lines.find((l) => l.year === year) ?? null, woba: w,
      percentile: w.value !== null && w.sample >= POPULATION_MINIMUM.hitter ? percentileAmong(pop.hitters, w.value, true) : null,
      sample: w.sample, reliability: reliability(w.sample, blendStabilization('hitter')),
      baserunning: { ...run, percentile: run.perSixHundred !== null && run.sample >= POPULATION_MINIMUM.hitter ? percentileAmong(pop.baserunning, run.perSixHundred, true) : null },
      calibration: RESULTS_CALIBRATION,
    });
  }
  return out;
}

export interface HitterDefenseResults extends DefenseResult {
  playerId: number;
  position: number;
  /** Percentile of his runs-per-1300 among fielders at the position this season; null without a sample. */
  percentile: number | null;
}

/**
 * Defensive results at one position: zone-rating runs (plus framing for a catcher) per 1300 innings, ranked among
 * the league's fielders there. The export carries zone rating for the current season (and catchers' history), so the
 * sample is short and the reliability low; that is stated by `reliability`, not hidden.
 */
export function loadDefenseResults(playerIds: number[], leagueId: number, position: number): Map<number, HitterDefenseResults> {
  const out = new Map<number, HitterDefenseResults>();
  const year = currentSeason(leagueId);
  if (year === null || position < 2 || position > 9) return out;
  const peers = population(leagueId, year).defense[position] ?? [];
  for (const [id, lines] of fieldingResultLines(playerIds, leagueId, year)) {
    const d = defenseResult(lines, position);
    out.set(id, { ...d, playerId: id, position, percentile: d.per1300 !== null && d.innings >= DEFENSE_POPULATION_MINIMUM && peers.length > 0 ? percentileAmong(peers, d.per1300, true) : null });
  }
  return out;
}

// ── usage and splits (hitters) ──────────────────────────────────────────────

export interface FieldingUsage {
  year: number;
  position: number;
  g: number;
  gs: number;
  ip: number;
  errors: number;
}

/** Where each player has played, by season and position, at the major-league level. Fielding history carries no reliable split, so every row counts. */
export function fieldingUsage(playerIds: number[], leagueId: number, currentYear: number): Map<number, FieldingUsage[]> {
  const out = new Map<number, FieldingUsage[]>();
  if (!tableExists('players_career_fielding_stats') || playerIds.length === 0) return out;
  const c = has('players_career_fielding_stats');
  if (!['player_id', 'year', 'level_id', 'position'].every((x) => c.has(x))) return out;
  const league = c.has('league_id') ? 'AND league_id = ?' : '';
  for (let at = 0; at < playerIds.length; at += CHUNK) {
    const ids = playerIds.slice(at, at + CHUNK);
    const rows = db.prepare(
      `SELECT player_id, year, position, ${sum(c, 'g')}, ${sum(c, 'gs')}, ${sum(c, 'ip')}, ${sum(c, 'e', 'errors')}
       FROM players_career_fielding_stats
       WHERE player_id IN (${ids.map(() => '?').join(',')}) AND level_id = 1 ${league} AND year BETWEEN ? AND ?
       GROUP BY player_id, year, position`
    ).all(...ids, ...(league ? [leagueId] : []), currentYear - SEASONS_BACK, currentYear) as Array<FieldingUsage & { player_id: number }>;
    for (const r of rows) {
      const { player_id, ...u } = r;
      out.set(player_id, [...(out.get(player_id) ?? []), u]);
    }
  }
  return out;
}

/**
 * Fielding lines that carry a defensive result: zone-rating runs or framing. A season whose export has neither (older
 * seasons mostly do not) is left out rather than read as zero, so a missing measure is never a measured average.
 */
function fieldingResultLines(playerIds: number[], leagueId: number, currentYear: number): Map<number, DefenseLine[]> {
  const out = new Map<number, DefenseLine[]>();
  if (!tableExists('players_career_fielding_stats') || playerIds.length === 0) return out;
  const c = has('players_career_fielding_stats');
  if (!['player_id', 'year', 'level_id', 'position', 'ip', 'zr'].every((x) => c.has(x))) return out;
  const league = c.has('league_id') ? 'AND league_id = ?' : '';
  for (let at = 0; at < playerIds.length; at += CHUNK) {
    const ids = playerIds.slice(at, at + CHUNK);
    const rows = db.prepare(
      `SELECT player_id, year, position, ${sum(c, 'ip')}, ${sum(c, 'zr')}, ${sum(c, 'framing')}
       FROM players_career_fielding_stats
       WHERE player_id IN (${ids.map(() => '?').join(',')}) AND level_id = 1 ${league} AND year BETWEEN ? AND ?
       GROUP BY player_id, year, position`
    ).all(...ids, ...(league ? [leagueId] : []), currentYear - SEASONS_BACK, currentYear) as Array<DefenseLine & { player_id: number }>;
    for (const r of rows) {
      if (r.zr === 0 && r.framing === 0) continue;
      const { player_id, ...line } = r;
      out.set(player_id, [...(out.get(player_id) ?? []), line]);
    }
  }
  return out;
}

export interface PlatoonSplits {
  /** Batting lines against left-handed pitching, one per season. */
  vsLeft: BattingLine[];
  /** Batting lines against right-handed pitching, one per season. */
  vsRight: BattingLine[];
}

/** Observed splits against left- and right-handed pitching (batting `split_id` 2 and 3), the last three seasons. */
export function platoonSplits(playerIds: number[], leagueId: number): Map<number, PlatoonSplits> {
  const out = new Map<number, PlatoonSplits>();
  const year = currentSeason(leagueId);
  if (year === null) return out;
  // Platoon skill is a career trait and the samples are thin, so splits look five seasons back (equal weight).
  const left = battingHistory(playerIds, leagueId, year, 2, PLATOON_SEASONS_BACK);
  const right = battingHistory(playerIds, leagueId, year, 3, PLATOON_SEASONS_BACK);
  for (const id of new Set([...left.keys(), ...right.keys()])) out.set(id, { vsLeft: left.get(id) ?? [], vsRight: right.get(id) ?? [] });
  return out;
}

export interface LeaguePlatoon {
  /** How much better (wOBA) each batter hand hits right-handers than left-handers (vs R minus vs L); null when unknown. */
  effect: { L: number | null; R: number | null; S: number | null };
  /** The share of each batter hand's plate appearances that come against left-handed pitching. */
  leftShare: { L: number | null; R: number | null; S: number | null };
}

/** The league's own platoon effect by batter hand, and how often each hand faces left-handers. */
export function leaguePlatoon(leagueId: number): LeaguePlatoon {
  const key = `platoon:${leagueId}`;
  const cached = platoonEffectCache.get(key);
  if (cached) return cached;
  const result: LeaguePlatoon = { effect: { L: null, R: null, S: null }, leftShare: { L: null, R: null, S: null } };
  const year = currentSeason(leagueId);
  if (year !== null && tableExists('players') && tableExists('players_career_batting_stats') && has('players').has('bats')) {
    const c = has('players_career_batting_stats');
    if (['split_id', 'ab', 'h', 'pa'].every((x) => c.has(x))) {
      const league = c.has('league_id') ? 'AND s.league_id = ?' : '';
      const rows = db.prepare(
        `SELECT p.bats AS bats, s.split_id AS split, SUM(s.pa) AS pa, ${['ab', 'h', 'd', 't', 'hr', 'bb', 'ibb', 'hp', 'sf'].map((col) => (c.has(col) ? `SUM(s."${col}") AS ${col}` : `0 AS ${col}`)).join(', ')}
         FROM players_career_batting_stats s JOIN players p ON p.player_id = s.player_id
         WHERE s.level_id = 1 AND s.split_id IN (2, 3) ${league} AND s.year BETWEEN ? AND ?
         GROUP BY p.bats, s.split_id`
      ).all(...(league ? [leagueId] : []), year - PLATOON_SEASONS_BACK, year) as Array<{ bats: number; split: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; ibb: number; hp: number; sf: number }>;
      const woba = (r: (typeof rows)[number]) => wobaOf({ ab: r.ab, h: r.h, d: r.d, t: r.t, hr: r.hr, bb: r.bb, ibb: r.ibb, hp: r.hp, sf: r.sf });
      for (const [hand, code] of [['L', 2], ['R', 1], ['S', 3]] as const) {
        const vsL = rows.find((r) => r.bats === code && r.split === 2);
        const vsR = rows.find((r) => r.bats === code && r.split === 3);
        const a = vsL ? woba(vsL) : null;
        const b = vsR ? woba(vsR) : null;
        // Positive = better against right-handed pitching; the effect is reported as (vs R) minus (vs L).
        result.effect[hand] = a !== null && b !== null ? b - a : null;
        result.leftShare[hand] = vsL && vsR && vsL.pa + vsR.pa > 0 ? vsL.pa / (vsL.pa + vsR.pa) : null;
      }
    }
  }
  platoonEffectCache.set(key, result);
  return result;
}

/** The league's platoon effect by batter hand (wOBA against right-handers minus against left-handers). */
export function leaguePlatoonEffect(leagueId: number): LeaguePlatoon['effect'] {
  return leaguePlatoon(leagueId).effect;
}
const platoonEffectCache = new Map<string, LeaguePlatoon>();
