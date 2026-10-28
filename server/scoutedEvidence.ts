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

import type { Statement } from 'better-sqlite3';
import { databaseGeneration, db, importRecord, tableColumns, tableExists } from './db.js';
import { ratingScaleMax } from './ratingScaleProbe.js';
import { glovesFromRow, type Gloves, type PositionRating } from './gloves.js';
import { parseGameDate } from './dataFreshness.js';
import { currentRatingMode, historyDb, modeFilter, otherSource, scaleFilter, snapshotModes } from './history.js';
import { currentHistoryKey } from './historyIdentity.js';
import { RATING_MODE_WORDS, type RatingMode, type RatingModeRecord } from './ratingMode.js';

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
 * Which kind of ratings the export carries (D-061): read from OOTP's export settings at the import, and recorded with
 * it. The app reads the export's rating columns as the export gives them, whichever kind they are, and names the kind
 * wherever a rating is shown, so a claim resting on a rating can say whose view it is. An import from before Pennant
 * recorded the mode, or settings it could not read, is `unknown`: never assumed to be the scouts' view.
 */
export function exportRatingMode(): RatingModeRecord {
  return currentRatingMode() ?? {
    mode: 'unknown', additionalScouted: null, source: 'settings_missing',
    reason: 'This import was made before Pennant recorded which kind of ratings the export carries.',
  };
}

/** Where the ratings come from, for a claim's basis: the mode, a short name and a sentence. */
export interface RatingSource {
  mode: RatingMode;
  /** "Your scouts' view", "True ratings", ... */
  short: string;
  /** The sentence a basis carries. */
  text: string;
}

export function ratingSource(): RatingSource {
  if (ourScoutsRatings()) {
    const words = RATING_MODE_WORDS['scouted-complete'];
    return { mode: 'scouted-complete', short: words.short, text: words.long };
  }
  if (fileViews().osaEvidence) return { mode: 'osa', short: OSA_FILL_WORDS.short, text: osaEvidenceText() };
  const record = exportRatingMode();
  const words = RATING_MODE_WORDS[record.mode];
  return { mode: record.mode, short: words.short, text: record.mode === 'unknown' && record.reason ? `${words.long} ${record.reason}` : words.long };
}

/**
 * The kind of ratings the evidence is read in now (D-067): our scouts' full reports when the export carries them for our
 * club, otherwise the main tables' kind as the import recorded it; null for an import from before the kind was recorded
 * (never evidence of a switch). Rating history compares only snapshots of this kind.
 */
export function evidenceRatingMode(): RatingMode | null {
  if (ourScoutsRatings()) return 'scouted-complete';
  // True ratings in the main tables, OSA's view in the file and none of ours: OSA's view is the evidence (review L6)
  if (fileViews().osaEvidence) return 'osa';
  return currentRatingMode()?.mode ?? null;
}

// ── Prepared statements, kept per connection and import (review M3) ──────

/*
 * Preparing a statement over the scouted file (139 columns) costs more than running it, and the readers below run the same
 * few statements for every player a page shows. They are kept by their SQL text for the served connection and import.
 */
let statements: { conn: unknown; generation: number; byText: Map<string, Statement> } | null = null;
const STATEMENTS_KEPT = 256;

function prepared(sql: string): Statement {
  if (!statements || statements.conn !== db || statements.generation !== databaseGeneration()) {
    statements = { conn: db, generation: databaseGeneration(), byText: new Map() };
  }
  let statement = statements.byText.get(sql);
  if (!statement) {
    if (statements.byText.size >= STATEMENTS_KEPT) statements.byText.clear();
    statement = db.prepare(sql);
    statements.byText.set(sql, statement);
  }
  return statement;
}

/** "Show no player ratings": the export carries none, so every rating reads as unknown (never a zero, never a default). */
export function ratingsWithheld(): boolean {
  return exportRatingMode().mode === 'none';
}

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
  const rows = prepared(`SELECT team_id FROM teams WHERE human_team = 1 ORDER BY team_id`).all() as Array<{ team_id: number }>;
  if (rows.length === 1) return { viewerOrgId: rows[0].team_id, resolution: 'human_team' };
  if (rows.length > 1) return { viewerOrgId: null, resolution: 'ambiguous_human_teams' };
  return { viewerOrgId: null, resolution: 'unresolved' };
}

// ── Whose eyes: our scouts' full reports (D-067) ─────────────────────────

/**
 * What a player our scouts haven't rated is, when their full reports are the evidence (D-067). The owner decided
 * (2026-10-02) "OSA's view, said so": his OSA row in the same file is used and every rating served from it says so for
 * him; never the main tables, so never true ratings, and with no OSA row he is unknown (D-018). `'unknown'` leaves him
 * unknown to our scouts (the builder's earlier recommendation), kept as the one switch.
 */
export const UNRATED_BY_OUR_SCOUTS: 'unknown' | 'osa' = 'osa';

/** The export's complete scouted ratings: one row per player per scouting organisation (OOTP's "Additional complete scouted ratings"). */
const OUR_SCOUTS_TABLE = 'players_scouted_ratings';

/** OSA, the league's scouting service, in that file: the `scouting_team_id` no club has (no coach, every player rated). */
const OSA_SCOUTING_TEAM_ID = 0;

/** Our scouts' full reports, when the export carries them: our club's id (`scouting_team_id`) and how many players they rate. */
export interface OurScoutsRatings {
  teamId: number;
  players: number;
}

/** Whether the served import kept this table from an earlier import (its file not rewritten this time, D-061): then it is not this export's. */
function keptFromEarlierImport(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  const stale = Array.isArray(record.stale) ? (record.stale as Array<{ table?: unknown }>) : [];
  const tables = Array.isArray(record.tables) ? (record.tables as Array<{ table?: unknown; source?: unknown }>) : [];
  return stale.some((t) => t.table === OUR_SCOUTS_TABLE) || tables.some((t) => t.table === OUR_SCOUTS_TABLE && t.source === 'carried');
}

/** What the export's complete scouted ratings offer now: our scouts' rows, OSA's rows, and the players OSA fills in for us. */
interface FileViews {
  ours: OurScoutsRatings | null;
  /** How many players OSA's rows rate; null when the file has none (or isn't usable). */
  osaPlayers: number | null;
  /** The players our scouts haven't rated whom OSA has, read from OSA's view (`UNRATED_BY_OUR_SCOUTS = 'osa'`). */
  filled: Set<number>;
  /**
   * No row of ours can be read, the main tables are true ratings and the file carries OSA's rows: judgments read OSA's
   * view, said so for the whole export, never the true ratings (D-067, review L6).
   */
  osaEvidence: boolean;
  /** Why no row of ours is read, for the sentence that says OSA's view is the evidence. */
  noOursReason: 'viewer_unresolved' | 'no_rows' | null;
}

const NO_VIEWS: FileViews = { ours: null, osaPlayers: null, filled: new Set(), osaEvidence: false, noOursReason: null };

/**
 * The kinds whose main tables may hold true ratings: "real" says so, and an unknown kind can't rule it out (the settings
 * changed after the export, or couldn't be read). With OSA's rows in the file and none of ours, judgments read OSA's view
 * rather than risk true ratings (D-067's exception, review L6, extended to the unknown kind by deep hunt SRVDEV-09).
 */
const MAIN_TABLES_MAY_BE_TRUE: ReadonlySet<RatingMode> = new Set<RatingMode>(['real', 'unknown']);

function findViews(record: Record<string, unknown> | null): FileViews {
  // "Show no player ratings" withholds every rating, this file's included: what OOTP writes in it then isn't established
  if (ratingsWithheld() || !tableExists(OUR_SCOUTS_TABLE) || keptFromEarlierImport(record)) return NO_VIEWS;
  const columns = tableColumns(OUR_SCOUTS_TABLE);
  if (!columns.includes('player_id') || !columns.includes('scouting_team_id')) return NO_VIEWS;
  const count = (teamId: number): number => Number((db.prepare(
    `SELECT COUNT(DISTINCT player_id) AS n FROM "${OUR_SCOUTS_TABLE}" WHERE scouting_team_id = ?`
  ).get(teamId) as { n: number } | undefined)?.n ?? 0);
  const osa = count(OSA_SCOUTING_TEAM_ID);
  // Whose scouts: the club the save marks as human-managed; more than one, or none, reads nobody's rows as ours
  const teamId = viewerContext().viewerOrgId;
  const oursCount = teamId === null || !Number.isInteger(teamId) || teamId === OSA_SCOUTING_TEAM_ID ? 0 : count(teamId);
  const ours = oursCount > 0 ? { teamId: teamId as number, players: oursCount } : null;
  const filled = new Set<number>();
  if (ours && UNRATED_BY_OUR_SCOUTS === 'osa' && osa > 0) {
    const rows = db.prepare(
      `SELECT o.player_id AS id FROM "${OUR_SCOUTS_TABLE}" o WHERE o.scouting_team_id = ${OSA_SCOUTING_TEAM_ID}
       AND NOT EXISTS (SELECT 1 FROM "${OUR_SCOUTS_TABLE}" x WHERE x.scouting_team_id = ? AND x.player_id = o.player_id)`
    ).all(ours.teamId) as Array<{ id: number }>;
    for (const r of rows) filled.add(Number(r.id));
  }
  // The main tables may be true ratings (a "real" export, or one whose kind isn't known): OSA's rows are the scouted view
  // the export offers, so they are the evidence (review L6; deep hunt SRVDEV-09 for the unknown kind)
  const osaEvidence = !ours && osa > 0 && MAIN_TABLES_MAY_BE_TRUE.has(exportRatingMode().mode);
  const noOursReason = ours ? null : teamId === null ? 'viewer_unresolved' : 'no_rows';
  return { ours, osaPlayers: osa > 0 ? osa : null, filled, osaEvidence, noOursReason };
}

/** The basis's sentence when OSA's view is the evidence in place of the export's true ratings (review L6). */
function osaEvidenceText(): string {
  const why = fileViews().noOursReason === 'viewer_unresolved'
    ? 'Pennant couldn\'t tell which club is yours, so your scouts\' reports can\'t be picked out'
    : 'the export carries no full reports from your scouts';
  const main = exportRatingMode().mode === 'real'
    ? 'the export\'s main ratings are true ratings'
    : 'which kind of ratings the export\'s main tables carry isn\'t known, so they may be true ratings';
  return `The ratings are OSA's view, the league's shared scouting service, from the export's complete scouted ratings: ${main}, and ${why}.`;
}

let viewsCache: { generation: number; conn: unknown; record: unknown; value: FileViews } | null = null;

function fileViews(): FileViews {
  const record = importRecord();
  if (viewsCache && viewsCache.generation === databaseGeneration() && viewsCache.conn === db && viewsCache.record === record) {
    return viewsCache.value;
  }
  const value = findViews(record);
  viewsCache = { generation: databaseGeneration(), conn: db, record, value };
  return value;
}

/**
 * Our scouts' full reports, when they are the evidence (D-067): the served import carries the export's complete scouted
 * ratings from THIS export, our club resolves, and the file rates at least one player for it. Null otherwise, and then
 * the main tables are the evidence as before (D-061). Cached per served import.
 */
export function ourScoutsRatings(): OurScoutsRatings | null {
  return fileViews().ours;
}

/** Where one player's ratings come from: the export's main tables, our scouts' full reports, or OSA's view filling in for them. */
export type RatingsFrom = 'export' | 'our_scouts' | 'osa' | 'league_osa' | 'osa_view';

/** A rating read from OSA's view because our scouts haven't rated him, in the GM's words: a quiet mark and its sentence. */
export const OSA_FILL_WORDS = {
  mark: 'OSA',
  short: 'OSA\'s view',
  text: 'OSA\'s view: our scouts haven\'t rated him.',
} as const;

/** Where this player's ratings come from now (D-067); inside a league population, OSA's view when it is the yardstick (D-068). */
export function ratingsFromOf(playerId: number): RatingsFrom {
  const views = fileViews();
  if (inPopulation() && populationPolicy === 'osa') {
    if (views.osaPlayers !== null) return 'league_osa';
    // No OSA view: our scouts' reports are the yardstick when the file carries them (the owner's decision), else the main tables
    if (!views.ours) return 'export';
  }
  if (!views.ours) return views.osaEvidence ? 'osa_view' : 'export';
  return views.filled.has(playerId) ? 'osa' : 'our_scouts';
}

/** The words a page shows beside a player's grades when they are OSA's view filling in for our scouts; null otherwise. */
export function ratingFillOf(playerId: number): { mark: string; hint: string } | null {
  return !inPopulation() && ratingsFromOf(playerId) === 'osa' ? { mark: OSA_FILL_WORDS.mark, hint: OSA_FILL_WORDS.text } : null;
}

export type RatingTable = 'batting' | 'pitching' | 'fielding';
const MAIN_TABLE: Record<RatingTable, string> = { batting: 'players_batting', pitching: 'players_pitching', fielding: 'players_fielding' };

/**
 * The file's columns a family is read from: `player_id` and that family's rating columns, named, never `SELECT *` (the file
 * also carries OOTP's star figures, `overall` and `talent`, which are never read, D-017; and naming them keeps the statement
 * cheap to prepare, review M3).
 */
function fileColumns(kind: RatingTable): string[] {
  return fileShape().families[kind];
}

/** The file's columns by family, and its one-row read, worked out once per served import (review M3). */
interface FileShape {
  families: Record<RatingTable, string[]>;
  /** One player's row of one family, with his listed position. */
  rowSql: Record<RatingTable, string>;
}
let shape: { conn: unknown; generation: number; value: FileShape } | null = null;

function fileShape(): FileShape {
  // Kept only on the served, read-only connection (as `db.ts` keeps the schema): a writable one may change shape under it
  if (db.readonly && shape && shape.conn === db && shape.generation === databaseGeneration()) return shape.value;
  const all = tableColumns(OUR_SCOUTS_TABLE);
  const families = Object.fromEntries((Object.keys(FAMILY) as RatingTable[]).map((kind) => [kind, ['player_id', ...all.filter((c) => FAMILY[kind].test(c))]])) as Record<RatingTable, string[]>;
  const position = all.includes('position') ? ['position'] : [];
  const rowSql = Object.fromEntries((Object.keys(FAMILY) as RatingTable[]).map((kind) => [kind,
    `SELECT ${selectList([...position, ...families[kind]], 's')} FROM "${OUR_SCOUTS_TABLE}" s WHERE s.scouting_team_id = ? AND s.player_id = ?`])) as Record<RatingTable, string>;
  const value = { families, rowSql };
  shape = { conn: db, generation: databaseGeneration(), value };
  return value;
}

const selectList = (columns: readonly string[], alias: string): string => columns.map((c) => `${alias}."${c}"`).join(', ');

/** Our scouts' rows, with OSA's row for a player they haven't rated when the policy fills (one row per player, index-friendly). */
function evidenceExpression(views: FileViews, kind: RatingTable): string {
  const ours = Number(views.ours!.teamId);
  const fill = UNRATED_BY_OUR_SCOUTS === 'osa' && views.osaPlayers !== null;
  const columns = fileColumns(kind);
  return fill
    ? `(SELECT ${selectList(columns, 's')} FROM "${OUR_SCOUTS_TABLE}" s WHERE s.scouting_team_id = ${ours} OR (s.scouting_team_id = ${OSA_SCOUTING_TEAM_ID}
        AND NOT EXISTS (SELECT 1 FROM "${OUR_SCOUTS_TABLE}" x WHERE x.scouting_team_id = ${ours} AND x.player_id = s.player_id)))`
    : `(SELECT ${selectList(columns, 's')} FROM "${OUR_SCOUTS_TABLE}" s WHERE s.scouting_team_id = ${ours})`;
}

/** OSA's rows of the file, one per player, for a family. */
function osaExpression(kind: RatingTable): { from: string; columns: Set<string> } {
  const columns = fileColumns(kind);
  return { from: `(SELECT ${selectList(columns, 's')} FROM "${OUR_SCOUTS_TABLE}" s WHERE s.scouting_team_id = ${OSA_SCOUTING_TEAM_ID})`, columns: new Set(columns) };
}

function mainTableFrom(kind: RatingTable): { from: string; columns: Set<string> } | null {
  const table = MAIN_TABLE[kind];
  return tableExists(table) ? { from: `"${table}"`, columns: new Set(tableColumns(table)) } : null;
}

/**
 * Where a family of ratings is read from, as a table expression keyed by `player_id` (one row per player), with its
 * columns: our scouts' rows when they are the evidence (every family is in their one file), OSA's row for a player they
 * haven't rated (`UNRATED_BY_OUR_SCOUTS`), otherwise the main table; null when absent.
 */
export function ratingFrom(kind: RatingTable): { from: string; columns: Set<string> } | null {
  // "Show no player ratings": no family has a source, so every grade read through it is unknown (D-061, deep hunt SRVDEV-01)
  if (ratingsWithheld()) return null;
  const views = fileViews();
  // Worked out once per served import, view and family (review M3)
  const key = `${kind}:${inPopulation() ? populationPolicy : 'evidence'}`;
  if (!fromCache || fromCache.views !== views || fromCache.generation !== databaseGeneration() || fromCache.conn !== db) {
    fromCache = { views, generation: databaseGeneration(), conn: db, byKey: new Map() };
  }
  if (fromCache.byKey.has(key)) return fromCache.byKey.get(key)!;
  const found = ratingFromOf(kind, views);
  if (db.readonly) fromCache.byKey.set(key, found);
  return found;
}

let fromCache: { views: FileViews; generation: number; conn: unknown; byKey: Map<string, { from: string; columns: Set<string> } | null> } | null = null;

function ratingFromOf(kind: RatingTable, views: FileViews): { from: string; columns: Set<string> } | null {
  // Inside a league population: OSA's rows when the export carries them (D-068); without them our scouts' reports when it
  // carries those (the owner's decision, 2026-10-02); the main tables only when the file offers neither
  if (inPopulation() && populationPolicy === 'osa') {
    if (views.osaPlayers !== null) return osaExpression(kind);
    if (!views.ours) return mainTableFrom(kind);
  }
  if (views.ours) return { from: evidenceExpression(views, kind), columns: new Set(fileColumns(kind)) };
  if (views.osaEvidence) return osaExpression(kind);
  return mainTableFrom(kind);
}

/** Whether the evidence is read from the file (our scouts' reports, or OSA's view in place of true ratings). */
const fileIsEvidence = (views: FileViews): boolean => views.ours !== null || views.osaEvidence;

/**
 * The file's row the evidence reads for this player (ours, OSA's filling in, or OSA's when it is the evidence); undefined
 * when none rates him. One family's rating columns by name, with his listed position.
 */
function evidenceFileRow(playerId: number, kind: RatingTable): Record<string, unknown> | undefined {
  const views = fileViews();
  if (!fileIsEvidence(views)) return undefined;
  const teamId = views.ours && !views.filled.has(playerId) ? views.ours.teamId : OSA_SCOUTING_TEAM_ID;
  return prepared(fileShape().rowSql[kind]).get(teamId, playerId) as Record<string, unknown> | undefined;
}

/** Each family's rating columns, by name. */
const FAMILY: Record<RatingTable, RegExp> = {
  batting: /^(batting_ratings_|running_ratings_)/,
  pitching: /^pitching_ratings_/,
  fielding: /^fielding_rating/,
};
/** Any family's rating column. */
const RATING_COLUMN = /^(batting_ratings_|running_ratings_|pitching_ratings_|fielding_rating)/;

/**
 * One player's row of a ratings table as the evidence sees it, for a page that shows the grades (the player card): the
 * export's row, every rating column in it from the file's row the evidence reads (our scouts', or OSA's filling in;
 * unknown, null, where neither rates him; never the main table's grade), the rest of the row (handedness, experience) as
 * exported. `ratingFillOf` says whether it is OSA's view.
 */
export function scoutedRatingRow(kind: RatingTable, playerId: number): Record<string, unknown> | undefined {
  // "Show no player ratings": the row as exported with every rating column unknown, never a grade (D-061)
  if (ratingsWithheld()) return ratingRowWith(kind, playerId, null);
  const views = fileViews();
  return ratingRowWith(kind, playerId, fileIsEvidence(views) ? evidenceFileRow(playerId, kind) ?? null : undefined);
}

/** `scoutedRatingRow` with the file's row already read (`undefined`: the file isn't the evidence; null: it doesn't rate him). */
function ratingRowWith(kind: RatingTable, playerId: number, scouts: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  const table = MAIN_TABLE[kind];
  const main = tableExists(table)
    ? (prepared(`SELECT * FROM "${table}" WHERE player_id = ?`).get(playerId) as Record<string, unknown> | undefined)
    : undefined;
  if (scouts === undefined) return main;
  if (!main && !scouts) return undefined;
  const family = FAMILY[kind];
  const out: Record<string, unknown> = main ? { ...main } : { player_id: playerId, position: scouts?.position ?? null };
  for (const column of Object.keys(out)) if (family.test(column)) out[column] = scouts ? scouts[column] ?? null : null;
  if (scouts) for (const [column, value] of Object.entries(scouts)) if (family.test(column) && !(column in out)) out[column] = value;
  return out;
}

// ── League yardsticks and fits: OSA's view (D-068) ───────────────────────

/**
 * What every league-wide population and per-save fit that reads ratings is built on (the owner's direction,
 * 2026-10-02): OSA's view, the league's shared scouting service, so a yardstick or a fit does not drift with the club's
 * own scouting staff. `'evidence'` would build them on the same ratings a judgment of a player reads. Without an OSA
 * view they read our scouts' reports when the file carries them (the owner's decision, 2026-10-02), and the main tables
 * (D-061) only when it carries neither; labelled either way.
 */
export const LEAGUE_POPULATION_SOURCE: 'osa' | 'evidence' = 'osa';

let populationPolicy: 'osa' | 'evidence' = LEAGUE_POPULATION_SOURCE;
let populationDepth = 0;

/** Whether the code running now is building a league population or a fit (inside `inPopulationView`). */
export const inPopulation = (): boolean => populationDepth > 0;

/**
 * Runs `build` with every rating read in the league's population view: OSA's rows when OSA is the yardstick. Only for
 * synchronous code (a refit, a population's computation): nothing else may run while it holds.
 */
export function inPopulationView<T>(build: () => T): T {
  populationDepth += 1;
  try {
    return synchronousOnly(build(), 'inPopulationView');
  } finally {
    populationDepth -= 1;
  }
}

/**
 * A scope held by a module variable (the population view, a fit's ratings source) must close before anything else runs:
 * a build that returns a promise would leave it open across an await (review L4). Refused, loudly.
 */
export function synchronousOnly<T>(value: T, scope: string): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function') {
    throw new Error(`${scope} takes synchronous code only: the scope would leak across an await`);
  }
  return value;
}

/** For a measurement script or a test only: run `body` with the other population policy, then put the line back. */
export function withPopulationPolicy<T>(policy: 'osa' | 'evidence', body: () => T): T {
  const before = populationPolicy;
  populationPolicy = policy;
  clearPopulationCaches();
  try {
    return synchronousOnly(body(), 'withPopulationPolicy');
  } finally {
    populationPolicy = before;
    clearPopulationCaches();
  }
}

/** The ratings the league's yardsticks and fits are built on now: an id a fit's record keeps, a name and a sentence. */
export interface PopulationSource {
  id: string;
  short: string;
  text: string;
}

export function populationSource(): PopulationSource {
  if (populationPolicy === 'evidence') {
    const evidence = ratingSource();
    return { id: `evidence:${evidence.mode}`, short: evidence.short, text: `How players compare across the league reads the same ratings as a judgment of a player. ${evidence.text}` };
  }
  const views = fileViews();
  if (views.osaPlayers !== null) {
    return {
      id: 'osa_file', short: 'OSA\'s view',
      text: 'How players compare across the league, and the numbers Pennant fits to this save, read OSA\'s view: the league\'s shared scouting service, from the export\'s complete scouted ratings.',
    };
  }
  if (views.ours) {
    return {
      id: 'our_scouts_file', short: RATING_MODE_WORDS['scouted-complete'].short,
      text: 'How players compare across the league, and the numbers Pennant fits to this save, read your scouts\' full reports: the export carries no OSA view.',
    };
  }
  const mode = exportRatingMode().mode;
  return {
    id: `export:${mode}`, short: RATING_MODE_WORDS[mode].short,
    text: `${RATING_MODE_WORDS[mode].long} The export carries no OSA view and no full reports from your scouts, so how players compare across the league reads its main ratings.`,
  };
}

export { ratingSourceNamed, sameRatingSource } from './ratingMode.js';

/**
 * Whether a league comparison's basis shows his second reading (D-068, review H1): only when the yardstick really is OSA's
 * rows from the file and he is read from our scouts' reports. Otherwise there is no second reading to show, and nothing is
 * labelled "OSA" that isn't (a "real" export without OSA's rows would otherwise show true ratings under that name).
 */
export function bothReadingsApply(): boolean {
  return populationSource().id === 'osa_file' && ourScoutsRatings() !== null;
}

const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

/**
 * A player's own reading beside his OSA reading, for a league comparison's basis (D-068): "Our scouts: 65 · OSA: 70" for a
 * grade, "Our scouts: 65th percentile · OSA: 70th" for a percentile; null when they agree, either is unknown, or the
 * readings don't apply (`bothReadingsApply`).
 */
export function bothReadings(ours: number | null, osa: number | null, unit: 'grade' | 'percentile' = 'grade'): string | null {
  if (ours === null || osa === null || Math.round(ours) === Math.round(osa) || !bothReadingsApply()) return null;
  const o = Math.round(ours);
  const a = Math.round(osa);
  return unit === 'percentile' ? `Our scouts: ${ordinal(o)} percentile · OSA: ${ordinal(a)}` : `Our scouts: ${o} · OSA: ${a}`;
}

/** The players' composites in the league's population view (OSA's, when it is the yardstick), for `bothReadings`. */
export function populationAbilities(playerIds: Iterable<number>): ScoutedAbilities {
  return inPopulationView(() => loadScoutedAbilities(playerIds));
}

/** A player's current composite in the population view, kept per source until the next import (`bothReadings`, review M3). */
const populationCompositeCache = new Map<string, Map<number, number | null>>();

export function populationComposite(playerId: number): number | null {
  const key = `${databaseGeneration()}:${populationSource().id}`;
  let byPlayer = populationCompositeCache.get(key);
  if (!byPlayer) {
    populationCompositeCache.clear();
    byPlayer = new Map();
    populationCompositeCache.set(key, byPlayer);
  }
  if (!db.readonly) return populationAbilities([playerId]).for(playerId).current;
  if (!byPlayer.has(playerId)) byPlayer.set(playerId, populationAbilities([playerId]).for(playerId).current);
  return byPlayer.get(playerId) ?? null;
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

/** A display scale by its top, in words: "20–80", "1–10". */
export function ratingScaleNamed(max: number): string {
  return `${SCALE_MIN[max] ?? 1}–${max}`;
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
  /** Where his ratings come from (D-067): the main tables, our scouts' full reports, or OSA's view filling in for them. */
  readonly ratingsFrom: RatingsFrom;
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

function buildAbility(input: AbilityInput, scale: RatingScale, viewer: ViewerContext, ratingsFrom: RatingsFrom = 'export'): ScoutedAbility {
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
    ratingsFrom,
  });
}

/** What the evidence says about a player nothing is known about. */
export function unknownScoutedAbility(playerId: number, kind: ScoutedAbility['kind'] = 'unknown'): ScoutedAbility {
  return buildAbility(
    { playerId, kind, current: {}, potential: {}, stamina: null, pitches: [] },
    ratingScale(),
    viewerContext(),
    ratingsFromOf(playerId)
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
    ratingsFrom: 'export',
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
  if (ids.length === 0 || !tableExists('players') || ratingsWithheld()) return new ScoutedAbilities(out);

  const scale = ratingScale();
  const viewer = viewerContext();

  const battingFrom = ratingFrom('batting');
  const pitchingFrom = ratingFrom('pitching');
  const batting = battingFrom?.columns ?? new Set<string>();
  const pitching = pitchingFrom?.columns ?? new Set<string>();
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

  const statement = (count: number) => prepared(
    `SELECT p.player_id, p.position, ${select.join(', ')}
     FROM players p
     ${hasBatting ? `LEFT JOIN ${battingFrom!.from} b ON b.player_id = p.player_id` : ''}
     ${hasPitching ? `LEFT JOIN ${pitchingFrom!.from} pp ON pp.player_id = p.player_id` : ''}
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
      }, scale, viewer, ratingsFromOf(playerId)));
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
  /** Where his ratings come from (D-067), and the sentence that says so when it is OSA's view filling in; null otherwise. */
  ratingsFrom: RatingsFrom;
  ratingsFromText: string | null;
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
    ratingsFrom: ability.ratingsFrom,
    ratingsFromText: ability.ratingsFrom === 'osa' ? OSA_FILL_WORDS.text : null,
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
 * `glovesFromRow()` already applies the visibility rule (a current grade above zero
 * is the only signal the game has shown the position; the ceiling behind a
 * dash is withheld). This wraps it so scale normalization and the boundary are
 * in one place. Whether fielding grades share the tool ratings' display scale
 * is an assumption inherited from `ratingScaleMax`, which reads a fielding
 * column; it cannot be verified from the export.
 */
export function scoutedGloves(playerId: number): Gloves | null {
  if (ratingsWithheld()) return null;
  // Our scouts' reports: a player they haven't rated has no profile (unknown), never one read off another view. The file's
  // row is read once (review M3)
  const views = fileViews();
  let profile: Gloves | null;
  if (fileIsEvidence(views)) {
    const scouts = evidenceFileRow(playerId, 'fielding');
    profile = scouts ? glovesFromRow(ratingRowWith('fielding', playerId, scouts)) : null;
  } else {
    profile = glovesFromRow(ratingRowWith('fielding', playerId, undefined));
  }
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

const hitterPopulationCache = new Map<string, ScoutedHitterProfile[]>();

/** Cleared whenever a fresh export is imported. */
export function clearFieldingPopulationCache(): void {
  clearPopulationCaches();
  viewsCache = null;
  statements = null;
  shape = null;
  fromCache = null;
}

function clearPopulationCaches(): void {
  fieldingPopulationCache.clear();
  hitterPopulationCache.clear();
  populationCompositeCache.clear();
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
 * are used, for the same reason `glovesFromRow()` uses them; a player listed elsewhere
 * with a stray grade here is not a peer.
 */
export function scoutedFieldingPopulation(leagueId: number, position: number): number[] {
  // A league yardstick: built in the population view (OSA's, when it is the yardstick, D-068), cached per source
  const key = `${populationSource().id}:${leagueId}:${position}`;
  const hit = fieldingPopulationCache.get(key);
  if (hit) return hit;
  const out = inPopulationView(() => fieldingPopulationOf(leagueId, position));
  fieldingPopulationCache.set(key, out);
  return out;
}

function fieldingPopulationOf(leagueId: number, position: number): number[] {
  const out: number[] = [];
  const column = `fielding_rating_pos${position}`;
  const fielding = ratingFrom('fielding');
  if (!ratingsWithheld() && position >= 1 && position <= 9 && fielding && tableExists('teams') && fielding.columns.has(column)) {
    const scale = ratingScale();
    const rows = db.prepare(
      `SELECT f."${column}" AS grade
       FROM ${fielding.from} f
       JOIN players p ON p.player_id = f.player_id
       JOIN teams t ON t.team_id = p.team_id
       WHERE t.league_id = ? AND t.level = 1 AND p.position = ? AND p.retired = 0 AND f."${column}" > 0${majorLeaguerOnly()}`
    ).all(leagueId, position, ...majorLeaguerArgs(leagueId)) as Array<{ grade: number }>;
    for (const r of rows) out.push(toScouting(r.grade, scale));
    out.sort((a, b) => a - b);
  }
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
  const batting = ratingFrom('batting');
  if (ids.length === 0 || !batting || ratingsWithheld()) return out;
  const present = batting.columns;
  const select = hitterColumns().map((c) => (present.has(c) ? `b."${c}" AS "${c}"` : `NULL AS "${c}"`));
  const scale = ratingScale();
  for (let at = 0; at < ids.length; at += CHUNK) {
    const chunk = ids.slice(at, at + CHUNK);
    const rows = prepared(
      `SELECT b.player_id AS player_id, ${select.join(', ')} FROM ${batting.from} b WHERE b.player_id IN (${chunk.map(() => '?').join(', ')})`
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
  // A league yardstick: built in the population view (OSA's, when it is the yardstick, D-068), cached per source
  const key = `${populationSource().id}:${leagueId}`;
  const hit = hitterPopulationCache.get(key);
  if (hit) return hit;
  const out = inPopulationView(() => {
    if (!tableExists('players') || !tableExists('teams') || !ratingFrom('batting')) return [];
    const ids = (db.prepare(
      `SELECT p.player_id AS id FROM players p JOIN teams t ON t.team_id = p.team_id
       WHERE t.league_id = ? AND t.level = 1 AND p.position > 1 AND p.retired = 0${majorLeaguerOnly()}`
    ).all(leagueId, ...majorLeaguerArgs(leagueId)) as Array<{ id: number }>).map((r) => r.id);
    return [...loadScoutedHitterProfiles(ids).values()];
  });
  hitterPopulationCache.set(key, out);
  return out;
}

// ── The glove at his listed position, in bulk ────────────────────────────

/**
 * A player's revealed fielding grade at the position he is listed at, current and potential, on the
 * 20-80 scale: the "glove at the position he plays" of D-033, for a league-wide reader (Player Value)
 * that cannot afford one `scoutedGloves()` call per player. The visibility rule is `glovesFromRow()`'s own: a
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
  const fielding = ratingFrom('fielding');
  if (ids.length === 0 || !tableExists('players') || !fielding || ratingsWithheld()) return out;
  const present = fielding.columns;
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
    const rows = prepared(
      `SELECT p.player_id AS player_id, p.position AS position, ${select.join(', ')}
       FROM players p JOIN ${fielding.from} f ON f.player_id = p.player_id
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
 * as exported, so it is normalized with the scale detected from TODAY's export, and a snapshot on another
 * display scale (stamped so, or shown so by its own grades) is left out as a switch, never read on today's
 * scale (B-90, `scaleFilter` in `history.ts`).
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
  /** Which kind of ratings the snapshot holds (D-061); null when it was taken before Pennant recorded the kind. */
  readonly ratingMode: RatingMode | null;
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
  // Inside a league population or fit, with OSA as the yardstick: OSA's own snapshots, of that kind only (D-068)
  const population = inPopulation() ? populationSource() : null;
  const osaHistory = population?.id === 'osa_file';
  const table = osaHistory ? 'save_population_snapshots' : 'save_rating_snapshots';
  const present = new Set((historyDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!['save_key', 'game_date', 'player_id', 'position'].every((c) => present.has(c))) return out;
  const columns = [...new Set([...Object.values(SNAPSHOT_TOOLS).flatMap((t) => [t.current, t.potential]), ...Object.values(SNAPSHOT_HITTER_COLUMNS)])];
  const select = [
    'player_id', 'game_date', 'position',
    present.has('level') ? 'level' : 'NULL AS level',
    present.has('team_id') ? 'team_id' : 'NULL AS team_id',
    present.has('age') ? 'age' : 'NULL AS age',
    present.has('src') ? 'src' : 'NULL AS src',
    ...columns.map((c) => (present.has(c) ? `"${c}"` : `NULL AS "${c}"`)),
  ].join(', ');
  const scale = ratingScale();
  const viewer = viewerContext();
  // A snapshot in another known kind of ratings than today's export is a switch, never development: left out (D-061)
  // ...and so is a snapshot on another display scale than today's, OSA's history included (B-90)
  const { excluded } = osaHistory ? { excluded: scaleFilter().excluded } : modeFilter();
  const modes = osaHistory ? new Map<string, RatingMode>() : snapshotModes();
  const take = (rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      if (excluded.has(String(row.game_date))) continue;
      // A row of his from another source than today's (our scouts' or OSA's view) is a switch, never development (D-067)
      if (!osaHistory && otherSource(Number(row.player_id), row.src)) continue;
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
        ability: buildAbility({ playerId, kind, current, potential, stamina: null, pitches: [] }, scale, viewer,
          osaHistory ? 'league_osa' : row.src === 'our_scouts' || row.src === 'osa' ? row.src : 'export'),
        hitter: kind === 'hitter'
          ? hitterProfileFromRow(playerId, Object.fromEntries(Object.entries(SNAPSHOT_HITTER_COLUMNS).map(([exported, kept]) => [exported, row[kept]])), scale)
          : null,
        ratingMode: osaHistory ? 'osa' : modes.get(String(row.game_date)) ?? null,
      });
      out.set(playerId, list);
    }
  };
  const base = `SELECT ${select} FROM ${table} WHERE save_key = ?${osaHistory ? ` AND kind = '${population!.id}'` : ''}`;
  if (playerIds === null) take(historyDb.prepare(base).all(currentHistoryKey()) as Array<Record<string, unknown>>);
  else {
    const ids = [...new Set(playerIds)].filter((id) => Number.isFinite(id));
    for (let at = 0; at < ids.length; at += CHUNK) {
      const chunk = ids.slice(at, at + CHUNK);
      take(historyDb.prepare(`${base} AND player_id IN (${chunk.map(() => '?').join(', ')})`).all(currentHistoryKey(), ...chunk) as Array<Record<string, unknown>>);
    }
  }
  for (const list of out.values()) list.sort((a, b) => (a.gameDate < b.gameDate ? -1 : a.gameDate > b.gameDate ? 1 : 0));
  return out;
}

// ── The grades a page shows, on the export's own scale ───────────────────

/*
 * The player card, the roster grid, the pitching staff, the draft board and the rating snapshot show (or keep) grades as
 * the export writes them, on its own display scale. They used to name the rating columns themselves, joined to whatever
 * `ratingFrom` handed them, and fell back to the main tables when it handed nothing: "Show no player ratings" still showed
 * grades, and an export without a ratings table failed the page (deep hunt SRVDEV-01, -05, -06). The columns are named
 * here, read from the evidence's rows (our scouts' full reports when the export carries them, D-067), every one unknown
 * (null) when the export withholds ratings or carries no table for the family, and never a main-table fallback.
 */

/** A grade a page shows, by name, and where it is read from (its family and the export's column). */
const DISPLAY_GRADE = {
  contact: ['batting', 'batting_ratings_overall_contact'],
  contactPot: ['batting', 'batting_ratings_talent_contact'],
  gap: ['batting', 'batting_ratings_overall_gap'],
  gapPot: ['batting', 'batting_ratings_talent_gap'],
  power: ['batting', 'batting_ratings_overall_power'],
  powerPot: ['batting', 'batting_ratings_talent_power'],
  eye: ['batting', 'batting_ratings_overall_eye'],
  eyePot: ['batting', 'batting_ratings_talent_eye'],
  avoidK: ['batting', 'batting_ratings_overall_strikeouts'],
  avoidKPot: ['batting', 'batting_ratings_talent_strikeouts'],
  speed: ['batting', 'running_ratings_speed'],
  stealing: ['batting', 'running_ratings_stealing'],
  baserunning: ['batting', 'running_ratings_baserunning'],
  stuff: ['pitching', 'pitching_ratings_overall_stuff'],
  stuffPot: ['pitching', 'pitching_ratings_talent_stuff'],
  movement: ['pitching', 'pitching_ratings_overall_movement'],
  movementPot: ['pitching', 'pitching_ratings_talent_movement'],
  control: ['pitching', 'pitching_ratings_overall_control'],
  controlPot: ['pitching', 'pitching_ratings_talent_control'],
  stamina: ['pitching', 'pitching_ratings_misc_stamina'],
  velocity: ['pitching', 'pitching_ratings_misc_velocity'],
} as const satisfies Record<string, readonly [RatingTable, string]>;

export type DisplayGrade = keyof typeof DISPLAY_GRADE;

/** A grade as the export wrote it: a number, or null where there is none (a blank cell, or no row). */
const asGrade = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * These players' grades, on the export's own scale, keyed by name: every player asked about has a record, and a grade the
 * evidence can't give (withheld, no table, no column, no row) is null. Our scouts' rows when they are the evidence, with
 * OSA's filling in for a player they haven't rated (`ratingFillOf` says so).
 */
export function displayGrades<K extends DisplayGrade>(playerIds: Iterable<number>, keys: readonly K[]): Map<number, Record<K, number | null>> {
  const ids = [...new Set(playerIds)].filter((id) => Number.isFinite(id));
  const out = new Map<number, Record<K, number | null>>();
  for (const id of ids) out.set(id, Object.fromEntries(keys.map((k) => [k, null])) as Record<K, number | null>);
  if (ids.length === 0 || ratingsWithheld()) return out;
  for (const family of ['batting', 'pitching'] as const) {
    const wanted = keys.filter((k) => DISPLAY_GRADE[k][0] === family);
    const source = wanted.length ? ratingFrom(family) : null;
    if (!source || !source.columns.has('player_id')) continue;
    const select = wanted.map((k) => (source.columns.has(DISPLAY_GRADE[k][1]) ? `r."${DISPLAY_GRADE[k][1]}" AS "${k}"` : `NULL AS "${k}"`)).join(', ');
    for (let at = 0; at < ids.length; at += CHUNK) {
      const chunk = ids.slice(at, at + CHUNK);
      const rows = prepared(`SELECT r.player_id AS player_id, ${select} FROM ${source.from} r WHERE r.player_id IN (${chunk.map(() => '?').join(', ')})`)
        .all(...chunk) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const record = out.get(Number(row.player_id));
        if (record) for (const k of wanted) record[k] = asGrade(row[k]);
      }
    }
  }
  return out;
}

/** Which of these grades the evidence can read in this export at all (none under "Show no player ratings"), in order. */
export function displayGradesOffered<K extends DisplayGrade>(keys: readonly K[]): K[] {
  if (ratingsWithheld()) return [];
  const sources = { batting: ratingFrom('batting'), pitching: ratingFrom('pitching') };
  return keys.filter((k) => sources[DISPLAY_GRADE[k][0] as 'batting' | 'pitching']?.columns.has(DISPLAY_GRADE[k][1]) ?? false);
}

const CARD_PITCHES = [
  'fastball', 'sinker', 'cutter', 'slider', 'curveball', 'changeup', 'splitter',
  'forkball', 'screwball', 'circlechange', 'knucklecurve', 'knuckleball',
] as const;

const CARD_FIELDING = {
  infieldRange: 'fielding_ratings_infield_range',
  infieldArm: 'fielding_ratings_infield_arm',
  turnDP: 'fielding_ratings_turn_doubleplay',
  outfieldRange: 'fielding_ratings_outfield_range',
  outfieldArm: 'fielding_ratings_outfield_arm',
  catcherArm: 'fielding_ratings_catcher_arm',
  catcherAbility: 'fielding_ratings_catcher_ability',
} as const;

type Pair = [number | null, number | null];

/** Everything the player card shows of his grades, on the export's own scale; a family with no row is null. */
export interface CardGrades {
  batting: Record<'contact' | 'gap' | 'power' | 'eye' | 'avoidK' | 'speed' | 'stealing' | 'baserunning', Pair> | null;
  pitching: Record<'stuff' | 'movement' | 'control' | 'stamina', Pair> | null;
  velocity: number | null;
  pitches: Array<{ name: string; rating: number; talent: number }>;
  /** The positions OOTP has rated him at (the dash rule, `glovesFromRow`). */
  positions: PositionRating[];
  fielding: Record<keyof typeof CARD_FIELDING, number | null> | null;
}

/**
 * One player's grades for his card, read as the evidence reads them (`scoutedRatingRow`): our scouts' full reports when
 * the export carries them, every grade unknown under "Show no player ratings" (D-061) and where no source rates him.
 */
export function cardGrades(playerId: number): CardGrades {
  const batting = scoutedRatingRow('batting', playerId);
  const pitching = scoutedRatingRow('pitching', playerId);
  const fielding = scoutedRatingRow('fielding', playerId);
  const g = (row: Record<string, unknown>, column: string): number | null => asGrade(row[column]);
  const pair = (row: Record<string, unknown>, now: string, ceiling: string): Pair => [g(row, now), g(row, ceiling)];
  const tool = (key: HitterTool | PitcherTool) => [...HITTER_TOOLS, ...PITCHER_TOOLS].find((t) => t.key === key)!;
  const pitches: CardGrades['pitches'] = [];
  if (pitching) {
    for (const name of CARD_PITCHES) {
      const rating = g(pitching, `pitching_ratings_pitches_${name}`) ?? 0;
      if (rating > 0) pitches.push({ name, rating, talent: g(pitching, `pitching_ratings_pitches_talent_${name}`) ?? rating });
    }
  }
  return {
    batting: batting
      ? {
        contact: pair(batting, tool('contact').current, tool('contact').potential),
        gap: pair(batting, tool('gap').current, tool('gap').potential),
        power: pair(batting, tool('power').current, tool('power').potential),
        eye: pair(batting, tool('eye').current, tool('eye').potential),
        avoidK: pair(batting, tool('avoidK').current, tool('avoidK').potential),
        speed: pair(batting, RUNNING_COLUMN.speed, RUNNING_COLUMN.speed),
        stealing: pair(batting, RUNNING_COLUMN.stealing, RUNNING_COLUMN.stealing),
        baserunning: pair(batting, RUNNING_COLUMN.baserunning, RUNNING_COLUMN.baserunning),
      }
      : null,
    pitching: pitching
      ? {
        stuff: pair(pitching, tool('stuff').current, tool('stuff').potential),
        movement: pair(pitching, tool('movement').current, tool('movement').potential),
        control: pair(pitching, tool('control').current, tool('control').potential),
        stamina: pair(pitching, STAMINA_COLUMN, STAMINA_COLUMN),
      }
      : null,
    velocity: pitching ? g(pitching, DISPLAY_GRADE.velocity[1]) : null,
    pitches,
    positions: glovesFromRow(fielding)?.positions ?? [],
    fielding: fielding
      ? Object.fromEntries(Object.entries(CARD_FIELDING).map(([k, column]) => [k, g(fielding, column)])) as Record<keyof typeof CARD_FIELDING, number | null>
      : null,
  };
}

// ── The grades a rating snapshot and the draft board keep ────────────────

/** A snapshot's short name for each grade it keeps, and the export's column (`history.ts` stores them under these names). */
const KEPT_GRADE_COLUMNS: ReadonlyArray<readonly [string, RatingTable, string]> = [
  ['con', 'batting', 'batting_ratings_overall_contact'], ['gap', 'batting', 'batting_ratings_overall_gap'],
  ['pow', 'batting', 'batting_ratings_overall_power'], ['eye', 'batting', 'batting_ratings_overall_eye'],
  ['avk', 'batting', 'batting_ratings_overall_strikeouts'], ['spd', 'batting', 'running_ratings_speed'],
  ['conP', 'batting', 'batting_ratings_talent_contact'], ['gapP', 'batting', 'batting_ratings_talent_gap'],
  ['powP', 'batting', 'batting_ratings_talent_power'], ['eyeP', 'batting', 'batting_ratings_talent_eye'],
  ['avkP', 'batting', 'batting_ratings_talent_strikeouts'],
  ['stu', 'pitching', 'pitching_ratings_overall_stuff'], ['mov', 'pitching', 'pitching_ratings_overall_movement'],
  ['ctl', 'pitching', 'pitching_ratings_overall_control'],
  ['stuP', 'pitching', 'pitching_ratings_talent_stuff'], ['movP', 'pitching', 'pitching_ratings_talent_movement'],
  ['ctlP', 'pitching', 'pitching_ratings_talent_control'],
  // A hitter's splits and his baserunning and stealing (D-035, cycle 4 of D-053): where the export has them, else unknown
  ...(['vsLeft', 'vsRight'] as const).flatMap((side) => HITTER_TOOL_KEYS.map((k) =>
    [`${side === 'vsLeft' ? 'l' : 'r'}${SNAPSHOT_TOOL_COLUMN[k]}`, 'batting', `${SPLIT_PREFIX[side]}${SPLIT_SUFFIX[k]}`] as const)),
  ['brn', 'batting', RUNNING_COLUMN.baserunning], ['stl', 'batting', RUNNING_COLUMN.stealing],
];

/** The SELECT list of the kept grades over `b` (batting) and `pi` (pitching); a family or column the source lacks is NULL. */
function keptSelect(batting: { columns: Set<string> } | null, pitching: { columns: Set<string> } | null): string {
  return KEPT_GRADE_COLUMNS.map(([as, family, column]) => {
    const source = family === 'batting' ? batting : pitching;
    return source && source.columns.has(column) ? `${family === 'batting' ? 'b' : 'pi'}."${column}" AS ${as}` : `NULL AS ${as}`;
  }).join(', ');
}

const NO_ROWS = '(SELECT NULL AS player_id WHERE 0)';

/**
 * The rows a rating snapshot keeps for every rostered player, under the snapshot's own names: the evidence's grades
 * (`'evidence'`) or the league's population view (`'population'`, OSA's when it is the yardstick, D-068). Null when the
 * export carries no ratings to keep ("Show no player ratings", or no batting ratings at all).
 */
export function snapshotRatingRows(view: 'evidence' | 'population'): Array<Record<string, number | string | null>> | null {
  const read = () => {
    const batting = ratingFrom('batting');
    if (!tableExists('players') || !tableExists('teams') || !batting) return null;
    const pitching = ratingFrom('pitching');
    return db.prepare(
      `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.team_id,
              p.organization_id AS org_id, t.level, p.position, p.age,
              ${keptSelect(batting, pitching)}
       FROM players p
       JOIN teams t ON t.team_id = p.team_id
       LEFT JOIN ${batting.from} b ON b.player_id = p.player_id
       LEFT JOIN ${pitching?.from ?? NO_ROWS} pi ON pi.player_id = p.player_id
       WHERE p.retired = 0 AND p.team_id > 0`
    ).all() as Array<Record<string, number | string | null>>;
  };
  return view === 'population' ? inPopulationView(read) : read();
}

/** The snapshot's grades for these players (the draft board's class), under the same names; every grade null where none. */
export function keptGrades(playerIds: Iterable<number>): Map<number, Record<string, number | null>> {
  const ids = [...new Set(playerIds)].filter((id) => Number.isFinite(id));
  const out = new Map<number, Record<string, number | null>>();
  for (const id of ids) out.set(id, Object.fromEntries(KEPT_GRADE_COLUMNS.map(([as]) => [as, null])));
  const batting = ratingFrom('batting');
  const pitching = ratingFrom('pitching');
  if (ids.length === 0 || (!batting && !pitching) || !tableExists('players')) return out;
  for (let at = 0; at < ids.length; at += CHUNK) {
    const chunk = ids.slice(at, at + CHUNK);
    const rows = prepared(
      `SELECT p.player_id AS player_id, ${keptSelect(batting, pitching)}
       FROM players p
       LEFT JOIN ${batting?.from ?? NO_ROWS} b ON b.player_id = p.player_id
       LEFT JOIN ${pitching?.from ?? NO_ROWS} pi ON pi.player_id = p.player_id
       WHERE p.player_id IN (${chunk.map(() => '?').join(', ')})`
    ).all(...chunk) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const record = out.get(Number(row.player_id));
      if (record) for (const [as] of KEPT_GRADE_COLUMNS) record[as] = asGrade(row[as]);
    }
  }
  return out;
}
