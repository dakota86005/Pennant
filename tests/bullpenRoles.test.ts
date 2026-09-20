import { describe, expect, it } from 'vitest';
import { BULLPEN_CALIBRATION, deploymentFindings, DEPLOYMENT_GAP, LEVERAGE, MIN_APPEARANCES, roleOf, type BullpenUsage } from '../server/bullpenRoles';

const u = (over: Partial<BullpenUsage> = {}): BullpenUsage => ({ playerId: 1, name: 'Arm', g: 20, ip: 20, sv: 0, hld: 0, leverage: 1.0, ...over });

describe('a reliever\'s role, read from how he is used', () => {
  it('a save-getter in the highest leverage is the closer; a high-leverage arm without saves is not', () => {
    expect(roleOf(u({ leverage: 2.1, sv: 8 })).tier).toBe('closer');
    expect(roleOf(u({ leverage: 2.1, sv: 0, hld: 6 })).tier).toBe('high_leverage');
    expect(roleOf(u({ leverage: LEVERAGE.high })).tier).toBe('high_leverage');
    expect(roleOf(u({ leverage: 2.1, sv: 8 })).stakes).toBe('high');
  });

  it('ordinary spots are the middle; garbage time is low; a multi-inning arm below high leverage is a long man', () => {
    expect(roleOf(u({ leverage: 1.1 })).tier).toBe('middle');
    expect(roleOf(u({ leverage: 0.6 })).tier).toBe('low_leverage');
    expect(roleOf(u({ leverage: 0.6 })).stakes).toBe('low');
    expect(roleOf(u({ leverage: 1.0, ip: 40, g: 20 })).tier).toBe('long');
  });

  it('too few appearances, or no leverage in the export, is not a role: unknown stays unknown', () => {
    const early = roleOf(u({ g: MIN_APPEARANCES - 1, leverage: 2 }));
    expect(early).toMatchObject({ tier: 'unknown', stakes: null });
    expect(early.text).toMatch(/too few/);
    expect(roleOf(u({ leverage: null })).tier).toBe('unknown');
  });

  it('is stamped, and the leverage cut-offs order sensibly', () => {
    expect(BULLPEN_CALIBRATION.status).toBe('calibrated');
    expect(LEVERAGE.closer).toBeGreaterThan(LEVERAGE.high);
    expect(LEVERAGE.high).toBeGreaterThan(LEVERAGE.low);
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
