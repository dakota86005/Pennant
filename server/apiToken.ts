import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * The bearer token the Mac app's sidecar requires on every `/api` request (D-055).
 *
 * The sidecar listens on 127.0.0.1 at a random port, which keeps other machines out but not other programs run by
 * the same user, and not a web page that finds the port. The Mac app makes a fresh token for each launch and hands
 * it over on stdin (`server/sidecar.ts`), so only the process that started the server can talk to it. The
 * Electron build and `npm run dev` set no token and keep answering as before: the middleware does nothing until
 * `setApiToken` is called.
 */
let token: Buffer | null = null;
let raw: string | null = null;

/** The shortest token accepted: 32 characters (the app sends 64 hex characters, 256 bits). */
export const MIN_TOKEN_LENGTH = 32;

export function setApiToken(value: string): void {
  if (value.length < MIN_TOKEN_LENGTH) throw new Error(`The API token must be at least ${MIN_TOKEN_LENGTH} characters.`);
  raw = value;
  token = digest(value);
}

/** Hashed first, so the comparison is constant-time whatever length the caller sent. */
const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** The headers the server's own calls to its API carry (the assistant's tools, the static-site export). */
export function ownApiHeaders(): Record<string, string> {
  return raw ? { authorization: `Bearer ${raw}` } : {};
}

/** The server's own API on loopback, for the self-calls that read it the way the UI does. */
export function ownApiUrl(port: string, apiPath: string): string {
  return `http://127.0.0.1:${port}/api/${apiPath.replace(/^\//, '')}`;
}

export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
  if (!token) return next();
  const header = req.headers.authorization ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (match && timingSafeEqual(digest(match[1]), token)) return next();
  res.status(401).json({ error: 'This server only answers the app that started it.' });
}
