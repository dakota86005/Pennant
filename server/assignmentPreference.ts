/**
 * Organizational Philosophy's say in an assignment: preference, never authority.
 *
 * Player Development decides which assignments are developmentally defensible
 * (prospectDecision.ts, prospectAssignments.ts, destinationFit.ts) without
 * knowing this organization's philosophy. This module runs AFTER that and does
 * one thing: among the assignments Player Development has already called
 * defensible, it says which the organization prefers.
 *
 * What that guarantees, by construction:
 *
 *   - It only annotates. Every judgment, constraint, blocker and eligibility
 *     flag comes out exactly as it went in.
 *   - It only looks at `defensible` assignments. An indefensible assignment
 *     cannot be preferred, and an indeterminate one is not ranked at all —
 *     philosophy cannot resolve missing evidence.
 *   - A disfavored assignment is exactly as defensible as a preferred one.
 *     Preference chooses among valid options; it does not make one invalid.
 *
 * The choice is between staying (patience) and the defensible promotion-direction
 * assignments, ordered by how much they challenge the player. Promotion
 * aggressiveness sets how far up that ordering the organization prefers to
 * reach. Demotion is not ranked: no philosophy dimension expresses demotion
 * patience yet ("promotion philosophy and demotion patience are not the same
 * trait").
 */

import type {
  AssignmentPreference,
  ProspectAssignmentEvaluation,
  ProspectAssignmentKind,
} from './prospectAssignments.js';

export type PreferenceStance = 'patience' | 'balanced' | 'advancement';

export interface PreferenceOption {
  /** 'stay' is remaining at the current level. */
  kind: 'stay' | ProspectAssignmentKind;
  targetLevelName: string | null;
  levelsSkipped: number;
  preference: AssignmentPreference;
}

export interface AssignmentPreferenceSummary {
  promotionAggressiveness: number;
  stance: PreferenceStance;

  /**
   * The option this organization prefers among the defensible ones; null when
   * there is nothing to choose between (no defensible promotion-direction
   * assignment).
   */
  preferred: PreferenceOption['kind'] | null;

  /** Only defensible options appear here, least to most challenging. */
  options: PreferenceOption[];

  notes: string[];
}

interface PlanLike<E extends ProspectAssignmentEvaluation> {
  evaluations: E[];
  eligible: E[];
  indeterminate: E[];
}

/** How much an option challenges the player: staying is 0, a normal promotion 1, each skip more. */
const challengeOf = (
  evaluation: ProspectAssignmentEvaluation
): number =>
  1 + evaluation.levelsSkipped;

const clampAggressiveness = (
  value: number
): number =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 50;

const stanceOf = (
  aggressiveness: number
): PreferenceStance =>
  aggressiveness <= 30
    ? 'patience'
    : aggressiveness >= 70
      ? 'advancement'
      : 'balanced';

/**
 * Annotate a plan of already-judged assignments with the organization's
 * preference. Returns a new plan; judgments are untouched.
 */
export function expressAssignmentPreference<
  E extends ProspectAssignmentEvaluation,
  P extends PlanLike<E>
>(
  plan: P,
  promotionAggressiveness: number
): P & { preference: AssignmentPreferenceSummary } {
  const aggressiveness =
    clampAggressiveness(
      promotionAggressiveness
    );

  const stance =
    stanceOf(aggressiveness);

  const notes: string[] = [];

  // Only defensible, promotion-direction assignments are choices to prefer among
  const candidates =
    plan.evaluations
      .filter(
        (evaluation) =>
          evaluation.judgment === 'defensible' &&
          evaluation.direction === 'promotion'
      )
      .sort(
        (a, b) =>
          challengeOf(a) -
          challengeOf(b)
      );

  const unranked =
    plan.evaluations.filter(
      (evaluation) =>
        evaluation.judgment === 'indeterminate'
    );

  if (unranked.length) {
    notes.push(
      'Assignments Player Development cannot yet judge are not ranked: philosophy cannot resolve missing evidence.'
    );
  }

  if (!candidates.length) {
    notes.push(
      'No promotion-direction assignment is developmentally defensible, so there is no choice for philosophy to express a preference about.'
    );

    return {
      ...plan,

      preference: {
        promotionAggressiveness: aggressiveness,
        stance,
        preferred: null,
        options: [],
        notes,
      },
    };
  }

  /*
   * Patience (staying) is always a valid alternative while a promotion is
   * defensible. Order the options by challenge and let aggressiveness pick a
   * position along them: 0 the most patient, 100 the most challenging. A tie
   * goes to the more challenging option, so a balanced organization advances
   * when advancing is defensible.
   */
  const ordered: Array<{
    kind: PreferenceOption['kind'];
    evaluation: ProspectAssignmentEvaluation | null;
  }> = [
    { kind: 'stay', evaluation: null },

    ...candidates.map(
      (evaluation) => ({
        kind: evaluation.kind,
        evaluation,
      })
    ),
  ];

  const target =
    (aggressiveness / 100) *
    (ordered.length - 1);

  let preferredIndex = 0;

  let bestDistance =
    Number.POSITIVE_INFINITY;

  ordered.forEach(
    (_, index) => {
      const distance =
        Math.abs(index - target);

      if (distance <= bestDistance) {
        bestDistance = distance;
        preferredIndex = index;
      }
    }
  );

  const labelFor = (
    index: number
  ): AssignmentPreference =>
    index === preferredIndex
      ? 'preferred'
      : Math.abs(index - preferredIndex) === 1
        ? 'acceptable'
        : 'disfavored';

  const byEvaluation =
    new Map<
      ProspectAssignmentEvaluation,
      AssignmentPreference
    >();

  const options: PreferenceOption[] =
    ordered.map(
      (option, index) => {
        const preference =
          labelFor(index);

        if (option.evaluation) {
          byEvaluation.set(
            option.evaluation,
            preference
          );
        }

        return {
          kind: option.kind,

          targetLevelName:
            option.evaluation
              ?.target.levelName ??
            null,

          levelsSkipped:
            option.evaluation
              ?.levelsSkipped ??
            0,

          preference,
        };
      }
    );

  /*
   * Annotate copies and re-derive the lists from the (unchanged) judgments.
   * `eligible` and `indeterminate` therefore contain exactly what they did
   * before.
   */
  const annotate = (
    evaluation: E
  ): E => {
    const preference =
      byEvaluation.get(evaluation);

    return preference
      ? { ...evaluation, preference }
      : evaluation;
  };

  const evaluations =
    plan.evaluations.map(annotate);

  return {
    ...plan,

    evaluations,

    eligible:
      evaluations.filter(
        (evaluation) =>
          evaluation.judgment === 'defensible'
      ),

    indeterminate:
      evaluations.filter(
        (evaluation) =>
          evaluation.judgment === 'indeterminate'
      ),

    preference: {
      promotionAggressiveness: aggressiveness,
      stance,
      preferred: ordered[preferredIndex].kind,
      options,
      notes,
    },
  };
}
