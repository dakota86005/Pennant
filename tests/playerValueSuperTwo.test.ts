import { describe, expect, it } from 'vitest';
import {
  THIS_SEASON, YEAR, classOf, contractRow, factsOf, mlbRules, seasonOf, stateOf, timelineOf, type ClassMemberSpec,
} from './playerValueFixtures.js';

/*
 * Super Two (docs/BEHAVIOR_CASES.md "Player Value", playerValueSuperTwo.test.ts). The owner ruled on
 * 2026-09-22 that OOTP applies Super Two under MLB rules, which is a stated basis (D-018, D-023), not
 * a guess from MLB rules. The rule (CBA Art. VI(E)(1)(b)): a player with two to three years of service
 * who banked at least 86 days in the season just ending is arbitration-eligible when he ranks in the
 * top 22% by service of that class. Built from a synthetic class; no case names a player.
 */

const NEXT = THIS_SEASON + 1;
const expiring = factsOf(contractRow({ years: 1 }));
/** Fifty held players from two years to two years 147 days, each with 100 days this season. */
const CLASS = classOf(50, 2 * YEAR, 3);
const him = (days: number, thisYear: number | null = 100): ClassMemberSpec => ({ days, thisYear, onRoster: true });

/** His next season, with the season over (nothing left to bank): the cutoff is then a point. */
function nextSeason(days: number, thisYear: number | null, members: ClassMemberSpec[], opts: { clock?: number; rules?: ReturnType<typeof mlbRules> } = {}) {
  const t = timelineOf({
    state: stateOf({ days, thisYear }),
    contract: expiring,
    clock: opts.clock ?? YEAR,
    rules: opts.rules,
    superTwoClass: members,
  });
  return { season: seasonOf(t, NEXT), rights: t.eligibility!.seasons.find((s) => s.season === NEXT)! };
}

describe('Super Two (owner ruling, 2026-09-22)', () => {
  it('above the cutoff, with 86 days this season, he is arbitration-eligible, and the reason names the rule and the owner', () => {
    const days = 2 * YEAR + 140;
    const { season, rights } = nextSeason(days, 100, [...CLASS, him(days)]);
    expect(season.status).toBe('arbitration');
    expect(rights.arbitration.status).toBe('eligible');
    const reason = rights.arbitration.reasons.find((r) => r.basis === 'owner_attested');
    expect(reason, 'no owner-attested reason').toBeDefined();
    expect(reason!.message).toMatch(/Super Two/);
    expect(reason!.message).toMatch(/cutoff/);
    expect(reason!.message).toMatch(/22%/);
    expect(reason!.message).toMatch(/owner, 2026-09-22/);
  });

  it('below the cutoff he is pre-arbitration', () => {
    const days = 2 * YEAR + 50;
    const { season, rights } = nextSeason(days, 100, [...CLASS, him(days)]);
    expect(season.status).toBe('pre_arbitration');
    expect(rights.arbitration.status).toBe('ineligible');
    expect(rights.arbitration.reasons.map((r) => r.message).join(' ')).toMatch(/below the Super Two cutoff/);
  });

  it('a projected service overlapping the cutoff range is indeterminate, naming both edges', () => {
    // 72 days of the season left, and half the class in the minors: every member's service, and so
    // the cutoff, is a range (the roster banking the rest, up to everyone banking it)
    const days = 2 * YEAR + 100;
    const split = CLASS.map((m, i) => ({ ...m, onRoster: i % 2 === 0 }));
    const { season, rights } = nextSeason(days, 100, [...split, him(days)], { clock: 100 });
    expect(season.status).toBe('indeterminate');
    expect(season.between).toEqual(['pre_arbitration', 'arbitration']);
    const said = rights.arbitration.missing.map((m) => m.message).join(' ');
    expect(said).toMatch(/Super Two cutoff .*2 years \d+ days to 2 years \d+ days/);
    expect(said).toMatch(/his service .*2 years 100 days to 3 years 0 days/);
  });

  it("keeps the window indeterminate in a league whose contract regime is not MLB's", () => {
    const days = 2 * YEAR + 140;
    const { season, rights } = nextSeason(days, 100, [...CLASS, him(days)], { rules: mlbRules({ rules_fa_minimum_years: 7 }) });
    expect(season.status).toBe('indeterminate');
    expect(rights.arbitration.status).toBe('indeterminate');
    expect(rights.arbitration.missing.map((m) => m.message).join(' ')).toMatch(/not MLB's/);
  });

  it('short of 86 days in the season just ending he is pre-arbitration, whatever his rank', () => {
    const days = 2 * YEAR + 140;
    const { season, rights } = nextSeason(days, 50, [...CLASS, him(days, 50)]);
    expect(season.status).toBe('pre_arbitration');
    expect(rights.arbitration.reasons.map((r) => r.message).join(' ')).toMatch(/86 days/);
  });

  it('a missing input leaves the window indeterminate, never eligible and never ineligible', () => {
    const days = 2 * YEAR + 140;
    // A class member whose service is not exported: the rank cannot be stated
    const gap = nextSeason(days, 100, [...CLASS, him(days), { days: null, thisYear: 100 }]);
    expect(gap.season.status).toBe('indeterminate');
    expect(gap.rights.arbitration.missing.map((m) => m.message).join(' ')).toMatch(/not exported/);
    // His own days this season not exported: above the cutoff, the 86-day condition is unknown
    const own = nextSeason(days, null, [...CLASS, him(days, 100)]);
    expect(own.season.status).toBe('indeterminate');
    expect(own.rights.arbitration.missing.map((m) => m.message).join(' ')).toMatch(/86 days/);
    // No class at all: the cutoff is not computed
    const none = timelineOf({ state: stateOf({ days, thisYear: 100 }), contract: expiring, clock: YEAR });
    expect(seasonOf(none, NEXT).status).toBe('indeterminate');
  });
});
