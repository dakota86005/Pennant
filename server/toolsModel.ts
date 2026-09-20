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

import { calibrated, type CalibrationStamp } from './calibration.js';

export const TOOLS_MODEL_CALIBRATION: CalibrationStamp = calibrated(
  'Slopes fitted by weighted least squares on major-league wOBA over three result windows (2018-2019, 2021-2022, 2023-2025) with a per-window intercept; the split and running models fitted separately.'
);

export type ToolValues = Readonly<Record<'contact' | 'gap' | 'power' | 'eye' | 'avoidK', number | null>>;
export type RunningValues = Readonly<Record<'speed' | 'baserunning' | 'stealing', number | null>>;

/** CALIBRATED. wOBA points per rating point (20-80 scale). Strikeout avoidance is zero: it adds nothing once the others are known. */
export const HITTER_TOOL_SLOPES = { contact: 0.00155, gap: 0.00033, power: 0.00122, eye: 0.00086, avoidK: 0 } as const;

/** CALIBRATED. Runs per 600 plate appearances per rating point of speed, baserunning and stealing ability. */
export const RUNNING_SLOPES = { speed: 0.0354, baserunning: 0.0237, stealing: 0.0241 } as const;

/**
 * Expected wOBA above the league from the five tools, up to a constant that drops out when a hitter is
 * ranked against peers (rank the raw value, or centre it on the population mean). Null unless all five
 * tools are known.
 */
export function expectedWobaRaw(tools: ToolValues): number | null {
  let total = 0;
  for (const key of Object.keys(HITTER_TOOL_SLOPES) as Array<keyof typeof HITTER_TOOL_SLOPES>) {
    const value = tools[key];
    if (value === null || value === undefined) return null;
    total += HITTER_TOOL_SLOPES[key] * value;
  }
  return total;
}

/** Expected baserunning runs per 600 PA, up to a constant; null unless speed, baserunning and stealing are all known. */
export function expectedRunningRaw(running: RunningValues): number | null {
  let total = 0;
  for (const key of Object.keys(RUNNING_SLOPES) as Array<keyof typeof RUNNING_SLOPES>) {
    const value = running[key];
    if (value === null || value === undefined) return null;
    total += RUNNING_SLOPES[key] * value;
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

export function ratingPlatoon(vsLeft: ToolValues, vsRight: ToolValues): RatingPlatoon {
  const l = expectedWobaRaw(vsLeft);
  const r = expectedWobaRaw(vsRight);
  return { vsLeft: l, vsRight: r, effect: l !== null && r !== null ? r - l : null };
}

/** The mean of a population's raw expectations, to centre a hitter on the league. */
export function centred(value: number | null, population: number[]): number | null {
  if (value === null || population.length === 0) return null;
  return value - population.reduce((s, v) => s + v, 0) / population.length;
}
