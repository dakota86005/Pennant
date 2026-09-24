/**
 * Player Value, concern 3, phase 3b: the fitting method for the ratings model (D-053, PLAYER_VALUE.md
 * Parts 2.3 and 7).
 *
 * Calibration belongs to the save. Handed the save's own evidence (the adapter's ratings for its major
 * leaguers beside their rates, its minor-league usage history, its persisted rating snapshots), this
 * fits the model `playerValueRatings.ts` projects with, checks it on what it never saw, and says whether
 * it may be adopted. Pure: it opens no table, reads no rating column and writes nothing.
 *
 *   mapping       ratings → rate, cross-sectional: major leaguers with scouted ratings and a meaningful
 *                 rate in the projection window (RATINGS_POLICY.mapping). Weighted least squares, the
 *                 tools' slopes never negative (a better scouted line never lowers the rate); what is not
 *                 known about the true rate given the ratings is measured on held-out players (folds by
 *                 id), net of season noise. A SAME-TIME fit: ratings observed now against rates observed
 *                 around now. It describes what the ratings go with on this save; it is not a forecast,
 *                 and on a historical save the ratings were themselves set from those seasons.
 *   arrival       for players not in the majors: how often players at a level and an age reached the
 *                 majors, and how much they played, h seasons on, from the save's own minor-league usage
 *                 lines (usage only, never minor-league WAR, owner Q-9), recent seasons weighted more and judged
 *                 on rolling origins, each by the method fitted through it (the owner's option C, applied to
 *                 arrivals: hardening F5); the model served is the method refit through the last completed
 *                 season. Longitudinal from
 *                 the stat lines, so it is fitted now. The players called up in their origin season stay in
 *                 the later seasons' cases, kept apart (C-01); another market league's farm is left out and
 *                 any top-level league is arriving (D-07); each cell's players now carry the results fit's
 *                 effect of quality, so a better prospect is likelier to arrive and plays more (C-02).
 *   development   the path from current toward potential needs RATINGS at t against ratings at t + h:
 *                 the save's own rating snapshots. The save's path is fitted from them, automatically,
 *                 once RATINGS_POLICY.longitudinal.minimumPairs pairs a season apart exist; until then
 *                 the provisional prior's path, labelled "not yet calibrated on this save".
 *   potential     the arrival chance split by potential tier needs snapshots at t and outcomes after t:
 *                 likewise fitted only once enough linked player-seasons exist, and used only at two
 *                 standard errors.
 *   gate          the mapping's held-out coverage within the tolerance of both targets, and the arrival
 *                 chance's and expected playing time's held-out calibration within the tolerance at every
 *                 horizon with enough cases, and not biased beyond a share of what happened and three standard
 *                 errors clustered by player and by origin (B-15, a tightening; two-way since F5); arrivals, once
 *                 measured, are adopted only where the next season could be checked (F5, a tightening).
 */

import { CONTROL_HORIZON_SEASONS, PRODUCTION_POLICY, RATINGS_METHOD, RATINGS_POLICY } from './playerValueCalibration.js';
import { Z_INNER, Z_OUTER, type AgingGroup, type ProductionKind, type ProductionModel, type ProductionSide } from './playerValueProduction.js';
import {
  addToCluster, ageOn, blend, nonNegativeLeastSquares, quantile, recencyWeight, rollingOrigins, twoWayClusteredSe,
  type ClusterSums, type FitPlayer, type FitSeason,
} from './playerValueProductionFit.js';
import {
  ARM_TOOLS, BAT_TOOLS, HITTER_VARIANTS, arrivalCellFor, arrivalReading, batNow, hitterRateOf, hitterVariantOf, pitcherKindWithoutMajors,
  pitcherRateOf, rateFromRatings, ratingsPath,
  type ArrivalCell, type ArrivalHorizon, type ArrivalModel, type DevelopmentModel, type HitterRate, type HitterVariant,
  type PitcherRate, type RatingsEvidence, type RatingsModel,
} from './playerValueRatings.js';
import type { HitterTool, PitcherTool } from './scoutedEvidence.js';

const PER = PRODUCTION_POLICY.rateUnitOpportunities;
const H = CONTROL_HORIZON_SEASONS;
const MIN_CASES = PRODUCTION_POLICY.minimumSample.fitCases;
const AGES = RATINGS_POLICY.development.ages;
/** The development band's edges: the 80% central interval's quantiles. */
const EDGE = (1 - PRODUCTION_POLICY.coverage.outer) / 2;

// ── what a ratings fit reads ─────────────────────────────────────────────────

/** A major leaguer in the mapping: his evidence and his window's opportunities and WAR on his side. */
export interface MappingCase {
  playerId: number;
  kind: ProductionKind;
  evidence: RatingsEvidence;
  opportunities: number;
  war: number;
}

/** A player's history for arrival: major-league opportunities by season, minor-league opportunities by season and level. */
export interface ArrivalPlayer {
  playerId: number;
  birth: FitPlayer['birth'];
  side: ProductionSide;
  majors: Map<number, number>;
  minors: Array<{ season: number; level: number; opportunities: number }>;
}

/** One rating snapshot of a player, as the adapter read it back, with the season it falls in. */
export interface Observation {
  playerId: number;
  gameDate: string;
  season: number;
  level: number | null;
  age: number | null;
  group: AgingGroup | null;
  current: number | null;
  potential: number | null;
  /** His current tools as the snapshot recorded them (20-80; null where unknown), and his listed position today. */
  tools?: Partial<Record<HitterTool | PitcherTool, number | null>>;
  position?: number | null;
  /**
   * The share of his season played at the snapshot's date, from the save's own schedule for that season (hardening
   * F5). Null or absent: not established, and the snapshot is read across the whole season (its start to its end).
   */
  seasonPlayed?: number | null;
}

/** A major-league season of a player with snapshots: what followed a snapshot, for the ratings' forecast reliability. */
export interface ForwardSeason {
  playerId: number;
  season: number;
  side: ProductionSide;
  opportunities: number;
  war: number;
  games: number;
  starts: number;
}

export interface RatingsFitInput {
  leagueId: number;
  throughSeason: number;
  seasons: FitSeason[];
  /** The results model in force: season noise and K per kind, the aging curve. */
  production: ProductionModel;
  mapping: MappingCase[];
  /** Plate appearances against left- and right-handers by batting hand, from the league's lines. */
  exposure: Record<'L' | 'R' | 'S', { vsLeft: number; vsRight: number }> | null;
  levels: number[];
  arrival: ArrivalPlayer[];
  /**
   * Every active player's evidence and age: the save's cross-section of scouted gaps. For the arrival cells'
   * players now (hardening F4, C-02): his club's level where his club is one of the league's own (else absent
   * or null), whether he has a major-league line in the window, and his professional pitching (games, starts).
   */
  crossSection: Array<{ evidence: RatingsEvidence; age: number | null; level?: number | null; majors?: boolean; proUsage?: { games: number; starts: number } | null }>;
  /** The league's season and the share of it played now: where the cells' players' projected quality is read. Absent: not read. */
  now?: { season: number; seasonPlayed: number } | null;
  observations: Observation[];
  /** Major-league seasons of the players with snapshots (optional: absent, reliability is not measured). */
  forward?: ForwardSeason[];
}

export interface RatingsFitOptions {
  /** The prior to shrink toward; null fits the save alone (how the fallback prior is made). */
  prior: RatingsModel | null;
  /** False fits on every season (no hold-out, no gate): for making the fallback prior. */
  holdout?: boolean;
  /**
   * The arrival fit's recency half-life in seasons; null weighs every season alike. Absent:
   * RATINGS_POLICY.backtest.recencyHalfLife. For the harness's comparison only.
   */
  recencyHalfLife?: number | null;
}

export interface CoverageSummary { cases: number; outer: number | null; inner: number | null }

export interface ArrivalCheck {
  horizon: number;
  cases: number;
  predicted: number | null;
  observed: number | null;
  predictedMean: number | null;
  observedMean: number | null;
  /**
   * Standard errors of observed − predicted (the chance, and the opportunities per case), clustered by player (hardening
   * F4, B-15) and, since hardening F5, by origin too (two-way).
   */
  chanceSe?: number | null;
  meanSe?: number | null;
  /** The origin cohorts scored at this horizon (hardening F5). */
  origins?: number;
}

export interface RatingsFitRecord {
  id: string;
  leagueId: number;
  throughSeason: number;
  method: string;
  mapping: {
    cases: Record<ProductionKind, number>;
    variants: Record<HitterVariant, number>;
    coverage: { asFitted: CoverageSummary; served: CoverageSummary; byKind: Record<ProductionKind, CoverageSummary> };
    uncertainty: Record<string, number>;
    caveat: string;
  };
  arrival: {
    measured: boolean;
    reason: string;
    window: number[];
    /** The first rolling origin: the earliest season a scored fit runs through. */
    trainingThrough: number | null;
    /** The seasons after the first origin: every season some scored fit never saw. */
    holdout: number[];
    cells: number;
    cases: number;
    heldOut: ArrivalCheck[];
    /**
     * The rolling origins (the owner's option C applied to arrivals, hardening F5): each origin Y is fitted through Y
     * and scored on season Y + 1's minor leaguers (`cohort`), at the horizons its fit rests on enough origin cohorts for.
     */
    scored?: Array<{ origin: number; through: number; cohort: number; cases: number; horizons: number[] }>;
    /** The recency half-life the arrival fits used, seasons; null for none. */
    recencyHalfLife?: number | null;
  };
  development: {
    source: DevelopmentModel['source']; groups: Record<AgingGroup, 'save_fit' | 'fallback_prior'>;
    pairs: number; minimumPairs: number; label: string; crossSectionGap: Record<AgingGroup, Array<[number, number | null]>>;
  };
  arrivalByPotential: { used: boolean; linked: number; minimum: number; findings: string[] };
  reliability: { measured: Record<ProductionKind, number>; minimum: number; note: string };
  staminaCut: { cut: number | null; cases: number; error: number | null };
  leftShare: RatingsModel['leftShare'];
  priorWeight: { overall: number };
  gate: { passed: boolean; reason: string; tolerance: number; minimumCases: number };
  label: string;
}

export interface RatingsFitRun {
  model: RatingsModel;
  record: RatingsFitRecord;
}

const SAME_TIME =
  'Same-time fit: scouted ratings observed now against rates observed in the projection window around now. It describes what the ratings go with on this save; it is not a forecast of what they lead to, and on a historical save the ratings were themselves set from those seasons.';

// ── the mapping ──────────────────────────────────────────────────────────────

interface Row { id: number; y: number; n: number; noise: number; ev: RatingsEvidence }

function rowsOf(input: RatingsFitInput, kind: ProductionKind): Row[] {
  const noise600 = input.production.kinds[kind].noise600;
  return input.mapping
    .filter((c) => c.kind === kind && c.opportunities >= RATINGS_POLICY.mapping.minimumOpportunities && Number.isFinite(c.war))
    .map((c) => ({ id: c.playerId, y: (c.war / c.opportunities) * PER, n: c.opportunities, noise: noise600 * (PER / c.opportunities), ev: c.evidence }));
}

interface Design { columns: string[]; nonNegative: number[]; x: (ev: RatingsEvidence) => number[] | null }

function hitterDesign(rows: Row[], variant: HitterVariant, leftShare: RatingsModel['leftShare']): Design {
  const run = variant === 'full' || variant === 'noGlove';
  const glove = variant === 'full' || variant === 'noRunning';
  // Positions are counted among the players this form can read (a designated hitter shows no glove)
  const readable = rows.filter((r) => batNow(r.ev, leftShare) !== null
    && (!run || typeof r.ev.current.running === 'number') && (!glove || typeof r.ev.current.glove === 'number'));
  const counts = new Map<number, number>();
  for (const r of readable) if (r.ev.position !== null) counts.set(r.ev.position, (counts.get(r.ev.position) ?? 0) + 1);
  const own = [...counts.entries()].filter(([, n]) => n >= RATINGS_POLICY.mapping.positionMinimum).map(([p]) => p).sort((a, b) => a - b);
  const pooled = readable.some((r) => r.ev.position === null || !own.includes(r.ev.position));
  const positions = [...own.map(String), ...(pooled ? ['pooled'] : [])];
  const columns = [...positions.map((p) => `pos:${p}`), ...BAT_TOOLS, ...(run ? ['running'] : []), ...(glove ? ['glove'] : [])];
  const nonNegative = columns.map((c, j) => (c.startsWith('pos:') ? -1 : j)).filter((j) => j >= 0);
  return {
    columns, nonNegative,
    x: (ev) => {
      const bat = batNow(ev, leftShare);
      if (!bat) return null;
      if (run && typeof ev.current.running !== 'number') return null;
      if (glove && typeof ev.current.glove !== 'number') return null;
      const key = ev.position !== null && own.includes(ev.position) ? String(ev.position) : 'pooled';
      return [
        ...positions.map((p) => (p === key ? 1 : 0)),
        ...BAT_TOOLS.map((t) => bat.tools[t]),
        ...(run ? [ev.current.running as number] : []),
        ...(glove ? [ev.current.glove as number] : []),
      ];
    },
  };
}

function pitcherDesign(without: PitcherTool | null = null): Design {
  const tools = ARM_TOOLS.filter((t) => t !== without);
  return {
    columns: ['intercept', ...tools], nonNegative: tools.map((_, j) => j + 1),
    x: (ev) => (tools.every((t) => typeof ev.current[t] === 'number') ? [1, ...tools.map((t) => ev.current[t] as number)] : null),
  };
}

/** Weighted least squares with the noise of each rate: weights 1 ÷ (σ² + noise ÷ n), σ² re-estimated by moments. */
function fitWeighted(xs: number[][], rows: Row[], nonNegative: number[]): { coef: number[]; variance: number } | null {
  if (xs.length <= (xs[0]?.length ?? 0) + 1) return null;
  const mean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  let variance = Math.max(1e-6, rows.reduce((s, r) => s + (r.y - mean) ** 2 - r.noise, 0) / rows.length);
  let coef: number[] | null = null;
  for (let it = 0; it < 4; it += 1) {
    const w = rows.map((r) => 1 / (variance + r.noise));
    coef = nonNegativeLeastSquares(xs, rows.map((r) => r.y), nonNegative, w);
    if (!coef) return null;
    variance = momentVariance(rows, xs.map((x) => dot(coef!, x)));
  }
  return coef ? { coef, variance } : null;
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** σ² of the true rate around the prediction, net of season noise, weighted by opportunities; never below zero. */
function momentVariance(rows: Row[], pred: number[]): number {
  let num = 0;
  let den = 0;
  rows.forEach((r, i) => {
    num += r.n * ((r.y - pred[i]) ** 2 - r.noise);
    den += r.n;
  });
  return den > 0 ? Math.max(0, num / den) : 0;
}

/** A held-out residual: his observed rate less a prediction from a fit that never saw him, with his season noise. */
interface Residual { id: number; e: number; noise: number }

interface MappingFit {
  coef: number[];
  /** The true-rate variance the served bands use: set on the held-out residuals so the 80% band covers its target. */
  variance: number;
  columns: string[];
  cases: number;
  /** Held-out residuals for the rows it could read. */
  residuals: Residual[];
}

/**
 * The true-rate variance (WAR per 600, squared) at which the normal 80% band, with each player's own
 * season noise added, covers the 80% target of these held-out residuals. Rates are heavier-tailed than a
 * normal, so a variance read by moments over-covers; this sets it on coverage, as the results fit sets
 * its tails. Coverage never falls as the variance grows, so a bisection finds it.
 */
function coverageVariance(items: Residual[]): number {
  if (items.length === 0) return 0;
  const target = PRODUCTION_POLICY.coverage.outer;
  const cov = (v: number) => items.filter((x) => Math.abs(x.e) <= Z_OUTER * Math.sqrt(v + x.noise)).length / items.length;
  if (cov(0) >= target) return 0;
  let hi = 1;
  while (cov(hi) < target && hi < 1e6) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (cov(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Fit on some rows, predict others: a column the training rows never use (a position none of them hold) takes the mean of the position intercepts. */
function fitAndPredict(train: Array<{ r: Row; x: number[] }>, test: Array<{ r: Row; x: number[] }>, design: Design, variance: number): Map<number, number> | null {
  const width = design.columns.length;
  const used = Array.from({ length: width }, (_, j) => train.some((u) => u.x[j] !== 0));
  const keep = used.map((u, j) => (u ? j : -1)).filter((j) => j >= 0);
  const w = train.map((u) => 1 / (variance + u.r.noise));
  const nonNegative = design.nonNegative.map((j) => keep.indexOf(j)).filter((j) => j >= 0);
  const c = nonNegativeLeastSquares(train.map((u) => keep.map((j) => u.x[j])), train.map((u) => u.r.y), nonNegative, w);
  if (!c) return null;
  const coef = new Array<number>(width).fill(0);
  keep.forEach((j, i) => { coef[j] = c[i]; });
  const positions = design.columns.map((name, j) => (name.startsWith('pos:') && used[j] ? coef[j] : null)).filter((v): v is number => v !== null);
  const meanPosition = positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : 0;
  design.columns.forEach((name, j) => { if (!used[j] && name.startsWith('pos:')) coef[j] = meanPosition; });
  return new Map(test.map((u) => [u.r.id, dot(coef, u.x)]));
}

function fitMapping(rows: Row[], design: Design): MappingFit | null {
  const usable = rows.map((r) => ({ r, x: design.x(r.ev) })).filter((u): u is { r: Row; x: number[] } => u.x !== null);
  if (usable.length < MIN_CASES) return null;
  const full = fitWeighted(usable.map((u) => u.x), usable.map((u) => u.r), design.nonNegative);
  if (!full) return null;
  // Held out: folds by player id, each predicted by a fit that never saw him
  const residuals: Residual[] = [];
  const folds = RATINGS_POLICY.mapping.folds;
  for (let fold = 0; fold < folds; fold += 1) {
    const train = usable.filter((u) => u.r.id % folds !== fold);
    const test = usable.filter((u) => u.r.id % folds === fold);
    if (test.length === 0) continue;
    const pred = fitAndPredict(train, test, design, full.variance);
    if (!pred) continue;
    for (const u of test) residuals.push({ id: u.r.id, e: u.r.y - (pred.get(u.r.id) as number), noise: u.r.noise });
  }
  return { coef: full.coef, variance: coverageVariance(residuals), columns: design.columns, cases: usable.length, residuals };
}

function hitterRateFrom(fit: MappingFit | null, prior: HitterRate | null, strength: number): HitterRate {
  const n = fit?.cases ?? 0;
  const at = (name: string): number | null => {
    if (!fit) return null;
    const j = fit.columns.indexOf(name);
    return j === -1 ? null : fit.coef[j];
  };
  const intercepts: Record<string, number> = {};
  const names = new Set([...(fit?.columns ?? []).filter((c) => c.startsWith('pos:')).map((c) => c.slice(4)), ...Object.keys(prior?.intercepts ?? {})]);
  for (const p of names) {
    const own = at(`pos:${p}`);
    intercepts[p] = blend(own ?? (p !== 'pooled' ? at('pos:pooled') : null), prior?.intercepts[p] ?? prior?.intercepts.pooled ?? null, n, strength);
  }
  if (intercepts.pooled === undefined) {
    // No pooled cases: the pooled intercept is the positions' own, weighted equally
    const own = Object.values(intercepts);
    intercepts.pooled = own.length > 0 ? own.reduce((a, b) => a + b, 0) / own.length : 0;
  }
  const tools = {} as Record<(typeof BAT_TOOLS)[number], number>;
  for (const t of BAT_TOOLS) tools[t] = Math.max(0, blend(at(t), prior?.tools[t] ?? null, n, strength));
  return {
    intercepts,
    tools,
    running: Math.max(0, blend(at('running') ?? (fit ? 0 : null), prior?.running ?? null, n, strength)),
    glove: Math.max(0, blend(at('glove') ?? (fit ? 0 : null), prior?.glove ?? null, n, strength)),
    variance600: Math.max(0, blend(fit?.variance ?? null, prior?.variance600 ?? null, n, strength)),
    cases: n,
  };
}

function pitcherRateFrom(fit: MappingFit | null, prior: PitcherRate | null, strength: number): PitcherRate {
  const n = fit?.cases ?? 0;
  const tools = {} as Record<(typeof ARM_TOOLS)[number], number>;
  for (const t of ARM_TOOLS) {
    const j = fit ? fit.columns.indexOf(t) : -1;
    // A tool the form leaves out has no slope in it
    tools[t] = fit && j === -1 ? 0 : Math.max(0, blend(fit ? fit.coef[j] : null, prior?.tools[t] ?? null, n, strength));
  }
  return {
    intercept: blend(fit ? fit.coef[0] : null, prior?.intercept ?? null, n, strength),
    tools,
    variance600: Math.max(0, blend(fit?.variance ?? null, prior?.variance600 ?? null, n, strength)),
    cases: n,
  };
}

/** A pitcher mapping and its forms without each tool (never more certain than the full one). */
function pitcherMapping(rows: Row[], prior: PitcherRate | null, strength: number): { rate: PitcherRate; fit: MappingFit | null } {
  const fit = fitMapping(rows, pitcherDesign());
  const rate = pitcherRateFrom(fit, prior, strength);
  const without: Partial<Record<PitcherTool, PitcherRate>> = {};
  for (const t of ARM_TOOLS) {
    const w = pitcherRateFrom(fitMapping(rows, pitcherDesign(t)), prior?.without?.[t] ?? null, strength);
    without[t] = { ...w, tools: { ...w.tools, [t]: 0 }, variance600: Math.max(w.variance600, rate.variance600) };
  }
  return { rate: { ...rate, without }, fit };
}

// ── arrival ──────────────────────────────────────────────────────────────────

interface ArrivalCase {
  side: ProductionSide; level: number; age: number; origin: number; h: number; target: number; outcome: number; playerId: number;
  /** Horizon 1 and later: he reached the majors in his origin season (kept, apart: C-01). */
  up: boolean;
}

function arrivalCases(players: ArrivalPlayer[], levels: number[], window: number[], through: number): ArrivalCase[] {
  const eligible = new Set(window);
  const out: ArrivalCase[] = [];
  for (const p of players) {
    for (const origin of window) {
      // His level that season: where he had the most opportunities on his side
      const here = p.minors.filter((m) => m.season === origin && levels.includes(m.level) && m.opportunities > 0);
      if (here.length === 0) continue;
      const level = here.reduce((a, b) => (b.opportunities > a.opportunities ? b : a)).level;
      const age = ageOn(p.birth, origin);
      if (age === null) continue;
      // Not yet a major leaguer: no major-league line in the two seasons before. A player called up in the
      // origin season stays in the later seasons' cases, marked (hardening F4, C-01): the player projected is
      // not yet called up part-way through his season, so those called up later in theirs are players in his
      // condition; dropping them read his chance as that of players passed over for the whole season
      if ((p.majors.get(origin - 1) ?? 0) > 0 || (p.majors.get(origin - 2) ?? 0) > 0) continue;
      const upThisSeason = (p.majors.get(origin) ?? 0) > 0;
      for (let h = 0; h < H; h += 1) {
        const target = origin + h;
        if (target > through) break;
        if (!eligible.has(target)) continue;
        out.push({ side: p.side, level, age, origin, h, target, outcome: p.majors.get(target) ?? 0, playerId: p.playerId, up: h > 0 && upThisSeason });
      }
    }
  }
  return out;
}

/** An outcome (opportunities in the target season) with its case's recency weight. */
interface Weighted { value: number; w: number }

/**
 * A weighted quantile: linear between the cases' plotting positions, each at the middle of its weight; with
 * equal weights it is exactly `quantile` (the same interpolation).
 */
function weightedQuantile(items: Weighted[], q: number): number | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const first = sorted[0].w / 2;
  const span = sorted.reduce((t, x) => t + x.w, 0) - first - sorted[sorted.length - 1].w / 2;
  if (!(span > 0)) return quantile(sorted.map((x) => x.value), q);
  const target = q * span;
  let before = 0;
  let prev: { pos: number; value: number } | null = null;
  for (const x of sorted) {
    const pos = before + x.w / 2 - first;
    if (pos >= target) {
      if (prev === null || !(pos > prev.pos)) return x.value;
      return prev.value + ((x.value - prev.value) * (target - prev.pos)) / (pos - prev.pos);
    }
    prev = { pos, value: x.value };
    before += x.w;
  }
  return sorted[sorted.length - 1].value;
}

const weightOf = (items: Weighted[]): number => items.reduce((t, x) => t + x.w, 0);

function summarize(outcomes: Weighted[], nodesFrom: Weighted[] | null): ArrivalHorizon {
  const positive = outcomes.filter((o) => o.value > 0);
  const J = RATINGS_POLICY.arrival.nodes;
  // Whether a cell has enough arrivals of its own is a count of cases, never of weight
  const source = positive.length >= RATINGS_POLICY.arrival.minimumArrivals ? positive : nodesFrom ?? positive;
  const nodes = source.length === 0 ? [] : Array.from({ length: J }, (_, j) => weightedQuantile(source, (j + 0.5) / J) as number);
  const sw = weightOf(source);
  const mean = sw > 0 ? source.reduce((t, x) => t + x.w * x.value, 0) / sw : 0;
  const all = weightOf(outcomes);
  return { cases: outcomes.length, chance: all > 0 ? weightOf(positive) / all : 0, mean, nodes };
}

/**
 * The arrival cells on the training cases, each case weighted by its recency (hardening F5): the chance, the
 * playing time and its nodes, and the origin season's call-up share are weighted; the age bands are sized on the
 * cases themselves, so a band holds the policy's player-seasons whatever their weights.
 */
function fitArrival(cases: ArrivalCase[], levels: number[], training: (c: ArrivalCase) => boolean, weight: (c: ArrivalCase) => number): ArrivalModel {
  const cells: ArrivalCell[] = [];
  const W = (c: ArrivalCase): Weighted => ({ value: c.outcome, w: weight(c) });
  for (const side of ['batting', 'pitching'] as const) {
    const sideCases = cases.filter((c) => c.side === side && training(c));
    const sidePositive = Array.from({ length: H }, (_, h) => sideCases.filter((c) => c.h === h && c.outcome > 0).map(W));
    for (const level of levels) {
      const mine = sideCases.filter((c) => c.level === level);
      if (mine.length === 0) continue;
      const byH = Array.from({ length: H }, (_, h) => mine.filter((c) => c.h === h));
      // Age bands, youngest first, each grown until it holds enough player-seasons at horizon 1
      const bandHorizon = byH[1].length > 0 ? 1 : 0;
      const byAge = new Map<number, number>();
      for (const c of byH[bandHorizon]) byAge.set(c.age, (byAge.get(c.age) ?? 0) + 1);
      const ages = [...byAge.keys()].sort((a, b) => a - b);
      const bands: Array<[number, number, number]> = [];
      let from: number | null = null;
      let count = 0;
      for (const a of ages) {
        if (from === null) from = a;
        count += byAge.get(a)!;
        if (count >= RATINGS_POLICY.arrival.bandCases) {
          bands.push([from, a, count]);
          from = null;
          count = 0;
        }
      }
      if (from !== null) {
        if (bands.length > 0) {
          const last = bands[bands.length - 1];
          bands[bands.length - 1] = [last[0], ages[ages.length - 1], last[2] + count];
        } else if (count > 0) bands.push([from, ages[ages.length - 1], count]);
      }
      if (bands.length === 0) continue;
      const levelPositive = byH.map((list) => list.filter((c) => c.outcome > 0).map(W));
      for (const [ageFrom, ageTo, n] of bands) {
        const horizons: Array<ArrivalHorizon | null> = [];
        for (let h = 0; h < H; h += 1) {
          const here = byH[h].filter((c) => c.age >= ageFrom && c.age <= ageTo);
          if (here.length === 0) { horizons.push(null); continue; }
          const fallback = levelPositive[h].length >= RATINGS_POLICY.arrival.minimumArrivals ? levelPositive[h] : sidePositive[h];
          if (h === 0) { horizons.push(summarize(here.map(W), fallback)); continue; }
          // The players passed over for the whole origin season, and apart those called up in it (C-01)
          const upNow = here.filter((c) => c.up).map(W);
          const passed = summarize(here.filter((c) => !c.up).map(W), fallback);
          const all = weightOf(here.map(W));
          horizons.push({
            ...passed,
            arrived: upNow.length > 0 ? summarize(upNow, fallback) : null,
            upShare: all > 0 ? weightOf(upNow) / all : 0,
          });
        }
        cells.push({ side, level, ageFrom, ageTo, cases: n, horizons });
      }
    }
  }
  // The first and last band of a level stretch to every age, so nobody falls outside
  return { levels: [...new Set(cells.map((c) => c.level))].sort((a, b) => a - b), cells, byPotential: null };
}

// ── development from the save's own snapshots ────────────────────────────────

interface Pair { group: AgingGroup; age: number; perYear: number }

function snapshotPairs(observations: Observation[]): Pair[] {
  const byPlayer = new Map<number, Observation[]>();
  for (const o of observations) {
    const list = byPlayer.get(o.playerId) ?? [];
    list.push(o);
    byPlayer.set(o.playerId, list);
  }
  const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
  const { from, to } = RATINGS_POLICY.longitudinal.pairDays;
  const out: Pair[] = [];
  for (const list of byPlayer.values()) {
    const sorted = [...list].sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1));
    const seenSeason = new Set<number>();
    for (const first of sorted) {
      // One pair per player and season: the season's first snapshot, against the one nearest a year on
      if (seenSeason.has(first.season)) continue;
      seenSeason.add(first.season);
      if (first.group === null || first.age === null || first.current === null || first.potential === null) continue;
      const gap = first.potential - first.current;
      if (gap < RATINGS_POLICY.longitudinal.minimumGap) continue;
      const later = sorted.filter((o) => o.current !== null && days(first.gameDate, o.gameDate) >= from && days(first.gameDate, o.gameDate) <= to);
      if (later.length === 0) continue;
      const second = later.reduce((a, b) => (Math.abs(days(first.gameDate, b.gameDate) - 365) < Math.abs(days(first.gameDate, a.gameDate) - 365) ? b : a));
      const span = days(first.gameDate, second.gameDate) / 365;
      out.push({ group: first.group, age: first.age, perYear: ((second.current as number) - first.current) / gap / span });
    }
  }
  return out;
}

/** How many rating-snapshot pairs about a season apart the observations hold: the development path's evidence. */
export function snapshotPairCount(observations: Observation[]): number {
  return snapshotPairs(observations).length;
}

function developmentFromPairs(pairs: Pair[], prior: DevelopmentModel): DevelopmentModel {
  const table = (group: AgingGroup): Array<Array<[number, number, number]>> | null => {
    const mine = pairs.filter((p) => p.group === group);
    if (mine.length < RATINGS_POLICY.longitudinal.bandPairs) return null;
    // Per-year closure by age band, each band grown until it holds enough pairs
    const ages = [...new Set(mine.map((p) => Math.round(p.age)))].sort((a, b) => a - b);
    const bands: Array<{ from: number; to: number; stats: [number, number, number] }> = [];
    let acc: Pair[] = [];
    let start: number | null = null;
    const close = (end: number) => {
      const v = acc.map((p) => p.perYear);
      bands.push({ from: start as number, to: end, stats: [quantile(v, EDGE) as number, v.reduce((a, b) => a + b, 0) / v.length, quantile(v, 1 - EDGE) as number] });
      acc = [];
      start = null;
    };
    for (const a of ages) {
      if (start === null) start = a;
      acc.push(...mine.filter((p) => Math.round(p.age) === a));
      if (acc.length >= RATINGS_POLICY.longitudinal.bandPairs) close(a);
    }
    if (acc.length > 0) {
      if (bands.length > 0) {
        const all = mine.filter((p) => Math.round(p.age) >= bands[bands.length - 1].from).map((p) => p.perYear);
        bands[bands.length - 1] = { from: bands[bands.length - 1].from, to: ages[ages.length - 1], stats: [quantile(all, EDGE) as number, all.reduce((a, b) => a + b, 0) / all.length, quantile(all, 1 - EDGE) as number] };
      } else close(ages[ages.length - 1]);
    }
    const perYear = (age: number): [number, number, number] =>
      (bands.find((b) => age >= b.from && age <= b.to) ?? (age < bands[0].from ? bands[0] : bands[bands.length - 1])).stats;
    return Array.from({ length: AGES.last - AGES.first + 1 }, (_, i) => {
      const age = AGES.first + i;
      const rows: Array<[number, number, number]> = [];
      let rem: [number, number, number] = [1, 1, 1];
      for (let y = 1; y <= H; y += 1) {
        const [lo, c, hi] = perYear(age + y - 1);
        // What is left of the gap shrinks by each year's closure; the edges compound their own quantiles
        rem = [rem[0] * (1 - lo), rem[1] * (1 - c), rem[2] * (1 - hi)];
        rows.push([1 - rem[0], 1 - rem[1], 1 - rem[2]]);
      }
      return rows;
    });
  };
  const hitter = table('hitter');
  const pitcher = table('pitcher');
  const own = (t: unknown): 'save_fit' | 'fallback_prior' => (t ? 'save_fit' : 'fallback_prior');
  return {
    source: hitter && pitcher ? 'save_fit' : 'fallback_prior',
    groups: { hitter: own(hitter), pitcher: own(pitcher) },
    label: hitter && pitcher
      ? `The save's own development path, from ${pairs.length} rating-snapshot pairs about a season apart.`
      : `The save's own development path for ${hitter ? 'hitters' : 'pitchers'} (${pairs.length} rating-snapshot pairs about a season apart); ` +
        `${hitter ? 'pitchers' : 'hitters'} have too few pairs of their own and keep the provisional prior.`,
    firstAge: AGES.first,
    hitter: hitter ?? prior.hitter,
    pitcher: pitcher ?? prior.pitcher,
    pairs: pairs.length,
  };
}

/** The provisional prior's path, from a cross-section: the mean scouted gap at each age, and how it shrinks with age. */
export function developmentFromCrossSection(gaps: Record<AgingGroup, Array<[number, number | null]>>, label: string): DevelopmentModel {
  const table = (group: AgingGroup): Array<Array<[number, number, number]>> => {
    // The mean gap by age, never rising with age (a later age cannot have more gap left than an earlier one)
    const g = new Map<number, number>();
    let floor = Infinity;
    for (const [age, v] of gaps[group]) {
      if (v === null) continue;
      floor = Math.min(floor, v);
      g.set(age, floor);
    }
    const at = (age: number): number | null => {
      if (g.size === 0) return null;
      const ages = [...g.keys()].sort((a, b) => a - b);
      const a = Math.min(Math.max(age, ages[0]), ages[ages.length - 1]);
      const near = ages.reduce((best, x) => (Math.abs(x - a) < Math.abs(best - a) ? x : best));
      return g.get(near)!;
    };
    return Array.from({ length: AGES.last - AGES.first + 1 }, (_, i) => {
      const age = AGES.first + i;
      const now = at(age);
      return Array.from({ length: H }, (_, y) => {
        const later = at(age + y + 1);
        const c = now === null || later === null || now <= 0 ? 0 : Math.min(1, Math.max(0, 1 - later / now));
        return [0, c, Math.min(1, RATINGS_POLICY.development.priorRangeHigh * c)] as [number, number, number];
      });
    });
  };
  return { source: 'fallback_prior', label, firstAge: AGES.first, hitter: table('hitter'), pitcher: table('pitcher'), pairs: 0 };
}

// ── the fit ──────────────────────────────────────────────────────────────────

export function fitRatingsModel(input: RatingsFitInput, options: RatingsFitOptions): RatingsFitRun {
  const prior = options.prior;
  const useHoldout = options.holdout !== false;
  const strength = RATINGS_POLICY.mapping.priorStrength;
  const tol = PRODUCTION_POLICY.gate.tolerance;
  const targets = PRODUCTION_POLICY.coverage;

  // How often each batting hand faces left-handers
  const leftShare: RatingsModel['leftShare'] = { L: null, R: null, S: null };
  for (const hand of ['L', 'R', 'S'] as const) {
    const e = input.exposure?.[hand];
    const total = e ? e.vsLeft + e.vsRight : 0;
    leftShare[hand] = e && total >= RATINGS_POLICY.mapping.minimumOpportunities ? e.vsLeft / total : prior?.leftShare[hand] ?? null;
  }

  // ── ratings → rate, per kind (and per hitter variant) ──
  const hitterRows = rowsOf(input, 'hitter');
  const hitterFits = {} as Record<HitterVariant, MappingFit | null>;
  for (const v of HITTER_VARIANTS) hitterFits[v] = fitMapping(hitterRows, hitterDesign(hitterRows, v, leftShare));
  const starterMapping = pitcherMapping(rowsOf(input, 'starter'), prior?.mapping.starter ?? null, strength);
  const relieverMapping = pitcherMapping(rowsOf(input, 'reliever'), prior?.mapping.reliever ?? null, strength);
  const pitcherFits = { starter: starterMapping.fit, reliever: relieverMapping.fit };
  const hitter = {} as Record<HitterVariant, HitterRate>;
  for (const v of HITTER_VARIANTS) hitter[v] = hitterRateFrom(hitterFits[v], prior?.mapping.hitter[v] ?? null, strength);
  // Less evidence is never more certain: without the glove or the running, at least as wide as with them
  hitter.noGlove.variance600 = Math.max(hitter.noGlove.variance600, hitter.full.variance600);
  hitter.noRunning.variance600 = Math.max(hitter.noRunning.variance600, hitter.full.variance600);
  hitter.bat.variance600 = Math.max(hitter.bat.variance600, hitter.noGlove.variance600, hitter.noRunning.variance600);
  const mapping: RatingsModel['mapping'] = { hitter, starter: starterMapping.rate, reliever: relieverMapping.rate };

  // Held-out coverage of the mapping, honestly: each major leaguer's residual comes from a fit that never
  // saw him (folds by id), and the variance his band is judged with is set on the OTHER folds' residuals,
  // with the form of the mapping his evidence supports
  const kindsOf: ProductionKind[] = ['hitter', 'starter', 'reliever'];
  const folds = RATINGS_POLICY.mapping.folds;
  interface Held { kind: ProductionKind; e: number; noise: number; judged: number; served: number }
  const held: Held[] = kindsOf.flatMap((kind) => rowsOf(input, kind).map((r): Held | null => {
    const variant = kind === 'hitter' ? hitterVariantOf(r.ev) : null;
    const fit = kind === 'hitter' ? hitterFits[variant as HitterVariant] : pitcherFits[kind as 'starter' | 'reliever'];
    const own = fit?.residuals.find((x) => x.id === r.id);
    if (!fit || !own) return null;
    const judged = coverageVariance(fit.residuals.filter((x) => x.id % folds !== r.id % folds));
    const served = kind === 'hitter' ? hitter[variant as HitterVariant].variance600 : mapping[kind as 'starter' | 'reliever'].variance600;
    return { kind, e: own.e, noise: own.noise, judged, served };
  }).filter((x): x is Held => x !== null));
  const coverageFor = (items: Held[], which: 'judged' | 'served'): CoverageSummary => {
    if (items.length === 0) return { cases: 0, outer: null, inner: null };
    let o = 0;
    let i = 0;
    for (const x of items) {
      const sd = Math.sqrt(x[which] + x.noise);
      if (Math.abs(x.e) <= Z_OUTER * sd) o += 1;
      if (Math.abs(x.e) <= Z_INNER * sd) i += 1;
    }
    return { cases: items.length, outer: o / items.length, inner: i / items.length };
  };
  const asFitted = coverageFor(held, 'judged');

  // ── arrival, from the save's own minor-league usage lines ──
  const window: number[] = [];
  for (const s of [...input.seasons].sort((a, b) => a.season - b.season)) {
    if (s.season > input.throughSeason || s.season <= input.throughSeason - PRODUCTION_POLICY.window.maxSeasons) continue;
    if (s.scheduleShare !== null && s.scheduleShare >= PRODUCTION_POLICY.window.minShareOfSchedule) window.push(s.season);
  }
  // The owner's option C applied to arrivals (hardening F5): rolling origins, each scored by the method fitted through
  // it on the next season's minor leaguers; recent seasons weighted more; the model served refit through the last season
  const backtest = RATINGS_POLICY.backtest;
  const halfLife = options.recencyHalfLife === undefined ? backtest.recencyHalfLife : options.recencyHalfLife;
  const inWindow = new Set(window);
  const lastSeason = window[window.length - 1] ?? null;
  const candidates = useHoldout && lastSeason !== null
    ? window.filter((y) => y >= window[0] + backtest.origins.firstOriginAfter && y <= lastSeason - 1 && inWindow.has(y + 1))
    : [];
  const rolling = rollingOrigins(candidates, backtest.origins.maxOrigins);
  const holdout = rolling.length > 0 ? window.filter((y) => y > rolling[0]) : [];
  const trainingThrough = rolling[0] ?? lastSeason;
  const cases = arrivalCases(input.arrival, input.levels, window, input.throughSeason);
  const fitThrough = (through: number | null): ArrivalModel | null => {
    if (input.levels.length === 0 || through === null) return null;
    const m = fitArrival(cases, input.levels, (c) => c.target <= through, (c) => recencyWeight(through, c.target, halfLife));
    return m.cells.length > 0 ? m : null;
  };
  let arrival: ArrivalModel | null = cases.length > 0 ? fitThrough(lastSeason) : null;
  // The minimum-origins rule: a horizon of an origin is scored only where the fit through it holds the gate's minimum
  // cases on the side, from at least the policy's origin cohorts (no served model is that thin)
  const minimumCases = PRODUCTION_POLICY.gate.minimumCases;
  const perOrigin = new Map<string, Map<number, number>>();
  const byOrigin = new Map<number, ArrivalCase[]>();
  for (const c of cases) {
    const key = `${c.side}:${c.h}`;
    const m = perOrigin.get(key) ?? new Map<number, number>();
    m.set(c.origin, (m.get(c.origin) ?? 0) + 1);
    perOrigin.set(key, m);
    const list = byOrigin.get(c.origin) ?? [];
    list.push(c);
    byOrigin.set(c.origin, list);
  }
  const rests = (side: ProductionSide, h: number, through: number): boolean => {
    let n = 0;
    let cohorts = 0;
    for (const [origin, k] of perOrigin.get(`${side}:${h}`) ?? []) {
      if (origin + h > through) continue;
      n += k;
      cohorts += 1;
    }
    return n >= minimumCases && cohorts >= backtest.origins.minimumOrigins;
  };
  // Each held-out case is read as a player at the start of his origin season (every call-up still to come), so the
  // check is on the same, unconditioned players the model describes (C-01)
  interface Scored { player: number; origin: number; p: number; pm: number; played: number; outcome: number }
  const scoredRows: Scored[][] = Array.from({ length: H }, () => []);
  const scored: NonNullable<RatingsFitRecord['arrival']['scored']> = [];
  for (const y of arrival ? rolling : []) {
    const m = fitThrough(y);
    const cohort = y + 1;
    const horizons = new Set<number>();
    let n = 0;
    for (const c of m ? byOrigin.get(cohort) ?? [] : []) {
      if (!rests(c.side, c.h, y)) continue;
      const A = arrivalCellFor(m!, c.side, c.level, c.age)?.horizons[c.h];
      if (!A) continue;
      const r = arrivalReading(A, c.h, 1);
      scoredRows[c.h].push({ player: c.playerId, origin: y, p: r.chance, pm: r.chance * r.mean, played: c.outcome > 0 ? 1 : 0, outcome: c.outcome });
      horizons.add(c.h);
      n += 1;
    }
    scored.push({ origin: y, through: y, cohort, cases: n, horizons: [...horizons].sort((a, b) => a - b) });
  }
  // Pooled over the origins, the standard errors clustered by player and by origin (two-way, the results gate's rule)
  const heldOut: ArrivalCheck[] = scoredRows.map((rows, h) => {
    const n = rows.length;
    if (n === 0) return { horizon: h, cases: 0, predicted: null, observed: null, predictedMean: null, observedMean: null, chanceSe: null, meanSe: null, origins: 0 };
    const se = (e: (r: Scored) => number): number => {
      const byPlayer: ClusterSums<number> = new Map();
      const byOriginSums: ClusterSums<number> = new Map();
      const byBoth: ClusterSums<string> = new Map();
      let total = 0;
      for (const r of rows) {
        const x = e(r);
        total += x;
        addToCluster(byPlayer, r.player, x);
        addToCluster(byOriginSums, r.origin, x);
        addToCluster(byBoth, `${r.player}:${r.origin}`, x);
      }
      return twoWayClusteredSe(n, total / n, byPlayer, byOriginSums, byBoth);
    };
    return {
      horizon: h, cases: n,
      predicted: rows.reduce((t, r) => t + r.p, 0) / n,
      observed: rows.reduce((t, r) => t + r.played, 0) / n,
      predictedMean: rows.reduce((t, r) => t + r.pm, 0) / n,
      observedMean: rows.reduce((t, r) => t + r.outcome, 0) / n,
      chanceSe: se((r) => r.played - r.p),
      meanSe: se((r) => r.outcome - r.pm),
      origins: new Set(rows.map((r) => r.origin)).size,
    };
  });

  // ── the gate ──
  let passed: boolean;
  let reason: string;
  const off = (o: number | null, t: number) => (o === null ? Infinity : Math.abs(o - t));
  // The arrival chance and its expected playing time: a miss beyond the absolute tolerance fails as before, and
  // (hardening F4, B-15) so does a bias that is material (beyond a share of what happened) and not noise (beyond
  // the standard errors, clustered by player and by origin since F5): a tightening, never a loosening
  const bias = RATINGS_POLICY.gate.arrivalBias;
  const biased = (observed: number | null, predicted: number | null, se: number | null | undefined): boolean => {
    if (observed === null || predicted === null) return false;
    const e = observed - predicted;
    return Math.abs(e) > bias.relative * Math.abs(observed) && (se === null || se === undefined || Math.abs(e) > bias.standardErrors * se);
  };
  const arrivalOff = heldOut.filter((r) => r.cases >= minimumCases && (
    off(r.observed, r.predicted ?? 0) > tol
    || biased(r.observed, r.predicted, r.chanceSe)
    || biased(r.observedMean, r.predictedMean, r.meanSe)
  ));
  if (asFitted.cases < minimumCases) {
    passed = false;
    reason = `Too few major leaguers with ratings and ${RATINGS_POLICY.mapping.minimumOpportunities}+ opportunities to validate the ratings mapping (${asFitted.cases} held out; ${minimumCases} needed).`;
  } else if (off(asFitted.outer, targets.outer) > tol || off(asFitted.inner, targets.inner) > tol) {
    passed = false;
    reason = `The ratings mapping's held-out coverage (${pct(asFitted.outer)} / ${pct(asFitted.inner)}) is outside ${Math.round(tol * 100)} points of ${Math.round(targets.outer * 100)}% and ${Math.round(targets.inner * 100)}%.`;
  } else if (arrival && useHoldout && heldOut[1].cases < minimumCases) {
    // Arrivals measured but never checked on a season their fit did not see are not adopted (hardening F5: with rolling
    // origins a short history has none; before, a single split checked it): the next season must be evaluable
    passed = false;
    reason = `The arrival chance cannot be checked on held-out seasons: ${heldOut[1].cases} cases one season on from ${rolling.length} rolling origin${rolling.length === 1 ? '' : 's'} ` +
      `(${minimumCases} needed; an origin needs ${backtest.origins.firstOriginAfter} seasons before it and a fit through it with ${backtest.origins.minimumOrigins} origin cohorts at the horizon).`;
  } else if (arrivalOff.length > 0) {
    passed = false;
    reason = `The arrival chance's held-out calibration is outside the gate (${Math.round(tol * 100)} points, or a bias beyond ${Math.round(bias.relative * 100)}% of what happened and ${bias.standardErrors} standard errors clustered by player and by origin) at horizon ` +
      `${arrivalOff.map((r) => `${r.horizon} (chance predicted ${pct(r.predicted)}, observed ${pct(r.observed)}; opportunities per player predicted ${num(r.predictedMean)}, observed ${num(r.observedMean)})`).join(', ')}.`;
  } else {
    passed = true;
    reason = `The ratings mapping's held-out coverage (${pct(asFitted.outer)} / ${pct(asFitted.inner)} on ${asFitted.cases} major leaguers) is within ${Math.round(tol * 100)} points of the targets` +
      (arrival
        ? `, and the arrival chance and its expected playing time are within ${Math.round(tol * 100)} points and not biased beyond ${Math.round(bias.relative * 100)}% of what happened and ${bias.standardErrors} standard errors at every horizon with ${minimumCases}+ cases, scored on rolling origins ${rolling[0]}–${rolling[rolling.length - 1]}.`
        : '; arrivals are not measured on this save.');
  }
  if (!useHoldout) {
    passed = true;
    reason = 'Fitted on every season, no hold-out: the fallback prior is made this way and is provisional.';
  }
  const served = coverageFor(held, 'served');
  const byKind = Object.fromEntries(kindsOf.map((k) => [k, coverageFor(held.filter((x) => x.kind === k), 'served')])) as Record<ProductionKind, CoverageSummary>;

  // ── the stamina cut, for a pitcher with no professional games ──
  const pitchers = input.mapping.filter((c) => (c.kind === 'starter' || c.kind === 'reliever') && c.evidence.stamina !== null && c.opportunities >= RATINGS_POLICY.mapping.minimumOpportunities);
  let staminaCut = prior?.staminaCut ?? null;
  let staminaError: number | null = null;
  if (pitchers.filter((c) => c.kind === 'starter').length >= MIN_CASES && pitchers.filter((c) => c.kind === 'reliever').length >= MIN_CASES) {
    const values = [...new Set(pitchers.map((c) => c.evidence.stamina as number))].sort((a, b) => a - b);
    let best: { cut: number; errors: number } | null = null;
    for (const cut of values) {
      const errors = pitchers.filter((c) => ((c.evidence.stamina as number) >= cut) !== (c.kind === 'starter')).length;
      if (!best || errors < best.errors) best = { cut, errors };
    }
    if (best) {
      staminaCut = best.cut;
      staminaError = best.errors / pitchers.length;
    }
  }

  // ── the cross-section of scouted gaps: the prior's development path, and the widening for unknown potential ──
  const partial: RatingsModel = {
    method: RATINGS_METHOD, mapping, leftShare, staminaCut,
    development: prior?.development ?? developmentFromCrossSection({ hitter: [], pitcher: [] }, ''),
    arrival, potentialGap: { firstAge: AGES.first, hitter: [], pitcher: [] },
    reliability: { hitter: { variance600: null, cases: 0 }, starter: { variance600: null, cases: 0 }, reliever: { variance600: null, cases: 0 } },
  };
  const gapByAge: Record<AgingGroup, Map<number, number[]>> = { hitter: new Map(), pitcher: new Map() };
  const rateGapByAge: Record<AgingGroup, Map<number, number>> = { hitter: new Map(), pitcher: new Map() };
  for (const { evidence: ev, age } of input.crossSection) {
    if (ev.group === null || age === null) continue;
    const a = Math.round(age);
    if (ev.composite.current !== null && ev.composite.potential !== null) {
      const list = gapByAge[ev.group].get(a) ?? [];
      list.push(ev.composite.potential - ev.composite.current);
      gapByAge[ev.group].set(a, list);
    }
    const kinds: ProductionKind[] = ev.group === 'hitter' ? ['hitter'] : ['starter', 'reliever'];
    for (const kind of kinds) {
      const r = rateFromRatings(ev, kind, partial);
      if ('reason' in r || r.atPotential === null) continue;
      rateGapByAge[ev.group].set(a, Math.max(rateGapByAge[ev.group].get(a) ?? 0, r.atPotential - r.now));
    }
  }
  const crossSectionGap = {} as Record<AgingGroup, Array<[number, number | null]>>;
  const potentialGap: RatingsModel['potentialGap'] = { firstAge: AGES.first, hitter: [], pitcher: [] };
  for (const group of ['hitter', 'pitcher'] as const) {
    crossSectionGap[group] = [];
    for (let a = AGES.first; a <= AGES.last; a += 1) {
      const list = gapByAge[group].get(a);
      crossSectionGap[group].push([a, list && list.length >= RATINGS_POLICY.longitudinal.bandPairs ? list.reduce((x, y) => x + y, 0) / list.length : null]);
    }
    // The largest at each age; an age nobody holds takes the nearest age that someone does, and never less than the prior's
    const ages = [...rateGapByAge[group].keys()].sort((x, y) => x - y);
    for (let a = AGES.first; a <= AGES.last; a += 1) {
      const near = ages.length === 0 ? null : ages.reduce((best, x) => (Math.abs(x - a) < Math.abs(best - a) ? x : best));
      const own = near === null ? 0 : rateGapByAge[group].get(near) ?? 0;
      const priorGap = prior?.potentialGap[group]?.[a - (prior.potentialGap.firstAge ?? AGES.first)] ?? 0;
      potentialGap[group].push(Math.max(own, near === null ? priorGap : 0));
    }
  }

  // ── development: the save's own path from its rating snapshots once there are enough, else the prior's ──
  const pairs = snapshotPairs(input.observations);
  const minimumPairs = RATINGS_POLICY.longitudinal.minimumPairs;
  const priorDevelopment = prior?.development
    ?? developmentFromCrossSection(crossSectionGap, 'The provisional development prior: the mean scouted gap by age in one cross-section of the save.');
  const notYet: DevelopmentModel = {
    ...priorDevelopment,
    source: 'fallback_prior',
    label: `Not yet calibrated on this save: the provisional development prior (a cross-section of scouted gaps by age, not a path), its range from no further development to twice its central share; ` +
      `${pairs.length} of the ${minimumPairs} rating-snapshot pairs a season apart the save's own path needs.`,
    pairs: pairs.length,
  };
  const development = pairs.length >= minimumPairs ? developmentFromPairs(pairs, notYet) : notYet;

  // ── the arrival chance by potential tier, from snapshots linked to what followed ──
  const findings: string[] = [];
  const linked = arrival ? linkedArrivals(input, arrival, cases.length > 0 ? window : [], findings) : { used: false, linked: 0, byPotential: null };
  if (arrival && linked.byPotential) arrival = { ...arrival, byPotential: linked.byPotential };

  // ── the ratings' reliability as a forecast: this season's snapshot against next season's rate ──
  const reliability = forwardReliability(input, mapping);

  // ── a prospect's chance and playing time by his projected quality: the results fit's own effect, located on
  // each cell's players now (hardening F4, C-02) ──
  if (arrival && input.now) {
    arrival = locateQuality(input, { method: RATINGS_METHOD, mapping, leftShare, staminaCut, development, arrival, potentialGap, reliability: reliability.model }, arrival, input.now);
  }

  const model: RatingsModel = { method: RATINGS_METHOD, mapping, leftShare, staminaCut, development, arrival, potentialGap, reliability: reliability.model };
  const nCases = asFitted.cases;
  const overall = prior ? strength / (nCases + strength) : 0;
  const id = `${input.leagueId}:${input.throughSeason}:${RATINGS_METHOD}`;
  const record: RatingsFitRecord = {
    id, leagueId: input.leagueId, throughSeason: input.throughSeason, method: RATINGS_METHOD,
    mapping: {
      cases: { hitter: hitterFits.full?.cases ?? hitterFits.bat?.cases ?? 0, starter: pitcherFits.starter?.cases ?? 0, reliever: pitcherFits.reliever?.cases ?? 0 },
      variants: Object.fromEntries(HITTER_VARIANTS.map((v) => [v, hitterFits[v]?.cases ?? 0])) as Record<HitterVariant, number>,
      coverage: { asFitted, served, byKind },
      uncertainty: {
        ...Object.fromEntries(HITTER_VARIANTS.map((v) => [`hitter ${v}`, Math.sqrt(hitter[v].variance600)])),
        starter: Math.sqrt(mapping.starter.variance600), reliever: Math.sqrt(mapping.reliever.variance600),
      },
      caveat: SAME_TIME,
    },
    arrival: {
      measured: arrival !== null,
      reason: arrival ? `Measured from ${cases.length} player-seasons at levels ${input.levels.join(', ')} (usage lines only; no minor-league WAR).`
        : input.levels.length === 0 ? 'The save names no minor-league levels below this league.' : 'The save holds no minor-league usage history to measure arrivals from.',
      window, trainingThrough, holdout,
      cells: arrival?.cells.length ?? 0, cases: cases.length, heldOut,
      scored, recencyHalfLife: halfLife,
    },
    development: {
      source: development.source, groups: development.groups ?? { hitter: development.source, pitcher: development.source },
      pairs: pairs.length, minimumPairs, label: development.label, crossSectionGap,
    },
    arrivalByPotential: { used: linked.used, linked: linked.linked, minimum: RATINGS_POLICY.longitudinal.minimumLinked, findings },
    reliability: reliability.record,
    staminaCut: { cut: staminaCut, cases: pitchers.length, error: staminaError },
    leftShare,
    priorWeight: { overall },
    gate: { passed, reason, tolerance: tol, minimumCases },
    label: passed && useHoldout
      ? `calibrated on this save: ratings → rate on ${nCases} major leaguers (same-time)${arrival ? `, arrivals from its seasons ${window[0]}–${window[window.length - 1]}` : ''}; development ${development.source === 'save_fit' ? 'from its own rating snapshots' : 'not yet calibrated (provisional prior)'}`
      : `not yet calibrated on this save: ${reason}`,
  };
  return { model, record };
}

/**
 * The results fit's own effect of quality at the same usage (the chance's logistic and the playing time's
 * coefficient, per kind and horizon; the rest of this season at the first season's), and each arrival cell's
 * players now at every horizon: their projected quality above replacement from their ratings path (never below
 * zero, as the results path reads it) times those effects, sampled in order of quality. The projection locates
 * the effect on them so that together they keep the cell's measured chance and playing time (hardening F4, C-02).
 * Only the league's own affiliates' players not yet in the majors, with ability evidence and a kind, are read.
 */
function locateQuality(input: RatingsFitInput, model: RatingsModel, arrival: ArrivalModel, now: { season: number; seasonPlayed: number }): ArrivalModel {
  const kinds: ProductionKind[] = ['hitter', 'starter', 'reliever'];
  const effect = (read: (row: ProductionModel['kinds'][ProductionKind]['horizons'][number]) => number | undefined) => Object.fromEntries(kinds.map((kind) => [
    kind, Array.from({ length: H }, (_, h) => {
      const row = input.production.kinds[kind]?.horizons[Math.max(h, 1) - 1];
      const v = row ? read(row) : undefined;
      return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
    }),
  ])) as Record<ProductionKind, number[]>;
  const quality = { chance: effect((row) => row.chance?.quality), perGame: effect((row) => row.conditional?.quality) };
  const members = new Map<ArrivalCell, Array<Array<[number, number]>>>();
  const f = Math.min(Math.max(now.seasonPlayed, 0), 1);
  for (const x of input.crossSection) {
    const ev = x.evidence;
    if (x.level === null || x.level === undefined || x.level <= 1 || x.majors === true || x.age === null || ev.group === null || ev.status === 'unknown') continue;
    const side: ProductionSide = ev.group === 'hitter' ? 'batting' : 'pitching';
    if (!arrival.levels.includes(x.level)) continue;
    const cell = arrivalCellFor(arrival, side, x.level, x.age);
    if (!cell) continue;
    const kind = ev.group === 'hitter' ? 'hitter' : pitcherKindWithoutMajors(x.proUsage, ev, model.staminaCut);
    if (typeof kind !== 'string') continue;
    const path = ratingsPath(ev, kind, { season: now.season, f, age: x.age }, model, input.production);
    if ('reason' in path) continue;
    const terms = path.seasons.map((s, h): [number, number] => {
      const q = Math.max(0, s.rate);
      return [quality.chance[kind][h] * q, quality.perGame[kind][h] * q];
    });
    const list = members.get(cell) ?? [];
    list.push(terms);
    members.set(cell, list);
  }
  const N = RATINGS_POLICY.arrival.populationNodes;
  const sample = (list: Array<[number, number]>): Array<[number, number]> => {
    const sorted = [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (sorted.length <= N) return sorted;
    return Array.from({ length: N }, (_, j) => sorted[Math.min(sorted.length - 1, Math.floor(((j + 0.5) * sorted.length) / N))]);
  };
  const cells = arrival.cells.map((cell) => {
    const list = members.get(cell) ?? [];
    return {
      ...cell,
      horizons: cell.horizons.map((A, h) => (A ? { ...A, population: list.length > 0 ? sample(list.map((t) => t[h])) : null } : A)),
    };
  });
  return { ...arrival, cells, quality };
}

/**
 * How reliable the ratings are as a forecast, per kind, from the save's own snapshots: the first snapshot
 * of each player's season against his major-league rate the next season (enough opportunities to read
 * it), predicted by this fit's mapping from the tools the snapshot recorded (a hitter's overall bat, as
 * snapshots keep no splits, running or glove). What is left, net of season noise, is set on coverage like
 * the same-time variance. Used per kind only with enough such seasons; until then, null.
 */
function forwardReliability(input: RatingsFitInput, mapping: RatingsModel['mapping']): { model: RatingsModel['reliability']; record: RatingsFitRecord['reliability'] } {
  const next = new Map<string, ForwardSeason>();
  for (const f of input.forward ?? []) next.set(`${f.playerId}:${f.season}:${f.side}`, f);
  const first = new Map<string, Observation>();
  for (const o of input.observations) {
    const key = `${o.playerId}:${o.season}`;
    const had = first.get(key);
    if (!had || o.gameDate < had.gameDate) first.set(key, o);
  }
  const residuals: Record<ProductionKind, Residual[]> = { hitter: [], starter: [], reliever: [] };
  for (const o of first.values()) {
    if (o.group === null || !o.tools) continue;
    const side: ProductionSide = o.group === 'hitter' ? 'batting' : 'pitching';
    const f = next.get(`${o.playerId}:${o.season + 1}:${side}`);
    if (!f || f.opportunities < RATINGS_POLICY.mapping.minimumOpportunities) continue;
    const kind: ProductionKind = side === 'batting' ? 'hitter' : f.games > 0 && f.starts / f.games >= PRODUCTION_POLICY.starterShare ? 'starter' : 'reliever';
    let pred: number | null = null;
    if (kind === 'hitter') {
      if (!BAT_TOOLS.every((t) => typeof o.tools?.[t] === 'number')) continue;
      const bat = Object.fromEntries(BAT_TOOLS.map((t) => [t, o.tools![t] as number])) as Record<HitterTool, number>;
      pred = hitterRateOf(mapping.hitter.bat, o.position ?? null, bat, null, null);
    } else {
      if (!ARM_TOOLS.every((t) => typeof o.tools?.[t] === 'number')) continue;
      pred = pitcherRateOf(mapping[kind], Object.fromEntries(ARM_TOOLS.map((t) => [t, o.tools![t] as number])) as Record<PitcherTool, number>);
    }
    const noise = input.production.kinds[kind].noise600 * (PER / f.opportunities);
    residuals[kind].push({ id: o.playerId, e: (f.war / f.opportunities) * PER - pred, noise });
  }
  const model = {} as RatingsModel['reliability'];
  const measured = {} as Record<ProductionKind, number>;
  for (const kind of ['hitter', 'starter', 'reliever'] as const) {
    const enough = residuals[kind].length >= MIN_CASES;
    const v = enough ? coverageVariance(residuals[kind]) : 0;
    model[kind] = { variance600: enough && v > 0 ? v : null, cases: residuals[kind].length };
    measured[kind] = residuals[kind].length;
  }
  const any = Object.values(model).some((r) => r.variance600 !== null);
  return {
    model,
    record: {
      measured, minimum: MIN_CASES,
      note: any
        ? 'Measured on the save\'s own rating snapshots against the next season\'s rate, where a kind has enough such seasons; elsewhere the ratings count for the kind\'s own K.'
        : `Not measured: the save's rating snapshots are not yet followed by enough major-league seasons (${MIN_CASES} per kind needed; ${measured.hitter} hitters, ${measured.starter} starters, ${measured.reliever} relievers). Until then the ratings count for what the kind's mean counts in the results fit (its K), no more: a same-time fit cannot say how reliable they are as a forecast.`,
    },
  };
}

/**
 * The arrival chance by potential tier: the save's own rating snapshots of players below the majors,
 * linked to their major-league playing time in the seasons after. Used only with enough linked
 * player-seasons, a tier's multiplier only at two standard errors from none, and never lower for a
 * higher tier.
 */
function linkedArrivals(input: RatingsFitInput, arrival: ArrivalModel, window: number[], findings: string[]): { used: boolean; linked: number; byPotential: ArrivalModel['byPotential'] } {
  const majors = new Map(input.arrival.map((p) => [p.playerId, p]));
  const first = new Map<string, Observation>();
  for (const o of input.observations) {
    const key = `${o.playerId}:${o.season}`;
    const had = first.get(key);
    if (!had || o.gameDate < had.gameDate) first.set(key, o);
  }
  // The chance he was expected to have is read at the snapshot's own point of the season (hardening F5, as C-01 reads a
  // prospect): a player not yet called up with 1 − f of the season's call-ups still to come. Where f is not established
  // the expected chance is the range between the season's start and its end (the reading is monotone in f)
  interface Linked { group: AgingGroup; potential: number; h: number; expected: [number, number]; played: boolean }
  const rows: Linked[] = [];
  const eligible = new Set(window);
  for (const o of first.values()) {
    if (o.group === null || o.potential === null || o.level === null || o.age === null || !arrival.levels.includes(o.level)) continue;
    const p = majors.get(o.playerId);
    const side: ProductionSide = o.group === 'hitter' ? 'batting' : 'pitching';
    if (p && ((p.majors.get(o.season - 1) ?? 0) > 0 || (p.majors.get(o.season - 2) ?? 0) > 0)) continue;
    const cell = arrivalCellFor(arrival, side, o.level, o.age);
    if (!cell) continue;
    for (let h = 0; h < H; h += 1) {
      const target = o.season + h;
      if (target > input.throughSeason) break;
      if (!eligible.has(target)) continue;
      const A = cell.horizons[h];
      if (!A) continue;
      const f = typeof o.seasonPlayed === 'number' && Number.isFinite(o.seasonPlayed) ? Math.min(Math.max(o.seasonPlayed, 0), 1) : null;
      const ends = f === null ? [arrivalReading(A, h, 0).chance, arrivalReading(A, h, 1).chance] : [arrivalReading(A, h, 1 - f).chance];
      rows.push({ group: o.group, potential: o.potential, h, expected: [Math.min(...ends), Math.max(...ends)], played: (p?.majors.get(target) ?? 0) > 0 });
    }
  }
  const minimum = RATINGS_POLICY.longitudinal.minimumLinked;
  if (rows.length < minimum) {
    findings.push(`${rows.length} rating snapshots linked to a later season's playing time, of the ${minimum} needed: the arrival chance is by level and age only.`);
    return { used: false, linked: rows.length, byPotential: null };
  }
  const cuts = {} as Record<AgingGroup, number[]>;
  const multipliers = {} as Record<AgingGroup, number[][]>;
  for (const group of ['hitter', 'pitcher'] as const) {
    const mine = rows.filter((r) => r.group === group);
    const values = mine.map((r) => r.potential);
    const T = RATINGS_POLICY.longitudinal.potentialTiers;
    cuts[group] = values.length > 0 ? Array.from({ length: T - 1 }, (_, j) => quantile(values, (j + 1) / T) as number) : [];
    const tierOf = (v: number) => { const i = cuts[group].findIndex((c) => v <= c); return i === -1 ? cuts[group].length : i; };
    multipliers[group] = Array.from({ length: T }, (_, tier) => Array.from({ length: H }, (_, h) => {
      const set = mine.filter((r) => r.h === h && tierOf(r.potential) === tier);
      const observed = set.filter((r) => r.played).length;
      // Each end of the expected range: its multiplier, its standard error, and which side of none it is beyond
      const end = (i: 0 | 1) => {
        const expected = set.reduce((s, r) => s + r.expected[i], 0);
        if (!(expected > 0)) return { expected, m: observed > 0 ? Infinity : null, se: 0, side: observed > 0 ? 1 : 0 };
        const m = observed / expected;
        const se = Math.sqrt(set.reduce((s, r) => s + r.expected[i] * (1 - r.expected[i]), 0)) / expected;
        return { expected, m, se, side: Math.abs(m - 1) >= RATINGS_POLICY.longitudinal.evidence * se ? Math.sign(m - 1) : 0 };
      };
      const [lo, hi] = [end(0), end(1)];
      if (set.length === 0 || !(hi.expected > 0)) return 1;
      // Used only where it holds across the whole range, and then the reading nearer none
      const real = lo.side !== 0 && lo.side === hi.side;
      const m = real ? [lo.m, hi.m].filter((x): x is number => x !== null && Number.isFinite(x)).reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a)) : 1;
      const range = lo.expected === hi.expected
        ? `${hi.expected.toFixed(1)} expected by level and age (× ${(hi.m as number).toFixed(2)} ± ${hi.se.toFixed(2)})`
        : `${lo.expected.toFixed(1)} to ${hi.expected.toFixed(1)} expected by level and age, the snapshot's point of the season not established (× ${hi.m === null ? '—' : (hi.m as number).toFixed(2)} to ${lo.m === null ? '—' : Number.isFinite(lo.m) ? (lo.m as number).toFixed(2) : 'any'})`;
      findings.push(`${group === 'hitter' ? 'Hitters' : 'Pitchers'}, potential tier ${tier + 1} of ${T}, ${h} season${h === 1 ? '' : 's'} on: ${observed} reached the majors against ${range}${real ? '' : ' — not distinguishable from none across what is known, not used'}.`);
      return m;
    }));
    // A higher potential tier is never given a lower chance than the tier below it
    for (let h = 0; h < H; h += 1) {
      for (let tier = 1; tier < T; tier += 1) multipliers[group][tier][h] = Math.max(multipliers[group][tier][h], multipliers[group][tier - 1][h]);
    }
  }
  return { used: true, linked: rows.length, byPotential: { cuts, multipliers, linked: rows.length } };
}

const pct = (x: number | null): string => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null): string => (x === null ? '—' : x.toFixed(1));
