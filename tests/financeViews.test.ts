import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeContracts } from '../server/contracts.js';
import { orgInjuries } from '../server/dashboard.js';
import { db, tableColumns } from '../server/db.js';
import { getDataStatus } from '../server/dataStatus.js';
import { computeFreeAgents } from '../server/freeagents.js';
import { FrontOfficeRefusal, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { buildOfficeViews } from '../server/officeViewsBuild.js';
import {
  financeContractsNow, financeFreeAgentsNow, financeHorizonNow, financePayrollNow, medicalInjuryReportNow, officeViewStats,
  resetOfficeViews, setFinanceBudget,
} from '../server/officeViewService.js';
import { computePayroll } from '../server/payroll.js';
import { freeAgentsView } from '../server/presentation/finance/freeAgents.js';
import { horizonView, type HorizonInput } from '../server/presentation/finance/horizon.js';
import { payrollView } from '../server/presentation/finance/payroll.js';
import { injuryReportView } from '../server/presentation/medical/injuryReport.js';
import { cell } from '../server/presentation/claim.js';
import type { OfficeContext } from '../server/presentation/officeTable.js';
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

  it('every filter keeps only rows of its table, and its first choice keeps them all', () => {
    const built = buildOfficeViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const groups = [
      ...(built.contracts.ok ? [{ table: built.contracts.view.table, filters: built.contracts.view.filters }] : []),
      ...(built.freeAgents.ok ? built.freeAgents.view.lists.map((l) => ({ table: l.table, filters: l.filters })) : []),
    ];
    expect(groups.some((g) => g.filters.length > 0)).toBe(true);
    for (const g of groups) {
      const ids = g.table.rows.map((r) => r.id);
      for (const f of g.filters) {
        expect(f.choices[0].rows).toEqual(ids);
        for (const c of f.choices) expect(c.rows.every((id) => ids.includes(id))).toBe(true);
      }
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

  it('reads later seasons against the budget the GM expects once he enters it, and clears it at zero', async () => {
    const before = await financePayrollNow(String(save.org));
    expect(before.expectedBudget).toBeNull();
    expect(setFinanceBudget(String(save.org), { amount: 200_000_000 })).toEqual({ nextSeasonBudget: 200_000_000 });
    const after = await financePayrollNow(String(save.org));
    expect(after.expectedBudget?.amount).toBe(200_000_000);
    expect(after.seasons.filter((s) => s.season > after.seasons[0].season).every((s) => s.budget === 200_000_000)).toBe(true);
    expect(after.seasons[0].budget).toBe(before.seasons[0].budget);
    expect(setFinanceBudget(String(save.org), { amount: 0 })).toEqual({ nextSeasonBudget: null });
    expect(loadSettings().nextSeasonBudget?.[String(save.org)]).toBeUndefined();
    expect(setFinanceBudget(String(save.org), { amount: 'lots' })).toEqual({ refused: expect.any(String) });
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
    const view = freeAgentsView(ctx(), { ...f, mightReach: [row] } as typeof f, () => null);
    const list = view.lists.find((l) => l.id === 'mightReach')!;
    expect(list.table.rows[0].cells.why.display).toBe('Club option');
    expect(bannedInPayload(view)).toEqual([]);
    expect(list.table.rows[0].claims.some((c) => c.basis.because.some((b) => /indeterminate/.test(b.value)))).toBe(true);
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
        playerId: 7, name: 'Pat Short', position: 6, role: 0, unknown: null,
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
    const view = horizonView(ctx(), { ...base(), players: [{ playerId: 8, name: 'Lee Unread', position: 2, role: 0, unknown: 'Not established.', seasons: [] }] });
    const c = view.rows.find((r) => r.id === 'c')!;
    expect(c.cells.every((x) => x.empty?.tone === 'unknown' && x.unread === 1)).toBe(true);
    expect(view.unknowns.length).toBe(1);
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
    ] as unknown as ReturnType<typeof orgInjuries>);
    const [one, two] = view.table.rows;
    expect(one.cells.back).toMatchObject({ display: 'Not given', tone: 'unknown' });
    expect(one.sort.back).toBeNull();
    expect(one.cells.ilDays.display).toBe('Not given');
    expect(two.cells.back.display).toBe('About 3 days');
    expect(two.cells.status.hint).toMatch(/play through it/);
    expect(view.unknowns.map((u) => u.display)).toEqual(['The export has no return date for 1 injured player.']);
    expect(view.filters[0].choices.map((c) => c.id)).toEqual(['all', 'MLB', 'AAA']);
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
    const view = freeAgentsView(ctx(), computeFreeAgents(save.org, getDataStatus()),
      (id) => (id === filled ? { mark: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' } : null));
    const available = view.lists.find((l) => l.id === 'available')!;
    expect(available.table.rows.length).toBe(released.length);
    expect(available.table.rows.find((r) => r.player?.playerId === filled)?.ratingsFill?.display).toBe('OSA');
    expect(bannedInPayload(view)).toEqual([]);
    const file = path.join(FOLDER, 'free-agents.json');
    if (process.env.CONTRACT_FIXTURES === 'write') {
      fs.mkdirSync(FOLDER, { recursive: true });
      fs.writeFileSync(file, json(view));
      return;
    }
    expect(fs.existsSync(file), 'free-agents.json is missing: run npm run contract:fixtures').toBe(true);
    expect(fs.readFileSync(file, 'utf8'), 'free-agents.json differs: run npm run contract:fixtures').toBe(json(view));
  });
});
