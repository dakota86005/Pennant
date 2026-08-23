/**
 * Read-only context for a future Major League Operations workflow.
 *
 * Major League Operations consumes the shared roster/transaction-state engine;
 * it does not reinterpret OOTP status fields or transaction rules itself.
 */

import { serviceRemainingThisSeason } from './contracts.js';
import { db, tableColumns, tableExists } from './db.js';
import {
  organizationRosterTransactionState,
  type PlayerRosterState,
  type RosterStateUnknown,
} from './rosterTransactionState.js';
import type { Health, Standing } from './health.js';
import {
  latestRosterStateSnapshot,
  rosterStateEventsForSave,
  rosterStateSnapshotById,
  type PersistentRosterState,
  type RosterCausalEvidence,
  type StructuredRosterEvent,
} from './rosterStateHistory.js';

export type MajorLeagueOperationsGapCode = string;

export interface MajorLeagueOperationsGap {
  code: MajorLeagueOperationsGapCode;
  message: string;
  playerId?: number;
}

export interface MajorLeagueRosterPlayerFacts {
  playerId: number;
  name: string;
  age: number | null;
  teamId: number | null;
  teamLevel: number | null;
  position: number | null;
  role: number | null;
  roster: { active: boolean | null; fortyMan: boolean | null; health: Health | null; standing: Standing | null };
  serviceTime: { years: number | null; days: number | null; daysThisSeason: number | null };
  transactionStatus: {
    designatedForAssignment: boolean | null;
    daysOnDfaLeft: number | null;
    onWaivers: boolean | null;
    daysOnWaiversLeft: number | null;
    optionsUsed: number | null;
    yearsProtectedFromRule5: number | null;
    professionalServiceYears: number | null;
  };
}

export interface MajorLeagueRosterContext {
  organization: { orgId: number; label: string; leagueId: number | null } | null;
  known: {
    activeRosterCount: number | null;
    fortyManCount: number | null;
    players: MajorLeagueRosterPlayerFacts[];
    serviceTimeRemainingThisSeason: number | null;
  };
  transactionUnknowns: MajorLeagueOperationsGap[];
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

const toFacts = (player: PlayerRosterState): MajorLeagueRosterPlayerFacts => ({
  playerId: player.playerId,
  name: player.name,
  age: player.age,
  teamId: player.teamId,
  teamLevel: player.teamLevel,
  position: player.position,
  role: player.role,
  roster: { active: player.activeMlb, fortyMan: player.fortyMan, health: player.health, standing: player.standing },
  serviceTime: {
    years: player.serviceTime.mlbYears,
    days: player.serviceTime.mlbDays,
    daysThisSeason: player.serviceTime.mlbDaysThisSeason,
  },
  transactionStatus: {
    designatedForAssignment: player.transaction.designatedForAssignment,
    daysOnDfaLeft: player.transaction.daysOnDfaLeft,
    onWaivers: player.transaction.onWaivers,
    daysOnWaiversLeft: player.transaction.daysOnWaiversLeft,
    optionsUsed: player.transaction.optionsUsed,
    yearsProtectedFromRule5: player.transaction.yearsProtectedFromRule5,
    professionalServiceYears: player.serviceTime.professionalYears,
  },
});

const toGap = (unknown: RosterStateUnknown): MajorLeagueOperationsGap => unknown;

/**
 * Context adapter retained for the Phase 1A boundary. New MLB features should
 * take action answers from rosterTransactionState rather than recreate rules.
 */
export function majorLeagueRosterContext(orgId: number): MajorLeagueRosterContext {
  const noContext = (gaps: MajorLeagueOperationsGap[]): MajorLeagueRosterContext => ({
    organization: null,
    known: { activeRosterCount: null, fortyManCount: null, players: [], serviceTimeRemainingThisSeason: null },
    transactionUnknowns: gaps,
    scoutingValuePolicy: 'prohibited_pending_provenance',
  });
  const teamColumns = new Set(tableColumns('teams'));
  if (!tableExists('teams') || !['team_id', 'level', 'name', 'nickname', 'league_id'].every((column) => teamColumns.has(column))) {
    return noContext([{ code: 'organization_not_found', message: 'The imported team data cannot resolve an MLB organization.' }]);
  }
  const team = db.prepare('SELECT name, nickname, league_id FROM teams WHERE team_id = ? AND level = 1').get(orgId) as
    | { name: string | null; nickname: string | null; league_id: number | null }
    | undefined;
  if (!team) return noContext([{ code: 'organization_not_found', message: 'The requested organization is not an imported MLB club.' }]);
  const label = team.name === team.nickname || !team.nickname ? (team.name ?? `Organization ${orgId}`) : `${team.name ?? ''} ${team.nickname}`.trim();
  const shared = organizationRosterTransactionState(orgId);
  const stateUnknowns = [...shared.unknowns, ...shared.capacity.unknowns].map(toGap);
  const playerUnknowns = shared.players.flatMap((player) => player.unknowns.map((unknown) => ({ ...toGap(unknown), playerId: player.playerId })));
  const hasServiceProgress = tableExists('players_roster_status') && tableColumns('players_roster_status').includes('mlb_service_days_this_year');
  return {
    organization: { orgId, label, leagueId: team.league_id },
    known: {
      activeRosterCount: shared.capacity.active.count,
      fortyManCount: shared.capacity.fortyMan.count,
      players: shared.players.map(toFacts),
      serviceTimeRemainingThisSeason: hasServiceProgress ? serviceRemainingThisSeason() : null,
    },
    transactionUnknowns: [
      ...stateUnknowns,
      ...playerUnknowns,
      ...(shared.capacity.active.limit === null
        ? [{ code: 'active_roster_limit_not_modeled', message: 'The active-roster count is known when exported, but its league limit is unavailable.' }]
        : []),
      ...(shared.capacity.fortyMan.limit === null
        ? [{ code: 'secondary_roster_limit_not_modeled', message: 'The secondary/40-man count is known when exported, but its league limit is unavailable.' }]
        : []),
      { code: 'transaction_rules_not_modeled', message: 'Recall, option, waiver, DFA, injured-list, and Rule 5 transaction sequences are evaluated only by the shared action engine; this context does not simulate them.' },
      { code: 'option_eligibility_not_derivable', message: 'Options used is context only; it does not establish present option eligibility or a waiver requirement.' },
      { code: 'rule5_eligibility_not_derivable', message: 'Rule 5 protection years and professional service are context only; they do not establish a complete Rule 5 consequence.' },
    ],
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
}

/**
 * Read-only, reactive MLB roster needs. A need is a current operational
 * problem validated against today's imported roster, not another name for a
 * historical roster event and never a recommendation for who should solve it.
 */
export type MajorLeagueNeedCategory = 'active_roster_capacity' | 'role_coverage';
export type MajorLeagueNeedCause = 'injury' | 'trade' | 'availability_loss_unknown';
export type MajorLeagueNeedHorizon =
  | { kind: 'temporary'; expectedDays: number; evidence: RosterCausalEvidence[] }
  | { kind: 'structural' }
  | { kind: 'unknown' };

export interface MajorLeagueNeedRole {
  kind: 'starting_pitcher' | 'relief_pitcher' | 'position' | 'unknown';
  position: number | null;
  label: string;
  provenance: 'observed' | 'unknown';
}

export interface MajorLeagueNeedEvidence {
  kind: 'roster_transition' | 'causal_event' | 'current_roster_capacity';
  provenance: 'observed' | 'explicit' | 'corroborated';
  details: Record<string, unknown>;
}

export interface MajorLeagueNeed {
  id: string;
  organizationId: number;
  mlbTeamId: number;
  category: MajorLeagueNeedCategory;
  role: MajorLeagueNeedRole | null;
  causalPlayer: { playerId: number; name: string } | null;
  cause: { kind: MajorLeagueNeedCause; provenance: 'corroborated' | 'unknown' } | null;
  detectedAt: string | null;
  status: 'open';
  lifecycle: 'opened_in_latest_snapshot' | 'continuing';
  horizon: MajorLeagueNeedHorizon;
  evidence: MajorLeagueNeedEvidence[];
  unknowns: MajorLeagueOperationsGap[];
}

export interface MajorLeagueReactiveNeedReport {
  organization: MajorLeagueRosterContext['organization'];
  needs: MajorLeagueNeed[];
  /** Derived identities no longer open under current roster state. */
  resolvedNeedIds: string[];
  unknowns: MajorLeagueOperationsGap[];
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

const POSITION_LABELS: Record<number, string> = {
  2: 'catcher', 3: 'first baseman', 4: 'second baseman', 5: 'third baseman',
  6: 'shortstop', 7: 'left fielder', 8: 'center fielder', 9: 'right fielder', 10: 'designated hitter',
};
const ROLE_STARTER = 11;

function roleOf(state: Pick<PersistentRosterState, 'position' | 'role'>): MajorLeagueNeedRole {
  if (state.position === 1) {
    return state.role === ROLE_STARTER
      ? { kind: 'starting_pitcher', position: 1, label: 'starting pitcher', provenance: 'observed' }
      : { kind: 'relief_pitcher', position: 1, label: 'relief pitcher', provenance: 'observed' };
  }
  if (state.position !== null && POSITION_LABELS[state.position]) {
    return { kind: 'position', position: state.position, label: POSITION_LABELS[state.position], provenance: 'observed' };
  }
  return { kind: 'unknown', position: state.position, label: 'unresolved role', provenance: 'unknown' };
}

function activeAndAvailable(player: PlayerRosterState): boolean {
  return player.activeMlb === true && player.health?.playable !== false &&
    player.transaction.onIl !== true && player.transaction.onIl60 !== true;
}

function coversRole(player: PlayerRosterState, role: MajorLeagueNeedRole): boolean {
  if (!activeAndAvailable(player)) return false;
  if (role.kind === 'starting_pitcher') return player.position === 1 && player.role === ROLE_STARTER;
  if (role.kind === 'relief_pitcher') return player.position === 1 && player.role !== ROLE_STARTER;
  return role.kind === 'position' && player.position === role.position;
}

function transitionSaysAvailabilityLost(event: StructuredRosterEvent): boolean {
  const changes = event.transition.changes;
  return changes.some((change) => change.field === 'activeMlb' && change.before === true && change.after === false) ||
    changes.some((change) => change.field === 'organizationId') ||
    changes.some((change) => change.field === 'onIl' && change.before === false && change.after === true) ||
    changes.some((change) => change.field === 'onIl60' && change.before === false && change.after === true);
}

function eventCause(event: StructuredRosterEvent): MajorLeagueNeed['cause'] {
  if (event.causalCorrelation.conclusion === 'trade_associated_organization_change') {
    return { kind: 'trade', provenance: 'corroborated' };
  }
  if (event.causalCorrelation.conclusion === 'injury_associated_il_change') {
    return { kind: 'injury', provenance: 'corroborated' };
  }
  return { kind: 'availability_loss_unknown', provenance: 'unknown' };
}

function horizonOf(event: StructuredRosterEvent): MajorLeagueNeedHorizon {
  if (event.causalCorrelation.conclusion === 'trade_associated_organization_change') return { kind: 'structural' };
  if (event.causalCorrelation.conclusion === 'injury_associated_il_change') {
    const expectedDays = event.causalCorrelation.evidence
      .map((item) => item.event.details.length)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (expectedDays !== undefined) return { kind: 'temporary', expectedDays, evidence: event.causalCorrelation.evidence };
  }
  return { kind: 'unknown' };
}

function evidenceOf(event: StructuredRosterEvent): MajorLeagueNeedEvidence[] {
  return [
    {
      kind: 'roster_transition', provenance: 'observed',
      details: {
        snapshotId: event.transition.snapshotId,
        priorSnapshotId: event.transition.priorSnapshotId,
        changes: event.transition.changes,
      },
    },
    ...event.causalCorrelation.evidence.map((item) => ({
      kind: 'causal_event' as const,
      provenance: item.provenance,
      details: { source: item.event.source, date: item.event.date, ...item.event.details },
    })),
  ];
}

function unavailableToOrganization(player: PlayerRosterState | undefined, orgId: number): boolean {
  return !player || player.organizationId !== orgId || !activeAndAvailable(player);
}

/**
 * Derive the unresolved reactive workload for an MLB club from roster history
 * and current normalized state. No needs are persisted: the stable IDs make a
 * continuing item recognizable, and re-validating against current coverage is
 * what closes stale historical losses safely.
 */
export function majorLeagueReactiveNeeds(orgId: number): MajorLeagueReactiveNeedReport {
  const context = majorLeagueRosterContext(orgId);
  if (!context.organization) return {
    organization: null,
    needs: [],
    resolvedNeedIds: [],
    unknowns: context.transactionUnknowns,
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
  const current = organizationRosterTransactionState(orgId);
  const latest = latestRosterStateSnapshot();
  const unknowns = [...context.transactionUnknowns];
  const needs: MajorLeagueNeed[] = [];
  const resolvedNeedIds: string[] = [];
  const activeCapacity = current.capacity.active;
  if (activeCapacity.count !== null && activeCapacity.limit !== null && activeCapacity.count < activeCapacity.limit) {
    needs.push({
      id: `mlb:${orgId}:active-roster-capacity`, organizationId: orgId, mlbTeamId: orgId,
      category: 'active_roster_capacity', role: null, causalPlayer: null, cause: null,
      detectedAt: latest?.observedAt ?? null, status: 'open', lifecycle: 'continuing', horizon: { kind: 'unknown' },
      evidence: [{
        kind: 'current_roster_capacity', provenance: 'observed',
        details: { activeRosterCount: activeCapacity.count, activeRosterLimit: activeCapacity.limit },
      }],
      unknowns: [],
    });
  } else if (activeCapacity.count === null || activeCapacity.limit === null) {
    unknowns.push({ code: 'active_roster_capacity_unknown', message: 'The imported active-roster count or limit cannot establish whether an opening exists.' });
  }

  const currentByPlayer = new Map(current.players.map((player) => [player.playerId, player]));
  const priorSnapshots = new Map<number, ReturnType<typeof rosterStateSnapshotById>>();
  const candidates = rosterStateEventsForSave()
    .filter((event) => transitionSaysAvailabilityLost(event))
    .flatMap((event) => {
      const priorId = event.transition.priorSnapshotId;
      if (!priorSnapshots.has(priorId)) priorSnapshots.set(priorId, rosterStateSnapshotById(priorId));
      const prior = priorSnapshots.get(priorId)?.players.find((player) => player.playerId === event.transition.playerId);
      if (!prior || prior.organizationId !== orgId || prior.teamLevel !== 1 || prior.activeMlb !== true) return [];
      return [{ event, prior }];
    });

  // One ongoing incident per player/role. A later loss after a return is a new
  // incident; repeated imports of the same loss retain the existing identity.
  const latestCandidate = new Map<string, { event: StructuredRosterEvent; prior: PersistentRosterState }>();
  for (const candidate of candidates) {
    const role = roleOf(candidate.prior);
    const key = `${candidate.event.transition.playerId}:${role.kind}:${role.position ?? 'unknown'}`;
    const existing = latestCandidate.get(key);
    if (!existing || candidate.event.transition.snapshotId > existing.event.transition.snapshotId) latestCandidate.set(key, candidate);
  }

  for (const { event, prior } of latestCandidate.values()) {
    const role = roleOf(prior);
    const identity = `mlb:${orgId}:role-coverage:${event.transition.playerId}:${role.kind}:${role.position ?? 'unknown'}:${event.transition.snapshotId}`;
    const currentPlayer = currentByPlayer.get(event.transition.playerId);
    if (!unavailableToOrganization(currentPlayer, orgId)) {
      resolvedNeedIds.push(identity);
      continue;
    }
    if (role.kind === 'unknown') {
      unknowns.push({ code: 'affected_role_unknown', playerId: prior.playerId, message: `The observed MLB availability loss for ${prior.name} has no reliable exported role or position.` });
      continue;
    }
    if (current.players.some((player) => coversRole(player, role))) {
      resolvedNeedIds.push(identity);
      continue;
    }
    needs.push({
      id: identity, organizationId: orgId, mlbTeamId: orgId, category: 'role_coverage', role,
      causalPlayer: { playerId: prior.playerId, name: prior.name }, cause: eventCause(event),
      detectedAt: event.transition.firstObservedAt, status: 'open',
      lifecycle: latest?.id === event.transition.snapshotId ? 'opened_in_latest_snapshot' : 'continuing',
      horizon: horizonOf(event), evidence: evidenceOf(event), unknowns: [],
    });
  }
  return { organization: context.organization, needs, resolvedNeedIds, unknowns, scoutingValuePolicy: 'prohibited_pending_provenance' };
}
