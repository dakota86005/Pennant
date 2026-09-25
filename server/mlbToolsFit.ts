/**
 * The tools lens, per save (D-053, cycle 4 of the per-save calibration; docs/CALIBRATION.md section 15): do this league's visible tools,
 * stored BEFORE a season, forecast that season, and how much should they hold a hitter's results back? Pure: forward cases in, a model and
 * its run record out. The reads are `mlbCalibrationRefit.ts`'s, from the neutral `ratingsForward.ts`.
 *
 *   bat      the slopes of the five bat tools. Fitted inside each rolling origin on the forward seasons up to it (non-negative least
 *            squares on wOBA above the season's own mean), shrunk toward the starting slopes and given the scale that fits the same
 *            training seasons: what serves is the scaled slopes, so the scale is checked with the direction (the Lineup page, the
 *            platoon read and "his tools imply +N points" read it). Scored on the next forward season against the starting slopes as
 *            they serve (scale 1), paired on the same hitters, unshrunk and as served.
 *   blend    how much the tools hold a hitter's results back (`ResultsParams.toolsWeight.hitter`, at least 1): his working estimate,
 *            w × results percentile + (1 − w) × tools percentile with w = r ÷ (r + weight × (1 − r)), r his results' own trust, predicting
 *            his target season's results percentile. The percentiles are among the populations the lens ranks in (the league's
 *            major-league hitters in the snapshot for the tools, its qualified hitters before the season for the results, its hitters in
 *            the season for the target), and the tools under the slopes that serve beside it (the league's own where the bat part
 *            serves them, each origin's own in the backtest). The weight is chosen on a grid inside each origin and scored against 1.
 *
 * Each part is served only where clearly better, by cycle 2's detector (`calibrationDetector.ts`, unchanged): at least 4 held-out forward
 * seasons of 50 hitters, each scored by a fit that saw only the seasons before it, so a save needs 5 forward seasons before anything is
 * judged. A save with one snapshot (dated at its own export) has none, and the starting values serve with that reason.
 *
 * Reported, never gated: the SAME-SEASON ENGINE CHECK. On the season under way, the ratings the organization sees now against the
 * results the game has produced from them so far: a refit against the starting slopes on players it did not see. It is not a forecast
 * (the ratings may have been revised during the season), so it is recorded and decides nothing.
 *
 * Not built here: the pitchers' blend (starters' and relievers' tools weights stay the starting 1, with that reason), and the running
 * slopes (their forward cases need baserunning and stealing ratings stored before a season, which snapshots keep only since cycle 4).
 */

import { policy, type CalibrationStamp } from './calibration.js';
import type { CalibrationCheck, CalibrationRecord } from './saveCalibrationStore.js';
import type { CalibrationRun } from './saveCalibration.js';
import { decide, describeComparison, DETECTOR_POLICY, ruleText, type DetectorDecision, type DetectorPolicy, type HeldOutCase, type ServedSource } from './calibrationDetector.js';
import { HITTER_TOOL_SLOPES, TOOLS_PRIOR } from './toolsModel.js';
import { POPULATION_MINIMUM } from './resultsMetrics.js';
import { MLB_CALIBRATION_SUBSYSTEM } from './mlbCalibrationFit.js';

export const TOOLS_METHOD = 'tools-1';

export const TOOLS_FIT_STAMP: CalibrationStamp = policy(
  'The tools fit\'s forward-case rule, grid, minimums and shrinkage, and the detector\'s "clearly better" rule it is judged by. Chosen and stated (D-041); the slopes and weight chosen are the save\'s.'
);

const TOOLS = Object.keys(HITTER_TOOL_SLOPES) as Array<keyof typeof HITTER_TOOL_SLOPES>;

/** POLICY. */
export const TOOLS_FIT_POLICY = {
  /** Plate appearances in the target season for a forward case. */
  minTargetPa: 100,
  /** Rolling origins: at most this many. */
  maxOrigins: 8,
  /** Training cases an origin's fit needs (an origin with fewer is not scored). */
  minTraining: 150,
  /** Training cases at which the fitted values carry half the weight against the starting ones (slopes linearly, the weight on the log scale). */
  shrinkCases: 400,
  /** The grid of the tools weight (1 is the starting value: the results' own K). */
  weightGrid: [1, 1.25, 1.5, 2, 3, 5, 10],
  /** The engine check: players with this many plate appearances in the season under way, over this many folds of players. */
  engineMinPa: 100,
  engineFolds: 5,
} as const;

export type ToolsFitPolicy = typeof TOOLS_FIT_POLICY;

/** One hitter-season to predict: the tools he carried into it, his results before it, and what he did in it. */
export interface ToolsCase {
  playerId: number;
  target: number;
  /** Days from the snapshot to the start of the target season (how old the ratings were when it began). */
  gapDays: number;
  /** His five bat tools from the snapshot (contact, gap, power, eye, avoid-K), 20-80. */
  x: number[];
  /** His recency-weighted results before the target (wOBA above the league) and their effective plate appearances; null with none. */
  past: { value: number; sample: number } | null;
  /** The target season's wOBA above the league and its plate appearances (the case's weight). */
  y: number;
  weight: number;
}

/** A hitter in the season under way, for the same-season engine check. */
export interface EngineCase { playerId: number; x: number[]; y: number; weight: number }

export interface ToolsInputCases {
  cases: ToolsCase[];
  /** The completed seasons that have forward cases, oldest first. */
  forwardSeasons: number[];
  /** The save's snapshot dates, for the record. */
  snapshots: string[];
  /** The results' own K for hitters under the params in force (the blend's r). */
  resultsK: number;
  /** The same-season engine check's cases (the season under way), or null when it cannot be run. */
  engine: { season: number; snapshot: string; cases: EngineCase[] } | null;
  /**
   * Per forward season, the populations the lens ranks in: the tools of the league's major-league hitters in the snapshot that stood for
   * it, the recency-weighted results before it of the league's hitters with a qualifying sample, and the target values of its hitters in
   * it. A season with no population has no blend rows (never ranked among the cases alone).
   */
  populations: Record<number, SeasonPopulation>;
}

export interface SeasonPopulation { tools: number[][]; past: number[]; target: number[] }

export interface ToolsPart<V> {
  source: ServedSource;
  served: V;
  fitted: V | null;
  fittedServed: V | null;
  cases: number;
  priorWeight: number;
  decision: DetectorDecision | null;
  /**
   * Why the starting value serves, when it does: kept, confirming or returned (judged), or why it could not be judged: `forward` no
   * season has come after a snapshot, `few_forward` fewer than judging needs, `thin` enough seasons but too few hitters in them.
   */
  reason: 'kept' | 'confirming' | 'returned' | 'forward' | 'few_forward' | 'thin' | null;
}

export interface ToolsModel {
  bat: ToolsPart<number[]>;
  blend: ToolsPart<number>;
  forwardSeasons: number;
}

// ── small linear algebra ─────────────────────────────────────────────────────

/** Solve A x = b (Gaussian elimination with partial pivoting); null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k += 1) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Weighted least squares with no intercept, slopes never negative (a better tool never lowers the expectation): an active set. */
export function nonNegativeSlopes(rows: Array<{ x: number[]; y: number; w: number }>): number[] | null {
  const k = rows[0]?.x.length ?? 0;
  let active = Array.from({ length: k }, (_, i) => i);
  for (let pass = 0; pass <= k; pass += 1) {
    if (active.length === 0) return new Array(k).fill(0);
    const a = active.map((i) => active.map((j) => rows.reduce((s, r) => s + r.w * r.x[i] * r.x[j], 0)));
    const b = active.map((i) => rows.reduce((s, r) => s + r.w * r.x[i] * r.y, 0));
    const sol = solve(a, b);
    if (!sol) return null;
    const negative = sol.map((v, i) => ({ v, i })).filter((s) => s.v < 0);
    if (negative.length === 0) {
      const out = new Array(k).fill(0);
      active.forEach((i, j) => { out[i] = sol[j]; });
      return out;
    }
    const worst = negative.sort((p, q) => p.v - q.v)[0].i;
    active = active.filter((_, j) => j !== worst);
  }
  return null;
}

/** Cases centred within their own target season (x and y, weighted): the season's level drops out; only the direction is judged. */
function centred<T extends { target: number; x: number[]; y: number; weight: number }>(cases: T[]): Array<T & { xc: number[]; yc: number }> {
  const bySeason = new Map<number, T[]>();
  for (const c of cases) bySeason.set(c.target, [...(bySeason.get(c.target) ?? []), c]);
  const out: Array<T & { xc: number[]; yc: number }> = [];
  for (const list of bySeason.values()) {
    const W = list.reduce((s, c) => s + c.weight, 0);
    const mx = list[0].x.map((_, i) => list.reduce((s, c) => s + c.weight * c.x[i], 0) / W);
    const my = list.reduce((s, c) => s + c.weight * c.y, 0) / W;
    for (const c of list) out.push({ ...c, xc: c.x.map((v, i) => v - mx[i]), yc: c.y - my });
  }
  return out;
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** The scale that best maps a slope vector's prediction onto the training seasons (least squares through the origin). */
function scaleOn(v: number[], train: Array<{ xc: number[]; yc: number; weight: number }>): number {
  let num = 0;
  let den = 0;
  for (const c of train) { const p = dot(v, c.xc); num += c.weight * p * c.yc; den += c.weight * p * p; }
  return den > 0 ? num / den : 0;
}

const priorSlopes = (): number[] => TOOLS.map((t) => TOOLS_PRIOR.slopes[t]);

function shrinkSlopes(fitted: number[], cases: number, strength: number): { v: number[]; weight: number } {
  const w = cases / (cases + strength);
  const p = priorSlopes();
  return { v: fitted.map((f, i) => w * f + (1 - w) * p[i]), weight: w };
}

function shrinkWeight(fitted: number, cases: number, strength: number): { v: number; weight: number } {
  const w = cases / (cases + strength);
  return { v: Math.max(1, Math.exp(w * Math.log(fitted))), weight: w };
}

/** Percentile (0 to 100) of a value among a population (mid-rank for ties). */
function pctAmong(sorted: number[], v: number): number {
  let lo = 0; let hi = 0;
  for (const x of sorted) { if (x < v) lo += 1; else if (x === v) hi += 1; }
  return ((lo + hi / 2) / sorted.length) * 100;
}

type BlendRow = { playerId: number; target: number; r: number; P: number; T: number; Y: number; weight: number };

/**
 * The blend's rows: hitters with results before the target and tools, their percentiles among the season's own populations, the tools
 * read under `slopesFor(target)` (the slopes that serve beside the blend). A season with no population gives no rows.
 */
function blendRows(cases: ToolsCase[], k: number, pops: ToolsInputCases['populations'], slopesFor: (target: number) => number[]): BlendRow[] {
  const out: BlendRow[] = [];
  const bySeason = new Map<number, ToolsCase[]>();
  // Only hitters the lens gives a results percentile (a qualifying sample); below it the served estimate is his tools alone, which no
  // weight changes, so such a hitter has no row (checked is served)
  for (const c of cases) if (c.past && c.past.sample >= POPULATION_MINIMUM.hitter) bySeason.set(c.target, [...(bySeason.get(c.target) ?? []), c]);
  for (const [target, list] of bySeason) {
    const pop = pops[target];
    if (!pop || pop.tools.length === 0 || pop.past.length === 0 || pop.target.length === 0) continue;
    const v = slopesFor(target);
    const tools = pop.tools.map((x) => dot(v, x)).sort((a, b) => a - b);
    const past = [...pop.past].sort((a, b) => a - b);
    const tgt = [...pop.target].sort((a, b) => a - b);
    for (const c of list) {
      const n = (c.past as { sample: number }).sample;
      out.push({
        playerId: c.playerId, target, r: n / (n + k), weight: c.weight,
        P: pctAmong(past, (c.past as { value: number }).value), T: pctAmong(tools, dot(v, c.x)), Y: pctAmong(tgt, c.y),
      });
    }
  }
  return out;
}

const blendLoss = (row: { r: number; P: number; T: number; Y: number }, m: number) => {
  const w = row.r / (row.r + m * (1 - row.r));
  return (row.Y - (w * row.P + (1 - w) * row.T)) ** 2;
};

function fitWeight(rows: BlendRow[], grid: readonly number[]): number | null {
  if (rows.length === 0) return null;
  let best: { m: number; loss: number } | null = null;
  for (const m of grid) {
    const loss = rows.reduce((s, r) => s + r.weight * blendLoss(r, m), 0);
    if (!best || loss < best.loss) best = { m, loss };
  }
  return best?.m ?? null;
}

const scaled = (v: number[], b: number) => v.map((x) => Math.max(0, b) * x);

// ── the backtest ─────────────────────────────────────────────────────────────

interface Backtest { bat: { unshrunk: HeldOutCase[]; served: HeldOutCase[] }; blend: { unshrunk: HeldOutCase[]; served: HeldOutCase[] }; perOrigin: string[] }

/**
 * Nested rolling origins over the forward seasons: each origin fitted on the seasons up to it, scored on the next forward season. The
 * bat's candidate is each origin's slopes as they would serve (shrunk and scaled on its own training seasons); the rival is the starting
 * slopes as they serve. The blend reads the tools under `batServes`: the starting slopes, or each origin's own where the bat part serves
 * the league's (what would have served beside the blend at that origin).
 */
export function backtestTools(input: ToolsInputCases, policyIn: ToolsFitPolicy = TOOLS_FIT_POLICY, batServes: ServedSource = 'starting'): Backtest {
  const seasons = input.forwardSeasons;
  const next = (t: number) => seasons[seasons.indexOf(t) + 1];
  const origins = seasons.filter((t) => next(t) !== undefined).slice(-policyIn.maxOrigins);
  const out: Backtest = { bat: { unshrunk: [], served: [] }, blend: { unshrunk: [], served: [] }, perOrigin: [] };
  const all = centred(input.cases);
  const rival = priorSlopes();
  for (const t of origins) {
    const train = all.filter((c) => c.target <= t);
    if (train.length < policyIn.minTraining) continue;
    const fitted = nonNegativeSlopes(train.map((c) => ({ x: c.xc, y: c.yc, w: c.weight })));
    if (!fitted) continue;
    const shrunk = shrinkSlopes(fitted, train.length, policyIn.shrinkCases).v;
    const unshrunkServed = scaled(fitted, scaleOn(fitted, train));
    const served = scaled(shrunk, scaleOn(shrunk, train));
    for (const c of all) {
      if (c.target !== next(t)) continue;
      const loss = (v: number[]) => (c.yc - dot(v, c.xc)) ** 2;
      const rl = loss(rival);
      out.bat.unshrunk.push({ cluster: c.playerId, origin: t, weight: c.weight, candidate: loss(unshrunkServed), rival: rl });
      out.bat.served.push({ cluster: c.playerId, origin: t, weight: c.weight, candidate: loss(served), rival: rl });
    }
    const slopes = batServes === 'save' ? served : rival;
    const rows = blendRows(input.cases.filter((c) => c.target <= next(t)), input.resultsK, input.populations, () => slopes);
    const rowsTrain = rows.filter((r) => r.target <= t);
    const m = rowsTrain.length >= policyIn.minTraining ? fitWeight(rowsTrain, policyIn.weightGrid) : null;
    if (m !== null) {
      const mS = shrinkWeight(m, rowsTrain.length, policyIn.shrinkCases).v;
      for (const r of rows) {
        if (r.target !== next(t)) continue;
        const rl = blendLoss(r, 1);
        out.blend.unshrunk.push({ cluster: r.playerId, origin: t, weight: r.weight, candidate: blendLoss(r, m), rival: rl });
        out.blend.served.push({ cluster: r.playerId, origin: t, weight: r.weight, candidate: blendLoss(r, mS), rival: rl });
      }
    }
    out.perOrigin.push(`Origin ${t}: slopes ${fitted.map((v) => v.toFixed(5)).join(' ')} (as served ${served.map((v) => v.toFixed(5)).join(' ')}) on ${train.length} hitter-seasons${m !== null ? `; tools weight ${m}` : ''}.`);
  }
  return out;
}

/**
 * The same-season engine check (reported, never gated): folds of players on the season under way, the starting slopes (given a fitted
 * scale) against a refit, and the starting slopes' own scale. Null when it cannot be run.
 */
export function engineCheck(engine: ToolsInputCases['engine'], policyIn: ToolsFitPolicy = TOOLS_FIT_POLICY): CalibrationCheck | null {
  if (!engine || engine.cases.length < policyIn.minTraining) return null;
  const all = centred(engine.cases.map((c) => ({ ...c, target: engine.season })));
  let prior = 0; let refit = 0; let W = 0;
  const diffs: number[] = [];
  for (let f = 0; f < policyIn.engineFolds; f += 1) {
    const train = all.filter((c) => c.playerId % policyIn.engineFolds !== f);
    const test = all.filter((c) => c.playerId % policyIn.engineFolds === f);
    const fitted = nonNegativeSlopes(train.map((c) => ({ x: c.xc, y: c.yc, w: c.weight })));
    if (!fitted) return null;
    const bP = scaleOn(priorSlopes(), train);
    const bF = scaleOn(fitted, train);
    for (const c of test) {
      const p = c.weight * (c.yc - bP * dot(priorSlopes(), c.xc)) ** 2;
      const q = c.weight * (c.yc - bF * dot(fitted, c.xc)) ** 2;
      prior += p; refit += q; W += c.weight;
      diffs.push(q - p);
    }
  }
  const scale = scaleOn(priorSlopes(), all);
  // One standard error of the difference across hitters (each hitter one case), as a share of the starting slopes' error
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const se = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1) * diffs.length) / prior;
  return {
    kind: 'engine_check', part: 'bat', n: all.length, expected: prior / W, observed: refit / W, prior: prior / W, passed: null,
    note: `Same-season engine check (reported, never decides; not a forecast): on ${engine.season} to date, the ratings seen on ${engine.snapshot} against the results the game has produced from them, ${all.length} hitters with ${policyIn.engineMinPa}+ PA, ${policyIn.engineFolds} folds of players. A refit had ${(((refit - prior) / prior) * 100).toFixed(1)}% ${refit > prior ? 'more' : 'less'} error than the starting slopes (± ${(se * 100).toFixed(1)}%, one standard error across hitters: ${Math.abs(refit - prior) / prior <= 2 * se ? 'within two standard errors, so this season cannot tell them apart' : `more than two standard errors, so on this season the ${refit < prior ? 'refit' : 'starting slopes'} did better`}); the starting slopes' scale on these results is ${scale.toFixed(2)} (1 is exact).`,
  };
}

// ── the fit ──────────────────────────────────────────────────────────────────

export interface ToolsFitBasis { leagueId: number; throughSeason: number | null; gameDate: string | null }

function part<V>(bt: { unshrunk: HeldOutCase[]; served: HeldOutCase[] }, previous: ToolsPart<V> | null, fitted: V | null, fittedServed: { v: V; weight: number } | null, starting: V, cases: number, detector: DetectorPolicy, undecided: 'forward' | 'few_forward' | 'thin'): ToolsPart<V> {
  const prev: ServedSource = previous?.source ?? 'starting';
  const decision = decide({ unshrunk: bt.unshrunk, served: bt.served, previous: prev, streak: previous?.decision?.streak ?? 0 }, detector);
  if (!decision.decided || fitted === null || fittedServed === null) {
    return {
      source: prev, served: prev === 'save' ? previous?.served ?? starting : starting, fitted, fittedServed: fittedServed?.v ?? null, cases,
      priorWeight: prev === 'save' ? previous?.priorWeight ?? 1 : 1, decision, reason: prev === 'save' ? null : undecided,
    };
  }
  const source = decision.serve;
  return {
    source, served: source === 'save' ? fittedServed.v : starting, fitted, fittedServed: fittedServed.v, cases,
    priorWeight: source === 'save' ? 1 - fittedServed.weight : 1, decision,
    reason: source === 'save' ? null : prev === 'save' ? 'returned' : decision.streak > 0 ? 'confirming' : 'kept',
  };
}

/**
 * Fit the tools lens through the last completed season, backtest it on the forward seasons (nested, paired, unshrunk and as served), and
 * let the detector decide each part, given what served before (`previous`: hysteresis and the confirmation count).
 */
export function fitTools(input: ToolsInputCases, basis: ToolsFitBasis, previous: ToolsModel | null, policyIn: ToolsFitPolicy = TOOLS_FIT_POLICY, detector: DetectorPolicy = DETECTOR_POLICY): CalibrationRun<ToolsModel> {
  const through = basis.throughSeason as number;
  const cases = input.cases.filter((c) => c.target <= through);
  const seasons = input.forwardSeasons.filter((s) => s <= through);
  const scoped = { ...input, cases, forwardSeasons: seasons };
  const needed = detector.minOrigins + 1;
  // Why a part could not be judged, truly: no forward season, fewer than judging needs, or enough seasons with too few hitters in them
  const undecided = seasons.length === 0 ? 'forward' as const : seasons.length < needed ? 'few_forward' as const : 'thin' as const;
  const bt = backtestTools(scoped, policyIn);
  const all = centred(cases);
  const fittedSlopes = all.length >= policyIn.minTraining ? nonNegativeSlopes(all.map((c) => ({ x: c.xc, y: c.yc, w: c.weight }))) : null;
  const shrunk = fittedSlopes ? shrinkSlopes(fittedSlopes, all.length, policyIn.shrinkCases) : null;
  // What serves is the scaled slopes: the scale that fits the forward seasons, checked with the direction in the backtest
  const unshrunkScaled = fittedSlopes ? scaled(fittedSlopes, scaleOn(fittedSlopes, all)) : null;
  const servedScaled = shrunk ? { v: scaled(shrunk.v, scaleOn(shrunk.v, all)), weight: shrunk.weight } : null;
  const bat = part<number[]>(bt.bat, previous?.bat ?? null, unshrunkScaled, servedScaled, priorSlopes(), all.length, detector, undecided);
  // The blend is checked, fitted and served under the slopes that serve beside it
  const btBlend = bat.source === 'save' ? backtestTools(scoped, policyIn, 'save').blend : bt.blend;
  const rows = blendRows(cases, input.resultsK, input.populations, () => bat.served);
  const fittedWeight = rows.length >= policyIn.minTraining ? fitWeight(rows, policyIn.weightGrid) : null;
  const blend = part<number>(btBlend, previous?.blend ?? null, fittedWeight, fittedWeight !== null ? shrinkWeight(fittedWeight, rows.length, policyIn.shrinkCases) : null, 1, rows.length, detector, undecided);
  const model: ToolsModel = { bat, blend, forwardSeasons: seasons.length };
  const gaps = cases.map((c) => c.gapDays).sort((x, y) => x - y);
  const notes: string[] = [
    `Forward cases only: the ratings a hitter carried into a season (his latest snapshot taken before the season began, at most ${430} days before it) against what he did in it. The save holds ${input.snapshots.length} snapshot date${input.snapshots.length === 1 ? '' : 's'}${input.snapshots.length ? ` (${input.snapshots.join(', ')})` : ''} and ${seasons.length} forward season${seasons.length === 1 ? '' : 's'} with cases; judging needs ${needed} (${detector.minOrigins} held out, each after one to fit on).`,
    gaps.length ? `How old the ratings were when each season began: ${gaps[0]} to ${gaps[gaps.length - 1]} days (median ${gaps[Math.floor(gaps.length / 2)]}).` : 'No forward case, so no gap between a snapshot and a season.',
    `Each part serves only where clearly better (${ruleText(detector)}).`,
    'Not built: the pitchers\' tools weight (starters and relievers keep the starting 1) and the running slopes (their forward cases need baserunning and stealing ratings stored before a season: snapshots keep them from cycle 4 on).',
    ...bt.perOrigin,
  ];
  const heldOut: CalibrationCheck[] = [];
  for (const [name, p] of [['bat', bat], ['blend', blend]] as const) {
    // Nothing held out (no forward season to score): no empty check is recorded; the gate's reason says why
    if (!p.decision || p.decision.served.cases === 0) continue;
    for (const [label, c] of [['unshrunk', p.decision.unshrunk], ['served', p.decision.served]] as const) {
      heldOut.push({
        kind: 'detector', part: `${name}:${label}`, n: c.cases, expected: c.rivalLoss, observed: c.candidateLoss, se: c.se, prior: c.rivalLoss,
        passed: c.failures.includes('origins') ? null : c.clearlyBetter,
        note: `against the starting ${name === 'bat' ? 'slopes' : 'weight'}: ${describeComparison(c)}`,
      });
    }
  }
  const engine = engineCheck(input.engine, policyIn);
  if (engine) heldOut.push(engine);
  else notes.push('The same-season engine check could not be run (too few hitters with ratings and plate appearances in the season under way).');
  const decided = [bat, blend].some((p) => p.decision?.decided);
  const judged = [bat, blend].filter((p) => p.decision?.decided).length;
  const gate: CalibrationRecord['gate'] = decided
    ? {
      passed: true, failures: [],
      reason: bat.source === 'save' || blend.source === 'save'
        ? 'Checked on forward seasons: the league\'s own serves where clearly better.'
        : judged === 2 ? 'Checked on forward seasons: the starting values held up, so they serve.'
          : 'Checked on forward seasons where it could be: the starting values held up there, and the rest could not be judged yet.',
    }
    : undecided === 'thin'
      ? { passed: false, failures: [`thin: ${seasons.length} forward seasons, too few hitters in them to judge`], reason: `Not decided: the ${seasons.length} forward seasons have too few hitters (${detector.minCasesPerOrigin} a season held out, ${policyIn.minTraining} to fit on) to judge. The starting values serve.` }
      : { passed: false, failures: [`forward: ${seasons.length} of ${needed} forward seasons`], reason: `Not decided: ${seasons.length} forward season${seasons.length === 1 ? '' : 's'} with ratings stored before it, ${needed} needed. The starting values serve.` };
  const priorWeight = (bat.priorWeight + blend.priorWeight) / 2;
  return {
    model,
    record: {
      leagueId: basis.leagueId, subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'tools', method: TOOLS_METHOD,
      basis: { throughSeason: through, gameDate: basis.gameDate },
      window: { seasons, skipped: [], sample: cases.length, unit: 'hitter-seasons with ratings stored before them' },
      heldOut, gate, notes, priorWeight: { overall: priorWeight, byPart: { bat: bat.priorWeight, blend: blend.priorWeight } },
      priorSource: 'The starting slopes (run 1\'s same-time fit on the Arizona import) and the starting tools weight 1 (the results\' own K).',
    },
  };
}

/** A model's confirmation counts carried only from the season just before (the detector's "consecutive" rule). */
export function consecutiveTools(model: ToolsModel, consecutive: boolean): ToolsModel {
  if (consecutive) return model;
  const reset = <V>(p: ToolsPart<V>): ToolsPart<V> => (p.decision ? { ...p, decision: { ...p.decision, streak: 0 } } : p);
  return { ...model, bat: reset(model.bat), blend: reset(model.blend) };
}
