import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Integer } from './contract/primitives.js';
import { timestampWords } from './timeWords.js';
import type { GameDate } from './dataFreshness.js';
import { parseLastDateSimulated } from './ootpSave.js';

/**
 * One OOTP save found on this Mac (`GET /api/saves`): where it is, its export, and (N3.5 Stage B2, D-063) which OOTP it
 * belongs to, when OOTP last saved it and whether its export is switched on. Only file names, sizes and times are read,
 * and the 7-byte game date OOTP keeps beside the save (`ootpSave.ts`); no save file's contents are parsed.
 */
export interface SaveInfo {
  name: string;
  lgPath: string;
  csvDir: string;
  csvCount: Integer;
  csvLastModified: string | null;
  /** `csvLastModified` in words (`timeWords.ts`); null with it. */
  csvLastModifiedText: string | null;
  /** A stable id for this save on this Mac (its folder's real path, hashed), for a request that names one (N3.5). */
  id?: string;
  /** The OOTP version whose folder holds it ("OOTP Baseball 27" is 27); null when the folder does not say (N3.5). */
  ootpVersion?: Integer | null;
  /** Where it was found, in words ("OOTP 27, Mac App Store version") (N3.5). */
  location?: string;
  /**
   * When OOTP last saved it: the newer file time of `players.dat` and `flag_save_completed.dat`, which OOTP writes on
   * every save; null when neither is there (OOTP has never saved this folder) (N3.5).
   */
  lastPlayedAt?: string | null;
  /** `lastPlayedAt` in words; null with it (N3.5). */
  lastPlayedText?: string | null;
  /** When OOTP wrote the newest file of its export (the same time as `csvLastModified`); null with no export (N3.5). */
  exportedAt?: string | null;
  /** The export holds CSV files to import (N3.5). */
  hasExport?: boolean;
  /** OOTP's export settings for this save exist (`settings/db_dump_standard_csv.cfg`): the export has been set up (N3.5). */
  exportConfigured?: boolean;
  /** The last day the save has played, from the save itself; null when it cannot be read (N3.5). */
  simulatedThrough?: GameDate | null;
  /** How to turn the export on, in one sentence, when the save has none; null when it has one (N3.5). */
  exportNote?: string | null;
}

/**
 * Where OOTP keeps its data, as patterns over every version (N3.5 Stage B2, D-063): the direct build's Application
 * Support folder, the Mac App Store build's container (its id names the version: `com.ootpdevelopments.ootp27macqlm`),
 * the second `~/Application Support` folder seen on the owner's Mac, and the Windows and OneDrive folders the earlier
 * builds listed. A Steam install could not be observed, so no Steam folder is listed. `*` stands for any OOTP version.
 */
interface SaveBase {
  label: string;
  /** Path segments under the home folder; a segment given as a RegExp matches any folder of that name pattern. */
  segments: Array<string | RegExp>;
  platform: 'mac' | 'win' | 'any';
}

const OOTP_VERSION_FOLDER = /^OOTP Baseball (\d+)$/;
const APP_STORE_CONTAINER = /^com\.ootpdevelopments\.ootp\d*macqlm$/i;
const OOTP_DATA = 'Out of the Park Developments';

const SAVE_BASES: SaveBase[] = [
  {
    label: 'Mac App Store version',
    segments: ['Library', 'Containers', APP_STORE_CONTAINER, 'Data', 'Application Support', OOTP_DATA, OOTP_VERSION_FOLDER, 'saved_games'],
    platform: 'mac',
  },
  { label: 'direct download', segments: ['Library', 'Application Support', OOTP_DATA, OOTP_VERSION_FOLDER, 'saved_games'], platform: 'mac' },
  // Seen on the owner's Mac (N3.5 Stage A): an OOTP folder under ~/Application Support, not ~/Library
  { label: 'Application Support in your home folder', segments: ['Application Support', OOTP_DATA, OOTP_VERSION_FOLDER, 'saved_games'], platform: 'mac' },
  { label: 'OneDrive-synced saves', segments: ['Library', 'CloudStorage', 'OneDrive-Personal', 'ootp', 'saved_games'], platform: 'mac' },
  { label: 'Documents', segments: ['Documents', OOTP_DATA, OOTP_VERSION_FOLDER, 'saved_games'], platform: 'win' },
  { label: 'OneDrive Documents', segments: ['OneDrive', 'Documents', OOTP_DATA, OOTP_VERSION_FOLDER, 'saved_games'], platform: 'win' },
];

/** A `saved_games` folder found on disk, with the OOTP version its path names. */
export interface SaveRoot {
  path: string;
  label: string;
  ootpVersion: number | null;
}

const listDirs = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
};

/** Every folder under `home` matching a base's segments, with the OOTP version named on the way. */
function expandBase(home: string, base: SaveBase): SaveRoot[] {
  let found: Array<{ path: string; version: number | null }> = [{ path: home, version: null }];
  for (const segment of base.segments) {
    const next: typeof found = [];
    for (const at of found) {
      if (typeof segment === 'string') {
        next.push({ path: path.join(at.path, segment), version: at.version });
        continue;
      }
      for (const name of listDirs(at.path)) {
        const m = segment.exec(name);
        if (!m) continue;
        next.push({ path: path.join(at.path, name), version: m[1] !== undefined ? Number(m[1]) : at.version });
      }
    }
    found = next;
  }
  return found
    .filter((f) => isDir(f.path))
    .map((f) => ({ path: f.path, ootpVersion: f.version, label: f.version === null ? base.label : `OOTP ${f.version}, ${base.label}` }));
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Every `saved_games` folder on this machine, every OOTP version, in a stable order. */
export function saveGameRoots(home: string = os.homedir()): SaveRoot[] {
  return SAVE_BASES.flatMap((base) => expandBase(home, base)).sort((a, b) => (b.ootpVersion ?? 0) - (a.ootpVersion ?? 0) || (a.path < b.path ? -1 : 1));
}

/** One place the server looks for saves: a human label, the folder, and whether it exists here. */
export interface SearchLocation {
  label: string;
  path: string;
  exists: boolean;
}

/**
 * The locations we scan, with a human label and whether each exists here.
 * Shown to the user when auto-detection finds nothing, so they know where we
 * looked before being asked to browse for the folder themselves. Each folder found is listed; a pattern with none
 * found is listed once with `*` for the parts that vary (the version, the App Store container's id).
 */
export function searchLocations(home: string = os.homedir(), platform: NodeJS.Platform = process.platform): SearchLocation[] {
  const wanted = SAVE_BASES.filter((b) => b.platform === 'any' || (platform === 'win32' ? b.platform === 'win' : platform === 'darwin' ? b.platform === 'mac' : true));
  return wanted.flatMap((base): SearchLocation[] => {
    const found = expandBase(home, base);
    if (found.length > 0) return found.map((r) => ({ label: r.label, path: r.path, exists: true }));
    const pattern = base.segments.map((s) => (typeof s === 'string' ? s : s === OOTP_VERSION_FOLDER ? 'OOTP Baseball *' : 'com.ootpdevelopments.ootp*macqlm'));
    const versioned = base.segments.includes(OOTP_VERSION_FOLDER);
    return [{ label: versioned ? `OOTP, ${base.label}` : base.label, path: path.join(home, ...pattern), exists: false }];
  });
}

const hasCsvFiles = (dir: string): number => {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).length;
  } catch {
    return 0;
  }
};

export interface ResolveResult {
  ok: boolean;
  csvDir?: string;
  saveName?: string;
  csvCount?: Integer;
  /** Saves found inside the chosen folder, when it holds several. */
  saves?: SaveInfo[];
  error?: string;
}

/**
 * Turns whatever folder the user picked into a usable CSV export directory.
 * Accepts the csv folder itself, a `<save>.lg` folder, or a `saved_games`
 * folder holding many saves — people reasonably pick any of the three.
 */
export function resolveChosenFolder(input: string): ResolveResult {
  const dir = path.resolve(input.trim().replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(dir)) return { ok: false, error: `That folder does not exist:\n${dir}` };
  if (!fs.statSync(dir).isDirectory()) return { ok: false, error: 'That is a file, not a folder.' };

  // 1. The folder already holds the CSV export
  const direct = hasCsvFiles(dir);
  if (direct > 0) {
    const saveName = path.basename(path.resolve(dir, '..', '..')).replace(/\.lg$/i, '');
    return { ok: true, csvDir: dir, csvCount: direct, saveName: saveName || path.basename(dir) };
  }

  // 2. A <save>.lg folder — the export lives at import_export/csv inside it
  const inner = path.join(dir, 'import_export', 'csv');
  const innerCount = hasCsvFiles(inner);
  if (innerCount > 0) {
    return { ok: true, csvDir: inner, csvCount: innerCount, saveName: path.basename(dir).replace(/\.lg$/i, '') };
  }

  // 3. A folder containing saves — let the user pick which one
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { ok: false, error: 'That folder could not be read (permissions?).' };
  }
  const saves: SaveInfo[] = [];
  for (const entry of entries) {
    const lg = path.join(dir, entry);
    // `.lg` on its own is a stray directory, not a save
    if (!entry.toLowerCase().endsWith('.lg') || entry === '.lg') continue;
    try {
      if (!fs.statSync(lg).isDirectory()) continue;
    } catch {
      continue;
    }
    saves.push(describeSave(lg));
  }
  if (saves.length > 0) return { ok: false, saves, error: 'Pick which save to use.' };

  if (fs.existsSync(inner)) {
    return {
      ok: false,
      error:
        'Found this save, but it has no CSV export yet.\n\n' +
        'In OOTP: Database Tools → Global Actions → Export data to CSV files, then try again.',
    };
  }
  return {
    ok: false,
    error:
      'No OOTP data found in that folder.\n\n' +
      'Choose the save folder (it ends in .lg), the folder holding your saves, ' +
      'or the import_export/csv folder itself.',
  };
}

/** The file times OOTP writes on every save: the players file and the flag it closes a save with. */
const SAVE_WRITTEN_FILES = ['players.dat', 'flag_save_completed.dat'];

const mtimeOf = (file: string): number | null => {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
};

/** A save's id: its folder's real path, hashed (stable on this Mac, and nothing in it to read back). */
export function saveId(lgPath: string): string {
  let real = path.resolve(lgPath);
  try {
    real = fs.realpathSync(lgPath);
  } catch {
    // A folder that has gone keeps the id of the path it had
  }
  return crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
}

/** When OOTP last saved this save: the newer of the files it writes on every save, or null when neither is there. */
export function lastPlayedMs(lgPath: string): number | null {
  const times = SAVE_WRITTEN_FILES.map((f) => mtimeOf(path.join(lgPath, f))).filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

/** How to switch an export on in OOTP, as its own documentation puts it (`presentation/saveWords.ts` cites it). */
export const EXPORT_OFF_NOTE =
  'No export yet. In OOTP, open Game Settings, then the Database tab, and use Database Tools to export the league to CSV files.';

/** Reads the export state and the save facts for one `<save>.lg` directory. */
export function describeSave(lgPath: string, root: SaveRoot | null = null): SaveInfo {
  const csvDir = path.join(lgPath, 'import_export', 'csv');
  let csvCount = 0;
  let csvLastModified: string | null = null;
  let csvs: string[] = [];
  try {
    csvs = fs.readdirSync(csvDir).filter((f) => f.toLowerCase().endsWith('.csv'));
  } catch {
    csvs = [];
  }
  csvCount = csvs.length;
  let latest = 0;
  for (const f of csvs) {
    const mtime = mtimeOf(path.join(csvDir, f)) ?? 0;
    if (mtime > latest) latest = mtime;
  }
  if (latest > 0) csvLastModified = new Date(latest).toISOString();
  const played = lastPlayedMs(lgPath);
  const lastPlayedAt = played === null ? null : new Date(played).toISOString();
  const version = root?.ootpVersion ?? versionFromPath(lgPath);
  let simulated: { date: string } | null = null;
  try {
    simulated = parseLastDateSimulated(fs.readFileSync(path.join(lgPath, 'settings', 'last_date_simulated.dat')));
  } catch {
    simulated = null;
  }
  return {
    name: path.basename(lgPath).replace(/\.lg$/i, ''),
    lgPath,
    csvDir,
    csvCount,
    csvLastModified,
    csvLastModifiedText: timestampWords(csvLastModified),
    id: saveId(lgPath),
    ootpVersion: version,
    location: root?.label ?? (version === null ? 'Chosen folder' : `OOTP ${version}`),
    lastPlayedAt,
    lastPlayedText: timestampWords(lastPlayedAt),
    exportedAt: csvLastModified,
    hasExport: csvCount > 0,
    exportConfigured: mtimeOf(path.join(lgPath, 'settings', 'db_dump_standard_csv.cfg')) !== null,
    simulatedThrough: simulated?.date ?? null,
    exportNote: csvCount > 0 ? null : EXPORT_OFF_NOTE,
  };
}

/** The OOTP version a path names ("…/OOTP Baseball 27/…"), or null. */
export function versionFromPath(p: string): number | null {
  for (const part of path.resolve(p).split(path.sep).reverse()) {
    const m = OOTP_VERSION_FOLDER.exec(part);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Every save in every `saved_games` folder found (every OOTP version), each once (by its real path), most recently
 * played first (a save OOTP has never saved last), then by name. A stray folder named just `.lg` is not a save.
 */
export function detectSaves(home: string = os.homedir()): SaveInfo[] {
  const saves: SaveInfo[] = [];
  const seen = new Set<string>();
  for (const root of saveGameRoots(home)) {
    for (const entry of listDirs(root.path)) {
      if (!entry.toLowerCase().endsWith('.lg') || entry === '.lg') continue;
      const lgPath = path.join(root.path, entry);
      if (!isDir(lgPath)) continue;
      const info = describeSave(lgPath, root);
      if (seen.has(info.id!)) continue;
      seen.add(info.id!);
      saves.push(info);
    }
  }
  return rankSaves(saves);
}

/** Most recently played first; a save never saved by OOTP last; then by name. Export time never orders them. */
export function rankSaves(saves: SaveInfo[]): SaveInfo[] {
  const at = (s: SaveInfo): number => (s.lastPlayedAt ? Date.parse(s.lastPlayedAt) : -Infinity);
  return [...saves].sort((a, b) => at(b) - at(a) || a.name.localeCompare(b.name) || a.lgPath.localeCompare(b.lgPath));
}
