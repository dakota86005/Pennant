/**
 * Phase 5: deterministic synthesis of complete organizational variants for one
 * current reactive MLB need. Earlier subsystems retain authority over
 * eligibility, transaction rules, and farm planning; this layer composes and
 * compares their outputs without selecting a transaction for the GM.
 */

import { analyzeOrganizationalConsequences, type MajorLeagueOrganizationalConsequences } from './majorLeagueOrganizationalConsequences.js';
import type { MajorLeagueNeed, MajorLeagueOperationsGap } from './majorLeagueOperations.js';
import { assembleInternalResponders, type InternalResponder, type InternalResponderAssembly, type InternalResponderExclusion } from './majorLeagueResponders.js';
import { majorLeagueRoleSuitability, type MajorLeagueRoleSuitabilityProfile } from './majorLeagueRoleSuitability.js';
import { planTransactionSolution, type TransactionSolution } from './majorLeagueTransactionPlan.js';
import type { MinorLeagueCascadePlan, MinorLeagueCascadeResult } from './minorLeagueCascadePlanner.js';
import { resolvePhilosophy, type EffectivePhilosophy, type PhilosophyDimensionId } from './philosophy.js';
import { philosophyForOrg } from './settings.js';

export type MajorLeagueSolutionCompleteness =
  | 'fully_actionable'
  | 'feasible_requires_gm_decision'
  | 'partial_organizational_solution'
  | 'indeterminate'
  | 'search_truncated'
  | 'ineligible';

export type MajorLeagueSolutionPreferenceTier =
  | 'preferred'
  | 'preferred_conditional'
  | 'strong_alternative'
  | 'viable_alternative'
  | 'conditional_alternative'
  | 'cannot_responsibly_compare'
  | 'excluded';

export type MajorLeaguePreferenceAxis =
  | 'role_style'
  | 'versatility'
  | 'need_horizon'
  | 'transaction_readiness'
  | 'farm_stability'
  | 'mlb_role_continuity';

export interface MajorLeagueSolutionReason {
  code: string;
  sentiment: 'supporting' | 'tradeoff' | 'unknown' | 'neutral';
  provenance: 'fact' | 'major_league_philosophy_interpretation' | 'delegated_minor_league_philosophy';
  owner: 'player_development' | 'role_suitability' | 'roster_transaction_engine' | 'minor_league_operations' | 'major_league_operations' | 'organizational_philosophy';
  message: string;
  axis?: MajorLeaguePreferenceAxis;
  philosophyDimension?: PhilosophyDimensionId;
  evidence: Record<string, unknown>;
}

export type MajorLeagueFarmVariant =
  | {
      kind: 'not_applicable' | 'stable_no_move';
      status: 'complete';
      cascadeStatus: MinorLeagueCascadeResult['status'] | null;
      plan: null;
      delegatedPreference: null;
      unknowns: Array<{ code: string; message: string }>;
    }
  | {
      kind: 'cascade_plan';
      status: MinorLeagueCascadePlan['status'];
      cascadeStatus: MinorLeagueCascadeResult['status'];
      plan: MinorLeagueCascadePlan;
      delegatedPreference: MinorLeagueCascadePlan['preference'];
      unknowns: Array<{ code: string; message: string }>;
    }
  | {
      kind: 'cascade_unresolved';
      status: 'partial' | 'truncated' | 'indeterminate';
      cascadeStatus: MinorLeagueCascadeResult['status'] | null;
      plan: null;
      delegatedPreference: null;
      unknowns: Array<{ code: string; message: string }>;
    };

export interface MajorLeagueSolutionVariant {
  id: string;
  need: MajorLeagueNeed;
  responder: InternalResponder;
  roleSuitability: MajorLeagueRoleSuitabilityProfile;
  development: InternalResponder['development'];
  transaction: TransactionSolution;
  consequences: MajorLeagueOrganizationalConsequences;
  farm: MajorLeagueFarmVariant;
  completeness: MajorLeagueSolutionCompleteness;
  unresolvedDecisions: TransactionSolution['correspondingDecisions'];
  facts: MajorLeagueSolutionReason[];
  philosophyInterpretations: MajorLeagueSolutionReason[];
  unknowns: MajorLeagueOperationsGap[];
  preference: {
    tier: MajorLeagueSolutionPreferenceTier;
    axes: Record<MajorLeaguePreferenceAxis, -1 | 0 | 1 | null>;
    dominatedByVariantIds: string[];
    tiedWithVariantIds: string[];
    ordering: 'stable_variant_id_non_preferential_within_equal_tier';
  };
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

export interface MajorLeagueSolutionComparison {
  need: MajorLeagueNeed;
  variants: MajorLeagueSolutionVariant[];
  excludedResponders: InternalResponderExclusion[];
  philosophy: {
    organizationId: number;
    mode: EffectivePhilosophy['mode'];
    dimensions: Pick<EffectivePhilosophy['dimensions'],
      'competitiveWindow' | 'riskTolerance' | 'promotionAggressiveness' | 'upsidePreference' |
      'defenseEmphasis' | 'pitchingDepth' | 'rosterDepth' | 'versatility'>;
    farmPreferenceOwnership: 'minor_league_operations_consumed_without_rescoring';
  };
  unknowns: MajorLeagueOperationsGap[];
  semantics: {
    unit: 'need_responder_transaction_consequence_specific_farm_variant';
    ordering: 'preference_tier_then_stable_variant_id';
    stableOrderingIsBaseballPreference: false;
    scoring: 'no_master_score_structured_non_dominance';
    finalDecision: 'gm';
  };
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

const AXES: MajorLeaguePreferenceAxis[] = [
  'role_style', 'versatility', 'need_horizon', 'transaction_readiness', 'farm_stability', 'mlb_role_continuity',
];

const neutralAxes = (): MajorLeagueSolutionVariant['preference']['axes'] => ({
  role_style: 0, versatility: 0, need_horizon: 0, transaction_readiness: 0, farm_stability: 0, mlb_role_continuity: 0,
});

function reason(
  code: string,
  sentiment: MajorLeagueSolutionReason['sentiment'],
  provenance: MajorLeagueSolutionReason['provenance'],
  owner: MajorLeagueSolutionReason['owner'],
  message: string,
  evidence: Record<string, unknown>,
  axis?: MajorLeaguePreferenceAxis,
  philosophyDimension?: PhilosophyDimensionId,
): MajorLeagueSolutionReason {
  return { code, sentiment, provenance, owner, message, evidence, ...(axis ? { axis } : {}), ...(philosophyDimension ? { philosophyDimension } : {}) };
}

function farmVariants(responder: InternalResponder, consequences: MajorLeagueOrganizationalConsequences): MajorLeagueFarmVariant[] {
  if (responder.source === 'active_mlb') {
    return [{ kind: 'not_applicable', status: 'complete', cascadeStatus: null, plan: null, delegatedPreference: null, unknowns: [] }];
  }
  const affiliate = consequences.sourceAffiliateConsequence;
  if (!affiliate) {
    return [{
      kind: 'cascade_unresolved', status: 'indeterminate', cascadeStatus: null, plan: null, delegatedPreference: null,
      unknowns: [{ code: 'source_affiliate_consequence_indeterminate', message: 'The responder has no readable source-affiliate consequence.' }],
    }];
  }
  const cascade = affiliate.downstreamResponse.cascade;
  if (affiliate.operationalProblem === 'none' && cascade.initialProblems.length === 0) {
    return [{ kind: 'stable_no_move', status: 'complete', cascadeStatus: cascade.status, plan: null, delegatedPreference: null, unknowns: cascade.unknowns }];
  }
  if (cascade.plans.length > 0) {
    return cascade.plans.map((plan) => ({
      kind: 'cascade_plan', status: plan.status, cascadeStatus: cascade.status, plan,
      delegatedPreference: plan.preference, unknowns: cascade.unknowns,
    }));
  }
  return [{
    kind: 'cascade_unresolved',
    status: cascade.status === 'truncated' ? 'truncated' : cascade.status === 'indeterminate' ? 'indeterminate' : 'partial',
    cascadeStatus: cascade.status, plan: null, delegatedPreference: null, unknowns: cascade.unknowns,
  }];
}

export function classifyMajorLeagueSolutionCompleteness(transaction: TransactionSolution, consequences: MajorLeagueOrganizationalConsequences, farm: MajorLeagueFarmVariant): MajorLeagueSolutionCompleteness {
  if (transaction.feasibility === 'ineligible') return 'ineligible';
  if (transaction.feasibility === 'indeterminate' || farm.status === 'indeterminate' || (transaction.unknowns.length > 0 && transaction.feasibility !== 'feasible_with_corresponding_decisions')) return 'indeterminate';
  if (farm.status === 'truncated' || farm.cascadeStatus === 'truncated') return 'search_truncated';
  if (farm.status === 'partial') return 'partial_organizational_solution';
  if (consequences.unresolvedMlbDecisions.length > 0 || transaction.feasibility === 'feasible_with_corresponding_decisions') return 'feasible_requires_gm_decision';
  return 'fully_actionable';
}

function variantFacts(
  responder: InternalResponder,
  transaction: TransactionSolution,
  consequences: MajorLeagueOrganizationalConsequences,
  farm: MajorLeagueFarmVariant,
  role: MajorLeagueRoleSuitabilityProfile,
): MajorLeagueSolutionReason[] {
  const facts: MajorLeagueSolutionReason[] = [
    reason('role_fit_established', 'supporting', 'fact', 'role_suitability', `${responder.name} has an established ${responder.roleFit.fit} fit for ${responder.roleFit.role.label}.`, { fit: responder.roleFit.fit, evidence: responder.roleFit.evidence }),
    reason('development_context', 'neutral', 'fact', 'player_development', responder.development?.message ?? 'Player Development does not apply to an active MLB reassignment.', { development: responder.development }),
  ];
  if (transaction.structuralFacts.usesExistingActiveMlbPlayer) {
    facts.push(reason('existing_active_mlb_player', 'supporting', 'fact', 'roster_transaction_engine', 'The responder is already active in MLB and requires no recall or 40-man action.', transaction.structuralFacts, 'transaction_readiness'));
  } else {
    facts.push(reason(
      transaction.structuralFacts.requiresFortyManAddition ? 'forty_man_addition_required' : 'forty_man_already_satisfied',
      transaction.structuralFacts.requiresFortyManAddition ? 'tradeoff' : 'supporting', 'fact', 'roster_transaction_engine',
      transaction.structuralFacts.requiresFortyManAddition ? 'The responder requires a 40-man addition.' : 'The responder is already on the 40-man roster.',
      transaction.structuralFacts, 'transaction_readiness',
    ));
  }
  for (const decision of transaction.correspondingDecisions) {
    facts.push(reason(`unresolved_${decision.kind}`, 'tradeoff', 'fact', 'roster_transaction_engine', decision.description, { decision }, 'transaction_readiness'));
  }
  if (consequences.mlbRoleConsequence.status === 'role_altered') {
    facts.push(reason('secondary_mlb_role_altered', 'tradeoff', 'fact', 'major_league_operations', consequences.mlbRoleConsequence.message, { consequence: consequences.mlbRoleConsequence }, 'mlb_role_continuity'));
  } else if (consequences.mlbRoleConsequence.status === 'role_unchanged') {
    facts.push(reason('mlb_role_unchanged', 'supporting', 'fact', 'major_league_operations', consequences.mlbRoleConsequence.message, { consequence: consequences.mlbRoleConsequence }, 'mlb_role_continuity'));
  }
  if (farm.kind === 'stable_no_move') {
    facts.push(reason('farm_stable_without_move', 'supporting', 'fact', 'minor_league_operations', 'The responder’s source affiliate remains stable without a downstream move.', { farm }, 'farm_stability'));
  } else if (farm.kind === 'cascade_plan') {
    const sentiment = farm.status === 'complete' ? 'supporting' : 'tradeoff';
    facts.push(reason('farm_cascade_plan', sentiment, 'fact', 'minor_league_operations', farm.status === 'complete'
      ? `Minor League Operations found a complete ${farm.plan.depth}-move farm cascade.`
      : `The ${farm.plan.depth}-move farm cascade leaves ${farm.plan.unresolvedProblems.length} unresolved problem(s).`, { plan: farm.plan }, 'farm_stability'));
    for (const delegated of farm.delegatedPreference?.reasons ?? []) {
      facts.push(reason('delegated_farm_preference', delegated.direction === 'supports' ? 'supporting' : 'neutral', 'delegated_minor_league_philosophy', 'minor_league_operations', delegated.message, { preferenceStatus: farm.delegatedPreference?.status, reason: delegated }, 'farm_stability', delegated.dimension));
    }
  } else if (farm.kind === 'cascade_unresolved') {
    facts.push(reason('farm_cascade_unresolved', farm.status === 'indeterminate' || farm.status === 'truncated' ? 'unknown' : 'tradeoff', 'fact', 'minor_league_operations', `The farm consequence is ${farm.status}; it is not a complete stabilization plan.`, { farm }, 'farm_stability'));
  }
  if (role.comparisonEvidence !== 'sufficient') {
    facts.push(reason('role_comparison_evidence_limited', role.comparisonEvidence === 'insufficient' ? 'unknown' : 'tradeoff', 'fact', 'role_suitability', `Role-style comparison evidence is ${role.comparisonEvidence}.`, { unknowns: role.unknowns }));
  }
  return facts;
}

function variantUnknowns(
  transaction: TransactionSolution,
  consequences: MajorLeagueOrganizationalConsequences,
  farm: MajorLeagueFarmVariant,
  role: MajorLeagueRoleSuitabilityProfile,
): MajorLeagueOperationsGap[] {
  const all = [
    ...transaction.unknowns, ...consequences.unknowns, ...farm.unknowns,
    ...role.unknowns.map((unknown) => ({ ...unknown, playerId: role.playerId })),
  ];
  return [...new Map(all.map((unknown) => [
    `${unknown.code}:${'playerId' in unknown ? unknown.playerId ?? '' : ''}:${unknown.message}`,
    unknown,
  ])).values()];
}

function baseAxes(variant: MajorLeagueSolutionVariant, philosophy: EffectivePhilosophy): MajorLeagueSolutionReason[] {
  const axes = variant.preference.axes;
  const interpretations: MajorLeagueSolutionReason[] = [];
  const dimension = (id: PhilosophyDimensionId) => philosophy.dimensions[id];
  const set = (axis: MajorLeaguePreferenceAxis, value: -1 | 0 | 1 | null, item?: MajorLeagueSolutionReason) => {
    axes[axis] = value;
    if (item) interpretations.push(item);
  };

  if (variant.transaction.feasibility === 'immediately_usable' || (variant.transaction.feasibility === 'feasible' && variant.unresolvedDecisions.length === 0)) {
    set('transaction_readiness', variant.transaction.structuralFacts.requiresFortyManAddition ? 0 : 1);
  } else if (variant.transaction.feasibility === 'feasible_with_corresponding_decisions') {
    set('transaction_readiness', -1, reason('roster_churn_tradeoff', 'tradeoff', 'major_league_philosophy_interpretation', 'organizational_philosophy', 'Required active/40-man choices make this less immediately usable, while the outgoing player remains a GM decision.', { decisions: variant.unresolvedDecisions, dimension: dimension('rosterDepth') }, 'transaction_readiness', 'rosterDepth'));
  } else if (variant.transaction.feasibility === 'indeterminate' || variant.transaction.feasibility === 'ineligible') {
    set('transaction_readiness', null);
  }

  if (variant.farm.kind === 'not_applicable' || variant.farm.kind === 'stable_no_move') set('farm_stability', 1);
  else if (variant.farm.kind === 'cascade_plan' && variant.farm.status === 'complete') {
    set('farm_stability', variant.farm.delegatedPreference?.status === 'alternative' ? 0 : 1);
  } else if (variant.farm.status === 'partial') set('farm_stability', -1);
  else set('farm_stability', null);

  if (variant.consequences.mlbRoleConsequence.status === 'role_altered') {
    const applicable = dimension(variant.need.role?.kind === 'starting_pitcher' || variant.need.role?.kind === 'relief_pitcher' ? 'pitchingDepth' : 'rosterDepth');
    const id = variant.need.role?.kind === 'starting_pitcher' || variant.need.role?.kind === 'relief_pitcher' ? 'pitchingDepth' : 'rosterDepth';
    set('mlb_role_continuity', applicable.value >= 55 ? -1 : 0, applicable.value >= 55
      ? reason('secondary_role_depth_cost', 'tradeoff', 'major_league_philosophy_interpretation', 'organizational_philosophy', 'The organization’s depth preference makes the altered secondary MLB role a meaningful tradeoff.', { consequence: variant.consequences.mlbRoleConsequence, dimension: applicable }, 'mlb_role_continuity', id)
      : undefined);
  } else if (variant.consequences.mlbRoleConsequence.status === 'role_unchanged') set('mlb_role_continuity', 1);

  const horizon = variant.need.horizon;
  const shortTemporary = horizon.kind === 'temporary' && horizon.expectedDays <= 30;
  const continuityOrCaution = dimension('rosterDepth').value >= 55 || dimension('riskTolerance').value <= 45 || dimension('promotionAggressiveness').value <= 45;
  const disruption = variant.transaction.structuralFacts.requiresFortyManAddition === true || variant.unresolvedDecisions.length > 0 || (variant.farm.kind === 'cascade_plan' && variant.farm.plan.depth > 0);
  if (shortTemporary && continuityOrCaution) {
    const value: -1 | 1 = disruption ? -1 : 1;
    set('need_horizon', value, reason('temporary_need_disruption_alignment', value > 0 ? 'supporting' : 'tradeoff', 'major_league_philosophy_interpretation', 'organizational_philosophy', value > 0
      ? `The ${horizon.expectedDays}-day need and the organization’s continuity/certainty posture support the lower-disruption path.`
      : `The ${horizon.expectedDays}-day need makes this path’s roster or farm disruption less attractive under the organization’s continuity/certainty posture.`,
      { horizon, disruption, rosterDepth: dimension('rosterDepth'), riskTolerance: dimension('riskTolerance'), promotionAggressiveness: dimension('promotionAggressiveness') }, 'need_horizon', 'rosterDepth'));
  } else if (horizon.kind === 'structural' && variant.development?.status === 'approved') {
    const supportsPromotion = dimension('promotionAggressiveness').value >= 55 || dimension('upsidePreference').value >= 55 || dimension('competitiveWindow').value <= 45;
    if (supportsPromotion) set('need_horizon', 1, reason('structural_need_development_alignment', 'supporting', 'major_league_philosophy_interpretation', 'organizational_philosophy', 'A structural vacancy makes a developmentally approved internal promotion more relevant under the organization’s promotion/upside posture.', { horizon, development: variant.development, promotionAggressiveness: dimension('promotionAggressiveness'), upsidePreference: dimension('upsidePreference'), competitiveWindow: dimension('competitiveWindow') }, 'need_horizon', 'promotionAggressiveness'));
  }
  return interpretations;
}

function relativeRoleAxes(variants: MajorLeagueSolutionVariant[], philosophy: EffectivePhilosophy): void {
  const defense = philosophy.dimensions.defenseEmphasis.value;
  const versatility = philosophy.dimensions.versatility.value;
  const comparable = variants.filter((variant) => variant.completeness !== 'ineligible' && variant.roleSuitability.comparisonEvidence !== 'insufficient');
  const applyRelative = (
    axis: 'role_style' | 'versatility',
    dimension: 'defenseEmphasis' | 'versatility',
    values: Array<{ variant: MajorLeagueSolutionVariant; value: number }>,
    preferHigh: boolean,
    code: string,
    label: string,
    minimumDifference: number,
  ) => {
    if (values.length < 2) return;
    const numbers = values.map((item) => item.value);
    const low = Math.min(...numbers);
    const high = Math.max(...numbers);
    if (high - low < minimumDifference) return;
    for (const item of values) {
      const favored = preferHigh ? item.value === high : item.value === low;
      const disfavored = preferHigh ? item.value === low : item.value === high;
      item.variant.preference.axes[axis] = favored ? 1 : disfavored ? -1 : 0;
      if (favored || disfavored) item.variant.philosophyInterpretations.push(reason(code, favored ? 'supporting' : 'tradeoff', 'major_league_philosophy_interpretation', 'organizational_philosophy', `${label}: ${item.value} is ${favored ? 'more' : 'less'} aligned among the defensible visible profiles.`, { value: item.value, low, high, dimension: philosophy.dimensions[dimension] }, axis, dimension));
    }
  };
  const positionPlayers = comparable.filter((variant) => variant.roleSuitability.positionPlayer !== null);
  if (defense >= 55) {
    applyRelative('role_style', 'defenseEmphasis', positionPlayers.flatMap((variant) => {
      const value = variant.roleSuitability.positionPlayer?.defense.targetRating;
      return value === null || value === undefined ? [] : [{ variant, value }];
    }), true, 'defense_style_alignment', 'Visible target-position defense', 5);
  } else if (defense <= 45) {
    applyRelative('role_style', 'defenseEmphasis', positionPlayers.flatMap((variant) => {
      const value = variant.roleSuitability.positionPlayer?.offense.currentRatingMean;
      return value === null || value === undefined ? [] : [{ variant, value }];
    }), true, 'offense_style_alignment', 'Visible current offensive profile', 5);
  }
  if (versatility >= 55) {
    applyRelative('versatility', 'versatility', positionPlayers.map((variant) => ({ variant, value: variant.roleSuitability.positionPlayer!.defense.visiblePlayablePositions })), true, 'versatility_alignment', 'Visible playable-position count', 1);
  } else if (versatility <= 45) {
    applyRelative('versatility', 'versatility', positionPlayers.map((variant) => ({ variant, value: variant.responder.roleFit.fit === 'direct' ? 1 : 0 })), true, 'specialist_alignment', 'Direct primary-role fit', 1);
  }
}

function dominates(left: MajorLeagueSolutionVariant, right: MajorLeagueSolutionVariant): boolean {
  let better = false;
  for (const axis of AXES) {
    const a = left.preference.axes[axis];
    const b = right.preference.axes[axis];
    if (a === null || b === null) continue;
    if (a < b) return false;
    if (a > b) better = true;
  }
  return better;
}

function applyPreference(variants: MajorLeagueSolutionVariant[], philosophy: EffectivePhilosophy): void {
  for (const variant of variants) variant.philosophyInterpretations.push(...baseAxes(variant, philosophy));
  relativeRoleAxes(variants, philosophy);
  const stable = [...variants].sort((left, right) => left.id.localeCompare(right.id));
  for (const variant of stable) {
    if (variant.completeness === 'ineligible') {
      variant.preference.tier = 'excluded';
      continue;
    }
    if (variant.completeness === 'indeterminate' || variant.completeness === 'search_truncated' || variant.roleSuitability.comparisonEvidence === 'insufficient') {
      variant.preference.tier = 'cannot_responsibly_compare';
      continue;
    }
    const eligiblePeers = stable.filter((peer) => peer.id !== variant.id && peer.preference.tier !== 'excluded' && peer.completeness !== 'indeterminate' && peer.completeness !== 'search_truncated' && peer.roleSuitability.comparisonEvidence !== 'insufficient');
    variant.preference.dominatedByVariantIds = eligiblePeers.filter((peer) => dominates(peer, variant)).map((peer) => peer.id);
    variant.preference.tiedWithVariantIds = eligiblePeers.filter((peer) => !dominates(peer, variant) && !dominates(variant, peer) && AXES.every((axis) => peer.preference.axes[axis] === variant.preference.axes[axis])).map((peer) => peer.id);
    if (variant.preference.dominatedByVariantIds.length === 0) {
      variant.preference.tier = variant.completeness === 'fully_actionable' ? 'preferred' : 'preferred_conditional';
    } else if (variant.completeness !== 'fully_actionable') {
      variant.preference.tier = 'conditional_alternative';
    } else {
      variant.preference.tier = variant.preference.dominatedByVariantIds.length === 1 ? 'strong_alternative' : 'viable_alternative';
    }
  }
}

function buildVariants(need: MajorLeagueNeed, responders: InternalResponder[]): MajorLeagueSolutionVariant[] {
  const variants: MajorLeagueSolutionVariant[] = [];
  for (const responder of [...responders].sort((left, right) => left.playerId - right.playerId)) {
    const transaction = planTransactionSolution(need, responder);
    const consequences = analyzeOrganizationalConsequences(need, responder, transaction);
    const roleSuitability = majorLeagueRoleSuitability(need, responder);
    for (const farm of farmVariants(responder, consequences)) {
      const farmIdentity = farm.kind === 'cascade_plan' ? farm.plan.stateId : farm.kind;
      const id = `${need.id}:responder:${responder.playerId}:farm:${farmIdentity}`;
      const classification = classifyMajorLeagueSolutionCompleteness(transaction, consequences, farm);
      variants.push({
        id, need, responder, roleSuitability, development: responder.development, transaction, consequences, farm,
        completeness: classification, unresolvedDecisions: transaction.correspondingDecisions,
        facts: variantFacts(responder, transaction, consequences, farm, roleSuitability), philosophyInterpretations: [],
        unknowns: variantUnknowns(transaction, consequences, farm, roleSuitability),
        preference: { tier: classification === 'ineligible' ? 'excluded' : 'cannot_responsibly_compare', axes: neutralAxes(), dominatedByVariantIds: [], tiedWithVariantIds: [], ordering: 'stable_variant_id_non_preferential_within_equal_tier' },
        scoutingValuePolicy: 'prohibited_pending_provenance',
      });
    }
  }
  return variants;
}

/**
 * Compose legitimate responders supplied by Phase 2. This export keeps tests
 * and future orchestration explicit; callers must not manufacture responders
 * that bypass the Player Development gate.
 */
export function synthesizeMajorLeagueSolutionsForResponders(
  need: MajorLeagueNeed,
  responders: InternalResponder[],
  excludedResponders: InternalResponderExclusion[] = [],
  assemblyUnknowns: MajorLeagueOperationsGap[] = [],
): MajorLeagueSolutionComparison {
  const philosophy = resolvePhilosophy(philosophyForOrg(need.organizationId));
  const variants = buildVariants(need, responders);
  applyPreference(variants, philosophy);
  const tierOrder: Record<MajorLeagueSolutionPreferenceTier, number> = {
    preferred: 0, preferred_conditional: 1, strong_alternative: 2, viable_alternative: 3,
    conditional_alternative: 4, cannot_responsibly_compare: 5, excluded: 6,
  };
  variants.sort((left, right) => tierOrder[left.preference.tier] - tierOrder[right.preference.tier] || left.id.localeCompare(right.id));
  const usedDimensions = philosophy.dimensions;
  return {
    need, variants, excludedResponders: [...excludedResponders].sort((left, right) => left.playerId - right.playerId),
    philosophy: {
      organizationId: need.organizationId, mode: philosophy.mode,
      dimensions: {
        competitiveWindow: usedDimensions.competitiveWindow,
        riskTolerance: usedDimensions.riskTolerance,
        promotionAggressiveness: usedDimensions.promotionAggressiveness,
        upsidePreference: usedDimensions.upsidePreference,
        defenseEmphasis: usedDimensions.defenseEmphasis,
        pitchingDepth: usedDimensions.pitchingDepth,
        rosterDepth: usedDimensions.rosterDepth,
        versatility: usedDimensions.versatility,
      },
      farmPreferenceOwnership: 'minor_league_operations_consumed_without_rescoring',
    },
    unknowns: [...assemblyUnknowns],
    semantics: {
      unit: 'need_responder_transaction_consequence_specific_farm_variant',
      ordering: 'preference_tier_then_stable_variant_id', stableOrderingIsBaseballPreference: false,
      scoring: 'no_master_score_structured_non_dominance', finalDecision: 'gm',
    },
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
}

/** Construct and compare all legitimate internal solutions for one open need. */
export function synthesizeMajorLeagueSolutions(need: MajorLeagueNeed): MajorLeagueSolutionComparison {
  const assembly: InternalResponderAssembly = assembleInternalResponders(need);
  return synthesizeMajorLeagueSolutionsForResponders(
    need,
    [...assembly.activeRosterResponders, ...assembly.minorLeagueCallUpResponders],
    assembly.minorLeagueExclusions,
    assembly.unknowns,
  );
}
