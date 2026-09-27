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
 * **The GM decides, and nothing is lost for good.** Pennant never joins two histories by itself. It asks: a save with no
 * history of its own yet, when another history's folder has gone (really gone: missing inside a folder that can be read;
 * a drive not mounted is not gone) and the players test doesn't rule it out; and a save whose folder's history was just
 * refused ("continue that history, or keep the new start?"). The GM can also pick any other history (one set aside, or
 * another folder's, as after an OOTP upgrade copied the save) from a list that hides only another league's. Carrying a
 * history over COPIES its dates before this league's own date into this save's history, after a backup; the source is
 * never changed or unbound, the rows copied are recorded, and "Undo carry-over" removes exactly them.
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

/** A name written as UTF-8 and read as Latin-1 ("JosÃ©"), read back as written; any other name as it is. */
function unmisread(name: string): string {
  if (!/[\u00C2\u00C3]/.test(name)) return name;
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('\uFFFD') ? name : fixed;
}

/**
 * A name as the refusal path compares it (D-064): a misread accent undone, then case, accents, punctuation and
 * whitespace set aside (NFKD, marks stripped), so a handful of names written or read differently never refuses a
 * save's own history. Null for a name with an unreadable character (U+FFFD): it is not compared at all.
 */
export const looseName = (name: unknown): string | null => {
  const n = normalName(name);
  if (n === null || n.includes('\uFFFD')) return null;
  const s = unmisread(n).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};

/**
 * Whether snapshot rows show the same league as a set of players (id to name). `loose` (the refusal path and the lists
 * that only hide or rule out) compares names through `looseName`; otherwise (bringing earlier history over) as written.
 */
export function continuityOf(rows: Iterable<{ player_id: unknown; name: unknown }>, names: ReadonlyMap<number, string> | null, loose = false): Continuity {
  if (!names || names.size === 0) return { verdict: 'no_evidence', compared: 0, matched: 0 };
  const read = loose ? looseName : normalName;
  let compared = 0;
  let matched = 0;
  for (const row of rows) {
    const id = Number(row.player_id);
    const known = names.get(id);
    if (known === undefined) continue;
    const theirs = read(known);
    const ours = read(row.name);
    if (theirs === null || ours === null) continue;
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
  /** Whether it is the configured save (or neither the import nor the configuration names one). */
  configured: boolean;
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
  if (!csvDir) return { folderId: '', folderPath: null, name: configuredName, legacyName: configuredName, configured: true };
  const location = locateSave({ csvDir });
  // A save folder that can't be seen just now (a drive not mounted) keeps its identity: OOTP's layout names it
  const csv = path.resolve(csvDir);
  const byLayout = path.basename(csv).toLowerCase() === 'csv' && path.basename(path.dirname(csv)).toLowerCase() === 'import_export'
    && path.dirname(path.dirname(csv)).toLowerCase().endsWith('.lg') ? path.dirname(path.dirname(csv)) : null;
  const folderPath = location.lgPath ?? byLayout ?? csv;
  const name = location.saveName ?? (byLayout ? path.basename(byLayout).replace(/\.lg$/i, '') : configuredName);
  const sameAsConfigured = config.csvDir !== null && path.resolve(config.csvDir) === csv;
  return { folderId: saveId(folderPath), folderPath, name, legacyName: sameAsConfigured ? configuredName : name, configured: sameAsConfigured };
}

/**
 * The name this build also files a snapshot under for the earlier (Electron) build (D-064): the served save's own
 * earlier name, and only when the league served is certainly the configured save. Null otherwise (a save chosen with
 * one click right after an import, while its snapshots are still being taken): nothing is written under any name then.
 */
export function rollbackName(): string | null {
  const save = servedSave();
  return save.configured && servedLeagueCertain() ? save.legacyName : null;
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
  | 'fresh_went_back';

export interface HistorySave {
  saveKey: string;
  folderId: string;
  folderPath: string | null;
  saveName: string | null;
  bound: boolean;
  origin: HistoryOrigin;
  /** For a fresh start, the folder's history it set aside; null otherwise. */
  replaces: string | null;
  /** For a fresh start, the league's own date when it was made (a save that went back never carries a date from then on). */
  refusedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
}

interface RegistryRow {
  save_key: string; folder_id: string; folder_path: string | null; save_name: string | null; bound: number; origin: string;
  replaces: string | null; refused_at: string | null; created_at: string; last_seen_at: string;
}

const toRecord = (r: RegistryRow): HistorySave => ({
  saveKey: r.save_key, folderId: r.folder_id, folderPath: r.folder_path, saveName: r.save_name, bound: r.bound === 1,
  origin: r.origin as HistoryOrigin, replaces: r.replaces ?? null, refusedAt: r.refused_at ?? null, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
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

/** Whether a key's latest snapshot (at or before `through`, when given) shows the same league as `names`, loosely. */
function continuityWithKey(saveKey: string, names: ReadonlyMap<number, string> | null, through: string | null = null): Continuity {
  const limit = parseGameDate(through);
  const latest = datesOf(saveKey).filter((d) => { const p = parseGameDate(d); return limit === null || (p !== null && p <= limit); }).at(-1);
  if (latest === undefined) return { verdict: 'no_evidence', compared: 0, matched: 0 };
  const rows = historyDb.prepare(`SELECT player_id, name FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?`).all(saveKey, latest) as Array<{ player_id: number; name: string | null }>;
  return continuityOf(rows, names, true);
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
        return createKey(save, refuse, now, bound.save_key);
      }
    }
    historyDb.prepare(`UPDATE history_saves SET folder_path = ?, save_name = ?, last_seen_at = ? WHERE save_key = ?`)
      .run(save.folderPath, save.name, now, bound.save_key);
    return bound.save_key;
  });
  return resolve.immediate();
}

function createKey(save: ServedSave, origin: HistoryOrigin, now: string, replaces: string | null = null): string {
  const base = `save-${save.folderId || 'none'}`;
  const taken = new Set((historyDb.prepare(`SELECT save_key FROM history_saves WHERE save_key = ? OR save_key LIKE ?`).all(base, `${base}-%`) as Array<{ save_key: string }>).map((r) => r.save_key));
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  historyDb.prepare(
    `INSERT INTO history_saves (save_key, folder_id, folder_path, save_name, bound, origin, replaces, refused_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
  ).run(key, save.folderId, save.folderPath, save.name, origin, replaces, replaces ? snapshotGameDate() : null, now, now);
  return key;
}

/**
 * The key to file under now, given one resolved earlier: itself while still bound, else the key bound to its folder
 * since (a refusal on another thread), else null (nothing is filed). Called inside the writer's transaction.
 */
export function boundKeyNow(saveKey: string): string | null {
  const r = historyDb.prepare(`SELECT folder_id, bound FROM history_saves WHERE save_key = ?`).get(saveKey) as { folder_id: string; bound: number } | undefined;
  if (!r || r.bound === 1) return saveKey;
  const now = historyDb.prepare(`SELECT save_key FROM history_saves WHERE folder_id = ? AND bound = 1`).get(r.folder_id) as { save_key: string } | undefined;
  return now?.save_key ?? null;
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
  // Earlier history under the name is reviewed for a folder's first history only: a fresh start's earlier dates belong
  // to the history it set aside, which the GM can continue (one account, never two that disagree)
  if (isMainThread && certain && historySave(key)?.origin === 'new') {
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

// ── the GM decides: questions, the list of other histories, carrying over and undoing it ─────────

/** Why a history is offered: a save that might have moved, or this folder's own history set aside by a refusal. */
export type HistoryOfferKind = 'moved' | 'players_changed' | 'went_back';

/** How a history's players compare with this league's, for the GM: the same, unclear, or too few to tell. */
export type HistoryPlayers = 'same' | 'unclear' | 'too_few';

/** Another history this save could carry over: asked about (`historyOffers`) or listed (`historyCandidates`). */
export interface HistoryOffer {
  /** `<this save's key>:<that history's key>`: what an answer names, so it can't answer for another save. */
  id: string;
  kind: HistoryOfferKind | 'listed';
  /** That history's key. */
  source: string;
  /** The name that save last had, and where it was. */
  saveName: string | null;
  folderPath: string | null;
  /** Whether that folder is there now, has gone, or can't be told. */
  folderState: FolderState;
  /** Its latest snapshot date (as filed), how many dates it holds, and the latest one a carry-over would copy. */
  lastDate: string | null;
  dates: number;
  carriesThrough: string | null;
  players: HistoryPlayers;
  continuity: Continuity;
}

/** A carry-over in force, which the GM can undo. */
export interface HistoryCarryOver {
  /** `<this save's key>:carry:<n>`. */
  id: string;
  /** The history it copied from. */
  source: string;
  fromName: string | null;
  fromPath: string | null;
  throughDate: string | null;
  rows: number;
  carriedAt: string;
}

interface CarryRow {
  id: number; save_key: string; from_key: string; from_name: string | null; from_path: string | null; through_date: string | null;
  rows_copied: number; mode_dates: string; backup: string | null; carried_at: string; undone_at: string | null;
}

const offerId = (saveKey: string, source: string): string => `${saveKey}:${source}`;

/** The carry-overs in force for a save, most recent first. */
export function carryOvers(saveKey: string = currentHistoryKey()): HistoryCarryOver[] {
  return (historyDb.prepare(`SELECT * FROM history_carry_overs WHERE save_key = ? AND undone_at IS NULL ORDER BY id DESC`).all(saveKey) as CarryRow[])
    .map((c) => ({ id: `${saveKey}:carry:${c.id}`, source: c.from_key, fromName: c.from_name, fromPath: c.from_path, throughDate: c.through_date, rows: c.rows_copied, carriedAt: c.carried_at }));
}

/** A history as a possible carry-over into `saveKey`: its dates before the carry limit, and how its players compare. */
/**
 * The latest date a carry-over from `source` into `own` may copy, exclusive: this league's own date (the save files its
 * own snapshot there), and, for the history a save that went back set aside, the league's date when it went back, fixed
 * then, so however far the save plays on, the timeline it left is never copied in.
 */
function carryLimit(own: HistorySave | null, source: string): string | null {
  const today = parseGameDate(snapshotGameDate());
  const wentBack = own?.origin === 'fresh_went_back' && own.replaces === source ? parseGameDate(own.refusedAt) : null;
  if (today === null) return wentBack;
  return wentBack !== null && wentBack < today ? wentBack : today;
}

function describeSource(saveKey: string, r: RegistryRow, kind: HistoryOffer['kind'], names: ReadonlyMap<number, string> | null): HistoryOffer | null {
  const limit = carryLimit(historySave(saveKey), r.save_key);
  const dates = datesOf(r.save_key);
  const upTo = dates.filter((d) => { const p = parseGameDate(d); return p !== null && (limit === null || p < limit); });
  if (upTo.length === 0) return null;
  const continuity = continuityWithKey(r.save_key, names, upTo.at(-1)!);
  const players: HistoryPlayers = continuity.verdict === 'same' ? 'same' : continuity.verdict === 'no_evidence' ? 'too_few' : 'unclear';
  return {
    id: offerId(saveKey, r.save_key), kind, source: r.save_key, saveName: r.save_name, folderPath: r.folder_path,
    folderState: r.folder_path === null ? 'unknown' : historyIdentityDeps.folderState(r.folder_path),
    lastDate: dates.at(-1) ?? null, dates: dates.length, carriesThrough: upTo.at(-1)!, players, continuity,
  };
}

const answeredFor = (saveKey: string): Set<string> =>
  new Set((historyDb.prepare(`SELECT candidate_key FROM history_offer_choices WHERE save_key = ?`).all(saveKey) as Array<{ candidate_key: string }>).map((r) => r.candidate_key));

const carriedFrom = (saveKey: string): Set<string> =>
  new Set((historyDb.prepare(`SELECT from_key FROM history_carry_overs WHERE save_key = ? AND undone_at IS NULL`).all(saveKey) as Array<{ from_key: string }>).map((r) => r.from_key));

/**
 * The questions to ask about this save's rating history (D-064), only while its league is certainly its own:
 * - `players_changed` / `went_back`: its folder's history was set aside by a refusal. Continue it (its dates before this
 *   league's date) or keep the new start. Asked until answered: a refusal is never a dead end.
 * - `moved`: while this save has no history of its own (at most its first snapshot) and nothing carried over, another
 *   history still bound to a folder that has really gone, not later than this league, whose players the test doesn't
 *   rule out (the same, or too few to tell).
 * A question answered (either way) is not asked again; an undone carry-over can be asked again.
 */
export function historyOffers(saveKey: string = currentHistoryKey()): HistoryOffer[] {
  if (!servedLeagueCertain()) return [];
  const own = historySave(saveKey);
  if (!own) return [];
  const answered = answeredFor(saveKey);
  const carried = carriedFrom(saveKey);
  const names = leaguePlayerNames();
  const out: HistoryOffer[] = [];
  if ((own.origin === 'fresh_new_league' || own.origin === 'fresh_went_back') && own.replaces && !answered.has(own.replaces) && !carried.has(own.replaces)) {
    const r = historyDb.prepare(`SELECT * FROM history_saves WHERE save_key = ?`).get(own.replaces) as RegistryRow | undefined;
    const offer = r ? describeSource(saveKey, r, own.origin === 'fresh_went_back' ? 'went_back' : 'players_changed', names) : null;
    if (offer) out.push(offer);
  }
  if (datesOf(saveKey).length <= 1 && carried.size === 0) {
    for (const r of historyDb.prepare(`SELECT * FROM history_saves WHERE bound = 1 AND save_key != ? ORDER BY last_seen_at DESC`).all(saveKey) as RegistryRow[]) {
      if (r.folder_path === null || r.folder_id === own.folderId || answered.has(r.save_key)) continue;
      if (historyIdentityDeps.folderState(r.folder_path) !== 'gone' || laterThanLeague(r.save_key)) continue;
      const offer = describeSource(saveKey, r, 'moved', names);
      if (offer && (offer.players === 'same' || offer.players === 'too_few')) out.push(offer);
    }
  }
  return out;
}

/**
 * Every other history the GM may carry over into this save by choice (D-064), most recently seen first: histories set
 * aside, and other folders' histories (as when an OOTP upgrade copied the save), whether their folder is there or not.
 * Only a history whose players read as another league is hidden; one already carried over (and not undone) is not
 * listed again. Only while the league is certainly this save's.
 */
export function historyCandidates(saveKey: string = currentHistoryKey()): HistoryOffer[] {
  if (!servedLeagueCertain()) return [];
  const carried = carriedFrom(saveKey);
  const names = leaguePlayerNames();
  const out: HistoryOffer[] = [];
  for (const r of historyDb.prepare(`SELECT * FROM history_saves WHERE save_key != ? ORDER BY last_seen_at DESC`).all(saveKey) as RegistryRow[]) {
    if (carried.has(r.save_key)) continue;
    const offer = describeSource(saveKey, r, 'listed', names);
    if (offer && offer.continuity.verdict !== 'different') out.push(offer);
  }
  return out;
}

/** An answer that no longer fits what is offered (answered already, another save's, or no longer a candidate). */
export class HistoryChoiceRefusal extends Error {
  readonly status = 400;
}

/** Where the copy of `history.db` made before a carry-over goes. */
const CARRY_BACKUP_PREFIX = 'history-before-carry-over-';

/**
 * A copy of `history.db` in `backups/` before a carry-over, one per carry-over: a cheap check for room first (twice the
 * file's size free), written under a temporary name and renamed. Refuses the carry-over with a sentence when it can't.
 */
function backupBeforeCarry(): string {
  // The last carry-over's backup still serves when nothing was imported since it (the carry-overs themselves can be undone)
  const previous = latestCarryBackup();
  const importedAt = (() => { try { return fs.statSync(LAST_IMPORT_PATH).mtimeMs; } catch { return null; } })();
  if (previous && (importedAt === null || previous.at > importedAt)) return previous.file;
  const file = historyDb.name;
  let size = 0;
  try {
    size = fs.statSync(file).size + (fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`).size : 0);
    const st = fs.statfsSync(path.dirname(file));
    if (st.bavail * st.bsize < size * 2) throw new HistoryChoiceRefusal('There isn\'t room to back up the rating history first, so nothing was carried over.');
  } catch (err) {
    if (err instanceof HistoryChoiceRefusal) throw err;
  }
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const final = path.join(BACKUP_DIR, `${CARRY_BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    const partial = `${final}.partial`;
    historyDb.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
    fs.renameSync(partial, final);
    pruneCarryBackups();
    return final;
  } catch (err) {
    throw new HistoryChoiceRefusal(`The rating history couldn't be backed up first, so nothing was carried over (${(err as Error).message}).`);
  }
}

/** How many carry-over backups are kept (the one-time backup before earlier history was brought over is never removed). */
export const CARRY_BACKUPS_KEPT = 3;

const carryBackups = (): Array<{ file: string; at: number }> => {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(CARRY_BACKUP_PREFIX) && f.endsWith('.db'))
      .map((f) => ({ file: path.join(BACKUP_DIR, f), at: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch {
    return [];
  }
};

function latestCarryBackup(): { file: string; at: number } | null {
  return carryBackups().at(-1) ?? null;
}

/** Keeps the newest `CARRY_BACKUPS_KEPT` carry-over backups (their names sort by time) and removes the rest. */
function pruneCarryBackups(): void {
  const all = carryBackups();
  for (const b of all.slice(0, Math.max(0, all.length - CARRY_BACKUPS_KEPT))) fs.rmSync(b.file, { force: true });
}

/**
 * Copies `source`'s rows at `dates` into `saveKey` where this save has none, recording each row copied (and each date
 * whose rating-kind stamp was copied) under carry-over `carry`. Returns the rows copied and the stamped dates.
 */
function copyInto(saveKey: string, carry: number, source: string, dates: readonly string[]): { rows: number; modeDates: string[] } {
  const columns = SNAPSHOT_DATA_COLUMNS.join(', ');
  let rows = 0;
  const modeDates: string[] = [];
  for (const date of dates) {
    historyDb.prepare(
      `INSERT OR IGNORE INTO history_carried_rows (carry_id, game_date, player_id)
       SELECT ?, s.game_date, s.player_id FROM save_rating_snapshots s WHERE s.save_key = ? AND s.game_date = ?
         AND NOT EXISTS (SELECT 1 FROM save_rating_snapshots t WHERE t.save_key = ? AND t.game_date = s.game_date AND t.player_id = s.player_id)`
    ).run(carry, source, date, saveKey);
    rows += historyDb.prepare(
      `INSERT OR IGNORE INTO save_rating_snapshots (save_key, ${columns}) SELECT ?, ${columns} FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?`
    ).run(saveKey, source, date).changes;
    const mode = historyDb.prepare(
      `INSERT OR IGNORE INTO save_rating_snapshot_modes (save_key, game_date, mode, additional_scouted, source, import_started_at, recorded_at)
       SELECT ?, game_date, mode, additional_scouted, source, import_started_at, recorded_at FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = ?`
    ).run(saveKey, source, date).changes;
    if (mode > 0) modeDates.push(date);
  }
  return { rows, modeDates };
}

/**
 * This save's own snapshot now holds `date` for these players (or its own stamp now holds `date`): what a carry-over
 * copied there is no longer the carry-over's, so undoing it never removes the save's own ratings (D-064). Called by the
 * writers inside their transaction.
 */
export function releaseCarried(saveKey: string, date: string, playerIds: readonly number[] | null): void {
  const active = `SELECT id FROM history_carry_overs WHERE save_key = ? AND undone_at IS NULL`;
  if (playerIds === null) {
    for (const c of historyDb.prepare(`SELECT id, mode_dates FROM history_carry_overs WHERE save_key = ? AND undone_at IS NULL`).all(saveKey) as Array<{ id: number; mode_dates: string }>) {
      const dates = (JSON.parse(c.mode_dates) as string[]).filter((d) => d !== date);
      historyDb.prepare(`UPDATE history_carry_overs SET mode_dates = ? WHERE id = ?`).run(JSON.stringify(dates), c.id);
    }
    return;
  }
  const release = historyDb.prepare(`DELETE FROM history_carried_rows WHERE game_date = ? AND player_id = ? AND carry_id IN (${active})`);
  for (const id of playerIds) release.run(date, id, saveKey);
}

/**
 * The GM's answer (D-064). `adopt` carries the named history over: after a backup, its dates before the carry limit are
 * COPIED into this save's history (this save's own rows win where both have one), the rows copied are recorded, and the
 * source is left exactly as it was. `fresh` answers a question with "keep them apart" and records it. `undo` removes
 * exactly the rows a carry-over copied. Every answer names this save's key, so it can't answer for another save; an
 * answer given already is refused, never written over.
 */
export function answerHistoryOffer(id: string, choice: 'adopt' | 'fresh' | 'undo'): void {
  const saveKey = currentHistoryKey();
  const now = new Date().toISOString();
  if (!id.startsWith(`${saveKey}:`)) throw new HistoryChoiceRefusal('That answer is about another save\'s rating history.');
  if (choice === 'undo') {
    const carry = carryOvers(saveKey).find((c) => c.id === id);
    if (!carry) throw new HistoryChoiceRefusal('There is no carry-over like that to undo.');
    const n = Number(id.slice(`${saveKey}:carry:`.length));
    const row = historyDb.prepare(`SELECT * FROM history_carry_overs WHERE id = ?`).get(n) as CarryRow;
    historyDb.transaction(() => {
      historyDb.prepare(
        `DELETE FROM save_rating_snapshots WHERE save_key = ? AND EXISTS
           (SELECT 1 FROM history_carried_rows c WHERE c.carry_id = ? AND c.game_date = save_rating_snapshots.game_date AND c.player_id = save_rating_snapshots.player_id)`
      ).run(saveKey, n);
      for (const date of JSON.parse(row.mode_dates) as string[]) {
        historyDb.prepare(`DELETE FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = ?`).run(saveKey, date);
      }
      historyDb.prepare(`UPDATE history_carry_overs SET undone_at = ? WHERE id = ?`).run(now, n);
      // Another carry-over still in force supplies what it has for the dates this one supplied, as if this one had never
      // been made: an undo of one source never takes away what another carried over (oldest carry-over first, as copied)
      for (const other of historyDb.prepare(`SELECT * FROM history_carry_overs WHERE save_key = ? AND undone_at IS NULL ORDER BY id`).all(saveKey) as CarryRow[]) {
        const through = parseGameDate(other.through_date);
        const dates = datesOf(other.from_key).filter((d) => { const p = parseGameDate(d); return p !== null && through !== null && p <= through; });
        const added = copyInto(saveKey, other.id, other.from_key, dates);
        historyDb.prepare(`UPDATE history_carry_overs SET rows_copied = rows_copied + ?, mode_dates = ? WHERE id = ?`)
          .run(added.rows, JSON.stringify([...new Set([...(JSON.parse(other.mode_dates) as string[]), ...added.modeDates])]), other.id);
      }
      // The question can be asked again
      historyDb.prepare(`DELETE FROM history_offer_choices WHERE save_key = ? AND candidate_key = ? AND choice = 'adopt'`).run(saveKey, row.from_key);
    }).immediate();
    return;
  }
  const source = id.slice(saveKey.length + 1);
  const record = historyDb.prepare(`INSERT OR IGNORE INTO history_offer_choices (save_key, candidate_key, choice, chosen_at) VALUES (?, ?, ?, ?)`);
  if (choice === 'fresh') {
    if (!historyOffers(saveKey).some((o) => o.id === id)) throw new HistoryChoiceRefusal('There is no question like that about this save\'s rating history to answer.');
    if (record.run(saveKey, source, 'fresh', now).changes === 0) throw new HistoryChoiceRefusal('That question has been answered already.');
    return;
  }
  const offer = [...historyOffers(saveKey), ...historyCandidates(saveKey)].find((o) => o.id === id);
  if (!offer) throw new HistoryChoiceRefusal('That earlier rating history can\'t be carried over to this save now.');
  const backup = backupBeforeCarry();
  const through = parseGameDate(offer.carriesThrough);
  const dates = datesOf(offer.source).filter((d) => { const p = parseGameDate(d); return p !== null && through !== null && p <= through; });
  historyDb.transaction(() => {
    const src = historySave(offer.source);
    const carry = Number(historyDb.prepare(
      `INSERT INTO history_carry_overs (save_key, from_key, from_name, from_path, through_date, rows_copied, mode_dates, backup, carried_at)
       VALUES (?, ?, ?, ?, ?, 0, '[]', ?, ?)`
    ).run(saveKey, offer.source, src?.saveName ?? null, src?.folderPath ?? null, offer.carriesThrough, backup, now).lastInsertRowid);
    const { rows: copied, modeDates } = copyInto(saveKey, carry, offer.source, dates);
    historyDb.prepare(`UPDATE history_carry_overs SET rows_copied = ?, mode_dates = ? WHERE id = ?`).run(copied, JSON.stringify(modeDates), carry);
    record.run(saveKey, offer.source, 'adopt', now);
  }).immediate();
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
  // Brought over only when every player compared has the same name (not the 999-in-1,000 line, which only refuses)
  if (c.verdict === 'unclear' || (c.verdict === 'same' && c.matched !== c.compared)) return none('unattributed', 'unclear');
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

/** A filed game date in words ("April 10, 2026"); null when it can't be read. */
function gameDateText(date: string | null): string | null {
  const iso = parseGameDate(date);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

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
  const carries = carryOvers(saveKey);
  // One account of a fresh start: said while the history set aside is not continued; once it is, the carry-over says so
  const continued = !!record?.replaces && carries.some((c) => c.source === record.replaces);
  if (record?.origin === 'fresh_new_league' && !continued) {
    sentences.push('This save\'s rating history starts fresh: its players don\'t match the history kept for its folder.');
    because.push('The save in this folder has other players than the rating history kept for it, so that history is kept apart, not added to.');
  } else if (record?.origin === 'fresh_went_back' && !continued) {
    sentences.push('This save\'s rating history starts fresh: its date is earlier than the history kept for its folder.');
    because.push('The history kept for this folder runs later than this save\'s own date, so it is kept apart, not written over.');
  }
  for (const c of carries) {
    const through = gameDateText(c.throughDate);
    because.push(`You carried over the rating history of ${c.fromName ? `"${c.fromName}"` : 'another save'}${c.fromPath ? ` (in ${c.fromPath})` : ''}${through ? ` through ${through}` : ''}; its own history is unchanged.`);
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
