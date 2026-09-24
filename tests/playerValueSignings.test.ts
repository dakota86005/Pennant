import { describe, expect, it } from 'vitest';
import {
  adoptPrice, awardReadings, contractTimeline, freeAcquisitions, measurePriceOfWin, measureReplacement, observeChanges, observePairs, reserveRenewals, scoreAwards,
  type ContractSnapshot, type ContractSnapshotRow, type PairContext, type WinterPair,
} from '../server/playerValueSignings.js';
import { openingPriceOfWin, samplingComparable, type PriceOfWin } from '../server/playerValueFinances.js';
import { OPENING_PRICE_MINIMUMS, SIGNINGS_POLICY } from '../server/playerValueCalibration.js';

/*
 * Phase 4b: the measured price of a win across imports (PLAYER_VALUE.md 4.2 to 4.4, BEHAVIOR_CASES.md "Player Value",
 * phase 4b). Pure: two snapshots of the save's contracts, as the import recorded them, are compared; every change is
 * named for what changed and read through Player Rights' answer at the earlier import, never given a transaction type
 * the export does not carry (D-020). The price, the awards, the reserve-clause renewals and the replacement level are
 * measured from those readings only.
 */

const MIN = 700_000;

/** The later export's lines: no signing club held the player during the season before (the organization he signed with is new to him). */
const CTX: PairContext = { heldDuring: () => false };
const observe = (earlier: ContractSnapshot, later: ContractSnapshot) => observeChanges(earlier, later, CTX);

function row(playerId: number, over: Partial<ContractSnapshotRow> = {}): ContractSnapshotRow {
  return {
    playerId, teamId: 1, orgId: 1, kind: 'major_league', firstSeason: 2040, years: 1, salaries: [MIN],
    extension: null, placement: 'active', majorRecord: true,
    rights: [
      { season: 2040, standing: 'free_agency', between: [], trip: null, tripIfEligible: null },
      { season: 2041, standing: 'free_agency', between: [], trip: null, tripIfEligible: null },
      { season: 2042, standing: 'free_agency', between: [], trip: null, tripIfEligible: null },
    ],
    production: {
      status: 'projected', label: 'test',
      seasons: [
        { season: 2040, central: 2, low: 0.5, high: 3.5, opportunities: 600 },
        { season: 2041, central: 2, low: 0.2, high: 3.8, opportunities: 580 },
        { season: 2042, central: 1.8, low: 0, high: 3.6, opportunities: 550 },
      ],
    },
    nextCost: null,
    ...over,
  };
}

const standingFor = (standing: string, trip: { low: number; high: number } | null = null, between: string[] = []) => [
  { season: 2040, standing: standing as never, between: between as never[], trip, tripIfEligible: null },
  { season: 2041, standing: standing as never, between: between as never[], trip, tripIfEligible: null },
  { season: 2042, standing: standing as never, between: between as never[], trip, tripIfEligible: null },
];

function snap(gameDate: string, season: number, seasonPlayed: number, rows: ContractSnapshotRow[], over: Partial<ContractSnapshot> = {}): ContractSnapshot {
  return {
    leagueId: 100, gameDate, season, seasonPlayed, minimum: MIN, financials: true,
    arbitration: { status: 'arbitration', classes: 3, mlb: false }, rows, ...over,
  };
}

const EARLY = (rows: ContractSnapshotRow[]) => snap('2040-07-01', 2040, 0.5, rows);
const LATE = (rows: ContractSnapshotRow[]) => snap('2041-05-01', 2041, 0.2, rows);
const only = (p: WinterPair) => {
  expect(p.changes).toHaveLength(1);
  return p.changes[0];
};

/** A winter of free-agent signings at a known price (dollars per expected win), each at 2 expected wins next season. */
function marketWinter(n: number, perWin: (i: number) => number, wins = (i: number) => 1 + (i % 4) * 0.5): WinterPair {
  const before: ContractSnapshotRow[] = [];
  const after: ContractSnapshotRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = 1000 + i;
    const w = wins(i);
    const b = row(id, { teamId: 1 + (i % 4), orgId: 1 + (i % 4) });
    b.production!.seasons[1] = { season: 2041, central: w, low: w - 1, high: w + 1, opportunities: 500 };
    before.push(b);
    after.push(row(id, { teamId: 5 + (i % 3), orgId: 5 + (i % 3), firstSeason: 2041, years: 1, salaries: [MIN + perWin(i) * w] }));
  }
  return observe(EARLY(before), LATE(after));
}

describe('observed changes: named for what changed, read through Player Rights at the earlier import (D-020)', () => {
  it('a contract whose club changed on the same terms moved with him: it is never a signing', () => {
    const c = only(observe(EARLY([row(1, { years: 3, salaries: [MIN, MIN, MIN] })]), LATE([row(1, { teamId: 4, orgId: 4, years: 3, salaries: [MIN, MIN, MIN] })])));
    expect(c.kind).toBe('transferred');
    expect(c.uses).toEqual([]);
    expect(c.reading).toMatch(/does not say/);
    expect(c.changed).toMatch(/club 1 → 4/);
  });

  it("a free-agency-eligible player's new deal with a club that did not hold him is a free-agent market signing, priced on his expected wins at the earlier import", () => {
    const c = only(observe(EARLY([row(1)]), LATE([row(1, { teamId: 3, orgId: 3, firstSeason: 2041, years: 2, salaries: [5_700_000, 6_700_000] })])));
    expect(c.kind).toBe('free_agent_signing');
    expect(c.uses).toContain('price');
    // Salary above the minimum over the expected wins of the seasons it covers, both read at the earlier import
    expect(c.money).toBeCloseTo(5_000_000 + 6_000_000);
    expect(c.wins).toBeCloseTo(2 + 1.8);
    expect(c.pricedSeasons).toBe(2);
    expect(c.changed).toMatch(/first season 2040 → 2041/);
  });

  it('a free agent who stays with the club that held him is named, counted and left out of the price: whether he reached the market first is not in the export', () => {
    const p = observe(EARLY([row(1)]), LATE([row(1, { firstSeason: 2041, years: 3, salaries: [9e6, 9e6, 9e6] })]));
    const c = only(p);
    expect(c.kind).toBe('retained_at_free_agency');
    expect(c.uses).toEqual([]);
    expect(c.left).toMatch(/not in the export|does not say/);
    expect(p.counts.retained_at_free_agency).toBe(1);
  });

  it('a one-year deal with his club for a player in arbitration is an arbitration salary (award or settlement, unstated); at the minimum it is not read as one', () => {
    const arb = standingFor('arbitration', { low: 2, high: 2 });
    const earlier = EARLY([row(1, { rights: arb, nextCost: { season: 2041, low: 2e6, high: 6e6, method: 'arbitration_ladder', source: 'measured' } }), row(2, { rights: arb })]);
    const p = observe(earlier, LATE([row(1, { firstSeason: 2041, salaries: [4e6] }), row(2, { firstSeason: 2041, salaries: [MIN] })]));
    const byId = new Map(p.changes.map((c) => [c.playerId, c]));
    expect(byId.get(1)!.kind).toBe('arbitration_salary');
    expect(byId.get(1)!.reading).toMatch(/award or (a )?settlement/i);
    expect(byId.get(1)!.uses).toContain('awards');
    expect(byId.get(1)!.arbitrationClass).toEqual({ low: 2, high: 2 });
    expect(byId.get(2)!.kind).toBe('arbitration_at_minimum');
    expect(byId.get(2)!.uses).toEqual([]);
  });

  it('a one-year deal before arbitration is a renewal; under a reserve clause it is a reserve-clause renewal', () => {
    const p = observe(
      EARLY([row(1, { rights: standingFor('pre_arbitration') }), row(2, { rights: standingFor('reserve_clause') })]),
      LATE([row(1, { firstSeason: 2041, salaries: [MIN + 20_000] }), row(2, { firstSeason: 2041, salaries: [1_500_000] })]),
    );
    const byId = new Map(p.changes.map((c) => [c.playerId, c]));
    expect(byId.get(1)!.kind).toBe('renewal');
    expect(byId.get(2)!.kind).toBe('reserve_clause_renewal');
    expect(byId.get(2)!.uses).toContain('reserve');
  });

  it('a longer deal with his club while controlled, or a new deal over seasons his contract still covered, is an extension; one already signed at the earlier import is not observed as new', () => {
    const p = observe(
      EARLY([
        row(1, { rights: standingFor('pre_arbitration') }),
        row(2, { years: 3, salaries: [MIN, MIN, MIN] }),
        row(3, { rights: standingFor('arbitration', { low: 1, high: 1 }), extension: { firstSeason: 2041, years: 4 } }),
      ]),
      LATE([
        row(1, { firstSeason: 2041, years: 5, salaries: [1e6, 2e6, 4e6, 6e6, 8e6] }),
        row(2, { firstSeason: 2041, years: 6, salaries: Array(6).fill(20e6) }),
        row(3, { firstSeason: 2041, years: 4, salaries: Array(4).fill(5e6) }),
      ]),
    );
    const byId = new Map(p.changes.map((c) => [c.playerId, c]));
    expect(byId.get(1)!.kind).toBe('extension');
    expect(byId.get(2)!.kind).toBe('extension');
    expect(byId.get(3)!.kind).toBe('extension_known');
    for (const c of p.changes) expect(c.uses).toEqual([]);
  });

  it('a controlled player no club holds at the later import was not tendered or was released, and the reading says the export does not say which', () => {
    const c = only(observe(
      EARLY([row(1, { rights: standingFor('arbitration', { low: 1, high: 1 }) })]),
      LATE([row(1, { teamId: null, orgId: null, kind: null, firstSeason: null, years: null, salaries: [], rights: null })]),
    ));
    expect(c.kind).toBe('not_retained');
    expect(c.reading).toMatch(/not tendered|released/);
    expect(c.reading).toMatch(/does not say which/);
    // Never a transaction the export does not carry
    expect(`${c.reading} ${c.changed}`).not.toMatch(/\boptioned\b|\brecalled\b|\bDFA\b|designated for assignment|outright/i);
  });

  it("an indeterminate standing at the earlier import leaves the change out of every measurement, naming the statuses it lay between", () => {
    const c = only(observe(
      EARLY([row(1, { rights: standingFor('indeterminate', null, ['pre_arbitration', 'arbitration']) })]),
      LATE([row(1, { firstSeason: 2041, salaries: [3e6] })]),
    ));
    expect(c.kind).toBe('standing_not_established');
    expect(c.uses).toEqual([]);
    expect(c.left).toMatch(/pre.arbitration/);
    expect(c.left).toMatch(/arbitration/);
  });

  it('no club held him at the earlier import: a major-league deal is a free-agent signing; a minor-league deal with a major-league record is freely available talent', () => {
    const unsigned = (id: number) => row(id, { teamId: null, orgId: null, kind: null, firstSeason: null, years: null, salaries: [], rights: null });
    const p = observe(
      EARLY([unsigned(1), unsigned(2), { ...unsigned(3), majorRecord: false }]),
      LATE([
        row(1, { teamId: 2, orgId: 2, firstSeason: 2041, salaries: [MIN] }),
        row(2, { teamId: 102, orgId: 2, kind: 'minor_league', firstSeason: 2041, salaries: [null] }),
        row(3, { teamId: 102, orgId: 2, kind: 'minor_league', firstSeason: 2041, salaries: [null] }),
      ]),
    );
    const byId = new Map(p.changes.map((c) => [c.playerId, c]));
    expect(byId.get(1)!.kind).toBe('free_agent_signing');
    expect(byId.get(1)!.uses).toEqual(expect.arrayContaining(['price', 'replacement']));
    expect(byId.get(2)!.kind).toBe('minor_league_signing');
    expect(byId.get(2)!.uses).toContain('replacement');
    // No major-league record: an amateur or a newcomer, not a measure of freely available major-league talent
    expect(byId.get(3)!.uses).toEqual([]);
    expect(freeAcquisitions([p]).map((a) => a.playerId).sort()).toEqual([1, 2]);
  });

  it('a deal whose first season was already under way at the earlier import is left out of the price', () => {
    const c = only(observe(snap('2040-07-01', 2040, 0.5, [row(1, { teamId: null, orgId: null, kind: null, firstSeason: null, years: null, salaries: [], rights: null })]),
      snap('2040-08-01', 2040, 0.7, [row(1, { teamId: 3, orgId: 3, firstSeason: 2040, salaries: [2e6] })])));
    expect(c.kind).toBe('free_agent_signing');
    expect(c.uses).not.toContain('price');
    expect(c.left).toMatch(/under way/);
  });

  it('imports inside one season observe no winter; imports across a rollover do', () => {
    expect(observe(snap('2040-07-01', 2040, 0.5, []), snap('2040-08-01', 2040, 0.7, [])).spansWinter).toBe(false);
    expect(observe(EARLY([]), LATE([])).spansWinter).toBe(true);
    // An import before Opening Day and one after the season began span the end of that winter
    expect(observe(snap('2041-03-01', 2041, 0, []), LATE([])).spansWinter).toBe(true);
  });
});

describe('the measured price of a win (ratio of sums, resampled band)', () => {
  it('is salary above the minimum over expected wins, summed over the free-agent signings, with a band that holds it', () => {
    const pair = marketWinter(30, (i) => 5e6 + (i % 5) * 0.4e6);
    // Each produced what was expected of him: per win produced (owner, 2026-09-24) equals per win expected here
    const m = measurePriceOfWin({ pairs: [pair], imports: 3, replacement: null, realized: realizedOf(pair) });
    expect(m.status).toBe('measured');
    const signings = pair.changes.filter((c) => c.uses.includes('price'));
    const ratio = signings.reduce((s, c) => s + c.money!, 0) / signings.reduce((s, c) => s + c.wins!, 0);
    expect(m.price.value!.central).toBeCloseTo(ratio, 0);
    expect(m.price.value!.low).toBeLessThan(m.price.value!.central);
    expect(m.price.value!.high).toBeGreaterThan(m.price.value!.central);
    expect(m.signings).toBe(30);
    expect(m.text).toMatch(/30 free-agent signings/);
  });

  it(`with fewer signings than the opening basis's minimum (${OPENING_PRICE_MINIMUMS.contracts}) it is not measured and says how many were observed`, () => {
    const m = measurePriceOfWin({ pairs: [marketWinter(12, () => 5e6)], imports: 2, replacement: null });
    expect(m.status).toBe('not_measured');
    expect(m.price.value).toBeNull();
    expect(m.price.note).toMatch(/12 free-agent signings/);
    expect(m.price.note).toMatch(new RegExp(`${OPENING_PRICE_MINIMUMS.contracts}`));
  });

  it('fewer signings at the same prices never give a narrower band (thinner evidence widens)', () => {
    const price = (i: number) => 3e6 + (i % 10) * 0.8e6;
    const smallPair = marketWinter(20, price);
    const largePair = marketWinter(80, price);
    const small = measurePriceOfWin({ pairs: [smallPair], imports: 3, replacement: null, realized: realizedOf(smallPair) });
    const large = measurePriceOfWin({ pairs: [largePair], imports: 3, replacement: null, realized: realizedOf(largePair) });
    const width = (m: typeof small) => m.price.value!.high - m.price.value!.low;
    expect(width(small)).toBeGreaterThan(width(large));
  });

  it('with one import, or none across a winter, nothing is measured and it says precisely what is missing', () => {
    const one = measurePriceOfWin({ pairs: [], imports: 1, importDates: ['2026-05-16'], replacement: null });
    expect(one.status).toBe('no_off_season');
    expect(one.price.note).toMatch(/No off-season observed yet: the measured price needs two imports across a winter/);
    expect(one.price.note).toMatch(/1 import recorded \(2026-05-16\)/);
    const sameSeason = measurePriceOfWin({ pairs: [observe(snap('2040-07-01', 2040, 0.5, []), snap('2040-08-01', 2040, 0.7, []))], imports: 2, replacement: null });
    expect(sameSeason.status).toBe('no_off_season');
  });

});


/** An opening price whose market bases spread from about $5M to $9M. */
function openingPriceFixture(): PriceOfWin {
  // An opening price whose market bases spread from about $5M to $9M
  const candidates = Array.from({ length: 60 }, (_, i) => ({
    playerId: i + 1,
    contract: { kind: { value: 'major_league' }, term: { firstSeason: { value: i < 30 ? 2041 : 2039 }, years: { value: 1 }, seasons: [{ season: 2041, salary: { value: MIN + (5e6 + (i % 5) * 1e6) * (1 + (i % 3)) } }] } },
    control: { eligibility: { seasons: [{ freeAgency: { status: 'eligible' } }] } },
  })) as never[];
  const byPlayer = new Map<number, number>(Array.from({ length: 60 }, (_, i) => [i + 1, 1 + (i % 3)]));
  const war = new Map([2039, 2040, 2041].map((y) => [y, { season: y, byPlayer, total: 120, clubs: new Set([1, 2]), source: 'test' }]));
  const shares = new Map([2039, 2040].map((y) => [y, { value: 1, source: 'x', provenance: 'derived' as const }]));
  return openingPriceOfWin({
    leagueId: 100, season: 2041, financials: { value: true, source: 'x', provenance: 'exported' } as never, minimumSalary: { value: MIN, source: 'x', provenance: 'exported' } as never,
    candidates, war, seasonFraction: { value: 0.5, source: 'x', provenance: 'derived' } as never, seasonShares: shares as never,
  });
}

/** What each signing of a winter produced in its first season: what was expected of him, times a factor. */
const realizedOf = (pair: WinterPair, factor = 1) => {
  const wins = new Map(pair.changes.map((c) => [c.playerId, c.firstWins ?? null]));
  return (id: number, season: number) => (season === 2041 && wins.get(id) != null ? (wins.get(id) as number) * factor : null);
};

describe('adoption (owner Q-4): the measured price replaces the opening one only when its band is narrower', () => {
  const opening = (): PriceOfWin => openingPriceFixture();

  it('each opening basis carries a resampled band over its contracts, and the band compared is its spread with that sampling in it; the served opening band is unchanged', () => {
    const o = opening();
    expect(o.sampling).toBeTruthy();
    for (const b of o.sampling!.bases) expect(b.low).toBeLessThanOrEqual(b.high);
    const comparable = o.sampling!.comparable!;
    expect(comparable.low).toBeLessThanOrEqual(o.price.value!.low);
    expect(comparable.high).toBeGreaterThanOrEqual(o.price.value!.high);
    expect(o.stage).toBe('opening');
  });

  it('a narrower measured band replaces the opening price, and the price says why', () => {
    const o = opening();
    const pair = marketWinter(120, (i) => 6e6 + (i % 3) * 0.1e6);
    const m = measurePriceOfWin({ pairs: [pair], imports: 3, replacement: null, realized: realizedOf(pair) });
    const inForce = adoptPrice(o, m);
    expect(inForce.stage).toBe('measured');
    expect(inForce.price.value!.central).toBeCloseTo(m.price.value!.central, 0);
    expect(inForce.adoption!.inForce).toBe('measured');
    expect(inForce.adoption!.reason).toMatch(/narrower than the opening band/);
    // The floor is still the opening's floor
    expect(inForce.floor).toEqual(o.floor);
  });

  it('a wider measured band leaves the opening price in force, naming the signings observed and both bands', () => {
    const o = opening();
    const pair = marketWinter(21, (i) => (i % 2 === 0 ? 1e6 : 30e6));
    const m = measurePriceOfWin({ pairs: [pair], imports: 3, replacement: null, realized: realizedOf(pair) });
    expect(m.status).toBe('measured');
    const inForce = adoptPrice(o, m);
    expect(inForce.stage).toBe('opening');
    expect(inForce.price).toEqual(o.price);
    expect(inForce.adoption!.inForce).toBe('opening');
    expect(inForce.adoption!.reason).toMatch(/21 free-agent signings observed/);
    expect(inForce.adoption!.reason).toMatch(/wider than the opening band/);
    expect(inForce.adoption!.reason).toMatch(/\$[\d.]+M–\$[\d.]+M.*\$[\d.]+M–\$[\d.]+M/);
  });

  it('with no off-season observed the opening price stays and says so', () => {
    const inForce = adoptPrice(opening(), measurePriceOfWin({ pairs: [], imports: 1, importDates: ['2026-05-16'], replacement: null }));
    expect(inForce.stage).toBe('opening');
    expect(inForce.adoption!.reason).toMatch(/No off-season observed yet/);
  });
});

describe('observed arbitration salaries, reserve-clause renewals and freely available talent', () => {
  const arbWinter = (n: number, cls: number, pay: (i: number) => number, cost = { low: 2e6, high: 5e6 }): WinterPair => {
    const before: ContractSnapshotRow[] = [];
    const after: ContractSnapshotRow[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = 5000 + cls * 1000 + i;
      before.push(row(id, { rights: standingFor('arbitration', { low: cls, high: cls }), nextCost: { season: 2041, ...cost, method: 'arbitration_ladder', source: 'measured' } }));
      after.push(row(id, { firstSeason: 2041, salaries: [pay(i)] }));
    }
    return observe(EARLY(before), LATE(after));
  };

  it("each observed arbitration salary is scored against the band the earlier import priced for it, and the coverage is reported with its count", () => {
    const pair = arbWinter(10, 1, (i) => (i < 8 ? 3e6 : 9e6));
    const s = scoreAwards([pair], { status: 'arbitration', classes: 3, mlb: false });
    expect(s.status).toBe('scored');
    expect(s.scored).toBe(10);
    expect(s.covered).toBe(8);
    expect(s.coverage).toBeCloseTo(0.8);
    expect(s.text).toMatch(/8 of 10/);
  });

  it('a league without arbitration has no salaries to score and says so', () => {
    const s = scoreAwards([], { status: 'no_arbitration', classes: null, mlb: false });
    expect(s.status).toBe('no_arbitration');
    expect(s.text).toMatch(/no salary arbitration|no arbitration/i);
  });

  it('a class with the policy minimum of observed salaries is a reading of the class; fewer are not used', () => {
    const many = arbWinter(35, 1, (i) => MIN + 1e6 + i * 50_000);
    const few = arbWinter(10, 2, () => 3e6);
    const { readings } = awardReadings([many, few], (id) => (id % 7) * 0.5, 6e6, 3);
    const one = readings.find((r) => r.arbitrationClass === 1)!;
    const two = readings.find((r) => r.arbitrationClass === 2)!;
    expect(one.status).toBe('measured');
    expect(one.reading!.cases).toBe(35);
    expect(one.cases).toBe(35);
    expect(two.status).toBe('thin');
    expect(two.reading).toBeNull();
  });

  it('reserve-clause renewals observed across imports price a reserve-clause season from the minimum; below the policy minimum it stays unknown and says how many were seen', () => {
    const renewals = (n: number) => {
      const before = Array.from({ length: n }, (_, i) => row(8000 + i, { rights: standingFor('reserve_clause') }));
      const after = Array.from({ length: n }, (_, i) => row(8000 + i, { firstSeason: 2041, salaries: [MIN + (i % 10) * 100_000] }));
      return observe(EARLY(before), LATE(after));
    };
    const measured = reserveRenewals([renewals(40)], MIN);
    expect(measured.status).toBe('measured');
    expect(measured.band.value!.low).toBe(MIN);
    expect(measured.band.value!.high).toBeGreaterThan(MIN);
    const thin = reserveRenewals([renewals(8)], MIN);
    expect(thin.status).toBe('unknown');
    expect(thin.band.note).toMatch(/8 reserve-clause renewals/);
  });

  it("replacement from freely available talent: below the policy minimum the export's convention stays, labelled provisional; above it, it is measured per 600 opportunities with its band", () => {
    const acquisitions = (n: number) => Array.from({ length: n }, (_, i) => ({ playerId: i + 1, orgId: 1, firstSeason: 2041, how: 'minor_league_deal' as const, gameDate: '2041-05-01' }));
    const after = (n: number) => new Map(Array.from({ length: n }, (_, i) => [i + 1, { war: 0.2 + (i % 5) * 0.1, opportunities: 200 }]));
    const thin = measureReplacement(acquisitions(10), after(10));
    expect(thin.status).toBe('not_measured');
    expect(thin.text).toMatch(/provisional/);
    expect(thin.text).toMatch(/10/);
    const measured = measureReplacement(acquisitions(SIGNINGS_POLICY.replacement.minimumPlayers + 5), after(SIGNINGS_POLICY.replacement.minimumPlayers + 5));
    expect(measured.status).toBe('measured');
    const per600 = measured.per600.value!;
    expect(per600.low).toBeLessThanOrEqual(per600.central);
    expect(per600.central).toBeLessThanOrEqual(per600.high);
    expect(per600.central).toBeCloseTo(((0.2 + 0.3 + 0.4 + 0.5 + 0.6) / 5 / 200) * 600, 1);
  });
});

/*
 * Phase 4b review (2026-09-24; BEHAVIOR_CASES.md "Player Value", phase 4b review). R3's correctness findings and R4's
 * method findings, each written before its fix.
 */
describe('phase 4b review: a winter read by the calendar (R3-01, R3-11, R4-12)', () => {
  it('an import after the season number moved on but before Opening Day is inside the winter: its signings are market prices, never "already under way"', () => {
    // December: the league is on 2041, no game of it played (share 0, as the snapshot records a season not begun)
    const dec = snap('2040-12-10', 2041, 0, [row(1, { firstSeason: 2038, years: 3, salaries: [MIN, MIN, MIN] })]);
    const jan = snap('2041-1-20', 2041, 0, [row(1, { teamId: 2, orgId: 2, firstSeason: 2041, years: 2, salaries: [9e6, 9e6] })]);
    const p = observe(dec, jan);
    expect(p.winters).toEqual([2041]);
    const c = only(p);
    expect(c.kind).toBe('free_agent_signing');
    expect(c.uses).toContain('price');
    expect(c.left ?? '').not.toMatch(/under way/);
  });

  it('several imports across one winter count one winter, never one per pair', () => {
    const held = row(3, { firstSeason: 2038, years: 3, salaries: [1e6, 1e6, 1e6] });
    const moved = row(3, { teamId: 2, orgId: 2, firstSeason: 2041, years: 1, salaries: [5e6] });
    const pairs = observePairs([
      snap('2040-7-1', 2040, 0.5, [held]), snap('2040-10-20', 2040, 1, [held]), snap('2040-12-10', 2041, 0, [held]),
      snap('2041-1-15', 2041, 0, [held]), snap('2041-3-1', 2041, 0, [moved]), snap('2041-5-1', 2041, 0.2, [moved]),
    ]);
    expect(pairs.map((x) => x.winters)).toEqual([[], [2041], [2041], [2041], [2041]]);
    const m = measurePriceOfWin({ pairs, imports: 6, replacement: null });
    expect(m.winters).toBe(1);
  });

  it('imports a winter or more apart say so, and what they show is not priced as one winter\'s signings', () => {
    const p = observe(snap('2040-7-1', 2040, 0.5, [row(1)]), snap('2042-5-1', 2042, 0.2, [row(1, { teamId: 3, orgId: 3, firstSeason: 2042, years: 1, salaries: [6e6] })]));
    expect(p.winters).toEqual([2041, 2042]);
    expect(p.note).toMatch(/2 winters/);
    for (const c of p.changes) expect(c.uses).not.toContain('price');
    expect(only(p).left).toMatch(/winters apart/);
    const m = measurePriceOfWin({ pairs: [p], imports: 2, replacement: null });
    expect(m.status).not.toBe('measured');
    expect(m.text).toMatch(/winters apart/);
  });
});

describe('phase 4b review: readings named for what the export shows (R3-02, R3-04, R3-09)', () => {
  it('an extension the earlier import held moves with the player: taking effect after a trade, it is never a market signing', () => {
    const c = only(observe(
      EARLY([row(1, { extension: { firstSeason: 2041, years: 5 } })]),
      LATE([row(1, { teamId: 2, orgId: 2, firstSeason: 2041, years: 5, salaries: Array(5).fill(3e6) })]),
    ));
    expect(c.kind).toBe('extension_known');
    expect(c.uses).toEqual([]);
    expect(c.reading).toMatch(/another organization|moved/);
  });

  it("a free agent signed by an organization his lines show held him during the season before is not an open-market price; where his lines cannot be read he is left out and it says why", () => {
    const earlier = EARLY([row(4, { firstSeason: 2038, years: 3, salaries: [1e6, 1e6, 1e6] }), row(5, { firstSeason: 2038, years: 3, salaries: [1e6, 1e6, 1e6] })]);
    const later = LATE([
      row(4, { teamId: 2, orgId: 2, firstSeason: 2041, years: 3, salaries: [9e6, 9e6, 9e6] }),
      row(5, { teamId: 2, orgId: 2, firstSeason: 2041, years: 3, salaries: [9e6, 9e6, 9e6] }),
    ]);
    const p = observeChanges(earlier, later, { heldDuring: (id, org, season) => (id === 4 ? org === 2 && season === 2040 : null) });
    const byId = new Map(p.changes.map((c) => [c.playerId, c]));
    expect(byId.get(4)!.kind).toBe('retained_at_free_agency');
    expect(byId.get(4)!.uses).toEqual([]);
    expect(byId.get(4)!.reading).toMatch(/lines/);
    expect(byId.get(5)!.uses).not.toContain('price');
    expect(byId.get(5)!.left).toMatch(/cannot be read/);
  });

  it('a term that now ends no later than it did is a term changed within its seasons, never an extension', () => {
    const p = observe(
      EARLY([row(1, { firstSeason: 2038, years: 4, salaries: [5e6, 5e6, 5e6, 8e6] }), row(2, { firstSeason: 2039, years: 4, salaries: Array(4).fill(3e6) })]),
      LATE([row(1, { firstSeason: 2041, years: 1, salaries: [2e6] }), row(2, { firstSeason: 2039, years: 3, salaries: Array(3).fill(3e6) })]),
    );
    for (const c of p.changes) {
      expect(c.kind).toBe('term_changed');
      expect(c.reading).toMatch(/option declined|buyout|opt-out/);
      expect(c.reading).toMatch(/does not say which/);
      expect(c.uses).toEqual([]);
    }
  });

  it('a club change between rows with no exported terms says how he moved is not in the export, never "the same terms"', () => {
    const noTerm = (id: number, club: number) => row(id, { teamId: club, orgId: club, kind: null, firstSeason: 2040, years: 0, salaries: [], rights: null, production: null });
    const c = only(observe(EARLY([noTerm(1, 1)]), LATE([noTerm(1, 3)])));
    expect(c.reading).not.toMatch(/same terms/);
    expect(c.reading).toMatch(/not in the export/);
    expect(c.uses).toEqual([]);
  });

  it('a major-league deal from his own organization after a row with no term is his organization adding him, never a standing not recorded', () => {
    const c = only(observe(
      EARLY([row(1, { teamId: 101, orgId: 1, kind: null, firstSeason: 2040, years: 0, salaries: [], rights: null, production: null })]),
      LATE([row(1, { teamId: 1, orgId: 1, firstSeason: 2041, years: 1, salaries: [MIN] })]),
    ));
    expect(c.kind).toBe('own_organization');
  });

  it('a controlled player missing from the later record is described as held by no club in this league', () => {
    const c = only(observe(EARLY([row(1, { rights: standingFor('arbitration', { low: 1, high: 1 }) })]), LATE([])));
    expect(c.kind).toBe('not_retained');
    expect(c.reading).toMatch(/this league/);
  });
});

describe('phase 4b review: two timelines are never compared (R3-05)', () => {
  it('an import dated at or before the one recorded before it starts a new timeline; nothing is compared across it and what the superseded imports observed of the same period is left out', () => {
    const t = contractTimeline([
      { gameDate: '2040-07-01', seq: 1 }, { gameDate: '2041-05-01', seq: 2 }, { gameDate: '2041-04-20', seq: 3 }, { gameDate: '2041-06-01', seq: 4 },
    ], [], null);
    expect(t.pairs).toEqual([{ earlier: '2041-04-20', later: '2041-06-01' }]);
    expect(t.superseded).toEqual(['2041-05-01']);
    expect(t.text).toMatch(/went back/);
  });

  it('a re-import of a date already recorded whose play differs breaks the timeline after it; imports later than the export are not read', () => {
    const t = contractTimeline([
      { gameDate: '2040-07-01', seq: 1 }, { gameDate: '2040-08-01', seq: 2 }, { gameDate: '2040-09-01', seq: 3 },
    ], [{ afterSeq: 2, gameDate: '2040-08-01', reason: 'play differs' }], null);
    expect(t.pairs).toEqual([{ earlier: '2040-07-01', later: '2040-08-01' }]);
    expect(t.text).toMatch(/2040-08-01/);
    const back = contractTimeline([{ gameDate: '2040-07-01', seq: 1 }, { gameDate: '2040-09-01', seq: 2 }], [], '2040-08-01');
    expect(back.pairs).toEqual([]);
    expect(back.superseded).toEqual(['2040-09-01']);
  });
});

/** A winter of free-agent signings with one-year deals, and what each produced in that first season (a factor of what was expected). */
function reviewWinter(n: number, perWin: (i: number) => number, wins = (i: number) => 1 + (i % 4) * 0.5) {
  const pair = marketWinter(n, perWin, wins);
  const realized = new Map(pair.changes.map((c) => [c.playerId, c.firstWins ?? null]));
  return { pair, realized: (factor = 1) => (id: number, season: number) => (season === 2041 && realized.get(id) != null ? (realized.get(id) as number) * factor : null) };
}

describe('phase 4b review: the measured price read like the opening one (R4-01, R4-02, R4-03, R4-05, R4-07, R4-09, R4-11)', () => {
  const opening = (): PriceOfWin => openingPriceFixture();

  it('is a set of bases, each with its sampling: per win projected at signing (over the deal, and in the first season) and, once the first season is completed, per win he produced in it', () => {
    const w = reviewWinter(40, (i) => 5e6 + (i % 5) * 0.2e6);
    const before = measurePriceOfWin({ pairs: [w.pair], imports: 2, replacement: null });
    const ids = before.bases.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['whole', 'first', 'realized']));
    expect(before.bases.find((b) => b.id === 'realized')!.status).toBe('not_computed');
    expect(before.bases.find((b) => b.id === 'first')!.unit).toBe('projected');
    const after = measurePriceOfWin({ pairs: [w.pair], imports: 3, replacement: null, realized: w.realized(0.5) });
    const realized = after.bases.find((b) => b.id === 'realized')!;
    expect(realized.status).toBe('measured');
    expect(realized.unit).toBe('realized');
    // Half the wins realized: twice the price per realized win. Since the owner's decision (2026-09-24) the price is the
    // realized reading alone; the projected reading is its check, beside it
    expect(realized.central!).toBeCloseTo(2 * after.bases.find((b) => b.id === 'first')!.central!, -4);
    expect(after.price.value).toEqual({ central: realized.central, low: realized.low, high: realized.high });
    expect(after.check!.central!).toBeLessThan(realized.central!);
  });

  it('never replaces the opening price by changing what it measures: without the realized reading it stays, naming both units', () => {
    const w = reviewWinter(120, (i) => 6e6 + (i % 3) * 0.1e6);
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 2, replacement: null });
    // Owner, 2026-09-24: the price is per win produced; without that reading it is not measured, the projected reading its check
    expect(m.status).toBe('not_measured');
    expect(m.check!.status).toBe('measured');
    const inForce = adoptPrice(opening(), m);
    expect(inForce.stage).toBe('opening');
    expect(inForce.adoption!.reason).toMatch(/projected at signing/);
    expect(inForce.adoption!.reason).toMatch(/per win produced/);
  });

  it('with the realized reading, the signings covering the class and a narrower band, it replaces the opening price and names the unit', () => {
    const w = reviewWinter(120, (i) => 6e6 + (i % 3) * 0.1e6);
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 3, replacement: null, realized: w.realized(1) });
    const inForce = adoptPrice(opening(), m);
    expect(inForce.stage).toBe('measured');
    expect(inForce.adoption!.reason).toMatch(/narrower than the opening band/);
    expect(inForce.adoption!.reason).toMatch(/per win produced/);
    expect(inForce.adoption!.reason).toMatch(/projected at signing/);
    expect(inForce.stamps.bases.basis).toMatch(/Observed signings/);
  });

  it('a winter of cheap deals alone never sets the price: the signings must cover each third of the free-agent class', () => {
    // The class spans 0.5 to 4 expected wins; only the players expected under 1 win sign elsewhere
    const before: ContractSnapshotRow[] = [];
    const after: ContractSnapshotRow[] = [];
    for (let i = 0; i < 200; i += 1) {
      const w = 0.5 + (i % 8) * 0.5;
      const b = row(3000 + i, { teamId: 1 + (i % 4), orgId: 1 + (i % 4) });
      b.production!.seasons[1] = { season: 2041, central: w, low: w - 0.5, high: w + 0.5, opportunities: 500 };
      before.push(b);
      after.push(w < 1 ? row(3000 + i, { teamId: 5, orgId: 5, firstSeason: 2041, salaries: [MIN + 4e6 * w] }) : b);
    }
    const pair = observe(EARLY(before), LATE(after));
    const priced = pair.changes.filter((c) => c.uses.includes('price'));
    expect(priced.length).toBeGreaterThanOrEqual(OPENING_PRICE_MINIMUMS.contracts);
    const m = measurePriceOfWin({ pairs: [pair], imports: 3, replacement: null, realized: (id, s) => (s === 2041 ? priced.find((c) => c.playerId === id)?.firstWins ?? null : null) });
    expect(m.coverage.enough).toBe(false);
    const inForce = adoptPrice(opening(), m);
    expect(inForce.stage).toBe('opening');
    expect(inForce.adoption!.reason).toMatch(/third/);
  });

  it('a measured central below the opening floor is flagged in the reason', () => {
    const w = reviewWinter(120, () => 1e6);
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 3, replacement: null, realized: w.realized(1) });
    const o = opening();
    expect(m.price.value!.central).toBeLessThan(o.floor.value!.low);
    expect(adoptPrice(o, m).adoption!.reason).toMatch(/below the opening('s)? floor/);
  });

  it('an opening band whose sampling has no upper edge is wider than any bounded band; a basis whose resampling fails is unbounded, never dropped (R3-07, R4-04)', () => {
    expect(samplingComparable({ low: 4e6, high: 6e6 }, [{ low: 3.5e6, high: 7e6 }, null])).toBeNull();
    expect(samplingComparable({ low: 4e6, high: 6e6 }, [{ low: 3.5e6, high: null }])).toBeNull();
    expect(samplingComparable({ low: 4e6, high: 6e6 }, [{ low: 3.5e6, high: 7e6 }])).toEqual({ low: 3.5e6, high: 7e6 });
    const o = opening();
    const unbounded: PriceOfWin = { ...o, sampling: { ...o.sampling!, comparable: null, text: 'unbounded' } };
    const w = reviewWinter(60, (i) => 4e6 + (i % 7) * 1.5e6);
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 3, replacement: null, realized: w.realized(1) });
    const inForce = adoptPrice(unbounded, m);
    expect(inForce.stage).toBe('measured');
    expect(inForce.adoption!.reason).toMatch(/no upper edge/);
  });

  it('two winters at different prices are resampled by winter, so the band holds both winters and a moving price is not shown as a precise one (R4-05)', () => {
    const w1 = marketWinter(60, () => 4e6);
    const w2 = observe(snap('2041-07-01', 2041, 0.5, w1.changes.map((c) => row(c.playerId + 500, {
      production: { status: 'projected', label: 't', seasons: [{ season: 2042, central: 2, low: 1, high: 3, opportunities: 500 }] },
      rights: [{ season: 2042, standing: 'free_agency', between: [], trip: null, tripIfEligible: null }],
    }))), snap('2042-05-01', 2042, 0.2, w1.changes.map((c) => row(c.playerId + 500, { teamId: 7, orgId: 7, firstSeason: 2042, salaries: [MIN + 8e6 * 2] }))));
    const pooled = measurePriceOfWin({ pairs: [w1, w2], imports: 4, replacement: null });
    const first = pooled.bases.find((b) => b.id === 'first')!;
    expect(first.low!).toBeLessThanOrEqual(4.2e6);
    expect(first.high!).toBeGreaterThanOrEqual(7.6e6);
    expect(first.text).toMatch(/by winter/);
  });

  it('a deal running past the projection\'s horizon is left out of the whole-deal basis and counted; the largest signing\'s share of the money is shown (R4-07)', () => {
    const w = reviewWinter(30, () => 5e6);
    const long = w.pair.changes[0];
    long.pastHorizon = true;
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 2, replacement: null });
    const whole = m.bases.find((b) => b.id === 'whole')!;
    expect(whole.signings).toBe(29);
    expect(whole.text).toMatch(/past the projection/);
    expect(whole.text).toMatch(/largest/);
  });

  it('the band says it is a sampling band that covers less than its share at a few dozen signings (R4-09)', () => {
    const w = reviewWinter(30, () => 5e6);
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 3, replacement: null, realized: w.realized(1) });
    expect(m.text).toMatch(/covers less than/);
  });
});

describe('phase 4b review: replacement never changes the unit (R3-06, R4-06); awards scored with their sharpness (R4-08, R3-10)', () => {
  it('a measured replacement level leaves the measured price in the export\'s WAR, and is shown with who it rests on', () => {
    const pair = marketWinter(30, () => 5e6);
    const base = measurePriceOfWin({ pairs: [pair], imports: 3, replacement: null, realized: realizedOf(pair) });
    const replacement = measureReplacement(
      Array.from({ length: 40 }, (_, i) => ({ playerId: 9000 + i, orgId: 1, firstSeason: 2041, how: 'minor_league_deal' as const, gameDate: '2041-05-01' })),
      new Map(Array.from({ length: 35 }, (_, i) => [9000 + i, { war: 0.4, opportunities: 200 }])),
    );
    expect(replacement.status).toBe('measured');
    expect(replacement.text).toMatch(/5 of 40|did not play/);
    expect(replacement.text).toMatch(/only (the )?pickups who played|who played/);
    const withIt = measurePriceOfWin({ pairs: [pair], imports: 3, replacement, realized: realizedOf(pair) });
    expect(withIt.price.value!.central).toBeCloseTo(base.price.value!.central, 0);
    expect(withIt.text).toMatch(/export's (own )?WAR/);
  });

  it('coverage is reported beside the width of the bands scored; an award with no trip is counted apart, and a trip beyond the top class is read in the top class', () => {
    const arb = (id: number, trip: { low: number; high: number } | null) => row(id, { rights: standingFor('arbitration', trip), nextCost: { season: 2041, low: 2e6, high: 8e6, method: 'arbitration_ladder', source: 'measured' } });
    const earlier = EARLY([arb(1, { low: 4, high: 4 }), arb(2, null), ...Array.from({ length: 31 }, (_, i) => arb(10 + i, { low: 4, high: 4 }))]);
    const later = LATE([row(1, { firstSeason: 2041, salaries: [3e6] }), row(2, { firstSeason: 2041, salaries: [3e6] }), ...Array.from({ length: 31 }, (_, i) => row(10 + i, { firstSeason: 2041, salaries: [MIN + 1e6 + i * 0.1e6] }))]);
    const pair = observe(earlier, later);
    const s = scoreAwards([pair], { status: 'arbitration', classes: 3, mlb: false });
    expect(s.sharpness.medianRatio).toBeCloseTo(4, 5);
    expect(s.text).toMatch(/wide|width/);
    expect(s.unclassed).toBe(1);
    expect(s.byClass.map((c) => c.arbitrationClass)).toEqual([3]);
    const r = awardReadings([pair], (id) => (id % 7) * 0.5, 6e6, 3);
    expect(r.readings.map((x) => x.arbitrationClass)).toEqual([3]);
    expect(r.readings[0].status).toBe('measured');
    expect(r.text).toMatch(/top class|class 3/);
    expect(r.leftOut).toBe(1);
  });
});

// ── phase 4 owner decisions (2026-09-24): each case written before its code ──

describe('owner decision 1 (2026-09-24): the price of a win in force is per win produced', () => {
  const opening = (): PriceOfWin => openingPriceFixture();

  it('once measured, its central and band are the realized reading alone; the per-projected-win reading is its check, with the ratio, never in the band', () => {
    // Signings priced at $6M per expected win who produce 0.6 of it: $10M per win produced
    const w = reviewWinter(120, (i) => 6e6 + (i % 3) * 0.1e6);
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 3, replacement: null, realized: w.realized(0.6) });
    const realized = m.bases.find((b) => b.id === 'realized')!;
    expect(m.status).toBe('measured');
    expect(m.price.value).toEqual({ central: realized.central, low: realized.low, high: realized.high });
    // The projected readings sit well below it and are never inside the price's band
    const first = m.bases.find((b) => b.id === 'first')!;
    expect(first.high!).toBeLessThan(m.price.value!.low);
    expect(m.check).toBeTruthy();
    expect(m.check!.unit).toBe('projected');
    expect(m.check!.ratio!).toBeCloseTo(m.check!.central! / realized.central!, 6);
    expect(m.check!.text).toMatch(/check/i);
    expect(m.text).toMatch(/per win produced/);
    // In force, the price, its rules and the reason all say per win produced; the projected reading is named as the check
    const inForce = adoptPrice(opening(), m);
    if (inForce.stage === 'measured') {
      expect(inForce.price.value).toEqual(m.price.value);
      expect(inForce.rules.central).toMatch(/per win produced/);
      expect(inForce.rules.band).toMatch(/per win produced/);
      expect(inForce.rules.central).not.toMatch(/until the owner/);
    }
    expect(inForce.adoption!.reason).toMatch(/per win produced/);
    expect(inForce.adoption!.reason).toMatch(/check/);
  });

  it('before the realized reading exists, nothing is in force from the signings: the measured price is not measured and says it waits, with the check shown', () => {
    const w = reviewWinter(60, () => 5e6);
    const m = measurePriceOfWin({ pairs: [w.pair], imports: 2, replacement: null });
    expect(m.status).toBe('not_measured');
    expect(m.price.value).toBeNull();
    expect(m.price.note).toMatch(/per win produced/);
    expect(m.price.note).toMatch(/completed/);
    expect(m.check!.status).toBe('measured');
    expect(m.check!.central!).toBeGreaterThan(0);
    expect(m.check!.ratio).toBeNull();
    const inForce = adoptPrice(opening(), m);
    expect(inForce.stage).toBe('opening');
  });
});

describe('owner decision 3 (2026-09-24): an observed arbitration salary below the previous salary contradicts the owner-attested rule', () => {
  it('is flagged, counted and named, never silently absorbed', () => {
    const cost = { season: 2041, low: 2e6, high: 9e6, method: 'arbitration_ladder', source: 'measured' };
    // Each held a one-year 2040 deal at $5M; two are paid less for 2041
    const before = [1, 2, 3, 4].map((id) => row(id, { salaries: [5e6], rights: standingFor('arbitration', { low: 2, high: 2 }), nextCost: cost }));
    const after = [row(1, { firstSeason: 2041, salaries: [4e6] }), row(2, { firstSeason: 2041, salaries: [3.5e6] }), row(3, { firstSeason: 2041, salaries: [5e6] }), row(4, { firstSeason: 2041, salaries: [6e6] })];
    const pair = observe(EARLY(before), LATE(after));
    const awards = pair.changes.filter((c) => c.kind === 'arbitration_salary');
    expect(awards).toHaveLength(4);
    expect(awards.find((c) => c.playerId === 1)!.previousSalary).toBe(5e6);
    const s = scoreAwards([pair], { status: 'arbitration', classes: 3, mlb: false }, (id) => `Player ${id} Name`);
    expect(s.belowPrevious.map((b) => b.playerId)).toEqual([1, 2]);
    expect(s.text).toMatch(/2 (observed )?arbitration salaries/);
    expect(s.text).toMatch(/owner-attested/);
    expect(s.text).toMatch(/Player 1 Name/);
    expect(s.text).toMatch(/Player 2 Name/);
    // Still scored: flagged, not dropped
    expect(s.scored).toBe(4);
  });

  it('where the previous salary is not in the earlier record, nothing is flagged and the count says how many could not be checked', () => {
    const cost = { season: 2041, low: 2e6, high: 9e6, method: 'arbitration_ladder', source: 'measured' };
    const pair = observe(EARLY([row(1, { salaries: [null], rights: standingFor('arbitration', { low: 2, high: 2 }), nextCost: cost })]), LATE([row(1, { firstSeason: 2041, salaries: [3e6] })]));
    const s = scoreAwards([pair], { status: 'arbitration', classes: 3, mlb: false });
    expect(s.belowPrevious).toEqual([]);
    expect(s.previousUnknown).toBe(1);
  });
});
