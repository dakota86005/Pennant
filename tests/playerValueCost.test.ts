import { describe, expect, it } from 'vitest';
import { COST_PENDING_OBSERVED_PAY, COST_PENDING_PRICE_OF_A_WIN } from '../server/playerValueCalibration.js';
import {
  THIS_SEASON, YEAR, contractRow, factsOf, mlbRules, seasonOf, stateOf, tablesOf, timelineOf,
} from './playerValueFixtures.js';

/*
 * Player Value, concern 2's cost bands and concern 1's contract facts (docs/BEHAVIOR_CASES.md
 * "Player Value", playerValueCost.test.ts, phases 1 to 4). Phase 1 builds the facts and the cost
 * of a contract season; the pre-arbitration and arbitration bands are priced against the price
 * of a win, which phases 2 and 4 build, so until then they are unknown with that reason. The
 * phase-2 halves are `it.todo`.
 */

const NEXT = THIS_SEASON + 1;
const MINIMUM = 780_000;
const expiring = factsOf(contractRow({ years: 1, salary: MINIMUM }));

describe('Player Value: cost (phase 1)', () => {
  it("an arbitration-eligible player's cost path is never the league minimum and never a point", () => {
    const t = timelineOf({ state: stateOf({ days: 4 * YEAR, thisYear: YEAR }), contract: expiring, clock: YEAR });
    const arbitration = t.seasons.filter((s) => s.status === 'arbitration');
    expect(arbitration.length).toBeGreaterThan(0);
    for (const s of arbitration) {
      expect(s.cost).not.toBeNull();
      // Unknown until phase 2/4 builds the ladder: in particular not the minimum, and not a point
      expect(s.cost!.value).toBeNull();
      expect(s.cost!.note).toBe(COST_PENDING_PRICE_OF_A_WIN);
      expect(s.cost!.value).not.toEqual({ low: MINIMUM, high: MINIMUM });
    }
  });

  it.todo("an arbitration-eligible player's cost path is a band from the arbitration ladder (phase 2/4)");

  it('a pre-arbitration renewal is never priced at the minimum as a point before the price of a win exists', () => {
    const t = timelineOf({ state: stateOf({ days: 30, thisYear: 30 }), contract: expiring });
    const renewal = seasonOf(t, NEXT);
    expect(renewal.status).toBe('pre_arbitration');
    expect(renewal.cost!.value).toBeNull();
    expect(renewal.cost!.note).toBe(COST_PENDING_PRICE_OF_A_WIN);
  });

  it.todo('a pre-arbitration renewal is a band that starts at the minimum (phase 2)');

  it("a reserve-clause renewal waits for the league's observed pay", () => {
    const t = timelineOf({ state: stateOf({ days: 10 * YEAR }), rules: mlbRules({ rules_fa_minimum_years: 0 }), contract: expiring });
    expect(seasonOf(t, NEXT).status).toBe('reserve_clause');
    expect(seasonOf(t, NEXT).cost!.note).toBe(COST_PENDING_OBSERVED_PAY);
  });

  it('a season under contract costs the salary the contract states, as a point with its column', () => {
    const t = timelineOf({ contract: factsOf(contractRow({ years: 3, salary: [9_000_000, 10_000_000, 11_000_000] })) });
    expect(t.seasons.slice(0, 3).map((s) => [s.status, s.cost?.value])).toEqual([
      ['under_contract', { low: 9_000_000, high: 9_000_000 }],
      ['under_contract', { low: 10_000_000, high: 10_000_000 }],
      ['under_contract', { low: 11_000_000, high: 11_000_000 }],
    ]);
    expect(seasonOf(t, NEXT).cost!.source).toBe('players_contract.salary1');
    // A free agent is no cost to this club: control ends
    const veteran = timelineOf({ state: stateOf({ days: 9 * YEAR }), contract: expiring });
    expect(seasonOf(veteran, NEXT)).toMatchObject({ status: 'free_agent', cost: null });
  });

  it('an option is shown on both branches', () => {
    // A club option in the deal's last season, for a man who would otherwise reach free agency
    const optioned = factsOf(contractRow({ years: 2, salary: [12_000_000, 15_000_000], teamOption: 1 }));
    const t = timelineOf({ state: stateOf({ days: 7 * YEAR }), contract: optioned });
    const option = seasonOf(t, NEXT);
    expect(option.status).toBe('club_option');
    // Exercised: the salary
    expect(option.cost!.value).toEqual({ low: 15_000_000, high: 15_000_000 });
    // Declined: the buyout (not populated on this export, so unknown) and what he falls to
    expect(option.declined).not.toBeNull();
    expect(option.declined!.buyout.value).toBeNull();
    expect(option.declined!.status).toBe('free_agent');
    expect(option.basis).toMatch(/exercised.*declined/);

    const playerOption = factsOf(contractRow({ years: 2, playerOption: 1 }));
    const p = seasonOf(timelineOf({ state: stateOf({ days: 2 * YEAR }), contract: playerOption }), NEXT);
    expect(p.status).toBe('player_option');
    expect(p.declined!.status).not.toBe('under_contract');
  });

  it('a no-trade clause, buyout or minor-league salary the export does not populate is unknown, never none and never $0', () => {
    // On the imported historical start no-trade, buyout and retained salary are 0 on every contract
    const facts = factsOf(contractRow({ years: 2, teamOption: 1 }));
    expect(facts.noTrade).toMatchObject({ value: null, provenance: 'unknown' });
    expect(facts.noTrade.note).toMatch(/not populated/);
    expect(facts.term!.buyout.value).toBeNull();
    expect(facts.retained.value).toBeNull();
    // Where the export does populate the column, its 0 is read as none
    const populated = factsOf(contractRow({ years: 2 }), { tables: tablesOf(['no_trade', 'last_year_option_buyout', 'retained']) });
    expect(populated.noTrade).toMatchObject({ value: false, provenance: 'explicit_export' });
    expect(populated.term!.buyout.value).toBe(0);

    // A minor-league $0 is unknown (Q-5), in the facts and in the cost
    const minor = factsOf(contractRow({ years: 1, isMajor: 0, salary: 0 }));
    expect(minor.kind.value).toBe('minor_league');
    expect(minor.term!.seasons[0].salary.value).toBeNull();
    expect(minor.term!.seasons[0].salary.note).toMatch(/never \$0/);
    const cost = seasonOf(timelineOf({ contract: minor }), THIS_SEASON).cost!;
    expect(cost.value).toBeNull();
    // ...and a major-league season the export leaves at 0 is not a cost of zero either
    const zero = factsOf(contractRow({ years: 2, salary: [5_000_000, 0] }));
    expect(zero.term!.seasons[1].salary.value).toBeNull();
  });

  it('carries the extension that follows the deal, season by season', () => {
    const extension = contractRow({ firstSeason: THIS_SEASON + 1, years: 2, salary: [20_000_000, 22_000_000] });
    const t = timelineOf({ state: stateOf({ days: 5 * YEAR + 100 }), contract: factsOf(contractRow({ years: 1 }), { extension }) });
    expect(t.seasons.slice(0, 3).map((s) => [s.from, s.cost?.value?.low ?? null])).toEqual([
      ['contract', 5_000_000], ['extension', 20_000_000], ['extension', 22_000_000],
    ]);
    // After the extension he is past free agency: control ends
    expect(seasonOf(t, THIS_SEASON + 3).status).toBe('free_agent');
  });
});
