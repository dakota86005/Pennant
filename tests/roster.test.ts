import { describe, expect, it } from 'vitest';
import request from './request';
import { IDS } from './fixture';

/**
 * players.team_id is not a roster: OOTP parks people on a club without giving
 * them a spot. Reported as complex-league signings appearing among the major
 * leaguers.
 */
describe('roster membership', () => {
  it('lists only players on the club roster list', async () => {
    const { players } = await request(`/api/roster/${IDS.mlbTeam}`);
    const names = players.map((p: { last_name: string }) => p.last_name);
    expect(names).toContain('Ular');
    expect(names).toContain('Up');
    // Parked on the club with no roster spot
    expect(names).not.toContain('Spot');
  });

  it('does not empty the affiliate, whose players are not MLB-active', async () => {
    const { players } = await request(`/api/roster/${IDS.aaaTeam}`);
    // The naive fix — reusing the is_active guard — would return nothing here
    expect(players.length).toBe(3);
    expect(players.map((p: { last_name: string }) => p.last_name).sort()).toEqual([
      'Deal', 'Draftee', 'Tioned',
    ]);
  });

  it('carries the scouts\' own 20-80 view, now and at the ceiling (Player Value phase 6d)', async () => {
    const { players } = await request(`/api/roster/${IDS.mlbTeam}`);
    const reg = players.find((p: { last_name: string }) => p.last_name === 'Ular');
    expect(reg.scouted).toMatchObject({ now: 50, ceiling: 55 });
  });
});

/**
 * OOTP exports its Overall twice: `oa` as printed on the player's page, and `oa_rating` rounded to fives. The roster
 * used to quote the exact one; since Player Value phase 6d it quotes neither. Nothing establishes that OOTP's Overall is
 * the organization's view (D-017), so the column is the scouts' tools. The fixture's injured star is still a deliberate
 * 62 in OOTP's figure: it must not reach the page in any form.
 */
describe('which grade the app quotes', () => {
  it('quotes no OOTP Overall, exact or rounded', async () => {
    const { players } = await request(`/api/roster/${IDS.mlbTeam}`);
    const him = players.find((p: { player_id: number }) => p.player_id === IDS.injured);
    expect(him).not.toHaveProperty('oaRating');
    expect(him.scouted.now).not.toBe(62);
    expect(him.scouted.now).not.toBe(60);
  });
});
