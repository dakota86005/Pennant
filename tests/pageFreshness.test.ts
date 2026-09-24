import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { getDataStatus, type DataStatus } from '../server/dataStatus.js';
import { computePayroll } from '../server/payroll.js';
import { playerSurplus } from '../server/playerValue.js';
import { analyzeTrade } from '../server/trade.js';
import { FreshnessCueLine } from '../src/FreshnessCue';
import { TradeAnalysisPanel } from '../src/TradeAnalysis';
import type { TradeAnalysis } from '../src/tradeApi';
import { buildSave, type BuiltSave, type SaveSpec } from './syntheticSave';
import request, { post } from './request';
import { visibleText } from './visibleText';

/*
 * Player Value phase 6c: Payroll, Free Agents and the Trade Center say how current the data is (A-20; BEHAVIOR_CASES.md
 * "Player Value", phase 6c row), as Contracts and the card do: the export's game date, and a warning when it is behind
 * the save (its service-dependent figures are then not established) or could not be checked against it. Each route hands
 * the export's freshness to Player Value as `currentState`. Free Agents' own cases are in `freeAgents.test.ts`.
 */

const SLOW = 120_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 8, minors: true, seed: 7 };
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let save: BuiltSave;

const status = (csv: Partial<DataStatus['freshness']['csv']>, simulated: string | null = '2040-06-01'): DataStatus => {
  const real = getDataStatus();
  return {
    ...real,
    save: { ...real.save, simulatedThrough: simulated },
    freshness: { ...real.freshness, save: { simulatedThrough: simulated }, csv: { ...real.freshness.csv, ...csv } },
  };
};
const BEHIND = () => status({ state: 'behind', lagDays: 3, currentDate: '2040-05-29', through: '2040-05-28' });
const UNCHECKED = () => status({ state: 'unverified', lagDays: 0 }, null);

/** Statuses that turn on service time: an old export cannot state them (D-023). */
const SETTLED_BY_SERVICE = ['leaving', 'arbitration', 'pre-arbitration', 'reserve clause'];

beforeAll(() => {
  save = buildSave(spec);
}, SLOW);

describe('Payroll says how current it is', () => {
  it('names the game date the export is from', async () => {
    const page = await request(`/api/payroll/${save.org}`);
    expect(page.freshness.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, SLOW);

  it('an export behind the save says so, and no status that turns on service is stated from it', () => {
    const stale = computePayroll(save.org, BEHIND());
    expect(stale.freshness.state).toBe('behind');
    expect(stale.freshness.line).toMatch(/out of date/i);
    const settled = stale.players.filter((p: Any) => p.control && SETTLED_BY_SERVICE.includes(p.control.status));
    expect(settled.map((p: Any) => `${p.name}: ${p.control.status}`)).toEqual([]);
    // ...where a current reading states some
    const current = computePayroll(save.org, status({ state: 'current', lagDays: 0, currentDate: '2040-06-01', through: '2040-05-31' }));
    expect(current.players.some((p: Any) => p.control && SETTLED_BY_SERVICE.includes(p.control.status))).toBe(true);
  }, SLOW);

  it('an export nothing could date says it was not checked, and carries Player Rights\' limitation', () => {
    const read = computePayroll(save.org, UNCHECKED());
    expect(read.freshness.state).toBe('unverified');
    expect(read.freshness.line).toMatch(/not checked/i);
    expect(read.freshness.limitations.join(' ')).toMatch(/could not be checked against the save/);
  }, SLOW);

  it('the page shows the date and the warning, in the same words as Contracts', () => {
    const source = fs.readFileSync('src/pages/Payroll.tsx', 'utf8');
    expect(source).toMatch(/<FreshnessCueLine\b/);
  });
});

describe('the Trade Center says how current it is', () => {
  let deal: { sent: number[]; received: number[] };
  beforeAll(() => {
    const orgOf = db.prepare(`SELECT organization_id AS org FROM players WHERE player_id = ?`);
    const org = (id: number) => (orgOf.get(id) as { org: number } | undefined)?.org;
    const known = (id: number) => playerSurplus(id)?.contract.status === 'known';
    const ours = [...save.hitters, ...save.pitchers].filter((id) => org(id) === save.org && known(id));
    const theirs = [...save.hitters, ...save.pitchers].filter((id) => org(id) !== save.org && (org(id) ?? 0) > 0 && known(id));
    deal = { sent: ours.slice(0, 2), received: theirs.slice(0, 2) };
  });

  it('the analysis names the game date the export is from, through the route too', async () => {
    const a = await post('/api/trade/analyze', { sideA: deal.sent, sideB: deal.received, orgId: save.org });
    expect(a.freshness.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, SLOW);

  it('an export behind the save says so, and the deal is read on the stale state', () => {
    const viewer = { orgId: save.org, philosophy: null };
    const stale = analyzeTrade(deal.sent, deal.received, viewer, BEHIND());
    expect(stale.freshness.state).toBe('behind');
    const fresh = analyzeTrade(deal.sent, deal.received, viewer, status({ state: 'current', lagDays: 0, currentDate: '2040-06-01', through: '2040-05-31' }));
    // Service-dependent control is not stated from an old export: the rows' control lines say so where the current one does not
    const staleText = stale.sent.concat(stale.received).map((r) => r.control.text).join(' | ');
    const freshText = fresh.sent.concat(fresh.received).map((r) => r.control.text).join(' | ');
    expect(staleText).not.toEqual(freshText);
  }, SLOW);

  it('the analysis panel shows the date and the warning', () => {
    const a = JSON.parse(JSON.stringify(analyzeTrade(deal.sent, deal.received, { orgId: save.org, philosophy: null }, BEHIND()))) as TradeAnalysis;
    const html = renderToStaticMarkup(createElement(TradeAnalysisPanel, { orgLabel: 'Club 1', loading: false, error: null, analysis: a, onRetry: () => {} }));
    const text = visibleText(html);
    expect(text).toMatch(/As of May 29, 2040/);
    expect(text).toMatch(/out of date/i);
  }, SLOW);
});

describe('the freshness cue, in the same words on every page', () => {
  it('says the date, and the warning in its tone, with the detail on hover', () => {
    const cue = { state: 'behind' as const, asOf: '2040-05-29', lagDays: 3, line: 'Data may be out of date: the export is 3 days behind your save', detail: 'Service time can\'t be read from an old export.', limitations: [] };
    const html = renderToStaticMarkup(createElement(FreshnessCueLine, { freshness: cue }));
    expect(visibleText(html)).toBe('As of May 29, 2040 · Data may be out of date: the export is 3 days behind your save');
    expect(html).toMatch(/dossier-asof-bad/);
    expect(html).toMatch(/class="tip-pop">[^<]*Service time/);
    const quiet = renderToStaticMarkup(createElement(FreshnessCueLine, { freshness: { ...cue, state: 'current', line: null } }));
    expect(visibleText(quiet)).toBe('As of May 29, 2040');
    expect(renderToStaticMarkup(createElement(FreshnessCueLine, { freshness: undefined }))).toBe('');
  });
});
