/**
 * Player Value, concern 3, phase 3b: expected production from scouted ratings (PLAYER_VALUE.md Part 2.3,
 * D-017, D-018, D-052, D-053).
 *
 * Pure: it is handed the adapter's evidence (built from a `ScoutedAbility`, the hitter's splits and
 * running, and his glove at his position, all from `scoutedEvidence.ts`; D-017, D-033, D-035), the
 * objective facts (age, level, listed position, batting hand, professional usage) and two FITTED MODELS
 * (the results model and the ratings model, each the save's adopted fit or the provisional prior). It
 * opens no table and reads no rating column: ability arrives only as evidence the adapter built.
 *
 *   ratings → rate   a mapping, fitted per save on major leaguers who have both scouted ratings and a
 *                    meaningful rate, from a hitter's bat (his rating splits weighted by how often his hand
 *                    faces left-handers on the save, else his overall tools), running and glove at his
 *                    listed position, or a pitcher's stuff, movement and control, to WAR per 600
 *                    opportunities, for hitters, starters and relievers apart. A same-time fit: ratings now
 *                    against rates around now. It describes; it does not forecast.
 *   development      over the horizon his expected ability moves from current toward scouted potential by
 *                    age, on the development path in force (the save's own, fitted from its rating
 *                    snapshots once enough exist; until then the provisional prior, labelled). The band
 *                    widens with the gap between them and with the horizon. After his development the
 *                    aging curve's decline applies; its gains before the peak are the development's.
 *   blend            a player with major-league results: his rate is regressed toward the ratings-implied
 *                    rate with reliability weights, results n ÷ (n + K), ratings K ÷ (n + K), where K is
 *                    what the ratings are worth in opportunities (never less than the kind's own K), so a
 *                    thin record leans on the ratings and a full one is effectively his results alone.
 *   arrival          a player not in the majors: his expected playing time is how often players at his
 *                    level and age reached the majors on this save, and how much they played when they did
 *                    (measured; when it cannot be measured, unknown). His wins band is that mixture: the
 *                    chance of no playing time at all, or playing time times his rate. Its low edge always
 *                    includes producing nothing.
 *
 * Unknown stays unknown (D-018): no ability evidence leaves the ability component unknown and is never
 * replaced by an average; a partial evidence set uses the mapping without what is missing (fitted with
 * its own, larger, uncertainty) or widens the development by the largest the save shows at his age. No
 * input names his club, so a player outside the organization is valued exactly as one inside it (Q-2).
 * Nothing here reads Player Development's defensibility, the protection tier or a prospect decision.
 */

import { CONTROL_HORIZON_SEASONS, PRODUCTION_NO_EVIDENCE, PRODUCTION_POLICY, RATINGS_POLICY } from './playerValueCalibration.js';
import {
  PRODUCTION_UNIT, Z_INNER, Z_OUTER, agingBetween, atHorizon, basisShell, inside, planSides, projectProductionWith,
  unknownProduction,
  type AbilityBasis, type AbilityPrior, type AgingGroup, type ArrivalBasis, type ModelProvenance, type PlayerProduction,
  type ProductionInput, type ProductionKind, type ProductionModel, type ProductionSeason, type ProductionSide, type WinsBand,
} from './playerValueProduction.js';
import type {
  EvidenceStatus, HitterTool, PitcherTool, ScoutedAbility, ScoutedGloveAtPosition, ScoutedHitterProfile,
} from './scoutedEvidence.js';

const PER = PRODUCTION_POLICY.rateUnitOpportunities;
const H = CONTROL_HORIZON_SEASONS;

// ── the model a ratings fit produces (stored per save as JSON) ────────────────

export type HitterVariant = 'full' | 'noGlove' | 'noRunning' | 'bat';
export const HITTER_VARIANTS: HitterVariant[] = ['full', 'noGlove', 'noRunning', 'bat'];
export const BAT_TOOLS: HitterTool[] = ['contact', 'gap', 'power', 'eye', 'avoidK'];
export const ARM_TOOLS: PitcherTool[] = ['stuff', 'movement', 'control'];

/** A hitter's rate: an intercept by listed position (else the pooled one) plus a slope per tool, running and glove (20-80). */
export interface HitterRate {
  intercepts: Record<string, number>;
  tools: Record<HitterTool, number>;
  /** Zero in a variant without it. */
  running: number;
  glove: number;
  /** What is not known about his true rate given these ratings, (WAR per 600)², measured on held-out players. */
  variance600: number;
  cases: number;
}

export interface PitcherRate {
  intercept: number;
  tools: Record<PitcherTool, number>;
  variance600: number;
  cases: number;
  /** The same mapping fitted without one tool, for a pitcher whose scouted line lacks it (its slope there is zero). */
  without?: Partial<Record<PitcherTool, PitcherRate>>;
}

/** The development path: per age and whole years ahead, the share of the gap to potential closed (80% range, central). */
export interface DevelopmentModel {
  /** 'save_fit' when both groups' paths are the save's own; each group's own source is in `groups`. */
  source: 'save_fit' | 'fallback_prior';
  groups?: Record<AgingGroup, 'save_fit' | 'fallback_prior'>;
  label: string;
  firstAge: number;
  /** [age − firstAge][years ahead − 1] = [low, central, high]. */
  hitter: Array<Array<[number, number, number]>>;
  pitcher: Array<Array<[number, number, number]>>;
  /** The rating-snapshot pairs it rests on (0 for the prior). */
  pairs: number;
}

/** How often players at a level and age reached the majors, per horizon (0 = the rest of this season). */
export interface ArrivalHorizon {
  cases: number;
  /** Share with any major-league playing time. */
  chance: number;
  /** Mean opportunities among those who played. */
  mean: number;
  /** Their opportunities at equal-probability nodes (ascending). */
  nodes: number[];
}

export interface ArrivalCell {
  side: ProductionSide;
  level: number;
  ageFrom: number;
  ageTo: number;
  cases: number;
  horizons: Array<ArrivalHorizon | null>;
}

export interface ArrivalModel {
  levels: number[];
  cells: ArrivalCell[];
  /** The chance's multiplier by potential tier, from the save's own rating snapshots; null until measured. */
  byPotential: {
    cuts: Record<AgingGroup, number[]>;
    /** [tier][horizon] */
    multipliers: Record<AgingGroup, number[][]>;
    linked: number;
  } | null;
}

export interface RatingsModel {
  method: string;
  mapping: { hitter: Record<HitterVariant, HitterRate>; starter: PitcherRate; reliever: PitcherRate };
  /** How often each batting hand faces left-handed pitching on this save; null where not measured. */
  leftShare: Record<'L' | 'R' | 'S', number | null>;
  /** The stamina at or above which a pitcher with no professional games is read as a starter; null when not measured. */
  staminaCut: number | null;
  development: DevelopmentModel;
  /** Null: not measured on this save, so a player not in the majors has no expected playing time. */
  arrival: ArrivalModel | null;
  /** The largest development (rate at potential − rate now, WAR per 600) the save shows at each age: the widening when potential is unknown. */
  potentialGap: { firstAge: number; hitter: number[]; pitcher: number[] };
  /**
   * How reliable the ratings are as a FORECAST, per kind: what is not known about next season's true
   * rate given this season's ratings, (WAR per 600)², measured on the save's own rating snapshots against
   * the seasons after them. Null until measured: the ratings then count for what the kind's mean counts
   * in the results fit (its K), no more, because a same-time fit cannot say how reliable they are.
   */
  reliability: Record<ProductionKind, { variance600: number | null; cases: number }>;
}

/** The ratings model in force for a league, with where it came from. */
export interface RatingsModelInForce {
  model: RatingsModel;
  provenance: ModelProvenance;
}

// ── the evidence, as the adapter gave it ─────────────────────────────────────

export type RatingsFeature = HitterTool | PitcherTool | 'running' | 'glove';

/**
 * A player's ability evidence for production: built only from what `scoutedEvidence.ts` returned. A
 * grade the adapter left unknown stays null here; nothing is filled in.
 */
export interface RatingsEvidence {
  playerId: number;
  group: AgingGroup | null;
  status: EvidenceStatus;
  current: Partial<Record<RatingsFeature, number | null>>;
  potential: Partial<Record<RatingsFeature, number | null>>;
  /** The adapter's composites (current, potential), for tiers; null when not every tool is known. */
  composite: { current: number | null; potential: number | null };
  /** A hitter's bat against left- and right-handed pitching (D-035), when all ten are known. */
  splits: { vsLeft: Record<HitterTool, number>; vsRight: Record<HitterTool, number> } | null;
  bats: 'L' | 'R' | 'S' | null;
  position: number | null;
  stamina: number | null;
  missing: string[];
  provenance: string;
  verification: string;
}

/** The evidence a production projection reads, from the adapter's answers and two objective facts. */
export function ratingsEvidence(
  ability: ScoutedAbility,
  extra: { profile?: ScoutedHitterProfile | null; glove?: ScoutedGloveAtPosition | null; position?: number | null; bats?: 'L' | 'R' | 'S' | null } = {},
): RatingsEvidence {
  const group: AgingGroup | null = ability.kind === 'hitter' ? 'hitter' : ability.kind === 'pitcher' ? 'pitcher' : null;
  const current: RatingsEvidence['current'] = {};
  const potential: RatingsEvidence['potential'] = {};
  const missing: string[] = [];
  if (group === 'hitter') {
    for (const t of BAT_TOOLS) {
      current[t] = ability.currentTools[t] ?? null;
      potential[t] = ability.potentialTools[t] ?? null;
    }
    current.running = extra.profile?.runningAbility ?? null;
    current.glove = extra.glove?.current ?? null;
    potential.glove = extra.glove?.potential ?? null;
    if (current.running === null) missing.push('running (speed, baserunning, stealing)');
    if (current.glove === null) missing.push('glove at his listed position (not shown)');
  } else if (group === 'pitcher') {
    for (const t of ARM_TOOLS) {
      current[t] = ability.currentTools[t] ?? null;
      potential[t] = ability.potentialTools[t] ?? null;
    }
  }
  missing.unshift(...ability.missing.current.map((t) => `current ${t}`), ...ability.missing.potential.map((t) => `potential ${t}`));
  const p = extra.profile;
  const splitsKnown = group === 'hitter' && p && p.missing.vsLeft.length === 0 && p.missing.vsRight.length === 0;
  return {
    playerId: ability.playerId,
    group,
    status: ability.status,
    current,
    potential,
    composite: { current: ability.current, potential: ability.potential },
    splits: splitsKnown ? { vsLeft: p!.vsLeft as Record<HitterTool, number>, vsRight: p!.vsRight as Record<HitterTool, number> } : null,
    bats: extra.bats ?? null,
    position: extra.position ?? null,
    stamina: ability.stamina,
    missing,
    provenance: ability.provenance.status,
    verification: ability.provenance.verification,
  };
}

// ── ratings → rate ───────────────────────────────────────────────────────────

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Which form of the hitter mapping his evidence supports. */
export function hitterVariantOf(ev: RatingsEvidence): HitterVariant {
  const run = known(ev.current.running);
  const glove = known(ev.current.glove);
  return run && glove ? 'full' : run ? 'noGlove' : glove ? 'noRunning' : 'bat';
}

/**
 * A hitter's bat now: his rating splits weighted by how often his hand faces left-handers on this save
 * (D-035), or, when the splits or that share are not known, his overall tools. Null unless every tool is known.
 */
export function batNow(ev: RatingsEvidence, leftShare: RatingsModel['leftShare']): { tools: Record<HitterTool, number>; source: 'splits' | 'overall' } | null {
  const share = ev.bats ? leftShare[ev.bats] : null;
  if (ev.splits && known(share)) {
    const tools = {} as Record<HitterTool, number>;
    for (const t of BAT_TOOLS) tools[t] = share * ev.splits.vsLeft[t] + (1 - share) * ev.splits.vsRight[t];
    return { tools, source: 'splits' };
  }
  if (BAT_TOOLS.every((t) => known(ev.current[t]))) {
    const tools = {} as Record<HitterTool, number>;
    for (const t of BAT_TOOLS) tools[t] = ev.current[t] as number;
    return { tools, source: 'overall' };
  }
  return null;
}

export function hitterRateOf(m: HitterRate, position: number | null, bat: Record<HitterTool, number>, running: number | null, glove: number | null): number {
  const intercept = (position !== null ? m.intercepts[String(position)] : undefined) ?? m.intercepts.pooled ?? 0;
  let r = intercept;
  for (const t of BAT_TOOLS) r += m.tools[t] * bat[t];
  if (running !== null) r += m.running * running;
  if (glove !== null) r += m.glove * glove;
  return r;
}

export function pitcherRateOf(m: PitcherRate, tools: Record<PitcherTool, number>): number {
  let r = m.intercept;
  for (const t of ARM_TOOLS) r += m.tools[t] * tools[t];
  return r;
}

export interface RatedAbility {
  variant: HitterVariant | null;
  bat: 'splits' | 'overall' | null;
  /** WAR per 600 his current ratings imply. */
  now: number;
  /**
   * WAR per 600 at the ends of what his missing grades could be: the full mapping with an unknown glove
   * or running grade at the scale's low end and at its high end (interval arithmetic; equal to `now`
   * when nothing is missing). Any value of the missing grade lies between them.
   */
  nowLow: number;
  nowHigh: number;
  /** A component is missing: his potential, or a glove or running grade the mapping reads. */
  partial: boolean;
  /** WAR per 600 at his potential (running held; the glove's potential where shown); null when his potential is not known. */
  atPotential: number | null;
  /** (WAR per 600)²: how much wider the form of the mapping his evidence supports is than the full one (a missing glove or running). */
  extra600: number;
  /** (WAR per 600)²: what is not known about his true rate given the ratings, as a projection uses it (`ratingsPath`). */
  variance600: number;
}

/** What his ratings say about his rate, for a kind; a reason when they cannot say. */
export function rateFromRatings(ev: RatingsEvidence, kind: ProductionKind, model: RatingsModel): RatedAbility | { reason: string } {
  if (kind === 'hitter') {
    if (ev.group !== 'hitter') return { reason: 'His ratings are not a position player\'s, so they say nothing about his batting.' };
    const bat = batNow(ev, model.leftShare);
    if (!bat) return { reason: `His scouted bat is not all visible (${ev.missing.filter((m) => m.startsWith('current')).join(', ') || 'tools missing'}).` };
    const variant = hitterVariantOf(ev);
    const m = model.mapping.hitter[variant];
    const running = variant === 'full' || variant === 'noGlove' ? ev.current.running as number : null;
    const glove = variant === 'full' || variant === 'noRunning' ? ev.current.glove as number : null;
    const now = hitterRateOf(m, ev.position, bat.tools, running, glove);
    // The bounds: the fullest form of the mapping that applies to him (a designated hitter has no glove),
    // each grade he lacks at the ends of the scale
    const gloveApplies = ev.position !== null && ev.position >= 2 && ev.position <= 9;
    const bounds = model.mapping.hitter[gloveApplies ? 'full' : 'noGlove'];
    const ends = (grade: number) => hitterRateOf(bounds, ev.position, bat.tools, running ?? grade, gloveApplies ? glove ?? grade : null);
    const missingGrade = running === null || (gloveApplies && glove === null);
    const nowLow = missingGrade ? Math.min(now, ends(RATINGS_POLICY.unknownGrade.low)) : now;
    const nowHigh = missingGrade ? Math.max(now, ends(RATINGS_POLICY.unknownGrade.high)) : now;
    let atPotential: number | null = null;
    if (BAT_TOOLS.every((t) => known(ev.potential[t]) && known(ev.current[t]))) {
      // The development increment of each overall tool, added to his bat as it is read now
      const grown = {} as Record<HitterTool, number>;
      for (const t of BAT_TOOLS) grown[t] = bat.tools[t] + Math.max(0, (ev.potential[t] as number) - (ev.current[t] as number));
      const glovePotential = glove !== null && known(ev.potential.glove) ? Math.max(glove, ev.potential.glove) : glove;
      atPotential = hitterRateOf(m, ev.position, grown, running, glovePotential);
    }
    return {
      variant, bat: bat.source, now, nowLow, nowHigh, partial: missingGrade || atPotential === null, atPotential,
      extra600: Math.max(0, m.variance600 - model.mapping.hitter.full.variance600), variance600: m.variance600,
    };
  }
  if (ev.group !== 'pitcher') return { reason: 'His ratings are not a pitcher\'s, so they say nothing about his pitching.' };
  const lacking = ARM_TOOLS.filter((t) => !known(ev.current[t]));
  const full = model.mapping[kind];
  // One current tool not visible: the mapping fitted without it gives the central, and the full mapping
  // with that tool at the scale's ends bounds the band. More than one: his ability is not established
  const m = lacking.length === 0 ? full : lacking.length === 1 ? full.without?.[lacking[0]] ?? null : null;
  if (m === null) return { reason: `His scouted pitching tools are not visible enough to project from (${ev.missing.filter((x) => x.startsWith('current')).join(', ')}).` };
  const cur = {} as Record<PitcherTool, number>;
  for (const t of ARM_TOOLS) cur[t] = known(ev.current[t]) ? ev.current[t] as number : 0;
  let atPotential: number | null = null;
  if (lacking.length === 0 && ARM_TOOLS.every((t) => known(ev.potential[t]))) {
    const grown = {} as Record<PitcherTool, number>;
    for (const t of ARM_TOOLS) grown[t] = Math.max(cur[t], ev.potential[t] as number);
    atPotential = pitcherRateOf(m, grown);
  }
  const now = pitcherRateOf(m, cur);
  const ends = (grade: number) => pitcherRateOf(full, { ...cur, ...Object.fromEntries(lacking.map((t) => [t, grade])) });
  const nowLow = lacking.length > 0 ? Math.min(now, ends(RATINGS_POLICY.unknownGrade.low)) : now;
  const nowHigh = lacking.length > 0 ? Math.max(now, ends(RATINGS_POLICY.unknownGrade.high)) : now;
  return {
    variant: null, bat: null, now, nowLow, nowHigh, partial: lacking.length > 0 || atPotential === null, atPotential,
    extra600: Math.max(0, m.variance600 - full.variance600), variance600: m.variance600,
  };
}

/**
 * What is not known about his true rate given his ratings, as a projection uses it, (WAR per 600)²:
 * the save's measured forecast reliability where its snapshots allow, else what the kind's own K says is
 * unknown about a player the results fit knows nothing of (noise × 600 ÷ K), plus the extra width of a
 * form of the mapping without the glove or running he lacks.
 */
export function ratingsVariance(rated: RatedAbility, kind: ProductionKind, ratings: RatingsModel, production: ProductionModel): number {
  const k = production.kinds[kind];
  const measured = ratings.reliability?.[kind]?.variance600;
  const base = typeof measured === 'number' && measured > 0 ? measured : (k.noise600 * PER) / k.stabilization;
  return base + rated.extra600;
}

// ── development toward potential ─────────────────────────────────────────────

/** The share of the gap to potential closed after `years` (fractional), from `age`: low, central, high. */
export function developmentShares(dev: DevelopmentModel, group: AgingGroup, age: number, years: number): { low: number; central: number; high: number } {
  if (!(years > 0)) return { low: 0, central: 0, high: 0 };
  const table = dev[group];
  if (table.length === 0) return { low: 0, central: 0, high: 0 };
  const row = table[Math.min(Math.max(Math.round(age) - dev.firstAge, 0), table.length - 1)];
  const at = (y: number): [number, number, number] => (y <= 0 ? [0, 0, 0] : row[Math.min(y, row.length) - 1]);
  const y0 = Math.floor(years);
  const t = years - y0;
  const a = at(y0);
  const b = at(y0 + 1);
  const mix = (j: number) => (1 - t) * a[j] + t * b[j];
  const low = mix(0);
  const high = mix(2);
  return { low: Math.min(low, high), central: mix(1), high: Math.max(low, high) };
}

const gapAt = (table: number[], firstAge: number, age: number): number =>
  table.length === 0 ? 0 : Math.max(0, table[Math.min(Math.max(Math.round(age) - firstAge, 0), table.length - 1)] ?? 0);

/** The aging curve's decline only: its gains before the peak are the development's, never counted twice. */
const declineBetween = (model: ProductionModel, group: AgingGroup, from: number, to: number): number =>
  agingBetween(model.aging[group].map((d) => Math.min(0, d)), model.aging.firstAge, from, to);

export interface RatingsPathSeason {
  season: number;
  age: number;
  /** Years of development from now (fractional this season). */
  years: number;
  /** Share of the gap closed (null when his potential is unknown). */
  shares: { low: number; central: number; high: number } | null;
  /** WAR per 600: the central rate this season, the development and decline in it. */
  rate: number;
  /**
   * WAR per 600 at the development range's edges this season (interval arithmetic: the least and the
   * most development the path allows, the decline in both). Unknown potential: from no development to
   * the largest the save shows at his age, so it holds any known potential's range.
   */
  low: number;
  high: number;
  /** (WAR per 600)²: the development's variance this season, for the blend with results. */
  devVariance: number;
}

export interface RatingsPath {
  kind: ProductionKind;
  group: AgingGroup;
  rated: RatedAbility;
  seasons: RatingsPathSeason[];
}

/** The largest development variance the save shows at his age, (WAR per 600)², per season: the widening when it is not known. */
export function unknownDevelopmentVariance(ratings: RatingsModel, group: AgingGroup, age: number, f: number, horizon = H): number[] {
  const gmax = gapAt(ratings.potentialGap[group], ratings.potentialGap.firstAge, age);
  return Array.from({ length: horizon }, (_, i) => {
    const s = developmentShares(ratings.development, group, age, i + 1 - f);
    const width = (s.high - Math.min(s.low, 0)) * gmax;
    return (width / (2 * Z_OUTER)) ** 2;
  });
}

/** His ratings-implied rate season by season: development toward potential, then decline. */
export function ratingsPath(
  ev: RatingsEvidence, kind: ProductionKind, ctx: { season: number; f: number; age: number; horizon?: number },
  ratings: RatingsModel, production: ProductionModel,
): RatingsPath | { reason: string } {
  const read = rateFromRatings(ev, kind, ratings);
  if ('reason' in read) return read;
  const rated: RatedAbility = { ...read, variance600: ratingsVariance(read, kind, ratings, production) };
  const group: AgingGroup = kind === 'hitter' ? 'hitter' : 'pitcher';
  const horizon = ctx.horizon ?? H;
  const originAge = ctx.age - 1 + ctx.f;
  const widening = unknownDevelopmentVariance(ratings, group, ctx.age, ctx.f, horizon);
  const seasons: RatingsPathSeason[] = [];
  for (let i = 0; i < horizon; i += 1) {
    const years = i + 1 - ctx.f;
    const decline = declineBetween(production, group, originAge, ctx.age + i);
    const s = developmentShares(ratings.development, group, ctx.age, years);
    const gmax = gapAt(ratings.potentialGap[group], ratings.potentialGap.firstAge, ctx.age);
    const raw = rated.atPotential === null ? null : rated.atPotential - rated.now;
    // A potential beyond the largest development the save shows at his age is read at that largest, so an
    // unknown potential's range always holds a known one's
    const gap = raw === null ? null : Math.sign(raw) * Math.min(Math.abs(raw), gmax);
    // The central: his current ability developed toward a known potential (none assumed when it is unknown)
    const rate = rated.now + (gap === null ? 0 : s.central * gap) + decline;
    if (rated.partial) {
      // Something is missing: the range runs from the least development, and the lowest his missing grades
      // could be, to the largest development the save shows at his age, and the highest they could be.
      // Any complete evidence consistent with what is known lies inside it
      seasons.push({
        season: ctx.season + i, age: ctx.age + i, years, shares: gap === null ? null : s, rate,
        low: rated.nowLow + Math.min(s.low, 0) * gmax + decline, high: rated.nowHigh + s.high * gmax + decline,
        devVariance: widening[i],
      });
      continue;
    }
    const bounded = gap as number;
    const ends = [rated.now + s.low * bounded + decline, rated.now + s.high * bounded + decline];
    const width = Math.abs((s.high - s.low) * bounded);
    seasons.push({
      season: ctx.season + i, age: ctx.age + i, years, shares: s, rate,
      low: Math.min(...ends), high: Math.max(...ends),
      devVariance: Math.min((width / (2 * Z_OUTER)) ** 2, widening[i]),
    });
  }
  return { kind, group, rated, seasons };
}

export function abilityPriorOf(path: RatingsPath): AbilityPrior {
  return {
    rate600: path.rated.now,
    variance600: path.rated.variance600,
    path600: path.seasons.map((s) => s.rate - path.rated.now),
    pathVariance600: path.seasons.map((s) => s.devVariance),
  };
}

// ── the projection with ratings ──────────────────────────────────────────────

/** The inputs a ratings-aware projection adds to the results projection's. */
export interface RatingsProductionInput extends ProductionInput {
  /** His ability evidence, built by `ratingsEvidence` from the adapter; absent or null when there is none. */
  ratings?: RatingsEvidence | null;
  /** His club's level (1 the majors, 2 Triple-A, ...), an objective fact; null when no club holds him. */
  level?: number | null;
  /** His professional pitching in the window at every level (games, starts): a pitcher's role without a major-league line. */
  proUsage?: { games: number; starts: number } | null;
}

const SAME_TIME_CAVEAT =
  'Same-time fit: his ratings now against major leaguers\' rates around now describe what the ratings go with on this save; they are not a forecast, and a historical save\'s ratings were set from the same seasons.';

function abilityBasisOf(
  ev: RatingsEvidence | null | undefined, path: RatingsPath | null, reason: string | null, ratings: RatingsModelInForce,
): AbilityBasis {
  const dev = ratings.model.development;
  return {
    status: path ? 'used' : 'unknown',
    reason: path ? null : reason,
    evidence: {
      status: ev?.status ?? 'unknown',
      missing: ev?.missing ?? ['every scouted rating'],
      provenance: ev?.provenance ?? 'declared_organization_visible',
      verification: ev?.verification ?? 'not_verifiable_from_export',
    },
    variant: path?.rated.variant ?? null,
    bat: path?.rated.bat ?? null,
    currentRate: path?.rated.now ?? null,
    potentialRate: path?.rated.atPotential ?? null,
    uncertainty: path ? Math.sqrt(path.rated.variance600) : null,
    reliability: path ? (typeof ratings.model.reliability?.[path.kind]?.variance600 === 'number' ? 'save_snapshots' : 'kind_K') : null,
    development: path
      ? {
        source: path.rated.atPotential === null ? 'unknown' : dev.groups?.[path.group] ?? dev.source,
        label: path.rated.atPotential === null
          ? 'His scouted potential is not known: no development is assumed, and the band widens by the largest development the save shows at his age.'
          : dev.label,
        path: path.seasons.map((s) => ({ season: s.season, low: s.shares?.low ?? 0, central: s.shares?.central ?? 0, high: s.shares?.high ?? 0 })),
      }
      : null,
    model: ratings.provenance,
    caveat: SAME_TIME_CAVEAT,
  };
}

/** A pitcher's kind without a major-league line: his professional starts, else his stamina against the save's cut. */
function pitcherKind(input: RatingsProductionInput, ev: RatingsEvidence, ratings: RatingsModel): ProductionKind | { reason: string } {
  const pro = input.proUsage;
  if (pro && pro.games > 0) return pro.starts / pro.games >= PRODUCTION_POLICY.starterShare ? 'starter' : 'reliever';
  if (ev.stamina !== null && ratings.staminaCut !== null) return ev.stamina >= ratings.staminaCut ? 'starter' : 'reliever';
  return { reason: 'He has no professional games in the window, and his stamina or the save\'s starter cut is not established, so starter or reliever cannot be read.' };
}

// The standard normal distribution function (Abramowitz and Stegun 7.1.26, error under 1.5e-7)
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

interface Mixture {
  /** Chance of any playing time. */
  chance: number;
  /** Components when he plays: wins ~ N(m, s²) at each playing-time node. */
  parts: Array<{ m: number; s: number }>;
}

function mixtureQuantile(mix: Mixture, p: number): number {
  const J = mix.parts.length;
  const c = J > 0 ? mix.chance : 0;
  const cdf = (w: number): number => {
    let t = (1 - c) * (w >= 0 ? 1 : 0);
    if (J > 0) {
      let sum = 0;
      for (const x of mix.parts) sum += x.s > 0 ? phi((w - x.m) / x.s) : (w >= x.m ? 1 : 0);
      t += (c / J) * sum;
    }
    return t;
  };
  let lo = 0;
  let hi = 0;
  for (const x of mix.parts) {
    lo = Math.min(lo, x.m - 8 * x.s);
    hi = Math.max(hi, x.m + 8 * x.s);
  }
  if (cdf(lo) >= p) return lo;
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) >= p) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Quantile of the playing time itself: none with the chance's complement, else a node. */
function usageQuantile(chance: number, nodes: number[], p: number): number {
  if (nodes.length === 0 || p <= 1 - chance) return 0;
  const k = Math.min(nodes.length - 1, Math.max(0, Math.ceil(((p - (1 - chance)) / chance) * nodes.length) - 1));
  return nodes[k];
}

/** The arrival cell for his side, level and age: the one whose age band holds him, else the nearest. */
export function arrivalCellFor(arrival: ArrivalModel, side: ProductionSide, level: number, age: number): ArrivalCell | null {
  const cells = arrival.cells.filter((c) => c.side === side && c.level === level);
  if (cells.length === 0) return null;
  const a = Math.round(age);
  return cells.find((c) => a >= c.ageFrom && a <= c.ageTo)
    ?? cells.reduce((best, c) => (Math.min(Math.abs(a - c.ageFrom), Math.abs(a - c.ageTo)) < Math.min(Math.abs(a - best.ageFrom), Math.abs(a - best.ageTo)) ? c : best));
}

/** The chance's multiplier for his potential tier (the save's own snapshots), 1 when not measured. */
function potentialMultiplier(arrival: ArrivalModel, group: AgingGroup, potential: number | null, h: number): number {
  const bp = arrival.byPotential;
  if (!bp || potential === null) return 1;
  const cuts = bp.cuts[group] ?? [];
  const tier = cuts.findIndex((c) => potential <= c);
  const row = bp.multipliers[group]?.[tier === -1 ? cuts.length : tier];
  const m = row?.[h];
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 1;
}

/**
 * A player with no major-league results: his production from his ratings and his expected arrival,
 * or unknown with why.
 */
export function projectFromRatings(input: RatingsProductionInput, production: { model: ProductionModel; provenance: ModelProvenance }, ratings: RatingsModelInForce): PlayerProduction {
  const horizon = Math.min(input.horizon ?? H, H);
  const no = (why: string): PlayerProduction => {
    const p = unknownProduction(input, `${PRODUCTION_NO_EVIDENCE}: ${why}`, production.model, production.provenance);
    p.basis.ability = abilityBasisOf(input.ratings, null, why, ratings);
    return p;
  };
  const ev = input.ratings ?? null;
  if (input.season === null || input.seasonPlayed === null || input.age === null) {
    const plan = planSides(input);
    return unknownProduction(input, plan.ok ? 'An input is missing.' : plan.reason, production.model, production.provenance);
  }
  if (!ev || ev.group === null || ev.status === 'unknown') return no('no scouted ratings to project from');
  const season = input.season;
  const f = Math.min(Math.max(input.seasonPlayed, 0), 1);
  const age = input.age;
  const side: ProductionSide = ev.group === 'hitter' ? 'batting' : 'pitching';
  const kind = ev.group === 'hitter' ? 'hitter' : pitcherKind(input, ev, ratings.model);
  if (typeof kind !== 'string') return no(kind.reason);
  const path = ratingsPath(ev, kind, { season, f, age, horizon }, ratings.model, production.model);
  if ('reason' in path) return no(path.reason);
  const unknownArrival = (why: string): PlayerProduction => {
    const p = unknownProduction(input, `His ability is projected, but his major-league playing time is not established: ${why}`, production.model, production.provenance);
    p.basis.ability = abilityBasisOf(ev, path, null, ratings);
    return p;
  };
  if (input.level === null || input.level === undefined) return unknownArrival('no club holds him at a level.');
  if (input.level === 1) {
    return unknownArrival('his club\'s level is the majors but he has no major-league line in the window (a signed amateur not yet assigned, or a player yet to appear): how much such a player plays is not measured from the save\'s history.');
  }
  const arrival = ratings.model.arrival;
  if (!arrival) return unknownArrival('how often players at his level and age reach the majors has not been measured on this save.');
  if (!arrival.levels.includes(input.level)) return unknownArrival(`the save's history has no measured arrivals from level ${input.level}.`);
  const cell = arrivalCellFor(arrival, side, input.level, age);
  if (!cell) return unknownArrival(`the save's history has no ${side === 'batting' ? 'hitters' : 'pitchers'} at level ${input.level} to measure from.`);
  const missingHorizon = cell.horizons.slice(0, horizon).findIndex((h) => h === null);
  if (missingHorizon !== -1) return unknownArrival(`the save's history does not reach ${missingHorizon} season${missingHorizon === 1 ? '' : 's'} ahead from level ${input.level}.`);

  const k = production.model.kinds[kind];
  // What is not known about his true rate given the ratings (the forecast reliability, or the kind's own K)
  const var600 = path.rated.variance600;
  const noise = k.noise600 / PER;
  const seasons: ProductionSeason[] = [];
  const arrivalSeasons: ArrivalBasis['seasons'] = [];
  // The rate band's half-widths, carried forward: never narrower in a season further out
  const half = { outerLow: 0, outerHigh: 0, innerLow: 0, innerHigh: 0 };
  const notes = new Set<string>();
  for (let i = 0; i < horizon; i += 1) {
    const x = path.seasons[i];
    const A = cell.horizons[i] as ArrivalHorizon;
    const share = i === 0 ? 1 - f : 1;
    const chance = Math.min(1, A.chance * potentialMultiplier(arrival, path.group, ev.composite.potential, i));
    const nodes = A.nodes.map((u) => u * share);
    const drift = Math.max(0, atHorizon(k.horizons, Math.max(x.years, 1), (row) => row.drift600 ?? 0));
    // What is not known about his true rate this season (the ratings' reliability and talent drift); the
    // development's range enters by interval arithmetic: low edge with the least, high edge with the most
    const sd = Math.sqrt(var600 + drift);
    const rs = sd / PER;
    const mixAt = (rate600: number): Mixture => ({ chance, parts: nodes.map((u) => ({ m: (u * rate600) / PER, s: Math.sqrt(u * u * rs * rs + u * noise) })) });
    const expected = chance * A.mean * share;
    const central = (expected * x.rate) / PER;
    const outerLow = (1 - PRODUCTION_POLICY.coverage.outer) / 2;
    const innerLow = (1 - PRODUCTION_POLICY.coverage.inner) / 2;
    const atLow = mixAt(x.low);
    const atHigh = mixAt(x.high);
    // The edges hold the expected wins at the range's ends too (when the chance of playing is small, a
    // quantile is exactly zero and the expectation lies above it); the low edge always includes never
    // producing a major-league win: no playing time at all
    const lowMean = (expected * x.low) / PER;
    const highMean = (expected * x.high) / PER;
    const wins: WinsBand = {
      low: Math.min(mixtureQuantile(atLow, outerLow), central, lowMean, 0), central,
      high: Math.max(mixtureQuantile(atHigh, 1 - outerLow), central, highMean),
    };
    const inner = inside({
      low: Math.min(mixtureQuantile(atLow, innerLow), central, lowMean), central,
      high: Math.max(mixtureQuantile(atHigh, 1 - innerLow), central, highMean),
    }, wins);
    const usage: WinsBand = { low: usageQuantile(chance, nodes, outerLow), central: expected, high: Math.max(usageQuantile(chance, nodes, 1 - outerLow), expected) };
    half.outerLow = Math.max(half.outerLow, x.rate - (x.low - Z_OUTER * sd));
    half.outerHigh = Math.max(half.outerHigh, x.high + Z_OUTER * sd - x.rate);
    half.innerLow = Math.max(half.innerLow, x.rate - (x.low - Z_INNER * sd));
    half.innerHigh = Math.max(half.innerHigh, x.high + Z_INNER * sd - x.rate);
    const rateBand: WinsBand = { low: x.rate - half.outerLow, central: x.rate, high: x.rate + half.outerHigh };
    const rateInner: WinsBand = { low: x.rate - Math.min(half.innerLow, half.outerLow), central: x.rate, high: x.rate + Math.min(half.innerHigh, half.outerHigh) };
    if (chance < 1 - outerLow) notes.add('Producing nothing (no major-league playing time) is inside the band.');
    arrivalSeasons.push({ season: x.season, chance, expected });
    seasons.push({
      season: x.season, horizon: i + 1 - f, age: x.age, wins, inner,
      toDate: i === 0 ? 0 : null, remaining: i === 0 ? wins : null,
      sides: [{ side, kind, wins, inner, rate: x.rate, rateBand, rateInner, aging: x.rate - path.rated.now, usage, arrival: { chance } }],
      notes: [...notes],
      coverage: {
        horizon: i + 1,
        target: { outer: PRODUCTION_POLICY.coverage.outer, inner: PRODUCTION_POLICY.coverage.inner },
        observed: null,
        note: 'Not measured: a projection from ratings cannot be backtested until the save holds rating snapshots across seasons; the arrival part\'s held-out check is in the ratings fit\'s record.',
      },
    });
  }
  const basis = basisShell(input, production.model, ratings.provenance);
  basis.source = 'ratings';
  basis.ability = abilityBasisOf(ev, path, null, ratings);
  basis.arrival = {
    level: input.level, age,
    band: { ageFrom: cell.ageFrom, ageTo: cell.ageTo, cases: cell.cases },
    seasons: arrivalSeasons,
    conditioned: arrival.byPotential ? 'level_age_and_potential' : 'level_and_age',
    note: arrival.byPotential
      ? 'How often players at his level and age reached the majors on this save, and how much they played, with the chance moved by his potential where the save\'s own rating snapshots measured it.'
      : 'How often players at his level and age reached the majors on this save, and how much they played: not yet conditioned on his ratings (the save does not hold rating snapshots across seasons).',
  };
  basis.sides = [{
    side, kind, seasons: [], opportunities: 0, effectiveSample: 0, observedRate: null,
    regressedRate: path.rated.now, regressionShare: 1, mean: path.rated.now, rateUncertainty: Math.sqrt(var600), usagePerSeason: [0, 0, 0],
    blend: { results: 0, ratings: 1, reliabilitySample: (k.noise600 * PER) / var600, ratingsRate: path.rated.now, resultsRate: null },
  }];
  return { playerId: input.playerId, status: 'projected', reason: null, unit: PRODUCTION_UNIT, seasons, basis };
}

/**
 * A player's expected production, results and ratings together: with a major-league record his rate
 * leans on his ratings as his record thins; without one, it is his ratings and his arrival alone; with
 * neither, unknown. The results model and the ratings model are each the save's own or the prior.
 */
export function projectWithRatings(input: RatingsProductionInput, production: { model: ProductionModel; provenance: ModelProvenance }, ratings: RatingsModelInForce): PlayerProduction {
  const plan = planSides(input);
  if (!plan.ok) {
    if (plan.code === 'no_results') return projectFromRatings(input, production, ratings);
    return unknownProduction(input, plan.reason, production.model, production.provenance);
  }
  const ev = input.ratings ?? null;
  const priors: Partial<Record<ProductionSide, AbilityPrior>> = {};
  const widen: Partial<Record<ProductionSide, number[]>> = {};
  let used: RatingsPath | null = null;
  let why: string | null = null;
  for (const { side, kind } of plan.sides) {
    const group: AgingGroup = side === 'batting' ? 'hitter' : 'pitcher';
    const path = ev && ev.group === group && ev.status !== 'unknown'
      ? ratingsPath(ev, kind, { season: plan.season, f: plan.f, age: plan.age, horizon: input.horizon }, ratings.model, production.model)
      : { reason: ev && ev.group !== null && ev.group !== group ? `No ${group === 'hitter' ? 'batting' : 'pitching'} ratings are read for his ${side} side.` : 'No scouted ratings.' };
    if ('reason' in path) {
      // Ability unknown: the development the save shows at his age is not known either, so the band widens by the largest
      widen[side] = unknownDevelopmentVariance(ratings.model, group, plan.age, plan.f, input.horizon ?? H);
      why = why ?? path.reason;
    } else {
      // Measured as a forecast on the save's snapshots, the ratings pull his rate fully; until then, only for
      // what his results do not already carry (B-06: a historical save's ratings were set from these results)
      priors[side] = { ...abilityPriorOf(path), forecast: typeof ratings.model.reliability?.[kind]?.variance600 === 'number' };
      used = used ?? path;
    }
  }
  const p = projectProductionWith({ ...input, abilityPrior: priors, abilityUnknownWidening: widen }, production.model, production.provenance);
  p.basis.ability = abilityBasisOf(ev, used, used ? null : why, ratings);
  return p;
}
