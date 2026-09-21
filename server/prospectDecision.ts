/**
 * Prospect development decision engine.
 *
 * This file intentionally knows nothing about SQLite or HTTP, and it knows
 * nothing about Organizational Philosophy: it receives normalized evidence about
 * a player and applies baseball-development rules to it. Player Development owns
 * what is developmentally defensible; how an organization PREFERS among
 * defensible choices is expressed separately (assignmentPreference.ts) and can
 * never reach this engine's thresholds, readiness, or recommendation.
 */

import type { EvidenceStatus, ScoutedAbility } from './scoutedEvidence.js';
import {
  missingAbilityEvidence,
  type MissingEvidence,
  type ValueRange,
} from './developmentJudgment.js';

export type ProspectKind = 'batter' | 'pitcher';

export type ProspectRecommendation =
  | 'hold'
  | 'watch'
  | 'consider_promotion'
  | 'strong_promotion_case'
  | 'mlb_ready_discussion'
  | 'consider_demotion'
  /**
   * The evidence available cannot establish which recommendation applies: a
   * required organization-visible rating is missing and the answer would differ
   * with it. This is a statement about evidence, not a hold.
   */
  | 'indeterminate';

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

  nextAssignment: ProspectNextAssignment | null;

  /** The next lower affiliate, when one exists. */
  demotionAssignment: ProspectNextAssignment | null;

  canDemote: boolean;
}

export interface ProspectDecision {
  /**
   * Whether the ratings behind `ratingsMaturity` were known. Unknown ratings
   * are unknown: no neutral maturity is substituted.
   */
  ratingsEvidence: EvidenceStatus;

  /** What is missing when ratings evidence is incomplete. */
  missingEvidence: MissingEvidence[];

  evidence: {
    performance: number;
    ageLevelUrgency: number;

    /** null when the organization-visible ratings it depends on are unknown. */
    ratingsMaturity: number | null;
    sampleConfidence: number;

    /** null when ratings maturity is unknown; see `readinessRange`. */
    readiness: number | null;

    /**
     * Every readiness this evidence is consistent with. It is the exact
     * readiness when ratings are known, and otherwise spans the model's own
     * range of ratings maturity — an outer bound, not an estimate.
     */
    readinessRange: ValueRange;
  };

  /**
   * The developmental thresholds this decision was made against. They come from
   * baseball-development rules and age/level context only; no organizational
   * preference enters them.
   */
  development: {
    /** Readiness a promotion must reach to be developmentally defensible. */
    promotionThreshold: number;

    /** How age relative to level moved the threshold from its base. */
    ageThresholdAdjustment: number;
  };

  /** Objective: poor production, a real sample, not young for the level. */
  demotionCase: boolean;

  recommendation: ProspectRecommendation;

  /** When `indeterminate`, the recommendations the missing evidence leaves open. */
  possibleRecommendations: Array<Exclude<ProspectRecommendation, 'indeterminate'>>;

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

/** The range of the maturity model itself, used only to bound readiness. */
const MATURITY_FLOOR = 20;
const MATURITY_CEILING = 90;

function ratingsMaturity(
  cur: number | null,
  pot: number | null
): number | null {
  if (cur === null || pot === null) return null;

  /*
   * We intentionally use only the current-to-potential GAP here.
   *
   * This is not an absolute talent/readiness grade. A low-ceiling player being
   * near his ceiling must not automatically become a promotion candidate.
   *
   * Instead this answers: how much of the development the organization's
   * scouts currently project for this player appears to remain? If either
   * rating is unknown the answer is unknown (null); no midpoint is used.
   */
  const gap = Math.max(0, pot - cur);

  return rounded(
    clamp(
      MATURITY_CEILING - gap * 2.8,
      MATURITY_FLOOR,
      MATURITY_CEILING
    )
  );
}

function confidenceLabel(
  sample: number
): ProspectDecision['confidence'] {
  if (sample >= 75) return 'high';
  if (sample >= 50) return 'moderate';
  return 'limited';
}

/** Readiness at which a promotion becomes developmentally defensible, before age context. */
export const DEVELOPMENTAL_PROMOTION_BASE = 76;

const readinessOf = (
  performance: number,
  maturity: number
): number =>
  rounded(
    performance * 0.75 +
    maturity * 0.25
  );

type DeterminateRecommendation =
  Exclude<ProspectRecommendation, 'indeterminate'>;

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
   * Production carries most of the weight; ratings maturity contributes useful
   * context without being allowed to override what the player is doing.
   * Age is deliberately NOT included: a 19-year-old dominating Double-A is not
   * less ready simply because he is young. Age changes how urgently the
   * organization needs to challenge him, not what he has demonstrated.
   *
   * Sample confidence is NOT part of readiness. It affects how confidently we
   * act on the score rather than changing the score itself.
   *
   * With ratings unknown there is no readiness — it is null, and the range it
   * could take is reported instead.
   */
  const readiness =
    maturity === null
      ? null
      : readinessOf(performance, maturity);

  const readinessRange: ValueRange =
    readiness !== null
      ? { min: readiness, max: readiness }
      : {
          min: readinessOf(performance, MATURITY_FLOOR),
          max: readinessOf(performance, MATURITY_CEILING),
        };

  /*
   * The developmental promotion threshold: a base of 76 readiness, raised by youth relative to the
   * level. It is a baseball-development rule, so it does not depend on the organization's
   * philosophy.
   *
   * Age relative to level changes URGENCY, not readiness.
   *
   * A player who is young for his level has developmental time, and may reasonably be asked to
   * clear a slightly higher bar before being pushed: there is a cost to challenging him early and
   * no cost to waiting. The effect is capped at five points so age context can break borderline
   * cases without overpowering what he has actually done.
   *
   * Being OLD for the level never lowers the bar. The earlier model read it as developmental
   * urgency and discounted the threshold by up to five points for it, which made a 29-year-old
   * hitting 1.304 at Double-A a promotion case on a bar of 71 — age arguing FOR a developmental
   * move. Age is not evidence about what a player has shown, and a player past his level's
   * developmental window raises an ORGANIZATIONAL question, not a developmental one:
   * `currentAssignment.ts` answers it and says so (D-044,
   * docs/MINOR_LEAGUE_OPERATIONS.md C-6). His promotion case, if he has one, rests entirely on
   * what he has done.
   */
  const ageThresholdAdjustment = Math.round(
    clamp((50 - agePressure) / 10, 0, 5)
  );

  const promotionThreshold = rounded(
    DEVELOPMENTAL_PROMOTION_BASE + ageThresholdAdjustment
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

  if (maturity === null) {
    cautions.push(
      'Organization-visible current/potential ratings are incomplete, so ratings maturity and readiness are unknown; no neutral value is substituted.'
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

  /*
   * Demotion remains intentionally difficult to trigger.
   *
   * It requires poor performance, a meaningful sample, and a player who is not
   * substantially young for his level. It rests on objective evidence only, so
   * unknown ratings cannot make or unmake it. Promotion aggressiveness does not
   * alter this rule; promotion philosophy and demotion patience are not the
   * same organizational trait.
   */
  const demotionCase =
    input.canDemote &&
    performance <= 25 &&
    sample >= 55 &&
    (input.ageDiff === null || input.ageDiff <= 0.5);

  const recommend = (
    atReadiness: number,
    threshold: number
  ): DeterminateRecommendation => {
    if (demotionCase) return 'consider_demotion';

    const considerThreshold = threshold - 8;
    const strongThreshold = threshold + 8;

    if (
      atReadiness >= threshold &&
      sample >= 45 &&
      input.nextAssignment?.isMajorLeague
    ) {
      /*
       * AAA -> MLB is not treated as an ordinary development promotion.
       * Roster need, 40-man status, options and service considerations belong
       * to the future MLB opportunity layer.
       */
      return 'mlb_ready_discussion';
    }

    if (
      atReadiness >= strongThreshold &&
      sample >= 60 &&
      input.nextAssignment
    ) {
      return 'strong_promotion_case';
    }

    if (
      atReadiness >= threshold &&
      sample >= 45 &&
      input.nextAssignment
    ) {
      return 'consider_promotion';
    }

    if (
      atReadiness >= considerThreshold ||
      (
        performance >= 70 &&
        sample < 45
      )
    ) {
      return 'watch';
    }

    return 'hold';
  };

  /*
   * With known ratings there is one answer. With unknown ratings, evaluate the
   * recommendation at both ends of the possible readiness. If they agree, the
   * missing evidence does not matter and the conclusion stands; otherwise it is
   * indeterminate. No preference is involved, so nothing but evidence can
   * settle it.
   */
  const outcomes = new Set<DeterminateRecommendation>(
    readiness !== null
      ? [recommend(readiness, promotionThreshold)]
      : [
          recommend(readinessRange.min, promotionThreshold),
          recommend(readinessRange.max, promotionThreshold),
        ]
  );

  const possibleRecommendations = [...outcomes];

  const recommendation: ProspectRecommendation =
    outcomes.size === 1
      ? possibleRecommendations[0]
      : 'indeterminate';

  if (recommendation === 'indeterminate') {
    cautions.push(
      'Which recommendation applies depends on ratings that are not available; the objective evidence above is still shown.'
    );
  } else if (recommendation === 'consider_demotion') {
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
    missingEvidence:
      maturity === null
        ? missingAbilityEvidence(input.ability)
        : [],

    evidence: {
      performance,
      ageLevelUrgency: agePressure,
      ratingsMaturity: maturity,
      sampleConfidence: sample,
      readiness,
      readinessRange,
    },

    development: {
      promotionThreshold,
      ageThresholdAdjustment,
    },

    demotionCase,

    recommendation,
    possibleRecommendations:
      recommendation === 'indeterminate'
        ? possibleRecommendations
        : [],

    confidence: confidenceLabel(sample),
    nextAssignment: input.nextAssignment,
    demotionAssignment: input.demotionAssignment,
    positives,
    cautions,
  };
}
