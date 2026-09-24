import { describe, expect, it } from 'vitest';
import {
  projectProduction, surplusOf,
  type ControlSeason, type ControlStatus, type ControlTimeline, type PlayerProduction, type PlayerSurplus, type ProductionInput,
  type ProductionLine, type SurplusInput, type SurplusMarket,
} from '../server/playerValue.js';
import { SURPLUS_POLICY, SURPLUS_POLICY_CALIBRATION } from '../server/playerValueCalibration.js';
import { derivedFrom, fromExport, unknownBecause } from '../server/provenance.js';
import { THIS_SEASON, YEAR, contractRow, factsOf, stateOf, timelineOf } from './playerValueFixtures';

/*
 * Player Value phase 5a: neutral contract surplus and the retention margin (PLAYER_VALUE.md Part 5,
 * BEHAVIOR_CASES.md "Player Value", phase 5a). Each case is built from synthetic evidence through the pure
 * surplus (`surplusOf`): production from `projectProduction`, control from the fixtures' Player Rights path or
 * a hand-built timeline, and a stated market. No case names a player or says who is worth more, and none
 * says keep, release or trade.
 */

const SEASON = THIS_SEASON;
const PLAYED = 0.3;
const bat = (season: number, pa: number, war: number): ProductionLine => ({ season, opportunities: pa, war });

const regular = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  playerId: 1, season: SEASON, seasonPlayed: PLAYED, age: 27,
  batting: [bat(2027, 610, 3.1), bat(2028, 640, 2.8), bat(2029, 600, 3.4), bat(2030, 190, 1.0)],
  pitching: [],
  ...over,
});

const PRICE = { central: 7_000_000, low: 6_000_000, high: 10_000_000 };
const MIN = 780_000;

const market = (over: Partial<SurplusMarket> = {}): SurplusMarket => ({
  price: derivedFrom(PRICE, 'test'),
  stage: 'opening',
  label: 'the opening price (the imported market)',
  minimumSalary: fromExport(MIN, 'leagues.rules_minimum_salary'),
  replacementLevel: 0.293,
  measuredReplacement: 'Replacement from freely available talent: not measured yet (0 of 30 players); the export\'s convention stays, provisional.',
  ...over,
});

/** A veteran past the free-agency line: his control ends when his deal does. */
const VETERAN = stateOf({ days: 8 * YEAR });

/** A guaranteed major-league deal over `salaries` from `first`. */
const deal = (first: number, salaries: number[], over: Parameters<typeof contractRow>[0] = {}): ControlTimeline =>
  timelineOf({ state: VETERAN, contract: factsOf(contractRow({ firstSeason: first, years: salaries.length, salary: salaries, ...over })) });

const input = (control: ControlTimeline, over: Partial<SurplusInput> = {}): SurplusInput => ({
  production: projectProduction(regular()),
  control,
  majorLeagueDeal: true,
  market: market(),
  fortyMan: true,
  ...over,
});

const season = (y: number, status: ControlStatus, over: Partial<ControlSeason> = {}): ControlSeason => ({
  season: y, status, arbitrationYear: null, superTwo: false, between: [], cost: null, declined: null,
  from: status === 'under_contract' ? 'contract' : 'player_rights', basis: `${status} in ${y}.`, reasons: [], crossings: [],
  ...over,
});

const band = (low: number, central: number | null, high: number) => derivedFrom({ low, high, central }, 'test');

const timeline = (seasons: ControlSeason[], over: Partial<ControlTimeline> = {}): ControlTimeline => ({
  playerId: 1, holder: fromExport(1, 'players.organization_id'), standing: 'held', thisSeason: SEASON, seasons,
  controlEnds: seasons.find((s) => s.status === 'free_agent')?.season ?? null, continuesPastHorizon: false, extensionSigned: false,
  eligibility: null, notes: [],
  ...over,
});

/** This season signed at the minimum, then two pre-arbitration renewals and an arbitration season, then free agency. */
const controlled = (): ControlTimeline => timeline([
  season(2030, 'under_contract', { cost: fromExport({ low: MIN, high: MIN }, 'players_contract.salary0') }),
  season(2031, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
  season(2032, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
  season(2033, 'arbitration', { arbitrationYear: { low: 1, high: 1 }, cost: band(2_000_000, 4_500_000, 9_000_000) }),
  season(2034, 'free_agent'),
]);

const seasonIn = (s: PlayerSurplus, y: number) => {
  const x = s.seasons.find((z) => z.season === y);
  if (!x) throw new Error(`no ${y} in ${s.seasons.map((z) => z.season).join(',')}`);
  return x;
};

/** Interval product of two positive-or-signed ranges: every corner. */
const times = (a: { low: number; high: number }, b: { low: number; high: number }) => {
  const corners = [a.low * b.low, a.low * b.high, a.high * b.low, a.high * b.high];
  return { low: Math.min(...corners), high: Math.max(...corners) };
};

describe('sunk salary never favours keeping a player', () => {
  it('raising the guarantee owed whether he stays or goes never raises his retention margin, and lowers his contract surplus', () => {
    const modest = surplusOf(input(deal(2028, [8e6, 8e6, 8e6, 8e6, 8e6])));
    const rich = surplusOf(input(deal(2028, [8e6, 8e6, 30e6, 30e6, 30e6])));
    expect(modest.retention.status).toBe('known');
    expect(rich.retention).toEqual(modest.retention);
    for (const y of [2030, 2031, 2032]) expect(seasonIn(rich, y).retention).toEqual(seasonIn(modest, y).retention);
    expect(rich.contract.central!).toBeLessThan(modest.contract.central!);
    expect(rich.contract.high!).toBeLessThan(modest.contract.high!);
  });

  it('raising the money already paid (a past season\'s salary, this season\'s part already played) never raises his retention margin', () => {
    const base = surplusOf(input(deal(2028, [8e6, 8e6, 8e6, 8e6, 8e6])));
    const paidMore = surplusOf(input(deal(2028, [40e6, 40e6, 8e6, 8e6, 8e6])));
    // Past seasons are sunk for both views
    expect(paidMore.retention).toEqual(base.retention);
    expect(paidMore.contract).toEqual(base.contract);
    // This season's salary raised: its paid part is sunk and its unpaid part is owed either way
    const thisSeasonMore = surplusOf(input(deal(2028, [8e6, 8e6, 20e6, 8e6, 8e6])));
    expect(thisSeasonMore.retention).toEqual(base.retention);
    expect(seasonIn(thisSeasonMore, 2030).paid!).toBeGreaterThan(seasonIn(base, 2030).paid!);
    expect(seasonIn(thisSeasonMore, 2030).contract.band!.central!).toBeLessThan(seasonIn(base, 2030).contract.band!.central!);
  });

  it('a deeply negative contract surplus can sit beside a positive retention margin; where every cost exists only if he is kept, the two views agree', () => {
    const heavy = surplusOf(input(deal(2028, [35e6, 35e6, 35e6, 35e6, 35e6])));
    expect(heavy.contract.central!).toBeLessThan(-30e6);
    expect(heavy.retention.central!).toBeGreaterThan(0);
    // The converse: renewals and arbitration exist only if he is kept, so nothing cancels after this season
    const young = surplusOf(input(controlled()));
    for (const y of [2031, 2032, 2033]) {
      const s = seasonIn(young, y);
      expect(s.owedEitherWay).toBeNull();
      expect(s.retention.band).toEqual(s.contract.band);
    }
  });
});

describe('a contract\'s surplus is his production value less his cost, season by season, with every component shown', () => {
  it('shows the wins band, the price band and which price is in force, the cost band with its basis, the discount weight and the seasons included', () => {
    const s = surplusOf(input(controlled(), { market: market({ stage: 'measured', label: 'the measured price, per win produced' }) }));
    expect(s.status).toBe('valued');
    expect(s.unit).toBe('dollars');
    expect(s.price).toMatchObject({ stage: 'measured', band: PRICE });
    expect(s.price!.text).toMatch(/per win produced/);
    expect(s.price!.text).toMatch(/held flat/);
    expect(s.seasons.map((x) => x.season)).toEqual([2030, 2031, 2032, 2033]);
    expect(s.contract.from).toBe(2030);
    expect(s.contract.to).toBe(2033);
    for (const x of s.seasons) {
      expect(x.wins).not.toBeNull();
      expect(x.cost).not.toBeNull();
      expect(x.costText.length).toBeGreaterThan(0);
      expect(x.weight).toBeGreaterThan(0);
      expect(x.contract.text.length).toBeGreaterThan(0);
    }
    expect(s.excluded.join(' ')).toMatch(/2034/);
  });

  it('values production at the replacement\'s minimum plus wins times the price, one level of replacement on both sides', () => {
    const s = surplusOf(input(controlled()));
    const x = seasonIn(s, 2031);
    const wp = times(x.wins!, PRICE);
    expect(x.replacement).toBe(MIN);
    expect(x.contract.band!.low).toBeCloseTo(MIN + wp.low - x.cost!.high, 0);
    expect(x.contract.band!.high).toBeCloseTo(MIN + wp.high - x.cost!.low, 0);
    expect(x.contract.band!.central!).toBeCloseTo(MIN + x.wins!.central * PRICE.central - x.cost!.central!, 0);
    expect(s.replacement.text).toMatch(/0 WAR|zero/);
    expect(s.replacement.text).toMatch(/minimum/);
    expect(s.replacement.measured).toMatch(/not measured yet/);
    // The measured replacement is shown, never applied
    const other = surplusOf(input(controlled(), { market: market({ measuredReplacement: 'Replacement from freely available talent: 0.13 WAR per 600 (40 players), shown, not applied.' }) }));
    expect(other.contract).toEqual(s.contract);
    expect(other.retention).toEqual(s.retention);
  });
});

describe('the rest of this season counts only its part still to be played', () => {
  it('counts the wins for the rest of it and the same share of his salary and the replacement\'s minimum; banked wins and salary paid are shown, never counted', () => {
    const production = projectProduction(regular());
    const s = surplusOf(input(deal(2028, [8e6, 8e6, 8e6, 8e6, 8e6]), { production }));
    const now = seasonIn(s, 2030);
    const p = production.seasons[0];
    expect(now.part).toBe('rest_of_season');
    expect(now.share).toBeCloseTo(1 - PLAYED, 9);
    expect(now.weight).toBe(1);
    expect(now.wins).toEqual(p.remaining);
    expect(now.banked).toBe(p.toDate);
    expect(now.cost!.low).toBeCloseTo(8e6 * (1 - PLAYED), 0);
    expect(now.paid).toBeCloseTo(8e6 * PLAYED, 0);
    expect(now.replacement).toBeCloseTo(MIN * (1 - PLAYED), 0);
    // What he has banked is sunk: the same rest of the season with more banked values the same
    const banked = structuredClone(production) as PlayerProduction;
    banked.seasons[0].toDate = (banked.seasons[0].toDate ?? 0) + 3;
    banked.seasons[0].wins = { low: banked.seasons[0].wins.low + 3, central: banked.seasons[0].wins.central + 3, high: banked.seasons[0].wins.high + 3 };
    const t = surplusOf(input(deal(2028, [8e6, 8e6, 8e6, 8e6, 8e6]), { production: banked }));
    expect(t.contract).toEqual(s.contract);
    expect(t.retention).toEqual(s.retention);
    expect(s.excluded.join(' ')).toMatch(/banked/);
  });
});

describe('surplus bands are combined edge against edge, never narrower than their parts allow', () => {
  it('each season is its components\' corners, its central from their centrals and inside the band; the sum adds edge with edge', () => {
    const s = surplusOf(input(controlled()));
    for (const x of s.seasons) {
      const b = x.contract.band!;
      const wp = times(x.wins!, PRICE);
      expect(b.high - b.low).toBeGreaterThanOrEqual((wp.high - wp.low) + (x.cost!.high - x.cost!.low) - 1e-6);
      expect(b.low).toBeLessThanOrEqual(b.central!);
      expect(b.central!).toBeLessThanOrEqual(b.high);
      expect(x.contract.discounted!.low).toBeCloseTo(b.low * x.weight, 3);
      expect(x.contract.discounted!.high).toBeCloseTo(b.high * x.weight, 3);
    }
    const sum = (k: 'low' | 'high' | 'central') => s.seasons.reduce((t, x) => t + (x.contract.discounted![k] as number), 0);
    expect(s.contract.low!).toBeCloseTo(sum('low'), 3);
    expect(s.contract.high!).toBeCloseTo(sum('high'), 3);
    expect(s.contract.central!).toBeCloseTo(sum('central'), 3);
  });

  it('a wider price, a wider cost or a wider wins band never narrows the surplus', () => {
    const base = surplusOf(input(controlled()));
    const widerPrice = surplusOf(input(controlled(), { market: market({ price: derivedFrom({ central: 7e6, low: 4e6, high: 14e6 }, 'test') }) }));
    const widerCost = controlled();
    widerCost.seasons[3] = { ...widerCost.seasons[3], cost: band(1_000_000, 4_500_000, 15_000_000) };
    const wc = surplusOf(input(widerCost));
    for (const w of [widerPrice, wc]) {
      expect(w.contract.low!).toBeLessThanOrEqual(base.contract.low! + 1e-6);
      expect(w.contract.high!).toBeGreaterThanOrEqual(base.contract.high! - 1e-6);
    }
  });
});

describe('unknown stays unknown', () => {
  it('a season whose cost is unknown has an unknown surplus with its reason, and the sum names it and never reads it as zero', () => {
    const t = controlled();
    t.seasons[2] = { ...t.seasons[2], cost: unknownBecause('not_exported_by_ootp', null, 'The renewal pay is not measured.') };
    const s = surplusOf(input(t));
    const x = seasonIn(s, 2032);
    expect(x.contract.status).toBe('unknown');
    expect(x.contract.reason).toMatch(/renewal pay is not measured/);
    expect(x.contract.band).toBeNull();
    expect(s.contract.status).toBe('unknown');
    expect(s.contract.missing).toEqual([2032]);
    expect(s.contract.low).toBeNull();
    expect(s.contract.central).toBeNull();
    expect(s.contract.reason).toMatch(/2032/);
    // The seasons before it are summed, labelled with the seasons they cover
    expect(s.contract.established).toMatchObject({ from: 2030, to: 2031 });
  });

  it('a season whose production is not established has an unknown surplus, named, never extrapolated', () => {
    const production = projectProduction(regular());
    const cut = structuredClone(production) as PlayerProduction;
    const later = cut.seasons.splice(2);
    cut.notEstablished = later.map((x) => ({ season: x.season, horizon: x.horizon, age: x.age, reason: 'the arrival model is not adopted this far out' }));
    const s = surplusOf(input(controlled(), { production: cut }));
    expect(seasonIn(s, 2032).contract.status).toBe('unknown');
    expect(seasonIn(s, 2032).contract.reason).toMatch(/not established/);
    expect(s.contract.missing).toEqual([2032, 2033]);
    expect(s.retention.missing).toEqual([2032, 2033]);
    expect(s.wins.missing).toEqual([2032, 2033]);
  });

  it('unknown production leaves every view unknown with its reason; a player no club holds has no contract to value', () => {
    const unknown: PlayerProduction = { ...projectProduction(regular()), status: 'unknown', reason: 'No major-league results and no ability evidence.', seasons: [], notEstablished: [] };
    const s = surplusOf(input(controlled(), { production: unknown }));
    expect(s.status).toBe('unknown');
    expect(s.reason).toMatch(/No major-league results/);
    expect(s.contract.status).toBe('unknown');
    expect(s.retention.status).toBe('unknown');
    const free = surplusOf(input(timeline([], { standing: 'unsigned', thisSeason: SEASON })));
    expect(free.status).toBe('not_held');
    expect(free.contract.status).toBe('unknown');
    expect(free.reason).toMatch(/No club holds him/);
  });

  it('without dollars the value is in wins only, and dollars are unknown with the reason', () => {
    const noMoney = market({ price: unknownBecause('not_exported_by_ootp', 'leagues.rules_financials', 'The league runs no financials (rules_financials = 0): value is in wins, and dollars are unknown.') });
    const s = surplusOf(input(controlled(), { market: noMoney }));
    expect(s.status).toBe('wins_only');
    expect(s.unit).toBe('wins');
    expect(s.contract.status).toBe('unknown');
    expect(s.contract.reason).toMatch(/runs no financials/);
    expect(s.retention.status).toBe('unknown');
    expect(s.wins.status).toBe('known');
    expect(s.wins.central!).toBeGreaterThan(0);
    const noRegime = surplusOf(input(controlled(), { market: null }));
    expect(noRegime.status).toBe('wins_only');
    expect(noRegime.contract.reason).toMatch(/contract regime/);
  });
});

describe('the neutral discount is one stated policy rate, and the price is held flat', () => {
  it('weighs a season s seasons out at 1/1.05^s and this season\'s remaining part at 1 (owner, 2026-09-24)', () => {
    expect(SURPLUS_POLICY.discountRate).toBe(0.05);
    expect(SURPLUS_POLICY_CALIBRATION.status).toBe('policy');
    const s = surplusOf(input(controlled()));
    expect(s.discount.rate).toBe(0.05);
    expect(s.discount.text).toMatch(/5%/);
    for (const x of s.seasons) expect(x.weight).toBeCloseTo(1 / 1.05 ** (x.season - SEASON), 12);
    // The same price in every season
    expect(new Set(s.seasons.map((x) => JSON.stringify(x.price))).size).toBe(1);
  });
});

describe('an option season is both branches', () => {
  it('the contract surplus covers the option exercised and declined and chooses no central; the retention margin is the branch where he is kept', () => {
    const t = deal(2029, [10e6, 10e6, 10e6, 10e6], { teamOption: 1 });
    const opt = t.seasons.find((x) => x.status === 'club_option');
    expect(opt?.season).toBe(2032);
    const s = surplusOf(input(t));
    const x = seasonIn(s, 2032);
    expect(x.branches.length).toBe(2);
    expect(x.contract.band!.central).toBeNull();
    expect(x.contract.centrals.length).toBeGreaterThanOrEqual(2);
    expect(s.contract.central).toBeNull();
    expect(s.contract.centralRange).not.toBeNull();
    // The buyout is not exported: what exists only if he is kept runs from the salary less nothing to nothing
    expect(x.onlyIfKept).toMatchObject({ low: 0, high: 10e6 });
    expect(x.retention.text).toMatch(/buyout/);
    // The retention margin is never below the contract surplus of the branch where he is kept
    const kept = x.branches.find((b) => b.held)!;
    expect(x.retention.band!.high).toBeGreaterThanOrEqual(kept.surplus!.high - 1e-6);
  });

  it('a season the player decides is "if held"', () => {
    const t = deal(2029, [10e6, 10e6, 10e6, 10e6], { playerOption: 1 });
    const s = surplusOf(input(t));
    const x = seasonIn(s, 2032);
    expect(x.retention.ifHeld).toBe(true);
    expect(x.contract.ifHeld).toBe(true);
    expect(s.retention.ifHeld).toBe(true);
  });

  it('a season he may leave in as a free agent is "if held", and its contract surplus reaches nothing', () => {
    const t = controlled();
    t.seasons[3] = season(2033, 'indeterminate', {
      between: ['arbitration', 'free_agent'], cost: band(2_000_000, null, 9_000_000),
      costBasis: {
        method: 'arbitration_ladder', source: 'measured', classes: [3], cases: 40, platform: null, price: null, ifHeld: true,
        centrals: [{ status: 'arbitration', central: 4_500_000 }], text: 'Arbitration if held.',
      },
    });
    const s = surplusOf(input(t));
    const x = seasonIn(s, 2033);
    expect(x.contract.ifHeld).toBe(true);
    expect(x.contract.band!.low).toBeLessThanOrEqual(0);
    expect(x.contract.band!.high).toBeGreaterThanOrEqual(0);
    expect(x.contract.centrals.some((c) => c.low === 0 && c.high === 0)).toBe(true);
  });
});

describe('the retention margin states what it rests on, and neither view is a verdict', () => {
  it('names the replacement\'s wins, the minimum subtracted, what cancels and the 40-man spot stated, not priced', () => {
    const s = surplusOf(input(deal(2028, [8e6, 8e6, 8e6, 8e6, 8e6])));
    const text = [...s.basis, s.replacement.text, ...s.seasons.map((x) => x.retention.text)].join(' ');
    expect(text).toMatch(/replacement/);
    expect(text).toMatch(/minimum/);
    expect(text).toMatch(/whatever the club does|either way/);
    expect(s.fortyMan.onFortyMan).toBe(true);
    expect(s.fortyMan.text).toMatch(/40-man/);
    expect(s.fortyMan.text).toMatch(/not priced/);
  });

  it('says no keep, release, trade, extend or sign', () => {
    for (const t of [controlled(), deal(2028, [35e6, 35e6, 35e6, 35e6, 35e6]), deal(2029, [10e6, 10e6, 10e6, 10e6], { teamOption: 1 })]) {
      const words = JSON.stringify(surplusOf(input(t)));
      expect(words).not.toMatch(/\b(should|recommend\w*|release him|keep him|trade him|extend him|sign him|non-tender him|verdict: )\b/i);
    }
  });
});
