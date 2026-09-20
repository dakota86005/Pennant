import { describe, expect, it } from 'vitest';
import { detectNeeds, whatIfNeed } from '../server/mlbNeeds';
import {
  buildResponsePacket, type ClearingConstraint, type ClearingOption, type ResponseCandidate, type ResponsePacket,
} from '../server/mlbResponses';
import type { ResponsePorts } from '../server/mlbResponses';
import { fakePorts, healthy26, mkState, viewOf, type PortOptions, type Spec } from './mlbFixtures';

/*
 * Clearing a roster spot. The active-roster spot and the 40-man spot are separate
 * constraints with separate ways to clear them: an option solves only the first;
 * only the 60-day list and a designation solve the second. A path is only as
 * certain as its least certain link, and MLB Operations invents no right.
 */

const FULL_40 = { rules_secondary_roster_limit: 28 };

const farm: Spec[] = [
  { id: 500, name: 'Reno40 SP', position: 1, role: 11, level: 2, forty: true, active: false },
  { id: 501, name: 'Reno Non40 SP', position: 1, role: 11, level: 2, forty: false, active: false },
  { id: 502, name: 'Reno Hurt', position: 1, role: 11, level: 2, forty: true, active: false, il: true, daysLeft: 50 },
];

const constraintOf = (p: ResponsePacket, k: ClearingConstraint) => p.clearing?.constraints.find((c) => c.constraint === k);
const optionsOf = (p: ResponsePacket, k: ClearingConstraint): ClearingOption[] => constraintOf(p, k)?.classes.flatMap((c) => c.options) ?? [];
const cand = (p: ResponsePacket, id: number) => p.groups.flatMap((g) => g.candidates).find((c) => c.playerId === id) as ResponseCandidate;

/** A what-if fill: 40-man full unless the league override says otherwise. */
function fill(over: Partial<PortOptions> = {}, leagueOver: Record<string, number | null> = FULL_40, patchPorts?: (p: ResponsePorts) => ResponsePorts) {
  const specs = [...healthy26(), ...farm];
  const view = viewOf(specs, leagueOver);
  const states = specs.map(mkState);
  const need = whatIfNeed(view, 100)!;
  const base = fakePorts({ states, leagueOver, development: { 500: {}, 501: {} }, assignments: { 500: 'optioned' }, ...over });
  return buildResponsePacket(need, view, patchPorts ? patchPorts(base) : base);
}

describe('a promotion that needs a 40-man spot', () => {
  it('is otherwise viable but requires a 40-man clearing move, with the chain made visible', () => {
    const p = fill();
    const c = cand(p, 501);
    expect(c.group).toBe('open_requires_clearing');
    expect(c.requiresClearing).toEqual({ active: false, fortyMan: true });
    expect(c.why.join(' ')).toMatch(/Otherwise viable, but requires a 40-man clearing move first/);
    expect(c.path.chain.map((l) => [l.kind, l.constraint, l.action])).toEqual([
      ['clear_spot', 'forty_man', 'clear a 40-man spot'],
      ['transaction', null, 'addToFortyMan'],
      ['transaction', null, 'place on the active roster'],
    ]);
    expect(c.path.chain[0].status).toBe('eligible');
    expect(c.path.status).toBe('open_with_requirements');
  });

  it('with a 40-man spot open nothing is cleared and the chain has no clearing link', () => {
    const p = fill({}, { rules_secondary_roster_limit: 40 });
    const c = cand(p, 501);
    expect(c.group).toBe('open');
    expect(p.clearing).toBeNull();
    expect(c.path.chain.every((l) => l.kind === 'transaction')).toBe(true);
  });

  it('offers only what takes a player off the 40-man: a designation is disruptive, and no option is ever offered', () => {
    const p = fill();
    const c40 = constraintOf(p, 'forty_man')!;
    expect(c40).toMatchObject({ state: 'clearing_needed', count: 28, limit: 28, feasibility: 'available' });
    expect(constraintOf(p, 'active_roster')).toBeUndefined();
    const opts = optionsOf(p, 'forty_man');
    expect(opts.some((o) => o.transaction === 'option')).toBe(false);
    expect(c40.classes.map((k) => k.class)).toEqual(['disruptive', 'unresolved']);
    const dfa = opts.filter((o) => o.class === 'disruptive');
    expect(dfa).toHaveLength(26);
    for (const o of dfa) {
      expect(o.transaction).toBe('designate_for_assignment');
      expect(o.rosterEffect).toEqual({ activeSpot: 'opens', fortyManSpot: 'opens' });
      expect(o.costs.join(' ')).toMatch(/may claim him/);
    }
    expect(c40.note).toMatch(/an option never does/);
  });

  it('never presents a designation as routine', () => {
    const p = fill();
    expect(optionsOf(p, 'forty_man').filter((o) => o.transaction === 'designate_for_assignment').every((o) => o.class !== 'routine')).toBe(true);
  });

  it('an injured 40-man player is a 60-day-list candidate whose rights are not established: shown as such, not hidden and not valid', () => {
    const p = fill();
    const hurt = optionsOf(p, 'forty_man').find((o) => o.playerId === 502)!;
    expect(hurt).toMatchObject({ class: 'unresolved', transaction: 'place_on_sixty_day_il' });
    expect(hurt.rights.status).toBe('indeterminate');
    expect(hurt.costs.join(' ')).toMatch(/has not been measured/);
    expect(hurt.rosterEffect).toEqual({ activeSpot: 'unchanged', fortyManSpot: 'opens' });
  });

  it('a minor-league 40-man player opens only the 40-man spot and carries his farm consequence', () => {
    const specs = [...healthy26(), ...farm, { id: 503, name: 'Reno Filler', position: 1, role: 12, level: 2, forty: true, active: false }];
    const limits = { rules_secondary_roster_limit: 29 };
    const view = viewOf(specs, limits);
    const need = whatIfNeed(view, 100)!;
    const p = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState), leagueOver: limits, development: { 501: {} } }));
    const filler = optionsOf(p, 'forty_man').find((o) => o.playerId === 503)!;
    expect(filler.rosterEffect).toEqual({ activeSpot: 'unchanged', fortyManSpot: 'opens' });
    expect(filler.farm).not.toBeNull();
    expect(filler.roleEffect).toBeNull();
  });

  it('every clearing player appears once per constraint: no duplicate alternatives', () => {
    const ids = optionsOf(fill(), 'forty_man').map((o) => o.playerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('when rights for every way to clear are unresolved, the candidate is not offered as viable', () => {
    const p = fill({}, FULL_40, (ports) => ({
      ...ports,
      rights: (ids) => {
        const m = ports.rights(ids);
        for (const [id, pic] of m) {
          if (id < 500) pic.rights = { ...pic.rights, actions: { ...pic.rights.actions, designateForAssignment: { ...pic.rights.actions.designateForAssignment, status: 'indeterminate', label: 'not established', facts: {}, missing: [{ code: 'rule_not_established', message: 'test' }] } } };
        }
        return m;
      },
    }));
    expect(constraintOf(p, 'forty_man')!.feasibility).toBe('unresolved_only');
    const c = cand(p, 501);
    expect(c.group).toBe('indeterminate');
    expect(c.path.status).toBe('indeterminate');
    expect(c.path.chain[0]).toMatchObject({ kind: 'clear_spot', status: 'indeterminate' });
    expect(c.philosophy).toMatchObject({ status: 'not_applicable', stance: null });
  });

  it('when no player can be moved to clear the spot, he is blocked, with why', () => {
    const p = fill({}, FULL_40, (ports) => ({
      ...ports,
      rights: (ids) => {
        const m = ports.rights(ids);
        for (const [id, pic] of m) {
          if (id !== 501) {
            const no = { ...pic.rights.actions.designateForAssignment, status: 'ineligible' as const, label: 'no' };
            pic.rights = { ...pic.rights, actions: { ...pic.rights.actions, designateForAssignment: no, placeOnSixtyDayIl: { ...no, action: 'placeOnSixtyDayIl' as const } } };
          }
        }
        return m;
      },
    }));
    const c = cand(p, 501);
    expect(constraintOf(p, 'forty_man')!.feasibility).toBe('none');
    expect(c.group).toBe('blocked_by_rights');
    expect(c.why.join(' ')).toMatch(/No player can be moved to clear the spot he needs/);
  });

  it('a path is only as certain as its least certain link', () => {
    const p = fill({}, FULL_40, (ports) => ({
      ...ports,
      rights: (ids) => {
        const m = ports.rights(ids);
        const pic = m.get(501);
        if (pic && pic.rights.composed.promoteToActive) {
          pic.rights = { ...pic.rights, composed: { promoteToActive: { ...pic.rights.composed.promoteToActive, status: 'indeterminate', missing: [{ code: 'rule_not_established', message: 'placement unknown' }] } } };
        }
        return m;
      },
    }));
    const c = cand(p, 501);
    expect(c.path.chain.map((l) => l.status)).toEqual(['eligible', 'eligible', 'indeterminate']);
    expect(c.path.status).toBe('indeterminate');
    expect(c.group).toBe('indeterminate');
  });
});

describe('the active-roster spot and the 40-man spot are separate constraints', () => {
  // Active roster full with only four healthy starters; the fifth is on the IL. The 40-man is full too.
  const specs: Spec[] = [
    ...healthy26().map((s) => s.id === 104 ? { ...s, name: 'Extra RP', role: 12 } : s),
    { id: 600, name: 'Hurt SP', position: 1, role: 11, il: true, active: false, forty: true, daysLeft: 30 },
    { id: 500, name: 'Reno40 SP', position: 1, role: 11, level: 2, forty: true, active: false },
    { id: 501, name: 'Reno Non40 SP', position: 1, role: 11, level: 2, forty: false, active: false },
  ];
  const view = viewOf(specs, FULL_40);
  const need = detectNeeds(view).find((n) => n.kind === 'role_below_standard')!;
  const p = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState), leagueOver: FULL_40, development: { 500: {}, 501: {} }, assignments: { 500: 'optioned' } }));

  it('an observed need on a full roster needs both spots, each with its own list', () => {
    expect(need.origin).toBe('observed');
    expect(p.clearing!.constraints.map((c) => [c.constraint, c.state])).toEqual([['forty_man', 'clearing_needed'], ['active_roster', 'clearing_needed']]);
  });

  it('an option solves the active spot only and never appears among the 40-man options', () => {
    const active = optionsOf(p, 'active_roster');
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((o) => o.constraint === 'active_roster')).toBe(true);
    expect(active.filter((o) => o.transaction === 'option').every((o) => o.rosterEffect.fortyManSpot === 'unchanged')).toBe(true);
    const forty = optionsOf(p, 'forty_man');
    expect(forty.every((o) => o.constraint === 'forty_man' && o.transaction !== 'option')).toBe(true);
  });

  it('even a final-option-year option is an active-roster move that leaves the 40-man unchanged', () => {
    const mk = (s: Spec) => s.id === 105 ? { ...s, used: 2, mlbYears: 1 } : s;
    const specs2 = specs.map(mk);
    const view2 = viewOf(specs2, FULL_40);
    const need2 = detectNeeds(view2).find((n) => n.kind === 'role_below_standard')!;
    const p2 = buildResponsePacket(need2, view2, fakePorts({ states: specs2.map(mkState), leagueOver: FULL_40, development: { 501: {} } }));
    const o = optionsOf(p2, 'active_roster').find((x) => x.playerId === 105)!;
    expect(o).toMatchObject({ transaction: 'option', class: 'higher_cost', rosterEffect: { activeSpot: 'opens', fortyManSpot: 'unchanged' } });
    expect(optionsOf(p2, 'forty_man').some((x) => x.playerId === 105 && x.transaction === 'option')).toBe(false);
  });

  it('the non-40-man promotion path is composed: clear 40-man, add, clear active, place', () => {
    const c = cand(p, 501);
    expect(c.requiresClearing).toEqual({ active: true, fortyMan: true });
    expect(c.path.chain.map((l) => `${l.kind}:${l.constraint ?? l.action}`)).toEqual([
      'clear_spot:forty_man', 'transaction:addToFortyMan', 'clear_spot:active_roster', 'transaction:place on the active roster',
    ]);
    expect(c.path.chain.map((l) => l.seq)).toEqual([1, 2, 3, 4]);
    // a recall of a player already on the 40-man needs only the active spot
    expect(cand(p, 500).path.chain.map((l) => `${l.kind}:${l.constraint ?? l.action}`)).toEqual(['clear_spot:active_roster', 'transaction:recall']);
  });
});

describe('a return from the injured list', () => {
  const returning = (over: Partial<Spec>): Spec => ({ id: 700, name: 'Mena', position: 1, role: 11, active: false, daysLeft: 8, ...over });

  it('from the 60-day list onto two full rosters: two constraints, one activation, only as certain as its least certain link', () => {
    const specs: Spec[] = [...healthy26(), returning({ il60: true, forty: false }), farm[0], farm[2]];
    const view = viewOf(specs, FULL_40);
    const need = detectNeeds(view).find((n) => n.kind === 'il_return_crunch')!;
    expect(need.title).toMatch(/the active roster is full \(26 of 26\) and the 40-man is full \(28 of 28\)/);
    const p = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState), leagueOver: FULL_40 }));
    expect(p.clearing!.constraints.map((c) => [c.constraint, c.state])).toEqual([['active_roster', 'clearing_needed'], ['forty_man', 'clearing_needed']]);
    expect(p.clearing!.chain.map((l) => `${l.kind}:${l.constraint ?? l.action}`)).toEqual([
      'clear_spot:active_roster', 'clear_spot:forty_man', 'transaction:activate from the injured list',
    ]);
    expect(p.clearing!.chain.at(-1)!.status).toBe('indeterminate');
    expect(p.clearing!.chainStatus).toBe('indeterminate');
    expect(p.clearing!.activation).toMatchObject({ status: 'indeterminate', facts: { list: '60-day', needsFortyManSpot: true, fortyManClearingNeeded: true, activeClearingNeeded: true } });
    // prerequisite clearing is represented, not collapsed into a rejection of the activation
    expect(p.clearing!.activation!.status).not.toBe('ineligible');
    // the returning player is never offered as a way to clear his own spot
    expect([...optionsOf(p, 'active_roster'), ...optionsOf(p, 'forty_man')].some((o) => o.playerId === 700)).toBe(false);
    expect(optionsOf(p, 'forty_man').some((o) => o.transaction === 'option')).toBe(false);
  });

  it('a 60-day return onto a full 40-man is a need even when the active roster has room', () => {
    const specs: Spec[] = [...healthy26().slice(1), returning({ il60: true, forty: false }), farm[0], farm[2]];
    const view = viewOf(specs, { rules_secondary_roster_limit: 27 });
    expect(view.counts).toMatchObject({ active: 25, fortyMan: 27 });
    const need = detectNeeds(view).find((n) => n.kind === 'il_return_crunch')!;
    expect(need.title).toMatch(/the 40-man is full/);
    expect(need.title).not.toMatch(/active roster is full/);
    const p = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState), leagueOver: { rules_secondary_roster_limit: 27 } }));
    expect(constraintOf(p, 'active_roster')).toMatchObject({ state: 'spot_open', classes: [] });
    expect(constraintOf(p, 'forty_man')).toMatchObject({ state: 'clearing_needed' });
    expect(p.clearing!.chain.map((l) => `${l.kind}:${l.constraint ?? l.action}`)).toEqual(['clear_spot:forty_man', 'transaction:activate from the injured list']);
  });

  it('a 10-day return has no 40-man constraint: he is still on the 40-man', () => {
    const specs: Spec[] = [...healthy26(), returning({ il: true, forty: true }), farm[0], farm[2]];
    const view = viewOf(specs, FULL_40);
    const need = detectNeeds(view).find((n) => n.kind === 'il_return_crunch')!;
    const p = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState), leagueOver: FULL_40 }));
    expect(p.clearing!.constraints.map((c) => c.constraint)).toEqual(['active_roster']);
    expect(p.clearing!.activation!.facts).toMatchObject({ list: '10-day', needsFortyManSpot: false });
  });

  it('with room on both rosters no return decision exists', () => {
    const specs: Spec[] = [...healthy26().slice(1), returning({ il60: true, forty: false })];
    expect(detectNeeds(viewOf(specs)).some((n) => n.kind === 'il_return_crunch')).toBe(false);
  });

  it('unresolved activation rights stay indeterminate on a stale export and every clearing option says so', () => {
    const specs: Spec[] = [...healthy26(), returning({ il60: true, forty: false }), farm[0], farm[2]];
    const view = viewOf(specs, FULL_40);
    const need = detectNeeds(view).find((n) => n.kind === 'il_return_crunch')!;
    const p = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState), leagueOver: FULL_40, evidence: { currentState: 'behind', chronology: 'current' } }));
    expect(p.clearing!.chainStatus).toBe('indeterminate');
    for (const k of p.clearing!.constraints) {
      expect(k.feasibility).toBe('unresolved_only');
      expect(k.classes.map((c) => c.class)).toEqual(['unresolved']);
    }
  });
});
