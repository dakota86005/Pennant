/**
 * Player Value, concern 3: expected production in wins, for players with a major-league record
 * (phases 3a and 3b, hardened 2026-09-23; PLAYER_VALUE.md Part 2.3, D-052, D-053).
 *
 * Pure: it is handed a player's major-league lines, his age, the share of this season played, the
 * league's schedule, his stated injury facts and injury proneness, and a FITTED MODEL, and opens no
 * table. The model is the save's own fit (`playerValueFitStore.ts`, fitted by
 * `playerValueProductionFit.ts` on the export's history, adopted only through the gate) or, until the
 * save has one, the provisional fallback prior in `playerValueCalibration.ts`, fitted to the league's own
 * WAR scale (`adaptPriorToLeague`). Nothing here holds a fitted number of its own.
 *
 * The unit is the win, in the export's own WAR units (R-4). For each side a player has (batting,
 * pitching; a two-way player has both and they are summed edge with edge):
 *
 *   rate      a recency-weighted rate, WAR per opportunity (plate appearance for a hitter, batter
 *             faced for a pitcher), over a rolling window of three season-lengths ending today,
 *             regressed toward the fitted mean by sample: (weighted WAR + mean × K) ÷ (weighted
 *             opportunities + K).
 *   usage     playing time PER SCHEDULED GAME (so a 60-game league, a 2020-style short season and a
 *             schedule that changed length are read at their own schedules), from observed usage, his
 *             projected quality and his age: the chance he plays at all (attrition) and his playing time
 *             when he does, each at most the physical ceiling the save's own history shows.
 *   selection the rate of the players who DO play at a horizon, fitted apart (hardening, B-01): talent
 *             drifts, and the players who keep playing are the ones who stayed good, so the expected
 *             wins are E[rate × playing time], never the product of the two expectations.
 *   band      a mixture: no playing time with the attrition's chance, else the wins when he plays,
 *             whose spread S combines what is not known about his rate, the drift of true talent, season
 *             noise and the usage uncertainty; the fitted distribution of each cell turns S into the 80%
 *             and 50% bands, as quantiles of the mixture (so a point mass at nothing is honest, B-12).
 *
 * Phase 3b hands in what the scouted ratings say about his rate AS NUMBERS ONLY (`AbilityPrior`); the
 * same-time ratings pull his rate only for what his results do not already carry (B-06).
 *
 * Invariants held by construction (tests/playerValueProduction.test.ts): the rate band is never
 * narrower further out, while the wins band follows expected playing time (owner, 2026-09-23); on
 * the same expected usage, fewer results never narrow a band; a better line never lowers the central
 * or the high edge; the 50% band sits inside the 80% band; proneness never narrows; known days out move
 * the central and keep the high edge (owner, 2026-09-23); a missing input is unknown, never a
 * midpoint; nothing here knows which club holds the player.
 */

import type { CalibrationStamp } from './calibration.js';
import { CONTROL_HORIZON_SEASONS, PRODUCTION_POLICY } from './playerValueCalibration.js';

// ── the model a fit produces (stored per save as JSON) ───────────────────────

export type ProductionSide = 'batting' | 'pitching';
export type ProductionKind = 'hitter' | 'starter' | 'reliever';
export type AgingGroup = 'hitter' | 'pitcher';

/** Band tails of models made before the hardening (method production-3b.1): read only to say they are stale. */
export interface BandTails {
  low80: number;
  high80: number;
  low50: number;
  high50: number;
}

/**
 * A linear predictor of playing time: intercept + recent · [slot 0, 1, 2] (his observed opportunities PER
 * SCHEDULED GAME in the window's three slots) + quality · q (his projected rate above replacement, WAR per
 * 600, never below zero) + older · (age − pivot)⁺ + younger · (pivot − age)⁺. The coefficients on usage
 * and on quality are never negative.
 */
export interface UsageTerms {
  intercept: number;
  recent: [number, number, number];
  quality: number;
  older: number;
  younger: number;
}

/**
 * The rate, WAR per 600, of the players who play at a horizon: intercept + slope × his regressed rate now (plus
 * what the aging curve does not carry: development toward potential, a proneness shift) + older · (age − pivot)⁺
 * + younger · (pivot − age)⁺. The survivors' own aging is in these terms, fitted per horizon on the save's
 * held-in seasons; the slope is never negative. Weighted by the opportunities they played, so E[wins] =
 * E[opportunities] × this.
 */
export interface SurvivorTerms {
  intercept: number;
  slope: number;
  older: number;
  younger: number;
  /** On his window playing time per scheduled game (the mean of the three slots): who plays on depends on how much he played. */
  usage?: number;
}

export interface HorizonModel {
  /** The chance of any major-league playing time at this horizon: a logistic in these terms (attrition). */
  chance: UsageTerms;
  /** Opportunities per scheduled game when he plays. */
  conditional: UsageTerms;
  /** The spread of playing time when he plays, per scheduled game: base + slope × expected (base ≥ 0). */
  playSpread: { base: number; slope: number };
  /** Playing time when he plays, as multiples of that spread, at PRODUCTION_POLICY.tailGrid. */
  usageZ: number[];
  /** The rate of the players who play at this horizon (selection), WAR per 600. */
  survivor: SurvivorTerms;
  /**
   * Wins when he plays, as multiples of the spread S around their expectation, at PRODUCTION_POLICY.tailGrid,
   * for each cell of quality tier × usage tier (`tailCell`).
   */
  tails: number[][];
  /** Drift: the variance of a player's true rate that no sample removes, (WAR per 600)², by horizon. */
  drift600: number;
  /** The drift of players 25 or younger in the first target season (PRODUCTION_POLICY.ageBands[0]): fitted apart. */
  driftYoung600?: number;
  /** The origin seasons behind this horizon's training cases (how many cohorts it rests on). */
  origins?: number;
  /** Backtest cases behind this horizon (training). */
  cases: number;
  /** The fallback prior's share of this horizon (1 where the save had no cases): the bands widen by it. */
  priorWeight: number;
}

export interface KindModel {
  /** Recency weights of the window's three slots, the most recent first, relative to it (the first is 1). */
  weights: [number, number, number];
  /** The regression's K, in weighted opportunities. */
  stabilization: number;
  /** The mean results are regressed toward, WAR per 600 opportunities. */
  mean600: number;
  /** Season noise: the variance of WAR over 600 opportunities around a player's true rate (WAR²). */
  noise600: number;
  /** A typical rate's size, WAR per 600, that turns usage uncertainty into wins without reading his own line. */
  rateScale600: number;
  /** Horizon seasons 1..H, from the window's end. */
  horizons: HorizonModel[];
  /** Expected usage per scheduled game at horizon 1 that separates the usage tiers (ascending). */
  usageCuts: number[];
  /** Projected rate (WAR per 600) at the bottom and top tenth among the kind's training cases. */
  qualityCuts?: [number, number];
  /**
   * The physical ceiling: the most opportunities per scheduled game any player of this kind played in a
   * season of the save's history (measured, never a constant); null when not measured.
   */
  ceiling?: number | null;
  /**
   * The spread of player-season rates in the fit's window (WAR per 600, opportunity-weighted, seasons with at
   * least PRODUCTION_POLICY.priorAdaptation.minimumOpportunities): the WAR scale the prior is fitted to a league against.
   */
  observedSpread600?: number | null;
  /** The fallback prior's share of this kind at horizon 1 (1 for the prior itself). */
  priorWeight: number;
}

export interface ProneModel {
  /** Band cut points on the save's proneness scale: band i holds values ≤ cuts[i]; the last band everything above. */
  cuts: number[];
  /** Usage multiplier per band (1 where the fit found no effect), hitters and pitchers apart; horizons 1 to 3 only. */
  usage: Record<AgingGroup, number[]>;
  /** Aging shift per band, WAR per 600 per year, [younger than ageSplit, ageSplit and older] (0 where no effect). */
  aging: Record<AgingGroup, Array<[number, number]>>;
  ageSplit: number;
  /** What the fit found, in words, for the basis. */
  findings: string[];
}

export interface ProductionModel {
  method: string;
  kinds: Record<ProductionKind, KindModel>;
  /** Change in WAR per 600 opportunities from age a to a + 1, from `firstAge` upward; the ends hold beyond. */
  aging: { firstAge: number; hitter: number[]; pitcher: number[] };
  /** The age at which the usage regression bends. */
  usagePivotAge: number;
  proneness: ProneModel | null;
  /** The schedule the fit's history mostly played (games per club): used only for an input that states none. */
  referenceGames?: number | null;
}

/** Where the model in use came from: the save's own adopted fit, or the provisional fallback prior (D-053). */
export interface ModelProvenance {
  source: 'save_fit' | 'fallback_prior';
  /** One line for the GM: "calibrated on this save's …" or "not yet calibrated on this save (N seasons)". */
  label: string;
  stamp: CalibrationStamp;
  fitId: string | null;
  /** The prior's share of the fit (1 when the prior is used alone). */
  priorWeight: number;
  /** Coverage the fit observed on held-out seasons, per horizon, as served; null when not measured (the prior). */
  observed?: ObservedCoverage[] | null;
  /**
   * The history behind the model in force, for the one-line calibration status: how many seasons the save's
   * last fit read, the first and last of them and the completed season it was refitted after (null under
   * the prior), whether the fit calls itself calibrated on this save, and which horizons are the save's own.
   */
  window?: {
    seasons: number; first: number | null; last: number | null; refitAfter: number | null; calibrated: boolean;
    horizons?: { calibrated: number[]; prior: number[] };
    /** The seasons the last fit read, as the label says them ("6 seasons of major-league lines, none usable: …", D-15). */
    note?: string;
  };
}

export interface ObservedCoverage {
  horizon: number;
  cases: number;
  outer: number | null;
  inner: number | null;
}

// ── the input ─────────────────────────────────────────────────────────────────

/** One season of one side, the major-league level only, the overall split, summed over clubs. */
export interface ProductionLine {
  season: number;
  /** Plate appearances (batting) or batters faced (pitching). */
  opportunities: number;
  /** The export's WAR; null when the export has no figure. */
  war: number | null;
  /** Pitching: games and games started, which decide starter or reliever. */
  games?: number;
  starts?: number;
}

/** Injury facts as the export states them; the calendar is measured from the save. */
export interface InjuryFacts {
  injured: boolean | null;
  /** Days out, as exported (the larger of the injury and injured-list figures); null when not established. */
  daysLeft: number | null;
  careerEnding: boolean | null;
  /** Days left in this season's calendar (from Opening Day, before it), and in a full season; null when not established. */
  seasonDaysLeft: number | null;
  seasonDays: number | null;
  /** Days until Opening Day (0 once the season has started); null or absent when not established. */
  daysToOpening?: number | null;
  /** Days between this season's last game and the next season's first; null or absent when not established. */
  offseasonDays?: number | null;
  /** The export states an injury this season (injured now, or on the injured list this season). */
  injuredThisSeason?: boolean | null;
  /** Why the days out are not read (a value the export holds for many injured players it contradicts). */
  durationNote?: string | null;
}

/** The league's schedule: this season's (and, as the rules stand, every later season's) and earlier ones'. */
export interface ScheduleFacts {
  /** Games per club this season; null when not established. */
  games: number | null;
  /** Games per club in earlier seasons, as the save's standings show them. */
  bySeason?: Record<number, number | null>;
  /** The league's first season with major-league lines: seasons before it are unknown, never zero (D-02). */
  firstSeason?: number | null;
}

/**
 * How much playing time holds within this season, measured on this season's own games (hardening, B-07):
 * of the players who played in the first half of the games so far, their playing time per game in the
 * second half against the first, per kind, over the share of a season the second half spans.
 */
export interface InSeasonFacts {
  continuation: Partial<Record<ProductionKind, number>>;
  /** The share of a season the measurement spans (the second half's games over the schedule). */
  measuredShare: number;
  /** Games per club behind it. */
  games: number;
  note: string;
}

export interface ProductionInput {
  playerId: number;
  /** This season (the league's). */
  season: number | null;
  /** Share of this season played, 0 to 1. */
  seasonPlayed: number | null;
  /** Age on July 1 of this season. */
  age: number | null;
  batting: ProductionLine[];
  pitching: ProductionLine[];
  /**
   * The observed usage expected playing time is read from; by default the same lines. Kept apart
   * only so the evidence invariants can be stated "on the same expected playing time".
   */
  usage?: { batting?: ProductionLine[]; pitching?: ProductionLine[] };
  injury?: InjuryFacts | null;
  /** `prone_overall` on the save's scale (owner-attested known fact); null or absent when unknown. */
  proneness?: number | null;
  horizon?: number;
  /** The league's schedule; absent, the model's reference schedule is assumed and said. */
  schedule?: ScheduleFacts | null;
  /** This season's in-season continuation, measured on the save; absent or null when not measured. */
  inSeason?: InSeasonFacts | null;
  /** His listed position and role, as exported (1 is a pitcher; a role above 0 is a pitching role). */
  listed?: { position: number | null; role: number | null } | null;
  /** A side whose lines the export cannot read (a missing column), with why. */
  unavailable?: Partial<Record<ProductionSide, string>> | null;
  /** Phase 3b: what his scouted ratings say about a side's rate, as numbers, keyed by side. */
  abilityPrior?: Partial<Record<ProductionSide, AbilityPrior>> | null;
  /** Phase 3b: ability unknown for a side, so per season the rate variance ((WAR per 600)²) to widen by. */
  abilityUnknownWidening?: Partial<Record<ProductionSide, number[]>> | null;
}

/** What the scouted ratings say about a player's rate, as numbers only (phase 3b). */
export interface AbilityPrior {
  /** The rate his current ratings imply, WAR per 600 opportunities. */
  rate600: number;
  /** What is not known about his true rate given those ratings, (WAR per 600)². */
  variance600: number;
  /** Per season of the horizon (0 = this one): the change his development and decline imply, WAR per 600. */
  path600: number[];
  /** Per season: the variance of that change, (WAR per 600)². */
  pathVariance600: number[];
  /**
   * Whether the ratings' reliability as a FORECAST was measured on the save's own snapshots. Until it is,
   * the same-time ratings pull his rate only for what his results do not already carry (B-06).
   */
  forecast?: boolean;
}

/** How results and ratings were weighed for a side (phase 3b): shown in the basis, the two weights sum to one. */
export interface BlendBasis {
  /** n ÷ (n + K): how much of the rate is his own results. */
  results: number;
  /** K ÷ (n + K): how much is the ratings-implied rate. */
  ratings: number;
  /** K, in weighted opportunities. */
  reliabilitySample: number;
  /** The rate his ratings imply now, WAR per 600. */
  ratingsRate: number;
  /** The rate his results imply before any regression, WAR per 600; null without a sample. */
  resultsRate: number | null;
}

// ── the output ────────────────────────────────────────────────────────────────

export interface WinsBand {
  low: number;
  central: number;
  high: number;
}

export interface SideSeason {
  side: ProductionSide;
  kind: ProductionKind;
  /** The 80% band; `inner` is the 50% band. */
  wins: WinsBand;
  inner: WinsBand;
  /** WAR per 600 opportunities when he plays this season (age, proneness and selection included). */
  rate: number;
  /** The rate's 80% and 50% bands, WAR per 600: never narrower further out. */
  rateBand: WinsBand;
  rateInner: WinsBand;
  /** The age adjustment to the rate so far, WAR per 600 (with the proneness shift). */
  aging: number;
  /** How much better the players who keep playing are than projected (selection), WAR per 600. */
  selection?: number;
  /** Expected opportunities, with the usage band (80%). */
  usage: WinsBand;
  /** The chance of any major-league playing time this season. */
  chance?: number;
  /**
   * The band's point mass at nothing (no playing time): the probability just below it and its size. A
   * backtest scores an outcome of no playing time against a band edge at nothing by the share of this mass the
   * band holds (a discrete outcome, never counted as wholly inside).
   */
  zero?: { below: number; mass: number };
  /** Phase 3b, a player not yet in the majors: his chance of any major-league playing time this season. */
  arrival?: { chance: number } | null;
}

export interface ProductionSeason {
  season: number;
  /** Seasons from the window's end (fractional while this season is under way). */
  horizon: number;
  age: number;
  /** The 80% band (this season: banked plus the rest of it). */
  wins: WinsBand;
  /** The 50% band, inside `wins`. */
  inner: WinsBand;
  /** This season only: the WAR he has banked, a fact. */
  toDate: number | null;
  /** This season only: the band for the rest of it (80%). */
  remaining: WinsBand | null;
  sides: SideSeason[];
  notes: string[];
  /**
   * The bands' coverage targets and what the fit in force observed at this horizon on held-out seasons, for
   * THIS estimator; null (with the reason) where the estimator served was not measured.
   */
  coverage: {
    horizon: number;
    target: { outer: number; inner: number };
    observed: { horizon: number; cases: number; outer: number | null; inner: number | null } | null;
    /** A related figure that was measured (the results-only estimator), named as such, where this one was not. */
    reference?: { estimator: 'results'; horizon: number; cases: number; outer: number | null; inner: number | null } | null;
    note: string;
  };
}

export interface SideBasis {
  side: ProductionSide;
  kind: ProductionKind;
  /** The seasons read, their opportunities and WAR, and each one's weight in the rate. */
  seasons: Array<{ season: number; opportunities: number; war: number; weight: number }>;
  /** Opportunities across those seasons, unweighted. */
  opportunities: number;
  /** Weighted opportunities: the sample the regression and the rate uncertainty rest on. */
  effectiveSample: number;
  /** The weighted rate before regression, WAR per 600; null without a sample. */
  observedRate: number | null;
  /** After regression toward the mean, WAR per 600. */
  regressedRate: number;
  /** K ÷ (sample + K): how much of the rate is the mean. */
  regressionShare: number;
  /** The mean regressed toward, WAR per 600. */
  mean: number;
  /** What is not known about his rate, WAR per 600 (a standard deviation); it only grows as results thin. */
  rateUncertainty: number;
  /** Observed usage per season-length in the window's three slots, the most recent first (opportunities). */
  usagePerSeason: [number, number, number];
  /** Seasons in the window not read as evidence of his playing time, and why (before the league; lost to injury). */
  usageNotEvidence?: Array<{ season: number; reason: string }>;
  /** Phase 3b: how his results and his ratings were weighed; null when no ability evidence entered. */
  blend?: BlendBasis | null;
}

/** What the scouted ratings contributed (phase 3b), or why they could not. */
export interface AbilityBasis {
  status: 'used' | 'unknown';
  reason: string | null;
  evidence: { status: 'complete' | 'partial' | 'unknown'; missing: string[]; provenance: string; verification: string };
  variant: string | null;
  bat: 'splits' | 'overall' | null;
  currentRate: number | null;
  potentialRate: number | null;
  uncertainty: number | null;
  reliability: 'save_snapshots' | 'kind_K' | null;
  development: {
    source: 'save_fit' | 'fallback_prior' | 'unknown';
    label: string;
    path: Array<{ season: number; low: number; central: number; high: number }>;
  } | null;
  model: ModelProvenance;
  caveat: string;
}

/** Where a player not yet in the majors gets his expected playing time (phase 3b). */
export interface ArrivalBasis {
  level: number | null;
  age: number | null;
  band: { ageFrom: number; ageTo: number; cases: number } | null;
  seasons: Array<{ season: number; chance: number; expected: number }>;
  /** What the chance (and, with quality, the playing time) is conditioned on beyond his level and age (hardening F4: quality). */
  conditioned: 'level_and_age' | 'level_age_and_potential' | 'level_age_and_quality' | 'level_age_potential_and_quality';
  note: string;
}

export interface ProductionBasis {
  origin: { season: number | null; seasonPlayed: number | null; age: number | null };
  source?: 'results' | 'results_and_ratings' | 'ratings';
  ability?: AbilityBasis | null;
  arrival?: ArrivalBasis | null;
  sides: SideBasis[];
  notProjected: Array<{ side: ProductionSide; opportunities: number; reason: string }>;
  proneness: { value: number | null; band: number | null; note: string };
  coverage: { outer: number; inner: number };
  /** The schedule the playing time is read at, and where it came from. */
  schedule?: { games: number | null; note: string } | null;
  /** How the rest of this season's playing time was read: this season's own games, or not measured. */
  inSeason?: { measured: boolean; note: string } | null;
  model: ModelProvenance;
  calibration: CalibrationStamp;
}

export interface PlayerProduction {
  playerId: number;
  status: 'projected' | 'unknown';
  reason: string | null;
  unit: string;
  seasons: ProductionSeason[];
  basis: ProductionBasis;
}

export const PRODUCTION_UNIT = "wins above replacement, in the export's own WAR units";

// ── arithmetic ───────────────────────────────────────────────────────────────

const PER = PRODUCTION_POLICY.rateUnitOpportunities;
const GRID: readonly number[] = PRODUCTION_POLICY.tailGrid;

/** A per-horizon quantity at a fractional horizon, linear between whole seasons, held at the ends. */
export function atHorizon<T>(rows: T[], h: number, read: (row: T) => number): number {
  const last = rows.length;
  const x = Math.min(Math.max(h, 1), last);
  const lo = Math.floor(x);
  const hi = Math.min(Math.ceil(x), last);
  const t = x - lo;
  return (1 - t) * read(rows[lo - 1]) + t * read(rows[hi - 1]);
}

/** A per-horizon grid at a fractional horizon, element by element. */
function gridAtHorizon<T>(rows: T[], h: number, read: (row: T) => readonly number[]): number[] {
  return GRID.map((_, j) => atHorizon(rows, h, (row) => read(row)[j] ?? 0));
}

export const usageTerms = (t: UsageTerms, U: readonly number[], q: number, originAge: number, pivot: number): number =>
  t.intercept + t.recent[0] * U[0] + t.recent[1] * U[1] + t.recent[2] * U[2] + t.quality * q
  + t.older * Math.max(0, originAge - pivot) + t.younger * Math.max(0, pivot - originAge);

const logistic = (z: number): number => 1 / (1 + Math.exp(-Math.min(Math.max(z, -30), 30)));

/** Playing time at a horizon: the chance of any, and opportunities per scheduled game when he plays. */
export function usageParts(row: HorizonModel, U: readonly number[], q: number, originAge: number, pivot: number): { chance: number; perGame: number } {
  return {
    chance: logistic(usageTerms(row.chance, U, q, originAge, pivot)),
    perGame: Math.max(0, usageTerms(row.conditional, U, q, originAge, pivot)),
  };
}

/** Expected opportunities per scheduled game at a horizon: the chance × the playing time when he plays. */
export function expectedUsage(row: HorizonModel, U: readonly number[], q: number, originAge: number, pivot: number): number {
  const u = usageParts(row, U, q, originAge, pivot);
  return u.chance * u.perGame;
}

/** The rate of the players who play at a horizon, WAR per 600, for a projected rate and age. */
export function survivorRate(t: SurvivorTerms | undefined, projected600: number, originAge: number, pivot: number, usagePerGame = 0): number {
  if (!t) return projected600;
  return t.intercept + t.slope * projected600 + t.older * Math.max(0, originAge - pivot) + t.younger * Math.max(0, pivot - originAge)
    + (t.usage ?? 0) * usagePerGame;
}

/** Quality tiers of the band's tails: the bottom tenth of projected rate, the middle, the top tenth. */
export const QUALITY_TIERS = PRODUCTION_POLICY.qualityTiers.edges.length + 1;

/** Which of a horizon's tails applies: quality × usage cells, or usage tier alone in a model without quality tiers. */
export function tailCell(available: number, usageTier: number, qualityTier: number, young = false): number {
  const tiers = PRODUCTION_POLICY.usageTiers;
  // A young player's outcomes (breaking out or washing out) have cells of their own by quality tier (B-04)
  if (young && available >= tiers * QUALITY_TIERS + QUALITY_TIERS) return tiers * QUALITY_TIERS + qualityTier;
  if (available >= tiers * QUALITY_TIERS) return qualityTier * tiers + Math.min(usageTier, tiers - 1);
  return Math.min(usageTier, Math.max(available - 1, 0));
}

/** The aging curve's change from `from` to `to` (real ages, `to` ≥ `from`): the step function integrated. */
export function agingBetween(curve: number[], firstAge: number, from: number, to: number, shift?: (age: number) => number): number {
  if (curve.length === 0 || to <= from) return 0;
  let total = 0;
  let x = from;
  while (x < to - 1e-12) {
    const a = Math.floor(x + 1e-12);
    const next = Math.min(a + 1, to);
    const i = Math.min(Math.max(a - firstAge, 0), curve.length - 1);
    total += (next - x) * (curve[i] + (shift ? shift(a) : 0));
    x = next;
  }
  return total;
}

// ── a stored distribution, and the mixture with no playing time ─────────────────

/** The quantile function of a stored grid (probabilities PRODUCTION_POLICY.tailGrid), linear between points and beyond the ends. */
export function gridQuantile(z: readonly number[], p: number): number {
  const n = GRID.length;
  if (z.length < n) return 0;
  if (p <= GRID[0]) {
    const slope = (z[1] - z[0]) / (GRID[1] - GRID[0]);
    return z[0] - (GRID[0] - Math.max(p, 0)) * slope;
  }
  if (p >= GRID[n - 1]) {
    const slope = (z[n - 1] - z[n - 2]) / (GRID[n - 1] - GRID[n - 2]);
    return z[n - 1] + (Math.min(p, 1) - GRID[n - 1]) * slope;
  }
  let i = 0;
  while (i < n - 2 && GRID[i + 1] < p) i += 1;
  const t = (p - GRID[i]) / (GRID[i + 1] - GRID[i]);
  return z[i] + t * (z[i + 1] - z[i]);
}

/** The distribution function of a stored grid: the probability of an outcome below x. */
export function gridCdf(z: readonly number[], x: number): number {
  const n = GRID.length;
  if (z.length < n) return x >= 0 ? 1 : 0;
  const lowEnd = gridQuantile(z, 0);
  const highEnd = gridQuantile(z, 1);
  if (x <= lowEnd) return 0;
  if (x >= highEnd) return 1;
  // Bisection on the quantile function, which never falls
  let a = 0;
  let b = 1;
  for (let k = 0; k < 40; k += 1) {
    const m = (a + b) / 2;
    if (gridQuantile(z, m) < x) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/**
 * A quantile of the mixture of no playing time (nothing, with chance 1 − c) and the wins when he plays (the
 * stored distribution, located at mu and scaled by S). The point mass at nothing is exact, never smoothed.
 */
export function mixtureQuantile(chance: number, mu: number, S: number, z: readonly number[], p: number): number {
  const c = Math.min(Math.max(chance, 0), 1);
  if (c <= 0) return 0;
  if (!(S > 0)) {
    // The continuous part is a point at mu
    const [first, second] = mu < 0 ? [mu, 0] : [0, mu];
    const firstMass = mu < 0 ? c : 1 - c;
    return p <= firstMass ? first : second;
  }
  const below = c * gridCdf(z, -mu / S);
  if (p <= below) return mu + S * gridQuantile(z, p / c);
  if (p <= below + (1 - c)) return 0;
  return mu + S * gridQuantile(z, (p - (1 - c)) / c);
}

// ── the window ──────────────────────────────────────────────────────────────

export interface Slot { opportunities: number; war: number; games: number; starts: number }

/**
 * The window: three season-lengths ending today. Slot 0 is this season so far plus the part of last
 * season it does not yet cover; slots 1 and 2 roll back the same way. At a season's start it is the
 * last three complete seasons; at its end, this season and the two before.
 */
export function windowOf(lines: ProductionLine[], season: number, f: number): { slots: Slot[]; coefficients: Map<number, number[]> } {
  const bySeason = new Map<number, ProductionLine>();
  for (const l of lines) {
    const had = bySeason.get(l.season);
    bySeason.set(l.season, had
      ? {
        season: l.season, opportunities: had.opportunities + l.opportunities,
        war: had.war === null || l.war === null ? null : had.war + l.war,
        games: (had.games ?? 0) + (l.games ?? 0), starts: (had.starts ?? 0) + (l.starts ?? 0),
      }
      : l);
  }
  const coefficients = windowCoefficients(season, f);
  const slots: Slot[] = [0, 1, 2].map(() => ({ opportunities: 0, war: 0, games: 0, starts: 0 }));
  for (const [s, c] of coefficients) {
    const l = bySeason.get(s);
    if (!l) continue;
    c.forEach((k, i) => {
      if (k <= 0) return;
      slots[i].opportunities += k * l.opportunities;
      slots[i].war += k * (l.war ?? 0);
      slots[i].games += k * (l.games ?? 0);
      slots[i].starts += k * (l.starts ?? 0);
    });
  }
  return { slots, coefficients };
}

/** Which seasons feed which slot, and by how much. */
function windowCoefficients(season: number, f: number): Map<number, number[]> {
  return new Map<number, number[]>([
    [season, [1, 0, 0]],
    [season - 1, [1 - f, f, 0]],
    [season - 2, [0, 1 - f, f]],
    [season - 3, [0, 0, 1 - f]],
  ]);
}

/**
 * The window's playing time PER SCHEDULED GAME, each season at its own schedule. Two readings: as observed
 * (a season he did not play is nothing), and with the seasons that are not evidence of his playing time
 * (before the league existed; a season possibly lost to injury) read at the pace of the seasons that are.
 */
export interface UsageWindow {
  observed: [number, number, number];
  read: [number, number, number];
  /** His pace per scheduled game over the evidence seasons; null when none is evidence. */
  pace: number | null;
  notEvidence: Array<{ season: number; reason: string }>;
}

export function usageWindow(
  lines: ProductionLine[], season: number, f: number, gamesOf: (s: number) => number,
  evidence: (s: number, perShare: number, best: number) => string | null,
): UsageWindow {
  const coefficients = windowCoefficients(season, f);
  const opp = new Map<number, number>();
  for (const l of lines) opp.set(l.season, (opp.get(l.season) ?? 0) + l.opportunities);
  const observed: [number, number, number] = [0, 0, 0];
  const seasons: Array<{ s: number; coef: number[]; share: number; perShare: number }> = [];
  for (const [s, coef] of coefficients) {
    const full = s === season ? f : 1;
    const share = coef.reduce((a, b) => a + b, 0) * full;
    if (share <= 0) continue;
    const perGame = (opp.get(s) ?? 0) / Math.max(gamesOf(s), 1e-9);
    coef.forEach((k, i) => { observed[i] += k * perGame; });
    seasons.push({ s, coef, share, perShare: full > 0 ? perGame / full : 0 });
  }
  const best = Math.max(0, ...seasons.map((x) => x.perShare));
  const notEvidence: UsageWindow['notEvidence'] = [];
  const flagged = new Set<number>();
  for (const x of seasons) {
    const why = evidence(x.s, x.perShare, best);
    if (why) { flagged.add(x.s); notEvidence.push({ season: x.s, reason: why }); }
  }
  const kept = seasons.filter((x) => !flagged.has(x.s));
  const keptShare = kept.reduce((a, x) => a + x.share, 0);
  const pace = keptShare > 0 ? kept.reduce((a, x) => a + x.share * x.perShare, 0) / keptShare : null;
  const read: [number, number, number] = [...observed];
  if (pace !== null) {
    for (const x of seasons) {
      if (!flagged.has(x.s)) continue;
      const full = x.s === season ? f : 1;
      x.coef.forEach((k, i) => { read[i] += k * full * pace - k * full * x.perShare; });
    }
  }
  return { observed, read, pace, notEvidence: pace === null ? [] : notEvidence };
}

export const clean = (lines: ProductionLine[] | undefined): ProductionLine[] =>
  (lines ?? []).filter((l) => Number.isFinite(l.season) && Number.isFinite(l.opportunities) && l.opportunities > 0);

/** The seasons a window reads (a coefficient above zero), with any whose WAR is missing. */
function windowSeasons(lines: ProductionLine[], season: number, f: number): { used: ProductionLine[]; missingWar: number[] } {
  const coefficients = windowCoefficients(season, f);
  const used = lines.filter((l) => (coefficients.get(l.season) ?? [0, 0, 0]).some((k) => k > 0));
  return { used, missingWar: [...new Set(used.filter((l) => l.war === null).map((l) => l.season))].sort() };
}

export const blank = (): WinsBand => ({ low: 0, central: 0, high: 0 });
export const addBands = (a: WinsBand, b: WinsBand): WinsBand => ({ low: a.low + b.low, central: a.central + b.central, high: a.high + b.high });

/** Keep `inner` inside `outer`. */
export const inside = (inner: WinsBand, outer: WinsBand): WinsBand => ({
  low: Math.min(Math.max(inner.low, outer.low), inner.central),
  central: inner.central,
  high: Math.max(Math.min(inner.high, outer.high), inner.central),
});

function proneBandOf(model: ProneModel | null, value: number | null | undefined): number | null {
  if (!model || value === null || value === undefined || !Number.isFinite(value)) return null;
  const i = model.cuts.findIndex((c) => value <= c);
  return i === -1 ? model.cuts.length : i;
}

// ── one side ─────────────────────────────────────────────────────────────────

/** One reading of a season's playing time and wins when he plays. */
export interface SeasonReading {
  chance: number;
  /** Opportunities when he plays, and their spread. */
  m: number;
  sigmaM: number;
  /** Wins when he plays: expectation and spread. */
  mu: number;
  S: number;
  /** The rate when he plays behind it, WAR per 600. */
  g600: number;
  /** The band's shape: this reading from his usage lines alone (the band is this shape, moved to the central). */
  shape?: SeasonReading;
}

/** Where one side's projection comes from, season by season, before the tails turn it into bands. */
export interface SideTrajectory {
  n: number;
  num: number;
  rate: number;
  rateVariance: number;
  usagePerSeason: [number, number, number];
  usageNotEvidence: UsageWindow['notEvidence'];
  toDate: number;
  /** The usage tier the tails are read for: from expected usage only, never from results. */
  tier: number;
  /** The quality tier the tails are read for (0 bottom tenth, 1 middle, 2 top tenth). */
  quality: number;
  /** The projected rate those tiers are read from, WAR per 600. */
  qualityRate: number;
  /** 25 or younger this season (PRODUCTION_POLICY.ageBands[0]): his tails and drift are fitted apart. */
  young: boolean;
  target: number;
  K: number;
  ratingsWeight: number;
  /** Whether the rest of this season was read from this season's own games. */
  inSeasonMeasured: boolean;
  seasons: Array<{
    season: number;
    /** The horizon the per-horizon quantities are read at (the rest of this season: 1 − f). */
    h: number;
    /** Expected opportunities (chance × when he plays) and their band's reading. */
    P: number;
    reading: SeasonReading;
    /** The reading with the seasons not read as evidence taken as observed (the band reaches it); null when none. */
    observedReading: SeasonReading | null;
    /** The rest of this season, not measured: the reading that keeps his pace (the band's high edge reaches it). */
    paceReading: SeasonReading | null;
    /** Rate when he plays this season, per opportunity (age, proneness and selection included). */
    r: number;
    aging: number;
    selection: number;
    central: number;
    /** The widening for unknown proneness, in wins. */
    extra: number;
    /** What is not known about his rate this season, per opportunity: its own uncertainty plus talent drift. */
    rateSd: number;
    rateExtra: number;
    /** The most opportunities the season allows (the save's ceiling × the schedule); null when not measured. */
    ceiling: number | null;
    /** The prior's weight at this horizon (the bands widen by it). */
    priorWeight: number;
  }>;
}

export interface SideContext {
  season: number;
  f: number;
  age: number;
  horizon: number;
  proneness: number | null | undefined;
  schedule?: ScheduleFacts | null;
  inSeason?: InSeasonFacts | null;
  injuredThisSeason?: boolean | null;
  abilityPrior?: AbilityPrior | null;
  abilityUnknownWidening?: number[] | null;
}

/** The schedule a season is read at: its own where the save states it, else this season's, else the model's reference. */
export function scheduleOf(model: ProductionModel, schedule: ScheduleFacts | null | undefined): { now: number | null; of: (s: number) => number } {
  const now = schedule?.games ?? model.referenceGames ?? null;
  return {
    now,
    of: (s) => {
      const g = schedule?.bySeason?.[s];
      return typeof g === 'number' && g > 0 ? g : now ?? 1;
    },
  };
}

/**
 * The central and spread for each season of one side: exported so the fit (playerValueProductionFit.ts)
 * measures its tails on exactly what the projection computes.
 */
export function sideTrajectory(
  side: ProductionSide, kind: ProductionKind, results: ProductionLine[], usageLines: ProductionLine[],
  input: SideContext, model: ProductionModel,
): SideTrajectory {
  const k = model.kinds[kind];
  const group: AgingGroup = side === 'batting' ? 'hitter' : 'pitcher';
  const { season: Y, f, age } = input;
  const w = k.weights;
  const { slots } = windowOf(results, Y, f);
  const usageSlots = windowOf(usageLines, Y, f).slots;
  const pivot = model.usagePivotAge;
  const schedule = scheduleOf(model, input.schedule);
  const G = schedule.now ?? 1;

  // The rate, regressed by sample toward the kind's mean, or (phase 3b) toward what his ratings imply. Until
  // the save measures the ratings as a forecast, they pull the target only by their own weight (B-06): a
  // player whose ratings were set from these results is not regressed toward his results twice.
  const n = slots.reduce((s, x, i) => s + w[i] * x.opportunities, 0);
  const num = slots.reduce((s, x, i) => s + w[i] * x.war, 0);
  const prior = input.abilityPrior && input.abilityPrior.variance600 > 0 && Number.isFinite(input.abilityPrior.rate600) ? input.abilityPrior : null;
  const K = prior ? Math.max(k.stabilization, (k.noise600 * PER) / prior.variance600) : k.stabilization;
  const ratingsWeight = prior ? K / (n + K) : 0;
  const pull = prior && prior.forecast !== true ? ratingsWeight : 1;
  const target = prior ? (k.mean600 + pull * (prior.rate600 - k.mean600)) / PER : k.mean600 / PER;
  const rate = (num + target * K) / (n + K);
  const rateVariance = k.noise600 / PER / (n + K);
  const devShare = k.stabilization / (n + k.stabilization);
  const devVariance = (i: number): number => {
    const v = prior ? prior.pathVariance600[i] : input.abilityUnknownWidening?.[i];
    return v !== undefined && Number.isFinite(v) && v > 0 ? (devShare * v) / (PER * PER) : 0;
  };
  const noise = k.noise600 / PER;
  const scale = k.rateScale600 / PER;

  // Proneness: a band's measured effect shifts the central (playing time only where it was measured); unknown widens
  const prone = model.proneness;
  const band = proneBandOf(prone, input.proneness);
  const usageMultiplier = (h: number): number => {
    if (!prone || band === null || h < 1 || h > PRODUCTION_POLICY.proneness.usageHorizons) return 1;
    return prone.usage[group][band] ?? 1;
  };
  const proneShift = (a: number): number => {
    if (!prone || band === null) return 0;
    const [young, old] = prone.aging[group][band] ?? [0, 0];
    return a < prone.ageSplit ? young : old;
  };
  const unknownProne = prone !== null && band === null;
  const maxUsageEffect = unknownProne ? Math.max(0, ...prone!.usage[group].map((m) => Math.abs(m - 1))) : 0;
  const maxAgingEffect = unknownProne ? Math.max(0, ...prone!.aging[group].flat().map((d) => Math.abs(d))) : 0;

  // Playing time per scheduled game, each season at its own schedule; seasons that are not evidence of his
  // playing time (before the league existed, D-02; possibly lost to injury, owner 2026-09-23) read at his pace
  const firstSeason = input.schedule?.firstSeason ?? null;
  const lostShare = PRODUCTION_POLICY.injury.lostSeasonShare;
  const window = usageWindow(usageLines, Y, f, schedule.of, (s, perShare, best) => {
    if (firstSeason !== null && s < firstSeason) return `the league has no major-league season ${s}: not known, never nothing`;
    if (input.injuredThisSeason === true && best > 0 && perShare < lostShare * best) {
      return `possibly lost to injury (an injury is stated this season): not read as less playing time`;
    }
    return null;
  });
  const U = window.read;
  const Uobs = window.observed;
  const hasObserved = window.notEvidence.length > 0;
  const originAge = age - 1 + f;
  const nU = usageSlots.reduce((s, x, i) => s + w[i] * x.opportunities, 0);
  const numU = usageSlots.reduce((s, x, i) => s + w[i] * x.war, 0);
  const usageRate = (numU + target * K) / (nU + K);
  const agingAt = (i: number, withProneness = true): number => {
    const curve = agingBetween(model.aging[group], model.aging.firstAge, originAge, age + i, withProneness ? proneShift : undefined);
    // The ratings' development path enters with the weight their level does (a same-time rating discounted
    // as B-06 says, the path with it), so a better scouted line never lowers the central
    const pathWeight = ratingsWeight * pull;
    return prior ? pathWeight * (prior.path600[i] ?? 0) + (1 - pathWeight) * curve : curve;
  };
  const qualityAt = (i: number): number => Math.max(0, usageRate * PER + agingAt(i, false));
  // The band's SHAPE is read from his usage lines alone, regressed toward the kind's mean (never the ratings,
  // never proneness): the chance of nothing and where it sits against the wins when he plays. His results and
  // ratings then move the central and widen the spread. On the same playing-time reading, thinner evidence
  // therefore only widens his band, and a measured effect moves it whole (owner, 2026-09-23; D-053). Where the
  // usage lines are his results (always, outside a test), the shape is his own reading exactly.
  const usageRateRef = (numU + (k.mean600 / PER) * k.stabilization) / (nU + k.stabilization);
  const curveAt = (i: number): number => agingBetween(model.aging[group], model.aging.firstAge, originAge, age + i);

  const partsAt = (h: number, slotsU: readonly number[], q: number): { chance: number; perGame: number; spread: number } => {
    const chance = atHorizon(k.horizons, h, (row) => usageParts(row, slotsU, q, originAge, pivot).chance);
    const perGame = atHorizon(k.horizons, h, (row) => usageParts(row, slotsU, q, originAge, pivot).perGame);
    const spread = atHorizon(k.horizons, h, (row) => Math.max(0, (row.playSpread?.base ?? 0) + (row.playSpread?.slope ?? 0) * perGame));
    return { chance, perGame, spread };
  };

  const toDate = results.filter((l) => l.season === Y).reduce((s, l) => s + (l.war ?? 0), 0);
  const first = partsAt(1, U, qualityAt(0));
  const firstSeasonUsage = first.chance * first.perGame;
  const cut = (k.usageCuts ?? []).findIndex((c) => firstSeasonUsage <= c);
  const tier = cut === -1 ? (k.usageCuts ?? []).length : cut;
  const qualityRate = usageRate * PER;
  const quality = !k.qualityCuts ? 1 : qualityRate <= k.qualityCuts[0] ? 0 : qualityRate >= k.qualityCuts[1] ? 2 : 1;
  const measuredContinuation = input.inSeason?.continuation?.[kind];
  const inSeasonMeasured = typeof measuredContinuation === 'number' && Number.isFinite(measuredContinuation) && (input.inSeason?.measuredShare ?? 0) > 0;
  const ceilingPerGame = typeof k.ceiling === 'number' && k.ceiling > 0 ? k.ceiling : null;

  const seasons: SideTrajectory['seasons'] = [];
  for (let i = 0; i < input.horizon; i += 1) {
    const rest = i === 0;
    const hRest = 1 - f;
    const h = rest ? hRest : i + 1 - f;
    const share = rest ? 1 - f : 1;
    const aging = agingAt(i);
    const projected600 = rate * PER + aging;
    const young = age <= PRODUCTION_POLICY.ageBands[0];
    const driftOf = (row: HorizonModel) => (young && typeof row.driftYoung600 === 'number' ? row.driftYoung600 : row.drift600 ?? 0);
    const drift600 = rest ? hRest * Math.max(0, atHorizon(k.horizons, 1, driftOf)) : Math.max(0, atHorizon(k.horizons, h, driftOf));
    const drift = drift600 / (PER * PER) + devVariance(i);
    // The rate of those who play is fitted per horizon on his regressed rate now and his age (the survivors'
    // own aging is in it); only what the curve does not carry (development toward potential, a proneness shift)
    // is added to what it reads
    const beyondCurve = aging - agingBetween(model.aging[group], model.aging.firstAge, originAge, age + i);
    const survivorAt = (hh: number) => atHorizon(k.horizons, hh, (row) => (row.survivor ? survivorRate(row.survivor, rate * PER + beyondCurve, originAge, pivot, (U[0] + U[1] + U[2]) / 3) : projected600));
    // The rest of this season: selection grows from none (now) to a season's (next season), linearly
    const g600 = rest ? projected600 + hRest * (survivorAt(1) - projected600) : survivorAt(h);
    const mult = usageMultiplier(h);
    const years = Math.max(0, age + i - originAge);
    const priorWeight = rest ? atHorizon(k.horizons, 1, (row) => row.priorWeight ?? k.priorWeight ?? 0) : atHorizon(k.horizons, h, (row) => row.priorWeight ?? k.priorWeight ?? 0);
    // Each season at its own schedule where it is known (a backtest's target seasons), else this season's rules
    const Gi = i === 0 ? G : input.schedule?.bySeason?.[Y + i] ?? G;
    const ceiling = ceilingPerGame === null ? null : ceilingPerGame * Gi * share;

    const refProjected = usageRateRef * PER + curveAt(i);
    const refAt = (hh: number) => atHorizon(k.horizons, hh, (row) => (row.survivor ? survivorRate(row.survivor, usageRateRef * PER, originAge, pivot, (U[0] + U[1] + U[2]) / 3) : refProjected));
    const gRef600 = rest ? refProjected + hRest * (refAt(1) - refProjected) : refAt(h);
    const readingOf = (slotsU: readonly number[], chanceOverride?: number, atPace = false, ref = false): SeasonReading => {
      // A player below replacement when he plays gains no playing time from quality: his wins never fall as his line rises
      const g = ref ? gRef600 : g600;
      const q = g >= 0 ? (ref ? Math.max(0, usageRateRef * PER + curveAt(i)) : qualityAt(i)) : 0;
      let chance: number;
      let perGame: number;
      let spread: number;
      if (rest) {
        const at1 = partsAt(1, slotsU, q);
        const pace = slotsU[0];
        // Measured on this season's games, the continuation carries the loss and he plays at his pace when he
        // plays; not measured, his playing time when he plays moves from his pace toward next season's
        perGame = atPace || inSeasonMeasured ? pace : pace + hRest * (at1.perGame - pace);
        spread = Math.max(0, atHorizon(k.horizons, 1, (row) => (row.playSpread?.base ?? 0) + (row.playSpread?.slope ?? 0) * perGame)) * hRest;
        chance = chanceOverride ?? (inSeasonMeasured
          ? Math.min(1, Math.pow(Math.min(1, Math.max(measuredContinuation as number, 0)), hRest / (input.inSeason as InSeasonFacts).measuredShare))
          : 1 - hRest * (1 - at1.chance));
      } else {
        const parts = partsAt(h, slotsU, q);
        chance = chanceOverride ?? parts.chance;
        perGame = parts.perGame;
        spread = parts.spread;
      }
      let m = perGame * Gi * share;
      if (ceiling !== null) m = Math.min(m, ceiling);
      const sigmaM = spread * Gi * share;
      const mu = (m * g * (ref ? 1 : mult)) / PER;
      const S = Math.sqrt(Math.max(0, (m * m + sigmaM * sigmaM) * (rateVariance + drift) + m * noise + sigmaM * sigmaM * scale * scale));
      return { chance, m, sigmaM, mu, S, g600: g };
    };
    // Each reading, and its shape (the same reading from the usage lines alone), with the reading's own spread
    const pair = (slotsU: readonly number[], chanceOverride?: number, atPace = false): SeasonReading => {
      const x = readingOf(slotsU, chanceOverride, atPace);
      return { ...x, shape: { ...readingOf(slotsU, chanceOverride, atPace, true), S: x.S } };
    };
    const reading = pair(U);
    const observedReading = hasObserved ? pair(Uobs) : null;
    const paceReading = rest && !inSeasonMeasured && f > 0 ? pair(U, 1, true) : null;
    const P = reading.chance * reading.m;
    const extra = unknownProne ? P * scale * maxUsageEffect + P * (maxAgingEffect / PER) * years : 0;
    const rateExtra = unknownProne ? (maxAgingEffect / PER) * years : 0;
    seasons.push({
      season: Y + i, h, P, reading, observedReading, paceReading, r: g600 / PER, aging, selection: g600 - projected600,
      central: reading.chance * reading.mu, extra, rateSd: Math.sqrt(rateVariance + drift), rateExtra, ceiling, priorWeight,
    });
  }
  return {
    n, num, rate, rateVariance, usagePerSeason: [U[0] * G, U[1] * G, U[2] * G], usageNotEvidence: window.notEvidence, toDate, tier, quality,
    young: age <= PRODUCTION_POLICY.ageBands[0],
    qualityRate, target, K, ratingsWeight, inSeasonMeasured, seasons,
  };
}

const OUTER_LOW = (1 - PRODUCTION_POLICY.coverage.outer) / 2;
const INNER_LOW = (1 - PRODUCTION_POLICY.coverage.inner) / 2;

/** The standard normal quantile (Acklam's approximation): turns a coverage target into a two-sided multiple. */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628274631];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lowTail = 0.02425;
  if (p < lowTail) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lowTail) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export const Z_OUTER = normalQuantile(0.5 + PRODUCTION_POLICY.coverage.outer / 2);
export const Z_INNER = normalQuantile(0.5 + PRODUCTION_POLICY.coverage.inner / 2);

/** The standard normal distribution at the tail grid: the fallback distribution where a model stores none. */
const NORMAL_GRID = GRID.map((p) => normalQuantile(p));

export interface SeasonBands {
  wins: WinsBand;
  inner: WinsBand;
  usage: WinsBand;
  /** WAR per 600 opportunities, 80% and 50%. */
  rateBand: WinsBand;
  rateInner: WinsBand;
  /** The main reading's point mass at nothing: the probability below it and its size (widened as served). */
  zero: { below: number; mass: number };
  whenPlays: { low80: number; high80: number; low50: number; high50: number; central: number };
}

/** The mixture's four edges for one reading, widened by the prior's weight at its horizon. */
function readingBands(x: SeasonReading, z: readonly number[], widen: number): { low80: number; high80: number; low50: number; high50: number } {
  const S = x.S * widen;
  return {
    low80: mixtureQuantile(x.chance, x.mu, S, z, OUTER_LOW),
    high80: mixtureQuantile(x.chance, x.mu, S, z, 1 - OUTER_LOW),
    low50: mixtureQuantile(x.chance, x.mu, S, z, INNER_LOW),
    high50: mixtureQuantile(x.chance, x.mu, S, z, 1 - INNER_LOW),
  };
}

/**
 * The bands along a side's trajectory, season by season (owner, 2026-09-23). The RATE band (what is
 * not known about his rate, its own uncertainty plus talent drift) is never narrower further out: it
 * is carried forward. The WINS band is the mixture of no playing time and the wins when he plays, each
 * season's own, so it follows his expected playing time down as it fades. `upTo` stops early.
 */
export function bandsAlong(tr: SideTrajectory, k: KindModel, upTo = tr.seasons.length): SeasonBands[] {
  const out: SeasonBands[] = [];
  let sd = 0;
  let extra = 0;
  for (let i = 0; i < Math.min(upTo, tr.seasons.length); i += 1) {
    const x = tr.seasons[i];
    const widen = 1 + PRODUCTION_POLICY.prior.widening * Math.min(Math.max(x.priorWeight, 0), 1);
    sd = Math.max(sd, x.rateSd * widen);
    extra = Math.max(extra, x.rateExtra);
    const r = x.r * PER;
    const rateBand = { low: r - (Z_OUTER * sd + extra) * PER, central: r, high: r + (Z_OUTER * sd + extra) * PER };
    const rateInner = { low: r - (Z_INNER * sd + extra / 2) * PER, central: r, high: r + (Z_INNER * sd + extra / 2) * PER };

    const hh = Math.max(x.h, 1);
    const cell = (row: HorizonModel): readonly number[] => {
      const c = row.tails?.[tailCell(row.tails.length, tr.tier, tr.quality, tr.young)] ?? row.tails?.[0];
      return Array.isArray(c) && c.length === GRID.length ? c : NORMAL_GRID;
    };
    const z = gridAtHorizon(k.horizons, hh, cell);
    const uz = gridAtHorizon(k.horizons, hh, (row) => (Array.isArray(row.usageZ) && row.usageZ.length === GRID.length ? row.usageZ : NORMAL_GRID));
    // Each reading's band is its shape's mixture, moved to the reading's own central; the high edge is at most
    // the ceiling at the high edge of the rate (a physical limit), applied to the shape before it moves
    const rateHalf = rateBand.high - r;
    // The whole band moves with the main reading's central: each reading's shape by the same amount
    const mainShape = x.reading.shape ?? x.reading;
    const d = x.reading.chance * x.reading.mu - mainShape.chance * mainShape.mu;
    const moved = (y: SeasonReading) => {
      const sh = y.shape ?? y;
      const b = readingBands(sh, z, widen);
      const cap = x.ceiling !== null && sh.g600 + rateHalf > 0 ? (x.ceiling * (sh.g600 + rateHalf)) / PER : Infinity;
      const at = sh.chance * sh.mu;
      return {
        low80: Math.min(b.low80, at) + d, high80: Math.max(Math.min(b.high80, cap), at) + d,
        low50: Math.min(b.low50, at) + d, high50: Math.max(Math.min(b.high50, cap), at) + d,
      };
    };
    const main = moved(x.reading);
    const readings = [main];
    if (x.observedReading) readings.push(moved(x.observedReading));
    if (x.paceReading) readings.push(moved(x.paceReading));
    const central = x.central;
    const lowOuter = Math.min(...readings.map((b) => b.low80), central);
    const highOuter = Math.max(...readings.map((b) => b.high80), central);
    const wins: WinsBand = { low: lowOuter - x.extra, central, high: highOuter + x.extra };
    const inner = inside({
      low: Math.min(main.low50, central) - x.extra / 2,
      central,
      high: Math.max(main.high50, central) + x.extra / 2,
    }, wins);

    // Playing time: the same mixture, at most the ceiling
    const usageOf = (y: SeasonReading, p: number) => Math.max(0, mixtureQuantile(y.chance, y.m, y.sigmaM, uz, p));
    const P = x.P;
    const lowU = Math.min(usageOf(x.reading, OUTER_LOW), ...(x.observedReading ? [usageOf(x.observedReading, OUTER_LOW)] : []), P);
    let highU = Math.max(usageOf(x.reading, 1 - OUTER_LOW), ...(x.paceReading ? [usageOf(x.paceReading, 1 - OUTER_LOW), x.paceReading.m] : []), P);
    if (x.ceiling !== null) highU = Math.max(Math.min(highU, x.ceiling), P);
    const usage: WinsBand = { low: lowU, central: P, high: highU };
    const sh = x.reading.shape ?? x.reading;
    const cz = Math.min(Math.max(sh.chance, 0), 1);
    const zero = { below: sh.S * widen > 0 ? cz * gridCdf(z, -sh.mu / (sh.S * widen)) : cz * (sh.mu < 0 ? 1 : 0), mass: 1 - cz };
    const wp = readingBands({ ...sh, chance: 1 }, z, widen);
    const whenPlays = { low80: wp.low80 + d, high80: wp.high80 + d, low50: wp.low50 + d, high50: wp.high50 + d, central: x.reading.mu };
    out.push({ wins, inner, usage, rateBand, rateInner, zero, whenPlays });
  }
  return out;
}

interface SideResult {
  basis: SideBasis;
  seasons: Array<{ season: number; wins: WinsBand; inner: WinsBand; remaining: WinsBand | null; toDate: number | null; side: SideSeason; notes: string[] }>;
}

function projectSide(
  side: ProductionSide, kind: ProductionKind, results: ProductionLine[], usageLines: ProductionLine[],
  input: SideContext & { injury: InjuryFacts | null }, model: ProductionModel,
): SideResult & { tr: SideTrajectory } {
  const k = model.kinds[kind];
  const { season: Y, f } = input;
  const tr = sideTrajectory(side, kind, results, usageLines, { ...input, injuredThisSeason: input.injury?.injuredThisSeason ?? null }, model);

  const bands = bandsAlong(tr, k);
  const seasons: SideResult['seasons'] = tr.seasons.map((x, i) => {
    const { wins, inner, usage } = bands[i];
    return {
      season: x.season, wins, inner, remaining: i === 0 ? wins : null, toDate: i === 0 ? tr.toDate : null, notes: [],
      side: {
        side, kind, wins, inner, rate: x.r * PER, rateBand: bands[i].rateBand, rateInner: bands[i].rateInner, aging: x.aging,
        selection: x.selection, usage, chance: x.reading.chance, zero: bands[i].zero, whenPlays: bands[i].whenPlays,
      },
    };
  });
  if (tr.usageNotEvidence.length > 0) {
    const lost = tr.usageNotEvidence.filter((x) => /injury/.test(x.reason)).map((x) => x.season);
    const before = tr.usageNotEvidence.filter((x) => !/injury/.test(x.reason)).map((x) => x.season);
    for (const s of seasons.slice(1)) {
      if (lost.length > 0) s.notes.push(`His playing time in ${lost.join(', ')} is read as possibly lost to injury (an injury is stated this season), never as less playing time: the central reads his healthy playing time, and the band reaches the reading with ${lost.length === 1 ? 'that season' : 'those seasons'}.`);
      if (before.length > 0) s.notes.push(`The league has no major-league season ${before.join(', ')}: his playing time there is not known, never nothing; the central reads his pace, the band reaches the reading with nothing.`);
    }
  }
  if (f > 0 && !tr.inSeasonMeasured) {
    seasons[0].notes.push(`How much playing time holds within this season is not measured on this season's games: the rest of ${Y} is read from next season's attrition, scaled to what is left, and keeping his pace is inside the band.`);
  }

  // Stated injuries: known days out come off his playing time (owner, 2026-09-23); always named
  applyInjury(seasons, input.injury, Y, f);
  for (const x of seasons) x.side = { ...x.side, wins: x.wins, inner: x.inner };
  // This season: what he has banked is a fact beside the band for the rest of it
  seasons[0].remaining = seasons[0].wins;
  seasons[0].wins = shift(seasons[0].wins, tr.toDate);
  seasons[0].inner = shift(seasons[0].inner, tr.toDate);
  seasons[0].side = { ...seasons[0].side, wins: seasons[0].wins, inner: seasons[0].inner };

  const coefficients = windowCoefficients(Y, f);
  const w = k.weights;
  const weightOf = (s: number): number => {
    const c = coefficients.get(s) ?? [0, 0, 0];
    return c[0] * w[0] + c[1] * w[1] + c[2] * w[2];
  };
  const bySeason = new Map<number, { opportunities: number; war: number }>();
  for (const l of windowSeasons(results, Y, f).used) {
    const had = bySeason.get(l.season) ?? { opportunities: 0, war: 0 };
    bySeason.set(l.season, { opportunities: had.opportunities + l.opportunities, war: had.war + (l.war ?? 0) });
  }
  return {
    tr,
    basis: {
      side, kind,
      seasons: [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([s, x]) => ({ season: s, ...x, weight: weightOf(s) })),
      opportunities: [...bySeason.values()].reduce((a, x) => a + x.opportunities, 0),
      effectiveSample: tr.n,
      observedRate: tr.n > 0 ? (tr.num / tr.n) * PER : null,
      regressedRate: tr.rate * PER,
      regressionShare: tr.K / (tr.n + tr.K),
      mean: tr.target * PER,
      rateUncertainty: Math.sqrt(tr.rateVariance) * PER,
      usagePerSeason: tr.usagePerSeason,
      usageNotEvidence: tr.usageNotEvidence,
      blend: input.abilityPrior && tr.ratingsWeight > 0
        ? {
          results: tr.n / (tr.n + tr.K), ratings: tr.ratingsWeight, reliabilitySample: tr.K,
          ratingsRate: input.abilityPrior.rate600, resultsRate: tr.n > 0 ? (tr.num / tr.n) * PER : null,
        }
        : null,
    },
    seasons,
  };
}

const shift = (b: WinsBand, d: number): WinsBand => ({ low: b.low + d, central: b.central + d, high: b.high + d });

/**
 * The share of each season's playing time a stated injury takes, from the days out and the calendar
 * (this season from today, the off-season, then each full season). Null where the calendar is not
 * established.
 */
export function injuryShares(days: number, injury: InjuryFacts, f: number, seasons: number): number[] | null {
  const daysLeft = injury.seasonDaysLeft;
  const seasonDays = injury.seasonDays;
  if (seasonDays === null || !(seasonDays > 0)) return null;
  const toOpening = f <= 0 ? Math.max(0, injury.daysToOpening ?? 0) : 0;
  const offseason = injury.offseasonDays;
  const out: number[] = [];
  let d = days - toOpening;
  // This season: what is left of it (a whole season before Opening Day)
  const left = f >= 1 ? 0 : daysLeft !== null && daysLeft > 0 ? daysLeft : f <= 0 ? seasonDays : null;
  if (left === null) return null;
  out.push(left > 0 ? Math.min(1, Math.max(0, d) / left) : 0);
  d -= left;
  for (let i = 1; i < seasons; i += 1) {
    if (d <= 0) { out.push(0); continue; }
    if (offseason === null || offseason === undefined) return out.concat(new Array(seasons - out.length).fill(NaN));
    d -= offseason;
    out.push(d > 0 ? Math.min(1, d / seasonDays) : 0);
    d -= seasonDays;
  }
  return out;
}

function applyInjury(seasons: SideResult['seasons'], injury: InjuryFacts | null, Y: number, f: number): void {
  if (!injury || seasons.length === 0) return;
  // Known days out: the central and the low edge move by the share lost, the high edge (an earlier return) stays
  const take = (i: number, lost: number, note: string) => {
    const x = seasons[i];
    if (!x) return;
    x.notes.push(note);
    if (!(lost > 0)) return;
    const keep = 1 - Math.min(1, lost);
    x.wins = { low: Math.min(x.wins.low, x.wins.low * keep), central: x.wins.central * keep, high: x.wins.high };
    x.inner = { low: Math.min(x.inner.low, x.inner.low * keep), central: x.inner.central * keep, high: Math.max(x.inner.high, x.inner.central * keep) };
    x.inner = inside(x.inner, x.wins);
    const u = x.side.usage;
    x.side = { ...x.side, usage: { low: u.low * keep, central: u.central * keep, high: u.high } };
  };
  // Not established: the central is not moved, and the low edge reaches the rest of the season lost
  const widenOnly = (i: number, note: string) => {
    const x = seasons[i];
    if (!x) return;
    x.notes.push(note);
    x.wins = { ...x.wins, low: Math.min(x.wins.low, 0) };
    x.inner = { ...x.inner, low: Math.min(x.inner.low, 0) };
  };
  if (injury.careerEnding === true) {
    seasons.forEach((_, i) => take(i, 1, 'Career-ending injury stated in the export: every later central is nothing, producing nothing is inside the band, and the high edge is kept.'));
    return;
  }
  if (injury.injured !== true) return;
  const d = injury.daysLeft;
  if (d === null) {
    const why = injury.durationNote ? ` (${injury.durationNote})` : ' (the time out is not exported)';
    widenOnly(0, `Injured; the time out is not established${why}, so the rest of ${Y} may be lost: the band reaches it, the central is not moved.`);
    return;
  }
  const shares = injuryShares(d, injury, f, seasons.length);
  if (shares === null) {
    widenOnly(0, `Injured, ${d} days out, but the season's calendar is not established, so the rest of ${Y} may be lost: the band reaches it, the central is not moved.`);
    return;
  }
  shares.forEach((lost, i) => {
    if (Number.isNaN(lost)) {
      widenOnly(i, `Injured, ${d} days out: whether any fall in ${Y + i} is not established (the off-season's length is not known).`);
      return;
    }
    if (i === 0) {
      take(0, lost, lost > 0
        ? `Injured, ${d} days out: ${Math.round(lost * 100)}% of the rest of ${Y} comes off his expected playing time; the high edge keeps an earlier return.`
        : `Injured, ${d} days out: over before any of ${Y}'s remaining games.`);
    } else if (lost > 0) {
      take(i, lost, `Injured, ${d} days out: about ${Math.round(lost * 100)}% of ${Y + i} comes off his expected playing time; the high edge keeps an earlier return.`);
    }
  });
}

// ── the player ───────────────────────────────────────────────────────────────

export function unknownProduction(input: ProductionInput, reason: string, model: ProductionModel, provenance: ModelProvenance): PlayerProduction {
  return {
    playerId: input.playerId, status: 'unknown', reason, unit: PRODUCTION_UNIT, seasons: [],
    basis: basisShell(input, model, provenance),
  };
}

export function basisShell(input: ProductionInput, model: ProductionModel, provenance: ModelProvenance): ProductionBasis {
  const band = proneBandOf(model.proneness, input.proneness);
  const known = input.proneness !== null && input.proneness !== undefined && Number.isFinite(input.proneness);
  const games = input.schedule?.games ?? null;
  return {
    origin: { season: input.season, seasonPlayed: input.seasonPlayed, age: input.age },
    sides: [],
    notProjected: [],
    proneness: {
      value: known ? input.proneness! : null,
      band,
      note: !model.proneness
        ? 'The fit in use measured no proneness effect, so proneness moves nothing.'
        : !known
          ? 'Injury proneness unknown: the band is widened by the largest effect any proneness band showed, and the central is not moved.'
          : `Injury proneness ${input.proneness} (owner-attested known fact), band ${band! + 1} of ${model.proneness.cuts.length + 1}.`,
    },
    coverage: { outer: PRODUCTION_POLICY.coverage.outer, inner: PRODUCTION_POLICY.coverage.inner },
    schedule: games !== null
      ? { games, note: `Playing time per scheduled game, at ${games} games a season.` }
      : { games: model.referenceGames ?? null, note: `The league's schedule is not stated: playing time is read at the ${model.referenceGames ?? '—'}-game schedule the model was fitted on.` },
    model: provenance,
    calibration: provenance.stamp,
  };
}

export type Estimator = 'results' | 'results_and_ratings' | 'rest_of_season';

/**
 * The coverage a season carries: its targets, and what the fit in force observed for THIS estimator at this
 * horizon (interpolated between two measured horizons, and named so), or not measured with why.
 */
export function coverageAt(horizon: number, provenance: ModelProvenance, estimator: Estimator = 'results', ratingsWeight = 0): ProductionSeason['coverage'] {
  const target = { outer: PRODUCTION_POLICY.coverage.outer, inner: PRODUCTION_POLICY.coverage.inner };
  const rows = provenance.observed ?? [];
  const at = (h: number) => rows.find((r) => r.horizon === h && r.cases > 0) ?? null;
  const lo = Math.floor(horizon + 1e-9);
  const hi = Math.ceil(horizon - 1e-9);
  const a = at(Math.max(lo, 1));
  const b = at(Math.max(hi, 1));
  let measured: { horizon: number; cases: number; outer: number | null; inner: number | null } | null = null;
  if (a && b) {
    const t = hi === lo ? 0 : horizon - lo;
    const mix = (x: number | null, y: number | null) => (x === null || y === null ? null : (1 - t) * x + t * y);
    measured = { horizon, cases: Math.min(a.cases, b.cases), outer: mix(a.outer, b.outer), inner: mix(a.inner, b.inner) };
  }
  const fmt = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(0)}%`);
  const where = hi === lo ? `horizon ${lo}` : `horizon ${horizon.toFixed(1)} (interpolated between the fit's horizons ${lo} and ${hi})`;
  if (provenance.source === 'fallback_prior') {
    return { horizon, target, observed: null, reference: null, note: 'Not measured on this save: the fallback prior was not tested on its held-out seasons.' };
  }
  if (estimator === 'rest_of_season') {
    return { horizon, target, observed: null, reference: null, note: 'Not measured: the rest of a season under way is not backtested (the fit\'s cases start at a season\'s end).' };
  }
  if (estimator === 'results_and_ratings') {
    return {
      horizon, target, observed: null,
      reference: measured ? { estimator: 'results', ...measured } : null,
      note: `Not measured for a projection that leans on his ratings (${Math.round(ratingsWeight * 100)}% of his rate): the same-time blend cannot be backtested on this save${
        measured ? `; the results-only estimator observed ${fmt(measured.outer)} / ${fmt(measured.inner)} at ${where}` : ''}.`,
    };
  }
  if (!measured) return { horizon, target, observed: null, reference: null, note: `Not measured: the fit had no held-out seasons at ${where}.` };
  return { horizon, target, observed: measured, reference: null, note: `Observed on ${measured.cases} held-out player-seasons of this save at ${where}.` };
}

/** Which sides of a player are projected, and as what: shared by the projection and the fit. */
export type SidePlan =
  | {
    ok: true;
    season: number;
    f: number;
    age: number;
    results: Record<ProductionSide, ProductionLine[]>;
    usage: Record<ProductionSide, ProductionLine[]>;
    sides: Array<{ side: ProductionSide; kind: ProductionKind }>;
    notProjected: ProductionBasis['notProjected'];
  }
  | { ok: false; reason: string; code: 'no_results' | 'missing_input' };

export function planSides(input: ProductionInput): SidePlan {
  if (input.season === null || !Number.isFinite(input.season)) return { ok: false, code: 'missing_input', reason: "This season is not established in the export (the league's season year)." };
  if (input.seasonPlayed === null || !Number.isFinite(input.seasonPlayed)) {
    return { ok: false, code: 'missing_input', reason: 'The share of this season played is not established (standings or schedule length missing, or standings that are not this season\'s), so the window cannot be placed.' };
  }
  if (input.age === null || !Number.isFinite(input.age)) return { ok: false, code: 'missing_input', reason: 'His age is not in the export, so no aging can be applied.' };
  const Y = input.season;
  const f = Math.min(Math.max(input.seasonPlayed, 0), 1);
  const unavailable = input.unavailable ?? {};
  const listedPitcher = input.listed?.position === 1;
  const listedField = input.listed?.position != null && input.listed.position !== 1;
  const pitchingRole = (input.listed?.role ?? 0) > 0;

  // A listed pitcher's side is pitching: a side the export cannot read that is his role leaves him unknown
  if (listedPitcher && unavailable.pitching) return { ok: false, code: 'missing_input', reason: unavailable.pitching };
  if (listedField && !pitchingRole && unavailable.batting) return { ok: false, code: 'missing_input', reason: unavailable.batting };

  const results = { batting: unavailable.batting ? [] : clean(input.batting), pitching: unavailable.pitching ? [] : clean(input.pitching) };
  const usage = {
    batting: unavailable.batting ? [] : input.usage?.batting ? clean(input.usage.batting) : results.batting,
    pitching: unavailable.pitching ? [] : input.usage?.pitching ? clean(input.usage.pitching) : results.pitching,
  };

  const seen: Array<{ side: ProductionSide; n: number }> = [];
  for (const side of ['batting', 'pitching'] as const) {
    const { used, missingWar } = windowSeasons(results[side], Y, f);
    if (missingWar.length > 0) return { ok: false, code: 'missing_input', reason: `The export has no WAR for his ${side} in ${missingWar.join(', ')}, a season the window reads.` };
    const n = windowOf(used, Y, f).slots.reduce((s, x) => s + x.opportunities, 0);
    if (n > 0) seen.push({ side, n });
  }
  const notProjected: ProductionBasis['notProjected'] = [];
  // A listed pitcher's batting is not a role on that side (the export's own position): never a hitter's line
  const eligible = seen.filter((x) => {
    if (x.side === 'batting' && listedPitcher) {
      notProjected.push({ side: 'batting', opportunities: Math.round(x.n), reason: `${Math.round(x.n)} plate appearances in the window, but he is a listed pitcher: his batting is not a hitter's role and is not projected.` });
      return false;
    }
    return true;
  });
  for (const side of ['batting', 'pitching'] as const) {
    if (unavailable[side]) notProjected.push({ side, opportunities: 0, reason: unavailable[side] as string });
  }
  if (eligible.length === 0) {
    const why = Object.values(unavailable).filter(Boolean);
    if (seen.length === 0 && why.length > 0) return { ok: false, code: 'missing_input', reason: why.join(' ') };
    return { ok: false, code: 'no_results', reason: `No major-league results in the projection window (${Y - 3}–${Y}).` };
  }

  // The primary side, and the other only for a two-way player
  eligible.sort((a, b) => b.n - a.n);
  const projected: ProductionSide[] = [eligible[0].side];
  for (const other of eligible.slice(1)) {
    if (other.n >= PRODUCTION_POLICY.twoWayMinimum) projected.push(other.side);
    else notProjected.push({
      side: other.side, opportunities: Math.round(other.n),
      reason: `${Math.round(other.n)} ${other.side === 'batting' ? 'plate appearances' : 'batters faced'} in the window, under the two-way minimum of ${PRODUCTION_POLICY.twoWayMinimum}: not a role on that side.`,
    });
  }

  const sides: Array<{ side: ProductionSide; kind: ProductionKind }> = [];
  for (const side of projected) {
    let kind: ProductionKind = 'hitter';
    if (side === 'pitching') {
      const { slots } = windowOf(results.pitching, Y, f);
      const games = slots.reduce((s, x) => s + x.games, 0);
      if (games <= 0) return { ok: false, code: 'missing_input', reason: 'His pitching games and starts are not exported, so starter or reliever cannot be read.' };
      kind = slots.reduce((s, x) => s + x.starts, 0) / games >= PRODUCTION_POLICY.starterShare ? 'starter' : 'reliever';
    }
    sides.push({ side, kind });
  }
  return { ok: true, season: Y, f, age: input.age, results, usage, sides, notProjected };
}

/**
 * The fallback prior fitted to this league's own WAR scale (D-12): until the save has a fit of its own, a
 * thin record is regressed toward the league's own mean, and the rate spreads scale with its own spread, a
 * plain measurement of the export that needs no backtest. A league's WAR scale is a unit: every term in WAR
 * per 600 (the survivor terms, the aging curve, the quality cuts, the noise and drift) is put in the league's
 * unit by the ratio of its spread to the prior's, and every coefficient ON a rate (playing time's quality
 * term) by its inverse, so the same record in a league at 0.4 of the scale projects 0.4 of the rate on the
 * same playing time. The shape (usage by age and history, tails) stays the prior's. The aging curve is one
 * per group, so a pitcher's is put in the mean of the starter's and the reliever's ratios.
 */
export interface LeagueRateFacts {
  kinds: Partial<Record<ProductionKind, { mean600: number | null; spread600: number | null; opportunities: number; ceiling: number | null }>>;
  /** The spread of rates the prior's own source showed, per kind, to scale against. */
}

export function adaptPriorToLeague(model: ProductionModel, facts: LeagueRateFacts, priorSpread: Partial<Record<ProductionKind, number>>): { model: ProductionModel; note: string | null } {
  const kinds = { ...model.kinds };
  const adapted: string[] = [];
  const ratios: Partial<Record<ProductionKind, number>> = {};
  for (const kind of Object.keys(kinds) as ProductionKind[]) {
    const f = facts.kinds[kind];
    if (!f) continue;
    const k = { ...kinds[kind] };
    if (f.mean600 !== null && Number.isFinite(f.mean600)) {
      k.mean600 = f.mean600;
      adapted.push(`${kind} mean ${f.mean600.toFixed(2)}`);
    }
    const ps = priorSpread[kind];
    if (f.spread600 !== null && Number.isFinite(f.spread600) && f.spread600 > 0 && ps && ps > 0) {
      const r = f.spread600 / ps;
      ratios[kind] = r;
      k.noise600 *= r * r;
      k.rateScale600 *= r;
      if (k.qualityCuts) k.qualityCuts = [k.qualityCuts[0] * r, k.qualityCuts[1] * r];
      k.horizons = k.horizons.map((h) => ({
        ...h,
        chance: { ...h.chance, quality: h.chance.quality / r },
        conditional: { ...h.conditional, quality: h.conditional.quality / r },
        drift600: (h.drift600 ?? 0) * r * r,
        ...(typeof h.driftYoung600 === 'number' ? { driftYoung600: h.driftYoung600 * r * r } : {}),
        // Every additive survivor term is in WAR per 600 (the slope alone is a pure number), so each is in the league's unit (D-12)
        survivor: h.survivor
          ? {
            ...h.survivor, intercept: h.survivor.intercept * r, older: h.survivor.older * r, younger: h.survivor.younger * r,
            ...(typeof h.survivor.usage === 'number' ? { usage: h.survivor.usage * r } : {}),
          }
          : h.survivor,
      }));
    }
    if (f.ceiling !== null && Number.isFinite(f.ceiling) && f.ceiling > 0) k.ceiling = f.ceiling;
    kinds[kind] = k;
  }
  const groupRatio = (ks: ProductionKind[]): number | null => {
    const rs = ks.map((x) => ratios[x]).filter((x): x is number => typeof x === 'number');
    return rs.length === 0 ? null : rs.reduce((a, b) => a + b, 0) / rs.length;
  };
  const rh = groupRatio(['hitter']);
  const rp = groupRatio(['starter', 'reliever']);
  const aging = {
    ...model.aging,
    hitter: rh === null ? model.aging.hitter : model.aging.hitter.map((d) => d * rh),
    pitcher: rp === null ? model.aging.pitcher : model.aging.pitcher.map((d) => d * rp),
  };
  return {
    model: { ...model, kinds, aging },
    note: adapted.length > 0
      ? `rates regressed toward this league's own mean and scaled to its own spread of rates (derived from the export: ${adapted.join(', ')})`
      : null,
  };
}

/**
 * A player's expected production over the horizon, in wins per season, each an 80% and a 50% band
 * with its basis, from the model given (the save's adopted fit, or the fallback prior). Unknown, with
 * the reason, when an input is missing or he has no major-league results in the window.
 */
export function projectProductionWith(input: ProductionInput, model: ProductionModel, provenance: ModelProvenance): PlayerProduction {
  const horizon = Math.min(input.horizon ?? CONTROL_HORIZON_SEASONS, CONTROL_HORIZON_SEASONS);
  const plan = planSides(input);
  if (!plan.ok) return unknownProduction(input, plan.reason, model, provenance);
  const { season: Y, f, age } = plan;
  if (scheduleOf(model, input.schedule).now === null) {
    return unknownProduction(input, "The league's schedule length is not established, so playing time cannot be read per scheduled game.", model, provenance);
  }

  const sides = plan.sides.map(({ side, kind }) => projectSide(side, kind, plan.results[side], plan.usage[side], {
    season: Y, f, age, horizon, proneness: input.proneness, injury: input.injury ?? null,
    schedule: input.schedule ?? null, inSeason: input.inSeason ?? null,
    abilityPrior: input.abilityPrior?.[side] ?? null, abilityUnknownWidening: input.abilityUnknownWidening?.[side] ?? null,
  }, model));

  const ratingsWeight = Math.max(0, ...sides.map((s) => s.tr.ratingsWeight));
  const blended = ratingsWeight > 0;
  const seasons: ProductionSeason[] = [];
  for (let i = 0; i < horizon; i += 1) {
    const parts = sides.map((s) => s.seasons[i]);
    const h = i + 1 - f;
    const estimator: Estimator = i === 0 && f > 0 ? 'rest_of_season' : blended ? 'results_and_ratings' : 'results';
    seasons.push({
      season: Y + i,
      horizon: h,
      age: age + i,
      wins: parts.reduce((b, p) => addBands(b, p.wins), blank()),
      inner: parts.reduce((b, p) => addBands(b, p.inner), blank()),
      toDate: i === 0 ? parts.reduce((s, p) => s + (p.toDate ?? 0), 0) : null,
      remaining: i === 0 ? parts.reduce((b, p) => addBands(b, p.remaining ?? blank()), blank()) : null,
      sides: parts.map((p) => p.side),
      notes: [...new Set(parts.flatMap((p) => p.notes))],
      coverage: coverageAt(h, provenance, estimator, ratingsWeight),
    });
  }
  const basis = basisShell(input, model, provenance);
  basis.sides = sides.map((s) => s.basis);
  basis.notProjected = plan.notProjected;
  basis.source = blended ? 'results_and_ratings' : 'results';
  basis.inSeason = f > 0
    ? sides.every((s) => s.tr.inSeasonMeasured)
      ? { measured: true, note: input.inSeason?.note ?? 'Measured on this season\'s games.' }
      : { measured: false, note: 'Not measured on this season\'s games: next season\'s attrition, scaled to what is left.' }
    : null;
  return { playerId: input.playerId, status: 'projected', reason: null, unit: PRODUCTION_UNIT, seasons, basis };
}
