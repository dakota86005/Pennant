import { describe, expect, it } from 'vitest';
import {
  evaluateDevelopmentProtection,
  hasKnownTier,
  requireKnownProtection,
  TIER_ORDER,
} from '../server/developmentFit.js';
import { startingLines } from '../server/developmentFit.js';
const STARTING = startingLines('not_measured');
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';

/**
 * Development protection, on explicit inputs.
 *
 * Protection is deliberately independent of roster pressure: nothing here
 * takes a roster need, and nothing a roster could want changes a result.
 *
 * The baseball cases for the stakes model itself live in
 * `developmentalStakesGolden.test.ts`; this file pins the contract every consumer
 * relies on (the tier vocabulary, the null discipline, the type guards).
 */

const protect = (age: number, current: number | null, potential: number | null) =>
  evaluateDevelopmentProtection({ lines: STARTING,  age, ability: syntheticScoutedAbility({ current, potential }) });

describe('development protection', () => {
  it('protects a young high-ceiling player as a core prospect', () => {
    const p = protect(19, 40, 70);
    expect(p.tier).toBe('core_prospect');
    expect(p.reasons.join(' ')).toMatch(/Visible ceiling of an impact major leaguer/);
    expect(p.reasons.join(' ')).toMatch(/At 19 most of his development is still ahead of him/);
    expect(p.reading).toMatchObject({ ceiling: { band: 'impact' }, remaining: { state: 'most' } });
  });

  it('reads an older, finished, ordinary player as organizational depth: his development is not what is at stake', () => {
    /*
     * The absolute composite called a 30-year-old 45 / 45 "normal". Nothing about his development is
     * still in play, which is what organizational depth says; it is not a statement that he is no use.
     */
    const p = protect(30, 45, 45);
    expect(p.tier).toBe('organizational_depth');
    expect(p.reasons.join(' ')).toMatch(/his developmental years are behind him/);
  });

  it('treats a low-ceiling veteran as organizational depth, and says why', () => {
    const p = protect(28, 30, 30);
    expect(p.tier).toBe('organizational_depth');
    expect(p.reasons.join(' ')).toMatch(/No major-league projection is visible/);
  });

  it('weights ceiling far above the size of the gap', () => {
    // A 25/45 player must not outrank a nearly-developed 60/65 player just by having more to grow
    expect(TIER_ORDER.indexOf(protect(23, 60, 65).tier!)).toBeGreaterThan(TIER_ORDER.indexOf(protect(23, 25, 45).tier!));
  });

  it('lets youth raise protection at fixed ratings', () => {
    expect(TIER_ORDER.indexOf(protect(19, 50, 60).tier!)).toBeGreaterThan(TIER_ORDER.indexOf(protect(27, 50, 60).tier!));
  });

  it('reaches every tier, in order', () => {
    const tiers = [protect(28, 30, 30), protect(21, 30, 40), protect(21, 38, 47), protect(21, 40, 52), protect(19, 40, 70)]
      .map((p) => p.tier);
    expect(tiers).toEqual([...TIER_ORDER]);
  });

  it('carries no score: the tier is the output and its parts are the explanation', () => {
    const p = protect(21, 40, 52);
    expect(p).not.toHaveProperty('score');
    expect(p.reading!.ceiling).toMatchObject({ band: 'regular', potential: 52, cleared: 50, next: 56 });
    expect(p.reading!.remaining).toMatchObject({ state: 'most', byAge: 'most', boundBy: ['age'] });
  });

  it('is total protection when manually protected, whatever the ratings', () => {
    const p = evaluateDevelopmentProtection({ lines: STARTING,  age: 33, ability: syntheticScoutedAbility({ current: 25, potential: 25 }), manuallyProtected: true });
    expect(p).toMatchObject({ tier: 'core_prospect', manuallyProtected: true, reading: null });
  });
});

describe('missing rating evidence', () => {
  it('does not turn a missing current rating into a midpoint', () => {
    const p = protect(20, null, 70);
    expect(p.tier).toBeNull();
    expect(p.reading).toBeNull();
    expect(p.ratingEvidence).toBe('partial');
    expect(p.missingEvidence.map((m) => m.dimension)).toEqual(['current_ability']);
  });

  it('does not turn a missing potential rating into a midpoint', () => {
    const p = protect(20, 40, null);
    expect(p.tier).toBeNull();
    expect(p.reading).toBeNull();
    expect(p.missingEvidence.map((m) => m.dimension)).toEqual(['potential_ability']);
  });

  it('is indeterminate — neither protected nor unprotected — with both unknown', () => {
    const p = protect(30, null, null);
    expect(p.tier).toBeNull();
    expect(p.ratingEvidence).toBe('unknown');
    expect(p.missingEvidence.map((m) => m.dimension)).toEqual(['current_ability', 'potential_ability']);
    expect(p.reasons.join(' ')).toMatch(/indeterminate/);
    expect(p.reasons.join(' ')).toMatch(/no neutral value is substituted/);
  });

  it('gives an unknown player no tier at all — not the middle one, not a higher or lower one — at any age', () => {
    for (const age of [17, 19, 24, 30]) {
      expect(protect(age, null, null).tier).toBeNull();
    }
  });

  it('still reports the evidence that is known', () => {
    const p = protect(19, null, 70);
    expect(p.reasons.join(' ')).toMatch(/Visible ceiling of an impact major leaguer: a potential of 70/);
    expect(p.reasons.join(' ')).toMatch(/At 19 most of his development/);
    expect(p.reasons.join(' ')).not.toMatch(/nearly all realized/);
  });

  it('leaves known-evidence protection complete', () => {
    const p = protect(19, 40, 70);
    expect(p.ratingEvidence).toBe('complete');
    expect(p.missingEvidence).toEqual([]);
    expect(p.tier).toBe('core_prospect');
    expect(hasKnownTier(p)).toBe(true);
  });

  it('is total protection when manually protected, whatever the ratings are', () => {
    const p = evaluateDevelopmentProtection({ lines: STARTING, 
      age: 30,
      ability: syntheticScoutedAbility({ current: null, potential: null }),
      manuallyProtected: true,
    });
    expect(p).toMatchObject({ tier: 'core_prospect', manuallyProtected: true, missingEvidence: [] });
  });

  it('refuses to hand an unknown tier to code that needs one', () => {
    expect(() => requireKnownProtection(protect(30, null, null))).toThrow(/Indeterminate development protection/);
    expect(requireKnownProtection(protect(19, 40, 70)).tier).toBe('core_prospect');
  });
});
