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

/*
 * Hardening (F2, 2026-09-23): trips counted by winter (A-12, C-15), the owner's margin around the
 * cutoff's readings (A-13) and a schedule shorter than the service year (D-03).
 */
describe('Super Two, hardening (F2)', () => {
  it('counts arbitration trips by winter: after a Super Two year the next is his second trip', () => {
    // 141 days this season: a year and 171 days at the last winter, so plainly pre-arbitration then
    const days = 2 * YEAR + 140;
    const t = timelineOf({ state: stateOf({ days, thisYear: 141 }), contract: expiring, clock: YEAR, superTwoClass: [...CLASS, him(days, 141)] });
    expect(seasonOf(t, NEXT).status).toBe('arbitration');
    expect(seasonOf(t, NEXT).superTwo).toBe(true);
    expect(seasonOf(t, NEXT).arbitrationYear).toEqual({ low: 1, high: 1 });
    expect(seasonOf(t, NEXT + 1).arbitrationYear).toEqual({ low: 2, high: 2 });
    expect(seasonOf(t, NEXT + 2).arbitrationYear).toEqual({ low: 3, high: 3 });
    expect(seasonOf(t, NEXT + 3).arbitrationYear).toEqual({ low: 4, high: 4 });
    expect(seasonOf(t, NEXT + 4).status).toBe('free_agent');
  });

  it('never numbers an arbitration year he has already taken, and says an earlier Super Two year is not in the export', () => {
    // Three years six days at the last winter: in arbitration now; 40 days banked, 132 left
    const t = timelineOf({ state: stateOf({ days: 3 * YEAR + 46, thisYear: 40 }), contract: expiring, clock: 40 });
    const now = t.eligibility!.seasons[0];
    expect(now.arbitration.status).toBe('eligible');
    // At least his first trip; his second if he was a Super Two a year early, which the export cannot show
    expect(now.arbitration.trip).toEqual({ low: 1, high: 2 });
    expect(now.arbitration.tripNote).toMatch(/Super Two/);
    // Next winter is one more trip on every edge, whatever he banks: never his first again
    const next = seasonOf(t, NEXT);
    expect(next.status).toBe('arbitration');
    expect(next.arbitrationYear).toEqual({ low: 2, high: 3 });
  });

  it("treats the cutoff's edges as readings: within the margin of either edge the year is indeterminate, a tie included", async () => {
    const { SUPER_TWO_MARGIN_DAYS, SUPER_TWO_MARGIN_CALIBRATION } = await import('../server/playerRights.js');
    expect(SUPER_TWO_MARGIN_CALIBRATION.status).toBe('policy');
    expect(SUPER_TWO_MARGIN_CALIBRATION.basis).toMatch(/owner.*2026-09-23/);
    // Season over: this class's cutoff is a point, 461 days (the 11th of 50, from 344 in steps of 3)
    const cutoff = 461;
    for (const days of [cutoff - 5, cutoff, cutoff + 5]) {
      const { season } = nextSeason(days, 100, CLASS);
      expect(season.status, `${days}`).toBe('indeterminate');
      expect(season.between).toEqual(['pre_arbitration', 'arbitration']);
    }
    expect(nextSeason(cutoff - SUPER_TWO_MARGIN_DAYS - 1, 100, CLASS).season.status).toBe('pre_arbitration');
    expect(nextSeason(cutoff + SUPER_TWO_MARGIN_DAYS, 100, CLASS).season.status).toBe('arbitration');
  });

  it('keeps the window indeterminate where the schedule banks less than a full service year', () => {
    const days = 2 * YEAR + 140;
    const t = timelineOf({
      state: stateOf({ days, thisYear: 69 }), contract: expiring, clock: 69,
      calendar: { scheduleDays: 69, daysLeft: 0 }, superTwoClass: [...CLASS, him(days)],
    });
    expect(seasonOf(t, NEXT).status).toBe('indeterminate');
    expect(t.eligibility!.seasons[1].arbitration.missing.map((m) => m.message).join(' ')).toMatch(/schedule/);
  });
});
