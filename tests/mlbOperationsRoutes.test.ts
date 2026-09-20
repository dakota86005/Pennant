import { describe, expect, it } from 'vitest';
import { IDS } from './fixture';
import request from './request';

/*
 * The MLB Operations API against the synthetic fixture league: shape, honesty
 * and read-only behavior. Baseball behavior is covered by the pure tests.
 */

describe('MLB Operations API', () => {
  it('returns the roster summary, the stated standards, and needs derived from current state', async () => {
    const overview = await request(`/api/mlb-operations/${IDS.mlbTeam}`);
    expect(overview.organization).toMatchObject({ orgId: IDS.mlbTeam });
    expect(overview.roster.active).toHaveProperty('limit', 26);
    expect(overview.standards.map((s: { role: string }) => s.role)).toEqual(['starting_pitcher', 'relief_pitcher', 'catcher']);
    expect(overview.freshness).toHaveProperty('level');
    // the small fixture club is far below the standard: needs exist, each carries evidence and is observed
    expect(overview.needs.length).toBeGreaterThan(0);
    for (const need of overview.needs) {
      expect(need.origin).toBe('observed');
      expect(need.facts.length + need.unknowns.length).toBeGreaterThan(0);
    }
    expect(overview.activePlayers.length).toBeGreaterThan(0);
  });

  it('builds a packet for an observed need with no ranking and the decision left to the GM', async () => {
    const overview = await request(`/api/mlb-operations/${IDS.mlbTeam}`);
    const need = overview.needs.find((n: { role: unknown }) => n.role) ?? overview.needs[0];
    const packet = await request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=${encodeURIComponent(need.id)}`);
    expect(packet.need.id).toBe(need.id);
    expect(packet.semantics).toEqual({ ranking: 'none', ordering: 'stable_by_path_level_name', decision: 'gm' });
    expect(['fill', 'clear', 'role_needed']).toContain(packet.direction);
  });

  it('answers a what-if for an active player as a hypothetical need', async () => {
    const packet = await request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=${encodeURIComponent(`mlb:what_if:${IDS.starter}`)}`);
    expect(packet.need).toMatchObject({ origin: 'hypothetical', id: `mlb:what_if:${IDS.starter}` });
    expect(packet.need.causes[0]).toMatchObject({ playerId: IDS.starter, assumed: true });
  });

  it('does not invent a need that is not open, and rejects a bad organization', async () => {
    await expect(request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=mlb:role_below_standard:nonsense`)).rejects.toThrow(/404/);
    await expect(request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=mlb:what_if:${IDS.optioned}`)).rejects.toThrow(/404/);
    await expect(request('/api/mlb-operations/abc')).rejects.toThrow(/400/);
  });
});
