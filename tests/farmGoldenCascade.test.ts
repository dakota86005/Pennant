import { describe, expect, it } from 'vitest';
import { planCascade, poolFor, summarizeCascade, type CascadeCandidate, type CascadePorts, type PoolMember, type Vacancy } from '../server/farmCascade.js';
import { CASCADE_MAX_STEPS } from '../server/farmCalibration.js';
import { vacancy } from './farmGolden.js';

/**
 * Cascade semantics: each step defensible on its own, and a stop that is an answer.
 *
 * "The call-up is feasible but leaves an unresolved Double-A rotation vacancy" is the useful output,
 * so most of these cases are about stopping well rather than about finding a chain.
 */

const candidate = (overrides: Partial<CascadeCandidate> = {}): CascadeCandidate => ({
  playerId: 1,
  name: 'A Replacement',
  age: 23,
  fromTeamId: 11,
  fromTeam: 'Lower Club',
  fromLevel: 4,
  fromLevelName: 'A',
  judgment: 'defensible',
  blockers: [],
  missingEvidence: [],
  preference: 'acceptable',
  preferenceBasis: 'Promotion aggressiveness, among the defensible assignments only.',
  destinationOpportunity: { open: true, detail: 'The job is open.' },
  sourceAfter: vacancy({ teamId: 11, team: 'Lower Club', level: 4, levelName: 'A', absorbed: true, after: 5, floor: 5, detail: '5 of the 5 it needs remain.' }),
  ...overrides,
});

const ports = (candidates: CascadeCandidate[], levelsBelow = true): CascadePorts => ({
  candidatesFor: () => candidates,
  hasLevelBelow: () => levelsBelow,
});

const request = (v: Vacancy = vacancy()) => ({
  playerId: 100,
  name: 'The Departing Man',
  fromTeamId: 10,
  fromTeam: 'A Club',
  job: v.job,
  reason: 'He is under consideration for a major-league assignment.',
  vacancy: v,
});

describe('a cascade', () => {
  it('stops at once when the affiliate can cover the vacancy itself', () => {
    const c = planCascade(request(vacancy({ absorbed: true, after: 5, floor: 5 })), ports([candidate()]));
    expect(c.stop).toBe('absorbed');
    expect(c.steps).toHaveLength(0);
    expect(c.unresolved).toEqual([]);
    expect(summarizeCascade(c)).toMatch(/absorbs the loss/);
  });

  it('fills a real vacancy with a defensible replacement and stops when his own club can absorb him', () => {
    const c = planCascade(request(), ports([candidate()]));
    expect(c.stop).toBe('absorbed');
    expect(c.steps).toHaveLength(1);
    expect(c.steps[0].usable).toBe(true);
    expect(c.steps[0].development.judgment).toBe('defensible');
    expect(c.unresolved).toEqual([]);
  });

  it('leaves the vacancy open, and says so, when no move below is defensible', () => {
    const c = planCascade(
      request(),
      ports([candidate({ judgment: 'indefensible', blockers: ['Readiness is below the developmental threshold.'] })])
    );
    expect(c.stop).toBe('no_defensible_move');
    expect(c.unresolved).toHaveLength(1);
    expect(c.steps[0].usable).toBe(false);
    expect(c.stopDetail).toMatch(/found none of them defensible/);
    expect(summarizeCascade(c)).toMatch(/^No defensible move follows/);
    expect(summarizeCascade(c)).not.toMatch(/^0 moves/);
  });

  it('says nobody below is even a candidate when the pool is empty', () => {
    const c = planCascade(request(), ports([]));
    expect(c.stop).toBe('no_defensible_move');
    expect(c.stopDetail).toMatch(/Nobody below/);
  });

  it('is indeterminate from the point where evidence runs out, and does not fall through to a worse but judgeable man', () => {
    const c = planCascade(
      request(),
      ports([
        candidate({ name: 'Cannot Judge', judgment: 'indeterminate', missingEvidence: [{ dimension: 'potential_ability', detail: 'no visible potential grade' }] }),
        candidate({ name: 'Clearly Not', judgment: 'indefensible', blockers: ['Readiness is below the threshold.'] }),
      ])
    );
    expect(c.stop).toBe('indeterminate');
    expect(c.certainty).toBe('indeterminate');
    expect(c.steps[0].candidate?.name).toBe('Cannot Judge');
    expect(c.steps[0].usable).toBe(false);
    expect(c.unresolved).toHaveLength(1);
  });

  it('says so when a chain would only move the same shortage down a level', () => {
    const c = planCascade(
      request(vacancy({ job: { kind: 'rotation' } })),
      ports([
        candidate({
          sourceAfter: vacancy({
            teamId: 11,
            team: 'Lower Club',
            level: 4,
            levelName: 'A',
            job: { kind: 'rotation' },
            absorbed: false,
            after: 4,
            floor: 5,
            detail: '4 of the 5 it needs at a rotation spot remain.',
          }),
        }),
      ])
    );
    expect(c.stop).toBe('relocates_the_same_shortage');
    expect(c.unresolved[0].team).toBe('Lower Club');
    expect(summarizeCascade(c)).toMatch(/left short/);
  });

  it('follows a chain on when the next hole is a different job, and stops when it is absorbed', () => {
    let call = 0;
    const c = planCascade(request(vacancy({ job: { kind: 'rotation' } })), {
      hasLevelBelow: () => true,
      candidatesFor: () => {
        call++;
        return call === 1
          ? [
              candidate({
                name: 'First Move',
                sourceAfter: vacancy({
                  teamId: 11,
                  team: 'Lower Club',
                  level: 4,
                  levelName: 'A',
                  job: { kind: 'position', position: 'SS' },
                  absorbed: false,
                  after: 1,
                  floor: 2,
                  detail: '1 of the 2 it needs at SS remain.',
                }),
              }),
            ]
          : [
              candidate({
                name: 'Second Move',
                fromTeam: 'Lowest Club',
                sourceAfter: vacancy({ teamId: 12, team: 'Lowest Club', absorbed: true, after: 2, floor: 2, detail: '2 of the 2 it needs remain.' }),
              }),
            ];
      },
    });
    expect(c.steps.map((s) => s.candidate?.name)).toEqual(['First Move', 'Second Move']);
    expect(c.stop).toBe('absorbed');
    expect(c.unresolved).toEqual([]);
  });

  it('stops at the bottom of the organization rather than inventing a level below it', () => {
    const c = planCascade(request(), ports([candidate()], false));
    expect(c.stop).toBe('reached_lowest_level');
    expect(c.unresolved).toHaveLength(1);
  });

  it('terminates rather than recursing, however long the chain could be', () => {
    let seq = 0;
    const c = planCascade(request(vacancy({ job: { kind: 'position', position: 'SS' } })), {
      hasLevelBelow: () => true,
      candidatesFor: () => {
        seq++;
        return [
          candidate({
            name: `Move ${seq}`,
            sourceAfter: vacancy({
              teamId: 100 + seq,
              team: `Club ${seq}`,
              /* Always a different job, so the same-shortage stop never fires. */
              job: seq % 2 === 0 ? { kind: 'position', position: 'SS' } : { kind: 'position', position: 'CF' },
              absorbed: false,
              after: 1,
              floor: 2,
              detail: 'short',
            }),
          }),
        ];
      },
    });
    expect(c.steps.length).toBeLessThanOrEqual(CASCADE_MAX_STEPS);
    expect(c.stop).toBe('step_limit');
    expect(c.stopDetail).toMatch(/speculation/);
  });

  it('carries the philosophy preference only on a defensible step, and never as the reason for it', () => {
    const c = planCascade(request(), ports([candidate({ preference: 'preferred' })]));
    expect(c.steps[0].preference).toBe('preferred');
    expect(c.steps[0].preferenceBasis).toMatch(/defensible assignments only/);
    expect(c.gmDecision.join(' ')).toMatch(/philosophy states a preference, not a decision/);
  });

  it('does not attach a preference to a step Player Development cannot judge', () => {
    const c = planCascade(request(), ports([candidate({ judgment: 'indeterminate', preference: 'preferred' })]));
    expect(c.steps[0].preference).toBeNull();
  });

  it('warns when the job the replacement would fill is already contested at the destination', () => {
    const c = planCascade(request(), ports([candidate({ destinationOpportunity: { open: false, detail: 'Already three men there.' } })]));
    expect(c.steps[0].uncertainty.join(' ')).toMatch(/already contested/);
  });

  it('always leaves the decision with the GM and never calls a step a transaction', () => {
    const c = planCascade(request(), ports([candidate()]));
    expect(c.gmDecision[0]).toMatch(/Nothing in the chain is a transaction/);
  });
});

describe('a pool Player Development has not judged', () => {
  /*
   * A man with no qualifying sample at his own level has not been evaluated for a promotion. He has
   * not been rejected (D-018), and the first version said "Player Development found none of them
   * defensible" about fifteen men it had not looked at.
   */
  const unevaluated = (name: string) =>
    candidate({ name, playerId: name.length, judgment: 'not_evaluated', blockers: ['Player Development has not evaluated a promotion for him: he has no qualifying current-level sample.'], preference: null, preferenceBasis: null });

  it('leaves the chain indeterminate, and says that nobody was evaluated rather than that nobody was defensible', () => {
    const c = planCascade(request(), ports([unevaluated('Unseen One'), unevaluated('Unseen Two')]));
    expect(c.stop).toBe('indeterminate');
    expect(c.certainty).toBe('indeterminate');
    expect(c.stopDetail).toMatch(/has not evaluated any of them/);
    expect(c.stopDetail).not.toMatch(/found none of them defensible/);
    expect(c.steps[0].uncertainty.join(' ')).toMatch(/not evaluated a promotion for 2 of the 2 candidates/);
    expect(c.unresolved).toHaveLength(1);
    expect(summarizeCascade(c)).toMatch(/^No move follows that Player Development can judge/);
  });

  it('tells the ruled-out from the unevaluated when the pool holds both', () => {
    const c = planCascade(
      request(),
      ports([candidate({ name: 'Ruled Out', judgment: 'indefensible', blockers: ['Readiness is below the threshold.'], preference: null }), unevaluated('Unseen')])
    );
    expect(c.stop).toBe('indeterminate');
    expect(c.stopDetail).toMatch(/ruled out 1, and has not evaluated 1 of them/);
  });

  it('is closed, not indeterminate, when Player Development judged every candidate and ruled each out', () => {
    const c = planCascade(request(), ports([candidate({ judgment: 'indefensible', blockers: ['Readiness is below the threshold.'], preference: null })]));
    expect(c.stop).toBe('no_defensible_move');
    expect(c.certainty).toBe('established');
  });

  it('still follows a defensible man when one is in the pool beside the unevaluated', () => {
    const c = planCascade(request(), ports([unevaluated('Unseen'), candidate({ name: 'Ready' })]));
    expect(c.steps[0].candidate?.name).toBe('Ready');
    expect(c.certainty).toBe('established');
  });
});

describe('the branch', () => {
  it('lists the other defensible replacements beside the one the chain follows, each with philosophy\'s preference', () => {
    const c = planCascade(
      request(),
      ports([candidate({ name: 'First', playerId: 1, preference: 'acceptable' }), candidate({ name: 'Second', playerId: 2, preference: 'preferred' }), candidate({ name: 'Not Him', playerId: 3, judgment: 'indefensible', preference: null })])
    );
    expect(c.steps[0].candidate?.name).toBe('First');
    expect(c.steps[0].alternatives).toEqual([{ playerId: 2, name: 'Second', age: 23, fromTeam: 'Lower Club', preference: 'preferred' }]);
    expect(c.gmDecision.join(' ')).toMatch(/Which of the defensible replacements to use/);
  });

  it('lists no alternative on a step nobody could take', () => {
    const c = planCascade(request(), ports([candidate({ judgment: 'indeterminate', preference: null }), candidate({ name: 'Also unsure', playerId: 9, judgment: 'indeterminate', preference: null })]));
    expect(c.steps[0].alternatives).toEqual([]);
  });
});

describe('how severe the hole is', () => {
  it('never makes an indefensible step defensible: a club two men short still gets no move Player Development rules out', () => {
    const dire = vacancy({ after: 0, floor: 2, absorbed: false, detail: '0 remain at SS, 2 short of the 2 it needs.', job: { kind: 'position', position: 'SS' } });
    const c = planCascade(request(dire), ports([candidate({ judgment: 'indefensible', blockers: ['Readiness is below the threshold.'], preference: null })]));
    expect(c.stop).toBe('no_defensible_move');
    expect(c.steps[0].usable).toBe(false);
  });
});

describe('who is in the pool at all', () => {
  const member = (overrides: Partial<PoolMember> & { playerId: number }): PoolMember => ({
    kind: 'hitter', primaryJob: 'SS', coverage: ['SS', '2B'], level: 4, rehab: false, ...overrides,
  });
  const below = [
    member({ playerId: 1, kind: 'pitcher', primaryJob: 'the rotation', coverage: [] }),
    member({ playerId: 2, kind: 'pitcher', primaryJob: 'the bullpen', coverage: [] }),
    member({ playerId: 3, kind: 'hitter', primaryJob: 'SS' }),
    member({ playerId: 4, kind: 'hitter', primaryJob: 'LF', coverage: ['LF', 'SS'] }),
    member({ playerId: 5, kind: 'hitter', primaryJob: 'SS', rehab: true }),
    member({ playerId: 6, kind: 'hitter', primaryJob: 'SS', injured: true }),
    member({ playerId: 7, kind: 'hitter', primaryJob: 'SS', level: 6 }),
  ];

  it('fills a rotation hole only with a man taking starts: no hitter and no relief arm can', () => {
    expect(poolFor(vacancy({ level: 3, job: { kind: 'rotation' } }), below, 4).map((m) => m.playerId)).toEqual([1]);
  });

  it('fills a relief hole only with a relief arm', () => {
    expect(poolFor(vacancy({ level: 3, job: { kind: 'relief' } }), below, 4).map((m) => m.playerId)).toEqual([2]);
  });

  it('fills a position with anyone who can play it — cover counts for a replacement — but never a rehab assignee, an injured man, or a man two levels down', () => {
    expect(poolFor(vacancy({ level: 3, job: { kind: 'position', position: 'SS' } }), below, 4).map((m) => m.playerId)).toEqual([3, 4]);
  });
});
