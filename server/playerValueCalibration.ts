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
 * What a pre-arbitration, arbitration or open season's cost says before it is priced. The control
 * timeline is composed first (`playerValueControl.ts`); the cost ladder (`playerValueCost.ts`) then
 * prices each such season from the league's measured renewal spread and arbitration ladder, the platform
 * seasons' production and the price of a win (phase 4a). A reading that never runs the ladder (a
 * timeline composed on its own) keeps this note: unknown, never the league minimum, never a point.
 */
export const COST_NOT_PRICED =
  "not priced in this reading: a controlled season is priced by the league's cost ladder (the renewal spread or the arbitration ladder), which was not run here";

/**
 * Why a reserve-clause renewal has no cost band. Under a reserve clause the club renews him at a
 * salary no rule ties to service or production, and one import cannot say what a renewal costs: that
 * needs renewals observed across imports (phase 4b). Unknown, never the minimum.
 */
export const COST_PENDING_OBSERVED_PAY =
  'Under a reserve clause the club renews him at a salary no rule ties to service or production; what a renewal costs is not measured from one export (renewals observed across imports, phase 4b), so it is unknown, never the minimum.';

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
 * What the opening price needs before a basis may rest on it (hardening, B-13). Below either minimum
 * the basis is not computed and says why; with fewer than two bases left the price is unknown, never
 * a point.
 *
 *   seasonShare  the least share of its schedule a season must cover before its WAR prices a
 *                season's salary: a quarter of the schedule. A season's WAR is scaled to the full
 *                schedule by the share it covered (a 60-game season under a 162-game schedule counts
 *                162/60 of its WAR), and a pace's noise grows as the share shrinks; below a quarter
 *                the scaled reading is more noise than price. It applies to a past season and to
 *                this season's pace alike.
 *   contracts    the fewest contracts one basis may rest on. A basis is a sum of salaries over a sum
 *                of WAR; one player's season WAR scatters by about a win around what he was paid
 *                for, so a basis on n contracts moves by roughly 0.6 ÷ √n of itself from that noise
 *                alone: about 13% at 20. Fewer, and one basis differs from another by who happens
 *                to be in it, not by what it measures.
 */
export const OPENING_PRICE_MINIMUMS = {
  seasonShare: 0.25,
  contracts: 20,
} as const;

export const OPENING_PRICE_MINIMUMS_CALIBRATION: CalibrationStamp = policy(
  'A basis of the opening price rests on at least a quarter of a season\'s schedule (a past season scaled to the full schedule by the share it covered, or this season\'s pace) ' +
    'and on at least 20 contracts; below either it is not computed, and with fewer than two bases the price is unknown (hardening, B-13). ' +
    'Chosen so a basis\'s own sampling noise stays well inside the spread between bases; a decision, not a fit.'
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
export const PRODUCTION_METHOD = 'production-3h.2';

/**
 * The method's policy (D-041, D-053): chosen, stated and changed by decision, never by fitting.
 *
 *   coverage       the bands' targets: an 80% outer and a 50% inner central interval.
 *   rateUnit       rates are stated in WAR per 600 opportunities (plate appearances or batters faced).
 *   window         the era rule: the most recent 20 completed seasons of the save's own history; a season
 *                  whose schedule is under 90% of its neighbours' (the three seasons either side) is short
 *                  and skipped (the 2020 season on a real-history save). Each fit weights a season by
 *                  0.5^(its age in seasons / recencyHalfLife), 2 seasons (null: unweighted), with the prior's
 *                  pseudo-cases scaled by the mean weight. `holdoutShare` is the ratings fit's hold-out.
 *   rolling        the backtest (owner's option C, 2026-09-23): every completed season from the window's start
 *                  + 5 to the season before the last is an origin, at most 8 of them (evenly spaced, the first
 *                  and the last always in); each is scored by the method fitted through it, a horizon only where
 *                  that fit has the gate's minimum cases from at least 3 origin cohorts. The model served is the
 *                  method refit through the last completed season: what is measured is what is served.
 *   gate           a fit is adopted only if, at every horizon, its held-out coverage AS FITTED (never after a
 *                  widening chosen on the same cases) is within 5 points of each target pooled and within 10
 *                  points in every subgroup (kind, usage third, quality tier, age band) with at least 200
 *                  held-out cases, and its central is unbiased there: a subgroup fails when the mean of actual
 *                  minus central is more than 10% of the mean absolute outcome, more than 0.05 wins a
 *                  player-season, and more than three standard errors (clustered by player and by origin)
 *                  from zero: material, and not noise. Horizon 1 must be evaluable. `tolerance` is the
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
  window: { maxSeasons: 20, minShareOfSchedule: 0.9, holdoutShare: 0.45, neighbourSeasons: 3, recencyHalfLife: 2 as number | null },
  rolling: { firstOriginAfter: 5, maxOrigins: 8, minimumOrigins: 3 },
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
  'The coverage targets (80% and 50%), the era rule, the rolling origins and the recency half-life (the owner\'s option C, 2026-09-23), the adoption gate (coverage within 5 points pooled and 10 in every subgroup, ' +
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
export const RATINGS_METHOD = 'ratings-3h.3';

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
 *                  levels are those the league's own affiliates play at, below the majors; where the export
 *                  names parents, the lines of another market league's farm or of an independent league are
 *                  left out (a league the export no longer lists, a defunct affiliate, is kept: not known to be
 *                  another's), and reaching any top-level league is arriving (hardening F4, D-07).
 *                  A player called up in his origin season stays in the later seasons' cases, kept apart
 *                  (hardening F4, C-01): the export dates no past call-up, so a player not yet called up at
 *                  share f of his season is read as one of those called up later in theirs in proportion to
 *                  the season still to play (1 − f, a call-up taken as equally likely at any point of the
 *                  season's games), and the band reaches none and all of them still to come.
 *                  A prospect's chance and his playing time when he plays move with his projected quality by
 *                  the results fit's own effect of quality at the same usage (the chance's logistic and the
 *                  playing time's coefficient; hardening F4, C-02), located so that the players of his
 *                  level and age now (`populationNodes` of them sampled per cell and season) together keep
 *                  the cell's measured chance and playing time.
 *   backtest       the arrival model is judged the way the results fit is (the owner's option C, applied to
 *                  arrivals 2026-09-23, hardening F5): every completed season Y from the window's start + 5 to
 *                  the season before the last whose next season is in the window is an origin, at most 8 of
 *                  them (evenly spaced, the first and the last always in: the results fit's own rule, shared);
 *                  each is scored by the method fitted through Y, projecting season Y + 1's minor leaguers,
 *                  a horizon only where that fit has the gate's minimum cases on the side from at least 3
 *                  origin cohorts. Each fit weights a case by 0.5^(the seasons from its target season to the
 *                  fit's last / recencyHalfLife), 2 seasons (null: unweighted), in its chance, playing time,
 *                  nodes and call-up share; an age band is still sized on the cases themselves, and the
 *                  arrival fit has no prior's pseudo-cases to rescale. The model served is the method refit
 *                  through the last completed season.
 *   gate           the arrival chance and its expected playing time, per horizon with the production gate's
 *                  minimum cases, fail on a miss beyond the absolute tolerance (10 points), and, since
 *                  hardening F4 (B-15), on a bias beyond 10% of what happened AND beyond three standard
 *                  errors (the production gate's rule): material, and not noise. A tightening only: every fit
 *                  the absolute rule failed still fails. Since hardening F5 the standard errors are clustered
 *                  by player and by origin (two-way, as the results gate's), the same player-season scored
 *                  under several origins; the tolerances are unchanged.
 *   adoption       the arrival model is adopted horizon by horizon (the owner's option (b), 2026-09-23, hardening
 *                  F6): the horizons served are a contiguous run from horizon 0 (the rest of this season) through
 *                  the last horizon k whose held-out check, and the check of every horizon before it, passed the
 *                  gate above. A horizon after one that failed or could not be checked (fewer than the gate's
 *                  minimum cases) is never served, even where its own check passes. Nothing is adopted unless
 *                  horizon `requiredThrough` (1, the next season) is in the run, and the ratings mapping's own gate
 *                  must still pass. Every tolerance is unchanged. A prospect's seasons after k are not established,
 *                  each on its own with the gate's finding at that horizon: never extrapolated, carried forward
 *                  or averaged. `rule` names the rule.
 *   longitudinal  the development path and the arrival rate conditioned on potential are fitted only
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
 *                  arithmetic), never a midpoint. In the blend with results (hardening F4, A-15) the band
 *                  reaches the projection re-read with the grade at five stations across that range (its
 *                  ends, quarters and middle).
 */
export const RATINGS_POLICY = {
  mapping: { minimumOpportunities: 200, folds: 5, positionMinimum: 15, priorStrength: 150 },
  arrival: { bandCases: 60, nodes: 10, minimumArrivals: 10, populationNodes: 20 },
  backtest: { origins: PRODUCTION_POLICY.rolling, recencyHalfLife: 2 as number | null },
  gate: { arrivalBias: { relative: 0.1, standardErrors: 3 } },
  adoption: { rule: 'contiguous_prefix' as const, requiredThrough: 1 },
  longitudinal: { minimumPairs: 300, pairDays: { from: 300, to: 430 }, minimumGap: 2, bandPairs: 30, minimumLinked: 300, evidence: 2, potentialTiers: 3 },
  development: { priorRangeHigh: 2, ages: { first: 16, last: 40 } },
  unknownGrade: { low: 20, high: 80, stations: [0, 0.25, 0.5, 0.75, 1] },
} as const;

export const RATINGS_POLICY_CALIBRATION: CalibrationStamp = policy(
  'The same-time mapping\'s sample rule, folds, position minimum and prior strength; the arrival age-band size, nodes and arrival minimum; ' +
    'the arrival population (the league\'s own affiliates; any top-level league is arriving), the origin season\'s call-ups kept in the later ' +
    'seasons\' cases and read in proportion to the season still to play, and the quality effect located on 20 of the cell\'s players now ' +
    '(hardening F4, 2026-09-23); the arrival backtest\'s rolling origins (the results fit\'s rule) and its recency half-life of two seasons ' +
    '(the owner\'s option C applied to arrivals, 2026-09-23, hardening F5); the arrival gate\'s bias rule (10% of what happened and three ' +
    'standard errors clustered by player and by origin, beside the absolute 10 points; a tightening, D-053); the arrival model\'s ' +
    'adoption horizon by horizon, a contiguous run of passing horizons from the rest of this season that must reach the next season ' +
    '(the owner\'s option (b), 2026-09-23, hardening F6; the gate not loosened); the longitudinal pair rule and the minimum pairs before the save\'s own development path replaces ' +
    'the prior; the prior\'s development range; an unknown grade\'s scale ends and, in the blend, its five stations across them (hardening F4). ' +
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

export const PRODUCTION_PRIOR_SOURCE_CALIBRATION: CalibrationStamp = provisional(
  'The season totals (plate appearances and WAR across every major-league batting line) of the real history 2006–2025 the fallback prior ' +
    'was fitted on, read from the Arizona historical save (export of 2026-05-16, league 203) with `npm run calibrate production -- --prior`. ' +
    'A fingerprint only: a save whose held-out seasons match it within half a percent fits without the prior (B-09). Never a parameter of any projection.'
);

export const PRODUCTION_PRIOR: ProductionModel = {
  method: "production-3h.2",
  kinds: {
    hitter: {
      weights: [1, 0.5, 0.5],
      stabilization: 400,
      mean600: 2.169,
      noise600: 1.294,
      rateScale600: 2.426,
      horizons: [
        {
          chance: {
            intercept: -2.012,
            recent: [1.925, 0.1788, 0],
            quality: 0.1966,
            older: -0.2735,
            younger: 0.3029
          },
          conditional: {
            intercept: -0.2233,
            recent: [0.4882, 0.1062, 0.09926],
            quality: 0.2972,
            older: -0.01922,
            younger: 0.09955
          },
          playSpread: {
            base: 0.6611,
            slope: 0.03586
          },
          usageZ: [-2.823, -2.206, -1.804, -1.493, -1.155, -0.8502, -0.4337, -0.01388, 0.4173, 0.8389, 1.187, 1.658, 2.067, 2.51, 3.191],
          survivor: {
            intercept: -0.7595,
            slope: 0.9048,
            older: -0.0962,
            younger: 0.09947,
            usage: 0.2535
          },
          tails: [
            [-1.078, -1.015, -0.7722, -0.6862, -0.5002, -0.3322, -0.2006, -0.05581, 0.2127, 0.5481, 0.7662, 1.415, 1.661, 2.068, 3.631],
            [-1.205, -0.9735, -0.8116, -0.6858, -0.5263, -0.4308, -0.3121, -0.1793, -0.02163, 0.2807, 0.7201, 1.465, 1.873, 2.443, 3.141],
            [-1.262, -1.022, -0.8963, -0.7973, -0.664, -0.5693, -0.3225, -0.1523, 0.144, 0.6629, 0.9863, 1.36, 1.795, 2.024, 2.69],
            [-1.117, -0.9244, -0.7623, -0.639, -0.4846, -0.3955, -0.3005, -0.1955, -0.05074, 0.156, 0.394, 0.9519, 1.572, 2.228, 3.111],
            [-1.271, -1.083, -0.9757, -0.8377, -0.7111, -0.6024, -0.4634, -0.3116, -0.05933, 0.3535, 0.7805, 1.384, 1.887, 2.43, 3.461],
            [-1.631, -1.451, -1.28, -1.129, -0.9175, -0.6953, -0.4021, -0.07125, 0.2743, 0.6503, 1.026, 1.449, 1.832, 2.292, 3.143],
            [-1.115, -0.9263, -0.7679, -0.6494, -0.4906, -0.3914, -0.2809, -0.1734, -0.01592, 0.2337, 0.5355, 1.111, 1.622, 2.242, 3.203],
            [-1.276, -1.081, -0.9523, -0.8274, -0.6948, -0.5752, -0.4382, -0.2789, -0.04897, 0.352, 0.7835, 1.42, 1.899, 2.463, 3.416],
            [-2.205, -1.859, -1.52, -1.298, -1.004, -0.6792, -0.3595, -0.006262, 0.4094, 0.7811, 1.106, 1.435, 1.798, 2.241, 2.707],
            [-1.528, -1.037, -0.848, -0.7477, -0.5375, -0.4363, -0.2862, -0.112, 0.2281, 0.7396, 1.16, 1.557, 1.874, 2.311, 3.071],
            [-1.509, -1.273, -1.122, -0.9794, -0.8098, -0.6946, -0.5292, -0.3056, 0.02706, 0.4791, 0.8846, 1.476, 1.921, 2.496, 3.102],
            [-2.206, -1.735, -1.475, -1.262, -1.02, -0.7598, -0.3716, -0.005073, 0.4361, 0.8248, 1.138, 1.392, 1.806, 2.461, 3.05]
          ],
          drift600: 1.121,
          cases: 11350,
          origins: 13,
          priorWeight: 0,
          driftYoung600: 1.268
        },
        {
          chance: {
            intercept: -2.366,
            recent: [1.266, 0.08028, 0.1011],
            quality: 0.3146,
            older: -0.3174,
            younger: 0.321
          },
          conditional: {
            intercept: -0.002986,
            recent: [0.3554, 0.1476, 0.08491],
            quality: 0.3154,
            older: -0.02343,
            younger: 0.1091
          },
          playSpread: {
            base: 0.7865,
            slope: 0.02546
          },
          usageZ: [-2.68, -2.161, -1.833, -1.526, -1.176, -0.8411, -0.4201, 0.01527, 0.4616, 0.9088, 1.252, 1.627, 1.972, 2.411, 2.95],
          survivor: {
            intercept: -0.4408,
            slope: 0.8025,
            older: -0.1051,
            younger: 0.1271,
            usage: 0.2062
          },
          tails: [
            [-0.9501, -0.8549, -0.7183, -0.6141, -0.4867, -0.3507, -0.2046, -0.1165, 0.07639, 0.3375, 0.5232, 1.001, 1.406, 2.022, 3.108],
            [-1.313, -1.018, -0.8596, -0.7624, -0.6385, -0.52, -0.3813, -0.2438, -0.02206, 0.3769, 0.6627, 1.001, 1.375, 2.357, 2.732],
            [-1.162, -1.078, -0.9857, -0.9394, -0.8236, -0.6817, -0.5401, -0.3112, -0.03391, 0.4374, 0.9639, 1.452, 2.242, 2.771, 3.212],
            [-1.132, -0.8271, -0.6647, -0.5774, -0.5077, -0.4007, -0.2776, -0.1799, -0.06108, 0.1474, 0.487, 1.072, 1.577, 2.135, 2.899],
            [-1.238, -1.064, -0.9354, -0.8269, -0.7112, -0.6118, -0.4677, -0.3088, -0.02412, 0.4057, 0.8756, 1.416, 1.912, 2.681, 3.625],
            [-1.571, -1.383, -1.182, -1.061, -0.9014, -0.7236, -0.4548, -0.131, 0.2249, 0.6741, 0.9988, 1.453, 1.809, 2.212, 2.966],
            [-1.14, -0.8468, -0.6851, -0.5857, -0.5022, -0.3959, -0.2696, -0.1529, -0.03461, 0.243, 0.5227, 1.076, 1.573, 2.14, 3.129],
            [-1.242, -1.069, -0.9359, -0.821, -0.7034, -0.6046, -0.4593, -0.2921, -0.02196, 0.408, 0.8166, 1.348, 1.863, 2.63, 3.544],
            [-2.018, -1.689, -1.426, -1.218, -0.8888, -0.613, -0.3064, 0.04564, 0.3977, 0.7865, 1.096, 1.414, 1.807, 2.292, 2.662],
            [-1.442, -1.012, -0.9684, -0.8239, -0.7167, -0.5568, -0.4293, -0.0863, 0.3612, 0.7454, 0.9809, 1.401, 2.304, 2.843, 4.242],
            [-1.413, -1.259, -1.124, -1.013, -0.8393, -0.7305, -0.5416, -0.2761, 0.0952, 0.5962, 1.008, 1.516, 1.885, 2.375, 3.155],
            [-1.831, -1.627, -1.387, -1.141, -0.9035, -0.6642, -0.2963, 0.01465, 0.4476, 0.7745, 1.038, 1.38, 1.821, 2.089, 2.638]
          ],
          drift600: 1.795,
          cases: 10430,
          origins: 12,
          priorWeight: 0,
          driftYoung600: 2.088
        },
        {
          chance: {
            intercept: -2.382,
            recent: [0.8066, 0.2004, 0],
            quality: 0.6468,
            older: -0.3322,
            younger: 0.2287
          },
          conditional: {
            intercept: 0.4535,
            recent: [0.3033, 0.06174, 0.07081],
            quality: 0.3377,
            older: -0.008285,
            younger: 0.07718
          },
          playSpread: {
            base: 0.8956,
            slope: 0.002103
          },
          usageZ: [-2.523, -2.114, -1.831, -1.584, -1.205, -0.8863, -0.4526, 0.03727, 0.4976, 0.9426, 1.255, 1.616, 1.869, 2.161, 2.625],
          survivor: {
            intercept: -0.4951,
            slope: 0.8566,
            older: -0.091,
            younger: 0.1611,
            usage: 0.1106
          },
          tails: [
            [-0.7619, -0.6434, -0.5649, -0.4639, -0.378, -0.3003, -0.2479, -0.1795, -0.08397, 0.08258, 0.3859, 0.9502, 1.503, 2.239, 2.601],
            [-1.021, -0.9577, -0.7549, -0.6871, -0.5903, -0.4691, -0.3377, -0.199, -0.006255, 0.2007, 0.6705, 1.082, 1.605, 2.223, 2.768],
            [-1.174, -1.058, -0.8644, -0.8228, -0.737, -0.6103, -0.4339, -0.2496, 0.03153, 0.4991, 1.011, 1.476, 1.729, 2.11, 2.613],
            [-1.096, -0.8543, -0.6862, -0.5706, -0.4896, -0.395, -0.2893, -0.2078, -0.07512, 0.2381, 0.6586, 1.426, 1.854, 2.565, 3.3],
            [-1.19, -1.088, -0.9993, -0.9121, -0.7806, -0.6586, -0.5118, -0.306, -0.03965, 0.368, 0.7754, 1.336, 1.753, 2.323, 3.248],
            [-1.458, -1.295, -1.189, -1.042, -0.8821, -0.7131, -0.4471, -0.108, 0.2468, 0.6723, 1.061, 1.478, 1.891, 2.342, 2.991],
            [-1.026, -0.8102, -0.6624, -0.5631, -0.461, -0.3777, -0.277, -0.2056, -0.07628, 0.1895, 0.5734, 1.332, 1.852, 2.543, 3.205],
            [-1.187, -1.079, -0.9864, -0.9022, -0.7521, -0.6399, -0.4819, -0.2882, -0.03576, 0.36, 0.7218, 1.303, 1.747, 2.32, 3.224],
            [-1.823, -1.588, -1.416, -1.235, -0.9732, -0.7208, -0.3778, -0.0409, 0.2836, 0.6942, 1.05, 1.41, 1.692, 2.174, 2.59],
            [-1.069, -1.03, -0.8962, -0.8234, -0.7019, -0.602, -0.4147, -0.16, 0.2491, 0.6158, 0.9747, 1.316, 2.016, 2.641, 3.052],
            [-1.418, -1.242, -1.124, -1.037, -0.9052, -0.7594, -0.5552, -0.2681, 0.212, 0.6353, 1.044, 1.502, 1.969, 2.382, 3.223],
            [-1.894, -1.725, -1.434, -1.211, -1.026, -0.8093, -0.3403, -0.04527, 0.3538, 0.7997, 1.207, 1.415, 1.635, 2.224, 2.307]
          ],
          drift600: 2.111,
          cases: 9476,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 2.707
        },
        {
          chance: {
            intercept: -2.469,
            recent: [0.7728, 0.07084, 0],
            quality: 0.8711,
            older: -0.3831,
            younger: 0.1716
          },
          conditional: {
            intercept: 0.6475,
            recent: [0.222, 0.1011, 0.04264],
            quality: 0.3841,
            older: -0.005618,
            younger: 0.06405
          },
          playSpread: {
            base: 0.9247,
            slope: 8.389e-05
          },
          usageZ: [-2.445, -2.111, -1.855, -1.528, -1.216, -0.8809, -0.4085, 0.05599, 0.5059, 0.9765, 1.283, 1.616, 1.882, 2.152, 2.551],
          survivor: {
            intercept: -0.6545,
            slope: 0.8119,
            older: -0.08491,
            younger: 0.197,
            usage: 0.08023
          },
          tails: [
            [-1.035, -0.7509, -0.6368, -0.5337, -0.441, -0.3494, -0.254, -0.1833, -0.06807, 0.2927, 0.5942, 1.069, 1.46, 2.246, 2.82],
            [-0.938, -0.8628, -0.8013, -0.7173, -0.4911, -0.3916, -0.288, -0.1712, -0.007174, 0.2061, 0.4779, 0.9552, 1.299, 1.852, 2.696],
            [-1.564, -1.052, -0.872, -0.7741, -0.6489, -0.5623, -0.389, -0.192, 0.1349, 1.154, 1.392, 2.045, 2.413, 3.436, 4.048],
            [-0.846, -0.7546, -0.644, -0.566, -0.4615, -0.3892, -0.2705, -0.1868, 0.1015, 0.324, 0.8549, 1.166, 1.519, 2.598, 2.841],
            [-1.347, -1.19, -1.018, -0.9054, -0.7868, -0.6606, -0.5048, -0.3113, 0.001475, 0.4435, 0.8701, 1.437, 1.784, 2.577, 3.325],
            [-1.444, -1.291, -1.138, -1.003, -0.8673, -0.6719, -0.3976, -0.05402, 0.3422, 0.7639, 1.13, 1.63, 2.053, 2.582, 3.287],
            [-1.035, -0.7509, -0.6368, -0.5337, -0.441, -0.3494, -0.254, -0.1833, -0.06807, 0.2927, 0.5942, 1.069, 1.46, 2.246, 2.82],
            [-1.344, -1.186, -1.003, -0.8954, -0.7658, -0.6346, -0.4641, -0.2724, -0.001194, 0.3948, 0.81, 1.339, 1.775, 2.51, 3.227],
            [-1.804, -1.534, -1.378, -1.185, -0.9638, -0.7466, -0.4221, -0.06754, 0.2968, 0.6797, 1.081, 1.601, 1.896, 2.301, 2.816],
            [-1.226, -0.9561, -0.868, -0.7854, -0.6333, -0.4564, -0.2489, -0.08935, 0.289, 0.8966, 1.194, 2.208, 2.748, 3.505, 3.857],
            [-1.487, -1.333, -1.223, -1.087, -0.9385, -0.8101, -0.5867, -0.2778, 0.1983, 0.7196, 1.123, 1.639, 2.087, 2.535, 3.174],
            [-1.806, -1.675, -1.403, -1.21, -0.9558, -0.7493, -0.4965, -0.1299, 0.2175, 0.5979, 1.03, 1.616, 1.852, 2.156, 2.323]
          ],
          drift600: 1.968,
          cases: 9471,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 1.865
        },
        {
          chance: {
            intercept: -2.667,
            recent: [0.5932, 0.1337, 0],
            quality: 0.9806,
            older: -0.4439,
            younger: 0.1896
          },
          conditional: {
            intercept: 0.7423,
            recent: [0.2254, 0.06367, 0.06485],
            quality: 0.2642,
            older: 0.000144,
            younger: 0.1027
          },
          playSpread: {
            base: 0.9612,
            slope: 0
          },
          usageZ: [-2.434, -2.063, -1.795, -1.558, -1.208, -0.9216, -0.4396, 0.05237, 0.5425, 0.9468, 1.274, 1.608, 1.813, 2.071, 2.456],
          survivor: {
            intercept: -0.8301,
            slope: 0.8321,
            older: -0.1055,
            younger: 0.2243,
            usage: 0.04186
          },
          tails: [
            [-0.8421, -0.7598, -0.6984, -0.6087, -0.4519, -0.3365, -0.23, -0.1525, -0.008141, 0.403, 0.727, 1.155, 1.734, 2.014, 2.396],
            [-0.9468, -0.7427, -0.5215, -0.4235, -0.3601, -0.3001, -0.2141, -0.1413, 0.0641, 0.4266, 0.7647, 1.248, 1.586, 1.976, 2.35],
            [-1.17, -1.072, -0.8117, -0.7503, -0.5512, -0.3868, -0.2735, -0.12, 0.2838, 0.6341, 1.118, 1.701, 2.278, 2.629, 2.999],
            [-0.8632, -0.7976, -0.7062, -0.5981, -0.4259, -0.3356, -0.234, -0.1231, 0.1265, 0.4894, 0.9376, 1.203, 1.838, 2.067, 2.664],
            [-1.3, -1.107, -0.9751, -0.8449, -0.7326, -0.6316, -0.47, -0.2545, 0.01258, 0.4097, 0.8858, 1.303, 1.774, 2.448, 3.396],
            [-1.372, -1.188, -1.055, -0.9376, -0.7946, -0.6431, -0.412, -0.06847, 0.2684, 0.6824, 1.017, 1.493, 1.837, 2.272, 2.884],
            [-0.8421, -0.7598, -0.6984, -0.6087, -0.4519, -0.3365, -0.23, -0.1525, -0.008141, 0.403, 0.727, 1.155, 1.734, 2.014, 2.396],
            [-1.28, -1.089, -0.9508, -0.833, -0.7156, -0.5966, -0.4169, -0.2162, 0.02804, 0.4175, 0.8775, 1.301, 1.77, 2.308, 2.921],
            [-1.725, -1.478, -1.298, -1.15, -0.9136, -0.7108, -0.3691, 0.007664, 0.2883, 0.6821, 0.9785, 1.425, 1.827, 2.43, 3.107],
            [-1.09, -1.014, -0.8744, -0.7649, -0.5469, -0.4173, -0.2628, -0.1578, 0.41, 1.021, 1.497, 2.176, 2.352, 2.658, 2.878],
            [-1.378, -1.259, -1.12, -1.011, -0.8649, -0.7425, -0.5325, -0.2219, 0.177, 0.6191, 1.044, 1.469, 1.72, 2.178, 2.792],
            [-1.783, -1.653, -1.384, -1.253, -1.003, -0.7347, -0.3773, 0.0694, 0.3803, 0.7443, 0.9795, 1.295, 1.821, 1.951, 2.515]
          ],
          drift600: 2.82,
          cases: 9470,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 2.894
        },
        {
          chance: {
            intercept: -3.11,
            recent: [0.5806, 0.1097, 0],
            quality: 0.8843,
            older: -0.4799,
            younger: 0.2694
          },
          conditional: {
            intercept: 0.7693,
            recent: [0.1698, 0.1173, 0.04884],
            quality: 0.3266,
            older: -0.02686,
            younger: 0.1025
          },
          playSpread: {
            base: 0.9752,
            slope: 0
          },
          usageZ: [-2.358, -2.01, -1.804, -1.558, -1.226, -0.8764, -0.4058, 0.0816, 0.5285, 0.9695, 1.303, 1.622, 1.873, 2.147, 2.501],
          survivor: {
            intercept: -0.9304,
            slope: 0.8245,
            older: -0.1915,
            younger: 0.241,
            usage: 0.02208
          },
          tails: [
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.119, -1.014, -0.7208, -0.6586, -0.5803, -0.4579, -0.3365, -0.1977, 0.0641, 0.2766, 0.4723, 0.7193, 1.162, 1.777, 2.219],
            [-1.061, -1, -0.9335, -0.8289, -0.6852, -0.449, -0.2812, -0.1096, 0.1117, 0.5693, 0.9907, 1.286, 1.577, 1.832, 2.276],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.371, -1.143, -1.019, -0.8902, -0.7401, -0.6309, -0.4718, -0.2664, 0.004897, 0.4279, 0.8336, 1.525, 2.052, 2.534, 3.542],
            [-1.469, -1.248, -1.089, -0.9684, -0.8128, -0.6414, -0.4166, -0.07213, 0.2991, 0.6677, 1.008, 1.523, 1.945, 2.562, 3.144],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.328, -1.134, -1.017, -0.8711, -0.7194, -0.6057, -0.4489, -0.2557, 0.02026, 0.3893, 0.7581, 1.405, 1.984, 2.516, 3.354],
            [-1.785, -1.595, -1.33, -1.181, -0.9517, -0.7342, -0.428, -0.09438, 0.2855, 0.6573, 0.9658, 1.395, 1.7, 2.271, 3.202],
            [-1.088, -1.01, -0.9564, -0.8241, -0.7089, -0.5919, -0.4108, -0.2015, 0.07116, 0.5521, 0.7646, 1.414, 1.828, 2.18, 2.553],
            [-1.583, -1.319, -1.165, -1.06, -0.8737, -0.7193, -0.4774, -0.1469, 0.3157, 0.7214, 1.138, 1.546, 1.891, 2.401, 3.113],
            [-1.932, -1.759, -1.625, -1.238, -0.9896, -0.6761, -0.2999, -0.1347, 0.2619, 0.5513, 0.9199, 1.098, 1.48, 2.038, 2.972]
          ],
          drift600: 2.549,
          cases: 9475,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 2.246
        },
        {
          chance: {
            intercept: -3.695,
            recent: [0.5508, 0.1263, 0],
            quality: 0.7911,
            older: -0.4874,
            younger: 0.3571
          },
          conditional: {
            intercept: 0.7922,
            recent: [0.2042, 0.05145, 0.05883],
            quality: 0.3129,
            older: -0.04206,
            younger: 0.1193
          },
          playSpread: {
            base: 0.9768,
            slope: 0
          },
          usageZ: [-2.42, -2.073, -1.818, -1.552, -1.228, -0.9025, -0.3898, 0.08171, 0.5446, 0.9535, 1.283, 1.599, 1.84, 2.128, 2.403],
          survivor: {
            intercept: -0.9993,
            slope: 0.7593,
            older: -0.1678,
            younger: 0.2639,
            usage: 0.04199
          },
          tails: [
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.316, -1.139, -0.9344, -0.8132, -0.5853, -0.431, -0.3243, -0.1493, 0.1178, 0.6124, 0.9457, 1.506, 1.694, 1.806, 2.333],
            [-1.684, -1.37, -1.211, -1.074, -0.8789, -0.7217, -0.4349, -0.1085, 0.2644, 0.6096, 0.9315, 1.39, 1.84, 2.359, 3.292],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.265, -1.13, -0.9541, -0.8751, -0.7538, -0.6427, -0.5039, -0.2251, 0.05866, 0.4224, 0.8687, 1.394, 1.802, 2.733, 3.557],
            [-1.46, -1.253, -1.093, -0.9838, -0.8585, -0.7125, -0.4228, -0.1332, 0.2553, 0.5866, 0.8776, 1.382, 1.76, 2.324, 3.054],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.297, -1.138, -0.9847, -0.8767, -0.7461, -0.6312, -0.4762, -0.2171, 0.05977, 0.4339, 0.8693, 1.414, 1.791, 2.668, 3.493],
            [-1.891, -1.613, -1.334, -1.197, -0.9817, -0.7337, -0.4565, -0.05663, 0.301, 0.6428, 1.053, 1.454, 1.943, 2.381, 3.413],
            [-1.434, -1.25, -1.127, -1.033, -0.9101, -0.7748, -0.5691, -0.2632, 0.2973, 0.6351, 1.001, 1.573, 1.762, 2.089, 2.592],
            [-1.472, -1.251, -1.12, -1.042, -0.8968, -0.754, -0.5122, -0.1225, 0.2961, 0.6768, 1.025, 1.479, 1.817, 2.451, 2.935],
            [-1.973, -1.872, -1.643, -1.46, -1.161, -0.8547, -0.3454, -0.03147, 0.3485, 0.5962, 0.8064, 1.056, 1.258, 1.516, 2.555]
          ],
          drift600: 2.562,
          cases: 8615,
          origins: 10,
          priorWeight: 0,
          driftYoung600: 2.206
        }
      ],
      usageCuts: [0.235, 1.519],
      ceiling: 4.765,
      observedSpread600: 1.812,
      priorWeight: 0,
      qualityCuts: [1.308, 3.146]
    },
    starter: {
      weights: [1, 0.4, 0.2],
      stabilization: 300,
      mean600: 1.279,
      noise600: 0.8544,
      rateScale600: 1.697,
      horizons: [
        {
          chance: {
            intercept: -1.283,
            recent: [0.7495, 0.09189, 0.03336],
            quality: 0.5371,
            older: -0.1113,
            younger: 0.1708
          },
          conditional: {
            intercept: 0.7643,
            recent: [0.3753, 0.04418, 0.09336],
            quality: 0.3752,
            older: -0.02795,
            younger: 0.02233
          },
          playSpread: {
            base: 1.12,
            slope: 0.02272
          },
          usageZ: [-2.487, -2.02, -1.713, -1.418, -1.093, -0.8098, -0.3628, 0.1669, 0.6469, 1.02, 1.312, 1.594, 1.898, 2.221, 2.571],
          survivor: {
            intercept: -0.5261,
            slope: 0.9808,
            older: -0.02907,
            younger: 0.08384,
            usage: 0.1094
          },
          tails: [
            [-1.199, -1.081, -0.7986, -0.6207, -0.356, -0.2089, -0.1029, -0.02169, 0.08067, 0.3217, 0.4865, 1.152, 1.219, 1.461, 2.641],
            [-1.067, -0.7605, -0.7181, -0.5612, -0.4193, -0.2933, -0.1458, 0.001141, 0.2551, 0.4712, 0.8019, 1.301, 1.582, 1.827, 2.387],
            [-1.968, -1.713, -1.421, -1.225, -0.9725, -0.764, -0.4297, -0.09195, 0.2974, 0.6595, 0.9042, 1.318, 1.706, 2.055, 2.757],
            [-1.206, -1.06, -0.8498, -0.7305, -0.6178, -0.5138, -0.3756, -0.2661, -0.1323, 0.06845, 0.3909, 0.9511, 1.504, 1.996, 2.646],
            [-1.56, -1.296, -1.09, -0.9195, -0.7571, -0.6316, -0.4176, -0.2565, 0.003245, 0.4498, 0.7765, 1.245, 1.56, 2.022, 2.848],
            [-1.828, -1.51, -1.341, -1.127, -0.9366, -0.7545, -0.4278, -0.1015, 0.2765, 0.6254, 0.8762, 1.264, 1.573, 1.958, 2.531],
            [-1.21, -1.08, -0.843, -0.7239, -0.5893, -0.4787, -0.3375, -0.2062, -0.06895, 0.1301, 0.4535, 1.043, 1.487, 1.927, 2.669],
            [-1.591, -1.279, -1.088, -0.8915, -0.7292, -0.5927, -0.3904, -0.1993, 0.04259, 0.4618, 0.8091, 1.255, 1.587, 2.052, 2.797],
            [-2.404, -1.882, -1.769, -1.425, -1.139, -0.8611, -0.4579, -0.06319, 0.4167, 0.7511, 1.052, 1.439, 1.896, 2.277, 2.78],
            [-1.23, -0.8802, -0.7373, -0.5806, -0.3813, -0.2904, -0.1534, -0.02972, 0.1531, 0.4309, 0.8277, 1.152, 1.456, 1.755, 2.48],
            [-1.385, -1.17, -1.074, -0.9366, -0.7976, -0.6464, -0.4174, -0.2203, 0.04026, 0.4909, 0.8203, 1.201, 1.54, 1.796, 2.57],
            [-2.276, -2.043, -1.639, -1.118, -0.9564, -0.6232, -0.1508, 0.08023, 0.5973, 0.9315, 1.236, 1.618, 2.07, 2.346, 2.911]
          ],
          drift600: 0.5933,
          cases: 4112,
          origins: 13,
          priorWeight: 0,
          driftYoung600: 1.118
        },
        {
          chance: {
            intercept: -1.653,
            recent: [0.5064, 0.04085, 0.1307],
            quality: 0.9008,
            older: -0.1792,
            younger: 0.1613
          },
          conditional: {
            intercept: 0.9903,
            recent: [0.2766, 0.02484, 0.1026],
            quality: 0.3801,
            older: -0.002157,
            younger: 0.02942
          },
          playSpread: {
            base: 1.29,
            slope: 0.01176
          },
          usageZ: [-2.27, -1.915, -1.666, -1.408, -1.097, -0.8452, -0.3793, 0.1248, 0.6817, 1.049, 1.342, 1.619, 1.852, 2.151, 2.451],
          survivor: {
            intercept: -0.2313,
            slope: 0.7937,
            older: -0.05263,
            younger: 0.1079,
            usage: 0.09223
          },
          tails: [
            [-1.219, -1.061, -0.9337, -0.7836, -0.6253, -0.5274, -0.3986, -0.2821, -0.04777, 0.2269, 0.6259, 1.107, 1.745, 2.308, 2.873],
            [-1.142, -0.9702, -0.8721, -0.5914, -0.4668, -0.352, -0.2188, -0.06244, 0.1749, 0.4731, 0.6853, 1.147, 1.493, 1.756, 2.451],
            [-1.867, -1.608, -1.38, -1.186, -1.016, -0.8052, -0.5361, -0.1623, 0.2018, 0.6003, 0.8783, 1.322, 1.653, 2.116, 2.569],
            [-1.205, -1.074, -0.9313, -0.8132, -0.6301, -0.5388, -0.4133, -0.2921, -0.09229, 0.2148, 0.6341, 1.151, 1.744, 2.247, 2.757],
            [-1.517, -1.27, -1.115, -0.9505, -0.8082, -0.6683, -0.4766, -0.2689, 0.06188, 0.4917, 0.9179, 1.447, 2.036, 2.383, 3.229],
            [-1.749, -1.468, -1.286, -1.171, -0.9922, -0.8101, -0.554, -0.2357, 0.06432, 0.5148, 0.8273, 1.197, 1.526, 1.973, 2.571],
            [-1.219, -1.061, -0.9337, -0.7836, -0.6253, -0.5274, -0.3986, -0.2821, -0.04777, 0.2269, 0.6259, 1.107, 1.745, 2.308, 2.873],
            [-1.477, -1.255, -1.078, -0.9142, -0.7635, -0.6284, -0.4154, -0.2219, 0.07923, 0.495, 0.8828, 1.415, 1.934, 2.367, 3.224],
            [-2.051, -1.796, -1.615, -1.361, -1.073, -0.778, -0.4657, 0.03996, 0.4849, 0.7792, 1.081, 1.624, 2.026, 2.34, 2.558],
            [-1.064, -0.9695, -0.9146, -0.7561, -0.6224, -0.4867, -0.3123, -0.1487, 0.06152, 0.4573, 0.8198, 1.158, 1.593, 2.066, 2.674],
            [-1.488, -1.293, -1.208, -1.066, -0.8472, -0.7177, -0.5065, -0.2671, 0.1208, 0.528, 0.8968, 1.415, 1.889, 2.257, 2.95],
            [-1.761, -1.463, -1.343, -1.223, -0.9249, -0.5873, -0.263, 0.2122, 0.5744, 0.8829, 1.353, 1.669, 2.189, 2.348, 2.526]
          ],
          drift600: 1.001,
          cases: 3772,
          origins: 12,
          priorWeight: 0,
          driftYoung600: 0.9139
        },
        {
          chance: {
            intercept: -1.89,
            recent: [0.3711, 0.1257, 0.09031],
            quality: 0.8637,
            older: -0.2571,
            younger: 0.164
          },
          conditional: {
            intercept: 1.07,
            recent: [0.171, 0.06191, 0.1156],
            quality: 0.3073,
            older: 0.1174,
            younger: 0.07248
          },
          playSpread: {
            base: 1.334,
            slope: 0.0204
          },
          usageZ: [-2.149, -1.876, -1.593, -1.409, -1.166, -0.8591, -0.4492, 0.07687, 0.6607, 1.087, 1.308, 1.599, 1.793, 2.01, 2.409],
          survivor: {
            intercept: 0.1701,
            slope: 0.7561,
            older: -0.01337,
            younger: 0.07324,
            usage: -0.02545
          },
          tails: [
            [-1.259, -1.001, -0.8728, -0.7602, -0.5986, -0.5204, -0.4113, -0.2504, -0.02207, 0.3356, 0.9853, 1.531, 1.976, 2.386, 2.951],
            [-1.163, -1.014, -0.9357, -0.7267, -0.4842, -0.3646, -0.3166, -0.1439, 0.0788, 0.4815, 0.668, 1.001, 1.664, 2.474, 3.638],
            [-1.587, -1.36, -1.217, -1.056, -0.8532, -0.6992, -0.4602, -0.1791, 0.2392, 0.5629, 0.8677, 1.377, 1.679, 2.178, 2.786],
            [-1.276, -1.092, -0.8877, -0.7624, -0.6488, -0.5437, -0.4616, -0.3214, -0.02714, 0.3434, 0.9727, 1.371, 1.948, 2.391, 2.979],
            [-1.375, -1.164, -0.9705, -0.8781, -0.7276, -0.5768, -0.4224, -0.2293, 0.1029, 0.4676, 0.7918, 1.215, 1.677, 2.318, 3.013],
            [-1.511, -1.231, -1.111, -0.9517, -0.8104, -0.6664, -0.4782, -0.2447, 0.1147, 0.4854, 0.7648, 1.163, 1.523, 1.978, 2.663],
            [-1.259, -1.001, -0.8728, -0.7602, -0.5986, -0.5204, -0.4113, -0.2504, -0.02207, 0.3356, 0.9853, 1.531, 1.976, 2.386, 2.951],
            [-1.439, -1.127, -0.9815, -0.8878, -0.7256, -0.576, -0.4023, -0.2237, 0.09706, 0.4684, 0.7869, 1.208, 1.713, 2.397, 3.048],
            [-1.714, -1.548, -1.39, -1.25, -1.055, -0.7894, -0.4651, 0.06029, 0.4291, 0.8134, 1.229, 1.604, 1.965, 2.367, 2.823],
            [-1.025, -0.993, -0.9531, -0.8037, -0.5198, -0.3973, -0.3099, -0.2078, -0.001621, 0.4627, 0.7685, 1.635, 1.949, 2.585, 3.463],
            [-1.412, -1.169, -1.005, -0.8908, -0.7561, -0.6192, -0.455, -0.233, 0.1724, 0.5069, 0.9178, 1.356, 1.657, 2.133, 2.841],
            [-1.546, -1.469, -1.193, -1.165, -0.8688, -0.6785, -0.1482, 0.2783, 0.8177, 1.124, 1.281, 1.542, 1.656, 1.899, 2.172]
          ],
          drift600: 1.55,
          cases: 3419,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 1.556
        },
        {
          chance: {
            intercept: -2.18,
            recent: [0.3349, 0.1651, 0.05244],
            quality: 0.9521,
            older: -0.2667,
            younger: 0.1794
          },
          conditional: {
            intercept: 1.389,
            recent: [0.1555, 0.08063, 0.0531],
            quality: 0.2391,
            older: 0.1439,
            younger: 0.03376
          },
          playSpread: {
            base: 1.135,
            slope: 0.09534
          },
          usageZ: [-2.047, -1.785, -1.599, -1.416, -1.17, -0.9044, -0.4778, 0.002027, 0.6251, 1.126, 1.331, 1.602, 1.838, 2.063, 2.355],
          survivor: {
            intercept: 0.4146,
            slope: 0.6143,
            older: -0.09552,
            younger: 0.04146,
            usage: -0.01094
          },
          tails: [
            [-1.257, -1.093, -0.9516, -0.769, -0.6994, -0.5783, -0.4752, -0.359, -0.1311, 0.1506, 0.4128, 0.8462, 1.41, 1.743, 1.985],
            [-0.9229, -0.7998, -0.6301, -0.5159, -0.406, -0.3454, -0.2399, 0.03198, 0.2348, 0.5418, 1.038, 1.628, 1.74, 1.924, 4.016],
            [-1.523, -1.334, -1.156, -1.039, -0.8966, -0.7021, -0.4716, -0.2291, 0.1543, 0.5759, 0.9175, 1.51, 1.879, 2.282, 2.753],
            [-1.34, -1.1, -0.9977, -0.8204, -0.7345, -0.6344, -0.5168, -0.3843, -0.2404, 0.1011, 0.3924, 0.815, 1.41, 1.596, 2.082],
            [-1.336, -1.153, -0.9892, -0.8587, -0.7331, -0.5943, -0.4266, -0.1997, 0.07788, 0.5152, 0.9567, 1.408, 1.757, 2.426, 3.322],
            [-1.392, -1.19, -1.059, -0.9761, -0.831, -0.68, -0.4656, -0.26, 0.09257, 0.4355, 0.7685, 1.279, 1.646, 2.177, 2.782],
            [-1.257, -1.093, -0.9516, -0.769, -0.6994, -0.5783, -0.4752, -0.359, -0.1311, 0.1506, 0.4128, 0.8462, 1.41, 1.743, 1.985],
            [-1.447, -1.144, -0.9891, -0.8427, -0.7172, -0.5714, -0.4027, -0.1813, 0.08818, 0.5402, 0.983, 1.417, 1.753, 2.444, 3.367],
            [-1.683, -1.498, -1.344, -1.211, -1.021, -0.8381, -0.4837, -0.1351, 0.3396, 0.7961, 1.271, 1.796, 2.09, 2.525, 2.677],
            [-0.9528, -0.8209, -0.7665, -0.5597, -0.4078, -0.3256, -0.1022, 0.08451, 0.3882, 0.6878, 1.096, 1.723, 1.753, 1.835, 2.669],
            [-1.197, -1.08, -0.9551, -0.8811, -0.7454, -0.5948, -0.4153, -0.169, 0.1073, 0.5448, 1, 1.475, 1.782, 2.448, 2.894],
            [-1.709, -1.413, -1.244, -1.06, -0.8121, -0.5777, -0.3197, 0.4411, 0.8674, 1.439, 1.719, 2.284, 2.565, 2.614, 2.744]
          ],
          drift600: 1.616,
          cases: 3427,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 1.994
        },
        {
          chance: {
            intercept: -2.232,
            recent: [0.3455, 0.08195, 0.05889],
            quality: 0.838,
            older: -0.281,
            younger: 0.1924
          },
          conditional: {
            intercept: 1.668,
            recent: [0.1423, 0.05737, 0.02215],
            quality: 0.276,
            older: 0.01738,
            younger: -0.008755
          },
          playSpread: {
            base: 1.022,
            slope: 0.1437
          },
          usageZ: [-1.905, -1.706, -1.53, -1.409, -1.182, -0.9096, -0.5129, -0.01096, 0.614, 1.086, 1.337, 1.626, 1.813, 2.067, 2.327],
          survivor: {
            intercept: 0.4086,
            slope: 0.5158,
            older: -0.1439,
            younger: 0.03872,
            usage: 0.02257
          },
          tails: [
            [-1.407, -1.09, -0.8266, -0.713, -0.6017, -0.5277, -0.3965, -0.2871, -0.09451, 0.1442, 0.4326, 0.8395, 1.714, 1.922, 2.78],
            [-1.004, -0.9371, -0.8005, -0.6881, -0.4956, -0.4357, -0.3461, -0.1346, 0.2079, 0.5481, 0.8835, 1.683, 2.105, 2.206, 2.371],
            [-1.585, -1.311, -1.127, -0.9984, -0.8345, -0.7033, -0.5023, -0.2035, 0.1168, 0.5864, 0.9876, 1.479, 1.951, 2.563, 2.989],
            [-1.474, -1.164, -0.8207, -0.7096, -0.5975, -0.5087, -0.4219, -0.2949, -0.09064, 0.1332, 0.301, 0.8505, 1.708, 1.9, 2.652],
            [-1.519, -1.172, -0.9344, -0.8131, -0.6808, -0.5862, -0.447, -0.2633, 0.04816, 0.4309, 0.8895, 1.451, 1.828, 2.368, 3.488],
            [-1.303, -1.16, -1.027, -0.9394, -0.7974, -0.6819, -0.5033, -0.2288, 0.07444, 0.4707, 0.8283, 1.257, 1.689, 2.448, 2.973],
            [-1.407, -1.09, -0.8266, -0.713, -0.6017, -0.5277, -0.3965, -0.2871, -0.09451, 0.1442, 0.4326, 0.8395, 1.714, 1.922, 2.78],
            [-1.497, -1.113, -0.9315, -0.8059, -0.6666, -0.5697, -0.4172, -0.2347, 0.06895, 0.4794, 0.9028, 1.451, 1.831, 2.317, 3.435],
            [-1.691, -1.5, -1.336, -1.138, -0.9689, -0.7636, -0.4919, -0.163, 0.2247, 0.79, 1.343, 1.871, 2.153, 2.576, 2.908],
            [-1.016, -0.9489, -0.9249, -0.6987, -0.5182, -0.4197, -0.336, -0.1916, 0.1626, 0.5972, 0.8936, 1.788, 2.069, 2.297, 3.18],
            [-1.268, -1.118, -0.9846, -0.8623, -0.7357, -0.5914, -0.4143, -0.2277, 0.1318, 0.5907, 1.082, 1.511, 1.901, 2.446, 3.371],
            [-1.473, -1.363, -1.137, -1.038, -0.7851, -0.5998, -0.2845, 0.07489, 0.7941, 1.153, 1.694, 2.241, 2.495, 2.776, 3.154]
          ],
          drift600: 1.61,
          cases: 3426,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 2.13
        },
        {
          chance: {
            intercept: -2.35,
            recent: [0.2896, 0.1281, 0.01047],
            quality: 0.8889,
            older: -0.2919,
            younger: 0.1846
          },
          conditional: {
            intercept: 1.505,
            recent: [0.1929, 0, 0.0878],
            quality: 0.1668,
            older: -0.02849,
            younger: 0.02627
          },
          playSpread: {
            base: 1.264,
            slope: 0.04532
          },
          usageZ: [-1.971, -1.717, -1.58, -1.424, -1.163, -0.9173, -0.5351, -0.0901, 0.5793, 1.117, 1.366, 1.594, 1.783, 2.028, 2.306],
          survivor: {
            intercept: 0.6695,
            slope: 0.4445,
            older: -0.1754,
            younger: 0.02985,
            usage: -0.02237
          },
          tails: [
            [-1.295, -0.9989, -0.8737, -0.7378, -0.6226, -0.5601, -0.4183, -0.2448, -0.07913, 0.1652, 0.5268, 0.7137, 1.392, 1.886, 2.152],
            [-1.506, -1.154, -0.9761, -0.8769, -0.7417, -0.6411, -0.4562, -0.2671, 0.007774, 0.4319, 0.889, 1.481, 1.892, 2.573, 3.565],
            [-1.597, -1.33, -1.177, -1.063, -0.9048, -0.7659, -0.5208, -0.1994, 0.1276, 0.5681, 0.999, 1.492, 2.039, 2.662, 3.097],
            [-1.372, -1.047, -0.907, -0.7957, -0.6686, -0.6028, -0.5222, -0.3393, -0.1087, 0.07853, 0.578, 0.6826, 1.323, 1.988, 2.26],
            [-1.595, -1.18, -0.9959, -0.9098, -0.7561, -0.6579, -0.5164, -0.3021, -0.03392, 0.3907, 0.8024, 1.42, 1.833, 2.439, 3.635],
            [-1.466, -1.273, -1.1, -1.009, -0.8644, -0.6967, -0.5142, -0.2239, 0.09203, 0.4907, 0.9188, 1.371, 1.928, 2.577, 3.042],
            [-1.295, -0.9989, -0.8737, -0.7378, -0.6226, -0.5601, -0.4183, -0.2448, -0.07913, 0.1652, 0.5268, 0.7137, 1.392, 1.886, 2.152],
            [-1.506, -1.154, -0.9761, -0.8769, -0.7417, -0.6411, -0.4562, -0.2671, 0.007774, 0.4319, 0.889, 1.481, 1.892, 2.573, 3.565],
            [-1.73, -1.556, -1.241, -1.139, -0.976, -0.8436, -0.5498, -0.1318, 0.2231, 0.6785, 1.243, 1.716, 2.422, 2.731, 3.276],
            [-1.597, -1.33, -1.177, -1.063, -0.9048, -0.7659, -0.5208, -0.1994, 0.1276, 0.5681, 0.999, 1.492, 2.039, 2.662, 3.097],
            [-1.581, -1.202, -1.074, -0.9491, -0.7808, -0.6601, -0.4486, -0.2379, 0.1733, 0.5315, 1.003, 1.619, 1.987, 2.644, 3.578],
            [-1.598, -1.576, -1.497, -1.201, -1.081, -0.8674, -0.4496, -0.1335, 0.4665, 1.151, 1.71, 2.466, 2.658, 3.358, 3.922]
          ],
          drift600: 1.402,
          cases: 3429,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 1.698
        },
        {
          chance: {
            intercept: -2.867,
            recent: [0.3757, 0.02446, 0.03119],
            quality: 0.5825,
            older: -0.2809,
            younger: 0.2728
          },
          conditional: {
            intercept: 1.617,
            recent: [0.1041, 0.08667, 0.0187],
            quality: 0.1577,
            older: 0.01309,
            younger: 0.04863
          },
          playSpread: {
            base: 1.322,
            slope: 0.01486
          },
          usageZ: [-1.916, -1.787, -1.635, -1.473, -1.205, -0.9047, -0.5438, -0.1412, 0.5371, 1.118, 1.372, 1.605, 1.783, 1.951, 2.149],
          survivor: {
            intercept: 0.7016,
            slope: 0.3946,
            older: -0.1615,
            younger: 0.05167,
            usage: -0.03891
          },
          tails: [
            [-1.171, -1.068, -0.9472, -0.8572, -0.7431, -0.6308, -0.4906, -0.37, -0.02585, 0.4098, 0.7168, 1.041, 1.371, 1.64, 1.808],
            [-1.475, -1.171, -1.025, -0.9277, -0.7472, -0.6509, -0.4967, -0.2751, -0.05351, 0.2812, 0.7511, 1.48, 1.884, 2.337, 3.104],
            [-1.692, -1.394, -1.239, -1.018, -0.8878, -0.7403, -0.5338, -0.2714, 0.1146, 0.5521, 0.8929, 1.492, 2.218, 2.735, 3.285],
            [-1.1, -1.021, -0.9306, -0.8496, -0.7475, -0.6368, -0.5011, -0.3726, -0.0337, 0.2486, 0.785, 1.23, 1.418, 1.672, 1.816],
            [-1.378, -1.167, -1.03, -0.9525, -0.8023, -0.6892, -0.5466, -0.3209, -0.1072, 0.2355, 0.6266, 1.362, 1.845, 2.346, 3.152],
            [-1.599, -1.32, -1.179, -0.9552, -0.8368, -0.7166, -0.5448, -0.3139, -0.009749, 0.3535, 0.8209, 1.424, 2.139, 2.843, 3.294],
            [-1.171, -1.068, -0.9472, -0.8572, -0.7431, -0.6308, -0.4906, -0.37, -0.02585, 0.4098, 0.7168, 1.041, 1.371, 1.64, 1.808],
            [-1.475, -1.171, -1.025, -0.9277, -0.7472, -0.6509, -0.4967, -0.2751, -0.05351, 0.2812, 0.7511, 1.48, 1.884, 2.337, 3.104],
            [-1.697, -1.496, -1.271, -1.117, -0.9625, -0.7937, -0.4897, -0.03497, 0.4363, 0.7413, 1.046, 1.611, 2.329, 2.724, 2.908],
            [-1.692, -1.394, -1.239, -1.018, -0.8878, -0.7403, -0.5338, -0.2714, 0.1146, 0.5521, 0.8929, 1.492, 2.218, 2.735, 3.285],
            [-1.361, -1.213, -1.057, -0.9678, -0.8532, -0.7092, -0.5306, -0.2858, -0.02586, 0.4212, 0.7746, 1.445, 2.06, 2.551, 3.272],
            [-1.697, -1.496, -1.271, -1.117, -0.9625, -0.7937, -0.4897, -0.03497, 0.4363, 0.7413, 1.046, 1.611, 2.329, 2.724, 2.908]
          ],
          drift600: 1.475,
          cases: 3131,
          origins: 10,
          priorWeight: 0,
          driftYoung600: 1.549
        }
      ],
      usageCuts: [0.9602, 2.645],
      ceiling: 6.315,
      observedSpread600: 1.398,
      priorWeight: 0,
      qualityCuts: [0.4374, 2.339]
    },
    reliever: {
      weights: [1, 0.7, 0.6],
      stabilization: 500,
      mean600: 0.7776,
      noise600: 0.8458,
      rateScale600: 0.9045,
      horizons: [
        {
          chance: {
            intercept: -2.124,
            recent: [2.057, 0.2952, 0.005162],
            quality: 1.476,
            older: -0.1059,
            younger: 0.1372
          },
          conditional: {
            intercept: 0.3714,
            recent: [0.4733, 0.005015, 0.02767],
            quality: 0.2078,
            older: -0.003988,
            younger: 0.02388
          },
          playSpread: {
            base: 0.3522,
            slope: 0.1707
          },
          usageZ: [-2.172, -1.878, -1.675, -1.462, -1.19, -0.9216, -0.4986, -0.04618, 0.2981, 0.6631, 1.026, 1.64, 2.188, 3.131, 5.058],
          survivor: {
            intercept: -0.3227,
            slope: 0.9315,
            older: -0.009948,
            younger: 0.05271,
            usage: 0.1402
          },
          tails: [
            [-1.904, -1.53, -1.285, -0.9653, -0.7798, -0.5815, -0.3262, -0.1807, 0.03194, 0.2969, 0.5841, 1.029, 1.304, 2.13, 3.243],
            [-1.727, -1.42, -0.9268, -0.7471, -0.5818, -0.4415, -0.1885, -0.02905, 0.1262, 0.4254, 0.7536, 1.186, 1.415, 1.619, 2.399],
            [-1.61, -1.082, -0.8658, -0.7678, -0.5626, -0.3971, -0.2192, -0.09492, 0.05873, 0.3366, 0.6551, 1.021, 1.251, 1.868, 2.978],
            [-1.922, -1.597, -1.297, -1.007, -0.7946, -0.6509, -0.3945, -0.2096, -0.02058, 0.2965, 0.5754, 1.052, 1.292, 2.029, 2.935],
            [-1.938, -1.532, -1.231, -0.9831, -0.7378, -0.5837, -0.4015, -0.2277, -0.00697, 0.267, 0.6297, 1.137, 1.55, 2.222, 3.331],
            [-1.729, -1.45, -1.189, -0.9809, -0.7746, -0.5566, -0.3447, -0.1131, 0.1543, 0.4938, 0.8113, 1.177, 1.524, 1.971, 3.048],
            [-1.904, -1.53, -1.285, -0.9653, -0.7798, -0.5815, -0.3262, -0.1807, 0.03194, 0.2969, 0.5841, 1.029, 1.304, 2.13, 3.243],
            [-1.742, -1.185, -1.131, -1.073, -0.8212, -0.687, -0.4673, -0.1977, 0.08054, 0.308, 0.6838, 1.064, 2.007, 2.603, 4.316],
            [-1.658, -1.455, -1.23, -1.053, -0.7695, -0.5413, -0.3017, -0.01766, 0.2793, 0.6322, 0.8558, 1.168, 1.51, 1.938, 2.8],
            [-1.61, -1.082, -0.8658, -0.7678, -0.5626, -0.3971, -0.2192, -0.09492, 0.05873, 0.3366, 0.6551, 1.021, 1.251, 1.868, 2.978],
            [-1.617, -1.267, -1.049, -0.8957, -0.6895, -0.5439, -0.3844, -0.195, 0.04865, 0.4801, 0.8428, 1.376, 1.882, 2.515, 3.516],
            [-1.41, -1.252, -1.055, -0.8065, -0.6854, -0.5407, -0.3551, -0.0004741, 0.3379, 0.6507, 0.9224, 1.367, 1.734, 2.361, 2.859]
          ],
          drift600: 1.008,
          cases: 9159,
          origins: 13,
          priorWeight: 0,
          driftYoung600: 1.574
        },
        {
          chance: {
            intercept: -1.964,
            recent: [1.39, 0.1814, 0.08056],
            quality: 1.591,
            older: -0.1102,
            younger: 0.06276
          },
          conditional: {
            intercept: 0.5238,
            recent: [0.2176, 0.1269, 0.03218],
            quality: 0.2003,
            older: -0.008187,
            younger: 0.03946
          },
          playSpread: {
            base: 0.3655,
            slope: 0.2342
          },
          usageZ: [-1.877, -1.692, -1.544, -1.4, -1.192, -0.9227, -0.4407, -0.006109, 0.3551, 0.6995, 0.9909, 1.451, 2.128, 3.857, 5.737],
          survivor: {
            intercept: -0.1725,
            slope: 0.7744,
            older: 0.02352,
            younger: 0.0875,
            usage: 0.06107
          },
          tails: [
            [-1.854, -1.697, -1.322, -0.9956, -0.723, -0.4951, -0.3033, -0.1539, 0.03754, 0.3488, 0.8, 1.226, 1.547, 2.332, 3.217],
            [-1.287, -1.06, -0.8975, -0.7142, -0.5518, -0.4057, -0.257, -0.1287, 0.09371, 0.3839, 0.7265, 1.334, 1.863, 2.595, 4.203],
            [-1.451, -0.7802, -0.758, -0.6694, -0.5165, -0.3463, -0.234, -0.06728, 0.2836, 0.6697, 0.9672, 1.3, 1.594, 3.235, 4.331],
            [-1.773, -1.577, -1.174, -0.9743, -0.6894, -0.4936, -0.3096, -0.1539, 0.048, 0.4866, 0.8603, 1.255, 1.489, 2.039, 3.409],
            [-1.799, -1.379, -1.113, -0.8948, -0.698, -0.561, -0.3905, -0.2093, 0.0003253, 0.346, 0.6977, 1.114, 1.556, 1.968, 3.251],
            [-1.758, -1.426, -1.174, -0.984, -0.7528, -0.5764, -0.3652, -0.1634, 0.1109, 0.478, 0.7622, 1.159, 1.591, 2.205, 3.263],
            [-1.854, -1.697, -1.322, -0.9956, -0.723, -0.4951, -0.3033, -0.1539, 0.03754, 0.3488, 0.8, 1.226, 1.547, 2.332, 3.217],
            [-1.739, -1.325, -1.077, -0.889, -0.6915, -0.5544, -0.3782, -0.192, 0.0209, 0.3733, 0.7158, 1.191, 1.582, 2.045, 3.865],
            [-1.788, -1.56, -1.292, -1.099, -0.8439, -0.6277, -0.4011, -0.1407, 0.2049, 0.5475, 0.9015, 1.239, 1.555, 1.922, 2.839],
            [-1.451, -0.7802, -0.758, -0.6694, -0.5165, -0.3463, -0.234, -0.06728, 0.2836, 0.6697, 0.9672, 1.3, 1.594, 3.235, 4.331],
            [-1.318, -1.002, -0.8377, -0.7387, -0.5436, -0.4475, -0.3158, -0.1744, 0.04191, 0.3733, 0.6824, 1.281, 1.819, 2.82, 3.96],
            [-1.012, -0.7972, -0.7156, -0.6101, -0.4942, -0.3729, -0.1467, -0.04182, 0.2886, 0.5294, 0.8119, 1.361, 1.856, 1.992, 2.531]
          ],
          drift600: 0.9044,
          cases: 8323,
          origins: 12,
          priorWeight: 0,
          driftYoung600: 4.63
        },
        {
          chance: {
            intercept: -2.104,
            recent: [1.149, 0.155, 0.09243],
            quality: 1.214,
            older: -0.1822,
            younger: 0.1212
          },
          conditional: {
            intercept: 0.5472,
            recent: [0.3514, 0, 0],
            quality: 0.01128,
            older: 0.005678,
            younger: 0.06792
          },
          playSpread: {
            base: 0.2695,
            slope: 0.3292
          },
          usageZ: [-1.811, -1.685, -1.564, -1.436, -1.194, -0.9088, -0.3998, 0.02239, 0.3719, 0.6962, 0.9811, 1.487, 2.345, 3.953, 5.496],
          survivor: {
            intercept: -0.2579,
            slope: 0.5832,
            older: -0.02735,
            younger: 0.1519,
            usage: 0.1023
          },
          tails: [
            [-1.289, -1.038, -0.8422, -0.6734, -0.535, -0.3775, -0.1679, -0.02619, 0.1336, 0.4089, 0.7877, 1.12, 1.748, 2.291, 2.878],
            [-1.368, -0.9336, -0.8492, -0.7218, -0.5337, -0.4162, -0.297, -0.1935, -0.01023, 0.1823, 0.7714, 1.624, 2.157, 3.037, 3.377],
            [-1.444, -1.147, -0.957, -0.6915, -0.5723, -0.4238, -0.284, -0.07429, 0.06122, 0.5433, 0.9388, 1.189, 2.445, 3.379, 4.239],
            [-1.289, -1.029, -0.8456, -0.6908, -0.5676, -0.3981, -0.1411, -0.01601, 0.2546, 0.5317, 0.7941, 1.11, 1.772, 2.177, 2.897],
            [-1.502, -1.233, -0.9947, -0.8821, -0.6784, -0.5584, -0.3911, -0.2084, -0.0003458, 0.3556, 0.6401, 1.02, 1.462, 1.95, 3.183],
            [-1.46, -1.224, -1.031, -0.8895, -0.7194, -0.5488, -0.3695, -0.1713, 0.116, 0.4364, 0.6722, 1.058, 1.389, 1.903, 3.543],
            [-1.289, -1.038, -0.8422, -0.6734, -0.535, -0.3775, -0.1679, -0.02619, 0.1336, 0.4089, 0.7877, 1.12, 1.748, 2.291, 2.878],
            [-1.439, -1.255, -1.001, -0.8726, -0.6703, -0.5398, -0.3758, -0.2033, 0.003914, 0.3763, 0.6837, 1.147, 1.577, 2.307, 3.249],
            [-1.475, -1.237, -1.056, -0.8967, -0.7026, -0.547, -0.3195, -0.1114, 0.1959, 0.556, 0.8159, 1.139, 1.495, 1.883, 2.537],
            [-1.444, -1.147, -0.957, -0.6915, -0.5723, -0.4238, -0.284, -0.07429, 0.06122, 0.5433, 0.9388, 1.189, 2.445, 3.379, 4.239],
            [-1.34, -1.148, -0.957, -0.8235, -0.6862, -0.5484, -0.3931, -0.1878, 0.0882, 0.4334, 0.7867, 1.4, 1.78, 2.891, 3.873],
            [-1.282, -1.051, -1.004, -0.7927, -0.6726, -0.586, -0.3499, -0.1271, 0.2235, 0.5401, 0.8039, 1.013, 1.417, 2.193, 2.552]
          ],
          drift600: 2.046,
          cases: 7460,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 3.723
        },
        {
          chance: {
            intercept: -2.145,
            recent: [1, 0.07837, 0.08308],
            quality: 1.052,
            older: -0.2847,
            younger: 0.1257
          },
          conditional: {
            intercept: 0.5437,
            recent: [0.2388, 0.05355, 0],
            quality: 0.05812,
            older: 0.02208,
            younger: 0.09257
          },
          playSpread: {
            base: 0.1876,
            slope: 0.4028
          },
          usageZ: [-1.785, -1.661, -1.575, -1.47, -1.231, -0.9363, -0.422, -0.001817, 0.3473, 0.7073, 0.9832, 1.488, 2.333, 3.871, 5.077],
          survivor: {
            intercept: -0.2918,
            slope: 0.6794,
            older: 0.01279,
            younger: 0.1746,
            usage: 0.000661
          },
          tails: [
            [-1.416, -1.256, -1.067, -0.7914, -0.6042, -0.4197, -0.18, 0.04746, 0.2881, 0.6761, 0.8535, 1.6, 1.982, 2.362, 3.134],
            [-1.582, -1.237, -0.9829, -0.8082, -0.5296, -0.3861, -0.2905, -0.1468, -0.04141, 0.4904, 1.173, 1.477, 3.056, 3.68, 4.269],
            [-1.536, -1.278, -1.158, -0.6028, -0.497, -0.3697, -0.2106, -0.09657, 0.2383, 0.5849, 0.8927, 1.225, 1.351, 1.849, 3.747],
            [-1.422, -1.263, -1.093, -0.8598, -0.6047, -0.4256, -0.2345, 0.03166, 0.2532, 0.6541, 0.8163, 1.443, 1.851, 2.274, 3.523],
            [-1.563, -1.251, -1.052, -0.8748, -0.6957, -0.5843, -0.413, -0.2347, -0.06382, 0.2604, 0.6608, 0.9561, 1.393, 2.113, 2.946],
            [-1.461, -1.182, -0.999, -0.8728, -0.7021, -0.5547, -0.3426, -0.1529, 0.1099, 0.4452, 0.7631, 1.138, 1.422, 2.076, 3.556],
            [-1.416, -1.256, -1.067, -0.7914, -0.6042, -0.4197, -0.18, 0.04746, 0.2881, 0.6761, 0.8535, 1.6, 1.982, 2.362, 3.134],
            [-1.593, -1.252, -1.054, -0.8511, -0.6889, -0.5603, -0.3856, -0.2255, -0.0376, 0.295, 0.697, 1.102, 1.563, 2.351, 3.663],
            [-1.536, -1.305, -1.106, -0.9977, -0.7783, -0.6337, -0.4329, -0.1847, 0.0416, 0.3829, 0.6469, 1.045, 1.424, 1.885, 2.806],
            [-1.536, -1.278, -1.158, -0.6028, -0.497, -0.3697, -0.2106, -0.09657, 0.2383, 0.5849, 0.8927, 1.225, 1.351, 1.849, 3.747],
            [-1.373, -1.133, -0.9428, -0.823, -0.7046, -0.5724, -0.4254, -0.2269, 0.05875, 0.3335, 0.8245, 1.468, 2.102, 3.044, 4.304],
            [-1.226, -1.006, -0.9181, -0.7712, -0.7224, -0.606, -0.5008, -0.2175, 0.08852, 0.3927, 0.7936, 1.213, 1.839, 2.887, 3.213]
          ],
          drift600: 2.036,
          cases: 7487,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 3.325
        },
        {
          chance: {
            intercept: -2.492,
            recent: [0.8947, 0.1437, 0.07599],
            quality: 0.6319,
            older: -0.3839,
            younger: 0.1947
          },
          conditional: {
            intercept: 0.5793,
            recent: [0.1987, 0.05949, 0.03108],
            quality: 0.07459,
            older: 0.04678,
            younger: 0.08858
          },
          playSpread: {
            base: 0.1395,
            slope: 0.4312
          },
          usageZ: [-1.816, -1.71, -1.63, -1.545, -1.291, -0.9704, -0.4434, -0.02648, 0.3157, 0.6298, 0.9189, 1.357, 2.405, 4.067, 5.197],
          survivor: {
            intercept: -0.05504,
            slope: 0.5373,
            older: 0.08438,
            younger: 0.1416,
            usage: -0.07689
          },
          tails: [
            [-1.995, -1.818, -1.388, -0.9117, -0.6449, -0.5168, -0.2942, -0.08107, 0.3766, 0.8618, 1.23, 1.807, 2.237, 2.481, 2.731],
            [-1.425, -1.23, -0.9651, -0.8111, -0.6704, -0.5285, -0.3315, -0.1494, 0.1138, 0.4152, 0.6843, 1.074, 1.429, 1.916, 3.814],
            [-1.566, -1.311, -1.09, -0.9512, -0.754, -0.5883, -0.3749, -0.2184, 0.0366, 0.3687, 0.6838, 1.017, 1.409, 1.823, 3.665],
            [-1.938, -1.706, -1.363, -0.9231, -0.6917, -0.5306, -0.3282, -0.07225, 0.4014, 0.9229, 1.35, 1.863, 2.177, 2.417, 2.509],
            [-1.542, -1.23, -0.9841, -0.8453, -0.6966, -0.5464, -0.3585, -0.1663, 0.1044, 0.4203, 0.6841, 1.061, 1.404, 1.746, 3.84],
            [-1.57, -1.255, -1.084, -0.9193, -0.7234, -0.5641, -0.3549, -0.2142, 0.03715, 0.3565, 0.6563, 1.042, 1.406, 1.793, 3.321],
            [-1.995, -1.818, -1.388, -0.9117, -0.6449, -0.5168, -0.2942, -0.08107, 0.3766, 0.8618, 1.23, 1.807, 2.237, 2.481, 2.731],
            [-1.425, -1.23, -0.9651, -0.8111, -0.6704, -0.5285, -0.3315, -0.1494, 0.1138, 0.4152, 0.6843, 1.074, 1.429, 1.916, 3.814],
            [-1.544, -1.344, -1.115, -0.9888, -0.7893, -0.6859, -0.4605, -0.2353, 0.0288, 0.3677, 0.6661, 0.9127, 1.373, 1.539, 3.957],
            [-1.566, -1.311, -1.09, -0.9512, -0.754, -0.5883, -0.3749, -0.2184, 0.0366, 0.3687, 0.6838, 1.017, 1.409, 1.823, 3.665],
            [-1.457, -1.167, -0.966, -0.8422, -0.6895, -0.5669, -0.3987, -0.2313, 0.09511, 0.3846, 0.807, 1.077, 1.652, 3.454, 4.579],
            [-1.421, -1.213, -1.072, -0.9908, -0.8673, -0.7551, -0.4643, -0.2658, 0.1425, 0.4131, 0.7958, 1.461, 2.459, 3.971, 4.409]
          ],
          drift600: 1.801,
          cases: 7528,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 2.879
        },
        {
          chance: {
            intercept: -2.89,
            recent: [0.8181, 0.1743, 0.04358],
            quality: 0.3986,
            older: -0.4054,
            younger: 0.2506
          },
          conditional: {
            intercept: 0.6008,
            recent: [0.1943, 0.02818, 0.0267],
            quality: 0.2296,
            older: 0.02333,
            younger: 0.08348
          },
          playSpread: {
            base: 0.1836,
            slope: 0.4209
          },
          usageZ: [-1.751, -1.656, -1.576, -1.469, -1.258, -0.9309, -0.458, -0.04413, 0.2868, 0.6586, 0.9389, 1.424, 2.356, 3.941, 5.483],
          survivor: {
            intercept: 0.1589,
            slope: 0.4201,
            older: 0.1048,
            younger: 0.1138,
            usage: -0.1353
          },
          tails: [
            [-1.817, -1.626, -1.338, -1.204, -0.975, -0.7377, -0.386, -0.1751, 0.09362, 0.5949, 1.18, 1.699, 2.21, 2.692, 3.183],
            [-1.613, -1.273, -1.097, -0.909, -0.6809, -0.5585, -0.3902, -0.2105, 0.06473, 0.4471, 0.6998, 1.153, 1.558, 1.879, 2.86],
            [-1.48, -1.187, -0.9864, -0.8369, -0.6707, -0.5106, -0.3688, -0.1963, 0.0195, 0.332, 0.6198, 0.9833, 1.396, 1.91, 3.44],
            [-1.817, -1.626, -1.338, -1.204, -0.975, -0.7377, -0.386, -0.1751, 0.09362, 0.5949, 1.18, 1.699, 2.21, 2.692, 3.183],
            [-1.626, -1.327, -1.096, -0.9183, -0.6821, -0.5512, -0.3879, -0.2004, 0.08046, 0.4819, 0.6866, 1.004, 1.484, 1.727, 2.442],
            [-1.297, -1.155, -0.9598, -0.8326, -0.6535, -0.51, -0.3535, -0.1767, 0.03777, 0.3353, 0.6446, 0.987, 1.454, 1.923, 3.22],
            [-1.817, -1.626, -1.338, -1.204, -0.975, -0.7377, -0.386, -0.1751, 0.09362, 0.5949, 1.18, 1.699, 2.21, 2.692, 3.183],
            [-1.613, -1.273, -1.097, -0.909, -0.6809, -0.5585, -0.3902, -0.2105, 0.06473, 0.4471, 0.6998, 1.153, 1.558, 1.879, 2.86],
            [-1.546, -1.147, -0.9846, -0.8353, -0.6841, -0.535, -0.3842, -0.2306, 0.005697, 0.3325, 0.5977, 0.9035, 1.306, 1.551, 3.727],
            [-1.48, -1.187, -0.9864, -0.8369, -0.6707, -0.5106, -0.3688, -0.1963, 0.0195, 0.332, 0.6198, 0.9833, 1.396, 1.91, 3.44],
            [-1.495, -1.222, -1.035, -0.8904, -0.6811, -0.5849, -0.4175, -0.1993, 0.06923, 0.4905, 0.6967, 1.494, 2.012, 2.889, 3.444],
            [-1.152, -1.036, -0.9596, -0.8602, -0.7024, -0.536, -0.411, -0.3024, -0.1563, 0.1486, 0.5203, 1.145, 1.344, 3.392, 4.455]
          ],
          drift600: 2.089,
          cases: 7554,
          origins: 11,
          priorWeight: 0,
          driftYoung600: 2.887
        },
        {
          chance: {
            intercept: -3.359,
            recent: [0.7697, 0.2489, 0],
            quality: 0.3292,
            older: -0.4438,
            younger: 0.2881
          },
          conditional: {
            intercept: 0.7173,
            recent: [0.09489, 0.01527, 0.009417],
            quality: 0,
            older: 0.09634,
            younger: 0.08847
          },
          playSpread: {
            base: 0.04307,
            slope: 0.5305
          },
          usageZ: [-1.72, -1.666, -1.604, -1.505, -1.25, -0.9205, -0.4466, -0.0232, 0.2906, 0.6335, 0.9302, 1.345, 2.709, 3.919, 5.149],
          survivor: {
            intercept: 0.4161,
            slope: 0.3495,
            older: 0.06852,
            younger: 0.05506,
            usage: -0.2006
          },
          tails: [
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.722, -1.586, -1.241, -1, -0.7842, -0.6144, -0.4525, -0.194, 0.1439, 0.506, 0.8115, 1.236, 1.631, 2.133, 2.872],
            [-1.57, -1.342, -1.118, -0.9531, -0.7318, -0.562, -0.3961, -0.2155, 0.03608, 0.4055, 0.7817, 1.234, 1.584, 2.183, 3.555],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.736, -1.586, -1.28, -1.015, -0.7944, -0.6512, -0.4727, -0.2059, 0.1261, 0.4958, 0.7265, 1.177, 1.668, 2.132, 2.69],
            [-1.449, -1.271, -1.069, -0.9587, -0.7563, -0.5623, -0.385, -0.2196, 0.04691, 0.4038, 0.7733, 1.242, 1.59, 2.355, 3.793],
            [-2.326, -1.881, -1.555, -1.282, -0.9542, -0.6745, -0.3319, 0, 0.3319, 0.6745, 0.9542, 1.282, 1.555, 1.881, 2.326],
            [-1.722, -1.586, -1.241, -1, -0.7842, -0.6144, -0.4525, -0.194, 0.1439, 0.506, 0.8115, 1.236, 1.631, 2.133, 2.872],
            [-1.67, -1.45, -1.243, -0.9679, -0.768, -0.5845, -0.4383, -0.2373, 0.005574, 0.4158, 0.7797, 1.19, 1.618, 2.124, 3.058],
            [-1.57, -1.342, -1.118, -0.9531, -0.7318, -0.562, -0.3961, -0.2155, 0.03608, 0.4055, 0.7817, 1.234, 1.584, 2.183, 3.555],
            [-1.583, -1.402, -1.159, -0.985, -0.8537, -0.6622, -0.4763, -0.3117, -0.002053, 0.4181, 0.6751, 1.303, 1.679, 3.117, 5.534],
            [-1.67, -1.45, -1.243, -0.9679, -0.768, -0.5845, -0.4383, -0.2373, 0.005574, 0.4158, 0.7797, 1.19, 1.618, 2.124, 3.058]
          ],
          drift600: 0.9998,
          cases: 6771,
          origins: 10,
          priorWeight: 0,
          driftYoung600: 1.557
        }
      ],
      usageCuts: [0.1644, 0.6715],
      ceiling: 3.877,
      observedSpread600: 1.496,
      priorWeight: 0,
      qualityCuts: [0.2055, 1.244]
    }
  },
  aging: {
    firstAge: 19,
    hitter: [0.2379, 0.2379, 0.2379, 0.1387, 0.04411, -0.04581, -0.1311, -0.2117, -0.2876, -0.3589, -0.4255, -0.4874, -0.5447, -0.5973, -0.6453, -0.6886, -0.7272, -0.7612, -0.7905, -0.8152, -0.8152, -0.8152, -0.8152, -0.8152, -0.8152, -0.8152],
    pitcher: [0.1619, 0.1619, 0.1619, 0.1619, 0.1015, 0.04339, -0.01239, -0.06583, -0.117, -0.1657, -0.2122, -0.2563, -0.2981, -0.3376, -0.3747, -0.4095, -0.442, -0.4721, -0.4999, -0.5254, -0.5486, -0.5486, -0.5486, -0.5486, -0.5486, -0.5486]
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
    findings: ["Hitters, proneness \u2264 56: playing time 100.9% of the league's rate for the same expected usage (\u00b1 1.5, clustered by player: 1070 players, 11843 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness 56\u201375: playing time 101.0% of the league's rate for the same expected usage (\u00b1 1.7, clustered by player: 635 players, 8452 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness > 75: playing time 97.9% of the league's rate for the same expected usage (\u00b1 1.7, clustered by player: 634 players, 9954 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness \u2264 56, under 30: aging -0.024 WAR per 600 a year against the curve (\u00b1 0.062, clustered: 534 players, 1688 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness \u2264 56, 30 and over: aging +0.033 WAR per 600 a year against the curve (\u00b1 0.096, clustered: 199 players, 524 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness 56\u201375, under 30: aging +0.000 WAR per 600 a year against the curve (\u00b1 0.072, clustered: 347 players, 1136 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness 56\u201375, 30 and over: aging -0.014 WAR per 600 a year against the curve (\u00b1 0.095, clustered: 154 players, 529 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness > 75, under 30: aging +0.058 WAR per 600 a year against the curve (\u00b1 0.093, clustered: 295 players, 982 pairs) \u2014 not distinguishable from none (Holm), not used.", "Hitters, proneness > 75, 30 and over: aging -0.003 WAR per 600 a year against the curve (\u00b1 0.128, clustered: 272 players, 960 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness \u2264 56: playing time 91.8% of the league's rate for the same expected usage (\u00b1 3.1, clustered by player: 760 players, 8259 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness 56\u201375: playing time 104.1% of the league's rate for the same expected usage (\u00b1 2.1, clustered by player: 1089 players, 10853 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness > 75: playing time 100.4% of the league's rate for the same expected usage (\u00b1 1.7, clustered by player: 1122 players, 15882 seasons, horizons 1\u20133) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness \u2264 56, under 30: aging -0.021 WAR per 600 a year against the curve (\u00b1 0.089, clustered: 286 players, 754 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness \u2264 56, 30 and over: aging +0.097 WAR per 600 a year against the curve (\u00b1 0.102, clustered: 99 players, 266 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness 56\u201375, under 30: aging -0.109 WAR per 600 a year against the curve (\u00b1 0.063, clustered: 521 players, 1404 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness 56\u201375, 30 and over: aging -0.001 WAR per 600 a year against the curve (\u00b1 0.081, clustered: 197 players, 512 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness > 75, under 30: aging +0.068 WAR per 600 a year against the curve (\u00b1 0.062, clustered: 607 players, 1796 pairs) \u2014 not distinguishable from none (Holm), not used.", "Pitchers, proneness > 75, 30 and over: aging +0.082 WAR per 600 a year against the curve (\u00b1 0.084, clustered: 339 players, 1046 pairs) \u2014 not distinguishable from none (Holm), not used."]
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

// ── phase 4a: the cost of controlled seasons (PLAYER_VALUE.md Parts 2.2 and 4.4) ─────────────────────

/**
 * How the cost ladder is measured and served (`playerValueCost.ts`). Chosen, not fitted (D-041): what the
 * method is asked to achieve and when it may be trusted. The numbers it measures are the save's, per import.
 *
 *   renewal.quantile       the renewal band's high edge is the 90th percentile of the save's pre-arbitration
 *                          one-year renewals: the pay nine renewals in ten stay under, so one foreign signing
 *                          or non-tender on a one-year deal does not set it;
 *   renewal.confidence     read as its distribution-free upper confidence bound at 90% (an order statistic), so
 *                          a thinner class reads a higher edge, never a lower one;
 *   renewal.minimumCases   30 renewals before the band is the save's own; fewer, and it is the provisional prior
 *                          widened by the save's cases (only where the regime as read is MLB's), else unknown;
 *   ladder.platformSeasons an arbitration salary is read against the mean WAR of the two seasons before the
 *                          arbitration winter (the platform season and the one before it). Arbitration pays for
 *                          a body of work, not one season; on the Arizona import the two-season platform explains
 *                          each class's pay better than the platform season alone (CALIBRATION.md section 8). For
 *                          a future season the platform seasons are projections;
 *   ladder.spread          the class's pay around its line: the 10th and 90th percentiles of what the class was
 *                          paid against what the line gives (an inverted-CDF quantile, unchanged by duplicating
 *                          the class), the same 80% as production's outer band;
 *   ladder.lineErrors      the line's own uncertainty added on each side, 1.28 standard errors (the same 80%), so
 *                          fewer contracts read wider;
 *   ladder.minimumCases    30 contracts in a class before its line is the save's own; fewer, and it is the
 *                          provisional prior hulled with the save's own line (read from `fitCases`, three, the
 *                          fewest a line can be read on), only where the regime as read is MLB's; else unknown.
 */
export const COST_POLICY = {
  renewal: { quantile: 0.9, confidence: 0.9, minimumCases: 30 },
  ladder: { platformSeasons: 2, spread: { low: 0.1, high: 0.9 }, lineErrors: 1.2816, minimumCases: 30, fitCases: 3 },
} as const;

export const COST_POLICY_CALIBRATION: CalibrationStamp = policy(
  "The cost ladder's method (phase 4a): a pre-arbitration renewal from the league minimum to the 90% upper confidence bound of the 90th percentile of the save's " +
    "one-year renewals; an arbitration season from its class's line (pay above the minimum against the two-season platform WAR: a base and a share of the " +
    "price of a win per platform win), with its 10th-90th percentile spread and 1.28 of the line's standard errors each side; 30 cases before a class is the " +
    "save's own. Decisions about the method (D-041), not fits: the numbers themselves are measured on each import."
);

/** One arbitration class of the provisional prior, in the league minimum's units so it carries to another save's money. */
export interface CostPriorClass {
  arbitrationClass: number;
  cases: number;
  /** Pay above the minimum at no platform wins, in minimums. */
  baseOverMinimum: number;
  /** Per platform win, as a share of the price of a win's central (the rung). */
  share: number;
  /** The class's pay around its line, in minimums. */
  spreadOverMinimum: { low: number; high: number };
  /** The line's residual standard deviation, in minimums; its mean platform and sum of squares (wins). */
  sigmaOverMinimum: number;
  meanPlatform: number;
  sumSquares: number;
  /** The least pay above the minimum the class showed, in minimums. */
  floorOverMinimum: number;
}

/**
 * The provisional prior (D-053): the same method run on the Arizona import's imported real-world contracts (R-6),
 * used only where a save's own class is thinner than the policy minimum AND its regime as read is MLB's. Never
 * presented as the save's own measurement: every cost priced from it says "provisional".
 */
export const COST_PRIOR: { source: string; renewal: { cases: number; highOverMinimum: number }; ladder: CostPriorClass[] } = {
  source: 'the cost ladder measured on the imported real-world 2026 contracts of the Arizona save (2026-05-16; R-6)',
  renewal: { cases: 249, highOverMinimum: 1.0128 },
  ladder: [
    // Measured by `measureCostLadder` on that import (2026-05-16): 74, 51 and 47 contracts; 10, 6 and 4 at the minimum left out
    { arbitrationClass: 1, cases: 74, baseOverMinimum: 0.5668, share: 0.1427, spreadOverMinimum: { low: -1.0176, high: 1.4033 }, sigmaOverMinimum: 1.0203, meanPlatform: 1.206, sumSquares: 106.747, floorOverMinimum: 0.0256 },
    { arbitrationClass: 2, cases: 51, baseOverMinimum: 1.7265, share: 0.264, spreadOverMinimum: { low: -2.2308, high: 2.2876 }, sigmaOverMinimum: 3.6211, meanPlatform: 1.3245, sumSquares: 45.721, floorOverMinimum: 0.1538 },
    { arbitrationClass: 3, cases: 47, baseOverMinimum: 0.5218, share: 0.4876, spreadOverMinimum: { low: -4.1182, high: 4.4303 }, sigmaOverMinimum: 4.4155, meanPlatform: 1.3682, sumSquares: 71.258, floorOverMinimum: 0.5385 },
  ],
};

export const COST_PRIOR_CALIBRATION: CalibrationStamp = provisional(
  'The cost ladder on the imported real-world contracts (R-6: the Arizona import, 2026-05-16): the renewal spread and the arbitration ladder by class, ' +
    "in minimums and shares of the price of a win. Used only where a save's own class is below the policy minimum and its regime as read is MLB's, " +
    "hulled with the save's own cases, and always labelled provisional; replaced by the save's measurement as its classes fill, and by observed awards (phase 4b)."
);
