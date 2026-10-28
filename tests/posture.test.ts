import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../server/db.js';
import { deadlineRead, oddsModelOf } from '../server/posture.js';
import { IDS, SEASON } from './fixture.js';

/**
 * Buy, hold or sell.
 *
 * The verdict comes from one number — the chance of reaching the postseason —
 * so the tests are about whether that number moves for the right reasons. The
 * one that matters most is time: five games out in May and five games out in
 * September are the same line in the standings and opposite answers, and a
 * tool that cannot tell them apart is worse than no tool.
 *
 * Talent is taken from run differential rather than won-lost record, so a club
 * outscoring its opponents while losing should read better than its record.
 */

/**
 * The club's season as the export writes it: its one row per team table at the major league in the league's season,
 * its regular season in `games` (game_type 0), and `exhibitions` more games of another type (spring training).
 */
const setSeason = (w: number, l: number, rs: number, ra: number, scheduled = 162, exhibitions = 0) => {
  db.prepare(`DELETE FROM team_record WHERE team_id = ?`).run(IDS.mlbTeam);
  db.prepare(
    `INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number)
     VALUES (?, ?, ?, ?, 0, 2, ?, 6, 0, 1000)`
  ).run(IDS.mlbTeam, w + l, w, l, w / (w + l));
  db.prepare(`DELETE FROM team_batting_stats WHERE team_id = ?`).run(IDS.mlbTeam);
  db.prepare(`DELETE FROM team_pitching_stats WHERE team_id = ?`).run(IDS.mlbTeam);
  db.prepare(`INSERT INTO team_batting_stats (team_id, year, split_id, level_id, g, r) VALUES (?,?,0,1,?,?)`)
    .run(IDS.mlbTeam, SEASON, w + l, rs);
  db.prepare(`INSERT INTO team_pitching_stats (team_id, year, split_id, level_id, g, r) VALUES (?,?,0,1,?,?)`)
    .run(IDS.mlbTeam, SEASON, w + l, ra);
  db.prepare(`DELETE FROM games`).run();
  const g = db.prepare(`INSERT INTO games (game_id, home_team, away_team, date, played, game_type) VALUES (?,?,?,?,?,?)`);
  for (let i = 0; i < scheduled; i++) g.run(9000 + i, IDS.mlbTeam, IDS.otherMlbTeam, `${SEASON}-6-1`, i < w + l ? 1 : 0, 0);
  // Spring training, already played: another game type, never a game left
  for (let i = 0; i < exhibitions; i++) g.run(19000 + i, IDS.mlbTeam, IDS.otherMlbTeam, `${SEASON}-3-1`, 1, 1);
};

describe('reading the season', () => {
  it('says the same record differently in May and in September', () => {
    // Six games back either way; the difference is only how much time is left
    setSeason(40, 45, 400, 410);          // 85 played, 77 to go
    const may = deadlineRead(IDS.mlbTeam)!;
    setSeason(72, 82, 720, 740);          // 154 played, 8 to go
    const september = deadlineRead(IDS.mlbTeam)!;
    expect(may.odds).toBeGreaterThan(september.odds);
    expect(september.gamesLeft).toBeLessThan(may.gamesLeft);
  });

  it('reads the runs, not the record', () => {
    // Identical 45-46 records; one is outscoring its opponents comfortably
    setSeason(45, 46, 500, 400);
    const good = deadlineRead(IDS.mlbTeam)!;
    setSeason(45, 46, 400, 500);
    const bad = deadlineRead(IDS.mlbTeam)!;
    expect(good.odds).toBeGreaterThan(bad.odds);
    expect(good.runDiff).toBe(100);
    expect(bad.runDiff).toBe(-100);
  });

  it('says so when the record flatters the runs, and when it hides them', () => {
    setSeason(60, 31, 400, 420);   // winning far more than the runs support
    expect(deadlineRead(IDS.mlbTeam)!.reasons.join(' ')).toMatch(/more than the runs support/);
    setSeason(31, 60, 420, 400);   // losing far more
    expect(deadlineRead(IDS.mlbTeam)!.reasons.join(' ')).toMatch(/better than the record looks/);
  });

  it('lands on a verdict that matches the odds it printed', () => {
    for (const [w, l, rs, ra] of [[70, 20, 600, 400], [45, 45, 450, 450], [25, 65, 350, 550]]) {
      const r = deadlineRead(IDS.mlbTeam) ?? (setSeason(w, l, rs, ra), deadlineRead(IDS.mlbTeam)!);
      setSeason(w, l, rs, ra);
      const read = deadlineRead(IDS.mlbTeam)!;
      if (read.posture === 'buy') expect(read.odds).toBeGreaterThanOrEqual(0.75);
      if (read.posture === 'sell') expect(read.odds).toBeLessThan(0.10);
      expect(read.headline).toContain(`${Math.round(read.odds * 100)}%`);
    }
  });

  it('is willing to say hold rather than invent a decision', () => {
    setSeason(45, 46, 455, 450);
    const read = deadlineRead(IDS.mlbTeam)!;
    expect(['hold', 'lean-buy', 'lean-sell']).toContain(read.posture);
  });

  it('gives nothing at all before a game has been played', () => {
    setSeason(0, 0, 0, 0);
    expect(deadlineRead(IDS.mlbTeam)).toBeNull();
  });
});

describe('the odds model reads the regular season only (D-060, amended 2026-10-28: Standings is its one reader)', () => {
  it('spring-training games do not add to the games left', () => {
    setSeason(140, 10, 900, 500, 162, 0);
    const clean = oddsModelOf(IDS.mlbTeam).model!;
    setSeason(140, 10, 900, 500, 162, 30);
    const withSpring = oddsModelOf(IDS.mlbTeam).model!;
    expect(clean.gamesLeft).toBe(12);
    expect(withSpring.gamesLeft).toBe(clean.gamesLeft);
  });

  it('a season that has ended has no games left, whatever exhibitions the export carries', () => {
    setSeason(81, 81, 700, 700, 162, 30);
    expect(deadlineRead(IDS.mlbTeam)!.gamesLeft).toBe(0);
  });

  it('reads the club\'s one row of runs this season, never a placeholder row or another season\'s', () => {
    setSeason(45, 46, 500, 400);
    const before = deadlineRead(IDS.mlbTeam)!;
    // OOTP's placeholder rows (year 0) and last season's row sit beside this season's
    db.prepare(`INSERT INTO team_batting_stats (team_id, year, split_id, level_id, g, r) VALUES (?,0,0,1,0,0)`).run(IDS.mlbTeam);
    db.prepare(`INSERT INTO team_batting_stats (team_id, year, split_id, level_id, g, r) VALUES (?,?,0,1,162,900)`).run(IDS.mlbTeam, SEASON - 1);
    db.prepare(`INSERT INTO team_pitching_stats (team_id, year, split_id, level_id, g, r) VALUES (?,?,0,1,162,300)`).run(IDS.mlbTeam, SEASON - 1);
    expect(deadlineRead(IDS.mlbTeam)!.runDiff).toBe(before.runDiff);
    expect(before.runDiff).toBe(100);
  });

  it('runs that are not established leave the model unread, never a level club', () => {
    setSeason(45, 46, 500, 400);
    // Two rows for the club this season: which is its total is not established
    db.prepare(`INSERT INTO team_batting_stats (team_id, year, split_id, level_id, g, r) VALUES (?,?,1,1,91,250)`).run(IDS.mlbTeam, SEASON);
    const read = oddsModelOf(IDS.mlbTeam);
    expect(read.model).toBeNull();
    expect(read.reason).toMatch(/not established/);
    expect(deadlineRead(IDS.mlbTeam)).toBeNull();
    // No runs at all this season
    setSeason(45, 46, 500, 400);
    db.prepare(`DELETE FROM team_pitching_stats WHERE team_id = ?`).run(IDS.mlbTeam);
    expect(oddsModelOf(IDS.mlbTeam).model).toBeNull();
  });
});
