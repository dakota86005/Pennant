#!/usr/bin/env node
// The XCUITests' shards on CI (DEVELOPMENT.md "The Mac app's UI tests on CI"): which tests each parallel job runs, kept
// in one place, ui-test-shards.json beside this script. Each shard lists its tests with the seconds they took on the
// runner; one shard, `catchAll`, also runs every test no shard lists, so a new UI test runs before anyone assigns it.
//
//   node macos/scripts/ui-test-shards.mjs matrix [only]   the CI matrix (JSON): each shard, its expected minutes and
//                                                         its timeout; with `only`, one shard for that one test
//   node macos/scripts/ui-test-shards.mjs args <shard>    xcodebuild's -only-testing or -skip-testing arguments, one a
//                                                         line (test.sh reads them for PENNANT_TEST_SHARD)
//   node macos/scripts/ui-test-shards.mjs unassigned      the UI tests in the Swift sources that no shard lists
//   node macos/scripts/ui-test-shards.mjs balance <xcodebuild-test.log> [count]
//                                                         reassigns every test from a run's measured times, longest
//                                                         first, each to the shard with the least so far, and writes
//                                                         the JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHARDS_PATH = path.join(HERE, 'ui-test-shards.json');
export const UI_TESTS_DIR = path.join(HERE, '..', 'PennantUITests');
/** The UI-test bundle's target, the first part of an xcodebuild test identifier */
const TARGET = 'PennantUITests';
/** The UI tests' class; any other class in the bundle is unit tests, a few milliseconds each */
const UI_CLASS = 'PennantUITests';

export function loadShards(file = SHARDS_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Each test in the Swift sources as `Class/testMethod`, in source order */
export function discoverTests(sources) {
  const tests = [];
  for (const source of sources) {
    let current = null;
    for (const line of source.split('\n')) {
      const cls = /^(?:final\s+)?class\s+(\w+)\s*:\s*XCTestCase\b/.exec(line);
      if (cls) current = cls[1];
      const test = /^\s+(?:@MainActor\s+)?func\s+(test\w*)\s*\(\s*\)/.exec(line);
      if (test && current) tests.push(`${current}/${test[1]}`);
    }
  }
  return tests;
}

export function readSwiftTests(dir = UI_TESTS_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.swift')).sort();
  return discoverTests(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')));
}

/** Whether a shard entry (`Class` or `Class/testMethod`) covers a test */
function covers(entry, test) {
  return entry === test || test.startsWith(`${entry}/`);
}

/** The tests no shard lists (they run in the catch-all shard) */
export function unassigned(config, tests) {
  const entries = config.shards.flatMap((shard) => Object.keys(shard));
  return tests.filter((test) => !entries.some((entry) => covers(entry, test)));
}

/** xcodebuild's arguments for one shard (1-based): its own tests; the catch-all skips the other shards' instead */
export function shardArgs(config, shard) {
  const index = Number(shard) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= config.shards.length) {
    throw new Error(`No shard ${shard}: ui-test-shards.json has ${config.shards.length}`);
  }
  if (index === config.catchAll - 1) {
    const others = config.shards.filter((_, i) => i !== index).flatMap((s) => Object.keys(s));
    return others.map((entry) => `-skip-testing:${TARGET}/${entry}`);
  }
  return Object.keys(config.shards[index]).map((entry) => `-only-testing:${TARGET}/${entry}`);
}

/** A shard's expected minutes on the runner: its tests' measured time and the setup every shard pays */
function expectedMinutes(config, seconds) {
  return config.setupMinutes + seconds / 60;
}

/** The timeout: about double the expected time, never under 20 minutes */
function timeoutMinutes(minutes) {
  return Math.max(20, Math.ceil(2 * minutes));
}

/**
 * The CI matrix: one entry per shard with its expected minutes and its timeout. With `only` (the workflow_dispatch
 * input, xcodebuild's names separated by spaces), one shard for those tests, timed from what they took when known.
 */
export function matrix(config, only = '') {
  const sums = config.shards.map((s) => Object.values(s).reduce((a, b) => a + b, 0));
  const wanted = only.trim().split(/\s+/).filter(Boolean);
  if (wanted.length > 0) {
    const measured = Object.assign({}, ...config.shards);
    const times = wanted.map((name) => measured[name.replace(`${TARGET}/`, '')]);
    const seconds = times.every((t) => typeof t === 'number') ? times.reduce((a, b) => a + b, 0) : Math.max(...sums);
    const minutes = expectedMinutes(config, seconds);
    return [{ shard: 1, of: 1, expected: Math.round(minutes), timeout: timeoutMinutes(minutes) }];
  }
  return sums.map((seconds, i) => {
    const minutes = expectedMinutes(config, seconds);
    return { shard: i + 1, of: sums.length, expected: Math.round(minutes), timeout: timeoutMinutes(minutes) };
  });
}

/** Each test's seconds from an xcodebuild test log, as `Class/testMethod` */
export function parseDurations(log) {
  const durations = new Map();
  const line = /^Test Case '-\[\w+\.(\w+) (test\w*)\]' (?:passed|failed) \(([\d.]+) seconds\)/gm;
  for (const m of log.matchAll(line)) durations.set(`${m[1]}/${m[2]}`, Number(m[3]));
  return durations;
}

/**
 * Greedy longest-first: each test, longest first, to the shard with the least time so far. A class of unit tests
 * (any class but the UI tests' own) stays whole in one shard. The catch-all is the shard with the least time, where
 * an unassigned test costs least.
 */
export function balance(durations, count) {
  const entries = new Map();
  for (const [test, seconds] of durations) {
    const [cls] = test.split('/');
    const key = cls === UI_CLASS ? test : cls;
    entries.set(key, (entries.get(key) ?? 0) + seconds);
  }
  const sorted = [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shards = Array.from({ length: count }, () => ({ tests: {}, sum: 0 }));
  for (const [key, seconds] of sorted) {
    const least = shards.reduce((min, s) => (s.sum < min.sum ? s : min));
    least.tests[key] = Math.round(seconds);
    least.sum += seconds;
  }
  const catchAll = shards.indexOf(shards.reduce((min, s) => (s.sum < min.sum ? s : min))) + 1;
  return { catchAll, shards: shards.map((s) => s.tests) };
}

function main([command, ...rest]) {
  const config = loadShards();
  if (command === 'matrix') {
    for (const test of unassigned(config, readSwiftTests())) {
      // A GitHub annotation on the run: the test still runs, in the catch-all shard
      console.error(`::notice::${test} is in no shard of macos/scripts/ui-test-shards.json; shard ${config.catchAll} runs it`);
    }
    console.log(JSON.stringify(matrix(config, rest.join(' '))));
  } else if (command === 'args') {
    console.log(shardArgs(config, rest[0]).join('\n'));
  } else if (command === 'unassigned') {
    console.log(unassigned(config, readSwiftTests()).join('\n'));
  } else if (command === 'balance') {
    const [log, count = String(config.shards.length), source] = rest;
    const next = { ...config, ...balance(parseDurations(fs.readFileSync(log, 'utf8')), Number(count)) };
    if (source) next.measured = source;
    fs.writeFileSync(SHARDS_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(matrix(next).map((s) => `shard ${s.shard}: about ${s.expected} min, timeout ${s.timeout}`).join('\n'));
  } else {
    console.error('usage: ui-test-shards.mjs matrix [only] | args <shard> | unassigned | balance <log> [count] [source]');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
