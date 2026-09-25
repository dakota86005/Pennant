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
 *                   (2) significant: the pooled weighted mean loss difference is below zero by at least `zClear` standard errors,
 *                       clustered by player (a player's seasons are not independent), pooled over the origins;
 *                   (3) consistent: the candidate has the lower loss in at least `minOriginShare` of the origins (and at least
 *                       `minOriginsWon`), so one season's luck cannot carry it;
 *                   (4) worth it: the pooled gain is at least `minRelativeGain` of the rival's loss, so a very large sample cannot adopt
 *                       a trivially small gain.
 *   decide          the save's values replace the fallback only when clearly better both UNSHRUNK (out of sample on every league) and
 *                   AS SERVED (shrunk toward the fallback). Hysteresis: once the save's values serve, a later refit returns to the
 *                   fallback only when the fallback is clearly better than the save's values as served, by the same rule. No
 *                   flip-flopping on noise between imports; the record carries the previous state and the rule applied.
 *
 * The prior cannot flatter either scoring toward adoption: where the fallback was itself fitted on the league's own seasons (the
 * Arizona import), its held-out scores are in sample, which can only make the save's values look worse, never better; and the
 * unshrunk scoring owes nothing to the fallback at all.
 *
 * The error rates of this rule (how often it adopts when the fallback is right, how often it detects a real difference, and how many
 * seasons it needs) are measured by simulation and recorded in the run record and docs/CALIBRATION.md section 13
 * (`npm run calibrate detector`).
 */

import { policy, type CalibrationStamp } from './calibration.js';

export const DETECTOR_METHOD = 'detector-1';

export const DETECTOR_STAMP: CalibrationStamp = policy(
  'When a save\'s own fitted values are clearly better than the fallback on held-out seasons: significance, consistency across seasons and a practical minimum gain, judged unshrunk and as served, with hysteresis. Chosen so that the measured false adoption stays at or below 5% (docs/CALIBRATION.md section 13).'
);

/** POLICY. The "clearly better" rule. */
export const DETECTOR_POLICY = {
  /** The pooled paired improvement must be at least this many clustered standard errors. */
  zClear: 2,
  /** The candidate must have the lower loss in at least this share of the scored origins... */
  minOriginShare: 2 / 3,
  /** ...and in at least this many. */
  minOriginsWon: 3,
  /** The pooled gain must be at least this share of the rival's held-out loss (a practical minimum). */
  minRelativeGain: 0.01,
  /** Origins needed to judge at all, each with at least this many held-out cases. */
  minOrigins: 4,
  minCasesPerOrigin: 50,
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

export type DetectorFailure = 'origins' | 'significance' | 'consistency' | 'size';

export interface Comparison {
  cases: number;
  origins: OriginScore[];
  originsScored: number;
  originsWon: number;
  /** Pooled weighted mean loss under each. */
  candidateLoss: number | null;
  rivalLoss: number | null;
  /** Candidate minus rival (negative is better), its clustered standard error and z. */
  difference: number | null;
  se: number | null;
  z: number | null;
  /** The pooled gain as a share of the rival's loss (positive is better). */
  relativeGain: number | null;
  clearlyBetter: boolean;
  /** Why it is not clearly better, in the rule's order. Empty when it is. */
  failures: DetectorFailure[];
}

/** Whether `candidate` is clearly better than `rival` on these paired held-out cases (the module's rule). */
export function compareHeldOut(cases: HeldOutCase[], policyIn: DetectorPolicy = DETECTOR_POLICY): Comparison {
  const byOrigin = new Map<number, HeldOutCase[]>();
  for (const c of cases) if (c.weight > 0 && Number.isFinite(c.candidate) && Number.isFinite(c.rival)) byOrigin.set(c.origin, [...(byOrigin.get(c.origin) ?? []), c]);
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
    relativeGain: null, clearlyBetter: false, failures: ['origins'],
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
  const z = se > 0 ? difference / se : difference < 0 ? -Infinity : difference > 0 ? Infinity : 0;
  const relativeGain = rivalLoss > 0 ? -difference / rivalLoss : 0;
  const failures: DetectorFailure[] = [];
  if (!(z <= -policyIn.zClear)) failures.push('significance');
  if (originsWon < Math.max(policyIn.minOriginsWon, Math.ceil(policyIn.minOriginShare * origins.length - 1e-9))) failures.push('consistency');
  if (!(relativeGain >= policyIn.minRelativeGain)) failures.push('size');
  return { cases: scored.length, origins, originsScored: origins.length, originsWon, candidateLoss, rivalLoss, difference, se, z, relativeGain, clearlyBetter: failures.length === 0, failures };
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
  /** Which rule applied: to adopt (from the fallback) or to return (from the save's own). */
  rule: 'adopt_if_clearly_better' | 'return_if_fallback_clearly_better';
  /** The save's values against the fallback, unshrunk and as served; and, when the save's own served before, the fallback against them. */
  unshrunk: Comparison;
  served: Comparison;
  reverse: Comparison | null;
  /** One plain sentence (for the record and the API; the page words it itself). */
  reason: string;
}

const pctGain = (c: Comparison) => (c.relativeGain === null ? '—' : `${(c.relativeGain * 100).toFixed(2)}%`);
const zOf = (c: Comparison) => (c.z === null ? '—' : c.z.toFixed(2));
const describe = (c: Comparison) => `${pctGain(c)} lower error, z ${zOf(c)}, better in ${c.originsWon} of ${c.originsScored} seasons`;

/**
 * Decide what serves after a refit. `unshrunk` and `served` are the paired held-out cases of the save's values (candidate) against the
 * fallback (rival), fitted inside each origin; `previous` is what served before this refit.
 */
export function decide(input: { unshrunk: HeldOutCase[]; served: HeldOutCase[]; previous: ServedSource }, policyIn: DetectorPolicy = DETECTOR_POLICY): DetectorDecision {
  const unshrunk = compareHeldOut(input.unshrunk, policyIn);
  const served = compareHeldOut(input.served, policyIn);
  const base = { method: DETECTOR_METHOD, previous: input.previous, unshrunk, served };
  if (unshrunk.failures.includes('origins') || served.failures.includes('origins')) {
    return {
      ...base, decided: false, serve: input.previous, reverse: null,
      rule: input.previous === 'save' ? 'return_if_fallback_clearly_better' : 'adopt_if_clearly_better',
      reason: `Not enough held-out seasons to judge (${served.originsScored} with enough players, ${policyIn.minOrigins} needed); the values in force stay.`,
    };
  }
  if (input.previous === 'starting') {
    const adopt = unshrunk.clearlyBetter && served.clearlyBetter;
    return {
      ...base, decided: true, serve: adopt ? 'save' : 'starting', reverse: null, rule: 'adopt_if_clearly_better',
      reason: adopt
        ? `The save's own values are clearly better on held-out seasons (as served: ${describe(served)}; unshrunk: ${describe(unshrunk)}).`
        : `The starting values held up: the save's own were not clearly better (as served: ${describe(served)}; failing ${[...new Set([...served.failures, ...unshrunk.failures])].join(', ')}).`,
    };
  }
  const reverse = compareHeldOut(swapped(input.served), policyIn);
  const back = reverse.clearlyBetter;
  return {
    ...base, decided: true, serve: back ? 'starting' : 'save', reverse, rule: 'return_if_fallback_clearly_better',
    reason: back
      ? `The starting values are now clearly better than the save's own as served (${describe(reverse)}); they serve again.`
      : `The save's own values stay: the starting values are not clearly better than them (${describe(reverse)}).`,
  };
}
