import { describe, expect, it } from 'vitest';
import { compareReplacement, expectedAnnualChange, reviewGroup, type LensEvidence, type ReviewSubject } from '../server/roleReview';
import { hitterStandard, relieverStandard, starterStandard, type RoleStandard } from '../server/roleStandards';

/*
 * INVARIANTS: relationships that must hold whatever the numbers are. Each is a statement about baseball or about the design, not an
 * example; if one fails, either the model has a defect or the invariant was wrong, and either is worth knowing.
 */

const hitter = (position: number, bat: number, glove: number | null): LensEvidence => ({
  position, ratingsPct: bat, ratingsEvidence: 'complete', skillsPct: bat, runsPct: null, sample: 900, sampleUnit: 'PA', reliability: 0.75, currentSample: 150,
  defense: { stabilization: 1000, pct: glove, grade: glove === null ? null : 50, visible: glove !== null }, usage: [],
});
const pitcher = (pct: number): LensEvidence => ({ ratingsPct: pct, ratingsEvidence: 'complete', skillsPct: pct, runsPct: pct, sample: 500, sampleUnit: 'BF', reliability: 0.7, currentSample: 120, usage: [] });
const subject = (id: number, e: LensEvidence, age = 28): ReviewSubject => ({ playerId: id, name: `P${id}`, age, ...e });

const lineupStandard = (h: ReviewSubject): RoleStandard | null => hitterStandard(h.position);
const review = (subjects: ReviewSubject[], pitchers = false) => reviewGroup(subjects, { pitcher: pitchers, role: pitchers ? 'starting pitcher' : 'lineup regular', standard: pitchers ? () => starterStandard() : lineupStandard });

describe('a finding belongs to the man and his job, not to who else is in the group', () => {
  const group = [subject(1, hitter(7, 15, 50)), subject(2, hitter(6, 60, 60)), subject(3, hitter(3, 70, 50)), subject(4, hitter(4, 55, 55))];

  it('adding a superstar to the group changes nobody else\'s finding or strength', () => {
    const before = review(group);
    const after = review([...group, subject(9, hitter(9, 99, 99))]);
    for (const b of before) {
      const a = after.find((x) => x.playerId === b.playerId)!;
      expect(a.kind).toBe(b.kind);
      expect(a.strength).toBe(b.strength);
      expect(a.estimate.value).toBe(b.estimate.value);
    }
  });

  it('adding a terrible player to the group does not make anyone else look better', () => {
    const before = review(group);
    const after = review([...group, subject(9, hitter(10, 1, null))]);
    for (const b of before) expect(after.find((x) => x.playerId === b.playerId)!.strength).toBe(b.strength);
  });

  it('the order the group is listed in changes nothing', () => {
    const forward = review(group);
    const reversed = review([...group].reverse());
    for (const f of forward) {
      const r = reversed.find((x) => x.playerId === f.playerId)!;
      expect(r.kind).toBe(f.kind);
      expect(r.strength).toBe(f.strength);
      expect(r.estimate).toEqual(f.estimate);
    }
  });

  it('is deterministic: the same evidence gives the same finding, byte for byte', () => {
    expect(JSON.stringify(review(group))).toBe(JSON.stringify(review(group)));
  });
});

describe('a better player is never a bigger concern', () => {
  it('for every role, improving both lenses never makes the finding stronger', () => {
    const order = { none: 0, watch: 1, moderate: 2, strong: 3 } as const;
    for (const pos of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      let last = 4;
      for (const bat of [1, 10, 20, 30, 45, 60, 80]) {
        const r = review([subject(1, hitter(pos, bat, pos === 10 ? null : 50))])[0];
        expect(order[r.strength]).toBeLessThanOrEqual(last);
        last = order[r.strength];
      }
    }
    let last = 4;
    for (const pct of [1, 10, 20, 30, 45, 60, 80]) {
      const r = review([subject(1, pitcher(pct))], true)[0];
      expect(order[r.strength]).toBeLessThanOrEqual(last);
      last = order[r.strength];
    }
  });

  it('a holder who is unusually weak for a role is a concern at that estimate however old he is (age is a stated risk, not a lens)', () => {
    for (const age of [21, 28, 38]) expect(review([subject(1, hitter(10, 5, null), age)])[0].strength).toBe('strong');
  });
});

describe('unknown is never better than known', () => {
  const incumbent = subject(1, hitter(6, 50, 50));

  it('replacing a candidate\'s evidence with "unknown" never makes the comparison firmer', () => {
    const rank = { thin: 0, limited: 1, adequate: 2 } as const;
    const known = compareReplacement(subject(2, hitter(6, 80, 80)), incumbent, false);
    const noGlove = compareReplacement(subject(2, hitter(6, 80, null)), incumbent, false);
    const partial = compareReplacement(subject(2, { ...hitter(6, 80, 80), ratingsEvidence: 'partial' }), incumbent, false);
    const noResults = compareReplacement(subject(2, { ...hitter(6, 80, 80), skillsPct: null, reliability: 0 }), incumbent, false);
    for (const c of [noGlove, partial, noResults]) expect(rank[c.certainty]).toBeLessThanOrEqual(rank[known.certainty]);
  });

  it('a candidate with no evidence at all cannot be judged, never assumed average or bad', () => {
    const nothing = compareReplacement(subject(2, { ...hitter(6, 0, null), ratingsPct: null, skillsPct: null, reliability: 0 }), incumbent, false);
    expect(nothing.verdict).toBe('cannot_judge');
    expect(nothing.delta).toBeNull();
  });
});

describe('aging only ever gets worse', () => {
  it('a hitter\'s expected annual change never improves with age, and a pitcher\'s never falls', () => {
    let lastHitter = Infinity;
    let lastPitcher = -Infinity;
    for (let age = 20; age <= 42; age += 1) {
      const h = expectedAnnualChange(age, false);
      const p = expectedAnnualChange(age, true);
      expect(h).toBeLessThanOrEqual(lastHitter);
      expect(p).toBeGreaterThanOrEqual(lastPitcher);
      lastHitter = h;
      lastPitcher = p;
    }
  });
});

describe('the standards are ordered the way the jobs are', () => {
  it('a line for a closer sits above the line for a middle reliever, and a long man\'s below both', () => {
    expect(relieverStandard('closer').floor).toBeGreaterThan(relieverStandard('middle').floor);
    expect(relieverStandard('middle').floor).toBeGreaterThan(relieverStandard('long').floor);
  });

  it('a deep floor is always below the floor, which is below typical, for every role', () => {
    const all = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => hitterStandard(p) as RoleStandard).concat([starterStandard(), ...(['closer', 'high_leverage', 'middle', 'low_leverage', 'long', 'unknown'] as const).map(relieverStandard)]);
    for (const s of all) {
      expect(s.deepFloor).toBeLessThan(s.floor);
      expect(s.floor).toBeLessThan(s.typical);
    }
  });

  it('the positions that are bat-first have the higher typical lines: first base and DH above shortstop and second base', () => {
    expect((hitterStandard(3) as RoleStandard).typical).toBeGreaterThan((hitterStandard(6) as RoleStandard).typical);
    expect((hitterStandard(10) as RoleStandard).typical).toBeGreaterThan((hitterStandard(4) as RoleStandard).typical);
  });
});
