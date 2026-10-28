/**
 * How the organization's philosophy shades the staff's advice.
 *
 * A scouting department does not give the same advice to every club. It tells a contender that a
 * modest upgrade in the rotation is worth doing now, and tells a club that is building that the young
 * arm working through his struggles is the point. This module is that difference, and it is pivotal
 * to how a recommendation is worded, how urgently a flag is raised, which of several equivalent
 * replacements leads, and how high the bar for "act" is set.
 *
 * What it can NOT do, by D-019 and D-031:
 *
 *   - It never changes a fact or a read. The working estimate, the finding, whether a replacement is an
 *     upgrade, whether an assignment is developmentally defensible, and what Player Rights allows are
 *     computed without it. It receives them after they are settled.
 *   - It never makes an invalid, blocked or indeterminate alternative valid. It orders and words what
 *     is already ready.
 *   - It never hides. Every adjustment is a named `ShadeReason` (which dimension, what value, what it
 *     did), so the GM can see exactly how their philosophy leaned on a recommendation.
 *
 * Its one input about the club's direction is the organization's stated competitive window (the philosophy
 * dimension). The season's postseason odds once leaned here too; the owner retired them from the decision path
 * (2026-10-28, D-036 and D-060 amended): the odds never move the staff's advice. With no window set nothing leans, and
 * the advice is the neutral advice any club would hear.
 *
 * Every threshold is a provisional policy parameter, declared here and nowhere else.
 */

import { policy, type CalibrationStamp } from './calibration.js';
import type { PhilosophyDimensionId } from './philosophy.js';

export const STAFF_PREFERENCE_CALIBRATION: CalibrationStamp = policy(
  'The window cut-offs, the lean thresholds, the age gap, the tie band and the upside gap are policy parameters: they say when a philosophy leans on a recommendation, not how baseball works.'
);

/** PROVISIONAL (policy). A competitive-window value at or above this is a contender; at or below the second, a club that is building. */
export const WINDOW = { contending: 65, building: 35 } as const;
/** PROVISIONAL (policy). A 0-100 philosophy dimension at or above `high` leans one way; at or below `low`, the other. Between, it is neutral. */
export const LEAN = { high: 60, low: 40 } as const;
/** PROVISIONAL (policy). Years of age that make one replacement meaningfully younger or older than the player he replaces. */
export const AGE_GAP_YEARS = 3;
/** PROVISIONAL (policy). Points of working estimate within which two replacements of the same kind are equivalent, so the philosophy may choose between them. */
export const TIE_BAND = 6;
/** PROVISIONAL (policy). Percentile points by which a candidate's tools must lead his results (or trail them) to count as upside (or as proven). */
export const UPSIDE_GAP = 15;
/** PROVISIONAL (policy). Percentile points by which a candidate's glove or bat must differ from the incumbent's to count for a defense or bat lean. */
export const SKILL_GAP = 15;
/** PROVISIONAL (policy). At or below this age a holder is still developing: a weak line is a development question before it is a replacement one. */
export const DEVELOPING_AGE = 25;

/** The philosophy dimensions this layer reads. Anything else is named as not used, so the GM knows what does not lean on a recommendation. */
export const DIMENSIONS_USED: readonly PhilosophyDimensionId[] = [
  'competitiveWindow', 'riskTolerance', 'ageCurveSensitivity', 'upsidePreference', 'defenseEmphasis', 'rosterDepth', 'pitchingDepth', 'versatility',
];
export const DIMENSIONS_NOT_USED: readonly PhilosophyDimensionId[] = [
  'payrollFlexibility', 'costEfficiency', 'teamControl', 'prospectPreservation', 'promotionAggressiveness', 'positionalScarcity', 'starConcentration',
];

/** The organization's philosophy, as the staff reads it. Nothing about the season's odds: they never lean on advice (D-060). */
export interface OrganizationContext {
  dimensions: Partial<Record<PhilosophyDimensionId, number>>;
}

export type WindowLabel = 'contending' | 'balanced' | 'building';
export type Urgency = 'high' | 'normal' | 'low';

export interface ShadeReason {
  dimension: string;
  /** The value of that dimension (0-100), or null where the lean is not a philosophy value (a role's usage). */
  value: number | null;
  effect: 'raises' | 'lowers' | 'favors' | 'against' | 'notes';
  text: string;
}

export interface ContextRead {
  window: { label: WindowLabel; value: number | null };
  urgency: Urgency;
  headline: string;
  lines: string[];
  used: readonly PhilosophyDimensionId[];
  notUsed: readonly PhilosophyDimensionId[];
  calibration: typeof STAFF_PREFERENCE_CALIBRATION;
}

const WINDOW_WORD: Record<WindowLabel, string> = { contending: 'win-now', balanced: 'balanced', building: 'building for the future' };

/**
 * How the club is read: from its stated competitive window alone (D-036, amended 2026-10-28). A contender is pressed, a
 * club building is patient, and a balanced club or one with no window set is neither: the neutral bar.
 */
export function readContext(ctx: OrganizationContext | null): ContextRead | null {
  if (!ctx) return null;
  const value = ctx.dimensions.competitiveWindow ?? null;
  const label: WindowLabel = value === null ? 'balanced' : value >= WINDOW.contending ? 'contending' : value <= WINDOW.building ? 'building' : 'balanced';
  const lines = [value === null
    ? 'No competitive window is set, so the philosophy does not lean on this advice.'
    : `Your competitive window is ${value} (${WINDOW_WORD[label]}).`];
  // Only a stated window leans: with none set, the advice is the neutral advice
  const urgency: Urgency = value === null ? 'normal' : label === 'contending' ? 'high' : label === 'building' ? 'low' : 'normal';
  const headline = urgency === 'high'
    ? 'Your competitive window favors acting now.'
    : urgency === 'low'
      ? 'Your competitive window leaves room to be patient.'
      : value === null
        ? 'No competitive window is set, so the advice is not leaned either way.'
        : 'Your competitive window does not press either way.';
  return { window: { label, value }, urgency, headline, lines, used: DIMENSIONS_USED, notUsed: DIMENSIONS_NOT_USED, calibration: STAFF_PREFERENCE_CALIBRATION };
}

/** The equivalence bucket a replacement's gain falls in: within a bucket two replacements are the same kind of improvement, so the philosophy may choose between them. */
export const tieBucket = (delta: number | null): number => Math.floor((delta ?? 0) / TIE_BAND);

const lean = (v: number | undefined): 'high' | 'low' | 'neutral' => (v === undefined ? 'neutral' : v >= LEAN.high ? 'high' : v <= LEAN.low ? 'low' : 'neutral');

// ── a flag's urgency ────────────────────────────────────────────────────────

export interface FlagFacts {
  strength: 'strong' | 'moderate' | 'watch' | 'none';
  subjectAge: number | null;
  /** How much the role matters where it is measured: a high-leverage reliever, a regular at a premium position. */
  stakes?: 'high' | 'medium' | 'low' | null;
}

/**
 * How urgently a flag deserves the GM's attention, given the club and the case. It never removes a flag; it changes how it is ordered and how it
 * is worded, and it says why.
 */
export function flagShading(read: ContextRead | null, facts: FlagFacts): { level: 'elevated' | 'watch'; reasons: ShadeReason[] } {
  let level: 'elevated' | 'watch' = facts.strength === 'strong' ? 'elevated' : 'watch';
  const reasons: ShadeReason[] = [];
  if (read?.window.value !== null && read?.window.value !== undefined && read.urgency === 'high' && facts.strength === 'moderate') {
    level = 'elevated';
    reasons.push({ dimension: 'competitiveWindow', value: read.window.value, effect: 'raises', text: 'A club pushing to win now cannot carry a soft spot: a moderate case is treated as elevated.' });
  }
  if (read && read.urgency === 'low' && facts.strength === 'strong' && facts.subjectAge !== null && facts.subjectAge <= DEVELOPING_AGE) {
    level = 'watch';
    reasons.push({ dimension: 'competitiveWindow', value: read.window.value, effect: 'lowers', text: `At ${facts.subjectAge} he is still developing and the club is building: a weak line is a development question before it is a replacement one.` });
  }
  if (facts.stakes === 'high' && facts.strength === 'moderate' && level === 'watch') {
    level = 'elevated';
    reasons.push({ dimension: 'usage', value: null, effect: 'raises', text: 'He is used in high-leverage spots, so a moderate concern matters more than it would in a low-leverage role.' });
  }
  if (facts.stakes === 'low' && level === 'elevated' && facts.strength === 'strong') {
    reasons.push({ dimension: 'usage', value: null, effect: 'notes', text: 'He is used in low-leverage spots, so the cost of the weak spot is smaller than the estimate alone suggests.' });
  }
  return { level, reasons };
}

// ── which of several equivalent replacements leads ──────────────────────────

export interface CandidateFacts {
  age: number | null;
  certainty: 'adequate' | 'limited' | 'thin';
  toolsPct: number | null;
  resultsPct: number | null;
  /** For a hitter: his bat and his glove at the position, as working values. */
  batValue?: number | null;
  glovePct?: number | null;
}

export interface SubjectFacts {
  age: number | null;
  batValue?: number | null;
  glovePct?: number | null;
}

/**
 * A preference among replacements that are already ready and already equivalent in what they add. Each term is a named reason;
 * the sum only orders, it decides nothing and it cannot lift a candidate over a better one (callers apply it within `TIE_BAND`).
 */
export function preferenceFor(ctx: OrganizationContext | null, cand: CandidateFacts, subject: SubjectFacts): { score: number; reasons: ShadeReason[] } {
  const reasons: ShadeReason[] = [];
  if (!ctx) return { score: 0, reasons };
  let score = 0;
  const d = ctx.dimensions;
  const read = readContext(ctx);
  const gap = cand.age !== null && subject.age !== null ? subject.age - cand.age : null; // positive: candidate is younger
  const ageLean = lean(d.ageCurveSensitivity);
  const building = read?.window.label === 'building';
  if (gap !== null && Math.abs(gap) >= AGE_GAP_YEARS && (ageLean === 'high' || building)) {
    const younger = gap > 0;
    score += younger ? 1 : -1;
    const why = ageLean === 'high' && building ? 'you discount aging and are building' : ageLean === 'high' ? 'you discount aging aggressively' : 'you are building for the future';
    reasons.push({ dimension: ageLean === 'high' ? 'ageCurveSensitivity' : 'competitiveWindow', value: (ageLean === 'high' ? d.ageCurveSensitivity : d.competitiveWindow) ?? null, effect: younger ? 'favors' : 'against', text: `He is ${Math.abs(gap)} years ${younger ? 'younger' : 'older'} than the player he would replace, and ${why}.` });
  } else if (gap !== null && Math.abs(gap) >= AGE_GAP_YEARS && read?.window.label === 'contending' && lean(d.ageCurveSensitivity) === 'low') {
    reasons.push({ dimension: 'ageCurveSensitivity', value: d.ageCurveSensitivity ?? null, effect: 'notes', text: 'You trust veterans and are contending, so age is not held against him.' });
  }
  const risk = lean(d.riskTolerance);
  if (risk === 'low' && cand.certainty !== 'adequate') {
    score -= 1;
    reasons.push({ dimension: 'riskTolerance', value: d.riskTolerance ?? null, effect: 'against', text: 'You prefer the floor and certainty, and the read on him rests on less than both lenses.' });
  } else if (risk === 'low' && cand.certainty === 'adequate') {
    score += 1;
    reasons.push({ dimension: 'riskTolerance', value: d.riskTolerance ?? null, effect: 'favors', text: 'You prefer certainty, and both lenses support him.' });
  }
  const upside = lean(d.upsidePreference);
  if (cand.toolsPct !== null && cand.resultsPct !== null) {
    const toolsAhead = cand.toolsPct - cand.resultsPct >= UPSIDE_GAP;
    const resultsAhead = cand.resultsPct - cand.toolsPct >= UPSIDE_GAP;
    if (upside === 'high' && toolsAhead) { score += 1; reasons.push({ dimension: 'upsidePreference', value: d.upsidePreference ?? null, effect: 'favors', text: 'His tools are ahead of his results, and you prefer ceiling to what is already shown.' }); }
    if (upside === 'low' && resultsAhead) { score += 1; reasons.push({ dimension: 'upsidePreference', value: d.upsidePreference ?? null, effect: 'favors', text: 'His results are ahead of his tools, and you prefer what is already proven.' }); }
    if (upside === 'low' && toolsAhead) { score -= 1; reasons.push({ dimension: 'upsidePreference', value: d.upsidePreference ?? null, effect: 'against', text: 'His tools are ahead of his results, and you prefer what is already proven.' }); }
  }
  const defense = lean(d.defenseEmphasis);
  if (cand.glovePct != null && subject.glovePct != null && cand.batValue != null && subject.batValue != null) {
    const gloveBetter = cand.glovePct - subject.glovePct >= SKILL_GAP;
    const batBetter = cand.batValue - subject.batValue >= SKILL_GAP;
    if (defense === 'high' && gloveBetter) { score += 1; reasons.push({ dimension: 'defenseEmphasis', value: d.defenseEmphasis ?? null, effect: 'favors', text: 'He is clearly better with the glove, and you are glove-first.' }); }
    if (defense === 'low' && batBetter) { score += 1; reasons.push({ dimension: 'defenseEmphasis', value: d.defenseEmphasis ?? null, effect: 'favors', text: 'He is clearly better with the bat, and you are bat-first.' }); }
  }
  return { score, reasons };
}

// ── how high the bar for "act" is ───────────────────────────────────────────

export interface ActBar {
  /** A moderate case may earn an "act" (the club cannot wait). */
  allowModerate: boolean;
  /** A replacement this many years older than the holder holds an "act" back to "explore"; null when age does not. */
  olderLimit: number | null;
  /** The case is not urgent: a moderate one is watched, not pursued. */
  patient: boolean;
  /** Every reason the bar was moved, and each one on its own so a recommendation cites only those that applied. */
  reasons: ShadeReason[];
  why: { allowModerate: ShadeReason | null; patient: ShadeReason | null; older: ShadeReason | null };
}

export function actBar(ctx: OrganizationContext | null): ActBar {
  const read = readContext(ctx);
  const reasons: ShadeReason[] = [];
  let allowModerate = false;
  let patient = false;
  let olderLimit: number | null = null;
  const why: ActBar['why'] = { allowModerate: null, patient: null, older: null };
  if (read?.urgency === 'high') {
    allowModerate = true;
    reasons.push({ dimension: 'competitiveWindow', value: read.window.value, effect: 'lowers', text: 'Your competitive window favors acting now, so a clear upgrade over a moderate concern is enough to act on.' });
    why.allowModerate = reasons[reasons.length - 1];
  }
  if (read?.urgency === 'low') {
    patient = true;
    reasons.push({ dimension: 'competitiveWindow', value: read.window.value, effect: 'raises', text: 'Your competitive window leaves room to be patient, so only a strong case is pursued now; a moderate one is watched.' });
    why.patient = reasons[reasons.length - 1];
  }
  if (read?.window.label === 'building' || lean(ctx?.dimensions.ageCurveSensitivity) === 'high') {
    olderLimit = AGE_GAP_YEARS;
    reasons.push({ dimension: read?.window.label === 'building' ? 'competitiveWindow' : 'ageCurveSensitivity', value: (read?.window.label === 'building' ? ctx?.dimensions.competitiveWindow : ctx?.dimensions.ageCurveSensitivity) ?? null, effect: 'raises', text: `A replacement ${AGE_GAP_YEARS} or more years older than the player he replaces is held to "worth pursuing": the club may prefer the younger player's development.` });
    why.older = reasons[reasons.length - 1];
  }
  return { allowModerate, olderLimit, patient, reasons, why };
}

// ── plans ───────────────────────────────────────────────────────────────────

/**
 * The order plans are shown in, given the club. A contender sees the plan that helps the group most first; a club building or one that values
 * depth sees the plan that keeps every player first. Returns how to order (a comparator over each plan's gain and whether it keeps everyone).
 */
export function planLean(ctx: OrganizationContext | null): { by: 'gain' | 'keeps_everyone' | 'default'; reason: ShadeReason | null } {
  const read = readContext(ctx);
  if (!read) return { by: 'default', reason: null };
  const depth = Math.max(ctx?.dimensions.rosterDepth ?? 0, ctx?.dimensions.pitchingDepth ?? 0);
  if (depth >= LEAN.high || read.window.label === 'building') {
    return { by: 'keeps_everyone', reason: { dimension: depth >= LEAN.high ? 'rosterDepth' : 'competitiveWindow', value: depth >= LEAN.high ? depth : read.window.value, effect: 'favors', text: 'Plans that keep every player in the organization are shown first: you value depth or are building.' } };
  }
  if (read.window.label === 'contending') {
    return { by: 'gain', reason: { dimension: 'competitiveWindow', value: read.window.value, effect: 'favors', text: 'Plans are shown by how much they improve the group now: you are contending.' } };
  }
  return { by: 'default', reason: null };
}
