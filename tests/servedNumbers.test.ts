import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every number the server serves reads as one formatter writes it (B-06, B-09; `server/numberWords.ts`): no money with
 * its sign after the dollar sign ("$-3.2M"), no rounding left uncarried ("$1000K"), no "(s)" plural, no "1 games", and
 * no innings that baseball can't write (an IP ending .3 to .9, which is a decimal third, not outs). The walk reads every
 * captured payload in `contract/fixtures/`, which the contract tests build from the synthetic league through the
 * production routes, so a new page is covered the day its fixture is captured.
 */

const FIXTURES = path.join(process.cwd(), 'contract', 'fixtures');
const SERVER = path.join(process.cwd(), 'server');

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

/** People nouns: a four-digit figure before one is a head count, never a season ("2076 draft-eligible players"). */
const PEOPLE_NOUNS = new Set(['players', 'prospects', 'regulars', 'starters', 'relievers']);
const UNGROUPED = new RegExp(`(?<![\\d.,$/:-])\\b(\\d{4,})\\s(?:[a-z]+(?:-[a-z]+)*\\s){0,2}?(${PLURAL_NOUNS.join('|')})\\b`, 'g');

/**
 * A figure of 1,000 or more written without its grouping before a counted noun, up to two words apart ("2076 players",
 * "2076 draft-eligible players"). A season is not a count, so 1800 to 2199 is let through where a season reading is
 * plausible ("2041 wins" is the 2041 season's column), but never before a people noun.
 */
function ungroupedCount(text: string): boolean {
  for (const m of text.matchAll(UNGROUPED)) {
    const season = /^(?:18|19|20|21)\d\d$/.test(m[1]);
    if (!season || PEOPLE_NOUNS.has(m[2])) return true;
  }
  return false;
}

/** What no served string may say, each with why. */
const RULES: Array<{ name: string; test: (f: Found) => boolean }> = [
  { name: 'money with its sign after the dollar sign ("$-3.2M")', test: (f) => /\$[-−]/.test(f.text) },
  { name: 'a rounding left uncarried ("$1000K")', test: (f) => /\$1,?000(?:\.0+)?K\b/.test(f.text) },
  { name: 'an "(s)" plural', test: (f) => /[a-z]\(s\)/i.test(f.text) },
  { name: 'one with a plural noun ("1 games")', test: (f) => new RegExp(`(?<![\\d.,−-])\\b1 (?:${PLURAL_NOUNS.join('|')})\\b`).test(f.text) },
  { name: 'a count over 999 without its thousands grouped ("2076 players")', test: (f) => ungroupedCount(f.text) },
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
    expect(caught('2076 draft-eligible players')).toHaveLength(1);
    expect(caught('2076 players')).toHaveLength(1);
    expect(caught('Show all 2,076 draft-eligible players')).toHaveLength(0);
    expect(caught('1500 more games')).toHaveLength(1);
    expect(caught('2041 regular-season wins')).toHaveLength(0);
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

/** Every TypeScript source file under `server/`. */
function serverFiles(dir = SERVER): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const at = path.join(dir, e.name);
    if (e.isDirectory()) return serverFiles(at);
    return /\.ts$/.test(e.name) && !e.name.endsWith('.d.ts') ? [at] : [];
  });
}

/** The text of every string and template literal in a source file (comments are not nodes, so they are skipped). */
function literalsOf(file: string): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: Array<{ line: number; text: string }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** An "(s)" plural written into a string: "player(s)", "day(s)". Case-sensitive, so SQL's `SUM(s)` is not one. */
const PAREN_PLURAL = /[a-z]\(s\)/;

/**
 * The fixture walk sees only the paths the contract captures, so an "(s)" on a path no fixture reaches (a rights
 * message, a farm note) would slip past it. This reads every string the server source can write instead: no string or
 * template literal under `server/` says "(s)"; a count's noun goes through `plural` (`server/numberWords.ts`).
 */
describe('no server string writes an "(s)" plural (B-06)', () => {
  it('the guard sees literals and skips comments', () => {
    const probe = path.join(SERVER, '__probe__.ts');
    const sf = ts.createSourceFile(probe, [
      '// a comment about player(s) is not served',
      '/** nor is a doc comment on the field(s) */',
      "const a = 'two player(s)';",
      'const b = `${n} day(s) left, ${m} more`;',
      'const c = pick(s);',
      "const d = 'SELECT SUM(s) AS sv';",
    ].join('\n'), ts.ScriptTarget.Latest, true);
    const texts: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) texts.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(texts.filter((t) => PAREN_PLURAL.test(t))).toEqual(['two player(s)', ' day(s) left, ']);
  });

  it('finds the server source', () => {
    expect(serverFiles().length).toBeGreaterThan(100);
  });

  it('no string or template literal under server/ says "(s)"', () => {
    const offending = serverFiles().flatMap((file) => literalsOf(file)
      .filter((l) => PAREN_PLURAL.test(l.text))
      .map((l) => `${path.relative(process.cwd(), file)}:${l.line}: ${JSON.stringify(l.text)}`));
    expect(offending).toEqual([]);
  });
});
