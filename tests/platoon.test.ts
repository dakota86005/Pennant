import { describe, expect, it } from 'vitest';
import {
  complementFit, COMPLEMENT_MARGIN, evaluatePlatoon, MIN_SPLIT_PA, PLATOON_CALIBRATION, PLATOON_PRIOR, PROBLEM_EXCESS,
  type PlatoonInput, type PlatoonRatings,
} from '../server/platoon';
import type { BattingLine } from '../server/resultsMetrics';
import { platoonHeadline } from '../src/pages/mlb/platoonCopy';

/*
 * Platoon is the league's effect for a hitter's handedness, adjusted by his visible platoon ratings (D-035), with his own
 * record pulled toward that: calibration shows a hitter's own split adds little beyond the ratings and the league. A weaker
 * side is not a problem unless it exceeds what the league itself explains.
 */

const line = (pa: number, hit: 'good' | 'ok' | 'poor'): BattingLine => {
  const rate = hit === 'good' ? 0.34 : hit === 'ok' ? 0.27 : 0.19; // batting-average-like contact rate
  const ab = Math.round(pa * 0.9);
  const h = Math.round(ab * rate);
  const hr = hit === 'good' ? Math.round(pa * 0.05) : hit === 'ok' ? Math.round(pa * 0.03) : Math.round(pa * 0.01);
  return {
    year: 2030, g: 0, gs: 0, pa, ab, h, d: Math.round(h * 0.2), t: 0, hr, bb: Math.round(pa * (hit === 'good' ? 0.11 : 0.08)), ibb: 0, hp: 1, sf: 1,
    k: Math.round(pa * 0.2), sb: 0, cs: 0, gdp: 0, war: 0, ubr: 0,
  };
};

/** Ratings that say he is `gap` wOBA points better against right-handers than left-handers, against a norm for his hand. */
const ratings = (gap: number, norm = 0.015): PlatoonRatings => ({ vsLeft: -gap / 2, vsRight: gap / 2, norm });
const input = (over: Partial<PlatoonInput>): PlatoonInput => ({ recordStabilization: 300, platoon: PLATOON_PRIOR, leagueLeftShare: 0.3, bats: 'L', vsLeft: [], vsRight: [], leagueEffect: 0.015, leagueWoba: 0.32, ...over });

describe('reading a platoon split honestly', () => {
  it('nothing to go on (no ratings, no league norm, too thin a record) is not read at all', () => {
    const r = evaluatePlatoon(input({ vsLeft: [line(MIN_SPLIT_PA - 1, 'poor')], vsRight: [line(600, 'ok')], leagueEffect: null }));
    expect(r.verdict).toBe('insufficient');
    expect(r.basis).toBe('none');
    expect(r.reasons[0]).toMatch(/Not enough to read a platoon split/);
    expect(r.weakSide).toBeNull();
  });

  it('a thin record with ratings still gives a read, on the ratings, and says so', () => {
    const r = evaluatePlatoon(input({ vsLeft: [line(10, 'poor')], vsRight: [line(80, 'good')], ratings: ratings(0.05) }));
    expect(r.basis).toBe('ratings');
    expect(r.verdict).not.toBe('insufficient');
    expect(r.reliability).toBe(0);
    expect(r.reasons.join(' ')).toMatch(/visible ratings/);
    expect(r.reasons.join(' ')).toMatch(/too thin/);
  });

  it('ratings far outside the norm for his hand make a problem even with no record at all', () => {
    const r = evaluatePlatoon(input({ ratings: ratings(0.06, 0.015) }));
    expect(r.verdict).toBe('problem');
    expect(r.weakSide).toBe('L');
    expect(r.basis).toBe('ratings');
    expect(r.ratingDeparture).toBeCloseTo(0.045, 6);
    expect(r.excessOverLeague as number).toBeGreaterThanOrEqual(PROBLEM_EXCESS);
  });

  it('ratings at the norm for his hand are no problem, whatever a small sample looks like', () => {
    const r = evaluatePlatoon(input({ vsLeft: [line(70, 'poor')], vsRight: [line(200, 'good')], ratings: ratings(0.015, 0.015) }));
    expect(r.verdict).toBe('no_issue');
    expect(r.reasons.join(' ')).toMatch(/not a platoon problem/);
  });

  it("his own record moves the read only a little: a big split does not overturn ratings at the norm", () => {
    const r = evaluatePlatoon(input({ vsLeft: [line(700, 'poor')], vsRight: [line(1800, 'good')], ratings: ratings(0.015, 0.015) }));
    expect(r.reliability).toBeLessThan(0.25);
    expect(r.verdict).toBe('no_issue');
    // and the weight shrinks as the constant says: half at K effective plate appearances
    const effective = (700 * 1800) / 2500;
    expect(r.reliability).toBeCloseTo(effective / (effective + PLATOON_PRIOR.shrinkAroundRatings), 6);
  });

  it('with no ratings the record still counts, shrunk toward the league', () => {
    const big = evaluatePlatoon(input({ vsLeft: [line(2000, 'poor')], vsRight: [line(4000, 'good')] }));
    const small = evaluatePlatoon(input({ vsLeft: [line(70, 'poor')], vsRight: [line(200, 'good')] }));
    expect(big.basis).toBe('splits');
    expect(small.reliability).toBeLessThan(big.reliability);
    expect((small.weakBy as number)).toBeLessThan(big.weakBy as number);
  });

  it('the weaker side is not a problem when it is only what the league itself shows', () => {
    const r = evaluatePlatoon(input({ bats: 'R', vsLeft: [line(500, 'ok')], vsRight: [line(1500, 'ok')], leagueEffect: -0.01, ratings: ratings(-0.01, -0.01) }));
    expect(r.verdict).toBe('no_issue');
  });

  it('states expected levels on the wOBA scale when a level can be stated, and none when it cannot', () => {
    const withLevel = evaluatePlatoon(input({ ratings: ratings(0.02, 0.015) }));
    expect(withLevel.vsLeft.expected).not.toBeNull();
    expect(withLevel.vsRight.expected as number).toBeGreaterThan(withLevel.vsLeft.expected as number);
    const noLevel = evaluatePlatoon(input({ leagueWoba: null, ratings: ratings(0.02, 0.015) }));
    expect(noLevel.vsLeft.expected).toBeNull();
    expect(noLevel.weakSide).not.toBeNull();
  });

  it('declares its calibration: the starting values are provisional, the margins policy', () => {
    expect(evaluatePlatoon(input({})).calibration).toBe(PLATOON_CALIBRATION);
    expect(PLATOON_CALIBRATION.status).toBe('provisional');
    expect(PLATOON_PRIOR.ratingWeight).toBe(1);
  });

  it('his own split is weighed by the value in force: around the league norm the save\'s own, around his ratings the starting value', () => {
    const own = { ...PLATOON_PRIOR, shrinkAroundLeague: 500, source: 'save' as const };
    const splitsOnly = evaluatePlatoon(input({ vsLeft: [line(700, 'poor')], vsRight: [line(1800, 'good')], platoon: own }));
    const effective = (700 * 1800) / 2500;
    expect(splitsOnly.basis).toBe('splits');
    expect(splitsOnly.reliability).toBeCloseTo(effective / (effective + 500), 6);
    expect(splitsOnly.reasons.join(' ')).toMatch(/this league's past seasons/);
    const withRatings = evaluatePlatoon(input({ vsLeft: [line(700, 'poor')], vsRight: [line(1800, 'good')], ratings: ratings(0.015, 0.015), platoon: own }));
    expect(withRatings.reliability).toBeCloseTo(effective / (effective + PLATOON_PRIOR.shrinkAroundRatings), 6);
    const starting = evaluatePlatoon(input({ vsLeft: [line(700, 'poor')], vsRight: [line(1800, 'good')] }));
    expect(starting.reasons.join(' ')).not.toMatch(/this league/);
  });

  it('an unknown usual split for his hand is never taken as zero: no problem is found, the save\'s weight is not applied, and the read says why', () => {
    const own = { ...PLATOON_PRIOR, shrinkAroundLeague: 500, source: 'save' as const };
    // a big observed split that, measured from zero with the league's own weight, would read as a problem
    const r = evaluatePlatoon(input({ bats: 'S', leagueEffect: null, vsLeft: [line(200, 'poor')], vsRight: [line(400, 'good')], platoon: own }));
    expect(r.verdict).toBe('insufficient');
    expect(r.excessOverLeague).toBeNull();
    expect(r.difference).toBeNull();
    expect(r.drivers.league).toBeNull();
    expect(r.vsLeft.observed).not.toBeNull(); // what his record shows is still said
    expect(r.reasons.join(' ')).toMatch(/usual split for hitters of his hand is not established/);
    expect(r.reasons.join(' ')).not.toMatch(/this league's past seasons/);
    // his ratings alone do not stand in for the league's split either, and the read says they were seen
    const withRatings = evaluatePlatoon(input({ leagueEffect: null, ratings: ratings(0.06, 0.015) }));
    expect(withRatings.verdict).toBe('insufficient');
    expect(withRatings.reasons.join(' ')).toMatch(/His visible ratings imply/);
    // the page's one line gives that reason, not "not enough to read"
    expect(platoonHeadline(r)).toBe("Can't judge a platoon split: the usual split for his hand isn't known in this league.");
    expect(platoonHeadline(evaluatePlatoon(input({ vsLeft: [line(10, 'poor')], vsRight: [line(30, 'good')] })))).toBe('Not enough to read a platoon split.');
  });

  it('an unknown share of plate appearances against left-handers states no cost, never an assumed share', () => {
    const r = evaluatePlatoon(input({ leagueLeftShare: null, ratings: ratings(0.06, 0.015) }));
    expect(r.verdict).toBe('insufficient');
    expect(r.weakBy).toBeNull();
    expect(r.reasons.join(' ')).toMatch(/does not say how often/);
    // his own record gives his share: then the read stands
    expect(evaluatePlatoon(input({ leagueLeftShare: null, vsLeft: [line(300, 'poor')], vsRight: [line(700, 'good')], ratings: ratings(0.06, 0.015) })).verdict).not.toBe('insufficient');
  });
});

describe('a complement', () => {
  const problem = evaluatePlatoon(input({ ratings: ratings(0.06, 0.015) }));
  const good = evaluatePlatoon(input({ bats: 'R', leagueEffect: -0.01, ratings: { vsLeft: 0.03, vsRight: 0.0, norm: -0.01 } }));
  const weak = evaluatePlatoon(input({ bats: 'L', ratings: ratings(0.06, 0.015) }));

  it('fits when he is clearly better against the hand the regular struggles with', () => {
    const fit = complementFit(problem, good);
    expect(problem.verdict).toBe('problem');
    expect(fit.fits).toBe(true);
    expect(fit.advantage as number).toBeGreaterThanOrEqual(COMPLEMENT_MARGIN);
  });

  it('does not fit when he has the same weakness', () => {
    expect(complementFit(problem, weak).fits).toBe(false);
  });

  it('nothing to complement when the regular has no problem', () => {
    const fine = evaluatePlatoon(input({ ratings: ratings(0.015, 0.015) }));
    const fit = complementFit(fine, good);
    expect(fit.fits).toBe(false);
    expect(fit.reasons[0]).toMatch(/nothing to complement/);
  });

  it('cannot say when the candidate has no read against that hand', () => {
    const blank = evaluatePlatoon(input({ leagueWoba: null }));
    expect(complementFit(problem, blank).fits).toBe(false);
  });
});
