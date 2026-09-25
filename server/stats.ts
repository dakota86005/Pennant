import { db, tableColumns, tableExists } from './db.js';
import { provisional, type CalibrationStamp } from './calibration.js';
import { STEAL_RUNS_FALLBACK } from './resultsMetrics.js';

/**
 * League-relative statistics (OPS+, wRC+, ERA+) need a league baseline and a
 * park factor. Both are derived from the imported save rather than hardcoded,
 * so they stay correct for any league setup, run environment, or era.
 */

/** wOBA linear weights. The wOBA scale is the run conversion these same weights imply in each league-season (`wobaScaleFrom`). */
const W = { bb: 0.69, hbp: 0.72, single: 0.88, double: 1.25, triple: 1.58, hr: 2.03 };

/**
 * PROVISIONAL (the fallback only). The conventional wOBA scale, used for a league-season whose own totals cannot give one (a total
 * the export does not record, too few plate appearances). Every served scale is derived from the league-season's own totals
 * (cycle 2, D-053: a derivation of the run environment, like the league's wOBA itself).
 */
export const WOBA_SCALE_FALLBACK = 1.2;
export { STEAL_RUNS_FALLBACK };
/** POLICY. Fewest plate appearances in a league-season before its own run environment is derived. */
export const RUN_ENVIRONMENT_MIN_PA = 10000;

// The derivation itself is a mechanism (like the league's wOBA): it carries no stamp. Only the fallback does.
export const RUN_ENVIRONMENT_FALLBACK_STAMP: CalibrationStamp = provisional(
  'The conventional wOBA scale (1.2) and steal values (+0.2, -0.4), for a league-season whose totals cannot give its own.'
);

/** The totals a league-season's run environment is derived from (batting side). Absent columns are undefined, never zero. */
export interface RunTotals {
  pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; ibb?: number; hp?: number; sf?: number;
  sh?: number; sb?: number; cs?: number; gdp?: number; r: number;
}

export interface DerivedValue {
  value: number;
  basis: 'derived' | 'fallback';
  /** Why the fallback serves (null when derived). */
  reason: string | null;
}

/** Why a league-season's totals cannot give its run environment; null when they can. */
function missingTotals(x: RunTotals): string | null {
  if (!(x.pa >= RUN_ENVIRONMENT_MIN_PA)) return `fewer than ${RUN_ENVIRONMENT_MIN_PA.toLocaleString('en-US')} plate appearances`;
  // A zero league total of these is not recorded, never a true zero (D-018): no league-season has none
  for (const k of ['sf', 'cs', 'gdp', 'ibb', 'hp', 'sb'] as const) if (!(x[k] !== undefined && x[k]! > 0)) return `the export does not record ${k.toUpperCase()} for the season`;
  if (!(x.r > 0)) return 'the export does not record runs for the season';
  return null;
}

/** Outs made by the batting side: at-bats without a hit, sacrifices, caught stealing and double plays (their second out). */
const battingOuts = (x: RunTotals) => x.ab - x.h + (x.sf ?? 0) + (x.sh ?? 0) + (x.cs ?? 0) + (x.gdp ?? 0);

/**
 * The wOBA scale a league-season's own totals imply for the fixed weights `W` (BaseRuns, Smyth/Tango: A = H + BB + HBP - HR - IBB/2,
 * B = m (1.4 TB - 0.6 H - 3 HR + 0.1 (BB + HBP - IBB) + 0.9 (SB - CS - GDP)), C = AB - H + SF + CS + GDP, D = HR, with m set so the
 * formula reproduces the league's runs). Each event's run value is the formula's partial derivative; an out's value relative to average
 * is its derivative less the league's runs per out. The scale is the league's fixed-weight wOBA numerator over its run-value numerator
 * (each event less an out): the runs one point of wOBA is worth in this environment.
 */
export function wobaScaleFrom(x: RunTotals): DerivedValue {
  const missing = missingTotals(x);
  if (missing) return { value: WOBA_SCALE_FALLBACK, basis: 'fallback', reason: missing };
  const ibb = x.ibb as number;
  const hp = x.hp as number;
  const singles = x.h - x.d - x.t - x.hr;
  const tb = singles + 2 * x.d + 3 * x.t + 4 * x.hr;
  const A = x.h + x.bb + hp - x.hr - 0.5 * ibb;
  const B0 = 1.4 * tb - 0.6 * x.h - 3 * x.hr + 0.1 * (x.bb + hp - ibb) + 0.9 * ((x.sb as number) - (x.cs as number) - (x.gdp as number));
  const C = x.ab - x.h + (x.sf as number) + (x.cs as number) + (x.gdp as number);
  const RD = x.r - x.hr;
  const m = (RD * C) / (B0 * (A - RD));
  if (!Number.isFinite(m) || m < 0.5 || m > 2) return { value: WOBA_SCALE_FALLBACK, basis: 'fallback', reason: "the season's totals do not fit the run formula" };
  const B = m * B0;
  const dA = B / (B + C);
  const dB = (A * C) / (B + C) ** 2;
  const dC = -(A * B) / (B + C) ** 2;
  const outs = battingOuts(x);
  const out = dC - x.r / outs;
  const rv = {
    bb: dA + dB * m * 0.1 - out, hbp: dA + dB * m * 0.1 - out, single: dA + dB * m * 0.8 - out,
    double: dA + dB * m * 2.2 - out, triple: dA + dB * m * 3.6 - out, hr: 1 + dB * m * 2.0 - out,
  };
  const n = { bb: x.bb - ibb, hbp: hp, single: singles, double: x.d, triple: x.t, hr: x.hr };
  const keys = Object.keys(n) as Array<keyof typeof n>;
  const fixed = keys.reduce((s, k) => s + W[k] * n[k], 0);
  const runs = keys.reduce((s, k) => s + rv[k] * n[k], 0);
  const scale = fixed / runs;
  if (!Number.isFinite(scale) || scale < 0.8 || scale > 2) return { value: WOBA_SCALE_FALLBACK, basis: 'fallback', reason: "the season's totals do not fit the run formula" };
  return { value: scale, basis: 'derived', reason: null };
}

/** A caught stealing's run value from the league-season's runs per out (the standard wSB form, -(2 x R/O + 0.075)); the fallback when unknown. */
export function caughtStealingRunsFrom(x: RunTotals): DerivedValue {
  const missing = missingTotals(x);
  const outs = battingOuts(x);
  if (missing || !(outs > 0)) return { value: STEAL_RUNS_FALLBACK.cs, basis: 'fallback', reason: missing ?? 'the export does not record outs for the season' };
  return { value: -(2 * (x.r / outs) + 0.075), basis: 'derived', reason: null };
}

export interface LeagueBaseline {
  year: number;
  lgOBP: number;
  lgSLG: number;
  lgWOBA: number;
  lgRperPA: number;
  lgERA: number;
  /** League's raw FIP numerator per inning; lgERA minus this is the FIP constant. */
  lgFIPRaw: number;
  /** Runs per point of wOBA in this league-season, derived from its own totals (`wobaScaleFrom`), else the labelled fallback. */
  wobaScale: DerivedValue;
  /** A caught stealing's run value in this league-season (`caughtStealingRunsFrom`), else the labelled fallback. */
  caughtStealingRuns: DerivedValue;
  /** team_id → park run factor, already halved for a half-home schedule. */
  parkFactor: Map<number, number>;
}

const baselineCache = new Map<string, LeagueBaseline>();

/**
 * OOTP publishes per-park AVG and HR ratings. We blend them into one run-scoring
 * factor, then halve the deviation because a player only plays half his games at
 * home — the standard correction used for park-adjusted rate stats.
 */
function parkFactors(leagueId: number): Map<number, number> {
  const out = new Map<number, number>();
  if (!tableExists('parks')) return out;
  const rows = db
    .prepare(
      `SELECT t.team_id, p.avg AS avgF, p.hr AS hrF
       FROM teams t JOIN parks p ON p.park_id = t.park_id
       WHERE t.league_id = ? AND t.allstar_team = 0`
    )
    .all(leagueId) as Array<{ team_id: number; avgF: number | null; hrF: number | null }>;
  for (const r of rows) {
    const raw = ((r.avgF ?? 1) + (r.hrF ?? 1)) / 2;
    out.set(r.team_id, 1 + (raw - 1) / 2);
  }
  return out;
}

/**
 * Baselines are per league AND level — a Double-A hitter is measured against
 * Double-A, not the majors, so his OPS+ means what it should.
 */
export function leagueBaseline(leagueId: number, year: number, level = 1): LeagueBaseline {
  const key = `${leagueId}:${year}:${level}`;
  const hit = baselineCache.get(key);
  if (hit) return hit;

  // The run environment's extra totals are read only where the export has the column (D-007); an absent one is unknown
  const cols = new Set(tableColumns('players_career_batting_stats'));
  const extra = ['sh', 'sb', 'cs', 'gdp'].map((c) => (cols.has(c) ? `SUM(s.${c}) AS ${c}` : `NULL AS ${c}`)).join(', ');
  const bat = db
    .prepare(
      `SELECT SUM(s.pa) AS pa, SUM(s.ab) AS ab, SUM(s.h) AS h, SUM(s.d) AS d, SUM(s.t) AS t3,
              SUM(s.hr) AS hr, SUM(s.bb) AS bb, SUM(s.ibb) AS ibb, SUM(s.hp) AS hp,
              SUM(s.sf) AS sf, SUM(s.r) AS r, ${extra}
       FROM players_career_batting_stats s
       WHERE s.year = ? AND s.split_id = 1 AND s.level_id = ? AND s.league_id = ?`
    )
    .get(year, level, leagueId) as Record<string, number | null>;

  const pit = db
    .prepare(
      `SELECT SUM(s.outs) AS outs, SUM(s.er) AS er, SUM(s.hra) AS hra,
              SUM(s.bb) AS bb, SUM(s.k) AS k, SUM(s.hp) AS hp
       FROM players_career_pitching_stats s
       WHERE s.year = ? AND s.split_id = 1 AND s.level_id = ? AND s.league_id = ?`
    )
    .get(year, level, leagueId) as Record<string, number | null>;

  const n = (v: number | null | undefined) => v ?? 0;
  const ab = n(bat.ab);
  const h = n(bat.h);
  const singles = h - n(bat.d) - n(bat.t3) - n(bat.hr);
  const obpDen = ab + n(bat.bb) + n(bat.hp) + n(bat.sf);
  const wobaDen = ab + (n(bat.bb) - n(bat.ibb)) + n(bat.sf) + n(bat.hp);
  const lgInnings = n(pit.outs) / 3;
  const opt = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v);
  const totals: RunTotals = {
    pa: n(bat.pa), ab, h, d: n(bat.d), t: n(bat.t3), hr: n(bat.hr), bb: n(bat.bb), ibb: opt(bat.ibb), hp: opt(bat.hp), sf: opt(bat.sf),
    sh: opt(bat.sh), sb: opt(bat.sb), cs: opt(bat.cs), gdp: opt(bat.gdp), r: n(bat.r),
  };

  const baseline: LeagueBaseline = {
    year,
    lgOBP: obpDen ? (h + n(bat.bb) + n(bat.hp)) / obpDen : 0,
    lgSLG: ab ? (singles + 2 * n(bat.d) + 3 * n(bat.t3) + 4 * n(bat.hr)) / ab : 0,
    lgWOBA: wobaDen
      ? (W.bb * (n(bat.bb) - n(bat.ibb)) + W.hbp * n(bat.hp) + W.single * singles +
         W.double * n(bat.d) + W.triple * n(bat.t3) + W.hr * n(bat.hr)) / wobaDen
      : 0,
    lgRperPA: n(bat.pa) ? n(bat.r) / n(bat.pa) : 0,
    lgERA: lgInnings ? (n(pit.er) / lgInnings) * 9 : 0,
    lgFIPRaw: lgInnings
      ? (13 * n(pit.hra) + 3 * (n(pit.bb) + n(pit.hp)) - 2 * n(pit.k)) / lgInnings
      : 0,
    wobaScale: wobaScaleFrom(totals),
    caughtStealingRuns: caughtStealingRunsFrom(totals),
    parkFactor: parkFactors(leagueId),
  };
  baselineCache.set(key, baseline);
  return baseline;
}

/** Cleared whenever a fresh export is imported. */
export function clearStatCaches(): void {
  baselineCache.clear();
}

export interface RawBatting {
  pa: number; ab: number; h: number; d: number; t3: number; hr: number;
  bb: number; ibb: number; hp: number; sf: number; k: number; sb: number;
  cs: number; r: number; rbi: number; war: number;
}

export interface RawPitching {
  outs: number; er: number; ra: number; ha: number; bb: number; k: number;
  hra: number; hp: number; bf: number; g: number; gs: number; w: number; l: number;
  sv: number; hld: number; war: number;
}

const round = (v: number | null, places: number): number | null =>
  v === null || !Number.isFinite(v) ? null : Number(v.toFixed(places));

export function computeBatting(
  s: Partial<RawBatting>, base: LeagueBaseline, teamId: number | null
): Record<string, number | null> {
  const g = (k: keyof RawBatting) => s[k] ?? 0;
  const ab = g('ab');
  const pa = g('pa');
  const h = g('h');
  const singles = h - g('d') - g('t3') - g('hr');
  const obpDen = ab + g('bb') + g('hp') + g('sf');
  const wobaDen = ab + (g('bb') - g('ibb')) + g('sf') + g('hp');

  const avg = ab ? h / ab : null;
  const obp = obpDen ? (h + g('bb') + g('hp')) / obpDen : null;
  const slg = ab ? (singles + 2 * g('d') + 3 * g('t3') + 4 * g('hr')) / ab : null;
  const woba = wobaDen
    ? (W.bb * (g('bb') - g('ibb')) + W.hbp * g('hp') + W.single * singles +
       W.double * g('d') + W.triple * g('t3') + W.hr * g('hr')) / wobaDen
    : null;
  const babipDen = ab - g('k') - g('hr') + g('sf');
  const pf = (teamId !== null ? base.parkFactor.get(teamId) : undefined) ?? 1;

  // OPS+ : 100 × (OBP/lgOBP + SLG/lgSLG − 1), then park-adjusted
  const opsPlus =
    obp !== null && slg !== null && base.lgOBP > 0 && base.lgSLG > 0
      ? (100 * (obp / base.lgOBP + slg / base.lgSLG - 1)) / pf
      : null;

  // wRC+ : runs created per PA relative to league, park-adjusted
  const wrcPlus =
    woba !== null && base.lgRperPA > 0
      ? (100 * ((woba - base.lgWOBA) / base.wobaScale.value + base.lgRperPA)) / (base.lgRperPA * pf)
      : null;

  return {
    pa, ab, h,
    d: g('d'), t3: g('t3'), hr: g('hr'), r: g('r'), rbi: g('rbi'),
    bb: g('bb'), k: g('k'), sb: g('sb'), cs: g('cs'),
    xbh: g('d') + g('t3') + g('hr'),
    avg: round(avg, 3),
    obp: round(obp, 3),
    slg: round(slg, 3),
    ops: obp !== null && slg !== null ? round(obp + slg, 3) : null,
    iso: slg !== null && avg !== null ? round(slg - avg, 3) : null,
    babip: babipDen > 0 ? round((h - g('hr')) / babipDen, 3) : null,
    woba: round(woba, 3),
    bbPct: pa ? round((g('bb') / pa) * 100, 1) : null,
    kPct: pa ? round((g('k') / pa) * 100, 1) : null,
    sbPct: g('sb') + g('cs') > 0 ? round((g('sb') / (g('sb') + g('cs'))) * 100, 0) : null,
    opsPlus: round(opsPlus, 0),
    wrcPlus: round(wrcPlus, 0),
    war: round(g('war'), 1),
  };
}

export function computePitching(
  s: Partial<RawPitching>, base: LeagueBaseline, teamId: number | null
): Record<string, number | null> {
  const g = (k: keyof RawPitching) => s[k] ?? 0;
  const ip = g('outs') / 3;
  const pf = (teamId !== null ? base.parkFactor.get(teamId) : undefined) ?? 1;

  const era = ip ? (g('er') / ip) * 9 : null;
  // ERA+ : 100 × lgERA / ERA, with the park factor lifting pitchers in hitters' parks
  const eraPlus = era !== null && era > 0 && base.lgERA > 0 ? (100 * base.lgERA * pf) / era : null;
  // FIP's constant is what makes league FIP equal league ERA, so it must be
  // lgERA minus the league's own raw component — not lgERA minus the textbook
  // 3.10. Using the textbook figure inflated every FIP by the difference.
  const fipConstant = base.lgERA > 0 ? base.lgERA - base.lgFIPRaw : 0;

  return {
    g: g('g'), gs: g('gs'), w: g('w'), l: g('l'), sv: g('sv'), hld: g('hld'),
    ip: round(ip, 1),
    h: g('ha'), er: g('er'), bb: g('bb'), k: g('k'), hr: g('hra'),
    era: round(era, 2),
    whip: ip ? round((g('bb') + g('ha')) / ip, 2) : null,
    k9: ip ? round((g('k') / ip) * 9, 1) : null,
    bb9: ip ? round((g('bb') / ip) * 9, 1) : null,
    hr9: ip ? round((g('hra') / ip) * 9, 1) : null,
    kbb: g('bb') ? round(g('k') / g('bb'), 2) : g('k') > 0 ? null : null,
    kPct: g('bf') ? round((g('k') / g('bf')) * 100, 1) : null,
    bbPct: g('bf') ? round((g('bb') / g('bf')) * 100, 1) : null,
    // Walks and hit batsmen both count: they are the batter reaching without
    // the defense being involved, which is the whole point of the metric.
    fip: ip
      ? round((13 * g('hra') + 3 * (g('bb') + g('hp')) - 2 * g('k')) / ip + fipConstant, 2)
      : null,
    eraPlus: round(eraPlus, 0),
    war: round(g('war'), 1),
  };
}
