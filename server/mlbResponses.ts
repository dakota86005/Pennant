/**
 * Responses to an operational need: who or what could address it, what each
 * would require, and what follows.
 *
 * This module composes; it decides nothing that a specialist owns. Every stage
 * is a separate verdict from the domain that owns it and stages are never
 * collapsed into a score:
 *
 *   discovery       objective: who exists and could conceivably take the role
 *   availability    Player State (injury, DFA, waivers)
 *   development     Player Development's MLB assessment (or the honest absence of one)
 *   rights          `playerRights.ts`, per required action, three-valued
 *   role fit        Player Development's destination fit at the MLB level
 *   consequences    roster counts; Minor League Operations' scenario; contract facts
 *   philosophy      preference among candidates that passed the stages above; never
 *                   authorizes, never resolves an unknown
 *
 * A candidate that fails a stage stays in the packet, in a group that says
 * which stage and why. Ordering inside a group is stable and non-preferential.
 * Ports (below) are the only path to the specialists so this stays testable
 * without a database and cannot reach around them.
 */

import type { AssignmentContext } from './assignmentContext.js';
import type { CrossRoleSupport, FarmConsequence, PerformanceLine, RoleFitEvidence } from './mlbEvidence.js';
import { ROLE_STANDARDS, type MlbNeed, type NeedFact } from './mlbNeeds.js';
import { activeMembers, type ClubView, type RoleRef, type RosterMember } from './mlbRoster.js';
import type { MlbDiscussionAssessment } from './org.js';
import type {
  ActionRights, MissingEvidence, OptionYears, PlayerRights, RightsReason, RightsRequirement, RightsStatus,
} from './playerRights.js';

// ── ports ───────────────────────────────────────────────────────────────────

export interface PhilosophyValues {
  promotionAggressiveness: number;
  versatility: number;
}

export interface ResponsePorts {
  rights(playerIds: number[]): Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }>;
  /** Player Development's MLB-discussion assessment; null when it has not assessed the player. */
  development(playerId: number): MlbDiscussionAssessment | null;
  crossRole(playerId: number, role: RoleRef): CrossRoleSupport;
  roleFit(playerId: number): RoleFitEvidence;
  performance(playerId: number, level: number | null, isPitcher: boolean): PerformanceLine | null;
  farm(playerId: number, role: RoleRef | null, direction: 'leaves' | 'joins', affiliateTeamId: number | null): FarmConsequence | null;
  /** Where an optioned MLB player would go, when the organization has an affiliate. */
  optionAffiliateTeamId(): number | null;
  philosophy: PhilosophyValues;
}

// ── output types ────────────────────────────────────────────────────────────

export type PathKind = 'role_change' | 'recall' | 'add_to_forty_man';

export type DevelopmentStage =
  | {
      status: 'defensible' | 'indefensible' | 'indeterminate';
      reasons: string[];
      blockers: string[];
      missing: string[];
    }
  /** Player Development has no assessment of this player. Not a pass, not a rejection. */
  | { status: 'unassessed'; message: string }
  /** No assignment changes hands (an active MLB player changing role). */
  | { status: 'not_applicable'; message: string };

export interface PathStep {
  seq: number;
  /** The rights action evaluated, or a description for a step Rights does not evaluate. */
  action: string;
  playerId: number;
  playerName: string;
  status: RightsStatus | 'not_a_transaction' | 'not_evaluated';
  label: string;
  reasons: RightsReason[];
  requirements: RightsRequirement[];
  missing: MissingEvidence[];
  limitation: string | null;
}

export interface TransactionPath {
  /**
   * The path is only as certain as its least certain step: `blocked` if any step
   * is ineligible, else `indeterminate` if any is indeterminate or not
   * evaluated, else `open_with_requirements` if a spot must be made, else `open`.
   */
  status: 'open' | 'open_with_requirements' | 'indeterminate' | 'blocked';
  steps: PathStep[];
  /** Requirements that are unmet, in words. */
  requirementsUnmet: string[];
  unknowns: string[];
}

export interface RoleFitStage {
  classification: RoleFitEvidence['classification'];
  evidence: RoleFitEvidence;
}

export interface MlbConsequences {
  active: { before: number | null; change: number; limit: number | null; note: string | null };
  fortyMan: { before: number | null; change: number; limit: number | null };
  /** The role an internal change leaves behind, when that would fall below the standard. */
  vacatedRole: { role: string; availableAfter: number; standard: number; belowStandard: boolean } | null;
  farm: FarmConsequence | null;
  facts: NeedFact[];
}

export type PreferenceStance = 'preferred' | 'acceptable' | 'disfavored' | 'no_preference';

export interface PhilosophyStage {
  /** Only for a candidate that is valid on every prior stage; otherwise `not_applicable` with the reason. */
  status: 'applied' | 'not_applicable';
  stance: PreferenceStance | null;
  reasons: Array<{ dimension: string; value: number; direction: 'supports' | 'cuts_against' | 'neutral'; message: string }>;
  note: string | null;
}

export type ResponseGroup =
  | 'open'
  | 'open_development_unassessed'
  | 'indeterminate'
  | 'role_concern'
  | 'creates_shortfall'
  | 'blocked_by_development'
  | 'blocked_by_rights'
  | 'unavailable';

export interface ResponseCandidate {
  playerId: number;
  name: string;
  age: number | null;
  level: number | null;
  teamId: number | null;
  role: RoleRef | null;
  pathKind: PathKind;
  group: ResponseGroup;
  /** Plain-language reasons this player is shown and why he is in this group. */
  why: string[];
  discovery: { source: string; roleMatch: 'direct' | 'secondary'; evidence: string[] };
  availability: { status: string; label: string | null; daysLeft: number | null };
  development: DevelopmentStage;
  path: TransactionPath;
  roleFit: RoleFitStage | null;
  performance: PerformanceLine | null;
  consequences: MlbConsequences;
  philosophy: PhilosophyStage;
}

export interface ClearingOption {
  playerId: number;
  name: string;
  age: number | null;
  role: RoleRef | null;
  option: { status: RightsStatus; label: string; reasons: RightsReason[]; missing: MissingEvidence[] };
  designate: { status: RightsStatus; label: string };
  optionYears: OptionYears;
  /** What removing him from the active roster does to his role's depth. */
  roleEffect: { role: string; availableAfter: number; standard: number; belowStandard: boolean } | null;
  farm: FarmConsequence | null;
  assignment: string | null;
  group: 'can_be_optioned' | 'cannot_be_optioned' | 'indeterminate';
}

export interface ClearingPacket {
  returning: NonNullable<MlbNeed['returning']>;
  activation: { status: RightsStatus; label: string; reasons: RightsReason[]; missing: MissingEvidence[] } | null;
  options: ClearingOption[];
  note: string;
}

export const GROUP_LABELS: Record<ResponseGroup, string> = {
  open: 'Open: Player Development and Player Rights raise no objection',
  open_development_unassessed: 'Open, but Player Development has no assessment',
  indeterminate: 'Cannot be established from the evidence available',
  role_concern: 'Open, but poor fit for the role at the MLB level',
  creates_shortfall: 'Open, but it only moves the hole: his own role falls below the standard',
  blocked_by_development: 'Blocked: Player Development does not support the assignment',
  blocked_by_rights: 'Blocked: not a transaction the rules allow',
  unavailable: 'Unavailable',
};

const GROUP_ORDER: ResponseGroup[] = [
  'open', 'open_development_unassessed', 'role_concern', 'creates_shortfall', 'indeterminate',
  'blocked_by_development', 'blocked_by_rights', 'unavailable',
];

export interface ResponsePacket {
  need: MlbNeed;
  /** `fill`: bring someone in. `clear`: make room. `role_needed`: the need names no role to explore. */
  direction: 'fill' | 'clear' | 'role_needed';
  groups: Array<{ group: ResponseGroup; label: string; candidates: ResponseCandidate[] }>;
  clearing: ClearingPacket | null;
  /** Players the discovery did not consider, and why — counted, not listed. */
  notConsidered: Array<{ reason: string; count: number }>;
  philosophyValues: PhilosophyValues;
  unknowns: string[];
  semantics: { ranking: 'none'; ordering: 'stable_by_path_level_name'; decision: 'gm' };
}

// ── helpers ─────────────────────────────────────────────────────────────────

const roleLabel = (r: RoleRef | null) => r?.label ?? 'role unknown';

function sameRole(a: RoleRef | null, b: RoleRef): boolean {
  if (!a || a.kind !== b.kind) return false;
  return b.kind === 'position_player' ? a.position === b.position : true;
}

function stepFrom(seq: number, action: string, m: { playerId: number; name: string }, a: ActionRights): PathStep {
  return {
    seq, action, playerId: m.playerId, playerName: m.name, status: a.status, label: a.label,
    reasons: a.reasons, requirements: a.requirements, missing: a.missing, limitation: a.limitation,
  };
}

/**
 * The requirement text for an unmet active-roster spot, unless the need itself
 * opens that spot (a what-if assumes a vacancy): then the requirement is met by
 * the scenario, stated as such rather than dropped.
 */
function applyScenario(requirements: RightsRequirement[], need: MlbNeed): RightsRequirement[] {
  if (need.origin !== 'hypothetical') return requirements;
  return requirements.map((r) => r.kind === 'active_roster_spot' && r.status === 'unmet'
    ? { ...r, status: 'met' as const, message: 'The assumed unavailability opens an active-roster spot.' }
    : r);
}

function pathFrom(steps: PathStep[]): TransactionPath {
  const unmet = steps.flatMap((s) => s.requirements.filter((r) => r.status === 'unmet').map((r) => r.message));
  const unknown = steps.flatMap((s) => [
    ...s.requirements.filter((r) => r.status === 'unknown').map((r) => r.message),
    ...s.missing.map((m) => m.message),
    ...(s.status === 'not_evaluated' && s.limitation ? [s.limitation] : []),
  ]);
  let status: TransactionPath['status'] = 'open';
  if (steps.some((s) => s.status === 'ineligible')) status = 'blocked';
  else if (steps.some((s) => s.status === 'indeterminate' || s.status === 'not_evaluated')
    || steps.some((s) => s.requirements.some((r) => r.status === 'unknown'))) status = 'indeterminate';
  else if (unmet.length) status = 'open_with_requirements';
  return { status, steps, requirementsUnmet: unmet, unknowns: [...new Set(unknown)] };
}

function developmentStage(kind: PathKind, level: number | null, assessment: MlbDiscussionAssessment | null): DevelopmentStage {
  if (kind === 'role_change') {
    return { status: 'not_applicable', message: 'An active MLB player changing role; no assignment changes hands.' };
  }
  if (level !== 2) {
    return { status: 'unassessed', message: 'Player Development assesses AAA to MLB only; this player is not at Triple-A.' };
  }
  if (!assessment) {
    return { status: 'unassessed', message: 'Player Development has no assessment: not enough production at his current level for it to judge.' };
  }
  return {
    status: assessment.judgment,
    reasons: assessment.reasons,
    blockers: assessment.blockers,
    missing: assessment.missingEvidence.map((m) => m.detail),
  };
}

function contractFacts(m: RosterMember, rights: PlayerRights | undefined): NeedFact[] {
  const facts: NeedFact[] = [];
  const years = m.state.serviceTime.mlbYears.value;
  const days = m.state.serviceTime.mlbDays.value;
  facts.push({ label: 'MLB service', value: years === null ? 'Unknown' : `${years} yr${days !== null ? ` ${days} d` : ''}` });
  const major = m.state.contract.majorLeague.value;
  facts.push({ label: 'Contract', value: major === null ? 'Unknown' : major ? 'Major-league contract' : 'Minor-league contract' });
  if (rights) {
    const o = rights.optionYears;
    facts.push({
      label: 'Options',
      value: o.used === null ? 'Unknown' : `${o.used} of 3 used${o.remaining !== null ? `, ${o.remaining} left` : ''}`,
    });
  }
  return facts;
}

// ── philosophy (after validity) ─────────────────────────────────────────────

const HIGH = 60;
const LOW = 40;

function philosophyStage(
  group: ResponseGroup, kind: PathKind, dev: DevelopmentStage, isPitcher: boolean, values: PhilosophyValues
): PhilosophyStage {
  if (group !== 'open') {
    return {
      status: 'not_applicable', stance: null, reasons: [],
      note: 'Philosophy expresses preference only among alternatives that are valid on every stage above; it cannot authorize, block, or resolve an unknown.',
    };
  }
  const reasons: PhilosophyStage['reasons'] = [];
  if (kind !== 'role_change' && dev.status === 'defensible') {
    const v = values.promotionAggressiveness;
    reasons.push({
      dimension: 'promotionAggressiveness', value: v,
      direction: v >= HIGH ? 'supports' : v <= LOW ? 'cuts_against' : 'neutral',
      message: v >= HIGH ? 'The organization challenges defensible prospects quickly.'
        : v <= LOW ? 'The organization prefers prospects master their level first.' : 'The organization is balanced on promoting defensible prospects.',
    });
  }
  if (kind === 'role_change' && !isPitcher) {
    const v = values.versatility;
    reasons.push({
      dimension: 'versatility', value: v,
      direction: v >= HIGH ? 'supports' : v <= LOW ? 'cuts_against' : 'neutral',
      message: v >= HIGH ? 'The organization values players who can move across positions.'
        : v <= LOW ? 'The organization prefers specialists in fixed roles.' : 'The organization is balanced on positional flexibility.',
    });
  }
  if (!reasons.length) {
    return { status: 'applied', stance: 'no_preference', reasons, note: 'No philosophy dimension bears on this alternative.' };
  }
  const net = reasons.reduce((n, r) => n + (r.direction === 'supports' ? 1 : r.direction === 'cuts_against' ? -1 : 0), 0);
  return { status: 'applied', stance: net > 0 ? 'preferred' : net < 0 ? 'disfavored' : 'acceptable', reasons, note: null };
}

// ── fill direction ──────────────────────────────────────────────────────────

interface RawCandidate {
  member: RosterMember;
  pathKind: PathKind;
  roleMatch: 'direct' | 'secondary';
  source: string;
  evidence: string[];
  crossRole?: CrossRoleSupport;
}

function discover(need: MlbNeed, role: RoleRef, view: ClubView, ports: ResponsePorts, notConsidered: Map<string, number>): RawCandidate[] {
  const out: RawCandidate[] = [];
  const skip = (reason: string) => notConsidered.set(reason, (notConsidered.get(reason) ?? 0) + 1);
  const causeIds = new Set(need.causes.map((c) => c.playerId));

  for (const m of view.members) {
    if (causeIds.has(m.playerId)) continue;
    if (m.onActive === true) {
      // An active MLB player in a different role, if visible evidence supports the change.
      if (m.role === null || sameRole(m.role, role)) continue;
      // A pitcher never takes a fielding role or the reverse; only a change within the family is a real alternative.
      if ((m.role.position === 1) !== (role.position === 1)) continue;
      if (m.availability.status === 'unavailable') continue;
      const support = ports.crossRole(m.playerId, role);
      if (support.supported === 'no') { skip('Active players whose visible evidence does not support the role'); continue; }
      out.push({
        member: m, pathKind: 'role_change', roleMatch: 'secondary', source: `Active ${roleLabel(m.role)} used as ${role.label}`,
        evidence: support.evidence, crossRole: support,
      });
      continue;
    }
    if (m.level === null || m.level <= 1) continue;
    if (!sameRole(m.role, role)) continue;
    const onForty = m.onFortyMan === true;
    if (!onForty && m.level !== 2) { skip('Non-40-man players below Triple-A (Player Development assesses AAA to MLB only)'); continue; }
    out.push({
      member: m, pathKind: onForty ? 'recall' : 'add_to_forty_man', roleMatch: 'direct',
      source: `${onForty ? '40-man' : 'Non-40-man'} ${role.label}, level ${m.level}`,
      evidence: [`Listed ${role.label}.`],
    });
  }
  return out;
}

function assemble(
  raw: RawCandidate, need: MlbNeed, role: RoleRef, view: ClubView, ports: ResponsePorts,
  rightsMap: Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }>
): ResponseCandidate {
  const m = raw.member;
  const picture = rightsMap.get(m.playerId);
  const rights = picture?.rights;
  const isPitcher = m.role?.kind === 'starting_pitcher' || m.role?.kind === 'relief_pitcher';

  // path
  const steps: PathStep[] = [];
  if (raw.pathKind === 'role_change') {
    steps.push({
      seq: 1, action: 'role change', playerId: m.playerId, playerName: m.name, status: 'not_a_transaction',
      label: `Use ${m.name} as ${role.label}; no roster transaction`, reasons: [], requirements: [], missing: [], limitation: null,
    });
  } else if (!rights) {
    steps.push({
      seq: 1, action: raw.pathKind === 'recall' ? 'recall' : 'addToFortyMan', playerId: m.playerId, playerName: m.name,
      status: 'indeterminate', label: 'Rights could not be evaluated', reasons: [], requirements: [],
      missing: [{ code: 'field_not_exported', message: 'No Player State was available to evaluate rights.' }], limitation: null,
    });
  } else if (raw.pathKind === 'recall') {
    const a = rights.actions.recall;
    steps.push(stepFrom(1, 'recall', m, { ...a, requirements: applyScenario(a.requirements, need) }));
  } else {
    const add = rights.actions.addToFortyMan;
    steps.push(stepFrom(1, 'addToFortyMan', m, add));
    steps.push({
      seq: 2, action: 'promote to the active roster', playerId: m.playerId, playerName: m.name,
      status: 'not_evaluated', label: 'Promotion of a new 40-man addition is not evaluated',
      reasons: [], requirements: [], missing: [],
      limitation: 'Player Rights evaluates a recall only for a player already on the 40-man; adding a player and promoting him as one move is not modeled yet.',
    });
  }
  const path = pathFrom(steps);

  const development = developmentStage(raw.pathKind, m.level, ports.development(m.playerId) ?? null);
  const roleFit = raw.pathKind === 'role_change' && raw.crossRole?.supported !== 'yes'
    ? null
    : { classification: null as RoleFitEvidence['classification'], evidence: ports.roleFit(m.playerId) };
  if (roleFit) roleFit.classification = roleFit.evidence.classification;

  // consequences
  const spotOpen = need.origin === 'hypothetical' || (view.counts.active !== null && view.limits.active !== null && view.counts.active < view.limits.active);
  let vacated: MlbConsequences['vacatedRole'] = null;
  if (raw.pathKind === 'role_change' && m.role) {
    const standard = ROLE_STANDARDS[m.role.kind];
    const available = activeMembers(view).filter((a) => a.role?.kind === m.role?.kind && a.availability.status === 'available').length;
    if (standard) vacated = { role: m.role.label, availableAfter: available - 1, standard: standard.count, belowStandard: available - 1 < standard.count };
  }
  const consequences: MlbConsequences = {
    active: {
      before: view.counts.active,
      change: raw.pathKind === 'role_change' ? 0 : 1,
      limit: view.limits.active,
      note: raw.pathKind === 'role_change' ? null
        : need.origin === 'hypothetical' ? 'The assumed absence opens a spot.'
        : spotOpen ? 'A spot is open.' : 'The active roster is full: another player must be moved first.',
    },
    fortyMan: { before: view.counts.fortyMan, change: raw.pathKind === 'add_to_forty_man' ? 1 : 0, limit: view.limits.fortyMan },
    vacatedRole: vacated,
    farm: raw.pathKind === 'role_change' ? null : ports.farm(m.playerId, m.role, 'leaves', m.teamId),
    facts: contractFacts(m, rights),
  };

  // group
  let group: ResponseGroup = 'open';
  const roleFitPoor = roleFit?.classification === 'poor';
  if (m.availability.status === 'unavailable') group = 'unavailable';
  else if (path.status === 'blocked') group = 'blocked_by_rights';
  else if (development.status === 'indefensible') group = 'blocked_by_development';
  else if (path.status === 'indeterminate' || development.status === 'indeterminate'
    || (raw.pathKind === 'role_change' && raw.crossRole?.supported === 'unknown')) group = 'indeterminate';
  else if (vacated?.belowStandard) group = 'creates_shortfall';
  else if (roleFitPoor) group = 'role_concern';
  else if (development.status === 'unassessed') group = 'open_development_unassessed';

  const why: string[] = [`${raw.source}.`];
  if (group === 'unavailable') why.push(`Currently ${m.availability.label ?? 'unavailable'}${m.availability.daysLeft ? ` (${m.availability.daysLeft} days)` : ''}.`);
  if (group === 'blocked_by_rights') why.push(...steps.filter((s) => s.status === 'ineligible').map((s) => `${s.label}.`));
  if (group === 'blocked_by_development') why.push(...(development.status === 'indefensible' ? development.blockers : []));
  if (group === 'indeterminate') {
    if (path.status === 'indeterminate') why.push('The transaction cannot be established; see the path for what is missing.');
    if (development.status === 'indeterminate') why.push(...development.missing);
    if (raw.crossRole?.supported === 'unknown') why.push(...raw.crossRole.evidence);
  }

  const philosophy = philosophyStage(group, raw.pathKind, development, isPitcher, ports.philosophy);
  return {
    playerId: m.playerId, name: m.name, age: m.age, level: m.level, teamId: m.teamId, role: m.role,
    pathKind: raw.pathKind, group, why,
    discovery: { source: raw.source, roleMatch: raw.roleMatch, evidence: raw.evidence },
    availability: { status: m.availability.status, label: m.availability.label, daysLeft: m.availability.daysLeft },
    development, path, roleFit,
    performance: ports.performance(m.playerId, m.level, isPitcher),
    consequences, philosophy,
  };
}

const PATH_ORDER: Record<PathKind, number> = { role_change: 0, recall: 1, add_to_forty_man: 2 };

// ── clear direction (an injured player returns to a full roster) ────────────

function clearingPacket(
  need: MlbNeed, view: ClubView, ports: ResponsePorts,
  rightsMap: Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }>
): ClearingPacket | null {
  if (!need.returning) return null;
  const affiliate = ports.optionAffiliateTeamId();
  const active = activeMembers(view);
  const returningRole = view.members.find((m) => m.playerId === need.returning?.playerId)?.role ?? null;
  const options: ClearingOption[] = active.map((m) => {
    const rights = rightsMap.get(m.playerId)?.rights;
    const option = rights?.actions.option;
    const standard = m.role ? ROLE_STANDARDS[m.role.kind] : undefined;
    const available = active.filter((a) => a.role?.kind === m.role?.kind && a.availability.status === 'available').length;
    // If the returning player is the same role, activating him restores what optioning this player removes.
    const restored = need.returning && rightsMap.has(need.returning.playerId) && returningRole?.kind === m.role?.kind ? 1 : 0;
    const after = available - (m.availability.status === 'available' ? 1 : 0) + restored;
    const status: RightsStatus = option?.status ?? 'indeterminate';
    return {
      playerId: m.playerId, name: m.name, age: m.age, role: m.role,
      option: {
        status, label: option?.label ?? 'Rights could not be evaluated',
        reasons: option?.reasons ?? [], missing: option?.missing ?? [],
      },
      designate: { status: rights?.actions.designateForAssignment.status ?? 'indeterminate', label: rights?.actions.designateForAssignment.label ?? '' },
      optionYears: rights?.optionYears ?? { used: null, remaining: null, usedThisSeason: null, standing: 'indeterminate' },
      roleEffect: m.role && standard
        ? { role: m.role.label, availableAfter: after, standard: standard.count, belowStandard: after < standard.count } : null,
      farm: status === 'eligible' ? ports.farm(m.playerId, m.role, 'joins', affiliate) : null,
      assignment: rightsMap.get(m.playerId)?.assignment?.label ?? null,
      group: status === 'eligible' ? 'can_be_optioned' : status === 'ineligible' ? 'cannot_be_optioned' : 'indeterminate',
    };
  });
  const activation = rightsMap.get(need.returning.playerId)?.rights.actions.activateFromInjuredList;
  return {
    returning: need.returning,
    activation: activation
      ? { status: activation.status, label: activation.label, reasons: activation.reasons, missing: activation.missing }
      : null,
    options: options.sort((a, b) => (a.role?.kind ?? '').localeCompare(b.role?.kind ?? '') || a.name.localeCompare(b.name)),
    note: 'These are the players who could be moved so he can be activated, each with what Player Rights says about optioning him. Nothing is ranked or chosen. Whom to move is the GM\'s decision.',
  };
}

// ── packet ──────────────────────────────────────────────────────────────────

export function buildResponsePacket(need: MlbNeed, view: ClubView, ports: ResponsePorts): ResponsePacket {
  const base = {
    need, philosophyValues: ports.philosophy,
    semantics: { ranking: 'none' as const, ordering: 'stable_by_path_level_name' as const, decision: 'gm' as const },
  };

  if (need.kind === 'il_return_crunch') {
    const ids = [...activeMembers(view).map((m) => m.playerId), ...(need.returning ? [need.returning.playerId] : [])];
    const clearing = clearingPacket(need, view, ports, ports.rights(ids));
    const unknowns = [...need.unknowns];
    if (clearing?.options.some((o) => o.option.status === 'eligible' && o.farm === null)) {
      unknowns.push("Minor League Operations could not evaluate the affiliate's roster, so what optioning a player does below is unknown.");
    }
    return { ...base, direction: 'clear', groups: [], clearing, notConsidered: [], unknowns };
  }

  const role = need.role;
  if (!role) {
    return {
      ...base, direction: 'role_needed', groups: [], clearing: null, notConsidered: [],
      unknowns: ['This need names no role, so Pennant cannot say who could fill it. Choose a role to explore.'],
    };
  }

  const notConsidered = new Map<string, number>();
  const raws = discover(need, role, view, ports, notConsidered);
  const rightsMap = ports.rights(raws.filter((r) => r.pathKind !== 'role_change').map((r) => r.member.playerId));
  const candidates = raws.map((r) => assemble(r, need, role, view, ports, rightsMap));

  const groups = GROUP_ORDER.map((group) => ({
    group, label: GROUP_LABELS[group],
    candidates: candidates.filter((c) => c.group === group).sort((a, b) =>
      PATH_ORDER[a.pathKind] - PATH_ORDER[b.pathKind] || (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name)),
  })).filter((g) => g.candidates.length > 0);

  const unknowns = [...need.unknowns];
  if (candidates.some((c) => c.pathKind !== 'role_change' && c.consequences.farm === null)) {
    unknowns.push("Minor League Operations could not evaluate the affiliate's roster for some candidates, so their minor-league consequence is unknown.");
  }
  if (candidates.length === 0) unknowns.push('No internal player was found who could take this role.');
  return {
    ...base, direction: 'fill', groups, clearing: null,
    notConsidered: [...notConsidered].map(([reason, count]) => ({ reason, count })),
    unknowns,
  };
}
