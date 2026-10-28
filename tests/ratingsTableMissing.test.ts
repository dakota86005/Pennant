import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearFieldingPopulationCache } from '../server/scoutedEvidence.js';
import { computePitchingStaff } from '../server/pitching.js';
import { computeDraft } from '../server/rosterops.js';
import { computeRoster } from '../server/roster.js';
import { IDS } from './fixture';
import request from './request';

/*
 * An export without a ratings table (OOTP's settings can switch one off): the pitching staff and the draft board named
 * the main table themselves when the evidence had no source (`ratingFrom(...)?.from ?? 'players_pitching'`) and failed
 * the whole page with "no such table" (deep hunt SRVDEV-05). Every grade of that family reads as unknown instead (D-018).
 */

const hide = (table: string) => {
  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_hidden`);
  clearFieldingPopulationCache();
};

afterEach(() => {
  for (const table of ['players_pitching', 'players_batting']) {
    if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(`${table}_hidden`)) db.exec(`ALTER TABLE ${table}_hidden RENAME TO ${table}`);
  }
  db.prepare(`UPDATE leagues SET show_draft_pool = 0 WHERE league_id = ?`).run(IDS.league);
  clearFieldingPopulationCache();
});

describe('an export without the pitching ratings table', () => {
  it('still serves the pitching staff, every grade unknown', () => {
    hide('players_pitching');
    const staff = computePitchingStaff(IDS.mlbTeam);
    if (!staff.ok) throw new Error(staff.error);
    const arms = [...staff.body.rotation, ...staff.body.bullpen] as Array<Record<string, unknown>>;
    expect(arms.length).toBeGreaterThan(0);
    expect(arms.every((a) => a.stamina === null && a.stuff === null)).toBe(true);
  });

  it('still serves the player card and the roster, its pitching grades unknown', async () => {
    hide('players_pitching');
    const card = await request(`/api/player/${IDS.optioned}`);
    expect(card.pitchingRatings).toBeNull();
    const roster = computeRoster(IDS.mlbTeam);
    expect(roster.ok).toBe(true);
  });
});

describe('an export without the batting ratings table', () => {
  it('still serves the draft board', () => {
    hide('players_batting');
    db.prepare(`UPDATE leagues SET show_draft_pool = 1 WHERE league_id = ?`).run(IDS.league);
    expect(() => computeDraft(IDS.mlbTeam)).not.toThrow();
    expect(computeDraft(IDS.mlbTeam).ok).toBe(true);
  });
});
