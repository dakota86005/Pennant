import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, tableColumns } from '../server/db.js';
import { freshnessCue, getDataStatus, type DataStatus } from '../server/dataStatus.js';
import { computeFreeAgents } from '../server/freeagents.js';
import { positionNeeds } from '../server/positionNeeds.js';
import {
  clearProductionCaches, leagueFinances, marketValueOf, playerValue, productionHeadlineOf, surplusMarketFrom, surplusMarketOf,
} from '../server/playerValue.js';
import { loadScoutedAbilities } from '../server/scoutedEvidence.js';
import { clearValuationCaches } from '../server/valuation.js';
import { buildSave, type BuiltSave, type SaveSpec } from './syntheticSave';
import request from './request';
import { visibleText } from './visibleText';

/*
 * Player Value phase 6c: Free Agents on Player Value (BEHAVIOR_CASES.md "Player Value", phase 6c row; PLAYER_VALUE.md
 * Part 8, consumer 4). The page shows what Player Value knows about each free agent: his expected wins, his scouted tools
 * through the evidence boundary, and what a season of his production costs at this league's market (the league minimum
 * plus his wins × the price of a win in force), never a percentile of OOTP's value and never a signing verdict. Unknown
 * stays unknown and sorts last; no hidden value cut decides who is listed. Built on a synthetic save; no case names a
 * player or a figure.
 */

const SLOW = 120_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 8, minors: true, seed: 11 };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let save: BuiltSave;
let page: Any;
/** Free agents made here: two with a major-league record, one prospect with none (his production is unknown). */
let freeAgents: { veterans: number[]; unknown: number };

/** Words that tell the GM what to do with a free agent (D-052: the page describes, the GM decides). */
const VERDICT = /\b(sign(?:ing)? (?:him|now|them)|should|must|target\w*|recommend\w*|pass on|avoid him|a steal|bargain|overpa(?:y|id)|priority)\b/i;
/** Percentile and method words the GM never reads (AGENTS.md "Writing for the GM"). */
const JARGON = /percentile|\bpct\b|\bcentral\b|retention margin|\bsurplus\b|edge against edge|\bTalent\b|\bOA\b|\bPOT\b|indeterminate|players_value|\bD-\d{3}\b|\bA-\d+\b|\bnull\b|\bundefined\b|\bNaN\b/i;

/** Makes a player a free agent the way the export writes one: no club, no organization, a blank contract row, his last league named. */
function release(id: number): void {
  db.prepare(`UPDATE players SET team_id = 0, organization_id = 0, free_agent = 1, last_league_id = ? WHERE player_id = ?`).run(save.leagueId, id);
  db.prepare(`DELETE FROM players_roster_status WHERE player_id = ?`).run(id);
  db.prepare(`DELETE FROM team_roster WHERE player_id = ?`).run(id);
  db.prepare(`UPDATE players_contract SET team_id = 0, contract_team_id = 0, years = 0, season_year = 0, is_major = 0,
    salary0 = 0, salary1 = 0, salary2 = 0, salary3 = 0 WHERE player_id = ?`).run(id);
}

beforeAll(async () => {
  save = buildSave(spec);
  for (const column of ['free_agent', 'last_league_id']) {
    if (!tableColumns('players').includes(column)) db.prepare(`ALTER TABLE players ADD COLUMN ${column} INTEGER DEFAULT 0`).run();
  }
  db.prepare(`UPDATE players SET free_agent = 0, last_league_id = ?`).run(save.leagueId);
  const orgOf = db.prepare(`SELECT organization_id AS org FROM players WHERE player_id = ?`);
  const elsewhere = save.hitters.filter((id) => (orgOf.get(id) as { org: number }).org !== save.org);
  freeAgents = { veterans: [elsewhere[0], elsewhere[3]], unknown: save.prospects[0] };
  for (const id of [...freeAgents.veterans, freeAgents.unknown]) release(id);
  // The prospect's scouting too: no ability evidence and no major-league line, so his production is not established
  db.prepare(`DELETE FROM players_batting WHERE player_id = ?`).run(freeAgents.unknown);
  db.prepare(`DELETE FROM players_pitching WHERE player_id = ?`).run(freeAgents.unknown);
  clearValuationCaches();
  clearProductionCaches();
  page = await request(`/api/free-agents/${save.org}`);
}, SLOW);

const rows = (): Any[] => [...page.currentFAs, ...page.upcomingFAs];

describe('Free Agents shows what Player Value knows (phase 6c)', () => {
  it('lists the free agents in the club\'s league, and everyone reaching free agency after this season with no value cut', () => {
    const ids = page.currentFAs.map((r: Any) => r.player_id);
    for (const id of [...freeAgents.veterans, freeAgents.unknown]) expect(ids).toContain(id);
    // Everyone the control timeline finds leaving is listed: no hidden value cut-off decides who appears
    const leaving = db.prepare(`SELECT p.player_id FROM players p JOIN teams t ON t.team_id = p.team_id
      WHERE t.level = 1 AND t.league_id = ? AND p.team_id != ? AND p.retired = 0`).all(save.leagueId, save.org) as Array<{ player_id: number }>;
    const reaching = leaving.filter((p) => {
      const v = playerValue(p.player_id);
      const next = v?.control.seasons.find((s) => s.season === spec.season + 1);
      if (v === null || v.control.standing !== 'held') return false;
      // Next season is free agency, or control ends with this season and nothing is laid out beyond it
      return next ? next.status === 'free_agent' : v.control.controlEnds !== null && v.control.controlEnds <= spec.season;
    });
    expect(page.upcomingFAs.length).toBe(reaching.length);
    expect(page.upcomingFAs.length).toBeGreaterThan(0);
  }, SLOW);

  it('shows each player\'s expected wins exactly as production states them, or not established with the reason', () => {
    for (const row of rows()) {
      const v = playerValue(row.player_id)!;
      const head = productionHeadlineOf(v.production);
      if (head.next) expect(row.winsNext).toEqual({ season: head.next.season, low: head.next.wins.low, central: head.next.wins.central, high: head.next.wins.high });
      else {
        expect(row.winsNext).toBeNull();
        expect(typeof row.winsReason).toBe('string');
        expect(row.winsReason.length).toBeGreaterThan(0);
      }
      if (head.now) expect(row.winsNow).toEqual({ season: head.now.season, part: head.now.part, low: head.now.wins.low, central: head.now.wins.central, high: head.now.wins.high });
      else expect(row.winsNow).toBeNull();
    }
  }, SLOW);

  it('prices a season of his production at the market as Player Value serves it: the minimum plus his wins × the price of a win, a band around its most likely', () => {
    const market = surplusMarketOf(save.leagueId);
    expect(market).not.toBeNull();
    // The market the surplus reads is the league's own, as Club Finances serves it
    expect(market!.price).toEqual(surplusMarketFrom(leagueFinances(save.leagueId)).price);
    let priced = 0;
    for (const row of rows()) {
      const v = playerValue(row.player_id)!;
      expect(row.market).toEqual(JSON.parse(JSON.stringify(marketValueOf({ production: v.production, market, season: spec.season + 1 }))));
      if (row.market.status === 'known') {
        priced += 1;
        const price = market!.price.value!;
        const min = market!.minimumSalary.value!;
        expect(row.market.low).toBeLessThanOrEqual(row.market.central);
        expect(row.market.central).toBeLessThanOrEqual(row.market.high);
        expect(row.market.central).toBeCloseTo(min + row.winsNext.central * price.central, 0);
        expect(row.market.text.length).toBeGreaterThan(0);
      } else {
        expect(row.market.low).toBeNull();
        expect(row.market.reason.length).toBeGreaterThan(0);
      }
    }
    expect(priced).toBeGreaterThan(0);
  }, SLOW);

  it('shows his scouted tools now and at their ceiling exactly as the evidence boundary serves them', () => {
    for (const row of rows()) {
      const a = loadScoutedAbilities([row.player_id]).for(row.player_id);
      expect(row.scouted.now).toBe(a.current);
      expect(row.scouted.ceiling).toBe(a.potential);
    }
    // The prospect without scouting has none: never a stand-in
    const unknown = page.currentFAs.find((r: Any) => r.player_id === freeAgents.unknown);
    expect(unknown.scouted.now).toBeNull();
  }, SLOW);

  it('a free agent whose production is unknown shows it with the reason and sorts last, never zero', async () => {
    const unknown = page.currentFAs.find((r: Any) => r.player_id === freeAgents.unknown);
    expect(unknown.winsNext).toBeNull();
    expect(unknown.winsReason).toBeTruthy();
    expect(unknown.market.status).toBe('unknown');
    // The server's own order: expected wins next season, most first, not known last
    const order = page.currentFAs.map((r: Any) => r.winsNext?.central ?? null);
    const firstNull = order.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(order.slice(firstNull).every((x: number | null) => x === null)).toBe(true);
    const known = order.slice(0, firstNull) as number[];
    expect(known).toEqual([...known].sort((a, b) => b - a));
    expect(page.order).toMatch(/expected wins/i);
    // ...and the page's sort keeps him last whichever way a column is ordered
    const { sortFreeAgents } = await import('../src/pages/FreeAgents');
    for (const key of ['winsNext', 'market', 'scouted', 'winsNow'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        const sorted = sortFreeAgents(page.currentFAs, key, dir);
        expect(sorted[sorted.length - 1].player_id, `${key} ${dir}`).toBe(freeAgents.unknown);
      }
    }
  }, SLOW);

  it('names the club\'s thinnest positions by the expected wins of its best player there, each figure shown, never a hidden score', () => {
    const needs = positionNeeds(save.org);
    expect(page.needs).toEqual(JSON.parse(JSON.stringify(needs)));
    expect(needs.positions.length).toBe(8);
    const known = needs.positions.filter((p) => p.best !== null);
    for (const p of known) {
      const v = playerValue(p.best!.player_id)!;
      expect(p.best!.wins).toBe(productionHeadlineOf(v.production).now!.wins.central);
    }
    // Thinnest first, and a position with nobody valued after every known one, never read as zero
    const wins = known.map((p) => p.best!.wins);
    expect(wins).toEqual([...wins].sort((a, b) => a - b));
    expect(needs.positions.slice(0, known.length).every((p) => p.best !== null)).toBe(true);
    expect(needs.thinnest).toEqual(known.slice(0, 3).map((p) => p.positionName));
    expect(JSON.stringify(needs)).not.toMatch(/bestValue|overall/);
  }, SLOW);
});

describe('Free Agents shows no percentile and no signing verdict (D-052, D-017)', () => {
  it('carries no percentile of OOTP\'s value and no verdict, in the page or in what the assistants read', () => {
    for (const row of rows()) {
      for (const key of ['overallPct', 'talentPct', 'recommendation', 'lastSalary']) expect(row, `${row.name} ${key}`).not.toHaveProperty(key);
    }
    expect(page).not.toHaveProperty('holes');
    expect(JSON.stringify(page)).not.toMatch(VERDICT);
  });

  it('the server reads no players_value figure and builds no cut-off', () => {
    const source = fs.readFileSync('server/freeagents.ts', 'utf8');
    expect(source).not.toMatch(/valuesByPlayer|mlbPercentiler|overallPct|talentPct|contractsByPlayer|rosterHoles|>= 40/);
  });
});

describe('the Free Agents page, as the GM reads it', () => {
  it('talks like a front office: no percentile, jargon or verdict word in its visible text', async () => {
    const { FreeAgentsView } = await import('../src/pages/FreeAgents');
    const text = visibleText(renderToStaticMarkup(createElement(FreeAgentsView, { data: page })));
    expect(text).toMatch(/Available now/);
    expect(text).toMatch(/at the market/i);
    expect(text).toMatch(/As of/);
    expect(text).not.toMatch(JARGON);
    expect(text).not.toMatch(VERDICT);
  });

  it('has keyboard-sortable headers with their explanations, and the table scrolls in its own box', async () => {
    const { FreeAgentsView } = await import('../src/pages/FreeAgents');
    const html = renderToStaticMarkup(createElement(FreeAgentsView, { data: page }));
    expect((html.match(/<th[^>]*aria-sort="[a-z]+"[^>]*><button type="button"/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(html).toMatch(/class="tip-pop"/);
    expect(html).toMatch(/class="contracts-table-scroll"/);
    expect(html).toMatch(/class="player-link"/);
  });

  it('shows an unknown as a short word with its reason on hover, never $0', async () => {
    const { FreeAgentsView } = await import('../src/pages/FreeAgents');
    const html = renderToStaticMarkup(createElement(FreeAgentsView, { data: { ...page, upcomingFAs: [], currentFAs: page.currentFAs.filter((r: Any) => r.player_id === freeAgents.unknown) } }));
    const unknown = page.currentFAs.find((r: Any) => r.player_id === freeAgents.unknown);
    expect(html).toContain(unknown.winsReason.replace(/'/g, '&#x27;'));
    expect(visibleText(html)).toMatch(/not known/);
    expect(visibleText(html)).not.toMatch(/\$0(?![.\d])/);
  });

  it('has designed empty, loading and error states', async () => {
    const { FreeAgentsView, FreeAgentsState } = await import('../src/pages/FreeAgents');
    const empty = visibleText(renderToStaticMarkup(createElement(FreeAgentsView, { data: { ...page, currentFAs: [], upcomingFAs: [] } })));
    expect(empty).toMatch(/No free agents/i);
    expect(visibleText(renderToStaticMarkup(createElement(FreeAgentsState, { error: null })))).toMatch(/Loading free agents/);
    const error = renderToStaticMarkup(createElement(FreeAgentsState, { error: 'The server could not be reached.', onRetry: () => {} }));
    expect(visibleText(error)).toMatch(/couldn.t be loaded/);
    expect(error).toMatch(/<button[^>]*>Try again<\/button>/);
  });
});

describe('Free Agents says how current it is (A-20)', () => {
  const status = (csv: Partial<DataStatus['freshness']['csv']>, simulated: string | null = '2040-06-01'): DataStatus => {
    const real = getDataStatus();
    return {
      ...real,
      save: { ...real.save, simulatedThrough: simulated },
      freshness: { ...real.freshness, save: { simulatedThrough: simulated }, csv: { ...real.freshness.csv, ...csv } },
    };
  };

  it('names the game date the export is from', () => {
    expect(page.freshness.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('an export behind the save says so, and hands Player Value the stale state: no one is said to reach the market on service it cannot read', () => {
    const behind = status({ state: 'behind', lagDays: 3, currentDate: '2040-05-29', through: '2040-05-28' });
    expect(freshnessCue(behind).state).toBe('behind');
    const stale = computeFreeAgents(save.org, behind);
    expect(stale.freshness.state).toBe('behind');
    expect(stale.upcomingFAs.length).toBeLessThan(page.upcomingFAs.length);
    expect(stale.upcomingIndeterminate).toBeGreaterThan(page.upcomingIndeterminate);
  }, SLOW);
});
