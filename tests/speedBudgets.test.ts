import { afterEach, describe, expect, it } from 'vitest';
import { currentImportGeneration } from '../server/api.js';
import { currentReportStamp, frontOfficeTimings, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { postImportHookNames, runPostImportHooks } from '../server/postImport.js';
import { discoveryClock } from '../server/saveDiscovery.js';
import { currentOrganization } from '../server/viewingOrganization.js';
import request from './request';

/**
 * The speed budgets' deterministic guards (N3.5 Stage B2, SWIFTUI_REBUILD.md "N3.5"): what keeps the first screen and
 * every poll fast, held structurally in CI, where timings vary. The wall-clock budgets themselves are measured by
 * `scripts/bench-launch.mjs` and `scripts/bench-import.mjs` on a copy of a real export. Guards held elsewhere: the hot
 * season queries answer from an index (`importAtomic.test.ts`), `/api/status` answers within budget during an import
 * (`autoImport.test.ts`, `importAtomic.test.ts`), and the live log is never copied on a request (`liveLogBackground.test.ts`).
 */
const saved = { ...discoveryClock };
afterEach(() => Object.assign(discoveryClock, saved));

describe('the first screen after an import', () => {
  it('is built in the background once the import is in: the Front Office warm-up is an after-import step, after the snapshots', async () => {
    const names = postImportHookNames();
    expect(names).toContain('frontOffice');
    expect(names.indexOf('frontOffice')).toBeGreaterThan(names.indexOf('snapshots'));
    const org = currentOrganization();
    expect(org).not.toBeNull();
    resetFrontOfficeCache();
    expect(frontOfficeTimings(org!.id)).toBeNull();
    // The steps after an import, as `runImport` runs them (an older generation: the refits skip themselves)
    await runPostImportHooks({ generation: currentImportGeneration() - 1, importStartedAt: new Date().toISOString(), fresh: true });
    const deadline = Date.now() + 60_000;
    while (!frontOfficeTimings(org!.id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    // No request asked for it: the club's Front Office is kept, so the GM's first look is a cached read
    expect(frontOfficeTimings(org!.id)).not.toBeNull();
    expect(currentReportStamp()).not.toBeNull();
  }, 90_000);
});

describe('the status every window polls', () => {
  it('never looks at the saves on its path: it serves the last look, which runs on its own timer', async () => {
    let looks = 0;
    discoveryClock.saves = () => {
      looks += 1;
      return [];
    };
    for (let i = 0; i < 5; i++) await request('/api/status');
    expect(looks).toBe(0);
  });
});
