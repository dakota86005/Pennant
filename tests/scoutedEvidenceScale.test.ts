import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearScaleCache } from '../server/valuation.js';
import { loadScoutedAbilities, ratingScale, scoutedGloves } from '../server/scoutedEvidence.js';
import { evaluateDevelopmentProtection } from '../server/developmentFit.js';
import { IDS } from './fixture.js';

/**
 * OOTP lets the user pick the rating scale — 20-80, 1-20, 1-10, 2-8 or 1-5 —
 * and the export carries no column saying which. The development engines'
 * thresholds are written for 20-80, so evidence is normalized to it. These
 * tests rewrite the save onto each scale and check that the same relative
 * ability reads the same.
 */

const PLAYER = 92_001;
const FIELDER = 92_002;

function useScale(max: number, min: number): void {
  // Flatten the four columns the scale is detected from, so this save's top is exactly `max`
  db.exec(`
    UPDATE players_batting SET batting_ratings_overall_contact = ${min}, batting_ratings_overall_power = ${min};
    UPDATE players_pitching SET pitching_ratings_overall_stuff = ${min};
    UPDATE players_fielding SET fielding_ratings_infield_range = ${min};
  `);
  db.prepare(
    `UPDATE players_batting SET batting_ratings_overall_contact = ? WHERE player_id = ?`
  ).run(max, PLAYER);
  clearScaleCache();
}

function setTools(current: number[], potential: number[]): void {
  db.prepare(
    `UPDATE players_batting SET
       batting_ratings_overall_contact = ?, batting_ratings_overall_gap = ?, batting_ratings_overall_power = ?,
       batting_ratings_overall_eye = ?, batting_ratings_overall_strikeouts = ?,
       batting_ratings_talent_contact = ?, batting_ratings_talent_gap = ?, batting_ratings_talent_power = ?,
       batting_ratings_talent_eye = ?, batting_ratings_talent_strikeouts = ?
     WHERE player_id = ?`
  ).run(...current, ...potential, PLAYER);
  clearScaleCache();
}

function seed(): void {
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Sc', 'Ale', 21, 7, 0, 1, 1, 9, ?, ?, 0, 0, 0, 0)`
  ).run(PLAYER, IDS.aaaTeam, IDS.mlbTeam);
  db.prepare(`INSERT INTO players_batting (player_id) VALUES (?)`).run(PLAYER);
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Fi', 'Elder', 21, 4, 0, 1, 1, 9, ?, ?, 0, 0, 0, 0)`
  ).run(FIELDER, IDS.aaaTeam, IDS.mlbTeam);
  db.prepare(
    `INSERT INTO players_fielding (player_id, position, fielding_rating_pos4, fielding_rating_pos4_pot,
       fielding_rating_pos6, fielding_rating_pos6_pot)
     VALUES (?, 4, 6, 6, 4, 7)`
  ).run(FIELDER);
}

seed();

describe('rating scale', () => {
  it('reads a 20-80 save as it is', () => {
    useScale(80, 20);
    setTools([40, 45, 50, 55, 60], [55, 55, 55, 55, 55]);
    expect(ratingScale()).toMatchObject({ max: 80, min: 20, native2080: true });
    const a = loadScoutedAbilities([PLAYER]).for(PLAYER);
    expect(a.current).toBe(50);
    expect(a.potential).toBe(55);
    expect(a.currentTools.contact).toBe(40);
  });

  it.each([
    // scale max, scale min, the value 50% and 75% of the way up
    [20, 1, 10.5, 15.25],
    [10, 1, 5.5, 7.75],
    [8, 2, 5, 6.5],
    [5, 1, 3, 4],
  ])('normalizes a 1-%i style scale (min %i) onto 20-80', (max, min, half, threeQuarter) => {
    useScale(max, min);
    // The top of the scale sits in contact and power, which is where the scale is detected from
    setTools(
      [max, half, max, half, half],
      [threeQuarter, threeQuarter, threeQuarter, threeQuarter, threeQuarter]
    );
    const scale = ratingScale();
    expect(scale).toMatchObject({ max, min, native2080: false });

    const a = loadScoutedAbilities([PLAYER]).for(PLAYER);
    // Halfway up any scale is 50; the top of any scale is 80; three-quarters is 65
    expect(a.currentTools.gap).toBeCloseTo(50, 0);
    expect(a.currentTools.contact).toBe(80);
    expect(a.potentialTools.gap).toBeCloseTo(65, 0);
    expect(a.current).toBe(62); // (80 + 50 + 80 + 50 + 50) / 5
    expect(a.potential).toBe(65);
  });

  it('gives a player the same protection wherever the save puts the scale', () => {
    useScale(80, 20);
    setTools([80, 50, 80, 50, 50], [65, 65, 65, 65, 65]);
    const on2080 = evaluateDevelopmentProtection({ age: 20, ability: loadScoutedAbilities([PLAYER]).for(PLAYER) });

    // The same halfway/three-quarters ability on a 1-10 save
    useScale(10, 1);
    setTools([10, 5.5, 10, 5.5, 5.5], [7.75, 7.75, 7.75, 7.75, 7.75]);
    const on110 = evaluateDevelopmentProtection({ age: 20, ability: loadScoutedAbilities([PLAYER]).for(PLAYER) });

    expect(on110.score).toBe(on2080.score);
    expect(on110.tier).toBe(on2080.tier);
  });

  it('normalizes revealed fielding grades too, so position thresholds keep their meaning', () => {
    useScale(10, 1);
    const g = scoutedGloves(FIELDER)!;
    const second = g.positions.find((p) => p.code === '2B')!;
    const short = g.positions.find((p) => p.code === 'SS')!;
    // 6 of 10 and 4 of 10 on a 1-10 scale
    expect(second.current).toBeCloseTo(20 + (60 * 5) / 9, 0);
    expect(short.current).toBeCloseTo(20 + (60 * 3) / 9, 0);
    expect(short.potential).toBeGreaterThan(short.current);
  });

  it('leaves fielding grades alone on a 20-80 save', () => {
    db.prepare(`UPDATE players_fielding SET fielding_rating_pos4 = 60, fielding_rating_pos6 = 35 WHERE player_id = ?`).run(FIELDER);
    useScale(80, 20);
    const g = scoutedGloves(FIELDER)!;
    expect(g.positions.find((p) => p.code === '2B')!.current).toBe(60);
    expect(g.positions.find((p) => p.code === 'SS')!.current).toBe(35);
  });
});
