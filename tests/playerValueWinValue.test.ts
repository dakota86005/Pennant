import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clubWinValue, type ClubWinValue } from '../server/playerValue.js';
import { WIN_CURVE_CALIBRATION, WIN_VALUE_POLICY } from '../server/playerValueCalibration.js';

/*
 * Player Value phase 5b: the club's value of a win (PLAYER_VALUE.md Part 4.5, BEHAVIOR_CASES.md "Player Value",
 * phase 5b). A club fact, not philosophy: from the deadline read's odds model, how much one more win moves this
 * club's chance of the postseason, in playoff odds (Q-6), with its basis. Built on a synthetic conference in the
 * fixture league; no case names a club.
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
  const batting = db.prepare(`INSERT INTO team_batting_stats (team_id, year, split_id, level_id, g, r) VALUES (?, 2026, 0, 1, ?, ?)`);
  const pitching = db.prepare(`INSERT INTO team_pitching_stats (team_id, year, split_id, level_id, g, r) VALUES (?, 2026, 0, 1, ?, ?)`);
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

describe('the club\'s value of a win is a club fact, in playoff odds', () => {
  it('a club far out of the race gains almost nothing from a win, a club in a tight race gains the most, and a club whose place is beyond reach gains nothing', () => {
    const [, holder, far, , tight] = buildConference(RACE);
    const t = clubWinValue(tight);
    const f = clubWinValue(far);
    const h = clubWinValue(holder);
    for (const v of [t, f, h]) expect(v.status).toBe('known');
    expect(t.perWin!).toBeGreaterThan(f.perWin!);
    expect(t.perWin!).toBeGreaterThan(0.03);
    expect(f.perWin!).toBeLessThan(0.01);
    expect(f.perWin!).toBeGreaterThanOrEqual(0);

    // A leader twenty games clear with twelve to play: the place is beyond reach, and a win moves nothing
    const [leader, , , , , last] = buildConference([
      { division: 0, w: 100, l: 50, pos: 1, scheduled: 162 },
      { division: 0, w: 80, l: 70, pos: 2, scheduled: 162 },
      { division: 0, w: 70, l: 80, pos: 3, scheduled: 162 },
      { division: 1, w: 90, l: 60, pos: 1, scheduled: 162 },
      { division: 1, w: 85, l: 65, pos: 2, scheduled: 162 },
      { division: 1, w: 50, l: 100, pos: 3, scheduled: 162 },
    ]);
    const d = clubWinValue(leader);
    expect(d.status).toBe('decided');
    expect(d.perWin).toBe(0);
    expect(d.reason).toMatch(/12/);
    const out = clubWinValue(last);
    expect(out.status).toBe('decided');
    expect(out.perWin).toBe(0);
  });

  it('the curve: more wins over the rest of the season never lower the odds, and fewer never raise them', () => {
    const [, , , , tight] = buildConference(RACE);
    const v = clubWinValue(tight);
    expect(v.curve.map((c) => c.wins)).toEqual(
      Array.from({ length: WIN_VALUE_POLICY.curve.fewer + WIN_VALUE_POLICY.curve.more + 1 }, (_, i) => i - WIN_VALUE_POLICY.curve.fewer),
    );
    for (let i = 1; i < v.curve.length; i++) expect(v.curve[i].odds).toBeGreaterThanOrEqual(v.curve[i - 1].odds);
    const now = v.curve.find((c) => c.wins === 0)!;
    const one = v.curve.find((c) => c.wins === 1)!;
    expect(v.perWin!).toBeCloseTo(one.odds - now.odds, 12);
  });

  it('is stated in playoff odds, never in dollars, with its basis named, and stamped provisional', () => {
    const [, , , , tight] = buildConference(RACE);
    const v = clubWinValue(tight);
    expect(v.unit).toBe('playoff odds');
    const words = [v.text, ...v.basis].join(' ');
    expect(words).not.toMatch(/\$/);
    expect(words).toMatch(/run/i);
    expect(words).toMatch(/\.520/);
    expect(words).toMatch(/60 games left/);
    expect(words).toMatch(/not.*(dollar|money)|never.*(dollar|money)/i);
    expect(v.stamp).toBe(WIN_CURVE_CALIBRATION);
    expect(v.stamp.status).toBe('provisional');
  });

  it('is the same whatever the philosophy: it is read from the standings, the runs and the schedule only', () => {
    expect(clubWinValue.length).toBe(1);
    const source = fs.readFileSync(path.join(process.cwd(), 'server', 'playerValueWinValue.ts'), 'utf8');
    expect(source).not.toMatch(/philosophy|settings|competitiveWindow|staffPreference/);
  });
});

describe('where the odds cannot be read, it says why, never a default', () => {
  it('before a game is played, it is unknown with the reason', () => {
    const [club] = buildConference([{ division: 0, w: 0, l: 0, pos: 1 }, { division: 0, w: 0, l: 0, pos: 2 }]);
    const v: ClubWinValue = clubWinValue(club);
    expect(v.status).toBe('unknown');
    expect(v.perWin).toBeNull();
    expect(v.odds).toBeNull();
    expect(v.reason).toMatch(/no game/i);
  });

  it('with no standings for the club, it is unknown with the reason', () => {
    buildConference(RACE);
    const v = clubWinValue(9599);
    expect(v.status).toBe('unknown');
    expect(v.reason).toMatch(/standings/i);
  });

  it('with no games left, a win can no longer be added: not applicable, with the reason', () => {
    const [club] = buildConference([
      { division: 0, w: 90, l: 72, pos: 1, scheduled: 162 },
      { division: 0, w: 89, l: 73, pos: 2, scheduled: 162 },
    ]);
    const v = clubWinValue(club);
    expect(v.status).toBe('no_games_left');
    expect(v.perWin).toBeNull();
    expect(v.reason).toMatch(/no games left/i);
  });

  it('where the club\'s place in the race is not established, it is unknown with the reason, never read as level', () => {
    const [club] = buildConference([
      { division: 0, w: 50, l: 50, pos: 1, allstar: true },
      { division: 0, w: 50, l: 50, pos: 2 },
    ]);
    const v = clubWinValue(club);
    expect(v.status).toBe('unknown');
    expect(v.reason).toMatch(/race/i);
  });
});
