/**
 * The OOTP export on disk, as the importer and the watcher judge it (N3.5, D-061).
 *
 * OOTP writes an export as some seventy CSV files over 35 to 41 seconds, each created fresh, in the same order every
 * time (measured in four exports, SWIFTUI_REBUILD.md "N3.5"). The folder is therefore not atomic: for most of a minute
 * it holds a mix of the new export and the old. Two rules decide when it is whole:
 *
 *   quiet      no CSV has been written for `QUIET_MS` (the longest single file took 7.7 s; the gap between files is
 *              under 0.03 s), so OOTP has finished writing
 *   one burst  a file written more than `BURST_WINDOW_MS` before the newest was not rewritten this time: a table
 *              switched off in OOTP's export settings leaves its old file behind. It is STALE, left out of the import
 *              and named (the owner's decision 5, 2026-09-26)
 *
 * The importer also checks each file again after reading it (`importBuild.ts`): a file that changed while it was read
 * fails the import, so an early start costs a retry, never a mixed database. Only file names, sizes and times are read.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** How long the export must go unwritten before it counts as finished. */
export const QUIET_MS = 10_000;
/** How far behind the newest file a file may be and still belong to the same export (observed span 35 to 41 s). */
export const BURST_WINDOW_MS = 10 * 60_000;
/**
 * The quiet period in force: `QUIET_MS`, or `OOTP_FO_EXPORT_QUIET_MS` (the tests set it to 0, so an export they have
 * just written imports at once; a test of the rule sets its own). Mutable for the same reason.
 */
export const exportTiming = {
  quietMs: process.env.OOTP_FO_EXPORT_QUIET_MS !== undefined && Number.isFinite(Number(process.env.OOTP_FO_EXPORT_QUIET_MS))
    ? Number(process.env.OOTP_FO_EXPORT_QUIET_MS)
    : QUIET_MS,
};

/**
 * OOTP writes the files of one export back to back (the next begins within 0.03 s of the last; the longest file took
 * 7.7 s). Files of the burst whose times fall in groups further apart than this are not one export as it stands: OOTP
 * paused part way (the newer group is the new export, the older one the previous export's files not yet rewritten),
 * or a table was switched off since an export a few minutes earlier. (N3.5 review, finding 2.)
 */
export const CLUSTER_GAP_MS = 60_000;
/**
 * How long a burst in groups must stay unwritten before the older group is taken as left over (stale: left out and
 * named) rather than OOTP still at work. Much longer than any pause between two files.
 */
export const CLUSTER_SETTLE_MS = 120_000;

/** Tables without which an export is not one: stale or unreadable, they fail the import and the previous import stays. */
export const REQUIRED_TABLES = ['players', 'teams', 'leagues'] as const;

/** One CSV of the export, as `stat` saw it. */
export interface ExportFile {
  /** The file's name ("players.csv"). */
  file: string;
  /** The table it becomes ("players"). */
  table: string;
  size: number;
  mtimeMs: number;
}

/** The export folder, judged at one moment. */
export interface ExportAssessment {
  files: ExportFile[];
  /** The newest file's modification time, or null for an empty folder. */
  newestMs: number | null;
  /** How long since the newest file was written. */
  quietForMs: number | null;
  /**
   * OOTP has finished writing: quiet for `QUIET_MS` or more, and, when the burst's files fall in groups minutes apart,
   * quiet for `CLUSTER_SETTLE_MS` (after which the older groups count as stale).
   */
  settled: boolean;
  /** How long until it would count as settled if nothing is written meanwhile (0 when settled). */
  settlesInMs: number;
  /** The burst's files fall in groups minutes apart (`CLUSTER_GAP_MS`): OOTP paused part way, or tables were left over. */
  clustered: boolean;
  /** The files written in the newest burst: what an import reads. */
  current: ExportFile[];
  /** Files older than the burst: not rewritten this time. */
  stale: ExportFile[];
  /** A fingerprint of the current files (name, size, time), to tell a new export from one already imported. */
  fingerprint: string | null;
  /** A fingerprint of every file in the folder, to tell whether anything at all changed since this look. */
  folderFingerprint: string | null;
}

/** A file name as a table name: what the importer has always done. */
export function tableForFile(file: string): string {
  return file.replace(/\.csv$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Every CSV in the folder with its size and time; an unreadable folder is an empty list. */
export function listExport(csvDir: string): ExportFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(csvDir);
  } catch {
    return [];
  }
  const out: ExportFile[] = [];
  for (const file of names) {
    if (!file.endsWith('.csv')) continue;
    try {
      const st = fs.statSync(path.join(csvDir, file));
      if (!st.isFile()) continue;
      out.push({ file, table: tableForFile(file), size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // Gone between listing and stat: OOTP is writing, and the next look sees it
    }
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** The fingerprint of a set of files: their names, sizes and times. */
export function fingerprintOf(files: readonly ExportFile[]): string | null {
  if (files.length === 0) return null;
  const hash = crypto.createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.file < b.file ? -1 : 1))) hash.update(`${f.file}\0${f.size}\0${Math.round(f.mtimeMs)}\n`);
  return hash.digest('hex').slice(0, 32);
}

/**
 * When the newest file of the export last imported from a folder was written (milliseconds, whole), or null when no
 * import read that folder. `api.ts` answers it from the last import; a file no later than it was not rewritten since.
 */
export const importedExport = {
  writtenAtMs: (_csvDir: string): number | null => null,
};

/**
 * Judges a listing at `now`: quiet, the current burst, the stale files, the fingerprint. `importedWrittenAtMs` is when
 * the newest file of the last import of this folder was written: once any file is newer than that (a new export has
 * begun), a file no newer was not rewritten by it, however close in time the two exports are, so the export is judged
 * in groups (quiet for `CLUSTER_SETTLE_MS`, then that file is stale), never read as one burst (N3.5 Stage B2, closing
 * D-061's remaining window).
 */
export function assessFiles(files: ExportFile[], now: number, importedWrittenAtMs: number | null = null): ExportAssessment {
  if (files.length === 0) {
    return { files, newestMs: null, quietForMs: null, settled: false, settlesInMs: exportTiming.quietMs, clustered: false, current: [], stale: [], fingerprint: null, folderFingerprint: null };
  }
  const newestMs = Math.max(...files.map((f) => f.mtimeMs));
  const burst = files.filter((f) => f.mtimeMs >= newestMs - BURST_WINDOW_MS);
  // The newest group of the burst: back from the newest file until a gap longer than any pause between two files
  const times = [...new Set(burst.map((f) => f.mtimeMs))].sort((a, b) => b - a);
  let groupStart = times[0];
  for (let i = 1; i < times.length && times[i - 1] - times[i] <= CLUSTER_GAP_MS; i++) groupStart = times[i];
  if (importedWrittenAtMs !== null) {
    // Files rewritten since the last import of this folder, beside files that were not: the new export begins after them
    const rewritten = burst.filter((f) => Math.floor(f.mtimeMs) > importedWrittenAtMs);
    if (rewritten.length > 0 && rewritten.length < burst.length) groupStart = Math.max(groupStart, Math.min(...rewritten.map((f) => f.mtimeMs)));
  }
  const clustered = burst.some((f) => f.mtimeMs < groupStart);
  const quietForMs = Math.max(0, now - newestMs);
  const needed = clustered ? Math.max(exportTiming.quietMs, CLUSTER_SETTLE_MS) : exportTiming.quietMs;
  const settled = quietForMs >= needed;
  // Settled in groups: the older groups were not rewritten this time (stale); unsettled, they stay in the burst for now
  const current = clustered && settled ? burst.filter((f) => f.mtimeMs >= groupStart) : burst;
  const stale = files.filter((f) => !current.includes(f));
  return {
    files, newestMs, quietForMs, settled, settlesInMs: Math.max(0, needed - quietForMs), clustered,
    current, stale, fingerprint: fingerprintOf(current), folderFingerprint: fingerprintOf(files),
  };
}

/** The export folder judged now. */
export function assessExport(csvDir: string, now: number = Date.now(), importedWrittenAtMs: number | null = importedExport.writtenAtMs(csvDir)): ExportAssessment {
  return assessFiles(listExport(csvDir), now, importedWrittenAtMs);
}

/** The required tables among the stale files (an export without them fresh is not imported). */
export function staleRequired(assessment: ExportAssessment): string[] {
  const required = new Set<string>(REQUIRED_TABLES);
  return assessment.stale.filter((f) => required.has(f.table)).map((f) => f.table);
}
