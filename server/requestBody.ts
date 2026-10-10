/**
 * JSON request bodies, read once for the whole server (N13 review L3).
 *
 * Express's own answer to a body that isn't JSON is its error page: the parser's message, which quotes the start of the
 * body (a key sent to `POST /api/v2/ai/keys/check`, say), and a stack with the server's paths, written to the response
 * and to stderr. A body that can't be read is answered here instead: a 4xx in words, and a log line naming the route and
 * the kind of failure, never the body or any part of it. The same for every route, the React app's included.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

export const BODY_NOT_JSON = 'Pennant couldn\'t read that request: its body isn\'t valid JSON.';
export const BODY_TOO_LARGE = 'That request is too large for Pennant to read.';
export const BODY_UNREADABLE = 'Pennant couldn\'t read that request.';

/** The body parser's own failure: it names its kind (`entity.parse.failed`, ...) and a 4xx status. */
function bodyFailure(err: unknown): { type: string; status: number } | null {
  if (!err || typeof err !== 'object') return null;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500 ? { type, status } : null;
}

/** Answers a body that couldn't be read, in words; anything else goes on to the routes' own handlers. */
export function bodyRefused(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const failure = bodyFailure(err);
  if (!failure) return next(err);
  console.warn(`[api] ${req.method} ${req.path}: the request body couldn't be read (${failure.type})`);
  const error = failure.type === 'entity.parse.failed' ? BODY_NOT_JSON : failure.type === 'entity.too.large' ? BODY_TOO_LARGE : BODY_UNREADABLE;
  res.status(failure.status).json({ error });
}

/** Reads JSON bodies on every route, and answers one that can't be read in words. */
export function readJsonBodies(app: Express): void {
  app.use(express.json());
  app.use(bodyRefused);
}
