/**
 * Async route handlers on Express 4 (B-75, SRVHEALTH-01).
 *
 * Express 4 calls a handler and ignores what it returns. A handler written `async` that throws, before its own `try` or
 * outside it, returns a rejected promise nobody listens to: the request is never answered, and on Node 24 the rejection
 * ends the process (the Mac app's server restarts, and after five crashes it gives up for the session). `asyncRoute`
 * hands that rejection to `next`, so it reaches the router's error handler and is answered like any other failure.
 *
 * Every async handler is registered through it; `tests/serverSafety.test.ts` walks the routers and fails on an async
 * function registered bare. Express 5 forwards rejections itself; when the server moves to it, this goes.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return function asyncRouteHandler(req, res, next) {
    handler(req, res, next).catch(next);
  };
}

let logging = false;

/**
 * The process's last net: a rejection nothing handled is logged and the process keeps serving, never exits (the sidecar
 * and `npm run dev` / `npm start`; the Electron main process too). Installed once; the reason is logged by its kind and
 * message, the way every other server failure is.
 */
export function logUnhandledRejections(label: string): void {
  if (logging) return;
  logging = true;
  process.on('unhandledRejection', (reason) => {
    console.error(`[${label}] work failed and nothing caught it (the server keeps running):`, reason);
  });
}
