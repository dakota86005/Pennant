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

import { Worker } from 'node:worker_threads';
import { completedThrough, leagueGameDate, topLeagues } from './saveIdentity.js';
import {
  attemptInputs, calibrationAttempted, calibrationSourceAt, recordCalibration, recordSourceAttempt, basisKey, sourceAttempted, withRatingSource,
  type CalibrationRecord, type SourceAttempt,
} from './saveCalibrationStore.js';
import { sameRatingSource } from './ratingMode.js';
import { inPopulationView, populationSource } from './scoutedEvidence.js';

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
  /** Whether the fit reads ratings (D-068): then it is computed in the league's population view and records that source. */
  readsRatings?: boolean;
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
  /** A refit after a change of ratings source: recorded as tried when it isn't recorded as a fit, so it isn't rerun (D-068). */
  sourceAttempt?: SourceAttempt;
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
      let attempt: SourceAttempt | undefined;
      const skip = (reason: string, basis: string | null) => out.push({ run: null, ms: null, force: false, outcome: { ...base, basis, refit: false, adopted: null, reason, ms: null }, sourceAttempt: attempt });
      const b = basisFor(leagueId, c);
      if ('skip' in b) { skip(b.skip, null); continue; }
      // The ratings a fit that reads them rests on now (D-068): a fit on another source at this key is refitted, never kept as if continuous
      const source = c.readsRatings ? populationSource() : null;
      const recorded = source ? calibrationSourceAt(leagueId, c.subsystem, c.component, c.method, b.key) : undefined;
      // OSA in the main tables and OSA's rows in the file are one source (the owner's decision): that switch keeps its fit
      const sourceChanged = source !== null && recorded !== undefined && !sameRatingSource(recorded, source.id);
      if (!options.force && !sourceChanged && calibrationAttempted(leagueId, c.subsystem, c.component, c.method, b.key)) {
        skip(`Already measured for ${b.key} (${c.method}).`, b.key);
        continue;
      }
      if (sourceChanged) {
        const tried: SourceAttempt = { leagueId, subsystem: c.subsystem, component: c.component, method: c.method, basis: b.key, source: source!.id, inputs: attemptInputs(b.basis.gameDate) };
        // Already tried on this source for this export and not adopted: not run again until the export or the source changes
        if (!options.force && sourceAttempted(tried)) {
          skip(`Already tried on ${source!.id} for this export (${b.key}, ${c.method}); the provisional values serve until a refit on it passes.`, b.key);
          continue;
        }
        attempt = tried;
      }
      const start = performance.now();
      let result: CalibrationRun | { skip: string };
      try {
        result = source
          ? withRatingSource({ subsystem: c.subsystem, component: c.component, source: source.id }, () => inPopulationView(() => c.compute(b.basis)))
          : c.compute(b.basis);
        if (source && !('skip' in result)) {
          result.record.ratingSource = source.id;
          result.record.notes = [
            ...result.record.notes,
            `Ratings: ${source.text}`,
            ...(sourceChanged
              ? [`The ratings' source changed (from ${recorded ?? 'an unrecorded source'} to ${source.id}): refitted on the new source, not compared with the earlier fit.`]
              : []),
          ];
        }
      } catch (err) {
        skip(`The refit failed (${err instanceof Error ? err.message : String(err)}); the fit in force stays.`, b.key);
        continue;
      }
      if ('skip' in result) { skip(result.skip, b.key); continue; }
      const ms = performance.now() - start;
      out.push({
        run: result, ms, force: options.force === true || sourceChanged,
        outcome: { ...base, basis: basisKey(result.record), refit: true, adopted: result.record.gate.passed, reason: result.record.gate.reason, ms },
        sourceAttempt: attempt,
      });
    }
  }
  return out;
}

const safely = (write: () => void): void => {
  try {
    write();
  } catch (err) {
    console.warn(`[calibration] a refit's attempt could not be recorded: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Record refits computed elsewhere (the main thread's half): each at its key, idempotent, never replacing an adopted fit with a failing one. */
export function recordCalibrationRefits(pending: PendingCalibration[]): CalibrationOutcome[] {
  const out: CalibrationOutcome[] = [];
  let changed = false;
  for (const p of pending) {
    if (!p.run) {
      // A refit after a change of source that couldn't be computed: tried, so it isn't rerun until the inputs change
      if (p.sourceAttempt) safely(() => recordSourceAttempt(p.sourceAttempt!, p.outcome.reason));
      out.push(p.outcome);
      continue;
    }
    try {
      const written = recordCalibration(p.run, { fitMs: p.ms, force: p.force });
      if (written > 0) changed = true;
      // Failed where an adopted fit of another source holds the key: tried, and the provisional values serve (D-068)
      if (written === 0 && p.sourceAttempt) safely(() => recordSourceAttempt(p.sourceAttempt!, p.outcome.reason));
      out.push(written === 0 && p.force && !p.outcome.adopted
        ? { ...p.outcome, reason: `${p.outcome.reason} Not recorded: the fit in force stays (a failing refit never replaces an adopted one).` }
        : p.outcome);
    } catch (err) {
      out.push({ ...p.outcome, adopted: null, reason: `Not recorded (${err instanceof Error ? err.message : String(err)}); the fit in force stays.` });
    }
  }
  // Only a record that was written can change a fit in force: nothing recorded, nothing for a listener to drop
  if (changed) for (const l of listeners) l();
  return out;
}

const listeners: Array<() => void> = [];

/** Called after refits are recorded and at least one was written, so a subsystem can drop its cached fit in force. */
export function onCalibrationRecorded(listener: () => void): void {
  listeners.push(listener);
}

// ── off the server's event loop ──────────────────────────────────────────────


/** The worker thread's entry file: the bundled desktop build ships it beside the bundle; the source runs it through tsx. */
function calibrationWorkerUrl(): URL {
  const here = new URL(import.meta.url);
  return here.pathname.endsWith('.cjs') ? new URL('./calibration-refit-worker.cjs', here) : new URL('./calibrationRefitWorker.ts', here);
}

/** Compute every registered refit in a worker thread (better-sqlite3 opens its own connections there); rejects if the worker fails. */
export function calibrationRefitInWorker(): Promise<PendingCalibration[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(calibrationWorkerUrl());
    } catch (err) {
      reject(err);
      return;
    }
    worker.once('message', (m: { ok: boolean; pending?: PendingCalibration[]; error?: string }) => {
      if (m.ok && m.pending) resolve(m.pending);
      else reject(new Error(m.error ?? 'the calibration refit worker failed'));
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`the calibration refit worker exited with ${code}`)); });
  });
}

/**
 * The refit, off the server's event loop: `compute` computes elsewhere (a worker thread) and the results are recorded here only if no
 * import started while they were read (`stale`). Never throws into its caller's turn; resolves with the outcomes.
 */
export async function calibrationRefitOffThread(options: { compute: () => Promise<PendingCalibration[]>; stale: () => boolean }): Promise<CalibrationOutcome[]> {
  await Promise.resolve();
  const pending = await options.compute();
  if (options.stale()) return [];
  return recordCalibrationRefits(pending);
}
