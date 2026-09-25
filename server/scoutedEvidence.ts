/**
 * The evidence boundary for subjective player-ability judgments.
 *
 * Player Development and Minor League Operations judge readiness, ceiling,
 * protection, role and defensive fit. Those are opinions about ability, so they
 * may only rest on what the human-managed organization could see: its scouted
 * tool ratings. This module is the one place that reads those ratings, and the
 * only way development/operations code obtains a `ScoutedAbility`.
 *
 * What is, and is not, approved evidence (docs/DECISIONS.md D-017):
 *
 *   APPROVED      the exported tool ratings — `*_ratings_overall_*` (current),
 *                 `*_ratings_talent_*` (potential), stamina and pitch grades —
 *                 and revealed fielding-position grades (`gloves.ts`); and, by
 *                 owner decision D-035, a hitter's rating SPLITS against left- and
 *                 right-handed pitching (`batting_ratings_vsl_*` / `_vsr_*`) and his
 *                 RUNNING ratings (`running_ratings_*`).
 *   PROHIBITED    every continuous `players_value` ability/talent field
 *                 (`oa`, `pot`, `oa_rating`, `pot_rating`, `overall_value`,
 *                 `talent_value`, ...). Nothing in the export establishes that
 *                 they are the organization's visible scouting evaluation, so
 *                 they are never read here and never a fallback.
 *
 * "Approved" is a product decision (D-002), not something the export proves:
 * the import carries no viewer organization, scouting-accuracy or per-field
 * visibility metadata. The provenance attached to every result says so.
 *
 * Contracts:
 *   - Missing stays missing. A grade that is absent, non-numeric or not
 *     positive is unknown; it is never replaced by a league value, another
 *     organization's view, `players_value`, or a default.
 *   - A composite exists only when EVERY component it averages is known.
 *   - Ratings are normalized to the 20-80 scouting scale so development
 *     thresholds mean the same thing on any OOTP display scale. The native
 *     scale is reported alongside.
 *   - The composite is a Pennant summary of visible tools, not OOTP's
 *     weighted, position-aware Overall.
 */

import { db, tableColumns, tableExists } from './db.js';
import { ratingScaleMax } from './valuation.js';
import { gloves, type Gloves, type PositionRating } from './gloves.js';
import { parseGameDate } from './dataFreshness.js';
import { currentSaveName, historyDb } from './history.js';

// ── Provenance ──────────────────────────────────────────────────────────

/**
 * How well the origin of a rating is established.
 *
 * `declared_organization_visible` means the owner-accepted decision D-002 names
 * these columns as the organization's scouted ratings. The export cannot verify
 * it. No stronger status is ever produced, because nothing in the import could
 * justify one.
 */
export interface EvidenceProvenance {
  source: 'exported_tool_ratings' | 'exported_fielding_ratings' | 'exported_split_and_running_ratings';
  status: 'declared_organization_visible';
  verification: 'not_verifiable_from_export';
  basis: 'DECISIONS.md D-002, D-017' | 'DECISIONS.md D-002, D-017, D-035';
}

const TOOL_PROVENANCE: EvidenceProvenance = {
  source: 'exported_tool_ratings',
  status: 'declared_organization_visible',
  verification: 'not_verifiable_from_export',
  basis: 'DECISIONS.md D-002, D-017',
};

const FIELDING_PROVENANCE: EvidenceProvenance = {
  ...TOOL_PROVENANCE,
  source: 'exported_fielding_ratings',
};

/**
 * Whose eyes these ratings are. The import encodes no viewer, so this is the
 * club the save marks as human-managed. More than one human club, or none,
 * leaves the viewer unresolved rather than guessed.
 */
export interface ViewerContext {
  viewerOrgId: number | null;
  resolution: 'human_team' | 'ambiguous_human_teams' | 'unresolved';
}

export function viewerContext(): ViewerContext {
  if (!tableExists('teams') || !tableColumns('teams').includes('human_team')) {
    return { viewerOrgId: null, resolution: 'unresolved' };
  }
  const rows = db
    .prepare(`SELECT team_id FROM teams WHERE human_team = 1 ORDER BY team_id`)
    .all() as Array<{ team_id: number }>;
  if (rows.length === 1) return { viewerOrgId: rows[0].team_id, resolution: 'human_team' };
  if (rows.length > 1) return { viewerOrgId: null, resolution: 'ambiguous_human_teams' };
  return { viewerOrgId: null, resolution: 'unresolved' };
}

// ── Scale ───────────────────────────────────────────────────────────────

/**
 * The scale the export was written on. OOTP lets the user pick 20-80, 1-20,
 * 1-10, 2-8 or 1-5 and the export carries no column saying which, so the top
 * of the scale is read off the data (`ratingScaleMax`). That is a heuristic:
 * `detected` says so, and a save whose ratings never reach the top of its
 * scale would be read one notch low.
 */
export interface RatingScale {
  max: number;
  min: number;
  /** True when the export is already on the 20-80 scale the engines use. */
  native2080: boolean;
  basis: 'detected_from_export_maximum';
}

const SCALE_MIN: Record<number, number> = { 5: 1, 8: 2, 10: 1, 20: 1, 80: 20 };

export function ratingScale(): RatingScale {
  const max = ratingScaleMax();
  return { max, min: SCALE_MIN[max] ?? 20, native2080: max === 80, basis: 'detected_from_export_maximum' };
}

/** A rating that exists: finite and positive. Zero, null and junk are unknown. */
function knownRating(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The 20-80 equivalent of a native rating. Linear between the scale's own
 * floor and ceiling; identity on a 20-80 save.
 */
function toScouting(value: number, scale: RatingScale): number {
  if (scale.native2080) return value;
  const fraction = (value - scale.min) / (scale.max - scale.min);
  return Math.round((20 + 60 * fraction) * 10) / 10;
}

// ── Tools ───────────────────────────────────────────────────────────────

export type HitterTool = 'contact' | 'gap' | 'power' | 'eye' | 'avoidK';
export type PitcherTool = 'stuff' | 'movement' | 'control';
export type ToolKey = HitterTool | PitcherTool;

const HITTER_TOOLS: ReadonlyArray<{ key: HitterTool; current: string; potential: string }> = [
  { key: 'contact', current: 'batting_ratings_overall_contact', potential: 'batting_ratings_talent_contact' },
  { key: 'gap', current: 'batting_ratings_overall_gap', potential: 'batting_ratings_talent_gap' },
  { key: 'power', current: 'batting_ratings_overall_power', potential: 'batting_ratings_talent_power' },
  { key: 'eye', current: 'batting_ratings_overall_eye', potential: 'batting_ratings_talent_eye' },
  { key: 'avoidK', current: 'batting_ratings_overall_strikeouts', potential: 'batting_ratings_talent_strikeouts' },
];

const PITCHER_TOOLS: ReadonlyArray<{ key: PitcherTool; current: string; potential: string }> = [
  { key: 'stuff', current: 'pitching_ratings_overall_stuff', potential: 'pitching_ratings_talent_stuff' },
  { key: 'movement', current: 'pitching_ratings_overall_movement', potential: 'pitching_ratings_talent_movement' },
  { key: 'control', current: 'pitching_ratings_overall_control', potential: 'pitching_ratings_talent_control' },
];

const STAMINA_COLUMN = 'pitching_ratings_misc_stamina';
const PITCH_COLUMNS = [
  'fastball', 'slider', 'curveball', 'screwball', 'forkball', 'changeup',
  'sinker', 'splitter', 'knuckleball', 'cutter', 'circlechange', 'knucklecurve',
].map((name) => `pitching_ratings_pitches_${name}`);

export type EvidenceStatus = 'complete' | 'partial' | 'unknown';

/** How a composite was formed. Named so nobody mistakes it for OOTP's Overall. */
export const COMPOSITE_METHOD = 'unweighted_mean_of_visible_tools' as const;

declare const evidenceBoundary: unique symbol;

/**
 * One player's organization-visible ability evidence.
 *
 * The brand makes this type unforgeable by accident: a bare number cannot be
 * passed where a `ScoutedAbility` is required, so a development or operations
 * function that asks for one cannot be handed a value from another source.
 * Domain tests build synthetic evidence with `syntheticScoutedAbility`.
 */
export interface ScoutedAbility {
  readonly [evidenceBoundary]: true;
  readonly playerId: number;
  readonly kind: 'hitter' | 'pitcher' | 'unknown';

  /** 20-80-equivalent composite of current visible tools; null unless every tool is known. */
  readonly current: number | null;
  /** 20-80-equivalent composite of potential visible tools; null unless every tool is known. */
  readonly potential: number | null;

  readonly currentTools: Readonly<Partial<Record<ToolKey, number | null>>>;
  readonly potentialTools: Readonly<Partial<Record<ToolKey, number | null>>>;

  /** Visible stamina and established pitch grades (positive only), 20-80-equivalent. */
  readonly stamina: number | null;
  readonly pitches: readonly number[];

  readonly missing: { current: readonly ToolKey[]; potential: readonly ToolKey[] };
  readonly status: EvidenceStatus;

  readonly method: typeof COMPOSITE_METHOD;
  readonly scale: RatingScale;
  readonly provenance: EvidenceProvenance;
  readonly viewer: ViewerContext;
}

const round = (value: number): number => Math.round(value);

/**
 * The brand is compile-time only. Every ScoutedAbility is created through this
 * function, from this module, so the type doubles as proof of origin.
 */
const brand = (fields: Omit<ScoutedAbility, typeof evidenceBoundary>): ScoutedAbility =>
  fields as unknown as ScoutedAbility;

function compositeOf(
  tools: ReadonlyArray<{ key: ToolKey }>,
  values: Partial<Record<ToolKey, number | null>>
): { value: number | null; missing: ToolKey[] } {
  const missing = tools.filter((t) => values[t.key] == null).map((t) => t.key);
  if (missing.length > 0 || tools.length === 0) return { value: null, missing };
  const sum = tools.reduce((total, t) => total + (values[t.key] as number), 0);
  return { value: round(sum / tools.length), missing };
}

function statusOf(current: number | null, potential: number | null): EvidenceStatus {
  if (current !== null && potential !== null) return 'complete';
  if (current === null && potential === null) return 'unknown';
  return 'partial';
}

interface AbilityInput {
  playerId: number;
  kind: 'hitter' | 'pitcher' | 'unknown';
  /** Native-scale values as exported; null when absent. */
  current: Partial<Record<ToolKey, unknown>>;
  potential: Partial<Record<ToolKey, unknown>>;
  stamina: unknown;
  pitches: readonly unknown[];
}

function buildAbility(input: AbilityInput, scale: RatingScale, viewer: ViewerContext): ScoutedAbility {
  const tools: ReadonlyArray<{ key: ToolKey }> =
    input.kind === 'hitter' ? HITTER_TOOLS : input.kind === 'pitcher' ? PITCHER_TOOLS : [];

  const normalize = (raw: Partial<Record<ToolKey, unknown>>): Partial<Record<ToolKey, number | null>> => {
    const out: Partial<Record<ToolKey, number | null>> = {};
    for (const { key } of tools) {
      const known = knownRating(raw[key]);
      out[key] = known === null ? null : toScouting(known, scale);
    }
    return out;
  };

  const currentTools = normalize(input.current);
  const potentialTools = normalize(input.potential);
  const current = compositeOf(tools, currentTools);
  const potential = compositeOf(tools, potentialTools);

  const stamina = knownRating(input.stamina);

  return brand({
    playerId: input.playerId,
    kind: input.kind,
    current: current.value,
    potential: potential.value,
    currentTools,
    potentialTools,
    stamina: stamina === null ? null : toScouting(stamina, scale),
    pitches: input.pitches
      .map(knownRating)
      .filter((r): r is number => r !== null)
      .map((r) => toScouting(r, scale)),
    missing: { current: current.missing, potential: potential.missing },
    status: statusOf(current.value, potential.value),
    method: COMPOSITE_METHOD,
    scale,
    provenance: TOOL_PROVENANCE,
    viewer,
  });
}

/** What the evidence says about a player nothing is known about. */
export function unknownScoutedAbility(playerId: number, kind: ScoutedAbility['kind'] = 'unknown'): ScoutedAbility {
  return buildAbility(
    { playerId, kind, current: {}, potential: {}, stamina: null, pitches: [] },
    ratingScale(),
    viewerContext()
  );
}

/**
 * Synthetic evidence for domain tests and fixtures: composites given directly.
 * Production code must obtain abilities from `loadScoutedAbilities`; nothing
 * outside tests should call this.
 */
export function syntheticScoutedAbility(input: {
  current: number | null;
  potential: number | null;
  playerId?: number;
  kind?: 'hitter' | 'pitcher';
  stamina?: number | null;
  pitches?: readonly number[];
  currentTools?: Partial<Record<ToolKey, number | null>>;
  potentialTools?: Partial<Record<ToolKey, number | null>>;
}): ScoutedAbility {
  const scale: RatingScale = { max: 80, min: 20, native2080: true, basis: 'detected_from_export_maximum' };
  return brand({
    playerId: input.playerId ?? 0,
    kind: input.kind ?? 'hitter',
    current: input.current,
    potential: input.potential,
    currentTools: input.currentTools ?? {},
    potentialTools: input.potentialTools ?? {},
    stamina: input.stamina ?? null,
    pitches: input.pitches ?? [],
    missing: { current: [], potential: [] },
    status: statusOf(input.current, input.potential),
    method: COMPOSITE_METHOD,
    scale,
    provenance: TOOL_PROVENANCE,
    viewer: { viewerOrgId: null, resolution: 'unresolved' },
  });
}

// ── Loading ─────────────────────────────────────────────────────────────

const CHUNK = 400;

/** The evidence for a set of players; a player with no row reads as unknown. */
export class ScoutedAbilities {
  private readonly byPlayer: Map<number, ScoutedAbility>;

  constructor(byPlayer: Map<number, ScoutedAbility>) {
    this.byPlayer = byPlayer;
  }

  for(playerId: number): ScoutedAbility {
    return this.byPlayer.get(playerId) ?? unknownScoutedAbility(playerId);
  }

  has(playerId: number): boolean {
    return this.byPlayer.has(playerId);
  }
}

/**
 * The single entry point for ability evidence. Objective callers decide WHICH
 * players (roster, affiliate, league population); this decides what their
 * ratings are.
 */
export function loadScoutedAbilities(playerIds: Iterable<number>): ScoutedAbilities {
  const ids = [...new Set(playerIds)].filter((id) => Number.isFinite(id));
  const out = new Map<number, ScoutedAbility>();
  if (ids.length === 0 || !tableExists('players')) return new ScoutedAbilities(out);

  const scale = ratingScale();
  const viewer = viewerContext();

  const batting = new Set(tableColumns('players_batting'));
  const pitching = new Set(tableColumns('players_pitching'));
  const hasBatting = batting.has('player_id');
  const hasPitching = pitching.has('player_id');

  const select: string[] = [];
  const alias = (has: Set<string>, prefix: string, column: string): string =>
    has.has(column) ? `${prefix}."${column}" AS "${column}"` : `NULL AS "${column}"`;
  for (const t of HITTER_TOOLS) {
    select.push(alias(hasBatting ? batting : new Set(), 'b', t.current), alias(hasBatting ? batting : new Set(), 'b', t.potential));
  }
  const pitchingSet = hasPitching ? pitching : new Set<string>();
  for (const t of PITCHER_TOOLS) {
    select.push(alias(pitchingSet, 'pp', t.current), alias(pitchingSet, 'pp', t.potential));
  }
  select.push(alias(pitchingSet, 'pp', STAMINA_COLUMN));
  for (const column of PITCH_COLUMNS) select.push(alias(pitchingSet, 'pp', column));

  const statement = (count: number) => db.prepare(
    `SELECT p.player_id, p.position, ${select.join(', ')}
     FROM players p
     ${hasBatting ? 'LEFT JOIN players_batting b ON b.player_id = p.player_id' : ''}
     ${hasPitching ? 'LEFT JOIN players_pitching pp ON pp.player_id = p.player_id' : ''}
     WHERE p.player_id IN (${new Array(count).fill('?').join(', ')})`
  );

  for (let at = 0; at < ids.length; at += CHUNK) {
    const chunk = ids.slice(at, at + CHUNK);
    const rows = statement(chunk.length).all(...chunk) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const playerId = Number(row.player_id);
      const position = Number(row.position);
      const kind: ScoutedAbility['kind'] = !Number.isFinite(position) ? 'unknown' : position === 1 ? 'pitcher' : 'hitter';
      const tools = kind === 'pitcher' ? PITCHER_TOOLS : HITTER_TOOLS;
      const current: Partial<Record<ToolKey, unknown>> = {};
      const potential: Partial<Record<ToolKey, unknown>> = {};
      for (const t of tools) {
        current[t.key] = row[t.current];
        potential[t.key] = row[t.potential];
      }
      out.set(playerId, buildAbility({
        playerId,
        kind,
        current,
        potential,
        stamina: row[STAMINA_COLUMN],
        pitches: PITCH_COLUMNS.map((column) => row[column]),
      }, scale, viewer));
    }
  }
  return new ScoutedAbilities(out);
}

// ── Reporting ───────────────────────────────────────────────────────────

/** A compact, serializable statement of what a decision rested on. */
export interface EvidenceSummary {
  status: EvidenceStatus;
  provenance: EvidenceProvenance['status'];
  verification: EvidenceProvenance['verification'];
  source: EvidenceProvenance['source'];
  method: typeof COMPOSITE_METHOD;
  scale: { max: number; normalizedTo: '20-80' };
  viewerOrgId: number | null;
  viewerResolution: ViewerContext['resolution'];
  missing: { current: readonly ToolKey[]; potential: readonly ToolKey[] };
}

export function summarizeEvidence(ability: ScoutedAbility): EvidenceSummary {
  return {
    status: ability.status,
    provenance: ability.provenance.status,
    verification: ability.provenance.verification,
    source: ability.provenance.source,
    method: ability.method,
    scale: { max: ability.scale.max, normalizedTo: '20-80' },
    viewerOrgId: ability.viewer.viewerOrgId,
    viewerResolution: ability.viewer.resolution,
    missing: ability.missing,
  };
}

// ── Fielding ────────────────────────────────────────────────────────────

const scalePosition = (rating: PositionRating, scale: RatingScale): PositionRating => ({
  ...rating,
  current: rating.current > 0 ? toScouting(rating.current, scale) : rating.current,
  potential: rating.potential > 0 ? toScouting(rating.potential, scale) : rating.potential,
});

/**
 * A player's revealed fielding grades, on the 20-80 scale.
 *
 * `gloves()` already applies the visibility rule (a current grade above zero
 * is the only signal the game has shown the position; the ceiling behind a
 * dash is withheld). This wraps it so scale normalization and the boundary are
 * in one place. Whether fielding grades share the tool ratings' display scale
 * is an assumption inherited from `ratingScaleMax`, which reads a fielding
 * column; it cannot be verified from the export.
 */
export function scoutedGloves(playerId: number): Gloves | null {
  const profile = gloves(playerId);
  if (!profile) return null;
  const scale = ratingScale();
  if (scale.native2080) return profile;
  return {
    ...profile,
    positions: profile.positions.map((p) => scalePosition(p, scale)),
    components: Object.fromEntries(
      Object.entries(profile.components).map(([name, value]) => [name, toScouting(value, scale)])
    ),
  };
}

/** The fielding provenance, for payloads that report it. */
export const FIELDING_EVIDENCE_PROVENANCE: EvidenceProvenance = FIELDING_PROVENANCE;

// ── Fielding peers ──────────────────────────────────────────────────────

const fieldingPopulationCache = new Map<string, number[]>();

const hitterPopulationCache = new Map<number, ScoutedHitterProfile[]>();

/** Cleared whenever a fresh export is imported. */
export function clearFieldingPopulationCache(): void {
  fieldingPopulationCache.clear();
  hitterPopulationCache.clear();
}

/**
 * Who counts as a "major-league" peer. Every club carries, under its own `team_id`, the amateurs it has signed
 * (sixteen- and seventeen-year-olds on the international pool, all-20 tools, no plate appearances); the export marks
 * them with a NEGATIVE `players.league_id`, where a professional's is the league he plays in. Ranked against them a
 * real hitter's percentile is inflated by the share of the pool they make up (about 12% of the hitters here), and
 * every mean over the pool is pulled down. A peer is a player whose own league is the major league.
 * Schema-tolerant: an export with no `league_id` (or a null one) leaves the population as it was.
 */
const majorLeaguerOnly = (): string => (tableColumns('players').includes('league_id') ? ' AND COALESCE(p.league_id, ?) = ?' : '');
const majorLeaguerArgs = (leagueId: number): number[] => (tableColumns('players').includes('league_id') ? [leagueId, leagueId] : []);

/**
 * The revealed fielding grades of a league's major-league players listed at a
 * position, on the 20-80 scale, ascending: the peers a defensive grade at that
 * position is ranked against. Only grades the game shows (current above zero)
 * are used, for the same reason `gloves()` uses them; a player listed elsewhere
 * with a stray grade here is not a peer.
 */
export function scoutedFieldingPopulation(leagueId: number, position: number): number[] {
  const key = `${leagueId}:${position}`;
  const hit = fieldingPopulationCache.get(key);
  if (hit) return hit;
  const out: number[] = [];
  const column = `fielding_rating_pos${position}`;
  if (position >= 1 && position <= 9 && tableExists('players_fielding') && tableExists('teams') && tableColumns('players_fielding').includes(column)) {
    const scale = ratingScale();
    const rows = db.prepare(
      `SELECT f."${column}" AS grade
       FROM players_fielding f
       JOIN players p ON p.player_id = f.player_id
       JOIN teams t ON t.team_id = p.team_id
       WHERE t.league_id = ? AND t.level = 1 AND p.position = ? AND p.retired = 0 AND f."${column}" > 0${majorLeaguerOnly()}`
    ).all(leagueId, position, ...majorLeaguerArgs(leagueId)) as Array<{ grade: number }>;
    for (const r of rows) out.push(toScouting(r.grade, scale));
    out.sort((a, b) => a - b);
  }
  fieldingPopulationCache.set(key, out);
  return out;
}


// ── Hitter splits and running (D-035) ───────────────────────────────────

/**
 * A hitter's rating splits against left- and right-handed pitching and his running
 * ratings: the evidence the owner approved in D-035 (platoon and baserunning). Read
 * only here. Every value is on the 20-80 scale; a grade that is absent, non-numeric
 * or not positive is unknown, never replaced (D-018). A composite exists only when
 * every component it averages is known.
 */
export type HitterSide = 'vsLeft' | 'vsRight';
export type RunningKey = 'speed' | 'baserunning' | 'stealing' | 'stealingRate';

const SPLIT_PREFIX: Record<HitterSide, string> = { vsLeft: 'batting_ratings_vsl_', vsRight: 'batting_ratings_vsr_' };
const SPLIT_SUFFIX: Record<HitterTool, string> = { contact: 'contact', gap: 'gap', power: 'power', eye: 'eye', avoidK: 'strikeouts' };
const RUNNING_COLUMN: Record<RunningKey, string> = {
  speed: 'running_ratings_speed',
  baserunning: 'running_ratings_baserunning',
  stealing: 'running_ratings_stealing',
  stealingRate: 'running_ratings_stealing_rate',
};
/** The running ratings that describe ability. Stealing RATE is how often he tries, not how good he is, and is reported but never averaged. */
const RUNNING_ABILITY: readonly RunningKey[] = ['speed', 'baserunning', 'stealing'];
const HITTER_TOOL_KEYS: readonly HitterTool[] = ['contact', 'gap', 'power', 'eye', 'avoidK'];

const SPLIT_PROVENANCE: EvidenceProvenance = {
  ...TOOL_PROVENANCE,
  source: 'exported_split_and_running_ratings',
  basis: 'DECISIONS.md D-002, D-017, D-035',
};

export type HitterToolSet = Readonly<Record<HitterTool, number | null>>;

export interface ScoutedHitterProfile {
  readonly playerId: number;
  /** Current overall tools, the same ratings `loadScoutedAbilities` reports. */
  readonly tools: HitterToolSet;
  /** Tools against left-handed pitching and against right-handed pitching. */
  readonly vsLeft: HitterToolSet;
  readonly vsRight: HitterToolSet;
  readonly running: Readonly<Record<RunningKey, number | null>>;
  /** Mean of speed, baserunning and stealing; null unless all three are known. */
  readonly runningAbility: number | null;
  readonly missing: { tools: readonly HitterTool[]; vsLeft: readonly HitterTool[]; vsRight: readonly HitterTool[]; running: readonly RunningKey[] };
  readonly provenance: EvidenceProvenance;
}

const toolSet = (row: Record<string, unknown>, column: (k: HitterTool) => string, scale: RatingScale): { set: HitterToolSet; missing: HitterTool[] } => {
  const set = {} as Record<HitterTool, number | null>;
  const missing: HitterTool[] = [];
  for (const k of HITTER_TOOL_KEYS) {
    const known = knownRating(row[column(k)]);
    set[k] = known === null ? null : toScouting(known, scale);
    if (known === null) missing.push(k);
  }
  return { set, missing };
};

/** Build a profile from native-scale column values; pure, so tests can supply rows. */
export function hitterProfileFromRow(playerId: number, row: Record<string, unknown>, scale: RatingScale): ScoutedHitterProfile {
  const overall = toolSet(row, (k) => HITTER_TOOLS.find((t) => t.key === k)?.current ?? '', scale);
  const left = toolSet(row, (k) => `${SPLIT_PREFIX.vsLeft}${SPLIT_SUFFIX[k]}`, scale);
  const right = toolSet(row, (k) => `${SPLIT_PREFIX.vsRight}${SPLIT_SUFFIX[k]}`, scale);
  const running = {} as Record<RunningKey, number | null>;
  const missingRunning: RunningKey[] = [];
  for (const key of Object.keys(RUNNING_COLUMN) as RunningKey[]) {
    const known = knownRating(row[RUNNING_COLUMN[key]]);
    running[key] = known === null ? null : toScouting(known, scale);
    if (known === null) missingRunning.push(key);
  }
  const ability = RUNNING_ABILITY.every((k) => running[k] !== null)
    ? Math.round((RUNNING_ABILITY.reduce((n, k) => n + (running[k] as number), 0) / RUNNING_ABILITY.length) * 10) / 10
    : null;
  return {
    playerId, tools: overall.set, vsLeft: left.set, vsRight: right.set, running, runningAbility: ability,
    missing: { tools: overall.missing, vsLeft: left.missing, vsRight: right.missing, running: missingRunning },
    provenance: SPLIT_PROVENANCE,
  };
}

const hitterColumns = (): string[] => {
  const columns = [
    ...HITTER_TOOLS.map((t) => t.current),
    ...HITTER_TOOL_KEYS.map((k) => `${SPLIT_PREFIX.vsLeft}${SPLIT_SUFFIX[k]}`),
    ...HITTER_TOOL_KEYS.map((k) => `${SPLIT_PREFIX.vsRight}${SPLIT_SUFFIX[k]}`),
    ...Object.values(RUNNING_COLUMN),
  ];
  return columns;
};

/** Splits and running for a set of players; a player with no row is absent (unknown), never defaulted. */
export function loadScoutedHitterProfiles(playerIds: Iterable<number>): Map<number, ScoutedHitterProfile> {
  const ids = [...new Set(playerIds)].filter((id) => Number.isFinite(id));
  const out = new Map<number, ScoutedHitterProfile>();
  if (ids.length === 0 || !tableExists('players_batting')) return out;
  const present = new Set(tableColumns('players_batting'));
  const select = hitterColumns().map((c) => (present.has(c) ? `b."${c}" AS "${c}"` : `NULL AS "${c}"`));
  const scale = ratingScale();
  for (let at = 0; at < ids.length; at += CHUNK) {
    const chunk = ids.slice(at, at + CHUNK);
    const rows = db.prepare(
      `SELECT b.player_id AS player_id, ${select.join(', ')} FROM players_batting b WHERE b.player_id IN (${chunk.map(() => '?').join(', ')})`
    ).all(...chunk) as Array<Record<string, unknown>>;
    for (const row of rows) out.set(Number(row.player_id), hitterProfileFromRow(Number(row.player_id), row, scale));
  }
  return out;
}

/**
 * The profiles of a league's major-league position players: the peers a hitter's tools and
 * running are ranked against. Cached per league until the next import.
 */
export function scoutedHitterPopulation(leagueId: number): ScoutedHitterProfile[] {
  const hit = hitterPopulationCache.get(leagueId);
  if (hit) return hit;
  let out: ScoutedHitterProfile[] = [];
  if (tableExists('players') && tableExists('teams') && tableExists('players_batting')) {
    const ids = (db.prepare(
      `SELECT p.player_id AS id FROM players p JOIN teams t ON t.team_id = p.team_id
       WHERE t.league_id = ? AND t.level = 1 AND p.position > 1 AND p.retired = 0${majorLeaguerOnly()}`
    ).all(leagueId, ...majorLeaguerArgs(leagueId)) as Array<{ id: number }>).map((r) => r.id);
    out = [...loadScoutedHitterProfiles(ids).values()];
  }
  hitterPopulationCache.set(leagueId, out);
  return out;
}

// ── The glove at his listed position, in bulk ────────────────────────────

/**
 * A player's revealed fielding grade at the position he is listed at, current and potential, on the
 * 20-80 scale: the "glove at the position he plays" of D-033, for a league-wide reader (Player Value)
 * that cannot afford one `gloves()` call per player. The visibility rule is `gloves()`'s own: a
 * current grade above zero is the only sign the game has shown the position; behind a dash nothing is
 * read, and the grade is unknown, never assumed bad (D-018). A pitcher, or a listed position with no
 * fielding column (a designated hitter), has no glove at his position: absent.
 */
export interface ScoutedGloveAtPosition {
  readonly playerId: number;
  /** OOTP's listed position, 2 to 9. */
  readonly position: number;
  readonly current: number | null;
  /** The ceiling at that position; null when not shown (or not positive). */
  readonly potential: number | null;
  readonly provenance: EvidenceProvenance;
}

export function loadScoutedGlovesAtPosition(playerIds: Iterable<number>): Map<number, ScoutedGloveAtPosition> {
  const ids = [...new Set(playerIds)].filter((id) => Number.isFinite(id));
  const out = new Map<number, ScoutedGloveAtPosition>();
  if (ids.length === 0 || !tableExists('players') || !tableExists('players_fielding')) return out;
  const present = new Set(tableColumns('players_fielding'));
  if (!present.has('player_id') || !tableColumns('players').includes('position')) return out;
  const select: string[] = [];
  for (let position = 2; position <= 9; position += 1) {
    for (const column of [`fielding_rating_pos${position}`, `fielding_rating_pos${position}_pot`]) {
      select.push(present.has(column) ? `f."${column}" AS "${column}"` : `NULL AS "${column}"`);
    }
  }
  const scale = ratingScale();
  for (let at = 0; at < ids.length; at += CHUNK) {
    const chunk = ids.slice(at, at + CHUNK);
    const rows = db.prepare(
      `SELECT p.player_id AS player_id, p.position AS position, ${select.join(', ')}
       FROM players p JOIN players_fielding f ON f.player_id = p.player_id
       WHERE p.player_id IN (${chunk.map(() => '?').join(', ')})`
    ).all(...chunk) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const position = Number(row.position);
      if (!Number.isInteger(position) || position < 2 || position > 9) continue;
      const current = knownRating(row[`fielding_rating_pos${position}`]);
      const potential = current === null ? null : knownRating(row[`fielding_rating_pos${position}_pot`]);
      out.set(Number(row.player_id), {
        playerId: Number(row.player_id),
        position,
        current: current === null ? null : toScouting(current, scale),
        potential: potential === null ? null : toScouting(potential, scale),
        provenance: FIELDING_PROVENANCE,
      });
    }
  }
  return out;
}

// ── Observed scouting over time (history.db rating snapshots) ────────────

/**
 * One persisted observation of a player's scouted tools: the rating snapshot `history.ts` takes after
 * each import, read back as a `ScoutedAbility` under the same rules as today's export (missing stays
 * missing; a composite only when every tool is known; the 20-80 scale). The snapshot keeps the tools
 * as exported, so it is normalized with the scale detected from TODAY's export: an assumption, stated,
 * that the save's display scale has not changed between imports.
 *
 * This is the longitudinal evidence (ratings at t against what followed at t + h) that a development
 * path, or an arrival rate conditioned on ratings, needs. It is read only here, like every rating.
 */
export interface ScoutedObservation {
  readonly playerId: number;
  /** The snapshot's game date, ISO (`parseGameDate`); a snapshot whose date cannot be read is skipped. */
  readonly gameDate: string;
  /** The club's level and the player's age as the snapshot recorded them (objective facts at that date). */
  readonly level: number | null;
  /** The club he was on when the snapshot was taken (an objective fact at that date); null where the snapshot did not keep it. */
  readonly teamId: number | null;
  readonly age: number | null;
  readonly ability: ScoutedAbility;
  /**
   * A hitter's splits and running as the snapshot kept them (cycle 4: snapshots before it kept no split tools and no baserunning or
   * stealing rating, so those read unknown there). Null for a pitcher or a player of unknown kind.
   */
  readonly hitter: ScoutedHitterProfile | null;
}

const SNAPSHOT_TOOL_COLUMN: Record<HitterTool, string> = { contact: 'con', gap: 'gap', power: 'pow', eye: 'eye', avoidK: 'avk' };

/** The snapshot's columns for a hitter's splits and running, under the export's own column names (so one builder reads both). */
const SNAPSHOT_HITTER_COLUMNS: Record<string, string> = {
  ...Object.fromEntries(HITTER_TOOLS.map((t) => [t.current, SNAPSHOT_TOOL_COLUMN[t.key]])),
  ...Object.fromEntries((['vsLeft', 'vsRight'] as const).flatMap((side) => HITTER_TOOL_KEYS.map((k) =>
    [`${SPLIT_PREFIX[side]}${SPLIT_SUFFIX[k]}`, `${side === 'vsLeft' ? 'l' : 'r'}${SNAPSHOT_TOOL_COLUMN[k]}`]))),
  [RUNNING_COLUMN.speed]: 'spd',
  [RUNNING_COLUMN.baserunning]: 'brn',
  [RUNNING_COLUMN.stealing]: 'stl',
};

const SNAPSHOT_TOOLS: Record<ToolKey, { current: string; potential: string }> = {
  contact: { current: 'con', potential: 'conP' },
  gap: { current: 'gap', potential: 'gapP' },
  power: { current: 'pow', potential: 'powP' },
  eye: { current: 'eye', potential: 'eyeP' },
  avoidK: { current: 'avk', potential: 'avkP' },
  stuff: { current: 'stu', potential: 'stuP' },
  movement: { current: 'mov', potential: 'movP' },
  control: { current: 'ctl', potential: 'ctlP' },
};

/**
 * Every persisted observation for this save (or for the players asked about), oldest first per
 * player. Schema-tolerant: a snapshot table without a tool column reads that tool as unknown.
 */
export function loadScoutedObservations(playerIds: Iterable<number> | null = null): Map<number, ScoutedObservation[]> {
  const out = new Map<number, ScoutedObservation[]>();
  const present = new Set((historyDb.prepare(`PRAGMA table_info(rating_snapshots)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!['save_name', 'game_date', 'player_id', 'position'].every((c) => present.has(c))) return out;
  const columns = [...new Set([...Object.values(SNAPSHOT_TOOLS).flatMap((t) => [t.current, t.potential]), ...Object.values(SNAPSHOT_HITTER_COLUMNS)])];
  const select = [
    'player_id', 'game_date', 'position',
    present.has('level') ? 'level' : 'NULL AS level',
    present.has('team_id') ? 'team_id' : 'NULL AS team_id',
    present.has('age') ? 'age' : 'NULL AS age',
    ...columns.map((c) => (present.has(c) ? `"${c}"` : `NULL AS "${c}"`)),
  ].join(', ');
  const scale = ratingScale();
  const viewer = viewerContext();
  const take = (rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      const gameDate = parseGameDate(row.game_date ?? null);
      const playerId = Number(row.player_id);
      if (!gameDate || !Number.isFinite(playerId)) continue;
      const position = Number(row.position);
      const kind: ScoutedAbility['kind'] = !Number.isFinite(position) ? 'unknown' : position === 1 ? 'pitcher' : 'hitter';
      const tools = kind === 'pitcher' ? PITCHER_TOOLS : HITTER_TOOLS;
      const current: Partial<Record<ToolKey, unknown>> = {};
      const potential: Partial<Record<ToolKey, unknown>> = {};
      for (const t of tools) {
        current[t.key] = row[SNAPSHOT_TOOLS[t.key].current];
        potential[t.key] = row[SNAPSHOT_TOOLS[t.key].potential];
      }
      const level = Number(row.level);
      const age = Number(row.age);
      const list = out.get(playerId) ?? [];
      list.push({
        playerId, gameDate,
        level: row.level === null || !Number.isFinite(level) ? null : level,
        teamId: row.team_id === null || row.team_id === undefined || !Number.isFinite(Number(row.team_id)) ? null : Number(row.team_id),
        age: row.age === null || !Number.isFinite(age) ? null : age,
        ability: buildAbility({ playerId, kind, current, potential, stamina: null, pitches: [] }, scale, viewer),
        hitter: kind === 'hitter'
          ? hitterProfileFromRow(playerId, Object.fromEntries(Object.entries(SNAPSHOT_HITTER_COLUMNS).map(([exported, kept]) => [exported, row[kept]])), scale)
          : null,
      });
      out.set(playerId, list);
    }
  };
  const base = `SELECT ${select} FROM rating_snapshots WHERE save_name = ?`;
  if (playerIds === null) take(historyDb.prepare(base).all(currentSaveName()) as Array<Record<string, unknown>>);
  else {
    const ids = [...new Set(playerIds)].filter((id) => Number.isFinite(id));
    for (let at = 0; at < ids.length; at += CHUNK) {
      const chunk = ids.slice(at, at + CHUNK);
      take(historyDb.prepare(`${base} AND player_id IN (${chunk.map(() => '?').join(', ')})`).all(currentSaveName(), ...chunk) as Array<Record<string, unknown>>);
    }
  }
  for (const list of out.values()) list.sort((a, b) => (a.gameDate < b.gameDate ? -1 : a.gameDate > b.gameDate ? 1 : 0));
  return out;
}
