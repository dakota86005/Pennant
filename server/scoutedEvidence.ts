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
 *                 and revealed fielding-position grades (`gloves.ts`).
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
 *   - The composite is a Front Office summary of visible tools, not OOTP's
 *     weighted, position-aware Overall.
 */

import { db, tableColumns, tableExists } from './db.js';
import { ratingScaleMax } from './valuation.js';
import { gloves, type Gloves, type PositionRating } from './gloves.js';

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
  source: 'exported_tool_ratings' | 'exported_fielding_ratings';
  status: 'declared_organization_visible';
  verification: 'not_verifiable_from_export';
  basis: 'DECISIONS.md D-002, D-017';
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
