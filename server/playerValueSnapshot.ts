/**
 * Player Value's one writer: the per-import market snapshot in `history.db` (PLAYER_VALUE.md Part 7,
 * D-009).
 *
 * `league.db` is replaced by every import, so the market it describes today is gone tomorrow. This
 * records, once per import, what the league's market looked like: the opening price of a win (band
 * and basis), the replacement level measured per season, the financial regime as exported, the
 * league's payroll and how many contracts were market prices, and (phase 4a, inside the basis) the cost
 * ladder: the renewal spread and the arbitration ladder measured on this import. The history is what lets
 * drift be seen, and what phase 4b will set observed signings and arbitration awards against.
 *
 *   - Keyed by save, league and game date (the export's `leagues.current_date`, normalised through
 *     `parseGameDate`, so `2026-5-9` and `2026-05-09` are one key). Idempotent per key: a re-run of
 *     the same import finds its row and writes nothing, and computes nothing either.
 *   - Written once per import from `runImport`, beside the rating and roster-state snapshots, and it
 *     can never fail the import: every error is caught here and returned, never thrown.
 *   - No timer: data changes only on import (D-009).
 *   - The table is created with CREATE TABLE IF NOT EXISTS, as every history.db table is: additive,
 *     and safe for an existing user's file. Nothing here alters or drops anything.
 *
 * It reads the market through the entry point, and it is the only Player Value module that writes
 * anything, and only to `history.db` (`tests/playerValueBoundary.test.ts`). The price itself never
 * reads this history: nothing in one import, or in any number of snapshots of it, narrows it.
 */

import { db, tableColumns, tableExists } from './db.js';
import { parseGameDate } from './dataFreshness.js';
import { historyDb } from './history.js';
import { saveIdentity } from './playerValueFitStore.js';
import { leagueFinances, marketLeagues, type LeagueFinances } from './playerValue.js';

historyDb.exec(`
  CREATE TABLE IF NOT EXISTS value_market_snapshots (
    save_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    game_date TEXT NOT NULL,
    game_date_exported TEXT,
    observed_at TEXT NOT NULL,
    import_finished_at TEXT,
    season INTEGER,
    price_label TEXT NOT NULL,
    price_unit TEXT NOT NULL,
    price_central REAL,
    price_low REAL,
    price_high REAL,
    floor_low REAL,
    floor_high REAL,
    price_note TEXT,
    market_contracts INTEGER,
    league_payroll REAL,
    replacement_json TEXT NOT NULL,
    regime_json TEXT NOT NULL,
    basis_json TEXT NOT NULL,
    PRIMARY KEY (save_name, league_id, game_date)
  );
`);

export interface MarketSnapshot {
  saveName: string;
  leagueId: number;
  /** ISO game date (the key). */
  gameDate: string;
  /** `leagues.current_date` as the export wrote it. */
  gameDateExported: string | null;
  /** Wall-clock time the row was written: a diagnostic only (D-022). */
  observedAt: string;
  importFinishedAt: string | null;
  season: number | null;
  priceLabel: string;
  priceUnit: string;
  price: { central: number; low: number; high: number } | null;
  floor: { low: number; high: number } | null;
  priceNote: string | null;
  marketContracts: number | null;
  leaguePayroll: number | null;
  replacement: Array<{ season: number; toDate: boolean; level: number | null; note: string | null }>;
  regime: unknown;
  /**
   * The price's basis as recorded. Since phase 4a it holds `costs` (the cost ladder), but only for a key first written
   * after the upgrade (a key is never rewritten), and the phase 4a review changed a reading's shape (a robust line in
   * dollars, its bootstrap error, the at-minimum deals): a reader treats `costs` as optional and checks its shape.
   */
  basis: unknown;
}

export interface SnapshotResult {
  /** Rows written by this call. */
  written: number;
  /** Keys already recorded, left as they were. */
  existing: number;
  /** Leagues with no usable game date, and why. */
  skipped: string[];
  /** Why the snapshot could not be taken; the import goes on regardless. */
  error: string | null;
}

export interface SnapshotOptions {
  /** When the import that produced this export finished, if known. */
  importFinishedAt?: string | null;
  /** How a league's market is computed; the entry point's `leagueFinances` unless a test says otherwise. */
  compute?: (leagueId: number) => LeagueFinances;
}

/** The league's game date as exported, or null when the export has none. */
function exportedGameDate(leagueId: number): string | null {
  if (!tableExists('leagues')) return null;
  const columns = new Set(tableColumns('leagues'));
  if (!columns.has('league_id') || !columns.has('current_date')) return null;
  const row = db.prepare(`SELECT "current_date" AS d FROM leagues WHERE league_id = ?`).get(leagueId) as { d: unknown } | undefined;
  return typeof row?.d === 'string' ? row.d : null;
}

/**
 * Records this import's market for every league that runs its own economy. Never throws: a
 * failure is returned, and the import it runs inside carries on.
 */
export function captureMarketSnapshot(options: SnapshotOptions = {}): SnapshotResult {
  const result: SnapshotResult = { written: 0, existing: 0, skipped: [], error: null };
  try {
    const compute = options.compute ?? ((id: number) => leagueFinances(id));
    const exists = historyDb.prepare(
      `SELECT 1 FROM value_market_snapshots WHERE save_name = ? AND league_id = ? AND game_date = ?`
    );
    const insert = historyDb.prepare(
      `INSERT OR IGNORE INTO value_market_snapshots
       (save_name, league_id, game_date, game_date_exported, observed_at, import_finished_at, season,
        price_label, price_unit, price_central, price_low, price_high, floor_low, floor_high, price_note,
        market_contracts, league_payroll, replacement_json, regime_json, basis_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const leagueId of marketLeagues()) {
      const exported = exportedGameDate(leagueId);
      const gameDate = parseGameDate(exported);
      if (gameDate === null) {
        result.skipped.push(`League ${leagueId}: no usable current_date in the export (${exported ?? 'none'}), so there is no key to record it under.`);
        continue;
      }
      // Keyed by the save's identity, never its name alone: a new save under a reused name records its own (D-01)
      const saveName = saveIdentity(leagueId);
      if (exists.get(saveName, leagueId, gameDate)) {
        result.existing += 1;
        continue;
      }
      const market = compute(leagueId);
      const price = market.priceOfWin;
      const changes = insert.run(
        saveName, leagueId, gameDate, exported, new Date().toISOString(), options.importFinishedAt ?? null,
        market.season.value,
        price.label, price.unit,
        price.price.value?.central ?? null, price.price.value?.low ?? null, price.price.value?.high ?? null,
        price.floor.value?.low ?? null, price.floor.value?.high ?? null,
        price.price.note ?? null,
        price.population.market,
        market.leaguePayroll.value,
        JSON.stringify(market.replacementLevel.map((r) => ({
          season: r.season, toDate: r.toDate, level: r.level.value, note: r.level.note ?? null,
          wins: r.leagueWins, war: r.leagueWar, games: r.games, stamp: r.stamp.status,
        }))),
        JSON.stringify(market.regime),
        JSON.stringify({
          bases: price.bases, population: price.population, assumptions: price.assumptions, rules: price.rules,
          notUsed: price.notUsed, stamps: price.stamps, seasonPlayed: market.seasonPlayed,
          leaguePayroll: market.leaguePayroll,
          // Phase 4a: the cost ladder measured at this import (the renewal spread and the arbitration ladder), so its drift is visible
          costs: market.costs,
        }),
      ).changes;
      if (changes > 0) result.written += 1;
      else result.existing += 1;
    }
  } catch (err) {
    result.error = (err as Error).message ?? String(err);
  }
  return result;
}

interface Row {
  save_name: string; league_id: number; game_date: string; game_date_exported: string | null; observed_at: string;
  import_finished_at: string | null; season: number | null; price_label: string; price_unit: string;
  price_central: number | null; price_low: number | null; price_high: number | null;
  floor_low: number | null; floor_high: number | null; price_note: string | null;
  market_contracts: number | null; league_payroll: number | null;
  replacement_json: string; regime_json: string; basis_json: string;
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The league's recorded market, oldest game date first (ordered through `parseGameDate`). */
/** The market history of this save (its identity: name and league fingerprint, D-01), oldest first. */
export function marketSnapshotHistory(leagueId: number, saveName = saveIdentity(leagueId)): MarketSnapshot[] {
  const rows = historyDb.prepare(
    `SELECT save_name, league_id, game_date, game_date_exported, observed_at, import_finished_at, season,
            price_label, price_unit, price_central, price_low, price_high, floor_low, floor_high, price_note,
            market_contracts, league_payroll, replacement_json, regime_json, basis_json
     FROM value_market_snapshots WHERE save_name = ? AND league_id = ?`
  ).all(saveName, leagueId) as Row[];
  return rows
    .map((r): MarketSnapshot => ({
      saveName: r.save_name,
      leagueId: r.league_id,
      gameDate: r.game_date,
      gameDateExported: r.game_date_exported,
      observedAt: r.observed_at,
      importFinishedAt: r.import_finished_at,
      season: r.season,
      priceLabel: r.price_label,
      priceUnit: r.price_unit,
      price: r.price_central !== null && r.price_low !== null && r.price_high !== null
        ? { central: r.price_central, low: r.price_low, high: r.price_high } : null,
      floor: r.floor_low !== null && r.floor_high !== null ? { low: r.floor_low, high: r.floor_high } : null,
      priceNote: r.price_note,
      marketContracts: r.market_contracts,
      leaguePayroll: r.league_payroll,
      replacement: (parse(r.replacement_json) as MarketSnapshot['replacement']) ?? [],
      regime: parse(r.regime_json),
      basis: parse(r.basis_json),
    }))
    .sort((a, b) => (parseGameDate(a.gameDate) ?? a.gameDate).localeCompare(parseGameDate(b.gameDate) ?? b.gameDate));
}
