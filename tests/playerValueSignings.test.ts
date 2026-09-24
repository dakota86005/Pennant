import { describe, expect, it } from 'vitest';
import {
  adoptPrice, awardReadings, freeAcquisitions, measurePriceOfWin, measureReplacement, observeChanges, reserveRenewals, scoreAwards,
  type ContractSnapshot, type ContractSnapshotRow, type WinterPair,
} from '../server/playerValueSignings.js';
import { openingPriceOfWin, type PriceOfWin } from '../server/playerValueFinances.js';
import { OPENING_PRICE_MINIMUMS, SIGNINGS_POLICY } from '../server/playerValueCalibration.js';

/*
 * Phase 4b: the measured price of a win across imports (PLAYER_VALUE.md 4.2 to 4.4, BEHAVIOR_CASES.md "Player Value",
 * phase 4b). Pure: two snapshots of the save's contracts, as the import recorded them, are compared; every change is
 * named for what changed and read through Player Rights' answer at the earlier import, never given a transaction type
 * the export does not carry (D-020). The price, the awards, the reserve-clause renewals and the replacement level are
 * measured from those readings only.
 */

const MIN = 700_000;

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
  return observeChanges(EARLY(before), LATE(after));
}

describe('observed changes: named for what changed, read through Player Rights at the earlier import (D-020)', () => {
  it('a contract whose club changed on the same terms moved with him: it is never a signing', () => {
    const c = only(observeChanges(EARLY([row(1, { years: 3, salaries: [MIN, MIN, MIN] })]), LATE([row(1, { teamId: 4, orgId: 4, years: 3, salaries: [MIN, MIN, MIN] })])));
    expect(c.kind).toBe('transferred');
    expect(c.uses).toEqual([]);
    expect(c.reading).toMatch(/does not say/);
    expect(c.changed).toMatch(/club 1 → 4/);
  });

  it("a free-agency-eligible player's new deal with a club that did not hold him is a free-agent market signing, priced on his expected wins at the earlier import", () => {
    const c = only(observeChanges(EARLY([row(1)]), LATE([row(1, { teamId: 3, orgId: 3, firstSeason: 2041, years: 2, salaries: [5_700_000, 6_700_000] })])));
    expect(c.kind).toBe('free_agent_signing');
    expect(c.uses).toContain('price');
    // Salary above the minimum over the expected wins of the seasons it covers, both read at the earlier import
    expect(c.money).toBeCloseTo(5_000_000 + 6_000_000);
    expect(c.wins).toBeCloseTo(2 + 1.8);
    expect(c.pricedSeasons).toBe(2);
    expect(c.changed).toMatch(/first season 2040 → 2041/);
  });

  it('a free agent who stays with the club that held him is named, counted and left out of the price: whether he reached the market first is not in the export', () => {
    const p = observeChanges(EARLY([row(1)]), LATE([row(1, { firstSeason: 2041, years: 3, salaries: [9e6, 9e6, 9e6] })]));
    const c = only(p);
    expect(c.kind).toBe('retained_at_free_agency');
    expect(c.uses).toEqual([]);
    expect(c.left).toMatch(/not in the export|does not say/);
    expect(p.counts.retained_at_free_agency).toBe(1);
  });

  it('a one-year deal with his club for a player in arbitration is an arbitration salary (award or settlement, unstated); at the minimum it is not read as one', () => {
    const arb = standingFor('arbitration', { low: 2, high: 2 });
    const earlier = EARLY([row(1, { rights: arb, nextCost: { season: 2041, low: 2e6, high: 6e6, method: 'arbitration_ladder', source: 'measured' } }), row(2, { rights: arb })]);
    const p = observeChanges(earlier, LATE([row(1, { firstSeason: 2041, salaries: [4e6] }), row(2, { firstSeason: 2041, salaries: [MIN] })]));
    const byId = new Map(p.changes.map((c) => [c.playerId, c]));
    expect(byId.get(1)!.kind).toBe('arbitration_salary');
    expect(byId.get(1)!.reading).toMatch(/award or (a )?settlement/i);
    expect(byId.get(1)!.uses).toContain('awards');
    expect(byId.get(1)!.arbitrationClass).toEqual({ low: 2, high: 2 });
    expect(byId.get(2)!.kind).toBe('arbitration_at_minimum');
    expect(byId.get(2)!.uses).toEqual([]);
  });

  it('a one-year deal before arbitration is a renewal; under a reserve clause it is a reserve-clause renewal', () => {
    const p = observeChanges(
      EARLY([row(1, { rights: standingFor('pre_arbitration') }), row(2, { rights: standingFor('reserve_clause') })]),
      LATE([row(1, { firstSeason: 2041, salaries: [MIN + 20_000] }), row(2, { firstSeason: 2041, salaries: [1_500_000] })]),
    );
    const byId = new Map(p.changes.map((c) => [c.playerId, c]));
    expect(byId.get(1)!.kind).toBe('renewal');
    expect(byId.get(2)!.kind).toBe('reserve_clause_renewal');
    expect(byId.get(2)!.uses).toContain('reserve');
  });

  it('a longer deal with his club while controlled, or a new deal over seasons his contract still covered, is an extension; one already signed at the earlier import is not observed as new', () => {
    const p = observeChanges(
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
    const c = only(observeChanges(
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
    const c = only(observeChanges(
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
    const p = observeChanges(
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
    const c = only(observeChanges(snap('2040-07-01', 2040, 0.5, [row(1, { teamId: null, orgId: null, kind: null, firstSeason: null, years: null, salaries: [], rights: null })]),
      snap('2040-08-01', 2040, 0.7, [row(1, { teamId: 3, orgId: 3, firstSeason: 2040, salaries: [2e6] })])));
    expect(c.kind).toBe('free_agent_signing');
    expect(c.uses).not.toContain('price');
    expect(c.left).toMatch(/under way/);
  });

  it('imports inside one season observe no winter; imports across a rollover do', () => {
    expect(observeChanges(snap('2040-07-01', 2040, 0.5, []), snap('2040-08-01', 2040, 0.7, [])).spansWinter).toBe(false);
    expect(observeChanges(EARLY([]), LATE([])).spansWinter).toBe(true);
    // An import before Opening Day and one after the season began span the end of that winter
    expect(observeChanges(snap('2041-03-01', 2041, 0, []), LATE([])).spansWinter).toBe(true);
  });
});

describe('the measured price of a win (ratio of sums, resampled band)', () => {
  it('is salary above the minimum over expected wins, summed over the free-agent signings, with a band that holds it', () => {
    const pair = marketWinter(30, (i) => 5e6 + (i % 5) * 0.4e6);
    const m = measurePriceOfWin({ pairs: [pair], imports: 2, replacement: null });
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
    const small = measurePriceOfWin({ pairs: [marketWinter(20, price)], imports: 2, replacement: null });
    const large = measurePriceOfWin({ pairs: [marketWinter(80, price)], imports: 2, replacement: null });
    const width = (m: typeof small) => m.price.value!.high - m.price.value!.low;
    expect(width(small)).toBeGreaterThan(width(large));
  });

  it('with one import, or none across a winter, nothing is measured and it says precisely what is missing', () => {
    const one = measurePriceOfWin({ pairs: [], imports: 1, importDates: ['2026-05-16'], replacement: null });
    expect(one.status).toBe('no_off_season');
    expect(one.price.note).toMatch(/No off-season observed yet: the measured price needs two imports across a winter/);
    expect(one.price.note).toMatch(/1 import recorded \(2026-05-16\)/);
    const sameSeason = measurePriceOfWin({ pairs: [observeChanges(snap('2040-07-01', 2040, 0.5, []), snap('2040-08-01', 2040, 0.7, []))], imports: 2, replacement: null });
    expect(sameSeason.status).toBe('no_off_season');
  });

  it("once replacement is measured from freely available talent, a signing's wins are counted above that level, and it says so", () => {
    const pair = marketWinter(30, () => 5e6);
    const base = measurePriceOfWin({ pairs: [pair], imports: 2, replacement: null });
    const replacement = { status: 'measured' as const, per600: { value: { central: 0.6, low: 0.3, high: 0.9 }, source: 'x', provenance: 'derived' as const }, players: 40, opportunities: 9000, war: 9, text: 'measured', stamp: SIGNINGS_POLICY_STAMP() };
    const above = measurePriceOfWin({ pairs: [pair], imports: 2, replacement: replacement as never });
    // Fewer wins above a higher level: the same money buys fewer of them
    expect(above.price.value!.central).toBeGreaterThan(base.price.value!.central);
    expect(above.text).toMatch(/above .*freely available/);
    expect(base.text).toMatch(/export's (own )?WAR/);
  });
});

function SIGNINGS_POLICY_STAMP() {
  return { status: 'policy' as const, basis: 'test', run: null };
}

describe('adoption (owner Q-4): the measured price replaces the opening one only when its band is narrower', () => {
  const opening = (): PriceOfWin => {
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
  };

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
    const m = measurePriceOfWin({ pairs: [marketWinter(120, (i) => 6e6 + (i % 3) * 0.1e6)], imports: 2, replacement: null });
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
    const m = measurePriceOfWin({ pairs: [marketWinter(21, (i) => (i % 2 === 0 ? 1e6 : 30e6))], imports: 2, replacement: null });
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
    return observeChanges(EARLY(before), LATE(after));
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
    const readings = awardReadings([many, few], (id) => (id % 7) * 0.5, 6e6);
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
      return observeChanges(EARLY(before), LATE(after));
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
