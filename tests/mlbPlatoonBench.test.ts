import { describe, expect, it } from 'vitest';
import { reviewClub, reviewNeedById, reviewNeeds, type ReviewPorts } from '../server/mlbReview';
import { buildResponsePacket, type ResponsePorts } from '../server/mlbResponses';
import type { LensEvidence } from '../server/roleReview';
import type { PlatoonInput } from '../server/platoon';
import type { OrganizationContext } from '../server/staffPreference';
import { fakePorts, healthy26, mkState, viewOf, type Spec } from './mlbFixtures';

/*
 * A regular with a platoon problem, a bench player who complements him, the bench's coverage, and a position shift.
 * The platoon read is ratings-led (D-035); a partner already on the bench is a lineup decision with no transaction.
 */

const hitters = healthy26().filter((s) => s.position !== 1);
const regularIds = new Set<number>();
for (const pos of [2, 3, 4, 5, 6, 7, 8, 9]) {
  const first = hitters.find((h) => h.position === pos && !regularIds.has(h.id));
  if (first) regularIds.add(first.id);
}
const regularAt = (pos: number) => hitters.find((h) => h.position === pos && regularIds.has(h.id))!.id;
const LF = regularAt(7);
const benchIds = hitters.filter((h) => !regularIds.has(h.id)).map((h) => h.id);
const PARTNER = benchIds[0];

const ev = (bat: number, glove: number | null, position: number): LensEvidence => ({
  position, ratingsPct: bat, ratingsEvidence: 'complete', skillsPct: bat, runsPct: null, sample: 500, sampleUnit: 'PA', reliability: 0.7, currentSample: 150,
  defense: { stabilization: 1000, pct: glove, grade: glove === null ? null : 55, visible: glove !== null }, usage: [],
});
const usage = (id: number) => {
  const s = hitters.find((h) => h.id === id) as Spec;
  const regular = regularIds.has(id);
  return { bats: 'L' as const, gs: regular ? 38 : 4, pa: regular ? 160 : 20, fielding: [{ position: s.position, gs: regular ? 38 : 4, ip: regular ? 330 : 36 }] };
};

const NORM = 0.015;
const platoonFor = (id: number): PlatoonInput => {
  // the left fielder: ratings far outside the norm for a left-handed bat (much better against right-handers); the partner is the reverse
  if (id === LF) return { recordStabilization: 300, bats: 'L', vsLeft: [], vsRight: [], leagueEffect: NORM, leagueWoba: 0.32, ratings: { vsLeft: -0.03, vsRight: 0.03, norm: NORM } };
  if (id === PARTNER) return { recordStabilization: 300, bats: 'R', vsLeft: [], vsRight: [], leagueEffect: -0.01, leagueWoba: 0.32, ratings: { vsLeft: 0.03, vsRight: 0.0, norm: -0.01 } };
  return { recordStabilization: 300, bats: 'R', vsLeft: [], vsRight: [], leagueEffect: -0.01, leagueWoba: 0.32, ratings: { vsLeft: 0.0, vsRight: 0.0, norm: 0.0 } };
};

const holderEvidence = (ids: number[], role: { position: number }) => new Map(ids.map((id) => [id, id === LF ? ev(50, 50, role.position) : ev(60, 55, role.position)] as const));
const covers = (all: number[][]) => (ids: number[]) => new Map(ids.map((id, i) => [id, all[i % all.length]] as const));

const reviewPorts = (over: Partial<ReviewPorts> = {}): ReviewPorts => ({
  holderEvidence: (ids, role) => holderEvidence(ids, role), hitterUsage: (ids) => new Map(ids.map((id) => [id, usage(id)] as const)),
  teamGames: () => 40, platoon: (ids) => new Map(ids.map((id) => [id, platoonFor(id)] as const)), ...over,
});
const view = viewOf(healthy26());

describe('a regular with a platoon problem is a need, with its evidence', () => {
  const needs = reviewNeeds(view, reviewClub(view, reviewPorts()));
  const need = needs.find((n) => n.kind === 'platoon_complement')!;

  it('is raised only for the regular whose ratings put him outside the norm for his hand', () => {
    expect(needs.filter((n) => n.kind === 'platoon_complement').map((n) => n.subject?.playerId)).toEqual([LF]);
    expect(need.id).toBe(`mlb:platoon_complement:${LF}`);
    expect(need.role).toMatchObject({ kind: 'position_player', position: 7 });
    expect(need.title).toMatch(/weak against left-handers; a platoon partner could help/);
    expect(need.platoon?.verdict).toBe('problem');
    expect(need.platoon?.basis).toBe('ratings');
    expect(need.unknowns[0]).toMatch(/flag for your attention, not a recommendation to bench him/);
  });

  it('resolves by id', () => {
    expect(reviewNeedById(view, need.id, reviewPorts())?.id).toBe(need.id);
    expect(reviewNeedById(view, 'mlb:platoon_complement:1', reviewPorts())).toBeNull();
  });
});

describe('finding him a partner', () => {
  const specs = healthy26();
  const base = (org: OrganizationContext | null = null): ResponsePorts => ({
    ...fakePorts({ states: specs.map(mkState), roleFit: () => ({ compositePercentile: 50, weakestCorePercentile: 40 }), holderEvidence: (id, role) => holderEvidence([id], role).get(id) }),
    hitterUsage: reviewPorts().hitterUsage, teamGames: () => 40, platoon: (ids) => new Map(ids.map((id) => [id, platoonFor(id)] as const)), organization: org,
  });
  const packetFor = (org: OrganizationContext | null = null) => {
    const ports = base(org);
    const need = reviewNeedById(view, `mlb:platoon_complement:${LF}`, { ...reviewPorts(), organization: org })!;
    return buildResponsePacket(need, view, ports);
  };
  const p = packetFor();

  it('is a complement direction; the partner is on the bench and fits against the weak hand', () => {
    expect(p.direction).toBe('complement');
    const partner = p.groups.flatMap((g) => g.candidates).find((c) => c.playerId === PARTNER)!;
    expect(partner.pathKind).toBe('role_change');
    expect(partner.complement).toMatchObject({ weakSide: 'L' });
    expect(partner.complement?.fit.fits).toBe(true);
    expect(partner.complement?.fit.advantage as number).toBeGreaterThanOrEqual(0.025);
  });

  it('the plan is a platoon: no transaction, the regular keeps the other hand', () => {
    const plan = p.plans?.find((x) => x.id === 'platoon')!;
    expect(plan.title).toMatch(/starts against left-handers/);
    expect(plan.steps.every((s) => s.status === 'not_a_transaction')).toBe(true);
    expect(plan.steps.map((s) => s.text).join(' ')).toMatch(/keeps left field against right-handers/);
    expect(plan.certainty).toBe('open');
    expect(plan.counts.active).toMatch(/no change/);
  });

  it('a bench partner on a problem the ratings support is recommended; a club that is not pressed is told it is worth pursuing', () => {
    expect(p.report?.recommendation).toMatchObject({ stance: 'act' });
    expect(p.report?.recommendation?.because.join(' ')).toMatch(/needs no transaction/);
    const patient = packetFor({ dimensions: { competitiveWindow: 10 }, posture: { posture: 'sell', odds: 0.03, gamesLeft: 100, deadlinePassed: false, headline: 'Sell.' } });
    expect(patient.report?.recommendation?.stance).toBe('explore');
    expect(patient.report?.recommendation?.shading?.length).toBeGreaterThan(0);
  });

  it('the picture shows the regular and each candidate with expected wOBA against the weak hand', () => {
    const rows = p.report!.rolePicture!.rows;
    expect(rows.find((r) => r.playerId === LF)?.complement).toMatchObject({ weakSide: 'L', fits: false });
    const partner = rows.find((r) => r.playerId === PARTNER)!;
    expect(partner.complement?.fits).toBe(true);
    expect(partner.complement?.expected as number).toBeGreaterThan(rows.find((r) => r.playerId === LF)!.complement!.expected as number);
    expect(p.report?.read.text).toMatch(/would clearly complement him against left-handers/);
  });

  it('with nobody who clearly fits (the others share his weakness), the read says so and only monitors', () => {
    const flat = { ...base(), platoon: (ids: number[]) => new Map(ids.map((id) => [id, id === LF ? platoonFor(LF) : { ...platoonFor(LF), bats: 'L' as const }] as const)) };
    const need = reviewNeedById(view, `mlb:platoon_complement:${LF}`, reviewPorts())!;
    const q = buildResponsePacket(need, view, flat);
    expect(q.report?.read.text).toMatch(/Nobody internal is clearly better/);
    expect(q.report?.recommendation?.stance).toBe('monitor');
  });
});

describe('the bench', () => {
  it('names a position nobody on the bench can cover, as a coverage need', () => {
    const groups = reviewClub(view, reviewPorts({ covers: covers([[7]]) }));
    const bench = groups.find((g) => g.bench)!.bench!;
    expect(bench.rows.length).toBe(benchIds.length);
    expect(bench.gaps.map((g) => g.key)).toEqual(['catcher', 'middle_infield', 'center_field']);
    const needs = reviewNeeds(view, groups).filter((n) => n.kind === 'bench_coverage');
    expect(needs.map((n) => n.id)).toEqual(['mlb:bench_coverage:catcher', 'mlb:bench_coverage:middle_infield', 'mlb:bench_coverage:center_field']);
    expect(needs[0].unknowns[0]).toMatch(/coverage question, not a performance one/);
  });

  it('no coverage need when the bench covers every required position, and none without a coverage port', () => {
    const covered = reviewClub(view, reviewPorts({ covers: covers([[2, 4, 6, 8]]) }));
    expect(covered.find((g) => g.bench)!.bench!.gaps).toEqual([]);
    expect(reviewNeeds(view, covered).some((n) => n.kind === 'bench_coverage')).toBe(false);
    expect(reviewClub(view, reviewPorts()).some((g) => g.bench)).toBe(false);
  });

  it('a coverage need resolves to a fill packet for that position, without error', () => {
    const groups = reviewClub(view, reviewPorts({ covers: covers([[7]]) }));
    const need = reviewNeeds(view, groups).find((n) => n.id === 'mlb:bench_coverage:middle_infield')!;
    const ports: ResponsePorts = { ...fakePorts({ states: healthy26().map(mkState) }), hitterUsage: reviewPorts().hitterUsage, teamGames: () => 40 };
    const packet = buildResponsePacket(need, view, ports);
    expect(packet.direction).toBe('fill');
    expect(packet.need.role?.position).toBe(4);
  });
});

describe('a position shift', () => {
  const specs = healthy26();
  // the left fielder is weak; the shortstop is strong everywhere and can play left
  const weakEv = (id: number, role: { position: number }) => (id === LF ? ev(30, 40, role.position) : id === regularAt(6) ? ev(80, 70, role.position) : ev(55, 55, role.position));
  // Nobody on the bench has a visible grade in left, so there is no plain lineup change to make: a shift is only worth proposing when it beats
  // starting a bench player, and here there is none to start. (When there is one, a shift must clear him by the edge: see lineupShifts.test.ts.)
  const ports: ResponsePorts = {
    ...fakePorts({ states: specs.map(mkState), roleFit: () => ({ compositePercentile: 50, weakestCorePercentile: 40 }), holderEvidence: (id, role) => weakEv(id, role) }),
    crossRole: (id, role) => (!regularIds.has(id) && role.position === 7 ? { supported: 'no', evidence: [] } : { supported: 'yes', evidence: ['test'] }),
    hitterUsage: reviewPorts().hitterUsage, teamGames: () => 40,
  };
  const rp = reviewPorts({ holderEvidence: (ids, role) => new Map(ids.map((id) => [id, weakEv(id, role)] as const)) });
  const need = reviewNeeds(view, reviewClub(view, rp)).find((n) => n.kind === 'role_holder_review' && n.subject?.playerId === LF)!;
  const p = buildResponsePacket(need, view, ports);

  it('proposes moving a regular to the weak spot and covering the one he leaves, with both spots shown and no transaction', () => {
    const shift = p.plans?.find((x) => x.id === 'shift');
    expect(shift).toBeTruthy();
    expect(shift!.groups).toHaveLength(2);
    expect(shift!.steps.every((s) => s.status === 'not_a_transaction')).toBe(true);
    expect(shift!.certainty).toBe('open');
    expect(shift!.title).toMatch(/to left field/);
    expect(shift!.groups[0].meanAfter as number).toBeGreaterThan(shift!.groups[0].meanBefore as number);
  });

  it('the recommendation can rest on a shift when nobody is ready to be brought in', () => {
    expect(['act', 'explore']).toContain(p.report?.recommendation?.stance);
    expect(p.plans?.some((x) => x.id === 'shift')).toBe(true);
  });
});
