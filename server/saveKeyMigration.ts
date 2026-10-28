/**
 * The one-time migration of the GM's inputs onto the save's key (D-079, the owner's decision of 2026-10-28).
 *
 * Before D-079 the GM's notes and watchlist were filed under the configured save's NAME (or `unknown`), and each club's
 * philosophy, next-season budget and theme pack, and the AI's kept writing (Staff room conversations, storylines, the
 * briefing), by the club's team id alone. OOTP names every new league "New Game" and numbers clubs from 1 in every league,
 * so all of them leaked into other saves. They are now kept under the served save's key (`servedSave.ts`).
 *
 * What existed before goes to the save configured when this runs (the owner's decision):
 * - `history.db`: the watchlist rows and player notes filed under the configured name are filed under its key. Rows under
 *   any other name belong to another save, so they are left where they are, unused, and counted in the log.
 * - `settings.json`: every philosophy, budget and theme kept by a bare team id is kept under the save's key and that id;
 *   a chosen club (`defaultOrgId`) with no save of its own is stamped with it.
 * - The AI's files in the data folder are moved into the save's folder (`saves/<id>/`).
 *
 * Safe to run again: everything it does is a move of what is still in the old form, so a run cut short finishes on the
 * next start, and a finished one does nothing (its record, `save-key-migration.json`). Before anything is changed, the
 * rows being re-filed and `settings.json` are copied into `backups/`. It waits, doing nothing, until a save is configured.
 * Logged in plain words. Runs on the server's own thread at start, before any request is answered.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadConfig } from './config.js';
import { historyDb } from './history.js';
import { saveFolderOf, saveKeyOf } from './servedSave.js';

/** The record of the finished migration. */
export const MIGRATION_RECORD = path.join(DATA_DIR, 'save-key-migration.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const SETTINGS = path.join(DATA_DIR, 'settings.json');

/** What a run did. */
export interface SaveKeyMigration {
  /** Whether it ran now (false: done before, or no save is configured yet). */
  ran: boolean;
  /** The key the existing data was given; null when it didn't run. */
  saveKey: string | null;
  watchlist: number;
  notes: number;
  /** Watchlist rows and notes under another save's name, left where they are. */
  leftForOtherSaves: number;
  /** Club settings (philosophies, budgets, themes) re-keyed. */
  clubSettings: number;
  /** Whether the chosen club was stamped with the save. */
  clubStamped: boolean;
  aiFiles: number;
}

const nothing = (saveKey: string | null = null): SaveKeyMigration => ({
  ran: false, saveKey, watchlist: 0, notes: 0, leftForOtherSaves: 0, clubSettings: 0, clubStamped: false, aiFiles: 0,
});

/** The AI's files as kept before D-079: in the data folder, by team id (and person). */
const AI_FILE = /^(chat|chat-context|storylines|briefing)-\d+(-[a-z]+)?\.json$/;
/** A key kept by a bare team id. */
const BARE_TEAM = /^\d+$/;
const CLUB_MAPS = ['organizationPhilosophies', 'nextSeasonBudget', 'themePacks'] as const;

function writeAtomic(file: string, text: string): void {
  const partial = `${file}.partial`;
  fs.writeFileSync(partial, text);
  fs.renameSync(partial, file);
}

/**
 * What is about to change, copied into `backups/` first: the watchlist rows and notes being re-filed (as JSON: a copy of
 * the whole `history.db`, rating history and all, would hold up the start for a one-time change of two small tables)
 * and `settings.json` as it was.
 */
function backUp(stamp: string, legacyName: string, settingsChange: boolean): void {
  fs.mkdirSync(BACKUPS, { recursive: true });
  const rows = {
    saveName: legacyName,
    watchlist: historyDb.prepare(`SELECT * FROM watchlist WHERE save_name = ?`).all(legacyName),
    player_notes: historyDb.prepare(`SELECT * FROM player_notes WHERE save_name = ?`).all(legacyName),
  };
  if (rows.watchlist.length || rows.player_notes.length) writeAtomic(path.join(BACKUPS, `gm-inputs-before-save-key-${stamp}.json`), JSON.stringify(rows, null, 2));
  if (settingsChange) fs.copyFileSync(SETTINGS, path.join(BACKUPS, `settings-before-save-key-${stamp}.json`));
}

/**
 * Moves the GM's inputs kept in the old form onto the configured save's key, once. Returns what it did; `ran: false`
 * when it was done before or no save is configured yet (it runs at the next start that has one).
 */
export function migrateToSaveKeys(): SaveKeyMigration {
  if (fs.existsSync(MIGRATION_RECORD)) return nothing();
  const config = loadConfig();
  if (!config.csvDir) return nothing();
  const folder = saveFolderOf(config.csvDir);
  const saveKey = saveKeyOf(folder.folderId);
  const legacyName = config.saveName ?? 'unknown';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const settingsText = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
  backUp(stamp, legacyName, settingsText !== null && /"\d+"\s*:|"defaultOrgId"\s*:\s*\d/.test(settingsText));
  const out: SaveKeyMigration = { ...nothing(saveKey), ran: true };

  // history.db: the configured save's notes and watchlist, in one transaction
  historyDb.transaction(() => {
    out.watchlist = historyDb.prepare(`UPDATE OR IGNORE watchlist SET save_name = ? WHERE save_name = ?`).run(saveKey, legacyName).changes;
    out.notes = historyDb.prepare(`UPDATE player_notes SET save_name = ? WHERE save_name = ?`).run(saveKey, legacyName).changes;
  }).immediate();
  out.leftForOtherSaves =
    (historyDb.prepare(`SELECT COUNT(*) AS n FROM watchlist WHERE save_name NOT LIKE 'save:%'`).get() as { n: number }).n +
    (historyDb.prepare(`SELECT COUNT(*) AS n FROM player_notes WHERE save_name NOT LIKE 'save:%'`).get() as { n: number }).n;

  // settings.json: every club's settings kept by a bare team id, and the chosen club's save
  if (settingsText !== null) {
    const settings = JSON.parse(settingsText) as Record<string, unknown>;
    for (const map of CLUB_MAPS) {
      const entries = settings[map];
      if (!entries || typeof entries !== 'object') continue;
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
        if (BARE_TEAM.test(key)) {
          const keyed = `${saveKey}|${Number(key)}`;
          // An entry the save already has under its key is the newer word
          if (!(keyed in (entries as Record<string, unknown>))) next[keyed] = value;
          out.clubSettings += 1;
        } else {
          next[key] = value;
        }
      }
      settings[map] = next;
    }
    if (typeof settings.defaultOrgId === 'number' && typeof settings.defaultOrgSave !== 'string') {
      settings.defaultOrgSave = saveKey;
      out.clubStamped = true;
    }
    if (out.clubSettings > 0 || out.clubStamped) writeAtomic(SETTINGS, JSON.stringify(settings, null, 2));
  }

  // The AI's files, into the save's folder
  const aiFolder = path.join(DATA_DIR, 'saves', folder.folderId || 'none');
  for (const file of fs.readdirSync(DATA_DIR).filter((f) => AI_FILE.test(f))) {
    const to = path.join(aiFolder, file);
    fs.mkdirSync(aiFolder, { recursive: true });
    if (fs.existsSync(to)) continue;
    fs.renameSync(path.join(DATA_DIR, file), to);
    out.aiFiles += 1;
  }

  writeAtomic(MIGRATION_RECORD, JSON.stringify({ migratedAt: new Date().toISOString(), csvDir: config.csvDir, saveName: config.saveName, ...out }, null, 2));
  const name = config.saveName ? `"${config.saveName}"` : 'the save chosen';
  console.log(
    `[migration] the GM's inputs now belong to ${name}: ${out.watchlist} watched players, ${out.notes} notes, ` +
    `${out.clubSettings} club settings${out.clubStamped ? ', the chosen club' : ''} and ${out.aiFiles} AI files` +
    (out.leftForOtherSaves ? `; ${out.leftForOtherSaves} watched players and notes filed under another save's name were left where they are, unused` : '') +
    ' (what was changed is copied in backups/)',
  );
  return out;
}
