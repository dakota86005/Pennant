/**
 * Player Value on a real import: the league-wide control timeline, timed, and every indeterminate
 * counted with its reason (docs/PLAYER_VALUE.md Part 7 and Part 9, phase 1); Club Finances, the
 * opening price of a win with every basis, and the replacement level per season, timed (phase 2);
 * expected production (phase 3a): the league-wide pass timed with and without it, counts by status,
 * the median band width per horizon season, and four example players. Read-only.
 *
 *   OOTP_FO_DATA_DIR=<dir containing league.db> OOTP_FO_DB_READONLY=1 npm run value:report
 *
 * With OOTP_FO_VALUE_SNAPSHOT=1 it also runs the per-import market snapshot twice (the second must
 * write nothing). That writes to history.db in OOTP_FO_DATA_DIR, so point the directory at a scratch
 * copy of history.db beside a link to the real league.db, never at a live data directory.
 *
 * `OOTP_FO_DB_READONLY=1` opens the import read-only, so the report can run against the league a
 * running app is using without changing it. It writes nothing, ranks nobody and changes no
 * behaviour: a person reads the output and decides (the cache choice in Part 7 rests on it).
 */

import { performance } from 'node:perf_hooks';
import { db, tableExists } from '../server/db.js';
import {
  clubFinances, leagueFinances, leaguePlayerValues, marketLeagueOfClub, marketLeagues, playerValues, productionCalibration, productionTotal,
  type PlayerValuation,
} from '../server/playerValue.js';
import { allLeagueRules } from '../server/leagueRules.js';
import { superTwoCutoffs } from '../server/playerRights.js';
import { seasonServiceClocks, serviceClassMembers } from '../server/playerState.js';

if (!tableExists('players') || !tableExists('players_contract')) {
  throw new Error('No league imported: point OOTP_FO_DATA_DIR at a directory with league.db.');
}

const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
const RUNS = 3;

console.log('Rows read');
console.log(`  active players          ${count('SELECT COUNT(*) AS n FROM players WHERE retired = 0')}`);
console.log(`  contracts               ${count('SELECT COUNT(*) AS n FROM players_contract')}`);
if (tableExists('players_contract_extension')) {
  console.log(`  extensions with terms   ${count('SELECT COUNT(*) AS n FROM players_contract_extension WHERE years > 0')}`);
}
console.log(`  leagues                 ${count('SELECT COUNT(*) AS n FROM leagues')}`);

let values = new Map<number, PlayerValuation>();
const times: number[] = [];
for (let i = 0; i < RUNS; i += 1) {
  const start = performance.now();
  values = leaguePlayerValues();
  times.push(performance.now() - start);
}
const seasons = [...values.values()].reduce((n, v) => n + v.control.seasons.length, 0);
console.log(`\nLeague-wide compute (contract facts + control timeline), ${RUNS} runs`);
console.log(`  players valued          ${values.size}`);
console.log(`  timeline seasons        ${seasons}`);
console.log(`  time                    ${times.map((t) => `${Math.round(t)} ms`).join(', ')} (first run includes statement preparation)`);

const tally = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
const print = (title: string, m: Map<string, number>, limit = 20) => {
  console.log(`\n${title}`);
  for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) console.log(`  ${String(n).padStart(6)}  ${k}`);
};

const standing = new Map<string, number>();
const contractStanding = new Map<string, number>();
const next = new Map<string, number>();
const every = new Map<string, number>();
const between = new Map<string, number>();
const reasons = new Map<string, number>();
const anyIndeterminate = new Map<string, number>();
const nextReasons = new Map<string, number>();
let viaParent = 0;

/** A reason, with its numbers taken out so the same cause counts once. */
const category = (text: string): string => {
  if (/In the Super Two window/.test(text)) return 'Super Two: his projected service overlaps the projected cutoff';
  if (/Super Two/.test(text)) return 'Super Two window: ' + text.replace(/\d+/g, '#').slice(0, 110);
  if (/free-agency line .* falls inside the projection/.test(text)) return 'projection straddles the free-agency line';
  if (/arbitration line .* falls inside the projection/.test(text)) return 'projection straddles the arbitration line';
  if (/minor-league contract/.test(text)) return 'after a minor-league contract: what follows is not established';
  if (/rule is not available|service-year length/.test(text)) return 'a league rule is not exported';
  if (/service time is not available/.test(text)) return 'service time not exported';
  if (/not in the export|no contract row/i.test(text)) return 'no contract row';
  if (/older than the save/.test(text)) return 'export behind the save';
  return text.replace(/\d+/g, '#');
};

for (const v of values.values()) {
  const t = v.control;
  tally(standing, t.standing);
  tally(contractStanding, `${v.contract.standing} / ${v.contract.kind.value ?? 'kind unknown'}`);
  if (t.eligibility?.regime.note?.includes('parent league')) viaParent += 1;
  if (t.standing !== 'held' || t.thisSeason === null) continue;
  const n = t.seasons.find((s) => s.season === t.thisSeason! + 1);
  tally(next, n ? n.status : '(timeline ends this season)');
  if (n?.status === 'indeterminate') tally(nextReasons, category(n.reasons[0] ?? n.basis));
  const seen = new Set<string>();
  for (const s of t.seasons) {
    tally(every, s.status);
    if (s.status !== 'indeterminate') continue;
    tally(between, s.between.length > 0 ? s.between.join(' | ') : '(unbounded)');
    const why = category(s.reasons[0] ?? s.basis);
    tally(reasons, why);
    seen.add(why);
  }
  for (const why of seen) tally(anyIndeterminate, why);
}

print('Timeline standing (players)', standing);
print('Contract standing / kind (players)', contractStanding);
console.log(`\n  regime read through a parent league: ${viaParent} players`);
print('Next season, by status (held players)', next);
print('Next season indeterminate, by reason', nextReasons);
print('Every timeline season, by status', every);
print('Indeterminate seasons, by what they lie between', between);
print('Indeterminate seasons, by reason', reasons);
print('Players with at least one indeterminate season, by reason', anyIndeterminate);

/* ── Super Two (owner ruling, 2026-09-22) ─────────────────────────────────────────────────────── */

const rules = allLeagueRules();
const cutoffs = superTwoCutoffs(serviceClassMembers(), (id) => rules.get(id)?.contract ?? null, seasonServiceClocks());
const spoken = (d: number) => `${Math.floor(d / 172)}.${String(Math.round(d % 172)).padStart(3, '0')}`;
console.log('\nSuper Two cutoff at the end of this season, per contract regime');
for (const [regime, c] of cutoffs) {
  console.log(`  league ${regime}: applies ${c.applies}` + (c.cutoff
    ? `; cutoff ${c.cutoff.low}-${c.cutoff.high} days (${spoken(c.cutoff.low)}-${spoken(c.cutoff.high)} in years.days); class ${c.classSize!.low}-${c.classSize!.high}; qualifiers ${c.qualifiers!.low}-${c.qualifiers!.high}`
    : `; ${c.missing.map((m) => m.message).join(' ')}`));
}

// Everyone whose service entering next season can fall in the year before the arbitration line
const window = new Map<string, number>();
const windowMajor = new Map<string, number>();
const near: string[] = [];
for (const v of values.values()) {
  const t = v.control;
  const e = t.eligibility?.seasons.find((x) => x.season === (t.thisSeason ?? 0) + 1);
  if (!e || !e.serviceDays || t.standing !== 'held') continue;
  if (!(e.serviceDays.low < 3 * 172 && e.serviceDays.high >= 2 * 172)) continue;
  const why = e.arbitration.status === 'indeterminate'
    ? `indeterminate: ${category(e.arbitration.missing[0]?.message ?? '')}`
    : `${e.arbitration.status}: ${e.arbitration.reasons[0]?.code ?? ''}`;
  tally(window, why);
  if (v.contract.kind.value === 'major_league' && v.contract.standing === 'signed') tally(windowMajor, why);
  const c = cutoffs.values().next().value?.cutoff;
  if (c && e.serviceDays.high >= c.low - 15 && e.serviceDays.low <= c.high + 15) {
    const name = (db.prepare('SELECT first_name || \' \' || last_name AS n FROM players WHERE player_id = ?').get(v.playerId) as { n: string }).n;
    near.push(`${name} (${v.playerId}): service ${e.serviceDays.low}-${e.serviceDays.high}, arbitration ${e.arbitration.status}, next season ${t.seasons.find((x) => x.season === e.season)?.status}`);
  }
}
print('Players whose service entering next season can fall in the Super Two window, by answer', window);
print('...of them, on a signed major-league deal', windowMajor);
console.log('\nNear the cutoff (within 15 days of its range)');
for (const line of near.slice(0, 25)) console.log(`  ${line}`);
const check = values.get(38389);
if (check) {
  const e = check.control.eligibility?.seasons.find((x) => x.season === (check.control.thisSeason ?? 0) + 1);
  console.log(`\nCheck: player 38389 service now ${JSON.stringify(check.control.eligibility?.service.now)}, next winter ${JSON.stringify(e?.serviceDays)}, ` +
    `arbitration ${e?.arbitration.status}: ${[...(e?.arbitration.reasons ?? []).map((r) => r.message), ...(e?.arbitration.missing ?? []).map((m) => m.message)].join(' ')}`);
}

/* ── Club Finances and the opening price of a win (phase 2) ──────────────────────────────────── */

const m = (v: number | null | undefined): string => (v === null || v === undefined ? 'unknown' : `$${(v / 1_000_000).toFixed(2)}M`);
const shown = (s: { value: unknown; source: string | null; note?: string; meaning?: string }): string =>
  `${s.value === null ? 'unknown' : typeof s.value === 'number' && Math.abs(s.value) >= 10_000 ? m(s.value) : String(s.value)}` +
  `${s.meaning ? ' (meaning unknown)' : ''}  [${s.source ?? '-'}]${s.value === null && s.note ? ` ${s.note}` : ''}`;

const human = (db.prepare('SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1').get() as { team_id: number } | undefined)?.team_id ?? null;
const marketId = human !== null ? marketLeagueOfClub(human) : marketLeagues()[0] ?? null;
if (marketId === null) throw new Error('No market league in the export.');

// A cold first pass (statement preparation included), then timed passes
const coldStart = performance.now();
let league = leagueFinances(marketId);
const cold = performance.now() - coldStart;
const financeTimes: number[] = [];
for (let i = 0; i < RUNS; i += 1) {
  const start = performance.now();
  league = leagueFinances(marketId);
  if (human !== null) clubFinances(human);
  financeTimes.push(performance.now() - start);
}
const clubTimes: number[] = [];
for (let i = 0; i < RUNS; i += 1) {
  const start = performance.now();
  if (human !== null) clubFinances(human);
  clubTimes.push(performance.now() - start);
}

console.log(`\nClub Finances and the market (league ${marketId}): one cold pass, then ${RUNS} runs`);
console.log(`  cold leagueFinances            ${Math.round(cold)} ms`);
console.log(`  leagueFinances + clubFinances  ${financeTimes.map((t) => `${Math.round(t)} ms`).join(', ')}`);
console.log(`  clubFinances alone             ${clubTimes.map((t) => `${Math.round(t)} ms`).join(', ')}`);

const r = league.regime;
console.log('\nLeague regime (as exported, through the parent chain)');
for (const [k, v] of Object.entries(r)) {
  if (Array.isArray(v)) console.log(`  ${k.padEnd(30)} ${v.map((x) => x.value ?? 'unknown').join(', ')} (meaning unknown)`);
  else console.log(`  ${k.padEnd(30)} ${shown(v as never)}`);
}
console.log(`  gamesPerTeam                   ${shown(league.gamesPerTeam as never)}`);
console.log(`  season played                  ${league.seasonPlayed.value === null ? 'unknown' : `${(league.seasonPlayed.value * 100).toFixed(2)}%`} ${league.seasonPlayed.note ?? ''}`);
console.log(`  league payroll                 ${m(league.leaguePayroll.value)} ${league.leaguePayroll.note ?? ''}`);

const p = league.priceOfWin;
console.log(`\nPrice of a win — ${p.label} (${p.unit})`);
console.log(`  population ${JSON.stringify(p.population)}`);
for (const b of p.bases) {
  console.log(`  ${b.id.padEnd(3)} ${b.role.padEnd(6)} ${String(b.players).padStart(4)} players  ${m(b.salaryAboveMinimum).padStart(10)} above min  ` +
    `${b.wins === null ? 'unknown'.padStart(8) : b.wins.toFixed(1).padStart(8)} WAR  → ${b.perWin.value === null ? `unknown: ${b.perWin.note}` : m(b.perWin.value)}   ${b.description}` +
    `${b.excluded > 0 ? ` (${b.excluded} left out)` : ''}`);
}
console.log(`  PRICE  ${p.price.value ? `central ${m(p.price.value.central)}, band ${m(p.price.value.low)}–${m(p.price.value.high)}` : `unknown: ${p.price.note}`}`);
console.log(`  FLOOR  ${p.floor.value ? `${m(p.floor.value.low)}–${m(p.floor.value.high)}` : `unknown: ${p.floor.note}`}`);

// Phase 4a: the cost ladder measured on this import
const costs = league.costs;
console.log(`\nThe cost of controlled seasons (phase 4a; minimum ${m(costs.minimum.value)})`);
console.log(`  renewal spread   ${costs.preArbitration.status}: ${costs.preArbitration.text}`);
console.log(`  arbitration      ${costs.arbitration.status}${costs.arbitration.reason ? `: ${costs.arbitration.reason}` : ''} — platform: ${costs.arbitration.platform}`);
for (const c of costs.arbitration.classes) {
  console.log(`    ${c.text}${c.ratioShare !== null ? ` (R-6's statistic: ${(c.ratioShare * 100).toFixed(1)}% of the price per positive platform win)` : ''}`);
}

console.log('\nReplacement level, per season (the level the export\'s WAR implies)');
for (const x of league.replacementLevel) {
  console.log(`  ${x.season}${x.toDate ? ' (to date)' : ''}: ${x.level.value === null ? `unknown — ${x.level.note}` : `${x.level.value.toFixed(4)} — ${x.level.note}`} [${x.stamp.status}]`);
}

/*
 * R-5's reading, for comparison only: it took free-agency service to include this season's days.
 * Player Value takes Player Rights' answer for this season (service at the last winter). Counted here
 * from the export so the difference between the two is stated exactly, not tuned away.
 */
if (league.season.value !== null) {
  const s = league.season.value;
  const rows = db.prepare(
    `SELECT c.player_id, rs.mlb_service_days AS now, rs.mlb_service_days - rs.mlb_service_days_this_year AS winter,
            l.rules_fa_minimum_years * l.rules_min_service_days AS line
     FROM players_contract c JOIN players p ON p.player_id = c.player_id
     JOIN players_roster_status rs ON rs.player_id = c.player_id
     JOIN teams t ON t.team_id = p.team_id JOIN leagues l ON l.league_id = t.league_id
     WHERE p.retired = 0 AND c.is_major = 1 AND t.league_id = ? AND (rs.is_active = 1 OR rs.is_on_dl = 1 OR rs.is_on_dl60 = 1)`
  ).all(marketId) as Array<{ player_id: number; now: number; winter: number; line: number }>;
  const crossed = rows.filter((x) => x.now >= x.line && x.winter < x.line);
  console.log(`\nR-5's reading (service including ${s}'s days) against Player Rights' (service at the last winter)`);
  console.log(`  FA-eligible by R-5's reading: ${rows.filter((x) => x.now >= x.line).length}; by Player Rights this season: ${p.population.market}`);
  console.log(`  crossed the line during ${s} (salary set before they were eligible): ${crossed.length}`);
}

if (human !== null) {
  const c = clubFinances(human);
  console.log(`\nClub Finances, club ${human}`);
  console.log(`  rule: ${c.authority.rule}`);
  for (const [k, v] of Object.entries({
    budget: c.budget, payrollNow: c.payroll.now, payrollNext: c.payroll.nextSeason, payrollOffered: c.payroll.offered,
    revenue: c.revenue, expenses: c.expenses, market: c.market, fanInterest: c.fans.interest, fanLoyalty: c.fans.loyalty,
    cashForTrades: c.cashForTrades, ownerExpectation: c.ownerExpectation, mode: c.mode,
    localMedia: c.media.local, localMediaExpires: c.media.localExpires, nationalMedia: c.media.national,
    revenueSharing: c.sharing.revenueSharing, luxurySharing: c.sharing.luxurySharing,
  })) console.log(`  ${k.padEnd(18)} ${shown(v as never)}`);
  if (c.lastSeason) {
    console.log(`  last season ${c.lastSeason.season}: revenue ${shown(c.lastSeason.revenue as never)}; expenses ${m(c.lastSeason.expenses.value)}`);
    console.log(`    ${c.lastSeason.unnamedView.note}`);
  }
  console.log(`  revenue trend: ${c.revenueTrend.seasons.map((x) => `${x.season} ${m(x.revenue.value)}`).join(', ') || 'none'}`);
  console.log(`  ${c.revenueTrend.placeholderSeasons.note} (${c.revenueTrend.placeholderSeasons.first}–${c.revenueTrend.placeholderSeasons.last})`);
  const placeholders = (db.prepare(
    `SELECT COUNT(*) AS n FROM team_history_financials WHERE total_revenue = 0 AND budget = 0 AND total_expenses = 0`
  ).get() as { n: number }).n;
  console.log(`  league-wide zeroed history rows (revenue, budget and expenses all 0): ${placeholders}`);
}

/*
 * The snapshot writer, only when asked (OOTP_FO_VALUE_SNAPSHOT=1) and only against a data directory
 * whose history.db is a scratch copy: importing it creates its table in DATA_DIR's history.db.
 */
if (process.env.OOTP_FO_VALUE_SNAPSHOT === '1') {
  const { captureMarketSnapshot, marketSnapshotHistory } = await import('../server/playerValueSnapshot.js');
  const first = captureMarketSnapshot({ importFinishedAt: 'value:report' });
  const second = captureMarketSnapshot({ importFinishedAt: 'value:report' });
  console.log('\nMarket snapshot (history.db in OOTP_FO_DATA_DIR)');
  console.log(`  first call:  ${JSON.stringify(first)}`);
  console.log(`  second call: ${JSON.stringify(second)}`);
  const history = marketSnapshotHistory(marketId);
  console.log(`  history rows for league ${marketId}: ${history.length}`);
  for (const h of history) {
    console.log(`    ${h.gameDate} (${h.gameDateExported}) ${h.priceLabel}: ${h.price ? `${m(h.price.central)} [${m(h.price.low)}–${m(h.price.high)}]` : 'unknown'}, floor ${h.floor ? `${m(h.floor.low)}–${m(h.floor.high)}` : 'unknown'}, market contracts ${h.marketContracts}, payroll ${m(h.leaguePayroll)}`);
  }
}

/* ── Expected production (phases 3a and 3b; PLAYER_VALUE.md Parts 2.3 and 7, D-053) ─────────────── */

{
  const w = (b: { low: number; high: number }) => b.high - b.low;
  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const band = (b: { low: number; central: number; high: number }) => `${b.central.toFixed(1)} [${b.low.toFixed(1)}, ${b.high.toFixed(1)}]`;

  // Timing: the league-wide pass with production, and without it, and a club-sized request
  const withTimes: number[] = [];
  const withoutTimes: number[] = [];
  let all = new Map<number, PlayerValuation>();
  for (let i = 0; i < RUNS; i += 1) {
    let start = performance.now();
    all = leaguePlayerValues();
    withTimes.push(performance.now() - start);
    start = performance.now();
    leaguePlayerValues({ production: false });
    withoutTimes.push(performance.now() - start);
  }
  const clubIds = human === null ? [] : (db.prepare('SELECT player_id FROM players WHERE organization_id = ? AND retired = 0').all(human) as Array<{ player_id: number }>).map((r) => r.player_id);
  const clubTimes: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    playerValues(clubIds);
    clubTimes.push(performance.now() - start);
  }
  console.log(`\nExpected production (phases 3a and 3b), ${RUNS} runs`);
  console.log(`  league-wide, contract + control + production   ${withTimes.map((t) => `${Math.round(t)} ms`).join(', ')}`);
  console.log(`  league-wide, contract + control only           ${withoutTimes.map((t) => `${Math.round(t)} ms`).join(', ')}`);
  console.log(`  one organization (${clubIds.length} players), everything     ${clubTimes.map((t) => `${Math.round(t)} ms`).join(', ')}`);

  const cal = productionCalibration(marketId);
  console.log(`\n  model in force: ${cal.inForce.source} — ${cal.inForce.label}`);
  console.log(`  stamp: ${cal.inForce.stamp.status}; ${cal.inForce.stamp.run ?? cal.inForce.stamp.basis}`);
  for (const o of cal.observed) {
    console.log(`  horizon ${o.horizon}: 80% target · ${o.outer.observed === null ? 'not measured' : `${(o.outer.observed * 100).toFixed(1)}% observed`}; 50% target · ${o.inner.observed === null ? 'not measured' : `${(o.inner.observed * 100).toFixed(1)}% observed`} (${o.cases} held-out cases)`);
  }
  if (cal.latestAttempt) console.log(`  latest fit attempt: through ${cal.latestAttempt.throughSeason}, adopted ${cal.latestAttempt.adopted}: ${cal.latestAttempt.reason}`);
  console.log(`  ratings model in force (phase 3b): ${cal.ratings.source} — ${cal.ratings.label}`);
  console.log(`  stamp: ${cal.ratings.stamp.status}; ${cal.ratings.stamp.run ?? ''} ${cal.ratings.stamp.basis}`);

  // Counts by status, and why the unknowns are unknown
  const reasonOf = (r: string | null) => (r === null ? '' : r.replace(/\d+/g, '#').replace(/\(missing[^)]*\)|\([^)]*tools missing\)/g, '(…)').slice(0, 160));
  const statuses = new Map<string, number>();
  const rosteredStatuses = new Map<string, number>();
  // On a major-league club's active roster or injured list
  const rostered = new Set((db.prepare(
    `SELECT rs.player_id FROM players_roster_status rs JOIN players p ON p.player_id = rs.player_id JOIN teams t ON t.team_id = p.team_id
     WHERE t.level = 1 AND (rs.is_active = 1 OR rs.is_on_dl = 1 OR rs.is_on_dl60 = 1)`
  ).all() as Array<{ player_id: number }>).map((r) => r.player_id));
  for (const v of all.values()) {
    const key = v.production.status === 'projected' ? `projected from ${v.production.basis.source ?? 'results'}` : `unknown: ${reasonOf(v.production.reason)}`;
    tally(statuses, key);
    if (rostered.has(v.playerId)) tally(rosteredStatuses, key);
  }
  print('Production status, every active player', statuses);
  print('Production status, major-league active and injured lists', rosteredStatuses);

  // Median band width per season of the horizon (80% and 50%)
  const projected = [...all.values()].filter((v) => v.production.status === 'projected');
  // Per season of the horizon, over the players whose season is established; a season not established (hardening F6:
  // the arrival model adopted horizon by horizon) is counted apart, never read as zero
  const horizonSeasons = (pop: PlayerValuation[]): number[] =>
    [...new Set(pop.flatMap((v) => [...v.production.seasons, ...v.production.notEstablished].map((s) => s.season)))].sort((a, b) => a - b);
  const widths = (pop: PlayerValuation[]) => horizonSeasons(pop).map((season) => {
    const here = pop.map((v) => v.production.seasons.find((s) => s.season === season)).filter((s): s is NonNullable<typeof s> => s !== undefined);
    return {
      season,
      players: here.length,
      notEstablished: pop.filter((v) => v.production.notEstablished.some((s) => s.season === season)).length,
      outer: median(here.map((s) => w(s.wins))),
      inner: median(here.map((s) => w(s.inner))),
      central: median(here.map((s) => s.wins.central)),
    };
  });
  for (const [title, pop] of [['every projected player', projected], ['projected, on a major-league list', projected.filter((v) => rostered.has(v.playerId))]] as Array<[string, PlayerValuation[]]>) {
    console.log(`\nMedian band width, wins (${title}, ${pop.length} players): season (horizon) — 80% / 50% width, median central, over the players whose season is established`);
    widths(pop).forEach((x, i) => console.log(`  ${x.season} (${i + 1}${i === 0 ? ', the rest of it plus what is banked' : ''})   ${x.outer?.toFixed(2)} / ${x.inner?.toFixed(2)}   central ${x.central?.toFixed(2)}   (${x.players} established${x.notEstablished > 0 ? `, ${x.notEstablished} not established` : ''})`));
  }

  // Prospects (projected from ratings alone): per season, the summed central over those whose season is established and
  // how many are not established; per player, a total over the horizon is a number only where every season is (F6)
  const prospects = projected.filter((v) => v.production.basis.source === 'ratings');
  if (prospects.length > 0) {
    console.log(`\nProspects projected from ratings (${prospects.length}): season — summed central (established), not established`);
    for (const x of horizonSeasons(prospects)) {
      const here = prospects.map((v) => v.production.seasons.find((s) => s.season === x)).filter((s): s is NonNullable<typeof s> => s !== undefined);
      const missing = prospects.filter((v) => v.production.notEstablished.some((s) => s.season === x)).length;
      console.log(`  ${x}   ${here.length > 0 ? here.reduce((t, s) => t + s.wins.central, 0).toFixed(1) : '—'} over ${here.length}   ${missing > 0 ? `${missing} not established` : ''}`);
    }
    const seasonsOf = horizonSeasons(prospects);
    const totals = prospects.map((v) => productionTotal(v.production, seasonsOf[0], seasonsOf[seasonsOf.length - 1]));
    const known = totals.filter((t) => t.status === 'known').length;
    console.log(`  a total over ${seasonsOf[0]}–${seasonsOf[seasonsOf.length - 1]}: a number for ${known}, not a number for ${totals.length - known} (a season not established)`);
    const adopted = prospects.find((v) => v.production.notEstablished.length > 0);
    if (adopted) console.log(`  e.g. ${adopted.production.notEstablished[0].reason}`);
  }

  // Examples: a star, an average regular, an aging veteran, a reliever (chosen by the numbers, for a sanity check)
  const name = (id: number) => (db.prepare(`SELECT first_name || ' ' || last_name AS n FROM players WHERE player_id = ?`).get(id) as { n: string }).n;
  const onList = projected.filter((v) => rostered.has(v.playerId));
  const hitters = onList.filter((v) => v.production.basis.sides[0]?.kind === 'hitter');
  const byNext = (v: PlayerValuation) => v.production.seasons[1].wins.central;
  const star = [...hitters].sort((a, b) => byNext(b) - byNext(a))[0];
  const regulars = hitters.filter((v) => v.production.basis.sides[0].usagePerSeason[0] >= 450).sort((a, b) => byNext(a) - byNext(b));
  const regular = regulars[Math.floor(regulars.length / 2)];
  const veteran = [...onList].filter((v) => (v.production.basis.sides[0]?.opportunities ?? 0) >= 800)
    .sort((a, b) => (b.production.basis.origin.age ?? 0) - (a.production.basis.origin.age ?? 0))[0];
  const relievers = onList.filter((v) => v.production.basis.sides[0]?.kind === 'reliever').sort((a, b) => byNext(b) - byNext(a));
  const reliever = relievers[Math.floor(relievers.length / 10)];
  console.log('\nExamples (80% band, then 50%; wins in the export\'s WAR units)');
  for (const [label, v] of [['star', star], ['average regular', regular], ['aging veteran', veteran], ['reliever (90th percentile of relievers)', reliever]] as Array<[string, PlayerValuation | undefined]>) {
    if (!v) continue;
    const p = v.production;
    const side = p.basis.sides[0];
    console.log(`  ${label}: ${name(v.playerId)} (${v.playerId}), age ${p.basis.origin.age}, ${side.kind}; window ${side.seasons.map((s) => `${s.season} ${s.opportunities}/${s.war.toFixed(1)}`).join(', ')}; ` +
      `rate ${side.observedRate?.toFixed(2)} → regressed ${side.regressedRate.toFixed(2)} per 600 (${(side.regressionShare * 100).toFixed(0)}% mean); proneness ${p.basis.proneness.value ?? 'unknown'}`);
    for (const s of [p.seasons[0], p.seasons[1], p.seasons[4]].filter((x): x is NonNullable<typeof x> => x !== undefined)) {
      console.log(`    ${s.season}: ${band(s.wins)}  50% ${band(s.inner)}${s.toDate !== null ? `  (banked ${s.toDate.toFixed(1)}, rest ${band(s.remaining!)})` : ''}; rate ${s.sides[0].rateBand.central.toFixed(2)} [${s.sides[0].rateBand.low.toFixed(2)}, ${s.sides[0].rateBand.high.toFixed(2)}]/600; usage ${Math.round(s.sides[0].usage.central)} [${Math.round(s.sides[0].usage.low)}–${Math.round(s.sides[0].usage.high)}], age adj ${s.sides[0].aging.toFixed(2)}/600${s.notes.length ? `; ${s.notes.join(' ')}` : ''}`);
    }
  }
}
