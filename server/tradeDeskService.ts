/**
 * The Trade Desk, kept (N12 Track C; SWIFTUI_REBUILD.md sections 4.2 and 9; D-073).
 *
 * - **The desk** (the offers, the trade talk, the league's fits) is built once per state of the club's inputs, the Front
 *   Office's own key (`frontOfficeInputsKey`: the club, the import, the settings and configuration files, the live log,
 *   the calibration revision), in the Front Office's worker. Our club's is **warmed** after each kept build of its Front
 *   Office, so the first open after an import is a cached read; another club's is built on its first open, then kept.
 *   Whether the AI desk is on is read on every request (a key can change without the inputs moving).
 * - **A deal weighed** is read on the server's thread when asked (a handful of players) and kept on the same key with its
 *   players, the most recent 64 kept.
 * - **The AI desk** is `tradeDeskAsk.ts`'s, apart from this module (D-001: the desk's figures need no model).
 */
import { databaseGeneration, leagueUpgradeUnderWay, tableExists } from './db.js';
import { FrontOfficeRefusal, NO_DATA, frontOfficeInputsKey, frontOfficeStampOf, onFrontOfficeKept, resolveOrg, runDepartmentJob } from './frontOfficeService.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored } from './presentation/claim.js';
import { tradeAnalysisView, tradeDeskAi, type TradeAiState } from './presentation/trades/desk.js';
import type { TradeAnalysisView, TradeDeal, TradeDeskView } from './presentation/trades/types.js';
import { analyzeTrade, viewerFor } from './trade.js';
import { buildTradeDesk, tradesContextFor, type TradeDeskRequest } from './tradeDeskBuild.js';
import { currentOrganization } from './viewingOrganization.js';

/** A request the Trade Desk refuses, in words (a 400). */
export class TradesRefusal extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502) {
    super(message);
    this.name = 'TradesRefusal';
  }
}

/** The most players a side can carry (OOTP's own trade screen takes ten a side). */
export const MOST_A_SIDE = 10;
export const TOO_MANY = `A side can carry at most ${MOST_A_SIDE} players.`;
export const BAD_PLAYERS = 'Players are named by their ids, separated by commas.';

interface KeptDesk { key: string; view: TradeDeskView }

const MAX_DESKS = 4;
const MAX_ANALYSES = 64;
const desks = new Map<string, KeptDesk>();
const building = new Map<string, Promise<KeptDesk>>();
const analyses = new Map<string, TradeAnalysisView>();
const stats = { builds: 0, hits: 0, analyses: 0, analysisHits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function tradeDeskStats(): Readonly<typeof stats & { cached: number }> {
  return { ...stats, cached: desks.size };
}

/** For the tests: an empty cache and zero counts. */
export function resetTradeDesk(): void {
  desks.clear();
  building.clear();
  analyses.clear();
  Object.assign(stats, { builds: 0, hits: 0, analyses: 0, analysisHits: 0 });
}

async function deskFor(orgId: number): Promise<KeptDesk> {
  if (!tableExists('players')) throw new FrontOfficeRefusal(NO_DATA, 404);
  const upgrade = leagueUpgradeUnderWay();
  if (upgrade) {
    await upgrade;
    return deskFor(orgId);
  }
  const key = frontOfficeInputsKey(orgId);
  const hit = desks.get(key);
  if (hit) {
    stats.hits += 1;
    return hit;
  }
  const pending = building.get(key);
  if (pending) return pending;
  const startedGeneration = databaseGeneration();
  const request: TradeDeskRequest = { orgId, importStamp: importedAt.value, reportStamp: frontOfficeStampOf(key) };
  const job = runDepartmentJob<TradeDeskView>({ kind: 'tradeDesk', request }, () => buildTradeDesk(request))
    .then((view) => {
      stats.builds += 1;
      // What a worker posts back is checked again claim by claim and registered before a route sends it
      adoptAuthored(view);
      const entry: KeptDesk = { key, view };
      // Kept only when nothing moved under it: no swap to another import, the same inputs
      if (databaseGeneration() === startedGeneration && frontOfficeInputsKey(orgId) === key) {
        desks.delete(key);
        desks.set(key, entry);
        while (desks.size > MAX_DESKS) desks.delete(desks.keys().next().value!);
      }
      return entry;
    })
    .finally(() => {
      if (building.get(key) === job) building.delete(key);
    });
  building.set(key, job);
  return job;
}

/**
 * The Trade Desk for a club (a team id, or `automatic`), with whether the AI desk is on read now (`aiState`, handed in by
 * the route from `tradeDeskAsk.ts`: this module computes and words without a model, D-001).
 */
export async function tradeDeskNow(org: string, aiState: (orgId: number) => TradeAiState): Promise<TradeDeskView> {
  const orgId = resolveOrg(org);
  const { view } = await deskFor(orgId);
  const ctx = tradesContextFor({ orgId, importStamp: view.importStamp, reportStamp: view.reportStamp });
  return { ...view, ai: tradeDeskAi(ctx, aiState(orgId)) };
}

/** Player ids from a query value ("12,40,7"): whole, positive, each once, at most a side's worth. */
export function playerIds(value: unknown): number[] {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  const ids = parts.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new TradesRefusal(BAD_PLAYERS, 400);
  const unique = [...new Set(ids)];
  if (unique.length > MOST_A_SIDE) throw new TradesRefusal(TOO_MANY, 400);
  return unique;
}

/** The deal a request names: `sent` and `received`, a player on one side only (the side named first keeps him). */
export function dealFrom(query: Record<string, unknown>): TradeDeal {
  const sent = playerIds(query.sent);
  const received = playerIds(query.received).filter((id) => !sent.includes(id));
  return { sent, received };
}

/** A deal weighed for a club: kept on the club's inputs and its players, read on the server's thread when first asked. */
export async function tradeAnalysisNow(org: string, query: Record<string, unknown>): Promise<TradeAnalysisView> {
  const orgId = resolveOrg(org);
  if (!tableExists('players')) throw new FrontOfficeRefusal(NO_DATA, 404);
  const deal = dealFrom(query);
  const inputs = frontOfficeInputsKey(orgId);
  const key = `${inputs}#${deal.sent.join(',')}>${deal.received.join(',')}`;
  const hit = analyses.get(key);
  if (hit) {
    stats.analysisHits += 1;
    analyses.delete(key);
    analyses.set(key, hit);
    return hit;
  }
  const generation = databaseGeneration();
  const ctx = tradesContextFor({ orgId, importStamp: importedAt.value, reportStamp: frontOfficeStampOf(inputs) });
  // The club's value of a win is the standings' (D-060): not read for the desk
  const analysis = analyzeTrade(deal.sent, deal.received, viewerFor(orgId), undefined, { winValues: false });
  const view = tradeAnalysisView(ctx, analysis, deal);
  stats.analyses += 1;
  if (databaseGeneration() === generation && frontOfficeInputsKey(orgId) === inputs) {
    analyses.set(key, view);
    while (analyses.size > MAX_ANALYSES) analyses.delete(analyses.keys().next().value!);
  }
  return view;
}

/** Builds our club's Trade Desk ahead (never throws): after a kept build of its Front Office. */
export async function warmTradeDesk(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? currentOrganization()?.id ?? null : org;
    if (orgId === null || !tableExists('players')) return;
    await deskFor(orgId);
  } catch (err) {
    console.error('[trades] the Trade Desk could not be built ahead:', err);
  }
}

onFrontOfficeKept((built) => {
  if (currentOrganization()?.id === built.orgId) void warmTradeDesk(built.orgId);
});
