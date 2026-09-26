import type { Request, Response } from 'express';
import type { ImportProgress, ImportResult } from './importer.js';
import type { JobStatus } from './jobs.js';

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
  | { type: 'hello'; status: unknown }
  | { type: 'import-started'; startedAt: string }
  | { type: 'import-progress'; progress: ImportProgress }
  | { type: 'import-finished'; lastImport: ImportResult | null; error: string | null }
  | { type: 'export-pending'; since: string }
  | { type: 'job'; kind: string; orgId: number; status: JobStatus };

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
 * every row, so progress is sent at most this often; the start, a change of file or phase, and the finish always go.
 */
export const PROGRESS_INTERVAL_MS = 200;

export function progressThrottle(send: (p: ImportProgress) => void, now: () => number = Date.now): (p: ImportProgress) => void {
  let last = -Infinity;
  let lastKey = '';
  return (p) => {
    const key = `${p.fileIndex}:${p.phase}`;
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
export function eventStream(snapshot: () => unknown) {
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
