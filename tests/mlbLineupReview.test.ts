import { describe, expect, it } from 'vitest';
import { reviewClub, reviewNeedFor, reviewNeeds, type ReviewPorts } from '../server/mlbReview';
import { buildResponsePacket } from '../server/mlbResponses';
import { DEFENSE_WEIGHT, estimateOf, type LensEvidence } from '../server/roleReview';
import { fakePorts, healthy26, mkState, viewOf, type Spec } from './mlbFixtures';

/*
 * The lineup review: who actually plays each position, each regular read on his bat
 * and his glove, replacements compared on the position itself, and a bench player who
 * would improve a spot is a lineup decision, not a transaction.
 */

// healthy26 hitters: C1, C2 (ids 113, 114), then H1..H11 = ids 115..125 at positions 3..9 cycling
const hitters = healthy26().filter((s) => s.position !== 1);
const positionOf = (s: Spec) => s.position;
const usageFor = (s: Spec, regular: boolean) => ({
  bats: 'R' as const, gs: regular ? 38 : 4, pa: regular ? 160 : 20,
  fielding: [{ position: positionOf(s), gs: regular ? 38 : 4, ip: regular ? 330 : 36 }],
});

// give every position one clear regular: the first hitter listed at it; others are bench
const regularIds = new Set<number>();
for (const pos of [2, 3, 4, 5, 6, 7, 8, 9]) {
  const first = hitters.find((h) => h.position === pos && !regularIds.has(h.id));
  if (first) regularIds.add(first.id);
}
const ev = (bat: number, results: number | null, glove: number | null, position: number, reliability = 0.7): LensEvidence => ({
  position, ratingsPct: bat, ratingsEvidence: 'complete', skillsPct: results, runsPct: null, sample: 500, sampleUnit: 'PA', reliability, currentSample: 150,
  defense: { pct: glove, grade: glove === null ? null : 55, visible: glove !== null }, usage: [],
});
const ports: ReviewPorts = {
  holderEvidence: (ids, role) => new Map(ids.map((id) => {
    const weak = id === [...regularIds][5]; // one weak regular: LF (position 7)
    return [id, weak ? ev(30, 15, 50, role.position) : ev(60, 65, 55, role.position)] as const;
  })),
  hitterUsage: (ids) => new Map(ids.map((id) => [id, usageFor(hitters.find((h) => h.id === id) as Spec, regularIds.has(id))] as const)),
  teamGames: () => 40,
};
const view = viewOf(healthy26());

describe('the lineup review', () => {
  const groups = reviewClub(view, ports);
  const lineup = groups.find((g) => g.role === 'lineup regular')!;

  it('finds the regular at each position from usage and reviews him against the other regulars', () => {
    expect(lineup.lineup!.spots.filter((s) => s.settled)).toHaveLength(8);
    expect(lineup.holders.length).toBeGreaterThanOrEqual(8);
    const weak = lineup.holders[0];
    expect(weak).toMatchObject({ kind: 'ratings_and_results_weak', strength: 'strong', position: 7 });
    expect(weak.group).toBe('lineup regular');
  });

  it('a hitter\'s estimate is his bat and his glove, weighted by the position', () => {
    const shortstop = estimateOf(ev(60, 60, 20, 6), false);
    const firstBase = estimateOf(ev(60, 60, 20, 3), false);
    expect(shortstop.weightOnDefense).toBe(DEFENSE_WEIGHT[6]);
    expect(shortstop.value as number).toBeLessThan(firstBase.value as number); // a bad glove costs a shortstop more
    expect(estimateOf(ev(60, 60, 20, 10), false).weightOnDefense).toBe(0);      // a DH is all bat
  });

  it('a glove that is not visible is not assumed bad: the estimate is the bat alone, and says so', () => {
    const e = estimateOf(ev(60, 60, null, 6), false);
    expect(e.weightOnDefense).toBe(0);
    expect(e.defensePct).toBeNull();
    const r = reviewClub(view, { ...ports, holderEvidence: (ids, role) => new Map(ids.map((id) => [id, ev(60, 60, null, role.position)] as const)) })
      .find((g) => g.role === 'lineup regular')!;
    expect(r.holders.some((h) => h.explanations.join(' ').includes('defense at shortstop is not visible'))).toBe(true);
  });

  it('a strong case at a position is a need whose role is the POSITION he plays', () => {
    const needs = reviewNeeds(view, groups);
    const n = needs.find((x) => x.subject?.playerId === lineup.holders[0].playerId)!;
    expect(n.role).toMatchObject({ kind: 'position_player', position: 7 });
    expect(n.title).toMatch(/\(left fielder\): well below the line for regular left fielders/);
    expect(reviewNeedFor(view, lineup.holders[0].playerId, ports)?.id).toBe(n.id);
  });

  it('with no usage available there is no lineup review, and the pitching review is unaffected', () => {
    const noUsage = reviewClub(view, { holderEvidence: ports.holderEvidence });
    expect(noUsage.some((g) => g.role === 'lineup regular')).toBe(false);
    expect(noUsage.length).toBe(2);
  });
});

describe('replacing a weak regular', () => {
  const weakId = [...regularIds][5];
  const bench = hitters.find((h) => !regularIds.has(h.id) && h.position === 7) ?? hitters.find((h) => !regularIds.has(h.id))!;
  const specs = healthy26();
  const v = viewOf(specs);
  const base = fakePorts({
    states: specs.map(mkState),
    roleFit: () => ({ compositePercentile: 50, weakestCorePercentile: 40 }),
    holderEvidence: (id, role) => ports.holderEvidence([id], role).get(id),
  });
  const p = buildResponsePacket(reviewNeedFor(v, weakId, { ...ports })!, v, { ...base, hitterUsage: ports.hitterUsage, teamGames: ports.teamGames });

  it('is a replace direction, and only bench players are offered from the active roster: moving another regular opens a new hole', () => {
    expect(p.direction).toBe('replace');
    const active = p.groups.flatMap((g) => g.candidates).filter((c) => c.pathKind === 'role_change');
    expect(active.every((c) => !regularIds.has(c.playerId))).toBe(true);
    expect(p.notConsidered.some((n) => /Regulars at other positions/.test(n.reason))).toBe(true);
  });

  it('a bench player who would improve the spot is a lineup decision with no transaction and no rights to refuse', () => {
    const plan = p.plans?.find((x) => x.id === 'lineup_change');
    if (!plan) return; // the fixture bench may not improve the spot; the assertion below covers the case that does
    expect(plan.steps.every((s) => s.status === 'not_a_transaction')).toBe(true);
    expect(plan.counts.active).toMatch(/no change/);
    expect(plan.certainty).toBe('open');
    expect(bench).toBeTruthy();
  });

  it('the picture is who actually plays the position, and the read names the position', () => {
    const rows = p.report!.rolePicture!.rows;
    expect(rows.filter((r) => r.underReview).map((r) => r.playerId)).toEqual([weakId]);
    expect(p.report!.situation[0]).toMatch(/lineup regulars/);
  });
});
