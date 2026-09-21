import { describe, expect, it } from 'vitest';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { positionConflict, readOpportunity } from '../server/playingTime.js';
import { reviewAssignment } from '../server/farmAssignments.js';
import { buildOrganizationView, type OrgPlayerFact } from '../server/farmOrganization.js';
import { currentInput, tierOf, production, usage, alternative } from './farmGolden.js';

/**
 * Metamorphic relations: what must stay true when one thing changes.
 *
 * The MLB hardening phase found that a concern moved when an unrelated player joined the group
 * (F-3). These pin the farm equivalents: a finding belongs to a man and his job, a better player is
 * never a bigger problem, and unknown is never firmer than known.
 */

/* A hitter whose games follow his innings: five innings is one game, not ninety (that would make him a designated hitter). */
const hitter = (playerId: number, name: string, innings: number, tier: Parameters<typeof tierOf>[0] = 'development_priority') =>
  usage({ playerId, name, inningsByPosition: { SS: innings }, games: Math.min(100, Math.ceil(innings / 9)), tier });

const reviewOf = (conflictClaimants: ReturnType<typeof hitter>[], meId: number) => {
  const conflict = positionConflict(10, 'SS', conflictClaimants, 900);
  const me = conflictClaimants.find((c) => c.playerId === meId)!;
  return reviewAssignment({
    playerId: meId,
    name: me.name,
    age: me.age,
    kind: 'hitter',
    teamId: 10,
    team: 'A Club',
    level: 3,
    levelName: 'AA',
    leagueName: 'A League',
    protection: tierOf(me.tier),
    production: production(),
    current: evaluateCurrentAssignment(currentInput({ tier: me.tier })),
    opportunity: readOpportunity(meId, conflict ? [conflict] : []),
    alternatives: [],
    blockedBy: [],
  });
};

describe('a finding belongs to the man and his job', () => {
  it('does not change when an unrelated player joins the club at another position', () => {
    const base = [hitter(1, 'Regular', 700), hitter(2, 'Me', 5), hitter(3, 'Third', 60)];
    const before = reviewOf(base, 2);
    const after = reviewOf([...base, usage({ playerId: 4, name: 'A Catcher', inningsByPosition: { C: 800 } })], 2);
    expect(after.conclusion).toBe(before.conclusion);
    expect(after.opportunity.verdict).toBe(before.opportunity.verdict);
  });

  it('does not change when the claimants are listed in a different order', () => {
    const base = [hitter(1, 'Regular', 700), hitter(2, 'Me', 5), hitter(3, 'Third', 60)];
    const forward = reviewOf(base, 2);
    const backward = reviewOf([...base].reverse(), 2);
    expect(backward.conclusion).toBe(forward.conclusion);
    expect(backward.opportunity.ahead.map((a) => a.name).sort()).toEqual(forward.opportunity.ahead.map((a) => a.name).sort());
  });

  it('gets worse, never better, when another man takes some of his innings', () => {
    const sharing = reviewOf([hitter(1, 'Regular', 500), hitter(2, 'Me', 400)], 2);
    const squeezed = reviewOf([hitter(1, 'Regular', 800), hitter(2, 'Me', 20), hitter(3, 'Third', 80)], 2);
    expect(sharing.attention).toBe('routine');
    expect(squeezed.attention).not.toBe('routine');
  });
});

describe('a better reading is never a bigger problem', () => {
  it('never turns a stronger level standing into a worse verdict', () => {
    const order = ['too_advanced', 'appropriate', 'no_longer_developmental'];
    const verdicts = [5, 20, 50, 80, 95].map((p) => evaluateCurrentAssignment(currentInput({ leaguePercentile: p })).verdict);
    const ranks = verdicts.map((v) => order.indexOf(v));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
  });

  it('never makes a player a development concern for having MORE developmental time', () => {
    const young = evaluateCurrentAssignment(currentInput({ leaguePercentile: 10, ageRelativeToLevel: 4 }));
    const old = evaluateCurrentAssignment(currentInput({ leaguePercentile: 10, ageRelativeToLevel: -4 }));
    expect(young.verdict).toBe('appropriate');
    expect(old.verdict).not.toBe('appropriate');
  });

  it('only ever narrows the developmental window as a player ages', () => {
    const order = ['ample', 'normal', 'closing', 'closed'];
    const windows = [4, 2, 1, 0, -2, -4].map((d) => evaluateCurrentAssignment(currentInput({ ageRelativeToLevel: d })).window);
    const ranks = windows.map((w) => order.indexOf(w));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
  });
});

describe('unknown is never firmer than known', () => {
  it('never reports a stronger standing on a thinner sample', () => {
    const thick = evaluateCurrentAssignment(currentInput({ leaguePercentile: 95, reliability: 0.6 }));
    const thin = evaluateCurrentAssignment(currentInput({ leaguePercentile: 95, reliability: 0.1 }));
    expect(thick.standing).toBe('mastered');
    expect(thin.standing).toBe('indeterminate');
  });

  it('never claims an alternative is open when Player Development cannot judge it', () => {
    const r = reviewAssignment({
      playerId: 1,
      name: 'Him',
      age: 22,
      kind: 'hitter',
      teamId: 10,
      team: 'A Club',
      level: 3,
      levelName: 'AA',
      leagueName: 'A League',
      protection: tierOf('normal'),
      production: production(),
      current: evaluateCurrentAssignment(currentInput()),
      opportunity: readOpportunity(1, []),
      alternatives: [alternative({ judgment: 'indeterminate', preference: 'preferred' })],
      blockedBy: [],
    });
    expect(r.conclusion).toBe('current_assignment_defensible');
    expect(r.reasons.join(' ')).toMatch(/neither open nor ruled out/);
  });

  it('never attaches a philosophy preference to an assignment that is not defensible', () => {
    for (const judgment of ['indefensible', 'indeterminate'] as const) {
      const r = reviewAssignment({
        playerId: 1,
        name: 'Him',
        age: 22,
        kind: 'hitter',
        teamId: 10,
        team: 'A Club',
        level: 3,
        levelName: 'AA',
        leagueName: 'A League',
        protection: tierOf('normal'),
        production: production({ percentile: 95 }),
        current: evaluateCurrentAssignment(currentInput({ leaguePercentile: 95 })),
        opportunity: readOpportunity(1, []),
        alternatives: [alternative({ judgment, preference: null })],
        blockedBy: [],
      });
      expect(r.alternatives[0].preference).toBeNull();
      const line = r.ownership.find((o) => o.owner === 'Organizational Philosophy')!;
      expect(line.answer).toMatch(/only to a defensible assignment/);
    }
  });
});

describe('the organization view', () => {
  const player = (overrides: Partial<OrgPlayerFact>): OrgPlayerFact => ({
    playerId: 1,
    name: 'A Player',
    age: 21,
    teamId: 10,
    team: 'A Club',
    level: 3,
    levelName: 'AA',
    kind: 'hitter',
    primaryJob: 'SS',
    coverage: ['SS'],
    developmentalStarter: null,
    tier: 'development_priority',
    conclusion: 'current_assignment_defensible',
    clubGames: 100,
    rehab: false,
    ...overrides,
  });

  const build = (players: OrgPlayerFact[], majorLeagueThinAt: string[] = []) => {
    let seq = 0;
    return buildOrganizationView({
      players,
      affiliates: [
        { teamId: 10, team: 'A Club', level: 3, levelName: 'AA' },
        { teamId: 11, team: 'B Club', level: 4, levelName: 'A' },
      ],
      majorLeagueThinAt,
      rotationSpots: 5,
      nextFindingId: () => `f${++seq}`,
    });
  };

  it('counts congestion on the path a man is on, not on every position he could stand at', () => {
    const versatile = [1, 2].map((id) =>
      player({ playerId: id, name: `Outfielder ${id}`, primaryJob: 'CF', coverage: ['LF', 'CF', 'RF'] })
    );
    const congested = build(versatile).findings.filter((f) => f.code === 'position_congested');
    // One finding, at centre field, not three
    expect(congested).toHaveLength(1);
    expect(congested[0].headline).toMatch(/at CF/);
  });

  it('counts depth on what a man can play, because that is who the club could reach for', () => {
    const v = build([player({ primaryJob: 'CF', coverage: ['LF', 'CF', 'RF'] })]);
    const cf = v.distribution.find((d) => d.position === 'CF')!;
    const lf = v.distribution.find((d) => d.position === 'LF')!;
    expect(cf.upperMinors).toBe(1);
    expect(lf.upperMinors).toBe(1);
  });

  it('reads no shape at all off a club that has not played', () => {
    const early = [1, 2, 3].map((id) => player({ playerId: id, name: `Man ${id}`, clubGames: 4 }));
    expect(build(early).findings.filter((f) => f.code === 'position_congested')).toEqual([]);
  });

  it('never counts a rehab assignee as organizational depth', () => {
    const v = build([player({ rehab: true, primaryJob: 'SS', coverage: ['SS'] })]);
    expect(v.distribution.find((d) => d.position === 'SS')!.upperMinors).toBe(0);
    expect(v.scope.rehab).toBe(1);
  });

  it('raises a thin position louder when the major-league club is thin there too', () => {
    const quiet = build([]).findings.find((f) => f.headline.includes('SS'))!;
    const loud = build([], ['SS']).findings.find((f) => f.headline.includes('SS'))!;
    expect(quiet.severity).toBe('attention');
    expect(loud.severity).toBe('critical');
    expect(loud.evidence.map((e) => e.label)).toContain('Major-league club');
  });
});
