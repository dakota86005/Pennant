import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearTwoWayCache } from '../server/twoway.js';
import request from './request';
import { IDS, SEASON } from './fixture';

/**
 * The hover card reads a player's current line straight off this list, so the
 * order is a contract, not an implementation detail. Taking the wrong end of it
 * showed a veteran his A-ball season from a decade earlier.
 */
describe('career rows', () => {
  it('come back newest first', async () => {
    const d = await request(`/api/player/${IDS.starter}`);
    expect(d.battingYears.length).toBeGreaterThan(1);
    expect(d.battingYears[0].year).toBe(SEASON);
    expect(d.battingYears[d.battingYears.length - 1].year).toBe(SEASON - 6);
  });

  it('name the level each line was compiled at', async () => {
    const d = await request(`/api/player/${IDS.starter}`);
    // Rate stats mean different things by level, and the card puts them beside
    // ratings that are on a major-league scale
    expect(d.battingYears[0].levelName).toBe('MLB');
    expect(d.battingYears[d.battingYears.length - 1].levelName).toBe('A');
  });
});

/**
 * What the card's header calls him.
 *
 * OOTP writes a pitcher-assignment code (11 starter, 12 reliever, 13 closer)
 * on hitters too: in one save 256 position players who had never thrown a
 * pitch carried one, and a shortstop's card read "RP". The code is a
 * pitcher's assignment, so only a pitcher is labelled by it. Whether a man
 * also pitches, or also bats, is read from what he has done, on the same test
 * the staff and lineup pages use (`twoway.ts`), never from that code.
 */
const HITTER_WITH_ROLE = 8200;
const TWO_WAY_HITTER = 8201;
const TWO_WAY_PITCHER = 8202;

describe('the card header', () => {
  beforeAll(() => {
    const player = db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                            uniform_number, team_id, organization_id, retired, hidden,
                            draft_eligible, college)
       VALUES (?, ?, ?, 22, ?, ?, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
    );
    player.run(HITTER_WITH_ROLE, 'Short', 'Stop', 6, 12, IDS.mlbTeam, IDS.mlbTeam);
    player.run(TWO_WAY_HITTER, 'Both', 'Ways', 3, 11, IDS.mlbTeam, IDS.mlbTeam);
    player.run(TWO_WAY_PITCHER, 'Arm', 'Bat', 1, 11, IDS.mlbTeam, IDS.mlbTeam);

    const batting = db.prepare(
      `INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa)
       VALUES (?, ?, ?, ?, 1, 1, ?)`
    );
    const pitching = db.prepare(
      `INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, outs, gs)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`
    );
    batting.run(HITTER_WITH_ROLE, SEASON, IDS.mlbTeam, IDS.league, 300);
    batting.run(TWO_WAY_HITTER, SEASON, IDS.mlbTeam, IDS.league, 120);
    pitching.run(TWO_WAY_HITTER, SEASON, IDS.mlbTeam, IDS.league, 110, 5);
    batting.run(TWO_WAY_PITCHER, SEASON, IDS.mlbTeam, IDS.league, 130);
    pitching.run(TWO_WAY_PITCHER, SEASON, IDS.mlbTeam, IDS.league, 125, 8);
    clearTwoWayCache();
  });

  it('labels a position player by his position, even when the export gives him a pitcher-assignment code', async () => {
    const d = await request(`/api/player/${HITTER_WITH_ROLE}`);
    expect(d.positionName).toBe('SS');
    expect(d.roleName).toBeNull();
    expect(d.twoWay).toBe(false);
  });

  it('labels a pitcher by his pitching role', async () => {
    const d = await request(`/api/player/${IDS.extended}`);
    expect(d.positionName).toBe('P');
    expect(d.roleName).toBe('SP');
    expect(d.twoWay).toBe(false);
  });

  it('marks a position player who has pitched a real amount as two-way, without reading a role off the code', async () => {
    const d = await request(`/api/player/${TWO_WAY_HITTER}`);
    expect(d.positionName).toBe('1B');
    expect(d.roleName).toBeNull();
    expect(d.twoWay).toBe(true);
  });

  it('marks a pitcher who has batted a real amount as two-way and keeps his pitching role', async () => {
    const d = await request(`/api/player/${TWO_WAY_PITCHER}`);
    expect(d.roleName).toBe('SP');
    expect(d.twoWay).toBe(true);
  });
});
