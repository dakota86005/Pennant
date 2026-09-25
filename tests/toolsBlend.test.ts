import { describe, expect, it } from 'vitest';
import { blendStabilization, reliability, RESULTS_PRIOR, type ResultsKind, type ResultsParams } from '../server/resultsMetrics';

/**
 * How much the visible tools hold a player's results back (cycle 4 of the per-save calibration; docs/CALIBRATION.md section 15).
 *
 * Before cycle 4 the blend was K × (1 − information): the more the tools explained, the smaller the sample at which the results
 * counted as much as the tools, so knowing a player's tools made his results count MORE than they would with no tools at all. The
 * Bayesian blend points the other way (K ÷ (1 − information)). The tools weight is now a multiplier of at least 1.
 */

const KINDS: ResultsKind[] = ['hitter', 'starter', 'reliever'];
const withWeight = (w: number): ResultsParams => ({ ...RESULTS_PRIOR, toolsWeight: { hitter: w, starter: w, reliever: w } });

describe('the tools weight', () => {
  it('knowing a player\'s visible tools never makes his results count more than they would on their own', () => {
    for (const kind of KINDS) {
      for (const w of [0, 0.4, 0.6, 1, 1.5, 3]) {
        const k = blendStabilization(kind, withWeight(w));
        expect(k, `${kind} at ${w}`).toBeGreaterThanOrEqual(RESULTS_PRIOR.stabilization[kind]);
        for (const n of [50, 300, 1500]) expect(reliability(n, k)).toBeLessThanOrEqual(reliability(n, RESULTS_PRIOR.stabilization[kind]));
      }
    }
  });

  it('the more the tools are trusted, the less the same results move the estimate', () => {
    for (const kind of KINDS) {
      let last = Infinity;
      for (const w of [1, 1.25, 1.67, 2.5, 5]) {
        const trust = reliability(400, blendStabilization(kind, withWeight(w)));
        expect(trust).toBeLessThan(last);
        last = trust;
      }
    }
  });

  it('the starting value is the results\' own K (the tools pull only by their own weight until a save checks them as a forecast)', () => {
    for (const kind of KINDS) {
      expect(RESULTS_PRIOR.toolsWeight[kind]).toBe(1);
      expect(blendStabilization(kind, RESULTS_PRIOR)).toBe(RESULTS_PRIOR.stabilization[kind]);
    }
  });

  it('follows the save\'s own K where one serves: the weight multiplies the K in force', () => {
    const own: ResultsParams = { ...RESULTS_PRIOR, stabilization: { ...RESULTS_PRIOR.stabilization, hitter: 900 }, toolsWeight: { hitter: 1.5, starter: 1, reliever: 1 } };
    expect(blendStabilization('hitter', own)).toBe(1350);
  });
});
