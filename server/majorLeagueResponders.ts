/**
 * Internal responder assembly for one open MLB need.
 *
 * This is deliberately a discussion set, not a ranking, recommendation, or
 * transaction plan. Player Development owns the MLB discussion gate for
 * evaluated AAA prospects; Major League Operations owns only role relevance
 * and current availability.
 */

import { gloves } from './gloves.js';
import { mlbDiscussionDevelopmentGates, type MlbDiscussionDevelopmentGate } from './org.js';
import type { MajorLeagueNeed, MajorLeagueNeedRole, MajorLeagueOperationsGap } from './majorLeagueOperations.js';
import { normalizedPitchingRole } from './pitchingRole.js';
import { organizationRosterTransactionState, type PlayerRosterState } from './rosterTransactionState.js';

export type InternalResponderSource = 'active_mlb' | 'minor_league_call_up';
export type ResponderRoleFit = 'direct' | 'secondary';

export interface InternalResponderRoleEvidence {
  fit: ResponderRoleFit;
  role: MajorLeagueNeedRole;
  evidence: Array<{
    kind: 'listed_position' | 'pitching_role' | 'visible_fielding_rating';
    message: string;
    rating?: number;
    experience?: number;
  }>;
}

export interface InternalResponderDevelopmentEvidence {
  status: 'approved' | 'not_applicable';
  gate: MlbDiscussionDevelopmentGate | null;
  message: string;
}

export interface InternalResponder {
  playerId: number;
  name: string;
  source: InternalResponderSource;
  assignment: { teamId: number | null; level: number | null };
  roleFit: InternalResponderRoleEvidence;
  availability: { status: 'available'; evidence: string[] };
  development: InternalResponderDevelopmentEvidence | null;
  transactionContext: {
    fortyMan: boolean | null;
    majorLeagueContract: boolean | null;
    note: 'Baseball discussion only; transaction feasibility is deferred.';
  };
}

export interface InternalResponderExclusion {
  playerId: number;
  name: string;
  source: 'minor_league';
  reason: 'developmentally_prohibited' | 'unavailable' | 'lower_level_not_evaluated_for_mlb' | 'role_fit_not_established';
  development: MlbDiscussionDevelopmentGate | null;
  message: string;
}

export interface InternalResponderAssembly {
  need: MajorLeagueNeed;
  activeRosterResponders: InternalResponder[];
  minorLeagueCallUpResponders: InternalResponder[];
  minorLeagueExclusions: InternalResponderExclusion[];
  unknowns: MajorLeagueOperationsGap[];
  ordering: 'player_id_ascending_non_preferential';
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

function available(player: PlayerRosterState): boolean {
  return player.health?.playable !== false && player.transaction.onIl !== true && player.transaction.onIl60 !== true &&
    player.transaction.designatedForAssignment !== true && player.transaction.onWaivers !== true;
}

function defensiveFit(player: PlayerRosterState, role: MajorLeagueNeedRole): InternalResponderRoleEvidence | null {
  if (role.kind === 'starting_pitcher') {
    return normalizedPitchingRole(player.position, player.role) === 'starting_pitcher'
      ? { fit: 'direct', role, evidence: [{ kind: 'pitching_role', message: 'Current exported role is starting pitcher.' }] }
      : null;
  }
  if (role.kind === 'relief_pitcher') {
    return normalizedPitchingRole(player.position, player.role) === 'relief_pitcher'
      ? { fit: 'direct', role, evidence: [{ kind: 'pitching_role', message: 'Current exported role is relief pitcher.' }] }
      : null;
  }
  if (role.kind !== 'position' || role.position === null) return null;
  if (player.position === role.position) {
    return {
      fit: 'direct', role,
      evidence: [{ kind: 'listed_position', message: `Listed primary position matches ${role.label}.` }],
    };
  }
  const profile = gloves(player.playerId);
  const rating = profile?.positions.find((item) => item.position === role.position);
  if (!rating || rating.current <= 0) return null;
  return {
    fit: 'secondary', role,
    evidence: [{
      kind: 'visible_fielding_rating',
      message: `Visible current fielding rating supports ${role.label} as a secondary role.`,
      rating: rating.current,
      experience: rating.experience,
    }],
  };
}

function responder(
  player: PlayerRosterState,
  source: InternalResponderSource,
  roleFit: InternalResponderRoleEvidence,
  development: InternalResponderDevelopmentEvidence | null
): InternalResponder {
  return {
    playerId: player.playerId,
    name: player.name,
    source,
    assignment: { teamId: player.teamId, level: player.teamLevel },
    roleFit,
    availability: { status: 'available', evidence: ['Current normalized roster/health state has no IL, DFA, waiver, or unavailable block.'] },
    development,
    transactionContext: {
      fortyMan: player.fortyMan,
      majorLeagueContract: player.majorLeagueContract,
      note: 'Baseball discussion only; transaction feasibility is deferred.',
    },
  };
}

function exclusion(
  player: PlayerRosterState,
  reason: InternalResponderExclusion['reason'],
  development: MlbDiscussionDevelopmentGate | null,
  message: string
): InternalResponderExclusion {
  return { playerId: player.playerId, name: player.name, source: 'minor_league', reason, development, message };
}

/**
 * Assemble stable, non-preferential internal responders for one already-open
 * role need. Capacity-only needs have no affected role and therefore cannot
 * honestly produce player responders yet.
 */
export function assembleInternalResponders(need: MajorLeagueNeed): InternalResponderAssembly {
  const empty = (): InternalResponderAssembly => ({
    need,
    activeRosterResponders: [],
    minorLeagueCallUpResponders: [],
    minorLeagueExclusions: [],
    unknowns: [],
    ordering: 'player_id_ascending_non_preferential',
    scoutingValuePolicy: 'prohibited_pending_provenance',
  });
  if (need.status !== 'open' || !need.role || need.role.kind === 'unknown') {
    const result = empty();
    result.unknowns.push({
      code: 'responder_role_unavailable',
      message: 'This need has no established affected role, so responder assembly cannot responsibly name players.',
    });
    return result;
  }

  const state = organizationRosterTransactionState(need.organizationId);
  const developmentGates = new Map(mlbDiscussionDevelopmentGates(need.organizationId).map((gate) => [gate.playerId, gate]));
  const result = empty();
  result.unknowns.push(...state.unknowns, ...state.capacity.unknowns);

  for (const player of state.players) {
    const roleFit = defensiveFit(player, need.role);
    if (player.activeMlb === true) {
      if (roleFit && available(player)) result.activeRosterResponders.push(responder(player, 'active_mlb', roleFit, null));
      continue;
    }
    if (player.teamLevel === null || player.teamLevel <= 1) continue;
    const gate = developmentGates.get(player.playerId) ?? null;
    if (player.teamLevel !== 2) {
      result.minorLeagueExclusions.push(exclusion(
        player,
        'lower_level_not_evaluated_for_mlb',
        gate,
        'The current Player Development MLB discussion gate is limited to AAA → MLB; lower-level players are not promoted into this discussion automatically.'
      ));
      continue;
    }
    if (!available(player)) {
      result.minorLeagueExclusions.push(exclusion(player, 'unavailable', gate, 'Current normalized roster/health state makes the player unavailable for an ordinary response.'));
      continue;
    }
    if (!roleFit) {
      result.minorLeagueExclusions.push(exclusion(player, 'role_fit_not_established', gate, 'No exported primary role or visible fielding rating establishes fit for this MLB need.'));
      continue;
    }
    if (gate && !gate.eligible) {
      result.minorLeagueExclusions.push(exclusion(player, 'developmentally_prohibited', gate, 'Player Development does not currently support an AAA → MLB discussion.'));
      continue;
    }
    result.minorLeagueCallUpResponders.push(responder(player, 'minor_league_call_up', roleFit, gate
      ? { status: 'approved', gate, message: 'Player Development independently supports an AAA → MLB discussion.' }
      : {
          status: 'not_applicable', gate: null,
          message: 'No current prospect-development MLB assessment applies; this AAA organizational depth player is not silently excluded on prospect status alone.',
        }));
  }

  // Stable API order only. It conveys no preference, quality judgment, or ease
  // of transaction; later phases must not treat it as a ranking.
  const byPlayerId = (a: InternalResponder, b: InternalResponder) => a.playerId - b.playerId;
  result.activeRosterResponders.sort(byPlayerId);
  result.minorLeagueCallUpResponders.sort(byPlayerId);
  result.minorLeagueExclusions.sort((a, b) => a.playerId - b.playerId);
  return result;
}
