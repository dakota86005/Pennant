import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import {
  clubFinancesOf, leagueFinances, marketStandingOf, openingPriceOfWin, replacementLevelOf,
  type MarketCandidate, type OpeningPriceInput, type SeasonWar,
} from '../server/playerValue.js';
import { captureMarketSnapshot, marketSnapshotHistory } from '../server/playerValueSnapshot.js';
import { fromExport, unknownBecause } from '../server/provenance.js';
import request from './request';
import { IDS, SEASON } from './fixture';
import { THIS_SEASON, YEAR, contractRow, factsOf, mlbRules, stateOf, timelineOf } from './playerValueFixtures';
import { OPENING_PRICE_MINIMUMS } from '../server/playerValueCalibration.js';

/*
 * Player Value phase 2: Club Finances and the opening price of a win (D-052, PLAYER_VALUE.md Parts
 * 2.4, 4.1, 4.3, 7). Each `it` is a baseball invariant from BEHAVIOR_CASES.md "Player Value", built
 * from synthetic evidence through the function that owns the answer; the snapshot and Payroll
 * cases run against the fixture league.
 */

const MIN = 780_000;
const PRIOR = THIS_SEASON - 1;

interface Spec {
  id: number;
  /** Service now, this season's 40 days included. */
  days: number;
  salary: number;
  war: { prior?: number; twoBack?: number; thisSeason?: number };
  firstSeason?: number;
  years?: number;
  isMajor?: 0 | 1;
  currentState?: 'current' | 'behind';
  rules?: ReturnType<typeof mlbRules>;
}

function candidate(spec: Spec): MarketCandidate {
  const rules = spec.rules ?? mlbRules();
  const contract = factsOf(contractRow({
    salary: spec.salary, isMajor: spec.isMajor ?? 1, firstSeason: spec.firstSeason ?? THIS_SEASON, years: spec.years ?? 1,
  }));
  const state = { ...stateOf({ days: spec.days, thisYear: 40 }), playerId: spec.id };
  const control = timelineOf({ state, contract, rules, currentState: spec.currentState ?? 'current' });
  return { playerId: spec.id, contract: { ...contract, playerId: spec.id }, control };
}

function warOf(specs: Spec[], covered: { prior?: boolean; twoBack?: boolean; thisSeason?: boolean } = {}): Map<number, SeasonWar> {
  const out = new Map<number, SeasonWar>();
  const seasons: Array<[number, 'twoBack' | 'prior' | 'thisSeason']> = [[PRIOR - 1, 'twoBack'], [PRIOR, 'prior'], [THIS_SEASON, 'thisSeason']];
  for (const [season, key] of seasons) {
    if (covered[key] === false) continue;
    const byPlayer = new Map<number, number>();
    for (const s of specs) if (s.war[key] !== undefined) byPlayer.set(s.id, s.war[key] as number);
    const total = [...byPlayer.values()].reduce((a, b) => a + b, 0);
    out.set(season, { season, byPlayer, total, clubs: new Set([1]), source: 'test' });
  }
  return out;
}

/**
 * A small league shaped like the imported one: free-agency-eligible veterans paid well above the
 * minimum (half of them on contracts starting this season), and pre-arbitration and arbitration
 * players held near it by rule. Each market basis rests on at least the policy minimum of contracts
 * (`OPENING_PRICE_MINIMUMS.contracts`), so every basis can be computed.
 */
function league(over: Partial<Spec> = {}, veterans = 2 * OPENING_PRICE_MINIMUMS.contracts): Spec[] {
  const specs: Spec[] = [];
  for (let i = 0; i < veterans; i += 1) {
    const k = i % 8;
    specs.push({
      id: 100 + i, days: (7 + (k % 4)) * YEAR, salary: 12_000_000 + k * 3_000_000,
      war: { prior: 2 + k * 0.4, twoBack: 2.2 + k * 0.4, thisSeason: 0.8 + k * 0.1 },
      firstSeason: i % 2 === 0 ? THIS_SEASON : THIS_SEASON - 2, years: i % 2 === 0 ? 2 : 4, ...over,
    });
  }
  for (let i = 0; i < veterans / 2; i += 1) {
    const k = i % 8;
    specs.push({
      id: 1000 + i, days: YEAR + k * 20, salary: MIN + k * 50_000,
      war: { prior: 1.5 + k * 0.2, twoBack: 1, thisSeason: 0.5 }, ...over,
    });
  }
  return specs;
}

function input(specs: Spec[], over: Partial<OpeningPriceInput> = {}): OpeningPriceInput {
  return {
    leagueId: 203,
    season: THIS_SEASON,
    financials: fromExport(true, 'leagues.rules_financials'),
    minimumSalary: fromExport(MIN, 'leagues.rules_minimum_salary'),
    candidates: specs.map(candidate),
    war: warOf(specs),
    seasonFraction: fromExport(0.3, 'team_record.g'),
    seasonShares: new Map([[PRIOR, fromExport(1, 'team_history_record.g')], [PRIOR - 1, fromExport(1, 'team_history_record.g')]]),
    ...over,
  };
}

describe('Player Value: the opening price of a win (phase 2)', () => {
  it('a league without financials yields value in wins, with dollars unknown and the reason stated', () => {
    const price = openingPriceOfWin(input(league(), { financials: fromExport(false, 'leagues.rules_financials') }));
    expect(price.unit).toBe('wins');
    expect(price.price.value).toBeNull();
    expect(price.floor.value).toBeNull();
    expect(price.price.note).toMatch(/financials/i);
    // Unknown whether it runs financials is unknown, and says so; never "on"
    const blank = openingPriceOfWin(input(league(), { financials: unknownBecause('not_exported_by_ootp', 'leagues.rules_financials') }));
    expect(blank.unit).toBe('wins');
    expect(blank.price.value).toBeNull();
    expect(blank.price.note).toMatch(/financials/i);
  });

  it('a league whose market contracts carry no salary yields dollars unknown, with the reason stated', () => {
    const price = openingPriceOfWin(input(league({ salary: 0 })));
    expect(price.price.value).toBeNull();
    expect(price.price.note).toMatch(/salary/i);
    // A minor-league contract's $0 is unknown, never a cost of zero (Q-5)
    const minors = openingPriceOfWin(input(league({ isMajor: 0 })));
    expect(minors.price.value).toBeNull();
    expect(minors.population.unknownSalary).toBe(league().length);
  });

  it('a reserve-clause league has no market contract, so its dollars are unknown', () => {
    const price = openingPriceOfWin(input(league({ rules: mlbRules({ rules_fa_minimum_years: 0 }) })));
    expect(price.population.market).toBe(0);
    expect(price.price.value).toBeNull();
    expect(price.price.note).toMatch(/market/i);
  });

  it('always carries its basis, its band and a floor below it, labelled the imported market', () => {
    const price = openingPriceOfWin(input(league()));
    expect(price.unit).toBe('dollars_per_win');
    expect(price.label).toBe('opening: the imported market');
    expect(price.stage).toBe('opening');
    const p = price.price.value!;
    const f = price.floor.value!;
    expect(p.low).toBeLessThan(p.high);
    expect(p.central).toBeGreaterThanOrEqual(p.low);
    expect(p.central).toBeLessThanOrEqual(p.high);
    expect(f.high).toBeLessThan(p.low);
    // Every basis names its population, salary and wins; the band is the spread of the market bases
    const market = price.bases.filter((b) => b.role === 'market' && b.perWin.value !== null);
    expect(market.length).toBeGreaterThanOrEqual(2);
    for (const b of price.bases) {
      expect(b.description.length).toBeGreaterThan(10);
      if (b.perWin.value !== null) {
        expect(b.players).toBeGreaterThan(0);
        expect(b.perWin.value).toBeCloseTo(b.salaryAboveMinimum! / b.wins!, 6);
      }
    }
    expect(p.low).toBe(Math.min(...market.map((b) => b.perWin.value!)));
    expect(p.high).toBe(Math.max(...market.map((b) => b.perWin.value!)));
    expect(price.assumptions.length).toBeGreaterThanOrEqual(5);
    expect(price.assumptions.join(' ')).toMatch(/replacement/i);
    expect(price.rules.central).toMatch(/median/i);
  });

  it('a single reading is not a band: the price is unknown rather than a point', () => {
    // Only this season's pace is available (no prior season in the WAR tables), and nobody signed this season
    const specs = league({ firstSeason: THIS_SEASON - 2, years: 4 });
    const price = openingPriceOfWin(input(specs, { war: warOf(specs, { prior: false, twoBack: false }) }));
    const readings = price.bases.filter((b) => b.role === 'market' && b.perWin.value !== null);
    expect(readings).toHaveLength(1);
    expect(price.price.value).toBeNull();
    expect(price.price.note).toMatch(/band/i);
  });

  it('never narrows on one import alone: the same cross-section read twice gives the same band', () => {
    const once = openingPriceOfWin(input(league()));
    const twice = openingPriceOfWin(input([...league(), ...league().map((s) => ({ ...s, id: s.id + 1000 }))]));
    // The same readings (to rounding): more contracts of one cross-section are not more evidence of a price
    for (const edge of ['central', 'low', 'high'] as const) expect(twice.price.value![edge]).toBeCloseTo(once.price.value![edge], 0);
    for (const edge of ['low', 'high'] as const) expect(twice.floor.value![edge]).toBeCloseTo(once.floor.value![edge], 0);
    expect(twice.narrowsWhen).toMatch(/observed signings/i);
  });

  it("which contracts are market prices is Player Rights' free-agency answer for this season", () => {
    const veteran: Spec = { id: 1, days: 9 * YEAR, salary: 20_000_000, war: { prior: 3 } };
    expect(marketStandingOf(candidate(veteran).control)).toBe('market');
    expect(marketStandingOf(candidate({ ...veteran, days: 2 * YEAR }).control)).toBe('held_below_market');
    // A stale export makes his eligibility indeterminate, whatever his service: neither market nor below it
    const stale = candidate({ ...veteran, currentState: 'behind' });
    expect(marketStandingOf(stale.control)).toBe('indeterminate');
    const price = openingPriceOfWin(input(league({ currentState: 'behind' })));
    expect(price.population.market).toBe(0);
    expect(price.population.heldBelowMarket).toBe(0);
    expect(price.population.indeterminate).toBe(league().length);
    // He crossed the line this season: his salary was set before he was eligible (last winter's answer)
    const crossed = candidate({ id: 2, days: 6 * YEAR + 10, salary: 9_000_000, war: { prior: 2 } });
    expect(marketStandingOf(crossed.control)).toBe('held_below_market');
  });
});

describe('Player Value: the opening price rests only on enough of a season and enough of a market (hardening, B-13)', () => {
  const basis = (price: ReturnType<typeof openingPriceOfWin>, id: string) => price.bases.find((b) => b.id === id)!;
  const shares = (prior: number, twoBack = 1) => new Map([
    [PRIOR, fromExport(prior, 'team_history_record.g')], [PRIOR - 1, fromExport(twoBack, 'team_history_record.g')],
  ]);

  it("a short prior season prices a full season's salary in proportion to the schedule it covered, never as a full season", () => {
    const full = openingPriceOfWin(input(league()));
    // The same players and the same rates, in a prior season that played 37% of its schedule (a 60-game season)
    const specs = league().map((s) => ({ ...s, war: { ...s.war, prior: (s.war.prior ?? 0) * 0.37 } }));
    const short = openingPriceOfWin(input(specs, { seasonShares: shares(0.37) }));
    for (const id of ['A', 'B', 'C', 'C2']) {
      expect(basis(short, id).perWin.value, id).toBeCloseTo(basis(full, id).perWin.value!, -3);
    }
    // The two-season mean scales each season by its own share
    expect(basis(short, 'B2').perWin.value).toBeCloseTo(basis(full, 'B2').perWin.value!, -3);
    expect(short.price.value!.central).toBeCloseTo(full.price.value!.central, -3);
    // A league that shortened its schedule: a 162-game prior season against a 60-game one now is scaled down, not read as one season
    const longer = league().map((s) => ({ ...s, war: { ...s.war, prior: (s.war.prior ?? 0) * 2.7 } }));
    const shortened = openingPriceOfWin(input(longer, { seasonShares: shares(2.7) }));
    expect(basis(shortened, 'B').perWin.value).toBeCloseTo(basis(full, 'B').perWin.value!, -3);
    // ...and says so
    expect(basis(short, 'B').description).toMatch(/37% of this season's schedule/);
    expect(short.assumptions.join(' ')).toMatch(/schedule/i);
  });

  it("a season below the minimum share of its schedule is not used, and one whose share is unknown is not assumed full", () => {
    const tiny = openingPriceOfWin(input(league(), { seasonShares: shares(OPENING_PRICE_MINIMUMS.seasonShare - 0.05) }));
    for (const id of ['A', 'A2', 'B', 'B2', 'C', 'C2']) {
      expect(basis(tiny, id).perWin.value, id).toBeNull();
      expect(basis(tiny, id).perWin.note, id).toMatch(/minimum/i);
    }
    const unknownShare = openingPriceOfWin(input(league(), { seasonShares: new Map() }));
    for (const id of ['A', 'B', 'B2', 'C', 'C2']) {
      expect(basis(unknownShare, id).perWin.value, id).toBeNull();
      expect(basis(unknownShare, id).perWin.note, id).toMatch(/share of the schedule/i);
    }
    // The pace bases still stand on this season's share, and two readings still make a band
    expect(basis(unknownShare, 'B3').perWin.value).not.toBeNull();
  });

  it("this season's pace is not used before the minimum share of the season has been played", () => {
    const early = openingPriceOfWin(input(league(), { seasonFraction: fromExport(OPENING_PRICE_MINIMUMS.seasonShare - 0.05, 'team_record.g') }));
    for (const id of ['B3', 'C3']) {
      expect(basis(early, id).perWin.value, id).toBeNull();
      expect(basis(early, id).perWin.note, id).toMatch(/minimum/i);
    }
    const enough = openingPriceOfWin(input(league(), { seasonFraction: fromExport(OPENING_PRICE_MINIMUMS.seasonShare + 0.05, 'team_record.g') }));
    expect(basis(enough, 'B3').perWin.value).not.toBeNull();
    expect(early.assumptions.join(' ')).toMatch(/minimum/i);
  });

  it('a basis resting on fewer market contracts than the minimum is not computed, and with none left the price is unknown, never a point', () => {
    const thin = league({}, OPENING_PRICE_MINIMUMS.contracts - 2);
    const price = openingPriceOfWin(input(thin));
    for (const b of price.bases.filter((x) => x.role === 'market')) {
      expect(b.perWin.value, b.id).toBeNull();
      expect(b.perWin.note, b.id).toMatch(new RegExp(`minimum of ${OPENING_PRICE_MINIMUMS.contracts}`));
    }
    expect(price.price.value).toBeNull();
    expect(price.price.note).toMatch(/minimum/i);
    // Enough contracts on the whole market, too few signed this season: the C bases drop out, the B bases stand
    const halfSigned = openingPriceOfWin(input(league({}, OPENING_PRICE_MINIMUMS.contracts + 4)));
    expect(basis(halfSigned, 'B').perWin.value).not.toBeNull();
    expect(basis(halfSigned, 'C').perWin.value).toBeNull();
    expect(halfSigned.price.value).not.toBeNull();
  });
});

describe('Player Value: replacement level (phase 2)', () => {
  it('is the level the export\'s WAR implies: (league wins − league WAR) ÷ games, stamped provisional', () => {
    const r = replacementLevelOf({
      season: 2024, toDate: false,
      war: { season: 2024, byPlayer: new Map(), total: 1031.6, clubs: new Set([1, 2, 3]), source: 'test' },
      record: { season: 2024, clubs: new Set([1, 2, 3]), wins: 2429, games: 4858, source: 'team_history_record' },
    });
    expect(r.level.value).toBeCloseTo((2429 - 1031.6) / 4858, 10);
    expect(r.stamp.status).toBe('provisional');
  });

  it('a season whose standings lack a club that has WAR has no measured level, never one from the clubs that remain', () => {
    const r = replacementLevelOf({
      season: 2025, toDate: false,
      war: { season: 2025, byPlayer: new Map(), total: 1022, clubs: new Set([1, 2, 3]), source: 'test' },
      record: { season: 2025, clubs: new Set([1, 2]), wins: 2363, games: 4698, source: 'team_history_record' },
    });
    expect(r.level.value).toBeNull();
    expect(r.level.note).toMatch(/3/);
    const none = replacementLevelOf({ season: 2025, toDate: false, war: null, record: null });
    expect(none.level.value).toBeNull();
  });
});

describe('Player Value: Club Finances (phase 2)', () => {
  const MONEY = { total_revenue: 250e6, total_expenses: 200e6, budget: 240e6, gate_revenue: 60e6, media_revenue: 90e6 };
  const present = (row: Record<string, unknown>) => new Set(Object.keys(row));

  it('a history row whose every money field is zero is a placeholder, read as unknown and never as $0', () => {
    const zero = { team_id: 1, year: 2024, ...Object.fromEntries(Object.keys(MONEY).map((k) => [k, 0])), market: 0 };
    const real = { team_id: 1, year: 2025, ...MONEY, market: 7 };
    const current = { team_id: 1, ...MONEY, player_payroll: 190e6, market: 5, owner_expectation: 3 };
    const club = clubFinancesOf({
      teamId: 1, season: 2026, financials: fromExport(true, 'leagues.rules_financials'),
      current: { present: present(current), row: current },
      last: { present: null, row: null },
      history: { present: present(real), rows: [zero, real] },
    });
    const byYear = new Map(club.revenueTrend.seasons.map((s) => [s.season, s]));
    expect(byYear.get(2024)?.revenue.value ?? null).toBeNull();
    expect(byYear.get(2024)?.revenue.provenance ?? 'unknown').toBe('unknown');
    expect(byYear.get(2025)?.revenue.value).toBe(250e6);
    expect(club.revenueTrend.placeholderSeasons.count).toBe(1);
    // The same rule holds for the current row
    const blankNow = clubFinancesOf({
      teamId: 1, season: 2026, financials: fromExport(true, 'leagues.rules_financials'),
      current: { present: present(zero), row: { ...zero, year: undefined } },
      last: { present: null, row: null }, history: { present: null, rows: [] },
    });
    expect(blankNow.budget.value).toBeNull();
    expect(blankNow.revenue.value).toBeNull();
  });

  it('shows a value whose meaning the export does not establish as exported, and never interprets it', () => {
    const current = { team_id: 1, ...MONEY, market: 5, owner_expectation: 3, cash: 0, cash_trades_available: 22e6 };
    const club = clubFinancesOf({
      teamId: 1, season: 2026, financials: fromExport(true, 'leagues.rules_financials'),
      current: { present: present(current), row: current },
      last: { present: null, row: null }, history: { present: null, rows: [] },
    });
    expect(club.market.value).toBe(5);
    expect(club.market.meaning).toBe('unknown');
    expect(club.ownerExpectation.value).toBe(3);
    expect(club.ownerExpectation.meaning).toBe('unknown');
    // Cash for trades is cash_trades_available, never the dead `cash`
    expect(club.cashForTrades.value).toBe(22e6);
    expect(club.cashForTrades.source).toBe('team_financials.cash_trades_available');
    // A column the export lacks is unknown with its reason, never 0
    expect(club.payroll.offered.value).toBeNull();
    expect(club.payroll.offered.reason).toBe('not_exported_by_ootp');
    expect(club.authority.rule.length).toBeGreaterThan(20);
    expect(club.authority.alternatives.length).toBeGreaterThan(0);
  });

  it('a league that runs no financials shows no club money in dollars: each figure is unknown with that reason (hardening, D-017)', () => {
    const current = { team_id: 1, ...MONEY, player_payroll: 90e6, player_payroll_next_season: 60e6, cash_trades_available: 5e6, fan_interest: 50, market: 3 };
    const real = { team_id: 1, year: 2025, ...MONEY };
    const club = clubFinancesOf({
      teamId: 1, season: 2026, financials: fromExport(false, 'leagues.rules_financials'),
      current: { present: present(current), row: current },
      last: { present: present(current), row: current },
      history: { present: present(real), rows: [real] },
    });
    for (const [label, figure] of Object.entries({
      budget: club.budget, payroll: club.payroll.now, next: club.payroll.nextSeason, revenue: club.revenue,
      expenses: club.expenses, cash: club.cashForTrades,
    })) {
      expect(figure.value, label).toBeNull();
      expect(figure.note, label).toMatch(/runs no financials/);
    }
    expect(club.revenueTrend.seasons.every((s) => s.revenue.value === null)).toBe(true);
    expect(club.lastSeason?.revenue.value ?? null).toBeNull();
    // What is not money is still read as exported
    expect(club.fans.interest.value).toBe(50);
    // Whether it runs financials not established: the figures stay as exported, and say so
    const unsure = clubFinancesOf({
      teamId: 1, season: 2026, financials: unknownBecause('not_exported_by_ootp', 'leagues.rules_financials', 'blank'),
      current: { present: present(current), row: current },
      last: { present: null, row: null }, history: { present: null, rows: [] },
    });
    expect(unsure.budget.value).toBe(240e6);
    expect(unsure.budget.note).toMatch(/financials is not established/);
  });
});

describe('Player Value: the league read from the fixture import (phase 2)', () => {
  it('a league whose export does not say whether it runs financials has its dollars unknown, with the reason', () => {
    const league = leagueFinances(IDS.league);
    expect(league.priceOfWin.unit).toBe('wins');
    expect(league.priceOfWin.price.value).toBeNull();
    expect(league.priceOfWin.price.note).toMatch(/financials/i);
  });
});

describe('Player Value: the per-import market snapshot (phase 2)', () => {
  const clear = () => historyDb.prepare('DELETE FROM value_market_snapshots').run();
  beforeAll(clear);
  afterEach(() => {
    clear();
    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-01', IDS.league);
  });

  it('is written once per import key: re-running the same import writes nothing new', () => {
    const first = captureMarketSnapshot();
    expect(first.error).toBeNull();
    expect(first.written).toBe(1);
    const again = captureMarketSnapshot();
    expect(again.written).toBe(0);
    expect(again.existing).toBe(1);
    expect(marketSnapshotHistory(IDS.league)).toHaveLength(1);
    // A new game date is a new import key
    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-6-15', IDS.league);
    expect(captureMarketSnapshot().written).toBe(1);
    const history = marketSnapshotHistory(IDS.league);
    expect(history.map((h) => h.gameDate)).toEqual(['2030-06-01', '2030-06-15']);
    expect(history[0].priceLabel).toBe('opening: the imported market');
    expect(history[0].regime).toBeTruthy();
  });

  it('holding any number of snapshots leaves the price exactly as it was', () => {
    const before = leagueFinances(IDS.league).priceOfWin;
    captureMarketSnapshot();
    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-6-20', IDS.league);
    captureMarketSnapshot();
    expect(leagueFinances(IDS.league).priceOfWin).toEqual(before);
  });

  it('a snapshot that cannot be written never fails the import', () => {
    const failed = captureMarketSnapshot({ compute: () => { throw new Error('boom'); } });
    expect(failed.written).toBe(0);
    expect(failed.error).toMatch(/boom/);
  });
});

describe('Payroll lists every player it counts', () => {
  const EXTRA = Array.from({ length: 15 }, (_, i) => 900 + i);
  const copy = (table: string, from: number, to: number, set: Record<string, unknown> = {}) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE player_id = ?`).get(from) as Record<string, unknown> | undefined;
    if (!row) return;
    const next = { ...row, ...set, player_id: to };
    const cols = Object.keys(next);
    db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => next[c] as never));
  };
  beforeAll(() => {
    for (const id of EXTRA) {
      copy('players', IDS.starter, id, { first_name: 'Extra', last_name: String(id) });
      copy('players_roster_status', IDS.starter, id, { mlb_service_days: 10 * YEAR, mlb_service_years: 10, mlb_service_days_this_year: 40 });
      copy('players_contract', IDS.extended, id, { years: 1, current_year: 0, season_year: SEASON, salary0: 2_000_000 + id });
    }
  });
  afterAll(() => {
    for (const table of ['players', 'players_roster_status', 'players_contract']) {
      db.prepare(`DELETE FROM ${table} WHERE player_id IN (${EXTRA.join(',')})`).run();
    }
  });

  it('the count shown equals the rows listed, however many there are', async () => {
    const data = await request(`/api/payroll/${IDS.mlbTeam}`);
    for (const list of [data.comingOff, data.stillControlled, data.controlIndeterminate]) {
      expect(list.players).toHaveLength(list.count);
    }
    expect(data.comingOff.count).toBeGreaterThan(12);
  });

  it("reads its finance header from Club Finances, each figure with its source", async () => {
    const data = await request(`/api/club-finances/${IDS.mlbTeam}`);
    expect(data.club.budget.value).toBe(200_000_000);
    expect(data.club.budget.source).toBe('team_financials.budget');
    expect(data.league.priceOfWin.label).toBe('opening: the imported market');
    expect(Array.isArray(data.history)).toBe(true);
  });
});

describe('Player Value: the club\'s marginal value of a win (phase 5)', () => {
  it.todo('moves with its competitive position and never with its philosophy');
});
