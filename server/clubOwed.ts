/**
 * The club owed across a relaunch (N7 Stage A, from N6 Stage B2): when the GM chooses a save whose export names no club
 * he manages, or several, and nobody has chosen one, Pennant owes him the question "which club?". Until N7 that was held
 * only in the Mac app's memory, so a relaunch served the automatic club's report as if it had been chosen.
 *
 * - **Set** when such a save's import lands (never when it is chosen: a failed import changes nothing, as with the club
 *   forgotten, D-063), and written to `club-owed.json` in the data folder, so it survives a relaunch.
 * - **Cleared** when the GM chooses a club (a club, or Automatic, in `POST /api/settings`), or when another save's import
 *   lands with its club settled.
 * - **While it is set** the automatic club is not served as if chosen: a Front Office request for `automatic` is refused
 *   in a sentence, and the status and the settings serve the flag for the app to hold its report.
 *
 * It decides nothing about the save or the club (D-001): it records that the question is still open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type { Integer } from './contract/primitives.js';

const FILE = path.join(DATA_DIR, 'club-owed.json');

/** The club question still open, as served on the status and the settings. */
export interface ClubOwed {
  /** "You manage 2 clubs in this save. Choose the one to follow." */
  text: string;
  /** How many clubs the save's export says the human manages; null when it doesn't say. */
  humanClubs: Integer | null;
  /** When the save's import landed with the question open (ISO 8601). */
  since: string;
}

interface Stored extends ClubOwed {
  csvDir: string;
}

/** The export folder whose import, when it lands, leaves the club owed (and how many human clubs it names). */
let owedOnImport: { csvDir: string; humanClubs: number | null } | null = null;

/** Whether the club is owed now; null when not (or the file can't be read, which owes nothing). */
export function clubOwed(): ClubOwed | null {
  try {
    const stored = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Stored>;
    if (typeof stored.text !== 'string' || typeof stored.since !== 'string') return null;
    return { text: stored.text, humanClubs: typeof stored.humanClubs === 'number' ? stored.humanClubs : null, since: stored.since };
  } catch {
    return null;
  }
}

/** The sentence the question is asked in. */
export function owedText(humanClubs: number | null): string {
  if (humanClubs === null) return 'The export doesn\'t say which club you manage. Choose the one to follow.';
  if (humanClubs === 0) return 'The export names no club you manage. Choose the one to follow.';
  return `You manage ${humanClubs} clubs in this save. Choose the one to follow.`;
}

/**
 * A save was chosen whose club is not settled (`decided: false`): the club is owed once its import lands. Null: the
 * choice settled the club (or kept it), so nothing is owed by it.
 */
export function oweClubWhenImported(pending: { csvDir: string; humanClubs: number | null } | null): void {
  owedOnImport = pending;
}

/**
 * An import of `csvDir` landed: the club becomes owed when this save's choice left it unsettled; any other import that
 * lands with nothing owed clears an owed question of another save. Returns whether the club is owed now.
 */
export function importLandedForClubQuestion(csvDir: string): boolean {
  if (owedOnImport && owedOnImport.csvDir === csvDir) {
    const stored: Stored = { csvDir, humanClubs: owedOnImport.humanClubs, text: owedText(owedOnImport.humanClubs), since: new Date().toISOString() };
    owedOnImport = null;
    try {
      fs.writeFileSync(FILE, JSON.stringify(stored, null, 2));
    } catch (err) {
      console.error('[settings] could not record the club question:', err);
    }
    return true;
  }
  try {
    const stored = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Stored>;
    // The same save imported again keeps the question open; another save's import settles it
    if (stored.csvDir !== csvDir) clearClubOwed();
  } catch {
    // Nothing owed
  }
  return clubOwed() !== null;
}

/** The GM chose a club (or Automatic): nothing is owed, now or when a pending import lands. */
export function clearClubOwed(): void {
  owedOnImport = null;
  fs.rmSync(FILE, { force: true });
}

/** The sentence a Front Office request for the automatic club is refused in while the club is owed. */
export const CLUB_OWED_REFUSAL = 'Choose the club you follow in this save first.';
