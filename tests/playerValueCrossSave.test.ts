import { describe, expect, it } from 'vitest';
import { leagueRulesFromRow, type LeagueRuleRow } from '../server/leagueRules.js';
import {
  clearProductionCaches, clubFinances, leagueFinances, leaguePlayerValues, marketLeagues, playerProductionCone, productionCalibration,
  ratingsHistory, refitProductionIfNeeded, refitRatingsIfNeeded, type PlayerValuation,
  computeProductionRefits, computeRatingsRefits,
} from '../server/playerValue.js';
import { fitProductionModel } from '../server/playerValueProductionFit.js';
import { fitRatingsModel } from '../server/playerValueRatingsFit.js';
import { db } from '../server/db.js';
import { recordImportMarket } from '../server/api.js';
import { historyDb } from '../server/history.js';
import { PRODUCTION_PRIOR, RATINGS_PRIOR } from '../server/playerValueCalibration.js';
import { leagueSeasons } from '../server/playerValueHistory.js';
import { captureMarketSnapshot, marketSnapshotHistory, priceHistory } from '../server/playerValueSnapshot.js';
import { contractImports, contractSnapshots } from '../server/playerValueContractStore.js';
import request from './request';
import { COST_POLICY, OPENING_PRICE_MINIMUMS, SIGNINGS_POLICY } from '../server/playerValueCalibration.js';
import { advanceWinter, buildSave, dropColumn, dropTable, exec, insert, leagueRow, offseasonImport, type BuiltSave, type SaveSpec, type WinterContract } from './syntheticSave';
import { majorLeagueRow, minorLeagueRow } from './playerValueFixtures';

/*
 * Player Value across saves (hardening, 2026-09-23). Pennant has to hold its doctrine on saves that
 * look nothing like the developer's. Each case builds a synthetic save of one shape
 * (`tests/syntheticSave.ts`), runs every Player Value entry point over it, and asserts the invariants
 * that must hold on any save:
 *
 *   no crash          every entry point answers without an exception;
 *   no NaN            every number it serves is finite;
 *   unknown honest    every unknown carries its reason, and unknown production says why;
 *   labels honest     the fallback prior never calls itself calibrated, and a price in wins has no dollars;
 *
 * and then what that save's shape must not make confident. A case whose fix belongs to another change
 * is an `it.todo` naming its finding (F1: production and the fit store; F2: control and the UI; wave 2:
 * prospects), so the suite documents the gap without failing; it becomes a real case as the fix lands.
 *
 * Run it alone with `npx vitest run tests/playerValueCrossSave.test.ts`.
 */

const SLOW = 120_000;

interface Run {
  errors: string[];
  values: Map<number, PlayerValuation>;
  finances: Map<number, ReturnType<typeof leagueFinances>>;
  club: ReturnType<typeof clubFinances> | null;
  calibration: Map<number, ReturnType<typeof productionCalibration>>;
  cones: Array<NonNullable<ReturnType<typeof playerProductionCone>>>;
}

function attempt<T>(label: string, errors: string[], f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
    return null;
  }
}

/** Every Player Value entry point over the save as it stands. */
function run(save: BuiltSave, options: { refit?: boolean } = {}): Run {
  const errors: string[] = [];
  if (options.refit !== false) {
    attempt('refitProductionIfNeeded', errors, () => refitProductionIfNeeded());
    attempt('refitRatingsIfNeeded', errors, () => refitRatingsIfNeeded());
  }
  const values = attempt('leaguePlayerValues', errors, () => leaguePlayerValues({ currentState: 'current' })) ?? new Map();
  const leagues = attempt('marketLeagues', errors, () => marketLeagues()) ?? [];
  const finances = new Map<number, ReturnType<typeof leagueFinances>>();
  const calibration = new Map<number, ReturnType<typeof productionCalibration>>();
  for (const id of new Set([save.leagueId, ...leagues])) {
    const f = attempt(`leagueFinances(${id})`, errors, () => leagueFinances(id, { currentState: 'current' }));
    if (f) finances.set(id, f);
    const c = attempt(`productionCalibration(${id})`, errors, () => productionCalibration(id));
    if (c) calibration.set(id, c);
  }
  const club = attempt('clubFinances', errors, () => clubFinances(save.org));
  attempt('captureMarketSnapshot', errors, () => {
    const snapshot = captureMarketSnapshot();
    if (snapshot.error) throw new Error(snapshot.error);
  });
  const cones: Run['cones'] = [];
  for (const id of [save.regular, save.reliever, ...save.prospects.slice(0, 2)]) {
    const cone = attempt(`playerProductionCone(${id})`, errors, () => playerProductionCone(id, { currentState: 'current' }));
    if (cone) cones.push(cone);
  }
  return { errors, values, finances, club, calibration, cones };
}

/** Walks everything served, collecting non-finite numbers and unknowns without a reason. */
function audit(root: unknown): { nonFinite: string[]; unexplained: string[] } {
  const nonFinite: string[] = [];
  const unexplained: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (x: unknown, at: string): void => {
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) nonFinite.push(`${at} = ${x}`);
      return;
    }
    if (x === null || typeof x !== 'object') return;
    if (seen.has(x)) return;
    seen.add(x);
    if (x instanceof Map) { for (const [k, v] of x) walk(v, `${at}[${String(k)}]`); return; }
    if (x instanceof Set) { let i = 0; for (const v of x) walk(v, `${at}{${i++}}`); return; }
    if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${at}[${i}]`)); return; }
    const o = x as Record<string, unknown>;
    if ('provenance' in o && 'value' in o && o.value === null) {
      const note = typeof o.note === 'string' ? o.note.trim() : '';
      if (!o.reason && note.length === 0) unexplained.push(`${at} (${String(o.source)})`);
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`);
  };
  walk(root, '$');
  return { nonFinite, unexplained };
}

/** The invariants every save must hold, whatever its shape. */
function expectInvariants(r: Run): void {
  expect(r.errors, 'an entry point threw').toEqual([]);
  const { nonFinite, unexplained } = audit(r);
  expect(nonFinite.slice(0, 10), `${nonFinite.length} non-finite numbers served`).toEqual([]);
  expect(unexplained.slice(0, 10), `${unexplained.length} unknowns without a reason`).toEqual([]);
  for (const v of r.values.values()) {
    const p = v.production;
    if (p.status !== 'projected') {
      expect((p.reason ?? '').length, `player ${v.playerId}: unknown production without a reason`).toBeGreaterThan(0);
      continue;
    }
    for (const s of p.seasons) {
      expect(s.wins.low, `player ${v.playerId} ${s.season}`).toBeLessThanOrEqual(s.wins.central);
      expect(s.wins.central, `player ${v.playerId} ${s.season}`).toBeLessThanOrEqual(s.wins.high);
    }
    // The fallback prior is never presented as the save's own calibration (D-053)
    if (p.basis.model.source === 'fallback_prior') {
      expect(p.basis.model.label, `player ${v.playerId}`).toMatch(/not yet calibrated/i);
      expect(p.basis.model.stamp.status, `player ${v.playerId}`).not.toBe('calibrated');
    }
  }
  for (const [id, c] of r.calibration) {
    if (c.inForce.source === 'fallback_prior') {
      expect(c.inForce.label, `league ${id}`).toMatch(/not yet calibrated/i);
      expect(c.inForce.stamp.status, `league ${id}`).not.toBe('calibrated');
    }
  }
  for (const cone of r.cones) {
    if (cone.calibration.calibrated) expect(cone.calibration.source).toBe('save_fit');
    if (cone.status !== 'projected') expect((cone.reason ?? '').length).toBeGreaterThan(0);
  }
  // The cost of controlled seasons (phase 4a): ordered bands, never an arbitration season at the minimum,
  // the prior only where the regime is MLB's, and an unknown cost with its reason
  const minimumOf = new Map([...r.finances].map(([id, f]) => [id, f.costs.minimum.value]));
  const minimum = minimumOf.size === 1 ? [...minimumOf.values()][0] : null;
  for (const v of r.values.values()) {
    for (const s of v.control.seasons) {
      for (const [cost, basis, status] of [[s.cost, s.costBasis, s.status], [s.declined?.cost ?? null, s.declined?.costBasis, s.declined?.status]] as const) {
        if (!cost) continue;
        if (cost.value === null) {
          expect((cost.note ?? '').length, `player ${v.playerId} ${s.season}: an unknown cost without its reason`).toBeGreaterThan(0);
          continue;
        }
        expect(cost.value.low, `player ${v.playerId} ${s.season}`).toBeLessThanOrEqual(cost.value.high);
        if (status === 'arbitration' && minimum !== null) {
          // Never assumed to be the minimum: it reaches it only where the save paid the class the minimum, and says so (review)
          expect(cost.value.low, `player ${v.playerId} ${s.season}: an arbitration season below the minimum`).toBeGreaterThanOrEqual(minimum);
          if (cost.value.low === minimum) expect(cost.note, `player ${v.playerId} ${s.season}: at the minimum unsaid`).toMatch(/at the (league )?minimum/);
        }
        if (basis && basis.source !== 'measured') expect(cost.note, `player ${v.playerId} ${s.season}`).toMatch(/provisional/i);
        // A priced band carries its central inside it, or names each status's central (review, R2-03)
        if (basis) {
          expect(cost.value.central, `player ${v.playerId} ${s.season}: no central`).not.toBeUndefined();
          if (cost.value.central !== null && cost.value.central !== undefined) {
            expect(cost.value.central).toBeGreaterThanOrEqual(cost.value.low - 1e-6);
            expect(cost.value.central).toBeLessThanOrEqual(cost.value.high + 1e-6);
          } else {
            expect((basis.centrals ?? []).length, `player ${v.playerId} ${s.season}: no central and none named`).toBeGreaterThan(1);
          }
        }
      }
    }
  }
  for (const [id, f] of r.finances) {
    const price = f.priceOfWin;
    // A price in wins has no dollars at all; a price in dollars is a band, never a point
    if (price.unit === 'wins') {
      expect(price.price.value, `league ${id}`).toBeNull();
      expect(price.floor.value, `league ${id}`).toBeNull();
    }
    if (price.price.value !== null) expect(price.price.value.low, `league ${id}`).toBeLessThan(price.price.value.high);
    else expect((price.price.note ?? '').length, `league ${id}: an unknown price without its reason`).toBeGreaterThan(0);
  }
}

const base: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.5, clubs: 8, minors: true };

const priceOf = (r: Run, league: number) => r.finances.get(league)!.priceOfWin;
const basis = (r: Run, league: number, id: string) => priceOf(r, league).bases.find((b) => b.id === id)!;
/** A player's first side in one projected season (the production must be projected). */
const sideIn = (r: Run, id: number, season: number) => {
  const p = r.values.get(id)!.production;
  expect(p.status, `player ${id}: ${p.reason ?? ''}`).toBe('projected');
  return p.seasons.find((s) => s.season === season)!.sides[0];
};
/** Force the stored fit attempts adopted: what a fit that passed the gate would leave in the store. */
const adoptEveryAttempt = () => {
  historyDb.exec(`UPDATE value_production_fits SET adopted = 1`);
  clearProductionCaches();
};

describe('cross-save: a new or thin league', () => {
  it('a brand-new fictional league on Opening Day: everything answers, and nothing is priced or projected from evidence it has not got', () => {
    const save = buildSave({ ...base, historySeasons: 0, playedShare: 0, currentDate: '2040-4-1' });
    const r = run(save);
    expectInvariants(r);
    // No season has been played: there is no WAR to price a win with
    expect(priceOf(r, save.leagueId).price.value).toBeNull();
    expect(r.calibration.get(save.leagueId)!.inForce.source).toBe('fallback_prior');
  }, SLOW);

  it("a brand-new league two weeks in: this season's pace is below the minimum share, so it prices nothing", () => {
    const save = buildSave({ ...base, historySeasons: 0, playedShare: 0.08 });
    const r = run(save);
    expectInvariants(r);
    for (const id of ['B3', 'C3']) {
      expect(basis(r, save.leagueId, id).perWin.value, id).toBeNull();
      expect(basis(r, save.leagueId, id).perWin.note, id).toMatch(/minimum/);
    }
    expect(priceOf(r, save.leagueId).price.value).toBeNull();
  }, SLOW);

  it("D-02 (F1): in a league's first seasons, a season before the league existed is unknown usage, never zero: a first-season regular's next-season 80% usage band contains a regular's playing time", () => {
    // The same kind of regular in a league with six seasons behind it: his next season's playing time
    const old = buildSave({ ...base, playedShare: 0.25 });
    const established = sideIn(run(old, { refit: false }), old.regular, base.season + 1).usage;
    const save = buildSave({ ...base, historySeasons: 0, playedShare: 0.25 });
    const r = run(save, { refit: false });
    expectInvariants(r);
    const usage = sideIn(r, save.regular, base.season + 1).usage;
    // The seasons the league never played are not read as nothing: his band holds a regular's playing time
    expect(usage.low).toBeLessThanOrEqual(established.central);
    expect(usage.high).toBeGreaterThanOrEqual(established.central);
    expect(usage.high).toBeGreaterThan(0.9 * established.high);
  }, SLOW);

  it('two completed seasons: the fallback prior is in force and labelled "not yet calibrated"', () => {
    const save = buildSave({ ...base, season: 2042, historySeasons: 2, playedShare: 0.3 });
    const r = run(save);
    expectInvariants(r);
    const inForce = r.calibration.get(save.leagueId)!.inForce;
    expect(inForce.label).toMatch(/not yet calibrated/i);
  }, SLOW);

  it('three completed seasons, the third just finished (playoffs): the completed season is fitted without error', () => {
    const save = buildSave({ ...base, season: 2043, historySeasons: 2, playedShare: 1, currentDate: '2043-10-10' });
    const r = run(save);
    expectInvariants(r);
    const attempt = r.calibration.get(save.leagueId)!.latestAttempt;
    expect(attempt?.throughSeason ?? null).toBe(2043);
  }, SLOW);

  it('D-09 (F1): an adopted fit that is mostly the fallback prior is not stamped "calibrated"', () => {
    const save = buildSave(base);
    run(save);
    adoptEveryAttempt();
    const inForce = productionCalibration(save.leagueId).inForce;
    expect(inForce.source).toBe('save_fit');
    // Six seasons of eight clubs: no held-out season was scored and every horizon leans on the prior, so it is not the save's calibration
    expect(inForce.label).toMatch(/not yet calibrated/i);
    expect(inForce.stamp.status).not.toBe('calibrated');
    for (const cone of run(save, { refit: false }).cones) expect(cone.calibration.calibrated).toBe(false);
  }, SLOW);
});

describe('cross-save: schedule length', () => {
  it('a 60-game schedule, mid-season: every answer holds and a past 60-game season is a full season', () => {
    const save = buildSave({ ...base, gamesPerTeam: 60, bankedPerSeason: 69 });
    const r = run(save);
    expectInvariants(r);
    expect(basis(r, save.leagueId, 'B').description).not.toMatch(/scaled/);
  }, SLOW);

  it('a 100-game schedule, mid-season', () => {
    const save = buildSave({ ...base, gamesPerTeam: 100, bankedPerSeason: 115 });
    expectInvariants(run(save));
  }, SLOW);

  it("a short prior season (60 of 162 games, as 2020 in a historical save) prices this season's salaries only on a full season's footing (B-13)", () => {
    const save = buildSave({ ...base, clubs: 12 });
    exec(`UPDATE team_history_record SET g = 60, w = 30, l = 30 WHERE year = ${base.season - 1}`);
    exec(`UPDATE players_career_batting_stats SET war = war * 60.0 / 162, pa = pa * 60 / 162 WHERE year = ${base.season - 1}`);
    exec(`UPDATE players_career_pitching_stats SET war = war * 60.0 / 162, bf = bf * 60 / 162 WHERE year = ${base.season - 1}`);
    const r = run(save, { refit: false });
    expectInvariants(r);
    expect(basis(r, save.leagueId, 'A').description).toMatch(/scaled from 37% of this season's schedule/);
  }, SLOW);

  it('the schedule lengthened (162 now, 100 before): a past season is put on this season\'s footing for the price', () => {
    const save = buildSave({ ...base, pastGamesPerTeam: 100 });
    const r = run(save);
    expectInvariants(r);
    expect(basis(r, save.leagueId, 'A').description).toMatch(/scaled from 62% of this season's schedule/);
  }, SLOW);

  it.todo('D-03 (F2): once a short season is over, no service day "remains this season", and the Super Two class is not built from phantom days');
  it.todo('D-04 (F2): in a short-schedule league a later season banks the days the league\'s season actually banks, so free agency is not shown definite seasons early');
  it("D-05 (F1): playing time is scaled to the schedule: a 60-game regular's 80% band never exceeds the plate appearances the schedule allows", () => {
    const save = buildSave({ ...base, gamesPerTeam: 60, bankedPerSeason: 69 });
    const r = run(save);
    expectInvariants(r);
    // The most plate appearances any hitter has had in one of this league's 60-game seasons
    const most = (db.prepare(`SELECT MAX(pa) AS m FROM players_career_batting_stats WHERE split_id = 1 AND level_id = 1 AND year < ${base.season}`).get() as { m: number }).m;
    for (const id of save.hitters) {
      const p = r.values.get(id)!.production;
      if (p.status !== 'projected') continue;
      for (const s of p.seasons.slice(1)) for (const side of s.sides) if (side.side === 'batting') expect(side.usage.high, `player ${id} ${s.season}`).toBeLessThanOrEqual(most);
    }
  }, SLOW);

  it("D-06 (F1): a season's share of its own schedule is measured against that season's schedule, so a league that lengthened its schedule keeps its history for the fit", () => {
    const save = buildSave({ ...base, pastGamesPerTeam: 100 });
    const r = run(save);
    expectInvariants(r);
    const seasons = leagueSeasons(save.leagueId, base.season - 1);
    expect(seasons.length).toBe(base.historySeasons);
    for (const s of seasons) expect(s.scheduleShare, `${s.season}`).toBeCloseTo(1, 5);
    const attempt = r.calibration.get(save.leagueId)!.latestAttempt!;
    expect(attempt.reason).toMatch(new RegExp(`${base.historySeasons} usable seasons`));
  }, SLOW);
});

describe('cross-save: contract and financial regimes', () => {
  it('a reserve clause with no arbitration: no contract is a market price, so dollars are unknown with the reason', () => {
    const save = buildSave({ ...base, rules: { rules_fa_minimum_years: 0, rules_salary_arbitration_minimum_years: 0 } });
    const r = run(save);
    expectInvariants(r);
    expect(priceOf(r, save.leagueId).price.value).toBeNull();
    expect(priceOf(r, save.leagueId).price.note).toMatch(/market/i);
  }, SLOW);

  it('free agency at six years with no arbitration', () => {
    const save = buildSave({ ...base, rules: { rules_salary_arbitration_minimum_years: 0 } });
    expectInvariants(run(save));
  }, SLOW);

  it('financials off: the price is in wins, and the club\'s budget and payroll are unknown with the reason, never dollars (D-17)', () => {
    const save = buildSave({ ...base, rules: { rules_financials: 0 } });
    const r = run(save);
    expectInvariants(r);
    const f = r.finances.get(save.leagueId)!;
    expect(f.priceOfWin.unit).toBe('wins');
    for (const figure of [r.club!.budget, r.club!.payroll.now, r.club!.payroll.nextSeason, r.club!.revenue, r.club!.cashForTrades]) {
      expect(figure.value).toBeNull();
      expect(figure.note).toMatch(/runs no financials/);
    }
    expect(f.leaguePayroll.value).toBeNull();
  }, SLOW);

  it('financials on and no salaries exported: dollars are unknown, never a price built on $0', () => {
    const save = buildSave({ ...base, salaries: false });
    const r = run(save);
    expectInvariants(r);
    expect(priceOf(r, save.leagueId).price.value).toBeNull();
  }, SLOW);

  it('a market thinner than the policy minimum prices nothing: dollars are unknown, never a point (B-13)', () => {
    const save = buildSave({ ...base, clubs: 1 });
    const r = run(save, { refit: false });
    expectInvariants(r);
    const market = priceOf(r, save.leagueId).population.market;
    expect(market).toBeLessThan(OPENING_PRICE_MINIMUMS.contracts);
    expect(priceOf(r, save.leagueId).price.value).toBeNull();
  }, SLOW);

  it('non-MLB rules (free agency 4, arbitration 2, a 150-day service year, a salary cap)', () => {
    const save = buildSave({
      ...base, rules: { rules_fa_minimum_years: 4, rules_salary_arbitration_minimum_years: 2, rules_min_service_days: 150, rules_salary_cap: 120_000_000 },
    });
    expectInvariants(run(save));
  }, SLOW);
});

describe('cross-save: the cost of controlled seasons (phase 4a)', () => {
  const seasonsOf = (r: Run) => [...r.values.values()].flatMap((v) => v.control.seasons);
  const priced = (r: Run, method: string) => seasonsOf(r).filter((s) => s.costBasis?.method === method && s.cost?.value);

  it('a fictional league without arbitration: no season is priced from an arbitration ladder, and the ladder says the league has none', () => {
    const save = buildSave({ ...base, rules: { rules_salary_arbitration_minimum_years: 0 } });
    const r = run(save);
    expectInvariants(r);
    const costs = r.finances.get(save.leagueId)!.costs;
    expect(costs.arbitration.status).toBe('no_arbitration');
    expect(costs.arbitration.classes).toEqual([]);
    expect(seasonsOf(r).filter((s) => s.status === 'arbitration')).toEqual([]);
    expect(priced(r, 'arbitration_ladder')).toEqual([]);
    // No season lists arbitration among what it could be, and one straddling free agency is a renewal if held (review, R2-07)
    expect(seasonsOf(r).filter((s) => s.between.includes('arbitration'))).toEqual([]);
    const open = seasonsOf(r).filter((s) => s.status === 'indeterminate' && s.between.includes('free_agent') && s.between.includes('pre_arbitration'));
    expect(open.length).toBeGreaterThan(0);
    for (const s of open) {
      if (!s.cost?.value) continue;
      expect(s.costBasis).toMatchObject({ method: 'renewal_spread', ifHeld: true });
    }
  }, SLOW);

  it("a small league in MLB's regime: a few contracts in a thin class never set a slope that runs its bands far past what the league pays (review, R2-02)", () => {
    const save = buildSave(base);
    const r = run(save);
    expectInvariants(r);
    const classes = r.finances.get(save.leagueId)!.costs.arbitration.classes;
    for (const c of classes) {
      if (c.cases >= COST_POLICY.ladder.minimumCases) continue;
      expect(c.readings.map((x) => x.source), `class ${c.arbitrationClass}`).toEqual(['prior']);
    }
    const largest = Math.max(...[...r.values.values()].map((v) => v.contract.term?.seasons[0]?.salary.value ?? 0));
    const highs = priced(r, 'arbitration_ladder').map((s) => s.cost!.value!.high);
    expect(highs.length).toBeGreaterThan(0);
    // Before the review a 5-contract line reached $83M on a league whose largest salary is $15M
    expect(Math.max(...highs)).toBeLessThan(2 * largest);
  }, SLOW);

  it('a league with its own minimum salary: a renewal starts at that minimum, never MLB\'s', () => {
    const save = buildSave({ ...base, rules: { rules_minimum_salary: 300_000 } });
    const r = run(save);
    expectInvariants(r);
    const costs = r.finances.get(save.leagueId)!.costs;
    expect(costs.minimum.value).toBe(300_000);
    expect(priced(r, 'renewal_spread').length).toBeGreaterThan(0);
    for (const s of priced(r, 'renewal_spread')) expect(s.cost!.value!.low).toBe(300_000);
    for (const s of priced(r, 'arbitration_ladder')) expect(s.cost!.value!.low).toBeGreaterThan(300_000);
  }, SLOW);

  it('a thin arbitration class in MLB\'s regime is the provisional prior widened by its own cases, and says so', () => {
    const save = buildSave({ ...base, clubs: 4 });
    const r = run(save);
    expectInvariants(r);
    const classes = r.finances.get(save.leagueId)!.costs.arbitration.classes;
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) {
      if (c.cases >= COST_POLICY.ladder.minimumCases) continue;
      expect(['thin', 'prior']).toContain(c.status);
      expect(c.readings.some((x) => x.source === 'prior')).toBe(true);
    }
    expect(priced(r, 'arbitration_ladder').length).toBeGreaterThan(0);
    for (const s of priced(r, 'arbitration_ladder')) {
      if (s.costBasis!.source !== 'measured') expect(s.cost!.note).toMatch(/provisional/i);
    }
  }, SLOW);

  it("a regime that is not MLB's never borrows MLB's ladder: a thin class leaves the arbitration cost unknown with the reason", () => {
    const save = buildSave({ ...base, rules: { rules_fa_minimum_years: 7 } });
    const r = run(save);
    expectInvariants(r);
    const classes = r.finances.get(save.leagueId)!.costs.arbitration.classes;
    for (const c of classes) expect(c.readings.some((x) => x.source === 'prior'), `class ${c.arbitrationClass}`).toBe(false);
    for (const s of seasonsOf(r).filter((x) => x.status === 'arbitration' && x.cost && x.cost.value === null)) {
      expect(s.cost!.note).toMatch(/not MLB's|fewer than|production|not established|price of a win/);
    }
    for (const s of priced(r, 'arbitration_ladder')) expect(s.costBasis!.source).toBe('measured');
  }, SLOW);

  it('an arbitration rule the export does not state: no season is priced from any ladder, and the cost is unknown with the reason', () => {
    const save = buildSave({ ...base, rules: { rules_salary_arbitration_minimum_years: null } });
    const r = run(save);
    expectInvariants(r);
    expect(r.finances.get(save.leagueId)!.costs.arbitration.status).toBe('unknown');
    expect(priced(r, 'arbitration_ladder')).toEqual([]);
  }, SLOW);

  it('the market snapshot records the cost ladder beside the price', () => {
    const save = buildSave(base);
    const r = run(save);
    expectInvariants(r);
    const basisJson = historyDb.prepare(`SELECT basis_json FROM value_market_snapshots WHERE league_id = ?`).get(save.leagueId) as { basis_json: string };
    const recorded = JSON.parse(basisJson.basis_json);
    expect(recorded.costs.preArbitration.cases).toBe(r.finances.get(save.leagueId)!.costs.preArbitration.cases);
    expect(recorded.costs.arbitration.status).toBe(r.finances.get(save.leagueId)!.costs.arbitration.status);
  }, SLOW);
});

describe('cross-save: observed signings across imports (phase 4b)', () => {
  const MIN = 700_000;
  type Standing = 'free_agency' | 'arbitration' | 'pre_arbitration' | 'reserve_clause' | 'indeterminate';

  /** The earlier import: a save whose major-league deals run three seasons, with the players the winter touches expiring now. */
  function earlierImport(spec: SaveSpec, expiring: (s: Standing, i: number) => boolean) {
    const save = buildSave(spec);
    exec(`UPDATE players_contract SET years = 3, salary1 = salary0, salary2 = salary0 WHERE is_major = 1`);
    const values = leaguePlayerValues({ currentState: 'current' });
    const by = new Map<Standing, number[]>();
    for (const v of values.values()) {
      if (v.control.standing !== 'held' || v.contract.kind.value !== 'major_league') continue;
      const next = v.control.eligibility?.seasons.find((x) => x.season === spec.season + 1)?.standing as Standing | undefined;
      if (!next) continue;
      const list = by.get(next) ?? [];
      list.push(v.playerId);
      by.set(next, list);
    }
    const expire: number[] = [];
    for (const [s, ids] of by) ids.forEach((id, i) => { if (expiring(s, i)) expire.push(id); });
    if (expire.length > 0) exec(`UPDATE players_contract SET years = 1 WHERE player_id IN (${expire.join(',')})`);
    const first = captureMarketSnapshot();
    expect(first.error).toBeNull();
    const ids = (s: Standing) => (by.get(s) ?? []).filter((id) => expire.includes(id));
    return { save, ids, clubOf: (id: number) => (db.prepare(`SELECT team_id FROM players WHERE player_id = ?`).get(id) as { team_id: number }).team_id };
  }

  /** What the earlier import expected of a player next season (its stored snapshot), in wins. */
  const expectedNext = (league: number, id: number, season: number): number => {
    const earlier = contractSnapshots(league)[0];
    const p = earlier.rows.find((r) => r.playerId === id)?.production?.seasons.find((x) => x.season === season);
    return p?.central ?? 0;
  };

  /** Free agents signing elsewhere at a price per expected win (money above the minimum over the earlier import's expected wins). */
  function freeAgents(e: ReturnType<typeof earlierImport>, ids: number[], perWin: (i: number) => number, oneYear = false): WinterContract[] {
    const clubs = e.save.clubs;
    return ids.map((id, i) => {
      const from = e.clubOf(id);
      const to = clubs[(clubs.indexOf(from) + 1 + (i % (clubs.length - 1))) % clubs.length];
      const years = oneYear ? 1 : 1 + (i % 3);
      const w = Math.max(0.3, expectedNext(e.save.leagueId, id, e.save.spec.season + 1));
      return { playerId: id, club: to, years, salaries: [Math.round(MIN + perWin(i) * w)] };
    });
  }

  const observed = (league: number) => leagueFinances(league, { currentState: 'current' }).observed;
  const big: SaveSpec = { ...base, clubs: 16, historySeasons: 8, minors: false };

  it('an off-season sequence: free-agent signings, extensions, arbitration salaries, non-tenders, renewals and a contract that moved are identified and counted, and each import is recorded once', () => {
    const e = earlierImport(big, (s, i) => s === 'free_agency' || (s === 'arbitration' && i < 12) || (s === 'pre_arbitration' && i < 10));
    const L = e.save.leagueId;
    const Y = big.season;
    const rows = () => (historyDb.prepare(`SELECT COUNT(*) AS n FROM value_contract_snapshots`).get() as { n: number }).n;
    const once = rows();
    expect(once).toBeGreaterThan(0);
    // A second capture of the same import writes nothing and computes nothing
    expect(captureMarketSnapshot().written).toBe(0);
    expect(rows()).toBe(once);

    const fa = e.ids('free_agency');
    const arb = e.ids('arbitration');
    const pre = e.ids('pre_arbitration');
    expect(fa.length).toBeGreaterThanOrEqual(4);
    expect(arb.length).toBeGreaterThanOrEqual(8);
    const moved = [...(db.prepare(`SELECT player_id FROM players_contract WHERE years = 3 AND is_major = 1 LIMIT 1`).all() as Array<{ player_id: number }>)][0].player_id;
    const movedTo = e.save.clubs.find((c) => c !== e.clubOf(moved))!;
    const movedSalary = (db.prepare(`SELECT salary0 FROM players_contract WHERE player_id = ?`).get(moved) as { salary0: number }).salary0;
    advanceWinter(e.save, {
      playedShare: 0.2,
      contracts: [
        ...freeAgents(e, fa.slice(2), () => 5e6),
        // Two free agents stay with the club that held them
        ...fa.slice(0, 2).map((id) => ({ playerId: id, club: e.clubOf(id), years: 2, salaries: [4e6] })),
        // Arbitration: salaries, two at the minimum, two with no club, one extension
        ...arb.slice(0, 7).map((id, i) => ({ playerId: id, club: e.clubOf(id), salaries: [MIN + 1e6 + i * 4e5] })),
        ...arb.slice(7, 9).map((id) => ({ playerId: id, club: e.clubOf(id), salaries: [MIN] })),
        ...arb.slice(9, 11).map((id) => ({ playerId: id, club: null })),
        ...arb.slice(11, 12).map((id) => ({ playerId: id, club: e.clubOf(id), years: 4, salaries: [3e6] })),
        // Renewals before arbitration, one extension
        ...pre.slice(0, 9).map((id, i) => ({ playerId: id, club: e.clubOf(id), salaries: [MIN + i * 5_000] })),
        ...pre.slice(9, 10).map((id) => ({ playerId: id, club: e.clubOf(id), years: 5, salaries: [1e6] })),
        // A contract that moves to another club on the same terms
        { playerId: moved, club: movedTo, firstSeason: Y, years: 3, salaries: [movedSalary] },
      ],
    });
    const later = captureMarketSnapshot();
    expect(later.error).toBeNull();
    expect(contractSnapshots(L)).toHaveLength(2);

    const o = observed(L);
    expect(o.pairs).toHaveLength(1);
    const pair = o.pairs[0];
    expect(pair.spansWinter).toBe(true);
    expect(pair.counts.free_agent_signing).toBe(fa.length - 2);
    expect(pair.counts.retained_at_free_agency).toBe(2);
    expect(pair.counts.arbitration_salary).toBe(7);
    expect(pair.counts.arbitration_at_minimum).toBe(2);
    expect(pair.counts.not_retained).toBe(2);
    expect(pair.counts.extension).toBe(2);
    expect(pair.counts.renewal).toBe(Math.min(9, pre.length));
    expect(pair.counts.transferred).toBe(1);
    // Named for what changed, never a transaction the export does not carry (D-020)
    for (const c of pair.changes) {
      expect(c.changed.length).toBeGreaterThan(0);
      expect(`${c.reading} ${c.left ?? ''}`).not.toMatch(/\boptioned\b|\brecalled\b|\bDFA\b|designated for assignment|outright/i);
    }
    // Every observed arbitration salary is scored against the band the earlier import priced for it
    expect(o.awards.status).toBe('scored');
    expect(o.awards.scored).toBeGreaterThan(0);
    expect(o.awards.coverage).not.toBeNull();
    expectInvariants(run(e.save, { refit: false }));
  }, SLOW);

  it('a measured band wider than the opening one leaves the opening price in force, naming the signings observed and both bands', () => {
    const e = earlierImport(big, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const fa = e.ids('free_agency');
    expect(fa.length).toBeGreaterThanOrEqual(OPENING_PRICE_MINIMUMS.contracts);
    const opening = leagueFinances(L, { currentState: 'current' }).priceOfWin;
    // Few signings elsewhere, at prices that have nothing to do with the wins bought (a very wide resampled band); every
    // other free agent stays with his club at a sensible price, in the opening's market bases and never in the measured one
    const few = fa.filter((id) => expectedNext(L, id, big.season + 1) >= 0.5).slice(0, OPENING_PRICE_MINIMUMS.contracts + 1);
    const stay = fa.filter((id) => !few.includes(id)).map((id) => ({
      playerId: id, club: e.clubOf(id), salaries: [Math.round(MIN + 5e6 * Math.max(0.3, expectedNext(L, id, big.season + 1)))],
    }));
    advanceWinter(e.save, { playedShare: 0.2, contracts: [...freeAgents(e, few, (i) => (i % 2 === 0 ? 0.1e6 : 40e6), true), ...stay] });
    captureMarketSnapshot();
    const f = leagueFinances(L, { currentState: 'current' });
    expect(f.observed.measured.status).toBe('measured');
    expect(f.priceOfWin.stage).toBe('opening');
    expect(f.priceOfWin.adoption!.inForce).toBe('opening');
    expect(f.priceOfWin.adoption!.reason).toMatch(new RegExp(`${f.observed.measured.observed} free-agent signings observed`));
    // One winter holds no realized reading, so the bands are not yet compared like for like (R4-01)
    expect(f.priceOfWin.adoption!.reason).toMatch(/realized/);
    // The opening price in force is this import's own opening reading
    expect(f.priceOfWin.label).toBe(opening.label);
  }, SLOW);

  it('a league whose signings are too few is not measured: the opening price stays and says how many were observed', () => {
    const e = earlierImport({ ...base, clubs: 4, minors: false }, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const fa = e.ids('free_agency').slice(0, 12);
    expect(fa.length).toBeLessThan(OPENING_PRICE_MINIMUMS.contracts);
    advanceWinter(e.save, { playedShare: 0.2, contracts: freeAgents(e, fa, () => 5e6) });
    captureMarketSnapshot();
    const f = leagueFinances(L, { currentState: 'current' });
    expect(f.observed.measured.status).toBe('not_measured');
    expect(f.observed.measured.price.note).toMatch(new RegExp(`${fa.length} free-agent signing`));
    expect(f.priceOfWin.stage).toBe('opening');
    expect(f.priceOfWin.adoption!.reason).toMatch(/opening price stays/i);
  }, SLOW);

  it('a fictional league without arbitration observes no arbitration salaries and says it has none to score; its controlled players are renewed', () => {
    const spec = { ...base, clubs: 8, minors: false, rules: { rules_salary_arbitration_minimum_years: 0 } };
    const e = earlierImport(spec, (s, i) => s === 'pre_arbitration' && i < 12);
    const pre = e.ids('pre_arbitration');
    expect(e.ids('arbitration')).toEqual([]);
    advanceWinter(e.save, { playedShare: 0.2, contracts: pre.map((id) => ({ playerId: id, club: e.clubOf(id), salaries: [MIN + 10_000] })) });
    captureMarketSnapshot();
    const o = observed(e.save.leagueId);
    expect(o.pairs[0].counts.arbitration_salary ?? 0).toBe(0);
    expect(o.pairs[0].counts.renewal).toBe(pre.length);
    expect(o.awards.status).toBe('no_arbitration');
    expectInvariants(run(e.save, { refit: false }));
  }, SLOW);

  it('reserve-clause renewals observed across imports price a reserve-clause season; before they are observed it stays unknown', () => {
    const spec = { ...base, clubs: 8, minors: false, rules: { rules_fa_minimum_years: 0 } };
    const e = earlierImport(spec, (s, i) => s === 'reserve_clause' && i < 60);
    const L = e.save.leagueId;
    const renewed = e.ids('reserve_clause');
    expect(renewed.length).toBeGreaterThanOrEqual(COST_POLICY.renewal.minimumCases);
    const reserveSeason = (vals: Map<number, PlayerValuation>) => [...vals.values()].flatMap((v) => v.control.seasons).find((s) => s.status === 'reserve_clause' && s.cost);
    const before = reserveSeason(leaguePlayerValues({ currentState: 'current' }))!;
    expect(before.cost!.value).toBeNull();
    advanceWinter(e.save, { playedShare: 0.2, contracts: renewed.map((id, i) => ({ playerId: id, club: e.clubOf(id), salaries: [MIN + (i % 8) * 150_000] })) });
    captureMarketSnapshot();
    const f = leagueFinances(L, { currentState: 'current' });
    expect(f.observed.pairs[0].counts.reserve_clause_renewal).toBe(renewed.length);
    expect(f.observed.reserveClause.status).toBe('measured');
    const after = reserveSeason(leaguePlayerValues({ currentState: 'current' }))!;
    expect(after.cost!.value!.low).toBe(MIN);
    expect(after.cost!.value!.high).toBeGreaterThan(MIN);
    expect(after.cost!.note).toMatch(/reserve-clause renewals/);
  }, SLOW);

  it("players who joined a club for nothing measure replacement from freely available talent; the measured price stays in the export's WAR and says so (R3-06, R4-06)", () => {
    const e0 = buildSave(big);
    exec(`UPDATE players_contract SET years = 3, salary1 = salary0, salary2 = salary0 WHERE is_major = 1`);
    // Forty major leaguers no club holds at the earlier import, near the export's replacement level (about 0.1 WAR per
    // 600 plate appearances): their production is established, so it is recorded
    const free = e0.hitters.filter((_, i) => i % 5 === 0).slice(0, 40);
    exec(`UPDATE players_career_batting_stats SET war = ROUND(pa / 6000.0, 1) WHERE split_id = 1 AND player_id IN (${free.join(',')});
      UPDATE players SET team_id = 0, organization_id = 0, league_id = 0 WHERE player_id IN (${free.join(',')});
      DELETE FROM players_contract WHERE player_id IN (${free.join(',')}); DELETE FROM team_roster WHERE player_id IN (${free.join(',')})`);
    const values = leaguePlayerValues({ currentState: 'current' });
    const market = [...values.values()].filter((v) => v.control.standing === 'held' && v.contract.kind.value === 'major_league'
      && v.control.eligibility?.seasons.find((x) => x.season === big.season + 1)?.standing === 'free_agency').map((v) => v.playerId);
    exec(`UPDATE players_contract SET years = 1 WHERE player_id IN (${market.join(',')})`);
    captureMarketSnapshot();
    const L = e0.leagueId;
    const clubOf = (id: number) => (db.prepare(`SELECT team_id FROM players WHERE player_id = ?`).get(id) as { team_id: number }).team_id;
    advanceWinter(e0, {
      playedShare: 0.3,
      contracts: [
        // Signed for nothing: a major-league deal at the minimum with a club that did not hold them
        ...free.map((id, i) => ({ playerId: id, club: e0.clubs[i % e0.clubs.length], salaries: [MIN] })),
        // And a market of free agents signing elsewhere
        ...market.map((id, i) => {
          const from = clubOf(id);
          const to = e0.clubs[(e0.clubs.indexOf(from) + 1 + (i % (e0.clubs.length - 1))) % e0.clubs.length];
          return { playerId: id, club: to, salaries: [Math.round(MIN + 5e6 * Math.max(0.3, expectedNext(L, id, big.season + 1)))] };
        }),
      ],
    });
    captureMarketSnapshot();
    const f = leagueFinances(L, { currentState: 'current' });
    expect(f.observed.replacement.status).toBe('measured');
    expect(f.observed.replacement.players).toBeGreaterThanOrEqual(SIGNINGS_POLICY.replacement.minimumPlayers);
    expect(f.observed.replacement.text).toMatch(/freely acquired players/);
    expect(f.observed.measured.status).toBe('measured');
    expect(f.observed.measured.replacement).toBe('export_convention');
    expect(f.observed.measured.text).toMatch(/export's (own )?WAR/);
    expect(f.observed.replacement.text).toMatch(/who played/);
    expectInvariants(run(e0, { refit: false }));
  }, SLOW);

  it('one import: no off-season observed, said precisely, and the opening price stays in force', () => {
    const save = buildSave(big);
    captureMarketSnapshot();
    const f = leagueFinances(save.leagueId, { currentState: 'current' });
    expect(f.observed.measured.status).toBe('no_off_season');
    expect(f.observed.measured.price.note).toMatch(/No off-season observed yet: the measured price needs two imports across a winter/);
    expect(f.observed.measured.price.note).toMatch(/1 import recorded/);
    expect(f.priceOfWin.stage).toBe('opening');
    expect(f.priceOfWin.adoption!.reason).toMatch(/No off-season observed yet/);
    expect(f.observed.replacement.status).toBe('not_measured');
    expect(f.observed.replacement.text).toMatch(/provisional/);
  }, SLOW);

  it("a new save under a reused save name and league id never reads the previous save's contracts", () => {
    const first = buildSave(big);
    captureMarketSnapshot();
    const rows = historyDb.prepare(`SELECT * FROM value_contract_snapshots`).all() as Array<Record<string, unknown>>;
    const imports = historyDb.prepare(`SELECT * FROM value_contract_imports`).all() as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const second = buildSave({ ...big, seed: 2 });
    for (const [table, list] of [['value_contract_snapshots', rows], ['value_contract_imports', imports]] as const) {
      for (const row of list) {
        const cols = Object.keys(row);
        historyDb.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
      }
    }
    clearProductionCaches();
    expect(contractSnapshots(second.leagueId)).toEqual([]);
    expect(first.leagueId).toBe(second.leagueId);
  }, SLOW);
  // ── phase 4b review (2026-09-24): each case written before its fix ──

  it('R3-01: imports across one winter, one of them after the season number moved on, see every signing as a market price and count one winter', () => {
    const e = earlierImport(big, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const Y = big.season;
    const fa = e.ids('free_agency').filter((id) => expectedNext(L, id, Y + 1) >= 0.3);
    const groups = [0, 1, 2].map((k) => fa.filter((_, i) => i % 3 === k));
    // The season over, before the bump: nothing signed yet
    offseasonImport(e.save, { date: `${Y}-10-20`, bump: false, contracts: [] });
    captureMarketSnapshot();
    // December: the league is on the next season number, last season's standings beside it; the first signings
    offseasonImport(e.save, { date: `${Y}-12-10`, bump: true, contracts: freeAgents(e, groups[0], () => 5e6, true) });
    captureMarketSnapshot();
    // Last season's standings beside the new season number are not games played in it (D-08)
    expect(leagueFinances(L, { currentState: 'current' }).seasonPlayed.value).toBeNull();
    // January, still before Opening Day: more signings
    offseasonImport(e.save, { date: `${Y + 1}-1-20`, bump: true, contracts: freeAgents(e, groups[1], () => 5e6, true) });
    captureMarketSnapshot();
    // The season under way: the last of them
    advanceWinter(e.save, { playedShare: 0.2, contracts: freeAgents(e, groups[2], () => 5e6, true) });
    captureMarketSnapshot();
    const o = observed(L);
    expect(o.imports).toHaveLength(5);
    expect(o.pairs).toHaveLength(4);
    const signings = o.pairs.flatMap((p) => p.changes.filter((c) => c.kind === 'free_agent_signing'));
    expect(signings).toHaveLength(fa.length);
    for (const c of signings) {
      expect(c.uses).toContain('price');
      expect(c.left ?? '').not.toMatch(/under way/);
    }
    expect(o.pairs.map((p) => p.winters)).toEqual([[], [Y + 1], [Y + 1], [Y + 1]]);
    expect(o.measured.winters).toBe(1);
    expect(o.measured.signings).toBe(fa.length);
    expectInvariants(run(e.save, { refit: false }));
  }, SLOW);

  it("R3-04: a free agent re-signed by the club that acquired him during the season is not an open-market price; one signed by a club new to him is", () => {
    const e = earlierImport(big, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const Y = big.season;
    const fa = e.ids('free_agency');
    const [acquired, market] = [fa[0], fa[1]];
    const from = e.clubOf(acquired);
    const to = e.save.clubs.find((c) => c !== from)!;
    // After the earlier import he was traded: the rest of his season is a line with the club that acquired him
    exec(`UPDATE players SET team_id = ${to}, organization_id = ${to} WHERE player_id = ${acquired};
      UPDATE players_contract SET team_id = ${to}, contract_team_id = ${to} WHERE player_id = ${acquired}`);
    insert('players_career_batting_stats', { player_id: acquired, year: Y, team_id: to, league_id: L, level_id: 1, split_id: 1, pa: 120, ab: 108, war: 0.8 });
    advanceWinter(e.save, { playedShare: 0.2, contracts: [{ playerId: acquired, club: to, years: 3, salaries: [9e6] }, ...freeAgents(e, [market], () => 5e6)] });
    captureMarketSnapshot();
    const changes = observed(L).pairs[0].changes;
    const a = changes.find((x) => x.playerId === acquired)!;
    expect(a.kind).toBe('retained_at_free_agency');
    expect(a.uses).toEqual([]);
    expect(a.reading).toMatch(/lines/);
    const m = changes.find((x) => x.playerId === market)!;
    expect(m.kind).toBe('free_agent_signing');
    expect(m.uses).toContain('price');
    expect(m.reading).toMatch(/no stint|did not hold/);
  }, SLOW);

  it('R4-12: imports a winter or more apart say so, and what they show is not priced as one winter', () => {
    const e = earlierImport(big, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const fa = e.ids('free_agency');
    // A winter with no import, then the next one's signings
    advanceWinter(e.save, { playedShare: 0.5, contracts: [] });
    advanceWinter(e.save, { playedShare: 0.2, contracts: freeAgents(e, fa.slice(0, 30), () => 5e6, true) });
    captureMarketSnapshot();
    const o = observed(L);
    expect(o.pairs).toHaveLength(1);
    expect(o.pairs[0].winters).toHaveLength(2);
    expect(o.pairs[0].note).toMatch(/2 winters/);
    for (const c of o.pairs[0].changes) expect(c.uses).not.toContain('price');
    expect(o.measured.status).not.toBe('measured');
    expect(o.measured.text).toMatch(/winters apart/);
  }, SLOW);

  it('R3-05: a save that went back starts a new timeline: nothing is compared across it, and the superseded import is not read', () => {
    const e = earlierImport(big, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const Y = big.season;
    advanceWinter(e.save, { playedShare: 0.2, contracts: freeAgents(e, e.ids('free_agency'), () => 5e6, true) });
    captureMarketSnapshot();
    expect(observed(L).pairs).toHaveLength(1);
    // A backup reloaded: the export is dated before the import already recorded
    exec(`UPDATE leagues SET "current_date" = '${Y + 1}-4-2'`);
    const back = captureMarketSnapshot();
    expect(back.contracts.error).toBeNull();
    const o = observed(L);
    expect(o.pairs).toHaveLength(0);
    expect(o.timeline.text).toMatch(/went back/);
    expect(o.measured.status).toBe('no_off_season');
    // Back again, to a date already recorded: nothing new is written, and the break is said
    const first = contractImports(L)[0].gameDate;
    const [y, m, d] = first.split('-').map(Number);
    exec(`UPDATE leagues SET season_year = ${Y}, "current_date" = '${y}-${m}-${d}'`);
    const again = captureMarketSnapshot();
    expect(again.contracts.written).toBe(0);
    expect(again.contracts.timeline.join(' ')).toMatch(/went back/);
  }, SLOW);

  it('R3-05: a date imported again whose play differs (a reloaded save played again) is not compared with the next import; one with the same play (a move made on the same day) is', () => {
    for (const replayed of [true, false]) {
      const e = earlierImport(big, (s) => s === 'free_agency');
      const L = e.save.leagueId;
      const Y = big.season;
      const fa = e.ids('free_agency');
      if (replayed) exec(`UPDATE players_career_batting_stats SET pa = pa + 3 WHERE year = ${Y}`);
      // A move made that day either way: one free agent's deal runs a season longer
      exec(`UPDATE players_contract SET years = 2, salary1 = salary0 WHERE player_id = ${fa[0]}`);
      const again = captureMarketSnapshot();
      expect(again.contracts.written).toBe(0);
      advanceWinter(e.save, { playedShare: 0.2, contracts: freeAgents(e, fa.slice(1), () => 5e6, true) });
      captureMarketSnapshot();
      const o = observed(L);
      if (replayed) {
        expect(o.pairs).toHaveLength(0);
        expect(o.timeline.text).toMatch(/played again|differs/);
      } else {
        expect(o.pairs).toHaveLength(1);
        expect(o.timeline.text).toBeNull();
      }
    }
  }, SLOW);

  it('R3-03: recording an import reads only the import before it, and what earlier imports observed is kept as observed', () => {
    const e = earlierImport(big, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const Y = big.season;
    advanceWinter(e.save, { playedShare: 0.2, contracts: freeAgents(e, e.ids('free_agency'), () => 5e6, true) });
    captureMarketSnapshot();
    const signings = observed(L).measured.observed;
    expect(signings).toBeGreaterThan(0);
    // The first import's rows are no longer needed: its pair was observed when the second import was recorded
    const first = contractImports(L)[0].gameDate;
    historyDb.prepare(`DELETE FROM value_contract_snapshots WHERE game_date = ?`).run(first);
    clearProductionCaches();
    expect(observed(L).measured.observed).toBe(signings);
    // A third import pairs with the second alone
    exec(`UPDATE leagues SET "current_date" = '${Y + 1}-6-20'`);
    const third = captureMarketSnapshot();
    expect(third.contracts.error).toBeNull();
    expect(observed(L).pairs).toHaveLength(2);
  }, SLOW);

  it('R4-01, R4-10: salaries set on what each player goes on to produce are recovered by the realized reading, and the opening price is compared only once that reading exists', async () => {
    const e = earlierImport(big, (s) => s === 'free_agency');
    const L = e.save.leagueId;
    const Y = big.season;
    // What each will produce next season in this synthetic league: this season's rate over a full season (the builder's continuation)
    const warOf = (id: number) => (db.prepare(`SELECT COALESCE(SUM(war), 0) AS w FROM (SELECT war FROM players_career_batting_stats WHERE player_id = ? AND year = ? AND split_id = 1
      UNION ALL SELECT war FROM players_career_pitching_stats WHERE player_id = ? AND year = ? AND split_id = 1)`).get(id, Y, id, Y) as { w: number }).w / big.playedShare;
    const fa = e.ids('free_agency').filter((id) => warOf(id) > 0);
    const clubs = e.save.clubs;
    advanceWinter(e.save, {
      playedShare: 0.2,
      contracts: fa.map((id, i) => {
        const from = e.clubOf(id);
        return { playerId: id, club: clubs[(clubs.indexOf(from) + 1 + (i % (clubs.length - 1))) % clubs.length], years: 1, salaries: [Math.round(MIN + 5e6 * warOf(id))] };
      }),
    });
    captureMarketSnapshot();
    let f = leagueFinances(L, { currentState: 'current' });
    expect(f.observed.measured.status).toBe('measured');
    expect(f.observed.measured.bases.find((b) => b.id === 'realized')!.status).toBe('not_computed');
    expect(f.priceOfWin.stage).toBe('opening');
    expect(f.priceOfWin.adoption!.reason).toMatch(/realized/);
    // The next winter: the signings' first season is completed (every expired deal renewed with its club, so the league keeps a market)
    const expired = db.prepare(`SELECT player_id, team_id, salary0 FROM players_contract WHERE is_major = 1 AND season_year + years - 1 < ? AND team_id BETWEEN 1 AND 99`)
      .all(Y + 2) as Array<{ player_id: number; team_id: number; salary0: number }>;
    advanceWinter(e.save, { playedShare: 0.2, contracts: expired.map((r) => ({ playerId: r.player_id, club: r.team_id, years: 1, salaries: [r.salary0] })) });
    captureMarketSnapshot();
    f = leagueFinances(L, { currentState: 'current' });
    const realized = f.observed.measured.bases.find((b) => b.id === 'realized')!;
    expect(realized.status).toBe('measured');
    // The construction's truth, $5M a win produced, recovered; the projected bases read the same signings higher
    expect(realized.central!).toBeGreaterThan(4.5e6);
    expect(realized.central!).toBeLessThan(5.6e6);
    expect(f.observed.measured.bases.find((b) => b.id === 'first')!.central!).toBeGreaterThan(realized.central!);
    expect(f.priceOfWin.adoption!.reason).toMatch(/per realized win/);
    // In force or not, the price never changes unit: in force, its central is the realized reading's
    if (f.priceOfWin.stage === 'measured') expect(f.priceOfWin.price.value!.central).toBeCloseTo(realized.central!, 0);
    expect(marketSnapshotHistory(L).map((h) => h.stage)).toEqual(['opening', 'opening', f.priceOfWin.stage]);
    expect(priceHistory(L)).toHaveLength(3);
    const served = await request(`/api/club-finances/${e.save.org}/price-history`);
    expect(served.history).toHaveLength(3);
    expect(served.observed.measured.bases.length).toBeGreaterThanOrEqual(3);
  }, SLOW);

  it('R3-14, R4-08: observed arbitration salaries are scored with the width of their bands, and join the ladder once a class holds the minimum', () => {
    const e = earlierImport(big, (s) => s === 'arbitration');
    const L = e.save.leagueId;
    const arb = e.ids('arbitration');
    expect(arb.length).toBeGreaterThanOrEqual(COST_POLICY.ladder.minimumCases);
    advanceWinter(e.save, { playedShare: 0.2, contracts: arb.map((id, i) => ({ playerId: id, club: e.clubOf(id), salaries: [MIN + 1e6 + (i % 10) * 3e5] })) });
    captureMarketSnapshot();
    const f = leagueFinances(L, { currentState: 'current' });
    expect(f.observed.awards.status).toBe('scored');
    expect(f.observed.awards.sharpness.medianRatio).not.toBeNull();
    expect(f.observed.awards.text).toMatch(/wide/);
    const joined = f.observed.awards.readings.filter((r) => r.status === 'measured');
    expect(joined.length).toBeGreaterThan(0);
    for (const r of joined) {
      const c = f.costs.arbitration.classes.find((x) => x.arbitrationClass === r.arbitrationClass)!;
      expect(c.readings.some((x) => x.source === 'save' && x.cases === r.cases)).toBe(true);
      expect(c.text).toMatch(/observed arbitration salaries/);
    }
    expectInvariants(run(e.save, { refit: false }));
  }, SLOW);

  it('the price-history route answers a bad organization with 400, an unknown club with 404, and a save with nothing imported with 400', async () => {
    const save = buildSave(big);
    captureMarketSnapshot();
    await expect(request('/api/club-finances/abc/price-history')).rejects.toThrow(/400/);
    await expect(request('/api/club-finances/99999/price-history')).rejects.toThrow(/404/);
    const ok = await request(`/api/club-finances/${save.org}/price-history`);
    expect(ok.history).toHaveLength(1);
    dropTable('teams');
    await expect(request(`/api/club-finances/${save.org}/price-history`)).rejects.toThrow(/400/);
  }, SLOW);
});

describe('cross-save: league structure', () => {
  it('"this season" is read from the league\'s own row; the parent chain is followed only where the row does not state it (D-14)', () => {
    const orphan = minorLeagueRow(204, 555);
    const rows = (present: LeagueRuleRow[]) => {
      const cols = new Set<string>();
      for (const row of present) for (const k of Object.keys(row)) cols.add(k);
      const byId = new Map(present.map((r) => [r.league_id as number, r]));
      return (id: number) => leagueRulesFromRow(byId.get(id) ?? null, cols, (x) => byId.get(x) ?? null);
    };
    // The parent league has no row: the contract regime is unknown, and the season is still the league's own
    const broken = rows([majorLeagueRow(), orphan])(204);
    expect(broken.contract.season.value).toBe(orphan.season_year);
    expect(broken.contract.season.source).toBe('leagues.season_year');
    expect(broken.contract.freeAgencyYears.value).toBeNull();
    expect(broken.contract.freeAgencyYears.note).toMatch(/parent league 555/);
    // No parent_league_id column at all: the same
    const { parent_league_id: _drop, ...noParent } = majorLeagueRow();
    const flat = rows([noParent])(203);
    expect(flat.contract.season.value).toBe(majorLeagueRow().season_year);
    expect(flat.contract.arbitrationYears.value).toBeNull();
    // The row leaves the season blank: then, and only then, it is read through the chain
    const blank = rows([majorLeagueRow({ season_year: 2031 }), { ...minorLeagueRow(), season_year: null }])(204);
    expect(blank.contract.season.value).toBe(2031);
    expect(blank.contract.season.note).toMatch(/parent/);
  });

  it('a Triple-A league whose parent has no leagues row: its players are still projected, and their contract control is indeterminate, never guessed (D-14)', () => {
    const save = buildSave(base);
    exec(`UPDATE leagues SET parent_league_id = 555 WHERE league_id = ${save.aaaLeagueId}`);
    const r = run(save);
    expectInvariants(r);
    for (const id of save.prospects) {
      const v = r.values.get(id)!;
      expect(v.production.reason ?? '', `prospect ${id}`).not.toMatch(/season is not established/i);
      // His contract's own seasons stand as signed; past them, no status the regime would decide is guessed
      for (const s of v.control.seasons) expect(['under_contract', 'indeterminate'], `prospect ${id} ${s.season}`).toContain(s.status);
      expect(v.control.seasons.some((s) => s.status === 'indeterminate'), `prospect ${id}`).toBe(true);
    }
  }, SLOW);

  it('no parent_league_id column: the season is still known, and the regime and its dollars are unknown with the reason (D-14)', () => {
    const save = buildSave(base);
    dropColumn('leagues', 'parent_league_id');
    const r = run(save);
    expectInvariants(r);
    const projected = [...r.values.values()].filter((v) => v.production.status === 'projected').length;
    expect(projected).toBeGreaterThan(0);
    expect(priceOf(r, save.leagueId).price.value).toBeNull();
    expect(priceOf(r, save.leagueId).price.note).toMatch(/financials/i);
  }, SLOW);

  it('D-14 (F2): a note about a club with no leagues row never ends in a doubled full stop', () => {
    const save = buildSave(base);
    exec(`DELETE FROM leagues WHERE league_id = ${save.aaaLeagueId}`);
    const r = run(save);
    const texts: string[] = [];
    for (const v of r.values.values()) {
      for (const s of v.control.seasons) texts.push(s.basis, ...s.reasons, s.cost?.note ?? '', s.cost?.reason ?? '');
      texts.push(...(v.control.notes ?? []), v.production.reason ?? '');
    }
    expect(texts.some((t) => /No leagues row/.test(t)), 'the case is exercised').toBe(true);
    expect(texts.filter((t) => /[^.]\.\.(\s|$)/.test(t))).toEqual([]);
  }, SLOW);

  it('a minor-league-only universe (an independent level-2 league, no major league)', () => {
    const save = buildSave({ ...base, minors: false });
    exec(`UPDATE leagues SET league_level = 2; UPDATE teams SET level = 2; UPDATE players_career_batting_stats SET level_id = 2;
          UPDATE players_career_pitching_stats SET level_id = 2; UPDATE players_contract SET is_major = 0;`);
    expectInvariants(run(save));
  }, SLOW);

  it('D-16 (F1): an independent top-level league whose level is not 1 is projected from its own top level, or states plainly that it is not a major league', () => {
    const save = buildSave({ ...base, minors: false });
    exec(`UPDATE leagues SET league_level = 2; UPDATE teams SET level = 2; UPDATE players_career_batting_stats SET level_id = 2;
          UPDATE players_career_pitching_stats SET level_id = 2; UPDATE players_contract SET is_major = 0;`);
    const r = run(save);
    expectInvariants(r);
    // Its top level is its majors: its players are projected from their results there
    sideIn(r, save.regular, base.season + 1);
    expect(r.values.get(save.reliever)!.production.status).toBe('projected');
  }, SLOW);

  it('two top-level leagues in one universe: each is its own market, and every entry point answers for both', () => {
    const save = buildSave(base);
    const current = '2040-7-1';
    insert('leagues', { ...leagueRow(200, 0, 1, 'Other Top League', 143, true, 2040, current, '2040-4-1'), rules_fa_minimum_years: 9, rules_salary_arbitration_minimum_years: 0, rules_min_service_days: 150 });
    insert('leagues', leagueRow(201, 200, 2, 'Other Farm', 120, false, 2040, current, '2040-4-1'));
    insert('teams', { team_id: 300, name: 'Other A', level: 1, league_id: 200, parent_team_id: 0, allstar_team: 0 });
    insert('teams', { team_id: 301, name: 'Other A Farm', level: 2, league_id: 201, parent_team_id: 300, allstar_team: 0 });
    for (let i = 0; i < 20; i += 1) {
      const id = 90_000 + i;
      insert('players', { player_id: id, first_name: 'O', last_name: `${id}`, age: 24, position: 5, team_id: 300, organization_id: 300, retired: 0, date_of_birth: '2016-4-1' });
      for (const y of [2035, 2036]) insert('players_career_batting_stats', { player_id: id, year: y, team_id: 301, league_id: 201, level_id: 2, split_id: 1, pa: 400, war: null });
      if (i < 10) for (const y of [2037, 2038]) insert('players_career_batting_stats', { player_id: id, year: y, team_id: 300, league_id: 200, level_id: 1, split_id: 1, pa: 500, war: 1.5 });
    }
    const r = run(save);
    expectInvariants(r);
    expect([...r.finances.keys()]).toEqual(expect.arrayContaining([save.leagueId, 200]));
  }, SLOW);

  it("D-07 (F4): in a universe with two top-level leagues, a league's arrival rates are measured on its own affiliates' players, never the other league's farm, and reaching any top-level league is arriving", () => {
    const save = buildSave(base);
    const current = '2040-7-1';
    insert('leagues', { ...leagueRow(200, 0, 1, 'Other Top League', 143, true, 2040, current, '2040-4-1'), rules_fa_minimum_years: 9, rules_salary_arbitration_minimum_years: 0, rules_min_service_days: 150 });
    insert('leagues', leagueRow(201, 200, 2, 'Other Farm', 120, false, 2040, current, '2040-4-1'));
    insert('teams', { team_id: 300, name: 'Other A', level: 1, league_id: 200, parent_team_id: 0, allstar_team: 0 });
    insert('teams', { team_id: 301, name: 'Other A Farm', level: 2, league_id: 201, parent_team_id: 300, allstar_team: 0 });
    // The other league's farm: twenty players at level 2, ten of whom reached ITS majors
    for (let i = 0; i < 20; i += 1) {
      const id = 90_000 + i;
      insert('players', { player_id: id, first_name: 'O', last_name: `${id}`, age: 24, position: 5, team_id: 300, organization_id: 300, retired: 0, date_of_birth: '2016-4-1' });
      for (const y of [2035, 2036]) insert('players_career_batting_stats', { player_id: id, year: y, team_id: 301, league_id: 201, level_id: 2, split_id: 1, pa: 400, war: null });
      if (i < 10) for (const y of [2037, 2038]) insert('players_career_batting_stats', { player_id: id, year: y, team_id: 300, league_id: 200, level_id: 1, split_id: 1, pa: 500, war: 1.5 });
    }
    // One of this league's own farmhands, who reached the other league's majors
    insert('players', { player_id: 95_000, first_name: 'M', last_name: 'Moved', age: 24, position: 5, team_id: 300, organization_id: 300, retired: 0, date_of_birth: '2016-4-1' });
    for (const y of [2035, 2036]) insert('players_career_batting_stats', { player_id: 95_000, year: y, team_id: save.farmClubs[0], league_id: save.aaaLeagueId, level_id: 2, split_id: 1, pa: 400, war: null });
    insert('players_career_batting_stats', { player_id: 95_000, year: 2037, team_id: 300, league_id: 200, level_id: 1, split_id: 1, pa: 450, war: 1.0 });
    const input = ratingsHistory(save.leagueId, base.season - 1, false);
    const measured = new Set(input.arrival.map((p) => p.playerId));
    for (let i = 0; i < 20; i += 1) expect(measured.has(90_000 + i), `other league's farmhand ${90_000 + i}`).toBe(false);
    const moved = input.arrival.find((p) => p.playerId === 95_000);
    expect(moved, 'this league\'s own farmhand').toBeDefined();
    expect(moved!.majors.get(2037) ?? 0).toBeGreaterThan(0);
    expectInvariants(run(save));
  }, SLOW);
});

describe('cross-save: environment and export shape', () => {
  it('a low-offense environment (WAR at 0.4 of the usual scale)', () => {
    expectInvariants(run(buildSave({ ...base, warScale: 0.4 })));
  }, SLOW);

  it('a high-offense environment (WAR at 2.5 of the usual scale)', () => {
    expectInvariants(run(buildSave({ ...base, warScale: 2.5 })));
  }, SLOW);

  it("D-12 (F1): under the prior, a thin record is regressed toward the league's own measured mean, not MLB's", () => {
    for (const warScale of [0.4, 2.5]) {
      const save = buildSave({ ...base, warScale });
      const r = run(save, { refit: false });
      expectInvariants(r);
      expect(r.calibration.get(save.leagueId)!.inForce.source).toBe('fallback_prior');
      const lg = db.prepare(`SELECT SUM(war) AS w, SUM(pa) AS p FROM players_career_batting_stats WHERE split_id = 1 AND level_id = 1`).get() as { w: number; p: number };
      const own = (600 * lg.w) / lg.p;
      const rates = save.hitters.map((id) => r.values.get(id)!.production)
        .filter((p) => p.status === 'projected').map((p) => p.seasons[1].sides[0].rate);
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      // The league's own mean, not MLB's: the projected hitters sit around it (their aging and selection aside)
      expect(Math.abs(mean - own), `WAR x${warScale}: projected ${mean.toFixed(2)}, league ${own.toFixed(2)}`)
        .toBeLessThan(0.25 * Math.abs(PRODUCTION_PRIOR.kinds.hitter.mean600 - own));
    }
  }, SLOW);

  const shapes: Array<[string, () => void]> = [
    ['no players_contract_extension', () => dropTable('players_contract_extension')],
    ['no team_financials (nor last or history)', () => { dropTable('team_financials'); dropTable('team_last_financials'); dropTable('team_history_financials'); }],
    ['no prone_* columns', () => { for (const c of ['prone_overall', 'prone_leg', 'prone_back', 'prone_arm']) dropColumn('players', c); }],
    ['no war column in either career stats table', () => { dropColumn('players_career_batting_stats', 'war'); dropColumn('players_career_pitching_stats', 'war'); }],
    ['no war column in pitching only', () => dropColumn('players_career_pitching_stats', 'war')],
    ['no rules_schedule_games_per_team', () => dropColumn('leagues', 'rules_schedule_games_per_team')],
    ['no start_date', () => dropColumn('leagues', 'start_date')],
    ['no date_of_birth', () => dropColumn('players', 'date_of_birth')],
    ['no team_history_record', () => dropTable('team_history_record')],
    ['team_history_record without league_id', () => dropColumn('team_history_record', 'league_id')],
    ['team_record without g', () => dropColumn('team_record', 'g')],
    ['no team_record', () => dropTable('team_record')],
    ['no mlb_service_days_this_year', () => dropColumn('players_roster_status', 'mlb_service_days_this_year')],
    ['no players_roster_status', () => dropTable('players_roster_status')],
    ['no players_pitching', () => dropTable('players_pitching')],
    ['no players_fielding', () => dropTable('players_fielding')],
    ['no gs column in career pitching', () => dropColumn('players_career_pitching_stats', 'gs')],
    ['no bf column in career pitching', () => dropColumn('players_career_pitching_stats', 'bf')],
    ['no season_year column', () => dropColumn('leagues', 'season_year')],
    ['no rules_min_service_days column', () => dropColumn('leagues', 'rules_min_service_days')],
  ];
  for (const [label, reshape] of shapes) {
    it(`missing optional shape: ${label}`, () => {
      const save = buildSave(base);
      reshape();
      expectInvariants(run(save));
    }, SLOW);
  }

  it('no rules_schedule_games_per_team: the share of past seasons and of this one is unknown, so no basis assumes a full season (B-13)', () => {
    const save = buildSave(base);
    dropColumn('leagues', 'rules_schedule_games_per_team');
    const r = run(save, { refit: false });
    for (const id of ['A', 'B', 'B3']) {
      expect(basis(r, save.leagueId, id).perWin.value, id).toBeNull();
    }
    expect(priceOf(r, save.leagueId).price.value).toBeNull();
  }, SLOW);

  it('no season_year column: production is unknown and says the season is not established, never a guessed year', () => {
    const save = buildSave(base);
    dropColumn('leagues', 'season_year');
    const r = run(save, { refit: false });
    const reasons = [...r.values.values()].map((v) => v.production.reason ?? '');
    expect(reasons.every((reason) => /season/i.test(reason))).toBe(true);
  }, SLOW);

  it('D-13 (F1): one missing column in one career stats table blanks only that side: with no bf column, a hitter is projected and a pitcher is unknown with the reason', () => {
    const save = buildSave(base);
    dropColumn('players_career_pitching_stats', 'bf');
    const r = run(save, { refit: false });
    expectInvariants(r);
    sideIn(r, save.regular, base.season + 1);
    const pitcher = r.values.get(save.pitchers[0])!.production;
    expect(pitcher.status).toBe('unknown');
    expect(pitcher.reason).toMatch(/players_career_pitching_stats has no bf column/);
  }, SLOW);

  it('D-15 (F1): with no schedule length or standings history, the calibration label says how many seasons of lines exist and why none is usable, never "(0 seasons)"', () => {
    const save = buildSave(base);
    dropTable('team_history_record');
    const r = run(save);
    expectInvariants(r);
    const label = r.calibration.get(save.leagueId)!.inForce.label;
    expect(label).not.toMatch(/\(0 seasons\)/);
    expect(label).toMatch(new RegExp(`${base.historySeasons} seasons of major-league lines, none usable: schedule length not established`));
    for (const cone of r.cones) expect(cone.calibration.status).not.toMatch(/\(0 seasons\)/);
    // No schedule length at all: the seasons of lines are still counted, and production says what is missing
    const noRule = buildSave(base);
    dropColumn('leagues', 'rules_schedule_games_per_team');
    const r2 = run(noRule);
    expectInvariants(r2);
    expect(r2.calibration.get(noRule.leagueId)!.inForce.label).toMatch(new RegExp(`\\(${base.historySeasons} seasons\\)`));
    expect(r2.values.get(noRule.regular)!.production.reason).toMatch(/schedule length/);
  }, SLOW);
  it.todo('D-26 (deferred): the consumer routes on the Player Value pages answer on older export shapes (pre-fork queries)');
});

describe('cross-save: where in the season the export was taken', () => {
  it('the playoffs: every regular-season game played', () => {
    expectInvariants(run(buildSave({ ...base, playedShare: 1, currentDate: '2040-10-12' })));
  }, SLOW);

  it('the off-season before the rollover', () => {
    expectInvariants(run(buildSave({ ...base, playedShare: 1, currentDate: '2040-12-10' })));
  }, SLOW);

  it('after the rollover: a new season with no games yet', () => {
    expectInvariants(run(buildSave({ ...base, playedShare: 0, currentDate: '2040-2-10', clockDays: 0 })));
  }, SLOW);

  it("D-08 (F1): a season_year bump beside last season's standings does not mark the new season complete, and the real completion is fitted", () => {
    const save = buildSave({ ...base, playedShare: 1, currentDate: '2040-12-10' });
    exec(`UPDATE leagues SET season_year = ${base.season + 1}`);
    const r = run(save);
    expectInvariants(r);
    // The fit is keyed to the season whose lines exist, never the bumped one
    expect(r.calibration.get(save.leagueId)!.latestAttempt!.throughSeason).toBe(base.season);
    // Last season's standings are not this season's: the new season is not read as played with nothing in it
    const p = r.values.get(save.regular)!.production;
    if (p.status === 'projected') expect(p.seasons[0].wins.high).toBeGreaterThan(p.seasons[0].wins.low);
    else expect(p.reason).toMatch(/share of this season played/i);
    // The new season is played and its lines are exported: that completion is fitted
    exec(`CREATE TEMP TABLE next_b AS SELECT * FROM players_career_batting_stats WHERE year = ${base.season};
          UPDATE next_b SET year = ${base.season + 1}; INSERT INTO players_career_batting_stats SELECT * FROM next_b; DROP TABLE next_b;
          CREATE TEMP TABLE next_p AS SELECT * FROM players_career_pitching_stats WHERE year = ${base.season};
          UPDATE next_p SET year = ${base.season + 1}; INSERT INTO players_career_pitching_stats SELECT * FROM next_p; DROP TABLE next_p;
          INSERT INTO team_history_record (team_id, year, league_id, g, w, l, t, pct, pos, gb)
            SELECT team_id, ${base.season}, ${save.leagueId}, g, w, l, t, pct, pos, gb FROM team_record WHERE team_id < 100;`);
    const after = run(save);
    expectInvariants(after);
    expect(after.calibration.get(save.leagueId)!.latestAttempt!.throughSeason).toBe(base.season + 1);
  }, SLOW);
});

describe('cross-save: identity of the save', () => {
  it('a save imported before this build records its current market and contracts at the next start, once (supervisor, phase 4b)', () => {
    const save = buildSave(base);
    const count = (table: string) => (historyDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE league_id = ?`).get(save.leagueId) as { n: number }).n;
    const before = { market: count('value_market_snapshots'), contracts: count('value_contract_imports') };
    recordImportMarket();
    expect(count('value_market_snapshots')).toBe(before.market + 1);
    expect(count('value_contract_imports')).toBe(before.contracts + 1);
    // A second start writes nothing
    recordImportMarket();
    expect(count('value_market_snapshots')).toBe(before.market + 1);
    expect(count('value_contract_imports')).toBe(before.contracts + 1);
  }, SLOW);

  it("D-01 (F1): a new save under a reused save name and league id never inherits the previous save's adopted fit", () => {
    const first = buildSave(base);
    run(first);
    adoptEveryAttempt();
    expect(productionCalibration(first.leagueId).inForce.source).toBe('save_fit');
    const rows = historyDb.prepare(`SELECT * FROM value_production_fits`).all() as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    // Another league under the same save name and league id: the first save's rows are still in the store
    const second = buildSave({ ...base, seed: 2 });
    for (const row of rows) {
      const cols = Object.keys(row);
      historyDb.prepare(`INSERT INTO value_production_fits (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
    }
    clearProductionCaches();
    const r = run(second, { refit: false });
    expectInvariants(r);
    const cal = r.calibration.get(second.leagueId)!;
    expect(cal.inForce.source).toBe('fallback_prior');
    expect(cal.latestAttempt).toBeNull();
  }, SLOW);

  it('D (minor, F1; fixed after the hardening): a refit exception for one league or model never skips the others, and says why', () => {
    const save = buildSave(base);
    // The same league listed twice stands in for two leagues: the first fit throws, the second must still run
    let calls = 0;
    const production = computeProductionRefits({
      leagues: [save.leagueId, save.leagueId], force: true,
      fit: (h) => { calls += 1; if (calls === 1) throw new Error('synthetic failure'); return fitProductionModel(h, { prior: PRODUCTION_PRIOR }); },
    });
    expect(production).toHaveLength(2);
    expect(production[0].run).toBeNull();
    expect(production[0].outcome.refit).toBe(false);
    expect(production[0].outcome.reason).toMatch(/synthetic failure/);
    expect(production[1].run).not.toBeNull();
    let ratingsCalls = 0;
    const ratings = computeRatingsRefits({
      leagues: [save.leagueId, save.leagueId], force: true,
      fit: (i) => { ratingsCalls += 1; if (ratingsCalls === 1) throw new Error('synthetic ratings failure'); return fitRatingsModel(i, { prior: RATINGS_PRIOR }); },
    });
    expect(ratings).toHaveLength(2);
    expect(ratings[0].outcome.reason).toMatch(/synthetic ratings failure/);
    expect(ratings[1].run).not.toBeNull();
  }, SLOW);

  it('D (minor, F1): ratingsHistory never substitutes 0 for an unknown share of the season played', () => {
    const save = buildSave(base);
    expect(ratingsHistory(save.leagueId, base.season - 1, false).mapping.length).toBeGreaterThan(0);
    // No standings: the share of this season is unknown, so the mapping reads no case at all (A-24)
    dropTable('team_record');
    expect(ratingsHistory(save.leagueId, base.season - 1, false).mapping).toEqual([]);
  }, SLOW);
});
