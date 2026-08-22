import type {
  ProspectDecision,
  ProspectNextAssignment,
} from './prospectDecision.js';

export type ProspectAssignmentKind =
  | 'normal_promotion'
  | 'skip_level_promotion'
  | 'demotion'
  | 'mlb_discussion';

export type ProspectAssignmentRecommendation =
  | 'not_recommended'
  | 'consider'
  | 'strong'
  | 'exceptional'
  | 'mlb_discussion';

export interface ProspectAssignmentEvaluation {
  kind: ProspectAssignmentKind;
  direction: 'promotion' | 'demotion';

  target: ProspectNextAssignment;

  /**
   * Existing organizational levels bypassed.
   *
   * Normal promotion = 0.
   * R -> AA when A exists = 1.
   * R -> AAA when A and AA exist = 2.
   */
  levelsSkipped: number;

  eligible: boolean;
  recommendation: ProspectAssignmentRecommendation;

  evidence: {
    readiness: number;
    performance: number;
    ratingsMaturity: number;
    sampleConfidence: number;
  };

  requirements: {
    readiness: number | null;
    performance: number | null;
    ratingsMaturity: number | null;
    sampleConfidence: number | null;
  };

  reasons: string[];
  blockers: string[];
}

export interface ProspectAssignmentPlan {
  evaluations: ProspectAssignmentEvaluation[];

  /**
   * Only developmentally defensible assignments.
   * Minor-league operations may choose among these, but may not create others.
   */
  eligible: ProspectAssignmentEvaluation[];
}

export interface ProspectAssignmentInput {
  decision: ProspectDecision;

  /**
   * All actual higher assignments in the organization, closest first.
   *
   * Example for Rookie:
   * A, AA, AAA, MLB
   */
  higherAssignments: ProspectNextAssignment[];

  /**
   * All actual lower assignments, closest first.
   */
  lowerAssignments: ProspectNextAssignment[];
}

function promotionEvaluation(
  decision: ProspectDecision,
  target: ProspectNextAssignment,
  index: number
): ProspectAssignmentEvaluation {
  const readiness =
    decision.evidence.readiness;

  const performance =
    decision.evidence.performance;

  const ratingsMaturity =
    decision.evidence.ratingsMaturity;

  const sample =
    decision.evidence.sampleConfidence;

  const baseThreshold =
    decision.organization.promotionThreshold;

  const reasons: string[] = [];
  const blockers: string[] = [];

  /*
   * The nearest higher assignment is the ordinary promotion.
   *
   * AAA -> MLB remains a discussion rather than an ordinary minor-league move.
   */
  if (index === 0) {
    const requiredReadiness = baseThreshold;
    const requiredSample = 45;

    if (readiness < requiredReadiness) {
      blockers.push(
        `Readiness ${readiness} is below the organizational promotion threshold of ${requiredReadiness}.`
      );
    }

    if (sample < requiredSample) {
      blockers.push(
        `Current-level evidence confidence ${sample} is below the minimum of ${requiredSample}.`
      );
    }

    const eligible = blockers.length === 0;

    if (eligible) {
      reasons.push(
        `Readiness ${readiness} clears the organizational threshold of ${requiredReadiness}.`
      );

      if (sample >= 60) {
        reasons.push(
          'The current-level sample is sufficient for a stronger assignment decision.'
        );
      }
    }

    if (target.isMajorLeague) {
      return {
        kind: 'mlb_discussion',
        direction: 'promotion',
        target,
        levelsSkipped: 0,
        eligible,
        recommendation:
          eligible
            ? 'mlb_discussion'
            : 'not_recommended',

        evidence: {
          readiness,
          performance,
          ratingsMaturity,
          sampleConfidence: sample,
        },

        requirements: {
          readiness: requiredReadiness,
          performance: null,
          ratingsMaturity: null,
          sampleConfidence: requiredSample,
        },

        reasons,
        blockers,
      };
    }

    const strong =
      eligible &&
      readiness >= requiredReadiness + 8 &&
      sample >= 60;

    return {
      kind: 'normal_promotion',
      direction: 'promotion',
      target,
      levelsSkipped: 0,
      eligible,

      recommendation:
        !eligible
          ? 'not_recommended'
          : strong
            ? 'strong'
            : 'consider',

      evidence: {
        readiness,
        performance,
        ratingsMaturity,
        sampleConfidence: sample,
      },

      requirements: {
        readiness: requiredReadiness,
        performance: null,
        ratingsMaturity: null,
        sampleConfidence: requiredSample,
      },

      reasons,
      blockers,
    };
  }

  /*
   * Skip-level promotions require qualitatively stronger evidence.
   *
   * Philosophy still matters because baseThreshold is philosophy-aware, but a
   * hard floor prevents an extremely aggressive organization from manufacturing
   * a skip-level case from merely adequate evidence.
   *
   * First skipped existing level:
   *   readiness >= at least 84
   *   performance >= 85
   *   maturity >= 55
   *   sample confidence >= 70
   *
   * Every additional skipped level becomes substantially harder.
   */
  const skipped = index;

  const requiredReadiness = Math.min(
    97,
    Math.max(
      84 + (skipped - 1) * 6,
      baseThreshold + 10 + (skipped - 1) * 6
    )
  );

  const requiredPerformance = Math.min(
    95,
    85 + (skipped - 1) * 5
  );

  const requiredMaturity = Math.min(
    75,
    55 + (skipped - 1) * 10
  );

  const requiredSample = Math.min(
    90,
    70 + (skipped - 1) * 10
  );

  /*
   * MLB is deliberately never a skip-level destination here.
   *
   * A -> MLB or AA -> MLB involves 40-man/26-man/options/service/role
   * questions and belongs to the major-league opportunity engine.
   */
  if (target.isMajorLeague) {
    blockers.push(
      'Skip-level promotion directly to MLB is not evaluated by the minor-league development engine.'
    );
  }

  if (readiness < requiredReadiness) {
    blockers.push(
      `Readiness ${readiness} is below the skip-level requirement of ${requiredReadiness}.`
    );
  }

  if (performance < requiredPerformance) {
    blockers.push(
      `Performance evidence ${performance} is below the skip-level requirement of ${requiredPerformance}.`
    );
  }

  if (ratingsMaturity < requiredMaturity) {
    blockers.push(
      `Ratings maturity ${ratingsMaturity} suggests too much projected development remains to justify bypassing this level.`
    );
  }

  if (sample < requiredSample) {
    blockers.push(
      `Evidence confidence ${sample} is below the skip-level requirement of ${requiredSample}.`
    );
  }

  const eligible = blockers.length === 0;

  if (eligible) {
    reasons.push(
      `Readiness ${readiness} clears the exceptional assignment threshold of ${requiredReadiness}.`
    );

    reasons.push(
      `Performance evidence ${performance} is strong enough to support bypassing ${skipped} existing level${skipped === 1 ? '' : 's'}.`
    );

    reasons.push(
      `Ratings maturity ${ratingsMaturity} supports a substantially more challenging assignment.`
    );

    reasons.push(
      `Evidence confidence ${sample} is sufficient for an exceptional move.`
    );
  }

  return {
    kind: 'skip_level_promotion',
    direction: 'promotion',
    target,
    levelsSkipped: skipped,
    eligible,

    recommendation:
      eligible
        ? 'exceptional'
        : 'not_recommended',

    evidence: {
      readiness,
      performance,
      ratingsMaturity,
      sampleConfidence: sample,
    },

    requirements: {
      readiness: requiredReadiness,
      performance: requiredPerformance,
      ratingsMaturity: requiredMaturity,
      sampleConfidence: requiredSample,
    },

    reasons,
    blockers,
  };
}

function demotionEvaluation(
  decision: ProspectDecision,
  target: ProspectNextAssignment
): ProspectAssignmentEvaluation {
  const eligible =
    decision.recommendation ===
    'consider_demotion';

  const blockers = eligible
    ? []
    : [
        'Current developmental evidence does not independently support a demotion.',
      ];

  const reasons = eligible
    ? [
        'The prospect decision engine independently identifies a defensible demotion case.',
        'Roster need may help choose the destination, but did not create the demotion case.',
      ]
    : [];

  return {
    kind: 'demotion',
    direction: 'demotion',
    target,
    levelsSkipped: 0,
    eligible,

    recommendation:
      eligible
        ? 'consider'
        : 'not_recommended',

    evidence: {
      readiness:
        decision.evidence.readiness,
      performance:
        decision.evidence.performance,
      ratingsMaturity:
        decision.evidence.ratingsMaturity,
      sampleConfidence:
        decision.evidence.sampleConfidence,
    },

    requirements: {
      readiness: null,
      performance: null,
      ratingsMaturity: null,
      sampleConfidence: null,
    },

    reasons,
    blockers,
  };
}

export function evaluateProspectAssignments(
  input: ProspectAssignmentInput
): ProspectAssignmentPlan {
  const evaluations: ProspectAssignmentEvaluation[] =
    [];

  for (
    let index = 0;
    index < input.higherAssignments.length;
    index++
  ) {
    evaluations.push(
      promotionEvaluation(
        input.decision,
        input.higherAssignments[index],
        index
      )
    );
  }

  /*
   * V1 demotion is deliberately one step at a time.
   *
   * If later evidence shows a player needs a larger reset, we can evaluate
   * skip-level demotions separately rather than assuming promotion logic is
   * symmetric.
   */
  const lower =
    input.lowerAssignments[0];

  if (lower) {
    evaluations.push(
      demotionEvaluation(
        input.decision,
        lower
      )
    );
  }

  return {
    evaluations,
    eligible: evaluations.filter(
      (evaluation) => evaluation.eligible
    ),
  };
}
