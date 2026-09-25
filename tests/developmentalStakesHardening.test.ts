import { describe, expect, it } from 'vitest';
import {
  CEILING_LINES,
  DEVELOPMENT_AGE,
  TIER_ORDER,
  evaluateDevelopmentProtection,
  levelScheduleOf,
  type DevelopmentalContext,
  type DevelopmentProtection,
  type DevelopmentProtectionTier,
} from '../server/developmentFit.js';
import { startingLines } from '../server/developmentFit.js';
const STARTING = startingLines('not_measured');
import { AGE_LEVEL_DEVELOPMENT_LIMIT, OLD_FOR_LEVEL, PROTECTED_TIERS } from '../server/farmCalibration.js';
import { evaluateMlbAssignmentContext, LOW_STAKES_WEIGHT } from '../server/mlbAssignmentContext.js';
import { hasDevelopmentalStakes, positionConflict, readOpportunity } from '../server/playingTime.js';
import { reviewAssignment } from '../server/farmAssignments.js';
import { reviewRetention, type RetentionInput } from '../server/farmRetention.js';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { currentInput, production, tierOf as protectionOf, usage } from './farmGolden.js';

/**
 * The hardening pass on the stakes model (docs/DEVELOPMENTAL_STAKES.md Part 9): every boundary the
 * model has, attacked from both sides over the whole grid, and unknown evidence followed into every
 * consumer. Nothing here is a number that depends on a save.
 */

const rank = (tier: DevelopmentProtectionTier | null): number => (tier === null ? -1 : TIER_ORDER.indexOf(tier));
const KINDS = ['hitter', 'pitcher'] as const;

/** A league whose rostered average age is `averageAge`, computed the way the reader computes it. */
const league = (averageAge: number | null, age: number, players = 300): DevelopmentalContext => ({
  level: 4,
  levelName: 'A',
  leagueName: 'A League',
  ageRelativeToLevel: averageAge === null ? null : averageAge - age,
  ageProfile: averageAge === null ? { scope: 'unavailable', players: 0, averageAge: null } : { scope: 'league', players, averageAge },
});

const stakes = (age: number | null, current: number | null, potential: number | null, averageAge: number | null = null, kind: 'hitter' | 'pitcher' = 'hitter') =>
  evaluateDevelopmentProtection({ lines: STARTING,  age, ability: syntheticScoutedAbility({ current, potential, kind }), context: averageAge === null && age !== null ? null : league(averageAge, age ?? 0) });

/* The composites are integers (the adapter rounds), so every potential a real man can have is here. */
const POTENTIALS = Array.from({ length: 61 }, (_, i) => 20 + i);
const GAPS = [0, 1, 2, 3, 5, 8, 12, 20];
/* Rostered averages in tenths from a Dominican league's to a Triple-A club's. */
const AVERAGES = Array.from({ length: 121 }, (_, i) => Math.round((17 + i / 10) * 10) / 10);

describe('age boundaries: one birthday, at most one step, and never up', () => {
  it('holds for every potential, every gap, every kind and every league age, from 16 to 35', () => {
    let twoStepDrops = 0;
    for (const kind of KINDS) for (const potential of POTENTIALS.filter((p) => p % 2 === 0)) for (const gap of GAPS) for (const averageAge of [null, ...AVERAGES.filter((a) => (a * 10) % 5 === 0)]) {
      let last: number | null = null;
      for (let age = 16; age <= 35; age++) {
        const now = rank(stakes(age, potential - gap, potential, averageAge, kind).tier);
        if (last !== null) {
          expect(now, `${kind} ${potential - gap}/${potential} avg ${averageAge}: ${age - 1} -> ${age}`).toBeLessThanOrEqual(last);
          expect(last - now, `${kind} ${potential - gap}/${potential} avg ${averageAge}: ${age - 1} -> ${age}`).toBeLessThanOrEqual(1);
          if (last - now >= 2) twoStepDrops++;
        }
        last = now;
      }
    }
    expect(twoStepDrops).toBe(0);
  });

  it('the band edges are exactly the declared ages, on both sides, for a man on schedule', () => {
    const remaining = (age: number) => stakes(age, 40, 52, age).reading!.remaining.byAge;
    expect(remaining(DEVELOPMENT_AGE.most)).toBe('most');
    expect(remaining(DEVELOPMENT_AGE.most + 1)).toBe('some');
    expect(remaining(DEVELOPMENT_AGE.some)).toBe('some');
    expect(remaining(DEVELOPMENT_AGE.some + 1)).toBe('little');
    expect(remaining(DEVELOPMENT_AGE.little)).toBe('little');
    expect(remaining(DEVELOPMENT_AGE.little + 1)).toBe('none');
    for (const age of [28, 30, 35, 40]) expect(remaining(age)).toBe('none');
  });

  it('a birthday that also crosses a schedule line still costs one step, because both readings move together', () => {
    /* A complex league at 20.7: 22 is on schedule, 23 is behind (2.3), 24 is far behind (3.3). */
    for (const potential of [46, 50, 56]) {
      const t = [22, 23, 24, 25].map((age) => rank(stakes(age, potential - 8, potential, 20.7).tier));
      for (let i = 1; i < t.length; i++) expect(t[i - 1] - t[i]).toBeLessThanOrEqual(1);
    }
  });

  it('a young man with weak tools and a young man with strong tools are told apart by the ceiling, never by the age', () => {
    for (const age of [17, 18, 19, 20]) {
      /* Each in a league his own age, so only the ceiling differs between them. */
      const weak = stakes(age, 25, 40, age);
      const strong = stakes(age, 30, 56, age);
      expect(weak.tier).toBe('normal');
      expect(strong.tier).toBe('core_prospect');
      const { projection: _w, ...weakRemaining } = weak.reading!.remaining;
      const { projection: _s, ...strongRemaining } = strong.reading!.remaining;
      expect(weakRemaining).toEqual(strongRemaining);
    }
    /* And the schedule, when it bites, bites both the same: a 20-year-old 1.7 years behind a Dominican league loses one step whatever his ceiling. */
    expect(stakes(20, 25, 40, 18.3).tier).toBe('organizational_depth');
    expect(stakes(20, 30, 56, 18.3).tier).toBe('protected_prospect');
  });

  it('an older late developer keeps a tier as long as his ceiling is still visible and not yet realized', () => {
    /* 26, still projecting to a regular with the gap open: little development left, but a regular's ceiling. */
    expect(stakes(26, 44, 51, 26.0).tier).toBe('normal');
    expect(stakes(26, 46, 56, 26.0).tier).toBe('development_priority');
    /* At 27 nothing of it is ahead of him whatever the gap; that is the age band, said as such. */
    const done = stakes(27, 44, 56, 26.0);
    expect(done.tier).toBe('normal');
    expect(done.reasons.join(' ')).toMatch(/his developmental years are behind him/);
  });
});

describe('ceiling boundaries: one grade either side of each line', () => {
  it('a potential one point under a line, on it and one over it move at most one tier, for each kind', () => {
    for (const kind of KINDS) for (const line of Object.values(CEILING_LINES[kind])) for (const age of [18, 21, 23, 25, 27]) for (const gap of GAPS) {
      const under = rank(stakes(age, line - 1 - gap, line - 1, null, kind).tier);
      const on = rank(stakes(age, line - gap, line, null, kind).tier);
      const over = rank(stakes(age, line + 1 - gap, line + 1, null, kind).tier);
      expect(on - under, `${kind} ${line} at ${age}`).toBeGreaterThanOrEqual(0);
      expect(on - under, `${kind} ${line} at ${age}`).toBeLessThanOrEqual(1);
      expect(over, `${kind} ${line} at ${age}`).toBe(on);
    }
  });

  it('raising potential one point at a time never moves the tier by more than one step, over the whole 20-80 scale', () => {
    for (const kind of KINDS) for (const age of [17, 20, 22, 23, 24, 25, 26, 27, 30]) for (const averageAge of [null, 18.3, 20.7, 22.8, 26.0]) {
      let last = -1;
      for (const potential of POTENTIALS) {
        const now = rank(stakes(age, 20, potential, averageAge, kind).tier);
        expect(now - last, `${kind} ${age} pot ${potential}`).toBeLessThanOrEqual(potential === 20 ? 99 : 1);
        expect(now).toBeGreaterThanOrEqual(last);
        last = now;
      }
    }
  });

  it('the pitcher lines are lower than the hitter lines, so a pitcher at the hitters\' median is already a regular', () => {
    expect(CEILING_LINES.pitcher.regular).toBeLessThan(CEILING_LINES.hitter.regular);
    expect(CEILING_LINES.pitcher.impact).toBeLessThan(CEILING_LINES.hitter.impact);
    expect(stakes(20, 40, 50, null, 'pitcher').reading!.ceiling.band).toBe('regular');
    expect(stakes(20, 40, 50, null, 'hitter').reading!.ceiling.band).toBe('regular');
    expect(stakes(20, 40, 48, null, 'pitcher').reading!.ceiling.band).toBe('regular');
    expect(stakes(20, 40, 48, null, 'hitter').reading!.ceiling.band).toBe('fringe');
  });

  it('a large gap and no gap at the same potential differ by at most the one projection step, and the gap never raises the ceiling', () => {
    for (const kind of KINDS) for (const potential of POTENTIALS) for (const age of [19, 23, 25]) {
      const open = stakes(age, potential - 15, potential, null, kind);
      const closed = stakes(age, potential, potential, null, kind);
      expect(open.reading!.ceiling).toEqual(closed.reading!.ceiling);
      expect(rank(open.tier) - rank(closed.tier)).toBeGreaterThanOrEqual(0);
      expect(rank(open.tier) - rank(closed.tier)).toBeLessThanOrEqual(1);
    }
  });

  it('a missing current or potential leaves the tier unknown at every point of the scale, and says what is missing', () => {
    for (const kind of KINDS) for (const potential of [44, 45, 46, 49, 50, 51, 55, 56, 57]) {
      const noCurrent = stakes(21, null, potential, null, kind);
      const noPotential = stakes(21, potential, null, null, kind);
      expect(noCurrent.tier).toBeNull();
      expect(noPotential.tier).toBeNull();
      expect(noCurrent.reading).toBeNull();
      expect(noCurrent.reasons.join(' ')).toMatch(/indeterminate/);
      /* The ceiling IS known when the potential is, and is still said. */
      expect(noCurrent.reasons.join(' ')).toMatch(/ceiling|projection/);
      expect(noPotential.reasons.join(' ')).not.toMatch(/Visible ceiling/);
    }
  });
});

describe('the schedule line: exact values, floating point and a moving league', () => {
  /** A rostered average that is exactly `age - behind`, computed as a sum over a count as the reader does it. */
  const averageBehind = (age: number, behind: number, players = 40): number => {
    const sum = (age - behind) * players;
    return sum / players;
  };

  it('reads exactly 1.49 as on schedule, 1.50 as behind, 2.99 as behind and 3.00 as far behind', () => {
    const at = (behind: number) => levelScheduleOf(league(averageBehind(22, behind, 100), 22));
    expect(at(1.49)).toBe('on_schedule');
    expect(at(1.5)).toBe('behind');
    expect(at(2.99)).toBe('behind');
    expect(at(3.0)).toBe('far_behind');
    expect(OLD_FOR_LEVEL).toBe(1.5);
    expect(AGE_LEVEL_DEVELOPMENT_LIMIT).toBe(3);
  });

  it('an average that lands on a line through floating-point arithmetic still lands on it', () => {
    /* 41 players summing to 840.5 is 20.5 exactly; 3 players averaging 20.5 is 61.5 / 3, which is not representable the same way. */
    for (const players of [3, 7, 11, 13, 40, 41, 97, 300]) {
      const avg = (20.5 * players) / players;
      expect(levelScheduleOf(league(avg, 22, players))).toBe('behind');
      const avg3 = (19 * players) / players;
      expect(levelScheduleOf(league(avg3, 22, players))).toBe('far_behind');
    }
  });

  it('is never read from an age the reader has not got: a NaN or infinite relative age discounts nothing', () => {
    for (const relative of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(levelScheduleOf({ ...league(22, 22), ageRelativeToLevel: relative })).toBe('not_established');
    }
  });

  it('one unrelated player moving a league\'s average across a line moves nobody more than one step', () => {
    for (const kind of KINDS) for (const age of [19, 20, 21, 22, 23, 24, 25, 26, 27]) for (const potential of [44, 46, 50, 52, 56]) {
      let last: number | null = null;
      /* The league ages by a hundredth at a time: what a transaction does to a rostered average. */
      for (let hundredths = 1700; hundredths <= 2900; hundredths += 1) {
        const now = rank(stakes(age, potential - 6, potential, hundredths / 100, kind).tier);
        if (last !== null) expect(Math.abs(now - last), `${kind} ${age} ${potential} avg ${hundredths / 100}`).toBeLessThanOrEqual(1);
        last = now;
      }
    }
  });

  it('the schedule takes at most two steps off what his age says, and takes them only from a man whose age still has them', () => {
    for (const kind of KINDS) for (const age of [17, 19, 21, 22, 23, 24, 25, 26, 27, 30]) for (const potential of [45, 50, 56]) {
      const free = stakes(age, potential - 6, potential, null, kind);
      const farBehind = stakes(age, potential - 6, potential, age - 6, kind);
      expect(rank(free.tier) - rank(farBehind.tier)).toBeGreaterThanOrEqual(0);
      expect(rank(free.tier) - rank(farBehind.tier)).toBeLessThanOrEqual(2);
      /* A man whose age already says `little` or `none` cannot be shortened further by his level. */
      if (age > DEVELOPMENT_AGE.some) expect(farBehind.tier).toBe(free.tier);
    }
  });

  it('a level pool stands in for a thin league and is named as such; an unavailable one is named and discounts nothing', () => {
    const pooled: DevelopmentalContext = { ...league(19, 22), ageProfile: { scope: 'level', players: 400, averageAge: 19 } };
    const p = evaluateDevelopmentProtection({ lines: STARTING,  age: 22, ability: syntheticScoutedAbility({ current: 40, potential: 50 }), context: pooled });
    expect(p.reading!.remaining.schedule).toBe('far_behind');
    expect(p.reasons.join(' ')).toMatch(/its own league is too thin to describe itself/);
    const none = evaluateDevelopmentProtection({ lines: STARTING,  age: 22, ability: syntheticScoutedAbility({ current: 40, potential: 50 }), context: league(null, 22) });
    expect(none.tier).toBe(stakes(22, 40, 50).tier);
    expect(none.reasons.join(' ')).toMatch(/could not be established, so whether he is behind his level's schedule was not read and nothing was discounted/);
  });
});

describe('unknown stays unknown, in every consumer', () => {
  const unknown: DevelopmentProtection = protectionOf(null);
  const depth: DevelopmentProtection = protectionOf('organizational_depth');

  it('the evaluator: a missing age, current or potential is unknown; a missing league is not', () => {
    expect(stakes(null, 40, 50).tier).toBeNull();
    expect(stakes(22, null, 50).tier).toBeNull();
    expect(stakes(22, 40, null).tier).toBeNull();
    expect(stakes(22, 40, 50, null).tier).toBe(stakes(22, 40, 50, 22).tier);
    expect(evaluateDevelopmentProtection({ lines: STARTING,  age: 22, ability: syntheticScoutedAbility({ current: 40, potential: 50 }), context: undefined }).tier).toBe('protected_prospect');
  });

  it('playing time: an unknown tier is never squeezed and never "no stakes"', () => {
    expect(hasDevelopmentalStakes(null)).toBe(false);
    const c = positionConflict(10, 'SS', [usage({ playerId: 1, name: 'Regular', inningsByPosition: { SS: 800 }, tier: 'normal' }), usage({ playerId: 2, name: 'Unknown', inningsByPosition: { SS: 5 }, games: 3, tier: null }), usage({ playerId: 3, name: 'Third', inningsByPosition: { SS: 60 }, games: 8, tier: 'normal' })], 900)!;
    expect(c.squeezed.map((s) => s.name)).toEqual([]);
    expect(c.unknowns.join(' ')).toMatch(/indeterminate/);
    const review = reviewAssignment({
      playerId: 2, name: 'Unknown', age: 22, kind: 'hitter', teamId: 10, team: 'A Club', level: 3, levelName: 'AA', leagueName: 'A League',
      protection: unknown, production: production(), current: evaluateCurrentAssignment(currentInput({ tier: null })),
      opportunity: readOpportunity(2, [c]), alternatives: [], blockedBy: [],
    });
    expect(review.conclusion).not.toBe('opportunity_conflict');
    expect(review.reasons.join(' ')).toMatch(/developmental stakes are indeterminate|not enough|cannot/i);
    expect(review.reasons.join(' ')).not.toMatch(/organizational depth|what the role he is in at this level is/);
  });

  it('MLB Operations: an unknown tier gets no relief and no established route, and a depth player gets both', () => {
    const at = (protection: DevelopmentProtection) =>
      evaluateMlbAssignmentContext({
        context: 'short_bullpen', kind: 'pitcher', protection, experience: { plateAppearances: 0, inningsPitched: 400 },
        currentLevel: { readiness: 72, readinessRange: { min: 72, max: 72 }, sampleConfidence: 60, promotionThreshold: 80 },
      });
    const u = at(unknown);
    expect(u.stakes.weight).toBeNull();
    expect(u.readiness.relief).toBeNull();
    expect(u.readiness.required).toBeNull();
    expect(u.routes).toEqual({ production: 'unknown', established: 'unknown' });
    expect(u.judgment).toBe('indeterminate');
    expect(u.eligible).toBe(false);
    const d = at(depth);
    expect(d.stakes.weight).toBe(0);
    expect(d.stakes.weight as number).toBeLessThanOrEqual(LOW_STAKES_WEIGHT);
    expect(d.judgment).toBe('defensible');
  });

  it('retention: an unknown tier is indeterminate, never exhausted and never routine; a depth tier is not a release', () => {
    const input = (protection: DevelopmentProtection): RetentionInput => ({
      playerId: 1, name: 'A Player', age: 26, teamId: 10, team: 'A Club', level: 2, levelName: 'AAA',
      protection, current: evaluateCurrentAssignment(currentInput({ tier: protection.tier })),
      assignmentConclusion: 'current_assignment_defensible', proServiceYears: 6,
      state: { onFortyMan: false, majorLeagueContract: false, mustBeActive: false, onInjuredList: false },
      waiting: [], clubCrowded: false, philosophy: { prospectPreservation: 0, rosterDepth: 0 }, facts: [],
    });
    const u = reviewRetention(input(unknown));
    expect(u.conclusion).toBe('indeterminate');
    expect(u.outlook.state).not.toBe('exhausted');
    expect(u.guardrails.map((g) => g.code)).not.toContain('protected_prospect');
    const d = reviewRetention(input(depth));
    expect(d.conclusion).not.toMatch(/release/);
    expect(d.reasons.join(' ')).not.toMatch(/release/i);
    for (const tier of PROTECTED_TIERS) {
      expect(reviewRetention(input(protectionOf(tier))).guardrails.map((g) => g.code)).toContain('protected_prospect');
    }
  });
});
