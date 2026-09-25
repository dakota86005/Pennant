import { describe, expect, it } from 'vitest';
import {
  CEILING_LINES,
  DEVELOPMENT_AGE,
  PROJECTION_REALIZED_UNDER,
  TIER_ORDER,
  evaluateDevelopmentProtection,
  tierFor,
  type CeilingBand,
  type DevelopmentRemaining,
  type DevelopmentalContext,
  type DevelopmentProtectionTier,
} from '../server/developmentFit.js';
import { startingLines } from '../server/developmentFit.js';
const STARTING = startingLines('not_measured');
import { AGE_LEVEL_DEVELOPMENT_LIMIT, OLD_FOR_LEVEL } from '../server/farmCalibration.js';
import { evaluateMlbAssignmentContext, STAKES_WEIGHT } from '../server/mlbAssignmentContext.js';
import { hasDevelopmentalStakes } from '../server/playingTime.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';

/**
 * Metamorphic relations of the stakes model (docs/DEVELOPMENTAL_STAKES.md, D-050), swept over the
 * whole grid a real player can occupy rather than asserted at a few points. Each is a statement that
 * must hold for every player; none is a number that depends on a save.
 */

const context = (relative: number | null, players = 300): DevelopmentalContext => ({
  level: 4,
  levelName: 'A',
  leagueName: 'A League',
  ageRelativeToLevel: relative,
  ageProfile: relative === null ? { scope: 'unavailable', players: 0, averageAge: null } : { scope: 'league', players, averageAge: 22 },
});

const tierOf = (age: number, current: number | null, potential: number | null, relative: number | null = 0, kind: 'hitter' | 'pitcher' = 'hitter') =>
  evaluateDevelopmentProtection({ lines: STARTING,  age, ability: syntheticScoutedAbility({ current, potential, kind }), context: context(relative) }).tier;

const rank = (tier: DevelopmentProtectionTier | null): number => (tier === null ? -1 : TIER_ORDER.indexOf(tier));

const AGES = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 34];
const RATINGS = [20, 25, 30, 35, 40, 42, 44, 45, 47, 48, 49, 50, 52, 53, 55, 56, 58, 60, 65, 70];
const RELATIVES = [6, 3, 1.5, 0, -1.4, -1.5, -2.9, -3, -6, null];
const KINDS = ['hitter', 'pitcher'] as const;

describe('monotone in the evidence', () => {
  it('a higher visible potential never lowers his stakes, all else equal', () => {
    for (const kind of KINDS) for (const age of AGES) for (const relative of RELATIVES) for (const current of RATINGS) {
      let last = -1;
      for (const potential of RATINGS.filter((p) => p >= current)) {
        const now = rank(tierOf(age, current, potential, relative, kind));
        expect(now, `${kind} ${age} ${current}/${potential} rel ${relative}`).toBeGreaterThanOrEqual(last);
        last = now;
      }
    }
  });

  it('being a year older never raises them', () => {
    for (const kind of KINDS) for (const relative of RELATIVES) for (const current of RATINGS) for (const potential of RATINGS.filter((p) => p >= current)) {
      let last = 99;
      for (const age of AGES) {
        const now = rank(tierOf(age, current, potential, relative, kind));
        expect(now, `${kind} ${age} ${current}/${potential}`).toBeLessThanOrEqual(last);
        last = now;
      }
    }
  });

  it('being further behind his level\'s schedule never raises them, and being ahead of it never raises them either', () => {
    for (const age of AGES) for (const current of RATINGS) for (const potential of RATINGS.filter((p) => p >= current)) {
      const onSchedule = rank(tierOf(age, current, potential, 0));
      /* Ahead of schedule is context and lifts nothing... */
      expect(rank(tierOf(age, current, potential, 6))).toBe(onSchedule);
      expect(rank(tierOf(age, current, potential, 1.5))).toBe(onSchedule);
      /* ...and behind it only ever lowers. */
      const behind = rank(tierOf(age, current, potential, -OLD_FOR_LEVEL));
      const farBehind = rank(tierOf(age, current, potential, -AGE_LEVEL_DEVELOPMENT_LIMIT));
      expect(behind).toBeLessThanOrEqual(onSchedule);
      expect(farBehind).toBeLessThanOrEqual(behind);
    }
  });

  it('context can only lower what the ceiling allows: nobody is ever above his ceiling with everything still ahead of him', () => {
    const bands: CeilingBand[] = ['below_major_league', 'fringe', 'regular', 'impact'];
    const remaining: DevelopmentRemaining[] = ['most', 'some', 'little', 'none'];
    for (const band of bands) {
      const best = rank(tierFor(band, 'most'));
      for (const state of remaining) expect(rank(tierFor(band, state))).toBeLessThanOrEqual(best);
    }
    /* A fringe ceiling is never protected and nothing under a major-league ceiling is ever a priority. */
    for (const age of AGES) for (const relative of RELATIVES) {
      expect(rank(tierOf(age, 20, CEILING_LINES.hitter.regular - 1, relative))).toBeLessThanOrEqual(rank('development_priority'));
      expect(rank(tierOf(age, 20, CEILING_LINES.hitter.fringe - 1, relative))).toBeLessThanOrEqual(rank('normal'));
      expect(rank(tierOf(age, 20, CEILING_LINES.hitter.impact - 1, relative))).toBeLessThanOrEqual(rank('protected_prospect'));
    }
  });

  it('realizing his projection never raises them: a finished player is not a bigger developmental concern than an unfinished one', () => {
    for (const age of AGES) for (const potential of RATINGS) {
      const unfinished = rank(tierOf(age, potential - 10, potential));
      const finished = rank(tierOf(age, potential, potential));
      expect(finished).toBeLessThanOrEqual(unfinished);
    }
  });
});

describe('unknown is never firmer than known, and never lower for being unknown', () => {
  it('removing a rating makes the tier unknown, never a lower one', () => {
    for (const age of AGES) {
      expect(tierOf(age, null, 55)).toBeNull();
      expect(tierOf(age, 40, null)).toBeNull();
      expect(tierOf(age, null, null)).toBeNull();
    }
  });

  it('removing his level context never lowers the tier', () => {
    for (const age of AGES) for (const current of RATINGS) for (const potential of RATINGS.filter((p) => p >= current)) for (const relative of RELATIVES) {
      const withContext = rank(tierOf(age, current, potential, relative));
      const without = rank(evaluateDevelopmentProtection({ lines: STARTING,  age, ability: syntheticScoutedAbility({ current, potential }) }).tier);
      expect(without).toBeGreaterThanOrEqual(withContext);
      expect(rank(tierOf(age, current, potential, null))).toBe(without);
    }
  });
});

describe('the tier belongs to the man, not to the men around him', () => {
  it('is a function of his own ratings, his age and his league\'s age profile: nothing else can be handed to it', () => {
    const a = evaluateDevelopmentProtection({ lines: STARTING,  age: 20, ability: syntheticScoutedAbility({ current: 38, potential: 52, playerId: 1 }), context: context(1) });
    const b = evaluateDevelopmentProtection({ lines: STARTING,  age: 20, ability: syntheticScoutedAbility({ current: 38, potential: 52, playerId: 2 }), context: context(1) });
    expect(a).toEqual(b);
  });

  it('does not move when the size or the strength of his league does, only when its AGE does', () => {
    const thinner = evaluateDevelopmentProtection({ lines: STARTING,  age: 21, ability: syntheticScoutedAbility({ current: 30, potential: 47 }), context: context(-1, 26) });
    const thicker = evaluateDevelopmentProtection({ lines: STARTING,  age: 21, ability: syntheticScoutedAbility({ current: 30, potential: 47 }), context: context(-1, 1800) });
    expect(thinner.tier).toBe(thicker.tier);
    expect(thinner.reading!.ceiling).toEqual(thicker.reading!.ceiling);
  });

  it('a one-level move for a man who is not behind either schedule changes nothing', () => {
    /* Rostered averages a level apart are about a year apart; a man on schedule at both keeps his tier. */
    for (const age of [18, 19, 20, 21, 22]) for (const potential of RATINGS) {
      expect(tierOf(age, 30, Math.max(30, potential), 1)).toBe(tierOf(age, 30, Math.max(30, potential), 0));
      expect(tierOf(age, 30, Math.max(30, potential), -1)).toBe(tierOf(age, 30, Math.max(30, potential), 0));
    }
  });
});

describe('the same tier means the same thing to everyone who reads it', () => {
  it('orders the consumers\' semantics the way the tiers are ordered', () => {
    /* More at stake, less major-league relief... */
    const weights = TIER_ORDER.map((t) => STAKES_WEIGHT[t]);
    expect(weights).toEqual([...weights].sort((x, y) => x - y));
    expect(STAKES_WEIGHT.core_prospect).toBe(1);
    expect(STAKES_WEIGHT.organizational_depth).toBe(0);
    /* ...and missing reps cost development from development priority up, and only there. */
    expect(TIER_ORDER.map(hasDevelopmentalStakes)).toEqual([false, false, true, true, true]);
    expect(hasDevelopmentalStakes(null)).toBe(false);
  });

  it('gives MLB Operations the tier the farm reads, for every player and every contemplated role', () => {
    for (const age of [19, 22, 24, 26, 29]) for (const potential of [44, 47, 50, 53, 57]) {
      const ability = syntheticScoutedAbility({ current: potential - 6, potential, kind: 'pitcher' });
      const own = evaluateDevelopmentProtection({ lines: STARTING,  age, ability, context: context(0) }).tier;
      for (const role of ['temporary_depth', 'short_bullpen', 'spot_start'] as const) {
        const a = evaluateMlbAssignmentContext({ context: role, kind: 'pitcher', protection: evaluateDevelopmentProtection({ lines: STARTING,  age, ability, context: context(0) }), experience: null, currentLevel: null });
        expect(a.stakes.tier).toBe(own);
      }
    }
  });
});

describe('the lines', () => {
  it('sit where they are declared: a hair either side of each ceiling line, age band and the projection line', () => {
    for (const kind of KINDS) {
      const lines = CEILING_LINES[kind];
      const band = (potential: number) =>
        evaluateDevelopmentProtection({ lines: STARTING,  age: 20, ability: syntheticScoutedAbility({ current: 20, potential, kind }) }).reading!.ceiling.band;
      expect([band(lines.fringe - 1), band(lines.fringe)]).toEqual(['below_major_league', 'fringe']);
      expect([band(lines.regular - 1), band(lines.regular)]).toEqual(['fringe', 'regular']);
      expect([band(lines.impact - 1), band(lines.impact)]).toEqual(['regular', 'impact']);
    }
    const byAge = (age: number) => evaluateDevelopmentProtection({ lines: STARTING,  age, ability: syntheticScoutedAbility({ current: 30, potential: 52 }) }).reading!.remaining.byAge;
    expect([byAge(DEVELOPMENT_AGE.most), byAge(DEVELOPMENT_AGE.most + 1)]).toEqual(['most', 'some']);
    expect([byAge(DEVELOPMENT_AGE.some), byAge(DEVELOPMENT_AGE.some + 1)]).toEqual(['some', 'little']);
    expect([byAge(DEVELOPMENT_AGE.little), byAge(DEVELOPMENT_AGE.little + 1)]).toEqual(['little', 'none']);

    const realized = (gap: number) => evaluateDevelopmentProtection({ lines: STARTING,  age: 20, ability: syntheticScoutedAbility({ current: 52 - gap, potential: 52 }) }).reading!.remaining.projection.realized;
    expect([realized(PROJECTION_REALIZED_UNDER - 1), realized(PROJECTION_REALIZED_UNDER)]).toEqual([true, false]);

    const schedule = (relative: number) => evaluateDevelopmentProtection({ lines: STARTING,  age: 20, ability: syntheticScoutedAbility({ current: 30, potential: 52 }), context: context(relative) }).reading!.remaining.schedule;
    expect([schedule(-(OLD_FOR_LEVEL - 0.1)), schedule(-OLD_FOR_LEVEL)]).toEqual(['on_schedule', 'behind']);
    expect([schedule(-(AGE_LEVEL_DEVELOPMENT_LIMIT - 0.1)), schedule(-AGE_LEVEL_DEVELOPMENT_LIMIT)]).toEqual(['behind', 'far_behind']);
  });

  it('are ordered the way the words are', () => {
    for (const kind of KINDS) {
      const { fringe, regular, impact } = CEILING_LINES[kind];
      expect(fringe).toBeLessThan(regular);
      expect(regular).toBeLessThan(impact);
    }
    expect(DEVELOPMENT_AGE.most).toBeLessThan(DEVELOPMENT_AGE.some);
    expect(DEVELOPMENT_AGE.some).toBeLessThan(DEVELOPMENT_AGE.little);
  });

  it('the whole table: the ceiling, lowered one tier for each step by which his development has run out', () => {
    const table: Record<CeilingBand, DevelopmentProtectionTier[]> = {
      impact: ['core_prospect', 'protected_prospect', 'development_priority', 'normal'],
      regular: ['protected_prospect', 'development_priority', 'normal', 'organizational_depth'],
      fringe: ['development_priority', 'normal', 'organizational_depth', 'organizational_depth'],
      below_major_league: ['normal', 'organizational_depth', 'organizational_depth', 'organizational_depth'],
    };
    const states: DevelopmentRemaining[] = ['most', 'some', 'little', 'none'];
    for (const band of Object.keys(table) as CeilingBand[]) {
      expect(states.map((s) => tierFor(band, s))).toEqual(table[band]);
    }
  });
});
