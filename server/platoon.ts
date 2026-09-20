/**
 * Platoon: how a hitter fares against left- and right-handed pitching, read honestly.
 *
 * Two kinds of evidence, and calibration (docs/CALIBRATION.md section 4) says which to trust:
 *
 *   ratings   his visible tools against left-handers and against right-handers (D-035), turned into
 *             wOBA points by the tools model. Against what actually happened in 2023-2025 the
 *             rating-implied platoon effect is well calibrated (slope 1.06) and beats every other
 *             predictor tried.
 *   observed  his own splits over five seasons. A hitter's own past split adds almost nothing beyond
 *             the league norm for his handedness (best shrinkage constant about 5,000 effective plate
 *             appearances; he does not have that many), so observed splits move the read only a little.
 *
 * The read is therefore: the league's platoon effect for a hitter of his handedness, adjusted by his
 * ratings (their departure from the norm for his hand), with his observed split pulled toward that.
 * Only an effect clearly larger than the league's own counts as a problem; anything else is "no issue"
 * or "not enough to say". The reasons say which evidence they rest on.
 *
 * Everything here is arithmetic on numbers handed in: ratings arrive from `scoutedEvidence.ts`
 * through the tools model, statistics from `resultsEvidence.ts`. This reads no table.
 */

import { calibrated, provisional, type CalibrationStamp } from './calibration.js';
import { blendStabilization, reliability, wobaOf, type BattingLine } from './resultsMetrics.js';

export const PLATOON_CALIBRATION: CalibrationStamp = calibrated(
  'The shrinkage constant and the weight on the rating-implied effect were tuned by backtest (best shrink K about 5,000; best rating weight 1.0). The margins for a problem and for a complement are policy thresholds set against the measured spread of the effect (sd about 9 points); see each declaration.'
);

/** CALIBRATED. Effective plate appearances at which a hitter's own platoon difference counts half against his prior. Backtest optimum 5,000. */
export const PLATOON_SHRINK_K = 5000;
/** CALIBRATED. The weight on his ratings' departure from the norm for his handedness (1.0: the rating-implied effect was well calibrated). */
export const RATING_PRIOR_WEIGHT = 1.0;
/** PROVISIONAL (policy). Fewest plate appearances against the less-faced hand before his own splits are read at all. */
export const MIN_SPLIT_PA = 60;
/** PROVISIONAL (policy). How much worse than his overall level (wOBA points) the weak side must be, beyond the league's own effect, to call it a problem: about 1.4 standard deviations of the effect among hitters. */
export const PROBLEM_EXCESS = 0.012;
/** PROVISIONAL (policy). How much better (wOBA points) a complement must be against the weak side to fit: about three standard deviations of the effect. */
export const COMPLEMENT_MARGIN = 0.025;
/** PROVISIONAL. Share of plate appearances against left-handed pitching when nothing observed says otherwise. */
export const DEFAULT_LEFT_SHARE = 0.3;

export const PLATOON_POLICY: CalibrationStamp = provisional('The minimum split sample, the problem margin and the complement margin are policy thresholds.');

export type Hand = 'L' | 'R' | 'S';
export type PitcherHand = 'L' | 'R';

/** What his visible platoon ratings say, in wOBA points, prepared by the caller from the tools model. */
export interface PlatoonRatings {
  /** Expected wOBA above the league against left- and right-handers (centred on the league); null unless that side's tools are all visible. */
  vsLeft: number | null;
  vsRight: number | null;
  /** The mean of (vsRight - vsLeft) among the league's hitters of his handedness: the norm his ratings are measured against. */
  norm: number | null;
}

export interface PlatoonInput {
  bats: Hand | null;
  vsLeft: BattingLine[];
  vsRight: BattingLine[];
  /** The league's platoon effect for a hitter of this hand: wOBA against right-handers minus against left-handers; null when unknown. */
  leagueEffect: number | null;
  /** The league's wOBA this season, to put expected levels on the wOBA scale; absent means levels are not stated. */
  leagueWoba?: number | null;
  /** Share of a hitter of this hand's plate appearances that come against left-handers, league-wide. */
  leagueLeftShare?: number | null;
  ratings?: PlatoonRatings | null;
}

export interface SideRead {
  /** Plate appearances against this hand across the seasons read. */
  pa: number;
  /** His observed wOBA against this hand. */
  observed: number | null;
  /** Expected wOBA against this hand after combining his ratings and his record; null when neither gives a level. */
  expected: number | null;
}

export type PlatoonVerdict = 'problem' | 'no_issue' | 'insufficient';
export type PlatoonBasis = 'ratings_and_splits' | 'ratings' | 'splits' | 'league_norm' | 'none';

export interface PlatoonRead {
  bats: Hand | null;
  vsLeft: SideRead;
  vsRight: SideRead;
  /** His expected overall wOBA (both sides), when a level can be stated. */
  overall: number | null;
  /** The side he is weaker against, and by how much below his overall level (wOBA points, positive = weaker). */
  weakSide: PitcherHand | null;
  weakBy: number | null;
  /** How far that exceeds what the league's own platoon effect explains. */
  excessOverLeague: number | null;
  /** How far the difference leans on his own record rather than his ratings and the league (0 to 1). */
  reliability: number;
  /** Which evidence the read rests on. */
  basis: PlatoonBasis;
  /** The rating-implied difference (right minus left) departing from the norm for his hand, when ratings are visible. */
  ratingDeparture: number | null;
  verdict: PlatoonVerdict;
  reasons: string[];
  calibration: typeof PLATOON_CALIBRATION;
}

const totalOf = (lines: BattingLine[]) => lines.reduce(
  (t, l) => ({
    ab: t.ab + l.ab, h: t.h + l.h, d: t.d + l.d, t: t.t + l.t, hr: t.hr + l.hr, bb: t.bb + l.bb, ibb: t.ibb + l.ibb, hp: t.hp + l.hp, sf: t.sf + l.sf, pa: t.pa + l.pa,
  }),
  { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, ibb: 0, hp: 0, sf: 0, pa: 0 }
);

const fmt = (n: number) => n.toFixed(3).replace(/^0/, '');
const pts = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(Math.round(n * 1000))}`;

export function evaluatePlatoon(input: PlatoonInput): PlatoonRead {
  const l = totalOf(input.vsLeft);
  const r = totalOf(input.vsRight);
  const wl = l.pa > 0 ? wobaOf(l) : null;
  const wr = r.pa > 0 ? wobaOf(r) : null;
  const all = totalOf([...input.vsLeft, ...input.vsRight]);
  const observedOverall = all.pa > 0 ? wobaOf(all) : null;
  const ratings = input.ratings ?? null;
  const ratingDeparture = ratings && ratings.vsLeft !== null && ratings.vsRight !== null && ratings.norm !== null ? ratings.vsRight - ratings.vsLeft - ratings.norm : null;
  const haveObserved = wl !== null && wr !== null && Math.min(l.pa, r.pa) >= MIN_SPLIT_PA;
  const base = {
    bats: input.bats, calibration: PLATOON_CALIBRATION, ratingDeparture,
    vsLeft: { pa: l.pa, observed: wl, expected: null as number | null }, vsRight: { pa: r.pa, observed: wr, expected: null as number | null },
    overall: null as number | null, weakSide: null as PitcherHand | null, weakBy: null as number | null, excessOverLeague: null as number | null, reliability: 0,
  };
  if (!haveObserved && ratingDeparture === null && input.leagueEffect === null) {
    return {
      ...base, verdict: 'insufficient', basis: 'none',
      reasons: [`Not enough to read a platoon split: ${l.pa} plate appearances against left-handers, ${r.pa} against right-handers (${MIN_SPLIT_PA} needed against the less-faced hand), and no visible platoon ratings.`],
    };
  }
  const league = input.leagueEffect ?? 0;
  const prior = league + (ratingDeparture !== null ? RATING_PRIOR_WEIGHT * ratingDeparture : 0);
  // The effective sample for a DIFFERENCE between two sides is the harmonic-style combination of both.
  const effective = haveObserved ? (l.pa * r.pa) / (l.pa + r.pa) : 0;
  const w = haveObserved ? reliability(effective, PLATOON_SHRINK_K) : 0;
  const diff = haveObserved ? prior + w * (wr - wl - prior) : prior;
  const pl = haveObserved ? l.pa / (l.pa + r.pa) : input.leagueLeftShare ?? DEFAULT_LEFT_SHARE;
  const pr = 1 - pl;
  // His overall level: his record where there is one, his ratings where there is not, blended by how much record there is.
  const ratingLevel = ratings && ratings.vsLeft !== null && ratings.vsRight !== null && input.leagueWoba != null
    ? input.leagueWoba + pl * ratings.vsLeft + pr * ratings.vsRight
    : null;
  const recordLevel = observedOverall !== null && all.pa >= MIN_SPLIT_PA ? observedOverall : null;
  const wRecord = recordLevel !== null ? reliability(all.pa, blendStabilization('hitter')) : 0;
  const overall = recordLevel !== null && ratingLevel !== null ? wRecord * recordLevel + (1 - wRecord) * ratingLevel : recordLevel ?? ratingLevel;
  const expectedL = overall === null ? null : overall - pr * diff;
  const expectedR = overall === null ? null : overall + pl * diff;
  // Weak side: where his expected wOBA is lower. Without a level the difference alone says which side and by how much (weighted by his share of that side).
  const weakSide: PitcherHand = diff > 0 ? 'L' : 'R';
  const weakBy = weakSide === 'L' ? pr * diff : pl * -diff;
  const leagueWeak = input.leagueEffect === null ? 0 : (weakSide === 'L' ? Math.max(0, league) : Math.max(0, -league)) * (weakSide === 'L' ? pr : pl);
  const excess = weakBy - leagueWeak;
  const problem = excess >= PROBLEM_EXCESS;
  const basis: PlatoonBasis = haveObserved && ratingDeparture !== null ? 'ratings_and_splits' : ratingDeparture !== null ? 'ratings' : haveObserved ? 'splits' : 'league_norm';
  const reasons: string[] = [];
  if (ratingDeparture !== null && ratings) {
    reasons.push(`His visible ratings against left-handers and right-handers imply ${pts(ratings.vsRight! - ratings.vsLeft!)} points of wOBA better against right-handers; for a hitter of his handedness the league norm is ${pts(ratings.norm!)}, so he departs from it by ${pts(ratingDeparture)}.`);
  } else if (input.ratings) {
    reasons.push('His platoon ratings are not fully visible, so the read rests on the league norm for his handedness and his record.');
  }
  if (haveObserved) {
    reasons.push(`Against left-handers he has hit ${fmt(wl as number)} wOBA in ${l.pa} PA; against right-handers ${fmt(wr as number)} in ${r.pa} PA. Calibration shows a hitter's own split says little beyond his ratings and the league, so it moves the read ${Math.round(w * 100)}% of the way.`);
  } else if (l.pa + r.pa > 0) {
    reasons.push(`His own record is too thin to read a split (${l.pa} PA against left-handers, ${r.pa} against right-handers).`);
  }
  reasons.push(problem
    ? `That leaves him ${fmt(weakBy)} below his overall level against ${weakSide === 'L' ? 'left' : 'right'}-handers, ${fmt(excess)} more than the league's own effect explains.`
    : `His weaker side (${weakSide === 'L' ? 'left' : 'right'}-handers) is ${fmt(weakBy)} below his overall level, no more than the league's own effect explains: not a platoon problem.`);
  return {
    ...base, overall, vsLeft: { pa: l.pa, observed: wl, expected: expectedL }, vsRight: { pa: r.pa, observed: wr, expected: expectedR },
    weakSide, weakBy, excessOverLeague: excess, reliability: w, basis, verdict: problem ? 'problem' : 'no_issue', reasons,
  };
}

export interface ComplementFit {
  fits: boolean;
  /** Candidate's expected wOBA against the regular's weak side minus the regular's. */
  advantage: number | null;
  reasons: string[];
}

/** Would `candidate` complement `regular`: clearly better against the hand the regular struggles with? */
export function complementFit(regular: PlatoonRead, candidate: PlatoonRead): ComplementFit {
  const side = regular.weakSide;
  if (regular.verdict !== 'problem' || side === null) {
    return { fits: false, advantage: null, reasons: ['The regular has no established platoon problem, so there is nothing to complement.'] };
  }
  const cand = side === 'L' ? candidate.vsLeft.expected : candidate.vsRight.expected;
  const reg = side === 'L' ? regular.vsLeft.expected : regular.vsRight.expected;
  if (cand === null || reg === null) {
    return { fits: false, advantage: null, reasons: [`There is not enough on the candidate (his record or his visible ratings) against ${side === 'L' ? 'left' : 'right'}-handers to say.`] };
  }
  const advantage = cand - reg;
  const fits = advantage >= COMPLEMENT_MARGIN;
  return {
    fits, advantage,
    reasons: [`Against ${side === 'L' ? 'left' : 'right'}-handers he projects at ${fmt(cand)} against the regular's ${fmt(reg)} (${advantage >= 0 ? '+' : '-'}${fmt(Math.abs(advantage))}); a complement needs at least ${fmt(COMPLEMENT_MARGIN)}.`],
  };
}
