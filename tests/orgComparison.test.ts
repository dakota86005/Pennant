import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearProductionCaches, groupWinsOf } from '../server/playerValue.js';
import { ON_ROSTER } from '../server/valuation.js';
import { OrgComparisonPanel, sortClubs } from '../src/pages/OrgComparison';
import { buildSave, type BuiltSave, type SaveSpec } from './syntheticSave';
import request from './request';
import { visibleText } from './visibleText';
import { bannedIn } from './bannedJargon';

/*
 * Player Value phase 6d: Org Comparison rebuilt on Player Value and objective facts (BEHAVIOR_CASES.md "Player Value", phase
 * 6d row; PLAYER_VALUE.md Part 8, consumer 5). It summed OOTP's own overall and talent values (`players_value`) and ranked
 * the clubs by them. Now each organization's figures are Player Value's as served (the major-league roster's expected wins for
 * the rest of the season, the farm's expected wins next season, the roster's contract value) or objective facts (its record,
 * OOTP's payroll and budget); each sum is the sum of its players' served figures, combined as independent the way Payroll
 * combines players, a player whose figure is unknown named and left out. Nothing is ranked by a hidden score: the page orders
 * clubs only by a column it shows, unknown last either way. Built on a synthetic save; no case names a player or a figure.
 */

const SLOW = 180_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 6, minors: true, seed: 11 };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let save: BuiltSave;
let page: Any;
/** A rostered hitter whose production was made unknown (no results, no grades). */
let blank: number;

const rosterOf = (club: number): number[] =>
  (db.prepare(`SELECT p.player_id AS id FROM players p LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id
    WHERE p.team_id = ? AND p.retired = 0 AND ${ON_ROSTER}`).all(club) as Array<{ id: number }>).map((r) => r.id);
const farmOf = (club: number): number[] =>
  (db.prepare(`SELECT p.player_id AS id FROM players p JOIN teams t ON t.team_id = p.team_id
    WHERE p.organization_id = ? AND t.level > 1 AND p.retired = 0`).all(club) as Array<{ id: number }>).map((r) => r.id);

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)));

beforeAll(async () => {
  save = buildSave(spec);
  // One regular with nothing to read: no major-league line, no graded tools
  blank = rosterOf(save.clubs[1]).find((id) => save.hitters.includes(id))!;
  db.prepare(`DELETE FROM players_career_batting_stats WHERE player_id = ?`).run(blank);
  db.prepare(`DELETE FROM players_batting WHERE player_id = ?`).run(blank);
  clearProductionCaches();
  page = await request(`/api/org-comparison/${save.org}`);
}, SLOW);

describe('Org Comparison reads every figure from Player Value or the export (phase 6d)', () => {
  it('lists every major-league club of the viewer\'s league once, marks the viewer\'s, and sends no rank', () => {
    expect(page.clubs.map((c: Any) => c.team_id).sort((a: number, b: number) => a - b)).toEqual([...save.clubs].sort((a, b) => a - b));
    expect(page.clubs.filter((c: Any) => c.isViewer).map((c: Any) => c.team_id)).toEqual([save.org]);
    const keys = JSON.stringify(page).match(/"[A-Za-z]*[Rr]ank[A-Za-z]*":/g) ?? [];
    expect(keys).toEqual([]);
    expect(JSON.stringify(page)).not.toMatch(/overall_value|talent_value|mlbTalent|farmTalent|youngTalent|topProspect"/);
  });

  it('sums the major-league roster\'s expected wins for the rest of the season from each player\'s served valuation, naming who it leaves out', async () => {
    for (const club of page.clubs) {
      const sum = club.roster.wins;
      const roster = rosterOf(club.team_id);
      expect([...sum.playerIds, ...sum.excluded.map((x: Any) => x.player_id)].sort()).toEqual([...roster].sort());
      let central = 0;
      for (const id of sum.playerIds) {
        const v = await request(`/api/player-value/${id}`);
        const s = v.production.seasons[0];
        central += (s.remaining ?? s.wins).central;
      }
      if (sum.counted > 0) {
        close(sum.figure.central, central);
        expect(sum.figure.low).toBeLessThanOrEqual(sum.figure.central);
        expect(sum.figure.high).toBeGreaterThanOrEqual(sum.figure.central);
        expect(sum.edges.low).toBeLessThanOrEqual(sum.figure.low + 1e-9);
        expect(sum.edges.high).toBeGreaterThanOrEqual(sum.figure.high - 1e-9);
      }
      for (const x of sum.excluded) {
        expect(x.name, `${club.team} ${x.player_id}`).toBeTruthy();
        expect(x.reason, `${club.team} ${x.player_id}`).toMatch(/\w/);
      }
    }
  }, SLOW);

  it('names a player whose production is unknown and leaves him out, never counting him as zero', () => {
    const club = page.clubs.find((c: Any) => c.team_id === save.clubs[1]);
    expect(club.roster.wins.playerIds).not.toContain(blank);
    const named = club.roster.wins.excluded.find((x: Any) => x.player_id === blank);
    expect(named).toBeDefined();
    expect(club.roster.wins.text).toMatch(/leaves out/i);
  });

  it('sums the farm\'s expected wins next season from each player\'s served valuation', async () => {
    for (const club of page.clubs) {
      const sum = club.farm.wins;
      expect([...sum.playerIds, ...sum.excluded.map((x: Any) => x.player_id)].sort()).toEqual([...farmOf(club.team_id)].sort());
      let central = 0;
      for (const id of sum.playerIds) {
        const v = await request(`/api/player-value/${id}`);
        const next = v.production.seasons.find((s: Any) => s.season === page.nextSeason);
        expect(next, `${id}`).toBeDefined();
        central += next.wins.central;
      }
      if (sum.counted > 0) close(sum.figure.central, central);
      if (club.farm.top) {
        expect(sum.playerIds).toContain(club.farm.top.player_id);
      }
    }
  }, SLOW);

  it('sums the roster\'s contract value from each player\'s served value, the way Payroll combines players', async () => {
    for (const club of page.clubs) {
      const sum = club.roster.contract;
      let low = 0;
      let lowLikely = 0;
      let highLikely = 0;
      for (const id of sum.playerIds) {
        const s = await request(`/api/player-value/${id}/surplus`);
        const t = sum.unit === 'wins' ? s.wins : s.contract;
        expect(t.status, `${id}`).toBe('known');
        low += t.low;
        lowLikely += t.central ?? t.centralRange?.low ?? t.low;
        highLikely += t.central ?? t.centralRange?.high ?? t.high;
      }
      if (sum.counted > 0) {
        close(sum.edges.low, low);
        const f = sum.figure;
        if (f.central !== null) close(f.central, lowLikely);
        else { close(f.centralRange.low, lowLikely); close(f.centralRange.high, highLikely); }
        expect(sum.text).toMatch(/independent/);
      }
    }
  }, SLOW);

  it('reads payroll and budget as the export states them, never $0 for a figure it lacks', async () => {
    for (const club of page.clubs) {
      const f = await request(`/api/club-finances/${club.team_id}`);
      expect(club.payroll.value).toBe(f.club.payroll.now.value ?? null);
      expect(club.budget.value).toBe(f.club.budget.value ?? null);
    }
  });

  it('does not move when OOTP\'s own values do, and answers when the export carries none', async () => {
    const ids = (db.prepare(`SELECT player_id FROM players`).all() as Array<{ player_id: number }>).map((r) => r.player_id);
    const put = db.prepare(`INSERT INTO players_value (player_id, overall_value, talent_value, offensive_value, offensive_value_vsl, offensive_value_vsr, pitching_value, oa, pot, oa_rating, pot_rating) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)`);
    db.prepare(`DELETE FROM players_value`).run();
    ids.forEach((id, i) => put.run(id, (i * 37) % 2000, (i * 53) % 2000, 20 + (i % 60), 20 + (i % 60), 20, 20));
    const planted = await request(`/api/org-comparison/${save.org}`);
    db.prepare(`DELETE FROM players_value`).run();
    const none = await request(`/api/org-comparison/${save.org}`);
    expect(planted.clubs).toEqual(page.clubs);
    expect(none.clubs).toEqual(page.clubs);
  }, SLOW);
});

describe('a group of players\' expected wins, combined the Payroll way (phase 6d, pure)', () => {
  const band = (low: number, central: number, high: number) => ({ low, central, high });

  it('is one player\'s own band for one player, and around the sum of the most likely wins for several, inside every-player-at-his-edge', () => {
    const one = groupWinsOf([{ playerId: 1, wins: band(-0.4, 1.2, 3.1), reason: null }]);
    expect(one.figure).toEqual({ low: -0.4, central: 1.2, high: 3.1, centralRange: null });
    const many = groupWinsOf([
      { playerId: 1, wins: band(-0.4, 1.2, 3.1), reason: null },
      { playerId: 2, wins: band(0.1, 0.6, 1.4), reason: null },
      { playerId: 3, wins: band(-1.0, 2.5, 5.0), reason: null },
    ]);
    expect(many.figure!.central).toBeCloseTo(4.3, 12);
    expect(many.edges).toEqual({ low: -1.3, high: 9.5 });
    expect(many.figure!.low).toBeGreaterThanOrEqual(many.edges!.low - 1e-12);
    expect(many.figure!.high).toBeLessThanOrEqual(many.edges!.high + 1e-12);
    expect(many.figure!.low).toBeLessThan(4.3);
    expect(many.figure!.high).toBeGreaterThan(4.3);
    // Combined as independent: never narrower than the widest player's own distance on either side
    expect(4.3 - many.figure!.low).toBeGreaterThanOrEqual(3.5 - 1e-12);
    expect(many.figure!.high - 4.3).toBeGreaterThanOrEqual(2.5 - 1e-12);
  });

  it('names a player with no projection and leaves him out: adding him never changes the known sum, and nobody known is no total, never zero', () => {
    const known = [{ playerId: 1, wins: band(0, 1, 2), reason: null }, { playerId: 2, wins: band(0.5, 1, 1.5), reason: null }];
    const without = groupWinsOf(known);
    const withUnknown = groupWinsOf([...known, { playerId: 3, wins: null, reason: 'His production is not established.' }]);
    expect(withUnknown.figure).toEqual(without.figure);
    expect(withUnknown.edges).toEqual(without.edges);
    expect(withUnknown.counted).toEqual([1, 2]);
    expect(withUnknown.excluded).toEqual([{ playerId: 3, reason: 'His production is not established.' }]);
    const none = groupWinsOf([{ playerId: 3, wins: null, reason: 'x' }]);
    expect(none.status).toBe('none');
    expect(none.figure).toBeNull();
    expect(groupWinsOf([]).status).toBe('none');
  });
});

describe('the Org Comparison page (phase 6d)', () => {
  const html = (props: Partial<Parameters<typeof OrgComparisonPanel>[0]>) =>
    renderToStaticMarkup(createElement(OrgComparisonPanel, { data: null, loading: false, error: null, onRetry: () => {}, ...props }));

  it('highlights the viewer\'s club and talks like a front office: no rank, score or method word', () => {
    const markup = html({ data: page });
    expect(markup).toMatch(/class="[^"]*row-us[^"]*"/);
    const text = visibleText(markup);
    expect(text).toMatch(/Club 1/);
    expect(bannedIn(text)).toEqual([]);
    // No rank or place number: the page states no rank
    expect(text).not.toMatch(/#\d|\brank/i);
  });

  it('says in one short line who a sum leaves out', () => {
    const text = visibleText(html({ data: page }));
    expect(text).toMatch(/1 not counted/);
  });

  it('has designed loading, empty and error states', () => {
    expect(visibleText(html({ loading: true }))).toMatch(/Sizing up the league/);
    expect(visibleText(html({ data: { ...page, clubs: [] } }))).toMatch(/No clubs to compare/);
    const err = visibleText(html({ error: 'boom' }));
    expect(err).toMatch(/couldn.t be loaded/);
    expect(err).toMatch(/Try again/);
  });

  it('orders clubs only by a column it shows, a club whose figure is unknown after every known one either way', () => {
    const clubs = page.clubs.map((c: Any, i: number) => (i === 0 ? { ...c, roster: { ...c.roster, wins: { ...c.roster.wins, status: 'none', figure: null } } } : c));
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortClubs(clubs, 'rosterWins', dir);
      expect(sorted[sorted.length - 1].team_id, dir).toBe(clubs[0].team_id);
      const known = sorted.filter((c: Any) => c.roster.wins.figure).map((c: Any) => c.roster.wins.figure.central);
      expect(known, dir).toEqual([...known].sort((a: number, b: number) => (dir === 'asc' ? a - b : b - a)));
    }
  });
});
