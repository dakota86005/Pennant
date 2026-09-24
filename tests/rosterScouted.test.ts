import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { loadScoutedAbilities } from '../server/scoutedEvidence.js';
import { RosterTable, sortRosterPlayers } from '../src/pages/Roster';
import type { RosterPlayer, RosterResponse } from '../src/api';
import request from './request';
import { IDS } from './fixture';
import { visibleText } from './visibleText';

/*
 * Player Value phase 6d: the Roster's scouting column (BEHAVIOR_CASES.md "Player Value", phase 6d row; PLAYER_VALUE.md
 * Part 8, consumer 6). OOTP's Overall and Potential live in `players_value`, and nothing in the export establishes that they
 * are the organization's view (D-017): the column is the scouts' own tools, averaged now and at their ceiling on the 20–80
 * scale, through the evidence adapter, exactly the card header's "Scouted" figure. A missing grade leaves it "not scouted",
 * never OOTP's figure in its place (D-018), and it sorts after every scouted player whichever way the column is ordered.
 */

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let roster: RosterResponse;

/** OOTP's value fields, planted high so a leak into the payload is unmistakable. */
function plantValues(seed: number): void {
  db.prepare(`UPDATE players_value SET overall_value = ?, talent_value = ?, oa = ?, pot = ?, oa_rating = ?, pot_rating = ?`)
    .run(4000 + seed, 4100 + seed, 77 + (seed % 3), 79 + (seed % 2), 75, 80);
  // No module caches OOTP's figures (phase 6e deleted the last reader), so a reader of them would see the new ones at once
}

beforeAll(async () => {
  // One hitter's eye has not been graded: his average now is unknown, his ceiling still known
  db.prepare(`UPDATE players_batting SET batting_ratings_overall_eye = 0 WHERE player_id = ?`).run(IDS.boundary);
  roster = await request(`/api/roster/${IDS.mlbTeam}`);
});

describe('the Roster shows the organization\'s scouted view, never OOTP\'s Overall or Potential (phase 6d)', () => {
  it('sends no players_value figure on any row, and the rows do not move when OOTP\'s figures do', async () => {
    for (const p of roster.players as Any[]) {
      expect(p).not.toHaveProperty('oaRating');
      expect(p).not.toHaveProperty('potRating');
      expect(JSON.stringify(p)).not.toMatch(/overall_value|talent_value|oaRating|potRating|"oa"|"pot"/);
    }
    plantValues(1);
    const first = await request(`/api/roster/${IDS.mlbTeam}`);
    plantValues(2);
    const second = await request(`/api/roster/${IDS.mlbTeam}`);
    expect(second).toEqual(first);
  });

  it('carries each player\'s scouted tools averaged now and at their ceiling, exactly as the evidence adapter reads them', () => {
    const scouted = (roster.players as Any[]).filter((p) => p.scouted);
    expect(scouted.length).toBe(roster.players.length);
    const abilities = loadScoutedAbilities(roster.players.map((p) => p.player_id));
    for (const p of roster.players as Any[]) {
      const a = abilities.for(p.player_id);
      expect(p.scouted.now, `${p.last_name}`).toBe(a.current);
      expect(p.scouted.ceiling, `${p.last_name}`).toBe(a.potential);
      for (const v of [p.scouted.now, p.scouted.ceiling]) {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(20);
          expect(v).toBeLessThanOrEqual(80);
        }
      }
    }
  });

  it('leaves a player whose tool was not graded "not scouted", never OOTP\'s figure in its place', () => {
    const p = (roster.players as Any[]).find((x) => x.player_id === IDS.boundary);
    expect(p.scouted.now).toBeNull();
    expect(p.scouted.missing.now).toContain('eye');
    expect(p.scouted.ceiling).not.toBeNull();
    const text = visibleText(renderToStaticMarkup(createElement(RosterTable, { roster, group: 'batting', columns: [] })));
    expect(text).toMatch(/not scouted → \d+/);
  });

  it('sorts a player who is not scouted after every scouted one, whichever way the column is ordered', () => {
    const hitters = (roster.players as RosterPlayer[]).filter((p) => p.position !== 1);
    for (const dir of [1, -1] as const) {
      const sorted = sortRosterPlayers(hitters, 'scouted', dir, 'batting');
      expect(sorted[sorted.length - 1].player_id, `dir ${dir}`).toBe(IDS.boundary);
      const known = sorted.filter((p) => p.scouted?.now != null).map((p) => p.scouted!.now as number);
      expect(known, `dir ${dir}`).toEqual([...known].sort((a, b) => dir * (a - b)));
    }
  });

  it('names the column plainly, with no Overall, Potential or players_value word on the page', () => {
    const text = visibleText(renderToStaticMarkup(createElement(RosterTable, { roster, group: 'batting', columns: [] })));
    expect(text).toMatch(/\bScouted\b/);
    expect(text).toMatch(/\b50 → 55\b/);
    expect(text).not.toMatch(/\bOA\b|\bPOT\b|Overall|Potential|players_value|OA→POT/);
  });
});
