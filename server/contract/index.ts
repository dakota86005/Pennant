/**
 * The presentation contract's types (D-056, SWIFTUI_REBUILD.md section 4).
 *
 * `npm run contract:build` reads this file with ts-json-schema-generator and writes `contract/openapi.json`, from which
 * the Mac app's client is generated (`macos/Packages/PennantAPI`). Every type an operation in `routes.ts` names is
 * exported here. A type the server already has is re-exported, never copied, so the handler and the contract cannot
 * drift apart; a route that answered an untyped object has its type beside its handler, which is typed against it.
 *
 * Two rules the build applies (section 4.3):
 * - A closed string union becomes an open enum in the spec, so an older app never fails on a new code.
 * - `GameDate` is a string with no format: OOTP writes dates unpadded, and a client never parses one as a date.
 */

// Primitives
export type { GameDate } from '../dataFreshness.js';
export type { Integer } from './primitives.js';

// Errors
export type { ApiError, Ok } from '../api.js';

// The event stream (`GET /api/v2/events`)
export type {
  ServerEvent,
  HelloEvent,
  ImportStartedEvent,
  ImportProgressEvent,
  ImportFinishedEvent,
  ExportPendingEvent,
  JobEvent,
  FrontOfficeUpdatedEvent,
  SavePlayedElsewhereEvent,
  DeskChangedEvent,
  FollowingChangedEvent,
  ChangesReadyEvent,
} from '../serverEvents.js';
export type { ImportProgress, ImportResult, ImportWords } from '../importer.js';
export type { ImportNote } from '../presentation/importWords.js';
export type { JobStatus, JobState } from '../jobs.js';

/**
 * An event this build of the contract does not name, sent by a newer server. The spec lists it last among
 * `ServerEvent`'s shapes, so an older app decodes it (and ignores it) instead of failing the stream.
 */
export interface UnknownServerEvent {
  type: string;
}

// Status and import
export type { ServerStatus, ImportAccepted } from '../api.js';
export type { AppInfo } from '../appInfo.js';

// Setup: finding and choosing the save
import type { SaveInfo } from '../paths.js';
export type { SaveInfo, ResolveResult, SearchLocation } from '../paths.js';
export type { SearchLocations, ResolveFolderRequest, ConfigRequest, ConfigAccepted, AutomaticSetup, SetupClub } from '../api.js';
export type { SavePlayedElsewhere, NoPickReason } from '../saveDiscovery.js';
export type { SaveDiscovery, SaveDiscoveryPick, SaveDiscoveryNoPick } from '../presentation/saveWords.js';
/** The saves found in the usual places (`GET /api/saves`). */
export type SaveList = SaveInfo[];

// Settings: data status, the save folder, AI keys, the club
export type { DataStatus, LogSourceStatus } from '../dataStatus.js';
export type { SaveSourceRequest, SaveSourceResult } from '../playerStateRoutes.js';
export type {
  SettingsResponse, SettingsUpdate, SettingsSaved, ProvidersResponse, ProviderChoice, ApiKeyStatus, KeyStatus, Settings,
} from '../settings.js';
export type { ProviderId, ProviderInfo } from '../providers.js';
export type { CurrentOrganization } from '../viewingOrganization.js';
import type { Org } from '../org.js';
export type { Org } from '../org.js';
/** The major-league clubs (`GET /api/orgs`). */
export type OrgList = Org[];

// Presentation: every sentence the Mac app shows (section 4.1). `Row` is generic; a payload exports a concrete interface extending it.
export type {
  DeptId, Certainty, Tone, Unit, ServedValue, Place, BasisLine, BasisSource, Lean, Basis, TargetKind, Target, Claim, Cell,
} from './presentation.js';

// The catalog (`GET /api/v2/catalog`)
export type {
  Catalog, GlossaryEntry, StatEntry, StatCatalogGroup, StatSection, ClubPalettes, CatalogClub, DepartmentHead,
  CatalogDepartment, CatalogView, CatalogPhrases,
} from '../presentation/catalog.js';
export type { StatFormat } from '../presentation/statCatalog.js';
export type { ClubPalette } from '../presentation/palette.js';

// Theme packs (`GET` and `POST /api/v2/theme-packs/:org`, and each club's `theme` in the catalog)
export type {
  HexColor, ThemeTokens, ThemeVariants, ThemePackKind, ThemePack, RefusedThemePack, ThemeChoices, ThemeChoice,
} from './themePack.js';

// The data status in words (`GET /api/v2/data-status`)
export type { DataStatusView, DataStatusRow, DataStatusFact, GameDateText } from '../presentation/dataStatusWords.js';

// Rating history per save (`GET /api/v2/rating-history`, `POST /api/v2/rating-history/choice`, D-064)
export type {
  RatingHistoryView, RatingHistoryOffer, RatingHistoryCandidate, RatingHistoryCarryOver, RatingHistoryChoice, RatingHistoryPlayers,
} from '../presentation/ratingHistoryWords.js';
export type { RosterEvidenceLevel } from '../dataFreshness.js';

// The Front Office (`GET /api/v2/front-office/:org`, `/departments/:org/:dept`, `/claims/:key`)
export type {
  FoItem, DeskSeverity, ReportStatus, ReportSection, ReportUnknowns, ReportChange, StaffMemo, DepartmentReport, DepartmentCard,
  Desk, DeskMore, FrontOfficeSummary, TrailSection, ClaimTrail,
  DeskStatus, DeskAttention, DeskSetAside, DeskView, DeskUpdate, DeskChange, ChangeItem, ChangeChip, SinceLastExport,
} from '../presentation/frontOffice/types.js';
// Farm & Development's views (N10): `/api/v2/views/:org/farm/…`
export type {
  FarmViewHead, FarmLevelChoice, FarmPlayerLine, FarmEvidenceRow, FarmFactRow, FarmFindingView, FarmDepthRow, FarmDepthSort, FarmStartersRow,
  FarmPlayerRow, FarmLineRow, FarmPastWindow, FarmOrganizationView, FarmClubStep, FarmCoverRow, FarmConcernRow, FarmAffiliateDetail,
  FarmAffiliatesView, FarmAssignmentRow, FarmAssignmentsView, FarmAlternativeRow, FarmWorkRow, FarmCascadeStepView, FarmCascadeView,
  FarmReplacementLine, FarmConsequenceView, FarmRetentionView, FarmDecisionView, FarmFilter, FarmProspectRow, FarmNextAssignment,
  FarmEvaluationRow, FarmProspectCard, FarmProspectsView, FarmDevelopmentTab, FarmDevelopmentRow, FarmSnapshotRow, FarmMovementRow,
  FarmDevelopmentDetail, FarmDevelopmentView,
} from '../presentation/farm/types.js';
// The Office kit every front-office table outside Major League Ops shares (N12, D-071 and D-072), and Finance's and
// Medical's views (N12, D-071): `/api/v2/views/:org/{finance,medical}/…`
export type {
  OfficeClub, OfficeColumn, OfficeFact, OfficeGrid, OfficeRow, OfficeTable, OfficeSection, OfficeChoice, OfficeChoiceGroup,
  OfficeFilter, OfficeFilterGroup, OfficeViewHead,
} from '../presentation/officeTable.js';
export type {
  FinanceContractsView, FinanceFreeAgentDetail, FinanceFreeAgentList, FinanceFreeAgentsView, FinanceProjected, FinancePayrollSeason, FinanceBudgetLine,
  FinanceBudgetEntry, FinancePayrollSection, FinancePayrollView, FinanceBudgetUpdate, FinanceBudgetChange, FinanceHorizonEntry,
  FinanceHorizonCell, FinanceHorizonProspect, FinanceHorizonRow, FinanceHorizonMoney, FinanceHorizonView,
} from '../presentation/finance/types.js';
export type { MedicalInjuryReportView } from '../presentation/medical/injuryReport.js';
// Around the League and Following (N7): the wire, club reports, following, search
export type {
  WireKind, WireSource, WireClub, WirePlayer, WireEntry, WireOrder, WireTop, Wire, WireKindChoice, ClubInjury, ClubReport, FollowedItem,
  FollowSuggestion, Following, FollowUpdate, FollowUndo, FollowChange, SearchKind, SearchResult, SearchGroup, SearchAnswer,
} from '../presentation/frontOffice/leagueTypes.js';
export type { ClubOwed } from '../clubOwed.js';
// The Morning Report's own parts on `FrontOfficeSummary` (N6): the masthead, "How we win and lose", the roster map
export type {
  GameLetter, MastheadKicker, StandingLine, RunsFigure, LastFive, ProbableStarter, TonightGame, DeadlineNote, MastheadPart, MissingPart,
  TeamSeason, ProfileGroup, ProfileGroupHeading, ProfileGroups, ProfileStrip, ProfileLegend, RecentPlace, ProfileDimension, ClubProfile, WinsValue, PlayerRef, ReadinessState, FarmNextMan, FarmBar,
  ControlKind, ControlClock, ControlTerm, HolderRule, RosterNode, StaffPitcher, ValueScale, RosterMap,
} from '../presentation/frontOffice/morningTypes.js';
// Major League Ops' views (N8): `GET /api/v2/views/:org/majorLeague/<view>`
export type {
  MlbPlayer, MlbLine, MlbBlock, MlbAction, MlbColumn, MlbRow, MlbTable, MlbViewHead, MlbGlance, MlbNeedEntry, MlbNeedGroup, MlbWhatIfChoice,
  MlbOverviewView, MlbPositionPlayersView, MlbStaffSection, MlbPitchingStaffView, MlbBenchFunction, MlbBenchView, MlbDecisionQuery, MlbChoice,
  MlbChoices, MlbGauge, MlbWhy, MlbLens, MlbPerson, MlbPicture, MlbCall, MlbPlan, MlbResponses, MlbCandidateGroup, MlbCandidates, MlbConstraint,
  MlbMechanics, MlbDecisionView,
} from '../presentation/majorLeague/types.js';
// The player window and Compare (N11): `GET /api/v2/player/:id`, its notes, and `GET /api/v2/compare`
export type {
  PlayerFact, PlayerColumn, PlayerTableRow, PlayerTable, PlayerTile, PlayerHeaderView, PlayerAssignmentView, PlayerOverview, PlayerRatingRow,
  PlayerRatingGroup, PlayerHistoryPoint, PlayerRatingHistory, PlayerRatingsView, PlayerValueTotal, PlayerOurView, PlayerConeSeason, PlayerConeView,
  PlayerValueView, PlayerRightsAction, PlayerContractView, PlayerLogEntry, PlayerContactView, PlayerHistoryView, PlayerDossierView,
  PlayerStaffNote, PlayerNotesView, PlayerNoteUpdate, PlayerNoteChange, StaffNoteRestore, StaffNoteChange,
  ComparePlayer, CompareCell, CompareRow, CompareSection, PlayerCompareView,
} from '../presentation/player/types.js';
// Major League Ops' clubhouse tools (N9): `GET /api/v2/views/:org/majorLeague/<tool>`
export type {
  MlbTableSection, MlbLineupQuery, MlbLineupChoice, MlbLineupChoices, MlbLineupView, MlbPitchingAvailabilityView, MlbGamePlanQuery,
  MlbScheduleView, MlbGamePlanView, MlbDepthEntry, MlbDepthPosition, MlbDepthClub, MlbDepthChartView, MlbFortyManView, MlbRosterQuery,
  MlbRosterChoice, MlbRostersView, MlbTrendPoint, MlbTrendSeries, MlbTrendChart, MlbSeasonTrendsView,
} from '../presentation/clubhouse/types.js';
// League Office's and Scouting's views (N12 Track B): `GET /api/v2/views/:org/league/<view>`, `/scouting/<view>`
export type {
  LeagueStandingsGroup, LeagueStaffRead,
  LeagueStandingsView, LeagueLeaderGroup, LeagueLeadersView, LeagueOrgComparisonView, LeagueSeasonPoint, LeagueSeasonChart, LeagueChartLegend, LeagueTenure,
  LeagueFranchiseView, LeagueOpponentQuery, LeagueUsVsThemView,
} from '../presentation/league/types.js';
export type {
  ScoutingBoardQuery, ScoutingProspectView, ScoutingMore, ScoutingDraftBoardView, ScoutingSearchToken, ScoutingTokenKind, ScoutingSearchQuery,
  ScoutingPlayerSearchView,
} from '../presentation/scouting/types.js';
// Trades (N12 Track C, D-073): `GET /api/v2/views/:org/trades/tradeDesk`, `…/analysis`, `POST …/ask`
export type {
  TradesViewHead, TradeDeal, TradeDeskPlayer, TradeOffer, TradeTalkTarget, TradeFitLine, TradeFitClub, TradeFitsView, TradeDeskAI,
  TradeDeskView, TradeDealRow, TradeDealSide, TradeRangeChart, TradeDifferenceView, TradeAnalysisView, TradeTurn, TradeAsk,
  TradeAnswerLine, TradeAnswer,
} from '../presentation/trades/types.js';
// Philosophy & Staff (N12 Track C, D-073): `…/philosophy/organizationalPhilosophy` (GET, PUT, DELETE) and `…/coachingStaff`
export type {
  PhilosophyViewHead, PhilosophyDimensionView, PhilosophyGroupView, PhilosophyPolicyOption, PhilosophyPolicyView, PhilosophyComparable,
  PhilosophyIdentity, PhilosophyView, PhilosophySetting, PhilosophyUpdate, PhilosophyChange, StaffSection, CoachingStaffView,
} from '../presentation/philosophy/types.js';
