/**
 * The platoon fit's error rates under the detector, measured (D-053, cycle 3; docs/CALIBRATION.md section 14).
 *
 *   npm run calibrate platoon-detector [-- --reps 400]
 *
 * Simulated leagues with KNOWN platoon dynamics, shaped like the Arizona import's major league (about 330 hitter-seasons a year to
 * predict, careers of several seasons, a hitter's split read over his five seasons before the target), are put through the same nested
 * backtest and the same "clearly better" rule the refit uses (`mlbPlatoonFit.fitPlatoon`, `calibrationDetector.decide`), refitted after
 * every completed season from 10 to 22 seasons of history, with hysteresis and confirmation exactly as the refit carries them.
 *
 * A hitter's platoon skill is constant over his career (the harness found no drift worth modelling), spread around his hand's norm
 * with a known standard deviation; a season's split is the skill plus noise with the variance of a split difference at his effective
 * plate appearances (wOBA's per-plate-appearance variance, .262 on the Arizona import). The best K is then that variance over the
 * skill's, and the starting K's TRUE excess error over the best is computed exactly on the simulated case mix. Seeded, so a run is
 * repeatable. Nothing here reads the save or writes anything.
 */

import { consecutivePlatoon, fitPlatoon, type PlatoonCase, type PlatoonInputCases, type PlatoonModel } from '../../server/mlbPlatoonFit.js';
import { DETECTOR_METHOD, ruleText } from '../../server/calibrationDetector.js';
import { PLATOON_PRIOR } from '../../server/platoon.js';

const VPA = 0.262;
const PER_SEASON = 330;

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}

interface Hitter { id: number; skill: number; first: number; last: number; eff: Map<number, number>; obs: Map<number, number> }

/** A league of `seasons` target seasons (plus five before them), hitters with careers of 3 to 12 seasons. */
export function simulatedLeague(trueK: number, seasons: number, seed: number): PlatoonInputCases {
  const r = rng(seed);
  const sd = Math.sqrt(VPA / trueK);
  const start = 1;
  const years = seasons + 5;
  const hitters: Hitter[] = [];
  let id = 1;
  const active = (y: number) => hitters.filter((h) => h.first <= y && h.last >= y).length;
  for (let y = start; y <= years; y += 1) {
    // keep about 1.3 x PER_SEASON hitters in the league (not all qualify as targets)
    while (active(y) < PER_SEASON * 1.3) {
      const len = 3 + Math.floor(10 * r.u());
      hitters.push({ id: id++, skill: sd * r.n(), first: y, last: y + len - 1, eff: new Map(), obs: new Map() });
    }
  }
  for (const h of hitters) {
    for (let y = h.first; y <= Math.min(h.last, years); y += 1) {
      const n = 20 + 160 * r.u();
      h.eff.set(y, n);
      h.obs.set(y, h.skill + Math.sqrt(VPA / n) * r.n());
    }
  }
  const cases: PlatoonCase[] = [];
  const targets = Array.from({ length: seasons }, (_, i) => 2000 + i);
  for (const h of hitters) {
    for (let k = 0; k < seasons; k += 1) {
      const y = start + 5 + k;
      const tn = h.eff.get(y);
      if (tn === undefined || tn < 45) continue;
      let n = 0;
      let s = 0;
      for (let b = y - 5; b < y; b += 1) { const e = h.eff.get(b); if (e !== undefined) { n += e; s += e * (h.obs.get(b) as number); } }
      if (n < 60) continue;
      cases.push({ playerId: h.id, target: targets[k], observed: s / n, effective: n, norm: 0, y: h.obs.get(y) as number, weight: tn });
    }
  }
  return { cases, seasons: targets, skipped: [], missing: null };
}

/** The exact expected loss of K on a case mix whose true skill spread is `sd` (per case: target noise + shrinkage bias + input noise). */
function expectedLoss(cases: PlatoonCase[], k: number, sd: number): number {
  let loss = 0;
  let w = 0;
  for (const c of cases) {
    const shrink = c.effective / (c.effective + k);
    loss += c.weight * (VPA / c.weight + (1 - shrink) ** 2 * sd * sd + shrink * shrink * VPA / c.effective);
    w += c.weight;
  }
  return loss / w;
}

/** The starting K's true excess error over the best K, on the simulated case mix (a very large league). */
export function trueExcess(trueK: number): number {
  const big = simulatedLeague(trueK, 40, 777);
  const sd = Math.sqrt(VPA / trueK);
  return expectedLoss(big.cases, PLATOON_PRIOR.shrinkAroundLeague, sd) / expectedLoss(big.cases, trueK, sd) - 1;
}

/** One league's lifetime: refits after every completed season from `from` to `to` seasons of targets. */
export function lifetime(trueK: number, seed: number, from = 10, to = 22): { ever: boolean; firstAt: number | null; atEnd: 'save' | 'starting'; single: Map<number, boolean> } {
  const league = simulatedLeague(trueK, to, seed);
  let previous: PlatoonModel | null = null;
  let ever = false;
  let firstAt: number | null = null;
  const single = new Map<number, boolean>();
  for (let s = from; s <= to; s += 1) {
    const through = league.seasons[s - 1];
    const run = fitPlatoon(league, { leagueId: 1, throughSeason: through, gameDate: null }, previous ? consecutivePlatoon(previous, true) : null);
    const d = run.model?.decision;
    if (d) single.set(s, d.unshrunk.clearlyBetter && d.served.clearlyBetter);
    // a refit that could not decide keeps the model in force (never recorded as adopted)
    if (run.record.gate.passed && run.model) previous = run.model;
    if (previous?.source === 'save' && !ever) { ever = true; firstAt = s; }
  }
  return { ever, firstAt, atEnd: previous?.source ?? 'starting', single };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function platoonDetectorSection(argv: string[]): void {
  const at = argv.indexOf('--reps');
  const reps = at >= 0 ? Number(argv[at + 1]) : 200;
  console.log(`\n${'='.repeat(78)}\n14. The platoon fit's error rates (${DETECTOR_METHOD}; simulated leagues; ${reps} leagues a scenario, ${2 * reps} for a null)\n${'='.repeat(78)}`);
  console.log(`rule: ${ruleText()}`);
  const scenarios: Array<{ name: string; k: number; isNull: boolean }> = [
    { name: 'the starting K exactly right', k: PLATOON_PRIOR.shrinkAroundLeague, isNull: true },
    { name: 'splits less individual than the starting K assumes', k: 20000, isNull: true },
    { name: 'splits somewhat more individual', k: 2000, isNull: true },
    { name: 'splits more individual, just under the practical minimum (the least favourable null)', k: 1200, isNull: true },
    { name: 'splits more individual (about the practical minimum)', k: 1000, isNull: false },
    { name: 'splits much more individual', k: 500, isNull: false },
    { name: 'splits far more individual', k: 250, isNull: false },
  ];
  for (const sc of scenarios) {
    const excess = trueExcess(sc.k);
    const n = sc.isNull || excess < 0.01 ? 2 * reps : reps;
    let ever = 0;
    let end = 0;
    const firsts: number[] = [];
    const single = new Map<number, number>([[12, 0], [16, 0], [20, 0]]);
    for (let i = 0; i < n; i += 1) {
      const life = lifetime(sc.k, 90000 + 1000 * sc.k + i);
      if (life.ever) { ever += 1; firsts.push(life.firstAt as number); }
      if (life.atEnd === 'save') end += 1;
      for (const s of single.keys()) if (life.single.get(s)) single.set(s, (single.get(s) as number) + 1);
    }
    firsts.sort((a, b) => a - b);
    const se = (k: number) => Math.sqrt(Math.max(k, 0.5) / n * (1 - k / n) / n);
    const nullUnderMinimum = excess < 0.01;
    console.log(`\n${sc.name}: true K ${sc.k}, true excess of the starting K ${(excess * 100).toFixed(2)}% (${nullUnderMinimum ? 'under the 1% practical minimum: a null' : 'over the practical minimum'})`);
    console.log(`  ${nullUnderMinimum ? 'LIFETIME FALSE ADOPTION' : 'LIFETIME ADOPTION (power)'} (refits at 10..22 seasons, ${n} leagues): ${pct(ever / n)} (se ${pct(se(ever))})${firsts.length ? `; first adopted at ${firsts[0]}-${firsts[firsts.length - 1]} seasons (median ${firsts[Math.floor(firsts.length / 2)]})` : ''}; serving the save's K at 22 seasons ${pct(end / n)}`);
    console.log(`  clearly better at a single refit: ${[...single].map(([s, k]) => `${s} seasons ${pct(k / n)}`).join('; ')}`);
  }
}
