import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ownApiHeaders, requireApiToken, setApiToken } from '../server/apiToken.js';
import { DataFolderLocked, acquireDataLock, lockPathFor, releaseDataLock } from '../server/dataLock.js';
import { eventStream, progressThrottle, publish, listenerCount, PROGRESS_INTERVAL_MS } from '../server/serverEvents.js';
import { apiKeyStatus, getApiKey, saveApiKey, clearApiKey, setInjectedKeys } from '../server/settings.js';
import type { ImportProgress } from '../server/importer.js';

/**
 * The pieces the Mac app's sidecar adds to the server (D-055, SWIFTUI_REBUILD.md section 5.1), in process. The
 * process-level behaviour (the handshake, the ready line, stopping, and a kill in the middle of an import) is in
 * `sidecarProcess.test.ts`.
 */

async function listen(app: express.Express): Promise<{ base: string; close: () => void }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

describe('the per-launch token', () => {
  it('refuses a token too short to be secret', () => {
    expect(() => setApiToken('short')).toThrow(/at least 32/);
  });

  it('answers only a request that carries the token, once one is set', async () => {
    const app = express();
    app.use('/api', requireApiToken);
    app.get('/api/ping', (_req, res) => res.json({ ok: true }));
    const { base, close } = await listen(app);
    try {
      // No token set yet: the Electron build and npm run dev answer as before
      expect((await fetch(`${base}/api/ping`)).status).toBe(200);
      const token = 'k'.repeat(64);
      setApiToken(token);
      expect((await fetch(`${base}/api/ping`)).status).toBe(401);
      expect((await fetch(`${base}/api/ping`, { headers: { authorization: `Bearer ${'k'.repeat(63)}x` } })).status).toBe(401);
      expect((await fetch(`${base}/api/ping`, { headers: { authorization: 'Bearer k' } })).status).toBe(401);
      expect((await fetch(`${base}/api/ping`, { headers: { authorization: token } })).status).toBe(401);
      expect((await fetch(`${base}/api/ping`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
      // The server's own calls (the assistant's tools, the site export) carry it too
      expect(ownApiHeaders()).toEqual({ authorization: `Bearer ${token}` });
    } finally {
      close();
    }
  });
});

describe('the data-folder lock', () => {
  const dirs: string[] = [];
  const scratch = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-lock-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    releaseDataLock();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is taken, taken again by the same process without complaint, and released', () => {
    const dir = scratch();
    acquireDataLock(dir, 'test');
    acquireDataLock(dir, 'test');
    const held = JSON.parse(fs.readFileSync(lockPathFor(dir), 'utf8'));
    expect(held.pid).toBe(process.pid);
    expect(held.app).toBe('test');
    releaseDataLock();
    expect(fs.existsSync(lockPathFor(dir))).toBe(false);
  });

  it('refuses while another running process holds it, and says which', () => {
    const dir = scratch();
    // The parent of this test run is certainly running and certainly not this process
    fs.writeFileSync(lockPathFor(dir), JSON.stringify({ pid: process.ppid, startedAt: '2026-09-25T00:00:00Z', app: 'Pennant (Electron)' }));
    let refusal: unknown;
    try {
      acquireDataLock(dir, 'test');
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(DataFolderLocked);
    expect((refusal as Error).message).toContain('Pennant (Electron)');
    expect((refusal as Error).message).toContain(lockPathFor(dir));
    // Refused means untouched: the holder's lock is still theirs
    expect(JSON.parse(fs.readFileSync(lockPathFor(dir), 'utf8')).pid).toBe(process.ppid);
  });

  it('takes over a lock whose process has gone, or that cannot be read', () => {
    const dir = scratch();
    // The largest pid macOS hands out is 99,998; this one cannot be running
    fs.writeFileSync(lockPathFor(dir), JSON.stringify({ pid: 99_999_999, startedAt: 'then', app: 'crashed' }));
    acquireDataLock(dir, 'test');
    expect(JSON.parse(fs.readFileSync(lockPathFor(dir), 'utf8')).pid).toBe(process.pid);
    releaseDataLock();
    fs.writeFileSync(lockPathFor(dir), '{"pid":');
    acquireDataLock(dir, 'test');
    expect(JSON.parse(fs.readFileSync(lockPathFor(dir), 'utf8')).pid).toBe(process.pid);
  });

  it('never removes a lock another process has since taken', () => {
    const dir = scratch();
    acquireDataLock(dir, 'test');
    fs.writeFileSync(lockPathFor(dir), JSON.stringify({ pid: process.ppid, startedAt: 'now', app: 'other' }));
    releaseDataLock();
    expect(fs.existsSync(lockPathFor(dir))).toBe(true);
  });
});

describe('server events', () => {
  const progress = (fileIndex: number, phase: ImportProgress['phase'], rows = 0): ImportProgress => ({
    table: `t${fileIndex}`, fileIndex, files: 3, rows, phase,
  });

  it('sends import progress at most every interval, but always a new file or phase', () => {
    let clock = 0;
    const sent: ImportProgress[] = [];
    const throttled = progressThrottle((p) => sent.push(p), () => clock);
    throttled(progress(1, 'reading'));
    throttled(progress(1, 'writing', 10));
    clock += 10;
    throttled(progress(1, 'writing', 20)); // too soon, same file and phase
    clock += PROGRESS_INTERVAL_MS;
    throttled(progress(1, 'writing', 30));
    clock += 1;
    throttled(progress(2, 'reading', 30)); // a new file goes at once
    expect(sent.map((p) => `${p.fileIndex}:${p.phase}:${p.rows}`)).toEqual(['1:reading:0', '1:writing:10', '1:writing:30', '2:reading:30']);
  });

  it('opens a stream with the current status, then relays each event, and forgets a closed stream', async () => {
    const app = express();
    app.get('/events', eventStream(() => ({ importing: false, marker: 'snapshot' })));
    const { base, close } = await listen(app);
    const controller = new AbortController();
    try {
      const res = await fetch(`${base}/events`, { signal: controller.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const until = async (needle: string): Promise<void> => {
        while (!text.includes(needle)) {
          const { value, done } = await reader.read();
          if (done) throw new Error(`stream ended before ${needle}`);
          text += decoder.decode(value, { stream: true });
        }
      };
      await until('\n\n');
      expect(text).toMatch(/^event: hello\ndata: \{"type":"hello","status":\{"importing":false,"marker":"snapshot"\}\}\n\n/);
      publish({ type: 'export-pending', since: '2026-09-25T12:00:00.000Z' });
      await until('export-pending');
      await until('\n\n');
      expect(text).toContain('event: export-pending\ndata: {"type":"export-pending","since":"2026-09-25T12:00:00.000Z"}\n\n');
      expect(listenerCount()).toBe(1);
      controller.abort();
      for (let i = 0; i < 50 && listenerCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
      expect(listenerCount()).toBe(0);
    } finally {
      controller.abort();
      close();
    }
  });
});

describe('keys handed over by the Mac app', () => {
  it('serve as the stored keys, are never written to disk, and a saved key stays in memory', () => {
    const credentials = path.join(process.env.OOTP_FO_DATA_DIR!, 'credentials.json');
    const before = fs.existsSync(credentials) ? fs.readFileSync(credentials, 'utf8') : null;
    setInjectedKeys({ anthropic: ' sk-ant-from-keychain-9876 ', notAProvider: 'ignored', openai: 42 });
    expect(getApiKey('anthropic')).toBe('sk-ant-from-keychain-9876');
    expect(getApiKey('openai')).toBeNull();
    const status = apiKeyStatus('anthropic');
    expect(status).toMatchObject({ configured: true, source: 'keychain', hint: '9876', storageLabel: 'your macOS Keychain' });

    saveApiKey('sk-openai-typed-in-settings', 'openai');
    expect(getApiKey('openai')).toBe('sk-openai-typed-in-settings');
    clearApiKey('anthropic');
    expect(getApiKey('anthropic')).toBeNull();
    expect(apiKeyStatus('anthropic').configured).toBe(false);
    // Nothing reached the credentials file
    expect(fs.existsSync(credentials) ? fs.readFileSync(credentials, 'utf8') : null).toBe(before);

    // A later hand-over replaces the whole set
    setInjectedKeys({ gemini: 'gemini-key-from-keychain-0000' });
    expect(getApiKey('openai')).toBeNull();
    expect(getApiKey('gemini')).toBe('gemini-key-from-keychain-0000');
  });
});

describe('the port asked for', () => {
  it('takes 0 as "any free port" and falls back only on a missing or malformed value', async () => {
    process.env.OOTP_FO_EMBEDDED = '1'; // importing the server's entry must not start it
    const { portFromEnv } = await import('../server/index.js');
    expect(portFromEnv('0')).toBe(0);
    expect(portFromEnv(' 5190 ')).toBe(5190);
    expect(portFromEnv(undefined)).toBe(5178);
    expect(portFromEnv('')).toBe(5178);
    expect(portFromEnv('abc')).toBe(5178);
    expect(portFromEnv('-1')).toBe(5178);
    expect(portFromEnv('70000')).toBe(5178);
  });
});

describe('the record of an import that never completed', () => {
  const dataDir = (): string => process.env.OOTP_FO_DATA_DIR!;
  const marker = (): string => path.join(dataDir(), 'import-in-progress.json');
  const configPath = (): string => path.join(dataDir(), 'config.json');

  it('stays when an import fails, goes when one completes, and is reported until then', async () => {
    const { importState, runImport, statusSnapshot } = await import('../server/api.js');
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-empty-export-'));
    await runImport(empty);
    expect(importState.lastError).toMatch(/No \.csv files/);
    expect(fs.existsSync(marker())).toBe(true);

    const tiny = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-tiny-export-'));
    fs.writeFileSync(path.join(tiny, 'zz_tiny.csv'), 'id,note\n1,one\n');
    importState.interruptedSince = '2026-09-25T00:00:00.000Z';
    expect(statusSnapshot().importInterruptedSince).toBe('2026-09-25T00:00:00.000Z');
    await runImport(tiny);
    expect(importState.lastError).toBeNull();
    expect(fs.existsSync(marker())).toBe(false);
    expect(statusSnapshot().importInterruptedSince).toBeNull();
  });

  it('is reported at start-up, and without the export folder nothing is imported or guessed', async () => {
    const { importState, recoverInterruptedImport } = await import('../server/api.js');
    const savedConfig = fs.existsSync(configPath()) ? fs.readFileSync(configPath(), 'utf8') : null;
    try {
      expect(recoverInterruptedImport()).toBe(false); // no marker: nothing to recover
      fs.writeFileSync(marker(), JSON.stringify({ startedAt: '2026-09-25T01:02:03.000Z', csvDir: '/gone' }));
      fs.writeFileSync(configPath(), JSON.stringify({ csvDir: path.join(os.tmpdir(), 'pennant-no-such-export'), saveName: null }));
      importState.interruptedSince = null;
      expect(recoverInterruptedImport()).toBe(false);
      expect(importState.interruptedSince).toBe('2026-09-25T01:02:03.000Z');
      expect(importState.importing).toBe(false);
      expect(fs.existsSync(marker())).toBe(true);
    } finally {
      fs.rmSync(marker(), { force: true });
      if (savedConfig === null) fs.rmSync(configPath(), { force: true });
      else fs.writeFileSync(configPath(), savedConfig);
    }
  });
});
