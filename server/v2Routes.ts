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
  FrontOfficeRefusal, UNKNOWN_CLUB, claimTrail, majorLeagueDecision, majorLeagueView, rebuildFrontOfficeLater, resolveOrg,
} from './frontOfficeService.js';
import type { MlbBenchView, MlbDecisionView, MlbOverviewView, MlbPitchingStaffView, MlbPositionPlayersView } from './presentation/majorLeague/types.js';
import { DeskRefusal, departmentReportNow, deskViewNow, frontOfficeSummaryNow, setDeskStatus } from './frontOfficeAttention.js';
import { LeagueRefusal, clubReportNow, followNow, followingView, searchNow, unfollowNow, wireView } from './aroundTheLeague.js';
import type { ClaimTrail, DepartmentReport, DeskChange, DeskView, FrontOfficeSummary } from './presentation/frontOffice/types.js';
import type { ClubReport, FollowChange, Following, SearchAnswer, Wire } from './presentation/frontOffice/leagueTypes.js';
import type { ThemeChoice, ThemeChoices } from './contract/themePack.js';
import { ThemeChoiceRefusal, activePack, chooseTheme, chosenPacks, installedPacks, themeChoices } from './themePackStore.js';
import { currentOrganization } from './viewingOrganization.js';
import { answerHistoryOffer, carryOvers, currentHistoryKey, HistoryChoiceRefusal, historyCandidates, historyDates, historyNote, historyOffers } from './historyIdentity.js';
import { ratingHistoryView, type RatingHistoryChoice, type RatingHistoryView } from './presentation/ratingHistoryWords.js';
import {
  farmAffiliatesNow, farmAssignmentsNow, farmDecisionNow, farmDevelopmentDetailNow, farmDevelopmentNow, farmOrganizationNow, farmProspectsNow,
} from './farmViewService.js';
import type {
  FarmAffiliatesView, FarmAssignmentsView, FarmDecisionView, FarmDevelopmentDetail, FarmDevelopmentView, FarmOrganizationView, FarmProspectsView,
} from './presentation/farm/types.js';
import {
  playerCompareNow, playerDossierJsonNow, playerNotesNow, removeStaffNoteNow, restoreStaffNoteNow, setPlayerNoteNow, undoFirstNoteNow,
} from './playerViewService.js';
import type {
  PlayerCompareView, PlayerNoteChange, PlayerNotesView, StaffNoteChange,
} from './presentation/player/types.js';
import {
  clubhouseDepthNow, clubhouseFortyManNow, clubhouseGamePlanNow, clubhouseLineupNow, clubhousePitchingNow, clubhouseRostersNow,
  clubhouseScheduleNow, clubhouseTrendsNow,
} from './clubhouseViewService.js';
import type {
  MlbDepthChartView, MlbFortyManView, MlbGamePlanView, MlbLineupView, MlbPitchingAvailabilityView, MlbRostersView, MlbScheduleView,
  MlbSeasonTrendsView,
} from './presentation/clubhouse/types.js';
import { TradesRefusal, tradeAnalysisNow, tradeDeskNow } from './tradeDeskService.js';
import { PhilosophyRefusal, coachingStaffNow, philosophyNow, resetPhilosophyNow, setPhilosophyNow } from './philosophyViewService.js';
import type { CoachingStaffView, PhilosophyChange, PhilosophyView } from './presentation/philosophy/types.js';
import type { TradeAnalysisView, TradeDeskView } from './presentation/trades/types.js';

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

/** A Front Office route: its answer, or its refusal in a sentence (a 404 or a 400 the contract documents). */
function frontOffice<T>(answer: (req: Request) => Promise<T>) {
  return (req: Request, res: Response<T | ApiError>, next: NextFunction): void => {
    Promise.resolve().then(() => answer(req)).then((payload) => send(res, payload)).catch((err: unknown) => {
      if (err instanceof FrontOfficeRefusal || err instanceof DeskRefusal || err instanceof LeagueRefusal) res.status(err.status).json({ error: err.message });
      else if (err instanceof TradesRefusal || err instanceof PhilosophyRefusal) res.status(err.status).json({ error: err.message });
      else next(err);
    });
  };
}

/** The Morning Report, for a club (a team id, or `automatic`), with the GM's attention on it (N7). */
v2Routes.get('/front-office/:org', frontOffice<FrontOfficeSummary>((req) => frontOfficeSummaryNow(resolveOrg(String(req.params.org)))));

/** One department's full report. */
v2Routes.get('/departments/:org/:dept', frontOffice<DepartmentReport>((req) =>
  departmentReportNow(resolveOrg(String(req.params.org)), String(req.params.dept))));

// ── Farm & Development's views (N10): one path per view, each its own payload, from the club's kept build ──────────

/** The farm as one organization: system-wide findings, depth by level, starters against spots, the lines it used. */
v2Routes.get('/views/:org/farm/organization', frontOffice<FarmOrganizationView>((req) => farmOrganizationNow(String(req.params.org))));

/** The organization from the major-league club down, and each affiliate read twice (can it play, are its players developing). */
v2Routes.get('/views/:org/farm/affiliates', frontOffice<FarmAffiliatesView>((req) => farmAffiliatesNow(String(req.params.org))));

/** Every minor leaguer's assignment, in the farm's stated order. */
v2Routes.get('/views/:org/farm/assignments', frontOffice<FarmAssignmentsView>((req) => farmAssignmentsNow(String(req.params.org))));

/**
 * One player's assignment, in the order a GM decides, with what follows if he moves (`?player=<id>`, the decision
 * target's key, as Major League Ops' decision takes `?need=`).
 */
v2Routes.get('/views/:org/farm/decision', frontOffice<FarmDecisionView>((req) =>
  farmDecisionNow(String(req.params.org), typeof req.query.player === 'string' ? req.query.player : '')));

/** Player Development's calls: the development meetings and the board. */
v2Routes.get('/views/:org/farm/prospects', frontOffice<FarmProspectsView>((req) => farmProspectsNow(String(req.params.org))));

/** What our scouts have seen over this save's rating history (D-064), and the movers. */
v2Routes.get('/views/:org/farm/development', frontOffice<FarmDevelopmentView>((req) => farmDevelopmentNow(String(req.params.org))));

/** One player's scouting history in this save. */
v2Routes.get('/views/:org/farm/development/:playerId', frontOffice<FarmDevelopmentDetail>((req) =>
  farmDevelopmentDetailNow(String(req.params.org), String(req.params.playerId))));

/** The GM's desk (N7, D-058): every item to decide with its status, and the ones he set aside. */
v2Routes.get('/desk/:org', frontOffice<DeskView>((req) => deskViewNow(resolveOrg(String(req.params.org)))));

/** Marks an item (open, reviewed, deferred until a game date, handled in OOTP); answers with the undo. */
v2Routes.put('/desk/:org', frontOffice<DeskChange>((req) => setDeskStatus(resolveOrg(String(req.params.org)), req.body)));

/** What the GM follows in this save, and the division rivals suggested (N7, D-058). */
v2Routes.get('/following', frontOffice<Following>(() => followingView()));

/** Follows a club or a player, or changes a follow's note. */
v2Routes.put('/following', frontOffice<FollowChange>((req) => followNow(req.body)));

/** Stops following a club or a player (`?kind=club&id=12`). */
v2Routes.delete('/following', frontOffice<FollowChange>((req) => unfollowNow(req.query as Record<string, unknown>)));

/** The league wire (N7, D-059): `?since=<game date>|season`, `club`, `kind`, `followed=first|only`. */
v2Routes.get('/wire/:org', frontOffice<Wire>(async (req) => wireView(String(req.params.org), req.query as Record<string, unknown>)));

/** Another club's report, under our scouting (N7, D-059). */
v2Routes.get('/club/:teamId', frontOffice<ClubReport>((req) => clubReportNow(String(req.params.teamId))));

/** Search: players, clubs and views, with where each opens (`?q=`). */
v2Routes.get('/search', frontOffice<SearchAnswer>(async (req) => searchNow(req.query.q)));

/** The evidence trail behind an item, on demand (an MLB need's responses). */
v2Routes.get('/claims/:key', frontOffice<ClaimTrail>((req) => claimTrail(String(req.params.key))));

/**
 * Major League Ops' views (N8, SWIFTUI_REBUILD.md section 4.2's per-view endpoint): each a payload of its own under
 * `/views/:org/majorLeague/<view>`, served from the club's build (worded with the department's report, warmed after
 * every import).
 */
v2Routes.get('/views/:org/majorLeague/overview', frontOffice<MlbOverviewView>((req) =>
  majorLeagueView(resolveOrg(String(req.params.org)), 'overview')));
v2Routes.get('/views/:org/majorLeague/positionPlayers', frontOffice<MlbPositionPlayersView>((req) =>
  majorLeagueView(resolveOrg(String(req.params.org)), 'positionPlayers')));
v2Routes.get('/views/:org/majorLeague/pitchingStaff', frontOffice<MlbPitchingStaffView>((req) =>
  majorLeagueView(resolveOrg(String(req.params.org)), 'pitchingStaff')));
v2Routes.get('/views/:org/majorLeague/benchBackups', frontOffice<MlbBenchView>((req) =>
  majorLeagueView(resolveOrg(String(req.params.org)), 'benchBackups')));

/** A whole number from a query value, or undefined (a what-if's days). */
const wholeQuery = (value: unknown): number | undefined => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};
const textQuery = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/**
 * One need's decision (`?need=<id>`, with the GM's choices `role`, `context` and `days`, each sent back as a choice
 * served it): built on its first open, kept until the next import.
 */
v2Routes.get('/views/:org/majorLeague/decision', frontOffice<MlbDecisionView>((req) => majorLeagueDecision(resolveOrg(String(req.params.org)), {
  need: textQuery(req.query.need) ?? '',
  role: textQuery(req.query.role),
  context: textQuery(req.query.context),
  days: wholeQuery(req.query.days),
})));

/**
 * The player window (N11): one player's dossier (`?org=` the club it is read for, `automatic` by default), the GM's
 * notes on him, and two to four players side by side. Our club's players are read ahead after each import; any other on
 * his first open; both kept until the next import (`playerViewService.ts`).
 */
const orgQuery = (value: unknown): string => (typeof value === 'string' && value.trim() ? value.trim() : 'automatic');
// The dossier is kept as the JSON this route sends, checked when it was kept (`assertAuthored`): sent as it is (review M5)
v2Routes.get('/player/:id', (req: Request, res: Response<Buffer | ApiError>, next: NextFunction): void => {
  playerDossierJsonNow(String(req.params.id), orgQuery(req.query.org)).then((bytes) => {
    res.type('application/json').send(bytes);
  }).catch((err: unknown) => {
    if (err instanceof FrontOfficeRefusal || err instanceof DeskRefusal || err instanceof LeagueRefusal) res.status(err.status).json({ error: err.message });
    else next(err);
  });
});
v2Routes.get('/player/:id/notes', frontOffice<PlayerNotesView>((req) => playerNotesNow(String(req.params.id))));
v2Routes.put('/player/:id/notes', frontOffice<PlayerNoteChange>((req) => setPlayerNoteNow(String(req.params.id), req.body)));
v2Routes.delete('/player/:id/notes', frontOffice<PlayerNoteChange>((req) => undoFirstNoteNow(String(req.params.id))));
v2Routes.post('/player/:id/staff-notes', frontOffice<StaffNoteChange>((req) => restoreStaffNoteNow(String(req.params.id), req.body)));
v2Routes.delete('/player/:id/staff-notes/:noteId', frontOffice<StaffNoteChange>((req) =>
  removeStaffNoteNow(String(req.params.id), String(req.params.noteId))));
v2Routes.get('/compare', frontOffice<PlayerCompareView>((req) => playerCompareNow(req.query as Record<string, unknown>)));

/**
 * Major League Ops' clubhouse tools (N9, D-069): each a payload of its own, built in the worker after every import and
 * served from the cache; a card asked another way, another game's plan or an affiliate's roster is read on its first
 * open and kept until the next import.
 */
v2Routes.get('/views/:org/majorLeague/lineup', frontOffice<MlbLineupView>((req) =>
  clubhouseLineupNow(String(req.params.org), req.query as Record<string, unknown>)));
v2Routes.get('/views/:org/majorLeague/pitchingAvailability', frontOffice<MlbPitchingAvailabilityView>((req) =>
  clubhousePitchingNow(String(req.params.org))));
v2Routes.get('/views/:org/majorLeague/scheduleGamePlans', frontOffice<MlbScheduleView>((req) =>
  clubhouseScheduleNow(String(req.params.org))));
v2Routes.get('/views/:org/majorLeague/scheduleGamePlans/plan', frontOffice<MlbGamePlanView>((req) =>
  clubhouseGamePlanNow(String(req.params.org), req.query.game)));
v2Routes.get('/views/:org/majorLeague/depthChart', frontOffice<MlbDepthChartView>((req) =>
  clubhouseDepthNow(String(req.params.org))));
v2Routes.get('/views/:org/majorLeague/fortyManOptions', frontOffice<MlbFortyManView>((req) =>
  clubhouseFortyManNow(String(req.params.org))));
v2Routes.get('/views/:org/majorLeague/rosters', frontOffice<MlbRostersView>((req) =>
  clubhouseRostersNow(String(req.params.org), req.query.team)));
v2Routes.get('/views/:org/majorLeague/seasonTrends', frontOffice<MlbSeasonTrendsView>((req) =>
  clubhouseTrendsNow(String(req.params.org))));

/**
 * Trades (N12 Track C, D-073): the Trade Desk (the offers in the inbox, the staff's trade talk, the league's fits, whether
 * the AI desk is on), built after every import for our club and kept; a deal weighed on Player Value (`?sent=&received=`,
 * player ids), kept on the club's inputs. The optional AI desk (`POST …/trades/ask`), which explains the figures and decides
 * nothing, is on the AI router (`ai.ts`), so no module here reaches an AI module (D-001).
 */
v2Routes.get('/views/:org/trades/tradeDesk', frontOffice<TradeDeskView>((req) => tradeDeskNow(String(req.params.org))));
v2Routes.get('/views/:org/trades/analysis', frontOffice<TradeAnalysisView>((req) =>
  tradeAnalysisNow(String(req.params.org), req.query as Record<string, unknown>)));

/**
 * Philosophy & Staff (N12 Track C, D-073): the Organizational Philosophy editor (its identity worded on the server), a
 * change checked whole and answered with what it did and its undo, the reset to neutral, and Coaching Staff.
 */
v2Routes.get('/views/:org/philosophy/organizationalPhilosophy', frontOffice<PhilosophyView>(async (req) => philosophyNow(String(req.params.org))));
v2Routes.put('/views/:org/philosophy/organizationalPhilosophy', frontOffice<PhilosophyChange>(async (req) =>
  setPhilosophyNow(String(req.params.org), req.body)));
v2Routes.delete('/views/:org/philosophy/organizationalPhilosophy', frontOffice<PhilosophyChange>(async (req) =>
  resetPhilosophyNow(String(req.params.org))));
v2Routes.get('/views/:org/philosophy/coachingStaff', frontOffice<CoachingStaffView>(async (req) => coachingStaffNow(String(req.params.org))));

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
  return ratingHistoryView(historyNote(key), historyOffers(key), historyCandidates(key), carryOvers(key), historyDates(key));
}

v2Routes.get('/rating-history', (_req, res: Response<RatingHistoryView>) => {
  send(res, ratingHistoryNow());
});

/** The GM's answer: carry a history over, keep them apart, or undo a carry-over (D-064). */
v2Routes.post('/rating-history/choice', (req: Request, res: Response<RatingHistoryView | ApiError>, next: NextFunction) => {
  const body = (req.body ?? {}) as Partial<RatingHistoryChoice>;
  try {
    if (body.choice !== 'adopt' && body.choice !== 'fresh' && body.choice !== 'undo') throw new HistoryChoiceRefusal('Choose to carry that history over, to keep them apart, or to undo a carry-over.');
    answerHistoryOffer(String(body.offerId ?? ''), body.choice);
    // Carrying a history over or undoing one changes what the reports read (the observed rating history): the kept
    // builds are dropped at once and the Front Office is built again the way every rebuild is (after the refits of an
    // import that is finishing, when they hold it); its `front-office-updated` event tells the Mac app to reload (N6
    // Stage B2). Keeping them apart copies nothing, so nothing is rebuilt.
    if (body.choice !== 'fresh') rebuildFrontOfficeLater();
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
