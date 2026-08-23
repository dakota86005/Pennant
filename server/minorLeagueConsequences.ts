/**
 * Read-only, first-order Minor League Operations analysis for an MLB recall.
 *
 * This module owns farm coverage interpretation. It deliberately exposes an
 * unranked Player Development-authorized discussion set instead of selecting a
 * replacement or recursively solving assignments across the farm.
 */

import { POSITION_CODES } from './gloves.js';
import {
  computeMinorLeagueRosterHealth,
  type AffiliateRosterHealth,
  type RosterHealthStatus,
} from './minorLeagueRoster.js';
import { computeProspects } from './org.js';
import {
  organizationRosterTransactionState,
  type PlayerRosterState,
} from './rosterTransactionState.js';

export type MinorLeagueCoverageRole =
  | { kind: 'position'; position: number; label: string }
  | { kind: 'starting_pitcher'; label: 'starting pitcher' }
  | { kind: 'relief_pitcher'; label: 'relief pitcher' };

export interface MinorLeagueCoverageProblem {
  sourceTeamId: number;
  role: MinorLeagueCoverageRole;
  before: RosterHealthStatus;
  after: RosterHealthStatus;
}

export interface MinorLeagueDownstreamCandidate {
  playerId: number;
  name: string;
  sourceAssignment: { teamId: number | null; level: number | null };
  assignmentKind: 'normal_promotion' | 'skip_level_promotion';
  development: {
    recommendation: string;
    reasons: string[];
    destinationTeamIds: number[];
  };
}

export interface MinorLeagueDownstreamResponse {
  owner: 'minor_league_operations';
  status:
    | 'not_required'
    | 'discussion_candidates_available'
    | 'no_currently_defensible_response'
    | 'indeterminate';
  candidates: MinorLeagueDownstreamCandidate[];
  cascade: {
    depth: 0;
    status: 'not_simulated';
    reason: string;
  };
  unknowns: Array<{ code: string; message: string }>;
}

export interface HypotheticalAffiliateRemovalAnalysis {
  sourceAffiliate: {
    teamId: number;
    label: string;
    level: number;
    levelName: string;
  };
  removedPlayer: { playerId: number; name: string; role: MinorLeagueCoverageRole };
  before: AffiliateRosterHealth;
  after: AffiliateRosterHealth;
  coverage: {
    before: RosterHealthStatus;
    after: RosterHealthStatus;
    remainsAdequate: boolean;
  };
  operationalProblem: 'none' | 'created' | 'existing_or_worsened';
  downstreamResponse: MinorLeagueDownstreamResponse;
  unknowns: Array<{ code: string; message: string }>;
}

interface ProspectAssignmentLike {
  kind: 'normal_promotion' | 'skip_level_promotion' | 'demotion' | 'mlb_discussion';
  eligible: boolean;
  recommendation: string;
  target: { teams: Array<{ teamId: number }> };
  reasons: string[];
}

interface ProspectLike {
  player_id?: unknown;
  name?: unknown;
  assignments?: { eligible?: ProspectAssignmentLike[] };
}

function available(player: PlayerRosterState): boolean {
  return player.health?.playable !== false && player.transaction.onIl !== true &&
    player.transaction.onIl60 !== true && player.transaction.designatedForAssignment !== true &&
    player.transaction.onWaivers !== true;
}

function sourceRole(player: PlayerRosterState): MinorLeagueCoverageRole | null {
  if (player.position === null) return null;
  if (player.position !== 1) {
    return {
      kind: 'position',
      position: player.position,
      label: POSITION_CODES[player.position - 1] ?? `position ${player.position}`,
    };
  }
  if (player.role === null) return null;
  return player.role === 11
    ? { kind: 'starting_pitcher', label: 'starting pitcher' }
    : { kind: 'relief_pitcher', label: 'relief pitcher' };
}

function coverageStatus(health: AffiliateRosterHealth, role: MinorLeagueCoverageRole): RosterHealthStatus {
  if (role.kind === 'position') {
    return health.positionPlayers.coverage.find((coverage) => coverage.position === role.label)?.status ?? 'critical';
  }
  return role.kind === 'starting_pitcher'
    ? health.pitching.rotationStatus
    : health.pitching.bullpenStatus;
}

function adequate(status: RosterHealthStatus): boolean {
  return status === 'healthy' || status === 'surplus';
}

function roleMatches(player: PlayerRosterState, role: MinorLeagueCoverageRole): boolean {
  if (role.kind === 'position') return player.position === role.position;
  return player.position === 1 && (role.kind === 'starting_pitcher' ? player.role === 11 : player.role !== null && player.role !== 11);
}

function downstreamResponse(
  orgId: number,
  problem: MinorLeagueCoverageProblem | null,
  state: PlayerRosterState[]
): MinorLeagueDownstreamResponse {
  const cascade = {
    depth: 0 as const,
    status: 'not_simulated' as const,
    reason: 'Current Minor League Operations has no safe recursive hypothetical-assignment solver; only the first source-affiliate problem is analyzed.',
  };
  if (!problem) return { owner: 'minor_league_operations', status: 'not_required', candidates: [], cascade, unknowns: [] };

  const prospects = computeProspects(orgId);
  const candidates: MinorLeagueDownstreamCandidate[] = [...prospects.batters, ...prospects.pitchers]
    .flatMap((candidate) => {
      const row = candidate as ProspectLike;
      if (typeof row.player_id !== 'number') return [];
      const player = state.find((item) => item.playerId === row.player_id);
      if (!player || !available(player) || !roleMatches(player, problem.role)) return [];
      return (row.assignments?.eligible ?? [])
        .filter((assignment) =>
          (assignment.kind === 'normal_promotion' || assignment.kind === 'skip_level_promotion') &&
          assignment.target.teams.some((team) => team.teamId === problem.sourceTeamId)
        )
        .map((assignment) => ({
          playerId: player.playerId,
          name: typeof row.name === 'string' ? row.name : player.name,
          sourceAssignment: { teamId: player.teamId, level: player.teamLevel },
          assignmentKind: assignment.kind as 'normal_promotion' | 'skip_level_promotion',
          development: {
            recommendation: assignment.recommendation,
            reasons: assignment.reasons,
            destinationTeamIds: assignment.target.teams.map((team) => team.teamId),
          },
        }));
    })
    .sort((left, right) => left.playerId - right.playerId);

  return {
    owner: 'minor_league_operations',
    status: candidates.length > 0 ? 'discussion_candidates_available' : 'no_currently_defensible_response',
    candidates,
    cascade,
    unknowns: candidates.length > 0 ? [] : [{
      code: 'no_developmentally_defensible_first_response',
      message: 'No available lower-level player has a Player Development-authorized assignment to this source affiliate for the affected role.',
    }],
  };
}

/**
 * Hypothetically remove one available minor leaguer. This is a pure read: no
 * roster assignment, import data, or roster-history observation is changed.
 */
export function analyzeHypotheticalAffiliateRemoval(
  orgId: number,
  playerId: number
): HypotheticalAffiliateRemovalAnalysis | null {
  const transactionState = organizationRosterTransactionState(orgId);
  const player = transactionState.players.find((item) => item.playerId === playerId);
  if (!player || player.teamId === null || player.teamLevel === null || player.teamLevel <= 1) return null;
  const role = sourceRole(player);
  if (!role) return null;

  const scenario = { excludeUnavailablePlayers: true };
  const before = computeMinorLeagueRosterHealth(orgId, scenario).find((team) => team.teamId === player.teamId);
  const after = computeMinorLeagueRosterHealth(orgId, {
    ...scenario,
    excludePlayerIds: [playerId],
  }).find((team) => team.teamId === player.teamId);
  if (!before || !after) return null;

  const beforeCoverage = coverageStatus(before, role);
  const afterCoverage = coverageStatus(after, role);
  const remainsAdequate = adequate(afterCoverage);
  const operationalProblem = remainsAdequate
    ? 'none'
    : adequate(beforeCoverage) ? 'created' : 'existing_or_worsened';
  const problem = operationalProblem === 'none'
    ? null
    : { sourceTeamId: player.teamId, role, before: beforeCoverage, after: afterCoverage };

  return {
    sourceAffiliate: { teamId: before.teamId, label: before.label, level: before.level, levelName: before.levelName },
    removedPlayer: { playerId: player.playerId, name: player.name, role },
    before,
    after,
    coverage: { before: beforeCoverage, after: afterCoverage, remainsAdequate },
    operationalProblem,
    downstreamResponse: downstreamResponse(orgId, problem, transactionState.players),
    unknowns: [
      ...transactionState.unknowns,
      ...player.unknowns,
      ...(player.position === null || (player.position === 1 && player.role === null)
        ? [{ code: 'source_role_unknown', message: 'The imported source position or pitching role is unavailable.' }]
        : []),
    ],
  };
}
