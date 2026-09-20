import { describe, expect, it } from 'vitest';
import { detectNeeds, whatIfNeed } from '../server/mlbNeeds';
import { buildResponsePacket, type ResponseCandidate, type ResponsePacket } from '../server/mlbResponses';
import { fakePorts, healthy26, mkState, viewOf, type PortOptions, type Spec } from './mlbFixtures';

/** The club plus a farm: AAA arms and hitters. */
const farm: Spec[] = [
  { id: 500, name: 'Reno40 SP', position: 1, role: 11, level: 2, forty: true, active: false },
  { id: 501, name: 'Reno Non40 SP', position: 1, role: 11, level: 2, forty: false, active: false },
  { id: 502, name: 'Reno Hurt SP', position: 1, role: 11, level: 2, forty: true, active: false, il: true, daysLeft: 30 },
  { id: 503, name: 'Reno RP', position: 1, role: 12, level: 2, forty: true, active: false },
  { id: 504, name: 'Reno C', position: 2, level: 2, forty: true, active: false },
  { id: 505, name: 'Reno Hitter', position: 7, level: 2, forty: true, active: false },
  { id: 506, name: 'Reno Low SP', position: 1, role: 11, level: 3, forty: false, active: false },
];

function run(need: 'sp' | number, opts: Partial<PortOptions> = {}, extra: Spec[] = farm): { packet: ResponsePacket; all: ResponseCandidate[] } {
  const specs = [...healthy26(), ...extra];
  const view = viewOf(specs);
  const states = specs.map(mkState);
  const n = whatIfNeed(view, typeof need === 'number' ? need : 100)!;
  const packet = buildResponsePacket(n, view, fakePorts({ states, ...opts }));
  return { packet, all: packet.groups.flatMap((g) => g.candidates) };
}
const find = (all: ResponseCandidate[], id: number) => all.find((c) => c.playerId === id)!;

describe('stages stay separate and nothing silently disappears', () => {
  it('finds internal candidates by path kind and counts the players it did not consider', () => {
    const { packet, all } = run('sp');
    expect(find(all, 500).pathKind).toBe('recall');
    expect(find(all, 501).pathKind).toBe('add_to_forty_man');
    expect(find(all, 503)?.pathKind).not.toBe('recall'); // a reliever is not a direct starter match
    expect(all.some((c) => c.playerId === 505)).toBe(false); // a hitter never fills a pitching role
    expect(packet.notConsidered).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringMatching(/below Triple-A/), count: 1 }),
    ]));
    expect(packet.semantics).toEqual({ ranking: 'none', ordering: 'stable_by_path_level_name', decision: 'gm' });
  });

  it('an injured candidate is listed as unavailable, with why', () => {
    const c = find(run('sp').all, 502);
    expect(c.group).toBe('unavailable');
    expect(c.why.join(' ')).toMatch(/IL/);
  });

  it('Player Development unassessed is not a pass and not a rejection', () => {
    const c = find(run('sp').all, 500);
    expect(c.development).toMatchObject({ status: 'unassessed' });
    expect(c.group).not.toBe('open');
    expect(c.group).not.toBe('blocked_by_development');
  });

  it('a defensible, rights-eligible recall is open; an indefensible one is blocked by Development, still shown', () => {
    const ok = find(run('sp', { assignments: { 500: 'optioned' }, development: { 500: { judgment: 'defensible' } } }).all, 500);
    expect(ok).toMatchObject({ group: 'open', development: { status: 'defensible' } });
    const blocked = find(run('sp', { development: { 500: { judgment: 'indefensible', blockers: ['Readiness 40 is below 76.'] } } }).all, 500);
    expect(blocked.group).toBe('blocked_by_development');
    expect(blocked.why).toContain('Readiness 40 is below 76.');
  });

  it('Player Development indeterminate carries its missing evidence and is not a rejection', () => {
    const c = find(run('sp', {
      development: { 500: { judgment: 'indeterminate', missingEvidence: [{ dimension: 'current_ability', detail: 'No visible current tools.' }] } },
    }).all, 500);
    expect(c.group).toBe('indeterminate');
    expect(c.why).toContain('No visible current tools.');
  });

  it('a level below Triple-A is unassessed by Development, not defensible', () => {
    const { all } = run('sp', { development: {} }, [{ id: 510, position: 1, role: 11, level: 3, forty: true, active: false }]);
    expect(find(all, 510).development).toMatchObject({ status: 'unassessed', message: expect.stringMatching(/AAA to MLB only/) });
  });
});

describe('rights are consumed, never re-derived', () => {
  it('an optioned player with the log current and an explicit option is recallable; the spot the scenario opens is met', () => {
    const c = find(run('sp', { assignments: { 500: 'optioned' }, development: { 500: { judgment: 'defensible' } } }).all, 500);
    expect(c.path.steps[0]).toMatchObject({ action: 'recall', status: 'eligible' });
    expect(c.path.status).toBe('open');
    expect(c.path.requirementsUnmet).toEqual([]);
    expect(c.group).toBe('open');
  });

  it('with the log unavailable the recall is indeterminate and the path and group say so', () => {
    const c = find(run('sp', {
      evidence: { currentState: 'current', chronology: 'unavailable' }, development: { 500: { judgment: 'defensible' } },
    }).all, 500);
    expect(c.path.steps[0].status).toBe('indeterminate');
    expect(c.path.status).toBe('indeterminate');
    expect(c.group).toBe('indeterminate');
    expect(c.path.unknowns.length).toBeGreaterThan(0);
  });

  it('a stale export makes every path indeterminate', () => {
    const { all } = run('sp', { evidence: { currentState: 'behind', chronology: 'current' }, assignments: { 500: 'optioned' } });
    for (const c of all.filter((x) => x.pathKind !== 'role_change')) expect(c.path.status).toBe('indeterminate');
  });

  it('a rehab assignment is not treated as an optioned player', () => {
    const c = find(run('sp', { assignments: { 500: 'rehab_assignment' }, development: { 500: { judgment: 'defensible' } } }).all, 500);
    expect(c.path.steps[0].status).not.toBe('eligible');
  });

  it('adding a player to the 40-man is evaluated by Rights, and the unmodeled promotion step keeps the path indeterminate', () => {
    const c = find(run('sp', { development: { 501: { judgment: 'defensible' } } }).all, 501);
    expect(c.path.steps.map((s) => s.action)).toEqual(['addToFortyMan', 'promote to the active roster']);
    expect(c.path.steps[0].status).toBe('eligible');
    expect(c.path.steps[1].status).toBe('not_evaluated');
    expect(c.path.status).toBe('indeterminate');
  });

  it('for an observed full roster the active-spot requirement stays unmet; only a what-if assumes the spot', () => {
    // Observed: a real vacancy means a spot really is open. Build a full roster that still has a shortfall.
    const specs = [...healthy26().filter((s) => s.id !== 100), { id: 900, position: 3 }, ...farm.slice(0, 1)];
    const view = viewOf(specs);
    const states = specs.map(mkState);
    const need = detectNeeds(view).find((n) => n.role?.kind === 'starting_pitcher')!;
    const packet = buildResponsePacket(need, view, fakePorts({ states, assignments: { 500: 'optioned' }, development: { 500: { judgment: 'defensible' } } }));
    const c = find(packet.groups.flatMap((g) => g.candidates), 500);
    expect(c.path.status).toBe('open_with_requirements');
    expect(c.path.requirementsUnmet.join(' ')).toMatch(/full/);
  });
});

describe('internal role changes', () => {
  it('moving the fifth starter to the bullpen only moves the hole', () => {
    const { all } = run(105); // a reliever is out -> open relief spot
    const starters = all.filter((c) => c.pathKind === 'role_change');
    expect(starters.length).toBe(5);
    for (const c of starters) {
      expect(c.group).toBe('creates_shortfall');
      expect(c.consequences.vacatedRole).toMatchObject({ availableAfter: 4, standard: 5, belowStandard: true });
    }
  });

  it('a reliever whose starter structure is unknown is an honest unknown, not a candidate or an exclusion', () => {
    const { all } = run('sp', { crossRole: (id) => id === 105 ? { supported: 'unknown', evidence: ['Stamina is not visible.'] } : { supported: 'no', evidence: [] } });
    const c = find(all, 105);
    expect(c.group).toBe('indeterminate');
    expect(c.why).toContain('Stamina is not visible.');
  });

  it('a role change that lacks visible support is counted, not listed', () => {
    const { packet, all } = run('sp', { crossRole: () => ({ supported: 'no', evidence: [] }) });
    expect(all.some((c) => c.pathKind === 'role_change')).toBe(false);
    expect(packet.notConsidered.some((n) => /does not support the role/.test(n.reason) && n.count > 0)).toBe(true);
  });

  it('a hitter is never offered for a pitching role and a pitcher never for a fielding role', () => {
    const catcher = run(113); // a catcher out
    expect(catcher.all.some((c) => c.role?.position === 1)).toBe(false);
  });
});

describe('philosophy prefers only among valid alternatives', () => {
  const eager = { promotionAggressiveness: 95 };

  it('marks a defensible, open recall as preferred by an aggressive organization, naming the dimension', () => {
    const c = find(run('sp', { philosophy: eager, assignments: { 500: 'optioned' }, development: { 500: { judgment: 'defensible' } } }).all, 500);
    expect(c.philosophy).toMatchObject({ status: 'applied', stance: 'preferred' });
    expect(c.philosophy.reasons[0]).toMatchObject({ dimension: 'promotionAggressiveness', direction: 'supports' });
  });

  it('and as disfavored by a patient one, without changing validity', () => {
    const c = find(run('sp', { philosophy: { promotionAggressiveness: 5 }, assignments: { 500: 'optioned' }, development: { 500: { judgment: 'defensible' } } }).all, 500);
    expect(c.philosophy.stance).toBe('disfavored');
    expect(c.group).toBe('open');
  });

  it.each([
    ['indefensible', { 500: { judgment: 'indefensible' as const } }],
    ['unassessed', {}],
    ['indeterminate', { 500: { judgment: 'indeterminate' as const } }],
  ])('cannot authorize or resolve a %s candidate however aggressive the organization is', (_label, development) => {
    const c = find(run('sp', { philosophy: eager, assignments: { 500: 'optioned' }, development }).all, 500);
    expect(c.group).not.toBe('open');
    expect(c.philosophy).toMatchObject({ status: 'not_applicable', stance: null });
  });

  it('cannot legalize a transaction Rights blocks', () => {
    // 500 is not on the 40-man in this variant and is unavailable: philosophy stays out
    const { all } = run('sp', { philosophy: eager, development: { 502: { judgment: 'defensible' } } });
    const hurt = find(all, 502);
    expect(hurt.group).toBe('unavailable');
    expect(hurt.philosophy.status).toBe('not_applicable');
  });

  it('never orders groups or candidates: the same packet comes back under opposite philosophies', () => {
    const order = (p: number) => run('sp', { philosophy: { promotionAggressiveness: p }, assignments: { 500: 'optioned' }, development: { 500: { judgment: 'defensible' } } })
      .packet.groups.map((g) => [g.group, g.candidates.map((c) => c.playerId)]);
    expect(order(95)).toEqual(order(5));
  });
});

describe('no-solution and role-less cases', () => {
  it('says so when nothing internal could take the role', () => {
    const { packet } = run('sp', {}, []);
    expect(packet.direction).toBe('fill');
    expect(packet.groups.flatMap((g) => g.candidates).filter((c) => c.pathKind !== 'role_change')).toEqual([]);
  });

  it('an observed open spot names no role, so no players are named until one is chosen', () => {
    const specs = healthy26().slice(0, 25);
    const view = viewOf(specs);
    const need = detectNeeds(view)[0];
    const packet = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState) }));
    expect(packet.direction).toBe('role_needed');
    expect(packet.groups).toEqual([]);
  });
});

describe('return from the injured list: who could make room', () => {
  const specs: Spec[] = [
    ...healthy26(),
    { id: 700, name: 'Mena', position: 1, role: 11, il: true, active: false, forty: true, daysLeft: 8 },
  ];
  const view = viewOf(specs);
  const states = specs.map(mkState);
  const need = detectNeeds(view).find((n) => n.kind === 'il_return_crunch')!;

  it('lists every active player with Rights on optioning him, unranked, and leaves the choice to the GM', () => {
    const packet = buildResponsePacket(need, view, fakePorts({ states }));
    expect(packet.direction).toBe('clear');
    expect(packet.clearing?.options).toHaveLength(26);
    expect(packet.clearing?.note).toMatch(/GM's decision/);
    expect(packet.clearing?.activation?.status).toBe('indeterminate'); // the IL rule is not established
    expect(packet.clearing?.options.every((o) => ['eligible', 'ineligible', 'indeterminate'].includes(o.option.status))).toBe(true);
  });

  it('counts the returning starter when judging the rotation effect of sending a starter down', () => {
    const packet = buildResponsePacket(need, view, fakePorts({ states }));
    const starter = packet.clearing!.options.find((o) => o.playerId === 100)!;
    expect(starter.roleEffect).toMatchObject({ availableAfter: 5, belowStandard: false }); // 5 - 1 + Mena
    const catcher = packet.clearing!.options.find((o) => o.role?.kind === 'catcher')!;
    expect(catcher.roleEffect).toMatchObject({ availableAfter: 1, belowStandard: true });
  });

  it('a stale export makes every option indeterminate', () => {
    const packet = buildResponsePacket(need, view, fakePorts({ states, evidence: { currentState: 'behind', chronology: 'current' } }));
    expect(packet.clearing!.options.every((o) => o.option.status === 'indeterminate')).toBe(true);
  });
});
