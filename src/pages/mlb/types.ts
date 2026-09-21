/*
 * The shapes the MLB Operations API returns, as the views read them. Server-side sources: server/mlbOperations.ts, mlbNeeds.ts,
 * mlbReview.ts, mlbResponses.ts, mlbPlans.ts, mlbReport.ts, mlbExplain.ts.
 */

export type Status = 'eligible' | 'ineligible' | 'indeterminate';

export interface Shade { dimension: string; value: number | null; effect: string; text: string }

export interface Context {
  window: { label: string; value: number | null }; season: { read: string; odds: number | null; headline: string | null };
  urgency: 'high' | 'normal' | 'low'; headline: string; lines: string[]; conflict: string | null; used: string[]; notUsed: string[];
}

export interface ExplainedPart { label: string; value: number | null; weight: number | null; basis: string }
export interface Explanation {
  why: { rule: string; text: string; estimate: number | null; threshold: number | null; margin: number | null; standard: { label: string; typical: number; floor: number; deepFloor: number } | null };
  parts: ExplainedPart[];
  neutralSeverity: 'elevated' | 'watch';
  context: { changed: Shade[]; notChanged: string[] };
  explanations: string[];
  wouldChange: string[];
  unknown: string[];
}

export type NeedKind = 'role_below_standard' | 'open_active_spot' | 'il_return_crunch' | 'role_holder_review' | 'platoon_complement' | 'bench_coverage';

export interface Need {
  id: string;
  kind: NeedKind;
  origin: 'observed' | 'hypothetical';
  role: { kind: string; label: string } | null;
  title: string;
  summary: string;
  severity: 'critical' | 'elevated' | 'watch';
  urgency: { label: string; days: number | null };
  horizon: { kind: string; days: number | null; basis: string };
  causes: Array<{ playerId: number; name: string; role: string | null; status: string; daysLeft: number | null; assumed: boolean }>;
  facts: Array<{ label: string; value: string }>;
  unknowns: string[];
  shading?: Shade[];
  explanation?: Explanation;
  review?: { strength: 'strong' | 'moderate' | 'watch' | 'none' };
}

export interface PlatoonRead {
  verdict: string; weakSide: string | null; weakBy: number | null; reliability: number; reasons: string[]; basis?: string; ratingDeparture?: number | null;
  difference?: number | null; drivers?: { league: number; ratings: number | null; record: number | null };
  vsLeft: { pa: number; observed: number | null; expected: number | null }; vsRight: { pa: number; observed: number | null; expected: number | null };
}

export interface LineupPlayer { playerId: number; name: string; bats: string | null; amount: number; share: number; pa: number }
export interface LineupSpot { position: number; label: string; regular: LineupPlayer | null; backups: LineupPlayer[]; partner?: LineupPlayer | null; settled: boolean }
export interface Lineup {
  spots: LineupSpot[]; dh: LineupSpot; bench: Array<{ playerId: number; name: string; bats: string | null; pa: number; gs: number; partnerAt?: number }>; games: number; basis: string;
}

export type CoverQuality = 'regular_quality' | 'credible' | 'emergency' | 'unknown';
export interface CoverRead { position: number; grade: number | null; pct: number | null; quality: CoverQuality }
export interface BenchRow {
  playerId: number; name: string; bats: string | null; pa: number; role: string; coverLabels: string[]; batValue: number | null; runningPct?: number | null;
  tags: string[]; coverReads: CoverRead[]; partnerAt?: number;
}
export interface BenchFunction {
  key: string; label: string; strength: 'covered' | 'thin' | 'none' | 'unknown';
  by: Array<{ playerId: number; name: string; quality: CoverQuality | null; note: string }>; text: string;
}
export interface BenchReview {
  rows: BenchRow[]; gaps: Array<{ key: string; label: string; kind: 'none' | 'emergency_only'; text: string }>; functions: BenchFunction[];
  hands: { L: number; R: number; S: number }; findings: string[];
}

export interface Deployment { text: string; gap: number; current: string; supported: string; why: string }
export interface PenFinding {
  kind: string; current: string; supported: string; why: string; text: string;
  players: Array<{ playerId: number; name: string; tier: string; estimate: number | null }>;
}

export interface ToolContribution { tool: string; rating: number; points: number }
export interface ReviewHolder {
  position?: number; platoon?: PlatoonRead | null; role?: { label: string } | null; tier?: string | null; stakes?: string | null;
  estimate: { value: number | null; ratingsPct: number | null; resultsPct: number | null; weightOnResults: number; basis: string; batValue?: number | null; defensePct?: number | null; weightOnDefense?: number; runningPct?: number | null; weightOnRunning?: number };
  playerId: number; name: string; age: number | null; rank: number | null; groupSize: number; isWeakest: boolean;
  kind: string; strength: 'strong' | 'moderate' | 'watch' | 'none';
  reasons: string[]; explanations: string[]; wouldChange: string[]; usage: string[];
  standard?: { label: string; typical: number; floor: number; deepFloor: number; margin: number } | null;
  concern?: { rule: string; estimate: number | null; threshold: number | null; margin: number | null };
  evidence: {
    sample: number; sampleUnit: string; reliability: number; toolsBasis?: string; toolsExpected?: number | null;
    toolsProfile?: { contributions: ToolContribution[]; leans: string[]; lacks: string[]; text: string } | null;
    defense?: { pct: number | null; grade: number | null; visible: boolean; resultsPct?: number | null; resultsInnings?: number };
    running?: { ability: number | null; toolsPct: number | null; resultsPct: number | null; perSixHundred: number | null };
  };
}
export interface ReviewGroup {
  kind: string; role: string; holders: ReviewHolder[]; notReviewed: number; lineup?: Lineup; deployment?: Deployment[]; pen?: PenFinding[]; bench?: BenchReview;
}

export interface Overview {
  organization: { orgId: number; label: string } | null;
  freshness: { level: string; headline: string; action: string | null; log: string };
  roster: { active: { count: number | null; limit: number | null }; fortyMan: { count: number | null; limit: number | null }; injuredList: number };
  coverage: { basis: string; source: string; floors: Array<{ role: string; count: number; label: string }> };
  needs: Need[];
  context: Context | null;
  review: ReviewGroup[];
  activePlayers: Array<{ playerId: number; name: string; role: string | null; available: boolean }>;
  unknowns: string[];
}

export interface Step {
  seq: number; action: string; playerName: string; label: string;
  status: Status | 'not_a_transaction';
  reasons: Array<{ message: string; basis: string }>;
  requirements: Array<{ status: string; message: string }>;
  missing: Array<{ message: string }>; limitation: string | null;
}
export interface FarmChange { label: string; before: string; after: string }
/**
 * Minor League Operations' answer, as displayed here and never rebuilt (D-045). `farm` is what
 * follows a departure (the job vacated, the chain, what is left open); `arrival` is what an option
 * does where the player lands.
 */
export interface Farm {
  affiliate: { label: string; levelName: string };
  overall: { before: string; after: string };
  changes: FarmChange[];
  issuesAfter: string[];
  rosterNotes: string[];
  farm: {
    summary: string;
    confidence: string;
    lostRole: string | null;
    affiliateImpact: { absorbed: boolean } | null;
    /**
     * What he is actually doing at his club now, from the farm's own playing-time read: the recent
     * window where the export's game log allows it. Displayed, never reconstructed.
     */
    currentOpportunity: {
      level: string;
      basis: 'recent' | 'season' | 'current_state';
      evidence: 'sufficient' | 'thin' | 'none' | 'season_only';
      recentArrival: boolean;
      disagrees: boolean;
      timing: string | null;
      detail: string;
    } | null;
    playingTimeImpact: Array<{ playerId: number; name: string; effect: string }>;
    replacementOptions: Array<{ playerId: number; name: string; from: string; judgment: string; preference: string | null }>;
    cascade: { stop: string; stopDetail: string; certainty: string; steps: Array<{ index: number; usable: boolean }> } | null;
    unresolvedIssues: string[];
  } | null;
  arrival: {
    summary: string;
    job: string | null;
    contested: boolean;
    /** Whether the competition he would join is current, historical, or not yet readable. */
    timing: string | null;
    displaced: Array<{ playerId: number; name: string; age: number }>;
    confidence: string;
    evidence: string[];
  } | null;
}
export interface ChainLink { seq: number; kind: 'clear_spot' | 'transaction'; constraint: string | null; action: string; status: Status | 'not_a_transaction'; label: string; detail: string }

export interface Candidate {
  complement?: { weakSide: string; fit: { fits: boolean; advantage: number | null; reasons: string[] }; candidate: { vsLeft: number | null; vsRight: number | null }; glove: { candidate: number | null; regular: number | null } } | null;
  preference?: { score: number; reasons: Shade[] } | null;
  comparison?: { verdict: string; delta: number | null; toolsDelta: number | null; resultsDelta: number | null; certainty: string; reasons: string[] } | null;
  playerId: number; name: string; age: number | null; level: number | null;
  pathKind: 'role_change' | 'recall' | 'add_to_forty_man'; group: string; why: string[];
  discovery: { source: string; evidence: string[] };
  availability: { status: string; label: string | null; daysLeft: number | null };
  requiresClearing: { active: boolean; fortyMan: boolean };
  development: {
    status: string; message?: string; reasons?: string[]; blockers?: string[]; missing?: string[]; context?: string | null;
    duration?: { matters: boolean; explanation: string; resolvedBy: string | null; verdicts: Array<{ context: string; label: string; judgment: string; assessed: boolean; blockers: string[]; missing: string[] }> } | null;
    contextual?: { contextLabel: string; stakesTier: string | null; requiredReadiness: number | null; durableReadiness: number | null; routes: { production: string; established: string } | null; experience: { plateAppearances: number; inningsPitched: number } | null } | null;
  };
  path: { status: string; steps: Step[]; chain: ChainLink[]; requirementsUnmet: string[]; unknowns: string[] };
  roleFit: { classification: string | null; evidence: { compositePercentile: number | null; weakestCorePercentile: number | null; unassessed: string[]; evidenceStatus: string; notes: string[] } } | null;
  performance: { year: number; level: number; sample: number; sampleUnit: string; lines: Array<{ label: string; value: string }> } | null;
  consequences: {
    active: { before: number | null; change: number; limit: number | null; note: string | null };
    fortyMan: { before: number | null; change: number; limit: number | null };
    vacatedRole: { role: string; availableAfter: number; floor: number; belowFloor: boolean } | null;
    farm: Farm | null;
    facts: Array<{ label: string; value: string }>;
  };
  philosophy: { status: string; stance: string | null; reasons: Array<{ dimension: string; direction: string; message: string }>; note: string | null };
}

export interface ClearingOption {
  playerId: number; name: string; role: { label: string } | null;
  constraint: string; transaction: 'option' | 'designate_for_assignment' | 'place_on_sixty_day_il'; class: string;
  rights: { status: Status; label: string; reasons: Array<{ message: string; basis: string }>; missing: Array<{ message: string }> };
  costs: string[]; rosterEffect: { activeSpot: string; fortyManSpot: string };
  facts: Array<{ label: string; value: string }>;
  roleEffect: { role: string; availableAfter: number; floor: number; belowFloor: boolean } | null;
  farm: Farm | null;
}
export interface ConstraintClearing {
  constraint: 'active_roster' | 'forty_man'; label: string; state: 'clearing_needed' | 'spot_open' | 'unknown';
  count: number | null; limit: number | null; feasibility: string | null;
  classes: Array<{ class: string; label: string; description: string; options: ClearingOption[] }>;
  note: string;
}

export interface RoleRow {
  playerId: number; name: string; age: number | null; relation: 'incumbent' | 'subject'; status: string;
  composite: number | null; resultsPct: number | null; estimate: number | null; weightOnResults: number;
  sample: number; sampleUnit: string; reliability: number; usage: string[]; underReview?: boolean;
  comparison?: { verdict: string; delta: number | null; toolsDelta: number | null; resultsDelta: number | null; certainty: string } | null;
  weakestCore: number | null; evidenceStatus: string;
  performance: { sample: number; sampleUnit: string; lines: Array<{ label: string; value: string }> } | null;
  standing: { verdict: string; rank: number | null; assessed: number; gapToWeakest: number | null } | null;
  group: string | null;
  complement?: { weakSide: string; expected: number | null; advantage: number | null; fits: boolean } | null;
}

export interface Pathway {
  id: string; title: string; why: string[]; steps: string[];
  moves: Array<{ playerId: number; name: string; role: string | null; transaction: string; class: string; rights: string; note: string }>;
  moreMoves: number; consequences: string[]; certainty: string; certaintyNote: string;
}
export interface Recommendation {
  stance: 'act' | 'explore' | 'monitor' | 'hold'; headline: string; because: string[]; toSettle: string[]; wouldChange: string[];
  confidence: 'high' | 'moderate' | 'low'; basis: string; shading?: Shade[]; neutralStance?: 'act' | 'explore' | 'monitor' | 'hold' | null;
}
export interface Report {
  recommendation?: Recommendation | null;
  headline: string; situation: string[];
  read: { verdict: string | null; text: string; caveats: string[] };
  rolePicture: { role: string; standard: { label: string; count: number; healthy: number } | null; rows: RoleRow[]; basis: string } | null;
  pathways: Pathway[]; orderingNote: string;
}

export interface PlanStep { seq: number; text: string; status: string; note: string | null }
export interface GroupEffect {
  label: string; healthyBefore: number; healthyAfter: number; floor: number | null; meanBefore: number | null; meanAfter: number | null;
  change: number | null; weakestBefore: { name: string; estimate: number } | null; weakestAfter: { name: string; estimate: number } | null; unknown: number;
}
export interface Plan {
  id: string; title: string; summary: string; steps: PlanStep[]; groups: GroupEffect[]; counts: { active: string; fortyMan: string };
  followUp: { text: string; chosen: { name: string; estimate: number | null; class: string } | null; alternatives: Array<{ name: string; estimate: number | null }> } | null;
  costs: string[]; problems: string[]; certainty: string; certaintyNote: string;
}

export interface Packet {
  need: Need;
  plans?: Plan[] | null;
  assignment: { context: string | null; evaluated: string[]; label: string; basis: string; explanation: string; choices: Array<{ context: string; label: string }> } | null;
  direction: 'fill' | 'clear' | 'role_needed' | 'replace' | 'complement';
  context?: Context | null;
  report: Report | null;
  groups: Array<{ group: string; label: string; candidates: Candidate[] }>;
  clearing: {
    returning: { name: string; daysLeft: number | null } | null;
    activation: {
      status: Status; label: string; reasons: Array<{ message: string }>; missing: Array<{ message: string }>;
      requirements: Array<{ status: string; message: string }>; limitation: string | null;
    } | null;
    constraints: ConstraintClearing[];
    chain: ChainLink[];
    chainStatus: string | null;
    note: string;
  } | null;
  notConsidered: Array<{ reason: string; count: number }>;
  unknowns: string[];
}
