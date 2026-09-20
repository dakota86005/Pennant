import { describe, expect, it } from 'vitest';
import { shiftOptions, SHIFT_LIMIT, SHIFT_MIN_EDGE, SHIFT_MIN_GAIN, type ShiftInput } from '../server/lineupShifts';

/*
 * A shift fixes a weak spot by moving a regular and covering the spot he leaves. It is worth proposing only when
 * the two spots together gain, and the estimate at each position already includes the glove there.
 */

// estimates by player and position
const EST: Record<number, Record<number, number>> = {
  1: { 7: 30, 6: 50 },        // Weak LF (regular), also rated at SS
  2: { 6: 70, 7: 66 },        // the shortstop: fine at SS, would be fine in LF
  3: { 8: 60, 7: 40 },        // the center fielder: would be worse in LF than the weak man is not
  10: { 6: 55, 7: 50 },       // bench infielder/outfielder
  11: { 8: 45 },              // bench outfielder
};
const SUPPORT: Record<number, number[]> = { 1: [7, 6], 2: [6, 7], 3: [8, 7], 10: [6, 7], 11: [8] };

const input = (over: Partial<ShiftInput> = {}): ShiftInput => ({
  target: { position: 7, playerId: 1, name: 'Weak LF' },
  regulars: [{ position: 6, playerId: 2, name: 'Shortstop' }, { position: 8, playerId: 3, name: 'Center Fielder' }],
  bench: [{ playerId: 10, name: 'Bench Utility' }, { playerId: 11, name: 'Bench OF' }],
  supported: (id, pos) => (SUPPORT[id] ?? []).includes(pos),
  estimate: (id, pos) => EST[id]?.[pos] ?? null,
  ...over,
});

describe('position shifts', () => {
  it('moves a regular to the weak spot and covers the spot he leaves, summing the change across both', () => {
    const [best] = shiftOptions(input());
    expect(best.mover).toMatchObject({ name: 'Shortstop', from: 6, to: 7 });
    // the shortstop is 66 in left (30 before); the best cover at short is himself... no: the weak man swaps (50) or the bench utility (55)
    expect(best.cover).toMatchObject({ name: 'Bench Utility', source: 'bench' });
    expect(best.target).toEqual({ before: 30, after: 66 });
    expect(best.vacated).toEqual({ before: 70, after: 55 });
    expect(best.gain).toBe(66 + 55 - (30 + 70));
  });

  it('a swap is offered when the weak regular is the best cover for the spot the mover leaves', () => {
    const [o] = shiftOptions(input({ bench: [] }));
    expect(o.cover).toMatchObject({ name: 'Weak LF', source: 'swap' });
    expect(o.gain).toBe(66 + 50 - (30 + 70));
  });

  it('proposes nothing that does not gain enough across both spots, or that the evidence does not support', () => {
    // the center fielder would be 40 in left but leaves a 60 center field covered by a 45: worse overall
    expect(shiftOptions(input()).some((o) => o.mover.name === 'Center Fielder')).toBe(false);
    // no visible support at the target: nothing to propose
    expect(shiftOptions(input({ supported: () => false }))).toEqual([]);
    // an unknown estimate at either end is not guessed
    expect(shiftOptions(input({ estimate: (id, pos) => (id === 2 && pos === 7 ? null : EST[id]?.[pos] ?? null) }))).toEqual([]);
    expect(shiftOptions(input({ estimate: () => null }))).toEqual([]);
    expect(SHIFT_MIN_GAIN).toBeGreaterThan(0);
  });

  it('lists the best shifts first and no more than the limit', () => {
    const many = input({
      regulars: Array.from({ length: 6 }, (_, i) => ({ position: 2 + i, playerId: 100 + i, name: `R${i}` })),
      supported: () => true,
      estimate: (id, pos) => (id >= 100 ? (pos === 7 ? 60 + (id - 100) : 60) : id === 1 ? 20 : 40),
    });
    const options = shiftOptions(many);
    expect(options.length).toBeLessThanOrEqual(SHIFT_LIMIT);
    for (let i = 1; i < options.length; i += 1) expect(options[i - 1].gain).toBeGreaterThanOrEqual(options[i].gain);
  });
});

describe('a shift must beat the plain lineup change', () => {
  // the bench utility (id 10) plays left at 50 against the weak regular's 30: starting him gains 20; the best shift gains 21
  it('is not proposed when starting the best bench player at the spot gains nearly as much: the same result by disturbing a second position', () => {
    expect(shiftOptions(input()).map((o) => o.gain)).toContain(21);
    expect(shiftOptions(input({ direct: 20 }))).toEqual([]); // 21 does not clear 20 + the edge
    expect(shiftOptions(input({ direct: 21 - SHIFT_MIN_EDGE })).map((o) => o.mover.name)).toContain('Shortstop');
  });

  it('with nobody on the bench who can play the spot, a shift stands on its own gain', () => {
    expect(shiftOptions(input({ direct: null })).length).toBeGreaterThan(0);
  });
});
