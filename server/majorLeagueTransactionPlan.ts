/**
 * Read-only transaction-path planning for a selected internal responder.
 *
 * This composes the shared roster transaction engine. It describes required
 * actions and unresolved corresponding decisions without selecting a player to
 * remove, ranking responders, or mutating OOTP.
 */

import type { MajorLeagueNeed, MajorLeagueOperationsGap } from './majorLeagueOperations.js';
import type { InternalResponder } from './majorLeagueResponders.js';
import {
  evaluateRosterAction,
  playerRosterState,
  type RosterRequirement,
  type RosterRuleEvaluation,
} from './rosterTransactionState.js';

export type TransactionSolutionFeasibility =
  | 'immediately_usable'
  | 'feasible'
  | 'feasible_with_corresponding_decisions'
  | 'ineligible'
  | 'indeterminate';

export type TransactionSolutionStepKind =
  | 'internal_reassignment'
  | 'create_forty_man_space'
  | 'add_to_forty_man'
  | 'create_active_roster_space'
  | 'recall_to_active_mlb';

export interface TransactionSolutionStep {
  kind: TransactionSolutionStepKind;
  status: 'required' | 'not_required' | 'indeterminate' | 'blocked';
  description: string;
  source: 'roster_transaction_engine' | 'major_league_operations';
}

export interface CorrespondingRosterDecision {
  kind: 'active_roster_space' | 'forty_man_space';
  status: 'required' | 'indeterminate';
  description: string;
  /** The planner intentionally leaves this empty: the GM selects a player. */
  selectedPlayerId: null;
}

export interface TransactionSolution {
  need: MajorLeagueNeed;
  responder: {
    playerId: number;
    name: string;
    source: InternalResponder['source'];
    roleFit: InternalResponder['roleFit'];
  };
  requestedUse: { role: MajorLeagueNeed['role']; cause: MajorLeagueNeed['cause']; horizon: MajorLeagueNeed['horizon'] };
  currentRosterState: {
    activeMlb: boolean | null;
    fortyMan: boolean | null;
    teamId: number | null;
    teamLevel: number | null;
    onIl: boolean | null;
    onIl60: boolean | null;
    designatedForAssignment: boolean | null;
    onWaivers: boolean | null;
  } | null;
  feasibility: TransactionSolutionFeasibility;
  steps: TransactionSolutionStep[];
  correspondingDecisions: CorrespondingRosterDecision[];
  structuralFacts: {
    usesExistingActiveMlbPlayer: boolean;
    requiresFortyManAddition: boolean | null;
    requiresActiveRosterClearing: boolean | null;
    requiresFortyManClearing: boolean | null;
    activeResponderRoleMayBeAltered: boolean;
  };
  sequencing: 'not_applicable' | 'logical_planning_order_not_full_legal_sequence';
  evidence: Array<{ kind: 'roster_rule_evaluation' | 'responder_context'; details: Record<string, unknown> }>;
  unknowns: MajorLeagueOperationsGap[];
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

function stateFor(playerId: number): TransactionSolution['currentRosterState'] {
  const state = playerRosterState(playerId);
  if (!state) return null;
  return {
    activeMlb: state.activeMlb,
    fortyMan: state.fortyMan,
    teamId: state.teamId,
    teamLevel: state.teamLevel,
    onIl: state.transaction.onIl,
    onIl60: state.transaction.onIl60,
    designatedForAssignment: state.transaction.designatedForAssignment,
    onWaivers: state.transaction.onWaivers,
  };
}

function baseSolution(need: MajorLeagueNeed, responder: InternalResponder): TransactionSolution {
  return {
    need,
    responder: { playerId: responder.playerId, name: responder.name, source: responder.source, roleFit: responder.roleFit },
    requestedUse: { role: need.role, cause: need.cause, horizon: need.horizon },
    currentRosterState: stateFor(responder.playerId),
    feasibility: 'indeterminate',
    steps: [],
    correspondingDecisions: [],
    structuralFacts: {
      usesExistingActiveMlbPlayer: responder.source === 'active_mlb',
      requiresFortyManAddition: null,
      requiresActiveRosterClearing: null,
      requiresFortyManClearing: null,
      activeResponderRoleMayBeAltered: responder.source === 'active_mlb',
    },
    sequencing: 'not_applicable',
    evidence: [{
      kind: 'responder_context',
      details: {
        source: responder.source,
        fortyMan: responder.transactionContext.fortyMan,
        majorLeagueContract: responder.transactionContext.majorLeagueContract,
      },
    }],
    unknowns: [],
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
}

function requirement(requirements: RosterRequirement[], kind: RosterRequirement['kind']): RosterRequirement | undefined {
  return requirements.find((item) => item.kind === kind);
}

function unknownsFromEvaluation(evaluation: RosterRuleEvaluation): MajorLeagueOperationsGap[] {
  return evaluation.result === 'indeterminate'
    ? [{ code: 'recall_legality_indeterminate', message: evaluation.reasons.join(' ') }]
    : [];
}

/**
 * Describe the transaction path for one selected Phase 2 responder. This is
 * intentionally not a selector: it never compares this response to another.
 */
export function planTransactionSolution(need: MajorLeagueNeed, responder: InternalResponder): TransactionSolution {
  const result = baseSolution(need, responder);
  if (responder.source === 'active_mlb') {
    result.feasibility = 'immediately_usable';
    result.steps.push({
      kind: 'internal_reassignment', status: 'required', source: 'major_league_operations',
      description: 'Use the existing active MLB player in the affected role; no recall or 40-man action is required.',
    });
    result.evidence.push({
      kind: 'responder_context',
      details: { roleFit: responder.roleFit, consequence: 'The player’s current MLB role may be altered; downstream coverage is not simulated here.' },
    });
    return result;
  }

  const evaluation = evaluateRosterAction(need.organizationId, responder.playerId, 'recall');
  result.evidence.push({
    kind: 'roster_rule_evaluation',
    details: { action: evaluation.action, result: evaluation.result, reasons: evaluation.reasons, requirements: evaluation.requirements },
  });
  result.unknowns.push(...unknownsFromEvaluation(evaluation));
  const activeSpace = requirement(evaluation.requirements, 'active_roster_move');
  const fortyAddition = requirement(evaluation.requirements, 'forty_man_addition');
  const fortySpace = requirement(evaluation.requirements, 'forty_man_roster_move');
  result.structuralFacts.requiresFortyManAddition = fortyAddition?.status === 'required'
    ? true
    : fortyAddition?.status === 'not_required' || result.currentRosterState?.fortyMan === true ? false : null;
  result.structuralFacts.requiresActiveRosterClearing = activeSpace?.status === 'required'
    ? true
    : activeSpace?.status === 'not_required' ? false : null;
  result.structuralFacts.requiresFortyManClearing = fortySpace?.status === 'required'
    ? true
    : fortySpace?.status === 'not_required' ? false : null;

  if (evaluation.result === 'ineligible') {
    result.feasibility = 'ineligible';
    result.steps.push({
      kind: 'recall_to_active_mlb', status: 'blocked', source: 'roster_transaction_engine',
      description: evaluation.reasons.join(' '),
    });
    return result;
  }
  if (evaluation.result === 'indeterminate') {
    result.feasibility = 'indeterminate';
    result.steps.push({
      kind: 'recall_to_active_mlb', status: 'indeterminate', source: 'roster_transaction_engine',
      description: evaluation.reasons.join(' '),
    });
    return result;
  }

  const hasCorrespondingDecision = activeSpace?.status === 'required' || fortySpace?.status === 'required';
  if (fortySpace?.status === 'required') {
    result.correspondingDecisions.push({
      kind: 'forty_man_space', status: 'required', selectedPlayerId: null,
      description: fortySpace.reason,
    });
    result.steps.push({ kind: 'create_forty_man_space', status: 'required', source: 'roster_transaction_engine', description: fortySpace.reason });
  }
  if (fortyAddition?.status === 'required') {
    result.steps.push({
      kind: 'add_to_forty_man', status: 'required', source: 'roster_transaction_engine',
      description: fortyAddition.reason,
    });
  }
  if (activeSpace?.status === 'required') {
    result.correspondingDecisions.push({
      kind: 'active_roster_space', status: 'required', selectedPlayerId: null,
      description: activeSpace.reason,
    });
    result.steps.push({ kind: 'create_active_roster_space', status: 'required', source: 'roster_transaction_engine', description: activeSpace.reason });
  }
  result.steps.push({
    kind: 'recall_to_active_mlb', status: 'required', source: 'roster_transaction_engine',
    description: 'Recall the selected responder to the MLB active roster after required roster decisions are made.',
  });
  result.feasibility = hasCorrespondingDecision ? 'feasible_with_corresponding_decisions' : 'feasible';
  if (hasCorrespondingDecision) {
    result.sequencing = 'logical_planning_order_not_full_legal_sequence';
    result.unknowns.push({
      code: 'exact_transaction_sequence_not_established',
      message: 'The listed order is a logical planning order. Imported OOTP data does not establish every CBA/waiver/DFA sequencing detail or choose the corresponding player.'
    });
  }
  return result;
}
