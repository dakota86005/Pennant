import { describe, expect, it } from 'vitest';
import { COST_PENDING_OBSERVED_PAY, COST_POLICY } from '../server/playerValueCalibration.js';
import { measureCostLadder, priceControlTimeline, type CostLadder, type CostLadderInput } from '../server/playerValueCost.js';
import type { ControlSeason, ControlTimeline, CostBand } from '../server/playerValueControl.js';
import type { MarketCandidate, PriceBand, SeasonWar } from '../server/playerValueFinances.js';
import type { PlayerProduction } from '../server/playerValueProduction.js';
import { arbitrationRegimeOf } from '../server/playerRights.js';
import type { ContractRules } from '../server/leagueRules.js';
import { derivedFrom, fromExport, unknownBecause, type Sourced } from '../server/provenance.js';
import {
  THIS_SEASON, YEAR, contractRow, factsOf, mlbRules, seasonOf, stateOf, tablesOf, timelineOf,
} from './playerValueFixtures.js';

/*
 * Player Value, concern 2's cost bands and concern 1's contract facts (docs/BEHAVIOR_CASES.md
 * "Player Value", playerValueCost.test.ts, phases 1 to 4a). Phase 1 built the facts and the cost of a
 * contract season. Phase 4a prices the controlled seasons no contract covers: a pre-arbitration renewal
 * from the league minimum to the save's own renewal pay, and an arbitration season from the save's own
 * arbitration ladder, the platform seasons' projected production and the price of a win. Every case is
 * built from synthetic evidence through the pure functions that own the answer; none names a player.
 */

const NEXT = THIS_SEASON + 1;
const MINIMUM = 780_000;
const expiring = factsOf(contractRow({ years: 1, salary: MINIMUM }));
const PRICE: PriceBand = { central: 7_000_000, low: 6_000_000, high: 9_000_000 };
const CLOCK = 40;

// ── synthetic cross-sections ─────────────────────────────────────────────────

interface CaseSpec {
  /** Service at the last winter, in days. */
  winter: number;
  salary: number;
  /** Platform WAR: last season and the season before it. */
  war?: [number, number];
  years?: number;
  firstSeason?: number;
}

let nextId = 1000;

/** A major leaguer on the roster, his contract and his Player Rights answer, as the market reads him. */
function candidateOf(spec: CaseSpec, rules: ContractRules): MarketCandidate & { war: [number, number] } {
  const playerId = nextId;
  nextId += 1;
  const contract = factsOf(contractRow({ years: spec.years ?? 1, salary: spec.salary, firstSeason: spec.firstSeason ?? THIS_SEASON }));
  const control = timelineOf({ state: { ...stateOf({ days: spec.winter + CLOCK, thisYear: CLOCK }), playerId }, contract, rules, clock: CLOCK });
  return { playerId, contract: { ...contract, playerId }, control: { ...control, playerId }, war: spec.war ?? [0, 0] };
}

/** Class c's service at the winter: c − 1 years past the arbitration line, and some days. */
const classDays = (c: number, extra = 20) => (2 + c) * YEAR + extra;

/** n arbitration contracts of class c: pay = minimum + base + perWin × platform, around the line. */
function arbitrationClass(c: number, n: number, base: number, perWin: number, over: Partial<CaseSpec> = {}): CaseSpec[] {
  return Array.from({ length: n }, (_, i) => {
    const platform = (i % 13) * 0.5;
    const noise = ((i % 5) - 2) * 100_000;
    return { winter: classDays(c, 20 + (i % 7)), salary: Math.round(MINIMUM + base + perWin * platform + noise), war: [platform, platform] as [number, number], ...over };
  });
}

/** n pre-arbitration one-year renewals: most at the minimum, some a little above. */
function renewals(n: number, above: number[] = [5_000, 10_000, 20_000, 60_000]): CaseSpec[] {
  return Array.from({ length: n }, (_, i) => ({ winter: YEAR + 10 + (i % 50), salary: MINIMUM + (i % 4 === 0 ? above[(i / 4) % above.length] : 0) }));
}

interface LadderSpec {
  rules?: ContractRules;
  price?: Sourced<PriceBand>;
  minimum?: Sourced<number>;
  financials?: Sourced<boolean>;
}

function ladderOf(specs: CaseSpec[], opts: LadderSpec = {}): { ladder: CostLadder; input: CostLadderInput } {
  const rules = opts.rules ?? mlbRules();
  const made = specs.map((s) => candidateOf(s, rules));
  const war = new Map<number, SeasonWar>();
  for (const [k, season] of [[0, THIS_SEASON - 1], [1, THIS_SEASON - 2]] as const) {
    const byPlayer = new Map(made.map((m) => [m.playerId, m.war[k]]));
    war.set(season, { season, byPlayer, total: [...byPlayer.values()].reduce((a, b) => a + b, 0), clubs: new Set([1]), source: 'test' });
  }
  const input: CostLadderInput = {
    leagueId: 203,
    season: THIS_SEASON,
    financials: opts.financials ?? fromExport(true, 'leagues.rules_financials'),
    minimumSalary: opts.minimum ?? fromExport(MINIMUM, 'leagues.rules_minimum_salary'),
    regime: arbitrationRegimeOf(rules),
    price: opts.price ?? derivedFrom(PRICE, 'test'),
    candidates: made.map(({ war: _war, ...c }) => c),
    war,
    seasonShares: new Map([[THIS_SEASON - 1, derivedFrom(1, 'test')], [THIS_SEASON - 2, derivedFrom(1, 'test')]]),
  };
  return { ladder: measureCostLadder(input), input };
}

/** A thick save: every arbitration class and the renewals measured well past the policy minimum. */
const THICK: CaseSpec[] = [
  ...renewals(80),
  ...arbitrationClass(1, 60, 400_000, 1_000_000),
  ...arbitrationClass(2, 60, 1_000_000, 2_000_000),
  ...arbitrationClass(3, 60, 1_500_000, 3_000_000),
];

// ── the player being priced ──────────────────────────────────────────────────

/** A production answer with the same band every season (wins), or unknown. */
function productionOf(band: { low: number; central: number; high: number } | null, opts: { notEstablishedFrom?: number } = {}): PlayerProduction {
  if (band === null) {
    return { playerId: 1, status: 'unknown', reason: 'No evidence (test).', unit: 'WAR', seasons: [], notEstablished: [], basis: {} } as unknown as PlayerProduction;
  }
  const last = opts.notEstablishedFrom ?? THIS_SEASON + 7;
  const seasons = Array.from({ length: 7 }, (_, i) => THIS_SEASON + i).filter((y) => y < last).map((season) => ({
    season, horizon: season - THIS_SEASON, age: 27, wins: { ...band }, inner: { ...band }, toDate: null, remaining: null, sides: [], notes: [],
    coverage: { horizon: 0, target: { outer: 0.8, inner: 0.5 }, observed: null, note: 'test' },
  }));
  const notEstablished = Array.from({ length: 7 }, (_, i) => THIS_SEASON + i).filter((y) => y >= last)
    .map((season) => ({ season, horizon: season - THIS_SEASON, age: 27, reason: 'Not established (test).' }));
  return { playerId: 1, status: 'projected', reason: null, unit: 'WAR', seasons, notEstablished, basis: {} } as unknown as PlayerProduction;
}

const STAR = { low: 3, central: 5, high: 7 };
const pastWins = (war: number | null) => (season: number) => (season === THIS_SEASON - 1 ? war : null);

function priced(control: ControlTimeline, ladder: CostLadder | null, production: PlayerProduction | null = productionOf(STAR), past: number | null = 4) {
  return priceControlTimeline({ control, production, ladder, pastWins: pastWins(past) });
}

/** A player in arbitration now (class c at the winter), his deal expiring: next season is arbitration too. */
const arbitrationPlayer = (c: number, rules?: ContractRules) =>
  timelineOf({ state: stateOf({ days: classDays(c, 60) + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK, rules });

const band = (s: ControlSeason): CostBand => {
  expect(s.cost, `season ${s.season} has a cost`).not.toBeNull();
  expect(s.cost!.value, `season ${s.season}: ${s.cost!.note}`).not.toBeNull();
  return s.cost!.value!;
};
const contains = (outer: CostBand, inner: CostBand) => {
  expect(outer.low).toBeLessThanOrEqual(inner.low + 1e-6);
  expect(outer.high).toBeGreaterThanOrEqual(inner.high - 1e-6);
};

// ── phase 1: contract facts and the cost of a contract season ────────────────

describe('Player Value: cost (phase 1)', () => {
  it("a reserve-clause renewal stays unknown until the save measures renewal pay, with the reason", () => {
    const t = timelineOf({ state: stateOf({ days: 10 * YEAR }), rules: mlbRules({ rules_fa_minimum_years: 0 }), contract: expiring });
    expect(seasonOf(t, NEXT).status).toBe('reserve_clause');
    expect(seasonOf(t, NEXT).cost!.value).toBeNull();
    expect(seasonOf(t, NEXT).cost!.note).toBe(COST_PENDING_OBSERVED_PAY);
    // Priced with a thick ladder, it is still unknown: renewal pay under a reserve clause is not measured
    const { ladder } = ladderOf(THICK, { rules: mlbRules({ rules_fa_minimum_years: 0 }) });
    const p = seasonOf(priced(t, ladder), NEXT);
    expect(p.cost!.value).toBeNull();
    expect(p.cost!.note).toMatch(/reserve clause/i);
    expect(p.cost!.note).not.toMatch(/phase 2/);
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
    // Pricing never touches a contract season
    const { ladder } = ladderOf(THICK);
    expect(priced(t, ladder).seasons.slice(0, 3).map((s) => s.cost?.value)).toEqual(t.seasons.slice(0, 3).map((s) => s.cost?.value));
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

// ── phase 4a: the cost of controlled seasons ─────────────────────────────────

describe('Player Value: the pre-arbitration renewal band (phase 4a)', () => {
  it("a pre-arbitration renewal costs from the league minimum to the save's own observed renewal pay", () => {
    const { ladder } = ladderOf(THICK);
    expect(ladder.preArbitration.status).toBe('measured');
    expect(ladder.preArbitration.cases).toBe(80);
    const measured = ladder.preArbitration.band.value!;
    expect(measured.low).toBe(MINIMUM);
    // Measured on the renewals, never simply the minimum, never past the most any renewal was paid
    expect(measured.high).toBeGreaterThan(MINIMUM);
    expect(measured.high).toBeLessThanOrEqual(MINIMUM + 60_000);

    const t = priced(timelineOf({ state: stateOf({ days: 30, thisYear: 30 }), contract: expiring }), ladder);
    const renewal = seasonOf(t, NEXT);
    expect(renewal.status).toBe('pre_arbitration');
    expect(band(renewal)).toEqual(measured);
    expect(renewal.costBasis).toMatchObject({ method: 'renewal_spread', source: 'measured', cases: 80 });
    expect(renewal.cost!.note).toMatch(/80 .*renewals/);
  });

  it('a pre-arbitration renewal starts at the minimum the league states, and a missing minimum is unknown, never another league\'s', () => {
    const tenThousand = ladderOf(renewals(60).map((s) => ({ ...s, salary: s.salary - MINIMUM + 500_000 })), { minimum: fromExport(500_000, 'test') });
    expect(tenThousand.ladder.preArbitration.band.value!.low).toBe(500_000);
    const { ladder } = ladderOf(THICK, { minimum: unknownBecause('not_exported_by_ootp', 'leagues.rules_minimum_salary', 'blank') });
    expect(ladder.preArbitration.band.value).toBeNull();
    const renewal = seasonOf(priced(timelineOf({ state: stateOf({ days: 30, thisYear: 30 }), contract: expiring }), ladder), NEXT);
    expect(renewal.cost!.value).toBeNull();
    expect(renewal.cost!.note).toMatch(/minimum/);
  });

  it('a thin renewal class is the provisional prior widened by its own cases where the regime is MLB\'s, and unknown elsewhere', () => {
    const thin = ladderOf([...renewals(8, [400_000]), ...arbitrationClass(1, 60, 400_000, 1_000_000)]);
    expect(thin.ladder.preArbitration.status).toBe('provisional');
    const b = thin.ladder.preArbitration.band.value!;
    expect(b.low).toBe(MINIMUM);
    // Widened by its own cases: never narrower than the most a thin class's renewal was paid
    expect(b.high).toBeGreaterThanOrEqual(MINIMUM + 400_000);
    expect(thin.ladder.preArbitration.text).toMatch(/provisional/i);
    const elsewhere = ladderOf(renewals(8), { rules: mlbRules({ rules_fa_minimum_years: 7 }) });
    expect(elsewhere.ladder.preArbitration.band.value).toBeNull();
    expect(elsewhere.ladder.preArbitration.band.note).toMatch(/not MLB's|fewer than/);
  });
});

describe('Player Value: the arbitration ladder (phase 4a)', () => {
  it("an arbitration season never costs the league minimum and is never a point", () => {
    const { ladder } = ladderOf(THICK);
    expect(ladder.arbitration.status).toBe('measured');
    for (const past of [4, -2]) {
      for (const production of [productionOf(STAR), productionOf({ low: -1, central: 0, high: 0.5 })]) {
        const t = priced(arbitrationPlayer(1), ladder, production, past);
        const arbitration = t.seasons.filter((s) => s.status === 'arbitration');
        expect(arbitration.length).toBeGreaterThan(0);
        for (const s of arbitration) {
          const b = band(s);
          expect(b.low).toBeGreaterThan(MINIMUM);
          expect(b.high).toBeGreaterThan(b.low);
          expect(s.costBasis).toMatchObject({ method: 'arbitration_ladder', source: 'measured' });
        }
      }
    }
  });

  it('reads the ladder only from arbitration salaries: Player Rights\' arbitration status, one-year deals, and never a contract at the minimum', () => {
    const base = ladderOf(THICK).ladder;
    // Contracts at the minimum in the class, multi-year deals and pre-arbitration pay change nothing but the counts
    const noisy = ladderOf([
      ...THICK,
      ...Array.from({ length: 6 }, (_, i) => ({ winter: classDays(1, 30 + i), salary: MINIMUM, war: [-0.5, 0] as [number, number] })),
      ...Array.from({ length: 5 }, (_, i) => ({ winter: classDays(1, 30 + i), salary: 30_000_000, years: 5, war: [1, 1] as [number, number] })),
    ]).ladder;
    const one = (l: CostLadder) => l.arbitration.classes.find((c) => c.arbitrationClass === 1)!;
    expect(one(noisy).excluded.atMinimum).toBe(6);
    expect(one(noisy).cases).toBe(one(base).cases);
    expect(one(noisy).readings).toEqual(one(base).readings);
  });

  it("follows the platform: a better projected platform never lowers either edge", () => {
    const { ladder } = ladderOf(THICK);
    const low = seasonOf(priced(arbitrationPlayer(1), ladder, productionOf({ low: 0.5, central: 1, high: 2 }), 1), NEXT);
    const high = seasonOf(priced(arbitrationPlayer(1), ladder, productionOf({ low: 3, central: 5, high: 7 }), 5), NEXT);
    expect(band(high).low).toBeGreaterThanOrEqual(band(low).low);
    expect(band(high).high).toBeGreaterThanOrEqual(band(low).high);
    // The basis names the platform seasons; a measured line is in the import's dollars, so no price band is named (review R1-02)
    expect(high.costBasis!.platform!.seasons).toEqual([THIS_SEASON - 1, THIS_SEASON]);
    expect(high.costBasis!.price).toBeNull();
  });

  it('thinner evidence widens, never narrows: a wider production band, a wider price band or fewer contracts never narrow the cost band', () => {
    const { ladder } = ladderOf(THICK);
    const narrow = band(seasonOf(priced(arbitrationPlayer(2), ladder, productionOf({ low: 3, central: 4, high: 5 })), NEXT));
    const wide = band(seasonOf(priced(arbitrationPlayer(2), ladder, productionOf({ low: 1, central: 4, high: 7 })), NEXT));
    contains(wide, narrow);

    const widePrice = ladderOf(THICK, { price: derivedFrom({ central: 7_000_000, low: 5_000_000, high: 11_000_000 }, 'test') }).ladder;
    contains(band(seasonOf(priced(arbitrationPlayer(2), widePrice), NEXT)), band(seasonOf(priced(arbitrationPlayer(2), ladder), NEXT)));

    // The same pay on half as many contracts (each case once, not twice) reads at least as wide
    const once = [...renewals(40), ...arbitrationClass(1, 40, 400_000, 1_000_000), ...arbitrationClass(2, 40, 1_000_000, 2_000_000), ...arbitrationClass(3, 40, 1_500_000, 3_000_000)];
    const twice = [...once, ...once];
    const fewer = band(seasonOf(priced(arbitrationPlayer(2), ladderOf(once).ladder), NEXT));
    const more = band(seasonOf(priced(arbitrationPlayer(2), ladderOf(twice).ladder), NEXT));
    contains(fewer, more);
    expect(fewer.high - fewer.low).toBeGreaterThan(more.high - more.low);
  });

  it("a class measured on the save's own contracts is in the save's own dollars: the price of a win's band does not widen it a second time", () => {
    // The line was read on this import's salaries, so its dollars per platform win are observed; the price band is the
    // spread of the market's bases and has no second bearing on a measured line (supervisor, phase 4a review)
    const { ladder } = ladderOf(THICK);
    const widePrice = ladderOf(THICK, { price: derivedFrom({ central: 7_000_000, low: 5_000_000, high: 11_000_000 }, 'test') }).ladder;
    expect(band(seasonOf(priced(arbitrationPlayer(2), widePrice), NEXT))).toEqual(band(seasonOf(priced(arbitrationPlayer(2), ladder), NEXT)));
  });

  it('below the policy minimum a class is the provisional prior widened by the save\'s own cases, and says so, only where the regime is MLB\'s', () => {
    const minimum = COST_POLICY.ladder.minimumCases;
    const specs = [...renewals(80), ...arbitrationClass(1, minimum - 20, 400_000, 1_000_000), ...arbitrationClass(2, 60, 1_000_000, 2_000_000), ...arbitrationClass(3, 60, 1_500_000, 3_000_000)];
    const { ladder } = ladderOf(specs);
    const one = ladder.arbitration.classes.find((c) => c.arbitrationClass === 1)!;
    expect(one.status).toBe('thin');
    // No line is fitted on a thin class: the prior's reading, hulled with the range the save paid it (review R1-01, R2-02)
    expect(one.readings.map((r) => r.source)).toEqual(['prior']);
    expect(one.observed).toMatchObject({ cases: minimum - 20 });
    expect(ladder.arbitration.status).toBe('partly_provisional');
    // 150 days at the winter: pre-arbitration, then the Super Two window, then arbitration 1–2
    const t = priced(timelineOf({ state: stateOf({ days: 150 + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK }), ladder);
    const first = t.seasons.find((s) => s.status === 'arbitration' && s.arbitrationYear?.low === 1);
    expect(first, JSON.stringify(t.seasons.map((s) => [s.season, s.status, s.arbitrationYear]))).toBeDefined();
    expect(first!.costBasis!.source).toBe('measured_thin_with_prior');
    expect(first!.cost!.note).toMatch(/provisional/i);
    // A regime that is not MLB's never borrows the prior: its thin class is unknown
    const other = ladderOf(specs, { rules: mlbRules({ rules_fa_minimum_years: 7 }) }).ladder;
    const otherOne = other.arbitration.classes.find((c) => c.arbitrationClass === 1)!;
    expect(otherOne.status).toBe('unknown');
    expect(otherOne.readings.some((r) => r.source === 'prior')).toBe(false);
    expect(otherOne.reason).toMatch(/not MLB's/);
  });

  it('where the arbitration year is a range, the band covers every year in it', () => {
    const { ladder } = ladderOf(THICK);
    // In arbitration now: next winter is at least one more trip, and one later if an earlier Super Two year is hidden
    const t = priced(arbitrationPlayer(1), ladder);
    const next = seasonOf(t, NEXT);
    expect(next.status).toBe('arbitration');
    expect(next.arbitrationYear).toEqual({ low: 2, high: 3 });
    // Every year of the trip; and, optioned for the rest of this season, his service would put him in class 1, where the
    // ladder reads a player of that service (a Super Two's later trips sit there too; review R1-05)
    expect(next.costBasis!.classes).toEqual([1, 2, 3]);
    // Each year's own band sits inside it
    const two = priced(arbitrationPlayer(1), { ...ladder, arbitration: { ...ladder.arbitration, classes: ladder.arbitration.classes.map((c) => (c.arbitrationClass === 3 ? { ...ladder.arbitration.classes.find((x) => x.arbitrationClass === 2)!, arbitrationClass: 3 } : c)) } });
    contains(band(next), band(seasonOf(two, NEXT)));
  });

  it('where Super Two or eligibility is indeterminate, the band covers each status he could be', () => {
    const { ladder } = ladderOf(THICK);
    // In the Super Two window with no class to rank him: next winter he may be pre-arbitration or in arbitration
    const t = priced(timelineOf({ state: stateOf({ days: 2 * YEAR + 100 + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK }), ladder);
    const next = seasonOf(t, NEXT);
    expect(next.status).toBe('indeterminate');
    expect(next.between).toEqual(expect.arrayContaining(['pre_arbitration', 'arbitration']));
    const b = band(next);
    // The renewal's low edge (the minimum) and the arbitration's high edge
    expect(b.low).toBe(MINIMUM);
    const arbitrated = band(seasonOf(priced(arbitrationPlayer(1), ladder), NEXT));
    expect(b.high).toBeGreaterThan(ladder.preArbitration.band.value!.high);
    expect(next.costBasis).toMatchObject({ method: 'between' });
    expect(arbitrated.high).toBeGreaterThan(MINIMUM);
  });

  it('a season that may be free agency is priced only as what he costs if held, and says he may leave', () => {
    const { ladder } = ladderOf(THICK);
    // Five years and 100 days at the winter: next winter's service straddles the free-agency line
    const t = priced(timelineOf({ state: stateOf({ days: 5 * YEAR + 100 + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK }), ladder);
    const next = seasonOf(t, NEXT);
    expect(next.status).toBe('indeterminate');
    expect(next.between).toContain('free_agent');
    expect(band(next).low).toBeGreaterThan(MINIMUM);
    expect(next.costBasis!.ifHeld).toBe(true);
    expect(next.cost!.note).toMatch(/free agen/i);
  });

  it("a league with no arbitration rule never gets MLB's ladder", () => {
    // No arbitration (rule 0): he is renewed until free agency, at the league's own renewal pay
    const none = mlbRules({ rules_salary_arbitration_minimum_years: 0 });
    const noArbitration = ladderOf(THICK, { rules: none }).ladder;
    expect(noArbitration.arbitration.status).toBe('no_arbitration');
    expect(noArbitration.arbitration.classes).toEqual([]);
    const renewed = seasonOf(priced(arbitrationPlayer(2, none), noArbitration), NEXT);
    expect(renewed.status).toBe('pre_arbitration');
    expect(renewed.costBasis!.method).toBe('renewal_spread');
    // The arbitration rule not exported: the season is indeterminate and its cost unknown, never MLB's ladder or the prior
    const blank = mlbRules({ rules_salary_arbitration_minimum_years: null });
    const unread = ladderOf(THICK, { rules: blank }).ladder;
    expect(unread.arbitration.status).toBe('unknown');
    expect(unread.arbitration.classes.every((c) => c.readings.every((r) => r.source !== 'prior'))).toBe(true);
    const s = seasonOf(priced(arbitrationPlayer(2, blank), unread), NEXT);
    expect(s.status).toBe('indeterminate');
    expect(s.cost!.value).toBeNull();
    expect(s.cost!.note!.length).toBeGreaterThan(0);
  });

  it('unknown stays unknown: no platform production, a platform not established, an unknown price or no financials leave the arbitration cost unknown with the reason', () => {
    const { ladder } = ladderOf(THICK);
    const unknownProduction = seasonOf(priced(arbitrationPlayer(1), ladder, productionOf(null)), NEXT);
    expect(unknownProduction.cost!.value).toBeNull();
    expect(unknownProduction.cost!.note).toMatch(/production/);
    const notValued = seasonOf(priced(arbitrationPlayer(1), ladder, null), NEXT);
    expect(notValued.cost!.value).toBeNull();
    expect(notValued.cost!.note).toMatch(/production/);
    // The platform of the season after next is this season and next: next is not established
    const later = priced(arbitrationPlayer(1), ladder, productionOf(STAR, { notEstablishedFrom: NEXT }));
    const after = seasonOf(later, NEXT + 1);
    expect(after.status).toBe('arbitration');
    expect(after.cost!.value).toBeNull();
    expect(after.cost!.note).toMatch(/not established/);

    // An unknown price of a win leaves only the prior's readings unknown: the save's own line is in dollars (review R1-10)
    const noPrice = ladderOf(THICK, { price: unknownBecause('not_exported_by_ootp', null, 'Only one market reading.') }).ladder;
    expect(band(seasonOf(priced(arbitrationPlayer(1), noPrice), NEXT))).toEqual(band(seasonOf(priced(arbitrationPlayer(1), ladderOf(THICK).ladder), NEXT)));
    const thinNoPrice = ladderOf([...renewals(80), ...arbitrationClass(2, 60, 1_000_000, 2_000_000), ...arbitrationClass(3, 60, 1_500_000, 3_000_000)],
      { price: unknownBecause('not_exported_by_ootp', null, 'Only one market reading.') }).ladder;
    const t = priced(timelineOf({ state: stateOf({ days: 150 + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK }), thinNoPrice);
    const first = t.seasons.find((x) => x.status === 'arbitration' && x.arbitrationYear?.low === 1)!;
    expect(first.cost!.value).toBeNull();
    expect(first.cost!.note).toMatch(/price of a win/);

    const noMoney = ladderOf(THICK, { financials: fromExport(false, 'leagues.rules_financials') }).ladder;
    expect(noMoney.preArbitration.band.value).toBeNull();
    const w = priced(arbitrationPlayer(1), noMoney);
    expect(seasonOf(w, NEXT).cost!.value).toBeNull();
    expect(seasonOf(w, NEXT).cost!.note).toMatch(/financials/);
  });

  it("an option declined falls to a priced status: its declined branch carries that status's band", () => {
    const { ladder } = ladderOf(THICK);
    const optioned = factsOf(contractRow({ years: 2, salary: [3_000_000, 6_000_000], teamOption: 1 }));
    const t = priced(timelineOf({ state: stateOf({ days: classDays(1, 60) + CLOCK, thisYear: CLOCK }), contract: optioned, clock: CLOCK }), ladder);
    const option = seasonOf(t, NEXT);
    expect(option.status).toBe('club_option');
    expect(option.cost!.value).toEqual({ low: 6_000_000, high: 6_000_000 });
    expect(option.declined!.status).toBe('arbitration');
    expect(option.declined!.cost!.value!.low).toBeGreaterThan(MINIMUM);
  });

  it("measures the ladder as the save's own numbers and states them: the class, its contracts, its base and its share of the price per platform win", () => {
    const { ladder } = ladderOf(THICK);
    const classes = ladder.arbitration.classes;
    expect(classes.map((c) => c.arbitrationClass)).toEqual([1, 2, 3]);
    for (const c of classes) {
      expect(c.status).toBe('measured');
      expect(c.cases).toBe(60);
      const r = c.readings[0];
      expect(r.source).toBe('save');
      // The pay per platform win the cases were built with, as a share of the price's central
      const perWin = c.arbitrationClass === 1 ? 1_000_000 : c.arbitrationClass === 2 ? 2_000_000 : 3_000_000;
      expect(Math.abs(r.share * PRICE.central - perWin)).toBeLessThan(50_000);
      expect(c.text).toMatch(/60 contracts/);
    }
    // A later class is paid more per platform win
    expect(classes[1].readings[0].share).toBeGreaterThan(classes[0].readings[0].share);
  });
});

// ── phase 4a review (2026-09-23) ─────────────────────────────────────────────

/** Two measured classes (2 and 3) and the renewals; class 1 is whatever the case adds. */
const withClassOne = (one: CaseSpec[]): CaseSpec[] => [
  ...renewals(80), ...one, ...arbitrationClass(2, 60, 1_000_000, 2_000_000), ...arbitrationClass(3, 60, 1_500_000, 3_000_000),
];
/** 150 days at the winter: pre-arbitration, the Super Two window, then his first arbitration season (class 1–2). */
const youngster = () => timelineOf({ state: stateOf({ days: 150 + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK });
const firstArbitration = (t: ControlTimeline) => {
  const s = t.seasons.find((x) => x.status === 'arbitration' && x.arbitrationYear?.low === 1);
  expect(s, JSON.stringify(t.seasons.map((x) => [x.season, x.status, x.arbitrationYear]))).toBeDefined();
  return s!;
};
const classOf = (l: CostLadder, k: number) => l.arbitration.classes.find((c) => c.arbitrationClass === k)!;

describe('Player Value: the cost of controlled seasons, phase 4a review', () => {
  it("a thin class's own contracts widen its band, never narrow it, and never set a slope (R1-01, R2-02)", () => {
    // 0, 1, 2 and 3 class-1 contracts at extreme pay and no platform: each widens the band at least as far as the one before
    const stars = (n: number): CaseSpec[] => Array.from({ length: n }, (_, i) => ({ winter: classDays(1, 20 + i), salary: 20_000_000 + i * 500_000, war: [0, 0] as [number, number] }));
    const bands = [0, 1, 2, 3].map((n) => {
      const { ladder } = ladderOf(withClassOne(stars(n)));
      const one = classOf(ladder, 1);
      expect(one.status).toBe(n === 0 ? 'prior' : 'thin');
      // No line is ever fitted on a handful of contracts
      expect(one.readings.map((r) => r.source)).toEqual(['prior']);
      return band(firstArbitration(priced(youngster(), ladder)));
    });
    for (let n = 1; n <= 3; n += 1) {
      contains(bands[n], bands[n - 1]);
      // What the save actually paid the class is inside the band
      expect(bands[n].high).toBeGreaterThanOrEqual(20_000_000 + (n - 1) * 500_000);
    }
    expect(bands[1].high).toBeGreaterThan(bands[0].high);
  });

  it("one contract cannot move a rung: the class's line is robust to a star or a market contract read in the class (R2-04)", () => {
    const base = classOf(ladderOf(THICK).ladder, 3).readings[0];
    const noisy = classOf(ladderOf([...THICK,
      { winter: classDays(3, 25), salary: 60_000_000, war: [6, 6] },
      { winter: classDays(3, 26), salary: 22_000_000, war: [1, 1] },
    ]).ladder, 3).readings[0];
    const level = (r: typeof base, p: number) => r.base + (r.share as number) * PRICE.central * p;
    for (const p of [0, 3, 6]) expect(Math.abs(level(noisy, p) - level(base, p)), `platform ${p}`).toBeLessThan(250_000);
  });

  it('every priced season has a central inside its band; a season between statuses names each central and chooses none (R2-03)', () => {
    const { ladder } = ladderOf(THICK);
    // A renewal: the save's median renewal
    const renewal = seasonOf(priced(timelineOf({ state: stateOf({ days: 30, thisYear: 30 }), contract: expiring }), ladder), NEXT);
    expect(band(renewal).central).toBe(MINIMUM);
    // An arbitration season: the class his service puts him in, at the platform's central production
    const arb = seasonOf(priced(arbitrationPlayer(1), ladder, productionOf({ low: 1, central: 3, high: 5 }), 2), NEXT);
    const b = band(arb);
    expect(b.central).not.toBeNull();
    expect(b.central!).toBeGreaterThanOrEqual(b.low);
    expect(b.central!).toBeLessThanOrEqual(b.high);
    const r = classOf(ladder, 2).readings[0];
    expect(Math.abs(b.central! - (MINIMUM + r.base + (r.share as number) * PRICE.central * 2.5))).toBeLessThan(150_000);
    // A season between pre-arbitration and arbitration: no single central, each status's named
    const window = seasonOf(priced(timelineOf({ state: stateOf({ days: 2 * YEAR + 100 + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK }), ladder), NEXT);
    expect(window.status).toBe('indeterminate');
    expect(band(window).central).toBeNull();
    expect(window.costBasis!.centrals!.map((c) => c.status).sort()).toEqual(['arbitration', 'pre_arbitration']);
    expect(window.cost!.note).toMatch(/central/i);
    // A season that may be free agency: the central if held
    const leave = seasonOf(priced(timelineOf({ state: stateOf({ days: 5 * YEAR + 100 + CLOCK, thisYear: CLOCK }), contract: expiring, clock: CLOCK }), ladder), NEXT);
    expect(leave.costBasis!.ifHeld).toBe(true);
    expect(band(leave).central).not.toBeNull();
  });

  it('the text says what the band is, in plain words, and only what it used (R2-11, R1-09, R2-06)', () => {
    const { ladder } = ladderOf(THICK);
    const all = [ladder.rules.renewal, ladder.rules.arbitration, ladder.preArbitration.text, ...ladder.arbitration.classes.map((c) => c.text)].join(' ');
    expect(all).not.toMatch(/1\.2816|90% point|10% to 90%|% of its pay/);
    expect(all).toMatch(/10th to 90th percentile/);
    // A player not known to be a Super Two: the fourth trip is the unseen-winter possibility, said so
    const t = priced(arbitrationPlayer(2), ladder);
    const next = seasonOf(t, NEXT);
    expect(next.arbitrationYear).toEqual({ low: 3, high: 4 });
    expect(next.cost!.note).not.toMatch(/a Super Two's extra trip/);
    expect(next.cost!.note).toMatch(/earlier winter/);
    // A band on the prior alone never mentions a save line
    const priorOnly = ladderOf([...renewals(80), ...arbitrationClass(3, 60, 1_500_000, 3_000_000)]).ladder;
    const first = firstArbitration(priced(youngster(), priorOnly));
    expect(first.costBasis!.source).toBe('provisional_prior');
    expect(first.cost!.note).not.toMatch(/save's own line/);
    // The renewal band's text says which renewal bounds it: at 33 the largest, the only one that can
    const few = ladderOf([...renewals(33), ...arbitrationClass(1, 60, 400_000, 1_000_000)]).ladder;
    expect(few.preArbitration.status).toBe('measured');
    expect(few.preArbitration.text).toMatch(/largest of the 33/);
    expect(few.preArbitration.text).toMatch(/too few/);
    expect(ladder.preArbitration.text).not.toMatch(/too few/);
  });

  it('the minimum is a reading, never an assumption: the low edge reaches it where the save paid the class the minimum at such a platform (R1-04)', () => {
    const atMinimum = Array.from({ length: 6 }, (_, i) => ({ winter: classDays(1, 30 + i), salary: MINIMUM, war: [-0.5, 0] as [number, number] }));
    const { ladder } = ladderOf([...THICK, ...atMinimum]);
    expect(classOf(ladder, 1).excluded.atMinimum).toBe(6);
    const weak = firstArbitration(priced(youngster(), ladder, productionOf({ low: -1, central: 0, high: 0.5 })));
    expect(band(weak).low).toBe(MINIMUM);
    expect(weak.cost!.note).toMatch(/at the (league )?minimum/);
    // A platform above theirs never reaches it
    const strong = firstArbitration(priced(youngster(), ladder, productionOf(STAR)));
    expect(band(strong).low).toBeGreaterThan(MINIMUM);
  });

  it('the price band is named in the basis, and widens the band, only where the prior is in the reading (R1-02, R1-08)', () => {
    const thin = ladderOf(withClassOne(arbitrationClass(1, 10, 400_000, 1_000_000))).ladder;
    const widePrice = ladderOf(withClassOne(arbitrationClass(1, 10, 400_000, 1_000_000)), { price: derivedFrom({ central: 7_000_000, low: 5_000_000, high: 11_000_000 }, 'test') }).ladder;
    // A Super Two known at an off-season import: next season is his first trip, class 1 alone (the thin class)
    const members = Array.from({ length: 50 }, (_, i) => ({ days: 2 * YEAR + i * 3, thisYear: 100, onRoster: true }));
    const days = 2 * YEAR + 140;
    const superTwo = () => timelineOf({ state: stateOf({ days, thisYear: 141 }), contract: expiring, clock: YEAR, superTwoClass: [...members, { days, thisYear: 141, onRoster: true }] });
    const narrow = seasonOf(priced(superTwo(), thin), NEXT);
    const wide = seasonOf(priced(superTwo(), widePrice), NEXT);
    expect(narrow.costBasis!.classes).toEqual([1]);
    expect(narrow.costBasis!.source).toBe('measured_thin_with_prior');
    expect(narrow.costBasis!.price).toEqual({ low: PRICE.low, high: PRICE.high });
    contains(band(wide), band(narrow));
    expect(band(wide).high).toBeGreaterThan(band(narrow).high);
  });

  it('a branch the player decides is never a certain cost: a player option declined or an opt-out is priced if held (R1-07)', () => {
    const { ladder } = ladderOf(THICK);
    const state = stateOf({ days: classDays(1, 60) + CLOCK, thisYear: CLOCK });
    const player = seasonOf(priced(timelineOf({ state, contract: factsOf(contractRow({ years: 2, salary: [3_000_000, 6_000_000], playerOption: 1 })), clock: CLOCK }), ladder), NEXT);
    expect(player.status).toBe('player_option');
    expect(player.declined!.cost!.value).not.toBeNull();
    expect(player.declined!.costBasis!.ifHeld).toBe(true);
    expect(player.declined!.cost!.note).toMatch(/player decides/i);
    const optOut = seasonOf(priced(timelineOf({ state, contract: factsOf(contractRow({ years: 3, salary: [3_000_000, 6_000_000, 7_000_000], optOut: 1 })), clock: CLOCK }), ladder), NEXT);
    expect(optOut.declined?.kind).toBe('opted_out');
    if (optOut.declined!.cost!.value !== null) expect(optOut.declined!.costBasis!.ifHeld).toBe(true);
    // The club's own option declined: the club decides, and he is under its control
    const club = seasonOf(priced(timelineOf({ state, contract: factsOf(contractRow({ years: 2, salary: [3_000_000, 6_000_000], teamOption: 1 })), clock: CLOCK }), ladder), NEXT);
    expect(club.declined!.costBasis!.ifHeld).toBe(false);
  });

  it('a Super Two identified at an off-season import: his later seasons cover the class the ladder measures such players in (R1-05)', () => {
    const { ladder } = ladderOf(THICK);
    const members = Array.from({ length: 50 }, (_, i) => ({ days: 2 * YEAR + i * 3, thisYear: 100, onRoster: true }));
    const days = 2 * YEAR + 140;
    const t = priced(timelineOf({ state: stateOf({ days, thisYear: 141 }), contract: expiring, clock: YEAR, superTwoClass: [...members, { days, thisYear: 141, onRoster: true }] }), ladder);
    expect(seasonOf(t, NEXT)).toMatchObject({ status: 'arbitration', superTwo: true, arbitrationYear: { low: 1, high: 1 } });
    const second = seasonOf(t, NEXT + 1);
    expect(second.arbitrationYear).toEqual({ low: 2, high: 2 });
    // His service then puts him where the ladder reads the first class: that class is covered too
    expect(second.costBasis!.classes).toEqual([1, 2]);
  });

  it('a platform beyond what the class was measured on says so, and the band is never capped to hide it (R2-08)', () => {
    const { ladder } = ladderOf(THICK);
    const far = seasonOf(priced(arbitrationPlayer(1), ladder, productionOf({ low: 3, central: 8, high: 12 }), 4), NEXT);
    expect(far.cost!.note).toMatch(/beyond the 6\.0 wins/);
    const farther = seasonOf(priced(arbitrationPlayer(1), ladder, productionOf({ low: 3, central: 9, high: 16 }), 4), NEXT);
    expect(band(farther).high).toBeGreaterThan(band(far).high);
    const inside = seasonOf(priced(arbitrationPlayer(1), ladder, productionOf({ low: 1, central: 2, high: 3 }), 2), NEXT);
    expect(inside.cost!.note).not.toMatch(/beyond the/);
  });
});
