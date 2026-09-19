import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHILOSOPHY_PROFILE,
  PHILOSOPHY_DIMENSIONS,
  mergePhilosophyProfile,
  normalizePhilosophyProfile,
  resolvePhilosophy,
} from '../server/philosophy.js';

/**
 * Philosophy is a preference profile, never player evidence. These pin the
 * profile mechanics the development engines rely on; how much philosophy may
 * move a development threshold is covered in prospectDecision.test.ts and
 * prospectAssignments.test.ts.
 */

describe('philosophy profile', () => {
  it('normalizes anything to a complete, neutral, manual profile', () => {
    for (const raw of [undefined, null, 7, 'x', [], {}]) {
      const profile = normalizePhilosophyProfile(raw);
      expect(profile.mode).toBe('manual');
      expect(Object.keys(profile.manual).sort()).toEqual(PHILOSOPHY_DIMENSIONS.map((d) => d.id).sort());
      expect(Object.values(profile.manual).every((v) => v === 50)).toBe(true);
    }
  });

  it('clamps out-of-range values and replaces junk with the neutral default', () => {
    const profile = normalizePhilosophyProfile({
      manual: { promotionAggressiveness: 250, riskTolerance: -40, rosterDepth: 'lots' },
    });
    expect(profile.manual.promotionAggressiveness).toBe(100);
    expect(profile.manual.riskTolerance).toBe(0);
    expect(profile.manual.rosterDepth).toBe(50);
  });

  it('drops unknown modes, overrides and policy values', () => {
    const profile = normalizePhilosophyProfile({
      mode: 'telepathy',
      overrides: ['rosterDepth', 'nonsense', 'rosterDepth'],
      policies: { agingContracts: 'reckless' },
    });
    expect(profile.mode).toBe('manual');
    expect(profile.overrides).toEqual(['rosterDepth']);
    expect(profile.policies.agingContracts).toBe('neutral');
  });

  it('merges a partial update without disturbing untouched dimensions', () => {
    const merged = mergePhilosophyProfile(DEFAULT_PHILOSOPHY_PROFILE, { manual: { versatility: 90 } });
    expect(merged.manual.versatility).toBe(90);
    expect(merged.manual.promotionAggressiveness).toBe(50);
    expect(mergePhilosophyProfile(DEFAULT_PHILOSOPHY_PROFILE, 'nope')).toBe(DEFAULT_PHILOSOPHY_PROFILE);
  });
});

describe('effective philosophy', () => {
  const profile = (mode: 'manual' | 'staff' | 'hybrid') =>
    normalizePhilosophyProfile({ mode, manual: { promotionAggressiveness: 80 }, overrides: ['versatility'] });

  it('uses the manual values in manual mode', () => {
    const effective = resolvePhilosophy(profile('manual'), { promotionAggressiveness: 10 });
    expect(effective.dimensions.promotionAggressiveness).toEqual({ value: 80, source: 'manual' });
  });

  it('falls back to manual, and says so, when staff values are not supplied', () => {
    // Staff-derived values are not implemented: nothing supplies them today
    for (const mode of ['staff', 'hybrid'] as const) {
      const effective = resolvePhilosophy(profile(mode));
      expect(effective.dimensions.promotionAggressiveness).toEqual({ value: 80, source: 'manual-fallback' });
    }
  });

  it('takes a supplied staff value in staff mode and honors a hybrid override', () => {
    const staff = { promotionAggressiveness: 20, versatility: 20 };
    expect(resolvePhilosophy(profile('staff'), staff).dimensions.promotionAggressiveness)
      .toEqual({ value: 20, source: 'staff' });
    const hybrid = resolvePhilosophy(profile('hybrid'), staff);
    expect(hybrid.dimensions.promotionAggressiveness).toEqual({ value: 20, source: 'staff' });
    expect(hybrid.dimensions.versatility).toEqual({ value: 50, source: 'manual' });
  });
});
