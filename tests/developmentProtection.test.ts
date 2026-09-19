import { describe, expect, it } from 'vitest';
import {
  canUseAsRegularAssignment,
  evaluateDevelopmentProtection,
  evaluatePositionAssignments,
  minimumRegularAssignmentFit,
} from '../server/developmentFit.js';
import type { Gloves, PositionRating } from '../server/gloves.js';

/**
 * Development protection and defensive-assignment fit, on explicit inputs.
 *
 * Protection is deliberately independent of roster pressure: nothing here
 * takes a roster need, and nothing a roster could want changes a result.
 */

const protect = (age: number, current: number | null, potential: number | null) =>
  evaluateDevelopmentProtection({ age, current, potential });

describe('development protection', () => {
  it('protects a young high-ceiling player as a core prospect', () => {
    const p = protect(19, 40, 70);
    expect(p.tier).toBe('core_prospect');
    expect(p.score).toBeGreaterThanOrEqual(78);
    expect(p.reasons.join(' ')).toMatch(/High-end projected ceiling/);
    expect(p.reasons.join(' ')).toMatch(/Substantial projected development remains/);
    expect(p.reasons.join(' ')).toMatch(/runway/);
  });

  it('puts an older, finished, ordinary player at normal protection', () => {
    expect(protect(30, 45, 45).tier).toBe('normal');
  });

  it('treats a low-ceiling veteran as organizational depth', () => {
    const p = protect(28, 30, 30);
    expect(p.tier).toBe('organizational_depth');
    expect(p.reasons).toEqual(['No exceptional developmental-protection signal is present.']);
  });

  it('weights ceiling far above the size of the gap', () => {
    // A 25/45 player must not outrank a nearly-developed 60/65 player just by having more to grow
    expect(protect(23, 60, 65).score).toBeGreaterThan(protect(23, 25, 45).score);
  });

  it('lets youth raise protection at fixed ratings', () => {
    expect(protect(19, 50, 60).score).toBeGreaterThan(protect(27, 50, 60).score);
  });

  it('orders the tiers by score', () => {
    const order = ['organizational_depth', 'normal', 'development_priority', 'protected_prospect', 'core_prospect'];
    const tiers = [protect(28, 30, 30), protect(30, 45, 45), protect(24, 45, 55), protect(21, 50, 65), protect(19, 40, 70)]
      .map((p) => p.tier);
    expect(tiers.map((t) => order.indexOf(t))).toEqual([...tiers.map((t) => order.indexOf(t))].sort((a, b) => a - b));
    expect(new Set(tiers).size).toBeGreaterThanOrEqual(4);
  });

  it('is total protection when manually protected, whatever the ratings', () => {
    const p = evaluateDevelopmentProtection({ age: 33, current: 25, potential: 25, manuallyProtected: true });
    expect(p).toMatchObject({ score: 100, tier: 'core_prospect', manuallyProtected: true });
  });
});

describe('missing rating evidence (current behavior)', () => {
  /*
   * Missing ratings currently enter as a neutral 50 on the 20-80 scale, with a
   * phantom mid-size upside (the gap component also defaults to 50). That is a
   * disclosed prior, not scouting evidence, and it is not neutral in effect:
   * an unknown veteran is protected MORE than a known average one. Pinned so
   * the behavior is visible and cannot change unnoticed.
   */
  it('scores unknown ratings as a 50 with a 50 upside, and gives no ceiling reason', () => {
    const unknown = protect(30, null, null);
    expect(unknown.score).toBe(Math.round(50 * 0.6 + 50 * 0.2 + 5 * 0.1 + 50 * 0.1));
    expect(unknown.reasons).toEqual(['No exceptional developmental-protection signal is present.']);
  });

  it('protects an unknown older player above a known average one', () => {
    expect(protect(30, null, null).score).toBeGreaterThan(protect(30, 50, 50).score);
  });

  it('never invents a projected gap', () => {
    expect(protect(20, 40, null).reasons.join(' ')).not.toMatch(/projected development remains/);
    expect(protect(20, null, 70).reasons.join(' ')).not.toMatch(/projected development remains/);
  });
});

const rating = (position: number, code: string, current: number, extra: Partial<PositionRating> = {}): PositionRating => ({
  position, code, current, potential: current, experience: 0, isPrimary: false, ...extra,
});
const gloves = (positions: PositionRating[]): Gloves => ({ listed: 'SS', positions, components: {} });

describe('defensive assignment fit', () => {
  it('always prefers the listed primary position', () => {
    const [fit] = evaluatePositionAssignments(gloves([rating(6, 'SS', 45, { isPrimary: true }), rating(3, '1B', 30)]));
    expect(fit).toMatchObject({ code: 'SS', fit: 100, use: 'preferred' });
  });

  it.each([
    [65, 90, 'appropriate'],
    [55, 80, 'appropriate'],
    [45, 65, 'acceptable'],
    [36, 45, 'emergency_only'],
    [30, 20, 'emergency_only'],
  ])('rates a secondary position at %i as fit %i (%s)', (current, fit, use) => {
    const [result] = evaluatePositionAssignments(gloves([rating(4, '2B', current)]));
    expect(result).toMatchObject({ fit, use });
  });

  it('lets experience confirm a position but never rescue a poor rating', () => {
    const [poor] = evaluatePositionAssignments(gloves([rating(4, '2B', 30, { experience: 400 })]));
    expect(poor.use).toBe('emergency_only');
    expect(poor.fit).toBe(25);
    const [good] = evaluatePositionAssignments(gloves([rating(4, '2B', 50, { experience: 400 })]));
    expect(good.fit).toBe(85);
    const [capped] = evaluatePositionAssignments(gloves([rating(4, '2B', 60, { experience: 400 })]));
    expect(capped.fit).toBe(90);
  });

  it('never assigns the pitcher slot as a fielding position', () => {
    expect(evaluatePositionAssignments(gloves([rating(1, 'P', 70)]))).toEqual([]);
  });

  it('has nothing to say without a fielding profile', () => {
    expect(evaluatePositionAssignments(null)).toEqual([]);
  });

  it('sorts by fit, then rating', () => {
    const fits = evaluatePositionAssignments(gloves([rating(3, '1B', 45), rating(4, '2B', 65), rating(5, '3B', 55)]));
    expect(fits.map((f) => f.code)).toEqual(['2B', '3B', '1B']);
  });
});

describe('what protection lets an operation do', () => {
  const secondary = (current: number) => evaluatePositionAssignments(gloves([rating(4, '2B', current)]))[0];

  it('raises the fit required as protection rises', () => {
    const tiers = [protect(28, 30, 30), protect(30, 45, 45), protect(24, 45, 55), protect(21, 50, 65), protect(19, 40, 70)]
      .map(minimumRegularAssignmentFit);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(minimumRegularAssignmentFit(protect(19, 40, 70))).toBe(85);
    expect(minimumRegularAssignmentFit(protect(28, 30, 30))).toBe(45);
  });

  it('refuses to move a core prospect to a merely appropriate secondary position', () => {
    expect(canUseAsRegularAssignment(protect(19, 40, 70), secondary(65))).toBe(true);
    expect(canUseAsRegularAssignment(protect(19, 40, 70), secondary(50))).toBe(false);
    expect(canUseAsRegularAssignment(protect(28, 30, 30), secondary(50))).toBe(true);
  });

  it('allows only the preferred position for a manually protected player', () => {
    const manual = evaluateDevelopmentProtection({ age: 30, current: 30, potential: 30, manuallyProtected: true });
    expect(canUseAsRegularAssignment(manual, secondary(70))).toBe(false);
    const primary = evaluatePositionAssignments(gloves([rating(6, 'SS', 45, { isPrimary: true })]))[0];
    expect(canUseAsRegularAssignment(manual, primary)).toBe(true);
  });
});
