/**
 * Player Value, concern 3: expected production in wins, for players with a major-league record
 * (phases 3a and 3b; PLAYER_VALUE.md Part 2.3, D-052, D-053).
 *
 * Pure: it is handed a player's major-league lines, his age, the share of this season played, his
 * stated injury facts and injury proneness, and a FITTED MODEL, and opens no table. The model is
 * the save's own fit (`playerValueFitStore.ts`, fitted by `playerValueProductionFit.ts` on the
 * export's history, adopted only through the gate) or, until the save has one, the provisional
 * fallback prior in `playerValueCalibration.ts`. Nothing here holds a fitted number of its own.
 *
 * The unit is the win, in the export's own WAR units (R-4). For each side a player has (batting,
 * pitching; a two-way player has both and they are summed edge with edge):
 *
 *   rate      a recency-weighted rate, WAR per opportunity (plate appearance for a hitter, batter
 *             faced for a pitcher: the opportunity the results engine already counts in), over a
 *             rolling window of three season-lengths ending today. The current partial season is
 *             in it at its own opportunities, so it counts in proportion to its playing time; the
 *             part of the window it does not yet cover is taken from the seasons before. The rate is
 *             regressed toward the fitted mean by sample: (weighted WAR + mean × K) ÷ (weighted
 *             opportunities + K).
 *   aging     the fitted aging curve (hitters and pitchers apart), from his age at the window's end
 *             to his age in each season, plus the proneness shift where the fit found one.
 *   usage     expected opportunities per season from observed usage, his projected quality and his
 *             age (the chance he plays at all × his playing time when he does), never from a
 *             philosophy, with its own uncertainty.
 *   band      central = rate × usage. The spread S combines what is not known about his rate (which
 *             only grows as results thin: noise ÷ (sample + K)), the drift of true talent that no
 *             sample removes, season noise, and the usage uncertainty; the fitted tails turn S into an
 *             80% and a 50% band per horizon season.
 *
 * Phase 3b hands in what the scouted ratings say about his rate AS NUMBERS ONLY (`AbilityPrior`,
 * built by `playerValueRatings.ts` from the adapter's evidence): the rate is then regressed toward the
 * ratings-implied rate instead of the kind's mean, with reliability weights (results n ÷ (n + K),
 * ratings K ÷ (n + K), K never below the kind's own), so a thin record leans on the ratings and a full
 * one is effectively the results alone. This module still reads no rating and names no rating column.
 *
 * Invariants held by construction (tests/playerValueProduction.test.ts): the rate band is never
 * narrower further out, while the wins band follows expected playing time (owner, 2026-09-23); on
 * the same expected usage, fewer results never narrow a
 * band; a better line never lowers the central or an edge; the 50% band sits inside the 80% band;
 * proneness and stated injuries only widen; a missing input is unknown, never a midpoint; nothing
 * here knows which club holds the player.
 */

import type { CalibrationStamp } from './calibration.js';
import { CONTROL_HORIZON_SEASONS, PRODUCTION_POLICY } from './playerValueCalibration.js';

// ── the model a fit produces (stored per save as JSON) ───────────────────────

export type ProductionSide = 'batting' | 'pitching';
export type ProductionKind = 'hitter' | 'starter' | 'reliever';
export type AgingGroup = 'hitter' | 'pitcher';

/** Band tails, as multiples of the spread S: the edges are central − low × S and central + high × S. */
export interface BandTails {
  low80: number;
  high80: number;
  low50: number;
  high50: number;
}

/**
 * A linear predictor of playing time: intercept + recent · [slot 0, 1, 2] (his observed opportunities in
 * the window's three slots) + quality · q (his projected rate above replacement, WAR per 600, never below
 * zero) + older · (age − pivot)⁺ + younger · (pivot − age)⁺. The coefficients on usage and on quality are
 * never negative: more observed playing time, or a better player, never lowers expected playing time.
 */
export interface UsageTerms {
  intercept: number;
  recent: [number, number, number];
  quality: number;
  older: number;
  younger: number;
}

export interface HorizonModel {
  /**
   * Expected opportunities at this horizon = the chance of any major-league playing time (a logistic in
   * `chance`: attrition, conditional on usage, quality and age) × the opportunities he gets when he plays
   * (`conditional`). A better player is expected to keep more of his playing time.
   */
  chance: UsageTerms;
  conditional: UsageTerms;
  /** The usage scale: base + slope × expected opportunities (base ≥ 0, so thinner usage is relatively wider). */
  usageSpread: { base: number; slope: number };
  /** The usage band's tails, as multiples of the usage scale (80%). */
  usageTails: { low: number; high: number };
  /**
   * The band's tails for each cell of quality tier × usage tier (`tailCell`): quality is the bottom
   * tenth, the middle or the top tenth of projected rate (`KindModel.qualityCuts`), usage the thirds of
   * expected first-season usage (`KindModel.usageCuts`). A model with one row per usage tier only (made
   * before quality tiers) is read by usage tier.
   */
  tails: BandTails[];
  /**
   * Drift: the variance of a player's true rate that no sample removes (talent changing from season
   * to season), (WAR per 600)², by horizon. It scales with usage squared, so a regular's band is as
   * wide as his playing time makes his wins uncertain.
   */
  drift600: number;
  /** Backtest cases behind this horizon (training), for the record and the prior's weight. */
  cases: number;
}

export interface KindModel {
  /** Recency weights of the window's three slots, the most recent first, relative to it (the first is 1). */
  weights: [number, number, number];
  /** The regression's K, in weighted opportunities: the sample at which results and the mean count equally. */
  stabilization: number;
  /** The mean results are regressed toward, WAR per 600 opportunities. */
  mean600: number;
  /** Season noise: the variance of WAR over 600 opportunities around a player's true rate (WAR²). */
  noise600: number;
  /** A typical rate's size, WAR per 600, that turns usage uncertainty into wins without reading his own line. */
  rateScale600: number;
  /** Horizon seasons 1..H, from the window's end. */
  horizons: HorizonModel[];
  /**
   * Expected full-season usage at horizon 1 that separates the usage tiers the tails are set for
   * (ascending; tier i holds usage up to cuts[i], the last tier everything above).
   */
  usageCuts: number[];
  /** Projected rate (WAR per 600) at the bottom and top tenth among the kind's training cases: the quality tiers of the tails. */
  qualityCuts?: [number, number];
  /**
   * The fallback prior's share of this kind's fit (1 for the prior itself). The bands are served
   * wider by it (PRODUCTION_POLICY.prior.widening): thin history on this save is thinner evidence.
   */
  priorWeight: number;
}

export interface ProneModel {
  /** Band cut points on the save's proneness scale: band i holds values ≤ cuts[i]; the last band everything above. */
  cuts: number[];
  /** Usage multiplier per band (1 where the fit found no effect), hitters and pitchers apart. */
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
  /** Days out, as exported (the larger of the injury and injured-list figures). */
  daysLeft: number | null;
  careerEnding: boolean | null;
  /** Days left in this season's calendar, and in a full season, measured from the save; null when not established. */
  seasonDaysLeft: number | null;
  seasonDays: number | null;
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
  /**
   * Phase 3b: what his scouted ratings say about a side's rate, as numbers (`AbilityPrior`), keyed by
   * side (the side his ratings describe). Absent: the results alone, as phase 3a.
   */
  abilityPrior?: Partial<Record<ProductionSide, AbilityPrior>> | null;
  /**
   * Phase 3b: his ability evidence for a side is unknown, so the development the save shows at his age
   * is not known either; per season, the rate variance ((WAR per 600)²) to widen by. Absent: none.
   */
  abilityUnknownWidening?: Partial<Record<ProductionSide, number[]>> | null;
}

/**
 * What the scouted ratings say about a player's rate, as numbers only (phase 3b). Built from the
 * adapter's evidence by `playerValueRatings.ts`; this module never sees a rating.
 */
export interface AbilityPrior {
  /** The rate his current ratings imply, WAR per 600 opportunities. */
  rate600: number;
  /** What is not known about his true rate given those ratings, (WAR per 600)²: the reliability of the ratings. */
  variance600: number;
  /** Per season of the horizon (0 = this one): the change his development and decline imply, WAR per 600. */
  path600: number[];
  /** Per season: the variance of that change, (WAR per 600)². */
  pathVariance600: number[];
}

/** How results and ratings were weighed for a side (phase 3b): shown in the basis, the two weights sum to one. */
export interface BlendBasis {
  /** n ÷ (n + K): how much of the rate is his own results. */
  results: number;
  /** K ÷ (n + K): how much is the ratings-implied rate. */
  ratings: number;
  /** K, in weighted opportunities: the sample at which his results and his ratings count equally (never below the kind's own K). */
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
  /** WAR per 600 opportunities in this season, the age and proneness adjustment included. */
  rate: number;
  /** The rate's 80% and 50% bands, WAR per 600: never narrower further out. */
  rateBand: WinsBand;
  rateInner: WinsBand;
  /** The age adjustment to the rate so far, WAR per 600 (with the proneness shift). */
  aging: number;
  /** Expected opportunities, with the usage band (80%). */
  usage: WinsBand;
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
  /** The bands' coverage targets and what the fit in force observed at this horizon on held-out seasons. */
  coverage: {
    horizon: number;
    target: { outer: number; inner: number };
    observed: { horizon: number; cases: number; outer: number | null; inner: number | null } | null;
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
  /** Observed usage per season-length in the window's three slots, the most recent first. */
  usagePerSeason: [number, number, number];
  /** Phase 3b: how his results and his ratings were weighed; null when no ability evidence entered. */
  blend?: BlendBasis | null;
}

/** What the scouted ratings contributed (phase 3b), or why they could not. */
export interface AbilityBasis {
  status: 'used' | 'unknown';
  /** Why the ability component is unknown; null when used. */
  reason: string | null;
  /** The adapter's evidence status and what it lacks (D-017, D-018). */
  evidence: { status: 'complete' | 'partial' | 'unknown'; missing: string[]; provenance: string; verification: string };
  /** Which form of the mapping was used: every component, or without the glove or the running a player lacks. */
  variant: string | null;
  /** A hitter's bat: his rating splits weighted by how often his hand faces left-handers on this save, or his overall tools. */
  bat: 'splits' | 'overall' | null;
  /** The rate his current ratings imply, and his potential ratings, WAR per 600; null when not established. */
  currentRate: number | null;
  potentialRate: number | null;
  /** What is not known about his true rate given the ratings (a standard deviation, WAR per 600). */
  uncertainty: number | null;
  /** Where that uncertainty comes from: measured on the save's rating snapshots as a forecast, or the kind's own K. */
  reliability: 'save_snapshots' | 'kind_K' | null;
  /** The development path toward his potential: its source and, per season, the share of the gap closed (80% range and central). */
  development: {
    source: 'save_fit' | 'fallback_prior' | 'unknown';
    label: string;
    path: Array<{ season: number; low: number; central: number; high: number }>;
  } | null;
  /** The ratings model in force, with its stamp. */
  model: ModelProvenance;
  /** The same-time caveat: ratings observed now against rates observed around now describe, they do not forecast. */
  caveat: string;
}

/** Where a player not yet in the majors gets his expected playing time (phase 3b). */
export interface ArrivalBasis {
  level: number | null;
  age: number | null;
  /** The save's own history of players at his level and age: the age band and how many player-seasons it holds. */
  band: { ageFrom: number; ageTo: number; cases: number } | null;
  /** Per season: his chance of any major-league playing time, and the playing time expected. */
  seasons: Array<{ season: number; chance: number; expected: number }>;
  /** Whether the chance is conditioned on his potential (the save's own rating snapshots) or on level and age alone. */
  conditioned: 'level_and_age' | 'level_age_and_potential';
  note: string;
}

export interface ProductionBasis {
  origin: { season: number | null; seasonPlayed: number | null; age: number | null };
  /** What the projection rests on: major-league results, results blended with ratings, or ratings alone (phase 3b). */
  source?: 'results' | 'results_and_ratings' | 'ratings';
  /** Phase 3b: the ability component, used or unknown with why. */
  ability?: AbilityBasis | null;
  /** Phase 3b: a player not yet in the majors, his expected playing time from the save's history. */
  arrival?: ArrivalBasis | null;
  sides: SideBasis[];
  /** A side with some results that was not projected, and why (under the two-way minimum). */
  notProjected: Array<{ side: ProductionSide; opportunities: number; reason: string }>;
  proneness: { value: number | null; band: number | null; note: string };
  coverage: { outer: number; inner: number };
  model: ModelProvenance;
  /** The stamp the projection carries: the save's fit's run record, or the prior's provisional stamp. */
  calibration: CalibrationStamp;
}

export interface PlayerProduction {
  playerId: number;
  status: 'projected' | 'unknown';
  /** Why production is unknown; null when projected. */
  reason: string | null;
  unit: string;
  seasons: ProductionSeason[];
  basis: ProductionBasis;
}

export const PRODUCTION_UNIT = "wins above replacement, in the export's own WAR units";

// ── arithmetic ───────────────────────────────────────────────────────────────

const PER = PRODUCTION_POLICY.rateUnitOpportunities;

/** A per-horizon quantity at a fractional horizon, linear between whole seasons, held at the ends. */
export function atHorizon<T>(rows: T[], h: number, read: (row: T) => number): number {
  const last = rows.length;
  const x = Math.min(Math.max(h, 1), last);
  const lo = Math.floor(x);
  const hi = Math.min(Math.ceil(x), last);
  const t = x - lo;
  return (1 - t) * read(rows[lo - 1]) + t * read(rows[hi - 1]);
}

const usageTerms = (t: UsageTerms, U: readonly number[], q: number, originAge: number, pivot: number): number =>
  t.intercept + t.recent[0] * U[0] + t.recent[1] * U[1] + t.recent[2] * U[2] + t.quality * q
  + t.older * Math.max(0, originAge - pivot) + t.younger * Math.max(0, pivot - originAge);

/** Expected opportunities at a horizon: the chance of any playing time × the playing time when he plays. */
export function expectedUsage(row: HorizonModel, U: readonly number[], q: number, originAge: number, pivot: number): number {
  const z = Math.min(Math.max(usageTerms(row.chance, U, q, originAge, pivot), -30), 30);
  return (1 / (1 + Math.exp(-z))) * Math.max(0, usageTerms(row.conditional, U, q, originAge, pivot));
}

/** Quality tiers of the band's tails: the bottom tenth of projected rate, the middle, the top tenth. */
export const QUALITY_TIERS = PRODUCTION_POLICY.qualityTiers.edges.length + 1;

/** Which of a horizon's tails applies: quality × usage cells, or usage tier alone in a model without quality tiers. */
export function tailCell(available: number, usageTier: number, qualityTier: number): number {
  const tiers = PRODUCTION_POLICY.usageTiers;
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
  // Which seasons feed which slot, and by how much
  const coefficients = new Map<number, number[]>([
    [season, [1, 0, 0]],
    [season - 1, [1 - f, f, 0]],
    [season - 2, [0, 1 - f, f]],
    [season - 3, [0, 0, 1 - f]],
  ]);
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

export const clean = (lines: ProductionLine[] | undefined): ProductionLine[] =>
  (lines ?? []).filter((l) => Number.isFinite(l.season) && Number.isFinite(l.opportunities) && l.opportunities > 0);

/** The seasons a window reads (a coefficient above zero), with any whose WAR is missing. */
function windowSeasons(lines: ProductionLine[], season: number, f: number): { used: ProductionLine[]; missingWar: number[] } {
  const { coefficients } = windowOf([], season, f);
  const used = lines.filter((l) => (coefficients.get(l.season) ?? [0, 0, 0]).some((k) => k > 0));
  return { used, missingWar: [...new Set(used.filter((l) => l.war === null).map((l) => l.season))].sort() };
}

export const blank = (): WinsBand => ({ low: 0, central: 0, high: 0 });
export const addBands = (a: WinsBand, b: WinsBand): WinsBand => ({ low: a.low + b.low, central: a.central + b.central, high: a.high + b.high });
const widthOf = (b: WinsBand): number => b.high - b.low;

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

/** Where one side's projection comes from, season by season, before the tails turn it into bands. */
export interface SideTrajectory {
  n: number;
  num: number;
  rate: number;
  rateVariance: number;
  usagePerSeason: [number, number, number];
  toDate: number;
  /** The usage tier the tails are read for: from expected usage only, never from results. */
  tier: number;
  /** The quality tier the tails are read for (0 bottom tenth, 1 middle, 2 top tenth): from the usage lines, like usage. */
  quality: number;
  /** The projected rate those tiers are read from, WAR per 600. */
  qualityRate: number;
  /** The rate regressed toward (the ratings-implied rate, or the kind's mean), per opportunity, and the K it was regressed with. */
  target: number;
  K: number;
  /** Phase 3b: the ratings' weight in the rate (0 without an ability prior). */
  ratingsWeight: number;
  seasons: Array<{
    season: number;
    /** The horizon the per-horizon quantities are read at (at least 1). */
    h: number;
    P: number;
    sigmaP: number;
    /** Rate this season, the age and proneness adjustment included, per opportunity. */
    r: number;
    /** The age (and proneness) adjustment so far, WAR per 600. */
    aging: number;
    central: number;
    S: number;
    /** The widening for unknown proneness, in wins. */
    extra: number;
    /** What is not known about his rate this season, per opportunity: its own uncertainty plus talent drift. */
    rateSd: number;
    /** The widening of the rate for unknown proneness, per opportunity. */
    rateExtra: number;
  }>;
}

export interface SideContext {
  season: number;
  f: number;
  age: number;
  horizon: number;
  proneness: number | null | undefined;
  /** Phase 3b: the ratings' view of his rate, as numbers; absent for the results alone. */
  abilityPrior?: AbilityPrior | null;
  /** Phase 3b: ability unknown, so per season the largest development variance the save shows at his age, (WAR per 600)². */
  abilityUnknownWidening?: number[] | null;
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

  // The rate, regressed by sample toward the kind's mean, or (phase 3b) toward what his ratings imply.
  // The ratings' reliability K = noise ÷ (what is not known about his rate given them), never below the
  // kind's own K: ratings are at least the evidence the kind's mean is. Results weigh n ÷ (n + K).
  const n = slots.reduce((s, x, i) => s + w[i] * x.opportunities, 0);
  const num = slots.reduce((s, x, i) => s + w[i] * x.war, 0);
  const prior = input.abilityPrior && input.abilityPrior.variance600 > 0 && Number.isFinite(input.abilityPrior.rate600) ? input.abilityPrior : null;
  const K = prior ? Math.max(k.stabilization, (k.noise600 * PER) / prior.variance600) : k.stabilization;
  const target = prior ? prior.rate600 / PER : k.mean600 / PER;
  const rate = (num + target * K) / (n + K);
  const rateVariance = k.noise600 / PER / (n + K);
  const ratingsWeight = prior ? K / (n + K) : 0;
  // The development term (the ratings' path, or the largest the save shows when ability is unknown) is
  // weighed by the kind's own prior share, K₀ ÷ (n + K₀): it never depends on how complete the ratings
  // are, so thinner ratings, or none, never narrow the band.
  const devShare = k.stabilization / (n + k.stabilization);
  const devVariance = (i: number): number => {
    const v = prior ? prior.pathVariance600[i] : input.abilityUnknownWidening?.[i];
    return v !== undefined && Number.isFinite(v) && v > 0 ? (devShare * v) / (PER * PER) : 0;
  };
  const noise = k.noise600 / PER;
  const scale = k.rateScale600 / PER;

  // Proneness: a band's measured effect shifts the central; unknown proneness widens by every band's effect
  const prone = model.proneness;
  const band = proneBandOf(prone, input.proneness);
  const usageMultiplier = prone && band !== null ? prone.usage[group][band] ?? 1 : 1;
  const proneShift = (a: number): number => {
    if (!prone || band === null) return 0;
    const [young, old] = prone.aging[group][band] ?? [0, 0];
    return a < prone.ageSplit ? young : old;
  };
  const unknownProne = prone !== null && band === null;
  const maxUsageEffect = unknownProne ? Math.max(0, ...prone!.usage[group].map((m) => Math.abs(m - 1))) : 0;
  const maxAgingEffect = unknownProne ? Math.max(0, ...prone!.aging[group].flat().map((d) => Math.abs(d))) : 0;

  const U: [number, number, number] = [usageSlots[0].opportunities, usageSlots[1].opportunities, usageSlots[2].opportunities];
  const originAge = age - 1 + f;
  // Quality for playing time is read from the lines playing time is read from (normally the same lines),
  // regressed the same way: a better player keeps more of his playing time, a replacement-level one loses
  // it. Only his rate above replacement counts (quality ≥ 0), so a better line never lowers expected wins.
  const nU = usageSlots.reduce((s, x, i) => s + w[i] * x.opportunities, 0);
  const numU = usageSlots.reduce((s, x, i) => s + w[i] * x.war, 0);
  const usageRate = (numU + target * K) / (nU + K);
  const usageAt = (q: number) => (row: HorizonModel): number => expectedUsage(row, U, q, originAge, model.usagePivotAge);
  const spreadAt = (q: number) => (row: HorizonModel): number => Math.max(0, row.usageSpread.base + row.usageSpread.slope * usageAt(q)(row));
  const agingAt = (i: number, withProneness = true): number => {
    const curve = agingBetween(model.aging[group], model.aging.firstAge, originAge, age + i, withProneness ? proneShift : undefined);
    // Phase 3b: the ratings' path (development toward potential, then decline) in proportion to their weight
    return prior ? ratingsWeight * (prior.path600[i] ?? 0) + (1 - ratingsWeight) * curve : curve;
  };
  // Proneness moves the central only (its measured effect), never the playing time the band is built on
  const qualityAt = (i: number): number => Math.max(0, usageRate * PER + agingAt(i, false));

  const toDate = results.filter((l) => l.season === Y).reduce((s, l) => s + (l.war ?? 0), 0);
  const firstSeason = atHorizon(k.horizons, 1, usageAt(qualityAt(0)));
  const cut = (k.usageCuts ?? []).findIndex((c) => firstSeason <= c);
  const tier = cut === -1 ? (k.usageCuts ?? []).length : cut;
  const qualityRate = usageRate * PER;
  const quality = !k.qualityCuts ? 1 : qualityRate <= k.qualityCuts[0] ? 0 : qualityRate >= k.qualityCuts[1] ? 2 : 1;
  const seasons: SideTrajectory['seasons'] = [];
  const point = (h: number, share: number, i: number) => {
    const q = qualityAt(i);
    const P = atHorizon(k.horizons, h, usageAt(q)) * share;
    const sigmaP = atHorizon(k.horizons, h, spreadAt(q)) * share;
    const aging = agingAt(i);
    const r = rate + aging / PER;
    const drift = Math.max(0, atHorizon(k.horizons, h, (row) => row.drift600 ?? 0)) / (PER * PER) + devVariance(i);
    const S = Math.sqrt(Math.max(0, (P * P + sigmaP * sigmaP) * (rateVariance + drift) + P * noise + sigmaP * sigmaP * scale * scale));
    const years = Math.max(0, age + i - originAge);
    const extra = unknownProne ? P * scale * maxUsageEffect + P * (maxAgingEffect / PER) * years : 0;
    const rateExtra = unknownProne ? (maxAgingEffect / PER) * years : 0;
    return { h, P, sigmaP, r, aging, central: r * P * usageMultiplier, S, extra, rateSd: Math.sqrt(rateVariance + drift), rateExtra };
  };
  for (let i = 0; i < input.horizon; i += 1) {
    // This season: the rest of it
    seasons.push({ season: Y + i, ...point(Math.max(i + 1 - f, 1), i === 0 ? 1 - f : 1, i) });
  }
  return { n, num, rate, rateVariance, usagePerSeason: U, toDate, tier, quality, qualityRate, target, K, ratingsWeight, seasons };
}

/** The bands from a trajectory: the tails at each season's horizon, unknown proneness added outside. */
export function bandsOf(tr: SideTrajectory['seasons'][number], k: KindModel, tier: number, quality = 1): { wins: WinsBand; inner: WinsBand; usage: WinsBand } {
  const widen = 1 + PRODUCTION_POLICY.prior.widening * Math.min(Math.max(k.priorWeight ?? 0, 0), 1);
  const t = (key: keyof BandTails) => widen * atHorizon(k.horizons, tr.h, (row) => (row.tails[tailCell(row.tails.length, tier, quality)] ?? row.tails[0])[key]);
  const u = (key: 'low' | 'high') => atHorizon(k.horizons, tr.h, (row) => row.usageTails[key]);
  const wins: WinsBand = { low: tr.central - t('low80') * tr.S - tr.extra, central: tr.central, high: tr.central + t('high80') * tr.S + tr.extra };
  const inner = inside({ low: tr.central - t('low50') * tr.S - tr.extra / 2, central: tr.central, high: tr.central + t('high50') * tr.S + tr.extra / 2 }, wins);
  const usage: WinsBand = { low: Math.max(0, tr.P - u('low') * tr.sigmaP), central: tr.P, high: tr.P + u('high') * tr.sigmaP };
  return { wins, inner, usage };
}

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

export interface SeasonBands {
  wins: WinsBand;
  inner: WinsBand;
  usage: WinsBand;
  /** WAR per 600 opportunities, 80% and 50%. */
  rateBand: WinsBand;
  rateInner: WinsBand;
}

/**
 * The bands along a side's trajectory, season by season (owner, 2026-09-23). The RATE band (what is
 * not known about his rate, its own uncertainty plus talent drift) is never narrower further out: it
 * is carried forward. The WINS band is rate × expected playing time with the playing-time uncertainty,
 * each season's own, so it follows his expected playing time down as it fades. `upTo` stops early.
 */
export function bandsAlong(tr: SideTrajectory, k: KindModel, upTo = tr.seasons.length): SeasonBands[] {
  const out: SeasonBands[] = [];
  const widen = 1 + PRODUCTION_POLICY.prior.widening * Math.min(Math.max(k.priorWeight ?? 0, 0), 1);
  let sd = 0;
  let extra = 0;
  for (let i = 0; i < Math.min(upTo, tr.seasons.length); i += 1) {
    const x = tr.seasons[i];
    const b = bandsOf(x, k, tr.tier, tr.quality);
    sd = Math.max(sd, x.rateSd * widen);
    extra = Math.max(extra, x.rateExtra);
    const r = x.r * PER;
    const rateBand = { low: r - (Z_OUTER * sd + extra) * PER, central: r, high: r + (Z_OUTER * sd + extra) * PER };
    const rateInner = { low: r - (Z_INNER * sd + extra / 2) * PER, central: r, high: r + (Z_INNER * sd + extra / 2) * PER };
    out.push({ ...b, rateBand, rateInner });
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
): SideResult {
  const k = model.kinds[kind];
  const { season: Y, f } = input;
  const tr = sideTrajectory(side, kind, results, usageLines, input, model);

  const bands = bandsAlong(tr, k);
  const seasons: SideResult['seasons'] = tr.seasons.map((x, i) => {
    let { wins, inner } = bands[i];
    const remaining = i === 0 ? wins : null;
    if (i === 0) {
      wins = { low: wins.low + tr.toDate, central: wins.central + tr.toDate, high: wins.high + tr.toDate };
      inner = { low: inner.low + tr.toDate, central: inner.central + tr.toDate, high: inner.high + tr.toDate };
    }
    return {
      season: x.season, wins, inner, remaining, toDate: i === 0 ? tr.toDate : null, notes: [],
      side: { side, kind, wins, inner, rate: x.r * PER, rateBand: bands[i].rateBand, rateInner: bands[i].rateInner, aging: x.aging, usage: bands[i].usage },
    };
  });

  // Stated injuries: only ever a lower low edge
  applyInjury(seasons, input.injury, Y);
  for (const x of seasons) x.side = { ...x.side, wins: x.wins, inner: x.inner };

  const { coefficients } = windowOf([], Y, f);
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
      blend: input.abilityPrior && tr.ratingsWeight > 0
        ? {
          results: tr.n / (tr.n + tr.K), ratings: tr.ratingsWeight, reliabilitySample: tr.K,
          ratingsRate: tr.target * PER, resultsRate: tr.n > 0 ? (tr.num / tr.n) * PER : null,
        }
        : null,
    },
    seasons,
  };
}

function applyInjury(seasons: SideResult['seasons'], injury: InjuryFacts | null, Y: number): void {
  if (!injury || seasons.length === 0) return;
  const lower = (i: number, lost: number, note: string) => {
    const x = seasons[i];
    if (!x || lost <= 0) return;
    const floor = i === 0 ? x.toDate ?? 0 : 0;
    // Missing a share of the season scales what is left of it toward what he has already banked
    const scaled = (b: WinsBand): number => floor + (b.low - floor) * (1 - Math.min(1, lost));
    const low = Math.min(x.wins.low, scaled(x.wins));
    const innerLow = Math.min(x.inner.low, scaled(x.inner));
    if (low < x.wins.low || innerLow < x.inner.low) {
      x.wins = { ...x.wins, low };
      x.inner = { ...x.inner, low: innerLow };
      x.notes.push(note);
    }
  };
  if (injury.careerEnding === true) {
    seasons.forEach((x, i) => {
      const nothing = i === 0 ? x.toDate ?? 0 : 0;
      if (x.wins.low > nothing) x.notes.push('Career-ending injury stated in the export: producing nothing more is inside the band.');
      x.wins = { ...x.wins, low: Math.min(x.wins.low, nothing) };
      x.inner = { ...x.inner, low: Math.min(x.inner.low, nothing) };
    });
  } else if (injury.injured === true) {
    const d = injury.daysLeft;
    if (d === null || injury.seasonDaysLeft === null || injury.seasonDaysLeft <= 0) {
      lower(0, 1, `Injured; ${d === null ? 'the time out is not exported' : `${d} days out, but the season's calendar is not established`}, so the rest of ${Y} may be lost.`);
    } else if (d > 0) {
      lower(0, d / injury.seasonDaysLeft, `Injured, ${d} days out (of ${Math.round(injury.seasonDaysLeft)} left in ${Y}).`);
      const spill = d - injury.seasonDaysLeft;
      if (spill > 0 && injury.seasonDays !== null && injury.seasonDays > 0) {
        lower(1, spill / injury.seasonDays, `Injured, ${d} days out: about ${Math.round(spill)} of them fall in ${Y + 1}.`);
      }
    }
  }
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
    model: provenance,
    calibration: provenance.stamp,
  };
}

export function coverageAt(horizon: number, provenance: ModelProvenance): ProductionSeason['coverage'] {
  const target = { outer: PRODUCTION_POLICY.coverage.outer, inner: PRODUCTION_POLICY.coverage.inner };
  const row = provenance.observed?.find((r) => r.horizon === horizon) ?? null;
  const observed = row && row.cases > 0 ? { horizon, cases: row.cases, outer: row.outer, inner: row.inner } : null;
  return {
    horizon, target, observed,
    note: observed
      ? `Observed on ${row!.cases} held-out player-seasons of this save at horizon ${horizon}.`
      : provenance.source === 'fallback_prior'
        ? 'Not measured on this save: the fallback prior was not tested on its held-out seasons.'
        : `Not measured: the fit had no held-out seasons at horizon ${horizon}.`,
  };
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
    return { ok: false, code: 'missing_input', reason: 'The share of this season played is not established (standings or schedule length missing), so the window cannot be placed.' };
  }
  if (input.age === null || !Number.isFinite(input.age)) return { ok: false, code: 'missing_input', reason: 'His age is not in the export, so no aging can be applied.' };
  const Y = input.season;
  const f = Math.min(Math.max(input.seasonPlayed, 0), 1);

  const results = { batting: clean(input.batting), pitching: clean(input.pitching) };
  const usage = {
    batting: input.usage?.batting ? clean(input.usage.batting) : results.batting,
    pitching: input.usage?.pitching ? clean(input.usage.pitching) : results.pitching,
  };

  // Which sides have results in the window, and is any WAR missing among them
  const seen: Array<{ side: ProductionSide; n: number }> = [];
  for (const side of ['batting', 'pitching'] as const) {
    const { used, missingWar } = windowSeasons(results[side], Y, f);
    if (missingWar.length > 0) return { ok: false, code: 'missing_input', reason: `The export has no WAR for his ${side} in ${missingWar.join(', ')}, a season the window reads.` };
    const n = windowOf(used, Y, f).slots.reduce((s, x) => s + x.opportunities, 0);
    if (n > 0) seen.push({ side, n });
  }
  if (seen.length === 0) {
    return { ok: false, code: 'no_results', reason: `No major-league results in the projection window (${Y - 3}–${Y}).` };
  }

  // The primary side, and the other only for a two-way player
  seen.sort((a, b) => b.n - a.n);
  const projected: ProductionSide[] = [seen[0].side];
  const notProjected: ProductionBasis['notProjected'] = [];
  for (const other of seen.slice(1)) {
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
 * A player's expected production over the horizon, in wins per season, each an 80% and a 50% band
 * with its basis, from the model given (the save's adopted fit, or the fallback prior). Unknown, with
 * the reason, when an input is missing or he has no major-league results in the window (a player
 * without results is projected from his ratings by `playerValueRatings.ts`, phase 3b).
 */
export function projectProductionWith(input: ProductionInput, model: ProductionModel, provenance: ModelProvenance): PlayerProduction {
  const horizon = Math.min(input.horizon ?? CONTROL_HORIZON_SEASONS, CONTROL_HORIZON_SEASONS);
  const plan = planSides(input);
  if (!plan.ok) return unknownProduction(input, plan.reason, model, provenance);
  const { season: Y, f, age } = plan;

  const sides: SideResult[] = plan.sides.map(({ side, kind }) => projectSide(side, kind, plan.results[side], plan.usage[side], {
    season: Y, f, age, horizon, proneness: input.proneness, injury: input.injury ?? null,
    abilityPrior: input.abilityPrior?.[side] ?? null, abilityUnknownWidening: input.abilityUnknownWidening?.[side] ?? null,
  }, model));

  const seasons: ProductionSeason[] = [];
  for (let i = 0; i < horizon; i += 1) {
    const parts = sides.map((s) => s.seasons[i]);
    seasons.push({
      season: Y + i,
      horizon: i + 1 - f,
      age: age + i,
      wins: parts.reduce((b, p) => addBands(b, p.wins), blank()),
      inner: parts.reduce((b, p) => addBands(b, p.inner), blank()),
      toDate: i === 0 ? parts.reduce((s, p) => s + (p.toDate ?? 0), 0) : null,
      remaining: i === 0 ? parts.reduce((b, p) => addBands(b, p.remaining ?? blank()), blank()) : null,
      sides: parts.map((p) => p.side),
      notes: [...new Set(parts.flatMap((p) => p.notes))],
      coverage: coverageAt(i + 1, provenance),
    });
  }
  const basis = basisShell(input, model, provenance);
  basis.sides = sides.map((s) => s.basis);
  basis.notProjected = plan.notProjected;
  basis.source = basis.sides.some((s) => s.blend) ? 'results_and_ratings' : 'results';
  return { playerId: input.playerId, status: 'projected', reason: null, unit: PRODUCTION_UNIT, seasons, basis };
}
