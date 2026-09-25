/**
 * Season results, turned into something comparable: league-relative, recency
 * weighted, and honest about how much sample stands behind them.
 *
 * Results are objective statistics, so this is not a judgment of ability; it is
 * arithmetic on facts. It is kept pure (no table, no log) so the evaluation
 * modules above it can be tested on explicit inputs and the database adapter
 * (`resultsEvidence.ts`) stays a thin reader.
 *
 * What it produces, and why it is built this way:
 *
 *   - **League-relative per season.** A wOBA of .330 or an FIP of 4.10 means
 *     different things in different run environments, so each season is measured
 *     against that season's league before seasons are combined.
 *   - **Recency weighted (Marcel style).** The last three seasons, weighted (the
 *     params in force; 5/3/3 for hitters under the starting values) by plate
 *     appearances (or batters faced): the current partial season counts most per
 *     opportunity but cannot dominate on 43 games.
 *   - **A sample that says how much to trust it.** `reliability = sample / (sample
 *     + k)`. A pitcher with 35 innings this year and two full prior seasons is
 *     read on the whole, and the current-season line alone is never mistaken for
 *     his level.
 *   - **Skills and runs kept apart for pitchers.** FIP-style peripherals (strikeouts,
 *     walks, home runs, hit batters) are the stable read; ERA carries sequencing
 *     and defense luck. Both are reported, and a gap between them is a stated
 *     explanation, not something averaged away.
 *
 * CALIBRATION (D-053, cycle 2). The season weights and the stabilization constants belong to the save: MLB Operations fits them
 * on the league's own seasons (`mlbResultsFit.ts`) and serves them only where they are clearly better than the starting values on
 * held-out seasons (`calibrationDetector.ts`); otherwise the starting values below serve, and say so. They arrive here as ARGUMENTS
 * (`ResultsParams`): no function reads a default, so no consumer can silently use the starting values. `RESULTS_PRIOR` is the
 * provisional fallback (run 1, the Arizona import's 2003-2025). The tools information, the park share and the value of a stolen base
 * stay provisional; the peer-population minimum is policy. Every result carries `calibration`.
 */

import { provisional, type CalibrationStamp } from './calibration.js';

export const RESULTS_CALIBRATION: CalibrationStamp = provisional(
  'Season weights and stabilization: the save\'s own where they were clearly better on its held-out seasons (the roster review\'s yardsticks say which), else the starting values fitted by run 1 on the Arizona import\'s 2003-2025 history. The tools information, the park share and a stolen base\'s value are provisional (see PROVISIONAL_PARTS).'
);

/** What in this module is NOT yet tuned against outcomes, so no stamp overstates it. */
export const PROVISIONAL_PARTS: CalibrationStamp = provisional(
  'The share of true talent the tools explain (one rating snapshot: it needs ratings a completed season before the results, cycle 4), the share of a park run factor that reaches wOBA (measured about 0.52 on the Arizona import from club runs, but the park factor it multiplies is not per season), and the run value of a stolen base (the convention\'s constant). Baserunning and defensive stabilization are judged only once the export carries UBR or zone rating for 10 completed seasons (the first held-out season comes 5 seasons into the window, and the detector needs 4 held-out seasons, each with the season after it).'
);

export type ResultsKind = 'hitter' | 'starter' | 'reliever';

/**
 * The results lens's tuning: recency weights for the season being read, the one before and the one before that (relative; the first
 * is the scale), and the sample at which a rate is half-reliable as a level (plate appearances for hitters and baserunning, batters
 * faced for pitchers, innings for defense). Always passed in: the save's own where adopted, else `RESULTS_PRIOR`.
 */
export interface ResultsParams {
  weights: Record<ResultsKind, readonly number[]>;
  stabilization: Record<ResultsKind | 'baserunning' | 'defense', number>;
  /** What these values are: `provisional` for the starting values, `calibrated` with the save's run record for its own (D-041). */
  stamp: CalibrationStamp;
}

/**
 * PROVISIONAL (the fallback prior). Run 1's backtest on the Arizona import (docs/CALIBRATION.md sections 1-2): hitters 5/3/3 and
 * 500 PA; starters 5/3/1 and 700 BF; relievers 5/3/2 and 500 BF; baserunning 550 PA (stolen-base runs only: the export carried no
 * UBR for past seasons); defense 1,000 innings (a first pass: zone rating exists for the current season only).
 */
export const RESULTS_PRIOR: ResultsParams = {
  weights: { hitter: [5, 3, 3], starter: [5, 3, 1], reliever: [5, 3, 2] },
  stabilization: { hitter: 500, starter: 700, reliever: 500, baserunning: 550, defense: 1000 },
  stamp: provisional('The starting season weights and stabilization: run 1\'s backtest on the Arizona import\'s 2003-2025 history (docs/CALIBRATION.md sections 1-2), the fallback wherever a save\'s own are not clearly better.'),
};

/** A stable key for a set of params (caches keyed by it never serve one set's populations under another). */
export const resultsParamsKey = (p: ResultsParams): string => JSON.stringify([p.weights.hitter, p.weights.starter, p.weights.reliever, p.stabilization]);

/**
 * PROVISIONAL. How much of the true-talent variance the visible tools explain, measured against results from seasons
 * before the ratings were formed (hitters 0.30 to 0.45 depending on the window, pitchers 0.16 to 0.27). When tools are
 * known too, results are shrunk toward what the tools imply, not toward the league average, so the sample needed to
 * trust the results is smaller by this share: `K * (1 - information)`. Not fittable on a save with one rating snapshot; it
 * describes the tools model, and is fitted with it (cycle 4).
 */
export const TOOLS_INFORMATION = { hitter: 0.4, starter: 0.2, reliever: 0.2 } as const;


/** The sample at which results and tools count equally when BOTH are known, under the params in force. */
export const blendStabilization = (kind: ResultsKind, params: ResultsParams): number => params.stabilization[kind] * (1 - TOOLS_INFORMATION[kind]);

/** PROVISIONAL. The share of a park's run-factor deviation that reaches a hitter's wOBA. Runs scale roughly with the square of on-base and slugging, so about half. */
export const PARK_WOBA_SHARE = 0.5;

/**
 * POLICY. Fewest (weighted) plate appearances or batters faced for a player to belong to a peer population: who counts as a peer
 * trades coverage against noise, a product choice no outcome can call optimal (D-041).
 */
export const POPULATION_MINIMUM = { hitter: 150, pitcher: 150 } as const;

// ── counting lines ──────────────────────────────────────────────────────────

export interface BattingLine {
  year: number;
  g: number; gs: number; pa: number; ab: number; h: number; d: number; t: number; hr: number;
  bb: number; ibb: number; hp: number; sf: number; k: number; sb: number; cs: number; gdp: number;
  war: number; ubr: number;
  /** Run-scoring park factor for the seasons's clubs (1 is neutral, already halved for a half-home schedule); absent when unknown. */
  park?: number;
}

export interface PitchingLine {
  year: number;
  g: number; gs: number; gf: number; outs: number; bf: number; er: number; r: number; ha: number; hra: number;
  bb: number; hp: number; k: number; sv: number; hld: number; war: number;
  /** Sum of per-appearance leverage, exported for the current season only; 0 elsewhere. */
  li: number;
  /** Run-scoring park factor for the season's clubs (1 is neutral, already halved); absent when unknown. */
  park?: number;
}

/** League environment for one season, the denominators every player is measured against. */
export interface SeasonEnvironment {
  year: number;
  /** League wOBA. */
  woba: number;
  /** League FIP numerator per inning: (13*HR + 3*(BB+HBP) - 2*K) / IP. */
  fipRaw: number;
  /** League ERA. */
  era: number;
  /** A caught stealing's run value this season (derived from the season's runs per out); absent, the fallback. */
  caughtStealingRuns?: number;
}

// wOBA linear weights, the same ones `stats.ts` uses so the two agree.
const W = { bb: 0.69, hbp: 0.72, single: 0.88, double: 1.25, triple: 1.58, hr: 2.03 };

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function wobaOf(l: Pick<BattingLine, 'ab' | 'h' | 'd' | 't' | 'hr' | 'bb' | 'ibb' | 'hp' | 'sf'>): number | null {
  const singles = l.h - l.d - l.t - l.hr;
  const den = l.ab + (l.bb - l.ibb) + l.sf + l.hp;
  return div(W.bb * (l.bb - l.ibb) + W.hbp * l.hp + W.single * singles + W.double * l.d + W.triple * l.t + W.hr * l.hr, den);
}

export interface HitterRates {
  avg: number | null; obp: number | null; slg: number | null; iso: number | null;
  kRate: number | null; bbRate: number | null; woba: number | null;
}

export function hitterRates(l: BattingLine): HitterRates {
  const singles = l.h - l.d - l.t - l.hr;
  const tb = singles + 2 * l.d + 3 * l.t + 4 * l.hr;
  const obpDen = l.ab + l.bb + l.hp + l.sf;
  const avg = div(l.h, l.ab);
  const slg = div(tb, l.ab);
  return {
    avg, obp: div(l.h + l.bb + l.hp, obpDen), slg, iso: avg !== null && slg !== null ? slg - avg : null,
    kRate: div(l.k, l.pa), bbRate: div(l.bb, l.pa), woba: wobaOf(l),
  };
}

export interface PitcherRates {
  era: number | null; fip: number | null; kRate: number | null; bbRate: number | null; hrRate: number | null; ip: number;
}

const ip = (l: Pick<PitchingLine, 'outs'>) => l.outs / 3;
const fipRawOf = (l: PitchingLine): number | null => div(13 * l.hra + 3 * (l.bb + l.hp) - 2 * l.k, ip(l));

/**
 * ERA and a FIP surrogate on the ERA scale: the league's ERA plus how far his (13 HR + 3 (BB+HBP) - 2 K) per inning sits from the
 * league's. FIP is already expressed per nine innings by its own constant, so there is no further factor of nine (an earlier
 * version multiplied by nine; percentiles among peers were unaffected, the displayed number was).
 */
export function pitcherRates(l: PitchingLine, env?: SeasonEnvironment): PitcherRates {
  const raw = fipRawOf(l);
  return {
    era: div(l.er * 9, ip(l)),
    fip: raw !== null && env ? env.era + (raw - env.fipRaw) : null,
    kRate: div(l.k, l.bf), bbRate: div(l.bb, l.bf), hrRate: div(l.hra, l.bf), ip: ip(l),
  };
}

// ── weighting and reliability ───────────────────────────────────────────────

/** How much of a sample to trust as the level: n / (n + k). Zero for no sample. */
export const reliability = (sample: number, k: number): number => (sample > 0 ? sample / (sample + k) : 0);

export interface WeightedSeason {
  year: number;
  sample: number;
  /** The relative metric for this season (higher is better for hitters; lower is better for pitchers, see each result). */
  value: number;
}

export interface WeightedResult {
  /** Sample-weighted relative metric across the weighted seasons; null when no season qualifies. */
  value: number | null;
  /** Effective sample: each season's opportunities scaled by its weight relative to the current season's. */
  sample: number;
  /** Opportunities across those seasons, unscaled. */
  rawSample: number;
  seasons: WeightedSeason[];
  calibration: typeof RESULTS_CALIBRATION;
}

function weighted(seasons: WeightedSeason[], currentYear: number, weights: readonly number[]): WeightedResult {
  const kept = seasons.filter((s) => s.sample > 0 && (weights[currentYear - s.year] ?? 0) > 0);
  if (kept.length === 0) return { value: null, sample: 0, rawSample: 0, seasons: [], calibration: RESULTS_CALIBRATION };
  const w0 = weights[0];
  let num = 0;
  let den = 0;
  let sample = 0;
  for (const s of kept) {
    const w = weights[currentYear - s.year] ?? 0;
    num += s.value * s.sample * w;
    den += s.sample * w;
    sample += s.sample * (w / w0);
  }
  return {
    value: den > 0 ? num / den : null, sample: Math.round(sample * 10) / 10,
    rawSample: kept.reduce((n, s) => n + s.sample, 0), seasons: kept, calibration: RESULTS_CALIBRATION,
  };
}

/** Batting: wOBA above (positive) or below the league's, weighted across seasons. */
export function weightedBatting(lines: BattingLine[], env: Map<number, SeasonEnvironment>, currentYear: number, weights: readonly number[]): WeightedResult {
  const seasons: WeightedSeason[] = [];
  for (const l of lines) {
    const e = env.get(l.year);
    const woba = wobaOf(l);
    if (!e || woba === null || l.pa <= 0) continue;
    seasons.push({ year: l.year, sample: l.pa, value: woba - e.woba - (l.park !== undefined ? PARK_WOBA_SHARE * (l.park - 1) * e.woba : 0) });
  }
  return weighted(seasons, currentYear, weights);
}

export interface WeightedPitching {
  /** FIP-style peripherals relative to the league, on the ERA scale (LOWER is better). */
  skills: WeightedResult;
  /** ERA relative to the league, in runs per nine (LOWER is better). */
  runs: WeightedResult;
}

export function weightedPitching(lines: PitchingLine[], env: Map<number, SeasonEnvironment>, currentYear: number, weights: readonly number[]): WeightedPitching {
  const skills: WeightedSeason[] = [];
  const runs: WeightedSeason[] = [];
  for (const l of lines) {
    const e = env.get(l.year);
    if (!e || l.bf <= 0 || l.outs <= 0) continue;
    const raw = fipRawOf(l);
    if (raw !== null) skills.push({ year: l.year, sample: l.bf, value: raw - e.fipRaw });
    const era = div(l.er * 9, ip(l));
    // Runs allowed are park-dependent: the run factor scales what a pitcher gives up at home.
    if (era !== null) runs.push({ year: l.year, sample: l.bf, value: era / (l.park ?? 1) - e.era });
  }
  return { skills: weighted(skills, currentYear, weights), runs: weighted(runs, currentYear, weights) };
}

// ── percentiles among peers ─────────────────────────────────────────────────

/**
 * Where a value falls among a population, 0 to 100. `higherIsBetter` false ranks a
 * lower value higher (runs allowed). Ties count half, so a population of one
 * identical value is the 50th.
 */
export function percentileAmong(population: number[], value: number, higherIsBetter: boolean): number | null {
  if (population.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of population) {
    if (v === value) equal += 1;
    else if (higherIsBetter ? v < value : v > value) below += 1;
  }
  return Math.round(((below + equal / 2) / population.length) * 1000) / 10;
}


// ── baserunning ─────────────────────────────────────────────────────────────

/**
 * PROVISIONAL (the fallback only). Runs a stolen base is worth (the convention's constant, served) and a caught stealing costs (served
 * only where the season's own runs per out cannot give it: `SeasonEnvironment.caughtStealingRuns`, from `stats.ts`).
 */
export const STEAL_RUNS_FALLBACK = { sb: 0.2, cs: -0.4 } as const;

/** Baserunning runs in a season: the game's UBR plus stolen-base runs, a caught stealing at the season's own value. */
export const baserunningRuns = (l: Pick<BattingLine, 'ubr' | 'sb' | 'cs'>, csRuns: number = STEAL_RUNS_FALLBACK.cs): number => l.ubr + STEAL_RUNS_FALLBACK.sb * l.sb + csRuns * l.cs;

export interface BaserunningResult {
  /** Runs per 600 plate appearances across the weighted seasons; null when there is no sample. */
  perSixHundred: number | null;
  sample: number;
  reliability: number;
}

export function weightedBaserunning(lines: BattingLine[], env: Map<number, SeasonEnvironment>, currentYear: number, weights: readonly number[], stabilization: number): BaserunningResult {
  let runs = 0;
  let pa = 0;
  let sample = 0;
  for (const l of lines) {
    const w = weights[currentYear - l.year] ?? 0;
    if (w <= 0 || l.pa <= 0) continue;
    runs += baserunningRuns(l, env.get(l.year)?.caughtStealingRuns ?? STEAL_RUNS_FALLBACK.cs) * w;
    pa += l.pa * w;
    sample += l.pa * (w / weights[0]);
  }
  return { perSixHundred: pa > 0 ? (runs / pa) * 600 : null, sample: Math.round(sample * 10) / 10, reliability: reliability(sample, stabilization) };
}

// ── defensive results ───────────────────────────────────────────────────────

export interface DefenseLine {
  year: number;
  position: number;
  ip: number;
  /** Zone-rating runs; the game exports it for the current season and for catchers. */
  zr: number;
  /** Catcher framing runs, current season. */
  framing: number;
}

export interface DefenseResult {
  /** Runs per 1300 innings at the position (zone rating, plus framing for a catcher); null without a sample. */
  per1300: number | null;
  innings: number;
  reliability: number;
}

/** A player's defensive results at one position, across the lines given. */
export function defenseResult(lines: DefenseLine[], position: number, stabilization: number): DefenseResult {
  const here = lines.filter((l) => l.position === position && l.ip > 0);
  const innings = here.reduce((n, l) => n + l.ip, 0);
  if (innings <= 0) return { per1300: null, innings: 0, reliability: 0 };
  const runs = here.reduce((n, l) => n + l.zr + (position === 2 ? l.framing : 0), 0);
  return { per1300: (runs / innings) * 1300, innings, reliability: reliability(innings, stabilization) };
}
