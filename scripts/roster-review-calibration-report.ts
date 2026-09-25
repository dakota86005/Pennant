/**
 * Before and after: what the save's own yardsticks would change in the roster review (D-053, cycle 1; docs/CALIBRATION.md
 * section 12). Read-only: it fits every group (writing nothing), then reviews every club of the league three ways and compares.
 *
 *   OOTP_FO_DATA_DIR=<dir with league.db> OOTP_FO_DB_READONLY=1 npm run review:calibration-report [-- --org <teamId>]
 *
 *   A  the built-in starting values (today's behavior)
 *   B  A, with each lens read against its own measured line (the owner's 2026-09-24 decision), and nothing else
 *   C  what the save serves: every group adopted and, for a tuning value (the aging curve, the season weights and stabilization),
 *      the league's own only where clearly better on held-out seasons (cycle 2, owner 2026-09-25)
 *
 * For each number: the built-in value, the fitted one, the checks and the verdict. For the configured organization and league-wide:
 * the findings that appear, disappear or change strength from A to B (the lens change alone) and from B to C (everything else), the
 * role floors that move, and the age explanations whose stated decline changes. Then, each separately (cycle 2): the season weights
 * and stabilization (the detector's verdict, and what the league's own values would have changed had they served), the aging rule
 * change (cycle 1 served the league's own curve; the "clearly better" rule may keep the starting one), and the wOBA scale (derived per
 * league-season: the wRC+ shifts by level, and the farm-facing form reads that change). Then (cycle 3) the long-man line on its own:
 * C with the standards measured under the starting line and the starting lines (C0), against C (the standards measured under the
 * league's own line, served with it): long-man labels, flags and crowded-bullpen reads per club and league-wide; and the platoon
 * weight's verdict and what it moves.
 */

import { db } from '../server/db.js';
import '../server/mlbCalibrationRefit.js';
import { computeCalibrationRefits } from '../server/saveCalibration.js';
import { reviewClub, type RoleGroupReview } from '../server/mlbReview.js';
import { loadClubView } from '../server/mlbRoster.js';
import { reviewPorts } from '../server/mlbOperations.js';
import { majorLeagueId } from '../server/resultsEvidence.js';
import { standardsFrom, STARTING_STANDARDS, HITTER_STANDARD_PRIOR, RELIEVER_STANDARD_PRIOR, type RoleStandardsSet, type ServedStandards } from '../server/roleStandards.js';
import type { ReviewCalibration } from '../server/roleReview.js';
import type { AgingModel, DefenseModel, StandardsModel } from '../server/mlbCalibrationFit.js';
import { DEFENSE_WEIGHT, expectedAnnualChange } from '../server/roleReview.js';
import { printPending } from './lib/rosterReviewCalibration.js';
import { RESULTS_PRIOR, type ResultsParams } from '../server/resultsMetrics.js';
import { paramsOf, type ResultsModel } from '../server/mlbResultsFit.js';
import { describeComparison, ruleText, type Comparison } from '../server/calibrationDetector.js';
import { computeBatting, leagueBaseline, WOBA_SCALE_FALLBACK } from '../server/stats.js';
import { BULLPEN_PRIOR, type BullpenLines } from '../server/bullpenRoles.js';
import { measureStandards, rekeyRelievers } from '../server/mlbCalibrationFit.js';
import { resultsLensHistory, standardsSample } from '../server/mlbCalibrationRefit.js';
import { PLATOON_PRIOR } from '../server/platoon.js';
import { completedThrough } from '../server/saveIdentity.js';
import type { PlatoonModel } from '../server/mlbPlatoonFit.js';
import { evaluatePlatoon } from '../server/platoon.js';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const human = (db.prepare(`SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1`).get() as { team_id: number } | undefined)?.team_id ?? null;
const org = arg('--org') ? Number(arg('--org')) : human;
if (org === null) { console.error('No organization: pass --org <teamId>.'); process.exit(1); }
const league = majorLeagueId(org);
if (league === null) { console.error(`Organization ${org} has no major league.`); process.exit(1); }
const orgName = (db.prepare(`SELECT name, nickname FROM teams WHERE team_id = ?`).get(org) as { name: string; nickname: string } | undefined);
const leagueDate = (db.prepare(`SELECT "current_date" AS d FROM leagues WHERE league_id = ?`).get(league) as { d: string } | undefined)?.d;
console.log(`Roster review yardsticks: before and after\nOrganization ${org} (${orgName ? `${orgName.name} ${orgName.nickname}` : '?'}), league ${league}, game date ${leagueDate ?? '?'}\n`);

// ── the fits ─────────────────────────────────────────────────────────────────
const t0 = performance.now();
const pending = computeCalibrationRefits({ leagues: [league], force: true });
console.log(`${'='.repeat(78)}\n1. THE FITS (computed now, nothing written; ${Math.round(performance.now() - t0)} ms)\n${'='.repeat(78)}`);
printPending(pending);
const run = <M>(component: string) => pending.find((p) => p.outcome.component === component)?.run ?? null;
const std = run<StandardsModel>('standards');
const aging = run<AgingModel>('aging');
const defense = run<DefenseModel>('defense');
const results = run<ResultsModel>('results');
const stdModel = std?.record.gate.passed ? (std.model as StandardsModel) : null;
const agingModel = aging?.record.gate.passed ? (aging.model as AgingModel) : null;
const defenseModel = defense?.record.gate.passed ? (defense.model as DefenseModel) : null;

// ── the numbers, built-in against fitted ───────────────────────────────────────
console.log(`\n${'='.repeat(78)}\n2. EACH NUMBER: built-in value against the save's (served only if its group passed)\n${'='.repeat(78)}`);
const r1 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(1));
const served: ServedStandards | null = std?.model ? (std.model as StandardsModel).served : null;
console.log(`\nStandards (${std?.record.gate.passed ? 'would be ADOPTED' : 'NOT adopted'}): role  built-in typical/bat  ->  save typical/bat   [measured median, holders, weight of the measurement]`);
const roleKeys = Object.keys(STARTING_STANDARDS.roles);
for (const k of roleKeys) {
  const b = STARTING_STANDARDS.roles[k];
  const s = served?.roles[k];
  const m = (std?.model as StandardsModel | null)?.roles[k];
  console.log(`  ${k.padEnd(18)} ${String(b.typical).padStart(3)}/${b.bat === undefined ? ' — ' : String(b.bat).padStart(3)}  ->  ${r1(s?.typical).padStart(5)}/${s?.bat === undefined ? '  —  ' : r1(s.bat).padStart(5)}   [${r1(m?.typical)}, n ${m?.n ?? 0}, w ${m ? m.weight.toFixed(2) : '—'}]`);
}
if (served) {
  for (const g of ['hitter', 'starter', 'reliever'] as const) console.log(`  gaps ${g.padEnd(8)} built-in ${STARTING_STANDARDS.gaps[g].floor}/${STARTING_STANDARDS.gaps[g].deep}  ->  save ${r1(served.gaps[g].floor)}/${r1(served.gaps[g].deep)}`);
  for (const lens of ['tools', 'results'] as const) {
    const l = served.lenses[lens];
    if (!l) continue;
    console.log(`  ${lens} lens: own gap ${Object.entries(l.gap).map(([g, v]) => `${g} ${r1(v)}`).join(', ')} (built-in lens gap = the estimate's: ${STARTING_STANDARDS.gaps.hitter.floor}/${STARTING_STANDARDS.gaps.starter.floor}/${STARTING_STANDARDS.gaps.reliever.floor})`);
  }
}
console.log(`\nAging (${aging?.record.gate.passed ? 'would be ADOPTED' : 'NOT adopted'}): age  hitter built-in -> save (wOBA points a year)   pitcher built-in -> save (FIP runs per nine a year)`);
for (const age of [24, 26, 28, 30, 32, 34, 35, 36, 38, 40]) {
  const t = (aging?.model as AgingModel | null)?.table ?? null;
  console.log(`  ${age}   ${(expectedAnnualChange(age, false) * 1000).toFixed(1).padStart(6)} -> ${t ? (expectedAnnualChange(age, false, t) * 1000).toFixed(1).padStart(6) : '   —  '}      ${expectedAnnualChange(age, true).toFixed(3).padStart(6)} -> ${t ? expectedAnnualChange(age, true, t).toFixed(3).padStart(6) : '   —  '}`);
}
console.log(`\nGlove weights (${defense?.record.gate.passed ? 'would be ADOPTED' : 'NOT adopted'}): ${Object.entries(DEFENSE_WEIGHT).map(([p, w]) => `${p}: ${w}${defenseModel ? ` -> ${defenseModel.weights[Number(p)].toFixed(2)}` : ''}`).join(', ')}`);
if (!defenseModel) console.log(`  ${defense?.record.gate.reason ?? 'not fitted'}`);

// ── the review three ways ────────────────────────────────────────────────────
type Yard = { standards: RoleStandardsSet; review: ReviewCalibration; bullpen: BullpenLines };
// The standards as cycles 1 and 2 measured them: under the starting bullpen lines (the same review, the tiers read at 1.6)
const servedResultsEarly = results?.record.gate.passed && results.model ? paramsOf(results.model as ResultsModel, String(results.record.basis.throughSeason)) : RESULTS_PRIOR;
const t2 = performance.now();
const sampleAtStart = standardsSample(league, servedResultsEarly, BULLPEN_PRIOR);
const hist = resultsLensHistory(league, completedThrough(league).season, servedResultsEarly);
const stdAtStart = measureStandards(rekeyRelievers(sampleAtStart, BULLPEN_PRIOR), hist.seasons, { leagueId: league, throughSeason: completedThrough(league).season, gameDate: leagueDate ?? null }, undefined, undefined, hist.skipped);
const stdAtStartModel = stdAtStart.record.gate.passed ? (stdAtStart.model as StandardsModel) : null;
console.log(`\n(the standards re-measured under the starting line for the comparison: ${stdAtStart.record.gate.passed ? 'would pass' : 'would not pass'}, ${Math.round(performance.now() - t2)} ms)`);
const linesServed: BullpenLines = stdModel?.bullpen?.lines ?? BULLPEN_PRIOR;
const A: Yard = { standards: standardsFrom(), review: {}, bullpen: BULLPEN_PRIOR };
const B: Yard = {
  standards: standardsFrom(stdModel ? { ...STARTING_STANDARDS, lenses: stdModel.served.lenses } : STARTING_STANDARDS), review: {}, bullpen: BULLPEN_PRIOR,
};
// C0: everything the save serves except the long-man line (standards measured under the starting line, the starting lines)
const C0: Yard = {
  standards: standardsFrom(stdAtStartModel?.served ?? STARTING_STANDARDS),
  review: { aging: agingModel?.table ?? null, defenseWeights: defenseModel?.weights ?? null }, bullpen: BULLPEN_PRIOR,
};
const C: Yard = {
  standards: standardsFrom(stdModel?.served ?? STARTING_STANDARDS),
  review: { aging: agingModel?.table ?? null, defenseWeights: defenseModel?.weights ?? null }, bullpen: linesServed,
};

type Row = { club: number; playerId: number; name: string; group: string; kind: string; strength: string; floor: number | null; explanations: string; tier: string | null };
const penKinds = new Map<string, Map<number, string[]>>();
const teams = db.prepare(`SELECT team_id, abbr FROM teams WHERE league_id = ? AND level = 1 ORDER BY team_id`).all(league) as Array<{ team_id: number; abbr: string }>;
const abbr = new Map(teams.map((t) => [t.team_id, t.abbr]));
function reviewAll(y: Yard, resultsParams: ResultsParams = RESULTS_PRIOR, label = ''): Map<string, Row> {
  const out = new Map<string, Row>();
  const pens = new Map<number, string[]>();
  for (const t of teams) {
    const ports = { ...reviewPorts(t.team_id, { results: resultsParams, bullpen: y.bullpen }), calibration: { standards: y.standards, review: y.review } };
    let groups: RoleGroupReview[];
    try { groups = reviewClub(loadClubView(t.team_id), ports); } catch { continue; }
    for (const g of groups) {
      if (g.kind === 'relief_pitcher') pens.set(t.team_id, (g.pen ?? []).map((f) => (f.kind === 'crowded_role' ? `crowded:${f.players[0]?.tier}` : f.kind)));
      for (const h of g.holders) {
        out.set(`${t.team_id}:${g.role}:${h.playerId}`, { club: t.team_id, playerId: h.playerId, name: h.name, group: g.role, kind: h.kind, strength: h.strength, floor: h.standard?.floor ?? null, explanations: h.explanations.join(' | '), tier: (h as { tier?: string | null }).tier ?? null });
      }
    }
  }
  if (label) penKinds.set(label, pens);
  return out;
}
const t1 = performance.now();
// What the save serves for the results lens: its own only where the detector found them clearly better
const servedResults = servedResultsEarly;
const [ra, rb, rc0, rc] = [reviewAll(A), reviewAll(B), reviewAll(C0, servedResults, 'C0'), reviewAll(C, servedResults, 'C')];
console.log(`\n(${new Set([...ra.values()].map((r) => r.club)).size} clubs with a reviewed roster, each reviewed three ways, in ${Math.round(performance.now() - t1)} ms)`);

const isFlag = (s: string) => s === 'strong' || s === 'moderate';
function compare(title: string, before: Map<string, Row>, after: Map<string, Row>) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
  const changes: Array<{ row: Row; from: Row; what: string }> = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b) continue;
    if (b.kind === a.kind && b.strength === a.strength) continue;
    const what = !isFlag(b.strength) && isFlag(a.strength) ? 'APPEARS' : isFlag(b.strength) && !isFlag(a.strength) ? 'DISAPPEARS' : 'CHANGES';
    changes.push({ row: a, from: b, what });
  }
  const count = (m: Map<string, Row>, club?: number) => [...m.values()].filter((r) => (club === undefined || r.club === club) && isFlag(r.strength)).length;
  const bySt = (m: Map<string, Row>, s: string, club?: number) => [...m.values()].filter((r) => (club === undefined || r.club === club) && r.strength === s).length;
  for (const [label, club] of [[`Your organization (${abbr.get(org as number) ?? org})`, org as number], ['League-wide', undefined]] as const) {
    const cs = changes.filter((c) => club === undefined || c.row.club === club);
    console.log(`\n${label}: flags (strong or moderate) ${count(before, club)} -> ${count(after, club)}; strong ${bySt(before, 'strong', club)} -> ${bySt(after, 'strong', club)}, moderate ${bySt(before, 'moderate', club)} -> ${bySt(after, 'moderate', club)}, watch ${bySt(before, 'watch', club)} -> ${bySt(after, 'watch', club)}`);
    console.log(`  ${cs.filter((c) => c.what === 'APPEARS').length} appear, ${cs.filter((c) => c.what === 'DISAPPEARS').length} disappear, ${cs.filter((c) => c.what === 'CHANGES').length} change kind or strength`);
    const list = club === undefined ? cs : cs;
    for (const c of list.slice(0, club === undefined ? 60 : 40)) {
      console.log(`    ${c.what.padEnd(10)} ${String(abbr.get(c.row.club)).padEnd(4)} ${c.row.name.padEnd(24)} ${c.row.group.padEnd(16)} ${c.from.kind}/${c.from.strength} -> ${c.row.kind}/${c.row.strength}`);
    }
    if (list.length > (club === undefined ? 60 : 40)) console.log(`    ... ${list.length - (club === undefined ? 60 : 40)} more`);
  }
}
compare('3. THE LENS CHANGE ALONE (A -> B): each lens read against its own line, nothing else changed', ra, rb);
compare('4. EVERYTHING ELSE BUT THE LONG-MAN LINE (B -> C0): the save\'s role standards (measured under the starting line), aging curve and glove weights, where adopted', rb, rc0);

// floors
console.log(`\n${'='.repeat(78)}\n5. ROLE FLOORS: built-in against the save's (C); each lens's own line (B and C)\n${'='.repeat(78)}`);
const roleLines: Array<[string, (s: RoleStandardsSet) => ReturnType<RoleStandardsSet['starter']> | null]> = [
  ...Object.keys(HITTER_STANDARD_PRIOR).map((p) => [`pos${p}`, (s: RoleStandardsSet) => s.hitter(Number(p))] as [string, (s: RoleStandardsSet) => ReturnType<RoleStandardsSet['starter']> | null]),
  ['starter', (s: RoleStandardsSet) => s.starter()],
  ...Object.keys(RELIEVER_STANDARD_PRIOR).map((t) => [`rel:${t}`, (s: RoleStandardsSet) => s.reliever(t as never)] as [string, (s: RoleStandardsSet) => ReturnType<RoleStandardsSet['starter']> | null]),
];
console.log('  role               floor/deep built-in -> save      tools-lens line built-in -> own    results-lens line built-in -> own');
for (const [k, get] of roleLines) {
  const a = get(A.standards)!;
  const c = get(C.standards)!;
  console.log(`  ${k.padEnd(18)} ${a.floor.toFixed(0).padStart(3)}/${a.deepFloor.toFixed(0).padStart(3)} -> ${c.floor.toFixed(1).padStart(5)}/${c.deepFloor.toFixed(1).padStart(5)}      ${a.lensFloors.tools.toFixed(0).padStart(3)} -> ${c.lensFloors.tools.toFixed(1).padStart(5)}            ${a.lensFloors.results.toFixed(0).padStart(3)} -> ${c.lensFloors.results.toFixed(1).padStart(5)}`);
}

// aging explanations
// The stated size of the decline (the wording also changes, from the starting curve's "usually lose" to "this league's history")
const declineOf = (s: string) => (s.split(' | ').find((x) => /decline/.test(x)) ?? '').match(/about ([\d.]+)|no measurable decline/)?.[0] ?? null;
const changedText = [...rc0.entries()].filter(([k, r]) => declineOf(rb.get(k)?.explanations ?? '') !== declineOf(r.explanations) && declineOf(r.explanations) !== null);
console.log(`\n${'='.repeat(78)}\n6. AGE EXPLANATIONS whose stated decline changes (B -> C0): ${changedText.length} league-wide, ${changedText.filter(([, r]) => r.club === org).length} on your club\n${'='.repeat(78)}`);
for (const [k, r] of changedText.filter(([, r]) => r.club === org).slice(0, 10)) {
  const pick = (s: string) => s.split(' | ').find((x) => /decline/.test(x)) ?? '';
  console.log(`  ${r.name}: "${pick(rb.get(k)!.explanations)}"\n    -> "${pick(r.explanations)}"`);
}


// ── 7. the season weights and stabilization (cycle 2) ─────────────────────────
console.log(`\n${'='.repeat(78)}\n7. SEASON WEIGHTS AND STABILIZATION: the detector's verdict, and what the league's own values would have changed\n${'='.repeat(78)}`);
const rm = results?.model as ResultsModel | null;
if (!results || !rm) console.log('  not fitted');
else {
  console.log(`  verdict: ${results.record.gate.reason}`);
  console.log(`  rule: ${ruleText()}`);
  for (const part of ['hitter', 'starter', 'reliever', 'baserunning', 'defense'] as const) {
    const pf = rm.parts[part];
    const start = part === 'baserunning' || part === 'defense' ? `K ${RESULTS_PRIOR.stabilization[part]}` : `${RESULTS_PRIOR.weights[part].join('/')}, K ${RESULTS_PRIOR.stabilization[part]}`;
    console.log(`\n  ${part}: starting ${start}; the league's own ${pf.fitted ? `${pf.fitted.weights.join('/')}, K ${pf.fitted.k} (as it would serve ${pf.fittedServed?.weights.join('/')}, K ${pf.fittedServed?.k})` : '—'}; SERVES ${pf.source === 'save' ? "the league's own" : 'the starting values'}${pf.reason ? ` (${pf.reason})` : ''}`);
    const d = pf.decision;
    const rows: Array<[string, Comparison]> = d ? [['unshrunk', d.unshrunk], ['as served', d.served], ...(d.reverse ? [['starting vs own', d.reverse] as [string, Comparison]] : [])] : [];
    for (const [label, c] of rows) {
      console.log(`    ${label.padEnd(16)} held-out ${c.cases} player-seasons: ${describeComparison(c)}${c.failures.length ? `; not clearly better: ${c.failures.join(', ')}` : '; CLEARLY BETTER'}`);
    }
    const slope = results.record.heldOut.find((c) => c.kind === 'slope' && c.part === part);
    if (slope) console.log(`    reported: next season against the prediction, slope ${slope.observed?.toFixed(3)} (starting values ${slope.prior?.toFixed(3)}; 1 is exact, below 1 the record is trusted too much)`);
  }
  // Counterfactual: the league's own values (unshrunk) served, everything else as C
  const own = (p: 'hitter' | 'starter' | 'reliever') => rm.parts[p].fitted ?? { weights: [...RESULTS_PRIOR.weights[p]], k: RESULTS_PRIOR.stabilization[p] };
  const counter: ResultsParams = {
    weights: { hitter: own('hitter').weights, starter: own('starter').weights, reliever: own('reliever').weights },
    stabilization: { ...RESULTS_PRIOR.stabilization, hitter: own('hitter').k, starter: own('starter').k, reliever: own('reliever').k },
    stamp: RESULTS_PRIOR.stamp,
  };
  const rd = reviewAll(C, counter);
  compare(`7b. IF THE LEAGUE'S OWN SEASON WEIGHTS HAD SERVED (not served: shown so the rule's effect is visible): C -> C with them`, rc, rd);
}

// ── 8. the aging rule change (cycle 2) ──────────────────────────────────────────
console.log(`\n${'='.repeat(78)}\n8. THE AGING RULE CHANGE: cycle 1 served the league's own curve once its checks passed; now only where clearly better\n${'='.repeat(78)}`);
const am = aging?.model as AgingModel | null;
if (!aging || !am) console.log('  not fitted');
else {
  console.log(`  verdict: ${aging.record.gate.reason}`);
  for (const c of aging.record.heldOut.filter((x) => x.kind === 'detector')) console.log(`    ${c.part.padEnd(18)} n ${c.n}: ${c.note}`);
  // Cycle 1's behaviour: the league's fitted curve (as served) whenever its checks passed
  const cycle1: Yard = { standards: C.standards, review: { ...C.review, aging: am.fitted }, bullpen: C.bullpen };
  const re = reviewAll(cycle1, servedResults);
  compare("8b. CYCLE 1 (the league's own curve served) -> NOW (the curve the rule serves)", re, rc);
  const wording = (m: Map<string, Row>) => [...m.values()].filter((r) => /in this league's history/.test(r.explanations)).length;
  const usual = (m: Map<string, Row>) => [...m.values()].filter((r) => /his age usually/.test(r.explanations)).length;
  console.log(`\n  age explanations saying "in this league's history": ${wording(re)} -> ${wording(rc)}; saying "players his age usually ...": ${usual(re)} -> ${usual(rc)} (league-wide)`);
  const changed = [...rc.entries()].filter(([k, r]) => declineOf(re.get(k)?.explanations ?? '') !== declineOf(r.explanations) && declineOf(r.explanations) !== null);
  console.log(`  stated size of a decline changes in ${changed.length} explanations league-wide, ${changed.filter(([, r]) => r.club === org).length} on your club`);
  for (const [k, r] of changed.filter(([, r]) => r.club === org).slice(0, 5)) {
    const pick = (x: string) => x.split(' | ').find((y) => /decline/.test(y)) ?? '';
    console.log(`    ${r.name}: "${pick(re.get(k)!.explanations)}"\n      -> "${pick(r.explanations)}"`);
  }
}

// ── 9. the wOBA scale (cycle 2) ─────────────────────────────────────────────────
console.log(`\n${'='.repeat(78)}\n9. THE wOBA SCALE: derived per league-season (1.2 was fixed); wRC+ by level, park-neutral, players with 100+ PA\n${'='.repeat(78)}`);
// Form verdicts as the team form read draws them (server/form.ts: 100 PA to mean anything, 115 good, 90 fair)
const verdict = (x: number | null, pa: number) => (pa < 100 || x === null ? 'unknown' : x >= 115 ? 'good' : x >= 90 ? 'fair' : 'poor');
const orgTeams = new Set((db.prepare(`SELECT team_id FROM teams WHERE team_id = ? OR parent_team_id = ?`).all(org, org) as Array<{ team_id: number }>).map((r) => r.team_id));
const leagues = db.prepare(`SELECT DISTINCT t.league_id AS league, t.level AS level FROM teams t WHERE t.allstar_team = 0 AND t.league_id > 0 ORDER BY t.level, t.league_id`).all() as Array<{ league: number; level: number }>;
const year = (db.prepare(`SELECT season_year AS y FROM leagues WHERE league_id = ?`).get(league) as { y: number }).y;
let orgChanged = 0;
let orgVerdicts = 0;
for (const { league: lg, level } of leagues) {
  const base = leagueBaseline(lg, year, level);
  const fixed = { ...base, wobaScale: { value: WOBA_SCALE_FALLBACK, basis: 'fallback' as const, reason: 'the previous fixed value' } };
  const rows = db.prepare(`SELECT player_id, team_id, SUM(pa) pa, SUM(ab) ab, SUM(h) h, SUM(d) d, SUM(t) t3, SUM(hr) hr, SUM(bb) bb, SUM(ibb) ibb, SUM(hp) hp, SUM(sf) sf, SUM(k) k, SUM(sb) sb, SUM(cs) cs, SUM(r) r
    FROM players_career_batting_stats WHERE year = ? AND split_id = 1 AND league_id = ? AND level_id = ? GROUP BY player_id HAVING SUM(pa) >= 100`).all(year, lg, level) as Array<Record<string, number>>;
  if (rows.length === 0) continue;
  const shifts: number[] = [];
  let verdicts = 0;
  for (const r of rows) {
    const now = computeBatting(r, base, null).wrcPlus;
    const before = computeBatting(r, fixed, null).wrcPlus;
    if (now === null || before === null) continue;
    shifts.push(now - before);
    const changedVerdict = verdict(now, r.pa) !== verdict(before, r.pa);
    if (changedVerdict) verdicts += 1;
    if (orgTeams.has(r.team_id)) { if (Math.abs(now - before) >= 3) orgChanged += 1; if (changedVerdict) orgVerdicts += 1; }
  }
  const mean = shifts.reduce((a, x) => a + Math.abs(x), 0) / shifts.length;
  const max = Math.max(...shifts.map(Math.abs));
  const last = leagueBaseline(lg, year - 1, level).wobaScale;
  console.log(`  level ${level} league ${String(lg).padEnd(4)} scale ${year} ${base.wobaScale.value.toFixed(3)} (${base.wobaScale.basis}${base.wobaScale.reason ? `: ${base.wobaScale.reason}` : ''}), ${year - 1} ${last.value.toFixed(3)} (${last.basis}); ${rows.length} hitters: wRC+ moves ${mean.toFixed(1)} on average, at most ${max}; form verdict (good/fair/poor) changes for ${verdicts}`);
}
console.log(`\n  your organization's clubs (majors and affiliates): ${orgChanged} hitters' wRC+ moves by 3 or more; ${orgVerdicts} form verdicts change.`);
console.log('  Farm-facing displays that read wRC+: the roster and stats tables of an affiliate, the team form read (hot, fair, cold), league leaders and trade screens. Minor League Operations\' own results lens ranks wOBA within the league and does not read wRC+: it does not change.');


// ── 10. the long-man line (cycle 3) ─────────────────────────────────────────────
console.log(`\n${'='.repeat(78)}\n10. THE LONG-MAN LINE (C0 -> C): the standards measured under the league's own line and served with it, against both at the starting line\n${'='.repeat(78)}`);
const sb = stdModel?.bullpen;
console.log(`  line in force after this refit: ${linesServed.long} innings an appearance (${linesServed.source === 'save' ? "the league's own" : 'the starting value'}); measured ${sb?.measured?.toFixed(3) ?? '—'} on ${sb?.relievers ?? 0} relievers, as served ${sb?.asServed?.toFixed(3) ?? '—'}; checks: ${(std?.record.heldOut ?? []).filter((c) => c.part === 'long_line').map((c) => `${c.kind} ${c.observed === null ? 'not measured' : `${(c.observed * 100).toFixed(1)}%`} (aim ${((c.expected ?? 0) * 100).toFixed(0)}%) ${c.passed === null ? '' : c.passed ? 'pass' : 'FAIL'}`).join('; ')}`);
console.log(`  leverage lines: ${JSON.stringify(linesServed.leverage)}; the league's mean leverage ${linesServed.leagueLeverage?.toFixed(4) ?? '—'} (${linesServed.rescaled ? 'rescaled' : 'within the tolerance: as written'})`);
const relievers = (m: Map<string, Row>) => [...m.values()].filter((r) => r.group === 'relief pitcher');
const longs = (m: Map<string, Row>, club?: number) => relievers(m).filter((r) => r.tier === 'long' && (club === undefined || r.club === club)).length;
const flagsRel = (m: Map<string, Row>, club?: number) => relievers(m).filter((r) => isFlag(r.strength) && (club === undefined || r.club === club)).length;
const penOf = (label: string, club: number) => penKinds.get(label)?.get(club) ?? [];
const tiersOf = (m: Map<string, Row>) => relievers(m).reduce((acc, r) => ({ ...acc, [r.tier ?? 'none']: (acc[r.tier ?? 'none'] ?? 0) + 1 }), {} as Record<string, number>);
console.log(`\n  League-wide: relievers by role ${JSON.stringify(tiersOf(rc0))} -> ${JSON.stringify(tiersOf(rc))}`);
console.log(`  long men ${longs(rc0)} -> ${longs(rc)}; reliever flags (strong or moderate) ${flagsRel(rc0)} -> ${flagsRel(rc)}; all flags ${[...rc0.values()].filter((r) => isFlag(r.strength)).length} -> ${[...rc.values()].filter((r) => isFlag(r.strength)).length}`);
const kinds = (label: string) => teams.flatMap((t) => penOf(label, t.team_id)).reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {} as Record<string, number>);
console.log(`  pen-wide findings ${JSON.stringify(kinds('C0'))} -> ${JSON.stringify(kinds('C'))}`);
console.log('\n  Per club: long men, reliever flags, "crowded: long men", "nobody throws multiple innings" (starting line -> league\'s own)');
for (const t of teams) {
  if (!relievers(rc).some((r) => r.club === t.team_id)) continue; // an all-star side, or a club with no pen reviewed
  const c0 = penOf('C0', t.team_id);
  const c = penOf('C', t.team_id);
  const same = longs(rc0, t.team_id) === longs(rc, t.team_id) && flagsRel(rc0, t.team_id) === flagsRel(rc, t.team_id) && c0.join() === c.join();
  console.log(`    ${(t.team_id === org ? '*' : ' ')}${String(t.abbr).padEnd(4)} long men ${longs(rc0, t.team_id)} -> ${longs(rc, t.team_id)}; flags ${flagsRel(rc0, t.team_id)} -> ${flagsRel(rc, t.team_id)}; crowded ${c0.includes('crowded:long') ? 'yes' : 'no'} -> ${c.includes('crowded:long') ? 'yes' : 'no'}; multi-inning gap ${c0.includes('no_multi_inning') ? 'yes' : 'no'} -> ${c.includes('no_multi_inning') ? 'yes' : 'no'}${same ? '' : '   (changes)'}`);
}
compare('10b. THE LONG-MAN LINE: findings that change (C0 -> C)', rc0, rc);
const moved = relievers(rc).filter((r) => rc0.get(`${r.club}:${r.group}:${r.playerId}`)?.tier !== r.tier);
console.log(`\n  Relievers whose role moves (${moved.length}):`);
for (const r of moved) console.log(`    ${(r.club === org ? '*' : ' ')}${String(abbr.get(r.club)).padEnd(4)} ${r.name.padEnd(24)} ${rc0.get(`${r.club}:${r.group}:${r.playerId}`)?.tier} -> ${r.tier}`);
console.log(`\n  Your organization (${abbr.get(org as number) ?? org}): long men ${longs(rc0, org as number)} -> ${longs(rc, org as number)}; pen findings ${JSON.stringify(penOf('C0', org as number))} -> ${JSON.stringify(penOf('C', org as number))}`);

// ── 11. the platoon weight (cycle 3) ────────────────────────────────────────────
console.log(`\n${'='.repeat(78)}\n11. HOW MUCH A HITTER'S OWN SPLIT COUNTS: the verdict, and what it moves\n${'='.repeat(78)}`);
const pl = run<PlatoonModel>('platoon');
const pm = pl?.model as PlatoonModel | null;
if (!pl) console.log('  not fitted');
else {
  console.log(`  verdict: ${pl.record.gate.reason}`);
  console.log(`  starting K ${PLATOON_PRIOR.shrinkAroundLeague}; the league's own ${pm?.fitted ?? '—'} (as it would serve ${pm?.fittedServed ?? '—'}); SERVES ${pm?.source === 'save' ? "the league's own" : 'the starting value'}${pm?.reason ? ` (${pm.reason})` : ''}`);
  for (const c of pl.record.heldOut) console.log(`    ${c.part.padEnd(36)} n ${c.n}: ${c.note ?? ''}`);
  // What the league's own K would move, had it served: every lineup regular's platoon read (it applies only where his ratings are hidden)
  const own = { ...PLATOON_PRIOR, shrinkAroundLeague: pm?.fitted ?? PLATOON_PRIOR.shrinkAroundLeague, source: 'save' as const };
  let regulars = 0;
  let aroundLeague = 0;
  const changes: string[] = [];
  for (const t of teams) {
    const ports = reviewPorts(t.team_id, { results: servedResults });
    let groups: RoleGroupReview[];
    try { groups = reviewClub(loadClubView(t.team_id), ports); } catch { continue; }
    const lineup = groups.find((g) => g.role === 'lineup regular');
    if (!lineup || !ports.platoon) continue;
    const inputs = ports.platoon(lineup.holders.map((h) => h.playerId));
    for (const h of lineup.holders) {
      const input = inputs.get(h.playerId);
      if (!input) continue;
      regulars += 1;
      const a = evaluatePlatoon(input);
      const b = evaluatePlatoon({ ...input, platoon: own });
      if (a.basis === 'splits') aroundLeague += 1;
      if (a.verdict !== b.verdict) changes.push(`${abbr.get(t.team_id)} ${h.name}: ${a.verdict} -> ${b.verdict}`);
    }
  }
  console.log(`\n  ${regulars} lineup regulars; ${aroundLeague} read around the league norm alone (his platoon ratings not visible), where the league's own K would apply`);
  console.log(`  platoon verdicts that would change had the league's own K served: ${changes.length}${changes.length ? `: ${changes.join('; ')}` : ''}`);
}
