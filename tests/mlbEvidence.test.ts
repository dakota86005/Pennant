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
