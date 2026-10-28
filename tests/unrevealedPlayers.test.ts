import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { forgetSearchIndex, searchIndex } from '../server/search.js';
import { computePlayerDossier } from '../server/player.js';
import { computePlayers } from '../server/league.js';
import { IDS } from './fixture';

/*
 * Players OOTP hasn't revealed (the owner's decision, 2026-10-28: they can't be searched or opened; B-66, deep hunt
 * SRVSTATS-11). Quick Open indexed every player not retired and the player window opened anyone, so a draft class the
 * league hadn't published yet, and a player OOTP hides, were listed and opened with our scouts' grades: the scouting
 * report the draft board deliberately withholds ("listing them here invented a scouting report out of thin air").
 */

const HIDDEN = 8_870;
const AMATEUR = 8_871;
const PRO = 8_872;

const indexed = (): Set<number> => new Set(searchIndex(`unrevealed-${Math.random()}`).entries.filter((e) => e.kind === 'player').map((e) => (e as { playerId: number }).playerId));

beforeAll(() => {
  const add = db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id,
                          organization_id, retired, hidden, draft_eligible, college, picked_in_draft, draft_league_id)
     VALUES (?, 'Unrevealed', ?, ?, 6, 0, 1, 1, 0, ?, ?, 0, ?, ?, 0, 0, ?)`
  );
  add.run(HIDDEN, 'Hidden', 24, IDS.mlbTeam, IDS.mlbTeam, 1, 0, 0);
  add.run(AMATEUR, 'Amateur', 18, 0, 0, 0, 1, IDS.league);
  add.run(PRO, 'Professional', 24, IDS.mlbTeam, IDS.mlbTeam, 0, 0, 0);
  db.prepare(`INSERT INTO players_batting VALUES (?, 45, 45, 45, 45, 45, 45, 60, 60, 60, 60, 60)`).run(AMATEUR);
});

beforeEach(() => {
  db.prepare(`UPDATE leagues SET show_draft_pool = 0 WHERE league_id = ?`).run(IDS.league);
  forgetSearchIndex();
});

afterAll(() => {
  db.prepare(`DELETE FROM players WHERE player_id IN (?, ?, ?)`).run(HIDDEN, AMATEUR, PRO);
  db.prepare(`DELETE FROM players_batting WHERE player_id = ?`).run(AMATEUR);
  db.prepare(`UPDATE leagues SET show_draft_pool = 0 WHERE league_id = ?`).run(IDS.league);
  forgetSearchIndex();
});

describe('a player OOTP hasn\'t revealed', () => {
  it('is not in Quick Open: neither a hidden player nor an unpublished draft class', () => {
    const ids = indexed();
    expect(ids.has(PRO)).toBe(true); // control
    expect(ids.has(HIDDEN)).toBe(false);
    expect(ids.has(AMATEUR)).toBe(false);
  });

  it('is not opened: the player window refuses him, and says why', () => {
    expect(computePlayerDossier(PRO).ok).toBe(true); // control
    for (const id of [HIDDEN, AMATEUR]) {
      const card = computePlayerDossier(id);
      expect(card.ok).toBe(false);
      if (!card.ok) expect(card.error).toMatch(/hasn't shown this player/);
    }
  });

  it('is not in Player Search', () => {
    const page = computePlayers({ group: 'batting', level: '1', limit: '500', offset: '0', viewer: String(IDS.mlbTeam) });
    if (!page.ok) throw new Error(page.error);
    const ids = (page.body.players as Array<{ id?: number; player_id?: number }>).map((p) => p.player_id ?? p.id);
    expect(ids).not.toContain(HIDDEN);
  });

  it('a draft class is searched and opened once its league publishes the pool', () => {
    db.prepare(`UPDATE leagues SET show_draft_pool = 1, rules_amateur_draft = 1 WHERE league_id = ?`).run(IDS.league);
    expect(indexed().has(AMATEUR)).toBe(true);
    expect(computePlayerDossier(AMATEUR).ok).toBe(true);
    // ...a hidden player still isn't
    expect(indexed().has(HIDDEN)).toBe(false);
  });
});
