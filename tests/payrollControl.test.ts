import { beforeAll, describe, expect, it } from 'vitest';
import { controlAfterThisSeason } from '../server/contracts.js';
import { db } from '../server/db.js';
import { clearProductionCaches } from '../server/playerValue.js';
import { IDS, SEASON } from './fixture.js';
import request from './request.js';
import {
  THIS_SEASON, YEAR, contractRow, factsOf, mlbRules, stateOf, timelineOf, type ServiceSpec,
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
    // Trips count winters (hardening F2, C-15): four years 60 days at the last winter is at least his
    // second trip now, so next winter is at least his third, whatever he banks; one more if an earlier
    // Super Two year the export cannot show made this his third
    expect([r.arbYear, r.arbYearHigh]).toEqual([3, 4]);
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

/*
 * Hardening (F2, 2026-09-23): the consumers read the timeline as Player Value states it (A-04, A-18,
 * A-19), Payroll reads Player Value's contract facts (A-14), Contracts shows service in years and days
 * (A-22), Free Agents stops dropping option contracts (A-23), and the finance cards keep an unknown
 * figure unknown (D-18).
 */
describe('consumers read the timeline as it is (hardening F2)', () => {
  it('never calls a next-season option signed: it is an option, with both branches', () => {
    const r = ask({ days: 8 * YEAR }, { contract: factsOf(contractRow({ years: 2, teamOption: 1 })) });
    expect(r.status).toBe('option');
    expect(r.option).toEqual({ kind: 'club', ifDeclined: 'leaving', between: [] });
    expect(r.reason).toMatch(/exercised/);
  });

  it('says extended only when next season is the extension, never while the current deal runs on', () => {
    const extension = contractRow({ firstSeason: THIS_SEASON + 3, years: 2 });
    expect(ask({ days: 8 * YEAR }, { contract: factsOf(contractRow({ years: 3 }), { extension }) }).status).toBe('signed');
  });

  it('calls a player whose control ends this season leaving, never indeterminate', () => {
    // His deal ran out last season and he is past the free-agency line
    const r = ask({ days: 9 * YEAR }, { contract: factsOf(contractRow({ firstSeason: THIS_SEASON - 2, years: 2 })) });
    expect(r.status).toBe('leaving');
  });
});

describe('the pages read Player Value (hardening F2)', () => {
  const OPTION_MAN = 8600;
  const OTHER_OPTION = 8601;
  const RENEWAL_MAN = 8602;

  beforeAll(() => {
    // Retained salary zero on every contract: the column is not populated, as on the imported save
    db.prepare(`UPDATE players_contract SET retained = 0`).run();
    // A budget the export leaves blank
    db.prepare(`UPDATE team_financials SET budget = NULL WHERE team_id = ?`).run(IDS.mlbTeam);
    // The Free Agents page's own (pre-fork) query needs columns a real export has and this fixture
    // lacks; that route's schema tolerance is phase 6's (D-26), so the fixture carries them here
    const playerColumns = new Set((db.prepare(`PRAGMA table_info(players)`).all() as Array<{ name: string }>).map((c) => c.name));
    for (const column of ['free_agent', 'last_league_id']) {
      if (!playerColumns.has(column)) db.prepare(`ALTER TABLE players ADD COLUMN ${column} INTEGER DEFAULT 0`).run();
    }
    const player = db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number,
                            team_id, organization_id, retired, hidden, draft_eligible, college)
       VALUES (?, 'Option', ?, 31, 6, 0, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
    );
    const status = db.prepare(
      `INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary,
                                          mlb_service_years, mlb_service_days, mlb_service_days_this_year)
       VALUES (?, 1, 0, 0, 1, 8, ?, 40)`
    );
    const contract = db.prepare(
      `INSERT INTO players_contract (player_id, team_id, contract_team_id, season_year, years, current_year, is_major,
                                     retained, no_trade, last_year_team_option, last_year_player_option,
                                     last_year_vesting_option, salary0, salary1)
       VALUES (?, ?, ?, ?, 2, 0, 1, 0, 0, 1, 0, 0, 3000000, 9000000)`
    );
    // On this club: a deal whose second season is a club option
    player.run(OPTION_MAN, 'Here', IDS.mlbTeam, IDS.mlbTeam);
    status.run(OPTION_MAN, 8 * 172);
    contract.run(OPTION_MAN, IDS.mlbTeam, IDS.mlbTeam, SEASON);
    // Elsewhere in the league: the same shape, on the upcoming market's edge
    player.run(OTHER_OPTION, 'There', IDS.otherMlbTeam, IDS.otherMlbTeam);
    status.run(OTHER_OPTION, 8 * 172);
    contract.run(OTHER_OPTION, IDS.otherMlbTeam, IDS.otherMlbTeam, SEASON);
    // Phase 4a review: the league runs financials (as a real export states), and a pre-arbitration man on a one-year
    // deal, so a controlled season is priced and the pages' cost checks are never vacuous
    const leagueColumns = new Set((db.prepare(`PRAGMA table_info(leagues)`).all() as Array<{ name: string }>).map((c) => c.name));
    if (!leagueColumns.has('rules_financials')) db.prepare(`ALTER TABLE leagues ADD COLUMN rules_financials INTEGER DEFAULT 1`).run();
    player.run(RENEWAL_MAN, 'Young', IDS.mlbTeam, IDS.mlbTeam);
    db.prepare(
      `INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary,
                                          mlb_service_years, mlb_service_days, mlb_service_days_this_year)
       VALUES (?, 1, 0, 0, 1, 1, ?, 40)`
    ).run(RENEWAL_MAN, 172);
    db.prepare(
      `INSERT INTO players_contract (player_id, team_id, contract_team_id, season_year, years, current_year, is_major,
                                     retained, no_trade, last_year_team_option, last_year_player_option,
                                     last_year_vesting_option, salary0)
       VALUES (?, ?, ?, ?, 1, 0, 1, 0, 0, 0, 0, 0, 700000)`
    ).run(RENEWAL_MAN, IDS.mlbTeam, IDS.mlbTeam, SEASON);
    clearProductionCaches();
  });

  it("leaves dead money not established when the export does not populate retained salary, never $0", async () => {
    const { deadMoney } = await request(`/api/payroll/${IDS.mlbTeam}`);
    expect(deadMoney.status).toBe('not_established');
    expect(deadMoney.total).toBeNull();
    expect(deadMoney.note).toMatch(/retained/);
  });

  it('counts a club option season apart from committed money, and never calls it signed', async () => {
    const { players, commitments, years } = await request(`/api/payroll/${IDS.mlbTeam}`);
    const man = players.find((p: { player_id: number }) => p.player_id === OPTION_MAN);
    const next = years.indexOf(SEASON + 1);
    expect(man.byYear[next]).toBeNull();
    expect(man.optionYears).toMatchObject([{ season: SEASON + 1, kind: 'club', salary: 9_000_000, committed: false }]);
    // Declined, he is a free agent: control ends, no cost to this club (phase 4a review, R1-06)
    expect(man.optionYears[0].declined).toMatchObject({ status: 'free_agent', cost: null });
    expect(man.control.status).toBe('option');
    expect(commitments[next].options.total).toBe(9_000_000);
  });

  it('shows service in years and days, never a decimal of years', async () => {
    const { players } = await request(`/api/contracts/${IDS.mlbTeam}`);
    const starter = players.find((p: { player_id: number }) => p.player_id === IDS.starter);
    // Four years 40 days: "4.040", never 4.23
    expect(starter.service).toBe('4.040');
  });

  it('shows a finance figure the export does not state as unknown on Contracts and Free Agents, never $0', async () => {
    const contracts = await request(`/api/contracts/${IDS.mlbTeam}`);
    expect(contracts.finances.budget).toBeNull();
    const market = await request(`/api/free-agents/${IDS.mlbTeam}`);
    expect(market.finances.budget).toBeNull();
  });

  it('never counts a projected pre-arbitration or arbitration salary in committed money: it is a band beside it (phase 4a)', async () => {
    const { players, commitments, years } = await request(`/api/payroll/${IDS.mlbTeam}`);
    for (const [i, c] of commitments.entries()) {
      // Committed is guaranteed contract money only, exactly as before
      const owed = players.reduce((sum: number, p: { byYear: Array<number | null> }) => sum + ((p.byYear[i] ?? 0) > 0 ? p.byYear[i]! : 0), 0);
      expect(c.total, `${years[i]}`).toBe(owed);
      expect(c.projected, `${years[i]}`).toBeDefined();
    }
    type Projected = { season: number; status: string; low: number | null; high: number | null; text: string } | null;
    const projected = players.filter((p: { projected?: Projected[] }) => p.projected?.some((x) => x !== null));
    expect(projected.length).toBeGreaterThan(0);
    for (const p of projected as Array<{ byYear: Array<number | null>; projected: Projected[] }>) {
      for (const [i, x] of p.projected.entries()) {
        if (!x) continue;
        // A projected season is one no contract covers: it has no committed money
        expect(p.byYear[i]).toBeNull();
        if (x.low !== null && x.high !== null) expect(x.low).toBeLessThanOrEqual(x.high);
        expect(x.text.length).toBeGreaterThan(0);
      }
    }
    // The projected band sums the players' bands edge against edge, and is never added to the total
    const next = years.indexOf(SEASON + 1);
    const lows = projected.map((p: { projected: Projected[] }) => p.projected[next]).filter((x: Projected) => x && x.low !== null);
    if (lows.length > 0) expect(commitments[next].projected.players).toBeGreaterThan(0);
  });

  it("sums the projected bands edge against edge, a season that may be free agency adding nothing to the low edge, and the centrals beside them (phase 4a review, R1-08, R2-03)", async () => {
    const { players, commitments, years } = await request(`/api/payroll/${IDS.mlbTeam}`);
    type Projected = { low: number | null; high: number | null; central: number | null; centrals: Array<{ central: number }> | null; ifHeld: boolean } | null;
    let checked = 0;
    for (const [i, c] of commitments.entries()) {
      const known = players.map((p: { projected: Projected[] }) => p.projected[i]).filter((x: Projected) => x !== null && x.low !== null) as NonNullable<Projected>[];
      if (known.length === 0) { expect(c.projected.low, `${years[i]}`).toBeNull(); continue; }
      checked += 1;
      expect(c.projected.players).toBe(known.length);
      // Owner, 2026-09-24: the edge-to-edge sum stays in the details; the range shown combines players as independent
      expect(c.projected.edges.low).toBeCloseTo(known.reduce((s, x) => s + (x.ifHeld ? 0 : x.low!), 0), 0);
      expect(c.projected.edges.high).toBeCloseTo(known.reduce((s, x) => s + x.high!, 0), 0);
      expect(c.projected.low).toBeGreaterThanOrEqual(c.projected.edges.low - 1);
      expect(c.projected.high).toBeLessThanOrEqual(c.projected.edges.high + 1);
      expect(c.projected.combination.text).toMatch(/independent/);
      expect(c.projected.combination.text).toMatch(/not a calibrated interval/);
      expect(c.projected.combination.combined + c.projected.combination.atEdges).toBe(known.length);
      // The centrals: each season's own; one that may be free agency adds its held central only to the upper sum;
      // a season between statuses adds its lowest and highest status's central
      const centralLow = known.reduce((s, x) => s + (x.ifHeld ? 0 : x.central ?? Math.min(...x.centrals!.map((k) => k.central))), 0);
      const centralHigh = known.reduce((s, x) => s + (x.central ?? Math.max(...x.centrals!.map((k) => k.central))), 0);
      expect(c.projected.central.low).toBeCloseTo(centralLow, 0);
      expect(c.projected.central.high).toBeCloseTo(centralHigh, 0);
      expect(c.projected.central.low).toBeGreaterThanOrEqual(c.projected.low - 1);
      expect(c.projected.central.high).toBeLessThanOrEqual(c.projected.high + 1);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("shows each season's cost on Contracts exactly as the timeline serves it (phase 4a)", async () => {
    const { players, seasonYear } = await request(`/api/contracts/${IDS.mlbTeam}`);
    const value = await request(`/api/player-value/${RENEWAL_MAN}`);
    const row = players.find((p: { player_id: number }) => p.player_id === RENEWAL_MAN);
    expect(row).toBeDefined();
    const next = value.control.seasons.find((s: { season: number }) => s.season === seasonYear + 1);
    // Never vacuous: next season is a controlled season the timeline priced (review R1-08)
    expect(next?.cost?.value, JSON.stringify(next?.cost)).toBeTruthy();
    expect(row.nextCost).toBeTruthy();
    expect(row.nextCost.low).toBe(next.cost.value.low);
    expect(row.nextCost.high).toBe(next.cost.value.high);
    expect(row.nextCost.central).toBe(next.cost.value.central);
  });

  it('a reading computed without production prices no controlled season, so Free Agents serves no second cost (phase 4a review, R1-13)', async () => {
    const { playerValues } = await import('../server/playerValue.js');
    const { COST_NOT_PRICED } = await import('../server/playerValueCalibration.js');
    const values = playerValues([IDS.boundary, IDS.starter, IDS.optioned], { production: false });
    const controlled = [...values.values()].flatMap((v) => v.control.seasons).filter((s) => ['pre_arbitration', 'arbitration'].includes(s.status));
    expect(controlled.length).toBeGreaterThan(0);
    for (const s of controlled) {
      expect(s.cost?.value ?? null).toBeNull();
      expect(s.cost?.note).toBe(COST_NOT_PRICED);
      expect(s.costBasis ?? null).toBeNull();
    }
  });

  it("shows an option's declined branch with its cost wherever the option is shown (phase 4a review, R1-06)", async () => {
    const { players } = await request(`/api/payroll/${IDS.mlbTeam}`);
    const options = players.flatMap((p: { optionYears?: Array<{ declined?: unknown }> }) => p.optionYears ?? []);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o).toHaveProperty('declined');
  });

  it('counts a contract whose next season is an option as undecided on the upcoming market, never dropping it', async () => {
    const market = await request(`/api/free-agents/${IDS.mlbTeam}`);
    expect(market.upcomingUndecided).toBeGreaterThanOrEqual(1);
  });
});
