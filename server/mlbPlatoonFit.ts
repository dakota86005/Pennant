/**
 * MLB Operations' per-save fit of how much a hitter's own platoon split counts against the league's usual split for his hand (D-053,
 * cycle 3; docs/CALIBRATION.md section 14). Pure: no table, no rating; every case arrives as an argument (the reads are
 * `mlbCalibrationRefit.ts`'s).
 *
 * What is fitted: the K of `reliability = n / (n + K)`, n being the effective plate appearances of his split (l·r/(l+r)), by the
 * production arithmetic of `platoon.ts` for a read whose prior is the league norm alone: the league's effect for his hand over his five
 * seasons before a target season, plus K's share of how far his own split over those seasons departs from it, predicting the target
 * season's split (wOBA against right-handers minus against left-handers). Only there: around his visible platoon ratings the prior is
 * better, so the K it needs is larger, and whether ratings forecast splits cannot be checked on a save with one rating snapshot dated at
 * its own export (cycle 4). Results only: no rating is read.
 *
 * Checked by rolling origin, NESTED: at each origin t the K is chosen on the target seasons up to t only and scored on the next season,
 * paired against the starting K on the same hitter-seasons, unshrunk and as served (shrunk toward the starting K by the training cases,
 * on the log scale: K is a ratio). The verdict is the detector's (`calibrationDetector.ts`), with its policy unchanged: the save's own K
 * serves only where clearly better, with hysteresis.
 */

import { policy, type CalibrationStamp } from './calibration.js';
import type { CalibrationCheck, CalibrationRecord } from './saveCalibrationStore.js';
import type { CalibrationRun } from './saveCalibration.js';
import { decide, describeComparison, DETECTOR_POLICY, ruleText, type DetectorDecision, type DetectorPolicy, type HeldOutCase, type ServedSource } from './calibrationDetector.js';
import { MIN_SPLIT_PA, PLATOON_PRIOR } from './platoon.js';
import { MLB_CALIBRATION_SUBSYSTEM } from './mlbCalibrationFit.js';

export const PLATOON_METHOD = 'platoon-1';

export const PLATOON_FIT_STAMP: CalibrationStamp = policy(
  'The platoon fit\'s window, grid, minimums and shrinkage, and the detector\'s "clearly better" rule it is judged by. Chosen and stated (D-041); the K chosen on the grid is the save\'s.'
);

/** POLICY. The window, the grid, the minimums and the shrinkage. */
export const PLATOON_FIT_POLICY = {
  /** The most recent completed full seasons as targets; a season under this share of its own schedule is not a target. */
  windowSeasons: 20,
  minShare: 0.9,
  /** Rolling origins: at most this many, from the window's start + this many seasons. */
  maxOrigins: 8,
  originStart: 5,
  /** A hitter's seasons before a target that make his split: production's window (`platoonSplits` reads five seasons). */
  inputSeasons: 5,
  /** Plate appearances against each hand in those seasons (production reads his split only from `MIN_SPLIT_PA`; below it K cannot matter). */
  minInputPa: MIN_SPLIT_PA,
  /** Plate appearances against each hand in the target season. */
  minTargetPa: 30,
  /** Training cases a fit needs (an origin with fewer is not scored). */
  minTraining: 1500,
  /** The grid of K (effective plate appearances); its top means "his own split barely moves the read". */
  grid: [250, 500, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 25000, 50000],
  /** Training cases at which the fitted K carries half the weight against the starting K (on the log scale). */
  shrinkCases: 1000,
} as const;

export type PlatoonFitPolicy = typeof PLATOON_FIT_POLICY;

/** One hitter-season to predict: his split before it, the league's usual split for his hand over the same seasons, and the target. */
export interface PlatoonCase {
  playerId: number;
  target: number;
  /** His split (wOBA against right-handers minus against left-handers) over the input seasons, and its effective plate appearances. */
  observed: number;
  effective: number;
  /** The league's split for his hand over the same seasons (the prior production shrinks toward). */
  norm: number;
  /** The target season's split and its effective plate appearances (the case's weight). */
  y: number;
  weight: number;
}

export interface PlatoonInputCases {
  cases: PlatoonCase[];
  /** The completed full seasons (targets) and those skipped with why. */
  seasons: number[];
  skipped: Array<{ season: number; reason: string }>;
  /** Why no case could be built at all (the export carries no batting splits by hand, or no batting hand), when so. */
  missing: string | null;
}

export interface PlatoonModel {
  source: ServedSource;
  /** The K around the league norm that serves (the save's own as served, or the starting K). */
  served: number;
  /** Fitted through the last completed season: unshrunk and as it would serve. Null when not fitted. */
  fitted: number | null;
  fittedServed: number | null;
  cases: number;
  /** The share of the as-served K still the starting K (log scale). */
  priorWeight: number;
  decision: DetectorDecision | null;
  /** Why the starting K serves, when it does. */
  reason: 'kept' | 'confirming' | 'returned' | 'seasons' | 'no_splits' | null;
}

/** The prediction of one case under K: the norm plus K's share of his departure from it (`platoon.ts` around the league norm). */
export const predictSplit = (c: Pick<PlatoonCase, 'observed' | 'effective' | 'norm'>, k: number): number =>
  c.norm + (c.effective / (c.effective + k)) * (c.observed - c.norm);

const lossOf = (c: PlatoonCase, k: number) => (c.y - predictSplit(c, k)) ** 2;

/** The grid point with the least weighted squared error on these cases. */
export function fitK(cases: PlatoonCase[], policyIn: PlatoonFitPolicy = PLATOON_FIT_POLICY): { k: number; loss: number } | null {
  if (cases.length === 0) return null;
  let best: { k: number; loss: number } | null = null;
  for (const k of policyIn.grid) {
    let loss = 0;
    for (const c of cases) loss += c.weight * lossOf(c, k);
    if (!best || loss < best.loss) best = { k, loss };
  }
  return best;
}

/** Shrink a fitted K toward the starting K by the training cases, on the log scale (K is a ratio of samples). */
export function shrinkK(fitted: number, prior: number, cases: number, strength: number): { k: number; weight: number } {
  const w = cases / (cases + strength);
  return { k: Math.round(Math.exp(w * Math.log(fitted) + (1 - w) * Math.log(prior))), weight: w };
}

export interface PlatoonBacktest {
  origins: number[];
  unshrunk: HeldOutCase[];
  served: HeldOutCase[];
  /** Per held-out case, the loss of the league norm alone (his own split ignored), for the reported check. */
  normOnly: number[];
  weights: number[];
  perOrigin: Array<{ origin: number; fitted: number; served: number; training: number }>;
}

/** The nested rolling-origin backtest: each origin's K chosen on targets up to it, scored on the next target season. */
export function backtestPlatoon(cases: PlatoonCase[], targets: number[], prior: number, policyIn: PlatoonFitPolicy = PLATOON_FIT_POLICY): PlatoonBacktest {
  const next = (t: number) => targets[targets.indexOf(t) + 1];
  const origins = targets.filter((t) => t >= targets[0] + policyIn.originStart && next(t) !== undefined).slice(-policyIn.maxOrigins);
  const out: PlatoonBacktest = { origins: [], unshrunk: [], served: [], normOnly: [], weights: [], perOrigin: [] };
  for (const t of origins) {
    const train = cases.filter((c) => c.target <= t && c.target >= targets[0]);
    if (train.length < policyIn.minTraining) continue;
    const fit = fitK(train, policyIn);
    if (!fit) continue;
    const shrunk = shrinkK(fit.k, prior, train.length, policyIn.shrinkCases).k;
    out.origins.push(t);
    out.perOrigin.push({ origin: t, fitted: fit.k, served: shrunk, training: train.length });
    for (const c of cases) {
      if (c.target !== next(t)) continue;
      const rival = lossOf(c, prior);
      out.unshrunk.push({ cluster: c.playerId, origin: t, weight: c.weight, candidate: lossOf(c, fit.k), rival });
      out.served.push({ cluster: c.playerId, origin: t, weight: c.weight, candidate: lossOf(c, shrunk), rival });
      out.normOnly.push((c.y - c.norm) ** 2);
      out.weights.push(c.weight);
    }
  }
  return out;
}

export interface PlatoonFitBasis {
  leagueId: number;
  throughSeason: number | null;
  gameDate: string | null;
}

/**
 * Fit K through the last completed season, backtest it (nested, paired, unshrunk and as served) and let the detector decide what serves,
 * given what served before (`previous`, the adopted model of the season just before: hysteresis and the confirmation count).
 */
export function fitPlatoon(input: PlatoonInputCases, basis: PlatoonFitBasis, previous: PlatoonModel | null, policyIn: PlatoonFitPolicy = PLATOON_FIT_POLICY, detector: DetectorPolicy = DETECTOR_POLICY): CalibrationRun<PlatoonModel | null> {
  const through = basis.throughSeason as number;
  const prior = PLATOON_PRIOR.shrinkAroundLeague;
  const targets = input.seasons.filter((s) => s <= through).slice(-policyIn.windowSeasons);
  const pool = input.cases.filter((c) => targets.includes(c.target));
  const prevSource: ServedSource = previous?.source ?? 'starting';
  const window = { seasons: targets, skipped: input.skipped.filter((s) => targets.length > 0 && s.season >= targets[0] && s.season <= through), sample: pool.length, unit: 'hitter-seasons' };
  const notes: string[] = [
    `A hitter's own split (against right-handers minus against left-handers, his five seasons before the target) is shrunk toward the league's usual split for his hand by n/(n+K), n being its effective plate appearances; each held-out season is predicted by the K chosen only on the seasons before it (nested) and compared with the starting K (${prior}) on the same hitters (paired). The save's K serves only where clearly better (${ruleText(detector)}).`,
    'It applies only where his platoon ratings are not visible: around his ratings the starting K serves until a save can check ratings as a forecast (its one rating snapshot is dated at its own export).',
  ];
  const record = (model: PlatoonModel | null, heldOut: CalibrationCheck[], gate: CalibrationRecord['gate'], priorWeight: number): CalibrationRun<PlatoonModel | null> => ({
    model,
    record: {
      leagueId: basis.leagueId, subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'platoon', method: PLATOON_METHOD,
      basis: { throughSeason: through, gameDate: basis.gameDate }, window, heldOut, gate, notes,
      priorWeight: { overall: priorWeight, byPart: { aroundLeague: priorWeight } },
      priorSource: 'The starting K (5,000): run 1\'s backtest on the Arizona import (2017-2022 predicting 2023-2025).',
    },
  });
  if (input.missing) {
    notes.push(input.missing);
    return record(null, [], { passed: false, reason: `Not decided: ${input.missing} The values in force stay.`, failures: [`no_splits: ${input.missing}`] }, 1);
  }
  const bt = backtestPlatoon(pool, targets, prior, policyIn);
  const decision = decide({ unshrunk: bt.unshrunk, served: bt.served, previous: prevSource, streak: previous?.decision?.streak ?? 0 }, detector);
  const heldOut: CalibrationCheck[] = [];
  for (const [label, c] of [['unshrunk', decision.unshrunk], ['served', decision.served]] as const) {
    heldOut.push({
      kind: 'detector', part: `around_league:${label}`, n: c.cases, expected: c.rivalLoss, observed: c.candidateLoss, se: c.se, prior: c.rivalLoss,
      passed: c.failures.includes('origins') ? null : c.clearlyBetter,
      note: `against the starting K: ${describeComparison(c)}${c.failures.length ? ` (not clearly better: ${c.failures.join(', ')})` : ''}`,
    });
  }
  if (decision.reverse) {
    const c = decision.reverse;
    heldOut.push({ kind: 'detector', part: 'around_league:starting_against_save', n: c.cases, expected: c.rivalLoss, observed: c.candidateLoss, se: c.se, prior: null, passed: c.failures.includes('origins') ? null : c.clearlyBetter, note: `the starting K against the save's own as served: z ${c.z === null ? '—' : c.z.toFixed(2)}` });
  }
  if (bt.normOnly.length) {
    const W = bt.weights.reduce((s, w) => s + w, 0);
    const none = bt.normOnly.reduce((s, e, i) => s + e * bt.weights[i], 0) / W;
    heldOut.push({ kind: 'error', part: 'around_league:against_norm_only', n: bt.normOnly.length, expected: none, observed: decision.served.candidateLoss, prior: decision.served.rivalLoss, passed: null, note: 'Reported: the error of ignoring his own split (the league\'s usual split for his hand alone).' });
  }
  for (const o of bt.perOrigin) notes.push(`Origin ${o.origin}: K ${o.fitted} chosen on ${o.training} hitter-seasons (as served ${o.served}).`);
  const fit = pool.length >= policyIn.minTraining ? fitK(pool, policyIn) : null;
  const shrunk = fit ? shrinkK(fit.k, prior, pool.length, policyIn.shrinkCases) : null;
  const keep = (reason: PlatoonModel['reason']): PlatoonModel => ({
    source: prevSource, served: prevSource === 'save' ? previous?.served ?? prior : prior, fitted: fit?.k ?? null, fittedServed: shrunk?.k ?? null,
    cases: pool.length, priorWeight: prevSource === 'save' ? previous?.priorWeight ?? 1 : 1, decision, reason: prevSource === 'save' ? null : reason,
  });
  if (!decision.decided || !fit || !shrunk) {
    notes.push(decision.reason);
    return record(keep('seasons'), heldOut, { passed: false, reason: `Not decided: seasons: ${decision.reason}`, failures: [`seasons: ${decision.reason}`] }, 1);
  }
  const source = decision.serve;
  const model: PlatoonModel = {
    source, served: source === 'save' ? shrunk.k : prior, fitted: fit.k, fittedServed: shrunk.k, cases: pool.length,
    priorWeight: source === 'save' ? 1 - shrunk.weight : 1, decision,
    reason: source === 'save' ? null : prevSource === 'save' ? 'returned' : decision.streak > 0 ? 'confirming' : 'kept',
  };
  notes.push(`Fitted K ${fit.k} (as served ${shrunk.k}) against the starting ${prior}; ${decision.reason}`);
  const gate: CalibrationRecord['gate'] = {
    passed: true, failures: [],
    reason: source === 'save'
      ? 'Checked on held-out seasons: the save\'s own weight of a hitter\'s split serves.'
      : model.reason === 'confirming'
        ? 'Checked on held-out seasons: the save\'s own was clearly better at this refit; the starting value serves until the next refit confirms it.'
        : 'Checked on held-out seasons: the starting value held up, so it serves.',
  };
  return record(model, heldOut, gate, model.priorWeight);
}

/** A model's confirmation count carried only from the season just before (the detector's "consecutive" rule). */
export function consecutivePlatoon(model: PlatoonModel, consecutive: boolean): PlatoonModel {
  return consecutive || !model.decision ? model : { ...model, decision: { ...model.decision, streak: 0 } };
}
