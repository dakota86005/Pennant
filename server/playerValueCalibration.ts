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
export const PRODUCTION_METHOD = 'production-3b.1';

/**
 * The method's policy (D-041, D-053): chosen, stated and changed by decision, never by fitting.
 *
 *   coverage       the bands' targets: an 80% outer and a 50% inner central interval.
 *   rateUnit       rates are stated in WAR per 600 opportunities (plate appearances or batters faced).
 *   window         the era rule: the most recent 20 completed seasons of the save's own history, a season
 *                  shorter than 90% of the schedule skipped (the 2020 season on a real-history save); the
 *                  most recent 45% of them held out as targets the fit never sees.
 *   gate           a fit is adopted only if, at every horizon with at least 200 held-out cases, its
 *                  held-out coverage is within 10 points of each target, and horizon 1 is evaluable.
 *   minimumSample  a season enters an aging pair only with 100 opportunities in each of the two seasons;
 *                  a component is fitted only on 50 cases (30 aging pairs), and is the prior's below that.
 *   agingAges      the aging curve is tabulated from 19 to 44; beyond, the end values hold.
 *   usageTiers     the band's tails are set apart for thirds of expected first-season usage within each
 *                  kind (fringe, part-time, regular), so a band calibrated on average holds for each.
 *   prior          thin history shrinks toward the fallback prior: weight strength ÷ (cases + strength)
 *                  per component (250 backtest cases per kind and horizon, 100 aging pairs: the sample at which
 *                  the save and the prior weigh equally), and the bands widen by
 *                  half the prior's weight.
 *   twoWayMinimum  a player's second side is projected only with 100 weighted opportunities in the window.
 *   starterShare   a pitcher who started at least half his games in the window is read as a starter.
 *   usagePivotAge  the age at which the usage regression bends.
 *   qualityTiers   the band's tails are also set apart by projected rate within each kind: the bottom
 *                  tenth, the middle and the top tenth (phase 3b: playing time depends on quality, so a
 *                  replacement-level player's and a star's outcomes are spread differently).
 *   proneness      proneness is banded into three equal-count bands of the save's own values; an effect
 *                  is used only when it is at least two standard errors from none; aging effects are
 *                  read apart for players younger than 30 and 30 or older.
 */
export const PRODUCTION_POLICY = {
  coverage: { outer: 0.8, inner: 0.5 },
  rateUnitOpportunities: 600,
  window: { maxSeasons: 20, minShareOfSchedule: 0.9, holdoutShare: 0.45 },
  gate: { tolerance: 0.1, minimumCases: 200 },
  minimumSample: { agingOpportunities: 100, agingPairs: 30, fitCases: 50 },
  agingAges: { first: 19, last: 44 },
  usageTiers: 3,
  prior: { strength: 250, agingStrength: 100, widening: 0.5 },
  twoWayMinimum: 100,
  starterShare: 0.5,
  usagePivotAge: 30,
  qualityTiers: { edges: [0.1, 0.9] },
  proneness: { bands: 3, evidence: 2, ageSplit: 30 },
} as const;

export const PRODUCTION_POLICY_CALIBRATION: CalibrationStamp = policy(
  'The coverage targets (80% and 50%), the era and hold-out rule, the adoption gate and its tolerance, the minimum samples, the prior\'s strength and widening, ' +
    'the two-way minimum, the starter share, the usage pivot age and the proneness banding and evidence rule are decisions about the method (D-053), not fits.'
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

export const PRODUCTION_PRIOR: ProductionModel = {
  method: PRODUCTION_METHOD,
  kinds: {
    hitter: {
      weights: [1, 0.9, 0.8],
      stabilization: 200,
      mean600: 1.984,
      noise600: 1.393,
      rateScale600: 2.672,
      horizons: [
        {
          chance: { intercept: -1.207, recent: [0.01047, 0.0006004, 0], quality: 0, older: -0.1937, younger: 0.2518 },
          conditional: { intercept: 4.832, recent: [0.4956, 0.09136, 0.08525], quality: 35.4, older: -4.04, younger: 13.73 },
          usageSpread: { base: 51.3, slope: 0.1935 },
          usageTails: { low: 1.462, high: 1.573 },
          tails: [
            { low80: 1.722, high80: 0.2243, low50: 0.8132, high50: 0.03135 },
            { low80: 0.9546, high80: 0.6602, low50: 0.4769, high50: 0.186 },
            { low80: 1.088, high80: 1.437, low50: 0.6367, high50: 0.6971 },
            { low80: 0.2071, high80: 0, low50: 0.1167, high50: 0 },
            { low80: 0.7391, high80: 1.232, low50: 0.4496, high50: 0.04545 },
            { low80: 1.01, high80: 1.471, low50: 0.6164, high50: 0.6573 },
            { low80: 0.3366, high80: 0.01802, low50: 0.1312, high50: 0 },
            { low80: 1.137, high80: 2.571, low50: 0.8292, high50: 1.219 },
            { low80: 1.368, high80: 1.358, low50: 0.7694, high50: 0.755 }
          ],
          drift600: 1.144,
          cases: 12070
        },
        {
          chance: { intercept: -1.525, recent: [0.006723, 0.0006974, 0], quality: 0.09621, older: -0.2507, younger: 0.2695 },
          conditional: { intercept: 20.95, recent: [0.3754, 0.101, 0.1063], quality: 38.62, older: -5.081, younger: 18.09 },
          usageSpread: { base: 53.47, slope: 0.2658 },
          usageTails: { low: 1.439, high: 1.601 },
          tails: [
            { low80: 1.278, high80: 0.2418, low50: 0.3319, high50: 0.07089 },
            { low80: 0.7733, high80: 0.6733, low50: 0.3341, high50: 0.2263 },
            { low80: 0.8808, high80: 1.572, low50: 0.5263, high50: 0.7741 },
            { low80: 0.1336, high80: 0.008699, low50: 0.06021, high50: 0 },
            { low80: 0.5808, high80: 1.36, low50: 0.3403, high50: 0.05514 },
            { low80: 0.7926, high80: 1.561, low50: 0.4976, high50: 0.7452 },
            { low80: 0.169, high80: 0.04198, low50: 0.0648, high50: 0.001612 },
            { low80: 1.105, high80: 3.358, low50: 0.6977, high50: 0.9815 },
            { low80: 1.107, high80: 1.561, low50: 0.5964, high50: 0.808 }
          ],
          drift600: 1.869,
          cases: 11140
        },
        {
          chance: { intercept: -1.823, recent: [0.005105, 0.0005354, 0], quality: 0.2986, older: -0.31, younger: 0.2457 },
          conditional: { intercept: 34.37, recent: [0.3131, 0.1025, 0.09892], quality: 41.75, older: -3.376, younger: 20.66 },
          usageSpread: { base: 50.95, slope: 0.3293 },
          usageTails: { low: 1.403, high: 1.599 },
          tails: [
            { low80: 0.8791, high80: 0.2059, low50: 0, high50: 0.1024 },
            { low80: 0.5272, high80: 0.612, low50: 0.03072, high50: 0.3209 },
            { low80: 0.7465, high80: 1.653, low50: 0.4171, high50: 0.7693 },
            { low80: 0.0675, high80: 0.02656, low50: 0.0175, high50: 0.008081 },
            { low80: 0.4757, high80: 1.26, low50: 0.2536, high50: 0.06834 },
            { low80: 0.6459, high80: 1.675, low50: 0.3725, high50: 0.7573 },
            { low80: 0.09032, high80: 0.07018, low50: 0.01674, high50: 0.01707 },
            { low80: 0.8712, high80: 1.084, low50: 0.6724, high50: 0.009894 },
            { low80: 0.9615, high80: 1.608, low50: 0.6044, high50: 0.809 }
          ],
          drift600: 2.457,
          cases: 10190
        },
        {
          chance: { intercept: -2.171, recent: [0.004332, 0.0003252, 0], quality: 0.481, older: -0.3536, younger: 0.244 },
          conditional: { intercept: 43.7, recent: [0.2919, 0.1103, 0.07271], quality: 42.1, older: -1.485, younger: 21.68 },
          usageSpread: { base: 45.35, slope: 0.3882 },
          usageTails: { low: 1.332, high: 1.56 },
          tails: [
            { low80: 0.3164, high80: 0.2237, low50: 0, high50: 0.1307 },
            { low80: 0.5406, high80: 0.5938, low50: 0, high50: 0.352 },
            { low80: 0.6489, high80: 1.741, low50: 0.3265, high50: 0.7444 },
            { low80: 0.01787, high80: 0.04274, low50: 0, high50: 0.0201 },
            { low80: 0.3909, high80: 1.163, low50: 0.1689, high50: 0.08805 },
            { low80: 0.5478, high80: 1.767, low50: 0.2689, high50: 0.7192 },
            { low80: 0.02247, high80: 0.08747, low50: 0, high50: 0.03258 },
            { low80: 0.8437, high80: 0.7929, low50: 0.4758, high50: 0 },
            { low80: 0.8692, high80: 1.717, low50: 0.5362, high50: 0.7778 }
          ],
          drift600: 2.379,
          cases: 10180
        },
        {
          chance: { intercept: -2.542, recent: [0.003593, 0.0005333, 0], quality: 0.5982, older: -0.4018, younger: 0.2641 },
          conditional: { intercept: 57.54, recent: [0.293, 0.07269, 0.07283], quality: 36.33, older: 1.904, younger: 23.72 },
          usageSpread: { base: 40.12, slope: 0.4531 },
          usageTails: { low: 1.248, high: 1.473 },
          tails: [
            { low80: 0, high80: 0.2458, low50: 0, high50: 0.1596 },
            { low80: 0.2222, high80: 0.6093, low50: 0, high50: 0.3865 },
            { low80: 0.5195, high80: 1.66, low50: 0.2177, high50: 0.6159 },
            { low80: 0, high80: 0.06649, low50: 0, high50: 0.03792 },
            { low80: 0.2798, high80: 0.9235, low50: 0.08557, high50: 0.1135 },
            { low80: 0.4186, high80: 1.647, low50: 0.1572, high50: 0.5007 },
            { low80: 0, high80: 0.1103, low50: 0, high50: 0.0517 },
            { low80: 0.5269, high80: 2.238, low50: 0.3651, high50: 0 },
            { low80: 0.7352, high80: 1.665, low50: 0.4045, high50: 0.7813 }
          ],
          drift600: 2.875,
          cases: 10180
        },
        {
          chance: { intercept: -3.055, recent: [0.003317, 0.0006015, 0.0001113], quality: 0.6236, older: -0.439, younger: 0.3163 },
          conditional: { intercept: 73.07, recent: [0.2464, 0.09885, 0.03935], quality: 39.79, older: 1.661, younger: 23.41 },
          usageSpread: { base: 34.58, slope: 0.5088 },
          usageTails: { low: 1.176, high: 1.234 },
          tails: [
            { low80: 0, high80: 0.2646, low50: 0, high50: 0.181 },
            { low80: 0.04934, high80: 0.6049, low50: 0, high50: 0.4184 },
            { low80: 0.4207, high80: 1.62, low50: 0.1134, high50: 0.4301 },
            { low80: 0, high80: 0.08628, low50: 0, high50: 0.05282 },
            { low80: 0.2006, high80: 0.6486, low50: 0.01427, high50: 0.1399 },
            { low80: 0.3039, high80: 1.569, low50: 0.03419, high50: 0.3222 },
            { low80: 0, high80: 0.1281, low50: 0, high50: 0.06729 },
            { low80: 0.4378, high80: 0.8452, low50: 0.1594, high50: 0.004217 },
            { low80: 0.6235, high80: 1.816, low50: 0.2938, high50: 0.7252 }
          ],
          drift600: 2.658,
          cases: 10180
        },
        {
          chance: { intercept: -3.587, recent: [0.003012, 0.0009171, 0], quality: 0.637, older: -0.4788, younger: 0.3737 },
          conditional: { intercept: 78.69, recent: [0.2651, 0.04043, 0.05877], quality: 32.31, older: 1.096, younger: 25.5 },
          usageSpread: { base: 27.99, slope: 0.5928 },
          usageTails: { low: 1.107, high: 0.9057 },
          tails: [
            { low80: 0, high80: 0.2606, low50: 0, high50: 0.1692 },
            { low80: 0, high80: 0.5919, low50: 0, high50: 0.4438 },
            { low80: 0.2911, high80: 1.474, low50: 0.02318, high50: 0.3478 },
            { low80: 0, high80: 0.1027, low50: 0, high50: 0.06531 },
            { low80: 0.1073, high80: 0.3051, low50: 0, high50: 0.1644 },
            { low80: 0.1814, high80: 1.381, low50: 0, high50: 0.3004 },
            { low80: 0, high80: 0.1321, low50: 0, high50: 0.0773 },
            { low80: 0.2748, high80: 0.02215, low50: 0.08855, high50: 0.01343 },
            { low80: 0.4721, high80: 1.737, low50: 0.1586, high50: 0.6322 }
          ],
          drift600: 3.086,
          cases: 9261
        }
      ],
      usageCuts: [41.07, 226.8],
      priorWeight: 1,
      qualityCuts: [0.3314, 3.329]
    },
    starter: {
      weights: [1, 0.5, 0.3],
      stabilization: 300,
      mean600: 1.294,
      noise600: 0.9058,
      rateScale600: 1.732,
      horizons: [
        {
          chance: { intercept: -1.679, recent: [0.004933, 0.0003346, 0.0006053], quality: 0.5342, older: -0.1698, younger: 0.2157 },
          conditional: { intercept: 109.9, recent: [0.4369, 0.02195, 0.06404], quality: 74.81, older: 3.627, younger: 5.154 },
          usageSpread: { base: 111.1, slope: 0.1809 },
          usageTails: { low: 1.467, high: 1.615 },
          tails: [
            { low80: 0.35, high80: 0.2854, low50: 0.03715, high50: 0.06514 },
            { low80: 0.5214, high80: 1.332, low50: 0.1939, high50: 0.3996 },
            { low80: 1.097, high80: 1.3, low50: 0.6724, high50: 0.6903 },
            { low80: 0.4202, high80: 0.04705, low50: 0.2263, high50: 0 },
            { low80: 0.8826, high80: 1.346, low50: 0.5587, high50: 0.3918 },
            { low80: 1.013, high80: 1.242, low50: 0.6449, high50: 0.6373 },
            { low80: 0.3998, high80: 0.1549, low50: 0.2167, high50: 0 },
            { low80: 0.8801, high80: 1.347, low50: 0.5375, high50: 0.4169 },
            { low80: 1.379, high80: 1.362, low50: 0.8961, high50: 0.7702 }
          ],
          drift600: 0.7305,
          cases: 4112
        },
        {
          chance: { intercept: -1.9, recent: [0.003066, 0.0006997, 0.0006005], quality: 0.7731, older: -0.2031, younger: 0.1938 },
          conditional: { intercept: 160.5, recent: [0.286, 0.01445, 0.1019], quality: 74.97, older: 9.467, younger: 7.166 },
          usageSpread: { base: 110.8, slope: 0.2784 },
          usageTails: { low: 1.387, high: 1.707 },
          tails: [
            { low80: 0.1231, high80: 0.2766, low50: 0, high50: 0.1165 },
            { low80: 0.4009, high80: 1.029, low50: 0.09751, high50: 0.3964 },
            { low80: 0.9666, high80: 1.345, low50: 0.5558, high50: 0.6474 },
            { low80: 0.2928, high80: 0.05114, low50: 0.1628, high50: 0.0006114 },
            { low80: 0.745, high80: 1.565, low50: 0.4332, high50: 0.399 },
            { low80: 0.8337, high80: 1.318, low50: 0.5073, high50: 0.6118 },
            { low80: 0.2814, high80: 0.1727, low50: 0.1447, high50: 0.01205 },
            { low80: 0.7363, high80: 1.528, low50: 0.4078, high50: 0.4173 },
            { low80: 1.312, high80: 1.391, low50: 0.8538, high50: 0.7197 }
          ],
          drift600: 1.285,
          cases: 3772
        },
        {
          chance: { intercept: -1.997, recent: [0.002575, 0.0006194, 0.0005325], quality: 0.739, older: -0.2337, younger: 0.1965 },
          conditional: { intercept: 210.2, recent: [0.1765, 0.04421, 0.08564], quality: 75.04, older: 14.81, younger: 6.163 },
          usageSpread: { base: 107.2, slope: 0.3396 },
          usageTails: { low: 1.316, high: 1.813 },
          tails: [
            { low80: 0.04081, high80: 0.3157, low50: 0, high50: 0.1721 },
            { low80: 0.2473, high80: 1.08, low50: 0.06149, high50: 0.33 },
            { low80: 0.8264, high80: 1.339, low50: 0.4595, high50: 0.6002 },
            { low80: 0.2042, high80: 0.09722, low50: 0.09041, high50: 0.02676 },
            { low80: 0.5878, high80: 1.481, low50: 0.3097, high50: 0.3837 },
            { low80: 0.682, high80: 1.337, low50: 0.3973, high50: 0.5687 },
            { low80: 0.1964, high80: 0.1918, low50: 0.0768, high50: 0.04525 },
            { low80: 0.587, high80: 1.447, low50: 0.2942, high50: 0.3644 },
            { low80: 1.136, high80: 1.363, low50: 0.7638, high50: 0.6599 }
          ],
          drift600: 1.907,
          cases: 3419
        },
        {
          chance: { intercept: -2.166, recent: [0.002233, 0.0006699, 0.0004012], quality: 0.7771, older: -0.2586, younger: 0.2096 },
          conditional: { intercept: 226.7, recent: [0.1718, 0.04072, 0.07939], quality: 60.45, older: 15.49, younger: 6.216 },
          usageSpread: { base: 89.45, slope: 0.4333 },
          usageTails: { low: 1.221, high: 1.725 },
          tails: [
            { low80: 0, high80: 0.3101, low50: 0, high50: 0.1916 },
            { low80: 0.09758, high80: 1.071, low50: 0, high50: 0.4316 },
            { low80: 0.6971, high80: 1.318, low50: 0.3853, high50: 0.5327 },
            { low80: 0.133, high80: 0.1117, low50: 0.03238, high50: 0.05503 },
            { low80: 0.5242, high80: 1.557, low50: 0.2567, high50: 0.2858 },
            { low80: 0.5894, high80: 1.268, low50: 0.3103, high50: 0.4617 },
            { low80: 0.1223, high80: 0.1651, low50: 0.0216, high50: 0.07418 },
            { low80: 0.5057, high80: 1.558, low50: 0.2264, high50: 0.3378 },
            { low80: 0.9932, high80: 1.551, low50: 0.6772, high50: 0.6813 }
          ],
          drift600: 2.448,
          cases: 3427
        },
        {
          chance: { intercept: -2.383, recent: [0.002054, 0.0004775, 0.0004327], quality: 0.7412, older: -0.2939, younger: 0.2501 },
          conditional: { intercept: 236.2, recent: [0.1797, 0.04653, 0.05183], quality: 57.72, older: 18.4, younger: 3.448 },
          usageSpread: { base: 74.59, slope: 0.5168 },
          usageTails: { low: 1.149, high: 1.708 },
          tails: [
            { low80: 0, high80: 0.303, low50: 0, high50: 0.2074 },
            { low80: 0.1105, high80: 1.08, low50: 0, high50: 0.3814 },
            { low80: 0.5508, high80: 1.382, low50: 0.262, high50: 0.4669 },
            { low80: 0.07105, high80: 0.1398, low50: 0, high50: 0.0845 },
            { low80: 0.4495, high80: 1.384, low50: 0.1781, high50: 0.2857 },
            { low80: 0.4209, high80: 1.287, low50: 0.1777, high50: 0.419 },
            { low80: 0.05711, high80: 0.1909, low50: 0, high50: 0.1053 },
            { low80: 0.4237, high80: 1.364, low50: 0.1517, high50: 0.3272 },
            { low80: 0.8703, high80: 1.61, low50: 0.5, high50: 0.692 }
          ],
          drift600: 3.013,
          cases: 3426
        },
        {
          chance: { intercept: -2.606, recent: [0.001804, 0.0006492, 0.000195], quality: 0.7403, older: -0.3298, younger: 0.2674 },
          conditional: { intercept: 231.1, recent: [0.1841, 0.02114, 0.07628], quality: 47.86, older: 22.69, younger: 6.573 },
          usageSpread: { base: 62.64, slope: 0.5989 },
          usageTails: { low: 1.084, high: 1.728 },
          tails: [
            { low80: 0, high80: 0.3429, low50: 0, high50: 0.2579 },
            { low80: 0.01264, high80: 0.6838, low50: 0, high50: 0.4046 },
            { low80: 0.4957, high80: 1.297, low50: 0.1633, high50: 0.4443 },
            { low80: 0.005112, high80: 0.1621, low50: 0, high50: 0.1115 },
            { low80: 0.3698, high80: 1.167, low50: 0.1121, high50: 0.2806 },
            { low80: 0.3177, high80: 1.241, low50: 0.07563, high50: 0.4315 },
            { low80: 0, high80: 0.2236, low50: 0, high50: 0.1375 },
            { low80: 0.3495, high80: 1.158, low50: 0.07247, high50: 0.3236 },
            { low80: 0.7516, high80: 1.695, low50: 0.4614, high50: 0.5276 }
          ],
          drift600: 3.491,
          cases: 3429
        },
        {
          chance: { intercept: -3.143, recent: [0.002049, 0.0003622, 0.0002753], quality: 0.5512, older: -0.3298, younger: 0.3347 },
          conditional: { intercept: 239.4, recent: [0.1326, 0.07949, 0.02806], quality: 46.89, older: 26.56, younger: 9.014 },
          usageSpread: { base: 48.13, slope: 0.7075 },
          usageTails: { low: 1.014, high: 1.586 },
          tails: [
            { low80: 0, high80: 0.321, low50: 0, high50: 0.2671 },
            { low80: 0, high80: 0.7166, low50: 0, high50: 0.445 },
            { low80: 0.3858, high80: 1.318, low50: 0.08617, high50: 0.43 },
            { low80: 0, high80: 0.1829, low50: 0, high50: 0.1349 },
            { low80: 0.2548, high80: 0.9809, low50: 0.02063, high50: 0.3049 },
            { low80: 0.2447, high80: 1.061, low50: 0, high50: 0.3921 },
            { low80: 0, high80: 0.228, low50: 0, high50: 0.1558 },
            { low80: 0.2249, high80: 0.955, low50: 0, high50: 0.3418 },
            { low80: 0.6348, high80: 1.541, low50: 0.3344, high50: 0.6355 }
          ],
          drift600: 3.61,
          cases: 3131
        }
      ],
      usageCuts: [145.3, 448.2],
      priorWeight: 1,
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
          chance: { intercept: -2.516, recent: [0.0146, 0.001288, 0.0004653], quality: 1.452, older: -0.09515, younger: 0.1806 },
          conditional: { intercept: 51.01, recent: [0.4916, 0.02902, 0.04241], quality: 30.95, older: -0.7695, younger: 6.132 },
          usageSpread: { base: 31.02, slope: 0.3434 },
          usageTails: { low: 1.295, high: 1.629 },
          tails: [
            { low80: 0.01731, high80: 0.07137, low50: 0, high50: 0.0328 },
            { low80: 0.7383, high80: 0.7663, low50: 0.05505, high50: 0.1306 },
            { low80: 0.6592, high80: 0.9866, low50: 0.2163, high50: 0.2691 },
            { low80: 0.09935, high80: 0.0003159, low50: 0.0642, high50: 0 },
            { low80: 0.8657, high80: 0.8603, low50: 0.2688, high50: 0 },
            { low80: 0.9505, high80: 1.187, low50: 0.4935, high50: 0.4468 },
            { low80: 0.09953, high80: 0.008313, low50: 0.06286, high50: 0 },
            { low80: 0.9768, high80: 1.28, low50: 0.4856, high50: 0.6174 },
            { low80: 0.9951, high80: 1.172, low50: 0.5982, high50: 0.5796 }
          ],
          drift600: 1.164,
          cases: 9155
        },
        {
          chance: { intercept: -2.28, recent: [0.008856, 0.001333, 0.000631], quality: 1.493, older: -0.1077, younger: 0.1143 },
          conditional: { intercept: 83.25, recent: [0.3485, 0.06382, 0.01004], quality: 13.37, older: 0.2605, younger: 10.41 },
          usageSpread: { base: 30.97, slope: 0.5128 },
          usageTails: { low: 1.16, high: 1.637 },
          tails: [
            { low80: 0, high80: 0.1264, low50: 0, high50: 0.08237 },
            { low80: 0.5227, high80: 0.6777, low50: 0.006265, high50: 0.1892 },
            { low80: 0.2357, high80: 1.073, low50: 0, high50: 0.3047 },
            { low80: 0.05115, high80: 0.03491, low50: 0.02469, high50: 0.01737 },
            { low80: 0.5752, high80: 0.7973, low50: 0.173, high50: 0.009123 },
            { low80: 0.7119, high80: 1.109, low50: 0.3253, high50: 0.3877 },
            { low80: 0.05056, high80: 0.04648, low50: 0.02341, high50: 0.02213 },
            { low80: 0.6137, high80: 2.61, low50: 0.3791, high50: 0.7814 },
            { low80: 0.8758, high80: 1.217, low50: 0.5257, high50: 0.5739 }
          ],
          drift600: 1.888,
          cases: 8320
        },
        {
          chance: { intercept: -2.241, recent: [0.007198, 0.001188, 0.0002882], quality: 1.544, older: -0.152, younger: 0.09132 },
          conditional: { intercept: 98.91, recent: [0.3393, 0, 0], quality: 4.396, older: 1.835, younger: 11.78 },
          usageSpread: { base: 27.64, slope: 0.6177 },
          usageTails: { low: 1.066, high: 1.613 },
          tails: [
            { low80: 0, high80: 0.1531, low50: 0, high50: 0.1178 },
            { low80: 0.1492, high80: 0.3331, low50: 0, high50: 0.2258 },
            { low80: 0.3452, high80: 1.118, low50: 0, high50: 0.3348 },
            { low80: 0.005077, high80: 0.06988, low50: 0, high50: 0.05018 },
            { low80: 0.3646, high80: 0.5301, low50: 0.1059, high50: 0.05017 },
            { low80: 0.581, high80: 1.166, low50: 0.2157, high50: 0.2751 },
            { low80: 0.004233, high80: 0.08381, low50: 0, high50: 0.05567 },
            { low80: 1.083, high80: 2.983, low50: 0.2715, high50: 0.3938 },
            { low80: 0.7505, high80: 1.245, low50: 0.4347, high50: 0.4852 }
          ],
          drift600: 2.654,
          cases: 7458
        },
        {
          chance: { intercept: -2.299, recent: [0.006276, 0.0007622, 0.0003211], quality: 1.4, older: -0.2113, younger: 0.1063 },
          conditional: { intercept: 97.6, recent: [0.2873, 0.001936, 0], quality: 7.072, older: 6.313, younger: 14.79 },
          usageSpread: { base: 23.52, slope: 0.7333 },
          usageTails: { low: 0.9676, high: 1.599 },
          tails: [
            { low80: 0, high80: 0.1759, low50: 0, high50: 0.1471 },
            { low80: 0, high80: 0.3094, low50: 0, high50: 0.2353 },
            { low80: 0.08952, high80: 1.162, low50: 0, high50: 0.3677 },
            { low80: 0, high80: 0.09639, low50: 0, high50: 0.07723 },
            { low80: 0.2013, high80: 0.2363, low50: 0.04719, high50: 0.08537 },
            { low80: 0.3687, high80: 1.184, low50: 0.1004, high50: 0.2593 },
            { low80: 0, high80: 0.1134, low50: 0, high50: 0.08316 },
            { low80: 0.1849, high80: 3.934, low50: 0.1079, high50: 0.4621 },
            { low80: 0.5746, high80: 1.203, low50: 0.3139, high50: 0.3537 }
          ],
          drift600: 4.169,
          cases: 7485
        },
        {
          chance: { intercept: -2.596, recent: [0.005646, 0.0009626, 0.0002615], quality: 1.096, older: -0.2726, younger: 0.1627 },
          conditional: { intercept: 100.2, recent: [0.2216, 0, 0.04153], quality: 12.41, older: 11.3, younger: 14.86 },
          usageSpread: { base: 19.07, slope: 0.8453 },
          usageTails: { low: 0.8895, high: 1.404 },
          tails: [
            { low80: 0, high80: 0.1889, low50: 0, high50: 0.1627 },
            { low80: 0, high80: 0.3253, low50: 0, high50: 0.2549 },
            { low80: 0, high80: 0.496, low50: 0, high50: 0.3393 },
            { low80: 0, high80: 0.1165, low50: 0, high50: 0.09625 },
            { low80: 0.09053, high80: 0.2166, low50: 0, high50: 0.113 },
            { low80: 0.268, high80: 0.8973, low50: 0.022, high50: 0.2419 },
            { low80: 0, high80: 0.1298, low50: 0, high50: 0.1015 },
            { low80: 0.1591, high80: 1.973, low50: 0.06679, high50: 0.07553 },
            { low80: 0.4738, high80: 1.057, low50: 0.1977, high50: 0.1781 }
          ],
          drift600: 6.642,
          cases: 7526
        },
        {
          chance: { intercept: -2.937, recent: [0.005058, 0.001067, 0.0001571], quality: 0.9283, older: -0.318, younger: 0.2203 },
          conditional: { intercept: 111.8, recent: [0.1371, 0.02144, 0.03595], quality: 23.69, older: 17.16, younger: 14.61 },
          usageSpread: { base: 15.35, slope: 0.9529 },
          usageTails: { low: 0.8237, high: 1.089 },
          tails: [
            { low80: 0, high80: 0.2072, low50: 0, high50: 0.1876 },
            { low80: 0, high80: 0.3108, low50: 0, high50: 0.2593 },
            { low80: 0.009465, high80: 0.417, low50: 0, high50: 0.3366 },
            { low80: 0, high80: 0.1385, low50: 0, high50: 0.117 },
            { low80: 0.03083, high80: 0.2103, low50: 0, high50: 0.1351 },
            { low80: 0.1249, high80: 0.6664, low50: 0, high50: 0.248 },
            { low80: 0, high80: 0.1504, low50: 0, high50: 0.1234 },
            { low80: 0.08712, high80: 3.885, low50: 0, high50: 0.1019 },
            { low80: 0.3274, high80: 0.9605, low50: 0.08731, high50: 0.1644 }
          ],
          drift600: 8.222,
          cases: 7552
        },
        {
          chance: { intercept: -3.341, recent: [0.004559, 0.001131, 0.0001236], quality: 0.9857, older: -0.3578, younger: 0.2648 },
          conditional: { intercept: 125.7, recent: [0.0553, 0, 0.01417], quality: 19.35, older: 35.57, younger: 15.01 },
          usageSpread: { base: 11.87, slope: 1.038 },
          usageTails: { low: 0.7779, high: 0.3531 },
          tails: [
            { low80: 0, high80: 0.2243, low50: 0, high50: 0.2081 },
            { low80: 0, high80: 0.312, low50: 0, high50: 0.2681 },
            { low80: 0, high80: 0.4065, low50: 0, high50: 0.3538 },
            { low80: 0, high80: 0.1612, low50: 0, high50: 0.1414 },
            { low80: 0, high80: 0.2171, low50: 0, high50: 0.159 },
            { low80: 0.06987, high80: 0.4112, low50: 0, high50: 0.2573 },
            { low80: 0, high80: 0.1698, low50: 0, high50: 0.1457 },
            { low80: 0, high80: 0.2486, low50: 0, high50: 0.1811 },
            { low80: 0.2152, high80: 0.7936, low50: 0.02768, high50: 0.1644 }
          ],
          drift600: 9.561,
          cases: 6770
        }
      ],
      usageCuts: [22.49, 110.8],
      priorWeight: 1,
      qualityCuts: [0.2404, 1.318]
    }
  },
  aging: {
    firstAge: 19,
    hitter: [0.1829, 0.1829, 0.1829, 0.1012, 0.02353, -0.05008, -0.1196, -0.1851, -0.2466, -0.3039, -0.3573, -0.4065, -0.4517, -0.4929, -0.53, -0.563, -0.5919, -0.6168, -0.6377, -0.6545, -0.6545, -0.6545, -0.6545, -0.6545, -0.6545, -0.6545],
    pitcher: [0.1303, 0.1303, 0.1303, 0.1303, 0.06821, 0.008892, -0.04763, -0.1013, -0.1523, -0.2004, -0.2457, -0.2882, -0.328, -0.3649, -0.399, -0.4303, -0.4589, -0.4846, -0.5075, -0.5277, -0.545, -0.545, -0.545, -0.545, -0.545, -0.545]
  },
  usagePivotAge: 30,
  proneness: null
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
