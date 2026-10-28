import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { mlbOverview, organizationContext } from '../server/mlbOperations.js';
import { clubWinValue } from '../server/playerValue.js';
import { deadlineRead } from '../server/posture.js';
import { actBar, readContext } from '../server/staffPreference.js';
import { IDS, SEASON } from './fixture.js';

/*
 * D-036 and D-060, amended 2026-10-28 (B-62; SRVMLB-03, SRVMLB-13, SRVVALUE-10): the postseason odds never move the
 * staff's advice. Only the odds change between the two seasons below (the same club, the same roster, the same
 * philosophy); the odds swing from a long shot to near certain, and Major League Ops' urgency, its bar for "act", its
 * needs and their order, and Player Value's club value of a win do not move. BEHAVIOR_CASES.md "Odds never move the
 * staff's advice".
 */

/** The club's season, as the export writes it: the record, its one row of runs this season, its regular season. */
function season(w: number, l: number, rs: number, ra: number): void {
  db.prepare('DELETE FROM team_record WHERE team_id = ?').run(IDS.mlbTeam);
  db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, ?, ?, ?, 0, 2, ?, 6, 0, 1000)`)
    .run(IDS.mlbTeam, w + l, w, l, w / (w + l));
  for (const table of ['team_batting_stats', 'team_pitching_stats']) db.prepare(`DELETE FROM ${table} WHERE team_id = ?`).run(IDS.mlbTeam);
  db.prepare('INSERT INTO team_batting_stats (team_id, year, split_id, level_id, g, r) VALUES (?, ?, 0, 1, ?, ?)').run(IDS.mlbTeam, SEASON, w + l, rs);
  db.prepare('INSERT INTO team_pitching_stats (team_id, year, split_id, level_id, g, r) VALUES (?, ?, 0, 1, ?, ?)').run(IDS.mlbTeam, SEASON, w + l, ra);
  db.prepare('DELETE FROM games WHERE game_id >= 700000').run();
  const game = db.prepare(`INSERT INTO games (game_id, home_team, away_team, date, played, game_type, league_id) VALUES (?, ?, ?, ?, ?, 0, ?)`);
  for (let i = 0; i < 162; i++) game.run(700_000 + i, IDS.mlbTeam, IDS.otherMlbTeam, `${SEASON}-6-1`, i < w + l ? 1 : 0, IDS.league);
}

/** Everything the staff's advice and Player Value's club context say, as the GM is served them. */
function advice() {
  const org = organizationContext(IDS.mlbTeam);
  const overview = mlbOverview(IDS.mlbTeam);
  return {
    org,
    read: readContext(org),
    bar: actBar(org),
    context: overview.context,
    needs: overview.needs.map((n) => [n.id, n.severity, n.explanation?.neutralSeverity ?? null, n.shading ?? []]),
    winValue: clubWinValue(IDS.mlbTeam),
  };
}

describe('the odds never move the staff\'s advice', () => {
  it('a long shot and a near-certain club get the same urgency, act bar, needs, order and value of a win', () => {
    season(60, 30, 520, 380); // well clear: near certain
    const high = deadlineRead(IDS.mlbTeam);
    const contender = advice();
    season(30, 60, 380, 520); // far out: a long shot
    const low = deadlineRead(IDS.mlbTeam);
    const longShot = advice();
    // The odds really did move (the staff's rough read in Standings still reads them)
    expect(high).not.toBeNull();
    expect(low).not.toBeNull();
    expect(high!.odds - low!.odds).toBeGreaterThan(0.5);
    // ...and nothing the staff advises did
    expect(longShot).toEqual(contender);
  });

  it('with the default philosophy (nothing stated), a club in the race is at the neutral bar: nothing leans', () => {
    season(60, 30, 520, 380);
    expect(deadlineRead(IDS.mlbTeam)!.odds).toBeGreaterThan(0.55); // what once read "in it" and pressed a balanced club
    const { org, read, bar, needs } = advice();
    expect(org).toEqual({ dimensions: expect.objectContaining({ competitiveWindow: 50 }) });
    expect(read!.urgency).toBe('normal');
    expect(bar).toEqual(actBar(null));
    for (const [, , , shading] of needs) expect(shading).toEqual([]);
    expect(JSON.stringify(read)).not.toMatch(/postseason|playoff|\bodds\b|\bseason\b/i);
  });
});
