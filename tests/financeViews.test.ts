import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeContracts } from '../server/contracts.js';
import { orgInjuries, orgInjuriesWithHealth } from '../server/dashboard.js';
import { db, tableColumns } from '../server/db.js';
import { freshnessCue, getDataStatus } from '../server/dataStatus.js';
import { computeFreeAgents } from '../server/freeagents.js';
import { loadConfig, saveConfig } from '../server/config.js';
import { FrontOfficeRefusal, frontOfficeInputsKey, relocateLiveLog, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { buildOfficeViews } from '../server/officeViewsBuild.js';
import {
  financeContractsNow, financeFreeAgentNow, financeFreeAgentsNow, financeHorizonNow, financePayrollNow, medicalInjuryReportNow, officeViewStats,
  officeViewsKey, resetOfficeViews, setFinanceBudget,
} from '../server/officeViewService.js';
import { computePayroll } from '../server/payroll.js';
import { freeAgentsView, freeAgentsViewAndDetails } from '../server/presentation/finance/freeAgents.js';
import { horizonView, type HorizonInput } from '../server/presentation/finance/horizon.js';
import { arbitrationYearWords, payrollView } from '../server/presentation/finance/payroll.js';
import { costCell, totalCell } from '../server/presentation/finance/words.js';
import { injuryReportView } from '../server/presentation/medical/injuryReport.js';
import { cell } from '../server/presentation/claim.js';
import type { OfficeContext } from '../server/presentation/officeTable.js';
import { clearProductionCaches, playerValues } from '../server/playerValue.js';
import { loadSettings } from '../server/settings.js';
import { BANNED_JARGON, BANNED_VERDICTS, bannedInPayload } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * Finance's and Medical's views (N12, D-071; BEHAVIOR_CASES.md "Pennant for Mac", the `financeViews.test.ts` rows): they
 * say only what the React pages' routes already compute (Payroll, Contracts, Free Agents, the injury report), and the
 * Horizon Board only what Player Value's control timelines and Player Development's readiness say, worded once on the
 * server. Value describes and never authorizes; an unknown stays unknown.
 */

let save: BuiltSave;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
  resetFrontOfficeCache();
  resetOfficeViews();
}, 120_000);

afterAll(() => resetOfficeViews());

const ctx = (): OfficeContext => ({
  orgId: save.org, importStamp: null, reportStamp: 'r1', gameDate: '2040-7-1', preparedBy: cell('Prepared by the front office'),
  department: 'finance', freshness: { state: 'current', asOf: '2040-07-01', line: null, detail: 'Current.' },
});

/** Every visible string (`display`, `text`, `hint`). */
function visible(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(visible);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) =>
    (typeof x === 'string' && ['display', 'text', 'hint'].includes(k) ? [x] : k === 'basis' ? [] : visible(x)));
}

const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\bcontend/i, /\brebuild/i];

describe('Finance and Medical say what the routes computed (N12)', () => {
  it('builds every view from the routes\' own modules, in their order', () => {
    const built = buildOfficeViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    expect(built.failed).toEqual([]);
    for (const part of [built.payroll, built.contracts, built.freeAgents, built.horizon, built.injuryReport]) expect(part.ok).toBe(true);
    if (!built.contracts.ok || !built.payroll.ok || !built.freeAgents.ok || !built.injuryReport.ok) return;
    const status = getDataStatus();
    const contracts = computeContracts(save.org, status);
    expect(built.contracts.view.table.rows.map((r) => r.player?.playerId)).toEqual(contracts.players.map((p) => p.player_id));
    const payroll = computePayroll(save.org, status);
    expect(built.payroll.view.seasons.map((s) => [s.season, s.committed])).toEqual(payroll.commitments.map((c) => [c.year, c.total]));
    expect(built.payroll.view.contracts.rows.map((r) => r.player?.playerId)).toEqual(payroll.players.map((p) => p.player_id));
    const fa = computeFreeAgents(save.org, status);
    expect(built.freeAgents.view.lists.map((l) => l.table.rows.map((r) => r.player?.playerId))).toEqual(
      [fa.currentFAs, fa.upcomingFAs, fa.mightReach].map((list) => list.map((p) => p.player_id)));
    expect(built.injuryReport.view.table.rows.map((r) => r.player?.playerId)).toEqual(orgInjuries(save.org).map((p) => Number(p.player_id)));
  });

  it('serves no verdict, no banned word, and no odds or posture in any view (D-052, D-060)', () => {
    const built = buildOfficeViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    for (const part of [built.payroll, built.contracts, built.freeAgents, built.horizon, built.injuryReport]) {
      if (!part.ok) throw new Error(part.reason);
      expect(bannedInPayload(part.view)).toEqual([]);
      const words = visible(part.view);
      expect(words.filter((w) => ODDS_OR_POSTURE.some((r) => r.test(w)))).toEqual([]);
      expect(words.filter((w) => [...BANNED_JARGON, ...BANNED_VERDICTS].some((r) => r.test(w)))).toEqual([]);
    }
  });

  it('keeps every table\'s rows to its columns, and an unknown figure\'s sort key null so it sorts last', () => {
    const built = buildOfficeViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const tables = [
      built.contracts.ok ? built.contracts.view.table : null,
      built.payroll.ok ? built.payroll.view.contracts : null,
      ...(built.payroll.ok ? built.payroll.view.sections.map((s) => s.table) : []),
      ...(built.freeAgents.ok ? built.freeAgents.view.lists.map((l) => l.table) : []),
      built.injuryReport.ok ? built.injuryReport.view.table : null,
    ].filter((t) => t !== null);
    for (const t of tables) {
      const ids = t.columns.map((c) => c.id).sort();
      for (const r of t.rows) {
        expect(Object.keys(r.cells).sort()).toEqual(ids);
        for (const id of ids) {
          if (r.cells[id].tone === 'unknown') expect(r.sort[id], `${r.id} ${id}`).toBeNull();
        }
      }
    }
  });

  it('every filter is keyed on its rows: each row names a choice of the group (or none), and no choice lists rows (M4)', () => {
    const built = buildOfficeViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const groups = [
      ...(built.contracts.ok ? [{ table: built.contracts.view.table, filters: built.contracts.view.filters }] : []),
      ...(built.freeAgents.ok ? built.freeAgents.view.lists.map((l) => ({ table: l.table, filters: l.filters })) : []),
      ...(built.injuryReport.ok ? [{ table: built.injuryReport.view.table, filters: built.injuryReport.view.filters }] : []),
    ];
    expect(groups.some((g) => g.filters.length > 0)).toBe(true);
    for (const g of groups) {
      for (const f of g.filters) {
        expect(f.choices[0].id).toBe('all');
        for (const c of f.choices) expect(Object.keys(c).sort()).toEqual(['explain', 'id', 'title']);
        const ids = new Set(f.choices.map((c) => c.id));
        for (const r of g.table.rows) {
          const key = r.filterKeys?.[f.id];
          if (key !== undefined) expect(ids.has(key), `${r.id} ${f.id}=${key}`).toBe(true);
        }
      }
    }
    // Contracts: the side filter keeps exactly the pitchers
    if (built.contracts.ok) {
      const c = computeContracts(save.org, getDataStatus());
      const pitchers = built.contracts.view.table.rows.filter((r) => r.filterKeys?.side === 'pitchers').map((r) => r.player?.playerId);
      expect(pitchers).toEqual(c.players.filter((p) => p.positionName === 'P').map((p) => p.player_id));
    }
  });
});

describe('Payroll & Budget (N12)', () => {
  it('never adds a projected cost to the committed money or the room', () => {
    const payroll = computePayroll(save.org, getDataStatus());
    const view = payrollView(ctx(), { payroll, club: null, league: null, history: [] });
    for (const [i, s] of view.seasons.entries()) {
      const c = payroll.commitments[i];
      expect(s.committed).toBe(c.total);
      expect(s.claim.value?.n).toBe(c.total);
      if (c.headroom !== null) expect(s.roomCell.display).toContain('free');
    }
    expect(view.seasons.some((s) => s.projected !== null)).toBe(true);
  });

  it('says an unknown budget is not known, never $0, and draws no budget line', () => {
    const payroll = computePayroll(save.org, getDataStatus());
    const unknown = {
      ...payroll,
      finances: { ...payroll.finances, budget: { ...payroll.finances.budget, value: null } },
      commitments: payroll.commitments.map((c) => ({ ...c, headroom: null })),
    } as typeof payroll;
    const view = payrollView(ctx(), { payroll: unknown, club: null, league: null, history: [] });
    expect(view.budget.amount).toBeNull();
    expect(view.budget.label.display).toBe('Budget not known');
    expect(view.seasons.every((s) => s.budget === null && s.roomCell.display === 'Room not known')).toBe(true);
    expect(visible([view.budget, view.seasons.map((s) => s.roomCell)]).filter((w) => /\$0\b/.test(w))).toEqual([]);
  });

  it('says an arbitration year with no contracts to read from in its own words, never "read from 0 contracts" (L9)', () => {
    expect(arbitrationYearWords('prior', [{ cases: 0, arbitrationClass: 1 }, { cases: 0, arbitrationClass: 2 }], 0))
      .toBe('no arbitration contracts on this save to read an arbitration year from yet');
    expect(arbitrationYearWords('measured', [{ cases: 1, arbitrationClass: 1 }, { cases: 0, arbitrationClass: 2 }], 1))
      .toBe('an arbitration year is read from 1 contract (1 in the 1st year)');
    expect(arbitrationYearWords('no_arbitration', [], 0)).toBe("an arbitration year doesn't exist in this league");
  });

  it('says dead money the export leaves blank is not stated, never counts it as zero (L3)', () => {
    const payroll = computePayroll(save.org, getDataStatus());
    const owed = (players: Array<{ salary: number | null }>) => payrollView(ctx(), {
      payroll: { ...payroll, deadMoney: { status: 'known', total: null, candidates: players.length, note: null,
        players: players.map((p, i) => ({ player_id: 900 + i, name: `Gone ${i}`, salary: p.salary })) } } as unknown as typeof payroll,
      club: null, league: null, history: [],
    }).deadMoney;
    const mixed = owed([{ salary: 4_000_000 }, { salary: null }]);
    expect(mixed.text).toBe('Dead money: $4.0M still owed to players who left, plus 1 not stated');
    expect(mixed.value?.display).toBe('$4.0M + 1 not stated');
    expect(mixed.basis.unknown.length).toBe(1);
    const blank = owed([{ salary: null }, { salary: null }]);
    expect(blank).toMatchObject({ text: 'Dead money: owed to 2 players who left, amounts not stated', tone: 'unknown' });
    expect(blank.value).toBeUndefined();
    expect(owed([{ salary: 4_000_000 }]).text).toBe('Dead money: $4.0M still owed to players who left');
  });

  it('reads later seasons against the budget the GM expects once he enters it, and clears it at zero', async () => {
    const before = await financePayrollNow(String(save.org));
    expect(before.expectedBudget).toBeNull();
    expect(setFinanceBudget(String(save.org), { amount: 200_000_000 })).toMatchObject({ nextSeasonBudget: 200_000_000 });
    const after = await financePayrollNow(String(save.org));
    expect(after.expectedBudget?.amount).toBe(200_000_000);
    expect(after.seasons.filter((s) => s.season > after.seasons[0].season).every((s) => s.budget === 200_000_000)).toBe(true);
    expect(after.seasons[0].budget).toBe(before.seasons[0].budget);
    expect(setFinanceBudget(String(save.org), { amount: 0 })).toMatchObject({ nextSeasonBudget: null });
    expect(loadSettings().nextSeasonBudget?.[String(save.org)]).toBeUndefined();
    expect(setFinanceBudget(String(save.org), { amount: 'lots' })).toEqual({ refused: expect.any(String) });
  });
});

describe('the budget the GM expects next season (N12 review, M2)', () => {
  it('says what it did and serves the request that puts back what was there, to the dollar', () => {
    const org = String(save.org);
    setFinanceBudget(org, { amount: 0 });
    const first = setFinanceBudget(org, { amount: 123_456_700 });
    expect(first).toEqual({
      nextSeasonBudget: 123_456_700,
      done: expect.objectContaining({ display: "Next season's budget set to $123.4567M; was today's budget held flat" }),
      undo: { amount: 0 },
    });
    expect(loadSettings().nextSeasonBudget?.[org]).toBe(123_456_700);
    const second = setFinanceBudget(org, { amount: 150_000_000 });
    expect(second).toMatchObject({ done: { display: "Next season's budget set to $150M; was $123.4567M" }, undo: { amount: 123_456_700 } });
    // Undone: the request it served puts the amount before back, and says so
    const undone = setFinanceBudget(org, (second as { undo: { amount: number } }).undo);
    expect(undone).toMatchObject({ nextSeasonBudget: 123_456_700, done: { display: "Next season's budget set to $123.4567M; was $150M" }, undo: { amount: 150_000_000 } });
    expect(setFinanceBudget(org, { amount: 0 })).toMatchObject({
      nextSeasonBudget: null, done: { display: "Next season's budget cleared, so today's holds flat; was $123.4567M" }, undo: { amount: 123_456_700 },
    });
    expect(bannedInPayload([first, second, undone])).toEqual([]);
  });

  it('refuses an amount past any club\'s budget, and keeps what was there', () => {
    const org = String(save.org);
    setFinanceBudget(org, { amount: 180_000_000 });
    expect(setFinanceBudget(org, { amount: 1e13 })).toEqual({ refused: expect.stringMatching(/up to \$10 billion/) });
    expect(setFinanceBudget(org, { amount: Number.MAX_VALUE })).toEqual({ refused: expect.any(String) });
    expect(loadSettings().nextSeasonBudget?.[org]).toBe(180_000_000);
    setFinanceBudget(org, { amount: 0 });
  });

  it('has its own help sentence when the export has no budget: never "this year\'s budget holds flat"', () => {
    const payroll = computePayroll(save.org, getDataStatus());
    const unknown = { ...payroll, finances: { ...payroll.finances, budget: { ...payroll.finances.budget, value: null } } } as typeof payroll;
    const view = payrollView(ctx(), { payroll: unknown, club: null, league: null, history: [] });
    expect(view.nextSeasonBudget.help.display).not.toMatch(/holds flat/);
    expect(view.nextSeasonBudget.help.display).toMatch(/no budget/);
    const known = payrollView(ctx(), { payroll, club: null, league: null, history: [] });
    expect(known.nextSeasonBudget.help.display).toMatch(/holds flat/);
  });
});

describe('Free Agents (N12)', () => {
  it('keeps why a player might reach the market in a breakdown: its method words never on the face', () => {
    const f = computeFreeAgents(save.org, getDataStatus());
    const any = [...f.currentFAs, ...f.upcomingFAs][0] ?? null;
    const base = any ?? {
      player_id: 4242, name: 'Pat Option', age: 31, position: 6, positionName: 'SS', isPitcher: false, team: 'Club', salaryNow: 8_000_000, salaryNote: null,
      scouted: { now: null, ceiling: null, status: 'unknown' }, winsNow: null, winsNext: null, winsReason: 'Not projected.',
      market: { status: 'unknown', season: 2041, low: null, central: null, high: null, reason: 'Not projected.', text: 'Not projected.' },
    };
    const row = { ...base, why: { kind: 'option' as const, label: 'Club option', reason: 'A club option season: exercised, $8,000,000; declined, the buyout and then indeterminate.' } };
    const { view, details } = freeAgentsViewAndDetails(ctx(), { ...f, mightReach: [row] } as typeof f, () => null);
    const list = view.lists.find((l) => l.id === 'mightReach')!;
    expect(list.table.rows[0].cells.why.display).toBe('Club option');
    expect(bannedInPayload(view)).toEqual([]);
    // The breakdown is his detail, served when his row is chosen: the list's row carries none of it
    expect(list.table.rows[0].claims).toBeUndefined();
    expect(list.table.rows[0].facts).toBeUndefined();
    const detail = details.get(row.player_id)!;
    expect(detail.claims.some((c) => c.basis.because.some((b) => /indeterminate/.test(b.value)))).toBe(true);
    expect(detail.facts.map((x) => x.label.display)).toContain('Why he might reach it');
    expect(list.table.rows[0].filterKeys).toMatchObject({ side: row.isPitcher ? 'pitchers' : 'hitters' });
  });

  it('serves a chosen player\'s detail from the kept build, and refuses a player not listed in a sentence', async () => {
    const view = await financeFreeAgentsNow(String(save.org));
    const listed = view.lists.flatMap((l) => l.table.rows).find((r) => r.player);
    if (listed) {
      const builds = officeViewStats().builds;
      const detail = await financeFreeAgentNow(String(save.org), String(listed.player!.playerId));
      expect(detail.playerId).toBe(listed.player!.playerId);
      expect(detail.claims.length).toBeGreaterThan(0);
      expect(officeViewStats().builds).toBe(builds);
    }
    await expect(financeFreeAgentNow(String(save.org), String(save.regular))).rejects.toBeInstanceOf(FrontOfficeRefusal);
    await expect(financeFreeAgentNow(String(save.org), 'lots')).rejects.toBeInstanceOf(FrontOfficeRefusal);
  });
});

describe('the Horizon Board (N12; D-057)', () => {
  const base = (): HorizonInput => ({
    thisSeason: 2040,
    seasons: [2041, 2042, 2043],
    players: [],
    farmNext: new Map(),
    payroll: [],
    budget: null,
    payrollUnknown: null,
    fillOf: () => null,
  });

  it('leaves a player out of a season his control has ended, and says a season not settled is not settled', () => {
    const view = horizonView(ctx(), {
      ...base(),
      players: [{
        playerId: 7, name: 'Pat Short', position: 6, role: 0, unknown: null, controlEnds: 2043,
        seasons: [
          { season: 2041, status: 'arbitration', label: 'Arbitration 3', between: [], basis: 'His third arbitration year.' },
          { season: 2042, status: 'indeterminate', label: 'Not settled', between: ['arbitration', 'free_agent'], basis: 'His service crosses the line only if he stays up.' },
          { season: 2043, status: 'free_agent', label: 'Free agent', between: [], basis: 'Control has ended.' },
        ],
      }],
    });
    const ss = view.rows.find((r) => r.id === 'ss')!;
    expect(ss.cells[0].entries.map((e) => e.status.display)).toEqual(['Arbitration 3']);
    expect(ss.cells[1].entries[0].status).toMatchObject({ display: 'Not settled: arbitration or free agency', tone: 'unknown' });
    expect(ss.cells[2].entries).toEqual([]);
    expect(ss.cells[2].empty?.display).toBe('Nobody controlled');
  });

  it('says a season it couldn\'t read is not known, never nobody', () => {
    const view = horizonView(ctx(), { ...base(), players: [{ playerId: 8, name: 'Lee Unread', position: 2, role: 0, unknown: 'Not established.', controlEnds: null, seasons: [] }] });
    const c = view.rows.find((r) => r.id === 'c')!;
    expect(c.cells.every((x) => x.empty?.tone === 'unknown' && x.unread === 1)).toBe(true);
    expect(view.unknowns.length).toBe(1);
  });

  it('leaves out a player whose real timeline stopped at free agency, in the seasons after it too, never "not known"', () => {
    // A major leaguer of ours on the last year of his deal, given a veteran's service: Player Value's timeline reads free
    // agency next season and stops there, so the board's later seasons are control ended, not unread
    const veteran = db.prepare(`SELECT c.player_id AS id, rs.mlb_service_days AS days FROM players_contract c
      JOIN players p ON p.player_id = c.player_id JOIN players_roster_status rs ON rs.player_id = c.player_id
      JOIN teams t ON t.team_id = p.team_id WHERE t.level = 1 AND p.organization_id = ? AND c.years = 1 AND c.is_major = 1
      ORDER BY c.player_id LIMIT 1`).get(save.org) as { id: number; days: number };
    const setDays = (days: number) => {
      db.prepare('UPDATE players_roster_status SET mlb_service_days = ? WHERE player_id = ?').run(days, veteran.id);
      clearProductionCaches();
      resetOfficeViews();
    };
    setDays(1500);
    try {
      const control = playerValues([veteran.id]).get(veteran.id)!.control;
      const built = buildOfficeViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
      if (!built.horizon.ok) throw new Error(built.horizon.reason);
      const view = built.horizon.view;
      expect(control.controlEnds).toBe(view.seasons[0]);
      expect(control.seasons.map((x) => x.season)).not.toContain(view.seasons[1]);
      const cells = view.rows.flatMap((r) => r.cells);
      expect(cells.flatMap((c) => c.entries).filter((e) => e.player.playerId === veteran.id)).toEqual([]);
      // Every other major leaguer's timeline reaches past the board, so nothing on it is unread
      expect(cells.filter((c) => c.unread > 0 || c.empty?.tone === 'unknown' || c.unreadNote !== null).map((c) => c.season)).toEqual([]);
    } finally {
      setDays(veteran.days);
    }
  });

  it('says the unread players in a cell that has entries too: "Not known for N more"', () => {
    const view = horizonView(ctx(), {
      ...base(),
      players: [
        { playerId: 9, name: 'Sam Signed', position: 8, role: 0, unknown: null, controlEnds: null,
          seasons: [2041, 2042, 2043].map((season) => ({ season, status: 'under_contract', label: 'Signed', between: [], basis: 'Under contract.' })) },
        { playerId: 10, name: 'Kim Unread', position: 8, role: 0, unknown: 'Not established.', controlEnds: null, seasons: [] },
        { playerId: 11, name: 'Ray Early', position: 8, role: 0, unknown: null, controlEnds: null,
          seasons: [{ season: 2041, status: 'arbitration', label: 'Arbitration 1', between: [], basis: 'His first arbitration year.' }] },
      ],
    });
    const cf = view.rows.find((r) => r.id === 'cf')!;
    expect(cf.cells.map((c) => c.unread)).toEqual([1, 2, 2]);
    expect(cf.cells.map((c) => c.unreadNote?.display)).toEqual(['Not known for 1 more', 'Not known for 2 more', 'Not known for 2 more']);
    expect(cf.cells.every((c) => c.empty === null && c.unreadNote?.tone === 'unknown')).toBe(true);
  });

  it('says when a later season is read against today\'s budget held flat (L5)', async () => {
    const view = horizonView(ctx(), {
      ...base(),
      budget: 150_000_000,
      payroll: [
        { season: 2040, committed: 120_000_000, budget: 150_000_000 },
        { season: 2041, committed: 90_000_000, budget: 150_000_000, heldFlat: true },
        { season: 2042, committed: 60_000_000, budget: 170_000_000, heldFlat: false },
      ],
    });
    expect(view.payroll.map((p) => p.budget)).toEqual([150_000_000, 150_000_000, 170_000_000]);
    expect(view.payroll.map((p) => p.claim.hint ?? null)).toEqual([null, "Read against today's budget, held flat", null]);
    expect(view.payroll[1].claim.basis.because.find((b) => b.label === 'Measured against')?.value).toMatch(/assumed to hold flat/);
    // From the build: no budget entered, so every later season is today's held flat
    const built = await financeHorizonNow(String(save.org));
    expect(built.payroll.slice(1).every((p) => p.budget === null || p.claim.hint === "Read against today's budget, held flat")).toBe(true);
  });

  it('keeps the farm\'s next man in the pipeline lane, never placed in a season (no arrival year is invented)', async () => {
    const view = await financeHorizonNow(String(save.org));
    const pipeline = view.rows.flatMap((r) => r.pipeline.map((p) => p.player.playerId));
    expect(pipeline.length).toBeGreaterThan(0);
    const inSeasons = view.rows.flatMap((r) => r.cells.flatMap((c) => c.entries.map((e) => e.player.playerId)));
    expect(pipeline.filter((id) => inSeasons.includes(id))).toEqual([]);
    for (const p of view.rows.flatMap((r) => r.pipeline)) expect(Object.keys(p)).not.toContain('season');
  });
});

describe('the Injury Report (N12)', () => {
  it('says a return date the export doesn\'t give is not given, never zero, and sorts it last', () => {
    const view = injuryReportView({ ...ctx(), department: 'medical' }, [
      { player_id: 1, name: 'A One', age: 30, positionName: 'SS', levelName: 'MLB', team: 'Club', status: 'IL', daysLeft: null, dlDaysThisYear: null, playable: false },
      { player_id: 2, name: 'B Two', age: 25, positionName: 'P', levelName: 'AAA', team: 'Farm', status: 'Day-to-day', daysLeft: 3, dlDaysThisYear: 12, playable: true },
    ] as unknown as ReturnType<typeof orgInjuriesWithHealth>);
    const [one, two] = view.table.rows;
    expect(one.cells.back).toMatchObject({ display: 'Not given', tone: 'unknown' });
    expect(one.sort.back).toBeNull();
    expect(one.cells.ilDays.display).toBe('Not given');
    expect(two.cells.back.display).toBe('About 3 days');
    expect(two.cells.status.hint).toMatch(/play through it/);
    expect(view.unknowns.map((u) => u.display)).toEqual(['The export has no return date for 1 injured player.']);
    expect(view.filters[0].choices.map((c) => c.id)).toEqual(['all', 'MLB', 'AAA']);
    expect(view.table.rows.map((r) => r.filterKeys?.level)).toEqual(['MLB', 'AAA']);
  });
});

describe('the pane tables serve their own sentences (N12 review, L6)', () => {
  it('serves what a filtered-empty table and an unchosen row say, so the Mac app writes neither', () => {
    const built = buildOfficeViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const tables = [
      built.contracts.ok ? built.contracts.view.table : null,
      built.payroll.ok ? built.payroll.view.contracts : null,
      ...(built.freeAgents.ok ? built.freeAgents.view.lists.map((l) => l.table) : []),
      built.injuryReport.ok ? built.injuryReport.view.table : null,
    ];
    for (const t of tables) {
      expect(t?.noneKept?.display).toBe('No players match these filters.');
      expect(t?.choose?.display).toBe('Select a row to see more.');
    }
  });
});

describe('sort keys say only what was stated (N12 review, L2; D-018)', () => {
  it('sorts a figure with no most likely value on its low edge, never an invented midpoint', () => {
    const cost = costCell({ low: 2_000_000, high: 8_000_000, central: null, text: 'Between statuses.', source: null, ifHeld: false }, 'None');
    expect(cost.sort).toBe(2_000_000);
    expect(costCell({ low: 2_000_000, high: 8_000_000, central: 3_000_000, text: '', source: null, ifHeld: false }, 'None').sort).toBe(3_000_000);
    const total = totalCell({ status: 'known', from: 2041, to: 2043, low: -4_000_000, central: null, high: 20_000_000, centralRange: { low: 1_000_000, high: 9_000_000 }, reason: null }, 'dollars', null);
    expect(total.sort).toBe(1_000_000);
  });
});

describe('the routes the React app reads stay as they were (N12 review, L1)', () => {
  it('serves /api/injuries\' rows without the Mac app\'s playable, which only the Injury Report reads', () => {
    const plain = orgInjuries(save.org);
    const full = orgInjuriesWithHealth(save.org);
    expect(plain.length).toBe(full.length);
    for (const [i, injury] of plain.entries()) {
      expect(Object.keys(injury)).not.toContain('playable');
      const { playable: _playable, ...rest } = full[i];
      expect(injury).toEqual(rest);
    }
  });
});

describe('kept per import (N12)', () => {
  it('builds once for the club and serves every view from the cache after', async () => {
    resetOfficeViews();
    await financePayrollNow(String(save.org));
    const { builds } = officeViewStats();
    await Promise.all([financeContractsNow(String(save.org)), financeFreeAgentsNow(String(save.org)), financeHorizonNow(String(save.org)), medicalInjuryReportNow(String(save.org))]);
    expect(officeViewStats().builds).toBe(builds);
    expect(officeViewStats().hits).toBeGreaterThanOrEqual(4);
  });

  it('keeps the views through a write to OOTP\'s live log that leaves the export\'s freshness as it was', async () => {
    // A pretend save with a live log beside it, chosen by hand: the Front Office keys on the log's files, the views on
    // the freshness derived from them
    const lg = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-live-log-')) + '/Pretend.lg';
    fs.mkdirSync(path.join(lg, 'temp'), { recursive: true });
    fs.mkdirSync(path.join(lg, 'import_export', 'csv'), { recursive: true });
    const wal = path.join(lg, 'temp', 'text_data.sqlite3-wal');
    fs.writeFileSync(path.join(lg, 'temp', 'text_data.sqlite3'), 'not a log');
    fs.writeFileSync(wal, 'x');
    const before = loadConfig();
    try {
      saveConfig({ ...before, lgPath: lg });
      relocateLiveLog();
      resetOfficeViews();
      await financePayrollNow(String(save.org));
      const builds = officeViewStats().builds;
      const officeKey = officeViewsKey(save.org);
      const rawKey = frontOfficeInputsKey(save.org);
      fs.appendFileSync(wal, 'another write');
      fs.utimesSync(wal, new Date(), new Date(Date.now() + 5_000));
      expect(frontOfficeInputsKey(save.org)).not.toBe(rawKey);
      expect(officeViewsKey(save.org)).toBe(officeKey);
      // The freshness stays in the key: an export gone behind blanks service time in Payroll and Contracts
      const cue = freshnessCue(getDataStatus());
      expect(officeKey.endsWith(`|${cue.state}/${cue.lagDays}`)).toBe(true);
      await financePayrollNow(String(save.org));
      expect(officeViewStats().builds).toBe(builds);
    } finally {
      saveConfig(before);
      relocateLiveLog();
      fs.rmSync(path.dirname(lg), { recursive: true, force: true });
      resetOfficeViews();
    }
  });

  it('builds another club\'s on its first open and keeps it', async () => {
    const other = save.clubs.find((c) => c !== save.org)!;
    const before = officeViewStats().builds;
    const first = await financeContractsNow(String(other));
    expect(first.orgId).toBe(other);
    expect(officeViewStats().builds).toBe(before + 1);
    await financeContractsNow(String(other));
    expect(officeViewStats().builds).toBe(before + 1);
  });

  it('refuses an unknown club in a sentence', async () => {
    await expect(financeContractsNow('99999')).rejects.toBeInstanceOf(FrontOfficeRefusal);
  });
});

/*
 * A fuller Free Agents payload than the contract's synthetic save makes (it has no free agent), worded by the real
 * adapter from the synthetic save with four players released the way the export writes a free agent, one of them read
 * from OSA's view, for the Mac app's previews and snapshots (`contract/fixtures/finance/`). Written with
 * `npm run contract:fixtures`, checked here otherwise.
 */
describe('fixtures for the Mac app\'s Finance previews (N12)', () => {
  const FOLDER = path.join(process.cwd(), 'contract', 'fixtures', 'finance');
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

  it('free agents available now, one read from OSA\'s view', () => {
    for (const column of ['free_agent', 'last_league_id']) {
      if (!tableColumns('players').includes(column)) db.prepare(`ALTER TABLE players ADD COLUMN ${column} INTEGER DEFAULT 0`).run();
    }
    db.prepare('UPDATE players SET free_agent = 0, last_league_id = ?').run(save.leagueId);
    const orgOf = db.prepare('SELECT organization_id AS org FROM players WHERE player_id = ?');
    const released = save.hitters.filter((id) => (orgOf.get(id) as { org: number }).org !== save.org).slice(0, 3);
    released.push(save.prospects[0]);
    for (const id of released) {
      db.prepare('UPDATE players SET team_id = 0, organization_id = 0, free_agent = 1, last_league_id = ? WHERE player_id = ?').run(save.leagueId, id);
      db.prepare('DELETE FROM players_roster_status WHERE player_id = ?').run(id);
      db.prepare('DELETE FROM team_roster WHERE player_id = ?').run(id);
      db.prepare(`UPDATE players_contract SET team_id = 0, contract_team_id = 0, years = 0, season_year = 0, is_major = 0,
        salary0 = 0, salary1 = 0, salary2 = 0, salary3 = 0 WHERE player_id = ?`).run(id);
    }
    const filled = released[1];
    const { view, details } = freeAgentsViewAndDetails(ctx(), computeFreeAgents(save.org, getDataStatus()),
      (id) => (id === filled ? { mark: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' } : null));
    const available = view.lists.find((l) => l.id === 'available')!;
    expect(available.table.rows.length).toBe(released.length);
    expect(available.table.rows.find((r) => r.player?.playerId === filled)?.ratingsFill?.display).toBe('OSA');
    expect(bannedInPayload(view)).toEqual([]);
    // The first listed player's detail, served when his row is chosen
    const detail = details.get(available.table.rows[0].player!.playerId)!;
    expect(bannedInPayload(detail)).toEqual([]);
    for (const [name, value] of [['free-agents.json', view], ['free-agent-detail.json', detail]] as const) {
      const file = path.join(FOLDER, name);
      if (process.env.CONTRACT_FIXTURES === 'write') {
        fs.mkdirSync(FOLDER, { recursive: true });
        fs.writeFileSync(file, json(value));
        continue;
      }
      expect(fs.existsSync(file), `${name} is missing: run npm run contract:fixtures`).toBe(true);
      expect(fs.readFileSync(file, 'utf8'), `${name} differs: run npm run contract:fixtures`).toBe(json(value));
    }
  });
});
