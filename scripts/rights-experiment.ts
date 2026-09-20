/**
 * Evidence capture for controlled OOTP rule experiments (docs/RIGHTS_RESEARCH.md).
 *
 * Run it against the CSV export of a COPIED save, before and after exactly one
 * in-game action, then diff the two captures:
 *
 *   npm run rights:capture -- --export "<copy>.lg/import_export/csv" \
 *        --label before-optionA1 --players "Jane Doe,12345"
 *   ...perform ONE action in OOTP, export the database to CSV again...
 *   npm run rights:capture -- --export "<copy>.lg/import_export/csv" \
 *        --label after-optionA1 --players "Jane Doe,12345"
 *   npm run rights:diff -- captures/before-optionA1.json captures/after-optionA1.json
 *
 * It never writes to OOTP's files. The CSV export is read, and the live
 * transaction database is read only through the same private-copy snapshot the
 * application uses (`liveLogSnapshot.ts`). The export is imported into an
 * isolated data directory, never the application's own `data/league.db`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Json = Record<string, unknown>;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const DEFAULT_OUT = path.resolve('captures');

async function capture(): Promise<void> {
  const exportDir = flag('export');
  const label = flag('label');
  const players = (flag('players') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!exportDir || !label) {
    console.error('usage: rights:capture --export <csv dir> --label <name> --players "<name|id>,..." [--out <dir>]');
    process.exit(2);
  }
  if (!fs.existsSync(exportDir) || !fs.statSync(exportDir).isDirectory()) {
    console.error(`No such export directory: ${exportDir}`);
    process.exit(2);
  }
  const outDir = path.resolve(flag('out') ?? DEFAULT_OUT);

  // The application's modules read OOTP_FO_DATA_DIR at import time, so it must
  // point somewhere disposable before they load
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rights-capture-'));
  process.env.OOTP_FO_DATA_DIR = scratch;
  const { importCsvDir } = await import('../server/importer.js');
  const { db, tableExists } = await import('../server/db.js');
  const { locateSave } = await import('../server/ootpSave.js');
  const { readTransactionLog } = await import('../server/transactionLog.js');

  console.log(`Importing ${exportDir} into an isolated database...`);
  await importCsvDir(exportDir);

  const one = (sql: string, ...params: unknown[]): Json | null =>
    (db.prepare(sql).get(...params) as Json | undefined) ?? null;

  const captured: Json[] = [];
  for (const who of players) {
    const isId = /^\d+$/.test(who);
    const found = db
      .prepare(
        isId
          ? `SELECT player_id FROM players WHERE player_id = ?`
          : `SELECT player_id FROM players WHERE first_name || ' ' || last_name = ?`
      )
      .all(isId ? Number(who) : who) as Array<{ player_id: number }>;
    if (found.length !== 1) {
      captured.push({ query: who, error: found.length === 0 ? 'not found' : `ambiguous (${found.length} matches); use the player id` });
      continue;
    }
    const id = found[0].player_id;
    captured.push({
      query: who,
      player: one(
        `SELECT player_id, first_name, last_name, age, position, role, organization_id, team_id, retired,
                injury_is_injured, injury_dtd_injury, injury_left
         FROM players WHERE player_id = ?`,
        id
      ),
      team: one(
        `SELECT t.team_id, t.name, t.nickname, t.level, t.parent_team_id, t.league_id
         FROM teams t JOIN players p ON p.team_id = t.team_id WHERE p.player_id = ?`,
        id
      ),
      rosterStatus: tableExists('players_roster_status')
        ? one(`SELECT * FROM players_roster_status WHERE player_id = ?`, id)
        : null,
      contract: tableExists('players_contract') ? one(`SELECT * FROM players_contract WHERE player_id = ?`, id) : null,
    });
  }

  const humanOrg = one(`SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1`)?.team_id as number | undefined;
  const orgCounts = humanOrg
    ? one(
        `SELECT SUM(rs.is_on_secondary) AS fortyMan, SUM(rs.is_active) AS active,
                SUM(rs.is_on_dl) AS onIl, SUM(rs.is_on_dl60) AS onIl60
         FROM players p JOIN players_roster_status rs ON rs.player_id = p.player_id
         WHERE p.organization_id = ? AND p.retired = 0`,
        humanOrg
      )
    : null;

  const location = locateSave({ csvDir: exportDir });
  let logMeta: Json = { available: false, reason: 'save not located' };
  let events: unknown[] = [];
  let recent: unknown[] = [];
  if (location.found && location.live) {
    try {
      const log = readTransactionLog(location.live);
      const wanted = new Set(
        captured.map((c) => (c.player as Json | null)?.player_id).filter((x): x is number => typeof x === 'number')
      );
      const slim = (e: (typeof log.events)[number]) => ({
        id: e.id, date: e.date, kind: e.kind, supported: e.supported, playerId: e.playerId,
        text: e.text, rawTypes: e.sources.map((s) => s.rawType), teams: e.sources.map((s) => s.teamId),
        details: e.details,
      });
      events = log.events.filter((e) => e.playerId !== null && wanted.has(e.playerId)).map(slim);
      recent = log.events.slice(-40).map(slim);
      logMeta = { available: true, coveredThrough: log.coverage.coveredThrough, counts: log.counts.byKind };
    } catch (err) {
      logMeta = { available: false, reason: (err as Error).message };
    }
  }

  const result: Json = {
    label,
    capturedAt: new Date().toISOString(),
    exportDir,
    league: one(
      `SELECT "current_date" AS currentDate, rosters_expanded, rules_minor_league_options, rules_rule_5,
              rules_waiver_period_length, rules_dfa_period_length, rules_active_roster_limit,
              rules_secondary_roster_limit, rules_expanded_roster_limit, rules_min_service_days
       FROM leagues WHERE league_id = (SELECT league_id FROM teams WHERE team_id = ?)`,
      humanOrg ?? 0
    ),
    humanOrganizationId: humanOrg ?? null,
    organization: orgCounts,
    players: captured,
    log: logMeta,
    playerEvents: events,
    recentEvents: recent,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${label}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`Wrote ${file}`);
}

const flat = (value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flat(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = value;
  return out;
};

function diff(): void {
  const [aPath, bPath] = args.slice(1);
  if (!aPath || !bPath) {
    console.error('usage: rights:diff <before.json> <after.json>');
    process.exit(2);
  }
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8')) as Json;
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8')) as Json;
  console.log(`# ${a.label}  ->  ${b.label}`);
  const changed = (x: unknown, y: unknown, title: string): void => {
    const fx = flat(x);
    const fy = flat(y);
    const keys = [...new Set([...Object.keys(fx), ...Object.keys(fy)])].sort();
    const lines = keys.filter((k) => JSON.stringify(fx[k]) !== JSON.stringify(fy[k]));
    console.log(`\n## ${title}`);
    if (lines.length === 0) console.log('  (no change)');
    for (const k of lines) console.log(`  ${k}: ${JSON.stringify(fx[k])} -> ${JSON.stringify(fy[k])}`);
  };
  changed(a.league, b.league, 'league rules / date');
  changed(a.organization, b.organization, 'human organization counts');
  const pa = a.players as Json[];
  const pb = b.players as Json[];
  for (const before of pa) {
    const id = (before.player as Json | null)?.player_id;
    const after = pb.find((p) => (p.player as Json | null)?.player_id === id);
    const name = `${(before.player as Json | null)?.first_name ?? before.query} ${(before.player as Json | null)?.last_name ?? ''}`.trim();
    if (!after) {
      console.log(`\n## ${name}: absent from the second capture`);
      continue;
    }
    changed(
      { ...before, query: undefined },
      { ...after, query: undefined },
      `${name} (#${id})`
    );
  }
  const seen = new Set((a.recentEvents as Array<{ id: string }>).concat(a.playerEvents as Array<{ id: string }>).map((e) => e.id));
  const fresh = [...(b.playerEvents as Array<{ id: string }>), ...(b.recentEvents as Array<{ id: string }>)].filter(
    (e, i, all) => !seen.has(e.id) && all.findIndex((x) => x.id === e.id) === i
  ) as Array<{ id: string; date: string; kind: string; rawTypes: unknown; text: string }>;
  console.log('\n## new transaction-log events');
  if (fresh.length === 0) console.log('  (none)');
  for (const e of fresh) console.log(`  ${e.date} [${e.kind}] type=${JSON.stringify(e.rawTypes)} | ${e.text}`);
  console.log(`\nlog coverage: ${JSON.stringify((a.log as Json).coveredThrough)} -> ${JSON.stringify((b.log as Json).coveredThrough)}`);
}

/**
 * Read-only: which players in a copied save fit each injured-list activation experiment
 * (docs/RIGHTS_RESEARCH.md 4.11), and where the rosters stand. Prints; writes nothing but an
 * isolated scratch database that it deletes.
 */
async function candidates(): Promise<void> {
  const exportDir = flag('export');
  if (!exportDir || !fs.existsSync(exportDir)) {
    console.error('usage: rights:candidates --export <csv dir>');
    process.exit(2);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rights-candidates-'));
  process.env.OOTP_FO_DATA_DIR = scratch;
  const { importCsvDir } = await import('../server/importer.js');
  const { db } = await import('../server/db.js');
  await importCsvDir(exportDir);
  const org = (db.prepare(`SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1`).get() as { team_id: number } | undefined)?.team_id;
  if (!org) { console.error('No human team in this export.'); process.exit(1); }
  const league = db.prepare(
    `SELECT "current_date" AS d, rules_active_roster_limit AS act, rules_expanded_roster_limit AS exp, rosters_expanded AS ex, rules_secondary_roster_limit AS forty
     FROM leagues WHERE league_id = (SELECT league_id FROM teams WHERE team_id = ?)`
  ).get(org) as Record<string, number | string>;
  const counts = db.prepare(
    `SELECT SUM(CASE WHEN rs.is_active = 1 AND t.level = 1 THEN 1 ELSE 0 END) AS active, SUM(rs.is_on_secondary) AS forty
     FROM players p JOIN players_roster_status rs ON rs.player_id = p.player_id JOIN teams t ON t.team_id = p.team_id
     WHERE p.organization_id = ? AND p.retired = 0`
  ).get(org) as { active: number; forty: number };
  const limit = league.ex ? league.exp : league.act;
  console.log(`Game date ${league.d}. Active roster ${counts.active} of ${limit}; 40-man ${counts.forty} of ${league.forty}.`);
  const rows = db.prepare(
    `SELECT p.player_id AS id, p.first_name || ' ' || p.last_name AS name, p.position AS pos, p.injury_left AS daysLeft,
            rs.is_on_dl AS dl, rs.is_on_dl60 AS dl60, rs.is_on_secondary AS forty, rs.is_active AS active, t.level AS level
     FROM players p JOIN players_roster_status rs ON rs.player_id = p.player_id JOIN teams t ON t.team_id = p.team_id
     WHERE p.organization_id = ? AND p.retired = 0 AND (rs.is_on_dl = 1 OR rs.is_on_dl60 = 1) AND t.level = 1
     ORDER BY rs.is_on_dl60, p.injury_left`
  ).all(org) as Array<{ id: number; name: string; pos: number; daysLeft: number; dl: number; dl60: number; forty: number; active: number; level: number }>;
  console.log('\nMajor-league injured list:');
  for (const r of rows) {
    console.log(`  #${r.id} ${r.name}: ${r.dl60 ? '60-day' : '10-day'} list, ${r.daysLeft} injury day(s) left${r.daysLeft <= 0 ? ' (healed)' : ''}, ${r.forty ? 'on' : 'off'} the 40-man`);
  }
  const healed10 = rows.filter((r) => !r.dl60 && r.daysLeft <= 0);
  const healed60 = rows.filter((r) => r.dl60 && r.daysLeft <= 0);
  const injured10 = rows.filter((r) => !r.dl60 && r.daysLeft > 0);
  console.log('\nSuited to:');
  console.log(`  Case 1  (early activation, a spot open)     ${injured10.map((r) => `${r.name} (${r.daysLeft}d)`).join(', ') || 'none: nobody on the 10-day list is still injured'}`);
  console.log(`  Case 2a (healed 10-day, a spot open)        ${healed10.map((r) => r.name).join(', ') || 'none'}`);
  console.log(`  Case 2b (healed 10-day, active roster full) ${healed10.map((r) => r.name).join(', ') || 'none'}${counts.active < Number(limit) ? `  [first fill the active roster to ${limit}; it is ${counts.active}]` : '  [active roster is full now]'}`);
  console.log(`  Case 3a (healed 60-day, 40-man spot open)   ${healed60.map((r) => r.name).join(', ') || 'none: nobody on the 60-day list has healed'}`);
  console.log(`  Case 3b (healed 60-day, 40-man full)        ${healed60.map((r) => r.name).join(', ') || 'none'}${counts.forty < Number(league.forty) ? `  [first fill the 40-man to ${league.forty}; it is ${counts.forty}]` : '  [40-man is full now]'}`);
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (command === 'capture') await capture();
else if (command === 'candidates') await candidates();
else if (command === 'diff') diff();
else {
  console.error('usage: rights-experiment.ts capture|diff|candidates ...');
  process.exit(2);
}
