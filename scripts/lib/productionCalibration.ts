/**
 * The harness's production section (D-053, PLAYER_VALUE.md Part 7): run the save's production fit
 * exactly as the post-import refit does, and print what it found. Read-only unless `--refit` is
 * given, which records the fit in history.db in OOTP_FO_DATA_DIR (point it at a scratch copy).
 *
 *   OOTP_FO_DATA_DIR=<dir> OOTP_FO_DB_READONLY=1 npx tsx scripts/calibrate.ts production
 *   ... production --prior     also fit the fallback prior (every season, no prior, no hold-out) and
 *                              print it as the TypeScript literal for playerValueCalibration.ts
 *   ... production --refit     force a refit of the save and record it (developer use)
 */

import { performance } from 'node:perf_hooks';
import { allLeagueRules } from '../../server/leagueRules.js';
import {
  fitProductionModel, productionHistory, refitProductionIfNeeded, type CoverageRow, type FitRun, type ProductionModel,
} from '../../server/playerValue.js';
import { PRODUCTION_POLICY, PRODUCTION_PRIOR } from '../../server/playerValueCalibration.js';

const pct = (x: number | null) => (x === null ? '   —  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
const f = (x: number, d = 3) => x.toFixed(d);

function table(rows: CoverageRow[], title: string): void {
  console.log(`\n${title}`);
  console.log('  horizon   cases    80% band   50% band   bias (wins)');
  for (const r of rows) {
    console.log(`  ${String(r.horizon).padStart(7)}  ${String(r.cases).padStart(6)}    ${pct(r.outer)}     ${pct(r.inner)}    ${r.bias === null ? '  —  ' : f(r.bias, 2).padStart(5)}`);
  }
}

function describe(run: FitRun, ms: { read: number; fit: number }): void {
  const r = run.record;
  console.log(`\nFit ${r.id}: ${r.label}`);
  console.log(`  window ${r.window.seasons[0]}–${r.window.seasons[r.window.seasons.length - 1]} (${r.window.seasons.length} seasons); skipped ${r.window.skipped.map((s) => `${s.season} (${s.reason})`).join(', ') || 'none'}`);
  console.log(`  trained through ${r.window.trainingThrough}; held out ${r.window.holdout.join(', ') || 'none'}`);
  console.log(`  players ${r.sample.players}; aging pairs hitters ${r.sample.agingPairs.hitter}, pitchers ${r.sample.agingPairs.pitcher}`);
  for (const [k, c] of Object.entries(r.sample.cases)) console.log(`  training cases ${k.padEnd(9)} by horizon ${c.join(' / ')}`);
  console.log(`  prior weight overall ${f(r.priorWeight.overall)}; ${Object.entries(r.priorWeight.kinds).map(([k, w]) => `${k} ${f(w)}`).join(', ')}; aging hitters ${f(r.priorWeight.aging.hitter)}, pitchers ${f(r.priorWeight.aging.pitcher)}`);
  console.log(`  gate: ${r.gate.passed ? 'PASSED' : 'FAILED'} — ${r.gate.reason}`);
  console.log(`  time: history read ${Math.round(ms.read)} ms, fit ${Math.round(ms.fit)} ms`);
  table(r.coverage.asFitted, 'Held-out coverage AS FITTED (training tails), pooled over kinds');
  table(r.coverage.adopted, 'Held-out coverage AS SERVED (after hold-out widening where a horizon fell short, with the prior\'s weight), pooled');
  for (const [k, rows] of Object.entries(r.coverage.byKind)) table(rows, `  ...served, ${k}`);
  for (const [k, rows] of Object.entries(r.coverage.byUsage ?? {})) table(rows, `  ...served, ${k} expected usage (a third of each kind)`);
  console.log('\nAging (WAR per 600 opportunities, change from each age to the next)');
  for (const g of ['hitter', 'pitcher'] as const) {
    const t = run.model.aging[g];
    console.log(`  ${g}: peak (first age with no further gain) ${r.aging[g].peakAge}; mean change 30–33 ${f(r.aging[g].declineFrom30)}, 34–37 ${f(r.aging[g].declineFrom34)}`);
    console.log(`    ${t.map((d, i) => `${run.model.aging.firstAge + i}:${d >= 0 ? '+' : ''}${d.toFixed(2)}`).join(' ')}`);
  }
  console.log('\nRegression and noise per kind (rates per 600)');
  for (const [k, m] of Object.entries(run.model.kinds)) {
    console.log(`  ${k.padEnd(9)} usage tier cuts ${m.usageCuts.map((c) => Math.round(c)).join(', ') || 'none'}; weights ${m.weights.map((w) => w.toFixed(2)).join('/')}, K ${Math.round(m.stabilization)}, mean ${f(m.mean600, 2)}, noise ${f(m.noise600, 2)}, rate scale ${f(m.rateScale600, 2)}`);
    m.horizons.forEach((h, i) => console.log(`    h${i + 1}: usage ${f(h.usage.intercept, 0)} + ${h.usage.recent.map((c) => f(c, 3)).join('/')} · slots, older ${f(h.usage.older, 1)}, younger ${f(h.usage.younger, 1)}; spread ${f(h.usageSpread.base, 0)} + ${f(h.usageSpread.slope, 3)}·P; tails by usage tier (80 low/high, 50 low/high) ${h.tails.map((t) => `${f(t.low80, 2)}/${f(t.high80, 2)} ${f(t.low50, 2)}/${f(t.high50, 2)}`).join(" | ")}; drift ${f(h.drift600 ?? 0, 3)}`));
  }
  console.log('\nInjury proneness');
  for (const line of r.proneness) console.log(`  ${line}`);
  if (run.model.proneness) console.log(`  cuts ${run.model.proneness.cuts.map((c) => f(c, 0)).join(', ')}; usage ${JSON.stringify(run.model.proneness.usage)}; aging ${JSON.stringify(run.model.proneness.aging)}`);
}

const round = (m: ProductionModel): ProductionModel => JSON.parse(JSON.stringify(m, (_k, v) => (typeof v === 'number' ? Number(v.toPrecision(4)) : v)));

export function productionSection(leagueId: number, argv: string[]): void {
  const rules = allLeagueRules();
  const season = rules.get(leagueId)?.contract.season.value ?? null;
  if (season === null) throw new Error(`League ${leagueId} has no season in the export.`);
  console.log(`\n${'='.repeat(78)}\n10. Production (Player Value phase 3a): the save's own fit (D-053)\n${'='.repeat(78)}`);
  console.log(`Policy: coverage ${PRODUCTION_POLICY.coverage.outer}/${PRODUCTION_POLICY.coverage.inner}, window ${PRODUCTION_POLICY.window.maxSeasons} seasons, hold-out share ${PRODUCTION_POLICY.window.holdoutShare}, gate ±${PRODUCTION_POLICY.gate.tolerance}`);
  // The last completed season: this is what the post-import refit uses (season − 1 while this one is under way)
  const through = season - 1;
  let start = performance.now();
  const history = productionHistory(leagueId, through, false, rules);
  const read = performance.now() - start;
  start = performance.now();
  const run = fitProductionModel(history, { prior: PRODUCTION_PRIOR });
  describe(run, { read, fit: performance.now() - start });

  if (argv.includes('--prior')) {
    start = performance.now();
    const prior = fitProductionModel(history, { prior: null, holdout: false });
    console.log(`\nFallback prior (every season ${prior.record.window.seasons[0]}–${through}, no hold-out), ${Math.round(performance.now() - start)} ms:`);
    describe(prior, { read, fit: performance.now() - start });
    console.log('\nPRODUCTION_PRIOR literal:\n' + JSON.stringify(round(prior.model), null, 2));
  }

  if (argv.includes('--refit')) {
    start = performance.now();
    const outcome = refitProductionIfNeeded({ force: true, leagues: [leagueId] });
    console.log(`\nForced refit recorded (${Math.round(performance.now() - start)} ms): ${JSON.stringify(outcome)}`);
  }
}
