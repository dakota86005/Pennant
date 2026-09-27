import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { api } from '../server/api.js';
import { computeContracts } from '../server/contracts.js';
import { DATA_DIR } from '../server/config.js';
import { db, swapInLeagueDatabase } from '../server/db.js';
import { orgInjuries } from '../server/dashboard.js';
import { computeFarmSystem } from '../server/farmOperations.js';
import {
  FrontOfficeRefusal, NO_CLUB, UNKNOWN_CLAIM, UNKNOWN_CLUB, UNKNOWN_DEPARTMENT, claimTrail, currentReportStamp, departmentReport, frontOfficeStats,
  frontOfficeSummary, invalidateFrontOffice, resetFrontOfficeCache, resolveOrg, warmFrontOffice,
} from '../server/frontOfficeService.js';
import { mlbOverview } from '../server/mlbOperations.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { subscribe } from '../server/serverEvents.js';
import { servedDepartments, departmentOffice } from '../server/presentation/catalog.js';
import { assertAuthored, basis, claim } from '../server/presentation/claim.js';
import {
  DESK_SHARE, REPORTING, assemble, deskOrder, item, type BuildContext, type DepartmentAnswer, type DepartmentContext,
} from '../server/presentation/frontOffice/desk.js';
import { majorLeagueMaterial, type MajorLeagueInput } from '../server/presentation/frontOffice/majorLeague.js';
import { medicalMaterial } from '../server/presentation/frontOffice/medical.js';
import type { FoItem } from '../server/presentation/frontOffice/types.js';
import { farmSeverity, medicalSeverity, mlbSeverity, rankOf } from '../server/presentation/severity.js';
import { computeRosterCrunchIssues } from '../server/rosterops.js';
import { recordCalibrationRefits } from '../server/saveCalibration.js';
import { buildSave, dropTable, exec, type BuiltSave } from './syntheticSave';

/**
 * The Front Office (BEHAVIOR_CASES.md "Pennant for Mac", `frontOffice.test.ts`; V2 plan section 4.4 and cases 9 to 12):
 * it gathers what the departments said and decides nothing. Built from the synthetic save through the real specialists,
 * and from synthetic answers through the pure adapters.
 */

const MLB_RANK = { watch: 1, elevated: 2, critical: 3 } as const;

const build: BuildContext = { orgId: 1, club: 'Test Club', importStamp: '2040-07-01T12:00:00.000Z', reportStamp: 'r1', gameDate: '2040-7-1' };
const departments = () => servedDepartments(null);
const ctxOf = (id: Parameters<typeof departmentOffice>[0]): DepartmentContext => ({
  build, department: departments().find((d) => d.id === id)!, office: departmentOffice(id),
});

/** A Major League Ops need, as `mlbOverview` serves one (only the fields the adapter reads). */
function need(over: Record<string, unknown>) {
  return {
    id: 'mlb:role_holder_review:7', kind: 'role_holder_review', origin: 'observed', role: { kind: 'starting_pitcher', label: 'starting pitcher', position: 1 },
    title: 'x', summary: 'x', severity: 'watch', urgency: { label: 'Review', days: null },
    horizon: { kind: 'unknown', days: null, basis: 'x' }, causes: [], facts: [{ label: 'Tools', value: '31st' }],
    unknowns: ['His visible tool ratings are incomplete.'], returning: null, subject: { playerId: 7, name: 'Sam Arm' },
    ...over,
  } as never;
}

const overview = (needs: unknown[]): MajorLeagueInput['overview'] => ({
  needs: needs as never,
  roster: { active: { count: 26, limit: 26 }, fortyMan: { count: 40, limit: 40 }, injuredList: 1 },
  unknowns: [],
  yardsticks: { line: 'The starting values', tip: 'x', groups: [], longMan: 'x' },
});

const answers = (over: Partial<Record<string, DepartmentAnswer>>) => ({
  majorLeague: { status: 'available', items: [{ specialist: 'x', items: [], figures: [], unknowns: [] }] },
  farm: { status: 'available', items: [{ specialist: 'x', items: [], figures: [], unknowns: [] }] },
  finance: { status: 'available', items: [{ specialist: 'x', items: [], figures: [], unknowns: [] }] },
  medical: { status: 'available', items: [{ specialist: 'x', items: [], figures: [], unknowns: [] }] },
  ...over,
}) as never;

const NO_CRUNCH: MajorLeagueInput['fortyMan'] = { ok: false, status: 400, error: 'No roster data imported yet' };

describe('an adapter never raises its specialist\'s severity (case 9)', () => {
  it('keeps each Major League Ops need at or below the severity the department gave it, with the philosophy-free severity beside it', () => {
    const needs = (['critical', 'elevated', 'watch'] as const).map((severity, i) => need({ id: `mlb:role_holder_review:${i + 1}`, severity }));
    const material = majorLeagueMaterial(ctxOf('majorLeague'), { overview: overview(needs), fortyMan: NO_CRUNCH });
    expect(material.items.map((it) => it.severity)).toEqual(['critical', 'attention', 'noted']);
    for (const [i, it] of material.items.entries()) {
      expect(rankOf(it.severity)).toBeLessThanOrEqual(MLB_RANK[(['critical', 'elevated', 'watch'] as const)[i]]);
      expect(it.neutralSeverity).toBe(it.severity);
      expect(it.urgency.basis.lean).toBeNull();
    }
  });

  it('places a shaded flag by its plain reading, and states the lean beside it', () => {
    const reason = { dimension: 'competitiveWindow', value: 70, effect: 'raises', text: 'A club pushing to win now cannot carry a soft spot.' };
    const shaded = need({
      severity: 'elevated',
      explanation: { neutralSeverity: 'watch', wouldChange: ['A month of results.'], context: { changed: [reason], notChanged: [] } },
      shading: [reason],
    });
    const [it] = majorLeagueMaterial(ctxOf('majorLeague'), { overview: overview([shaded]), fortyMan: NO_CRUNCH }).items;
    expect(it).toMatchObject({ severity: 'attention', neutralSeverity: 'noted' });
    expect(it.urgency.text).toBe('Noted');
    expect(it.urgency.basis.lean).toEqual({ neutral: 'With no philosophy and no season to weigh: noted', why: [reason.text] });
    expect(it.urgency.hint).toBe('Your club\'s situation would read it as needs attention');
    expect(it.headline.basis.wouldChange).toEqual(['A month of results.']);
  });

  it('serves the roster counts against their limits as a count of a whole, and the injured list as a plain count', () => {
    const { figures } = majorLeagueMaterial(ctxOf('majorLeague'), { overview: overview([]), fortyMan: NO_CRUNCH });
    expect(figures.map((f) => f.value)).toEqual([
      { n: 26, unit: 'count', display: '26 of 26', whole: 26 },
      { n: 40, unit: 'count', display: '40 of 40', whole: 40 },
      { n: 1, unit: 'count', display: '1' },
    ]);
  });

  it('states no lean when only the role\'s usage moved a flag (usage is part of the plain reading)', () => {
    const usage = { dimension: 'usage', value: null, effect: 'raises', text: 'He is used in high-leverage spots.' };
    const flag = need({ severity: 'elevated', explanation: { neutralSeverity: 'elevated', wouldChange: [], context: { changed: [usage], notChanged: [] } }, shading: [usage] });
    const [it] = majorLeagueMaterial(ctxOf('majorLeague'), { overview: overview([flag]), fortyMan: NO_CRUNCH }).items;
    expect(it.urgency.basis.lean).toBeNull();
    expect(it.urgency.hint).toBeUndefined();
  });

  it('holds every item the synthetic save puts on the desk to its department\'s own code', async () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, minors: true });
    resetFrontOfficeCache();
    const mlb = mlbOverview(save.org);
    const farm = computeFarmSystem(save.org);
    const all = await departmentReport(save.org, 'frontOffice');
    for (const it of [...all.toDecide.items, ...all.watching.items]) {
      if (it.key.startsWith('majorLeague:need:')) {
        const n = mlb.needs.find((x) => `majorLeague:need:${x.id}` === it.key)!;
        expect(rankOf(it.severity)).toBeLessThanOrEqual(MLB_RANK[n.severity]);
        expect(it.severity).toBe(mlbSeverity(n).severity);
        expect(rankOf(it.neutralSeverity)).toBeLessThanOrEqual(MLB_RANK[n.explanation?.neutralSeverity ?? n.severity]);
      } else if (it.department === 'farm') {
        // A row stands for one or more of the farm's own items (the grouping rule), all at the row's severity
        const own = farm.attention.filter((a) => a.severity === it.severity);
        expect(own.length).toBeGreaterThanOrEqual(it.count);
        expect(it.severity).toBe(farmSeverity(own[0]).severity);
      }
    }
    expect(all.toDecide.items.length + all.watching.items.length).toBeGreaterThan(0);
  });
});

describe('a report counts what its own workspace lists (case 10)', () => {
  let save: BuiltSave;
  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, minors: true });
    // A player designated for assignment, one on waivers and two injured: the 40-man's clocks and the injury report
    const mine = (db.prepare('SELECT p.player_id AS id FROM players p JOIN players_roster_status rs ON rs.player_id = p.player_id WHERE p.team_id = ? AND rs.is_active = 1 ORDER BY p.player_id').all(save.org) as Array<{ id: number }>).map((r) => r.id).slice(0, 4);
    exec(`UPDATE players_roster_status SET designated_for_assignment = 1, days_on_dfa_left = 5, is_active = 0 WHERE player_id = ${mine[0]}`);
    exec(`UPDATE players_roster_status SET is_on_waivers = 1, days_on_waivers_left = 2, is_active = 0 WHERE player_id = ${mine[1]}`);
    exec(`UPDATE players SET injury_is_injured = 1, injury_left = 30 WHERE player_id IN (${mine[2]}, ${mine[3]})`);
    exec(`UPDATE players_roster_status SET is_on_dl = 1, is_active = 0 WHERE player_id IN (${mine[2]}, ${mine[3]})`);
    resetFrontOfficeCache();
  });

  const itemsOf = async (dept: string) => {
    const r = await departmentReport(save.org, dept);
    return [...r.toDecide.items, ...r.watching.items];
  };

  it('Major League Ops: every need the overview lists and every 40-man issue the crunch lists', async () => {
    const crunch = computeRosterCrunchIssues(save.org);
    expect(crunch.ok).toBe(true);
    const issues = crunch.ok ? crunch.body.players.flatMap((p) => p.issues) : [];
    expect(issues.length).toBeGreaterThanOrEqual(2);
    const items = await itemsOf('majorLeague');
    expect(items.length).toBe(mlbOverview(save.org).needs.length + issues.length);
    // A running clock is urgent, with its days left
    const dfa = items.find((it) => it.key.includes(':designated'))!;
    expect(dfa).toMatchObject({ severity: 'critical', dueInDays: 5 });
    expect(dfa.due?.display).toBe('5 days left');
    expect(items.find((it) => it.key.includes(':waivers'))).toMatchObject({ severity: 'critical', dueInDays: 2 });
  });

  it('Farm & Development: every item on the farm\'s attention list, each in exactly one row', async () => {
    const rows = await itemsOf('farm');
    expect(rows.reduce((n, it) => n + it.count, 0)).toBe(computeFarmSystem(save.org).attention.length);
  });

  it('groups the same kind of farm finding about one subject into one row listing the positions (review S-7)', async () => {
    const attention = computeFarmSystem(save.org).attention;
    const rows = await itemsOf('farm');
    // The synthetic farm has several uncovered positions at one affiliate: one row, the positions listed
    const uncovered = attention.filter((a) => a.code === 'position_uncovered');
    expect(uncovered.length).toBeGreaterThan(1);
    const row = rows.find((it) => it.key.startsWith('farm:position_uncovered:'))!;
    expect(row.count).toBe(uncovered.length);
    for (const a of uncovered) expect(row.headline.text).toContain(a.position!);
    expect(row.headline.text).toMatch(/^.+: Nobody on the roster covers .+ or .+\.$/);
    expect(row.headline.basis.because.map((l) => l.label)).toEqual(uncovered.map((a) => a.position));
    // No zero, and no restated detail, in a finding's row
    for (const it of rows) {
      expect(it.headline.text).not.toMatch(/\b0\b|\b1 players\b/);
      if (!/^farm:(assignment|retention):/.test(it.key)) expect(it.detail).toBeNull();
    }
  });

  it('Finance: every contract heading to a decision (leaving, an option, arbitration)', async () => {
    const deciding = computeContracts(save.org).players.filter((p) => ['leaving', 'option', 'arbitration'].includes(p.group));
    expect((await itemsOf('finance')).length).toBe(deciding.length);
  });

  it('Medical: every injured player the injury report lists, less the returns Major League Ops has', async () => {
    const injured = orgInjuries(save.org);
    expect(injured.length).toBeGreaterThanOrEqual(2);
    const returns = mlbOverview(save.org).needs.filter((n) => n.kind === 'il_return_crunch').length;
    expect((await itemsOf('medical')).length).toBe(injured.length - returns);
    const r = await departmentReport(save.org, 'medical');
    expect(r.figures[0].value?.n).toBe(injured.length);
  });

  it('the desk holds exactly the departments\' items to decide, and the cards count what their reports list', async () => {
    const summary = await frontOfficeSummary(save.org);
    const reports = await Promise.all(REPORTING.map((d) => departmentReport(save.org, d)));
    // At most the stated share from each department, the rest counted in its "more" line
    expect(summary.desk.items.map((it) => it.key).sort()).toEqual(reports.flatMap((r) => r.toDecide.items.slice(0, DESK_SHARE).map((it) => it.key)).sort());
    for (const r of reports) {
      const more = summary.desk.more.find((m) => m.department === r.department);
      expect(more?.count ?? 0).toBe(Math.max(0, r.toDecide.items.length - DESK_SHARE));
      if (more) expect(more.line.display).toBe(`And ${more.count} more in ${r.name}`);
    }
    for (const card of summary.departments) {
      const r = reports.find((x) => x.department === card.department)!;
      if (r.status === 'ready') expect([card.toDecide, card.watching]).toEqual([r.toDecide.items.length, r.watching.items.length]);
    }
  });
});

describe('one problem appears once, under its owner (case 11)', () => {
  it('leaves a return Major League Ops has on its desk out of Medical\'s items, and still counts him injured', () => {
    const injuries = [
      { player_id: 11, name: 'Al Back', age: 28, positionName: 'SS', levelName: 'MLB', team: 'X', status: 'IL' as const, daysLeft: 3, dlDaysThisYear: 20 },
      { player_id: 12, name: 'Bo Out', age: 25, positionName: 'P', levelName: 'AAA', team: 'Y', status: 'IL-60' as const, daysLeft: null, dlDaysThisYear: 70 },
    ];
    const m = medicalMaterial(ctxOf('medical'), { injuries: injuries as never, returnsOnMajorLeagueDesk: new Set([11]) });
    expect(m.items.map((it) => it.key)).toEqual(['medical:injury:12']);
    expect(m.figures[0].value?.n).toBe(2);
    expect(m.figures[0].hint).toMatch(/Major League Ops' desk/);
    expect(m.items[0].headline.basis.unknown).toEqual(['The export doesn\'t say when he is due back.']);
  });

  it('never lists one key twice across the whole Front Office', async () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, minors: true });
    resetFrontOfficeCache();
    const all = await departmentReport(save.org, 'frontOffice');
    const keys = [...all.toDecide.items, ...all.watching.items].map((it) => it.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('unavailable is never all clear (case 12)', () => {

  it('says the desk is clear only for the departments reporting, naming those with no report yet (review N-4)', () => {
    const { summary } = assemble(build, departments(), departmentOffice, answers({}));
    expect(summary.desk.empty?.display).toBe('Nothing to decide from the four departments reporting');
    expect(summary.desk.empty?.hint).toBe('Scouting, Trades, League Office and Philosophy & Staff have no report yet');
    expect(summary.desk.incomplete).toBeNull();
  });

  it('gives a card with no report yet no way into a report that does not exist (review S-9)', () => {
    const { summary } = assemble(build, departments(), departmentOffice, answers({}));
    for (const card of summary.departments) expect(card.open === null).toBe(card.status === 'notYet');
  });

  it('gives an unread department a sentence and unknown counts, and says the desk may be missing items', () => {
    const { summary, reports } = assemble(build, departments(), departmentOffice, answers({
      farm: { status: 'unavailable', reason: 'The farm couldn\'t be read this time.' },
    }));
    const farm = summary.departments.find((c) => c.department === 'farm')!;
    expect(farm).toMatchObject({ status: 'unavailable', toDecide: null, watching: null });
    expect(farm.summary).toMatchObject({ text: 'The farm couldn\'t be read this time.', tone: 'unknown' });
    expect(summary.desk.empty).toBeNull();
    expect(summary.desk.incomplete?.display).toBe('Farm & Development couldn\'t be read, so the desk may be missing items');
    const report = reports.get('farm')!;
    expect(report.toDecide.empty).toBeNull();
    expect(report.unknowns.lines.map((l) => l.display)).toEqual(['The farm couldn\'t be read this time.']);
    expect(reports.get('frontOffice')!.figures[0].text).toBe('3 of 8 departments reporting');
    expect(reports.get('frontOffice')!.figures[0].value).toMatchObject({ n: 3, display: '3 of 8', whole: 8 });
  });

  it('says plainly when a department has no report yet, never "nothing to decide"', () => {
    const { summary } = assemble(build, departments(), departmentOffice, answers({}));
    const scouting = summary.departments.find((c) => c.department === 'scouting')!;
    expect(scouting).toMatchObject({ status: 'notYet', toDecide: null, watching: null, top: [] });
    expect(scouting.summary.text).toBe('No scouting report yet.');
  });
});

describe('a department whose export lacks what it reads says so, never all clear (D-018, review S-6)', () => {
  const fresh = () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11 });
    resetFrontOfficeCache();
    return save;
  };

  it('Finance: no contracts in the export is a sentence and unknown counts, not "nothing to decide" and a zero', async () => {
    const save = fresh();
    dropTable('players_contract');
    const r = await departmentReport(save.org, 'finance');
    expect(r).toMatchObject({ status: 'unavailable', figures: [] });
    expect(r.summary.text).toBe('The export has no contracts, so Finance can\'t report on them.');
    const card = (await frontOfficeSummary(save.org)).departments.find((c) => c.department === 'finance')!;
    expect([card.toDecide, card.watching]).toEqual([null, null]);
  });

  it('Finance and Medical: no roster status is one plain sentence each of what is missing', async () => {
    const save = fresh();
    dropTable('players_roster_status');
    expect((await departmentReport(save.org, 'finance')).summary.text).toBe('The export has no roster status, so Finance can\'t tell who is on the roster.');
    expect((await departmentReport(save.org, 'medical')).summary.text).toBe('The export has no roster status, so the injured list can\'t be read.');
    expect((await frontOfficeSummary(save.org)).desk.incomplete?.display).toMatch(/Finance and Medical couldn't be read/);
  });

  it('Finance: a player whose next season is not settled makes the free-agent count a floor, never a total', async () => {
    const save = fresh();
    // One player with no contract row: what happens after this season is not settled from the export
    const one = (db.prepare('SELECT p.player_id AS id FROM players p WHERE p.team_id = ? ORDER BY p.player_id LIMIT 1').get(save.org) as { id: number }).id;
    exec(`DELETE FROM players_contract WHERE player_id = ${one}`);
    const contracts = computeContracts(save.org).players;
    const leaving = contracts.filter((p) => p.group === 'leaving').length;
    const unsettled = contracts.filter((p) => p.group === 'not_settled').length;
    const figure = (await departmentReport(save.org, 'finance')).figures.find((f) => f.text === 'Free agents after this season')!;
    expect(unsettled).toBeGreaterThan(0);
    expect(figure.value?.n).toBeNull();
    expect(figure.value?.display).toBe(leaving > 0 ? `At least ${leaving}` : 'Not known');
    expect(figure.basis.unknown[0]).toMatch(/isn't settled from the export/);
  });
});

describe('the desk\'s order is stated', () => {
  const at = (key: string, severity: 'critical' | 'attention' | 'noted', department: 'majorLeague' | 'farm' | 'medical', due: number | null): FoItem =>
    item(ctxOf(department), {
      key,
      severity: { ...medicalSeverity(), severity, neutral: severity, dueInDays: due },
      shading: [],
      headline: claim({ text: key, tone: 'neutral', basis: basis({ because: [{ label: 'x', value: 'y' }], source: { department, specialist: 'x', asOf: null, gameDate: null }, unknown: [], wouldChange: [], lean: null, certainty: 'fact' }) }),
    });

  it('orders by the severity each department gave, then the nearest deadline, then the sidebar\'s order, then the department\'s own', () => {
    const items = [
      at('farm-noted', 'noted', 'farm', null),
      at('medical-attention', 'attention', 'medical', null),
      at('farm-attention', 'attention', 'farm', null),
      at('mlb-critical-later', 'critical', 'majorLeague', 5),
      at('farm-critical-no-clock', 'critical', 'farm', null),
      at('mlb-critical-soon', 'critical', 'majorLeague', 1),
      at('farm-attention-2', 'attention', 'farm', null),
    ];
    expect(deskOrder(items).map((it) => it.key)).toEqual([
      'mlb-critical-soon', 'mlb-critical-later', 'farm-critical-no-clock', 'farm-attention', 'farm-attention-2', 'medical-attention', 'farm-noted',
    ]);
  });

  it('says how it is ordered', () => {
    const { summary } = assemble(build, departments(), departmentOffice, answers({}));
    expect(summary.desk.order.display).toBe('Most urgent first');
    expect(summary.desk.order.hint).toMatch(/Urgent first, then the nearest deadline/);
  });
});

describe('the cache', () => {
  let save: BuiltSave;
  const realStamp = importedAt.value;
  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11 });
  });
  beforeEach(() => resetFrontOfficeCache());
  afterAll(() => {
    importedAt.value = realStamp;
  });

  it('serves the desk and the reports from the cache after a warm-up, without building again', async () => {
    await warmFrontOffice(save.org);
    expect(frontOfficeStats()).toMatchObject({ builds: 1, hits: 0 });
    await frontOfficeSummary(save.org);
    for (const d of ['majorLeague', 'farm', 'finance', 'medical', 'frontOffice']) await departmentReport(save.org, d);
    expect(frontOfficeStats()).toMatchObject({ builds: 1, hits: 6 });
  });

  it('shares one build between requests that arrive while it runs', async () => {
    await Promise.all([frontOfficeSummary(save.org), departmentReport(save.org, 'farm'), frontOfficeSummary(save.org), warmFrontOffice(save.org)]);
    expect(frontOfficeStats().builds).toBe(1);
  });

  it('never serves an earlier import\'s report as current: a new import stamp builds again, and the payload says which import it read', async () => {
    importedAt.value = '2040-07-01T12:00:00.000Z';
    expect((await frontOfficeSummary(save.org)).importStamp).toBe('2040-07-01T12:00:00.000Z');
    importedAt.value = '2040-07-02T12:00:00.000Z';
    const next = await frontOfficeSummary(save.org);
    expect(next.importStamp).toBe('2040-07-02T12:00:00.000Z');
    expect((await departmentReport(save.org, 'majorLeague')).importStamp).toBe('2040-07-02T12:00:00.000Z');
    expect(frontOfficeStats().builds).toBe(2);
  });

  it('builds again when the settings change (the philosophy, the budget) or a calibration is recorded', async () => {
    await frontOfficeSummary(save.org);
    const file = path.join(DATA_DIR, 'settings.json');
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    try {
      fs.writeFileSync(file, JSON.stringify({ nextSeasonBudget: { [save.org]: 123_000_000 } }));
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5_000));
      await frontOfficeSummary(save.org);
      expect(frontOfficeStats().builds).toBe(2);
    } finally {
      if (before === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, before);
    }
    await frontOfficeSummary(save.org);
    const builds = frontOfficeStats().builds;
    // A refit that recorded nothing changes nothing: no second cold build per import (review S-4)
    recordCalibrationRefits([]);
    await frontOfficeSummary(save.org);
    expect(frontOfficeStats().builds).toBe(builds);
    // A calibration that changed invalidates, and the next request builds
    invalidateFrontOffice();
    await frontOfficeSummary(save.org);
    expect(frontOfficeStats().builds).toBe(builds + 1);
  });

  it('serves each build\'s stamp, the current one on the status, and says when a new build is kept (review S-3)', async () => {
    const heard: unknown[] = [];
    const stop = subscribe((event) => { if (event.type === 'front-office-updated') heard.push(event); });
    try {
      importedAt.value = '2040-07-01T12:00:00.000Z';
      const first = await frontOfficeSummary(save.org);
      expect(first.reportStamp).toMatch(/^r[0-9a-z]+$/);
      expect((await departmentReport(save.org, 'farm')).reportStamp).toBe(first.reportStamp);
      expect(currentReportStamp()).toBe(first.reportStamp);
      expect(heard).toEqual([{ type: 'front-office-updated', orgId: save.org, reportStamp: first.reportStamp }]);
      invalidateFrontOffice();
      expect(currentReportStamp()).toBeNull();
      const second = await frontOfficeSummary(save.org);
      expect(second.reportStamp).not.toBe(first.reportStamp);
      expect(heard).toHaveLength(2);
    } finally {
      stop();
    }
  });

  it('keeps builds while an import builds its own file, and never one read across the swap (N3.5; review S-5)', async () => {
    importedAt.value = '2040-07-01T12:00:00.000Z';
    // The swap an import makes, of a copy of this very league (the served data is the same; the file is another)
    const copy = path.join(DATA_DIR, 'league.copy.db');
    fs.rmSync(copy, { force: true });
    db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
    // An import running (waiting for OOTP, or building its file): nothing served has changed, so the build is kept
    const { importState } = await import('../server/api.js');
    importState.importing = true;
    try {
      await frontOfficeSummary(save.org);
    } finally {
      importState.importing = false;
    }
    expect(frontOfficeStats()).toMatchObject({ builds: 1, cached: 1 });
    await warmFrontOffice(save.org);
    expect(frontOfficeStats().builds).toBe(1);
    // A build that started before a swap and finished after it: its worker may have read either file, so not kept
    invalidateFrontOffice();
    const racing = frontOfficeSummary(save.org);
    swapInLeagueDatabase(copy);
    await racing;
    expect(frontOfficeStats()).toMatchObject({ builds: 2, cached: 0 });
    // After the swap: kept again
    await frontOfficeSummary(save.org);
    expect(frontOfficeStats()).toMatchObject({ builds: 3, cached: 1 });
  });

  it('refuses an unknown department before building anything (review N-1)', async () => {
    await expect(departmentReport(save.org, 'nowhere')).rejects.toThrow(UNKNOWN_DEPARTMENT);
    expect(frontOfficeStats().builds).toBe(0);
  });

  it('keeps at most four builds, oldest dropped first', async () => {
    for (let day = 1; day <= 6; day += 1) {
      importedAt.value = `2040-07-0${day}T12:00:00.000Z`;
      await frontOfficeSummary(save.org);
    }
    expect(frontOfficeStats().cached).toBe(4);
  });

  it('builds an evidence trail on demand, once, and refuses a key it does not know in a sentence', async () => {
    const report = await departmentReport(save.org, 'majorLeague');
    const withTrail = [...report.toDecide.items, ...report.watching.items].find((it) => it.evidence)!;
    expect(withTrail).toBeDefined();
    const trail = await claimTrail(withTrail.evidence!);
    expect(trail.key).toBe(withTrail.evidence);
    expect(trail.headline.text).toBe(withTrail.headline.text);
    assertAuthored(trail);
    await claimTrail(withTrail.evidence!);
    expect(frontOfficeStats()).toMatchObject({ trailBuilds: 1, trailHits: 1 });
    await expect(claimTrail(`${save.org}.majorLeague:need:mlb:nothing`)).rejects.toThrow(UNKNOWN_CLAIM);
    await expect(claimTrail('farm:thing')).rejects.toThrow(UNKNOWN_CLAIM);
  });

  it('never throws from a warm-up, and forgets everything on invalidation', async () => {
    await expect(warmFrontOffice(999_999)).resolves.toBeUndefined();
    await frontOfficeSummary(save.org);
    invalidateFrontOffice();
    expect(frontOfficeStats().cached).toBe(0);
  });
});

describe('the routes', () => {
  let base = '';
  let close = (): void => {};
  let save: BuiltSave;
  beforeAll(async () => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11 });
    resetFrontOfficeCache();
    const app = express();
    app.use(express.json());
    app.use('/api', api);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => {
      server.closeAllConnections();
      server.close();
    };
  });
  afterAll(() => close());

  const get = async (route: string) => {
    const res = await fetch(`${base}${route}`);
    return { status: res.status, body: await res.json() };
  };

  it('answers for a club by its id or by `automatic`, the same payload', async () => {
    const byId = await get(`/api/v2/front-office/${save.org}`);
    const automatic = await get('/api/v2/front-office/automatic');
    expect(byId.status).toBe(200);
    expect(automatic.body).toEqual(byId.body);
    expect(byId.body.departments.every((c: { memo: unknown }) => c.memo === null)).toBe(true);
  });

  it('refuses in a sentence: an unknown club, an unknown department, an unknown evidence key', async () => {
    expect(await get('/api/v2/front-office/999999')).toEqual({ status: 404, body: { error: UNKNOWN_CLUB } });
    expect(await get('/api/v2/front-office/abc')).toEqual({ status: 404, body: { error: UNKNOWN_CLUB } });
    expect(await get(`/api/v2/departments/${save.org}/nowhere`)).toEqual({ status: 404, body: { error: UNKNOWN_DEPARTMENT } });
    expect(await get('/api/v2/claims/nothing')).toEqual({ status: 404, body: { error: UNKNOWN_CLAIM } });
  });

  it('says so when no club is chosen and the save names none', () => {
    exec('UPDATE teams SET human_team = 0');
    try {
      expect(() => resolveOrg('automatic')).toThrow(FrontOfficeRefusal);
      expect(() => resolveOrg('automatic')).toThrow(NO_CLUB);
    } finally {
      exec(`UPDATE teams SET human_team = 1 WHERE team_id = ${save.org}`);
    }
  });
});
