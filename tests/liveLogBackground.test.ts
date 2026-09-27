import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, saveConfig } from '../server/config.js';
import { currentTransactionLog, logRefreshTiming, resetTransactionLogCache, transactionLogSettled } from '../server/dataStatus.js';
import { IDS } from './fixture';
import { makeSave, tx, type FakeSave } from './liveLogFixture';

/**
 * The live transaction log is copied off the request's path (N3.5 Stage B2): once OOTP writes it, a request is served the
 * last copy at once and a new copy is read in the background, soon after OOTP stops writing. Only a save's first read is
 * made on the request's path.
 */
const saves: FakeSave[] = [];
const timing = { ...logRefreshTiming };
afterEach(async () => {
  await transactionLogSettled();
  Object.assign(logRefreshTiming, timing);
  saves.splice(0).forEach((s) => s.cleanup());
  resetTransactionLogCache();
});
afterAll(() => fs.rmSync(path.join(DATA_DIR, 'config.json'), { force: true }));

const row = (n: number) => ({ date: '20300520', teamId: IDS.mlbTeam, text: tx.released([700 + n, `Someone ${n}`], 'RP') });

describe('the live transaction log after OOTP writes it', () => {
  it('serves the last copy at once, never copying on the request, and has the new one soon after', async () => {
    const save = makeSave({ rows: [row(1), row(2)], keepWriterOpen: true });
    saves.push(save);
    saveConfig({ csvDir: save.csvDir, saveName: null });
    resetTransactionLogCache();
    const first = currentTransactionLog();
    expect(first.log?.counts.rows).toBe(2);

    // OOTP writes: the next request is served the copy it has, the same one, untouched
    logRefreshTiming.debounceMs = 20;
    save.add([row(3)]);
    const during = currentTransactionLog();
    expect(during.log).toBe(first.log);
    // OOTP writes again while the read waits: still the last copy
    save.add([row(4)]);
    expect(currentTransactionLog().log).toBe(first.log);

    await transactionLogSettled();
    expect(currentTransactionLog().log?.counts.rows).toBe(4);
  });

  it('reads another save\'s log afresh, never serving the previous save\'s copy', () => {
    const a = makeSave({ rows: [row(1)] });
    const b = makeSave({ name: 'Other Save', rows: [row(1), row(2), row(3)] });
    saves.push(a, b);
    saveConfig({ csvDir: a.csvDir, saveName: null });
    expect(currentTransactionLog().log?.counts.rows).toBe(1);
    saveConfig({ csvDir: b.csvDir, saveName: null });
    expect(currentTransactionLog().log?.counts.rows).toBe(3);
  });
});
