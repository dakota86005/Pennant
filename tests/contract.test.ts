import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SPEC_PATH, buildSpec, serializeSpec } from '../scripts/lib/contractSpec.js';
import { operations } from '../server/contract/routes.js';
import { api, runImport } from '../server/api.js';
import { startJob } from '../server/jobs.js';
import { registeredRoutes } from './apiRoutes';
import { BANNED_JARGON, BANNED_VERDICTS, bannedIn, bannedInPayload, shownStrings } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The presentation contract holds (D-056, SWIFTUI_REBUILD.md section 4.3): the committed spec is a fresh build, every
 * route and operation is on both sides, every JSON GET the spec describes answers in its shape against the synthetic
 * save, the event stream's events are `ServerEvent`s, and what the Mac app shows passes the one banned-jargon list.
 *
 * A failure here after a server type changed means: run `npm run contract:build` and commit `contract/openapi.json`.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SLOW = 120_000;
const SWIFT_SPEC = path.join(process.cwd(), 'macos', 'Packages', 'PennantAPI', 'Sources', 'PennantAPI', 'openapi.json');

describe('the committed contract', () => {
  it('equals a fresh build of the server\'s types (run `npm run contract:build` if not)', () => {
    const committed = fs.readFileSync(SPEC_PATH, 'utf8');
    expect(committed).toBe(serializeSpec(buildSpec()));
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

  it('asks for the bearer token, and serves the event stream as server-sent events', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(spec.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(spec.paths['/api/v2/events'].get.responses['200'].content)).toEqual(['text/event-stream']);
  });
});

describe('every route is in the contract, and back', () => {
  const byKey = (method: string, p: string) => `${method.toUpperCase()} ${p}`;
  const listed = new Set(operations.map((op) => byKey(op.method, op.path.replace(/^\/api/, ''))));
  const registered = registeredRoutes();

  it('lists every registered /v2 route', () => {
    const v2 = registered.filter((r) => r.path.startsWith('/v2/'));
    expect(v2.length).toBeGreaterThan(0);
    expect(v2.map((r) => byKey(r.method, r.path)).filter((k) => !listed.has(k))).toEqual([]);
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

describe('the server answers in the contract\'s shape (the synthetic save)', () => {
  let base = '';
  let close = (): void => {};
  let save: BuiltSave;
  let home = '';
  const realHome = process.env.HOME;
  let validator: (type: string) => ValidateFunction;

  beforeAll(async () => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11 });
    // A pretend Mac home with one OOTP save, so finding saves reads neither the real disk nor nothing at all
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-contract-home-'));
    const csv = path.join(home, 'Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Test League.lg/import_export/csv');
    fs.mkdirSync(csv, { recursive: true });
    fs.writeFileSync(path.join(csv, 'players.csv'), 'player_id\n1\n');
    process.env.HOME = home;
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
