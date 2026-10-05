import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildClubhouseViews, lineupKey } from '../server/clubhouseViewsBuild.js';
import {
  NOT_OUR_CLUB, NOT_OUR_GAME, clubhouseFortyManNow, clubhouseGamePlanNow, clubhouseLineupNow, clubhousePitchingNow, clubhouseRostersNow,
  clubhouseDepthNow, clubhouseScheduleNow, clubhouseTrendsNow, clubhouseViewStats, resetClubhouseViews, warmClubhouseViews,
} from '../server/clubhouseViewService.js';
import { computeNextGame } from '../server/dashboard.js';
import { db } from '../server/db.js';
import { FrontOfficeRefusal, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { computeLineup, lineupAskOf } from '../server/lineup.js';
import { computePitchingStaff, type PitchingStaff } from '../server/pitching.js';
import { departmentOffice, servedDepartments } from '../server/presentation/catalog.js';
import type { ClubhouseContext } from '../server/presentation/clubhouse/common.js';
import { depthChartView } from '../server/presentation/clubhouse/depth.js';
import { fortyManView } from '../server/presentation/clubhouse/fortyMan.js';
import { scheduleView } from '../server/presentation/clubhouse/schedule.js';
import { computeSchedule } from '../server/schedule.js';
import { computeDepthChart } from '../server/org.js';
import { lineupView } from '../server/presentation/clubhouse/lineup.js';
import { pitchingAvailabilityView } from '../server/presentation/clubhouse/pitching.js';
import { seasonTrendsView } from '../server/presentation/clubhouse/trends.js';
import { computeRosterCrunchIssues, type CrunchIssues } from '../server/rosterops.js';
import { computeTrends } from '../server/trends.js';
import { bannedInPayload } from './bannedJargon';
import { buildSave, exec, type BuiltSave } from './syntheticSave';

/*
 * Major League Ops' clubhouse tools (N9, D-069; BEHAVIOR_CASES.md "Pennant for Mac", the `clubhouseViews.test.ts` rows):
 * they say only what the React pages' routes already compute, worded once on the server.
 */

let save: BuiltSave;
let v: ClubhouseContext;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
  resetFrontOfficeCache();
  resetClubhouseViews();
  v = {
    ctx: {
      build: { orgId: save.org, club: 'Club', importStamp: '2040-07-01T12:00:00.000Z', reportStamp: 'r1', gameDate: '2040-7-1' },
      department: servedDepartments(save.org).find((d) => d.id === 'majorLeague')!,
      office: departmentOffice('majorLeague'),
    },
  };
}, 120_000);

afterAll(() => resetClubhouseViews());

/** Every visible string in a payload (`display`, `text`, `hint`), with where it is. */
function visible(value: unknown, at = '$'): Array<{ at: string; text: string }> {
  if (Array.isArray(value)) return value.flatMap((x, i) => visible(x, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) =>
    typeof x === 'string' && ['display', 'text', 'hint'].includes(k) ? [{ at: `${at}.${k}`, text: x }] : visible(x, `${at}.${k}`));
}

const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\d+% to reach/i, /\bcontend/i, /\brebuild/i];

describe('the clubhouse tools say what the routes computed (N9)', () => {
  it('builds every tool for the club from the extracted modules, with something real in each', () => {
    const built = buildClubhouseViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    expect(built.lineups).toHaveLength(8);
    const card = computeLineup(save.org, built.defaultAsk);
    if (!card.ok) throw new Error(card.error);
    const shown = built.lineups.find((l) => l.key === lineupKey(built.defaultAsk))!.view;
    expect(shown.order.rows.map((r) => r.player?.playerId)).toEqual(card.body.lineup.map((l) => l.player_id));
    expect(built.pitching.sections.map((s) => s.id)).toEqual(expect.arrayContaining(['bullpen', 'rotation']));
    expect(built.schedule.games.table.rows.length).toBeGreaterThan(50);
    expect(built.plans.length).toBeGreaterThan(0);
    expect(built.depth.clubs.length).toBeGreaterThan(1);
    expect(built.fortyMan.sections[1].table.rows.length).toBeGreaterThan(10);
    expect(built.rosters[0].view.sections.map((s) => s.table.rows.length).every((n) => n > 0)).toBe(true);
    expect(built.trends.charts).toHaveLength(3);
  });

  it('serves the schedule\'s filters with their rows in their own order: still to play the next first, played the latest first', async () => {
    const schedule = await clubhouseScheduleNow(String(save.org));
    const [all, upcoming, played] = schedule.filters;
    expect(all.rows).toEqual(schedule.games.table.rows.map((r) => r.id));
    expect(upcoming.rows[0]).toBe(schedule.nextRow);
    const order = (id: string) => all.rows.indexOf(id);
    expect(played.rows.map(order)).toEqual([...played.rows.map(order)].sort((a, b) => b - a));
  });

  it('opens the card against the next game\'s starter\'s hand', () => {
    const built = buildClubhouseViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const next = computeNextGame(save.org);
    expect(built.defaultAsk.vs).toBe(next?.theirStarter?.throws === 'L' ? 'l' : 'r');
  });
});

describe('a lineup and a game plan are the staff\'s view, never an order (D-001)', () => {
  it('heads the card with the staff\'s view and gives each slot its reason; the choices ask the server again', async () => {
    const view = await clubhouseLineupNow(String(save.org));
    expect(view.headline?.text).toMatch(/^Staff's view: /);
    for (const r of view.order.rows) {
      expect(r.cells.why.display.length).toBeGreaterThan(0);
      expect(r.detail[0].title?.display).toBe('Why he bats here');
    }
    // Every choice names the ask it sends, and asking it serves that card
    const other = view.choices.flatMap((g) => g.choices).find((c) => !c.selected)!;
    const asked = await clubhouseLineupNow(String(save.org), { ...other.query });
    expect(asked.query).toEqual(other.query);
    const selected = asked.choices.flatMap((g) => g.choices).filter((c) => c.selected).map((c) => c.text.display);
    expect(selected).toContain(other.text.display);
  });

  it('never words a card, a plan or a pen\'s availability as an order', async () => {
    const imperative = /^(Make|Set up|Sit|Start|Bench|Play|Use|Pitch|Rest|Bat)\s+(him|them|the|a|this|your)\b/i;
    const lineup = await clubhouseLineupNow(String(save.org));
    const schedule = await clubhouseScheduleNow(String(save.org));
    const plan = await clubhouseGamePlanNow(String(save.org), schedule.nextRow!.replace(/^game-/, ''));
    const pitching = await clubhousePitchingNow(String(save.org));
    for (const payload of [lineup, plan, pitching]) {
      for (const { at, text } of visible(payload)) {
        expect(text, at).not.toMatch(imperative);
        expect(text, at).not.toMatch(/sit him/i);
      }
    }
    expect(plan.card.title?.display).toMatch(/^Staff's view: /);
  });

  it('words the route\'s availability reading from its code, never "sit him"', () => {
    const staff = computePitchingStaff(save.org);
    if (!staff.ok || !('starterDepth' in staff.body)) throw new Error('no staff');
    const body = staff.body;
    const reliever = body.bullpen[0];
    const twoStraight: PitchingStaff = { ...body, bullpen: [{ ...reliever, injury: null, statusCode: 'two_straight', statusCount: null, status: 'Two straight — sit him', tone: 'bad' }] };
    const view = pitchingAvailabilityView(v, { staff: twoStraight });
    const cell = view.sections[0].table.rows[0].cells.tonight;
    expect(cell).toEqual({ display: 'Pitched the last two days', tone: 'bad' });
  });
});

describe('an unknown rest day, pitch count or split is not known, never zero (D-018)', () => {
  it('says the workload is not known, sorted last, when the export has no game-by-game pitching log', () => {
    const staff = computePitchingStaff(save.org);
    if (!staff.ok || !('starterDepth' in staff.body)) throw new Error('no staff');
    const view = pitchingAvailabilityView(v, { staff: { ...staff.body, gameLog: false } });
    const pen = view.sections.find((s) => s.id === 'bullpen')!;
    expect(pen.table.rows.length).toBeGreaterThan(0);
    for (const r of pen.table.rows) {
      if (r.cells.health.display !== 'Healthy' && r.cells.tonight.display.startsWith('Out')) continue;
      expect(r.cells.tonight.display).toBe('Not known');
      expect(r.cells.p3.display).toBe('Not known');
      expect(r.sort.p3).toBeNull();
      for (const k of Object.keys(r.cells).filter((x) => x.startsWith('day'))) expect(r.cells[k].display).toBe('Not known');
    }
    expect(pen.note?.basis.unknown).toContain('The export has no game-by-game pitching log, so rest and recent workload are not known.');
    // Never "0 of N limited or unavailable" when nobody's workload is known
    expect(pen.summary?.display).toBe('Availability not known');
    expect(pen.summary?.tone).toBe('unknown');
  });

  it('says a pitch count the log doesn\'t carry is not known on the Mac, and the old route keeps its figures as they were', () => {
    // The synthetic log carries no pitch counts; give one reliever's outings theirs, then take his latest one's out
    const first = computePitchingStaff(save.org);
    if (!first.ok || !('starterDepth' in first.body)) throw new Error('no staff');
    const armId = first.body.bullpen.find((p) => p.recentOutings.some((o) => o.daysAgo <= 2))!.player_id;
    exec(`UPDATE players_game_pitching_stats SET pi = 12 WHERE player_id = ${armId}`);
    const staff = computePitchingStaff(save.org);
    if (!staff.ok || !('starterDepth' in staff.body)) throw new Error('no staff');
    const arm = staff.body.bullpen.find((p) => p.player_id === armId)!;
    expect(arm.workloadKnown).toBe(true);
    const latest = db.prepare(`SELECT s.game_id, s.pi FROM players_game_pitching_stats s JOIN games g ON g.game_id = s.game_id
      WHERE s.player_id = ? AND g.played = 1 ORDER BY g.game_id DESC LIMIT 1`).get(arm.player_id) as { game_id: number; pi: number };
    exec(`UPDATE players_game_pitching_stats SET pi = NULL WHERE player_id = ${arm.player_id} AND game_id = ${latest.game_id}`);
    try {
      const after = computePitchingStaff(save.org);
      if (!after.ok || !('starterDepth' in after.body)) throw new Error('no staff');
      const him = after.body.bullpen.find((p) => p.player_id === arm.player_id)!;
      // The old route's figures read the missing count as 0, as the React page always has
      expect(him.pitchesLast3).toBe(arm.pitchesLast3 - latest.pi);
      expect(him.lastOuting?.pitches).toBe(0);
      // The Mac app's fields carry the gap
      expect(him.workloadKnown).toBe(false);
      expect(him.lastOutingPitches).toBeNull();
      expect(him.recentOutings.some((o) => o.pitches === null)).toBe(true);
      const view = pitchingAvailabilityView(v, { staff: after.body });
      const row = view.sections.find((s) => s.id === 'bullpen')!.table.rows.find((r) => r.id === `pen-${arm.player_id}`)!;
      expect(row.cells.p3.display).toBe('Not known');
      expect(row.sort.p3).toBeNull();
      const day = Object.keys(row.cells).find((k) => k.startsWith('day') && row.cells[k].display === 'Pitched')!;
      expect(row.cells[day].hint).toMatch(/^Pitch count not in the export, /);
      expect(row.sort[day]).toBeNull();
      if (!['two_straight', 'injured', 'rested', 'no_appearances'].includes(String(him.statusCode))) expect(row.cells.tonight.display).toBe('Not known');
      const words = visible(row.detail).map((x) => x.text).join(' ');
      expect(words).toMatch(/pitch count not in the export/);
      expect(words).not.toMatch(/\b0 pitches\b|\(0 today\)|\(0 yesterday\)/);
    } finally {
      exec(`UPDATE players_game_pitching_stats SET pi = NULL WHERE player_id = ${armId}`);
    }
  });

  it('says a starter\'s wins and losses are not known when the line doesn\'t carry them, never 0-0', () => {
    const staff = computePitchingStaff(save.org);
    if (!staff.ok || !('starterDepth' in staff.body)) throw new Error('no staff');
    const [first, ...rest] = staff.body.rotation;
    const view = pitchingAvailabilityView(v, { staff: { ...staff.body, rotation: [{ ...first, stats: { ...first.stats!, w: null as unknown as number } }, ...rest] } });
    const row = view.sections.find((s) => s.id === 'rotation')!.table.rows[0];
    expect(row.cells.wl.display).toBe('Not known');
    expect(row.cells.wl.tone).toBe('unknown');
  });

  it('says a reliever with no appearance has none yet, and a day he didn\'t pitch is a dash with its words, not a zero', async () => {
    const view = await clubhousePitchingNow(String(save.org));
    const pen = view.sections.find((s) => s.id === 'bullpen')!;
    const days = pen.table.columns.filter((c) => c.id.startsWith('day'));
    expect(days).toHaveLength(5);
    for (const r of pen.table.rows) {
      for (const d of days) {
        const c = r.cells[d.id];
        if (c.display === '–') expect(c.hint).toBe('Didn\'t pitch');
        // The synthetic log carries no pitch counts: an outing is said as pitched, never a 0 (D-018)
        else if (c.display === 'Pitched') expect(c.hint).toMatch(/^Pitch count not in the export, \d+ outs?$/);
        else expect(c.display).toMatch(/^\d+$/);
      }
    }
  });

  it('marks a bat read on his overall grades, and a bat that doesn\'t apply or isn\'t graded is never a number', () => {
    const ask = lineupAskOf({});
    const card = computeLineup(save.org, ask);
    if (!card.ok) throw new Error(card.error);
    const first = card.body.lineup[0];
    const changed = { ...card.body, lineup: [{ ...first, batBasis: 'overall' as const }, { ...card.body.lineup[1], off: null, positionName: 'P' }, ...card.body.lineup.slice(2)] };
    const view = lineupView(v, { ask, card: changed, next: null, fills: new Map() });
    expect(view.order.rows[0].cells.bat.display).toMatch(/ overall$/);
    expect(view.order.rows[1].cells.bat).toMatchObject({ display: 'Doesn\'t apply', tone: 'unknown' });
    expect(view.order.rows[1].sort.bat).toBeNull();
  });

  it('serves a rolling line\'s first games with no point (never zero), and no chart at all before a game is played', () => {
    const trends = computeTrends(save.org);
    if (!trends.ok) throw new Error(trends.error);
    const view = seasonTrendsView(v, { trends: trends.body });
    const scored = view.charts.find((c) => c.id === 'scoring')!.series[0];
    expect(scored.points[0]).toMatchObject({ value: null, display: 'No point yet' });
    expect(scored.points.some((p) => p.value !== null)).toBe(true);
    const none = seasonTrendsView(v, { trends: { games: 0, labels: [], series: {} } });
    expect(none.charts).toEqual([]);
    expect(none.empty?.display).toBe('No games played yet in this save.');
  });
});

describe('40-Man & Options reads options, Rule 5 and the clocks only from Player State and Player Rights (D-020, D-023)', () => {
  const crunch = (): CrunchIssues => {
    const c = computeRosterCrunchIssues(save.org);
    if (!c.ok) throw new Error(c.error);
    return c.body;
  };

  it('shows each player\'s option years, Rule 5 standing and next move as Player Rights answered them', async () => {
    const view = await clubhouseFortyManNow(String(save.org));
    const c = crunch();
    const rows = view.sections.find((s) => s.id === 'fortyMan')!.table.rows;
    expect(rows.length).toBe(c.crunch.fortyMan.length);
    for (const r of rows) {
      const p = c.crunch.fortyMan.find((x) => `forty-${x.player_id}` === r.id)!;
      const y = p.rights?.optionYears;
      if (y?.used !== null && y?.used !== undefined) expect(r.cells.options.display).toMatch(new RegExp(`^${y.used} used`));
      // The rights' reasons are in the row's detail, each with where its rule comes from
      if (p.rights && p.rights.evidence.currentState !== 'behind') {
        const reasons = r.detail.flatMap((b) => b.lines.map((l) => l.text.display));
        for (const a of Object.values(p.rights.actions)) for (const reason of a.reasons) if (reasons.some((t) => t.startsWith(reason.message))) expect(reasons.find((t) => t.startsWith(reason.message))).toMatch(/\)$/);
      }
    }
  });

  it('says an option count the export does not state is not known, sorted last, never zero or three', () => {
    const c = crunch();
    const p = c.crunch.fortyMan[0];
    const unknown = { ...p, rights: p.rights ? { ...p.rights, optionYears: { used: null, remaining: null, usedThisSeason: null, standing: 'indeterminate' as const } } : null };
    const changed: CrunchIssues = { ...c, crunch: { ...c.crunch, fortyMan: [unknown, ...c.crunch.fortyMan.slice(1)] } };
    const view = fortyManView(v, { crunch: changed });
    const row = view.sections.find((s) => s.id === 'fortyMan')!.table.rows[0];
    expect(row.cells.options).toMatchObject({ display: 'Not known', tone: 'unknown' });
    expect(row.sort.options).toBeNull();
  });

  it('words a running clock from the export\'s days, and says when the days are not in the export', () => {
    const c = crunch();
    const p = c.crunch.fortyMan[0];
    const changed: CrunchIssues = {
      crunch: { ...c.crunch, issues: [p] },
      players: [{ playerId: p.player_id, name: p.name, positionName: p.positionName, levelName: p.levelName, issues: [{ kind: 'designated', daysLeft: null }] }],
    };
    const view = fortyManView(v, { crunch: changed });
    const row = view.sections.find((s) => s.id === 'attention')!.table.rows[0];
    expect(row.cells.issues).toMatchObject({ display: 'Designated for assignment: days left not in the export', tone: 'bad' });
  });

  it('names no transaction from a difference between exports', async () => {
    const view = await clubhouseFortyManNow(String(save.org));
    for (const { at, text } of visible(view.sections)) expect(text, at).not.toMatch(/\b(was optioned|was recalled|was designated)\b/i);
  });
});

describe('no odds or posture in the clubhouse tools, not even the schedule (D-060)', () => {
  it('carries no postseason odds, deadline posture or window label in any tool, basis included', async () => {
    const org = String(save.org);
    const schedule = await clubhouseScheduleNow(org);
    const payloads = [
      await clubhouseLineupNow(org), await clubhousePitchingNow(org), schedule,
      await clubhouseGamePlanNow(org, schedule.nextRow!.replace(/^game-/, '')), await clubhouseFortyManNow(org),
      await clubhouseRostersNow(org), await clubhouseTrendsNow(org),
    ];
    for (const p of payloads) {
      const json = JSON.stringify(p);
      for (const re of ODDS_OR_POSTURE) expect(json, String(re)).not.toMatch(re);
      expect(bannedInPayload(p, 'getMajorLeagueLineup')).toEqual([]);
    }
  });
});

describe('a grade that is OSA\'s view filling in for our scouts says so (D-067)', () => {
  it('marks the bat and glove of a hitter our scouts haven\'t rated, and opens his detail with the sentence', () => {
    const ask = lineupAskOf({});
    const card = computeLineup(save.org, ask);
    if (!card.ok) throw new Error(card.error);
    const id = card.body.lineup[0].player_id;
    const fill = { mark: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' };
    const view = lineupView(v, { ask, card: card.body, next: null, fills: new Map([[id, fill]]) });
    const row = view.order.rows[0];
    expect(row.cells.bat.hint).toContain(fill.hint);
    expect(row.cells.glove.hint).toContain(fill.hint);
    expect(row.detail[0].lines[0].text.display).toBe(fill.hint);
    expect(view.order.rows[1].cells.bat.hint ?? '').not.toContain(fill.hint);
  });
});

describe('built after each import and served from the cache (N9)', () => {
  it('builds the club\'s tools once and serves every view, the cards ahead and the next plans from it', async () => {
    resetClubhouseViews();
    await warmClubhouseViews(save.org);
    const org = String(save.org);
    const schedule = await clubhouseScheduleNow(org);
    for (const r of [0, 1, 2]) {
      void r;
      await clubhouseLineupNow(org);
      await clubhouseLineupNow(org, { vs: 'l', style: 'trad', sort: 'production' });
      await clubhousePitchingNow(org);
      await clubhouseGamePlanNow(org, schedule.nextRow!.replace(/^game-/, ''));
      await clubhouseRostersNow(org);
    }
    expect(clubhouseViewStats().builds).toBe(1);
    expect(clubhouseViewStats().asks).toBe(0);
  });

  it('works out a card with the DH the league doesn\'t use, another game\'s plan and an affiliate\'s roster on their first open, then keeps them', async () => {
    const org = String(save.org);
    const schedule = await clubhouseScheduleNow(org);
    const late = schedule.filters[1].rows.at(-1)!.replace(/^game-/, '');
    const affiliate = (await clubhouseRostersNow(org)).clubs.find((c) => !c.selected)!.query.team;
    const before = clubhouseViewStats().asks;
    for (let i = 0; i < 2; i++) {
      await clubhouseLineupNow(org, { dh: 'off' });
      await clubhouseGamePlanNow(org, late);
      const roster = await clubhouseRostersNow(org, String(affiliate));
      expect(roster.query.team).toBe(affiliate);
    }
    expect(clubhouseViewStats().asks - before).toBe(3);
  });

  it('refuses a game that isn\'t the club\'s and a club that isn\'t the organization\'s, in words', async () => {
    const org = String(save.org);
    const theirs = db.prepare('SELECT game_id FROM games WHERE home_team != ? AND away_team != ? LIMIT 1').get(save.org, save.org) as { game_id: number };
    await expect(clubhouseGamePlanNow(org, String(theirs.game_id))).rejects.toThrow(new FrontOfficeRefusal(NOT_OUR_GAME, 404));
    await expect(clubhouseRostersNow(org, String(save.clubs.find((c) => c !== save.org)))).rejects.toThrow(NOT_OUR_CLUB);
  });
});

describe('a game plan with no starter says so (D-069, D-018)', () => {
  it('says the export doesn\'t name a played game\'s starter, and a game past the projection gets the right-handers\' card, said as such', async () => {
    const org = String(save.org);
    const schedule = await clubhouseScheduleNow(org);
    const playedGame = schedule.filters[2].rows[0].replace(/^game-/, '');
    const played = await clubhouseGamePlanNow(org, playedGame);
    expect(played.starter.text.display).toBe('The export doesn\'t name who started this game.');
    const late = await clubhouseGamePlanNow(org, schedule.filters[1].rows.at(-1)!.replace(/^game-/, ''));
    expect(late.starter.text.display).toBe('No starter projected for this game yet.');
    expect(late.card.title?.display).toBe('Staff\'s view: our card against right-handers');
    expect(late.card.lines.at(-1)?.text.display).toMatch(/^No starter is known for this game, so this is the card against right-handers, not one built for him\.$/);
  });
});

describe('the clubhouse tools\' smaller words (N9 review)', () => {
  it('says the staff\'s view of a day-to-day man and of the plan, never an instruction or a forecast', async () => {
    const card = computeLineup(save.org, lineupAskOf({}));
    if (!card.ok) throw new Error(card.error);
    const [first, ...rest] = card.body.lineup;
    const view = lineupView(v, { ask: lineupAskOf({}), card: { ...card.body, lineup: [{ ...first, dayToDay: true }, ...rest] }, next: computeNextGame(save.org), fills: new Map() });
    expect(bannedInPayload(view, 'getMajorLeagueLineup')).toEqual([]);
    expect(visible(view).map((x) => x.text).join(' ')).toMatch(/Day-to-day: OOTP will let him play, so the staff kept him on/);
    const schedule = await clubhouseScheduleNow(String(save.org));
    const plan = await clubhouseGamePlanNow(String(save.org), schedule.nextRow!.replace(/^game-/, ''));
    expect(bannedInPayload(plan)).toEqual([]);
    expect(plan.sections.map((s) => s.title?.display)).toContain('Their most dangerous bats');
    const trends = await clubhouseTrendsNow(String(save.org));
    expect(bannedInPayload(trends)).toEqual([]);
  });

  it('names each man on the bench and the unavailable list once, on a line of his own that opens him', async () => {
    const view = await clubhouseLineupNow(String(save.org));
    for (const block of [view.bench, view.unavailable, view.notScouted]) {
      if (!block) continue;
      for (const l of block.lines.filter((x) => x.players.length)) {
        expect(l.players).toHaveLength(1);
        expect(l.text.display.split(l.players[0].name).length - 1).toBe(1);
      }
    }
    expect(view.bench?.title?.display).toBe('Bench');
    expect(view.bench!.lines.length).toBeGreaterThan(0);
  });

  it('says a club OOTP projects no starters for has none, rather than "past" a projection it doesn\'t have', () => {
    const body = computeSchedule(save.org);
    if (!body.ok || !('headToHead' in body.body)) throw new Error('no schedule');
    const hint = (view: ReturnType<typeof scheduleView>, column: 'ourStarter' | 'theirStarter') =>
      new Set(view.games.table.rows.map((r) => r.cells[column]).filter((c) => c.display === 'Not named yet').map((c) => c.hint));
    const all = scheduleView(v, { schedule: body.body, projectedClubs: save.clubs });
    expect(hint(all, 'ourStarter')).toEqual(new Set(['OOTP\'s projected starts don\'t reach this game']));
    const noneForThem = scheduleView(v, { schedule: body.body, projectedClubs: [save.org] });
    expect(hint(noneForThem, 'theirStarter')).toEqual(new Set(['OOTP hasn\'t projected this club\'s starters']));
    expect(all.choose.display).toBe('Choose a game for the staff\'s plan.');
  });

  it('says an age the export doesn\'t carry is not known, never "null"', () => {
    const crunch = computeRosterCrunchIssues(save.org);
    if (!crunch.ok) throw new Error(crunch.error);
    const issues: CrunchIssues = crunch.body;
    const ageless = <T extends { age: number }>(list: T[]): T[] => list.map((p) => ({ ...p, age: null as unknown as number }));
    const forty = fortyManView(v, { crunch: { ...issues, crunch: { ...issues.crunch, fortyMan: ageless(issues.crunch.fortyMan), issues: ageless(issues.crunch.issues) } } });
    const rows = forty.sections.flatMap((s) => s.table.rows);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.cells.age.display).toBe('Not known');
      expect(r.sort.age).toBeNull();
    }
    const chart = computeDepthChart(save.org);
    if (!chart.ok) throw new Error(chart.error);
    const depth = depthChartView(v, { chart: { ...chart.body, players: chart.body.players.map((p) => ({ ...p, age: null as unknown as number })) }, fills: new Map(), rating: { scaleMax: 80, roundToFive: false } });
    const words = JSON.stringify(depth);
    expect(words).not.toMatch(/\bnull ·/);
    expect(words).toMatch(/Age not known · /);
  });
});

describe('the depth chart by position (N9 review)', () => {
  it('lists every man at a position across the organization in one table, club by club down, deepest first, the same men as the field', async () => {
    const view = await clubhouseDepthNow(String(save.org));
    expect(view.byPosition.map((s) => s.id)).toEqual(['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']);
    for (const section of view.byPosition) {
      const fromClubs = view.clubs.flatMap((c) => c.positions.find((p) => p.id === section.id)!.players.map((e) => e.player.playerId));
      expect(section.table.rows.map((r) => r.player?.playerId)).toEqual(fromClubs);
      const levels = section.table.rows.map((r) => r.sort.level as number);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    }
    // At least one position runs through more than one club
    expect(Math.max(...view.byPosition.map((s) => new Set(s.table.rows.map((r) => r.cells.club.display)).size))).toBeGreaterThan(1);
  });
});
