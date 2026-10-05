import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Router } from 'express';
import { DIGEST_SWIFT_PATH, SHAPES_SPEC_PATH, SPEC_PATH, buildShapesSpec, buildSpec, digestSwift, serializeSpec, transform } from '../scripts/lib/contractSpec.js';
import { operations } from '../server/contract/routes.js';
import { basisProblems } from '../server/presentation/claim.js';
import { departmentReport, frontOfficeBuilt, frontOfficeRevision } from '../server/frontOfficeService.js';
import { farmAssignmentsNow, resetFarmViews } from '../server/farmViewService.js';
import type { Basis } from '../server/contract/presentation.js';
import { api, importState, runImport } from '../server/api.js';
import { loadConfig, saveConfig } from '../server/config.js';
import { startJob } from '../server/jobs.js';
import { themePacksFolder } from '../server/themePackStore.js';
import { historyDb, SNAPSHOT_DATA_COLUMNS, takeSnapshot } from '../server/history.js';
import { currentHistoryKey, forgetHistoryKey } from '../server/historyIdentity.js';
import { forgetMemoryCaches, recordReportSnapshot, recordStandingsSnapshot, setDeskRecord } from '../server/frontOfficeMemory.js';
import { registeredRoutes, type RegisteredRoute } from './apiRoutes';
import {
  BANNED_JARGON, BANNED_VERDICTS, FOLDER_PATHS, JARGON_EXCEPTIONS, bannedIn, bannedInPayload, exceptionsUsed, shownStrings,
  type JargonException,
} from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';
import { detectSaves } from '../server/paths.js';
import { discoveryClock, resetSaveDiscovery, scanSaves } from '../server/saveDiscovery.js';
import { subscribe, type ServerEvent } from '../server/serverEvents.js';
import { APP_STORE_27, PretendHome } from './saveHomeFixture';

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

  it('states its digest to the Mac app, current with the committed contract (run `npm run contract:build` if not; N6 B1 review M8)', () => {
    const committed = fs.readFileSync(SPEC_PATH, 'utf8');
    expect(fs.readFileSync(DIGEST_SWIFT_PATH, 'utf8')).toBe(digestSwift(committed));
    expect(digestSwift(`${committed} `)).not.toBe(digestSwift(committed));
  });

  it('is the very file the Swift package generates from (a link, not a second copy)', () => {
    expect(fs.lstatSync(SWIFT_SPEC).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(SWIFT_SPEC)).toBe(fs.realpathSync(SPEC_PATH));
  });
});

describe('the contract\'s shape', () => {
  const spec = buildSpec() as Any;
  const schemas = spec.components.schemas as Record<string, Any>;

  it('writes a closed string union as an open enum, so an older app reads a new code', () => {
    // ImportProgress.phase is 'reading' | 'writing' | 'indexing' | 'waiting' in TypeScript
    expect(schemas.ImportProgress.properties.phase.anyOf).toEqual([
      { type: 'string', enum: ['reading', 'writing', 'indexing', 'waiting'] },
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
    inner.get('/pretend-desk/:org', (_req, res) => res.json({}));
    const deeper = Router();
    deeper.get('/:dept', (_req, res) => res.json({}));
    inner.use('/pretend-sections', deeper);
    outer.use('/v2', inner);
    expect(registeredRoutes(outer)).toEqual([
      { method: 'GET', path: '/v2/pretend-desk/:org' },
      { method: 'GET', path: '/v2/pretend-sections/:dept' },
    ]);
    expect(unlistedV2(registeredRoutes(outer))).toEqual(['GET /v2/pretend-desk/:org', 'GET /v2/pretend-sections/:dept']);
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

/** Every `basis` in a served payload that breaks the builder's rules, with where it sits. */
function servedBasisProblems(payload: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}[${i}]`));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'basis' && v && typeof v === 'object') for (const p of basisProblems(v as Basis)) found.push(`${at}.basis: ${p}`);
      walk(v, `${at}.${k}`);
    }
  };
  walk(payload, '$');
  return found;
}

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
    // An import's own time, and its export's fingerprint (the files' times), vary run to run
    if (key === 'durationMs' && typeof node === 'number') return 0;
    if (key === 'exportFingerprint' && typeof node === 'string') return 'fingerprint';
    // A save's id hashes its folder's real path, which is a new temporary folder on every run (D-063)
    if ((key === 'id' || key === 'saveId') && typeof node === 'string' && /^[0-9a-f]{16}$/.test(node)) return 'saveid';
    if (typeof node !== 'string') return node;
    if (iso.test(node)) return '2040-07-01T12:00:00.000Z';
    if (key === 'version') return '0.0.0';
    // A build's stamp hashes the data folder's file times, which differ on every run
    if (key === 'reportStamp') return 'rstamp';
    // The desk's and Following's stamps hash the times their changes were made (N7)
    if (key === 'deskStamp') return 'dstamp';
    if (key === 'followStamp') return 'fstamp';
    // A served time in words is written in the host's zone; the fixture keeps a fixed one
    if (key === 'csvLastModifiedText' || key === 'lastPlayedText') return PLAYED_WORDS;
    // A time in words inside a line ("Marked Sep 28, 2026, 9:16 PM", N7) is the host's clock: the fixture keeps a fixed one
    let text = node.replace(/\b[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M\b/g, PLAYED_WORDS);
    for (const root of roots) {
      text = text.split(root).join('/tmp');
    }
    return text.replace(/\/(ootp-fo-test|pennant-contract-home|pennant-contract-export|pennant-home)-[A-Za-z0-9]+/g, '/$1');
  };
  // A "played since" notice writes the save's last-played words into its sentence: the same fixed words there
  const played = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(played);
    if (!node || typeof node !== 'object') return node;
    const record = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, played(v)]));
    const words = (record.save as { lastPlayedText?: unknown } | undefined)?.lastPlayedText;
    if (typeof words === 'string' && typeof record.text === 'string') record.text = record.text.split(words).join(PLAYED_WORDS);
    return record;
  };
  return walk(played(value), '');
}

const PLAYED_WORDS = 'Jul 1, 2040, 12:00 PM';

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
    // With a farm (N10): Farm & Development's views read an affiliate, its assignments and a farm player's history
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
    // A pretend Mac home with one OOTP save, so finding saves reads neither the real disk nor nothing at all
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-contract-home-'));
    const csv = path.join(home, 'Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Test League.lg/import_export/csv');
    fs.mkdirSync(csv, { recursive: true });
    fs.writeFileSync(path.join(csv, 'players.csv'), 'player_id\n1\n');
    process.env.HOME = home;
    for (const k of KEY_VARS) delete process.env[k];
    // The repository's example theme pack, installed, so the club's choices list a pack beside its own colours
    fs.cpSync(path.join(process.cwd(), 'docs', 'theme-packs', 'sunset-series'), path.join(themePacksFolder(), 'sunset-series'), { recursive: true });
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
    fs.rmSync(themePacksFolder(), { recursive: true, force: true });
  });

  const reads = operations.filter((op) => op.method === 'get' && !op.stream);
  /** The scoped jargon exceptions the live payloads lean on; one none of them uses is stale. */
  const exceptionsInUse = new Set<JargonException>();
  /** An item's evidence key on the synthetic save (a Major League Ops need), found once the save is built. */
  let evidenceKey = '';
  /** A farm player with an assignment and scouting history (N10), for the farm's decision and development detail. */
  let farmPlayer = 0;
  const SAMPLE_PARAMS: Record<string, () => string> = {
    orgId: () => String(save.org),
    org: () => String(save.org),
    dept: () => 'majorLeague',
    key: () => evidenceKey,
    // Another club's report (N7): the league's second club, not the one the app follows
    teamId: () => String(save.clubs[1]),
    playerId: () => String(farmPlayer),
    // N11: the player window's player (a regular hitter with a full record)
    id: () => String(save.regular),
  };
  /**
   * A query a GET is captured with, where it takes one (N7: search needs something typed; N8: a decision needs a need,
   * the synthetic save's first one with an evidence trail).
   */
  const SAMPLE_QUERIES: Record<string, () => string> = {
    search: () => '?q=club',
    // N10: a farm player's decision, keyed as Major League Ops' is
    getFarmDecision: () => `?player=${farmPlayer}`,
    getMajorLeagueDecision: () => `?need=${encodeURIComponent(evidenceKey.replace(/^\d+\.majorLeague:need:/, ''))}`,
    // N11: three players side by side, a pitcher among them
    getPlayerCompare: () => `?players=${save.regular},${save.hitters.find((h) => h !== save.regular)},${save.reliever}`,
  };

  it('has an item with an evidence trail on the synthetic save, for the claims route', async () => {
    const report = await departmentReport(save.org, 'majorLeague');
    evidenceKey = [...report.toDecide.items, ...report.watching.items].find((it) => it.evidence)?.evidence ?? '';
    expect(evidenceKey).not.toBe('');
  });

  it('has a farm player with an assignment and three snapshots of this save\'s rating history, for the farm\'s views (N10)', async () => {
    farmPlayer = (await farmAssignmentsNow(String(save.org))).rows[0]?.playerId ?? 0;
    expect(farmPlayer).toBeGreaterThan(0);
    const insert = historyDb.prepare(
      'INSERT INTO save_rating_snapshots (save_key, game_date, player_id, name, team_id, org_id, level, position, age, cur, pot, con, gap, pow, eye, avk, spd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const [date, step] of [['2040-3-20', 0], ['2040-4-30', 1], ['2040-6-20', 2]] as const) {
      insert.run(currentHistoryKey(), date, farmPlayer, 'Farm Player', save.farmClubs[0], save.org, 2, 6, 21, 40 + step, 60, 40 + step, 40, 40, 40, 40, 50);
    }
    // The views are built again with the history in place
    resetFarmViews();
  });

  it('has JSON GETs to check, so the check cannot pass vacuously', () => {
    expect(reads.length).toBeGreaterThan(5);
  });

  it.each(reads.map((op) => [op.operationId, op] as const))('%s', async (_id, op) => {
    const url = op.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
      const sample = SAMPLE_PARAMS[name];
      if (!sample) throw new Error(`Give ${op.operationId}'s :${name} a sample value in SAMPLE_PARAMS`);
      return sample();
    });
    const res = await fetch(`${base}${url}${SAMPLE_QUERIES[op.operationId]?.() ?? ''}`);
    expect(res.status, url).toBe(200);
    const body = await res.json();
    const validate = validator(op.response);
    expect(validate(body) ? [] : validate.errors, `${op.operationId} against ${op.response}`).toEqual([]);
    // Something to check: an empty list proves nothing about its items' shape
    if (Array.isArray(body)) expect(body.length, op.operationId).toBeGreaterThan(0);
    // What the Mac app shows from a /v2 payload passes the banned-jargon list
    if (op.path.startsWith('/api/v2/')) {
      expect(bannedInPayload(body, op.operationId)).toEqual([]);
      // Every basis the app will read meets the builder's rules (an evidence line, no blank sentence, a stamp with its
      // certainty), checked on the bytes that arrive
      expect(servedBasisProblems(body)).toEqual([]);
      for (const e of exceptionsUsed(body, op.operationId)) exceptionsInUse.add(e);
    }
    // Where the server looked for saves depends on the platform, so it is no fixture (and is left out of the saves')
    if (op.operationId === 'getSaveDiscovery') body.searched = [];
    if (op.operationId !== 'getSearchLocations') fixture(`responses/${op.operationId}.json`, json(body));
  }, SLOW);

  it('takes the farm player\'s snapshots out again, so the history questions below start from a save with none (N10)', () => {
    historyDb.prepare('DELETE FROM save_rating_snapshots WHERE save_key = ? AND player_id = ?').run(currentHistoryKey(), farmPlayer);
    resetFarmViews();
  });

  it('serves every department\'s report in the contract\'s shape, plain, with every basis sound (captured for the previews)', async () => {
    const validate = validator('DepartmentReport');
    for (const dept of ['frontOffice', 'majorLeague', 'farm', 'scouting', 'trades', 'finance', 'medical', 'league', 'philosophy']) {
      const res = await fetch(`${base}/api/v2/departments/automatic/${dept}`);
      expect(res.status, dept).toBe(200);
      const body = await res.json();
      expect(validate(body) ? [] : validate.errors, dept).toEqual([]);
      expect(bannedInPayload(body, 'getDepartmentReport', JARGON_EXCEPTIONS, { org: String(save.org), dept })).toEqual([]);
      expect(servedBasisProblems(body)).toEqual([]);
      fixture(`responses/getDepartmentReport-${dept}.json`, json(body));
    }
  }, SLOW);

  it('serves a what-if decision with its candidates in the contract\'s shape, plain (captured for the previews: real candidate rows)', async () => {
    const validate = validator('MlbDecisionView');
    const overview = await (await fetch(`${base}/api/v2/views/automatic/majorLeague/overview`)).json() as { whatIf: { players: Array<{ open: { key?: string } }> } };
    let captured = false;
    for (const choice of overview.whatIf.players) {
      const res = await fetch(`${base}/api/v2/views/automatic/majorLeague/decision?need=${encodeURIComponent(choice.open.key ?? '')}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { candidates: { groups: unknown[] } | null };
      if (!body.candidates?.groups.length) continue;
      expect(validate(body) ? [] : validate.errors).toEqual([]);
      expect(bannedInPayload(body, 'getMajorLeagueDecision')).toEqual([]);
      fixture('responses/getMajorLeagueDecision-what-if.json', json(body));
      captured = true;
      break;
    }
    expect(captured).toBe(true);
  }, SLOW);

  it('uses every scoped jargon exception in force, so a stale one is found', () => {
    expect(JARGON_EXCEPTIONS.filter((e) => !exceptionsInUse.has(e))).toEqual([]);
  });

  /**
   * The POSTs, in the answers that are safe to cause here (the synthetic data folder is a temporary one). Setting a
   * save and starting an import (their 200s) would start an import; their 400s are checked, their 200s are not.
   * Saving the settings writes the temporary folder's settings file, and is put back.
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
    // A save whose export is not there yet is chosen without an import, and the answer says why
    setSave: [
      { name: 'no-folder', body: {}, status: 400 },
      { name: 'no-export', body: { csvDir: '$HOME/Library/Nowhere/csv', saveName: 'No Export' }, status: 200 },
      // The Mac app's choice takes the club from the save; an export that isn't there names none, so Pennant will ask
      { name: 'club-from-save', body: { csvDir: '$HOME/Library/Nowhere/csv', saveName: 'No Export', club: 'fromSave' }, status: 200 },
    ],
    // The Setup window saves the club it picked, then goes back to automatic; the last case puts the preferences back
    saveSettings: [
      { name: 'club', body: { defaultOrgId: 2, theme: 'dark' }, status: 200 },
      { name: 'automatic', body: { clubChoice: 'automatic' }, status: 200 },
      { name: 'restored', body: { defaultOrgId: null, theme: 'system' }, status: 200 },
    ],
    startImport: [{ name: 'no-save', body: undefined, status: 400 }],
    // The club wears the installed example pack, a pack that is not there is refused, and it goes back to its own colours
    chooseTheme: [
      { name: 'pack', body: { packId: 'sunset-series' }, status: 200 },
      { name: 'not-installed', body: { packId: 'nothing-here' }, status: 400 },
      { name: 'club-colors', body: { packId: 'club-colors' }, status: 200 },
    ],
    // No earlier save's history is on offer in the synthetic folder, so an answer is refused in words (D-064)
    answerRatingHistoryOffer: [
      { name: 'nothing-to-answer', body: { offerId: 'save-none', choice: 'adopt' }, status: 400 },
      { name: 'no-choice', body: { offerId: 'save-none' }, status: 400 },
    ],
    // The pretend save was never saved by OOTP, so nothing stands out and nothing is chosen (D-063)
    setUpAutomatically: [{ name: 'nothing-stands-out', body: {}, status: 200 }],
    // N11: a staff note put back as it was filed (the undo of a removal); the changes below remove it again
    restoreStaffNote: [
      { name: 'restored', body: { source: 'Bench coach', body: 'Keep him off back-to-back day games for two weeks.', gameDate: '2040-5-3' }, status: 200 },
      { name: 'no-body', body: { source: 'Bench coach' }, status: 400 },
    ],
  };

  it('answers every POST in the contract\'s shape, for each answer it is safe to cause here', async () => {
    const posts = operations.filter((op) => op.method === 'post');
    expect(posts.map((op) => op.operationId).sort()).toEqual(Object.keys(POSTS).sort());
    const previous = loadConfig();
    try {
    for (const op of posts) {
      for (const c of POSTS[op.operationId]) {
        const body = c.body === undefined ? undefined : JSON.parse(JSON.stringify(c.body).split('$HOME').join(home));
        const url = op.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => SAMPLE_PARAMS[name]());
        const res = await fetch(`${base}${url}`, {
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
        if (op.operationId === 'saveSettings' && c.name === 'automatic') expect(answer.settings.defaultOrgId).toBeNull();
        if (op.operationId === 'setSave' && c.name === 'no-export') expect(answer).toMatchObject({ importStarted: false, club: null });
        if (op.operationId === 'setSave' && c.name === 'club-from-save') expect(answer.club).toMatchObject({ decided: false, teamId: null, humanClubs: null });
        // Choosing a save is put back at once, so the answers after it read the unconfigured server
        if (op.operationId === 'setSave') saveConfig(previous);
      }
    }
    } finally {
      saveConfig(previous);
    }
  }, SLOW);

  /**
   * The PUTs and the DELETE (N7): the desk's statuses and Following, each answer in the contract's shape and captured for
   * the Mac stage (Stage B draws the desk's statuses, the undo and Following from them). Every change is put back.
   */
  it('answers the desk\'s and Following\'s changes in the contract\'s shape, and puts each back (captured for the previews)', async () => {
    const changes = operations.filter((op) => op.method === 'put' || op.method === 'delete').map((op) => op.operationId).sort();
    expect(changes).toEqual(['follow', 'removeStaffNote', 'setDeskStatus', 'setPlayerNote', 'undoFirstPlayerNote', 'unfollow']);
    const call = async (method: 'PUT' | 'DELETE', url: string, body?: unknown) => {
      const res = await fetch(`${base}${url}`, {
        method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    const check = (operationId: string, name: string, answer: { status: number; body: unknown }, status: number) => {
      const op = operations.find((o) => o.operationId === operationId)!;
      expect(answer.status, `${operationId} ${name}`).toBe(status);
      const type = status === 200 ? op.response : op.errors?.[status];
      expect(type, `${operationId} documents ${status}`).toBeDefined();
      const validate = validator(type!);
      expect(validate(answer.body) ? [] : validate.errors, `${operationId} ${name} against ${type}`).toEqual([]);
      if (status === 200) {
        expect(bannedInPayload(answer.body, operationId)).toEqual([]);
        expect(servedBasisProblems(answer.body)).toEqual([]);
      }
      fixture(`responses/${operationId}-${name}.json`, json(answer.body));
    };
    const desk = (await (await fetch(`${base}/api/v2/desk/${save.org}`)).json()) as { desk: { items: Array<{ key: string }> } };
    const key = desk.desk.items[0]?.key;
    expect(key, 'the synthetic save has an item on the desk').toBeTruthy();
    const reviewed = await call('PUT', `/api/v2/desk/${save.org}`, { key, status: 'reviewed', note: 'Talked it over with the manager' });
    check('setDeskStatus', 'reviewed', reviewed, 200);
    check('setDeskStatus', 'undo', await call('PUT', `/api/v2/desk/${save.org}`, (reviewed.body as { undo: unknown }).undo), 200);
    check('setDeskStatus', 'deferred-to-a-day-gone', await call('PUT', `/api/v2/desk/${save.org}`, { key, status: 'deferred', until: '2000-1-1' }), 400);
    check('setDeskStatus', 'no-status', await call('PUT', `/api/v2/desk/${save.org}`, { key }), 400);
    check('setDeskStatus', 'not-in-this-export', await call('PUT', `/api/v2/desk/${save.org}`, { key: 'majorLeague:nothing:here', status: 'reviewed' }), 404);
    // An item whose deferral has ended (H1): a change on it serves the way back with the day passed, and a note keeps it
    await setDeskRecord(save.org, key!, { status: 'deferred', until: '2040-1-1' }, null);
    check('setDeskStatus', 'note-on-a-deferral-ended', await call('PUT', `/api/v2/desk/${save.org}`, { key, status: 'deferred', note: 'Ask again after the break' }), 200);
    check('setDeskStatus', 'on-a-deferral-ended', await call('PUT', `/api/v2/desk/${save.org}`, { key, status: 'reviewed' }), 200);
    await call('PUT', `/api/v2/desk/${save.org}`, { key, status: 'open', note: '' });

    const club = save.clubs[1];
    check('follow', 'club', await call('PUT', '/api/v2/following', { kind: 'club', id: club, note: 'Division rival' }), 200);
    check('follow', 'player', await call('PUT', '/api/v2/following', { kind: 'player', id: save.regular }), 200);
    check('follow', 'not-in-this-save', await call('PUT', '/api/v2/following', { kind: 'club', id: 99_999 }), 404);
    check('follow', 'no-kind', await call('PUT', '/api/v2/following', { id: club }), 400);
    check('unfollow', 'club', await call('DELETE', `/api/v2/following?kind=club&id=${club}`), 200);
    check('unfollow', 'not-followed', await call('DELETE', `/api/v2/following?kind=club&id=${club}`), 404);
    check('unfollow', 'no-kind', await call('DELETE', `/api/v2/following?id=${club}`), 400);
    // Put back: nothing followed, nothing marked
    expect((await call('DELETE', `/api/v2/following?kind=player&id=${save.regular}`)).status).toBe(200);
    // N11: the GM's note on a player he doesn't follow, kept exactly as typed, and its undo (which stops following him)
    const typed = '  Hits left-handers hard.\n\n  Watch his back on day games.  ';
    const first = await call('PUT', `/api/v2/player/${save.reliever}/notes`, { note: typed });
    check('setPlayerNote', 'first-note', first, 200);
    expect((first.body as { notes: { note: string; following: boolean } }).notes).toMatchObject({ note: typed, following: true });
    expect((first.body as { undoUnfollows: boolean }).undoUnfollows).toBe(true);
    check('setPlayerNote', 'changed', await call('PUT', `/api/v2/player/${save.reliever}/notes`, { note: 'Ready for the late innings.' }), 200);
    check('setPlayerNote', 'not-text', await call('PUT', `/api/v2/player/${save.reliever}/notes`, { note: 5 }), 400);
    check('setPlayerNote', 'not-in-this-save', await call('PUT', '/api/v2/player/99999999/notes', { note: 'Nobody' }), 404);
    check('undoFirstPlayerNote', 'unfollows', await call('DELETE', `/api/v2/player/${save.reliever}/notes`), 200);
    // A staff note (put there by the POST above) removed, then gone
    const notes = (await (await fetch(`${base}/api/v2/player/${save.regular}/notes`)).json()) as { staff: Array<{ id: number }> };
    expect(notes.staff.length, 'the staff note the POST put back is there').toBeGreaterThan(0);
    check('removeStaffNote', 'removed', await call('DELETE', `/api/v2/player/${save.regular}/staff-notes/${notes.staff[0].id}`), 200);
    check('removeStaffNote', 'gone', await call('DELETE', `/api/v2/player/${save.regular}/staff-notes/${notes.staff[0].id}`), 404);
  }, SLOW);

  /**
   * The Morning Report once an earlier export of the save is remembered (N7): "since the last export" with an item new and
   * one resolved and the games between, an item set aside on the desk, and a followed club first on the wire. Captured
   * for Stage B, which draws the chips, the set-aside line and the column from it.
   */
  it('serves "since the last export", a set-aside item and a followed club on the Morning Report (captured for the previews)', async () => {
    const built = await frontOfficeBuilt(save.org);
    const items = [...built.reports.values()].filter((r) => r.department !== 'frontOffice').flatMap((r) => [...r.toDecide.items, ...r.watching.items]);
    const [newNow, ...kept] = items;
    const earlier = '2040-04-30T12:00:00.000Z';
    await recordReportSnapshot({
      orgId: save.org, importStamp: earlier, gameDate: '2040-5-3',
      departments: { majorLeague: 'ready', farm: 'ready', finance: 'ready', medical: 'ready' },
      items: [...kept.map((it) => ({ key: it.key, department: it.department, severity: it.neutralSeverity, headline: it.headline.text, count: it.count })),
        { key: 'medical:injury:9999', department: 'medical', severity: 'noted', headline: 'P 9999 is on the injured list', count: 1 }],
      figures: [],
    });
    // The club's standings three games ago: its record less the last three games' results
    const last3 = built.season!.games!.slice(-3);
    const won = last3.filter((g) => g.scored > g.allowed).length;
    const standings = built.season!.standings.map((r) => (r.teamId === save.org && r.w !== null && r.l !== null ? { ...r, w: r.w - won, l: r.l - (3 - won) } : r));
    await recordStandingsSnapshot(earlier, '2040-5-3', standings);
    const deskKey = (await (await fetch(`${base}/api/v2/desk/${save.org}`)).json()).desk.items.find((it: { key: string }) => it.key !== newNow.key)?.key;
    await fetch(`${base}/api/v2/desk/${save.org}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: deskKey, status: 'reviewed' }) });
    await fetch(`${base}/api/v2/following`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'club', id: save.clubs[2] }) });
    try {
      const res = await fetch(`${base}/api/v2/front-office/${save.org}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const validate = validator('FrontOfficeSummary');
      expect(validate(body) ? [] : validate.errors).toEqual([]);
      expect(bannedInPayload(body, 'getFrontOffice')).toEqual([]);
      expect(servedBasisProblems(body)).toEqual([]);
      expect(body.changes.new.items.map((i: { key: string }) => i.key)).toEqual([newNow.key]);
      expect(body.changes.resolved.items.map((i: { key: string }) => i.key)).toEqual(['medical:injury:9999']);
      expect(body.changes.results.count).toBe(3);
      expect(body.desk.setAside.reviewed).toBe(1);
      expect(body.wire.entries[0].followed).toBe(true);
      fixture('responses/getFrontOffice-since-last-export.json', json(body));
      const farm = await (await fetch(`${base}/api/v2/departments/${save.org}/${newNow.department}`)).json();
      expect(validator('DepartmentReport')(farm)).toBe(true);
      fixture('responses/getDepartmentReport-since-last-export.json', json(farm));
    } finally {
      for (const t of ['report_snapshot_imports', 'report_snapshots', 'report_snapshot_figures', 'standings_snapshots', 'desk_items', 'following']) historyDb.exec(`DELETE FROM ${t}`);
      forgetMemoryCaches();
    }
  }, SLOW);

  it('asks about a save that moved, carries its history over and undoes it, in the contract\'s shape (captured for the previews)', async () => {
    // A history bound to a folder that has gone (the pretend OOTP folder is there, the save in it is not), with this
    // league's players: the question the Mac app asks, then its two answers
    const key = currentHistoryKey();
    takeSnapshot();
    const [latest] = (historyDb.prepare(`SELECT DISTINCT game_date FROM save_rating_snapshots WHERE save_key = ?`).all(key) as Array<{ game_date: string }>).map((r) => r.game_date);
    const gone = path.join(home, 'Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Old League.lg');
    const source = 'save-fixture-old-league';
    const cols = SNAPSHOT_DATA_COLUMNS.filter((c) => c !== 'game_date').join(', ');
    try {
      historyDb.prepare(
        `INSERT INTO history_saves (save_key, folder_id, folder_path, save_name, bound, origin, replaces, created_at, last_seen_at)
         VALUES (?, 'fixture', ?, 'Old League', 1, 'new', NULL, '2040-01-01T00:00:00.000Z', '2040-01-01T00:00:00.000Z')`
      ).run(source, gone);
      for (const date of ['2040-4-1', latest]) {
        historyDb.prepare(`INSERT INTO save_rating_snapshots (save_key, game_date, ${cols}) SELECT ?, ?, ${cols} FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?`)
          .run(source, date, key, latest);
      }
      const steps: Array<[string, string, unknown, string]> = [
        ['getRatingHistory-offer', '/api/v2/rating-history', undefined, 'RatingHistoryView'],
        ['answerRatingHistoryOffer-adopt', '/api/v2/rating-history/choice', { offerId: `${key}:${source}`, choice: 'adopt' }, 'RatingHistoryView'],
        ['answerRatingHistoryOffer-undo', '/api/v2/rating-history/choice', { offerId: `${key}:carry:1`, choice: 'undo' }, 'RatingHistoryView'],
      ];
      for (const [name, route, body, type] of steps) {
        const revision = frontOfficeRevision();
        const res = await fetch(`${base}${route}`, body === undefined ? undefined : {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        expect(res.status, name).toBe(200);
        // A carry-over and its undo change what the reports read, so the Front Office is built again (N6 Stage B2); a
        // question read changes nothing
        if (body === undefined) expect(frontOfficeRevision(), name).toBe(revision);
        else expect(frontOfficeRevision(), name).toBeGreaterThan(revision);
        const answer = await res.json();
        const validate = validator(type);
        expect(validate(answer) ? [] : validate.errors, name).toEqual([]);
        expect(bannedInPayload(answer, name.split('-')[0])).toEqual([]);
        // The save is placed by the place the GM knows, never a folder's path (M1): the questions, the list, the carry-overs
        const placed = [...shownStrings(answer).map((s) => s.text), ...answer.offers.map((o: { place: string }) => o.place),
          ...answer.candidates.map((c: { place: string }) => c.place), ...answer.carriedOver.map((c: { undoQuestion: string }) => c.undoQuestion)];
        for (const text of placed) expect(bannedIn(text, [FOLDER_PATHS]), `${name}: ${text}`).toEqual([]);
        expect(servedBasisProblems(answer)).toEqual([]);
        if (name.endsWith('offer')) expect(answer.offers).toHaveLength(1);
        if (name.endsWith('offer')) expect(answer.offers[0]).toMatchObject({ adoptText: 'Carry It Over', freshText: 'Keep Them Apart' });
        if (name.endsWith('adopt')) expect(answer.carriedOver).toHaveLength(1);
        if (name.endsWith('adopt')) expect(answer.carriedOver[0].undoQuestion).toMatch(/^Undo the carry-over from "Old League"\? The \d+ player ratings it copied are removed/);
        if (name.endsWith('undo')) expect(answer.carriedOver).toEqual([]);
        fixture(`responses/${name}.json`, json(answer));
      }
    } finally {
      for (const table of ['history_carry_overs', 'history_carried_rows', 'history_offer_choices', 'history_dual_writes']) historyDb.exec(`DELETE FROM ${table}`);
      historyDb.prepare(`DELETE FROM save_rating_snapshots WHERE save_key IN (?, ?)`).run(key, source);
      historyDb.prepare(`DELETE FROM save_rating_snapshot_modes WHERE save_key IN (?, ?)`).run(key, source);
      historyDb.prepare(`DELETE FROM rating_snapshots WHERE game_date = ?`).run(latest);
      historyDb.prepare(`DELETE FROM history_saves WHERE save_key = ?`).run(source);
      forgetHistoryKey();
    }
  }, SLOW);

  /** The pretend save's export folder (in `home`). */
  const pretendExport = () => path.join(home, 'Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Test League.lg/import_export/csv');

  it('refuses a second import with a 409 in the contract\'s shape while one runs', async () => {
    const previous = loadConfig();
    saveConfig({ csvDir: pretendExport(), saveName: 'Test League' });
    importState.importing = true;
    try {
      const cases: Array<[string, string, unknown]> = [
        ['setSave', '/api/config', { csvDir: pretendExport(), saveName: 'Test League' }],
        ['startImport', '/api/import', undefined],
      ];
      for (const [operationId, route, body] of cases) {
        const op = operations.find((o) => o.operationId === operationId)!;
        expect(op.errors?.[409], `${operationId} documents 409`).toBe('ApiError');
        const res = await fetch(`${base}${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        expect(res.status, operationId).toBe(409);
        const answer = await res.json();
        const validate = validator('ApiError');
        expect(validate(answer) ? [] : validate.errors).toEqual([]);
        fixture(`responses/${operationId}-import-running.json`, json(answer));
      }
    } finally {
      importState.importing = false;
      saveConfig(previous);
    }
  }, SLOW);

  it('serves the status and the data status of a chosen save in the contract\'s shape', async () => {
    // Chosen without importing (the import's answers are checked above), so the previews show a consistent pair
    const previous = loadConfig();
    saveConfig({ csvDir: pretendExport(), saveName: 'Test League' });
    try {
      for (const [operationId, route, type] of [
        ['getStatus', '/api/status', 'ServerStatus'], ['getDataStatus', '/api/data-status', 'DataStatus'],
        ['getDataStatusWords', '/api/v2/data-status', 'DataStatusView'],
      ]) {
        const res = await fetch(`${base}${route}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        if (operationId === 'getDataStatusWords') {
          expect(bannedInPayload(body, operationId)).toEqual([]);
          // The export's time is the pretend folder's, written in the host's zone: the fixture keeps a fixed one
          for (const row of body.facts) if (row.id === 'exported' && row.sort.value) row.cells.value.display = 'Jul 1, 2040, 12:00 PM';
        } else {
          expect(body.configured, operationId).toBe(true);
        }
        const validate = validator(type);
        expect(validate(body) ? [] : validate.errors, operationId).toEqual([]);
        // The logo cache's token changes with the export folder's time; the fixture keeps a fixed one
        if (typeof body.logoToken === 'string' && body.logoToken !== 'none') body.logoToken = 'token';
        fixture(`responses/${operationId}-configured.json`, json(body));
      }
    } finally {
      saveConfig(previous);
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

  it('announces a save played since the chosen one on the event stream, in the strict form (N6, Stage B1)', () => {
    const previous = loadConfig();
    const pretend = new PretendHome();
    const clock = { ...discoveryClock };
    const heard: ServerEvent[] = [];
    const unsubscribe = subscribe((event) => { if (event.type === 'save-played-elsewhere') heard.push(event); });
    try {
      const chosen = pretend.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 10 });
      pretend.save(APP_STORE_27, 'Played Since', { playedHoursAgo: 1 });
      saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
      discoveryClock.saves = () => detectSaves(pretend.dir);
      resetSaveDiscovery();
      const notice = scanSaves();
      expect(notice?.save.name).toBe('Played Since');
      expect(heard).toHaveLength(1);
      expect(heard[0]).toEqual({ type: 'save-played-elsewhere', savePlayedElsewhere: notice });
      const validate = validator('ServerEvent');
      expect(validate(heard[0]) ? [] : validate.errors).toEqual([]);
      expect(bannedInPayload(heard[0])).toEqual([]);
      // The status serves the chosen save's id, in the save list's form (D-063)
      fixture('events-save-played-elsewhere.sse', `event: save-played-elsewhere\ndata: ${JSON.stringify(stable(heard[0]))}\n\n`);
    } finally {
      unsubscribe();
      Object.assign(discoveryClock, clock);
      resetSaveDiscovery();
      saveConfig(previous);
      pretend.cleanup();
    }
  });

  it('holds the server to the strict form: an undescribed field or an unlisted code fails', () => {
    const status = validator('ImportProgress');
    const good = {
      table: 'players', fileIndex: 1, files: 2, rows: 3, phase: 'writing',
      words: { phase: 'Writing the league', table: 'Players', display: 'Writing players · 1 of 2' },
    };
    expect(status(good)).toBe(true);
    expect(status({ ...good, extra: 1 })).toBe(false);
    expect(status({ ...good, phase: 'guessing' })).toBe(false);
  });
});

describe('the committed fixtures of finding the save (N3.5 B2, which the Mac stage decodes)', () => {
  // One validator for every case: building the strict spec and compiling a type took over five seconds on CI per case
  let validator: (type: string) => ValidateFunction;
  beforeAll(() => {
    validator = strictValidator();
  }, SLOW);

  it.each([
    ['getSaveDiscovery.json', 'SaveDiscovery'],
    ['setUpAutomatically-nothing-stands-out.json', 'AutomaticSetup'],
    ['listSaves.json', 'SaveList'],
    ['getStatus.json', 'ServerStatus'],
  ])('%s is there and holds a %s in the strict form', (file, type) => {
    const at = path.join(FIXTURES, 'responses', file);
    expect(fs.existsSync(at), `${file} is missing: run npm run contract:fixtures`).toBe(true);
    const validate = validator(type);
    const body = JSON.parse(fs.readFileSync(at, 'utf8'));
    expect(validate(body) ? [] : validate.errors).toEqual([]);
  }, SLOW);

  // The farm's preview fixtures (N10), written by farmViews.test.ts from the views' own functions: each one the Mac app
  // decodes is held to the strict form too, and every one in the folder is listed here
  const FARM_FIXTURES: Array<[string, string]> = [
    ['decision-cascade.json', 'FarmDecisionView'],
    ['development-detail.json', 'FarmDevelopmentDetail'],
    ['development-detail-switched.json', 'FarmDevelopmentDetail'],
    ['development-tracked.json', 'FarmDevelopmentView'],
    ['organization-set-aside.json', 'FarmOrganizationView'],
    ['prospects-meetings.json', 'FarmProspectsView'],
  ];

  it('lists every farm preview fixture in the folder', () => {
    expect(fs.readdirSync(path.join(FIXTURES, 'farm')).filter((f) => f.endsWith('.json')).sort()).toEqual(FARM_FIXTURES.map(([f]) => f).sort());
  });

  it.each(FARM_FIXTURES)('farm/%s is there and holds a %s in the strict form (N10)', (file, type) => {
    const at = path.join(FIXTURES, 'farm', file);
    expect(fs.existsSync(at), `${file} is missing: run npm run contract:fixtures`).toBe(true);
    const validate = validator(type);
    const body = JSON.parse(fs.readFileSync(at, 'utf8'));
    expect(validate(body) ? [] : validate.errors).toEqual([]);
  }, SLOW);

  it('events-save-played-elsewhere.sse is there and holds a ServerEvent in the strict form (N6, Stage B1)', () => {
    const at = path.join(FIXTURES, 'events-save-played-elsewhere.sse');
    expect(fs.existsSync(at), 'events-save-played-elsewhere.sse is missing: run npm run contract:fixtures').toBe(true);
    const data = /^data: (.*)$/m.exec(fs.readFileSync(at, 'utf8'))?.[1] ?? '';
    const event = JSON.parse(data);
    expect(event.type).toBe('save-played-elsewhere');
    expect(event.savePlayedElsewhere?.kind).toBe('otherSave');
    const validate = validator('ServerEvent');
    expect(validate(event) ? [] : validate.errors).toEqual([]);
  }, SLOW);
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

  it('holds a claim\'s basis to the verdicts and the rendering leaks, not the jargon list (it is the breakdown)', () => {
    const payload = { claim: { text: 'Power', basis: { because: [{ label: 'Percentile', value: 'null' }], unknown: ['He should be moved.'], wouldChange: [], lean: null, stamp: 'provisional' } } };
    const found = bannedInPayload(payload).map((f) => f.path);
    expect(found).toEqual(['$.claim.basis.because[0].value', '$.claim.basis.unknown[0]']);
  });
});

describe('scoped jargon exceptions (review S5)', () => {
  const fortyMan = { surface: { department: 'majorLeague', view: 'fortyManOptions' } };
  const lineup = { surface: { department: 'majorLeague', view: 'lineup' } };
  const farmFortyMan = { surface: { department: 'farm', view: 'fortyManOptions' } };
  const exceptions: JargonException[] = [
    { department: 'majorLeague', view: 'fortyManOptions', phrase: 'Rule 5 draft percentile', ignoreCase: false, reason: 'A made-up phrase for the test.' },
    { department: 'catalog', view: 'glossary', field: 'display', phrase: 'Win Pct', ignoreCase: false, reason: 'The standings column.' },
    { department: 'majorLeague', view: 'fortyManOptions', phrase: 'waiver priority', ignoreCase: true, reason: 'Tries to exempt a verdict.' },
  ];

  it('allows the phrase on its department\'s view and nowhere else, and still checks the rest of the string', () => {
    const text = 'Rule 5 draft percentile: third';
    expect(bannedIn(text, [BANNED_JARGON], fortyMan, exceptions)).toEqual([]);
    // Another view of the same department, the same view of another department, and no place at all: not allowed
    for (const at of [lineup, farmFortyMan, undefined]) expect(bannedIn(text, [BANNED_JARGON], at, exceptions).map(String)).toEqual([String(/percentile/i)]);
    // The rest of the same string is still read
    expect(bannedIn(`${text}, a talent`, [BANNED_JARGON], fortyMan, exceptions).map(String)).toEqual([String(/(?<!pays for )\btalent\b/i)]);
  });

  it('never exempts a verdict word, whatever the exception says', () => {
    expect(bannedIn('Third in waiver priority', [BANNED_JARGON, BANNED_VERDICTS], fortyMan, exceptions).map(String)).toEqual([String(/\bpriority\b/i)]);
  });

  it('matches the case it states: an exact-case exception does not allow another spelling', () => {
    expect(bannedIn('Win Pct', [BANNED_JARGON], { surface: { department: 'catalog', view: 'glossary' }, field: 'display' }, exceptions)).toEqual([]);
    expect(bannedIn('win pct', [BANNED_JARGON], { surface: { department: 'catalog', view: 'glossary' }, field: 'display' }, exceptions)).toHaveLength(1);
  });

  it('holds to its field when it names one, read from a payload\'s own paths', () => {
    const payload = { glossary: [{ display: 'Win Pct', text: 'Win Pct is wins over games.' }], stats: [{ display: 'Win Pct' }] };
    expect(bannedInPayload(payload, 'getCatalog', exceptions).map((f) => f.path)).toEqual(['$.glossary[0].text', '$.stats[0].display']);
    // An operation with no surface gets no exception
    expect(bannedInPayload(payload, 'getSomethingElse', exceptions)).toHaveLength(3);
    expect(exceptionsUsed(payload, 'getCatalog', exceptions)).toEqual([exceptions[1]]);
  });

  it('gives every exception in force a department, a view, a phrase, its case and a one-line reason', () => {
    for (const e of JARGON_EXCEPTIONS) {
      expect(e.department).toMatch(/^[A-Za-z]+$/);
      expect(e.view).toMatch(/^[A-Za-z]+$/);
      expect(typeof e.ignoreCase).toBe('boolean');
      expect(e.phrase.trim()).toBe(e.phrase);
      expect(e.phrase.length).toBeGreaterThan(1);
      expect(e.reason).not.toMatch(/\n/);
      expect(e.reason.length).toBeGreaterThan(10);
      expect(e.reason.length).toBeLessThanOrEqual(140);
      // An exception may not name a verdict: it would be read on the whole string anyway, so it would be dead
      expect(bannedIn(e.phrase, [BANNED_VERDICTS]), e.phrase).toEqual([]);
    }
  });
});

