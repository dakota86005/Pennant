/**
 * Calibration harness: tune the scouting layer's provisional constants against outcomes.
 *
 * Run it against an imported database (the app's own, or a copy):
 *
 *   OOTP_FO_DATA_DIR=<dir with league.db> npx tsx scripts/calibrate.ts [section ...]
 *
 * Sections: results pitchers tools platoon aging running defense leverage standards production (default: all), and, only when named:
 * roster-review (the roster review's per-save yardsticks, D-053 cycles 1 to 3, including the platoon fit and the long-man line;
 * `--refit` to record them in history.db), detector (the detector's error rates, cycle 2), platoon-detector (the platoon fit's
 * error rates under the detector, cycle 3) and stakes-lines (Player Development's ceiling lines measured on the league's major leaguers,
 * cycle 4; `--refit` to record the measurement).
 *
 * `production` runs Player Value's per-save production fit (D-053; scripts/lib/productionCalibration.ts):
 * `production --prior` also prints the fallback prior, `production --refit` forces a refit into history.db.
 *
 * It reads objective statistics directly and ratings only through `scoutedEvidence.ts`
 * (D-017, D-035). It never writes to the database or to OOTP's files. What it prints is
 * evidence for the constants declared in `resultsMetrics.ts`, `roleReview.ts`, `platoon.ts`,
 * `toolsModel.ts`, `bullpenRoles.ts` and `lineupPicture.ts`; a person reads it, updates the one
 * declaration, and records the run in docs/CALIBRATION.md. Nothing here changes behavior by itself.
 *
 * Method, in one line: predict a later season from earlier ones with the production functions
 * (`weightedBatting`, `weightedPitching`, `reliability`) under candidate parameters, and keep the
 * parameters with the smallest error. Seasons are the league's own (real major-league history
 * imported with the save), skipping the shortened 2020 season and years without enough players.
 */

import { db } from '../server/db.js';
import { leagueBaseline } from '../server/stats.js';
import { loadScoutedAbilities, loadScoutedHitterProfiles, type ScoutedHitterProfile } from '../server/scoutedEvidence.js';
import {
  reliability, weightedBatting, weightedPitching, wobaOf,
  type BattingLine, type PitchingLine, type SeasonEnvironment,
} from '../server/resultsMetrics.js';
import { mlbOverview } from '../server/mlbOperations.js';
import { bestOf, correlation, grid, mean, weightedRmse, wls } from './lib/fit.js';
import { productionSection } from './lib/productionCalibration.js';
import { rosterReviewSection } from './lib/rosterReviewCalibration.js';
import { detectorSection } from './lib/resultsDetectorSimulation.js';
import { platoonDetectorSection } from './lib/platoonDetectorSimulation.js';
import { leagueLeverage } from '../server/mlbCalibrationRefit.js';
import { leverageLines, LEVERAGE_UNIT_TOLERANCE } from '../server/bullpenRoles.js';
import { LONG_LINE_POLICY } from '../server/mlbBullpenLines.js';

const LEAGUE = Number(process.env.CALIBRATION_LEAGUE ?? 203);
const FIRST = 2003;
const LAST = Number(process.env.CALIBRATION_LAST ?? 2025);
const SKIP = new Set([2020]);
const sections = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const want = (name: string) => sections.length === 0 || sections.includes(name);
const f = (n: number | null | undefined, d = 3) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
const heading = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

// ── data ────────────────────────────────────────────────────────────────────

const env = new Map<number, SeasonEnvironment>();
for (let y = FIRST - 4; y <= LAST + 1; y += 1) {
  const b = leagueBaseline(LEAGUE, y, 1);
  if (b.lgWOBA > 0) env.set(y, { year: y, woba: b.lgWOBA, fipRaw: b.lgFIPRaw, era: b.lgERA });
}

function loadBatting(split = 1): Map<number, BattingLine[]> {
  const rows = db.prepare(
    `SELECT player_id, year, SUM(g) g, SUM(gs) gs, SUM(pa) pa, SUM(ab) ab, SUM(h) h, SUM(d) d, SUM(t) t, SUM(hr) hr, SUM(bb) bb, SUM(ibb) ibb,
            SUM(hp) hp, SUM(sf) sf, SUM(k) k, SUM(sb) sb, SUM(cs) cs, SUM(gdp) gdp, SUM(war) war, SUM(ubr) ubr
     FROM players_career_batting_stats WHERE level_id = 1 AND league_id = ? AND split_id = ? AND year BETWEEN ? AND ?
     GROUP BY player_id, year`
  ).all(LEAGUE, split, FIRST - 4, LAST + 1) as Array<BattingLine & { player_id: number }>;
  const out = new Map<number, BattingLine[]>();
  for (const { player_id, ...l } of rows) out.set(player_id, [...(out.get(player_id) ?? []), l]);
  return out;
}

function loadPitching(): Map<number, PitchingLine[]> {
  const rows = db.prepare(
    `SELECT player_id, year, SUM(g) g, SUM(gs) gs, SUM(gf) gf, SUM(outs) outs, SUM(bf) bf, SUM(er) er, SUM(r) r, SUM(ha) ha, SUM(hra) hra,
            SUM(bb) bb, SUM(hp) hp, SUM(k) k, SUM(s) sv, SUM(hld) hld, SUM(war) war, SUM(li) li
     FROM players_career_pitching_stats WHERE level_id = 1 AND league_id = ? AND split_id = 1 AND year BETWEEN ? AND ?
     GROUP BY player_id, year`
  ).all(LEAGUE, FIRST - 4, LAST + 1) as Array<PitchingLine & { player_id: number }>;
  const out = new Map<number, PitchingLine[]>();
  for (const { player_id, ...l } of rows) out.set(player_id, [...(out.get(player_id) ?? []), l]);
  return out;
}

const birthYears = new Map<number, number>();
for (const r of db.prepare(`SELECT player_id, date_of_birth AS d FROM players`).all() as Array<{ player_id: number; d: string | null }>) {
  const m = r.d ? /^(\d{4})/.exec(r.d) : null;
  if (m) birthYears.set(r.player_id, Number(m[1]));
}

const years = (from = FIRST, to = LAST) => {
  const out: number[] = [];
  for (let y = from; y <= to; y += 1) if (!SKIP.has(y)) out.push(y);
  return out;
};

// ── 1. results: season weights and stabilization ───────────────────────────

function resultsSection(): void {
  heading('1. Results lens: season weights and stabilization (hitters)');
  const batting = loadBatting();
  const rows: Array<{ lines: BattingLine[]; year: number; actual: number; pa: number }> = [];
  for (const T of years(FIRST + 3)) {
    for (const lines of batting.values()) {
      const target = lines.find((l) => l.year === T);
      const e = env.get(T);
      if (!target || !e || target.pa < 250) continue;
      const w = wobaOf(target);
      if (w === null) continue;
      rows.push({ lines: lines.filter((l) => l.year < T), year: T, actual: w - e.woba, pa: target.pa });
    }
  }
  console.log(`${rows.length} hitter seasons (target PA >= 250), ${years(FIRST + 3).length} target years`);
  const predict = (r: (typeof rows)[number], weights: number[], k: number) => {
    const w = weightedBatting(r.lines, env, r.year - 1, weights);
    return w.value === null ? 0 : reliability(w.sample, k) * w.value;
  };
  const score = ([a, b, k]: number[]) => weightedRmse(rows.map((r) => predict(r, [1, a, b], k)), rows.map((r) => r.actual), rows.map((r) => r.pa));
  const points = grid([0.4, 0.6, 0.8, 1], [0.2, 0.4, 0.6, 0.8, 1], [100, 150, 200, 250, 300, 400, 500, 700, 1000]);
  const best = bestOf(points, score);
  const current = score([0.8, 0.6, 250]);
  console.log(`current production setting (5/4/3 = 1, .8, .6; K 250): rmse ${f(current, 5)}`);
  console.log(`best of grid: weights 1 / ${best?.point[0]} / ${best?.point[1]}, K ${best?.point[2]}: rmse ${f(best?.score, 5)}`);
  const naive = weightedRmse(rows.map(() => 0), rows.map((r) => r.actual), rows.map((r) => r.pa));
  console.log(`league-average guess (no information): rmse ${f(naive, 5)}`);
  for (const k of [100, 150, 200, 250, 300, 400, 600]) console.log(`  K ${String(k).padStart(4)} at 1/.8/.6: rmse ${f(score([0.8, 0.6, k]), 5)}`);
  for (const [a, b] of [[1, 1], [0.8, 0.6], [0.6, 0.3], [0.5, 0.25], [0.4, 0.2]]) console.log(`  weights 1/${a}/${b} at K ${best?.point[2]}: rmse ${f(score([a, b, best?.point[2] as number]), 5)}`);
}

// ── 2. pitchers: skills vs runs, stabilization ─────────────────────────────

function pitchersSection(): void {
  heading('2. Pitcher results: peripherals vs runs allowed, stabilization');
  const pitching = loadPitching();
  for (const role of ['starter', 'reliever'] as const) {
    const rows: Array<{ lines: PitchingLine[]; year: number; era: number; fip: number; bf: number }> = [];
    for (const T of years(FIRST + 3)) {
      for (const lines of pitching.values()) {
        const target = lines.find((l) => l.year === T);
        const e = env.get(T);
        if (!target || !e || target.bf < (role === 'starter' ? 350 : 150) || target.outs <= 0) continue;
        if ((target.gs / Math.max(1, target.g) >= 0.5) !== (role === 'starter')) continue;
        const ip = target.outs / 3;
        rows.push({
          lines: lines.filter((l) => l.year < T), year: T, bf: target.bf,
          era: (target.er * 9) / ip - e.era,
          fip: (13 * target.hra + 3 * (target.bb + target.hp) - 2 * target.k) / ip - e.fipRaw,
        });
      }
    }
    console.log(`\n${role}s: ${rows.length} seasons`);
    const project = (r: (typeof rows)[number], mix: number, k: number, weights = [1, 0.8, 0.6]) => {
      const w = weightedPitching(r.lines, env, r.year - 1, weights);
      if (w.skills.value === null || w.runs.value === null) return 0;
      return reliability(w.skills.sample, k) * (mix * w.skills.value + (1 - mix) * w.runs.value);
    };
    for (const target of ['era', 'fip'] as const) {
      const results: string[] = [];
      let bestMix = { mix: 0, rmse: Infinity };
      for (let mix = 0; mix <= 1.0001; mix += 0.1) {
        const rmse = weightedRmse(rows.map((r) => project(r, mix, 300)), rows.map((r) => r[target]), rows.map((r) => r.bf));
        results.push(`${mix.toFixed(1)}:${f(rmse, 4)}`);
        if (rmse < bestMix.rmse) bestMix = { mix, rmse };
      }
      console.log(`  predicting next-season ${target === 'era' ? 'ERA' : 'FIP'} (K 300), skills share -> rmse: ${results.join('  ')}`);
      console.log(`  best skills share for ${target}: ${bestMix.mix.toFixed(1)}`);
    }
    const best = bestOf(grid([0.4, 0.6, 0.8, 1], [0.2, 0.4, 0.6, 0.8, 1], [150, 250, 350, 500, 700, 1000, 1500]), ([a, b, k]) =>
      weightedRmse(rows.map((r) => project(r, 0.7, k, [1, a, b])), rows.map((r) => r.era), rows.map((r) => r.bf)));
    console.log(`  best weights / K predicting ERA at skills 0.7: 1 / ${best?.point[0]} / ${best?.point[1]}, K ${best?.point[2]} (rmse ${f(best?.score, 4)})`);
    console.log(`  production (1/.8/.6, K 300): rmse ${f(weightedRmse(rows.map((r) => project(r, 0.7, 300)), rows.map((r) => r.era), rows.map((r) => r.bf)), 4)}`);
  }
}

// ── 3. tools model: what do visible tools say about results? ───────────────

const TOOLS = ['contact', 'gap', 'power', 'eye', 'avoidK'] as const;

function hitterPopulation(profiles: Map<number, ScoutedHitterProfile>, window: [number, number], minPa: number) {
  const batting = loadBatting();
  const out: Array<{ id: number; x: number[]; y: number; pa: number; profile: ScoutedHitterProfile }> = [];
  for (const [id, lines] of batting) {
    const p = profiles.get(id);
    if (!p || TOOLS.some((t) => p.tools[t] === null)) continue;
    const inWindow = lines.filter((l) => l.year >= window[0] && l.year <= window[1] && !SKIP.has(l.year));
    const pa = inWindow.reduce((n, l) => n + l.pa, 0);
    if (pa < minPa) continue;
    const w = weightedBatting(inWindow, env, window[1], new Array(window[1] - window[0] + 1).fill(1));
    if (w.value === null) continue;
    out.push({ id, x: TOOLS.map((t) => p.tools[t] as number), y: w.value, pa, profile: p });
  }
  return out;
}

function toolsSection(): void {
  heading('3. Tools model: expected wOBA above league from the five visible bat tools');
  const ids = (db.prepare(`SELECT DISTINCT player_id AS id FROM players_career_batting_stats WHERE level_id = 1 AND league_id = ? AND year >= ?`).all(LEAGUE, LAST - 8) as Array<{ id: number }>).map((r) => r.id);
  const profiles = loadScoutedHitterProfiles(ids);
  console.log(`${profiles.size} hitters with ratings`);
  for (const [label, window] of [['2023-2025', [2023, 2025]], ['2021-2022', [2021, 2022]], ['2018-2019', [2018, 2019]], ['2015-2017', [2015, 2017]]] as Array<[string, [number, number]]>) {
    const pop = hitterPopulation(profiles, window, 500);
    const fit = wls(pop.map((r) => r.x), pop.map((r) => r.y), pop.map((r) => r.pa));
    const avg = pop.map((r) => mean(r.x));
    const single = wls(pop.map((_, i) => [avg[i]]), pop.map((r) => r.y), pop.map((r) => r.pa));
    // cross-validation: fit on even ids, score on odd
    const train = pop.filter((r) => r.id % 2 === 0);
    const test = pop.filter((r) => r.id % 2 === 1);
    const tf = wls(train.map((r) => r.x), train.map((r) => r.y), train.map((r) => r.pa));
    const cvR = tf ? correlation(test.map((r) => r.x.reduce((s, v, i) => s + v * tf.coefficients[i + 1], tf.coefficients[0])), test.map((r) => r.y), test.map((r) => r.pa)) : null;
    console.log(`\nresults window ${label}: n=${pop.length}`);
    if (fit) {
      console.log(`  full model   R2 ${f(fit.r2)}  rmse ${f(fit.rmse, 4)}  cross-validated r ${f(cvR)} (R2 ${f(cvR === null ? null : cvR * cvR)})`);
      console.log(`  intercept ${f(fit.coefficients[0], 4)}  ${TOOLS.map((t, i) => `${t} ${f(fit.coefficients[i + 1], 5)}`).join('  ')}`);
    }
    if (single) console.log(`  unweighted mean of the five tools alone: R2 ${f(single.r2)}`);
  }

  // pooled across windows with a per-window intercept, so the slopes describe the tool-to-result relation and not one window's leakage
  {
    const windows: Array<[number, number]> = [[2023, 2025], [2021, 2022], [2018, 2019]];
    const X: number[][] = [];
    const Y: number[] = [];
    const Wt: number[] = [];
    windows.forEach((w, wi) => {
      for (const r of hitterPopulation(profiles, w, 500)) {
        X.push([...r.x, ...windows.slice(1).map((_, j) => (wi === j + 1 ? 1 : 0))]); Y.push(r.y); Wt.push(r.pa);
      }
    });
    const pooled = wls(X, Y, Wt);
    if (pooled) {
      console.log(`\npooled over ${windows.map((w) => w.join('-')).join(', ')} with window intercepts: n=${Y.length}, R2 ${f(pooled.r2)}`);
      console.log(`  ${TOOLS.map((t, i) => `${t} ${f(pooled.coefficients[i + 1], 5)}`).join('  ')}   <- slopes for server/toolsModel.ts`);
    }
  }

  // Extreme profiles: is the straight line off for unusual combinations? Residual of the pooled linear model, by profile class, and whether
  // an interaction (contact x power, contact x eye) or a squared term adds anything. A model that is right on average can still be wrong at
  // the corners, and the corners are where a GM's attention goes.
  {
    const windows: Array<[number, number]> = [[2023, 2025], [2021, 2022], [2018, 2019]];
    const rows: Array<{ x: number[]; y: number; pa: number; wi: number }> = [];
    windows.forEach((w, wi) => { for (const r of hitterPopulation(profiles, w, 500)) rows.push({ x: r.x, y: r.y, pa: r.pa, wi }); });
    const design = (r: { x: number[]; wi: number }, extra: (x: number[]) => number[] = () => []) => [...r.x, ...extra(r.x), ...windows.slice(1).map((_, j) => (r.wi === j + 1 ? 1 : 0))];
    const base = wls(rows.map((r) => design(r)), rows.map((r) => r.y), rows.map((r) => r.pa));
    heading('3c. Extreme profiles: does the linear tools model miss at the corners?');
    if (base) {
      const [c0, ...slopes] = base.coefficients;
      const predict = (r: { x: number[]; wi: number }) => c0 + slopes.slice(0, 5).reduce((n, b, i) => n + b * r.x[i], 0) + (r.wi > 0 ? slopes[5 + r.wi - 1] : 0);
      const classes: Array<[string, (x: number[]) => boolean]> = [
        ['power-led (power >= 60, contact <= 45)', (x) => x[2] >= 60 && x[0] <= 45],
        ['contact-led (contact >= 60, power <= 45)', (x) => x[0] >= 60 && x[2] <= 45],
        ['eye-led (eye >= 60, contact <= 45)', (x) => x[3] >= 60 && x[0] <= 45],
        ['three true outcomes (power >= 60, eye >= 60, contact <= 45)', (x) => x[2] >= 60 && x[3] >= 60 && x[0] <= 45],
        ['all bat tools <= 40', (x) => x[0] <= 40 && x[1] <= 40 && x[2] <= 40 && x[3] <= 40],
        ['all bat tools >= 60', (x) => x[0] >= 60 && x[1] >= 60 && x[2] >= 60 && x[3] >= 60],
      ];
      for (const [label, test] of classes) {
        const set = rows.filter((r) => test(r.x));
        if (set.length < 5) { console.log(`  ${label}: n=${set.length} (too few)`); continue; }
        const res = set.map((r) => r.y - predict(r));
        const w = set.map((r) => r.pa);
        const m = res.reduce((n, v, i) => n + v * w[i], 0) / w.reduce((n, v) => n + v, 0);
        const se = Math.sqrt(res.reduce((n, v, i) => n + w[i] * (v - m) ** 2, 0) / w.reduce((n, v) => n + v, 0)) / Math.sqrt(set.length);
        console.log(`  ${label}: n=${set.length}  mean residual ${f(m * 1000, 1)} wOBA points (+/- ${f(se * 1000, 1)})`);
      }
      const withInteractions = wls(rows.map((r) => design(r, (x) => [x[0] * x[2] / 50, x[0] * x[3] / 50, x[2] * x[3] / 50])), rows.map((r) => r.y), rows.map((r) => r.pa));
      console.log(`  linear R2 ${f(base.r2, 4)}; with contact x power, contact x eye and power x eye terms R2 ${f(withInteractions?.r2, 4)}`);
    }
  }

  heading('3b. Split tools: do vsL / vsR ratings predict results against that hand?');
  const batL = loadBatting(2);
  const batR = loadBatting(3);
  const splitEnv = (rows: Map<number, BattingLine[]>) => {
    const out = new Map<number, number>();
    for (const y of years(2015)) {
      const tot = { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, ibb: 0, hp: 0, sf: 0 };
      for (const lines of rows.values()) {
        for (const l of lines) {
          if (l.year !== y) continue;
          tot.ab += l.ab; tot.h += l.h; tot.d += l.d; tot.t += l.t; tot.hr += l.hr; tot.bb += l.bb; tot.ibb += l.ibb; tot.hp += l.hp; tot.sf += l.sf;
        }
      }
      const w = wobaOf(tot);
      if (w !== null) out.set(y, w);
    }
    return out;
  };
  const envL = splitEnv(batL);
  const envR = splitEnv(batR);
  const window: [number, number] = [2022, 2025];
  const X: number[][] = [];
  const Y: number[] = [];
  const Wt: number[] = [];
  const XO: number[][] = [];
  for (const [side, rows, senv] of [['vsLeft', batL, envL], ['vsRight', batR, envR]] as const) {
    for (const [id, lines] of rows) {
      const p = profiles.get(id);
      if (!p || TOOLS.some((t) => p[side][t] === null || p.tools[t] === null)) continue;
      const use = lines.filter((l) => l.year >= window[0] && l.year <= window[1] && !SKIP.has(l.year));
      const pa = use.reduce((n, l) => n + l.pa, 0);
      if (pa < 150) continue;
      let num = 0;
      let den = 0;
      for (const l of use) { const w = wobaOf(l); const e = senv.get(l.year); if (w !== null && e !== undefined) { num += (w - e) * l.pa; den += l.pa; } }
      if (den === 0) continue;
      X.push(TOOLS.map((t) => p[side][t] as number)); XO.push(TOOLS.map((t) => p.tools[t] as number)); Y.push(num / den); Wt.push(pa);
    }
  }
  const split = wls(X, Y, Wt);
  const overall = wls(XO, Y, Wt);
  console.log(`pooled sides, ${Y.length} player-sides, window ${window.join('-')}`);
  if (split) console.log(`  split tools -> split results: R2 ${f(split.r2)}  intercept ${f(split.coefficients[0], 4)}  ${TOOLS.map((t, i) => `${t} ${f(split.coefficients[i + 1], 5)}`).join('  ')}`);
  if (overall) console.log(`  overall tools -> split results: R2 ${f(overall?.r2)}  (the split ratings ${split && overall && split.r2 > overall.r2 ? 'add' : 'do not add'} information)`);
}

function pitcherToolsSection(): void {
  heading('3c. Pitcher tools: how well do the three visible tools (stuff, movement, control) track peripherals?');
  const pitching = loadPitching();
  const ids = [...pitching.keys()];
  // Ratings only through the adapter (D-017, D-035): a tool the organization cannot see is unknown, never read from the column
  const abilities = loadScoutedAbilities(ids);
  const tools = new Map<number, { s: number; m: number; c: number }>();
  for (const id of ids) {
    const t = abilities.for(id).currentTools;
    if (typeof t.stuff === 'number' && typeof t.movement === 'number' && typeof t.control === 'number') tools.set(id, { s: t.stuff, m: t.movement, c: t.control });
  }
  for (const [label, window] of [['2023-2025', [2023, 2025]], ['2021-2022', [2021, 2022]], ['2018-2019', [2018, 2019]]] as Array<[string, [number, number]]>) {
    const X: number[][] = [];
    const Y: number[] = [];
    const W: number[] = [];
    for (const [id, lines] of pitching) {
      const t = tools.get(id);
      if (!t || !(t.s > 0 && t.m > 0 && t.c > 0)) continue;
      const use = lines.filter((l) => l.year >= window[0] && l.year <= window[1] && !SKIP.has(l.year));
      const bf = use.reduce((n, l) => n + l.bf, 0);
      if (bf < 400) continue;
      const w = weightedPitching(use, env, window[1], new Array(window[1] - window[0] + 1).fill(1));
      if (w.skills.value === null) continue;
      X.push([t.s, t.m, t.c]); Y.push(w.skills.value); W.push(bf);
    }
    const full = wls(X, Y, W);
    const flat = wls(X.map((r) => [(r[0] + r[1] + r[2]) / 3]), Y, W);
    console.log(`  results window ${label}: n=${Y.length}  three-tool model R2 ${f(full?.r2)}  flat mean of the three R2 ${f(flat?.r2)}  coefficients (FIP runs per rating point) ${full ? full.coefficients.map((v) => f(v, 4)).join(' ') : '—'}`);
  }
}

// ── 4. platoon: shrinkage and the rating prior ─────────────────────────────

function platoonSection(): void {
  heading('4. Platoon: how much to trust an observed split, and what the ratings add');
  const batL = loadBatting(2);
  const batR = loadBatting(3);
  const hands = new Map<number, number>();
  for (const r of db.prepare(`SELECT player_id, bats FROM players`).all() as Array<{ player_id: number; bats: number }>) hands.set(r.player_id, r.bats);
  const sum = (ls: BattingLine[]) => ls.reduce((t, l) => ({ ...t, ab: t.ab + l.ab, h: t.h + l.h, d: t.d + l.d, t: t.t + l.t, hr: t.hr + l.hr, bb: t.bb + l.bb, ibb: t.ibb + l.ibb, hp: t.hp + l.hp, sf: t.sf + l.sf, pa: t.pa + l.pa }), { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, ibb: 0, hp: 0, sf: 0, pa: 0 } as BattingLine);
  const effectOf = (id: number, from: number, to: number) => {
    const l = sum((batL.get(id) ?? []).filter((x) => x.year >= from && x.year <= to && !SKIP.has(x.year)));
    const r = sum((batR.get(id) ?? []).filter((x) => x.year >= from && x.year <= to && !SKIP.has(x.year)));
    const wl = l.pa > 0 ? wobaOf(l) : null;
    const wr = r.pa > 0 ? wobaOf(r) : null;
    return { pl: l.pa, pr: r.pa, effect: wl !== null && wr !== null ? wr - wl : null };
  };
  // league effect by hand over the whole window
  const league: Record<number, number> = {};
  for (const hand of [1, 2, 3]) {
    const eff = [...hands.entries()].filter(([, h]) => h === hand).map(([id]) => ({ id, e: effectOf(id, 2010, LAST) })).filter((x) => x.e.effect !== null && x.e.pl >= 100 && x.e.pr >= 100);
    league[hand] = eff.length ? eff.reduce((s, x) => s + (x.e.effect as number) * (x.e.pl * x.e.pr) / (x.e.pl + x.e.pr), 0) / eff.reduce((s, x) => s + (x.e.pl * x.e.pr) / (x.e.pl + x.e.pr), 0) : 0;
    console.log(`league platoon effect, batter hand ${hand === 1 ? 'R' : hand === 2 ? 'L' : 'S'}: ${f(league[hand], 4)} wOBA (n=${eff.length})`);
  }
  // target: effect over 2023-2025; prior: 2018-2022 excluding 2020; predict with shrink K
  const rows: Array<{ id: number; hand: number; prior: ReturnType<typeof effectOf>; target: ReturnType<typeof effectOf> }> = [];
  for (const id of hands.keys()) {
    const prior = effectOf(id, 2017, 2022);
    const target = effectOf(id, 2023, 2025);
    if (prior.effect === null || target.effect === null || target.pl < 60 || target.pr < 120 || prior.pl < 30 || prior.pr < 60) continue;
    rows.push({ id, hand: hands.get(id) as number, prior, target });
  }
  console.log(`${rows.length} hitters with a prior window (2017-2022) and a target window (2023-2025)`);
  const eff = (p: { pl: number; pr: number }) => (p.pl * p.pr) / (p.pl + p.pr);
  const wt = (r: (typeof rows)[number]) => eff(r.target);
  const shrunk = (r: (typeof rows)[number], k: number) => league[r.hand] + reliability(eff(r.prior), k) * ((r.prior.effect as number) - league[r.hand]);
  for (const k of [200, 400, 700, 1000, 1500, 2000, 3000, 5000, 1e9]) console.log(`  shrink K ${k >= 1e9 ? 'none' : String(k).padStart(5)}: rmse ${f(weightedRmse(rows.map((r) => shrunk(r, k)), rows.map((r) => r.target.effect as number), rows.map(wt)), 5)}`);
  const kBest = bestOf([100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000], (k) => weightedRmse(rows.map((r) => shrunk(r, k)), rows.map((r) => r.target.effect as number), rows.map(wt)));
  console.log(`  best K for the observed-split prior: ${kBest?.point}`);
  const zero = weightedRmse(rows.map((r) => league[r.hand]), rows.map((r) => r.target.effect as number), rows.map(wt));
  console.log(`  league-average effect only (no individual split): rmse ${f(zero, 5)}`);

  // do the ratings add to the observed split? Ratings are turned into wOBA points with the split model, and both sides are
  // centred on the batter-hand norm, so the test asks about the INDIVIDUAL, not about left-handers being left-handers.
  const ids = rows.map((r) => r.id);
  const profiles = loadScoutedHitterProfiles(ids);
  const COEF = { contact: 0.00191, gap: 0.00022, power: 0.00154, eye: 0.00097, avoidK: 0.00008 };
  const expected = (t: Readonly<Record<string, number | null>>) => (TOOLS.some((k) => t[k] === null) ? null : TOOLS.reduce((s2, k) => s2 + COEF[k] * (t[k] as number), 0));
  const usable = rows.map((r) => ({ r, p: profiles.get(r.id) })).filter((x) => x.p && expected(x.p.vsLeft) !== null && expected(x.p.vsRight) !== null);
  const ratingEffect = (p: ScoutedHitterProfile) => (expected(p.vsRight) as number) - (expected(p.vsLeft) as number);
  const handMean: Record<number, number> = {};
  for (const hand of [1, 2, 3]) {
    const xs = usable.filter((x) => x.r.hand === hand).map((x) => ratingEffect(x.p as ScoutedHitterProfile));
    handMean[hand] = xs.length ? mean(xs) : 0;
  }
  const centred = (x: (typeof usable)[number]) => ratingEffect(x.p as ScoutedHitterProfile) - handMean[x.r.hand];
  console.log(`  spread among hitters: sd of the hand-centred rating effect ${f(Math.sqrt(mean(usable.map((x) => centred(x) ** 2))), 4)}; sd of the observed effect above the batter-hand norm ${f(Math.sqrt(mean(usable.map((x) => ((x.r.target.effect as number) - league[x.r.hand]) ** 2))), 4)} (mostly noise)`);
  const kUse = kBest?.point ?? 1500;
  const y = usable.map((x) => (x.r.target.effect as number) - league[x.r.hand]);
  const wts = usable.map((x) => wt(x.r));
  console.log(`\n  ratings: ${usable.length} hitters with both split profiles; mean rating-implied effect by hand R ${f(handMean[1], 4)} L ${f(handMean[2], 4)} S ${f(handMean[3], 4)}`);
  const regRating = wls(usable.map((x) => [centred(x)]), y, wts, false);
  if (regRating) console.log(`  target effect (above the batter-hand norm) on the hand-centred RATING effect: slope ${f(regRating.coefficients[0], 3)} (1.0 would mean the ratings are exactly right), R2 ${f(regRating.r2)}`);
  const reg = wls(usable.map((x) => [shrunk(x.r, kUse) - league[x.r.hand], centred(x)]), y, wts, false);
  if (reg) console.log(`  target ~ shrunk observed split + rating effect: observed coefficient ${f(reg.coefficients[0], 3)}, rating slope ${f(reg.coefficients[1], 3)}, R2 ${f(reg.r2)}`);
  const c = usable.length ? correlation(usable.map(centred), y, wts) : null;
  console.log(`  correlation of the hand-centred rating effect with the observed 2023-2025 effect: ${f(c)}`);
  for (const rho of [0, 0.25, 0.5, 0.75, 1]) {
    const pred = usable.map((x) => league[x.r.hand] + rho * centred(x));
    console.log(`  prior = league norm + ${rho} x rating effect: rmse ${f(weightedRmse(pred, usable.map((x) => x.r.target.effect as number), wts), 5)}`);
  }
  // combined: ratings prior, then shrink the observed split toward it
  const combined = (x: (typeof usable)[number], k: number, rho: number) => {
    const prior = league[x.r.hand] + rho * centred(x);
    return prior + reliability(eff(x.r.prior), k) * ((x.r.prior.effect as number) - prior);
  };
  const bestCombo = bestOf(grid([0.25, 0.5, 0.75, 1], [200, 400, 700, 1000, 1500, 2000, 3000, 5000]), ([rho, k]) => weightedRmse(usable.map((x) => combined(x, k, rho)), usable.map((x) => x.r.target.effect as number), wts));
  console.log(`  best combination (rating weight rho, shrink K on the observed split around the ratings prior): rho ${bestCombo?.point[0]}, K ${bestCombo?.point[1]}, rmse ${f(bestCombo?.score, 5)}`);
}

// ── 5. aging ────────────────────────────────────────────────────────────────

function agingSection(): void {
  heading('5. Aging: mean change in league-relative production from one season to the next, by age');
  const batting = loadBatting();
  const buckets = new Map<number, { sum: number; w: number; n: number }>();
  for (const [id, lines] of batting) {
    const born = birthYears.get(id);
    if (born === undefined) continue;
    for (const a of lines) {
      const b = lines.find((l) => l.year === a.year + 1);
      const ea = env.get(a.year);
      const eb = env.get(b?.year ?? 0);
      if (!b || !ea || !eb || a.pa < 300 || b.pa < 300 || SKIP.has(a.year) || SKIP.has(b.year) || a.year < 2000) continue;
      const wa = wobaOf(a);
      const wb = wobaOf(b);
      if (wa === null || wb === null) continue;
      const age = a.year - born;
      const w = (a.pa * b.pa) / (a.pa + b.pa);
      const cur = buckets.get(age) ?? { sum: 0, w: 0, n: 0 };
      buckets.set(age, { sum: cur.sum + (wb - eb.woba - (wa - ea.woba)) * w, w: cur.w + w, n: cur.n + 1 });
    }
  }
  console.log('hitters: age (this season) -> mean change in relative wOBA next season, n');
  for (const age of [...buckets.keys()].sort((x, y) => x - y).filter((a) => a >= 22 && a <= 40)) {
    const b = buckets.get(age)!;
    console.log(`  ${age}: ${f(b.sum / b.w, 4).padStart(8)}  n=${b.n}`);
  }
  const pitching = loadPitching();
  const pb = new Map<number, { sum: number; w: number; n: number }>();
  for (const [id, lines] of pitching) {
    const born = birthYears.get(id);
    if (born === undefined) continue;
    for (const a of lines) {
      const b = lines.find((l) => l.year === a.year + 1);
      const ea = env.get(a.year);
      const eb = env.get(b?.year ?? 0);
      if (!b || !ea || !eb || a.bf < 300 || b.bf < 300 || SKIP.has(a.year) || SKIP.has(b.year) || a.year < 2000 || a.outs <= 0 || b.outs <= 0) continue;
      const fa = (13 * a.hra + 3 * (a.bb + a.hp) - 2 * a.k) / (a.outs / 3) - ea.fipRaw;
      const fb = (13 * b.hra + 3 * (b.bb + b.hp) - 2 * b.k) / (b.outs / 3) - eb.fipRaw;
      const age = a.year - born;
      const w = (a.bf * b.bf) / (a.bf + b.bf);
      const cur = pb.get(age) ?? { sum: 0, w: 0, n: 0 };
      pb.set(age, { sum: cur.sum + (fb - fa) * w, w: cur.w + w, n: cur.n + 1 });
    }
  }
  console.log('pitchers: age -> mean change in relative FIP (runs per nine; positive is WORSE) next season, n');
  for (const age of [...pb.keys()].sort((x, y) => x - y).filter((a) => a >= 22 && a <= 40)) {
    const b = pb.get(age)!;
    console.log(`  ${age}: ${f(b.sum / b.w, 3).padStart(8)}  n=${b.n}`);
  }
}

// ── 6. baserunning ──────────────────────────────────────────────────────────

const runsOf = (l: BattingLine) => l.ubr + 0.2 * l.sb - 0.4 * l.cs;

function runningSection(): void {
  heading('6. Baserunning: repeatability and what the running ratings say');
  const batting = loadBatting();
  const a: number[] = [];
  const b: number[] = [];
  const w: number[] = [];
  for (const lines of batting.values()) {
    for (const x of lines) {
      const y = lines.find((l) => l.year === x.year + 1);
      if (!y || x.pa < 300 || y.pa < 300 || SKIP.has(x.year) || SKIP.has(y.year) || x.year < 2005) continue;
      a.push((runsOf(x) / x.pa) * 600); b.push((runsOf(y) / y.pa) * 600); w.push(Math.min(x.pa, y.pa));
    }
  }
  const r = correlation(a, b, w);
  console.log(`year-to-year correlation of baserunning runs per 600 PA (UBR + .2 SB - .4 CS): r=${f(r)} over ${a.length} pairs`);
  if (r !== null && r > 0) console.log(`  implied stabilization K (PA) = 550 * (1 - r) / r = ${f((550 * (1 - r)) / r, 0)}`);
  const ids = [...batting.keys()];
  const profiles = loadScoutedHitterProfiles(ids);
  const X: number[][] = [];
  const Y: number[] = [];
  const Wt: number[] = [];
  for (const [id, lines] of batting) {
    const p = profiles.get(id);
    if (!p || p.runningAbility === null) continue;
    const use = lines.filter((l) => l.year >= 2022 && l.year <= 2025 && !SKIP.has(l.year));
    const pa = use.reduce((n, l) => n + l.pa, 0);
    if (pa < 500) continue;
    X.push([p.running.speed as number, p.running.baserunning as number, p.running.stealing as number]);
    Y.push((use.reduce((n, l) => n + runsOf(l), 0) / pa) * 600); Wt.push(pa);
  }
  const fit = wls(X, Y, Wt);
  if (fit) console.log(`running ratings (speed, baserunning, stealing) -> baserunning runs/600 PA: n=${Y.length}, R2 ${f(fit.r2)}, coefficients ${fit.coefficients.map((c) => f(c, 4)).join(' ')}`);
  const sd = Math.sqrt(mean(Y.map((y) => (y - mean(Y)) ** 2)));
  console.log(`  spread of baserunning runs per 600 PA among regulars: sd ${f(sd, 2)} runs; the bat's is roughly 15 runs, so baserunning is a small part of a hitter's value`);
}

// ── 7. defense: does the visible glove say anything about results? ─────────

function defenseSection(): void {
  heading('7. Defense: what the visible glove says about results, and how much of a hitter\'s value it is by position');
  const rows = db.prepare(
    `SELECT s.player_id, s.position, s.ip, s.zr, s.framing FROM players_career_fielding_stats s
     WHERE s.level_id = 1 AND s.league_id = ? AND s.year = (SELECT MAX(year) FROM players_career_fielding_stats WHERE league_id = ?) AND s.ip >= 150 AND s.position BETWEEN 2 AND 9`
  ).all(LEAGUE, LEAGUE) as Array<{ player_id: number; position: number; ip: number; zr: number; framing: number }>;
  const ratings = db.prepare(`SELECT * FROM players_fielding`).all() as Array<Record<string, number>>;
  const byId = new Map(ratings.map((r) => [r.player_id, r]));
  // the bat's talent spread, in runs per 600 PA, from the tools model among current regulars
  const batIds = (db.prepare(`SELECT DISTINCT player_id AS id FROM players_career_batting_stats WHERE level_id = 1 AND league_id = ? AND year = ? AND pa >= 100`).all(LEAGUE, LAST + 1) as Array<{ id: number }>).map((r) => r.id);
  const profiles = loadScoutedHitterProfiles(batIds);
  const COEF = { contact: 0.00185, gap: 0.00032, power: 0.00155, eye: 0.00108, avoidK: 0.00012 };
  const expected = [...profiles.values()].map((p) => (TOOLS.some((k) => p.tools[k] === null) ? null : TOOLS.reduce((sum, k) => sum + COEF[k] * (p.tools[k] as number), 0))).filter((v): v is number => v !== null);
  const sdBat = Math.sqrt(mean(expected.map((v) => (v - mean(expected)) ** 2))) / 1.2 * 600;
  console.log(`  bat talent spread among current regulars (tools model): sd ${f(sdBat, 1)} runs per 600 PA`);
  for (const pos of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (const r of rows.filter((x) => x.position === pos)) {
      const grade = byId.get(r.player_id)?.[`fielding_rating_pos${pos}`];
      if (!grade || grade <= 0) continue;
      const runs = pos === 2 ? r.zr + r.framing : r.zr;
      xs.push(grade); ys.push((runs / r.ip) * 1300); ws.push(r.ip);
    }
    const fit = wls(xs.map((x) => [x]), ys, ws);
    const c = correlation(xs, ys, ws);
    const sdGrade = Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
    const spread = fit ? Math.abs(fit.coefficients[1]) * sdGrade : null;
    const weight = spread === null ? null : spread / (spread + sdBat);
    console.log(`  position ${pos}: n=${xs.length}  r(grade, runs per 1300 IP)=${f(c)}  slope ${f(fit?.coefficients[1], 2)} runs per grade point  grade sd ${f(sdGrade, 1)}  -> talent spread ${f(spread, 1)} runs  -> share of value ${f(weight, 2)}`);
  }
  console.log('  (share = defensive talent spread / (defensive spread + bat spread); one partial season, so the slope is evidence, the weights are estimates)');
}

// ── 8. leverage ─────────────────────────────────────────────────────────────

function leverageSection(): void {
  heading('8. Bullpen leverage: how relievers are actually used (current season)');
  const rows = db.prepare(
    `SELECT player_id, SUM(g) g, SUM(gs) gs, SUM(bf) bf, SUM(outs) outs, SUM(s) sv, SUM(hld) hld, SUM(gf) gf, SUM(li) li
     FROM players_career_pitching_stats WHERE level_id = 1 AND league_id = ? AND split_id = 1 AND year = (SELECT MAX(year) FROM players_career_pitching_stats WHERE league_id = ?)
     GROUP BY player_id HAVING g >= 8 AND gs = 0`
  ).all(LEAGUE, LEAGUE) as Array<{ g: number; bf: number; outs: number; sv: number; hld: number; gf: number; li: number }>;
  const lis = rows.filter((r) => r.li > 0 && r.bf > 0).map((r) => r.li / r.bf).sort((a, b) => a - b);
  const q = (p: number) => lis[Math.min(lis.length - 1, Math.floor(p * lis.length))];
  console.log(`${lis.length} relievers with 8+ appearances and exported leverage (average leverage per batter faced)`);
  console.log(`  quantiles: 10% ${f(q(0.1), 2)}  25% ${f(q(0.25), 2)}  50% ${f(q(0.5), 2)}  75% ${f(q(0.75), 2)}  90% ${f(q(0.9), 2)}  max ${f(lis[lis.length - 1], 2)}`);
  const ipg = rows.map((r) => r.outs / 3 / r.g).sort((a, b) => a - b);
  console.log(`  innings per appearance quantiles: 25% ${f(ipg[Math.floor(ipg.length * 0.25)], 2)}  50% ${f(ipg[Math.floor(ipg.length * 0.5)], 2)}  75% ${f(ipg[Math.floor(ipg.length * 0.75)], 2)}  90% ${f(ipg[Math.floor(ipg.length * 0.9)], 2)}`);
  const closers = rows.filter((r) => r.sv >= 3 && r.bf > 0).map((r) => r.li / r.bf);
  console.log(`  relievers with 3+ saves: ${closers.length}, mean leverage ${f(mean(closers), 2)}`);
  const holds = rows.filter((r) => r.hld >= 3 && r.sv < 3 && r.bf > 0).map((r) => r.li / r.bf);
  console.log(`  setup men (3+ holds, under 3 saves): ${holds.length}, mean leverage ${f(mean(holds), 2)}`);
  // Cycle 3 (D-053; CALIBRATION.md section 14): the cut-offs are policy on the league's own scale, checked against its mean leverage;
  // the long-man line is measured per save with the reliever standards (`roster-review` prints the measurement and its checks)
  const unit = leagueLeverage(LEAGUE);
  const lines = leverageLines(unit);
  console.log(`  the league's mean leverage per batter faced (every pitcher): ${f(unit, 4)}; the cut-offs ${lines.rescaled ? `are rescaled to it: ${JSON.stringify(lines.leverage)}` : `serve as written (within ${LEVERAGE_UNIT_TOLERANCE * 100}% of 1.0)`}`);
  console.log(`  innings per appearance at the long-man quantile (${LONG_LINE_POLICY.quantile}) over these relievers: ${f(ipg[Math.floor(ipg.length * LONG_LINE_POLICY.quantile)], 2)} (the per-save line is measured on the clubs' active relievers: npm run calibrate roster-review)`);
}


// ── 9. role standards ───────────────────────────────────────────────────────

/**
 * What a holder of each role typically looks like in this league, on the working-estimate scale: the peer standard a concern is
 * measured against (`server/roleStandards.ts`). It runs the PRODUCTION review on every major-league club and describes the
 * distribution of the estimates it produces, so it is descriptive, not fitted to outcomes: percentiles among all hitters put a
 * first baseman at the 78th and a shortstop at the 59th, and a concern that ignores the position flags the wrong men.
 */
function standardsSection(): void {
  heading('9. Role standards: what a holder of each role typically looks like (production review, every club)');
  const teams = db.prepare(`SELECT team_id FROM teams WHERE level = 1 AND league_id = ? ORDER BY team_id`).all(LEAGUE) as Array<{ team_id: number }>;
  const hitters = new Map<number, { est: number[]; bat: number[] }>();
  const starters: number[] = [];
  const relievers = new Map<string, number[]>();
  let clubs = 0;
  for (const t of teams) {
    const o = mlbOverview(t.team_id);
    const lineup = o.review.find((g) => g.role === 'lineup regular');
    if (!lineup || lineup.holders.length < 5) continue;
    clubs += 1;
    for (const h of lineup.holders) {
      const pos = (h as { position?: number }).position;
      if (pos === undefined || h.estimate.value === null) continue;
      const b = hitters.get(pos) ?? { est: [], bat: [] };
      b.est.push(h.estimate.value);
      if (h.estimate.batValue !== null && h.estimate.batValue !== undefined) b.bat.push(h.estimate.batValue);
      hitters.set(pos, b);
    }
    for (const g of o.review) {
      if (g.kind === 'starting_pitcher') for (const h of g.holders) if (h.estimate.value !== null) starters.push(h.estimate.value);
      if (g.kind === 'relief_pitcher') for (const h of g.holders) if (h.estimate.value !== null) {
        const tier = (h as { tier?: string | null }).tier ?? 'unknown';
        relievers.set(tier, [...(relievers.get(tier) ?? []), h.estimate.value]);
      }
    }
  }
  const quant = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
  const median = (xs: number[]) => quant(xs, 0.5);
  const Q = Number(process.env.STANDARD_QUANTILE ?? 0.1);
  console.log(`${clubs} clubs; floor = the ${Math.round(Q * 100)}th percentile of the pooled deviation from each role's median (a policy quantile over a descriptive spread)`);
  const pooled = (groups: number[][]) => { const dev: number[] = []; for (const g of groups) { const m = median(g); for (const x of g) dev.push(x - m); } return quant(dev, Q); };
  const hitterGap = pooled([...hitters.values()].map((v) => v.est));
  console.log(`\nhitters (position: n, typical estimate, typical bat, floor)   pooled floor gap ${f(hitterGap, 1)}`);
  for (const [pos, v] of [...hitters.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${pos}: n=${v.est.length}  typical ${f(median(v.est), 0)}  bat ${f(median(v.bat), 0)}  floor ${f(median(v.est) + hitterGap, 0)}   (own p10 ${f(quant(v.est, Q), 0)})`);
  }
  console.log(`\nstarters: n=${starters.length}  typical ${f(median(starters), 0)}  floor(p${Math.round(Q * 100)}) ${f(quant(starters, Q), 0)}   by slot ordering not used`);
  const relGap = pooled([...relievers.values()].filter((g) => g.length >= 10));
  console.log(`\nrelievers by tier   pooled floor gap ${f(relGap, 1)}`);
  for (const [tier, xs] of [...relievers.entries()].sort((a, b) => median(b[1]) - median(a[1]))) {
    console.log(`  ${tier}: n=${xs.length}  typical ${f(median(xs), 0)}  floor ${f(median(xs) + relGap, 0)}   (own p10 ${f(quant(xs, Q), 0)})`);
  }
  const all = [...relievers.values()].flat();
  console.log(`  all relievers: n=${all.length}  typical ${f(median(all), 0)}  floor ${f(quant(all, Q), 0)}`);
}

if (want('results')) resultsSection();
if (want('pitchers')) pitchersSection();
if (want('tools')) toolsSection();
if (want('tools')) pitcherToolsSection();
if (want('platoon')) platoonSection();
if (want('aging')) agingSection();
if (want('running')) runningSection();
if (want('defense')) defenseSection();
if (want('leverage')) leverageSection();
if (want('standards')) standardsSection();
if (want('production')) productionSection(LEAGUE, process.argv.slice(2));
if (sections.includes('roster-review')) rosterReviewSection(LEAGUE, process.argv.slice(2));
if (sections.includes('detector')) detectorSection(process.argv.slice(2));
if (sections.includes('platoon-detector')) platoonDetectorSection(process.argv.slice(2));
if (sections.includes('stakes-lines')) await stakesLinesSection(LEAGUE, process.argv.slice(2));

// ── Player Development's ceiling lines, measured on the league's major leaguers (D-053, cycle 4) ─────────────

async function stakesLinesSection(league: number, argv: string[]): Promise<void> {
  heading('15. Developmental stakes: the ceiling lines, measured on this league\'s major leaguers');
  // Loaded here only, so the other sections' refits never include it
  await import('../server/stakesLinesRefit.js');
  const { computeCalibrationRefits, recordCalibrationRefits } = await import('../server/saveCalibration.js');
  const pending = computeCalibrationRefits({ leagues: [league], force: true, components: ['ceiling_lines'] });
  for (const p of pending) {
    console.log(`${p.outcome.component} (${p.outcome.method}), basis ${p.outcome.basis ?? '—'}: ${p.outcome.refit ? (p.outcome.adopted ? 'SERVED' : 'NOT SERVED') : 'not measured'}; ${p.outcome.reason}`);
    for (const c of p.run?.record.heldOut ?? []) console.log(`  ${c.kind} ${c.part}: ${c.note}`);
    for (const n of p.run?.record.notes ?? []) console.log(`  ${n}`);
  }
  if (argv.includes('--refit')) {
    const out = recordCalibrationRefits(pending);
    console.log(`recorded: ${out.filter((o) => o.refit).map((o) => `${o.component} ${o.adopted ? 'served' : 'not served'}`).join(', ')}`);
  } else console.log('(nothing written; --refit records the measurement in history.db)');
}
