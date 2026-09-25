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
import { decide, DETECTOR_METHOD, DETECTOR_POLICY, ruleText, type DetectorDecision, type DetectorPolicy, type ServedSource } from '../../server/calibrationDetector.js';
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
  /**
   * Season-to-season heterogeneity: a season's noise is scaled by exp(this x a standard normal) (0.25 is about +/-25%), and its drift
   * carry-over is `rho` plus a uniform draw within +/- `rhoSpread`. Everything a season shares moves all its players together.
   */
  seasonNoiseSd?: number;
  rhoSpread?: number;
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
  const mult: number[] = [];
  const rhos: number[] = [];
  for (let s = 0; s < total; s += 1) {
    mult.push(Math.exp((spec.seasonNoiseSd ?? 0) * z()));
    rhos.push(Math.min(0.95, Math.max(0, spec.rho + (spec.rhoSpread ?? 0) * (2 * r() - 1))));
  }
  for (let s = 0; s < total; s += 1) {
    active = active.filter(() => r() < 0.85);
    while (active.length < roster) {
      const p: P = { id: next++, mu: sdP * z(), u: sdT * z(), seasons: new Map() };
      players.push(p);
      active.push(p);
    }
    for (const p of active) {
      if (p.seasons.size > 0) p.u = rhos[s] * p.u + Math.sqrt(1 - rhos[s] * rhos[s]) * sdT * z();
      const n = r() < spec.regularShare ? spec.regular[0] + r() * (spec.regular[1] - spec.regular[0]) : spec.part[0] + r() * (spec.part[1] - spec.part[0]);
      const theta = p.mu + p.u;
      p.seasons.set(s, { x: theta + mult[s] * (spec.noise / Math.sqrt(n)) * z(), runs: pitcher ? theta + mult[s] * ((spec.runsNoise as number) / Math.sqrt(n)) * z() : 0, n: Math.round(n) });
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

/** One simulated league put through the refit's backtest and the detector, at one refit. */
export function trial(spec: SimSpec, part: ResultsPart, previous: ServedSource = 'starting', policy: DetectorPolicy = DETECTOR_POLICY): DetectorDecision {
  const { cases, targets } = simulateLeague(spec);
  const bt = backtestPart(cases, part, targets.slice(-RESULTS_FIT_POLICY.windowSeasons), MIX);
  return decide({ unshrunk: bt.unshrunk, served: bt.served, previous }, policy);
}

/**
 * A save's lifetime: one league refitted after every completed season, from `from` to `to` seasons of history (the window the refit
 * uses, the last 20), each refit carrying what served before it and the confirmation count (hysteresis), as the refit does.
 */
export function lifetime(
  spec: SimSpec, part: ResultsPart, from = 10, to = 22, policy: DetectorPolicy = DETECTOR_POLICY,
  onRefit?: (seasons: number, decision: DetectorDecision) => void, start: ServedSource = 'starting',
): { ever: boolean; atEnd: ServedSource; firstAt: number | null; returned: boolean } {
  const { cases, targets } = simulateLeague({ ...spec, seasons: to });
  let previous: ServedSource = start;
  let streak = 0;
  let ever = false;
  let returned = false;
  let firstAt: number | null = null;
  for (let n = from; n <= to; n += 1) {
    const window = targets.slice(0, n).slice(-RESULTS_FIT_POLICY.windowSeasons);
    const inWindow = new Set(window);
    const bt = backtestPart(cases.filter((c) => inWindow.has(c.target)), part, window, MIX);
    const d = decide({ unshrunk: bt.unshrunk, served: bt.served, previous, streak }, policy);
    onRefit?.(n, d);
    if (d.decided) {
      if (previous === 'save' && d.serve === 'starting') returned = true;
      previous = d.serve;
      streak = d.streak;
    }
    if (start === 'starting' && previous === 'save' && !ever) { ever = true; firstAt = n; }
  }
  return { ever, atEnd: previous, firstAt, returned };
}

/**
 * What the method finds on an unlimited sample of a spec (a very large league over many seasons, so season-to-season draws average
 * out), and how much more error the starting values make there: the league's TRUE excess of the starting values.
 */
export function population(spec: SimSpec, part: ResultsPart): { optimum: PartValues; startingRegret: number } {
  const big = simulateLeague({ ...spec, perSeason: spec.perSeason * 10, seasons: 40 });
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
  /** A false-adoption scenario (the starting values are right, or within the practical minimum of the best), or a power one. */
  isNull: boolean;
}

/** Season-to-season heterogeneity at the level the lifetime target is set for: a season's noise +/-25%, its drift carry-over +/-0.3. */
export const HETEROGENEOUS = { seasonNoiseSd: 0.25, rhoSpread: 0.3 } as const;
const het = (spec: Omit<SimSpec, 'seed' | 'seasons'>) => ({ ...spec, ...HETEROGENEOUS });

/**
 * The nulls: the starting values exactly right, and the least-favourable ones inside the practical minimum, where the starting
 * values make about 0.5% and 0.9% to 1.0% more error than the best (results noisier than the starting K assumes), each stationary and
 * with season-to-season heterogeneity. Then the power scenarios.
 */
export const SCENARIOS: Scenario[] = [
  { name: 'hitters: the starting values exactly right', part: 'hitter', spec: HITTER_BASE, isNull: true },
  { name: 'hitters: the starting values exactly right, seasons differ', part: 'hitter', spec: het(HITTER_BASE), isNull: true },
  { name: 'hitters: the starting values about 0.5% worse', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.022 }, isNull: true },
  { name: 'hitters: the starting values about 0.5% worse, seasons differ', part: 'hitter', spec: het({ ...HITTER_BASE, talentSd: 0.0232 }), isNull: true },
  { name: 'hitters: the starting values about 0.9% worse', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.0205 }, isNull: true },
  { name: 'hitters: the starting values about 0.9% worse, seasons differ', part: 'hitter', spec: het({ ...HITTER_BASE, talentSd: 0.0215 }), isNull: true },
  { name: 'starters: the starting values exactly right, seasons differ', part: 'starter', spec: het(STARTER_BASE), isNull: true },
  { name: 'starters: the starting values about 0.9% worse, seasons differ', part: 'starter', spec: het({ ...STARTER_BASE, talentSd: 0.345 }), isNull: true },
  { name: 'relievers: the starting values exactly right, seasons differ', part: 'reliever', spec: het(RELIEVER_BASE), isNull: true },
  { name: 'relievers: the starting values about 0.9% worse, seasons differ', part: 'reliever', spec: het({ ...RELIEVER_BASE, talentSd: 0.305 }), isNull: true },
  { name: 'hitters: results noisier (about 2% worse)', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.018 }, isNull: false },
  { name: 'hitters: results noisier (about 2% worse), seasons differ', part: 'hitter', spec: het({ ...HITTER_BASE, talentSd: 0.018 }), isNull: false },
  { name: 'hitters: results much noisier (about 3% worse)', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.016 }, isNull: false },
  { name: 'hitters: results much steadier', part: 'hitter', spec: { ...HITTER_BASE, talentSd: 0.04 }, isNull: false },
  { name: 'hitters: recent seasons count far more', part: 'hitter', spec: { ...HITTER_BASE, permanentShare: 0.1, rho: 0.5 }, isNull: false },
  { name: 'hitters: a fictional-league-sized shift (faster drift, noisier)', part: 'hitter', spec: { ...HITTER_BASE, permanentShare: 0.3, rho: 0.5, talentSd: 0.017 }, isNull: false },
  { name: 'hitters: a fictional-league-sized shift, seasons differ', part: 'hitter', spec: het({ ...HITTER_BASE, permanentShare: 0.3, rho: 0.5, talentSd: 0.017 }), isNull: false },
  { name: 'starters: a fictional-league-sized shift', part: 'starter', spec: { ...STARTER_BASE, permanentShare: 0.1, rho: 0.5, talentSd: 0.35 }, isNull: false },
  { name: 'relievers: a fictional-league-sized shift', part: 'reliever', spec: { ...RELIEVER_BASE, permanentShare: 0.1, rho: 0.5, talentSd: 0.35 }, isNull: false },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The harness section. For each scenario: the league's TRUE excess of the starting values (on an unlimited sample), then a save's
 * lifetime, refitted after every completed season from 10 to 22 seasons of history with hysteresis and confirmation as the refit does:
 * how often the save's values are ever adopted (false adoption for a null, power otherwise), the season of the first adoption, and how
 * often a single refit finds them clearly better at 12, 16 and 20 seasons. For a power scenario, also how often a refit wrongly
 * returns to the starting values once the save's values serve. `--reps N` leagues a scenario (twice that for a null); `--only i,j`
 * runs those scenarios (the harness runs them in parallel processes).
 */
export function detectorSection(argv: string[]): void {
  const at = argv.indexOf('--reps');
  const reps = at >= 0 ? Number(argv[at + 1]) : 200;
  const only = argv.indexOf('--only') >= 0 ? new Set(argv[argv.indexOf('--only') + 1].split(',').map(Number)) : null;
  console.log(`\n${'='.repeat(78)}\n13. The detector's error rates (${DETECTOR_METHOD}; simulated leagues; ${reps} leagues a scenario, ${2 * reps} for a null)\n${'='.repeat(78)}`);
  console.log(`rule: ${ruleText()}`);
  const rate = (n: number, of: number) => `${pct(n / of)} (se ${pct(Math.sqrt(Math.max(n, 0.5) / of * (1 - n / of) / of))})`;
  SCENARIOS.forEach((sc, idx) => {
    if (only && !only.has(idx)) return;
    const excess = [7, 8].map((seed) => population({ ...sc.spec, seasons: 12, seed }, sc.part));
    const trueExcess = (excess[0].startingRegret + excess[1].startingRegret) / 2;
    const n = sc.isNull ? 2 * reps : reps;
    let ever = 0;
    const firsts: number[] = [];
    const signal = new Map<number, number>([[12, 0], [16, 0], [20, 0]]);
    for (let i = 0; i < n; i += 1) {
      const life = lifetime({ ...sc.spec, seasons: 22, seed: 50000 + 1000 * idx + i }, sc.part, 10, 22, DETECTOR_POLICY, (seasons, d) => {
        if (signal.has(seasons) && d.unshrunk.clearlyBetter && d.served.clearlyBetter) signal.set(seasons, (signal.get(seasons) as number) + 1);
      });
      if (life.ever) { ever += 1; firsts.push(life.firstAt as number); }
    }
    firsts.sort((a, b) => a - b);
    console.log(`\n[${idx}] ${sc.name}\n  true excess of the starting values ${pct(trueExcess)} (unlimited sample: best ${excess[0].optimum.weights.join('/')}, K ${excess[0].optimum.k})`);
    console.log(`  ${sc.isNull ? 'LIFETIME FALSE ADOPTION' : 'LIFETIME ADOPTION (power)'} (refits at 10..22 seasons): ${rate(ever, n)}${firsts.length ? `; first adopted at ${firsts[0]}-${firsts[firsts.length - 1]} seasons (median ${firsts[Math.floor(firsts.length / 2)]})` : ''}`);
    console.log(`  clearly better at a single refit: ${[...signal].map(([s, k]) => `${s} seasons ${rate(k, n)}`).join('; ')}`);
    if (!sc.isNull) {
      let back = 0;
      for (let i = 0; i < reps; i += 1) {
        const life = lifetime({ ...sc.spec, seasons: 22, seed: 90000 + 1000 * idx + i }, sc.part, 10, 22, DETECTOR_POLICY, undefined, 'save');
        if (life.returned) back += 1;
      }
      console.log(`  once the save's values serve, a refit wrongly returns to the starting values (over 10..22 seasons): ${rate(back, reps)}`);
    }
  });
}
