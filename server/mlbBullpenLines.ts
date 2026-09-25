/**
 * The bullpen's lines for a save (D-053, cycle 3; docs/CALIBRATION.md section 14). Pure: usage in, lines and checks out; the reads are
 * `mlbCalibrationRefit.ts`'s.
 *
 *   long-man line   a MEASUREMENT of the league as it stands: the innings per appearance of its longest-working sixth of relievers this
 *                   season (a quantile, policy), shrunk toward the starting 1.6 by the relievers behind it and never below what
 *                   "multiple innings" means. Leagues differ: the Arizona import's own game works its relievers about a quarter longer
 *                   than the real seasons it imported, so the starting line called a fifth of its relievers long men. Served only when
 *                   lines drawn from half the clubs, and from the first half of the season's games, pick out about the same share of the
 *                   rest (checked as served).
 *   leverage lines  policy on the league's own scale: rescaled only when the league's mean leverage is off 1.0 beyond the tolerance.
 *
 * The lines are measured and served WITH the reliever standards (`standards-2`): the standards are measured on the tiers these lines
 * give, so the two are in force together or not at all.
 */

import type { CalibrationCheck } from './saveCalibrationStore.js';
import {
  BULLPEN_PRIOR, leverageLines, LONG_LINE_PRIOR, MIN_APPEARANCES, MULTI_INNING, type BullpenLines,
} from './bullpenRoles.js';

/** POLICY. The long-man line's quantile, minimums, checks and shrinkage. */
export const LONG_LINE_POLICY = {
  /** The line is at this quantile of relievers' innings per appearance: the longest-working sixth are long men (below high leverage). */
  quantile: 0.85,
  /** Relievers with the minimum appearances needed to measure it. */
  minRelievers: 150,
  /** Relievers at which the measurement carries half the weight against the starting line. */
  shrinkRelievers: 60,
  /** The club split: halvings (a fixed seed, so a refit is repeatable) and the tolerance around the share left at or above the line. */
  splits: 400,
  seed: 20260925,
  tolerance: 0.05,
  /** The season split: relief appearances in each half of the season's game dates, and its tolerance. */
  minHalfAppearances: 4,
  timeTolerance: 0.06,
} as const;

export type LongLinePolicy = typeof LONG_LINE_POLICY;

/** One reliever of a club's active pen this season: his appearances and innings, and, where the game logs say, by half of the season. */
export interface RelieverUsage {
  playerId: number;
  clubId: number;
  g: number;
  ip: number;
  /** Relief appearances and innings in the first and second half of the season's game dates; null when the export has no game logs. */
  halves: { first: { g: number; ip: number }; second: { g: number; ip: number } } | null;
}

export interface LongLineMeasurement {
  /** The lines the standards are measured under and served with. */
  lines: BullpenLines;
  /** The quantile measured on every reliever (unshrunk), and the line as it would serve (shrunk, never below multiple innings). */
  measured: number | null;
  asServed: number | null;
  relievers: number;
  checks: CalibrationCheck[];
  passed: boolean;
  /** Why the starting line serves, when it does. */
  reason: 'relievers' | 'check_failed' | null;
  notes: string[];
}

function quantile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

/** A small deterministic generator (a fixed seed makes a refit repeatable). */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The line as it would serve, before the floor: the quantile shrunk toward the starting line by the relievers behind it. */
export function servedLine(values: number[], policyIn: LongLinePolicy = LONG_LINE_POLICY): number | null {
  const q = quantile(values, policyIn.quantile);
  if (q === null) return null;
  const w = values.length / (values.length + policyIn.shrinkRelievers);
  return Math.round((w * q + (1 - w) * LONG_LINE_PRIOR) * 1000) / 1000;
}

const atOrAbove = (xs: number[], line: number) => xs.filter((x) => x >= line).length;

/**
 * Measure the long-man line on the league's active relievers and check it, and derive the leverage lines from the league's mean leverage.
 * Checks score the line AS SERVED (shrunk), and the share expected at or above it is the quantile's complement.
 */
export function measureLongLine(usage: RelieverUsage[], leagueLeverage: number | null, policyIn: LongLinePolicy = LONG_LINE_POLICY): LongLineMeasurement {
  const lev = leverageLines(leagueLeverage);
  const read = usage.filter((u) => u.g >= MIN_APPEARANCES && u.g > 0);
  const values = read.map((u) => u.ip / u.g);
  const measured = quantile(values, policyIn.quantile);
  const shrunk = servedLine(values, policyIn);
  const asServed = shrunk === null ? null : Math.max(MULTI_INNING, shrunk);
  const expected = 1 - policyIn.quantile;
  const notes: string[] = [
    `The long-man line is the innings per appearance of the league's longest-working ${Math.round(expected * 100)}% of relievers this season (those with ${MIN_APPEARANCES} or more appearances on the clubs' active rosters), shrunk toward the starting ${LONG_LINE_PRIOR} by n/(n+${policyIn.shrinkRelievers}) relievers and never below ${MULTI_INNING}, what "multiple innings" means.`,
    leagueLeverage === null
      ? 'The league\'s mean leverage is not in the export: the leverage lines serve as written.'
      : lev.rescaled
        ? `The league's mean leverage per batter faced is ${leagueLeverage.toFixed(3)}, off 1.0 by more than the tolerance: the leverage lines are scaled to it.`
        : `The league's mean leverage per batter faced is ${leagueLeverage.toFixed(3)}, within the tolerance of 1.0: the leverage lines serve as written.`,
  ];
  const starting = (reason: LongLineMeasurement['reason'], checks: CalibrationCheck[]): LongLineMeasurement => ({
    lines: { ...BULLPEN_PRIOR, leverage: lev.leverage, rescaled: lev.rescaled, leagueLeverage }, measured, asServed, relievers: read.length, checks, passed: false, reason, notes,
  });
  if (read.length < policyIn.minRelievers || shrunk === null || asServed === null) {
    notes.push(`Not measured: ${read.length} relievers have ${MIN_APPEARANCES} or more appearances, fewer than ${policyIn.minRelievers}. The starting line serves.`);
    return starting('relievers', []);
  }
  // Club split: the line drawn from half the clubs (as it would serve) against the other half's relievers
  const clubs = [...new Set(read.map((u) => u.clubId))];
  const rnd = generator(policyIn.seed);
  let n = 0;
  let above = 0;
  for (let i = 0; i < policyIn.splits; i += 1) {
    const order = clubs.map((c) => ({ c, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.c);
    const train = new Set(order.slice(0, Math.floor(order.length / 2)));
    const line = servedLine(read.filter((u) => train.has(u.clubId)).map((u) => u.ip / u.g), policyIn);
    if (line === null) continue;
    const held = read.filter((u) => !train.has(u.clubId)).map((u) => u.ip / u.g);
    n += held.length;
    above += atOrAbove(held, line);
  }
  const clubShare = n > 0 ? above / n : null;
  const checks: CalibrationCheck[] = [{
    kind: 'club_split', part: 'long_line', n: Math.round(n / policyIn.splits), expected, observed: clubShare,
    passed: clubShare === null ? null : Math.abs(clubShare - expected) <= policyIn.tolerance,
    note: 'Share of the other half\'s relievers at or above the line drawn from half the clubs (as it would serve), pooled over the halvings.',
  }];
  // Season split: the line from the first half of the season's game dates against the second half's relievers
  const halves = read.filter((u) => u.halves !== null);
  const first = halves.filter((u) => (u.halves as NonNullable<RelieverUsage['halves']>).first.g >= policyIn.minHalfAppearances).map((u) => { const h = (u.halves as NonNullable<RelieverUsage['halves']>).first; return h.ip / h.g; });
  const second = halves.filter((u) => (u.halves as NonNullable<RelieverUsage['halves']>).second.g >= policyIn.minHalfAppearances).map((u) => { const h = (u.halves as NonNullable<RelieverUsage['halves']>).second; return h.ip / h.g; });
  const firstLine = servedLine(first, policyIn);
  if (halves.length === 0 || firstLine === null || second.length === 0) {
    checks.push({ kind: 'season_split', part: 'long_line', n: 0, expected, observed: null, passed: null, note: 'Not measured: the export has no game logs for this season, so it cannot be split in halves.' });
  } else {
    const share = atOrAbove(second, firstLine) / second.length;
    checks.push({
      kind: 'season_split', part: 'long_line', n: second.length, expected, observed: share, passed: Math.abs(share - expected) <= policyIn.timeTolerance,
      note: `Share of the second half's relievers at or above the line drawn from the first half (${firstLine.toFixed(2)} on ${first.length} relievers).`,
    });
  }
  const failed = checks.filter((c) => c.passed === false);
  if (failed.length || checks[0].passed === null) {
    notes.push(`Measured at ${measured?.toFixed(2)} (as served ${asServed.toFixed(2)}), but it did not hold up on ${failed.map((c) => (c.kind === 'club_split' ? 'the clubs it was not drawn from' : 'the second half of the season')).join(' and ') || 'the clubs it was not drawn from'}. The starting line serves.`);
    return starting('check_failed', checks);
  }
  if (shrunk < MULTI_INNING) notes.push(`The league's relievers work less than multiple innings even at that quantile (${shrunk.toFixed(2)} as served): a long man throws multiple innings by definition, so the line is ${MULTI_INNING}.`);
  notes.push(`Measured at ${measured?.toFixed(2)} on ${read.length} relievers; served at ${asServed.toFixed(2)}.`);
  return {
    lines: { leverage: lev.leverage, rescaled: lev.rescaled, leagueLeverage, long: asServed, multiInning: MULTI_INNING, source: 'save' },
    measured, asServed, relievers: read.length, checks, passed: true, reason: null, notes,
  };
}
