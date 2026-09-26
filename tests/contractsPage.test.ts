import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeContracts } from '../server/contracts.js';
import { freshnessCue, getDataStatus, type DataStatus } from '../server/dataStatus.js';
import { buildSave, type BuiltSave, type SaveSpec } from './syntheticSave';
import request from './request';
import { visibleText } from './visibleText';
import { BANNED_JARGON, BANNED_VERDICTS, bannedIn } from './bannedJargon';

/*
 * Player Value phase 6a: the Contracts page rebuilt on Player Value (BEHAVIOR_CASES.md "Player Value", phase 6a row;
 * PLAYER_VALUE.md Part 8). Every figure on the page is the valuation the card is served: next season's cost and the
 * cost path as the control timeline serves them, his expected wins, the contract value and the value of keeping him,
 * and our view under the club's philosophy. The page describes and never authorizes: no recommendation, no percentile.
 * An unknown is a short word with its reason on hover and sorts after every known figure. The GM sees the game date
 * the export is from, and when it is behind the save or could not be checked. Built on a synthetic save; no case
 * names a player or a figure.
 */

const SLOW = 120_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 8, minors: true, seed: 7 };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let save: BuiltSave;
let page: Any;

/** Words that are a verdict on a player: the page describes, it never tells the GM what to do (D-052). */


beforeAll(async () => {
  save = buildSave(spec);
  page = await request(`/api/contracts/${save.org}`);
}, SLOW);

describe('Contracts reads every figure from Player Value (phase 6a)', () => {
  it('lists the club\'s players with their contract, and computes no value of its own: every row is the valuation the card is served', async () => {
    expect(page.players.length).toBeGreaterThan(5);
    let valued = 0;
    for (const row of page.players) {
      const surplus = await request(`/api/player-value/${row.player_id}/surplus`);
      // Contract value, the value of keeping him and his wins are the Value section's totals, exactly
      expect(row.value, row.name).not.toBeNull();
      expect(row.value.status).toBe(surplus.status);
      expect(row.value.contract).toEqual(surplus.contract);
      expect(row.value.retention).toEqual(surplus.retention);
      expect(row.value.wins).toEqual(surplus.wins);
      if (surplus.status === 'valued') valued += 1;
    }
    expect(valued).toBeGreaterThan(3);
  }, SLOW);

  it('shows next season\'s cost and every season\'s cost on his path exactly as the control timeline serves them', async () => {
    let seen = 0;
    for (const row of page.players) {
      const value = await request(`/api/player-value/${row.player_id}`);
      const next = value.control.seasons.find((s: Any) => s.season === page.seasonYear + 1);
      if (next?.cost?.value) {
        expect(row.nextCost.low).toBe(next.cost.value.low);
        expect(row.nextCost.high).toBe(next.cost.value.high);
      }
      for (const step of row.path) {
        const s = value.control.seasons.find((x: Any) => x.season === step.season);
        expect(s, `${row.name} ${step.season}`).toBeDefined();
        if (s.cost?.value) {
          seen += 1;
          expect(step.cost.low).toBe(s.cost.value.low);
          expect(step.cost.high).toBe(s.cost.value.high);
          expect(step.cost.central ?? null).toBe(s.cost.value.central ?? (s.cost.value.low === s.cost.value.high ? s.cost.value.low : null));
        } else {
          // Unknown stays unknown: never a $0 cost, and never a free agent's cost to this club
          expect(step.cost === null || step.cost.low === null).toBe(true);
        }
        const wins = value.production.seasons.find((x: Any) => x.season === step.season);
        if (wins) expect(step.wins).toEqual({ low: wins.wins.low, central: wins.wins.central, high: wins.wins.high });
        else expect(step.wins).toBeNull();
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, SLOW);

  it('shows his expected wins next season as production states them, or not established with the reason', async () => {
    for (const row of page.players) {
      const value = await request(`/api/player-value/${row.player_id}`);
      const next = value.production.seasons.find((s: Any) => s.season === page.seasonYear + 1);
      if (next) expect(row.wins).toEqual({ season: page.seasonYear + 1, low: next.wins.low, central: next.wins.central, high: next.wins.high });
      else {
        expect(row.wins).toBeNull();
        expect(typeof row.winsReason).toBe('string');
      }
    }
  }, SLOW);

  it('shows our view as the lens reads him under the club\'s philosophy, beside the neutral figure and never in its place', async () => {
    for (const row of page.players.slice(0, 8)) {
      const read = await request(`/api/player-value/${row.player_id}/our-view?orgId=${save.org}`);
      expect(row.ourView.leaning).toBe(read.ourView.leaning);
      expect(row.ourView.contract).toEqual(read.ourView.contract);
      expect(row.ourView.retention).toEqual(read.ourView.retention);
      expect(row.ourView.leans.map((l: Any) => l.id)).toEqual(read.ourView.leans.map((l: Any) => l.id));
    }
  }, SLOW);

  it('says when his control ends as the timeline lays it out, and never guesses it where the timeline cannot', async () => {
    for (const row of page.players) {
      const value = await request(`/api/player-value/${row.player_id}`);
      const ends = value.control.controlEnds;
      if (ends !== null) expect(row.controlEnd.high).toBe(ends - 1);
      else if (value.control.continuesPastHorizon) expect(row.controlEnd.pastHorizon).toBe(true);
      else {
        expect(row.controlEnd.high).toBeNull();
        expect(row.controlEnd.reason).toBeTruthy();
      }
      if (row.controlEnd.low !== null && row.controlEnd.high !== null) expect(row.controlEnd.low).toBeLessThanOrEqual(row.controlEnd.high);
    }
  }, SLOW);
});

describe('Contracts shows no verdict (D-052: describes, never authorizes)', () => {
  it('carries no recommendation and no percentile of OOTP\'s value, in the page or in what the assistants read', () => {
    for (const row of page.players) {
      expect(row, row.name).not.toHaveProperty('recommendation');
      expect(row, row.name).not.toHaveProperty('overallPct');
      expect(row, row.name).not.toHaveProperty('talentPct');
    }
    const strings = JSON.stringify(page);
    expect(bannedIn(strings, [BANNED_VERDICTS])).toEqual([]);
  });

  it('the server builds no advice: no percentile cut-off and no recommendation function survive', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('server/contracts.ts', 'utf8');
    expect(source).not.toMatch(/recommendOnValue|function recommend\b|mlbPercentiler|valuesByPlayer|overallPct|talentPct|COMMITTING/);
  });
});

describe('the GM sees how current the page is (A-20)', () => {
  const status = (csv: Partial<DataStatus['freshness']['csv']>, save: string | null = '2040-06-01'): DataStatus => {
    const real = getDataStatus();
    return {
      ...real,
      save: { ...real.save, simulatedThrough: save },
      freshness: { ...real.freshness, save: { simulatedThrough: save }, csv: { ...real.freshness.csv, ...csv } },
    };
  };

  it('names the game date the export is from on every page', () => {
    expect(page.freshness).toBeDefined();
    expect(page.freshness.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('an export behind the save says the data may be out of date, and its service-dependent figures are not established', () => {
    const cue = freshnessCue(status({ state: 'behind', lagDays: 3, currentDate: '2040-05-29', through: '2040-05-28' }));
    expect(cue.state).toBe('behind');
    expect(cue.line).toMatch(/out of date/i);
    expect(cue.line).toMatch(/3 days/);
    const stale = computeContracts(save.org, status({ state: 'behind', lagDays: 3, currentDate: '2040-05-29', through: '2040-05-28' }));
    expect(stale.freshness.state).toBe('behind');
    const settled = stale.players.filter((p: Any) => p.control && p.control.status !== 'indeterminate' && p.control.status !== 'signed' && p.control.status !== 'extended' && p.control.status !== 'option');
    // Service cannot be read off an old export, so no status that turns on it is stated (D-023)
    expect(settled.map((p: Any) => `${p.name}: ${p.control.status}`)).toEqual([]);
  }, SLOW);

  it('an export nothing could date says it was not checked, and carries Player Rights\' limitation to the GM', () => {
    const cue = freshnessCue(status({ state: 'unverified', lagDays: 0 }, null));
    expect(cue.state).toBe('unverified');
    expect(cue.line).toMatch(/not checked/i);
    const read = computeContracts(save.org, status({ state: 'unverified', lagDays: 0 }, null));
    expect(read.freshness.limitations.join(' ')).toMatch(/could not be checked against the save/);
  }, SLOW);

  it('a current export needs no warning line', () => {
    const cue = freshnessCue(status({ state: 'current', lagDays: 0 }));
    expect(cue.line).toBeNull();
    expect(cue.detail.length).toBeGreaterThan(0);
  });
});

describe('the Contracts page, as the GM reads it', () => {
  it('talks like a front office: no percentile, verdict or method word in its visible text', async () => {
    const { ContractsView } = await import('../src/pages/Contracts');
    const html = renderToStaticMarkup(createElement(ContractsView, { data: page }));
    const text = visibleText(html);
    expect(text).toMatch(/Contract value/);
    expect(text).toMatch(/Keeping him/);
    expect(bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS])).toEqual([]);
  });

  it('shows an unknown as a short word with its reason on hover, never $0', async () => {
    const { ContractsView } = await import('../src/pages/Contracts');
    const unknown = { status: 'unknown', from: 2040, to: 2044, low: null, central: null, high: null, centralRange: null, missing: [2043, 2044], reason: 'His production is not established past 2042.', established: null, ifHeld: false };
    const row = { ...page.players[0], value: { ...page.players[0].value, status: 'unknown', contract: unknown, retention: unknown } };
    const html = renderToStaticMarkup(createElement(ContractsView, { data: { ...page, players: [row] } }));
    expect(html).toMatch(/His production is not established past 2042\./);
    expect(visibleText(html)).toMatch(/not valued/i);
    expect(visibleText(html)).not.toMatch(/\$0(?![.\d])/);
  });

  it('orders by any column with a keyboard-reachable header, and keeps unknowns after every known figure in either direction', async () => {
    const { ContractsView, sortRows } = await import('../src/pages/Contracts');
    const html = renderToStaticMarkup(createElement(ContractsView, { data: page }));
    // Each sortable header is a button inside a header cell that states its order
    expect((html.match(/<th[^>]*aria-sort="[a-z]+"[^>]*><button type="button"/g) ?? []).length).toBeGreaterThanOrEqual(6);
    // The table scrolls in its own box, never the page
    expect(html).toMatch(/class="contracts-table-scroll"/);
    const rows = page.players.map((p: Any, i: number) => ({ ...p, value: { ...p.value, retention: i % 3 === 0 ? { ...p.value.retention, status: 'unknown', central: null, low: null, high: null, centralRange: null } : p.value.retention } }));
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortRows(rows, 'keeping', dir);
      const firstUnknown = sorted.findIndex((r: Any) => r.value.retention.status !== 'known');
      expect(firstUnknown).toBeGreaterThan(0);
      expect(sorted.slice(firstUnknown).every((r: Any) => r.value.retention.status !== 'known')).toBe(true);
    }
  });

  it('groups the club by what happens after this season, and a row opens his card', async () => {
    const { ContractsView } = await import('../src/pages/Contracts');
    const html = renderToStaticMarkup(createElement(ContractsView, { data: page }));
    expect(html).toMatch(/class="status-chip/);
    expect(html).toMatch(/class="player-link"/);
    for (const row of page.players) expect(['leaving', 'option', 'arbitration', 'pre_arbitration', 'reserve', 'not_settled', 'signed', 'long_term']).toContain(row.group);
  });
});
