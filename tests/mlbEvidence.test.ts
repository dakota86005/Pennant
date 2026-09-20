import { describe, expect, it } from 'vitest';
import { crossRoleSupport, farmConsequence, performanceLine, topAffiliateTeamId } from '../server/mlbEvidence';
import { computeMinorLeagueRosterHealth } from '../server/minorLeagueRoster';
import { IDS } from './fixture';

/*
 * The database-facing adapters against the synthetic fixture league. They must
 * be schema-tolerant (the fixture lacks fatigue columns) and read-only.
 */

const catcher = { kind: 'catcher' as const, label: 'catcher', position: 2 };
const starter = { kind: 'starting_pitcher' as const, label: 'starting pitcher', position: 1 };

describe('MLB Operations evidence adapters', () => {
  it('finds the organization\'s highest affiliate as the option destination', () => {
    expect(topAffiliateTeamId(IDS.mlbTeam)).toBe(IDS.aaaTeam);
  });

  it('computes an affiliate scenario without changing the imported roster', () => {
    const before = computeMinorLeagueRosterHealth(IDS.mlbTeam)[0];
    const left = farmConsequence(IDS.mlbTeam, IDS.optioned, starter, 'leaves', IDS.aaaTeam);
    expect(left).toMatchObject({ direction: 'leaves', affiliate: { teamId: IDS.aaaTeam } });
    expect(left?.changes.some((c) => c.label === 'Active roster')).toBe(true);
    const joined = farmConsequence(IDS.mlbTeam, IDS.starter, starter, 'joins', IDS.aaaTeam);
    expect(joined?.direction).toBe('joins');
    // read-only: the baseline is unchanged after the scenarios
    expect(computeMinorLeagueRosterHealth(IDS.mlbTeam)[0].roster.total).toBe(before.roster.total);
  });

  it('a removal scenario can only remove, and an unknown affiliate is unknown', () => {
    const all = computeMinorLeagueRosterHealth(IDS.mlbTeam);
    const without = computeMinorLeagueRosterHealth(IDS.mlbTeam, { removePlayerIds: [IDS.optioned], onlyTeamIds: [IDS.aaaTeam] })[0];
    const base = all.find((t) => t.teamId === IDS.aaaTeam)!;
    expect(without.roster.total).toBeLessThanOrEqual(base.roster.total);
    expect(farmConsequence(IDS.mlbTeam, IDS.optioned, starter, 'leaves', null)).toBeNull();
    expect(farmConsequence(IDS.mlbTeam, IDS.optioned, starter, 'leaves', 99999)).toBeNull();
  });

  it('reads a season line as an objective fact and returns null rather than guessing', () => {
    expect(performanceLine(-1, 2, false)).toBeNull();
    expect(performanceLine(IDS.starter, null, true)).toBeNull();
  });

  it('cross-role support from visible evidence: no grade means not a candidate, not an unknown', () => {
    expect(crossRoleSupport(-1, catcher).supported).toBe('no');
    expect(crossRoleSupport(IDS.starter, { kind: 'relief_pitcher', label: 'relief pitcher', position: 1 }).supported).toBe('yes');
  });
});

describe('Player Development contextual assessments against the fixture league', () => {
  it('assesses a Triple-A player for a temporary context, and only Triple-A players', async () => {
    const { mlbAssignmentAssessments } = await import('../server/org');
    const spot = mlbAssignmentAssessments(IDS.mlbTeam, 'spot_start', [IDS.optioned, IDS.starter]);
    // the major-league player is not a Triple-A candidate and is not assessed
    expect([...spot.keys()]).toEqual([IDS.optioned]);
    const a = spot.get(IDS.optioned)!;
    expect(a).toMatchObject({ context: 'spot_start', basis: 'contextual', level: 2 });
    expect(['defensible', 'indefensible', 'indeterminate']).toContain(a.judgment);
    expect(a.contextual?.constraints.map((c) => c.id)).toEqual(['context_scope', 'stakes', 'readiness_for_context']);
  });

  it('a durable role is the existing assessment, unchanged in basis', async () => {
    const { mlbAssignmentAssessments, mlbDiscussionAssessments } = await import('../server/org');
    const durable = mlbAssignmentAssessments(IDS.mlbTeam, 'durable_role', [IDS.optioned]);
    const existing = mlbDiscussionAssessments(IDS.mlbTeam).get(IDS.optioned);
    if (existing) expect(durable.get(IDS.optioned)).toMatchObject({ basis: 'durable_discussion', judgment: existing.judgment });
    else expect(durable.size).toBe(0);
  });

  it('asks nothing of an empty request', async () => {
    const { mlbAssignmentAssessments } = await import('../server/org');
    expect(mlbAssignmentAssessments(IDS.mlbTeam, 'spot_start', []).size).toBe(0);
  });
});
