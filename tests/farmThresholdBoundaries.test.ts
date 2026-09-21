import { describe, expect, it } from 'vitest';
import { CURRENT_ASSIGNMENT_THRESHOLDS, evaluateCurrentAssignment } from '../server/currentAssignment.js';
import {
  AGE_LEVEL_DEVELOPMENT_LIMIT,
  BODY_COUNT,
  CASCADE_MAX_STEPS,
  MINIMUM_CLUB_GAMES,
  OLD_FOR_LEVEL,
  POSITION_CAPACITY,
  PRIORITY_CONGESTION_AT,
  RELIEF_CAPACITY,
  RELIEF_CORPS,
  ROTATION_SPOTS,
  STARTER_CAPACITY,
  UPPER_MINORS_DEPTH_FLOOR,
  YOUNG_FOR_LEVEL,
} from '../server/farmCalibration.js';
import { positionConflict, reliefConflict, rotationConflict } from '../server/playingTime.js';
import { currentInput, usage } from './farmGolden.js';

/**
 * Every policy threshold at the value and a step either side.
 *
 * A hair either side, never "exactly on the line": several of these compare floating-point
 * percentiles. A failure here means a threshold moved, which is a decision and should be deliberate.
 */

const standingAt = (percentile: number) => evaluateCurrentAssignment(currentInput({ leaguePercentile: percentile })).standing;
const windowAt = (ageDiff: number) => evaluateCurrentAssignment(currentInput({ ageRelativeToLevel: ageDiff })).window;

describe('the level-standing lines', () => {
  const { clearlyAbovePercentile, clearlyBelowPercentile } = CURRENT_ASSIGNMENT_THRESHOLDS;

  it('calls a man clearly better than the league just above the line and not just below it', () => {
    expect(standingAt(clearlyAbovePercentile + 0.5)).toBe('mastered');
    expect(standingAt(clearlyAbovePercentile - 0.5)).toBe('holding');
  });

  it('calls a man clearly worse than the league just below the line and not just above it', () => {
    expect(standingAt(clearlyBelowPercentile - 0.5)).toBe('overmatched');
    expect(standingAt(clearlyBelowPercentile + 0.5)).toBe('holding');
  });
});

describe('the sample lines', () => {
  const { claimReliability, readableReliability } = CURRENT_ASSIGNMENT_THRESHOLDS;
  const at = (reliability: number) => evaluateCurrentAssignment(currentInput({ leaguePercentile: 99, reliability })).standing;

  it('allows a claim just above the claim line and refuses one just below it', () => {
    expect(at(claimReliability + 0.01)).toBe('mastered');
    expect(at(claimReliability - 0.01)).toBe('holding');
  });

  it('reads a line just above the readable line and nothing at all just below it', () => {
    expect(at(readableReliability + 0.01)).toBe('holding');
    expect(at(readableReliability - 0.01)).toBe('indeterminate');
  });
});

describe('the age-relative-to-level lines', () => {
  it('calls a player young for the level at the line and ordinary a hair under it', () => {
    expect(windowAt(YOUNG_FOR_LEVEL + 0.01)).toBe('ample');
    expect(windowAt(YOUNG_FOR_LEVEL - 0.01)).toBe('normal');
  });

  it('calls a player old for the level at the line and ordinary a hair under it', () => {
    expect(windowAt(-(OLD_FOR_LEVEL + 0.01))).toBe('closing');
    expect(windowAt(-(OLD_FOR_LEVEL - 0.01))).toBe('normal');
  });

  it('closes the developmental window at the limit and not a hair under it', () => {
    expect(windowAt(-(AGE_LEVEL_DEVELOPMENT_LIMIT + 0.01))).toBe('closed');
    expect(windowAt(-(AGE_LEVEL_DEVELOPMENT_LIMIT - 0.01))).toBe('closing');
  });
});

describe('the playing-time capacities', () => {
  const hitters = (n: number, innings: number) =>
    Array.from({ length: n }, (_, i) => usage({ playerId: i + 1, name: `H${i}`, inningsByPosition: { SS: innings }, tier: 'normal' }));

  it('is a positional conflict one over capacity and not at capacity', () => {
    expect(positionConflict(10, 'SS', hitters(POSITION_CAPACITY.covered + 1, 300), 900)).not.toBeNull();
    expect(positionConflict(10, 'SS', hitters(POSITION_CAPACITY.covered, 450), 900)).toBeNull();
  });

  const arms = (n: number, starts: number) =>
    Array.from({ length: n }, (_, i) => usage({ playerId: i + 1, name: `P${i}`, starts, inningsPitched: starts * 5, tier: 'normal' }));

  it('is a rotation conflict one over the rotation spots and not at them', () => {
    expect(rotationConflict(10, arms(STARTER_CAPACITY + 1, 7), 45)).not.toBeNull();
    expect(rotationConflict(10, arms(STARTER_CAPACITY, 9), 45)).toBeNull();
  });

  it('is a bullpen conflict one over the relief capacity and not at it', () => {
    const relievers = (n: number) =>
      Array.from({ length: n }, (_, i) => usage({ playerId: i + 1, name: `R${i}`, inningsPitched: 20, tier: 'normal' }));
    expect(reliefConflict(10, relievers(RELIEF_CAPACITY + 1), 45)).not.toBeNull();
    expect(reliefConflict(10, relievers(RELIEF_CAPACITY), 45)).toBeNull();
  });

  it('reads no conflict from a club one game under the minimum, and one at it', () => {
    const early = (games: number) => hitters(POSITION_CAPACITY.covered + 2, 100).map((u) => ({ ...u, clubGames: games }));
    expect(positionConflict(10, 'SS', early(MINIMUM_CLUB_GAMES - 1), 900)).toBeNull();
    expect(positionConflict(10, 'SS', early(MINIMUM_CLUB_GAMES), 900)).not.toBeNull();
  });
});

describe('the structural floors are the values this phase declared', () => {
  it('holds the roster, rotation and relief shapes', () => {
    expect(BODY_COUNT).toEqual({ hitters: { thinBelow: 12, surplusAt: 17 }, pitchers: { thinBelow: 12, surplusAt: 18 } });
    expect(ROTATION_SPOTS).toBe(5);
    expect(RELIEF_CORPS).toEqual({ thinBelow: 7, criticalBelow: 5, crowdedAt: 9 });
    expect(POSITION_CAPACITY).toEqual({ covered: 2, congestedAt: 4 });
  });

  it('holds the organizational lines and the cascade limit', () => {
    expect(UPPER_MINORS_DEPTH_FLOOR).toBe(2);
    expect(PRIORITY_CONGESTION_AT).toBe(2);
    expect(CASCADE_MAX_STEPS).toBe(4);
    expect(MINIMUM_CLUB_GAMES).toBe(20);
  });
});
