import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, tableExists } from '../server/db.js';
import { computePlayers } from '../server/league.js';
import { officeContextFor } from '../server/leagueViewsBuild.js';
import type { OfficeContext } from '../server/presentation/league/common.js';
import type { ScoutingDraftBoardView, ScoutingPlayerSearchView } from '../server/presentation/scouting/types.js';
import { BOARD_PAGE, DEFAULT_BOARD, draftBoardAskFrom, draftBoardServed, draftBoardView, draftProspectOf } from '../server/presentation/scouting/draftBoard.js';
import { advise, adviseScouted, computeDraft, draftLeague } from '../server/rosterops.js';
import {
  DEFAULT_SEARCH, draftBoardUnread, draftBoardViewOf, playerSearchAskFrom, playerSearchKey, playerSearchUnread, playerSearchViewOf,
  type PlayerSearchAsk,
} from '../server/scoutingViews.js';
import { loadScoutedAbilities } from '../server/scoutedEvidence.js';
import { forgetSearchIndex } from '../server/search.js';
import { BATTING_STATS } from '../server/presentation/statCatalog.js';
import { bannedInPayload } from './bannedJargon';
import { gradeOwners } from './ratingFillMarks';
import request from './request.js';
import { CLASS, addDraftClass } from './draftClassFixture';
import { buildSave, insert, type BuiltSave } from './syntheticSave';

/*
 * Scouting's Draft Board and Player Search (N12 Track B, D-072): the class and the calendar as the React page's route
 * reads them, the grades only through the evidence (our scouts' composites, never a rating column or a partial average),
 * the board as the staff's view in a stated order; the search on the route's own query, names matched by the palette's.
 */

// OSA's view filling in for our scouts, switched on for the cases that check the mark (as ratingFillEverywhere does)
const fills = vi.hoisted(() => ({ all: false }));
vi.mock('../server/scoutedEvidence.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/scoutedEvidence.js')>();
  return { ...original, ratingFillOf: (id: number) => (fills.all ? { mark: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' } : original.ratingFillOf(id)) };
});

let save: BuiltSave;
let v: OfficeContext;
let base = '';

/** Every visible string in a payload (`display`, `text`, `hint`, and a basis line's `value`). */
function visible(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(visible);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) => (typeof x === 'string' && ['display', 'text', 'hint', 'value'].includes(k) ? [x] : visible(x)));
}

const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\bcontend/i, /\brebuild/i];
const ORDERS = [/\bdraft (?:him|them|this)\b/i, /\btake (?:him|them)\b/i, /\bpick (?:him|them)\b/i, /\bgo get\b/i, /\bshould\b/i, /\bmust\b/i];

const setLeague = (sql: string) => db.prepare(`UPDATE leagues SET ${sql} WHERE league_id = ?`).run(save.leagueId);

beforeAll(async () => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true });
  addDraftClass(save);
  // A name with accents, for the palette's folding
  db.prepare(`UPDATE players SET first_name = 'José', last_name = 'Ramírez' WHERE player_id = ?`).run(save.regular);
  forgetSearchIndex();
  v = officeContextFor({ orgId: save.org, importStamp: null, reportStamp: 'r1' }, 'scouting');
  await request('/api/players?limit=1');
  base = `http://127.0.0.1:${process.env.OOTP_FO_PORT}`;
}, 120_000);

afterAll(() => {
  fills.all = false;
  if (tableExists('league_events')) db.exec('DROP TABLE league_events');
  forgetSearchIndex();
});

/** The route's status and body, beside what its module computes. */
async function same(route: string, computed: { ok: boolean; status?: number; error?: string; body?: unknown }): Promise<void> {
  const res = await fetch(`${base}${route}`);
  if (computed.ok) {
    expect(res.status, route).toBe(200);
    expect(await res.json(), route).toEqual(JSON.parse(JSON.stringify(computed.body)));
  } else {
    expect(res.status, route).toBe(computed.status);
    expect(await res.json(), route).toEqual({ error: computed.error });
  }
}

describe('the draft and players routes, extracted (N12)', () => {
  it('/api/draft sends exactly what computeDraft computes: the published class, an unknown club, an unpublished class', async () => {
    await same(`/api/draft/${save.org}`, computeDraft(save.org));
    await same('/api/draft/99999', computeDraft(99999));
    setLeague('show_draft_pool = 0');
    try {
      await same(`/api/draft/${save.org}`, computeDraft(save.org));
    } finally {
      setLeague('show_draft_pool = 1');
    }
  });

  it('/api/players sends exactly what computePlayers computes, for every kind of ask the React page makes', async () => {
    const asks = ['', '?group=pitching', '?q=P%2010', '?level=all&position=6', '?freeAgents=1', `?orgId=${save.org}&level=all`, '?sort=avg&dir=desc',
      '?minPt=100', '?bats=1&throws=1&minAge=25&maxAge=30', '?sort=name&dir=asc&limit=20&offset=10', '?group=pitching&role=11&sort=era&dir=asc', '?level=2&viewer=2'];
    for (const a of asks) await same(`/api/players${a}`, computePlayers(Object.fromEntries(new URLSearchParams(a))));
  });
});

describe('the Draft Board (N12)', () => {
  let view: ScoutingDraftBoardView;
  beforeAll(() => {
    view = draftBoardViewOf(v, save.org);
  });

  it('serves the class the route finds, graded only through the evidence, in the staff\'s stated order', () => {
    const route = computeDraft(save.org);
    if (!route.ok) throw new Error(route.error);
    expect(view.published).toBe(true);
    const ids = view.board.rows.map((r) => r.player!.playerId);
    // The route's class (it averages the tools it sees); the board keeps only a full scouted ceiling
    const routeIds = (route.body.prospects as Array<{ player_id: number }>).map((p) => p.player_id);
    const abilities = loadScoutedAbilities(routeIds);
    expect(new Set(ids)).toEqual(new Set(routeIds.filter((id) => abilities.for(id).potential !== null)));
    expect(ids).not.toContain(CLASS + 4);
    expect(ids).not.toContain(CLASS + 6);
    // Ceiling first, then now, each the evidence's composite
    const pairs = view.board.rows.map((r) => [r.sort.ceiling as number, (r.sort.current as number | null) ?? -1]);
    expect(pairs).toEqual([...pairs].sort((a, b) => b[0] - a[0] || b[1] - a[1]));
    for (const r of view.board.rows) {
      const a = abilities.for(r.player!.playerId);
      expect(r.sort.ceiling).toBe(a.potential);
      expect(r.sort.current).toBe(a.current);
    }
    expect(view.board.rows.map((r) => r.cells.board.display)).toEqual(view.board.rows.map((_, i) => String(i + 1)));
    expect(view.board.columns.map((c) => c.id)).toEqual(['board', 'player', 'age', 'position', 'bt', 'school', 'current', 'ceiling', 'upside', 'read']);
  });

  it('says a tool not graded now is not graded, never an average of the others, and leaves no upside', () => {
    const row = view.board.rows.find((r) => r.player?.playerId === CLASS + 3)!;
    expect(row.cells.current.display).toBe('Not graded');
    expect(row.sort.current).toBeNull();
    expect(row.cells.upside.display).toBe('Not known');
    expect(JSON.stringify(row.detail)).toMatch(/Not graded now: control/);
  });

  it('says who is left off and why: drafted, another league\'s draft, no full scouted ceiling', () => {
    expect(view.leftOut?.display).toBe('Not on the board: 1 already drafted, 1 in another league\'s draft, 2 with no full scouted ceiling.');
    expect(view.summary?.text).toMatch(/^28 draft-eligible players\. Draft day is July 10, \d+ days out, 20 rounds\.$/);
    expect(view.summary?.basis.because.map((l) => l.label)).toContain('The class');
  });

  it('serves the staff\'s read with its reasons as a stated line, and the order as the staff\'s view, never an order', () => {
    expect(view.lede.text).toBe('This year\'s class in the scouting staff\'s order: ceiling first, then now');
    expect(view.lede.basis.because[0].value).toMatch(/never an order to draft anyone/);
    // The lines the read is drawn on are stated once, in the lede (a stated line, not fitted); each row carries his reasons
    expect(view.lede.basis.certainty).toBe('policy');
    expect(view.lede.basis.because[0].value).toMatch(/a ceiling of 55 or more with 15 or more still to come is a high ceiling with a long wait/);
    const read = view.board.rows.find((r) => r.cells.read.display !== 'No read')!;
    expect(read.detail[0].title?.display).toBe(`Staff's read: ${read.cells.read.display}`);
    expect(read.detail[0].lines[0].text.display).toMatch(/ceiling/);
    // Slim rows: no basis repeated on every row (N12 integration: 2,076 prospects on a real save)
    expect(JSON.stringify(view.board.rows)).not.toMatch(/"basis"/);
    expect(Math.max(...view.board.rows.map((r) => JSON.stringify(r).length))).toBeLessThan(1100);
    const words = visible(view).join('\n');
    for (const p of [...ORDERS, ...ODDS_OR_POSTURE]) expect(words).not.toMatch(p);
    expect(bannedInPayload(view)).toEqual([]);
  });

  it('serves the short lists: the board\'s top five, and the best at the thinnest spots', () => {
    const [best, thin] = view.shortLists;
    expect(best.title?.display).toBe('Best available');
    expect(best.lines.map((l) => l.players[0].playerId)).toEqual(view.board.rows.slice(0, 5).map((r) => r.player!.playerId));
    expect(thin.title?.display).toMatch(/^Best at your thinnest spots/);
    expect(thin.claims[0].basis.because.some((l) => l.label === 'The staff')).toBe(true);
  });

  it('serves its filters by key, the asked choice selected, and keeps the board\'s order (review, M2)', () => {
    const order = view.board.rows.map((r) => r.id);
    const served = draftBoardServed(view, DEFAULT_BOARD);
    expect(served.filters.map((f) => [f.id, f.choices.map((c) => c.value), f.choices.filter((c) => c.selected).map((c) => c.value)])).toEqual([
      ['position', ['all', 'C', 'IF', 'OF', 'P'], ['all']], ['school', ['all', 'HS', 'college'], ['all']],
    ]);
    expect(served.board.rows.map((r) => r.id)).toEqual(order);
    // No row-id lists any longer: the filters are a few keys, whatever the size of the class
    expect(JSON.stringify(served.filters)).not.toMatch(/prospect-/);
    const pitchers = draftBoardServed(view, draftBoardAskFrom({ position: 'P' }));
    expect(pitchers.query).toEqual({ position: 'P', school: 'all', all: false });
    expect(pitchers.filters[0].choices.find((c) => c.selected)?.value).toBe('P');
    expect(pitchers.board.rows.length).toBeGreaterThan(0);
    expect(pitchers.board.rows.every((r) => r.cells.position.display === 'P')).toBe(true);
    expect(pitchers.board.rows.map((r) => r.id)).toEqual(order.filter((id) => pitchers.board.rows.some((r) => r.id === id)));
    expect(pitchers.count?.display).toBe(`${pitchers.board.rows.length === 1 ? '1 prospect' : `${pitchers.board.rows.length} prospects`} of ${order.length} on the board`);
    const college = draftBoardServed(view, draftBoardAskFrom({ school: 'college' }));
    expect(college.board.rows.length).toBeGreaterThan(0);
    expect(college.board.rows.length).toBeLessThan(order.length);
    expect(college.board.rows.every((r) => r.cells.school.display === 'College')).toBe(true);
    // An unknown key reads as every prospect, served back as read
    expect(draftBoardAskFrom({ position: 'XX', school: 'nope' })).toEqual(DEFAULT_BOARD);
  });

  it('serves the top 300 in the board\'s order, every prospect on a filter or "Show all", and a prospect\'s reasons when chosen (review, M2)', () => {
    // A class of 650, as a big save has thousands: the served shape is the same
    const big: ScoutingDraftBoardView = {
      ...view,
      board: { ...view.board, rows: Array.from({ length: 650 }, (_, i) => ({ ...view.board.rows[i % view.board.rows.length], id: `prospect-${i}` })) },
    };
    const top = draftBoardServed(big, DEFAULT_BOARD);
    expect(top.board.rows.map((r) => r.id)).toEqual(big.board.rows.slice(0, BOARD_PAGE).map((r) => r.id));
    expect(top.count?.display).toBe('The top 300 of 650 on the board, in the staff\'s order');
    expect(top.more).toEqual({ text: { display: 'Show all 650' }, id: 'all', value: '1' });
    const all = draftBoardServed(big, draftBoardAskFrom({ all: '1' }));
    expect(all.board.rows).toHaveLength(650);
    expect(all.more).toBeNull();
    const filtered = draftBoardServed(big, draftBoardAskFrom({ position: 'IF' }));
    expect(filtered.board.rows.length).toBe(big.board.rows.filter((r) => ['1B', '2B', '3B', 'SS'].includes(r.cells.position.display)).length);
    expect(filtered.more).toBeNull();
    // The rows carry no reasons; they are read when a prospect is chosen
    expect(top.board.rows.every((r) => r.detail.length === 0)).toBe(true);
    const withReasons = view.board.rows.find((r) => r.detail.length > 0)!;
    const chosen = draftProspectOf(view, withReasons.player!.playerId)!;
    expect(chosen.row).toBe(withReasons.id);
    expect(chosen.detail).toEqual(withReasons.detail);
    expect(draftProspectOf(view, 1)).toBeNull();
    // The columns of words sort by their words: their rows carry no keys, the numbers' keys stay
    const words = view.board.columns.filter((c) => c.byWords).map((c) => c.id);
    expect(words).toEqual(['player', 'position', 'bt', 'school', 'read']);
    for (const r of top.board.rows) {
      for (const id of words) expect(id in r.sort, id).toBe(false);
      expect(Object.keys(r.sort).sort()).toEqual(['age', 'board', 'ceiling', 'current', 'upside']);
    }
    console.log(`[n12b size] draft board, 650 prospects: whole ${JSON.stringify(big).length} bytes, top 300 served ${JSON.stringify(top).length} bytes`);
  });

  it('never reads a grade now that isn\'t known as zero: the read rests on the ceiling and says so (review, M4)', () => {
    const thin = new Set<string>();
    const prospect = { age: 20, positionName: 'SS', school: 'College', isPitcher: false };
    // The React route's reading reads the unknown as zero ("close to ready" and a long wait need a grade now)
    expect(adviseScouted({ ...prospect, cur: null, pot: 60, upside: null }, thin)?.label).toBe('Everyday-regular ceiling, now not graded');
    expect(adviseScouted({ ...prospect, cur: null, pot: 48, upside: null }, thin)?.label).toBe('Depth piece, now not graded');
    expect(adviseScouted({ ...prospect, cur: null, pot: 60, upside: null }, thin)?.reasons[1]).toMatch(/grade now isn't known/);
    expect(adviseScouted({ ...prospect, cur: null, pot: 40, upside: null }, thin)).toBeNull();
    expect(adviseScouted({ ...prospect, cur: null, pot: null, upside: null }, thin)).toBeNull();
    // With both grades known it is the route's own read
    for (const [cur, pot] of [[40, 60], [50, 55], [45, 53], [40, 47]]) {
      expect(adviseScouted({ ...prospect, cur, pot, upside: pot - cur }, thin)).toEqual(advise({ ...prospect, cur, pot, upside: pot - cur }, thin));
    }
    const row = view.board.rows.find((r) => r.player?.playerId === CLASS + 3)!;
    expect(row.sort.current).toBeNull();
    expect(row.cells.read.display === 'No read' || /now not graded$/.test(row.cells.read.display)).toBe(true);
    expect(row.cells.read.display).not.toMatch(/^(Close to ready|High ceiling, long wait)$/);
  });

  it('says an empty published class is empty, never that nobody in it is graded (review, M8)', () => {
    const league = draftLeague(save.org)!;
    const empty = draftBoardView(v, {
      league, poolRule: 'flag', prospects: [], unrated: 0, excluded: { alreadyPicked: 0, otherDraft: 0 }, needs: [], needsBasis: '',
      rating: { scaleMax: 80, roundToFive: false },
    });
    expect(empty.board.empty?.display).toBe('Nobody is in this year\'s class.');
    const ungraded = draftBoardView(v, {
      league, poolRule: 'flag', prospects: [], unrated: 4, excluded: { alreadyPicked: 0, otherDraft: 0 }, needs: [], needsBasis: '',
      rating: { scaleMax: 80, roundToFive: false },
    });
    expect(ungraded.board.empty?.display).toBe('Nobody in the class has a full scouted ceiling yet.');
  });

  it('marks every graded row, and every short-list line, with OSA\'s view when it fills in for our scouts', () => {
    fills.all = true;
    try {
      const filled = draftBoardViewOf(v, save.org);
      const owners = gradeOwners(filled, 'draftBoard');
      expect(owners.length).toBe(filled.board.rows.length);
      expect(owners.filter((o) => !o.marked)).toEqual([]);
      for (const l of filled.shortLists.flatMap((b) => b.lines.filter((x) => x.players.length))) expect(l.chips.map((c) => c.display)).toEqual(['OSA']);
      expect(filled.board.rows[0].cells.ceiling.hint).toMatch(/OSA's view/);
    } finally {
      fills.all = false;
    }
    expect(view.board.rows.every((r) => r.ratingsFill === undefined)).toBe(true);
  });

  it('shows no class until OOTP publishes it: one sentence, the calendar, an empty board', () => {
    if (!tableExists('league_events')) db.exec('CREATE TABLE league_events (league_id INTEGER, type INTEGER, start_date TEXT, deleted INTEGER)');
    db.prepare('INSERT INTO league_events (league_id, type, start_date, deleted) VALUES (?, 3, ?, 0), (?, 43, ?, 0)').run(save.leagueId, '2040-12-1', save.leagueId, '2040-12-15');
    setLeague('show_draft_pool = 0');
    try {
      const hidden = draftBoardViewOf(v, save.org);
      expect(hidden.published).toBe(false);
      expect(hidden.notShown?.display).toBe('The class isn\'t out yet: OOTP publishes it on December 1.');
      expect(hidden.board.rows).toEqual([]);
      expect(hidden.board.empty?.display).toBe(hidden.notShown?.display);
      expect(hidden.calendar?.rows.map((r) => [r.cells.event.display, r.cells.date.display])).toEqual([
        ['Class published', 'December 1, 2040'], ['Combine', 'December 15, 2040'], ['Draft day', 'July 10, 2040'],
      ]);
      expect(hidden.summary).toBeNull();
      expect(hidden.shortLists).toEqual([]);
      expect(bannedInPayload(hidden)).toEqual([]);
      setLeague('rules_amateur_draft = 0');
      const none = draftBoardViewOf(v, save.org);
      expect(none.notShown?.display).toBe('This league doesn\'t hold an amateur draft.');
      expect(none.calendar).toBeNull();
      expect(none.board.rows).toEqual([]);
    } finally {
      setLeague('show_draft_pool = 1, rules_amateur_draft = 1');
      db.exec('DROP TABLE league_events');
    }
    const unread = draftBoardUnread(v, 'The draft board couldn\'t be read this time');
    expect(unread.empty?.display).toBe('The draft board couldn\'t be read this time.');
    expect(bannedInPayload(unread)).toEqual([]);
  });
});

describe('Player Search (N12)', () => {
  const ask = (q: string, tokens: string[] = []): PlayerSearchAsk => playerSearchAskFrom({ q, tokens: tokens.join(',') });
  const search = (q: string, tokens: string[] = []): ScoutingPlayerSearchView => playerSearchViewOf(v, save.org, ask(q, tokens));
  const rowsOf = (s: ScoutingPlayerSearchView) => s.results.rows;

  it('opens on the batters with the most playing time this season, the route\'s order, every row opening its player', () => {
    const view = playerSearchViewOf(v, save.org, DEFAULT_SEARCH);
    const route = computePlayers({ level: 'all', limit: '300', viewer: String(save.org) });
    if (!route.ok) throw new Error(route.error);
    expect(rowsOf(view).map((r) => r.player?.playerId)).toEqual(route.body.players.map((p) => p.player_id));
    expect(rowsOf(view).every((r) => r.player?.open?.kind === 'player')).toBe(true);
    expect(rowsOf(view).filter((r) => r.ours).length).toBe(route.body.players.filter((p) => p.inYourOrg).length);
    for (const r of rowsOf(view).filter((x) => x.ours)) expect(r.cells.club.hint).toBe('Your organization');
    expect(view.group.id).toBe('group');
    expect(view.group.choices.map((c) => [c.text.display, c.value, c.selected])).toEqual([['Batters', 'group:batting', true], ['Pitchers', 'group:pitching', false]]);
    expect(view.kinds.map((k) => k.id)).toEqual(['position', 'level', 'club', 'scope', 'age', 'bats', 'throws', 'pt']);
    const columns = view.results.columns;
    // The React page's defaults shown (in the catalog's order), every other batting line served hidden
    const shown = new Set(['pa', 'avg', 'obp', 'slg', 'ops', 'opsPlus', 'wrcPlus', 'hr', 'rbi', 'sb', 'war']);
    expect(columns.filter((c) => !c.hidden).map((c) => c.id)).toEqual(['player', 'age', 'position', 'bt', 'club',
      ...BATTING_STATS.filter((d) => shown.has(d.key)).map((d) => `stat.${d.key}`)]);
    expect(columns.filter((c) => c.hidden).map((c) => c.id)).toEqual(BATTING_STATS.filter((d) => !shown.has(d.key)).map((d) => `stat.${d.key}`));
    expect(bannedInPayload(view)).toEqual([]);
  });

  it('keeps the latest token of a kind, and switches to pitchers by the group token', () => {
    expect(ask('', ['position:C', 'level:2', 'position:SS']).tokens).toEqual(['level:2', 'position:SS']);
    expect(playerSearchKey(ask('', ['position:SS', 'level:2']))).toBe(playerSearchKey(ask('', ['level:2', 'position:SS'])));
    const pitchers = search('', ['group:pitching']);
    expect(pitchers.group.choices[1].selected).toBe(true);
    expect(rowsOf(pitchers).every((r) => r.cells.position.display === 'P')).toBe(true);
    expect(pitchers.kinds.find((k) => k.id === 'position')!.tokens.map((t) => t.id)).toEqual(['position:SP', 'position:RP', 'position:CL']);
    expect(pitchers.results.columns.filter((c) => !c.hidden).map((c) => c.id)).toContain('stat.era');
  });

  it('applies each token as the route\'s own filter, and says the ones it set aside', () => {
    const ss = search('', ['position:SS']);
    expect(rowsOf(ss).length).toBeGreaterThan(0);
    expect(rowsOf(ss).every((r) => r.cells.position.display === 'SS')).toBe(true);
    expect(ss.chosen.map((t) => t.text.display)).toEqual(['Shortstop (SS)']);
    const aaa = search('', ['level:2']);
    expect(rowsOf(aaa).length).toBeGreaterThan(0);
    expect(rowsOf(aaa).every((r) => r.cells.club.display.startsWith('AAA · '))).toBe(true);
    const ours = search('', ['scope:org']);
    expect(rowsOf(ours).length).toBeGreaterThan(0);
    expect(rowsOf(ours).every((r) => r.ours)).toBe(true);
    const club = search('', [`club:${save.clubs[1]}`, 'scope:org']);
    expect(club.chosen.map((t) => t.id)).toEqual([`club:${save.clubs[1]}`]);
    expect(rowsOf(club).every((r) => !r.ours)).toBe(true);
    expect(club.count.display).toMatch(/1 token set aside/);
    const lefties = search('', ['bats:L']);
    expect(rowsOf(lefties).every((r) => /^[LS]\//.test(r.cells.bt.display))).toBe(true);
    const young = search('', ['age:22-25']);
    expect(rowsOf(young).every((r) => Number(r.cells.age.display) >= 22 && Number(r.cells.age.display) <= 25)).toBe(true);
    const odd = search('', ['position:SP', 'nonsense:1']);
    expect(odd.chosen).toEqual([]);
    expect(odd.count.display).toMatch(/2 tokens set aside/);
    expect(bannedInPayload(odd)).toEqual([]);
  });

  it('matches names with the palette\'s own matcher: an accented name found unaccented, every word a word\'s start', () => {
    const jose = search('jose rami');
    expect(rowsOf(jose).map((r) => r.player?.playerId)).toEqual([save.regular]);
    expect(rowsOf(jose)[0].cells.player.display).toBe('José Ramírez');
    expect(rowsOf(search('ose')).map((r) => r.player?.playerId)).not.toContain(save.regular);
    const none = search('zzqx');
    expect(rowsOf(none)).toEqual([]);
    expect(none.count.display).toBe('No batters match');
    expect(none.results.empty?.display).toBe('No batters match "zzqx".');
    const short = search('j');
    expect(short.count.display).toMatch(/Type two letters or more to search by name/);
    expect(rowsOf(short).length).toBe(rowsOf(playerSearchViewOf(v, save.org, DEFAULT_SEARCH)).length);
  });

  it('shows 300 at a time, sorted over every match, and says how many match and how many are shown (review, M1)', () => {
    for (let i = 0; i < 320; i += 1) {
      insert('players', { player_id: 70000 + i, first_name: 'Depth', last_name: `Bat${i}`, age: 24, position: 2 + (i % 8), role: 0, bats: 1, throws: 1, team_id: save.farmClubs[0], organization_id: save.org, retired: 0, hidden: 0, draft_eligible: 0 });
    }
    try {
      const many = search('', ['scope:org']);
      expect(rowsOf(many)).toHaveLength(300);
      const total = (computePlayers({ level: 'all', orgId: String(save.org), limit: '1' }) as { ok: true; body: { total: number } }).body.total;
      expect(many.count.display).toBe(`${total.toLocaleString('en-US')} batters match; 1 to 300 shown, most playing time first`);
      expect(many.more).toEqual({ text: { display: `Show the next ${total - 300}`, hint: `${total - 300} more match` }, id: 'offset', value: '300' });
      // A man with no line this season says so, never a zero
      const unplayed = rowsOf(many).find((r) => r.cells.player.display.startsWith('Depth'))!;
      expect(unplayed.cells['stat.avg'].display).toBe('No line');
      // The server sorts: the rows carry no keys, and the table says so
      expect(many.results.serverSorts).toBe(true);
      expect(rowsOf(many).every((r) => Object.keys(r.sort).length === 0)).toBe(true);

      // The next page, through its offset: the route's next 300, in the same order
      const next = playerSearchViewOf(v, save.org, playerSearchAskFrom({ tokens: 'scope:org', offset: many.more!.value }));
      const route = (q: Record<string, string>) => (computePlayers({ level: 'all', orgId: String(save.org), limit: '300', viewer: String(save.org), ...q }) as { ok: true; body: { players: Array<{ player_id: number }> } }).body.players.map((p) => p.player_id);
      expect(rowsOf(next).map((r) => r.player?.playerId)).toEqual(route({ offset: '300' }));
      expect(next.query.offset).toBe(300);
      expect(next.count.display).toBe(`${total.toLocaleString('en-US')} batters match; 301 to ${total} shown, most playing time first`);
      expect(next.more).toBeNull();

      // A column's sort orders every match, not the page shown (the React page's whole-league sort, review M1)
      const byAge = playerSearchViewOf(v, save.org, playerSearchAskFrom({ tokens: 'scope:org', sort: 'age', dir: 'asc' }));
      expect(rowsOf(byAge).map((r) => r.player?.playerId)).toEqual(route({ sort: 'age', dir: 'asc' }));
      expect(byAge.query).toMatchObject({ sort: 'age', dir: 'asc', offset: 0 });
      expect(byAge.count.display).toMatch(/by age, youngest first$/);
      const ages = rowsOf(byAge).map((r) => Number(r.cells.age.display));
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
      const byOps = playerSearchViewOf(v, save.org, playerSearchAskFrom({ tokens: 'scope:org', sort: 'stat.ops', dir: 'desc' }));
      expect(rowsOf(byOps).map((r) => r.player?.playerId)).toEqual(route({ sort: 'ops', dir: 'desc' }));
      expect(byOps.count.display).toMatch(/by OPS, highest first$/);
      // The best OPS of every match leads, though most of these batters were not in the first page by playing time
      expect(rowsOf(byOps)[0].player?.playerId).toBe(route({ sort: 'ops', dir: 'desc' })[0]);
      // A column that doesn't sort (hands) is served so, and asking it sorts nothing
      expect(many.results.columns.find((c) => c.id === 'bt')?.sortable).toBe(false);
      const byHands = playerSearchViewOf(v, save.org, playerSearchAskFrom({ tokens: 'scope:org', sort: 'bt' }));
      expect(byHands.query.sort).toBeNull();
      expect(rowsOf(byHands).map((r) => r.player?.playerId)).toEqual(rowsOf(many).map((r) => r.player?.playerId));
      expect(playerSearchKey(playerSearchAskFrom({ sort: 'age', dir: 'asc' }))).not.toBe(playerSearchKey(playerSearchAskFrom({ sort: 'age' })));
      expect(playerSearchAskFrom({ offset: '450' }).offset).toBe(300);
    } finally {
      db.exec('DELETE FROM players WHERE player_id >= 70000 AND player_id < 70400');
    }
  });

  it('answers a typical ask quickly: the opening, a name and a token, each timed', () => {
    const time = (run: () => unknown): number => {
      const started = performance.now();
      run();
      return Math.round((performance.now() - started) * 10) / 10;
    };
    forgetSearchIndex();
    const opening = time(() => playerSearchViewOf(v, save.org, DEFAULT_SEARCH));
    const firstName = time(() => search('jose'));
    const name = time(() => search('kid'));
    const token = time(() => search('', ['position:SS', 'level:1']));
    console.log(`[n12b timing] opening ${opening} ms, first name ask (index built) ${firstName} ms, name ${name} ms, tokens ${token} ms`);
    expect(Math.max(opening, name, token)).toBeLessThan(1500);
  });

  it('says a search that couldn\'t be read, and carries no grade, odds or posture', () => {
    const unread = playerSearchUnread(v, ask('kid', ['group:pitching']), 'Player search couldn\'t be read this time');
    expect(unread.empty?.display).toBe('Player search couldn\'t be read this time.');
    expect(unread.group.choices[1].selected).toBe(true);
    expect(bannedInPayload(unread)).toEqual([]);
    const view = search('p', ['position:C']);
    expect(gradeOwners(view, 'search')).toEqual([]);
    const words = visible(view).join('\n');
    for (const p of ODDS_OR_POSTURE) expect(words).not.toMatch(p);
  });
});

describe('the evidence boundary for the new modules (D-017)', () => {
  const NEW = ['server/scoutingViews.ts', 'server/leagueLeadersViews.ts', 'server/presentation/scouting/draftBoard.ts',
    'server/presentation/scouting/playerSearch.ts', 'server/presentation/league/leaders.ts'];
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('reads no rating column, rating table or value field: the grades come only through loadScoutedAbilities and ratingFillOf', () => {
    for (const file of NEW) {
      const source = strip(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
      expect(source, file).not.toMatch(/_ratings_|fielding_rating|players_batting|players_pitching|players_scouted_ratings|players_value|overall_value|talent_value|\boa\b|\bpot_rating\b|ratingFrom|scoutedRatingRow/);
    }
    const reader = strip(fs.readFileSync(path.join(process.cwd(), 'server/scoutingViews.ts'), 'utf8'));
    expect([...reader.matchAll(/import \{([^}]*)\} from '\.\/scoutedEvidence\.js'/g)].map((m) => m[1].trim())).toEqual(['loadScoutedAbilities, ratingFillOf, type ToolKey']);
  });
});
