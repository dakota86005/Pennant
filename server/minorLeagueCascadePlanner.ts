/**
 * Bounded, read-only organizational assignment search for Minor League
 * Operations. The planner deliberately works from Player Development's
 * existing assignment evaluations and the shared affiliate-health evaluator;
 * neither a roster shortage nor philosophy can make an assignment defensible.
 */

import { gloves, POSITION_CODES } from './gloves.js';
import {
  computeMinorLeagueRosterHealth,
  type AffiliateRosterHealth,
  type RosterHealthStatus,
} from './minorLeagueRoster.js';
import { evaluatePitcherDevelopmentalRole } from './destinationFit.js';
import { resolvePhilosophy } from './philosophy.js';
import { philosophyForOrg } from './settings.js';
import { organizationRosterTransactionState, type PlayerRosterState } from './rosterTransactionState.js';
import { normalizedPitchingRole } from './pitchingRole.js';

export const MINOR_LEAGUE_CASCADE_LIMITS = {
  maxDepth: 3,
  maxExploredStates: 160,
  maxPlans: 8,
  maxActionsPerState: 24,
} as const;

export interface MinorLeagueCascadeProspectData {
  batters: unknown[];
  pitchers: unknown[];
}

export interface MinorLeagueCascadeInput {
  orgId: number;
  /** The initial MLB recall or another read-only farm perturbation. */
  removePlayerIds?: number[];
  assignments?: Array<{ playerId: number; teamId: number }>;
  prospectData?: MinorLeagueCascadeProspectData;
  /** Normal Operations starts from current deficiencies; consequence analysis starts from a perturbation. */
  problemScope?: 'current' | 'scenario_induced';
  limits?: Partial<typeof MINOR_LEAGUE_CASCADE_LIMITS>;
}

export type MinorLeagueCascadeProblemKind =
  | 'position_coverage'
  | 'position_player_body'
  | 'fieldable_defense'
  | 'pitcher_body'
  | 'rotation'
  | 'bullpen'
  | 'roster_capacity';

export interface MinorLeagueCascadeProblem {
  id: string;
  teamId: number;
  team: string;
  kind: MinorLeagueCascadeProblemKind;
  role: { kind: 'position'; position: number; label: string } | { kind: 'starting_pitcher' | 'relief_pitcher'; label: string } | null;
  baseline: RosterHealthStatus | number;
  current: RosterHealthStatus | number;
  message: string;
}

export interface MinorLeagueCascadeMove {
  playerId: number;
  playerName: string;
  kind: 'same_level_reassignment' | 'normal_promotion' | 'skip_level_promotion' | 'demotion';
  from: { teamId: number; team: string; level: number };
  to: { teamId: number; team: string; level: number };
  role: string;
  development: {
    status: 'authorized' | 'not_applicable';
    recommendation: string | null;
    reasons: string[];
    destinationFit: unknown | null;
  };
}

export interface MinorLeagueCascadePreference {
  status: 'preferred' | 'tied' | 'alternative';
  reasons: Array<{ dimension: 'promotionAggressiveness' | 'versatility' | 'rosterDepth'; direction: 'supports' | 'neutral' | 'does_not_distinguish'; message: string }>;
}

export interface MinorLeagueCascadePlan {
  status: 'complete' | 'partial' | 'truncated';
  depth: number;
  moves: MinorLeagueCascadeMove[];
  resolvedProblems: MinorLeagueCascadeProblem[];
  unresolvedProblems: MinorLeagueCascadeProblem[];
  preference: MinorLeagueCascadePreference;
  stateId: string;
}

export interface MinorLeagueCascadeResult {
  orgId: number;
  status: 'complete' | 'partial' | 'indeterminate' | 'truncated';
  baseline: AffiliateRosterHealth[];
  initial: AffiliateRosterHealth[];
  initialProblems: MinorLeagueCascadeProblem[];
  plans: MinorLeagueCascadePlan[];
  bounds: {
    maxDepth: number;
    maxExploredStates: number;
    maxPlans: number;
    maxActionsPerState: number;
    exploredStates: number;
    duplicateStatesSkipped: number;
    searchTruncated: boolean;
  };
  philosophy: {
    promotionAggressiveness: number;
    versatility: number;
    rosterDepth: number;
  };
  unknowns: Array<{ code: string; message: string }>;
  safeguards: string[];
}

interface AssignmentEvaluationLike {
  kind: 'normal_promotion' | 'skip_level_promotion' | 'demotion' | 'mlb_discussion';
  eligible: boolean;
  recommendation: string;
  target: { isMajorLeague: boolean; teams: Array<{ teamId: number; label: string }> };
  reasons: string[];
  blockers: string[];
  destinationFit?: unknown;
}

interface ProspectLike {
  player_id?: unknown;
  assignments?: { evaluations?: AssignmentEvaluationLike[] };
}

interface Candidate extends MinorLeagueCascadeMove {
  targetTeamId: number;
  secondaryPosition: boolean;
}

interface SearchNode {
  assignments: Map<number, number>;
  moves: MinorLeagueCascadeMove[];
  health: AffiliateRosterHealth[];
  problems: MinorLeagueCascadeProblem[];
  stateId: string;
}

const severity = (status: RosterHealthStatus): number => status === 'critical' ? 2 : status === 'thin' ? 1 : 0;
const problemSeverity = (problem: MinorLeagueCascadeProblem): number => {
  if (typeof problem.current !== 'number') return severity(problem.current);
  return problem.kind === 'fieldable_defense' ? -problem.current : problem.current;
};
const usable = (player: PlayerRosterState): boolean => player.health?.playable !== false && player.transaction.onIl !== true && player.transaction.onIl60 !== true && player.transaction.designatedForAssignment !== true && player.transaction.onWaivers !== true;
const normalize = (value: number): number => Math.max(-1, Math.min(1, (value - 50) / 50));

function healthByTeam(health: AffiliateRosterHealth[]): Map<number, AffiliateRosterHealth> {
  return new Map(health.map((team) => [team.teamId, team]));
}

function problemSet(baseline: AffiliateRosterHealth[], current: AffiliateRosterHealth[]): MinorLeagueCascadeProblem[] {
  const base = healthByTeam(baseline);
  const problems: MinorLeagueCascadeProblem[] = [];
  for (const team of current) {
    const prior = base.get(team.teamId);
    if (!prior) continue;
    const addStatus = (
      kind: MinorLeagueCascadeProblemKind,
      id: string,
      before: RosterHealthStatus,
      after: RosterHealthStatus,
      role: MinorLeagueCascadeProblem['role'],
      message: string,
    ) => {
      if (severity(after) > severity(before)) problems.push({ id, teamId: team.teamId, team: team.label, kind, role, baseline: before, current: after, message });
    };
    for (const coverage of team.positionPlayers.coverage) {
      const old = prior.positionPlayers.coverage.find((item) => item.position === coverage.position);
      if (!old) continue;
      const position = POSITION_CODES.indexOf(coverage.position as typeof POSITION_CODES[number]) + 1;
      addStatus('position_coverage', `${team.teamId}:position:${coverage.position}`, old.status, coverage.status,
        position > 0 ? { kind: 'position', position, label: coverage.position } : null,
        `${team.label} ${coverage.position} coverage changed from ${old.status} to ${coverage.status}.`);
    }
    addStatus('position_player_body', `${team.teamId}:position-body`, prior.positionPlayers.bodyCountStatus, team.positionPlayers.bodyCountStatus, null,
      `${team.label} position-player body count worsened from ${prior.positionPlayers.bodyCountStatus} to ${team.positionPlayers.bodyCountStatus}.`);
    if (team.positionPlayers.fieldablePositions < prior.positionPlayers.fieldablePositions) {
      problems.push({ id: `${team.teamId}:fieldable-defense`, teamId: team.teamId, team: team.label, kind: 'fieldable_defense', role: null,
        baseline: prior.positionPlayers.fieldablePositions, current: team.positionPlayers.fieldablePositions,
        message: `${team.label} can fill ${team.positionPlayers.fieldablePositions} rather than ${prior.positionPlayers.fieldablePositions} defensive positions.` });
    }
    addStatus('pitcher_body', `${team.teamId}:pitcher-body`, prior.pitching.bodyCountStatus, team.pitching.bodyCountStatus, null,
      `${team.label} pitcher body count worsened from ${prior.pitching.bodyCountStatus} to ${team.pitching.bodyCountStatus}.`);
    addStatus('rotation', `${team.teamId}:rotation`, prior.pitching.rotationStatus, team.pitching.rotationStatus,
      { kind: 'starting_pitcher', label: 'starting pitcher' }, `${team.label} rotation changed from ${prior.pitching.rotationStatus} to ${team.pitching.rotationStatus}.`);
    addStatus('bullpen', `${team.teamId}:bullpen`, prior.pitching.bullpenStatus, team.pitching.bullpenStatus,
      { kind: 'relief_pitcher', label: 'relief pitcher' }, `${team.label} bullpen changed from ${prior.pitching.bullpenStatus} to ${team.pitching.bullpenStatus}.`);
    const priorExcess = prior.roster.capacity.excess ?? 0;
    const currentExcess = team.roster.capacity.excess ?? 0;
    if (team.roster.capacity.status === 'over_capacity' && currentExcess > priorExcess) {
      problems.push({
        id: `${team.teamId}:roster-capacity`, teamId: team.teamId, team: team.label, kind: 'roster_capacity', role: null,
        baseline: priorExcess, current: currentExcess,
        message: `${team.label} exceeds its exported active-roster limit by ${currentExcess} player${currentExcess === 1 ? '' : 's'}; an outgoing assignment, release, or other transaction remains unresolved.`,
      });
    }
  }
  return problems.sort((left, right) => left.id.localeCompare(right.id));
}

function healthyComparisonBaseline(health: AffiliateRosterHealth[]): AffiliateRosterHealth[] {
  return health.map((team) => ({
    ...team,
    positionPlayers: {
      ...team.positionPlayers,
      bodyCountStatus: 'healthy' as const,
      fieldablePositions: Math.max(8, team.positionPlayers.fieldablePositions),
      canFieldDefense: true,
      coverage: team.positionPlayers.coverage.map((coverage) => ({ ...coverage, status: 'healthy' as const })),
    },
    pitching: {
      ...team.pitching,
      bodyCountStatus: 'healthy' as const,
      rotationStatus: 'healthy' as const,
      bullpenStatus: 'healthy' as const,
    },
    roster: {
      ...team.roster,
      capacity: team.roster.capacity.status === 'over_capacity'
        ? { ...team.roster.capacity, openSlots: 0, excess: 0, status: 'within_limit' as const }
        : team.roster.capacity,
    },
  }));
}

function stateId(assignments: Map<number, number>, removed: number[]): string {
  return `${[...assignments.entries()].sort((a, b) => a[0] - b[0]).map(([playerId, teamId]) => `${playerId}:${teamId}`).join(',')}|remove:${[...removed].sort((a, b) => a - b).join(',')}`;
}

function playerFits(player: PlayerRosterState, role: MinorLeagueCascadeProblem['role']): { fits: boolean; secondary: boolean; label: string } {
  if (!role) return { fits: false, secondary: false, label: 'unmodeled roster structure' };
  if (role.kind === 'position') {
    if (player.position === role.position) return { fits: true, secondary: false, label: role.label };
    const rating = gloves(player.playerId)?.positions.find((position) => position.position === role.position);
    return { fits: (rating?.current ?? 0) >= 35, secondary: (rating?.current ?? 0) >= 35, label: role.label };
  }
  if (player.position !== 1) return { fits: false, secondary: false, label: role.label };
  const developmental = evaluatePitcherDevelopmentalRole(player.playerId)?.developmentalRole;
  const assigned = normalizedPitchingRole(player.position, player.role);
  const starter = developmental ?? (assigned === 'starting_pitcher' ? 'starter' : assigned === 'relief_pitcher' ? 'reliever' : null);
  if (!starter) return { fits: false, secondary: false, label: role.label };
  return { fits: role.kind === 'starting_pitcher' ? starter === 'starter' : starter === 'reliever', secondary: false, label: role.label };
}

function hasOpenCapacity(destination: AffiliateRosterHealth): boolean {
  const capacity = destination.roster.capacity;
  return capacity.status === 'unlimited' || (capacity.status === 'within_limit' && (capacity.openSlots ?? 0) > 0);
}

function candidatesFor(
  orgId: number,
  node: SearchNode,
  problems: MinorLeagueCascadeProblem[],
  state: PlayerRosterState[],
  prospectData: MinorLeagueCascadeProspectData
): Candidate[] {
  const teams = healthByTeam(node.health);
  const candidates: Candidate[] = [];
  const moved = new Set(node.moves.map((move) => move.playerId));
  const assessed = new Set<number>();
  const prospectRows = [...prospectData.batters, ...prospectData.pitchers].map((item) => item as ProspectLike);

  for (const prospect of prospectRows) {
    if (typeof prospect.player_id !== 'number') continue;
    assessed.add(prospect.player_id);
    const player = state.find((item) => item.playerId === prospect.player_id);
    const sourceId = player ? node.assignments.get(player.playerId) ?? player.teamId : null;
    if (!player || sourceId === null || !usable(player) || moved.has(player.playerId)) continue;
    for (const evaluation of prospect.assignments?.evaluations ?? []) {
      if (!evaluation.eligible || evaluation.target.isMajorLeague || evaluation.kind === 'mlb_discussion') continue;
      for (const target of evaluation.target.teams) {
        const destination = teams.get(target.teamId);
        const source = teams.get(sourceId);
        if (!destination || !source || target.teamId === sourceId) continue;
        const destinationProblems = problems.filter((item) => item.teamId === target.teamId);
        const sourceCapacityProblem = problems.find((item) => item.teamId === sourceId && item.kind === 'roster_capacity');
        const applicableProblems = [
          ...destinationProblems,
          ...(sourceCapacityProblem && hasOpenCapacity(destination) ? [sourceCapacityProblem] : []),
        ];
        for (const problem of applicableProblems) {
          if (problem.kind === 'roster_capacity') {
            candidates.push({
              playerId: player.playerId, playerName: player.name, kind: evaluation.kind,
              from: { teamId: source.teamId, team: source.label, level: source.level },
              to: { teamId: destination.teamId, team: destination.label, level: destination.level },
              role: 'roster capacity', targetTeamId: target.teamId, secondaryPosition: false,
              development: { status: 'authorized', recommendation: evaluation.recommendation, reasons: evaluation.reasons, destinationFit: evaluation.destinationFit ?? null },
            });
            continue;
          }
          const fit = playerFits(player, problem.role);
          if (!fit.fits) continue;
          candidates.push({
            playerId: player.playerId, playerName: player.name, kind: evaluation.kind,
            from: { teamId: source.teamId, team: source.label, level: source.level },
            to: { teamId: destination.teamId, team: destination.label, level: destination.level },
            role: fit.label, targetTeamId: target.teamId, secondaryPosition: fit.secondary,
            development: { status: 'authorized', recommendation: evaluation.recommendation, reasons: evaluation.reasons, destinationFit: evaluation.destinationFit ?? null },
          });
        }
      }
    }
  }

  // Existing operations treats unevaluated organizational depth as a valid
  // same-level balancing population. It is not promoted merely for need.
  for (const player of state) {
    if (assessed.has(player.playerId) || !usable(player) || moved.has(player.playerId)) continue;
    const sourceId = node.assignments.get(player.playerId) ?? player.teamId;
    const source = sourceId === null ? undefined : teams.get(sourceId);
    if (!source) continue;
    for (const problem of problems) {
      const destination = teams.get(problem.teamId);
      const fit = playerFits(player, problem.role);
      if (!destination || destination.teamId === source.teamId || destination.level !== source.level || !fit.fits) continue;
      candidates.push({
        playerId: player.playerId, playerName: player.name, kind: 'same_level_reassignment',
        from: { teamId: source.teamId, team: source.label, level: source.level },
        to: { teamId: destination.teamId, team: destination.label, level: destination.level },
        role: fit.label, targetTeamId: destination.teamId, secondaryPosition: fit.secondary,
        development: { status: 'not_applicable', recommendation: null, reasons: ['Unevaluated organizational depth may be considered only for a same-level reassignment.'], destinationFit: null },
      });
    }
    if (problems.some((problem) => problem.teamId === source.teamId && problem.kind === 'roster_capacity')) {
      for (const destination of teams.values()) {
        if (destination.teamId === source.teamId || destination.level !== source.level || !hasOpenCapacity(destination)) continue;
        candidates.push({
          playerId: player.playerId, playerName: player.name, kind: 'same_level_reassignment',
          from: { teamId: source.teamId, team: source.label, level: source.level },
          to: { teamId: destination.teamId, team: destination.label, level: destination.level },
          role: 'roster capacity', targetTeamId: destination.teamId, secondaryPosition: false,
          development: { status: 'not_applicable', recommendation: null, reasons: ['Unevaluated organizational depth may be considered only for a same-level reassignment that relieves an exported roster-capacity violation.'], destinationFit: null },
        });
      }
    }
  }
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) unique.set(`${candidate.playerId}:${candidate.targetTeamId}:${candidate.kind}`, candidate);
  return [...unique.values()].sort((left, right) =>
    left.to.teamId - right.to.teamId || left.playerId - right.playerId || left.kind.localeCompare(right.kind));
}

function preference(moves: MinorLeagueCascadeMove[], unresolved: number, philosophy: MinorLeagueCascadeResult['philosophy']): { priority: number; reasons: MinorLeagueCascadePreference['reasons'] } {
  const promotion = normalize(philosophy.promotionAggressiveness);
  const versatility = normalize(philosophy.versatility);
  const skipCount = moves.filter((move) => move.kind === 'skip_level_promotion').length;
  const secondaryCount = moves.filter((move) => move.role !== 'starting pitcher' && move.role !== 'relief pitcher').length;
  const rosterDepth = normalize(philosophy.rosterDepth);
  const priority = promotion * skipCount + versatility * secondaryCount * 0.25 - rosterDepth * unresolved;
  return {
    priority,
    reasons: [
      { dimension: 'promotionAggressiveness', direction: skipCount === 0 ? 'does_not_distinguish' : promotion === 0 ? 'neutral' : 'supports', message: skipCount === 0 ? 'No skip-level assignment distinguishes this plan.' : 'Existing promotion-aggressiveness preference is applied only among Player Development-authorized paths.' },
      { dimension: 'versatility', direction: secondaryCount === 0 ? 'does_not_distinguish' : versatility === 0 ? 'neutral' : 'supports', message: secondaryCount === 0 ? 'No secondary-position coverage distinguishes this plan.' : 'Existing versatility preference recognizes visible multi-position coverage among defensible paths.' },
      { dimension: 'rosterDepth', direction: unresolved === 0 ? 'does_not_distinguish' : rosterDepth === 0 ? 'neutral' : 'supports', message: unresolved === 0 ? 'No unresolved scenario problem distinguishes this plan on roster-depth grounds.' : 'Existing roster-depth preference favors a plan that leaves fewer scenario-induced problems unresolved.' },
    ],
  };
}

/** Plan all scenario-induced farm consequences using a bounded BFS search. */
export function planMinorLeagueCascade(input: MinorLeagueCascadeInput): MinorLeagueCascadeResult {
  const limits = { ...MINOR_LEAGUE_CASCADE_LIMITS, ...input.limits };
  const effective = resolvePhilosophy(philosophyForOrg(input.orgId));
  const philosophy = {
    promotionAggressiveness: effective.dimensions.promotionAggressiveness.value,
    versatility: effective.dimensions.versatility.value,
    rosterDepth: effective.dimensions.rosterDepth.value,
  };
  const state = organizationRosterTransactionState(input.orgId);
  const removed = input.removePlayerIds ?? [];
  const baseline = computeMinorLeagueRosterHealth(input.orgId, { excludeUnavailablePlayers: true });
  const initialAssignments = new Map((input.assignments ?? []).map((assignment) => [assignment.playerId, assignment.teamId]));
  const initial = computeMinorLeagueRosterHealth(input.orgId, { excludeUnavailablePlayers: true, excludePlayerIds: removed, assignments: [...initialAssignments].map(([playerId, teamId]) => ({ playerId, teamId })) });
  const unknowns = [...state.unknowns];
  if (!baseline.length || !initial.length) unknowns.push({ code: 'minor_league_affiliates_unavailable', message: 'The imported organization has no readable minor-league affiliate roster state.' });
  const comparisonBaseline = input.problemScope === 'current' ? healthyComparisonBaseline(initial) : baseline;
  const initialProblems = problemSet(comparisonBaseline, initial);
  if (unknowns.length > 0 && !baseline.length) {
    return { orgId: input.orgId, status: 'indeterminate', baseline, initial, initialProblems, plans: [], bounds: { ...limits, exploredStates: 0, duplicateStatesSkipped: 0, searchTruncated: false }, philosophy, unknowns, safeguards: ['No imported roster data is mutated.'] };
  }
  const initialNode: SearchNode = { assignments: initialAssignments, moves: [], health: initial, problems: initialProblems, stateId: stateId(initialAssignments, removed) };
  const queue: SearchNode[] = [initialNode];
  const seen = new Set([initialNode.stateId]);
  const leaves: Array<{ node: SearchNode; status: MinorLeagueCascadePlan['status'] }> = [];
  let exploredStates = 0;
  let duplicateStatesSkipped = 0;
  let searchTruncated = false;

  while (queue.length > 0 && leaves.length < limits.maxPlans) {
    const node = queue.shift()!;
    exploredStates++;
    if (node.problems.length === 0) {
      leaves.push({ node, status: 'complete' });
      continue;
    }
    if (node.moves.length >= limits.maxDepth) {
      searchTruncated = true;
      leaves.push({ node, status: 'truncated' });
      continue;
    }
    if (exploredStates >= limits.maxExploredStates) {
      searchTruncated = true;
      leaves.push({ node, status: 'truncated' });
      break;
    }
    const availableActions = candidatesFor(input.orgId, node, node.problems, state.players, input.prospectData ?? { batters: [], pitchers: [] });
    if (availableActions.length > limits.maxActionsPerState) searchTruncated = true;
    const actions = availableActions.slice(0, limits.maxActionsPerState);
    let expanded = false;
    for (const action of actions) {
      const assignments = new Map(node.assignments);
      assignments.set(action.playerId, action.targetTeamId);
      const nextId = stateId(assignments, removed);
      if (seen.has(nextId)) { duplicateStatesSkipped++; continue; }
      const nextHealth = computeMinorLeagueRosterHealth(input.orgId, {
        excludeUnavailablePlayers: true,
        excludePlayerIds: removed,
        assignments: [...assignments].map(([playerId, teamId]) => ({ playerId, teamId })),
      });
      const nextProblems = problemSet(comparisonBaseline, nextHealth);
      // Every step has to improve at least one outstanding scenario problem.
      if (!node.problems.some((problem) => {
        const next = nextProblems.find((item) => item.id === problem.id);
        return !next || problemSeverity(next) < problemSeverity(problem);
      })) continue;
      seen.add(nextId);
      expanded = true;
      queue.push({ assignments, moves: [...node.moves, action], health: nextHealth, problems: nextProblems, stateId: nextId });
    }
    if (!expanded) leaves.push({ node, status: 'partial' });
  }
  if (queue.length > 0) searchTruncated = true;
  const plans = leaves
    .map(({ node, status }) => ({ node, status, pref: preference(node.moves, node.problems.length, philosophy) }))
    .sort((left, right) => right.pref.priority - left.pref.priority || left.node.stateId.localeCompare(right.node.stateId))
    .slice(0, limits.maxPlans)
    .map(({ node, status, pref }, index, all) => ({
      status,
      depth: node.moves.length,
      moves: node.moves,
      resolvedProblems: initialProblems.filter((problem) => !node.problems.some((item) => item.id === problem.id)),
      unresolvedProblems: node.problems,
      preference: { status: (all.length > 1 && Math.abs(pref.priority - all[0].pref.priority) < 0.0001 ? 'tied' : index === 0 ? 'preferred' : 'alternative') as MinorLeagueCascadePreference['status'], reasons: pref.reasons },
      stateId: node.stateId,
    }));
  const status: MinorLeagueCascadeResult['status'] = searchTruncated ? 'truncated' : plans.every((plan) => plan.status === 'complete') ? 'complete' : 'partial';
  return {
    orgId: input.orgId, status, baseline, initial, initialProblems, plans,
    bounds: { ...limits, exploredStates, duplicateStatesSkipped, searchTruncated }, philosophy, unknowns,
    safeguards: [
      'Player Development eligibility is required for every level-changing move.',
      'Unevaluated organizational depth is considered only for same-level reassignment.',
      'Only newly created or worsened problems relative to baseline are cascade obligations.',
      'An exported affiliate roster-capacity violation remains unresolved unless a defensible assignment removes the excess; no release or displacement solver is used.',
      'Hypothetical assignments exist only in memory and never modify imported rosters or history.',
      'Search bounds, duplicate-state detection, and one-move-per-player protection prevent unbounded or cyclic plans.',
    ],
  };
}
