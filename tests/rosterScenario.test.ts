import { describe, expect, it } from 'vitest';
import { DEFAULT_COVERAGE_FLOORS } from '../server/mlbNeeds';
import { applyMoves, evaluateScenario, groupSnapshot, type EstimateOf } from '../server/rosterScenario';
import type { RoleRef } from '../server/mlbRoster';
import { healthy26, viewOf, type Spec } from './mlbFixtures';

/*
 * Roster scenarios: bookkeeping and consequences, never legality or ability.
 */

const SP: RoleRef = { kind: 'starting_pitcher', label: 'starting pitcher', position: 1 };
const RP: RoleRef = { kind: 'relief_pitcher', label: 'relief pitcher', position: 1 };
const floors = DEFAULT_COVERAGE_FLOORS;

// SP1..SP5 = 100..104, RP1..RP8 = 105..112
const est: Record<number, number> = { 100: 62, 101: 58, 102: 54, 103: 50, 104: 35, 105: 60, 106: 55, 107: 52, 108: 50, 109: 48, 110: 45, 111: 40, 112: 30, 500: 60 };
const estimateOf: EstimateOf = (id) => est[id] ?? null;

const club = (extra: Spec[] = []) => viewOf([...healthy26(), ...extra]);
const minorSP: Spec = { id: 500, name: 'Reno SP', position: 1, role: 11, level: 2, forty: true, active: false };

describe('applying moves', () => {
  it('never changes the view it is given', () => {
    const v = club([minorSP]);
    const snapshot = JSON.stringify(v.members.map((m) => [m.playerId, m.onActive, m.role?.kind]));
    applyMoves(v, [{ kind: 'option', playerId: 104 }, { kind: 'add_active', playerId: 500 }]);
    expect(JSON.stringify(v.members.map((m) => [m.playerId, m.onActive, m.role?.kind]))).toBe(snapshot);
  });

  it('an option leaves the active roster and stays on the 40-man', () => {
    const { view } = applyMoves(club(), [{ kind: 'option', playerId: 104 }]);
    expect(view.counts).toEqual({ active: 25, fortyMan: 26 });
    expect(view.members.find((m) => m.playerId === 104)).toMatchObject({ onActive: false, onFortyMan: true });
  });

  it('a designation leaves both; the 60-day list leaves both and lists him', () => {
    const d = applyMoves(club(), [{ kind: 'designate', playerId: 104 }]).view;
    expect(d.counts).toEqual({ active: 25, fortyMan: 25 });
    const s = applyMoves(club(), [{ kind: 'sixty_day', playerId: 104 }]).view;
    expect(s.counts).toEqual({ active: 25, fortyMan: 25 });
    expect(s.members.find((m) => m.playerId === 104)?.onInjuredList).toBe(true);
  });

  it('adding a player puts him on the active roster and the 40-man, in the role given', () => {
    const { view } = applyMoves(club([minorSP]), [{ kind: 'add_active', playerId: 500 }]);
    expect(view.counts).toEqual({ active: 27, fortyMan: 27 });
    const r = applyMoves(club(), [{ kind: 'role_change', playerId: 104, role: RP }]).view;
    expect(r.members.find((m) => m.playerId === 104)?.role?.kind).toBe('relief_pitcher');
    expect(r.counts.active).toBe(26);
  });

  it('a move that cannot apply is reported, not silently dropped', () => {
    const { applied } = applyMoves(club(), [{ kind: 'option', playerId: 999 }, { kind: 'add_active', playerId: 100 }, { kind: 'role_change', playerId: 999, role: RP }]);
    expect(applied.map((a) => a.applied)).toEqual([false, false, false]);
    expect(applied[1].note).toMatch(/already on the active roster/);
  });
});

describe('group snapshots', () => {
  it('reports healthy count, the floor, the mean and the weakest by working estimate', () => {
    const g = groupSnapshot(club(), SP, floors, estimateOf);
    expect(g).toMatchObject({ healthy: 5, floor: 5, unknown: 0 });
    expect(g.mean).toBeCloseTo((62 + 58 + 54 + 50 + 35) / 5);
    expect(g.weakest).toMatchObject({ playerId: 104, estimate: 35 });
  });

  it('a member with no estimate is counted as unknown and never as weak', () => {
    const g = groupSnapshot(club(), SP, floors, (id) => (id === 104 ? null : est[id] ?? null));
    expect(g.unknown).toBe(1);
    expect(g.weakest?.playerId).toBe(103);
  });
});

describe('a chain of moves and what follows', () => {
  it('replacing the weakest starter with a better one lifts the rotation and leaves the counts alone', () => {
    const v = club([minorSP]);
    const c = evaluateScenario(v, [{ kind: 'option', playerId: 104 }, { kind: 'add_active', playerId: 500 }], floors, estimateOf);
    const rot = c.groups.find((g) => g.kind === 'starting_pitcher')!;
    expect(rot.meanChange).toBeCloseTo((60 - 35) / 5);
    expect(rot.belowFloorAfter).toBe(false);
    expect(c.counts.active).toMatchObject({ before: 26, after: 26, over: false });
    expect(c.problems).toEqual([]);
  });

  it('moving a starter to the bullpen touches both groups and overfills the roster if nobody leaves', () => {
    const v = club([minorSP]);
    const c = evaluateScenario(v, [{ kind: 'role_change', playerId: 104, role: RP }, { kind: 'add_active', playerId: 500 }], floors, (id, role) => (id === 104 && role.kind === 'relief_pitcher' ? 44 : est[id] ?? null));
    expect(c.groups.map((g) => g.kind).sort()).toEqual(['relief_pitcher', 'starting_pitcher']);
    const pen = c.groups.find((g) => g.kind === 'relief_pitcher')!;
    expect(pen.before.healthy).toBe(8);
    expect(pen.after.healthy).toBe(9);
    expect(pen.surplusAfter).toBe(2);
    expect(c.counts.active).toMatchObject({ after: 27, over: true });
    expect(c.problems.join(' ')).toMatch(/active roster would be 27 of 26/);
  });

  it('a move that takes a group below its floor says so in the problems', () => {
    const c = evaluateScenario(club(), [{ kind: 'option', playerId: 100 }], floors, estimateOf);
    expect(c.groups[0].belowFloorAfter).toBe(true);
    expect(c.problems.join(' ')).toMatch(/starting pitcher coverage would be 4 against a floor of 5/);
  });

  it('the 40-man is tracked separately: adding a non-40-man player while it is full', () => {
    const v = viewOf([...healthy26(), { id: 501, name: 'Non40', position: 1, role: 11, level: 2, forty: false, active: false }, { id: 502, position: 1, role: 12, level: 2, forty: true, active: false }], { rules_secondary_roster_limit: 27 });
    const c = evaluateScenario(v, [{ kind: 'option', playerId: 104 }, { kind: 'add_active', playerId: 501 }], floors, estimateOf);
    expect(c.counts.fortyMan).toMatchObject({ before: 27, after: 28, over: true });
    expect(c.counts.active.over).toBe(false);
    expect(c.problems.join(' ')).toMatch(/40-man would be 28 of 27/);
  });
});
