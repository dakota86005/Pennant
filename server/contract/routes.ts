/**
 * Every operation in the presentation contract (D-056, SWIFTUI_REBUILD.md section 4.3): what `npm run contract:build`
 * writes into `contract/openapi.json` as its paths.
 *
 * Two kinds of operation are listed:
 * - everything under `/api/v2/`, which is the Mac app's own API (the drift test fails on a `/v2` route missing here);
 * - reused routes the React app already serves and the Mac app needs, listed one by one as the milestone that first
 *   needs each is built. At N2 that is the app skeleton's (N3): the server's status and import, finding and choosing
 *   the save, data status, settings and key status, and the club list. The staff room's chat stream and the jobs
 *   endpoints join at N13, trade analysis at N12. The rest of the legacy routes are not described.
 *
 * Types are named, never written inline: each `request`, `response` and `errors` entry names a type exported from
 * `./index.ts`, so the spec's schemas all come from the server's own TypeScript types.
 */

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export interface OperationParam {
  name: string;
  in: 'path' | 'query';
  schema: 'string' | 'integer' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface Operation {
  /** Unique; becomes the Swift client's method name. */
  operationId: string;
  method: HttpMethod;
  /** The Express path, with `:name` parameters (`/api/player/:id`). */
  path: string;
  summary: string;
  params?: OperationParam[];
  /** The JSON request body's type, when the operation takes one. */
  request?: string;
  /** The 200 response's type; for a stream, the type of each event's JSON `data`. */
  response: string;
  /** Other documented responses: status code to type. */
  errors?: Record<number, string>;
  /** Server-sent events (`text/event-stream`) rather than one JSON body. */
  stream?: boolean;
  /** A route the React app already serves, described for the Mac app, rather than a new `/v2` route. */
  reused: boolean;
}

export const operations: Operation[] = [
  // ── The Mac app's own API (/api/v2) ─────────────────────────────────────
  {
    operationId: 'streamEvents',
    method: 'get',
    path: '/api/v2/events',
    summary: 'Server-sent events: a hello with the status, then import, job and fresh-export news as it happens.',
    response: 'ServerEvent',
    stream: true,
    reused: false,
  },

  // ── Status and import (reused) ──────────────────────────────────────────
  {
    operationId: 'getStatus',
    method: 'get',
    path: '/api/status',
    summary: 'The save, the last import, a running import and a fresh export waiting.',
    response: 'ServerStatus',
    reused: true,
  },
  {
    operationId: 'startImport',
    method: 'post',
    path: '/api/import',
    summary: 'Import the configured save\'s export again; progress arrives on the event stream.',
    response: 'ImportAccepted',
    errors: { 400: 'ApiError' },
    reused: true,
  },

  // ── Setup: finding and choosing the save (reused) ───────────────────────
  {
    operationId: 'listSaves',
    method: 'get',
    path: '/api/saves',
    summary: 'The OOTP saves found in the usual places on this Mac.',
    response: 'SaveList',
    reused: true,
  },
  {
    operationId: 'getSearchLocations',
    method: 'get',
    path: '/api/search-locations',
    summary: 'Where the server looked for saves, so an empty search can say why.',
    response: 'SearchLocations',
    reused: true,
  },
  {
    operationId: 'resolveFolder',
    method: 'post',
    path: '/api/resolve-folder',
    summary: 'Check a folder the user picked: a CSV export, a save, or a folder of saves.',
    request: 'ResolveFolderRequest',
    response: 'ResolveResult',
    errors: { 400: 'ResolveResult' },
    reused: true,
  },
  {
    operationId: 'setSave',
    method: 'post',
    path: '/api/config',
    summary: 'Use this save\'s export folder, and import it.',
    request: 'ConfigRequest',
    response: 'Ok',
    errors: { 400: 'ApiError' },
    reused: true,
  },

  // ── Settings: data status, keys, the club (reused) ──────────────────────
  {
    operationId: 'getDataStatus',
    method: 'get',
    path: '/api/data-status',
    summary: 'How current the save, the export and the transaction log are, and where each was found.',
    response: 'DataStatus',
    reused: true,
  },
  {
    operationId: 'setSaveSource',
    method: 'post',
    path: '/api/save-source',
    summary: 'Name the save folder by hand when it cannot be found from the export; empty returns to automatic.',
    request: 'SaveSourceRequest',
    response: 'SaveSourceResult',
    errors: { 400: 'ApiError' },
    reused: true,
  },
  {
    operationId: 'getSettings',
    method: 'get',
    path: '/api/settings',
    summary: 'The preferences, the active provider\'s key state and the data folder.',
    response: 'SettingsResponse',
    reused: true,
  },
  {
    operationId: 'getProviders',
    method: 'get',
    path: '/api/settings/providers',
    summary: 'The AI providers on offer and every provider\'s key state.',
    response: 'ProvidersResponse',
    reused: true,
  },
  {
    operationId: 'listOrgs',
    method: 'get',
    path: '/api/orgs',
    summary: 'The major-league clubs, the one the save manages flagged, with their colours.',
    response: 'OrgList',
    reused: true,
  },
];
