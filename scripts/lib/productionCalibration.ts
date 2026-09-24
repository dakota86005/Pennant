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
  fitProductionModel, fitRatingsModel, productionHistory, ratingsHistory, refitProductionIfNeeded, refitRatingsIfNeeded,
  type CoverageRow, type FitRun, type ProductionModel, type RatingsFitRun,
} from '../../server/playerValue.js';
import { PRODUCTION_POLICY, PRODUCTION_PRIOR, PRODUCTION_PRIOR_SOURCE, RATINGS_PRIOR } from '../../server/playerValueCalibration.js';
import { seasonTotals } from '../../server/playerValueProductionFit.js';

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
  console.log(`  held out ${r.window.holdout.join(', ') || 'none'}, projected from rolling origins ${(r.window.scored ?? []).map((x) => `${x.origin} (${x.cases})`).join(', ')}, each by the method fitted through it (recency half-life ${r.window.recencyHalfLife ?? 'none'}); the model served is refit through ${r.window.seasons[r.window.seasons.length - 1] ?? '—'}`);
  console.log(`  players ${r.sample.players}; aging pairs hitters ${r.sample.agingPairs.hitter}, pitchers ${r.sample.agingPairs.pitcher}`);
  for (const [k, c] of Object.entries(r.sample.cases)) console.log(`  training cases ${k.padEnd(9)} by horizon ${c.join(' / ')}`);
  console.log(`  prior weight overall ${f(r.priorWeight.overall)}; ${Object.entries(r.priorWeight.kinds).map(([k, w]) => `${k} ${f(w)}`).join(', ')}; aging hitters ${f(r.priorWeight.aging.hitter)}, pitchers ${f(r.priorWeight.aging.pitcher)}`);
  console.log(`  gate: ${r.gate.passed ? 'PASSED' : 'FAILED'} — ${r.gate.reason}`);
  console.log(`  time: history read ${Math.round(ms.read)} ms, fit ${Math.round(ms.fit)} ms`);
  table(r.coverage.asFitted, 'Held-out coverage AS FITTED (training tails), pooled over kinds');
  table(r.coverage.adopted, 'Held-out coverage AS SERVED (with each horizon\'s prior widening; no widening chosen on the held-out cases), pooled');
  for (const [k, rows] of Object.entries(r.coverage.byKind)) table(rows, `  ...served, ${k}`);
  for (const [k, rows] of Object.entries(r.coverage.byUsage ?? {})) table(rows, `  ...served, ${k} expected usage (a third of each kind)`);
  for (const [k, rows] of Object.entries(r.coverage.byQuality ?? {})) table(rows, `  ...served, ${k} of projected rate (top and bottom tenth of each kind); bias = actual − central`);
  console.log('\nAging (WAR per 600 opportunities, change from each age to the next)');
  for (const g of ['hitter', 'pitcher'] as const) {
    const t = run.model.aging[g];
    console.log(`  ${g}: peak (first age with no further gain) ${r.aging[g].peakAge}; mean change 30–33 ${f(r.aging[g].declineFrom30)}, 34–37 ${f(r.aging[g].declineFrom34)}`);
    console.log(`    ${t.map((d, i) => `${run.model.aging.firstAge + i}:${d >= 0 ? '+' : ''}${d.toFixed(2)}`).join(' ')}`);
  }
  console.log('\nRegression and noise per kind (rates per 600; playing time per scheduled game)');
  for (const [k, m] of Object.entries(run.model.kinds)) {
    console.log(`  ${k.padEnd(9)} usage tier cuts ${m.usageCuts.map((c) => c.toFixed(2)).join(', ') || 'none'} per game; ceiling ${m.ceiling === null || m.ceiling === undefined ? '—' : m.ceiling.toFixed(2)} per game; weights ${m.weights.map((w) => w.toFixed(2)).join('/')}, K ${Math.round(m.stabilization)}, mean ${f(m.mean600, 2)}, noise ${f(m.noise600, 2)}, rate scale ${f(m.rateScale600, 2)}`);
    const terms = (t: { intercept: number; recent: number[]; quality: number; older: number; younger: number }, d: number) =>
      `${f(t.intercept, d)} + ${t.recent.map((c) => f(c, 4)).join('/')} · slots + ${f(t.quality, 3)} · quality, older ${f(t.older, 3)}, younger ${f(t.younger, 3)}`;
    m.horizons.forEach((h, i) => console.log(`    h${i + 1}: chance logit ${terms(h.chance, 2)}; per game when he plays ${terms(h.conditional, 3)}; spread ${f(h.playSpread.base, 3)} + ${f(h.playSpread.slope, 3)}·m; selection ${f(h.survivor.intercept, 2)} + ${f(h.survivor.slope, 2)}·rate (older ${f(h.survivor.older, 3)}, younger ${f(h.survivor.younger, 3)}); drift ${f(h.drift600 ?? 0, 3)}; prior ${f(h.priorWeight ?? 0, 2)}`));
  }
  console.log(`\nLogistic health: ${JSON.stringify(r.logistic)}`);
  console.log(`Prior overlaps the held-out seasons: ${r.priorOverlapsHoldout ? 'yes (not used)' : 'no'}`);
  if (r.gate.failures && r.gate.failures.length > 0) console.log(`Gate failures:\n  ${r.gate.failures.join('\n  ')}`);
  const sub = r.coverage.subgroups ?? {};
  console.log('\nAs fitted by subgroup (80 / 50, bias, mean |actual|), horizons 1 3 5 7');
  for (const [name, rows] of Object.entries(sub)) {
    console.log(`  ${name.padEnd(16)} ${[1, 3, 5, 7].map((h) => { const x = rows[h - 1]; return x && x.cases > 0 ? `${pct(x.outer).trim()}/${pct(x.inner).trim()} ${x.bias === null ? '—' : (x.bias >= 0 ? '+' : '') + x.bias.toFixed(2)} (${(x.meanAbsolute ?? 0).toFixed(2)}, n ${x.cases})` : '—'; }).join(' | ')}`);
  }
  if (r.coverage.played) table(r.coverage.played, 'As fitted, the cases that played at the target horizon');
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
  console.log(`Policy: coverage ${PRODUCTION_POLICY.coverage.outer}/${PRODUCTION_POLICY.coverage.inner}, window ${PRODUCTION_POLICY.window.maxSeasons} seasons, rolling origins from the window start + ${PRODUCTION_POLICY.rolling.firstOriginAfter}, at most ${PRODUCTION_POLICY.rolling.maxOrigins}, half-life ${PRODUCTION_POLICY.window.recencyHalfLife ?? 'none'}, gate ±${PRODUCTION_POLICY.gate.coverage.pooled} pooled / ±${PRODUCTION_POLICY.gate.coverage.subgroup} subgroups, bias ${PRODUCTION_POLICY.gate.bias.relative} or ${PRODUCTION_POLICY.gate.bias.standardErrors} SE`);
  // The last completed season: this is what the post-import refit uses (season − 1 while this one is under way)
  const through = season - 1;
  let start = performance.now();
  const history = productionHistory(leagueId, through, false, rules);
  const read = performance.now() - start;
  start = performance.now();
  // --half-life=N (seasons) or --half-life=none compares the recency weighting against the policy's
  const hl = argv.find((a) => a.startsWith('--half-life='))?.slice('--half-life='.length);
  const recencyHalfLife = hl === undefined ? undefined : hl === 'none' ? null : Number(hl);
  const run = fitProductionModel(history, { prior: PRODUCTION_PRIOR, priorSource: PRODUCTION_PRIOR_SOURCE, recencyHalfLife });
  describe(run, { read, fit: performance.now() - start });

  if (argv.includes('--prior')) {
    start = performance.now();
    const prior = fitProductionModel(history, { prior: null, holdout: false });
    console.log(`\nFallback prior (every season ${prior.record.window.seasons[0]}–${through}, no hold-out), ${Math.round(performance.now() - start)} ms:`);
    describe(prior, { read, fit: performance.now() - start });
    console.log('\nPRODUCTION_PRIOR literal:\n' + JSON.stringify(round(prior.model), null, 2));
    console.log('\nPRODUCTION_PRIOR_SOURCE literal:\n' + JSON.stringify(Object.fromEntries(Object.entries(seasonTotals(history)).filter(([s]) => prior.record.window.seasons.includes(Number(s))).map(([s, t]) => [s, { opportunities: Math.round(t.opportunities), war: Number(t.war.toFixed(1)) }]))));
  }

  // ── phase 3b: the ratings model (mapping, arrivals, development) ──
  console.log(`\n${'='.repeat(78)}\n10b. Ratings (Player Value phase 3b): the save's own ratings fit (D-053)\n${'='.repeat(78)}`);
  start = performance.now();
  const rInput = ratingsHistory(leagueId, through, false, rules);
  const rRead = performance.now() - start;
  start = performance.now();
  const rRun = fitRatingsModel(rInput, { prior: RATINGS_PRIOR });
  describeRatings(rRun, { read: rRead, fit: performance.now() - start }, rInput.mapping.length, rInput.arrival.length, rInput.observations.length);

  if (argv.includes('--prior')) {
    start = performance.now();
    const prior = fitRatingsModel(rInput, { prior: null, holdout: false });
    console.log(`\nRatings fallback prior (no prior, no hold-out), ${Math.round(performance.now() - start)} ms:`);
    describeRatings(prior, { read: rRead, fit: performance.now() - start }, rInput.mapping.length, rInput.arrival.length, rInput.observations.length);
    console.log('\nRATINGS_PRIOR literal:\n' + JSON.stringify(roundAny({ ...prior.model, arrival: null }), null, 2));
  }

  if (argv.includes('--refit')) {
    start = performance.now();
    const outcome = refitProductionIfNeeded({ force: true, leagues: [leagueId] });
    console.log(`\nForced refit recorded (${Math.round(performance.now() - start)} ms): ${JSON.stringify(outcome)}`);
    start = performance.now();
    const ratings = refitRatingsIfNeeded({ force: true, leagues: [leagueId] });
    console.log(`Forced ratings refit recorded (${Math.round(performance.now() - start)} ms): ${JSON.stringify(ratings)}`);
  }
}

const roundAny = <T>(m: T): T => JSON.parse(JSON.stringify(m, (_k, v) => (typeof v === 'number' ? Number(v.toPrecision(4)) : v)));

function describeRatings(run: RatingsFitRun, ms: { read: number; fit: number }, mapped: number, arrivals: number, observations: number): void {
  const r = run.record;
  const m = run.model;
  console.log(`\nRatings fit ${r.id}: ${r.label}`);
  console.log(`  read ${Math.round(ms.read)} ms (${mapped} major leaguers with ratings and window results, ${arrivals} players with minor-league usage, ${observations} rating snapshots); fit ${Math.round(ms.fit)} ms`);
  console.log(`  gate: ${r.gate.passed ? 'PASSED' : 'FAILED'} — ${r.gate.reason}`);
  console.log(`  mapping cases: ${JSON.stringify(r.mapping.cases)}; hitter variants ${JSON.stringify(r.mapping.variants)}`);
  const c = r.mapping.coverage;
  console.log(`  mapping held-out coverage (80/50), as fitted ${pctR(c.asFitted.outer)} / ${pctR(c.asFitted.inner)} on ${c.asFitted.cases}; served ${pctR(c.served.outer)} / ${pctR(c.served.inner)}`);
  for (const [k, v] of Object.entries(c.byKind)) console.log(`    ${k.padEnd(9)} ${pctR(v.outer)} / ${pctR(v.inner)} on ${v.cases}`);
  console.log(`  true-rate uncertainty given ratings (sd, WAR per 600): ${Object.entries(r.mapping.uncertainty).map(([k, v]) => `${k} ${f(v, 2)}`).join(', ')}`);
  const h = m.mapping.hitter.full;
  console.log(`  hitter (full) slopes per point: ${Object.entries(h.tools).map(([k, v]) => `${k} ${f(v, 3)}`).join(', ')}, running ${f(h.running, 3)}, glove ${f(h.glove, 3)}; intercepts ${Object.entries(h.intercepts).map(([k, v]) => `${k} ${f(v, 2)}`).join(', ')}`);
  for (const k of ['starter', 'reliever'] as const) {
    const p = m.mapping[k];
    console.log(`  ${k} slopes: ${Object.entries(p.tools).map(([t, v]) => `${t} ${f(v, 3)}`).join(', ')}; intercept ${f(p.intercept, 2)}`);
  }
  console.log(`  ${r.mapping.caveat}`);
  console.log(`  left-handed exposure by hand: ${JSON.stringify(r.leftShare)}; stamina cut ${r.staminaCut.cut} (misclassifies ${r.staminaCut.error === null ? '—' : pctR(r.staminaCut.error)} of ${r.staminaCut.cases})`);
  console.log(`  arrival: ${r.arrival.reason} Window ${r.arrival.window[0]}–${r.arrival.window[r.arrival.window.length - 1]}, trained through ${r.arrival.trainingThrough}, held out ${r.arrival.holdout.join(', ') || 'none'}; ${r.arrival.cells} cells`);
  console.log('  horizon   cases   predicted chance   observed (± se, clustered)   bias/observed   predicted mean opp   observed mean opp (± se)   bias/observed');
  const rel = (o: number | null, p: number | null) => (o === null || p === null || o === 0 ? '—' : `${((o - p) / o * 100).toFixed(1)}%`);
  for (const x of r.arrival.heldOut) {
    console.log(`  ${String(x.horizon).padStart(7)}  ${String(x.cases).padStart(6)}   ${pctR(x.predicted).padStart(8)}          ${pctR(x.observed).padStart(8)} (± ${x.chanceSe == null ? '—' : pctR(x.chanceSe)})   ${rel(x.observed, x.predicted).padStart(8)}   ${x.predictedMean === null ? '—' : f(x.predictedMean, 1).padStart(8)}             ${x.observedMean === null ? '—' : f(x.observedMean, 1).padStart(8)} (± ${x.meanSe == null ? '—' : f(x.meanSe, 2)})   ${rel(x.observedMean, x.predictedMean).padStart(8)}`);
  }
  const q = m.arrival?.quality;
  if (q) {
    const located = m.arrival!.cells.filter((c) => c.horizons.some((h) => (h?.population?.length ?? 0) > 0)).length;
    console.log(`  quality (the results fit's effect at the same usage, per WAR per 600 above replacement): chance logit ${(['hitter', 'starter', 'reliever'] as const).map((k) => `${k} ${q.chance[k].map((v) => f(v, 2)).join('/')}`).join('; ')}; playing time per game ${(['hitter', 'starter', 'reliever'] as const).map((k) => `${k} ${q.perGame[k].map((v) => f(v, 2)).join('/')}`).join('; ')}; located on ${located} of ${m.arrival!.cells.length} cells' players now`);
  } else {
    console.log('  quality: not located (no cell players now, or no arrivals): a prospect\'s chance and playing time are his cell\'s');
  }
  console.log(`  reliability as a forecast: ${r.reliability.note} ${JSON.stringify(m.reliability)}`);
  console.log(`  development: ${r.development.label}`);
  console.log(`  arrival by potential: ${r.arrivalByPotential.used ? 'used' : 'not used'} (${r.arrivalByPotential.linked} linked of ${r.arrivalByPotential.minimum}); ${r.arrivalByPotential.findings.slice(0, 3).join(' ')}`);
  console.log(`  cross-section mean scouted gap by age (hitters): ${r.development.crossSectionGap.hitter.filter(([, g]) => g !== null).map(([a, g]) => `${a}:${f(g as number, 1)}`).join(' ')}`);
  console.log(`  cross-section mean scouted gap by age (pitchers): ${r.development.crossSectionGap.pitcher.filter(([, g]) => g !== null).map(([a, g]) => `${a}:${f(g as number, 1)}`).join(' ')}`);
}

const pctR = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
