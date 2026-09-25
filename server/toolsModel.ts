/**
 * What a hitter's visible tools say about his results: the tools lens, weighted by what the tools
 * actually predict.
 *
 * An unweighted average of five tools treats strikeout avoidance like contact. Calibration
 * (docs/CALIBRATION.md, `scripts/calibrate.ts` section 3) shows they are not alike: across three
 * windows of major-league results, contact, power and eye carry the bat, gap is a small addition and
 * strikeout avoidance adds nothing once the rest are known. This module turns the five tools into an
 * EXPECTED wOBA ABOVE THE LEAGUE with those slopes, so the tools lens and the results lens are
 * measured in the same unit.
 *
 * It is pure arithmetic on numbers handed to it; it reads no table and no rating column. The
 * numbers come from `scoutedEvidence.ts` (D-017, D-035). A missing tool makes the expectation
 * unknown (D-018): it is never averaged around.
 *
 * The same slopes apply to a hitter's rating SPLITS (tools against left- and right-handed
 * pitching): the split model fitted separately gave the same slopes, and the split ratings predict
 * results against that hand better than the overall ratings do. So the platoon prior is the model
 * applied to each side.
 *
 * Running: the running ratings explain about 43% of baserunning runs; the model gives expected
 * runs per 600 plate appearances.
 */

import { provisional, type CalibrationStamp } from './calibration.js';

/**
 * PROVISIONAL (the fallback prior; D-053, cycle 4). Run 1 fitted these slopes on the Arizona import by weighted least squares on
 * major-league wOBA over three result windows (2018-2019, 2021-2022, 2023-2025) with a per-window intercept, the split and running
 * models separately. That was a SAME-TIME fit (ratings observed now against results from before them, which OOTP formed the ratings
 * from), on one save, so under D-053 it is the starting value, not a calibration. Whether visible tools forecast results needs ratings
 * stored before a season and that season's results (`mlbToolsFit.ts`, `tools-1`); cycle 4's same-season engine check on the one
 * season OOTP simulated from these ratings (2026 to date) found a refit no better than these slopes on held-out players.
 */
export const TOOLS_MODEL_CALIBRATION: CalibrationStamp = provisional(
  'Run 1\'s same-time fit on the Arizona import (slopes by weighted least squares on major-league wOBA, 2018-2025, per-window intercepts; the split and running models separately): the starting value until a save\'s own ratings are checked as a forecast (`tools-1`).'
);

export type ToolValues = Readonly<Record<'contact' | 'gap' | 'power' | 'eye' | 'avoidK', number | null>>;
export type RunningValues = Readonly<Record<'speed' | 'baserunning' | 'stealing', number | null>>;

/** PROVISIONAL (run 1's same-time fit). wOBA points per rating point (20-80 scale). Strikeout avoidance is zero: it added nothing once the others were known. */
export const HITTER_TOOL_SLOPES = { contact: 0.00155, gap: 0.00033, power: 0.00122, eye: 0.00086, avoidK: 0 } as const;

/**
 * PROVISIONAL (run 1's same-time fit, on stolen-base runs alone: past seasons carry no UBR). Runs per 600 plate appearances per rating
 * point of speed, baserunning and stealing ability. On 2026, the one season with UBR, these slopes under-state the spread about 2.7 times;
 * not fittable per save until ratings of baserunning and stealing are stored before a season (`rating_snapshots`, cycle 4).
 */
export const RUNNING_SLOPES = { speed: 0.0354, baserunning: 0.0237, stealing: 0.0241 } as const;

/**
 * The tools model's tuning in force for a save (D-053, cycle 4): the slopes of the bat and of running. Always passed in, never read from a
 * default: `TOOLS_PRIOR` (the starting values) until a save's own ratings, stored before a season, are clearly better at forecasting
 * that season (`mlbToolsFit.ts`, `tools-1`); the reader in force is `toolsCalibration.ts` `toolsParamsFor`.
 */
export interface ToolsParams {
  slopes: Readonly<Record<keyof typeof HITTER_TOOL_SLOPES, number>>;
  running: Readonly<Record<keyof typeof RUNNING_SLOPES, number>>;
  /** Whether the bat's slopes are the save's own (clearly better on its forward seasons) or the starting values. */
  source: 'save' | 'starting';
  stamp: CalibrationStamp;
}

/** PROVISIONAL (the fallback prior): run 1's slopes. */
export const TOOLS_PRIOR: ToolsParams = { slopes: HITTER_TOOL_SLOPES, running: RUNNING_SLOPES, source: 'starting', stamp: TOOLS_MODEL_CALIBRATION };

/** A stable key for a set of tools params (caches keyed by it never serve one set's populations under another). */
export const toolsParamsKey = (p: ToolsParams): string => JSON.stringify([p.slopes, p.running]);

/**
 * Expected wOBA above the league from the five tools, up to a constant that drops out when a hitter is
 * ranked against peers (rank the raw value, or centre it on the population mean). Null unless all five
 * tools are known.
 */
export function expectedWobaRaw(tools: ToolValues, params: ToolsParams): number | null {
  let total = 0;
  for (const key of Object.keys(HITTER_TOOL_SLOPES) as Array<keyof typeof HITTER_TOOL_SLOPES>) {
    const value = tools[key];
    if (value === null || value === undefined) return null;
    total += params.slopes[key] * value;
  }
  return total;
}

/** Expected baserunning runs per 600 PA, up to a constant; null unless speed, baserunning and stealing are all known. */
export function expectedRunningRaw(running: RunningValues, params: ToolsParams): number | null {
  let total = 0;
  for (const key of Object.keys(RUNNING_SLOPES) as Array<keyof typeof RUNNING_SLOPES>) {
    const value = running[key];
    if (value === null || value === undefined) return null;
    total += params.running[key] * value;
  }
  return total;
}

export interface RatingPlatoon {
  /** Expected wOBA (raw, same constant on both sides) against left- and right-handed pitching. */
  vsLeft: number | null;
  vsRight: number | null;
  /** Against right-handers minus against left-handers, in wOBA points; null unless both sides are fully known. */
  effect: number | null;
}

export function ratingPlatoon(vsLeft: ToolValues, vsRight: ToolValues, params: ToolsParams): RatingPlatoon {
  const l = expectedWobaRaw(vsLeft, params);
  const r = expectedWobaRaw(vsRight, params);
  return { vsLeft: l, vsRight: r, effect: l !== null && r !== null ? r - l : null };
}

/** The mean of a population's raw expectations, to centre a hitter on the league. */
export function centred(value: number | null, population: number[]): number | null {
  if (value === null || population.length === 0) return null;
  return value - population.reduce((s, v) => s + v, 0) / population.length;
}

export type BatTool = keyof typeof HITTER_TOOL_SLOPES;

export interface ToolContribution {
  tool: BatTool;
  rating: number;
  /** wOBA points this tool adds to (or takes from) an average hitter: the slope times the rating's distance from 50. */
  points: number;
}

/**
 * What each visible tool contributes to the expected wOBA, against an average (50) tool. The expectation is a straight sum of these, so
 * they explain it completely: a contact-first hitter and a power-first hitter with the same total are different players, and this is
 * how the difference is shown. Null unless every tool is visible (a missing tool is never averaged around, D-018).
 */
export function toolContributions(tools: ToolValues, params: ToolsParams): ToolContribution[] | null {
  const out: ToolContribution[] = [];
  for (const tool of Object.keys(HITTER_TOOL_SLOPES) as BatTool[]) {
    const rating = tools[tool];
    if (rating === null || rating === undefined) return null;
    out.push({ tool, rating, points: Math.round(params.slopes[tool] * (rating - 50) * 1000 * 10) / 10 });
  }
  return out;
}

/**
 * POLICY (cycle 4: the share is policy, the spread is the league's). A tool is named as what a hitter is built on (or lacks) when it adds
 * (or takes) at least this share of a standard deviation of the tools' total among the league's major-league hitters. Run 1 wrote 9
 * points; on the Arizona import the spread is 18.4 points, so the derived line is 9.2 and no hitter's words change.
 */
export const PROFILE_SHARE = 0.5;
/** POLICY. Peer hitters with every tool visible needed before the spread is read; with fewer, no profile words are given (unknown). */
export const PROFILE_MIN_PEERS = 30;

/**
 * The wOBA points (tenths kept) a tool must move to be named, derived from the peers' spread of the tools' total under the params in
 * force: `PROFILE_SHARE` of its standard deviation. Null (no profile words, never "no standout") when too few peers can be read.
 */
export function profileMinPoints(peerRaws: readonly number[]): number | null {
  if (peerRaws.length < PROFILE_MIN_PEERS) return null;
  const mean = peerRaws.reduce((n, v) => n + v, 0) / peerRaws.length;
  const sd = Math.sqrt(peerRaws.reduce((n, v) => n + (v - mean) ** 2, 0) / peerRaws.length);
  return Math.round(PROFILE_SHARE * sd * 1000 * 10) / 10;
}

const TOOL_WORD: Record<BatTool, string> = { contact: 'contact', gap: 'gap power', power: 'power', eye: 'plate discipline', avoidK: 'strikeout avoidance' };

/**
 * A plain-words profile of the bat from its contributions: what it leans on and what it lacks. It names only tools that move the expectation
 * (strikeout avoidance never does), and says "no standout" rather than inventing a description for an ordinary bat.
 */
export function describeBat(contributions: ToolContribution[] | null, minPoints: number | null): { leans: string[]; lacks: string[]; text: string } | null {
  // No spread among the peers (or none read) says nothing about what stands out: no words, never "no standout"
  if (!contributions || minPoints === null || !(minPoints > 0)) return null;
  // A tool the model in force gives no weight contributes 0 points and so is never named (strikeout avoidance, under the starting slopes)
  const movers = contributions;
  const leans = movers.filter((c) => c.points >= minPoints).sort((a, b) => b.points - a.points).map((c) => TOOL_WORD[c.tool]);
  const lacks = movers.filter((c) => c.points <= -minPoints).sort((a, b) => a.points - b.points).map((c) => TOOL_WORD[c.tool]);
  const text = leans.length === 0 && lacks.length === 0
    ? 'No tool stands out either way.'
    : `${leans.length ? `Built on ${leans.join(' and ')}` : 'No tool carries the bat'}${lacks.length ? `${leans.length ? ', ' : '; '}short on ${lacks.join(' and ')}` : ''}.`;
  return { leans, lacks, text };
}
