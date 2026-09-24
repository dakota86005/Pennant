import { beforeAll, describe, expect, it } from 'vitest';
import { controlAfterThisSeason } from '../server/contracts.js';
import { db } from '../server/db.js';
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
    expect(man.optionYears).toEqual([{ season: SEASON + 1, kind: 'club', salary: 9_000_000, committed: false }]);
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

  it('counts a contract whose next season is an option as undecided on the upcoming market, never dropping it', async () => {
    const market = await request(`/api/free-agents/${IDS.mlbTeam}`);
    expect(market.upcomingUndecided).toBeGreaterThanOrEqual(1);
  });
});
