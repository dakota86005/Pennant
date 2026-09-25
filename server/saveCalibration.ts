/**
 * The per-save refit, for every subsystem that registers a component (D-053; cycle 1 of the per-save calibration).
 *
 * A subsystem registers each fitted component once: its name, its method version, when it is refitted, and how it is
 * computed. After an import (in the refit worker, off the server's event loop, never able to fail the import) every
 * registered component is computed for each top-level league whose export calls for it, and the main thread records
 * the results (`saveCalibrationStore.ts`), adopted only through each component's own gate.
 *
 *   trigger 'completed_season'  refit once per new completed season (a model fitted on the league's history)
 *   trigger 'each_import'       measure once per export game date (a description of the league as it stands now)
 *
 * The registry holds no method: each subsystem owns its own (MLB Operations: `mlbCalibration.ts`). Cycles 2 to 4 add
 * components here without a schema change.
 */

import { completedThrough, leagueGameDate, topLeagues } from './saveIdentity.js';
import { calibrationAttempted, recordCalibration, basisKey, type CalibrationRecord } from './saveCalibrationStore.js';

export interface CalibrationRun<M = unknown> {
  model: M;
  record: CalibrationRecord;
}

export interface CalibrationBasis {
  leagueId: number;
  /** The last completed season in the export (null when it cannot be established). */
  throughSeason: number | null;
  /** The export's game date (ISO), for a measurement of the league as it stands. */
  gameDate: string | null;
}

export interface CalibrationComponent {
  subsystem: string;
  component: string;
  method: string;
  trigger: 'completed_season' | 'each_import';
  /** Compute the fit for a league on this basis; null when there is nothing to fit (the reason is the outcome's). Reads only. */
  compute(basis: CalibrationBasis): CalibrationRun | { skip: string };
}

export interface CalibrationOutcome {
  leagueId: number;
  subsystem: string;
  component: string;
  method: string;
  basis: string | null;
  refit: boolean;
  adopted: boolean | null;
  reason: string;
  ms: number | null;
}

export interface PendingCalibration {
  run: CalibrationRun | null;
  ms: number | null;
  force: boolean;
  outcome: CalibrationOutcome;
}

const registry: CalibrationComponent[] = [];

/** Register a component (idempotent by subsystem, component and method). */
export function registerCalibration(c: CalibrationComponent): void {
  if (!registry.some((r) => r.subsystem === c.subsystem && r.component === c.component && r.method === c.method)) registry.push(c);
}

export function registeredCalibrations(): readonly CalibrationComponent[] {
  return registry;
}

/** The basis a component would rest on now, or why it cannot be established. */
function basisFor(leagueId: number, c: CalibrationComponent): { basis: CalibrationBasis; key: string } | { skip: string } {
  const { season } = completedThrough(leagueId);
  const gameDate = leagueGameDate(leagueId);
  if (c.trigger === 'completed_season') {
    if (season === null) return { skip: "The league's season is not established in the export." };
    return { basis: { leagueId, throughSeason: season, gameDate }, key: String(season) };
  }
  if (gameDate === null) return { skip: "The export's game date is not established." };
  return { basis: { leagueId, throughSeason: season, gameDate }, key: gameDate };
}

/**
 * The refits an import calls for, computed and NOT recorded (the worker's half): every registered component, for each
 * top-level league, whose basis has not been fitted yet (or every one, `force`). One component's failure never skips another.
 */
export function computeCalibrationRefits(options: { force?: boolean; leagues?: number[]; components?: string[] } = {}): PendingCalibration[] {
  const out: PendingCalibration[] = [];
  const leagues = options.leagues ?? topLeagues();
  for (const leagueId of leagues) {
    for (const c of registry) {
      if (options.components && !options.components.includes(c.component)) continue;
      const base = { leagueId, subsystem: c.subsystem, component: c.component, method: c.method };
      const skip = (reason: string, basis: string | null) => out.push({ run: null, ms: null, force: false, outcome: { ...base, basis, refit: false, adopted: null, reason, ms: null } });
      const b = basisFor(leagueId, c);
      if ('skip' in b) { skip(b.skip, null); continue; }
      if (!options.force && calibrationAttempted(leagueId, c.subsystem, c.component, c.method, b.key)) {
        skip(`Already measured for ${b.key} (${c.method}).`, b.key);
        continue;
      }
      const start = performance.now();
      let result: CalibrationRun | { skip: string };
      try {
        result = c.compute(b.basis);
      } catch (err) {
        skip(`The refit failed (${err instanceof Error ? err.message : String(err)}); the fit in force stays.`, b.key);
        continue;
      }
      if ('skip' in result) { skip(result.skip, b.key); continue; }
      const ms = performance.now() - start;
      out.push({
        run: result, ms, force: options.force === true,
        outcome: { ...base, basis: basisKey(result.record), refit: true, adopted: result.record.gate.passed, reason: result.record.gate.reason, ms },
      });
    }
  }
  return out;
}

/** Record refits computed elsewhere (the main thread's half): each at its key, idempotent, never replacing an adopted fit with a failing one. */
export function recordCalibrationRefits(pending: PendingCalibration[]): CalibrationOutcome[] {
  const out: CalibrationOutcome[] = [];
  for (const p of pending) {
    if (!p.run) { out.push(p.outcome); continue; }
    try {
      const written = recordCalibration(p.run, { fitMs: p.ms, force: p.force });
      out.push(written === 0 && p.force && !p.outcome.adopted
        ? { ...p.outcome, reason: `${p.outcome.reason} Not recorded: the fit in force stays (a failing refit never replaces an adopted one).` }
        : p.outcome);
    } catch (err) {
      out.push({ ...p.outcome, adopted: null, reason: `Not recorded (${err instanceof Error ? err.message : String(err)}); the fit in force stays.` });
    }
  }
  for (const l of listeners) l();
  return out;
}

const listeners: Array<() => void> = [];

/** Called after refits are recorded, so a subsystem can drop its cached fit in force. */
export function onCalibrationRecorded(listener: () => void): void {
  listeners.push(listener);
}
