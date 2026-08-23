import { describe, expect, it } from 'vitest';
import {
  causeLabel,
  completenessLabel,
  farmPathLabel,
  farmSummary,
  horizonLabel,
  preferenceLabel,
  selectedById,
} from '../src/pages/MajorLeagueOperations.tsx';

describe('Major League Operations workspace presentation', () => {
  it('keeps multiple operational needs scannable and selection stable', () => {
    const needs = [{ id: 'rotation' }, { id: 'catcher' }];
    expect(selectedById(needs, 'catcher')).toEqual({ id: 'catcher' });
    expect(selectedById(needs, 'resolved')).toEqual({ id: 'rotation' });
    expect(horizonLabel({ kind: 'temporary', expectedDays: 18 })).toContain('18 days');
    expect(causeLabel({ category: 'role_coverage', cause: { kind: 'injury' } } as never)).toBe('Documented injury');
  });

  it('does not turn preference tiers or conditional completeness into an instruction', () => {
    expect(preferenceLabel('preferred')).toBe('Organizationally preferred');
    expect(preferenceLabel('preferred_conditional')).toContain('roster decisions');
    expect(completenessLabel('fully_actionable')).toContain('Complete');
    expect(completenessLabel('feasible_requires_gm_decision')).toContain('GM roster decision');
    expect(completenessLabel('indeterminate')).toContain('indeterminate');
  });

  it('keeps alternate farm paths for the same responder visibly distinct', () => {
    expect(farmSummary({ kind: 'stable_no_move', status: 'complete', cascadeStatus: 'complete', plan: null, unknowns: [] })).toBe('Source affiliate remains stable');
    expect(farmSummary({ kind: 'cascade_plan', status: 'complete', cascadeStatus: 'complete', plan: { depth: 2, moves: [], unresolvedProblems: [], resolvedProblems: [] }, unknowns: [] })).toBe('Farm cascade stabilizes in 2 moves');
    expect(farmPathLabel({ kind: 'cascade_plan', status: 'complete', cascadeStatus: 'complete', plan: { depth: 1, moves: [{ playerId: 5, playerName: 'Garcia', kind: 'normal_promotion', from: { team: 'AA', level: 3 }, to: { teamId: 2, team: 'AAA', level: 2 }, role: 'shortstop', development: { status: 'authorized', recommendation: 'normal_promotion', reasons: [], destinationFit: null } }], unresolvedProblems: [], resolvedProblems: [] }, unknowns: [] })).toBe('AAA ← Garcia');
  });

  it('makes partial and truncated downstream results textually explicit', () => {
    expect(completenessLabel('partial_organizational_solution')).toContain('Partial');
    expect(completenessLabel('search_truncated')).toContain('limit');
    expect(farmSummary({ kind: 'cascade_unresolved', status: 'truncated', cascadeStatus: 'truncated', plan: null, unknowns: [] })).toContain('did not prove');
    expect(farmSummary({ kind: 'cascade_unresolved', status: 'indeterminate', cascadeStatus: 'indeterminate', plan: null, unknowns: [] })).toContain('unresolved');
  });
});
