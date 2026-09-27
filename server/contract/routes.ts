/**
 * Every operation in the presentation contract (D-056, SWIFTUI_REBUILD.md section 4.3): what `npm run contract:build`
 * writes into `contract/openapi.json` as its paths.
 *
 * Two kinds of operation are listed:
 * - everything under `/api/v2/`, which is the Mac app's own API (the drift test fails on a `/v2` route missing here);
 * - reused routes the React app already serves and the Mac app needs, listed one by one as the milestone that first
 *   needs each is built. At N2 that is the app skeleton's (N3): the server's status and import, finding and choosing
 *   the save, data status, settings and key status, and the club list; N3 added saving the settings (the club the
 *   Setup window picks, the appearance). The staff room's chat stream and the jobs
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

/** A club in a `/v2` path: its team id, or `automatic` for the club the app follows (configured, else the human's). */
const ORG_PARAM: OperationParam = {
  name: 'org', in: 'path', schema: 'string', required: true,
  description: 'A team id, or `automatic` for the club the app follows (the configured club, else the one the save\'s human runs).',
};

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
  {
    operationId: 'getCatalog',
    method: 'get',
    path: '/api/v2/catalog',
    summary: 'The glossary, the stat catalog, each club\'s palette, logo and record, and the departments with their heads.',
    response: 'Catalog',
    reused: false,
  },
  {
    operationId: 'getDataStatusWords',
    method: 'get',
    path: '/api/v2/data-status',
    summary: 'How current the data is, in words: the headline with its basis, each source\'s line, the dates and places.',
    response: 'DataStatusView',
    reused: false,
  },

  {
    operationId: 'getFrontOffice',
    method: 'get',
    path: '/api/v2/front-office/:org',
    summary: 'The Morning Report: its masthead (record, place, runs, last five, next game, trade deadline), the lede, "How we win and lose", the roster map, the desk (every department\'s items to decide, in a stated order) and one card per department.',
    params: [ORG_PARAM],
    response: 'FrontOfficeSummary',
    errors: { 404: 'ApiError' },
    reused: false,
  },
  {
    operationId: 'getDepartmentReport',
    method: 'get',
    path: '/api/v2/departments/:org/:dept',
    summary: 'One department\'s full report: prepared by, key figures, to decide, watching, what changed, what we can\'t see.',
    params: [
      ORG_PARAM,
      { name: 'dept', in: 'path', schema: 'string', required: true, description: 'The department\'s id (`majorLeague`, `farm`, ...).' },
    ],
    response: 'DepartmentReport',
    errors: { 404: 'ApiError' },
    reused: false,
  },
  {
    operationId: 'getClaimTrail',
    method: 'get',
    path: '/api/v2/claims/:key',
    summary: 'The evidence trail behind an item, built on demand (an MLB need\'s responses); the key is the item\'s `evidence`.',
    params: [{ name: 'key', in: 'path', schema: 'string', required: true, description: 'An item\'s `evidence` key.' }],
    response: 'ClaimTrail',
    errors: { 404: 'ApiError' },
    reused: false,
  },

  {
    operationId: 'getThemeChoices',
    method: 'get',
    path: '/api/v2/theme-packs/:org',
    summary: 'The themes a club can wear: its own colours (from the save) and each installed theme pack that fits it, with every appearance resolved; the packs refused, and why.',
    params: [ORG_PARAM],
    response: 'ThemeChoices',
    errors: { 404: 'ApiError' },
    reused: false,
  },
  {
    operationId: 'chooseTheme',
    method: 'post',
    path: '/api/v2/theme-packs/:org',
    summary: 'Chooses the theme a club wears (`club-colors` for its own colours). A pack not installed, refused, or made for another club is refused (400).',
    params: [ORG_PARAM],
    request: 'ThemeChoice',
    response: 'ThemeChoices',
    errors: { 400: 'ApiError', 404: 'ApiError' },
    reused: false,
  },
  {
    operationId: 'getSaveDiscovery',
    method: 'get',
    path: '/api/v2/saves',
    summary: 'The saves on this Mac, most recently played first, and the one you\'re playing when it clearly stands out, or why none does.',
    response: 'SaveDiscovery',
    reused: false,
  },
  {
    operationId: 'setUpAutomatically',
    method: 'post',
    path: '/api/v2/setup/automatic',
    summary: 'On a first run, choose and import the save that clearly stands out (and its club, when the save names one), or say why not.',
    response: 'AutomaticSetup',
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
    summary: 'Import the configured save\'s export again; progress arrives on the event stream. Refused (409) while an import runs.',
    response: 'ImportAccepted',
    errors: { 400: 'ApiError', 409: 'ApiError' },
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
    summary: 'Use this save\'s export folder, and import it (or say why the import did not start). Refused (409) while an import runs.',
    request: 'ConfigRequest',
    response: 'ConfigAccepted',
    errors: { 400: 'ApiError', 409: 'ApiError' },
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
    summary: 'The preferences, the active provider\'s key state, the data folder and the current club.',
    response: 'SettingsResponse',
    reused: true,
  },
  {
    operationId: 'saveSettings',
    method: 'post',
    path: '/api/settings',
    summary: 'Change preferences (the club, the appearance, ...); a field left out keeps its value.',
    request: 'SettingsUpdate',
    response: 'SettingsSaved',
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
