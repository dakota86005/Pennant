import { PLATOON_PRIOR } from '../server/platoon';
import { describe, expect, it } from 'vitest';
import { detectNeeds, IL_RETURN_WINDOW_DAYS } from '../server/mlbNeeds';
import { buildLineupPicture, PARTNER_SHARE, REGULAR_SHARE, type HitterUsageInput } from '../server/lineupPicture';
import { COMPLEMENT_MARGIN, complementFit, evaluatePlatoon, MIN_SPLIT_PA, PROBLEM_EXCESS, type PlatoonInput, type PlatoonRead } from '../server/platoon';
import { CREDIBLE_HIGH_LEVERAGE, DEPLOYMENT_GAP, deploymentFindings, LEVERAGE, MIN_APPEARANCES, penFindings, roleOf, type PenArm } from '../server/bullpenRoles';
import { BULLPEN_PRIOR } from '../server/bullpenRoles';
import { reviewGroup, type LensEvidence, type ReviewSubject } from '../server/roleReview';
import { hitterStandard, relieverStandard, starterStandard } from '../server/roleStandards';
import { readContext, SEASON, WINDOW } from '../server/staffPreference';
import { shiftOptions, SHIFT_MIN_EDGE, SHIFT_MIN_GAIN } from '../server/lineupShifts';
import type { BattingLine } from '../server/resultsMetrics';
import { healthy26, viewOf } from './mlbFixtures';

/*
 * BOUNDARIES: every policy threshold, tested at the value itself and one step either side. A threshold is a decision the product made; these
 * pin exactly which side of it each case falls on, so a change to a threshold is a visible, deliberate change to these tests.
 */

describe('role floors: the line between a concern and none, and between moderate and strong', () => {
  const at = (estimate: number): LensEvidence => ({ ratingsPct: estimate, ratingsEvidence: 'complete', skillsPct: estimate, runsPct: estimate, sample: 500, sampleUnit: 'BF', toolsWeight: 1, reliability: 1, currentSample: 200, usage: [] });
  const run = (estimate: number) => reviewGroup([{ playerId: 1, name: 'S', age: 28, ...at(estimate) } as ReviewSubject], { pitcher: true, role: 'starting pitcher', standard: () => starterStandard() })[0];
  const s = starterStandard();

  it('an estimate at the floor is no concern; one point under is a moderate case; under the deep floor is strong', () => {
    // (a hair either side: an estimate is a blend of floating-point percentiles, so "exactly on the line" is not a case worth pinning)
    expect(run(s.floor + 0.5).strength).toBe('none');
    expect(run(s.floor + 0.01).strength).toBe('none');
    expect(run(s.floor - 0.5).strength).toBe('moderate');
    expect(run(s.deepFloor + 0.01).strength).toBe('moderate');
    expect(run(s.deepFloor - 0.5).strength).toBe('strong');
  });

  it('the lens has to be weak on its own line too: an estimate under the floor with a lens above it is a watch item, not a case', () => {
    const lopsided: LensEvidence = { ...at(s.floor - 2), ratingsPct: s.lensFloor + 10, skillsPct: 5, runsPct: 5, reliability: 0.1 }; // estimate pulled under the floor by results alone
    const r = reviewGroup([{ playerId: 1, name: 'S', age: 28, ...lopsided } as ReviewSubject], { pitcher: true, role: 'starting pitcher', standard: () => starterStandard() })[0];
    expect(['none', 'watch']).toContain(r.strength);
  });
});

describe('the regular share: 40% of the innings', () => {
  const hit = (name: string, innings: number): HitterUsageInput => ({ playerId: 1, name, bats: 'R', listed: 7, gs: 10, pa: 40, fielding: [{ position: 7, gs: 10, ip: innings }] });
  const spot = (innings: number) => buildLineupPicture([hit('L', innings)], 40).spots.find((x) => x.position === 7)!;
  it('at 40% of the team\'s innings he is the regular; a hair under, the spot is unsettled', () => {
    const denominator = 40 * 9;
    expect(spot(denominator * REGULAR_SHARE).settled).toBe(true);
    expect(spot(denominator * REGULAR_SHARE - 0.5).settled).toBe(false);
  });
  it('a backup at 25% is a partner; a hair under is not', () => {
    const denominator = 40 * 9;
    const picture = (partnerInnings: number) => buildLineupPicture([{ ...hit('Reg', denominator * 0.6), playerId: 1 }, { ...hit('Part', partnerInnings), playerId: 2 }], 40).spots.find((x) => x.position === 7)!;
    expect(picture(denominator * PARTNER_SHARE).partner?.name).toBe('Part');
    expect(picture(denominator * PARTNER_SHARE - 0.5).partner).toBeNull();
  });
});

describe('platoon: the minimum split, the problem margin, the complement margin', () => {
  const line = (pa: number, woba: 'good' | 'poor'): BattingLine => ({
    year: 2030, g: 0, gs: 0, pa, ab: Math.round(pa * 0.9), h: Math.round(pa * 0.9 * (woba === 'good' ? 0.34 : 0.19)), d: 0, t: 0, hr: 0, bb: 0, ibb: 0, hp: 0, sf: 0, k: 0, sb: 0, cs: 0, gdp: 0, war: 0, ubr: 0,
  });
  const input = (over: Partial<PlatoonInput>): PlatoonInput => ({ recordStabilization: 300, platoon: PLATOON_PRIOR, leagueLeftShare: 0.3, bats: 'L', vsLeft: [], vsRight: [], leagueEffect: 0.015, leagueWoba: 0.32, ...over });

  it('a record is read only when the less-faced hand has at least the minimum plate appearances', () => {
    const reads = (n: number) => evaluatePlatoon(input({ vsLeft: [line(n, 'poor')], vsRight: [line(400, 'good')], ratings: { vsLeft: -0.0075, vsRight: 0.0075, norm: 0.015 } })).basis;
    expect(reads(MIN_SPLIT_PA)).toBe('ratings_and_splits');
    expect(reads(MIN_SPLIT_PA - 1)).toBe('ratings');
  });

  it('a departure just under the problem margin is no issue; just over is a problem', () => {
    // overall level from ratings; the weak side is left; excess = pr * departure with the default share of left-handed pitching (0.3)
    const verdict = (departure: number) => evaluatePlatoon(input({ ratings: { vsLeft: -(0.015 + departure) / 2, vsRight: (0.015 + departure) / 2, norm: 0.015 } })).verdict;
    const need = PROBLEM_EXCESS / 0.7; // excess over the league effect = 0.7 * departure when the league effect is explained by the norm
    expect(verdict(need * 0.95)).toBe('no_issue');
    expect(verdict(need * 1.05)).toBe('problem');
  });

  it('a complement must beat the regular by the margin against the weak hand', () => {
    const read = (vsLeft: number): PlatoonRead => ({
      bats: 'R', vsLeft: { pa: 0, observed: null, expected: vsLeft }, vsRight: { pa: 0, observed: null, expected: 0.32 }, overall: 0.32, weakSide: null, weakBy: null, excessOverLeague: null, reliability: 0,
      basis: 'ratings', ratingDeparture: 0, difference: 0, drivers: { league: 0, ratings: 0, record: 0 }, verdict: 'no_issue', reasons: [], calibration: { status: 'calibrated', basis: '', run: null },
    });
    const regular: PlatoonRead = { ...read(0.3), weakSide: 'L', verdict: 'problem' };
    expect(complementFit(regular, read(0.3 + COMPLEMENT_MARGIN + 0.001)).fits).toBe(true);
    expect(complementFit(regular, read(0.3 + COMPLEMENT_MARGIN - 0.001)).fits).toBe(false);
  });
});

describe('the bullpen: appearances, leverage cut-offs, the deployment gap, the credible arm', () => {
  const use = (over: Partial<Parameters<typeof roleOf>[0]>) => roleOf({ playerId: 1, name: 'R', g: 30, ip: 30, sv: 0, hld: 0, leverage: 1.0, ...over }, BULLPEN_PRIOR).tier;
  it('a role is read from the minimum appearances on', () => {
    expect(use({ g: MIN_APPEARANCES, leverage: 2, sv: 3 })).toBe('closer');
    expect(use({ g: MIN_APPEARANCES - 1, leverage: 2, sv: 3 })).toBe('unknown');
  });
  it('the leverage cut-offs: high at the line, low just under it, a closer only with a save', () => {
    expect(use({ leverage: LEVERAGE.high })).toBe('high_leverage');
    expect(use({ leverage: LEVERAGE.high - 0.01 })).toBe('middle');
    expect(use({ leverage: LEVERAGE.low - 0.01 })).toBe('low_leverage');
    expect(use({ leverage: LEVERAGE.low })).toBe('middle');
    expect(use({ leverage: LEVERAGE.closer, sv: 1 })).toBe('closer');
    expect(use({ leverage: LEVERAGE.closer, sv: 0 })).toBe('high_leverage');
  });
  it('a deployment is called backwards when the better arm leads by the gap, not before', () => {
    const arm = (id: number, tier: PenArm['tier'], estimate: number): PenArm => ({ playerId: id, name: `A${id}`, tier, estimate });
    expect(deploymentFindings([arm(1, 'closer', 40), arm(2, 'middle', 40 + DEPLOYMENT_GAP)])).toHaveLength(1);
    expect(deploymentFindings([arm(1, 'closer', 40), arm(2, 'middle', 40 + DEPLOYMENT_GAP - 0.5)])).toHaveLength(0);
  });
  it('the credible high-leverage line: the best arm at it is credible, just under it the pen has none', () => {
    const pen = (best: number): PenArm[] => [
      { playerId: 1, name: 'A1', tier: 'closer', estimate: best }, { playerId: 2, name: 'A2', tier: 'high_leverage', estimate: best - 5 }, { playerId: 3, name: 'A3', tier: 'middle', estimate: best - 8 },
      { playerId: 4, name: 'A4', tier: 'middle', estimate: best - 9 }, { playerId: 5, name: 'A5', tier: 'long', estimate: best - 12, ipPerAppearance: 2 },
    ];
    expect(penFindings(pen(CREDIBLE_HIGH_LEVERAGE), BULLPEN_PRIOR).some((f) => f.kind === 'no_credible_high_leverage')).toBe(false);
    expect(penFindings(pen(CREDIBLE_HIGH_LEVERAGE - 0.5), BULLPEN_PRIOR).some((f) => f.kind === 'no_credible_high_leverage')).toBe(true);
  });
  it('the reliever standards are ordered with their roles', () => {
    expect(relieverStandard('closer').floor).toBeGreaterThan(relieverStandard('long').floor);
    expect(hitterStandard(3)!.floor).toBeGreaterThan(hitterStandard(8)!.floor);
  });
});

describe('a shift: the minimum gain and the edge over the direct change', () => {
  const est: Record<number, Record<number, number>> = { 1: { 7: 30, 6: 50 }, 2: { 6: 70, 7: 30 + SHIFT_MIN_GAIN }, 10: { 6: 70, 7: 40 } };
  const input = (direct?: number | null) => ({
    target: { position: 7, playerId: 1, name: 'W' }, regulars: [{ position: 6, playerId: 2, name: 'M' }], bench: [{ playerId: 10, name: 'B' }],
    supported: () => true, estimate: (id: number, pos: number) => est[id]?.[pos] ?? null, ...(direct === undefined ? {} : { direct }),
  });
  it('a shift that gains exactly the minimum is proposed; one point less is not', () => {
    // gain = mover at target + cover at vacated - (before + mover at home) = (38) + 70 - (30 + 70) = 8
    expect(shiftOptions(input())).toHaveLength(1);
    const lower = { ...est, 2: { ...est[2], 7: 30 + SHIFT_MIN_GAIN - 1 } };
    expect(shiftOptions({ ...input(), estimate: (id, pos) => lower[id]?.[pos] ?? null })).toHaveLength(0);
  });
  it('and it must beat the plain lineup change by the edge', () => {
    expect(shiftOptions(input(SHIFT_MIN_GAIN - SHIFT_MIN_EDGE))).toHaveLength(1);
    expect(shiftOptions(input(SHIFT_MIN_GAIN - SHIFT_MIN_EDGE + 0.5))).toHaveLength(0);
  });
});

describe('roster floors and the window for an injured player\'s return', () => {
  it('four healthy starters is under the floor of five; five is not', () => {
    const out = healthy26().map((s) => (s.id === 100 ? { ...s, il: true, active: false, daysLeft: 60 } : s));
    expect(detectNeeds(viewOf(out)).some((n) => n.kind === 'role_below_standard' && n.role?.kind === 'starting_pitcher')).toBe(true);
    expect(detectNeeds(viewOf(healthy26())).some((n) => n.kind === 'role_below_standard')).toBe(false);
  });

  it('an injured player due back inside the window with a full roster is a return decision; one day past it is not yet', () => {
    const club = (days: number) => viewOf([...healthy26(), { id: 300, name: 'Hurt', position: 1, role: 11, il: true, active: false, forty: true, daysLeft: days }]);
    expect(detectNeeds(club(IL_RETURN_WINDOW_DAYS)).some((n) => n.kind === 'il_return_crunch')).toBe(true);
    expect(detectNeeds(club(IL_RETURN_WINDOW_DAYS + 1)).some((n) => n.kind === 'il_return_crunch')).toBe(false);
  });
});

describe('the club\'s context: the window and the season cut-offs', () => {
  const read = (window: number | undefined, odds: number | null) => readContext({ dimensions: window === undefined ? {} : { competitiveWindow: window }, posture: odds === null ? null : { posture: 'hold', odds, gamesLeft: 100, deadlinePassed: false, headline: '' } });
  it('the window: contending at the line, building at the line, balanced between', () => {
    expect(read(WINDOW.contending, null)?.window.label).toBe('contending');
    expect(read(WINDOW.contending - 1, null)?.window.label).toBe('balanced');
    expect(read(WINDOW.building, null)?.window.label).toBe('building');
    expect(read(WINDOW.building + 1, null)?.window.label).toBe('balanced');
  });
  it('the season: in it at the line, out of it at the line', () => {
    expect(read(50, SEASON.inIt)?.season.read).toBe('in_it');
    expect(read(50, SEASON.inIt - 0.01)?.season.read).toBe('on_the_fence');
    expect(read(50, SEASON.outOfIt)?.season.read).toBe('out_of_it');
    expect(read(50, SEASON.outOfIt + 0.01)?.season.read).toBe('on_the_fence');
  });
});

describe('the "too early" line: trust in his results as his level, never the blend with his tools (cycle 4)', () => {
  const s = starterStandard();
  // A weak starter on both lenses, so only the sample can make the read "too early"
  const weak = (reliability: number, toolsWeight: number): LensEvidence => ({ ratingsPct: s.deepFloor - 10, ratingsEvidence: 'complete', skillsPct: s.deepFloor - 10, runsPct: s.deepFloor - 10, sample: 300, sampleUnit: 'BF', toolsWeight, reliability, currentSample: 100, usage: [] });
  const run = (e: LensEvidence, pitcher = true) => reviewGroup([{ playerId: 1, name: 'S', age: 28, ...e } as ReviewSubject], { pitcher, role: 'starting pitcher', standard: () => starterStandard() })[0];

  it('a pitcher a hair under 0.30 of his own K is too early to judge; a hair over is judged', () => {
    expect(run(weak(0.299, 1)).kind).toBe('too_early');
    expect(run(weak(0.301, 1)).kind).not.toBe('too_early');
  });

  it('how much his tools hold his results back never decides whether there is enough sample to judge', () => {
    for (const trust of [0.2, 0.299, 0.301, 0.5, 0.8]) {
      const kinds = [1, 1.5, 3, 10].map((w) => run(weak(trust, w)).kind === 'too_early');
      expect(new Set(kinds).size, `trust ${trust}`).toBe(1);
    }
  });

  it('a working estimate built without the tools weight in force is refused, never given a default', () => {
    const missing = { ...weak(0.5, 1) } as Partial<LensEvidence>;
    delete missing.toolsWeight;
    expect(() => run(missing as LensEvidence)).toThrow(/tools weight/);
  });
});
