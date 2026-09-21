import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearFarmResultsCaches, farmProduction } from '../server/farmResults.js';
import { computeProspects } from '../server/org.js';
import { clearStatCaches } from '../server/stats.js';
import { IDS, SEASON } from './fixture.js';

/**
 * Peer populations, and the two contaminations the audit measured on the real import.
 *
 *   F-0-farm  the level's average age was built partly out of signings nobody had assigned, parked on
 *             the parent club's team_id with no roster entry (148 of them, ages 16 to 19)
 *   F-1-farm  one baseline per LEVEL pooled leagues 35 to 43 OPS points apart
 *
 * Both fail here without their fixes.
 */

const HITTERS_LEAGUE = 910;
const PITCHERS_LEAGUE = 911;
const HITTERS_CLUB = 9100;
const PITCHERS_CLUB = 9101;
const SAME_LINE_IN_HITTERS = 9199;
const SAME_LINE_IN_PITCHERS = 9198;
const LEVEL = 3;

const inserted: Array<[string, string, number[]]> = [];

function batting(playerId: number, teamId: number, leagueId: number, hits: number): void {
  db.prepare(
    `INSERT INTO players_career_batting_stats
       (player_id, year, team_id, league_id, level_id, split_id, pa, ab, h, d, t, hr, bb, ibb, hp, sf, k, sb, cs, r, rbi, war)
     VALUES (?, ?, ?, ?, ?, 1, 60, 54, ?, 3, 0, 1, 5, 0, 1, 0, 12, 0, 0, 6, 6, 0.1)`
  ).run(playerId, SEASON, teamId, leagueId, LEVEL, hits);
  inserted.push(['players_career_batting_stats', 'player_id', [playerId]]);
}

beforeAll(() => {
  db.prepare(`INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team) VALUES (?, 'Hitters', 'Park', 'HIT', ?, ?, 0, 0, 0, 0)`).run(HITTERS_CLUB, LEVEL, HITTERS_LEAGUE);
  db.prepare(`INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team) VALUES (?, 'Pitchers', 'Park', 'PIT', ?, ?, 0, 0, 0, 0)`).run(PITCHERS_CLUB, LEVEL, PITCHERS_LEAGUE);
  db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, 40, 20, 20, 0, 1, 0.5, 0, 0, 0)`).run(HITTERS_CLUB);
  db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, 40, 20, 20, 0, 1, 0.5, 0, 0, 0)`).run(PITCHERS_CLUB);
  inserted.push(['teams', 'team_id', [HITTERS_CLUB, PITCHERS_CLUB]], ['team_record', 'team_id', [HITTERS_CLUB, PITCHERS_CLUB]]);

  /* Thirty qualified hitters in each league: one league hits .400, the other .200. */
  for (let i = 0; i < 30; i++) batting(9000 + i, HITTERS_CLUB, HITTERS_LEAGUE, 22);
  for (let i = 0; i < 30; i++) batting(9050 + i, PITCHERS_CLUB, PITCHERS_LEAGUE, 11);
  /* The same line — .300 — produced in each league. */
  batting(SAME_LINE_IN_HITTERS, HITTERS_CLUB, HITTERS_LEAGUE, 16);
  batting(SAME_LINE_IN_PITCHERS, PITCHERS_CLUB, PITCHERS_LEAGUE, 16);
  clearStatCaches();
  clearFarmResultsCaches();
});

afterAll(() => {
  for (const [table, column, ids] of inserted) {
    for (const id of ids) db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(id);
  }
  clearStatCaches();
  clearFarmResultsCaches();
});

describe('a league is the peer group, not a level (F-1-farm)', () => {
  it('reads the same line against each league\'s own environment, and the percentile follows the league', () => {
    const out = farmProduction(
      [
        { playerId: SAME_LINE_IN_HITTERS, kind: 'hitter', teamId: HITTERS_CLUB, level: LEVEL, leagueId: HITTERS_LEAGUE, leagueName: 'Hitters League' },
        { playerId: SAME_LINE_IN_PITCHERS, kind: 'hitter', teamId: PITCHERS_CLUB, level: LEVEL, leagueId: PITCHERS_LEAGUE, leagueName: 'Pitchers League' },
      ],
      SEASON
    );
    const inHitters = out.get(SAME_LINE_IN_HITTERS)!;
    const inPitchers = out.get(SAME_LINE_IN_PITCHERS)!;
    expect(inHitters.unassessable).toBeNull();
    expect(inPitchers.unassessable).toBeNull();
    expect(inHitters.leagueContext.woba).toBeGreaterThan(inPitchers.leagueContext.woba);
    expect(inHitters.aboveLeague!).toBeLessThan(0);
    expect(inPitchers.aboveLeague!).toBeGreaterThan(0);
    expect(inHitters.percentile!).toBeLessThan(50);
    expect(inPitchers.percentile!).toBeGreaterThan(50);
  });

  it('says so, rather than comparing, when the league has too few qualified players', () => {
    const out = farmProduction(
      [{ playerId: SAME_LINE_IN_HITTERS, kind: 'hitter', teamId: HITTERS_CLUB, level: LEVEL, leagueId: 999, leagueName: 'Empty League' }],
      SEASON
    );
    const p = out.get(SAME_LINE_IN_HITTERS)!;
    expect(p.percentile).toBeNull();
    expect(p.unassessable).not.toBeNull();
    expect(p.unassessableDetail).toMatch(/./);
  });
});

describe('a peer has to be on a roster (F-0-farm)', () => {
  it('does not let signings nobody has assigned move the level\'s rostered average age', () => {
    const before = computeProspects(IDS.mlbTeam) as { baselines: Record<string, { avgAge: number | null; players: number }> };
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const id = 9300 + i;
      ids.push(id);
      db.prepare(
        `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
         VALUES (?, 'Unassigned', ?, 16, 7, 0, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
      ).run(id, `Signing${i}`, IDS.mlbTeam, IDS.mlbTeam);
    }
    try {
      const after = computeProspects(IDS.mlbTeam) as { baselines: Record<string, { avgAge: number | null; players: number }> };
      expect(after.baselines['1'].players).toBe(before.baselines['1'].players);
      expect(after.baselines['1'].avgAge).toBe(before.baselines['1'].avgAge);
    } finally {
      for (const id of ids) db.prepare('DELETE FROM players WHERE player_id = ?').run(id);
    }
  });
});
