import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import type { MajorLeagueNeed, MajorLeagueNeedRole } from '../server/majorLeagueOperations.js';
import type { InternalResponder } from '../server/majorLeagueResponders.js';
import { planTransactionSolution } from '../server/majorLeagueTransactionPlan.js';
import { organizationRosterTransactionState } from '../server/rosterTransactionState.js';
import { IDS } from './fixture';

const role: MajorLeagueNeedRole = { kind: 'position', position: 6, label: 'shortstop', provenance: 'observed' };

function need(overrides: Partial<MajorLeagueNeed> = {}): MajorLeagueNeed {
  return {
    id: 'test-open-shortstop-need', organizationId: IDS.mlbTeam, mlbTeamId: IDS.mlbTeam,
    category: 'role_coverage', role, causalPlayer: { playerId: 999, name: 'Unavailable Shortstop' },
    cause: { kind: 'injury', provenance: 'corroborated' }, detectedAt: '2030-06-01T00:00:00.000Z',
    status: 'open', lifecycle: 'continuing', horizon: { kind: 'temporary', expectedDays: 14, evidence: [] },
    evidence: [], unknowns: [], ...overrides,
  };
}

function responder(playerId: number, source: InternalResponder['source']): InternalResponder {
  return {
    playerId, name: `Responder ${playerId}`, source,
    assignment: { teamId: source === 'active_mlb' ? IDS.mlbTeam : IDS.aaaTeam, level: source === 'active_mlb' ? 1 : 2 },
    roleFit: { fit: 'direct', role, evidence: [{ kind: 'listed_position', message: 'Test role fit.' }] },
    availability: { status: 'available', evidence: ['Test availability.'] },
    development: source === 'minor_league_call_up' ? { status: 'not_applicable', gate: null, message: 'Test depth.' } : null,
    transactionContext: { fortyMan: null, majorLeagueContract: null, note: 'Baseball discussion only; transaction feasibility is deferred.' },
  };
}

let originalStatus: Array<Record<string, number>> = [];

function installLimits(active: number, forty: number): void {
  db.exec('ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER');
  db.exec('ALTER TABLE leagues ADD COLUMN rules_secondary_roster_limit INTEGER');
  db.prepare('UPDATE leagues SET rules_active_roster_limit = ?, rules_secondary_roster_limit = ? WHERE league_id = ?')
    .run(active, forty, IDS.league);
}

function capacity(): { active: number; forty: number } {
  const state = organizationRosterTransactionState(IDS.mlbTeam);
  return { active: state.capacity.active.count!, forty: state.capacity.fortyMan.count! };
}

beforeEach(() => {
  originalStatus = db.prepare(
    'SELECT player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary, designated_for_assignment, is_on_waivers FROM players_roster_status'
  ).all() as Array<Record<string, number>>;
});

afterEach(() => {
  for (const row of originalStatus) {
    db.prepare(
      `UPDATE players_roster_status
       SET is_active = ?, is_on_dl = ?, is_on_dl60 = ?, is_on_secondary = ?,
           designated_for_assignment = ?, is_on_waivers = ? WHERE player_id = ?`
    ).run(row.is_active, row.is_on_dl, row.is_on_dl60, row.is_on_secondary, row.designated_for_assignment, row.is_on_waivers, row.player_id);
  }
  const columns = (db.prepare('PRAGMA table_info(leagues)').all() as Array<{ name: string }>).map((column) => column.name);
  if (columns.includes('rules_secondary_roster_limit')) db.exec('ALTER TABLE leagues DROP COLUMN rules_secondary_roster_limit');
  if (columns.includes('rules_active_roster_limit')) db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
});

describe('MLB transaction solution planning', () => {
  it('uses an active MLB responder through an internal reassignment without a recall', () => {
    const solution = planTransactionSolution(need(), responder(IDS.starter, 'active_mlb'));
    expect(solution).toMatchObject({
      feasibility: 'immediately_usable',
      structuralFacts: { usesExistingActiveMlbPlayer: true, activeResponderRoleMayBeAltered: true },
      steps: [expect.objectContaining({ kind: 'internal_reassignment' })],
    });
    expect(solution.steps.some((step) => step.kind === 'recall_to_active_mlb')).toBe(false);
  });

  it('represents an active pitcher role reassignment without recursively solving its consequence', () => {
    const pitcherRole: MajorLeagueNeedRole = { kind: 'starting_pitcher', position: 1, label: 'starting pitcher', provenance: 'observed' };
    const solution = planTransactionSolution(need({ role: pitcherRole }), responder(IDS.extended, 'active_mlb'));
    expect(solution.steps).toEqual([expect.objectContaining({ kind: 'internal_reassignment' })]);
    expect(solution.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ details: expect.objectContaining({ consequence: expect.stringMatching(/current MLB role/) }) }),
    ]));
  });

  it('plans a 40-man recall with an open active spot as a routine feasible action', () => {
    const before = capacity();
    installLimits(before.active + 1, before.forty + 1);
    const solution = planTransactionSolution(need(), responder(IDS.optioned, 'minor_league_call_up'));
    expect(solution.feasibility).toBe('feasible');
    expect(solution.steps).toEqual([expect.objectContaining({ kind: 'recall_to_active_mlb' })]);
    expect(solution.correspondingDecisions).toEqual([]);
    expect(solution.structuralFacts).toMatchObject({ requiresFortyManAddition: false, requiresActiveRosterClearing: false });
  });

  it('keeps a full active roster as a corresponding decision rather than an ineligible recall', () => {
    const before = capacity();
    installLimits(before.active, before.forty + 1);
    const solution = planTransactionSolution(need(), responder(IDS.optioned, 'minor_league_call_up'));
    expect(solution.feasibility).toBe('feasible_with_corresponding_decisions');
    expect(solution.correspondingDecisions).toEqual([
      expect.objectContaining({ kind: 'active_roster_space', selectedPlayerId: null }),
    ]);
    expect(solution.steps.map((step) => step.kind)).toEqual(['create_active_roster_space', 'recall_to_active_mlb']);
  });

  it('plans non-40-man recalls with the required addition and roster-clearing decisions', () => {
    db.prepare('UPDATE players_roster_status SET is_on_secondary = 0 WHERE player_id = ?').run(IDS.minorDeal);
    const open = capacity();
    installLimits(open.active + 1, open.forty + 1);
    const routine = planTransactionSolution(need(), responder(IDS.minorDeal, 'minor_league_call_up'));
    expect(routine).toMatchObject({ feasibility: 'feasible', structuralFacts: { requiresFortyManAddition: true } });
    expect(routine.steps.map((step) => step.kind)).toEqual(['add_to_forty_man', 'recall_to_active_mlb']);

    db.exec('ALTER TABLE leagues DROP COLUMN rules_secondary_roster_limit');
    db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
    const full = capacity();
    installLimits(full.active + 1, full.forty);
    const fortyConstrained = planTransactionSolution(need(), responder(IDS.minorDeal, 'minor_league_call_up'));
    expect(fortyConstrained.feasibility).toBe('feasible_with_corresponding_decisions');
    expect(fortyConstrained.steps.map((step) => step.kind)).toEqual([
      'create_forty_man_space', 'add_to_forty_man', 'recall_to_active_mlb',
    ]);

    db.exec('ALTER TABLE leagues DROP COLUMN rules_secondary_roster_limit');
    db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
    installLimits(full.active, full.forty);
    const constrained = planTransactionSolution(need(), responder(IDS.minorDeal, 'minor_league_call_up'));
    expect(constrained.feasibility).toBe('feasible_with_corresponding_decisions');
    expect(constrained.steps.map((step) => step.kind)).toEqual([
      'create_forty_man_space', 'add_to_forty_man', 'create_active_roster_space', 'recall_to_active_mlb',
    ]);
    expect(constrained.correspondingDecisions.every((decision) => decision.selectedPlayerId === null)).toBe(true);
    expect(constrained.sequencing).toBe('logical_planning_order_not_full_legal_sequence');
  });

  it('propagates shared ineligibility and indeterminacy without inventing option or waiver solutions', () => {
    db.prepare('UPDATE players_roster_status SET is_on_dl = 1 WHERE player_id = ?').run(IDS.optioned);
    const blocked = planTransactionSolution(need(), responder(IDS.optioned, 'minor_league_call_up'));
    expect(blocked).toMatchObject({ feasibility: 'ineligible', steps: [expect.objectContaining({ status: 'blocked' })] });

    db.prepare('UPDATE players_roster_status SET is_on_dl = 0 WHERE player_id = ?').run(IDS.optioned);
    const unknown = planTransactionSolution(need(), responder(IDS.optioned, 'minor_league_call_up'));
    expect(unknown).toMatchObject({ feasibility: 'indeterminate' });
    expect(unknown.unknowns).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'recall_legality_indeterminate' }),
    ]));
  });

  it('carries need cause/horizon unchanged without evaluating player value or preference', () => {
    const solution = planTransactionSolution(need(), responder(IDS.starter, 'active_mlb'));
    expect(solution.requestedUse).toEqual({ role, cause: need().cause, horizon: need().horizon });
    expect(solution.scoutingValuePolicy).toBe('prohibited_pending_provenance');
  });
});
