import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { playerValue } from '../server/playerValue.js';
import { evaluateContractControl } from '../server/playerRights.js';
import { CONTROL_HORIZON_SEASONS } from '../server/playerValueCalibration.js';
import { derivedFrom } from '../server/provenance.js';
import { IDS, SEASON } from './fixture.js';
import {
  MLB, THIS_SEASON, YEAR, classOf, contractRow, factsOf, majorLeagueRow, minorLeagueRow, mlbRules, regimeOf, seasonOf,
  stateOf, superTwoFor, timelineOf,
} from './playerValueFixtures.js';

/*
 * Player Value, concern 2: the control timeline (docs/BEHAVIOR_CASES.md "Player Value",
 * playerValueControl.test.ts, phase 1). Each `it` is one invariant from that table, built from
 * synthetic evidence through the functions that own the answer. No case names a player or says
 * who is worth more.
 */

const NEXT = THIS_SEASON + 1;
/** A one-year deal expiring this season: every later season is Player Rights' to state. */
const expiring = factsOf(contractRow({ years: 1 }));

describe('Player Value: control (phase 1)', () => {
  it('a missing free-agency or arbitration rule leaves the season indeterminate, never six years or three', () => {
    // Seven full years: past any free-agency line a modern league would draw
    const veteran = stateOf({ days: 7 * YEAR, thisYear: 40 });
    for (const rules of [mlbRules({ rules_fa_minimum_years: undefined }), mlbRules({ rules_fa_minimum_years: null })]) {
      const t = timelineOf({ state: veteran, rules, contract: expiring });
      expect(t.seasons.some((s) => s.status === 'free_agent')).toBe(false);
      expect(seasonOf(t, NEXT).status).toBe('indeterminate');
      expect(seasonOf(t, NEXT).reasons.join(' ')).toMatch(/free-agency rule is not available/);
      expect(t.controlEnds).toBeNull();
    }
    // Four years: not assumed to be an arbitration case when the rule is missing
    const fourYears = stateOf({ days: 4 * YEAR + 10, thisYear: 40 });
    for (const rules of [mlbRules({ rules_salary_arbitration_minimum_years: undefined }), mlbRules({ rules_salary_arbitration_minimum_years: null })]) {
      const next = seasonOf(timelineOf({ state: fourYears, rules, contract: expiring }), NEXT);
      expect(next.status).toBe('indeterminate');
      expect(next.arbitrationYear).toBeNull();
      expect(next.reasons.join(' ')).toMatch(/arbitration rule is not available/);
    }
    // And a missing service-year length is never 172 days
    const noLength = timelineOf({ state: fourYears, rules: mlbRules({ rules_min_service_days: undefined }), contract: expiring });
    expect(seasonOf(noLength, NEXT).status).toBe('indeterminate');
    expect(seasonOf(noLength, NEXT).reasons.join(' ')).toMatch(/service-year length/);
    expect(noLength.eligibility?.serviceDaysPerYear.value).toBeNull();
  });

  it('a missing service time is unknown, never pre-arbitration', () => {
    const noService = timelineOf({ state: stateOf({ days: null, years: null }), contract: expiring });
    for (const s of noService.seasons.filter((x) => x.season > THIS_SEASON)) {
      expect(s.status).toBe('indeterminate');
      expect(s.status).not.toBe('pre_arbitration');
    }
    expect(seasonOf(noService, NEXT).reasons.join(' ')).toMatch(/service time is not available.*never read as zero/);

    // Whole years alone still bound him: four exported years is arbitration, not "unknown" and not zero
    const yearsOnly = timelineOf({ state: stateOf({ days: null, years: 4, thisYear: 40 }), contract: expiring, clock: YEAR });
    expect(seasonOf(yearsOnly, NEXT).status).toBe('arbitration');
    expect(yearsOnly.eligibility?.service.basis.join(' ')).toMatch(/Only whole service years/);
  });

  it("a minor leaguer's control is read from his parent league's rules, never from his own league's zeros", () => {
    const rows = [majorLeagueRow(), minorLeagueRow(204, MLB)];
    const regime = regimeOf(204, rows);
    expect(regime.regimeLeagueId.value).toBe(MLB);
    expect(regime.freeAgencyYears.value).toBe(6);
    expect(regime.arbitrationYears.value).toBe(3);
    expect(regime.freeAgencyYears.note).toMatch(/parent league/);

    // Read from his own row, the zeros would say "no free agency": a reserve clause for life
    const veteranInTripleA = stateOf({ days: 8 * YEAR, thisYear: 0 });
    const t = timelineOf({ state: veteranInTripleA, rules: regime, contract: expiring });
    expect(seasonOf(t, NEXT).status).toBe('free_agent');
    expect(t.seasons.some((s) => s.status === 'reserve_clause')).toBe(false);

    // A parent the export does not have, or no parent column at all: unknown, never the zeros
    const orphan = regimeOf(204, [minorLeagueRow(204, 999)]);
    expect(orphan.freeAgencyYears.value).toBeNull();
    const t2 = timelineOf({ state: veteranInTripleA, rules: orphan, contract: expiring });
    // The season is the league's own fact (D-14), so his contract's season stands as signed; past it nothing is guessed
    expect(orphan.season.value).toBe(THIS_SEASON);
    expect(t2.seasons.filter((s) => s.season > THIS_SEASON).every((s) => s.status === 'indeterminate')).toBe(true);
    expect(t2.seasons.some((s) => s.status === 'reserve_clause' || s.status === 'free_agent')).toBe(false);
    expect([...t2.notes, ...t2.seasons.flatMap((s) => s.reasons)].join(' ')).toMatch(/parent league 999/);
    const noParentColumn = { ...minorLeagueRow(204) };
    delete noParentColumn.parent_league_id;
    expect(regimeOf(204, [noParentColumn]).freeAgencyYears).toMatchObject({ value: null, provenance: 'unknown' });
  });

  it('a player whose projected service straddles a threshold has that season indeterminate, with the seasons on both sides stated', () => {
    // Five years and 160 days; 40 of the season's 172 days gone, so 132 remain. Staying up
    // crosses six years; optioned tomorrow, he falls 12 days short.
    const t = timelineOf({ state: stateOf({ days: 5 * YEAR + 160, thisYear: 40 }), contract: expiring, clock: 40 });
    const next = seasonOf(t, NEXT);
    expect(next.status).toBe('indeterminate');
    expect(next.between).toEqual(['arbitration', 'free_agent']);
    const crossing = next.crossings.find((c) => c.line === 'free_agency')!;
    expect(crossing).toBeDefined();
    expect(crossing.ifStaysUp).toBe(NEXT);
    expect(crossing.ifOptioned).toBe(NEXT + 1);
    expect(crossing.message).toMatch(/needs 12 more days and 132 remain/);
    // The season after is past the line on both edges: control ends there
    expect(seasonOf(t, NEXT + 1).status).toBe('free_agent');
    expect(t.controlEnds).toBe(NEXT + 1);

    // With the season over nothing remains to bank, and the same man is plainly an arbitration case
    const seasonOver = timelineOf({ state: stateOf({ days: 5 * YEAR + 160, thisYear: YEAR }), contract: expiring, clock: YEAR });
    expect(seasonOf(seasonOver, NEXT).status).toBe('arbitration');
  });

  it('arbitration and free-agency eligibility come from Player Rights and are never re-derived in a value module', () => {
    // Swept over every service total a player can carry into next winter: the timeline's status for a
    // season the contract does not cover is Player Rights' standing, exactly
    const map = { pre_arbitration: 'pre_arbitration', arbitration: 'arbitration', free_agency: 'free_agent', reserve_clause: 'reserve_clause', indeterminate: 'indeterminate' } as const;
    for (let days = 0; days <= 8 * YEAR; days += 13) {
      const state = stateOf({ days, thisYear: Math.min(days, 40) });
      const rights = evaluateContractControl({
        state, rules: mlbRules(), serviceClock: derivedFrom(40, 'test'), currentState: 'current', seasons: CONTROL_HORIZON_SEASONS,
      });
      const t = timelineOf({ state, contract: expiring });
      for (const s of t.seasons.filter((x) => x.season > THIS_SEASON)) {
        const r = rights.seasons.find((x) => x.season === s.season)!;
        expect(s.status, `${days} days, ${s.season}`).toBe(map[r.standing]);
        expect(s.from).toBe('player_rights');
      }
    }
    // ...and no Player Value module compares service with a threshold (the static half is in
    // playerValueBoundary.test.ts)
    for (const file of ['playerValue.ts', 'playerValueContract.ts', 'playerValueControl.ts']) {
      const source = fs.readFileSync(path.join(process.cwd(), 'server', file), 'utf8');
      expect(source, file).not.toMatch(/\.(freeAgencyYears|arbitrationYears|serviceDaysPerYear)\.value/);
    }
  });

  it("in a league whose contract regime is not MLB's, the year before the arbitration line stays indeterminate, never eligible and never ineligible", () => {
    // Was: "a player in the Super Two window is indeterminate ... until the data proves the rule". The
    // owner ruled on 2026-09-22 that OOTP applies Super Two under MLB rules, so the blanket window now
    // holds only where the regime is not MLB's (here a seven-year free-agency line); the MLB cases are
    // in playerValueSuperTwo.test.ts. Two years and 130 days, the season over, a class ranked all the same.
    const state = stateOf({ days: 2 * YEAR + 130, thisYear: YEAR });
    const rules = mlbRules({ rules_fa_minimum_years: 7 });
    const superTwo = superTwoFor([...classOf(50, 2 * YEAR, 3), { days: 2 * YEAR + 130, thisYear: YEAR }], rules, YEAR);
    const rights = evaluateContractControl({
      state, rules, serviceClock: derivedFrom(YEAR, 'test'), currentState: 'current', seasons: 2, superTwo,
    });
    const next = rights.seasons.find((s) => s.season === NEXT)!;
    expect(next.arbitration.status).toBe('indeterminate');
    expect(next.arbitration.missing.map((m) => m.message).join(' ')).toMatch(/Super Two/);
    expect(next.standing).toBe('indeterminate');
    expect(next.between).toEqual(['pre_arbitration', 'arbitration']);
    expect(next.arbitration.missing.map((m) => m.message).join(' ')).toMatch(/not MLB's/);
    const t = timelineOf({ state, rules, contract: expiring, clock: YEAR, superTwoClass: classOf(50, 2 * YEAR, 3) });
    expect(seasonOf(t, NEXT).status).toBe('indeterminate');
    expect(seasonOf(t, NEXT).between).toEqual(['pre_arbitration', 'arbitration']);
    // A year short of the window is plainly pre-arbitration, and a year into arbitration plainly arbitration
    expect(seasonOf(timelineOf({ state: stateOf({ days: YEAR + 100, thisYear: YEAR }), contract: expiring, clock: YEAR }), NEXT).status).toBe('pre_arbitration');
    expect(seasonOf(timelineOf({ state: stateOf({ days: 3 * YEAR + 100, thisYear: YEAR }), contract: expiring, clock: YEAR }), NEXT).status).toBe('arbitration');
  });

  it('has_received_arbitration = 0 is not evidence that he has not been through arbitration', () => {
    // The flag is 0 for every player on the imported save, 751 of them with three or more years (R-3):
    // it carries no information, so nothing reads it
    const server = path.join(process.cwd(), 'server');
    for (const file of fs.readdirSync(server).filter((f) => f.endsWith('.ts'))) {
      const code = fs.readFileSync(path.join(server, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, file).not.toMatch(/has_received_arbitration/);
    }
  });

  it('a stale export leaves eligibility indeterminate, and an unverified one says so (D-023)', () => {
    const state = stateOf({ days: 4 * YEAR, thisYear: 40 });
    const stale = timelineOf({ state, contract: expiring, currentState: 'behind' });
    expect(seasonOf(stale, NEXT).status).toBe('indeterminate');
    expect(seasonOf(stale, NEXT).reasons.join(' ')).toMatch(/older than the save/);
    const unverified = timelineOf({ state, contract: expiring, currentState: 'unverified' });
    expect(seasonOf(unverified, NEXT).status).toBe('arbitration');
    expect(unverified.eligibility?.limitation).toMatch(/freshness could not be checked/);
  });

  it('a timeline runs to the end of control and no further than the horizon', () => {
    const young = timelineOf({ state: stateOf({ days: 10, thisYear: 10 }), contract: expiring });
    expect(young.seasons).toHaveLength(CONTROL_HORIZON_SEASONS);
    expect(young.continuesPastHorizon).toBe(true);
    const veteran = timelineOf({ state: stateOf({ days: 9 * YEAR, thisYear: 40 }), contract: expiring });
    expect(veteran.seasons.map((s) => s.status)).toEqual(['under_contract', 'free_agent']);
    expect(veteran.controlEnds).toBe(NEXT);
    // Under a reserve clause every later season is the club's, and nobody ever reaches a market
    const reserve = timelineOf({ state: stateOf({ days: 12 * YEAR, thisYear: 40 }), rules: mlbRules({ rules_fa_minimum_years: 0 }), contract: expiring });
    expect(reserve.seasons.slice(1).every((s) => s.status === 'reserve_clause')).toBe(true);
    // A man no club holds has no control timeline
    const unsigned = timelineOf({ contract: factsOf(contractRow({ teamId: 0 }), { teamId: 0 }) });
    expect(unsigned.standing).toBe('unsigned');
    expect(unsigned.seasons).toEqual([]);
  });
});

describe('Player Value: control through the entry point, against the database', () => {
  /** A minor league whose own row exports zeros, under the fixture's major league. */
  const MINOR_LEAGUE = 104;
  const MINOR_TEAM = 40;
  const VETERAN = 8500;
  const PROSPECT = 8501;

  beforeAll(() => {
    db.prepare(
      `INSERT INTO leagues (league_id, name, abbr, parent_league_id, league_level, season_year, "current_date",
                            rules_fa_minimum_years, rules_salary_arbitration_minimum_years, rules_minimum_salary,
                            rules_min_service_days, financial_coefficient)
       VALUES (?, 'Minor', 'MIN', ?, 2, ?, '2030-06-01', 0, 0, 0, 172, 1)`
    ).run(MINOR_LEAGUE, IDS.league, SEASON);
    db.prepare(
      `INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team)
       VALUES (?, 'Minor', 'Club', 'MNC', 2, ?, 0, 0, ?, 0)`
    ).run(MINOR_TEAM, MINOR_LEAGUE, IDS.mlbTeam);
    const player = db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number,
                            team_id, organization_id, retired, hidden, draft_eligible, college)
       VALUES (?, 'Minor', ?, 30, 6, 0, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
    );
    const status = db.prepare(
      `INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary,
                                          mlb_service_years, mlb_service_days, mlb_service_days_this_year)
       VALUES (?, 0, 0, 0, 1, ?, ?, 0)`
    );
    const contract = db.prepare(
      `INSERT INTO players_contract (player_id, team_id, contract_team_id, season_year, years, current_year, is_major,
                                     retained, no_trade, last_year_team_option, last_year_player_option,
                                     last_year_vesting_option, salary0)
       VALUES (?, ?, ?, ?, 1, 0, ?, 0, 0, 0, 0, 0, ?)`
    );
    // An eight-year veteran on a major-league deal, down in the minors
    player.run(VETERAN, 'Veteran', MINOR_TEAM, IDS.mlbTeam);
    status.run(VETERAN, 8, 8 * 172);
    contract.run(VETERAN, MINOR_TEAM, IDS.mlbTeam, SEASON, 1, 1_500_000);
    // A minor-league deal at $0
    player.run(PROSPECT, 'Prospect', MINOR_TEAM, IDS.mlbTeam);
    status.run(PROSPECT, 0, 0);
    contract.run(PROSPECT, MINOR_TEAM, IDS.mlbTeam, SEASON, 0, 0);
  });

  it("reads a minor leaguer's regime through the parent league", () => {
    const v = playerValue(VETERAN)!;
    expect(v.control.eligibility?.regime.value).toBe('free_agency');
    expect(seasonOf(v.control, SEASON + 1).status).toBe('free_agent');
  });

  it('keeps a minor-league $0 salary unknown and does not guess what follows a minor-league contract', () => {
    const v = playerValue(PROSPECT)!;
    expect(v.contract.kind.value).toBe('minor_league');
    const now = seasonOf(v.control, SEASON);
    expect(now.status).toBe('under_contract');
    expect(now.cost?.value).toBeNull();
    expect(now.cost?.note).toMatch(/never \$0/);
    expect(seasonOf(v.control, SEASON + 1).status).toBe('indeterminate');
  });
});

/*
 * Hardening (F2, 2026-09-23): the reviewers' findings on contract facts and control (A-03, A-05/C-06,
 * A-06, C-07, C-13, D-03, D-04). Each case is the invariant as BEHAVIOR_CASES.md states it, built from
 * synthetic evidence; none names a player.
 */
describe('Player Value: control, hardening (F2)', () => {
  it('plays the season under way under contract: its option was decided before it began, and only a future option shows both branches', () => {
    // A two-year deal in its second season, whose last season (this one) carries a club option
    const now = timelineOf({
      state: stateOf({ days: 8 * YEAR }),
      contract: factsOf(contractRow({ firstSeason: THIS_SEASON - 1, years: 2, currentYear: 1, teamOption: 1, salary: [4_000_000, 6_000_000] })),
    });
    const season = seasonOf(now, THIS_SEASON);
    expect(season.status).toBe('under_contract');
    expect(season.declined).toBeNull();
    expect(season.cost?.value).toEqual({ low: 6_000_000, high: 6_000_000 });
    expect(season.basis).toMatch(/decided before/);
    // Next season's option is still both branches
    const future = timelineOf({ state: stateOf({ days: 8 * YEAR }), contract: factsOf(contractRow({ years: 2, teamOption: 1 })) });
    expect(seasonOf(future, NEXT).status).toBe('club_option');
    expect(seasonOf(future, NEXT).declined?.status).toBe('free_agent');
  });

  it('never shows the seasons after an opt-out as certain: each carries both branches and names the opt-out', () => {
    // Six seasons from this one; the export's count reads the opt-out after contract year 3
    const t = timelineOf({ state: stateOf({ days: 8 * YEAR }), contract: factsOf(contractRow({ years: 6, optOut: 3, salary: 20_000_000 })) });
    for (const y of [THIS_SEASON, THIS_SEASON + 1, THIS_SEASON + 2]) expect(seasonOf(t, y).status).toBe('under_contract');
    for (const y of [THIS_SEASON + 3, THIS_SEASON + 4, THIS_SEASON + 5]) {
      const s = seasonOf(t, y);
      expect(s.status, `${y}`).toBe('opt_out');
      // Staying: the salary; leaving: his Player Rights standing
      expect(s.cost?.value).toEqual({ low: 20_000_000, high: 20_000_000 });
      expect(s.declined?.status).toBe('free_agent');
      expect(s.basis).toMatch(/opts? out/i);
      expect(s.reasons.join(' ')).toMatch(/read, not established/);
    }
    expect(t.notes.join(' ')).toMatch(/opt-out/i);
  });

  it('names an opt-out whose reading has passed or lies past the deal, and changes no season', () => {
    const veteran = stateOf({ days: 8 * YEAR });
    const past = timelineOf({
      state: veteran,
      contract: factsOf(contractRow({ firstSeason: THIS_SEASON - 3, years: 6, currentYear: 3, optOut: 2 })),
    });
    for (const y of [THIS_SEASON, THIS_SEASON + 1, THIS_SEASON + 2]) expect(seasonOf(past, y).status).toBe('under_contract');
    expect(past.notes.join(' ')).toMatch(/opt-out.*passed/i);
    const beyond = timelineOf({ state: veteran, contract: factsOf(contractRow({ years: 1, optOut: 2 })) });
    expect(seasonOf(beyond, NEXT).status).toBe('free_agent');
    expect(beyond.notes.join(' ')).toMatch(/opt-out.*past the seasons/i);
  });

  it('reads an unpopulated option flag as unknown on the last season, and a club and player option together as mutual', () => {
    // The default export populates the club and player flags, not the vesting one (R-6)
    const t = timelineOf({ state: stateOf({ days: 8 * YEAR }), contract: factsOf(contractRow({ years: 2 })) });
    expect(seasonOf(t, NEXT).status).toBe('under_contract');
    expect(seasonOf(t, NEXT).reasons.join(' ')).toMatch(/vesting option is not exported/);
    expect(seasonOf(t, THIS_SEASON).reasons.join(' ')).not.toMatch(/vesting/);
    const mutual = timelineOf({ state: stateOf({ days: 8 * YEAR }), contract: factsOf(contractRow({ years: 2, teamOption: 1, playerOption: 1 })) });
    expect(seasonOf(mutual, NEXT).status).toBe('mutual_option');
    expect(seasonOf(mutual, NEXT).declined).not.toBeNull();
  });

  it("reads a blank contract row as no kind, and takes Player Rights' standing for a major leaguer it places on a major-league club", () => {
    // The export's blank row: no term, no first season, no paying club, is_major 0, every salary 0
    const facts = factsOf(contractRow({ firstSeason: 0, years: 0, isMajor: 0, salary: 0, contractTeam: 0 }));
    expect(facts.standing).toBe('no_terms');
    expect(facts.kind.value).toBeNull();
    expect(facts.notes.join(' ')).not.toMatch(/minor-league/);
    // On the 60-day injured list with a year and 28 days of service
    const injured = timelineOf({ state: stateOf({ days: 200, thisYear: 52, onIl60: true }), contract: facts, clock: 52 });
    expect(seasonOf(injured, THIS_SEASON).cost?.value).toBeNull();
    expect(seasonOf(injured, NEXT).status).toBe('pre_arbitration');
    expect(seasonOf(injured, NEXT).reasons.join(' ')).toMatch(/blank/);
    expect(injured.seasons.map((s) => s.basis).join(' ')).not.toMatch(/minor-league contract/);
    // At free agency a deal the export does not carry could still hold him: indeterminate, both named
    const veteran = timelineOf({ state: stateOf({ days: 9 * YEAR, thisYear: 52, onIl60: true }), contract: facts, clock: 52 });
    expect(seasonOf(veteran, NEXT).status).toBe('indeterminate');
    expect(seasonOf(veteran, NEXT).between).toEqual(['under_contract', 'free_agent']);
    // In the minors with no major-league service it stays not established, and is not called a minor-league deal
    const farm = timelineOf({ state: stateOf({ days: 0, thisYear: 0, level: 3 }), contract: facts, clock: 52 });
    expect(seasonOf(farm, NEXT).status).toBe('indeterminate');
    expect(seasonOf(farm, NEXT).basis).not.toMatch(/minor-league contract/);
  });

  it('never assumes a player on the major-league injured list banks nothing: the list accrues service', () => {
    // Five years 150 days now, 40 days into the season, 30 days left on his stint: 22 short of six years
    const hurt = timelineOf({ state: stateOf({ days: 5 * YEAR + 150, thisYear: 40, onIl: true, ilDaysLeft: 30 }), clock: 40 });
    expect(hurt.eligibility?.service.endOfSeason?.low).toBe(5 * YEAR + 150 + 30);
    expect(hurt.eligibility?.service.basis.join(' ')).toMatch(/injured list/);
    expect(hurt.eligibility?.service.basis.join(' ')).not.toMatch(/hurt/);
    expect(seasonOf(hurt, NEXT).status).toBe('free_agent');
    // An active player as far short could still be optioned: indeterminate, and "hurt" is never the reason
    const active = timelineOf({ state: stateOf({ days: 5 * YEAR + 150, thisYear: 40 }), clock: 40 });
    expect(seasonOf(active, NEXT).status).toBe('indeterminate');
    expect([...active.eligibility!.service.basis, ...seasonOf(active, NEXT).reasons].join(' ')).not.toMatch(/hurt/);
  });

  it("caps a season's service by its schedule: nothing remains once it is played, and a later season banks what its schedule can", () => {
    // A 60-game league: the schedule spans 69 days, all played; the clock stopped at 69 of 172
    const calendar = { scheduleDays: 69, daysLeft: 0 };
    const t = timelineOf({ state: stateOf({ days: 5 * YEAR + 100, thisYear: 69 }), clock: 69, calendar });
    expect(t.eligibility?.service.endOfSeason).toEqual({ low: 5 * YEAR + 100, high: 5 * YEAR + 100 });
    expect(t.seasons.flatMap((s) => s.reasons).join(' ')).not.toMatch(/remain this season/);
    // 72 days short of six years at 68 or 69 days a season: free agency two seasons later than a full year would say
    expect(seasonOf(t, NEXT).status).toBe('arbitration');
    expect(seasonOf(t, NEXT + 1).status).toBe('arbitration');
    expect(t.controlEnds).toBe(THIS_SEASON + 3);
    expect(t.eligibility?.service.basis.join(' ')).toMatch(/schedule/);
    // Where the schedule is not exported, the basis says what each later season is taken as
    const unread = timelineOf({ state: stateOf({ days: 5 * YEAR + 100, thisYear: 69 }), clock: 69, calendar: null });
    expect(unread.eligibility?.service.basis.join(' ')).toMatch(/schedule is not in the export/);
  });
});
