import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { insideFolder, sameOrigin, serverOnce, withServerToken } from '../electron/shellGuards.js';

/**
 * The Electron shell's guards, without launching Electron (B-74; D-081). Retired with the Electron build at the cutover.
 */

const statusOf = (port: number): Promise<number> => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/api/status', headers: { host: 'localhost' } }, (res) => {
    res.resume();
    resolve(res.statusCode ?? 0);
  }).on('error', reject);
});

describe('the embedded server starts once (SRVHEALTH-06)', () => {
  afterAll(async () => {
    const { shutdownServer } = await import('../server/index.js');
    await shutdownServer();
  });

  it('a window reopened from the Dock loads the running server instead of starting a second', async () => {
    process.env.OOTP_FO_EMBEDDED = '1';
    const { startServer } = await import('../server/index.js');
    const { DataFolderLocked } = await import('../server/dataLock.js');
    let starts = 0;
    // What `main.ts` runs at `whenReady`: the start with its port fallback, once
    const embedded = serverOnce(async () => {
      starts += 1;
      try {
        return await startServer(0);
      } catch (err) {
        if (err instanceof DataFolderLocked) throw err;
        return await startServer(0);
      }
    });
    const first = await embedded();
    // `activate`: the window was closed and is created again
    const second = await embedded();
    expect(starts).toBe(1);
    expect(second).toBe(first);
    expect(await statusOf(first)).toBe(200);
  });

  it('every caller waits on the same start', async () => {
    let starts = 0;
    const once = serverOnce(async () => {
      starts += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'http://127.0.0.1:1';
    });
    expect(await Promise.all([once(), once(), once()])).toEqual(['http://127.0.0.1:1', 'http://127.0.0.1:1', 'http://127.0.0.1:1']);
    expect(starts).toBe(1);
  });
});

describe("the window's token and origin (SRVINFRA-07, SRVHEALTH-16)", () => {
  const server = 'http://127.0.0.1:5000';

  it("adds the token only to the server's own /api", () => {
    expect(withServerToken(`${server}/api/status`, { Accept: '*/*' }, server, 't')).toEqual({ Accept: '*/*', Authorization: 'Bearer t' });
    // A page's own Authorization is replaced, never kept beside it
    expect(withServerToken(`${server}/api/x`, { authorization: 'Bearer forged' }, server, 't')).toEqual({ Authorization: 'Bearer t' });
    for (const url of [`${server}/index.html`, 'http://127.0.0.1:5001/api/status', 'http://localhost:5000/api/status', 'https://evil.example/api/status']) {
      expect(withServerToken(url, { Accept: '*/*' }, server, 't')).toEqual({ Accept: '*/*' });
    }
    expect(withServerToken(`${server}/api/status`, {}, null, 't')).toEqual({});
  });

  it("accepts only the server's exact origin", () => {
    expect(sameOrigin(`${server}/some/page`, server)).toBe(true);
    expect(sameOrigin('http://127.0.0.1:5001/', server)).toBe(false);
    expect(sameOrigin('http://localhost:5000/', server)).toBe(false);
    expect(sameOrigin('not a url', server)).toBe(false);
    expect(sameOrigin(undefined, server)).toBe(false);
    expect(sameOrigin(`${server}/`, null)).toBe(false);
  });

  it('reveals only what is really inside the data folder, links resolved', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-shell-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-outside-'));
    try {
      fs.mkdirSync(path.join(root, 'exports'));
      fs.symlinkSync(outside, path.join(root, 'link'));
      expect(insideFolder(root, path.join(root, 'exports'))).toBe(fs.realpathSync(path.join(root, 'exports')));
      expect(insideFolder(root, root)).toBe(fs.realpathSync(root));
      expect(insideFolder(root, path.join(root, 'link'))).toBeNull();
      expect(insideFolder(root, path.join(root, '..'))).toBeNull();
      expect(insideFolder(root, path.join(root, 'missing'))).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
