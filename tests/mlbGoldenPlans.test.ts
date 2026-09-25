import { describe, expect, it } from 'vitest';
import { whatIfNeed } from '../server/mlbNeeds';
import { reviewNeedFor } from '../server/mlbReview';
import { buildResponsePacket, type ResponsePacket } from '../server/mlbResponses';
import type { Plan } from '../server/mlbPlans';
import type { LensEvidence } from '../server/roleReview';
import { fakePorts, healthy26, mkState, viewOf, type Spec } from './mlbFixtures';

/*
 * GOLDEN CASES: plans. A plan is one baseball move followed through. Two names for the same move are one plan; a move that only
 * shifts the hole says where the hole went; every plan states what it does to the rest of the roster.
 */

const ev = (ratingsPct: number | null, skillsPct: number | null, runsPct: number | null, reliability = 0.75): LensEvidence => ({
  ratingsPct, ratingsEvidence: 'complete', skillsPct, runsPct, sample: 900, sampleUnit: 'BF', toolsWeight: 1, reliability, currentSample: 180, usage: [],
});
const lens: Record<number, LensEvidence> = {
  100: ev(60, 68, 60), 101: ev(55, 73, 77), 102: ev(50, 58, 36), 103: ev(47, 60, 40), 104: ev(20, 14, 15),
  105: ev(60, 70, 66), 106: ev(55, 60, 55), 107: ev(52, 55, 50), 108: ev(50, 55, 52), 109: ev(48, 50, 50), 110: ev(45, 48, 44), 111: ev(40, 42, 42), 112: ev(12, 8, 10),
  500: ev(64, 70, 68, 0.6), 501: ev(58, 60, 60, 0.6),
};
const farm: Spec[] = [
  { id: 500, name: 'Reno One', position: 1, role: 11, level: 2, forty: true, active: false },
  { id: 501, name: 'Reno Two', position: 1, role: 11, level: 2, forty: true, active: false },
];

function packet(mutate: (s: Spec) => Spec = (s) => s, keep: (s: Spec) => boolean = () => true): ResponsePacket {
  const specs = [...healthy26().filter(keep).map(mutate), ...farm];
  const view = viewOf(specs);
  const base = fakePorts({
    states: specs.map(mkState), assignments: { 500: 'optioned', 501: 'optioned' }, development: { 500: {}, 501: {} },
    roleFit: (id) => ({ compositePercentile: lens[id]?.ratingsPct ?? null, weakestCorePercentile: 40 }), holderEvidence: (id) => lens[id],
  });
  return buildResponsePacket(reviewNeedFor(view, 104, base)!, view, base);
}

/** What a plan does, as data: who ends up where. Two plans with the same signature are the same baseball move. */
const signature = (p: Plan) => p.steps.map((s) => s.text.replace(/\s+/g, ' ').trim()).sort().join(' | ');

describe('GOLDEN plans: distinct alternatives', () => {
  it('no two plans in a packet are the same baseball move', () => {
    for (const variant of [packet(), packet((s) => (s.id === 104 ? { ...s, mlbYears: 9, used: 2 } : s)), packet((s) => s, (s) => s.id !== 112)]) {
      const sigs = (variant.plans ?? []).map(signature);
      expect(new Set(sigs).size).toBe(sigs.length);
      const ids = (variant.plans ?? []).map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('a plan that opens a spot by sending him down and one that opens it by designating him are different moves, at different costs', () => {
    const veteran = packet();
    const send = veteran.plans?.find((x) => x.id === 'send_down');
    expect(send?.costs.join(' ') ?? '').not.toMatch(/may claim him/);
    const vet = packet((s) => (s.id === 104 ? { ...s, mlbYears: 9, used: 2 } : s));
    const designate = vet.plans?.find((x) => x.id === 'designate');
    expect(designate?.costs.join(' ')).toMatch(/may claim him/);
    expect(vet.plans?.some((x) => x.id === 'send_down')).toBe(false); // he cannot simply be optioned: that plan is not offered as an option
  });
});

describe('GOLDEN plans: consequences are always stated', () => {
  it('every plan states its effect on the roster counts and on each role group it touches', () => {
    for (const plan of packet().plans ?? []) {
      expect(plan.counts.active).toMatch(/\d/);
      expect(plan.counts.fortyMan).toMatch(/\d/);
      expect(plan.groups.length).toBeGreaterThan(0);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.certaintyNote.length).toBeGreaterThan(0);
    }
  });

  it('moving a starter to the bullpen touches both groups, so the hole in the rotation is filled in the same plan, not assumed away', () => {
    const pen = packet().plans?.find((x) => x.id === 'move_to_bullpen')!;
    expect(pen.groups.map((g) => g.label).sort()).toEqual(['relief pitcher', 'starting pitcher']);
    const rotation = pen.groups.find((g) => g.label === 'starting pitcher')!;
    expect(rotation.healthyAfter).toBe(rotation.healthyBefore); // one leaves, one arrives
    expect(pen.steps.map((s) => s.text).join(' ')).toMatch(/Reno/);
  });

  it('a plan that would leave a role below its floor says so', () => {
    // a pen already at its floor of seven relievers: moving the starter to relief and optioning the weakest arm keeps it there; nothing may quietly go below
    const atFloor = packet((s) => s, (s) => s.id !== 112);
    for (const plan of atFloor.plans ?? []) {
      for (const g of plan.groups) {
        if (g.floor !== null && g.healthyAfter < g.floor) expect(plan.problems.join(' ')).toMatch(/floor|below/i);
      }
    }
  });

  it('with nobody to bring in, moving the starter would only open a hole, and there is no plan that pretends otherwise', () => {
    const specs = healthy26();
    const view = viewOf(specs);
    const base = fakePorts({ states: specs.map(mkState), roleFit: () => ({ compositePercentile: 50, weakestCorePercentile: 40 }), holderEvidence: (id) => lens[id] });
    const p = buildResponsePacket(reviewNeedFor(view, 104, base)!, view, base);
    expect((p.plans ?? []).some((x) => x.id === 'move_to_bullpen' && /nobody/i.test(x.summary) === false && x.steps.length === 1)).toBe(false);
  });
});

describe('GOLDEN plans: the rotation shortage', () => {
  it('a shortage in the rotation is filled from outside it: no plan proposes moving a starter to the bullpen for it', () => {
    const specs = [...healthy26().map((s) => (s.id === 100 ? { ...s, il: true, active: false, daysLeft: 30 } : s)), ...farm];
    const view = viewOf(specs);
    const base = fakePorts({ states: specs.map(mkState), assignments: { 500: 'optioned', 501: 'optioned' }, development: { 500: {}, 501: {} }, holderEvidence: (id) => lens[id] });
    const need = whatIfNeed(view, 101)!;
    const p = buildResponsePacket(need, view, base);
    expect((p.plans ?? []).some((x) => x.id === 'move_to_bullpen')).toBe(false);
    expect(['fill', 'replace']).toContain(p.direction);
  });
});

describe('GOLDEN plans: a second move must earn its keep', () => {
  // a weak left fielder; every bench player is as good as the regulars, so starting one of them is the plain fix
  const hitters = healthy26().filter((s) => s.position !== 1);
  const regularIds = new Set<number>();
  for (const pos of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const first = hitters.find((h) => h.position === pos && !regularIds.has(h.id));
    if (first) regularIds.add(first.id);
  }
  const LF = [...regularIds][5];
  const ev2 = (bat: number, glove: number, position: number): LensEvidence => ({
    position, ratingsPct: bat, ratingsEvidence: 'complete', skillsPct: bat, runsPct: null, sample: 500, sampleUnit: 'PA', toolsWeight: 1, reliability: 0.7, currentSample: 150,
    defense: { stabilization: 1000, pct: glove, grade: 55, visible: true }, usage: [],
  });
  const holderEvidence = (ids: number[], role: { position: number }) => new Map(ids.map((id) => [id, id === LF ? ev2(30, 50, role.position) : ev2(60, 55, role.position)] as const));
  const usage = (id: number) => {
    const s = hitters.find((h) => h.id === id) as Spec;
    const regular = regularIds.has(id);
    return { bats: 'R' as const, gs: regular ? 38 : 4, pa: regular ? 160 : 20, fielding: [{ position: s.position, gs: regular ? 38 : 4, ip: regular ? 330 : 36 }] };
  };

  it('a shift that does no better than starting a bench player at the spot is not offered beside it', () => {
    const specs = healthy26();
    const view = viewOf(specs);
    const ports = { holderEvidence: (ids: number[], role: { position: number }) => holderEvidence(ids, role), hitterUsage: (ids: number[]) => new Map(ids.map((id) => [id, usage(id)] as const)), teamGames: () => 40 };
    const base = fakePorts({ states: specs.map(mkState), roleFit: () => ({ compositePercentile: 50, weakestCorePercentile: 40 }), holderEvidence: (id, role) => holderEvidence([id], role).get(id) });
    const p = buildResponsePacket(reviewNeedFor(view, LF, ports as never)!, view, { ...base, hitterUsage: ports.hitterUsage, teamGames: ports.teamGames });
    const plans = p.plans ?? [];
    expect(plans.some((x) => x.id === 'lineup_change')).toBe(true);
    expect(plans.filter((x) => x.id === 'shift')).toEqual([]);
  });
});
