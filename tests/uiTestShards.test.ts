import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ES module script with no type declarations (CI runs it with node alone)
import { balance, discoverTests, loadShards, matrix, parseDurations, readSwiftTests, shardArgs, unassigned } from '../macos/scripts/ui-test-shards.mjs';

/**
 * The XCUITests' CI shards (macos/scripts/ui-test-shards.json, DEVELOPMENT.md "The Mac app's UI tests on CI"): every
 * UI test runs in exactly one shard, a test no shard lists runs in the catch-all, and the gate keeps its name.
 */
type Config = { catchAll: number; setupMinutes: number; shards: Record<string, number>[] };

/** What xcodebuild runs for a shard's arguments: only the named tests, or every test but the skipped ones */
function selected(args: string[], tests: string[]): string[] {
  const named = (prefix: string) => args.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length).replace(/^PennantUITests\//, ''));
  const hits = (entries: string[], test: string) => entries.some((e) => e === test || test.startsWith(`${e}/`));
  const only = named('-only-testing:');
  const skip = named('-skip-testing:');
  return tests.filter((t) => (only.length === 0 || hits(only, t)) && !hits(skip, t));
}

function runs(config: Config, tests: string[]): Map<string, number[]> {
  const where = new Map(tests.map((t) => [t, [] as number[]]));
  config.shards.forEach((_, i) => {
    for (const t of selected(shardArgs(config, i + 1), tests)) where.get(t)!.push(i + 1);
  });
  return where;
}

describe('the XCUITest shards', () => {
  const config: Config = loadShards();
  const tests: string[] = readSwiftTests();

  it('finds the UI tests and the unit tests in the bundle', () => {
    expect(tests).toContain('PennantUITests/testStartsTheServerAndQuitsCleanly');
    expect(tests).toContain('ScrollClipTests/testAClippedCellIsExcused');
  });

  it('lists only tests that exist, each once, with a catch-all among the shards', () => {
    const entries = config.shards.flatMap((s) => Object.keys(s));
    expect(new Set(entries).size).toBe(entries.length);
    for (const entry of entries) expect(tests.some((t) => t === entry || t.startsWith(`${entry}/`)), entry).toBe(true);
    expect(config.catchAll).toBeGreaterThanOrEqual(1);
    expect(config.catchAll).toBeLessThanOrEqual(config.shards.length);
  });

  it('runs every test in exactly one shard, the unit tests together', () => {
    for (const [test, shards] of runs(config, tests)) expect(shards, test).toHaveLength(1);
    const scrollClip = tests.filter((t) => t.startsWith('ScrollClipTests/')).map((t) => runs(config, tests).get(t)![0]);
    expect(new Set(scrollClip).size).toBe(1);
  });

  it('runs a new test that no shard lists in the catch-all shard, and only there', () => {
    const source = 'final class PennantUITests: XCTestCase {\n    func testSomethingNew() throws {\n    }\n}\n';
    const withNew = [...tests, ...discoverTests([source])];
    expect(unassigned(config, withNew)).toEqual(['PennantUITests/testSomethingNew']);
    expect(runs(config, withNew).get('PennantUITests/testSomethingNew')).toEqual([config.catchAll]);
  });

  it('gives each shard a timeout of about double its expected time, and one shard to a test asked for by hand', () => {
    const shards = matrix(config);
    expect(shards).toHaveLength(config.shards.length);
    for (const s of shards) {
      expect(s.timeout).toBeGreaterThanOrEqual(2 * s.expected - 1);
      expect(s.expected).toBeLessThanOrEqual(35);
    }
    const one = matrix(config, 'PennantUITests/PennantUITests/testStartsTheServerAndQuitsCleanly');
    expect(one).toEqual([{ shard: 1, of: 1, expected: expect.any(Number), timeout: 20 }]);
  });

  it('balances longest first and keeps a class of unit tests whole', () => {
    const log = [
      "Test Case '-[PennantUITests.PennantUITests testA]' passed (600.0 seconds).",
      "Test Case '-[PennantUITests.PennantUITests testB]' passed (500.0 seconds).",
      "Test Case '-[PennantUITests.PennantUITests testC]' failed (400.0 seconds).",
      "Test Case '-[PennantUITests.PennantUITests testD]' passed (300.0 seconds).",
      "Test Case '-[PennantUITests.ScrollClipTests testX]' passed (0.003 seconds).",
      "Test Case '-[PennantUITests.ScrollClipTests testY]' passed (0.004 seconds).",
    ].join('\n');
    const result = balance(parseDurations(log), 2);
    expect(result.shards).toEqual([
      { 'PennantUITests/testA': 600, 'PennantUITests/testD': 300, ScrollClipTests: 0 },
      { 'PennantUITests/testB': 500, 'PennantUITests/testC': 400 },
    ]);
    // The lighter shard, by the unit tests' few milliseconds
    expect(result.catchAll).toBe(2);
  });

  it('keeps the gate under the name the CI monitor and the docs use, after every shard', () => {
    const ci = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
    const gate = ci.slice(ci.indexOf('\n  pennant-mac-ui:\n'));
    expect(gate).toContain('name: Mac app (XCUITests on the runner)');
    expect(gate).toContain('needs: [pennant-mac-ui-build, pennant-mac-ui-shard]');
  });
});
