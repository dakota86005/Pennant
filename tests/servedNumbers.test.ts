import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every number the server serves reads as one formatter writes it (B-06, B-09; `server/numberWords.ts`): no money with
 * its sign after the dollar sign ("$-3.2M"), no rounding left uncarried ("$1000K"), no "(s)" plural, no "1 games", and
 * no innings that baseball can't write (an IP ending .3 to .9, which is a decimal third, not outs). The walk reads every
 * captured payload in `contract/fixtures/`, which the contract tests build from the synthetic league through the
 * production routes, so a new page is covered the day its fixture is captured.
 */

const FIXTURES = path.join(process.cwd(), 'contract', 'fixtures');

/** Every fixture file the Mac app decodes (JSON and the event streams). */
function fixtureFiles(dir = FIXTURES): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const at = path.join(dir, e.name);
    if (e.isDirectory()) return fixtureFiles(at);
    return /\.(json|sse)$/.test(e.name) ? [at] : [];
  });
}

/** The JSON values in a fixture: the file itself, or each `data:` line of an event stream. */
function valuesOf(file: string): unknown[] {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return [JSON.parse(text)];
  return text.split('\n').filter((l) => l.startsWith('data:')).flatMap((l) => {
    try { return [JSON.parse(l.slice(5))]; } catch { return []; }
  });
}

interface Found { where: string; text: string }

/** Every string in a value, with the keys that lead to it. */
function stringsOf(value: unknown, where: string, out: Found[]): Found[] {
  if (typeof value === 'string') out.push({ where, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => stringsOf(v, `${where}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) stringsOf(v, `${where}.${k}`, out);
  return out;
}

const PLURAL_NOUNS = [
  'games', 'errors', 'innings', 'players', 'seasons', 'days', 'starts', 'saves', 'holds', 'wins', 'losses', 'outs', 'runs',
  'years', 'imports', 'contracts', 'signings', 'prospects', 'positions', 'regulars', 'starters', 'relievers', 'notes', 'titles',
  'appearances', 'clubs', 'teams', 'trips', 'awards', 'renewals', 'deals', 'flags', 'matches', 'points', 'rounds', 'files',
];

/** What no served string may say, each with why. */
const RULES: Array<{ name: string; test: (f: Found) => boolean }> = [
  { name: 'money with its sign after the dollar sign ("$-3.2M")', test: (f) => /\$[-−]/.test(f.text) },
  { name: 'a rounding left uncarried ("$1000K")', test: (f) => /\$1,?000(?:\.0+)?K\b/.test(f.text) },
  { name: 'an "(s)" plural', test: (f) => /[a-z]\(s\)/i.test(f.text) },
  { name: 'one with a plural noun ("1 games")', test: (f) => new RegExp(`(?<![\\d.,−-])\\b1 (?:${PLURAL_NOUNS.join('|')})\\b`).test(f.text) },
  // A season is not a count: "2041 wins" is the 2041 season's column
  { name: 'a count over 999 without its thousands grouped ("2076 players")', test: (f) => new RegExp(`(?<![\\d.,$/:-])\\b(?!(?:18|19|20|21)\\d\\d\\b)\\d{4,}\\s(?:${PLURAL_NOUNS.join('|')})\\b`).test(f.text) },
  { name: 'innings as a decimal third ("10.7 IP")', test: (f) => /\b\d+\.[3-9] ?(?:IP|innings?)\b/.test(f.text) },
  { name: 'an IP cell as a decimal third ("33.7")', test: (f) => /\.ip(?:\.(?:text|display))?$/.test(f.where) && /^\d[\d,]*\.[3-9]$/.test(f.text) },
];

describe('served numbers read as one formatter writes them (B-06, B-09)', () => {
  const files = fixtureFiles();

  it('finds the captured payloads', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('each rule catches what it is for', () => {
    const caught = (text: string, where = '$.x') => RULES.filter((r) => r.test({ where, text })).map((r) => r.name);
    expect(caught('$-3.2M free')).toHaveLength(1);
    expect(caught('−$3.2M over')).toHaveLength(0);
    expect(caught('$1000K')).toHaveLength(1);
    expect(caught('$1M')).toHaveLength(0);
    expect(caught('5 other player(s) on this club')).toHaveLength(1);
    expect(caught('Started 1 games at first base')).toHaveLength(1);
    expect(caught('Started 1 game at first base')).toHaveLength(0);
    expect(caught('11 games')).toHaveLength(0);
    expect(caught('2076 draft-eligible players')).toHaveLength(0);
    expect(caught('2,076 players')).toHaveLength(0);
    expect(caught('2041 wins')).toHaveLength(0);
    expect(caught('3076 players')).toHaveLength(1);
    expect(caught('Season line (10.7 IP, ERA 3.12)')).toHaveLength(1);
    expect(caught('Season line (10.2 IP, ERA 3.12)')).toHaveLength(0);
    expect(caught('33.7', '$.rows[0].cells.ip.text')).toHaveLength(1);
    expect(caught('33.2', '$.rows[0].cells.ip.text')).toHaveLength(0);
  });

  it.each(files.map((f) => path.relative(FIXTURES, f)))('%s', (name) => {
    const strings = valuesOf(path.join(FIXTURES, name)).flatMap((v) => stringsOf(v, '$', []));
    const offending = strings.flatMap((f) => RULES.filter((r) => r.test(f)).map((r) => `${r.name}: ${f.where} = ${JSON.stringify(f.text)}`));
    expect(offending).toEqual([]);
  });
});
