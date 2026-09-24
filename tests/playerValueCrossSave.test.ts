import { describe, expect, it } from 'vitest';
import { leagueRulesFromRow, type LeagueRuleRow } from '../server/leagueRules.js';
import {
  clearProductionCaches, clubFinances, leagueFinances, leaguePlayerValues, marketLeagues, playerProductionCone, productionCalibration,
  ratingsHistory, refitProductionIfNeeded, refitRatingsIfNeeded, type PlayerValuation,
} from '../server/playerValue.js';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { PRODUCTION_PRIOR } from '../server/playerValueCalibration.js';
import { leagueSeasons } from '../server/playerValueHistory.js';
import { captureMarketSnapshot } from '../server/playerValueSnapshot.js';
import { OPENING_PRICE_MINIMUMS } from '../server/playerValueCalibration.js';
import { buildSave, dropColumn, dropTable, exec, insert, leagueRow, type BuiltSave, type SaveSpec } from './syntheticSave';
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

  it.todo('D-14 (F2): the control note for a club with no leagues row ends in one full stop, not two ("No leagues row for this club..")');

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

  it.todo('D (minor, F1, not fixed): a refit exception for one model or league does not skip the others. `computeProductionRefits` has no per-league guard and `computeRefits` runs the ratings refits after it in the same call, so one league\'s exception still skips the rest; F1 did not change this');

  it('D (minor, F1): ratingsHistory never substitutes 0 for an unknown share of the season played', () => {
    const save = buildSave(base);
    expect(ratingsHistory(save.leagueId, base.season - 1, false).mapping.length).toBeGreaterThan(0);
    // No standings: the share of this season is unknown, so the mapping reads no case at all (A-24)
    dropTable('team_record');
    expect(ratingsHistory(save.leagueId, base.season - 1, false).mapping).toEqual([]);
  }, SLOW);
});
