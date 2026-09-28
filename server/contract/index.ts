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
} from '../presentation/frontOffice/types.js';
// The Morning Report's own parts on `FrontOfficeSummary` (N6): the masthead, "How we win and lose", the roster map
export type {
  GameLetter, MastheadKicker, StandingLine, RunsFigure, LastFive, ProbableStarter, TonightGame, DeadlineNote, MastheadPart, MissingPart,
  TeamSeason, ProfileGroup, ProfileGroupHeading, ProfileGroups, ProfileStrip, ProfileLegend, RecentPlace, ProfileDimension, ClubProfile, WinsValue, PlayerRef, ReadinessState, FarmNextMan, FarmBar,
  ControlKind, ControlClock, ControlTerm, HolderRule, RosterNode, StaffPitcher, ValueScale, RosterMap,
} from '../presentation/frontOffice/morningTypes.js';
