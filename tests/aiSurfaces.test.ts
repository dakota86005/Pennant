import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../server/db.js';
import { DATA_DIR } from '../server/config.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import {
  aiSurfaceStats, briefingPath, historyPath, readConversation, resetAiSurfaces, storylinesPath, writeConversation,
} from '../server/aiSurfacesService.js';
import { bannedInPayload } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * The AI surfaces on the Mac (N13, Stage A; D-001, D-006, D-074), with a stubbed provider standing in for the model:
 * the Staff room's stream in order, a failure part-way, a provider refusing the key, AI off, the links, the kept
 * conversation, and the keys, which are never served, logged or echoed. Cases: BEHAVIOR_CASES.md "Pennant for Mac".
 */

interface LoopOpts {
  system: string;
  messages: Array<{ role: string; content: unknown }>;
  onText: (delta: string) => void;
  onTool: (name: string) => void;
  onFallback: (n: { message: string; from: string; to: string; provider: string }) => void;
}
type Script = (o: LoopOpts) => Promise<{ answer: string; refused: boolean }>;
const asked: LoopOpts[] = [];
let script: Script;
let validate: (key: string) => Promise<void> = async () => {};
/** What a one-turn call (the briefing, storylines) answers; never a real provider. */
let complete: () => Promise<string> = async () => '## Status\nAll quiet.';

vi.mock('../server/providers.js', async (original) => {
  const real = await original<typeof import('../server/providers.js')>();
  return {
    ...real,
    // Every provider's tool loop, Anthropic's included, is the stub (the chat's own Anthropic path is not taken)
    toolLoopFor: () => async (o: LoopOpts) => {
      asked.push(o);
      return script(o);
    },
    providerFor: (id: Parameters<typeof real.providerFor>[0]) => ({
      ...real.providerFor(id), validateKey: (key: string) => validate(key), complete: () => complete(),
    }),
  };
});
// The model catalogue would ask Anthropic which models think; the stub answers without asking anyone
vi.mock('../server/models.js', async (original) => ({
  ...(await original<typeof import('../server/models.js')>()),
  supportsAdaptiveThinking: async () => false,
}));

const KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_API_KEY'];
const realKeys = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));
const KEY = 'sk-ant-test-key-not-real-7f3a';
let save: BuiltSave;
let base: string;
let manName: string;

interface Sse { name: string; data: any }

/** Posts and reads the whole stream (or the JSON refusal), event by event. */
async function ask(org: number | string, body: unknown, signal?: AbortSignal, onEvent?: (e: Sse) => void): Promise<{ status: number; events: Sse[]; json: any }> {
  const res = await fetch(`${base}/api/v2/staff-room/${org}/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) return { status: res.status, events: [], json: await res.json() };
  const events: Sse[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const name = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (name && data) {
          const event = { name, data: JSON.parse(data) };
          events.push(event);
          onEvent?.(event);
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err;
  }
  return { status: res.status, events, json: null };
}

const get = async (url: string) => {
  const res = await fetch(`${base}${url}`);
  return { status: res.status, json: await res.json() };
};
const post = async (url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

beforeAll(async () => {
  for (const k of KEY_VARS) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = KEY;
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
  manName = (db.prepare("SELECT first_name || ' ' || last_name AS n FROM players WHERE player_id = ?").get(save.regular) as { n: string }).n;
  resetFrontOfficeCache();
  resetAiSurfaces();
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
  for (const k of KEY_VARS) delete process.env[k];
  for (const [k, v] of Object.entries(realKeys)) if (v !== undefined) process.env[k] = v;
});

beforeEach(() => {
  asked.length = 0;
  process.env.ANTHROPIC_API_KEY = KEY;
  for (const persona of ['analyst', 'room', 'manager']) fs.rmSync(historyPath(save.org, persona), { force: true });
  for (const persona of ['analyst', 'room', 'manager']) fs.rmSync(path.join(DATA_DIR, `chat-context-${save.org}${persona === 'analyst' ? '' : `-${persona}`}.json`), { force: true });
  script = async (o) => {
    o.onTool('get_player');
    o.onText('## The read\n');
    o.onText(`- **${manName}** is hitting.\n`);
    o.onText('- Nothing to change yet.');
    return { answer: 'done', refused: false };
  };
  validate = async () => {};
  complete = async () => '## Status\nAll quiet.';
});

describe('the Staff room\'s stream (N13; D-001, D-074)', () => {
  it('streams in order: started, the speaker, a step, the text in the subset, the answer with its links, then done', async () => {
    const { status, events } = await ask(save.org, { with: 'analyst', question: `How is ${manName} doing?` });
    expect(status).toBe(200);
    const names = events.map((e) => e.name);
    expect(names[0]).toBe('started');
    expect(names[1]).toBe('speaker');
    expect(names.at(-1)).toBe('done');
    expect(names.indexOf('looking-up')).toBeGreaterThan(1);
    expect(names.indexOf('answered')).toBe(names.length - 2);
    for (const e of events) expect(e.data.type, 'the event name is its type').toBe(e.name);
    const id = events[1].data.messageId;
    for (const e of events.filter((x) => x.name === 'text' || x.name === 'looking-up')) expect(e.data.messageId).toBe(id);
    expect(events.find((e) => e.name === 'looking-up')!.data.step.display).toBe('Reading a player card');
    // The streamed text is in the subset at each line's start: no heading or bullet marker reaches the app
    const streamed = events.filter((e) => e.name === 'text').map((e) => e.data.delta).join('');
    expect(streamed).not.toMatch(/^#|\n#|^- |\n- /);
    expect(streamed).toContain('**The read**');
    expect(streamed).toContain('• ');
    // The answer replaces it: final, its names linked by the server
    const answered = events.find((e) => e.name === 'answered')!.data.message;
    expect(answered.id).toBe(id);
    expect(answered.answer.markdown).toContain(`[${manName}](pennant://player/${save.regular})`);
    expect(answered.answer.links[0]).toMatchObject({ url: `pennant://player/${save.regular}`, text: manName, target: { kind: 'player', playerId: save.regular } });
    expect(answered.speaker.display).toMatch(/·/);
    expect(events[0].data.question).toMatchObject({ from: 'gm', typed: `How is ${manName} doing?` });
    // Every word served on the stream passes the plain-language rule
    for (const e of events) expect(bannedInPayload(e.data), e.name).toEqual([]);
  });

  it('keeps the conversation in the React chat\'s own file, and serves it back with the marking', async () => {
    await ask(save.org, { with: 'analyst', question: 'Who can pitch tonight?' });
    const kept = readConversation(save.org, 'analyst');
    expect(kept.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(kept[0].content).toBe('Who can pitch tonight?');
    expect(kept[1]).toMatchObject({ tools: ['get_player'] });
    const { status, json } = await get(`/api/v2/staff-room/${save.org}/conversation?with=analyst`);
    expect(status).toBe(200);
    expect(json.messages).toHaveLength(2);
    expect(json.count.display).toBe('1 question');
    expect(json.written.text).toMatch(/written by AI/);
    expect(json.written.basis.because.map((b: { value: string }) => b.value).join(' ')).toMatch(/decides nothing/);
    // The model was handed the question and the thread, as the React chat hands them
    expect(asked[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'Who can pitch tonight?' });
  });

  it('the React chat\'s own route answers as before, through the one function both ask', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: save.org, persona: 'analyst', messages: [{ role: 'user', content: 'Who can pitch tonight?' }] }),
    });
    const text = await res.text();
    const names = [...text.matchAll(/^event: (.*)$/gm)].map((m) => m[1]);
    expect(names).toEqual(['tool', 'text', 'text', 'text', 'done']);
    expect(text).toContain('event: tool\ndata: {"name":"get_player"}\n\n');
    expect(text).toContain('event: text\ndata: {"delta":"## The read\\n"}\n\n');
  });

  it('a failure part-way ends in failed, in words, and keeps what was asked and what had arrived', async () => {
    script = async (o) => {
      o.onText('Half an answer');
      throw Object.assign(new Error('upstream exploded'), { status: 500 });
    };
    const { events } = await ask(save.org, { with: 'analyst', question: 'Who is hurt?' });
    const names = events.map((e) => e.name);
    expect(names.at(-1)).toBe('failed');
    expect(names).not.toContain('done');
    const failed = events.at(-1)!.data;
    expect(failed.reason).toBe('failed');
    expect(failed.failure.text).toBe('The answer couldn\'t be finished.');
    expect(failed.partial.answer.markdown).toBe('Half an answer');
    expect(readConversation(save.org, 'analyst').map((m) => m.content)).toEqual(['Who is hurt?', 'Half an answer']);
  });

  it('a provider that refuses the key says so (aiErrorStatus), never as the answer failing, and never shows the key', async () => {
    script = async () => {
      throw Object.assign(new Error(`invalid x-api-key ${KEY}`), { status: 401 });
    };
    const { events } = await ask(save.org, { with: 'analyst', question: 'Who is hurt?' });
    const failed = events.at(-1)!.data;
    expect(failed).toMatchObject({ type: 'failed', reason: 'keyRefused', partial: null });
    expect(failed.failure.text).toBe('The AI provider refused the key.');
    expect(JSON.stringify(events)).not.toContain(KEY);
    // The question is kept; an answer that never started is not
    expect(readConversation(save.org, 'analyst').map((m) => m.role)).toEqual(['user']);
  });


  it('in the room, each person answers in turn, each a message of his own; one asked by name answers alone', async () => {
    const room = (await get(`/api/v2/staff-room/${save.org}`)).json;
    const people = room.staff.filter((p: { room: boolean }) => !p.room).map((p: { id: string }) => p.id);
    expect(room.room.members.length).toBeGreaterThan(0);
    const two = people.slice(0, 2);
    const { events } = await ask(save.org, { with: 'room', members: two, question: 'What is the biggest problem right now?' });
    expect(events[0].data.answering).toEqual(two);
    const speakers = events.filter((e) => e.name === 'speaker');
    expect(speakers).toHaveLength(2);
    expect(speakers[0].data.messageId).not.toBe(speakers[1].data.messageId);
    expect(events.filter((e) => e.name === 'answered')).toHaveLength(2);
    expect(readConversation(save.org, 'room').map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    // A name at the start of the message: that man alone
    const first = room.staff.find((p: { id: string }) => p.id === two[1]).name.display.split(' ')[0];
    const aimed = await ask(save.org, { with: 'room', members: two, question: `${first}, what do you think?` });
    expect(aimed.events[0].data.answering).toEqual([two[1]]);
  });

  it('"Ask about him": a player dragged in is asked about in the server\'s words', async () => {
    const { events } = await ask(save.org, { with: 'analyst', about: { playerId: save.regular } });
    const typed: string = events[0].data.question.typed;
    expect(typed).toContain(manName);
    expect(typed).toMatch(/^What do you make of /);
    expect((await ask(save.org, { with: 'analyst', about: { playerId: 99_999_999 } })).status).toBe(404);
    expect((await ask(save.org, { with: 'analyst' })).status).toBe(400);
  });

  it('answers one question at a time per conversation, and keeps what arrived when the app stops listening', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    script = async (o) => {
      o.onText('First part. ');
      await gate;
      o.onText('Second part.');
      return { answer: 'x', refused: false };
    };
    const controller = new AbortController();
    let sawText!: () => void;
    const textSeen = new Promise<void>((resolve) => { sawText = resolve; });
    const running = ask(save.org, { with: 'analyst', question: 'Long one?' }, controller.signal, (e) => { if (e.name === 'text') sawText(); });
    await textSeen;
    const second = await ask(save.org, { with: 'analyst', question: 'And another?' });
    expect(second.status).toBe(409);
    expect(second.json.error).toMatch(/Still answering/);
    // Start over is refused while it answers, too
    expect((await fetch(`${base}/api/v2/staff-room/${save.org}/conversation?with=analyst`, { method: 'DELETE' })).status).toBe(409);
    controller.abort();
    await running;
    await vi.waitFor(() => expect(readConversation(save.org, 'analyst').map((m) => m.content)).toEqual(['Long one?', 'First part. ']));
    release();
    // The answer finishing later changes nothing kept, and the conversation is free again
    await vi.waitFor(async () => expect((await ask(save.org, { with: 'analyst', question: 'Free now?' })).status).toBe(200));
  });
});

describe('AI off (D-001): every surface says so calmly, and nothing else changes', () => {
  it('serves a calm line on each surface, refuses to ask or write in words, and leaves the reports as they were', async () => {
    const withKey = (await get(`/api/v2/front-office/${save.org}`)).json;
    delete process.env.ANTHROPIC_API_KEY;
    for (const url of [`/api/v2/staff-room/${save.org}`, `/api/v2/staff-room/${save.org}/conversation`, `/api/v2/storylines/${save.org}`, `/api/v2/briefing/${save.org}`]) {
      const { status, json } = await get(url);
      expect(status, url).toBe(200);
      expect(json.ai.available, url).toBe(false);
      expect(json.ai.off.text, url).toBe('AI is off. Everything else in Pennant works without it.');
      expect(json.ai.off.basis.because[0].value, url).toMatch(/No Anthropic \(Claude\) key set|No API credential/);
      expect(bannedInPayload(json), url).toEqual([]);
    }
    expect((await get(`/api/v2/storylines/${save.org}`)).json.canWrite).toBe(false);
    const refused = await ask(save.org, { with: 'analyst', question: 'Anyone?' });
    expect(refused).toMatchObject({ status: 409, json: { error: 'AI is off. Add a key in Settings to ask your staff.' } });
    expect(await post(`/api/v2/storylines/${save.org}`)).toMatchObject({ status: 409, json: { error: expect.stringMatching(/^AI is off/) } });
    expect(await post(`/api/v2/briefing/${save.org}`)).toMatchObject({ status: 409, json: { error: expect.stringMatching(/^AI is off/) } });
    expect(asked).toHaveLength(0);
    // The deterministic path does not depend on AI: the Morning Report is the same with the key and without it
    const withoutKey = (await get(`/api/v2/front-office/${save.org}`)).json;
    expect(withoutKey).toEqual(withKey);
    expect((await get('/api/v2/ai/keys')).json.off.text).toBe('AI is off. Everything else in Pennant works without it.');
  });
});

describe('Storylines and the GM Briefing (N13; D-074)', () => {
  it('serves what was written, when and from which export, marked as AI; says when it was written from an earlier export', async () => {
    const gameDate = (db.prepare('SELECT "current_date" AS d FROM leagues LIMIT 1').get() as { d: string }).d;
    fs.writeFileSync(storylinesPath(save.org), JSON.stringify({
      generatedAt: '2040-07-01T12:00:00.000Z', gameDate: '2040-4-2', orgLabel: 'Club', notice: { message: 'Answered by another model.' },
      storylines: [{ category: 'Player Spotlight', headline: `${manName} keeps hitting`, body: `## Hot\n${manName} has carried the lineup.` }],
    }));
    fs.writeFileSync(briefingPath(save.org), JSON.stringify({
      generatedAt: '2040-07-01T12:00:00.000Z', gameDate, notice: null, markdown: `Intro.\n\n## Status\n- **${manName}** is fine.\n\n## Watch List\nNothing.`,
    }));
    try {
      const stories = (await get(`/api/v2/storylines/${save.org}`)).json;
      expect(stories.state).toBe('written');
      expect(stories.status.text).toMatch(/^Written .+, from the export of April 2, 2040\.$|^Written .+, from the export of Apr 2, 2040\.$/);
      expect(stories.older.text).toMatch(/^Written from an earlier export/);
      expect(stories.notice.display).toBe('Answered by another model.');
      expect(stories.written.text).toBe('Written by AI from Pennant\'s figures. It decides nothing.');
      expect(stories.stories[0].body.markdown).toBe(`**Hot**\n[${manName}](pennant://player/${save.regular}) has carried the lineup.`);
      expect(stories.canWrite).toBe(true);
      const briefing = (await get(`/api/v2/briefing/${save.org}`)).json;
      expect(briefing.older).toBeNull();
      expect(briefing.sections.map((s: { heading: string | null }) => s.heading)).toEqual([null, 'Status', 'Watch List']);
      expect(briefing.sections[1].body.markdown).toBe(`• **[${manName}](pennant://player/${save.regular})** is fine.`);
      expect(bannedInPayload(stories)).toEqual([]);
      expect(bannedInPayload(briefing)).toEqual([]);
    } finally {
      fs.rmSync(storylinesPath(save.org), { force: true });
      fs.rmSync(briefingPath(save.org), { force: true });
    }
    const never = (await get(`/api/v2/briefing/${save.org}`)).json;
    expect(never).toMatchObject({ state: 'never', sections: [], written: null, older: null });
    expect(never.status.text).toBe('No briefing written yet.');
  });

  it('writes in the background on request: writing at once, then written, through the React routes\' own job', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    complete = async () => {
      await gate;
      return `## Status\n**${manName}** is fine.`;
    };
    const writing = await post(`/api/v2/briefing/${save.org}`);
    expect(writing.status).toBe(200);
    expect(writing.json).toMatchObject({ state: 'writing', canWrite: false, write: { display: 'Writing…' } });
    release();
    await vi.waitFor(async () => expect((await get(`/api/v2/briefing/${save.org}`)).json.state).toBe('written'));
    const after = (await get(`/api/v2/briefing/${save.org}`)).json;
    expect(after.sections[0].body.markdown).toContain(`pennant://player/${save.regular}`);
    // A failure is said in words, and what was written before stays
    complete = async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); };
    await post(`/api/v2/briefing/${save.org}`);
    await vi.waitFor(async () => expect((await get(`/api/v2/briefing/${save.org}`)).json.state).toBe('failed'));
    const failed = (await get(`/api/v2/briefing/${save.org}`)).json;
    expect(failed.status.text).toBe('The briefing couldn\'t be written this time.');
    expect(failed.sections.length).toBeGreaterThan(0);
    fs.rmSync(briefingPath(save.org), { force: true });
  });

  it('is kept per import and per file, never rebuilt for nothing', async () => {
    resetAiSurfaces();
    await get(`/api/v2/storylines/${save.org}`);
    await get(`/api/v2/storylines/${save.org}`);
    expect(aiSurfaceStats()).toMatchObject({ builds: 1, hits: 1 });
    writeConversation(save.org, 'analyst', [{ role: 'user', content: 'Hello?', at: '2040-07-01T12:00:00.000Z' }]);
    const one = (await get(`/api/v2/staff-room/${save.org}/conversation`)).json;
    writeConversation(save.org, 'analyst', [{ role: 'user', content: 'Hello?', at: '2040-07-01T12:00:00.000Z' }, { role: 'user', content: 'Again?', at: '2040-07-01T12:01:00.000Z' }]);
    const two = (await get(`/api/v2/staff-room/${save.org}/conversation`)).json;
    expect(two.conversationStamp).not.toBe(one.conversationStamp);
    expect(two.messages).toHaveLength(2);
  });
});

describe('the AI keys (D-006, D-055): never served, logged or echoed; only to their own provider', () => {
  it('lists each provider\'s key state and source in words, with at most the key\'s last four characters', async () => {
    const { status, json } = await get('/api/v2/ai/keys');
    expect(status).toBe(200);
    const anthropic = json.providers.find((p: { id: string }) => p.id === 'anthropic');
    expect(anthropic).toMatchObject({ configured: true, needsKey: true, source: 'env', sourceText: { display: 'From the environment' } });
    expect(anthropic.status.text).toBe(`Key set, from the environment (ends ${KEY.slice(-4)}).`);
    expect(anthropic.usedFor.display).toMatch(/^Used for /);
    const ollama = json.providers.find((p: { id: string }) => p.id === 'ollama');
    expect(ollama).toMatchObject({ needsKey: false, check: null, getOne: null });
    expect(JSON.stringify(json)).not.toContain(KEY);
    expect(json.off).toBeNull();
    expect(bannedInPayload(json)).toEqual([]);
  });

  it('checks a key with its own provider without repeating, logging or keeping it', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); }));
    const credentials = path.join(DATA_DIR, 'credentials.json');
    const before = fs.existsSync(credentials) ? fs.readFileSync(credentials, 'utf8') : null;
    const sent: string[] = [];
    try {
      const good = 'sk-ant-good-key-0000-1111-2222';
      const bad = 'sk-ant-bad-key-3333-4444-5555';
      const slow = 'sk-ant-unreachable-6666-7777';
      validate = async (key) => {
        sent.push(key);
        if (key === bad) throw Object.assign(new Error(`invalid x-api-key: ${key}`), { status: 401 });
        if (key === slow) throw new Error(`fetch failed for ${key}`);
      };
      const works = await post('/api/v2/ai/keys/check', { provider: 'anthropic', key: good });
      expect(works).toMatchObject({ status: 200, json: { provider: 'anthropic', outcome: 'works', result: { text: 'The key works.' } } });
      const refused = await post('/api/v2/ai/keys/check', { provider: 'anthropic', key: bad });
      expect(refused.json).toMatchObject({ outcome: 'refused', result: { text: 'The provider turned the key down.' } });
      const unchecked = await post('/api/v2/ai/keys/check', { provider: 'anthropic', key: slow });
      expect(unchecked.json).toMatchObject({ outcome: 'unchecked' });
      // With no key sent, the key the server holds is checked, with its own provider only
      expect((await post('/api/v2/ai/keys/check', { provider: 'anthropic' })).json.outcome).toBe('works');
      expect(sent).toEqual([good, bad, slow, KEY]);
      for (const key of [good, bad, slow, KEY]) {
        for (const answer of [works, refused, unchecked]) expect(JSON.stringify(answer.json)).not.toContain(key);
        for (const line of lines) expect(line).not.toContain(key);
      }
      // Checking keeps nothing: no key file is written, and the key in use is the one it was
      expect(fs.existsSync(credentials) ? fs.readFileSync(credentials, 'utf8') : null).toBe(before);
      expect((await get('/api/v2/ai/keys')).json.providers[0].status.text).toContain(KEY.slice(-4));
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it('a sidecar given its keys on stdin says they come from the Keychain and writes no key file', async () => {
    const { setInjectedKeys, saveApiKey } = await import('../server/settings.js');
    delete process.env.ANTHROPIC_API_KEY;
    const credentials = path.join(DATA_DIR, 'credentials.json');
    const before = fs.existsSync(credentials) ? fs.readFileSync(credentials, 'utf8') : null;
    setInjectedKeys({ anthropic: 'sk-ant-from-keychain-9999' });
    saveApiKey('sk-ant-typed-in-settings-8888', 'openai');
    const { json } = await get('/api/v2/ai/keys');
    expect(json.where.text).toBe('Keys are kept in your Mac\'s Keychain.');
    expect(json.providers[0]).toMatchObject({ source: 'keychain', sourceText: { display: 'From the Keychain' } });
    expect(json.providers[0].status.text).toBe('Key set, from the Keychain (ends 9999).');
    expect(JSON.stringify(json)).not.toMatch(/sk-ant-from-keychain|sk-ant-typed-in-settings/);
    expect(fs.existsSync(credentials) ? fs.readFileSync(credentials, 'utf8') : null).toBe(before);
    // The Staff room is on with the handed-over key
    expect((await get(`/api/v2/staff-room/${save.org}`)).json.ai.available).toBe(true);
  });
});

describe('the served markdown subset and its links (D-074)', () => {
  it('rewrites block markers the app would show as they are, and leaves the inline ones', async () => {
    const { inSubset } = await import('../server/presentation/ai/markdown.js');
    expect(inSubset('## Status\n- **One** thing\n* two\n> quoted\n---\n\n\n1. first\n  - nested *it*')).toBe(
      '**Status**\n• **One** thing\n• two\nquoted\n\n1. first\n  • nested *it*');
    expect(inSubset('### **Bold heading** ##')).toBe('**Bold heading**');
  });

  it('streams the same text the whole answer gets, however the deltas fall', async () => {
    const { StreamedSubset, inSubset } = await import('../server/presentation/ai/markdown.js');
    const answer = '## The read\nHe is fine.\n\n- **One**: a thing\n- Two, *slowly*\n> a quote\nPlain -5 runs and *emphasis*.';
    for (const size of [1, 2, 3, 5, 8, 13, answer.length]) {
      const s = new StreamedSubset();
      let out = '';
      for (let i = 0; i < answer.length; i += size) out += s.push(answer.slice(i, i + size));
      out += s.end();
      expect(out, `chunks of ${size}`).toBe(inSubset(answer));
    }
  });

  it('streams exactly the final text for ordinary output, split anywhere (review M3)', async () => {
    const { StreamedSubset, inSubset } = await import('../server/presentation/ai/markdown.js');
    // The review's counterexamples, each with the final text it must stream
    const cases: Array<[string, string]> = [
      ['A\n\n\n\nB', 'A\n\nB'],
      ['### Title ##', '**Title**'],
      ['## A *b* c', '**A *b* c**'],
      ['Trailing   \nspaces  ', 'Trailing\nspaces'],
      ['Above\n* * *\nBelow', 'Above\nBelow'],
      ['> ## Quoted', '**Quoted**'],
      ['\n\n\nLead and trail\n\n\n', 'Lead and trail'],
      ['## **Bold** title #**', '**Bold title**'],
      ['## \nx', '##\nx'],
    ];
    for (const [input, final] of cases) expect(inSubset(input), JSON.stringify(input)).toBe(final);
    // Random splits of those, and of random text over the characters that decide a line or a link
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const alphabet = ['#', '#', ' ', ' ', '\n', '\n', '-', '*', '*', '>', '_', '+', 'a', 'b', 'Z', '1', '.', '`', '[', ']', '(', ')', '<', ':', '/', '!', '\\', '\t', '\r'];
    const inputs = [...cases.map(([i]) => i)];
    for (let n = 0; n < 400; n++) inputs.push(Array.from({ length: 1 + rnd(40) }, () => alphabet[rnd(alphabet.length)]).join(''));
    for (const input of inputs) {
      const final = inSubset(input);
      for (let t = 0; t < 4; t++) {
        const s = new StreamedSubset();
        let out = '';
        for (let i = 0; i < input.length;) {
          const step = 1 + rnd(5);
          out += s.push(input.slice(i, i + step));
          i += step;
        }
        out += s.end();
        expect(out, JSON.stringify(input)).toBe(final);
      }
    }
  });

  it('keeps the line rules the subset had: the streamer agrees with the whole-text reading line by line', async () => {
    const { subsetBlocks } = await import('../server/presentation/ai/markdown.js');
    // The reading the subset was defined by (before N13's review): each whole line, then blank runs folded and the ends trimmed
    const HEADING = /^#{1,6}\s+/; const BULLET = /^[-*+]\s+/; const QUOTE = /^>\s?/; const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
    const line = (raw: string): string | null => {
      const text = raw.replace(/\s+$/, '');
      if (RULE.test(text)) return null;
      const indent = /^\s*/.exec(text)![0];
      let body = text.slice(indent.length).replace(QUOTE, '');
      if (HEADING.test(body)) {
        const words = body.replace(HEADING, '').replace(/\*\*/g, '').replace(/\s*#+\s*$/, '').trim();
        return words ? `**${words}**` : null;
      }
      if (BULLET.test(body)) body = `• ${body.replace(BULLET, '')}`;
      return `${indent.length >= 2 ? '  ' : ''}${body}`;
    };
    const reference = (md: string): string => {
      const out: string[] = [];
      for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
        const l = line(raw);
        if (l === null) continue;
        if (l.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue;
        out.push(l.trim() === '' ? '' : l);
      }
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
      return out.join('\n');
    };
    let seed = 11;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const alphabet = ['#', '#', '#', ' ', ' ', '\n', '\n', '-', '*', '*', '>', '_', '+', 'a', 'b', '\t', '\r'];
    for (let n = 0; n < 2000; n++) {
      const input = Array.from({ length: 1 + rnd(30) }, () => alphabet[rnd(alphabet.length)]).join('');
      expect(subsetBlocks(input), JSON.stringify(input)).toBe(reference(input));
    }
  });

  it('serves only the server\'s links: a link, autolink or address the model wrote is never one (review H1)', async () => {
    const { linked, StreamedSubset } = await import('../server/presentation/ai/markdown.js');
    const index = { players: [{ id: 1, name: 'Sam Ryan', ours: true, teamId: 10 }], clubs: [] };
    const model = [
      'Ask [him](pennant://player/999) or [x](javascript:alert(1)) or ![pic](https://evil.example/p.png).',
      'See <https://evil.example> and <pennant://club/3>, or pennant://player/5 and javascript:alert(1).',
      '[Sam Ryan](https://x) is ours; [ref]: https://evil.example',
      'Escaped \\\\<https://evil.example> stays text; `code [x](y)` stays code.',
    ].join('\n');
    const out = linked(model, index);
    // Every link the text can still form (outside code) is the server's, and listed
    const outsideCode = out.markdown.replace(/`[^`]*`/g, '');
    const formed = [...outsideCode.matchAll(/(?<!\\)\[([^\]]*)\]\(([^)]*)\)/g)].map((m) => m[2]);
    expect(formed).toEqual(['pennant://player/1']);
    for (const url of formed) expect(out.links.map((l) => l.url)).toContain(url);
    expect(out.links.map((l) => l.url)).toEqual(['pennant://player/1']);
    // A '<' or '[' the reader would take as markup: one with an even number of backslashes before it
    const live = (text: string, ch: string): number[] => [...text].flatMap((c, i) => {
      if (c !== ch) return [];
      let n = 0;
      while (i - n - 1 >= 0 && text[i - n - 1] === '\\') n += 1;
      return n % 2 === 0 ? [i] : [];
    });
    expect(live(outsideCode, '<')).toEqual([]);
    expect(live(outsideCode, '[').map((i) => outsideCode.slice(i, i + 39))).toEqual(['[Sam Ryan](pennant://player/1) is ours;']);
    // No address the model wrote is left to follow: outside the server's own links, no scheme is read as one
    expect(outsideCode.replace(/\[Sam Ryan\]\(pennant:\/\/player\/1\)/g, '')).not.toMatch(/(pennant|javascript|https):/i);
    // The words stay: only the link goes
    expect(out.markdown).toContain('Ask him or x or pic.');
    expect(out.markdown).toContain('`code [x](y)`');
    // Deltas carry no link either
    const s = new StreamedSubset();
    let streamed = '';
    for (const ch of model) streamed += s.push(ch);
    streamed += s.end();
    const streamedText = streamed.replace(/`[^`]*`/g, '');
    expect([...live(streamedText, '['), ...live(streamedText, '<')]).toEqual([]);
    expect(streamedText).not.toMatch(/(pennant|javascript):/i);
  });

  it('links a full name the league knows, never a shared one unless exactly one man is ours, and never inside a link or code', async () => {
    const { linked } = await import('../server/presentation/ai/markdown.js');
    const index = {
      players: [
        { id: 1, name: 'Sam Ryan', ours: true, teamId: 10 },
        { id: 2, name: 'Joe Dee', ours: false, teamId: 11 },
        { id: 3, name: 'Joe Dee', ours: false, teamId: 12 },
        { id: 4, name: 'Al Bo', ours: true, teamId: 10 },
        { id: 5, name: 'Al Bo', ours: false, teamId: 13 },
        { id: 6, name: 'Cher', ours: true, teamId: 10 },
      ],
      clubs: [{ teamId: 10, name: 'Arizona Diamondbacks', nickname: 'Diamondbacks' }],
    };
    const out = linked('Sam Ryan and Joe Dee and Al Bo; Cher; the Diamondbacks; `Sam Ryan`; [Sam Ryan](https://x).', index);
    // A link the model wrote is reduced to its words, and the server links the name in them (review H1)
    expect(out.markdown).toBe(
      '[Sam Ryan](pennant://player/1) and Joe Dee and [Al Bo](pennant://player/4); Cher; the [Diamondbacks](pennant://club/10); `Sam Ryan`; [Sam Ryan](pennant://player/1).');
    expect(out.links.map((l) => l.url)).toEqual(['pennant://player/1', 'pennant://player/4', 'pennant://club/10']);
    expect(out.links[0].target).toEqual({ kind: 'player', playerId: 1, teamId: 10 });
  });
});

describe('the committed stream fixture (for the Mac stage)', () => {
  /** The stream as Stage B decodes it: a solo answer and a failure, captured into `contract/fixtures/` (`npm run contract:fixtures`). */
  it('captures a Staff room answer and a failure as server-sent events', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2040-07-01T12:00:00.000Z'));
    const steady = (data: any): any => JSON.parse(JSON.stringify(data), (key, value) =>
      key === 'conversationStamp' ? 'cstamp'
        : (key === 'clock' || key === 'calendarDay') && value ? { ...value, display: key === 'clock' ? '12:00 PM' : 'Jul 1, 2040' } : value);
    try {
      const answered = await ask(save.org, { with: 'analyst', question: `How is ${manName} doing?` });
      script = async (o) => {
        o.onText('Half an answer');
        throw Object.assign(new Error('rejected'), { status: 401 });
      };
      vi.setSystemTime(new Date('2040-07-01T12:05:00.000Z'));
      const failed = await ask(save.org, { with: 'analyst', question: 'And the bullpen?' });
      const sse = [...answered.events, ...failed.events].map((e) => `event: ${e.name}\ndata: ${JSON.stringify(steady(e.data))}\n\n`).join('');
      const file = path.join(process.cwd(), 'contract', 'fixtures', 'staff-room.sse');
      if (process.env.CONTRACT_FIXTURES === 'write') fs.writeFileSync(file, sse);
      else expect(fs.readFileSync(file, 'utf8'), 'staff-room.sse differs: run npm run contract:fixtures').toBe(sse);
    } finally {
      vi.useRealTimers();
    }
  });
});
