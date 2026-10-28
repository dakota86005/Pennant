import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearFieldingPopulationCache, ratingSource, scoutedGloves } from '../server/scoutedEvidence.js';
import { tradeContext } from '../server/trade.js';
import { IDS } from './fixture';
import { setExportRatingMode } from './ratingModeFixture';

/*
 * The trade desk's fielding line, and whose grades it carries (D-067, B-66). It read `players_fielding` directly through
 * a raw reader in `gloves.ts`, so in a "Show real player ratings" export the desk (and the model it briefs) was handed
 * the true grade, 41 at short, where our scouts say 75 (deep hunt SRVSTATS-01). And with OSA's rows in the export's
 * scouted file but none of ours, OSA's view was preferred over the main tables only when the kind was known to be
 * "real": an unknown kind, which may be true ratings too, read the main tables (deep hunt SRVDEV-09).
 */

const OURS = IDS.mlbTeam;
const OSA = 0;
const MAN = IDS.optioned;
const OUR_GRADE = 75;
const OSA_GRADE = 62;
const TRUE_GRADE = 41;

const columnsOf = (table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
const RATING = /^(batting_ratings_|pitching_ratings_|fielding_rating|running_ratings_)/;
let saved: Record<string, unknown> | undefined;
let position = 0;

function fileWith(rows: Array<[number, number]>): void {
  const ratingColumns = [...new Set(['players_batting', 'players_pitching', 'players_fielding'].flatMap(columnsOf).filter((c) => RATING.test(c)))];
  db.exec('DROP TABLE IF EXISTS players_scouted_ratings');
  db.exec(`CREATE TABLE players_scouted_ratings (player_id INTEGER, team_id INTEGER, league_id INTEGER, position INTEGER, role INTEGER,
    scouting_coach_id INTEGER, scouting_team_id INTEGER, ${ratingColumns.map((c) => `${c} INTEGER`).join(', ')})`);
  for (const [team, grade] of rows) {
    const values: Record<string, unknown> = { player_id: MAN, team_id: 0, league_id: IDS.league, position, role: 0, scouting_coach_id: 1, scouting_team_id: team };
    for (const c of ratingColumns) {
      const pos = /^fielding_rating_pos(\d)/.exec(c);
      values[c] = pos ? (Number(pos[1]) === position ? grade : 0) : grade;
    }
    const keys = Object.keys(values);
    db.prepare(`INSERT INTO players_scouted_ratings (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`).run(values);
  }
  clearFieldingPopulationCache();
}

beforeAll(() => {
  position = (db.prepare('SELECT position FROM players WHERE player_id = ?').get(MAN) as { position: number }).position;
  // The main table holds the true grade at his position (a "Show real player ratings" export)
  saved = db.prepare('SELECT * FROM players_fielding WHERE player_id = ?').get(MAN) as Record<string, unknown> | undefined;
  db.prepare('DELETE FROM players_fielding WHERE player_id = ?').run(MAN);
  db.prepare(`INSERT INTO players_fielding (player_id, position, fielding_rating_pos${position}, fielding_rating_pos${position}_pot) VALUES (?, ?, ?, ?)`)
    .run(MAN, position, TRUE_GRADE, TRUE_GRADE);
});

afterEach(() => {
  db.exec('DROP TABLE IF EXISTS players_scouted_ratings');
  setExportRatingMode(null);
  clearFieldingPopulationCache();
});

afterAll(() => {
  db.prepare('DELETE FROM players_fielding WHERE player_id = ?').run(MAN);
  if (saved) {
    const keys = Object.keys(saved);
    db.prepare(`INSERT INTO players_fielding (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`).run(saved);
  }
});

const deskLine = (): string | null => (tradeContext(IDS.mlbTeam, [MAN], []).weGive[0] as { fielding: string | null }).fielding;

describe('the trade desk\'s fielding line reads our scouts\' grades', () => {
  it('in a "real ratings" export with our scouts\' full reports: our 75, never the true 41', () => {
    setExportRatingMode('real');
    fileWith([[OURS, OUR_GRADE], [OSA, 30]]);
    expect(scoutedGloves(MAN)?.positions[0]?.current).toBe(OUR_GRADE);
    const line = deskLine();
    expect(line).toContain(String(OUR_GRADE));
    expect(line).not.toContain(String(TRUE_GRADE));
  });
});

describe('an export whose kind of ratings isn\'t known, with OSA\'s rows and none of ours', () => {
  it('reads OSA\'s view, said so, never the main tables (which may be true ratings)', () => {
    setExportRatingMode('unknown');
    fileWith([[OSA, OSA_GRADE]]);
    expect(scoutedGloves(MAN)?.positions[0]?.current).toBe(OSA_GRADE);
    expect(ratingSource().mode).toBe('osa');
    expect(ratingSource().text).toMatch(/isn't known/);
    expect(deskLine()).not.toContain(String(TRUE_GRADE));
  });

  it('a known scouts\'-view export keeps its main tables (control)', () => {
    setExportRatingMode('scouted');
    fileWith([[OSA, OSA_GRADE]]);
    expect(scoutedGloves(MAN)?.positions[0]?.current).toBe(TRUE_GRADE);
  });
});
