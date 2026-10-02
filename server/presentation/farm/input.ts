/**
 * What the farm's views are worded from (N10): the specialists' answers as the build (`farmViewsBuild.ts`) read them,
 * handed over as plain data. The adapters in this folder read no table and load no specialist (types only), so they can
 * be tested on synthetic answers and run in the Front Office's worker.
 */
import type { Cell, DeptId } from '../../contract/presentation.js';
import type { GameDate } from '../../dataFreshness.js';
import type { FarmConsequenceV2 } from '../../farmConsequence.js';
import type { FarmSystemView } from '../../farmOperations.js';
import type { ScoutedDevelopmentResponse } from '../../scoutedDevelopment.js';
import type { RatingDisplay } from './words.js';

/** Who and what a build is for. */
export interface FarmContext {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
  gameDate: GameDate | null;
  /** "Prepared by the minor league staff", as the catalog serves it. */
  preparedBy: Cell;
  department: DeptId;
}

/** The major-league club at the top of the organization. */
export interface MajorLeagueClub {
  teamId: number;
  name: string;
  league: string | null;
  activePlayers: number | null;
}

/** One prospect as `/api/prospects` serves him (the fields the views read; `computeProspects` types them `unknown`). */
export interface ProspectInput {
  player_id: number;
  team_id: number;
  name: string;
  age: number;
  team: string;
  level: number;
  levelName: string;
  cur: number | null;
  pot: number | null;
  /** Hitters. */
  pa?: number | null;
  opsVal?: number | null;
  hr?: number | null;
  /** Pitchers. */
  ip?: number | null;
  era?: number | null;
  kpct?: number | null;
  decision: {
    recommendation: string;
    confidence: string;
    evidence: {
      performance: number;
      ageLevelUrgency: number;
      ratingsMaturity: number | null;
      sampleConfidence: number;
      readiness: number | null;
    };
    positives: string[];
    cautions: string[];
    missingEvidence: Array<{ dimension: string; detail: string }>;
  };
  assignments: {
    evaluations: ProspectEvaluationInput[];
    eligible: ProspectEvaluationInput[];
    indeterminate: ProspectEvaluationInput[];
  };
}

export interface ProspectEvaluationInput {
  kind: string;
  direction: 'promotion' | 'demotion';
  target: { level: number; levelName: string; teams: Array<{ teamId: number; label: string }>; isMajorLeague: boolean };
  judgment: string;
  preference: string | null;
  blockers: string[];
  missingEvidence: Array<{ dimension: string; detail: string }>;
  destinationFit?: {
    teams: Array<{ fit: { destinationTeamId: number; destinationTeam: string; classification: string } }>;
    eligibleTeamIds: number[];
    indeterminateTeamIds: number[];
  } | null;
}

/** One snapshot row of this save's rating history (D-064), as `/api/development-history` serves it. */
export interface HistoryRowInput {
  game_date: string;
  player_id: number;
  name: string;
  team_id: number;
  level: number;
  /** The level's name, as the build reads it ("Double-A"). */
  levelName: string;
  position: number;
  age: number;
  cur: number | null;
  pot: number | null;
  con: number | null;
  gap: number | null;
  pow: number | null;
  eye: number | null;
  avk: number | null;
  spd: number | null;
  stu: number | null;
  mov: number | null;
  ctl: number | null;
}

/** This save's rating history for the organization: its snapshot dates, rows and notes. */
export interface DevelopmentHistoryInput {
  snapshots: number;
  dates: string[];
  observationDays: number | null;
  rows: HistoryRowInput[];
  ratingModeSwitches: Array<{ text: string }>;
  history: { note: string | null; because: string[] };
}

/** Everything one build of the farm's views reads. */
export interface FarmViewsInput {
  ctx: FarmContext;
  system: FarmSystemView;
  majorLeague: MajorLeagueClub | null;
  prospects: ProspectInput[];
  scouted: ScoutedDevelopmentResponse;
  history: DevelopmentHistoryInput;
  rating: RatingDisplay;
  /** The consequence of each player decided ahead (the desk's), by player id; others are read on the click. */
  consequences: Map<number, FarmConsequenceV2 | { problem: string }>;
}
