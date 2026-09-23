export interface SaveInfo {
  name: string;
  lgPath: string;
  csvDir: string;
  csvCount: number;
  csvLastModified: string | null;
}

export interface Status {
  /** Product name and version, from package.json. Absent in a static export made before it existed. */
  app?: { name: string; version: string; projectUrl: string; upstreamUrl: string };
  csvExportedAt: string | null;
  /** True when running as a static export rather than against a live server. */
  exportedSite?: boolean;
  exportedAt?: string;
  configured: boolean;
  saveName: string | null;
  csvDir: string | null;
  csvDirExists: boolean;
  importing: boolean;
  /**
   * Where a running import has got to. Null when nothing is importing — and
   * briefly null while a very large file is being read, since that stretch is
   * one synchronous parse the server cannot interrupt.
   */
  importProgress?: {
    table: string;
    fileIndex: number;
    files: number;
    rows: number;
    phase: 'reading' | 'writing' | 'indexing';
  } | null;
  lastImport: { tables: number; rows: number; finishedAt: string } | null;
  lastError: string | null;
  hasData: boolean;
  /** ISO time a fresh export was spotted on disk but not yet imported. */
  exportPending: string | null;
  /**
   * Changes with the save. Rides on every logo URL so switching saves does not
   * keep showing the previous one's art for team ids the new save reuses.
   */
  logoToken?: string;
  /** Top of the rating scale this save uses: 80, 20, 10, 8 or 5. */
  ratingScaleMax?: number;
}

export interface Team {
  team_id: number;
  name: string;
  nickname: string | null;
  abbr: string | null;
  level: number | null;
  parent_team_id: number | null;
  league_id: number | null;
}

export interface RosterPlayer {
  player_id: number;
  first_name: string | null;
  last_name: string | null;
  age: number | null;
  position: number | null;
  positionName: string;
  batsName: string;
  throwsName: string;
  uniform_number: number | null;
  ratings: Record<string, number>;
  /** Season fielding, summed across positions. Null when he has not fielded. */
  fielding: Record<string, number | null> | null;
  oaRating: number | null;
  potRating: number | null;
  batting: Record<string, number | null> | null;
  pitching: Record<string, number | null> | null;
  /** Batted-ball quality. Null for pitchers and anyone yet to put one in play. */
  contact: Record<string, number | null> | null;
  /** DFA, waivers, injured list or plain active — and whether he can be used. */
  standing: { label: string; daysLeft: number | null; available: boolean } | null;
  /** Why he is where he is, when the log and export together establish it. */
  assignment: AssignmentContext | null;
}

export type AssignmentKind =
  | 'rehab_assignment' | 'optioned' | 'recalled' | 'purchased_contract'
  | 'designated_for_assignment' | 'waivers' | 'injured_list' | 'restricted_list'
  | 'unattributed';

/** Where a fact came from; see D-020. */
export type Provenance = 'explicit_export' | 'explicit_log' | 'observed_snapshot' | 'derived' | 'unknown';

export interface AssignmentContext {
  kind: AssignmentKind;
  label: string;
  /** What `since` is the date of, e.g. "Sent on rehab". */
  sinceLabel: string | null;
  /** ISO date. */
  since: string | null;
  /** True only when the evidence shows an ordinary option; null when not established. */
  ordinaryOption: boolean | null;
  provenance: Provenance;
  /** Display source, e.g. "OOTP transaction log". */
  source: string;
  note?: string | null;
  reason?: string;
}

export type RightsAction =
  | 'option' | 'recall' | 'addToFortyMan' | 'designateForAssignment'
  | 'outrightAssignment' | 'activateFromInjuredList' | 'placeOnSixtyDayIl';
export type RightsStatus = 'eligible' | 'ineligible' | 'indeterminate';
export type SourceState = 'current' | 'behind' | 'unverified' | 'unavailable';

export interface ActionRights {
  action: RightsAction;
  status: RightsStatus;
  label: string;
  reasons: Array<{ code: string; message: string; basis: 'export_state' | 'observed' | 'documented' | 'observed_and_documented' | 'owner_attested'; source: string }>;
  requirements: Array<{ kind: string; status: 'met' | 'unmet' | 'unknown'; message: string }>;
  missing: Array<{ code: string; message: string }>;
  facts: Record<string, string | number | boolean | null>;
  limitation: string | null;
}

export interface PlayerRights {
  playerId: number;
  evidence: { currentState: SourceState; chronology: SourceState };
  optionYears: {
    used: number | null; remaining: number | null; usedThisSeason: number | null;
    standing: 'available' | 'exhausted' | 'exhausted_charged_this_season' | 'indeterminate';
  };
  ruleFive: { status: 'protected_by_forty_man' | 'not_applicable' | 'indeterminate'; message: string };
  actions: Record<RightsAction, ActionRights>;
}

export type RosterEvidenceLevel = 'current' | 'partial' | 'stale' | 'unavailable';

export interface DataStatus {
  generatedAt: string;
  configured: boolean;
  save: {
    found: boolean;
    name: string | null;
    lgPath: string | null;
    discovery: 'csv_layout' | 'ancestor_lg' | 'save_name_match' | 'manual_override' | 'not_found';
    discoveryNotes: string[];
    simulatedThrough: string | null;
    dateSource: string | null;
  };
  csv: {
    currentDate: string | null;
    simulatedThrough: string | null;
    exportedAt: string | null;
    importedAt: string | null;
  };
  transactionLog: {
    found: boolean;
    readable: boolean;
    error: { code: string; message: string } | null;
    unavailableReason: 'save_not_found' | 'database_missing' | 'unreadable' | null;
    coverage: { lastTransactionDate: string | null; coveredThrough: string | null } | null;
    counts: { events: number; unsupported: number } | null;
  };
  freshness: {
    level: RosterEvidenceLevel;
    save: { simulatedThrough: string | null };
    csv: { state: 'current' | 'behind' | 'unverified' | 'unavailable'; through: string | null; currentDate: string | null; lagDays: number };
    log: { state: 'current' | 'behind' | 'unverified' | 'unavailable'; through: string | null; lagDays: number };
    headline: string;
    reasons: string[];
    action: string | null;
  };
}

export interface RosterResponse {
  players: RosterPlayer[];
  ratingMax: number;
  ratingKeys: string[];
}

export async function apiGet<T>(url: string): Promise<T> {
  return json<T>(url);
}
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return json<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  return json<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
export async function apiDelete<T>(url: string): Promise<T> {
  return json<T>(url, { method: 'DELETE' });
}

/**
 * A static export is a folder of files, so an API path has to become a filename.
 * Must stay identical to exportPath in server/exporter.ts — the two agree on
 * where every file lives, and a query string is folded into the name because a
 * static host ignores it.
 */
const exportPath = (url: string): string =>
  '/api/' + url.replace(/^\/?api\//, '').replace(/[?&=]/g, '_');

/**
 * Set once at boot from /api/status. A static export has no server behind it,
 * so reads are redirected to files and writes are hidden from the UI entirely.
 */
let staticSite = false;
export const isStaticSite = (): boolean => staticSite;
export const setStaticSite = (value: boolean): void => {
  staticSite = value;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(staticSite && url.startsWith('/api/') ? exportPath(url) : url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface SearchLocation {
  label: string;
  path: string;
  exists: boolean;
}
export interface ResolveResult {
  ok: boolean;
  csvDir?: string;
  saveName?: string;
  csvCount?: number;
  saves?: SaveInfo[];
  error?: string;
}

export const getSearchLocations = () =>
  json<{ platform: string; locations: SearchLocation[] }>('/api/search-locations');
export const resolveFolder = (path: string) => apiPost<ResolveResult>('/api/resolve-folder', { path });

/** Mirrors UpdateState in electron/updater.ts. */
export type UpdateState =
  | { status: 'unsupported'; version: string; reason: string }
  | { status: 'idle'; version: string }
  | { status: 'checking'; version: string }
  | { status: 'current'; version: string; checkedAt: string }
  | { status: 'available'; version: string; newVersion: string; notes: string | null; releaseUrl: string }
  | { status: 'downloading'; version: string; newVersion: string; percent: number }
  | { status: 'ready'; version: string; newVersion: string }
  | { status: 'error'; version: string; message: string };

export interface UpdateBridge {
  state: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<void>;
  openReleases: () => Promise<void>;
  onState: (handler: (state: UpdateState) => void) => () => void;
}

export interface DesktopBridge {
  isDesktop: true;
  selectFolder: (defaultPath?: string) => Promise<string | null>;
  openPath: (target: string) => Promise<void>;
  /** Absent in builds packaged before auto-update shipped. */
  update?: UpdateBridge;
}
/** Present only inside the desktop app; the browser build falls back to typing a path. */
export const desktopBridge = (): DesktopBridge | null =>
  (window as unknown as { desktop?: DesktopBridge }).desktop ?? null;

export const getSaves = () => json<SaveInfo[]>('/api/saves');
export const getStatus = () => json<Status>('/api/status');
export const getDataStatus = () => json<DataStatus>('/api/data-status');
/** Fallback only: names the `<save>.lg` folder by hand. An empty path returns to automatic. */
export const setSaveSource = (lgPath: string) =>
  json<{ ok: boolean; status: DataStatus }>('/api/save-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lgPath }),
  });
export const getTeams = () => json<Team[]>('/api/teams');
export const getRoster = (teamId: number) => json<RosterResponse>(`/api/roster/${teamId}`);
export interface Org {
  team_id: number;
  label: string;
  isHuman: boolean;
  colors: { bg: string | null; fg: string | null; secondary: string | null; cap: string | null };
}

export interface Storyline {
  category: string;
  headline: string;
  body: string;
}

export interface StorylineCache {
  generatedAt?: string;
  gameDate?: string | null;
  orgLabel?: string;
  /** Null before any set has been written for this club. */
  storylines: Storyline[] | null;
  /** Set when the chosen model could not be used and another answered. */
  notice?: { message: string; from: string; to: string; provider: string } | null;
  /** How a background generation is getting on, when one is or was running. */
  job?: { state: 'idle' | 'running' | 'done' | 'error'; startedAt: string | null; finishedAt: string | null; error: string | null };
}

export interface PlayerDossier {
  player_id: number;
  name: string;
  nickname: string | null;
  age: number;
  dob: string;
  heightWeight: string | null;
  bats: string;
  throws: string;
  positionName: string;
  roleName: string | null;
  uniform: number | null;
  team: string | null;
  serviceYears: number | null;
  /** Why he is where he is, when the log and export together establish it. */
  assignment: AssignmentContext | null;
  /** What may be done with him, and how sure that is. */
  rights: PlayerRights | null;
  overallPct: number | null;
  talentPct: number | null;
  /** OOTP's own Overall / Potential on the 20-80 scale, for cross-reference. */
  oaRating: number | null;
  potRating: number | null;
  isPitcher: boolean;
  battingRatings: Record<string, [number, number]> | null;
  pitchingRatings: Record<string, [number, number]> | null;
  velocity: string | null;
  pitches: Array<{ name: string; rating: number; talent: number }>;
  fieldingRatings: Record<string, number> | null;
  /** His grade at each position he can play, on the 20-80 scale. */
  positionRatings?: Array<{
    position: number;
    code: string;
    current: number;
    potential: number;
    experience: number;
    isPrimary: boolean;
  }>;
  contract: {
    salaryNow: number;
    totalYears: number;
    yearsAfterThis: number;
    endYear: number;
    noTrade: boolean;
    salarySchedule: Array<{ year: number; salary: number }>;
  } | null;
  battingYears: Array<Record<string, number | string | null>>;
  pitchingYears: Array<Record<string, number | string | null>>;
  gameLogs: Array<Record<string, number | string | null>>;
  pitchingGameLogs: Array<Record<string, number | string | null>>;
  /** Batted-ball quality, and the league's for scale. Null for pitchers. */
  contact: Record<string, number | null> | null;
  contactLeague: { avgExitVelo: number; hardHitPct: number; barrelPct: number; sprintSpeed: number } | null;
  /** Base-out and count splits. Small samples — each carries its own PA count. */
  splits: Array<{ label: string; pa: number; ba: number | null; ops: number | null }>;
  careerEarnings: number | null;
  injuryHistory: Array<Record<string, number | string | null>>;
  currentInjury: { status: string; daysLeft: number | null } | null;
  awards?: Array<{ year: number; award: string; positionName: string | null; rank: number }>;
  fieldingYears?: Array<{
    year: number; levelName: string; positionName: string;
    g: number; gs: number; innings: number; po: number; a: number; e: number; dp: number;
    fpct: number | null; rf9: number | null;
  }>;
  leagueLeader?: Array<{ year: number; category: string; place: number; amount: number }>;
}

export const getPlayer = (id: number) => json<PlayerDossier>(`/api/player/${id}`);

/**
 * The player card's production cone, as Player Value serves it (server/playerValueCone.ts): expected
 * wins per season with the 80% and 50% bands, each season's control, coverage target beside what the
 * save's fit observed (null when not measured), and the calibration status line. Nothing here is
 * recomputed in the browser.
 */
export interface ConeBand { low: number; high: number }
export interface ConeCoverage { target: number; observed: number | null }
export interface ConeLabels { label: string; short: string; code: string }
export interface ConeSeason {
  season: number;
  age: number;
  central: number;
  outer: ConeBand;
  inner: ConeBand;
  toDate: number | null;
  usage: Array<{ unit: 'PA' | 'BF'; low: number; central: number; high: number }>;
  coverage: { outer: ConeCoverage; inner: ConeCoverage; cases: number | null; note: string };
  control: ConeLabels & { status: string; detail: string; after: ConeLabels | null };
  notes: string[];
}
export interface ProductionCone {
  playerId: number;
  status: 'projected' | 'unknown';
  reason: string | null;
  unit: string;
  seasons: ConeSeason[];
  basis: string;
  control: { standing: 'held' | 'unsigned' | 'unknown'; note: string | null };
  calibration: { source: 'save_fit' | 'fallback_prior'; calibrated: boolean; status: string; detail: string };
}
export const getProductionCone = (id: number) => json<ProductionCone>(`/api/player-value/${id}/cone`);
export const getStorylines = (orgId: number) => json<StorylineCache | null>(`/api/storylines/${orgId}`);
export const generateStorylines = (orgId: number) =>
  json<StorylineCache>(`/api/storylines/${orgId}`, { method: 'POST' });

export interface DepthTeam {
  team_id: number;
  label: string;
  level: number;
  levelName: string;
}

export interface DepthPlayer {
  player_id: number;
  team_id: number;
  name: string;
  age: number;
  position: number;
  role: number;
  cur: number | null;
  pot: number | null;
}

export type ProspectRecommendation =
  | 'hold'
  | 'watch'
  | 'consider_promotion'
  | 'strong_promotion_case'
  | 'mlb_ready_discussion'
  | 'consider_demotion';

export interface ProspectDecision {
  evidence: {
    performance: number;
    ageLevelUrgency: number;
    ratingsMaturity: number;
    sampleConfidence: number;
    readiness: number;
  };
  development: {
    promotionThreshold: number;
    ageThresholdAdjustment: number;
  };
  recommendation: ProspectRecommendation;
  confidence: 'limited' | 'moderate' | 'high';
  nextAssignment: {
    level: number;
    levelName: string;
    teams: Array<{
      teamId: number;
      label: string;
    }>;
    isMajorLeague: boolean;
  } | null;
  demotionAssignment: {
    level: number;
    levelName: string;
    teams: Array<{
      teamId: number;
      label: string;
    }>;
    isMajorLeague: boolean;
  } | null;
  positives: string[];
  cautions: string[];
}

export interface Prospect {
  player_id: number;
  name: string;
  age: number;
  team: string;
  level: number;
  levelName: string;
  cur: number | null;
  pot: number | null;
  ageDiff: number | null;
  reasons: string[];

  /** Player Development's transparent analysis. Absent when he has no qualifying line at his level. */
  decision?: ProspectDecision;
  war: number;
  // batters
  pa?: number;
  opsVal?: number;
  hr?: number;
  sb?: number;
  // pitchers
  role?: number;
  ip?: number;
  era?: number;
  kpct?: number;
}

export interface ProspectsResponse {
  batters: Prospect[];
  pitchers: Prospect[];
}

export interface TeamFinances {
  budget: number;
  payroll: number;
  payrollNextSeason: number;
  cash: number;
  market: number;
  fanInterest: number;
}

export interface ContractRow {
  player_id: number;
  name: string;
  age: number;
  positionName: string;
  salaryNow: number;
  totalYears: number;
  yearsAfterThis: number;
  endYear: number;
  serviceYears: number | null;
  overallPct: number | null;
  talentPct: number | null;
  flags: string[];
  /** Present only when a signed extension starts after the current deal. */
  extension: { years: number; startYear: number; endYear: number; firstSalary: number } | null;
  recommendation: { action: string; reasons: string[] } | null;
  /** What happens after this season (Player Value's control timeline); `reason` says why, or what is missing. */
  control?: {
    status: string; arbYear: number | null; arbYearHigh: number | null; superTwo?: boolean; between: string[]; reason: string | null;
  } | null;
}

export interface ContractsResponse {
  seasonYear: number;
  gameDate: string | null;
  finances: TeamFinances | null;
  players: ContractRow[];
}

export interface FreeAgentRow {
  player_id: number;
  name: string;
  age: number;
  positionName: string;
  team: string | null;
  overallPct: number | null;
  talentPct: number | null;
  lastSalary: number | null;
}

export interface FreeAgentsResponse {
  finances: TeamFinances | null;
  holes: Array<{ position: number; positionName: string; bestValue: number | null }>;
  currentFAs: FreeAgentRow[];
  upcomingFAs: FreeAgentRow[];
  /** Expiring deals whose control after this season the export cannot establish. */
  upcomingIndeterminate?: number;
}

export interface LineupSlot {
  slot: number;
  player_id: number;
  name: string;
  positionName: string;
  /** OOTP's 20-80 fielding rating at the position he is assigned. */
  defRating?: number | null;
  bats: string;
  /** Playable but carrying something, so the card flags him rather than deciding. */
  dayToDay?: boolean;
  off: number;
  why: string;
  pa: number | null;
  ops: number | null;
  opsPlus: number | null;
  wrcPlus: number | null;
  war: number | null;
}

export interface LineupResponse {
  vs: 'r' | 'l';
  style: 'saber' | 'trad';
  /** Whether this card was built with a DH — the league rule unless overridden. */
  usesDH?: boolean;
  /** What the league itself says, regardless of the override. */
  leagueUsesDH?: boolean;
  dhOverridden?: boolean;
  /**
   * What the pairwise search did to the card the slot rule wrote. Null when it
   * was skipped — too little season played — or moved nobody worth moving.
   */
  runSearch?: {
    seededRuns: number; optimisedRuns: number; gain: number;
    evaluations: number; moved: boolean;
  } | null;
  lineup: LineupSlot[];
  bench: Array<{ player_id: number; name: string; positionName: string; off: number }>;
  /** On the roster but out tonight — named so a missing star reads as injured
   *  rather than as a broken card. */
  unavailable: Array<{
    player_id: number;
    name: string;
    positionName: string;
    status: string;
    daysLeft: number | null;
  }>;
}

export const getContracts = (orgId: number) => json<ContractsResponse>(`/api/contracts/${orgId}`);
export const getFreeAgents = (orgId: number) => json<FreeAgentsResponse>(`/api/free-agents/${orgId}`);
export const getLineup = (
  teamId: number,
  vs: 'r' | 'l',
  style: 'saber' | 'trad',
  dh: 'auto' | 'on' | 'off' = 'auto',
  sort: 'talent' | 'production' = 'talent'
) => json<LineupResponse>(`/api/lineup/${teamId}?vs=${vs}&style=${style}&dh=${dh}&sort=${sort}`);
export const getOrgs = () => json<Org[]>('/api/orgs');
export const getDepthChart = (orgId: number) =>
  json<{ teams: DepthTeam[]; players: DepthPlayer[] }>(`/api/depth-chart/${orgId}`);
export const getProspects = (orgId: number) => json<ProspectsResponse>(`/api/prospects/${orgId}`);
export const setConfig = (csvDir: string, saveName: string) =>
  json<{ ok: boolean }>('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csvDir, saveName }),
  });
export const triggerImport = () => json<{ ok: boolean }>('/api/import', { method: 'POST' });

export interface SiteExportResult {
  outDir: string;
  files: number;
  bytes: number;
  players: number;
  warnings: string[];
}
export const exportStaticSite = (orgId: number) =>
  apiPost<SiteExportResult>(`/api/export-site/${orgId}`);

export interface ExportProgress {
  running: boolean;
  phase: string;
  done: number;
  total: number;
}
export const getExportProgress = () => apiGet<ExportProgress>('/api/export-site/progress');
