import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A static guard on the presentation layer (D-056, SWIFTUI_REBUILD.md section 8): `server/presentation/` authors the
 * words the Mac app shows about what the specialists decided, and `server/contract/` names their types. Neither judges.
 *
 * - No rating column and no `players_value` (D-017): ability reaches words only as a specialist served it.
 * - No AI module (`providers`, `ai`, `chat`, `storylines`) by value: the application decides and AI explains (D-001), so
 *   no deterministic sentence depends on a model. (The contract re-exports the provider types for Settings; a type-only
 *   import is erased and runs nothing.)
 * - No `posture` or `playoffs` (D-060): nothing the landing page uses imports the odds or the deadline posture. League
 *   Office standings will show them with their basis; when that view is built it gets a named exception here.
 * - Claims come from the builder: nothing outside `claim.ts` writes a `Claim` or a `Basis` by hand.
 * - Presentation writes nothing, and no specialist imports it: words flow from the specialists, never back.
 */

const SERVER = path.join(process.cwd(), 'server');

/** Every .ts file under a folder of server/, as a path relative to server/ ("presentation/claim.ts"). */
const filesUnder = (folder: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.ts')) out.push(`${prefix}${entry.name}`);
    }
  };
  walk(path.join(SERVER, folder), folder ? `${folder}/` : '');
  return out.sort();
};

const code = (file: string): string =>
  fs.readFileSync(path.join(SERVER, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PRESENTATION = filesUnder('presentation');
const CONTRACT = filesUnder('contract');
const BOTH = [...PRESENTATION, ...CONTRACT];

/** The module specifiers a file imports or re-exports by value (a type-only import or export is left out). */
function valueImports(file: string): string[] {
  const source = code(file);
  const found: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)'/g;
  for (const m of source.matchAll(statement)) {
    if (m[2]) continue;
    // `import { type A, type B } from` is type-only too
    const names = m[3].replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length && names.every((n) => n.startsWith('type '))) continue;
    found.push(m[4]);
  }
  for (const m of source.matchAll(/(?:^|\n)\s*import\s+'([^']+)'/g)) found.push(m[1]);
  for (const m of source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) found.push(m[1]);
  return found;
}

/** The forms that make a claim or basis without the builder, or reshape a built one (review S3). */
function handBuilt(source: string): string[] {
  const forms: Array<[string, RegExp]> = [
    ['a spread of a basis', /\.\.\.\s*(?:basis\(|[\w.]*[bB]asis\b)/],
    ['a cast', /\bas\s+(?:typeof\b|Claim\b|Basis\b|BuiltBasis\b)/],
    ['a value annotated as a claim or basis', /:\s*(?:readonly\s+)?(?:Claim|Basis|BuiltBasis)(?:\[\])*\s*=/],
    ['an array annotated as claims or bases', /:\s*(?:Readonly)?(?:Array)<(?:Claim|Basis|BuiltBasis)>\s*=/],
    ['a function returning a hand-made claim or basis', /\)\s*:\s*(?:Claim|Basis|BuiltBasis)(?:\[\])*\s*(?:\{|=>)/],
    ['satisfies', /\bsatisfies\s+(?:Claim|Basis|BuiltBasis)\b/],
    ['a generic cast', /<(?:Claim|Basis|BuiltBasis)>\s*[[{(]/],
  ];
  return forms.filter(([, re]) => re.test(source)).map(([name]) => name);
}

const moduleName = (specifier: string): string => path.basename(specifier).replace(/\.(js|ts)$/, '');

/**
 * The folders whose modules the landing page (the Morning Report, the Front Office) is built from: nothing in them may
 * reach the odds or the posture by any chain of imports (D-060), nor an AI module (D-001).
 */
const LANDING_FOLDERS = ['presentation', 'presentation/frontOffice', 'frontOffice'];
const LANDING = [...new Set(LANDING_FOLDERS.flatMap((folder) => filesUnder(folder)))].sort();

/** The server modules a file loads by value, directly or through others, each with the chain that reaches it. */
function reachable(file: string): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (at: string, chain: string): void => {
    if (seen.has(at)) return;
    seen.set(at, chain);
    for (const specifier of valueImports(at)) {
      if (!specifier.startsWith('.')) continue;
      const next = path.normalize(path.join(path.dirname(at), specifier)).replace(/\.js$/, '.ts');
      if (fs.existsSync(path.join(SERVER, next))) visit(next, `${chain} → ${next}`);
    }
  };
  visit(file, file);
  return seen;
}

const RATINGS = [/players_value/, /\boa_rating\b/, /\bpot_rating\b/, /\boverall_value\b/, /\btalent_value\b/, /\bvaluesByPlayer\b/,
  /batting_ratings_/, /pitching_ratings_/, /fielding_rating/, /running_ratings_/, /\bgloves\(/];

describe('the presentation boundary', () => {
  it('has files to check, so the checks cannot pass vacuously', () => {
    expect(PRESENTATION).toContain('presentation/claim.ts');
    expect(CONTRACT).toContain('contract/presentation.ts');
  });

  it.each(BOTH)('%s reads no rating column and no players_value', (file) => {
    for (const pattern of RATINGS) expect(code(file), `${file} matches ${pattern}`).not.toMatch(pattern);
  });

  it.each(BOTH)('%s imports no AI module by value', (file) => {
    const ai = valueImports(file).filter((s) => ['providers', 'ai', 'chat', 'storylines'].includes(moduleName(s)));
    expect(ai).toEqual([]);
  });

  it.each(LANDING)('%s reaches neither the postseason odds nor the deadline posture, by any chain of imports (D-060)', (file) => {
    const reached = reachable(file);
    expect(reached.get('posture.ts') ?? reached.get('playoffs.ts') ?? null).toBeNull();
  });

  it.each(LANDING)('%s reaches no AI module by value, by any chain of imports (D-001)', (file) => {
    const reached = reachable(file);
    const ai = ['providers.ts', 'ai.ts', 'chat.ts', 'storylines.ts'].map((m) => reached.get(m)).filter(Boolean);
    expect(ai).toEqual([]);
  });

  it('covers the landing page\'s folders when they exist: presentation now, frontOffice when Stage B makes it', () => {
    expect(LANDING_FOLDERS).toEqual(['presentation', 'presentation/frontOffice', 'frontOffice']);
    expect(LANDING.length).toBeGreaterThan(5);
  });

  it.each(PRESENTATION)('%s imports neither the postseason odds nor the deadline posture (D-060)', (file) => {
    const found = [...code(file).matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)]
      .map((m) => moduleName(m[1] ?? m[2]))
      .filter((name) => name === 'posture' || name === 'playoffs');
    expect(found).toEqual([]);
  });

  it.each(PRESENTATION.filter((f) => f !== 'presentation/claim.ts'))('%s builds claims only through claim() and basis()', (file) => {
    expect(handBuilt(code(file))).toEqual([]);
    // A file that states a certainty hands it to basis()
    if (/\bcertainty\s*:/.test(code(file))) expect(code(file), `${file} states a certainty without basis()`).toMatch(/\bbasis\(/);
  });

  it('catches every hand-built form the review found (S3): a spread, a cast, an annotated value, an array, a return type', () => {
    const forms = {
      spread: `claim({ text: 'x', tone: 'neutral', basis: { ...basis(input), unknown: [''] } })`,
      spreadVariable: `const b = { ...shared.basis, because: [] };`,
      returnType: `function headline(): Claim { return { text: 'x', tone: 'neutral', basis: b, links: [] }; }`,
      arrowReturn: `const f = (): Basis => ({ because: [] });`,
      arrayAnnotation: `const d: Claim[] = [{ text: 'x' }];`,
      genericArray: `const d: Array<Claim> = [];`,
      castTypeof: `const c = raw as typeof ok;`,
      castClaim: `const c = raw as Claim;`,
      satisfies: `const c = { text: 'x' } satisfies Claim;`,
      annotated: `const c: Claim = { text: 'x' };`,
    };
    for (const [name, snippet] of Object.entries(forms)) expect(handBuilt(snippet), name).not.toEqual([]);
    // What authors do write passes
    expect(handBuilt(`const headline = claim({ text: 'x', tone: 'good', basis: basis(input) });\nexport interface View { headline: Claim; rows: Claim[] }`)).toEqual([]);
  });

  it.each(BOTH)('%s writes nothing: no insert, update, delete or file write', (file) => {
    expect(code(file), file).not.toMatch(/\.run\(|\bINSERT\b|\bUPDATE\s|\bDELETE\s|writeFile|\bdb\.exec\(/);
  });

  it('is imported only by the modules that serve it, never by a specialist', () => {
    // The API and the v2 routes serve its words; the event stream names its import note
    const allowed = new Set(['api.ts', 'v2Routes.ts', 'serverEvents.ts']);
    const importers = filesUnder('')
      .filter((f) => !f.startsWith('presentation/') && !f.startsWith('contract/'))
      .filter((f) => /from\s+'\.\/presentation\//.test(code(f)));
    expect(importers.filter((f) => !allowed.has(f))).toEqual([]);
  });
});
