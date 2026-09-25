import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import {
  battingHistory, clearResultsCaches, currentSeason, fieldingUsage, handedness, loadPitcherResults, pitchingHistory,
} from '../server/resultsEvidence';
import { clearStatCaches } from '../server/stats';
import { RESULTS_PRIOR } from '../server/resultsMetrics';
import { IDS } from './fixture';

/*
 * The adapter reads objective results from the export's own tables, sums stints, tolerates missing columns, and
 * ranks a player against the league's own pitchers. It reads no rating column.
 */

const LEAGUE = IDS.league;
const inserted: number[] = [];
const P = [9001, 9002, 9003, 9004];

beforeAll(() => {
  clearStatCaches(); clearResultsCaches();
  const year = currentSeason(LEAGUE) as number;
  const ins = db.prepare(`INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, outs, er, ra, ha, bb, k, hra, hp, bf, g, gs, w, l, s, hld, war)
    VALUES (?, ?, 1, ?, 1, 1, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, 0, 0, 0, 0, 1.0)`);
  // four starters, two seasons each; 9001 is the best on peripherals, 9004 the worst. Two clubs in one season for 9001 (a stint).
  const rows: Array<[number, number, number, number, number, number, number, number, number, number, number]> = [
    // id, year, outs, er, ra, bb, k, hra, bf, g, gs
    [9001, year, 300, 30, 32, 15, 130, 6, 400, 15, 15], [9001, year - 1, 500, 60, 62, 30, 210, 12, 690, 26, 26],
    [9002, year, 300, 40, 42, 25, 100, 10, 420, 15, 15], [9002, year - 1, 500, 70, 72, 40, 160, 16, 700, 26, 26],
    [9003, year, 300, 50, 52, 35, 80, 14, 440, 15, 15], [9003, year - 1, 500, 80, 82, 50, 130, 20, 720, 26, 26],
    [9004, year, 300, 65, 67, 50, 60, 20, 460, 15, 15], [9004, year - 1, 500, 100, 102, 70, 100, 26, 740, 26, 26],
  ];
  for (const r of rows) { ins.run(r[0], r[1], LEAGUE, r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10]); inserted.push(r[0]); }
  // a second stint (traded) for 9001 in the current year: must be summed with the first
  db.prepare(`INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, outs, er, ra, ha, bb, k, hra, hp, bf, g, gs, w, l, s, hld, war)
    VALUES (9001, ?, 2, ?, 1, 1, 30, 3, 3, 0, 2, 12, 1, 0, 40, 2, 0, 0, 0, 0, 0, 0)`).run(year, LEAGUE);
});

afterAll(() => {
  db.prepare(`DELETE FROM players_career_pitching_stats WHERE player_id IN (${P.join(',')})`).run();
  clearStatCaches(); clearResultsCaches();
});

describe('reading results from the export', () => {
  it('sums a player\'s stints into one line per season', () => {
    const year = currentSeason(LEAGUE) as number;
    const lines = pitchingHistory([9001], LEAGUE, year).get(9001)!;
    const now = lines.find((l) => l.year === year)!;
    expect(now.outs).toBe(330);
    expect(now.k).toBe(142);
    expect(lines.map((l) => l.year).sort()).toEqual([year - 1, year]);
  });

  it('tolerates a column the export does not carry: it reads as zero, not as an error', () => {
    const year = currentSeason(LEAGUE) as number;
    const line = pitchingHistory([9001], LEAGUE, year).get(9001)![0];
    expect(line.li).toBe(0);   // the fixture has no leverage column
    expect(line.gf).toBe(0);
  });

  it('only reads the last three seasons, at the major-league level, in the league asked', () => {
    const year = currentSeason(LEAGUE) as number;
    db.prepare(`INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, outs, er, bb, k, hra, hp, bf, g, gs) VALUES (9002, ?, 1, ?, 1, 1, 90, 9, 5, 30, 2, 0, 130, 5, 5)`).run(year - 6, LEAGUE);
    db.prepare(`INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, outs, er, bb, k, hra, hp, bf, g, gs) VALUES (9002, ?, 1, ?, 2, 1, 90, 9, 5, 30, 2, 0, 130, 5, 5)`).run(year, LEAGUE);
    try {
      const lines = pitchingHistory([9002], LEAGUE, year).get(9002)!;
      expect(lines.map((l) => l.year).sort()).toEqual([year - 1, year]);
    } finally {
      db.prepare(`DELETE FROM players_career_pitching_stats WHERE player_id = 9002 AND (year = ? OR level_id = 2)`).run(year - 6);
    }
  });

  it('ranks a starter against the league\'s own starters, better peripherals higher, and says how much to trust it', () => {
    const r = loadPitcherResults(P, LEAGUE, 'starter', RESULTS_PRIOR);
    const pct = (id: number) => r.get(id)!.skillsPercentile;
    expect(pct(9001)!).toBeGreaterThan(pct(9002)!);
    expect(pct(9002)!).toBeGreaterThan(pct(9004)!);
    expect(r.get(9001)!.reliability).toBeGreaterThan(0.5);
    expect(r.get(9001)!.inningsPerStart).toBeCloseTo((830 / 3) / 41, 1);
    expect(r.get(9001)!.calibration).toBe(RESULTS_PRIOR.stamp); // the params' own stamp: the starting values are provisional
  });

  it('a player with no rows has no result, which is different from a bad one', () => {
    expect(loadPitcherResults([987654], LEAGUE, 'starter', RESULTS_PRIOR).has(987654)).toBe(false);
  });

  it('reads handedness and fielding usage as facts, and empty inputs as nothing', () => {
    expect(handedness([]).size).toBe(0);
    expect(fieldingUsage([], LEAGUE, 2030).size).toBe(0);
    expect(battingHistory([], LEAGUE, 2030).size).toBe(0);
    const hands = handedness([IDS.lefty, IDS.switcher]);
    expect(hands.get(IDS.lefty)?.bats).toBe('L');
    expect(hands.get(IDS.switcher)?.bats).toBe('S');
  });
});
