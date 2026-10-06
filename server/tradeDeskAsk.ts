/**
 * The Trade Desk's AI desk (N12 Track C, D-073; D-001): whether it can answer, and its answer, routed to the same trade
 * desk the React page asks (`askTradeDesk`, `ai.ts`). The only Trade Desk module that reaches an AI module: the desk, the
 * deal and every figure are worked out without one (`tradeDeskService.ts`), and nothing said here is kept or decides
 * anything.
 */
import { askTradeDesk, TradeAskProblem, tradeAiState } from './ai.js';
import { frontOfficeInputsKey, frontOfficeStampOf, resolveOrg } from './frontOfficeService.js';
import { importedAt } from './playerStateRoutes.js';
import { cell } from './presentation/claim.js';
import { tradeAnswerAbout, type TradeAiState } from './presentation/trades/desk.js';
import type { TradeAnswer, TradeAsk } from './presentation/trades/types.js';
import { answerLines } from './presentation/trades/words.js';
import { clubWord, tradesContextFor } from './tradeDeskBuild.js';
import { MOST_A_SIDE, TOO_MANY, TradesRefusal } from './tradeDeskService.js';

/** Whether the AI desk is on for a club, and who would answer: read on every request (a key can change at any time). */
export function tradeAiNow(orgId: number): TradeAiState {
  return tradeAiState(orgId);
}

/** The AI desk's read of the deal, or its answer to the GM's question; refused in words with AI off or a side empty. */
export async function tradeAskNow(org: string, body: unknown): Promise<TradeAnswer> {
  const orgId = resolveOrg(org);
  const ask = (body ?? {}) as Partial<TradeAsk>;
  const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const sent = ids(ask.sent);
  const received = ids(ask.received).filter((id) => !sent.includes(id));
  if (sent.length > MOST_A_SIDE || received.length > MOST_A_SIDE) throw new TradesRefusal(TOO_MANY, 400);
  const thread = (Array.isArray(ask.thread) ? ask.thread : [])
    .filter((t): t is { role: 'user' | 'assistant'; content: string } =>
      !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string');
  const message = typeof ask.message === 'string' && ask.message.trim() ? ask.message : undefined;
  try {
    const answer = await askTradeDesk({ orgId, orgLabel: clubWord(orgId), sideA: sent, sideB: received, thread, message });
    const ctx = tradesContextFor({ orgId, importStamp: importedAt.value, reportStamp: frontOfficeStampOf(frontOfficeInputsKey(orgId)) });
    const named = answer.voice.name !== 'the front office';
    return {
      voice: cell(named ? `${answer.voice.name} · ${answer.voice.role}` : 'The front office'),
      lines: answerLines(answer.text),
      content: answer.text,
      notice: answer.notice ? cell(answer.notice.message) : null,
      about: tradeAnswerAbout(ctx, answer.voice),
    };
  } catch (err) {
    if (err instanceof TradeAskProblem) throw new TradesRefusal(err.message, err.status);
    throw err;
  }
}

