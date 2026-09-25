import { describe, expect, it } from 'vitest';
import { evaluatePlatoon, MIN_SPLIT_PA, PLATOON_PRIOR, type PlatoonInput, type PlatoonRatings } from '../server/platoon';
import type { BattingLine } from '../server/resultsMetrics';

/*
 * GOLDEN CASES: platoon. Baseball invariants, not answers about a player.
 *
 *   thin observed splits never overwhelm ratings and the league;
 *   a rating-supported difference survives a weak observed sample;
 *   unknown split evidence stays unknown: it is never presented as "no issue";
 *   the read is symmetric between the hands.
 */

const line = (pa: number, woba: 'good' | 'ok' | 'poor'): BattingLine => {
  const rate = woba === 'good' ? 0.34 : woba === 'ok' ? 0.27 : 0.19;
  const ab = Math.round(pa * 0.9);
  const h = Math.round(ab * rate);
  return {
    year: 2030, g: 0, gs: 0, pa, ab, h, d: Math.round(h * 0.2), t: 0, hr: Math.round(pa * (woba === 'good' ? 0.05 : woba === 'ok' ? 0.03 : 0.01)),
    bb: Math.round(pa * (woba === 'good' ? 0.11 : 0.08)), ibb: 0, hp: 1, sf: 1, k: Math.round(pa * 0.2), sb: 0, cs: 0, gdp: 0, war: 0, ubr: 0,
  };
};
const ratings = (gap: number, norm = 0.015): PlatoonRatings => ({ vsLeft: -gap / 2, vsRight: gap / 2, norm });
const input = (over: Partial<PlatoonInput>): PlatoonInput => ({ recordStabilization: 300, platoon: PLATOON_PRIOR, leagueLeftShare: 0.3, bats: 'L', vsLeft: [], vsRight: [], leagueEffect: 0.015, leagueWoba: 0.32, ...over });

describe('GOLDEN platoon: unknown stays unknown', () => {
  it('no ratings and no usable record is "not enough", never "no issue", even when the league norm is known', () => {
    // Everything he has to say about himself is missing; only the league's norm for his hand is known.
    const r = evaluatePlatoon(input({}));
    expect(r.verdict).toBe('insufficient');
    expect(r.basis).toBe('league_norm');
    expect(r.weakSide).toBeNull();
    expect(r.reasons.join(' ')).toMatch(/league norm/i);
  });

  it('a record too thin to read (under the minimum against the less-faced hand) and no ratings is also "not enough"', () => {
    const r = evaluatePlatoon(input({ vsLeft: [line(MIN_SPLIT_PA - 1, 'poor')], vsRight: [line(500, 'good')] }));
    expect(r.verdict).toBe('insufficient');
    expect(r.basis).toBe('league_norm');
    expect(r.weakSide).toBeNull(); // no side is named weak on the strength of a league prior
    expect(r.reliability).toBe(0);
  });

  it('a switch-hitter with no norm and no ratings is not read', () => {
    const r = evaluatePlatoon(input({ bats: 'S', leagueEffect: null }));
    expect(r.verdict).toBe('insufficient');
  });
});

describe('GOLDEN platoon: thin observed splits do not overwhelm ratings and the league', () => {
  it('an extreme split over a small sample does not create a problem for a hitter whose ratings say he is normal', () => {
    // 65 PA against lefties at a poor rate, 400 against righties at a good one: a glaring split on paper.
    const r = evaluatePlatoon(input({ vsLeft: [line(65, 'poor')], vsRight: [line(400, 'good')], ratings: ratings(0.015) }));
    expect(r.verdict).toBe('no_issue');
    expect(r.reliability).toBeLessThan(0.05); // his own record moves the read by a few percent, no more
  });

  it('the read moves toward his own record as the record grows, and never past it', () => {
    const observedGap = (n: number) => {
      const r = evaluatePlatoon(input({ vsLeft: [line(n, 'poor')], vsRight: [line(n * 3, 'good')], ratings: ratings(0.015) }));
      return r;
    };
    const small = observedGap(100);
    const large = observedGap(2000);
    expect(large.reliability).toBeGreaterThan(small.reliability);
    expect(large.reliability).toBeLessThan(1);
    // the effective sample for a difference is the harmonic combination of both sides, so it needs a lot of both to count for much
    expect(PLATOON_PRIOR.shrinkAroundRatings).toBeGreaterThanOrEqual(1000);
  });

  it('a rating-supported platoon difference survives a weak observed sample', () => {
    // Ratings say he is 60 points better against right-handers than left-handers (the norm for his hand is 15): a large departure.
    const r = evaluatePlatoon(input({ vsLeft: [line(10, 'good')], vsRight: [line(30, 'poor')], ratings: ratings(0.06) }));
    expect(r.basis).toBe('ratings');
    expect(r.verdict).toBe('problem');
    expect(r.weakSide).toBe('L');
  });

  it('the observed sample does not turn a rating-supported problem into "no issue" when it is thin and contradicts', () => {
    const contradicted = evaluatePlatoon(input({ vsLeft: [line(70, 'good')], vsRight: [line(200, 'poor')], ratings: ratings(0.06) }));
    expect(contradicted.verdict).toBe('problem');
  });
});

describe('GOLDEN platoon: symmetry between the hands', () => {
  it('mirroring a hitter (his hand, his ratings, his split) mirrors the weak side and the size of the read', () => {
    // Mirroring reflects the pitchers too: a left-handed batter faces left-handers about 30% of the time, so his mirror faces right-handers 30%.
    const lefty = evaluatePlatoon({ recordStabilization: 300, platoon: PLATOON_PRIOR, leagueLeftShare: 0.3, bats: 'L', vsLeft: [], vsRight: [], leagueEffect: 0.015, leagueWoba: 0.32, ratings: { vsLeft: -0.03, vsRight: 0.03, norm: 0.015 } });
    const righty = evaluatePlatoon({ recordStabilization: 300, platoon: PLATOON_PRIOR, leagueLeftShare: 0.7, bats: 'R', vsLeft: [], vsRight: [], leagueEffect: -0.015, leagueWoba: 0.32, ratings: { vsLeft: 0.03, vsRight: -0.03, norm: -0.015 } });
    expect(lefty.weakSide).toBe('L');
    expect(righty.weakSide).toBe('R');
    expect(lefty.weakBy).toBeCloseTo(righty.weakBy as number, 6);
    expect(lefty.excessOverLeague).toBeCloseTo(righty.excessOverLeague as number, 6);
    expect(lefty.verdict).toBe(righty.verdict);
  });

  it('a hitter who is normal for his hand is not a problem, whichever hand it is', () => {
    for (const [bats, norm] of [['L', 0.015], ['R', -0.015]] as const) {
      const r = evaluatePlatoon({ recordStabilization: 300, platoon: PLATOON_PRIOR, leagueLeftShare: 0.3, bats, vsLeft: [], vsRight: [], leagueEffect: norm, leagueWoba: 0.32, ratings: { vsLeft: -norm / 2, vsRight: norm / 2, norm } });
      expect(r.verdict).toBe('no_issue');
    }
  });
});

describe('GOLDEN platoon: the read says what it is made of', () => {
  it('the league effect, the ratings\' departure and the record\'s adjustment add up to the difference, and each is named', () => {
    const r = evaluatePlatoon(input({ vsLeft: [line(400, 'poor')], vsRight: [line(1200, 'good')], ratings: ratings(0.05) }));
    const d = r.drivers;
    expect(d.league).toBeCloseTo(0.015, 6);
    expect(d.ratings).not.toBeNull();
    expect(d.record).not.toBeNull();
    expect((d.league + (d.ratings ?? 0) + (d.record ?? 0))).toBeCloseTo(r.difference as number, 9);
  });

  it('with no record the record is not a driver, and with no ratings the ratings are not', () => {
    const noRecord = evaluatePlatoon(input({ ratings: ratings(0.05) }));
    expect(noRecord.drivers.record).toBeNull();
    expect(noRecord.drivers.ratings).not.toBeNull();
    const noRatings = evaluatePlatoon(input({ vsLeft: [line(400, 'poor')], vsRight: [line(1200, 'good')] }));
    expect(noRatings.drivers.ratings).toBeNull();
    expect(noRatings.drivers.record).not.toBeNull();
  });

  it('a large record moves the read further than a small one, by the record\'s own driver, with the other drivers unchanged', () => {
    const small = evaluatePlatoon(input({ vsLeft: [line(80, 'poor')], vsRight: [line(240, 'good')], ratings: ratings(0.015) }));
    const large = evaluatePlatoon(input({ vsLeft: [line(800, 'poor')], vsRight: [line(2400, 'good')], ratings: ratings(0.015) }));
    expect(Math.abs(large.drivers.record as number)).toBeGreaterThan(Math.abs(small.drivers.record as number));
    expect(large.drivers.league).toBe(small.drivers.league);
    expect(large.drivers.ratings).toBe(small.drivers.ratings);
  });
});
