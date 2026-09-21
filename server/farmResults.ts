/**
 * What a minor leaguer's season line actually says, read against the league he plays in.
 *
 * The farm v1 model compared a player's OPS with the unweighted mean of every player rate at his
 * LEVEL, pooling leagues, with no park adjustment. Measured on the real import that put the two
 * Arizona A-ball affiliates 43 OPS points apart on the same baseline, penalising one and
 * flattering the other by roughly a quarter of the model's "strong promotion" band, and left the
 * entire Rookie-level offensive baseline resting on two players of a league Arizona does not field
 * a club in (docs/MINOR_LEAGUE_OPERATIONS.md F-1-farm).
 *
 * A league is the peer group. Within it a line is park-adjusted, expressed relative to that
 * league's own environment, and carried with the sample behind it and the reliability that sample
 * supports. Nothing here judges a player: it says what his results are and how far they can be
 * trusted. Statistics are objective save facts (D-002) and are read directly; nothing in this file
 * touches a rating.
 */

import { db, tableColumns, tableExists } from './db.js';
import { LEAGUE_POPULATION_MINIMUM, MATURE_SAMPLE, MINIMUM_SAMPLE } from './farmCalibration.js';
import {
  PARK_WOBA_SHARE,
  hitterRates,
  percentileAmong,
  pitcherRates,
  reliability,
  wobaOf,
  type BattingLine,
  type PitchingLine,
} from './resultsMetrics.js';
import { leagueBaseline } from './stats.js';

export type FarmPlayerKind = 'hitter' | 'pitcher';

/** Why a line could not be read as evidence. Unknown stays unknown: none of these is a bad result. */
export type UnassessableReason =
  | 'no_line_at_this_level'
  | 'sample_below_minimum'
  | 'club_has_barely_played'
  | 'league_population_too_small'
  | 'league_environment_unavailable';

export interface FarmSample {
  /** Plate appearances for a hitter, innings for a pitcher. */
  opportunities: number;
  /** Games the player's club has played, so a thin line can be told from a thin season. */
  clubGames: number;
  /** n / (n + k): how far the line can be trusted on its own. */
  reliability: number;
  /** At or above the level at which the current-level line is treated as mature. */
  mature: boolean;
}

export interface FarmProduction {
  playerId: number;
  kind: FarmPlayerKind;

  /** The club, level and league the line was produced in. */
  teamId: number;
  level: number;
  leagueId: number;
  leagueName: string;

  /** Park-adjusted, league-relative. Hitters: wOBA above the league's. Pitchers: runs per nine below the league's. */
  aboveLeague: number | null;

  /** Percentile among the league's own qualified players of his kind. null when the population is too small. */
  percentile: number | null;

  /** The rates themselves, for display. */
  rates: {
    woba: number | null;
    ops: number | null;
    era: number | null;
    /** FIP-style peripherals per nine, on the same scale as ERA. */
    peripherals: number | null;
    strikeoutRate: number | null;
    walkRate: number | null;
  };

  /** The league's own environment, as context. */
  leagueContext: { woba: number; era: number };

  sample: FarmSample;

  /** Present only when `aboveLeague` is null; names why, never a value. */
  unassessable: UnassessableReason | null;

  /**
   * The same reason in plain words, so no consumer has to know the codes and no view can print one.
   * A reader seeing `sample_below_minimum` in a table is the code leaking through the product.
   */
  unassessableDetail: string | null;
}

/* ── the league's own population, for percentiles ─────────────────────────────────────────────── */

interface LeaguePopulation {
  hitters: number[];
  pitchers: number[];
}

const populationCache = new Map<string, LeaguePopulation>();

/** Cleared whenever a fresh export is imported. */
export function clearFarmResultsCaches(): void {
  populationCache.clear();
  lineCache.clear();
  clubGamesCache.clear();
}

function batColumns(): Set<string> {
  return new Set(tableColumns('players_career_batting_stats'));
}

function pitColumns(): Set<string> {
  return new Set(tableColumns('players_career_pitching_stats'));
}

/*
 * Schema tolerance (D-007). An export that lacks one of these columns loses the production reading —
 * and then every assignment is honestly `not_assessable` — rather than failing the whole response.
 */
const BATTING_REQUIRED = ['player_id', 'team_id', 'year', 'split_id', 'level_id', 'league_id', 'pa', 'ab', 'h', 'd', 't', 'hr', 'bb', 'hp', 'sf'];
const PITCHING_REQUIRED = ['player_id', 'team_id', 'year', 'split_id', 'level_id', 'league_id', 'outs', 'er', 'bb', 'k', 'bf'];

const hasBattingShape = (): boolean => {
  const c = batColumns();
  return BATTING_REQUIRED.every((column) => c.has(column));
};

const hasPitchingShape = (): boolean => {
  const c = pitColumns();
  return PITCHING_REQUIRED.every((column) => c.has(column));
};

/**
 * Every qualified line in one league and level this season, park-adjusted and expressed against
 * that league's own environment. This is the peer group: one league, one level, one season.
 */
function leaguePopulation(leagueId: number, level: number, year: number): LeaguePopulation {
  const key = `${leagueId}:${level}:${year}`;
  const hit = populationCache.get(key);
  if (hit) return hit;

  const base = leagueBaseline(leagueId, year, level);
  const out: LeaguePopulation = { hitters: [], pitchers: [] };

  if (tableExists('players_career_batting_stats') && hasBattingShape()) {
    const c = batColumns();
    const col = (name: string) => (c.has(name) ? `SUM(s.${name})` : '0');
    const rows = db
      .prepare(
        `SELECT s.player_id, s.team_id, SUM(s.pa) AS pa, SUM(s.ab) AS ab, SUM(s.h) AS h,
                SUM(s.d) AS d, SUM(s.t) AS t, SUM(s.hr) AS hr, SUM(s.bb) AS bb,
                ${col('ibb')} AS ibb, SUM(s.hp) AS hp, SUM(s.sf) AS sf
         FROM players_career_batting_stats s
         WHERE s.year = ? AND s.split_id = 1 AND s.level_id = ? AND s.league_id = ?
         GROUP BY s.player_id
         HAVING SUM(s.pa) >= ?`
      )
      .all(year, level, leagueId, MINIMUM_SAMPLE.pa) as Array<Record<string, number>>;
    for (const r of rows) {
      const woba = wobaOf(r as unknown as BattingLine);
      if (woba === null) continue;
      out.hitters.push(parkAdjustedWoba(woba, base, r.team_id) - base.lgWOBA);
    }
  }

  if (tableExists('players_career_pitching_stats') && hasPitchingShape()) {
    const c = pitColumns();
    const col = (name: string) => (c.has(name) ? `SUM(s.${name})` : '0');
    const rows = db
      .prepare(
        `SELECT s.player_id, s.team_id, SUM(s.outs) AS outs, SUM(s.er) AS er, SUM(s.bb) AS bb,
                SUM(s.k) AS k, SUM(s.bf) AS bf, ${col('hra')} AS hra, ${col('hp')} AS hp
         FROM players_career_pitching_stats s
         WHERE s.year = ? AND s.split_id = 1 AND s.level_id = ? AND s.league_id = ?
         GROUP BY s.player_id
         HAVING SUM(s.outs) >= ?`
      )
      .all(year, level, leagueId, MINIMUM_SAMPLE.ip * 3) as Array<Record<string, number>>;
    for (const r of rows) {
      const innings = (r.outs ?? 0) / 3;
      if (innings <= 0) continue;
      const fip = (13 * (r.hra ?? 0) + 3 * ((r.bb ?? 0) + (r.hp ?? 0)) - 2 * (r.k ?? 0)) / innings;
      const park = base.parkFactor.get(r.team_id) ?? 1;
      /* Lower is better, so the sign is flipped: how far BELOW the league's own peripherals he is. */
      out.pitchers.push(base.lgFIPRaw - fip / (park || 1));
    }
  }

  populationCache.set(key, out);
  return out;
}

/**
 * A park factor above one means the park inflates run scoring, so the same wOBA in it is worth
 * less. The share of a run factor that reaches wOBA is the MLB model's provisional 0.5.
 */
function parkAdjustedWoba(woba: number, base: { parkFactor: Map<number, number> }, teamId: number): number {
  const park = base.parkFactor.get(teamId) ?? 1;
  const effect = 1 + (park - 1) * PARK_WOBA_SHARE;
  return effect === 0 ? woba : woba / effect;
}

/* ── one player's current-level line ─────────────────────────────────────────────────────────── */

interface LineRow extends Record<string, number> {
  player_id: number;
  team_id: number;
  league_id: number;
  level_id: number;
}

const lineCache = new Map<string, Map<number, LineRow>>();
const clubGamesCache = new Map<number, number>();

function clubGames(teamId: number): number {
  const hit = clubGamesCache.get(teamId);
  if (hit !== undefined) return hit;
  let games = 0;
  if (tableExists('team_record') && tableColumns('team_record').includes('g')) {
    const row = db.prepare('SELECT g FROM team_record WHERE team_id = ?').get(teamId) as { g: number | null } | undefined;
    games = Number(row?.g ?? 0);
  }
  clubGamesCache.set(teamId, games);
  return games;
}

/**
 * The line a player produced at one level and league this season, stints and clubs summed.
 *
 * Keyed by level and league, not by the club he happens to be on now: `computeProspects` learned
 * that summing a man's whole season and labelling it with his current club credits him at Triple-A
 * with what he did at Double-A. The same rule applies here, and for the same reason.
 */
function lines(kind: FarmPlayerKind, level: number, leagueId: number, year: number): Map<number, LineRow> {
  const key = `${kind}:${level}:${leagueId}:${year}`;
  const hit = lineCache.get(key);
  if (hit) return hit;

  const out = new Map<number, LineRow>();
  const table = kind === 'hitter' ? 'players_career_batting_stats' : 'players_career_pitching_stats';
  if (!tableExists(table) || !(kind === 'hitter' ? hasBattingShape() : hasPitchingShape())) {
    lineCache.set(key, out);
    return out;
  }

  const c = kind === 'hitter' ? batColumns() : pitColumns();
  const col = (name: string) => (c.has(name) ? `SUM(s.${name})` : '0');
  const fields =
    kind === 'hitter'
      ? `SUM(s.pa) AS pa, SUM(s.ab) AS ab, SUM(s.h) AS h, SUM(s.d) AS d, SUM(s.t) AS t,
         SUM(s.hr) AS hr, SUM(s.bb) AS bb, ${col('ibb')} AS ibb, SUM(s.hp) AS hp,
         SUM(s.sf) AS sf, SUM(s.k) AS k, ${col('g')} AS g`
      : `SUM(s.outs) AS outs, SUM(s.er) AS er, SUM(s.bb) AS bb, SUM(s.k) AS k, SUM(s.bf) AS bf,
         ${col('hra')} AS hra, ${col('hp')} AS hp, ${col('g')} AS g, ${col('gs')} AS gs`;

  const rows = db
    .prepare(
      `SELECT s.player_id, MIN(s.team_id) AS team_id, s.league_id, s.level_id, ${fields}
       FROM ${table} s
       WHERE s.year = ? AND s.split_id = 1 AND s.level_id = ? AND s.league_id = ?
       GROUP BY s.player_id`
    )
    .all(year, level, leagueId) as LineRow[];
  for (const r of rows) out.set(Number(r.player_id), r);

  lineCache.set(key, out);
  return out;
}

export interface FarmProductionRequest {
  playerId: number;
  kind: FarmPlayerKind;
  teamId: number;
  level: number;
  leagueId: number;
  leagueName: string;
}

/**
 * Read each player's current-level production. A player with no line, too thin a line, or a club
 * that has barely played gets `aboveLeague: null` and a stated reason — never a zero and never a
 * neutral percentile.
 */
export function farmProduction(requests: readonly FarmProductionRequest[], year: number): Map<number, FarmProduction> {
  const out = new Map<number, FarmProduction>();

  for (const req of requests) {
    const base = leagueBaseline(req.leagueId, year, req.level);
    const pop = leaguePopulation(req.leagueId, req.level, year);
    const row = lines(req.kind, req.level, req.leagueId, year).get(req.playerId);
    const games = clubGames(req.teamId);

    const blank = (reason: UnassessableReason, opportunities: number): FarmProduction => ({
      playerId: req.playerId,
      kind: req.kind,
      teamId: req.teamId,
      level: req.level,
      leagueId: req.leagueId,
      leagueName: req.leagueName,
      aboveLeague: null,
      percentile: null,
      rates: { woba: null, ops: null, era: null, peripherals: null, strikeoutRate: null, walkRate: null },
      leagueContext: { woba: base.lgWOBA, era: base.lgERA },
      sample: { opportunities, clubGames: games, reliability: 0, mature: false },
      unassessable: reason,
      unassessableDetail: unassessableText(reason, { opportunities, clubGames: games, reliability: 0, mature: false }),
    });

    if (!row) {
      out.set(req.playerId, blank('no_line_at_this_level', 0));
      continue;
    }

    if (req.kind === 'hitter') {
      const line = row as unknown as BattingLine;
      const pa = Number(row.pa ?? 0);
      if (pa < MINIMUM_SAMPLE.pa) {
        out.set(
          req.playerId,
          blank(games > 0 && games < 25 ? 'club_has_barely_played' : 'sample_below_minimum', pa)
        );
        continue;
      }
      const woba = wobaOf(line);
      if (woba === null || base.lgWOBA <= 0) {
        out.set(req.playerId, blank('league_environment_unavailable', pa));
        continue;
      }
      const adjusted = parkAdjustedWoba(woba, base, Number(row.team_id));
      const above = adjusted - base.lgWOBA;
      const rates = hitterRates(line);
      out.set(req.playerId, {
        playerId: req.playerId,
        kind: 'hitter',
        teamId: req.teamId,
        level: req.level,
        leagueId: req.leagueId,
        leagueName: req.leagueName,
        aboveLeague: above,
        percentile:
          pop.hitters.length >= LEAGUE_POPULATION_MINIMUM ? percentileAmong(pop.hitters, above, true) : null,
        rates: {
          woba: adjusted,
          ops: opsOf(line),
          era: null,
          peripherals: null,
          strikeoutRate: rates.kRate,
          walkRate: rates.bbRate,
        },
        leagueContext: { woba: base.lgWOBA, era: base.lgERA },
        sample: {
          opportunities: pa,
          clubGames: games,
          reliability: reliability(pa, MATURE_SAMPLE.pa),
          mature: pa >= MATURE_SAMPLE.pa,
        },
        unassessable: pop.hitters.length >= LEAGUE_POPULATION_MINIMUM ? null : 'league_population_too_small',
        unassessableDetail:
          pop.hitters.length >= LEAGUE_POPULATION_MINIMUM
            ? null
            : `Fewer than ${LEAGUE_POPULATION_MINIMUM} qualified players in this league, so a comparison cannot be made.`,
      });
      continue;
    }

    const line = row as unknown as PitchingLine;
    const innings = Number(row.outs ?? 0) / 3;
    if (innings < MINIMUM_SAMPLE.ip) {
      out.set(
        req.playerId,
        blank(games > 0 && games < 25 ? 'club_has_barely_played' : 'sample_below_minimum', innings)
      );
      continue;
    }
    if (base.lgERA <= 0) {
      out.set(req.playerId, blank('league_environment_unavailable', innings));
      continue;
    }
    const park = base.parkFactor.get(Number(row.team_id)) ?? 1;
    const fip = (13 * Number(row.hra ?? 0) + 3 * (Number(row.bb ?? 0) + Number(row.hp ?? 0)) - 2 * Number(row.k ?? 0)) / innings;
    const above = base.lgFIPRaw - fip / (park || 1);
    const rates = pitcherRates(line, { year, woba: base.lgWOBA, era: base.lgERA, fipRaw: base.lgFIPRaw });
    out.set(req.playerId, {
      playerId: req.playerId,
      kind: 'pitcher',
      teamId: req.teamId,
      level: req.level,
      leagueId: req.leagueId,
      leagueName: req.leagueName,
      aboveLeague: above,
      percentile:
        pop.pitchers.length >= LEAGUE_POPULATION_MINIMUM ? percentileAmong(pop.pitchers, above, true) : null,
      rates: {
        woba: null,
        ops: null,
        era: rates.era,
        peripherals: rates.fip,
        strikeoutRate: rates.kRate,
        walkRate: rates.bbRate,
      },
      leagueContext: { woba: base.lgWOBA, era: base.lgERA },
      sample: {
        opportunities: innings,
        clubGames: games,
        reliability: reliability(innings * 4.3, MATURE_SAMPLE.ip * 4.3),
        mature: innings >= MATURE_SAMPLE.ip,
      },
      unassessable: pop.pitchers.length >= LEAGUE_POPULATION_MINIMUM ? null : 'league_population_too_small',
      unassessableDetail:
        pop.pitchers.length >= LEAGUE_POPULATION_MINIMUM
          ? null
          : `Fewer than ${LEAGUE_POPULATION_MINIMUM} qualified players in this league, so a comparison cannot be made.`,
    });
  }

  return out;
}

function opsOf(l: BattingLine): number | null {
  const ab = l.ab ?? 0;
  if (!ab) return null;
  const singles = l.h - l.d - l.t - l.hr;
  const obpDen = ab + l.bb + l.hp + l.sf;
  const obp = obpDen ? (l.h + l.bb + l.hp) / obpDen : 0;
  const slg = (singles + 2 * l.d + 3 * l.t + 4 * l.hr) / ab;
  return obp + slg;
}

/** Plain words for why a line cannot be read, for the GM. */
export function unassessableText(reason: UnassessableReason, sample: FarmSample): string {
  switch (reason) {
    case 'no_line_at_this_level':
      return 'No statistics at this level this season.';
    case 'club_has_barely_played':
      return `His club has played ${sample.clubGames} games; there is not yet a season to read.`;
    case 'sample_below_minimum':
      return `${Math.round(sample.opportunities)} is below the minimum sample this evaluation requires.`;
    case 'league_population_too_small':
      return `Fewer than ${LEAGUE_POPULATION_MINIMUM} qualified players in this league, so a comparison cannot be made.`;
    case 'league_environment_unavailable':
      return 'The league\'s own run environment could not be established from the export.';
  }
}
