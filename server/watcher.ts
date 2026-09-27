import chokidar, { type FSWatcher } from 'chokidar';
import { publish } from './serverEvents.js';
import { assessExport, exportTiming, type ExportAssessment } from './exportFiles.js';

/**
 * Watches the CSV export folder and notices when OOTP has FINISHED writing a new export (N3.5, D-061).
 *
 * OOTP writes an export as some seventy files over about forty seconds, so a change is not an export. On every change
 * the watcher waits until the folder has been quiet for the quiet period (`exportFiles.ts`), then judges it: a settled
 * export whose fingerprint differs from the one imported is a new export. What happens then is the handler's
 * (`api.ts`): import it in the background (the default), or note it as waiting (`exportPending`, `export-pending`) when
 * automatic import is off. The same judgement runs once at start-up, so an export written while Pennant was closed is
 * noticed too.
 *
 * The watcher never imports by itself and never reads a file's contents: names, sizes and times only.
 */

/** What the handler is told: the settled export, judged at the moment it settled. */
export type SettledExportHandler = (csvDir: string, assessment: ExportAssessment) => void;

let watcher: FSWatcher | null = null;
let watchedDir: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** When a fresh export was last seen on disk, if it has not been imported yet. */
let pendingSince: string | null = null;
let handler: SettledExportHandler | null = null;

/** The clock and the quiet period, which a test replaces. */
export const watchClock = {
  now: (): number => Date.now(),
  quietMs: (): number => exportTiming.quietMs,
  setTimeout: (fn: () => void, ms: number): ReturnType<typeof setTimeout> => setTimeout(fn, ms),
  clearTimeout: (t: ReturnType<typeof setTimeout>): void => clearTimeout(t),
};

export function pendingExport(): string | null {
  return pendingSince;
}

/** Marks a new export as waiting to be imported (automatic import is off, or an import is running). */
export function notePendingExport(): void {
  if (pendingSince) return;
  pendingSince = new Date(watchClock.now()).toISOString();
  publish({ type: 'export-pending', since: pendingSince });
  console.log('[watch] a new CSV export is ready — offering a refresh');
}

/** Called once an import has consumed whatever was on disk. */
export function clearPendingExport(): void {
  pendingSince = null;
}

/** Who decides what a settled export means (the import pipeline registers itself). */
export function onSettledExport(next: SettledExportHandler | null): void {
  handler = next;
}

/** Judges the folder now, and either hands a settled export to the handler or looks again when it will have settled. */
export function checkExport(csvDir: string = watchedDir ?? ''): void {
  if (!csvDir) return;
  if (timer) watchClock.clearTimeout(timer);
  timer = null;
  const assessment = assessExport(csvDir, watchClock.now());
  if (assessment.files.length === 0) return;
  const quietFor = assessment.quietForMs ?? 0;
  if (quietFor < watchClock.quietMs()) {
    // Still being written (or just finished): look again once it has been quiet for the whole period
    timer = watchClock.setTimeout(() => checkExport(csvDir), watchClock.quietMs() - quietFor + 50);
    return;
  }
  handler?.(csvDir, assessment);
}

export function stopWatcher(): void {
  if (timer) watchClock.clearTimeout(timer);
  timer = null;
  void watcher?.close();
  watcher = null;
  watchedDir = null;
  pendingSince = null;
  console.log('[watch] stopped — new exports will not be detected');
}

export function startWatcher(csvDir: string): void {
  void watcher?.close();
  if (timer) watchClock.clearTimeout(timer);
  timer = null;
  watchedDir = csvDir;
  watcher = chokidar
    .watch(csvDir, { ignoreInitial: true, depth: 0 })
    /*
     * A watcher with no error handler takes the whole server down with it.
     * Observed while OOTP was writing an export: the operating system
     * interrupted the watch on one of seventy files, chokidar emitted 'error',
     * nothing was listening, and the app died mid-session — over a directory
     * whose only purpose is to notice a file has changed. Noticing late is a
     * far smaller problem than that.
     */
    .on('error', (err) => {
      console.error('[watch] stopped watching after an error:', err);
    })
    // Every change starts the quiet period again; the look at its end re-reads every file's time
    .on('all', () => {
      if (timer) watchClock.clearTimeout(timer);
      timer = watchClock.setTimeout(() => checkExport(csvDir), watchClock.quietMs() + 50);
    });
  console.log(`[watch] Watching ${csvDir}`);
}
