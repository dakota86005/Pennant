import { describe, expect, it } from 'vitest';
import { EXPORT_NOT_FOUND, failedImportText, importNote, importWords, tableName } from '../server/presentation/importWords.js';
import { bannedIn, BANNED_JARGON, BANNED_VERDICTS } from './bannedJargon';

/**
 * The import in words (SWIFTUI_REBUILD.md section 12, the N3 gaps): the phase and the table named for a person, why an
 * import did not finish (the raw message kept for the log, never the visible line), and why a chosen save did not start.
 */

const base = { importing: false, lastError: null, interruptedSince: null, configured: true, csvDirExists: true };

describe('an import step in words', () => {
  it('names the phase and the table for a person, and counts the files', () => {
    expect(importWords({ table: 'team_record', fileIndex: 12, files: 70, rows: 900, phase: 'writing' })).toEqual({
      phase: 'Writing the league', table: 'Standings', display: 'Writing standings · 12 of 70',
    });
    expect(importWords({ table: 'players', fileIndex: 1, files: 70, rows: 0, phase: 'reading' }).display).toBe('Reading players · 1 of 70');
    expect(importWords({ table: 'indexes', fileIndex: 70, files: 70, rows: 9, phase: 'indexing' }).display).toBe('Getting the league ready');
  });

  it('reads a file it has no name for as the export, never its OOTP file name (that stays in the help tag)', () => {
    expect(tableName('league_history_batting_stats')).toBeNull();
    expect(tableName('team_fielding_stats_stats')).toBe('team fielding');
    expect(importWords({ table: 'players_value', fileIndex: 12, files: 70, rows: 9, phase: 'writing' })).toEqual({
      phase: 'Writing the league', table: 'The export', display: 'Writing the export · 12 of 70',
    });
  });
});

describe('why an import did not finish, or did not start', () => {
  it('says a failure in a sentence the GM can act on, and keeps the raw message as the detail', () => {
    const note = importNote({ ...base, lastError: 'SQLITE_BUSY: database is locked' })!;
    expect(note.kind).toBe('failed');
    expect(note.text).toMatch(/Another program was using/);
    expect(note.text).not.toMatch(/SQLITE/);
    expect(note.detail).toBe('SQLITE_BUSY: database is locked');
    expect(failedImportText('No .csv files found in /x')).toMatch(/no files to import/);
    expect(failedImportText('something odd')).toMatch(/stopped before it finished/);
  });

  it('says an interrupted import is being imported again, or needs importing again', () => {
    expect(importNote({ ...base, interruptedSince: '2040-07-01T12:00:00.000Z', importing: true })!.text).toMatch(/importing the export again/);
    expect(importNote({ ...base, interruptedSince: '2040-07-01T12:00:00.000Z' })!.text).toMatch(/Import again to finish it/);
  });

  it('says the export folder is missing, and says nothing when all is well or nothing is chosen', () => {
    expect(importNote({ ...base, csvDirExists: false })!.kind).toBe('exportMissing');
    expect(importNote(base)).toBeNull();
    expect(importNote({ ...base, configured: false, csvDirExists: false })).toBeNull();
  });

  it('keeps every sentence plain', () => {
    const texts = [
      EXPORT_NOT_FOUND,
      ...['No .csv files found', 'SQLITE_BUSY', 'EACCES', 'ENOENT', 'ENOSPC', 'other'].map(failedImportText),
      importNote({ ...base, interruptedSince: 'x' })!.text,
      importNote({ ...base, csvDirExists: false })!.text,
    ];
    for (const text of texts) expect(bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS]), text).toEqual([]);
  });
});
