/**
 * Every constant that steers a Player Value answer, declared once and stamped (D-041, D-052).
 *
 * The register is docs/PLAYER_VALUE.md Part 11. Phase 1 (contract facts and control) needs almost
 * none: the league's rules are READ (free-agency and arbitration lines, the minimum salary, the
 * service-year length), never assumed, and a missing one is unknown. What is left is one policy
 * and the words that say why a cost is not yet stated.
 *
 * The mechanisms carry no stamp and tests pin them: unknown is never a default, a minor leaguer's
 * control is read from his parent league, eligibility comes from Player Rights and is never
 * re-derived here, an option is shown on both branches.
 *
 * `tests/playerValueBoundary.test.ts` fails if another Player Value module declares a number of
 * its own.
 */

import { policy, provisional, type CalibrationStamp } from './calibration.js';
import type { ProductionModel } from './playerValueProduction.js';
import type { RatingsModel } from './playerValueRatings.js';

/**
 * How many seasons a control timeline runs: to the end of control, capped here (owner, Q-3). The
 * horizon is what the club owns; a longer contract is shown in full in the contract facts, and
 * the timeline says control continues past its last season.
 */
export const CONTROL_HORIZON_SEASONS = 7;

export const CONTROL_HORIZON_CALIBRATION: CalibrationStamp = policy(
  'The horizon runs to the end of control, capped at seven seasons (owner answer Q-3, PLAYER_VALUE.md Part 12). ' +
    'Control is what the club owns; beyond seven seasons no projection means anything.'
);

/**
 * Why a pre-arbitration or arbitration season has no cost band yet. Both bands are priced in wins
 * against the league's price of a win (PLAYER_VALUE.md Part 4.4, R-5, R-6), which phases 2 and 4
 * build. Until then the cost is unknown: never the league minimum, never a point.
 */
export const COST_PENDING_PRICE_OF_A_WIN = 'pending price of a win (phase 2/4)';

/** Why a reserve-clause renewal has no cost band yet: it is read from the league's observed pay (phase 2). */
export const COST_PENDING_OBSERVED_PAY = "pending the league's observed pay (phase 2)";

// ── phase 2: Club Finances and the opening price of a win (PLAYER_VALUE.md Parts 2.4, 4.1, 4.3) ──

/**
 * What the opening price is, in its own words: the imported market (R-1). A historical start ships
 * the real world's contracts, so the price describes that market, not how OOTP prices players. It
 * keeps this label until observed signings replace it (phase 4).
 */
export const OPENING_PRICE_LABEL = 'opening: the imported market';

/** When the opening price gives way (owner, Q-4). Nothing in one import narrows it. */
export const PRICE_NARROWS_WHEN =
  'Only observed signings across imports narrow it: a measured price replaces this one when its band is narrower (owner Q-4, phase 4). Nothing in a single import narrows it.';

/**
 * Which contracts are market prices: those of players Player Rights finds free-agency eligible THIS
 * season, i.e. by service at the last winter, when this season's salary was set. A player whose
 * answer is indeterminate is neither market nor held below it. The alternative (service including
 * this season's days, R-5's reading) is named in the basis and not used.
 */
export const MARKET_CONTRACT_CALIBRATION: CalibrationStamp = policy(
  'A market contract is one whose holder Player Rights finds free-agency eligible this season (service at the last winter, when the salary was set). ' +
    'What "the market" is taken to mean is a decision (PLAYER_VALUE.md 4.1, Part 11), not a fit.'
);

/**
 * The opening price's bases and its band: R-5's bases, computed from this import, and the band is
 * their spread (lowest to highest market basis), not a statistical interval.
 */
export const OPENING_PRICE_CALIBRATION: CalibrationStamp = provisional(
  "R-5's bases on this import: free-agency-eligible salary above the minimum over prior-season WAR, the two-season mean and this season's pace, " +
    'and the same for contracts starting this season (salary, average annual value, pace). The band is their spread. Replaced by observed signings (phase 4).'
);

/** The central reading is the median of the market bases: no basis is preferred over another. */
export const OPENING_PRICE_CENTRAL_CALIBRATION: CalibrationStamp = policy(
  'The central value is the median of the market bases that could be computed. R-5 prefers none of them, so none is chosen; the median is the reading that leans on no single one.'
);

/**
 * The opening replacement level: the one the export's own WAR implies, (league wins − league WAR) ÷
 * league games, measured per season (R-4). OOTP's convention, not a measurement of the talent a club
 * can get for the minimum; phase 4 measures that from freely available talent.
 */
export const REPLACEMENT_LEVEL_CALIBRATION: CalibrationStamp = provisional(
  "The level the export's WAR implies, measured per season from the export's standings and WAR (R-4: .288 in 2024, .293 in 2026 to date on the imported save). " +
    'OOTP\'s convention, not a measurement of freely available talent (phase 4).'
);

/**
 * Which financial row is authoritative (R-7 leaves it unresolved): each figure comes from the one
 * row that states its season. This season is `team_financials` (the export's current state); a past
 * season is `team_history_financials` for that year. `team_last_financials` states no season, so it
 * is named and compared, never used and never blended.
 */
export const FINANCE_ROW_CALIBRATION: CalibrationStamp = policy(
  'Each figure is read from the row that names its season: team_financials for this season, team_history_financials for a past one. ' +
    'team_last_financials names no season; it is reported beside last season where it disagrees, and never used or averaged (R-7).'
);

/**
 * A financial row whose every money field is zero is a placeholder the export wrote without figures
 * (every club-season before 2025 on the imported save, and one club in 2025), read as unknown and
 * never as $0 (R-1, D-018).
 */
export const PLACEHOLDER_ROW_CALIBRATION: CalibrationStamp = policy(
  'A financial row whose every money field is zero carries no figures: each of its values is unknown, never $0 (R-1). A zero in a row that has other figures is read as exported.'
);

// ── phase 3a: expected production (PLAYER_VALUE.md Part 2.3, D-053) ──────────────────────────────
//
// Calibration belongs to the save (D-053). This module holds the METHOD's policy and the one fitted
// artefact code may carry, the fallback prior, stamped provisional. The save's own fit (aging curve,
// regression, usage, band widening per horizon, proneness effects) is computed from the export's
// history by `playerValueProductionFit.ts`, stored per save in history.db by `playerValueFitStore.ts`
// and adopted only through the gate below. No fitted number here is the save's answer.

/** The fitting method's version: a stored fit made by another version is refitted, never reused. */
export const PRODUCTION_METHOD = 'production-3h.1';

/**
 * The method's policy (D-041, D-053): chosen, stated and changed by decision, never by fitting.
 *
 *   coverage       the bands' targets: an 80% outer and a 50% inner central interval.
 *   rateUnit       rates are stated in WAR per 600 opportunities (plate appearances or batters faced).
 *   window         the era rule: the most recent 20 completed seasons of the save's own history; a season
 *                  whose schedule is under 90% of its neighbours' (the three seasons either side) is short
 *                  and skipped (the 2020 season on a real-history save); the most recent 45% of them held
 *                  out as targets the fit never sees. The held-out origins are projected in blocks of three,
 *                  each by the method refit through the block's first origin, and the model served is the method
 *                  refit through the last completed season: what is measured is what is served.
 *   gate           a fit is adopted only if, at every horizon, its held-out coverage AS FITTED (never after a
 *                  widening chosen on the same cases) is within 5 points of each target pooled and within 10
 *                  points in every subgroup (kind, usage third, quality tier, age band) with at least 200
 *                  held-out cases, and its central is unbiased there: a subgroup fails when the mean of actual
 *                  minus central is more than 10% of the mean absolute outcome, more than 0.05 wins a
 *                  player-season, and more than three standard errors (by player) from zero: material,
 *                  and not noise. Horizon 1 must be evaluable. `tolerance` is the
 *                  ratings fit's own gate, unchanged here.
 *   minimumSample  a season enters an aging pair only with 100 opportunities in each of the two seasons;
 *                  a component is fitted only on 50 cases (30 aging pairs), and is the prior's below that.
 *   agingAges      the aging curve is tabulated from 19 to 44; beyond, the end values hold.
 *   usageTiers     the band's tails are set apart for thirds of expected first-season usage within each
 *                  kind (fringe, part-time, regular), so a band calibrated on average holds for each.
 *   ageBands       the gate's age subgroups: 25 and under, 26–29, 30–33, 34 and over (first target season).
 *   prior          thin history shrinks toward the fallback prior: weight strength ÷ (cases + strength)
 *                  per component and per horizon (250 backtest cases per kind and horizon, 100 aging pairs:
 *                  the sample at which the save and the prior weigh equally), and each horizon's bands widen
 *                  by half the prior's weight at that horizon.
 *   twoWayMinimum  a player's second side is projected only with 100 weighted opportunities in the window,
 *                  and only when his listed position gives him a role on it: a listed pitcher's batting is
 *                  never a hitter's line (the export's own position).
 *   starterShare   a pitcher who started at least half his games in the window is read as a starter.
 *   usagePivotAge  the age at which the usage regression bends.
 *   qualityTiers   the band's tails are also set apart by projected rate within each kind: the bottom
 *                  tenth, the middle and the top tenth.
 *   tailGrid       the probabilities at which a cell's outcome distribution is stored (as multiples of the
 *                  spread): a band is a quantile of the mixture of no playing time and this distribution.
 *   proneness      proneness is banded into three equal-count bands of the save's own values; an effect is
 *                  used only when it is at least two standard errors from none, the standard errors clustered
 *                  by player and the whole family of tests held to that rule by Holm's correction; a
 *                  playing-time effect applies only at the horizons it was measured at (1 to 3); aging
 *                  effects are read apart for players younger than 30 and 30 or older.
 *   injury         a season in the window is read as possibly lost to injury, never as evidence of less
 *                  playing time, when the export states an injury this season and that season's playing time
 *                  is under a quarter of his best in the window. A days-out figure held by 10 or more injured
 *                  players at exactly the same value over a year, some of them day-to-day or active, is not
 *                  read as days.
 *   inSeason       the rest of this season is measured on this season's own games: each half of the games
 *                  played needs 10 games per club.
 *   logistic       the attrition logistic is fitted with a ridge of 1 (standardized units) and at most 50
 *                  iterations; a fit that does not converge or separates is flagged in the run record.
 *   priorAdaptation until the save has a fit, the prior is fitted to the league's own WAR scale: its mean
 *                  where the league's last three seasons hold 2,000 opportunities of the kind, its spreads by
 *                  the ratio of the league's spread of player-season rates (seasons of 200 or more) to the
 *                  prior's own source's.
 */
export const PRODUCTION_POLICY = {
  coverage: { outer: 0.8, inner: 0.5 },
  rateUnitOpportunities: 600,
  window: { maxSeasons: 20, minShareOfSchedule: 0.9, holdoutShare: 0.45, neighbourSeasons: 3, refitEvery: 3 },
  gate: {
    tolerance: 0.1, minimumCases: 200,
    coverage: { pooled: 0.05, subgroup: 0.1 },
    bias: { relative: 0.1, absolute: 0.05, standardErrors: 3 },
  },
  minimumSample: { agingOpportunities: 100, agingPairs: 30, fitCases: 50 },
  agingAges: { first: 19, last: 44 },
  usageTiers: 3,
  ageBands: [25, 29, 33],
  prior: { strength: 250, agingStrength: 100, widening: 0.5 },
  twoWayMinimum: 100,
  starterShare: 0.5,
  usagePivotAge: 30,
  qualityTiers: { edges: [0.1, 0.9] },
  tailGrid: [0.01, 0.03, 0.06, 0.1, 0.17, 0.25, 0.37, 0.5, 0.63, 0.75, 0.83, 0.9, 0.94, 0.97, 0.99],
  proneness: { bands: 3, evidence: 2, ageSplit: 30, usageHorizons: 3 },
  injury: { lostSeasonShare: 0.25, sentinelHolders: 10, sentinelMinimumDays: 366 },
  inSeason: { minimumGames: 10 },
  logistic: { ridge: 1, maxIterations: 50 },
  priorAdaptation: { minimumOpportunities: 200, minimumLeagueOpportunities: 2000 },
} as const;

export const PRODUCTION_POLICY_CALIBRATION: CalibrationStamp = policy(
  'The coverage targets (80% and 50%), the era and hold-out rule, the adoption gate (coverage within 5 points pooled and 10 in every subgroup, ' +
    'bias within 10% of the mean outcome or three standard errors), the minimum samples, the prior\'s strength and widening, the two-way minimum ' +
    'and the listed-position rule, the starter share, the usage pivot age, the quality tiers and age bands, the tail grid, the proneness banding and ' +
    'evidence rule (clustered, Holm), the injury rules, the in-season minimum and the logistic\'s ridge are decisions about the method (D-053), not fits.'
);

// ── phase 3b: expected production from scouted ratings (PLAYER_VALUE.md Part 2.3, D-053) ────────────
//
// Ability enters only through `scoutedEvidence.ts` (D-017). The ratings model (the ratings → rate
// mapping, the arrival rates, the development path) is fitted per save by `playerValueRatingsFit.ts`,
// stored in the same fit store under its own method, and adopted only through the same gate.

/** The ratings model's method version: stored beside the results fit, refitted when it changes. */
export const RATINGS_METHOD = 'ratings-3b.1';

/** Why a player has no production at all: neither major-league results nor ability evidence to project from. */
export const PRODUCTION_NO_EVIDENCE = 'no major-league results in the projection window and no usable ability evidence';

/**
 * The ratings method's policy (D-041, D-053): decisions about the method, never fits.
 *
 *   mapping        a major leaguer enters the same-time ratings → rate fit with at least 200
 *                  opportunities (plate appearances or batters faced) in the projection window; the
 *                  fit's held-out coverage is read over 5 folds of players (deterministic, by id); a
 *                  listed position gets its own intercept with at least 15 players, else it shares the
 *                  pooled one; the fit is shrunk toward the prior by its cases (strength 150 players).
 *   arrival        how often players at a level and an age reach the majors is measured from the save's
 *                  own lines: an age band is widened until it holds 60 player-seasons; the positive
 *                  playing time is summarised at 10 equal-probability nodes; a horizon with fewer than
 *                  10 arrivals in its band takes the level's own positive nodes at that horizon. The
 *                  levels are those some club of the save plays at, below the majors.
 *   longitudinal   the development path and the arrival rate conditioned on potential are fitted only
 *                  from the save's own rating snapshots: a pair is two snapshots of a player 300 to 430
 *                  days apart (about a season) whose first has a scouted gap of at least 2 points; the
 *                  save's own path replaces the prior once 300 such pairs exist, an age band is widened
 *                  until it holds 30 pairs, and the arrival split by potential needs 300 linked
 *                  player-seasons with an outcome, used only at two standard errors (the proneness rule).
 *                  The potential split is into thirds of the linked players' potential.
 *   development    until then the provisional prior's path, whose range runs from no further development
 *                  to twice its central share of the gap, never past his potential (a range of readings,
 *                  labelled, not a measured interval). The path is tabulated for ages 16 to 40; beyond,
 *                  the ends hold.
 *   unknownGrade   a glove or running grade the evidence lacks can be anywhere on the 20-80 scale the
 *                  adapter normalizes to: the band runs from its low end to its high end (interval
 *                  arithmetic), never a midpoint.
 */
export const RATINGS_POLICY = {
  mapping: { minimumOpportunities: 200, folds: 5, positionMinimum: 15, priorStrength: 150 },
  arrival: { bandCases: 60, nodes: 10, minimumArrivals: 10 },
  longitudinal: { minimumPairs: 300, pairDays: { from: 300, to: 430 }, minimumGap: 2, bandPairs: 30, minimumLinked: 300, evidence: 2, potentialTiers: 3 },
  development: { priorRangeHigh: 2, ages: { first: 16, last: 40 } },
  unknownGrade: { low: 20, high: 80 },
} as const;

export const RATINGS_POLICY_CALIBRATION: CalibrationStamp = policy(
  'The same-time mapping\'s sample rule, folds, position minimum and prior strength; the arrival age-band size, nodes and arrival minimum; ' +
    'the longitudinal pair rule and the minimum pairs before the save\'s own development path replaces the prior; the prior\'s development range. ' +
    'Decisions about the ratings method (D-053), not fits.'
);

/**
 * The fallback prior: the model used until the save has an adopted fit of its own, and the one
 * everything thin is shrunk toward. The only fitted artefact code may carry (D-053). It was fitted
 * by the same method on the real major-league history a historical save imports, so it describes
 * real-world stability and aging, not OOTP's engine and not this save: it is never presented as
 * the save's own calibration.
 */
export const PRODUCTION_PRIOR_CALIBRATION: CalibrationStamp = provisional(
  'Fallback prior, fitted by the production method production-3b.1 (playing time conditional on quality; tails by quality and usage tier) ' +
    '(playerValueProductionFit.ts, no prior, no hold-out) on the real major-league history 2006–2025 ' +
    '(2020 skipped as short) that the Arizona historical save imports (export of 2026-05-16, league 203), with `npm run calibrate production -- --prior`. ' +
    "It describes real-world stability and aging, not OOTP's engine and not any save: never the save's own calibration (D-053). It carries no injury-proneness " +
    "effect: proneness is measured on each save's own history or not used."
);

/**
 * The fallback prior's source seasons, as totals (plate appearances and WAR across every batting line): a
 * fingerprint, so a save whose held-out seasons ARE these seasons (every historical-start save imports them)
 * fits without the prior rather than validating the prior on its own training data (B-09).
 */
export const PRODUCTION_PRIOR_SOURCE: Record<number, { opportunities: number; war: number }> = {
  2006: {
    opportunities: 186650,
    war: 658.7
  },
  2007: {
    opportunities: 187143,
    war: 664.9
  },
  2008: {
    opportunities: 186245,
    war: 680.8
  },
  2009: {
    opportunities: 185673,
    war: 679.9
  },
  2010: {
    opportunities: 184216,
    war: 685.2
  },
  2011: {
    opportunities: 183933,
    war: 717
  },
  2012: {
    opportunities: 182929,
    war: 706.7
  },
  2013: {
    opportunities: 183621,
    war: 733.4
  },
  2014: {
    opportunities: 182623,
    war: 741.8
  },
  2015: {
    opportunities: 182350,
    war: 707
  },
  2016: {
    opportunities: 183288,
    war: 702.3
  },
  2017: {
    opportunities: 184069,
    war: 662.7
  },
  2018: {
    opportunities: 183854,
    war: 708.4
  },
  2019: {
    opportunities: 185288,
    war: 653.4
  },
  2021: {
    opportunities: 180222,
    war: 730.6
  },
  2022: {
    opportunities: 181708,
    war: 696
  },
  2023: {
    opportunities: 183613,
    war: 633.2
  },
  2024: {
    opportunities: 182449,
    war: 687.8
  },
  2025: {
    opportunities: 182926,
    war: 671.5
  }
};

export const PRODUCTION_PRIOR: ProductionModel = {
  method: "production-3h.1",
  kinds: {
    hitter: {
      weights: [1, 0.8, 0.6],
      stabilization: 400,
      mean600: 2.281,
      noise600: 1.423,
      rateScale600: 2.621,
      horizons: [
        {
          chance: {
            intercept: -1.934,
            recent: [1.683, 0.222, 0],
            quality: 0.2674,
            older: -0.2198,
            younger: 0.2714
          },
          conditional: {
            intercept: -0.06345,
            recent: [0.4991, 0.09624, 0.09034],
            quality: 0.2458,
            older: -0.02801,
            younger: 0.08415
          },
          playSpread: {
            base: 0.6791,
            slope: 0.02767
          },
          usageZ: [-2.846, -2.24, -1.816, -1.493, -1.166, -0.8774, -0.471, -0.05558, 0.405, 0.8095, 1.161, 1.594, 2.021, 2.499, 3.131],
          survivor: {
            intercept: -0.7467,
            slope: 0.9035,
            older: -0.06653,
            younger: 0.1117,
            usage: 0.2512
          },
          tails: [
            [-0.9788, -0.8371, -0.7363, -0.5808, -0.4633, -0.331, -0.2264, -0.04485, 0.1597, 0.4002, 0.6092, 1.236, 1.475, 2.065, 3.648],
            [-1.174, -0.9181, -0.727, -0.613, -0.5042, -0.4103, -0.2821, -0.1768, 0.006247, 0.2697, 0.6843, 1.245, 1.767, 2.317, 3.07],
            [-1.28, -0.9838, -0.8775, -0.8016, -0.6507, -0.5565, -0.3783, -0.2288, -0.01997, 0.4117, 0.7293, 1.087, 1.33, 1.809, 2.048],
            [-1.032, -0.8511, -0.7237, -0.6153, -0.4962, -0.403, -0.3142, -0.2298, -0.09927, 0.07347, 0.3019, 0.8185, 1.372, 1.901, 2.654],
            [-1.257, -1.076, -0.972, -0.8447, -0.7268, -0.6151, -0.4837, -0.3405, -0.1068, 0.2747, 0.7031, 1.268, 1.691, 2.262, 3.148],
            [-1.668, -1.456, -1.285, -1.139, -0.9275, -0.7297, -0.4496, -0.1252, 0.2117, 0.5927, 0.9526, 1.373, 1.717, 2.237, 2.997],
            [-1.021, -0.8503, -0.7259, -0.6061, -0.4893, -0.3924, -0.2935, -0.1932, -0.06001, 0.1525, 0.4002, 0.9605, 1.384, 2.014, 3.009],
            [-1.262, -1.072, -0.9492, -0.829, -0.7057, -0.5916, -0.454, -0.3035, -0.08592, 0.2962, 0.7107, 1.275, 1.73, 2.269, 3.139],
            [-2.236, -1.902, -1.559, -1.309, -1.012, -0.7068, -0.3755, -0.03145, 0.3591, 0.729, 1.035, 1.367, 1.7, 2.142, 2.635],
            [-1.461, -1.113, -0.8394, -0.7096, -0.5335, -0.4086, -0.2487, -0.1348, 0.1682, 0.6181, 0.9934, 1.576, 1.872, 2.116, 2.879],
            [-1.472, -1.275, -1.123, -0.973, -0.8182, -0.7008, -0.546, -0.3347, -0.007016, 0.4298, 0.878, 1.409, 1.831, 2.376, 2.982],
            [-2.126, -1.667, -1.427, -1.232, -0.9777, -0.729, -0.3056, -0.008953, 0.4015, 0.7858, 1.058, 1.387, 1.549, 2.317, 3.039]
          ],
          drift600: 1.124,
          cases: 11350,
          priorWeight: 0,
          driftYoung600: 1.363
        },
        {
          chance: {
            intercept: -2.217,
            recent: [1.127, 0.2143, 0],
            quality: 0.3493,
            older: -0.2788,
            younger: 0.2803
          },
          conditional: {
            intercept: 0.1278,
            recent: [0.3689, 0.1048, 0.1082],
            quality: 0.254,
            older: -0.03564,
            younger: 0.106
          },
          playSpread: {
            base: 0.807,
            slope: 0.01692
          },
          usageZ: [-2.695, -2.187, -1.843, -1.55, -1.218, -0.8948, -0.4803, -0.02058, 0.4367, 0.8751, 1.202, 1.577, 1.929, 2.325, 2.871],
          survivor: {
            intercept: -0.5728,
            slope: 0.8336,
            older: -0.07554,
            younger: 0.151,
            usage: 0.2169
          },
          tails: [
            [-0.851, -0.7654, -0.6537, -0.5531, -0.4168, -0.315, -0.1739, -0.06818, 0.08065, 0.2845, 0.4168, 0.8034, 1.247, 1.812, 2.643],
            [-1.117, -0.9678, -0.8302, -0.7388, -0.5962, -0.5162, -0.3747, -0.2347, -0.04332, 0.3487, 0.653, 0.9822, 1.316, 2.323, 2.576],
            [-1.243, -1.013, -0.9539, -0.9208, -0.8104, -0.6632, -0.4625, -0.2058, -0.04601, 0.3545, 0.7954, 1.108, 1.663, 2.18, 2.861],
            [-1.077, -0.7963, -0.6389, -0.5759, -0.4917, -0.4122, -0.2841, -0.1959, -0.09059, 0.1084, 0.4692, 0.9433, 1.435, 1.893, 2.619],
            [-1.253, -1.093, -0.9602, -0.8574, -0.7268, -0.6328, -0.4889, -0.3316, -0.0751, 0.3266, 0.7428, 1.25, 1.704, 2.423, 3.27],
            [-1.601, -1.399, -1.218, -1.09, -0.9151, -0.7518, -0.5067, -0.1809, 0.1787, 0.6027, 0.9585, 1.363, 1.744, 2.141, 2.891],
            [-1.063, -0.7984, -0.6454, -0.5774, -0.4763, -0.3929, -0.2738, -0.1686, -0.05965, 0.1868, 0.4304, 0.9198, 1.389, 1.912, 2.645],
            [-1.249, -1.089, -0.9587, -0.8449, -0.7183, -0.6152, -0.4742, -0.3152, -0.06474, 0.3472, 0.7288, 1.22, 1.701, 2.408, 3.244],
            [-2.052, -1.761, -1.502, -1.285, -0.9612, -0.6755, -0.3683, -0.009192, 0.316, 0.7137, 1.032, 1.384, 1.771, 2.153, 2.721],
            [-1.465, -1.024, -0.9638, -0.8968, -0.7403, -0.5959, -0.4915, -0.2064, 0.3269, 0.6987, 0.8688, 1.248, 2.211, 2.656, 4.194],
            [-1.456, -1.289, -1.149, -1.03, -0.8712, -0.756, -0.5743, -0.2932, 0.03607, 0.5419, 0.9155, 1.406, 1.788, 2.222, 2.981],
            [-1.905, -1.7, -1.475, -1.202, -0.9606, -0.7662, -0.4106, -0.0802, 0.324, 0.8585, 1.02, 1.381, 1.764, 1.944, 2.508]
          ],
          drift600: 1.666,
          cases: 10430,
          priorWeight: 0,
          driftYoung600: 1.992
        },
        {
          chance: {
            intercept: -2.418,
            recent: [0.8891, 0.1742, 0],
            quality: 0.4749,
            older: -0.3312,
            younger: 0.253
          },
          conditional: {
            intercept: 0.2959,
            recent: [0.2931, 0.1039, 0.09581],
            quality: 0.2746,
            older: -0.02194,
            younger: 0.1152
          },
          playSpread: {
            base: 0.8795,
            slope: 0.006881
          },
          usageZ: [-2.536, -2.191, -1.903, -1.615, -1.228, -0.8926, -0.4507, 0.01501, 0.4742, 0.9101, 1.237, 1.59, 1.842, 2.145, 2.606],
          survivor: {
            intercept: -0.5019,
            slope: 0.793,
            older: -0.08107,
            younger: 0.1848,
            usage: 0.1669
          },
          tails: [
            [-0.7469, -0.6037, -0.5409, -0.4913, -0.3684, -0.2644, -0.2154, -0.1703, -0.04145, 0.1447, 0.642, 1.133, 1.582, 2.232, 2.506],
            [-1.026, -0.9071, -0.7293, -0.6729, -0.584, -0.455, -0.3404, -0.1907, -0.005707, 0.2239, 0.553, 0.94, 1.298, 1.78, 2.316],
            [-1.21, -1.074, -0.9477, -0.8987, -0.7769, -0.6212, -0.4627, -0.3073, -0.04732, 0.45, 0.8641, 1.178, 1.57, 2.037, 2.442],
            [-1.12, -0.8186, -0.6442, -0.5453, -0.4296, -0.3527, -0.2686, -0.1808, -0.0512, 0.1766, 0.5225, 1.416, 1.828, 2.545, 3.274],
            [-1.231, -1.114, -1.012, -0.9219, -0.7942, -0.6581, -0.5142, -0.3224, -0.04854, 0.3726, 0.7595, 1.358, 1.764, 2.29, 3.206],
            [-1.494, -1.334, -1.195, -1.061, -0.9054, -0.742, -0.4852, -0.1652, 0.189, 0.584, 0.9313, 1.369, 1.77, 2.184, 2.837],
            [-1.058, -0.754, -0.6198, -0.5319, -0.4262, -0.3359, -0.2422, -0.1807, -0.04449, 0.1868, 0.5879, 1.358, 1.823, 2.495, 3.166],
            [-1.222, -1.099, -0.9965, -0.9082, -0.7721, -0.6476, -0.483, -0.2998, -0.04545, 0.3425, 0.7258, 1.283, 1.693, 2.216, 3.125],
            [-1.883, -1.61, -1.399, -1.21, -1.001, -0.7419, -0.4114, -0.04985, 0.2501, 0.6703, 1.018, 1.396, 1.644, 2.081, 2.567],
            [-1.065, -1.051, -0.9296, -0.8222, -0.6967, -0.62, -0.3711, -0.08145, 0.323, 0.5833, 0.9607, 1.108, 1.624, 2.214, 2.511],
            [-1.419, -1.249, -1.169, -1.064, -0.9268, -0.778, -0.5882, -0.3117, 0.1466, 0.5611, 0.9117, 1.433, 1.887, 2.33, 3.091],
            [-1.889, -1.699, -1.464, -1.185, -1.061, -0.843, -0.4264, -0.1044, 0.2075, 0.8224, 1.137, 1.491, 1.62, 2.043, 2.36]
          ],
          drift600: 1.977,
          cases: 9476,
          priorWeight: 0,
          driftYoung600: 2.552
        },
        {
          chance: {
            intercept: -2.621,
            recent: [0.7699, 0.1145, 0],
            quality: 0.634,
            older: -0.3751,
            younger: 0.2301
          },
          conditional: {
            intercept: 0.4163,
            recent: [0.2618, 0.1094, 0.06769],
            quality: 0.281,
            older: -0.007834,
            younger: 0.1164
          },
          playSpread: {
            base: 0.9037,
            slope: 0.006346
          },
          usageZ: [-2.51, -2.233, -1.921, -1.604, -1.263, -0.9082, -0.4486, 0.02362, 0.4594, 0.9269, 1.232, 1.553, 1.852, 2.126, 2.555],
          survivor: {
            intercept: -0.387,
            slope: 0.7226,
            older: -0.08613,
            younger: 0.1982,
            usage: 0.1299
          },
          tails: [
            [-1.049, -0.761, -0.6378, -0.5595, -0.4599, -0.3725, -0.2863, -0.1892, -0.08068, 0.2735, 0.5903, 1.032, 1.354, 2.11, 2.871],
            [-0.9522, -0.9001, -0.8295, -0.6294, -0.4967, -0.4068, -0.3212, -0.1984, -0.02322, 0.1442, 0.4464, 0.914, 1.274, 1.695, 2.37],
            [-1.029, -0.9839, -0.8805, -0.7999, -0.6902, -0.5817, -0.3856, -0.2849, 0.04683, 0.8509, 1.121, 1.642, 1.962, 2.614, 3.344],
            [-0.8539, -0.7401, -0.6459, -0.575, -0.4805, -0.4397, -0.2925, -0.1834, -0.05965, 0.2969, 0.8174, 1.14, 1.637, 2.645, 2.91],
            [-1.327, -1.189, -1.032, -0.9313, -0.8118, -0.6923, -0.5312, -0.3359, -0.03132, 0.3676, 0.7646, 1.29, 1.675, 2.414, 3.149],
            [-1.49, -1.309, -1.197, -1.072, -0.9212, -0.7492, -0.5116, -0.1774, 0.1828, 0.5971, 0.9514, 1.409, 1.821, 2.281, 3.065],
            [-1.049, -0.761, -0.6378, -0.5595, -0.4599, -0.3725, -0.2863, -0.1892, -0.08068, 0.2735, 0.5903, 1.032, 1.354, 2.11, 2.871],
            [-1.325, -1.162, -1.014, -0.9044, -0.7895, -0.6598, -0.4939, -0.3035, -0.02299, 0.3142, 0.7512, 1.257, 1.664, 2.365, 2.96],
            [-1.809, -1.581, -1.375, -1.223, -1.009, -0.7607, -0.4601, -0.09796, 0.2243, 0.6244, 1.009, 1.482, 1.727, 2.14, 2.651],
            [-0.9985, -0.9012, -0.8451, -0.7747, -0.5793, -0.4965, -0.3321, -0.0489, 0.2268, 0.7795, 1.041, 1.78, 2.377, 2.833, 3.448],
            [-1.484, -1.308, -1.21, -1.091, -0.949, -0.8301, -0.6225, -0.3441, 0.1009, 0.5626, 0.954, 1.464, 1.835, 2.33, 2.932],
            [-1.755, -1.605, -1.359, -1.156, -0.9438, -0.7113, -0.4963, -0.1279, 0.2091, 0.6025, 0.8829, 1.536, 1.724, 1.962, 2.098]
          ],
          drift600: 1.974,
          cases: 9471,
          priorWeight: 0,
          driftYoung600: 2.185
        },
        {
          chance: {
            intercept: -2.836,
            recent: [0.6368, 0.1265, 0],
            quality: 0.7396,
            older: -0.4159,
            younger: 0.2395
          },
          conditional: {
            intercept: 0.5609,
            recent: [0.2559, 0.07203, 0.06631],
            quality: 0.2349,
            older: 0.01056,
            younger: 0.1275
          },
          playSpread: {
            base: 0.9516,
            slope: 0
          },
          usageZ: [-2.509, -2.16, -1.842, -1.614, -1.229, -0.9275, -0.4724, 0.01908, 0.505, 0.9068, 1.226, 1.554, 1.811, 2.083, 2.456],
          survivor: {
            intercept: -0.33,
            slope: 0.6883,
            older: -0.09343,
            younger: 0.2114,
            usage: 0.07938
          },
          tails: [
            [-0.9301, -0.8093, -0.7502, -0.6398, -0.4771, -0.3628, -0.2758, -0.1668, -0.01466, 0.3556, 0.7225, 1.14, 1.707, 2.096, 2.455],
            [-1.117, -0.8249, -0.677, -0.5786, -0.4889, -0.4242, -0.3259, -0.2447, -0.01257, 0.2733, 0.6802, 1.031, 1.313, 1.718, 1.942],
            [-1.371, -1.247, -0.9252, -0.7952, -0.6511, -0.4954, -0.3763, -0.236, 0.01703, 0.3634, 0.5661, 1.312, 2.059, 2.268, 2.7],
            [-0.9473, -0.8565, -0.7235, -0.6385, -0.4656, -0.364, -0.2691, -0.1523, 0.08868, 0.4607, 0.7586, 1.061, 1.883, 2.139, 2.796],
            [-1.311, -1.151, -1.027, -0.9198, -0.7926, -0.6846, -0.524, -0.3161, -0.0416, 0.3638, 0.807, 1.246, 1.721, 2.419, 3.309],
            [-1.465, -1.286, -1.149, -1.044, -0.9049, -0.7517, -0.519, -0.1776, 0.1935, 0.5945, 0.9183, 1.424, 1.755, 2.099, 2.768],
            [-0.9301, -0.8093, -0.7502, -0.6398, -0.4771, -0.3628, -0.2758, -0.1668, -0.01466, 0.3556, 0.7225, 1.14, 1.707, 2.096, 2.455],
            [-1.307, -1.142, -1.015, -0.897, -0.7722, -0.6609, -0.4891, -0.2947, -0.03114, 0.3647, 0.797, 1.244, 1.699, 2.299, 3.101],
            [-1.742, -1.577, -1.376, -1.212, -0.9979, -0.7714, -0.4399, -0.07404, 0.222, 0.6006, 0.9732, 1.357, 1.774, 2.384, 3.161],
            [-1.268, -1.088, -0.9517, -0.8088, -0.6631, -0.5591, -0.4615, -0.2813, 0.1077, 0.6299, 1.294, 1.976, 2.194, 2.355, 2.725],
            [-1.448, -1.297, -1.168, -1.071, -0.9282, -0.8068, -0.6154, -0.2929, 0.1346, 0.5535, 0.976, 1.394, 1.674, 2.117, 2.754],
            [-1.775, -1.729, -1.535, -1.314, -1.027, -0.7864, -0.4291, -0.003922, 0.3547, 0.7146, 1.022, 1.352, 1.865, 2.064, 2.492]
          ],
          drift600: 2.291,
          cases: 9470,
          priorWeight: 0,
          driftYoung600: 2.424
        },
        {
          chance: {
            intercept: -3.248,
            recent: [0.5843, 0.1176, 0.02726],
            quality: 0.7203,
            older: -0.4557,
            younger: 0.298
          },
          conditional: {
            intercept: 0.6987,
            recent: [0.2044, 0.0965, 0.03224],
            quality: 0.27,
            older: 0.005714,
            younger: 0.12
          },
          playSpread: {
            base: 0.9688,
            slope: 0
          },
          usageZ: [-2.472, -2.117, -1.877, -1.612, -1.281, -0.9337, -0.4387, 0.03197, 0.4766, 0.9132, 1.245, 1.571, 1.807, 2.093, 2.442],
          survivor: {
            intercept: -0.3346,
            slope: 0.6475,
            older: -0.09476,
            younger: 0.2216,
            usage: 0.05016
          },
          tails: [
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.198, -1.118, -0.878, -0.8005, -0.7273, -0.5764, -0.4534, -0.3336, -0.1241, 0.08054, 0.2158, 0.4542, 0.6492, 1.034, 1.527],
            [-1.621, -1.415, -1.225, -1.09, -0.9304, -0.7316, -0.4894, -0.1446, 0.2123, 0.6046, 0.9335, 1.365, 1.781, 2.428, 3.025],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.376, -1.167, -1.062, -0.9212, -0.7966, -0.6939, -0.5319, -0.3291, -0.04567, 0.3486, 0.8334, 1.446, 1.865, 2.309, 3.432],
            [-1.469, -1.264, -1.137, -1.036, -0.8941, -0.7274, -0.5142, -0.1624, 0.1983, 0.5761, 0.9314, 1.395, 1.828, 2.415, 2.985],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.354, -1.16, -1.061, -0.9179, -0.7924, -0.6863, -0.5241, -0.3296, -0.05483, 0.283, 0.6597, 1.258, 1.782, 2.259, 3.092],
            [-1.747, -1.582, -1.358, -1.217, -0.9933, -0.7448, -0.4463, -0.1155, 0.2512, 0.6447, 0.9355, 1.35, 1.71, 2.441, 3.255],
            [-1.183, -1.144, -1.116, -0.9861, -0.813, -0.7802, -0.5261, -0.3965, -0.1225, 0.2701, 0.4931, 0.6933, 1.238, 1.791, 2.296],
            [-1.562, -1.334, -1.176, -1.079, -0.9184, -0.7749, -0.537, -0.2076, 0.2238, 0.6626, 1.061, 1.409, 1.744, 2.3, 2.808],
            [-1.826, -1.674, -1.591, -1.286, -0.993, -0.7136, -0.3183, -0.001401, 0.2621, 0.5965, 0.9098, 1.162, 1.643, 1.974, 2.869]
          ],
          drift600: 2.157,
          cases: 9475,
          priorWeight: 0,
          driftYoung600: 2.047
        },
        {
          chance: {
            intercept: -3.75,
            recent: [0.5351, 0.1674, 0],
            quality: 0.6685,
            older: -0.4844,
            younger: 0.3681
          },
          conditional: {
            intercept: 0.7757,
            recent: [0.2141, 0.03488, 0.05453],
            quality: 0.2254,
            older: -6.398e-06,
            younger: 0.1332
          },
          playSpread: {
            base: 0.9702,
            slope: 0.001992
          },
          usageZ: [-2.462, -2.139, -1.898, -1.611, -1.274, -0.9609, -0.4125, 0.05336, 0.5147, 0.9304, 1.232, 1.544, 1.774, 2.067, 2.344],
          survivor: {
            intercept: -0.457,
            slope: 0.6309,
            older: -0.04144,
            younger: 0.2301,
            usage: 0.04287
          },
          tails: [
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.366, -1.156, -0.9873, -0.8041, -0.6519, -0.5049, -0.4086, -0.2644, -0.1585, 0.3091, 0.6653, 1.204, 1.353, 1.468, 2.113],
            [-1.579, -1.376, -1.239, -1.082, -0.9288, -0.7574, -0.505, -0.1583, 0.207, 0.5917, 0.9007, 1.339, 1.752, 2.302, 3.162],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.262, -1.132, -1.003, -0.9129, -0.7927, -0.6938, -0.5525, -0.2955, 0.006006, 0.3456, 0.7988, 1.353, 1.709, 2.557, 3.342],
            [-1.445, -1.281, -1.121, -1.01, -0.8855, -0.7556, -0.4976, -0.1941, 0.189, 0.5429, 0.8341, 1.327, 1.734, 2.254, 2.853],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.27, -1.144, -1.016, -0.9118, -0.7898, -0.6802, -0.5201, -0.2946, -0.004401, 0.3456, 0.7888, 1.334, 1.661, 2.51, 3.298],
            [-1.784, -1.509, -1.32, -1.177, -1.006, -0.7574, -0.5185, -0.09582, 0.272, 0.6614, 1.033, 1.386, 1.825, 2.432, 3.249],
            [-1.579, -1.376, -1.239, -1.082, -0.9288, -0.7574, -0.505, -0.1583, 0.207, 0.5917, 0.9007, 1.339, 1.752, 2.302, 3.162],
            [-1.434, -1.274, -1.134, -1.023, -0.8987, -0.7741, -0.5441, -0.1417, 0.255, 0.6522, 0.9538, 1.425, 1.756, 2.237, 2.712],
            [-1.849, -1.71, -1.514, -1.34, -1.13, -0.9391, -0.3325, 0.09744, 0.4315, 0.6758, 0.9054, 1.116, 1.388, 1.698, 2.626]
          ],
          drift600: 2.179,
          cases: 8615,
          priorWeight: 0,
          driftYoung600: 2.016
        }
      ],
      usageCuts: [0.2779, 1.529],
      ceiling: 4.765,
      observedSpread600: 1.812,
      priorWeight: 0,
      qualityCuts: [1.281, 3.226]
    },
    starter: {
      weights: [1, 0.5, 0.3],
      stabilization: 300,
      mean600: 1.294,
      noise600: 0.9058,
      rateScale600: 1.732,
      horizons: [
        {
          chance: {
            intercept: -1.673,
            recent: [0.7952, 0.05552, 0.09718],
            quality: 0.5333,
            older: -0.1691,
            younger: 0.2152
          },
          conditional: {
            intercept: 0.6785,
            recent: [0.4369, 0.02195, 0.06404],
            quality: 0.4618,
            older: 0.02239,
            younger: 0.03181
          },
          playSpread: {
            base: 1.147,
            slope: 0
          },
          usageZ: [-2.825, -2.3, -1.914, -1.547, -1.181, -0.8832, -0.4748, 0.0482, 0.5032, 0.9084, 1.193, 1.497, 1.797, 2.161, 2.582],
          survivor: {
            intercept: -0.4584,
            slope: 0.9417,
            older: -0.02049,
            younger: 0.08048,
            usage: 0.07089
          },
          tails: [
            [-1.198, -1.094, -0.7968, -0.6032, -0.4003, -0.2358, -0.1193, -0.02509, 0.05998, 0.3009, 0.4442, 1.131, 1.441, 2.269, 3.071],
            [-1.211, -0.8372, -0.7415, -0.5614, -0.4362, -0.2772, -0.1473, 0.01091, 0.2243, 0.4778, 0.9427, 1.361, 1.561, 1.884, 2.373],
            [-1.981, -1.661, -1.376, -1.197, -0.9675, -0.7286, -0.4081, -0.08069, 0.3091, 0.6997, 0.9168, 1.33, 1.649, 2.066, 2.671],
            [-1.202, -0.9568, -0.8494, -0.7571, -0.6267, -0.5176, -0.3672, -0.245, -0.1061, 0.109, 0.4179, 0.9366, 1.49, 1.969, 2.819],
            [-1.534, -1.249, -1.085, -0.9216, -0.7507, -0.6123, -0.4069, -0.2529, -0.01124, 0.4538, 0.7684, 1.207, 1.529, 1.931, 2.74],
            [-1.765, -1.48, -1.282, -1.122, -0.9185, -0.7195, -0.4081, -0.08479, 0.2866, 0.6405, 0.8735, 1.257, 1.59, 1.945, 2.589],
            [-1.21, -0.9942, -0.8402, -0.7396, -0.6022, -0.4822, -0.3286, -0.2001, -0.05271, 0.1702, 0.4578, 1.048, 1.507, 2.032, 2.994],
            [-1.549, -1.249, -1.082, -0.9077, -0.7316, -0.5815, -0.3828, -0.2124, 0.03164, 0.4707, 0.7908, 1.213, 1.541, 1.968, 2.719],
            [-2.432, -1.866, -1.736, -1.374, -1.134, -0.8406, -0.4516, -0.06315, 0.4237, 0.768, 1.075, 1.459, 1.849, 2.202, 2.711],
            [-1.246, -0.94, -0.762, -0.6091, -0.4156, -0.2951, -0.1845, -0.0321, 0.1343, 0.4312, 0.7704, 1.164, 1.553, 1.955, 2.699],
            [-1.45, -1.233, -1.114, -0.9836, -0.8428, -0.6646, -0.4408, -0.2322, 0.02415, 0.4886, 0.8244, 1.174, 1.512, 1.813, 2.53],
            [-2.458, -2.205, -1.773, -1.267, -1.036, -0.8402, -0.3172, -0.03472, 0.5159, 0.8777, 1.203, 1.619, 2.151, 2.45, 2.85]
          ],
          drift600: 0.5369,
          cases: 4112,
          priorWeight: 0,
          driftYoung600: 0.6159
        },
        {
          chance: {
            intercept: -1.896,
            recent: [0.4952, 0.1138, 0.09668],
            quality: 0.7717,
            older: -0.2024,
            younger: 0.1934
          },
          conditional: {
            intercept: 0.991,
            recent: [0.286, 0.01445, 0.1019],
            quality: 0.4628,
            older: 0.05844,
            younger: 0.04423
          },
          playSpread: {
            base: 1.304,
            slope: 0
          },
          usageZ: [-2.472, -2.133, -1.819, -1.543, -1.207, -0.9442, -0.4835, -0.006294, 0.5447, 0.932, 1.217, 1.523, 1.755, 2.035, 2.413],
          survivor: {
            intercept: -0.1888,
            slope: 0.8193,
            older: -0.02753,
            younger: 0.09329,
            usage: 0.02953
          },
          tails: [
            [-1.088, -1.007, -0.8872, -0.765, -0.592, -0.4903, -0.3622, -0.2317, -0.02035, 0.3568, 0.6735, 1.191, 1.66, 2.309, 2.988],
            [-1.106, -0.968, -0.7847, -0.6441, -0.4751, -0.3411, -0.23, -0.05601, 0.1596, 0.3802, 0.6368, 1.058, 1.38, 1.785, 2.443],
            [-1.795, -1.544, -1.317, -1.145, -0.9605, -0.7492, -0.485, -0.131, 0.2344, 0.621, 0.9158, 1.359, 1.71, 2.13, 2.68],
            [-1.137, -1.026, -0.9331, -0.7831, -0.615, -0.498, -0.3842, -0.2713, -0.05441, 0.3521, 0.6343, 1.201, 1.639, 2.074, 2.576],
            [-1.505, -1.264, -1.095, -0.9344, -0.7893, -0.6695, -0.4795, -0.2798, 0.02381, 0.4489, 0.8454, 1.327, 1.804, 2.2, 3.137],
            [-1.647, -1.395, -1.226, -1.095, -0.9366, -0.742, -0.4941, -0.1881, 0.1374, 0.5632, 0.8248, 1.223, 1.556, 1.997, 2.63],
            [-1.088, -1.007, -0.8872, -0.765, -0.592, -0.4903, -0.3622, -0.2317, -0.02035, 0.3568, 0.6735, 1.191, 1.66, 2.309, 2.988],
            [-1.49, -1.26, -1.082, -0.9197, -0.7687, -0.6234, -0.4375, -0.2392, 0.04404, 0.4462, 0.8401, 1.3, 1.713, 2.193, 3.113],
            [-2.043, -1.771, -1.575, -1.36, -1.053, -0.784, -0.4515, 0.06712, 0.4682, 0.7561, 1.118, 1.617, 1.997, 2.373, 2.676],
            [-1.045, -0.9131, -0.8767, -0.7248, -0.6092, -0.4805, -0.2973, -0.1652, 0.02248, 0.257, 0.7274, 1.191, 1.779, 2.127, 2.67],
            [-1.486, -1.277, -1.159, -1.016, -0.8293, -0.7004, -0.484, -0.2598, 0.1165, 0.5456, 0.872, 1.399, 1.787, 2.1, 2.75],
            [-1.796, -1.486, -1.354, -1.206, -0.9527, -0.6515, -0.3289, 0.1441, 0.4691, 0.906, 1.137, 1.71, 2.077, 2.234, 2.451]
          ],
          drift600: 0.8799,
          cases: 3772,
          priorWeight: 0,
          driftYoung600: 0.7426
        },
        {
          chance: {
            intercept: -1.993,
            recent: [0.4159, 0.1007, 0.08566],
            quality: 0.7382,
            older: -0.2327,
            younger: 0.1961
          },
          conditional: {
            intercept: 1.298,
            recent: [0.1765, 0.04421, 0.08564],
            quality: 0.4632,
            older: 0.09141,
            younger: 0.03804
          },
          playSpread: {
            base: 1.377,
            slope: 0
          },
          usageZ: [-2.249, -2.019, -1.727, -1.49, -1.242, -0.9494, -0.5446, -0.03859, 0.5503, 0.9724, 1.224, 1.508, 1.733, 1.93, 2.347],
          survivor: {
            intercept: -0.04071,
            slope: 0.7347,
            older: -0.003713,
            younger: 0.1096,
            usage: -0.00384
          },
          tails: [
            [-1.083, -0.9947, -0.83, -0.7538, -0.5967, -0.5073, -0.395, -0.2151, 0.0286, 0.4268, 1.009, 1.646, 2.024, 2.343, 2.962],
            [-1.21, -1.031, -0.9425, -0.785, -0.593, -0.4138, -0.3256, -0.1746, -0.01621, 0.4771, 0.6954, 1.193, 1.971, 2.571, 3.78],
            [-1.708, -1.443, -1.286, -1.129, -0.9084, -0.7329, -0.5022, -0.1916, 0.2126, 0.5744, 0.8841, 1.365, 1.662, 2.182, 2.708],
            [-1.138, -0.9474, -0.8298, -0.7594, -0.6643, -0.5329, -0.4324, -0.2799, -0.006417, 0.3623, 0.9572, 1.434, 1.916, 2.341, 2.903],
            [-1.405, -1.194, -1.008, -0.918, -0.7649, -0.5981, -0.4444, -0.2596, 0.02959, 0.4045, 0.7593, 1.139, 1.67, 2.42, 2.984],
            [-1.592, -1.297, -1.171, -1.035, -0.847, -0.7159, -0.491, -0.2171, 0.1419, 0.4853, 0.7936, 1.29, 1.597, 2.045, 2.752],
            [-1.083, -0.9947, -0.83, -0.7538, -0.5967, -0.5073, -0.395, -0.2151, 0.0286, 0.4268, 1.009, 1.646, 2.024, 2.343, 2.962],
            [-1.48, -1.19, -1.029, -0.9226, -0.7675, -0.597, -0.4281, -0.2584, 0.02531, 0.4091, 0.7405, 1.152, 1.688, 2.469, 3.038],
            [-1.77, -1.677, -1.448, -1.369, -1.138, -0.8868, -0.5534, 0.01116, 0.3413, 0.7276, 1.137, 1.532, 1.838, 2.311, 2.621],
            [-1.091, -1.054, -0.993, -0.8407, -0.5844, -0.4259, -0.3547, -0.2517, 0.05765, 0.5569, 0.9652, 1.813, 2.097, 2.739, 3.668],
            [-1.504, -1.25, -1.086, -0.9836, -0.8295, -0.7014, -0.5132, -0.2753, 0.09277, 0.4291, 0.8722, 1.301, 1.611, 2.132, 2.727],
            [-1.742, -1.644, -1.382, -1.335, -1.018, -0.8417, -0.31, 0.03436, 0.6087, 1.002, 1.119, 1.379, 1.499, 1.661, 2.061]
          ],
          drift600: 1.195,
          cases: 3419,
          priorWeight: 0,
          driftYoung600: 1.099
        },
        {
          chance: {
            intercept: -2.163,
            recent: [0.3607, 0.1087, 0.06452],
            quality: 0.7766,
            older: -0.2571,
            younger: 0.2093
          },
          conditional: {
            intercept: 1.399,
            recent: [0.1718, 0.04072, 0.07939],
            quality: 0.3731,
            older: 0.09565,
            younger: 0.03837
          },
          playSpread: {
            base: 1.253,
            slope: 0.04481
          },
          usageZ: [-2.215, -1.895, -1.693, -1.498, -1.245, -0.9769, -0.5732, -0.07392, 0.5307, 1.024, 1.239, 1.533, 1.749, 1.986, 2.315],
          survivor: {
            intercept: 0.08331,
            slope: 0.6018,
            older: -0.01542,
            younger: 0.1102,
            usage: 0.003781
          },
          tails: [
            [-1.23, -0.97, -0.8871, -0.7185, -0.5882, -0.5072, -0.4014, -0.325, -0.008018, 0.2098, 0.526, 0.9089, 1.487, 1.677, 2.034],
            [-1.033, -0.8928, -0.7928, -0.5714, -0.4384, -0.3864, -0.2391, 0.1504, 0.2928, 0.6407, 1.15, 1.641, 1.735, 2.254, 4.048],
            [-1.581, -1.351, -1.175, -1.04, -0.9005, -0.727, -0.4905, -0.2392, 0.1292, 0.5361, 0.8808, 1.447, 1.815, 2.219, 2.654],
            [-1.302, -0.9924, -0.8989, -0.7343, -0.6699, -0.5363, -0.4341, -0.3558, -0.08919, 0.1477, 0.4377, 1.014, 1.512, 1.663, 2.091],
            [-1.347, -1.16, -1.036, -0.8896, -0.7624, -0.6249, -0.4493, -0.262, -0.01152, 0.3931, 0.7796, 1.285, 1.624, 2.262, 3.282],
            [-1.364, -1.223, -1.08, -0.9795, -0.8694, -0.7059, -0.4749, -0.2582, 0.09265, 0.4635, 0.7873, 1.253, 1.706, 2.167, 2.762],
            [-1.23, -0.97, -0.8871, -0.7185, -0.5882, -0.5072, -0.4014, -0.325, -0.008018, 0.2098, 0.526, 0.9089, 1.487, 1.677, 2.034],
            [-1.415, -1.166, -1.038, -0.8835, -0.7484, -0.6007, -0.4206, -0.2415, 0.04829, 0.424, 0.8523, 1.372, 1.649, 2.324, 3.308],
            [-1.669, -1.537, -1.364, -1.185, -1.033, -0.8161, -0.5398, -0.1841, 0.2942, 0.6986, 1.119, 1.762, 2.002, 2.239, 2.513],
            [-1.581, -1.351, -1.175, -1.04, -0.9005, -0.727, -0.4905, -0.2392, 0.1292, 0.5361, 0.8808, 1.447, 1.815, 2.219, 2.654],
            [-1.285, -1.175, -1.036, -0.953, -0.823, -0.6905, -0.4899, -0.2648, 0.01647, 0.4184, 0.8794, 1.296, 1.638, 2.172, 2.638],
            [-1.848, -1.589, -1.382, -1.179, -1.016, -0.742, -0.5149, -0.01384, 0.5452, 1.05, 1.499, 1.993, 2.217, 2.25, 2.434]
          ],
          drift600: 1.471,
          cases: 3427,
          priorWeight: 0,
          driftYoung600: 1.808
        },
        {
          chance: {
            intercept: -2.379,
            recent: [0.3317, 0.07763, 0.06942],
            quality: 0.7414,
            older: -0.2916,
            younger: 0.2497
          },
          conditional: {
            intercept: 1.458,
            recent: [0.1797, 0.04653, 0.05183],
            quality: 0.3563,
            older: 0.1136,
            younger: 0.02128
          },
          playSpread: {
            base: 1.143,
            slope: 0.08423
          },
          usageZ: [-2.135, -1.874, -1.659, -1.486, -1.248, -0.9641, -0.5939, -0.08596, 0.5166, 0.9995, 1.267, 1.561, 1.761, 1.99, 2.306],
          survivor: {
            intercept: 0.1172,
            slope: 0.5727,
            older: -0.02263,
            younger: 0.1114,
            usage: -0.01758
          },
          tails: [
            [-1.371, -1.085, -0.8249, -0.7042, -0.615, -0.5361, -0.4164, -0.3153, -0.08552, 0.1881, 0.5021, 0.8618, 1.538, 1.824, 2.258],
            [-0.9972, -0.9796, -0.7731, -0.6364, -0.4866, -0.4364, -0.3304, -0.19, 0.2178, 0.4825, 0.8114, 1.679, 2.102, 2.25, 2.931],
            [-1.552, -1.275, -1.145, -1.016, -0.8366, -0.6863, -0.4758, -0.2209, 0.09857, 0.5264, 0.8868, 1.34, 1.726, 2.441, 2.815],
            [-1.414, -1.081, -0.8251, -0.7028, -0.6086, -0.5422, -0.4268, -0.3247, -0.1015, 0.1275, 0.3369, 0.9249, 1.588, 1.893, 2.296],
            [-1.449, -1.18, -0.966, -0.8796, -0.7147, -0.6114, -0.4719, -0.3019, -0.04291, 0.3315, 0.7642, 1.242, 1.666, 2.165, 3.357],
            [-1.259, -1.145, -1.051, -0.945, -0.7685, -0.654, -0.4641, -0.2302, 0.07703, 0.4542, 0.8097, 1.228, 1.564, 2.275, 2.847],
            [-1.371, -1.085, -0.8249, -0.7042, -0.615, -0.5361, -0.4164, -0.3153, -0.08552, 0.1881, 0.5021, 0.8618, 1.538, 1.824, 2.258],
            [-1.456, -1.159, -0.9694, -0.8333, -0.7018, -0.5899, -0.4518, -0.2716, -0.03546, 0.3847, 0.796, 1.309, 1.685, 2.188, 3.382],
            [-1.634, -1.524, -1.308, -1.175, -0.9448, -0.8049, -0.5104, -0.2009, 0.1096, 0.6395, 1.112, 1.659, 2.01, 2.452, 2.692],
            [-1.552, -1.275, -1.145, -1.016, -0.8366, -0.6863, -0.4758, -0.2209, 0.09857, 0.5264, 0.8868, 1.34, 1.726, 2.441, 2.815],
            [-1.337, -1.181, -1.063, -0.9616, -0.8065, -0.6773, -0.4831, -0.3095, 0.02261, 0.4246, 0.8624, 1.3, 1.73, 2.261, 2.982],
            [-1.585, -1.507, -1.34, -1.186, -0.9551, -0.7528, -0.4621, -0.1719, 0.4855, 0.8995, 1.286, 1.865, 2.117, 2.548, 2.861]
          ],
          drift600: 1.639,
          cases: 3426,
          priorWeight: 0,
          driftYoung600: 2.207
        },
        {
          chance: {
            intercept: -2.603,
            recent: [0.2914, 0.1051, 0.03113],
            quality: 0.7407,
            older: -0.326,
            younger: 0.267
          },
          conditional: {
            intercept: 1.426,
            recent: [0.1841, 0.02114, 0.07628],
            quality: 0.2954,
            older: 0.1401,
            younger: 0.04058
          },
          playSpread: {
            base: 1.256,
            slope: 0.04233
          },
          usageZ: [-2.148, -1.845, -1.658, -1.47, -1.205, -0.9491, -0.5937, -0.1247, 0.498, 1.049, 1.33, 1.574, 1.746, 1.966, 2.224],
          survivor: {
            intercept: 0.3014,
            slope: 0.5164,
            older: -0.03871,
            younger: 0.09661,
            usage: -0.04647
          },
          tails: [
            [-1.192, -0.884, -0.7609, -0.6635, -0.5604, -0.5083, -0.3905, -0.2301, -0.06113, 0.15, 0.4263, 0.6707, 1.239, 1.425, 1.815],
            [-1.466, -1.107, -0.988, -0.8817, -0.734, -0.6093, -0.4498, -0.2924, -0.03131, 0.3193, 0.809, 1.372, 1.814, 2.429, 3.258],
            [-1.57, -1.281, -1.13, -0.9994, -0.8443, -0.6926, -0.4866, -0.1926, 0.1307, 0.5082, 0.886, 1.395, 1.763, 2.412, 2.817],
            [-1.251, -0.8979, -0.8377, -0.6867, -0.5855, -0.5469, -0.4616, -0.2675, -0.1149, 0.07003, 0.529, 0.6745, 1.258, 1.401, 1.681],
            [-1.534, -1.119, -0.989, -0.8864, -0.7537, -0.6304, -0.4961, -0.3006, -0.05135, 0.2868, 0.7203, 1.313, 1.813, 2.506, 3.339],
            [-1.34, -1.147, -1.011, -0.9294, -0.786, -0.6434, -0.4543, -0.2092, 0.1115, 0.479, 0.8726, 1.248, 1.633, 2.332, 2.805],
            [-1.192, -0.884, -0.7609, -0.6635, -0.5604, -0.5083, -0.3905, -0.2301, -0.06113, 0.15, 0.4263, 0.6707, 1.239, 1.425, 1.815],
            [-1.466, -1.107, -0.988, -0.8817, -0.734, -0.6093, -0.4498, -0.2924, -0.03131, 0.3193, 0.809, 1.372, 1.814, 2.429, 3.258],
            [-1.672, -1.543, -1.254, -1.145, -0.9855, -0.808, -0.5714, -0.1707, 0.1661, 0.5384, 0.9469, 1.598, 1.956, 2.487, 2.955],
            [-1.57, -1.281, -1.13, -0.9994, -0.8443, -0.6926, -0.4866, -0.1926, 0.1307, 0.5082, 0.886, 1.395, 1.763, 2.412, 2.817],
            [-1.488, -1.17, -1.064, -0.9544, -0.8363, -0.681, -0.4857, -0.295, 0.09257, 0.4287, 0.8552, 1.458, 1.704, 2.474, 3.093],
            [-1.622, -1.581, -1.492, -1.252, -1.16, -0.9304, -0.6419, -0.2947, 0.2472, 0.7323, 1.297, 1.857, 2.074, 2.733, 3.081]
          ],
          drift600: 1.667,
          cases: 3429,
          priorWeight: 0,
          driftYoung600: 2.258
        },
        {
          chance: {
            intercept: -3.137,
            recent: [0.3305, 0.05902, 0.04368],
            quality: 0.5534,
            older: -0.3236,
            younger: 0.3338
          },
          conditional: {
            intercept: 1.478,
            recent: [0.1326, 0.07949, 0.02806],
            quality: 0.2894,
            older: 0.164,
            younger: 0.05564
          },
          playSpread: {
            base: 1.259,
            slope: 0.03302
          },
          usageZ: [-2.104, -1.855, -1.682, -1.528, -1.216, -0.9352, -0.5558, -0.1532, 0.4232, 1.036, 1.367, 1.564, 1.792, 1.975, 2.254],
          survivor: {
            intercept: 0.3747,
            slope: 0.5213,
            older: -0.0567,
            younger: 0.08641,
            usage: -0.07828
          },
          tails: [
            [-1.068, -0.972, -0.8658, -0.7564, -0.6623, -0.5781, -0.4583, -0.2853, 0.03612, 0.5258, 0.9341, 1.175, 1.357, 1.479, 1.656],
            [-1.405, -1.148, -0.9989, -0.8789, -0.7156, -0.5926, -0.4471, -0.2612, -0.05192, 0.288, 0.6629, 1.35, 1.802, 2.288, 3.05],
            [-1.587, -1.341, -1.155, -0.9975, -0.8396, -0.7048, -0.493, -0.2423, 0.1205, 0.4877, 0.8625, 1.446, 2.004, 2.593, 2.992],
            [-0.9947, -0.9028, -0.8516, -0.7462, -0.6712, -0.5838, -0.4791, -0.3066, 0.0214, 0.3718, 0.991, 1.248, 1.385, 1.521, 1.657],
            [-1.306, -1.128, -1.012, -0.9034, -0.7417, -0.6221, -0.4659, -0.3076, -0.08636, 0.2357, 0.6128, 1.305, 1.78, 2.304, 3.067],
            [-1.442, -1.229, -1.092, -0.8868, -0.7914, -0.6563, -0.4764, -0.2798, 0.01336, 0.3811, 0.8095, 1.43, 2.003, 2.77, 3.051],
            [-1.068, -0.972, -0.8658, -0.7564, -0.6623, -0.5781, -0.4583, -0.2853, 0.03612, 0.5258, 0.9341, 1.175, 1.357, 1.479, 1.656],
            [-1.405, -1.148, -0.9989, -0.8789, -0.7156, -0.5926, -0.4471, -0.2612, -0.05192, 0.288, 0.6629, 1.35, 1.802, 2.288, 3.05],
            [-1.663, -1.502, -1.277, -1.086, -0.958, -0.7969, -0.5483, -0.08982, 0.3418, 0.6258, 0.9068, 1.465, 1.899, 2.412, 2.618],
            [-1.587, -1.341, -1.155, -0.9975, -0.8396, -0.7048, -0.493, -0.2423, 0.1205, 0.4877, 0.8625, 1.446, 2.004, 2.593, 2.992],
            [-1.32, -1.183, -1.028, -0.9314, -0.8127, -0.6906, -0.4836, -0.3127, -0.02549, 0.3429, 0.6783, 1.298, 1.915, 2.515, 3.065],
            [-1.663, -1.502, -1.277, -1.086, -0.958, -0.7969, -0.5483, -0.08982, 0.3418, 0.6258, 0.9068, 1.465, 1.899, 2.412, 2.618]
          ],
          drift600: 1.638,
          cases: 3131,
          priorWeight: 0,
          driftYoung600: 1.87
        }
      ],
      usageCuts: [0.8977, 2.764],
      ceiling: 6.315,
      observedSpread600: 1.398,
      priorWeight: 0,
      qualityCuts: [0.4155, 2.364]
    },
    reliever: {
      weights: [1, 0.5, 0.4],
      stabilization: 400,
      mean600: 0.8655,
      noise600: 0.8069,
      rateScale600: 1,
      horizons: [
        {
          chance: {
            intercept: -2.515,
            recent: [2.361, 0.2102, 0.0756],
            quality: 1.449,
            older: -0.09488,
            younger: 0.1806
          },
          conditional: {
            intercept: 0.3149,
            recent: [0.4916, 0.02902, 0.04241],
            quality: 0.191,
            older: -0.00475,
            younger: 0.03785
          },
          playSpread: {
            base: 0.3559,
            slope: 0.1633
          },
          usageZ: [-2.251, -1.952, -1.724, -1.509, -1.233, -0.9473, -0.5385, -0.09322, 0.248, 0.6221, 0.9927, 1.616, 2.167, 3.037, 4.87],
          survivor: {
            intercept: -0.5148,
            slope: 0.918,
            older: -0.01385,
            younger: 0.08974,
            usage: 0.2064
          },
          tails: [
            [-1.926, -1.513, -1.287, -0.9458, -0.7645, -0.5662, -0.3283, -0.1611, 0.01357, 0.2703, 0.6297, 1.096, 1.332, 2.143, 3.318],
            [-1.914, -1.394, -0.9088, -0.7159, -0.5102, -0.3677, -0.1503, -0.03479, 0.1669, 0.4032, 0.6434, 1.052, 1.385, 1.956, 2.91],
            [-1.492, -1.07, -0.9058, -0.7789, -0.609, -0.4613, -0.2414, -0.0985, 0.03691, 0.3653, 0.6721, 1.061, 1.35, 1.906, 2.887],
            [-1.95, -1.559, -1.294, -0.983, -0.7885, -0.6326, -0.3798, -0.1729, -0.003451, 0.2659, 0.6034, 1.099, 1.32, 1.908, 3.088],
            [-1.939, -1.528, -1.212, -0.9828, -0.7458, -0.5955, -0.4069, -0.2287, -0.007245, 0.2812, 0.6496, 1.178, 1.663, 2.266, 3.411],
            [-1.741, -1.507, -1.226, -1.038, -0.8023, -0.5838, -0.3644, -0.1328, 0.1321, 0.4576, 0.766, 1.135, 1.459, 1.909, 2.802],
            [-1.926, -1.513, -1.287, -0.9458, -0.7645, -0.5662, -0.3283, -0.1611, 0.01357, 0.2703, 0.6297, 1.096, 1.332, 2.143, 3.318],
            [-1.703, -1.14, -1.088, -1.014, -0.7581, -0.5394, -0.4254, -0.2809, 0.03343, 0.3417, 0.5612, 1.071, 2.049, 2.652, 4.36],
            [-1.696, -1.477, -1.271, -1.086, -0.8148, -0.6163, -0.337, -0.02347, 0.2545, 0.5817, 0.8385, 1.16, 1.502, 2, 3.143],
            [-1.389, -0.8802, -0.8577, -0.6041, -0.4928, -0.3453, -0.222, -0.1205, 0.07545, 0.4593, 0.9201, 1.086, 1.471, 1.946, 2.472],
            [-1.732, -1.342, -1.116, -0.9856, -0.7797, -0.6299, -0.4436, -0.2834, -0.02256, 0.3902, 0.7144, 1.294, 1.801, 2.361, 3.47],
            [-1.553, -1.413, -1.177, -0.9346, -0.7643, -0.6728, -0.4602, -0.08696, 0.2243, 0.5315, 0.783, 1.283, 1.77, 2.504, 3.273]
          ],
          drift600: 0.896,
          cases: 9159,
          priorWeight: 0,
          driftYoung600: 1.17
        },
        {
          chance: {
            intercept: -2.279,
            recent: [1.432, 0.2165, 0.102],
            quality: 1.493,
            older: -0.1075,
            younger: 0.1144
          },
          conditional: {
            intercept: 0.5131,
            recent: [0.3488, 0.0639, 0.01013],
            quality: 0.08238,
            older: 0.001633,
            younger: 0.06429
          },
          playSpread: {
            base: 0.2797,
            slope: 0.2955
          },
          usageZ: [-1.92, -1.783, -1.659, -1.531, -1.29, -1.026, -0.537, -0.08795, 0.2794, 0.5972, 0.9272, 1.408, 2.073, 3.339, 5.552],
          survivor: {
            intercept: -0.3328,
            slope: 0.7121,
            older: 0.03643,
            younger: 0.1279,
            usage: 0.1216
          },
          tails: [
            [-1.866, -1.61, -1.28, -0.9803, -0.7097, -0.4825, -0.2977, -0.1392, 0.05289, 0.3855, 0.8663, 1.285, 1.823, 2.31, 3.203],
            [-1.151, -1.01, -0.7695, -0.6514, -0.5293, -0.4595, -0.2933, -0.135, 0.06631, 0.363, 0.7034, 1.221, 1.431, 2.143, 3.577],
            [-1.524, -0.8564, -0.6953, -0.6431, -0.468, -0.3804, -0.2664, -0.1049, 0.1537, 0.5907, 0.7821, 1.118, 1.317, 3.121, 4.477],
            [-1.791, -1.595, -1.296, -0.9951, -0.7185, -0.4887, -0.2998, -0.15, 0.05098, 0.4925, 0.8886, 1.282, 1.678, 2.09, 3.355],
            [-1.726, -1.301, -1.053, -0.8869, -0.6965, -0.5568, -0.402, -0.2129, -0.01651, 0.31, 0.6354, 1.105, 1.501, 1.919, 3.505],
            [-1.627, -1.321, -1.124, -0.9425, -0.7374, -0.5692, -0.3706, -0.1775, 0.08291, 0.3844, 0.6551, 0.9716, 1.367, 1.841, 2.938],
            [-1.866, -1.61, -1.28, -0.9803, -0.7097, -0.4825, -0.2977, -0.1392, 0.05289, 0.3855, 0.8663, 1.285, 1.823, 2.31, 3.203],
            [-1.705, -1.256, -1.043, -0.8583, -0.6727, -0.5363, -0.3902, -0.2004, 0.001891, 0.3365, 0.6719, 1.154, 1.532, 1.95, 3.69],
            [-1.66, -1.447, -1.197, -1.021, -0.8107, -0.616, -0.3635, -0.1274, 0.2645, 0.5542, 0.8369, 1.198, 1.602, 1.944, 2.66],
            [-1.524, -0.8564, -0.6953, -0.6431, -0.468, -0.3804, -0.2664, -0.1049, 0.1537, 0.5907, 0.7821, 1.118, 1.317, 3.121, 4.477],
            [-1.536, -1.178, -0.9692, -0.8796, -0.6869, -0.5671, -0.4195, -0.274, -0.06029, 0.2917, 0.6104, 1.143, 1.77, 2.613, 4.076],
            [-1.152, -0.9214, -0.8563, -0.7492, -0.6248, -0.4803, -0.2867, -0.02207, 0.3248, 0.6502, 0.8815, 1.53, 1.831, 2.125, 3.145]
          ],
          drift600: 1.352,
          cases: 8323,
          priorWeight: 0,
          driftYoung600: 2.839
        },
        {
          chance: {
            intercept: -2.24,
            recent: [1.164, 0.1928, 0.04667],
            quality: 1.543,
            older: -0.1516,
            younger: 0.09152
          },
          conditional: {
            intercept: 0.6098,
            recent: [0.3399, 0, 0],
            quality: 0.02687,
            older: 0.01133,
            younger: 0.07267
          },
          playSpread: {
            base: 0.2211,
            slope: 0.3504
          },
          usageZ: [-1.887, -1.785, -1.675, -1.55, -1.328, -1.031, -0.5183, -0.09718, 0.2542, 0.5938, 0.8554, 1.376, 2.192, 3.801, 5.381],
          survivor: {
            intercept: -0.1783,
            slope: 0.5828,
            older: 0.05185,
            younger: 0.1372,
            usage: 0.04647
          },
          tails: [
            [-1.347, -1.115, -0.8987, -0.7804, -0.593, -0.432, -0.2165, -0.08869, 0.07931, 0.3698, 0.7088, 1.055, 1.669, 2.199, 2.715],
            [-1.325, -0.9321, -0.833, -0.7334, -0.5301, -0.4464, -0.3126, -0.1966, -0.01934, 0.2932, 0.5914, 1.206, 1.936, 2.941, 3.238],
            [-1.374, -1.241, -0.9412, -0.7739, -0.6445, -0.4916, -0.2682, -0.07456, 0.03725, 0.3867, 0.8325, 1.086, 2.193, 2.802, 5.605],
            [-1.299, -1.034, -0.8985, -0.7911, -0.6457, -0.4965, -0.2558, -0.08869, 0.1189, 0.467, 0.7098, 1.034, 1.668, 2.146, 2.733],
            [-1.49, -1.191, -0.9998, -0.8642, -0.6989, -0.5805, -0.4202, -0.244, -0.03677, 0.3062, 0.5647, 0.9445, 1.323, 1.749, 3.033],
            [-1.487, -1.261, -1.063, -0.914, -0.7271, -0.5671, -0.3984, -0.1985, 0.07751, 0.4072, 0.6311, 0.9724, 1.345, 1.736, 3.464],
            [-1.347, -1.115, -0.8987, -0.7804, -0.593, -0.432, -0.2165, -0.08869, 0.07931, 0.3698, 0.7088, 1.055, 1.669, 2.199, 2.715],
            [-1.49, -1.237, -1.01, -0.854, -0.6964, -0.5607, -0.4039, -0.2319, -0.02834, 0.3235, 0.6042, 0.9914, 1.421, 2.034, 3.193],
            [-1.475, -1.281, -1.076, -0.9535, -0.7302, -0.6101, -0.3839, -0.1615, 0.1641, 0.4939, 0.7582, 1.103, 1.554, 1.938, 2.808],
            [-1.374, -1.241, -0.9412, -0.7739, -0.6445, -0.4916, -0.2682, -0.07456, 0.03725, 0.3867, 0.8325, 1.086, 2.193, 2.802, 5.605],
            [-1.355, -1.132, -0.9554, -0.8448, -0.7006, -0.5761, -0.4149, -0.2225, 0.06425, 0.3463, 0.7355, 1.325, 1.543, 2.579, 3.812],
            [-1.382, -1.167, -1.041, -0.9375, -0.731, -0.6401, -0.4021, -0.1795, 0.1891, 0.5231, 0.7856, 1.2, 2.218, 2.738, 2.917]
          ],
          drift600: 1.836,
          cases: 7460,
          priorWeight: 0,
          driftYoung600: 3.125
        },
        {
          chance: {
            intercept: -2.3,
            recent: [1.016, 0.1241, 0.05203],
            quality: 1.399,
            older: -0.2106,
            younger: 0.1064
          },
          conditional: {
            intercept: 0.6025,
            recent: [0.2873, 0.001936, 0],
            quality: 0.04366,
            older: 0.03897,
            younger: 0.09128
          },
          playSpread: {
            base: 0.1623,
            slope: 0.4051
          },
          usageZ: [-1.859, -1.742, -1.663, -1.554, -1.321, -1.028, -0.5017, -0.09513, 0.2611, 0.6061, 0.8952, 1.411, 2.321, 3.711, 4.878],
          survivor: {
            intercept: -0.09078,
            slope: 0.523,
            older: 0.07819,
            younger: 0.1498,
            usage: -0.003811
          },
          tails: [
            [-1.374, -1.269, -1.091, -0.7938, -0.6392, -0.4955, -0.262, -0.03917, 0.1766, 0.5497, 0.6893, 1.183, 1.742, 2.246, 2.791],
            [-1.508, -1.114, -0.9134, -0.6447, -0.5105, -0.3933, -0.3235, -0.2186, -0.07754, 0.4114, 0.9477, 1.383, 2.301, 3.013, 3.885],
            [-1.373, -1.262, -1.007, -0.6294, -0.4975, -0.413, -0.2348, -0.1216, 0.1804, 0.4247, 0.819, 1.152, 1.726, 2.771, 3.666],
            [-1.379, -1.275, -1.109, -0.8142, -0.6389, -0.5095, -0.285, -0.05851, 0.1465, 0.4566, 0.6637, 0.9521, 1.65, 2.143, 3.121],
            [-1.54, -1.202, -1.019, -0.8708, -0.7105, -0.579, -0.4239, -0.2683, -0.09311, 0.1894, 0.5452, 0.8673, 1.24, 1.868, 2.593],
            [-1.411, -1.161, -0.9741, -0.8409, -0.6804, -0.5281, -0.3438, -0.1715, 0.09773, 0.3961, 0.6713, 0.9873, 1.325, 1.9, 3.199],
            [-1.374, -1.269, -1.091, -0.7938, -0.6392, -0.4955, -0.262, -0.03917, 0.1766, 0.5497, 0.6893, 1.183, 1.742, 2.246, 2.791],
            [-1.562, -1.208, -1.028, -0.8601, -0.6758, -0.5594, -0.4015, -0.2563, -0.07184, 0.2473, 0.6208, 0.9438, 1.431, 2.157, 3.203],
            [-1.442, -1.246, -1.06, -0.9139, -0.7207, -0.5952, -0.4266, -0.1921, 0.03915, 0.3637, 0.6171, 1.003, 1.361, 1.848, 2.711],
            [-1.373, -1.262, -1.007, -0.6294, -0.4975, -0.413, -0.2348, -0.1216, 0.1804, 0.4247, 0.819, 1.152, 1.726, 2.771, 3.666],
            [-1.303, -1.077, -0.9062, -0.8082, -0.6676, -0.5428, -0.4001, -0.2301, 0.04135, 0.2844, 0.7443, 1.299, 1.98, 2.796, 4.112],
            [-1.182, -1.029, -0.8646, -0.7228, -0.6596, -0.569, -0.4494, -0.1533, 0.1738, 0.5195, 0.7805, 1.364, 2.02, 2.728, 3.677]
          ],
          drift600: 2.259,
          cases: 7487,
          priorWeight: 0,
          driftYoung600: 3.536
        },
        {
          chance: {
            intercept: -2.596,
            recent: [0.9137, 0.1564, 0.04224],
            quality: 1.096,
            older: -0.2713,
            younger: 0.1628
          },
          conditional: {
            intercept: 0.6185,
            recent: [0.2216, 0, 0.04153],
            quality: 0.07662,
            older: 0.06975,
            younger: 0.09171
          },
          playSpread: {
            base: 0.09905,
            slope: 0.4529
          },
          usageZ: [-1.848, -1.763, -1.683, -1.595, -1.349, -1.038, -0.4867, -0.07286, 0.2771, 0.5665, 0.865, 1.336, 2.342, 3.948, 5.11],
          survivor: {
            intercept: -0.1002,
            slope: 0.4494,
            older: 0.1056,
            younger: 0.1498,
            usage: -0.008124
          },
          tails: [
            [-1.701, -1.481, -1.278, -0.793, -0.6015, -0.422, -0.2518, -0.05211, 0.4574, 0.8473, 1.066, 1.654, 2.029, 2.219, 2.494],
            [-1.496, -1.199, -0.792, -0.5613, -0.5121, -0.3878, -0.2187, -0.08537, 0.09135, 0.2398, 0.5613, 0.8277, 0.9265, 1.14, 1.524],
            [-1.232, -0.9572, -0.662, -0.6168, -0.5165, -0.4271, -0.3091, -0.156, 0.2493, 0.6005, 0.8222, 1.221, 1.756, 2.31, 3.402],
            [-1.72, -1.531, -1.344, -0.8643, -0.6015, -0.4516, -0.2802, -0.05677, 0.4145, 0.7463, 0.9455, 1.361, 1.863, 2.181, 2.258],
            [-1.337, -1.119, -0.9128, -0.7718, -0.6357, -0.5138, -0.341, -0.1786, 0.05778, 0.3488, 0.5867, 0.8957, 1.255, 1.634, 3.556],
            [-1.499, -1.187, -1.015, -0.8551, -0.663, -0.512, -0.3271, -0.1986, 0.03178, 0.3114, 0.5762, 0.9246, 1.307, 1.566, 2.718],
            [-1.701, -1.481, -1.278, -0.793, -0.6015, -0.422, -0.2518, -0.05211, 0.4574, 0.8473, 1.066, 1.654, 2.029, 2.219, 2.494],
            [-1.459, -1.149, -0.8891, -0.7429, -0.614, -0.4941, -0.328, -0.1744, 0.07576, 0.3492, 0.5922, 0.9267, 1.268, 1.678, 3.383],
            [-1.367, -1.17, -0.9807, -0.8928, -0.719, -0.6108, -0.4217, -0.2168, 0.01102, 0.318, 0.5973, 0.8563, 1.189, 1.415, 3.4],
            [-1.232, -0.9572, -0.662, -0.6168, -0.5165, -0.4271, -0.3091, -0.156, 0.2493, 0.6005, 0.8222, 1.221, 1.756, 2.31, 3.402],
            [-1.36, -1.037, -0.8729, -0.7573, -0.6262, -0.513, -0.3707, -0.223, 0.07802, 0.328, 0.6893, 0.9652, 1.472, 3.134, 3.961],
            [-1.235, -1.073, -0.9989, -0.8927, -0.7753, -0.6832, -0.4188, -0.2598, 0.03313, 0.3275, 0.6075, 1.191, 1.568, 3.346, 3.753]
          ],
          drift600: 2.526,
          cases: 7528,
          priorWeight: 0,
          driftYoung600: 4.001
        },
        {
          chance: {
            intercept: -2.938,
            recent: [0.8187, 0.1732, 0.02521],
            quality: 0.929,
            older: -0.3154,
            younger: 0.2203
          },
          conditional: {
            intercept: 0.6903,
            recent: [0.1371, 0.02144, 0.03595],
            quality: 0.1462,
            older: 0.1059,
            younger: 0.09022
          },
          playSpread: {
            base: 0.02391,
            slope: 0.5298
          },
          usageZ: [-1.781, -1.711, -1.651, -1.575, -1.345, -1.003, -0.5303, -0.1037, 0.2409, 0.5725, 0.8314, 1.377, 2.344, 3.79, 5.167],
          survivor: {
            intercept: -0.03981,
            slope: 0.457,
            older: 0.07971,
            younger: 0.1304,
            usage: -0.05907
          },
          tails: [
            [-1.593, -1.421, -1.168, -0.9755, -0.8505, -0.6137, -0.2426, -0.1261, 0.1453, 0.5668, 1.027, 1.453, 1.858, 2.417, 2.837],
            [-1.469, -1.149, -0.9914, -0.813, -0.6216, -0.5059, -0.3619, -0.1851, 0.04918, 0.4291, 0.6441, 1.023, 1.37, 1.655, 2.694],
            [-1.477, -1.256, -1.105, -0.7415, -0.6063, -0.4635, -0.2707, -0.1809, -0.03597, 0.2258, 0.6488, 1.014, 1.31, 1.792, 1.918],
            [-1.602, -1.458, -1.205, -0.9666, -0.857, -0.6263, -0.3081, -0.1636, 0.1212, 0.7351, 1.102, 1.746, 1.909, 2.519, 2.851],
            [-1.365, -1.111, -0.9702, -0.7815, -0.608, -0.5016, -0.3653, -0.1898, 0.04363, 0.3997, 0.5717, 0.885, 1.197, 1.627, 2.099],
            [-1.193, -1.037, -0.891, -0.7517, -0.5954, -0.4574, -0.3304, -0.1683, 0.04002, 0.3199, 0.5751, 0.8763, 1.374, 1.896, 3.067],
            [-1.593, -1.421, -1.168, -0.9755, -0.8505, -0.6137, -0.2426, -0.1261, 0.1453, 0.5668, 1.027, 1.453, 1.858, 2.417, 2.837],
            [-1.469, -1.149, -0.9914, -0.813, -0.6216, -0.5059, -0.3619, -0.1851, 0.04918, 0.4291, 0.6441, 1.023, 1.37, 1.655, 2.694],
            [-1.5, -1.142, -0.9659, -0.8202, -0.6879, -0.5611, -0.3911, -0.2518, -0.05357, 0.2809, 0.5436, 0.8015, 1.144, 1.398, 3.495],
            [-1.477, -1.256, -1.105, -0.7415, -0.6063, -0.4635, -0.2707, -0.1809, -0.03597, 0.2258, 0.6488, 1.014, 1.31, 1.792, 1.918],
            [-1.214, -1.013, -0.8789, -0.794, -0.5934, -0.5204, -0.368, -0.1835, 0.05972, 0.435, 0.6249, 1.347, 1.975, 2.673, 3.122],
            [-1.232, -1.172, -0.9812, -0.8974, -0.8002, -0.5841, -0.4324, -0.3442, -0.1573, 0.1794, 0.5417, 1.046, 1.236, 3.245, 4.097]
          ],
          drift600: 2.621,
          cases: 7554,
          priorWeight: 0,
          driftYoung600: 3.756
        },
        {
          chance: {
            intercept: -3.342,
            recent: [0.7376, 0.1835, 0.01953],
            quality: 0.9859,
            older: -0.3517,
            younger: 0.265
          },
          conditional: {
            intercept: 0.7762,
            recent: [0.0553, 0, 0.01417],
            quality: 0.1194,
            older: 0.2196,
            younger: 0.09264
          },
          playSpread: {
            base: 0,
            slope: 0.5467
          },
          usageZ: [-1.787, -1.723, -1.668, -1.563, -1.312, -0.9934, -0.5503, -0.1109, 0.2298, 0.5752, 0.8744, 1.32, 2.348, 3.758, 4.736],
          survivor: {
            intercept: 0.1193,
            slope: 0.357,
            older: 0.1068,
            younger: 0.1083,
            usage: -0.1221
          },
          tails: [
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.337, -1.138, -0.9319, -0.7716, -0.6198, -0.5007, -0.3732, -0.1622, 0.101, 0.3956, 0.6192, 0.94, 1.404, 1.827, 2.443],
            [-1.355, -1.156, -0.9754, -0.813, -0.6389, -0.4895, -0.3666, -0.2144, 0.007506, 0.3075, 0.634, 0.9547, 1.274, 1.755, 2.751],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.336, -1.14, -0.9435, -0.7799, -0.6286, -0.5229, -0.3937, -0.1984, 0.04994, 0.3698, 0.5695, 0.8264, 1.367, 1.791, 2.132],
            [-1.34, -1.114, -0.947, -0.8242, -0.6821, -0.5061, -0.3554, -0.1968, 0.008485, 0.294, 0.5979, 0.9412, 1.191, 1.632, 2.772],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.337, -1.138, -0.9319, -0.7716, -0.6198, -0.5007, -0.3732, -0.1622, 0.101, 0.3956, 0.6192, 0.94, 1.404, 1.827, 2.443],
            [-1.355, -1.164, -0.9987, -0.814, -0.6369, -0.4883, -0.3868, -0.2746, 0.00258, 0.3276, 0.6266, 0.8683, 1.367, 1.646, 2.665],
            [-1.355, -1.156, -0.9754, -0.813, -0.6389, -0.4895, -0.3666, -0.2144, 0.007506, 0.3075, 0.634, 0.9547, 1.274, 1.755, 2.751],
            [-1.301, -1.141, -0.9922, -0.8279, -0.7342, -0.5839, -0.4486, -0.2928, -0.06313, 0.2211, 0.424, 0.958, 1.143, 2.569, 4.409],
            [-1.35, -1.179, -0.9855, -0.8133, -0.6266, -0.4783, -0.3825, -0.2412, 0.02683, 0.2259, 0.7003, 1.441, 2.035, 3.408, 4.509]
          ],
          drift600: 2.448,
          cases: 6771,
          priorWeight: 0,
          driftYoung600: 3.526
        }
      ],
      usageCuts: [0.1382, 0.6832],
      ceiling: 3.877,
      observedSpread600: 1.496,
      priorWeight: 0,
      qualityCuts: [0.2404, 1.318]
    }
  },
  aging: {
    firstAge: 19,
    hitter: [0.1831, 0.1831, 0.1831, 0.1016, 0.0242, -0.0492, -0.1186, -0.184, -0.2454, -0.3027, -0.3561, -0.4054, -0.4508, -0.4921, -0.5294, -0.5627, -0.592, -0.6173, -0.6386, -0.6559, -0.6559, -0.6559, -0.6559, -0.6559, -0.6559, -0.6559],
    pitcher: [0.1303, 0.1303, 0.1303, 0.1303, 0.06821, 0.008892, -0.04763, -0.1013, -0.1523, -0.2004, -0.2457, -0.2882, -0.328, -0.3649, -0.399, -0.4303, -0.4589, -0.4846, -0.5075, -0.5277, -0.545, -0.545, -0.545, -0.545, -0.545, -0.545]
  },
  usagePivotAge: 30,
  proneness: {
    cuts: [56, 75],
    usage: {
      hitter: [1, 1, 1],
      pitcher: [1, 1, 1]
    },
    aging: {
      hitter: [
        [0, 0],
        [0, 0],
        [0, 0]
      ],
      pitcher: [
        [0, 0],
        [0, 0],
        [0, 0]
      ]
    },
    ageSplit: 30,
    findings: ["Hitters, proneness \u2264 56: playing time 101.3% of the league's rate for the same expected usage (\u00b1 1.5, clustered by player: 1070 players, 11843 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness 56\u201375: playing time 100.9% of the league's rate for the same expected usage (\u00b1 1.7, clustered by player: 635 players, 8452 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness > 75: playing time 97.5% of the league's rate for the same expected usage (\u00b1 1.7, clustered by player: 634 players, 9954 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness \u2264 56, under 30: aging +0.010 WAR per 600 a year against the curve (\u00b1 0.033, clustered: 534 players, 1688 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness \u2264 56, 30 and over: aging -0.066 WAR per 600 a year against the curve (\u00b1 0.058, clustered: 199 players, 524 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness 56\u201375, under 30: aging -0.021 WAR per 600 a year against the curve (\u00b1 0.035, clustered: 347 players, 1136 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness 56\u201375, 30 and over: aging -0.010 WAR per 600 a year against the curve (\u00b1 0.053, clustered: 154 players, 529 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness > 75, under 30: aging +0.042 WAR per 600 a year against the curve (\u00b1 0.040, clustered: 295 players, 982 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness > 75, 30 and over: aging +0.009 WAR per 600 a year against the curve (\u00b1 0.037, clustered: 272 players, 960 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness \u2264 56: playing time 92.3% of the league's rate for the same expected usage (\u00b1 3.0, clustered by player: 760 players, 8259 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness 56\u201375: playing time 104.1% of the league's rate for the same expected usage (\u00b1 2.1, clustered by player: 1089 players, 10853 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness > 75: playing time 100.2% of the league's rate for the same expected usage (\u00b1 1.6, clustered by player: 1122 players, 15882 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness \u2264 56, under 30: aging -0.036 WAR per 600 a year against the curve (\u00b1 0.042, clustered: 286 players, 754 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness \u2264 56, 30 and over: aging +0.068 WAR per 600 a year against the curve (\u00b1 0.064, clustered: 99 players, 266 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness 56\u201375, under 30: aging -0.032 WAR per 600 a year against the curve (\u00b1 0.030, clustered: 521 players, 1404 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness 56\u201375, 30 and over: aging +0.028 WAR per 600 a year against the curve (\u00b1 0.046, clustered: 197 players, 512 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness > 75, under 30: aging +0.005 WAR per 600 a year against the curve (\u00b1 0.026, clustered: 607 players, 1796 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness > 75, 30 and over: aging +0.043 WAR per 600 a year against the curve (\u00b1 0.034, clustered: 339 players, 1046 pairs) \u2014 not distinguishable from none (Holm), not used."]
  },
  referenceGames: 155
};

/**
 * The ratings model's fallback prior (phase 3b): used until the save has an adopted ratings fit of its
 * own, and the one a thin ratings fit is shrunk toward. The only other fitted artefact code may carry
 * (D-053). It carries NO arrivals: how often players at a level and age reach the majors is measured on
 * each save or not stated, so under this prior a player not in the majors has no expected playing time.
 */
export const RATINGS_PRIOR_CALIBRATION: CalibrationStamp = provisional(
  'Fallback ratings prior, fitted by the ratings method (playerValueRatingsFit.ts, no prior, no hold-out) on the Arizona historical save (export of 2026-05-16, ' +
    'league 203) with `npm run calibrate production -- --prior`: the same-time ratings → rate mapping on its major leaguers, the stamina cut, how often each hand ' +
    "faces left-handers, the largest scouted development by age, and a development path read from ONE cross-section of scouted gaps by age (not a path: survivors " +
    "only, with its range from no further development to twice its central share). Never the save's own calibration (D-053). No arrivals: measured per save or unknown."
);

export const RATINGS_PRIOR: RatingsModel = {
  method: RATINGS_METHOD,
  mapping: {
    hitter: {
      full: {
        intercepts: { 2: -10.64, 3: -11.09, 4: -10.99, 5: -11.15, 6: -10.84, 7: -11.08, 8: -11.05, 9: -11.07, pooled: -10.99 },
        tools: { contact: 0.09773, gap: 0.01117, power: 0.083, eye: 0.04554, avoidK: 0.006931 },
        running: 0.0063,
        glove: 0.01013,
        variance600: 0,
        cases: 515
      },
      noGlove: {
        intercepts: { 2: -10.21, 3: -10.66, 4: -10.57, 5: -10.73, 6: -10.44, 7: -10.69, 8: -10.63, 9: -10.67, pooled: -9.895 },
        tools: { contact: 0.09651, gap: 0.01213, power: 0.08301, eye: 0.04459, avoidK: 0.007577 },
        running: 0.009716,
        glove: 0,
        variance600: 0,
        cases: 517
      },
      noRunning: {
        intercepts: { 2: -10.46, 3: -10.9, 4: -10.74, 5: -10.93, 6: -10.57, 7: -10.83, 8: -10.76, 9: -10.81, pooled: -10.75 },
        tools: { contact: 0.0986, gap: 0.01245, power: 0.08176, eye: 0.0454, avoidK: 0.006066 },
        running: 0,
        glove: 0.01179,
        variance600: 0,
        cases: 515
      },
      bat: {
        intercepts: { 2: -9.768, 3: -10.2, 4: -10.02, 5: -10.22, 6: -9.852, 7: -10.15, 8: -10.03, 9: -10.1, pooled: -9.274 },
        tools: { contact: 0.09756, gap: 0.01444, power: 0.08093, eye: 0.0441, avoidK: 0.00631 },
        running: 0,
        glove: 0,
        variance600: 0,
        cases: 517
      }
    },
    starter: {
      intercept: -8.635,
      tools: { stuff: 0.08242, movement: 0.08901, control: 0.04665 },
      variance600: 0.07096,
      cases: 240,
      without: {
        stuff: {
          intercept: -6.549,
          tools: { stuff: 0, movement: 0.1294, control: 0.04016 },
          variance600: 0.3541,
          cases: 240
        },
        movement: {
          intercept: -5.94,
          tools: { stuff: 0.1074, movement: 0, control: 0.05361 },
          variance600: 0.2591,
          cases: 240
        },
        control: {
          intercept: -6.423,
          tools: { stuff: 0.07638, movement: 0.0996, control: 0 },
          variance600: 0.2252,
          cases: 240
        }
      }
    },
    reliever: {
      intercept: -9.212,
      tools: { stuff: 0.05796, movement: 0.09539, control: 0.05725 },
      variance600: 0,
      cases: 390,
      without: {
        stuff: {
          intercept: -6.161,
          tools: { stuff: 0, movement: 0.1109, control: 0.03512 },
          variance600: 0.07946,
          cases: 390
        },
        movement: {
          intercept: -5.628,
          tools: { stuff: 0.07168, movement: 0, control: 0.06562 },
          variance600: 0.00579,
          cases: 390
        },
        control: {
          intercept: -6.04,
          tools: { stuff: 0.04082, movement: 0.103, control: 0 },
          variance600: 0,
          cases: 390
        }
      }
    }
  },
  leftShare: { L: 0.1987, R: 0.32, S: 0.2793 },
  staminaCut: 50,
  development: {
    source: "fallback_prior",
    label: "Not yet calibrated on this save: the provisional development prior, one cross-section of scouted gaps by age on the Arizona import (not a path; survivors only), its range from no further development to twice its central share.",
    firstAge: 16,
    hitter: [
      [
        [0, 0.1769, 0.3537],
        [0, 0.2905, 0.581],
        [0, 0.4134, 0.8268],
        [0, 0.4482, 0.8965],
        [0, 0.4776, 0.9552],
        [0, 0.5207, 1],
        [0, 0.5832, 1]
      ],
      [
        [0, 0.138, 0.2761],
        [0, 0.2874, 0.5747],
        [0, 0.3297, 0.6594],
        [0, 0.3653, 0.7307],
        [0, 0.4177, 0.8353],
        [0, 0.4937, 0.9874],
        [0, 0.6045, 1]
      ],
      [
        [0, 0.1733, 0.3465],
        [0, 0.2223, 0.4447],
        [0, 0.2637, 0.5274],
        [0, 0.3244, 0.6488],
        [0, 0.4126, 0.8252],
        [0, 0.5411, 1],
        [0, 0.7883, 1]
      ],
      [
        [0, 0.05937, 0.1187],
        [0, 0.1094, 0.2188],
        [0, 0.1828, 0.3657],
        [0, 0.2895, 0.579],
        [0, 0.445, 0.8899],
        [0, 0.7439, 1],
        [0, 0.9897, 1]
      ],
      [
        [0, 0.0532, 0.1064],
        [0, 0.1312, 0.2625],
        [0, 0.2447, 0.4894],
        [0, 0.4099, 0.8198],
        [0, 0.7278, 1],
        [0, 0.989, 1],
        [0, 0.989, 1]
      ],
      [
        [0, 0.08243, 0.1649],
        [0, 0.2022, 0.4045],
        [0, 0.3768, 0.7535],
        [0, 0.7125, 1],
        [0, 0.9884, 1],
        [0, 0.9884, 1],
        [0, 0.9896, 1]
      ],
      [
        [0, 0.1306, 0.2611],
        [0, 0.3208, 0.6415],
        [0, 0.6866, 1],
        [0, 0.9874, 1],
        [0, 0.9874, 1],
        [0, 0.9887, 1],
        [0, 0.9941, 1]
      ],
      [
        [0, 0.2188, 0.4375],
        [0, 0.6396, 1],
        [0, 0.9855, 1],
        [0, 0.9855, 1],
        [0, 0.987, 1],
        [0, 0.9933, 1],
        [0, 0.9954, 1]
      ],
      [
        [0, 0.5387, 1],
        [0, 0.9814, 1],
        [0, 0.9814, 1],
        [0, 0.9833, 1],
        [0, 0.9914, 1],
        [0, 0.9941, 1],
        [0, 1, 1]
      ],
      [
        [0, 0.9597, 1],
        [0, 0.9597, 1],
        [0, 0.9639, 1],
        [0, 0.9813, 1],
        [0, 0.9872, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0, 0],
        [0, 0.1023, 0.2047],
        [0, 0.5359, 1],
        [0, 0.6813, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0.1023, 0.2047],
        [0, 0.5359, 1],
        [0, 0.6813, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0.483, 0.966],
        [0, 0.645, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0.3133, 0.6267],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]
    ],
    pitcher: [
      [
        [0, 0.02044, 0.04087],
        [0, 0.05479, 0.1096],
        [0, 0.1547, 0.3093],
        [0, 0.2631, 0.5262],
        [0, 0.3304, 0.6607],
        [0, 0.3756, 0.7511],
        [0, 0.4172, 0.8345]
      ],
      [
        [0, 0.03507, 0.07013],
        [0, 0.137, 0.2741],
        [0, 0.2477, 0.4954],
        [0, 0.3164, 0.6328],
        [0, 0.3625, 0.7251],
        [0, 0.4051, 0.8102],
        [0, 0.4668, 0.9335]
      ],
      [
        [0, 0.1057, 0.2113],
        [0, 0.2204, 0.4408],
        [0, 0.2916, 0.5831],
        [0, 0.3394, 0.6788],
        [0, 0.3835, 0.7669],
        [0, 0.4474, 0.8948],
        [0, 0.7104, 1]
      ],
      [
        [0, 0.1283, 0.2565],
        [0, 0.2079, 0.4157],
        [0, 0.2613, 0.5227],
        [0, 0.3106, 0.6212],
        [0, 0.3821, 0.7642],
        [0, 0.6761, 1],
        [0, 0.9814, 1]
      ],
      [
        [0, 0.0913, 0.1826],
        [0, 0.1526, 0.3053],
        [0, 0.2092, 0.4184],
        [0, 0.2912, 0.5824],
        [0, 0.6285, 1],
        [0, 0.9787, 1],
        [0, 0.9915, 1]
      ],
      [
        [0, 0.0675, 0.135],
        [0, 0.1297, 0.2595],
        [0, 0.22, 0.4399],
        [0, 0.5912, 1],
        [0, 0.9765, 1],
        [0, 0.9907, 1],
        [0, 0.9907, 1]
      ],
      [
        [0, 0.06673, 0.1335],
        [0, 0.1635, 0.327],
        [0, 0.5616, 1],
        [0, 0.9748, 1],
        [0, 0.99, 1],
        [0, 0.99, 1],
        [0, 0.99, 1]
      ],
      [
        [0, 0.1037, 0.2074],
        [0, 0.5302, 1],
        [0, 0.973, 1],
        [0, 0.9893, 1],
        [0, 0.9893, 1],
        [0, 0.9893, 1],
        [0, 0.9968, 1]
      ],
      [
        [0, 0.4759, 0.9517],
        [0, 0.9699, 1],
        [0, 0.988, 1],
        [0, 0.988, 1],
        [0, 0.988, 1],
        [0, 0.9964, 1],
        [0, 1, 1]
      ],
      [
        [0, 0.9426, 1],
        [0, 0.9771, 1],
        [0, 0.9771, 1],
        [0, 0.9771, 1],
        [0, 0.9932, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0.6022, 1],
        [0, 0.6022, 1],
        [0, 0.6022, 1],
        [0, 0.8812, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0.7013, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0, 0],
        [0, 0.7013, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0.7013, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1],
        [0, 1, 1]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]
    ],
    pairs: 0
  },
  arrival: null,
  potentialGap: {
    firstAge: 16,
    hitter: [7.552, 7.663, 7.307, 6.522, 6.728, 6.463, 6.673, 5.133, 5.747, 4.837, 0.6427, 0.6912, 0.5899, 0.5163, 0.2277, 0.3039, 0.1519, 0.1013, 0.1013, 0.2026, 0.1519, 0.2026, 0, 0, 0],
    pitcher: [5.419, 5.652, 5.474, 4.953, 4.307, 4.508, 4.508, 4.095, 4.074, 4.095, 1.339, 0.8572, 0.8572, 0.477, 0.4121, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  reliability: {
    hitter: { variance600: null, cases: 0 },
    starter: { variance600: null, cases: 0 },
    reliever: { variance600: null, cases: 0 }
  }
};
