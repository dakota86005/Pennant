/**
 * Is the level a player is at still developing him?
 *
 * Player Development owns this, and it is a different question from "has he earned a promotion".
 * The farm v1 model only asked the second one, through a single readiness score, so the only way to
 * say anything about a player standing still was to recommend moving him. Measured on the real
 * import that produced a 29-year-old at Double-A as a `consider_promotion` with the promotion bar
 * LOWERED five points because he was four years older than his level — the model read age as
 * developmental urgency (docs/MINOR_LEAGUE_OPERATIONS.md C-6).
 *
 * Age does not change what a player has shown. It changes how much developmental time is left, and
 * therefore what the assignment is FOR. Two separate readings, both shown:
 *
 *   level standing        what his results say about the league he is in
 *   developmental window  how much developmental runway the level still has for him
 *
 * A 19-year-old struggling at Double-A is on schedule. A 29-year-old dominating Double-A has
 * nothing left to learn there, and whether he moves is an organizational question, not a
 * developmental one. The model must be able to say both, and neither is a transaction.
 *
 * Pure. No philosophy (D-019): the same evidence gives the same reading at every club. No table, no
 * rating column — ability evidence arrives as a `ScoutedAbility` from the adapter (D-017), and
 * missing evidence stays missing (D-018).
 */

import { AGE_LEVEL_DEVELOPMENT_LIMIT, OLD_FOR_LEVEL, YOUNG_FOR_LEVEL } from './farmCalibration.js';
import type { DevelopmentProtectionTier } from './developmentFit.js';
import type { MissingEvidence } from './developmentJudgment.js';

/** What his results say about the league he is playing in. Objective; ratings are not an input. */
export type LevelStanding =
  /** Clearly better than the league, over a sample that supports the claim. */
  | 'mastered'
  /** Holding his own: neither clearly ahead of the league nor clearly behind it. */
  | 'holding'
  /** Clearly worse than the league, over a sample that supports the claim. */
  | 'overmatched'
  /** The sample, the league population or the season is not enough to say. */
  | 'indeterminate';

/** How much developmental runway the level still has for him. */
export type DevelopmentalWindow =
  /** Young for the level: time to develop here. */
  | 'ample'
  /** Ordinary for the level. */
  | 'normal'
  /** Old for the level: the level is running out of developmental value for him. */
  | 'closing'
  /**
   * Far enough past the level's age that the assignment is no longer primarily developmental. He
   * may still be the right player for the club; the reason would be organizational.
   */
  | 'closed'
  /** The level's own age profile could not be established. */
  | 'indeterminate';

export type CurrentAssignmentVerdict =
  /** The level is still developing him. */
  | 'appropriate'
  /** The level is beyond him: the evidence supports a less demanding assignment. */
  | 'too_advanced'
  /** He has nothing left to learn here. Whether he moves is a separate question. */
  | 'no_longer_developmental'
  /** Required evidence is missing and the answer depends on it. */
  | 'indeterminate'
  /**
   * There is no evidence to read at all — no line at this level, a season that has barely started.
   * Distinct from `indeterminate`: nothing is missing that scouting could supply, the season has
   * simply not happened yet.
   */
  | 'not_assessable';

export interface CurrentAssignmentInput {
  /** Percentile among the league's own qualified players of his kind; null when it cannot be taken. */
  leaguePercentile: number | null;

  /** How far the current-level line can be trusted on its own, 0 to 1. */
  reliability: number;

  /** Why no percentile exists, when there is none. */
  unassessable: string | null;

  /**
   * The level's average age minus his, from ROSTERED players at the level. Positive = younger than
   * the level. null when the level's age profile is unavailable.
   */
  ageRelativeToLevel: number | null;

  /** Player Development's protection tier; null when indeterminate (D-018). */
  tier: DevelopmentProtectionTier | null;

  /** What ability evidence is missing, for an indeterminate reading. */
  missingEvidence: MissingEvidence[];

  /** Whether a less demanding affiliate exists in the organization at all. */
  canDemote: boolean;
}

export interface CurrentAssignmentRead {
  verdict: CurrentAssignmentVerdict;
  standing: LevelStanding;
  window: DevelopmentalWindow;

  /** Every reading, with the evidence behind it, so nothing has to be reconstructed from prose. */
  parts: Array<{ label: string; value: string; basis: string }>;

  /** Why the verdict is what it is. */
  reasons: string[];

  /**
   * Whether the question the verdict raises is a developmental one or an organizational one. A
   * player whose window is closed and who has mastered the level raises an organizational question:
   * Player Development has nothing further to say about him at this level.
   */
  question: 'developmental' | 'organizational' | 'none';

  missingEvidence: MissingEvidence[];
  unknowns: string[];
}

/**
 * Where "clearly better" and "clearly worse" than the league sit, and how much sample a claim
 * needs. Policy: they say when to raise something, not how baseball works, so no backtest can call
 * them optimal (D-041).
 *
 * A percentile line flags a fixed share of the league by construction — the defect D-040 was written
 * about. At the 70th percentile "he has nothing left to learn here" was true of 30% of every league
 * and of eight of Reno's twenty-two assessed players, which is not what the words mean. "Clearly
 * better than the league" is the top sixth and "clearly worse" the bottom sixth, so the statement is
 * a strong one and the count follows from the claim rather than the claim from the count.
 */
const CLEARLY_ABOVE_PERCENTILE = 84;
const CLEARLY_BELOW_PERCENTILE = 16;

/**
 * How much sample a CLAIM about the level needs, and how little makes the line unreadable.
 *
 * Holding his own is the null reading, not a finding: moving off it in either direction is a claim
 * and needs both a clear gap and a sample worth something. Between the two figures the line is read,
 * and the strongest thing it supports is "holding his own" — which is honest about a reliever with
 * twenty innings whose rate happens to be extreme. Below the floor there is nothing to read at all.
 *
 * At the stabilization constants these are about 105 plate appearances (a claim) and 45 (readable)
 * for a hitter, and about 26 and 11 innings for a pitcher. Policy.
 */
const CLAIM_RELIABILITY = 0.3;
const READABLE_RELIABILITY = 0.15;

function standingOf(input: CurrentAssignmentInput): LevelStanding {
  if (input.leaguePercentile === null) return 'indeterminate';
  if (input.reliability < READABLE_RELIABILITY) return 'indeterminate';
  if (input.reliability < CLAIM_RELIABILITY) return 'holding';
  if (input.leaguePercentile >= CLEARLY_ABOVE_PERCENTILE) return 'mastered';
  if (input.leaguePercentile <= CLEARLY_BELOW_PERCENTILE) return 'overmatched';
  return 'holding';
}

function windowOf(ageRelativeToLevel: number | null): DevelopmentalWindow {
  if (ageRelativeToLevel === null) return 'indeterminate';
  if (ageRelativeToLevel >= YOUNG_FOR_LEVEL) return 'ample';
  if (-ageRelativeToLevel >= AGE_LEVEL_DEVELOPMENT_LIMIT) return 'closed';
  if (-ageRelativeToLevel >= OLD_FOR_LEVEL) return 'closing';
  return 'normal';
}

const windowText: Record<DevelopmentalWindow, string> = {
  ample: 'young for the level, with developmental time here',
  normal: 'ordinary for the level',
  closing: 'old for the level; its developmental value to him is running out',
  closed: 'far enough past the level\'s age that the assignment is no longer primarily developmental',
  indeterminate: 'the level\'s own age profile could not be established',
};

const standingText: Record<LevelStanding, string> = {
  mastered: 'clearly better than the league',
  holding: 'holding his own in the league',
  overmatched: 'clearly worse than the league',
  indeterminate: 'not established',
};

export function evaluateCurrentAssignment(input: CurrentAssignmentInput): CurrentAssignmentRead {
  const standing = standingOf(input);
  const window = windowOf(input.ageRelativeToLevel);

  const parts: CurrentAssignmentRead['parts'] = [
    {
      label: 'Level standing',
      value: standingText[standing],
      basis:
        input.leaguePercentile !== null
          ? `${input.leaguePercentile}th percentile among the league's own qualified players, on ${Math.round(input.reliability * 100)}% trusted sample.`
          : (input.unassessable ?? 'No comparable production at this level.'),
    },
    {
      label: 'Developmental window',
      value: windowText[window],
      basis:
        input.ageRelativeToLevel !== null
          ? `${Math.abs(input.ageRelativeToLevel).toFixed(1)} years ${input.ageRelativeToLevel >= 0 ? 'younger' : 'older'} than the rostered average at this level.`
          : 'The level\'s rostered age profile is unavailable.',
    },
    {
      label: 'Developmental stakes',
      value: input.tier ?? 'indeterminate',
      basis:
        input.tier !== null
          ? 'Player Development\'s protection tier from the organization-visible ratings and age.'
          : 'The protection tier could not be established from the organization-visible ratings.',
    },
  ];

  const reasons: string[] = [];
  const unknowns: string[] = [];

  if (input.unassessable !== null && input.leaguePercentile === null) {
    unknowns.push(input.unassessable);
  }
  if (input.ageRelativeToLevel === null) {
    unknowns.push('The level\'s rostered average age is unavailable, so the developmental window cannot be read.');
  }
  if (input.tier === null) {
    unknowns.push(
      'Developmental stakes are indeterminate: the organization-visible current and potential ratings they rest on are incomplete.'
    );
  }

  /*
   * No evidence at all is not the same as missing evidence. A season that has not been played is a
   * fact about the calendar, and no amount of scouting would settle it.
   */
  if (standing === 'indeterminate' && input.leaguePercentile === null && input.unassessable !== null) {
    reasons.push(`His level standing cannot be read: ${input.unassessable}`);
    return {
      verdict: 'not_assessable',
      standing,
      window,
      parts,
      reasons,
      question: 'none',
      missingEvidence: [],
      unknowns,
    };
  }

  if (standing === 'indeterminate') {
    reasons.push('The current-level sample is too thin to say what the level is doing for him.');
    return {
      verdict: 'indeterminate',
      standing,
      window,
      parts,
      reasons,
      question: 'developmental',
      missingEvidence: input.missingEvidence,
      unknowns,
    };
  }

  if (standing === 'mastered') {
    if (window === 'closed') {
      reasons.push(
        'He is clearly better than the league and far enough past its age that the level has no developmental value left for him.'
      );
      reasons.push(
        'Whether he moves is an organizational question — where the organization needs the body and who else needs these reps — not a developmental one.'
      );
      return { verdict: 'no_longer_developmental', standing, window, parts, reasons, question: 'organizational', missingEvidence: [], unknowns };
    }
    reasons.push('He is clearly better than the league he is in, so the level is no longer the one developing him.');
    if (window === 'ample') {
      reasons.push('He is young for the level, so there is no urgency in itself; a more demanding assignment is the developmental question.');
    }
    return { verdict: 'no_longer_developmental', standing, window, parts, reasons, question: 'developmental', missingEvidence: [], unknowns };
  }

  if (standing === 'overmatched') {
    if (window === 'ample') {
      reasons.push(
        'He is clearly worse than the league, but he is young for it: struggling at a level he is young for is on schedule, not evidence the assignment is wrong.'
      );
      return { verdict: 'appropriate', standing, window, parts, reasons, question: 'none', missingEvidence: [], unknowns };
    }
    if (!input.canDemote) {
      reasons.push('He is clearly worse than the league and is not young for it, but the organization has no less demanding affiliate.');
      return { verdict: 'too_advanced', standing, window, parts, reasons, question: 'organizational', missingEvidence: [], unknowns };
    }
    reasons.push('He is clearly worse than the league and is not young for it, so the level is ahead of what he has shown.');
    return { verdict: 'too_advanced', standing, window, parts, reasons, question: 'developmental', missingEvidence: [], unknowns };
  }

  if (window === 'closed') {
    reasons.push(
      'He is holding his own, but he is far enough past the level\'s age that the assignment is no longer primarily developmental.'
    );
    return { verdict: 'no_longer_developmental', standing, window, parts, reasons, question: 'organizational', missingEvidence: [], unknowns };
  }

  reasons.push('He is holding his own at a level that still has developmental value for him.');
  if (
    input.reliability < CLAIM_RELIABILITY &&
    input.leaguePercentile !== null &&
    (input.leaguePercentile >= CLEARLY_ABOVE_PERCENTILE || input.leaguePercentile <= CLEARLY_BELOW_PERCENTILE)
  ) {
    reasons.push(
      `His rate is ${input.leaguePercentile >= CLEARLY_ABOVE_PERCENTILE ? 'well above' : 'well below'} the league's, but on ${Math.round(input.reliability * 100)}% trusted sample the strongest thing it supports is that he is holding his own.`
    );
    unknowns.push('More of the season would settle whether the level is doing something other than developing him.');
  }
  return { verdict: 'appropriate', standing, window, parts, reasons, question: 'none', missingEvidence: [], unknowns };
}

/** The policy thresholds, exported so `farmCalibration`'s boundary test can see them declared once. */
export const CURRENT_ASSIGNMENT_THRESHOLDS = {
  clearlyAbovePercentile: CLEARLY_ABOVE_PERCENTILE,
  clearlyBelowPercentile: CLEARLY_BELOW_PERCENTILE,
  claimReliability: CLAIM_RELIABILITY,
  readableReliability: READABLE_RELIABILITY,
} as const;
