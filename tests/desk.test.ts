import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { historyDb } from '../server/history.js';
import { forgetHistoryKey } from '../server/historyIdentity.js';
import { deskRecords, forgetMemoryCaches, resolveDeskRecords, setDeskRecord } from '../server/frontOfficeMemory.js';
import { DeskRefusal, departmentReportNow, deskViewNow, frontOfficeSummaryNow, rememberBuild, resetAttention, setDeskStatus } from '../server/frontOfficeAttention.js';
import { frontOfficeBuilt, frontOfficeStats, frontOfficeSummary, invalidateFrontOffice, keptFrontOffice, resetFrontOfficeCache, type FrontOfficeBuilt } from '../server/frontOfficeService.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { subscribe, type ServerEvent } from '../server/serverEvents.js';
import { attentionOf, onLeadList } from '../server/presentation/frontOffice/attention.js';
import type { FoItem } from '../server/presentation/frontOffice/types.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The GM's desk (BEHAVIOR_CASES.md "Pennant for Mac", `desk.test.ts`, case 15; D-058): a status records his attention
 * and changes nothing else, and nothing is written to OOTP.
 */

const record = (over: Partial<Parameters<typeof attentionOf>[0] & object>) => ({
  status: 'open' as const, until: null, note: null, since: '2040-05-01T10:00:00.000Z', sinceText: 'May 1, 2040, 10:00 AM', setImport: 'i1', ...over,
});

describe('an item\'s status in words', () => {
  it('reads each status plainly, a deferral ending on its game date, and a handled item the export still shows as still shown', () => {
    expect(attentionOf(null, '2040-5-6', 'i1')).toMatchObject({ status: 'open', line: { display: 'Open' }, since: null });
    expect(attentionOf(record({ status: 'reviewed' }), '2040-5-6', 'i1').line.display).toBe('Reviewed');
    const ahead = attentionOf(record({ status: 'deferred', until: '2040-5-20' }), '2040-5-6', 'i1');
    expect(ahead).toMatchObject({ deferralEnded: false, line: { display: 'Deferred until May 20, 2040' } });
    expect(onLeadList(ahead)).toBe(false);
    // Unpadded dates compared as dates: May 10 is after May 9, whatever the strings sort as
    const ended = attentionOf(record({ status: 'deferred', until: '2040-5-9' }), '2040-5-10', 'i1');
    expect(ended.deferralEnded).toBe(true);
    expect(onLeadList(ended)).toBe(true);
    expect(attentionOf(record({ status: 'deferred', until: '2040-5-10' }), '2040-5-9', 'i1').deferralEnded).toBe(false);
    expect(attentionOf(record({ status: 'handled', setImport: 'i1' }), '2040-5-6', 'i1').stillShown).toBeNull();
    expect(attentionOf(record({ status: 'handled', setImport: 'i1' }), '2040-5-6', 'i2').stillShown!.display).toBe('The latest export still shows it');
  });
});

describe('a desk status records attention and changes nothing else (case 15)', () => {
  let save: BuiltSave;
  let key = '';
  const heard: ServerEvent[] = [];
  let stop = (): void => {};
  const realStamp = importedAt.value;

  beforeAll(async () => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    stop = subscribe((e) => heard.push(e));
  });
  afterAll(() => {
    stop();
    importedAt.value = realStamp;
  });
  beforeEach(async () => {
    for (const t of ['report_snapshot_imports', 'report_snapshots', 'standings_snapshots', 'desk_items']) historyDb.exec(`DELETE FROM ${t}`);
    forgetHistoryKey();
    forgetMemoryCaches();
    resetFrontOfficeCache();
    resetAttention();
    heard.length = 0;
    importedAt.value = '2040-05-01T10:00:00.000Z';
    key = (await deskViewNow(save.org)).desk.items[0]?.key ?? '';
  });

  const itemIn = (items: readonly FoItem[], k: string) => items.find((it) => it.key === k);

  it('leaves the item\'s severity, its department\'s counts and order, and the specialist\'s answer as they were', async () => {
    expect(key).not.toBe('');
    const before = await frontOfficeSummaryNow(save.org);
    const plain = await frontOfficeSummary(save.org);
    const dept = before.desk.items.find((it) => it.key === key)!.department;
    const reportBefore = await departmentReportNow(save.org, dept);
    await setDeskStatus(save.org, { key, status: 'handled' });
    const after = await frontOfficeSummaryNow(save.org);
    const reportAfter = await departmentReportNow(save.org, dept);
    // The department's own answer: the same items, severities and order, and the same counts on its card
    const strip = (items: readonly FoItem[]) => items.map(({ attention: _a, ...rest }) => rest);
    expect(strip(reportAfter.toDecide.items)).toEqual(strip(reportBefore.toDecide.items));
    expect(after.departments.map((c) => [c.department, c.toDecide, c.watching])).toEqual(before.departments.map((c) => [c.department, c.toDecide, c.watching]));
    const marked = itemIn(reportAfter.toDecide.items, key)!;
    expect(marked.attention.status).toBe('handled');
    expect(marked.severity).toBe(itemIn(reportBefore.toDecide.items, key)!.severity);
    expect(marked.neutralSeverity).toBe(itemIn(reportBefore.toDecide.items, key)!.neutralSeverity);
    // The build the Front Office keeps is never touched
    expect(itemIn((await frontOfficeSummary(save.org)).desk.items, key)!.attention.status).toBe('open');
    expect(plain.desk.items.length).toBe(before.desk.items.length);
  });

  it('takes a reviewed, handled or deferred item off the lead list with a served count, one click away', async () => {
    const change = await setDeskStatus(save.org, { key, status: 'reviewed', note: 'Talked to the manager' });
    expect(change.done.display).toBe('Marked reviewed');
    expect(change.view.desk.items.some((it) => it.key === key)).toBe(false);
    expect(change.view.desk.setAside).toMatchObject({ reviewed: 1, deferred: 0, handled: 0, line: { display: '1 reviewed' } });
    expect(change.view.desk.setAside!.items[0]).toMatchObject({ key, attention: { status: 'reviewed', note: 'Talked to the manager' } });
    expect(heard.filter((e) => e.type === 'desk-changed')).toHaveLength(1);
  });

  it('answers every change with the status it replaced, so one step undoes it', async () => {
    await setDeskStatus(save.org, { key, status: 'reviewed', note: 'First look' });
    const handled = await setDeskStatus(save.org, { key, status: 'handled' });
    expect(handled.previous.status).toBe('reviewed');
    expect(handled.undo).toEqual({ key, status: 'reviewed', until: null, note: 'First look', restore: true });
    const undone = await setDeskStatus(save.org, handled.undo);
    expect(undone.attention).toMatchObject({ status: 'reviewed', note: 'First look' });
    const back = await setDeskStatus(save.org, { key, status: 'open' });
    expect(back.done.display).toBe('Back on your desk');
    expect(back.view.desk.items.some((it) => it.key === key)).toBe(true);
  });

  it('serves the days a deferral can run to, from the league\'s day, and how many items are open (N7, Stage B)', async () => {
    const view = await deskViewNow(save.org);
    const today = (await frontOfficeSummaryNow(save.org)).teamSeason!.kicker;
    expect(today).toBeTruthy();
    expect(view.desk.deferChoices.map((c) => c.text.display.split(' · ')[0])).toEqual(['Tomorrow', 'A week', 'Two weeks', 'A month']);
    // Written as OOTP writes a date, and each one accepted as a deferral
    for (const choice of view.desk.deferChoices) expect(choice.until).toMatch(/^\d{4}-[1-9]\d?-[1-9]\d?$/);
    const openBefore = view.desk.openCount;
    expect(openBefore).toBe(view.desk.items.length + view.desk.more.reduce((n, m) => n + m.count, 0));
    const deferred = await setDeskStatus(save.org, { key, status: 'deferred', until: view.desk.deferChoices[1].until });
    expect(deferred.view!.desk.openCount).toBe(openBefore - 1);
    expect(deferred.view!.desk.setAside!.deferred).toBe(1);
  });

  it('serves no day to defer to when the league\'s day isn\'t known: a date is never guessed', async () => {
    const { deferChoices } = await import('../server/presentation/frontOffice/attention.js');
    expect(deferChoices(null)).toEqual([]);
    expect(deferChoices('2040-12-31').map((c) => c.until)).toEqual(['2041-1-1', '2041-1-7', '2041-1-14', '2041-1-30']);
  });

  it('defers only to a day after the league\'s day, and refuses an item this export doesn\'t raise, in sentences', async () => {
    await expect(setDeskStatus(save.org, { key, status: 'deferred', until: '2000-1-1' })).rejects.toThrow(DeskRefusal);
    await expect(setDeskStatus(save.org, { key, status: 'deferred' })).rejects.toThrow('Choose the day to defer it to.');
    await expect(setDeskStatus(save.org, { key: 'majorLeague:nothing', status: 'reviewed' })).rejects.toThrow(/isn't in this export's reports/);
    await expect(setDeskStatus(save.org, { key, status: 'done' })).rejects.toThrow(/Choose open, reviewed, deferred or handled/);
    const deferred = await setDeskStatus(save.org, { key, status: 'deferred', until: '2040-12-1' });
    expect(deferred.done.display).toBe('Deferred until December 1, 2040');
    expect(deferred.view.desk.setAside!.deferred).toBe(1);
  });

  // H1 (N7 review): an item whose deferral has ended keeps `deferred` with a day the league has passed
  const deferralEnded = async () => {
    await frontOfficeBuilt(save.org);
    await setDeskRecord(save.org, key, { status: 'deferred', until: '2000-1-1', note: 'Wait for the trade deadline' }, importedAt.value);
    const item = (await deskViewNow(save.org)).desk.items.find((it) => it.key === key)!;
    expect(item.attention).toMatchObject({ status: 'deferred', until: '2000-1-1', deferralEnded: true });
  };

  it('undoes a change made on an item whose deferral has ended, putting the record back exactly (H1)', async () => {
    await deferralEnded();
    const before = deskRecords(save.org).get(key)!;
    const reviewed = await setDeskStatus(save.org, { key, status: 'reviewed' });
    expect(reviewed.undo).toEqual({ key, status: 'deferred', until: '2000-1-1', note: 'Wait for the trade deadline', restore: true });
    const undone = await setDeskStatus(save.org, reviewed.undo);
    expect(undone.attention).toMatchObject({ status: 'deferred', until: '2000-1-1', deferralEnded: true, note: 'Wait for the trade deadline' });
    expect(undone.done.display).toBe('Deferral ended January 1, 2000');
    // Exactly as it was: when it was set and under which import too
    expect(deskRecords(save.org).get(key)).toEqual(before);
    // And the redo it serves puts the review back the same way
    const redone = await setDeskStatus(save.org, undone.undo);
    expect(redone.attention.status).toBe('reviewed');
    // A plain deferral to a passed day is still refused
    await expect(setDeskStatus(save.org, { key, status: 'deferred', until: '2000-1-1' })).rejects.toThrow(/Choose a day after the league's day/);
  });

  it('saves a note on an item whose deferral has ended, keeping the day recorded, and undoes it (H1)', async () => {
    await deferralEnded();
    const noted = await setDeskStatus(save.org, { key, status: 'deferred', note: 'Ask again after the break' });
    expect(noted.done.display).toBe('Note saved');
    expect(noted.attention).toMatchObject({ status: 'deferred', until: '2000-1-1', note: 'Ask again after the break' });
    // The day recorded may be sent back as it is, too
    const again = await setDeskStatus(save.org, { key, status: 'deferred', until: '2000-1-1', note: 'Ask after the break' });
    expect(again.attention.note).toBe('Ask after the break');
    const undone = await setDeskStatus(save.org, again.undo);
    expect(undone.attention).toMatchObject({ status: 'deferred', until: '2000-1-1', note: 'Ask again after the break' });
    // A note-only change to an item that isn't deferred still needs its day
    await setDeskStatus(save.org, { key, status: 'open' });
    await expect(setDeskStatus(save.org, { key, status: 'deferred', note: 'x' })).rejects.toThrow('Choose the day to defer it to.');
  });

  it('undoes a change whose deferral\'s day the league reached before the undo (H1)', async () => {
    const view = await deskViewNow(save.org);
    const day = view.desk.deferChoices[0].until;
    await setDeskStatus(save.org, { key, status: 'deferred', until: day });
    const reviewed = await setDeskStatus(save.org, { key, status: 'reviewed' });
    // The league reaches the day (the kept build's own day moves on)
    const built = keptFrontOffice(save.org)!;
    (built.season as { gameDate: string }).gameDate = day;
    const undone = await setDeskStatus(save.org, reviewed.undo);
    expect(undone.attention).toMatchObject({ status: 'deferred', until: day, deferralEnded: true });
  });

  it('marks an item handled in OOTP without asserting anything happened: the next export that still raises it says so', async () => {
    await setDeskStatus(save.org, { key, status: 'handled' });
    importedAt.value = '2040-05-02T10:00:00.000Z';
    resetFrontOfficeCache();
    const report = await deskViewNow(save.org);
    const it = report.desk.setAside!.items.find((i) => i.key === key)!;
    expect(it.attention.stillShown!.display).toBe('The latest export still shows it');
  });

  it('resolves a status whose item the next export no longer raises; the item coming back is new and inherits nothing', async () => {
    await setDeskStatus(save.org, { key, status: 'reviewed' });
    const dept = key.split(':')[0];
    // An export whose department was read and did not raise it
    expect(await resolveDeskRecords(save.org, new Set(), new Set([dept]), 'i-next')).toBe(1);
    expect(deskRecords(save.org).has(key)).toBe(false);
    forgetMemoryCaches();
    const again = await deskViewNow(save.org);
    expect(again.desk.items.find((i) => i.key === key)!.attention.status).toBe('open');
  });

  it('resolves nothing for a department that could not be read: its silence is not evidence', async () => {
    await setDeskStatus(save.org, { key, status: 'reviewed' });
    expect(await resolveDeskRecords(save.org, new Set(), new Set(['somethingElse']), 'i-next')).toBe(0);
    expect(deskRecords(save.org).get(key)!.status).toBe('reviewed');
  });

  /** The same build with one item no longer raised (as a refit or a settings change can leave it within one export). */
  const without = (built: FrontOfficeBuilt, k: string): FrontOfficeBuilt => ({
    ...built,
    reports: new Map([...built.reports].map(([d, r]) => [d, {
      ...r,
      toDecide: { ...r.toDecide, items: r.toDecide.items.filter((it) => it.key !== k) },
      watching: { ...r.watching, items: r.watching.items.filter((it) => it.key !== k) },
    }])),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('resolves statuses only on the first remembered build of a new import, never on a rebuild of the same one (M1)', async () => {
    const built = await frontOfficeBuilt(save.org);
    await settle();
    await rememberBuild(built);
    await setDeskStatus(save.org, { key, status: 'reviewed' });
    // A later build of the same import that no longer raises the item (a refit, a settings change, a copy of the log)
    expect(await rememberBuild(without(built, key))).toBe(true);
    expect(deskRecords(save.org).get(key)?.status).toBe('reviewed');

    // The next import's first remembered build that no longer raises it resolves it
    importedAt.value = '2040-05-02T10:00:00.000Z';
    resetFrontOfficeCache();
    const next = await frontOfficeBuilt(save.org);
    expect(await rememberBuild(without(next, key))).toBe(true);
    expect(deskRecords(save.org).has(key)).toBe(false);
  });

  it('leaves a status set during this very import alone when it resolves (M1)', async () => {
    const dept = key.split(':')[0];
    await setDeskRecord(save.org, key, { status: 'reviewed', until: null }, 'i-next');
    expect(await resolveDeskRecords(save.org, new Set(), new Set([dept]), 'i-next')).toBe(0);
    expect(deskRecords(save.org).get(key)!.status).toBe('reviewed');
  });

  it('marks an item without ever building the Front Office: checked against the kept build, else this import\'s last desk (L5)', async () => {
    const built = await frontOfficeBuilt(save.org);
    await settle();
    await rememberBuild(built);
    // The kept build is dropped (a new copy of the log, a refit): the change is checked against what this import served
    invalidateFrontOffice();
    const builds = frontOfficeStats().builds;
    const change = await setDeskStatus(save.org, { key, status: 'reviewed' });
    expect(change.attention.status).toBe('reviewed');
    expect(change.view).toBeNull();
    expect(heard.filter((e) => e.type === 'desk-changed').at(-1)).toMatchObject({ key });
    await expect(setDeskStatus(save.org, { key: 'majorLeague:nothing', status: 'reviewed' })).rejects.toThrow(/isn't in this export's reports/);
    expect(frontOfficeStats().builds).toBe(builds);

    // A new import with neither a kept build nor a desk served yet: refused in a sentence, and nothing is built
    importedAt.value = '2040-05-03T10:00:00.000Z';
    invalidateFrontOffice();
    await expect(setDeskStatus(save.org, { key, status: 'handled' })).rejects.toThrow('Pennant is still reading this export\'s desk. Mark it again in a moment.');
    expect(frontOfficeStats().builds).toBe(builds);
  });
});
