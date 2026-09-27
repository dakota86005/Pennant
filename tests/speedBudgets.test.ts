import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig } from '../server/config.js';
import { currentImportGeneration } from '../server/api.js';
import { currentReportStamp, frontOfficeTimings, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { postImportHookNames, runPostImportHooks } from '../server/postImport.js';
import { discoveryClock } from '../server/saveDiscovery.js';
import { currentOrganization } from '../server/viewingOrganization.js';
import { lookAtTheServedSave } from '../server/saveDiscovery.js';
import request from './request';

/** Every call to what finds a save on disk, counted (the originals still run): the status must make none (N6 B1 review M3). */
const finding = vi.hoisted(() => ({ locateSave: 0, detectSaves: 0, findSaves: 0 }));
vi.mock('../server/ootpSave.js', async (original) => {
  const actual = await original<typeof import('../server/ootpSave.js')>();
  return { ...actual, locateSave: (...args: Parameters<typeof actual.locateSave>) => { finding.locateSave += 1; return actual.locateSave(...args); } };
});
vi.mock('../server/paths.js', async (original) => {
  const actual = await original<typeof import('../server/paths.js')>();
  return {
    ...actual,
    detectSaves: (...args: Parameters<typeof actual.detectSaves>) => { finding.detectSaves += 1; return actual.detectSaves(...args); },
    findSaves: (...args: Parameters<typeof actual.findSaves>) => { finding.findSaves += 1; return actual.findSaves(...args); },
  };
});

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

  it('never locates a save on its path, not even to name the served save (N6 B1 review M3)', async () => {
    const before = loadConfig();
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-nowhere-'));
    try {
      // A configuration moved since the save was last worked out (a save named but not found would even list the saves):
      // neither the served save's id nor the Front Office's stamp (its live log) is worked out on the status's path
      saveConfig({ csvDir: nowhere, saveName: 'Nowhere' });
      const counted = { ...finding };
      for (let i = 0; i < 5; i++) expect(await request('/api/status')).toHaveProperty('saveId');
      expect(finding).toEqual(counted);
      // Working it out, off the path, is what locates (the counters see it)
      lookAtTheServedSave();
      expect(finding.locateSave).toBeGreaterThan(counted.locateSave);
      const worked = { ...finding };
      for (let i = 0; i < 5; i++) await request('/api/status');
      expect(finding).toEqual(worked);
    } finally {
      saveConfig(before);
      fs.rmSync(nowhere, { recursive: true, force: true });
    }
  });
});
