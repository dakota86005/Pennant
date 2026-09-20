/**
 * Finds the OOTP save that an imported CSV export belongs to, and reads the
 * one piece of save state that is authoritative for "what day is it".
 *
 * Nothing here writes. Every function only stats, lists, or reads.
 *
 * Observed layout (macOS App Store build, OOTP 27):
 *
 *   <saved_games>/<Name>.lg/
 *     import_export/csv/          <- the CSV export the user already makes
 *     settings/last_date_simulated.dat
 *     temp/text_data.sqlite3      <- live transaction database
 *     temp/text_data.sqlite3-wal
 *     temp/text_data.sqlite3-shm
 *
 * The CSV directory therefore names its own save: two levels up. Windows and
 * direct-download builds use the same relative layout, so the derivation does
 * not depend on any absolute path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { detectSaves } from './paths.js';

export type SaveDiscoveryMethod =
  /** `<save>.lg/import_export/csv`, the layout OOTP writes. */
  | 'csv_layout'
  /** Some ancestor of the export directory is a `.lg` folder. */
  | 'ancestor_lg'
  /** The configured save name matched a save found in a standard location. */
  | 'save_name_match'
  /** The user supplied the folder because nothing else worked. */
  | 'manual_override'
  | 'not_found';

export const LIVE_DB_NAME = 'text_data.sqlite3';

export interface LiveDatabaseFiles {
  tempDir: string;
  db: string;
  wal: string;
  shm: string;
  dbExists: boolean;
  walExists: boolean;
  shmExists: boolean;
}

export interface SaveLocation {
  found: boolean;
  method: SaveDiscoveryMethod;
  lgPath: string | null;
  saveName: string | null;
  live: LiveDatabaseFiles | null;
  lastDateSimulatedPath: string | null;
  /** Why the save could not be located, or what was tried. */
  notes: string[];
}

const isDirectory = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const exists = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** A `.lg` folder is a save if it is named like one and holds save content. */
function looksLikeSave(dir: string): boolean {
  return (
    dir.toLowerCase().endsWith('.lg') &&
    isDirectory(dir) &&
    (isDirectory(path.join(dir, 'import_export')) ||
      isDirectory(path.join(dir, 'temp')) ||
      isDirectory(path.join(dir, 'settings')))
  );
}

export function liveDatabaseFiles(lgPath: string): LiveDatabaseFiles {
  const tempDir = path.join(lgPath, 'temp');
  const db = path.join(tempDir, LIVE_DB_NAME);
  const wal = `${db}-wal`;
  const shm = `${db}-shm`;
  return { tempDir, db, wal, shm, dbExists: exists(db), walExists: exists(wal), shmExists: exists(shm) };
}

function locationFor(lgPath: string, method: SaveDiscoveryMethod, notes: string[]): SaveLocation {
  return {
    found: true,
    method,
    lgPath,
    saveName: path.basename(lgPath).replace(/\.lg$/i, ''),
    live: liveDatabaseFiles(lgPath),
    lastDateSimulatedPath: path.join(lgPath, 'settings', 'last_date_simulated.dat'),
    notes,
  };
}

/**
 * Derives the `.lg` save from where the CSV export lives. Order matters: the
 * export path is the strongest evidence, the saved name is a weaker one, and a
 * manual folder is only ever a fallback.
 */
export function locateSave(opts: {
  csvDir: string | null;
  saveName?: string | null;
  manualLgPath?: string | null;
}): SaveLocation {
  const notes: string[] = [];
  const notFound = (): SaveLocation => ({
    found: false,
    method: 'not_found',
    lgPath: null,
    saveName: opts.saveName ?? null,
    live: null,
    lastDateSimulatedPath: null,
    notes,
  });

  if (opts.csvDir) {
    const csv = path.resolve(opts.csvDir);

    const canonical = path.dirname(path.dirname(csv));
    if (
      path.basename(csv).toLowerCase() === 'csv' &&
      path.basename(path.dirname(csv)).toLowerCase() === 'import_export' &&
      looksLikeSave(canonical)
    ) {
      return locationFor(canonical, 'csv_layout', notes);
    }
    notes.push('The CSV folder is not inside <save>.lg/import_export/csv.');

    // An export copied or moved somewhere unusual can still sit below its save
    let dir = path.dirname(csv);
    for (let depth = 0; depth < 6 && dir !== path.dirname(dir); depth += 1) {
      if (looksLikeSave(dir)) return locationFor(dir, 'ancestor_lg', notes);
      dir = path.dirname(dir);
    }
    notes.push('No enclosing .lg folder was found above the CSV folder.');
  } else {
    notes.push('No CSV export is configured.');
  }

  if (opts.saveName) {
    const match = detectSaves().find((s) => s.name === opts.saveName);
    if (match && looksLikeSave(match.lgPath)) return locationFor(match.lgPath, 'save_name_match', notes);
    notes.push(`No save named "${opts.saveName}" was found in the standard OOTP locations.`);
  }

  if (opts.manualLgPath) {
    const manual = path.resolve(opts.manualLgPath);
    if (looksLikeSave(manual)) return locationFor(manual, 'manual_override', notes);
    notes.push('The manually configured save folder is not a valid .lg save.');
  }

  return notFound();
}

export interface SimulatedDate {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  source: 'last_date_simulated.dat';
}

/**
 * Reads `settings/last_date_simulated.dat`.
 *
 * Seven bytes: day, month, year as a little-endian 16-bit integer, then three
 * bytes that have always been zero. Read from one real save: `0f 05 ea 07 00
 * 00 00` is 15 May 2026, which is also the last date with played games in that
 * save's export and the newest date in its transaction log. The layout is
 * inferred from that evidence and not documented by OOTP, so anything that
 * does not decode to a plausible calendar date is rejected as unknown instead
 * of guessed at.
 */
export function parseLastDateSimulated(bytes: Uint8Array): SimulatedDate | null {
  if (bytes.length < 4) return null;
  const day = bytes[0];
  const month = bytes[1];
  const year = bytes[2] | (bytes[3] << 8);
  if (year < 1800 || year > 2500 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date: iso, source: 'last_date_simulated.dat' };
}

export function readLastDateSimulated(location: SaveLocation): SimulatedDate | null {
  if (!location.lastDateSimulatedPath) return null;
  try {
    return parseLastDateSimulated(fs.readFileSync(location.lastDateSimulatedPath));
  } catch {
    return null;
  }
}
