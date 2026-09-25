/**
 * MLB Operations' per-save fit of the results lens's season weights and stabilization (D-053, cycle 2; docs/CALIBRATION.md section 13).
 * Pure: no table, no rating; every case arrives as an argument (the reads are `mlbCalibrationRefit.ts`'s).
 *
 * What is fitted, per kind (hitters, starters, relievers): the recency weights of the season before and the one before that (the
 * current season is the scale) and the stabilization K of `reliability = n / (n + K)`, by the production arithmetic: a player's
 * league-relative results over the three seasons before a target season, recency weighted by opportunities, shrunk toward his kind's
 * mean by his weighted sample, predicting the target season. Hitters predict park-adjusted wOBA relative to the league; pitchers
 * predict park-adjusted ERA relative to the league from the review's own mix of peripherals and runs (`PITCHER_RESULTS_MIX`). Both
 * sides are centred on the kind's own mean that season (the review ranks a player among his kind). The grid is policy; the choice on
 * it is the save's.
 *
 * Checked by rolling origin, NESTED: at each origin t the grid point is chosen on the target seasons up to t only and scored on the
 * next season, paired against the starting values on the same player-seasons, unshrunk and as served (shrunk toward the starting
 * values by the training cases). The verdict is the detector's (`calibrationDetector.ts`): the save's values serve only where clearly
 * better, with hysteresis. Baserunning and defensive stabilization are fitted the same way (K only, at the hitters' weights) once the
 * export carries UBR or zone rating for enough seasons; on a save without, they are inactive and say so.
 */

import { policy, type CalibrationStamp } from './calibration.js';
import type { CalibrationCheck, CalibrationRecord } from './saveCalibrationStore.js';
import type { CalibrationRun } from './saveCalibration.js';
import { decide, DETECTOR_METHOD, DETECTOR_POLICY, type DetectorDecision, type DetectorPolicy, type HeldOutCase, type ServedSource } from './calibrationDetector.js';
import { RESULTS_PRIOR, type ResultsKind, type ResultsParams } from './resultsMetrics.js';
import { MLB_CALIBRATION_SUBSYSTEM } from './mlbCalibrationFit.js';

export const RESULTS_METHOD = 'results-1';

export const RESULTS_FIT_STAMP: CalibrationStamp = policy(
  'The results fit\'s window, grid, minimums and shrinkage, and the detector\'s "clearly better" rule it is judged by. Chosen and stated (D-041); the values chosen on the grid are the save\'s.'
);

export const RESULTS_PARTS = ['hitter', 'starter', 'reliever', 'baserunning', 'defense'] as const;
export type ResultsPart = (typeof RESULTS_PARTS)[number];
/** The parts every refit must judge; baserunning and defense are judged only where the export carries their runs. */
export const REQUIRED_PARTS: readonly ResultsKind[] = ['hitter', 'starter', 'reliever'];

const K_GRID = [100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 1000, 1250, 1500, 2000, 3000];

/** POLICY. The window, the grid, the minimums and the shrinkage. */
export const RESULTS_FIT_POLICY = {
  /** The most recent completed seasons as targets; a season under this share of its own schedule is not a target. */
  windowSeasons: 20,
  minShare: 0.9,
  /** Rolling origins: at most this many, from the window's start + this many seasons. */
  maxOrigins: 8,
  originStart: 5,
  /** A target season's opportunities (PA, BF, PA, innings) for it to be predicted. */
  minTarget: { hitter: 250, starter: 350, reliever: 150, baserunning: 250, defense: 300 } as Record<ResultsPart, number>,
  /** Training cases a fit needs (an origin with fewer is not scored). */
  minTraining: { hitter: 1000, starter: 500, reliever: 500, baserunning: 1000, defense: 500 } as Record<ResultsPart, number>,
  /** The grid: the season before and the one before that relative to this one (an older season never counts more), and K. */
  grid: {
    before: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    older: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    k: { hitter: K_GRID, starter: K_GRID, reliever: K_GRID, baserunning: [100, 200, 300, 400, 550, 700, 1000, 1500, 2000, 3000, 5000], defense: [250, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000] } as Record<ResultsPart, number[]>,
  },
  /** Training cases at which the fitted values carry half the weight against the starting values. */
  shrinkCases: 500,
} as const;

export type ResultsFitPolicy = typeof RESULTS_FIT_POLICY;

/** One player-season to predict: the target (centred on his kind's mean that season) and the three seasons before it. */
export interface ResultsCase {
  playerId: number;
  target: number;
  y: number;
  /** Opportunities in the target season (the case's weight). */
  n: number;
  /** The seasons before (t-1, t-2, t-3): the centred value and its opportunities; null when he has none. */
  lags: Array<{ v: number; n: number } | null>;
  /** Pitchers: the runs measure of the same seasons (the lags hold the peripherals). */
  runs?: Array<{ v: number; n: number } | null>;
}

export interface ResultsInput {
  cases: Record<ResultsPart, ResultsCase[]>;
  /** The completed full seasons (targets) and those skipped with why. */
  seasons: number[];
  skipped: Array<{ season: number; reason: string }>;
  /** The review's peripherals share for pitchers (`PITCHER_RESULTS_MIX.skills`). */
  mix: number;
  /** Seasons whose export carries UBR (baserunning) and zone rating (defense): their parts are judged only on those. */
  carries: { baserunning: number[]; defense: number[] };
}

export interface PartValues {
  /** Recency weights on the declared scale (5 for the season being read). */
  weights: number[];
  k: number;
}

export interface PartFit {
  part: ResultsPart;
  source: ServedSource;
  /** What serves for the part (the save's own, shrunk, or the starting values). */
  served: PartValues;
  /** Fitted through the last completed season: unshrunk and as it would serve. Null when not fitted. */
  fitted: PartValues | null;
  fittedServed: PartValues | null;
  cases: number;
  /** The share of the as-served values still the starting values. */
  priorWeight: number;
  decision: DetectorDecision | null;
  /** Why the starting values serve, when they do: 'kept' (checked and held up), or why it could not be judged. */
  reason: 'kept' | 'returned' | 'seasons' | 'no_runs' | null;
}

export interface ResultsModel {
  parts: Record<ResultsPart, PartFit>;
  /** The params the review is served under. */
  params: Omit<ResultsParams, 'stamp'>;
}

const priorValues = (part: ResultsPart): PartValues => {
  const kind: ResultsKind = part === 'starter' || part === 'reliever' ? part : 'hitter';
  return { weights: [...RESULTS_PRIOR.weights[kind]], k: RESULTS_PRIOR.stabilization[part] };
};

// ── the arithmetic, fast ─────────────────────────────────────────────────────

interface Packed {
  n: number;
  y: Float64Array; w: Float64Array; player: Int32Array; target: Int32Array;
  v: Float64Array[]; o: Float64Array[]; r: Float64Array[] | null;
}

function pack(cases: ResultsCase[], pitcher: boolean): Packed {
  const n = cases.length;
  const p: Packed = {
    n, y: new Float64Array(n), w: new Float64Array(n), player: new Int32Array(n), target: new Int32Array(n),
    v: [0, 1, 2].map(() => new Float64Array(n)), o: [0, 1, 2].map(() => new Float64Array(n)), r: pitcher ? [0, 1, 2].map(() => new Float64Array(n)) : null,
  };
  cases.forEach((c, i) => {
    p.y[i] = c.y; p.w[i] = c.n; p.player[i] = c.playerId; p.target[i] = c.target;
    for (let k = 0; k < 3; k += 1) {
      const l = c.lags[k];
      p.v[k][i] = l ? l.v : 0; p.o[k][i] = l ? l.n : 0;
      if (p.r) p.r[k][i] = c.runs?.[k]?.v ?? (l ? l.v : 0);
    }
  });
  return p;
}

/** The prediction under weights (1, a, b) and K: the production's weighted value times its reliability (`weightedBatting` + `reliability`). */
function predictOne(p: Packed, i: number, a: number, b: number, k: number, mix: number): number {
  const w1 = p.o[0][i], w2 = a * p.o[1][i], w3 = b * p.o[2][i];
  const den = w1 + w2 + w3;
  if (den <= 0) return 0;
  let value = (p.v[0][i] * w1 + p.v[1][i] * w2 + p.v[2][i] * w3) / den;
  if (p.r) value = mix * value + (1 - mix) * ((p.r[0][i] * w1 + p.r[1][i] * w2 + p.r[2][i] * w3) / den);
  return (den / (den + k)) * value;
}

const relative = (v: PartValues) => ({ a: v.weights[1] / v.weights[0], b: v.weights[2] / v.weights[0] });
const onScale = (a: number, b: number, k: number): PartValues => ({ weights: [5, round(5 * a), round(5 * b)], k: round(k) });
const round = (x: number) => Math.round(x * 1000) / 1000;

/** The grid point with the least opportunity-weighted squared error on these cases (the fixed weights, when given, fit K only). */
export function fitPart(cases: ResultsCase[], part: ResultsPart, mix: number, options: { fixed?: PartValues; policy?: ResultsFitPolicy } = {}): { values: PartValues; loss: number } | null {
  const pol = options.policy ?? RESULTS_FIT_POLICY;
  if (cases.length === 0) return null;
  const p = pack(cases, part === 'starter' || part === 'reliever');
  const pairs: Array<[number, number]> = [];
  if (options.fixed) pairs.push([relative(options.fixed).a, relative(options.fixed).b]);
  else for (const a of pol.grid.before) for (const b of pol.grid.older) if (b <= a) pairs.push([a, b]);
  const ks = pol.grid.k[part];
  let best: { a: number; b: number; k: number; loss: number } | null = null;
  const agg = new Float64Array(p.n);
  const smp = new Float64Array(p.n);
  const losses = new Float64Array(ks.length);
  for (const [a, b] of pairs) {
    for (let i = 0; i < p.n; i += 1) {
      const w1 = p.o[0][i], w2 = a * p.o[1][i], w3 = b * p.o[2][i];
      const den = w1 + w2 + w3;
      smp[i] = den;
      if (den <= 0) { agg[i] = 0; continue; }
      let value = (p.v[0][i] * w1 + p.v[1][i] * w2 + p.v[2][i] * w3) / den;
      if (p.r) value = mix * value + (1 - mix) * ((p.r[0][i] * w1 + p.r[1][i] * w2 + p.r[2][i] * w3) / den);
      agg[i] = value;
    }
    losses.fill(0);
    for (let i = 0; i < p.n; i += 1) {
      const s = smp[i], v = agg[i], y = p.y[i], w = p.w[i];
      for (let j = 0; j < ks.length; j += 1) {
        const e = y - (s / (s + ks[j])) * v;
        losses[j] += w * e * e;
      }
    }
    for (let j = 0; j < ks.length; j += 1) if (!best || losses[j] < best.loss) best = { a, b, k: ks[j], loss: losses[j] };
  }
  if (!best) return null;
  return { values: onScale(best.a, best.b, best.k), loss: best.loss };
}

/** Shrink fitted values toward the starting values by the training cases. */
export function shrinkValues(fitted: PartValues, prior: PartValues, cases: number, strength: number): { values: PartValues; weight: number } {
  const w = cases / (cases + strength);
  const f = relative(fitted);
  const q = relative(prior);
  return { values: onScale(w * f.a + (1 - w) * q.a, w * f.b + (1 - w) * q.b, w * fitted.k + (1 - w) * prior.k), weight: w };
}

const lossOf = (p: Packed, i: number, v: PartValues, mix: number) => {
  const r = relative(v);
  const e = p.y[i] - predictOne(p, i, r.a, r.b, v.k, mix);
  return e * e;
};

export interface Backtest {
  origins: number[];
  unshrunk: HeldOutCase[];
  served: HeldOutCase[];
  /** Per held-out case, the no-information loss (the kind's mean) and the predictions, for the reported checks. */
  none: number[];
  predicted: { unshrunk: number[]; served: number[]; prior: number[]; actual: number[]; weight: number[] };
  perOrigin: Array<{ origin: number; fitted: PartValues; training: number }>;
}

/** The nested rolling-origin backtest of one part: each origin's grid point chosen on targets up to it, scored on the next target season. */
export function backtestPart(cases: ResultsCase[], part: ResultsPart, targets: number[], mix: number, options: { fixed?: (origin: number) => PartValues | undefined; policy?: ResultsFitPolicy } = {}): Backtest {
  const pol = options.policy ?? RESULTS_FIT_POLICY;
  const prior = priorValues(part);
  const next = (t: number) => targets[targets.indexOf(t) + 1];
  const candidates = targets.filter((t) => t >= targets[0] + pol.originStart && next(t) !== undefined);
  const origins = candidates.slice(-pol.maxOrigins);
  const out: Backtest = { origins: [], unshrunk: [], served: [], none: [], predicted: { unshrunk: [], served: [], prior: [], actual: [], weight: [] }, perOrigin: [] };
  for (const t of origins) {
    const train = cases.filter((c) => c.target <= t && c.target >= targets[0]);
    if (train.length < pol.minTraining[part]) continue;
    const fit = fitPart(train, part, mix, { fixed: options.fixed?.(t), policy: pol });
    if (!fit) continue;
    const shrunk = shrinkValues(fit.values, prior, train.length, pol.shrinkCases).values;
    const held = cases.filter((c) => c.target === next(t));
    const p = pack(held, part === 'starter' || part === 'reliever');
    out.origins.push(t);
    out.perOrigin.push({ origin: t, fitted: fit.values, training: train.length });
    for (let i = 0; i < p.n; i += 1) {
      const rival = lossOf(p, i, prior, mix);
      out.unshrunk.push({ cluster: p.player[i], origin: t, weight: p.w[i], candidate: lossOf(p, i, fit.values, mix), rival });
      out.served.push({ cluster: p.player[i], origin: t, weight: p.w[i], candidate: lossOf(p, i, shrunk, mix), rival });
      out.none.push(p.y[i] * p.y[i]);
      const at = (v: PartValues) => { const r = relative(v); return predictOne(p, i, r.a, r.b, v.k, mix); };
      out.predicted.unshrunk.push(at(fit.values)); out.predicted.served.push(at(shrunk)); out.predicted.prior.push(at(prior));
      out.predicted.actual.push(p.y[i]); out.predicted.weight.push(p.w[i]);
    }
  }
  return out;
}

/** Weighted slope of what happened on what was predicted (1 is exact; below 1, the predictions trust the record too much). Reported, not gated. */
export function calibrationSlope(predicted: number[], actual: number[], weight: number[]): { slope: number; se: number } | null {
  const W = weight.reduce((s, w) => s + w, 0);
  if (W <= 0 || predicted.length < 3) return null;
  const mp = predicted.reduce((s, p, i) => s + weight[i] * p, 0) / W;
  const ma = actual.reduce((s, a, i) => s + weight[i] * a, 0) / W;
  let sxy = 0;
  let sxx = 0;
  let see = 0;
  predicted.forEach((p, i) => { sxy += weight[i] * (p - mp) * (actual[i] - ma); sxx += weight[i] * (p - mp) ** 2; });
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  predicted.forEach((p, i) => { see += weight[i] * (actual[i] - ma - slope * (p - mp)) ** 2; });
  const n = predicted.length;
  return { slope, se: Math.sqrt((see / W) * (n / Math.max(1, n - 2)) / (sxx / W) / n) };
}

// ── the refit ────────────────────────────────────────────────────────────────

export interface ResultsFitBasis {
  leagueId: number;
  throughSeason: number | null;
  gameDate: string | null;
}

/**
 * The measured error rates of the detector on this method, from the simulation (`npm run calibrate detector`, docs/CALIBRATION.md
 * section 13): quoted in every run record's notes so the verdict carries how far it can be trusted.
 */
export const DETECTOR_ERROR_RATES_NOTE = 'The rule\'s measured error rates on this method (simulated leagues sized like the Arizona import, 200 to 400 leagues a cell, docs/CALIBRATION.md section 13): false adoption 0.0% to 0.3% for hitters, starters and relievers with 10 to 20 seasons of history (target at most 5%); adoption where the starting values\' error is 2% to 5% above the best (much noisier, much steadier or fast-changing results, a fictional-league-sized shift): 58% to 98% with 10 seasons, 83% to 100% with 16 or more; where it is only 1% to 2% above (near the 1% practical minimum): 25% to 57%; once the save\'s own serve, a wrong return to the starting values: 0%.';

const describeValues = (v: PartValues | null) => (v ? `${v.weights.join('/')}, K ${Math.round(v.k)}` : '—');

/**
 * Fit every part through the last completed season, backtest each (nested, paired, unshrunk and as served) and let the detector decide
 * what serves, given what served before (`previous`, from the adopted record of an earlier season: hysteresis).
 */
export function fitResults(input: ResultsInput, basis: ResultsFitBasis, previous: ResultsModel | null, policyIn: ResultsFitPolicy = RESULTS_FIT_POLICY, detector: DetectorPolicy = DETECTOR_POLICY): CalibrationRun<ResultsModel | null> {
  const through = basis.throughSeason as number;
  const targets = input.seasons.filter((s) => s <= through).slice(-policyIn.windowSeasons);
  const base = {
    leagueId: basis.leagueId, subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'results', method: RESULTS_METHOD,
    basis: { throughSeason: through, gameDate: basis.gameDate },
    priorSource: 'Built-in season weights and stabilization: run 1\'s backtest on the Arizona import\'s 2003-2025 history (provisional).',
  };
  const heldOut: CalibrationCheck[] = [];
  const parts = {} as Record<ResultsPart, PartFit>;
  const notes: string[] = [
    `Each held-out season is predicted by values chosen only on the seasons before it (nested), and compared with the starting values on the same players (paired, standard errors clustered by player). The save's values serve only where clearly better (${DETECTOR_METHOD}: z at most -${detector.zClear}, better in at least ${Math.round(detector.minOriginShare * 100)}% of the seasons checked and at least ${detector.minOriginsWon}, and at least ${(detector.minRelativeGain * 100).toFixed(1)}% lower error), both unshrunk and as served; once serving, they give way only when the starting values are clearly better in turn.`,
    'The starting values were fitted by run 1 on the Arizona import\'s 2003-2025 history: on that league their held-out scores are in sample, which can only make the save\'s values look worse, never better; the unshrunk scoring owes nothing to them.',
    DETECTOR_ERROR_RATES_NOTE,
  ];
  const failures: string[] = [];
  let totalCases = 0;
  for (const part of RESULTS_PARTS) {
    const prior = priorValues(part);
    const was = previous?.parts[part] ?? null;
    const prevSource: ServedSource = was?.source ?? 'starting';
    const keep = (reason: PartFit['reason']): PartFit => ({
      part, source: prevSource, served: was?.served ?? prior, fitted: null, fittedServed: null, cases: 0, priorWeight: prevSource === 'save' ? (was?.priorWeight ?? 1) : 1,
      decision: null, reason: prevSource === 'save' ? null : reason,
    });
    const optional = part === 'baserunning' || part === 'defense';
    const carried = optional ? new Set(input.carries[part]) : null;
    const pool = (input.cases[part] ?? []).filter((c) => targets.includes(c.target) && (!carried || carried.has(c.target)));
    if (optional && (carried as Set<number>).size < policyIn.originStart + 2) {
      parts[part] = keep('no_runs');
      notes.push(`${part === 'baserunning' ? 'Baserunning' : 'Defensive'} stabilization is not fitted: the export carries ${part === 'baserunning' ? 'baserunning runs (UBR)' : 'zone rating'} for ${carried?.size ?? 0} completed season${carried?.size === 1 ? '' : 's'} in the window, too few to fit and check it. Whether OOTP keeps them for simulated seasons is left to the data.`);
      continue;
    }
    // Baserunning and defense fit K only, weighted as production weighs them: baserunning at the hitters' weights in force,
    // defense evenly (`defenseResult` sums a fielder's seasons)
    const fixed = part === 'baserunning' ? () => parts.hitter.served : part === 'defense' ? () => ({ weights: [5, 5, 5], k: RESULTS_PRIOR.stabilization.defense }) : undefined;
    const bt = backtestPart(pool, part, targets.filter((t) => !carried || carried.has(t)), input.mix, { fixed, policy: policyIn });
    const fit = pool.length >= policyIn.minTraining[part] ? fitPart(pool, part, input.mix, { fixed: fixed?.(), policy: policyIn }) : null;
    totalCases += pool.length;
    const decision = decide({ unshrunk: bt.unshrunk, served: bt.served, previous: prevSource }, detector);
    for (const [label, c] of [['unshrunk', decision.unshrunk], ['served', decision.served]] as const) {
      heldOut.push({
        kind: 'detector', part: `${part}:${label}`, n: c.cases, expected: c.rivalLoss, observed: c.candidateLoss, se: c.se, prior: c.rivalLoss,
        passed: c.failures.includes('origins') ? null : c.clearlyBetter,
        note: `z ${c.z === null ? '—' : c.z.toFixed(2)}, ${c.relativeGain === null ? '—' : (c.relativeGain * 100).toFixed(2)}% lower error than the starting values, better in ${c.originsWon} of ${c.originsScored} seasons${c.failures.length ? ` (not clearly better: ${c.failures.join(', ')})` : ''}`,
      });
    }
    if (decision.reverse) {
      const c = decision.reverse;
      heldOut.push({ kind: 'detector', part: `${part}:starting_against_save`, n: c.cases, expected: c.rivalLoss, observed: c.candidateLoss, se: c.se, prior: null, passed: c.failures.includes('origins') ? null : c.clearlyBetter, note: `the starting values against the save's own as served: z ${c.z === null ? '—' : c.z.toFixed(2)}` });
    }
    if (bt.none.length) {
      const W = bt.predicted.weight.reduce((s, w) => s + w, 0);
      const none = bt.none.reduce((s, e, i) => s + e * bt.predicted.weight[i], 0) / W;
      heldOut.push({ kind: 'error', part: `${part}:against_no_information`, n: bt.none.length, expected: none, observed: decision.served.candidateLoss, prior: decision.served.rivalLoss, passed: null, note: 'Reported: the error of assuming every player is his kind\'s average.' });
      const sServed = calibrationSlope(bt.predicted.served, bt.predicted.actual, bt.predicted.weight);
      const sPrior = calibrationSlope(bt.predicted.prior, bt.predicted.actual, bt.predicted.weight);
      heldOut.push({ kind: 'slope', part, n: bt.none.length, expected: 1, observed: sServed?.slope ?? null, se: sServed?.se ?? null, prior: sPrior?.slope ?? null, passed: null, note: 'Reported, not gated: what happened against what was predicted (1 is exact; below 1, the record is trusted too much).' });
    }
    const shrunk = fit ? shrinkValues(fit.values, prior, pool.length, policyIn.shrinkCases) : null;
    if (!decision.decided || !fit || !shrunk) {
      if (!optional) failures.push(`seasons: ${part}: ${decision.reason}`);
      parts[part] = { ...keep('seasons'), fitted: fit?.values ?? null, fittedServed: shrunk?.values ?? null, cases: pool.length, decision };
      continue;
    }
    const source = decision.serve;
    parts[part] = {
      part, source, served: source === 'save' ? shrunk.values : prior, fitted: fit.values, fittedServed: shrunk.values, cases: pool.length,
      priorWeight: source === 'save' ? 1 - shrunk.weight : 1, decision,
      reason: source === 'save' ? null : prevSource === 'save' ? 'returned' : 'kept',
    };
    notes.push(`${part}: fitted ${describeValues(fit.values)} (as served ${describeValues(shrunk.values)}) against the starting ${describeValues(prior)}; ${decision.reason}`);
  }
  const served = (p: ResultsPart) => parts[p].served;
  const params: ResultsModel['params'] = {
    weights: { hitter: served('hitter').weights, starter: served('starter').weights, reliever: served('reliever').weights },
    stabilization: { hitter: served('hitter').k, starter: served('starter').k, reliever: served('reliever').k, baserunning: served('baserunning').k, defense: served('defense').k },
  };
  const byPart = Object.fromEntries(RESULTS_PARTS.map((p) => [p, parts[p].priorWeight]));
  const window = { seasons: targets, skipped: input.skipped.filter((s) => targets.length > 0 && s.season >= targets[0] && s.season <= through), sample: totalCases, unit: 'player-seasons' };
  const gate: CalibrationRecord['gate'] = failures.length
    ? { passed: false, reason: `Not decided: ${failures[0]}. The values in force stay.`, failures }
    : {
      passed: true, failures: [],
      reason: REQUIRED_PARTS.every((p) => parts[p].source === 'starting')
        ? 'Checked on held-out seasons: the starting values held up, so they serve.'
        : `Checked on held-out seasons: the save's own serve for ${REQUIRED_PARTS.filter((p) => parts[p].source === 'save').join(', ')}.`,
    };
  return {
    model: { parts, params },
    record: {
      ...base, window, heldOut, gate, notes,
      priorWeight: { overall: REQUIRED_PARTS.reduce((s, p) => s + parts[p].priorWeight, 0) / REQUIRED_PARTS.length, byPart },
    },
  };
}

/** The params a results model serves, with its stamp (the save's own where any part serves it, else the starting values'). */
export function paramsOf(model: ResultsModel, basis: string): ResultsParams {
  const own = (Object.keys(model.parts) as ResultsPart[]).filter((p) => model.parts[p].source === 'save');
  return {
    ...model.params,
    stamp: own.length
      ? { status: 'calibrated', basis: `The save's own season weights and stabilization for ${own.join(', ')} (clearly better on its held-out seasons); the starting values for the rest.`, run: `save_calibration_fits ${RESULTS_METHOD} through ${basis}` }
      : RESULTS_PRIOR.stamp,
  };
}
