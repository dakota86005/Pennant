import { describe, expect, it } from 'vitest';
import { farmConsequence } from '../server/mlbEvidence.js';
import { computeFarmSystem, openFarmSession } from '../server/farmOperations.js';
import { farmArrivalFor, farmConsequenceFor } from '../server/farmConsequence.js';
import { IDS } from './fixture.js';
import request from './request.js';

/**
 * MLB Operations asks, Minor League Operations answers.
 *
 * The contract, exercised end to end against the synthetic league. The direction matters as much as
 * the content: the calculation belongs to the farm, MLB Operations only displays it, and an
 * unresolved farm consequence never makes a major-league transaction illegal.
 */

/** A Triple-A player of the fixture organization, whichever one the fixture happens to carry. */
const aTripleAPlayer = async (): Promise<{ playerId: number; name: string } | null> => {
  const farm = (await request(`/api/farm-operations/${IDS.mlbTeam}`)) as {
    assignments: Array<{ playerId: number; name: string; levelName: string }>;
  };
  const him = farm.assignments.find((a) => a.levelName === 'AAA') ?? farm.assignments[0];
  return him ? { playerId: him.playerId, name: him.name } : null;
};

describe('the farm consequence contract', () => {
  it('answers a recall with the job vacated, whether it can be absorbed, and where the chain stops', async () => {
    const him = await aTripleAPlayer();
    if (!him) return; /* a fixture with no minor leaguers has nothing to answer */
    const c = farmConsequenceFor(IDS.mlbTeam, him.playerId);
    expect(c.player?.playerId).toBe(him.playerId);
    expect(c.sourceAffiliate).not.toBeNull();
    expect(c.cascade).not.toBeNull();
    expect(c.cascade!.stop).toBeDefined();
    expect(c.summary.length).toBeGreaterThan(0);
    expect(['established', 'indeterminate', 'cannot_be_established']).toContain(c.confidence);
  });

  it('is reported by MLB Operations from Minor League Operations, not rebuilt', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const viaMlb = farmConsequence(IDS.mlbTeam, him.playerId, null, 'leaves', null);
    /* With no affiliate named there is nothing to report, which is itself the honest answer. */
    expect(viaMlb).toBeNull();
    const affiliate = farmConsequenceFor(IDS.mlbTeam, him.playerId).sourceAffiliate;
    if (!affiliate) return;
    const withAffiliate = farmConsequence(IDS.mlbTeam, him.playerId, null, 'leaves', affiliate.teamId)!;
    expect(withAffiliate.farm).not.toBeNull();
    expect(withAffiliate.farm!.player?.playerId).toBe(him.playerId);
    expect(withAffiliate.farm!.cascade).not.toBeNull();
  });

  it('carries no farm answer for a player joining an affiliate: nothing is vacated', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const affiliate = farmConsequenceFor(IDS.mlbTeam, him.playerId).sourceAffiliate;
    if (!affiliate) return;
    const joining = farmConsequence(IDS.mlbTeam, him.playerId, null, 'joins', affiliate.teamId)!;
    expect(joining.farm).toBeNull();
  });

  it('says plainly that there is no farm consequence for a man who is not on an affiliate', () => {
    const c = farmConsequenceFor(IDS.mlbTeam, -1);
    expect(c.confidence).toBe('cannot_be_established');
    expect(c.summary).toMatch(/not on an affiliate/);
    expect(c.cascade).toBeNull();
  });

  it('reports an unresolved downstream hole without calling the major-league move impossible', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const c = farmConsequenceFor(IDS.mlbTeam, him.playerId);
    /* Whatever the chain finds, an unresolved issue is information and never a legality. */
    for (const issue of c.unresolvedIssues) expect(issue).not.toMatch(/illegal|not allowed|cannot recall/i);
    expect(c.cascade!.gmDecision.join(' ')).toMatch(/Nothing in the chain is a transaction/);
  });

  it('states its own evidence limits, including how an affiliate is measured', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const c = farmConsequenceFor(IDS.mlbTeam, him.playerId);
    expect(c.evidence.join(' ')).toMatch(/rehab assignees excluded/);
  });
});

describe('the farm workspace API', () => {
  it('serves the whole organization, and reports what it could not assess rather than omitting it', async () => {
    const farm = (await request(`/api/farm-operations/${IDS.mlbTeam}`)) as {
      organization: { scope: { players: number; assessed: number; indeterminate: number; notAssessable: number } };
      affiliates: unknown[];
      assignments: unknown[];
      attention: unknown[];
      calibration: Array<{ name: string; status: string }>;
    };
    const { scope } = farm.organization;
    expect(scope.players).toBe(scope.assessed + scope.indeterminate + scope.notAssessable);
    expect(farm.assignments.length).toBe(scope.players);
    expect(Array.isArray(farm.attention)).toBe(true);
    for (const c of farm.calibration) expect(['calibrated', 'provisional', 'policy']).toContain(c.status);
  });

  it('rejects a request for an organization that is not a number', async () => {
    await expect(request('/api/farm-operations/not-a-number')).rejects.toThrow(/400 .*Invalid organization id/);
  });

  it('serves one player\'s farm consequence on its own route', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const c = (await request(`/api/farm-operations/${IDS.mlbTeam}/consequence/${him.playerId}`)) as {
      player: { playerId: number } | null;
      summary: string;
    };
    expect(c.player?.playerId).toBe(him.playerId);
    expect(c.summary.length).toBeGreaterThan(0);
  });
});

describe('one organization, read once', () => {
  it('answers identically with and without a shared session', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const session = openFarmSession(IDS.mlbTeam);
    const alone = farmConsequenceFor(IDS.mlbTeam, him.playerId);
    const first = farmConsequenceFor(IDS.mlbTeam, him.playerId, session);
    const again = farmConsequenceFor(IDS.mlbTeam, him.playerId, session);
    expect(first).toEqual(alone);
    expect(again).toEqual(first);
    expect(computeFarmSystem(IDS.mlbTeam, session).attention).toEqual(computeFarmSystem(IDS.mlbTeam).attention);
  });

  it('describes the affiliate to MLB Operations with the same operational status the farm workspace shows', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const affiliate = farmConsequenceFor(IDS.mlbTeam, him.playerId).sourceAffiliate;
    if (!affiliate) return;
    const viaMlb = farmConsequence(IDS.mlbTeam, him.playerId, null, 'leaves', affiliate.teamId)!;
    const farm = (await request(`/api/farm-operations/${IDS.mlbTeam}`)) as { affiliates: Array<{ teamId: number; operational: { status: string } }> };
    expect(viaMlb.overall.before).toBe(farm.affiliates.find((a) => a.teamId === affiliate.teamId)!.operational.status);
    expect(viaMlb.overall.before).toBe(viaMlb.farm!.affiliateImpact!.statusBefore);
    expect(viaMlb.overall.after).toBe(viaMlb.farm!.affiliateImpact!.statusAfter);
    expect(viaMlb.issuesAfter).toEqual(viaMlb.farm!.affiliateImpact!.findingsAfter);
  });
});

describe('an arrival', () => {
  it('answers a player joining an affiliate with the job he takes up and who already holds it, and never with a cascade', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const affiliate = farmConsequenceFor(IDS.mlbTeam, him.playerId).sourceAffiliate;
    if (!affiliate) return;
    const joining = farmConsequence(IDS.mlbTeam, IDS.starter, { kind: 'position_player', label: 'shortstop', position: 6 } as never, 'joins', affiliate.teamId)!;
    expect(joining.farm).toBeNull();
    expect(joining.arrival).not.toBeNull();
    expect(joining.arrival!.destination?.teamId).toBe(affiliate.teamId);
    expect(joining.arrival!.player?.playerId).toBe(IDS.starter);
    expect(joining.arrival!.summary.length).toBeGreaterThan(0);
    expect(['established', 'indeterminate', 'cannot_be_established']).toContain(joining.arrival!.confidence);
  });

  it('is served on its own route, and says plainly when the destination is not an affiliate', async () => {
    const him = await aTripleAPlayer();
    if (!him) return;
    const affiliate = farmConsequenceFor(IDS.mlbTeam, him.playerId).sourceAffiliate;
    if (!affiliate) return;
    const a = (await request(`/api/farm-operations/${IDS.mlbTeam}/arrival/${IDS.starter}/${affiliate.teamId}`)) as { destination: { teamId: number } | null; summary: string };
    expect(a.destination?.teamId).toBe(affiliate.teamId);
    const elsewhere = farmArrivalFor(IDS.mlbTeam, IDS.starter, 999_999);
    expect(elsewhere.confidence).toBe('cannot_be_established');
    expect(elsewhere.summary).toMatch(/not one of the organization/);
  });
});
