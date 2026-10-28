import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clubWinValue, type ClubWinValue } from '../server/playerValue.js';
import { SEASON } from './fixture.js';

/*
 * Player Value phase 5b: the club's value of a win (PLAYER_VALUE.md Part 4.5, BEHAVIOR_CASES.md "Player Value").
 * It was read on the deadline read's odds model; the owner retired the odds from Player Value (2026-10-28, D-060
 * amended), and nothing in D-052 or D-036 replaces them. So it is not established, said with its reason, whatever the
 * race: never a number, a default or a level race (D-018). Built on a synthetic conference in the fixture league; no
 * case names a club.
 */

const LEAGUE = 950;

interface Club { division: number; w: number; l: number; pos: number; rs?: number; ra?: number; scheduled?: number; allstar?: boolean }

/** A conference of the clubs given, one row each in the standings, runs for and against, and a schedule. */
function buildConference(clubs: Club[], wildCards = 1): number[] {
  const ids = clubs.map((_, i) => 9500 + i);
  db.prepare(`DELETE FROM team_record WHERE team_id >= 9500 AND team_id < 9600`).run();
  db.prepare(`DELETE FROM teams WHERE league_id = ?`).run(LEAGUE);
  db.prepare(`DELETE FROM team_batting_stats WHERE team_id >= 9500 AND team_id < 9600`).run();
  db.prepare(`DELETE FROM team_pitching_stats WHERE team_id >= 9500 AND team_id < 9600`).run();
  db.prepare(`DELETE FROM games WHERE home_team >= 9500 AND home_team < 9600`).run();
  db.prepare(`DELETE FROM league_playoffs WHERE league_id = ?`).run(LEAGUE);
  db.prepare(`INSERT INTO league_playoffs (league_id, num_wild_cards) VALUES (?, ?)`).run(LEAGUE, wildCards);
  const team = db.prepare(`INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team, human_team)
    VALUES (?, 'Club', ?, ?, 1, ?, 0, ?, 0, ?, 0)`);
  const record = db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, ?, ?, ?, 0, ?, ?, 0, 0, 1000)`);
  const batting = db.prepare(`INSERT INTO team_batting_stats (team_id, year, split_id, level_id, g, r) VALUES (?, ${SEASON}, 0, 1, ?, ?)`);
  const pitching = db.prepare(`INSERT INTO team_pitching_stats (team_id, year, split_id, level_id, g, r) VALUES (?, ${SEASON}, 0, 1, ?, ?)`);
  const game = db.prepare(`INSERT INTO games (game_id, home_team, away_team, date, played) VALUES (?, ?, 9999, '2026-6-1', 0)`);
  let gid = 950_000;
  clubs.forEach((c, i) => {
    const id = ids[i];
    team.run(id, `C${i}`, `C${i}`, LEAGUE, c.division, c.allstar ? 1 : 0);
    const played = c.w + c.l;
    record.run(id, played, c.w, c.l, c.pos, played > 0 ? c.w / played : 0);
    batting.run(id, played, c.rs ?? 450);
    pitching.run(id, played, c.ra ?? 450);
    for (let g = 0; g < (c.scheduled ?? 162); g++) game.run(gid++, id);
  });
  return ids;
}

/** Two divisions of three and one wild card, 60 games left: a club a game outside the last place, and one thirteen games outside. */
const RACE: Club[] = [
  { division: 0, w: 60, l: 42, pos: 1 },
  { division: 0, w: 51, l: 51, pos: 2 }, // holds the wild card
  { division: 0, w: 38, l: 64, pos: 3 }, // far out: thirteen games behind the last place
  { division: 1, w: 58, l: 44, pos: 1 },
  { division: 1, w: 50, l: 52, pos: 2 }, // in a tight race: a game behind the last place
  { division: 1, w: 40, l: 62, pos: 3 },
];

describe('the club\'s value of a win is not established: the odds left Player Value (D-060, amended 2026-10-28)', () => {
  it('is the same "not established" for a club far out, in a tight race and holding a place: the race moves nothing', () => {
    const [, holder, far, , tight] = buildConference(RACE);
    const reads = [tight, far, holder].map((id) => clubWinValue(id));
    for (const v of reads) {
      expect(v.status).toBe('unknown');
      expect(v.reason).toMatch(/no model/i);
      expect(v.text).toMatch(/isn't established/);
    }
    // Only the club's own name differs: nothing about its record, runs or place reaches it
    const strip = (v: ClubWinValue) => JSON.stringify([v.status, v.reason, v.basis, v.text.replace(/^.*?value of a win/, '')]);
    expect(new Set(reads.map(strip)).size).toBe(1);
  });

  it('carries no number, no odds and no playoff chance, never a dollar', () => {
    const [, , , , tight] = buildConference(RACE);
    const v = clubWinValue(tight);
    expect(Object.keys(v).sort()).toEqual(['basis', 'club', 'reason', 'status', 'teamId', 'text']);
    const words = [v.text, v.reason, ...v.basis].join(' ');
    expect(words).not.toMatch(/\$|\d+%|postseason|playoff|\bodds\b|posture/i);
  });

  it('reads no odds model, no philosophy and no setting', () => {
    expect(clubWinValue.length).toBe(1);
    for (const file of ['playerValueWinValue.ts', 'playerValue.ts']) {
      const source = fs.readFileSync(path.join(process.cwd(), 'server', file), 'utf8');
      expect(source, file).not.toMatch(/posture\.js|oddsModelOf|oddsAt|shownOdds|deadlineRead/);
    }
    const source = fs.readFileSync(path.join(process.cwd(), 'server', 'playerValueWinValue.ts'), 'utf8');
    expect(source).not.toMatch(/philosophy|settings|competitiveWindow|staffPreference/);
  });

  it('is not established before a game is played, or for a club with no standings, just the same', () => {
    const [club] = buildConference([{ division: 0, w: 0, l: 0, pos: 1 }, { division: 0, w: 0, l: 0, pos: 2 }]);
    expect(clubWinValue(club).status).toBe('unknown');
    expect(clubWinValue(9599).status).toBe('unknown');
  });
});
