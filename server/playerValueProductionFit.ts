/**
 * Player Value, concern 3: the fitting method for expected production (D-053, PLAYER_VALUE.md Part 7;
 * hardened 2026-09-23).
 *
 * Calibration belongs to the save. This is the METHOD: handed the save's own major-league history
 * (per player and season, from the export), it fits the model `playerValueProduction.ts` projects
 * with, backtests it on seasons it never saw, and says whether it may be adopted. It is pure: it
 * opens no table and writes nothing.
 *
 *   window     the most recent completed seasons of the save's own history (PRODUCTION_POLICY.window),
 *              short seasons (against their neighbours' schedules) skipped; the most recent share of them
 *              held out as targets.
 *   backtest   from each origin season O (a window of O, O−1, O−2), predict O+1 … O+7 and compare with
 *              what happened. A player who did not play in a target season produced 0 wins there; a target
 *              season whose WAR the export leaves blank is not scored at all (never a zero).
 *   cases      a listed pitcher's batting is never a hitter's case (the export's own position).
 *   fitted     the aging curve (delta method), the regression (recency weights, K, the mean), season noise;
 *              per horizon the attrition logistic (ridge-penalized, pulled toward the prior's PREDICTIONS
 *              by pseudo-cases, flagged when it separates or does not converge), the playing time per
 *              scheduled game when he plays and its spread and distribution, the rate of those who play
 *              (selection), talent drift on the recentred residual, and each cell's distribution of wins
 *              when he plays; injury proneness's effect (clustered by player, Holm across the family); the
 *              physical ceiling of playing time per scheduled game.
 *   prior      each component is shrunk toward the fallback prior by its sample, per kind AND per horizon;
 *              a prior fitted on the save's own held-out seasons is not used (B-09).
 *   gate       held-out coverage and central bias AS FITTED (no widening chosen on the held-out cases), pooled
 *              and per subgroup (kind, usage third, quality tier, age band), against the policy's tolerances.
 *              A fit that fails is recorded, never adopted.
 */

import { PRODUCTION_METHOD, PRODUCTION_POLICY, CONTROL_HORIZON_SEASONS } from './playerValueCalibration.js';
import {
  QUALITY_TIERS, agingBetween, gridQuantile, planSides, projectProductionWith, sideTrajectory, survivorRate, usageParts, usageTerms,
  usageWindow, windowOf,
  type AgingGroup, type HorizonModel, type KindModel, type ModelProvenance, type ProductionKind,
  type ProductionLine, type ProductionModel, type ProductionSide, type ProneModel, type SideTrajectory, type SurvivorTerms, type UsageTerms,
} from './playerValueProduction.js';

// ── the history a fit reads ─────────────────────────────────────────────────

export interface FitPlayer {
  playerId: number;
  /** Date of birth, parsed; null when the export has none. */
  birth: { year: number; month: number; day: number } | null;
  /** `prone_overall`, an owner-attested known fact; null when unknown. */
  proneness: number | null;
  /** Major-league lines, one per season (summed over clubs). */
  batting: ProductionLine[];
  pitching: ProductionLine[];
  /** His listed position and role as exported (1 a pitcher; a role above 0 a pitching role); null when not exported. */
  position?: number | null;
  role?: number | null;
}

export interface FitSeason {
  season: number;
  /** Games played per club over that season's schedule, against its neighbours'; null when not established. */
  scheduleShare: number | null;
  /** That season's schedule, games per club; null or absent when not established. */
  games?: number | null;
}

export interface FitHistory {
  leagueId: number;
  /** The last completed season the export holds. */
  throughSeason: number;
  seasons: FitSeason[];
  players: FitPlayer[];
}

export interface CoverageRow {
  horizon: number;
  cases: number;
  outer: number | null;
  inner: number | null;
  /** Mean of actual − central, wins. */
  bias: number | null;
  /** Mean absolute outcome, wins: the scale a bias is judged against. */
  meanAbsolute?: number | null;
  /** The bias's standard error, clustered by player. */
  biasSe?: number | null;
}

export interface GateRow extends CoverageRow {
  group: string;
}

export interface FitRecord {
  id: string;
  leagueId: number;
  throughSeason: number;
  method: string;
  window: {
    seasons: number[]; skipped: Array<{ season: number; reason: string }>; trainingThrough: number | null; holdout: number[];
    /** The seasons each held-out evaluation refit ran through (one per rolling origin). */
    refits?: number[];
    /**
     * The rolling origins (hardening, owner 2026-09-23): each origin Y projected by the method fitted on seasons ≤ Y,
     * with the cases scored from it (every horizon the fit measured, where actuals exist) and at horizon 1.
     */
    scored?: Array<{ origin: number; through: number; cases: number; horizon1: number }>;
    /** The recency half-life the fits used, seasons; null for none. */
    recencyHalfLife?: number | null;
  };
  sample: { players: number; cases: Record<ProductionKind, number[]>; agingPairs: Record<AgingGroup, number>; holdoutCases: number[] };
  priorWeight: {
    overall: number; kinds: Record<ProductionKind, number>; aging: Record<AgingGroup, number>;
    /** Per kind and horizon (1..7): the prior's share where the save had few or no cases. */
    byHorizon?: Record<ProductionKind, number[]>;
  };
  /** The prior's source seasons overlap this save's held-out seasons (the same history): the prior is not used. */
  priorOverlapsHoldout?: boolean;
  coverage: {
    /** Held-out coverage and bias as fitted: what the gate judges (no prior widening, no widening on the held-out cases). */
    asFitted: CoverageRow[];
    /** As served (with each horizon's prior widening): what a projection's `observed` reports. */
    adopted: CoverageRow[];
    byKind: Record<ProductionKind, CoverageRow[]>;
    byUsage: Record<UsageTier, CoverageRow[]>;
    byQuality?: Record<QualityTier, CoverageRow[]>;
    /** As fitted, by every subgroup the gate reads (kind, usage, quality, age) and by decile of projected rate. */
    subgroups?: Record<string, CoverageRow[]>;
    /** As fitted, among the cases that played at the target horizon (C-08): the continuous part of the band. */
    played?: CoverageRow[];
  };
  aging: Record<AgingGroup, { peakAge: number | null; declineFrom30: number; declineFrom34: number }>;
  proneness: string[];
  /** The attrition logistic's health per kind and horizon: converged, and whether the data separate. */
  logistic?: Record<ProductionKind, Array<{ converged: boolean; separated: boolean }>>;
  /** The physical ceiling measured, per kind: opportunities per scheduled game. */
  ceiling?: Record<ProductionKind, number | null>;
  gate: { passed: boolean; reason: string; tolerance: number; minimumCases: number; failures?: string[] };
  label: string;
}

export interface FitRun {
  model: ProductionModel;
  record: FitRecord;
}

/** Season totals of a history (opportunities and WAR across every batting line): a fingerprint of its seasons. */
export type SeasonTotals = Record<number, { opportunities: number; war: number }>;

export interface FitOptions {
  /** The prior to shrink toward; null fits the save alone (how the fallback prior itself is made). */
  prior: ProductionModel | null;
  /** False fits on every season (no hold-out, no gate): for making the fallback prior. */
  holdout?: boolean;
  /** The seasons the prior was fitted on (their totals): a prior fitted on the save's own held-out seasons is not used. */
  priorSource?: SeasonTotals | null;
  /**
   * The recency half-life in seasons (a training season `through − t` seasons back weighs 0.5^((through − t) / half-life));
   * null weighs every season alike. Absent: PRODUCTION_POLICY.window.recencyHalfLife. For the harness's comparison only.
   */
  recencyHalfLife?: number | null;
}

// ── small statistics ─────────────────────────────────────────────────────────

/** How a fit (or the prior in its place) that is mostly the fallback prior begins its label; the status line reads it. */
export const NOT_YET_CALIBRATED = 'not yet calibrated on this save';

/**
 * How many seasons a fit read, for its label: where it could use none, how many seasons of major-league lines
 * the league has and why none is usable (D-15), never a bare "0 seasons" beside a save with history.
 */
export function fitSeasonsNote(window: { seasons: number[]; skipped: Array<{ season: number; reason: string }> }): string {
  const n = window.seasons.length;
  if (n > 0 || window.skipped.length === 0) return `${n} season${n === 1 ? '' : 's'}`;
  const k = window.skipped.length;
  return `${k} season${k === 1 ? '' : 's'} of major-league lines, none usable: ${[...new Set(window.skipped.map((x) => x.reason))].join('; ')}`;
}

const PER = PRODUCTION_POLICY.rateUnitOpportunities;
const H = CONTROL_HORIZON_SEASONS;
const KINDS: ProductionKind[] = ['hitter', 'starter', 'reliever'];
const GROUPS: AgingGroup[] = ['hitter', 'pitcher'];
const GRID: readonly number[] = PRODUCTION_POLICY.tailGrid;
const groupOf = (kind: ProductionKind): AgingGroup => (kind === 'hitter' ? 'hitter' : 'pitcher');
/** The fewest cases a component is fitted on; below it the component is the prior's. */
const MIN_CASES = PRODUCTION_POLICY.minimumSample.fitCases;

/**
 * The rolling origins among the eligible seasons (owner, 2026-09-23): every candidate when there are at most
 * `maxOrigins`, else that many spread evenly, the first and the last always in. Shared by the results fit and the
 * ratings fit's arrival backtest (hardening F5), so both are judged by the one rule.
 */
export function rollingOrigins(candidates: number[], maxOrigins: number): number[] {
  if (candidates.length <= maxOrigins) return [...candidates];
  return [...new Set(Array.from({ length: maxOrigins }, (_, i) => candidates[Math.round((i * (candidates.length - 1)) / (maxOrigins - 1))]))];
}

/** A case's recency weight in a fit through `through`: 0.5^((through − target) / half-life); 1 with no half-life. */
export function recencyWeight(through: number | null, target: number, halfLife: number | null): number {
  return halfLife === null || through === null ? 1 : Math.pow(0.5, Math.max(0, through - target) / halfLife);
}

/** Sums of errors by cluster, for a two-way clustered standard error: e is the sum of the cluster's errors, k its cases. */
export type ClusterSums<K> = Map<K, { e: number; k: number }>;

export function addToCluster<K>(m: ClusterSums<K>, key: K, e: number): void {
  const had = m.get(key) ?? { e: 0, k: 0 };
  m.set(key, { e: had.e + e, k: had.k + 1 });
}

/**
 * The standard error of a mean error of n cases, clustered two ways (by player and by origin, the same
 * player-season appearing under several origins): V = V(player) + V(origin) − V(player × origin), never below
 * either one-way variance. The results gate's rule, shared with the arrival gate (hardening F5).
 */
export function twoWayClusteredSe(n: number, mean: number, byPlayer: ClusterSums<unknown>, byOrigin: ClusterSums<unknown>, byBoth: ClusterSums<unknown>): number {
  if (n <= 0) return 0;
  const v = (m: ClusterSums<unknown>) => [...m.values()].reduce((t, { e, k }) => t + (e - k * mean) ** 2, 0);
  const vp = v(byPlayer);
  const vo = v(byOrigin);
  return Math.sqrt(Math.max(vp + vo - v(byBoth), vp, vo)) / n;
}

export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Least squares with optional weights and an optional ridge on every coefficient but the first; null when singular. */
export function leastSquares(x: number[][], y: number[], w?: number[], ridge = 0): number[] | null {
  const k = x[0]?.length ?? 0;
  if (k === 0 || y.length <= k) return null;
  const a = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let i = 0; i < y.length; i += 1) {
    const wi = w ? w[i] : 1;
    for (let p = 0; p < k; p += 1) {
      b[p] += wi * x[i][p] * y[i];
      for (let q = 0; q < k; q += 1) a[p][q] += wi * x[i][p] * x[i][q];
    }
  }
  for (let p = 1; p < k; p += 1) a[p][p] += ridge;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c += 1) {
    let piv = c;
    for (let r = c + 1; r < k; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = c + 1; r < k; r += 1) {
      const f = m[r][c] / m[c][c];
      for (let q = c; q <= k; q += 1) m[r][q] -= f * m[c][q];
    }
  }
  const out = new Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r -= 1) {
    let s = m[r][k];
    for (let q = r + 1; q < k; q += 1) s -= m[r][q] * out[q];
    out[r] = s / m[r][r];
  }
  return out;
}

/**
 * Least squares whose coefficients at `nonNegative` are never below zero: a negative one is dropped
 * (held at zero) and the rest refitted. Null when too few cases or singular.
 */
export function nonNegativeLeastSquares(x: number[][], y: number[], nonNegative: number[], w?: number[]): number[] | null {
  const width = x[0]?.length ?? 0;
  let keep = Array.from({ length: width }, (_, j) => j);
  let out: number[] | null = null;
  for (let pass = 0; pass <= nonNegative.length; pass += 1) {
    const c = leastSquares(x.map((row) => keep.map((j) => row[j])), y, w);
    if (!c) return out;
    const full = new Array<number>(width).fill(0);
    keep.forEach((j, i) => { full[j] = c[i]; });
    out = full;
    const negative = nonNegative.filter((j) => keep.includes(j) && full[j] < 0);
    if (negative.length === 0) break;
    keep = keep.filter((j) => !negative.includes(j));
  }
  return out;
}

export interface LogisticFit {
  /** In the features' own units. */
  coefficients: number[];
  converged: boolean;
  /** The outcomes are (nearly) separated by the features: the ridge alone holds the coefficients finite. */
  separated: boolean;
}

/**
 * A logistic regression by iteratively reweighted least squares, ridge-penalized in standardized units
 * (PRODUCTION_POLICY.logistic), with the coefficients at `nonNegative` never below zero (dropped and
 * refitted). Rows may carry weights and fractional outcomes (the prior's predictions as pseudo-cases).
 * Separation and non-convergence are detected and returned, never silent. Null when it cannot be fitted.
 */
export function logisticFit(x: number[][], y: number[], nonNegative: number[], weights?: number[]): LogisticFit | null {
  const width = x[0]?.length ?? 0;
  if (width === 0 || y.length <= width) return null;
  const wts0 = weights ?? y.map(() => 1);
  const scale = Array.from({ length: width }, (_, j) => {
    if (j === 0) return 1;
    const col = x.map((r) => r[j]);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - mean) ** 2, 0) / col.length);
    return sd > 0 ? sd : 1;
  });
  const xs = x.map((r) => r.map((v, j) => v / scale[j]));
  const ridge = PRODUCTION_POLICY.logistic.ridge;
  const irls = (cols: number[]): { beta: number[]; converged: boolean } | null => {
    let beta = new Array<number>(cols.length).fill(0);
    let converged = false;
    for (let it = 0; it < PRODUCTION_POLICY.logistic.maxIterations; it += 1) {
      const z: number[] = [];
      const wts: number[] = [];
      for (let i = 0; i < xs.length; i += 1) {
        const eta = Math.min(Math.max(cols.reduce((t, j, k) => t + beta[k] * xs[i][j], 0), -30), 30);
        const p = 1 / (1 + Math.exp(-eta));
        const wi = Math.max(p * (1 - p), 1e-6);
        wts.push(wi * wts0[i]);
        z.push(eta + (y[i] - p) / wi);
      }
      const next = leastSquares(xs.map((r) => cols.map((j) => r[j])), z, wts, ridge);
      if (!next) return null;
      const change = Math.max(...next.map((b, k) => Math.abs(b - beta[k])));
      beta = next;
      if (change < 1e-7) { converged = true; break; }
    }
    return { beta, converged };
  };
  let keep = Array.from({ length: width }, (_, j) => j);
  let out: LogisticFit | null = null;
  for (let pass = 0; pass <= nonNegative.length; pass += 1) {
    const b = irls(keep);
    if (!b || b.beta.some((v) => !Number.isFinite(v))) return out;
    const full = new Array<number>(width).fill(0);
    keep.forEach((j, k) => { full[j] = b.beta[k] / scale[j]; });
    // Separation: the features classify every observed case (outcome 0 or 1) without an error, so the likelihood
    // alone would drive the coefficients to infinity; only the ridge holds them
    const observed = xs.map((r, i) => ({ r, y: y[i] })).filter((c) => c.y === 0 || c.y === 1);
    const both = observed.some((c) => c.y === 1) && observed.some((c) => c.y === 0);
    const errors = observed.filter((c) => (keep.reduce((t, j, k) => t + b.beta[k] * c.r[j], 0) > 0 ? 1 : 0) !== c.y).length;
    out = { coefficients: full, converged: b.converged, separated: both && errors === 0 };
    const negative = nonNegative.filter((j) => keep.includes(j) && full[j] < 0);
    if (negative.length === 0) break;
    keep = keep.filter((j) => !negative.includes(j));
  }
  return out;
}

/** Shrink a fitted value toward the prior's by sample: the prior weighs strength ÷ (n + strength). */
export const blend = (fit: number | null, prior: number | null, n: number, strength: number): number => {
  if (fit === null || !Number.isFinite(fit)) return prior ?? 0;
  if (prior === null) return fit;
  const w = strength / (n + strength);
  return (1 - w) * fit + w * prior;
};
const priorShare = (n: number, strength: number, hasPrior: boolean): number => (hasPrior ? strength / (n + strength) : 0);

export function ageOn(birth: FitPlayer['birth'], season: number): number | null {
  if (!birth) return null;
  return season - birth.year - (birth.month > 7 || (birth.month === 7 && birth.day > 1) ? 1 : 0);
}

/**
 * A ratio effect Σa ÷ Σp with its standard error CLUSTERED by the player each row belongs to (B-08):
 * repeating one player's rows never makes an effect look more certain.
 */
export function ratioEffect(rows: Array<{ a: number; p: number; cluster: number }>): { m: number; se: number; clusters: number } {
  const A = rows.reduce((t, r) => t + r.a, 0);
  const P = rows.reduce((t, r) => t + r.p, 0);
  if (!(P > 0)) return { m: NaN, se: NaN, clusters: 0 };
  const m = A / P;
  const byCluster = new Map<number, number>();
  for (const r of rows) byCluster.set(r.cluster, (byCluster.get(r.cluster) ?? 0) + (r.a - m * r.p));
  const ss = [...byCluster.values()].reduce((t, e) => t + e * e, 0);
  return { m, se: Math.sqrt(ss) / P, clusters: byCluster.size };
}

/**
 * Holm's step-down correction over a family of tests given as z-scores, at the level `evidence` standard
 * errors would have on one test alone (two-sided): which effects are significant together.
 */
export function holmSignificant(z: number[], evidence: number): boolean[] {
  const alpha = 2 * (1 - normalCdf(evidence));
  const p = z.map((v) => (Number.isFinite(v) ? 2 * (1 - normalCdf(Math.abs(v))) : 1));
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = z.map(() => false);
  for (let k = 0; k < order.length; k += 1) {
    if (order[k][0] <= alpha / (order.length - k)) out[order[k][1]] = true;
    else break;
  }
  return out;
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Season totals of a history: the fingerprint that tells whether a prior was fitted on these same seasons. */
export function seasonTotals(history: FitHistory): SeasonTotals {
  const out: SeasonTotals = {};
  for (const p of history.players) {
    for (const l of p.batting) {
      const t = out[l.season] ?? { opportunities: 0, war: 0 };
      t.opportunities += l.opportunities;
      t.war += l.war ?? 0;
      out[l.season] = t;
    }
  }
  return out;
}

/** Whether a season's totals match the prior's source season: the same history (within half a percent of both). */
function sameSeason(a: { opportunities: number; war: number } | undefined, b: { opportunities: number; war: number } | undefined): boolean {
  if (!a || !b || !(a.opportunities > 0)) return false;
  return Math.abs(a.opportunities - b.opportunities) <= 0.005 * a.opportunities && Math.abs(a.war - b.war) <= 0.005 * Math.max(Math.abs(a.war), 1);
}

// ── the gate ─────────────────────────────────────────────────────────────────

const GATED = /^(pooled|kind:|usage:|quality:|age:)/;

/**
 * The adoption gate (D-053, hardened: B-03). Held-out coverage as fitted must be within the pooled tolerance
 * of both targets at every horizon, and within the subgroup tolerance in every subgroup with enough cases;
 * the central must not be materially AND significantly biased in any of them. Horizon 1 must be evaluable.
 */
export function judgeGate(rows: GateRow[]): { passed: boolean; reason: string; failures: string[] } {
  const g = PRODUCTION_POLICY.gate;
  const targets = PRODUCTION_POLICY.coverage;
  const evaluable = rows.filter((r) => GATED.test(r.group) && r.cases >= g.minimumCases);
  if (!evaluable.some((r) => r.group === 'pooled' && r.horizon === 1)) {
    return { passed: false, reason: `Too few held-out cases to validate: horizon 1 needs ${g.minimumCases} pooled held-out cases.`, failures: [] };
  }
  const failures: string[] = [];
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
  for (const r of evaluable) {
    const tol = r.group === 'pooled' ? g.coverage.pooled : g.coverage.subgroup;
    const off = (o: number | null, t: number) => o === null || Math.abs(o - t) > tol + 1e-12;
    if (off(r.outer, targets.outer) || off(r.inner, targets.inner)) {
      failures.push(`${r.group} h${r.horizon} coverage ${pct(r.outer)} / ${pct(r.inner)} (± ${Math.round(tol * 100)} points)`);
    }
    if (r.bias !== null && r.meanAbsolute !== null && r.meanAbsolute !== undefined) {
      const material = Math.abs(r.bias) > g.bias.relative * r.meanAbsolute && Math.abs(r.bias) > g.bias.absolute;
      const significant = r.biasSe === null || r.biasSe === undefined || Math.abs(r.bias) > g.bias.standardErrors * r.biasSe;
      if (material && significant) failures.push(`${r.group} h${r.horizon} bias ${r.bias >= 0 ? '+' : ''}${r.bias.toFixed(3)} wins (mean outcome ${r.meanAbsolute.toFixed(2)})`);
    }
  }
  const groups = new Set(evaluable.map((r) => r.group)).size;
  return failures.length === 0
    ? {
      passed: true, failures,
      reason: `Held-out coverage within ${Math.round(g.coverage.pooled * 100)} points pooled and ${Math.round(g.coverage.subgroup * 100)} in every subgroup, and the central unbiased (within ${Math.round(g.bias.relative * 100)}% of the mean outcome or ${g.bias.standardErrors} standard errors), in ${groups} groups with ${g.minimumCases}+ cases.`,
    }
    : { passed: false, failures, reason: `Held-out calibration outside the gate: ${failures.slice(0, 6).join('; ')}${failures.length > 6 ? `; and ${failures.length - 6} more` : ''}.` };
}

// ── cases ────────────────────────────────────────────────────────────────────

interface SideCase {
  player: FitPlayer;
  origin: number;
  side: ProductionSide;
  kind: ProductionKind;
  age: number; // in season origin + 1
  results: ProductionLine[];
  /** Actual WAR and opportunities per target season (0 when he had no line; war null when the export leaves it blank). */
  actual: (season: number) => { war: number | null; opportunities: number };
}

function linesThrough(lines: ProductionLine[], through: number): ProductionLine[] {
  return lines.filter((l) => l.season <= through);
}

function sideCases(players: FitPlayer[], origins: number[]): SideCase[] {
  const out: SideCase[] = [];
  for (const player of players) {
    const bySide = {
      batting: new Map(player.batting.map((l) => [l.season, l])),
      pitching: new Map(player.pitching.map((l) => [l.season, l])),
    };
    const listed = player.position === undefined && player.role === undefined ? null : { position: player.position ?? null, role: player.role ?? null };
    for (const origin of origins) {
      const age = ageOn(player.birth, origin + 1);
      if (age === null) continue;
      const batting = linesThrough(player.batting, origin).filter((l) => l.season >= origin - 3);
      const pitching = linesThrough(player.pitching, origin).filter((l) => l.season >= origin - 3);
      if (batting.length === 0 && pitching.length === 0) continue;
      const plan = planSides({ playerId: player.playerId, season: origin + 1, seasonPlayed: 0, age, batting, pitching, listed });
      if (!plan.ok) continue;
      for (const { side, kind } of plan.sides) {
        const map = bySide[side];
        out.push({
          player, origin, side, kind, age, results: plan.results[side],
          actual: (s) => {
            const l = map.get(s);
            return { war: l ? l.war : 0, opportunities: l?.opportunities ?? 0 };
          },
        });
      }
    }
  }
  return out;
}

interface Traj { c: SideCase; tr: SideTrajectory }

// ── the fit ──────────────────────────────────────────────────────────────────

export function fitProductionModel(history: FitHistory, options: FitOptions): FitRun {
  const policy = PRODUCTION_POLICY;
  const useHoldout = options.holdout !== false;

  // The window: the most recent completed seasons, short or unmeasured seasons skipped
  const skipped: FitRecord['window']['skipped'] = [];
  const window: number[] = [];
  for (const s of [...history.seasons].sort((a, b) => a.season - b.season)) {
    if (s.season > history.throughSeason || s.season <= history.throughSeason - policy.window.maxSeasons) continue;
    if (s.scheduleShare === null) skipped.push({ season: s.season, reason: 'schedule length not established' });
    else if (s.scheduleShare < policy.window.minShareOfSchedule) skipped.push({ season: s.season, reason: `short season (${Math.round(s.scheduleShare * 100)}% of its neighbours' schedule)` });
    else window.push(s.season);
  }
  const eligible = new Set(window);
  const lastSeason = window[window.length - 1] ?? null;
  // Rolling origins (owner, 2026-09-23): every origin from the window's start plus the policy's lead through the last
  // completed season less one, each projected by the method fitted through it; at most the policy's number, spread
  // evenly with the first and the last kept
  const originsAll = window.filter((o) => eligible.has(o - 1) && eligible.has(o - 2));
  const candidates = useHoldout && lastSeason !== null
    ? originsAll.filter((y) => y >= window[0] + policy.rolling.firstOriginAfter && y <= lastSeason - 1)
    : [];
  const rolling = rollingOrigins(candidates, policy.rolling.maxOrigins);
  const rollingSet = new Set(rolling);
  const holdoutSeasons = rolling.length > 0 ? window.filter((y) => y > rolling[0]) : [];
  const trainingThrough = rolling[0] ?? lastSeason;
  const halfLife = options.recencyHalfLife === undefined ? policy.window.recencyHalfLife : options.recencyHalfLife;

  // A prior fitted on these same held-out seasons is not independent evidence: fit without it (B-09)
  const source = options.priorSource ?? null;
  const own = source ? seasonTotals(history) : null;
  const priorOverlapsHoldout = source !== null && own !== null && holdoutSeasons.some((s) => sameSeason(own[s], source[s]));
  const prior = priorOverlapsHoldout ? null : options.prior;

  // Each season's schedule; one the save does not state reads at the prior's reference, else the most common
  const known = history.seasons.map((s) => s.games).filter((g): g is number => typeof g === 'number' && g > 0);
  const modal = known.length > 0 ? quantile(known, 0.5) : null;
  const referenceGames = modal ?? options.prior?.referenceGames ?? null;
  const gamesBySeason: Record<number, number | null> = {};
  for (const s of history.seasons) gamesBySeason[s.season] = typeof s.games === 'number' && s.games > 0 ? s.games : referenceGames;
  const gamesOf = (s: number): number => gamesBySeason[s] ?? referenceGames ?? 1;
  const scheduleFor = (c: SideCase) => ({ games: gamesOf(c.origin + 1), bySeason: gamesBySeason });

  const cases = sideCases(history.players, originsAll);
  // The seasons a component is fitted through: set by each fit below (the evaluation's refits, then the served fit)
  let fitThrough: number | null = trainingThrough;
  const inTraining = (c: SideCase, h: number) => fitThrough !== null && c.origin + h <= fitThrough && eligible.has(c.origin + h) && c.actual(c.origin + h).war !== null;
  const horizonsOf = (c: SideCase, keep: (c: SideCase, h: number) => boolean) => Array.from({ length: H }, (_, i) => i + 1).filter((h) => keep(c, h));
  // Scored: a rolling origin's case, at every horizon its own fit measured, where the actual exists
  const originModels = new Map<number, ProductionModel>();
  const inHoldout = (c: SideCase, h: number) => {
    if (!rollingSet.has(c.origin) || lastSeason === null || c.origin + h > lastSeason || !eligible.has(c.origin + h) || c.actual(c.origin + h).war === null) return false;
    const m = originModels.get(c.origin);
    // ...never judged on a horizon its fit rests on fewer origin seasons than the policy's (no served model is that thin)
    const row = m?.kinds[c.kind]?.horizons[h - 1];
    return row !== undefined && (row.cases ?? 0) >= MIN_CASES && (row.origins ?? 0) >= policy.rolling.minimumOrigins;
  };
  const listedPitcher = (p: FitPlayer) => p.position === 1;

  /**
   * Every component, fitted on the seasons through `through` (their targets at or before it). The model a GM
   * is served is fitted through the last completed season; the held-out evaluation refits it through each
   * block of held-out origins, so what is measured is exactly what is served: the method, fitted through the
   * season before, projecting ahead (hardening: a model fitted through an old season and served years later is
   * staler than the one its record measured).
   */
  const fitComponents = (through: number | null) => {
  fitThrough = through;
  // Recent seasons weigh more where the policy says so, the same in every origin's fit and the served one
  const recent = (target: number): number => recencyWeight(through, target, halfLife);
  // ── aging: the delta method on consecutive training seasons ──
  const agingModel: ProductionModel['aging'] = { firstAge: policy.agingAges.first, hitter: [], pitcher: [] };
  const agingPairs: Record<AgingGroup, number> = { hitter: 0, pitcher: 0 };
  const pairResiduals: Record<AgingGroup, Array<{ age: number; d: number; w: number; prone: number | null; player: number }>> = { hitter: [], pitcher: [] };
  const ageSpan = policy.agingAges.last - policy.agingAges.first + 1;
  for (const group of GROUPS) {
    const pairs: Array<{ age: number; d: number; w: number; prone: number | null; player: number }> = [];
    for (const p of history.players) {
      if (group === 'hitter' && listedPitcher(p)) continue; // a pitcher's batting is not a hitter's aging
      const lines = group === 'hitter' ? p.batting : p.pitching;
      const bySeason = new Map(lines.map((l) => [l.season, l]));
      for (const a of lines) {
        const b = bySeason.get(a.season + 1);
        if (!b || a.war === null || b.war === null) continue;
        if (!eligible.has(a.season) || !eligible.has(b.season) || fitThrough === null || b.season > fitThrough) continue;
        const min = policy.minimumSample.agingOpportunities;
        if (a.opportunities < min || b.opportunities < min) continue;
        const age = ageOn(p.birth, a.season);
        if (age === null) continue;
        pairs.push({
          age, d: (b.war / b.opportunities - a.war / a.opportunities) * PER,
          w: ((2 * a.opportunities * b.opportunities) / (a.opportunities + b.opportunities)) * recent(b.season), prone: p.proneness, player: p.playerId,
        });
      }
    }
    agingPairs[group] = pairs.length;
    pairResiduals[group] = pairs;
    const fit = pairs.length >= policy.minimumSample.agingPairs ? leastSquares(pairs.map((x) => [1, x.age - 30, (x.age - 30) ** 2]), pairs.map((x) => x.d), pairs.map((x) => x.w)) : null;
    const ages = pairs.map((x) => x.age);
    const lo = quantile(ages, 0.01) ?? 0;
    const hi = quantile(ages, 0.99) ?? 0;
    const table: number[] = [];
    for (let i = 0; i < ageSpan; i += 1) {
      const a = agingModel.firstAge + i;
      const x = Math.min(Math.max(a, lo), hi) - 30;
      const fitted = fit ? fit[0] + fit[1] * x + fit[2] * x * x : null;
      const priorAt = prior ? prior.aging[group][Math.min(Math.max(a - prior.aging.firstAge, 0), prior.aging[group].length - 1)] : null;
      table.push(blend(fitted, priorAt, pairs.length, policy.prior.agingStrength));
    }
    agingModel[group] = table;
  }
  for (const group of GROUPS) {
    for (const x of pairResiduals[group]) {
      const i = Math.min(Math.max(x.age - agingModel.firstAge, 0), agingModel[group].length - 1);
      x.d -= agingModel[group][i];
    }
  }

  // ── the physical ceiling: the most opportunities per scheduled game in a season of the window, per kind ──
  const ceiling: Record<ProductionKind, number | null> = { hitter: null, starter: null, reliever: null };
  for (const p of history.players) {
    for (const l of p.batting) {
      if (listedPitcher(p) || !eligible.has(l.season)) continue;
      ceiling.hitter = Math.max(ceiling.hitter ?? 0, l.opportunities / gamesOf(l.season));
    }
    for (const l of p.pitching) {
      if (!eligible.has(l.season) || !(l.games && l.games > 0)) continue;
      const kind: ProductionKind = (l.starts ?? 0) / l.games >= policy.starterShare ? 'starter' : 'reliever';
      ceiling[kind] = Math.max(ceiling[kind] ?? 0, l.opportunities / gamesOf(l.season));
    }
  }

  // ── the spread of player-season rates in the window, per kind: the WAR scale, stated beside the model ──
  const spreadAcc: Record<ProductionKind, Array<{ o: number; r: number }>> = { hitter: [], starter: [], reliever: [] };
  for (const p of history.players) {
    for (const l of p.batting) {
      if (listedPitcher(p) || !eligible.has(l.season) || l.war === null || l.opportunities < policy.priorAdaptation.minimumOpportunities) continue;
      spreadAcc.hitter.push({ o: l.opportunities, r: (l.war / l.opportunities) * PER });
    }
    for (const l of p.pitching) {
      if (!eligible.has(l.season) || l.war === null || !(l.games && l.games > 0) || l.opportunities < policy.priorAdaptation.minimumOpportunities) continue;
      spreadAcc[(l.starts ?? 0) / l.games >= policy.starterShare ? 'starter' : 'reliever'].push({ o: l.opportunities, r: (l.war / l.opportunities) * PER });
    }
  }
  const observedSpread = (xs: Array<{ o: number; r: number }>): number | null => {
    const O = xs.reduce((t, x) => t + x.o, 0);
    if (xs.length < 2 || !(O > 0)) return null;
    const m = xs.reduce((t, x) => t + x.o * x.r, 0) / O;
    return Math.sqrt(xs.reduce((t, x) => t + x.o * (x.r - m) ** 2, 0) / O);
  };

  // ── regression: recency weights, K and the mean, per kind, on horizon-1 training cases ──
  const kinds = {} as Record<ProductionKind, KindModel>;
  const caseCounts = {} as Record<ProductionKind, number[]>;
  const kindPriorWeight = {} as Record<ProductionKind, number>;
  const byHorizonPrior = {} as Record<ProductionKind, number[]>;
  const logisticHealth = {} as Record<ProductionKind, Array<{ converged: boolean; separated: boolean }>>;
  const S = policy.prior.strength;
  const pivot = policy.usagePivotAge;
  for (const kind of KINDS) {
    const group = groupOf(kind);
    const mine = cases.filter((c) => c.kind === kind);
    const h1 = mine.filter((c) => inTraining(c, 1) && c.actual(c.origin + 1).opportunities > 0);
    const rows = h1.map((c) => {
      const { slots } = windowOf(c.results, c.origin + 1, 0);
      const act = c.actual(c.origin + 1);
      const ag = agingBetween(agingModel[group], agingModel.firstAge, c.age - 1, c.age) / PER;
      return { slots, A: act.opportunities, R: recent(c.origin + 1), y: (act.war as number) / act.opportunities, ag };
    });
    let best: { w1: number; w2: number; K: number; mu: number; sse: number } | null = null;
    if (rows.length >= MIN_CASES) {
      for (const w1 of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
        for (const w2 of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
          if (w2 > w1) continue;
          for (const K of [100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000]) {
            let sab = 0;
            let sbb = 0;
            const parts = rows.map((r) => {
              const n = r.slots[0].opportunities + w1 * r.slots[1].opportunities + w2 * r.slots[2].opportunities;
              const num = r.slots[0].war + w1 * r.slots[1].war + w2 * r.slots[2].war;
              const a = num / (n + K);
              const b = K / (n + K);
              sab += r.R * r.A * b * (r.y - a - r.ag);
              sbb += r.R * r.A * b * b;
              return { a, b };
            });
            const mu = sbb > 0 ? sab / sbb : 0;
            let sse = 0;
            rows.forEach((r, i) => { sse += r.R * r.A * (r.y - parts[i].a - parts[i].b * mu - r.ag) ** 2; });
            if (!best || sse < best.sse) best = { w1, w2, K, mu, sse };
          }
        }
      }
    }
    const pk = prior?.kinds[kind] ?? null;
    const n1 = rows.length;
    const weights: [number, number, number] = [1, blend(best?.w1 ?? null, pk?.weights[1] ?? null, n1, S), blend(best?.w2 ?? null, pk?.weights[2] ?? null, n1, S)];
    const stabilization = blend(best?.K ?? null, pk?.stabilization ?? null, n1, S);
    const mean600 = blend(best ? best.mu * PER : null, pk?.mean600 ?? null, n1, S);
    let rr = 0;
    let den = 0;
    let rate2 = 0;
    let aw = 0;
    for (const r of rows) {
      const n = r.slots[0].opportunities + weights[1] * r.slots[1].opportunities + weights[2] * r.slots[2].opportunities;
      const num = r.slots[0].war + weights[1] * r.slots[1].war + weights[2] * r.slots[2].war;
      const pred = (num + (mean600 / PER) * stabilization) / (n + stabilization) + r.ag;
      rr += r.R * (r.y * r.A - pred * r.A) ** 2;
      den += r.R * (r.A + (r.A * r.A) / (n + stabilization));
      rate2 += r.R * r.A * pred * pred;
      aw += r.R * r.A;
    }
    const noise600 = blend(den > 0 ? (rr / den) * PER : null, pk?.noise600 ?? null, n1, S);
    const rateScale600 = blend(aw > 0 ? Math.sqrt(rate2 / aw) * PER : null, pk?.rateScale600 ?? null, n1, S);
    kindPriorWeight[kind] = priorShare(n1, S, prior !== null);

    // Playing time per horizon, per scheduled game: the chance of any (a ridge logistic pulled toward the
    // prior's PREDICTIONS by pseudo-cases, B-14) and the playing time when he plays (least squares, pulled
    // the same way), each on the window's three slots per game, his projected quality and his age
    const horizons: HorizonModel[] = [];
    const counts: number[] = [];
    const priorWeights: number[] = [];
    const health: Array<{ converged: boolean; separated: boolean }> = [];
    const originRate = (c: SideCase): number => {
      const { slots } = windowOf(c.results, c.origin + 1, 0);
      const n = slots[0].opportunities + weights[1] * slots[1].opportunities + weights[2] * slots[2].opportunities;
      const num = slots[0].war + weights[1] * slots[1].war + weights[2] * slots[2].war;
      return ((num + (mean600 / PER) * stabilization) / (n + stabilization)) * PER;
    };
    for (let h = 1; h <= H; h += 1) {
      const set = mine.filter((c) => inTraining(c, h));
      counts.push(set.length);
      const feats = set.map((c) => {
        const U = usageWindow(c.results, c.origin + 1, 0, gamesOf, () => null).observed;
        const ageO = c.age - 1;
        const q = Math.max(0, originRate(c) + agingBetween(agingModel[group], agingModel.firstAge, ageO, c.age + h - 1));
        return [1, U[0], U[1], U[2], q, Math.max(0, ageO - pivot), Math.max(0, pivot - ageO)];
      });
      const ys = set.map((c) => c.actual(c.origin + h).opportunities / gamesOf(c.origin + h));
      const ph = pk?.horizons[h - 1] ?? null;
      const n = set.length;
      const NONNEG = [1, 2, 3, 4];
      const toTerms = (f: number[]): UsageTerms => ({ intercept: f[0], recent: [f[1], f[2], f[3]], quality: f[4], older: f[5], younger: f[6] });
      const U3 = (f: number[]) => [f[1], f[2], f[3]];
      const ageOf = (f: number[]) => pivot + f[5] - f[6];
      const priorHasTerms = ph !== null && ph.playSpread !== undefined;
      // The prior's pseudo-cases weigh S in all, on the same scale as the recency-weighted cases (their mean weight)
      const meanWeight = n > 0 ? set.reduce((t, c) => t + recent(c.origin + h), 0) / n : 1;
      // The attrition logistic, with the prior's predictions as pseudo-cases of total weight S
      let chance: UsageTerms;
      if (n >= MIN_CASES) {
        const x = [...feats];
        const y: number[] = ys.map((v) => (v > 0 ? 1 : 0));
        const w = set.map((c) => recent(c.origin + h));
        if (priorHasTerms) {
          for (const f of feats) { x.push(f); y.push(usageParts(ph!, U3(f), f[4], ageOf(f), pivot).chance); w.push((S / n) * meanWeight); }
        }
        const fit = logisticFit(x, y, NONNEG, w);
        health.push({ converged: fit?.converged ?? false, separated: fit?.separated ?? false });
        chance = fit ? toTerms(fit.coefficients) : (ph?.chance ?? toTerms([0, 0, 0, 0, 0, 0, 0]));
      } else {
        health.push({ converged: false, separated: false });
        chance = ph?.chance ?? toTerms([0, 0, 0, 0, 0, 0, 0]);
      }
      // Playing time per game when he plays
      const played = ys.map((y, i) => [y, i] as const).filter(([y]) => y > 0);
      let conditional: UsageTerms;
      if (played.length >= MIN_CASES) {
        const x = played.map(([, i]) => feats[i]);
        const y = played.map(([v]) => v);
        const w = played.map(([, i]) => recent(set[i].origin + h));
        if (priorHasTerms) {
          for (const [, i] of played) { x.push(feats[i]); y.push(usageParts(ph!, U3(feats[i]), feats[i][4], ageOf(feats[i]), pivot).perGame); w.push((S / played.length) * meanWeight); }
        }
        const fit = nonNegativeLeastSquares(x, y, NONNEG, w);
        conditional = fit ? toTerms(fit) : (ph?.conditional ?? toTerms([0, 0, 0, 0, 0, 0, 0]));
      } else conditional = ph?.conditional ?? toTerms([0, 0, 0, 0, 0, 0, 0]);
      for (const t of [chance, conditional]) { t.recent = t.recent.map((v) => Math.max(0, v)) as [number, number, number]; t.quality = Math.max(0, t.quality); }
      // The spread and distribution of playing time when he plays
      const pred = played.map(([, i]) => Math.max(0, usageTerms(conditional, U3(feats[i]), feats[i][4], ageOf(feats[i]), pivot)));
      const absRes = played.map(([y], j) => Math.abs(y - pred[j]));
      let spread: { base: number; slope: number } | null = null;
      if (played.length >= MIN_CASES) {
        const c = leastSquares(pred.map((p) => [1, p]), absRes);
        if (c && c[0] >= 0 && c[1] >= 0) spread = { base: c[0], slope: c[1] };
        else if (c && c[0] < 0) spread = { base: 0, slope: Math.max(0, leastSquares(pred.map((p) => [p]), absRes)?.[0] ?? 0) };
        else spread = { base: absRes.reduce((a, b) => a + b, 0) / Math.max(absRes.length, 1), slope: 0 };
      }
      const playSpread = {
        base: Math.max(0, blend(spread?.base ?? null, ph?.playSpread?.base ?? null, played.length, S)),
        slope: Math.max(0, blend(spread?.slope ?? null, ph?.playSpread?.slope ?? null, played.length, S)),
      };
      const zs = played.map(([y], j) => {
        const sd = playSpread.base + playSpread.slope * pred[j];
        return sd > 0 ? (y - pred[j]) / sd : null;
      }).filter((v): v is number => v !== null);
      const usageZ = gridOf(zs, ph?.usageZ ?? null, zs.length);
      const pw = priorShare(n, S, prior !== null);
      priorWeights.push(pw);
      horizons.push({
        chance, conditional, playSpread, usageZ,
        survivor: ph?.survivor ?? { intercept: 0, slope: 1, older: 0, younger: 0 },
        tails: [], drift600: 0, cases: n, origins: new Set(set.map((c) => c.origin)).size, priorWeight: pw,
      });
    }
    caseCounts[kind] = counts;
    byHorizonPrior[kind] = priorWeights;
    logisticHealth[kind] = health;
    kinds[kind] = {
      weights, stabilization, mean600, noise600, rateScale600, horizons, usageCuts: [],
      ceiling: ceiling[kind] ?? prior?.kinds[kind]?.ceiling ?? null, observedSpread600: observedSpread(spreadAcc[kind]), priorWeight: 0,
    };

    // The rate of the players who play at each horizon (selection, B-01): weighted by the opportunities they
    // played, on the rate projected for them (aged to that season) and their age
    for (let h = 1; h <= H; h += 1) {
      const ph = pk?.horizons[h - 1] ?? null;
      const set = mine.filter((c) => inTraining(c, h) && c.actual(c.origin + h).opportunities > 0);
      const x = set.map((c) => {
        const ageO = c.age - 1;
        const U = usageWindow(c.results, c.origin + 1, 0, gamesOf, () => null).observed;
        return [1, originRate(c), Math.max(0, ageO - pivot), Math.max(0, pivot - ageO), (U[0] + U[1] + U[2]) / 3];
      });
      const y = set.map((c) => ((c.actual(c.origin + h).war as number) / c.actual(c.origin + h).opportunities) * PER);
      const w = set.map((c) => c.actual(c.origin + h).opportunities * recent(c.origin + h));
      const fit = set.length >= MIN_CASES ? nonNegativeLeastSquares(x, y, [1], w) : null;
      // Shrunk toward the prior's, or, with no prior, toward the horizon before (a horizon with few cases leans
      // on its neighbour, never on a made-up default)
      const pt: SurvivorTerms | null = ph?.survivor ?? (h > 1 ? kinds[kind].horizons[h - 2].survivor : null);
      const n = set.length;
      const none = fit === null && pt === null;
      kinds[kind].horizons[h - 1].survivor = none ? { intercept: 0, slope: 1, older: 0, younger: 0, usage: 0 } : {
        intercept: blend(fit?.[0] ?? null, pt?.intercept ?? null, n, S),
        slope: Math.max(0, blend(fit?.[1] ?? null, pt?.slope ?? null, n, S)),
        older: blend(fit?.[2] ?? null, pt?.older ?? null, n, S),
        younger: blend(fit?.[3] ?? null, pt?.younger ?? null, n, S),
        usage: blend(fit?.[4] ?? null, pt?.usage ?? null, n, S),
      };
    }
  }

  let model: ProductionModel = {
    method: PRODUCTION_METHOD,
    kinds,
    aging: agingModel,
    usagePivotAge: policy.usagePivotAge,
    proneness: null,
    referenceGames,
  };

  const trajectoryOf = (c: SideCase, m: ProductionModel, withProneness = true): SideTrajectory =>
    sideTrajectory(c.side, c.kind, c.results, c.results, {
      season: c.origin + 1, f: 0, age: c.age, horizon: H, proneness: withProneness ? c.player.proneness : null, schedule: scheduleFor(c),
    }, m);

  // ── injury proneness: its effect on usage and on aging, clustered by player, held to Holm's rule together ──
  const findings: string[] = [];
  const knownProne = [...new Set(cases.filter((c) => inTraining(c, 1) && c.player.proneness !== null).map((c) => c.player))].map((p) => p.proneness as number);
  if (knownProne.length >= 3 * policy.proneness.bands) {
    const bands = policy.proneness.bands;
    const cuts = Array.from({ length: bands - 1 }, (_, i) => quantile(knownProne, (i + 1) / bands) as number);
    const bandOf = (v: number) => { const i = cuts.findIndex((c) => v <= c); return i === -1 ? cuts.length : i; };
    const prone: ProneModel = {
      cuts,
      usage: { hitter: new Array(bands).fill(1), pitcher: new Array(bands).fill(1) },
      aging: { hitter: Array.from({ length: bands }, () => [0, 0] as [number, number]), pitcher: Array.from({ length: bands }, () => [0, 0] as [number, number]) },
      ageSplit: policy.proneness.ageSplit,
      findings,
    };
    const label = (b: number) => (b === 0 ? `≤ ${cuts[0].toFixed(0)}` : b === bands - 1 ? `> ${cuts[bands - 2].toFixed(0)}` : `${cuts[b - 1].toFixed(0)}–${cuts[b].toFixed(0)}`);
    // Every test in the family first, then Holm across them all
    const tests: Array<{ z: number; apply: () => void; text: (used: boolean) => string }> = [];
    for (const group of GROUPS) {
      const rowsByBand = Array.from({ length: bands }, () => [] as Array<{ a: number; p: number; cluster: number }>);
      for (const c of cases) {
        if (groupOf(c.kind) !== group || c.player.proneness === null) continue;
        const tr = trajectoryOf(c, model, false);
        for (let h = 1; h <= policy.proneness.usageHorizons; h += 1) {
          if (!inTraining(c, h)) continue;
          rowsByBand[bandOf(c.player.proneness)].push({ a: c.actual(c.origin + h).opportunities, p: tr.seasons[h - 1].P, cluster: c.player.playerId });
        }
      }
      const all = ratioEffect(rowsByBand.flat());
      rowsByBand.forEach((rows, b) => {
        if (rows.length === 0 || !(all.m > 0)) return;
        const e = ratioEffect(rows);
        const m = e.m / all.m;
        const se = e.se / all.m;
        tests.push({
          z: se > 0 ? (m - 1) / se : 0,
          apply: () => { prone.usage[group][b] = m; },
          text: (used) => `${group === 'hitter' ? 'Hitters' : 'Pitchers'}, proneness ${label(b)}: playing time ${(m * 100).toFixed(1)}% of the league's rate for the same expected usage (± ${(se * 100).toFixed(1)}, clustered by player: ${e.clusters} players, ${rows.length} seasons, horizons 1–${policy.proneness.usageHorizons})${used ? '' : ' — not distinguishable from none (Holm), not used'}.`,
        });
      });
      for (let b = 0; b < bands; b += 1) {
        for (const [gi, name] of [[0, `under ${policy.proneness.ageSplit}`], [1, `${policy.proneness.ageSplit} and over`]] as Array<[number, string]>) {
          const xs = pairResiduals[group].filter((x) => x.prone !== null && bandOf(x.prone) === b && (gi === 0 ? x.age < policy.proneness.ageSplit : x.age >= policy.proneness.ageSplit));
          const sw = xs.reduce((t, x) => t + x.w, 0);
          if (sw <= 0 || xs.length < policy.minimumSample.agingPairs) {
            findings.push(`${group === 'hitter' ? 'Hitters' : 'Pitchers'}, proneness ${label(b)}, ${name}: too few aging pairs (${xs.length}) to measure; not used.`);
            continue;
          }
          const mean = xs.reduce((t, x) => t + x.w * x.d, 0) / sw;
          const byPlayer = new Map<number, number>();
          for (const x of xs) byPlayer.set(x.player, (byPlayer.get(x.player) ?? 0) + x.w * (x.d - mean));
          const se = Math.sqrt([...byPlayer.values()].reduce((t, e) => t + e * e, 0)) / sw;
          tests.push({
            z: se > 0 ? mean / se : 0,
            apply: () => { prone.aging[group][b][gi] = mean; },
            text: (used) => `${group === 'hitter' ? 'Hitters' : 'Pitchers'}, proneness ${label(b)}, ${name}: aging ${mean >= 0 ? '+' : ''}${mean.toFixed(3)} WAR per ${PER} a year against the curve (± ${se.toFixed(3)}, clustered: ${byPlayer.size} players, ${xs.length} pairs)${used ? '' : ' — not distinguishable from none (Holm), not used'}.`,
          });
        }
      }
    }
    const significant = holmSignificant(tests.map((t) => t.z), policy.proneness.evidence);
    tests.forEach((t, i) => { if (significant[i]) t.apply(); findings.push(t.text(significant[i])); });
    model = { ...model, proneness: prone };
  } else {
    findings.push(`Injury proneness is known for ${knownProne.length} of the players behind the fit: too few to measure an effect, so proneness moves nothing.`);
  }

  const training = cases.filter((c) => horizonsOf(c, inTraining).length > 0);

  // ── drift: the rate variance no sample removes, on the residual of the players who played, recentred ──
  //
  // E[(actual − μ)²] = S₀² + (m² + σm²) × drift for a player who played, around the selection-corrected μ,
  // so bias is never read as variance (B-01).
  for (const kind of KINDS) {
    const k = kinds[kind];
    const pk = prior?.kinds[kind] ?? null;
    const trs = training.filter((c) => c.kind === kind).map((c) => ({ c, tr: trajectoryOf(c, model) }));
    // Young players' talent drifts more (they break out or wash out): their drift is fitted apart (B-04)
    const young = PRODUCTION_POLICY.ageBands[0];
    k.horizons.forEach((row, i) => {
      const moments = (keep: (c: SideCase) => boolean) => {
        let num = 0;
        let den = 0;
        let n = 0;
        for (const { c, tr } of trs) {
          if (!inTraining(c, i + 1) || !keep(c)) continue;
          const act = c.actual(c.origin + i + 1);
          if (!(act.opportunities > 0)) continue;
          const x = tr.seasons[i].reading;
          const resid = (act.war as number) - x.mu;
          const a = (x.m * x.m + x.sigmaM * x.sigmaM) / (PER * PER);
          const r = recent(c.origin + i + 1);
          num += r * a * (resid * resid - x.S * x.S);
          den += r * a * a;
          n += 1;
        }
        return { fitted: n >= MIN_CASES && den > 0 ? Math.max(0, num / den) : null, n };
      };
      const all = moments(() => true);
      row.drift600 = Math.max(0, blend(all.fitted, pk?.horizons[i]?.drift600 ?? null, all.n, S));
      const y = moments((c) => c.age <= young);
      row.driftYoung600 = Math.max(0, blend(y.fitted, pk?.horizons[i]?.driftYoung600 ?? row.drift600, y.n, S));
    });
  }

  // ── cuts: thirds of expected usage per game at horizon 1, and the tenths of projected rate ──
  const TIERS = policy.usageTiers;
  for (const kind of KINDS) {
    const k = kinds[kind];
    const pk = prior?.kinds[kind] ?? null;
    const set = cases.filter((c) => c.kind === kind && inTraining(c, 1));
    const trs = set.map((c) => trajectoryOf(c, model));
    const p1 = trs.map((tr, j) => tr.seasons[0].P / gamesOf(set[j].origin + 1));
    const n = p1.length;
    const priorCutsPerGame = pk?.usageCuts && pk.horizons[0]?.playSpread !== undefined ? pk.usageCuts : null;
    k.usageCuts = Array.from({ length: TIERS - 1 }, (_, j) =>
      blend(n >= MIN_CASES ? quantile(p1, (j + 1) / TIERS) : null, priorCutsPerGame?.[j] ?? null, n, S));
    const r1 = trs.map((tr) => tr.qualityRate);
    k.qualityCuts = [
      blend(n >= MIN_CASES ? quantile(r1, policy.qualityTiers.edges[0]) : null, pk?.qualityCuts?.[0] ?? null, n, S),
      blend(n >= MIN_CASES ? quantile(r1, policy.qualityTiers.edges[1]) : null, pk?.qualityCuts?.[1] ?? null, n, S),
    ];
  }

  // ── tails: each cell's distribution of wins when he plays, as multiples of S, per horizon ──
  const trainTr: Traj[] = training.map((c) => ({ c, tr: trajectoryOf(c, model) }));
  const zOf = (items: Traj[], i: number): number[] => items
    .filter((t) => inTraining(t.c, i + 1) && t.c.actual(t.c.origin + i + 1).opportunities > 0 && t.tr.seasons[i].reading.S > 0)
    .map((t) => (((t.c.actual(t.c.origin + i + 1).war as number) - t.tr.seasons[i].reading.mu) / t.tr.seasons[i].reading.S));
  for (const kind of KINDS) {
    const k = kinds[kind];
    const pk = prior?.kinds[kind] ?? null;
    const priorGrid = (i: number, cell: number): number[] | null => {
      const row = pk?.horizons[i]?.tails;
      const g = Array.isArray(row) ? row[cell] : null;
      return Array.isArray(g) && g.length === GRID.length ? g : null;
    };
    const mineKind = trainTr.filter((t) => t.c.kind === kind);
    const pooledByTier: number[][][] = [];
    for (let tier = 0; tier < TIERS; tier += 1) {
      const mine = mineKind.filter((t) => t.tr.tier === tier);
      pooledByTier.push(k.horizons.map((_, i) => {
        const z = zOf(mine, i);
        return gridOf(z, priorGrid(i, 1 * TIERS + tier), z.length);
      }));
    }
    for (let quality = 0; quality < QUALITY_TIERS; quality += 1) {
      for (let tier = 0; tier < TIERS; tier += 1) {
        const mine = mineKind.filter((t) => t.tr.tier === tier && t.tr.quality === quality);
        k.horizons.forEach((row, i) => {
          const z = zOf(mine, i);
          row.tails[quality * TIERS + tier] = z.length >= MIN_CASES ? gridOf(z, priorGrid(i, quality * TIERS + tier), z.length) : [...pooledByTier[tier][i]];
        });
      }
    }
    // Young players' own cells, by quality tier; a thin one takes the middle tier's regular cell
    for (let quality = 0; quality < QUALITY_TIERS; quality += 1) {
      const mine = mineKind.filter((t) => t.tr.young && t.tr.quality === quality);
      k.horizons.forEach((row, i) => {
        const z = zOf(mine, i);
        const cell = TIERS * QUALITY_TIERS + quality;
        row.tails[cell] = z.length >= MIN_CASES ? gridOf(z, priorGrid(i, cell), z.length) : [...row.tails[quality * TIERS + TIERS - 1]];
      });
    }
    k.priorWeight = kindPriorWeight[kind];
  }

  return { model, kinds, caseCounts, byHorizonPrior, kindPriorWeight, logisticHealth, agingPairs, agingModel, findings, ceiling };
  };

  // ── the held-out evidence: every rolling origin projected by the method fitted through it (owner, 2026-09-23) ──
  const refits: number[] = [];
  for (const y of rolling) {
    originModels.set(y, fitComponents(y).model);
    refits.push(y);
  }
  const holdoutCases = cases.filter((c) => horizonsOf(c, inHoldout).length > 0);
  const scored = rolling.map((y) => {
    const mine = holdoutCases.filter((c) => c.origin === y);
    return { origin: y, through: y, cases: mine.reduce((t, c) => t + horizonsOf(c, inHoldout).length, 0), horizon1: mine.filter((c) => inHoldout(c, 1)).length };
  });
  // ...and the model served: the same method through the last completed season in the window
  const { model, kinds, caseCounts, byHorizonPrior, kindPriorWeight, logisticHealth, agingPairs, agingModel, findings, ceiling } =
    fitComponents(lastSeason);
  const blockModels = originModels;
  const bareOf = (m: ProductionModel): ProductionModel => ({ ...m, kinds: Object.fromEntries(KINDS.map((kind) => [kind, { ...m.kinds[kind], priorWeight: 0, horizons: m.kinds[kind].horizons.map((h) => ({ ...h, priorWeight: 0 })) }])) as Record<ProductionKind, KindModel> });
  const bareBlocks = new Map([...blockModels.entries()].map(([o, m]) => [o, bareOf(m)]));
  const asFitted = coverageOf(holdoutCases, (c) => bareBlocks.get(c.origin) ?? bareOf(model), inHoldout, scheduleFor);
  const served = holdoutCases.length > 0 ? coverageOf(holdoutCases, (c) => blockModels.get(c.origin) ?? model, inHoldout, scheduleFor) : asFitted;

  const gateRows: GateRow[] = Object.entries(asFitted.subgroups).flatMap(([group, rows]) => rows.map((r) => ({ ...r, group })));
  let { passed, reason, failures } = judgeGate(gateRows);
  if (holdoutCases.length === 0) {
    passed = false;
    const usable = window.length === 0 && skipped.length > 0 ? fitSeasonsNote({ seasons: window, skipped }) : `${window.length} usable season${window.length === 1 ? '' : 's'}`;
    reason = `Too few held-out seasons to validate (${usable}; horizon 1 needs ${policy.gate.minimumCases} held-out cases).`;
  }
  if (!useHoldout) {
    passed = true;
    reason = 'Fitted on every season, no hold-out: the fallback prior is made this way and is provisional.';
    failures = [];
  }

  const priorAging = { hitter: priorShare(agingPairs.hitter, policy.prior.agingStrength, prior !== null), pitcher: priorShare(agingPairs.pitcher, policy.prior.agingStrength, prior !== null) };
  const allCases = KINDS.reduce((t, k) => t + (caseCounts[k][0] ?? 0), 0);
  const overall = priorShare(allCases, policy.prior.strength, prior !== null);
  const id = `${history.leagueId}:${history.throughSeason}:${PRODUCTION_METHOD}`;
  const first = window[0];
  // Which horizons are the save's own, and which still mostly the prior (B-10)
  // A horizon is still mostly the prior where any kind's is (the most any kind leans on it)
  const pooledByHorizon = Array.from({ length: H }, (_, i) => Math.max(...KINDS.map((k) => byHorizonPrior[k]?.[i] ?? 0)));
  const mostlyPrior = pooledByHorizon.map((w, i) => (w >= 0.5 ? i + 1 : null)).filter((h): h is number => h !== null);
  const span = (hs: number[]) => (hs.length === 0 ? '' : hs.length === 1 ? `${hs[0]}` : `${hs[0]}–${hs[hs.length - 1]}`);
  // Calibrated on this save only where the save's own seasons carry the fit, it was measured on held-out seasons,
  // and at least one horizon is the save's own: a fit never scored, or mostly the prior at every horizon, is not
  // the save's calibration, and is stamped provisional wherever it is served (D-09). Whether a horizon is the
  // save's own is read over its cases (a kind the league hardly has does not take the others' calibration away)
  const ownAt = Array.from({ length: H }, (_, i) => {
    let n = 0;
    let w = 0;
    for (const k of KINDS) {
      const c = caseCounts[k]?.[i] ?? 0;
      n += c;
      w += c * (byHorizonPrior[k]?.[i] ?? 1);
    }
    return n > 0 && w / n < 0.5;
  });
  const label = overall >= 0.5 || window.length === 0 || holdoutCases.length === 0 || !ownAt.some(Boolean)
    ? `${NOT_YET_CALIBRATED} (${fitSeasonsNote({ seasons: window, skipped })}): mostly the fallback prior`
    : `calibrated on this save's seasons ${first}–${lastSeason} (${window.length}), projected from rolling origins ${rolling[0] ?? '—'}–${rolling[rolling.length - 1] ?? '—'}${
      mostlyPrior.length > 0 ? `; horizons ${span(mostlyPrior)} mostly the fallback prior (too few seasons that far ahead)` : ''}${
      priorOverlapsHoldout ? '; the fallback prior was fitted on these same seasons, so it is not used' : ''}`;

  const record: FitRecord = {
    id, leagueId: history.leagueId, throughSeason: history.throughSeason, method: PRODUCTION_METHOD,
    window: { seasons: window, skipped, trainingThrough, holdout: holdoutSeasons, refits, scored, recencyHalfLife: halfLife },
    sample: {
      players: new Set(cases.map((c) => c.player.playerId)).size,
      cases: caseCounts, agingPairs,
      holdoutCases: asFitted.pooled.map((r) => r.cases),
    },
    priorWeight: { overall, kinds: kindPriorWeight, aging: priorAging, byHorizon: byHorizonPrior },
    priorOverlapsHoldout,
    coverage: {
      asFitted: asFitted.pooled, adopted: served.pooled, byKind: served.byKind, byUsage: served.byUsage, byQuality: served.byQuality,
      subgroups: asFitted.subgroups, played: asFitted.played,
    },
    aging: { hitter: agingSummary(agingModel, 'hitter'), pitcher: agingSummary(agingModel, 'pitcher') },
    proneness: findings,
    logistic: logisticHealth,
    ceiling,
    gate: { passed, reason, tolerance: policy.gate.coverage.pooled, minimumCases: policy.gate.minimumCases, failures },
    label,
  };
  return { model, record };
}

/** A stored distribution from cases: the tail grid's quantiles, shrunk toward the prior's grid by sample. */
function gridOf(z: number[], prior: readonly number[] | null, n: number): number[] {
  const own = z.length >= MIN_CASES ? GRID.map((p) => quantile(z, p) as number) : null;
  if (!own) return prior ? [...prior] : GRID.map((p) => gridQuantile(standardNormalGrid(), p));
  if (!prior || prior.length !== GRID.length) return own;
  const w = PRODUCTION_POLICY.prior.strength / (n + PRODUCTION_POLICY.prior.strength);
  return own.map((v, j) => (1 - w) * v + w * prior[j]);
}

let normalGrid: number[] | null = null;
function standardNormalGrid(): number[] {
  if (!normalGrid) {
    // The inverse of the error function at the grid, by bisection on the normal distribution
    normalGrid = GRID.map((p) => {
      let a = -8;
      let b = 8;
      for (let i = 0; i < 60; i += 1) {
        const m = (a + b) / 2;
        if (normalCdf(m) < p) a = m;
        else b = m;
      }
      return (a + b) / 2;
    });
  }
  return normalGrid;
}

function agingSummary(aging: ProductionModel['aging'], group: AgingGroup): FitRecord['aging'][AgingGroup] {
  const t = aging[group];
  const at = (a: number) => t[Math.min(Math.max(a - aging.firstAge, 0), t.length - 1)];
  let peak: number | null = null;
  for (let a = aging.firstAge; a < aging.firstAge + t.length; a += 1) {
    if (at(a) <= 0) { peak = a; break; }
  }
  const mean = (from: number) => [0, 1, 2, 3].reduce((s, i) => s + at(from + i), 0) / 4;
  return { peakAge: peak, declineFrom30: mean(30), declineFrom34: mean(34) };
}

export type UsageTier = 'low' | 'mid' | 'high';
export type QualityTier = 'top' | 'middle' | 'bottom';

/** The gate's age band for an age in the first target season. */
function ageBandOf(age: number): string {
  const [a, b, c] = PRODUCTION_POLICY.ageBands;
  return age <= a ? `≤${a}` : age <= b ? `${a + 1}–${b}` : age <= c ? `${b + 1}–${c}` : `${c + 1}+`;
}

/**
 * Held-out coverage and bias, run through the projection itself so it is exactly what a GM would see:
 * pooled, by kind, by expected usage (thirds of each kind's expected first-season usage), by projected rate
 * (tenths within each kind, and the gate's quality tiers) and by age band; and among the cases that played.
 */
function coverageOf(set: SideCase[], modelOf: (c: SideCase) => ProductionModel, keep: (c: SideCase, h: number) => boolean, scheduleFor: (c: SideCase) => { games: number; bySeason: Record<number, number | null> }): {
  pooled: CoverageRow[]; byKind: Record<ProductionKind, CoverageRow[]>; byUsage: Record<UsageTier, CoverageRow[]>; byQuality: Record<QualityTier, CoverageRow[]>;
  subgroups: Record<string, CoverageRow[]>; played: CoverageRow[];
} {
  const provenance: ModelProvenance = { source: 'save_fit', label: 'backtest', stamp: { status: 'calibrated', basis: 'backtest', run: null }, fitId: null, priorWeight: 0 };
  interface Acc { n: number; outer: number; inner: number; bias: number; abs: number; byPlayer: Map<number, { e: number; k: number }>; byOrigin: Map<number, { e: number; k: number }>; byBoth: Map<string, { e: number; k: number }> }
  const acc = (): Acc[] => Array.from({ length: H }, () => ({ n: 0, outer: 0, inner: 0, bias: 0, abs: 0, byPlayer: new Map(), byOrigin: new Map(), byBoth: new Map() }));
  const add = addToCluster;
  const groups = new Map<string, Acc[]>();
  const group = (name: string) => { let g = groups.get(name); if (!g) { g = acc(); groups.set(name, g); } return g; };
  const played = acc();
  const projected: Array<{ c: SideCase; seasons: Array<{ wins: { low: number; high: number; central: number }; inner: { low: number; high: number }; zero?: { below: number; mass: number }; whenPlays?: { low80: number; high80: number; low50: number; high50: number; central: number } } | null>; usage: number; rate: number }> = [];
  const OUT = [(1 - PRODUCTION_POLICY.coverage.outer) / 2, 1 - (1 - PRODUCTION_POLICY.coverage.outer) / 2];
  const INN = [(1 - PRODUCTION_POLICY.coverage.inner) / 2, 1 - (1 - PRODUCTION_POLICY.coverage.inner) / 2];
  // An outcome of no playing time is a point mass: scored by the share of the mass the band holds (randomized PIT)
  const massShare = (z: { below: number; mass: number }, [lo, hi]: number[]) =>
    Math.max(0, Math.min(z.below + z.mass, hi) - Math.max(z.below, lo)) / z.mass;
  for (const c of set) {
    const input = {
      playerId: c.player.playerId, season: c.origin + 1, seasonPlayed: 0, age: c.age,
      batting: c.side === 'batting' ? c.results : [], pitching: c.side === 'pitching' ? c.results : [],
      proneness: c.player.proneness, schedule: scheduleFor(c),
    };
    const p = projectProductionWith(input, modelOf(c), provenance);
    if (p.status !== 'projected') continue;
    const sides = p.seasons.map((s) => s.sides.find((x) => x.side === c.side) ?? null);
    const rate = p.basis.sides.find((x) => x.side === c.side)?.regressedRate ?? 0;
    projected.push({ c, seasons: sides, usage: sides[0]?.usage.central ?? 0, rate });
  }
  const cutsOf = (kind: ProductionKind, read: (x: typeof projected[number]) => number, qs: number[]) => {
    const v = projected.filter((x) => x.c.kind === kind).map(read);
    return qs.map((q) => quantile(v, q) ?? 0);
  };
  const deciles = new Map<ProductionKind, number[]>(KINDS.map((k) => [k, cutsOf(k, (x) => x.rate, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])]));
  const thirds = new Map<ProductionKind, number[]>(KINDS.map((k) => [k, cutsOf(k, (x) => x.usage, [1 / 3, 2 / 3])]));
  const tenths = new Map<ProductionKind, number[]>(KINDS.map((k) => [k, cutsOf(k, (x) => x.rate, [0.1, 0.9])]));
  for (const { c, seasons, usage, rate } of projected) {
    const [a, b] = thirds.get(c.kind)!;
    const tier: UsageTier = usage <= a ? 'low' : usage <= b ? 'mid' : 'high';
    const [lo, hi] = tenths.get(c.kind)!;
    const quality: QualityTier = rate >= hi ? 'top' : rate <= lo ? 'bottom' : 'middle';
    const decile = 1 + deciles.get(c.kind)!.filter((x) => rate > x).length;
    const names = ['pooled', `kind:${c.kind}`, `usage:${tier}`, `quality:${quality}`, `age:${ageBandOf(c.age)}`, `decile:${decile}`, `origin:${c.origin}`];
    for (let h = 1; h <= H; h += 1) {
      const s = seasons[h - 1];
      if (!keep(c, h) || !s) continue;
      const act = c.actual(c.origin + h);
      const actual = act.war as number;
      const targets = names.map((n) => group(n)[h - 1]);
      // Among those who played, scored against the band WHEN he plays (C-08): the continuous part on its own
      if (act.opportunities > 0 && s.whenPlays) {
        const t = played[h - 1];
        const wp = s.whenPlays;
        t.n += 1;
        if (actual >= wp.low80 && actual <= wp.high80) t.outer += 1;
        if (actual >= wp.low50 && actual <= wp.high50) t.inner += 1;
        t.bias += actual - wp.central;
        t.abs += Math.abs(actual);
        add(t.byPlayer, c.player.playerId, actual - wp.central);
        add(t.byOrigin, c.origin, actual - wp.central);
        add(t.byBoth, `${c.player.playerId}:${c.origin}`, actual - wp.central);
      }
      for (const t of targets) {
        t.n += 1;
        if (act.opportunities === 0 && s.zero && s.zero.mass > 1e-9) {
          t.outer += massShare(s.zero, OUT);
          t.inner += massShare(s.zero, INN);
        } else {
          if (actual >= s.wins.low && actual <= s.wins.high) t.outer += 1;
          if (actual >= s.inner.low && actual <= s.inner.high) t.inner += 1;
        }
        const e = actual - s.wins.central;
        t.bias += e;
        t.abs += Math.abs(actual);
        add(t.byPlayer, c.player.playerId, e);
        add(t.byOrigin, c.origin, e);
        add(t.byBoth, `${c.player.playerId}:${c.origin}`, e);
      }
    }
  }
  const rows = (x: Acc[]): CoverageRow[] => x.map((r, i) => {
    const mean = r.n > 0 ? r.bias / r.n : null;
    // Clustered two ways (by player and by origin, the same player-season appearing under several origins)
    return {
      horizon: i + 1, cases: r.n,
      outer: r.n > 0 ? r.outer / r.n : null, inner: r.n > 0 ? r.inner / r.n : null, bias: mean,
      meanAbsolute: r.n > 0 ? r.abs / r.n : null,
      biasSe: r.n > 0 && mean !== null ? twoWayClusteredSe(r.n, mean, r.byPlayer, r.byOrigin, r.byBoth) : null,
    };
  });
  const subgroups: Record<string, CoverageRow[]> = {};
  for (const [name, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) subgroups[name] = rows(g);
  const pick = (name: string) => subgroups[name] ?? rows(acc());
  return {
    pooled: pick('pooled'),
    byKind: Object.fromEntries(KINDS.map((k) => [k, pick(`kind:${k}`)])) as Record<ProductionKind, CoverageRow[]>,
    byUsage: Object.fromEntries((['low', 'mid', 'high'] as UsageTier[]).map((t) => [t, pick(`usage:${t}`)])) as Record<UsageTier, CoverageRow[]>,
    byQuality: Object.fromEntries((['top', 'middle', 'bottom'] as QualityTier[]).map((t) => [t, pick(`quality:${t}`)])) as Record<QualityTier, CoverageRow[]>,
    subgroups,
    played: rows(played),
  };
}

export { survivorRate };
