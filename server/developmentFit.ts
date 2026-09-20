import type { Gloves, PositionRating } from './gloves.js';
import type { EvidenceStatus, ScoutedAbility } from './scoutedEvidence.js';
import {
  missingAbilityEvidence,
  type ConstraintState,
  type MissingEvidence,
} from './developmentJudgment.js';

export type DevelopmentProtectionTier =
  | 'core_prospect'
  | 'protected_prospect'
  | 'development_priority'
  | 'normal'
  | 'organizational_depth';

export type AssignmentUse =
  | 'preferred'
  | 'appropriate'
  | 'acceptable'
  | 'emergency_only'
  | 'not_established';

export interface DevelopmentProtectionInput {
  age: number;

  /**
   * The organization-visible ability evidence, from the scouted-evidence
   * adapter. A bare rating cannot be passed here, so protection cannot be
   * computed from a source the evidence boundary has not approved.
   */
  ability: ScoutedAbility;

  /**
   * Reserved for the future manual "protect this player" control.
   * The optimizer must never override this.
   */
  manuallyProtected?: boolean;
}

export interface DevelopmentProtection {
  /**
   * null when the organization-visible ratings are incomplete. No neutral value
   * is substituted: an unknown rating is unknown, not average.
   */
  score: number | null;

  /** null (indeterminate) when the score cannot be established. */
  tier: DevelopmentProtectionTier | null;

  manuallyProtected: boolean;

  /** Whether the ratings behind the score were fully known. */
  ratingEvidence: EvidenceStatus;

  /** What is missing when `tier` is null. */
  missingEvidence: MissingEvidence[];

  reasons: string[];
}

/** A protection whose score and tier were established from complete evidence. */
export type KnownProtection = DevelopmentProtection & {
  score: number;
  tier: DevelopmentProtectionTier;
};

export function hasKnownTier(
  protection: DevelopmentProtection
): protection is KnownProtection {
  return protection.tier !== null && protection.score !== null;
}

/**
 * For code that has already set indeterminate players aside. Reaching it with
 * an unknown tier is a bug, and it throws rather than pick a tier.
 */
export function requireKnownProtection(
  protection: DevelopmentProtection
): KnownProtection {
  if (!hasKnownTier(protection)) {
    throw new Error(
      'Indeterminate development protection reached a ranking that requires a known tier.'
    );
  }

  return protection;
}

/**
 * Whether a constraint on the protection tier holds: unknown while the tier is.
 */
export function protectionTierState(
  protection: DevelopmentProtection,
  holds: (tier: DevelopmentProtectionTier) => boolean
): ConstraintState {
  if (protection.tier === null) return 'unknown';

  return holds(protection.tier)
    ? 'satisfied'
    : 'not_satisfied';
}

export interface PositionAssignmentFit {
  position: number;
  code: string;
  currentRating: number;
  experience: number;
  isPrimary: boolean;

  /**
   * 0-100 suitability for using this as a meaningful developmental assignment.
   * This is deliberately stricter than emergency defensive coverage.
   */
  fit: number;

  use: AssignmentUse;
  reasons: string[];
}

const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value));

const rounded = (value: number): number =>
  Math.round(clamp(value));

function scoutingScale(value: number): number {
  /*
   * Ratings arrive already normalized to the 20-80 scouting scale by the
   * scouted-evidence adapter, whatever scale the save displays.
   *
   * 20 -> 0
   * 50 -> 50
   * 80 -> 100
   *
   * Only known ratings are scaled. An unknown rating never reaches this
   * function and is never given a value.
   */
  return clamp(((value - 20) / 60) * 100);
}

function youthScore(age: number): number {
  /*
   * Youth is not talent. It only describes how much developmental runway the
   * organization risks sacrificing by treating someone as disposable depth.
   */
  if (age <= 18) return 100;
  if (age === 19) return 95;
  if (age === 20) return 90;
  if (age === 21) return 82;
  if (age === 22) return 72;
  if (age === 23) return 60;
  if (age === 24) return 45;
  if (age === 25) return 30;
  if (age === 26) return 18;
  return 5;
}

/**
 * Developmental protection is intentionally independent of roster pressure.
 *
 * A player cannot become "less of a prospect" merely because an affiliate has
 * too many outfielders or not enough first basemen.
 */
export function evaluateDevelopmentProtection(
  input: DevelopmentProtectionInput
): DevelopmentProtection {
  const ratingEvidence = input.ability.status;
  const current = input.ability.current;
  const potentialRating = input.ability.potential;

  if (input.manuallyProtected) {
    return {
      score: 100,
      tier: 'core_prospect',
      manuallyProtected: true,
      ratingEvidence,
      missingEvidence: [],
      reasons: [
        'Manually protected by the front office.',
      ],
    };
  }

  const rawGap =
    current !== null && potentialRating !== null
      ? Math.max(0, potentialRating - current)
      : null;

  /*
   * Reasons that rest only on evidence that IS known are reported whether or
   * not the rest is: a known ceiling or a young age is still worth showing.
   */
  const reasons: string[] = [];

  if (potentialRating !== null && potentialRating >= 65) {
    reasons.push(
      `High-end projected ceiling (${potentialRating}/80).`
    );
  } else if (
    potentialRating !== null &&
    potentialRating >= 55
  ) {
    reasons.push(
      `Meaningful projected major-league upside (${potentialRating}/80).`
    );
  }

  if (rawGap !== null && rawGap >= 15) {
    reasons.push(
      `Substantial projected development remains (${rawGap} rating points).`
    );
  }

  if (input.age <= 21) {
    reasons.push(
      `Young player with significant developmental runway at age ${input.age}.`
    );
  }

  if (
    current !== null &&
    potentialRating !== null &&
    current >= 50 &&
    potentialRating >= 55
  ) {
    reasons.push(
      'Already combines useful present ability with meaningful ceiling.'
    );
  }

  /*
   * Protection weighs ceiling, present ability and the gap between them. If
   * either rating is unknown the score cannot be computed, and no neutral value
   * is put in its place: the protection is indeterminate, with the missing
   * evidence reported.
   */
  if (current === null || potentialRating === null) {
    reasons.push(
      'Developmental protection is indeterminate: the organization-visible current and/or potential ratings it depends on are unavailable, and no neutral value is substituted.'
    );

    return {
      score: null,
      tier: null,
      manuallyProtected: false,
      ratingEvidence,
      missingEvidence: missingAbilityEvidence(input.ability),
      reasons,
    };
  }

  const potential = scoutingScale(potentialRating);
  const currentScore = scoutingScale(current);

  /*
   * Remaining upside is useful, but potential itself matters much more.
   * We do not want a 25/45 player to outrank a nearly-developed 60/65 player
   * simply because the first player has a bigger gap.
   */
  const upside = clamp((Math.max(0, potentialRating - current) / 30) * 100);

  const youth = youthScore(input.age);

  const score = rounded(
    potential * 0.60 +
    upside * 0.20 +
    youth * 0.10 +
    currentScore * 0.10
  );

  let tier: DevelopmentProtectionTier;

  if (score >= 78) {
    tier = 'core_prospect';
  } else if (score >= 57) {
    tier = 'protected_prospect';
  } else if (score >= 42) {
    tier = 'development_priority';
  } else if (score >= 25) {
    tier = 'normal';
  } else {
    tier = 'organizational_depth';
  }

  if (reasons.length === 0) {
    reasons.push(
      'No exceptional developmental-protection signal is present.'
    );
  }

  return {
    score,
    tier,
    manuallyProtected: false,
    ratingEvidence,
    missingEvidence: [],
    reasons,
  };
}

function assignmentFitForRating(
  rating: PositionRating
): PositionAssignmentFit {
  const reasons: string[] = [];

  if (rating.isPrimary) {
    reasons.push('Listed primary position.');

    return {
      position: rating.position,
      code: rating.code,
      currentRating: rating.current,
      experience: rating.experience,
      isPrimary: true,
      fit: 100,
      use: 'preferred',
      reasons,
    };
  }

  /*
   * A secondary position has to earn the right to become a regular
   * developmental assignment. A non-zero OOTP rating is sufficient for
   * emergency coverage, but not sufficient for the optimizer to move a
   * prospect there merely to balance a roster.
   */
  let fit: number;
  let use: AssignmentUse;

  if (rating.current >= 60) {
    fit = 90;
    use = 'appropriate';
    reasons.push(
      `Strong established secondary-position rating (${rating.current}/80).`
    );
  } else if (rating.current >= 50) {
    fit = 80;
    use = 'appropriate';
    reasons.push(
      `Established secondary-position ability (${rating.current}/80).`
    );
  } else if (rating.current >= 40) {
    fit = 65;
    use = 'acceptable';
    reasons.push(
      `Playable secondary-position rating (${rating.current}/80).`
    );
  } else if (rating.current >= 35) {
    fit = 45;
    use = 'emergency_only';
    reasons.push(
      `Marginal secondary-position rating (${rating.current}/80); suitable for coverage, not a preferred developmental assignment.`
    );
  } else {
    fit = 20;
    use = 'emergency_only';
    reasons.push(
      `Low established rating (${rating.current}/80); emergency use only.`
    );
  }

  /*
   * Experience can confirm that a secondary position is real, but experience
   * cannot turn a poor defensive rating into a good developmental assignment.
   */
  if (rating.experience >= 150 && fit < 90) {
    fit = Math.min(90, fit + 5);
    reasons.push(
      'Substantial prior experience at the position.'
    );
  }

  return {
    position: rating.position,
    code: rating.code,
    currentRating: rating.current,
    experience: rating.experience,
    isPrimary: false,
    fit,
    use,
    reasons,
  };
}

export function evaluatePositionAssignments(
  profile: Gloves | null
): PositionAssignmentFit[] {
  if (!profile) return [];

  return profile.positions
    .filter((position) => position.position !== 1)
    .map(assignmentFitForRating)
    .sort(
      (a, b) =>
        b.fit - a.fit ||
        b.currentRating - a.currentRating
    );
}

/**
 * Minimum fit required before the roster optimizer may use a position as the
 * reason for a player's reassignment.
 *
 * Higher-protection players get increasingly strict treatment. Null when the
 * protection tier is indeterminate: the requirement is then unknown.
 */
export function minimumRegularAssignmentFit(
  protection: DevelopmentProtection
): number | null {
  switch (protection.tier) {
    case null:
      return null;

    case 'core_prospect':
      return 85;

    case 'protected_prospect':
      return 80;

    case 'development_priority':
      return 70;

    case 'normal':
      return 60;

    case 'organizational_depth':
      return 45;
  }
}

/**
 * Whether the assignment may be a regular one for this player. Unknown, not
 * refused, while the protection tier is indeterminate.
 */
export function canUseAsRegularAssignment(
  protection: DevelopmentProtection,
  assignment: PositionAssignmentFit
): ConstraintState {
  if (protection.manuallyProtected) {
    return assignment.use === 'preferred'
      ? 'satisfied'
      : 'not_satisfied';
  }

  const required =
    minimumRegularAssignmentFit(protection);

  if (required === null) return 'unknown';

  return assignment.fit >= required
    ? 'satisfied'
    : 'not_satisfied';
}
