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
import type { LensEvidence, ReplacementComparison } from './roleReview.js';
import type { Plan } from './mlbPlans.js';
import type { CoverageFloors, MlbNeed, NeedFact } from './mlbNeeds.js';
import {
  CONTEXT_PROFILES, resolveAcrossDurations,
  type ContextVerdict, type DurationAssessment, type MlbAssignmentContext,
} from './mlbAssignmentContext.js';
import { buildStaffReport, type StaffReport } from './mlbReport.js';
import { buildComplementPlans, buildReplacementPlans, estimatorFrom } from './mlbPlans.js';
import { lineupPictureFor } from './mlbReview.js';
import { compareReplacement, estimateOf as workingEstimate, type ReviewCalibration, type ReviewSubject } from './roleReview.js';
import { planLean, preferenceFor, readContext, tieBucket, type ContextRead, type OrganizationContext, type ShadeReason } from './staffPreference.js';
import { complementFit, evaluatePlatoon, type ComplementFit, type PlatoonInput, type PlatoonRead } from './platoon.js';
import { activeMembers, sameRole, type ClubView, type RoleRef, type RosterMember } from './mlbRoster.js';
import type { MlbAssignmentAssessment } from './org.js';
import type {
  ActionRights, MissingEvidence, OptionYears, PlayerRights, RightsReason, RightsRequirement, RightsStatus,
} from './playerRights.js';

// ── ports ───────────────────────────────────────────────────────────────────

export interface PhilosophyValues {
  promotionAggressiveness: number;
  versatility: number;
}

export interface ResponsePorts {
  /** The save's fitted review numbers where in force (the glove weights a comparison uses); absent, the built-in starting values. */
  reviewCalibration?: ReviewCalibration | null;
  rights(playerIds: number[]): Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }>;
  /**
   * Player Development's assessment of the contemplated kind of MLB assignment;
   * null when it has not assessed the player (not a pass, not a rejection).
   */
  development(playerIds: number[], context: MlbAssignmentContext): Map<number, MlbAssignmentAssessment>;
  /** The minimum role-coverage floors in force (data, so a different staff shape is a different value). */
  floors: CoverageFloors;
  crossRole(playerId: number, role: RoleRef): CrossRoleSupport;
  roleFit(playerId: number): RoleFitEvidence;
  /**
   * Both scouting lenses for players in a role: tools against MLB peers and results with their sample.
   * `ignoreResults` asks how a pitcher's tools rate in a role he does not fill, which has no results.
   */
  holderEvidence(playerIds: number[], role: RoleRef, opts?: { ignoreResults?: boolean }): Map<number, LensEvidence>;
  /** Hitters' usage and the team's games, so "who plays where" is what happens, not what a label says. Optional. */
  hitterUsage?(playerIds: number[]): Map<number, { bats: 'R' | 'L' | 'S' | null; fielding: Array<{ position: number; gs: number; ip: number }>; gs: number; pa: number }>;
  teamGames?(): number;
  /** Observed splits, the league's platoon effect and each hitter's visible platoon ratings, for a platoon-complement need. */
  platoon?(playerIds: number[]): Map<number, PlatoonInput>;
  performance(playerId: number, level: number | null, isPitcher: boolean): PerformanceLine | null;
  farm(playerId: number, role: RoleRef | null, direction: 'leaves' | 'joins', affiliateTeamId: number | null): FarmConsequence | null;
  /** Where an optioned MLB player would go, when the organization has an affiliate. */
  optionAffiliateTeamId(): number | null;
  philosophy: PhilosophyValues;
  /**
   * The organization's philosophy and where the season stands (D-036). It shades the ORDER and the WORDING of what is already valid and
   * ready; it never changes a comparison, a right or a development finding. Absent means no shading.
   */
  organization?: OrganizationContext | null;
}

// ── output types ────────────────────────────────────────────────────────────

export type PathKind = 'role_change' | 'recall' | 'add_to_forty_man';

export interface ContextualDevelopment {
  contextLabel: string;
  stakesTier: string | null;
  /** Why Player Development reads his stakes that way: the ceiling, then what is left of his development. */
  stakesReasons: string[];
  /** The bar this context sets against the durable bar it was taken from. */
  requiredReadiness: number | null;
  durableReadiness: number | null;
  routes: { production: string; established: string } | null;
  experience: { plateAppearances: number; inningsPitched: number } | null;
}

export interface DurationDependence {
  /** True when the answer changes with how long he would be needed. */
  matters: boolean;
  explanation: string;
  /** What would settle it; null when duration would not. */
  resolvedBy: string | null;
  /** Player Development's verdict for each context it was asked about. */
  verdicts: ContextVerdict[];
}

export type DevelopmentStage =
  | {
      status: 'defensible' | 'indefensible' | 'indeterminate' | 'context_dependent';
      /** The kind of assignment Player Development judged; null when the duration is unknown and several were judged. */
      context: MlbAssignmentContext | null;
      basis: 'durable_discussion' | 'contextual' | 'across_durations';
      contextual: ContextualDevelopment | null;
      /** Present when the expected duration is unknown and each applicable context was judged. */
      duration: DurationDependence | null;
      reasons: string[];
      blockers: string[];
      missing: string[];
    }
  /** Player Development has no assessment of this player. Not a pass, not a rejection: the evaluation is incomplete. */
  | { status: 'unassessed'; message: string }
  /** No assignment changes hands (an active MLB player changing role). */
  | { status: 'not_applicable'; message: string };

export interface PathStep {
  seq: number;
  /** The rights action evaluated, or a description for a step Rights does not evaluate. */
  action: string;
  playerId: number;
  playerName: string;
  status: RightsStatus | 'not_a_transaction';
  label: string;
  reasons: RightsReason[];
  requirements: RightsRequirement[];
  missing: MissingEvidence[];
  limitation: string | null;
}

export interface TransactionPath {
  /**
   * The path is only as certain as its least certain step: `blocked` if any step
   * is ineligible, else `indeterminate` if any is indeterminate, else `open_with_requirements` if a spot must be made, else `open`.
   */
  status: 'open' | 'open_with_requirements' | 'indeterminate' | 'blocked';
  steps: PathStep[];
  /** The path with the roster clearing each step needs first made explicit; set once a clearing has been evaluated. */
  chain: ChainLink[];
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
  vacatedRole: { role: string; availableAfter: number; floor: number; belowFloor: boolean } | null;
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
  | 'open_requires_clearing'
  | 'context_dependent'
  | 'evaluation_incomplete'
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
  /** Which roster spots must be cleared first: an otherwise viable candidate that needs a clearing move says so. */
  requiresClearing: { active: boolean; fortyMan: boolean };
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
  /** For a replacement: how he compares with the player under review, lens by lens. Null when not a replacement or not comparable. */
  comparison?: ReplacementComparison | null;
  /** How the organization's philosophy leans between equivalent replacements: a named reason per term, ordering only (D-036). */
  preference?: { score: number; reasons: ShadeReason[] } | null;
  /** For a platoon partner: how he fares against the hand the regular struggles with, and his glove beside the regular's. */
  complement?: ComplementRead | null;
}

export interface ComplementRead {
  /** The hand the regular struggles against. */
  weakSide: 'L' | 'R';
  fit: ComplementFit;
  /** His own platoon read: expected wOBA against each side, and the verdict on his own split. */
  candidate: { vsLeft: number | null; vsRight: number | null; verdict: PlatoonRead['verdict'] };
  /** His glove at the position beside the regular's (percentile among MLB players listed there); null when either is not visible. */
  glove: { candidate: number | null; regular: number | null };
}

export type ClearingClass = 'routine' | 'higher_cost' | 'disruptive' | 'unresolved';

/**
 * The two roster constraints are different problems with different solutions and
 * are never mixed in one list. An option solves only the ACTIVE constraint (he
 * stays on the 40-man, even when it uses his final option year); only the 60-day
 * list and a designation take a player off the 40-man.
 */
export type ClearingConstraint = 'active_roster' | 'forty_man';

export const CLEARING_CLASS_LABELS: Record<ClearingClass, { label: string; description: string }> = {
  routine: { label: 'Routine and reversible', description: 'No player is put at risk and the move can be undone.' },
  higher_cost: { label: 'Costs something lasting', description: 'An option that uses a resource that does not come back, such as his final option year.' },
  disruptive: { label: 'Disruptive: puts the player at risk', description: 'Designating for assignment removes him from the 40-man and risks losing him to another club.' },
  unresolved: { label: 'Not established', description: 'Player Rights cannot yet say what can be done with him.' },
};

export type ClearingTransaction = 'option' | 'designate_for_assignment' | 'place_on_sixty_day_il';

export interface ClearingOption {
  playerId: number;
  name: string;
  age: number | null;
  role: RoleRef | null;
  /** Which roster constraint this option is offered for. */
  constraint: ClearingConstraint;
  /** The one transaction offered for him for this constraint. */
  transaction: ClearingTransaction;
  class: ClearingClass;
  rights: { status: RightsStatus; label: string; reasons: RightsReason[]; missing: MissingEvidence[] };
  /** What the move costs and puts at risk, in words, with the basis stated where one exists. */
  costs: string[];
  /** What the move does to each roster, so a GM can see when one move solves both. */
  rosterEffect: { activeSpot: 'opens' | 'unchanged'; fortyManSpot: 'unchanged' | 'opens' };
  optionYears: OptionYears;
  /** What removing him from the active roster does to his role's coverage (counting a returning player of the same role). */
  roleEffect: { role: string; availableAfter: number; floor: number; belowFloor: boolean } | null;
  /** For an option or a minor-league player's removal: what the affiliate looks like without / with him. */
  farm: FarmConsequence | null;
  assignment: string | null;
  facts: NeedFact[];
}

export interface ConstraintClearing {
  constraint: ClearingConstraint;
  label: string;
  /** `clearing_needed`: the roster is full. `spot_open`: nothing to clear. `unknown`: the count or the limit is not available. */
  state: 'clearing_needed' | 'spot_open' | 'unknown';
  count: number | null;
  limit: number | null;
  /** Whether any way to clear it is rights-established. Null when nothing needs clearing. */
  feasibility: 'available' | 'unresolved_only' | 'none' | null;
  /** Ways to clear this constraint, by the kind of transaction and what it puts at risk. Not a ranking of players. */
  classes: Array<{ class: ClearingClass; label: string; description: string; options: ClearingOption[] }>;
  note: string;
}

/** One link in the operational path: a transaction Rights owns, or the roster clearing it needs first. */
export interface ChainLink {
  seq: number;
  kind: 'clear_spot' | 'transaction';
  constraint: ClearingConstraint | null;
  action: string;
  status: RightsStatus | 'not_a_transaction';
  label: string;
  detail: string;
}

export interface ClearingPacket {
  returning: NonNullable<MlbNeed['returning']> | null;
  activation: { status: RightsStatus; label: string; reasons: RightsReason[]; missing: MissingEvidence[]; requirements: RightsRequirement[]; limitation: string | null; facts: Record<string, string | number | boolean | null> } | null;
  /** Each constraint that must be cleared (or is unknown), solved separately. */
  constraints: ConstraintClearing[];
  /** For a return from the injured list: the whole path, clearing first, then the activation. Only as certain as its least certain link. */
  chain: ChainLink[];
  chainStatus: 'open' | 'open_with_requirements' | 'indeterminate' | 'blocked' | null;
  note: string;
}

export const GROUP_LABELS: Record<ResponseGroup, string> = {
  open: 'Open: Player Development and Player Rights raise no objection',
  open_requires_clearing: 'Viable, but requires a roster-clearing move first',
  context_dependent: 'Depends on how long he would be needed: defensible for one kind of assignment, not another',
  evaluation_incomplete: 'Evaluation incomplete: Player Development cannot establish defensibility',
  indeterminate: 'Transaction cannot be established from the evidence available',
  role_concern: 'Open, but poor fit for the role at the MLB level',
  creates_shortfall: 'Open, but it only moves the hole: his own role falls below the standard',
  blocked_by_development: 'Blocked: Player Development does not support the assignment',
  blocked_by_rights: 'Blocked: not a transaction the rules allow',
  unavailable: 'Unavailable',
};

const GROUP_ORDER: ResponseGroup[] = [
  'open', 'open_requires_clearing', 'role_concern', 'creates_shortfall', 'context_dependent', 'evaluation_incomplete', 'indeterminate',
  'blocked_by_development', 'blocked_by_rights', 'unavailable',
];

export interface ContemplatedAssignment {
  /** The context Player Development is asked about; null when the duration is unknown and every applicable context is asked. */
  context: MlbAssignmentContext | null;
  /** Every context Player Development is asked about (one, unless the duration is unknown). */
  evaluated: MlbAssignmentContext[];
  label: string;
  /** Why: the GM chose it, it follows from the need's horizon, or the duration is unknown and is not assumed. */
  basis: 'gm_selected' | 'derived_from_horizon' | 'duration_unknown';
  explanation: string;
  choices: Array<{ context: MlbAssignmentContext; label: string }>;
}

export interface ResponsePacket {
  need: MlbNeed;
  /** The kind of MLB assignment Player Development was asked to judge. Null when no assignment is contemplated. */
  assignment: ContemplatedAssignment | null;
  /** `fill`: bring someone in. `clear`: make room. `role_needed`: the need names no role to explore. */
  direction: 'fill' | 'clear' | 'role_needed' | 'replace' | 'complement';
  groups: Array<{ group: ResponseGroup; label: string; candidates: ResponseCandidate[] }>;
  clearing: ClearingPacket | null;
  /** The packet read as a staff briefing: situation, the role picture, what it says, and named pathways. */
  report: StaffReport | null;
  /** For a replacement: the ways to make room for him, each followed through to what it does to the other groups. */
  plans?: Plan[] | null;
  /** The organization's window and the season, and how they lean on this advice. Null when no philosophy is known. */
  context?: ContextRead | null;
  /** Players the discovery did not consider, and why — counted, not listed. */
  notConsidered: Array<{ reason: string; count: number }>;
  philosophyValues: PhilosophyValues;
  unknowns: string[];
  semantics: { ranking: 'none'; ordering: 'stable_by_path_level_name'; decision: 'gm' };
}

// ── helpers ─────────────────────────────────────────────────────────────────

const roleLabel = (r: RoleRef | null) => r?.label ?? 'role unknown';

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
  ]);
  let status: TransactionPath['status'] = 'open';
  if (steps.some((s) => s.status === 'ineligible')) status = 'blocked';
  else if (steps.some((s) => s.status === 'indeterminate')
    || steps.some((s) => s.requirements.some((r) => r.status === 'unknown'))) status = 'indeterminate';
  else if (unmet.length) status = 'open_with_requirements';
  return { status, steps, chain: [], requirementsUnmet: unmet, unknowns: [...new Set(unknown)] };
}

function verdictOf(context: MlbAssignmentContext, assessment: MlbAssignmentAssessment | undefined): ContextVerdict {
  const label = CONTEXT_PROFILES[context].label;
  if (!assessment) {
    return {
      context, label, judgment: 'indeterminate', assessed: false, reasons: [], blockers: [],
      missing: [`Player Development has not assessed him as ${label.toLowerCase()}.`],
    };
  }
  return {
    context, label, judgment: assessment.judgment, assessed: true, reasons: assessment.reasons,
    blockers: assessment.blockers, missing: assessment.missingEvidence.map((m) => m.detail),
  };
}

function contextualOf(a: MlbAssignmentAssessment): ContextualDevelopment | null {
  const c = a.contextual;
  return c
    ? {
      contextLabel: c.contextLabel, stakesTier: c.stakes.tier, stakesReasons: c.stakes.reasons, requiredReadiness: c.readiness.required,
      durableReadiness: c.readiness.durable, routes: c.routes, experience: c.experience,
    }
    : null;
}

function developmentStage(
  kind: PathKind, level: number | null, assignment: ContemplatedAssignment,
  byContext: Map<MlbAssignmentContext, Map<number, MlbAssignmentAssessment>>, playerId: number
): DevelopmentStage {
  if (kind === 'role_change') {
    return { status: 'not_applicable', message: 'An active MLB player changing role; no assignment changes hands.' };
  }
  if (level !== 2) {
    return { status: 'unassessed', message: 'Player Development assesses Triple-A players only; this player is not at Triple-A.' };
  }
  const assessments = assignment.evaluated.map((c) => [c, byContext.get(c)?.get(playerId)] as const);
  if (assessments.every(([, a]) => !a)) {
    return { status: 'unassessed', message: 'Player Development has not assessed this player for the contemplated assignment.' };
  }

  if (assignment.evaluated.length === 1) {
    const a = assessments[0][1] as MlbAssignmentAssessment;
    return {
      status: a.judgment, context: a.context, basis: a.basis, contextual: contextualOf(a), duration: null,
      reasons: a.reasons, blockers: a.blockers, missing: a.missingEvidence.map((m) => m.detail),
    };
  }

  // The duration is unknown: Player Development judged each applicable context and the answer says whether duration matters.
  const verdicts = assessments.map(([c, a]) => verdictOf(c, a));
  const across: DurationAssessment = resolveAcrossDurations(verdicts);
  const first = assessments.find(([, a]) => a?.contextual)?.[1];
  return {
    status: across.judgment, context: null, basis: 'across_durations',
    contextual: first ? contextualOf(first) : null,
    duration: { matters: across.durationMatters, explanation: across.explanation, resolvedBy: across.resolvedBy, verdicts },
    reasons: [...new Set(verdicts.filter((v) => v.judgment === 'defensible').flatMap((v) => v.reasons))],
    blockers: [...new Set(verdicts.filter((v) => v.judgment === 'indefensible').flatMap((v) => v.blockers))],
    missing: [...new Set(verdicts.flatMap((v) => v.missing))],
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
  if (group !== 'open' && group !== 'open_requires_clearing') {
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
  // A fielder can be moved into a position cheaply only from the bench: moving another regular opens a new hole.
  const fielder = role.kind === 'position_player' || role.kind === 'catcher';
  const picture = fielder ? lineupPictureFor(view, ports) : null;
  const regularIds = new Set(picture ? [...picture.spots, picture.dh].flatMap((s) => (s.regular ? [s.regular.playerId] : [])) : []);

  for (const m of view.members) {
    if (causeIds.has(m.playerId)) continue;
    if (m.onActive === true) {
      // An active MLB player in a different role, if visible evidence supports the change.
      if (m.role === null || sameRole(m.role, role)) continue;
      // A pitcher never takes a fielding role or the reverse; only a change within the family is a real alternative.
      if ((m.role.position === 1) !== (role.position === 1)) continue;
      if (m.availability.status === 'unavailable') continue;
      if (picture && regularIds.has(m.playerId)) { skip('Regulars at other positions (moving one opens a new hole)'); continue; }
      const support = ports.crossRole(m.playerId, role);
      if (support.supported === 'no') { skip('Active players whose visible evidence does not support the role'); continue; }
      out.push({
        member: m, pathKind: 'role_change', roleMatch: 'secondary', source: `Active ${roleLabel(m.role)} used as ${role.label}`,
        evidence: support.evidence, crossRole: support,
      });
      continue;
    }
    if (m.level === null || m.level <= 1) continue;
    // A fielder listed elsewhere but with a revealed grade at the position is a real option; the visible grade decides.
    const alsoPlays = fielder && !sameRole(m.role, role) && m.role !== null && m.role.position !== 1 && m.level === 2 && ports.crossRole(m.playerId, role).supported === 'yes';
    if (!sameRole(m.role, role) && !alsoPlays) continue;
    const onForty = m.onFortyMan === true;
    if (!onForty && m.level !== 2) { skip('Non-40-man players below Triple-A (Player Development assesses AAA to MLB only)'); continue; }
    out.push({
      member: m, pathKind: onForty ? 'recall' : 'add_to_forty_man', roleMatch: 'direct',
      source: `${onForty ? '40-man' : 'Non-40-man'} ${role.label}, level ${m.level}`,
      evidence: alsoPlays ? [`Listed ${roleLabel(m.role)}; his visible grade at ${role.label} supports playing it.`] : [`Listed ${role.label}.`],
    });
  }
  return out;
}

function assemble(
  raw: RawCandidate, need: MlbNeed, role: RoleRef, view: ClubView, ports: ResponsePorts,
  rightsMap: Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }>,
  assignment: ContemplatedAssignment, assessments: Map<MlbAssignmentContext, Map<number, MlbAssignmentAssessment>>
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
    // Two component actions, each owned by Player Rights: add the contract to the 40-man, then place him on
    // the active roster. Each keeps its own status and requirement; nothing here combines them into one right.
    const add = rights.actions.addToFortyMan;
    steps.push(stepFrom(1, 'addToFortyMan', m, add));
    const promote = rights.composed.promoteToActive;
    if (promote) steps.push(stepFrom(2, 'place on the active roster', m, { ...promote, requirements: applyScenario(promote.requirements, need) }));
    else {
      steps.push({
        seq: 2, action: 'place on the active roster', playerId: m.playerId, playerName: m.name, status: 'indeterminate',
        label: 'Placement on the active roster could not be evaluated', reasons: [], requirements: [],
        missing: [{ code: 'field_not_exported', message: 'Player Rights returned no evaluation for placing him on the active roster.' }], limitation: null,
      });
    }
  }
  const path = pathFrom(steps);

  const development = developmentStage(raw.pathKind, m.level, assignment, assessments, m.playerId);
  const roleFit = raw.pathKind === 'role_change' && raw.crossRole?.supported !== 'yes'
    ? null
    : { classification: null as RoleFitEvidence['classification'], evidence: ports.roleFit(m.playerId) };
  if (roleFit) roleFit.classification = roleFit.evidence.classification;

  // consequences
  const spotOpen = need.origin === 'hypothetical' || (view.counts.active !== null && view.limits.active !== null && view.counts.active < view.limits.active);
  let vacated: MlbConsequences['vacatedRole'] = null;
  if (raw.pathKind === 'role_change' && m.role) {
    const floor = ports.floors.floors[m.role.kind];
    const available = activeMembers(view).filter((a) => a.role?.kind === m.role?.kind && a.availability.status === 'available').length;
    if (floor) vacated = { role: m.role.label, availableAfter: available - 1, floor: floor.count, belowFloor: available - 1 < floor.count };
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

  // group: the first stage that stops him from being a valid, actionable alternative decides it
  const requiresClearing = {
    active: steps.some((st) => st.requirements.some((r) => r.kind === 'active_roster_spot' && r.status === 'unmet')),
    fortyMan: steps.some((st) => st.requirements.some((r) => r.kind === 'forty_man_spot' && r.status === 'unmet')),
  };
  const incomplete = development.status === 'unassessed' || development.status === 'indeterminate'
    || (raw.pathKind === 'role_change' && raw.crossRole?.supported === 'unknown');
  let group: ResponseGroup = 'open';
  const roleFitPoor = roleFit?.classification === 'poor';
  if (m.availability.status === 'unavailable') group = 'unavailable';
  else if (path.status === 'blocked') group = 'blocked_by_rights';
  else if (development.status === 'indefensible') group = 'blocked_by_development';
  else if (development.status === 'context_dependent') group = 'context_dependent';
  else if (incomplete) group = 'evaluation_incomplete';
  else if (path.status === 'indeterminate') group = 'indeterminate';
  else if (vacated?.belowFloor) group = 'creates_shortfall';
  else if (roleFitPoor) group = 'role_concern';
  else if (requiresClearing.active || requiresClearing.fortyMan) group = 'open_requires_clearing';

  const why: string[] = [`${raw.source}.`];
  if (group === 'unavailable') why.push(`Currently ${m.availability.label ?? 'unavailable'}${m.availability.daysLeft ? ` (${m.availability.daysLeft} days)` : ''}.`);
  if (group === 'blocked_by_rights') why.push(...steps.filter((s) => s.status === 'ineligible').map((s) => `${s.label}.`));
  if (group === 'blocked_by_development') why.push(...(development.status === 'indefensible' ? development.blockers : []));
  if (group === 'context_dependent' && development.status === 'context_dependent' && development.duration) {
    why.push(development.duration.explanation);
    if (development.duration.resolvedBy) why.push(development.duration.resolvedBy);
    why.push('Not shown as open until the duration is chosen: a short stretch and a lasting role are different developmental acts.');
  }
  if (group === 'evaluation_incomplete') {
    if (development.status === 'unassessed') why.push(development.message);
    if (development.status === 'indeterminate') {
      if (development.duration) why.push(development.duration.explanation);
      why.push(...development.missing, ...(development.contextual ? [] : development.reasons));
    }
    if (raw.crossRole?.supported === 'unknown') why.push(...raw.crossRole.evidence);
    why.push('Not an actionable solution until the evaluation can be completed; he stays visible for review.');
  }
  if (group === 'indeterminate') why.push('The transaction cannot be established; see the path for what is missing.');
  if (group === 'open_requires_clearing') {
    why.push(`Otherwise viable, but requires ${[requiresClearing.fortyMan ? 'a 40-man' : '', requiresClearing.active ? 'an active-roster' : ''].filter(Boolean).join(' and ')} clearing move first.`);
  }

  const philosophy = philosophyStage(group, raw.pathKind, development, isPitcher, ports.philosophy);
  return {
    playerId: m.playerId, name: m.name, age: m.age, level: m.level, teamId: m.teamId, role: m.role,
    pathKind: raw.pathKind, group, requiresClearing, why,
    discovery: { source: raw.source, roleMatch: raw.roleMatch, evidence: raw.evidence },
    availability: { status: m.availability.status, label: m.availability.label, daysLeft: m.availability.daysLeft },
    development, path, roleFit,
    performance: ports.performance(m.playerId, m.level, isPitcher),
    consequences, philosophy,
  };
}

const PATH_ORDER: Record<PathKind, number> = { role_change: 0, recall: 1, add_to_forty_man: 2 };

// ── clearing: a roster is full and a spot must be made ──────────────────────

const has = (rs: RightsReason[], code: string) => rs.some((r) => r.code === code);

/** What designating a player for assignment costs and risks. Shared by both constraints: it is one transaction. */
function designationCosts(dfa: ActionRights, years: OptionYears, optionWhy: ActionRights | null): string[] {
  const facts = dfa.facts;
  const costs = [
    `Another club may claim him in the ${facts.waiverPeriodDays ?? 'league'}-day waiver window; if claimed he leaves the organization (documented). The designation period is ${facts.dfaPeriodDays ?? 'league-set'} days.`,
  ];
  if ((optionWhy && has(optionWhy.reasons, 'may_refuse_assignment')) || facts.mayRefuseOutright === true) {
    costs.push('With five or more years of service he may refuse a minor-league assignment and choose free agency (documented, observed).');
  }
  if ((optionWhy && has(optionWhy.reasons, 'out_of_options')) || years.remaining === 0) {
    costs.push('Out of options: the waivers are irrevocable, so if he is claimed he cannot be pulled back (documented; observed for one player).');
  }
  if (optionWhy) costs.push(`Why he cannot simply be optioned: ${optionWhy.reasons.map((r) => r.message).join(' ')}`);
  return costs;
}

type Picture = { assignment: AssignmentContext | null; rights: PlayerRights };

const roleEffectOf = (m: RosterMember, active: RosterMember[], returningRole: RoleRef | null, need: MlbNeed, ports: ResponsePorts): ClearingOption['roleEffect'] => {
  const floor = m.role ? ports.floors.floors[m.role.kind] : undefined;
  if (!m.role || !floor || m.onActive !== true) return null;
  const available = active.filter((a) => a.role?.kind === m.role?.kind && a.availability.status === 'available').length;
  // If the returning player has the same role, activating him restores what moving this player removes.
  const restored = need.returning && returningRole?.kind === m.role.kind ? 1 : 0;
  const after = available - (m.availability.status === 'available' ? 1 : 0) + restored;
  return { role: m.role.label, availableAfter: after, floor: floor.count, belowFloor: after < floor.count };
};

/** A way to clear an ACTIVE spot: an option where he can be optioned, otherwise a designation. */
function activeClearingOption(
  m: RosterMember, need: MlbNeed, active: RosterMember[], returningRole: RoleRef | null, ports: ResponsePorts,
  picture: Picture | undefined, affiliate: number | null
): ClearingOption {
  const rights = picture?.rights;
  const opt = rights?.actions.option;
  const dfa = rights?.actions.designateForAssignment;
  const years: OptionYears = rights?.optionYears ?? { used: null, remaining: null, usedThisSeason: null, standing: 'indeterminate' };

  let transaction: ClearingOption['transaction'] = 'option';
  let klass: ClearingClass = 'unresolved';
  let shown = opt;
  const costs: string[] = [];
  let fortyMan: ClearingOption['rosterEffect']['fortyManSpot'] = 'unchanged';

  if (opt?.status === 'eligible') {
    const charges = years.usedThisSeason === null ? null : years.usedThisSeason === 0;
    const left = years.remaining === null ? null : years.remaining - (charges ? 1 : 0);
    klass = charges && left === 0 ? 'higher_cost' : 'routine';
    costs.push(charges === false
      ? 'An option year is already charged this season; no further year is used.'
      : charges === true
        ? `Uses an option year (${left} left afterward), charged at the first day rollover; a same-day reversal was not charged (observed).`
        : 'Whether an option year is charged could not be established.');
    if (charges && left === 0) costs.push('This is his final option year: next season he could not be sent down without waivers.');
    costs.push('Stays on the 40-man and can be recalled; OOTP enforced no minimum stay in any observed case. This clears an active spot only: it does not open a 40-man spot.');
  } else if (opt?.status === 'ineligible' && dfa?.status === 'eligible') {
    transaction = 'designate_for_assignment';
    klass = 'disruptive';
    shown = dfa;
    fortyMan = 'opens';
    costs.push('Leaves the 40-man and the active roster at once; both spots open (observed).');
    costs.push(...designationCosts(dfa, years, opt));
  } else {
    // Player Rights cannot say (or nothing can be done): the class is not established.
    shown = opt?.status === 'indeterminate' ? opt : dfa?.status === 'indeterminate' ? dfa : opt;
    costs.push(...[...(opt?.missing ?? []), ...(dfa?.status === 'indeterminate' ? dfa.missing : [])].map((x) => x.message));
  }

  return {
    playerId: m.playerId, name: m.name, age: m.age, role: m.role, constraint: 'active_roster', transaction, class: klass,
    rights: { status: shown?.status ?? 'indeterminate', label: shown?.label ?? 'Rights could not be evaluated', reasons: shown?.reasons ?? [], missing: shown?.missing ?? [] },
    costs, rosterEffect: { activeSpot: 'opens', fortyManSpot: fortyMan }, optionYears: years,
    roleEffect: roleEffectOf(m, active, returningRole, need, ports),
    farm: transaction === 'option' && opt?.status === 'eligible' ? ports.farm(m.playerId, m.role, 'joins', affiliate) : null,
    assignment: picture?.assignment?.label ?? null,
    facts: contractFacts(m, rights),
  };
}

/**
 * A way to clear a 40-MAN spot. Only two transactions take a player off the 40-man: the 60-day
 * injured list (a player is listed, not lost) and a designation for assignment (which puts him at
 * risk). An option never does. Null when neither applies to him (already designated, off the
 * 40-man, or a healthy player who cannot be listed and is not designatable).
 */
function fortyManClearingOption(
  m: RosterMember, need: MlbNeed, active: RosterMember[], returningRole: RoleRef | null, ports: ResponsePorts,
  picture: Picture | undefined
): ClearingOption | null {
  const rights = picture?.rights;
  const years: OptionYears = rights?.optionYears ?? { used: null, remaining: null, usedThisSeason: null, standing: 'indeterminate' };
  const onActive = m.onActive === true;
  const base = {
    playerId: m.playerId, name: m.name, age: m.age, role: m.role, constraint: 'forty_man' as const,
    optionYears: years, assignment: picture?.assignment?.label ?? null, facts: contractFacts(m, rights),
    roleEffect: roleEffectOf(m, active, returningRole, need, ports),
  };
  if (!rights) {
    return {
      ...base, transaction: 'designate_for_assignment', class: 'unresolved',
      rights: { status: 'indeterminate', label: 'Rights could not be evaluated', reasons: [], missing: [{ code: 'field_not_exported', message: 'No Player State was available to evaluate rights.' }] },
      costs: ['No Player State was available to evaluate rights.'], rosterEffect: { activeSpot: onActive ? 'opens' : 'unchanged', fortyManSpot: 'opens' }, farm: null,
    };
  }
  const il60 = rights.actions.placeOnSixtyDayIl;
  const dfa = rights.actions.designateForAssignment;
  const effect = { activeSpot: (onActive ? 'opens' : 'unchanged') as 'opens' | 'unchanged', fortyManSpot: 'opens' as const };
  const leavesFarm = !onActive && (m.level ?? 0) > 1 ? ports.farm(m.playerId, m.role, 'leaves', m.teamId) : null;

  if (il60.status === 'eligible') {
    return {
      ...base, transaction: 'place_on_sixty_day_il', class: 'routine',
      rights: { status: il60.status, label: il60.label, reasons: il60.reasons, missing: il60.missing },
      costs: [
        'Takes him off the 40-man and opens a spot; he is listed, not lost (observed and documented).',
        'Returning him later needs a 40-man spot again.',
      ],
      rosterEffect: effect, farm: null,
    };
  }
  if (dfa.status === 'eligible') {
    return {
      ...base, transaction: 'designate_for_assignment', class: 'disruptive',
      rights: { status: dfa.status, label: dfa.label, reasons: dfa.reasons, missing: dfa.missing },
      costs: [
        onActive ? 'Leaves the 40-man and the active roster at once; both spots open (observed).' : 'Leaves the 40-man; his minor-league spot opens too, but no active spot does (observed).',
        ...designationCosts(dfa, years, null),
        'Assigning him to the minors afterwards (an outright) needs the waiver window to clear and is not open to a player who may refuse; that is evaluated when he is designated.',
      ],
      rosterEffect: effect, farm: leavesFarm,
    };
  }
  if (il60.status === 'indeterminate' || dfa.status === 'indeterminate') {
    const shown = il60.status === 'indeterminate' ? il60 : dfa;
    return {
      ...base, transaction: il60.status === 'indeterminate' ? 'place_on_sixty_day_il' : 'designate_for_assignment', class: 'unresolved',
      rights: { status: 'indeterminate', label: shown.label, reasons: shown.reasons, missing: shown.missing },
      costs: [...(il60.status === 'indeterminate' ? il60.missing : []), ...(dfa.status === 'indeterminate' ? dfa.missing : [])].map((x) => x.message),
      rosterEffect: effect, farm: null,
    };
  }
  return null;
}

const CLASS_ORDER: ClearingClass[] = ['routine', 'higher_cost', 'disruptive', 'unresolved'];

function constraintClearing(
  constraint: ClearingConstraint, need: MlbNeed, view: ClubView, ports: ResponsePorts,
  rightsMap: Map<number, Picture>, excludeIds: Set<number>
): ConstraintClearing {
  const isActive = constraint === 'active_roster';
  const count = isActive ? view.counts.active : view.counts.fortyMan;
  const limit = isActive ? view.limits.active : view.limits.fortyMan;
  const label = isActive ? 'Active roster' : '40-man roster';
  const state: ConstraintClearing['state'] = count === null || limit === null ? 'unknown' : count >= limit ? 'clearing_needed' : 'spot_open';
  const shell = { constraint, label, count, limit };
  if (state === 'spot_open') {
    return { ...shell, state, feasibility: null, classes: [], note: `${label}: ${count} of ${limit}. A spot is open, so nothing needs clearing.` };
  }
  if (state === 'unknown') {
    return { ...shell, state, feasibility: null, classes: [], note: `${label}: the count or the limit is not available, so Pennant cannot say whether a spot must be cleared.` };
  }

  const active = activeMembers(view);
  const returningRole = view.members.find((m) => m.playerId === need.returning?.playerId)?.role ?? null;
  const affiliate = ports.optionAffiliateTeamId();
  // Replacing a role holder makes room in HIS spot; the plans follow what that does elsewhere.
  const only = isActive && need.kind === 'role_holder_review' ? need.subject?.playerId : undefined;
  const options: ClearingOption[] = isActive
    ? active.filter((m) => !excludeIds.has(m.playerId) && (only === undefined || m.playerId === only)).map((m) => activeClearingOption(m, need, active, returningRole, ports, rightsMap.get(m.playerId), affiliate))
    : view.members
      .filter((m) => m.onFortyMan === true && !excludeIds.has(m.playerId))
      .map((m) => fortyManClearingOption(m, need, active, returningRole, ports, rightsMap.get(m.playerId)))
      .filter((o): o is ClearingOption => o !== null);

  const feasibility: ConstraintClearing['feasibility'] = options.some((o) => o.class !== 'unresolved') ? 'available'
    : options.length ? 'unresolved_only' : 'none';
  return {
    ...shell, state, feasibility,
    classes: CLASS_ORDER.map((k) => ({
      class: k, ...CLEARING_CLASS_LABELS[k],
      options: options.filter((o) => o.class === k).sort((x, y) =>
        (x.role?.kind ?? '').localeCompare(y.role?.kind ?? '') || x.name.localeCompare(y.name)),
    })).filter((c) => c.options.length > 0),
    note: isActive
      ? `${label}: ${count} of ${limit}, full. An option or a designation clears an active spot. An option keeps the player on the 40-man, so it does NOT open a 40-man spot. Each player appears once, under the one transaction that applies to him. Nothing is ranked: whom to move is the GM's decision.`
      : `${label}: ${count} of ${limit}, full. Only the 60-day injured list and a designation take a player off the 40-man; an option never does (he stays on it, even when it uses his final option year). A designation of an active player also clears an active spot. Nothing is ranked: whom to move is the GM's decision.`,
  };
}

const feasibilityStatus = (c: ConstraintClearing): ChainLink['status'] =>
  c.state === 'unknown' ? 'indeterminate'
    : c.feasibility === 'available' ? 'eligible' : c.feasibility === 'unresolved_only' ? 'indeterminate' : c.feasibility === 'none' ? 'ineligible' : 'eligible';

function clearLink(seq: number, c: ConstraintClearing): ChainLink {
  const detail = c.state === 'unknown' ? c.note
    : c.feasibility === 'available' ? `Rights establishes at least one way to clear it (${c.classes.filter((k) => k.class !== 'unresolved').map((k) => `${k.options.length} ${k.label.toLowerCase()}`).join('; ')}).`
      : c.feasibility === 'unresolved_only' ? 'Every way to clear it is one Player Rights cannot yet establish.'
        : 'No player can be moved to clear it.';
  return { seq, kind: 'clear_spot', constraint: c.constraint, action: `clear a ${c.constraint === 'active_roster' ? 'active-roster' : '40-man'} spot`, status: feasibilityStatus(c), label: `Clear ${c.constraint === 'active_roster' ? 'an active-roster' : 'a 40-man'} spot first`, detail };
}

function chainStatusOf(chain: ChainLink[]): TransactionPath['status'] {
  if (chain.some((l) => l.status === 'ineligible')) return 'blocked';
  if (chain.some((l) => l.status === 'indeterminate')) return 'indeterminate';
  return chain.some((l) => l.kind === 'clear_spot') ? 'open_with_requirements' : 'open';
}

function ilReturnPacket(need: MlbNeed, view: ClubView, ports: ResponsePorts): ClearingPacket | null {
  const returning = need.returning;
  if (!returning) return null;
  const ids = [...new Set([
    ...activeMembers(view).map((m) => m.playerId), ...view.members.filter((m) => m.onFortyMan === true).map((m) => m.playerId), returning.playerId,
  ])];
  const rightsMap = ports.rights(ids);
  const exclude = new Set([returning.playerId]);
  const constraints = [constraintClearing('active_roster', need, view, ports, rightsMap, exclude)];
  // From the 60-day list the player is off the 40-man, so a 40-man spot is a separate constraint of its own.
  if (returning.onFortyMan === false) constraints.push(constraintClearing('forty_man', need, view, ports, rightsMap, exclude));

  const a = rightsMap.get(returning.playerId)?.rights.actions.activateFromInjuredList;
  const activation = a
    ? { status: a.status, label: a.label, reasons: a.reasons, missing: a.missing, requirements: a.requirements, limitation: a.limitation, facts: a.facts }
    : null;
  const chain: ChainLink[] = [];
  for (const c of constraints) if (c.state !== 'spot_open') chain.push(clearLink(chain.length + 1, c));
  chain.push({
    seq: chain.length + 1, kind: 'transaction', constraint: null, action: 'activate from the injured list',
    status: a?.status ?? 'indeterminate', label: a?.label ?? 'Activation could not be evaluated',
    detail: a ? [...a.missing.map((m) => m.message)].join(' ') || (a.limitation ?? '') : 'Player Rights returned no evaluation.',
  });
  return {
    returning, activation, constraints, chain, chainStatus: chainStatusOf(chain),
    note: 'The active-roster spot and the 40-man spot are separate constraints with separate ways to clear them, listed separately. The whole path is only as certain as its least certain link. Pennant lists options and their consequences; it does not rank them or choose.',
  };
}

/** Attach the chain to a candidate and let the feasibility of clearing move an "otherwise viable" candidate out of that group when it cannot be relied on. */
function withClearing(c: ResponseCandidate, byConstraint: Map<ClearingConstraint, ConstraintClearing>, ports: ResponsePorts): ResponseCandidate {
  if (c.pathKind === 'role_change') return c;
  const chain: ChainLink[] = [];
  const need = (k: ClearingConstraint) => (k === 'forty_man' ? c.requiresClearing.fortyMan : c.requiresClearing.active) ? byConstraint.get(k) : undefined;
  const push = (l: Omit<ChainLink, 'seq'>) => chain.push({ ...l, seq: chain.length + 1 });
  const stepLink = (st: PathStep | undefined) => {
    if (st) push({ kind: 'transaction', constraint: null, action: st.action, status: st.status, label: st.label, detail: st.missing.map((m) => m.message).join(' ') });
  };
  if (c.pathKind === 'add_to_forty_man') {
    const f = need('forty_man');
    if (f) push(clearLink(0, f));
    stepLink(c.path.steps[0]);
    const act = need('active_roster');
    if (act) push(clearLink(0, act));
    stepLink(c.path.steps[1]);
  } else {
    const act = need('active_roster');
    if (act) push(clearLink(0, act));
    stepLink(c.path.steps[0]);
  }
  chain.forEach((l, i) => { l.seq = i + 1; });

  const needed = [need('forty_man'), need('active_roster')].filter((x): x is ConstraintClearing => !!x);
  let status = c.path.status;
  if (status !== 'blocked' && status !== 'indeterminate' && needed.length) {
    if (needed.some((k) => k.feasibility === 'none')) status = 'blocked';
    else if (needed.some((k) => k.feasibility === 'unresolved_only')) status = 'indeterminate';
  }
  let group = c.group;
  const why = [...c.why];
  if (c.group === 'open_requires_clearing') {
    if (needed.some((k) => k.feasibility === 'none')) {
      group = 'blocked_by_rights';
      why.push('No player can be moved to clear the spot he needs.');
    } else if (needed.some((k) => k.feasibility === 'unresolved_only')) {
      group = 'indeterminate';
      why.push('Every way to clear the spot he needs is one Player Rights cannot yet establish.');
    }
  }
  return { ...c, group, why, path: { ...c.path, status, chain }, philosophy: group === c.group ? c.philosophy : philosophyStage(group, c.pathKind, c.development, false, ports.philosophy) };
}

// ── the contemplated assignment ─────────────────────────────────────────────

const CONTEXT_CHOICES: Record<string, MlbAssignmentContext[]> = {
  starting_pitcher: ['spot_start', 'temporary_depth', 'durable_role'],
  relief_pitcher: ['short_bullpen', 'temporary_depth', 'durable_role'],
  catcher: ['bench_role', 'temporary_depth', 'durable_role'],
  position_player: ['bench_role', 'temporary_depth', 'durable_role'],
};

/**
 * Which kind of MLB assignment is being contemplated, for Player Development to
 * judge. MLB Operations only DESCRIBES it: a short absence in a rotation is a
 * spot start, a bounded longer one is temporary depth, a long one a durable role.
 * When the duration is UNKNOWN it is not assumed: Player Development is asked
 * about temporary depth AND a durable assignment, and says whether the answer
 * depends on how long the player would be needed. The GM can always choose a
 * context. What is defensible in each is Player Development's.
 */
export function contemplatedAssignment(need: MlbNeed, override?: MlbAssignmentContext): ContemplatedAssignment | null {
  const role = need.role;
  if (!role) return null;
  const choices = CONTEXT_CHOICES[role.kind].map((c) => ({ context: c, label: CONTEXT_PROFILES[c].label }));
  const one = (context: MlbAssignmentContext, basis: ContemplatedAssignment['basis'], explanation: string): ContemplatedAssignment =>
    ({ context, evaluated: [context], label: CONTEXT_PROFILES[context].label, basis, explanation, choices });
  if (override && choices.some((c) => c.context === override)) return one(override, 'gm_selected', 'You chose this assignment context.');
  const h = need.horizon.kind;
  if (h === 'temporary') {
    const context: MlbAssignmentContext = role.kind === 'starting_pitcher' ? 'spot_start' : role.kind === 'relief_pitcher' ? 'short_bullpen' : 'temporary_depth';
    return one(context, 'derived_from_horizon', `The need is short-term (about ${need.horizon.days} days).`);
  }
  if (h === 'extended') return one('temporary_depth', 'derived_from_horizon', `The need is extended (about ${need.horizon.days} days) but bounded.`);
  if (h === 'long_term') return one('durable_role', 'derived_from_horizon', need.horizon.days === null
    ? 'Replacing a role holder is open-ended, so a durable role is contemplated.'
    : `The need is long-term (about ${need.horizon.days} days), so a durable role is contemplated.`);
  return {
    context: null, evaluated: ['temporary_depth', 'durable_role'],
    label: 'Temporary depth and a durable assignment', basis: 'duration_unknown',
    explanation: 'How long he would be needed is not known, so it is not assumed. Player Development judged both temporary depth and a durable assignment; where the answer differs, the duration decides, and it says so.',
    choices,
  };
}

// ── packet ──────────────────────────────────────────────────────────────────

// ── replacing a role holder ─────────────────────────────────────────────────

/**
 * Groups a lead replacement may come from: ready paths first, then ones held up only by something unknown (a
 * right that cannot be established, an evaluation not yet complete). A hard block (Rights, Player Development,
 * injury) is never a lead.
 */
const READY: Record<string, number> = { open: 0, open_requires_clearing: 1, context_dependent: 2, role_concern: 3, indeterminate: 4, evaluation_incomplete: 5 };
const UPGRADE_ORDER: Record<string, number> = { clear_upgrade: 0, upgrade_uncertain: 1, marginal: 2 };

/**
 * For a flagged holder: compare each replacement with him lens by lens, choose the
 * lead replacement the plans assume, and follow each way of making room through to
 * what it does to the other groups. The comparison is the evaluator's, the moves'
 * legality is Player Rights', the plans only chain them.
 */
function replacementLayer(
  need: MlbNeed, view: ClubView, ports: ResponsePorts, role: RoleRef, candidates: ResponseCandidate[]
): { plans: Plan[]; lead: ResponseCandidate | null } {
  const subject = view.members.find((m) => m.playerId === need.subject?.playerId);
  if (!subject) return { plans: [], lead: null };
  const pitcher = role.kind === 'starting_pitcher' || role.kind === 'relief_pitcher';
  // A pitcher changing role is not compared (his tools would be read against another role's peers); a bench fielder is:
  // the position's grade is read from the position itself.
  const fielder = role.kind === 'position_player' || role.kind === 'catcher';
  const comparable = candidates.filter((c) => c.pathKind !== 'role_change' || fielder);
  const evidence = ports.holderEvidence([subject.playerId, ...comparable.map((c) => c.playerId)], role);
  const subjectOf = (id: number, name: string, age: number | null): ReviewSubject | null => {
    const e = evidence.get(id);
    return e ? { playerId: id, name, age, ...e } : null;
  };
  const incumbent = subjectOf(subject.playerId, subject.name, subject.age);
  for (const c of comparable) {
    const cand = subjectOf(c.playerId, c.name, c.age);
    c.comparison = cand && incumbent ? compareReplacement(cand, incumbent, pitcher, ports.reviewCalibration?.defenseWeights ?? undefined) : null;
  }

  // How the organization's philosophy leans between replacements (named reasons; ordering only, D-036).
  const subjectEstimate = evidence.get(subject.playerId) ? workingEstimate(evidence.get(subject.playerId) as LensEvidence, pitcher, ports.reviewCalibration?.defenseWeights ?? undefined) : null;
  for (const c of comparable) {
    const e = evidence.get(c.playerId);
    const est = e ? workingEstimate(e, pitcher, ports.reviewCalibration?.defenseWeights ?? undefined) : null;
    c.preference = c.comparison && ports.organization
      ? preferenceFor(ports.organization, {
        age: c.age, certainty: c.comparison.certainty, toolsPct: est?.ratingsPct ?? null, resultsPct: est?.resultsPct ?? null,
        batValue: est?.batValue ?? null, glovePct: est?.defensePct ?? null,
      }, { age: subject.age, batValue: subjectEstimate?.batValue ?? null, glovePct: subjectEstimate?.defensePct ?? null })
      : null;
  }

  // The lead replacement: the most ready path among real upgrades. Readiness first, then how firm the upgrade is, then (only among upgrades
  // within a band of each other) the organization's preference, then how big.
  const band = (c: ResponseCandidate) => tieBucket(c.comparison?.delta ?? null);
  const lead = comparable
    .filter((c) => c.group in READY && c.comparison && c.comparison.verdict in UPGRADE_ORDER)
    .sort((a, b) => READY[a.group] - READY[b.group]
      || UPGRADE_ORDER[(a.comparison as { verdict: string }).verdict] - UPGRADE_ORDER[(b.comparison as { verdict: string }).verdict]
      || band(b) - band(a)
      || (b.preference?.score ?? 0) - (a.preference?.score ?? 0)
      || ((b.comparison?.delta ?? 0) - (a.comparison?.delta ?? 0)) || a.name.localeCompare(b.name))[0] ?? null;

  const active = activeMembers(view);
  const rightsMap = ports.rights(active.map((m) => m.playerId));
  const affiliate = ports.optionAffiliateTeamId();
  const est = estimatorFrom(
    (ids, r, o) => ports.holderEvidence(ids, r, o),
    (id) => view.members.find((m) => m.playerId === id)?.role ?? null,
    ports.reviewCalibration?.defenseWeights ?? undefined
  );
  for (const kind of ['starting_pitcher', 'relief_pitcher'] as const) {
    const members = active.filter((m) => m.role?.kind === kind);
    if (members[0]?.role) est.prefetch(members.map((m) => m.playerId), members[0].role);
  }
  if (lead) est.prefetch([lead.playerId], role);
  const built = buildReplacementPlans({
    view, floors: ports.floors, subject, lead, estimate: est.estimate,
    rights: (id) => {
      const r = rightsMap.get(id)?.rights;
      return r ? { option: r.actions.option.status, designate: r.actions.designateForAssignment.status } : undefined;
    },
    clearing: (id) => {
      const m = active.find((x) => x.playerId === id);
      return m ? activeClearingOption(m, need, active, null, ports, rightsMap.get(id), affiliate) : undefined;
    },
    crossRole: (id, r) => ports.crossRole(id, r),
    lineup: fielder ? lineupPictureFor(view, ports) : null,
  });
  return { plans: orderPlans(built, ports.organization ?? null), lead };
}

const CERTAINTY_RANK: Record<string, number> = { open: 0, open_with_requirements: 1, indeterminate: 2, blocked: 3 };

/**
 * Plans in the order the club would look at them: how certain the path is comes first, always; among equally certain plans a contender sees the
 * biggest gain first and a club that is building or values depth sees the one that keeps every player first (D-036). Nothing is removed.
 */
function orderPlans(plans: Plan[], organization: OrganizationContext | null): Plan[] {
  const lean = planLean(organization);
  const gain = (p: Plan) => p.groups.reduce((best, g) => Math.max(best, g.change ?? -99), -99);
  const keeps = (p: Plan) => (p.id === 'designate' ? 1 : 0);
  return plans.map((p, i) => ({ p, i })).sort((a, b) =>
    (CERTAINTY_RANK[a.p.certainty] ?? 9) - (CERTAINTY_RANK[b.p.certainty] ?? 9)
    || (lean.by === 'gain' ? gain(b.p) - gain(a.p) : lean.by === 'keeps_everyone' ? keeps(a.p) - keeps(b.p) : 0)
    || a.i - b.i).map((x) => x.p);
}

/**
 * For a regular with a platoon problem: compare each possible partner with him against the hand he struggles with, choose the lead partner
 * (the most ready path among those who clearly fit), and state the platoon as a plan. The read is `platoon.ts`', legality is Player Rights'.
 */
function complementLayer(
  need: MlbNeed, view: ClubView, ports: ResponsePorts, role: RoleRef, candidates: ResponseCandidate[]
): { plans: Plan[]; lead: ResponseCandidate | null } {
  const subject = view.members.find((m) => m.playerId === need.subject?.playerId);
  const regular = need.platoon;
  if (!subject || !regular || regular.weakSide === null) return { plans: [], lead: null };
  const inputs = ports.platoon ? ports.platoon(candidates.map((c) => c.playerId)) : new Map<number, PlatoonInput>();
  const evidence = ports.holderEvidence([subject.playerId, ...candidates.map((c) => c.playerId)], role);
  const gloveOf = (id: number) => evidence.get(id)?.defense?.pct ?? null;
  for (const c of candidates) {
    const input = inputs.get(c.playerId);
    if (!input) { c.complement = null; continue; }
    const read = evaluatePlatoon(input);
    c.complement = {
      weakSide: regular.weakSide, fit: complementFit(regular, read),
      candidate: { vsLeft: read.vsLeft.expected, vsRight: read.vsRight.expected, verdict: read.verdict },
      glove: { candidate: gloveOf(c.playerId), regular: gloveOf(subject.playerId) },
    };
  }
  const lead = candidates
    .filter((c) => c.group in READY && c.complement?.fit.fits)
    .sort((a, b) => READY[a.group] - READY[b.group] || ((b.complement?.fit.advantage ?? 0) - (a.complement?.fit.advantage ?? 0)) || a.name.localeCompare(b.name))[0] ?? null;
  return { plans: buildComplementPlans({ view, subject, regular, lead, role }), lead };
}

export function buildResponsePacket(
  need: MlbNeed, view: ClubView, ports: ResponsePorts, contextOverride?: MlbAssignmentContext
): ResponsePacket {
  const base = {
    need, philosophyValues: ports.philosophy,
    semantics: { ranking: 'none' as const, ordering: 'stable_by_path_level_name' as const, decision: 'gm' as const },
  };

  if (need.kind === 'il_return_crunch') {
    const clearing = ilReturnPacket(need, view, ports);
    const unknowns = [...need.unknowns];
    if (clearing?.constraints.some((k) => k.classes.some((c) => c.options.some((o) => o.transaction === 'option' && o.rights.status === 'eligible' && o.farm === null)))) {
      unknowns.push("Minor League Operations could not evaluate the affiliate's roster, so what optioning a player does below is unknown.");
    }
    if (need.returning && need.returning.onFortyMan === null) {
      unknowns.push('Whether the returning player is on the 40-man is not known, so a 40-man spot cannot be ruled in or out.');
    }
    return { ...base, assignment: null, direction: 'clear', groups: [], clearing, report: buildStaffReport(need, view, ports, 'clear', clearing, []), notConsidered: [], unknowns };
  }

  const role = need.role;
  if (!role) {
    return {
      ...base, assignment: null, direction: 'role_needed', groups: [], clearing: null, report: null, notConsidered: [],
      unknowns: ['This need names no role, so Pennant cannot say who could fill it. Choose a role to explore.'],
    };
  }

  const assignment = contemplatedAssignment(need, contextOverride) as ContemplatedAssignment;
  const notConsidered = new Map<string, number>();
  const raws = discover(need, role, view, ports, notConsidered);
  const promotionIds = raws.filter((r) => r.pathKind !== 'role_change').map((r) => r.member.playerId);
  const rightsMap = ports.rights(promotionIds);
  const assessments = new Map(assignment.evaluated.map((c) => [c, ports.development(promotionIds, c)] as const));
  const assembled = raws.map((r) => assemble(r, need, role, view, ports, rightsMap, assignment, assessments));

  // A viable candidate who needs a roster spot: evaluate the ways to clear each constraint he needs, once, and attach
  // the chain. The two constraints are solved separately and never mixed.
  const stillLive = (c: ResponseCandidate) => !['unavailable', 'blocked_by_rights', 'blocked_by_development'].includes(c.group);
  const needsActive = assembled.some((c) => stillLive(c) && c.requiresClearing.active);
  const needsFortyMan = assembled.some((c) => stillLive(c) && c.requiresClearing.fortyMan);
  let clearing: ClearingPacket | null = null;
  const byConstraint = new Map<ClearingConstraint, ConstraintClearing>();
  if (needsActive || needsFortyMan) {
    const ids = [...new Set([...activeMembers(view).map((m) => m.playerId), ...view.members.filter((m) => m.onFortyMan === true).map((m) => m.playerId)])];
    const clearingRights = ports.rights(ids);
    // A candidate being brought in is never a way to clear his own spot; an injured one is not being brought in.
    const exclude = new Set(raws.filter((r) => r.pathKind !== 'role_change' && r.member.availability.status !== 'unavailable').map((r) => r.member.playerId));
    const constraints: ConstraintClearing[] = [];
    if (needsFortyMan) constraints.push(constraintClearing('forty_man', need, view, ports, clearingRights, exclude));
    if (needsActive) constraints.push(constraintClearing('active_roster', need, view, ports, clearingRights, exclude));
    for (const c of constraints) byConstraint.set(c.constraint, c);
    clearing = {
      returning: null, activation: null, constraints, chain: [], chainStatus: null,
      note: 'Some candidates need a roster spot cleared first. The active-roster spot and the 40-man spot are separate constraints with separate ways to clear them. Pennant lists options and their consequences; it does not rank them or choose.',
    };
  }
  const candidates = assembled.map((c) => withClearing(c, byConstraint, ports));
  const replacing = need.kind === 'role_holder_review' && need.subject !== undefined;
  const complementing = need.kind === 'platoon_complement' && need.subject !== undefined && need.platoon !== undefined;
  const replacement = replacing ? replacementLayer(need, view, ports, role, candidates) : complementing ? complementLayer(need, view, ports, role, candidates) : null;
  const direction: ResponsePacket['direction'] = replacing ? 'replace' : complementing ? 'complement' : 'fill';

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
    ...base, assignment, direction, groups, clearing,
    report: buildStaffReport(need, view, ports, direction, clearing, candidates, replacement ? { plans: replacement.plans, lead: replacement.lead } : {}),
    plans: replacement?.plans ?? null,
    context: readContext(ports.organization ?? null),
    notConsidered: [...notConsidered].map(([reason, count]) => ({ reason, count })),
    unknowns,
  };
}
