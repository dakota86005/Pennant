import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Router } from 'express';
import { SHAPES_SPEC_PATH, SPEC_PATH, buildShapesSpec, buildSpec, serializeSpec, transform } from '../scripts/lib/contractSpec.js';
import { operations } from '../server/contract/routes.js';
import { api, runImport } from '../server/api.js';
import { startJob } from '../server/jobs.js';
import { registeredRoutes, type RegisteredRoute } from './apiRoutes';
import { BANNED_JARGON, BANNED_VERDICTS, bannedIn, bannedInPayload, shownStrings } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The presentation contract holds (D-056, SWIFTUI_REBUILD.md section 4.3): the committed spec is a fresh build, every
 * route and operation is on both sides, every JSON GET the spec describes answers in its shape against the synthetic
 * save, the event stream's events are `ServerEvent`s, and what the Mac app shows passes the one banned-jargon list.
 *
 * A failure here after a server type changed means: run `npm run contract:build` and commit `contract/openapi.json`.
 * The captured payloads in `contract/fixtures/` (which the Swift tests decode) are compared too; after a change that
 * alters them, run `npm run contract:fixtures` and commit them.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SLOW = 120_000;
const SWIFT_SPEC = path.join(process.cwd(), 'macos', 'Packages', 'PennantAPI', 'Sources', 'PennantAPI', 'openapi.json');
const FIXTURES = path.join(process.cwd(), 'contract', 'fixtures');
const WRITE_FIXTURES = process.env.CONTRACT_FIXTURES === 'write';
const SHAPES = path.join(process.cwd(), 'tests', 'contractShapes');

describe('the committed contract', () => {
  it('equals a fresh build of the server\'s types (run `npm run contract:build` if not)', () => {
    const committed = fs.readFileSync(SPEC_PATH, 'utf8');
    expect(committed).toBe(serializeSpec(buildSpec()));
  }, SLOW);

  it('builds the tests\' shape contract into the Swift shape tests unchanged (run `npm run contract:build` if not)', () => {
    expect(fs.readFileSync(SHAPES_SPEC_PATH, 'utf8')).toBe(serializeSpec(buildShapesSpec()));
  }, SLOW);

  it('is the very file the Swift package generates from (a link, not a second copy)', () => {
    expect(fs.lstatSync(SWIFT_SPEC).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(SWIFT_SPEC)).toBe(fs.realpathSync(SPEC_PATH));
  });
});

describe('the contract\'s shape', () => {
  const spec = buildSpec() as Any;
  const schemas = spec.components.schemas as Record<string, Any>;

  it('writes a closed string union as an open enum, so an older app reads a new code', () => {
    // ImportProgress.phase is 'reading' | 'writing' | 'indexing' in TypeScript
    expect(schemas.ImportProgress.properties.phase.anyOf).toEqual([
      { type: 'string', enum: ['reading', 'writing', 'indexing'] },
      { type: 'string' },
    ]);
    // Nowhere is a multi-value enum left closed
    const closed: string[] = [];
    const walk = (node: Json, at: string, parentAnyOf: boolean): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}/${i}`, parentAnyOf));
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.enum) && node.enum.length > 1 && !parentAnyOf) closed.push(at);
      for (const [k, v] of Object.entries(node)) walk(v, `${at}/${k}`, k === 'anyOf');
    };
    walk(schemas as Json, '#/components/schemas', false);
    expect(closed).toEqual([]);
  });

  it('keeps an event\'s type tag closed and the event union open, with the catch-all last', () => {
    expect(schemas.HelloEvent.properties.type).toEqual({ type: 'string', enum: ['hello'] });
    const members = schemas.ServerEvent.anyOf.map((m: Any) => m.$ref);
    expect(members.at(-1)).toBe('#/components/schemas/UnknownServerEvent');
    expect(members.length).toBeGreaterThan(5);
    expect(schemas.UnknownServerEvent.required).toEqual(['type']);
  });

  it('names GameDate as a string with no format, and uses it for game dates', () => {
    expect(schemas.GameDate.type).toBe('string');
    expect(schemas.GameDate).not.toHaveProperty('format');
    expect(JSON.stringify(schemas.DataStatus)).toContain('#/components/schemas/GameDate');
  });

  it('never closes an object to new fields, which an older app would then fail on', () => {
    expect(JSON.stringify(spec)).not.toMatch(/"additionalProperties":false/);
  });

  it('writes ids and counts as integers, so the app reads an Int', () => {
    expect(schemas.Integer).toMatchObject({ type: 'integer' });
    for (const [type, field] of [['Org', 'team_id'], ['JobEvent', 'orgId'], ['ImportProgress', 'fileIndex'], ['Settings', 'defaultOrgId']]) {
      expect(schemas[type].properties[field], `${type}.${field}`).toMatchObject({ $ref: '#/components/schemas/Integer' });
    }
  });

  it('asks for the bearer token, and serves the event stream as server-sent events', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(spec.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(spec.paths['/api/v2/events'].get.responses['200'].content)).toEqual(['text/event-stream']);
  });
});

describe('every /v2 route is in the contract and back; every reused route listed is registered', () => {
  const byKey = (method: string, p: string) => `${method.toUpperCase()} ${p}`;
  const listed = new Set(operations.map((op) => byKey(op.method, op.path.replace(/^\/api/, ''))));
  const registered = registeredRoutes();
  const unlistedV2 = (routes: RegisteredRoute[]) =>
    routes.filter((r) => r.path.startsWith('/v2/')).map((r) => byKey(r.method, r.path)).filter((k) => !listed.has(k));

  it('lists every registered /v2 route', () => {
    expect(registered.filter((r) => r.path.startsWith('/v2/')).length).toBeGreaterThan(0);
    expect(unlistedV2(registered)).toEqual([]);
  });

  it('sees a /v2 route on a router mounted at a prefix, and refuses a prefix it cannot read', () => {
    const outer = Router();
    const inner = Router();
    inner.get('/front-office/:org', (_req, res) => res.json({}));
    const deeper = Router();
    deeper.get('/:dept', (_req, res) => res.json({}));
    inner.use('/departments', deeper);
    outer.use('/v2', inner);
    expect(registeredRoutes(outer)).toEqual([
      { method: 'GET', path: '/v2/front-office/:org' },
      { method: 'GET', path: '/v2/departments/:dept' },
    ]);
    expect(unlistedV2(registeredRoutes(outer))).toEqual(['GET /v2/front-office/:org', 'GET /v2/departments/:dept']);
    const withParam = Router();
    withParam.use('/v2/views/:org', inner);
    expect(() => registeredRoutes(withParam)).toThrow(/plain path prefix/);
  });

  it('describes only routes the router really registers, method and path', () => {
    const real = new Set(registered.map((r) => byKey(r.method, r.path)));
    expect([...listed].filter((k) => !real.has(k))).toEqual([]);
    // A reused route is under /api but not /v2; everything new is under /v2
    for (const op of operations) expect(op.path.startsWith('/api/v2/'), op.operationId).toBe(!op.reused);
  });

  it('puts every listed operation in the spec, and nothing else', () => {
    const spec = buildSpec() as Any;
    const inSpec: string[] = [];
    for (const [p, methods] of Object.entries(spec.paths as Record<string, Record<string, Any>>)) {
      for (const [method, op] of Object.entries(methods)) inSpec.push(`${byKey(method, p)} ${op.operationId}`);
    }
    const expected = operations.map((op) => `${byKey(op.method, op.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'))} ${op.operationId}`);
    expect(inSpec.sort()).toEqual(expected.sort());
  }, SLOW);
});

describe('the builder refuses what the Swift client could not read', () => {
  it('splits a number-or-string type into one member per type, null on the last', () => {
    expect(transform({ type: ['number', 'string', 'null'] }, true)).toEqual({ anyOf: [{ type: 'number' }, { type: ['string', 'null'] }] });
    expect(transform({ type: ['number', 'string'], description: 'd' }, false)).toEqual({ description: 'd', anyOf: [{ type: 'number' }, { type: 'string' }] });
    // One type with null is already what the generator reads
    expect(transform({ type: ['string', 'null'] }, true)).toEqual({ type: ['string', 'null'] });
    // As a record's values (Row.sort) too
    expect(transform({ type: 'object', additionalProperties: { type: ['number', 'string', 'null'] } }, true)).toEqual({
      type: 'object', additionalProperties: { anyOf: [{ type: 'number' }, { type: ['string', 'null'] }] },
    });
    expect(() => transform({ type: ['number', 'string'], minimum: 1 }, true)).toThrow(/cannot be written for the Swift generator/);
  });

  it('refuses two different types with one name', () => {
    expect(() => buildSpec({ index: path.join(SHAPES, 'collision', 'index.ts'), operations: [], openUnions: {} })).toThrow(/Two different types are named "Info"/);
  }, SLOW);

  it('refuses an exported generic, and says to export a concrete alias', () => {
    expect(() => buildSpec({ index: path.join(SHAPES, 'generic', 'index.ts'), operations: [], openUnions: {} })).toThrow(/export type ClaimRow = Row<Claim>/);
  }, SLOW);
});

/** The strict form the server is held to: enums closed, no catch-all event, and no field the spec does not describe. */
function strictValidator(): (type: string) => ValidateFunction {
  const spec = buildSpec({ open: false }) as Any;
  const seal = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(seal);
    if (!node || typeof node !== 'object') return node;
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(node)) out[k] = seal(v);
    if (out.properties && out.additionalProperties === undefined) out.unevaluatedProperties = false;
    return out;
  };
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'pennant', components: { schemas: seal(spec.components.schemas) } });
  const compiled = new Map<string, ValidateFunction>();
  return (type) => {
    if (!spec.components.schemas[type]) throw new Error(`No schema ${type}`);
    let fn = compiled.get(type);
    if (!fn) compiled.set(type, (fn = ajv.compile({ $ref: `pennant#/components/schemas/${type}` })));
    return fn;
  };
}

/** Temporary folders' random names, the host's clock and the app's version, made stable so fixtures compare. */
function stable(value: unknown): unknown {
  const roots = [...new Set([os.tmpdir(), fs.realpathSync(os.tmpdir())])];
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  const walk = (node: unknown, key: string): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, key));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    if (typeof node !== 'string') return node;
    if (iso.test(node)) return '2040-07-01T12:00:00.000Z';
    if (key === 'version') return '0.0.0';
    let text = node;
    for (const root of roots) {
      text = text.split(root).join('/tmp');
    }
    return text.replace(/\/(ootp-fo-test|pennant-contract-home|pennant-contract-export)-[A-Za-z0-9]+/g, '/$1');
  };
  return walk(value, '');
}

/** Compares a captured payload with its committed fixture, or writes it (`npm run contract:fixtures`). */
function fixture(name: string, content: string): void {
  const file = path.join(FIXTURES, name);
  if (WRITE_FIXTURES) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return;
  }
  expect(fs.existsSync(file), `${name} is missing: run npm run contract:fixtures`).toBe(true);
  expect(fs.readFileSync(file, 'utf8'), `${name} differs: run npm run contract:fixtures`).toBe(content);
}

const json = (value: unknown): string => `${JSON.stringify(stable(value), null, 2)}\n`;

describe('the server answers in the contract\'s shape (the synthetic save)', () => {
  let base = '';
  let close = (): void => {};
  let save: BuiltSave;
  let home = '';
  const realHome = process.env.HOME;
  let validator: (type: string) => ValidateFunction;
  // A key in the environment would show up in key status (and in a fixture); none is read here
  const KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_API_KEY'];
  const realKeys = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));

  beforeAll(async () => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11 });
    // A pretend Mac home with one OOTP save, so finding saves reads neither the real disk nor nothing at all
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-contract-home-'));
    const csv = path.join(home, 'Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Test League.lg/import_export/csv');
    fs.mkdirSync(csv, { recursive: true });
    fs.writeFileSync(path.join(csv, 'players.csv'), 'player_id\n1\n');
    process.env.HOME = home;
    for (const k of KEY_VARS) delete process.env[k];
    const app = express();
    app.use(express.json());
    app.use('/api', api);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => {
      server.closeAllConnections();
      server.close();
    };
    validator = strictValidator();
  }, SLOW);

  afterAll(() => {
    close();
    process.env.HOME = realHome;
    for (const [k, v] of Object.entries(realKeys)) if (v !== undefined) process.env[k] = v;
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  const reads = operations.filter((op) => op.method === 'get' && !op.stream);
  const SAMPLE_PARAMS: Record<string, () => string> = { orgId: () => String(save.org) };

  it('has JSON GETs to check, so the check cannot pass vacuously', () => {
    expect(reads.length).toBeGreaterThan(5);
  });

  it.each(reads.map((op) => [op.operationId, op] as const))('%s', async (_id, op) => {
    const url = op.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
      const sample = SAMPLE_PARAMS[name];
      if (!sample) throw new Error(`Give ${op.operationId}'s :${name} a sample value in SAMPLE_PARAMS`);
      return sample();
    });
    const res = await fetch(`${base}${url}`);
    expect(res.status, url).toBe(200);
    const body = await res.json();
    const validate = validator(op.response);
    expect(validate(body) ? [] : validate.errors, `${op.operationId} against ${op.response}`).toEqual([]);
    // Something to check: an empty list proves nothing about its items' shape
    if (Array.isArray(body)) expect(body.length, op.operationId).toBeGreaterThan(0);
    // What the Mac app shows from a /v2 payload passes the banned-jargon list
    if (op.path.startsWith('/api/v2/')) expect(bannedInPayload(body)).toEqual([]);
    // Where the server looked for saves depends on the platform, so it is no fixture
    if (op.operationId !== 'getSearchLocations') fixture(`responses/${op.operationId}.json`, json(body));
  }, SLOW);

  /**
   * The POSTs, in the answers that are safe to cause here (the synthetic data folder is a temporary one). Setting a
   * save and starting an import (their 200s) would start an import; their 400s are checked, their 200s are not.
   */
  const POSTS: Record<string, Array<{ body: unknown; status: number; name: string }>> = {
    resolveFolder: [
      { name: 'no-folder', body: { path: '' }, status: 400 },
      { name: 'saves', body: { path: '$HOME/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games' }, status: 200 },
      { name: 'export', body: { path: '$HOME/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Test League.lg' }, status: 200 },
    ],
    setSaveSource: [
      { name: 'cleared', body: { lgPath: '' }, status: 200 },
      { name: 'not-a-save', body: { lgPath: '/nowhere/Not A Save.lg' }, status: 400 },
    ],
    setSave: [{ name: 'no-folder', body: {}, status: 400 }],
    startImport: [{ name: 'no-save', body: undefined, status: 400 }],
  };

  it('answers every POST in the contract\'s shape, for each answer it is safe to cause here', async () => {
    const posts = operations.filter((op) => op.method === 'post');
    expect(posts.map((op) => op.operationId).sort()).toEqual(Object.keys(POSTS).sort());
    for (const op of posts) {
      for (const c of POSTS[op.operationId]) {
        const body = c.body === undefined ? undefined : JSON.parse(JSON.stringify(c.body).split('$HOME').join(home));
        const res = await fetch(`${base}${op.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        expect(res.status, `${op.operationId} ${c.name}`).toBe(c.status);
        const type = c.status === 200 ? op.response : op.errors?.[c.status];
        expect(type, `${op.operationId} documents ${c.status}`).toBeDefined();
        const answer = await res.json();
        const validate = validator(type!);
        expect(validate(answer) ? [] : validate.errors, `${op.operationId} ${c.name} against ${type}`).toEqual([]);
        fixture(`responses/${op.operationId}-${c.name}.json`, json(answer));
      }
    }
  }, SLOW);

  it('streams events that are ServerEvents: the hello, an import from start to finish, and a job', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/v2/events`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ name: string; data: Any }> = [];
    let buffer = '';
    const until = async (done: () => boolean): Promise<void> => {
      while (!done()) {
        const { value, done: ended } = await reader.read();
        if (ended) throw new Error('the stream ended early');
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name && data) events.push({ name, data: JSON.parse(data) });
        }
      }
    };
    try {
      await until(() => events.some((e) => e.name === 'hello'));
      const tiny = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-contract-export-'));
      fs.writeFileSync(path.join(tiny, 'zz_contract.csv'), 'id,note\n1,one\n2,two\n');
      await runImport(tiny);
      await until(() => events.some((e) => e.name === 'import-finished'));
      startJob('contract-check', save.org, async () => {});
      await until(() => events.some((e) => e.name === 'job' && e.data.status.state === 'done'));
    } finally {
      controller.abort();
    }
    const names = new Set(events.map((e) => e.name));
    for (const name of ['hello', 'import-started', 'import-progress', 'import-finished', 'job']) expect(names, name).toContain(name);
    const validate = validator('ServerEvent');
    for (const event of events) {
      expect(event.data.type, 'the SSE event name is the payload\'s type').toBe(event.name);
      expect(validate(event.data) ? [] : validate.errors, event.name).toEqual([]);
      expect(bannedInPayload(event.data)).toEqual([]);
    }
    // The first of each kind (the last job, which is done), as the stream sends them
    const kept = ['hello', 'import-started', 'import-progress', 'import-finished'].map((name) => events.find((e) => e.name === name)!);
    kept.push(events.filter((e) => e.name === 'job').at(-1)!);
    fixture('events.sse', kept.map((e) => `event: ${e.name}\ndata: ${JSON.stringify(stable(e.data))}\n\n`).join(''));
  }, SLOW);

  it('holds the server to the strict form: an undescribed field or an unlisted code fails', () => {
    const status = validator('ImportProgress');
    const good = { table: 'players', fileIndex: 1, files: 2, rows: 3, phase: 'writing' };
    expect(status(good)).toBe(true);
    expect(status({ ...good, extra: 1 })).toBe(false);
    expect(status({ ...good, phase: 'guessing' })).toBe(false);
  });
});

describe('the banned-jargon walk over a /v2 payload', () => {
  // No Claims are served yet (they arrive at N4); a small payload proves the walk reads what the app would show
  const sample = {
    title: 'Front Office',
    sections: [
      {
        claims: [
          { text: 'Scoring runs: 3rd of 30', hint: 'His percentile among regulars', value: { n: 4.8, display: '4.8 runs a game' } },
          { text: 'You should keep him', basis: { because: [{ label: 'Runs', value: '612' }] } },
        ],
        rows: [{ id: 'r1', cells: { name: { display: 'null' } }, sort: { name: 'players_value' } }],
      },
    ],
  };

  it('finds every text, hint and display, however deep, and nothing else', () => {
    expect(shownStrings(sample).map((s) => s.path)).toEqual([
      '$.sections[0].claims[0].text',
      '$.sections[0].claims[0].hint',
      '$.sections[0].claims[0].value.display',
      '$.sections[0].claims[1].text',
      '$.sections[0].rows[0].cells.name.display',
    ]);
  });

  it('flags jargon in a hint, a verdict in a line and a leak in a cell, and passes the clean ones', () => {
    const found = bannedInPayload(sample).map((f) => `${f.path} ${f.pattern}`);
    expect(found).toEqual([
      `$.sections[0].claims[0].hint ${String(BANNED_JARGON.find((p) => p.test('percentile')))}`,
      `$.sections[0].claims[1].text ${String(BANNED_VERDICTS.find((p) => p.test('should')))}`,
      `$.sections[0].rows[0].cells.name.display ${String(BANNED_JARGON.find((p) => p.test('null')))}`,
    ]);
    // A sort key or an id is not shown, so it is not read
    expect(found.join(' ')).not.toContain('sort');
    expect(bannedIn('Scoring runs: 3rd of 30')).toEqual([]);
  });
});
