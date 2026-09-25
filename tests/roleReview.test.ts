import { describe, expect, it } from 'vitest';
import {
  CONCERN, compareReplacement, estimateOf, PITCHER_RESULTS_MIX, REVIEW_CALIBRATION, reviewGroup, type ReviewSubject,
} from '../server/roleReview';

/*
 * The scouting read on a role holder: two lenses, a working estimate that says how
 * it was formed, findings that are flags and never triggers, and unknown stays unknown.
 */

const sp = (id: number, over: Partial<ReviewSubject> = {}): ReviewSubject => ({
  playerId: id, name: `P${id}`, age: 28, ratingsPct: 55, ratingsEvidence: 'complete', skillsPct: 55, runsPct: 55,
  sample: 900, sampleUnit: 'BF', toolsWeight: 1, reliability: 0.75, currentSample: 180, ...over,
});
const rotation = (soroka: Partial<ReviewSubject> = {}): ReviewSubject[] => [
  sp(1, { ratingsPct: 60, skillsPct: 68, runsPct: 60 }),
  sp(2, { ratingsPct: 55, skillsPct: 73, runsPct: 77 }),
  sp(3, { ratingsPct: 50, skillsPct: 58, runsPct: 36 }),
  sp(4, { ratingsPct: 47, skillsPct: 60, runsPct: 40 }),
  sp(5, { ratingsPct: 35, skillsPct: 25, runsPct: 26, ...soroka }),
];
const byId = (r: ReturnType<typeof reviewGroup>, id: number) => r.find((x) => x.playerId === id)!;
const review = (h: ReviewSubject[]) => reviewGroup(h, { pitcher: true, role: 'starting pitcher' });

describe('the working estimate', () => {
  it('weights results by how far the sample can be trusted, and says so', () => {
    const e = estimateOf(sp(1, { ratingsPct: 40, skillsPct: 80, runsPct: 80, reliability: 0.5 }));
    expect(e).toMatchObject({ basis: 'ratings_and_results', weightOnResults: 0.5, resultsPct: 80 });
    expect(e.value).toBeCloseTo(60);
  });

  it('a pitcher\'s results are mostly peripherals with runs allowed as the smaller part', () => {
    const e = estimateOf(sp(1, { skillsPct: 80, runsPct: 40, ratingsPct: 60, reliability: 1 }));
    expect(e.resultsPct).toBeCloseTo(PITCHER_RESULTS_MIX.skills * 80 + PITCHER_RESULTS_MIX.runs * 40);
  });

  it('with no results it is the tools alone; with no tools it is the results alone; with neither it is unknown', () => {
    expect(estimateOf(sp(1, { skillsPct: null, runsPct: null }))).toMatchObject({ basis: 'ratings_only', value: 55, weightOnResults: 0 });
    expect(estimateOf(sp(1, { ratingsPct: null }))).toMatchObject({ basis: 'results_only', weightOnResults: 1 });
    expect(estimateOf(sp(1, { ratingsPct: null, skillsPct: null, runsPct: null }))).toMatchObject({ basis: 'none', value: null });
  });
});

describe('a holder in his group', () => {
  it('both lenses weak and the weakest of the group: a strong, agreeing case', () => {
    const r = byId(review(rotation()), 5);
    expect(r).toMatchObject({ kind: 'ratings_and_results_weak', strength: 'strong', isWeakest: true, rank: 5, groupSize: 5 });
    expect(r.reasons.join(' ')).toMatch(/tools 35th percentile.*results 2\dth.*the weakest of 5/);
    expect(r.calibration).toBe(REVIEW_CALIBRATION);
  });

  it('the rest of a healthy group raises no concern', () => {
    const r = review(rotation());
    for (const id of [1, 2, 3, 4]) expect(byId(r, id)).toMatchObject({ kind: 'no_concern', strength: 'none' });
  });

  it('a thin sample is "too early", never a finding about the man', () => {
    const r = byId(review(rotation({ reliability: 0.1, sample: 30, currentSample: 30 })), 5);
    expect(r).toMatchObject({ kind: 'too_early', strength: 'watch' });
  });

  it('weak tools but fine results is a watch item, with the regression explanation', () => {
    const r = byId(review(rotation({ ratingsPct: 30, skillsPct: 62, runsPct: 62, reliability: 0.8 })), 5);
    expect(r.kind === 'tools_weak_results_fine' || r.kind === 'no_concern').toBe(true);
    if (r.kind === 'tools_weak_results_fine') expect(r.strength).toBe('watch');
    expect(r.explanations.join(' ')).toMatch(/results \(62nd\) are well ahead of his visible tools \(30th\)/);
  });

  it('weak results but fine tools is a watch item: he may be underperforming his tools', () => {
    const r = byId(review(rotation({ ratingsPct: 58, skillsPct: 15, runsPct: 12, reliability: 0.8 })), 5);
    expect(r.kind).toBe('results_weak_tools_fine');
    expect(r.strength).toBe('watch');
    expect(r.explanations.join(' ')).toMatch(/underperforming what the tools suggest/);
  });

  it('runs allowed far worse than peripherals is named as a competing explanation (luck)', () => {
    const r = byId(review(rotation({ skillsPct: 58, runsPct: 20 })), 5);
    expect(r.explanations.join(' ')).toMatch(/runs allowed \(20th\) are well behind.*may be costing him/);
  });

  it('age is a stated risk, not a lens', () => {
    const r = byId(review(rotation({ age: 37 })), 5);
    expect(r.explanations.join(' ')).toMatch(/At 37, decline is a risk/);
    expect(r.estimate.value).toBe(byId(review(rotation({ age: 25 })), 5).estimate.value);
  });

  it('a holder with no evidence on either lens cannot be judged, and is not assumed weak', () => {
    const g = [...rotation(), sp(6, { ratingsPct: null, skillsPct: null, runsPct: null, sample: 0, reliability: 0 })];
    const r = byId(review(g), 6);
    expect(r).toMatchObject({ kind: 'cannot_judge', strength: 'none', rank: null });
    expect(byId(review(g), 5).groupSize).toBe(5); // he does not enter the group's median either
  });

  it('a group of one has no relative concern, only an absolute one', () => {
    const solo = reviewGroup([sp(1, { ratingsPct: 60, skillsPct: 60, runsPct: 60 })], { pitcher: true, role: 'starting pitcher' });
    expect(solo[0].kind).toBe('no_concern');
    const weak = reviewGroup([sp(1, { ratingsPct: 20, skillsPct: 15, runsPct: 15, reliability: 0.8 })], { pitcher: true, role: 'starting pitcher' });
    expect(weak[0].strength === 'moderate' || weak[0].strength === 'strong').toBe(true);
  });

  it('exposes the thresholds it used through calibration, not through the verdict', () => {
    expect(CONCERN.absoluteEstimate).toBeGreaterThan(0);
    expect(REVIEW_CALIBRATION.status).toBe('policy');
  });
});

describe('a candidate against the incumbent', () => {
  const inc = sp(5, { ratingsPct: 35, skillsPct: 25, runsPct: 26 });
  const cand = (over: Partial<ReviewSubject>) => sp(9, { name: 'Cand', ...over });

  it('a clear upgrade needs the gap and an adequate read on the candidate', () => {
    const c = compareReplacement(cand({ ratingsPct: 60, skillsPct: 62, runsPct: 60, reliability: 0.6 }), inc);
    expect(c).toMatchObject({ verdict: 'clear_upgrade', certainty: 'adequate' });
    expect(c.delta).toBeGreaterThan(8);
  });

  it('the same gap on tools alone is an uncertain upgrade, and says why', () => {
    const c = compareReplacement(cand({ ratingsPct: 60, skillsPct: null, runsPct: null, reliability: 0, sample: 0 }), inc);
    expect(c.verdict).toBe('upgrade_uncertain');
    expect(c.certainty).toBe('limited');
    expect(c.reasons.join(' ')).toMatch(/no qualifying major-league results, so this rests on his tools/);
  });

  it('incomplete tools make the read thin', () => {
    expect(compareReplacement(cand({ ratingsPct: 60, ratingsEvidence: 'partial', skillsPct: null, runsPct: null, reliability: 0 }), inc).certainty).toBe('thin');
  });

  it('sorts out marginal, side and downgrade moves', () => {
    const at = (r: number) => compareReplacement(cand({ ratingsPct: r, skillsPct: r, runsPct: r, reliability: 0.6 }), sp(5, { ratingsPct: 50, skillsPct: 50, runsPct: 50, reliability: 0.6 })).verdict;
    expect(at(55)).toBe('marginal');
    expect(at(52)).toBe('sidegrade');
    expect(at(40)).toBe('downgrade');
  });

  it('cannot judge when either has no evidence', () => {
    expect(compareReplacement(cand({ ratingsPct: null, skillsPct: null, runsPct: null }), inc).verdict).toBe('cannot_judge');
  });
});
