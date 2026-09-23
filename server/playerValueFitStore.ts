/**
 * Player Value's second writer: the per-save store of production fits in `history.db` (D-053,
 * PLAYER_VALUE.md Part 7).
 *
 * Calibration belongs to the save. Each fit of the production model (`playerValueProductionFit.ts`)
 * is recorded here with its run record, which is its stamp: the seasons and sample it was fit on,
 * the held-out coverage per horizon (80% and 50%), the prior's weight, the gate's verdict and
 * reason, the method version, when it was fitted (the import's game date; the wall clock only as a
 * diagnostic). A fit that fails the gate is recorded too, never adopted, so the reason is visible
 * and the previous fit stays in force.
 *
 *   - Keyed by save, league, the last completed season the fit used, and the method version: a
 *     re-import that brings no newer completed season finds its key and fits nothing.
 *   - Additive and idempotent, like every history.db table: CREATE TABLE IF NOT EXISTS, INSERT OR
 *     IGNORE; only a developer's forced refit (the harness) replaces a row.
 *   - Never league.db, never a timer. It is reached only through the entry point (`playerValue.ts`).
 *   - Phase 3b stores the ratings model (`playerValueRatingsFit.ts`) in the same table under its own
 *     method (`RATINGS_METHOD`), with its own run record and gate verdict.
 */

import { currentSaveName, historyDb } from './history.js';
import type { ProductionModel } from './playerValueProduction.js';
import type { FitRecord } from './playerValueProductionFit.js';

historyDb.exec(`
  CREATE TABLE IF NOT EXISTS value_production_fits (
    save_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    through_season INTEGER NOT NULL,
    method TEXT NOT NULL,
    game_date TEXT,
    fitted_at TEXT NOT NULL,
    adopted INTEGER NOT NULL,
    reason TEXT NOT NULL,
    prior_weight REAL,
    fit_ms REAL,
    model_json TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (save_name, league_id, through_season, method)
  );
`);

/** What the store needs of any fit's run record: its key, the gate's verdict and the prior's weight. */
export interface StorableRecord {
  id: string;
  leagueId: number;
  throughSeason: number;
  method: string;
  gate: { passed: boolean; reason: string };
  priorWeight: { overall: number };
}

export interface StoredFit<M = ProductionModel, R = FitRecord> {
  saveName: string;
  leagueId: number;
  throughSeason: number;
  method: string;
  /** The import's game date when it was fitted (ISO, `parseGameDate`). */
  gameDate: string | null;
  /** Wall-clock time the row was written: a diagnostic only (D-022). */
  fittedAt: string;
  adopted: boolean;
  reason: string;
  priorWeight: number | null;
  fitMs: number | null;
  model: M;
  record: R;
}

interface Row {
  save_name: string; league_id: number; through_season: number; method: string; game_date: string | null; fitted_at: string;
  adopted: number; reason: string; prior_weight: number | null; fit_ms: number | null; model_json: string; record_json: string;
}

const COLUMNS = 'save_name, league_id, through_season, method, game_date, fitted_at, adopted, reason, prior_weight, fit_ms, model_json, record_json';

function parse<M, R>(row: Row | undefined): StoredFit<M, R> | null {
  if (!row) return null;
  try {
    return {
      saveName: row.save_name, leagueId: row.league_id, throughSeason: row.through_season, method: row.method,
      gameDate: row.game_date, fittedAt: row.fitted_at, adopted: row.adopted === 1, reason: row.reason,
      priorWeight: row.prior_weight, fitMs: row.fit_ms,
      model: JSON.parse(row.model_json) as M, record: JSON.parse(row.record_json) as R,
    };
  } catch {
    return null;
  }
}

/** Whether a fit for this save, league, last completed season and method has been made (adopted or not). */
export function productionFitAttempted(leagueId: number, throughSeason: number, method: string): boolean {
  return historyDb.prepare(
    `SELECT 1 FROM value_production_fits WHERE save_name = ? AND league_id = ? AND through_season = ? AND method = ?`
  ).get(currentSaveName(), leagueId, throughSeason, method) !== undefined;
}

/**
 * Record a fit. Idempotent per key: a second record of the same key writes nothing, unless `force`
 * (a developer's refit from the harness) replaces it. Returns rows written.
 */
export function recordProductionFit(run: { model: unknown; record: StorableRecord }, meta: { gameDate: string | null; fitMs: number | null; force?: boolean }): number {
  const verb = meta.force ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  const r = run.record;
  return historyDb.prepare(
    `${verb} INTO value_production_fits (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    currentSaveName(), r.leagueId, r.throughSeason, r.method, meta.gameDate, new Date().toISOString(),
    r.gate.passed ? 1 : 0, r.gate.reason, r.priorWeight.overall, meta.fitMs,
    JSON.stringify(run.model), JSON.stringify(r),
  ).changes;
}

/** The fit in force for this save and league: the adopted one with the latest completed season, or null. */
export function adoptedProductionFit<M = ProductionModel, R = FitRecord>(leagueId: number, method: string): StoredFit<M, R> | null {
  return parse<M, R>(historyDb.prepare(
    `SELECT ${COLUMNS} FROM value_production_fits WHERE save_name = ? AND league_id = ? AND method = ? AND adopted = 1
     ORDER BY through_season DESC LIMIT 1`
  ).get(currentSaveName(), leagueId, method) as Row | undefined);
}

/** The most recent fit attempt for this save and league, adopted or not (so a rejection's reason is visible). */
export function latestProductionFitAttempt<M = ProductionModel, R = FitRecord>(leagueId: number, method: string): StoredFit<M, R> | null {
  return parse<M, R>(historyDb.prepare(
    `SELECT ${COLUMNS} FROM value_production_fits WHERE save_name = ? AND league_id = ? AND method = ?
     ORDER BY through_season DESC LIMIT 1`
  ).get(currentSaveName(), leagueId, method) as Row | undefined);
}
