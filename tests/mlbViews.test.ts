import { beforeAll, describe, expect, it } from 'vitest';
import {
  departmentReport, frontOfficeStats, majorLeagueDecision, majorLeagueView, resetFrontOfficeCache, warmFrontOffice,
} from '../server/frontOfficeService.js';
import { mlbOverview } from '../server/mlbOperations.js';
import { reviewClub, reviewNeeds, type ReviewPorts } from '../server/mlbReview.js';
import type { LensEvidence } from '../server/roleReview.js';
import { readContext } from '../server/staffPreference.js';
import { assertAuthored } from '../server/presentation/claim.js';
import { departmentOffice, servedDepartments } from '../server/presentation/catalog.js';
import type { DepartmentContext } from '../server/presentation/frontOffice/desk.js';
import { majorLeagueViews } from '../server/presentation/majorLeague/views.js';
import type { MlbRow } from '../server/presentation/majorLeague/types.js';
import { bannedInPayload, basisStrings, shownStrings } from './bannedJargon';
import { healthy26, viewOf } from './mlbFixtures';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * Major League Ops' views for the Mac app (BEHAVIOR_CASES.md "Pennant for Mac", `mlbViews.test.ts`, N8): what the
 * specialists decided and nothing more, from the per-import cache, with no odds or posture anywhere (D-060).
 */

const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\d+% to reach/i];
const WINDOW_LABELS = [
  /\bcontend/i, /win-now/i, /\bwin now\b/i, /\brebuild/i, /building for the future/i, /\bwindow\b/i, /\bin the race\b/i,
  /does not press/i, /soft spot/i, /\bpatient\b/i, /still developing/i,
];
const OPERATION = {
  overview: 'getMajorLeagueOverview', positionPlayers: 'getMajorLeaguePositionPlayers', pitchingStaff: 'getMajorLeaguePitchingStaff', benchBackups: 'getMajorLeagueBench',
} as const;
const ids = (rows: readonly MlbRow[]) => rows.map((r) => r.player?.playerId ?? null);

describe('Major League Ops\' views on the synthetic save, from the per-import cache', () => {
  let save: BuiltSave;
  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true, teamSeason: true });
    resetFrontOfficeCache();
  }, 60_000);

  it('serves every view from one build of the club (worded with the report), and a warm read builds nothing', async () => {
    const report = await departmentReport(save.org, 'majorLeague');
    const built = frontOfficeStats().builds;
    for (const view of Object.keys(OPERATION)) await majorLeagueView(save.org, view);
    expect(frontOfficeStats().builds).toBe(built);
    expect(report.department).toBe('majorLeague');
    await expect(majorLeagueView(save.org, 'nothing')).rejects.toThrow(/doesn't know that view/);
  });

  it('every view is authored, plain, and free of odds and posture, its basis included; no window label on its face', async () => {
    for (const [view, op] of Object.entries(OPERATION)) {
      const body = await majorLeagueView(save.org, view);
      expect(() => assertAuthored(body), view).not.toThrow();
      expect(bannedInPayload(body, op), view).toEqual([]);
      expect([...shownStrings(body), ...basisStrings(body)].filter(({ text }) => ODDS_OR_POSTURE.some((p) => p.test(text))), view).toEqual([]);
      expect(shownStrings(body).filter(({ text }) => WINDOW_LABELS.some((p) => p.test(text))), view).toEqual([]);
    }
  });

  it('lists every regular, arm and bench player the review read, once each, in its own order', async () => {
    const o = mlbOverview(save.org);
    const lineup = o.review.find((g) => g.role === 'lineup regular')!.lineup!;
    const pp = await majorLeagueView(save.org, 'positionPlayers');
    expect(ids(pp.lineup.rows)).toEqual([...lineup.spots, lineup.dh].map((s) => s.regular?.playerId ?? null));
    expect(pp.lineup.rows.map((r) => r.cells.spot.display)).toEqual([...lineup.spots, lineup.dh].map((s) => s.label));
    const ps = await majorLeagueView(save.org, 'pitchingStaff');
    const rotation = o.review.find((g) => g.kind === 'starting_pitcher');
    const pen = o.review.find((g) => g.kind === 'relief_pitcher');
    expect(ps.sections.map((s) => ids(s.table.rows))).toEqual([rotation, pen].filter(Boolean).map((g) => g!.holders.map((h) => h.playerId)));
    const bench = o.review.find((g) => g.bench)!.bench!;
    const bv = await majorLeagueView(save.org, 'benchBackups');
    expect(ids(bv.bench.rows)).toEqual(bench.rows.map((r) => r.playerId));
    expect(bv.functions.map((f) => f.key)).toEqual(bench.functions.map((f) => f.key));
  });

  it('says an unknown in words and sorts it last, never a zero, and serves no score of its own', async () => {
    const pp = await majorLeagueView(save.org, 'positionPlayers');
    const ps = await majorLeagueView(save.org, 'pitchingStaff');
    const rows = [...pp.lineup.rows, ...ps.sections.flatMap((s) => s.table.rows)];
    // A row with a player: each unknown is said in words (a spot nobody holds has no player to read)
    for (const row of rows.filter((r) => r.player)) {
      for (const [column, key] of Object.entries(row.sort)) {
        if (key === null) expect(row.cells[column].display, `${row.id}.${column}`).not.toMatch(/^[-—–0]?$/);
        expect(row.cells[column].display, `${row.id}.${column}`).not.toBe('0th');
      }
    }
    // The columns are the specialists' own reads: no composite of ours
    const columns = new Set([...pp.lineup.columns, ...ps.sections.flatMap((s) => s.table.columns)].map((c) => c.id));
    expect([...columns].filter((c) => /score|rank|value/i.test(c))).toEqual([]);
  });

  it('opens each need on the desk at the same need\'s decision, built once per choice and kept until the next import', async () => {
    const report = await departmentReport(save.org, 'majorLeague');
    const items = [...report.toDecide.items, ...report.watching.items].filter((it) => it.key.startsWith('majorLeague:need:'));
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.open).toEqual({ kind: 'decision', department: 'majorLeague', key: it.key.replace('majorLeague:need:', '') });
    const need = items[0].open!.key!;
    const before = frontOfficeStats().decisionBuilds;
    const first = await majorLeagueDecision(save.org, { need });
    const again = await majorLeagueDecision(save.org, { need });
    expect(again).toBe(first);
    expect(frontOfficeStats().decisionBuilds).toBe(before + 1);
    expect(first.needId).toBe(need);
    expect(bannedInPayload(first, 'getMajorLeagueDecision')).toEqual([]);
    await expect(majorLeagueDecision(save.org, { need: 'mlb:nothing:1' })).rejects.toThrow(/isn't open in the current export/);
  });

  it('builds the open needs\' decisions ahead after a warm-up, so opening one from the desk builds nothing', async () => {
    resetFrontOfficeCache();
    await warmFrontOffice(save.org);
    const needs = mlbOverview(save.org).needs;
    expect(needs.length).toBeGreaterThan(0);
    const deadline = Date.now() + 20_000;
    while (frontOfficeStats().decisionBuilds < Math.min(needs.length, 8) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const built = frontOfficeStats().decisionBuilds;
    await majorLeagueDecision(save.org, { need: needs[0].id });
    expect(frontOfficeStats().decisionBuilds).toBe(built);
    expect(frontOfficeStats().decisionHits).toBeGreaterThan(0);
  });

  it('opens every need in the inbox and every view action at a decision the department can answer', async () => {
    const o = await majorLeagueView(save.org, 'overview');
    const keys = [
      ...o.inbox.flatMap((g) => g.needs.map((n) => n.open.key!)),
      ...o.whatIf.players.slice(0, 2).map((p) => p.open.key!),
    ];
    expect(o.inbox.flatMap((g) => g.needs.map((n) => n.needId))).toEqual(mlbOverview(save.org).needs.filter((n) => o.inbox.some((g) => g.needs.some((e) => e.needId === n.id))).map((n) => n.id));
    for (const need of keys) {
      const d = await majorLeagueDecision(save.org, { need });
      expect(d.needId).toBe(need);
      expect(bannedInPayload(d, 'getMajorLeagueDecision'), need).toEqual([]);
    }
  });
});

/**
 * The club's philosophy and season shade the department's advice only as a lean (D-036, D-060): the views' inbox keeps the
 * department's philosophy-free severity as the badge, and the philosophy line carries no odds and no window label on its face.
 */
describe('the club\'s season shades nothing on the views\' face', () => {
  const ev = (v: number): LensEvidence => ({ ratingsPct: v, ratingsEvidence: 'complete', skillsPct: v, runsPct: v, sample: 900, sampleUnit: 'BF', toolsWeight: 1, reliability: 0.75, currentSample: 180, usage: [] });
  const table: Record<number, LensEvidence> = {};
  for (let id = 100; id <= 112; id += 1) table[id] = ev(55);
  table[103] = ev(28);
  const ports: ReviewPorts = { holderEvidence: (ids) => new Map(ids.filter((id) => table[id]).map((id) => [id, table[id]] as const)) };
  const club = viewOf(healthy26());
  const groups = reviewClub(club, ports);
  const ctx: DepartmentContext = {
    build: { orgId: 1, club: 'Test Club', importStamp: null, reportStamp: 'r1', gameDate: '2040-7-1' },
    department: servedDepartments(null).find((d) => d.id === 'majorLeague')!,
    office: departmentOffice('majorLeague'),
  };
  const at = (odds: number | null) => {
    const context = readContext({ dimensions: { competitiveWindow: 80 }, posture: odds === null ? null : { posture: 'buy', odds, gamesLeft: 80, deadlinePassed: false, headline: `${Math.round(odds * 100)}% to reach the postseason: buyers` } });
    const needs = reviewNeeds(club, groups, context);
    return majorLeagueViews({
      ctx,
      overview: {
        organization: { orgId: 1, label: 'Test Club' }, freshness: { level: 'current', headline: 'Current', action: null, log: 'current' },
        roster: { active: { count: 26, limit: 26 }, fortyMan: { count: 40, limit: 40 }, injuredList: 0 },
        coverage: { basis: 'minimum_floor', source: 'x', floors: [] }, needs, context, review: groups, activePlayers: [], unknowns: [],
        yardsticks: { line: 'Using starting yardsticks for now', tip: 'x.', groups: [], longMan: 'x' },
      },
    });
  };

  it('keeps the badge at the department\'s plain reading at any odds, and the odds out of every word', () => {
    const plain = at(null);
    const high = at(0.75);
    const badges = (v: typeof plain) => v.overview.inbox.flatMap((g) => g.needs.map((n) => [n.needId, n.badge.display, n.badge.tone]));
    expect(badges(high)).toEqual(badges(plain));
    for (const v of [plain, high]) {
      expect([...shownStrings(v), ...basisStrings(v)].filter(({ text }) => ODDS_OR_POSTURE.some((p) => p.test(text)))).toEqual([]);
      expect(shownStrings(v).filter(({ text }) => WINDOW_LABELS.some((p) => p.test(text)))).toEqual([]);
    }
    expect(high.overview.philosophy?.basis.lean).not.toBeNull();
  });
});
