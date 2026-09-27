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
import {
  FrontOfficeRefusal, UNKNOWN_CLUB, claimTrail, departmentReport, frontOfficeSummary, resolveOrg,
} from './frontOfficeService.js';
import type { ClaimTrail, DepartmentReport, FrontOfficeSummary } from './presentation/frontOffice/types.js';
import type { ThemeChoice, ThemeChoices } from './contract/themePack.js';
import { ThemeChoiceRefusal, activePack, chooseTheme, chosenPacks, installedPacks, themeChoices } from './themePackStore.js';
import { currentOrganization } from './viewingOrganization.js';
import { answerHistoryOffer, currentHistoryKey, HistoryChoiceRefusal, historyNote, historyOffers } from './historyIdentity.js';
import { ratingHistoryView, type RatingHistoryChoice, type RatingHistoryView } from './presentation/ratingHistoryWords.js';

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
  // The installed packs and each club's choice are read once for every club in the catalog
  const installed = installedPacks();
  const chosen = chosenPacks();
  send(res, buildCatalog(catalogClubs(), currentOrganization()?.id ?? null, (club) => activePack(club, installed, chosen).pack));
});

/** How current the data is, in words. */
v2Routes.get('/data-status', (_req, res: Response<DataStatusView>) => {
  send(res, dataStatusView(getDataStatus({ importedAt: importedAt.value })));
});

/** A Front Office route: its answer, or its refusal in a sentence (a 404 the contract documents). */
function frontOffice<T>(answer: (req: Request) => Promise<T>) {
  return (req: Request, res: Response<T | ApiError>, next: NextFunction): void => {
    Promise.resolve().then(() => answer(req)).then((payload) => send(res, payload)).catch((err: unknown) => {
      if (err instanceof FrontOfficeRefusal) res.status(err.status).json({ error: err.message });
      else next(err);
    });
  };
}

/** The Morning Report's desk and department cards, for a club (a team id, or `automatic`). */
v2Routes.get('/front-office/:org', frontOffice<FrontOfficeSummary>((req) => frontOfficeSummary(resolveOrg(String(req.params.org)))));

/** One department's full report. */
v2Routes.get('/departments/:org/:dept', frontOffice<DepartmentReport>((req) =>
  departmentReport(resolveOrg(String(req.params.org)), String(req.params.dept))));

/** The evidence trail behind an item, on demand (an MLB need's responses). */
v2Routes.get('/claims/:key', frontOffice<ClaimTrail>((req) => claimTrail(String(req.params.key))));

/** The club a theme route is about (a team id, or `automatic`), with its colours as the export has them. */
function themedClub(param: string) {
  const id = resolveOrg(param);
  const club = catalogClubs().find((c) => c.team_id === id);
  if (!club) throw new FrontOfficeRefusal(UNKNOWN_CLUB, 404);
  return club;
}

/** The themes a club can wear (its own colours and the installed packs that fit it), and the one it wears. */
v2Routes.get('/theme-packs/:org', frontOffice<ThemeChoices>(async (req) => themeChoices(themedClub(String(req.params.org)))));

/** Chooses the theme a club wears; a pack that is not installed, was refused or is made for another club is refused. */
v2Routes.post('/theme-packs/:org', (req: Request, res: Response<ThemeChoices | ApiError>, next: NextFunction) => {
  try {
    send(res, chooseTheme(themedClub(String(req.params.org)), (req.body as Partial<ThemeChoice> | undefined)?.packId));
  } catch (err) {
    if (err instanceof ThemeChoiceRefusal || err instanceof FrontOfficeRefusal) res.status(err.status).json({ error: err.message });
    else next(err);
  }
});

/** This save's rating history (D-064): what isn't used or started fresh, and any earlier save it could be. */
function ratingHistoryNow(): RatingHistoryView {
  const key = currentHistoryKey();
  return ratingHistoryView(historyNote(key), historyOffers(key));
}

v2Routes.get('/rating-history', (_req, res: Response<RatingHistoryView>) => {
  send(res, ratingHistoryNow());
});

/** The GM's answer to "is this the save that used to be at...?": carry that history over, or start fresh. */
v2Routes.post('/rating-history/choice', (req: Request, res: Response<RatingHistoryView | ApiError>, next: NextFunction) => {
  const body = (req.body ?? {}) as Partial<RatingHistoryChoice>;
  try {
    if (body.choice !== 'adopt' && body.choice !== 'fresh') throw new HistoryChoiceRefusal('Choose to carry that history over or to start fresh.');
    answerHistoryOffer(String(body.offerId ?? ''), body.choice);
    send(res, ratingHistoryNow());
  } catch (err) {
    if (err instanceof HistoryChoiceRefusal) res.status(err.status).json({ error: err.message });
    else next(err);
  }
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
