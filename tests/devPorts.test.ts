import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT, resolveDevPorts } from '../scripts/devPorts.js';
import viteConfig from '../vite.config.js';

/**
 * `npm run dev` starts two listeners, and they must never share a port.
 *
 * The regression: a tool that exports `PORT=5173` to the whole dev process (the
 * preview harness does) made the API read that same variable, so Vite and the API
 * both took 5173, the proxy pointed at 5178 where nothing listened, and every
 * `/api` call failed. The API now has its own port and `PORT` only moves the page.
 */
describe('resolveDevPorts', () => {
  it('defaults to the conventional pair', () => {
    expect(resolveDevPorts({})).toEqual({ web: DEFAULT_WEB_PORT, api: DEFAULT_API_PORT });
    expect(DEFAULT_WEB_PORT).not.toBe(DEFAULT_API_PORT);
  });

  it('PORT=5173 — the case that broke the preview — leaves the API on its own port', () => {
    expect(resolveDevPorts({ PORT: '5173' })).toEqual({ web: 5173, api: 5178 });
  });

  it('PORT moves the page, never the API', () => {
    const { web, api } = resolveDevPorts({ PORT: '4000' });
    expect(web).toBe(4000);
    expect(api).toBe(DEFAULT_API_PORT);
  });

  it('OOTP_FO_API_PORT moves the API only', () => {
    expect(resolveDevPorts({ OOTP_FO_API_PORT: '6100' })).toEqual({ web: 5173, api: 6100 });
  });

  it('never returns the same port twice, however it is asked', () => {
    expect(resolveDevPorts({ PORT: '5178' }).api).not.toBe(5178);
    expect(resolveDevPorts({ PORT: '7000', OOTP_FO_API_PORT: '7000' })).toEqual({ web: 7000, api: 7001 });
  });

  it('ignores a value that is not a port', () => {
    expect(resolveDevPorts({ PORT: 'abc', OOTP_FO_API_PORT: '0' })).toEqual({
      web: DEFAULT_WEB_PORT,
      api: DEFAULT_API_PORT,
    });
    expect(resolveDevPorts({ PORT: '70000' }).web).toBe(DEFAULT_WEB_PORT);
  });
});

describe('the dev wiring', () => {
  const cfg = viteConfig as { server?: { port?: number; strictPort?: boolean; proxy?: Record<string, string> } };
  const ports = resolveDevPorts(process.env);

  it('serves the page on the web port and fails loudly rather than moving off it', () => {
    expect(cfg.server?.port).toBe(ports.web);
    expect(cfg.server?.strictPort).toBe(true);
  });

  it('proxies /api to the API port, not to itself', () => {
    const target = cfg.server?.proxy?.['/api'];
    expect(target).toBe(`http://127.0.0.1:${ports.api}`);
    expect(ports.api).not.toBe(cfg.server?.port);
  });

  it('starts the API through the entry that pins its port, not the bare server', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['dev:server']).toContain('scripts/dev-server.ts');
    expect(pkg.scripts['dev:server']).not.toContain('server/index.ts');
    const entry = readFileSync('scripts/dev-server.ts', 'utf8');
    expect(entry).toContain('process.env.PORT = String(resolveDevPorts(process.env).api)');
  });
});
