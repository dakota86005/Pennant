/**
 * Platoon: how a hitter fares against left- and right-handed pitching, read honestly.
 *
 * Two kinds of evidence, and calibration (docs/CALIBRATION.md sections 2 and 14) says which to trust:
 *
 *   ratings   his visible tools against left-handers and against right-handers (D-035), turned into
 *             wOBA points by the tools model. Run 1 found the rating-implied platoon effect well
 *             calibrated against 2023-2025 (slope 1.06), a same-time test; whether ratings forecast
 *             splits cannot yet be checked on a save (cycle 4), so its weight is the starting value.
 *   observed  his own splits over five seasons. On the Arizona import a hitter's own past split adds
 *             almost nothing beyond the league norm for his handedness, so observed splits move the read
 *             only a little. How much they count around the league norm is fitted per save and served
 *             only where clearly better (`mlbPlatoonFit.ts`); the values in force arrive as `platoon`.
 *
 * The read is therefore: the league's platoon effect for a hitter of his handedness, adjusted by his
 * ratings (their departure from the norm for his hand), with his observed split pulled toward that.
 * Only an effect clearly larger than the league's own counts as a problem; anything else is "no issue"
 * or "not enough to say". The reasons say which evidence they rest on.
 *
 * Everything here is arithmetic on numbers handed in: ratings arrive from `scoutedEvidence.ts`
 * through the tools model, statistics from `resultsEvidence.ts`. This reads no table.
 */

import { policy, provisional, type CalibrationStamp } from './calibration.js';
import { reliability, wobaOf, type BattingLine } from './resultsMetrics.js';

export const PLATOON_CALIBRATION: CalibrationStamp = provisional(
  'The weight of a hitter\'s own split and of his ratings\' departure from the norm for his hand. Around the league norm alone (his platoon ratings not visible), the weight of his record is fitted per save and served only where clearly better on held-out seasons (D-053, cycle 3; `mlbPlatoonFit.ts`); around his ratings, it and the rating weight are the starting values of run 1\'s same-time backtest, not yet checkable on a save (cycle 4). The margins for a problem and for a complement are policy (see each declaration).'
);

/**
 * PROVISIONAL (the fallback prior; D-053). How much a hitter's own split counts, as effective plate appearances at which it counts half
 * against its prior, and the weight on his ratings' departure from the norm for his hand. Source: run 1 on the Arizona import (best
 * shrink K about 5,000 against 2023-2025; rating weight 1.0, a same-time fit). Around the league norm the save's own K replaces the
 * first where clearly better (`mlbPlatoonFit.ts`); around his ratings, both stay until a save can check ratings as a forecast (cycle 4).
 */
export const PLATOON_PRIOR: PlatoonParams = {
  shrinkAroundLeague: 5000,
  shrinkAroundRatings: 5000,
  ratingWeight: 1.0,
  source: 'starting',
};

/** The platoon read's tuning values in force for a save (`rosterReviewCalibration(...).platoon`): never a default in a reader. */
export interface PlatoonParams {
  /** Effective PA at which his own split counts half against the league norm for his hand (his platoon ratings not visible). */
  shrinkAroundLeague: number;
  /** The same, against the league norm plus his ratings' departure from it. */
  shrinkAroundRatings: number;
  /** The weight on his ratings' departure from the norm for his hand. */
  ratingWeight: number;
  /** Whether the weight around the league norm is the save's own (clearly better on its held-out seasons) or the starting value. */
  source: 'save' | 'starting';
}

/** POLICY. Fewest plate appearances against the less-faced hand before his own split is read at all (how much it then counts is the shrinkage's). */
export const MIN_SPLIT_PA = 60;
/**
 * POLICY. How much worse than his overall level (wOBA points) the weak side must be, beyond the league's own effect, to call it a
 * problem: a cost worth raising (about 7 runs over a season of plate appearances against that hand), not a rarity. It is not tied to
 * the spread of platoon skill among hitters (run 1 measured .0087, this league's current hitters .0075): a margin set in standard
 * deviations would flag the same share of hitters in every league, whatever it cost them.
 */
export const PROBLEM_EXCESS = 0.012;
/**
 * POLICY. How much better (wOBA points) a complement must project against the regular's weak side to fit: a clear gain in the at-bats he
 * would take. It compares two hitters' levels, which talent drives, not the spread of platoon skill.
 */
export const COMPLEMENT_MARGIN = 0.025;

export const PLATOON_POLICY: CalibrationStamp = policy('The minimum split sample, the problem margin and the complement margin are policy thresholds: costs worth raising, chosen and stated, never fitted.');

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
  /**
   * Share of a hitter of this hand's plate appearances that come against left-handers, derived from the league's own splits (required;
   * null when the export cannot give it: then, without his own record, no level or cost is stated, never an assumed share).
   */
  leagueLeftShare: number | null;
  ratings?: PlatoonRatings | null;
  /** The sample at which his overall record counts as much as his ratings, under the results params in force (D-053; required: no default). */
  recordStabilization: number;
  /** How much his own split and his ratings count: the values in force for the save (required: no default). */
  platoon: PlatoonParams;
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
  /**
   * What the read's platoon difference (against right-handers minus against left-handers, in wOBA points) is made of: the league's effect for his
   * hand, his ratings' departure from it, and how far his own record moved it. They sum to `difference`; a part that does not apply is null.
   */
  difference: number | null;
  drivers: { league: number | null; ratings: number | null; record: number | null };
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
    bats: input.bats, calibration: PLATOON_CALIBRATION, ratingDeparture, difference: null as number | null,
    drivers: { league: input.leagueEffect as number | null, ratings: null as number | null, record: null as number | null },
    vsLeft: { pa: l.pa, observed: wl, expected: null as number | null }, vsRight: { pa: r.pa, observed: wr, expected: null as number | null },
    overall: null as number | null, weakSide: null as PitcherHand | null, weakBy: null as number | null, excessOverLeague: null as number | null, reliability: 0,
  };
  if (!haveObserved && ratingDeparture === null && input.leagueEffect === null) {
    return {
      ...base, verdict: 'insufficient', basis: 'none',
      reasons: [`Not enough to read a platoon split: ${l.pa} plate appearances against left-handers, ${r.pa} against right-handers (${MIN_SPLIT_PA} needed against the less-faced hand), and no visible platoon ratings.`],
    };
  }
  // The usual split for his hand is the prior everything else is measured from (his ratings' departure, his record's pull, the excess
  // that makes a problem). Unknown, it is never taken as zero: what his own record shows is said, and no verdict is drawn (D-018).
  if (input.leagueEffect === null) {
    const what = haveObserved
      ? `Against left-handers he has hit ${fmt(wl as number)} wOBA in ${l.pa} PA; against right-handers ${fmt(wr as number)} in ${r.pa} PA.`
      : `His own record is too thin to read a split (${l.pa} PA against left-handers, ${r.pa} against right-handers).`;
    return {
      ...base, verdict: 'insufficient', basis: haveObserved && ratingDeparture !== null ? 'ratings_and_splits' : ratingDeparture !== null ? 'ratings' : haveObserved ? 'splits' : 'none',
      reasons: [what, `The usual split for hitters of his hand${input.bats ? '' : ' (his batting hand is not in the export)'} is not established in this league's export, so how his split compares with it, and whether it is a platoon problem, cannot be judged.`],
    };
  }
  const league = input.leagueEffect;
  const tuning = input.platoon;
  const prior = league + (ratingDeparture !== null ? tuning.ratingWeight * ratingDeparture : 0);
  // The effective sample for a DIFFERENCE between two sides is the harmonic-style combination of both. Around the league norm alone the
  // weight of his record is the save's own where clearly better (D-053, cycle 3); around his ratings, the starting value (cycle 4).
  const effective = haveObserved ? (l.pa * r.pa) / (l.pa + r.pa) : 0;
  const aroundLeague = ratingDeparture === null;
  const w = haveObserved ? reliability(effective, aroundLeague ? tuning.shrinkAroundLeague : tuning.shrinkAroundRatings) : 0;
  const diff = haveObserved ? prior + w * (wr - wl - prior) : prior;
  const drivers = { league, ratings: ratingDeparture !== null ? tuning.ratingWeight * ratingDeparture : null, record: haveObserved ? w * (wr - wl - prior) : null };
  // How often he faces each hand: his own record where it is read, else the league's own share for his hand. Neither known: no level
  // and no cost can be stated (an unknown share is never assumed, D-018).
  const share = haveObserved ? l.pa / (l.pa + r.pa) : input.leagueLeftShare;
  if (share === null) {
    return {
      ...base, verdict: 'insufficient', basis: ratingDeparture !== null ? 'ratings' : 'league_norm', ratingDeparture, difference: diff, drivers,
      reasons: [`His own record is too thin to read a split (${l.pa} PA against left-handers, ${r.pa} against right-handers) and the export does not say how often hitters of his hand face left-handers, so what a split would cost him cannot be stated.`],
    };
  }
  const pl = share;
  const pr = 1 - pl;
  // His overall level: his record where there is one, his ratings where there is not, blended by how much record there is.
  const ratingLevel = ratings && ratings.vsLeft !== null && ratings.vsRight !== null && input.leagueWoba != null
    ? input.leagueWoba + pl * ratings.vsLeft + pr * ratings.vsRight
    : null;
  const recordLevel = observedOverall !== null && all.pa >= MIN_SPLIT_PA ? observedOverall : null;
  const wRecord = recordLevel !== null ? reliability(all.pa, input.recordStabilization) : 0;
  const overall = recordLevel !== null && ratingLevel !== null ? wRecord * recordLevel + (1 - wRecord) * ratingLevel : recordLevel ?? ratingLevel;
  const expectedL = overall === null ? null : overall - pr * diff;
  const expectedR = overall === null ? null : overall + pl * diff;
  // Weak side: where his expected wOBA is lower. Without a level the difference alone says which side and by how much (weighted by his share of that side).
  const weakSide: PitcherHand = diff > 0 ? 'L' : 'R';
  const weakBy = weakSide === 'L' ? pr * diff : pl * -diff;
  const leagueWeak = (weakSide === 'L' ? Math.max(0, league) : Math.max(0, -league)) * (weakSide === 'L' ? pr : pl);
  const excess = weakBy - leagueWeak;
  const problem = excess >= PROBLEM_EXCESS;
  const basis: PlatoonBasis = haveObserved && ratingDeparture !== null ? 'ratings_and_splits' : ratingDeparture !== null ? 'ratings' : haveObserved ? 'splits' : 'league_norm';
  // Nothing of HIS own to go on (his platoon ratings are not visible and his record is too thin to read): the league's norm for his
  // handedness is all there is, and that is a prior, not a finding about him. Reporting "no issue" would turn an unknown into a neutral.
  if (basis === 'league_norm') {
    return {
      ...base, overall, vsLeft: { pa: l.pa, observed: wl, expected: expectedL }, vsRight: { pa: r.pa, observed: wr, expected: expectedR },
      verdict: 'insufficient', basis, reliability: 0,
      reasons: [
        input.ratings
          ? 'His platoon ratings are not fully visible and his own record is too thin to read a split, so there is only the league norm for his handedness to go on.'
          : `His own record is too thin to read a split (${l.pa} PA against left-handers, ${r.pa} against right-handers) and no platoon ratings are visible, so there is only the league norm for his handedness to go on.`,
        'The league norm is a prior about hitters of his hand, not a read on him: whether he has a platoon problem is not established.',
      ],
    };
  }
  const reasons: string[] = [];
  if (ratingDeparture !== null && ratings) {
    reasons.push(`His visible ratings against left-handers and right-handers imply ${pts(ratings.vsRight! - ratings.vsLeft!)} points of wOBA better against right-handers; for a hitter of his handedness the league norm is ${pts(ratings.norm!)}, so he departs from it by ${pts(ratingDeparture)}.`);
  } else if (input.ratings) {
    reasons.push('His platoon ratings are not fully visible, so the read rests on the league norm for his handedness and his record.');
  }
  if (haveObserved) {
    reasons.push(`Against left-handers he has hit ${fmt(wl as number)} wOBA in ${l.pa} PA; against right-handers ${fmt(wr as number)} in ${r.pa} PA. ${aroundLeague && tuning.source === 'save'
      ? `Checked on this league's past seasons, a hitter's own split counts this much against the usual split for his hand, so it moves the read ${Math.round(w * 100)}% of the way.`
      : `A hitter's own split usually says little beyond ${aroundLeague ? 'the usual split for his hand' : 'his ratings and the league'}, so it moves the read ${Math.round(w * 100)}% of the way.`}`);
  } else if (l.pa + r.pa > 0) {
    reasons.push(`His own record is too thin to read a split (${l.pa} PA against left-handers, ${r.pa} against right-handers).`);
  }
  reasons.push(problem
    ? `That leaves him ${fmt(weakBy)} below his overall level against ${weakSide === 'L' ? 'left' : 'right'}-handers, ${fmt(excess)} more than the league's own effect explains.`
    : `His weaker side (${weakSide === 'L' ? 'left' : 'right'}-handers) is ${fmt(weakBy)} below his overall level, no more than the league's own effect explains: not a platoon problem.`);
  return {
    ...base, overall, vsLeft: { pa: l.pa, observed: wl, expected: expectedL }, vsRight: { pa: r.pa, observed: wr, expected: expectedR },
    weakSide, weakBy, excessOverLeague: excess, reliability: w, basis, verdict: problem ? 'problem' : 'no_issue', reasons, difference: diff, drivers,
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
