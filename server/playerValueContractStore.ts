/**
 * Player Value's third writer (phase 4b): the per-import contract snapshot in `history.db` (PLAYER_VALUE.md 4.2, Part 7).
 *
 * `league.db` is replaced by every import, so the contracts it describes today are gone tomorrow. This records, once
 * per import, what each contract the market league's clubs held looked like and what was known about the player then:
 * the term and its salaries, his club and organization and placement, Player Rights' standing for this season and the
 * two after it, his expected production (the entry point's projection, with its basis), and the cost the coming
 * winter's season was priced at. The next import is set against it: what changed between the two is what OOTP's clubs
 * did (`playerValueSignings.ts`).
 *
 *   - Keyed by the save's IDENTITY (`saveIdentity`: its configured name and the league's fingerprint, hardening F1),
 *     the league and the game date (`parseGameDate`), and the player: a new save under a reused name never reads
 *     another's contracts. Idempotent per key: a second capture of the same import finds its header and writes nothing.
 *   - Bounded per import: one row per player the market league's clubs hold, and per unsigned player whose production
 *     is established; a minor-league deal carries only its terms. The history is not pruned (about 3.2 MB an import on
 *     the Arizona save; retention is an owner question, review R3-03).
 *   - Read one import at a time (review R3-03): when an import is recorded, the pair it forms with the import before it
 *     on the save's timeline is observed once and stored (`value_contract_pairs`, with the reading's method); the
 *     market is read from the stored pairs, and a pair is observed again from its two snapshots only when the method
 *     changed. Recording an import reads the one import before it, never the whole history.
 *   - The timeline (review R3-05): the order imports were recorded in (`seq`), and the breaks found when a date already
 *     recorded is imported again (`value_contract_events`): the save went back to it, or its season's play differs from
 *     the record's (a reloaded save played again).
 *   - Additive: CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE; nothing alters, replaces or drops a row. Never league.db,
 *     never a timer. The rows are computed by the entry point and handed here; this module stores and reads them.
 */

import { parseGameDate } from './dataFreshness.js';
import { historyDb } from './history.js';
import { saveIdentity } from './playerValueFitStore.js';
import type { ContractSnapshot, ContractSnapshotRow, TimelineBreak, WinterPair } from './playerValueSignings.js';

historyDb.exec(`
  CREATE TABLE IF NOT EXISTS value_contract_imports (
    save_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    game_date TEXT NOT NULL,
    game_date_exported TEXT,
    observed_at TEXT NOT NULL,
    season INTEGER,
    season_played REAL,
    minimum_salary REAL,
    financials INTEGER,
    arbitration_json TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    population TEXT NOT NULL,
    labels_json TEXT NOT NULL,
    PRIMARY KEY (save_name, league_id, game_date)
  );
  CREATE TABLE IF NOT EXISTS value_contract_snapshots (
    save_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    game_date TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    team_id INTEGER,
    org_id INTEGER,
    kind TEXT,
    first_season INTEGER,
    years INTEGER,
    salaries_json TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    PRIMARY KEY (save_name, league_id, game_date, player_id)
  );
  CREATE TABLE IF NOT EXISTS value_contract_pairs (
    save_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    earlier_date TEXT NOT NULL,
    later_date TEXT NOT NULL,
    method TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    pair_json TEXT NOT NULL,
    PRIMARY KEY (save_name, league_id, earlier_date, later_date, method)
  );
  CREATE TABLE IF NOT EXISTS value_contract_events (
    save_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    event TEXT NOT NULL,
    game_date TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    PRIMARY KEY (save_name, league_id, seq, event)
  );
`);

/** Counts writes in this process, so a reader's cache of the observed market knows when an import added one. */
const writes = { version: 0 };

export function contractStoreVersion(): number {
  return writes.version;
}

/** One import's header: when, which season, the minimum and regime it was read under, and how many rows. */
export interface ContractImport {
  leagueId: number;
  gameDate: string;
  gameDateExported: string | null;
  season: number | null;
  seasonPlayed: number | null;
  rows: number;
  population: string;
  /** The order it was recorded in (the timeline's order, review R3-05). */
  seq: number;
}

export interface ContractSnapshotInput extends ContractSnapshot {
  gameDateExported: string | null;
  /** The population recorded, in words (the bound on the snapshot's size). */
  population: string;
  /** How much of the season had been played at the import (games and plate appearances): a date imported again is compared on it. */
  playDigest?: string | null;
  /** Why the season counts as begun or not at the import, in words. */
  seasonState?: string | null;
}

const keyOf = (gameDate: string): string => parseGameDate(gameDate) ?? gameDate;

/** Whether this import (save identity, league, game date) is already recorded. */
export function contractSnapshotRecorded(leagueId: number, gameDate: string): boolean {
  return historyDb.prepare(`SELECT 1 FROM value_contract_imports WHERE save_name = ? AND league_id = ? AND game_date = ?`)
    .get(saveIdentity(leagueId), leagueId, keyOf(gameDate)) !== undefined;
}

/**
 * Record one import's contracts, and the event that it was recorded (its place on the timeline, its play digest).
 * Idempotent per key: a second record of the same import writes nothing. Returns the rows written (the header's and
 * the players').
 */
export function recordContractSnapshot(s: ContractSnapshotInput): number {
  const save = saveIdentity(s.leagueId);
  const key = keyOf(s.gameDate);
  const header = historyDb.prepare(
    `INSERT OR IGNORE INTO value_contract_imports
     (save_name, league_id, game_date, game_date_exported, observed_at, season, season_played, minimum_salary, financials, arbitration_json, row_count, population, labels_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const row = historyDb.prepare(
    `INSERT OR IGNORE INTO value_contract_snapshots
     (save_name, league_id, game_date, player_id, team_id, org_id, kind, first_season, years, salaries_json, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const event = historyDb.prepare(
    `INSERT OR IGNORE INTO value_contract_events (save_name, league_id, seq, event, game_date, observed_at, detail_json) VALUES (?, ?, ?, 'recorded', ?, ?, ?)`
  );
  // A production basis's label is the model in force, the same for most players: stored once in the header
  const labels: string[] = [];
  const labelOf = (label: string) => {
    let i = labels.indexOf(label);
    if (i < 0) i = labels.push(label) - 1;
    return i;
  };
  const write = historyDb.transaction(() => {
    const details = s.rows.map((r) => compact({
      extension: r.extension, placement: r.placement, majorRecord: r.majorRecord || null, rights: r.rights, serviceNow: r.serviceNow ?? null, nextCost: r.nextCost,
      production: r.production ? { status: r.production.status, label: labelOf(r.production.label), seasons: r.production.seasons } : null,
    }));
    const now = new Date().toISOString();
    const h = header.run(
      save, s.leagueId, key, s.gameDateExported, now, s.season, s.seasonPlayed, s.minimum,
      s.financials === null ? null : s.financials ? 1 : 0, JSON.stringify(s.arbitration), s.rows.length, s.population, JSON.stringify(labels),
    );
    if (h.changes === 0) return 0;
    let n = h.changes;
    s.rows.forEach((r, i) => {
      n += row.run(save, s.leagueId, key, r.playerId, r.teamId, r.orgId, r.kind, r.firstSeason, r.years, JSON.stringify(r.salaries), details[i]).changes;
    });
    event.run(save, s.leagueId, Number(h.lastInsertRowid), key, now, JSON.stringify({ playDigest: s.playDigest ?? null, seasonState: s.seasonState ?? null }));
    return n;
  });
  const written = write();
  if (written > 0) writes.version += 1;
  return written;
}

/** A row's detail as stored: its empty fields left out, its production's label an index into the header's labels. */
type StoredDetail = Partial<Omit<ContractSnapshotRow, 'production'>> & {
  production?: { status: 'projected' | 'unknown'; label: number; seasons: NonNullable<ContractSnapshotRow['production']>['seasons'] };
};

/** A row's detail with its empty fields left out (a minor-league deal is its placement alone): the snapshot's size. */
function compact(detail: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== null && v !== undefined)));
}

interface HeaderRow {
  seq: number; league_id: number; game_date: string; game_date_exported: string | null; season: number | null; season_played: number | null;
  minimum_salary: number | null; financials: number | null; arbitration_json: string; row_count: number; population: string; labels_json: string;
}

const HEADER_COLUMNS = 'rowid AS seq, league_id, game_date, game_date_exported, season, season_played, minimum_salary, financials, arbitration_json, row_count, population, labels_json';

/** This save's recorded imports for the league, in the order they were recorded (headers only). */
export function contractImports(leagueId: number): ContractImport[] {
  const rows = historyDb.prepare(
    `SELECT ${HEADER_COLUMNS} FROM value_contract_imports WHERE save_name = ? AND league_id = ? ORDER BY rowid`
  ).all(saveIdentity(leagueId), leagueId) as HeaderRow[];
  return rows.map((r) => ({
    leagueId: r.league_id, gameDate: r.game_date, gameDateExported: r.game_date_exported, season: r.season,
    seasonPlayed: r.season_played, rows: r.row_count, population: r.population, seq: r.seq,
  }));
}

const parse = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

function snapshotOf(save: string, h: HeaderRow): ContractSnapshot {
  const labels = parse<string[]>(h.labels_json, []);
  const rows = historyDb.prepare(
    `SELECT player_id, team_id, org_id, kind, first_season, years, salaries_json, detail_json
     FROM value_contract_snapshots WHERE save_name = ? AND league_id = ? AND game_date = ?`
  ).all(save, h.league_id, h.game_date) as Array<{
    player_id: number; team_id: number | null; org_id: number | null; kind: string | null; first_season: number | null; years: number | null;
    salaries_json: string; detail_json: string;
  }>;
  return {
    leagueId: h.league_id,
    gameDate: h.game_date,
    season: h.season,
    seasonPlayed: h.season_played,
    minimum: h.minimum_salary,
    financials: h.financials === null ? null : h.financials === 1,
    arbitration: parse(h.arbitration_json, { status: 'unknown', classes: null, mlb: null }),
    rows: rows.map((r): ContractSnapshotRow => {
      const d = parse<StoredDetail>(r.detail_json, {});
      return {
        playerId: r.player_id, teamId: r.team_id, orgId: r.org_id,
        kind: r.kind === 'major_league' || r.kind === 'minor_league' ? r.kind : null,
        firstSeason: r.first_season, years: r.years, salaries: parse(r.salaries_json, []),
        extension: d.extension ?? null, placement: d.placement ?? 'other', majorRecord: d.majorRecord === true,
        rights: d.rights ?? null, serviceNow: d.serviceNow ?? null, nextCost: d.nextCost ?? null,
        production: d.production ? { status: d.production.status, label: labels[d.production.label] ?? 'not recorded', seasons: d.production.seasons } : null,
      };
    }),
  };
}

/** One recorded import's contracts, or null where this save has not recorded that date. */
export function contractSnapshotAt(leagueId: number, gameDate: string): ContractSnapshot | null {
  const save = saveIdentity(leagueId);
  const h = historyDb.prepare(`SELECT ${HEADER_COLUMNS} FROM value_contract_imports WHERE save_name = ? AND league_id = ? AND game_date = ?`)
    .get(save, leagueId, keyOf(gameDate)) as HeaderRow | undefined;
  return h ? snapshotOf(save, h) : null;
}

/**
 * This save's recorded contracts for the league, one snapshot per import, oldest game date first. Every import is
 * read: for a report or a check. The market is read from the stored pairs (`contractPair`), never from this.
 */
export function contractSnapshots(leagueId: number): ContractSnapshot[] {
  const save = saveIdentity(leagueId);
  const headers = historyDb.prepare(`SELECT ${HEADER_COLUMNS} FROM value_contract_imports WHERE save_name = ? AND league_id = ?`).all(save, leagueId) as HeaderRow[];
  return headers.map((h) => snapshotOf(save, h)).sort((a, b) => keyOf(a.gameDate).localeCompare(keyOf(b.gameDate)));
}

/** What was recorded with an import (its play digest and why its season counts as begun or not), or null. */
export function recordedEvent(leagueId: number, gameDate: string): { seq: number; playDigest: string | null; seasonState: string | null } | null {
  const r = historyDb.prepare(`SELECT seq, detail_json FROM value_contract_events WHERE save_name = ? AND league_id = ? AND event = 'recorded' AND game_date = ? ORDER BY seq DESC LIMIT 1`)
    .get(saveIdentity(leagueId), leagueId, keyOf(gameDate)) as { seq: number; detail_json: string } | undefined;
  if (!r) return null;
  const d = parse<{ playDigest?: string | null; seasonState?: string | null }>(r.detail_json, {});
  return { seq: r.seq, playDigest: d.playDigest ?? null, seasonState: d.seasonState ?? null };
}

/** Record that the next import starts a new timeline (review R3-05): after the import recorded last, at a date, and why. Idempotent per position. */
export function recordTimelineBreak(leagueId: number, afterSeq: number, gameDate: string, reason: string): boolean {
  const changes = historyDb.prepare(
    `INSERT OR IGNORE INTO value_contract_events (save_name, league_id, seq, event, game_date, observed_at, detail_json) VALUES (?, ?, ?, 'break', ?, ?, ?)`
  ).run(saveIdentity(leagueId), leagueId, afterSeq, keyOf(gameDate), new Date().toISOString(), JSON.stringify({ reason })).changes;
  if (changes > 0) writes.version += 1;
  return changes > 0;
}

/** The timeline breaks recorded for this save and league. */
export function contractBreaks(leagueId: number): TimelineBreak[] {
  const rows = historyDb.prepare(`SELECT seq, game_date, detail_json FROM value_contract_events WHERE save_name = ? AND league_id = ? AND event = 'break' ORDER BY seq`)
    .all(saveIdentity(leagueId), leagueId) as Array<{ seq: number; game_date: string; detail_json: string }>;
  return rows.map((r) => ({ afterSeq: r.seq, gameDate: r.game_date, reason: parse<{ reason?: string }>(r.detail_json, {}).reason ?? 'the save is on another timeline' }));
}

/** Store the pair two consecutive imports formed, with the reading's method. Idempotent per pair and method. */
export function recordContractPair(leagueId: number, pair: WinterPair): boolean {
  const changes = historyDb.prepare(
    `INSERT OR IGNORE INTO value_contract_pairs (save_name, league_id, earlier_date, later_date, method, observed_at, pair_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(saveIdentity(leagueId), leagueId, keyOf(pair.earlier), keyOf(pair.later), pair.method, new Date().toISOString(), JSON.stringify(pair)).changes;
  if (changes > 0) writes.version += 1;
  return changes > 0;
}

/** The stored pair of two imports under a method, or null where it was not stored (or under another method). */
export function contractPair(leagueId: number, earlier: string, later: string, method: string): WinterPair | null {
  const r = historyDb.prepare(`SELECT pair_json FROM value_contract_pairs WHERE save_name = ? AND league_id = ? AND earlier_date = ? AND later_date = ? AND method = ?`)
    .get(saveIdentity(leagueId), leagueId, keyOf(earlier), keyOf(later), method) as { pair_json: string } | undefined;
  return r ? parse<WinterPair | null>(r.pair_json, null) : null;
}
