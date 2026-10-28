import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer, type ProxyOptions, type ViteDevServer } from 'vite';
import viteConfig from '../vite.config.js';
import { serverApp } from '../server/serverApp.js';
import { OTHER_SITE_REFUSED } from '../server/sameOrigin.js';

/**
 * `npm run dev`: the page is served by Vite and its `/api` calls reach the API through Vite's proxy. The other-site check
 * (`server/sameOrigin.ts`, D-081) compares the browser's `Origin` with the `Host` the API sees, so the proxy must pass the
 * page's Host through. Vite's string shorthand turns `changeOrigin` on, which rewrote the Host to the API's own address
 * and got every write the React page made refused (batch 7 review H1). This puts the real proxy entry from
 * `vite.config.ts`, only its target moved to this test's server, in front of production's request chain, and sends what a
 * browser sends from the page.
 */

const entry = (viteConfig as { server?: { proxy?: Record<string, string | ProxyOptions> } }).server?.proxy?.['/api'];

let api: Server;
let vite: ViteDevServer;
let page: string;
let root: string;

beforeAll(async () => {
  api = serverApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => api.once('listening', resolve));
  const apiPort = (api.address() as AddressInfo).port;
  if (!entry || typeof entry === 'string') throw new Error('vite.config.ts must proxy /api with its options stated');
  // An empty root, so Vite has nothing to scan or pre-bundle: only the proxy is under test
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-dev-proxy-'));
  vite = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: 'localhost', port: 0, hmr: false, proxy: { '/api': { ...entry, target: `http://127.0.0.1:${apiPort}` } } },
  });
  await vite.listen();
  const port = (vite.httpServer!.address() as AddressInfo).port;
  // The address the developer opens: the page's origin, which the browser sends as `Origin` on every write
  page = `http://localhost:${port}`;
}, 30_000);

afterAll(async () => {
  await vite?.close();
  api?.closeAllConnections();
  api?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('npm run dev: the page reaches the API through Vite (D-081, batch 7 review H1)', () => {
  it('leaves the Host as the page sent it', () => {
    expect(typeof entry === 'object' && entry.changeOrigin).toBe(false);
  });

  it("a same-origin JSON write from the page reaches its route, not the other-site refusal", async () => {
    const res = await fetch(`${page}/api/trade/ai-reply`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json', origin: page, 'sec-fetch-site': 'same-origin' },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toBe(OTHER_SITE_REFUSED);
    // The route's own refusal, in its own words: the request got past every check in front of it
    expect([res.status, body.error]).toEqual([400, 'Nothing to send']);
  });

  it('still refuses another site through the proxy', async () => {
    const res = await fetch(`${page}/api/trade/ai-reply`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      signal: AbortSignal.timeout(10_000),
    });
    expect([res.status, ((await res.json()) as { error?: string }).error]).toEqual([403, OTHER_SITE_REFUSED]);
  });
});
