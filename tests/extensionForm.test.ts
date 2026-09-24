import { describe, expect, it, beforeAll } from 'vitest';
import { db } from '../server/db.js';
import request from './request.js';
import { IDS } from './fixture.js';

/**
 * An extension has to be backed by the season, not by the Value figure alone.
 *
 * A user wrote in about two long relievers with earned run averages of 6.51
 * and 9.45 who were being reported at the 93rd and 95th percentile of
 * major-league value, one of them with the advice: "performing at a
 * 93rd-percentile MLB value ... we must initiate extension talks immediately".
 *
 * Both halves of that were wrong. OOTP's Value is value TO THE CLUB and counts
 * playing time — across the 280 major-league relievers in the save this was
 * checked against, Value tracked innings at +0.37 and ERA at +0.19, the wrong
 * way round, while tracking the stuff rating at +0.12 — so a converted starter
 * soaking up long relief rises to the top of the reliever pool whatever he
 * does with the ball. And no statistics were sent with the percentile, so
 * nothing the assistant had could contradict the word "performing".
 */

interface Player {
  name: string;
  seasonForm: { line: string | null; verdict: string; meaningful: boolean } | null;
}

const players = async (): Promise<Player[]> =>
  (await request(`/api/contracts/${IDS.mlbTeam}`)).players as Player[];

/** The reported case: near the top of the pool by value, and hitting nothing. */
const VALUABLE_AND_STRUGGLING = 8400;

beforeAll(() => {
  const year = (db.prepare(
    `SELECT MAX(year) AS y FROM players_career_batting_stats`
  ).get() as { y: number }).y;

  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden,
                          draft_eligible, college)
     VALUES (?, 'Paper', 'Value', 27, 6, 0, 1, 1, 88, ?, ?, 0, 0, 0, 0)`
  ).run(VALUABLE_AND_STRUGGLING, IDS.mlbTeam, IDS.mlbTeam);
  // Past six years already, so he reaches free agency whatever the rest of the season holds. (At
  // 5.9 years, as first written, he crosses the line only if he stays up, and his control after
  // this season is indeterminate — Player Value, D-052 — which is its own case, not this one.)
  db.prepare(
    `INSERT INTO players_roster_status
       (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary,
        mlb_service_years, mlb_service_days, mlb_service_days_this_year)
     VALUES (?, 1, 0, 0, 0, 6, ?, 40)`
  ).run(VALUABLE_AND_STRUGGLING, Math.round(6.2 * 172));
  // The highest value on the club, which is what recommended him
  db.prepare(
    `INSERT INTO players_value
       (player_id, overall_value, talent_value, offensive_value, offensive_value_vsl,
        offensive_value_vsr, pitching_value, oa_rating, pot_rating, oa, pot)
     VALUES (?, 9000, 9000, 100, 100, 100, 0, 60, 60, 60, 60)`
  ).run(VALUABLE_AND_STRUGGLING);
  db.prepare(`INSERT INTO team_roster VALUES (?, ?, 1)`).run(IDS.mlbTeam, VALUABLE_AND_STRUGGLING);
  // A one-year deal in its final season on the league minimum — the shape of
  // contract the reported advice was so eager to extend
  db.prepare(
    `INSERT INTO players_contract
       (player_id, team_id, contract_team_id, season_year, years, current_year, is_major,
        retained, no_trade, last_year_team_option, last_year_player_option,
        last_year_vesting_option, salary0)
     VALUES (?, ?, ?, ?, 1, 1, 1, 0, 0, 0, 0, 0, 780000)`
  ).run(VALUABLE_AND_STRUGGLING, IDS.mlbTeam, IDS.mlbTeam, year);
  // A full season of it, so nobody can call the sample too small: 400 trips,
  // 40 hits, nothing else
  db.prepare(
    `INSERT INTO players_career_batting_stats
     VALUES (?, ?, ?, ?, 1, 1, 400, 380, 40, 2, 0, 0, 10, 0, 1, 1, 120, 0, 0, 0, 5, 0.0)`
  ).run(VALUABLE_AND_STRUGGLING, year, IDS.mlbTeam, IDS.league);
});

describe('the contract payload', () => {
  it('carries a season line for everyone it has one for', async () => {
    const withForm = (await players()).filter((p) => p.seasonForm?.line);
    expect(withForm.length, 'no player carried a season line at all').toBeGreaterThan(0);
  });

  it('writes the line the way a box score does', async () => {
    for (const p of await players()) {
      const line = p.seasonForm?.line;
      if (!line) continue;
      expect(line, `${p.name}: ${line}`).toMatch(/^\d+(\.\d+)? (PA|IP)/);
      // The placeholder dash used to land mid-sentence, in a line meant to be
      // quoted back by an assistant
      expect(line, `${p.name}: ${line}`).not.toContain('—');
    }
  });
});

/*
 * Player Value phase 6a (D-052: value describes, it never authorizes). The recommendation this file used to guard
 * ("Extend now", "Re-sign", "Hold off", ...) is gone with the percentile it stood on: Contracts now shows the
 * contract, control, cost, production and value bands, and the GM decides. The reported case is kept as the
 * invariant that no row tells the GM what to do, however the percentile and the season disagree.
 */
describe('a contract row tells the GM nothing to do', () => {
  it('carries no recommendation and no percentile for anyone', async () => {
    for (const p of await players()) {
      expect(p, p.name).not.toHaveProperty('recommendation');
      expect(p, p.name).not.toHaveProperty('overallPct');
    }
  });

  it('shows the reported case his season and his contract, and no advice', async () => {
    const him = (await players()).find((p) => p.name === 'Paper Value');
    expect(him, 'the fixture case never reached the contracts payload').toBeDefined();
    expect(him!.seasonForm?.line).toMatch(/^\d+ PA/);
    expect(JSON.stringify(him)).not.toMatch(/extend|re-sign|hold off|let walk|keep him|release/i);
  });
});
