import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Router } from 'express';
import { db } from '../server/db.js';
import { api } from '../server/api.js';
import { serverApp } from '../server/serverApp.js';
import { BODY_LIMITS, BODY_NOT_JSON, BODY_NOT_JSON_TYPE, BODY_TOO_LARGE, DEFAULT_BODY_LIMIT, bodyLimitFor } from '../server/requestBody.js';
import { OTHER_SITE_REFUSED } from '../server/sameOrigin.js';
import { V2_FAILED } from '../server/v2Routes.js';
import { STAFF_AI_OFF } from '../server/chat.js';
import { THREAD_TURNS_KEPT, THREAD_TURN_CHARS, threadKept } from '../server/ai.js';
import { computePlayers } from '../server/league.js';
import { IDS } from './fixture';

/**
 * One bad request never takes the server down, and no other website drives it (B-74, B-75; D-081). Everything here goes
 * through production's own request chain (`serverApp`), never a copy of it (SRVHEALTH-18).
 */

const KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_API_KEY'];
const realKeys = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));

let server: Server;
let base: string;
/** Every rejection nothing handled while the tests ran: there must be none. */
const escaped: unknown[] = [];
const onRejection = (err: unknown): void => {
  escaped.push(err);
};

beforeAll(async () => {
  // No AI key: nothing here may reach a provider
  for (const k of KEY_VARS) delete process.env[k];
  process.prependListener('unhandledRejection', onRejection);
  server = serverApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  process.off('unhandledRejection', onRejection);
  server.closeAllConnections();
  server.close();
  for (const [k, v] of Object.entries(realKeys)) if (v !== undefined) process.env[k] = v;
});

const send = (method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}) =>
  fetch(`${base}${path}`, { method, body: init.body, headers: init.headers, signal: AbortSignal.timeout(5_000) });
const json = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  send(method, path, { body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

/** The process still answers: the proof that nothing above ended it. */
async function stillAlive(): Promise<void> {
  expect((await send('GET', '/api/status')).status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(escaped).toEqual([]);
}

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> };
  handle: Function & { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean };
}

/** A nested router's mount path, read back from Express 4's layer (`/v2`, or '' for a router used without one). */
function mountOf(layer: Layer): string {
  if (layer.regexp.fast_slash) return '';
  const source = layer.regexp.source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '');
  return source.replace(/\\\//g, '/');
}

/** Every route the API serves: its method, its path, and its handlers. */
function routesOf(router: { stack: Layer[] }, prefix = ''): Array<{ method: string; path: string; handlers: Function[] }> {
  const found: Array<{ method: string; path: string; handlers: Function[] }> = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        found.push({ method: method.toUpperCase(), path: prefix + layer.route.path, handlers: layer.route.stack.map((s) => s.handle) });
      }
    } else if (layer.handle.stack) {
      found.push(...routesOf(layer.handle as unknown as { stack: Layer[] }, prefix + mountOf(layer)));
    }
  }
  return found;
}

const ROUTES = routesOf(api as unknown as Router & { stack: Layer[] });
const WRITES = ROUTES.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method));
/** A route's path with every parameter filled in: our club, a player, a note. */
const concrete = (path: string): string => `/api${path.replace(/:org\b|:orgId\b/g, String(IDS.mlbTeam)).replace(/:[A-Za-z]+/g, '1')}`;
const bytes = (limit: string): number => {
  const m = /^(\d+)(kb|mb)$/.exec(limit)!;
  return Number(m[1]) * (m[2] === 'kb' ? 1024 : 1024 * 1024);
};

describe('async route handlers (B-75, SRVHEALTH-01)', () => {
  it('finds the routes it checks', () => {
    expect(ROUTES.length).toBeGreaterThan(100);
    expect(WRITES.map((r) => r.path)).toEqual(expect.arrayContaining(['/trade/ai-reply', '/v2/staff-room/:org/ask', '/v2/views/:org/trades/ask']));
  });

  it('registers no async handler bare: each goes through asyncRoute, so a rejection reaches the error handler', () => {
    const bare = ROUTES.filter((r) => r.handlers.some((h) => h.constructor.name === 'AsyncFunction')).map((r) => `${r.method} ${r.path}`);
    expect(bare).toEqual([]);
  });

  it('answers a malformed AI reply request (a message that is not text) with a 400, and keeps serving', async () => {
    const res = await json('POST', '/api/trade/ai-reply', { message: 5 });
    expect(res.status).toBe(400);
    await stillAlive();
  });

  it('answers a key that is not text with a 400, and keeps serving', async () => {
    const res = await json('POST', '/api/settings/api-key', { key: 5, provider: 'anthropic' });
    expect(res.status).toBe(400);
    await stillAlive();
  });

  it('a thrown rejection inside an async route is answered by the error handler', async () => {
    // A thread that is not a list used to throw outside any try in the React desk's reply
    const res = await json('POST', '/api/trade/ai-reply', { message: 'why?', sideA: [IDS.starter], sideB: [IDS.tradedAway], thread: { not: 'a list' } });
    expect(res.status).toBeLessThan(600);
    expect(res.status).toBeGreaterThanOrEqual(400);
    await stillAlive();
  });
});

describe("the Staff room's checks before the stream (B-75, SRVHEALTH-01)", () => {
  it('asks about a player on a save whose teams table has no nickname: an answer, not a crash', async () => {
    const saved = db.prepare('SELECT team_id, nickname FROM teams').all() as Array<{ team_id: number; nickname: string | null }>;
    db.exec('ALTER TABLE teams DROP COLUMN nickname');
    try {
      const res = await json('POST', `/api/v2/staff-room/${IDS.mlbTeam}/ask`, { with: 'room', about: { playerId: IDS.tradedAway } });
      // The question is put together without the nickname; with no key, AI is off, said in words
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(STAFF_AI_OFF);
    } finally {
      db.exec('ALTER TABLE teams ADD COLUMN nickname TEXT');
      for (const row of saved) db.prepare('UPDATE teams SET nickname = ? WHERE team_id = ?').run(row.nickname, row.team_id);
    }
    await stillAlive();
  });

  it('a failure in a check before the stream is answered in words, never thrown out of the handler', async () => {
    // "Ask about him" reads the player's name before the stream starts: a save whose players table lacks it fails that
    // check (resolving the club, which reads neither column, still succeeds). The handler's own try and `asyncRoute` each
    // hand such a failure to the /v2 error handler, so this answer holds while either does; with neither, the request is
    // left hanging and this times out. The router walk above pins `asyncRoute`
    db.exec('ALTER TABLE players RENAME COLUMN first_name TO first_name_gone');
    try {
      const res = await json('POST', `/api/v2/staff-room/${IDS.mlbTeam}/ask`, { with: 'room', about: { playerId: IDS.tradedAway } });
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.error).toBe(V2_FAILED);
      expect(body.detail).toMatch(/^server log [0-9a-f]{8}$/);
      expect(JSON.stringify(body)).not.toMatch(/sqlite|no such column|first_name/i);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    } finally {
      db.exec('ALTER TABLE players RENAME COLUMN first_name_gone TO first_name');
    }
    await stillAlive();
  });
});

describe('raw errors never reach the Mac app (B-75, SRVPRES-14)', () => {
  it('a /v2 failure is said in words with a log reference, never the raw message', async () => {
    db.exec('ALTER TABLE players RENAME TO players_gone');
    try {
      const res = await send('GET', `/api/v2/staff-room/${IDS.mlbTeam}`);
      if (res.status === 500) {
        const body = await res.json();
        expect(body.error).toBe(V2_FAILED);
        expect(body.detail).toMatch(/^server log [0-9a-f]{8}$/);
        expect(JSON.stringify(body)).not.toMatch(/sqlite|no such table|players/i);
      } else {
        expect(res.status).toBeLessThan(500);
      }
    } finally {
      db.exec('ALTER TABLE players_gone RENAME TO players');
    }
  });

  it('a crafted sort key is read as an unknown stat, not a crash (SRVSTATS-29)', async () => {
    for (const sort of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(computePlayers({ sort }).ok).toBe(true);
      expect((await send('GET', `/api/players?sort=${sort}`)).status).toBe(200);
    }
  });
});

describe('every write survives a bad body (B-75)', () => {
  it('states a limit for every route, and a larger one only where a conversation is resent', () => {
    expect(DEFAULT_BODY_LIMIT).toBe('100kb');
    for (const { limit } of BODY_LIMITS) expect(bytes(limit)).toBeLessThanOrEqual(bytes('1mb'));
    expect(bodyLimitFor(`/api/v2/views/${IDS.mlbTeam}/trades/ask`)).toBe('1mb');
    expect(bodyLimitFor('/api/settings')).toBe(DEFAULT_BODY_LIMIT);
  });

  it('a malformed, an oversized and a non-JSON body to every POST, PUT, PATCH and DELETE is a 4xx, and the process lives', async () => {
    expect(WRITES.length).toBeGreaterThan(30);
    for (const route of WRITES) {
      const url = concrete(route.path);
      const label = `${route.method} ${route.path}`;
      const malformed = await send(route.method, url, { body: '{"oops":', headers: { 'content-type': 'application/json' } });
      expect([label, malformed.status, (await malformed.json()).error]).toEqual([label, 400, BODY_NOT_JSON]);
      const big = `{"pad":"${'x'.repeat(bytes(bodyLimitFor(url)) + 1)}"}`;
      const oversized = await send(route.method, url, { body: big, headers: { 'content-type': 'application/json' } });
      expect([label, oversized.status, (await oversized.json()).error]).toEqual([label, 413, BODY_TOO_LARGE]);
      const plain = await send(route.method, url, { body: 'x', headers: { 'content-type': 'text/plain' } });
      expect([label, plain.status, (await plain.json()).error]).toEqual([label, 415, BODY_NOT_JSON_TYPE]);
    }
    await stillAlive();
  }, 60_000);

  it('the Trade Desk thread, which the Mac resends whole, fits within its route and is capped on the server (SRVHEALTH-02)', async () => {
    const turns = Array.from({ length: 56 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(1900) }));
    // About 105 KB: refused at the old 100 KB default, read now
    const res = await json('POST', `/api/v2/views/${IDS.mlbTeam}/trades/ask`, { sent: [IDS.starter], received: [IDS.tradedAway], thread: turns, message: 'Still?' });
    expect(res.status).toBe(409); // AI off: the request was read
    const kept = threadKept([...turns, { role: 'system', content: 'no' }, { role: 'user', content: 7 }, { role: 'user', content: 'y'.repeat(THREAD_TURN_CHARS + 50) }]);
    expect(kept).toHaveLength(THREAD_TURNS_KEPT);
    expect(kept.at(-1)!.content).toHaveLength(THREAD_TURN_CHARS);
    expect(threadKept({ not: 'a list' })).toEqual([]);
  });
});

describe('no other website drives the server (B-74, SRVINFRA-07; D-081)', () => {
  it('refuses a write from another site, in any body form', async () => {
    for (const path of [`/api/briefing/${IDS.mlbTeam}`, `/api/storylines/${IDS.mlbTeam}`, '/api/import', '/api/v2/setup/automatic', `/api/export-site/${IDS.mlbTeam}`]) {
      const evil = await send('POST', path, { body: 'x', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' } });
      expect([path, evil.status, (await evil.json()).error]).toEqual([path, 403, OTHER_SITE_REFUSED]);
      // An old browser that sends no Origin: the body is not JSON, so it is still refused before any route runs
      expect((await send('POST', path, { body: 'x', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    }
  });

  it('refuses whatever the browser marks as another site, a GET included', async () => {
    for (const site of ['cross-site', 'same-site']) {
      expect((await send('GET', '/api/status', { headers: { 'sec-fetch-site': site } })).status).toBe(403);
    }
    expect((await send('GET', '/api/status', { headers: { origin: 'http://localhost:9999' } })).status).toBe(403);
    expect((await send('GET', '/api/status', { headers: { origin: 'null' } })).status).toBe(403);
  });

  it("answers its own pages and programs that aren't browsers", async () => {
    const own = base.replace('http://', '');
    expect((await send('GET', '/api/status', { headers: { 'sec-fetch-site': 'same-origin', origin: `http://${own}` } })).status).toBe(200);
    expect((await send('GET', '/api/status', { headers: { 'sec-fetch-site': 'none' } })).status).toBe(200);
    expect((await send('GET', '/api/status')).status).toBe(200);
    // A same-origin write with a JSON body reaches its route (a refusal of its own, in words)
    const res = await json('POST', '/api/trade/ai-reply', {}, { origin: `http://${own}`, 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(400);
  });

  it('does not answer to 0.0.0.0 as a loopback name', async () => {
    const http = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: Number(new URL(base).port), path: '/api/status', headers: { host: `0.0.0.0:${new URL(base).port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).on('error', reject);
    });
    expect(status).toBe(403);
  });
});

// Last: the token, once set, stays set for this file's server
describe('with a token (the sidecar, Electron)', () => {
  it('requires it on every /api request, the other-site check still first', async () => {
    const { setApiToken } = await import('../server/apiToken.js');
    const token = 'e'.repeat(64);
    setApiToken(token);
    expect((await send('GET', '/api/status')).status).toBe(401);
    expect((await send('GET', '/api/status', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await send('GET', '/api/status', { headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' } })).status).toBe(403);
    // An unauthenticated body is never read
    const big = await send('POST', '/api/settings', { body: `{"pad":"${'x'.repeat(200_000)}"}`, headers: { 'content-type': 'application/json' } });
    expect(big.status).toBe(401);
  });
});
