import { describe, expect, it } from 'vitest';
import {
  addDays, assessFreshness, daysBetween, parseGameDate, STALE_SNAPSHOT_ACTION,
  type FreshnessInputs,
} from '../server/dataFreshness.js';
import { formatGameDay, statusRows } from '../src/dataStatusModel';
import type { DataStatus } from '../src/api';

/**
 * The spec's four examples are written in terms of "the day", and the code
 * compares simulated-through dates. OOTP's export names the day about to be
 * played, so an export at `current_date` 5/17 reflects the sim through 5/16.
 */
const LOG = (last: string | null, covered: string | null = last) =>
  ({ available: true as const, lastTransactionDate: last, coveredThrough: covered });

const run = (over: Partial<FreshnessInputs> & Pick<FreshnessInputs, 'log'>) =>
  assessFreshness({ saveSimulatedThrough: '2026-05-16', csvCurrentDate: '2026-05-17', ...over });

describe('freshness model', () => {
  it('save 5/16, CSV 5/16, log 5/16 → fully current', () => {
    const a = run({ log: LOG('2026-05-16') });
    expect(a.level).toBe('current');
    expect(a.csv.state).toBe('current');
    expect(a.log.state).toBe('current');
    expect(a.action).toBeNull();
  });

  it('save 5/16, CSV 5/16, log 5/15 → current state, chronology one day behind', () => {
    const a = run({ log: LOG('2026-05-15') });
    expect(a.level).toBe('partial');
    expect(a.csv.state).toBe('current');
    expect(a.log).toMatchObject({ state: 'behind', lagDays: 1, through: '2026-05-15' });
    expect(a.headline).toBe('Partial — transaction log 1 day behind');
  });

  it('save 5/16, CSV 5/14, log 5/16 → the current-state snapshot is stale', () => {
    const a = run({ csvCurrentDate: '2026-05-15', log: LOG('2026-05-16') });
    expect(a.level).toBe('stale');
    expect(a.csv).toMatchObject({ state: 'behind', lagDays: 2 });
    expect(a.action).toBe(STALE_SNAPSHOT_ACTION);
    expect(a.action).toMatch(/Export fresh database data before relying on roster recommendations/);
  });

  it('save 5/16, CSV 5/16, no log → current state is available, chronology-dependent reasoning is limited', () => {
    const a = run({ log: { available: false, reason: 'database_missing' } });
    expect(a.level).toBe('partial');
    expect(a.csv.state).toBe('current');
    expect(a.log.state).toBe('unavailable');
    expect(a.headline).toBe('Partial — transaction log unavailable');
    expect(a.reasons.join(' ')).toMatch(/Current league state is available/);
    // An unavailable log is never reported as a stale snapshot
    expect(a.action).toBeNull();
  });

  it('says why the log is unavailable', () => {
    expect(run({ log: { available: false, reason: 'save_not_found' } }).reasons.join(' ')).toMatch(/save folder could not be found/);
    expect(run({ log: { available: false, reason: 'database_missing' } }).reasons.join(' ')).toMatch(/no live transaction database/);
    expect(run({ log: { available: false, reason: 'unreadable' } }).reasons.join(' ')).toMatch(/could not be read/);
  });

  it('a day with no transactions does not make the log look behind', () => {
    // Newest transaction is the 14th, but the database has been written through the 16th
    const a = run({ log: LOG('2026-05-14', '2026-05-16') });
    expect(a.level).toBe('current');
    expect(a.log.through).toBe('2026-05-16');
  });

  it('moves logged on the not-yet-simulated day are not "ahead" of an export that includes them', () => {
    // The user acted on 5/17 before simming; the export's current_date is 5/17
    const a = run({ log: LOG('2026-05-17') });
    expect(a.level).toBe('current');
    expect(a.csv.state).toBe('current');
  });

  it('transactions dated after the export cannot be in it, so the snapshot is stale', () => {
    const a = run({ saveSimulatedThrough: null, csvCurrentDate: '2026-05-17', log: LOG('2026-05-19') });
    expect(a.csv).toMatchObject({ state: 'behind', lagDays: 2 });
    expect(a.level).toBe('stale');
  });

  it('a stale snapshot outranks an unavailable log, and says both', () => {
    const a = run({ csvCurrentDate: '2026-05-10', log: { available: false, reason: 'save_not_found' } });
    expect(a.level).toBe('stale');
    expect(a.reasons.join(' ')).toMatch(/also unavailable/);
  });

  it('nothing imported is unavailable', () => {
    const a = run({ csvCurrentDate: null, log: { available: false, reason: 'save_not_found' } });
    expect(a.level).toBe('unavailable');
    expect(a.csv.state).toBe('unavailable');
  });

  it('cannot verify against a save whose date is unreadable, and says so instead of claiming current', () => {
    const a = run({ saveSimulatedThrough: null, log: { available: false, reason: 'save_not_found' } });
    expect(a.level).toBe('partial');
    expect(a.csv.state).toBe('unverified');
  });

  it('with no save date the log and CSV still check each other', () => {
    const a = run({ saveSimulatedThrough: null, log: LOG('2026-05-16') });
    expect(a.csv.state).toBe('current');
    expect(a.level).toBe('current');
    // ...and a log that stops short of the export is still noticed without a save date
    expect(run({ saveSimulatedThrough: null, log: LOG('2026-05-15') }).log).toMatchObject({ state: 'behind', lagDays: 1 });
  });

  it('pluralises the lag', () => {
    expect(run({ log: LOG('2026-05-13') }).headline).toBe('Partial — transaction log 3 days behind');
  });

  it('never consults wall-clock time', () => {
    // Identical inputs give identical answers regardless of when they are asked
    const inputs = { saveSimulatedThrough: '2001-01-01', csvCurrentDate: '2001-01-02', log: LOG('2001-01-01') };
    expect(assessFreshness(inputs)).toEqual(assessFreshness(inputs));
    expect(assessFreshness(inputs).level).toBe('current');
  });
});

describe('game dates', () => {
  it('parses OOTP un-padded dates and rejects impossible ones', () => {
    expect(parseGameDate('2026-5-16')).toBe('2026-05-16');
    expect(parseGameDate('2026-05-16')).toBe('2026-05-16');
    expect(parseGameDate('2026-02-30')).toBeNull();
    expect(parseGameDate('soon')).toBeNull();
    expect(parseGameDate(null)).toBeNull();
    expect(parseGameDate(20260516)).toBeNull();
  });

  it('does date arithmetic across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(daysBetween('2026-05-15', '2026-05-16')).toBe(1);
    expect(daysBetween('2026-05-16', '2026-05-15')).toBe(-1);
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
  });
});

/** A DataStatus as the server would send it, built from the same assessment. */
const status = (
  inputs: FreshnessInputs,
  over: { save?: Partial<DataStatus['save']>; readable?: boolean } = {}
): DataStatus => {
  const f = assessFreshness(inputs);
  return {
    generatedAt: '', configured: true,
    save: {
      found: true, name: 'Test', lgPath: '/x', discovery: 'csv_layout', discoveryNotes: [],
      simulatedThrough: inputs.saveSimulatedThrough, dateSource: 'last_date_simulated.dat', ...over.save,
    },
    csv: { currentDate: inputs.csvCurrentDate, simulatedThrough: f.csv.through, exportedAt: null, importedAt: null },
    transactionLog: {
      found: inputs.log.available, readable: over.readable ?? inputs.log.available, error: null,
      unavailableReason: inputs.log.available ? null : inputs.log.reason,
      coverage: null, counts: null,
    },
    freshness: f as DataStatus['freshness'],
  };
};

describe('data-status UI model', () => {
  const rows = (s: DataStatus) => Object.fromEntries(statusRows(s).map((r) => [r.label, r.value]));

  it('current', () => {
    const r = rows(status({ saveSimulatedThrough: '2026-05-15', csvCurrentDate: '2026-05-16', log: LOG('2026-05-15') }));
    expect(r['League data']).toBe('Current');
    expect(r.Transactions).toBe('Through May 15, 2026');
    expect(r['OOTP save']).toBe('Through May 15, 2026');
    expect(r['Roster evidence']).toBe('Current');
  });

  it('partial: log one day behind', () => {
    const r = rows(status({ saveSimulatedThrough: '2026-05-16', csvCurrentDate: '2026-05-17', log: LOG('2026-05-15') }));
    expect(r['League data']).toBe('Current');
    expect(r.Transactions).toBe('Through May 15, 2026 (1 day behind)');
    expect(r['Roster evidence']).toBe('Partial — transaction log 1 day behind');
  });

  it('partial: log unavailable is distinct from stale', () => {
    const r = rows(status({ saveSimulatedThrough: '2026-05-16', csvCurrentDate: '2026-05-17', log: { available: false, reason: 'database_missing' } }));
    expect(r['League data']).toBe('Current');
    expect(r.Transactions).toBe('Unavailable');
    expect(r['Roster evidence']).toBe('Partial — transaction log unavailable');
  });

  it('partial: names the missing save when that is why the log is unavailable', () => {
    const s = status(
      { saveSimulatedThrough: null, csvCurrentDate: '2026-05-17', log: { available: false, reason: 'save_not_found' } },
      { save: { found: false, simulatedThrough: null } }
    );
    expect(rows(s).Transactions).toBe('Unavailable — save not found');
    expect(rows(s)['OOTP save']).toBe('Not found');
  });

  it('stale', () => {
    const r = rows(status({ saveSimulatedThrough: '2026-05-16', csvCurrentDate: '2026-05-15', log: LOG('2026-05-16') }));
    expect(r['League data']).toBe('Behind by 2 days');
    expect(r['Roster evidence']).toBe('Stale — league snapshot 2 days behind');
  });

  it('unavailable', () => {
    const r = rows(status({ saveSimulatedThrough: null, csvCurrentDate: null, log: { available: false, reason: 'save_not_found' } }));
    expect(r['League data']).toBe('Not imported');
    expect(r['Roster evidence']).toBe('Unavailable — no league data has been imported');
  });

  it('formats a game day without shifting with the viewer time zone', () => {
    expect(formatGameDay('2026-05-16')).toBe('May 16, 2026');
    expect(formatGameDay(null)).toBe('—');
    expect(formatGameDay('nonsense')).toBe('—');
  });
});
