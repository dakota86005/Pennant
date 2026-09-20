/**
 * How Player Development represents "we do not know".
 *
 * A developmental constraint that depends on organization-visible scouting
 * evidence is in one of three states:
 *
 *   satisfied      the evidence establishes the constraint is met
 *   not_satisfied  the evidence establishes it is not met
 *   unknown        the required evidence is missing
 *
 * "Unknown" is not "average", "bad" or "good", and it is never converted into a
 * number. A judgment built from constraints is:
 *
 *   indefensible   at least one constraint is not_satisfied (a known negative
 *                  stands whatever else is unknown)
 *   indeterminate  none is not_satisfied, but at least one is unknown
 *   defensible     every constraint is satisfied
 *
 * `indeterminate` is a statement about evidence, not a decision. It does not
 * mean "protect", "hold", "block" or "approve": the GM may act despite it.
 * Organizational Philosophy never enters these judgments at all, so it cannot
 * resolve one.
 */

import type { ScoutedAbility } from './scoutedEvidence.js';

export type ConstraintState = 'satisfied' | 'not_satisfied' | 'unknown';

export type DevelopmentalJudgment = 'defensible' | 'indefensible' | 'indeterminate';

export function judgmentOf(states: readonly ConstraintState[]): DevelopmentalJudgment {
  if (states.includes('not_satisfied')) return 'indefensible';
  if (states.includes('unknown')) return 'indeterminate';
  return 'defensible';
}

/** What subjective evidence is missing, so a caller can say so. */
export interface MissingEvidence {
  dimension: 'current_ability' | 'potential_ability' | 'destination_comparison' | 'pitcher_structure';
  detail: string;
}

/** A candidate Operations could act on if Player Development were able to approve it. */
export interface IndeterminateMoveCandidate {
  playerId: number;
  playerName: string;
  kind: string;
  fromTeamId: number | null;
  fromTeam: string;
  toTeamId: number | null;
  toTeam: string;
  phase: 'development';
  developmentJudgment: 'indeterminate';
  /** The evidence Player Development would need before it could decide. */
  missingEvidence: MissingEvidence[];
  /** Why the destination wants somebody, independent of the development question. */
  rosterNeed: string[];
  reasons: string[];
}

export interface ValueRange {
  min: number;
  max: number;
}

/**
 * Whether a value known only to lie in `range` is at least `threshold`.
 * A degenerate range (min === max) is a known value.
 */
export function atLeast(range: ValueRange, threshold: number): ConstraintState {
  if (range.min >= threshold) return 'satisfied';
  if (range.max < threshold) return 'not_satisfied';
  return 'unknown';
}

/** The missing subjective evidence behind an ability that is not fully known. */
export function missingAbilityEvidence(ability: ScoutedAbility): MissingEvidence[] {
  const out: MissingEvidence[] = [];
  if (ability.current === null) {
    out.push({
      dimension: 'current_ability',
      detail: ability.missing.current.length
        ? `No organization-visible current rating for: ${ability.missing.current.join(', ')}.`
        : 'No organization-visible current ratings are available.',
    });
  }
  if (ability.potential === null) {
    out.push({
      dimension: 'potential_ability',
      detail: ability.missing.potential.length
        ? `No organization-visible potential rating for: ${ability.missing.potential.join(', ')}.`
        : 'No organization-visible potential ratings are available.',
    });
  }
  return out;
}
