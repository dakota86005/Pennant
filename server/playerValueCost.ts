/**
 * Player Value, concern 2's cost bands (phase 4a): the cost of the controlled seasons no contract covers
 * (PLAYER_VALUE.md Parts 2.2 and 4.4).
 *
 * Pure. Two answers live here, both measured on the save at each import and never assumed:
 *
 *   the cost ladder     `measureCostLadder`, from this import's cross-section of contracts:
 *                       - the renewal spread: a pre-arbitration one-year renewal costs from the league
 *                         minimum to the 90% upper confidence bound of the 90th percentile of the save's
 *                         own renewals (COST_POLICY.renewal);
 *                       - the arbitration ladder, by class: what the save pays an arbitration-class player on
 *                         a one-year deal above the minimum, against the mean WAR of the two seasons before
 *                         the arbitration winter (the platform), read as a line: a base (pay at no platform
 *                         wins) and a share of the price of a win per platform win, with the class's spread
 *                         around the line (10th to 90th percentile) and the line's own standard error.
 *                       A class thinner than the policy minimum is the provisional prior (COST_PRIOR, the
 *                       same method on the imported real-world contracts) hulled with the save's own line,
 *                       only where the regime as read is MLB's; elsewhere it is unknown. A league with no
 *                       arbitration, or whose arbitration rule is not read, has no ladder at all.
 *   the priced timeline `priceControlTimeline`, which fills each pre-arbitration, arbitration and open
 *                       season of a control timeline: a renewal from the spread; an arbitration season from
 *                       its class(es), its platform seasons' production (projected where they are future,
 *                       the export's WAR where past), every corner of the interval taken (interval
 *                       arithmetic), never a point and never the league minimum; the save's own line is in this
 *                       import's dollars, and only the prior's shares carry the price of a win's band;
 *                       an open season across each status it could be; a season that may be free agency as
 *                       what he costs if held, saying so.
 *
 * Status, class and trip are Player Rights' answers (`standing`, `trip`, `tripIfEligible`,
 * `arbitrationRegimeOf`); nothing here compares service with a threshold. Production arrives as Player
 * Value's own production answer: nothing here reads a rating, `players_value`, philosophy, the protection
 * tier or defensibility. Describes, never authorizes (D-052).
 */

import type { CalibrationStamp } from './calibration.js';
import {
  COST_NOT_PRICED, COST_POLICY, COST_POLICY_CALIBRATION, COST_PRIOR, COST_PRIOR_CALIBRATION, OPENING_PRICE_MINIMUMS,
} from './playerValueCalibration.js';
import type { ArbitrationRegime, SeasonControlEligibility } from './playerRights.js';
import type { ControlSeason, ControlStatus, ControlTimeline, CostBand, CostBasis } from './playerValueControl.js';
import type { MarketCandidate, PriceBand, SeasonWar } from './playerValueFinances.js';
import type { PlayerProduction } from './playerValueProduction.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';

// ── the ladder's shape ───────────────────────────────────────────────────────

/** One reading of a class's line: the save's own, or the provisional prior's (in this save's money). */
export interface CostReading {
  source: 'save' | 'prior';
  /** The contracts the line was read on (the prior's own count for the prior). */
  cases: number;
  /** Pay above the minimum at no platform wins (dollars). */
  base: number;
  /** Per platform win, as a share of the price of a win's central: the rung. */
  share: number;
  /** The class's pay around its line: its 10th and 90th percentile residuals (dollars). */
  spread: { low: number; high: number };
  /** The line's own uncertainty: residual standard deviation (dollars), mean platform and sum of squares (wins). */
  line: { sigma: number; meanPlatform: number; sumSquares: number };
  /** The least pay above the minimum the class showed (dollars): the band never goes below it. */
  floor: number;
}

export interface LadderClass {
  /** Arbitration class by service (1 is the first arbitration year); a Super Two's extra trip sits in the last. */
  arbitrationClass: number;
  /** measured: the save's own; thin: below the minimum, the prior hulled with the save's line; prior: the prior alone. */
  status: 'measured' | 'thin' | 'prior' | 'unknown';
  /** The save's own contracts in the class (one-year, above the minimum, platform read). */
  cases: number;
  excluded: { atMinimum: number };
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
  /** The price of a win the ladder's shares are read against and an arbitration band multiplies. */
  price: Sourced<PriceBand>;
  preArbitration: RenewalSpread;
  arbitration: ArbitrationLadder;
  rules: { renewal: string; arbitration: string; prior: string; reserveClause: string };
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
const wins = (x: number): string => x.toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The inverted-CDF quantile (smallest value whose empirical CDF reaches p): unchanged by duplicating a sample. */
function quantile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length))) - 1;
  return sorted[i];
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
 * The distribution-free upper confidence bound of the q-th quantile: the smallest order statistic k with
 * P(Binomial(n, q) ≤ k − 1) ≥ confidence. Null when the sample is too small for any order statistic to bound it.
 */
function upperBoundOfQuantile(sorted: number[], q: number, confidence: number): number | null {
  const n = sorted.length;
  for (let k = 1; k <= n; k += 1) {
    if (binomialCdf(k - 1, n, q) >= confidence) return sorted[k - 1];
  }
  return null;
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

const RENEWAL_RULE = () =>
  `A pre-arbitration renewal costs from the league minimum to the ${pct(COST_POLICY.renewal.confidence)} upper confidence bound of the ` +
  `${pct(COST_POLICY.renewal.quantile)} point of the save's own pre-arbitration one-year renewals this season (Player Rights' pre-arbitration answer), ` +
  `measured at each import; below ${COST_POLICY.renewal.minimumCases} renewals, the provisional prior widened by the save's own renewals where the regime as read is MLB's.`;

function renewalSpread(rows: Row[], minimum: number, regime: ArbitrationRegime): RenewalSpread {
  const renewals = rows.filter((r) => r.eligibility?.standing === 'pre_arbitration' && r.oneYear && r.salary !== null);
  const pay = renewals.map((r) => r.salary as number).sort((a, b) => a - b);
  const n = pay.length;
  const atMinimum = pay.filter((x) => x <= minimum).length;
  const source = 'players_contract (one-year pre-arbitration renewals, this season)';
  if (n >= COST_POLICY.renewal.minimumCases) {
    const bound = upperBoundOfQuantile(pay, COST_POLICY.renewal.quantile, COST_POLICY.renewal.confidence);
    if (bound !== null) {
      const band = { low: minimum, high: Math.max(minimum, bound) };
      const text = `Measured on this save's ${n} pre-arbitration renewals (${atMinimum} at the minimum): ${millions(band.low)} to ${millions(band.high)}.`;
      return { status: 'measured', band: derivedFrom(band, source, text), cases: n, atMinimum, text };
    }
  }
  const thin = `${plural(n, 'pre-arbitration renewal')} this season, fewer than the policy minimum of ${COST_POLICY.renewal.minimumCases}`;
  if (regime.mlb !== true) {
    const why = regime.mlb === false
      ? `and the provisional prior (MLB's real-world renewals) is used only where the regime as read is MLB's: ${regime.basis}`
      : `and whether the regime is MLB's (where the provisional prior applies) is not established: ${regime.basis}`;
    const text = `Not established: ${thin}, ${why}`;
    return { status: 'unknown', band: unknownBecause('not_exported_by_ootp', source, text), cases: n, atMinimum, text };
  }
  const high = Math.max(minimum * COST_PRIOR.renewal.highOverMinimum, n > 0 ? pay[n - 1] : minimum);
  const band = { low: minimum, high: Math.max(minimum, high) };
  const text = `Provisional: ${thin}, so the provisional prior (${COST_PRIOR.source}) widened by the save's own renewals: ${millions(band.low)} to ${millions(band.high)}.`;
  return { status: 'provisional', band: derivedFrom(band, source, text), cases: n, atMinimum, text };
}

// ── the arbitration ladder ───────────────────────────────────────────────────

interface Case {
  platform: number;
  above: number;
}

/** The class's line by least squares, its spread and its uncertainty; null below the cases a line needs. */
function lineOf(cases: Case[], price: number): CostReading | null {
  const n = cases.length;
  if (n < COST_POLICY.ladder.fitCases) return null;
  const mx = cases.reduce((s, c) => s + c.platform, 0) / n;
  const my = cases.reduce((s, c) => s + c.above, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const c of cases) {
    sxx += (c.platform - mx) ** 2;
    sxy += (c.platform - mx) * (c.above - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const base = my - slope * mx;
  const residuals = cases.map((c) => c.above - (base + slope * c.platform)).sort((a, b) => a - b);
  const ssr = residuals.reduce((s, r) => s + r * r, 0);
  return {
    source: 'save',
    cases: n,
    base,
    share: slope / price,
    spread: { low: quantile(residuals, COST_POLICY.ladder.spread.low), high: quantile(residuals, COST_POLICY.ladder.spread.high) },
    line: { sigma: Math.sqrt(ssr / Math.max(1, n - 2)), meanPlatform: mx, sumSquares: sxx },
    floor: Math.min(...cases.map((c) => c.above)),
  };
}

function priorReading(arbitrationClass: number, minimum: number): CostReading | null {
  const p = COST_PRIOR.ladder.find((c) => c.arbitrationClass === arbitrationClass);
  if (!p) return null;
  return {
    source: 'prior',
    cases: p.cases,
    base: p.baseOverMinimum * minimum,
    share: p.share,
    spread: { low: p.spreadOverMinimum.low * minimum, high: p.spreadOverMinimum.high * minimum },
    line: { sigma: p.sigmaOverMinimum * minimum, meanPlatform: p.meanPlatform, sumSquares: p.sumSquares },
    floor: p.floorOverMinimum * minimum,
  };
}

const PLATFORM_TEXT = () =>
  `the mean WAR of the ${COST_POLICY.ladder.platformSeasons} seasons before the arbitration winter (the platform season and the one before it), each on its schedule's footing; a season with no line counts 0`;

const ARBITRATION_RULE = () =>
  `An arbitration season costs the league minimum plus its class's line: a base (the class's pay at no platform wins) and a share of the price of a win per platform win, ` +
  `against ${PLATFORM_TEXT()}. The class's spread is the ${pct(COST_POLICY.ladder.spread.low)} to ${pct(COST_POLICY.ladder.spread.high)} of its pay around the line, ` +
  `widened by ${COST_POLICY.ladder.lineErrors} of the line's standard errors; never below the least the class was paid above the minimum. Read on this import's one-year ` +
  `contracts of players Player Rights finds in arbitration, by class; a contract at the league minimum is not read as an arbitration salary. ` +
  `Below ${COST_POLICY.ladder.minimumCases} contracts, a class is the provisional prior hulled with the save's own line, only where the regime as read is MLB's.`;

function classText(c: Omit<LadderClass, 'text'>, price: number): string {
  const head = `Arbitration class ${c.arbitrationClass}`;
  if (c.status === 'unknown') return `${head}: not established. ${c.reason ?? ''}`.trim();
  const own = c.readings.find((r) => r.source === 'save');
  const shown = own ?? c.readings[0];
  const line = `${millions(shown.base)} above the minimum plus ${pct(shown.share)} of the price of a win (${millions(shown.share * price)}) per platform win, ` +
    `80% of its pay within ${signed(shown.spread.low)} to ${signed(shown.spread.high)} of that line`;
  const minExcluded = c.excluded.atMinimum > 0 ? `; ${c.excluded.atMinimum} at the minimum left out` : '';
  if (c.status === 'measured') return `${head}: measured on ${c.cases} contracts${minExcluded}: ${line}.`;
  if (c.status === 'thin') return `${head}: provisional, ${c.cases} contracts (fewer than ${COST_POLICY.ladder.minimumCases})${minExcluded}, hulled with the prior; the save's own line: ${line}.`;
  return `${head}: provisional prior (${plural(c.cases, 'contract')} of the save's own, too few for a line)${minExcluded}: ${line}.`;
}

function arbitrationLadder(rows: Row[], input: CostLadderInput, minimum: number | null, dollars: string | null): ArbitrationLadder {
  const { regime } = input;
  const platform = PLATFORM_TEXT();
  if (regime.status === 'no_arbitration' || regime.status === 'reserve_clause') {
    return { status: 'no_arbitration', regime, classes: [], platform, reason: regime.basis };
  }
  if (regime.status !== 'arbitration' || regime.classes === null) {
    return { status: 'unknown', regime, classes: [], platform, reason: `No arbitration ladder: ${regime.basis}` };
  }
  const classes = Array.from({ length: regime.classes }, (_, i) => i + 1);
  const allUnknown = (reason: string): ArbitrationLadder => ({
    status: 'unknown', regime, platform, reason,
    classes: classes.map((k) => {
      const c = { arbitrationClass: k, status: 'unknown' as const, cases: 0, excluded: { atMinimum: 0 }, readings: [], ratioShare: null, reason };
      return { ...c, text: classText(c, 0) };
    }),
  });
  if (dollars !== null || minimum === null) return allUnknown(dollars ?? 'The league minimum is not established.');
  const price = input.price.value;
  if (price === null) return allUnknown(`The price of a win is unknown here (${input.price.note ?? 'not stated'}), so no arbitration salary can be read as a share of it.`);
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
    const atMinimum = inClass.filter((r) => (r.salary as number) <= minimum).length;
    const cases: Case[] = inClass.filter((r) => (r.salary as number) > minimum)
      .map((r) => ({ platform: platformOf(r.playerId), above: (r.salary as number) - minimum }));
    const positive = cases.reduce((s, c) => s + Math.max(0, c.platform), 0);
    const ratioShare = positive > 0 ? cases.reduce((s, c) => s + c.above, 0) / positive / price.central : null;
    const own = lineOf(cases, price.central);
    const base = { arbitrationClass: k, cases: cases.length, excluded: { atMinimum }, ratioShare };
    let c: Omit<LadderClass, 'text'>;
    if (own && cases.length >= COST_POLICY.ladder.minimumCases) {
      c = { ...base, status: 'measured', readings: [own], reason: null };
    } else {
      const thin = `${plural(cases.length, 'contract')} in class ${k}, fewer than the policy minimum of ${COST_POLICY.ladder.minimumCases}`;
      const prior = regime.mlb === true ? priorReading(k, minimum) : null;
      if (prior) {
        c = own
          ? { ...base, status: 'thin', readings: [own, prior], reason: `${thin}: the provisional prior hulled with the save's own line.` }
          : { ...base, status: 'prior', readings: [prior], reason: `${thin}, too few for a line: the provisional prior.` };
      } else {
        const why = regime.mlb === false
          ? `the provisional prior (MLB's real-world contracts) is used only where the regime as read is MLB's, and this one is not (${regime.basis})`
          : regime.mlb === null ? `whether the regime is MLB's is not established (${regime.basis})` : 'the prior has no such class';
        c = { ...base, status: 'unknown', readings: [], reason: `Not established: ${thin}, and ${why}.` };
      }
    }
    return { ...c, text: classText(c, price.central) };
  });
  const statuses = new Set(out.map((c) => c.status));
  const status: ArbitrationLadder['status'] = statuses.size === 1 && statuses.has('measured') ? 'measured'
    : statuses.size === 1 && statuses.has('unknown') ? 'unknown'
      : statuses.has('unknown') ? 'partly_unknown'
        : statuses.has('measured') ? 'partly_provisional' : 'provisional';
  return { status, regime, classes: out, platform, reason: null };
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
  return {
    cost: derivedFrom({ ...r.band.value }, r.band.source ?? 'players_contract', note),
    basis: { method: 'renewal_spread', source, classes: [], cases: r.cases, platform: null, price: null, ifHeld: false, text: r.text },
  };
}

/**
 * One reading's band at a platform band and a price band: every corner, the line's error on each side, floored.
 * The save's own line was read on this import's salaries, so its dollars per platform win are observed at the price's
 * central: the price band (the spread of the market's bases) is not applied to it a second time. The prior is stated
 * in shares of the price, so its reading into this save's money carries the whole price band.
 */
function readingBand(r: CostReading, platform: { low: number; high: number }, price: { low: number; central: number; high: number }): CostBand {
  const z = COST_POLICY.ladder.lineErrors;
  const se = (p: number) => (r.line.sumSquares > 0 && r.cases > 0
    ? r.line.sigma * Math.sqrt(1 / r.cases + (p - r.line.meanPlatform) ** 2 / r.line.sumSquares)
    : r.line.sigma);
  const lows: number[] = [];
  const highs: number[] = [];
  for (const p of [platform.low, platform.high]) {
    const perWins = r.source === 'save' ? [r.share * price.central] : [r.share * price.low, r.share * price.high];
    for (const perWin of perWins) {
      const fitted = r.base + perWin * p;
      lows.push(fitted + r.spread.low - z * se(p));
      highs.push(fitted + r.spread.high + z * se(p));
    }
  }
  const low = Math.max(Math.min(...lows), r.floor);
  return { low, high: Math.max(Math.max(...highs), low) };
}

function platformBand(season: number, input: PriceControlInput): { value: { seasons: number[]; low: number; high: number } } | { reason: string } {
  const thisSeason = input.control.thisSeason as number;
  const seasons = Array.from({ length: COST_POLICY.ladder.platformSeasons }, (_, i) => season - COST_POLICY.ladder.platformSeasons + i);
  let low = 0;
  let high = 0;
  for (const y of seasons) {
    if (y < thisSeason) {
      const w = input.pastWins(y);
      if (w === null) return { reason: `His ${y} WAR, a platform season, is not established on a full season's footing.` };
      low += w;
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
    high += s.wins.high;
  }
  return { value: { seasons, low: low / seasons.length, high: high / seasons.length } };
}

function priceArbitration(
  season: number, trip: { low: number; high: number } | null, input: PriceControlInput, ladder: CostLadder
): Priced {
  const a = ladder.arbitration;
  if (a.status === 'no_arbitration' || a.classes.length === 0) return unknownCost(`Arbitration not priced: ${a.reason ?? 'the league has no arbitration ladder'}`);
  const top = a.classes.length;
  const wanted = trip === null
    ? a.classes.map((c) => c.arbitrationClass)
    : [...new Set(Array.from({ length: trip.high - trip.low + 1 }, (_, i) => Math.min(top, Math.max(1, trip.low + i))))];
  const classes = wanted.map((k) => a.classes.find((c) => c.arbitrationClass === k));
  const missing = classes.find((c) => !c || c.status === 'unknown');
  if (missing !== undefined) return unknownCost(`Arbitration not priced: ${missing?.reason ?? 'its class is not in the ladder'}`);
  const price = ladder.price.value;
  if (price === null) return unknownCost(`Arbitration not priced: the price of a win is unknown here (${ladder.price.note ?? 'not stated'}).`);
  const minimum = ladder.minimum.value as number;
  const platform = platformBand(season, input);
  if ('reason' in platform) return unknownCost(platform.reason);

  let low = Infinity;
  let high = -Infinity;
  for (const c of classes as LadderClass[]) {
    for (const r of c.readings) {
      const b = readingBand(r, platform.value, price);
      low = Math.min(low, b.low);
      high = Math.max(high, b.high);
    }
  }
  const all = classes as LadderClass[];
  const source: CostBasis['source'] = all.every((c) => c.status === 'measured') ? 'measured'
    : all.every((c) => c.status === 'prior') ? 'provisional_prior' : 'measured_thin_with_prior';
  const cases = all.reduce((s, c) => s + c.cases, 0);
  const years = wanted.length === 1 ? `${wanted[0]}` : `${wanted[0]}–${wanted[wanted.length - 1]}`;
  const capped = trip !== null && trip.high > top ? ` (a Super Two's extra trip is inside class ${top}: the export cannot separate it)` : '';
  const counted = all.map((c) => `class ${c.arbitrationClass} ${c.status === 'measured' ? `measured on ${c.cases} contracts` : `provisional (${c.cases} of the save's contracts, the prior)`}`).join('; ');
  const p = platform.value;
  const text = `Arbitration ${trip === null ? `class ${years} (which trip is not established)` : `class ${years}`}${capped}: the save's ladder (${counted}) × platform ${p.seasons[0]}–${p.seasons[p.seasons.length - 1]} production ` +
    `${wins(p.low)} to ${wins(p.high)} wins, ` +
    (source === 'measured'
      ? `in this import's own dollars (the line was read on its salaries, at the price of a win's central ${millions(price.central)}).`
      : `the save's own line in this import's dollars and the provisional prior's shares × the price of a win ${millions(price.low)}–${millions(price.high)}; provisional where the class is thinner than the policy minimum.`);
  return {
    cost: derivedFrom({ low: minimum + low, high: minimum + high }, 'players_contract (this season\'s one-year arbitration contracts) + production + the price of a win', text),
    basis: { method: 'arbitration_ladder', source, classes: wanted, cases, platform: p, price: { low: price.low, high: price.high }, ifHeld: false, text },
  };
}

const HELD: ControlStatus[] = ['pre_arbitration', 'arbitration'];

/** The cost of a status Player Rights stated (or each it lies between), for a season no contract covers. */
function priceStatus(
  season: number, status: ControlStatus, between: ControlStatus[], e: SeasonControlEligibility | null, input: PriceControlInput
): Priced {
  const ladder = input.ladder;
  if (ladder === null) return unknownCost("Not priced: his league's cost ladder could not be read.");
  if (status === 'pre_arbitration') return priceRenewal(ladder);
  if (status === 'arbitration') return priceArbitration(season, e?.arbitration.trip ?? null, input, ladder);
  if (status !== 'indeterminate' || between.length === 0) return unknownCost("The season's control is not established, so neither is its cost.");

  const mayLeave = between.includes('free_agent');
  const other = between.filter((b) => b !== 'free_agent' && !HELD.includes(b));
  if (other.length > 0) {
    return unknownCost(`Not priced: the season may be ${other.map((b) => b.replace('_', ' ')).join(' or ')}, whose cost is not established.`);
  }
  const branches = between.filter((b) => HELD.includes(b)).map((b) => (b === 'pre_arbitration'
    ? priceRenewal(ladder)
    : priceArbitration(season, e?.arbitration.trip ?? e?.arbitration.tripIfEligible ?? null, input, ladder)));
  if (branches.length === 0) return unknownCost('Not priced: no status he could hold is priced.');
  const unknown = branches.find((b) => b.cost.value === null);
  if (unknown) return unknownCost(`Not priced across the statuses the season lies between: ${unknown.cost.note ?? ''}`);
  const low = Math.min(...branches.map((b) => (b.cost.value as CostBand).low));
  const high = Math.max(...branches.map((b) => (b.cost.value as CostBand).high));
  const bases = branches.map((b) => b.basis as CostBasis);
  const source: CostBasis['source'] = bases.every((b) => b.source === 'measured') ? 'measured'
    : bases.every((b) => b.source === 'provisional_prior') ? 'provisional_prior' : 'measured_thin_with_prior';
  const arbitration = bases.find((b) => b.method === 'arbitration_ladder') ?? null;
  const leave = mayLeave ? ' He may instead be a free agent (control ends, no cost to this club): this is what he costs if the club holds him.' : '';
  const text = `Between ${between.map((b) => b.replace('_', ' ')).join(' and ')}: covering each. ${bases.map((b) => b.text).join(' ')}${leave}`;
  return {
    cost: derivedFrom({ low, high }, 'the cost ladder, across each status', text),
    basis: {
      method: bases.length > 1 ? 'between' : bases[0].method, source, classes: arbitration?.classes ?? [],
      cases: bases.reduce((s, b) => s + b.cases, 0), platform: arbitration?.platform ?? null, price: arbitration?.price ?? null,
      ifHeld: mayLeave, text,
    },
  };
}

const unpriced = (cost: Sourced<CostBand> | null): boolean => cost !== null && cost.value === null && cost.note === COST_NOT_PRICED;

/**
 * The control timeline with each season no contract covers priced (phase 4a): a renewal, an arbitration
 * season, an open season across each status it could be, and an option's or opt-out's declined branch.
 * Contract seasons, free agency and a reserve-clause renewal are left as they are.
 */
export function priceControlTimeline(input: PriceControlInput): ControlTimeline {
  const { control } = input;
  if (control.thisSeason === null || control.seasons.length === 0) return control;
  const seasons: ControlSeason[] = control.seasons.map((s) => {
    const e = control.eligibility?.seasons.find((x) => x.season === s.season) ?? null;
    let next: ControlSeason = s;
    if (unpriced(s.cost)) {
      const p = priceStatus(s.season, s.status, s.between, e, input);
      next = { ...next, cost: p.cost, costBasis: p.basis };
    }
    if (s.declined && unpriced(s.declined.cost)) {
      const p = priceStatus(s.season, s.declined.status, s.declined.between, e, input);
      next = { ...next, declined: { ...s.declined, cost: p.cost, costBasis: p.basis } };
    }
    return next;
  });
  return { ...control, seasons };
}

/** The class line and the renewal bound, for the readings observed across imports (phase 4b, `playerValueSignings.ts`): one method. */
export { lineOf, upperBoundOfQuantile };
