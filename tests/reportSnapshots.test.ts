import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyDb } from '../server/history.js';
import { BACKUP_DIR, forgetHistoryKey } from '../server/historyIdentity.js';
import {
  previousReportSnapshot, previousStandings, recordReportSnapshot, recordStandingsSnapshot, reportSnapshotCount, reportSnapshotOf, standingsOf,
  forgetMemoryCaches, memoryBackupPath, ensureMemoryBackup, allowMemoryBackupRetry, memoryBackupState, type StandingsRow,
} from '../server/frontOfficeMemory.js';
import { frontOfficeSummaryNow, rememberBuild, resetAttention, departmentReportNow, resultsSince } from '../server/frontOfficeAttention.js';
import { frontOfficeBuilt, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { subscribe, type ServerEvent } from '../server/serverEvents.js';
import { servedDepartments, departmentOffice } from '../server/presentation/catalog.js';
import { basis, claim } from '../server/presentation/claim.js';
import { sinceLastExport, type PreviousExport } from '../server/presentation/frontOffice/attention.js';
import { assemble, item, type BuildContext, type DepartmentContext } from '../server/presentation/frontOffice/desk.js';
import type { DepartmentReport } from '../server/presentation/frontOffice/types.js';
import { farmSeverity } from '../server/presentation/severity.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * "Since the last export" (BEHAVIOR_CASES.md "Pennant for Mac", `reportSnapshots.test.ts`, case 16; D-058): two exports'
 * served items compared, what changed said, never which transaction changed it (D-020).
 */

const build: BuildContext = { orgId: 1, club: 'Test Club', importStamp: '2040-07-02T12:00:00.000Z', reportStamp: 'r2', gameDate: '2040-7-2' };
const ctxOf = (id: Parameters<typeof departmentOffice>[0]): DepartmentContext => ({
  build, department: servedDepartments(null).find((d) => d.id === id)!, office: departmentOffice(id),
});

/** A farm item at a severity, keyed as the farm keys its items. */
const farmItem = (key: string, severity: 'critical' | 'attention' | 'noted', text: string) => item(ctxOf('farm'), {
  key: `farm:${key}`, severity: farmSeverity({ severity }), shading: [],
  headline: claim({ text, tone: 'neutral', basis: basis({ because: [{ label: 'Read', value: 'x' }], source: { department: 'farm', specialist: 'x', asOf: null, gameDate: null }, unknown: [], wouldChange: [], lean: null, certainty: 'fact' }) }),
});

/** The reports a build would serve, with the farm's items as given and the other departments read and quiet. */
function reportsWith(farm: ReturnType<typeof farmItem>[] | 'unavailable'): DepartmentReport[] {
  const quiet = { status: 'available', items: [{ specialist: 'x', items: [], figures: [], unknowns: [] }] } as const;
  const { reports } = assemble(build, servedDepartments(null), departmentOffice, {
    majorLeague: quiet, finance: quiet, medical: quiet,
    farm: farm === 'unavailable' ? { status: 'unavailable', reason: 'The farm couldn\'t be read this time.' } : { status: 'available', items: [{ specialist: 'x', items: farm, figures: [], unknowns: [] }] },
  } as never);
  return [...reports.values()].filter((r) => r.department !== 'frontOffice');
}

const previousWith = (items: Array<[string, 'critical' | 'attention' | 'noted', string]>, farm: 'ready' | 'unavailable' = 'ready'): PreviousExport => ({
  importStamp: '2040-07-01T12:00:00.000Z',
  gameDate: '2040-7-1',
  importedText: 'Jul 1, 2040, 5:00 AM',
  departments: { majorLeague: 'ready', farm, finance: 'ready', medical: 'ready' },
  items: new Map(items.map(([key, severity, headline]) => [`farm:${key}`, { department: 'farm' as const, severity, headline }])),
});

/** Every visible string in a payload (its `text`, `hint` and `display`), however deep. */
function collectShown(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectShown(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'text' || k === 'hint' || k === 'display') && typeof v === 'string') out.push(v);
      else collectShown(v, out);
    }
  }
  return out;
}

const TRANSACTIONS = /\b(optioned|recalled|designated|released|traded|claimed|activated|purchased)\b/i;

describe('what changed since the last export (case 16)', () => {
  it('says an item is new, resolved or at another urgency, from what the two exports served', () => {
    const now = reportsWith([farmItem('a', 'attention', 'Arms short at Double-A'), farmItem('b', 'critical', 'Nobody to catch at Triple-A')]);
    const { summary, byDepartment } = sinceLastExport({
      reports: now, previous: previousWith([['b', 'attention', 'Nobody to catch at Triple-A'], ['c', 'noted', 'A shortstop idle at Single-A']]),
      results: { games: null, why: 'noSchedule' }, importStamp: build.importStamp, gameDate: build.gameDate,
    });
    expect(summary.new.items.map((i) => i.key)).toEqual(['farm:a']);
    expect(summary.moved.items.map((i) => i.key)).toEqual(['farm:b']);
    expect(summary.resolved.items.map((i) => i.key)).toEqual(['farm:c']);
    expect(summary.moved.items[0].line.hint).toBe('Now urgent; was needs attention');
    expect([summary.new.text, summary.resolved.text, summary.moved.text]).toEqual(['1 new', '1 resolved', '1 moved']);
    expect(byDepartment.get('farm')!.changes!.map((c) => c.kind).sort()).toEqual(['moved', 'new', 'resolved']);
  });

  it('never names the transaction behind a change: the line is the item as served, and its basis says a change is not a cause (D-020)', () => {
    const now = reportsWith([farmItem('a', 'attention', 'Arms short at Double-A')]);
    const { summary } = sinceLastExport({
      reports: now, previous: previousWith([['c', 'noted', 'A shortstop idle at Single-A']]), results: { games: null, why: 'noSchedule' }, importStamp: build.importStamp, gameDate: build.gameDate,
    });
    for (const chip of [summary.new, summary.resolved, summary.moved]) {
      for (const it of chip.items) {
        const words = [it.line.text, it.line.hint ?? '', ...it.line.basis.because.map((b) => `${b.label} ${b.value}`)].join(' ');
        expect(words, it.key).not.toMatch(TRANSACTIONS);
        expect(it.line.basis.unknown.join(' ')).toMatch(/not which move or event/);
      }
    }
    expect(summary.resolved.items[0].line.text).toBe('A shortstop idle at Single-A');
  });

  it('resolves nothing, and calls nothing new, for a department not read at one of the two exports: its silence is not evidence (D-018)', () => {
    const unreadNow = sinceLastExport({
      reports: reportsWith('unavailable'), previous: previousWith([['c', 'noted', 'A shortstop idle at Single-A']]), results: { games: null, why: 'noSchedule' },
      importStamp: build.importStamp, gameDate: build.gameDate,
    });
    expect(unreadNow.summary.resolved.count).toBe(0);
    expect(unreadNow.byDepartment.get('farm')).toMatchObject({ changes: null });
    expect(unreadNow.byDepartment.get('farm')!.note!.display).toMatch(/wasn't read at one of the two exports/);
    const unreadBefore = sinceLastExport({
      reports: reportsWith([farmItem('a', 'attention', 'Arms short at Double-A')]), previous: previousWith([], 'unavailable'), results: { games: null, why: 'noSchedule' },
      importStamp: build.importStamp, gameDate: build.gameDate,
    });
    expect(unreadBefore.summary.new.count).toBe(0);
  });

  it('says a department with no change changed nothing, as a count against the last export, never as no comparison', () => {
    const same = sinceLastExport({
      reports: reportsWith([farmItem('a', 'attention', 'Arms short at Double-A')]), previous: previousWith([['a', 'attention', 'Arms short at Double-A']]),
      results: { games: [], how: 'count' }, importStamp: build.importStamp, gameDate: build.gameDate,
    });
    expect(same.summary.new).toMatchObject({ count: 0, text: 'Nothing new' });
    expect(same.byDepartment.get('farm')).toMatchObject({ changes: [] });
    expect(same.byDepartment.get('farm')!.note!.display).toBe('Nothing changed since the export of July 1, 2040');
    expect(same.summary.results.text).toBe('No games since July 1, 2040');
  });

  it('counts the club\'s games between the two exports as the schedule records them', () => {
    const games = [
      { gameId: 1, date: '2040-7-1', scored: 5, allowed: 2, home: true, opponent: 'Club 2 N' },
      { gameId: 2, date: '2040-7-2', scored: 1, allowed: 3, home: false, opponent: 'Club 3 N' },
    ];
    const { summary } = sinceLastExport({
      reports: reportsWith([]), previous: previousWith([]), results: { games, how: 'count' }, importStamp: build.importStamp, gameDate: build.gameDate,
    });
    expect(summary.results.text).toBe('1–1 since July 1, 2040');
    expect(summary.results.items.map((i) => i.line.text)).toEqual(['W 5–2 vs Club 2 N', 'L 3–1 at Club 3 N']);
  });

  it('says why the results aren\'t known: no schedule, no day at the last export, or a season that couldn\'t be read (L9)', () => {
    const hint = (why: 'noSchedule' | 'noPreviousDay' | 'noSeason') => sinceLastExport({
      reports: reportsWith([]), previous: previousWith([]), results: { games: null, why }, importStamp: build.importStamp, gameDate: build.gameDate,
    }).summary.results;
    expect(hint('noSchedule')).toMatchObject({ text: 'Results not known', hint: 'The export has no game-by-game schedule' });
    expect(hint('noPreviousDay').hint).toBe('The last export doesn\'t say which day it reflected');
    expect(hint('noSeason').hint).toBe('The club\'s season couldn\'t be read this time');
    const season = (games: null | []) => ({ orgId: 1, season: { gameDate: '2040-7-2', standings: [], games } });
    expect(resultsSince({ orgId: 1, season: null }, { importStamp: 'x', gameDate: '2040-7-1' })).toEqual({ games: null, why: 'noSeason' });
    expect(resultsSince(season(null), { importStamp: 'x', gameDate: '2040-7-1' })).toEqual({ games: null, why: 'noSchedule' });
    expect(resultsSince(season([]), { importStamp: 'x', gameDate: null })).toEqual({ games: null, why: 'noPreviousDay' });
  });
});

describe('the snapshots behind it, per save and per import (D-058, D-064)', () => {
  let save: BuiltSave;
  const heard: ServerEvent[] = [];
  let stop = (): void => {};
  const realStamp = importedAt.value;

  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    stop = subscribe((e) => heard.push(e));
  });
  afterAll(() => {
    stop();
    importedAt.value = realStamp;
  });
  beforeEach(() => {
    for (const t of ['report_snapshot_imports', 'report_snapshots', 'report_snapshot_figures', 'standings_snapshots', 'desk_items']) historyDb.exec(`DELETE FROM ${t}`);
    forgetHistoryKey();
    forgetMemoryCaches();
    resetFrontOfficeCache();
    resetAttention();
    heard.length = 0;
  });

  it('with no earlier export of this save says there is nothing to compare, in a sentence, never an empty list', async () => {
    importedAt.value = '2040-05-01T10:00:00.000Z';
    const summary = await frontOfficeSummaryNow(save.org);
    expect(summary.changes).toBeNull();
    expect(summary.changesNote!.display).toMatch(/first export of this save/);
    const farm = await departmentReportNow(save.org, 'farm');
    expect(farm.changes).toBeNull();
    expect(farm.changesNote!.display).toMatch(/first export/);
  });

  it('records an import once, however often it is recorded, and compares the next import with it', async () => {
    importedAt.value = '2040-05-01T10:00:00.000Z';
    const first = await frontOfficeBuilt(save.org);
    expect(await rememberBuild(first)).toBe(true);
    expect(await rememberBuild(first)).toBe(true);
    expect(reportSnapshotCount(save.org)).toBe(1);
    expect(standingsOf('2040-05-01T10:00:00.000Z')!.rows.length).toBe(save.clubs.length);
    expect(heard.filter((e) => e.type === 'changes-ready')).toHaveLength(1);
    expect(heard.find((e) => e.type === 'changes-ready')).toMatchObject({ title: 'New export read', newToDecide: null });

    // The next import of the same league: compared with the first, nothing changed, said as counts
    importedAt.value = '2040-05-02T10:00:00.000Z';
    resetFrontOfficeCache();
    const summary = await frontOfficeSummaryNow(save.org);
    expect(summary.changes).not.toBeNull();
    expect(summary.changesNote).toBeNull();
    expect(summary.changes!.new.count).toBe(0);
    expect(summary.changes!.resolved.count).toBe(0);
    expect(summary.changes!.previousImport).toBe('2040-05-01T10:00:00.000Z');
    const second = await frontOfficeBuilt(save.org);
    await rememberBuild(second);
    expect(previousReportSnapshot(save.org, '2040-05-02T10:00:00.000Z')!.importStamp).toBe('2040-05-01T10:00:00.000Z');
    expect(previousStandings('2040-05-02T10:00:00.000Z')!.importStamp).toBe('2040-05-01T10:00:00.000Z');
    const ready = heard.filter((e) => e.type === 'changes-ready');
    expect(ready).toHaveLength(2);
    expect(ready[1]).toMatchObject({ text: 'Nothing new on your desk', newToDecide: 0 });
  });

  it('reads an item the last export did not raise as new and one it raised as resolved, never as a transaction', async () => {
    importedAt.value = '2040-05-01T10:00:00.000Z';
    const first = await frontOfficeBuilt(save.org);
    const items = [...first.reports.values()].filter((r) => r.department !== 'frontOffice').flatMap((r) => [...r.toDecide.items, ...r.watching.items]);
    expect(items.length).toBeGreaterThan(1);
    // The last export raised one item this one doesn't, and not one this one does
    const [dropped, ...kept] = items;
    await recordReportSnapshot({
      orgId: save.org, importStamp: '2040-04-30T10:00:00.000Z', gameDate: '2040-4-30',
      departments: { majorLeague: 'ready', farm: 'ready', finance: 'ready', medical: 'ready' },
      items: [...kept.map((it) => ({ key: it.key, department: it.department, severity: it.neutralSeverity, headline: it.headline.text, count: 1 })),
        { key: 'medical:injury:424242', department: 'medical', severity: 'noted', headline: 'P 9 is on the injured list', count: 1 }],
      figures: [],
    });
    const summary = await frontOfficeSummaryNow(save.org);
    expect(summary.changes!.new.items.map((i) => i.key)).toEqual([dropped.key]);
    expect(summary.changes!.resolved.items.map((i) => i.key)).toEqual(['medical:injury:424242']);
    expect(collectShown(summary.changes).join(' ')).not.toMatch(TRANSACTIONS);
  });

  it('keeps each save\'s snapshots apart: another save\'s history key never supplies the comparison (D-064)', async () => {
    await recordReportSnapshot({
      orgId: save.org, importStamp: 'another-save-import', gameDate: '2040-4-1', departments: { farm: 'ready' },
      items: [{ key: 'farm:x', department: 'farm', severity: 'noted', headline: 'x', count: 1 }], figures: [],
    });
    historyDb.prepare(`UPDATE report_snapshot_imports SET save_key = 'save-another-folder' WHERE import_stamp = 'another-save-import'`).run();
    importedAt.value = '2040-05-01T10:00:00.000Z';
    expect(previousReportSnapshot(save.org, importedAt.value)).toBeNull();
    expect((await frontOfficeSummaryNow(save.org)).changes).toBeNull();
    expect(reportSnapshotOf(save.org, 'another-save-import')).toBeNull();
  });

  it('counts the results from the standings kept at the import it compares with, never a later one (M4)', async () => {
    const row = (w: number, l: number): StandingsRow => ({
      teamId: save.org, name: 'Us', abbr: 'US', leagueId: save.leagueId, subLeagueId: 0, divisionId: 0, division: 'East', w, l, t: 0, pos: 1,
      divisionClubs: 4, gb: 0, runsScored: 1, runsAllowed: 1,
    });
    // The export compared with (A) had played 10; a later import (B) whose report wasn't kept had played 20
    await recordStandingsSnapshot('A', '2040-5-1', [row(6, 4)]);
    await recordStandingsSnapshot('B', '2040-5-11', [row(12, 8)]);
    const games = Array.from({ length: 30 }, (_, i) => ({ gameId: i + 1, date: `2040-5-${i + 1}`, scored: 1, allowed: 0, home: true, opponent: 'Them' }));
    const results = resultsSince({ orgId: save.org, season: { gameDate: '2040-5-30', standings: [], games } }, { importStamp: 'A', gameDate: '2040-5-1' });
    expect(results).toMatchObject({ how: 'count' });
    expect(results.games!.map((g) => g.gameId)).toEqual(games.slice(10).map((g) => g.gameId));
  });

  /** Forgets the backup made, so the next write makes one (the test's own scratch data folder). */
  const forgetBackup = () => {
    historyDb.prepare(`DELETE FROM history_identity_meta WHERE key = 'remembering_backup'`).run();
    if (fs.existsSync(BACKUP_DIR)) for (const f of fs.readdirSync(BACKUP_DIR)) if (f.startsWith('history-before-remembering-')) fs.rmSync(path.join(BACKUP_DIR, f));
  };

  it('copies history.db into backups/ once, before the first row is remembered (L10)', async () => {
    forgetBackup();
    allowMemoryBackupRetry();
    importedAt.value = '2040-05-01T10:00:00.000Z';
    await recordReportSnapshot({ orgId: save.org, importStamp: importedAt.value, gameDate: '2040-5-1', departments: { farm: 'ready' }, items: [], figures: [] });
    const file = memoryBackupPath();
    expect(file).toMatch(/backups\/history-before-remembering-.*\.db$/);
    expect(fs.existsSync(file!)).toBe(true);
    // Taken before the first row: the backup holds no remembered import (its tables, created empty, at most)
    const copy = new Database(file!, { readonly: true });
    try {
      const has = copy.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'report_snapshot_imports'`).get() as { n: number };
      expect(has.n ? (copy.prepare(`SELECT COUNT(*) AS n FROM report_snapshot_imports`).get() as { n: number }).n : 0).toBe(0);
    } finally {
      copy.close();
    }
    expect(reportSnapshotCount(save.org)).toBe(1);
    // Once: the next write makes no second copy
    await recordReportSnapshot({ orgId: save.org, importStamp: '2040-05-02T10:00:00.000Z', gameDate: '2040-5-2', departments: { farm: 'ready' }, items: [], figures: [] });
    expect(fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('history-before-remembering-') && f.endsWith('.db'))).toEqual([path.basename(file!)]);
  });

  it('tries a failed backup again at most once per start or import, never on every write (L2)', async () => {
    forgetBackup();
    allowMemoryBackupRetry();
    const backup = vi.spyOn(historyDb, 'backup').mockRejectedValue(new Error('disk full'));
    try {
      await ensureMemoryBackup();
      await ensureMemoryBackup();
      await recordStandingsSnapshot('2040-05-01T10:00:00.000Z', '2040-5-1', [{
        teamId: save.org, name: 'Us', abbr: 'US', leagueId: save.leagueId, subLeagueId: 0, divisionId: 0, division: 'East', w: 1, l: 0, t: 0, pos: 1,
        divisionClubs: 4, gb: 0, runsScored: 1, runsAllowed: 0,
      }]);
      expect(backup).toHaveBeenCalledTimes(1);
      expect(memoryBackupState.failed).toBe('disk full');
      // The next import may try once more
      allowMemoryBackupRetry();
      await ensureMemoryBackup();
      await ensureMemoryBackup();
      expect(backup).toHaveBeenCalledTimes(2);
    } finally {
      backup.mockRestore();
      forgetBackup();
      allowMemoryBackupRetry();
      await ensureMemoryBackup();
    }
    expect(memoryBackupPath()).not.toBeNull();
  });
});
