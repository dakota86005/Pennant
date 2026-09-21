/**
 * How often Minor League Operations raises something, on a real import. Read-only.
 *
 * The check the MLB hardening phase called the base rate: could a healthy organization be flagged,
 * and does anything ever get flagged at all? Both failures matter, and a threshold change should be
 * followed by a re-run (docs/MINOR_LEAGUE_OPERATIONS.md §5).
 *
 *   OOTP_FO_DATA_DIR=<dir containing league.db> npm run farm:base-rate [orgId]
 *
 * It writes nothing and changes no behaviour: a person reads the output and decides.
 */

import { computeFarmSystem } from '../server/farmOperations.js';
import { db, tableExists } from '../server/db.js';

const orgId = Number(process.argv[2] ?? 0) || humanOrg();

function humanOrg(): number {
  if (!tableExists('teams')) throw new Error('No league imported: point OOTP_FO_DATA_DIR at a directory with league.db.');
  const row = db.prepare('SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1').get() as { team_id: number } | undefined;
  if (!row) throw new Error('No human-managed organization in this import; pass an organization id.');
  return Number(row.team_id);
}

const view = computeFarmSystem(orgId);
const { scope } = view.organization;

const count = <T, K extends string>(rows: readonly T[], key: (row: T) => K): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const row of rows) out[key(row)] = (out[key(row)] ?? 0) + 1;
  return out;
};

console.log(`organization ${orgId}: ${scope.players} players on ${view.affiliates.length} affiliates`);
console.log(`  read by Player Development ${scope.assessed} · indeterminate ${scope.indeterminate} · no season to read ${scope.notAssessable} · on rehab ${scope.rehab}`);
console.log('');
console.log(`attention items: ${view.attention.length}`);
console.log(`  by severity ${JSON.stringify(count(view.attention, (a) => a.severity))}`);
console.log(`  by kind     ${JSON.stringify(count(view.attention, (a) => a.kind))}`);
console.log('');
console.log(`assignment conclusions ${JSON.stringify(count(view.assignments, (a) => a.conclusion))}`);
console.log(`assignment attention   ${JSON.stringify(count(view.assignments, (a) => a.attention))}`);
console.log(`retention conclusions  ${JSON.stringify(count(view.retention, (r) => r.conclusion))}`);
console.log('');
console.log('affiliates:');
for (const a of view.affiliates) {
  const dev = a.developmental.findings.filter((f) => f.severity !== 'noted').length;
  console.log(
    `  ${a.label.padEnd(30)} ${a.levelName.padEnd(4)} ${String(a.games).padStart(3)} games · operational ${a.operational.status.padEnd(9)}` +
      ` · operational findings ${a.operational.findings.length} · developmental findings raised ${dev}`
  );
}
console.log('');
console.log(`organization findings: ${view.organization.findings.length}`);
for (const f of view.organization.findings) console.log(`  [${f.severity}] ${f.headline}`);
