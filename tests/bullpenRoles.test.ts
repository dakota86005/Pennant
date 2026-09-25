import { describe, expect, it } from 'vitest';
import { BULLPEN_CALIBRATION, BULLPEN_PRIOR, deploymentFindings, DEPLOYMENT_GAP, LEVERAGE, leverageLines, MIN_APPEARANCES, roleOf, type BullpenUsage } from '../server/bullpenRoles';

const u = (over: Partial<BullpenUsage> = {}): BullpenUsage => ({ playerId: 1, name: 'Arm', g: 20, ip: 20, sv: 0, hld: 0, leverage: 1.0, ...over });

describe('a reliever\'s role, read from how he is used', () => {
  it('a save-getter in the highest leverage is the closer; a high-leverage arm without saves is not', () => {
    expect(roleOf(u({ leverage: 2.1, sv: 8 }), BULLPEN_PRIOR).tier).toBe('closer');
    expect(roleOf(u({ leverage: 2.1, sv: 0, hld: 6 }), BULLPEN_PRIOR).tier).toBe('high_leverage');
    expect(roleOf(u({ leverage: LEVERAGE.high }), BULLPEN_PRIOR).tier).toBe('high_leverage');
    expect(roleOf(u({ leverage: 2.1, sv: 8 }), BULLPEN_PRIOR).stakes).toBe('high');
  });

  it('ordinary spots are the middle; garbage time is low; a multi-inning arm below high leverage is a long man', () => {
    expect(roleOf(u({ leverage: 1.1 }), BULLPEN_PRIOR).tier).toBe('middle');
    expect(roleOf(u({ leverage: 0.6 }), BULLPEN_PRIOR).tier).toBe('low_leverage');
    expect(roleOf(u({ leverage: 0.6 }), BULLPEN_PRIOR).stakes).toBe('low');
    expect(roleOf(u({ leverage: 1.0, ip: 40, g: 20 }), BULLPEN_PRIOR).tier).toBe('long');
  });

  it('too few appearances, or no leverage in the export, is not a role: unknown stays unknown', () => {
    const early = roleOf(u({ g: MIN_APPEARANCES - 1, leverage: 2 }), BULLPEN_PRIOR);
    expect(early).toMatchObject({ tier: 'unknown', stakes: null });
    expect(early.text).toMatch(/too few/);
    expect(roleOf(u({ leverage: null }), BULLPEN_PRIOR).tier).toBe('unknown');
  });

  it('is stamped, and the leverage cut-offs order sensibly', () => {
    expect(BULLPEN_CALIBRATION.status).toBe('policy');
    expect(LEVERAGE.closer).toBeGreaterThan(LEVERAGE.high);
    expect(LEVERAGE.high).toBeGreaterThan(LEVERAGE.low);
  });

  it('the leverage lines are on the league\'s own scale: a season\'s wobble moves no tier; a league off the scale is rescaled to it', () => {
    expect(leverageLines(1.0225)).toEqual({ leverage: { ...LEVERAGE }, rescaled: false });
    expect(leverageLines(null)).toEqual({ leverage: { ...LEVERAGE }, rescaled: false });
    const off = leverageLines(1.2);
    expect(off.rescaled).toBe(true);
    expect(off.leverage.high).toBeCloseTo(1.56, 6);
    // the same usage, relative to its league, is the same role
    const inOwnUnits = { ...BULLPEN_PRIOR, leverage: off.leverage };
    expect(roleOf(u({ leverage: 1.3 * 1.2 }), inOwnUnits).tier).toBe(roleOf(u({ leverage: 1.3 }), BULLPEN_PRIOR).tier);
  });

  it('a long man is judged against the line in force: the same arm is a long man in a league whose relievers work one inning, not in one whose relievers work two', () => {
    const arm = u({ leverage: 0.8, ip: 34, g: 20 }); // 1.7 innings an appearance, low leverage
    expect(roleOf(arm, BULLPEN_PRIOR).tier).toBe('long');
    expect(roleOf(arm, { ...BULLPEN_PRIOR, long: 1.9, source: 'save' }).tier).toBe('low_leverage');
  });
});

describe('deployment: is the best arm where the game is on the line?', () => {
  const arms = [
    { playerId: 1, name: 'Weak Closer', tier: 'closer' as const, estimate: 30 },
    { playerId: 2, name: 'Good Middle', tier: 'middle' as const, estimate: 62 },
    { playerId: 3, name: 'Fine Setup', tier: 'high_leverage' as const, estimate: 60 },
    { playerId: 4, name: 'Best Long', tier: 'long' as const, estimate: 75 },
    { playerId: 5, name: 'Mop Up', tier: 'low_leverage' as const, estimate: 20 },
  ];

  it('names the weak arm in high leverage and the best arm he is behind, as a usage decision', () => {
    const f = deploymentFindings(arms);
    expect(f.map((x) => x.used.name)).toContain('Weak Closer');
    const closer = f.find((x) => x.used.name === 'Weak Closer')!;
    expect(closer.better.name).toBe('Best Long');
    expect(closer.gap).toBe(45);
    expect(closer.text).toMatch(/usage decision for the manager, not a roster move/);
  });

  it('nobody is reported when the gap is small, or the better arm is already in a higher role', () => {
    expect(deploymentFindings([
      { playerId: 1, name: 'A', tier: 'closer', estimate: 60 }, { playerId: 2, name: 'B', tier: 'middle', estimate: 60 + DEPLOYMENT_GAP - 1 },
    ])).toEqual([]);
    expect(deploymentFindings([
      { playerId: 1, name: 'A', tier: 'middle', estimate: 30 }, { playerId: 2, name: 'B', tier: 'closer', estimate: 80 },
    ])).toEqual([]);
  });

  it('arms with an unknown estimate or an unread role are left out, not treated as bad', () => {
    expect(deploymentFindings([
      { playerId: 1, name: 'A', tier: 'closer', estimate: 30 }, { playerId: 2, name: 'B', tier: 'unknown', estimate: 90 }, { playerId: 3, name: 'C', tier: 'middle', estimate: null },
    ])).toEqual([]);
  });
});
