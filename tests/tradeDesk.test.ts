import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { analyzeTrade, computeTradeFits, computeTradeProposals, computeTradeTalk, viewerFor } from '../server/trade.js';
import { buildTradeDesk } from '../server/tradeDeskBuild.js';
import {
  BAD_PLAYERS, TOO_MANY, dealFrom, resetTradeDesk, tradeAnalysisNow, tradeDeskNow as deskNow, tradeDeskStats,
} from '../server/tradeDeskService.js';
import { TRADE_AI_OFF, tradeAiState } from '../server/ai.js';
const tradeDeskNow = (org: string) => deskNow(org, tradeAiState);
import { scaleOf } from '../server/presentation/trades/words.js';
import { gradeOwners } from './ratingFillMarks';
import { bannedInPayload } from './bannedJargon';
import request, { post } from './request';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * The Trade Desk on the Mac (N12 Track C, D-073; BEHAVIOR_CASES.md "Pennant for Mac", the `tradeDesk.test.ts` rows): it
 * says only what the analyser already answered, worded once on the server; a deal is a band with its basis and never a
 * verdict; the AI desk is optional and everything else works without it.
 */

let save: BuiltSave;
const KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_API_KEY'];
const realKeys = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));

beforeAll(() => {
  for (const k of KEY_VARS) delete process.env[k];
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
  resetFrontOfficeCache();
  resetTradeDesk();
}, 120_000);

afterAll(() => {
  resetTradeDesk();
  for (const [k, v] of Object.entries(realKeys)) if (v !== undefined) process.env[k] = v;
});

/** Every visible string in a payload (`display`, `text`, `hint`), with where it is. */
function visible(value: unknown, at = '$'): Array<{ at: string; text: string }> {
  if (Array.isArray(value)) return value.flatMap((x, i) => visible(x, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) =>
    typeof x === 'string' && ['display', 'text', 'hint'].includes(k) ? [{ at: `${at}.${k}`, text: x }] : visible(x, `${at}.${k}`));
}

const ODDS = [/postseason/i, /playoff/i, /\bodds\b/i, /\bposture\b/i];
const orgOf = (id: number) => (db.prepare('SELECT organization_id AS o FROM players WHERE player_id = ?').get(id) as { o: number } | undefined)?.o;
const theirs = () => save.hitters.filter((h) => orgOf(h) !== save.org && (orgOf(h) ?? 0) > 0);

describe('the Trade Desk says what the analyser answered (N12)', () => {
  it('serves the inbox\'s offers and trade talk and the league\'s fits exactly as the old routes compute them', async () => {
    const desk = buildTradeDesk({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const proposals = computeTradeProposals(save.org, { winValues: false });
    const talk = computeTradeTalk(save.org, { winValues: false });
    const fits = computeTradeFits(save.org)!;
    expect(desk.offers.map((o) => o.deal)).toEqual(proposals.map((p) => ({ sent: p.weSend.players.map((x) => x.player_id), received: p.theySend.players.map((x) => x.player_id) })));
    expect(desk.offers.length).toBeGreaterThan(0);
    expect(desk.talk.map((t) => t.deal.received)).toEqual(talk.map((t) => [t.player.player_id]));
    expect(desk.talk.length).toBeGreaterThan(0);
    expect(desk.fits.clubs.map((c) => c.teamId)).toEqual(fits.fits.map((f) => f.orgId));
    // The old routes answer what their extracted functions compute
    expect((await request(`/api/trade-proposals/${save.org}`)).proposals.map((p: { message_id: number }) => p.message_id)).toEqual(proposals.map((p) => p.message_id));
    expect((await request(`/api/trade-talk/${save.org}`)).items.map((t: { message_id: number }) => t.message_id)).toEqual(talk.map((t) => t.message_id));
    expect((await request(`/api/trade/fits/${save.org}`)).fits).toEqual(fits.fits);
  });

  it('reads an offer the way the builder reads the same deal: one difference, never a verdict', async () => {
    const desk = await tradeDeskNow(String(save.org));
    const offer = desk.offers[0];
    const weighed = analyzeTrade(offer.deal.sent, offer.deal.received, { orgId: save.org, philosophy: null }, undefined, { winValues: false });
    const view = await tradeAnalysisNow(String(save.org), { sent: offer.deal.sent.join(','), received: offer.deal.received.join(',') });
    expect(view.difference?.headline.value?.low).toBe(weighed.value.difference.figure?.low);
    expect(view.difference?.headline.value?.high).toBe(weighed.value.difference.figure?.high);
    expect(offer.reading.value?.low).toBe(weighed.value.difference.figure?.low);
    for (const payload of [desk, view]) {
      expect(bannedInPayload(payload, 'getTradeDesk')).toEqual([]);
      expect(visible(payload).filter((v) => ODDS.some((p) => p.test(v.text)))).toEqual([]);
    }
  });

  it('shows no grade, so carries no OSA mark to miss', async () => {
    const desk = await tradeDeskNow(String(save.org));
    const view = await tradeAnalysisNow(String(save.org), { sent: String(save.regular), received: String(theirs()[0]) });
    expect([...gradeOwners(desk, '$'), ...gradeOwners(view, '$')].filter((o) => !o.marked)).toEqual([]);
  });

  it('draws the difference on a scale symmetric about zero, zero always on it', () => {
    expect(scaleOf({ low: -2, central: 1, high: 5, centralRange: null })).toEqual({ low: -5.6000000000000005, high: 5.6000000000000005, likelyLow: 1, likelyHigh: 1 });
    expect(scaleOf({ low: 0, central: 0, high: 0, centralRange: null })).toMatchObject({ low: -1, high: 1 });
    // A most likely reading that depends on an open season is a stretch, not a point
    expect(scaleOf({ low: -1, central: null, high: 3, centralRange: { low: 0, high: 2 } })).toMatchObject({ likelyLow: 0, likelyHigh: 2 });
  });
});

describe('a deal weighed (N12)', () => {
  it('says what is missing while a side is empty, and weighs nothing', async () => {
    const empty = await tradeAnalysisNow(String(save.org), {});
    expect(empty.status?.display).toMatch(/Add players to each side/);
    expect(empty.difference).toBeNull();
    const one = await tradeAnalysisNow(String(save.org), { sent: String(save.regular) });
    expect(one.status?.display).toBe('Add a player to the side you\'d receive.');
    expect(one.sides[0].rows).toHaveLength(1);
    expect(one.sides[1].empty?.display).toBe('No players yet.');
  });

  it('keeps a player on one side only, and refuses more than a side can carry or a name that is no id, in words', async () => {
    expect(dealFrom({ sent: '5,6', received: '6,7' })).toEqual({ sent: [5, 6], received: [7] });
    await expect(tradeAnalysisNow(String(save.org), { sent: 'abc' })).rejects.toThrow(BAD_PLAYERS);
    await expect(tradeAnalysisNow(String(save.org), { sent: Array.from({ length: 11 }, (_, i) => i + 1).join(',') })).rejects.toThrow(TOO_MANY);
    await expect(request(`/api/v2/views/${save.org}/trades/analysis?sent=x`)).rejects.toThrow(`-> 400 {"error":"${BAD_PLAYERS}"}`);
  });

  it('names a player whose value isn\'t known and leaves him out of the sums, never as zero', async () => {
    const unknown = save.prospects.find((id) => {
      const a = analyzeTrade([], [id], viewerFor(save.org), undefined, { winValues: false });
      return !a.value.received.players[0]?.counted;
    });
    expect(unknown).toBeDefined();
    const view = await tradeAnalysisNow(String(save.org), { sent: String(save.regular), received: `${theirs()[0]},${unknown}` });
    const row = view.sides[1].rows.find((r) => r.player.playerId === unknown)!;
    expect(row.value.text).toBe('Not valued');
    expect(row.value.value).toBeUndefined();
    expect(row.range.tone).toBe('unknown');
    expect(view.difference?.leavesOut?.display).toMatch(/^Leaves out /);
  });

  it('is worked out once per club, import and deal, and kept', async () => {
    resetTradeDesk();
    const q = { sent: String(save.regular), received: String(theirs()[1] ?? theirs()[0]) };
    await tradeAnalysisNow(String(save.org), q);
    await tradeAnalysisNow(String(save.org), q);
    expect(tradeDeskStats()).toMatchObject({ analyses: 1, analysisHits: 1 });
  });
});

describe('the desk is kept, and the AI desk is optional (N12; D-001)', () => {
  it('builds the desk once per club and import and serves it from the cache', async () => {
    resetTradeDesk();
    await tradeDeskNow(String(save.org));
    await tradeDeskNow(String(save.org));
    expect(tradeDeskStats()).toMatchObject({ builds: 1, hits: 1, cached: 1 });
  });

  it('says plainly that AI is off with no key, and the AI desk refuses in words while every figure still stands', async () => {
    const desk = await tradeDeskNow(String(save.org));
    expect(desk.ai.available).toBe(false);
    expect(desk.ai.off?.text).toBe('AI is off. Everything on the desk works without it.');
    expect(desk.ai.off?.basis.because.map((b) => b.label)).toEqual(['Why', 'What still works']);
    const ask = post(`/api/v2/views/${save.org}/trades/ask`, { sent: [save.regular], received: [theirs()[0]], thread: [] });
    await expect(ask).rejects.toThrow(`-> 409 ${JSON.stringify({ error: TRADE_AI_OFF })}`);
    // Every figure is there without it
    const view = await tradeAnalysisNow(String(save.org), { sent: String(save.regular), received: String(theirs()[0]) });
    expect(view.difference?.headline.text).toMatch(/^Most likely /);
  });
});
