/**
 * The Trade Desk, kept (N12 Track C; SWIFTUI_REBUILD.md sections 4.2 and 9; D-073).
 *
 * - **The desk** (the offers, the trade talk, the league's fits) is built once per state of the club's inputs without
 *   OOTP's live log (`tradeDeskKey`: `frontOfficeImportKey`, the club, the import, the settings and configuration files,
 *   the calibration revision, and the export's freshness as derived, its state and days behind; review M2), in the Front
 *   Office's worker. A write to the live log during play that leaves the freshness as it was rebuilds nothing; one that
 *   moves it does, since control and what rests on it read on it. Our club's is **warmed** after each kept build of its Front
 *   Office, so the first open after an import is a cached read; another club's is built on its first open, then kept.
 *   Whether the AI desk is on is read on every request (a key can change without the inputs moving).
 * - **A deal weighed** is read on the server's thread when asked (a handful of players) and kept on the same key with its
 *   players, the most recent 64 kept.
 * - **The AI desk** is `ai.ts`'s: its route asks the model and hands this module the answer to word (`tradeAskNow`), and
 *   it says whether the desk can answer (`answerTradeAiWith`). This module reaches no AI module (D-001: the desk's figures
 *   need no model).
 */
import { databaseGeneration, leagueUpgradeUnderWay, tableExists } from './db.js';
import { freshnessCue, getDataStatus } from './dataStatus.js';
import { FrontOfficeRefusal, NO_DATA, frontOfficeImportKey, frontOfficeStampOf, onFrontOfficeKept, resolveOrg, runDepartmentJob } from './frontOfficeService.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored, assertAuthored, cell } from './presentation/claim.js';
import { tradeAnalysisView, tradeAnswerAbout, tradeDeskAi, type TradeAiState } from './presentation/trades/desk.js';
import type { TradeAnalysisView, TradeAnswer, TradeAsk, TradeDeal, TradeDeskView } from './presentation/trades/types.js';
import { answerLines } from './presentation/trades/words.js';
import { analyzeTrade, viewerFor } from './trade.js';
import { buildTradeDesk, clubWord, tradesContextFor, type TradeDeskRequest } from './tradeDeskBuild.js';
import { currentOrganization } from './viewingOrganization.js';

/**
 * What the desk and a deal weighed depend on, as one string: the Front Office's inputs without the live log
 * (`frontOfficeImportKey`, the settings and so the philosophy's lens among them), and the export's freshness as derived
 * from the save and the log (its state and days behind; never the log's raw file stats), as Finance keys its views.
 */
export function tradeDeskKey(orgId: number): string {
  const cue = freshnessCue(getDataStatus({ importedAt: importedAt.value }));
  return `${frontOfficeImportKey(orgId)}|${cue.state}/${cue.lagDays}`;
}

/** A request the Trade Desk refuses, in words (a 400). */
export class TradesRefusal extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 409 | 502) {
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
  const key = tradeDeskKey(orgId);
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
      if (databaseGeneration() === startedGeneration && tradeDeskKey(orgId) === key) {
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

/** Whether the AI desk is on before `ai.ts` says (never in a test that leaves it out): off, with no reason given. */
const AI_UNSAID: TradeAiState = { available: false, voice: { name: 'the front office', role: 'front office' }, offReason: null };
let aiDesk: (orgId: number) => TradeAiState = () => AI_UNSAID;

/** Where the Trade Desk reads whether the AI desk is on: `ai.ts` says, once, when it is loaded (D-001). */
export function answerTradeAiWith(state: (orgId: number) => TradeAiState): void {
  aiDesk = state;
}

/**
 * The Trade Desk for a club (a team id, or `automatic`), with whether the AI desk is on read now (`aiState`; by default as
 * `ai.ts` answers it: this module computes and words without a model, D-001).
 */
export async function tradeDeskNow(org: string, aiState: (orgId: number) => TradeAiState = aiDesk): Promise<TradeDeskView> {
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
  const inputs = tradeDeskKey(orgId);
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
  if (databaseGeneration() === generation && tradeDeskKey(orgId) === inputs) {
    analyses.set(key, view);
    while (analyses.size > MAX_ANALYSES) analyses.delete(analyses.keys().next().value!);
  }
  return view;
}

/** What the AI desk is asked: the deal on the builder, the conversation so far and the GM's question, if any. */
export interface TradeDeskQuestion {
  orgId: number;
  orgLabel: string;
  sent: number[];
  received: number[];
  thread: Array<{ role: 'user' | 'assistant'; content: string }>;
  message?: string;
}

/** What the AI desk answers: its own words, who said them, and a fallback notice where another model answered. */
export interface TradeDeskReply {
  text: string;
  voice: { name: string; role: string };
  notice: { message: string } | null;
}

/**
 * The AI desk's read of the deal, or its answer to the GM's question, worded for the Mac app (N12 Track C, D-073). The
 * deal is read here; the question is put by `ask` (`ai.ts`'s, which refuses in words with AI off or a side empty), and
 * its answer is marked as the AI's own words, which decide nothing (D-001).
 */
export async function tradeAskNow(
  org: string, body: unknown, ask: (question: TradeDeskQuestion) => Promise<TradeDeskReply>,
): Promise<TradeAnswer> {
  let orgId: number;
  try {
    orgId = resolveOrg(org);
  } catch (err) {
    if (err instanceof FrontOfficeRefusal) throw new TradesRefusal(err.message, err.status);
    throw err;
  }
  const question = (body ?? {}) as Partial<TradeAsk>;
  const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const sent = ids(question.sent);
  const received = ids(question.received).filter((id) => !sent.includes(id));
  if (sent.length > MOST_A_SIDE || received.length > MOST_A_SIDE) throw new TradesRefusal(TOO_MANY, 400);
  const thread = (Array.isArray(question.thread) ? question.thread : [])
    .filter((t): t is { role: 'user' | 'assistant'; content: string } =>
      !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string');
  const message = typeof question.message === 'string' && question.message.trim() ? question.message : undefined;
  const answer = await ask({ orgId, orgLabel: clubWord(orgId), sent, received, thread, message });
  const ctx = tradesContextFor({ orgId, importStamp: importedAt.value, reportStamp: frontOfficeStampOf(tradeDeskKey(orgId)) });
  const named = answer.voice.name !== 'the front office';
  const reply: TradeAnswer = {
    voice: cell(named ? `${answer.voice.name} · ${answer.voice.role}` : 'The front office'),
    lines: answerLines(answer.text),
    content: answer.text,
    notice: answer.notice ? cell(answer.notice.message) : null,
    about: tradeAnswerAbout(ctx, answer.voice),
  };
  // Sent by the AI router rather than the `/v2` routes, so checked here as they check theirs
  assertAuthored(reply);
  return reply;
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
