/**
 * The Mac app's own routes under `/api/v2` (D-056, SWIFTUI_REBUILD.md section 4.2), each listed in
 * `server/contract/routes.ts` (the drift test fails on one that is not). Every sentence they serve is authored in
 * `server/presentation/`; the routes only gather what the specialists already answered. The event stream
 * (`/api/v2/events`) is registered beside the status it opens with, in `api.ts`.
 *
 * A request that fails here answers in words: an `ApiError` whose `error` is a sentence for the GM and whose `detail`
 * is the raw message for the log and a help tag, never a stack or a bare status line.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ApiError } from './api.js';
import { getDataStatus } from './dataStatus.js';
import { catalogClubs } from './org.js';
import { importedAt } from './playerStateRoutes.js';
import { buildCatalog, type Catalog } from './presentation/catalog.js';
import { assertAuthored } from './presentation/claim.js';
import { dataStatusView, type DataStatusView } from './presentation/dataStatusWords.js';
import { currentOrganization } from './viewingOrganization.js';

export const v2Routes = Router();

/**
 * Sends a `/v2` payload after the last check: every claim and basis in it was made by the builder and still meets its
 * rules (`assertAuthored`). A breach is an authoring defect: it throws, and the error handler below answers in words.
 */
function send<T>(res: Response<T>, payload: T): void {
  assertAuthored(payload);
  res.json(payload);
}

/** What the app draws on: glossary, stat catalog, club palettes, logos and records, departments and their heads. */
v2Routes.get('/catalog', (_req, res: Response<Catalog>) => {
  send(res, buildCatalog(catalogClubs(), currentOrganization()?.id ?? null));
});

/** How current the data is, in words. */
v2Routes.get('/data-status', (_req, res: Response<DataStatusView>) => {
  send(res, dataStatusView(getDataStatus({ importedAt: importedAt.value })));
});

/** The sentence for a `/v2` request this build does not serve. */
export const V2_UNKNOWN = 'This version of Pennant doesn\'t know that request. Updating the app should fix it.';
/** The sentence for a `/v2` request that failed on the server. */
export const V2_FAILED = 'Pennant couldn\'t put this together. The details are in the server log.';

v2Routes.use((_req, res: Response<ApiError>) => {
  res.status(404).json({ error: V2_UNKNOWN });
});

v2Routes.use((err: unknown, req: Request, res: Response<ApiError>, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: V2_FAILED, detail: message });
});
