import { describe, expect, it } from 'vitest';
import { explainFlag, NEVER_CHANGED } from '../server/mlbExplain';
import { reviewClub, reviewNeeds, type ReviewPorts } from '../server/mlbReview';
import { reviewBench, coverQuality, type CoverRead } from '../server/benchReview';
import { readContext } from '../server/staffPreference';
import type { LensEvidence } from '../server/roleReview';
import { CLUBS, ev, LENS, candidate, replacePacket } from './mlbGolden';
import { healthy26, viewOf } from './mlbFixtures';

/*
 * EXPLAINABILITY: the structured output answers the questions a scouting director would be asked, without reconstructing logic from prose.
 *
 *   why was this flagged            → why.rule, why.text, the numbers and the standard
 *   what evidence moved it          → parts, each with its value, weight and basis
 *   what would a neutral club hear  → neutralSeverity (and the recommendation's neutralStance)
 *   what did the context change     → context.changed, each a named lean
 *   what did it not change          → context.notChanged
 *   what would change the answer    → wouldChange
 *   what is not known               → unknown
 */

// a lineup club: one weak left fielder among regulars, one moderate starter
const hitters = healthy26().filter((s) => s.position !== 1);
const regularIds = new Set<number>();
for (const pos of [2, 3, 4, 5, 6, 7, 8, 9]) {
  const first = hitters.find((h) => h.position === pos && !regularIds.has(h.id));
  if (first) regularIds.add(first.id);
}
const LF = [...regularIds][5];
const hev = (bat: number, glove: number | null, position: number, over: Partial<LensEvidence> = {}): LensEvidence => ({
  position, ratingsPct: bat, ratingsEvidence: 'complete', skillsPct: bat, runsPct: null, sample: 500, sampleUnit: 'PA', reliability: 0.7, currentSample: 150,
  defense: { stabilization: 1000, pct: glove, grade: glove === null ? null : 55, visible: glove !== null }, usage: [], ...over,
});
const usage = (id: number) => {
  const s = hitters.find((h) => h.id === id)!;
  const regular = regularIds.has(id);
  return { bats: 'R' as const, gs: regular ? 38 : 4, pa: regular ? 160 : 20, fielding: [{ position: s.position, gs: regular ? 38 : 4, ip: regular ? 330 : 36 }] };
};
const pitchers: Record<number, LensEvidence> = { ...LENS, 104: ev(30, 29, 29) }; // a moderate case: unusually weak for a rotation, not far below it
const ports = (org = null as ReviewPorts['organization']): ReviewPorts => ({
  holderEvidence: (ids, role) => new Map(ids.map((id) => [id, role.kind === 'starting_pitcher' || role.kind === 'relief_pitcher' ? pitchers[id] : id === LF ? hev(15, 50, role.position) : hev(70, 60, role.position)] as const).filter(([, e]) => e)),
  hitterUsage: (ids) => new Map(ids.map((id) => [id, usage(id)] as const)),
  teamGames: () => 40,
  organization: org,
});
const view = viewOf(healthy26());

describe('a strong regular: the whole trace', () => {
  const need = reviewNeeds(view, reviewClub(view, ports())).find((n) => n.subject?.playerId === LF)!;
  const x = need.explanation!;

  it('says why: the rule, the numbers and the standard for his job', () => {
    expect(need.review?.strength).toBe('strong');
    expect(x.why.rule).toBe('below_deep_floor');
    expect(x.why.standard).toMatchObject({ label: 'regular left fielders' });
    expect(x.why.margin as number).toBeLessThan(0);
    expect(x.why.text).toMatch(/well below what regular left fielders takes|well below what regular left fielders take/);
  });

  it('says what the estimate is made of, and the weights add to one', () => {
    expect(x.parts.map((p) => p.label)).toEqual(['Bat', 'Glove', 'Running']);
    expect(x.parts.reduce((n, p) => n + (p.weight ?? 0), 0)).toBeCloseTo(1, 6);
    expect(x.parts[0].basis).toMatch(/results|tools/);
  });

  it('says what a club with no philosophy would have been told, what this club\'s context changed, and what it did not', () => {
    expect(['elevated', 'watch']).toContain(x.neutralSeverity);
    expect(x.context.notChanged).toEqual(NEVER_CHANGED);
    expect(x.context.notChanged.length).toBeGreaterThanOrEqual(5);
    expect(x.wouldChange.length).toBeGreaterThan(0);
  });
});

describe('a moderate concern and the context that shades it', () => {
  const groups = (org: ReviewPorts['organization']) => reviewNeeds(view, reviewClub(view, ports(org)), readContext(org));
  const moderate = (org: ReviewPorts['organization']) => groups(org).find((n) => n.subject?.playerId === 104)!;

  it('is a moderate case whatever the club, with the same reason for it', () => {
    for (const name of Object.keys(CLUBS)) {
      const n = moderate(CLUBS[name]);
      expect(n.review?.strength, name).toBe('moderate');
      expect(n.explanation?.why.rule, name).toBe('below_role_floor');
      expect(n.explanation?.why.text, name).toBe(moderate(null).explanation?.why.text);
    }
  });

  it('a club pushing to win now has it raised, says so as a named lean, and the neutral urgency is still stated', () => {
    const n = moderate(CLUBS.contending);
    expect(n.severity).toBe('elevated');
    expect(n.explanation?.neutralSeverity).toBe('watch');
    expect(n.explanation?.context.changed.some((r) => r.effect === 'raises' && r.dimension === 'competitiveWindow')).toBe(true);
    expect(n.review?.strength).toBe(moderate(null).review?.strength);
  });

  it('a club with no philosophy has nothing changed', () => {
    const n = moderate(null);
    expect(n.explanation?.context.changed).toEqual([]);
    expect(n.severity).toBe(n.explanation?.neutralSeverity);
  });
});

describe('a pitcher, and evidence that is incomplete', () => {
  it('a pitcher\'s estimate is made of tools and results, weights adding to one', () => {
    const rotation = reviewClub(view, ports()).find((g) => g.kind === 'starting_pitcher')!;
    const h = rotation.holders.find((x) => x.playerId === 104)!;
    const x = explainFlag(h, null);
    expect(x.parts.map((p) => p.label)).toEqual(['Tools', 'Results']);
    expect(x.parts.reduce((n, p) => n + (p.weight ?? 0), 0)).toBeCloseTo(1, 6);
  });

  it('a hitter with an unseen glove and thin results says what is not known, instead of leaving it out', () => {
    const p = ports();
    const thin: ReviewPorts = { ...p, holderEvidence: (ids, role) => new Map(ids.map((id) => [id, hev(20, null, role.position, { ratingsEvidence: 'partial', reliability: 0.2, sample: 40 })] as const)) };
    const lineup = reviewClub(view, thin).find((g) => g.role === 'lineup regular')!;
    const x = explainFlag(lineup.holders.find((h) => h.position === 6)!, null);
    expect(x.unknown.join(' ')).toMatch(/incomplete/);
    expect(x.unknown.join(' ')).toMatch(/glove/);
    expect(x.unknown.join(' ')).toMatch(/trusted/);
  });

  it('a holder with no concern still has an explanation: why he is not one', () => {
    const lineup = reviewClub(view, ports()).find((g) => g.role === 'lineup regular')!;
    const fine = lineup.holders.find((h) => h.strength === 'none')!;
    const x = explainFlag(fine, null);
    expect(x.why.rule).toBe('none');
    expect(x.why.text).toMatch(/not below the line/);
  });
});

describe('a bench and an unavailable candidate', () => {
  const read = (position: number, pct: number): CoverRead => ({ position, grade: 40, pct, quality: coverQuality(pct) });
  it('a bench gap says which function is missing, kind of gap and who could nearly fill it', () => {
    const b = reviewBench([{ playerId: 1, name: 'Infielder', bats: 'R', pa: 20, covers: [4, 8], coverReads: [read(4, 60), read(8, 6)], batValue: 40, listed: 4 }]);
    const gap = b.gaps.find((g) => g.key === 'center_field')!;
    expect(gap.kind).toBe('emergency_only');
    const fn = b.functions.find((f) => f.key === 'center_field')!;
    expect(fn.strength).toBe('thin');
    expect(fn.by[0]).toMatchObject({ name: 'Infielder', quality: 'emergency' });
    expect(fn.by[0].note).toMatch(/percentile of those listed there/);
  });

  it('an unavailable candidate states, as data, that he is unavailable, why and for how long', () => {
    const p = replacePacket({ organization: null, room: true, arms: [{ id: 502, name: 'Hurt', position: 1, role: 11, level: 2, forty: true, active: false, il: true, daysLeft: 40 }] });
    const c = candidate(p, 502);
    expect(c.group).toBe('unavailable');
    expect(c.availability).toMatchObject({ status: 'unavailable', label: 'IL', daysLeft: 40 });
  });
});
