import { describe, expect, it } from 'vitest';
import { detectNeeds, whatIfNeed } from '../server/mlbNeeds';
import { buildResponsePacket, GROUP_LABELS, type ResponseCandidate, type ResponsePacket } from '../server/mlbResponses';
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

  it('Player Development unassessed is visible, incomplete, and never an actionable solution', () => {
    const c = find(run('sp', { assignments: { 500: 'optioned' } }).all, 500);
    expect(c.development).toMatchObject({ status: 'unassessed' });
    expect(c.group).toBe('evaluation_incomplete');
    expect(c.why.join(' ')).toMatch(/Not an actionable solution until the evaluation can be completed/);
    expect(GROUP_LABELS.evaluation_incomplete).toMatch(/Evaluation incomplete.*cannot establish defensibility/);
    // rights are fine and he is still not offered as open, however it is asked
    expect(c.path.status).toBe('open');
    expect(c.philosophy).toMatchObject({ status: 'not_applicable', stance: null });
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
    expect(c.group).toBe('evaluation_incomplete');
    expect(c.why).toContain('No visible current tools.');
  });

  it('a level below Triple-A is unassessed by Development, not defensible', () => {
    const { all } = run('sp', { development: {} }, [{ id: 510, position: 1, role: 11, level: 3, forty: true, active: false }]);
    expect(find(all, 510).development).toMatchObject({ status: 'unassessed', message: expect.stringMatching(/Triple-A players only/) });
    expect(find(all, 510).group).toBe('evaluation_incomplete');
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

  it('a non-40-man promotion is two component actions, each owned by Player Rights', () => {
    const c = find(run('sp', { development: { 501: { judgment: 'defensible' } } }).all, 501);
    expect(c.path.steps.map((s) => [s.action, s.status])).toEqual([['addToFortyMan', 'eligible'], ['place on the active roster', 'eligible']]);
    expect(c.path.status).toBe('open');
    expect(c.group).toBe('open');
    expect(c.requiresClearing).toEqual({ active: false, fortyMan: false });
    // no combined right exists to consult
    expect(c.path.steps.some((s) => /addAndPromote|purchase/i.test(s.action))).toBe(false);
  });

  it('a defensible candidate who needs a 40-man spot is otherwise viable and says he requires a clearing move', () => {
    const forty = Array.from({ length: 14 }, (_, i): Spec => ({ id: 800 + i, position: 3, level: 3, forty: true, active: false }));
    const { all } = run('sp', { development: { 501: { judgment: 'defensible' } } }, [...farm, ...forty]);
    const c = find(all, 501);
    expect(c.path.steps[0]).toMatchObject({ action: 'addToFortyMan', status: 'eligible' });
    expect(c.path.steps[0].requirements[0]).toMatchObject({ kind: 'forty_man_spot', status: 'unmet' });
    expect(c.path.status).toBe('open_with_requirements');
    expect(c.group).toBe('open_requires_clearing');
    expect(c.requiresClearing).toEqual({ active: false, fortyMan: true });
    expect(c.why.join(' ')).toMatch(/Otherwise viable, but requires a 40-man clearing move first/);
    // philosophy may still express a preference: he is valid once cleared
    expect(c.philosophy.status).toBe('applied');
  });

  it('an unmet spot never turns an incomplete evaluation or a Rights block into a viable candidate', () => {
    const forty = Array.from({ length: 14 }, (_, i): Spec => ({ id: 800 + i, position: 3, level: 3, forty: true, active: false }));
    const { all } = run('sp', { development: { 501: { judgment: 'indeterminate' } } }, [...farm, ...forty]);
    expect(find(all, 501).group).toBe('evaluation_incomplete');
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
      expect(c.consequences.vacatedRole).toMatchObject({ availableAfter: 4, floor: 5, belowFloor: true });
    }
  });

  it('a reliever whose starter structure is unknown is an honest unknown, not a candidate or an exclusion', () => {
    const { all } = run('sp', { crossRole: (id) => id === 105 ? { supported: 'unknown', evidence: ['Stamina is not visible.'] } : { supported: 'no', evidence: [] } });
    const c = find(all, 105);
    expect(c.group).toBe('evaluation_incomplete');
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

describe('return from the injured list: ways to clear an active spot', () => {
  const specs: Spec[] = [
    ...healthy26(),
    { id: 700, name: 'Mena', position: 1, role: 11, il: true, active: false, forty: true, daysLeft: 8 },
  ];
  const view = viewOf(specs);
  const states = specs.map(mkState);
  const need = detectNeeds(view).find((n) => n.kind === 'il_return_crunch')!;
  const packet = () => buildResponsePacket(need, view, fakePorts({ states }));
  const active = (p: ResponsePacket) => p.clearing!.constraints.find((c) => c.constraint === 'active_roster')!;
  const options = (p: ResponsePacket) => active(p).classes.flatMap((c) => c.options);
  const byClass = (p: ResponsePacket, k: string) => active(p).classes.find((c) => c.class === k)?.options ?? [];

  it('groups the ways to clear a spot by what each transaction costs, and ranks no player', () => {
    const p = packet();
    expect(p.direction).toBe('clear');
    expect(active(p).note).toMatch(/GM's decision/);
    expect(active(p).note).toMatch(/does NOT open a 40-man spot/);
    // a young roster with option years left has only routine ways to clear a spot; nothing is offered as disruptive
    expect(active(p).classes.map((c) => c.class)).toEqual(['routine']);
    // each player appears exactly once, under the one transaction that applies to him
    expect(options(p)).toHaveLength(26);
    expect(new Set(options(p).map((o) => o.playerId)).size).toBe(26);
    expect(options(p).every((o) => o.rosterEffect.activeSpot === 'opens')).toBe(true);
  });

  it('an ordinary option is routine and reversible; designation is a different, disruptive act', () => {
    // two veterans (five-plus years of service) among the rest: the only move for them is a designation
    const aged = healthy26().map((sp) => sp.id === 100 || sp.id === 113 ? { ...sp, mlbYears: 9, used: 2 } : sp);
    const p = buildResponsePacket(need, viewOf([...aged, specs[26]]), fakePorts({ states: [...aged.map(mkState), states[26]] }));
    const routine = byClass(p, 'routine');
    expect(routine.length).toBeGreaterThan(0);
    for (const o of routine) {
      expect(o.transaction).toBe('option');
      expect(o.rights.status).toBe('eligible');
      expect(o.costs.join(' ')).toMatch(/can be recalled/);
      expect(o.rosterEffect.fortyManSpot).toBe('unchanged');
    }
    const dfa = byClass(p, 'disruptive');
    expect(dfa.map((o) => o.playerId).sort()).toEqual([100, 113]);
    for (const o of dfa) {
      expect(o.transaction).toBe('designate_for_assignment');
      expect(o.rosterEffect.fortyManSpot).toBe('opens');
      expect(o.costs.join(' ')).toMatch(/may claim him/);
      expect(o.costs.join(' ')).toMatch(/Why he cannot simply be optioned/);
    }
    // never both for one player: a designation is not offered to someone who can be optioned
    const optionable = new Set(routine.map((o) => o.playerId));
    for (const o of dfa) expect(optionable.has(o.playerId)).toBe(false);
    // a veteran's designation is not presented as equivalent to optioning a depth player
    expect(active(p).classes.map((c) => c.class)).toEqual(['routine', 'disruptive']);
  });

  it('a veteran who may refuse, and one out of options, carry the consequences that make designation costly', () => {
    const p = buildResponsePacket(need, viewOf([
      ...healthy26().map((sp) => sp.id === 100 ? { ...sp, mlbYears: 9, used: 2 } : sp.id === 101 ? { ...sp, mlbYears: 4, used: 3 } : sp),
      specs[26],
    ]), fakePorts({ states: [
      ...healthy26().map((sp) => mkState(sp.id === 100 ? { ...sp, mlbYears: 9, used: 2 } : sp.id === 101 ? { ...sp, mlbYears: 4, used: 3 } : sp)),
      states[26],
    ] }));
    const vet = options(p).find((o) => o.playerId === 100)!;
    expect(vet).toMatchObject({ class: 'disruptive', transaction: 'designate_for_assignment' });
    expect(vet.costs.join(' ')).toMatch(/refuse a minor-league assignment/);
    const oo = options(p).find((o) => o.playerId === 101)!;
    expect(oo.class).toBe('disruptive');
    expect(oo.costs.join(' ')).toMatch(/irrevocable/);
  });

  it('using a final option year is a higher-cost option, and an already-charged year is not', () => {
    const mk = (id: number, used: number, usedThisYear: number) => ({ ...healthy26().find((sp) => sp.id === id)!, used, mlbYears: 1, usedThisYear });
    const specs2 = healthy26().map((sp) => sp.id === 105 ? mk(105, 2, 0) : sp.id === 106 ? mk(106, 2, 1) : sp);
    const st = [...specs2.map((sp) => { const st0 = mkState(sp); if ((sp as { usedThisYear?: number }).usedThisYear !== undefined) st0.options.usedThisYear = { ...st0.options.usedThisYear, value: (sp as { usedThisYear?: number }).usedThisYear as number }; return st0; }), states[26]];
    const p = buildResponsePacket(need, viewOf([...specs2, specs[26]]), fakePorts({ states: st }));
    expect(options(p).find((o) => o.playerId === 105)).toMatchObject({ class: 'higher_cost' });
    expect(options(p).find((o) => o.playerId === 105)!.costs.join(' ')).toMatch(/final option year/);
    expect(options(p).find((o) => o.playerId === 106)).toMatchObject({ class: 'routine' });
    expect(options(p).find((o) => o.playerId === 106)!.costs.join(' ')).toMatch(/already charged/);
  });

  it('counts the returning starter when judging the rotation effect of moving a starter', () => {
    const starter = options(packet()).find((o) => o.playerId === 100)!;
    expect(starter.roleEffect).toMatchObject({ availableAfter: 5, belowFloor: false }); // 5 - 1 + Mena
    const catcher = options(packet()).find((o) => o.role?.kind === 'catcher')!;
    expect(catcher.roleEffect).toMatchObject({ availableAfter: 1, belowFloor: true });
  });

  it('a stale export leaves every way to clear a spot unresolved, and nothing is presented as routine', () => {
    const p = buildResponsePacket(need, view, fakePorts({ states, evidence: { currentState: 'behind', chronology: 'current' } }));
    expect(active(p).classes.map((c) => c.class)).toEqual(['unresolved']);
    expect(options(p).every((o) => o.rights.status === 'indeterminate')).toBe(true);
  });

  it('states what is and is not known about the activation itself', () => {
    const a = packet().clearing!.activation!;
    expect(a.status).toBe('indeterminate');
    expect(a.facts).toMatchObject({ list: '10-day', injuryDaysLeft: 8, healed: false });
    expect(a.requirements.some((r) => r.kind === 'active_roster_spot' && r.status === 'unmet')).toBe(true);
    expect(a.limitation).toMatch(/AI clubs/);
  });
});

describe('the contemplated assignment is described here and judged by Player Development', () => {
  const asked = (need: 'sp' | number, over: Partial<PortOptions> = {}, days?: number | null, ctx?: Parameters<typeof buildResponsePacket>[3]) => {
    const contextsAsked: NonNullable<PortOptions['contextsAsked']> = [];
    const specs = [...healthy26(), ...farm];
    const view = viewOf(specs);
    const n = whatIfNeed(view, typeof need === 'number' ? need : 100, undefined, days ?? null)!;
    const packet = buildResponsePacket(n, view, fakePorts({ states: specs.map(mkState), contextsAsked, ...over }), ctx);
    return { packet, contextsAsked };
  };

  it('a short rotation absence is a spot start; a short bullpen one is a short bullpen assignment', () => {
    expect(asked('sp', {}, 6).packet.assignment).toMatchObject({ context: 'spot_start', basis: 'derived_from_horizon' });
    expect(asked('sp', {}, 6).contextsAsked).toEqual(['spot_start']);
    expect(asked(105, {}, 6).packet.assignment?.context).toBe('short_bullpen');
    expect(asked(113, {}, 6).packet.assignment?.context).toBe('temporary_depth');
  });

  it('an extended absence is temporary depth and a long one a durable role', () => {
    expect(asked('sp', {}, 40).packet.assignment?.context).toBe('temporary_depth');
    expect(asked('sp', {}, 120).packet.assignment?.context).toBe('durable_role');
  });

  it('an unknown duration is neither assumed short nor assumed durable: both contexts are judged', () => {
    const { packet, contextsAsked } = asked(105);
    expect(packet.assignment).toMatchObject({ context: null, evaluated: ['temporary_depth', 'durable_role'], basis: 'duration_unknown' });
    expect(packet.assignment?.explanation).toMatch(/not known, so it is not assumed/);
    expect(contextsAsked).toEqual(['temporary_depth', 'durable_role']);
  });

  it('the GM can choose the context, from the ones that fit the role', () => {
    const a = asked('sp', {}, null, 'spot_start').packet.assignment!;
    expect(a).toMatchObject({ context: 'spot_start', basis: 'gm_selected' });
    expect(a.choices.map((c) => c.context)).toEqual(['spot_start', 'temporary_depth', 'durable_role']);
    // a context that does not fit the role is ignored, not obeyed
    expect(asked('sp', {}, 6, 'bench_role').packet.assignment?.context).toBe('spot_start');
  });

  it('Player Development is asked in that context and its answer is used as given', () => {
    const dev = { 500: { judgment: 'defensible' as const, context: 'spot_start' as const } };
    const { packet } = asked('sp', { development: dev, assignments: { 500: 'optioned' } }, 6);
    const c = find(packet.groups.flatMap((g) => g.candidates), 500);
    expect(c.development).toMatchObject({ status: 'defensible', context: 'spot_start' });
    expect(c.group).toBe('open');
  });

  it('MLB Operations holds no development threshold of its own', () => {
    // the same candidate under two contexts differs only because Player Development said so
    const answers = { durable_role: 'indefensible', spot_start: 'defensible' } as const;
    const ports = (ctx: 'durable_role' | 'spot_start') => ({ development: { 500: { judgment: answers[ctx] } }, assignments: { 500: 'optioned' as const } });
    const durable = find(asked('sp', ports('durable_role'), null).packet.groups.flatMap((g) => g.candidates), 500);
    const spot = find(asked('sp', ports('spot_start'), 6).packet.groups.flatMap((g) => g.candidates), 500);
    expect(durable.group).toBe('blocked_by_development');
    expect(spot.group).toBe('open');
  });
});
