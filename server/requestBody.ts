/**
 * JSON request bodies, read once for the whole server (N13 review L3; B-74, B-75).
 *
 * Express's own answer to a body that isn't JSON is its error page: the parser's message, which quotes the start of the
 * body (a key sent to `POST /api/v2/ai/keys/check`, say), and a stack with the server's paths, written to the response
 * and to stderr. A body that can't be read is answered here instead: a 4xx in words, and a log line naming the route and
 * the kind of failure, never the body or any part of it. The same for every route, the React app's included.
 *
 * Every body has a stated limit: `DEFAULT_BODY_LIMIT`, or the larger one a route in `BODY_LIMITS` needs. A write whose
 * body is not JSON is refused (415): the routes read only JSON, and a body another website can send without asking
 * first (`text/plain`, a form) is exactly the kind a JSON-only server never has to accept (`sameOrigin.ts`, D-081).
 */
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

export const BODY_NOT_JSON = 'Pennant couldn\'t read that request: its body isn\'t valid JSON.';
export const BODY_TOO_LARGE = 'That request is too large for Pennant to read.';
export const BODY_UNREADABLE = 'Pennant couldn\'t read that request.';
export const BODY_NOT_JSON_TYPE = 'Pennant only reads requests sent as JSON.';

/** The limit for a route not listed below: every form, choice and note the apps send is a few kilobytes. */
export const DEFAULT_BODY_LIMIT = '100kb';

/**
 * The routes that need more, and why. The AI conversations resend what was said before with each question; the server
 * reads only their last turns (`ai.ts` `threadKept`, `chat.ts`), but the request must arrive to be read.
 */
export const BODY_LIMITS: ReadonlyArray<{ route: RegExp; limit: string; why: string }> = [
  { route: /^\/api\/v2\/views\/[^/]+\/trades\/ask$/, limit: '1mb', why: 'the Trade Desk thread, resent with every question' },
  { route: /^\/api\/trade\/ai-(eval|reply)$/, limit: '1mb', why: 'the React trade desk thread' },
  { route: /^\/api\/chat$/, limit: '1mb', why: 'the React chat, which sends its conversation' },
  { route: /^\/api\/chat-history\/[^/]+$/, limit: '1mb', why: 'the React chat saving its conversation' },
];

/** The methods that change something, and so may carry a body. */
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

/** The stated limit for a request's path. */
export function bodyLimitFor(path: string): string {
  return BODY_LIMITS.find((l) => l.route.test(path))?.limit ?? DEFAULT_BODY_LIMIT;
}

/** Whether a request carries a body at all (a length above zero, or a chunked one). */
function carriesBody(req: Request): boolean {
  const length = req.headers['content-length'];
  return req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

/** A write with a body that is not JSON is refused before it is read. */
function jsonOnly(req: Request, res: Response, next: NextFunction): void {
  if (!WRITES.has(req.method) || !carriesBody(req) || req.is('application/json')) return next();
  console.warn(`[api] ${req.method} ${req.path}: refused a body that isn't JSON`);
  res.status(415).json({ error: BODY_NOT_JSON_TYPE });
}

/** One parser per stated limit, made once. */
const parsers = new Map<string, RequestHandler>();
function parserFor(limit: string): RequestHandler {
  let parser = parsers.get(limit);
  if (!parser) {
    parser = express.json({ limit });
    parsers.set(limit, parser);
  }
  return parser;
}

function jsonBody(req: Request, res: Response, next: NextFunction): void {
  parserFor(bodyLimitFor(req.path))(req, res, next);
}

/** Reads JSON bodies on every route, within each route's limit, and answers one that can't be read in words. */
export function readJsonBodies(app: Express): void {
  app.use(jsonOnly);
  app.use(jsonBody);
  app.use(bodyRefused);
}
