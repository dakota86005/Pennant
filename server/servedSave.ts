/**
 * The save being served: the one save every reader of save-specific data describes (D-079).
 *
 * The league Pennant serves is the last import's, and the import records the export folder it read (N3.5). Choosing
 * another save writes the configuration at once, but the league stays the old save's until the new save's import lands
 * (or never, when it has no export or its import fails). Readers that took "the save" from the configuration mixed the
 * two: the served league's players got the chosen save's transactions, the freshness compared one save's export with the
 * other's date, and the GM's notes, philosophy and budgets were filed by a name or a team id any save may share.
 *
 * So the save is taken from the served import, never from the configuration:
 * - `servedSource` names the export folder the served league came from, and whether the configuration still names it
 *   (only then is the configuration's hand-named `.lg` folder and name the served save's).
 * - `switchPending` says a save was chosen whose import has not landed: the configuration names another export folder
 *   than the served import's. Everything that would show the served league then waits for the chosen save's import
 *   (`awaitingImportGate` in `api.ts`).
 * - `servedSaveKey` is the stable key the GM's inputs and the per-save fits are filed under: the served save's folder
 *   id (D-063's `saveId`, as the save list and rating history identify it), never its name or its league's data.
 *
 * An import by an earlier build records no folder; for it the configuration is the only word (as before), until the
 * next import. Reads only the configuration, the served import's record and the folders' names (a few `stat` calls,
 * kept per import). Writes nothing.
 */
import path from 'node:path';
import { loadConfig } from './config.js';
import { databaseGeneration, importRecord, tableExists } from './db.js';
import { locateSave } from './ootpSave.js';
import { saveId } from './paths.js';

/** Where the served league came from. */
export interface ServedSource {
  /** The export folder the served league was imported from (the configuration's, for an earlier build's import). */
  csvDir: string | null;
  /** Whether the configuration names that same folder: then its save name and hand-named folder are the served save's. */
  configured: boolean;
  /** Whether the served import itself recorded the folder (every import by this build). */
  recorded: boolean;
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && path.resolve(a) === path.resolve(b);

/** The export folder the served league came from, and whether the configuration still names it. */
export function servedSource(): ServedSource {
  const config = loadConfig();
  const recorded = importRecord()?.csvDir;
  if (typeof recorded === 'string' && recorded) return { csvDir: recorded, configured: same(recorded, config.csvDir), recorded: true };
  return { csvDir: config.csvDir, configured: true, recorded: false };
}

/** A save chosen whose import has not landed: the league served is still another save's. */
export interface PendingSwitch {
  /** The chosen save's export folder. */
  csvDir: string;
  /** The chosen save's name, as configured; null when none was given. */
  saveName: string | null;
}

/**
 * The save chosen and not yet imported, while the served league is another save's; null when the league served is the
 * chosen save's (or nothing is served, or the served import names no folder, which only an earlier build's does).
 */
export function switchPending(): PendingSwitch | null {
  const recorded = importRecord()?.csvDir;
  if (typeof recorded !== 'string' || !recorded) return null;
  const config = loadConfig();
  if (!config.csvDir || same(recorded, config.csvDir)) return null;
  if (!tableExists('players')) return null;
  return { csvDir: config.csvDir, saveName: config.saveName };
}

/** The folder a save's export identifies it by (D-063, D-064). */
export interface SaveFolder {
  /** The folder's id (`saveId`), or '' when there is no export folder at all. */
  folderId: string;
  /** The folder it was identified by: the `<save>.lg` folder, or the export folder when none encloses it. */
  folderPath: string | null;
  /** The save's name as the folder gives it; null when the folder doesn't say. */
  name: string | null;
  /** Whether the `<save>.lg` folder was found (or OOTP's layout names it while it can't be seen). */
  located: boolean;
}

/**
 * The folder an export folder belongs to, identified the way the save list identifies saves: the `<save>.lg` folder
 * that encloses it (or that OOTP's layout names while it can't be seen, a drive not mounted), else the export folder
 * itself. Never the hand-named folder, and never a save found by its name: the id must not change when either does.
 */
export function saveFolderOf(csvDir: string | null): SaveFolder {
  if (!csvDir) return { folderId: '', folderPath: null, name: null, located: false };
  const location = locateSave({ csvDir });
  const csv = path.resolve(csvDir);
  const byLayout = path.basename(csv).toLowerCase() === 'csv' && path.basename(path.dirname(csv)).toLowerCase() === 'import_export'
    && path.dirname(path.dirname(csv)).toLowerCase().endsWith('.lg') ? path.dirname(path.dirname(csv)) : null;
  // `locateSave` without a name or a hand-named folder finds only the enclosing save
  const lgPath = location.found ? location.lgPath : null;
  const folderPath = lgPath ?? byLayout ?? csv;
  const name = location.found ? location.saveName : byLayout ? path.basename(byLayout).replace(/\.lg$/i, '') : null;
  return { folderId: saveId(folderPath), folderPath, name, located: lgPath !== null || byLayout !== null };
}

/** The key a save's own data is filed under: its folder id, never its name (D-079). */
export const saveKeyOf = (folderId: string): string => `save:${folderId || 'none'}`;

let kept: { signature: string; at: number; folder: SaveFolder } | null = null;
const LOOK_AGAIN_MS = 15_000;

/** What the served save's folder depends on (no file is read beyond the configuration and the import's record). */
function signature(): string {
  const source = servedSource();
  return JSON.stringify([databaseGeneration(), importRecord()?.startedAt ?? null, source.csvDir]);
}

/** The served save's folder, kept per import (a folder not found is looked for again after 15 seconds). */
export function servedSaveFolderOf(): SaveFolder {
  const sig = signature();
  const now = Date.now();
  if (kept && kept.signature === sig && (kept.folder.located || now - kept.at < LOOK_AGAIN_MS)) return kept.folder;
  const folder = saveFolderOf(servedSource().csvDir);
  kept = { signature: sig, at: now, folder };
  return folder;
}

/**
 * The key the served save's own data is filed under (D-079): the GM's notes and watchlist, each club's philosophy,
 * budget and theme, the AI's kept writing, and the per-save fits and market records (D-053). `save:none` when the served
 * league names no export folder at all (nothing has been chosen).
 */
export function servedSaveKey(): string {
  return saveKeyOf(servedSaveFolderOf().folderId);
}

/** Forgets the kept folder (a test changed the save or its folders). */
export function forgetServedSaveFolder(): void {
  kept = null;
}
