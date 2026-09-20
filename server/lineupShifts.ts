/**
 * Position shifts: fixing a weak spot by moving a regular, not by adding a player.
 *
 * A weak left fielder can be replaced by a bench outfielder, and that is a lineup change. It can also be
 * fixed by moving the shortstop, who has a revealed grade in left, and covering shortstop from the bench:
 * a chain of two moves that keeps everyone. Whether it is worth doing depends on both ends: what the mover is
 * at his new position, and what covers the position he leaves. This module lists those chains and what each
 * does to the two spots, and lets the caller decide what to make of them.
 *
 * Pure. It is handed who can play where (the visible grades, decided by Player Development's cross-role
 * evidence) and what each player's working estimate is at a position (decided by the evaluators); it does
 * arithmetic on that and decides neither. The estimate at a position is bat plus glove there, so a
 * shift that costs defense shows in the number.
 *
 * PROVISIONAL (policy): the smallest gain across the two spots worth proposing.
 */

import { policy, type CalibrationStamp } from './calibration.js';

export const SHIFT_CALIBRATION: CalibrationStamp = policy('The smallest combined gain worth proposing is a policy threshold, set to the same size as a meaningful difference between two players.');

/** PROVISIONAL (policy). Points of working estimate, summed across the two spots, a shift must gain to be proposed. */
export const SHIFT_MIN_GAIN = 8;
/**
 * POLICY. Points a shift must gain OVER simply starting the best bench player at the weak spot before it is worth the extra move.
 * A shift that does no better than the direct replacement is the same result reached by disturbing a second position.
 */
export const SHIFT_MIN_EDGE = 3;
/** How many shifts are proposed at most. */
export const SHIFT_LIMIT = 3;

export interface ShiftInput {
  /** The weak spot and the regular holding it. */
  target: { position: number; playerId: number; name: string };
  /** The other regulars, each at his own position. */
  regulars: Array<{ position: number; playerId: number; name: string }>;
  bench: Array<{ playerId: number; name: string }>;
  /** Whether the visible evidence supports the player at the position. */
  supported(playerId: number, position: number): boolean;
  /** His working estimate at the position, or null when unknown. */
  estimate(playerId: number, position: number): number | null;
  /** What starting the best bench player straight at the weak spot would gain there; a shift must beat it by `SHIFT_MIN_EDGE`. Absent when nobody on the bench can play it. */
  direct?: number | null;
}

export interface ShiftOption {
  /** The regular who moves to the weak spot. */
  mover: { playerId: number; name: string; from: number; to: number };
  /** Who then plays the position the mover left: a bench player, or the weak regular himself in a swap. */
  cover: { playerId: number; name: string; source: 'bench' | 'swap' };
  /** Working estimates at the two spots before and after. */
  target: { before: number; after: number };
  vacated: { before: number; after: number };
  /** The change summed across the two spots. */
  gain: number;
}

export function shiftOptions(input: ShiftInput): ShiftOption[] {
  const { target } = input;
  const before = input.estimate(target.playerId, target.position);
  if (before === null) return [];
  const options: ShiftOption[] = [];
  for (const r of input.regulars) {
    if (r.position === target.position || !input.supported(r.playerId, target.position)) continue;
    const moverAtTarget = input.estimate(r.playerId, target.position);
    const moverAtHome = input.estimate(r.playerId, r.position);
    if (moverAtTarget === null || moverAtHome === null) continue;
    const covers = [
      { playerId: target.playerId, name: target.name, source: 'swap' as const },
      ...input.bench.map((b) => ({ playerId: b.playerId, name: b.name, source: 'bench' as const })),
    ]
      .filter((c) => input.supported(c.playerId, r.position))
      .map((c) => ({ ...c, estimate: input.estimate(c.playerId, r.position) }))
      .filter((c): c is typeof c & { estimate: number } => c.estimate !== null)
      .sort((a, b) => b.estimate - a.estimate || a.name.localeCompare(b.name));
    const best = covers[0];
    if (!best) continue;
    const gain = moverAtTarget + best.estimate - (before + moverAtHome);
    if (gain < SHIFT_MIN_GAIN) continue;
    if (input.direct !== undefined && input.direct !== null && gain < input.direct + SHIFT_MIN_EDGE) continue;
    options.push({
      mover: { playerId: r.playerId, name: r.name, from: r.position, to: target.position },
      cover: { playerId: best.playerId, name: best.name, source: best.source },
      target: { before, after: moverAtTarget }, vacated: { before: moverAtHome, after: best.estimate }, gain,
    });
  }
  return options.sort((a, b) => b.gain - a.gain || a.mover.name.localeCompare(b.mover.name)).slice(0, SHIFT_LIMIT);
}
