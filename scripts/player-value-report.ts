/**
 * Player Value on a real import: the league-wide control timeline, timed, and every indeterminate
 * counted with its reason (docs/PLAYER_VALUE.md Part 7 and Part 9, phase 1). Read-only.
 *
 *   OOTP_FO_DATA_DIR=<dir containing league.db> OOTP_FO_DB_READONLY=1 npm run value:report
 *
 * `OOTP_FO_DB_READONLY=1` opens the import read-only, so the report can run against the league a
 * running app is using without changing it. It writes nothing, ranks nobody and changes no
 * behaviour: a person reads the output and decides (the cache choice in Part 7 rests on it).
 */

import { performance } from 'node:perf_hooks';
import { db, tableExists } from '../server/db.js';
import { leaguePlayerValues, type PlayerValuation } from '../server/playerValue.js';

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
  if (/Super Two/.test(text)) return 'Super Two window (the year before the arbitration line): whether OOTP grants it is not established';
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
