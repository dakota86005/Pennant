/**
 * The bullpen's lines for a save (D-053, cycle 3; docs/CALIBRATION.md section 14). Pure: usage in, lines and checks out; the reads are
 * `mlbCalibrationRefit.ts`'s.
 *
 *   long-man line   a MEASUREMENT of the league as it stands: the innings per appearance of its longest-working sixth of relievers this
 *                   season (a quantile, policy), served as measured once enough relievers can be measured (never blended with the
 *                   starting 1.6, so what is checked is what is served), and never below what "multiple innings" means (then the line
 *                   stays at that, with its own reason). Leagues differ: the Arizona import's own game works its relievers about a
 *                   quarter longer than the real seasons it imported, so the starting line called a fifth of its relievers long men.
 *                   Served only when the same quantile drawn from half the clubs, steadily across halvings, and from the first half of
 *                   the season's games, leaves about the same share of the rest at or above it.
 *   leverage lines  policy on the league's own scale: rescaled only when the league's mean leverage is off 1.0 beyond the tolerance.
 *
 * The lines are measured and served WITH the reliever standards (`standards-2`): the standards are measured on the tiers these lines
 * give, so the two are in force together or not at all. When a new measurement does not hold up, the refit keeps the line in force (and
 * measures the standards under it), so one failed import never flips the league back to the starting line.
 */

import type { CalibrationCheck } from './saveCalibrationStore.js';
import { BULLPEN_PRIOR, leverageLines, MIN_APPEARANCES, MULTI_INNING, type BullpenLines } from './bullpenRoles.js';

/** POLICY. The long-man line's quantile, minimums and checks. */
export const LONG_LINE_POLICY = {
  /** The line is at this quantile of relievers' innings per appearance: the longest-working sixth are long men (below high leverage). */
  quantile: 0.85,
  /** Relievers with the minimum appearances needed to measure it; below it the starting line serves (never a blend of the two). */
  minRelievers: 150,
  /** The club split: halvings (a fixed seed, so a refit is repeatable). */
  splits: 400,
  seed: 20260925,
  /** Pooled over the halvings, the other half's share at or above the half-line must be within this of the quantile's (bias). */
  tolerance: 0.05,
  /** ...and in at least `stableShare` of the halvings it must be within `stableTolerance` (stability: a noisy line fails). */
  stableTolerance: 0.1,
  stableShare: 0.9,
  /** The season split: appearances in each half of the season's game dates (half the minimum the tiers need), and its tolerance. */
  minHalfAppearances: MIN_APPEARANCES / 2,
  /** Relievers with those appearances needed in each half for the season split to be read at all. */
  minHalfRelievers: 50,
  timeTolerance: 0.06,
} as const;

export type LongLinePolicy = typeof LONG_LINE_POLICY;

/**
 * One reliever of a club's active pen this season: his appearances and innings (all of them, starts included, as his tier counts them),
 * and the same split by half of the season's game dates where the game logs say.
 */
export interface RelieverUsage {
  playerId: number;
  clubId: number;
  g: number;
  ip: number;
  /** Appearances and innings in the first and second half of the season's game dates; null when the export cannot split the season. */
  halves: { first: { g: number; ip: number }; second: { g: number; ip: number } } | null;
}

/** Why the long-man line serves what it does (the hover's reason, and the record's). */
export type LongLineReason =
  | 'measured'      // the league's own quantile, checked
  | 'rarely_long'   // measured, but under what "multiple innings" means: the line stays at that
  | 'relievers'     // too few relievers to measure
  | 'check_failed'; // measured, but it did not hold up on the clubs or the part of the season it was not drawn from

export interface LongLineMeasurement {
  /** The lines this measurement would serve (before the refit decides whether an earlier line stays in force instead). */
  lines: BullpenLines;
  /** The quantile measured on every reliever: what serves when the checks pass and it is at least the multi-inning line. */
  measured: number | null;
  relievers: number;
  checks: CalibrationCheck[];
  /** Whether the measurement itself is served (its checks passed and it was not floored). */
  passed: boolean;
  reason: LongLineReason;
  /** Whether the season split could be run (the export's game logs cover the season), and why not when it could not. */
  seasonSplit: 'passed' | 'failed' | 'not_measured';
  seasonSplitWhy: string | null;
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

const atOrAbove = (xs: number[], line: number) => xs.filter((x) => x >= line).length;

/**
 * Measure the long-man line on the league's active relievers and check it, and derive the leverage lines from the league's mean leverage.
 * What is checked is what is served: the line is the quantile as measured (no pull toward the starting line), and each check draws the
 * same quantile on part of the league and asks that it leave the quantile's share (15%) of the rest at or above it.
 */
export function measureLongLine(usage: RelieverUsage[], leagueLeverage: number | null, policyIn: LongLinePolicy = LONG_LINE_POLICY, halvesWhy: string | null = null): LongLineMeasurement {
  const lev = leverageLines(leagueLeverage);
  const read = usage.filter((u) => u.g >= MIN_APPEARANCES && u.g > 0);
  const values = read.map((u) => u.ip / u.g);
  const measured = quantile(values, policyIn.quantile);
  const expected = 1 - policyIn.quantile;
  const notes: string[] = [
    `The long-man line is the innings per appearance of the league's longest-working ${Math.round(expected * 100)}% of relievers this season (the clubs' active relievers with ${MIN_APPEARANCES} or more appearances, starts included as their roles count them), served as measured once ${policyIn.minRelievers} relievers can be measured, and never below ${MULTI_INNING}, what "multiple innings" means.`,
    leagueLeverage === null
      ? 'The league\'s mean leverage is not in the export: the leverage lines serve as written.'
      : lev.rescaled
        ? `The league's mean leverage per batter faced is ${leagueLeverage.toFixed(3)}, off 1.0 by more than the tolerance: the leverage lines are scaled to it.`
        : `The league's mean leverage per batter faced is ${leagueLeverage.toFixed(3)}, within the tolerance of 1.0: the leverage lines serve as written.`,
  ];
  const starting: BullpenLines = { ...BULLPEN_PRIOR, leverage: lev.leverage, rescaled: lev.rescaled, leagueLeverage };
  if (read.length < policyIn.minRelievers || measured === null) {
    notes.push(`Not measured: ${read.length} relievers have ${MIN_APPEARANCES} or more appearances, fewer than ${policyIn.minRelievers}. The starting line serves.`);
    return { lines: starting, measured, relievers: read.length, checks: [], passed: false, reason: 'relievers', seasonSplit: 'not_measured', seasonSplitWhy: 'too few relievers to measure', notes };
  }
  // Club split: the quantile drawn from half the clubs against the other half's relievers, each halving kept for the stability check
  const clubs = [...new Set(read.map((u) => u.clubId))];
  const rnd = generator(policyIn.seed);
  let n = 0;
  let above = 0;
  const shares: number[] = [];
  for (let i = 0; i < policyIn.splits; i += 1) {
    const order = clubs.map((c) => ({ c, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.c);
    const train = new Set(order.slice(0, Math.floor(order.length / 2)));
    const line = quantile(read.filter((u) => train.has(u.clubId)).map((u) => u.ip / u.g), policyIn.quantile);
    const held = read.filter((u) => !train.has(u.clubId)).map((u) => u.ip / u.g);
    if (line === null || held.length === 0) continue;
    n += held.length;
    above += atOrAbove(held, line);
    shares.push(atOrAbove(held, line) / held.length);
  }
  const clubShare = n > 0 ? above / n : null;
  const stable = shares.length ? shares.filter((x) => Math.abs(x - expected) <= policyIn.stableTolerance).length / shares.length : null;
  const sorted = [...shares].sort((a, b) => a - b);
  const band = sorted.length ? `${Math.round((quantile(sorted, 0.05) as number) * 100)}-${Math.round((quantile(sorted, 0.95) as number) * 100)}%` : '—';
  const checks: CalibrationCheck[] = [
    {
      kind: 'club_split', part: 'long_line', n: Math.round(n / policyIn.splits), expected, observed: clubShare,
      passed: clubShare === null ? null : Math.abs(clubShare - expected) <= policyIn.tolerance,
      note: 'Share of the other half\'s relievers at or above the line drawn from half the clubs, pooled over the halvings.',
    },
    {
      kind: 'club_split_stability', part: 'long_line', n: shares.length, expected: policyIn.stableShare, observed: stable,
      passed: stable === null ? null : stable >= policyIn.stableShare,
      note: `Share of the halvings whose other half had ${Math.round(expected * 100)}% ± ${Math.round(policyIn.stableTolerance * 100)} at or above the half-line (5th to 95th percentile of that share: ${band}).`,
    },
  ];
  // Season split: the same quantile, on the same appearances, from the first half of the season's game dates, against the second half
  const halves = read.filter((u) => u.halves !== null);
  const perHalf = (pick: 'first' | 'second') => halves
    .map((u) => (u.halves as NonNullable<RelieverUsage['halves']>)[pick])
    .filter((h) => h.g >= policyIn.minHalfAppearances).map((h) => h.ip / h.g);
  const first = perHalf('first');
  const second = perHalf('second');
  const firstLine = quantile(first, policyIn.quantile);
  let seasonSplit: LongLineMeasurement['seasonSplit'] = 'not_measured';
  let seasonSplitWhy: string | null = null;
  // The true reason when it cannot run: the export cannot split the season, or it can but a half has too few relievers to read
  const thin = ([['first', first.length], ['second', second.length]] as const).find(([, k]) => k < policyIn.minHalfRelievers);
  if (halves.length === 0 || firstLine === null || thin) {
    seasonSplitWhy = halves.length === 0
      ? halvesWhy ?? 'the export does not split this season\'s appearances by game'
      : `only ${thin ? thin[1] : 0} relievers have ${policyIn.minHalfAppearances} or more appearances in the ${thin ? thin[0] : 'first'} half of the season, fewer than ${policyIn.minHalfRelievers}`;
    checks.push({ kind: 'season_split', part: 'long_line', n: 0, expected, observed: null, passed: null, note: `Not measured: ${seasonSplitWhy}.` });
  } else {
    const share = atOrAbove(second, firstLine) / second.length;
    const ok = Math.abs(share - expected) <= policyIn.timeTolerance;
    seasonSplit = ok ? 'passed' : 'failed';
    checks.push({
      kind: 'season_split', part: 'long_line', n: second.length, expected, observed: share, passed: ok,
      note: `Share of the second half's relievers at or above the line drawn from the first half (${firstLine.toFixed(2)} on ${first.length} relievers), each with ${policyIn.minHalfAppearances} or more appearances in the half.`,
    });
  }
  const failed = checks.filter((c) => c.passed === false);
  if (failed.length || checks[0].passed === null) {
    notes.push(`Measured at ${measured.toFixed(2)}, but it did not hold up ${failed.map((c) => (c.kind === 'season_split' ? 'on the second half of the season' : c.kind === 'club_split_stability' ? 'steadily from one half of the clubs to the other' : 'on the clubs it was not drawn from')).join(' or ') || 'on the clubs it was not drawn from'}.`);
    return { lines: starting, measured, relievers: read.length, checks, passed: false, reason: 'check_failed', seasonSplit, seasonSplitWhy, notes };
  }
  if (measured < MULTI_INNING) {
    // Not "the league's own longest-working sixth": the league's relievers rarely work multiple innings, and a long man is one who does
    notes.push(`Measured at ${measured.toFixed(2)}: this league's relievers rarely work multiple innings, so a long man is still one who averages ${MULTI_INNING} or more.`);
    return { lines: { ...starting, long: MULTI_INNING }, measured, relievers: read.length, checks, passed: false, reason: 'rarely_long', seasonSplit, seasonSplitWhy, notes };
  }
  notes.push(`Measured and served at ${measured.toFixed(2)} on ${read.length} relievers.`);
  return {
    lines: { leverage: lev.leverage, rescaled: lev.rescaled, leagueLeverage, long: measured, multiInning: MULTI_INNING, source: 'save' },
    measured, relievers: read.length, checks, passed: true, reason: 'measured', seasonSplit, seasonSplitWhy, notes,
  };
}

/**
 * The long-man line the reliever standards are measured under, and so served with (recorded in `standards-2`), with how it came about:
 *
 *   measured     this export's measurement held up and is at least the multi-inning line
 *   rarely_long  this export's measurement held up but is under the multi-inning line: the line stays at it
 *   carried      this export's measurement did not hold up (or could not be made): the league's own line in force stays, with the
 *                measurement it came from, so one failed import never flips the league back to the starting line (supervisor's call)
 *   starting     no line of the league's own is in force and this export's did not hold up: the starting line
 */
export interface BullpenRecord {
  lines: BullpenLines;
  basis: 'measured' | 'rarely_long' | 'carried' | 'starting';
  /** The measurement the line in force comes from: its export's game date, the quantile, the relievers and the season split. */
  measuredOn: string | null;
  measured: number | null;
  relievers: number;
  seasonSplit: LongLineMeasurement['seasonSplit'];
  seasonSplitWhy: string | null;
  /** This export's own attempt (the same as the above when measured here). */
  attempt: { gameDate: string | null; measured: number | null; relievers: number; reason: LongLineReason };
}

/** Which line the standards are measured under after this export's measurement, given the record in force before it. */
export function lineInForce(m: LongLineMeasurement, previous: BullpenRecord | null, gameDate: string | null): BullpenRecord {
  const attempt = { gameDate, measured: m.measured, relievers: m.relievers, reason: m.reason };
  const here = { measuredOn: gameDate, measured: m.measured, relievers: m.relievers, seasonSplit: m.seasonSplit, seasonSplitWhy: m.seasonSplitWhy, attempt };
  if (m.reason === 'measured' || m.reason === 'rarely_long') return { lines: m.lines, basis: m.reason, ...here };
  if (previous && previous.lines.source === 'save') {
    // The league's own line stays in force; the leverage lines are this export's derivation (they rest on this season's leverage)
    return {
      lines: { ...previous.lines, leverage: m.lines.leverage, rescaled: m.lines.rescaled, leagueLeverage: m.lines.leagueLeverage },
      basis: 'carried', measuredOn: previous.measuredOn, measured: previous.measured, relievers: previous.relievers,
      seasonSplit: previous.seasonSplit, seasonSplitWhy: previous.seasonSplitWhy, attempt,
    };
  }
  return { lines: m.lines, basis: 'starting', ...here };
}
