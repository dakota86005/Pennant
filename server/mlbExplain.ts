/**
 * Why a flag exists, as data.
 *
 * A finding is only useful if the GM can ask it the questions a scouting director would be asked, and get answers that do not have to be
 * reconstructed from prose: why was this flagged, what evidence moved it, what would a club with no philosophy have been told, what did
 * this club's window and season change, what did they NOT change, and what would change the conclusion.
 *
 * This composes what the review already decided (`roleReview.ts`) and what the context shaded (`staffPreference.ts`); it decides nothing.
 * Pure: a review and a context in, an explanation out.
 */

import { isFirmRead, type HolderReview } from './roleReview.js';
import { flagShading, type ContextRead, type ShadeReason } from './staffPreference.js';

/** What shading never changes, whoever the club is. Each is enforced by a test (`tests/mlbGoldenContext.test.ts`, `tests/mlbInvariants.test.ts`). */
export const NEVER_CHANGED: readonly string[] = [
  'The working estimate and each of its parts.',
  'Whether the finding is a case, and how strong the evidence makes it.',
  'What Player Rights says each transaction allows, and how sure it is.',
  'What Player Development says is defensible, and for how long.',
  'Which players are candidates, and how each compares with the player under review.',
  'What is unknown.',
];

export interface ExplainedPart {
  label: string;
  /** The value on the percentile scale; null when there is no evidence for it. */
  value: number | null;
  /** The share of the estimate it accounts for (0 to 1); null for a lens that is not part of a blend. */
  weight: number | null;
  /** Where it comes from, in words. */
  basis: string;
}

export interface FlagExplanation {
  /** The rule that raised it and the numbers behind it. */
  why: {
    rule: HolderReview['concern']['rule'];
    text: string;
    estimate: number | null;
    threshold: number | null;
    margin: number | null;
    standard: { label: string; typical: number; floor: number; deepFloor: number } | null;
  };
  /** What the estimate is made of. */
  parts: ExplainedPart[];
  /** How urgently a club with no philosophy and no season would have been told to look. */
  neutralSeverity: 'elevated' | 'watch';
  /** What this club's context did to the urgency, and what it did not touch. */
  context: { changed: ShadeReason[]; notChanged: readonly string[] };
  /** What a scout would raise as a competing explanation: luck, sample, age, results ahead of tools. */
  explanations: string[];
  /** What additional evidence would change the conclusion. */
  wouldChange: string[];
  /** What is not known, in plain words. */
  unknown: string[];
}

const RULE_TEXT: Record<HolderReview['concern']['rule'], (r: HolderReview) => string> = {
  below_deep_floor: (r) => `His working estimate (${Math.round(r.estimate.value ?? 0)}) is well below what ${r.standard?.label ?? 'the job'} takes: under the ${Math.round(r.standard?.deepFloor ?? 0)} line the lowest twentieth of the league's holders of the role fall below.`,
  below_role_floor: (r) => `His working estimate (${Math.round(r.estimate.value ?? 0)}) is unusually weak for ${r.standard?.label ?? 'the job'}: under the ${Math.round(r.standard?.floor ?? 0)} line the lowest tenth of the league's holders fall below.`,
  below_absolute: (r) => `His working estimate (${Math.round(r.estimate.value ?? 0)}) is under the absolute line of 35 (no standard for his role was available).`,
  weakest_in_group: (r) => `He is the weakest in his group and well below its median (no standard for his role was available).`,
  none: (r) => (r.estimate.value === null ? 'There is nothing to judge him on.' : 'He is not below the line for his role.'),
};

/** Why a finding stands, what it is made of, and what the club's context did and did not do to it. */
export function explainFlag(r: HolderReview, context: ContextRead | null): FlagExplanation {
  const e = r.estimate;
  const parts: ExplainedPart[] = [];
  const hitter = e.batValue !== undefined;
  if (hitter) {
    const wd = e.weightOnDefense ?? 0;
    const wr = e.weightOnRunning ?? 0;
    parts.push({ label: 'Bat', value: e.batValue ?? null, weight: 1 - wd - wr, basis: e.basis === 'ratings_and_results' ? `${Math.round(e.weightOnResults * 100)}% results, ${Math.round((1 - e.weightOnResults) * 100)}% tools` : e.basis === 'ratings_only' ? 'tools only' : e.basis === 'results_only' ? 'results only' : 'no evidence' });
    parts.push({ label: 'Glove', value: e.defensePct ?? null, weight: wd, basis: wd > 0 ? 'his revealed grade and zone-rating results at the position he plays' : r.evidence.defense && !r.evidence.defense.visible ? 'not visible: the estimate is his bat alone' : 'does not count at this position' });
    parts.push({ label: 'Running', value: e.runningPct ?? null, weight: wr, basis: wr > 0 ? 'his running ratings and baserunning runs' : 'no running evidence' });
  } else {
    parts.push({ label: 'Tools', value: e.ratingsPct, weight: e.basis === 'ratings_and_results' ? 1 - e.weightOnResults : e.basis === 'ratings_only' ? 1 : 0, basis: 'his visible ratings against MLB peers' });
    parts.push({ label: 'Results', value: e.resultsPct, weight: e.basis === 'ratings_and_results' ? e.weightOnResults : e.basis === 'results_only' ? 1 : 0, basis: 'what he has done: league-relative, recency weighted, trusted by sample' });
  }
  const unknown: string[] = [];
  if (r.evidence.ratingsEvidence !== 'complete') unknown.push('His visible tool ratings are incomplete.');
  if (e.resultsPct === null) unknown.push('He has no qualifying major-league results.');
  else if (!isFirmRead(r.evidence)) unknown.push(`His results are only trusted ${Math.round(r.evidence.reliability * 100)}% as his level so far.`);
  if (hitter && r.evidence.position !== undefined && (e.weightOnDefense ?? 0) === 0 && r.evidence.defense && !r.evidence.defense.visible && r.evidence.position !== 10) unknown.push('His glove at the position is not visible.');
  const neutral = flagShading(null, { strength: r.strength, subjectAge: r.age, stakes: r.stakes ?? null });
  const shaded = flagShading(context, { strength: r.strength, subjectAge: r.age, stakes: r.stakes ?? null });
  return {
    why: {
      rule: r.concern.rule, text: RULE_TEXT[r.concern.rule](r), estimate: r.concern.estimate, threshold: r.concern.threshold, margin: r.concern.margin,
      standard: r.standard ? { label: r.standard.label, typical: r.standard.typical, floor: r.standard.floor, deepFloor: r.standard.deepFloor } : null,
    },
    parts, neutralSeverity: neutral.level, context: { changed: shaded.reasons, notChanged: NEVER_CHANGED },
    explanations: r.explanations, wouldChange: r.wouldChange, unknown,
  };
}
