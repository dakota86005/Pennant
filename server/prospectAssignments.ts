import type {
  ProspectDecision,
  ProspectNextAssignment,
} from './prospectDecision.js';

/**
 * Developmental authorization only. Nothing in this file receives or reads
 * Organizational Philosophy: whether an assignment is defensible is a function
 * of evidence and baseball-development rules, so it is identical for every
 * organization. An organization's PREFERENCE among the defensible assignments is
 * expressed afterwards, in assignmentPreference.ts, which can annotate but never
 * change a judgment.
 */

import {
  atLeast,
  judgmentOf,
  type ConstraintState,
  type DevelopmentalJudgment,
  type MissingEvidence,
} from './developmentJudgment.js';

export type ProspectAssignmentKind =
  | 'normal_promotion'
  | 'skip_level_promotion'
  | 'demotion'
  | 'mlb_discussion';

/**
 * An organization's stance toward a developmentally DEFENSIBLE assignment. It is
 * not authorization: a disfavored assignment is exactly as defensible as a
 * preferred one.
 */
export type AssignmentPreference =
  | 'preferred'
  | 'acceptable'
  | 'disfavored';

export type ProspectAssignmentRecommendation =
  | 'not_recommended'
  | 'consider'
  | 'strong'
  | 'exceptional'
  | 'mlb_discussion'
  /** Player Development cannot yet say; see `judgment` and `missingEvidence`. */
  | 'indeterminate';

/**
 * One requirement an assignment must meet, and whether the evidence says it is.
 * A constraint that `requiresSubjectiveEvidence` is `unknown` while the
 * organization-visible ratings it depends on are missing.
 */
export interface AssignmentConstraint {
  id:
    | 'readiness'
    | 'performance'
    | 'ratings_maturity'
    | 'sample_confidence'
    | 'demotion_case'
    | 'engine_scope'
    | 'destination_fit';

  label: string;
  state: ConstraintState;
  requiresSubjectiveEvidence: boolean;
  detail: string;
}

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

  /**
   * Player Development's conclusion. `indeterminate` means a required
   * organization-visible rating is missing and the answer depends on it: the
   * assignment is neither approved nor rejected. It is not a hold, and the GM
   * may still choose to act.
   */
  judgment: DevelopmentalJudgment;

  /**
   * True only when `judgment` is `defensible`. `eligible: false` therefore does
   * NOT mean rejected — read `judgment`; `blockers` explains only a rejection.
   */
  eligible: boolean;

  recommendation: ProspectAssignmentRecommendation;

  /**
   * How this organization's philosophy regards the assignment among the
   * defensible alternatives. Always null here: authorization carries no
   * preference. Filled in by assignmentPreference.ts, and only for a defensible
   * assignment.
   */
  preference: AssignmentPreference | null;

  /** Every requirement, with its state. Objective evidence is shown either way. */
  constraints: AssignmentConstraint[];

  /** What evidence Player Development lacks; empty unless `indeterminate`. */
  missingEvidence: MissingEvidence[];

  evidence: {
    readiness: number | null;
    performance: number;
    ratingsMaturity: number | null;
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

  /**
   * Assignments Player Development cannot yet judge. Operations may surface
   * them and explain the roster need, but must not treat them as approved —
   * or as rejected.
   */
  indeterminate: ProspectAssignmentEvaluation[];
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

/**
 * Turns constraints into the evaluation fields that depend on them. Blockers
 * are the constraints known NOT to be met; unknown ones become missing
 * evidence and never a blocker.
 */
function conclude(
  decision: ProspectDecision,
  constraints: AssignmentConstraint[]
): {
  judgment: DevelopmentalJudgment;
  blockers: string[];
  missingEvidence: MissingEvidence[];
} {
  const judgment =
    judgmentOf(
      constraints.map(
        (constraint) => constraint.state
      )
    );

  const ratingsUnknown =
    constraints.some(
      (constraint) =>
        constraint.state === 'unknown' &&
        constraint.requiresSubjectiveEvidence
    );

  return {
    judgment,

    blockers:
      constraints
        .filter(
          (constraint) =>
            constraint.state === 'not_satisfied'
        )
        .map(
          (constraint) =>
            constraint.detail
        ),

    missingEvidence:
      judgment === 'indeterminate' && ratingsUnknown
        ? decision.missingEvidence
        : [],
  };
}

function promotionEvaluation(
  decision: ProspectDecision,
  target: ProspectNextAssignment,
  index: number
): ProspectAssignmentEvaluation {
  const readiness =
    decision.evidence.readiness;

  const readinessRange =
    decision.evidence.readinessRange;

  const performance =
    decision.evidence.performance;

  const ratingsMaturity =
    decision.evidence.ratingsMaturity;

  const sample =
    decision.evidence.sampleConfidence;

  /*
   * The developmental threshold: baseball-development rules plus age/level
   * context. No organizational preference enters it.
   */
  const baseThreshold =
    decision.development.promotionThreshold;

  const reasons: string[] = [];

  const constraints: AssignmentConstraint[] = [];

  /*
   * A comparison against the readiness the evidence supports: unknown while
   * ratings are, and decided by evidence alone.
   */
  const readinessConstraint = (
    required: number,
    unmetText: string,
    unknownText: string,
    metText: string
  ): AssignmentConstraint => {
    const state =
      atLeast(
        readinessRange,
        required
      );

    return {
      id: 'readiness',
      label: 'Readiness',
      state,
      requiresSubjectiveEvidence: true,
      detail:
        state === 'satisfied'
          ? metText
          : state === 'not_satisfied'
            ? unmetText
            : unknownText,
    };
  };

  /*
   * The nearest higher assignment is the ordinary promotion.
   *
   * AAA -> MLB remains a discussion rather than an ordinary minor-league move.
   */
  if (index === 0) {
    const requiredReadiness = baseThreshold;
    const requiredSample = 45;

    constraints.push(
      readinessConstraint(
        requiredReadiness,
        `Readiness ${readiness ?? `at most ${readinessRange.max}`} is below the developmental promotion threshold of ${requiredReadiness}.`,
        `Readiness cannot be established: it depends on organization-visible ratings that are unavailable (it lies between ${readinessRange.min} and ${readinessRange.max} against a threshold of ${requiredReadiness}).`,
        `Readiness ${readiness ?? readinessRange.min} clears the developmental threshold of ${requiredReadiness}.`
      )
    );

    constraints.push({
      id: 'sample_confidence',
      label: 'Evidence confidence',
      state:
        sample >= requiredSample
          ? 'satisfied'
          : 'not_satisfied',
      requiresSubjectiveEvidence: false,
      detail:
        sample >= requiredSample
          ? `Current-level evidence confidence ${sample} meets the minimum of ${requiredSample}.`
          : `Current-level evidence confidence ${sample} is below the minimum of ${requiredSample}.`,
    });

    const { judgment, blockers, missingEvidence } =
      conclude(decision, constraints);

    const eligible =
      judgment === 'defensible';

    if (eligible) {
      reasons.push(
        `Readiness ${readiness} clears the developmental threshold of ${requiredReadiness}.`
      );

      if (sample >= 60) {
        reasons.push(
          'The current-level sample is sufficient for a stronger assignment decision.'
        );
      }
    }

    const evidence = {
      readiness,
      performance,
      ratingsMaturity,
      sampleConfidence: sample,
    };

    const requirements = {
      readiness: requiredReadiness,
      performance: null,
      ratingsMaturity: null,
      sampleConfidence: requiredSample,
    };

    if (target.isMajorLeague) {
      return {
        kind: 'mlb_discussion',
        direction: 'promotion',
        target,
        levelsSkipped: 0,
        judgment,
        eligible,
        recommendation:
          judgment === 'defensible'
            ? 'mlb_discussion'
            : judgment === 'indeterminate'
              ? 'indeterminate'
              : 'not_recommended',

        preference: null,
        constraints,
        missingEvidence,
        evidence,
        requirements,

        reasons,
        blockers,
      };
    }

    const strong =
      eligible &&
      readiness !== null &&
      readiness >= requiredReadiness + 8 &&
      sample >= 60;

    return {
      kind: 'normal_promotion',
      direction: 'promotion',
      target,
      levelsSkipped: 0,
      judgment,
      eligible,

      recommendation:
        judgment === 'indeterminate'
          ? 'indeterminate'
          : !eligible
            ? 'not_recommended'
            : strong
              ? 'strong'
              : 'consider',

      preference: null,
      constraints,
      missingEvidence,
      evidence,
      requirements,

      reasons,
      blockers,
    };
  }

  /*
   * Skip-level promotions require qualitatively stronger evidence than an
   * ordinary one: at least ten points of readiness above the developmental
   * promotion threshold, with a hard floor. These are developmental rules and
   * are the same for every organization.
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

  const requiredReadiness =
    Math.min(
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
    constraints.push({
      id: 'engine_scope',
      label: 'Engine scope',
      state: 'not_satisfied',
      requiresSubjectiveEvidence: false,
      detail:
        'Skip-level promotion directly to MLB is not evaluated by the minor-league development engine.',
    });
  }

  constraints.push(
    readinessConstraint(
      requiredReadiness,
      `Readiness ${readiness ?? `at most ${readinessRange.max}`} is below the skip-level requirement of ${requiredReadiness}.`,
      `Readiness cannot be established: it depends on organization-visible ratings that are unavailable (it lies between ${readinessRange.min} and ${readinessRange.max} against a requirement of ${requiredReadiness}).`,
      `Readiness ${readiness ?? readinessRange.min} clears the exceptional assignment threshold of ${requiredReadiness}.`
    )
  );

  constraints.push({
    id: 'performance',
    label: 'Performance',
    state:
      performance >= requiredPerformance
        ? 'satisfied'
        : 'not_satisfied',
    requiresSubjectiveEvidence: false,
    detail:
      performance >= requiredPerformance
        ? `Performance evidence ${performance} is strong enough to support bypassing ${skipped} existing level${skipped === 1 ? '' : 's'}.`
        : `Performance evidence ${performance} is below the skip-level requirement of ${requiredPerformance}.`,
  });

  constraints.push({
    id: 'ratings_maturity',
    label: 'Ratings maturity',
    state:
      ratingsMaturity === null
        ? 'unknown'
        : ratingsMaturity >= requiredMaturity
          ? 'satisfied'
          : 'not_satisfied',
    requiresSubjectiveEvidence: true,
    detail:
      ratingsMaturity === null
        ? 'Ratings maturity cannot be established: the organization-visible current/potential ratings it depends on are unavailable.'
        : ratingsMaturity >= requiredMaturity
          ? `Ratings maturity ${ratingsMaturity} supports a substantially more challenging assignment.`
          : `Ratings maturity ${ratingsMaturity} suggests too much projected development remains to justify bypassing this level.`,
  });

  constraints.push({
    id: 'sample_confidence',
    label: 'Evidence confidence',
    state:
      sample >= requiredSample
        ? 'satisfied'
        : 'not_satisfied',
    requiresSubjectiveEvidence: false,
    detail:
      sample >= requiredSample
        ? `Evidence confidence ${sample} is sufficient for an exceptional move.`
        : `Evidence confidence ${sample} is below the skip-level requirement of ${requiredSample}.`,
  });

  const { judgment, blockers, missingEvidence } =
    conclude(decision, constraints);

  const eligible =
    judgment === 'defensible';

  if (eligible) {
    for (const constraint of constraints) {
      reasons.push(constraint.detail);
    }
  }

  return {
    kind: 'skip_level_promotion',
    direction: 'promotion',
    target,
    levelsSkipped: skipped,
    judgment,
    eligible,

    recommendation:
      judgment === 'defensible'
        ? 'exceptional'
        : judgment === 'indeterminate'
          ? 'indeterminate'
          : 'not_recommended',

    preference: null,
    constraints,
    missingEvidence,

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
  /*
   * A demotion case rests on objective evidence only — production, sample and
   * age relative to the level — so it never depends on ratings and can be
   * neither made nor unmade by unknown ones.
   */
  const eligible =
    decision.demotionCase;

  const constraints: AssignmentConstraint[] = [
    {
      id: 'demotion_case',
      label: 'Demotion case',
      state:
        eligible
          ? 'satisfied'
          : 'not_satisfied',
      requiresSubjectiveEvidence: false,
      detail:
        eligible
          ? 'The prospect decision engine independently identifies a defensible demotion case.'
          : 'Current developmental evidence does not independently support a demotion.',
    },
  ];

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
    judgment:
      eligible
        ? 'defensible'
        : 'indefensible',
    eligible,

    recommendation:
      eligible
        ? 'consider'
        : 'not_recommended',

    preference: null,
    constraints,
    missingEvidence: [],

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
      (evaluation) =>
        evaluation.judgment === 'defensible'
    ),
    indeterminate: evaluations.filter(
      (evaluation) =>
        evaluation.judgment === 'indeterminate'
    ),
  };
}
