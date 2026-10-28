/**
 * The Electron shell's guards, kept free of `electron` so they are tested without launching it (B-74; D-081).
 *
 * - The embedded server starts once per process (`serverOnce`, SRVHEALTH-06): the Dock's `activate` used to start a
 *   second one beside the first.
 * - The window's requests to its own server carry the per-launch token (`withServerToken`): the page never holds it,
 *   the session adds it, and only to that server's `/api`.
 * - Only the server's own origin may navigate the window, call the IPC handlers, or be handed the token (`sameOrigin`,
 *   SRVHEALTH-16).
 * - Revealing a folder resolves links first (`insideFolder`), so a link in the data folder cannot reveal anything else.
 *
 * Retired with the Electron build at the cutover (owner decision, 2026-10-28).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * The server's start, run at most once: every caller gets the same answer. A start that failed is not retried here
 * (the shell reports it and quits).
 */
export function serverOnce<T>(start: () => Promise<T>): () => Promise<T> {
  let started: Promise<T> | null = null;
  return () => {
    started ??= start();
    return started;
  };
}

/** Whether `url` is on `serverUrl`'s origin (scheme, host and port), never a look-alike on another port. */
export function sameOrigin(url: string | undefined | null, serverUrl: string | null): boolean {
  if (!url || !serverUrl) return false;
  try {
    return new URL(url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

/**
 * The headers a request from the window goes out with: the token added only for the server's own `/api`, and the
 * window's own copy of it never kept. Anything else is sent as it was.
 */
export function withServerToken(
  url: string, headers: Record<string, string>, serverUrl: string | null, token: string,
): Record<string, string> {
  if (!serverUrl || !sameOrigin(url, serverUrl)) return headers;
  if (!new URL(url).pathname.startsWith('/api/')) return headers;
  const kept = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'));
  return { ...kept, Authorization: `Bearer ${token}` };
}

/** Whether `target` is `root` or inside it once every link in both is resolved; a path that does not exist is not. */
export function insideFolder(root: string, target: string): string | null {
  try {
    const realRoot = fs.realpathSync(path.resolve(root));
    const wanted = fs.realpathSync(path.resolve(target));
    return wanted === realRoot || wanted.startsWith(realRoot + path.sep) ? wanted : null;
  } catch {
    return null;
  }
}
