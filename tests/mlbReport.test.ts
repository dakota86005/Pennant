import { describe, expect, it } from 'vitest';
import { detectNeeds, whatIfNeed } from '../server/mlbNeeds';
import { buildResponsePacket, type ResponsePacket } from '../server/mlbResponses';
import type { PerformanceLine } from '../server/mlbEvidence';
import { fakePorts, healthy26, mkState, viewOf, type PortOptions, type Spec } from './mlbFixtures';

/*
 * The staff report: situation, the role picture against the current holders,
 * what it says, and named pathways. Every claim is grounded in a specialist's
 * output; nothing is a score and nothing is chosen for the GM.
 */

// starters are ids 100-104; Mena (700) is returning from the 10-day list
const mena: Spec = { id: 700, name: 'Mena', age: 23, position: 1, role: 11, il: true, active: false, forty: true, daysLeft: 8 };
const specs: Spec[] = [...healthy26(), mena];
const view = viewOf(specs);
const need = detectNeeds(view).find((n) => n.kind === 'il_return_crunch')!;

const composites = (rotation: number[], menaComposite: number | null): PortOptions['roleFit'] => (id) => ({
  compositePercentile: id === 700 ? menaComposite : id >= 100 && id <= 104 ? rotation[id - 100] : 50,
  weakestCorePercentile: 30,
});

function report(rotation: number[], menaComposite: number | null, over: Partial<PortOptions> = {}) {
  const packet: ResponsePacket = buildResponsePacket(need, view, fakePorts({ states: specs.map(mkState), roleFit: composites(rotation, menaComposite), ...over }));
  return { packet, r: packet.report! };
}
const rotation = [62, 58, 54, 50, 40];

describe('a returning player who would improve the group', () => {
  const { r, packet } = report(rotation, 60);

  it('says so, names who he would displace, and leads the report with it', () => {
    expect(packet.direction).toBe('clear');
    expect(r.read.verdict).toBe('strengthens');
    expect(r.read.text).toMatch(/would improve the starting pitcher group/);
    expect(r.read.text).toMatch(/SP5.*the weakest current starting pitcher/);
    expect(r.headline).toMatch(/would improve the starting pitcher group.*a spot has to be cleared/);
  });

  it('states the situation as facts, including what is not established about the activation', () => {
    expect(r.situation[0]).toMatch(/Mena \(23, starting pitcher\) is due back from the 10-day injured list in about 8 days/);
    expect(r.situation[1]).toMatch(/26 of 26.*a player has to leave/);
    expect(r.situation[2]).toMatch(/5 healthy starting pitchers.*floor of 5; with him back, 6/);
    expect(r.situation.join(' ')).toMatch(/not established/);
  });

  it('shows the incumbents and him side by side on the one lens, with a stated basis', () => {
    const rows = r.rolePicture!.rows;
    expect(rows.filter((x) => x.relation === 'incumbent').map((x) => x.composite)).toEqual([62, 58, 54, 50, 40]);
    expect(rows.at(-1)).toMatchObject({ relation: 'subject', name: 'Mena', composite: 60 });
    expect(r.rolePicture!.basis).toMatch(/not a value, a projection or a decision/);
    expect(r.rolePicture!.calibration.status).toBe('policy');
  });

  it('offers the displacement as a pathway with the transaction chain and the consequence for the one moved', () => {
    const p = r.pathways.find((x) => x.id === 'displace')!;
    expect(p.title).toBe('Put Mena in the starting pitcher group in place of SP5');
    expect(p.steps.at(-1)).toMatch(/^Activate Mena from the 10-day injured list/);
    expect(p.steps[0]).toMatch(/moving SP5: option to the minors \(routine and reversible\)/);
    expect(p.moves).toHaveLength(1);
    expect(p.moves[0]).toMatchObject({ name: 'SP5', transaction: 'Option to the minors', class: 'routine and reversible' });
    expect(p.consequences.join(' ')).toMatch(/starting pitcher coverage: 5 available against a floor of 5/);
    expect(p.certainty).toBe('indeterminate');
    expect(p.certaintyNote).toMatch(/not established/i);
  });

  it('also offers keeping the group as it is, moving players whose roles keep their floors', () => {
    const p = r.pathways.find((x) => x.id === 'elsewhere')!;
    expect(p.moves.length).toBeGreaterThan(0);
    expect(p.moves.every((m) => m.role !== 'starting pitcher')).toBe(true);
    expect(p.moves.some((m) => m.role === 'relief pitcher' && /against a floor of 7/.test(m.note))).toBe(true);
    // a role with no coverage standard is flagged as not assessed, never called safe
    expect(p.moves.filter((m) => !/floor/.test(m.note)).every((m) => /not assessed/.test(m.note))).toBe(true);
  });
});

describe('a returning player who does not improve it', () => {
  it('comparable: no swap pathway, and the reason to return him is depth', () => {
    const { r } = report(rotation, 44);
    expect(r.read.verdict).toBe('comparable');
    expect(r.read.text).toMatch(/comparable to the back of the starting pitcher group.*depth and fit, not ability/);
    expect(r.pathways.map((p) => p.id)).toEqual(['elsewhere']);
    expect(r.pathways[0].why.join(' ')).toMatch(/does not clearly improve/);
  });

  it('behind: says he would not improve the group', () => {
    const { r } = report(rotation, 25);
    expect(r.read.verdict).toBe('behind');
    expect(r.read.text).toMatch(/would not improve.*15 points below SP5/);
    expect(r.headline).toMatch(/would not improve/);
    expect(r.pathways.map((p) => p.id)).toEqual(['elsewhere']);
  });

  it('no visible rating: cannot be judged, and no displacement is proposed', () => {
    const { r } = report(rotation, null);
    expect(r.read.verdict).toBe('cannot_judge');
    expect(r.read.text).toMatch(/cannot place Mena/);
    expect(r.pathways.some((p) => p.id === 'displace')).toBe(false);
  });

  it('an unassessed incumbent is a caveat on the read, not a silent gap', () => {
    const { r } = report(rotation, 60, { roleFit: (id) => id === 104 ? { compositePercentile: null, weakestCorePercentile: null, evidenceStatus: 'unknown' } : composites(rotation, 60)!(id) });
    expect(r.read.caveats.join(' ')).toMatch(/SP5 has no visible rating/);
  });
});

describe('season results are context', () => {
  const line = (era: string, ip: number, gs: number): PerformanceLine => ({ kind: 'pitching', year: 2030, level: 1, sample: ip, sampleUnit: 'IP', lines: [{ label: 'ERA', value: era }, { label: 'G/GS', value: `${gs}/${gs}` }] });

  it('flags a thin sample for him and shows the incumbents\' lines without changing the verdict', () => {
    const lines: Record<number, PerformanceLine> = { 700: line('1.35', 6.7, 0), 100: line('2.80', 40, 8), 101: line('3.40', 40, 8), 102: line('4.20', 40, 8), 103: line('4.90', 40, 8), 104: line('5.60', 40, 8) };
    const { r } = report(rotation, 60, { performance: (id) => lines[id] ?? null });
    expect(r.read.verdict).toBe('strengthens');
    expect(r.read.caveats.join(' ')).toMatch(/6.7 IP: too few to weigh/);
    expect(r.read.caveats.join(' ')).toMatch(/Results agree with the ratings: SP5's ERA 5.60/);
    expect(r.rolePicture!.rows.find((x) => x.playerId === 100)!.performance).not.toBeNull();
  });
});

describe('the return needs a 40-man spot too', () => {
  it('a 60-day return states the second requirement and adds it to the pathway', () => {
    const sixty: Spec = { ...mena, il: false, il60: true, forty: false };
    const s = [...healthy26(), sixty, { id: 500, position: 1, role: 11, level: 2, forty: true, active: false }, { id: 501, position: 1, role: 11, level: 2, forty: true, active: false }];
    const lo = { rules_secondary_roster_limit: 28 };
    const v = viewOf(s, lo);
    const n = detectNeeds(v).find((x) => x.kind === 'il_return_crunch')!;
    const p = buildResponsePacket(n, v, fakePorts({ states: s.map(mkState), leagueOver: lo, roleFit: composites(rotation, 60) })).report!;
    expect(p.situation[1]).toMatch(/off the 40-man while on the 60-day list.*a 40-man spot is a second requirement/);
    expect(p.pathways.find((x) => x.id === 'displace')!.steps[0]).toMatch(/Clear a 40-man spot first/);
  });
});

describe('a hole to fill', () => {
  const farm: Spec[] = [
    { id: 500, name: 'Reno Better', position: 1, role: 11, level: 2, forty: true, active: false },
    { id: 501, name: 'Reno Same', position: 1, role: 11, level: 2, forty: true, active: false },
    { id: 502, name: 'Reno Worse', position: 1, role: 11, level: 2, forty: true, active: false },
  ];
  const s = [...healthy26(), ...farm];
  const v = viewOf(s);
  const composite: Record<number, number> = { 100: 62, 101: 58, 102: 54, 103: 50, 104: 40, 500: 60, 501: 43, 502: 20 };
  const p = buildResponsePacket(whatIfNeed(v, 100, undefined, 40)!, v, fakePorts({
    states: s.map(mkState), assignments: { 500: 'optioned', 501: 'optioned', 502: 'optioned' },
    development: { 500: {}, 501: {}, 502: {} }, roleFit: (id) => ({ compositePercentile: composite[id] ?? 50, weakestCorePercentile: 30 }),
  }));

  it('places each viable candidate against the players who hold the role today', () => {
    const rows = p.report!.rolePicture!.rows.filter((x) => x.relation === 'subject');
    expect(Object.fromEntries(rows.map((x) => [x.name, x.standing?.verdict]))).toEqual({
      'Reno Better': 'strengthens', 'Reno Same': 'comparable', 'Reno Worse': 'behind',
    });
  });

  it('the read says what kind of player each would be, and that the open spot is filled rather than someone replaced', () => {
    const t = p.report!.read.text;
    expect(t).toMatch(/spot is open, so each candidate fills it rather than replacing someone/);
    expect(t).toMatch(/Reno Better is clearly better than the weakest current starting pitcher/);
    expect(t).toMatch(/Reno Same is in line with the back of the group/);
    expect(t).toMatch(/Reno Worse would be the weakest starting pitcher on the club/);
  });

  it('an assumed-out player is not one of the current holders', () => {
    const rows = p.report!.rolePicture!.rows.filter((x) => x.relation === 'incumbent');
    expect(rows.map((x) => x.playerId)).not.toContain(100);
    expect(rows).toHaveLength(4);
    expect(p.report!.rolePicture!.standard).toMatchObject({ healthy: 4, count: 5 });
  });

  it('a candidate who would be the weakest still gets a pathway when the role is short: a body is needed', () => {
    const paths = p.report!.pathways;
    expect(paths.map((x) => x.title)).toEqual(['Recall: Reno Better (level 2)', 'Recall: Reno Same (level 2)', 'Recall: Reno Worse (level 2)']);
    expect(paths[0].steps.join(' ')).toMatch(/recall/i);
    expect(p.report!.orderingNote).toMatch(/not a ranking of players/);
  });

  it('a candidate Player Development or Rights blocks gets no pathway', () => {
    const blocked = buildResponsePacket(whatIfNeed(v, 100, undefined, 40)!, v, fakePorts({
      states: s.map(mkState), assignments: { 500: 'optioned' }, development: { 500: { judgment: 'indefensible', blockers: ['no'] } },
      roleFit: (id) => ({ compositePercentile: composite[id] ?? 50, weakestCorePercentile: 30 }),
    })).report!;
    expect(blocked.pathways.some((x) => x.id === 'candidate:500')).toBe(false);
  });

  it('says when an injured player is about to return and would close the gap himself', () => {
    const s2 = [...s, { id: 600, name: 'Due Back', position: 1, role: 11, il: true, active: false, forty: true, daysLeft: 8 }];
    const v2 = viewOf(s2);
    const need2 = whatIfNeed(v2, 100)!;
    const r2 = buildResponsePacket(need2, v2, fakePorts({ states: s2.map(mkState), assignments: { 500: 'optioned' }, development: { 500: {} } })).report!;
    expect(r2.situation.join(' ')).toMatch(/Due Back is due back from the injured list in about 8 days.*a bridge, not a permanent answer/);
    expect(r2.read.text).toMatch(/Due Back's expected return in about 8 days would close the gap on its own/);
  });
});
