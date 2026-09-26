import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * The Mac app's sidecar as a process (D-055, SWIFTUI_REBUILD.md sections 5.1 and 5.3): the stdin handshake, the
 * ready line, the token, the lock, stopping, and what a kill in the middle of an import leaves behind.
 *
 * Each case starts `server/sidecar.ts` under tsx in a scratch data folder, the way the app's `ServerController`
 * will start the bundled one, so nothing here touches the fixture league the other suites share. The bundled
 * build is checked the same way by hand (DEVELOPMENT.md "The sidecar").
 */

const scratchDirs: string[] = [];
const running = new Set<ChildProcess>();
afterAll(() => {
  for (const child of running) child.kill('SIGKILL');
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

const TOKEN = 'f'.repeat(64);
const auth = { authorization: `Bearer ${TOKEN}` };

interface Sidecar {
  child: ChildProcess;
  port: number;
  base: string;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

interface Started {
  child: ChildProcess;
  /** The first PENNANT_ line, or null when the process exited without one. */
  line: Promise<string | null>;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function start(dataDir: string, handshake: string | null): Started {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/sidecar.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, OOTP_FO_DATA_DIR: dataDir, OOTP_FO_APP_ROOT: process.cwd() },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  running.add(child);
  let out = '';
  let resolveLine: (line: string | null) => void = () => {};
  const line = new Promise<string | null>((resolve) => (resolveLine = resolve));
  const onData = (chunk: Buffer): void => {
    out += chunk.toString();
    const match = /^(PENNANT_(?:READY|FAILED) .*)$/m.exec(out);
    if (match) resolveLine(match[1]);
  };
  child.stdout!.on('data', onData);
  child.stderr!.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => {
      running.delete(child);
      resolveLine(null);
      resolve({ code, signal });
    })
  );
  if (handshake !== null) child.stdin!.write(`${handshake}\n`);
  return { child, line, output: () => out, exited };
}

async function ready(dataDir: string): Promise<Sidecar> {
  const started = start(dataDir, JSON.stringify({ token: TOKEN }));
  const line = await started.line;
  if (!line?.startsWith('PENNANT_READY ')) throw new Error(`no ready line:\n${started.output()}`);
  const { port } = JSON.parse(line.slice('PENNANT_READY '.length)) as { port: number };
  return { ...started, port, base: `http://127.0.0.1:${port}` };
}

/** A request with a chosen Host header, which fetch will not send. */
function statusAsHost(side: Sidecar, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: side.port, path: '/api/status', headers: { ...auth, host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
  });
}

async function status(side: Sidecar): Promise<Record<string, any>> {
  const res = await fetch(`${side.base}/api/status`, { headers: auth });
  return (await res.json()) as Record<string, any>;
}

async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Reads server-sent events until `stop` returns true for one; resolves with that event. */
async function watchEvents(side: Sidecar, stop: (event: Record<string, any>) => boolean): Promise<Record<string, any>> {
  const res = await fetch(`${side.base}/api/v2/events`, { headers: auth });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('the event stream ended');
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = /^data: (.*)$/m.exec(block);
      if (!data) continue;
      const event = JSON.parse(data[1]) as Record<string, any>;
      if (stop(event)) {
        void reader.cancel();
        return event;
      }
    }
  }
}

describe('starting the sidecar', () => {
  it('prints one ready line, answers only with its token and only to loopback names, and stops when stdin closes', async () => {
    const dataDir = scratch('pennant-sidecar-');
    const side = await ready(dataDir);
    expect(fs.existsSync(path.join(dataDir, 'server.lock'))).toBe(true);

    expect((await fetch(`${side.base}/api/status`)).status).toBe(401);
    expect((await fetch(`${side.base}/api/status`, { headers: auth })).status).toBe(200);
    // A page that rebinds its own name to this machine is refused, token or not (DNS rebinding)
    expect(await statusAsHost(side, 'rebound.example')).toBe(403);
    expect(await statusAsHost(side, `localhost:${side.port}`)).toBe(200);

    // The stream opens with the status it would otherwise have to poll for
    const hello = await watchEvents(side, (e) => e.type === 'hello');
    expect(hello.status).toMatchObject({ importing: false, hasData: false, importInterruptedSince: null });

    // A key handed over later replaces the keys, without a restart; it never reaches the data folder
    side.child.stdin!.write(`${JSON.stringify({ keys: { anthropic: 'sk-ant-later-4321' } })}\n`);
    await until('the key', async () => {
      const res = await fetch(`${side.base}/api/settings`, { headers: auth });
      const body = (await res.json()) as { apiKey: { source: string; hint: string } };
      return body.apiKey.source === 'keychain' && body.apiKey.hint === '4321';
    });
    expect(fs.existsSync(path.join(dataDir, 'credentials.json'))).toBe(false);

    side.child.stdin!.end();
    expect(await side.exited).toEqual({ code: 0, signal: null });
    expect(side.output()).toContain('stopping: stdin closed');
    expect(fs.existsSync(path.join(dataDir, 'server.lock'))).toBe(false);
  }, 60_000);

  it('never prints the token', async () => {
    const dataDir = scratch('pennant-sidecar-');
    const side = await ready(dataDir);
    side.child.kill('SIGTERM');
    expect(await side.exited).toEqual({ code: 0, signal: null });
    expect(side.output()).not.toContain(TOKEN);
  }, 60_000);

  it('refuses to start without a usable token', async () => {
    for (const handshake of ['not json', JSON.stringify({ keys: {} }), JSON.stringify({ token: 'short' })]) {
      const started = start(scratch('pennant-sidecar-'), handshake);
      expect(await started.line).toMatch(/^PENNANT_FAILED \{"reason":"handshake"/);
      expect((await started.exited).code).toBe(2);
    }
    // stdin closed before any handshake
    const closed = start(scratch('pennant-sidecar-'), null);
    closed.child.stdin!.end();
    expect(await closed.line).toMatch(/^PENNANT_FAILED \{"reason":"handshake"/);
    expect((await closed.exited).code).toBe(2);
  }, 60_000);

  it('refuses a data folder another copy is using, says which, and leaves it running', async () => {
    const dataDir = scratch('pennant-sidecar-');
    const first = await ready(dataDir);
    const second = start(dataDir, JSON.stringify({ token: TOKEN }));
    const line = await second.line;
    expect(line).toMatch(/^PENNANT_FAILED \{"reason":"locked"/);
    expect(line).toContain('Pennant for Mac');
    expect((await second.exited).code).toBe(3);
    expect((await fetch(`${first.base}/api/status`, { headers: auth })).status).toBe(200);
    first.child.kill('SIGTERM');
    expect(await first.exited).toEqual({ code: 0, signal: null });
  }, 60_000);
});

/**
 * N1's kill-mid-import check (SWIFTUI_REBUILD.md section 5.3). The importer replaces one table per file, so a
 * process killed partway leaves a database that is sound as a file but neither export. What must hold: SQLite's
 * file is intact; the interruption is recorded; the next start says so and imports the export again, after which
 * the database is exactly the new export.
 */
describe('a sidecar killed in the middle of an import', () => {
  const BIG = 400_000;

  function writeExport(dir: string, version: number): void {
    fs.mkdirSync(dir, { recursive: true });
    // `players` exists so the start-up does not import on its own for want of a save
    fs.writeFileSync(path.join(dir, 'a_first.csv'), `id,version\n1,${version}\n2,${version}\n`);
    const rows = Array.from({ length: BIG }, (_, i) => `${i},${version}`).join('\n');
    fs.writeFileSync(path.join(dir, 'b_big.csv'), `id,version\n${rows}\n`);
    fs.writeFileSync(path.join(dir, 'c_last.csv'), `id,version\n1,${version}\n`);
    fs.writeFileSync(path.join(dir, 'players.csv'), `player_id,version\n1,${version}\n`);
  }

  function tables(dataDir: string): Record<string, { rows: number; versions: number[] }> {
    const db = new Database(path.join(dataDir, 'league.db'), { readonly: true });
    try {
      const out: Record<string, { rows: number; versions: number[] }> = {};
      for (const t of ['a_first', 'b_big', 'c_last', 'players']) {
        const rows = (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
        const versions = (db.prepare(`SELECT DISTINCT version FROM "${t}" ORDER BY version`).all() as Array<{ version: number }>).map((r) => r.version);
        out[t] = { rows, versions };
      }
      return out;
    } finally {
      db.close();
    }
  }

  it('leaves a sound database, records the interruption, and the next start imports the export again', async () => {
    const dataDir = scratch('pennant-sidecar-');
    const csvDir = path.join(scratch('pennant-export-'), 'csv');
    writeExport(csvDir, 1);
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ csvDir, saveName: 'Synthetic' }));
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ autoImport: false }));

    // The first export, imported whole: the save as it stood
    let side = await ready(dataDir);
    await until('the first import', async () => {
      const s = await status(side);
      return !s.importing && s.lastImport ? s : null;
    });
    const firstImport = JSON.parse(fs.readFileSync(path.join(dataDir, 'last-import.json'), 'utf8')) as { startedAt: string };
    side.child.kill('SIGTERM');
    await side.exited;
    expect(tables(dataDir).b_big).toEqual({ rows: BIG, versions: [1] });

    // OOTP writes the next export; the import of it is killed while it writes the big table
    writeExport(csvDir, 2);
    side = await ready(dataDir);
    const writingBig = watchEvents(side, (e) => e.type === 'import-progress' && e.progress.table === 'b_big' && e.progress.phase === 'writing');
    await new Promise((r) => setTimeout(r, 100)); // the stream is open before the import starts
    const res = await fetch(`${side.base}/api/import`, { method: 'POST', headers: auth });
    expect(res.status).toBe(200);
    await writingBig;
    side.child.kill('SIGKILL');
    expect((await side.exited).signal).toBe('SIGKILL');

    // The file is sound (SQLite rolled the open transaction back) ...
    const db = new Database(path.join(dataDir, 'league.db'));
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    db.close();
    // ... but it is neither export: the first file is the new one's, the big table is not whole, and the record of
    // the last import still describes the old one. Only the marker says so.
    const mixed = tables(dataDir);
    expect(mixed.a_first.versions).toEqual([2]);
    expect(mixed.b_big.rows).toBeLessThan(BIG);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'last-import.json'), 'utf8')).startedAt).toBe(firstImport.startedAt);
    const marker = JSON.parse(fs.readFileSync(path.join(dataDir, 'import-in-progress.json'), 'utf8')) as { csvDir: string };
    expect(marker.csvDir).toBe(csvDir);
    // The dead process's lock is stale; the next start takes it over

    side = await ready(dataDir);
    const first = await status(side);
    expect(first.importInterruptedSince).toEqual(expect.any(String));
    const done = await until('the repeated import', async () => {
      const s = await status(side);
      return !s.importing && s.lastImport?.startedAt !== firstImport.startedAt ? s : null;
    });
    expect(done.importInterruptedSince).toBeNull();
    expect(done.lastError).toBeNull();
    expect(fs.existsSync(path.join(dataDir, 'import-in-progress.json'))).toBe(false);
    expect(tables(dataDir)).toEqual({
      a_first: { rows: 2, versions: [2] },
      b_big: { rows: BIG, versions: [2] },
      c_last: { rows: 1, versions: [2] },
      players: { rows: 1, versions: [2] },
    });
    side.child.kill('SIGTERM');
    expect(await side.exited).toEqual({ code: 0, signal: null });
  }, 120_000);
});
