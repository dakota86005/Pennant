import { describe, expect, it } from 'vitest';
import {
  fitAging, fitAgingKind, fitDefense, measureStandards, priorAgingTable, ROSTER_REVIEW_FIT_POLICY,
  type AgingPair, type DefenseSeason, type ResultsLensSeason, type StandardHolder, type StandardsSample,
} from '../server/mlbCalibrationFit';
import { expectedAnnualChange } from '../server/roleReview';
import { STARTING_STANDARDS } from '../server/roleStandards';

/** A deterministic generator and a rough normal draw, so every synthetic league is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return { u, normal: (m = 0, sd = 1) => m + sd * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}
const clamp = (x: number) => Math.max(0, Math.min(100, x));

const ROLES: Array<[string, number]> = [['pos2', 57], ['pos3', 77], ['pos4', 51], ['pos5', 49], ['pos6', 57], ['pos7', 68], ['pos8', 50], ['pos9', 62], ['pos10', 73]];
function league(seed: number, opts: { clubs?: number; games?: number; shift?: number } = {}): StandardsSample {
  const r = rng(seed);
  const clubs = Array.from({ length: opts.clubs ?? 30 }, (_, c) => {
    const holders: StandardHolder[] = [];
    for (const [role, t] of ROLES) {
      const e = clamp(r.normal(t + (opts.shift ?? 0), 15));
      holders.push({ role, estimate: e, bat: clamp(e + r.normal(5, 5)), tools: clamp(r.normal(e, 10)), results: clamp(r.normal(e, 20)) });
    }
    for (let i = 0; i < 5; i += 1) { const e = clamp(r.normal(53, 15)); holders.push({ role: 'starter', estimate: e, bat: null, tools: clamp(r.normal(e, 10)), results: clamp(r.normal(e, 20)) }); }
    for (const [tier, t] of [['closer', 71], ['middle', 51], ['middle', 51], ['long', 37], ['long', 37], ['high_leverage', 63], ['low_leverage', 49]] as Array<[string, number]>) {
      const e = clamp(r.normal(t, 13)); holders.push({ role: `rel:${tier}`, estimate: e, bat: null, tools: clamp(r.normal(e, 10)), results: clamp(r.normal(e, 20)) });
    }
    return { clubId: c + 1, gamesPlayed: opts.games ?? 40, holders };
  });
  return { clubs };
}
function history(seed: number, seasons: number, shiftLast = 0): ResultsLensSeason[] {
  const r = rng(seed);
  return Array.from({ length: seasons }, (_, i) => {
    const shift = i === seasons - 1 ? shiftLast : 0;
    const holders: ResultsLensSeason['holders'] = [];
    for (let c = 0; c < 30; c += 1) {
      for (const [role, t] of ROLES) holders.push({ role, value: clamp(r.normal(t + shift, 25)) });
      for (let k = 0; k < 5; k += 1) holders.push({ role: 'starter', value: clamp(r.normal(60 + shift, 25)) });
      for (let k = 0; k < 7; k += 1) holders.push({ role: 'rel:other', value: clamp(r.normal(50 + shift, 25)) });
    }
    return { season: 2010 + i, holders };
  });
}
const basis = { leagueId: 1, throughSeason: 2025, gameDate: '2026-05-16' };

describe('role standards: measured from the league as it stands, checked, shrunk toward the starting values', () => {
  it('a league like the starting values passes both checks and is adopted, each role shrunk by its holders', () => {
    const run = measureStandards(league(1), history(2, 10), basis);
    expect(run.record.gate.passed).toBe(true);
    const m = run.model!;
    expect(m.served.source).toBe('save');
    // 30 holders against a strength of 10: three quarters the measurement, a quarter the starting value
    expect(m.roles.pos3.weight).toBeCloseTo(30 / 40, 5);
    expect(m.served.roles.pos3.typical).toBeCloseTo(0.75 * m.roles.pos3.typical + 0.25 * 77, 5);
    expect(run.record.heldOut.some((c) => c.kind === 'club_split')).toBe(true);
    expect(run.record.heldOut.some((c) => c.kind === 'history')).toBe(true);
    expect(run.record.notes.join(' ')).toMatch(/one pool/);
  });

  it('each lens gets its own line on its own scale', () => {
    const m = measureStandards(league(1), history(2, 10), basis).model!;
    expect(m.served.lenses.results).not.toBeNull();
    expect(m.served.lenses.tools).not.toBeNull();
    // results are noisier than the estimate here, so the results lens's own gap is wider than the estimate's
    expect(m.served.lenses.results!.gap.hitter!).toBeLessThan(m.served.gaps.hitter.floor);
  });

  it('a league with too few seasons keeps the starting yardsticks and says so', () => {
    const run = measureStandards(league(1), history(2, 1), basis);
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.reason).toMatch(/past seasons could not be checked/);
  });

  it('too few clubs, or too early in the season, is not measured at all', () => {
    expect(measureStandards(league(1, { clubs: 12 }), history(2, 10), basis).record.gate.reason).toMatch(/12 clubs/);
    const early = measureStandards(league(1, { games: 6 }), history(2, 10), basis);
    expect(early.model).toBeNull();
    expect(early.record.gate.reason).toMatch(/6 games/);
  });

  it('a floor is never moved by a fit that failed its check: a league whose next season falls away fails the history check', () => {
    const run = measureStandards(league(1), history(2, 10, -35), basis);
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.failures.some((f) => f.startsWith('history'))).toBe(true);
  });

  it('what is checked is what is served: a league far from the starting values fails the club split on its shrunk lines', () => {
    // every regular's estimate 17 points under the starting typicals: the served lines, pulled toward the starting values by the
    // holders behind them, sit above the league's own and leave far more than a tenth under them
    const run = measureStandards(league(1, { shift: -17 }), history(2, 10), basis);
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.failures.some((f) => f.startsWith('club_split estimate:hitter'))).toBe(true);
  });

  it('the share still the starting values counts the gaps and each lens, not only the typicals', () => {
    const run = measureStandards(league(1), history(2, 10), basis);
    const parts = Object.keys(run.record.priorWeight.byPart);
    expect(parts).toEqual(expect.arrayContaining(['roles', 'gap:hitter', 'tools:roles', 'results:roles', 'tools:gap:hitter', 'results:gap:hitter']));
    expect(run.record.priorWeight.overall).toBeGreaterThan(run.record.priorWeight.byPart.roles * 0.5);
  });

  it('the measurement is repeatable: the same export gives the same record', () => {
    const a = measureStandards(league(1), history(2, 10), basis);
    const b = measureStandards(league(1), history(2, 10), basis);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

function agingPairs(seed: number, curve: (age: number, season: number) => number, n: number, seasons: [number, number]): AgingPair[] {
  const r = rng(seed);
  const out: AgingPair[] = [];
  for (let i = 0; i < n; i += 1) {
    const age = 22 + Math.floor(r.u() * 17);
    const season = seasons[0] + Math.floor(r.u() * (seasons[1] - seasons[0]));
    out.push({ playerId: i % Math.max(1, Math.floor(n / 3)), season, age, change: curve(age, season) + r.normal(0, 0.02), weight: 250 });
  }
  return out;
}

describe('aging: the league\'s own curve, checked on seasons it did not see', () => {
  const decline = (age: number) => (age < 27 ? 0.001 : -0.0012 * (age - 27));
  const pitchDecline = (age: number) => (age < 27 ? 0 : 0.02 * (age - 27));
  const input = (h: AgingPair[], p: AgingPair[]) => ({ hitter: h, pitcher: p, seasons: Array.from({ length: 21 }, (_, i) => 2005 + i), skipped: [] });

  it('a steady league\'s curve passes its checks, never improves with age, and holds the starting curve where pairs are thin', () => {
    const run = fitAging(input(agingPairs(3, decline, 6000, [2005, 2025]), agingPairs(4, pitchDecline, 4000, [2005, 2025])), basis);
    expect(run.record.gate.passed).toBe(true);
    const t = run.model!.fitted;
    for (let i = 1; i < t.hitter.length; i += 1) expect(t.hitter[i]).toBeLessThanOrEqual(t.hitter[i - 1] + 1e-12);
    for (let i = 1; i < t.pitcher.length; i += 1) expect(t.pitcher[i]).toBeGreaterThanOrEqual(t.pitcher[i - 1] - 1e-12);
    expect(expectedAnnualChange(34, false, t)).toBeLessThan(-0.004);
    expect(run.record.heldOut.filter((c) => c.kind === 'age_band').length).toBeGreaterThan(0);
  });

  it('a league that ages like the starting curve keeps it: checked on held-out seasons, it held up', () => {
    const like = (age: number) => expectedAnnualChange(age, false);
    const likeP = (age: number) => expectedAnnualChange(age, true);
    const run = fitAging(input(agingPairs(8, like, 6000, [2005, 2025]), agingPairs(9, likeP, 4000, [2005, 2025])), basis);
    expect(run.record.gate.passed).toBe(true);
    expect(run.model!.serve).toEqual({ hitter: 'starting', pitcher: 'starting' });
    // the served table is empty for both kinds: the starting rows serve, and the review never calls them the league's own
    expect(run.model!.table.hitter).toEqual([]);
    expect(run.record.gate.reason).toMatch(/starting curve held up/);
  });

  it('a league that ages clearly faster adopts its own curve, and once serving keeps it unless the starting curve is clearly better', () => {
    const steep = (age: number) => (age < 26 ? 0 : -0.004 * (age - 26));
    const run = fitAging(input(agingPairs(10, steep, 6000, [2005, 2025]), agingPairs(11, pitchDecline, 4000, [2005, 2025])), basis);
    expect(run.model!.serve.hitter).toBe('save');
    expect(expectedAnnualChange(34, false, run.model!.table)).toBeLessThan(-0.02);
    const next = fitAging(input(agingPairs(12, steep, 6000, [2005, 2025]), agingPairs(13, pitchDecline, 4000, [2005, 2025])), basis, undefined, run.model);
    expect(next.model!.decisions.hitter?.rule).toBe('return_if_fallback_clearly_better');
    expect(next.model!.serve.hitter).toBe('save');
  });

  it('the curve fitted without the starting curve is checked too, and must pass', () => {
    const run = fitAging(input(agingPairs(3, decline, 6000, [2005, 2025]), agingPairs(4, pitchDecline, 4000, [2005, 2025])), basis);
    const raw = run.record.heldOut.filter((c) => c.part.startsWith('unshrunk:'));
    expect(raw.some((c) => c.kind === 'age_band')).toBe(true);
    expect(raw.some((c) => c.kind === 'error')).toBe(true);
    expect(run.record.notes.join(' ')).toMatch(/not out-of-sample/);
  });

  it('ages the league does not reach hold the end values of the fitted ages, never a pool with the starting curve', () => {
    const fit = fitAgingKind(agingPairs(3, decline, 6000, [2005, 2025]), false);
    expect(fit.values[0]).toBe(fit.values[2]);
    expect(fit.values[1]).toBe(fit.values[2]);
    expect(fit.values[fit.values.length - 1]).toBe(fit.values[fit.values.length - 3]);
  });

  it('thin history keeps the starting curve and says how thin', () => {
    const run = fitAging(input(agingPairs(3, decline, 400, [2005, 2025]), agingPairs(4, pitchDecline, 400, [2005, 2025])), basis);
    expect(run.model).toBeNull();
    expect(run.record.gate.reason).toMatch(/fewer than 1000/);
  });

  it('with no pairs at an age the curve is the starting one there', () => {
    const fit = fitAgingKind(agingPairs(5, decline, 3000, [2005, 2025]).filter((p) => p.age < 30), false);
    const at42 = fit.values[fit.values.length - 1];
    expect(at42).toBeLessThanOrEqual(expectedAnnualChange(42, false) + 1e-9);
  });

  it('a league whose aging changed after the training seasons fails the check, and the reason is recorded', () => {
    // decline until 2016, then players improve with age
    const flipped = (age: number, season: number) => (season < 2016 ? decline(age) : 0.02);
    const run = fitAging(input(agingPairs(6, flipped, 8000, [2005, 2025]), agingPairs(7, pitchDecline, 4000, [2005, 2025])), basis);
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.reason).toMatch(/^Not adopted/);
  });

  it('the starting table reproduces the built-in rows', () => {
    const t = priorAgingTable();
    expect(expectedAnnualChange(34, false, t)).toBe(expectedAnnualChange(34, false));
    expect(expectedAnnualChange(29, true, t)).toBe(expectedAnnualChange(29, true));
  });
});

describe('defense: glove weights from fielding results, inactive without zone rating', () => {
  it('a history with no zone-rating seasons fits nothing and says why in plain words', () => {
    const run = fitDefense([], basis);
    expect(run.model).toBeNull();
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.reason).toMatch(/no two seasons in a row with fielding runs/);
  });

  function fielding(seed: number, seasons: number, sdDef: number, sdBat: number): DefenseSeason[] {
    const r = rng(seed);
    const players = Array.from({ length: 8 * 60 }, (_, i) => ({ id: i, pos: 2 + (i % 8), def: r.normal(0, sdDef), bat: r.normal(0, sdBat) }));
    return Array.from({ length: seasons }, (_, s) => ({
      season: 2030 + s,
      lines: players.map((p) => ({ playerId: p.id, position: p.pos, pa: 550, innings: 1200, batRuns600: p.bat + r.normal(0, 8), fieldRuns1300: p.def + r.normal(0, 6) })),
    }));
  }

  it('equal repeatable spreads give a weight near a half, and the next season checks it', () => {
    const run = fitDefense(fielding(8, 3, 10, 10), { ...basis, throughSeason: 2032 });
    expect(run.model).not.toBeNull();
    const w = run.model!.positions[6];
    expect(w.measured!).toBeGreaterThan(0.35);
    expect(w.measured!).toBeLessThan(0.65);
    expect(run.record.heldOut.length).toBeGreaterThan(0);
    expect(run.model!.weights[10]).toBe(0);
  });

  it('two zone-rating seasons fit but cannot be checked, so they are not adopted', () => {
    const run = fitDefense(fielding(9, 2, 10, 10), { ...basis, throughSeason: 2031 });
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.reason).toMatch(/no later season/);
  });
});

describe('policy is declared, not fitted', () => {
  it('the policy names every minimum and tolerance the fits use', () => {
    expect(ROSTER_REVIEW_FIT_POLICY.standards.minGamesPerClub).toBe(15);
    expect(ROSTER_REVIEW_FIT_POLICY.aging.minBandPairs).toBe(50);
    expect(STARTING_STANDARDS.source).toBe('starting');
  });
});
