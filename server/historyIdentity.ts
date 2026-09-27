/**
 * Which save a piece of rating history belongs to (D-064).
 *
 * Rating history used to be filed under the save's NAME (`config.saveName`). OOTP names every new league "New Game",
 * one Mac can hold several saves of one name (N3.5 found two), and switching between two of them compared one
 * league's ratings with another's and read the difference as development. This module gives each save's history a
 * key of its own, decides which of the name-keyed rows written before it are certainly that save's, and asks the GM
 * rather than guessing when a save might be one that moved.
 *
 * **A save's history key is its folder: one folder, one history.** The folder is identified as the save list
 * identifies it (D-063, `saveId`: the `<save>.lg` folder's real path, hashed). Pennant restarting, a re-import, or a
 * save of the same name elsewhere changes nothing about which history is read; two saves that share a name are two
 * folders, so two histories.
 *
 * **The players test only ever refuses.** When the league served is certainly the configured save's, the key bound to
 * its folder is checked against it (`continuityOf`): players that read as a different league, or unclear, or a league
 * at an earlier date than the history already holds (a save deleted and made again in the folder, or restored from an
 * OOTP backup), start a fresh history and say so, and the earlier one is never written over. The test never joins two
 * histories.
 *
 * **A moved or renamed save is asked about, never adopted.** A save with no history of its own yet, when another
 * history's folder has gone (really gone: missing inside a folder that can be read; a drive not mounted is not gone)
 * and the players test doesn't rule it out, is served an offer; the GM's answer is recorded, and only "yes" re-binds
 * that history to this folder.
 *
 * What it cannot tell apart: a save deleted and made again in the same folder from the same real-life database with a
 * date no earlier than its history (its players read the same); and a save whose history holds too few of the league's
 * players to compare keeps appending, since no evidence is never read as a refusal. The per-save fits keep D-053's
 * identity (`saveIdentity.ts`: the name and a fingerprint of the league), a second, older definition used only for
 * them. Nothing here parses OOTP's own save files.
 *
 * The name-keyed history written before D-064 is brought over only where certain (D-018): a date whose rows have this
 * league's players, not later than its date, under a name no other known save carries; then only the rows of players
 * the league still has under the same name. The rest stay where they are, unused, and the data status says so. A copy
 * of `history.db` is made in `backups/` before the first row is brought over.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { databaseGeneration, db as leagueDb, importRecord, LAST_IMPORT_PATH, tableColumns, tableExists } from './db.js';
import { APP_ROOT, DATA_DIR, loadConfig } from './config.js';
import { parseGameDate } from './dataFreshness.js';
import { historyDb, SNAPSHOT_DATA_COLUMNS, snapshotGameDate } from './history.js';
import { locateSave } from './ootpSave.js';
import { findSaves, saveId, type SaveInfo } from './paths.js';

// ── the policy ────────────────────────────────────────────────────────────────

/**
 * When two sets of players are the same league's (a stated policy line, not a fit). Players are compared by id and
 * name, only where both sides have the id: a player since deleted from the league is not evidence either way.
 *
 * One league keeps its players' names (they change only if the GM edits one): on the owner's own history every
 * earlier snapshot matched its save's export by every name it shared. Two fictional leagues' ids name different
 * people, so their share sits near 0. Two leagues started from the same real-life database share every real player's
 * id and name and differ only in the players each generated: on the owner's saves 98.9% to 99.8% of shared players
 * matched across different saves. The line is 999 in 1,000. It only ever REFUSES (starts a fresh history, keeps a date
 * out, rules out an offer); it never joins two histories, so its thin margin over real-database twins can cost a fresh
 * start, never a mix.
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
 * configured one (an import by the earlier build records no folder; `servedLeagueCertain` says whether that is safe).
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
  const sameAsConfigured = config.csvDir !== null && path.resolve(config.csvDir) === csv;
  return { folderId: saveId(folderPath), folderPath, name, legacyName: sameAsConfigured ? configuredName : name };
}

const mtimeOf = (p: string): number | null => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
};

/**
 * Whether the league served is certainly the save `servedSave` names. Certain when the import's own record names its
 * export folder (every import by this build), or when no save is configured; otherwise (an import by the earlier
 * build, which names no folder) only when the configuration has not changed since that import: a save chosen after it
 * is not the league being served until its own import lands. While it is not certain, no snapshot is taken for the
 * save, no history is refused against the league, and no earlier history is reviewed.
 */
export function servedLeagueCertain(): boolean {
  const recorded = importRecord()?.csvDir;
  if (typeof recorded === 'string' && recorded) return true;
  if (!loadConfig().csvDir) return true;
  const configAt = mtimeOf(path.join(DATA_DIR, 'config.json')) ?? mtimeOf(path.join(APP_ROOT, 'config.json'));
  const importAt = mtimeOf(LAST_IMPORT_PATH);
  return configAt !== null && importAt !== null && configAt <= importAt;
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

/**
 * Which import the served league is: its own record's start, else the start `last-import.json` names (every build
 * writes it), else ''. A date of the name-keyed history left unused against one import is looked at again against the
 * next.
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
  /** A folder seen for the first time. */
  | 'new'
  /** Its folder's history had other players (a different league now in that folder), or unclear ones: started fresh. */
  | 'fresh_new_league'
  /** Its folder's history runs later than this league's date (a save made again, or restored): started fresh. */
  | 'fresh_went_back'
  /** The GM said this save is the one that used to be elsewhere: that history was carried over to this folder. */
  | 'adopted';

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

/** A key's snapshot dates (as filed), oldest first. */
function datesOf(saveKey: string): string[] {
  return (historyDb.prepare(`SELECT DISTINCT game_date FROM save_rating_snapshots WHERE save_key = ?`).all(saveKey) as Array<{ game_date: string }>)
    .map((r) => r.game_date).sort(byGameDate);
}

/** Whether a key's latest snapshot shows the same league as `names`. */
function continuityWithKey(saveKey: string, names: ReadonlyMap<number, string> | null): Continuity {
  const latest = datesOf(saveKey).at(-1);
  if (latest === undefined) return { verdict: 'no_evidence', compared: 0, matched: 0 };
  const rows = historyDb.prepare(`SELECT player_id, name FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?`).all(saveKey, latest) as Array<{ player_id: number; name: string | null }>;
  return continuityOf(rows, names);
}

/** Whether a key's history runs later than the league's own date (a save never goes back in time). */
function laterThanLeague(saveKey: string): boolean {
  const latest = parseGameDate(datesOf(saveKey).at(-1) ?? null);
  const today = parseGameDate(snapshotGameDate());
  return latest !== null && today !== null && latest > today;
}

/** Whether a folder is there, has really gone (missing inside a folder that can be read), or can't be told. */
export type FolderState = 'present' | 'gone' | 'unknown';

function folderStateOf(p: string): FolderState {
  try {
    fs.statSync(p);
    return 'present';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return 'unknown';
  }
  try {
    fs.readdirSync(path.dirname(p));
    return 'gone';
  } catch {
    // Its parent can't be read either: a drive not mounted, a folder without permission. Not gone
    return 'unknown';
  }
}

/** Seams for the tests: which saves are known, whether a folder is there, and a hook before each legacy date. */
export const historyIdentityDeps = {
  knownSaves: (): { saves: SaveInfo[]; unreadable: string[] } => findSaves(os.homedir(), 'times'),
  folderState: folderStateOf,
  /** Called before each legacy date is brought over (a test throws here to stand for a crash part way through). */
  beforeLegacyDate: (_date: string): void => {},
};

/**
 * The history key of a save, found or made. In one immediate transaction, so two threads resolving at once (the
 * server's and the snapshot worker's) agree. The players test runs only when the league is certainly this save's, and
 * only refuses: a fresh history, never another folder's.
 */
export function resolveHistoryKey(save: ServedSave, names: () => ReadonlyMap<number, string> | null = lazyNames(), certain = true): string {
  const resolve = historyDb.transaction((): string => {
    const now = new Date().toISOString();
    const bound = historyDb.prepare(`SELECT * FROM history_saves WHERE folder_id = ? AND bound = 1`).get(save.folderId) as RegistryRow | undefined;
    if (!bound) return createKey(save, 'new', now);
    if (certain) {
      const c = continuityWithKey(bound.save_key, names());
      const refuse: HistoryOrigin | null =
        c.verdict === 'different' || c.verdict === 'unclear' ? 'fresh_new_league'
          : laterThanLeague(bound.save_key) ? 'fresh_went_back'
            : null;
      if (refuse) {
        historyDb.prepare(`UPDATE history_saves SET bound = 0 WHERE save_key = ?`).run(bound.save_key);
        return createKey(save, refuse, now);
      }
    }
    historyDb.prepare(`UPDATE history_saves SET folder_path = ?, save_name = ?, last_seen_at = ? WHERE save_key = ?`)
      .run(save.folderPath, save.name, now, bound.save_key);
    return bound.save_key;
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
  return JSON.stringify([databaseGeneration(), servedImportStamp(), config.csvDir, config.saveName]);
}

/**
 * The history key of the save being served: every reader and writer of rating history files it under this (D-064).
 * Resolved once per import and configuration; on the server's own thread the name-keyed history is reviewed for it
 * then too, when the league is certainly this save's. A worker only resolves.
 */
export function currentHistoryKey(): string {
  const sig = signature();
  if (cached?.signature === sig) return cached.key;
  const save = servedSave();
  const names = lazyNames();
  const certain = servedLeagueCertain();
  const key = resolveHistoryKey(save, names, certain);
  cached = { signature: sig, key };
  if (isMainThread && certain) {
    try {
      reviewLegacyHistory(key, save, names);
      legacyState.reviewFailed = null;
    } catch (err) {
      legacyState.reviewFailed = (err as Error).message;
      console.warn('[history] the earlier rating history was not all brought over this time:', legacyState.reviewFailed);
    }
  }
  return key;
}

/** Forgets the resolved key: a test changed the save or rebuilt its league in place. */
export function forgetHistoryKey(): void {
  cached = null;
}

// ── asking about a save that moved ────────────────────────────────────────────

/** A history that could be this save's, whose folder has gone: served as a question, never taken without a yes. */
export interface HistoryOffer {
  /** The candidate history's key (what the answer names). */
  id: string;
  /** The name that save last had, and where it was. */
  saveName: string | null;
  folderPath: string | null;
  /** Its latest snapshot date (as filed) and how many dates it holds. */
  lastDate: string | null;
  dates: number;
  /** How its players compare with this league's. */
  continuity: Continuity;
}

/**
 * The histories this save could be asked about (D-064): only while it has no history of its own (at most the one
 * snapshot of its first import here), its league is certainly this save's, and the GM hasn't answered. A candidate is
 * a history still bound to a folder that has really gone, not later than this league, whose players the test doesn't
 * rule out (same, or too few to tell).
 */
export function historyOffers(saveKey: string = currentHistoryKey()): HistoryOffer[] {
  if (!servedLeagueCertain()) return [];
  if (datesOf(saveKey).length > 1) return [];
  const answered = historyDb.prepare(`SELECT candidate_key, choice FROM history_offer_choices WHERE save_key = ?`).all(saveKey) as Array<{ candidate_key: string; choice: string }>;
  if (answered.some((a) => a.choice === 'adopt' || a.candidate_key === '*')) return [];
  const own = historySave(saveKey);
  const names = leaguePlayerNames();
  const out: HistoryOffer[] = [];
  for (const r of historyDb.prepare(`SELECT * FROM history_saves WHERE bound = 1 AND save_key != ? ORDER BY last_seen_at DESC`).all(saveKey) as RegistryRow[]) {
    if (r.folder_path === null || r.folder_id === own?.folderId) continue;
    if (historyIdentityDeps.folderState(r.folder_path) !== 'gone') continue;
    const dates = datesOf(r.save_key);
    if (dates.length === 0 || laterThanLeague(r.save_key)) continue;
    const continuity = continuityWithKey(r.save_key, names);
    if (continuity.verdict !== 'same' && continuity.verdict !== 'no_evidence') continue;
    out.push({ id: r.save_key, saveName: r.save_name, folderPath: r.folder_path, lastDate: dates.at(-1) ?? null, dates: dates.length, continuity });
  }
  return out;
}

/** An answer that no longer fits what is offered (answered already, or the history is no longer a candidate). */
export class HistoryChoiceRefusal extends Error {
  readonly status = 400;
}

/**
 * The GM's answer to an offer: `adopt` carries that history to this folder (this save's own snapshots join it) and
 * records the answer; `fresh` records that this save starts its own history, and nothing is offered again.
 */
export function answerHistoryOffer(offerId: string, choice: 'adopt' | 'fresh'): void {
  const saveKey = currentHistoryKey();
  const offers = historyOffers(saveKey);
  const now = new Date().toISOString();
  const record = historyDb.prepare(`INSERT OR REPLACE INTO history_offer_choices (save_key, candidate_key, choice, chosen_at) VALUES (?, ?, ?, ?)`);
  if (choice === 'fresh') {
    if (offers.length === 0) throw new HistoryChoiceRefusal('There is no question about this save\'s rating history to answer.');
    record.run(saveKey, '*', 'fresh', now);
    return;
  }
  const offer = offers.find((o) => o.id === offerId);
  if (!offer) throw new HistoryChoiceRefusal('That earlier save\'s rating history can\'t be carried over now.');
  const own = historySave(saveKey)!;
  const columns = SNAPSHOT_DATA_COLUMNS.join(', ');
  historyDb.transaction(() => {
    // This save's own snapshots (its first import here) join the history, then that history is bound to this folder
    historyDb.prepare(`INSERT OR REPLACE INTO save_rating_snapshots (save_key, ${columns}) SELECT ?, ${columns} FROM save_rating_snapshots WHERE save_key = ?`).run(offer.id, saveKey);
    historyDb.prepare(`DELETE FROM save_rating_snapshots WHERE save_key = ?`).run(saveKey);
    historyDb.prepare(
      `INSERT OR REPLACE INTO save_rating_snapshot_modes (save_key, game_date, mode, additional_scouted, source, import_started_at, recorded_at)
       SELECT ?, game_date, mode, additional_scouted, source, import_started_at, recorded_at FROM save_rating_snapshot_modes WHERE save_key = ?`
    ).run(offer.id, saveKey);
    historyDb.prepare(`DELETE FROM save_rating_snapshot_modes WHERE save_key = ?`).run(saveKey);
    historyDb.prepare(`UPDATE roster_state_snapshot_saves SET save_key = ? WHERE save_key = ?`).run(offer.id, saveKey);
    historyDb.prepare(`UPDATE OR IGNORE history_legacy_review SET save_key = ? WHERE save_key = ?`).run(offer.id, saveKey);
    historyDb.prepare(`DELETE FROM history_legacy_review WHERE save_key = ?`).run(saveKey);
    historyDb.prepare(`UPDATE history_dual_writes SET save_key = ? WHERE save_key = ?`).run(offer.id, saveKey);
    historyDb.prepare(`UPDATE history_saves SET bound = 0 WHERE save_key = ?`).run(saveKey);
    historyDb.prepare(`UPDATE history_saves SET folder_id = ?, folder_path = ?, save_name = ?, origin = 'adopted', last_seen_at = ? WHERE save_key = ?`)
      .run(own.folderId, own.folderPath, own.saveName, now, offer.id);
    record.run(saveKey, offer.id, 'adopt', now);
  }).immediate();
  forgetHistoryKey();
}

// ── the name-keyed history written before D-064 ───────────────────────────────

export type LegacyVerdict = 'attributed' | 'another_save' | 'unattributed';

/** Why a date of the name-keyed history was or wasn't brought over. */
export type LegacyReason =
  /** Its rows have this league's players, and no other known save carries the name. */
  | 'matched'
  /** Its rows have other players: another save's, kept apart. */
  | 'different_league'
  /** Its rows only partly have this league's players (two saves' rows mixed on one date, perhaps). */
  | 'unclear'
  /** Too few of its players are in this league to say. */
  | 'no_evidence'
  /** It is later than this league's own date, so it is not this save's past. */
  | 'after_league_date'
  /** Another known save carries the same name, so it could have written these rows. */
  | 'twin_exists'
  /** A folder where saves are kept couldn't be looked inside, so another save of the name can't be ruled out. */
  | 'saves_unreadable';

export interface LegacyDecision {
  verdict: LegacyVerdict;
  reason: LegacyReason;
  /** The rows brought over: this date's players who are in this league under the same name. */
  playerIds: number[];
  compared: number;
  matched: number;
}

/**
 * What to do with one date of the name-keyed history, given this league's players and its date, and how many other
 * known saves carry the name (null when that couldn't be told). Pure.
 */
export function decideLegacyDate(input: {
  date: string;
  rows: ReadonlyArray<{ player_id: unknown; name: unknown }>;
  names: ReadonlyMap<number, string> | null;
  leagueDate: string | null;
  otherCarriers: () => number | null;
}): LegacyDecision {
  const c = continuityOf(input.rows, input.names);
  const none = (verdict: LegacyVerdict, reason: LegacyReason): LegacyDecision => ({ verdict, reason, playerIds: [], compared: c.compared, matched: c.matched });
  if (c.verdict === 'different') return none('another_save', 'different_league');
  if (c.verdict === 'unclear') return none('unattributed', 'unclear');
  if (c.verdict === 'no_evidence') return none('unattributed', 'no_evidence');
  const date = parseGameDate(input.date);
  const today = parseGameDate(input.leagueDate);
  if (date === null || (today !== null && date > today)) return none('unattributed', 'after_league_date');
  const others = input.otherCarriers();
  if (others === null) return none('unattributed', 'saves_unreadable');
  if (others > 0) return none('unattributed', 'twin_exists');
  const playerIds = input.rows
    .filter((r) => { const n = input.names!.get(Number(r.player_id)); return n !== undefined && n === normalName(r.name); })
    .map((r) => Number(r.player_id));
  return { verdict: 'attributed', reason: 'matched', playerIds, compared: c.compared, matched: c.matched };
}

/** Where the copy of `history.db` made before the first row is brought over goes. */
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_PREFIX = 'history-before-save-identity-';

/** Why the name-keyed history was not (all) reviewed at the last look; null when it was. */
export const legacyState: { backupFailed: string | null; reviewFailed: string | null } = { backupFailed: null, reviewFailed: null };

/** The backup made before the first row was brought over, or null when none has been made. */
export function legacyBackupPath(): string | null {
  const r = historyDb.prepare(`SELECT value FROM history_identity_meta WHERE key = 'legacy_backup'`).get() as { value: string } | undefined;
  return r?.value ?? null;
}

/**
 * A copy of `history.db` in `backups/`, made once, before the first row is brought over. Written under a temporary
 * name and renamed, so a copy cut short is never taken for a backup (one left by a crash is removed); a finished copy
 * whose record was lost to a crash is recorded rather than made again. True when there is a backup.
 */
function ensureLegacyBackup(): boolean {
  if (legacyBackupPath()) return true;
  const remember = (file: string) => historyDb.prepare(`INSERT OR REPLACE INTO history_identity_meta (key, value) VALUES ('legacy_backup', ?)`).run(file);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(BACKUP_PREFIX));
    for (const f of files) if (f.endsWith('.partial')) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
    const finished = files.filter((f) => f.endsWith('.db')).sort();
    if (finished.length > 0) {
      remember(path.join(BACKUP_DIR, finished[0]));
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const final = path.join(BACKUP_DIR, `${BACKUP_PREFIX}${stamp}.db`);
      const partial = `${final}.partial`;
      historyDb.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
      fs.renameSync(partial, final);
      remember(final);
    }
    legacyState.backupFailed = null;
    return true;
  } catch (err) {
    legacyState.backupFailed = (err as Error).message;
    return false;
  }
}

const CHUNK = 500;

/**
 * Reviews the name-keyed history for a save: every date filed under its earlier name that this build did not write
 * itself and that has not been settled for it is brought over (its certainly-own rows, and its rating-kind stamp) or
 * left, and the decision recorded. Each date is one transaction with its record, so a crash part way through leaves
 * every date either done or not, and the next review carries on. A date brought over is final; one left unused is
 * looked at again only against another import; nothing is copied twice.
 */
export function reviewLegacyHistory(saveKey: string, save: ServedSave, names: () => ReadonlyMap<number, string> | null = lazyNames()): void {
  const stamp = servedImportStamp();
  const pending = (historyDb.prepare(
    `SELECT DISTINCT game_date FROM rating_snapshots WHERE save_name = ?
     EXCEPT SELECT game_date FROM history_dual_writes WHERE save_name = ?
     EXCEPT SELECT game_date FROM history_legacy_review
       WHERE save_key = ? AND legacy_name = ? AND (verdict = 'attributed' OR COALESCE(league_import, '') = ?)`
  ).all(save.legacyName, save.legacyName, saveKey, save.legacyName, stamp) as Array<{ game_date: string }>).map((r) => r.game_date).sort(byGameDate);
  if (pending.length === 0) return;
  // No league to compare with (nothing imported yet): nothing is decided, and it is looked at again later
  if (names() === null) return;
  if (!ensureLegacyBackup()) return;
  const leagueDate = snapshotGameDate();
  let carriers: number | null | undefined;
  const otherCarriers = (): number | null => {
    if (carriers !== undefined) return carriers;
    const known = historyIdentityDeps.knownSaves();
    carriers = known.unreadable.length > 0 ? null
      : known.saves.filter((s) => s.name === save.legacyName && saveId(s.lgPath) !== save.folderId).length;
    return carriers;
  };
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
    const decision = decideLegacyDate({ date, rows, names: names(), leagueDate, otherCarriers });
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
  twin_exists: 'could have come from another save with the same name',
  saves_unreadable: 'couldn\'t be checked, because a folder where saves are kept couldn\'t be looked inside',
};

/** What the data status and the development pages say about this save's rating history (D-064). */
export function historyNote(saveKey: string = currentHistoryKey()): HistoryNote {
  const record = historySave(saveKey);
  const reviews = historyDb.prepare(
    `SELECT verdict, reason, COUNT(*) AS dates FROM history_legacy_review WHERE save_key = ? GROUP BY verdict, reason`
  ).all(saveKey) as Array<{ verdict: LegacyVerdict; reason: LegacyReason; dates: number }>;
  const sentences: string[] = [];
  const because: string[] = [];
  if (record?.origin === 'fresh_new_league') {
    sentences.push('This save\'s rating history starts fresh: its players don\'t match the history kept for its folder.');
    because.push('The save in this folder has other players than the rating history kept for it, so that history is kept apart, not added to.');
  } else if (record?.origin === 'fresh_went_back') {
    sentences.push('This save\'s rating history starts fresh: its date is earlier than the history kept for its folder.');
    because.push('The history kept for this folder runs later than this save\'s own date, so it is kept apart, not written over.');
  } else if (record?.origin === 'adopted') {
    because.push(`You chose to carry over the rating history of the save last seen at ${record.folderPath ?? 'another folder'}.`);
  }
  const leftDates = reviews.filter((r) => r.verdict === 'unattributed').reduce((n, r) => n + r.dates, 0);
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
  } else if (legacyState.reviewFailed) {
    sentences.push('Earlier rating history couldn\'t all be brought over this time; Pennant tries again at the next start.');
    because.push(`Bringing it over stopped: ${legacyState.reviewFailed}`);
  }
  return { note: sentences.length ? sentences.join(' ') : null, because };
}
