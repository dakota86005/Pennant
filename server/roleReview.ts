/**
 * The scouting read on a role holder: is he good enough for the job, and how
 * sure are we?
 *
 * Two independent lenses, never silently merged:
 *
 *   ratings   the organization-visible tools against MLB peers (Player
 *             Development's destination fit): what he is capable of
 *   results   what he has actually done, league-relative and recency weighted
 *             (`resultsMetrics.ts`): what he has shown
 *
 * A **working estimate** blends them for comparison, with the weight on results
 * set by how much sample stands behind them (a pitcher with 35 innings this year
 * and two full seasons before it is read mostly on results; a Triple-A arm with
 * no major-league innings is read on his tools alone). The estimate is always
 * shown WITH its lenses, its weight and its basis; it is a way to compare two
 * players, not a score that replaces the reasoning.
 *
 * A finding is a flag for a GM's attention. It says which case it is (both lenses
 * weak, tools weak but results fine, results weak but tools fine, too early),
 * how strong, the competing explanations, and what would change the read. It is
 * never a transaction trigger. Unknown stays unknown: a holder with no evidence
 * on either lens is "cannot judge", never weak.
 *
 * PROVISIONAL CALIBRATION (declared here and nowhere else): the results mix for
 * pitchers, the concern thresholds and the aging age. First-pass figures, not
 * fitted; every finding carries `calibration`.
 */

import type { BullpenTier } from './bullpenRoles.js';
import { policy, provisional, type CalibrationStamp } from './calibration.js';
import { reliability, STABILIZATION } from './resultsMetrics.js';
import type { RoleStandard } from './roleStandards.js';
import type { ToolContribution } from './toolsModel.js';
import { MEANINGFUL_GAP, ordinal } from './roleStanding.js';

export const REVIEW_CALIBRATION: CalibrationStamp = policy(
  'The concern thresholds (how low is a concern, how large a gap is a divergence) are policy judgments, not fitted; the pitcher results mix and the running blend are calibrated or derived; the aging curve and the glove weights are the save\'s own once they pass their checks, else provisional fallback priors (see each declaration).'
);

/**
 * CALIBRATED. How a pitcher's results percentile is formed. Backtest (scripts/calibrate.ts section 2): peripherals
 * (strikeouts, walks, home runs) predict NEXT season's runs allowed at least as well as past runs allowed do, for starters
 * and relievers alike (best share 0.9 to 1.0), so runs allowed keep a small share for what peripherals miss.
 */
export const PITCHER_RESULTS_MIX = { skills: 0.85, runs: 0.15 } as const;

/**
 * THE FALLBACK PRIOR (provisional since D-053, cycle 1). A save fits its own curve on its own history (`mlbCalibrationFit.ts
 * fitAging`, served as an `AgingTable` once it passes its held-out check); these rows serve until then. `concernAge` is POLICY: when a
 * decline is raised as a risk, not how aging works. Originally: what aging does, from the league's own history (section 5): the mean change in league-relative production
 * from one season to the next, by age. Hitters, in wOBA points a year; pitchers, in runs per nine of FIP (positive is
 * worse). Piecewise: the first row whose age the player has reached applies.
 */
export const AGING_CURVE: CalibrationStamp & { concernAge: number; hitter: ReadonlyArray<readonly [number, number]>; pitcher: ReadonlyArray<readonly [number, number]> } = {
  ...provisional('The fallback prior (D-053, cycle 1): the delta method on consecutive seasons of 300+ PA/BF, ages 22-40, weighted by the smaller sample, on the Arizona import\'s 2000-2025 history (harness section 5). A save serves its own curve once it passes its check; this is never presented as the save\'s own.'),
  concernAge: 34,
  hitter: [[34, -0.0095], [30, -0.0065], [26, -0.003]],
  pitcher: [[35, 0.2], [28, 0.12]],
};

/**
 * An aging curve as a table: the expected annual change at each age from `firstAge` (hitters in wOBA, pitchers in FIP runs per nine),
 * the end values holding beyond it. The save's own fit is served this way (`mlbCalibrationFit.ts`); `AGING_CURVE` above is the
 * fallback prior.
 */
export interface AgingTable {
  firstAge: number;
  hitter: number[];
  pitcher: number[];
}

/**
 * The expected annual change at an age (hitters: wOBA a year, negative is decline; pitchers: FIP runs per nine, positive is decline):
 * from the save's fitted table when one is in force, else the built-in rows (0 below the first row).
 */
export function expectedAnnualChange(age: number, pitcher: boolean, table: AgingTable | null = null): number {
  if (table) {
    const values = pitcher ? table.pitcher : table.hitter;
    if (values.length > 0) return values[Math.min(Math.max(Math.round(age) - table.firstAge, 0), values.length - 1)];
  }
  const rows = pitcher ? AGING_CURVE.pitcher : AGING_CURVE.hitter;
  for (const [from, change] of rows) if (age >= from) return change;
  return 0;
}

/** PROVISIONAL CALIBRATION. When a working estimate counts as a concern. */
export const CONCERN = {
  /** Below this estimate (percentile of MLB peers) a holder is a concern in any group. */
  absoluteEstimate: 35,
  /** Or: the weakest of his group and at least this many points under the group's median. */
  groupGap: MEANINGFUL_GAP,
  /** Below this trust in results the read is "too early", not a finding. */
  minReliability: 0.35,
  /** Results-to-peripherals gap (percentile points) large enough to call luck a competing explanation. */
  luckGap: 20,
  /** Tools-to-results gap (percentile points) large enough to say results are ahead of or behind the tools. */
  divergenceGap: 20,
  /** From this age decline is a stated risk, not a lens (the step-up in the aging curve). */
  agingAge: AGING_CURVE.concernAge,
} as const;

export const DEFENSE_CALIBRATION: CalibrationStamp = provisional(
  'The fallback prior (D-053, cycle 1): a save fits its own weights from the repeatable spread of fielding results once two seasons in a row carry zone rating and a later season checks them (mlbCalibrationFit.ts fitDefense). Each weight is the average of a data-derived share and the earlier first-pass figure. The derived share is the position\'s defensive talent spread (the slope of zone-rating runs on the visible glove grade, times the spread of grades) over that plus the bat\'s, from one partial season; averaging with the prior keeps one season from moving it all the way.'
);

/**
 * How much of a position player's value is his defense at the position (the rest is the bat and, a little, running). A
 * designated hitter's is zero. Derived shares from scripts/calibrate.ts section 7 (C .42, 1B .18, 2B .38, 3B .31, SS .42,
 * LF .38, CF .51, RF .40) averaged with the earlier priors (.40, .05, .30, .25, .35, .10, .30, .20). Still PROVISIONAL: one
 * partial season of zone ratings; re-run the harness as the season grows.
 */
export const DEFENSE_WEIGHT: Record<number, number> = { 2: 0.41, 3: 0.12, 4: 0.34, 5: 0.28, 6: 0.39, 7: 0.24, 8: 0.41, 9: 0.3, 10: 0 };

/**
 * POLICY. The share of a position's value that is glove from which an unseen glove makes a comparison less than firm: at these
 * positions (every fielding position but first base) a hitter whose glove is not visible is judged on part of the job, and a
 * comparison that leans on him says so.
 */
export const GLOVE_MATTERS = 0.2;

/**
 * PROVISIONAL, DERIVED. The share of a hitter's estimate that is baserunning. The spread of baserunning runs among regulars is
 * about 1.4 runs per 600 PA (section 6) against the bat's 10 to 15, so it is a small part of value in this game; 0.05.
 */
export const RUNNING_WEIGHT = 0.05;

/** The sample at which a glove's results and its visible grade count equally: results are shrunk toward the grade (r^2 about .4, section 7). */
export const DEFENSE_INFORMATION = 0.4;
/** The same for baserunning: the running ratings explain .43 of baserunning runs (section 6). */
export const RUNNING_INFORMATION = 0.43;

export interface DefenseLens {
  /** His visible fielding grade at the position against MLB peers listed there (a percentile); null when the grade is not revealed. */
  pct: number | null;
  /** The visible grade itself, 20-80. */
  grade: number | null;
  /** True when the game shows a grade for him at this position. */
  visible: boolean;
  /** What he has actually done there (zone-rating runs, plus framing for a catcher), ranked among the league's fielders at the position. */
  resultsPct?: number | null;
  /** Runs per 1300 innings behind that percentile, and the innings it rests on. */
  resultsPer1300?: number | null;
  resultsInnings?: number;
}

/** A hitter's baserunning: what his running ratings imply and what he has done. */
export interface RunningLens {
  /** Speed, baserunning and stealing ability on the 20-80 scale (a mean); null unless all three are visible. */
  ability: number | null;
  /** Where his running ratings put him among MLB hitters (expected baserunning runs); null when not fully visible. */
  toolsPct: number | null;
  /** Baserunning runs per 600 PA (UBR and stolen bases) ranked among hitters. */
  resultsPct: number | null;
  perSixHundred: number | null;
  sample: number;
}

export interface LensEvidence {
  /** The position a hitter is judged at (2 catcher ... 9 right field, 10 DH); absent for a pitcher. */
  position?: number;
  /** A hitter's defense at that position: a second dimension beside his bat, weighted by the position. */
  defense?: DefenseLens;
  /** A hitter's running, a third dimension beside bat and glove. */
  running?: RunningLens;
  /** How the tools percentile was formed: the calibrated tools model (expected wOBA) or Player Development's composite. */
  toolsBasis?: 'model' | 'composite';
  /** For a hitter, the wOBA above the league his visible tools imply. */
  toolsExpected?: number | null;
  /** For a hitter, what each visible tool adds to that expectation and a plain-words profile of the bat; null when a tool is not visible. */
  toolsProfile?: { contributions: ToolContribution[]; leans: string[]; lacks: string[]; text: string } | null;
  ratingsPct: number | null;
  ratingsEvidence: 'complete' | 'partial' | 'unknown';
  /** Underlying results (peripherals / bat results) percentile among peers. */
  skillsPct: number | null;
  /** Runs-allowed percentile among peers (pitchers only). */
  runsPct: number | null;
  /** Effective sample behind the multi-season results, and how far to trust it as his level (0 to 1). */
  sample: number;
  sampleUnit: 'PA' | 'BF';
  reliability: number;
  /** This season's sample in the same unit, when he has one. */
  currentSample: number | null;
  /** How he is used (innings per start, leverage, saves and holds): facts that say how much the role matters, not lenses. */
  usage?: string[];
  /** For a reliever: this season's appearances, innings, saves, holds and average leverage, from which his role is read. */
  bullpen?: { g: number; ip: number; sv: number; hld: number; leverage: number | null };
}

export interface Estimate {
  /** For a hitter: the bat-only estimate, and the glove and running dimensions that were combined with it. */
  batValue?: number | null;
  defensePct?: number | null;
  runningPct?: number | null;
  /** Share of the estimate that comes from the glove (0 to 1); 0 when defense does not count. */
  weightOnDefense?: number;
  /** Share that comes from running (0 to 1); 0 when he has no running evidence. */
  weightOnRunning?: number;
  value: number | null;
  ratingsPct: number | null;
  resultsPct: number | null;
  /** Share of the estimate that comes from results (0 to 1). */
  weightOnResults: number;
  basis: 'ratings_and_results' | 'ratings_only' | 'results_only' | 'none';
}

export function resultsPercentile(e: Pick<LensEvidence, 'skillsPct' | 'runsPct'>, pitcher: boolean): number | null {
  if (e.skillsPct !== null && e.runsPct !== null && pitcher) return PITCHER_RESULTS_MIX.skills * e.skillsPct + PITCHER_RESULTS_MIX.runs * e.runsPct;
  return e.skillsPct ?? e.runsPct;
}

/**
 * A dimension of a hitter (his glove, his running) formed from the tools view and the results view: results count by how far the
 * sample can be trusted against the tools (`information` is the share of the truth the tools explain, so less sample is needed).
 * With results alone the value is pulled toward the middle by the sample, so a thin glove result never reads as certain.
 */
function blendDimension(tools: number | null, results: number | null, sample: number, stabilization: number, information: number): { value: number; weightOnResults: number } | null {
  if (tools === null && results === null) return null;
  if (results === null) return { value: tools as number, weightOnResults: 0 };
  if (tools === null) {
    const w = reliability(sample, stabilization);
    return { value: 50 + w * (results - 50), weightOnResults: w };
  }
  const w = reliability(sample, stabilization * (1 - information));
  return { value: w * results + (1 - w) * tools, weightOnResults: w };
}

export function defenseValue(d: DefenseLens | undefined): { value: number; weightOnResults: number } | null {
  if (!d) return null;
  return blendDimension(d.visible ? d.pct : null, d.resultsPct ?? null, d.resultsInnings ?? 0, STABILIZATION.defense, DEFENSE_INFORMATION);
}

export function runningValue(r: RunningLens | undefined): { value: number; weightOnResults: number } | null {
  if (!r) return null;
  return blendDimension(r.toolsPct, r.resultsPct, r.sample, STABILIZATION.baserunning, RUNNING_INFORMATION);
}

/**
 * A hitter's working estimate: bat, glove at his position and running, blended by the position's glove weight. `defenseWeights` is
 * the save's fitted set when one is in force, else the built-in `DEFENSE_WEIGHT` (the fallback prior).
 */
export function estimateOf(e: LensEvidence, pitcher = true, defenseWeights: Record<number, number> = DEFENSE_WEIGHT): Estimate {
  const core = batOrPitchEstimate(e, pitcher);
  if (pitcher || e.position === undefined) return core;
  const def = defenseValue(e.defense);
  const run = runningValue(e.running);
  const wd = def && core.value !== null ? defenseWeights[e.position] ?? 0 : 0;
  const wr = run && core.value !== null ? RUNNING_WEIGHT : 0;
  if (core.value === null) return { ...core, batValue: null, defensePct: def?.value ?? null, runningPct: run?.value ?? null, weightOnDefense: 0, weightOnRunning: 0 };
  const value = (1 - wd - wr) * core.value + wd * (def?.value ?? 0) + wr * (run?.value ?? 0);
  return { ...core, batValue: core.value, defensePct: def?.value ?? null, runningPct: run?.value ?? null, weightOnDefense: wd, weightOnRunning: wr, value };
}

function batOrPitchEstimate(e: LensEvidence, pitcher: boolean): Estimate {
  const results = resultsPercentile(e, pitcher);
  const ratings = e.ratingsPct;
  if (ratings === null && results === null) return { value: null, ratingsPct: null, resultsPct: null, weightOnResults: 0, basis: 'none' };
  if (ratings === null) return { value: results, ratingsPct: null, resultsPct: results, weightOnResults: 1, basis: 'results_only' };
  if (results === null) return { value: ratings, ratingsPct: ratings, resultsPct: null, weightOnResults: 0, basis: 'ratings_only' };
  const w = Math.max(0, Math.min(1, e.reliability));
  return { value: w * results + (1 - w) * ratings, ratingsPct: ratings, resultsPct: results, weightOnResults: w, basis: 'ratings_and_results' };
}

// ── a holder within his group ───────────────────────────────────────────────

export interface ReviewSubject extends LensEvidence {
  playerId: number;
  name: string;
  age: number | null;
}

export type FindingKind =
  | 'ratings_and_results_weak'
  | 'weak_estimate'
  | 'tools_weak_results_fine'
  | 'results_weak_tools_fine'
  | 'too_early'
  | 'no_concern'
  | 'cannot_judge';

export type CaseStrength = 'strong' | 'moderate' | 'watch' | 'none';

export interface ConcernTrace {
  rule: 'below_deep_floor' | 'below_role_floor' | 'below_absolute' | 'weakest_in_group' | 'none';
  /** His working estimate, the level it was compared with, and the margin over it (negative is below). Null when no comparison applied. */
  estimate: number | null;
  threshold: number | null;
  margin: number | null;
}

export interface HolderReview {
  playerId: number;
  name: string;
  age: number | null;
  estimate: Estimate;
  /** 1 = highest working estimate in the group. */
  rank: number | null;
  groupSize: number;
  groupMedian: number | null;
  /** Points below the group's median; negative when above. */
  belowMedian: number | null;
  isWeakest: boolean;
  kind: FindingKind;
  strength: CaseStrength;
  /** What the finding rests on, in words. */
  reasons: string[];
  /** Competing explanations a scout would raise: luck, sample, age, results ahead of tools. */
  explanations: string[];
  /** What would move the read either way. */
  wouldChange: string[];
  /** How he is used, as stated facts. */
  usage: string[];
  /** What his group is called ('starting pitcher', 'lineup regular'). */
  group: string;
  /** How much the role matters where it is measured (a high-leverage reliever); absent when nothing says. */
  stakes?: 'high' | 'medium' | 'low' | null;
  /**
   * The peer standard his concern was measured against and where he stands on it (points above the floor; negative is below).
   * Absent when no standard was supplied and the fallback rule applied.
   */
  standard?: (RoleStandard & { margin: number }) | null;
  /** Which rule raised the finding, as data: the trace a reader (or a test) follows without reconstructing the logic from prose. */
  concern: ConcernTrace;
  /** For a reliever: the role his usage shows (closer, high-leverage arm, middle, long man ...). */
  tier?: BullpenTier | null;
  evidence: LensEvidence;
  calibration: typeof REVIEW_CALIBRATION;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const r0 = (n: number) => Math.round(n);
const POSITION_NAME: Record<number, string> = { 2: 'catcher', 3: 'first base', 4: 'second base', 5: 'third base', 6: 'shortstop', 7: 'left field', 8: 'center field', 9: 'right field', 10: 'designated hitter' };

/** The save's fitted numbers a review uses where they are in force (else the built-in fallback priors). */
export interface ReviewCalibration {
  aging?: AgingTable | null;
  defenseWeights?: Record<number, number> | null;
}

export function reviewGroup(holders: ReviewSubject[], opts: { pitcher: boolean; role: string; standard?: (h: ReviewSubject) => RoleStandard | null; calibration?: ReviewCalibration | null }): HolderReview[] {
  const weights = opts.calibration?.defenseWeights ?? DEFENSE_WEIGHT;
  const aging = opts.calibration?.aging ?? null;
  const estimates = new Map(holders.map((h) => [h.playerId, estimateOf(h, opts.pitcher, weights)]));
  const known = holders.filter((h) => estimates.get(h.playerId)!.value !== null);
  const values = known.map((h) => estimates.get(h.playerId)!.value as number);
  const groupMedian = median(values);
  const ratingsMedian = median(known.map((h) => h.ratingsPct).filter((v): v is number => v !== null));
  const resultsMedian = median(known.map((h) => estimates.get(h.playerId)!.resultsPct).filter((v): v is number => v !== null));
  const weakestValue = values.length ? Math.min(...values) : null;

  return holders.map((h): HolderReview => {
    const est = estimates.get(h.playerId)!;
    const base = {
      playerId: h.playerId, name: h.name, age: h.age, estimate: est, groupSize: known.length, groupMedian, evidence: h,
      usage: h.usage ?? [], group: opts.role, calibration: REVIEW_CALIBRATION,
    };
    if (est.value === null) {
      return {
        ...base, rank: null, belowMedian: null, isWeakest: false, kind: 'cannot_judge', strength: 'none', standard: null,
        concern: { rule: 'none' as const, estimate: null, threshold: null, margin: null },
        reasons: ['There is no visible rating and no qualifying results to judge him on.'], explanations: [],
        wouldChange: ['A visible tool rating, or a larger sample of major-league results.'],
      };
    }
    const value = est.value;
    const rank = 1 + known.filter((o) => (estimates.get(o.playerId)!.value as number) > value).length;
    const belowMedian = groupMedian === null ? null : groupMedian - value;
    const isWeakest = weakestValue !== null && value === weakestValue && known.length > 1;
    // A concern is measured against the ROLE when a peer standard is supplied (the league's holders of his job): being the weakest
    // of nine, or under one absolute line, says nothing about a first baseman that it does not also say about a shortstop.
    const std = opts.standard?.(h) ?? null;
    const margin = std ? value - std.floor : null;
    // Each lens against its own line for the role (owner decision 2026-09-24): the built-in line until the save has measured the lens
    const lensLow = (pct: number | null, line: number | undefined, groupMed: number | null) => pct !== null && (std ? pct < (line ?? std.lensFloor) : groupMed !== null && pct < groupMed);
    const ratingsLow = lensLow(h.ratingsPct, std?.lensFloors?.tools, ratingsMedian);
    const resultsLow = lensLow(est.resultsPct, std?.lensFloors?.results, resultsMedian);
    const lowAbs = value < CONCERN.absoluteEstimate;
    const lowRel = isWeakest && belowMedian !== null && belowMedian >= CONCERN.groupGap;
    const belowFloor = margin !== null && margin < 0;
    const belowDeep = std !== null && value < std.deepFloor;
    const concerned = std ? belowFloor : lowAbs || lowRel;
    const concern: ConcernTrace = std
      ? { rule: belowDeep ? 'below_deep_floor' : belowFloor ? 'below_role_floor' : 'none', estimate: value, threshold: belowDeep ? std.deepFloor : std.floor, margin: belowDeep ? value - std.deepFloor : margin }
      : { rule: lowAbs ? 'below_absolute' : lowRel ? 'weakest_in_group' : 'none', estimate: value, threshold: CONCERN.absoluteEstimate, margin: value - CONCERN.absoluteEstimate };
    const standardOut = std && margin !== null ? { ...std, margin } : null;

    const reasons: string[] = [];
    const explanations: string[] = [];
    const wouldChange: string[] = [];
    const lens = [
      h.ratingsPct !== null ? `tools ${ordinal(h.ratingsPct)} percentile${!std && ratingsMedian !== null ? ` (group median ${ordinal(ratingsMedian)})` : ''}` : 'no visible tool rating',
      est.resultsPct !== null ? `results ${ordinal(est.resultsPct)} (${r0(h.sample)} ${h.sampleUnit} of weighted sample, trusted ${r0(h.reliability * 100)}% as his level${!std && resultsMedian !== null ? `; group median ${ordinal(resultsMedian)}` : ''})` : 'no qualifying results',
    ];
    reasons.push(`${lens.join('; ')}.`);
    if (!opts.pitcher && est.batValue !== undefined && est.batValue !== null && ((est.weightOnDefense ?? 0) > 0 || (est.weightOnRunning ?? 0) > 0)) {
      const parts = [`bat ${ordinal(est.batValue)}`];
      if ((est.weightOnDefense ?? 0) > 0 && est.defensePct !== null && est.defensePct !== undefined) {
        const d = h.defense;
        const detail = d?.visible && d.resultsPct != null ? ` (visible grade ${ordinal(d.pct ?? 0)}, results ${ordinal(d.resultsPct)} over ${r0(d.resultsInnings ?? 0)} innings)` : d?.resultsPct != null ? ` (results only, ${r0(d.resultsInnings ?? 0)} innings)` : '';
        parts.push(`glove ${ordinal(est.defensePct)} at his position${detail}, ${Math.round((est.weightOnDefense ?? 0) * 100)}% of the estimate`);
      }
      if ((est.weightOnRunning ?? 0) > 0 && est.runningPct !== null && est.runningPct !== undefined) parts.push(`running ${ordinal(est.runningPct)}, ${Math.round((est.weightOnRunning ?? 0) * 100)}%`);
      reasons.push(`${parts.join('; ')}.`);
    }
    if (std && margin !== null) {
      // "This league's" only when the save's own standards are in force; otherwise the starting yardstick is named as such
      const typicalText = std.source === 'save'
        ? `In this league, ${std.label} typically work at a working estimate of about ${r0(std.typical)}`
        : `${std.label.charAt(0).toUpperCase()}${std.label.slice(1)} typically work at a working estimate of about ${r0(std.typical)} (Pennant's starting yardstick)`;
      reasons.push(`${typicalText}; below ${r0(std.floor)} is unusually weak and below ${r0(std.deepFloor)} well below what the job takes. He is at ${ordinal(value)}, ${margin < 0 ? `${r0(-margin)} under the first line` : `${r0(margin)} above it`}.`);
    }
    if (groupMedian !== null) reasons.push(`Working estimate ${ordinal(value)} percentile of MLB ${opts.role}s${est.basis === 'ratings_and_results' ? ` (${r0(est.weightOnResults * 100)}% results, ${r0((1 - est.weightOnResults) * 100)}% tools)` : est.basis === 'ratings_only' ? ' (tools only: no results to weigh)' : ' (results only: no visible tools)'}; ${isWeakest ? 'the weakest' : `number ${rank}`} of ${known.length} in the group.`);

    // competing explanations, stated whichever way the read goes
    if (opts.pitcher && h.skillsPct !== null && h.runsPct !== null && h.skillsPct - h.runsPct >= CONCERN.luckGap) {
      explanations.push(`His runs allowed (${ordinal(h.runsPct)}) are well behind his strikeouts, walks and home runs (${ordinal(h.skillsPct)}): sequencing, defense or ballpark may be costing him, and that tends to correct.`);
    }
    if (opts.pitcher && h.skillsPct !== null && h.runsPct !== null && h.runsPct - h.skillsPct >= CONCERN.luckGap) {
      explanations.push(`His runs allowed (${ordinal(h.runsPct)}) are ahead of his peripherals (${ordinal(h.skillsPct)}): he may be getting help that will not last.`);
    }
    if (h.ratingsPct !== null && est.resultsPct !== null && est.resultsPct - h.ratingsPct >= CONCERN.divergenceGap) {
      explanations.push(`His results (${ordinal(est.resultsPct)}) are well ahead of his visible tools (${ordinal(h.ratingsPct)}): he is outproducing what the tools suggest, which either reflects something the ratings miss or will regress.`);
    }
    if (h.ratingsPct !== null && est.resultsPct !== null && h.ratingsPct - est.resultsPct >= CONCERN.divergenceGap) {
      explanations.push(`His results (${ordinal(est.resultsPct)}) are well behind his visible tools (${ordinal(h.ratingsPct)}): he is underperforming what the tools suggest, which may correct.`);
    }
    if (h.currentSample !== null && h.currentSample < (opts.pitcher ? 100 : 100)) {
      explanations.push(`This season is ${r0(h.currentSample)} ${h.sampleUnit} old: too early to read the year on its own, so the read leans on prior seasons.`);
    }
    if (h.age !== null && h.age >= CONCERN.agingAge) {
      const signed = expectedAnnualChange(h.age, opts.pitcher, aging);
      const change = Math.abs(signed);
      // A league whose history shows no decline at his age is said so, never "lost about 0" (the save's own fit can show it)
      const declines = opts.pitcher ? signed > 0.005 : signed < -0.0005;
      // "In this league's history" only when the save's own curve is in force; the starting curve is a general expectation
      const who = opts.pitcher ? 'pitchers' : 'hitters';
      const loss = opts.pitcher ? `${change.toFixed(2)} runs per nine a year on peripherals` : `${Math.round(change * 1000)} points of wOBA a year`;
      if (!declines) explanations.push(`At ${h.age}, age is a risk the ratings and past results may not yet show, though ${aging ? `in this league's history ${who} his age have shown` : `${who} his age usually show`} no measurable decline from one season to the next.`);
      else explanations.push(`At ${h.age}, decline is a risk that the ratings and past results may not yet show: ${aging ? `in this league's history ${who} his age have lost about ${loss}` : `${who} his age usually lose about ${loss}`}.`);
    }
    if (h.ratingsEvidence !== 'complete' && h.ratingsPct !== null) {
      explanations.push('His visible tool ratings are incomplete, so the tools lens rests on part of the picture.');
    }
    if (!opts.pitcher && h.position !== undefined && (weights[h.position] ?? 0) > 0) {
      const d = h.defense;
      if (!d || !d.visible || d.pct === null) {
        explanations.push(`His defense at ${POSITION_NAME[h.position] ?? 'the position'} is not visible, so the estimate is his bat alone and may miss what he gives with the glove.`);
      } else if (est.batValue !== undefined && est.batValue !== null && d.pct - est.batValue >= CONCERN.divergenceGap) {
        explanations.push(`His glove (${ordinal(d.pct)} percentile at ${POSITION_NAME[h.position]}) is well ahead of his bat (${ordinal(est.batValue)}): the position, not the bat, is what he is worth.`);
      } else if (est.batValue !== undefined && est.batValue !== null && est.batValue - d.pct >= CONCERN.divergenceGap) {
        explanations.push(`His bat (${ordinal(est.batValue)}) is well ahead of his glove (${ordinal(d.pct)} percentile at ${POSITION_NAME[h.position]}): a defensive risk that the bat has to carry.`);
      }
    }
    wouldChange.push(
      h.reliability < 0.6 ? 'A larger sample of major-league results would firm up the read.' : 'A change in his visible tools or a sustained change in results.',
    );

    let kind: FindingKind = 'no_concern';
    let strength: CaseStrength = 'none';
    if (concerned) {
      if (h.reliability < CONCERN.minReliability) { kind = 'too_early'; strength = 'watch'; }
      else if (ratingsLow && resultsLow) { kind = 'ratings_and_results_weak'; strength = std ? (belowDeep ? 'strong' : 'moderate') : lowAbs && isWeakest ? 'strong' : 'moderate'; }
      else if (ratingsLow && !resultsLow) { kind = 'tools_weak_results_fine'; strength = 'watch'; }
      else if (!ratingsLow && resultsLow) { kind = 'results_weak_tools_fine'; strength = 'watch'; }
      else { kind = 'weak_estimate'; strength = std && !belowDeep ? 'watch' : 'moderate'; }
    }
    return { ...base, rank, belowMedian, isWeakest, kind, strength, reasons, explanations, wouldChange, standard: standardOut, concern };
  });
}

// ── candidate against incumbent ─────────────────────────────────────────────

export type ReplacementVerdict = 'clear_upgrade' | 'upgrade_uncertain' | 'marginal' | 'sidegrade' | 'downgrade' | 'cannot_judge';

export interface ReplacementComparison {
  verdict: ReplacementVerdict;
  /** Candidate estimate minus incumbent estimate; null when either is unknown. */
  delta: number | null;
  /** The two working estimates behind the delta, so a report can say how good the replacement is in absolute terms. */
  candidateEstimate: number | null;
  incumbentEstimate: number | null;
  toolsDelta: number | null;
  resultsDelta: number | null;
  /** How firm the candidate's own read is: adequate (tools and results), limited (one lens), thin (partial tools). */
  certainty: 'adequate' | 'limited' | 'thin';
  reasons: string[];
  calibration: typeof REVIEW_CALIBRATION;
}

export function compareReplacement(candidate: ReviewSubject, incumbent: ReviewSubject, pitcher = true, defenseWeights: Record<number, number> = DEFENSE_WEIGHT): ReplacementComparison {
  const c = estimateOf(candidate, pitcher, defenseWeights);
  const i = estimateOf(incumbent, pitcher, defenseWeights);
  const base = { calibration: REVIEW_CALIBRATION };
  if (c.value === null || i.value === null) {
    return { ...base, verdict: 'cannot_judge', delta: null, candidateEstimate: c.value, incumbentEstimate: i.value, toolsDelta: null, resultsDelta: null, certainty: 'thin', reasons: [c.value === null ? `${candidate.name} has no evidence on either lens.` : `${incumbent.name} has no evidence on either lens.`] };
  }
  const delta = c.value - i.value;
  const toolsDelta = c.ratingsPct !== null && i.ratingsPct !== null ? c.ratingsPct - i.ratingsPct : null;
  const resultsDelta = c.resultsPct !== null && i.resultsPct !== null ? c.resultsPct - i.resultsPct : null;
  const incompleteTools = candidate.ratingsEvidence === 'partial' || (candidate.ratingsEvidence === 'unknown' && c.basis !== 'results_only');
  // A glove that is not visible at a position that is largely glove leaves part of the job unread on that side of the comparison.
  const gloveUnseen = (s: ReviewSubject) => !pitcher && s.position !== undefined && (defenseWeights[s.position] ?? 0) >= GLOVE_MATTERS && defenseValue(s.defense) === null;
  const unseen = [candidate, incumbent].filter(gloveUnseen);
  const certainty: ReplacementComparison['certainty'] = incompleteTools
    ? 'thin'
    : c.basis === 'ratings_and_results' && candidate.reliability >= CONCERN.minReliability && unseen.length === 0 ? 'adequate' : 'limited';

  let verdict: ReplacementVerdict;
  if (delta >= MEANINGFUL_GAP) verdict = certainty === 'adequate' ? 'clear_upgrade' : 'upgrade_uncertain';
  else if (delta >= MEANINGFUL_GAP / 2) verdict = 'marginal';
  else if (delta > -MEANINGFUL_GAP / 2) verdict = 'sidegrade';
  else verdict = 'downgrade';

  const reasons = [
    `${candidate.name}: working estimate ${ordinal(c.value)} percentile${c.basis === 'ratings_only' ? ' on tools alone' : c.basis === 'results_only' ? ' on results alone' : ''}; ${incumbent.name}: ${ordinal(i.value)} (${delta >= 0 ? '+' : ''}${r0(delta)}).`,
    ...(toolsDelta !== null ? [`Tools: ${ordinal(c.ratingsPct as number)} against ${ordinal(i.ratingsPct as number)}.`] : []),
    ...(resultsDelta !== null ? [`Results: ${ordinal(c.resultsPct as number)} against ${ordinal(i.resultsPct as number)}.`] : c.resultsPct === null ? [`${candidate.name} has no qualifying major-league results, so this rests on his tools.`] : []),
    ...unseen.map((s) => `${s.name}'s glove at ${POSITION_NAME[s.position as number] ?? 'the position'} is not visible, and that position is about ${Math.round((defenseWeights[s.position as number] ?? 0) * 100)}% glove: that side of the comparison is his bat alone.`),
    ...(verdict === 'upgrade_uncertain' ? [`The gain is real on paper but the read on ${candidate.name} rests on ${certainty === 'thin' ? 'incomplete tools' : unseen.length ? 'a bat with no glove to weigh against it' : 'one lens'}, so it is not firm.`] : []),
  ];
  return { ...base, verdict, delta, candidateEstimate: c.value, incumbentEstimate: i.value, toolsDelta, resultsDelta, certainty, reasons };
}
