import { describe, expect, it } from 'vitest';
import { controlAfterThisSeason } from '../server/contracts.js';
import {
  YEAR, contractRow, factsOf, mlbRules, stateOf, timelineOf, type ServiceSpec,
} from './playerValueFixtures.js';

/**
 * Telling a deal ending from a player leaving.
 *
 * The payroll page counted both as money coming off the books, and a reader
 * pointed out that they are not the same thing: a man with arbitration years
 * left is still yours, and his salary is about to rise rather than vanish. On
 * the club this was checked against, the old single figure was 36 players and
 * $74M of supposed relief, of which only 8 players and $33M actually leave.
 *
 * The reasoning now lives in one place for every page: Player Rights states
 * eligibility, Player Value composes the timeline, and `controlAfterThisSeason`
 * reads its next season (D-052). These cases were written against the old
 * service-time sum inside contracts.ts and are kept, driven through the new
 * path. Two expectations moved with it: the rules come from the league row
 * (six and three here because the synthetic league says so, not by default),
 * and the season clock replaces a free "service left" fraction, so a whole
 * extra year can no longer be added at all.
 */

const SEASON_OVER = YEAR; // the clock has run the whole service year: nothing left to bank
const expiring = factsOf(contractRow({ years: 1 }));
const ask = (service: ServiceSpec, opts: { clock?: number; rules?: ReturnType<typeof mlbRules>; contract?: typeof expiring } = {}) =>
  controlAfterThisSeason(timelineOf({
    state: stateOf({ thisYear: SEASON_OVER, ...service }),
    rules: opts.rules,
    contract: opts.contract ?? expiring,
    clock: opts.clock ?? SEASON_OVER,
  }))!;

describe('what happens when a deal runs out', () => {
  it('calls a six-year man leaving', () => {
    expect(ask({ days: null, years: 6 }).status).toBe('leaving');
  });

  it('does not call an arbitration case leaving', () => {
    const r = ask({ days: null, years: 4 });
    expect(r.status).toBe('arbitration');
    expect(r.arbYear).toBe(2);
  });

  it('counts the arbitration trips from the threshold', () => {
    expect(ask({ days: null, years: 3 }).arbYear).toBe(1);
    expect(ask({ days: null, years: 5 }).arbYear).toBe(3);
  });

  it('calls a first-year man pre-arbitration', () => {
    expect(ask({ days: null, years: 1 }).status).toBe('pre-arbitration');
  });

  it('prefers service days, which are exact, over truncated years', () => {
    // 175 days past five years is six, just; the truncated column still says 5
    expect(ask({ days: 5 * YEAR + 175, years: 5 }).status).toBe('leaving');
    expect(ask({ days: 3 * YEAR, years: 5 }).status).toBe('arbitration');
  });

  it('counts only the season still to be played, not a whole extra year', () => {
    // Four years and 100 days with 40 of the season's days gone: 132 remain, which cannot reach
    // six years whatever he does. Adding a full year used to push him over the line months early.
    const r = ask({ days: 4 * YEAR + 100, thisYear: 40 }, { clock: 40 });
    expect(r.status).toBe('arbitration');
    // Which trip depends on whether he stays up: both are stated
    expect([r.arbYear, r.arbYearHigh]).toEqual([2, 3]);
  });

  it('leaves a man under contract alone', () => {
    expect(ask({ days: 8 * YEAR }, { contract: factsOf(contractRow({ years: 3 })) }).status).toBe('signed');
  });

  it('treats an extension as the club keeping him', () => {
    const extension = contractRow({ firstSeason: 2031, years: 4 });
    expect(ask({ days: 8 * YEAR }, { contract: factsOf(contractRow({ years: 1 }), { extension }) }).status).toBe('extended');
  });

  it('has nobody leaving in a league with no free agency', () => {
    expect(ask({ days: 12 * YEAR }, { rules: mlbRules({ rules_fa_minimum_years: 0 }) }).status).toBe('reserve clause');
  });

  it('skips arbitration where the league has none', () => {
    expect(ask({ days: 4 * YEAR }, { rules: mlbRules({ rules_salary_arbitration_minimum_years: 0 }) }).status).toBe('pre-arbitration');
  });

  it('says indeterminate, with what it lies between, when a rule is not exported (never six or three)', () => {
    const r = ask({ days: 7 * YEAR }, { rules: mlbRules({ rules_fa_minimum_years: undefined }) });
    expect(r.status).toBe('indeterminate');
    expect(r.reason).toMatch(/free-agency rule/);
  });

  it('says nothing for a man no club holds', () => {
    expect(controlAfterThisSeason(timelineOf({ contract: factsOf(contractRow({ teamId: 0 }), { teamId: 0 }) }))).toBeNull();
  });
});
