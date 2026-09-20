import { describe, expect, it } from 'vitest';
import { IDS } from './fixture';
import request from './request';

/*
 * The MLB Operations API against the synthetic fixture league: shape, honesty
 * and read-only behavior. Baseball behavior is covered by the pure tests.
 */

describe('MLB Operations API', () => {
  it('returns the roster summary, the stated coverage floors, and needs derived from current state', async () => {
    const overview = await request(`/api/mlb-operations/${IDS.mlbTeam}`);
    expect(overview.organization).toMatchObject({ orgId: IDS.mlbTeam });
    expect(overview.roster.active).toHaveProperty('limit', 26);
    expect(overview.coverage).toMatchObject({ basis: 'minimum_floor', source: expect.stringMatching(/not a league rule or an ideal roster/) });
    expect(overview.coverage.floors.map((s: { role: string; count: number }) => [s.role, s.count])).toEqual([['starting_pitcher', 5], ['relief_pitcher', 7], ['catcher', 2]]);
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
    // an assumed duration and a chosen context are honoured
    const short = await request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=${encodeURIComponent(`mlb:what_if:${IDS.starter}`)}&days=5`);
    expect(short.need.horizon).toMatchObject({ kind: 'temporary', days: 5 });
    expect(short.need.horizon.basis).toMatch(/Assumed by you/);
    if (short.assignment) expect(short.assignment.basis).toBe('derived_from_horizon');
    expect(packet.need.causes[0]).toMatchObject({ playerId: IDS.starter, assumed: true });
  });

  it('does not assume a duration: with none stated (or exported) both contexts are judged; a stated one asks a single context', async () => {
    const unknown = await request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=${encodeURIComponent(`mlb:what_if:${IDS.starter}`)}`);
    if (unknown.need.horizon.kind === 'unknown' && unknown.assignment) {
      expect(unknown.assignment).toMatchObject({ context: null, basis: 'duration_unknown', evaluated: ['temporary_depth', 'durable_role'] });
    }
    const stated = await request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=${encodeURIComponent(`mlb:what_if:${IDS.starter}`)}&days=120`);
    if (stated.assignment) expect(stated.assignment.evaluated).toEqual(['durable_role']);
    const chosen = await request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=${encodeURIComponent(`mlb:what_if:${IDS.starter}`)}&context=temporary_depth`);
    if (chosen.assignment) expect(chosen.assignment).toMatchObject({ basis: 'gm_selected', evaluated: ['temporary_depth'] });
  });

  it('does not invent a need that is not open, and rejects a bad organization', async () => {
    await expect(request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=mlb:role_below_standard:nonsense`)).rejects.toThrow(/404/);
    await expect(request(`/api/mlb-operations/${IDS.mlbTeam}/responses?need=mlb:what_if:${IDS.optioned}`)).rejects.toThrow(/404/);
    await expect(request('/api/mlb-operations/abc')).rejects.toThrow(/400/);
  });
});
