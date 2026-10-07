import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../server/db.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { resetTradeDesk } from '../server/tradeDeskService.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * The Trade Desk's AI desk with AI on (N12 Track C, D-073; review M1, M5): a stubbed provider stands in for the model, so
 * what the desk is handed and how its answer is marked can be read. One function asks the desk for the React page's two
 * routes and the Mac app's; the Mac app's is never handed the club's value of a win (D-060), and the answer is the AI's
 * own words, which decide nothing (D-001).
 */

interface Asked { system: string; messages: Array<{ role: string; content: string }> }
const asked: Asked[] = [];
let failWith: { status: number; message: string } | null = null;

vi.mock('../server/providers.js', async (original) => {
  const real = await original<typeof import('../server/providers.js')>();
  return {
    ...real,
    toolLoop: () => async (o: { system: string; messages: Array<{ role: string; content: string }> }) => {
      asked.push({ system: o.system, messages: o.messages });
      if (failWith) throw Object.assign(new Error(failWith.message), { status: failWith.status });
      return { answer: '**Read:** a fair swap on the figures.\n\nHe plays second.' };
    },
  };
});

const KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_API_KEY'];
const realKeys = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));
let save: BuiltSave;
let base: string;

async function call(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

const ODDS = [/postseason/i, /playoff/i, /\bodds\b/i, /\bposture\b/i, /clubValueOfAWin/];
const orgOf = (id: number) => (db.prepare('SELECT organization_id AS o FROM players WHERE player_id = ?').get(id) as { o: number } | undefined)?.o;
const theirs = () => save.hitters.filter((h) => orgOf(h) !== save.org && (orgOf(h) ?? 0) > 0);
const everything = (a: Asked) => [a.system, ...a.messages.map((m) => m.content)].join('\n');

beforeAll(async () => {
  for (const k of KEY_VARS) delete process.env[k];
  // A key the stub never sends anywhere: AI is on
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
  resetFrontOfficeCache();
  resetTradeDesk();
  const express = (await import('express')).default;
  const { api } = await import('../server/api.js');
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const listening = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listening.once('listening', resolve));
  base = `http://127.0.0.1:${(listening.address() as { port: number }).port}`;
}, 120_000);

afterAll(() => {
  resetTradeDesk();
  for (const k of KEY_VARS) delete process.env[k];
  for (const [k, v] of Object.entries(realKeys)) if (v !== undefined) process.env[k] = v;
});

beforeEach(() => {
  asked.length = 0;
  failWith = null;
});

describe('the AI desk with AI on (N12; D-001, D-060)', () => {
  it('hands the Mac app\'s desk no value of a win and no odds, while the React page\'s routes are as they were', async () => {
    const deal = { sent: [save.regular], received: [theirs()[0]] };
    const mac = await call(`/api/v2/views/${save.org}/trades/ask`, { ...deal, thread: [] });
    expect(mac.status).toBe(200);
    expect(asked).toHaveLength(1);
    for (const re of ODDS) expect(everything(asked[0]), String(re)).not.toMatch(re);
    // The question, with a thread, is asked of the same desk and handed the same (no value of a win)
    await call(`/api/v2/views/${save.org}/trades/ask`, { ...deal, thread: [{ role: 'assistant', content: 'A fair swap.' }], message: 'Who plays second?' });
    for (const re of ODDS) expect(everything(asked[1]), String(re)).not.toMatch(re);
    expect(asked[1].messages.at(-1)).toEqual({ role: 'user', content: 'Who plays second?' });

    // The React page's routes are unchanged: still handed the value of a win, in their own shapes
    const evalBody = { orgId: save.org, sideA: deal.sent, sideB: deal.received, orgLabel: 'the club' };
    const read = await call('/api/trade/ai-eval', evalBody);
    expect(read.status).toBe(200);
    expect(Object.keys(read.json)).toEqual(['verdict', 'voice', 'notice']);
    expect(read.json.verdict).toMatch(/^\*\*Read:\*\*/);
    expect(everything(asked[2])).toMatch(/clubValueOfAWin/);
    const reply = await call('/api/trade/ai-reply', { ...evalBody, message: ' Who plays second? ', thread: [] });
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.json)).toEqual(['reply', 'voice', 'notice']);
    expect(asked[3].messages.at(-1)).toEqual({ role: 'user', content: 'Who plays second?' });
    // One desk: the Mac app's opening read is the React page's brief (after the line naming the club), less the value of a win
    const brief = (a: Asked) => a.system.split('\n').slice(1).join('\n').replace(/ "clubValueOfAWin"[^\n]*/, '');
    expect(brief(asked[0])).toBe(brief(asked[2]));
  });

  it('marks the answer as written by AI, which decides nothing', async () => {
    const mac = await call(`/api/v2/views/${save.org}/trades/ask`, { sent: [save.regular], received: [theirs()[0]], thread: [] });
    expect(mac.json.content).toBe('**Read:** a fair swap on the figures.\n\nHe plays second.');
    expect(mac.json.about.text).toMatch(/'s read, written by AI from the figures above\.$/);
    const what = mac.json.about.basis.because.find((b: { label: string }) => b.label === 'What it is');
    expect(what.value).toMatch(/It decides nothing, and the decision is yours\./);
  });

  it('answers a provider that refuses the key with a 401, as the React routes do, and logs no raw error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      failWith = { status: 401, message: 'invalid x-api-key' };
      const mac = await call(`/api/v2/views/${save.org}/trades/ask`, { sent: [save.regular], received: [theirs()[0]], thread: [] });
      const old = await call('/api/trade/ai-eval', { orgId: save.org, sideA: [save.regular], sideB: [theirs()[0]] });
      expect(old.status).toBe(401);
      expect(mac.status).toBe(401);
      expect(mac.json).toEqual({ error: old.json.error });
      // Any other failure is the provider's (a 502), worded, and logged by its words only
      failWith = { status: 529, message: 'overloaded' };
      const busy = await call(`/api/v2/views/${save.org}/trades/ask`, { sent: [save.regular], received: [theirs()[0]], thread: [] });
      expect(busy.status).toBe(502);
      expect(typeof busy.json.error).toBe('string');
      const logged = errors.mock.calls.filter((c) => String(c[0]).startsWith('[trade-desk]'));
      expect(logged.length).toBeGreaterThan(0);
      for (const c of logged) expect(c.every((part) => typeof part === 'string')).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it('refuses in words with a side empty, before asking anybody', async () => {
    const empty = await call(`/api/v2/views/${save.org}/trades/ask`, { sent: [save.regular], received: [], thread: [] });
    expect(empty).toEqual({ status: 400, json: { error: 'Put a player on each side first.' } });
    expect(asked).toHaveLength(0);
  });
});
