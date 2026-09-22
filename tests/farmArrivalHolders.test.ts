import { beforeAll, describe, expect, it } from 'vitest';
import { db, tableColumns } from '../server/db.js';
import { farmArrivalFor, farmConsequenceFor } from '../server/farmConsequence.js';
import { openFarmSession } from '../server/farmOperations.js';
import { IDS } from './fixture.js';

/**
 * Who holds the job an arriving man would take up is a fact about the CLUB.
 *
 * Found while validating the stakes model on the real import (docs/DEVELOPMENTAL_STAKES.md B-1). The
 * arrival answer read the job only when it was "contested", and for a job with one holder that turned
 * on whether the ARRIVING man was himself a squeezed development claimant. The absolute composite gave
 * a thirty-two-year-old major-league star developmental stakes, so his arrival named the man at second
 * base; with his stakes read correctly the same arrival named nobody, while its summary still said
 * "1 man holds it". The holders no longer depend on the arriving man's tier.
 */

const ORG = IDS.mlbTeam;
const CLUB = 760;
const HOLDER = 76_001;
const VETERAN = 76_002; // 33, a finished major leaguer: organizational depth, no developmental stakes
const PROSPECT = 76_003; // 20, a regular's ceiling: a protected prospect

function hitter(id: number, team: number, age: number, current: number, potential: number, onActiveList: boolean): void {
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Arr', ?, ?, 4, 0, 1, 1, 9, ?, ?, 0, 0, 0, 0)`
  ).run(id, `P${id}`, age, team, ORG);
  db.prepare(`INSERT INTO team_roster VALUES (?, ?, 1)`).run(team, id);
  if (onActiveList) db.prepare(`INSERT INTO team_roster VALUES (?, ?, 2)`).run(team, id);
  db.prepare(
    `INSERT INTO players_batting (player_id, batting_ratings_overall_contact, batting_ratings_overall_gap,
       batting_ratings_overall_power, batting_ratings_overall_eye, batting_ratings_overall_strikeouts,
       batting_ratings_talent_contact, batting_ratings_talent_gap, batting_ratings_talent_power,
       batting_ratings_talent_eye, batting_ratings_talent_strikeouts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, current, current, current, current, current, potential, potential, potential, potential, potential);
  const cols = Array.from({ length: 8 }, (_, i) => `fielding_rating_pos${i + 2}`);
  db.prepare(`INSERT INTO players_fielding (player_id, position, ${cols.join(', ')}) VALUES (?, 4, ${cols.map(() => '50').join(', ')})`).run(id);
}

beforeAll(() => {
  const have = tableColumns('players');
  for (const c of ['fatigue_points', 'fatigue_played_today']) if (!have.includes(c)) db.exec(`ALTER TABLE players ADD COLUMN ${c} INTEGER DEFAULT 0`);
  db.prepare(
    `INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, parent_team_id, allstar_team) VALUES (?, 'Arrival', 'Club', 'ARR', 2, ?, ?, 0)`
  ).run(CLUB, IDS.league, ORG);
  db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, 40, 20, 20, 0, 1, 0.5, 0, 0, 0)`).run(CLUB);
  hitter(HOLDER, CLUB, 25, 45, 46, true);
  hitter(VETERAN, ORG, 33, 58, 58, false);
  hitter(PROSPECT, ORG, 20, 40, 52, false);
});

describe('an arrival names who holds the job, whoever is arriving', () => {
  it('names the holder for a veteran with no developmental stakes of his own', () => {
    const a = farmArrivalFor(ORG, VETERAN, CLUB);
    expect(a.job).toBe('2B');
    expect(a.contested).toBe(false);
    expect(a.holders.map((h) => h.playerId)).toEqual([HOLDER]);
    expect(a.summary).toMatch(/has room for him at 2B: 1 man holds it/);
  });

  it('names the same holder, at the same work level, for a protected prospect', () => {
    const veteran = farmArrivalFor(ORG, VETERAN, CLUB);
    const prospect = farmArrivalFor(ORG, PROSPECT, CLUB);
    const facts = (a: typeof veteran) => a.holders.map((h) => ({ playerId: h.playerId, level: h.level, basis: h.basis }));
    expect(facts(prospect)).toEqual(facts(veteran));
    expect(prospect.capacity).toBe(veteran.capacity);
    expect(prospect.contested).toBe(veteran.contested);
  });

  it('never counts the arriving man among the men his arrival displaces', () => {
    for (const id of [VETERAN, PROSPECT]) {
      const a = farmArrivalFor(ORG, id, CLUB);
      expect(a.displaced.map((d) => d.playerId)).not.toContain(id);
      expect(a.holders.map((h) => h.playerId)).not.toContain(id);
    }
  });
});

describe('a departure names whose playing time changes, whether or not the club contested the job', () => {
  const SHARER = 76_004; // 22, sharing second base with the holder: two men at a job that supports two is no conflict

  it('names the man left at an uncontested job when the holder leaves', () => {
    hitter(SHARER, CLUB, 22, 44, 50, true);
    const c = farmConsequenceFor(ORG, HOLDER);
    /*
     * Two men at second base are not a conflict, so reading only the affiliate's conflicts said
     * nothing here; it used to say something only while a sharing prospect was wrongly "squeezed".
     */
    expect(c.playingTimeImpact.map((e) => e.playerId)).toEqual([SHARER]);
    expect(c.playingTimeImpact[0].effect).toMatch(/2B opens up/);
    /* The job is not contested: the affiliate raises no conflict at second base for these two. */
    expect(openFarmSession(ORG).conflicts(CLUB).filter((k) => k.job.kind === 'position' && k.job.position === '2B')).toEqual([]);
    /* ...and the physical chain is the same whichever man is named. */
    expect(c.lostRole).toBeTruthy();
  });
});
