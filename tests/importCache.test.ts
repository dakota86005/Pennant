import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importCache } from '../server/importCache.js';
import { importCsvDir } from '../server/importer.js';

/**
 * Caches that last one import (N3.5, `importCache.ts`): a figure that depends on the export alone is computed once per
 * import, and a new import is never read through an old cache. Nothing keyed on a philosophy may live in one
 * (MINOR_LEAGUE_OPERATIONS.md section 7.8: a changed philosophy is always seen at once).
 */
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

function tinyExport(version: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-cache-'));
  scratch.push(dir);
  fs.writeFileSync(path.join(dir, 'players.csv'), `player_id,version\n1,${version}\n`);
  return dir;
}

describe('a per-import cache', () => {
  it('computes once per import and key, and again after the next import', async () => {
    const cache = importCache<number>();
    let computed = 0;
    const read = (key: string): number => cache.get(key, () => ++computed);
    expect(read('a')).toBe(1);
    expect(read('a')).toBe(1);
    expect(read('b')).toBe(2);
    await importCsvDir(tinyExport(1));
    expect(read('a')).toBe(3);
    expect(read('a')).toBe(3);
  });

  it('lives only in modules that read no philosophy', () => {
    const server = path.join(process.cwd(), 'server');
    const philosophy = /from '\.\/(philosophy|assignmentPreference|staffPreference|playerValueLens|settings)\.js'/;
    const users = fs.readdirSync(server).filter((f) => f.endsWith('.ts') && /importCache</.test(fs.readFileSync(path.join(server, f), 'utf8')));
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) expect(fs.readFileSync(path.join(server, file), 'utf8'), file).not.toMatch(philosophy);
  });
});
