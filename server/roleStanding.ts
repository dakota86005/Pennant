/**
 * Where does a player stand against the players who hold a role today?
 *
 * The question a GM asks when an injured starter is due back, or a Triple-A arm
 * is proposed for a hole, is not only "may he?" but "is he better than what I
 * have?". This answers it from ONE lens, stated as such: Player Development's
 * destination fit at the MLB level, that is the organization-visible tool
 * ratings of each player against MLB peers of the same kind (a composite
 * percentile). It is not a value, not a projection, and not a score that mixes
 * in performance, contract or philosophy; season results are shown beside it by
 * the caller and never folded in here.
 *
 * Unknown stays unknown: a player without a visible composite is named, never
 * ranked and never assumed weak; if an incumbent is unassessed the weakest
 * incumbent may be him, and the result says so. No verdict is a decision.
 *
 *   PROVISIONAL CALIBRATION: `MEANINGFUL_GAP`. How many percentile points make
 *   one player clearly ahead of another rather than comparable. A first-pass
 *   figure, not a baseball fact, declared here and nowhere else.
 */

export const STANDING_CALIBRATION = {
  status: 'policy' as const,
  note: 'The percentile gap that counts as clearly ahead is a policy threshold (roleStanding.ts), a decision about what to call a real difference, not an established baseball fact.',
};

/** POLICY. Composite-percentile points that separate "clearly ahead or behind" from "comparable". */
export const MEANINGFUL_GAP = 8;

export interface StandingPlayer {
  playerId: number;
  name: string;
  /** Composite percentile of visible tools against MLB peers, 0-100; null when not computable. */
  composite: number | null;
  evidenceStatus: 'complete' | 'partial' | 'unknown';
}

export type StandingVerdict = 'strengthens' | 'comparable' | 'behind' | 'cannot_judge';

export interface RoleStanding {
  subjectId: number;
  verdict: StandingVerdict;
  /** The current holder he would most improve on: the weakest assessed incumbent, only when the verdict is `strengthens`. */
  displaces: { playerId: number; name: string; composite: number } | null;
  /** The weakest assessed incumbent, whatever the verdict. */
  weakest: { playerId: number; name: string; composite: number } | null;
  /** Subject composite minus the weakest assessed incumbent's; null when either is unknown. */
  gapToWeakest: number | null;
  /** 1 = highest visible composite among the assessed incumbents and him. */
  rank: number | null;
  assessed: number;
  aheadOf: string[];
  behind: string[];
  unassessed: string[];
  reasons: string[];
  caveats: string[];
  calibration: typeof STANDING_CALIBRATION;
}

/** 52 becomes "52nd": rounded, with the right suffix. */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const v = r % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][r % 10] ?? 'th');
  return `${r}${suffix}`;
}

const pct = (n: number) => `${ordinal(n)} percentile`;

export function evaluateRoleStanding(subject: StandingPlayer, incumbents: StandingPlayer[]): RoleStanding {
  const others = incumbents.filter((i) => i.playerId !== subject.playerId);
  const assessed = others.filter((i): i is StandingPlayer & { composite: number } => i.composite !== null);
  const unassessed = others.filter((i) => i.composite === null).map((i) => i.name);
  const base = {
    subjectId: subject.playerId, assessed: assessed.length, unassessed, calibration: STANDING_CALIBRATION,
    displaces: null, weakest: null, gapToWeakest: null, rank: null, aheadOf: [] as string[], behind: [] as string[],
    reasons: [] as string[], caveats: [] as string[],
  };
  const caveats: string[] = [];
  if (unassessed.length) caveats.push(`${unassessed.join(', ')} ${unassessed.length === 1 ? 'has' : 'have'} no visible rating, so ${unassessed.length === 1 ? 'he is' : 'they are'} not compared and the weakest current player may be ${unassessed.length === 1 ? 'him' : 'one of them'}.`);
  if (subject.evidenceStatus !== 'complete' && subject.composite !== null) caveats.push('His visible tool ratings are incomplete, so the comparison rests on part of the picture.');

  if (subject.composite === null) {
    return { ...base, verdict: 'cannot_judge', caveats, reasons: ['His visible ratings are not available, so Player Development cannot place him against the current group.'] };
  }
  if (assessed.length === 0) {
    return { ...base, verdict: 'cannot_judge', caveats, reasons: ['No current player in the role has a visible rating to compare him with.'] };
  }

  const weakest = assessed.reduce((a, b) => (b.composite < a.composite ? b : a));
  const gap = subject.composite - weakest.composite;
  const aheadOf = assessed.filter((i) => subject.composite! - i.composite >= MEANINGFUL_GAP).map((i) => i.name);
  const behind = assessed.filter((i) => i.composite - subject.composite! >= MEANINGFUL_GAP).map((i) => i.name);
  const rank = 1 + assessed.filter((i) => i.composite > subject.composite!).length;
  const weakestRef = { playerId: weakest.playerId, name: weakest.name, composite: weakest.composite };

  let verdict: StandingVerdict;
  if (gap >= MEANINGFUL_GAP) verdict = 'strengthens';
  else if (gap <= -MEANINGFUL_GAP) verdict = 'behind';
  else verdict = 'comparable';

  const reasons = [
    `His visible tools are at the ${pct(subject.composite)} of MLB peers; ${weakest.name}, the weakest assessed current player, is at the ${pct(weakest.composite)}.`,
    verdict === 'strengthens'
      ? `That is ${Math.round(gap)} points clear of ${weakest.name} (a gap of ${MEANINGFUL_GAP} counts as clearly ahead), so he would improve the group.`
      : verdict === 'behind'
        ? `That is ${Math.round(-gap)} points below ${weakest.name}, so he would not improve the group.`
        : `That is within ${MEANINGFUL_GAP} points of ${weakest.name}: comparable to the back of the group, not a clear improvement.`,
  ];
  return {
    ...base, verdict, displaces: verdict === 'strengthens' ? weakestRef : null, weakest: weakestRef, gapToWeakest: Math.round(gap * 10) / 10,
    rank, aheadOf, behind, reasons, caveats,
  };
}

// ── season results, as context only ─────────────────────────────────────────

/** PROVISIONAL CALIBRATION. Innings or plate appearances below which a season line is too thin to weigh against others'. */
export const RESULTS_SAMPLE_MINIMUM = { IP: 20, PA: 80 };

export interface ResultsMeasure {
  /** "ERA" or "OPS". */
  name: string;
  value: number;
  sample: number;
  unit: 'IP' | 'PA';
  lowerIsBetter: boolean;
}

/**
 * What this season's results add to the ratings comparison. They never change the
 * verdict: they say whether the sample is big enough to weigh and, when a player
 * would be displaced, whether his results agree with the ratings.
 */
export function resultsContext(
  subject: ResultsMeasure | null,
  displaced: { name: string; measure: ResultsMeasure | null } | null,
  incumbents: Array<{ name: string; measure: ResultsMeasure | null }>
): string[] {
  const notes: string[] = [];
  const enough = (m: ResultsMeasure) => m.sample >= RESULTS_SAMPLE_MINIMUM[m.unit];
  if (subject && !enough(subject)) {
    notes.push(`His season line is ${subject.sample} ${subject.unit}: too few to weigh against the others' (${RESULTS_SAMPLE_MINIMUM[subject.unit]} ${subject.unit} is the minimum used here).`);
  }
  if (displaced?.measure && enough(displaced.measure)) {
    const adequate = incumbents.filter((i): i is { name: string; measure: ResultsMeasure } => i.measure !== null && enough(i.measure));
    if (adequate.length >= 3) {
      const d = displaced.measure;
      const worse = adequate.filter((i) => (d.lowerIsBetter ? i.measure.value < d.value : i.measure.value > d.value)).length;
      const share = worse / adequate.length;
      const word = `${d.name} ${d.value.toFixed(d.name === 'ERA' ? 2 : 3)} in ${d.sample} ${d.unit}`;
      if (worse === adequate.length - 1 && share >= 0.75) notes.push(`Results agree with the ratings: ${displaced.name}'s ${word} is the worst of the ${adequate.length} current players with enough of a sample.`);
      else if (share <= 0.4) notes.push(`Results disagree with the ratings: ${displaced.name} is producing (${word}), better than most of the current group, despite the weakest visible tools.`);
      else notes.push(`Results are mixed: ${displaced.name}'s ${word} is neither the worst nor the best of the current group.`);
    }
  }
  return notes;
}
