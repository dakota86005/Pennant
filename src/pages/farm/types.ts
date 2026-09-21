/*
 * The shapes `GET /api/farm-operations/:orgId` returns, as the views read them.
 *
 * Mirrors the server's own types (`server/farm*.ts`) rather than importing them, the same way
 * `src/pages/mlb/types.ts` does: the client is a consumer of the API, not of the server's modules.
 */

export type FindingSeverity = 'critical' | 'attention' | 'noted';
export type FindingLens = 'operational' | 'developmental';

export interface FarmEvidenceItem {
  label: string;
  value: string;
  basis: string;
}

export interface FarmFinding {
  id: string;
  code: string;
  lens: FindingLens;
  severity: FindingSeverity;
  owner: 'minor_league_operations' | 'player_development';
  headline: string;
  evidence: FarmEvidenceItem[];
  players: Array<{ playerId: number; name: string; note: string }>;
  missing: string[];
  wouldResolve: string[];
}

export type WorkLevel = 'regular' | 'part_time' | 'occasional' | 'not_used' | 'bat_only' | 'unknown';

export interface WorkShare {
  playerId: number;
  name: string;
  age: number;
  tier: string | null;
  level: WorkLevel;
  share: number | null;
  basis: string;
}

export interface PlayingTimeConflict {
  teamId: number;
  job: { kind: 'position'; position: string } | { kind: 'rotation' } | { kind: 'relief' };
  capacity: number;
  claimants: WorkShare[];
  /** Men getting innings at the job whose primary job is elsewhere: ahead of a claimant, counted against nobody. */
  alsoPlaying: WorkShare[];
  squeezed: WorkShare[];
  severity: 'blocking' | 'crowded' | 'noted';
  unknowns: string[];
}

/** Only a shortage is an operational state; carrying extra men is a developmental matter. */
export type RosterStatus = 'critical' | 'thin' | 'healthy';

export interface AffiliateView {
  teamId: number;
  label: string;
  level: number;
  levelName: string;
  leagueId: number;
  leagueName: string;
  games: number;
  operational: {
    status: RosterStatus;
    roster: { total: number; positionPlayers: number; pitchers: number; dayToDay: number };
    coverage: Array<{ position: string; graded: number; listedOnly: number; strong: number; critical: boolean }>;
    canFieldDefense: boolean;
    fieldablePositions: number;
    pitching: { starters: number; relievers: number; rotationSpots: number };
    findings: FarmFinding[];
    unknowns: string[];
  };
  developmental: {
    assessment: { assessed: number; indeterminate: number; notAssessable: number; reasons: Record<string, number> };
    concerns: Array<{ playerId: number; name: string; age: number; verdict: string; question: string; summary: string }>;
    conflicts: PlayingTimeConflict[];
    findings: FarmFinding[];
  };
  rosterTreatment: {
    rehab: Array<{ playerId: number; name: string }>;
    ambiguous: Array<{ playerId: number; name: string; reason: string }>;
    injured: Array<{ playerId: number; name: string; listedPosition: string; daysLeft: number | null }>;
  };
  unknowns: string[];
}

export interface AssignmentReview {
  playerId: number;
  name: string;
  age: number;
  kind: 'hitter' | 'pitcher';
  teamId: number;
  team: string;
  level: number;
  levelName: string;
  leagueName: string;
  protection: { score: number | null; tier: string | null; reasons: string[]; missingEvidence: Array<{ dimension: string; detail: string }> };
  production: {
    aboveLeague: number | null;
    percentile: number | null;
    leagueName: string;
    rates: { woba: number | null; ops: number | null; era: number | null; peripherals: number | null; strikeoutRate: number | null; walkRate: number | null };
    leagueContext: { woba: number; era: number };
    sample: { opportunities: number; clubGames: number; reliability: number; mature: boolean };
    unassessable: string | null;
    unassessableDetail: string | null;
  };
  current: {
    verdict: string;
    standing: string;
    window: string;
    parts: Array<{ label: string; value: string; basis: string }>;
    reasons: string[];
    question: string;
    missingEvidence: Array<{ dimension: string; detail: string }>;
    unknowns: string[];
  };
  opportunity: {
    verdict: string;
    job: PlayingTimeConflict['job'] | null;
    ahead: Array<{ playerId: number; name: string; age: number; share: number | null; level: WorkLevel; claimant: boolean }>;
    reasons: string[];
    unknowns: string[];
  };
  alternatives: Array<{
    kind: string;
    direction: 'promotion' | 'demotion';
    level: number;
    levelName: string;
    teams: Array<{ teamId: number; label: string }>;
    judgment: string;
    preference: string | null;
    blockers: string[];
    missingEvidence: Array<{ dimension: string; detail: string }>;
    destinationOpportunity: { teamId: number; job: string; open: boolean; detail: string } | null;
  }>;
  conclusion: string;
  attention: 'needs_attention' | 'worth_a_look' | 'routine';
  reasons: string[];
  ownership: Array<{ question: string; owner: string; answer: string }>;
  missing: string[];
  wouldResolve: string[];
  gmDecision: string[];
}

export interface RetentionReview {
  playerId: number;
  name: string;
  age: number;
  teamId: number;
  team: string;
  level: number;
  levelName: string;
  conclusion: 'retain' | 'review' | 'not_a_farm_decision' | 'indeterminate';
  guardrails: Array<{ code: string; detail: string; owner: string }>;
  outlook: { state: string; runway: string; reasons: string[]; missing: string[] };
  pressure: { state: string; reasons: string[]; waiting: Array<{ playerId: number; name: string; age: number; what: string }> };
  stance: { lean: string; reasons: Array<{ dimension: string; value: number; effect: string }>; neutralWouldSay: string };
  facts: Array<{ label: string; value: string }>;
  reasons: string[];
  missing: string[];
  gmDecision: string[];
}

export interface OrganizationView {
  scope: { players: number; assessed: number; indeterminate: number; notAssessable: number; rehab: number };
  distribution: Array<{
    position: string;
    byLevel: Array<{ level: number; levelName: string; players: number; priority: number }>;
    upperMinors: number;
    upperMinorsPriority: number;
  }>;
  startersByLevel: Array<{ level: number; levelName: string; developmentalStarters: number; rotationSpots: number }>;
  findings: FarmFinding[];
}

export interface AttentionItem {
  kind: 'assignment' | 'affiliate' | 'organization' | 'retention';
  severity: FindingSeverity;
  headline: string;
  detail: string;
  target: { kind: 'player'; playerId: number } | { kind: 'affiliate'; teamId: number } | { kind: 'organization' };
}

export interface FarmSystem {
  orgId: number;
  organization: OrganizationView;
  affiliates: AffiliateView[];
  assignments: AssignmentReview[];
  retention: RetentionReview[];
  attention: AttentionItem[];
  calibration: Array<{ name: string; value: string; status: string; basis: string }>;
  unknowns: string[];
}

/* ── the farm consequence, for a decision ─────────────────────────────────────────────────────── */

export interface CascadeStep {
  index: number;
  vacancy: { teamId: number; team: string; level: number; levelName: string; job: PlayingTimeConflict['job']; after: number; floor: number; absorbed: boolean; detail: string };
  candidate: { playerId: number; name: string; age: number; fromTeamId: number; fromTeam: string; fromLevel: number; fromLevelName: string } | null;
  development: { judgment: string; blockers: string[]; missingEvidence: Array<{ dimension: string; detail: string }> };
  preference: string | null;
  preferenceBasis: string | null;
  alternatives: Array<{ playerId: number; name: string; age: number; fromTeam: string; preference: string | null }>;
  consequence: { destination: string; source: string; destinationOpportunity: string; opensFurtherVacancy: boolean };
  uncertainty: string[];
  usable: boolean;
}

export interface Cascade {
  origin: { playerId: number; name: string; fromTeamId: number; fromTeam: string; job: PlayingTimeConflict['job']; reason: string };
  steps: CascadeStep[];
  stop: string;
  stopDetail: string;
  unresolved: Array<{ teamId: number; team: string; job: string; detail: string }>;
  certainty: 'established' | 'indeterminate';
  gmDecision: string[];
}

export interface FarmConsequence {
  player: { playerId: number; name: string } | null;
  sourceAffiliate: { teamId: number; label: string; level: number; levelName: string } | null;
  lostRole: string | null;
  affiliateImpact: { before: string; after: string; absorbed: boolean; statusBefore: RosterStatus; statusAfter: RosterStatus; findingsAfter: string[] } | null;
  playingTimeImpact: Array<{ playerId: number; name: string; effect: string }>;
  replacementOptions: Array<{ playerId: number; name: string; from: string; judgment: string; preference: string | null; detail: string }>;
  cascade: Cascade | null;
  unresolvedIssues: string[];
  confidence: string;
  evidence: string[];
  summary: string;
}
