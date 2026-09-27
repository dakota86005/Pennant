/**
 * The import and route benchmark (N3.5): drives a bundled sidecar (`npm run build:sidecar`) on a SCRATCH data folder
 * and prints JSON. Grown from the N3.5 Stage A investigation's driver, so a milestone's numbers compare with its.
 *
 *   node scripts/bench-import.mjs --server build/sidecar/server.cjs --data <scratch data folder> --csv <export folder> --out <file.json>
 *
 * It measures: ready time; the import (the server's own start-to-finish time), `/api/status` latency polled every
 * 100 ms while it runs, CPU and peak memory (RSS) sampled every 500 ms; how long the refits take to settle; then each
 * route cold (the first request) and warm (the median of five more), and the MLB need responses.
 *
 * Rules (AGENTS.md, SWIFTUI_REBUILD.md "N3.5"): the data folder must be a scratch folder, never the real one or `data/`.
 * The export is only read (the importer never writes it). Delete the scratch folder when done: keep numbers, not data.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const server = path.resolve(arg('server') ?? 'build/sidecar/server.cjs');
const dataDir = arg('data');
const csvDir = arg('csv');
const outFile = arg('out');
if (!dataDir || !csvDir || !outFile) {
  console.error('Usage: node scripts/bench-import.mjs --server build/sidecar/server.cjs --data <scratch folder> --csv <export folder> --out <file.json>');
  process.exit(1);
}
if (fs.existsSync(path.join(dataDir, 'league.db'))) {
  console.error(`${dataDir} already holds a league: give the benchmark an empty scratch folder`);
  process.exit(1);
}
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ csvDir, saveName: path.basename(path.dirname(path.dirname(csvDir))).replace(/\.lg$/, '') }));
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ autoGenerateAfterImport: false, autoImport: true }));

const token = crypto.randomBytes(32).toString('hex');
const env = { ...process.env, OOTP_FO_DATA_DIR: dataDir };
for (const k of Object.keys(env)) if (/API_KEY|ANTHROPIC|OPENAI|GEMINI/i.test(k)) delete env[k];
const t0 = performance.now();
const child = spawn(process.execPath, [server], { env, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.write(`${JSON.stringify({ token, keys: {} })}\n`);
const log = [];
let port = null;
let readyMs = null;
const onLine = (line) => {
  log.push([Math.round(performance.now() - t0), line]);
  if (line.startsWith('PENNANT_READY ')) {
    port = JSON.parse(line.slice(14)).port;
    readyMs = Math.round(performance.now() - t0);
  }
};
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    onLine(buf.slice(0, i));
    buf = buf.slice(i + 1);
  }
});
child.stderr.on('data', (d) => { for (const l of String(d).split('\n')) if (l) log.push([Math.round(performance.now() - t0), `ERR ${l}`]); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
while (!port) {
  await sleep(5);
  if (performance.now() - t0 > 60_000) throw new Error('the server never said it was ready');
}
const base = `http://127.0.0.1:${port}/api`;
/** One request, timed; a connection the server dropped (an old build's long block) is retried and counted. */
let resets = 0;
const get = async (p) => {
  const s = performance.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
      const body = await r.text();
      return { ms: performance.now() - s, status: r.status, bytes: body.length, body };
    } catch (err) {
      resets += 1;
      if (attempt >= 3) throw err;
    }
  }
};

const samples = [];
const cpuSecs = (s) => {
  const m = /(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/.exec(s.trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};
let lastCpu = null;
let lastT = null;
const sampler = setInterval(() => {
  try {
    const out = execFileSync('ps', ['-o', 'time=,rss=', '-p', String(child.pid)]).toString().trim().split(/\s+/);
    const now = performance.now();
    const c = cpuSecs(out[0]);
    const cores = lastCpu === null ? null : (c - lastCpu) / ((now - lastT) / 1000);
    samples.push({ t: Math.round(now - t0), cores: cores === null ? null : Math.round(cores * 100) / 100, rssMB: Math.round(Number(out[1]) / 1024) });
    lastCpu = c;
    lastT = now;
  } catch { /* the process is between states */ }
}, 500);

const result = { server, readyMs };
result.firstStatusMs = Math.round((await get('/status')).ms);

// The import: the start-up imports a folder with no league; poll the status every 100 ms until it has finished
const lat = [];
let st = JSON.parse((await get('/status')).body);
const importFrom = performance.now();
const deadline = performance.now() + 600_000;
while (performance.now() < deadline) {
  const r = await get('/status');
  lat.push(r.ms);
  st = JSON.parse(r.body);
  if (!st.importing && st.lastImport) break;
  await sleep(100);
}
const importTo = performance.now();
result.import = st.lastImport && {
  rows: st.lastImport.rows,
  tables: st.lastImport.tables,
  serverMs: Date.parse(st.lastImport.finishedAt) - Date.parse(st.lastImport.startedAt),
  durationMs: st.lastImport.durationMs ?? null,
  leftOut: st.lastImport.leftOut ?? null,
  ratingMode: st.lastImport.ratingMode?.mode ?? null,
};
result.lastError = st.lastError;
lat.sort((a, b) => a - b);
const q = (list, p) => Math.round(list[Math.min(list.length - 1, Math.floor(p * list.length))]);
result.statusDuringImport = { n: lat.length, p50: q(lat, 0.5), p95: q(lat, 0.95), p99: q(lat, 0.99), max: Math.round(lat[lat.length - 1]) };
const during = samples.filter((s) => s.t >= importFrom - t0 && s.t <= importTo - t0);
result.importPeakRssMB = Math.max(0, ...during.map((s) => s.rssMB));
result.importCores = during.length ? Math.round((during.reduce((n, s) => n + (s.cores ?? 0), 0) / during.length) * 100) / 100 : null;

// The refits: settled when the server says so (this build) or when both have logged (an earlier build)
const lat2 = [];
const refitFrom = performance.now();
const settled = () => log.some(([, l]) => /\[refit\] the refits settled/.test(l))
  || (log.some(([, l]) => /\[value\]/.test(l)) && log.some(([, l]) => /\[calibration\]/.test(l)));
while (performance.now() - refitFrom < 480_000 && !settled()) {
  const r = await get('/status');
  lat2.push(r.ms);
  await sleep(250);
}
result.refitsSettledAfterImportMs = Math.round(performance.now() - importTo);
lat2.sort((a, b) => a - b);
result.statusDuringRefits = lat2.length ? { n: lat2.length, p50: q(lat2, 0.5), p95: q(lat2, 0.95), max: Math.round(lat2[lat2.length - 1]) } : null;
await sleep(3000);

// The routes, cold then warm
const orgs = JSON.parse((await get('/orgs')).body);
const human = orgs.find((o) => o.isHuman) ?? orgs[0];
const org = human.teamId ?? human.team_id ?? human.id;
const roster = JSON.parse((await get(`/roster/${org}`)).body);
const firstPlayer = (Array.isArray(roster) ? roster : roster.players ?? roster.roster ?? [])[0];
const pid = firstPlayer?.player_id ?? firstPlayer?.playerId ?? firstPlayer?.id;
const routes = ['/status', '/data-status', '/v2/data-status', `/dashboard/${org}`, `/mlb-operations/${org}`, `/farm-operations/${org}`, `/roster/${org}`,
  `/lineup/${org}`, `/pitching/${org}`, `/roster-crunch/${org}`, `/prospects/${org}`, `/scouted-development/${org}`, `/payroll/${org}`,
  `/contracts/${org}`, `/org-comparison/${org}`, `/club-finances/${org}`, `/free-agents/${org}`, `/draft/${org}`, `/trade/fits/${org}`,
  ...(pid ? [`/player/${pid}`, `/player-value/${pid}`, `/player-state/${pid}`] : [])];
result.routes = [];
for (const r of routes) {
  const cold = await get(r);
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push((await get(r)).ms);
  warm.sort((a, b) => a - b);
  result.routes.push({ route: r.replace(String(org), ':org').replace(String(pid), ':pid'), status: cold.status, coldMs: Math.round(cold.ms), warmMedianMs: Math.round(warm[2]) });
}
try {
  const ov = JSON.parse((await get(`/mlb-operations/${org}`)).body);
  result.needs = [];
  for (const n of (ov.needs ?? []).slice(0, 6)) {
    const a = await get(`/mlb-operations/${org}/responses?need=${encodeURIComponent(n.id)}`);
    const b = await get(`/mlb-operations/${org}/responses?need=${encodeURIComponent(n.id)}`);
    result.needs.push({ status: a.status, firstMs: Math.round(a.ms), againMs: Math.round(b.ms) });
  }
} catch (e) {
  result.needsError = String(e);
}
clearInterval(sampler);
result.connectionResets = resets;
result.dataFolderMB = Math.round(fs.readdirSync(dataDir).reduce((n, f) => {
  const s = fs.statSync(path.join(dataDir, f));
  return s.isFile() ? n + s.size : n;
}, 0) / 1048576);
result.log = log.filter(([, l]) => /\[(import|value|calibration|history|refit|server)\]|ERR|READY/.test(l)).slice(0, 120);
child.kill('SIGTERM');
await sleep(1500);
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ import: result.import, statusDuringImport: result.statusDuringImport, importPeakRssMB: result.importPeakRssMB, refitsSettledAfterImportMs: result.refitsSettledAfterImportMs, resets }, null, 1));
process.exit(0);
