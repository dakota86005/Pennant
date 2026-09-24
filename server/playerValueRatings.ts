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
 *                    (measured; when it cannot be measured, unknown), read for a player not yet called up at
 *                    this point of his season (those called up later in theirs count in proportion to the
 *                    season still to play), and moved by his projected quality by the results fit's own effect,
 *                    located so the players of his cell now keep its measured chance and playing time
 *                    (hardening F4). His wins band is that mixture: the chance of no playing time at all, or
 *                    playing time times his rate. Its low edge always includes producing nothing.
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
  scheduleOf, unknownProduction,
  type AbilityBasis, type AbilityPrior, type AgingGroup, type ArrivalBasis, type ModelProvenance, type PlayerProduction,
  type ProductionInput, type ProductionKind, type ProductionModel, type ProductionSeason, type ProductionSide, type SideSeason,
  type UnestablishedSeason, type WinsBand,
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

/** A group of cases' chance of any major-league playing time and how much they played when they did. */
export interface ArrivalSummary {
  cases: number;
  /** Share with any major-league playing time. */
  chance: number;
  /** Mean opportunities among those who played. */
  mean: number;
  /** Their opportunities at equal-probability nodes (ascending). */
  nodes: number[];
}

/**
 * How often players at a level and age reached the majors, per horizon (0 = the rest of this season). At
 * horizon 0 the summary is of every case. Beyond it (hardening F4, C-01) the summary is of the cases NOT
 * called up in their origin season, and those who were are kept apart in `arrived` with their share, so a
 * player not yet called up part-way through his season is read as one of either in proportion to the season
 * still to play (`arrivalReading`).
 */
export interface ArrivalHorizon extends ArrivalSummary {
  /** Horizon 1 and later: the cases called up in their origin season; null when there were none. */
  arrived?: ArrivalSummary | null;
  /** Horizon 1 and later: the share of this horizon's cases called up in their origin season. */
  upShare?: number | null;
  /**
   * The cell's players now at this horizon, a sample in order of quality (RATINGS_POLICY.arrival.populationNodes):
   * [the chance's quality term (the results fit's logistic coefficient × his projected rate above replacement),
   * the playing time's quality term (its coefficient × the same, opportunities per scheduled game)]. Null or
   * absent: not measured, and the chance and playing time are the cell's for every player in it.
   */
  population?: Array<[number, number]> | null;
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
  /**
   * The results fit's own effect of quality at the same usage, per kind and horizon (0 = the rest of this
   * season, read at the first season's): on the chance's logit, and on playing time when he plays
   * (opportunities per scheduled game), per WAR per 600 above replacement, never negative (hardening F4,
   * C-02). Null or absent: a prospect's chance and playing time are his cell's.
   */
  quality?: { chance: Record<ProductionKind, number[]>; perGame: Record<ProductionKind, number[]> } | null;
  /**
   * The horizons adopted (hardening F6, the owner's option (b)): 0 through `through`, a contiguous run whose held-out
   * checks each passed the gate; every later horizon is not established, with the gate's finding there (`reason`, which
   * names the horizon), and the served cells carry nothing past `through`. Null or absent: every horizon the cells
   * carry is served (a model made outside the gate: a test's, or one fitted with no hold-out).
   */
  adopted?: { through: number; notEstablished: Array<{ horizon: number; reason: string }> } | null;
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
    // Evidence that lists something missing is never "complete" (hardening C-14): a glove or running grade counts too
    status: ability.status === 'complete' && missing.length > 0 ? 'partial' : ability.status,
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
export function pitcherKindWithoutMajors(pro: { games: number; starts: number } | null | undefined, ev: RatingsEvidence, staminaCut: number | null): ProductionKind | { reason: string } {
  if (pro && pro.games > 0) return pro.starts / pro.games >= PRODUCTION_POLICY.starterShare ? 'starter' : 'reliever';
  if (ev.stamina !== null && staminaCut !== null) return ev.stamina >= staminaCut ? 'starter' : 'reliever';
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
  // No chance of playing: nothing, exactly
  if (!(c > 0)) return 0;
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

/** A chance of any major-league playing time, and the opportunities when he plays (mean, equal-probability nodes). */
export interface ArrivalReading {
  chance: number;
  mean: number;
  nodes: number[];
}

/** Equal-probability nodes of a weighted mixture of node sets (each set's nodes equally likely within it). */
function mixNodes(sets: Array<{ nodes: number[]; weight: number }>, J: number): number[] {
  const points: Array<[number, number]> = [];
  for (const s of sets) {
    if (!(s.weight > 0) || s.nodes.length === 0) continue;
    for (const v of s.nodes) points.push([v, s.weight / s.nodes.length]);
  }
  if (points.length === 0 || J <= 0) return [];
  points.sort((a, b) => a[0] - b[0]);
  const total = points.reduce((t, p) => t + p[1], 0);
  const out: number[] = [];
  let k = 0;
  let below = 0;
  for (let j = 0; j < J; j += 1) {
    const target = ((j + 0.5) / J) * total;
    while (k < points.length - 1 && below + points[k][1] < target) {
      below += points[k][1];
      k += 1;
    }
    out.push(points[k][0]);
  }
  return out;
}

/**
 * A horizon's reading for a player not yet called up part-way through his origin season, with `stillToCome`
 * the share of that season's call-ups still ahead of him (hardening F4, C-01). The rest of this season: of the
 * season's call-ups, those still to come, among the players not yet called up. A later season: the players
 * passed over for the whole origin season and those called up later in theirs, the latter in proportion to the
 * call-ups still to come. At the season's start (all still to come) it is every case's own rate; with none
 * still to come, it is the players passed over for the whole season.
 */
export function arrivalReading(A: ArrivalHorizon, h: number, stillToCome: number): ArrivalReading {
  const w = Math.min(Math.max(stillToCome, 0), 1);
  if (h === 0) {
    const p = A.chance;
    const notYet = 1 - p * (1 - w);
    return { chance: notYet > 0 ? (p * w) / notYet : 0, mean: A.mean, nodes: A.nodes };
  }
  const up = A.arrived ?? null;
  const u = Math.min(Math.max(A.upShare ?? 0, 0), 1);
  if (!up || !(u > 0)) return { chance: A.chance, mean: A.mean, nodes: A.nodes };
  const mass = (1 - u) + u * w;
  if (!(mass > 0)) return { chance: A.chance, mean: A.mean, nodes: A.nodes };
  const a = (1 - u) * A.chance;
  const b = u * w * up.chance;
  if (!(a + b > 0)) return { chance: 0, mean: A.mean, nodes: A.nodes };
  return {
    chance: (a + b) / mass,
    mean: (a * A.mean + b * up.mean) / (a + b),
    nodes: mixNodes([{ nodes: A.nodes, weight: a }, { nodes: up.nodes, weight: b }], Math.max(A.nodes.length, up.nodes.length)),
  };
}

const sigmoid = (t: number): number => 1 / (1 + Math.exp(-Math.min(Math.max(t, -30), 30)));

/** Where the quality effect sits on a cell's players for a chance, remembered per population and chance (the same for every player of the cell). */
const located = new WeakMap<ReadonlyArray<readonly [number, number]>, Map<number, { alpha: number | null; yBar: number }>>();

/**
 * The location α at which the cell's players now, with their quality terms, keep the chance `p` together
 * (their mean of σ(α + z) is p), and their playing-time term weighted by that chance (who arrives from the
 * cell is weighted by his chance, so the playing time measured is theirs).
 */
function locateOn(population: ReadonlyArray<readonly [number, number]>, p: number): { alpha: number | null; yBar: number } {
  let memo = located.get(population);
  if (!memo) { memo = new Map(); located.set(population, memo); }
  const had = memo.get(p);
  if (had) return had;
  let alpha: number | null = null;
  if (p > 0 && p < 1) {
    let lo = -40;
    let hi = 40;
    for (let k = 0; k < 80; k += 1) {
      const mid = (lo + hi) / 2;
      const m = population.reduce((t, [zj]) => t + sigmoid(mid + zj), 0) / population.length;
      if (m < p) lo = mid;
      else hi = mid;
    }
    alpha = (lo + hi) / 2;
  }
  const weights = population.map(([zj]) => (alpha === null ? 1 : sigmoid(alpha + zj)));
  const W = weights.reduce((t, x) => t + x, 0);
  const yBar = W > 0 ? population.reduce((t, [, yj], j) => t + weights[j] * yj, 0) / W : 0;
  const out = { alpha, yBar };
  memo.set(p, out);
  return out;
}

/**
 * His reading moved by his projected quality (hardening F4, C-02): the results fit's effect of quality on the
 * chance's logit (`z`, his term) and on playing time when he plays (`y`, opportunities per scheduled game),
 * located on the cell's players now (`population`, their terms) so that together they keep the cell's measured
 * chance, and, weighted by that chance, its playing time when they play. A better player is likelier to arrive
 * and plays more; one at replacement or below (a term of zero) is below the cell's average when better players
 * share his cell. `tiltChance` false keeps the cell's chance (the chance by potential is measured instead).
 */
export function qualityReading(
  base: ArrivalReading, population: ReadonlyArray<readonly [number, number]>, z: number, y: number, games: number | null, tiltChance = true,
): ArrivalReading {
  if (population.length === 0) return base;
  const { alpha, yBar } = locateOn(population, base.chance);
  const chance = tiltChance && alpha !== null ? sigmoid(alpha + z) : base.chance;
  if (games === null || !(games > 0) || !(base.mean > 0)) return { ...base, chance };
  const mean = Math.max(0, base.mean + games * (y - yBar));
  const r = mean / base.mean;
  return { chance, mean, nodes: base.nodes.map((u) => u * r) };
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
    // Nothing could be projected: no results and no usable ability evidence (hardening F5: named, never blank)
    p.basis.source = 'none';
    p.basis.ability = abilityBasisOf(input.ratings, null, why, ratings);
    return p;
  };
  const ev = input.ratings ?? null;
  if (input.season === null || input.seasonPlayed === null || input.age === null) {
    const plan = planSides(input);
    const p = unknownProduction(input, plan.ok ? 'An input is missing.' : plan.reason, production.model, production.provenance);
    p.basis.source = 'none';
    return p;
  }
  if (!ev || ev.group === null || ev.status === 'unknown') return no('no scouted ratings to project from');
  const season = input.season;
  const f = Math.min(Math.max(input.seasonPlayed, 0), 1);
  const age = input.age;
  const side: ProductionSide = ev.group === 'hitter' ? 'batting' : 'pitching';
  const kind = ev.group === 'hitter' ? 'hitter' : pitcherKindWithoutMajors(input.proUsage, ev, ratings.model.staminaCut);
  if (typeof kind !== 'string') return no(kind.reason);
  const path = ratingsPath(ev, kind, { season, f, age, horizon }, ratings.model, production.model);
  if ('reason' in path) return no(path.reason);
  const unknownArrival = (why: string): PlayerProduction => {
    const p = unknownProduction(input, `His ability is projected, but his major-league playing time is not established: ${why}`, production.model, production.provenance);
    // His ability rests on his scouted ratings; what is unknown is his playing time (hardening F5: named, never blank)
    p.basis.source = 'ratings';
    p.basis.ability = abilityBasisOf(ev, path, null, ratings);
    return p;
  };
  if (input.level === null || input.level === undefined) return unknownArrival('no club holds him at a level.');
  if (input.level === 1) {
    return unknownArrival('his club\'s level is the majors but he has no major-league line in the window (a signed amateur not yet assigned, or a player yet to appear): how much such a player plays is not measured from the save\'s history.');
  }
  const arrival = ratings.model.arrival;
  if (!arrival) {
    // Measured but not adopted (the gate failed) is not "not measured": the label says which, and why
    return unknownArrival(ratings.provenance.source === 'fallback_prior' && /not adopted/.test(ratings.provenance.label)
      ? `how often players at his level and age reach the majors is not established on this save: ${ratings.provenance.label.replace(/^not yet calibrated on this save: /, '')}`
      : 'how often players at his level and age reach the majors has not been measured on this save.');
  }
  if (!arrival.levels.includes(input.level)) return unknownArrival(`the save's history has no measured arrivals from level ${input.level}.`);
  const cell = arrivalCellFor(arrival, side, input.level, age);
  if (!cell) return unknownArrival(`the save's history has no ${side === 'batting' ? 'hitters' : 'pitchers'} at level ${input.level} to measure from.`);
  // The arrival model adopted horizon by horizon (hardening F6): the seasons through the last adopted horizon are served,
  // and each later one is not established with the gate's finding there, never extrapolated or carried forward
  const adopted = arrival.adopted ?? null;
  const served = adopted ? Math.min(horizon, adopted.through + 1) : horizon;
  const missingHorizon = cell.horizons.slice(0, served).findIndex((h) => h === null);
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
  // Playing time when he plays follows his projected quality by the results fit's measured effect, where the
  // fit measured it and located it on his cell's players (C-02); the chance too, unless the save measured the
  // chance by potential itself. The effect is per scheduled game: this season's schedule, else the model's
  const quality = arrival.quality ?? null;
  const games = scheduleOf(production.model, input.schedule).now;
  const ceilingPerGame = typeof k.ceiling === 'number' && k.ceiling > 0 ? k.ceiling : null;
  // Of this season's call-ups, the share still to come: a call-up taken as equally likely at any point of the
  // season's games (the export dates no past call-up); the band reaches none and all of them still to come (C-01)
  const stillToCome = 1 - f;
  const tilted = { chance: false, playingTime: false };
  for (let i = 0; i < served; i += 1) {
    const x = path.seasons[i];
    const A = cell.horizons[i] as ArrivalHorizon;
    const share = i === 0 ? 1 - f : 1;
    const multiplier = potentialMultiplier(arrival, path.group, ev.composite.potential, i);
    const population = A.population ?? null;
    /** His chance and playing time at a projected rate, with a share of this season's call-ups still to come. */
    const readingAt = (rate600: number, toCome: number): ArrivalReading => {
      let r = arrivalReading(A, i, toCome);
      if (quality && population && population.length > 0) {
        const q = Math.max(0, rate600);
        const zi = (quality.chance[kind]?.[i] ?? 0) * q;
        const yi = (quality.perGame[kind]?.[i] ?? 0) * q;
        const tiltChance = arrival.byPotential === null;
        r = qualityReading(r, population, zi, yi, games, tiltChance);
        tilted.chance = tilted.chance || tiltChance;
        tilted.playingTime = tilted.playingTime || games !== null;
      }
      const cap = ceilingPerGame !== null && games !== null ? ceilingPerGame * games * share : Infinity;
      return {
        chance: Math.min(1, r.chance * multiplier),
        mean: Math.min(r.mean * share, cap),
        nodes: r.nodes.map((u) => Math.min(u * share, cap)),
      };
    };
    const at = readingAt(x.rate, stillToCome);
    // The band's edges, by interval arithmetic over what is not measured: each edge's rate with the playing time
    // that rate's quality goes with (playing time follows quality, so a low rate never takes a high rate's playing
    // time), and none or all of this season's call-ups still to come
    const distinct = (list: ArrivalReading[]) => list.filter((s, j) => list.findIndex((o) => o.chance === s.chance && o.mean === s.mean && o.nodes.length === s.nodes.length && o.nodes.every((u, k) => u === s.nodes[k])) === j);
    const lows = distinct([readingAt(x.low, 0), readingAt(x.low, 1)]);
    const highs = distinct([readingAt(x.high, 0), readingAt(x.high, 1)]);
    const drift = Math.max(0, atHorizon(k.horizons, Math.max(x.years, 1), (row) => row.drift600 ?? 0));
    // What is not known about his true rate this season (the ratings' reliability and talent drift); the
    // development's range enters by interval arithmetic: low edge with the least, high edge with the most
    const sd = Math.sqrt(var600 + drift);
    const rs = sd / PER;
    const mixAt = (s: ArrivalReading, rate600: number): Mixture => ({ chance: s.chance, parts: s.nodes.map((u) => ({ m: (u * rate600) / PER, s: Math.sqrt(u * u * rs * rs + u * noise) })) });
    const chance = at.chance;
    const expected = at.chance * at.mean;
    const central = (expected * x.rate) / PER;
    const outerLow = (1 - PRODUCTION_POLICY.coverage.outer) / 2;
    const innerLow = (1 - PRODUCTION_POLICY.coverage.inner) / 2;
    // The edges hold the expected wins at the range's ends too (when the chance of playing is small, a
    // quantile is exactly zero and the expectation lies above it); the low edge always includes never
    // producing a major-league win: no playing time at all
    const lowMean = Math.min(...lows.map((s) => (s.chance * s.mean * x.low) / PER));
    const highMean = Math.max(...highs.map((s) => (s.chance * s.mean * x.high) / PER));
    const lowAt = (p: number) => Math.min(...lows.map((s) => mixtureQuantile(mixAt(s, x.low), p)));
    const highAt = (p: number) => Math.max(...highs.map((s) => mixtureQuantile(mixAt(s, x.high), p)));
    const wins: WinsBand = {
      low: Math.min(lowAt(outerLow), central, lowMean, 0), central,
      high: Math.max(highAt(1 - outerLow), central, highMean),
    };
    const inner = inside({
      low: Math.min(lowAt(innerLow), central, lowMean), central,
      high: Math.max(highAt(1 - innerLow), central, highMean),
    }, wins);
    const usage: WinsBand = {
      low: Math.min(...lows.map((s) => usageQuantile(s.chance, s.nodes, outerLow)), expected),
      central: expected,
      high: Math.max(...highs.map((s) => usageQuantile(s.chance, s.nodes, 1 - outerLow)), expected),
    };
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
  const notEstablished: UnestablishedSeason[] = [];
  for (let i = served; i < horizon && adopted; i += 1) {
    const x = path.seasons[i];
    const finding = adopted.notEstablished.find((n) => n.horizon === i)?.reason ?? `${i} seasons out: not adopted`;
    notEstablished.push({
      season: x.season, horizon: i + 1 - f, age: x.age,
      reason: `His expected production in ${x.season} is not established: the save's arrival model is adopted only through ${adopted.through === 1 ? '1 season' : `${adopted.through} seasons`} out, where its held-out check passed the gate; ${finding}.`,
    });
  }
  const basis = basisShell(input, production.model, ratings.provenance);
  basis.source = 'ratings';
  basis.ability = abilityBasisOf(ev, path, null, ratings);
  basis.arrival = {
    adoptedThrough: adopted ? adopted.through : null,
    level: input.level, age,
    band: { ageFrom: cell.ageFrom, ageTo: cell.ageTo, cases: cell.cases },
    seasons: arrivalSeasons,
    conditioned: arrival.byPotential
      ? (tilted.playingTime ? 'level_age_potential_and_quality' : 'level_age_and_potential')
      : (tilted.chance ? 'level_age_and_quality' : 'level_and_age'),
    note: [
      'How often players at his level and age reached the majors on this save, and how much they played, read for a player not yet called up at this point of the season: those called up later in their season count in proportion to the season still to play (the export dates no past call-up, so a call-up is taken as equally likely at any point of the season\'s games; the band reaches none and all of them still to come).',
      arrival.byPotential
        ? 'The chance is moved by his potential where the save\'s own rating snapshots measured it.'
        : tilted.chance
          ? 'His chance moves with his projected quality by the results fit\'s own effect of quality on keeping major-league playing time (at the same usage, so a conservative reading), located so the players of his level and age now keep the chance the save measured for them; the chance by his potential waits on the save\'s rating snapshots.'
          : 'Not conditioned on his ratings: the results fit\'s effect of quality was not located on his cell\'s players, and the chance by his potential waits on the save\'s rating snapshots.',
      tilted.playingTime
        ? 'His playing time when he plays moves with his projected quality by the same fit\'s effect, against the playing time of the arrivals from his cell.'
        : '',
    ].filter((s) => s.length > 0).join(' '),
  };
  basis.sides = [{
    side, kind, seasons: [], opportunities: 0, effectiveSample: 0, observedRate: null,
    regressedRate: path.rated.now, regressionShare: 1, mean: path.rated.now, rateUncertainty: Math.sqrt(var600), usagePerSeason: [0, 0, 0],
    blend: { results: 0, ratings: 1, reliabilitySample: (k.noise600 * PER) / var600, ratingsRate: path.rated.now, resultsRate: null },
  }];
  return { playerId: input.playerId, status: 'projected', reason: null, unit: PRODUCTION_UNIT, seasons, notEstablished, basis };
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
  const paths: Partial<Record<ProductionSide, RatingsPath>> = {};
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
      paths[side] = path;
      used = used ?? path;
    }
  }
  const blended = { ...input, abilityPrior: priors, abilityUnknownWidening: widen };
  const p = projectProductionWith(blended, production.model, production.provenance);
  p.basis.ability = abilityBasisOf(ev, used, used ? null : why, ratings);
  if (p.status === 'projected') widenForMissingGrades(p, blended, paths, production);
  return p;
}

/**
 * Partial ratings in the blend (hardening F4, A-15): a glove, running or current pitching grade the evidence
 * lacks can be anywhere on the scale, so the ratings-implied rate lies anywhere between its readings at the
 * scale's ends (`nowLow`, `nowHigh`). The central uses what is known; the band reaches the blend re-read across
 * that range, with the form of the mapping without the grade and with the full one (a complete reading weighs
 * the ratings by its own, smaller, uncertainty), so the band of every complete reading consistent with what is
 * known lies inside it. Interval arithmetic on the target, never a midpoint (D-018).
 */
function widenForMissingGrades(
  p: PlayerProduction, blended: RatingsProductionInput, paths: Partial<Record<ProductionSide, RatingsPath>>,
  production: { model: ProductionModel; provenance: ModelProvenance },
): void {
  const priors = blended.abilityPrior ?? {};
  for (const side of ['batting', 'pitching'] as const) {
    const path = paths[side];
    const prior = priors[side];
    if (!path || !prior) continue;
    const { now, nowLow, nowHigh, extra600 } = path.rated;
    if (!(nowLow < now - 1e-9 || nowHigh > now + 1e-9)) continue;
    const variances = [...new Set([prior.variance600, Math.max(prior.variance600 - extra600, 1e-9)])];
    const readings: PlayerProduction[] = [];
    for (const t of RATINGS_POLICY.unknownGrade.stations) {
      for (const variance600 of variances) {
        const r = projectProductionWith({
          ...blended, abilityPrior: { ...priors, [side]: { ...prior, rate600: nowLow + t * (nowHigh - nowLow), variance600 } },
        }, production.model, production.provenance);
        if (r.status === 'projected' && r.seasons.length === p.seasons.length) readings.push(r);
      }
    }
    if (readings.length === 0) continue;
    const reach = (b: WinsBand, others: WinsBand[]): WinsBand => ({
      low: Math.min(b.low, ...others.map((o) => o.low)), central: b.central, high: Math.max(b.high, ...others.map((o) => o.high)),
    });
    p.seasons.forEach((s, i) => {
      s.wins = reach(s.wins, readings.map((r) => r.seasons[i].wins));
      s.inner = inside(reach(s.inner, readings.map((r) => r.seasons[i].inner)), s.wins);
      if (s.remaining) s.remaining = reach(s.remaining, readings.map((r) => r.seasons[i].remaining ?? s.remaining as WinsBand));
      s.sides = s.sides.map((x) => {
        if (x.side !== side) return x;
        const alt = readings.map((r) => r.seasons[i].sides.find((y) => y.side === side)).filter((y): y is SideSeason => !!y);
        const wins = reach(x.wins, alt.map((y) => y.wins));
        return {
          ...x, wins, inner: inside(reach(x.inner, alt.map((y) => y.inner)), wins),
          rateBand: reach(x.rateBand, alt.map((y) => y.rateBand)), rateInner: reach(x.rateInner, alt.map((y) => y.rateInner)),
          usage: reach(x.usage, alt.map((y) => y.usage)),
        };
      });
      const missing = path.rated.variant === null ? 'a current pitching tool' : path.rated.variant === 'bat' ? 'his glove and running' : path.rated.variant === 'noGlove' ? 'his glove at his position' : 'his running';
      s.notes.push(`His scouted ${missing} is not known: the central uses what is known, and the band reaches the blend with it anywhere from the scale's low end to its high end (never a midpoint).`);
    });
    // The rate band is never narrower further out: the reached half-widths are carried forward, as the bands are
    const half = { outerLow: 0, outerHigh: 0, innerLow: 0, innerHigh: 0 };
    for (const s of p.seasons) {
      s.sides = s.sides.map((x) => {
        if (x.side !== side) return x;
        half.outerLow = Math.max(half.outerLow, x.rate - x.rateBand.low);
        half.outerHigh = Math.max(half.outerHigh, x.rateBand.high - x.rate);
        half.innerLow = Math.max(half.innerLow, x.rate - x.rateInner.low);
        half.innerHigh = Math.max(half.innerHigh, x.rateInner.high - x.rate);
        return {
          ...x,
          rateBand: { low: x.rate - half.outerLow, central: x.rateBand.central, high: x.rate + half.outerHigh },
          rateInner: { low: x.rate - Math.min(half.innerLow, half.outerLow), central: x.rateInner.central, high: x.rate + Math.min(half.innerHigh, half.outerHigh) },
        };
      });
    }
  }
}
