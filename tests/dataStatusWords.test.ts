import { describe, expect, it } from 'vitest';
import { assessFreshness, type FreshnessInputs } from '../server/dataFreshness.js';
import type { DataStatus, LogSourceStatus } from '../server/dataStatus.js';
import { DISCOVERY_WORDS, dataStatusView, gameDateDisplay } from '../server/presentation/dataStatusWords.js';
import { BANNED_JARGON, BANNED_VERDICTS, basisStrings, bannedIn, shownStrings } from './bannedJargon';

/**
 * The data status in words (SWIFTUI_REBUILD.md section 12, the N3 gaps): each level and source in a sentence, why the
 * transaction log is unavailable, how the save was found, the game date from the unpadded OOTP string, and a sentence for
 * every value that is missing. States and lags are the freshness model's; the words decide nothing.
 */

const log = (over: Partial<LogSourceStatus> = {}): LogSourceStatus => ({
  found: true, readable: true, error: null, unavailableReason: null, files: null, snapshot: null, coverage: null, counts: null,
  unsupportedSamples: [], ...over,
});

function status(inputs: FreshnessInputs, over: { save?: Partial<DataStatus['save']>; csv?: Partial<DataStatus['csv']>; log?: LogSourceStatus; configured?: boolean } = {}): DataStatus {
  const freshness = assessFreshness(inputs);
  return {
    generatedAt: '2040-07-01T12:00:00.000Z',
    configured: over.configured ?? true,
    save: {
      found: true, name: 'Test', lgPath: '/saves/Test.lg', discovery: 'csv_layout', discoveryNotes: [],
      simulatedThrough: inputs.saveSimulatedThrough, dateSource: null, ...over.save,
    },
    csv: { currentDate: inputs.csvCurrentDate, simulatedThrough: freshness.csv.through, exportedAt: '2040-07-01T11:00:00.000Z', importedAt: '2040-07-01T11:05:00.000Z', ...over.csv },
    transactionLog: over.log ?? log(),
    freshness,
  };
}

const current = status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: true, lastTransactionDate: '2040-05-08', coveredThrough: '2040-05-08' } });

describe('the level and each source, in a sentence', () => {
  it('says "Up to date" when every source matches, and joins the game date to it for the subtitle', () => {
    const view = dataStatusView(current);
    expect(view.level).toBe('current');
    expect(view.headline).toMatchObject({ text: 'Up to date', tone: 'good' });
    expect(view.subtitle).toBe('May 9, 2040 · Up to date');
    expect(view.subtitleHint).toBe('May 9, 2040 · Up to date');
    expect(view.sources.map((r) => [r.id, r.cells.state.display])).toEqual([
      ['league', 'Current'], ['transactions', 'Through May 8, 2040'], ['save', 'Through May 8, 2040'], ['evidence', 'Up to date'],
    ]);
  });

  it('says how far behind the league data is, and what to do, from the freshness model\'s own lag', () => {
    const view = dataStatusView(status({ saveSimulatedThrough: '2040-05-12', csvCurrentDate: '2040-05-09', log: { available: true, lastTransactionDate: null, coveredThrough: '2040-05-12' } }));
    expect(view.level).toBe('stale');
    expect(view.headline.text).toBe('League data is 4 days behind the save');
    expect(view.sources[0].cells.state).toMatchObject({ display: 'Behind by 4 days', tone: 'bad' });
    expect(view.action?.display).toMatch(/Export the database from OOTP again/);
    expect(view.headline.basis.wouldChange).toEqual([view.action!.display]);
  });

  it('says why the transaction log is unavailable, in words, in its help tag and the headline\'s basis', () => {
    const missing = status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: false, reason: 'database_missing' } }, { log: log({ readable: false, unavailableReason: 'database_missing' }) });
    const view = dataStatusView(missing);
    expect(view.headline.text).toBe('Transaction history unavailable');
    // The title bar's subtitle is short; the headline is its help tag
    expect(view.subtitle).toBe('May 9, 2040 · No log');
    expect(view.subtitleHint).toBe('May 9, 2040 · Transaction history unavailable');
    expect(view.sources[1].cells.state).toMatchObject({ display: 'Unavailable', hint: 'The save has no transaction log yet' });
    expect(view.headline.basis.unknown[0]).toMatch(/no live transaction database/);
    const torn = dataStatusView(status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: false, reason: 'unreadable' } }, {
      log: log({ readable: false, unavailableReason: 'unreadable', error: { code: 'torn', message: 'changed while copying' } }),
    }));
    expect(torn.sources[1].cells.state.hint).toBe('OOTP was writing it; Pennant tries again shortly');
  });

  it('says nothing is imported yet, never a blank or a zero', () => {
    const none = dataStatusView(status({ saveSimulatedThrough: null, csvCurrentDate: null, log: { available: false, reason: 'save_not_found' } }, {
      save: { found: false, lgPath: null, discovery: 'not_found' }, csv: { exportedAt: null, importedAt: null }, log: log({ readable: false, unavailableReason: 'save_not_found' }), configured: false,
    }));
    expect(none.headline.text).toBe('No league data imported yet');
    expect(none.gameDate).toEqual({ served: null, display: 'Not imported yet' });
    expect(none.subtitle).toBe('Not imported');
    expect(none.subtitleHint).toBe('No league data imported yet');
    // A present date or time sorts by its ISO form
    expect(dataStatusView(current).facts.find((f) => f.id === 'imported')!.sort.value).toBe('2040-07-01T11:05:00.000Z');
    expect(dataStatusView(current).facts.find((f) => f.id === 'gameDate')!.sort.value).toBe('2040-05-09');
    expect(none.facts.map((f) => [f.id, f.cells.value.display, f.sort.value])).toEqual([
      ['gameDate', 'Not imported yet', null],
      ['importedThrough', 'Not imported yet', null],
      ['saveThrough', 'Save not found', null],
      ['exported', 'No save chosen', null],
      ['imported', 'Not imported yet', null],
      ['saveFolder', 'Not found', null],
    ]);
    for (const f of none.facts) expect(f.cells.value.tone).toBe('unknown');
  });
});

describe('dates and places', () => {
  it('writes an OOTP game date from its unpadded form, and leaves an unreadable one unwritten', () => {
    expect(gameDateDisplay('2040-5-9')).toBe('May 9, 2040');
    expect(gameDateDisplay('2040-05-09')).toBe('May 9, 2040');
    expect(gameDateDisplay('2040-13-40')).toBeNull();
    expect(gameDateDisplay(null)).toBeNull();
  });

  it('says how the save was found, in the save folder\'s help tag', () => {
    const view = dataStatusView(status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: true, lastTransactionDate: null, coveredThrough: '2040-05-08' } }, { save: { discovery: 'manual_override' } }));
    expect(view.facts.find((f) => f.id === 'saveFolder')!.cells.value).toEqual({ display: '/saves/Test.lg', hint: 'Named by hand in Settings' });
    expect(Object.keys(DISCOVERY_WORDS).sort()).toEqual(['ancestor_lg', 'csv_layout', 'manual_override', 'not_found', 'save_name_match']);
  });

  it('keeps every line plain in every state: the face and the breakdown both pass the whole list', () => {
    const logUnreadable = (reason: 'save_not_found' | 'database_missing' | 'unreadable', error: LogSourceStatus['error'] = null) =>
      log({ readable: false, unavailableReason: reason, error });
    const states: Record<string, DataStatus> = {
      current,
      stale: status({ saveSimulatedThrough: '2040-05-12', csvCurrentDate: '2040-05-09', log: { available: false, reason: 'save_not_found' } }, { log: logUnreadable('save_not_found') }),
      logBehind: status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: true, lastTransactionDate: '2040-05-06', coveredThrough: '2040-05-06' } }),
      saveNotFound: status({ saveSimulatedThrough: null, csvCurrentDate: '2040-05-09', log: { available: false, reason: 'save_not_found' } }, {
        save: { found: false, lgPath: null, discovery: 'not_found', discoveryNotes: ['The CSV folder is not inside <save>.lg/import_export/csv.'] }, log: logUnreadable('save_not_found'),
      }),
      logMissing: status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: false, reason: 'database_missing' } }, { log: logUnreadable('database_missing', { code: 'missing', message: 'No text_data.sqlite3 in the save\'s temp folder.' }) }),
      logTorn: status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: false, reason: 'unreadable' } }, { log: logUnreadable('unreadable', { code: 'torn', message: 'The source changed while it was copied.' }) }),
      unverified: status({ saveSimulatedThrough: null, csvCurrentDate: '2040-05-09', log: { available: true, lastTransactionDate: null, coveredThrough: null } }, { save: { simulatedThrough: null } }),
      unavailable: status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: null, log: { available: false, reason: 'save_not_found' } }, { csv: { importedAt: null }, log: logUnreadable('save_not_found') }),
      unconfigured: status({ saveSimulatedThrough: null, csvCurrentDate: null, log: { available: false, reason: 'save_not_found' } }, {
        save: { found: false, lgPath: null, discovery: 'not_found', discoveryNotes: ['No CSV export is configured.'] }, csv: { exportedAt: null, importedAt: null }, log: logUnreadable('save_not_found'), configured: false,
      }),
    };
    const levels = new Set<string>();
    for (const [name, state] of Object.entries(states)) {
      const view = dataStatusView(state);
      levels.add(view.level);
      const strings = [...shownStrings(view), ...basisStrings(view)];
      expect(strings.length, name).toBeGreaterThan(8);
      for (const { path, text } of strings) expect(bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS]), `${name} ${path}: ${text}`).toEqual([]);
    }
    expect([...levels].sort()).toEqual(['current', 'partial', 'stale', 'unavailable']);
  });

  it('keeps how the save was found and what the log reader said in the breakdown', () => {
    const view = dataStatusView(status({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: false, reason: 'unreadable' } }, {
      save: { discovery: 'ancestor_lg', discoveryNotes: ['Found above the export folder.'] },
      log: log({ readable: false, unavailableReason: 'unreadable', error: { code: 'invalid', message: 'The copy lacks the transactions table.' } }),
    }));
    expect(view.headline.basis.because).toEqual(expect.arrayContaining([
      { label: 'How the save was found', value: 'Found in a folder above the export' },
      { label: 'Where Pennant looked', value: 'Found above the export folder.' },
      { label: 'What the log reader said', value: 'The copy lacks the transactions table.' },
    ]));
  });
});
