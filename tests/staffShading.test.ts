import { describe, expect, it } from 'vitest';
import { buildResponsePacket, type ResponsePacket } from '../server/mlbResponses';
import { reviewNeedFor } from '../server/mlbReview';
import type { LensEvidence } from '../server/roleReview';
import type { OrganizationContext } from '../server/staffPreference';
import { fakePorts, healthy26, mkState, viewOf, type Spec } from './mlbFixtures';

/*
 * The organization's philosophy and where its season stands shade the ORDER and the WORDING of what is already valid
 * (D-036). They never change a comparison, a right or a development finding, and every lean is named.
 */

const ev = (ratingsPct: number | null, skillsPct: number | null, runsPct: number | null, reliability = 0.75): LensEvidence => ({
  ratingsPct, ratingsEvidence: 'complete', skillsPct, runsPct, sample: 900, sampleUnit: 'BF', reliability, currentSample: 180, usage: [],
});
// SP5 (104) is a MODERATE case: weakest, well under the group's median, but not far enough below the pack to be strong.
const lens: Record<number, LensEvidence> = {
  100: ev(60, 68, 60), 101: ev(55, 73, 77), 102: ev(50, 58, 36), 103: ev(47, 60, 40), 104: ev(42, 40, 41),
  105: ev(60, 70, 66), 106: ev(55, 60, 55), 107: ev(52, 55, 50), 108: ev(50, 55, 52), 109: ev(48, 50, 50), 110: ev(45, 48, 44), 111: ev(40, 42, 42), 112: ev(30, 20, 22),
  500: ev(64, 70, 68, 0.6),   // a clear upgrade, veteran
  501: ev(64, 70, 68, 0.6),   // the same, young
};
const farm: Spec[] = [
  { id: 500, name: 'Reno Veteran', position: 1, role: 11, level: 2, forty: true, active: false },
  { id: 501, name: 'Reno Prospect', position: 1, role: 11, level: 2, forty: true, active: false },
];
const AGE: Record<number, number> = { 104: 30, 500: 36, 501: 24 };

const posture = (odds: number) => ({ posture: 'hold' as const, odds, gamesLeft: 100, deadlinePassed: false, headline: `${Math.round(odds * 100)}% to reach the postseason.` });
const club = (dimensions: OrganizationContext['dimensions'], odds: number | null): OrganizationContext => ({ dimensions, posture: odds === null ? null : posture(odds) });

function run(organization: OrganizationContext | null): ResponsePacket {
  const specs = [...healthy26(), ...farm].map((s) => (AGE[s.id] ? { ...s, age: AGE[s.id] } : s));
  const view = viewOf(specs);
  const base = fakePorts({
    states: specs.map(mkState), assignments: { 500: 'optioned', 501: 'optioned' }, development: { 500: {}, 501: {} },
    roleFit: (id) => ({ compositePercentile: lens[id]?.ratingsPct ?? null, weakestCorePercentile: 40 }),
    holderEvidence: (id) => lens[id],
  });
  const ports = { ...base, organization };
  const need = reviewNeedFor(view, 104, ports)!;
  expect(need).toBeTruthy();
  return buildResponsePacket(need, view, ports);
}
const cand = (p: ResponsePacket, id: number) => p.groups.flatMap((g) => g.candidates).find((c) => c.playerId === id)!;

describe('the same facts, told to different clubs', () => {
  const neutral = run(null);
  const contender = run(club({ competitiveWindow: 85 }, 0.8));
  const builder = run(club({ competitiveWindow: 15 }, 0.05));

  it('the case against the holder is a moderate one', () => {
    expect(neutral.need.review?.strength).toBe('moderate');
  });

  it('a club with no philosophy hears "worth pursuing"; a contender in the race is told to act; a club that is building is told to watch', () => {
    expect(neutral.report?.recommendation?.stance).toBe('explore');
    expect(contender.report?.recommendation?.stance).toBe('act');
    expect(builder.report?.recommendation?.stance).toBe('monitor');
  });

  it('says what a club with no philosophy would have heard, and why the stance moved', () => {
    const r = contender.report!.recommendation!;
    expect(r.neutralStance).toBe('explore');
    expect(r.shading?.map((s) => s.dimension)).toContain('competitiveWindow');
    expect(r.shading?.[0].text).toMatch(/act(ing)? now/);
    expect(builder.report!.recommendation!.neutralStance).toBe('explore');
    // and a neutral club has no shading to show
    expect(neutral.report!.recommendation!.shading ?? []).toEqual([]);
    expect(neutral.report!.recommendation!.neutralStance ?? null).toBeNull();
  });

  it('the read, the comparison and the rights are identical for every club: philosophy never changes a fact', () => {
    const pick = (p: ResponsePacket) => p.groups.flatMap((g) => g.candidates).map((c) => ({ id: c.playerId, group: c.group, comparison: c.comparison, path: c.path.status, rights: c.path.steps.map((s) => s.status) }));
    expect(pick(contender)).toEqual(pick(neutral));
    expect(pick(builder)).toEqual(pick(neutral));
    expect(contender.need.review?.estimate).toEqual(neutral.need.review?.estimate);
    expect(contender.report?.read.verdict).toBe(neutral.report?.read.verdict);
  });

  it('a contender in the race sees the flag as elevated, and the packet carries how the club was read', () => {
    expect(contender.need.severity).toBe('elevated');
    expect(neutral.need.severity).toBe('watch');
    expect(contender.need.shading?.[0].dimension).toBe('competitiveWindow');
    expect(contender.context).toMatchObject({ urgency: 'high', window: { label: 'contending' } });
    expect(neutral.context ?? null).toBeNull();
  });
});

describe('choosing between equivalent replacements', () => {
  it('a club that discounts aging leads with the younger arm, and names the reason', () => {
    const p = run(club({ competitiveWindow: 50, ageCurveSensitivity: 90 }, 0.5));
    expect(p.report?.recommendation?.headline).toMatch(/Reno Prospect/);
    expect(cand(p, 501).preference?.score).toBe(1);
    expect(cand(p, 500).preference?.score).toBe(-1);
    expect(cand(p, 501).preference?.reasons[0].text).toMatch(/6 years younger/);
  });

  it('a neutral club is indifferent: no preference is recorded and the order is the stable one', () => {
    const p = run(null);
    expect(cand(p, 501).preference ?? null).toBeNull();
    expect(cand(p, 500).preference ?? null).toBeNull();
  });

  it('a club that is building will not be handed an "act" on an older replacement: the age holds it to "worth pursuing"', () => {
    // make the strong case: the older man is the only clear upgrade
    const specs = [...healthy26(), farm[0]].map((s) => (AGE[s.id] ? { ...s, age: AGE[s.id] } : s));
    const view = viewOf(specs);
    const strongLens: Record<number, LensEvidence> = { ...lens, 104: ev(35, 25, 26) };
    const base = fakePorts({
      states: specs.map(mkState), assignments: { 500: 'optioned' }, development: { 500: {} },
      roleFit: (id) => ({ compositePercentile: strongLens[id]?.ratingsPct ?? null, weakestCorePercentile: 40 }),
      holderEvidence: (id) => strongLens[id],
    });
    const stanceFor = (organization: OrganizationContext | null) => {
      const ports = { ...base, organization };
      return buildResponsePacket(reviewNeedFor(view, 104, ports)!, view, ports).report!.recommendation!;
    };
    expect(stanceFor(null).stance).toBe('act');
    const building = stanceFor(club({ competitiveWindow: 15 }, 0.5));
    expect(building.stance).toBe('explore');
    expect(building.toSettle.join(' ')).toMatch(/6 years older/);
    expect(building.neutralStance).toBe('act');
  });
});
