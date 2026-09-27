/**
 * Which save the GM is playing (N3.5 Stage B2, D-062): the saves found on this Mac (`paths.ts`), the one that clearly
 * stands out, and whether another save has been played since the one chosen.
 *
 * Only file times decide anything here: when OOTP last saved each save (`lastPlayedAt`), and whether it has an export.
 * The export's own time never picks a save (a copied save keeps its export's times). Nothing is picked unless it
 * clearly stands out; otherwise the saves are served most recently played first and the app asks (D-001, D-018).
 * Pennant never switches saves by itself: "played since" is a fact and a sentence, and the GM chooses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { locateSave } from './ootpSave.js';
import { describeSave, detectSaves, saveId, versionFromPath, type SaveInfo } from './paths.js';
import { publish } from './serverEvents.js';
import { timestampWords } from './timeWords.js';

/**
 * The policy line (D-062): a save stands out only when no other save was played in the two days before it. Two saves
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
  | 'tooClose';

/** The pick, or why there is none, and the save played next most recently (the pick's margin). */
export interface SavePick {
  pick: SaveInfo | null;
  reason: NoPickReason | null;
  /** The save played most recently (the pick, when there is one). */
  latest: SaveInfo | null;
  /** The save played next most recently, when there is one. */
  runnerUp: SaveInfo | null;
}

const playedMs = (s: SaveInfo | null | undefined): number | null => (s?.lastPlayedAt ? Date.parse(s.lastPlayedAt) : null);

/**
 * The save that clearly stands out (D-062): played most recently of every save found (every OOTP version and
 * location), with an export, and no other save played within `STANDOUT_WINDOW_MS` before it. Pure: the saves in, the
 * pick out.
 */
export function pickSave(saves: readonly SaveInfo[]): SavePick {
  const played = saves.filter((s) => playedMs(s) !== null).sort((a, b) => playedMs(b)! - playedMs(a)!);
  const latest = played[0] ?? null;
  const runnerUp = played[1] ?? null;
  if (saves.length === 0) return { pick: null, reason: 'noSaves', latest, runnerUp };
  if (!latest) return { pick: null, reason: 'neverPlayed', latest, runnerUp };
  if (!latest.hasExport) return { pick: null, reason: 'noExport', latest, runnerUp };
  if (runnerUp && playedMs(latest)! - playedMs(runnerUp)! < STANDOUT_WINDOW_MS) return { pick: null, reason: 'tooClose', latest, runnerUp };
  return { pick: latest, reason: null, latest, runnerUp };
}

// ── "played since": another save played after the chosen one ──────────────────────────────────────────────────────

/** Another save played since the one chosen (on `/api/status` and the `save-played-elsewhere` event). */
export interface SavePlayedElsewhere {
  /** `otherSave`: another save of the same (or an unknown) OOTP version; `newerOotp`: a save in a newer OOTP version. */
  kind: 'otherSave' | 'newerOotp';
  /** The line the app shows ("You've played RIGHTS-EXP since this save, last on Sep 20, 2026, 6:58 AM."). */
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
  /** The saves found (a test points it at a pretend home). */
  saves: (): SaveInfo[] => detectSaves(),
};

/** The chosen save's own facts: from the scan when it is there, else read from its folder. */
function chosenSave(saves: readonly SaveInfo[]): SaveInfo | null {
  const config = loadConfig();
  if (!config.csvDir) return null;
  const location = locateSave({ csvDir: config.csvDir, saveName: config.saveName, manualLgPath: config.lgPath ?? null });
  if (!location.found || !location.lgPath) return null;
  const id = saveId(location.lgPath);
  return saves.find((s) => s.id === id) ?? describeSave(location.lgPath);
}

/**
 * Another save played since the chosen one, judged at `now`: the save played most recently after the chosen save's
 * last save, once its times have been still for `PLAYED_SETTLE_MS`. None when no save is chosen, when the chosen
 * save's last-played time is not known (then nothing can be said to be later), or when nothing was played since.
 */
export function playedElsewhere(saves: readonly SaveInfo[], chosen: SaveInfo | null, now: number): SavePlayedElsewhere | null {
  const chosenAt = playedMs(chosen);
  if (!chosen || chosenAt === null) return null;
  const later = saves
    .filter((s) => s.id !== chosen.id && playedMs(s) !== null && playedMs(s)! > chosenAt && now - playedMs(s)! >= PLAYED_SETTLE_MS)
    .sort((a, b) => playedMs(b)! - playedMs(a)!);
  const other = later[0];
  if (!other) return null;
  const chosenVersion = chosen.ootpVersion ?? versionFromPath(chosen.lgPath);
  const newer = other.ootpVersion != null && chosenVersion != null && other.ootpVersion > chosenVersion;
  const when = other.lastPlayedText ?? 'recently';
  const where = newer ? ` in OOTP ${other.ootpVersion}` : '';
  const exportLine = other.hasExport ? '' : ' It has no export yet.';
  return {
    kind: newer ? 'newerOotp' : 'otherSave',
    text: `You've played ${other.name}${where} since this save, last on ${when}.${exportLine}`,
    hint: 'Pennant stays on this save until you switch.',
    actionText: `Switch to ${other.name}`,
    save: other,
    chosenLastPlayedAt: chosen.lastPlayedAt ?? null,
  };
}

/** The last look at the saves, and the notice it gave. */
let lastScan: { at: number; saves: SaveInfo[]; notice: SavePlayedElsewhere | null } | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;

const noticeKey = (n: SavePlayedElsewhere | null): string => (n ? `${n.kind}:${n.save.id}:${n.save.lastPlayedAt}` : 'none');

/**
 * Looks at the saves now (a few hundred `stat` calls; never on a request's path: `/api/status` serves the last look),
 * keeps the notice, publishes `save-played-elsewhere` when it changed, and looks again when a save played since would
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
    const chosenAt = playedMs(chosen);
    for (const s of saves) {
      const at = playedMs(s);
      if (chosenAt !== null && at !== null && s.id !== chosen?.id && at > chosenAt && now - at < PLAYED_SETTLE_MS) {
        next = Math.min(next, PLAYED_SETTLE_MS - (now - at) + 50);
      }
    }
    const before = noticeKey(lastScan?.notice ?? null);
    lastScan = { at: now, saves, notice };
    if (noticeKey(notice) !== before) publish({ type: 'save-played-elsewhere', notice });
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
  const had = lastScan?.notice ?? null;
  lastScan = null;
  if (had) publish({ type: 'save-played-elsewhere', notice: null });
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
function delimiterOf(header: string): string {
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
function splitLine(line: string, delimiter: string): string[] {
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
 * The clubs the save's human manages, read from the export's `teams.csv` before any import (its `human_team` column,
 * as `viewingOrganization.ts` reads it after one). Null when the file or the column is not there: not known, never none.
 */
export function humanClubsInExport(csvDir: string): HumanClub[] | null {
  let text: string;
  try {
    const buf = fs.readFileSync(path.join(csvDir, 'teams.csv'));
    text = buf.toString('utf8');
    if (text.includes('�')) text = buf.toString('latin1');
  } catch {
    return null;
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const delimiter = delimiterOf(lines[0]);
  const header = splitLine(lines[0], delimiter).map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const [id, human, name, nickname] = [col('team_id'), col('human_team'), col('name'), col('nickname')];
  if (id < 0 || human < 0) return null;
  const clubs: HumanClub[] = [];
  for (const line of lines.slice(1)) {
    const f = splitLine(line, delimiter);
    if (Number(f[human]) !== 1) continue;
    const teamId = Number(f[id]);
    if (!Number.isInteger(teamId)) continue;
    const place = name >= 0 ? f[name]?.trim() ?? '' : '';
    const nick = nickname >= 0 ? f[nickname]?.trim() ?? '' : '';
    clubs.push({ teamId, name: [place, nick && nick !== place ? nick : ''].filter(Boolean).join(' ') || `Club ${teamId}` });
  }
  return clubs.sort((a, b) => a.teamId - b.teamId);
}

/** For a test: the last look forgotten and the watch stopped. */
export function resetSaveDiscovery(): void {
  stopSaveWatch();
  lastScan = null;
}

/** When a save was last played, in words, for a sentence ("Sep 22, 2026, 4:52 PM"). */
export const playedWords = (s: SaveInfo | null): string => timestampWords(s?.lastPlayedAt) ?? 'at a time that couldn\'t be read';
