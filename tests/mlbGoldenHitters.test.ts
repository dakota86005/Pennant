import { describe, expect, it } from 'vitest';
import { compareReplacement, DEFENSE_WEIGHT, estimateOf, reviewGroup, RUNNING_WEIGHT, type LensEvidence, type ReviewSubject } from '../server/roleReview';
import { hitterStandard } from '../server/roleStandards';

/*
 * GOLDEN CASES: position players. Baseball invariants about how a hitter is read for the job he is doing.
 *
 *   the same bat is a different finding at shortstop and at first base;
 *   a designated hitter is his bat and nothing else;
 *   an unseen glove stays unseen: it is neither zero nor average, and it makes a comparison less firm;
 *   speed alone does not make a complete offensive player.
 */

const SS = 6;
const FIRST = 3;
const DH = 10;

/** A hitter whose bat (tools and results) is at `bat`, glove (a percentile among peers at the position) at `glove`, running at `run`. */
function hitter(position: number, bat: number, glove: number | null, run: number | null = null, over: Partial<LensEvidence> = {}): LensEvidence {
  return {
    position, ratingsPct: bat, ratingsEvidence: 'complete', skillsPct: bat, runsPct: null, sample: 900, sampleUnit: 'PA', toolsWeight: 1, reliability: 0.75, currentSample: 150,
    defense: { stabilization: 1000, pct: glove, grade: glove === null ? null : 50, visible: glove !== null },
    running: run === null ? undefined : { stabilization: 550, ability: 50, toolsPct: run, resultsPct: run, perSixHundred: 0, sample: 900 },
    usage: [], ...over,
  };
}
const subject = (id: number, e: LensEvidence): ReviewSubject => ({ playerId: id, name: `P${id}`, age: 28, ...e });
const review = (e: LensEvidence) => reviewGroup([subject(1, e)], { pitcher: false, role: 'lineup regular', standard: (h) => hitterStandard(h.position) })[0];

describe('GOLDEN hitters: the same bat is a different finding in a different job', () => {
  it('a light-hitting elite-glove shortstop is not read like a DH with the same offensive line', () => {
    const ss = estimateOf(hitter(SS, 30, 95), false);
    const dh = estimateOf(hitter(DH, 30, 95), false);
    expect(dh.value).toBe(30); // a designated hitter is his bat
    expect(ss.value as number).toBeGreaterThan((dh.value as number) + 15); // the shortstop's glove is a large part of his value
    expect(ss.weightOnDefense).toBe(DEFENSE_WEIGHT[SS]);
  });

  it('the same weak bat is a concern at designated hitter and at first base but not at shortstop', () => {
    expect(review(hitter(SS, 30, 70)).strength).toBe('none');
    expect(review(hitter(DH, 30, null)).strength).toBe('strong');
    expect(['strong', 'moderate']).toContain(review(hitter(FIRST, 30, 50)).strength);
  });

  it('every finding names the standard it was measured against, so the position is never a hidden adjustment', () => {
    const r = review(hitter(FIRST, 30, 50));
    expect(r.standard).toMatchObject({ label: expect.stringMatching(/first basemen/), typical: expect.any(Number), floor: expect.any(Number) });
    expect(r.concern.rule).toMatch(/below_(deep|role)_floor/);
    expect(r.reasons.join(' ')).toMatch(/regular first basemen/);
  });

  it('a good bat is not a concern anywhere, however poor the glove', () => {
    for (const pos of [2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(review(hitter(pos, 85, 10)).strength).toBe('none');
  });
});

describe('GOLDEN hitters: a designated hitter is only his bat', () => {
  it('a glove shown for a designated hitter adds nothing', () => {
    const with_ = estimateOf(hitter(DH, 60, 99), false);
    const without = estimateOf(hitter(DH, 60, null), false);
    expect(with_.weightOnDefense).toBe(0);
    expect(with_.value).toBe(without.value);
    expect(DEFENSE_WEIGHT[DH]).toBe(0);
  });
});

describe('GOLDEN hitters: an unseen glove stays unseen', () => {
  it('is neither zero nor average: the estimate is the bat alone, the weight on the glove is zero, and the review says the glove is not visible', () => {
    const unseen = review(hitter(SS, 90, null));
    expect(unseen.estimate.weightOnDefense).toBe(0);
    expect(unseen.estimate.defensePct).toBeNull();
    expect(unseen.explanations.join(' ')).toMatch(/defense .* is not visible/i);
  });

  it('a comparison that leans on an unseen glove at a premium position is not firm, however good the bat', () => {
    const incumbent = subject(1, hitter(SS, 50, 50));
    const candidate = subject(2, hitter(SS, 95, null));
    const c = compareReplacement(candidate, incumbent, false);
    expect(c.delta as number).toBeGreaterThanOrEqual(8); // on the bat alone he is a clear upgrade
    expect(c.verdict).not.toBe('clear_upgrade'); // but the position is one that is half glove, and the glove is not known
    expect(c.certainty).not.toBe('adequate');
    expect(c.reasons.join(' ')).toMatch(/glove|defense/i);
  });

  it('no such caveat where the glove barely matters', () => {
    const incumbent = subject(1, hitter(DH, 50, null));
    const candidate = subject(2, hitter(DH, 95, null));
    expect(compareReplacement(candidate, incumbent, false).verdict).toBe('clear_upgrade');
  });
});

describe('GOLDEN hitters: speed alone is not a complete offensive player', () => {
  it('an elite runner with a poor bat is still a poor offensive player', () => {
    const speedster = estimateOf(hitter(DH, 10, null, 99), false);
    expect(speedster.value as number).toBeLessThan(20);
    expect(speedster.weightOnRunning).toBe(RUNNING_WEIGHT);
  });

  it('elite running lifts a hitter by a few points, never enough to change what he is', () => {
    const fast = estimateOf(hitter(FIRST, 50, 50, 99), false).value as number;
    const slow = estimateOf(hitter(FIRST, 50, 50, 1), false).value as number;
    expect(fast - slow).toBeGreaterThan(0);
    expect(fast - slow).toBeLessThan(10);
  });

  it('a strong runner with a weak bat still ranks below a strong bat who is a poor runner', () => {
    const runner = estimateOf(hitter(FIRST, 30, 50, 99), false).value as number;
    const slugger = estimateOf(hitter(FIRST, 80, 50, 1), false).value as number;
    expect(slugger).toBeGreaterThan(runner + 20);
  });
});

describe('GOLDEN hitters: metamorphic relations', () => {
  it('improving his bat never lowers his estimate, at any position', () => {
    for (const pos of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      let last = -1;
      for (const bat of [5, 20, 35, 50, 65, 80, 95]) {
        const v = estimateOf(hitter(pos, bat, 50, 50), false).value as number;
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
    }
  });

  it('improving his glove never lowers his estimate, and never lowers his defensive contribution', () => {
    for (const pos of [2, 3, 4, 5, 6, 7, 8, 9]) {
      let last = -1;
      let lastGlove = -1;
      for (const glove of [5, 25, 50, 75, 95]) {
        const e = estimateOf(hitter(pos, 55, glove), false);
        expect(e.value as number).toBeGreaterThanOrEqual(last);
        expect(e.defensePct as number).toBeGreaterThanOrEqual(lastGlove);
        last = e.value as number;
        lastGlove = e.defensePct as number;
      }
    }
  });

  it('moving the same player from DH to a premium defensive position makes his glove matter, in proportion to the position', () => {
    const glove = 90;
    const asDh = estimateOf(hitter(DH, 40, glove), false);
    const asSs = estimateOf(hitter(SS, 40, glove), false);
    const asFirst = estimateOf(hitter(FIRST, 40, glove), false);
    expect(asDh.weightOnDefense).toBe(0);
    expect(asFirst.weightOnDefense as number).toBeGreaterThan(0);
    expect(asSs.weightOnDefense as number).toBeGreaterThan(asFirst.weightOnDefense as number);
    expect(asSs.value as number).toBeGreaterThan(asFirst.value as number);
    expect(asFirst.value as number).toBeGreaterThan(asDh.value as number);
  });

  it('the position changes the standard he is judged against, never the evidence about him', () => {
    const e = hitter(SS, 40, 70);
    const asSs = review(e);
    const asFirst = reviewGroup([subject(1, { ...e, position: FIRST })], { pitcher: false, role: 'lineup regular', standard: (h) => hitterStandard(h.position) })[0];
    expect(asSs.evidence.ratingsPct).toBe(asFirst.evidence.ratingsPct);
    expect(asSs.evidence.skillsPct).toBe(asFirst.evidence.skillsPct);
    expect(asSs.standard?.floor).not.toBe(asFirst.standard?.floor);
  });
});
