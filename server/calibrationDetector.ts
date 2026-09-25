/**
 * The detector: whether a save's own fitted values are CLEARLY BETTER than the fallback on seasons they never saw (D-053 amendment,
 * owner decision 2026-09-25; docs/CALIBRATION.md section 13). Subsystem-neutral and pure: no table, no rating; every number arrives
 * as an argument. MLB Operations uses it for the results lens's season weights and stabilization and for the aging curve; any later
 * fitted tuning value with a fallback uses it the same way. A MEASUREMENT of the league as it stands (the role standards) has no
 * rival value set and is not judged here.
 *
 * What the caller must hand it, and why (the robustness the owner asked for):
 *
 *   - Nested held-out cases. The caller fits its values INSIDE each rolling origin t, choosing every free parameter (the grid point)
 *     on seasons up to t only, and scores the choice on season t + 1. The seasons that judge a choice never took part in it, so a grid
 *     search's selection optimism cannot reach the verdict.
 *   - Paired losses. Each case is one held-out player-season scored under BOTH value sets, so the comparison is within the case.
 *
 * What it does with them:
 *
 *   clearly better  candidate beats rival when ALL of:
 *                   (1) enough: at least `minOrigins` origins, each with at least `minCasesPerOrigin` cases;
 *                   (2) worth it, at a confidence: the LOWER confidence bound of the gain (as a share of the rival's loss) reaches
 *                       `minRelativeGain`, at one-sided level `alpha`, under BOTH units of evidence: across players (the pooled
 *                       difference, standard errors clustered by player, a player's seasons being one piece of evidence) and across
 *                       seasons (each held-out season's own gain, Student's t with seasons - 1 degrees of freedom: everything a season
 *                       shares, how noisy it was, how fast talent moved, moves all its players together). A very large sample cannot
 *                       adopt a trivially small gain, and a gain near the minimum is not adopted on a lucky estimate;
 *                   (3) consistent: the candidate has the lower loss in at least `minOriginShare` of the origins (and at least
 *                       `minOriginsWon`), so one season's luck cannot carry it.
 *   decide          the save's values replace the fallback only when clearly better both UNSHRUNK (out of sample on every league) and
 *                   AS SERVED (shrunk toward the fallback), at `confirmations` consecutive refits. Hysteresis, asymmetric: once the
 *                   save's values serve, a later refit returns to the fallback when the fallback is better than them as served by the
 *                   same two-bound test and consistency, with the minimum at `returnMinRelativeGain` (0): adopting is hard, giving up
 *                   is easy. No flip-flopping on noise between imports; the record carries the previous state, the
 *                   confirmation count and the rule applied.
 *
 * Where the fallback was itself fitted on the league's own seasons (the Arizona import), the as-served comparison can be flattered
 * either way (the served values are shrunk toward an in-sample fallback). What keeps adoption honest is that it also needs the
 * UNSHRUNK comparison, which owes nothing to the fallback. The return to the fallback uses the as-served comparison alone.
 *
 * The error rates of this rule (how often it adopts over a save's lifetime of refits when the true gain is under the practical
 * minimum, how often it detects a real difference, and how many seasons it needs) are measured by simulation and recorded in the run record and docs/CALIBRATION.md section 13
 * (`npm run calibrate detector`).
 */

import { policy, type CalibrationStamp } from './calibration.js';

export const DETECTOR_METHOD = 'detector-3';

export const DETECTOR_STAMP: CalibrationStamp = policy(
  'When a save\'s own fitted values are clearly better than the fallback on held-out seasons: significance, consistency across seasons and a practical minimum gain, judged unshrunk and as served, with hysteresis. Chosen so that the measured false adoption stays at or below 5% (docs/CALIBRATION.md section 13).'
);

/** POLICY. The "clearly better" rule (tuned by simulation to its lifetime target: docs/CALIBRATION.md section 13.3). */
export const DETECTOR_POLICY = {
  /**
   * One-sided level of both confidence bounds on the gain: across players (clustered by player, normal) and across seasons (each
   * held-out season's own gain, Student's t with one fewer degree of freedom than seasons).
   */
  alpha: 0.025,
  /** The LOWER confidence bound of the gain, as a share of the rival's held-out loss, must reach this (a practical minimum). */
  minRelativeGain: 0.01,
  /** The candidate must have the lower loss in at least this share of the scored origins... */
  minOriginShare: 2 / 3,
  /** ...and in at least this many. */
  minOriginsWon: 3,
  /** Origins needed to judge at all, each with at least this many held-out cases. */
  minOrigins: 4,
  minCasesPerOrigin: 50,
  /**
   * Consecutive completed-season refits at which the save's values must be clearly better before they first replace the fallback. A
   * refit that is not clearly better, or that fails, resets the count (the caller carries it only from the season just before).
   */
  confirmations: 2,
  /**
   * The minimum the FALLBACK's lower confidence bound must reach to return once the save's values serve: 0, not the adoption bar.
   * Adopting is hard, giving up is easy (supervisor's call, 2026-09-25): values that stopped helping, after a break in how the league
   * plays (imported real seasons, then the game's own), give way as soon as the fallback is surely better at all.
   */
  returnMinRelativeGain: 0,
} as const;

export type DetectorPolicy = { [K in keyof typeof DETECTOR_POLICY]: number };

/** One held-out case scored under both value sets. */
export interface HeldOutCase {
  /** The player: a player's seasons are one cluster. */
  cluster: number;
  /** The origin season whose fit it was held out from (scored on the season after). */
  origin: number;
  /** Its weight (opportunities, or a pair's weight). */
  weight: number;
  /** Squared error under the candidate's values and under the rival's. */
  candidate: number;
  rival: number;
}

export interface OriginScore {
  origin: number;
  n: number;
  candidate: number;
  rival: number;
  /** The candidate had the lower loss this origin. */
  won: boolean;
}

export type DetectorFailure = 'origins' | 'significance' | 'season_to_season' | 'consistency' | 'size';

export interface Comparison {
  cases: number;
  origins: OriginScore[];
  originsScored: number;
  originsWon: number;
  /** Pooled weighted mean loss under each. */
  candidateLoss: number | null;
  rivalLoss: number | null;
  /** Candidate minus rival (negative is better), its standard error clustered by player, and z. */
  difference: number | null;
  se: number | null;
  z: number | null;
  /** The pooled gain as a share of the rival's loss (positive is better). */
  relativeGain: number | null;
  /** Across seasons: the mean of each held-out season's own relative gain, its standard error, and Student's t (seasons - 1 df). */
  seasonGain: number | null;
  seasonSe: number | null;
  t: number | null;
  /** The lower confidence bound of the gain: the smaller of the player bound and the season bound, each at the policy's level. */
  lowerBound: number | null;
  clearlyBetter: boolean;
  /** Why it is not clearly better, in the rule's order. Empty when it is. */
  failures: DetectorFailure[];
}

/** Whether `candidate` is clearly better than `rival` on these paired held-out cases (the module's rule). */
export function compareHeldOut(cases: HeldOutCase[], policyIn: DetectorPolicy = DETECTOR_POLICY): Comparison {
  const byOrigin = new Map<number, HeldOutCase[]>();
  for (const c of cases) {
    if (!(c.weight > 0 && Number.isFinite(c.candidate) && Number.isFinite(c.rival))) continue;
    const list = byOrigin.get(c.origin);
    if (list) list.push(c); else byOrigin.set(c.origin, [c]);
  }
  const origins: OriginScore[] = [];
  const scored: HeldOutCase[] = [];
  for (const [origin, cs] of [...byOrigin.entries()].sort((a, b) => a[0] - b[0])) {
    if (cs.length < policyIn.minCasesPerOrigin) continue;
    const W = cs.reduce((s, c) => s + c.weight, 0);
    const cand = cs.reduce((s, c) => s + c.weight * c.candidate, 0) / W;
    const riv = cs.reduce((s, c) => s + c.weight * c.rival, 0) / W;
    origins.push({ origin, n: cs.length, candidate: cand, rival: riv, won: cand < riv });
    scored.push(...cs);
  }
  const originsWon = origins.filter((o) => o.won).length;
  const empty: Comparison = {
    cases: scored.length, origins, originsScored: origins.length, originsWon, candidateLoss: null, rivalLoss: null, difference: null, se: null, z: null,
    relativeGain: null, seasonGain: null, seasonSe: null, t: null, lowerBound: null, clearlyBetter: false, failures: ['origins'],
  };
  if (origins.length < policyIn.minOrigins || scored.length === 0) return empty;
  const W = scored.reduce((s, c) => s + c.weight, 0);
  const candidateLoss = scored.reduce((s, c) => s + c.weight * c.candidate, 0) / W;
  const rivalLoss = scored.reduce((s, c) => s + c.weight * c.rival, 0) / W;
  const difference = candidateLoss - rivalLoss;
  // Clustered by player, pooled over the origins: the sum over players of their weighted deviations from the pooled difference
  const byPlayer = new Map<number, number>();
  for (const c of scored) byPlayer.set(c.cluster, (byPlayer.get(c.cluster) ?? 0) + c.weight * (c.candidate - c.rival - difference));
  const se = Math.sqrt([...byPlayer.values()].reduce((s, v) => s + v * v, 0)) / W;
  // Fail closed: no spread measured is no evidence (never an infinite z)
  const z = se > 1e-9 * Math.abs(rivalLoss) && se > 0 ? difference / se : null;
  const relativeGain = rivalLoss > 0 ? -difference / rivalLoss : null;
  // Across seasons: everything a season shares (how noisy it was, how fast talent moved) moves all its players together, so the
  // seasons themselves are the other unit of evidence, with only as many degrees of freedom as seasons less one
  const k = origins.length;
  const gains = origins.map((o) => (o.rival > 0 ? (o.rival - o.candidate) / o.rival : 0));
  const seasonGain = gains.reduce((s, g) => s + g, 0) / k;
  const sd = Math.sqrt(gains.reduce((s, g) => s + (g - seasonGain) ** 2, 0) / (k - 1));
  const seasonSe = sd / Math.sqrt(k);
  const t = seasonSe > 1e-9 ? -seasonGain / seasonSe : null;
  const zq = normalQuantile(1 - policyIn.alpha);
  const tq = studentQuantile(1 - policyIn.alpha, k - 1);
  const lowerBound = relativeGain === null || z === null || t === null
    ? null
    : Math.min(relativeGain - zq * (se / rivalLoss), seasonGain - tq * seasonSe);
  const failures: DetectorFailure[] = [];
  if (z === null || !(z <= -zq)) failures.push('significance');
  if (t === null || !(t <= -tq)) failures.push('season_to_season');
  if (originsWon < Math.max(policyIn.minOriginsWon, Math.ceil(policyIn.minOriginShare * k - 1e-9))) failures.push('consistency');
  if (lowerBound === null || !(lowerBound >= policyIn.minRelativeGain)) failures.push('size');
  return {
    cases: scored.length, origins, originsScored: k, originsWon, candidateLoss, rivalLoss, difference, se, z, relativeGain,
    seasonGain, seasonSe, t, lowerBound, clearlyBetter: failures.length === 0, failures,
  };
}

// ── quantiles (no dependency): the normal by Acklam's rational approximation, Student's t by bisection on its CDF ──

/** The standard normal quantile. */
export function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function logGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of g) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** The regularized incomplete beta function (continued fraction, Numerical Recipes). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (xx: number, aa: number, bb: number) => {
    let c = 1;
    let d = 1 - ((aa + bb) * xx) / (aa + 1);
    d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
    let h = d;
    for (let m = 1; m <= 200; m += 1) {
      const m2 = 2 * m;
      let num = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + num * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
      c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      h *= d * c;
      num = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + num * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
      c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (front * cf(x, a, b)) / a : 1 - (front * cf(1 - x, b, a)) / b;
}

/** Student's t CDF with `df` degrees of freedom. */
export function studentCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Student's t quantile with `df` degrees of freedom (bisection). */
export function studentQuantile(p: number, df: number): number {
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (studentCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The same cases with the roles swapped (is the rival clearly better than the candidate?). */
export const swapped = (cases: HeldOutCase[]): HeldOutCase[] => cases.map((c) => ({ ...c, candidate: c.rival, rival: c.candidate }));

export type ServedSource = 'save' | 'starting';

export interface DetectorDecision {
  method: string;
  /** Whether the held-out seasons could judge at all; when not, nothing is decided and the values in force stay. */
  decided: boolean;
  /** What serves after this refit, and what served before it. */
  serve: ServedSource;
  previous: ServedSource;
  /**
   * Refits in a row, up to and including this one, at which the save's values were clearly better while the fallback served (the
   * confirmation count); 0 once the save's values serve or when this refit did not find them clearly better.
   */
  streak: number;
  /** Which rule applied: to adopt (from the fallback) or to return (from the save's own). */
  rule: 'adopt_if_clearly_better' | 'return_if_fallback_clearly_better';
  /** The save's values against the fallback, unshrunk and as served; and, when the save's own served before, the fallback against them. */
  unshrunk: Comparison;
  served: Comparison;
  reverse: Comparison | null;
  /** One plain sentence (for the record and the API; the page words it itself). */
  reason: string;
}

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(2)}%`);
/** A comparison in one sentence, for the record and the harness. */
export const describeComparison = (c: Comparison): string =>
  `${pct(c.relativeGain)} lower error (at least ${pct(c.lowerBound)} at the policy's confidence), z ${c.z === null ? '—' : c.z.toFixed(2)} across players, t ${c.t === null ? '—' : c.t.toFixed(2)} across seasons, better in ${c.originsWon} of ${c.originsScored} seasons`;

/** The rule in words, for a run record's notes. */
export function ruleText(policyIn: DetectorPolicy = DETECTOR_POLICY): string {
  return `${DETECTOR_METHOD}: to adopt, the lower ${+((1 - policyIn.alpha) * 100).toFixed(1)}% confidence bound of the gain, across players (clustered by player) and across seasons (Student's t), at least ${(policyIn.minRelativeGain * 100).toFixed(1)}% of the starting values' error; better in at least ${Math.round(policyIn.minOriginShare * 100)}% of the seasons checked and at least ${policyIn.minOriginsWon}; at least ${policyIn.minOrigins} seasons of ${policyIn.minCasesPerOrigin} cases; unshrunk and as served${policyIn.confirmations > 1 ? `; at ${policyIn.confirmations} consecutive completed-season refits` : ''}; to return, the same test with the minimum at ${(policyIn.returnMinRelativeGain * 100).toFixed(1)}%`;
}

/**
 * Decide what serves after a refit. `unshrunk` and `served` are the paired held-out cases of the save's values (candidate) against the
 * fallback (rival), fitted inside each origin; `previous` is what served before this refit and `streak` the refits in a row before
 * this one that found the save's values clearly better while the fallback served.
 */
export function decide(input: { unshrunk: HeldOutCase[]; served: HeldOutCase[]; previous: ServedSource; streak?: number }, policyIn: DetectorPolicy = DETECTOR_POLICY): DetectorDecision {
  const unshrunk = compareHeldOut(input.unshrunk, policyIn);
  const served = compareHeldOut(input.served, policyIn);
  const base = { method: DETECTOR_METHOD, previous: input.previous, unshrunk, served };
  if (unshrunk.failures.includes('origins') || served.failures.includes('origins')) {
    return {
      ...base, decided: false, serve: input.previous, reverse: null, streak: input.streak ?? 0,
      rule: input.previous === 'save' ? 'return_if_fallback_clearly_better' : 'adopt_if_clearly_better',
      reason: `Not enough held-out seasons to judge (${served.originsScored} with enough players, ${policyIn.minOrigins} needed); the values in force stay.`,
    };
  }
  if (input.previous === 'starting') {
    const better = unshrunk.clearlyBetter && served.clearlyBetter;
    const streak = better ? (input.streak ?? 0) + 1 : 0;
    const adopt = better && streak >= policyIn.confirmations;
    return {
      ...base, decided: true, serve: adopt ? 'save' : 'starting', reverse: null, rule: 'adopt_if_clearly_better', streak: adopt ? 0 : streak,
      reason: adopt
        ? `The save's own values are clearly better on held-out seasons${policyIn.confirmations > 1 ? ` at ${streak} refits in a row` : ''} (as served: ${describeComparison(served)}; unshrunk: ${describeComparison(unshrunk)}).`
        : better
          ? `The save's own values were clearly better at this refit (${streak} of the ${policyIn.confirmations} in a row needed); the starting values serve until it is confirmed.`
          : `The starting values held up: the save's own were not clearly better (as served: ${describeComparison(served)}; failing ${[...new Set([...served.failures, ...unshrunk.failures])].join(', ')}).`,
    };
  }
  // Giving up is easy: the same two-bound test and consistency, with the minimum at zero
  const reverse = compareHeldOut(swapped(input.served), { ...policyIn, minRelativeGain: policyIn.returnMinRelativeGain });
  const back = reverse.clearlyBetter;
  return {
    ...base, decided: true, serve: back ? 'starting' : 'save', reverse, rule: 'return_if_fallback_clearly_better', streak: 0,
    reason: back
      ? `The starting values are now surely better than the save's own as served (${describeComparison(reverse)}); they serve again.`
      : `The save's own values stay: the starting values are not surely better than them (${describeComparison(reverse)}).`,
  };
}
