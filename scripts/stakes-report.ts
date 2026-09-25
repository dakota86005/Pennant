/**
 * Developmental stakes on a real import: the reference the ceiling lines stand for, and what the
 * tiers look like. Read-only.
 *
 * The stakes model's lines are provisional constants taken from ONE import (docs/DEVELOPMENTAL_STAKES.md
 * §4.8). This is the check on them, in the way `npm run farm:base-rate` is the check on the farm:
 *
 *   1. re-measures the composite of today's major leaguers, by kind, and says when the declared
 *      lines have drifted from the tenth / median / best tenth they are meant to be;
 *   2. prints each league's rostered age profile, which is the only peer population the model reads;
 *   3. reports the tier distribution by league, by age and by organization, beside what the
 *      absolute composite it replaced would have said, so a structural artifact — an organization
 *      with everybody protected, a level with nobody — is visible;
 *   4. lists one organization's players whose tier moved two steps or more.
 *
 *   OOTP_FO_DATA_DIR=<dir containing league.db> npm run stakes:report [orgId]
 *
 * It writes nothing, ranks nobody and changes no behaviour: a person reads the output and decides.
 * Ratings come only through the evidence adapter (D-017).
 */

import { db, tableExists } from '../server/db.js';
import { loadScoutedAbilities } from '../server/scoutedEvidence.js';
import { openDevelopmentalContext } from '../server/developmentalContext.js';
import { CEILING_LINES, TIER_ORDER, type DevelopmentProtection, type DevelopmentProtectionTier } from '../server/developmentFit.js';

if (!tableExists('teams') || !tableExists('players') || !tableExists('team_roster')) {
  throw new Error('No league imported: point OOTP_FO_DATA_DIR at a directory with league.db.');
}

const ACTIVE_LIST = 2;
const SHORT: Record<string, string> = { core_prospect: 'core', protected_prospect: 'prot', development_priority: 'prio', normal: 'norm', organizational_depth: 'depth' };

const quantile = (values: number[], q: number): number => {
  const xs = [...values].sort((a, b) => a - b);
  const at = (xs.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.min(xs.length - 1, lo + 1);
  return xs[lo] + (xs[hi] - xs[lo]) * (at - lo);
};

/* ── 1. the reference the ceiling lines stand for ────────────────────────────────────────────── */

const majorLeaguers = db
  .prepare(
    `SELECT p.player_id AS id, p.position AS position
     FROM players p JOIN teams t ON t.team_id = p.team_id
     JOIN team_roster r ON r.team_id = t.team_id AND r.player_id = p.player_id AND r.list_id = ?
     WHERE t.level = 1 AND t.allstar_team = 0 AND p.retired = 0`
  )
  .all(ACTIVE_LIST) as Array<{ id: number; position: number }>;
const mlbAbilities = loadScoutedAbilities(majorLeaguers.map((m) => m.id));

console.log('1. The reference: current composite of active major leaguers, by kind');
console.log('   (the ceiling lines are its tenth, median and best tenth: measured per save at each import since cycle 4, stakesLines.ts; compared here with Pennant\'s starting lines)\n');
for (const kind of ['hitter', 'pitcher'] as const) {
  const composites = majorLeaguers
    .filter((m) => (Number(m.position) === 1) === (kind === 'pitcher'))
    .map((m) => mlbAbilities.for(m.id).current)
    .filter((c): c is number => c !== null);
  const lines = CEILING_LINES[kind];
  if (composites.length < 100) {
    console.log(`   ${kind.padEnd(8)} only ${composites.length} major leaguers with a visible composite: too few to check the lines against.`);
    continue;
  }
  const measured = { fringe: quantile(composites, 0.1), regular: quantile(composites, 0.5), impact: quantile(composites, 0.9) };
  const drift = (Object.keys(lines) as Array<keyof typeof lines>).filter((k) => Math.abs(measured[k] - lines[k]) >= 2);
  console.log(
    `   ${kind.padEnd(8)} n=${String(composites.length).padStart(4)}  p10 ${measured.fringe.toFixed(0)}  p50 ${measured.regular.toFixed(0)}  p90 ${measured.impact.toFixed(0)}` +
      `   starting ${lines.fringe} / ${lines.regular} / ${lines.impact}   ${drift.length ? `DRIFTED: ${drift.join(', ')}` : 'in line'}`
  );
}

/* ── every minor leaguer on an affiliate's active list, with the organization he belongs to ──── */

interface Row { id: number; name: string; age: number; position: number; team_id: number; team: string; level: number; league_id: number; league: string | null; org_id: number; org: string }

const rows = db
  .prepare(
    `WITH RECURSIVE org(team_id, root_id) AS (
       SELECT team_id, team_id FROM teams WHERE level = 1 AND allstar_team = 0
       UNION ALL
       SELECT t.team_id, o.root_id FROM teams t JOIN org o ON t.parent_team_id = o.team_id WHERE t.level > 1
     )
     SELECT p.player_id AS id, p.first_name || ' ' || p.last_name AS name, p.age AS age, p.position AS position,
            t.team_id AS team_id, t.name || ' ' || t.nickname AS team, t.level AS level, t.league_id AS league_id, l.name AS league,
            o.root_id AS org_id, root.name AS org
     FROM org o
     JOIN teams t ON t.team_id = o.team_id AND t.level > 1
     JOIN teams root ON root.team_id = o.root_id
     LEFT JOIN leagues l ON l.league_id = t.league_id
     JOIN players p ON p.team_id = t.team_id AND p.retired = 0
     JOIN team_roster r ON r.team_id = t.team_id AND r.player_id = p.player_id AND r.list_id = ?`
  )
  .all(ACTIVE_LIST) as Row[];

const abilities = loadScoutedAbilities(rows.map((r) => r.id));
const stakes = openDevelopmentalContext();
const read = rows.map((r) => {
  const ability = abilities.for(r.id);
  const protection: DevelopmentProtection = stakes.protect({ age: r.age, teamId: r.team_id, ability });
  return { ...r, current: ability.current, potential: ability.potential, protection, before: protection.reading?.supersededComposite.tier ?? null };
});

/* ── 2. the one peer population the model reads ──────────────────────────────────────────────── */

console.log('\n2. Rostered age profile of each league (the schedule is read against this, and nothing else is)\n');
const leagues = new Map<string, { level: number; leagueId: number; league: string }>();
for (const r of read) leagues.set(`${r.level}:${r.league_id}`, { level: Number(r.level), leagueId: Number(r.league_id), league: r.league ?? `League ${r.league_id}` });
for (const l of [...leagues.values()].sort((a, b) => a.level - b.level || a.leagueId - b.leagueId)) {
  const profile = stakes.profile(l.level, l.leagueId);
  console.log(`   L${l.level} ${l.league.padEnd(28)} ${profile.scope.padEnd(11)} ${String(profile.players).padStart(5)} rostered   average age ${profile.averageAge === null ? 'n/a' : profile.averageAge.toFixed(1)}`);
}

/* ── 3. distributions ────────────────────────────────────────────────────────────────────────── */

type Read = (typeof read)[number];
const mix = (group: Read[], of: (r: Read) => DevelopmentProtectionTier | null): string => {
  const n = group.length || 1;
  const parts = [...TIER_ORDER].reverse().map((t) => {
    const count = group.filter((r) => of(r) === t).length;
    return `${SHORT[t]} ${String(count).padStart(4)} ${`${((100 * count) / n).toFixed(1)}%`.padStart(6)}`;
  });
  const unknown = group.filter((r) => of(r) === null).length;
  return `${parts.join('  ')}  unknown ${unknown}`;
};
const now = (r: Read) => r.protection.tier;
const before = (r: Read) => r.before;

console.log(`\n3. Tiers: ${read.length} minor leaguers on an affiliate's active list\n`);
console.log(`   absolute composite (superseded)  ${mix(read, before)}`);
console.log(`   developmental stakes             ${mix(read, now)}`);

console.log('\n   by kind');
for (const kind of ['hitter', 'pitcher'] as const) console.log(`   ${kind.padEnd(30)} ${mix(read.filter((r) => (Number(r.position) === 1) === (kind === 'pitcher')), now)}`);

console.log('\n   by league');
for (const l of [...leagues.values()].sort((a, b) => a.level - b.level || a.leagueId - b.leagueId)) {
  console.log(`   L${l.level} ${l.league.padEnd(27)} ${mix(read.filter((r) => Number(r.level) === l.level && Number(r.league_id) === l.leagueId), now)}`);
}

console.log('\n   by age');
for (const [label, test] of [
  ['19 and under', (a: number) => a <= 19], ['20 to 22', (a: number) => a >= 20 && a <= 22], ['23 to 24', (a: number) => a === 23 || a === 24],
  ['25 to 26', (a: number) => a === 25 || a === 26], ['27 and over', (a: number) => a >= 27],
] as Array<[string, (a: number) => boolean]>) {
  console.log(`   ${label.padEnd(30)} ${mix(read.filter((r) => test(Number(r.age))), now)}`);
}

console.log('\n   by organization (different systems legitimately differ; look for everybody or nobody)');
const orgs = new Map<number, string>();
for (const r of read) orgs.set(r.org_id, r.org);
for (const [orgId, name] of [...orgs].sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0])) {
  const mine = read.filter((r) => r.org_id === orgId);
  const count = (t: DevelopmentProtectionTier) => mine.filter((r) => r.protection.tier === t).length;
  const share = (100 * (count('core_prospect') + count('protected_prospect') + count('development_priority'))) / (mine.length || 1);
  console.log(
    `   ${`${name} (${orgId})`.padEnd(24)} n=${String(mine.length).padStart(3)}  core ${String(count('core_prospect')).padStart(2)}  prot ${String(count('protected_prospect')).padStart(3)}` +
      `  prio ${String(count('development_priority')).padStart(3)}  norm ${String(count('normal')).padStart(3)}  depth ${String(count('organizational_depth')).padStart(3)}   priority or better ${share.toFixed(0)}%`
  );
}

/* ── 4. one organization's material re-tierings ──────────────────────────────────────────────── */

const human = db.prepare('SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1').get() as { team_id: number } | undefined;
const orgId = Number(process.argv[2] ?? 0) || (human ? Number(human.team_id) : 0);
const mine = read.filter((r) => r.org_id === orgId);
if (mine.length > 0) {
  const step = (t: DevelopmentProtectionTier | null) => (t === null ? -1 : TIER_ORDER.indexOf(t));
  console.log(`\n4. ${orgs.get(orgId)}: ${mine.length} players.  superseded → now`);
  console.log(`   ${mix(mine, before)}`);
  console.log(`   ${mix(mine, now)}\n`);
  const moved = mine
    .filter((r) => r.before !== null && r.protection.tier !== null && Math.abs(step(r.protection.tier) - step(r.before)) >= 2)
    .sort((a, b) => Number(a.level) - Number(b.level) || a.name.localeCompare(b.name));
  console.log(`   moved two tiers or more: ${moved.length}`);
  for (const r of moved) {
    console.log(`   ${r.name.padEnd(24)} ${String(r.age).padStart(2)}  ${`${r.current}/${r.potential}`.padEnd(6)} ${r.team.padEnd(34)} ${SHORT[r.before as string]} → ${SHORT[r.protection.tier as string]}`);
    console.log(`       ${r.protection.reading?.supersededComposite.differs ?? ''}`);
  }
}
