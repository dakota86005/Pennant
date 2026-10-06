import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeNextGame } from '../server/dashboard.js';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, saveConfig } from '../server/config.js';
import {
  FrontOfficeRefusal, forgetLiveLog, frontOfficeInputsKey, frontOfficeStampOf, relocateLiveLog, resetFrontOfficeCache,
} from '../server/frontOfficeService.js';
import { computeStandings, type Standings } from '../server/league.js';
import { db } from '../server/db.js';
import { NO_SCHEDULE, SEASON_DECIDED, opponentsOf, standingsViewOf, usVsThemOf } from '../server/leagueStandingsViews.js';
import { oddsModelOf } from '../server/posture.js';
import {
  NOT_AN_OPPONENT, leagueOrgComparisonNow, leagueStandingsNow, leagueUsVsThemNow, leagueViewStats, resetLeagueViews,
} from '../server/leagueViewService.js';
import { officeContextFor } from '../server/leagueViewsBuild.js';
import type { OfficeContext } from '../server/presentation/league/common.js';
import { standingsView, type RaceFacts, type StaffReadFacts } from '../server/presentation/league/standings.js';
import type { LeagueStandingsView, LeagueUsVsThemView } from '../server/presentation/league/types.js';
import { computeSchedule } from '../server/schedule.js';
import { bannedInPayload } from './bannedJargon';
import { makeSave, tx } from './liveLogFixture';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * League Office's Standings and Us vs Them (N12 Track B, D-072): Standings says what `computeStandings` computes, every
 * column and hover of the React page, and is the one view where the staff's rough read (odds and posture, D-060)
 * appears, labelled provisional with its basis and never the headline. Us vs Them sets our club beside another as facts,
 * each figure with its league place, and never says odds or posture.
 */

// The other builders' League Office and Scouting views are not this file's subject: a stand-in keeps the service's
// build (which builds every view) independent of them
vi.mock('../server/leagueLeadersViews.js', () => ({ leadersViewOf: () => ({}), leadersUnread: () => ({}) }));
vi.mock('../server/leagueHistoryViews.js', () => ({
  orgComparisonViewOf: () => ({}), orgComparisonUnread: () => ({}), franchiseViewOf: () => ({}), franchiseUnread: () => ({}),
}));
vi.mock('../server/scoutingViews.js', async (original) => ({
  ...(await original<typeof import('../server/scoutingViews.js')>()),
  draftBoardViewOf: () => ({}), draftBoardUnread: () => ({}), playerSearchViewOf: () => ({}), playerSearchUnread: () => ({}),
}));

let save: BuiltSave;
let v: OfficeContext;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 8, seed: 11, teamSeason: true, minors: true, lineups: true });
  resetFrontOfficeCache();
  resetLeagueViews();
  v = officeContextFor({ orgId: save.org, importStamp: '2040-07-01T12:00:00.000Z', reportStamp: 'r1' }, 'league');
}, 120_000);

afterAll(() => resetLeagueViews());

/** Every string in a payload, shown or in a basis, with where it is. */
function strings(value: unknown, at = '$'): Array<{ at: string; text: string }> {
  if (typeof value === 'string') return [{ at, text: value }];
  if (Array.isArray(value)) return value.flatMap((x, i) => strings(x, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) => strings(x, `${at}.${k}`));
}

/** The words of odds and posture (as `clubhouseViews.test.ts` holds them), and the season-window labels. */
const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\d+% to reach/i, /\bcontend/i, /\brebuild/i];
const oddsWordsIn = (payload: unknown) =>
  strings(payload).filter(({ text }) => ODDS_OR_POSTURE.some((re) => re.test(text)));

const timed = <T>(f: () => T): { value: T; ms: number } => {
  const started = performance.now();
  const value = f();
  return { value, ms: performance.now() - started };
};

describe('Standings says what computeStandings computes', () => {
  let standings: Standings;
  let view: LeagueStandingsView;

  beforeAll(() => {
    const c = computeStandings(save.org);
    if (!c.ok) throw new Error(c.error);
    standings = c.body;
    const t = timed(() => standingsViewOf(v, save.org));
    view = t.value;
    console.log(`[timing] standingsViewOf on the synthetic save: ${t.ms.toFixed(1)} ms`);
  });

  it('serves every club once, sub-league by division in the standings\' own order, ours marked in words', () => {
    expect(view.groups.map((g) => g.title.display)).toEqual(standings.subLeagues.map((s) => s.name));
    expect(view.groups.map((g) => g.divisions.map((d) => d.title.display))).toEqual(standings.subLeagues.map((s) => s.divisions.map((d) => d.name)));
    const served = view.groups.flatMap((g) => g.divisions.flatMap((d) => d.table.rows.map((r) => r.club!.teamId)));
    const expected = standings.subLeagues.flatMap((s) => s.divisions.flatMap((d) => d.teams.map((t) => t.team_id)));
    expect(served).toEqual(expected);
    expect(new Set(served).size).toBe(served.length);
    const rows = view.groups.flatMap((g) => g.divisions.flatMap((d) => d.table.rows));
    const ours = rows.filter((r) => r.ours);
    expect(ours.map((r) => r.club!.teamId)).toEqual([save.org]);
    expect(ours[0].cells.team.hint).toBe('Your club');
    // A club's row opens its club window
    for (const r of rows) expect(r.actions[0].open).toMatchObject({ kind: 'club', teamId: r.club!.teamId });
    expect(view.empty).toBeNull();
  });

  it('words the record, winning percentage, games back and run differential as the React page does, with their sort keys', () => {
    const teams = standings.subLeagues.flatMap((s) => s.divisions.flatMap((d) => d.teams));
    const rows = new Map(view.groups.flatMap((g) => g.divisions.flatMap((d) => d.table.rows)).map((r) => [r.club!.teamId, r]));
    for (const t of teams) {
      const r = rows.get(t.team_id)!;
      expect(r.cells.w.display).toBe(String(t.w));
      expect(r.cells.l.display).toBe(String(t.l));
      expect(r.cells.pct.display).toBe(t.pct!.toFixed(3).replace(/^0\./, '.'));
      expect(r.sort.pct).toBe(t.pct);
      expect(r.cells.gb.display).toBe(t.gb! > 0 ? (Number.isInteger(t.gb) ? String(t.gb) : t.gb!.toFixed(1)) : '–');
      expect(r.sort.gb).toBe(t.gb);
      expect(r.cells.diff.display).toBe(t.diff! > 0 ? `+${t.diff}` : String(t.diff));
      expect(r.cells.diff.tone).toBe(t.diff! > 0 ? 'good' : t.diff! < 0 ? 'bad' : 'neutral');
      expect(r.cells.streak.display).toBe(t.streak === '—' ? '–' : t.streak);
      expect(r.cells.rs.display).toBe(String(t.rs));
    }
    const cols = view.groups[0].divisions[0].table.columns;
    expect(cols.map((c) => c.id)).toEqual(['team', 'w', 'l', 'pct', 'gb', 'rs', 'ra', 'diff', 'streak', 'pace', 'magic']);
    // Runs scored and allowed are served hidden (the run differential shows them); every column explains itself
    expect(cols.filter((c) => c.hidden).map((c) => c.id)).toEqual(['rs', 'ra']);
    for (const c of cols) expect(c.title.hint, c.id).toBeTruthy();
    expect(cols.find((c) => c.id === 'w')!.title.hint).toBe('Wins.');
  });

  it('serves the pace only with a schedule and a game played, and the magic number only for a leader', () => {
    const base = (over: Partial<Standings['subLeagues'][number]['divisions'][number]['teams'][number]>[], scheduled: number | null): LeagueStandingsView => {
      const teams = over.map((o, i) => ({
        team_id: 900 + i, team: `Club ${i}`, abbr: null, w: 10, l: 10, pct: 0.5, gb: i === 0 ? 0 : i, g: 20, streak: 'W2', magicNumber: null,
        rs: 90, ra: 80, diff: 10, isOrg: i === 0, ...o,
      }));
      return standingsView(v, { standings: { scheduledGames: scheduled, subLeagues: [{ name: 'League', divisions: [{ name: 'East', teams }] }] }, race: null, read: null, readWhy: 'Not read here.' });
    };
    const rowsOf = (s: LeagueStandingsView) => s.groups[0].divisions[0].table.rows;
    const withSchedule = rowsOf(base([{ magicNumber: 12, pct: 0.55 }, { pct: 0.45 }, { g: 0, w: 0, l: 0, pct: 0 }], 162));
    expect(withSchedule[0].cells.pace.display).toBe(`${Math.round(0.55 * 162)}–${162 - Math.round(0.55 * 162)}`);
    expect(withSchedule[0].sort.pace).toBe(Math.round(0.55 * 162));
    expect(withSchedule[0].cells.magic.display).toBe('12');
    expect(withSchedule[1].cells.magic.display).toBe('–');
    expect(withSchedule[1].sort.magic).toBeNull();
    // No game played: no pace and no winning percentage, said as such (never .000)
    expect(withSchedule[2].cells.pace.display).toBe('–');
    expect(withSchedule[2].cells.pct.display).toBe('–');
    expect(withSchedule[2].sort.pct).toBeNull();
    // No schedule length in the export: the pace isn't known
    const noSchedule = rowsOf(base([{}, {}], null));
    expect(noSchedule[0].cells.pace).toMatchObject({ display: 'Not known', tone: 'unknown' });
    expect(noSchedule[0].sort.pace).toBeNull();
    // A leader OOTP published no magic number for: not known, never a blank read as none
    expect(noSchedule[0].cells.magic).toMatchObject({ display: 'Not known', tone: 'unknown' });
  });

  it('says a figure the export lacks as "Not known" with a null sort key, never a zero', () => {
    const rows = standingsView(v, {
      standings: { scheduledGames: 162, subLeagues: [{ name: 'League', divisions: [{ name: 'East', teams: [
        { team_id: 901, team: 'Club', abbr: null, w: null, l: null, pct: null, gb: null, g: null, streak: '—', magicNumber: null, rs: null, ra: null, diff: null, isOrg: false },
      ] }] }] },
      race: null, read: null, readWhy: 'Not read here.',
    }).groups[0].divisions[0].table.rows;
    for (const key of ['w', 'l', 'pct', 'gb', 'rs', 'ra', 'diff', 'pace']) {
      expect(rows[0].cells[key], key).toMatchObject({ display: 'Not known', tone: 'unknown' });
      expect(rows[0].cells[key].hint, key).toBeTruthy();
      expect(rows[0].sort[key], key).toBeNull();
    }
    expect(rows[0].sort.streak).toBeNull();
  });

  it('shows the staff\'s rough read only here, provisional with every input in its basis, and never as the headline (D-060)', () => {
    const read = view.staffRead!;
    expect(read).not.toBeNull();
    expect(view.staffReadWhy).toBeUndefined();
    for (const c of [read.odds, read.posture]) {
      expect(c.text).toMatch(/^The staff's rough read/);
      expect(c.basis.certainty).toBe('provisional');
      expect(c.basis.stamp).toMatch(/never fitted/);
      expect(c.basis.unknown.join(' ')).toMatch(/Injuries/);
      expect(c.basis.unknown.join(' ')).toMatch(/rival/);
      expect(c.tone).toBe('neutral');
    }
    const labels = read.odds.basis.because.map((b) => b.label);
    expect(labels).toEqual(expect.arrayContaining(['Record', 'Runs', 'Strength read from the runs', 'The rival', 'The gap', 'Games left']));
    expect(read.odds.value?.unit).toBe('share');
    expect(read.caveat.display).toMatch(/leaves out injuries/);
    expect(read.reasons.length).toBeGreaterThanOrEqual(4);
    // The lede, the race and the columns are facts: no odds, no posture
    expect(oddsWordsIn(view.lede)).toEqual([]);
    expect(oddsWordsIn(view.race)).toEqual([]);
    expect(oddsWordsIn(view.groups)).toEqual([]);
    expect(oddsWordsIn(view.note)).toEqual([]);
    expect(oddsWordsIn(read).length).toBeGreaterThan(0);
  });

  it('serves every club in one table with a Division column, in the served order, as the React page shows the league (review, M5)', () => {
    const all = view.all!;
    expect(all.title.display).toBe('All divisions');
    const order = standings.subLeagues.flatMap((sub) => sub.divisions.flatMap((d) => d.teams.map((t) => [t.team_id, d.name])));
    expect(all.table.rows.map((r) => [r.club!.teamId, r.cells.division.display])).toEqual(order);
    expect(all.table.columns.map((c) => c.id)).toEqual(['team', 'division', 'w', 'l', 'pct', 'gb', 'rs', 'ra', 'diff', 'streak', 'pace', 'magic']);
    // The Division column sorts in the standings' order of the divisions, never alphabetically
    const keys = all.table.rows.map((r) => r.sort.division as number);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(new Set(keys).size).toBe(standings.subLeagues.reduce((n, sub) => n + sub.divisions.length, 0));
    // The same club's line as in its division's table
    const divisionRows = new Map(view.groups.flatMap((g) => g.divisions.flatMap((d) => d.table.rows)).map((r) => [r.id, r]));
    for (const r of all.table.rows) {
      const { division, ...rest } = r.cells;
      expect(rest).toEqual(divisionRows.get(r.id)!.cells);
      expect(division).toBeTruthy();
    }
    expect(all.table.rows.filter((r) => r.ours).map((r) => r.club!.teamId)).toEqual([save.org]);
  });

  it('states our place in the race as facts', () => {
    expect(view.race.length).toBeGreaterThan(0);
    const division = view.race[0];
    expect(division.basis.certainty).toBe('fact');
    expect(division.value?.display).toMatch(/^(T-)?\d+(st|nd|rd|th)|^1st/);
  });

  it('holds every payload to the plain-language list', async () => {
    expect(bannedInPayload(view)).toEqual([]);
    const served = await leagueStandingsNow(String(save.org));
    expect(served.groups.length).toBe(view.groups.length);
    expect(bannedInPayload(served)).toEqual([]);
  });
});

describe('Us vs Them sets our club beside another, as facts (D-072)', () => {
  let view: LeagueUsVsThemView;

  beforeAll(() => {
    const t = timed(() => usVsThemOf(v, save.org, null));
    view = t.value;
    console.log(`[timing] usVsThemOf on the synthetic save: ${t.ms.toFixed(1)} ms`);
  });

  it('opens on the next opponent, and offers every other major league club of the league', () => {
    const next = computeNextGame(save.org);
    const opponents = opponentsOf(save.org);
    expect(opponents).not.toContain(save.org);
    expect(new Set(view.opponents.choices.map((c) => Number(c.value)))).toEqual(new Set(opponents));
    if (next && opponents.includes(next.oppId)) {
      expect(view.them?.teamId).toBe(next.oppId);
      expect(view.opened?.display).toBe('Opened on your next opponent');
    }
    expect(view.query.team).toBe(view.them!.teamId);
    expect(view.opponents.id).toBe('team');
    expect(view.opponents.choices.filter((c) => c.selected).map((c) => Number(c.value))).toEqual([view.them!.teamId]);
    expect(view.us).toMatchObject({ teamId: save.org, ours: true });
  });

  it('gives both clubs\' figures with their league places, at the plate and on the mound', () => {
    expect(view.sections.map((s) => s.title.display)).toEqual(['The season', 'At the plate', 'On the mound']);
    for (const s of view.sections) {
      expect(s.table.columns.map((c) => c.id)).toEqual(['measure', 'us', 'them']);
      expect(s.table.columns[1].title.display).toBe(view.us.name);
      expect(s.table.columns[2].title.display).toBe(view.them!.name);
      expect(s.table.rows.length).toBeGreaterThan(3);
      for (const r of s.table.rows) {
        expect(r.player).toBeNull();
        for (const side of ['us', 'them']) {
          const c = r.cells[side];
          if (c.tone === 'unknown') {
            expect(c.display).toBe('Not known');
            expect(r.sort[side]).toBeNull();
          }
        }
      }
    }
    const placed = view.sections.slice(1).flatMap((s) => s.table.rows).filter((r) => r.cells.us.tone !== 'unknown');
    expect(placed.length).toBeGreaterThan(5);
    for (const r of placed) expect(r.cells.us.display, r.id).toMatch(/ · (T-)?\d+(st|nd|rd|th) of \d+$/);
    const era = view.sections[2].table.rows.find((r) => r.id === 'pitching-era')!;
    expect(era.cells.us.display).toMatch(/^\d+\.\d\d · /);
    const record = view.sections[0].table.rows.find((r) => r.id === 'season-record')!;
    const standings = computeStandings(save.org);
    if (!standings.ok) throw new Error(standings.error);
    const ours = standings.body.subLeagues.flatMap((s) => s.divisions.flatMap((d) => d.teams)).find((t) => t.team_id === save.org)!;
    expect(record.cells.us.display).toBe(`${ours.w}–${ours.l}`);
  });

  it('gives their head-to-head as the schedule has it, and the series between them', () => {
    const schedule = computeSchedule(save.org);
    if (!schedule.ok) throw new Error(schedule.error);
    const h = (schedule.body.headToHead ?? []).find((x) => x.opponentId === view.them!.teamId);
    if (h && h.w + h.l > 0) {
      expect(view.headToHead?.value?.display).toBe(`${h.w}–${h.l} · runs ${h.rf}–${h.ra}`);
      // The record in the line's own words, which the app draws (review, M6)
      expect(view.headToHead?.text).toBe(`Against the ${view.them!.name} this season: ${h.w}–${h.l}, runs ${h.rf}–${h.ra}`);
      expect(view.headToHead?.basis.certainty).toBe('fact');
    } else expect(view.headToHead).toBeNull();
    const series = schedule.body.series.filter((s) => s.oppId === view.them!.teamId);
    // A line per series, and the next series (or none left) said last
    expect(view.meetings!.lines.length).toBe(series.length + 1);
  });

  it('serves its clubs\' columns as not sortable (each row its own unit), and the season\'s rate as "Win %" (review, M6, L8)', () => {
    for (const section of view.sections) {
      const cols = new Map(section.table.columns.map((c) => [c.id, c]));
      expect(cols.get('us')?.sortable).toBe(false);
      expect(cols.get('them')?.sortable).toBe(false);
      expect(cols.get('measure')?.sortable).toBe(true);
    }
    const season = view.sections.find((x) => x.id === 'usVsThem-season')!;
    expect(season.table.rows.some((r) => r.cells.measure.display === 'Win %')).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/Winning percentage/);
  });

  it('never says odds, posture or a season-window word, in a line or a basis (D-060)', async () => {
    expect(oddsWordsIn(view)).toEqual([]);
    for (const team of opponentsOf(save.org)) expect(oddsWordsIn(usVsThemOf(v, save.org, team)), String(team)).toEqual([]);
  });

  it('sets another club beside ours on a click, and refuses a club outside the league\'s other clubs', async () => {
    const org = String(save.org);
    const other = opponentsOf(save.org).find((id) => id !== view.them!.teamId)!;
    const asked = await leagueUsVsThemNow(org, String(other));
    expect(asked.them?.teamId).toBe(other);
    expect(asked.opened).toBeUndefined();
    expect(asked.opponents.choices.find((c) => c.selected)?.value).toBe(String(other));
    await expect(leagueUsVsThemNow(org, String(save.org))).rejects.toThrow(new FrontOfficeRefusal(NOT_AN_OPPONENT, 404));
    await expect(leagueUsVsThemNow(org, '999999')).rejects.toThrow(NOT_AN_OPPONENT);
    await expect(leagueUsVsThemNow(org, 'abc')).rejects.toThrow(NOT_AN_OPPONENT);
    // A club not among them, read directly, is said in words, never thrown
    const outside = usVsThemOf(v, save.org, 999999);
    expect(outside.them).toBeNull();
    expect(outside.empty?.display).toMatch(/isn't one Us vs Them can set beside/);
  });

  it('holds every payload to the plain-language list', async () => {
    expect(bannedInPayload(view)).toEqual([]);
    for (const team of opponentsOf(save.org)) expect(bannedInPayload(usVsThemOf(v, save.org, team))).toEqual([]);
    expect(bannedInPayload(await leagueUsVsThemNow(String(save.org)))).toEqual([]);
  });
});

describe('before a game is played', () => {
  it('says the staff\'s rough read can\'t be made yet, never a number, and Us vs Them still sets the clubs side by side', () => {
    const fresh = buildSave({ season: 2041, historySeasons: 0, gamesPerTeam: 60, playedShare: 0, clubs: 8, seed: 12, teamSeason: true, minors: false, lineups: false });
    resetFrontOfficeCache();
    resetLeagueViews();
    const ctx = officeContextFor({ orgId: fresh.org, importStamp: '2041-03-30T12:00:00.000Z', reportStamp: 'r0' }, 'league');
    const view = standingsViewOf(ctx, fresh.org);
    expect(view.staffRead).toBeNull();
    expect(view.staffReadWhy?.display).toMatch(/waits for the first game/);
    expect(oddsWordsIn(view)).toEqual([]);
    expect(strings(view).filter(({ text }) => /\d+%/.test(text))).toEqual([]);
    expect(view.race[0]?.value?.display).toBe('No games played yet');
    expect(bannedInPayload(view)).toEqual([]);
    const us = usVsThemOf(ctx, fresh.org, null);
    expect(us.them).not.toBeNull();
    expect(us.headToHead).toBeNull();
    expect(oddsWordsIn(us)).toEqual([]);
    expect(bannedInPayload(us)).toEqual([]);
  });
});

describe('once the regular season is decided (N12 Track B review, H1)', () => {
  it('makes no read with no game left: one sentence says the season is decided, and the race\'s facts stay', () => {
    const done = buildSave({ season: 2042, historySeasons: 0, gamesPerTeam: 40, playedShare: 1, clubs: 8, seed: 13, teamSeason: true, minors: false, lineups: false });
    resetFrontOfficeCache();
    resetLeagueViews();
    const ctx = officeContextFor({ orgId: done.org, importStamp: '2042-11-01T12:00:00.000Z', reportStamp: 'r9' }, 'league');
    const view = standingsViewOf(ctx, done.org);
    expect(view.staffRead).toBeNull();
    expect(view.staffReadWhy?.display).toBe(SEASON_DECIDED);
    expect(strings(view).filter(({ text }) => /\d+%/.test(text))).toEqual([]);
    expect(oddsWordsIn(view).map(({ text }) => text)).toEqual([SEASON_DECIDED]);
    // The race's facts stay: the division's place, worked out from the final standings
    expect(view.race.length).toBeGreaterThan(0);
    expect(view.race[0].basis.certainty).toBe('fact');
    expect(bannedInPayload(view)).toEqual([]);
  });

  it('makes no read on a schedule the export doesn\'t carry, never on an assumed 162 games', () => {
    const bare = buildSave({ season: 2043, historySeasons: 0, gamesPerTeam: 60, playedShare: 0.5, clubs: 8, seed: 14, teamSeason: true, minors: false, lineups: false });
    db.exec('DROP TABLE games');
    resetFrontOfficeCache();
    resetLeagueViews();
    const m = oddsModelOf(bare.org);
    expect(m.model?.scheduleRead).toBe('assumed');
    const ctx = officeContextFor({ orgId: bare.org, importStamp: '2043-07-01T12:00:00.000Z', reportStamp: 'r8' }, 'league');
    const view = standingsViewOf(ctx, bare.org);
    expect(view.staffRead).toBeNull();
    expect(view.staffReadWhy?.display).toBe(NO_SCHEDULE);
    expect(strings(view).filter(({ text }) => /\d+%/.test(text))).toEqual([]);
  });
});

describe('the staff\'s rough read describes and never orders (N12 Track B review, L1, L2, L3)', () => {
  const facts = (over: Partial<StaffReadFacts>): StaffReadFacts => ({
    posture: 'buy', odds: 0.8, w: 60, l: 40, gamesPlayed: 100, gamesLeft: 62, rs: 500, ra: 420, strength: 0.58, rival: 0.53,
    expectedWins: 58, gap: -3, gapRead: 'race', holding: true, raceSummary: null, daysToDeadline: 12, deadlinePassed: false, ...over,
  });
  const race: RaceFacts = {
    division: 'East', divisionPlace: { rank: 1, of: 4, tiedWith: 0 }, divisionGb: 0, divisionLead: 3, gamesPlayed: 100,
    wildCards: 3, route: 'division', wildcardGb: null, wildcardRank: null, magicNumber: null,
  };
  const standingsOf = (): Standings => {
    const c = computeStandings(save.org);
    if (!c.ok) throw new Error(c.error);
    return c.body;
  };
  const readOf = (over: Partial<StaffReadFacts>) => standingsView(v, { standings: standingsOf(), race, read: facts(over), readWhy: null }).staffRead!;

  it('says each posture as the staff\'s reading of the club', () => {
    const words: Record<StaffReadFacts['posture'], string> = {
      buy: 'reads the club as a buyer', 'lean-buy': 'leans toward buying', hold: 'hasn\'t decided yet', 'lean-sell': 'leans toward selling', sell: 'reads the club as a seller',
    };
    for (const [posture, said] of Object.entries(words) as Array<[StaffReadFacts['posture'], string]>) {
      const read = readOf({ posture });
      expect(read.posture.text).toBe(`The staff's rough read at the deadline ${said}`);
      expect(bannedInPayload(read)).toEqual([]);
    }
    expect(readOf({ posture: 'sell', deadlinePassed: true }).posture.text).toBe('With the deadline passed, the staff\'s rough read of the season reads the club as a seller');
  });

  it('bans the posture worded as an order', () => {
    for (const order of ['The staff\'s rough read at the deadline: buy', 'The staff\'s rough read at the deadline: sell and look to next year', 'Lean toward selling']) {
      expect(bannedInPayload({ text: order }).length, order).toBeGreaterThan(0);
    }
  });

  it('names the rival as the closest chaser when we hold the place, and the club holding it when we chase', () => {
    const rival = (holding: boolean) => readOf({ holding, gap: holding ? -3 : 4 }).odds.basis.because.find((b) => b.label === 'The rival')!.value;
    expect(rival(true)).toMatch(/the closest chaser/);
    expect(rival(true)).not.toMatch(/holding the place/);
    expect(rival(false)).toMatch(/the club holding the place in question/);
  });

  it('says games played not in the export as not known, never "no games played yet"', () => {
    const view = standingsView(v, { standings: standingsOf(), race: { ...race, gamesPlayed: null }, read: null, readWhy: 'x' });
    expect(view.race[0].value?.display).not.toBe('No games played yet');
    expect(view.race[0].basis.unknown).toContain('The export doesn\'t give the club\'s games played.');
  });
});

describe('kept per import, never per write of OOTP\'s live log (N12 Track B review, M3)', () => {
  it('serves the kept views after the log moves, stamped current, and builds Org Comparison on its own', async () => {
    const kept = buildSave({ season: 2044, historySeasons: 0, gamesPerTeam: 60, playedShare: 0.5, clubs: 8, seed: 15, teamSeason: true, minors: false, lineups: false });
    const fake = makeSave({ rows: [{ date: '20440520', teamId: kept.org, text: tx.released([701, 'Someone 1'], 'RP') }] });
    try {
      saveConfig({ csvDir: fake.csvDir, saveName: null });
      relocateLiveLog();
      resetFrontOfficeCache();
      resetLeagueViews();
      const org = String(kept.org);
      const first = await leagueStandingsNow(org);
      // Standings waited on no comparison: Org Comparison is its own job, built when asked (or warmed) and then kept
      expect(leagueViewStats().comparisons).toBe(0);
      await leagueOrgComparisonNow(org);
      await leagueOrgComparisonNow(org);
      expect(leagueViewStats().comparisons).toBe(1);
      const builds = leagueViewStats().builds;
      expect(builds).toBe(1);

      // OOTP writes its live log during play: the Front Office's key moves, these views' doesn't
      const before = frontOfficeInputsKey(kept.org);
      fake.add([{ date: '20440521', teamId: kept.org, text: tx.released([702, 'Someone 2'], 'RP') }]);
      expect(frontOfficeInputsKey(kept.org)).not.toBe(before);
      const again = await leagueStandingsNow(org);
      await leagueOrgComparisonNow(org);
      expect(leagueViewStats().builds).toBe(builds);
      expect(leagueViewStats().comparisons).toBe(1);
      expect(again.groups).toBe(first.groups);
      // Stamped with the Front Office's current stamp, for which it is still the answer
      expect(again.reportStamp).toBe(frontOfficeStampOf(frontOfficeInputsKey(kept.org)));
      expect(again.reportStamp).not.toBe(first.reportStamp);
    } finally {
      fake.cleanup();
      forgetLiveLog();
      fs.rmSync(path.join(DATA_DIR, 'config.json'), { force: true });
      resetLeagueViews();
    }
  });
});
