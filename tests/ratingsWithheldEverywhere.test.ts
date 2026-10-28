import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearFieldingPopulationCache, loadScoutedAbilities, ratingFrom, ratingsWithheld, scoutedRatingRow } from '../server/scoutedEvidence.js';
import { computeRoster } from '../server/roster.js';
import { computePitchingStaff } from '../server/pitching.js';
import { computeDraft } from '../server/rosterops.js';
import { tradeContext } from '../server/trade.js';
import { takeSnapshot } from '../server/history.js';
import { IDS } from './fixture';
import { setExportRatingMode } from './ratingModeFixture';
import request from './request';

/*
 * "Show no player ratings" (D-061: "'No ratings' leaves every rating unknown"; the owner's decision of 2026-10-28: every
 * grade withheld and read as unknown, never a 50). The evidence's own loaders honoured it, but the doors the card, the
 * roster grid, the pitching staff, the draft board and the trade desk read through did not: they handed on the main
 * tables, whatever OOTP writes there in that mode (deep hunt SRVDEV-01 and SRVSTATS-01, B-66). Every page here goes
 * through its production path.
 */

const HITTER = IDS.optioned;
const DRAFTEE = 8_850;

beforeAll(() => {
  db.prepare(`UPDATE leagues SET show_draft_pool = 1 WHERE league_id = ?`).run(IDS.league);
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id,
                          organization_id, retired, hidden, draft_eligible, college, picked_in_draft, draft_league_id)
     VALUES (?, 'Withheld', 'Draftee', 19, 6, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, ?)`
  ).run(DRAFTEE, IDS.league);
  db.prepare(`INSERT INTO players_batting VALUES (?, 45, 45, 45, 45, 45, 45, 60, 60, 60, 60, 60)`).run(DRAFTEE);
  setExportRatingMode('none');
  clearFieldingPopulationCache();
});

afterAll(() => {
  setExportRatingMode(null);
  clearFieldingPopulationCache();
  db.prepare('DELETE FROM players WHERE player_id = ?').run(DRAFTEE);
  db.prepare('DELETE FROM players_batting WHERE player_id = ?').run(DRAFTEE);
});

describe('"Show no player ratings" withholds every grade, on every page', () => {
  it('the evidence itself is withheld (control)', () => {
    expect(ratingsWithheld()).toBe(true);
    expect(loadScoutedAbilities([HITTER]).for(HITTER).status).toBe('unknown');
  });

  it('the adapter hands no ratings source on, and a raw row carries no grade', () => {
    expect(ratingFrom('batting')).toBeNull();
    expect(ratingFrom('pitching')).toBeNull();
    expect(ratingFrom('fielding')).toBeNull();
    const row = scoutedRatingRow('batting', HITTER);
    expect(row).toBeDefined();
    expect(row!.batting_ratings_overall_contact ?? null).toBeNull();
    // ...while what isn't a rating stays as exported
    expect(row!.player_id).toBe(HITTER);
  });

  it('the player card shows no grade: every tool unknown, no positions, no pitches', async () => {
    const card = await request(`/api/player/${HITTER}`);
    expect(card.scouted.status).toBe('unknown');
    for (const [now, ceiling] of Object.values(card.battingRatings ?? {}) as Array<[unknown, unknown]>) {
      expect(now).toBeNull();
      expect(ceiling).toBeNull();
    }
    expect(card.positionRatings).toEqual([]);
    expect(card.pitches).toEqual([]);
    expect(card.velocity).toBeNull();
    for (const v of Object.values(card.fieldingRatings ?? {})) expect(v).toBeNull();
  });

  it('the roster grid shows no grade and offers no grade column', () => {
    const roster = computeRoster(IDS.aaaTeam);
    if (!roster.ok) throw new Error(roster.error);
    expect(roster.body.players.length).toBeGreaterThan(0);
    const graded = roster.body.players.filter((p) => Object.values(p.ratings).some((v) => typeof v === 'number'));
    expect(graded.map((p) => p.player_id)).toEqual([]);
    expect(roster.body.ratingKeys).toEqual([]);
  });

  it('the pitching staff shows no stamina, stuff, control, movement or velocity', () => {
    const staff = computePitchingStaff(IDS.mlbTeam);
    if (!staff.ok) throw new Error(staff.error);
    const arms = [...staff.body.rotation, ...staff.body.bullpen] as Array<Record<string, unknown>>;
    expect(arms.length).toBeGreaterThan(0);
    const graded = arms.filter((a) => ['stamina', 'stuff', 'control', 'movement', 'velocity'].some((k) => a[k] !== null && a[k] !== undefined));
    expect(graded.map((a) => a.id)).toEqual([]);
  });

  it('the draft board ranks nobody on a grade it was never given', () => {
    const board = computeDraft(IDS.mlbTeam);
    if (!board.ok) throw new Error(board.error);
    const prospects = board.body.prospects as Array<{ player_id: number; cur: number | null; pot: number | null }>;
    expect(prospects.filter((p) => p.cur !== null || p.pot !== null)).toEqual([]);
    expect((board.body.excluded as { unrated: number }).unrated).toBeGreaterThanOrEqual(1);
  });

  it('the trade desk is handed no fielding grade', () => {
    const ctx = tradeContext(IDS.mlbTeam, [HITTER], []);
    expect((ctx.weGive[0] as { fielding: string | null }).fielding).toBeNull();
  });

  it('no rating snapshot is taken', () => {
    expect(takeSnapshot()).toBeNull();
  });
});
