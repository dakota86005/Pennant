/**
 * Player Value, concern 3: the fitting method for expected production (D-053, PLAYER_VALUE.md Part 7).
 *
 * Calibration belongs to the save. This is the METHOD: handed the save's own major-league history
 * (per player and season, from the export), it fits the model `playerValueProduction.ts` projects
 * with, backtests it on seasons it never saw, and says whether it may be adopted. It is pure: it
 * opens no table and writes nothing. `playerValue.ts` reads the history and `playerValueFitStore.ts`
 * stores the result, per save, in history.db; the harness (`npm run calibrate production`) runs the
 * same function and prints what it found.
 *
 *   window     the most recent completed seasons of the save's own history (PRODUCTION_POLICY.window),
 *              short seasons skipped; the most recent share of them held out as targets.
 *   backtest   from each origin season O (a window of O, O−1, O−2), predict O+1 … O+7 and compare with
 *              what happened. A player who did not play in a target season produced 0 wins there. The
 *              fit sees only targets up to the last training season; the held-out targets are
 *              predicted from origins at or after it.
 *   fitted     the aging curve (delta method, hitters and pitchers apart), the regression (recency
 *              weights, K, the mean), season noise, the usage regression and its spread per horizon,
 *              injury proneness's effect on usage and aging (only where the evidence rule is met),
 *              and the band tails (80% and 50%) per kind and horizon.
 *   prior      each component is shrunk toward the fallback prior by its sample: weight strength ÷
 *              (cases + strength). The model carries the prior's weight per kind, and the bands are
 *              served wider by it (PRODUCTION_POLICY.prior.widening): thin history is thin evidence.
 *   tails      the quantiles of each horizon's own training outcomes, per kind and usage tier: each
 *              season's wins band is its own, and only the rate band is carried forward.
 *   gate       held-out coverage of the fit itself (before the prior's widening) must be within the
 *              tolerance of both targets at every horizon with enough held-out cases; then any horizon short of a
 *              target is widened on the held-out seasons. A fit that fails is recorded, never adopted.
 *
 * The history a historical save imports is real major-league history: until the save has simulated
 * seasons of its own, a fit describes real-world stability and aging, and the record says which
 * seasons it rests on. Each new completed season refits automatically (playerValue.ts).
 */

import { PRODUCTION_METHOD, PRODUCTION_POLICY, CONTROL_HORIZON_SEASONS } from './playerValueCalibration.js';
import {
  agingBetween, bandsAlong, planSides, projectProductionWith, sideTrajectory, windowOf,
  type AgingGroup, type BandTails, type HorizonModel, type KindModel, type ModelProvenance, type ProductionKind,
  type ProductionLine, type ProductionModel, type ProductionSide, type ProneModel, type SideTrajectory,
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
}

export interface FitSeason {
  season: number;
  /** Games played per club over the schedule's length; null when not established. */
  scheduleShare: number | null;
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
}

export interface FitRecord {
  id: string;
  leagueId: number;
  throughSeason: number;
  method: string;
  window: { seasons: number[]; skipped: Array<{ season: number; reason: string }>; trainingThrough: number | null; holdout: number[] };
  sample: { players: number; cases: Record<ProductionKind, number[]>; agingPairs: Record<AgingGroup, number>; holdoutCases: number[] };
  priorWeight: { overall: number; kinds: Record<ProductionKind, number>; aging: Record<AgingGroup, number> };
  coverage: { asFitted: CoverageRow[]; adopted: CoverageRow[]; byKind: Record<ProductionKind, CoverageRow[]>; byUsage: Record<UsageTier, CoverageRow[]> };
  aging: Record<AgingGroup, { peakAge: number | null; declineFrom30: number; declineFrom34: number }>;
  proneness: string[];
  gate: { passed: boolean; reason: string; tolerance: number; minimumCases: number };
  label: string;
}

export interface FitRun {
  model: ProductionModel;
  record: FitRecord;
}

export interface FitOptions {
  /** The prior to shrink toward; null fits the save alone (how the fallback prior itself is made). */
  prior: ProductionModel | null;
  /** False fits on every season (no hold-out, no gate): for making the fallback prior. */
  holdout?: boolean;
}

// ── small statistics ─────────────────────────────────────────────────────────

const PER = PRODUCTION_POLICY.rateUnitOpportunities;
const H = CONTROL_HORIZON_SEASONS;
const KINDS: ProductionKind[] = ['hitter', 'starter', 'reliever'];
const GROUPS: AgingGroup[] = ['hitter', 'pitcher'];
const groupOf = (kind: ProductionKind): AgingGroup => (kind === 'hitter' ? 'hitter' : 'pitcher');
/** The quantiles the bands' tails are read at: a central interval's lower edge for each coverage target. */
const OUTER_LOW = (1 - PRODUCTION_POLICY.coverage.outer) / 2;
const INNER_LOW = (1 - PRODUCTION_POLICY.coverage.inner) / 2;
/** The fewest cases a component is fitted on; below it the component is the prior's. */
const MIN_CASES = PRODUCTION_POLICY.minimumSample.fitCases;

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Least squares with optional weights; null when singular. */
function leastSquares(x: number[][], y: number[], w?: number[]): number[] | null {
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
  // Gaussian elimination with partial pivoting
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

/** Shrink a fitted value toward the prior's by sample: the prior weighs strength ÷ (n + strength). */
const blend = (fit: number | null, prior: number | null, n: number, strength: number): number => {
  if (fit === null || !Number.isFinite(fit)) return prior ?? 0;
  if (prior === null) return fit;
  const w = strength / (n + strength);
  return (1 - w) * fit + w * prior;
};
const priorShare = (n: number, strength: number, hasPrior: boolean): number => (hasPrior ? strength / (n + strength) : 0);

export function ageOn(birth: FitPlayer['birth'], season: number): number | null {
  if (!birth) return null;
  // Age on July 1 of the season
  return season - birth.year - (birth.month > 7 || (birth.month === 7 && birth.day > 1) ? 1 : 0);
}

// ── cases ────────────────────────────────────────────────────────────────────

interface SideCase {
  player: FitPlayer;
  origin: number;
  side: ProductionSide;
  kind: ProductionKind;
  age: number; // in season origin + 1
  results: ProductionLine[];
  /** Actual WAR and opportunities per target season (0 when he had no line). */
  actual: (season: number) => { war: number; opportunities: number };
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
    for (const origin of origins) {
      const age = ageOn(player.birth, origin + 1);
      if (age === null) continue;
      const batting = linesThrough(player.batting, origin).filter((l) => l.season >= origin - 3);
      const pitching = linesThrough(player.pitching, origin).filter((l) => l.season >= origin - 3);
      if (batting.length === 0 && pitching.length === 0) continue;
      const plan = planSides({ playerId: player.playerId, season: origin + 1, seasonPlayed: 0, age, batting, pitching });
      if (!plan.ok) continue;
      for (const { side, kind } of plan.sides) {
        const map = bySide[side];
        out.push({
          player, origin, side, kind, age, results: plan.results[side],
          actual: (s) => {
            const l = map.get(s);
            return { war: l?.war ?? 0, opportunities: l?.opportunities ?? 0 };
          },
        });
      }
    }
  }
  return out;
}


interface Traj { c: SideCase; tr: SideTrajectory }

/** Coverage at horizon h of the carried bands, for the cases given (all of which have that horizon). */
function coverageAlong(items: Traj[], k: KindModel, h: number): { n: number; outer: number; inner: number } {
  let outer = 0;
  let inner = 0;
  for (const { c, tr } of items) {
    const b = bandsAlong(tr, k, h)[h - 1];
    const a = c.actual(c.origin + h).war;
    if (a >= b.wins.low && a <= b.wins.high) outer += 1;
    if (a >= b.inner.low && a <= b.inner.high) inner += 1;
  }
  const n = items.length;
  return { n, outer: n > 0 ? outer / n : 0, inner: n > 0 ? inner / n : 0 };
}

/** The smallest scale in [lo, hi] at which `coverage(scale)` reaches the target (coverage never falls as the scale grows). */
function solveScale(coverage: (scale: number) => number, target: number, lo = 0, hi = 4): number {
  if (coverage(lo) >= target) return lo;
  if (coverage(hi) < target) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 24; i += 1) {
    const m = (a + b) / 2;
    if (coverage(m) >= target) b = m;
    else a = m;
  }
  return b;
}

// ── the fit ──────────────────────────────────────────────────────────────────

export function fitProductionModel(history: FitHistory, options: FitOptions): FitRun {
  const policy = PRODUCTION_POLICY;
  const prior = options.prior;
  const useHoldout = options.holdout !== false;

  // The window: the most recent completed seasons, short or unmeasured seasons skipped
  const skipped: FitRecord['window']['skipped'] = [];
  const window: number[] = [];
  for (const s of [...history.seasons].sort((a, b) => a.season - b.season)) {
    if (s.season > history.throughSeason || s.season <= history.throughSeason - policy.window.maxSeasons) continue;
    if (s.scheduleShare === null) skipped.push({ season: s.season, reason: 'schedule length not established' });
    else if (s.scheduleShare < policy.window.minShareOfSchedule) skipped.push({ season: s.season, reason: `short season (${Math.round(s.scheduleShare * 100)}% of the schedule)` });
    else window.push(s.season);
  }
  const eligible = new Set(window);
  const holdoutCount = useHoldout && window.length >= 2 ? Math.max(1, Math.round(policy.window.holdoutShare * window.length)) : 0;
  const holdoutSeasons = holdoutCount > 0 ? window.slice(window.length - holdoutCount) : [];
  const trainingThrough = holdoutCount > 0 ? window[window.length - holdoutCount - 1] ?? null : window[window.length - 1] ?? null;

  const origins = window.filter((o) => eligible.has(o - 1) && eligible.has(o - 2));
  const cases = sideCases(history.players, origins);
  const inTraining = (c: SideCase, h: number) => trainingThrough !== null && c.origin + h <= trainingThrough && eligible.has(c.origin + h);
  const inHoldout = (c: SideCase, h: number) => holdoutCount > 0 && trainingThrough !== null && c.origin >= trainingThrough && eligible.has(c.origin + h);

  // ── aging: the delta method on consecutive training seasons ──
  const agingModel: ProductionModel['aging'] = { firstAge: policy.agingAges.first, hitter: [], pitcher: [] };
  const agingPairs: Record<AgingGroup, number> = { hitter: 0, pitcher: 0 };
  const pairResiduals: Record<AgingGroup, Array<{ age: number; d: number; w: number; prone: number | null }>> = { hitter: [], pitcher: [] };
  const ageSpan = policy.agingAges.last - policy.agingAges.first + 1;
  for (const group of GROUPS) {
    const pairs: Array<{ age: number; d: number; w: number; prone: number | null }> = [];
    for (const p of history.players) {
      const lines = group === 'hitter' ? p.batting : p.pitching;
      const bySeason = new Map(lines.map((l) => [l.season, l]));
      for (const a of lines) {
        const b = bySeason.get(a.season + 1);
        if (!b || a.war === null || b.war === null) continue;
        if (!eligible.has(a.season) || !eligible.has(b.season) || trainingThrough === null || b.season > trainingThrough) continue;
        const min = policy.minimumSample.agingOpportunities;
        if (a.opportunities < min || b.opportunities < min) continue;
        const age = ageOn(p.birth, a.season);
        if (age === null) continue;
        pairs.push({
          age, d: (b.war / b.opportunities - a.war / a.opportunities) * PER,
          w: (2 * a.opportunities * b.opportunities) / (a.opportunities + b.opportunities), prone: p.proneness,
        });
      }
    }
    agingPairs[group] = pairs.length;
    pairResiduals[group] = pairs;
    // A quadratic in age, weighted, evaluated inside the ages the pairs cover
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
  // The residual of each pair against the curve, for proneness
  for (const group of GROUPS) {
    for (const x of pairResiduals[group]) {
      const i = Math.min(Math.max(x.age - agingModel.firstAge, 0), agingModel[group].length - 1);
      x.d -= agingModel[group][i];
    }
  }

  // ── regression: recency weights, K and the mean, per kind, on horizon-1 training cases ──
  const kinds = {} as Record<ProductionKind, KindModel>;
  const caseCounts = {} as Record<ProductionKind, number[]>;
  const kindPriorWeight = {} as Record<ProductionKind, number>;
  for (const kind of KINDS) {
    const group = groupOf(kind);
    const mine = cases.filter((c) => c.kind === kind);
    const h1 = mine.filter((c) => inTraining(c, 1) && c.actual(c.origin + 1).opportunities > 0);
    const rows = h1.map((c) => {
      const { slots } = windowOf(c.results, c.origin + 1, 0);
      const act = c.actual(c.origin + 1);
      const ag = agingBetween(agingModel[group], agingModel.firstAge, c.age - 1, c.age) / PER;
      return { slots, A: act.opportunities, y: act.war / act.opportunities, ag };
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
              sab += r.A * b * (r.y - a - r.ag);
              sbb += r.A * b * b;
              return { a, b };
            });
            const mu = sbb > 0 ? sab / sbb : 0;
            let sse = 0;
            rows.forEach((r, i) => { sse += r.A * (r.y - parts[i].a - parts[i].b * mu - r.ag) ** 2; });
            if (!best || sse < best.sse) best = { w1, w2, K, mu, sse };
          }
        }
      }
    }
    const pk = prior?.kinds[kind] ?? null;
    const n1 = rows.length;
    const S = policy.prior.strength;
    const weights: [number, number, number] = [1, blend(best?.w1 ?? null, pk?.weights[1] ?? null, n1, S), blend(best?.w2 ?? null, pk?.weights[2] ?? null, n1, S)];
    const stabilization = blend(best?.K ?? null, pk?.stabilization ?? null, n1, S);
    const mean600 = blend(best ? best.mu * PER : null, pk?.mean600 ?? null, n1, S);
    // Season noise, by the model's own moments: E[resid²] = ε² (A + A² / (n + K))
    let rr = 0;
    let den = 0;
    let rate2 = 0;
    let aw = 0;
    for (const r of rows) {
      const n = r.slots[0].opportunities + weights[1] * r.slots[1].opportunities + weights[2] * r.slots[2].opportunities;
      const num = r.slots[0].war + weights[1] * r.slots[1].war + weights[2] * r.slots[2].war;
      const pred = (num + (mean600 / PER) * stabilization) / (n + stabilization) + r.ag;
      rr += (r.y * r.A - pred * r.A) ** 2;
      den += r.A + (r.A * r.A) / (n + stabilization);
      rate2 += r.A * pred * pred;
      aw += r.A;
    }
    const noise600 = blend(den > 0 ? (rr / den) * PER : null, pk?.noise600 ?? null, n1, S);
    const rateScale600 = blend(aw > 0 ? Math.sqrt(rate2 / aw) * PER : null, pk?.rateScale600 ?? null, n1, S);
    kindPriorWeight[kind] = priorShare(n1, S, prior !== null);

    // Usage per horizon: what he actually got, zeros included, on the window's three slots and age
    const horizons: HorizonModel[] = [];
    const counts: number[] = [];
    for (let h = 1; h <= H; h += 1) {
      const set = mine.filter((c) => inTraining(c, h));
      counts.push(set.length);
      const pivot = policy.usagePivotAge;
      const feats = set.map((c) => {
        const { slots } = windowOf(c.results, c.origin + 1, 0);
        const ageO = c.age - 1;
        return [1, slots[0].opportunities, slots[1].opportunities, slots[2].opportunities, Math.max(0, ageO - pivot), Math.max(0, pivot - ageO)];
      });
      const ys = set.map((c) => c.actual(c.origin + h).opportunities);
      // Non-negative on usage itself: more observed usage never lowers expected usage
      let keep = [0, 1, 2, 3, 4, 5];
      let coef: number[] | null = null;
      for (let pass = 0; pass < 4 && set.length >= MIN_CASES; pass += 1) {
        const c = leastSquares(feats.map((f) => keep.map((j) => f[j])), ys);
        if (!c) break;
        const full = new Array<number>(6).fill(0);
        keep.forEach((j, i) => { full[j] = c[i]; });
        const negative = [1, 2, 3].filter((j) => keep.includes(j) && full[j] < 0);
        coef = full;
        if (negative.length === 0) break;
        keep = keep.filter((j) => !negative.includes(j));
      }
      const ph = pk?.horizons[h - 1] ?? null;
      const n = set.length;
      const usage = {
        intercept: blend(coef?.[0] ?? null, ph?.usage.intercept ?? null, n, S),
        recent: [1, 2, 3].map((j) => Math.max(0, blend(coef?.[j] ?? null, ph?.usage.recent[j - 1] ?? null, n, S))) as [number, number, number],
        older: blend(coef?.[4] ?? null, ph?.usage.older ?? null, n, S),
        younger: blend(coef?.[5] ?? null, ph?.usage.younger ?? null, n, S),
      };
      const pred = feats.map((f) => Math.max(0, usage.intercept + usage.recent[0] * f[1] + usage.recent[1] * f[2] + usage.recent[2] * f[3] + usage.older * f[4] + usage.younger * f[5]));
      // The usage scale: mean absolute error, linear in the expectation, never below zero at the origin
      const absRes = ys.map((y, i) => Math.abs(y - pred[i]));
      let spread: { base: number; slope: number } | null = null;
      if (set.length >= MIN_CASES) {
        const c = leastSquares(pred.map((p) => [1, p]), absRes);
        if (c && c[0] >= 0 && c[1] >= 0) spread = { base: c[0], slope: c[1] };
        else if (c && c[0] < 0) {
          const sl = leastSquares(pred.map((p) => [p]), absRes);
          spread = { base: 0, slope: Math.max(0, sl?.[0] ?? 0) };
        } else spread = { base: absRes.reduce((a, b) => a + b, 0) / absRes.length, slope: 0 };
      }
      const usageSpread = {
        base: Math.max(0, blend(spread?.base ?? null, ph?.usageSpread.base ?? null, n, S)),
        slope: Math.max(0, blend(spread?.slope ?? null, ph?.usageSpread.slope ?? null, n, S)),
      };
      const z = ys.map((y, i) => {
        const sd = usageSpread.base + usageSpread.slope * pred[i];
        return sd > 0 ? (y - pred[i]) / sd : null;
      }).filter((v): v is number => v !== null);
      const usageTails = {
        low: blend(z.length >= MIN_CASES ? Math.max(0, -(quantile(z, OUTER_LOW) ?? 0)) : null, ph?.usageTails.low ?? null, n, S),
        high: blend(z.length >= MIN_CASES ? Math.max(0, quantile(z, 1 - OUTER_LOW) ?? 0) : null, ph?.usageTails.high ?? null, n, S),
      };
      horizons.push({ usage, usageSpread, usageTails, tails: Array.from({ length: policy.usageTiers }, () => ({ low80: 1, high80: 1, low50: 0.5, high50: 0.5 })), drift600: 0, cases: n });
    }
    caseCounts[kind] = counts;
    kinds[kind] = { weights, stabilization, mean600, noise600, rateScale600, horizons, usageCuts: [], priorWeight: 0 };
  }

  let model: ProductionModel = {
    method: PRODUCTION_METHOD,
    kinds,
    aging: agingModel,
    usagePivotAge: policy.usagePivotAge,
    proneness: null,
  };

  // ── injury proneness: its effect on usage and on aging, measured, used only where the evidence rule is met ──
  const findings: string[] = [];
  const known = [...new Set(cases.filter((c) => inTraining(c, 1) && c.player.proneness !== null).map((c) => c.player))].map((p) => p.proneness as number);
  if (known.length >= 3 * policy.proneness.bands) {
    const bands = policy.proneness.bands;
    const cuts = Array.from({ length: bands - 1 }, (_, i) => quantile(known, (i + 1) / bands) as number);
    const bandOf = (v: number) => { const i = cuts.findIndex((c) => v <= c); return i === -1 ? cuts.length : i; };
    const prone: ProneModel = {
      cuts,
      usage: { hitter: new Array(bands).fill(1), pitcher: new Array(bands).fill(1) },
      aging: { hitter: Array.from({ length: bands }, () => [0, 0] as [number, number]), pitcher: Array.from({ length: bands }, () => [0, 0] as [number, number]) },
      ageSplit: policy.proneness.ageSplit,
      findings,
    };
    const label = (b: number) => (b === 0 ? `≤ ${cuts[0].toFixed(0)}` : b === bands - 1 ? `> ${cuts[bands - 2].toFixed(0)}` : `${cuts[b - 1].toFixed(0)}–${cuts[b].toFixed(0)}`);
    // Usage: actual over expected opportunities, horizons 1 to 3, per band
    for (const group of GROUPS) {
      const sums = Array.from({ length: bands }, () => ({ a: 0, p: 0, rows: [] as Array<[number, number]> }));
      for (const c of cases) {
        if (groupOf(c.kind) !== group || c.player.proneness === null) continue;
        const tr = sideTrajectory(c.side, c.kind, c.results, c.results, { season: c.origin + 1, f: 0, age: c.age, horizon: 3, proneness: null }, model);
        for (let h = 1; h <= 3; h += 1) {
          if (!inTraining(c, h)) continue;
          const b = bandOf(c.player.proneness);
          const a = c.actual(c.origin + h).opportunities;
          const p = tr.seasons[h - 1].P;
          sums[b].a += a;
          sums[b].p += p;
          sums[b].rows.push([a, p]);
        }
      }
      // Relative to every band together, so the usage model's own bias is not read as proneness
      const all = sums.reduce((t, s) => ({ a: t.a + s.a, p: t.p + s.p }), { a: 0, p: 0 });
      const overall = all.p > 0 ? all.a / all.p : 1;
      sums.forEach((s, b) => {
        if (s.p <= 0 || overall <= 0) return;
        const raw = s.a / s.p;
        const m = raw / overall;
        const se = Math.sqrt(s.rows.reduce((t, [a, p]) => t + (a - raw * p) ** 2, 0)) / s.p / overall;
        const real = Math.abs(m - 1) >= policy.proneness.evidence * se;
        if (real) prone.usage[group][b] = m;
        findings.push(`${group === 'hitter' ? 'Hitters' : 'Pitchers'}, proneness ${label(b)}: playing time ${(m * 100).toFixed(1)}% of the league's rate for the same expected usage (± ${(se * 100).toFixed(1)}, ${s.rows.length} seasons, horizons 1–3)${real ? '' : ' — not distinguishable from none, not used'}.`);
      });
      // Aging: the pairs' residual against the curve, per band and age group
      for (let b = 0; b < bands; b += 1) {
        for (const [gi, name] of [[0, `under ${policy.proneness.ageSplit}`], [1, `${policy.proneness.ageSplit} and over`]] as Array<[number, string]>) {
          const xs = pairResiduals[group].filter((x) => x.prone !== null && bandOf(x.prone) === b && (gi === 0 ? x.age < policy.proneness.ageSplit : x.age >= policy.proneness.ageSplit));
          const sw = xs.reduce((t, x) => t + x.w, 0);
          if (sw <= 0 || xs.length < policy.minimumSample.agingPairs) {
            findings.push(`${group === 'hitter' ? 'Hitters' : 'Pitchers'}, proneness ${label(b)}, ${name}: too few aging pairs (${xs.length}) to measure; not used.`);
            continue;
          }
          const mean = xs.reduce((t, x) => t + x.w * x.d, 0) / sw;
          const se = Math.sqrt(xs.reduce((t, x) => t + x.w * x.w * (x.d - mean) ** 2, 0)) / sw;
          const real = Math.abs(mean) >= policy.proneness.evidence * se;
          if (real) prone.aging[group][b][gi] = mean;
          findings.push(`${group === 'hitter' ? 'Hitters' : 'Pitchers'}, proneness ${label(b)}, ${name}: aging ${mean >= 0 ? '+' : ''}${mean.toFixed(3)} WAR per ${PER} a year against the curve (± ${se.toFixed(3)}, ${xs.length} pairs)${real ? '' : ' — not distinguishable from none, not used'}.`);
        }
      }
    }
    model = { ...model, proneness: prone };
  } else {
    findings.push(`Injury proneness is known for ${known.length} of the players behind the fit: too few to measure an effect, so proneness moves nothing.`);
  }

  const horizonsOf = (c: SideCase, keep: (c: SideCase, h: number) => boolean) => Array.from({ length: H }, (_, i) => i + 1).filter((h) => keep(c, h));

  // ── drift: the rate variance no sample removes, per kind and horizon, by the model's own moments ──
  //
  // E[(actual − central)²] = S² with drift 0, plus drift × usage², so drift is the least-squares slope
  // of the excess squared residual on usage to the fourth power (never below zero).
  for (const kind of KINDS) {
    const k = kinds[kind];
    const pk = prior?.kinds[kind] ?? null;
    const mine = cases.filter((c) => c.kind === kind && horizonsOf(c, inTraining).length > 0);
    const trs = mine.map((c) => ({ c, tr: sideTrajectory(c.side, c.kind, c.results, c.results, { season: c.origin + 1, f: 0, age: c.age, horizon: H, proneness: c.player.proneness }, model) }));
    k.horizons.forEach((row, i) => {
      let num = 0;
      let den = 0;
      let n = 0;
      for (const { c, tr } of trs) {
        if (!inTraining(c, i + 1)) continue;
        const x = tr.seasons[i];
        const resid = c.actual(c.origin + i + 1).war - x.central;
        const p2 = (x.P / PER) ** 2;
        num += p2 * (resid * resid - x.S * x.S);
        den += p2 * p2;
        n += 1;
      }
      const fitted = n >= MIN_CASES && den > 0 ? Math.max(0, num / den) : null;
      row.drift600 = Math.max(0, blend(fitted, pk?.horizons[i]?.drift600 ?? null, n, policy.prior.strength));
    });
  }

  // ── tails: the 80% and 50% bands per kind, usage tier and horizon ──
  //
  // The spread S is heteroscedastic by construction; the tails turn it into bands. A regular's and a
  // fringe player's outcomes are spread differently even relative to S, so the tails are set apart for
  // each third of expected first-season usage (the tier depends on usage only, never on results).
  // Each season's wins band is its own: only the rate band is carried forward (owner, 2026-09-23), so
  // each horizon's tails are the quantiles of its own training outcomes.
  const targets = { outer: policy.coverage.outer, inner: policy.coverage.inner };
  const TIERS = policy.usageTiers;
  const trajectories = (set: SideCase[], m: ProductionModel): Traj[] => set.map((c) => ({
    c, tr: sideTrajectory(c.side, c.kind, c.results, c.results, { season: c.origin + 1, f: 0, age: c.age, horizon: H, proneness: c.player.proneness }, m),
  }));
  const S = policy.prior.strength;
  // The tier cuts: thirds of expected full-season usage at horizon 1 among the kind's training cases
  for (const kind of KINDS) {
    const k = kinds[kind];
    const pk = prior?.kinds[kind] ?? null;
    const p1 = trajectories(cases.filter((c) => c.kind === kind && inTraining(c, 1)), model).map((t) => t.tr.seasons[0].P);
    const n = p1.length;
    k.usageCuts = Array.from({ length: TIERS - 1 }, (_, j) =>
      blend(n >= MIN_CASES ? quantile(p1, (j + 1) / TIERS) : null, pk?.usageCuts?.[j] ?? null, n, S));
  }
  const trainTr = trajectories(cases.filter((c) => horizonsOf(c, inTraining).length > 0), model);
  const zero: BandTails = { low80: 0, high80: 0, low50: 0, high50: 0 };
  for (const kind of KINDS) {
    const k = kinds[kind];
    const pk = prior?.kinds[kind] ?? null;
    for (let tier = 0; tier < TIERS; tier += 1) {
      const mine = trainTr.filter((t) => t.c.kind === kind && t.tr.tier === tier);
      // The raw tails: quantiles of (actual − central) / S before any carrying forward
      const raw: Array<BandTails | null> = k.horizons.map((_, i) => {
        const z = mine.filter((t) => inTraining(t.c, i + 1) && t.tr.seasons[i].S > 0)
          .map((t) => (t.c.actual(t.c.origin + i + 1).war - t.tr.seasons[i].central) / t.tr.seasons[i].S);
        if (z.length < MIN_CASES) return null;
        const q = (p: number) => quantile(z, p) as number;
        return { low80: Math.max(0, -q(OUTER_LOW)), high80: Math.max(0, q(1 - OUTER_LOW)), low50: Math.max(0, -q(INNER_LOW)), high50: Math.max(0, q(1 - INNER_LOW)) };
      });
      // Each horizon's tails from its own quantiles; a horizon without enough cases takes the prior's
      k.horizons.forEach((row, i) => {
        const r = raw[i];
        const priorTails = pk?.horizons[i]?.tails?.[tier] ?? null;
        if (!r) {
          row.tails[tier] = { ...(priorTails ?? row.tails[tier] ?? zero) };
          return;
        }
        // Each season's wins band is its own (only the rate band is carried), so the quantiles are the tails
        row.tails[tier] = { ...r };
      });
      // Shrink toward the prior by sample (the prior's weight widens the bands when served, not here)
      k.horizons.forEach((row, i) => {
        if (!raw[i]) return;
        const n = mine.filter((x) => inTraining(x.c, i + 1)).length;
        const pt = pk?.horizons[i]?.tails?.[tier] ?? null;
        const t = row.tails[tier];
        row.tails[tier] = {
          low80: blend(t.low80, pt?.low80 ?? null, n, S),
          high80: blend(t.high80, pt?.high80 ?? null, n, S),
          low50: blend(t.low50, pt?.low50 ?? null, n, S),
          high50: blend(t.high50, pt?.high50 ?? null, n, S),
        };
      });
    }
  }

  // ── the held-out seasons: coverage as fitted, the gate, then widening where a horizon falls short ──
  const holdoutCases = cases.filter((c) => horizonsOf(c, inHoldout).length > 0);
  const coverage = (m: ProductionModel) => coverageOf(holdoutCases, m, inHoldout);
  const asFitted = coverage(model);
  const holdTr = trajectories(holdoutCases, model);

  const tol = policy.gate.tolerance;
  const evaluable = asFitted.pooled.filter((r) => r.cases >= policy.gate.minimumCases);
  // Off target: more than the tolerance from the target, either way
  const offBy = (observed: number | null, target: number) => (observed === null ? Infinity : Math.abs(observed - target));
  let passed: boolean;
  let reason: string;
  if (holdoutCases.length === 0 || !evaluable.some((r) => r.horizon === 1)) {
    passed = false;
    reason = `Too few held-out seasons to validate (${window.length} usable season${window.length === 1 ? '' : 's'}; horizon 1 needs ${policy.gate.minimumCases} held-out cases).`;
  } else {
    const off = evaluable.filter((r) => offBy(r.outer, targets.outer) > tol || offBy(r.inner, targets.inner) > tol);
    passed = off.length === 0;
    reason = passed
      ? `Held-out coverage within ${Math.round(tol * 100)} points of ${Math.round(targets.outer * 100)}% and ${Math.round(targets.inner * 100)}% at every horizon with ${policy.gate.minimumCases}+ cases (${evaluable.map((r) => r.horizon).join(', ')}).`
      : `Held-out coverage outside ${Math.round(tol * 100)} points of the targets at horizon ${off.map((r) => `${r.horizon} (${pct(r.outer)} / ${pct(r.inner)})`).join(', ')}.`;
  }
  if (!useHoldout) {
    passed = true;
    reason = 'Fitted on every season, no hold-out: the fallback prior is made this way and is provisional.';
  }

  if (passed && holdoutCases.length > 0) {
    // Widen, never narrow, each kind, tier and horizon that falls short of a target on the held-out seasons
    for (const kind of KINDS) {
      const k = kinds[kind];
      for (let tier = 0; tier < TIERS; tier += 1) {
        const mine = holdTr.filter((t) => t.c.kind === kind && t.tr.tier === tier);
        k.horizons.forEach((row, i) => {
          const keep = mine.filter((t) => inHoldout(t.c, i + 1));
          if (keep.length < MIN_CASES) return;
          const t = row.tails[tier];
          const base = { ...t };
          if (coverageAlong(keep, k, i + 1).outer < targets.outer) {
            const sc = solveScale((x) => { t.low80 = x * base.low80; t.high80 = x * base.high80; return coverageAlong(keep, k, i + 1).outer; }, targets.outer, 1, 4);
            t.low80 = sc * base.low80;
            t.high80 = sc * base.high80;
          }
          const baseInner = { ...t };
          if (coverageAlong(keep, k, i + 1).inner < targets.inner) {
            const sc = solveScale((x) => { t.low50 = x * baseInner.low50; t.high50 = x * baseInner.high50; return coverageAlong(keep, k, i + 1).inner; }, targets.inner, 1, 4);
            t.low50 = sc * baseInner.low50;
            t.high50 = sc * baseInner.high50;
          }
        });
      }
    }
  }
  // Served bands are widened by the prior's weight in each kind: the gate judged the fit itself
  for (const kind of KINDS) kinds[kind].priorWeight = kindPriorWeight[kind];
  const adopted = holdoutCases.length > 0 ? coverage(model) : asFitted;

  const priorKinds = kindPriorWeight;
  const priorAging = { hitter: priorShare(agingPairs.hitter, policy.prior.agingStrength, prior !== null), pitcher: priorShare(agingPairs.pitcher, policy.prior.agingStrength, prior !== null) };
  const allCases = KINDS.reduce((t, k) => t + (caseCounts[k][0] ?? 0), 0);
  const overall = priorShare(allCases, policy.prior.strength, prior !== null);
  const id = `${history.leagueId}:${history.throughSeason}:${PRODUCTION_METHOD}`;
  const first = window[0];
  const lastSeason = window[window.length - 1];
  const label = overall >= 0.5 || window.length === 0
    ? `not yet calibrated on this save (${window.length} season${window.length === 1 ? '' : 's'}): mostly the fallback prior`
    : `calibrated on this save's seasons ${first}–${lastSeason} (${window.length}), held out ${holdoutSeasons[0] ?? '—'}–${holdoutSeasons[holdoutSeasons.length - 1] ?? '—'}`;

  const record: FitRecord = {
    id, leagueId: history.leagueId, throughSeason: history.throughSeason, method: PRODUCTION_METHOD,
    window: { seasons: window, skipped, trainingThrough, holdout: holdoutSeasons },
    sample: {
      players: new Set(cases.map((c) => c.player.playerId)).size,
      cases: caseCounts, agingPairs,
      holdoutCases: asFitted.pooled.map((r) => r.cases),
    },
    priorWeight: { overall, kinds: priorKinds, aging: priorAging },
    coverage: { asFitted: asFitted.pooled, adopted: adopted.pooled, byKind: adopted.byKind, byUsage: adopted.byUsage },
    aging: { hitter: agingSummary(agingModel, 'hitter'), pitcher: agingSummary(agingModel, 'pitcher') },
    proneness: findings,
    gate: { passed, reason, tolerance: tol, minimumCases: policy.gate.minimumCases },
    label,
  };
  return { model, record };
}

const pct = (x: number | null): string => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);

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

/**
 * Held-out coverage, run through the projection itself so it is exactly what a GM would see: pooled,
 * by kind, and by expected usage (thirds of each kind's expected first-season usage), so a band
 * calibrated on average is seen to hold for regulars and fringe players alike.
 */
function coverageOf(set: SideCase[], model: ProductionModel, keep: (c: SideCase, h: number) => boolean): {
  pooled: CoverageRow[]; byKind: Record<ProductionKind, CoverageRow[]>; byUsage: Record<UsageTier, CoverageRow[]>;
} {
  const provenance: ModelProvenance = { source: 'save_fit', label: 'backtest', stamp: { status: 'calibrated', basis: 'backtest', run: null }, fitId: null, priorWeight: 0 };
  const acc = (): Array<{ n: number; outer: number; inner: number; bias: number }> => Array.from({ length: H }, () => ({ n: 0, outer: 0, inner: 0, bias: 0 }));
  const pooled = acc();
  const byKind = new Map<ProductionKind, ReturnType<typeof acc>>(KINDS.map((k) => [k, acc()]));
  const byUsage = new Map<UsageTier, ReturnType<typeof acc>>((['low', 'mid', 'high'] as UsageTier[]).map((t) => [t, acc()]));
  const projected: Array<{ c: SideCase; seasons: Array<{ wins: { low: number; high: number; central: number }; inner: { low: number; high: number } } | null>; usage: number }> = [];
  for (const c of set) {
    const input = {
      playerId: c.player.playerId, season: c.origin + 1, seasonPlayed: 0, age: c.age,
      batting: c.side === 'batting' ? c.results : [], pitching: c.side === 'pitching' ? c.results : [],
      proneness: c.player.proneness,
    };
    const p = projectProductionWith(input, model, provenance);
    if (p.status !== 'projected') continue;
    const sides = p.seasons.map((s) => s.sides.find((x) => x.side === c.side) ?? null);
    projected.push({ c, seasons: sides, usage: sides[0]?.usage.central ?? 0 });
  }
  // Thirds of expected usage within each kind
  const cuts = new Map<ProductionKind, [number, number]>();
  for (const kind of KINDS) {
    const u = projected.filter((x) => x.c.kind === kind).map((x) => x.usage);
    cuts.set(kind, [quantile(u, 1 / 3) ?? 0, quantile(u, 2 / 3) ?? 0]);
  }
  for (const { c, seasons, usage } of projected) {
    const [a, b] = cuts.get(c.kind)!;
    const tier: UsageTier = usage <= a ? 'low' : usage <= b ? 'mid' : 'high';
    for (let h = 1; h <= H; h += 1) {
      const s = seasons[h - 1];
      if (!keep(c, h) || !s) continue;
      const actual = c.actual(c.origin + h).war;
      for (const target of [pooled[h - 1], byKind.get(c.kind)![h - 1], byUsage.get(tier)![h - 1]]) {
        target.n += 1;
        if (actual >= s.wins.low && actual <= s.wins.high) target.outer += 1;
        if (actual >= s.inner.low && actual <= s.inner.high) target.inner += 1;
        target.bias += actual - s.wins.central;
      }
    }
  }
  const rows = (x: ReturnType<typeof acc>): CoverageRow[] => x.map((r, i) => ({
    horizon: i + 1, cases: r.n,
    outer: r.n > 0 ? r.outer / r.n : null, inner: r.n > 0 ? r.inner / r.n : null, bias: r.n > 0 ? r.bias / r.n : null,
  }));
  return {
    pooled: rows(pooled),
    byKind: Object.fromEntries(KINDS.map((k) => [k, rows(byKind.get(k)!)])) as Record<ProductionKind, CoverageRow[]>,
    byUsage: Object.fromEntries((['low', 'mid', 'high'] as UsageTier[]).map((t) => [t, rows(byUsage.get(t)!)])) as Record<UsageTier, CoverageRow[]>,
  };
}
