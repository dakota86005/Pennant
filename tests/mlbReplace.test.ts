import { describe, expect, it } from 'vitest';
import { buildResponsePacket, type ResponsePacket } from '../server/mlbResponses';
import { reviewNeedFor } from '../server/mlbReview';
import type { LensEvidence } from '../server/roleReview';
import { fakePorts, healthy26, mkState, viewOf, type PortOptions, type Spec } from './mlbFixtures';

/*
 * Replacing a flagged role holder: each replacement is compared with him lens by lens,
 * the lead replacement is chosen by readiness, and every way of making room is followed
 * through to what it does to the other groups. Legality is Player Rights', not ours.
 */

const ev = (ratingsPct: number | null, skillsPct: number | null, runsPct: number | null, reliability = 0.75): LensEvidence => ({
  ratingsPct, ratingsEvidence: 'complete', skillsPct, runsPct, sample: 900, sampleUnit: 'BF', toolsWeight: 1, reliability, currentSample: 180, usage: [],
});
// SP1..SP5 = 100..104 (SP5 is weak); RP1..RP8 = 105..112 (RP8 is the weakest arm); Reno arms = 500..503
const lens: Record<number, LensEvidence> = {
  100: ev(60, 68, 60), 101: ev(55, 73, 77), 102: ev(50, 58, 36), 103: ev(47, 60, 40), 104: ev(20, 14, 15),
  105: ev(60, 70, 66), 106: ev(55, 60, 55), 107: ev(52, 55, 50), 108: ev(50, 55, 52), 109: ev(48, 50, 50), 110: ev(45, 48, 44), 111: ev(40, 42, 42), 112: ev(12, 8, 10),
  500: ev(58, 66, 64, 0.6),   // a clear upgrade with a real major-league record
  501: ev(56, null, null, 0), // an upgrade on tools alone
  502: ev(5, null, null, 0),  // a downgrade
};
const farm: Spec[] = [
  { id: 500, name: 'Reno Better', position: 1, role: 11, level: 2, forty: true, active: false },
  { id: 501, name: 'Reno ToolsOnly', position: 1, role: 11, level: 2, forty: true, active: false },
  { id: 502, name: 'Reno Worse', position: 1, role: 11, level: 2, forty: true, active: false },
];

function packet(specsOver: (s: Spec) => Spec = (s) => s, opts: Partial<PortOptions> = {}, extra: Spec[] = farm): ResponsePacket {
  const specs = [...healthy26().map(specsOver), ...extra];
  const view = viewOf(specs);
  const base = fakePorts({
    states: specs.map(mkState), assignments: { 500: 'optioned', 501: 'optioned', 502: 'optioned' },
    development: { 500: {}, 501: {}, 502: {} },
    roleFit: (id) => ({ compositePercentile: lens[id]?.ratingsPct ?? null, weakestCorePercentile: 40 }),
    holderEvidence: (id) => lens[id], ...opts,
  });
  const need = reviewNeedFor(view, 104, base)!;
  expect(need).toBeTruthy();
  return buildResponsePacket(need, view, base);
}
const cand = (p: ResponsePacket, id: number) => p.groups.flatMap((g) => g.candidates).find((c) => c.playerId === id)!;

describe('a replacement is compared with the player under review, lens by lens', () => {
  const p = packet();

  it('is a replace direction whose duration is not assumed', () => {
    expect(p.direction).toBe('replace');
    expect(p.assignment).toMatchObject({ context: null, basis: 'duration_unknown', evaluated: ['temporary_depth', 'durable_role'] });
  });

  it('grades each candidate against him: a clear upgrade needs tools, results and the gap; tools alone is uncertain; a lesser arm is a downgrade', () => {
    expect(cand(p, 500).comparison).toMatchObject({ verdict: 'clear_upgrade', certainty: 'adequate' });
    expect(cand(p, 501).comparison).toMatchObject({ verdict: 'upgrade_uncertain', certainty: 'limited' });
    expect(cand(p, 502).comparison?.verdict).toBe('downgrade');
    expect(cand(p, 500).comparison?.reasons.join(' ')).toMatch(/Tools:.*Results:/);
  });

  it('the read says both lenses agree on the holder and names who would improve on him', () => {
    const t = p.report!.read.text;
    expect(t).toMatch(/Both lenses agree: his tools \(20th\) and his results/);
    expect(t).toMatch(/Reno Better \(\+\d+\) is a clear upgrade/);
    expect(t).toMatch(/Reno ToolsOnly.*an upgrade on paper, but his read is not firm/);
  });

  it('the picture shows him flagged among his group, and every candidate with the comparison', () => {
    const rows = p.report!.rolePicture!.rows;
    expect(rows.filter((r) => r.underReview).map((r) => r.playerId)).toEqual([104]);
    expect(rows.filter((r) => r.relation === 'subject').map((r) => r.name).sort()).toEqual(['Reno Better', 'Reno ToolsOnly', 'Reno Worse']);
    expect(rows.find((r) => r.playerId === 500)?.comparison?.verdict).toBe('clear_upgrade');
    // the lenses stay visible beside the estimate
    const row = rows.find((r) => r.playerId === 104)!;
    expect(row).toMatchObject({ composite: 20, resultsPct: expect.any(Number), estimate: expect.any(Number) });
  });

  it('a candidate Player Development blocks is not the lead, and the read says he is held up and why', () => {
    const blocked = packet((s) => s, { development: { 500: { judgment: 'indefensible', blockers: ['no'] }, 501: {}, 502: {} } });
    expect(blocked.report!.read.text).toMatch(/Held up: Reno Better would be a clear upgrade \(\+\d+\) but Player Development does not support the assignment/);
    expect(blocked.plans?.[0].title).toMatch(/Reno ToolsOnly/);
  });
});

describe('the ways of making room, followed through', () => {
  const p = packet();
  const plan = (id: string) => p.plans?.find((x) => x.id === id);

  it('offers an option when Rights allows it, and follows the rotation and the counts', () => {
    const send = plan('send_down')!;
    expect(send.title).toBe('Send SP5 down and bring in Reno Better');
    expect(send.steps.map((s) => s.status)).toEqual(['eligible', 'eligible']);
    const rot = send.groups.find((g) => g.label === 'starting pitcher')!;
    expect(rot.change).toBeGreaterThan(0);
    expect(rot.weakestBefore?.name).toBe('SP5');
    expect(send.counts.active).toBe('26 of 26 (no change)');
    expect(plan('designate')).toBeUndefined(); // he can simply be optioned
  });

  it('moving a starter to the bullpen touches both groups and chooses the follow-up move', () => {
    const pen = plan('move_to_bullpen')!;
    expect(pen.groups.map((g) => g.label).sort()).toEqual(['relief pitcher', 'starting pitcher']);
    expect(pen.followUp?.chosen?.name).toBe('RP8'); // the weakest arm of the group that gained a body, who can be optioned
    expect(pen.followUp?.chosen?.class).toBe('routine');
    expect(pen.steps.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(pen.steps[2].text).toMatch(/Option RP8/);
    expect(pen.counts.active).toBe('26 of 26 (no change)');
    expect(pen.problems).toEqual([]);
    const bullpen = pen.groups.find((g) => g.label === 'relief pitcher')!;
    expect(bullpen.healthyAfter).toBe(bullpen.healthyBefore); // one in, one out
  });

  it('a veteran who cannot be optioned can only be designated, and the plan says so with its costs', () => {
    const vet = packet((s) => (s.id === 104 ? { ...s, mlbYears: 9, used: 2 } : s));
    expect(vet.plans?.find((x) => x.id === 'send_down')).toBeUndefined();
    const d = vet.plans?.find((x) => x.id === 'designate')!;
    expect(d.steps[0].note).toMatch(/cannot simply be optioned/);
    expect(d.costs.join(' ')).toMatch(/may claim him/);
    expect(d.counts.fortyMan).toMatch(/30 to 29|29/);
  });

  it('a plan is only as certain as its least certain link', () => {
    const stale = packet((s) => s, { evidence: { currentState: 'current', chronology: 'unavailable' } });
    // recall of an optioned player needs the log; with it unavailable his path is not established
    const c = cand(stale, 500);
    expect(c.path.status).toBe('indeterminate');
    expect(stale.plans?.every((x) => x.certainty === 'indeterminate')).toBe(true);
  });

  it('with nobody internal to bring in there is no plan: moving him would only open a hole', () => {
    const none = packet((s) => s, { development: {} }, [{ id: 502, name: 'Reno Worse', position: 1, role: 11, level: 2, forty: true, active: false }]);
    expect(none.plans).toEqual([]);
    expect(none.report!.read.text).toMatch(/No internal candidate is ready to take his spot today/);
  });

  it('never ranks players: candidates keep their stable order and the decision is the GM\'s', () => {
    expect(p.semantics).toEqual({ ranking: 'none', ordering: 'stable_by_path_level_name', decision: 'gm' });
    expect(p.report!.orderingNote).toMatch(/not a ranking of players/);
  });
});

describe('the staff recommendation follows a stated rubric', () => {
  it('ACT: a strong case, a clear firm upgrade whose path is open and defensible, and a plan that puts nobody at risk', () => {
    const r = packet().report!.recommendation!;
    expect(r).toMatchObject({ stance: 'act', confidence: 'high' });
    expect(r.headline).toMatch(/Recommend the change: Send SP5 down and bring in Reno Better/);
    expect(r.because.join(' ')).toMatch(/Both lenses agree.*clear upgrade.*puts nobody at risk/s);
    expect(r.basis).toMatch(/It is advice, not a decision/);
  });

  it('EXPLORE: the upgrade is real but Player Development has not settled the assignment; says what to settle', () => {
    const open = packet((s) => s, { development: { 501: {}, 502: {} } }); // 500 is unassessed
    const r = open.report!.recommendation!;
    expect(r.stance).toBe('explore');
    expect(r.toSettle.join(' ')).toMatch(/Player Development cannot yet establish|read on Reno ToolsOnly rests on one lens/);
    expect(r.wouldChange.join(' ')).toMatch(/Settling the item above would move this to a recommendation/);
  });

  it('EXPLORE: nothing ready today, but a held-up upgrade is named with what holds him up', () => {
    const blocked = packet((s) => s, { development: { 500: { judgment: 'indefensible', blockers: ['no'] }, 501: { judgment: 'indefensible', blockers: ['no'] }, 502: {} } });
    const r = blocked.report!.recommendation!;
    expect(r.stance).toBe('explore');
    expect(r.confidence).toBe('low');
    expect(r.headline).toMatch(/Nothing is ready today, but Reno Better would be a clear upgrade/);
  });

  it('HOLD: nothing internal improves on him', () => {
    const none = packet((s) => s, { development: {} }, [{ id: 502, name: 'Reno Worse', position: 1, role: 11, level: 2, forty: true, active: false }]);
    expect(none.report!.recommendation).toMatchObject({ stance: 'hold' });
    expect(none.report!.recommendation!.headline).toMatch(/Nothing internal improves on SP5/);
  });

  it('MONITOR: the best internal option is only a marginal upgrade', () => {
    const cands: Record<number, LensEvidence> = { ...lens, 500: ev(22, 20, 20, 0.75), 501: ev(10, null, null, 0), 502: ev(5, null, null, 0) };
    const original = { ...lens };
    Object.assign(lens, cands);
    try {
      const m = packet();
      expect(m.report!.recommendation!.stance).toBe('monitor');
      expect(m.report!.recommendation!.headline).toMatch(/only a marginal upgrade/);
    } finally { Object.assign(lens, original); }
  });

  it('never recommends a disruptive move as an ACT', () => {
    const vet = packet((s) => (s.id === 104 ? { ...s, mlbYears: 9, used: 2 } : s));
    // the bullpen route is still clean, so it can be recommended; but designation alone never is
    expect(vet.plans?.some((p) => p.id === 'designate')).toBe(true);
    if (vet.report!.recommendation!.stance === 'act') expect(vet.report!.recommendation!.headline).not.toMatch(/Designate/);
  });
});
