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

/** Why a player without major-league results has no production yet: ratings come in phase 3b. */
export const PRODUCTION_PENDING_RATINGS = 'pending ratings-based projection (phase 3b)';

/** The fitting method's version: a stored fit made by another version is refitted, never reused. */
export const PRODUCTION_METHOD = 'production-3a.1';

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
  proneness: { bands: 3, evidence: 2, ageSplit: 30 },
} as const;

export const PRODUCTION_POLICY_CALIBRATION: CalibrationStamp = policy(
  'The coverage targets (80% and 50%), the era and hold-out rule, the adoption gate and its tolerance, the minimum samples, the prior\'s strength and widening, ' +
    'the two-way minimum, the starter share, the usage pivot age and the proneness banding and evidence rule are decisions about the method (D-053), not fits.'
);

/**
 * The fallback prior: the model used until the save has an adopted fit of its own, and the one
 * everything thin is shrunk toward. The only fitted artefact code may carry (D-053). It was fitted
 * by the same method on the real major-league history a historical save imports, so it describes
 * real-world stability and aging, not OOTP's engine and not this save: it is never presented as
 * the save's own calibration.
 */
export const PRODUCTION_PRIOR_CALIBRATION: CalibrationStamp = provisional(
  'Fallback prior, fitted by the production method (playerValueProductionFit.ts, no prior, no hold-out) on the real major-league history 2006–2025 ' +
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
          usage: {
            intercept: -13.22,
            recent: [0.6833, 0.08701, 0.06528],
            older: -4.399,
            younger: 15.88
          },
          usageSpread: {
            base: 50.57,
            slope: 0.2165
          },
          usageTails: {
            low: 1.528,
            high: 1.506
          },
          tails: [
            {
              low80: 0.3007,
              high80: 0.01057,
              low50: 0.04195,
              high50: 0
            },
            {
              low80: 0.7674,
              high80: 1.212,
              low50: 0.4612,
              high50: 0.1499
            },
            {
              low80: 1.029,
              high80: 1.485,
              low50: 0.5778,
              high50: 0.7382
            }
          ],
          drift600: 1.104,
          cases: 12070
        },
        {
          usage: {
            intercept: -25.31,
            recent: [0.569, 0.09119, 0.06171],
            older: -5.264,
            younger: 22.68
          },
          usageSpread: {
            base: 48.26,
            slope: 0.3337
          },
          usageTails: {
            low: 1.505,
            high: 1.41
          },
          tails: [
            {
              low80: 0.2108,
              high80: 0.01629,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.582,
              high80: 1.215,
              low50: 0.3485,
              high50: 0.191
            },
            {
              low80: 0.7823,
              high80: 1.529,
              low50: 0.4382,
              high50: 0.7929
            }
          ],
          drift600: 2.117,
          cases: 11140
        },
        {
          usage: {
            intercept: -35.11,
            recent: [0.4927, 0.07632, 0.04376],
            older: -4.266,
            younger: 26.56
          },
          usageSpread: {
            base: 41.09,
            slope: 0.4617
          },
          usageTails: {
            low: 1.408,
            high: 1.402
          },
          tails: [
            {
              low80: 0.1196,
              high80: 0.01694,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.455,
              high80: 1.035,
              low50: 0.2544,
              high50: 0.2042
            },
            {
              low80: 0.6017,
              high80: 1.552,
              low50: 0.3259,
              high50: 0.7806
            }
          ],
          drift600: 3.42,
          cases: 10190
        },
        {
          usage: {
            intercept: -44.12,
            recent: [0.4286, 0.05858, 0.0267],
            older: -2.602,
            younger: 28.05
          },
          usageSpread: {
            base: 30.71,
            slope: 0.6045
          },
          usageTails: {
            low: 1.274,
            high: 1.339
          },
          tails: [
            {
              low80: 0.04506,
              high80: 0.01418,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.3404,
              high80: 0.8665,
              low50: 0.1615,
              high50: 0.222
            },
            {
              low80: 0.467,
              high80: 1.56,
              low50: 0.2315,
              high50: 0.715
            }
          ],
          drift600: 4.395,
          cases: 10180
        },
        {
          usage: {
            intercept: -49.6,
            recent: [0.3589, 0.04166, 0.01589],
            older: -0.6333,
            younger: 28.73
          },
          usageSpread: {
            base: 22.55,
            slope: 0.7449
          },
          usageTails: {
            low: 1.135,
            high: 1.246
          },
          tails: [
            {
              low80: 0,
              high80: 0.03024,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.234,
              high80: 0.7001,
              low50: 0.07321,
              high50: 0.2449
            },
            {
              low80: 0.3274,
              high80: 1.408,
              low50: 0.1283,
              high50: 0.5789
            }
          ],
          drift600: 6.553,
          cases: 10180
        },
        {
          usage: {
            intercept: -54.32,
            recent: [0.2905, 0.0343, 0.008868],
            older: 1.412,
            younger: 28.44
          },
          usageSpread: {
            base: 14.12,
            slope: 0.8952
          },
          usageTails: {
            low: 1.011,
            high: 1.105
          },
          tails: [
            {
              low80: 0,
              high80: 0.02637,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.15,
              high80: 0.5919,
              low50: 0.00946,
              high50: 0.2631
            },
            {
              low80: 0.2243,
              high80: 1.24,
              low50: 0.05207,
              high50: 0.4385
            }
          ],
          drift600: 8.304,
          cases: 10180
        },
        {
          usage: {
            intercept: -53.61,
            recent: [0.2339, 0.02249, 0],
            older: 2.876,
            younger: 26.94
          },
          usageSpread: {
            base: 6.958,
            slope: 1.048
          },
          usageTails: {
            low: 0.9077,
            high: 0.9573
          },
          tails: [
            {
              low80: 0,
              high80: 0.01712,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.081,
              high80: 0.5165,
              low50: 0,
              high50: 0.2197
            },
            {
              low80: 0.1341,
              high80: 1.103,
              low50: 0,
              high50: 0.3526
            }
          ],
          drift600: 11.75,
          cases: 9261
        }
      ],
      usageCuts: [55.97, 233.2],
      priorWeight: 1
    },
    starter: {
      weights: [1, 0.5, 0.3],
      stabilization: 300,
      mean600: 1.294,
      noise600: 0.9058,
      rateScale600: 1.732,
      horizons: [
        {
          usage: {
            intercept: 18.16,
            recent: [0.6328, 0.0397, 0.0786],
            older: -7.982,
            younger: 14.92
          },
          usageSpread: {
            base: 109.3,
            slope: 0.2104
          },
          usageTails: {
            low: 1.517,
            high: 1.578
          },
          tails: [
            {
              low80: 0.4831,
              high80: 0.1834,
              low50: 0.1846,
              high50: 0
            },
            {
              low80: 0.8425,
              high80: 1.414,
              low50: 0.5101,
              high50: 0.4531
            },
            {
              low80: 1.029,
              high80: 1.398,
              low50: 0.5836,
              high50: 0.7375
            }
          ],
          drift600: 0.645,
          cases: 4112
        },
        {
          usage: {
            intercept: -2.93,
            recent: [0.4629, 0.06116, 0.1126],
            older: -10.84,
            younger: 23.48
          },
          usageSpread: {
            base: 98.91,
            slope: 0.3613
          },
          usageTails: {
            low: 1.398,
            high: 1.574
          },
          tails: [
            {
              low80: 0.3467,
              high80: 0.2327,
              low50: 0.167,
              high50: 0
            },
            {
              low80: 0.7003,
              high80: 1.572,
              low50: 0.3634,
              high50: 0.4418
            },
            {
              low80: 0.8615,
              high80: 1.329,
              low50: 0.4766,
              high50: 0.6971
            }
          ],
          drift600: 1.157,
          cases: 3772
        },
        {
          usage: {
            intercept: -19.78,
            recent: [0.3596, 0.07746, 0.09862],
            older: -10.99,
            younger: 28.56
          },
          usageSpread: {
            base: 83.93,
            slope: 0.4836
          },
          usageTails: {
            low: 1.289,
            high: 1.637
          },
          tails: [
            {
              low80: 0.2772,
              high80: 0.2473,
              low50: 0.1091,
              high50: 0.0224
            },
            {
              low80: 0.5363,
              high80: 1.444,
              low50: 0.24,
              high50: 0.4136
            },
            {
              low80: 0.7083,
              high80: 1.447,
              low50: 0.3649,
              high50: 0.6525
            }
          ],
          drift600: 1.846,
          cases: 3419
        },
        {
          usage: {
            intercept: -37.03,
            recent: [0.3087, 0.06372, 0.08637],
            older: -9.144,
            younger: 30.9
          },
          usageSpread: {
            base: 63.04,
            slope: 0.6113
          },
          usageTails: {
            low: 1.184,
            high: 1.626
          },
          tails: [
            {
              low80: 0.1966,
              high80: 0.1576,
              low50: 0.05009,
              high50: 0.03055
            },
            {
              low80: 0.4535,
              high80: 1.416,
              low50: 0.1848,
              high50: 0.4013
            },
            {
              low80: 0.573,
              high80: 1.35,
              low50: 0.2722,
              high50: 0.5594
            }
          ],
          drift600: 2.762,
          cases: 3427
        },
        {
          usage: {
            intercept: -46.06,
            recent: [0.261, 0.05473, 0.06327],
            older: -6.925,
            younger: 31.33
          },
          usageSpread: {
            base: 47.54,
            slope: 0.735
          },
          usageTails: {
            low: 1.072,
            high: 1.598
          },
          tails: [
            {
              low80: 0.1284,
              high80: 0.1602,
              low50: 0,
              high50: 0.0391
            },
            {
              low80: 0.3551,
              high80: 1.299,
              low50: 0.1038,
              high50: 0.3846
            },
            {
              low80: 0.4209,
              high80: 1.269,
              low50: 0.1615,
              high50: 0.4713
            }
          ],
          drift600: 3.811,
          cases: 3426
        },
        {
          usage: {
            intercept: -54.19,
            recent: [0.2168, 0.04307, 0.04836],
            older: -4.331,
            younger: 31.56
          },
          usageSpread: {
            base: 36.79,
            slope: 0.8431
          },
          usageTails: {
            low: 0.9842,
            high: 1.634
          },
          tails: [
            {
              low80: 0.05242,
              high80: 0.1893,
              low50: 0,
              high50: 0.03072
            },
            {
              low80: 0.2809,
              high80: 0.8691,
              low50: 0.04686,
              high50: 0.3758
            },
            {
              low80: 0.3266,
              high80: 1.246,
              low50: 0.08539,
              high50: 0.4866
            }
          ],
          drift600: 5.039,
          cases: 3429
        },
        {
          usage: {
            intercept: -59.59,
            recent: [0.1773, 0.03375, 0.02952],
            older: -1.37,
            younger: 31.47
          },
          usageSpread: {
            base: 25.36,
            slope: 0.9573
          },
          usageTails: {
            low: 0.9159,
            high: 1.582
          },
          tails: [
            {
              low80: 0,
              high80: 0.1866,
              low50: 0,
              high50: 0.01768
            },
            {
              low80: 0.1812,
              high80: 0.7665,
              low50: 0,
              high50: 0.3529
            },
            {
              low80: 0.2401,
              high80: 1.093,
              low50: 0.0162,
              high50: 0.4711
            }
          ],
          drift600: 6.121,
          cases: 3131
        }
      ],
      usageCuts: [162.4, 448.5],
      priorWeight: 1
    },
    reliever: {
      weights: [1, 0.5, 0.4],
      stabilization: 400,
      mean600: 0.8655,
      noise600: 0.8069,
      rateScale600: 1,
      horizons: [
        {
          usage: {
            intercept: -2.063,
            recent: [0.6706, 0.03166, 0.03457],
            older: -1.11,
            younger: 8.624
          },
          usageSpread: {
            base: 28.41,
            slope: 0.4055
          },
          usageTails: {
            low: 1.347,
            high: 1.521
          },
          tails: [
            {
              low80: 0.1168,
              high80: 0,
              low50: 0.03232,
              high50: 0
            },
            {
              low80: 0.8068,
              high80: 0.8689,
              low50: 0.2708,
              high50: 0.04753
            },
            {
              low80: 0.8779,
              high80: 1.233,
              low50: 0.4395,
              high50: 0.5356
            }
          ],
          drift600: 1.228,
          cases: 9155
        },
        {
          usage: {
            intercept: -6.336,
            recent: [0.4909, 0.05441, 0.02451],
            older: -1.158,
            younger: 11.76
          },
          usageSpread: {
            base: 23.7,
            slope: 0.642
          },
          usageTails: {
            low: 1.14,
            high: 1.387
          },
          tails: [
            {
              low80: 0.07263,
              high80: 0.0246,
              low50: 0.01436,
              high50: 0
            },
            {
              low80: 0.512,
              high80: 0.7819,
              low50: 0.1752,
              high50: 0.08323
            },
            {
              low80: 0.6742,
              high80: 1.159,
              low50: 0.2795,
              high50: 0.4387
            }
          ],
          drift600: 2.306,
          cases: 8320
        },
        {
          usage: {
            intercept: -8.076,
            recent: [0.4213, 0.01419, 0.009218],
            older: -0.9482,
            younger: 12.36
          },
          usageSpread: {
            base: 18.31,
            slope: 0.7978
          },
          usageTails: {
            low: 1.022,
            high: 1.38
          },
          tails: [
            {
              low80: 0.01978,
              high80: 0.03112,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.3348,
              high80: 0.5188,
              low50: 0.1081,
              high50: 0.1061
            },
            {
              low80: 0.4978,
              high80: 1.078,
              low50: 0.1747,
              high50: 0.3312
            }
          ],
          drift600: 4.013,
          cases: 7458
        },
        {
          usage: {
            intercept: -10.89,
            recent: [0.3329, 0.009745, 0.00402],
            older: -0.5818,
            younger: 12.76
          },
          usageSpread: {
            base: 12.28,
            slope: 0.9751
          },
          usageTails: {
            low: 0.9024,
            high: 1.35
          },
          tails: [
            {
              low80: 0,
              high80: 0.03285,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.1637,
              high80: 0.3231,
              low50: 0.0444,
              high50: 0.123
            },
            {
              low80: 0.3209,
              high80: 0.9253,
              low50: 0.07165,
              high50: 0.2817
            }
          ],
          drift600: 7.535,
          cases: 7485
        },
        {
          usage: {
            intercept: -13.1,
            recent: [0.2592, 0.0008212, 0.01857],
            older: -0.406,
            younger: 11.97
          },
          usageSpread: {
            base: 7.9,
            slope: 1.129
          },
          usageTails: {
            low: 0.8142,
            high: 1.279
          },
          tails: [
            {
              low80: 0,
              high80: 0.05722,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.08244,
              high80: 0.2982,
              low50: 0.001189,
              high50: 0.1413
            },
            {
              low80: 0.2237,
              high80: 0.7123,
              low50: 0.01203,
              high50: 0.2584
            }
          ],
          drift600: 11.72,
          cases: 7526
        },
        {
          usage: {
            intercept: -13.57,
            recent: [0.1869, 0.01723, 0.003565],
            older: 0.1551,
            younger: 11.52
          },
          usageSpread: {
            base: 4.612,
            slope: 1.276
          },
          usageTails: {
            low: 0.7456,
            high: 1.087
          },
          tails: [
            {
              low80: 0,
              high80: 0.08625,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.03934,
              high80: 0.2644,
              low50: 0,
              high50: 0.1249
            },
            {
              low80: 0.1136,
              high80: 0.5292,
              low50: 0,
              high50: 0.2283
            }
          ],
          drift600: 15.46,
          cases: 7552
        },
        {
          usage: {
            intercept: -12.11,
            recent: [0.1331, 0.001178, 0.004925],
            older: 0.5887,
            younger: 10.25
          },
          usageSpread: {
            base: 2.356,
            slope: 1.402
          },
          usageTails: {
            low: 0.6931,
            high: 0.4253
          },
          tails: [
            {
              low80: 0,
              high80: 0.1168,
              low50: 0,
              high50: 0
            },
            {
              low80: 0.001296,
              high80: 0.2549,
              low50: 0,
              high50: 0.1307
            },
            {
              low80: 0.05277,
              high80: 0.4083,
              low50: 0,
              high50: 0.2211
            }
          ],
          drift600: 17.89,
          cases: 6770
        }
      ],
      usageCuts: [30.61, 118.5],
      priorWeight: 1
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
