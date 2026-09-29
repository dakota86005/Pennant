import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, tableExists, tableColumns, locateColumn, LAST_IMPORT_PATH, LEAGUE_DB_PATH, NEXT_DB_PATH, leagueUpgradeUnderWay, noteLeagueUpgrade, swapWhenFree } from './db.js';
import { detectSaves, findSaves, resolveChosenFolder, searchLocations, type ResolveResult, type SaveInfo, type SearchLocation } from './paths.js';
import { DATA_DIR, loadConfig, saveConfig } from './config.js';
import { diskSpace, importCsvDir, upgradeState, ImportRefused, type ImportProgress, type ImportResult } from './importer.js';
import { upgradeLeagueDatabase } from './importBuild.js';
import { checkExport, clearPendingExport, notePendingExport, onSettledExport, pendingExport, startWatcher } from './watcher.js';
import { assessExport, importedExport, type ExportAssessment } from './exportFiles.js';
import { locateSave } from './ootpSave.js';
import { readRatingMode } from './ratingMode.js';
import { registerPostImportHook, runPostImportHooks } from './postImport.js';
import { snapshotsAfterImport } from './importSnapshots.js';
import { currentHistoryKey } from './historyIdentity.js';
import { currentPlayedElsewhere, forgetSaveScan, lookAtTheServedSave, onLookAtTheServedSave, servedSaveFolder, servedSaveId, humanClubsInExport, clubNameInExport, pickSave, saveLabel, type SavePlayedElsewhere } from './saveDiscovery.js';
import { saveDiscoveryView, type SaveDiscovery } from './presentation/saveWords.js';
import { assertAuthored } from './presentation/claim.js';
import type { Claim } from './contract/presentation.js';
import { clubForgottenWhenImported, featureProvider, forgetClubWhenImported, importLandedForClub, providerCredential, loadSettings } from './settings.js';
import { orgRoutes } from './org.js';
import { contractRoutes } from './contracts.js';
import { freeAgentRoutes } from './freeagents.js';
import { lineupRoutes } from './lineup.js';
import { storylineRoutes, startStorylineJob } from './storylines.js';
import { playerRoutes } from './player.js';
import { historyRoutes } from './history.js';
import { csvExportedAt, resetTransactionLogCache, warmTransactionLog } from './dataStatus.js';
import { importedAt, playerStateRoutes } from './playerStateRoutes.js';
import { assignmentContextsFor } from './playerContext.js';
import { clearStatCaches, computeBatting, computePitching, leagueBaseline } from './stats.js';
import { clearResultsCaches } from './resultsEvidence.js';
import { clearFarmResultsCaches } from './farmResults.js';
import { clearFarmUsageCaches } from './farmUsage.js';
import { clearFieldingPopulationCache, loadScoutedAbilities } from './scoutedEvidence.js';
import { ratingScaleMax, clearScaleCache } from './valuation.js';
import { clearTwoWayCache } from './twoway.js';
import { dashboardRoutes } from './dashboard.js';
import { rosterOpsRoutes } from './rosterops.js';
import { tradeRoutes } from './trade.js';
import { contactProfiles } from './battedball.js';
import { standingOf, type StandingFields } from './health.js';
import { gameplanRoutes } from './gameplan.js';
import { aiRoutes, startBriefingJob } from './ai.js';
import { logoRoutes, logoToken } from './logos.js';
import { themePackFileRoutes } from './themePackStore.js';
import { settingsRoutes } from './settings.js';
import { modelRoutes } from './models.js';
import { exportRoutes } from './exporter.js';
import { franchiseRoutes } from './franchise.js';
import { leagueRoutes } from './league.js';
import { pitchingRoutes } from './pitching.js';
import { scheduleRoutes } from './schedule.js';
import { payrollRoutes } from './payroll.js';
import { clubFinanceRoutes } from './clubFinanceRoutes.js';
import { playerValueRoutes } from './playerValueRoutes.js';
import { ourViewRoutes } from './ourViewRoutes.js';
import { clearProductionCaches, computeRefits, refitInWorker, refitOffThread, type PendingRefits } from './playerValue.js';
import { calibrationRefitInWorker, calibrationRefitOffThread, type CalibrationOutcome, type PendingCalibration } from './saveCalibration.js';
import { clearSaveIdentityCache } from './saveIdentity.js';
import { clearRosterReviewCalibrationCache } from './mlbCalibration.js';
import { captureMarketSnapshot } from './playerValueSnapshot.js';
import { trendsRoutes } from './trends.js';
import { chatRoutes } from './chat.js';
import { mlbOperationsRoutes } from './mlbOperations.js';
import { farmRoutes } from './farmRoutes.js';
import { appInfo, type AppInfo } from './appInfo.js';
import { scoutedDevelopmentRoutes } from './scoutedDevelopment.js';
import { eventStream, progressThrottle, publish } from './serverEvents.js';
import { v2Routes } from './v2Routes.js';
import { currentReportStamp, holdFrontOfficeRebuilds, relocateLiveLog, valueRefitsRecorded, warmFrontOffice } from './frontOfficeService.js';
import { EXPORT_NOT_FOUND, LEAGUE_UPGRADE_LINE, importNote, importWords, leftOutNote, type ImportNote, type LeagueUpgradeLine } from './presentation/importWords.js';
import type { Integer } from './contract/primitives.js';

export const api = Router();
api.use(logoRoutes);
api.use(themePackFileRoutes);
api.use(settingsRoutes);
api.use(modelRoutes);
api.use(exportRoutes);
api.use(franchiseRoutes);
api.use(leagueRoutes);
api.use(pitchingRoutes);
api.use(scheduleRoutes);
api.use(payrollRoutes);
api.use(clubFinanceRoutes);
api.use(ourViewRoutes);
api.use(playerValueRoutes);
api.use(trendsRoutes);
api.use(chatRoutes);
api.use(playerRoutes);
api.use(playerStateRoutes);
api.use(historyRoutes);
api.use(dashboardRoutes);
api.use(rosterOpsRoutes);
api.use(mlbOperationsRoutes);
api.use(farmRoutes);
api.use(scoutedDevelopmentRoutes);
api.use(tradeRoutes);
api.use(gameplanRoutes);
api.use(aiRoutes);
api.use(orgRoutes);
api.use(contractRoutes);
api.use(freeAgentRoutes);
api.use(lineupRoutes);
api.use(storylineRoutes);

const META_PATH = LAST_IMPORT_PATH;

function loadImportMeta(): ImportResult | null {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export const importState: {
  importing: boolean;
  lastImport: ImportResult | null;
  lastError: string | null;
  /** Where the running import has got to, so the page can show a bar. */
  progress: ImportProgress | null;
  /** When an import that never finished had started (the server stopped partway), until a later import completes. */
  interruptedSince: string | null;
  /**
   * The export an import last failed on (its folder and the fingerprint of its files then), until an import succeeds
   * (N3.5 Stage B2 review): the watcher and the minute's look do not try it again until the folder changes, so a
   * broken export is not re-imported every minute. The GM's own Import Now still tries.
   */
  lastFailed: { csvDir: string; fingerprint: string } | null;
} = { importing: false, lastImport: loadImportMeta(), lastError: null, progress: null, interruptedSince: null, lastFailed: null };
importedAt.value = importState.lastImport?.finishedAt ?? null;

/**
 * Written as an import starts and removed only when it completes (N1's kill-mid-import check).
 *
 * The importer replaces one table per file: it drops the table and creates the new one outside the file's
 * transaction, then writes the rows inside it. SQLite keeps the database file sound whatever stops the process
 * (the write-ahead log rolls back the open transaction), but a server killed partway leaves the files before it
 * replaced, the one it was on empty, and the files after it still the previous export's: a database that is
 * neither export, with `last-import.json` still describing the old one. Nothing else records that, so this file
 * does, and the next start imports the export again (`recoverInterruptedImport`). An import that fails partway
 * leaves the same mix, so it keeps the marker too; its error is on `/api/status` meanwhile.
 */
const IMPORT_MARKER_PATH = path.join(DATA_DIR, 'import-in-progress.json');

function readImportMarker(): { startedAt: string; csvDir: string | null } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(IMPORT_MARKER_PATH, 'utf8')) as { startedAt?: unknown; csvDir?: unknown };
    return { startedAt: String(parsed.startedAt ?? 'unknown'), csvDir: typeof parsed.csvDir === 'string' ? parsed.csvDir : null };
  } catch (err) {
    // No marker is the normal case; an unreadable one still means an import never finished
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : { startedAt: 'unknown', csvDir: null };
  }
}

/**
 * At start-up: if the last import never finished, say so on `/api/status` and import the export again. Since N3.5 an
 * unfinished import never touches the database the app reads (it builds a new file and swaps it in), so the previous
 * import is whole and this is a retry, not a repair. Returns whether a re-import was started. Without the export
 * folder the interruption is reported and nothing is guessed.
 */
export function recoverInterruptedImport(): boolean {
  const marker = readImportMarker();
  if (!marker) return false;
  importState.interruptedSince = marker.startedAt;
  const { csvDir } = loadConfig();
  if (!csvDir || !fs.existsSync(csvDir)) {
    console.warn(`[import] the import started ${marker.startedAt} never finished, and the export folder is not available to repeat it`);
    return false;
  }
  console.warn(`[import] the import started ${marker.startedAt} never finished; importing the export again`);
  void runImport(csvDir, 'recovery');
  return true;
}

/**
 * Kicks off the storylines and the briefing after an import, when the club has
 * asked for that.
 *
 * Each feature may use a different provider. Start whichever generations have
 * a usable credential (or a keyless local provider) rather than making one
 * global provider gate both of them. Jobs start in the background, so an import
 * is never held up by an AI call. A club that has not been chosen yet is
 * skipped: there would be no way to know whose season to write about.
 */
function autoGenerate(): void {
  try {
    const settings = loadSettings();
    if (!settings.autoGenerateAfterImport) return;

    const orgId = settings.defaultOrgId ?? humanOrgId();
    if (!orgId) return;

    const storylineProvider = featureProvider('storylines');
    const briefingProvider = featureProvider('briefing');
    const canGenerateStorylines = providerCredential(storylineProvider) !== null;
    const canGenerateBriefing = providerCredential(briefingProvider) !== null;

    if (!canGenerateStorylines && !canGenerateBriefing) return;

    if (canGenerateStorylines) {
      console.log('[import] starting storylines for org', orgId);
      startStorylineJob(orgId);
    }

    if (canGenerateBriefing) {
      console.log('[import] starting briefing for org', orgId);
      startBriefingJob(orgId);
    }
  } catch (err) {
    // A failure here must never take the import down with it
    console.error('[import] could not start the generations:', err);
  }
}

/** The club the save says is being managed, when no default has been chosen. */
function humanOrgId(): number | null {
  try {
    const row = db.prepare(`SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1`).get() as
      | { team_id: number }
      | undefined;
    return row?.team_id ?? null;
  } catch {
    return null;
  }
}

/**
 * After an import: refit the production model (and, phase 3b, the ratings model) where the export now holds a completed season newer
 * than the last fit (D-053, PLAYER_VALUE.md Part 7), and every subsystem's per-save calibration, AT THE SAME TIME, each in its own
 * worker thread (N3.5: about 28 s one after the other, about 18 s together; neither reads the other's fits). In the background, once
 * the import has finished, so they can never block or fail it: every error is caught and logged. No timer: they run once per import,
 * and a re-import without a newer completed season fits nothing. Each result is recorded only if no import started while it read
 * (the gates and records are unchanged, D-053).
 *
 * Also called once at startup for a save that is already imported, so a save that has never been
 * fitted (a new install, or a method version that ignores the stored fit) gets its own fit without
 * waiting for the next import. It fits nothing when the latest completed season is already fitted.
 */
export function refitAfterImport(): Promise<void> {
  // In a worker thread (A-17): the fit reads for seconds, and the server keeps answering meanwhile. Its
  // result is recorded only if no import started while it read, so a fit never spans two exports.
  const generation = importGeneration;
  const started = performance.now();
  // Player Value's refit and the calibrations may each ask the Front Office to build again: one build, after both (N6)
  const release = holdFrontOfficeRebuilds();
  const compute = (): Promise<PendingRefits> => refitInWorker().catch((err) => {
    // No worker (an unusual packaging): the same work in-process, after this turn, logged as such
    console.error('[value] refit worker unavailable, refitting in-process:', err);
    return new Promise<PendingRefits>((resolve, reject) => setImmediate(() => {
      try { resolve(computeRefits()); } catch (e) { reject(e); }
    }));
  });
  const value = refitOffThread({ compute, stale: () => importState.importing || generation !== importGeneration })
    .then((outcomes) => {
      for (const r of outcomes) {
        if (r.refit) console.log(`[value] refit, league ${r.leagueId} through ${r.throughSeason}: ${r.adopted ? 'adopted' : 'not adopted'} (${Math.round(r.ms ?? 0)} ms in the worker, ${Math.round(performance.now() - started)} ms end to end). ${r.reason}`);
      }
      // An adopted fit moves the roster map's expected wins: the Morning Report is built again (N6)
      valueRefitsRecorded(outcomes);
    })
    .catch((err) => console.error('[value] production refit failed:', err));
  // Every subsystem's per-save calibration (D-053), in its own worker, at the same time
  const calibration = refitCalibrationsAfterImport(generation);
  return Promise.all([value, calibration]).then(() => {
    console.log(`[refit] the refits settled ${Math.round(performance.now() - started)} ms after they started`);
  }).finally(release);
}
/**
 * After an import: the per-save calibrations every subsystem registered (`saveCalibration.ts`), computed in a worker thread and
 * recorded only if no import started meanwhile. Never blocks or fails the import: every error is caught and logged.
 */
export function refitCalibrationsAfterImport(generation: number, worker: () => Promise<PendingCalibration[]> = calibrationRefitInWorker): Promise<CalibrationOutcome[]> {
  // The import this was for is already superseded: its reads would be of neither export, and nothing would be recorded
  if (importState.importing || generation !== importGeneration) return Promise.resolve([]);
  const started = performance.now();
  // No worker: the refit is skipped, never run on the server's event loop (it reviews every club); the fits in force stay
  const compute = (): Promise<PendingCalibration[]> => worker().catch((err) => {
    console.error('[calibration] refit worker unavailable; the refit is skipped and the fits in force stay:', err);
    return [];
  });
  return calibrationRefitOffThread({ compute, stale: () => importState.importing || generation !== importGeneration })
    .then((outcomes) => {
      for (const r of outcomes) {
        if (r.refit) console.log(`[calibration] ${r.subsystem}/${r.component}, league ${r.leagueId} (${r.basis}): ${r.adopted ? 'adopted' : 'not adopted'} (${Math.round(r.ms ?? 0)} ms, ${Math.round(performance.now() - started)} ms end to end). ${r.reason}`);
      }
      return outcomes;
    })
    .catch((err) => {
      console.error('[calibration] refit failed:', err);
      return [];
    });
}

/** The current import generation (a refit is recorded only for the export it read). */
export const currentImportGeneration = (): number => importGeneration;

/**
 * The league's market and contracts for the export now imported: price of a win, replacement level, regime and each
 * contract (PLAYER_VALUE.md Part 7, 4.2). Idempotent per save, league and game date, so the import and the server's
 * start both call it: a save imported before this build records its current export at the next start instead of
 * waiting for another import (supervisor, phase 4b). It never throws: like the other snapshots it cannot fail an import.
 */
export function recordImportMarket(importFinishedAt: string | null = null): void {
  try {
    const market = captureMarketSnapshot({ importFinishedAt });
    if (market.error) console.error('[history] market snapshot failed:', market.error);
    if (market.contracts.error) console.error('[history] contract snapshot failed:', market.contracts.error);
  } catch (err) {
    console.error('[history] market snapshot failed:', err);
  }
}

/** Counts imports, so a refit read across one is never recorded. */
let importGeneration = 0;

/** What started an import: the GM (Import Now, choosing a save), the watcher (a new export), or the start-up's retry. */
export type ImportTrigger = 'manual' | 'automatic' | 'recovery';

/** A new export settled while an import was running: look again once it finishes. */
let lookAgainAfterImport = false;

/** Written once the post-import snapshots are taken, so a start-up can finish an import whose snapshots never ran. */
const POST_IMPORT_PATH = path.join(DATA_DIR, 'post-import.json');

/** The caches that depend on the league database, cleared at the swap so no request reads a cache of the previous import. */
function clearLeagueCaches(): void {
  clearStatCaches(); // league baselines are per-import
  clearResultsCaches(); // and so are the league populations behind results percentiles
  clearFarmResultsCaches(); // the farm's league populations, lines and club games
  clearFarmUsageCaches(); // and who has been playing where
  clearFieldingPopulationCache();
  clearProductionCaches(); // what Player Value measured about the last export (schedules, rates, identity)
  clearSaveIdentityCache(); // the save's identity is re-read from the new export
  clearRosterReviewCalibrationCache(); // the roster review's yardsticks in force are re-read
  clearScaleCache();
  clearTwoWayCache();
  // Not the live transaction log: it is OOTP's, not the import's, and is read again only when OOTP writes it (so the
  // first page after an import never waits on a copy of it)
}

/**
 * Imports the export at `csvDir` (N3.5, D-061): the build runs in a worker on a new file, and the app reads the previous
 * import, whole, until one rename swaps the new one in. `import-started`, `import-progress` and `import-finished` are
 * published as before; after the swap the post-import hooks run (`postImport.ts`). A second call while one runs starts
 * nothing (a new export that settled meanwhile is looked at again when this one finishes).
 */
export async function runImport(csvDir: string, trigger: ImportTrigger = 'manual'): Promise<void> {
  if (importState.importing) {
    if (trigger === 'automatic') lookAgainAfterImport = true;
    return;
  }
  let imported: ImportResult | null = null;
  importState.importing = true;
  importGeneration += 1;
  importState.lastError = null;
  importState.progress = null;
  const startedAt = new Date().toISOString();
  try {
    fs.writeFileSync(IMPORT_MARKER_PATH, JSON.stringify({ startedAt, csvDir }));
  } catch (err) {
    // Only the recovery after a crash depends on it; the import itself goes ahead
    console.error('[import] could not write the in-progress marker:', err);
  }
  publish({ type: 'import-started', startedAt });
  const announceProgress = progressThrottle<ImportProgress>((progress) => publish({ type: 'import-progress', progress }));
  try {
    // The start-up upgrade of an earlier build's database uses the same next file: it finishes first
    if (upgrading) await upgrading;
    const config = loadConfig();
    // Which kind of ratings this export carries, from the save's export settings, read now (D-061)
    const save = locateSave({ csvDir, saveName: config.saveName, manualLgPath: config.csvDir === csvDir ? config.lgPath ?? null : null });
    const lgPath = save.found ? save.lgPath : null;
    imported = await importCsvDir(csvDir, {
      onProgress: (step) => {
        const progress: ImportProgress = { ...step, words: importWords(step) };
        importState.progress = progress;
        announceProgress(progress);
      },
      ratingModeFor: (exportWrittenAtMs) => readRatingMode(lgPath, exportWrittenAtMs),
      leftOutNote,
      // The swap: from this line every request reads the new import, and no cache of the old one survives it
      afterSwap: (result) => {
        importState.lastImport = result;
        importedAt.value = result.finishedAt;
        clearLeagueCaches();
        // A club chosen in another save's league is forgotten as this save's league is served, not before (H1)
        importLandedForClub(csvDir);
        // The save this import came from, before `import-finished` announces it (the status serves it with the import)
        lookAtTheServedSave();
      },
    });
    // Whatever was waiting on disk has now been read
    clearPendingExport();
    importState.interruptedSince = null;
    importState.lastFailed = null;
    fs.rmSync(IMPORT_MARKER_PATH, { force: true });
  } catch (err) {
    importState.lastError = (err as Error).message;
    console.error('[import] failed:', (err as Error).message);
    // Remembered, so an automatic look does not try the same files again (a changed folder is a new attempt)
    const failedOn = assessExport(csvDir).fingerprint;
    importState.lastFailed = failedOn ? { csvDir, fingerprint: failedOn } : null;
    // A refusal touched nothing (OOTP still writing, no room, an old players file, no files): nothing was interrupted,
    // so the next start does not call it so (review nit 9). Any other failure keeps the marker and is retried at start.
    if (err instanceof ImportRefused) fs.rmSync(IMPORT_MARKER_PATH, { force: true });
  } finally {
    importState.importing = false;
    importState.progress = null;
    publish({ type: 'import-finished', lastImport: importState.lastImport, error: importState.lastError, note: currentImportNote() });
  }
  if (imported) void runPostImportHooks({ generation: importGeneration, importStartedAt: imported.startedAt, fresh: true });
  if (lookAgainAfterImport) {
    lookAgainAfterImport = false;
    checkExport(csvDir);
  }
}

/** The one-time upgrade of an earlier build's league database, while it runs (an import waits for it). */
let upgrading: Promise<void> | null = null;

/**
 * At start-up, for a league database an earlier build imported (write-ahead-log mode, or without the indexes an import
 * now builds): a converted copy is built in the import's worker and swapped in, the way an import is (N3.5 review,
 * finding 1). The served file is never written in place, so a process stopped at any point leaves it as it was, and the
 * leftover copy is removed at the next start. The pages keep reading the old file meanwhile. Never throws.
 */
export function upgradeLeagueInBackground(): Promise<void> {
  if (upgrading) return upgrading;
  upgrading = (async () => {
    // Never finish in this turn: the `finally` below must run after `upgrading` is assigned, or it would stay set
    await Promise.resolve();
    try {
      // Room for the converted copy beside the served file first: without it nothing is written, the file is served as
      // it is, and the next start checks again (a check, never a failed write at every launch)
      const room = upgradeRoom();
      upgradeState.note = room;
      if (room) {
        console.warn(`[import] ${room}`);
        return;
      }
      const outcome = await upgradeLeagueDatabase(LEAGUE_DB_PATH, NEXT_DB_PATH);
      await swapWhenFree(NEXT_DB_PATH, clearLeagueCaches);
      console.log(`[import] brought the league database up to date in ${(outcome.ms / 1000).toFixed(1)}s (${outcome.indexes} indexes added)`);
    } catch (err) {
      fs.rmSync(NEXT_DB_PATH, { force: true });
      console.error('[import] could not bring the league database up to date; it is served as it is:', (err as Error).message);
    } finally {
      upgrading = null;
      noteLeagueUpgrade(null);
    }
  })();
  noteLeagueUpgrade(upgrading);
  return upgrading;
}

/** The converted copy is about the size of the served file; with room to spare. */
export const UPGRADE_DISK_FACTOR = 1.5;

/** Why the one-time upgrade cannot run now (not enough free space for its copy), in a sentence; null when it can. */
export function upgradeRoom(): string | null {
  let size = 0;
  try {
    size = fs.statSync(LEAGUE_DB_PATH).size;
  } catch {
    return null;
  }
  const needed = Math.round(size * UPGRADE_DISK_FACTOR);
  const free = diskSpace.free(DATA_DIR);
  if (free === null || free >= needed) return null;
  const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `Not enough free disk space to bring the league database up to date: about ${gb(needed)} is needed and ${gb(free)} is free. ` +
    'It is served as it is, and Pennant checks again at the next start.';
}

/** Whether a settled export is one the app has not imported: its fingerprint differs from the last import's. */
export function isNewExport(assessment: ExportAssessment, last: ImportResult | null = importState.lastImport): boolean {
  if (!assessment.fingerprint) return false;
  if (!last) return true;
  if (last.exportFingerprint) return last.exportFingerprint !== assessment.fingerprint;
  // An import from before N3.5 recorded no fingerprint: an export written after it started is newer
  const startedAt = Date.parse(last.startedAt);
  return assessment.newestMs !== null && Number.isFinite(startedAt) && assessment.newestMs > startedAt;
}

/*
 * A settled export (`watcher.ts`): a new one is imported in the background when the GM has left automatic import on
 * (the default, the owner's decision 1), else it is offered as before. Never while an import runs: that import looks
 * again when it finishes.
 */
export function handleSettledExport(csvDir: string, assessment: ExportAssessment): void {
  if (loadConfig().csvDir !== csvDir || !isNewExport(assessment)) return;
  // The export the last import failed on, unchanged: not tried again automatically (its error stays on the status)
  const failed = importState.lastFailed;
  if (failed && failed.csvDir === csvDir && failed.fingerprint === assessment.fingerprint) return;
  const settings = loadSettings();
  if (settings.autoImport && settings.importAutomatically) {
    if (importState.importing) lookAgainAfterImport = true;
    else void runImport(csvDir, 'automatic');
  } else {
    notePendingExport();
  }
}
onSettledExport(handleSettledExport);

// The watcher's judgement knows the last import of the folder it looks at: a file no newer was not rewritten since
importedExport.writtenAtMs = (csvDir) => {
  const last = importState.lastImport;
  if (!last?.exportWrittenAt || last.csvDir !== csvDir) return null;
  const at = Date.parse(last.exportWrittenAt);
  return Number.isFinite(at) ? at : null;
};

/*
 * The post-import hooks, in order. The snapshots first (in a worker; they write history.db), then the storylines and
 * briefing, then the refits (both at once, in their own workers; not awaited, so a later hook is not held up by them),
 * then N4's Front Office warm-up.
 */
registerPostImportHook('snapshots', async (context) => {
  const last = importState.lastImport;
  // The imported save's history key, resolved here first (D-064): on this thread the history filed under its name
  // before it had a key is reviewed then, so the worker's snapshot lands on a history already brought over
  try {
    currentHistoryKey();
  } catch (err) {
    console.error('[history] could not resolve the save\'s history:', err);
  }
  const outcome = await snapshotsAfterImport({
    importFinishedAt: last?.finishedAt ?? null,
    importStartedAt: context.importStartedAt,
    ratingMode: last?.ratingMode ?? null,
  });
  for (const error of outcome.errors) console.error('[history]', error);
  // Recorded only for the import in force: an earlier import's hooks finishing late must not name it as done
  if (importState.lastImport?.startedAt !== context.importStartedAt) return;
  try {
    fs.writeFileSync(POST_IMPORT_PATH, JSON.stringify({ importStartedAt: context.importStartedAt, snapshotsAt: new Date().toISOString() }));
  } catch (err) {
    console.error('[import] could not record the snapshots:', err);
  }
});
registerPostImportHook('generations', () => autoGenerate());
registerPostImportHook('refits', (context) => {
  if (context.generation !== importGeneration) return;
  void refitAfterImport();
});
// The GM's first look after an import is a cached read (N4's Front Office, built in its own worker)
registerPostImportHook('frontOffice', () => void warmFrontOffice());
// The Front Office's stamp reads the save's live log: its files are found with every look at the served save, never on
// a request's path (`/api/status` serves the stamp)
onLookAtTheServedSave(relocateLiveLog);

/**
 * At start-up: an import whose snapshots never ran (the server stopped between the swap and them) takes them now.
 * Idempotent: every snapshot is keyed by its save and game date. Returns whether they were started.
 */
export function finishInterruptedPostImport(): boolean {
  const last = importState.lastImport;
  if (!last || !tableExists('players')) return false;
  let done: { importStartedAt?: string } | null = null;
  try {
    done = JSON.parse(fs.readFileSync(POST_IMPORT_PATH, 'utf8'));
  } catch {
    done = null;
  }
  // An import from before N3.5 has no record; its snapshots were taken on the import's own thread
  if (!done && !last.exportFingerprint) return false;
  if (done?.importStartedAt === last.startedAt) return false;
  console.warn('[import] the last import\'s snapshots were not taken; taking them now');
  void runPostImportHooks({ generation: importGeneration, importStartedAt: last.startedAt, fresh: false });
  return true;
}

api.get('/saves', (_req, res: Response<SaveInfo[]>) => {
  res.json(detectSaves());
});

/** Where we looked, so the user can see why auto-detection came up empty. */
api.get('/search-locations', (_req, res: Response<SearchLocations>) => {
  res.json({ platform: process.platform, locations: searchLocations() });
});

/** Checks a folder the user picked or typed, before committing to it. */
api.post('/resolve-folder', (req, res: Response<ResolveResult>) => {
  const { path: chosen } = req.body as Partial<ResolveFolderRequest>;
  if (!chosen?.trim()) return res.status(400).json({ ok: false, error: 'No folder given.' });
  res.json(resolveChosenFolder(chosen));
});

/** What `/api/status` serves, and the snapshot `/api/v2/events` opens with (described in `contract/openapi.json`). */
export interface ServerStatus {
  /** Product name and version, from package.json (see appInfo.ts). */
  app: AppInfo;
  csvExportedAt: string | null;
  configured: boolean;
  saveName: string | null;
  csvDir: string | null;
  csvDirExists: boolean;
  importing: boolean;
  /** Where a running import has got to; null when nothing is importing. */
  importProgress: ImportProgress | null;
  lastImport: ImportResult | null;
  lastError: string | null;
  /** Set when an import stopped partway (the server was stopped or crashed); cleared by the next completed import. */
  importInterruptedSince: string | null;
  /** Why the import is not where it should be, in a sentence (a failure, an interruption, a missing export); null when it is. */
  importNote: ImportNote | null;
  hasData: boolean;
  /** Set when OOTP has written a fresh export the app has not imported yet. */
  exportPending: string | null;
  /** Changes with the save, and rides along on every logo URL. */
  logoToken: string;
  /** The top of the rating scale the save shows ratings on. */
  ratingScaleMax: Integer;
  /**
   * The stamp of the Front Office's current build for the club the app follows (`FrontOfficeSummary.reportStamp`), or
   * null before one is kept. It moves whenever the server builds the Front Office again; the Mac app reloads on it.
   */
  reportStamp: string | null;
  /**
   * Another save (or a newer OOTP version's) played since the chosen one, once OOTP has finished saving it, with the
   * sentence and the save to switch to; null when there is none (N3.5 Stage B2, D-063). Pennant never switches by itself.
   */
  savePlayedElsewhere: SavePlayedElsewhere | null;
  /**
   * The id of the save the imported data came from (D-063: its folder's real path, hashed, as the save list identifies
   * it), tied to the last import (`lastImport`); null with nothing imported, while a save chosen but not yet imported is
   * configured, or until it is worked out. The Mac app keys the Morning Report it keeps across launches on it, so
   * another save's is never drawn and a save being left never has its report kept under the new one's id.
   */
  saveId: string | null;
  /**
   * The save's own folder (`<save>.lg`), where Pennant reads the transaction log (N6 polish): the one named in Settings,
   * else the one found for the chosen save (filled in when a save is chosen, or found at the last look at the served
   * save); null when none is known. Settings shows it, so the field is never empty while the folder is known.
   */
  saveFolder: string | null;
  /**
   * While a league an earlier build imported is brought up to date, once (the one-time upgrade; the server answers
   * meanwhile and the report follows when it is done): the line to show where the report will be; null otherwise.
   */
  leagueUpgrade: LeagueUpgradeLine | null;
}

/** A request the server accepted, with nothing more to say. */
export interface Ok {
  ok: true;
}

/** What a route answers when it cannot do what was asked (a 400). */
export interface ApiError {
  /** What went wrong, as a sentence. */
  error: string;
  /** The raw message behind it, for the log and a help tag (a `/v2` route's failure); never the visible line. */
  detail?: string;
}

/** What `POST /api/import` answers: the import has started; its progress and result arrive on `/api/status` and the event stream. */
export interface ImportAccepted {
  ok: true;
  lastImport: ImportResult | null;
  lastError: string | null;
}

/** The folder the user picked or typed (`POST /api/resolve-folder`). */
export interface ResolveFolderRequest {
  path: string;
}

/**
 * What `POST /api/config` answers: the save is chosen, and whether its import began. A save whose export folder is not
 * there yet is chosen all the same, and `why` says what to do in a sentence.
 */
export interface ConfigAccepted {
  ok: true;
  importStarted: boolean;
  /** Why the import did not start; null when it did. */
  why: string | null;
  /**
   * The club, when the request asked for it to be taken from the save (`club: 'fromSave'`, N6 Stage B2): followed when
   * the save's export names exactly one club the human manages, else none and why the app asks. Null when not asked.
   */
  club: SetupClub | null;
}

/**
 * The save to use (`POST /api/config`): its CSV export folder and its name. `club: 'fromSave'` (the Mac app's choice
 * of a save, D-063) also takes the club from the save, as the first run does: followed when the save's export names
 * exactly one human club, asked for otherwise.
 */
export interface ConfigRequest {
  csvDir: string;
  saveName?: string | null;
  club?: 'fromSave' | null;
}

/** Where `GET /api/search-locations` looked for saves, so the user can see why auto-detection came up empty. */
export interface SearchLocations {
  platform: string;
  locations: SearchLocation[];
}

/** The import's note (`presentation/importWords.ts`) for the save configured now. */
function currentImportNote(csvDir: string | null = loadConfig().csvDir): ImportNote | null {
  return importNote({
    importing: importState.importing,
    lastError: importState.lastError,
    interruptedSince: importState.interruptedSince,
    configured: !!csvDir,
    csvDirExists: csvDir ? fs.existsSync(csvDir) : false,
  });
}

/** What `/api/status` serves, and the snapshot `/api/v2/events` opens with. */
export function statusSnapshot(): ServerStatus {
  const config = loadConfig();
  return {
    /** Product name and version, from package.json (see appInfo.ts). */
    app: appInfo(),
    csvExportedAt: config.csvDir ? csvExportedAt(config.csvDir) : null,
    configured: !!config.csvDir,
    saveName: config.saveName,
    csvDir: config.csvDir,
    csvDirExists: config.csvDir ? fs.existsSync(config.csvDir) : false,
    importing: importState.importing,
    /*
     * Where it has got to. Only meaningful because the import yields now — a
     * synchronous one could set this all it liked and the request asking for it
     * would still be queued behind the work.
     */
    importProgress: importState.progress,
    lastImport: importState.lastImport,
    lastError: importState.lastError,
    /** Set when an import stopped partway (the server was stopped or crashed); cleared by the next completed import. */
    importInterruptedSince: importState.interruptedSince,
    importNote: currentImportNote(config.csvDir),
    hasData: tableExists('players') && tableExists('teams'),
    /** Set when OOTP has written a fresh export the app has not imported yet. */
    exportPending: pendingExport(),
    /*
     * Changes with the save, and rides along on every logo URL. Without it the
     * browser's day-long cache served the previous save's art for team ids the
     * new one reuses.
     */
    logoToken: logoToken(),
    reportStamp: currentReportStamp(),
    // The last look at the saves (`saveDiscovery.ts`), never a scan on this request's path
    savePlayedElsewhere: currentPlayedElsewhere(),
    // Worked out off this request's path (at start, the minute's look, a new configuration, an import): only read here
    saveId: servedSaveId(),
    // The configuration's folder, else the one the last look found (never located on this path)
    saveFolder: config.lgPath ?? servedSaveFolder(),
    leagueUpgrade: leagueUpgradeUnderWay() ? LEAGUE_UPGRADE_LINE : null,
    /*
     * The scale OOTP is set to show ratings on, read off the save. Bars used
     * to divide by eighty regardless, so a 5 on the 1-to-5 scale drew at six
     * per cent of the width.
     */
    ratingScaleMax: tableExists('players') ? ratingScaleMax() : 80,
  };
}

api.get('/status', (_req, res: Response<ServerStatus>) => {
  res.json(statusSnapshot());
});

/** Server-sent events for the Mac app: import, job and fresh-export news as it happens (`serverEvents.ts`). */
api.get('/v2/events', eventStream(statusSnapshot));

/** The saves on this Mac, most recently played first, and the one you're playing when it clearly stands out (D-063). */
api.get('/v2/saves', (_req, res: Response<SaveDiscovery>) => {
  const { saves, unreadable } = findSaves();
  const view = saveDiscoveryView(saves, pickSave(saves, { unreadable }), searchLocations());
  assertAuthored(view);
  res.json(view);
});

/** The first run's zero-question setup (D-063): the save that clearly stands out is chosen and imported, or why not. */
api.post('/v2/setup/automatic', (_req, res: Response<AutomaticSetup>) => {
  const answer = automaticSetup();
  assertAuthored(answer);
  res.json(answer);
});

/** The rest of the Mac app's own API (`v2Routes.ts`), after the event stream so its unknown-route answer is last. */
api.use('/v2', v2Routes);

/**
 * What `POST /api/config` and `POST /api/import` answer (409) while an import is running. Choosing a save used to clear
 * the running flag and start a second import writing the same database at the same time; now nothing starts, and the
 * caller waits for the running import to finish.
 */
export const IMPORT_RUNNING = 'An import is already running. Wait for it to finish, then try again.';

/** The `<save>.lg` folder the export belongs to, as the save list finds it; null when it isn't found. */
function foundSaveFolder(csvDir: string, saveName: string | null): string | null {
  try {
    const location = locateSave({ csvDir, saveName });
    return location.found && location.lgPath ? location.lgPath : null;
  } catch {
    return null;
  }
}

/**
 * Chooses a save: its export folder and name become the configuration, and its import starts when the folder is there
 * (with the watcher). Returns whether the import started. The caller has checked that no import is running.
 */
function chooseSave(csvDir: string, saveName: string | null): boolean {
  // A hand-picked .lg folder belongs to the save it was picked for
  const previous = loadConfig();
  // Otherwise the save's own folder, as the save list finds it (D-063), so the transaction log's setting names it
  // (N6 polish: it was left empty after a switch); a folder named by hand for this save is kept
  const kept = previous.csvDir === csvDir ? previous.lgPath ?? null : null;
  saveConfig({ csvDir, saveName, lgPath: kept ?? foundSaveFolder(csvDir, saveName) });
  // The served league is not this save's until its import lands: the status stops naming the save being left at once
  lookAtTheServedSave();
  resetTransactionLogCache();
  warmTransactionLog();
  forgetSaveScan();
  if (!fs.existsSync(csvDir)) return false;
  importState.importing = true; // visible to /status before the import starts
  setImmediate(() => {
    importState.importing = false;
    void runImport(csvDir);
  });
  startWatcher(csvDir);
  return true;
}

api.post('/config', (req, res: Response<ConfigAccepted | ApiError>) => {
  const { csvDir, saveName, club: clubChoice } = req.body as Partial<ConfigRequest>;
  if (!csvDir) return res.status(400).json({ error: 'csvDir is required' });
  if (importState.importing) return res.status(409).json({ error: IMPORT_RUNNING });
  // The club is read from the export before the save is chosen, as the first run does (a folder that isn't there says so)
  const club = clubChoice === 'fromSave' ? clubFromSave(csvDir) : null;
  if (chooseSave(csvDir, saveName ?? null)) return res.json({ ok: true, importStarted: true, why: null, club });
  res.json({ ok: true, importStarted: false, why: EXPORT_NOT_FOUND, club });
});

/** The club a first run follows, taken from the save's export (N3.5 Stage B2, D-063). */
export interface SetupClub {
  /**
   * Whether the club is settled without asking: the save's human manages exactly one club, or the same save was chosen
   * again and the club the GM chose is kept. False: the GM is asked.
   */
  decided: boolean;
  /** The club followed or kept; null when none is. */
  teamId: Integer | null;
  name: string | null;
  /** How many clubs the save's human manages, as the export's teams file says; null when it doesn't say. */
  humanClubs: Integer | null;
  /** The line the app shows. */
  text: string;
}

/**
 * What `POST /api/v2/setup/automatic` answers (N3.5 Stage B2, D-063): whether the first run chose a save by itself.
 * `started`: the save that clearly stands out is chosen and importing, with the club when the save names one.
 * `alreadyChosen`: a save was chosen before; nothing changed (asking twice starts one import).
 * `nothingStandsOut`: nothing was chosen; `why` says why, and the app asks.
 */
export interface AutomaticSetup {
  outcome: 'started' | 'alreadyChosen' | 'nothingStandsOut';
  /** The line the app shows. */
  text: string;
  /** The save chosen (now or before); null when none is. */
  save: SaveInfo | null;
  /** The club followed, when a save was chosen now; null otherwise. */
  club: SetupClub | null;
  /** Why this save, or why none: the line with its basis; null when a save was already chosen. */
  why: Claim | null;
}

/**
 * The club a choice with `club: 'fromSave'` takes from the save (N6 Stage B2 review, H1):
 * - the same save chosen again (the league Pennant holds is already its import) keeps the club the GM chose;
 * - otherwise, or with no club chosen, the save's club is followed when its human manages exactly one;
 * - a save that is not the one Pennant holds, whose export names no human club, several, or doesn't say, gets no club:
 *   the club chosen before belongs to another league, so it is forgotten and the GM is asked.
 * Forgetting a club is written when the save's import lands, never now, so a failed import leaves the club as it was
 * (`forgetClubWhenImported`). Nothing here reads the league being left: only its folder is compared.
 */
function clubFromSave(csvDir: string): SetupClub {
  const config = loadConfig();
  const chosenClub = loadSettings().defaultOrgId;
  const clubs = humanClubsInExport(csvDir);
  const humanClubs = clubs === null ? null : clubs.length;
  // The save whose league Pennant holds: the last import's folder, else the one chosen (an import from before N3.5)
  const held = importState.lastImport?.csvDir ?? config.csvDir;
  const sameSave = held === csvDir && !clubForgottenWhenImported(csvDir);
  if (sameSave && chosenClub !== null) {
    forgetClubWhenImported(null);
    const name = clubNameInExport(csvDir, chosenClub);
    return { decided: true, teamId: chosenClub, name, humanClubs, text: name ? `Keeping the ${name}, the club you chose.` : 'Keeping the club you chose.' };
  }
  // A club chosen in another save's league is forgotten once this save's import lands
  forgetClubWhenImported(!sameSave && chosenClub !== null ? csvDir : null);
  if (clubs === null) {
    return { decided: false, teamId: null, name: null, humanClubs: null, text: 'The export doesn\'t say which club you manage, so Pennant will ask.' };
  }
  if (clubs.length === 1) {
    // Automatic: the server follows the club the save's human manages (`viewingOrganization.ts`), once imported
    return { decided: true, teamId: clubs[0].teamId, name: clubs[0].name, humanClubs: 1, text: `Following the ${clubs[0].name}, the club you manage in this save.` };
  }
  return {
    decided: false, teamId: null, name: null, humanClubs: clubs.length,
    text: clubs.length === 0 ? 'The export names no club you manage, so Pennant will ask.' : `You manage ${clubs.length} clubs in this save, so Pennant will ask which to follow.`,
  };
}

/** The first run's zero-question setup: choose and import the save that clearly stands out, or say why not. */
export function automaticSetup(): AutomaticSetup {
  const config = loadConfig();
  const { saves, unreadable } = findSaves();
  if (config.csvDir || importState.importing) {
    const save = saves.find((s) => s.csvDir === config.csvDir) ?? null;
    return { outcome: 'alreadyChosen', text: `${config.saveName ?? save?.name ?? 'A save'} is already chosen.`, save, club: null, why: null };
  }
  const view = saveDiscoveryView(saves, pickSave(saves, { unreadable }), []);
  const pick = view.pick ? saves.find((s) => s.id === view.pick!.saveId)! : null;
  if (!pick) {
    return { outcome: 'nothingStandsOut', text: 'No save clearly stands out, so Pennant will ask which to use.', save: null, club: null, why: view.noPick!.claim };
  }
  const club = clubFromSave(pick.csvDir);
  chooseSave(pick.csvDir, pick.name);
  return { outcome: 'started', text: `Using ${saveLabel(pick, saves)}, the save you've played most recently.`, save: pick, club, why: view.pick!.claim };
}

api.post('/import', (_req, res: Response<ImportAccepted | ApiError>) => {
  const config = loadConfig();
  if (!config.csvDir) return res.status(400).json({ error: 'No save configured' });
  if (importState.importing) return res.status(409).json({ error: IMPORT_RUNNING });
  if (!fs.existsSync(config.csvDir)) {
    return res.status(400).json({ error: `CSV directory not found: ${config.csvDir}` });
  }
  void runImport(config.csvDir);
  res.json({ ok: true, lastImport: importState.lastImport, lastError: importState.lastError });
});

api.get('/teams', (_req, res) => {
  if (!tableExists('teams')) return res.json([]);
  const cols = tableColumns('teams');
  const pick = (...names: string[]) => names.find((n) => cols.includes(n));
  const id = pick('team_id') ?? cols[0];
  const name = pick('name');
  const nickname = pick('nickname');
  const abbr = pick('abbr');
  const level = pick('level');
  const parent = pick('parent_team_id');
  const league = pick('league_id');
  const select = [
    `"${id}" AS team_id`,
    name ? `"${name}" AS name` : `'?' AS name`,
    nickname ? `"${nickname}" AS nickname` : `NULL AS nickname`,
    abbr ? `"${abbr}" AS abbr` : `NULL AS abbr`,
    level ? `"${level}" AS level` : `NULL AS level`,
    parent ? `"${parent}" AS parent_team_id` : `NULL AS parent_team_id`,
    league ? `"${league}" AS league_id` : `NULL AS league_id`,
  ].join(', ');
  res.json(db.prepare(`SELECT ${select} FROM teams ORDER BY name`).all());
});

/** Rating fields we surface, with candidate locations per OOTP schema version. */
const RATING_SPECS: Array<{ key: string; candidates: Array<[string, string]> }> = [
  { key: 'contact', candidates: [['players_batting', 'batting_ratings_overall_contact']] },
  { key: 'gap', candidates: [['players_batting', 'batting_ratings_overall_gap']] },
  { key: 'power', candidates: [['players_batting', 'batting_ratings_overall_power']] },
  { key: 'eye', candidates: [['players_batting', 'batting_ratings_overall_eye']] },
  { key: 'avoidK', candidates: [['players_batting', 'batting_ratings_overall_strikeouts']] },
  { key: 'contactPot', candidates: [['players_batting', 'batting_ratings_talent_contact']] },
  { key: 'powerPot', candidates: [['players_batting', 'batting_ratings_talent_power']] },
  { key: 'eyePot', candidates: [['players_batting', 'batting_ratings_talent_eye']] },
  { key: 'stuff', candidates: [['players_pitching', 'pitching_ratings_overall_stuff']] },
  { key: 'movement', candidates: [['players_pitching', 'pitching_ratings_overall_movement']] },
  { key: 'control', candidates: [['players_pitching', 'pitching_ratings_overall_control']] },
  { key: 'stuffPot', candidates: [['players_pitching', 'pitching_ratings_talent_stuff']] },
  { key: 'movementPot', candidates: [['players_pitching', 'pitching_ratings_talent_movement']] },
  { key: 'controlPot', candidates: [['players_pitching', 'pitching_ratings_talent_control']] },
  {
    key: 'speed',
    candidates: [
      ['players_batting', 'running_ratings_speed'],
      ['players', 'running_ratings_speed'],
    ],
  },
];

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};
// Verified against a real OOTP 27 export (Judge 1/1 R/R, Soto 2/2 L/L, Raleigh bats 3 S)
const BATS: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };
const THROWS: Record<number, string> = { 1: 'R', 2: 'L' };

api.get('/roster/:teamId', (req, res) => {
  const teamId = Number(req.params.teamId);
  if (!tableExists('players')) return res.status(400).json({ error: 'No player data imported yet' });

  const cols = tableColumns('players');
  const pick = (...names: string[]) => names.find((n) => cols.includes(n));
  const select = [
    `"${pick('player_id') ?? cols[0]}" AS player_id`,
    pick('first_name') ? `"first_name"` : `NULL AS first_name`,
    pick('last_name') ? `"last_name"` : `NULL AS last_name`,
    pick('age') ? `"age"` : `NULL AS age`,
    pick('position') ? `"position"` : `NULL AS position`,
    pick('role') ? `"role"` : `NULL AS role`,
    pick('bats') ? `"bats"` : `NULL AS bats`,
    pick('throws') ? `"throws"` : `NULL AS throws`,
    pick('uniform_number') ? `"uniform_number"` : `NULL AS uniform_number`,
  ].join(', ');

  /**
   * Who is actually on this club's roster.
   *
   * `players.team_id` is not a roster. OOTP parks players on a club without
   * giving them a spot — newly signed international free agents sit on the
   * parent club until they are assigned, and unsigned veterans keep pointing at
   * their last team — so a bare team_id swept 132 men across the league onto
   * major-league roster pages who were not on those rosters.
   *
   * team_roster with list_id = 1 is OOTP's own answer and works at every level:
   * for a major-league club it is the active roster plus the injured list, and
   * for an affiliate it is that affiliate's full roster. The roster-status flags
   * cannot be used here — is_active means "on the MLB active roster", so it
   * would empty every minor-league page.
   */
  const useRosterList = tableExists('team_roster');
  const players = db
    .prepare(
      useRosterList
        ? `SELECT ${select} FROM players
           WHERE player_id IN (SELECT player_id FROM team_roster WHERE team_id = ? AND list_id = 1)`
        : // An export without the table behaves as it always did
          `SELECT ${select} FROM players WHERE team_id = ?`
    )
    .all(teamId) as Record<string, unknown>[];

  // Attach ratings from wherever they live in this export's schema
  const ratingSources = new Map<string, [string, string]>();
  for (const spec of RATING_SPECS) {
    const loc = locateColumn(spec.candidates);
    if (loc) ratingSources.set(spec.key, loc);
  }
  const byTable = new Map<string, Array<{ key: string; column: string }>>();
  for (const [key, [table, column]] of ratingSources) {
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table)!.push({ key, column });
  }
  /**
   * Only this roster's men. The stat blocks below were being computed for every
   * player in the league — some twelve thousand rows and as many calls into the
   * stat engine — to display forty of them.
   */
  const rosterIds = players.map((p) => p.player_id as number);
  const idFilter = rosterIds.length > 0 ? `AND player_id IN (${rosterIds.map(() => '?').join(',')})` : '';

  const ratingsByPlayer = new Map<number, Record<string, unknown>>();
  for (const [table, specs] of byTable) {
    if (!tableColumns(table).includes('player_id')) continue;
    const sel = specs.map((s) => `"${s.column}" AS "${s.key}"`).join(', ');
    // Every ratings table was being read whole — every player in the save,
    // several times over — to fill in one roster
    const rows = db
      .prepare(`SELECT player_id, ${sel} FROM "${table}" WHERE player_id IN (${rosterIds.map(() => '?').join(',')})`)
      .all(...rosterIds) as Array<Record<string, unknown> & { player_id: number }>;
    for (const row of rows) {
      const { player_id, ...rest } = row;
      // Mutated in place rather than rebuilt: the spread was copying the whole
      // accumulated object once per row
      const existing = ratingsByPlayer.get(player_id);
      if (existing) Object.assign(existing, rest);
      else ratingsByPlayer.set(player_id, rest);
    }
  }

  // Current-season stats. Rate and league-relative stats (OPS+, wRC+, ERA+)
  // are computed server-side so every page shares one source of truth.
  const teamRow = db.prepare(`SELECT league_id, level FROM teams WHERE team_id = ?`).get(teamId) as
    | { league_id: number; level: number }
    | undefined;
  const statYear = tableExists('players_career_batting_stats')
    ? (db.prepare(`SELECT MAX(year) AS y FROM players_career_batting_stats`).get() as { y: number }).y
    : null;
  // League-relative stats are only meaningful against a baseline from the same
  // league and level, so minor-league clubs are compared to their own league.
  const baseline =
    teamRow && statYear !== null
      ? leagueBaseline(teamRow.league_id, statYear, teamRow.level)
      : null;

  const battingByPlayer = new Map<number, Record<string, number | null>>();
  if (tableExists('players_career_batting_stats') && statYear !== null && baseline && teamRow) {
    const rows = db
      .prepare(
        `SELECT player_id, SUM(pa) AS pa, SUM(ab) AS ab, SUM(h) AS h, SUM(d) AS d, SUM(t) AS t3,
                SUM(hr) AS hr, SUM(bb) AS bb, SUM(ibb) AS ibb, SUM(hp) AS hp, SUM(sf) AS sf,
                SUM(k) AS k, SUM(sb) AS sb, SUM(cs) AS cs, SUM(r) AS r, SUM(rbi) AS rbi,
                SUM(war) AS war
         FROM players_career_batting_stats
         -- A drafted amateur's school season lives here under no league at
         -- all, and summing it in credits him with what he did to schoolboys
         --
         -- And only what he did AT THIS LEVEL. A shuttling player has a line at
         -- each, and adding them together produces a season nobody had: a
         -- reader was shown a man recommended as a trade target on .313/.372/
         -- .552 and a 155 wRC+ when almost all of it was Triple-A. Worse, the
         -- rate stats below are scaled against this club's own league, so a
         -- Triple-A line was being measured against major-league pitching and
         -- coming out extraordinary.
         WHERE year = ? AND split_id = 1 AND league_id != 0 AND level_id = ?
               ${idFilter} GROUP BY player_id`
      )
      .all(statYear, teamRow.level, ...rosterIds) as Array<Record<string, number>>;
    for (const row of rows) {
      battingByPlayer.set(row.player_id, computeBatting(row, baseline, teamId));
    }
  }

  /*
   * The one scouting figure on a roster row (Player Value phase 6d, PLAYER_VALUE.md Part 8): the organization's scouted
   * tools averaged now and at their ceiling, 20-80, through the evidence boundary (D-017), the card header's "Scouted"
   * figure. OOTP's Overall and Potential (players_value) are not the organization's view and are not read. A tool that
   * has not been graded leaves the average unknown, never a stand-in (D-018).
   */
  const abilities = loadScoutedAbilities(rosterIds);

  /*
   * Where each man stands: designated, on waivers, on the injured list, or
   * simply active. OOTP's roster list keeps designated players on it, so
   * without this a man on the DFA clock reads as a regular — which is exactly
   * how the manager came to call one the starting third baseman.
   */
  const standingByPlayer = new Map<number, ReturnType<typeof standingOf>>();
  if (tableExists('players_roster_status') && rosterIds.length > 0) {
    // Named one at a time against the export's own schema: OOTP's roster-status
    // table has varied, and a column this app expects but a save does not have
    // would take the whole roster page down rather than losing one badge
    const statusCols = tableColumns('players_roster_status');
    const want = [
      'is_active', 'is_on_dl', 'is_on_dl60',
      'designated_for_assignment', 'days_on_dfa_left', 'is_on_waivers',
    ].filter((c) => statusCols.includes(c));
    const rows = db
      .prepare(
        `SELECT rs.player_id${want.map((c) => `, rs."${c}"`).join('')},
                p.injury_is_injured, p.injury_dtd_injury, p.injury_left
         FROM players_roster_status rs JOIN players p ON p.player_id = rs.player_id
         WHERE rs.player_id IN (${rosterIds.map(() => '?').join(',')})`
      )
      .all(...rosterIds) as Array<StandingFields & { player_id: number }>;
    for (const r of rows) standingByPlayer.set(r.player_id, standingOf(r));
  }

  // Contact quality for the whole roster in one pass — the batted-ball table is
  // large, so it is queried once per page rather than once per player
  const contactByPlayer = contactProfiles(players.map((p) => p.player_id as number));

  // Season fielding for the roster's optional defensive columns. Summed across
  // positions: a utility man's total workload is the useful number in a roster
  // row, and his split by position is on his card.
  const fieldingByPlayer = new Map<number, Record<string, number | null>>();
  if (tableExists('players_career_fielding_stats') && statYear !== null) {
    const rows = db
      .prepare(
        `SELECT player_id, SUM(g) AS fg, SUM(gs) AS fgs, SUM(ip) AS finn,
                SUM(po) AS po, SUM(a) AS a, SUM(e) AS e, SUM(dp) AS dp
         FROM players_career_fielding_stats
         -- No split filter: OOTP writes the CURRENT season's fielding with
         -- split_id 0 and past seasons with 1, so filtering on 1 silently
         -- dropped this year entirely. Each year carries exactly one split id,
         -- so leaving it out cannot double count. Batting and pitching are
         -- different — they really do split 1/2/3 — and keep their filter.
         --
         -- This club's level, for the same reason the batting above is: a man
         -- who has shuttled fields at each, and adding them together describes
         -- nobody. On this roster it was showing 587 innings and six errors
         -- for a shortstop who has played 28 innings in the majors and made
         -- none of them.
         WHERE year = ? AND level_id = ? ${idFilter} GROUP BY player_id`
      )
      .all(statYear, teamRow?.level ?? 1, ...rosterIds) as Array<Record<string, number>>;
    for (const r of rows) {
      const chances = (r.po ?? 0) + (r.a ?? 0) + (r.e ?? 0);
      const innings = r.finn ?? 0;
      fieldingByPlayer.set(r.player_id, {
        fg: r.fg ?? 0,
        fgs: r.fgs ?? 0,
        finn: innings,
        po: r.po ?? 0,
        a: r.a ?? 0,
        e: r.e ?? 0,
        dp: r.dp ?? 0,
        fpct: chances > 0 ? Math.round(((r.po + r.a) / chances) * 1000) / 1000 : null,
        // Chances handled per nine innings — the standard way to express range
        rf9: innings > 0 ? Math.round((((r.po + r.a) / innings) * 9) * 100) / 100 : null,
      });
    }
  }

  const pitchingByPlayer = new Map<number, Record<string, number | null>>();
  if (tableExists('players_career_pitching_stats') && statYear !== null && baseline && teamRow) {
    const rows = db
      .prepare(
        `SELECT player_id, SUM(outs) AS outs, SUM(er) AS er, SUM(ra) AS ra, SUM(ha) AS ha,
                SUM(bb) AS bb, SUM(k) AS k, SUM(hra) AS hra, SUM(bf) AS bf, SUM(g) AS g,
                SUM(gs) AS gs, SUM(w) AS w, SUM(l) AS l, SUM(s) AS sv, SUM(hld) AS hld,
                SUM(war) AS war
         FROM players_career_pitching_stats
         -- This club's level only, for the same reason as the batting above
         WHERE year = ? AND split_id = 1 AND league_id != 0 AND level_id = ?
               ${idFilter} GROUP BY player_id`
      )
      .all(statYear, teamRow.level, ...rosterIds) as Array<Record<string, number>>;
    for (const row of rows) {
      pitchingByPlayer.set(row.player_id, computePitching(row, baseline, teamId));
    }
  }

  // Scale bar rendering to the highest rating in this export
  let ratingMax = 0;
  for (const r of ratingsByPlayer.values()) {
    for (const v of Object.values(r)) {
      if (typeof v === 'number' && v > ratingMax) ratingMax = v;
    }
  }

  // Why each player is where he is, read from explicit log evidence against the
  // export. Only players for whom that changes the reading are included
  const assignmentByPlayer = assignmentContextsFor(rosterIds);

  const roster = players.map((p) => {
    const id = p.player_id as number;
    const pos = p.position as number | null;
    return {
      ...p,
      positionName: pos !== null && POSITION_NAMES[pos] ? POSITION_NAMES[pos] : String(pos ?? '?'),
      batsName: BATS[p.bats as number] ?? String(p.bats ?? '?'),
      throwsName: THROWS[p.throws as number] ?? String(p.throws ?? '?'),
      ratings: ratingsByPlayer.get(id) ?? {},
      fielding: fieldingByPlayer.get(id) ?? null,
      scouted: (() => {
        const a = abilities.for(id);
        return {
          now: a.current,
          ceiling: a.potential,
          status: a.status,
          missing: { now: [...a.missing.current], ceiling: [...a.missing.potential] },
        };
      })(),
      batting: battingByPlayer.get(id) ?? null,
      pitching: pitchingByPlayer.get(id) ?? null,
      contact: contactByPlayer.get(id) ?? null,
      standing: standingByPlayer.get(id) ?? null,
      assignment: assignmentByPlayer.get(id) ?? null,
    };
  });

  res.json({ players: roster, ratingMax, ratingKeys: [...ratingSources.keys()] });
});

/**
 * Say what went wrong.
 *
 * Express's default handler answers a thrown error with an HTML page, so the
 * client — which looks for `error` in a JSON body — fell back to printing the
 * status line and nothing else. A reader pressed Plan, got "500 Internal
 * Server Error" on every game in the schedule, and had nothing to send us; the
 * cause was one missing column in their export, and the message said so all
 * along, into a log nobody reads.
 *
 * The message goes to the reader now. Everything here runs against a file on
 * their own machine, so there is nothing to leak by telling them which column
 * their save is missing, and a specific complaint is one they can report.
 */
api.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: message });
});
