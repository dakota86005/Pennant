import { describe, expect, it } from 'vitest';
import { backtestTools, fitTools, TOOLS_FIT_POLICY, type ToolsCase, type ToolsInputCases, type ToolsModel } from '../server/mlbToolsFit';
import { snapshotBefore } from '../server/ratingsForward';
import { TOOLS_PRIOR } from '../server/toolsModel';
import type { ScoutedObservation } from '../server/scoutedEvidence';

/**
 * Whether a league's visible tools, saved before a season, forecast it (cycle 4 of the per-save calibration): judged on forward seasons
 * only, by cycle 2's detector, on synthetic forward leagues whose truth is known.
 */

const PRIOR = [TOOLS_PRIOR.slopes.contact, TOOLS_PRIOR.slopes.gap, TOOLS_PRIOR.slopes.power, TOOLS_PRIOR.slopes.eye, TOOLS_PRIOR.slopes.avoidK];

/** A small deterministic generator. */
function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const n = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, u()))) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

/**
 * A league of `seasons` forward seasons, `per` hitters each: tools in steps of 5, true talent = slopes · tools (+ a part the tools do not
 * see), the target season's wOBA its talent plus binomial-sized noise, his results before it the same talent seen through `pastPa`.
 */
function forwardLeague(opts: { seasons: number; per?: number; slopes?: number[]; unseen?: number; pastPa?: number; pastNoise?: number; seed?: number }): ToolsInputCases {
  const { seasons, per = 300, slopes = PRIOR, unseen = 0.012, pastPa = 900, pastNoise = 1, seed = 1 } = opts;
  const r = rng(seed);
  const cases: ToolsCase[] = [];
  const forwardSeasons: number[] = [];
  let id = 1;
  for (let k = 0; k < seasons; k += 1) {
    const s = 2027 + k;
    forwardSeasons.push(s);
    for (let i = 0; i < per; i += 1) {
      const x = [0, 0, 0, 0, 0].map(() => Math.max(20, Math.min(80, 50 + 5 * Math.round(r.n() * 2))));
      const talent = slopes.reduce((t, b, j) => t + b * (x[j] - 50), 0) + unseen * r.n();
      const pa = 300 + Math.floor(r.u() * 350);
      const noise = (n: number) => 0.52 * r.n() / Math.sqrt(n);
      cases.push({ playerId: id, target: s, gapDays: 300, x, y: talent + noise(pa), weight: pa, past: { value: talent + pastNoise * noise(pastPa), sample: pastPa } });
      id += 1;
    }
  }
  // The populations the lens ranks in: here, the season's own hitters
  const populations: ToolsInputCases['populations'] = {};
  for (const s of forwardSeasons) {
    const list = cases.filter((c) => c.target === s);
    populations[s] = { tools: list.map((c) => c.x), past: list.map((c) => (c.past as { value: number }).value), target: list.map((c) => c.y) };
  }
  return { cases, forwardSeasons, snapshots: ['2026-05-16'], resultsK: 500, engine: null, populations };
}

const basis = (through: number) => ({ leagueId: 1, throughSeason: through, gameDate: `${through + 1}-04-01` });

describe('the tools fit judges only on seasons that came after the ratings', () => {
  it('a save with no rating saved before a season decides nothing: the starting values serve, and it says why', () => {
    const run = fitTools({ cases: [], forwardSeasons: [], snapshots: ['2026-05-16'], resultsK: 500, engine: null, populations: {} }, basis(2025), null);
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.failures[0]).toMatch(/^forward: 0 of 5/);
    expect(run.model.bat).toMatchObject({ source: 'starting', reason: 'forward', served: PRIOR });
    expect(run.model.blend).toMatchObject({ source: 'starting', reason: 'forward', served: 1 });
  });

  it('a snapshot taken once a season is under way never stands for it, nor one older than the window; the gap is recorded', () => {
    const at = (gameDate: string) => ({ gameDate } as ScoutedObservation);
    expect(snapshotBefore([at('2027-04-10')], 2027)).toBeNull();
    expect(snapshotBefore([at('2025-06-01')], 2027)).toBeNull();
    expect(snapshotBefore([at('2026-05-16'), at('2026-09-20')], 2027)).toMatchObject({ observation: { gameDate: '2026-09-20' }, gapDays: 181 });
  });

  it('an offseason or spring import stands for the season about to start, not the one after it', () => {
    const at = (gameDate: string) => ({ gameDate } as ScoutedObservation);
    expect(snapshotBefore([at('2026-09-20'), at('2027-02-15')], 2027)).toMatchObject({ observation: { gameDate: '2027-02-15' }, gapDays: 33 });
    // with the export's own first game, the line is that day: a snapshot after it is already in the season
    expect(snapshotBefore([at('2027-03-24')], 2027, '2027-03-25')).toMatchObject({ gapDays: 1 });
    expect(snapshotBefore([at('2027-03-26')], 2027, '2027-03-25')).toBeNull();
    // without it, the stated policy date (March 20)
    expect(snapshotBefore([at('2027-03-22')], 2027)).toBeNull();
  });

  it('a held-out season never takes part in choosing what it judges', () => {
    const league = forwardLeague({ seasons: 6 });
    const bt = backtestTools(league);
    const last = league.forwardSeasons[league.forwardSeasons.length - 1];
    const scrambled = { ...league, cases: league.cases.map((c) => (c.target === last ? { ...c, y: -c.y } : c)) };
    const bt2 = backtestTools(scrambled);
    // the origins' fits (named in the per-origin notes) are identical: only the scores on the held-out season move
    expect(bt2.perOrigin).toEqual(bt.perOrigin);
  });
});

describe('the detector decides', () => {
  it('a league whose tools work as the starting slopes say keeps them over a lifetime of refits', () => {
    let previous: ToolsModel | null = null;
    for (let through = 2031; through <= 2036; through += 1) {
      const run = fitTools(forwardLeague({ seasons: through - 2026, seed: 3 }), basis(through), previous);
      previous = run.model;
      expect(run.model.bat.source).toBe('starting');
    }
  });

  it('a league whose tools work very differently adopts its own slopes once a second refit confirms it, moved the right way', () => {
    const truth = [0.0002, 0.0002, 0.0026, 0.0002, 0.0002]; // power carries the bat; contact barely matters
    const first = fitTools(forwardLeague({ seasons: 6, slopes: truth, seed: 5 }), basis(2032), null);
    expect(first.model.bat.source).toBe('starting');
    expect(first.model.bat.reason).toBe('confirming');
    const second = fitTools(forwardLeague({ seasons: 7, slopes: truth, seed: 5 }), basis(2033), first.model);
    expect(second.model.bat.source).toBe('save');
    const served = second.model.bat.served;
    expect(served[2]).toBeGreaterThan(PRIOR[2]);
    expect(served[0]).toBeLessThan(PRIOR[0]);
  });

  it('where results are much noisier than the tools, the tools come to hold them back more (a weight over 1), never less than the results alone', () => {
    // his record before the season is far noisier than its plate appearances say (the league's results swing more than binomial noise)
    const noisyPast = (seed: number, seasons: number) => forwardLeague({ seasons, unseen: 0.002, pastPa: 400, pastNoise: 4, seed });
    const first = fitTools(noisyPast(7, 6), basis(2032), null);
    const second = fitTools(noisyPast(7, 7), basis(2033), first.model);
    expect(second.model.blend.source).toBe('save');
    expect(second.model.blend.served).toBeGreaterThan(1);
    for (const run of [first, second]) expect(run.model.blend.served).toBeGreaterThanOrEqual(1);
  });

  it('the same-season engine check is reported and never decides', () => {
    const league = forwardLeague({ seasons: 0 });
    const engineCases = forwardLeague({ seasons: 1, seed: 9 }).cases.map((c) => ({ playerId: c.playerId, x: c.x, y: c.y, weight: c.weight }));
    const run = fitTools({ ...league, engine: { season: 2026, snapshot: '2026-05-16', cases: engineCases } }, basis(2025), null);
    const check = run.record.heldOut.find((c) => c.kind === 'engine_check');
    expect(check?.passed).toBeNull();
    expect(check?.note).toMatch(/not a forecast/);
    expect(run.record.gate.passed).toBe(false);
    expect(run.model.bat.source).toBe('starting');
  });

  it('the reason is true in every state: no forward season, too few, enough but thin, one part judged and the other not', () => {
    const none = fitTools({ cases: [], forwardSeasons: [], snapshots: [], resultsK: 500, engine: null, populations: {} }, basis(2025), null);
    expect([none.model.bat.reason, none.record.gate.failures[0]]).toEqual(['forward', 'forward: 0 of 5 forward seasons']);
    const few = fitTools(forwardLeague({ seasons: 3, seed: 4 }), basis(2029), null);
    expect([few.model.bat.reason, few.record.gate.failures[0]]).toEqual(['few_forward', 'forward: 3 of 5 forward seasons']);
    const thin = fitTools(forwardLeague({ seasons: 6, per: 40, seed: 4 }), basis(2032), null);
    expect(thin.model.bat.reason).toBe('thin');
    expect(thin.record.gate.failures[0]).toMatch(/^thin: 6 forward seasons/);
    expect(thin.record.gate.reason).not.toMatch(/needed/);
    // the bat judged, the blend not (no hitter has results before the season)
    const noPast = forwardLeague({ seasons: 6, seed: 4 });
    const batOnly = fitTools({ ...noPast, cases: noPast.cases.map((c) => ({ ...c, past: null })) }, basis(2032), null);
    expect(batOnly.model.bat.reason).toBe('kept');
    expect(batOnly.model.blend.reason).toBe('thin');
    expect(batOnly.record.gate.reason).toMatch(/the rest could not be judged yet/);
  });

  it('the served slopes are scaled as checked: a league whose tools spread results twice as far adopts slopes about twice the size', () => {
    const doubled = PRIOR.map((b) => 2 * b);
    const first = fitTools(forwardLeague({ seasons: 6, slopes: doubled, seed: 8 }), basis(2032), null);
    const second = fitTools(forwardLeague({ seasons: 7, slopes: doubled, seed: 8 }), basis(2033), first.model);
    expect(second.model.bat.source).toBe('save');
    const ratio = second.model.bat.served.reduce((s, v) => s + v, 0) / PRIOR.reduce((s, v) => s + v, 0);
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.4);
  });

  it('its minimums are the detector\'s: 4 held-out forward seasons, each after one to fit on', () => {
    expect(TOOLS_FIT_POLICY.minTraining).toBeGreaterThan(0);
    const four = fitTools(forwardLeague({ seasons: 4, seed: 2 }), basis(2030), null);
    expect(four.record.gate.passed).toBe(false);
    const five = fitTools(forwardLeague({ seasons: 5, seed: 2 }), basis(2031), null);
    expect(five.record.gate.passed).toBe(true);
  });
});
