/**
 * Player Value's third writer (phase 4b): the per-import contract snapshot in `history.db` (PLAYER_VALUE.md 4.2, Part 7).
 *
 * `league.db` is replaced by every import, so the contracts it describes today are gone tomorrow. This records, once
 * per import, what each contract the market league's clubs held looked like and what was known about the player then:
 * the term and its salaries, his club and organization and placement, Player Rights' standing for this season and the
 * two after it, his expected production (the entry point's projection, with its basis), and the cost next season's
 * timeline priced. The next import is set against it: what changed between the two is what OOTP's clubs did
 * (`playerValueSignings.ts`).
 *
 *   - Keyed by the save's IDENTITY (`saveIdentity`: its configured name and the league's fingerprint, hardening F1),
 *     the league and the game date (`parseGameDate`), and the player: a new save under a reused name never reads
 *     another's contracts. Idempotent per key: a second capture of the same import finds its header and writes nothing.
 *   - Bounded: one row per player the market league's clubs hold, and per unsigned player whose production is
 *     established; a minor-league deal carries only its terms (no standing, production or cost). The population and
 *     its row count are recorded with the header.
 *   - Additive: CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE; nothing alters, replaces or drops a row. Never league.db,
 *     never a timer. The rows are computed by the entry point and handed here; this module stores and reads them.
 */

import { parseGameDate } from './dataFreshness.js';
import { historyDb } from './history.js';
import { saveIdentity } from './playerValueFitStore.js';
import type { ContractSnapshot, ContractSnapshotRow } from './playerValueSignings.js';

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
}

export interface ContractSnapshotInput extends ContractSnapshot {
  gameDateExported: string | null;
  /** The population recorded, in words (the bound on the snapshot's size). */
  population: string;
}

/** Whether this import (save identity, league, game date) is already recorded. */
export function contractSnapshotRecorded(leagueId: number, gameDate: string): boolean {
  const key = parseGameDate(gameDate) ?? gameDate;
  return historyDb.prepare(`SELECT 1 FROM value_contract_imports WHERE save_name = ? AND league_id = ? AND game_date = ?`)
    .get(saveIdentity(leagueId), leagueId, key) !== undefined;
}

/**
 * Record one import's contracts. Idempotent per key: a second record of the same import writes nothing. Returns the
 * rows written (the header's and the players').
 */
export function recordContractSnapshot(s: ContractSnapshotInput): number {
  const save = saveIdentity(s.leagueId);
  const key = parseGameDate(s.gameDate) ?? s.gameDate;
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
    const h = header.run(
      save, s.leagueId, key, s.gameDateExported, new Date().toISOString(), s.season, s.seasonPlayed, s.minimum,
      s.financials === null ? null : s.financials ? 1 : 0, JSON.stringify(s.arbitration), s.rows.length, s.population, JSON.stringify(labels),
    ).changes;
    if (h === 0) return 0;
    let n = h;
    s.rows.forEach((r, i) => {
      n += row.run(save, s.leagueId, key, r.playerId, r.teamId, r.orgId, r.kind, r.firstSeason, r.years, JSON.stringify(r.salaries), details[i]).changes;
    });
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
  league_id: number; game_date: string; game_date_exported: string | null; season: number | null; season_played: number | null;
  minimum_salary: number | null; financials: number | null; arbitration_json: string; row_count: number; population: string; labels_json: string;
}

const byGameDate = <T extends { gameDate: string }>(a: T, b: T) =>
  (parseGameDate(a.gameDate) ?? a.gameDate).localeCompare(parseGameDate(b.gameDate) ?? b.gameDate);

/** This save's recorded imports for the league, oldest first (headers only). */
export function contractImports(leagueId: number): ContractImport[] {
  const rows = historyDb.prepare(
    `SELECT league_id, game_date, game_date_exported, season, season_played, minimum_salary, financials, arbitration_json, row_count, population
     FROM value_contract_imports WHERE save_name = ? AND league_id = ?`
  ).all(saveIdentity(leagueId), leagueId) as HeaderRow[];
  return rows.map((r) => ({
    leagueId: r.league_id, gameDate: r.game_date, gameDateExported: r.game_date_exported, season: r.season,
    seasonPlayed: r.season_played, rows: r.row_count, population: r.population,
  })).sort(byGameDate);
}

const parse = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/** This save's recorded contracts for the league, one snapshot per import, oldest first. */
export function contractSnapshots(leagueId: number): ContractSnapshot[] {
  const save = saveIdentity(leagueId);
  const headers = historyDb.prepare(
    `SELECT league_id, game_date, game_date_exported, season, season_played, minimum_salary, financials, arbitration_json, row_count, population, labels_json
     FROM value_contract_imports WHERE save_name = ? AND league_id = ?`
  ).all(save, leagueId) as HeaderRow[];
  const rowsOf = historyDb.prepare(
    `SELECT player_id, team_id, org_id, kind, first_season, years, salaries_json, detail_json
     FROM value_contract_snapshots WHERE save_name = ? AND league_id = ? AND game_date = ?`
  );
  return headers.map((h): ContractSnapshot => ({
    leagueId: h.league_id,
    gameDate: h.game_date,
    season: h.season,
    seasonPlayed: h.season_played,
    minimum: h.minimum_salary,
    financials: h.financials === null ? null : h.financials === 1,
    arbitration: parse(h.arbitration_json, { status: 'unknown', classes: null, mlb: null }),
    rows: (rowsOf.all(save, leagueId, h.game_date) as Array<{
      player_id: number; team_id: number | null; org_id: number | null; kind: string | null; first_season: number | null; years: number | null;
      salaries_json: string; detail_json: string;
    }>).map((r): ContractSnapshotRow => {
      const labels = parse<string[]>(h.labels_json, []);
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
  })).sort(byGameDate);
}
