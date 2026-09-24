/**
 * Player Value, concern 2's cost bands (phase 4a): the cost of the controlled seasons no contract covers
 * (PLAYER_VALUE.md Parts 2.2 and 4.4).
 *
 * Pure. Two answers live here, both measured on the save at each import and never assumed:
 *
 *   the cost ladder     `measureCostLadder`, from this import's cross-section of contracts:
 *                       - the renewal spread: a pre-arbitration one-year renewal costs from the league
 *                         minimum to the 90% upper confidence bound of the 90th percentile of the save's
 *                         own renewals (COST_POLICY.renewal), its central the median renewal;
 *                       - the arbitration ladder, by class: what the save pays an arbitration-class player on
 *                         a one-year deal above the minimum, against the mean WAR of the two seasons before
 *                         the arbitration winter (the platform), read as a robust (Theil–Sen) line in this
 *                         import's dollars: a base (pay at no platform wins) and a pay per platform win, with
 *                         the class's spread around the line (10th to 90th percentile) and the line's own
 *                         uncertainty from a bootstrap of the same fit (phase 4a review).
 *                       A class thinner than the policy minimum has no line of its own: it is the provisional
 *                       prior (COST_PRIOR, the same method on the imported real-world contracts) hulled with the
 *                       range the save paid the class, only where the regime as read is MLB's; elsewhere it is
 *                       unknown. A league with no arbitration, or whose arbitration rule is not read, has no ladder.
 *   the priced timeline `priceControlTimeline`, which fills each pre-arbitration, arbitration and open
 *                       season of a control timeline: a renewal from the spread; an arbitration season from
 *                       its class(es), its platform seasons' production (projected where they are future,
 *                       the export's WAR where past), every corner of the interval taken (interval
 *                       arithmetic), never a point and never assumed to be the league minimum; the save's own
 *                       line is in this import's dollars, and only the prior's shares carry the price of a
 *                       win's band; an open season across each status it could be; a season that may be free
 *                       agency, or a branch the player decides, as what he costs if held, saying so. Every priced
 *                       band carries a central inside it, or, between statuses, each status's central. An
 *                       arbitration season is never below the player's previous season's salary where it is known
 *                       (owner-attested, 2026-09-24; Player Rights' `arbitrationSalaryFloor`): this season's
 *                       contract salary for next season, the season before's low edge after that, so a held
 *                       player's arbitration low edges never fall; what he costs if tendered, the non-tender said.
 *   the club's sum      `combineProjectedCosts` (owner, 2026-09-24): the players' seasons combined for Payroll, each
 *                       player's distance from his central on each side as independent across players (root sum of
 *                       squares), what is not noise (between statuses, a range of classes, may leave) at its edges.
 *
 * Status, class and trip are Player Rights' answers (`standing`, `trip`, `tripIfEligible`, `serviceClass`,
 * `arbitrationRegimeOf`); nothing here compares service with a threshold. Production arrives as Player
 * Value's own production answer: nothing here reads a rating, `players_value`, philosophy, the protection
 * tier or defensibility. Describes, never authorizes (D-052).
 */

import type { CalibrationStamp } from './calibration.js';
import {
  COST_COMBINATION_POLICY, COST_COMBINATION_POLICY_CALIBRATION, COST_NOT_PRICED, COST_POLICY, COST_POLICY_CALIBRATION, COST_PRIOR,
  COST_PRIOR_CALIBRATION, OPENING_PRICE_MINIMUMS,
} from './playerValueCalibration.js';
import { arbitrationSalaryFloor, type ArbitrationRegime, type SeasonControlEligibility } from './playerRights.js';
import type { ControlSeason, ControlStatus, ControlTimeline, CostBand, CostBasis } from './playerValueControl.js';
import type { MarketCandidate, PriceBand, SeasonWar } from './playerValueFinances.js';
import type { PlayerProduction } from './playerValueProduction.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';

// ── the ladder's shape ───────────────────────────────────────────────────────

/**
 * One reading of a class's line: the save's own (in this import's dollars), or the provisional prior's (in this
 * save's money, its rung a share of the price of a win).
 */
export interface CostReading {
  source: 'save' | 'prior';
  /** The contracts the line was read on (the prior's own count for the prior). */
  cases: number;
  /** Pay above the minimum at no platform wins (dollars). */
  base: number;
  /**
   * Pay per platform win: in dollars for the save's own line (read on this import's salaries), as a share of the
   * price of a win's central for the prior; `sd` is the rung's own uncertainty (bootstrap) in the same unit.
   */
  perWin: { unit: 'dollars' | 'share'; value: number; sd: number };
  /** Per platform win as a share of the price of a win's central, for display; null where the price is unknown. */
  share: number | null;
  /** The class's pay around its line: its 10th and 90th percentile residuals (dollars). */
  spread: { low: number; high: number };
  /** The line's own uncertainty from the bootstrap: its level's standard deviation at `center` (dollars) and its correlation with the rung. */
  line: { center: number; levelSd: number; correlation: number };
  /** The least pay above the minimum the class showed (dollars): the band never goes below it, save for a class paid the minimum. */
  floor: number;
  /** The platforms (wins) the line was measured on: beyond them it is extrapolated, and says so. */
  platforms: { low: number; high: number };
}

export interface LadderClass {
  /** Arbitration class by service (1 is the first arbitration year); a Super Two's later trips sit where his service puts him. */
  arbitrationClass: number;
  /** measured: the save's own line; thin: below the minimum, the prior hulled with the save's range; prior: the prior alone (no cases). */
  status: 'measured' | 'thin' | 'prior' | 'unknown';
  /** The save's own contracts in the class (one-year, above the minimum, platform read). */
  cases: number;
  excluded: { atMinimum: number };
  /**
   * The class's one-year contracts at the league minimum, kept out of the line (pay there is held at the floor,
   * not set by the platform): how many, and the highest platform among them. A season whose platform reaches as
   * low has a low edge at the minimum.
   */
  atMinimum: { cases: number; platformHigh: number | null };
  /** A thin class's own pay above the minimum, lowest and highest: it widens the prior's reading, never sets a slope. */
  observed: { cases: number; low: number; high: number; platforms: { low: number; high: number } } | null;
  readings: CostReading[];
  /** R-6's statistic, for comparison only: pay above the minimum over positive platform WAR, as a share of the price. */
  ratioShare: number | null;
  reason: string | null;
  text: string;
}

export interface ArbitrationLadder {
  status: 'measured' | 'provisional' | 'partly_provisional' | 'partly_unknown' | 'no_arbitration' | 'unknown';
  regime: ArbitrationRegime;
  classes: LadderClass[];
  /** The platform, in words: which seasons an arbitration salary is read against. */
  platform: string;
  /** One-year contracts read by neither the renewal spread nor the ladder: their holder's standing this season is open. */
  unread: { openStanding: number; text: string };
  reason: string | null;
}

export interface RenewalSpread {
  status: 'measured' | 'provisional' | 'unknown';
  band: Sourced<CostBand>;
  /** The save's own pre-arbitration one-year renewals read. */
  cases: number;
  atMinimum: number;
  text: string;
}

export interface CostLadder {
  leagueId: number;
  season: number | null;
  minimum: Sourced<number>;
  /** The price of a win: the provisional prior's shares are read against it (the save's own lines are in dollars). */
  price: Sourced<PriceBand>;
  preArbitration: RenewalSpread;
  arbitration: ArbitrationLadder;
  rules: { renewal: string; arbitration: string; prior: string; reserveClause: string; band: string };
  stamps: { policy: CalibrationStamp; prior: CalibrationStamp };
}

export interface CostLadderInput {
  leagueId: number;
  season: number | null;
  financials: Sourced<boolean>;
  minimumSalary: Sourced<number>;
  /** Player Rights' reading of the league's arbitration regime (`arbitrationRegimeOf`). */
  regime: ArbitrationRegime;
  price: Sourced<PriceBand>;
  /** The league's major leaguers on its active or injured lists, with Player Rights' answers (the market's population). */
  candidates: MarketCandidate[];
  /** The league's WAR by season (the platform seasons at least). */
  war: Map<number, SeasonWar>;
  /** The share of this season's schedule each past season covered. */
  seasonShares: Map<number, Sourced<number>>;
}

// ── small helpers (no module-level numbers: every constant is in the calibration module) ──

const millions = (n: number): string => `$${(n / 1_000_000).toFixed(2)}M`;
const signed = (n: number): string => `${n < 0 ? '−' : '+'}${millions(Math.abs(n))}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const nth = (x: number): string => {
  const n = Math.round(x * 100);
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
};
const ordinalOf = (n: number): string => {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
};
const wins = (x: number): string => x.toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATUS_WORDS: Partial<Record<ControlStatus, string>> = {
  pre_arbitration: 'pre-arbitration', arbitration: 'arbitration', free_agent: 'free agency', reserve_clause: 'a reserve clause',
  indeterminate: 'not established',
};
const words = (s: ControlStatus): string => STATUS_WORDS[s] ?? s.replace(/_/g, ' ');
/** "about 1.3" for the line's errors: the constant is policy, the words are plain. */
const aboutErrors = (): string => `about ${COST_POLICY.ladder.lineErrors.toFixed(1)}`;

/** The inverted-CDF quantile (smallest value whose empirical CDF reaches p): unchanged by duplicating a sample. */
function quantile(sorted: ArrayLike<number>, p: number): number {
  const i = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length))) - 1;
  return sorted[i];
}

/** The median (the mean of the middle two for an even count). */
function median(sorted: ArrayLike<number>): number {
  const n = sorted.length;
  const h = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
}

/** P(X ≤ k) for X ~ Binomial(n, p), summed in logs. */
function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let logFact = 0;
  const logFacts: number[] = [0];
  for (let i = 1; i <= n; i += 1) {
    logFact += Math.log(i);
    logFacts.push(logFact);
  }
  let total = 0;
  for (let i = 0; i <= k; i += 1) {
    total += Math.exp(logFacts[n] - logFacts[i] - logFacts[n - i] + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return Math.min(1, total);
}

/**
 * The distribution-free upper confidence bound of the q-th quantile: the smallest order statistic k (1-based) with
 * P(Binomial(n, q) ≤ k − 1) ≥ confidence. Null when the sample is too small for any order statistic to bound it.
 */
function upperBoundRank(n: number, q: number, confidence: number): number | null {
  for (let k = 1; k <= n; k += 1) {
    if (binomialCdf(k - 1, n, q) >= confidence) return k;
  }
  return null;
}

/** The fewest renewals for which the upper bound leaves the largest out (for the rule's words). */
function fewestLeavingOneOut(): number | null {
  const { quantile: q, confidence, minimumCases } = COST_POLICY.renewal;
  for (let n = minimumCases; n <= minimumCases * minimumCases; n += 1) {
    const k = upperBoundRank(n, q, confidence);
    if (k !== null && k < n) return n;
  }
  return null;
}

/** A small deterministic generator (mulberry32) for the bootstrap: the same import always reads the same line. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the population ───────────────────────────────────────────────────────────

interface Row {
  playerId: number;
  eligibility: SeasonControlEligibility | null;
  salary: number | null;
  oneYear: boolean;
}

function rowOf(c: MarketCandidate, season: number): Row {
  const term = c.contract.term;
  const major = c.contract.kind.value === 'major_league';
  const salary = major ? term?.seasons.find((s) => s.season === season)?.salary.value ?? null : null;
  return {
    playerId: c.playerId,
    eligibility: c.control.eligibility?.seasons.find((s) => s.season === season) ?? null,
    salary,
    // A one-year deal set this winter: a renewal or an arbitration salary, never a multi-year extension
    oneYear: major && term !== null && term.years.value === 1 && term.firstSeason.value === season,
  };
}

// ── the renewal spread ───────────────────────────────────────────────────────

const RENEWAL_RULE = () => {
  const n = fewestLeavingOneOut();
  return `A pre-arbitration renewal costs from the league minimum to the ${pct(COST_POLICY.renewal.confidence)} upper confidence bound of the ` +
    `${nth(COST_POLICY.renewal.quantile)} percentile of the save's own pre-arbitration one-year renewals this season (Player Rights' pre-arbitration answer), ` +
    `measured at each import; its central is the median renewal. That bound is one of the renewals themselves: ` +
    (n !== null ? `below ${n} renewals it is the largest, so one unusual renewal can set it; from ${n} it leaves the largest out. ` : 'at every count the policy allows it is the largest. ') +
    `Below ${COST_POLICY.renewal.minimumCases} renewals, the provisional prior widened by the save's own renewals where the regime as read is MLB's.`;
};

function renewalSpread(rows: Row[], minimum: number, regime: ArbitrationRegime): RenewalSpread {
  const renewals = rows.filter((r) => r.eligibility?.standing === 'pre_arbitration' && r.oneYear && r.salary !== null);
  const pay = renewals.map((r) => r.salary as number).sort((a, b) => a - b);
  const n = pay.length;
  const atMinimum = pay.filter((x) => x <= minimum).length;
  const source = 'players_contract (one-year pre-arbitration renewals, this season)';
  if (n >= COST_POLICY.renewal.minimumCases) {
    const k = upperBoundRank(n, COST_POLICY.renewal.quantile, COST_POLICY.renewal.confidence);
    if (k !== null) {
      const high = Math.max(minimum, pay[k - 1]);
      const central = Math.min(high, Math.max(minimum, median(pay)));
      const band = { low: minimum, central, high };
      const which = k === n
        ? `the largest of the ${n} renewals: too few for the upper bound of their ${nth(COST_POLICY.renewal.quantile)} percentile to leave any out, so one renewal sets it`
        : `the ${ordinalOf(n - k + 1)} largest of the ${n} renewals (the upper bound of their ${nth(COST_POLICY.renewal.quantile)} percentile, leaving out the ${n - k === 1 ? 'largest' : `${n - k} largest`})`;
      const text = `Measured on this save's ${n} pre-arbitration renewals (${atMinimum} at the minimum): ${millions(band.low)} to ${millions(band.high)}, ` +
        `central ${millions(central)} (the median renewal); the high edge is ${which}.`;
      return { status: 'measured', band: derivedFrom(band, source, text), cases: n, atMinimum, text };
    }
  }
  const thin = `${plural(n, 'pre-arbitration renewal')} this season, fewer than the policy minimum of ${COST_POLICY.renewal.minimumCases}`;
  if (regime.mlb !== true || !(minimum > 0)) {
    const why = regime.mlb === false
      ? `and the provisional prior (MLB's real-world renewals) is used only where the regime as read is MLB's: ${regime.basis}`
      : regime.mlb === null
        ? `and whether the regime is MLB's (where the provisional prior applies) is not established: ${regime.basis}`
        : 'and the provisional prior is stated in multiples of the league minimum, which is not above $0 here';
    const text = `Not established: ${thin}, ${why}`;
    return { status: 'unknown', band: unknownBecause('not_exported_by_ootp', source, text), cases: n, atMinimum, text };
  }
  const high = Math.max(minimum * COST_PRIOR.renewal.highOverMinimum, n > 0 ? pay[n - 1] : minimum, minimum);
  const central = Math.min(high, Math.max(minimum, minimum * COST_PRIOR.renewal.medianOverMinimum));
  const band = { low: minimum, central, high };
  const text = `Provisional: ${thin}, so the provisional prior (${COST_PRIOR.source}) widened by the save's own renewals (the largest of them): ` +
    `${millions(band.low)} to ${millions(band.high)}, central ${millions(central)} (the prior's median renewal).`;
  return { status: 'provisional', band: derivedFrom(band, source, text), cases: n, atMinimum, text };
}

// ── the arbitration ladder ───────────────────────────────────────────────────

interface Case {
  platform: number;
  above: number;
}

/** The Theil–Sen line: the median of the pairwise slopes, and the median intercept. Null when every platform is the same. */
function theilSen(xs: ArrayLike<number>, ys: ArrayLike<number>, idx: ArrayLike<number>): { slope: number; intercept: number } | null {
  const n = idx.length;
  const slopes = new Float64Array((n * (n - 1)) / 2);
  let m = 0;
  for (let i = 0; i < n; i += 1) {
    const xi = xs[idx[i]];
    const yi = ys[idx[i]];
    for (let j = i + 1; j < n; j += 1) {
      const dx = xs[idx[j]] - xi;
      if (dx !== 0) {
        slopes[m] = (ys[idx[j]] - yi) / dx;
        m += 1;
      }
    }
  }
  if (m === 0) return null;
  const slope = median(slopes.subarray(0, m).sort());
  const intercepts = new Float64Array(n);
  for (let i = 0; i < n; i += 1) intercepts[i] = ys[idx[i]] - slope * xs[idx[i]];
  return { slope, intercept: median(intercepts.sort()) };
}

/**
 * The class's line, read robustly (Theil–Sen: one star or one market contract moves it no further than any single
 * case moves a median), its spread (the residuals' 10th and 90th percentiles) and the line's own uncertainty from a
 * bootstrap of the same fit (the closed form of least squares does not apply to it). Null where every platform is
 * the same (no line can be read).
 */
function lineOf(cases: Case[], price: number | null): CostReading | null {
  const n = cases.length;
  const xs = Float64Array.from(cases, (c) => c.platform);
  const ys = Float64Array.from(cases, (c) => c.above);
  const all = Uint32Array.from({ length: n }, (_, i) => i);
  const fit = theilSen(xs, ys, all);
  if (fit === null) return null;
  const residuals = Float64Array.from(cases, (c) => c.above - (fit.intercept + fit.slope * c.platform)).sort();
  const center = median(Float64Array.from(xs).sort());

  // The bootstrap: resample the class's contracts, refit, and read the spread of the level (at the center) and the rung
  const random = generator(COST_POLICY.ladder.bootstrap.seed);
  const levels: number[] = [];
  const slopes: number[] = [];
  const pick = new Uint32Array(n);
  for (let b = 0; b < COST_POLICY.ladder.bootstrap.replicates; b += 1) {
    for (let i = 0; i < n; i += 1) pick[i] = Math.floor(random() * n);
    const f = theilSen(xs, ys, pick);
    if (f === null) continue;
    levels.push(f.intercept + f.slope * center);
    slopes.push(f.slope);
  }
  const k = levels.length;
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const ml = k > 1 ? mean(levels) : 0;
  const ms = k > 1 ? mean(slopes) : 0;
  const varL = k > 1 ? levels.reduce((s, x) => s + (x - ml) ** 2, 0) / (k - 1) : 0;
  const varS = k > 1 ? slopes.reduce((s, x) => s + (x - ms) ** 2, 0) / (k - 1) : 0;
  const cov = k > 1 ? levels.reduce((s, x, i) => s + (x - ml) * (slopes[i] - ms), 0) / (k - 1) : 0;
  const levelSd = Math.sqrt(varL);
  const slopeSd = Math.sqrt(varS);
  return {
    source: 'save',
    cases: n,
    base: fit.intercept,
    perWin: { unit: 'dollars', value: fit.slope, sd: slopeSd },
    share: price !== null && price > 0 ? fit.slope / price : null,
    spread: { low: quantile(residuals, COST_POLICY.ladder.spread.low), high: quantile(residuals, COST_POLICY.ladder.spread.high) },
    line: { center, levelSd, correlation: levelSd > 0 && slopeSd > 0 ? Math.max(-1, Math.min(1, cov / (levelSd * slopeSd))) : 0 },
    floor: Math.min(...cases.map((c) => c.above)),
    platforms: { low: Math.min(...cases.map((c) => c.platform)), high: Math.max(...cases.map((c) => c.platform)) },
  };
}

function priorReading(arbitrationClass: number, minimum: number): CostReading | null {
  const p = COST_PRIOR.ladder.find((c) => c.arbitrationClass === arbitrationClass);
  if (!p || !(minimum > 0)) return null;
  return {
    source: 'prior',
    cases: p.cases,
    base: p.baseOverMinimum * minimum,
    perWin: { unit: 'share', value: p.share, sd: p.shareSd },
    share: p.share,
    spread: { low: p.spreadOverMinimum.low * minimum, high: p.spreadOverMinimum.high * minimum },
    line: { center: p.center, levelSd: p.levelSdOverMinimum * minimum, correlation: p.correlation },
    floor: p.floorOverMinimum * minimum,
    platforms: { ...p.platforms },
  };
}

const PLATFORM_TEXT = () =>
  `the mean WAR of the ${COST_POLICY.ladder.platformSeasons} seasons before the arbitration winter (the platform season and the one before it), each on its schedule's footing; a season with no line counts 0`;

const ARBITRATION_RULE = () =>
  `An arbitration season costs the league minimum plus its class's line at the platform: a base (the class's pay at no platform wins) and a pay per platform win, ` +
  `against ${PLATFORM_TEXT()}. The line is read robustly (Theil–Sen: the median of the slopes between every two contracts), so one star or one market contract ` +
  `in the class cannot move it far. The class's spread is the ${nth(COST_POLICY.ladder.spread.low)} to ${nth(COST_POLICY.ladder.spread.high)} percentile of its pay around the line, ` +
  `widened by ${aboutErrors()} of the line's own standard errors (from ${COST_POLICY.ladder.bootstrap.replicates} bootstrap refits of the same line); never below the least the class was paid above the minimum, ` +
  `except that where the save shows one-year contracts in the class at the league minimum, a season whose platform reaches as low as theirs reaches the minimum too. ` +
  `Read on this import's one-year contracts of players Player Rights finds in arbitration, by class (the class his service puts him in); a contract at the league minimum ` +
  `is kept out of the line (pay there is held at the floor, not set by the platform). Below ${COST_POLICY.ladder.minimumCases} contracts a class has no line of its own: ` +
  `it is the provisional prior's line, widened by the range the save paid the class, only where the regime as read is MLB's.`;

const BAND_RULE =
  'Every band is a range of reasonable readings: each edge takes every component at its own edge (the production band, the class\'s spread, the line\'s error, and the price band where the prior is read), ' +
  'edge against edge. It is not an interval with a stated chance, and not an expectation: the central is the reading at the centre of each component.';

function lineText(r: CostReading, price: number | null): string {
  const rung = r.perWin.unit === 'dollars'
    ? `${millions(r.perWin.value)} per platform win${r.share !== null ? ` (${pct(r.share)} of the price of a win's central)` : ''}`
    : `${pct(r.perWin.value)} of the price of a win${price !== null ? ` (${millions(r.perWin.value * price)} at its central)` : ''} per platform win`;
  return `${millions(r.base)} above the minimum plus ${rung}; ` +
    `the ${nth(COST_POLICY.ladder.spread.low)} to ${nth(COST_POLICY.ladder.spread.high)} percentile of its pay within ${signed(r.spread.low)} to ${signed(r.spread.high)} of that line; ` +
    `measured on platforms of ${wins(r.platforms.low)} to ${wins(r.platforms.high)} wins`;
}

function classText(c: Omit<LadderClass, 'text'>, price: number | null): string {
  const head = `Arbitration class ${c.arbitrationClass}`;
  if (c.status === 'unknown') return `${head}: not established. ${c.reason ?? ''}`.trim();
  const atMin = c.atMinimum.cases > 0
    ? `; ${plural(c.atMinimum.cases, 'one-year contract')} at the league minimum kept out of the line (at platforms up to ${wins(c.atMinimum.platformHigh as number)} wins)`
    : '';
  const r = c.readings[0];
  if (c.status === 'measured') return `${head}: measured on ${c.cases} contracts${atMin}: a robust line, ${lineText(r, price)}.`;
  if (c.status === 'thin') {
    const o = c.observed!;
    return `${head}: provisional. The save's ${plural(o.cases, 'contract')} (fewer than ${COST_POLICY.ladder.minimumCases}, too few for a line) paid ${millions(o.low)} to ${millions(o.high)} above the minimum${atMin}; ` +
      `that range widens the provisional prior's line: ${lineText(r, price)}.`;
  }
  return `${head}: provisional prior (the save has no contracts in the class above the minimum${atMin}): ${lineText(r, price)}.`;
}

function arbitrationLadder(rows: Row[], input: CostLadderInput, minimum: number | null, dollars: string | null): ArbitrationLadder {
  const { regime } = input;
  const platform = PLATFORM_TEXT();
  const open = rows.filter((r) => r.eligibility?.standing === 'indeterminate' && r.oneYear && r.salary !== null).length;
  const unread = {
    openStanding: open,
    text: open > 0
      ? `${plural(open, 'one-year contract')} this season ${open === 1 ? 'is' : 'are'} read by neither the renewal spread nor the ladder: Player Rights leaves the holder's standing this season open (the Super Two window, or a line inside his service).`
      : '',
  };
  if (regime.status === 'no_arbitration' || regime.status === 'reserve_clause') {
    return { status: 'no_arbitration', regime, classes: [], platform, unread, reason: regime.basis };
  }
  if (regime.status !== 'arbitration' || regime.classes === null) {
    return { status: 'unknown', regime, classes: [], platform, unread, reason: `No arbitration ladder: ${regime.basis}` };
  }
  const classes = Array.from({ length: regime.classes }, (_, i) => i + 1);
  const allUnknown = (reason: string): ArbitrationLadder => ({
    status: 'unknown', regime, platform, unread, reason,
    classes: classes.map((k) => {
      const c = { arbitrationClass: k, status: 'unknown' as const, cases: 0, excluded: { atMinimum: 0 }, atMinimum: { cases: 0, platformHigh: null }, observed: null, readings: [], ratioShare: null, reason };
      return { ...c, text: classText(c, null) };
    }),
  });
  if (dollars !== null || minimum === null) return allUnknown(dollars ?? 'The league minimum is not established.');
  const price = input.price.value;
  const season = input.season as number;

  // The platform seasons, each on its schedule's footing (as the price of a win reads them)
  const platformSeasons = Array.from({ length: COST_POLICY.ladder.platformSeasons }, (_, i) => season - 1 - i);
  for (const y of platformSeasons) {
    if (!input.war.has(y)) return allUnknown(`The export has no WAR for the league in ${y}, a platform season.`);
    const share = input.seasonShares.get(y)?.value ?? null;
    if (share === null || !(share > 0)) return allUnknown(`${y}'s share of the schedule is not established, so its WAR cannot be put on a full season's footing and it is not assumed full.`);
    if (share < OPENING_PRICE_MINIMUMS.seasonShare) return allUnknown(`${y} covered ${pct(share)} of the schedule, under the policy minimum of ${pct(OPENING_PRICE_MINIMUMS.seasonShare)}: too little to read a platform on.`);
  }
  const platformOf = (id: number) =>
    platformSeasons.reduce((s, y) => s + (input.war.get(y)!.byPlayer.get(id) ?? 0) / (input.seasonShares.get(y)!.value as number), 0) / platformSeasons.length;

  const out: LadderClass[] = classes.map((k) => {
    const inClass = rows.filter((r) => r.eligibility?.standing === 'arbitration' && r.eligibility.arbitration.trip !== null
      && Math.min(r.eligibility.arbitration.trip.low, regime.classes as number) === k && r.oneYear && r.salary !== null);
    const atMinimumRows = inClass.filter((r) => (r.salary as number) <= minimum);
    const atMinimum = {
      cases: atMinimumRows.length,
      platformHigh: atMinimumRows.length > 0 ? Math.max(...atMinimumRows.map((r) => platformOf(r.playerId))) : null,
    };
    const cases: Case[] = inClass.filter((r) => (r.salary as number) > minimum)
      .map((r) => ({ platform: platformOf(r.playerId), above: (r.salary as number) - minimum }));
    const positive = cases.reduce((s, c) => s + Math.max(0, c.platform), 0);
    const ratioShare = positive > 0 && price !== null ? cases.reduce((s, c) => s + c.above, 0) / positive / price.central : null;
    const base = { arbitrationClass: k, cases: cases.length, excluded: { atMinimum: atMinimum.cases }, atMinimum, ratioShare };
    let c: Omit<LadderClass, 'text'>;
    const own = cases.length >= COST_POLICY.ladder.minimumCases ? lineOf(cases, price?.central ?? null) : null;
    if (own) {
      c = { ...base, status: 'measured', observed: null, readings: [own], reason: null };
    } else {
      const thin = cases.length >= COST_POLICY.ladder.minimumCases
        ? `${plural(cases.length, 'contract')} in class ${k}, every one at the same platform, so no line can be read on them`
        : `${plural(cases.length, 'contract')} in class ${k}, fewer than the policy minimum of ${COST_POLICY.ladder.minimumCases}`;
      const observed = cases.length > 0
        ? {
          cases: cases.length, low: Math.min(...cases.map((x) => x.above)), high: Math.max(...cases.map((x) => x.above)),
          platforms: { low: Math.min(...cases.map((x) => x.platform)), high: Math.max(...cases.map((x) => x.platform)) },
        }
        : null;
      const prior = regime.mlb === true && price !== null ? priorReading(k, minimum) : null;
      if (prior) {
        c = observed
          ? { ...base, status: 'thin', observed, readings: [prior], reason: `${thin}: the provisional prior's line, widened by the range the save paid the class.` }
          : { ...base, status: 'prior', observed: null, readings: [prior], reason: `${thin}: the provisional prior.` };
      } else {
        const why = regime.mlb === false
          ? `the provisional prior (MLB's real-world contracts) is used only where the regime as read is MLB's, and this one is not (${regime.basis}). ` +
            'The range a handful of the save\'s own contracts paid is not read alone: it says nothing about a player whose platform lies outside theirs'
          : regime.mlb === null ? `whether the regime is MLB's is not established (${regime.basis})`
            : price === null ? `the provisional prior is stated in shares of the price of a win, which is unknown here (${input.price.note ?? 'not stated'})`
              : !(minimum > 0) ? 'the provisional prior is stated in multiples of the league minimum, which is not above $0 here'
                : 'the prior has no such class';
        c = { ...base, status: 'unknown', observed, readings: [], reason: `Not established: ${thin}, and ${why}.` };
      }
    }
    return { ...c, text: classText(c, price?.central ?? null) };
  });
  const statuses = new Set(out.map((c) => c.status));
  const status: ArbitrationLadder['status'] = statuses.size === 1 && statuses.has('measured') ? 'measured'
    : statuses.size === 1 && statuses.has('unknown') ? 'unknown'
      : statuses.has('unknown') ? 'partly_unknown'
        : statuses.has('measured') ? 'partly_provisional' : 'provisional';
  return { status, regime, classes: out, platform, unread, reason: null };
}

/** The cost ladder of a league at this import (Parts 2.2 and 4.4). */
export function measureCostLadder(input: CostLadderInput): CostLadder {
  const { season } = input;
  const rows = season === null ? [] : input.candidates.map((c) => rowOf(c, season));
  let dollars: string | null = null;
  if (input.financials.value === false) dollars = 'The league runs no financials (rules_financials = 0): value is in wins, and no season is priced in dollars.';
  else if (input.financials.value === null) dollars = `Whether the league runs financials is not established (${input.financials.note ?? 'rules_financials is not exported'}): no season is priced in dollars.`;
  else if (season === null) dollars = "The league's season is not established, so this season's contracts cannot be read.";
  else if (input.minimumSalary.value === null) dollars = `The league minimum salary is not established (${input.minimumSalary.note ?? 'not exported'}): no renewal or arbitration season is priced, never at another league's minimum.`;
  const minimum = input.minimumSalary.value;

  const preArbitration: RenewalSpread = dollars !== null || minimum === null
    ? { status: 'unknown', band: unknownBecause('not_exported_by_ootp', input.minimumSalary.source, dollars ?? 'The league minimum is not established.'), cases: 0, atMinimum: 0, text: dollars ?? '' }
    : renewalSpread(rows, minimum, input.regime);

  return {
    leagueId: input.leagueId,
    season,
    minimum: input.minimumSalary,
    price: input.price,
    preArbitration,
    arbitration: arbitrationLadder(rows, input, minimum, dollars),
    rules: {
      renewal: RENEWAL_RULE(),
      arbitration: ARBITRATION_RULE(),
      prior: COST_PRIOR_CALIBRATION.basis,
      reserveClause: 'A reserve-clause renewal is not priced from one import: it is measured from the renewals observed across imports once enough are seen (phase 4b), and is unknown until then.',
      band: BAND_RULE,
    },
    stamps: { policy: COST_POLICY_CALIBRATION, prior: COST_PRIOR_CALIBRATION },
  };
}

// ── pricing a timeline ───────────────────────────────────────────────────────

export interface PriceControlInput {
  control: ControlTimeline;
  /** His production answer; null where the reading computed none (then no arbitration season is priced). */
  production: PlayerProduction | null;
  /** His league's cost ladder; null where it could not be read. */
  ladder: CostLadder | null;
  /** His WAR in a past season on its schedule's footing (0 where he has no line), or null where not established. */
  pastWins: (season: number) => number | null;
}

type Priced = { cost: Sourced<CostBand>; basis: CostBasis | null };

const unknownCost = (note: string): Priced => ({ cost: unknownBecause<CostBand>('not_exported_by_ootp', null, note), basis: null });

function priceRenewal(ladder: CostLadder): Priced {
  const r = ladder.preArbitration;
  if (r.band.value === null) return unknownCost(`Pre-arbitration renewal not priced: ${r.band.note ?? r.text}`);
  const source: CostBasis['source'] = r.status === 'measured' ? 'measured' : 'provisional_prior';
  const note = `Pre-arbitration renewal: ${r.text}`;
  const central = r.band.value.central ?? null;
  return {
    cost: derivedFrom({ ...r.band.value }, r.band.source ?? 'players_contract', note),
    basis: {
      method: 'renewal_spread', source, classes: [], cases: r.cases, platform: null, price: null, ifHeld: false,
      centrals: central === null ? null : [{ status: 'pre_arbitration', central }], text: r.text,
    },
  };
}

type Platform = { seasons: number[]; low: number; central: number; high: number };

/** A reading's dollars per platform win, at a price (the save's own line is already in dollars). */
const perWinAt = (r: CostReading, price: number): number => (r.perWin.unit === 'dollars' ? r.perWin.value : r.perWin.value * price);

/**
 * One reading's band at a platform band and a price band: every corner, the line's error on each side, floored.
 * The save's own line was read on this import's salaries, so its dollars per platform win are observed: the price
 * band (the spread of the market's bases) is not applied to it. The prior is stated in shares of the price, so its
 * reading into this save's money carries the whole price band. Its central is the line at the platform's central
 * (at the price's central for the prior).
 */
function readingBand(r: CostReading, platform: Platform, price: PriceBand | null): CostBand & { central: number } {
  const z = COST_POLICY.ladder.lineErrors;
  const prices = r.perWin.unit === 'dollars' ? [null] : [(price as PriceBand).low, (price as PriceBand).high];
  const lows: number[] = [];
  const highs: number[] = [];
  for (const p of [platform.low, platform.high]) {
    for (const at of prices) {
      const perWin = at === null ? r.perWin.value : r.perWin.value * at;
      const slopeSd = at === null ? r.perWin.sd : r.perWin.sd * at;
      const d = p - r.line.center;
      const se = Math.sqrt(Math.max(0, r.line.levelSd ** 2 + (d * slopeSd) ** 2 + 2 * d * r.line.correlation * r.line.levelSd * slopeSd));
      const fitted = r.base + perWin * p;
      lows.push(fitted + r.spread.low - z * se);
      highs.push(fitted + r.spread.high + z * se);
    }
  }
  const low = Math.max(Math.min(...lows), r.floor);
  const high = Math.max(Math.max(...highs), low);
  const centralAt = r.base + perWinAt(r, r.perWin.unit === 'dollars' ? 0 : (price as PriceBand).central) * platform.central;
  return { low, high, central: Math.min(high, Math.max(low, centralAt)) };
}

function platformBand(season: number, input: PriceControlInput): { value: Platform } | { reason: string } {
  const thisSeason = input.control.thisSeason as number;
  const seasons = Array.from({ length: COST_POLICY.ladder.platformSeasons }, (_, i) => season - COST_POLICY.ladder.platformSeasons + i);
  let low = 0;
  let central = 0;
  let high = 0;
  for (const y of seasons) {
    if (y < thisSeason) {
      const w = input.pastWins(y);
      if (w === null) return { reason: `His ${y} WAR, a platform season, is not established on a full season's footing.` };
      low += w;
      central += w;
      high += w;
      continue;
    }
    const p = input.production;
    if (p === null) return { reason: 'This reading was valued without production, and an arbitration season is priced on its platform seasons\' production.' };
    if (p.status !== 'projected') return { reason: `His production is unknown (${p.reason ?? 'no evidence'}), and an arbitration season is priced on its platform seasons' production.` };
    const s = p.seasons.find((x) => x.season === y);
    if (!s) {
      const not = p.notEstablished.find((x) => x.season === y);
      return { reason: `His production in ${y}, a platform season, is not established${not ? ` (${not.reason})` : ''}, so the season's arbitration cost is not either.` };
    }
    low += s.wins.low;
    central += s.wins.central;
    high += s.wins.high;
  }
  const n = seasons.length;
  return { value: { seasons, low: low / n, central: central / n, high: high / n } };
}

/**
 * The classes a season covers: every class of its trip, and the class his service puts him in (the ladder reads a
 * player by his service, so a Super Two's later trips sit one class below their count; review R1-05). Where the trip
 * is not counted it is at least his service class, so every class from there up. The central is read in the class
 * the trip counts, or in his service's class where that lies wholly below it (a Super Two); none where the trip is
 * not counted.
 */
function classesOf(
  trip: { low: number; high: number } | null, serviceClass: { low: number; high: number } | null, top: number
): { wanted: number[]; centralClass: number | null } {
  const cap = (k: number) => Math.min(top, Math.max(1, k));
  const tripRange = trip ?? (serviceClass !== null ? { low: serviceClass.low, high: top } : { low: 1, high: top });
  const lo = Math.min(tripRange.low, serviceClass?.low ?? tripRange.low);
  const hi = Math.max(tripRange.high, serviceClass?.high ?? tripRange.high);
  const wanted = [...new Set(Array.from({ length: hi - lo + 1 }, (_, i) => cap(lo + i)))];
  const centralClass = trip === null ? null : cap(serviceClass !== null ? Math.min(trip.low, serviceClass.high) : trip.low);
  return { wanted, centralClass };
}

/**
 * The salary of the season before the one being priced, as the timeline already priced it (owner decision 3,
 * 2026-09-24): a contract season's salary; a priced season's low edge (the least he is paid then if held); an option
 * season the least of both branches. Unknown where the season before is not in the timeline, a branch has no cost to
 * this club (he would not be held), or its cost is not established.
 */
interface PreviousSalary {
  value: number | null;
  words: string;
}

function previousSalaryOf(prev: ControlSeason | null, season: number): PreviousSalary {
  const before = season - 1;
  if (prev === null || prev.season !== before) return { value: null, words: `his ${before} salary is not in the export` };
  const main = prev.cost;
  if (main === null) return { value: null, words: `he may not be held in ${before}` };
  if (main.value === null) return { value: null, words: `his ${before} salary is not known` };
  const lows = [main.value.low];
  if (prev.declined) {
    const d = prev.declined.cost;
    if (d === null) return { value: null, words: `${before} is an option season whose declined branch ends his control` };
    if (d.value === null) return { value: null, words: `${before} is an option season whose declined branch's cost is not known` };
    lows.push(d.value.low);
  }
  const value = Math.min(...lows);
  const point = !prev.declined && main.value.low === main.value.high && (prev.from === 'contract' || prev.from === 'extension');
  return { value, words: point ? `his ${before} salary (${millions(value)})` : `the least he is paid in ${before} if held (${millions(value)}, that season's low edge)` };
}

function priceArbitration(
  season: number, e: SeasonControlEligibility | null, trip: { low: number; high: number } | null, input: PriceControlInput, ladder: CostLadder,
  previous: PreviousSalary,
): Priced {
  const a = ladder.arbitration;
  if (a.status === 'no_arbitration' || a.classes.length === 0) return unknownCost(`Arbitration not priced: ${a.reason ?? 'the league has no arbitration ladder'}`);
  const top = a.classes.length;
  const serviceClass = e?.arbitration.serviceClass ?? null;
  const { wanted, centralClass } = classesOf(trip, serviceClass, top);
  const classes = wanted.map((k) => a.classes.find((c) => c.arbitrationClass === k));
  const missing = classes.find((c) => !c || c.status === 'unknown');
  if (missing !== undefined) return unknownCost(`Arbitration not priced: ${missing?.reason ?? 'its class is not in the ladder'}`);
  const all = classes as LadderClass[];
  const price = ladder.price.value;
  const usesPrior = all.some((c) => c.readings.some((r) => r.source === 'prior'));
  if (usesPrior && price === null) return unknownCost(`Arbitration not priced: the provisional prior is stated in shares of the price of a win, which is unknown here (${ladder.price.note ?? 'not stated'}).`);
  const minimum = ladder.minimum.value as number;
  const platform = platformBand(season, input);
  if ('reason' in platform) return unknownCost(platform.reason);
  const p = platform.value;

  let low = Infinity;
  let high = -Infinity;
  const centralByClass = new Map<number, number>();
  const notes: string[] = [];
  for (const c of all) {
    for (const r of c.readings) {
      const b = readingBand(r, p, price);
      low = Math.min(low, b.low);
      high = Math.max(high, b.high);
      if (!centralByClass.has(c.arbitrationClass)) centralByClass.set(c.arbitrationClass, b.central);
      if (p.high > r.platforms.high) {
        notes.push(`His platform reaches ${wins(p.high)} wins, beyond the ${wins(r.platforms.high)} wins class ${c.arbitrationClass}${r.source === 'prior' ? "'s provisional prior" : ''} was measured to: the line is extrapolated there, not capped.`);
      }
    }
    // A thin class: the range the save paid it widens the prior's reading, whatever the platform
    if (c.observed) {
      low = Math.min(low, c.observed.low);
      high = Math.max(high, c.observed.high);
    }
  }
  // The minimum, where the save paid this class the minimum at a platform as low as his
  const atMinimum = all.filter((c) => c.atMinimum.cases > 0 && c.atMinimum.platformHigh !== null && p.low <= c.atMinimum.platformHigh);
  if (atMinimum.length > 0) low = 0;
  const minimumNote = atMinimum.length === 0 ? null
    : `The save paid ${atMinimum.map((c) => `${plural(c.atMinimum.cases, 'class-' + c.arbitrationClass + ' one-year contract')} the league minimum (at platforms up to ${wins(c.atMinimum.platformHigh as number)} wins)`).join(' and ')}; ` +
      'his platform reaches as low, so the low edge is at the league minimum';

  // Owner decision 3 (2026-09-24): an arbitration salary is never below his previous season's salary, where it is known
  const ladderBand = { low: minimum + low, high: minimum + high };
  const rule = arbitrationSalaryFloor(ladder.arbitration.regime, previous.value);
  const floor = rule.status === 'binds' ? rule.floor as number : null;
  const lifts = floor !== null && floor > ladderBand.low;
  const above = floor !== null && floor >= ladderBand.high;
  if (minimumNote !== null) notes.push(lifts ? `${minimumNote}, except that his previous salary keeps it above the minimum (below).` : `${minimumNote}.`);
  const tendered = 'What he costs if tendered: a non-tender stays possible, and the export does not say whether the club will tender him.';
  if (rule.status === 'binds') {
    notes.push(above
      ? `Every reading of the ladder (${millions(ladderBand.low)}–${millions(ladderBand.high)}) is below his previous salary, ${previous.words}, and an arbitration salary is never below it (owner-attested, 2026-09-24): the season is at his previous salary. ${tendered}`
      : lifts
        ? `An arbitration salary is never below his previous salary (owner-attested, 2026-09-24): ${previous.words} lifts the low edge from ${millions(ladderBand.low)}. ${tendered}`
        : `An arbitration salary is never below his previous salary (owner-attested, 2026-09-24): ${previous.words}, already below the band. ${tendered}`);
  } else if (rule.status === 'unknown') {
    notes.push(`${previous.words.charAt(0).toUpperCase()}${previous.words.slice(1)}, so his previous salary is not known and the owner-attested rule that an arbitration salary never falls (2026-09-24) cannot bind here. ${tendered}`);
  }
  const floored = (v: number) => (floor === null ? v : Math.max(v, floor));
  const central = centralClass !== null ? centralByClass.get(centralClass) ?? null : null;
  const centrals = [...centralByClass].map(([k, v]) => ({ status: 'arbitration' as ControlStatus, arbitrationClass: k, central: floored(minimum + v) }));

  // A prior class that observed awards joined (phase 4b) is measured in part, never still the prior alone (review R3-10)
  const source: CostBasis['source'] = all.every((c) => c.status === 'measured') ? 'measured'
    : all.every((c) => c.status === 'prior' && c.readings.every((x) => x.source === 'prior')) ? 'provisional_prior' : 'measured_thin_with_prior';
  const cases = all.reduce((s, c) => s + c.cases, 0);
  const span = (ks: number[]) => (ks.length === 1 ? `${ks[0]}` : `${ks[0]}–${ks[ks.length - 1]}`);
  const tripText = trip === null ? 'which trip is not established, so every class' : `trip ${span(Array.from({ length: trip.high - trip.low + 1 }, (_, i) => trip.low + i))}`;
  const byService = serviceClass !== null && trip !== null && serviceClass.low < trip.low
    ? `; a player of his service is read in class ${Math.min(top, serviceClass.low)} of the ladder (a Super Two's later trips sit one class below their count), so that class is covered too`
    : '';
  const fourth = trip !== null && trip.high > top
    ? `; a ${ordinalOf(trip.high)} trip (a Super Two's, or one after an earlier winter was an arbitration year the export does not show) is priced in class ${top}, where his service puts him`
    : '';
  const counted = all.map((c) => (c.status === 'measured' ? `class ${c.arbitrationClass} measured on ${c.cases} contracts`
    : c.status === 'thin' ? `class ${c.arbitrationClass} provisional (the prior, widened by the save's ${plural(c.cases, 'contract')})`
      : `class ${c.arbitrationClass} provisional (the prior; the save has no contracts in it)`)).join('; ');
  const measuredAny = all.some((c) => c.status === 'measured');
  const money = !usesPrior
    ? "The save's own lines, in this import's dollars."
    : `${measuredAny ? "The save's own lines in this import's dollars, and the" : 'The'} provisional prior's shares × the price of a win ${millions((price as PriceBand).low)}–${millions((price as PriceBand).high)}: provisional.`;
  const centralText = central !== null
    ? `Central ${millions(floored(minimum + Math.min(high, Math.max(low, central))))} (class ${centralClass} at the platform's central${floor !== null && floor > minimum + Math.min(high, Math.max(low, central)) ? ', lifted to his previous salary' : ''}).`
    : `No single central: which trip is not established (class centrals ${centrals.map((c) => `${c.arbitrationClass} ${millions(c.central)}`).join(', ')}).`;
  const text = `Arbitration class ${span(wanted)} (${tripText}${byService}${fourth}): ${counted}; platform ${p.seasons[0]}–${p.seasons[p.seasons.length - 1]} production ` +
    `${wins(p.low)} to ${wins(p.high)} wins (central ${wins(p.central)}). ${money} ${centralText}${notes.length > 0 ? ` ${notes.join(' ')}` : ''} A range of reasonable readings, edge against edge.`;
  const band: CostBand = {
    low: floored(ladderBand.low),
    central: central === null ? null : floored(minimum + Math.min(high, Math.max(low, central))),
    high: floored(ladderBand.high),
  };
  return {
    cost: derivedFrom(band, 'players_contract (this season\'s one-year arbitration contracts) + production' + (usesPrior ? ' + the price of a win' : ''), text),
    basis: {
      method: 'arbitration_ladder', source, classes: wanted, cases, platform: p,
      price: usesPrior ? { low: (price as PriceBand).low, high: (price as PriceBand).high } : null,
      ifHeld: false, centrals: central !== null ? [{ status: 'arbitration', central: band.central as number }] : centrals,
      classCentrals: centrals.map((c) => ({ arbitrationClass: c.arbitrationClass, central: c.central })), text,
    },
  };
}

const HELD: ControlStatus[] = ['pre_arbitration', 'arbitration'];

/** The cost of a status Player Rights stated (or each it lies between), for a season no contract covers. */
function priceStatus(
  season: number, status: ControlStatus, between: ControlStatus[], e: SeasonControlEligibility | null, input: PriceControlInput,
  previous: PreviousSalary,
): Priced {
  const ladder = input.ladder;
  if (ladder === null) return unknownCost("Not priced: his league's cost ladder could not be read.");
  if (status === 'pre_arbitration') return priceRenewal(ladder);
  if (status === 'arbitration') return priceArbitration(season, e, e?.arbitration.trip ?? null, input, ladder, previous);
  if (status !== 'indeterminate' || between.length === 0) return unknownCost("The season's control is not established, so neither is its cost.");

  const mayLeave = between.includes('free_agent');
  const other = between.filter((b) => b !== 'free_agent' && !HELD.includes(b));
  if (other.length > 0) {
    return unknownCost(`Not priced: the season may be ${other.map(words).join(' or ')}, whose cost is not established.`);
  }
  const held = between.filter((b) => HELD.includes(b));
  const branches = held.map((b) => (b === 'pre_arbitration'
    ? priceRenewal(ladder)
    : priceArbitration(season, e, e?.arbitration.trip ?? e?.arbitration.tripIfEligible ?? null, input, ladder, previous)));
  if (branches.length === 0) return unknownCost('Not priced: no status he could hold is priced.');
  const unknown = branches.find((b) => b.cost.value === null);
  if (unknown) return unknownCost(`Not priced across the statuses the season lies between: ${unknown.cost.note ?? ''}`);
  const values = branches.map((b) => b.cost.value as CostBand);
  const low = Math.min(...values.map((v) => v.low));
  const high = Math.max(...values.map((v) => v.high));
  const bases = branches.map((b) => b.basis as CostBasis);
  // One held status: its central (if held, where he may leave). Two: each named, none chosen (which is not established)
  const branchCentrals = held.map((b, i) => ({ status: b, central: values[i].central ?? null }));
  const central = held.length === 1 ? values[0].central ?? null : null;
  const source: CostBasis['source'] = bases.every((b) => b.source === 'measured') ? 'measured'
    : bases.every((b) => b.source === 'provisional_prior') ? 'provisional_prior' : 'measured_thin_with_prior';
  const arbitration = bases.find((b) => b.method === 'arbitration_ladder') ?? null;
  const leave = mayLeave ? ' He may instead be a free agent (control ends, no cost to this club): this is what he costs if held.' : '';
  const centralText = held.length > 1
    ? ` No single central: which status is not established (${branchCentrals.map((c) => `${words(c.status)} ${c.central === null ? 'none' : millions(c.central)}`).join(', ')}).`
    : '';
  const text = `Between ${between.map(words).join(' and ')}: covering each.${centralText} ${bases.map((b) => b.text).join(' ')}${leave}`;
  const centrals = held.length > 1
    ? held.flatMap((b, i) => (values[i].central !== null && values[i].central !== undefined ? [{ status: b, central: values[i].central as number }] : bases[i].centrals ?? []))
    : central !== null ? [{ status: held[0], central }] : bases[0].centrals ?? null;
  return {
    cost: derivedFrom({ low, central, high }, 'the cost ladder, across each status', text),
    basis: {
      method: bases.length > 1 ? 'between' : bases[0].method, source, classes: arbitration?.classes ?? [],
      cases: bases.reduce((s, b) => s + b.cases, 0), platform: arbitration?.platform ?? null, price: arbitration?.price ?? null,
      ifHeld: mayLeave, centrals, classCentrals: arbitration?.classCentrals ?? null, text,
    },
  };
}

const unpriced = (cost: Sourced<CostBand> | null): boolean => cost !== null && cost.value === null && cost.note === COST_NOT_PRICED;

/** Statuses whose declined branch the player decides (alone or with the club): never a certain cost to the club. */
const PLAYER_DECIDES: ControlStatus[] = ['player_option', 'mutual_option', 'opt_out'];

/** A declined branch the player decides is priced as what he costs if the club still holds him, said (review R1-07). */
function ifHeldByPlayer(p: Priced, s: ControlSeason): Priced {
  if (p.cost.value === null || p.basis === null) return p;
  if (!(PLAYER_DECIDES.includes(s.status) || s.declined?.kind === 'opted_out')) return p;
  const lead = 'The player decides: if he walks away and the club still holds him, this is what he costs (if held); whether it does is not established. ';
  return {
    cost: { ...p.cost, note: `${lead}${p.cost.note ?? ''}` },
    basis: { ...p.basis, ifHeld: true, text: `${lead}${p.basis.text}` },
  };
}

/**
 * The control timeline with each season no contract covers priced (phase 4a): a renewal, an arbitration
 * season, an open season across each status it could be, and an option's or opt-out's declined branch.
 * Contract seasons, free agency and a reserve-clause renewal are left as they are.
 */
export function priceControlTimeline(input: PriceControlInput): ControlTimeline {
  const { control } = input;
  if (control.thisSeason === null || control.seasons.length === 0) return control;
  // In order: an arbitration season is floored at the season before it as already priced (owner decision 3, 2026-09-24)
  const seasons: ControlSeason[] = [];
  for (const s of control.seasons) {
    const e = control.eligibility?.seasons.find((x) => x.season === s.season) ?? null;
    const previous = previousSalaryOf(seasons[seasons.length - 1] ?? null, s.season);
    let next: ControlSeason = s;
    if (unpriced(s.cost)) {
      const p = priceStatus(s.season, s.status, s.between, e, input, previous);
      next = { ...next, cost: p.cost, costBasis: p.basis };
    }
    if (s.declined && unpriced(s.declined.cost)) {
      const p = ifHeldByPlayer(priceStatus(s.season, s.declined.status, s.declined.between, e, input, previous), s);
      next = { ...next, declined: { ...s.declined, cost: p.cost, costBasis: p.basis } };
    }
    seasons.push(next);
  }
  return { ...control, seasons };
}

// ── the club's sum (owner decision 2, 2026-09-24) ────────────────────────────

/** One player's projected season as Payroll sums it: his band, its central (or each status's), and what it covers. */
export interface ProjectedCost {
  low: number;
  high: number;
  /** Null where the season lies between statuses Player Rights leaves open (then `centrals` names each). */
  central: number | null;
  centrals: Array<{ status: string; central: number }> | null;
  /** He may leave instead, or the player decides: the band is what he costs if held. */
  ifHeld: boolean;
  /** The arbitration classes the band covers (more than one: a range of classes, not noise). */
  classes: number[] | null;
  /** Each covered class's central, where the band covers arbitration: the lowest and highest are the class range's edges. */
  classCentrals?: number[] | null;
}

export interface CombinedCost {
  /** The range shown: the sum of centrals, with the players' distances from their centrals combined as independent, and what is not noise at its edges. */
  low: number;
  high: number;
  /** Every player at his low edge, summed, to every player at his high edge (a player who may leave adds nothing to the low edge). */
  edges: { low: number; high: number };
  /** The sum of centrals: a season that may be free agency adds its central only to the upper sum; one between statuses its lowest and highest. */
  central: { low: number; high: number };
  /** Players combined as independent, and players kept at their edges. */
  combined: number;
  atEdges: number;
  text: string;
  stamp: CalibrationStamp;
}

/**
 * The club's projected cost for a season (owner decision 2, 2026-09-24; `COST_COMBINATION_POLICY`): the sum of the
 * players' centrals, with each player's distance from his central on the low side and on the high side combined as
 * independent across players (the root of the sum of squares), never every player at his edge at once. What is not
 * random noise stays at its edges and is added, not combined (R2-01's corners): which status a season between statuses
 * is (its lowest status's central on the low side, its highest on the high side), which class a range of arbitration
 * classes is (its lowest and highest class's central), and whether he is held at all (a player who may leave adds
 * nothing to the low side, and his held central to the high side). Only each player's own distance beyond those edges
 * (the spread of his class's pay, his production, the line's error) is combined. It lies inside the edge-to-edge sum
 * and holds the sum of centrals; for one player it is his own band. A range of reasonable readings, not a calibrated
 * interval: a class's line error shared by its players is read as independent too.
 */
export function combineProjectedCosts(costs: ProjectedCost[]): CombinedCost {
  let lowSquares = 0;
  let highSquares = 0;
  let edgeLow = 0;
  let edgeHigh = 0;
  let structuralLow = 0;
  let structuralHigh = 0;
  let centralLow = 0;
  let centralHigh = 0;
  let combined = 0;
  let atEdges = 0;
  for (const x of costs) {
    const low = x.ifHeld ? 0 : x.low;
    edgeLow += low;
    edgeHigh += x.high;
    const options = x.central !== null ? [x.central] : (x.centrals ?? []).map((c) => c.central);
    // A priced band always names a central or its statuses'; were neither there, its own edges bound it
    const lowOption = options.length > 0 ? Math.min(...options) : x.low;
    const highOption = options.length > 0 ? Math.max(...options) : x.high;
    centralLow += x.ifHeld ? 0 : lowOption;
    centralHigh += highOption;
    // The edges of what is not noise: which status, which class (the class range's lowest and highest central), held or not
    const classes = (x.classes?.length ?? 0) > 1 ? (x.classCentrals ?? []) : [];
    const anchorLow = x.ifHeld ? 0 : Math.max(x.low, Math.min(lowOption, ...classes));
    const anchorHigh = Math.min(x.high, Math.max(highOption, ...classes));
    if (x.ifHeld || anchorLow < anchorHigh) atEdges += 1;
    else combined += 1;
    structuralLow += anchorLow;
    structuralHigh += anchorHigh;
    // His own distance beyond them: combined as independent across players
    lowSquares += x.ifHeld ? 0 : Math.max(0, anchorLow - x.low) ** 2;
    highSquares += Math.max(0, x.high - anchorHigh) ** 2;
  }
  const range = {
    low: Math.max(edgeLow, Math.min(centralLow, structuralLow - Math.sqrt(lowSquares))),
    high: Math.min(edgeHigh, Math.max(centralHigh, structuralHigh + Math.sqrt(highSquares))),
  };
  const kept = atEdges > 0
    ? ` For ${plural(atEdges, 'player')}, what is not noise stays at its edges, added: which status a season between statuses is, which class a range of arbitration classes is, or that he may leave (nothing on the low side).`
    : '';
  const text = `${COST_COMBINATION_POLICY.label}: around the sum of centrals, each player's own distance from it on each side is combined as independent across ${plural(costs.length, 'player')} (root sum of squares).${kept} ` +
    `Every player at his edge, summed: ${millions(edgeLow)}–${millions(edgeHigh)}. Readings that move together (a class's line) are read as independent too.`;
  return { ...range, edges: { low: edgeLow, high: edgeHigh }, central: { low: centralLow, high: centralHigh }, combined, atEdges, text, stamp: COST_COMBINATION_POLICY_CALIBRATION };
}

/** The distribution-free upper confidence bound of the q-th quantile of a sorted sample, as the renewal spread reads it. */
function upperBoundOfQuantile(sorted: number[], q: number, confidence: number): number | null {
  const k = upperBoundRank(sorted.length, q, confidence);
  return k === null ? null : sorted[k - 1];
}

/** The class line and the renewal bound, for the readings observed across imports (phase 4b, `playerValueSignings.ts`): one method. */
export { lineOf, upperBoundOfQuantile };
