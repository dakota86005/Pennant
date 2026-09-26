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
} from '../serverEvents.js';
export type { ImportProgress, ImportResult } from '../importer.js';
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
export type { SearchLocations, ResolveFolderRequest, ConfigRequest } from '../api.js';
/** The saves found in the usual places (`GET /api/saves`). */
export type SaveList = SaveInfo[];

// Settings: data status, the save folder, AI keys, the club
export type { DataStatus, LogSourceStatus } from '../dataStatus.js';
export type { SaveSourceRequest, SaveSourceResult } from '../playerStateRoutes.js';
export type { SettingsResponse, ProvidersResponse, ProviderChoice, ApiKeyStatus, KeyStatus, Settings } from '../settings.js';
export type { ProviderId, ProviderInfo } from '../providers.js';
import type { Org } from '../org.js';
export type { Org } from '../org.js';
/** The major-league clubs (`GET /api/orgs`). */
export type OrgList = Org[];
