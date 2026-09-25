import { describe, expect, it, vi } from 'vitest';
import { currentImportGeneration, refitCalibrationsAfterImport } from '../server/api';
import { historyDb } from '../server/history';

/** The per-save calibration refit after an import (D-053): never for a superseded import, never on the server's event loop. */
describe('the calibration refit after an import', () => {
  it('does not start for an import that has already been superseded', async () => {
    const worker = vi.fn(async () => []);
    expect(await refitCalibrationsAfterImport(currentImportGeneration() - 1, worker)).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('with no worker available it is skipped with a logged reason, and the fits in force stay', async () => {
    historyDb.exec(`DELETE FROM save_calibration_fits`);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await refitCalibrationsAfterImport(currentImportGeneration(), async () => { throw new Error('no worker here'); });
    expect(out).toEqual([]);
    expect(log.mock.calls.some((c) => /refit is skipped and the fits in force stay/.test(String(c[0])))).toBe(true);
    expect((historyDb.prepare(`SELECT COUNT(*) AS n FROM save_calibration_fits`).get() as { n: number }).n).toBe(0);
    log.mockRestore();
  });
});

describe('the roster review refit reads no assumed schedule', () => {
  it('a past season whose schedule is not established is skipped with its reason, never held to 162 games', async () => {
    const { resultsLensSeason } = await import('../server/mlbCalibrationRefit');
    const { RESULTS_PRIOR } = await import('../server/resultsMetrics');
    const s = resultsLensSeason(100, 1901, RESULTS_PRIOR);
    expect('skip' in s && s.skip).toMatch(/schedule is not established/);
  });
});
