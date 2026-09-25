/**
 * The detector's error rates, measured (D-053 amendment, owner 2026-09-25; docs/CALIBRATION.md section 13).
 *
 *   npm run calibrate detector [-- --reps 400]
 *
 * Simulated leagues with KNOWN dynamics, sized like the Arizona import's major league (about 300 hitter, 120 starter and 190
 * reliever target seasons a year), are put through the same nested backtest and the same "clearly better" rule the refit uses
 * (`mlbResultsFit.backtestPart`, `calibrationDetector.decide`):
 *
 *   false adoption  leagues whose true dynamics are the starting values' (the starting values are within a hair of the best the
 *                   method can do on an unlimited sample): how often the save's values are wrongly adopted. Target: at most 5%.
 *   power           leagues whose true dynamics clearly differ (recent seasons count far more; results much noisier or much
 *                   steadier; a fictional-league-sized shift of both): how often they are correctly adopted, by seasons of history.
 *
 * A player's true level is a permanent part plus a part that drifts from season to season (first-order autoregressive); a season's
 * result is his level plus noise that shrinks with his opportunities. Careers, part-time players and roster turnover are simulated, so
 * players come and go with one, two or three prior seasons as in a real league. Seeded, so a run is repeatable. Nothing here reads the
 * save or writes anything.
 */

import { backtestPart, fitPart, RESULTS_FIT_POLICY, type PartValues, type ResultsCase, type ResultsPart } from '../../server/mlbResultsFit.js';
import { decide, DETECTOR_POLICY, type DetectorDecision, type ServedSource } from '../../server/calibrationDetector.js';
import { RESULTS_PRIOR } from '../../server/resultsMetrics.js';

export interface SimSpec {
  /** Target seasons (the history the detector sees; three more seasons before them supply the first targets' prior seasons). */
  seasons: number;
  /** About how many target cases a season yields. */
  perSeason: number;
  /** The spread of true talent (standard deviation, in the result's units), and the share of its variance that is permanent. */
  talentSd: number;
  permanentShare: number;
  /** How much the drifting part carries over from one season to the next. */
  rho: number;
  /** A single opportunity's noise (standard deviation): a season's noise is this over the square root of its opportunities. */
  noise: number;
  /** Pitchers: the runs measure's noise per opportunity (the peripherals use `noise`); the target is runs. */
  runsNoise?: number;
  /** Opportunities a season: regulars (a share) uniform in [regular], part-timers in [part]. */
  regular: [number, number];
  part: [number, number];
  regularShare: number;
  minTarget: number;
  seed: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function normal(r: () => number): () => number {
  return () => {
    const u = Math.max(r(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
}

/** A simulated league: its target cases (centred on each season's mean, as the refit's reader centres) and target seasons. */
export function simulateLeague(spec: SimSpec): { cases: ResultsCase[]; targets: number[] } {
  const r = rng(spec.seed);
  const z = normal(r);
  const total = spec.seasons + 3;
  const pitcher = spec.runsNoise !== undefined;
  const roster = Math.round(spec.perSeason / 0.62);
  const sdP = spec.talentSd * Math.sqrt(spec.permanentShare);
  const sdT = spec.talentSd * Math.sqrt(1 - spec.permanentShare);
  type P = { id: number; mu: number; u: number; seasons: Map<number, { x: number; runs: number; n: number }> };
  const players: P[] = [];
  let active: P[] = [];
  let next = 1;
  for (let s = 0; s < total; s += 1) {
    active = active.filter(() => r() < 0.85);
    while (active.length < roster) {
      const p: P = { id: next++, mu: sdP * z(), u: sdT * z(), seasons: new Map() };
      players.push(p);
      active.push(p);
    }
    for (const p of active) {
      if (p.seasons.size > 0) p.u = spec.rho * p.u + Math.sqrt(1 - spec.rho * spec.rho) * sdT * z();
      const n = r() < spec.regularShare ? spec.regular[0] + r() * (spec.regular[1] - spec.regular[0]) : spec.part[0] + r() * (spec.part[1] - spec.part[0]);
      const theta = p.mu + p.u;
      p.seasons.set(s, { x: theta + (spec.noise / Math.sqrt(n)) * z(), runs: pitcher ? theta + ((spec.runsNoise as number) / Math.sqrt(n)) * z() : 0, n: Math.round(n) });
    }
  }
  // Centre each season on its opportunity-weighted mean
  const mean = new Map<number, { x: number; runs: number }>();
  for (let s = 0; s < total; s += 1) {
    let w = 0, x = 0, ru = 0;
    for (const p of players) { const l = p.seasons.get(s); if (l) { w += l.n; x += l.x * l.n; ru += l.runs * l.n; } }
    mean.set(s, { x: x / w, runs: ru / w });
  }
  const cases: ResultsCase[] = [];
  const targets: number[] = [];
  for (let s = 3; s < total; s += 1) targets.push(s);
  for (const p of players) {
    for (const s of targets) {
      const t = p.seasons.get(s);
      if (!t || t.n < spec.minTarget) continue;
      const lag = (k: number, runs: boolean) => { const l = p.seasons.get(s - k); return l ? { v: (runs ? l.runs : l.x) - (runs ? mean.get(s - k)!.runs : mean.get(s - k)!.x), n: l.n } : null; };
      const lags = [1, 2, 3].map((k) => lag(k, false));
      if (lags.every((l) => l === null)) continue;
      cases.push({
        playerId: p.id, target: s, n: t.n, y: pitcher ? t.runs - mean.get(s)!.runs : t.x - mean.get(s)!.x, lags,
        ...(pitcher ? { runs: [1, 2, 3].map((k) => lag(k, true)) } : {}),
      });
    }
  }
  return { cases, targets };
}

const MIX = 0.85;

/** One simulated league put through the refit's backtest and the detector. */
export function trial(spec: SimSpec, part: ResultsPart, previous: ServedSource = 'starting'): DetectorDecision {
  const { cases, targets } = simulateLeague(spec);
  const bt = backtestPart(cases, part, targets, MIX);
  return decide({ unshrunk: bt.unshrunk, served: bt.served, previous });
}

/** What the method finds on an unlimited sample of a spec (a very large league), and how much worse the starting values do there. */
export function population(spec: SimSpec, part: ResultsPart): { optimum: PartValues; startingRegret: number } {
  const big = simulateLeague({ ...spec, perSeason: spec.perSeason * 25, seasons: 12 });
  const fit = fitPart(big.cases, part, MIX);
  const start: PartValues = { weights: [...RESULTS_PRIOR.weights[part === 'starter' || part === 'reliever' ? part : 'hitter']], k: RESULTS_PRIOR.stabilization[part] };
  const at = fitPart(big.cases, part, MIX, { fixed: start, policy: { ...RESULTS_FIT_POLICY, grid: { ...RESULTS_FIT_POLICY.grid, k: { ...RESULTS_FIT_POLICY.grid.k, [part]: [start.k] } } } });
  return { optimum: fit!.values, startingRegret: at!.loss / fit!.loss - 1 };
}

/**
 * Kinds sized like the Arizona import's majors. Each null's talent structure was chosen so the method's best values on an unlimited
 * sample are the starting values' (or within a hair: the starting values' excess error there is printed with every run).
 */
export const HITTER_BASE: Omit<SimSpec, 'seed' | 'seasons'> = {
  perSeason: 300, talentSd: 0.026, permanentShare: 0.65, rho: 0.45, noise: 0.5,
  regular: [400, 700], part: [60, 400], regularShare: 0.6, minTarget: RESULTS_FIT_POLICY.minTarget.hitter,
};
export const STARTER_BASE: Omit<SimSpec, 'seed' | 'seasons'> = {
  perSeason: 120, talentSd: 0.5, permanentShare: 0.35, rho: 0.6, noise: 11, runsNoise: 16,
  regular: [550, 850], part: [100, 550], regularShare: 0.6, minTarget: RESULTS_FIT_POLICY.minTarget.starter,
};
export const RELIEVER_BASE: Omit<SimSpec, 'seed' | 'seasons'> = {
  perSeason: 190, talentSd: 0.55, permanentShare: 0.5, rho: 0.5, noise: 11, runsNoise: 16,
  regular: [200, 320], part: [40, 200], regularShare: 0.55, minTarget: RESULTS_FIT_POLICY.minTarget.reliever,
};

export interface Scenario {
  name: string;
  part: ResultsPart;
  spec: Omit<SimSpec, 'seed' | 'seasons'>;
  /** True when the starting values are the right answer (a false-adoption scenario). */
  isNull: boolean;
}

export const SCENARIOS: Scenario[] = [
  { name: 'hitters: true dynamics = the starting values', part: 'hitter', spec: HITTER_BASE, isNull: true },
  { name: 'starters: true dynamics = the starting values', part: 'starter', spec: STARTER_BASE, isNull: true },
  { name: 'relievers: true dynamics = the starting values', part: 'reliever', spec: RELIEVER_BASE, isNull: true },
  { name: 'hitters: recent seasons count more (talent drifts faster)', part: 'hitter', spec: { ...HITTER_BASE, permanentShare: 0.3, rho: 0.6 }, isNull: false },
  { name: 'hitters: recent seasons count far more', part: 'hitter', spec: { ...HITTER_BASE, permanentShare: 0.1, rho: 0.5 }, isNull: false },
  { name: 'hitters: results noisier (talent spread 0.018)', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.018 }, isNull: false },
  { name: 'hitters: results much noisier (talent spread 0.016)', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.016 }, isNull: false },
  { name: 'hitters: results much steadier (talent spread 0.040)', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.04 }, isNull: false },
  { name: 'hitters: a fictional-league-sized shift (faster drift, noisier)', part: 'hitter', spec: { ...HITTER_BASE, permanentShare: 0.3, rho: 0.5, talentSd: 0.017 }, isNull: false },
  { name: 'starters: a fictional-league-sized shift', part: 'starter', spec: { ...STARTER_BASE, permanentShare: 0.1, rho: 0.5, talentSd: 0.35 }, isNull: false },
  { name: 'relievers: a fictional-league-sized shift', part: 'reliever', spec: { ...RELIEVER_BASE, permanentShare: 0.1, rho: 0.5, talentSd: 0.35 }, isNull: false },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The harness section: each scenario's optimum on an unlimited sample and the starting values' excess error there, then how often
 * the save's values are adopted by seasons of history (false adoption for a null, power otherwise) and, where the save's values are
 * right, how often a later refit wrongly returns to the starting values once they serve (hysteresis).
 */
export function detectorSection(argv: string[]): void {
  const at = argv.indexOf('--reps');
  const reps = at >= 0 ? Number(argv[at + 1]) : 200;
  const seasonsList = [10, 12, 16, 20];
  console.log(`\n${'='.repeat(78)}\n13. The detector's error rates (simulated leagues; ${reps} leagues per cell, ${2 * reps} for a null)\n${'='.repeat(78)}`);
  console.log(`rule: z <= -${DETECTOR_POLICY.zClear}, better in >= ${Math.round(DETECTOR_POLICY.minOriginShare * 100)}% of seasons checked (and >= ${DETECTOR_POLICY.minOriginsWon}), >= ${pct(DETECTOR_POLICY.minRelativeGain)} lower error; unshrunk AND as served`);
  const rate = (n: number, of: number) => `${pct(n / of)} (se ${pct(Math.sqrt((n / of) * (1 - n / of) / of))})`;
  for (const sc of SCENARIOS) {
    const pop = population({ ...sc.spec, seasons: 12, seed: 7 }, sc.part);
    const start = RESULTS_PRIOR.weights[sc.part === 'starter' || sc.part === 'reliever' ? sc.part : 'hitter'].join('/');
    console.log(`\n${sc.name}\n  unlimited sample: best ${pop.optimum.weights.join('/')}, K ${pop.optimum.k} (starting ${start}, K ${RESULTS_PRIOR.stabilization[sc.part]}); the starting values' excess error there ${pct(pop.startingRegret)}`);
    const n = sc.isNull ? 2 * reps : reps;
    const row: string[] = [];
    for (const seasons of seasonsList) {
      let adopted = 0;
      for (let i = 0; i < n; i += 1) if (trial({ ...sc.spec, seasons, seed: 1000 * seasons + i + 1 }, sc.part).serve === 'save') adopted += 1;
      row.push(`${seasons} seasons ${rate(adopted, n)}`);
    }
    console.log(`  ${sc.isNull ? 'FALSE ADOPTION' : 'adopted (power)'}: ${row.join('; ')}`);
    if (!sc.isNull) {
      let back = 0;
      for (let i = 0; i < reps; i += 1) if (trial({ ...sc.spec, seasons: 20, seed: 777000 + i }, sc.part, 'save').serve === 'starting') back += 1;
      console.log(`  once the save's values serve, a refit wrongly returns to the starting values (20 seasons): ${rate(back, reps)}`);
    }
  }
}
