import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../server/api.js';
import { computeFarmSystem, type FarmSystemView } from '../server/farmOperations.js';
import type { FarmConsequenceV2 } from '../server/farmConsequence.js';
import { buildFarmViews } from '../server/farmViewsBuild.js';
import {
  NOT_ON_THE_FARM, farmAssignmentsNow, farmDecisionNow, farmDevelopmentNow, farmOrganizationNow, farmViewStats, resetFarmViews, warmFarmViews,
} from '../server/farmViewService.js';
import { FrontOfficeRefusal, invalidateFrontOffice, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { developmentHistoryFor, historyDb, snapshotGameDate } from '../server/history.js';
import { snapshotsAfterImport } from '../server/importSnapshots.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { cell } from '../server/presentation/claim.js';
import { decisionView } from '../server/presentation/farm/decision.js';
import { developmentViews, MOVERS_SHOWN } from '../server/presentation/farm/development.js';
import type { DevelopmentHistoryInput, FarmContext, HistoryRowInput } from '../server/presentation/farm/input.js';
import { prospectsView } from '../server/presentation/farm/prospects.js';
import { CALL_ORDER, MEETING_CALLS, PLAIN, callWord, plain, tierWord } from '../server/presentation/farm/words.js';
import type { ScoutedDevelopmentPlayer } from '../server/scoutedDevelopment.js';
import { BANNED_JARGON, BANNED_VERDICTS, bannedInPayload } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * Farm & Development's views (N10; BEHAVIOR_CASES.md "Pennant for Mac", the `farmViews.test.ts` rows): they say only
 * what Minor League Operations, Player Development and the save's rating history already decided, worded once on the
 * server, and the old routes answer as before.
 */

const ctx: FarmContext = {
  orgId: 1, importStamp: '2040-07-01T12:00:00.000Z', reportStamp: 'r1', gameDate: '2040-7-1', preparedBy: cell('Prepared by the minor league staff'), department: 'farm',
};
const RATING = { scaleMax: 80, roundToFive: false };

let save: BuiltSave;
let system: FarmSystemView;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, minors: true });
  resetFrontOfficeCache();
  resetFarmViews();
  system = computeFarmSystem(save.org);
});

describe('the farm\'s views say what the specialists decided (N10)', () => {
  it('has a farm to read, so the checks cannot pass vacuously', () => {
    expect(system.affiliates.length).toBeGreaterThan(0);
    expect(system.assignments.length).toBeGreaterThan(5);
  });

  it('serves each assignment\'s conclusion and the level\'s verdict as the farm answered them', () => {
    const { views } = buildFarmViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    expect(views.assignments.rows.map((r) => r.playerId).sort()).toEqual(system.assignments.map((a) => a.playerId).sort());
    for (const r of views.assignments.rows) {
      const a = system.assignments.find((x) => x.playerId === r.playerId)!;
      expect(r.inQuestion).toBe(a.attention !== 'routine');
      expect(r.open).toEqual({ kind: 'decision', department: 'farm', key: String(a.playerId) });
    }
  });

  it('keeps a club\'s two readings apart: can it field a team, and are its players developing (D-045)', () => {
    const { views } = buildFarmViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    for (const a of views.affiliates.affiliates) {
      const own = system.affiliates.find((x) => x.teamId === a.teamId)!;
      expect(['Able', 'Thin', 'Short']).toContain(a.operational.text);
      expect(['No issue found', 'Worth a look', 'Costing development']).toContain(a.developmental.text);
      expect(a.operational.basis.source.specialist).toBe('Minor League Operations');
      expect(a.developmental.basis.source.specialist).toBe('Player Development');
      // Only a shortage is operational: the operational findings are the farm's operational ones, and no developmental one
      expect(a.operationalFindings.map((f) => f.id)).toEqual(own.operational.findings.map((f) => f.id));
      expect(a.developmentalFindings.map((f) => f.id)).toEqual(own.developmental.findings.map((f) => f.id));
    }
    // The organization from the major-league club down, each affiliate opening on Affiliates
    expect(views.affiliates.clubs[0].majorLeague).toBe(true);
    for (const c of views.affiliates.clubs.slice(1)) expect(c.open).toEqual({ kind: 'view', department: 'farm', view: 'affiliates', key: String(c.teamId) });
  });

  it('orders the assignments as the farm states (whether to look, then name), and gives developmental stakes no sort key (D-050)', () => {
    const { views } = buildFarmViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const rank = { needs_attention: 0, worth_a_look: 1, routine: 2 } as const;
    const att = (id: number) => rank[system.assignments.find((a) => a.playerId === id)!.attention];
    const rows = views.assignments.rows;
    for (let i = 1; i < rows.length; i += 1) {
      const [a, b] = [rows[i - 1], rows[i]];
      expect(att(a.playerId) < att(b.playerId) || (att(a.playerId) === att(b.playerId) && String(a.sort.player).localeCompare(String(b.sort.player)) <= 0)).toBe(true);
    }
    for (const r of rows) expect(r.sort.stakes).toBeNull();
    // A tier that cannot be read says so, never the lowest tier
    for (const r of rows) {
      const a = system.assignments.find((x) => x.playerId === r.playerId)!;
      if (a.protection.tier === null) expect(r.cells.stakes.display).toBe('Stakes not known');
      else expect(r.cells.stakes.display).not.toBe('Stakes not known');
    }
  });

  it('keeps the old routes answering as before: the farm system and this save\'s rating history (route extraction)', async () => {
    const app = express();
    app.use('/api', api);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const farm = await (await fetch(`${base}/api/farm-operations/${save.org}`)).json();
      expect(farm.assignments.length).toBe(system.assignments.length);
      expect(farm.attention).toEqual(JSON.parse(JSON.stringify(computeFarmSystem(save.org).attention)));
      const history = await (await fetch(`${base}/api/development-history/${save.org}`)).json();
      expect(history).toEqual(JSON.parse(JSON.stringify(developmentHistoryFor(save.org))));
    } finally {
      server.close();
    }
  });
});

describe('a decision\'s cascade is a chain that stops (D-045)', () => {
  const review = () => system.assignments[0];
  const consequence = (over: Partial<FarmConsequenceV2>): FarmConsequenceV2 => ({
    player: { playerId: review().playerId, name: review().name },
    sourceAffiliate: { teamId: review().teamId, label: review().team, level: review().level, levelName: review().levelName },
    lostRole: 'a rotation spot',
    affiliateImpact: { before: 'five starters', after: 'four starters', absorbed: false, statusBefore: 'healthy', statusAfter: 'thin', findingsAfter: [] },
    currentOpportunity: null,
    playingTimeImpact: [],
    replacementOptions: [],
    cascade: {
      origin: { playerId: review().playerId, name: review().name, fromTeamId: review().teamId, fromTeam: review().team, job: { kind: 'rotation' }, reason: 'He leaves.' },
      steps: [
        {
          index: 1,
          vacancy: { teamId: review().teamId, team: review().team, level: 2, levelName: 'Triple-A', job: { kind: 'rotation' }, after: 4, floor: 5, absorbed: false, detail: 'x' },
          candidate: { playerId: 9001, name: 'Al Arm', age: 21, fromTeamId: 77, fromTeam: 'Double-A Club', fromLevel: 3, fromLevelName: 'Double-A' },
          development: { judgment: 'indeterminate', blockers: [], missingEvidence: [{ dimension: 'sample', detail: 'He has too small a sample at his level.' }] },
          // A preference beside a step that is not defensible is never shown: philosophy orders defensible choices only
          preference: 'preferred',
          preferenceBasis: null,
          alternatives: [],
          consequence: { destination: 'Triple-A gains a starter.', source: 'Double-A loses one.', destinationOpportunity: 'He would start.', opensFurtherVacancy: true },
          uncertainty: ['One step cannot be judged.'],
          usable: false,
        },
      ],
      stop: 'indeterminate',
      stopDetail: 'The next step can\'t be judged on the evidence.',
      unresolved: [{ teamId: 77, team: 'Double-A Club', job: 'the rotation', detail: 'one short of five.' }],
      certainty: 'indeterminate',
      gmDecision: [],
    },
    unresolvedIssues: ['Double-A Club is one starter short.'],
    confidence: 'indeterminate',
    evidence: ['Measured on the active list.'],
    summary: 'He can move; Double-A is left one starter short.',
    ...over,
  });

  it('serves each step with Player Development\'s judgment, the stop in words, and a hole as information', () => {
    const view = decisionView(ctx, system, review(), consequence({}));
    const cascade = view.consequence!.cascade!;
    expect(cascade.steps).toHaveLength(1);
    expect(cascade.steps[0].judgment.display).toBe('Can\'t be judged');
    expect(cascade.steps[0].preference).toBeNull();
    expect(cascade.stop.text).toMatch(/^The next step can't be judged\./);
    // An unresolved hole is information: never toned as bad, and said not to make the move impossible
    expect(cascade.stop.tone).not.toBe('bad');
    expect(cascade.unresolved.map((u) => u.tone ?? 'neutral')).not.toContain('bad');
    expect(cascade.unresolvedNote?.display).toMatch(/information, not an illegality/);
    expect(cascade.howSure?.tone).toBe('unknown');
  });

  it('shows philosophy\'s preference only beside a defensible step', () => {
    const c = consequence({});
    c.cascade!.steps[0] = { ...c.cascade!.steps[0], usable: true, development: { judgment: 'defensible', blockers: [], missingEvidence: [] } };
    c.cascade!.stop = 'absorbed';
    c.cascade!.unresolved = [];
    const view = decisionView(ctx, system, review(), c);
    expect(view.consequence!.cascade!.steps[0].preference?.display).toBe('The club prefers it');
    expect(view.consequence!.cascade!.unresolvedNote).toBeNull();
  });

  it('says why an alternative has no preference by Player Development\'s judgment of it', () => {
    const alternatives = (['defensible', 'indeterminate', 'indefensible'] as const).map((judgment) => ({
      kind: 'promotion' as const, direction: 'promotion' as const, level: 2, levelName: 'Triple-A', teams: [], judgment, preference: null,
      blockers: [], missingEvidence: [], destinationOpportunity: null,
    }));
    const view = decisionView(ctx, system, { ...review(), alternatives }, consequence({}));
    expect(view.alternatives.map((a) => a.cells.philosophy.display)).toEqual([
      'No preference stated', 'No preference until it can be judged', 'No preference: not defensible',
    ]);
  });

  it('says why a consequence could not be read, rather than leaving the section empty', () => {
    const view = decisionView(ctx, system, review(), { problem: 'What follows if he moves couldn\'t be read this time.' });
    expect(view.consequence).toBeNull();
    expect(view.consequenceProblem?.display).toMatch(/couldn't be read/);
  });
});

/** A minor leaguer as scouted development serves him. */
function scoutedPlayer(id: number, level: number, over: Partial<ScoutedDevelopmentPlayer['evidence']['peerDevelopment']> = {}, delta: number | null = null): ScoutedDevelopmentPlayer {
  return {
    playerId: id, name: `Player ${id}`, age: 21, kind: 'hitter', teamId: 100 + level, team: `Club ${level}`, level, levelName: `Level ${level}`, current: 45, potential: 60,
    protection: { tier: 'normal', reasons: [] }, transaction: { active: true, onInjuredList: false }, role: { listedPosition: 'SS', developmentalPitcherRole: null },
    evidence: {
      developmentHistory: { status: delta === null ? 'insufficient' : 'improving', snapshotCount: 3, observationDays: 90, currentDelta: delta, potentialDelta: null, reasons: [] },
      peerDevelopment: { pace: 'typical', percentile: 50, cohortSize: 30, cohort: null, reasons: [], ...over },
    },
  };
}

describe('no hidden score orders the prospects (D-044)', () => {
  const prospect = (id: number, recommendation: string, readiness: number) => ({
    player_id: id, team_id: 100, name: `Player ${id}`, age: 21, team: 'Club', level: 3, levelName: 'Level 3', cur: 45, pot: 60, pa: 200, opsVal: 0.8, hr: 5,
    decision: { recommendation, confidence: 'moderate', evidence: { performance: 60, ageLevelUrgency: 50, ratingsMaturity: 50, sampleConfidence: 60, readiness }, positives: [], cautions: [], missingEvidence: [] },
    assignments: { evaluations: [], eligible: [], indeterminate: [] },
  });

  it('keeps the roster\'s order on the board, puts no evidence score in a column, and meets on the raised calls only', () => {
    const players = [scoutedPlayer(1, 2), scoutedPlayer(2, 3), scoutedPlayer(3, 3)];
    const view = prospectsView(ctx, players, [prospect(1, 'hold', 10), prospect(2, 'strong_promotion_case', 90), prospect(3, 'watch', 99)], RATING);
    expect(view.rows.map((r) => r.playerId)).toEqual([1, 2, 3]);
    expect(view.order.display).toMatch(/level, then by last name/);
    // Every column's sort key is a visible fact or a stated order of calls, never the readiness score
    for (const r of view.rows) expect(Object.values(r.sort)).not.toContain(99);
    expect(view.rows[1].sort.call).toBe(CALL_ORDER.strong_promotion_case);
    expect(view.meetings.map((m) => m.playerId)).toEqual([2]);
    expect(MEETING_CALLS.has('strong_promotion_case')).toBe(true);
    for (const m of view.meetings) expect(m.scores).toHaveLength(4);
    expect(view.filters.find((f) => f.id === 'watch')!.count).toBe(1);
  });

  it('says in "Behind their peers" how many players have no pace yet, and "Not yet" when nobody has one (D-018)', () => {
    const some = prospectsView(ctx, [scoutedPlayer(1, 2, { pace: 'behind' }), scoutedPlayer(2, 3, { pace: 'insufficient', percentile: null })], [], RATING);
    const behind = some.figures.find((f) => f.text === 'Behind their peers')!;
    expect(behind.value?.n).toBe(1);
    expect(JSON.stringify(behind.basis)).toMatch(/No pace yet.*"1"/);
    const none = prospectsView(ctx, [scoutedPlayer(1, 2, { pace: 'insufficient', percentile: null })], [], RATING);
    const unknown = none.figures.find((f) => f.text === 'Behind their peers')!;
    expect(unknown.value?.n).toBeNull();
    expect(unknown.value?.display).toBe('Not yet');
    expect(none.filters.find((f) => f.id === 'behind')!.label).toBe('Behind his peers · not yet');
  });
});

describe('development tracking compares only this save\'s own history (D-064, D-061)', () => {
  const rowsFor = (id: number, dates: string[], cur: number[]): HistoryRowInput[] => dates.map((d, i) => ({
    game_date: d, player_id: id, name: `Player ${id}`, team_id: 103, level: 3, levelName: 'Level 3', position: 6, age: 21, cur: cur[i], pot: 60,
    con: 40 + i, gap: 40, pow: 40, eye: 40, avk: 40, spd: 50, stu: null, mov: null, ctl: null,
  }));
  const history = (rows: HistoryRowInput[], dates: string[]): DevelopmentHistoryInput => ({
    snapshots: dates.length, dates, observationDays: dates.length > 1 ? 90 : null, rows, ratingModeSwitches: [], history: { note: null, because: [] },
  });

  it('says the history is building with fewer than two snapshots, never a change of zero', () => {
    const { view, details } = developmentViews(ctx, [scoutedPlayer(1, 3)], history(rowsFor(1, ['2040-4-1'], [45]), ['2040-4-1']), RATING);
    expect(view.ready).toBe(false);
    expect(view.building?.text).toMatch(/One snapshot/);
    expect(details[0].change.value?.n).toBeNull();
    expect(details[0].change.value?.display).not.toBe('0');
    expect(view.rows[0].cells.change.display).toBe('Not enough history yet');
    // Nobody is ahead or behind his peers before there is a pace: "Not yet", never a count of zero (D-018)
    for (const text of ['Ahead of their peers', 'Behind their peers']) {
      const figure = view.figures.find((f) => f.text === text)!;
      expect(figure.value?.n).toBeNull();
      expect(figure.value?.display).toBe('Not yet');
    }
    expect(view.tabs.find((t) => t.id === 'ahead')!.label).toBe('Ahead · not yet');
  });

  it('lists the biggest changes either way, by the stated rule, over the whole organization', () => {
    const players = Array.from({ length: MOVERS_SHOWN + 5 }, (_, i) => scoutedPlayer(i + 1, 2 + (i % 2), {}, i % 3 === 0 ? -(i + 1) : i + 1));
    players.push(scoutedPlayer(999, 3, {}, 0));
    const dates = ['2040-4-1', '2040-7-1'];
    const rows = players.flatMap((p) => rowsFor(p.playerId, dates, [45, 46]));
    const { view } = developmentViews(ctx, players, history(rows, dates), RATING);
    const changes = view.tabs.find((t) => t.id === 'changes')!;
    expect(changes.order).toHaveLength(MOVERS_SHOWN);
    expect(changes.order).not.toContain('development:999');
    const size = (id: string) => Math.abs(players.find((p) => `development:${p.playerId}` === id)!.evidence.developmentHistory.currentDelta!);
    for (let i = 1; i < changes.order.length; i += 1) expect(size(changes.order[i - 1])).toBeGreaterThanOrEqual(size(changes.order[i]));
    // Both directions are movers
    expect(changes.order.some((id) => players.find((p) => `development:${p.playerId}` === id)!.evidence.developmentHistory.currentDelta! < 0)).toBe(true);
    expect(changes.rule.display).toMatch(new RegExp(`${MOVERS_SHOWN} largest changes`));
  });

  it('reads the save\'s own history only: a snapshot filed under another save is never in the comparison', () => {
    const key = currentHistoryKey();
    const pid = save.prospects[0];
    const insert = historyDb.prepare(
      'INSERT INTO save_rating_snapshots (save_key, game_date, player_id, name, team_id, org_id, level, position, age, cur, pot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run(key, '2040-4-1', pid, 'Mine', save.farmClubs[0], save.org, 2, 6, 21, 40, 60);
    insert.run('another-save', '2040-5-1', pid, 'Theirs', save.farmClubs[0], save.org, 2, 6, 21, 70, 75);
    try {
      const h = developmentHistoryFor(save.org);
      expect(h.rows.filter((r) => r.player_id === pid).map((r) => r.game_date)).toEqual(['2040-4-1']);
    } finally {
      historyDb.prepare('DELETE FROM save_rating_snapshots WHERE player_id = ? AND game_date IN (\'2040-4-1\', \'2040-5-1\')').run(pid);
    }
  });
});

describe('the club\'s farm views are built once per import and served from the cache', () => {
  it('builds once for the club\'s inputs, serves every view from that build, and builds again when an input moves', async () => {
    resetFarmViews();
    await warmFarmViews(save.org);
    expect(farmViewStats().builds).toBe(1);
    await farmOrganizationNow(String(save.org));
    await farmAssignmentsNow(String(save.org));
    await farmDevelopmentNow(String(save.org));
    expect(farmViewStats().builds).toBe(1);
    expect(farmViewStats().hits).toBeGreaterThanOrEqual(3);
    invalidateFrontOffice();
    await farmOrganizationNow(String(save.org));
    expect(farmViewStats().builds).toBe(2);
  });

  it('works out the desk\'s decisions ahead and any other on the request, once', async () => {
    resetFarmViews();
    const routine = system.assignments.find((a) => a.attention === 'routine' && !system.attention.some((x) => x.target.kind === 'player' && x.target.playerId === a.playerId));
    expect(routine).toBeDefined();
    const first = await farmDecisionNow(String(save.org), String(routine!.playerId));
    expect(first.playerId).toBe(routine!.playerId);
    expect(farmViewStats().decisionBuilds).toBe(1);
    await farmDecisionNow(String(save.org), String(routine!.playerId));
    expect(farmViewStats().decisionBuilds).toBe(1);
    expect(farmViewStats().decisionHits).toBe(1);
    const asked = system.assignments.find((a) => a.attention !== 'routine');
    if (asked) {
      await farmDecisionNow(String(save.org), String(asked.playerId));
      expect(farmViewStats().decisionBuilds).toBe(1);
    }
  });

  it('builds again when the import\'s snapshot lands after the farm warmed (the snapshots hook runs after the swap), with no reset', async () => {
    // No resetFarmViews(): the cache stays as the warm-up left it, as it would right after an import's swap
    await warmFarmViews(save.org);
    const before = await farmDevelopmentNow(String(save.org));
    const builds = farmViewStats().builds;
    const gameDate = snapshotGameDate()!;
    try {
      // The snapshots hook, as the import runs it (in a worker where one starts, else on this thread)
      const outcome = await snapshotsAfterImport({ importFinishedAt: null, importStartedAt: null, ratingMode: null });
      expect(outcome.ratings?.gameDate).toBe(gameDate);
      const after = await farmDevelopmentNow(String(save.org));
      expect(farmViewStats().builds).toBe(builds + 1);
      expect(after.figures[0].value?.n).toBe(Number(before.figures[0].value?.n ?? 0) + 1);
    } finally {
      historyDb.prepare('DELETE FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?').run(currentHistoryKey(), gameDate);
      historyDb.prepare('DELETE FROM rating_snapshots WHERE game_date = ?').run(gameDate);
    }
  });

  it('refuses a player who is not on the farm in a sentence', async () => {
    await expect(farmDecisionNow(String(save.org), String(save.regular))).rejects.toThrow(FrontOfficeRefusal);
    await expect(farmDecisionNow(String(save.org), String(save.regular))).rejects.toThrow(NOT_ON_THE_FARM);
  });
});

describe('the farm\'s words are plain (AGENTS.md "Writing for the GM")', () => {
  it('serves every view of the synthetic save free of the banned words', () => {
    const { views } = buildFarmViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    expect(bannedInPayload(views)).toEqual([]);
  });

  it('puts each specialist phrase the rule keeps off the screen in the GM\'s words', () => {
    expect(plain('developmental stakes indeterminate')).toBe('developmental stakes not known');
    expect(plain('3 priority prospects at AA')).toBe('3 high-stakes prospects at AA');
    expect(plain('his 85.4th percentile line')).toBe('his 85th of 100 line');
    expect(plain('A development decision about whether he should be starting.')).toBe('A development decision about whether he starts.');
    // A sentence keeps its capital letter where a phrase is replaced at its start
    expect(plain('Indeterminate until he plays.')).toBe('Not settled until he plays.');
    expect(plain('Coverage is thin.')).toBe('Cover is thin.');
    // Plural calls, and "potential" in any case
    expect(plain('Two recommendations stand.')).toBe('Two calls stand.');
    expect(plain('Recommendation: hold.')).toBe('Call: hold.');
    expect(plain('Potential 60; a potential of 55')).toBe('Ceiling 60; a ceiling of 55');
    // Unknown stakes are "not known", however the specialist put it
    expect(plain('Developmental stakes are indeterminate for at least one step.')).toBe('Developmental stakes are not known for at least one step.');
    expect(plain('He is ready but his stakes are unknown.')).toBe('He is ready but his stakes are not known.');
    expect(plain('stakes indeterminate')).toBe('stakes not known');
    // The tier's name (the owner's, 2026-10-02)
    expect(plain('Developmental stakes: development priority.')).toBe('Developmental stakes: development-sensitive.');
    expect(plain('a development-priority outfielder')).toBe('a development-sensitive outfielder');
    expect(tierWord('development_priority')).toBe('Development-sensitive');
    // A call with no words is not known, never another call (D-018)
    expect(callWord('a_new_call').text).toBe('Call not known');
    expect(callWord('a_new_call').tone).toBe('unknown');
    for (const [, words] of PLAIN) {
      if (words === '#place#') continue;
      for (const pattern of [...BANNED_JARGON, ...BANNED_VERDICTS]) expect(pattern.test(words), `${words} against ${pattern}`).toBe(false);
    }
  });

  it('adds no view folder that reads a table or loads a specialist (the adapters word what the build hands them)', () => {
    const folder = path.join(process.cwd(), 'server/presentation/farm');
    for (const file of fs.readdirSync(folder)) {
      const source = fs.readFileSync(path.join(folder, file), 'utf8');
      expect(source, file).not.toMatch(/\bdb\.|\.prepare\(|\btableExists\(/);
      const byValue = [...source.matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)].map((m) => m[1]);
      expect(byValue.filter((s) => !s.startsWith('./') && !s.startsWith('../claim.js') && !s.startsWith('../frontOffice/desk.js') && !s.startsWith('../dataStatusWords.js')), file).toEqual([]);
    }
  });
});

/*
 * Fuller farm payloads than the contract's synthetic save makes (one affiliate, no meetings, no cascade step), worded by
 * the real adapters from synthetic answers, for the Mac app's previews and snapshots (`contract/fixtures/farm/`). Written
 * with `npm run contract:fixtures`, checked here otherwise.
 */
describe('fixtures for the Mac app\'s farm previews (N10)', () => {
  const FOLDER = path.join(process.cwd(), 'contract', 'fixtures', 'farm');
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const fixture = (name: string, value: unknown): void => {
    const file = path.join(FOLDER, name);
    if (process.env.CONTRACT_FIXTURES === 'write') {
      fs.mkdirSync(FOLDER, { recursive: true });
      fs.writeFileSync(file, json(value));
      return;
    }
    expect(fs.existsSync(file), `${name} is missing: run npm run contract:fixtures`).toBe(true);
    expect(fs.readFileSync(file, 'utf8'), `${name} differs: run npm run contract:fixtures`).toBe(json(value));
  };

  it('a decision whose chain has steps and leaves a hole open', () => {
    const review = system.assignments[0];
    const view = decisionView(ctx, system, review, {
      player: { playerId: review.playerId, name: review.name },
      sourceAffiliate: { teamId: review.teamId, label: review.team, level: review.level, levelName: review.levelName },
      lostRole: 'the everyday shortstop job',
      affiliateImpact: { before: 'eight of eight positions fillable', after: 'seven of eight positions fillable', absorbed: false, statusBefore: 'healthy', statusAfter: 'thin', findingsAfter: ['Only one man covers SS.'] },
      currentOpportunity: null,
      playingTimeImpact: [{ playerId: 9002, name: 'Bo Glove', effect: 'Bo Glove moves from sharing short to holding it.' }],
      replacementOptions: [{ playerId: 9002, name: 'Bo Glove', from: 'Double-A Club', judgment: 'defensible', preference: 'preferred', detail: 'x' }],
      cascade: {
        origin: { playerId: review.playerId, name: review.name, fromTeamId: review.teamId, fromTeam: review.team, job: { kind: 'position', position: 'SS' }, reason: 'He leaves.' },
        steps: [
          {
            index: 1,
            vacancy: { teamId: review.teamId, team: review.team, level: review.level, levelName: review.levelName, job: { kind: 'position', position: 'SS' }, after: 1, floor: 2, absorbed: false, detail: 'x' },
            candidate: { playerId: 9002, name: 'Bo Glove', age: 22, fromTeamId: 77, fromTeam: 'Double-A Club', fromLevel: 3, fromLevelName: 'Double-A' },
            development: { judgment: 'defensible', blockers: [], missingEvidence: [] },
            preference: 'preferred',
            preferenceBasis: 'The club leans toward promoting a man who is ready.',
            alternatives: [{ playerId: 9003, name: 'Cy Range', age: 21, fromTeam: 'Double-A Club', preference: 'acceptable' }],
            consequence: { destination: 'He takes the everyday shortstop job.', source: 'Double-A Club loses its shortstop.', destinationOpportunity: 'He would start most days.', opensFurtherVacancy: true },
            uncertainty: [],
            usable: true,
          },
          {
            index: 2,
            vacancy: { teamId: 77, team: 'Double-A Club', level: 3, levelName: 'Double-A', job: { kind: 'position', position: 'SS' }, after: 1, floor: 2, absorbed: false, detail: 'x' },
            candidate: null,
            development: { judgment: 'not_evaluated', blockers: [], missingEvidence: [] },
            preference: null,
            preferenceBasis: null,
            alternatives: [],
            consequence: { destination: 'Double-A Club stays one short at SS.', source: 'No player moves.', destinationOpportunity: 'Not applicable: no move.', opensFurtherVacancy: false },
            uncertainty: ['Nobody below has a qualifying sample at his own level yet.'],
            usable: false,
          },
        ],
        stop: 'indeterminate',
        stopDetail: 'Nobody below Double-A could be judged for shortstop.',
        unresolved: [{ teamId: 77, team: 'Double-A Club', job: 'SS', detail: 'one short of the two it needs.' }],
        certainty: 'indeterminate',
        gmDecision: [],
      },
      unresolvedIssues: ['Double-A Club is one shortstop short.'],
      confidence: 'indeterminate',
      evidence: ['Measured on the active lists, rehab assignees excluded.'],
      summary: 'Bo Glove can take the job; Double-A is then one shortstop short, and the chain stops there.',
    });
    expect(bannedInPayload(view)).toEqual([]);
    fixture('decision-cascade.json', view);
  });

  it('prospects with development meetings', () => {
    const players = [scoutedPlayer(9101, 2, { pace: 'ahead', percentile: 86 }), scoutedPlayer(9102, 3, { pace: 'behind', percentile: 12 }), scoutedPlayer(9103, 3)];
    const meeting = (id: number, recommendation: string) => ({
      player_id: id, team_id: 103, name: `Player ${id}`, age: 21, team: 'Club 3', level: 3, levelName: 'Level 3', cur: 45, pot: 60, pa: 240, opsVal: 0.842, hr: 9,
      decision: {
        recommendation, confidence: 'moderate', evidence: { performance: 71, ageLevelUrgency: 55, ratingsMaturity: 62, sampleConfidence: 68, readiness: 74 },
        positives: ['His line is well above the league at his level.'], cautions: ['His sample is still short of a full season.'], missingEvidence: [],
      },
      assignments: {
        evaluations: [{ kind: 'normal_promotion', direction: 'promotion' as const, target: { level: 2, levelName: 'Level 2', teams: [{ teamId: 102, label: 'Club 2' }], isMajorLeague: false }, judgment: 'defensible', preference: 'preferred', blockers: [], missingEvidence: [], destinationFit: { teams: [{ fit: { destinationTeamId: 102, destinationTeam: 'Club 2', classification: 'viable' } }], eligibleTeamIds: [102], indeterminateTeamIds: [] } }],
        eligible: [{ kind: 'normal_promotion', direction: 'promotion' as const, target: { level: 2, levelName: 'Level 2', teams: [{ teamId: 102, label: 'Club 2' }], isMajorLeague: false }, judgment: 'defensible', preference: 'preferred', blockers: [], missingEvidence: [], destinationFit: { teams: [{ fit: { destinationTeamId: 102, destinationTeam: 'Club 2', classification: 'viable' } }], eligibleTeamIds: [102], indeterminateTeamIds: [] } }],
        indeterminate: [],
      },
    });
    const view = prospectsView(ctx, players, [meeting(9101, 'consider_promotion'), meeting(9102, 'consider_demotion')], RATING);
    expect(view.meetings).toHaveLength(2);
    expect(bannedInPayload(view)).toEqual([]);
    fixture('prospects-meetings.json', view);
  });

  it('development tracking with three snapshots and movers', () => {
    const dates = ['2040-4-1', '2040-5-15', '2040-7-1'];
    const players = [scoutedPlayer(9201, 2, { pace: 'ahead', percentile: 88 }, 4.5), scoutedPlayer(9202, 3, { pace: 'behind', percentile: 9 }, -2), scoutedPlayer(9203, 3, {}, 1)];
    const rows = players.flatMap((p, i) => dates.map((d, j) => ({
      game_date: d, player_id: p.playerId, name: p.name, team_id: p.teamId, level: p.level, levelName: p.levelName, position: i === 1 ? 1 : 6, age: 21, cur: 44 + j * (i === 1 ? -1 : 2), pot: 60,
      con: 40 + j, gap: 40, pow: 42 + j, eye: 40, avk: 40, spd: 50, stu: 45 - j, mov: 45, ctl: 44,
    })));
    const { view, details } = developmentViews(ctx, players, { snapshots: 3, dates, observationDays: 91, rows, ratingModeSwitches: [], history: { note: null, because: [] } }, RATING);
    expect(bannedInPayload({ view, details })).toEqual([]);
    fixture('development-tracked.json', view);
    fixture('development-detail.json', details[0]);
  });
});

afterAll(() => {
  resetFarmViews();
});
