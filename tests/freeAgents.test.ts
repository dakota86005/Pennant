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
import { buildSave, type BuiltSave, type SaveSpec } from './syntheticSave';
import request from './request';
import { visibleText } from './visibleText';
import { BANNED_JARGON, BANNED_VERDICTS, bannedIn } from './bannedJargon';

/** A signing verdict on this page only (the Trade Center loads OOTP's trade targets); the rest are in `bannedJargon.ts`. */
const TARGET = /\btarget\w*/i;

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
  // Phase 6e: a club option on the last season of a veteran's deal elsewhere, the way the export writes one: next season is
  // the club's decision, and declined he is a free agent, so he might reach the market
  const veteran = db.prepare(`SELECT c.player_id FROM players_contract c JOIN players p ON p.player_id = c.player_id
    JOIN players_roster_status rs ON rs.player_id = c.player_id JOIN teams t ON t.team_id = p.team_id
    WHERE t.level = 1 AND p.organization_id != ? AND p.free_agent = 0 AND c.years = 1 AND c.is_major = 1
    ORDER BY rs.mlb_service_days DESC, c.player_id LIMIT 1`).get(save.org) as { player_id: number };
  optioned = veteran.player_id;
  db.prepare(`UPDATE players_contract SET years = 2, salary1 = salary0, last_year_team_option = 1 WHERE player_id = ?`).run(optioned);
  clearProductionCaches();
  page = await request(`/api/free-agents/${save.org}`);
}, SLOW);

/** The veteran given a club option on next season (phase 6e). */
let optioned: number;

const rows = (): Any[] => [...page.currentFAs, ...page.upcomingFAs, ...(page.mightReach ?? [])];

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

describe('Free Agents lists the players who might reach the market (phase 6e, the owner\'s answer of 2026-09-24)', () => {
  /** An option-like season: the club's, the player's, both, or his opt-out. */
  const OPTIONS = new Set(['club_option', 'player_option', 'vesting_option', 'mutual_option', 'opt_out']);
  /** Free agency is one of the ways it can go: a status not settled that may be free agency (or names nothing it lies between). */
  const open = (status: string, between: string[]) => status === 'free_agent'
    || (status === 'indeterminate' && (between.length === 0 || between.includes('free_agent')));

  /** Read from each player's control timeline, not from the page: whether free agency after this season is open. */
  function mightReach(id: number): boolean {
    const v = playerValue(id);
    // A contract that could not be read leaves free agency open too (D-018); a player no club signed is on another list
    if (v === null) return true;
    if (v.control.standing === 'unsigned') return false;
    if (v.control.thisSeason === null) return true;
    const next = v.control.seasons.find((s) => s.season === v.control.thisSeason! + 1);
    if (!next) return !(v.control.controlEnds !== null && v.control.controlEnds <= v.control.thisSeason);
    if (OPTIONS.has(next.status)) return next.declined ? open(next.declined.status, next.declined.between) : false;
    return next.status === 'indeterminate' && open(next.status, next.between);
  }

  const elsewhere = (): number[] => (db.prepare(`SELECT p.player_id FROM players p JOIN teams t ON t.team_id = p.team_id
    WHERE t.level = 1 AND t.allstar_team = 0 AND t.league_id = ? AND p.team_id != ? AND p.retired = 0`)
    .all(save.leagueId, save.org) as Array<{ player_id: number }>).map((r) => r.player_id);

  it('lists every player the control timeline leaves between staying and free agency after this season, and no one else', () => {
    expect(Array.isArray(page.mightReach)).toBe(true);
    const expected = elsewhere().filter(mightReach).sort((a, b) => a - b);
    expect(page.mightReach.map((r: Any) => r.player_id).sort((a: number, b: number) => a - b)).toEqual(expected);
    // The veteran with a club option on next season, declined into free agency, is there
    expect(page.mightReach.map((r: Any) => r.player_id)).toContain(optioned);
    // Never mixed into the free agents after this season
    const upcoming = new Set(page.upcomingFAs.map((r: Any) => r.player_id));
    for (const r of page.mightReach) expect(upcoming.has(r.player_id), r.name).toBe(false);
  }, SLOW);

  it('leaves off a player the club controls whichever way an open question goes', () => {
    const listed = new Set(page.mightReach.map((r: Any) => r.player_id));
    for (const id of elsewhere()) {
      const v = playerValue(id);
      const next = v?.control.seasons.find((s) => s.season === (v.control.thisSeason ?? 0) + 1);
      if (!next || next.status !== 'indeterminate' || next.between.length === 0) continue;
      if (!next.between.includes('free_agent')) expect(listed.has(id), `${id} lies between ${next.between.join(' and ')}`).toBe(false);
    }
  }, SLOW);

  it('says why each might reach the market, in a short word with the reason on hover', () => {
    for (const r of page.mightReach) {
      expect(typeof r.why?.label, r.name).toBe('string');
      expect(r.why.label.length).toBeGreaterThan(0);
      expect(r.why.label.length).toBeLessThanOrEqual(24);
      expect(r.why.reason.length).toBeGreaterThan(0);
    }
    const planted = page.mightReach.find((r: Any) => r.player_id === optioned);
    expect(planted.why.label).toMatch(/option/i);
  });

  it('is ordered by expected wins next season, unknown last, with the same figures as the other lists', () => {
    const order = page.mightReach.map((r: Any) => r.winsNext?.central ?? null);
    const firstNull = order.indexOf(null);
    const known = (firstNull < 0 ? order : order.slice(0, firstNull)) as number[];
    if (firstNull >= 0) expect(order.slice(firstNull).every((x: number | null) => x === null)).toBe(true);
    expect(known).toEqual([...known].sort((a, b) => b - a));
    for (const r of page.mightReach) {
      const v = playerValue(r.player_id)!;
      expect(r.market).toEqual(JSON.parse(JSON.stringify(marketValueOf({ production: v.production, market: surplusMarketOf(save.leagueId), season: spec.season + 1 }))));
      expect(r.team).toBeTruthy();
    }
  });

  it('shows the list as its own chip, with the reason on hover and no verdict or method word', async () => {
    const { FreeAgentsView } = await import('../src/pages/FreeAgents');
    const html = renderToStaticMarkup(createElement(FreeAgentsView, { data: page, initialList: 'mightReach' }));
    const text = visibleText(html);
    expect(text).toMatch(/Might reach the market/);
    const planted = page.mightReach.find((r: Any) => r.player_id === optioned);
    expect(text).toContain(planted.name);
    expect(text).toContain(planted.why.label);
    expect(html).toContain(`class="tip-pop">${planted.why.reason.replace(/'/g, '&#x27;').replace(/"/g, '&quot;')}`);
    expect(text).toMatch(/salary/i);
    expect(bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS])).toEqual([]);
    expect(text).not.toMatch(TARGET);
    // The count line that stood in for the list is gone: the players are listed now
    expect(text).not.toMatch(/could go either way/);
  });
});

describe('Free Agents shows no percentile and no signing verdict (D-052, D-017)', () => {
  it('carries no percentile of OOTP\'s value and no verdict, in the page or in what the assistants read', () => {
    for (const row of rows()) {
      for (const key of ['overallPct', 'talentPct', 'recommendation', 'lastSalary']) expect(row, `${row.name} ${key}`).not.toHaveProperty(key);
    }
    expect(page).not.toHaveProperty('holes');
    expect(bannedIn(JSON.stringify(page), [BANNED_VERDICTS])).toEqual([]);
    expect(JSON.stringify(page)).not.toMatch(TARGET);
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
    expect(bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS])).toEqual([]);
    expect(text).not.toMatch(TARGET);
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
