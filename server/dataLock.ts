import fs from 'node:fs';
import path from 'node:path';

/**
 * The data-folder lock, `server.lock` (D-055).
 *
 * The Mac app and the Electron app share one data folder (the D-049 hold), and each runs its own copy of this
 * server. Two servers writing `league.db` and `history.db` at once (an import in each, or a refit recorded over
 * another's) is the one way the shared folder could be damaged, so whichever starts first takes the lock and the
 * other refuses to start, saying which app holds it. Electron's single-instance lock only ever stopped a second
 * Electron.
 *
 * A lock whose process has gone (a crash, a force quit) is stale and is taken over. The check is whether that
 * process id is still running; an unrelated process that happens to reuse the id keeps the lock until it exits,
 * and the refusal names the file so it can be removed by hand.
 */
export interface LockHolder {
  pid: number;
  startedAt: string;
  /** Which program took it, for the refusal: "Pennant (Mac sidecar)", "Pennant (Electron)", "npm run dev". */
  app: string;
}

export class DataFolderLocked extends Error {
  constructor(readonly holder: LockHolder, readonly lockPath: string) {
    super(
      `Another copy of Pennant is using this data folder (${holder.app}, process ${holder.pid}, since ${holder.startedAt}). ` +
        `Quit it first. If it is not running, delete ${lockPath}.`
    );
    this.name = 'DataFolderLocked';
  }
}

export const lockPathFor = (dataDir: string): string => path.join(dataDir, 'server.lock');

let held: string | null = null;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else, which still means running
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readHolder(file: string): LockHolder | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockHolder>;
    return typeof parsed.pid === 'number' ? { pid: parsed.pid, startedAt: String(parsed.startedAt ?? 'unknown'), app: String(parsed.app ?? 'unknown') } : null;
  } catch {
    return null;
  }
}

/**
 * Takes the lock for this process, or throws `DataFolderLocked`. Taking it again from the process that holds it
 * is a no-op (Electron calls `startServer` a second time when its remembered port is taken).
 */
export function acquireDataLock(dataDir: string, app: string): void {
  const file = lockPathFor(dataDir);
  if (held === file) return;
  const mine: LockHolder = { pid: process.pid, startedAt: new Date().toISOString(), app };
  // Two tries: the second after clearing a stale or unreadable lock
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx' });
      held = file;
      process.once('exit', releaseDataLock);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const holder = readHolder(file);
    if (holder && holder.pid === process.pid) {
      held = file;
      return;
    }
    if (holder && isRunning(holder.pid)) throw new DataFolderLocked(holder, file);
    // Stale (its process has gone) or unreadable (a crash mid-write): clear it and try once more
    console.warn(`[lock] clearing a stale lock${holder ? ` left by process ${holder.pid} (${holder.app})` : ''}`);
    fs.rmSync(file, { force: true });
  }
  const holder = readHolder(file);
  if (holder) throw new DataFolderLocked(holder, file);
  throw new Error(`Could not take the data-folder lock at ${file}.`);
}

/** Releases the lock if this process holds it. Safe to call more than once, and from an exit handler. */
export function releaseDataLock(): void {
  if (!held) return;
  const file = held;
  held = null;
  if (readHolder(file)?.pid === process.pid) fs.rmSync(file, { force: true });
}
