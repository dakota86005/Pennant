/**
 * Which save a piece of rating history belongs to (D-064).
 *
 * Rating history used to be filed under the save's NAME (`config.saveName`). OOTP names every new league "New Game",
 * one Mac can hold several saves of one name (N3.5 found two), and switching between two of them compared one
 * league's ratings with another's and read the difference as development. This module gives each save's history a
 * key of its own and decides, once, which of the name-keyed rows written before it are certainly that save's.
 *
 * **What a save's history key is built from.** The save's folder, identified as the save list identifies it (D-063,
 * `saveId`: the `<save>.lg` folder's real path, hashed), checked against the save's own players: a key bound to a
 * folder is kept only while the league in that folder still has the players its history saw (`continuityOf`). So:
 *
 * - Pennant restarting, a re-import, or a save of the same name elsewhere changes nothing about which history is read.
 * - Two saves that share a name are two folders, so two keys, whatever their leagues.
 * - A save moved or renamed in OOTP is a new folder. Its history follows it when exactly one known history's folder
 *   has gone and that history's latest snapshot has this league's players; otherwise it starts fresh, and says so.
 * - A folder that now holds a different league (a save deleted and a new one made under its name) starts fresh.
 *
 * What it cannot tell apart, and why: two saves whose players are the same people under the same ids (a Finder copy of
 * a save, or two leagues started from the same real-life database) look alike by their players. A copy is its own
 * folder, so its history starts fresh rather than sharing the original's; but a save deleted and remade in the same
 * folder from the same database keeps the history of the one it replaced. Nothing here parses OOTP's own save files.
 *
 * Only certain rows are brought over from the name-keyed history (D-018): a date's rows go to this save only when they
 * have this league's players, the date is not after the league's own date, and no other known save of that name with
 * an export also has those players. Rows that fail are left where they are, unused, and the save's data status says
 * so in a sentence. The name-keyed tables are never altered (the earlier Electron build still uses them), and a
 * timestamped copy of `history.db` is made in `backups/` before the first row is brought over.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { databaseGeneration, db as leagueDb, importRecord, LAST_IMPORT_PATH, tableColumns, tableExists } from './db.js';
import { DATA_DIR, loadConfig } from './config.js';
import { parseGameDate } from './dataFreshness.js';
import { historyDb, SNAPSHOT_DATA_COLUMNS, snapshotGameDate } from './history.js';
import { locateSave } from './ootpSave.js';
import { detectSaves, saveId, type SaveInfo } from './paths.js';
import { delimiterOf, splitLine } from './saveDiscovery.js';

// ── the policy ────────────────────────────────────────────────────────────────

/**
 * When two sets of players are the same league's (a stated policy line, not a fit). Players are compared by id and
 * name, only where both sides have the id: a player since deleted from the league is not evidence either way.
 *
 * One league keeps its players' names (they change only if the GM edits one): on the owner's own history every
 * earlier snapshot matched its save's export by every name it shared (10,594 of 10,594 at best). Two fictional
 * leagues' ids name different people, so their share sits near 0. Two leagues started from the same real-life
 * database share every real player's id and name, and differ only in the players each generated (draft classes,
 * amateurs): on the owner's saves 99.2% and 99.8% of shared players matched across different saves. So the same
 * league is drawn at 999 in 1,000: close enough to all that a GM's odd edit keeps a save's history, far enough above
 * the measured 99.8% that two saves of one database are told apart by their generated players. Two such saves with
 * fewer than one generated player in a thousand among those compared cannot be told apart this way, and are not
 * claimed to be. The gap between the lines is unclear, never decided.
 */
export const CONTINUITY_POLICY = {
  /** Fewer players compared than this is no evidence either way. */
  minCompared: 20,
  /** At least this share of the compared players with the same name: the same league. */
  sameShare: 0.999,
  /** Below this share: a different league. Between the two lines: unclear. */
  differentShare: 0.5,
} as const;

export type ContinuityVerdict = 'same' | 'different' | 'unclear' | 'no_evidence';

export interface Continuity {
  verdict: ContinuityVerdict;
  /** Players present on both sides. */
  compared: number;
  /** Of those, the ones with the same name. */
  matched: number;
}

/** A player's name as compared: trimmed, runs of spaces made one. */
export const normalName = (name: unknown): string | null => {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  return n === '' ? null : n;
};

/** Whether snapshot rows show the same league as a set of players (id to name). */
export function continuityOf(rows: Iterable<{ player_id: unknown; name: unknown }>, names: ReadonlyMap<number, string> | null): Continuity {
  if (!names || names.size === 0) return { verdict: 'no_evidence', compared: 0, matched: 0 };
  let compared = 0;
  let matched = 0;
  for (const row of rows) {
    const id = Number(row.player_id);
    const theirs = names.get(id);
    const ours = normalName(row.name);
    if (theirs === undefined || ours === null) continue;
    compared += 1;
    if (theirs === ours) matched += 1;
  }
  if (compared < CONTINUITY_POLICY.minCompared) return { verdict: 'no_evidence', compared, matched };
  const share = matched / compared;
  const verdict: ContinuityVerdict = share >= CONTINUITY_POLICY.sameShare ? 'same' : share < CONTINUITY_POLICY.differentShare ? 'different' : 'unclear';
  return { verdict, compared, matched };
}

// ── what the served import is ─────────────────────────────────────────────────

/** The save whose league is imported now, as far as its history needs it. */
export interface ServedSave {
  /** `saveId` of its `<save>.lg` folder (of the export folder when no save folder encloses it); '' when none is known. */
  folderId: string;
  /** The folder it was identified by; null when none is known. */
  folderPath: string | null;
  /** Its name as the folder gives it (or as configured). */
  name: string;
  /** The name its history was filed under before D-064: the configured name when the configuration is this save's. */
  legacyName: string;
}

/**
 * The save of the league being served: the export folder the served import read (its own record, N3.5), else the
 * configured one (an import by the earlier build records no folder). The configured save is not trusted while a newly
 * chosen save's import has not yet replaced the served league: the history read is the league's being shown.
 */
export function servedSave(): ServedSave {
  const config = loadConfig();
  const recorded = importRecord()?.csvDir;
  const csvDir = typeof recorded === 'string' && recorded ? recorded : config.csvDir;
  const configuredName = config.saveName ?? 'unknown';
  if (!csvDir) return { folderId: '', folderPath: null, name: configuredName, legacyName: configuredName };
  const location = locateSave({ csvDir });
  // A save folder that can't be seen just now (a drive not mounted) keeps its identity: OOTP's layout names it
  const csv = path.resolve(csvDir);
  const byLayout = path.basename(csv).toLowerCase() === 'csv' && path.basename(path.dirname(csv)).toLowerCase() === 'import_export'
    && path.dirname(path.dirname(csv)).toLowerCase().endsWith('.lg') ? path.dirname(path.dirname(csv)) : null;
  const folderPath = location.lgPath ?? byLayout ?? csv;
  const name = location.saveName ?? (byLayout ? path.basename(byLayout).replace(/\.lg$/i, '') : configuredName);
  const sameAsConfigured = config.csvDir !== null && path.resolve(config.csvDir) === path.resolve(csvDir);
  return { folderId: saveId(folderPath), folderPath, name, legacyName: sameAsConfigured ? configuredName : name };
}

/** The imported league's players, id to name; null when the league has no players table or no names. */
export function leaguePlayerNames(): Map<number, string> | null {
  if (!tableExists('players')) return null;
  const columns = new Set(tableColumns('players'));
  if (!['player_id', 'first_name', 'last_name'].every((c) => columns.has(c))) return null;
  const out = new Map<number, string>();
  for (const r of leagueDb.prepare(`SELECT player_id, first_name || ' ' || last_name AS name FROM players`).all() as Array<{ player_id: unknown; name: unknown }>) {
    const id = Number(r.player_id);
    const name = normalName(r.name);
    if (Number.isFinite(id) && name !== null) out.set(id, name);
  }
  return out;
}

/** A save's players as its export's `players.csv` names them, id to name; null when the file or its columns can't be read. */
export function playerNamesInExport(csvDir: string): Map<number, string> | null {
  let text: string;
  try {
    const buf = fs.readFileSync(path.join(csvDir, 'players.csv'));
    text = buf.toString('utf8');
    if (text.includes('�')) text = buf.toString('latin1');
  } catch {
    return null;
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerLine = lines.find((l) => l.trim() !== '');
  if (!headerLine) return null;
  const delimiter = delimiterOf(headerLine);
  const header = splitLine(headerLine, delimiter).map((h) => h.trim());
  const [id, first, last] = [header.indexOf('player_id'), header.indexOf('first_name'), header.indexOf('last_name')];
  if (id < 0 || first < 0 || last < 0) return null;
  const out = new Map<number, string>();
  for (const line of lines.slice(lines.indexOf(headerLine) + 1)) {
    if (line.trim() === '') continue;
    const f = splitLine(line, delimiter);
    const pid = Number(f[id]);
    const name = normalName(`${f[first] ?? ''} ${f[last] ?? ''}`);
    if (Number.isFinite(pid) && name !== null) out.set(pid, name);
  }
  return out;
}

/**
 * Which import the served league is: its own record's start, else the start `last-import.json` names (every build
 * writes it), else ''. A date of the name-keyed history left unused against one import is looked at again against the
 * next (the league compared with may have been another save's while a newly chosen save's first import ran).
 */
export function servedImportStamp(): string {
  const started = importRecord()?.startedAt;
  if (typeof started === 'string') return started;
  try {
    const parsed = JSON.parse(fs.readFileSync(LAST_IMPORT_PATH, 'utf8')) as { startedAt?: unknown };
    return typeof parsed.startedAt === 'string' ? parsed.startedAt : '';
  } catch {
    return '';
  }
}

// ── the registry ──────────────────────────────────────────────────────────────

/** Why a save's history began where it did. */
export type HistoryOrigin =
  /** A save seen for the first time. */
  | 'new'
  /** A save moved or renamed in OOTP: its earlier folder's history, whose players it has, followed it. */
  | 'moved'
  /** Its folder's history had other players (a different league now in that folder): started fresh. */
  | 'fresh_new_league'
  /** More than one earlier history, each of a folder that has gone, had its players: started fresh rather than guess. */
  | 'fresh_moved_unclear';

export interface HistorySave {
  saveKey: string;
  folderId: string;
  folderPath: string | null;
  saveName: string | null;
  bound: boolean;
  origin: HistoryOrigin;
  createdAt: string;
  lastSeenAt: string;
}

interface RegistryRow {
  save_key: string; folder_id: string; folder_path: string | null; save_name: string | null; bound: number; origin: string; created_at: string; last_seen_at: string;
}

const toRecord = (r: RegistryRow): HistorySave => ({
  saveKey: r.save_key, folderId: r.folder_id, folderPath: r.folder_path, saveName: r.save_name, bound: r.bound === 1,
  origin: r.origin as HistoryOrigin, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
});

/** The registry's record of a history key; null when there is none. */
export function historySave(saveKey: string): HistorySave | null {
  const r = historyDb.prepare(`SELECT * FROM history_saves WHERE save_key = ?`).get(saveKey) as RegistryRow | undefined;
  return r ? toRecord(r) : null;
}

/** Game dates in the order the game played them (the export writes them unpadded). */
const byGameDate = (a: string, b: string): number => (parseGameDate(a) ?? a).localeCompare(parseGameDate(b) ?? b);

/** A key's latest snapshot date (as filed), or null when it has none. */
function latestDateOf(saveKey: string): string | null {
  const dates = (historyDb.prepare(`SELECT DISTINCT game_date FROM save_rating_snapshots WHERE save_key = ?`).all(saveKey) as Array<{ game_date: string }>)
    .map((r) => r.game_date).sort(byGameDate);
  return dates.at(-1) ?? null;
}

/** Whether a key's latest snapshot shows the same league as `names`. */
function continuityWithKey(saveKey: string, names: ReadonlyMap<number, string> | null): Continuity {
  const latest = latestDateOf(saveKey);
  if (latest === null) return { verdict: 'no_evidence', compared: 0, matched: 0 };
  const rows = historyDb.prepare(`SELECT player_id, name FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?`).all(saveKey, latest) as Array<{ player_id: number; name: string | null }>;
  return continuityOf(rows, names);
}

/** Seams for the tests: which saves are known, whether a folder is there, and a hook before each legacy date. */
export const historyIdentityDeps = {
  knownSaves: (): SaveInfo[] => detectSaves(os.homedir(), 'times'),
  folderExists: (p: string): boolean => fs.existsSync(p),
  /** Called before each legacy date is brought over (a test throws here to stand for a crash part way through). */
  beforeLegacyDate: (_date: string): void => {},
};

/**
 * The history key of a save, found or made. In one immediate transaction, so two threads resolving at once (the
 * server's and the snapshot worker's) agree: the second waits and finds the first's answer.
 */
export function resolveHistoryKey(save: ServedSave, names: () => ReadonlyMap<number, string> | null = lazyNames()): string {
  const resolve = historyDb.transaction((): string => {
    const now = new Date().toISOString();
    const touch = (key: string) =>
      historyDb.prepare(`UPDATE history_saves SET folder_id = ?, folder_path = ?, save_name = ?, last_seen_at = ? WHERE save_key = ?`)
        .run(save.folderId, save.folderPath, save.name, now, key);
    const bound = historyDb.prepare(`SELECT * FROM history_saves WHERE folder_id = ? AND bound = 1`).get(save.folderId) as RegistryRow | undefined;
    if (bound) {
      const c = continuityWithKey(bound.save_key, names());
      if (c.verdict === 'same' || c.verdict === 'no_evidence') {
        touch(bound.save_key);
        return bound.save_key;
      }
      // Another league now lives in this folder: its history is not this one's
      historyDb.prepare(`UPDATE history_saves SET bound = 0 WHERE save_key = ?`).run(bound.save_key);
      return createKey(save, 'fresh_new_league', now);
    }
    // A save moved or renamed: an earlier history whose folder has gone, that is not later than this league's date (a
    // save never goes back in time), and whose players this league has
    if (save.folderPath !== null) {
      const today = parseGameDate(snapshotGameDate());
      const notLater = (key: string): boolean => {
        const latest = parseGameDate(latestDateOf(key));
        return latest !== null && (today === null || latest <= today);
      };
      const gone = (historyDb.prepare(`SELECT * FROM history_saves WHERE bound = 1 AND folder_id != ?`).all(save.folderId) as RegistryRow[])
        .filter((r) => r.folder_path !== null && !historyIdentityDeps.folderExists(r.folder_path) && notLater(r.save_key));
      const same = gone.filter((r) => continuityWithKey(r.save_key, names()).verdict === 'same');
      if (same.length === 1) {
        historyDb.prepare(`UPDATE history_saves SET origin = 'moved' WHERE save_key = ?`).run(same[0].save_key);
        touch(same[0].save_key);
        return same[0].save_key;
      }
      if (same.length > 1) return createKey(save, 'fresh_moved_unclear', now);
    }
    return createKey(save, 'new', now);
  });
  return resolve.immediate();
}

function createKey(save: ServedSave, origin: HistoryOrigin, now: string): string {
  const base = `save-${save.folderId || 'none'}`;
  const taken = new Set((historyDb.prepare(`SELECT save_key FROM history_saves WHERE save_key = ? OR save_key LIKE ?`).all(base, `${base}-%`) as Array<{ save_key: string }>).map((r) => r.save_key));
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  historyDb.prepare(
    `INSERT INTO history_saves (save_key, folder_id, folder_path, save_name, bound, origin, created_at, last_seen_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(key, save.folderId, save.folderPath, save.name, origin, now, now);
  return key;
}

function lazyNames(): () => ReadonlyMap<number, string> | null {
  let names: ReadonlyMap<number, string> | null | undefined;
  return () => (names === undefined ? (names = leaguePlayerNames()) : names);
}

// ── the current key ───────────────────────────────────────────────────────────

let cached: { signature: string; key: string } | null = null;

/** What the key depends on: the served league (its generation and import) and the configured save. */
function signature(): string {
  const config = loadConfig();
  const started = importRecord()?.startedAt;
  return JSON.stringify([databaseGeneration(), typeof started === 'string' ? started : null, config.csvDir, config.saveName]);
}

/**
 * The history key of the save being served: every reader and writer of rating history files it under this (D-064).
 * Resolved once per import and configuration; on the server's own thread the name-keyed history is reviewed for it
 * then too (`reviewLegacyHistory`). A worker only resolves: the review, and the backup before it, stay on one thread.
 */
export function currentHistoryKey(): string {
  const sig = signature();
  if (cached?.signature === sig) return cached.key;
  const save = servedSave();
  const names = lazyNames();
  const key = resolveHistoryKey(save, names);
  cached = { signature: sig, key };
  if (isMainThread) {
    try {
      reviewLegacyHistory(key, save, names);
    } catch (err) {
      console.warn('[history] the earlier rating history was not brought over this time:', (err as Error).message);
    }
  }
  return key;
}

/** Forgets the resolved key: a test changed the save or rebuilt its league in place. */
export function forgetHistoryKey(): void {
  cached = null;
}

// ── the name-keyed history written before D-064 ───────────────────────────────

export type LegacyVerdict = 'attributed' | 'another_save' | 'unattributed';

/** Why a date of the name-keyed history was or wasn't brought over. */
export type LegacyReason =
  /** Its rows have this league's players, and no other known save of that name's do. */
  | 'matched'
  /** Its rows have other players: another save's, kept apart. */
  | 'different_league'
  /** Its rows only partly have this league's players (two saves' rows mixed on one date, perhaps). */
  | 'unclear'
  /** Too few of its players are in this league to say. */
  | 'no_evidence'
  /** It is later than this league's own date, so it is not this save's past. */
  | 'after_league_date'
  /** Another known save of the same name has these players too. */
  | 'twin_matches'
  /** Another known save of the same name has an export that couldn't be read. */
  | 'twin_unreadable';

export interface LegacyDecision {
  verdict: LegacyVerdict;
  reason: LegacyReason;
  /** The rows brought over: this date's players who are in this league under the same name. */
  playerIds: number[];
  compared: number;
  matched: number;
}

/**
 * What to do with one date of the name-keyed history, given this league's players, its date, and the players of every
 * other known save carrying that name that has an export (null for one whose export couldn't be read). Pure.
 */
export function decideLegacyDate(input: {
  date: string;
  rows: ReadonlyArray<{ player_id: unknown; name: unknown }>;
  names: ReadonlyMap<number, string> | null;
  leagueDate: string | null;
  twins: () => ReadonlyArray<ReadonlyMap<number, string> | null>;
}): LegacyDecision {
  const c = continuityOf(input.rows, input.names);
  const none = (verdict: LegacyVerdict, reason: LegacyReason): LegacyDecision => ({ verdict, reason, playerIds: [], compared: c.compared, matched: c.matched });
  if (c.verdict === 'different') return none('another_save', 'different_league');
  if (c.verdict === 'unclear') return none('unattributed', 'unclear');
  if (c.verdict === 'no_evidence') return none('unattributed', 'no_evidence');
  const date = parseGameDate(input.date);
  const today = parseGameDate(input.leagueDate);
  if (date === null || (today !== null && date > today)) return none('unattributed', 'after_league_date');
  for (const twin of input.twins()) {
    if (twin === null) return none('unattributed', 'twin_unreadable');
    const t = continuityOf(input.rows, twin);
    if (t.verdict !== 'different') return none('unattributed', 'twin_matches');
  }
  const playerIds = input.rows
    .filter((r) => { const n = input.names!.get(Number(r.player_id)); return n !== undefined && n === normalName(r.name); })
    .map((r) => Number(r.player_id));
  return { verdict: 'attributed', reason: 'matched', playerIds, compared: c.compared, matched: c.matched };
}

/** Where the copy of `history.db` made before the first row is brought over goes. */
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_PREFIX = 'history-before-save-identity-';

/** Why the name-keyed history was not reviewed at this start (the backup failed); null when it was. */
export const legacyState: { backupFailed: string | null } = { backupFailed: null };

/** The backup made before the first row was brought over, or null when none has been made. */
export function legacyBackupPath(): string | null {
  const r = historyDb.prepare(`SELECT value FROM history_identity_meta WHERE key = 'legacy_backup'`).get() as { value: string } | undefined;
  return r?.value ?? null;
}

/**
 * A copy of `history.db` in `backups/`, made once, before the first row is brought over. Written under a temporary
 * name and renamed, so a copy cut short is never taken for a backup; one left by a crash is removed. True when there is
 * a backup.
 */
function ensureLegacyBackup(): boolean {
  if (legacyBackupPath()) return true;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    for (const f of fs.readdirSync(BACKUP_DIR)) if (f.startsWith(BACKUP_PREFIX) && f.endsWith('.partial')) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const final = path.join(BACKUP_DIR, `${BACKUP_PREFIX}${stamp}.db`);
    const partial = `${final}.partial`;
    historyDb.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
    fs.renameSync(partial, final);
    historyDb.prepare(`INSERT OR REPLACE INTO history_identity_meta (key, value) VALUES ('legacy_backup', ?)`).run(final);
    legacyState.backupFailed = null;
    return true;
  } catch (err) {
    legacyState.backupFailed = (err as Error).message;
    return false;
  }
}

const CHUNK = 500;

/**
 * Reviews the name-keyed history for a save: every date filed under its earlier name that has not been reviewed for
 * it is brought over (its certainly-own rows, and its rating-kind stamp) or left, and the decision recorded. Each date
 * is one transaction with its record, so a crash part way through leaves every date either done or not, and the next
 * review carries on. Idempotent: a date brought over is final, one left unused is looked at again only against another
 * import (the league it was compared with may not have been this save's), and nothing is copied twice.
 */
export function reviewLegacyHistory(saveKey: string, save: ServedSave, names: () => ReadonlyMap<number, string> | null = lazyNames()): void {
  const stamp = servedImportStamp();
  // Pending: never reviewed for this save, or left unused against another import than the served one
  const pending = (historyDb.prepare(
    `SELECT DISTINCT game_date FROM rating_snapshots WHERE save_name = ?
     EXCEPT SELECT game_date FROM history_legacy_review
       WHERE save_key = ? AND legacy_name = ? AND (verdict = 'attributed' OR COALESCE(league_import, '') = ?)`
  ).all(save.legacyName, saveKey, save.legacyName, stamp) as Array<{ game_date: string }>).map((r) => r.game_date).sort(byGameDate);
  if (pending.length === 0) return;
  // No league to compare with (nothing imported yet): nothing is decided, and it is looked at again later
  if (names() === null) return;
  if (!ensureLegacyBackup()) return;
  const leagueDate = snapshotGameDate();
  let twins: Array<ReadonlyMap<number, string> | null> | undefined;
  const twinNames = () => (twins ??= historyIdentityDeps.knownSaves()
    .filter((s) => s.name === save.legacyName && saveId(s.lgPath) !== save.folderId && s.hasExport !== false)
    .map((s) => (s.hasExport ? playerNamesInExport(s.csvDir) : null)));
  const columns = SNAPSHOT_DATA_COLUMNS.join(', ');
  const rowsOf = historyDb.prepare(`SELECT player_id, name FROM rating_snapshots WHERE save_name = ? AND game_date = ?`);
  const reviewed = historyDb.prepare(
    `SELECT 1 FROM history_legacy_review WHERE save_key = ? AND legacy_name = ? AND game_date = ? AND (verdict = 'attributed' OR COALESCE(league_import, '') = ?)`
  );
  const record = historyDb.prepare(
    `INSERT OR REPLACE INTO history_legacy_review
       (save_key, legacy_name, game_date, verdict, reason, rows_total, rows_attributed, compared, matched, league_import, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const copyMode = historyDb.prepare(
    `INSERT OR IGNORE INTO save_rating_snapshot_modes (save_key, game_date, mode, additional_scouted, source, import_started_at, recorded_at)
     SELECT ?, game_date, mode, additional_scouted, source, import_started_at, recorded_at FROM rating_snapshot_modes WHERE save_name = ? AND game_date = ?`
  );
  for (const date of pending) {
    historyIdentityDeps.beforeLegacyDate(date);
    const rows = rowsOf.all(save.legacyName, date) as Array<{ player_id: number; name: string | null }>;
    const decision = decideLegacyDate({ date, rows, names: names(), leagueDate, twins: twinNames });
    historyDb.transaction(() => {
      if (reviewed.get(saveKey, save.legacyName, date, stamp)) return;
      let copied = 0;
      for (let at = 0; at < decision.playerIds.length; at += CHUNK) {
        const chunk = decision.playerIds.slice(at, at + CHUNK);
        copied += historyDb.prepare(
          `INSERT OR IGNORE INTO save_rating_snapshots (save_key, ${columns})
           SELECT ?, ${columns} FROM rating_snapshots WHERE save_name = ? AND game_date = ? AND player_id IN (${chunk.map(() => '?').join(', ')})`
        ).run(saveKey, save.legacyName, date, ...chunk).changes;
      }
      if (decision.playerIds.length > 0) copyMode.run(saveKey, save.legacyName, date);
      record.run(saveKey, save.legacyName, date, decision.verdict, decision.reason, rows.length, copied, decision.compared, decision.matched, stamp, new Date().toISOString());
    }).immediate();
  }
}

// ── what is said about it ─────────────────────────────────────────────────────

export interface HistoryNote {
  /** One plain sentence when some of this save's rating history is not used or started fresh; null when all is well. */
  note: string | null;
  /** The basis: each part of the name-keyed history and what became of it, and why the history began where it did. */
  because: string[];
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const REASON_WORDS: Record<LegacyReason, string> = {
  matched: 'had this save\'s players',
  different_league: 'had another league\'s players, so they belong to another save of the same name',
  unclear: 'only partly had this save\'s players',
  no_evidence: 'had too few of this save\'s players to tell',
  after_league_date: 'were later than this save\'s own date',
  twin_matches: 'had players another save of the same name also has',
  twin_unreadable: 'couldn\'t be checked against another save of the same name, whose export couldn\'t be read',
};

/** What the data status and the development pages say about this save's rating history (D-064). */
export function historyNote(saveKey: string = currentHistoryKey()): HistoryNote {
  const record = historySave(saveKey);
  const reviews = historyDb.prepare(
    `SELECT verdict, reason, COUNT(*) AS dates, SUM(rows_total) AS total, SUM(rows_attributed) AS attributed
     FROM history_legacy_review WHERE save_key = ? GROUP BY verdict, reason`
  ).all(saveKey) as Array<{ verdict: LegacyVerdict; reason: LegacyReason; dates: number; total: number; attributed: number }>;
  const sentences: string[] = [];
  const because: string[] = [];
  if (record?.origin === 'fresh_new_league') {
    sentences.push('This save\'s rating history starts fresh: its players don\'t match the history kept for its folder.');
    because.push('The save in this folder has different players from the rating history kept for it, so that history belongs to another league.');
  } else if (record?.origin === 'fresh_moved_unclear') {
    sentences.push('This save\'s rating history starts fresh: more than one earlier save could have been this one.');
    because.push('More than one save whose folder has gone had these players, so none of their histories is taken as this one\'s.');
  } else if (record?.origin === 'moved') {
    because.push('This save\'s rating history followed it from the folder it was in before.');
  }
  const unattributed = reviews.filter((r) => r.verdict === 'unattributed');
  const leftDates = unattributed.reduce((n, r) => n + r.dates, 0);
  if (leftDates > 0) {
    sentences.push(`Rating history from ${plural(leftDates, 'earlier import')} couldn't be matched to this save for sure, so it isn't used.`);
  }
  for (const r of reviews) {
    const lead = r.verdict === 'attributed' ? 'Brought over' : r.verdict === 'another_save' ? 'Kept apart' : 'Not used';
    because.push(`${lead}: ${plural(r.dates, 'earlier import')} filed under this save's name ${REASON_WORDS[r.reason]}.`);
  }
  if (legacyState.backupFailed) {
    sentences.push('Earlier rating history hasn\'t been brought over yet: Pennant couldn\'t back it up first, and tries again at the next start.');
    because.push(`The backup failed: ${legacyState.backupFailed}`);
  }
  return { note: sentences.length ? sentences.join(' ') : null, because };
}
