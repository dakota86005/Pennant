/**
 * Prospect development decision engine.
 *
 * This file intentionally knows nothing about SQLite or HTTP. It receives
 * normalized evidence about a player and applies the organization's development
 * philosophy to that evidence.
 *
 * The important separation:
 *
 *   evidence/readiness = what the player has shown
 *   philosophy         = how readily this organization acts on that evidence
 *
 * Changing philosophy must never change a player's objective readiness score.
 */

import type { EvidenceStatus, ScoutedAbility } from './scoutedEvidence.js';

export type ProspectKind = 'batter' | 'pitcher';

export type ProspectRecommendation =
  | 'hold'
  | 'watch'
  | 'consider_promotion'
  | 'strong_promotion_case'
  | 'mlb_ready_discussion'
  | 'consider_demotion';

export interface ProspectNextAssignment {
  level: number;
  levelName: string;
  teams: Array<{
    teamId: number;
    label: string;
  }>;
  isMajorLeague: boolean;
}

export interface ProspectDecisionInput {
  kind: ProspectKind;

  /**
   * Relative production at the player's CURRENT level.
   *
   * Batter: OPS minus level-average OPS.
   * Pitcher: level-average ERA minus player ERA.
   */
  primaryPerformanceDiff: number;

  /**
   * Pitchers only: K% minus level-average K%.
   */
  secondaryPerformanceDiff?: number;

  pa?: number;
  ip?: number;

  /**
   * level average age minus player age.
   *
   * Positive = younger than the level.
   * Negative = older than the level.
   */
  ageDiff: number | null;

  /**
   * The organization-visible ability evidence, from the scouted-evidence
   * adapter. Only its current/potential composites are read here; a bare
   * rating from any other source cannot be supplied.
   */
  ability: ScoutedAbility;

  promotionAggressiveness: number;

  nextAssignment: ProspectNextAssignment | null;

  /** The next lower affiliate, when one exists. */
  demotionAssignment: ProspectNextAssignment | null;

  canDemote: boolean;
}

export interface ProspectDecision {
  /**
   * Whether the ratings behind `ratingsMaturity` were known. Unknown ratings
   * enter as a neutral maturity of 50 — a placeholder, not scouting evidence.
   */
  ratingsEvidence: EvidenceStatus;

  evidence: {
    performance: number;
    ageLevelUrgency: number;
    ratingsMaturity: number;
    sampleConfidence: number;
    readiness: number;
  };

  organization: {
    promotionAggressiveness: number;

    /** Threshold created by organizational philosophy alone. */
    basePromotionThreshold: number;

    /** How many points philosophy moved the neutral threshold. */
    philosophyThresholdAdjustment: number;

    /** How many points age/level context moved the action threshold. */
    ageThresholdAdjustment: number;

    /** Final threshold after philosophy and age/level urgency. */
    promotionThreshold: number;
  };

  recommendation: ProspectRecommendation;
  confidence: 'limited' | 'moderate' | 'high';

  nextAssignment: ProspectNextAssignment | null;
  demotionAssignment: ProspectNextAssignment | null;

  positives: string[];
  cautions: string[];
}

const clamp = (
  value: number,
  min = 0,
  max = 100
): number => Math.max(min, Math.min(max, value));

const rounded = (value: number): number =>
  Math.round(clamp(value));

function performanceEvidence(input: ProspectDecisionInput): number {
  if (input.kind === 'batter') {
    /*
     * 50 = exactly level-average OPS.
     * +.100 OPS ≈ 75.
     * +.200 OPS ≈ 100.
     * -.200 OPS ≈ 0.
     *
     * This is not intended to claim OPS has linear baseball value. It is an
     * interpretable evidence scale for how decisively a player is beating his
     * current level.
     */
    return rounded(50 + input.primaryPerformanceDiff * 250);
  }

  /*
   * Pitching uses two separate signals rather than letting ERA alone dictate
   * development decisions.
   *
   * ERA component:
   *   1 run better than level average ≈ 75
   *   2 runs better ≈ 100
   *
   * Strikeout component:
   *   +5 percentage points ≈ 75
   *   +10 points ≈ 100
   */
  const eraEvidence =
    clamp(50 + input.primaryPerformanceDiff * 25);

  const kEvidence =
    clamp(50 + (input.secondaryPerformanceDiff ?? 0) * 500);

  return rounded(eraEvidence * 0.7 + kEvidence * 0.3);
}

function sampleConfidence(input: ProspectDecisionInput): number {
  if (input.kind === 'batter') {
    const pa = input.pa ?? 0;

    /*
     * computeProspects already refuses to evaluate hitters below 60 PA.
     * At 60 PA we acknowledge that the evidence exists but remains weak.
     * Around 250 PA, the in-season development signal is treated as mature.
     */
    return rounded(
      25 + ((pa - 60) / 190) * 75
    );
  }

  const ip = input.ip ?? 0;

  /*
   * Same idea for pitchers:
   * 15 IP qualifies for evaluation;
   * about 60 IP produces high confidence in the season-level signal.
   */
  return rounded(
    25 + ((ip - 15) / 45) * 75
  );
}

function ageLevelPressure(ageDiff: number | null): number {
  if (ageDiff === null) return 50;

  /*
   * This is deliberately "pressure to move", not talent.
   *
   * A player two years younger than his level has time: ~20.
   * A player two years older than his level has more developmental urgency: ~80.
   *
   * This fixes an important conceptual problem in the old score, where being
   * young for a level actually increased the promotion score.
   */
  return rounded(50 - ageDiff * 15);
}

function ratingsMaturity(
  cur: number | null,
  pot: number | null
): number {
  if (cur === null || pot === null) return 50;

  /*
   * We intentionally use only the current-to-potential GAP here.
   *
   * This is not an absolute talent/readiness grade. A low-ceiling player being
   * near his ceiling must not automatically become a promotion candidate.
   *
   * Instead this answers: how much of the development the organization's
   * scouts currently project for this player appears to remain?
   */
  const gap = Math.max(0, pot - cur);

  return rounded(
    clamp(90 - gap * 2.8, 20, 90)
  );
}

function confidenceLabel(
  sample: number
): ProspectDecision['confidence'] {
  if (sample >= 75) return 'high';
  if (sample >= 50) return 'moderate';
  return 'limited';
}

export function evaluateProspectDecision(
  input: ProspectDecisionInput
): ProspectDecision {
  const performance = performanceEvidence(input);
  const agePressure = ageLevelPressure(input.ageDiff);
  const maturity = ratingsMaturity(input.ability.current, input.ability.potential);
  const ratingsEvidence = input.ability.status;
  const sample = sampleConfidence(input);

  /*
   * Objective development readiness.
   *
   * Production carries most of the weight.
   * Age/level context provides urgency.
   * Ratings maturity contributes useful context without being allowed to
   * override what the player is actually doing.
   *
   * Sample confidence is NOT part of readiness. It affects how confidently we
   * act on the score rather than changing the score itself.
   */
  /*
   * Objective development readiness.
   *
   * Age is deliberately NOT included here.
   *
   * A 19-year-old dominating Double-A is not less ready simply because he is
   * young. His age changes how urgently the organization needs to challenge
   * him, not what he has demonstrated on the field.
   *
   * Performance therefore carries most of the readiness grade, while ratings
   * maturity describes how much of the organization's scouted projected
   * development appears to remain.
   */
  const readiness = rounded(
    performance * 0.75 +
    maturity * 0.25
  );

  const aggressiveness =
    rounded(input.promotionAggressiveness);

  /*
   * The organization's development philosophy establishes the base threshold.
   *
   * Neutral organization: 76
   * Extremely conservative: 86
   * Extremely aggressive: 66
   */
  const basePromotionThreshold = rounded(
    76 - ((aggressiveness - 50) / 50) * 10
  );

  const philosophyThresholdAdjustment =
    76 - basePromotionThreshold;

  /*
   * Age relative to level changes URGENCY, not readiness.
   *
   * Younger-than-level players may reasonably be asked to clear a slightly
   * higher bar before moving. Older-than-level players face somewhat more
   * pressure to be challenged.
   *
   * The effect is intentionally capped at five points so age context can break
   * borderline cases without overpowering actual performance.
   */
  const ageThresholdAdjustment = Math.round(
    clamp((50 - agePressure) / 10, -5, 5)
  );

  const promotionThreshold = rounded(
    basePromotionThreshold + ageThresholdAdjustment
  );

  const positives: string[] = [];
  const cautions: string[] = [];

  if (performance >= 80) {
    positives.push('Production is dominating the current level.');
  } else if (performance >= 65) {
    positives.push('Production is clearly above the current level.');
  } else if (performance <= 25) {
    cautions.push('Production is well below the current level.');
  } else if (performance <= 40) {
    cautions.push('Production is below the current level.');
  }

  if (agePressure >= 70) {
    positives.push('Age relative to level creates pressure for a more challenging assignment.');
  } else if (agePressure <= 30) {
    cautions.push('The player is young for this level, so there is little developmental urgency.');
  }

  if (ratingsEvidence !== 'complete') {
    cautions.push(
      'Organization-visible current/potential ratings are incomplete, so ratings maturity is a neutral placeholder (50), not scouting evidence.'
    );
  } else if (maturity >= 75) {
    positives.push('Current and potential ratings suggest much of the projected development is already realized.');
  } else if (maturity <= 35) {
    cautions.push('The organization\'s scouted ratings still project substantial development between current and potential ability.');
  }

  if (sample < 50) {
    cautions.push('The current-level sample still provides limited confidence.');
  } else if (sample >= 75) {
    positives.push('The current-level sample is large enough to support a confident evaluation.');
  }

  if (aggressiveness >= 70) {
    positives.push('This organization is willing to act relatively early on convincing development evidence.');
  } else if (aggressiveness <= 30) {
    cautions.push('This organization generally requires stronger evidence before promoting prospects.');
  }

  let recommendation: ProspectRecommendation = 'hold';

  /*
   * Demotion remains intentionally difficult to trigger.
   *
   * It requires poor performance, a meaningful sample, and a player who is not
   * substantially young for his level. Promotion aggressiveness does not alter
   * this rule; promotion philosophy and demotion patience are not the same
   * organizational trait.
   */
  const demotionCase =
    input.canDemote &&
    performance <= 25 &&
    sample >= 55 &&
    (input.ageDiff === null || input.ageDiff <= 0.5);

  if (demotionCase) {
    recommendation = 'consider_demotion';
  } else {
    const considerThreshold = promotionThreshold - 8;
    const strongThreshold = promotionThreshold + 8;

    if (
      readiness >= promotionThreshold &&
      sample >= 45 &&
      input.nextAssignment?.isMajorLeague
    ) {
      /*
       * AAA -> MLB is not treated as an ordinary development promotion.
       * Roster need, 40-man status, options and service considerations belong
       * to the future MLB opportunity layer.
       */
      recommendation = 'mlb_ready_discussion';
    } else if (
      readiness >= strongThreshold &&
      sample >= 60 &&
      input.nextAssignment
    ) {
      recommendation = 'strong_promotion_case';
    } else if (
      readiness >= promotionThreshold &&
      sample >= 45 &&
      input.nextAssignment
    ) {
      recommendation = 'consider_promotion';
    } else if (
      readiness >= considerThreshold ||
      (
        performance >= 70 &&
        sample < 45
      )
    ) {
      recommendation = 'watch';
    }
  }

  if (recommendation === 'consider_demotion') {
    if (!input.demotionAssignment) {
      cautions.push(
        'No lower affiliate is available in the current organization structure.'
      );
    }
  } else if (!input.nextAssignment) {
    cautions.push(
      'No higher affiliate is available in the current organization structure.'
    );
  } else if (input.nextAssignment.isMajorLeague) {
    cautions.push(
      'The next assignment is MLB; roster opportunity and transaction consequences must be evaluated separately.'
    );
  }

  return {
    ratingsEvidence,
    evidence: {
      performance,
      ageLevelUrgency: agePressure,
      ratingsMaturity: maturity,
      sampleConfidence: sample,
      readiness,
    },

    organization: {
      promotionAggressiveness: aggressiveness,
      basePromotionThreshold,
      philosophyThresholdAdjustment,
      ageThresholdAdjustment,
      promotionThreshold,
    },

    recommendation,
    confidence: confidenceLabel(sample),
    nextAssignment: input.nextAssignment,
    demotionAssignment: input.demotionAssignment,
    positives,
    cautions,
  };
}
