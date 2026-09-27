/**
 * Writes a synthetic league into a folder, for running the Mac app or its integration test on something that is
 * never a real save (SWIFTUI_REBUILD.md section 8):
 *
 *   npm run synthetic:league -- <folder>
 *
 * The folder gets `league.db`: the test fixture league (`tests/fixture.ts`) rewritten by `tests/syntheticSave.ts`
 * to the contract tests' shape (four clubs, a 60-game season half played, one season of history). Point the app
 * at the folder as its data folder (DEVELOPMENT.md "The Mac app"). A folder that already has a `league.db`
 * is left alone. Nothing here reads or writes `data/` or the real data folder.
 *
 * Beside it, `export/` holds the same league as OOTP would export it: one CSV per table, headers first. The import
 * builds a whole new database from an export (N3.5, D-061), so a pretend OOTP save that the Mac app's tests choose must
 * carry the league's tables, not a token file: a one-table export would become a league of one table.
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run synthetic:league -- <folder>');
  process.exit(1);
}
const folder = path.resolve(target);
const out = path.join(folder, 'league.db');
if (fs.existsSync(out)) {
  console.log(`[synthetic-league] ${out} already exists; left as it is`);
  process.exit(0);
}

// The fixture is built in a temporary folder, and the server modules open it there (they read the data folder
// when they load), so the rewrite never touches the target until the finished database is copied in
const { buildFixture } = await import('../tests/fixture.js');
const scratch = buildFixture();
process.env.OOTP_FO_DATA_DIR = scratch;
process.env.OOTP_FO_APP_ROOT = process.cwd();
// The rewrite goes through the server's connection, which the app itself opens read-only
process.env.OOTP_FO_DB_WRITABLE = '1';

const { buildSave } = await import('../tests/syntheticSave.js');
const { db } = await import('../server/db.js');
const { historyDb } = await import('../server/history.js');

const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11 });
fs.mkdirSync(folder, { recursive: true });
// One consistent file, whatever the journal mode
db.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);

// The export: every table as a CSV, the way OOTP writes one (a header row, empty for null, quotes where needed)
const exportDir = path.join(folder, 'export');
fs.rmSync(exportDir, { recursive: true, force: true });
fs.mkdirSync(exportDir, { recursive: true });
const field = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const text = String(v);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map((r) => r.name);
for (const table of tables) {
  const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
  const lines = [columns.map(field).join(',')];
  for (const row of db.prepare(`SELECT * FROM "${table}"`).raw().all() as unknown[][]) lines.push(row.map(field).join(','));
  fs.writeFileSync(path.join(exportDir, `${table}.csv`), `${lines.join('\n')}\n`);
}
db.close();
historyDb.close();
fs.rmSync(scratch, { recursive: true, force: true });
console.log(`[synthetic-league] wrote ${out} (${save.clubs.length} clubs; the human manages club ${save.org}) and its export (${tables.length} tables)`);
