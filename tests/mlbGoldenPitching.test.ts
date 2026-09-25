import { describe, expect, it } from 'vitest';
import {
  CREDIBLE_HIGH_LEVERAGE, deploymentFindings, LEVERAGE, MULTI_INNING, MIN_APPEARANCES, penFindings, roleOf, starterConflicts, type BullpenTier, type PenArm,
} from '../server/bullpenRoles';
import { BULLPEN_PRIOR } from '../server/bullpenRoles';
import { reviewGroup, type LensEvidence, type ReviewSubject } from '../server/roleReview';
import { relieverStandard, starterStandard } from '../server/roleStandards';

/*
 * GOLDEN CASES: pitching. What a reliever's usage says about his job, and what a weak line means in each job.
 */

const usage = (over: Partial<Parameters<typeof roleOf>[0]>) => roleOf({ playerId: 1, name: 'R', g: 30, ip: 30, sv: 0, hld: 0, leverage: 1.0, ...over }, BULLPEN_PRIOR);

describe('GOLDEN bullpen: roles for extreme profiles', () => {
  it('a save-getter at high leverage is the closer; the same leverage without saves is a high-leverage arm', () => {
    expect(usage({ leverage: 2.1, sv: 12, hld: 2 }).tier).toBe('closer');
    expect(usage({ leverage: 2.1, sv: 0, hld: 8 }).tier).toBe('high_leverage');
    expect(usage({ leverage: LEVERAGE.high }).tier).toBe('high_leverage');
  });

  it('a multi-inning arm at low leverage is a long man, and a one-inning arm at low leverage is a low-leverage arm', () => {
    expect(usage({ leverage: 0.8, g: 20, ip: 44 }).tier).toBe('long');
    expect(usage({ leverage: 0.7, g: 30, ip: 30 }).tier).toBe('low_leverage');
    expect(usage({ leverage: 1.0, g: 30, ip: 30 }).tier).toBe('middle');
  });

  it('a multi-inning arm used in high leverage is a high-leverage arm, not a long man (leverage decides before length)', () => {
    expect(usage({ leverage: 1.5, g: 20, ip: 40 }).tier).toBe('high_leverage');
  });

  it('too few appearances, or no exported leverage, is "not yet clear", never a guess', () => {
    expect(usage({ g: MIN_APPEARANCES - 1, leverage: 2.5, sv: 5 }).tier).toBe('unknown');
    expect(usage({ leverage: null }).tier).toBe('unknown');
    expect(usage({ leverage: null }).stakes).toBeNull();
  });

  it('what a role is worth differs: a long man is a low-stakes role and a closer a high-stakes one', () => {
    expect(usage({ leverage: 0.8, g: 20, ip: 44 }).stakes).toBe('low');
    expect(usage({ leverage: 2.0, sv: 8 }).stakes).toBe('high');
    expect(MULTI_INNING).toBeGreaterThan(1);
  });
});

describe('GOLDEN bullpen: the same weak line means different things in different jobs', () => {
  const ev = (pct: number): LensEvidence => ({ ratingsPct: pct, ratingsEvidence: 'complete', skillsPct: pct, runsPct: pct, sample: 400, sampleUnit: 'BF', toolsWeight: 1, reliability: 0.7, currentSample: 120, usage: [] });
  const review = (pct: number, tier: BullpenTier) => reviewGroup([{ playerId: 1, name: 'R', age: 28, ...ev(pct) } as ReviewSubject], { pitcher: true, role: 'relief pitcher', standard: () => relieverStandard(tier) })[0];

  it('a 30th-percentile arm is a concern as a closer and not as a long man', () => {
    expect(review(30, 'closer').strength).not.toBe('none');
    expect(review(30, 'long').strength).toBe('none');
  });

  it('a long man is not flagged for being a long man: a typical long man is well under the typical reliever', () => {
    expect(relieverStandard('long').typical).toBeLessThan(relieverStandard('middle').typical);
    expect(relieverStandard('closer').floor).toBeGreaterThan(relieverStandard('long').floor);
  });

  it('a rotation member and a long man are judged on different lines', () => {
    expect(starterStandard().floor).toBeGreaterThan(relieverStandard('long').floor);
  });
});

const arm = (id: number, tier: BullpenTier, estimate: number | null, ipPerAppearance: number | null = 1): PenArm => ({ playerId: id, name: `A${id}`, tier, estimate, ipPerAppearance });

describe('GOLDEN bullpen: deployment findings say what, what instead, and why', () => {
  it('a better arm in a lower role than a worse one is a finding with all three parts', () => {
    const [f] = deploymentFindings([arm(1, 'closer', 30), arm(2, 'middle', 70), arm(3, 'low_leverage', 40), arm(4, 'long', 20)]);
    expect(f).toBeDefined();
    expect(f.current).toMatch(/A1.*closer/);
    expect(f.supported).toMatch(/A2 ahead of A1/);
    expect(f.why).toMatch(/leverage/);
  });

  it('a pen already deployed in order has no finding, and an arm of unknown role is never reordered', () => {
    expect(deploymentFindings([arm(1, 'closer', 70), arm(2, 'high_leverage', 60), arm(3, 'middle', 50), arm(4, 'long', 40)])).toEqual([]);
    expect(deploymentFindings([arm(1, 'closer', 30), arm(2, 'unknown', 90)])).toEqual([]);
  });
});

describe('GOLDEN bullpen: what the pen as a whole is missing', () => {
  const base = (): PenArm[] => [arm(1, 'closer', 70), arm(2, 'high_leverage', 62), arm(3, 'middle', 55), arm(4, 'middle', 50), arm(5, 'low_leverage', 45), arm(6, 'long', 40, 2.1)];

  it('a healthy pen has no pen-wide finding', () => {
    expect(penFindings(base(), BULLPEN_PRIOR)).toEqual([]);
  });

  it('no arm anywhere above the credible line is a pen with no credible high-leverage arm, wherever he is used', () => {
    const weak = base().map((a) => ({ ...a, estimate: (a.estimate as number) - 25 }));
    const f = penFindings(weak, BULLPEN_PRIOR).find((x) => x.kind === 'no_credible_high_leverage')!;
    expect(f).toBeDefined();
    expect(f.supported).toMatch(new RegExp(`${CREDIBLE_HIGH_LEVERAGE}th percentile`));
    expect(f.why).toMatch(/leverage/);
  });

  it('nobody throwing multiple innings is a finding once enough roles are read', () => {
    const noLong = base().map((a) => (a.tier === 'long' ? { ...a, tier: 'middle' as BullpenTier, ipPerAppearance: 1.0 } : a));
    expect(penFindings(noLong, BULLPEN_PRIOR).some((f) => f.kind === 'no_multi_inning')).toBe(true);
    expect(penFindings(base(), BULLPEN_PRIOR).some((f) => f.kind === 'no_multi_inning')).toBe(false);
  });

  it('early in a season, with few roles read, it asserts nothing about the pen as a whole', () => {
    expect(penFindings([arm(1, 'unknown', 50), arm(2, 'unknown', 40), arm(3, 'closer', 20)], BULLPEN_PRIOR)).toEqual([]);
  });

  it('three long men is a crowded role', () => {
    const crowded = [...base().slice(0, 5), arm(6, 'long', 40, 2), arm(7, 'long', 38, 2), arm(8, 'long', 36, 2)];
    expect(penFindings(crowded, BULLPEN_PRIOR).some((f) => f.kind === 'crowded_role')).toBe(true);
  });
});

describe('GOLDEN bullpen: the rotation and the pen compete for arms', () => {
  const rel = (id: number, tools: number | null) => ({ playerId: id, name: `R${id}`, tier: 'middle' as BullpenTier, estimate: 50, toolsAsStarter: tools });

  it('a reliever whose starter tools clearly beat the weakest starter is a role conflict, on tools alone', () => {
    const f = starterConflicts([rel(1, 70), rel(2, 40)], { playerId: 9, name: 'S5', tools: 35 });
    expect(f.map((x) => x.players[0].playerId)).toEqual([1]);
    expect(f[0].supported).toMatch(/tools as a starter/);
    expect(f[0].why).toMatch(/his tools only/);
  });

  it('nothing is asserted when the reliever\'s starter tools or the starter\'s tools are unknown', () => {
    expect(starterConflicts([rel(1, null)], { playerId: 9, name: 'S5', tools: 35 })).toEqual([]);
    expect(starterConflicts([rel(1, 90)], { playerId: 9, name: 'S5', tools: null })).toEqual([]);
    expect(starterConflicts([rel(1, 90)], null)).toEqual([]);
  });
});
