import { describe, expect, it } from 'vitest';
import {
  blendStabilization, PARK_WOBA_SHARE, reliability, SEASON_WEIGHTS, weightedBatting, weightedBaserunning, type BattingLine, type SeasonEnvironment,
} from '../server/resultsMetrics';
import { estimateOf, type LensEvidence } from '../server/roleReview';

/*
 * The results lens under stress. The question is never "what was his wOBA", it is "how much should what he has done change what we
 * believe about him": a hot week over a long record, a slump over an established level, a full year against a few weeks, a breakout,
 * a hitter in a hitter's park, a hitter with no history.
 */

const YEAR = 2030;
const env = new Map<number, SeasonEnvironment>([2028, 2029, 2030].map((y) => [y, { year: y, woba: 0.32, fipRaw: 0.3, era: 4.2 }]));

/** A line of `pa` plate appearances at (approximately) the wOBA asked for, built from real counting stats. */
function line(year: number, pa: number, woba: number, over: Partial<BattingLine> = {}): BattingLine {
  // scale the hit mix so wOBA lands on target: a baseline of .320 with walks and hits moved together
  const scale = woba / 0.32;
  const ab = Math.round(pa * 0.9);
  const singles = Math.round(ab * 0.16 * scale);
  const d = Math.round(ab * 0.05 * scale);
  const t = 0;
  const hr = Math.round(ab * 0.035 * scale);
  const bb = Math.round(pa * 0.085 * scale);
  return { year, g: Math.round(pa / 4), gs: Math.round(pa / 4), pa, ab, h: singles + d + t + hr, d, t, hr, bb, ibb: 0, hp: 2, sf: 2, k: Math.round(pa * 0.2), sb: 0, cs: 0, gdp: 0, war: 0, ubr: 0, ...over };
}
const value = (lines: BattingLine[]) => weightedBatting(lines, env, YEAR).value as number;
const pts = (n: number) => Math.round(n * 1000);

describe('how much current performance should move the level', () => {
  const established = [line(2028, 600, 0.35), line(2029, 600, 0.35)];

  it('a hot start over a long record moves the level a little, in the right direction, and never past what the sample supports', () => {
    const base = value(established);
    const hot = value([...established, line(YEAR, 60, 0.5)]);
    expect(hot).toBeGreaterThan(base);
    expect(pts(hot) - pts(base)).toBeLessThan(15); // a week's hot streak over two full seasons: a handful of points
    expect(hot).toBeLessThan(0.5 - 0.32);          // and nowhere near the streak itself
  });

  it('a slump does the same thing the other way', () => {
    const base = value(established);
    const cold = value([...established, line(YEAR, 60, 0.2)]);
    expect(cold).toBeLessThan(base);
    expect(pts(base) - pts(cold)).toBeLessThan(25);
  });

  it('a full season of the same performance moves the level much more than a few weeks of it', () => {
    const few = value([...established, line(YEAR, 60, 0.28)]);
    const full = value([...established, line(YEAR, 600, 0.28)]);
    const base = value(established);
    expect(base - full).toBeGreaterThan(2 * (base - few));
  });

  it('is monotone: more (or better) current production never lowers the results value', () => {
    let last = -Infinity;
    for (const w of [0.2, 0.26, 0.32, 0.38, 0.44]) {
      const v = value([...established, line(YEAR, 200, w)]);
      expect(v).toBeGreaterThan(last);
      last = v;
    }
  });

  it('the newest season counts most per plate appearance, and the weights are the declared ones', () => {
    const improving = value([line(2028, 500, 0.28), line(2029, 500, 0.32), line(YEAR, 500, 0.36)]);
    const declining = value([line(2028, 500, 0.36), line(2029, 500, 0.32), line(YEAR, 500, 0.28)]);
    expect(improving).toBeGreaterThan(declining); // the same three seasons in the other order
    expect(SEASON_WEIGHTS.hitter[0]).toBeGreaterThan(SEASON_WEIGHTS.hitter[1]);
  });

  it('a hitter with no history at all has no results value, not a bad one', () => {
    expect(weightedBatting([], env, YEAR).value).toBeNull();
    expect(weightedBatting([line(YEAR, 0, 0.3)], env, YEAR).value).toBeNull();
  });
});

describe('sample size is an uncertainty, never a confidence', () => {
  it('trust in results grows with the sample and stays between nothing and everything', () => {
    let last = 0;
    for (const n of [0, 10, 50, 150, 300, 600, 1200, 5000]) {
      const r = reliability(n, blendStabilization('hitter'));
      expect(r).toBeGreaterThanOrEqual(last);
      expect(r).toBeLessThan(1);
      last = r;
    }
    expect(reliability(0, 300)).toBe(0);
  });

  it('with the same results percentile, less sample moves the estimate less from the tools, never more', () => {
    const ev = (reliabilityValue: number): LensEvidence => ({
      position: 10, ratingsPct: 50, ratingsEvidence: 'complete', skillsPct: 90, runsPct: null, sample: 1, sampleUnit: 'PA', reliability: reliabilityValue, currentSample: 50,
      defense: { pct: null, grade: null, visible: false }, usage: [],
    });
    let last = 50;
    for (const n of [0, 20, 100, 300, 800, 2000]) {
      const est = estimateOf(ev(reliability(n, blendStabilization('hitter'))), false).value as number;
      expect(est).toBeGreaterThanOrEqual(last);
      expect(est).toBeLessThan(90);
      last = est;
    }
  });

  it('when only results exist the estimate is pulled toward the middle by how little sample stands behind them', () => {
    const resultsOnly = (r: number): LensEvidence => ({
      position: 10, ratingsPct: null, ratingsEvidence: 'unknown', skillsPct: 95, runsPct: null, sample: 30, sampleUnit: 'PA', reliability: r, currentSample: 30,
      defense: { pct: null, grade: null, visible: false }, usage: [],
    });
    const thin = estimateOf(resultsOnly(0.05), false);
    // results-only: the estimate is the results percentile itself (there is nothing to shrink toward but the league); it is labelled so and carries its weight
    expect(thin.basis).toBe('results_only');
    expect(thin.weightOnResults).toBe(1);
  });
});

describe('park effects', () => {
  it('the same raw line reads lower in a hitter\'s park than in a pitcher\'s park', () => {
    const raw = line(YEAR, 600, 0.36);
    const coors = weightedBatting([{ ...raw, park: 1.15 }], env, YEAR).value as number;
    const petco = weightedBatting([{ ...raw, park: 0.9 }], env, YEAR).value as number;
    const neutral = weightedBatting([{ ...raw, park: 1 }], env, YEAR).value as number;
    expect(coors).toBeLessThan(neutral);
    expect(petco).toBeGreaterThan(neutral);
    expect(pts(neutral - coors)).toBeLessThan(25); // adjusted by a share of the park's run effect, not all of it
    expect(PARK_WOBA_SHARE).toBeLessThan(1);
  });

  it('a missing park factor is no adjustment, not a guess', () => {
    const raw = line(YEAR, 600, 0.36);
    expect(weightedBatting([raw], env, YEAR).value).toBe(weightedBatting([{ ...raw, park: 1 }], env, YEAR).value);
  });
});

describe('baserunning stays small and visible', () => {
  const runs = (ubr: number, sb: number, cs: number, pa = 600) => weightedBaserunning([line(YEAR, pa, 0.32, { ubr, sb, cs })], YEAR);

  it('a caught stealing costs more than a steal earns, so a reckless runner is not a good one', () => {
    expect(runs(0, 10, 10).perSixHundred as number).toBeLessThan(0);
    expect(runs(0, 20, 4).perSixHundred as number).toBeGreaterThan(0);
  });

  it('a low sample is not trusted as a level, and a large one is trusted more', () => {
    expect(runs(3, 5, 1, 40).reliability).toBeLessThan(runs(3, 5, 1, 600).reliability);
  });

  it('no baserunning record at all is unknown, not zero', () => {
    expect(weightedBaserunning([], YEAR).perSixHundred).toBeNull();
  });
});
