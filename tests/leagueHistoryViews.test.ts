import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { api } from '../server/api.js';
import { db, tableExists } from '../server/db.js';
import { computeFranchise, computeOrgComparison, type OrgComparison } from '../server/franchise.js';
import { computeTenure } from '../server/gameplan.js';
import { franchiseUnread, franchiseViewOf, orgComparisonUnread, orgComparisonViewOf } from '../server/leagueHistoryViews.js';
import { officeContextFor } from '../server/leagueViewsBuild.js';
import { assertAuthored } from '../server/presentation/claim.js';
import type { OfficeContext } from '../server/presentation/league/common.js';
import { orgComparisonView } from '../server/presentation/league/orgComparison.js';
import { bannedInPayload } from './bannedJargon';
import { buildSave, insert, type BuiltSave } from './syntheticSave';

/*
 * League Office's Org Comparison and Franchise History (N12 Track B, D-072): they say only what the React pages' routes
 * compute (`/api/org-comparison`, `/api/franchise`, `/api/tenure`), worded once on the server. The franchise and tenure
 * routes were extracted into `computeFranchise` and `computeTenure`; each old route answers exactly what its module
 * computes, and each module answers exactly what the handler before it did (kept below, verbatim, as the reference).
 */

const HISTORY = 86;
const SEASON = 2016;
const FIRST = SEASON - HISTORY;

let save: BuiltSave;
let v: OfficeContext;
let base = '';
let close = (): void => {};

/** The old `/api/franchise/:teamId` handler's body, as it was before the extraction (with the financials' columns present). */
function oldFranchise(teamId: number): { status: number; body: unknown } {
  if (!tableExists('team_history_record')) return { status: 400, body: { error: 'This export has no franchise history' } };
  const hasHistory = tableExists('team_history');
  const hasFinancials = tableExists('team_history_financials');
  const rows = db.prepare(
    `SELECT r.year, r.g, r.w, r.l, r.pct, r.pos, r.gb
            ${hasHistory ? `, h.name, h.made_playoffs, h.won_playoffs, h.best_hitter_id, h.best_pitcher_id` : ''}
            ${hasFinancials ? `, f.player_expenses AS payroll, f.attendance` : ''}
     FROM team_history_record r
     ${hasHistory ? 'LEFT JOIN team_history h ON h.team_id = r.team_id AND h.year = r.year' : ''}
     ${hasFinancials ? 'LEFT JOIN team_history_financials f ON f.team_id = r.team_id AND f.year = r.year' : ''}
     WHERE r.team_id = ? AND r.g > 0
     ORDER BY r.year DESC`,
  ).all(teamId) as Array<Record<string, number | string | null>>;
  if (rows.length === 0) return { status: 200, body: { seasons: [], summary: null } };
  const ids = [...new Set(rows.flatMap((r) => [r.best_hitter_id, r.best_pitcher_id]).filter((x): x is number => !!x))];
  const names = new Map<number, string>();
  if (ids.length > 0) {
    for (const p of db.prepare(`SELECT player_id, first_name || ' ' || last_name AS name FROM players WHERE player_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as Array<{ player_id: number; name: string }>) names.set(p.player_id, p.name);
  }
  const seasons = rows.map((r) => ({
    year: r.year, w: r.w as number, l: r.l as number, pct: r.pct as number, finish: r.pos, gb: r.gb, name: r.name ?? null,
    madePlayoffs: r.made_playoffs === 1, wonTitle: r.won_playoffs === 1,
    bestHitter: r.best_hitter_id ? { player_id: r.best_hitter_id, name: names.get(r.best_hitter_id as number) ?? null } : null,
    bestPitcher: r.best_pitcher_id ? { player_id: r.best_pitcher_id, name: names.get(r.best_pitcher_id as number) ?? null } : null,
    payroll: r.payroll ?? null, attendance: r.attendance ?? null,
  }));
  const wins = seasons.reduce((sum, s) => sum + s.w, 0);
  const losses = seasons.reduce((sum, s) => sum + s.l, 0);
  const best = [...seasons].sort((a, b) => b.pct - a.pct)[0];
  const worst = [...seasons].sort((a, b) => a.pct - b.pct)[0];
  return {
    status: 200,
    body: {
      seasons,
      summary: {
        seasons: seasons.length, firstYear: seasons[seasons.length - 1].year, lastYear: seasons[0].year, wins, losses,
        pct: wins + losses > 0 ? wins / (wins + losses) : 0,
        titles: seasons.filter((s) => s.wonTitle).length, playoffs: seasons.filter((s) => s.madePlayoffs).length,
        bestSeason: best ? { year: best.year, w: best.w, l: best.l } : null,
        worstSeason: worst ? { year: worst.year, w: worst.w, l: worst.l } : null,
      },
    },
  };
}

/** The old `/api/tenure/:teamId` handler's body, as it was before the extraction: a read per name (the N+1 it had). */
function oldTenure(teamId: number): unknown {
  if (!tableExists('human_manager_history_record')) return { seasons: [] };
  const records = db.prepare(`SELECT year, team_id, g, w, l, pos, pct, gb FROM human_manager_history_record ORDER BY year`)
    .all() as Array<{ year: number; team_id: number; g: number; w: number; l: number; pos: number; pct: number; gb: number | null }>;
  const extra = tableExists('human_manager_history')
    ? db.prepare(`SELECT year, team_id, made_playoffs, won_playoffs, fired, best_hitter_id, best_pitcher_id, best_rookie_id FROM human_manager_history`)
      .all() as Array<Record<string, number>>
    : [];
  const byYear = new Map(extra.map((e) => [`${e.year}:${e.team_id}`, e]));
  const nameOf = (id: number | undefined): string | null => {
    if (!id) return null;
    const p = db.prepare(`SELECT first_name || ' ' || last_name AS n FROM players WHERE player_id = ?`).get(id) as { n: string } | undefined;
    return p?.n ?? null;
  };
  const labels = new Map((db.prepare(`SELECT team_id, CASE WHEN t.name = t.nickname THEN t.name ELSE t.name || ' ' || t.nickname END AS label FROM teams t`)
    .all() as Array<{ team_id: number; label: string }>).map((r) => [r.team_id, r.label]));
  const seasons = records.map((r) => {
    const e = byYear.get(`${r.year}:${r.team_id}`);
    return {
      year: r.year, club: labels.get(r.team_id) ?? 'Unknown', g: r.g, w: r.w, l: r.l, pct: r.pct, finish: r.pos, gb: r.gb,
      madePlayoffs: e?.made_playoffs === 1, wonPlayoffs: e?.won_playoffs === 1, fired: e?.fired === 1,
      bestHitter: nameOf(e?.best_hitter_id), bestPitcher: nameOf(e?.best_pitcher_id), bestRookie: nameOf(e?.best_rookie_id),
    };
  });
  const totals = seasons.reduce((a, s) => ({
    seasons: a.seasons + 1, w: a.w + s.w, l: a.l + s.l, playoffs: a.playoffs + (s.madePlayoffs ? 1 : 0), titles: a.titles + (s.wonPlayoffs ? 1 : 0),
  }), { seasons: 0, w: 0, l: 0, playoffs: 0, titles: 0 });
  return { seasons, totals: { ...totals, pct: totals.w + totals.l > 0 ? totals.w / (totals.w + totals.l) : null }, teamId };
}

function addManagerHistory(): void {
  db.exec('CREATE TABLE IF NOT EXISTS human_manager_history_record (year INTEGER, team_id INTEGER, g INTEGER, w INTEGER, l INTEGER, pos INTEGER, pct REAL, gb REAL)');
  db.exec('CREATE TABLE IF NOT EXISTS human_manager_history (year INTEGER, team_id INTEGER, made_playoffs INTEGER, won_playoffs INTEGER, fired INTEGER, best_hitter_id INTEGER, best_pitcher_id INTEGER, best_rookie_id INTEGER)');
  db.exec('DELETE FROM human_manager_history_record; DELETE FROM human_manager_history');
  for (let k = 0; k < 6; k += 1) {
    const year = SEASON - 6 + k;
    const team = k < 3 ? 2 : save.org;
    insert('human_manager_history_record', { year, team_id: team, g: 60, w: 30 + k, l: 30 - k, pos: k % 3 === 0 ? 0 : 1 + k, pct: (30 + k) / 60, gb: k === 0 ? null : k % 2 ? 0 : 3.5 });
    insert('human_manager_history', {
      year, team_id: team, made_playoffs: k >= 4 ? 1 : 0, won_playoffs: k === 5 ? 1 : 0, fired: k === 2 ? 1 : 0,
      best_hitter_id: save.hitters[k], best_pitcher_id: k === 1 ? 0 : save.pitchers[k], best_rookie_id: k % 2 ? save.prospects[k] : null,
    });
  }
}

beforeAll(async () => {
  const started = performance.now();
  save = buildSave({ season: SEASON, historySeasons: HISTORY, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true, teamSeason: true });
  console.log(`[leagueHistoryViews] synthetic save with ${HISTORY} past seasons built in ${Math.round(performance.now() - started)} ms`);
  // The past finances as a current export has them (the synthetic save's table lacks these two)
  const have = (db.prepare(`PRAGMA table_info(team_history_financials)`).all() as Array<{ name: string }>).map((c) => c.name);
  if (!have.includes('player_expenses')) db.exec('ALTER TABLE team_history_financials ADD COLUMN player_expenses REAL');
  if (!have.includes('attendance')) db.exec('ALTER TABLE team_history_financials ADD COLUMN attendance INTEGER');
  // How each season ended and its best players: a title every 21 years, the playoffs every 7; the latest 20 seasons' payroll
  for (const club of save.clubs) {
    for (let year = FIRST; year < SEASON; year += 1) {
      const i = year - FIRST;
      insert('team_history', {
        team_id: club, year, name: `Club ${club} ${year < 1970 ? 'Old' : 'N'}`, made_playoffs: i % 7 === 0 ? 1 : 0, won_playoffs: i % 21 === 0 ? 1 : 0,
        best_hitter_id: i % 5 === 0 ? 0 : save.hitters[i % save.hitters.length], best_pitcher_id: i % 3 === 0 ? null : save.pitchers[i % save.pitchers.length],
      });
      if (year >= SEASON - 20) insert('team_history_financials', { team_id: club, year, player_expenses: 80e6 + i * 1e5, attendance: 0 });
    }
  }
  addManagerHistory();
  v = officeContextFor({ orgId: save.org, importStamp: null, reportStamp: 'r1' }, 'league');
  const app = express();
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
}, 300_000);

afterAll(() => {
  db.exec('DROP TABLE IF EXISTS human_manager_history_record; DROP TABLE IF EXISTS human_manager_history');
  close();
});

async function routeAnswers(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}/api/${path}`);
  return { status: res.status, text: await res.text() };
}

/** Every string anywhere in a payload, the bases' included. */
function allStrings(value: unknown, at = '$'): Array<{ at: string; text: string }> {
  if (typeof value === 'string') return [{ at, text: value }];
  if (Array.isArray(value)) return value.flatMap((x, i) => allStrings(x, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) => allStrings(x, `${at}.${k}`));
}

const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\d+% to reach/i, /\bcontend/i, /\brebuild/i];

describe('the franchise and tenure routes, extracted (N12)', () => {
  it('the franchise route answers exactly what computeFranchise computes, and that is what the old handler answered', async () => {
    for (const id of [...save.clubs, ...save.farmClubs, 999_999]) {
      const computed = computeFranchise(id);
      if (!computed.ok) throw new Error(computed.error);
      const route = await routeAnswers(`franchise/${id}`);
      expect(route.status, `franchise/${id}`).toBe(200);
      expect(route.text, `franchise/${id}`).toBe(JSON.stringify(computed.body));
      const old = oldFranchise(id);
      expect(JSON.stringify(computed.body), `franchise/${id} against the old handler`).toBe(JSON.stringify(old.body));
    }
    const ours = computeFranchise(save.org);
    expect(ours.ok && ours.body.seasons.length).toBe(HISTORY);
  });

  it('refuses as the old route did on an export without the history, and reads past finances without their columns as not known', async () => {
    db.exec('ALTER TABLE team_history_record RENAME TO zz_team_history_record');
    try {
      const computed = computeFranchise(save.org);
      expect(computed).toEqual({ ok: false, status: 400, error: 'This export has no franchise history' });
      const route = await routeAnswers(`franchise/${save.org}`);
      expect(route.status).toBe(400);
      expect(JSON.parse(route.text)).toEqual({ error: 'This export has no franchise history' });
      expect(oldFranchise(save.org)).toEqual({ status: 400, body: { error: 'This export has no franchise history' } });
    } finally {
      db.exec('ALTER TABLE zz_team_history_record RENAME TO team_history_record');
    }
    // An older export's past finances without the payroll column: the old handler failed the whole history; now it is not known
    db.exec('ALTER TABLE team_history_financials RENAME COLUMN player_expenses TO zz_player_expenses');
    try {
      const computed = computeFranchise(save.org);
      expect(computed.ok).toBe(true);
      if (computed.ok) expect(computed.body.seasons.every((s) => s.payroll === null)).toBe(true);
    } finally {
      db.exec('ALTER TABLE team_history_financials RENAME COLUMN zz_player_expenses TO player_expenses');
    }
  });

  it('the tenure route answers exactly what computeTenure computes, the same as the old read of one name at a time', async () => {
    for (const id of [save.org, 2, 999_999]) {
      const computed = computeTenure(id);
      if (!computed.ok) throw new Error(computed.error);
      const route = await routeAnswers(`tenure/${id}`);
      expect(route.status).toBe(200);
      expect(route.text).toBe(JSON.stringify(computed.body));
      expect(JSON.stringify(computed.body)).toBe(JSON.stringify(oldTenure(id)));
    }
    const t = computeTenure(save.org);
    expect(t.ok && t.body.seasons.length).toBe(6);
    expect(t.ok && t.body.seasons.some((s) => s.bestRookie !== null && s.bestPitcher === null)).toBe(true);
    db.exec('ALTER TABLE human_manager_history_record RENAME TO zz_hmhr');
    try {
      expect(computeTenure(save.org)).toEqual({ ok: true, body: { seasons: [] } });
      expect((await routeAnswers(`tenure/${save.org}`)).text).toBe(JSON.stringify({ seasons: [] }));
    } finally {
      db.exec('ALTER TABLE zz_hmhr RENAME TO human_manager_history_record');
    }
  });
});

describe('Franchise History serves every season (N12)', () => {
  it('serves all 86 seasons: the chart oldest first, the table latest first, fast', () => {
    const started = performance.now();
    const view = franchiseViewOf(v, save.org);
    const ms = performance.now() - started;
    console.log(`[leagueHistoryViews] franchiseViewOf with ${HISTORY} seasons: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
    assertAuthored(view);
    const route = computeFranchise(save.org);
    if (!route.ok) throw new Error(route.error);
    const years = route.body.seasons.map((s) => s.year);
    expect(years).toHaveLength(HISTORY);
    expect(view.chart!.points.map((p) => p.year)).toEqual([...years].reverse());
    expect(view.seasons.table.rows.map((r) => r.sort.year)).toEqual(years);
    expect(view.chart!.points[0].year).toBe(FIRST);
    expect(view.chart!.summary).toMatch(new RegExp(`86 seasons, ${FIRST} to ${SEASON - 1}`));
    expect(view.chart!.legend.map((l) => l.result)).toEqual(['title', 'playoffs', 'none']);
    expect(view.empty).toBeNull();
    expect(view.club).toMatchObject({ teamId: save.org, ours: true });
  });

  it('marks titles and playoff seasons as the route does, and its best and worst season are the route\'s', () => {
    const view = franchiseViewOf(v, save.org);
    const route = computeFranchise(save.org);
    if (!route.ok || !route.body.summary) throw new Error('no history');
    const byYear = new Map(route.body.seasons.map((s) => [s.year, s]));
    for (const p of view.chart!.points) {
      const s = byYear.get(p.year)!;
      expect(p.result).toBe(s.wonTitle ? 'title' : s.madePlayoffs ? 'playoffs' : 'none');
      expect(p.display).toBe(`${p.year}: ${s.w}-${s.l}${s.wonTitle ? ', won it all' : s.madePlayoffs ? ', made the playoffs' : ''}`);
    }
    for (const r of view.seasons.table.rows) {
      const s = byYear.get(r.sort.year as number)!;
      expect(r.cells.result.display).toBe(s.wonTitle ? 'Won it all' : s.madePlayoffs ? 'Playoffs' : 'No playoffs');
    }
    const sum = route.body.summary;
    const tile = (text: string) => view.figures.find((f) => f.text === text)!;
    expect(tile('Best season').value!.display).toBe(`${sum.bestSeason!.year}: ${sum.bestSeason!.w}–${sum.bestSeason!.l}`);
    expect(tile('Worst season').value!.display).toBe(`${sum.worstSeason!.year}: ${sum.worstSeason!.w}–${sum.worstSeason!.l}`);
    expect(view.figures[0].value!.n).toBe(HISTORY);
    expect(view.figures.find((f) => f.text.startsWith('Titles'))!.value!.n).toBe(sum.titles);
  });

  it('serves a column no season fills hidden, says a blank season is not known (never zero), and opens the best players', () => {
    const view = franchiseViewOf(v, save.org);
    const cols = new Map(view.seasons.table.columns.map((c) => [c.id, c]));
    expect(cols.get('payroll')!.hidden).toBeUndefined();
    expect(cols.get('best')!.hidden).toBeUndefined();
    expect(cols.get('finish')!.hidden).toBeUndefined();
    expect(cols.get('attendance')!.hidden).toBe(true);
    const oldest = view.seasons.table.rows[view.seasons.table.rows.length - 1];
    expect(oldest.cells.payroll).toMatchObject({ display: 'Not known', tone: 'unknown' });
    expect(oldest.sort.payroll).toBeNull();
    expect(oldest.cells.attendance.display).toBe('Not known');
    const named = view.seasons.table.rows.filter((r) => (r.players ?? []).length > 0);
    expect(named.length).toBeGreaterThan(40);
    for (const r of named) for (const p of r.players!) expect(p.open).toMatchObject({ kind: 'player', playerId: p.playerId });
    // No season with a payroll: the column is served hidden
    db.exec('UPDATE team_history_financials SET player_expenses = NULL');
    try {
      const without = franchiseViewOf(v, save.org);
      expect(without.seasons.table.columns.find((c) => c.id === 'payroll')!.hidden).toBe(true);
    } finally {
      db.exec(`UPDATE team_history_financials SET player_expenses = 80000000 + (year - ${FIRST}) * 100000`);
    }
  });

  it('says a season the history has no line for is not known, never "no playoffs", and counts it nowhere (D-018)', () => {
    const saved = db.prepare(`SELECT * FROM team_history WHERE team_id = ? AND year < ?`).all(save.org, FIRST + 10) as Array<Record<string, unknown>>;
    db.prepare(`DELETE FROM team_history WHERE team_id = ? AND year < ?`).run(save.org, FIRST + 10);
    try {
      const view = franchiseViewOf(v, save.org);
      const oldRows = view.seasons.table.rows.filter((r) => (r.sort.year as number) < FIRST + 10);
      expect(oldRows).toHaveLength(10);
      for (const r of oldRows) {
        expect(r.cells.result).toMatchObject({ display: 'Not known', tone: 'unknown' });
        expect(r.sort.result).toBeNull();
      }
      expect(view.chart!.points.slice(0, 10).every((p) => p.result === 'none' && !p.display.includes(','))).toBe(true);
      expect(view.chart!.caption.basis.unknown.join(' ')).toMatch(/How 10 seasons ended/);
      // None at all: nothing is marked, and the titles are not known rather than zero
      db.prepare(`DELETE FROM team_history WHERE team_id = ?`).run(save.org);
      const none = franchiseViewOf(v, save.org);
      expect(none.seasons.table.rows.every((r) => r.cells.result.display === 'Not known')).toBe(true);
      expect(none.chart!.points.every((p) => p.result === 'none')).toBe(true);
      expect(none.figures.find((f) => f.text === 'Titles')!.value).toMatchObject({ n: null, display: 'Not known' });
      expect(bannedInPayload(none)).toEqual([]);
    } finally {
      db.prepare(`DELETE FROM team_history WHERE team_id = ?`).run(save.org);
      for (let year = FIRST; year < SEASON; year += 1) {
        const i = year - FIRST;
        insert('team_history', {
          team_id: save.org, year, name: `Club ${save.org} ${year < 1970 ? 'Old' : 'N'}`, made_playoffs: i % 7 === 0 ? 1 : 0, won_playoffs: i % 21 === 0 ? 1 : 0,
          best_hitter_id: i % 5 === 0 ? 0 : save.hitters[i % save.hitters.length], best_pitcher_id: i % 3 === 0 ? null : save.pitchers[i % save.pitchers.length],
        });
      }
      expect(saved.length).toBe(10);
    }
  });

  it('serves the GM\'s tenure when the manager\'s history exists, and null when it doesn\'t', () => {
    const view = franchiseViewOf(v, save.org);
    expect(view.tenure).not.toBeNull();
    expect(view.tenure!.seasons.table.rows).toHaveLength(6);
    expect(view.tenure!.figures.map((f) => f.text)).toEqual(['Seasons', 'Record', 'Playoffs', 'Titles']);
    const fired = view.tenure!.seasons.table.rows.find((r) => r.cells.result.display.includes('Fired'))!;
    expect(fired.cells.result.tone).toBe('bad');
    db.exec('ALTER TABLE human_manager_history_record RENAME TO zz_hmhr');
    try {
      expect(franchiseViewOf(v, save.org).tenure).toBeNull();
    } finally {
      db.exec('ALTER TABLE zz_hmhr RENAME TO human_manager_history_record');
    }
  });

  it('says so on an export without the history, and when it couldn\'t be read', () => {
    db.exec('ALTER TABLE team_history_record RENAME TO zz_team_history_record');
    try {
      const view = franchiseViewOf(v, save.org);
      expect(view.empty?.display).toBe('No franchise history: this export has no franchise history.');
      expect(view.chart).toBeNull();
      expect(view.seasons.table.rows).toEqual([]);
      assertAuthored(view);
    } finally {
      db.exec('ALTER TABLE zz_team_history_record RENAME TO team_history_record');
    }
    const unread = franchiseUnread(v, 'The franchise\'s history couldn\'t be read this time');
    expect(unread.empty?.display).toBe('The franchise\'s history couldn\'t be read this time.');
    expect(bannedInPayload(unread)).toEqual([]);
  });

  it('reads clean: no jargon or verdict on its face, nothing hand-built', () => {
    const view = franchiseViewOf(v, save.org);
    expect(bannedInPayload(view)).toEqual([]);
    for (const { at, text } of allStrings(view)) expect(text, at).not.toMatch(/\bnull\b|\bundefined\b|NaN/);
  });
});

describe('Org Comparison: Player Value\'s bands with their basis, never a verdict (N12)', () => {
  it('serves every club once, ours marked, in the route\'s order, fast', () => {
    const started = performance.now();
    const view = orgComparisonViewOf(v, save.org);
    const ms = performance.now() - started;
    console.log(`[leagueHistoryViews] orgComparisonViewOf: ${ms.toFixed(1)} ms`);
    assertAuthored(view);
    const route = computeOrgComparison(save.org);
    expect(view.clubs.rows.map((r) => r.club!.teamId)).toEqual(route.clubs.map((c) => c.team_id));
    expect(new Set(view.clubs.rows.map((r) => r.club!.teamId)).size).toBe(route.clubs.length);
    expect(view.clubs.rows.filter((r) => r.ours).map((r) => r.club!.teamId)).toEqual([save.org]);
    expect(view.clubs.rows.find((r) => r.ours)!.cells.club.hint).toBe('Your club');
    expect(view.figures.map((f) => f.text)).toEqual([`Roster, rest of ${route.season}`, `Farm, ${route.nextSeason}`, 'Contract value', 'Payroll']);
    expect(view.empty).toBeNull();
    // Each sum's cell is the route's most likely reading, its sort key the same figure
    for (const r of view.clubs.rows) {
      const c = route.clubs.find((x) => x.team_id === r.club!.teamId)!;
      expect(r.sort.rosterWins).toBe(c.roster.wins.figure?.central ?? null);
      expect(r.sort.payroll).toBe(c.payroll.value);
      expect(r.detail.length).toBeGreaterThanOrEqual(4);
      if (c.farm.top) expect(r.players![0].playerId).toBe(c.farm.top.player_id);
    }
  });

  it('never shows a range as one number, and an unknown payroll is "Not known" sorting last, never $0', () => {
    const real = computeOrgComparison(save.org);
    const data = structuredClone(real) as OrgComparison;
    const mine = data.clubs.find((c) => c.isViewer)!;
    const f = mine.roster.contract.figure ?? mine.roster.wins.figure!;
    const sum = mine.roster.contract.figure ? mine.roster.contract : mine.roster.wins;
    sum.figure = { ...f, central: null, centralRange: { low: f.low + (f.high - f.low) * 0.25, high: f.low + (f.high - f.low) * 0.75 } };
    mine.payroll = { value: null, source: 'not in the export', note: null };
    const view = orgComparisonView(v, { comparison: data, valueCalled: { how: 'provisional', stamp: 'Starting numbers' } });
    assertAuthored(view);
    const row = view.clubs.rows.find((r) => r.ours)!;
    const key = sum === mine.roster.contract ? 'contract' : 'rosterWins';
    expect(row.cells[key].display).toMatch(/ to /);
    expect(row.sort[key]).toBeCloseTo((sum.figure.centralRange!.low + sum.figure.centralRange!.high) / 2);
    const tile = view.figures.find((x) => x.text === (key === 'contract' ? 'Contract value' : `Roster, rest of ${data.season}`))!;
    expect(tile.value!.n).toBeNull();
    expect(tile.value!.display).toMatch(/ to /);
    expect(tile.value!.low).toBe(sum.figure.low);
    expect(row.cells.payroll).toMatchObject({ display: 'Not known', tone: 'unknown' });
    expect(row.sort.payroll).toBeNull();
    expect(view.figures.find((x) => x.text === 'Payroll')!.value).toMatchObject({ n: null, display: 'Not known' });
    for (const { at, text } of allStrings(view)) expect(text, at).not.toMatch(/^\$0(?:\.0M)?$/);
    // Every known figure is a most likely reading inside the range it could be
    for (const fig of view.figures) {
      const val = fig.value!;
      if (val.n !== null && val.low !== undefined) expect(val.n).toBeGreaterThanOrEqual(val.low);
    }
  });

  it('says no odds, no posture, no rank: not on its face and not in a basis', () => {
    const view = orgComparisonViewOf(v, save.org);
    for (const { at, text } of allStrings(view)) for (const pattern of ODDS_OR_POSTURE) expect(text, at).not.toMatch(pattern);
    for (const { at, text } of allStrings(view)) expect(text, at).not.toMatch(/\b(?:ranked|rank) \d|\b\d+(?:st|nd|rd|th) (?:of|in the league)\b/);
  });

  it('reads clean: no jargon or verdict on its face, nothing hand-built, its refusals in words', () => {
    const view = orgComparisonViewOf(v, save.org);
    expect(bannedInPayload(view)).toEqual([]);
    const unknown = orgComparisonViewOf(v, 999_999);
    expect(unknown.clubs.rows).toEqual([]);
    expect(unknown.empty?.display).toBe('The organizations couldn\'t be compared: unknown org.');
    expect(bannedInPayload(unknown)).toEqual([]);
    const unread = orgComparisonUnread(v, 'The organizations\' comparison couldn\'t be read this time');
    expect(unread.empty?.display).toBe('The organizations\' comparison couldn\'t be read this time.');
    expect(bannedInPayload(unread)).toEqual([]);
    assertAuthored(unknown);
  });
});
