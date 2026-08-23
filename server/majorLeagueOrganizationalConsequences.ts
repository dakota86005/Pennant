/**
 * Read-only organizational consequence analysis for one selected MLB solution.
 *
 * Major League Operations aggregates factual MLB and farm consequences. Farm
 * coverage and any downstream discussion candidates remain owned by Minor
 * League Operations; this module never selects an assignment or transaction.
 */

import { POSITION_CODES } from './gloves.js';
import {
  analyzeHypotheticalAffiliateRemoval,
  type HypotheticalAffiliateRemovalAnalysis,
} from './minorLeagueConsequences.js';
import type { MajorLeagueNeed, MajorLeagueOperationsGap } from './majorLeagueOperations.js';
import type { InternalResponder } from './majorLeagueResponders.js';
import type { TransactionSolution } from './majorLeagueTransactionPlan.js';
import { playerRosterState } from './rosterTransactionState.js';

export interface MajorLeagueOrganizationalConsequences {
  need: { id: string; cause: MajorLeagueNeed['cause']; horizon: MajorLeagueNeed['horizon'] };
  responder: { playerId: number; name: string; source: InternalResponder['source'] };
  transactionSolution: {
    feasibility: TransactionSolution['feasibility'];
    requestedUse: TransactionSolution['requestedUse'];
    correspondingDecisions: TransactionSolution['correspondingDecisions'];
    unknowns: MajorLeagueOperationsGap[];
  };
  factualChanges: Array<{
    kind: 'mlb_role_reassignment' | 'minor_league_player_removed';
    message: string;
  }>;
  mlbRoleConsequence: {
    status: 'not_applicable' | 'role_altered' | 'role_unchanged' | 'indeterminate';
    priorRole: string | null;
    message: string;
  };
  sourceAffiliateConsequence: HypotheticalAffiliateRemovalAnalysis | null;
  unresolvedMlbDecisions: TransactionSolution['correspondingDecisions'];
  developmentContext: InternalResponder['development'];
  unknowns: MajorLeagueOperationsGap[];
  ordering: 'single_solution_no_ranking';
  scoring: 'none';
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

function currentRole(playerId: number): string | null {
  const player = playerRosterState(playerId);
  if (!player || player.position === null) return null;
  if (player.position === 1) {
    if (player.role === null) return null;
    return player.role === 11 ? 'starting pitcher' : 'relief pitcher';
  }
  return POSITION_CODES[player.position - 1] ?? `position ${player.position}`;
}

/** Aggregate the consequence package for exactly one already-selected solution. */
export function analyzeOrganizationalConsequences(
  need: MajorLeagueNeed,
  responder: InternalResponder,
  solution: TransactionSolution
): MajorLeagueOrganizationalConsequences {
  const unknowns: MajorLeagueOperationsGap[] = [...solution.unknowns];
  const factualChanges: MajorLeagueOrganizationalConsequences['factualChanges'] = [];
  let mlbRoleConsequence: MajorLeagueOrganizationalConsequences['mlbRoleConsequence'];
  let sourceAffiliateConsequence: HypotheticalAffiliateRemovalAnalysis | null = null;

  if (solution.need.id !== need.id || solution.responder.playerId !== responder.playerId) {
    unknowns.push({
      code: 'solution_context_mismatch',
      message: 'The supplied transaction solution does not identify the same need and responder as this consequence analysis.',
    });
  }

  if (responder.source === 'active_mlb') {
    const priorRole = currentRole(responder.playerId);
    const requestedRole = need.role?.label ?? null;
    const altered = priorRole !== null && requestedRole !== null && priorRole !== requestedRole;
    mlbRoleConsequence = priorRole === null
      ? { status: 'indeterminate', priorRole: null, message: 'The responder’s current exported MLB role is unavailable.' }
      : altered
        ? { status: 'role_altered', priorRole, message: `Using this responder for ${requestedRole} alters the current ${priorRole} role; its downstream MLB coverage is an immediate secondary consequence.` }
        : { status: 'role_unchanged', priorRole, message: `The responder’s current ${priorRole} role matches the requested use; no separate role vacancy is identified.` };
    factualChanges.push({ kind: 'mlb_role_reassignment', message: mlbRoleConsequence.message });
  } else {
    mlbRoleConsequence = { status: 'not_applicable', priorRole: null, message: 'This solution recalls a minor-league responder rather than reassigning an active MLB player.' };
    sourceAffiliateConsequence = analyzeHypotheticalAffiliateRemoval(need.organizationId, responder.playerId);
    if (!sourceAffiliateConsequence) {
      const state = playerRosterState(responder.playerId);
      const sourceRoleUnknown = state?.position === null || (state?.position === 1 && state.role === null);
      unknowns.push({
        code: sourceRoleUnknown ? 'source_role_unknown' : 'source_affiliate_consequence_indeterminate',
        message: sourceRoleUnknown
          ? 'The responder’s current source position or pitching role is unavailable, so affiliate coverage after removal is unknown.'
          : 'The responder’s current minor-league affiliate cannot be established for hypothetical removal analysis.',
        playerId: responder.playerId,
      });
    } else {
      factualChanges.push({
        kind: 'minor_league_player_removed',
        message: `${sourceAffiliateConsequence.sourceAffiliate.label} hypothetically loses ${sourceAffiliateConsequence.removedPlayer.name} from its ${sourceAffiliateConsequence.removedPlayer.role.label} coverage.`,
      });
      unknowns.push(...sourceAffiliateConsequence.unknowns.map((unknown) => ({ ...unknown, playerId: responder.playerId })));
    }
  }

  return {
    need: { id: need.id, cause: need.cause, horizon: need.horizon },
    responder: { playerId: responder.playerId, name: responder.name, source: responder.source },
    transactionSolution: {
      feasibility: solution.feasibility,
      requestedUse: solution.requestedUse,
      correspondingDecisions: solution.correspondingDecisions,
      unknowns: solution.unknowns,
    },
    factualChanges,
    mlbRoleConsequence,
    sourceAffiliateConsequence,
    unresolvedMlbDecisions: solution.correspondingDecisions,
    developmentContext: responder.development,
    unknowns,
    ordering: 'single_solution_no_ranking',
    scoring: 'none',
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
}
