/**
 * Which save the GM is playing (N3.5 Stage B2, D-063): the saves found on this Mac (`paths.ts`), the one that clearly
 * stands out, and whether another save has been played since the one chosen.
 *
 * Only file times decide anything here: when OOTP last saved each save (`lastPlayedAt`), and whether it has an export.
 * The export's own time never picks a save (a copied save keeps its export's times). Nothing is picked unless it
 * clearly stands out; otherwise the saves are served most recently played first and the app asks (D-001, D-018).
 * Pennant never switches saves by itself: "played since" is a fact and a sentence, and the GM chooses.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { databaseGeneration, importRecord, tableExists } from './db.js';
import { servedLeagueCertain, servedSave } from './historyIdentity.js';
import { locateSave } from './ootpSave.js';
import { describeSave, detectSaves, saveId, versionFromPath, type SaveInfo } from './paths.js';
import { publish } from './serverEvents.js';
import { rememberFact, rememberedFact } from './servedFacts.js';
import { timestampWords } from './timeWords.js';

/**
 * The policy line (D-063): a save stands out only when no other save was played in the two days before it. Two saves
 * played within two days of each other are both plausibly "the one you're playing", so the app asks. Stated, not fitted.
 */
export const STANDOUT_WINDOW_MS = 2 * 24 * 60 * 60_000;

/** Why nothing was picked. */
export type NoPickReason =
  /** No save was found at all. */
  | 'noSaves'
  /** No save found has ever been saved by OOTP (no last-played time). */
  | 'neverPlayed'
  /** The save played most recently has no export to import. */
  | 'noExport'
  /** Another save was played within the window before the most recent one. */
  | 'tooClose'
  /** A save's last-played time is in the future (a clock or a copied file), so which was played last isn't known. */
  | 'timeUnknown'
  /** Pennant couldn't look inside a folder where saves are kept, or inside the most recent save's export folder. */
  | 'cantLook';

/**
 * A file time further ahead of now than this is not a time the save was played (a wrong clock, a copied file): it is
 * unknown (D-018), never "played most recently". Generous, so a Mac whose clock drifts a little is not caught.
 */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Whether a save's last-played time is ahead of `now` by more than the tolerance (not a time it was played). */
export const playedInFuture = (s: SaveInfo, now: number): boolean => {
  const at = s.lastPlayedAt ? Date.parse(s.lastPlayedAt) : null;
  return at !== null && at > now + FUTURE_TOLERANCE_MS;
};

/**
 * A save's name for a sentence: its name, and where it is when another save found has the same name (this Mac has two
 * called "New Game"), so a sentence never names the wrong one.
 */
export function saveLabel(save: SaveInfo, saves: readonly SaveInfo[]): string {
  const twin = saves.some((o) => o.name === save.name && o.id !== save.id);
  return twin ? `${save.name} (${save.location ?? save.lgPath})` : save.name;
}

/** A save named inside a sentence: its name in quotes, as the rating-history questions name one (N6 Stage B2 review, L5). */
function quotedSaveLabel(save: SaveInfo, saves: readonly SaveInfo[]): string {
  const twin = saves.some((o) => o.name === save.name && o.id !== save.id);
  return twin ? `"${save.name}" (${save.location ?? 'another folder'})` : `"${save.name}"`;
}

/** The pick, or why there is none, and the save played next most recently (the pick's margin). */
export interface SavePick {
  pick: SaveInfo | null;
  reason: NoPickReason | null;
  /** The save played most recently (the pick, when there is one). */
  latest: SaveInfo | null;
  /** The save played next most recently, when there is one. */
  runnerUp: SaveInfo | null;
  /** The saves whose last-played time is in the future (unknown). */
  futureTimes: SaveInfo[];
  /** The folders Pennant couldn't look inside. */
  unreadable: string[];
}

const playedMs = (s: SaveInfo | null | undefined): number | null => (s?.lastPlayedAt ? Date.parse(s.lastPlayedAt) : null);

/**
 * The save that clearly stands out (D-063): played most recently of every save found (every OOTP version and
 * location), with an export, and no other save played within `STANDOUT_WINDOW_MS` before it. Pure: the saves in, the
 * pick out.
 */
export function pickSave(saves: readonly SaveInfo[], opts: { now?: number; unreadable?: readonly string[] } = {}): SavePick {
  const now = opts.now ?? Date.now();
  const unreadable = [...(opts.unreadable ?? [])];
  const futureTimes = saves.filter((s) => playedInFuture(s, now));
  const played = saves.filter((s) => playedMs(s) !== null && !playedInFuture(s, now)).sort((a, b) => playedMs(b)! - playedMs(a)!);
  const latest = played[0] ?? null;
  const runnerUp = played[1] ?? null;
  const none = (reason: NoPickReason): SavePick => ({ pick: null, reason, latest, runnerUp, futureTimes, unreadable });
  // A folder Pennant couldn't look inside may hold the save being played: nothing clearly stands out (D-018)
  if (unreadable.length > 0) return none('cantLook');
  if (saves.length === 0) return none('noSaves');
  if (futureTimes.length > 0) return none('timeUnknown');
  if (!latest) return none('neverPlayed');
  if (latest.hasExport === null) return none('cantLook');
  if (!latest.hasExport) return none('noExport');
  if (runnerUp && playedMs(latest)! - playedMs(runnerUp)! < STANDOUT_WINDOW_MS) return none('tooClose');
  return { pick: latest, reason: null, latest, runnerUp, futureTimes, unreadable };
}

// ── "played since": another save played after the chosen one ──────────────────────────────────────────────────────

/**
 * Another save played since the one chosen, on `/api/status` (and so on the event stream's `hello`). No event of its own
 * yet: a new member of the event union moves the Swift tests' positional reads, so it waits for the Mac stage.
 */
export interface SavePlayedElsewhere {
  /**
   * `otherSave`: another save of the same (or an unknown) OOTP version; `newerOotp`: a save in a newer OOTP version;
   * `chosenMissing`: the chosen save is no longer where it was (moved, renamed or deleted), and this is the save played
   * most recently.
   */
  kind: 'otherSave' | 'newerOotp' | 'chosenMissing';
  /** The line the app shows ("You've played "RIGHTS-EXP" since this save, last on Sep 20, 2026, 6:58 AM."). */
  text: string;
  /** The help tag: at most about 75 characters. */
  hint: string;
  /** The label of the one-click switch ("Switch to RIGHTS-EXP"). */
  actionText: string;
  /** The save played since: its id, its export folder and name (what choosing it sends), and its facts. */
  save: SaveInfo;
  /** When OOTP last saved the chosen save; null when that is not known. */
  chosenLastPlayedAt: string | null;
}

/**
 * How long a save's times must stay still before it counts as played since: OOTP writes a save's files over seconds,
 * and the notice never appears while OOTP is still saving (so it never flickers on and off).
 */
export const PLAYED_SETTLE_MS = 60_000;
/** How often the saves are looked at again while the server runs (a look is a few hundred `stat` calls). */
export const SCAN_EVERY_MS = 60_000;

/** The clock and timers, which a test replaces. */
export const discoveryClock = {
  now: (): number => Date.now(),
  setTimeout: (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (t: ReturnType<typeof setTimeout>): void => clearTimeout(t),
  /** The saves found, times only (never a file read on the minute's scan); a test points it at a pretend home. */
  saves: (): SaveInfo[] => detectSaves(os.homedir(), 'times'),
};

/** The chosen save's own facts (from the scan when it is there, else read from its folder), or `missing` when gone. */
function chosenSave(saves: readonly SaveInfo[]): SaveInfo | 'missing' | null {
  const config = loadConfig();
  if (!config.csvDir) return null;
  const location = locateSave({ csvDir: config.csvDir, saveName: config.saveName, manualLgPath: config.lgPath ?? null });
  if (!location.found || !location.lgPath || !fs.existsSync(location.lgPath)) return 'missing';
  const id = saveId(location.lgPath);
  return saves.find((s) => s.id === id) ?? describeSave(location.lgPath, null, 'times');
}

/**
 * Another save played since the chosen one, judged at `now`: the save played most recently after the chosen save's
 * last save, once its times have been still for `PLAYED_SETTLE_MS`. None when no save is chosen, when the chosen
 * save's last-played time is not known (then nothing can be said to be later), or when nothing was played since.
 */
export function playedElsewhere(saves: readonly SaveInfo[], chosen: SaveInfo | 'missing' | null, now: number): SavePlayedElsewhere | null {
  // A time in the future is not a time a save was played (unknown, D-018): it is never "played since"
  const settled = (s: SaveInfo): boolean => playedMs(s) !== null && !playedInFuture(s, now) && now - playedMs(s)! >= PLAYED_SETTLE_MS;
  if (chosen === 'missing') {
    // The chosen save has gone (moved, renamed, deleted): name the save played most recently, so one click finds it
    const latest = saves.filter(settled).sort((a, b) => playedMs(b)! - playedMs(a)!)[0];
    if (!latest) return null;
    const name = saveLabel(latest, saves);
    return {
      kind: 'chosenMissing',
      text: `Pennant can't find the save it was using. You've played ${quotedSaveLabel(latest, saves)} most recently, last on ${latest.lastPlayedText ?? 'a date that couldn\'t be read'}.${latest.hasExport ? '' : ' It has no export yet.'}`,
      hint: 'It may have been renamed or moved in OOTP.',
      actionText: `Switch to ${name}`,
      save: latest,
      chosenLastPlayedAt: null,
    };
  }
  const chosenAt = playedMs(chosen);
  if (!chosen || chosenAt === null || playedInFuture(chosen, now)) return null;
  const later = saves
    .filter((s) => s.id !== chosen.id && settled(s) && playedMs(s)! > chosenAt)
    .sort((a, b) => playedMs(b)! - playedMs(a)!);
  const other = later[0];
  if (!other) return null;
  const name = saveLabel(other, saves);
  const chosenVersion = chosen.ootpVersion ?? versionFromPath(chosen.lgPath);
  const newer = other.ootpVersion != null && chosenVersion != null && other.ootpVersion > chosenVersion;
  const when = other.lastPlayedText ?? 'recently';
  const where = newer ? ` in OOTP ${other.ootpVersion}` : '';
  const exportLine = other.hasExport ? '' : ' It has no export yet.';
  return {
    kind: newer ? 'newerOotp' : 'otherSave',
    text: `You've played ${quotedSaveLabel(other, saves)}${where} since this save, last on ${when}.${exportLine}`,
    hint: 'Pennant stays on this save until you switch.',
    actionText: `Switch to ${name}`,
    save: other,
    chosenLastPlayedAt: chosen.lastPlayedAt ?? null,
  };
}

/** The last look at the saves, and the notice it gave. */
let lastScan: { at: number; saves: SaveInfo[]; notice: SavePlayedElsewhere | null } | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;
/**
 * What the notice said when it was last announced on the event stream (`save-played-elsewhere`): its kind, the save it
 * names and when that save was last played, or nothing. Kept apart from the last look, so a look after the chosen save changed still announces a
 * notice that cleared. A look that finds the same notice announces nothing.
 */
let announced = '';

/**
 * What tells one notice from another: the kind, the save it names and when that save was last played (the sentence
 * says when, so a save played again is a new sentence to announce); nothing for none.
 */
export function noticeKey(notice: SavePlayedElsewhere | null): string {
  return notice ? `${notice.kind}:${notice.save.id}:${notice.save.lastPlayedAt ?? ''}` : '';
}

/**
 * The id of the save the imported data came from (D-063: its `<save>.lg` folder's real path, hashed, as the save list
 * identifies it), for `/api/status`: the Mac app keys the Morning Report it keeps across launches on it, so another
 * save's report is never drawn, and the report of a save being left is never kept under the new one's id.
 *
 * Tied to the last import: worked out off every request's path (at start, at the minute's look, when the configuration
 * is saved and when an import lands) and served only while the import, the database and the configuration it was
 * worked out for are still the served ones. Null with nothing imported, while a save chosen but not yet imported is
 * configured (`servedLeagueCertain`), or until it has been worked out. A save whose folder could not be found is
 * worked out again at the next look, never kept for good.
 */
let servedId: { signature: string; id: string | null; located: boolean; seeded?: boolean } | null = null;

/** What the served save's id depends on: the database, its import, and the configuration. Cheap (no file is read). */
function servedSignature(): string {
  const config = loadConfig();
  const record = importRecord();
  return JSON.stringify([databaseGeneration(), record?.startedAt ?? null, record?.csvDir ?? null, config.csvDir, config.saveName]);
}

/** Works out the served save's id now (a few `stat` calls; never on a request's path). */
export function refreshServedSaveId(): string | null {
  const signature = servedSignature();
  if (servedId?.signature === signature && servedId.located && !servedId.seeded) return servedId.id;
  try {
    const save = tableExists('players') && servedLeagueCertain() ? servedSave() : null;
    servedId = { signature, id: save?.folderId || null, located: save === null || save.located };
    // Remembered for the next start, which serves it at once (`servedFacts.ts`); only an id worked out for good
    if (servedId.located && servedId.id) rememberFact('saveId', servedId.id);
  } catch (err) {
    console.error('[saves] could not work out the served save:', err);
    servedId = { signature, id: null, located: false };
  }
  return servedId.id;
}

/**
 * At start, the served save's id as an earlier start worked it out for this very league, import and configuration
 * (`servedFacts.ts`), so the first status serves it without locating the save; the look after the first answers works
 * it out again. False when nothing is remembered for them: the caller then works it out now, as before.
 */
export function seedServedSaveId(): boolean {
  const remembered = rememberedFact('saveId');
  if (typeof remembered !== 'string' || !remembered) return false;
  servedId = { signature: servedSignature(), id: remembered, located: true, seeded: true };
  return true;
}

/** What else is worked out about the served save off the request path, beside its id (the live log's files). */
const servedSaveLooks: Array<() => void> = [];

/** Adds a look at the served save that runs with `lookAtTheServedSave` (a module registers it once, at load). */
export function onLookAtTheServedSave(look: () => void): void {
  servedSaveLooks.push(look);
}

/**
 * Works out everything a request reads about the served save, off every request's path: at start, at the minute's look,
 * when a save is chosen and when an import lands. The status, and the Front Office's stamp on it, only read the result.
 */
export function lookAtTheServedSave(): void {
  refreshServedSaveId();
  for (const look of servedSaveLooks) {
    try {
      look();
    } catch (err) {
      console.error('[saves] a look at the served save failed:', err);
    }
  }
}

/** The served save's id as last worked out, while it is still the served one's; null otherwise. Never locates a save. */
export function servedSaveId(): string | null {
  return servedId && servedId.signature === servedSignature() ? servedId.id : null;
}

/**
 * Looks at the saves now (a few hundred `stat` calls; never on a request's path: `/api/status` serves the last look),
 * keeps the notice, and looks again when a save played since would
 * have settled, else after `SCAN_EVERY_MS`.
 */
export function scanSaves(): SavePlayedElsewhere | null {
  if (scanTimer) discoveryClock.clearTimeout(scanTimer);
  scanTimer = null;
  scanning = true;
  let notice: SavePlayedElsewhere | null = null;
  let next = SCAN_EVERY_MS;
  try {
    const now = discoveryClock.now();
    const saves = discoveryClock.saves();
    const chosen = chosenSave(saves);
    notice = playedElsewhere(saves, chosen, now);
    // A save played since that has not settled yet: look again once it would have
    const chosenAt = chosen === 'missing' ? -Infinity : playedMs(chosen);
    const chosenId = chosen === 'missing' ? null : chosen?.id;
    for (const s of saves) {
      const at = playedMs(s);
      if (chosenAt !== null && at !== null && s.id !== chosenId && at > chosenAt && now - at < PLAYED_SETTLE_MS) {
        next = Math.min(next, PLAYED_SETTLE_MS - (now - at) + 50);
      }
    }
    lastScan = { at: now, saves, notice };
    // The served save's id and its live log, worked out again (off every request's path)
    lookAtTheServedSave();
    // Announced only when it changes: first seen, another save, the chosen one gone or back, or cleared
    const key = noticeKey(notice);
    if (key !== announced) {
      announced = key;
      publish({ type: 'save-played-elsewhere', savePlayedElsewhere: notice });
    }
  } catch (err) {
    console.error('[saves] could not look at the saves:', err);
  } finally {
    scanning = false;
  }
  if (watching) scanTimer = discoveryClock.setTimeout(() => void scanSaves(), next);
  return notice;
}

let watching = false;

/** Looks at the saves now and then every minute while the server runs (the "played since" notice). */
export function startSaveWatch(): void {
  watching = true;
  scanSaves();
}

export function stopSaveWatch(): void {
  watching = false;
  if (scanTimer) discoveryClock.clearTimeout(scanTimer);
  scanTimer = null;
}

/** The notice as of the last look, for `/api/status`: never a scan on the request's path. */
export function currentPlayedElsewhere(): SavePlayedElsewhere | null {
  return lastScan?.notice ?? null;
}

/** Forgets the last look (the chosen save changed): the next look decides afresh, soon. */
export function forgetSaveScan(): void {
  lastScan = null;
  if (watching && !scanning) {
    if (scanTimer) discoveryClock.clearTimeout(scanTimer);
    scanTimer = discoveryClock.setTimeout(() => void scanSaves(), 0);
  }
}

// ── the export's teams file: which club the save's human manages ─────────────────────────────────────────────────

/** A club the save's human manages, as the export's `teams.csv` names it. */
export interface HumanClub {
  teamId: number;
  name: string;
}

/** The delimiter of a header row, as the importer decides it (the most used of `,` `;` tab `|` outside quotes). */
export function delimiterOf(header: string): string {
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t', '|']) {
    let count = 0;
    let inQuotes = false;
    for (const ch of header) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Splits one CSV line on the delimiter, honouring double quotes (a teams row holds no line break). */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/**
 * Every club in the export's `teams.csv`, read before any import, with whether the save's human manages it (its
 * `human_team` column, as `viewingOrganization.ts` reads it after one). Null when the file, its id column or its
 * `human_team` column is not there: not known, never none.
 */
function clubsInExport(csvDir: string): Array<HumanClub & { human: boolean }> | null {
  let text: string;
  try {
    const buf = fs.readFileSync(path.join(csvDir, 'teams.csv'));
    text = buf.toString('utf8');
    if (text.includes('\uFFFD')) text = buf.toString('latin1');
  } catch {
    return null;
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const delimiter = delimiterOf(lines[0]);
  const header = splitLine(lines[0], delimiter).map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const [id, human, name, nickname] = [col('team_id'), col('human_team'), col('name'), col('nickname')];
  if (id < 0 || human < 0) return null;
  const clubs: Array<HumanClub & { human: boolean }> = [];
  for (const line of lines.slice(1)) {
    const f = splitLine(line, delimiter);
    const teamId = Number(f[id]);
    if (!Number.isInteger(teamId)) continue;
    const place = name >= 0 ? f[name]?.trim() ?? '' : '';
    const nick = nickname >= 0 ? f[nickname]?.trim() ?? '' : '';
    clubs.push({ teamId, name: [place, nick && nick !== place ? nick : ''].filter(Boolean).join(' ') || `Club ${teamId}`, human: Number(f[human]) === 1 });
  }
  return clubs.sort((a, b) => a.teamId - b.teamId);
}

/**
 * The clubs the save's human manages, read from the export's `teams.csv` before any import (its `human_team` column,
 * as `viewingOrganization.ts` reads it after one). Null when the file or the column is not there: not known, never none.
 */
export function humanClubsInExport(csvDir: string): HumanClub[] | null {
  const clubs = clubsInExport(csvDir);
  return clubs === null ? null : clubs.filter((c) => c.human).map(({ teamId, name }) => ({ teamId, name }));
}

/** A club's name as the save's export has it; null when the export doesn't list that club (or can't be read). */
export function clubNameInExport(csvDir: string, teamId: number): string | null {
  return clubsInExport(csvDir)?.find((c) => c.teamId === teamId)?.name ?? null;
}

/** For a test: the last look forgotten and the watch stopped. */
export function resetSaveDiscovery(): void {
  stopSaveWatch();
  lastScan = null;
  announced = '';
  servedId = null;
}

/** When a save was last played, in words, for a sentence ("Sep 22, 2026, 4:52 PM"). */
export const playedWords = (s: SaveInfo | null): string => timestampWords(s?.lastPlayedAt) ?? 'at a time that couldn\'t be read';
