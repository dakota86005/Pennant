import { apiGet, type ClubFinanceCards, type FreshnessCue } from './api';

/**
 * Free Agents' served shapes (Player Value phase 6c; `server/freeagents.ts`, `server/positionNeeds.ts`). The page renders
 * these and computes nothing about a player: every figure is Player Value's, as served.
 */

export interface WinsFigure {
  season: number;
  low: number;
  central: number;
  high: number;
}

/** What a season of his production costs at this league's market, or why it is not known (never $0). */
export interface MarketFigure {
  status: 'known' | 'unknown';
  season: number | null;
  low: number | null;
  central: number | null;
  high: number | null;
  reason: string | null;
  /** How it was read, in words. */
  text: string;
}

export interface FreeAgentRow {
  player_id: number;
  name: string;
  age: number | null;
  position: number;
  positionName: string;
  isPitcher: boolean;
  /** His club now (hitting the market); null for a player no club holds. */
  team: string | null;
  salaryNow: number | null;
  salaryNote: string | null;
  scouted: { now: number | null; ceiling: number | null; status: 'complete' | 'partial' | 'unknown' };
  winsNow: (WinsFigure & { part: 'rest_of_season' | 'season' }) | null;
  winsNext: WinsFigure | null;
  winsReason: string | null;
  market: MarketFigure;
}

export interface PositionNeed {
  position: number;
  positionName: string;
  best: { player_id: number; name: string; wins: number } | null;
  unknown: number;
}

export interface FreeAgentsResponse {
  seasonYear: number | null;
  nextSeason: number | null;
  freshness: FreshnessCue;
  organization: { id: number; name: string | null };
  finances: ClubFinanceCards | null;
  price: { stage: 'opening' | 'measured'; label: string; band: { low: number; central: number; high: number }; minimum: number | null } | null;
  needs: { positions: PositionNeed[]; thinnest: string[]; notEstablished: string[]; basis: string };
  order: string;
  currentFAs: FreeAgentRow[];
  currentNote: string | null;
  upcomingFAs: FreeAgentRow[];
  /** Expiring deals whose control after this season the export cannot establish. */
  upcomingIndeterminate: number;
  /** Contracts whose next season is an option or an opt-out: whether he reaches the market is still to be decided. */
  upcomingUndecided: number;
}

export const getFreeAgents = (orgId: number) => apiGet<FreeAgentsResponse>(`/api/free-agents/${orgId}`);
