import { describe, expect, it } from 'vitest';
import { whatIfNeed } from '../server/mlbNeeds';
import { reviewNeedFor } from '../server/mlbReview';
import { buildResponsePacket, type ClearingOption, type ResponseCandidate, type ResponsePacket } from '../server/mlbResponses';
import type { LensEvidence } from '../server/roleReview';
import { fakePorts, healthy26, mkState, viewOf, type PortOptions, type Spec } from './mlbFixtures';

/*
 * GOLDEN CASES: availability and legality. What a GM may be told is possible must be possible, or say plainly that it is not
 * established. MLB Operations composes Player State, Player Rights and Player Development; it invents none of them.
 */

const ev = (ratingsPct: number | null, skillsPct: number | null, runsPct: number | null, reliability = 0.75): LensEvidence => ({
  ratingsPct, ratingsEvidence: 'complete', skillsPct, runsPct, sample: 900, sampleUnit: 'BF', reliability, currentSample: 180, usage: [],
});
// SP5 (104) is far below what a rotation takes; the Reno arms are all clear upgrades on paper
const lens: Record<number, LensEvidence> = {
  100: ev(60, 68, 60), 101: ev(55, 73, 77), 102: ev(50, 58, 36), 103: ev(47, 60, 40), 104: ev(20, 14, 15),
  105: ev(60, 70, 66), 106: ev(55, 60, 55), 107: ev(52, 55, 50), 108: ev(50, 55, 52), 109: ev(48, 50, 50), 110: ev(45, 48, 44), 111: ev(40, 42, 42), 112: ev(12, 8, 10),
  500: ev(64, 70, 68, 0.6), 501: ev(64, 70, 68, 0.6), 502: ev(64, 70, 68, 0.6), 503: ev(64, 70, 68, 0.6),
};
const arm = (id: number, name: string, over: Partial<Spec> = {}): Spec => ({ id, name, position: 1, role: 11, level: 2, forty: true, active: false, ...over });

/** SP5 is under review. `roomOnRoster` leaves 25 of 26 active, so a recall needs no clearing move; without it the roster is full. */
function replace(farm: Spec[], opts: Partial<PortOptions> = {}, leagueOver: Record<string, number | null> = {}, mutate: (s: Spec) => Spec = (s) => s, roomOnRoster = true): ResponsePacket {
  const specs = [...healthy26().filter((s) => !(roomOnRoster && s.id === 125)).map(mutate), ...farm];
  const view = viewOf(specs, leagueOver);
  const base = fakePorts({
    states: specs.map(mkState), leagueOver, assignments: Object.fromEntries(farm.map((f) => [f.id, 'optioned' as const])),
    development: Object.fromEntries(farm.map((f) => [f.id, {}])),
    roleFit: (id) => ({ compositePercentile: lens[id]?.ratingsPct ?? null, weakestCorePercentile: 40 }), holderEvidence: (id) => lens[id], ...opts,
  });
  const need = reviewNeedFor(view, 104, base)!;
  expect(need).toBeTruthy();
  return buildResponsePacket(need, view, base);
}
const cand = (p: ResponsePacket, id: number) => p.groups.flatMap((g) => g.candidates).find((c) => c.playerId === id) as ResponseCandidate;
const allCandidates = (p: ResponsePacket) => p.groups.flatMap((g) => g.candidates);

describe('GOLDEN availability: an injured player is not an available replacement', () => {
  const p = replace([arm(500, 'Healthy'), arm(502, 'Hurt', { il: true, daysLeft: 40 })]);

  it('is never in an "open" group, never the lead of the report, and is named unavailable with the reason', () => {
    const hurt = cand(p, 502);
    expect(hurt.group).toBe('unavailable');
    expect(hurt.availability.status).toBe('unavailable');
    expect(hurt.why.join(' ')).toMatch(/IL|injur|unavailable/);
    expect(p.report?.recommendation?.headline ?? '').not.toMatch(/Hurt/);
    for (const plan of p.plans ?? []) {
      expect(plan.followUp?.chosen?.name).not.toBe('Hurt');
      expect(plan.steps.map((s) => s.text).join(' ')).not.toMatch(/Hurt/);
    }
    expect(cand(p, 500).group).toBe('open');
  });

  it('moving a player to the injured list removes him from the immediately available pool (metamorphic)', () => {
    const before = replace([arm(500, 'A'), arm(502, 'B')]);
    const after = replace([arm(500, 'A'), arm(502, 'B', { il: true, daysLeft: 40 })]);
    expect(cand(before, 502).group).toBe('open');
    expect(cand(after, 502).group).not.toBe('open');
    expect(cand(after, 500).group).toBe('open'); // and nobody else is disturbed
  });
});

describe('GOLDEN legality: a transaction Rights cannot establish is not presented as established', () => {
  it('with the chronology unavailable, a recall is "not established", every plan says so and the staff never says ACT', () => {
    const p = replace([arm(500, 'A')], { evidence: { currentState: 'current', chronology: 'unavailable' } });
    expect(cand(p, 500).path.status).toBe('indeterminate');
    expect(cand(p, 500).group).not.toBe('open');
    expect(p.plans?.every((x) => x.certainty === 'indeterminate')).toBe(true);
    expect(p.report?.recommendation?.stance).not.toBe('act');
  });

  it('removing the required rights evidence changes what is established, never the baseball read of the players', () => {
    const with_ = replace([arm(500, 'A')]);
    const without = replace([arm(500, 'A')], { evidence: { currentState: 'current', chronology: 'unavailable' } });
    expect(cand(with_, 500).comparison).toEqual(cand(without, 500).comparison);
    expect(cand(with_, 500).roleFit).toEqual(cand(without, 500).roleFit);
    expect(cand(with_, 500).path.status).not.toBe(cand(without, 500).path.status);
  });
});

describe('GOLDEN legality: a rehab assignment is not an ordinary option', () => {
  it('a rehabbing player is not offered as an open recall the way an optioned player is', () => {
    const p = replace([arm(500, 'Optioned'), arm(501, 'Rehab')], { assignments: { 500: 'optioned', 501: 'rehab_assignment' } });
    expect(cand(p, 500).group).toBe('open');
    expect(cand(p, 501).group).not.toBe('open');
  });
});

describe('GOLDEN legality: a promotion off the 40-man exposes its prerequisite', () => {
  const FULL_40 = { rules_secondary_roster_limit: 26 }; // 25 active + On40 = 26: full
  it('is viable only through a clearing move, and says which spot has to be cleared first', () => {
    const p = replace([arm(500, 'On40'), arm(501, 'Off40', { forty: false })], {}, FULL_40);
    const off = cand(p, 501);
    expect(off.requiresClearing.fortyMan).toBe(true);
    expect(off.group).toBe('open_requires_clearing');
    expect(off.path.chain.some((l) => l.kind === 'clear_spot' && l.constraint === 'forty_man')).toBe(true);
    // the player already on the 40-man needs no such move
    expect(cand(p, 500).requiresClearing.fortyMan).toBe(false);
  });

  it('removing an active-roster spot creates a roster prerequisite, never a silently deleted candidate', () => {
    // a full 26: bringing anybody up means someone comes off
    const p = replace([arm(500, 'A')], {}, {}, (s) => s, false);
    expect(cand(p, 500)).toBeDefined();
    expect(cand(p, 500).requiresClearing.active).toBe(true);
    expect(cand(p, 500).group).toBe('open_requires_clearing');
    expect(cand(p, 500).path.chain.some((l) => l.kind === 'clear_spot' && l.constraint === 'active_roster')).toBe(true);
  });
});

describe('GOLDEN legality: a DFA is not an ordinary option', () => {
  const optionsOf = (p: ResponsePacket): ClearingOption[] => p.clearing?.constraints.flatMap((k) => k.classes.flatMap((c) => c.options)) ?? [];

  it('a player who can simply be optioned is a routine way to clear the spot', () => {
    const p = replace([arm(500, 'A')], {}, {}, (s) => s, false);
    const options = optionsOf(p);
    expect(options.map((o) => o.transaction)).toEqual(['option']);
    expect(options[0].class).toBe('routine');
  });

  it('a veteran with no option left can only be designated, and that is never classed as routine', () => {
    const p = replace([arm(500, 'A')], {}, {}, (s) => (s.id === 104 ? { ...s, mlbYears: 9, used: 3 } : s), false);
    const options = optionsOf(p);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.transaction === 'designate_for_assignment')).toBe(true);
    expect(options.every((o) => o.class !== 'routine')).toBe(true);
    expect(options[0].costs.join(' ')).toMatch(/claim|waiver|designat/i);
  });
});
