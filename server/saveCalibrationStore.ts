/**
 * The per-save calibration store, for every subsystem (D-053): one table in `history.db`, keyed by the save's
 * identity, the league, the subsystem and component, the method, and what the fit rests on.
 *
 * Calibration belongs to the save. A subsystem's fitted numbers are computed from the save's own history (or, for
 * a measurement of the league as it stands, from the current export), recorded here with a run record that is their
 * stamp, and adopted only through that subsystem's gate. A fit that fails is recorded too, never adopted, so its
 * reason is visible and the fit in force stays.
 *
 *   - `basis` is what the fit rests on: the last completed season it was fitted through (`2025`), or the game date
 *     of the export it measured (`2026-05-16`). A re-import that brings nothing new finds its key and fits nothing.
 *   - Keyed by the save's IDENTITY (`saveIdentity.ts`): a new save under a reused name never finds another's fits.
 *   - A fit through a season the league has not completed is never served (a reverted save), and a refit that fails
 *     its gate never replaces an adopted row, even when forced.
 *   - Additive and idempotent, like every history.db table: CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE; only a
 *     developer's forced refit (the harness) replaces a row. Never league.db, never OOTP's files, never a timer.
 *
 * Player Value's own table (`value_production_fits`) predates this one and is not migrated (cycle 1).
 */

import { historyDb } from './history.js';
import { saveIdentity } from './saveIdentity.js';

historyDb.exec(`
  CREATE TABLE IF NOT EXISTS save_calibration_fits (
    save_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    subsystem TEXT NOT NULL,
    component TEXT NOT NULL,
    method TEXT NOT NULL,
    basis TEXT NOT NULL,
    through_season INTEGER,
    game_date TEXT,
    fitted_at TEXT NOT NULL,
    adopted INTEGER NOT NULL,
    reason TEXT NOT NULL,
    prior_weight REAL,
    fit_ms REAL,
    model_json TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (save_name, league_id, subsystem, component, method, basis)
  );
`);

/** A check the fit was put to, in the record: what was checked, on what, what was expected and what happened. */
export interface CalibrationCheck {
  /** What the check is ("club_split", "history", "age_band", "position"), and the part it is about. */
  kind: string;
  part: string;
  /** Cases the check rests on. */
  n: number;
  /** What the policy expects (a share, a bias of zero, the prior's score) and what was observed. */
  expected: number | null;
  observed: number | null;
  /** The standard error of the observation, when the check has one. */
  se?: number | null;
  /** The same check applied to the fallback prior, for comparison, when it can be. */
  prior?: number | null;
  passed: boolean | null;
  note?: string;
}

/** The run record every stored fit carries: its stamp (D-053). */
export interface CalibrationRecord {
  leagueId: number;
  subsystem: string;
  component: string;
  method: string;
  /** What the fit rests on: a completed season, or the game date of the export it measured. */
  basis: { throughSeason: number | null; gameDate: string | null };
  /** The seasons and the sample it was fitted on, and the seasons left out with why. */
  window: { seasons: number[]; skipped: Array<{ season: number; reason: string }>; sample: number; unit: string };
  /** The checks on cases the fit did not see (held-out seasons, held-out clubs). Empty when none could be run. */
  heldOut: CalibrationCheck[];
  /** How much of the served numbers is still the fallback prior (0 to 1), overall and by part. */
  priorWeight: { overall: number; byPart: Record<string, number> };
  gate: { passed: boolean; reason: string; failures: string[] };
  /** Where the fallback prior came from. */
  priorSource: string;
  /** Plain statements about what could not be measured and why (a limitation the record owns). */
  notes: string[];
}

export interface StoredCalibration<M = unknown> {
  saveName: string;
  leagueId: number;
  subsystem: string;
  component: string;
  method: string;
  basis: string;
  throughSeason: number | null;
  gameDate: string | null;
  fittedAt: string;
  adopted: boolean;
  reason: string;
  priorWeight: number | null;
  fitMs: number | null;
  model: M;
  record: CalibrationRecord;
}

interface Row {
  save_name: string; league_id: number; subsystem: string; component: string; method: string; basis: string; through_season: number | null;
  game_date: string | null; fitted_at: string; adopted: number; reason: string; prior_weight: number | null; fit_ms: number | null;
  model_json: string; record_json: string;
}

const COLUMNS = 'save_name, league_id, subsystem, component, method, basis, through_season, game_date, fitted_at, adopted, reason, prior_weight, fit_ms, model_json, record_json';

function parse<M>(row: Row | undefined): StoredCalibration<M> | null {
  if (!row) return null;
  try {
    return {
      saveName: row.save_name, leagueId: row.league_id, subsystem: row.subsystem, component: row.component, method: row.method, basis: row.basis,
      throughSeason: row.through_season, gameDate: row.game_date, fittedAt: row.fitted_at, adopted: row.adopted === 1, reason: row.reason,
      priorWeight: row.prior_weight, fitMs: row.fit_ms, model: JSON.parse(row.model_json) as M, record: JSON.parse(row.record_json) as CalibrationRecord,
    };
  } catch {
    return null;
  }
}

/** The key a record is stored under: the completed season, else the game date. */
export function basisKey(record: Pick<CalibrationRecord, 'basis'>): string {
  return record.basis.throughSeason !== null ? String(record.basis.throughSeason) : record.basis.gameDate ?? 'unknown';
}

/** Whether a fit for this save, league, component, method and basis has been made (adopted or not). */
export function calibrationAttempted(leagueId: number, subsystem: string, component: string, method: string, basis: string): boolean {
  return historyDb.prepare(
    `SELECT 1 FROM save_calibration_fits WHERE save_name = ? AND league_id = ? AND subsystem = ? AND component = ? AND method = ? AND basis = ?`
  ).get(saveIdentity(leagueId), leagueId, subsystem, component, method, basis) !== undefined;
}

/**
 * Record a fit. Idempotent per key: a second record of the same key writes nothing, unless `force` (a developer's refit
 * from the harness) replaces it; a forced refit that fails its gate never replaces an adopted row. Returns rows written.
 */
export function recordCalibration(run: { model: unknown; record: CalibrationRecord }, meta: { fitMs: number | null; force?: boolean }): number {
  const r = run.record;
  const save = saveIdentity(r.leagueId);
  const basis = basisKey(r);
  if (meta.force && !r.gate.passed) {
    const held = historyDb.prepare(
      `SELECT adopted FROM save_calibration_fits WHERE save_name = ? AND league_id = ? AND subsystem = ? AND component = ? AND method = ? AND basis = ?`
    ).get(save, r.leagueId, r.subsystem, r.component, r.method, basis) as { adopted: number } | undefined;
    if (held?.adopted === 1) return 0;
  }
  const verb = meta.force ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  return historyDb.prepare(
    `${verb} INTO save_calibration_fits (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    save, r.leagueId, r.subsystem, r.component, r.method, basis, r.basis.throughSeason, r.basis.gameDate, new Date().toISOString(),
    r.gate.passed ? 1 : 0, r.gate.reason, r.priorWeight.overall, meta.fitMs, JSON.stringify(run.model), JSON.stringify(r),
  ).changes;
}

/**
 * The fit in force for this save, league, component and method: the adopted one resting on the latest basis, never one through
 * a season the league has not completed (`throughMax`), or null. A measurement keyed by game date is ordered by that date.
 */
export function adoptedCalibration<M = unknown>(leagueId: number, subsystem: string, component: string, method: string, throughMax: number | null = null): StoredCalibration<M> | null {
  return parse<M>(historyDb.prepare(
    `SELECT ${COLUMNS} FROM save_calibration_fits WHERE save_name = ? AND league_id = ? AND subsystem = ? AND component = ? AND method = ? AND adopted = 1
       AND (through_season IS NULL OR through_season <= ?)
     ORDER BY COALESCE(through_season, 0) DESC, COALESCE(game_date, '') DESC LIMIT 1`
  ).get(saveIdentity(leagueId), leagueId, subsystem, component, method, throughMax ?? Number.MAX_SAFE_INTEGER) as Row | undefined);
}

/** The most recent attempt for this save, league, component and method, adopted or not (so a rejection's reason is visible). */
export function latestCalibrationAttempt<M = unknown>(leagueId: number, subsystem: string, component: string, method: string): StoredCalibration<M> | null {
  return parse<M>(historyDb.prepare(
    `SELECT ${COLUMNS} FROM save_calibration_fits WHERE save_name = ? AND league_id = ? AND subsystem = ? AND component = ? AND method = ?
     ORDER BY COALESCE(through_season, 0) DESC, COALESCE(game_date, '') DESC, fitted_at DESC LIMIT 1`
  ).get(saveIdentity(leagueId), leagueId, subsystem, component, method) as Row | undefined);
}
