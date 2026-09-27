/**
 * The launch benchmark (N3.5 Stage B2): the wall-clock budgets a GM feels, measured on a bundled sidecar
 * (`npm run build:sidecar`) over a SCRATCH data folder that already holds an import (make one with
 * `scripts/bench-import.mjs`), and printed as JSON. SWIFTUI_REBUILD.md "N3.5" records the budgets and the numbers.
 *
 *   node scripts/bench-launch.mjs --server build/sidecar/server.cjs --data <scratch folder with an import> [--runs 3] [--out file.json]
 *
 * Each run starts the server afresh and measures:
 * - launch to ready: spawning the process to its `PENNANT_READY` line (budget 0.5 s);
 * - launch to the first Morning Report payload: spawning to the first `GET /api/v2/front-office/automatic` answered
 *   (budget 1.0 s; the server warms it at start, so the request waits on that build at most);
 * - a view switch from the cache: every department's report, asked again once the first answer is in (budget 100 ms;
 *   the server's half of it: the Mac app's own cache is measured by its tests);
 * - the saves (`GET /api/v2/saves`) and the status, for reference.
 *
 * Rules (AGENTS.md, SWIFTUI_REBUILD.md "N3.5"): the data folder must be a scratch folder, never the real one or `data/`.
 * Nothing in it is changed beyond what a launch writes (the lock, the start-up's own records).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const server = path.resolve(arg('server') ?? 'build/sidecar/server.cjs');
const dataDir = arg('data') && path.resolve(arg('data'));
const runs = Number(arg('runs') ?? 3);
const outFile = arg('out');
if (!dataDir) {
  console.error('Usage: node scripts/bench-launch.mjs --server build/sidecar/server.cjs --data <scratch folder with an import> [--runs 3] [--out file.json]');
  process.exit(1);
}
const forbidden = [path.resolve('data'), path.join(os.homedir(), 'Library', 'Application Support')];
if (forbidden.some((f) => dataDir === f || dataDir.startsWith(`${f}${path.sep}`))) {
  console.error(`${dataDir} looks like a real data folder: give the benchmark a scratch copy`);
  process.exit(1);
}
if (!fs.existsSync(path.join(dataDir, 'league.db'))) {
  console.error(`${dataDir} holds no league: import one first (scripts/bench-import.mjs)`);
  process.exit(1);
}

const DEPARTMENTS = ['frontOffice', 'majorLeague', 'farm', 'scouting', 'trades', 'finance', 'medical', 'league', 'philosophy'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null;
};

async function launch() {
  const token = crypto.randomBytes(32).toString('hex');
  const env = { ...process.env, OOTP_FO_DATA_DIR: dataDir };
  for (const k of Object.keys(env)) if (/API_KEY|ANTHROPIC|OPENAI|GEMINI/i.test(k)) delete env[k];
  const t0 = performance.now();
  const child = spawn(process.execPath, [server], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.write(`${JSON.stringify({ token, keys: {} })}\n`);
  let port = null;
  let readyMs = null;
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.startsWith('PENNANT_READY ')) {
        port = JSON.parse(line.slice(14)).port;
        readyMs = performance.now() - t0;
      }
    }
  });
  child.stderr.resume();
  while (!port) {
    await sleep(2);
    if (performance.now() - t0 > 60_000) throw new Error('the server never said it was ready');
  }
  const base = `http://127.0.0.1:${port}/api`;
  const get = async (p) => {
    const s = performance.now();
    const r = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
    await r.arrayBuffer();
    return { ms: performance.now() - s, at: performance.now() - t0, status: r.status };
  };
  const status = await get('/status');
  const report = await get('/v2/front-office/automatic');
  const first = [];
  for (const d of DEPARTMENTS) first.push(await get(`/v2/departments/automatic/${d}`));
  const again = [];
  for (const d of DEPARTMENTS) again.push((await get(`/v2/departments/automatic/${d}`)).ms);
  const reportAgain = await get('/v2/front-office/automatic');
  const saves = await get('/v2/saves');
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  return {
    readyMs: Math.round(readyMs),
    firstStatusMs: Math.round(status.ms),
    launchToMorningReportMs: Math.round(report.at),
    morningReportStatus: report.status,
    morningReportRequestMs: Math.round(report.ms),
    departmentsFirstMedianMs: median(first.map((f) => f.ms)),
    viewSwitchFromCacheMedianMs: median(again),
    viewSwitchFromCacheMaxMs: Math.round(Math.max(...again)),
    morningReportAgainMs: Math.round(reportAgain.ms),
    savesMs: Math.round(saves.ms),
  };
}

const results = [];
for (let i = 0; i < runs; i++) results.push(await launch());
const summary = {
  server,
  runs: results,
  median: Object.fromEntries(Object.keys(results[0]).filter((k) => !k.endsWith('Status')).map((k) => [k, median(results.map((r) => r[k]))])),
  budgets: { readyMs: 500, launchToMorningReportMs: 1000, viewSwitchFromCacheMedianMs: 100 },
};
if (outFile) fs.writeFileSync(outFile, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
