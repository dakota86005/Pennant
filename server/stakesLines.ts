/**
 * Player Development: the ceiling lines of the developmental-stakes model, per save (D-050 as amended, D-053; cycle 4 of the
 * per-save calibration, docs/CALIBRATION.md section 15).
 *
 * The ceiling is a player's organization-visible potential read against three lines: the composite of the weakest tenth, the median
 * and the best tenth of his league's major leaguers of his kind (`CEILING_QUANTILES`, policy). Those lines were constants taken from
 * one import. They are a MEASUREMENT of the league as it stands, so they are measured at each import from the export's own major
 * leaguers, checked, and served as measured:
 *
 *   measured   the nearest-rank tenth, median and best tenth of the active major leaguers' current composite, by kind: an actual
 *              composite value, so a line is a value a player can have and "clears" means what it meant. No pull toward the starting
 *              lines: what is checked is what is served.
 *   checked    400 seeded halvings of the clubs. Lines drawn from half the clubs must bracket the policy share of the other half's major
 *              leaguers: the share strictly under a line at most q + 5 points, the share at or under it at least q − 5 (composites are
 *              integers and ties are many: about a fifth of pitchers sit exactly on the median line), pooled over the halvings (bias)
 *              and in at least 90% of them within 10 points (stability).
 *   minimums   10 clubs, and 100 major leaguers of the kind with a visible composite. A league under them (a small or fictional one)
 *              keeps Pennant's starting lines, labelled as such.
 *   in force   a measurement that does not hold up keeps the lines in force (the league's own from an earlier import, else the
 *              starting lines): one failed import never flips the tiers back.
 *
 * What the lines read is an objective description of the league's major leaguers at the import: no player's own result, usage,
 * philosophy, Player Value or MLB Operations answer. A man's tier can change at an import only because the league's major leaguers
 * changed, for everyone alike, and his reasons then say so. Player Development's defensibility judgments do not read the lines.
 *
 * Pure except `stakesLinesFor` (a read of the stored measurement). The reads for the measurement are `stakesLinesRefit.ts`'s.
 */

import { startingLines, type CeilingLines, type CeilingLinesInForce } from './developmentFit.js';
import { adoptedCalibration, latestCalibrationAttempt, type CalibrationCheck, type CalibrationRecord } from './saveCalibrationStore.js';
import { leagueGameDate } from './saveIdentity.js';
import { parseGameDate } from './dataFreshness.js';

export { startingLines };
export type { CeilingLinesInForce };

export const STAKES_SUBSYSTEM = 'player_development';
export const STAKES_LINES_COMPONENT = 'ceiling_lines';
export const STAKES_LINES_METHOD = 'stakes-lines-1';

/** POLICY. The measurement's quantiles are `CEILING_QUANTILES` (developmentFit.ts); these are its minimums and checks. */
export const STAKES_LINES_POLICY = {
  quantiles: { fringe: 0.1, regular: 0.5, impact: 0.9 },
  minClubs: 10,
  minPlayers: 100,
  splits: 400,
  seed: 20260925,
  /** Pooled over the halvings: strictly under at most q + tolerance, at or under at least q − tolerance. */
  tolerance: 0.05,
  /** Stability: in at least `stableShare` of the halvings both conditions hold within `stableTolerance`. */
  stableTolerance: 0.1,
  stableShare: 0.9,
} as const;

export type LineKind = keyof CeilingLines;
export type LineName = keyof CeilingLines['hitter'];
const LINE_NAMES: LineName[] = ['fringe', 'regular', 'impact'];
const KINDS: LineKind[] = ['hitter', 'pitcher'];

/** One active major leaguer of the league: his club and his current visible composite, by kind. */
export interface MajorLeaguer {
  clubId: number;
  kind: LineKind;
  composite: number;
}

/** What is stored per import: the measurement, the lines in force after it, and the lines in force before it. */
export interface StakesLinesModel {
  /** This import's measured lines (null for a kind that could not be measured). */
  measured: Record<LineKind, CeilingLines['hitter'] | null>;
  players: Record<LineKind, number>;
  clubs: number;
  passed: boolean;
  /** The lines in force after this import (a measurement that did not hold up carries the league's own in force, else the starting). */
  inForce: CeilingLinesInForce;
}

/** Nearest-rank quantile: an actual value of the population, the ⌈q·n⌉-th smallest. */
export function nearestRank(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const linesOf = (values: number[]): CeilingLines['hitter'] | null => {
  const f = nearestRank(values, STAKES_LINES_POLICY.quantiles.fringe);
  const r = nearestRank(values, STAKES_LINES_POLICY.quantiles.regular);
  const i = nearestRank(values, STAKES_LINES_POLICY.quantiles.impact);
  return f === null || r === null || i === null ? null : { fringe: f, regular: r, impact: i };
};

const sameLines = (a: CeilingLines, b: CeilingLines): boolean =>
  KINDS.every((k) => LINE_NAMES.every((n) => a[k][n] === b[k][n]));

/**
 * Measure the ceiling lines on the league's active major leaguers and check them. `previous` is the lines in force before this import
 * (the stored measurement at or before it, or the starting lines): a measurement that does not hold up keeps them.
 */
export function measureCeilingLines(
  players: MajorLeaguer[], basis: { leagueId: number; gameDate: string | null; throughSeason: number | null }, previous: CeilingLinesInForce,
  policy: typeof STAKES_LINES_POLICY = STAKES_LINES_POLICY
): { model: StakesLinesModel; record: CalibrationRecord } {
  const clubs = [...new Set(players.map((p) => p.clubId))];
  const byKind = (k: LineKind) => players.filter((p) => p.kind === k && Number.isFinite(p.composite));
  const counts = { hitter: byKind('hitter').length, pitcher: byKind('pitcher').length };
  const measured = { hitter: linesOf(byKind('hitter').map((p) => p.composite)), pitcher: linesOf(byKind('pitcher').map((p) => p.composite)) };
  const checks: CalibrationCheck[] = [];
  const failures: string[] = [];
  const notes: string[] = [
    'The ceiling lines are the nearest-rank tenth, median and best tenth of the current visible composite of the league\'s active major leaguers, by kind, measured at each import and served as measured once checked.',
  ];
  const thin = clubs.length < policy.minClubs || KINDS.some((k) => counts[k] < policy.minPlayers);
  if (thin) {
    const why = clubs.length < policy.minClubs
      ? `${clubs.length} clubs, fewer than ${policy.minClubs}`
      : KINDS.filter((k) => counts[k] < policy.minPlayers).map((k) => `${counts[k]} major-league ${k}s with a visible composite, fewer than ${policy.minPlayers}`).join('; ');
    failures.push(`players: ${why}`);
    notes.push(`Not measured: ${why}.`);
  } else {
    // Club split: lines drawn from half the clubs against the other half's major leaguers, tie-aware
    const rnd = generator(policy.seed);
    type Tally = { under: number; atOrUnder: number; n: number; stable: number; halvings: number };
    const tally: Record<string, Tally> = {};
    for (const k of KINDS) for (const n of LINE_NAMES) tally[`${k}:${n}`] = { under: 0, atOrUnder: 0, n: 0, stable: 0, halvings: 0 };
    for (let i = 0; i < policy.splits; i += 1) {
      const order = clubs.map((c) => ({ c, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.c);
      const train = new Set(order.slice(0, Math.floor(order.length / 2)));
      for (const k of KINDS) {
        const own = byKind(k);
        const lines = linesOf(own.filter((p) => train.has(p.clubId)).map((p) => p.composite));
        const held = own.filter((p) => !train.has(p.clubId)).map((p) => p.composite);
        if (!lines || held.length === 0) continue;
        for (const n of LINE_NAMES) {
          const q = policy.quantiles[n];
          const under = held.filter((c) => c < lines[n]).length;
          const atOrUnder = held.filter((c) => c <= lines[n]).length;
          const t = tally[`${k}:${n}`];
          t.under += under; t.atOrUnder += atOrUnder; t.n += held.length; t.halvings += 1;
          if (under / held.length <= q + policy.stableTolerance && atOrUnder / held.length >= q - policy.stableTolerance) t.stable += 1;
        }
      }
    }
    for (const k of KINDS) {
      for (const n of LINE_NAMES) {
        const q = policy.quantiles[n];
        const t = tally[`${k}:${n}`];
        const under = t.n ? t.under / t.n : null;
        const atOrUnder = t.n ? t.atOrUnder / t.n : null;
        const brackets = under !== null && atOrUnder !== null && under <= q + policy.tolerance && atOrUnder >= q - policy.tolerance;
        checks.push({
          kind: 'club_split', part: `${k}:${n}`, n: Math.round(t.n / Math.max(1, t.halvings)), expected: q, observed: under,
          passed: under === null ? null : brackets,
          note: `The other half's share strictly under the half-line ${under === null ? '—' : (under * 100).toFixed(1)}%, at or under it ${atOrUnder === null ? '—' : (atOrUnder * 100).toFixed(1)}% (the policy share ${Math.round(q * 100)}% must lie between them, within ${Math.round(policy.tolerance * 100)} points), pooled over ${t.halvings} halvings.`,
        });
        const stable = t.halvings ? t.stable / t.halvings : null;
        checks.push({
          kind: 'club_split_stability', part: `${k}:${n}`, n: t.halvings, expected: policy.stableShare, observed: stable,
          passed: stable === null ? null : stable >= policy.stableShare,
          note: `${stable === null ? '—' : (stable * 100).toFixed(0)}% of the halvings had the half-line bracket the policy share within ${Math.round(policy.stableTolerance * 100)} points (at least ${Math.round(policy.stableShare * 100)}% needed).`,
        });
      }
    }
    for (const c of checks) if (c.passed !== true) failures.push(`${c.kind}: ${c.part}`);
  }
  const passed = failures.length === 0 && measured.hitter !== null && measured.pitcher !== null;
  let inForce: CeilingLinesInForce;
  if (passed) {
    const lines: CeilingLines = { hitter: measured.hitter as CeilingLines['hitter'], pitcher: measured.pitcher as CeilingLines['pitcher'] };
    // Lines that did not move keep the earlier move's record (when it happened); lines that moved record this import as the move
    const before = sameLines(lines, previous.lines)
      ? previous.previous
      : { lines: previous.lines, source: previous.source, measuredOn: previous.measuredOn, replacedOn: basis.gameDate };
    inForce = { lines, source: 'save', reason: 'measured', measuredOn: basis.gameDate, previous: before };
    notes.push(`Measured and served: hitters ${lines.hitter.fringe} / ${lines.hitter.regular} / ${lines.hitter.impact}, pitchers ${lines.pitcher.fringe} / ${lines.pitcher.regular} / ${lines.pitcher.impact} (${counts.hitter} and ${counts.pitcher} major leaguers, ${clubs.length} clubs).`);
  } else if (previous.source === 'save') {
    inForce = { ...previous, reason: 'carried' };
    notes.push(`This import's measurement did not hold up; the league's own lines measured on ${previous.measuredOn} stay in force.`);
  } else {
    inForce = startingLines(thin ? 'players' : 'check_failed');
    notes.push(thin ? 'Pennant\'s starting lines serve.' : 'The measurement did not hold up; Pennant\'s starting lines serve.');
  }
  const record: CalibrationRecord = {
    leagueId: basis.leagueId, subsystem: STAKES_SUBSYSTEM, component: STAKES_LINES_COMPONENT, method: STAKES_LINES_METHOD,
    basis: { throughSeason: null, gameDate: basis.gameDate },
    window: { seasons: basis.throughSeason === null ? [] : [basis.throughSeason + 1], skipped: [], sample: counts.hitter + counts.pitcher, unit: 'active major leaguers' },
    heldOut: checks,
    priorWeight: { overall: inForce.source === 'save' ? 0 : 1, byPart: { hitter: inForce.source === 'save' ? 0 : 1, pitcher: inForce.source === 'save' ? 0 : 1 } },
    // A measurement that did not hold up is recorded as such (never adopted), and the lines in force before it stay in force
    gate: { passed, reason: passed ? 'Measured, and it held up on the clubs it was not drawn from.' : `Not served: ${failures.join('; ') || 'a kind could not be measured'}.`, failures },
    priorSource: 'Pennant\'s starting lines (developmentFit.ts CEILING_LINES): the tenth, median and best tenth of the active major leaguers of the Arizona import (2026-5-16).',
    notes,
  };
  return { model: { measured, players: counts, clubs: clubs.length, passed, inForce }, record };
}

/**
 * The ceiling lines in force for a league: its latest adopted measurement at or before the export's game date (a reverted save never
 * serves a later export's), else Pennant's starting lines with the true reason. Null league: the starting lines, "no_league".
 */
export function stakesLinesFor(leagueId: number | null): CeilingLinesInForce {
  if (leagueId === null) return startingLines('no_league');
  const today = leagueGameDate(leagueId);
  const bound = { gameDateMax: today };
  const adopted = adoptedCalibration<StakesLinesModel>(leagueId, STAKES_SUBSYSTEM, STAKES_LINES_COMPONENT, STAKES_LINES_METHOD, bound);
  const latest = latestCalibrationAttempt<StakesLinesModel>(leagueId, STAKES_SUBSYSTEM, STAKES_LINES_COMPONENT, STAKES_LINES_METHOD, bound);
  const inForce = adopted?.model?.inForce && latest?.basis === adopted.basis
    ? adopted.model.inForce
    // The latest attempt did not hold up: it recorded what stayed in force (the league's own carried, or the starting lines)
    : latest?.model?.inForce ?? adopted?.model?.inForce ?? startingLines('not_measured');
  // The lines they replaced are served only on the export the move was measured on: later, his own ratings may have moved too, so a
  // tier can no longer be said to have changed because of the lines alone (review finding B2)
  const onThisExport = inForce.measuredOn !== null && today !== null && parseGameDate(today) === parseGameDate(inForce.measuredOn);
  return onThisExport && inForce.previous?.replacedOn === inForce.measuredOn ? inForce : { ...inForce, previous: null };
}
