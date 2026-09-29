import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionLog } from '../server/transactionLog.js';

/**
 * The wire's column on the Morning Report follows the log the server holds (D-059, D-021): a copy of the live log read
 * after the Morning Report was composed (the first read after start, or a new copy) composes it again, so the column
 * never keeps saying the log is still being read once it has been.
 */

const peek = vi.hoisted(() => ({ value: null as null | { log: TransactionLog | null; status: unknown } }));
vi.mock('../server/dataStatus.js', async (original) => ({
  ...(await original<typeof import('../server/dataStatus.js')>()),
  peekTransactionLog: () => peek.value,
}));

const { forgetHistoryKey } = await import('../server/historyIdentity.js');
const { forgetMemoryCaches } = await import('../server/frontOfficeMemory.js');
const { frontOfficeSummaryNow, resetAttention } = await import('../server/frontOfficeAttention.js');
const { resetFrontOfficeCache } = await import('../server/frontOfficeService.js');
const { forgetWire, wireStamp } = await import('../server/leagueWire.js');
const { importedAt } = await import('../server/playerStateRoutes.js');
const { buildSave } = await import('./syntheticSave');

const emptyLog = (): TransactionLog => ({
  events: [], byPlayer: new Map(), coverage: {} as TransactionLog['coverage'],
  counts: { rows: 0, events: 0, unsupported: 0, byKind: {} }, unsupportedSamples: [], snapshot: {} as TransactionLog['snapshot'],
});

describe('the wire\'s column follows the copy of the log the server holds', () => {
  let org = 0;
  const realStamp = importedAt.value;

  beforeAll(() => {
    org = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true }).org;
  });
  afterAll(() => {
    importedAt.value = realStamp;
  });
  beforeEach(() => {
    forgetHistoryKey();
    forgetMemoryCaches();
    forgetWire();
    resetFrontOfficeCache();
    resetAttention();
    importedAt.value = '2040-05-06T10:00:00.000Z';
    peek.value = null;
  });

  it('moves its stamp when the log is first read and with each new copy, and not otherwise', () => {
    const reading = wireStamp(importedAt.value, org);
    expect(wireStamp(importedAt.value, org)).toBe(reading);
    const first = emptyLog();
    peek.value = { log: first, status: {} };
    const read = wireStamp(importedAt.value, org);
    expect(read).not.toBe(reading);
    expect(wireStamp(importedAt.value, org)).toBe(read);
    peek.value = { log: emptyLog(), status: {} };
    expect(wireStamp(importedAt.value, org)).not.toBe(read);
  });

  it('composes the Morning Report again once the log has been read, so its column stops saying it is being read', async () => {
    const before = await frontOfficeSummaryNow(org);
    expect(before.wire!.gaps.map((g) => g.display)).toContain('The transaction log is still being read, so moves will follow.');
    peek.value = { log: emptyLog(), status: {} };
    const after = await frontOfficeSummaryNow(org);
    expect(after.wire!.gaps.map((g) => g.display)).not.toContain('The transaction log is still being read, so moves will follow.');
  });
});
