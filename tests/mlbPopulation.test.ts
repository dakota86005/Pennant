import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { clearFieldingPopulationCache, scoutedFieldingPopulation, scoutedHitterPopulation } from '../server/scoutedEvidence';
import { IDS } from './fixture';

/*
 * The peers a hitter is ranked against are major leaguers. Every club carries its own amateur signings (sixteen- and
 * seventeen-year-olds with all-20 tools, marked by a NEGATIVE players.league_id); found in the Arizona import they were 60
 * of 486 "hitters", 12% of the pool, and pushed every real hitter's tools percentile up by about that much and every mean
 * over the pool down (the spread of expected wOBA read 41 points where the real one is 18).
 */

const REAL = 9601;
const AMATEUR = 9602;

function seed(id: number, league: number, grade: number, tool: number): void {
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id, organization_id,
                          retired, hidden, draft_eligible, college, league_id)
     VALUES (?, 'Pop', ?, ?, 6, 0, 1, 1, 9, ?, ?, 0, 0, 0, 0, ?)`
  ).run(id, `P${id}`, league > 0 ? 27 : 16, IDS.mlbTeam, IDS.mlbTeam, league);
  db.prepare(
    `INSERT INTO players_batting (player_id, batting_ratings_overall_contact, batting_ratings_overall_gap, batting_ratings_overall_power,
       batting_ratings_overall_eye, batting_ratings_overall_strikeouts) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, tool, tool, tool, tool, tool);
  db.prepare(`INSERT INTO players_fielding (player_id, position, fielding_rating_pos6) VALUES (?, 6, ?)`).run(id, grade);
}

beforeAll(() => {
  seed(REAL, IDS.league, 60, 60);
  seed(AMATEUR, -IDS.league, 20, 20);
  clearFieldingPopulationCache();
});

describe('the peer populations are major leaguers only', () => {
  it('leaves an amateur signed by the club out of the hitters a tools percentile is ranked against', () => {
    const ids = scoutedHitterPopulation(IDS.league).map((p) => p.playerId);
    expect(ids).toContain(REAL);
    expect(ids).not.toContain(AMATEUR);
  });

  it('leaves him out of the fielders a glove grade is ranked against', () => {
    const grades = scoutedFieldingPopulation(IDS.league, 6);
    expect(grades.length).toBeGreaterThan(0);
    expect(Math.min(...grades)).toBeGreaterThan(20);
  });
});
