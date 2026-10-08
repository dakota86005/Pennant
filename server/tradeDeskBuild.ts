/**
 * The Trade Desk's reader (N12 Track C, D-073): what the desk needs from the analyser (`server/trade.ts`), read once and
 * worded by `server/presentation/trades/`. Runs in the Front Office's worker after an import (our club's desk) or on the
 * server's thread on a first open; it reads and words, and records nothing.
 */
import { db, tableExists } from './db.js';
import { freshnessCue, getDataStatus } from './dataStatus.js';
import { servedDepartments } from './presentation/catalog.js';
import { cell } from './presentation/claim.js';
import { tradeDeskView, type TradeAiState, type TradesContext } from './presentation/trades/desk.js';
import type { TradeDeskView } from './presentation/trades/types.js';
import { analyzeTrade, computeTradeFits, computeTradeProposals, computeTradeTalk } from './trade.js';

export interface TradeDeskRequest {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
}

/** The club's name as its side reads: its nickname ("Diamondbacks"), else its name. */
export function clubWord(orgId: number): string {
  if (!tableExists('teams')) return 'The club';
  const row = db.prepare('SELECT name, nickname FROM teams WHERE team_id = ?').get(orgId) as { name?: unknown; nickname?: unknown } | undefined;
  const nick = typeof row?.nickname === 'string' ? row.nickname.trim() : '';
  const name = typeof row?.name === 'string' ? row.name.trim() : '';
  return nick || name || 'The club';
}

/** The desk's context: the club, the build, its byline and the export's day. */
export function tradesContextFor(request: TradeDeskRequest): TradesContext {
  const status = getDataStatus({ importedAt: request.importStamp });
  const trades = servedDepartments(request.orgId).find((d) => d.id === 'trades');
  return {
    orgId: request.orgId,
    importStamp: request.importStamp,
    reportStamp: request.reportStamp,
    gameDate: status.csv.simulatedThrough ?? status.csv.currentDate,
    preparedBy: trades?.preparedBy ?? cell('Prepared by the front office'),
    club: clubWord(request.orgId),
  };
}

/** The AI's state as the worker words it before the server's thread puts in the current one (keys are not read here). */
const AI_UNREAD: TradeAiState = { available: false, voice: { name: 'the front office', role: 'front office' }, offReason: null };

/** The Trade Desk for a club: the offers, the trade talk and the league's fits, each read the analyser's way. */
export function buildTradeDesk(request: TradeDeskRequest, ai: TradeAiState = AI_UNREAD): TradeDeskView {
  const ctx = tradesContextFor(request);
  // The club's value of a win is the standings' (D-060): not read for the desk
  const options = { winValues: false };
  return tradeDeskView(ctx, {
    fits: computeTradeFits(request.orgId),
    proposals: computeTradeProposals(request.orgId, options),
    talk: computeTradeTalk(request.orgId, options),
    ai,
    freshness: freshnessCue(getDataStatus({ importedAt: request.importStamp })),
    // How the analyser's figures are called (D-041), as every reading of a deal carries it
    stamp: analyzeTrade([], [], { orgId: request.orgId, philosophy: null }, undefined, options).value.stamp,
  });
}
