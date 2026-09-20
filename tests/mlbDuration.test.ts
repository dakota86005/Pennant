import { describe, expect, it } from 'vitest';
import { whatIfNeed } from '../server/mlbNeeds';
import { buildResponsePacket, type ResponseCandidate } from '../server/mlbResponses';
import { resolveAcrossDurations, type ContextVerdict } from '../server/mlbAssignmentContext';
import { fakePorts, healthy26, mkState, viewOf, type PortOptions, type Spec } from './mlbFixtures';

/*
 * An unknown expected duration must stay unknown. Player Development is asked
 * about temporary depth and a durable assignment; where the two answers agree
 * the duration does not matter and is not asked for; where they differ the
 * result is context-dependent and says so. MLB Operations invents no default.
 */

const farm: Spec[] = [{ id: 500, name: 'Reno40 SP', position: 1, role: 11, level: 2, forty: true, active: false }];

type Answer = Partial<{ judgment: 'defensible' | 'indefensible' | 'indeterminate'; blockers: string[]; missingEvidence: Array<{ detail: string }> }>;

function candidate(
  answers: { temporary?: Answer | null; durable?: Answer | null },
  extra: Partial<PortOptions> = {}, days: number | null = null,
  context?: Parameters<typeof buildResponsePacket>[3]
) {
  const specs = [...healthy26(), ...farm];
  const view = viewOf(specs);
  const contextsAsked: NonNullable<PortOptions['contextsAsked']> = [];
  const developmentByContext = {
    temporary_depth: answers.temporary ? { 500: answers.temporary } : {},
    durable_role: answers.durable ? { 500: answers.durable } : {},
    spot_start: answers.temporary ? { 500: answers.temporary } : {},
  } as NonNullable<PortOptions['developmentByContext']>;
  const n = whatIfNeed(view, 100, undefined, days)!;
  const packet = buildResponsePacket(n, view, fakePorts({
    states: specs.map(mkState), assignments: { 500: 'optioned' }, developmentByContext, contextsAsked, ...extra,
  }), context);
  const found = packet.groups.flatMap((g) => g.candidates).find((c) => c.playerId === 500) as ResponseCandidate;
  return { packet, c: found, contextsAsked };
}

const DEF: Answer = { judgment: 'defensible' };
const NOT: Answer = { judgment: 'indefensible', blockers: ['Readiness is below the bar.'] };
const UNK: Answer = { judgment: 'indeterminate', missingEvidence: [{ detail: 'His visible ratings are not available.' }] };

describe('unknown duration stays unknown', () => {
  it('both contexts defensible: defensible whatever the duration, no duration is asked for', () => {
    const { c, packet } = candidate({ temporary: DEF, durable: DEF });
    expect(c.development).toMatchObject({ status: 'defensible', context: null, basis: 'across_durations', duration: { matters: false, resolvedBy: null } });
    expect(c.group).toBe('open');
    expect(packet.assignment).toMatchObject({ context: null, basis: 'duration_unknown' });
  });

  it('both contexts indefensible: indefensible whatever the duration', () => {
    const { c } = candidate({ temporary: NOT, durable: NOT });
    expect(c.development).toMatchObject({ status: 'indefensible', duration: { matters: false } });
    expect(c.group).toBe('blocked_by_development');
  });

  it('defensible as temporary depth but not as a durable assignment: context-dependent, said in words, and never open', () => {
    const { c } = candidate({ temporary: DEF, durable: NOT });
    expect(c.development).toMatchObject({ status: 'context_dependent', duration: { matters: true } });
    expect(c.group).toBe('context_dependent');
    expect(c.why.join(' ')).toContain('Defensible as temporary depth, but not defensible as a durable MLB assignment. Expected absence duration is not known.');
    expect(c.why.join(' ')).toMatch(/Choose the assignment that matches how long he would be needed/);
    expect(c.philosophy).toMatchObject({ status: 'not_applicable', stance: null });
  });

  it('temporary defensible while the durable assignment cannot be established: still context-dependent, honestly worded', () => {
    const { c } = candidate({ temporary: DEF, durable: null });
    expect(c.development).toMatchObject({ status: 'context_dependent' });
    expect(c.why.join(' ')).toMatch(/not established as a durable MLB assignment/);
    expect(c.group).toBe('context_dependent');
  });

  it('temporary indeterminate and durable indefensible: indeterminate, which is missing evidence and not a duration question', () => {
    const { c } = candidate({ temporary: UNK, durable: NOT });
    expect(c.development).toMatchObject({ status: 'indeterminate', duration: { matters: false } });
    expect(c.group).toBe('evaluation_incomplete');
    expect(c.development.status === 'indeterminate' && c.development.missing).toContain('His visible ratings are not available.');
  });

  it('never assessed in either context is unassessed, as before', () => {
    const { c } = candidate({ temporary: null, durable: null });
    expect(c.development).toMatchObject({ status: 'unassessed' });
    expect(c.group).toBe('evaluation_incomplete');
  });

  it('a known duration asks only the one context, so the GM is not made to answer what would not change the answer', () => {
    expect(candidate({ temporary: DEF, durable: NOT }, {}, 6).contextsAsked).toEqual(['spot_start']);
    expect(candidate({ temporary: DEF, durable: NOT }, {}, 40).contextsAsked).toEqual(['temporary_depth']);
    expect(candidate({ temporary: DEF, durable: NOT }, {}, 120).contextsAsked).toEqual(['durable_role']);
    expect(candidate({ temporary: DEF, durable: NOT }).contextsAsked).toEqual(['temporary_depth', 'durable_role']);
  });

  it('a known long need judges the durable role: the same player who was context-dependent is blocked, not assumed short', () => {
    const { c } = candidate({ temporary: DEF, durable: NOT }, {}, 120);
    expect(c.development).toMatchObject({ status: 'indefensible', context: 'durable_role', duration: null });
    expect(c.group).toBe('blocked_by_development');
  });

  it('an explicit GM context overrides the unknown duration and resolves the dependence', () => {
    const temporary = candidate({ temporary: DEF, durable: NOT }, {}, null, 'temporary_depth');
    expect(temporary.packet.assignment).toMatchObject({ context: 'temporary_depth', basis: 'gm_selected', evaluated: ['temporary_depth'] });
    expect(temporary.c.group).toBe('open');
    expect(temporary.contextsAsked).toEqual(['temporary_depth']);
    const durable = candidate({ temporary: DEF, durable: NOT }, {}, null, 'durable_role');
    expect(durable.c.group).toBe('blocked_by_development');
    expect(durable.contextsAsked).toEqual(['durable_role']);
  });

  it('philosophy has no effect on developmental authorization, in either direction', () => {
    const aggressive = candidate({ temporary: DEF, durable: NOT }, { philosophy: { promotionAggressiveness: 95 } });
    const patient = candidate({ temporary: DEF, durable: NOT }, { philosophy: { promotionAggressiveness: 5 } });
    expect(aggressive.c.group).toBe('context_dependent');
    expect(patient.c.group).toBe('context_dependent');
    expect(aggressive.c.development).toEqual(patient.c.development);
    // and it cannot rescue an indefensible one or block a defensible one
    expect(candidate({ temporary: NOT, durable: NOT }, { philosophy: { promotionAggressiveness: 95 } }).c.group).toBe('blocked_by_development');
    expect(candidate({ temporary: DEF, durable: DEF }, { philosophy: { promotionAggressiveness: 5 } }).c.group).toBe('open');
  });

  it('carries each context\'s verdict so the GM can see where the answer turns', () => {
    const { c } = candidate({ temporary: DEF, durable: NOT });
    const verdicts = c.development.status === 'context_dependent' ? c.development.duration?.verdicts : null;
    expect(verdicts?.map((v) => [v.context, v.judgment])).toEqual([['temporary_depth', 'defensible'], ['durable_role', 'indefensible']]);
  });
});

describe('resolveAcrossDurations (Player Development)', () => {
  const v = (context: ContextVerdict['context'], judgment: ContextVerdict['judgment']): ContextVerdict => ({
    context, label: context, judgment, assessed: true, reasons: [], blockers: [], missing: [],
  });
  it('follows the lattice: all defensible, all indefensible, some defensible, none defensible with an unknown', () => {
    expect(resolveAcrossDurations([v('temporary_depth', 'defensible'), v('durable_role', 'defensible')]).judgment).toBe('defensible');
    expect(resolveAcrossDurations([v('temporary_depth', 'indefensible'), v('durable_role', 'indefensible')]).judgment).toBe('indefensible');
    expect(resolveAcrossDurations([v('temporary_depth', 'defensible'), v('durable_role', 'indefensible')]).judgment).toBe('context_dependent');
    expect(resolveAcrossDurations([v('temporary_depth', 'defensible'), v('durable_role', 'indeterminate')]).judgment).toBe('context_dependent');
    expect(resolveAcrossDurations([v('temporary_depth', 'indeterminate'), v('durable_role', 'indefensible')]).judgment).toBe('indeterminate');
    expect(resolveAcrossDurations([v('temporary_depth', 'indeterminate'), v('durable_role', 'indeterminate')]).judgment).toBe('indeterminate');
  });
  it('a defensible shorter assignment never makes the longer one defensible', () => {
    const r = resolveAcrossDurations([v('temporary_depth', 'defensible'), v('durable_role', 'indefensible')]);
    expect(r.defensibleIn).toEqual(['temporary_depth']);
    expect(r.indefensibleIn).toEqual(['durable_role']);
    expect(r.durationMatters).toBe(true);
    expect(r.resolvedBy).toMatch(/how long/);
  });
});
