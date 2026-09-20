import { describe, expect, it } from 'vitest';
import { reviewClub, reviewNeedFor, reviewNeeds, type ReviewPorts } from '../server/mlbReview';
import type { LensEvidence } from '../server/roleReview';
import { healthy26, viewOf } from './mlbFixtures';

/*
 * The roster review: the club's pitching groups read unprompted. A finding is a flag
 * for attention; only a real case (strong or moderate) is also a need.
 */

// SP1..SP5 = 100..104, RP1..RP8 = 105..112
const ev = (ratingsPct: number | null, skillsPct: number | null, runsPct: number | null, reliability = 0.75): LensEvidence => ({
  ratingsPct, ratingsEvidence: 'complete', skillsPct, runsPct, sample: 900, sampleUnit: 'BF', reliability, currentSample: 180, usage: [],
});
const table: Record<number, LensEvidence> = {
  100: ev(60, 68, 60), 101: ev(55, 73, 77), 102: ev(50, 58, 36), 103: ev(47, 60, 40),
  104: ev(35, 25, 26),                                  // weak on both lenses: strong case
  105: ev(60, 70, 66), 106: ev(55, 60, 55), 107: ev(52, 55, 50), 108: ev(50, 55, 52), 109: ev(48, 50, 50),
  110: ev(45, 48, 44), 111: ev(40, 42, 42),
  112: ev(30, 20, 22),                                  // weak on both lenses in the bullpen
};
const ports: ReviewPorts = { holderEvidence: (ids) => new Map(ids.filter((id) => table[id]).map((id) => [id, table[id]] as const)) };
const view = viewOf(healthy26());

describe('the club review', () => {
  const groups = reviewClub(view, ports);

  it('reviews the rotation and the bullpen, each holder against his own group, most concerning first', () => {
    expect(groups.map((g) => g.role)).toEqual(['starting pitcher', 'relief pitcher']);
    expect(groups[0].holders).toHaveLength(5);
    expect(groups[1].holders).toHaveLength(8);
    expect(groups[0].holders[0]).toMatchObject({ playerId: 104, strength: 'strong', kind: 'ratings_and_results_weak' });
    expect(groups[1].holders[0]).toMatchObject({ playerId: 112, strength: 'strong' });
  });

  it('a holder with no evidence is counted as not reviewed, never assumed weak', () => {
    const partial = reviewClub(view, { holderEvidence: (ids) => new Map(ids.filter((id) => id !== 100 && table[id]).map((id) => [id, table[id]] as const)) });
    expect(partial[0].notReviewed).toBe(1);
    expect(partial[0].holders.some((h) => h.playerId === 100)).toBe(false);
  });

  it('an unavailable holder is not part of the group', () => {
    const v = viewOf([...healthy26().map((s) => (s.id === 104 ? { ...s, il: true, active: false, daysLeft: 20 } : s))]);
    const g = reviewClub(v, ports);
    expect(g[0].holders.some((h) => h.playerId === 104)).toBe(false);
  });
});

describe('needs from the review', () => {
  const groups = reviewClub(view, ports);
  const needs = reviewNeeds(view, groups);

  it('only a real case is a need: a strong or moderate finding, never a watch item', () => {
    expect(needs.map((n) => n.subject?.playerId).sort()).toEqual([104, 112]);
    for (const n of needs) {
      expect(n).toMatchObject({ kind: 'role_holder_review', origin: 'observed', severity: 'elevated' });
      expect(n.id).toBe(`mlb:role_holder_review:${n.subject?.playerId}`);
      expect(n.review?.strength).toBe('strong');
    }
  });

  it('says it is a flag for attention, not a recommendation, and does not assume how long a replacement would be needed', () => {
    const n = needs.find((x) => x.subject?.playerId === 104)!;
    expect(n.unknowns.join(' ')).toMatch(/flag for your attention, not a recommendation to move him/);
    expect(n.horizon.kind).toBe('unknown');
    expect(n.title).toMatch(/SP5: the weakest starting pitcher on the club/);
    expect(n.facts.map((f) => f.label)).toEqual(expect.arrayContaining(['Working estimate', 'Tools', 'Results']));
  });

  it('resolves a need id back to the current finding, and to nothing once it no longer stands', () => {
    expect(reviewNeedFor(view, 104, ports)?.subject?.name).toBe('SP5');
    const fixed = { holderEvidence: (ids: number[]) => new Map(ids.map((id) => [id, id === 104 ? ev(58, 60, 60) : table[id]] as const).filter(([, e]) => e)) };
    expect(reviewNeedFor(view, 104, fixed)).toBeNull();
  });
});
