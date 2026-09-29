import type { Request, Response } from 'express';
import type { ImportProgress, ImportResult, ImportStep } from './importer.js';
import type { ImportNote } from './presentation/importWords.js';
import type { JobStatus } from './jobs.js';
import type { ServerStatus } from './api.js';
import type { Integer } from './contract/primitives.js';
import type { SavePlayedElsewhere } from './saveDiscovery.js';

/**
 * What the server tells a connected app as it happens, over `GET /api/v2/events` (server-sent events, D-055).
 *
 * The React app polls `/api/status` every few seconds; the Mac app listens here instead. Every event is a fact the
 * server already holds (the same fields `/api/status` and the job routes serve), pushed when it changes. An event
 * is a nudge to re-read, never a second source of truth: a client that missed one reads `/api/status`, and the
 * stream opens with a `hello` carrying that snapshot so nothing is missed between loading and listening.
 *
 * The names are the contract's (N2 describes them in `contract/openapi.json`); a client ignores a name it does not
 * know, so new events can be added without breaking an older app.
 */
export type ServerEvent =
  | HelloEvent
  | ImportStartedEvent
  | ImportProgressEvent
  | ImportFinishedEvent
  | ExportPendingEvent
  | JobEvent
  | FrontOfficeUpdatedEvent
  | SavePlayedElsewhereEvent
  | DeskChangedEvent
  | FollowingChangedEvent
  | ChangesReadyEvent;

/** The first event on every stream: the `/api/status` snapshot, so nothing is missed between loading and listening. */
export interface HelloEvent { type: 'hello'; status: ServerStatus }
export interface ImportStartedEvent { type: 'import-started'; startedAt: string }
export interface ImportProgressEvent { type: 'import-progress'; progress: ImportProgress }
export interface ImportFinishedEvent {
  type: 'import-finished';
  lastImport: ImportResult | null;
  /** The raw error, for the log; `note` says it in words. */
  error: string | null;
  /** Why the import did not finish, in a sentence; null when it did. */
  note: ImportNote | null;
}
/** OOTP has written a fresh export the server has not imported yet. */
export interface ExportPendingEvent { type: 'export-pending'; since: string }
/** A background job (storylines, the briefing) changed state for one club. */
export interface JobEvent { type: 'job'; kind: string; orgId: Integer; status: JobStatus }
/**
 * The server built a club's Front Office again and keeps it (a new import, a settings change, a calibration): its new
 * `reportStamp`. The Mac app's Front Office store reloads on it (a cached read).
 */
export interface FrontOfficeUpdatedEvent { type: 'front-office-updated'; orgId: Integer; reportStamp: string }
/**
 * The minute's look at the saves (D-063) changed what it has to say: another save (or a newer OOTP version's) has been
 * played since the chosen one, the chosen save has gone or come back, or the notice cleared. The payload is the
 * `savePlayedElsewhere` `/api/status` serves (null once nothing is played since). Sent only when the notice changes,
 * never on every look. The app shows it; Pennant never switches by itself.
 */
export interface SavePlayedElsewhereEvent { type: 'save-played-elsewhere'; savePlayedElsewhere: SavePlayedElsewhere | null }

/**
 * A desk status or note changed (N7, D-058): the club's new `deskStamp`, and the item's key (null when several changed,
 * as when an import resolved items). The Mac app re-reads the desk; its own change it already has from the answer.
 */
export interface DeskChangedEvent { type: 'desk-changed'; orgId: Integer; deskStamp: string; key: string | null }
/** What the GM follows changed (a follow, an unfollow, a note, the watchlist copied in): Following's new `followStamp`. */
export interface FollowingChangedEvent { type: 'following-changed'; followStamp: string }
/**
 * A new import's "since the last export" is ready for the club the app follows (N7): the words for the notification
 * ("New export read", "3 new on your desk"), served, with how many new items are to decide (null with nothing to
 * compare). Sent once per import, after its report was recorded.
 */
export interface ChangesReadyEvent {
  type: 'changes-ready';
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  title: string;
  text: string;
  newToDecide: Integer | null;
}

type Listener = (event: ServerEvent) => void;
const listeners = new Set<Listener>();

export function publish(event: ServerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      // One broken connection must never stop the others hearing, or the work that published
      console.error('[events] a listener failed:', err);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const listenerCount = (): number => listeners.size;

/**
 * Progress arrives once per chunk written (hundreds a second on a fast disk). A client needs a bar that moves, not
 * every row, so progress is sent at most this often; the start, a change of file, table or phase, and the finish always
 * go. (Since N3.5 several files are read at once, so the table a step names changes more often than the file count.)
 */
export const PROGRESS_INTERVAL_MS = 200;

export function progressThrottle<P extends ImportStep>(send: (p: P) => void, now: () => number = Date.now): (p: P) => void {
  let last = -Infinity;
  let lastKey = '';
  return (p) => {
    const key = `${p.fileIndex}:${p.phase}:${p.table}`;
    const t = now();
    if (key === lastKey && t - last < PROGRESS_INTERVAL_MS) return;
    last = t;
    lastKey = key;
    send(p);
  };
}

/** A comment line every so often keeps the connection from being judged idle and dropped. */
const HEARTBEAT_MS = 15_000;

/** The `GET /api/v2/events` handler: a `hello` with the current status, then every event as it happens. */
export function eventStream(snapshot: () => ServerStatus) {
  return (req: Request, res: Response): void => {
    res.status(200).set({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.flushHeaders();
    const send = (event: ServerEvent): void => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: 'hello', status: snapshot() });
    const unsubscribe = subscribe(send);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    heartbeat.unref();
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}
