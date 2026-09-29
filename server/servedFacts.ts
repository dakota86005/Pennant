/**
 * What the status serves about the served league, remembered across starts (N6 polish: the first answers are cheap).
 *
 * Two facts on `/api/status` cost a look at the league or the saves to work out: the id of the save the imported data
 * came from (`saveId`, D-063, a few hundred `stat` calls to locate it) and the top of the rating scale
 * (`ratingScaleMax`, a scan of four rating columns: about 80 ms on a 1.1 GB league). Both change only when the served
 * league, its import or the chosen save changes. So each is written here, with what it was worked out for, whenever it
 * is worked out, and a start whose league, import and configuration are the ones it was worked out for serves it at
 * once instead of working it out in front of the first answer. The minute's look still works the save's id out again,
 * as before.
 *
 * `served-facts.json` in the data folder: a new file, read only by this build (the Electron app ignores it), written
 * atomically, and never trusted beyond its key. A file that is missing, unreadable or for another league is ignored:
 * the fact is worked out as it always was.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, APP_ROOT, loadConfig } from './config.js';
import { LAST_IMPORT_PATH, LEAGUE_DB_PATH, importRecord } from './db.js';

export const SERVED_FACTS_PATH = path.join(DATA_DIR, 'served-facts.json');

type Fact = 'saveId' | 'ratingScaleMax';
interface Stored {
  key: string;
  value: string | number | null;
}

function stamp(file: string): string {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${Math.round(s.mtimeMs)}:${s.ino}`;
  } catch {
    return '-';
  }
}

/**
 * What a fact was worked out for: the league file itself (size, time, inode: an import or an upgrade swaps a new file
 * in), its import (the record and `last-import.json`), and, for the save's id, the configuration (the save chosen, and
 * whether it was chosen before or after the import, which `servedLeagueCertain` reads from the two files' times).
 */
export function servedFactKey(fact: Fact): string {
  const record = importRecord();
  const league = [stamp(LEAGUE_DB_PATH), stamp(LAST_IMPORT_PATH), record?.startedAt ?? null];
  if (fact === 'ratingScaleMax') return JSON.stringify(league);
  const config = loadConfig();
  const configFile = fs.existsSync(path.join(DATA_DIR, 'config.json')) ? path.join(DATA_DIR, 'config.json') : path.join(APP_ROOT, 'config.json');
  return JSON.stringify([...league, record?.csvDir ?? null, config.csvDir, config.saveName, stamp(configFile)]);
}

function readAll(): Partial<Record<Fact, Stored>> {
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVED_FACTS_PATH, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<Fact, Stored>>) : {};
  } catch {
    return {};
  }
}

/** The fact as remembered for the league served now, or undefined when none is (never a guess). */
export function rememberedFact(fact: Fact): string | number | null | undefined {
  const stored = readAll()[fact];
  if (!stored || typeof stored.key !== 'string' || stored.key !== servedFactKey(fact)) return undefined;
  return stored.value;
}

/** Remembers a fact just worked out, for the league served now. A write that fails only means it is worked out again. */
export function rememberFact(fact: Fact, value: string | number | null): void {
  try {
    const all = readAll();
    const key = servedFactKey(fact);
    if (all[fact]?.key === key && all[fact]?.value === value) return;
    all[fact] = { key, value };
    const temporary = `${SERVED_FACTS_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(all));
    fs.renameSync(temporary, SERVED_FACTS_PATH);
  } catch (err) {
    console.warn('[server] could not remember what the status serves:', (err as Error).message);
  }
}
