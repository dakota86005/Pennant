import type { ClubWinValue, FreshnessCue } from './api';

/**
 * The Trade Center's served shapes (Player Value phase 6b; `server/trade.ts`, `server/playerValueTrade.ts`). The page
 * renders these and computes nothing about a player or the deal: every figure is Player Value's, as served.
 */

export type TradeUnit = 'dollars' | 'wins';

/** A figure: its range, and its most likely reading (a single one, or a range where a season is open). */
export interface TradeFigure {
  low: number;
  central: number | null;
  high: number;
  centralRange: { low: number; high: number } | null;
}

export interface TradeOurs {
  leaning: boolean;
  contract: TradeFigure | null;
  keeping: TradeFigure | null;
  leans: Array<{ short: string; text: string; by: { low: number; high: number } | null }>;
  notes: Array<{ short: string; text: string }>;
}

export interface TradePlayerValue {
  playerId: number;
  status: 'valued' | 'wins_only' | 'unknown' | 'not_held' | 'not_found';
  counted: boolean;
  contract: TradeFigure | null;
  keeping: TradeFigure | null;
  seasons: { from: number; to: number } | null;
  ifHeld: number[];
  dependsOn: string | null;
  notCounted: string | null;
  reason: string | null;
  ours: TradeOurs | null;
}

export interface TradeExcluded {
  playerId: number;
  side: 'sent' | 'received';
  reason: string;
}

export interface TradeSideTotal {
  status: 'known' | 'none';
  counted: number;
  excluded: TradeExcluded[];
  figure: TradeFigure | null;
  edges: { low: number; high: number } | null;
  text: string;
}

export interface TradePart {
  playerId: number;
  side: 'sent' | 'received';
  sign: 1 | -1;
  part: TradeFigure;
}

export interface TradeDifference {
  status: 'known' | 'unknown';
  reason: string | null;
  figure: TradeFigure | null;
  edges: { low: number; high: number } | null;
  components: TradePart[];
  excluded: TradeExcluded[];
  text: string;
}

export interface TradeValue {
  unit: TradeUnit | null;
  unitReason: string | null;
  sent: { players: TradePlayerValue[]; total: TradeSideTotal };
  received: { players: TradePlayerValue[]; total: TradeSideTotal };
  difference: TradeDifference;
  ourView: { leaning: boolean; sent: TradeSideTotal; received: TradeSideTotal; difference: TradeDifference } | null;
  basis: string[];
  stamp: { status: string; basis: string };
}

export interface TradeControlSeason {
  season: number;
  label: string;
  cost: { low: number; central: number | null; high: number } | null;
  ifHeld: boolean;
  costText: string;
}

export interface TradeControlSummary {
  text: string;
  controlled: number | null;
  pastHorizon: boolean;
  path: TradeControlSeason[];
}

export interface TradeProduction {
  status: 'projected' | 'unknown';
  reason: string | null;
  now: { season: number; part: 'rest_of_season' | 'season'; wins: { low: number; central: number; high: number } } | null;
  next: { season: number; wins: { low: number; central: number; high: number } } | null;
  nextReason: string | null;
}

export interface TradeRow {
  playerId: number;
  name: string;
  age: number | null;
  position: string;
  team: string | null;
  teamAbbr: string | null;
  organizationId: number | null;
  level: string;
  listed: boolean;
  control: TradeControlSummary;
  production: TradeProduction;
  salaryNow: { season: number; amount: number } | null;
}

export interface TradeSalarySide {
  season: number | null;
  known: number;
  unknown: number[];
}

export interface TradeAnalysis {
  organization: { id: number; name: string | null } | null;
  sent: TradeRow[];
  received: TradeRow[];
  value: TradeValue;
  salary: { sent: TradeSalarySide; received: TradeSalarySide };
  winValues: ClubWinValue[];
  /** How current the export is (A-20, Player Value phase 6c); absent from an older payload. */
  freshness?: FreshnessCue;
}

/** A player picked for a side before the analysis answers: enough to show his row while it loads. */
export interface TradePick {
  player_id: number;
  name: string;
  age: number | null;
  positionName: string;
  team: string | null;
}

export interface TradeFits {
  myWeakest: Array<{ position: number; positionName: string; best: { player_id: number; name: string; wins: number } }>;
  notEstablished: string[];
  fits: Array<{
    orgId: number;
    label: string;
    matches: number;
    theyNeed: Array<{ positionName: string; theirBest: { player_id: number; name: string; wins: number }; myCandidates: Array<{ player_id: number; name: string; wins: number }> }>;
    theyOffer: Array<{ positionName: string; myBest: { player_id: number; name: string; wins: number }; players: Array<{ player_id: number; name: string; wins: number }> }>;
  }>;
  basis: string;
}

export interface TradeProposal {
  message_id: number;
  trade_id: number;
  subject: string;
  date: string | null;
  from: { team_id: number; label: string };
  theySend: { players: Array<{ player_id: number; name: string; age: number | null; positionName: string; team: string | null }> };
  weSend: { players: Array<{ player_id: number; name: string; age: number | null; positionName: string; team: string | null }> };
  unit: TradeUnit | null;
  difference: TradeDifference;
  salary: { sent: TradeSalarySide; received: TradeSalarySide };
}

export interface ValueGlance {
  status: 'known' | 'unknown';
  unit: TradeUnit | null;
  low: number | null;
  central: number | null;
  high: number | null;
  centralRange: { low: number; high: number } | null;
  reason: string | null;
}

export interface TradeTalkItem {
  message_id: number;
  subject: string;
  date: string;
  otherTeam: { orgId: number; label: string };
  player: {
    player_id: number; name: string; age: number | null; positionName: string; levelName: string;
    value: ValueGlance; control: string; salaryNow: { season: number; amount: number } | null;
  };
}
