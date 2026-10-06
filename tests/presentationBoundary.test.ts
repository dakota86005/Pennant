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

  const ADAPTERS = filesUnder('presentation/frontOffice');

  it('has Front Office adapters to check', () => {
    expect(ADAPTERS).toEqual(expect.arrayContaining(['presentation/frontOffice/desk.ts', 'presentation/frontOffice/majorLeague.ts']));
  });

  it.each(ADAPTERS)('%s reads no table and loads no specialist: it words the answers the service hands it', (file) => {
    expect(code(file), file).not.toMatch(/\bdb\.|\.prepare\(|\btableExists\(|\btableColumns\(/);
    const specialists = valueImports(file).filter((s) => !s.startsWith('./') && !s.startsWith('../claim.js') && !s.startsWith('../severity.js')
      && !s.startsWith('../catalog.js') && !s.startsWith('../dataStatusWords.js'));
    expect(specialists, file).toEqual([]);
  });

  /**
   * The service reads each department's specialist through its public module (V2 plan section 4.4), and nothing else
   * reaches into a department: no rating module, no scouted evidence, no odds or posture of its own.
   */
  it.each(['frontOfficeService.ts', 'frontOfficeBuild.ts', 'frontOfficeWorker.ts'])('%s reads the specialists only through their public modules', (file) => {
    // `morningReport` is the Morning Report's own reader (N6): the masthead's and the profile's facts, and the roster map
    // through Player Value, Player State and the farm's door (`mlbEvidence`); its own imports are held below
    // `clubReport` is another club's report's reader (N7), held like `morningReport` below; `clubOwed` is the club question
    // still open (no specialist: it says whether the automatic club may be served as chosen)
    // `farmViewsBuild` is Farm & Development's views' reader (N10), run by the same worker; its own imports are held in
    // farmViews.test.ts; `clubhouseViewsBuild` is Major League Ops' clubhouse tools' reader (N9), held below;
    // `playerDossierBuild` is the player window's reader (N11), run by the same worker; its own imports are held below
    const PUBLIC = new Set([
      'clubOwed', 'clubReport', 'contracts', 'config', 'dashboard', 'dataStatus', 'db', 'farmOperations', 'farmViewsBuild', 'clubhouseViewsBuild',
      'playerDossierBuild', 'frontOfficeBuild', 'leagueRules',
      // N12: Finance's and Medical's views' reader, run by the same worker; its own imports are held below
      'officeViewsBuild',
      'mlbOperations', 'morningReport', 'org', 'payroll', 'playerStateRoutes', 'rosterops', 'saveCalibration', 'serverEvents', 'valuation',
      'viewingOrganization',
    ]);
    const outside = valueImports(file)
      .filter((s) => s.startsWith('./') && !s.startsWith('./presentation/'))
      .map(moduleName)
      .filter((m) => !PUBLIC.has(m));
    expect(outside).toEqual([]);
  });

  /**
   * The Morning Report's reader (N6) asks each specialist through its public door and nothing else: the season's facts and
   * the profile from the landing folder's own readers, value and control from Player Value's entry point, where a player
   * is from Player State, the farm's next man through `mlbEvidence` (the farm's one door, D-045). It reads no rating, no
   * philosophy, no stakes tier and no odds or posture of its own.
   */
  it('morningReport.ts reads the specialists only through their public doors', () => {
    const allowed = new Set(['db', 'dataStatus', 'clubProfile', 'rosterMap', 'teamSeason', 'mlbEvidence', 'playerValue', 'playerState']);
    const outside = valueImports('morningReport.ts').filter((s) => s.startsWith('./')).map(moduleName).filter((m) => !allowed.has(m));
    expect(outside).toEqual([]);
    const source = code('morningReport.ts');
    for (const pattern of [...RATINGS, /developmentalContext|protectionTier|evaluateDevelopmentProtection/, /philosophy|settings\.js|posture|playoffs|oddsModel|clubWinValue|winValueOf/]) {
      expect(source, `morningReport.ts matches ${pattern}`).not.toMatch(pattern);
    }
  });

  /**
   * Another club's report's reader (N7, D-059, case 19) asks the same doors as the Morning Report's, and reads the club's
   * players' ability only through `scoutedEvidence.ts` (our organization's scouting, D-017): no rating column, no
   * `players_value`, no philosophy, no odds or posture of its own.
   */
  it('clubReport.ts reads another club only through the Morning Report\'s reader and our scouting', () => {
    const allowed = new Set(['db', 'dashboard', 'dataFreshness', 'dataStatus', 'morningReport', 'scoutedEvidence']);
    const outside = valueImports('clubReport.ts').filter((s) => s.startsWith('./')).map(moduleName).filter((m) => !allowed.has(m));
    expect(outside).toEqual([]);
    const source = code('clubReport.ts');
    for (const pattern of [...RATINGS, /developmentalContext|protectionTier/, /philosophy|posture|playoffs|oddsModel/]) {
      expect(source, `clubReport.ts matches ${pattern}`).not.toMatch(pattern);
    }
  });

  /**
   * Farm & Development's views' reader (N10) words what the farm, Player Development and the save's rating history
   * already decided: it loads only their public modules, reads no rating and no philosophy of its own (philosophy is
   * inside the farm's answer, after Player Development's, D-019), no developmental stakes outside the farm's answer
   * (D-050), and no odds, posture or AI (D-001, D-060). Its one setting is how the GM shows a rating.
   */
  it('farmViewsBuild.ts reads the specialists only through their public modules', () => {
    // N11: the evidence module, for one thing only: whether a player's grades are OSA's view filling in (the rows' mark)
    const allowed = new Set(['org', 'dataStatus', 'farmConsequence', 'farmOperations', 'history', 'scoutedDevelopment', 'scoutedEvidence', 'settings', 'valuation']);
    const outside = valueImports('farmViewsBuild.ts').filter((s) => s.startsWith('./') && !s.startsWith('./presentation/')).map(moduleName)
      .filter((m) => !allowed.has(m));
    expect(outside).toEqual([]);
    const source = code('farmViewsBuild.ts');
    expect([...source.matchAll(/import \{([^}]*)\} from '\.\/scoutedEvidence\.js'/g)].map((m) => m[1].trim())).toEqual(['ratingFillOf']);
    for (const pattern of [
      ...RATINGS,
      /developmentalContext|openDevelopmentalContext|evaluateDevelopmentProtection/,
      /philosophy|Philosophy|assignmentPreference|resolvePhilosophy/,
      /posture|playoffs|oddsModel/,
    ]) {
      expect(source, `farmViewsBuild.ts matches ${pattern}`).not.toMatch(pattern);
    }
    // Its one setting is the rating display (rounded to fives or not)
    expect([...source.matchAll(/loadSettings\(\)\.(\w+)/g)].map((m) => m[1])).toEqual(['roundRatingsToFive']);
    expect(valueImports('farmViewsBuild.ts').filter((s) => ['providers', 'ai', 'chat', 'storylines'].includes(moduleName(s)))).toEqual([]);
  });

  /**
   * The player window's reader (N11) asks each specialist through its public door: the card's dossier (`player`), Player
   * Value's entry point (the cone, the surplus and our view, handed the viewing club's philosophy as `ourViewRoutes` hands
   * it), Player State, the log through the data status, the rating history, and the evidence's source words. It reads
   * no rating column, no stakes tier, and no odds or posture (D-060).
   */
  it('playerDossierBuild.ts reads the specialists only through their public doors', () => {
    const allowed = new Set(['db', 'dataStatus', 'history', 'philosophy', 'player', 'playerValue', 'playerState', 'scoutedEvidence', 'settings', 'valuation']);
    const outside = valueImports('playerDossierBuild.ts').filter((s) => s.startsWith('./') && !s.startsWith('./presentation/')).map(moduleName)
      .filter((m) => !allowed.has(m));
    expect(outside).toEqual([]);
    const source = code('playerDossierBuild.ts');
    for (const pattern of [...RATINGS, /developmentalContext|evaluateDevelopmentProtection/, /posture|playoffs|oddsModel|clubWinValue/]) {
      expect(source, `playerDossierBuild.ts matches ${pattern}`).not.toMatch(pattern);
    }
    expect([...source.matchAll(/import \{([^}]*)\} from '\.\/scoutedEvidence\.js'/g)].map((m) => m[1].trim())).toEqual(['ratingSource']);
    expect([...source.matchAll(/loadSettings\(\)\.(\w+)/g)].map((m) => m[1])).toEqual(['roundRatingsToFive']);
  });

  /**
   * Major League Ops' clubhouse tools' reader (N9, D-069) reads what the React pages' routes compute, through their
   * extracted modules, and nothing else: no rating of its own beyond OSA's per-player mark (D-067), no philosophy, no
   * developmental stakes, no odds or posture, no AI. Its one setting is how the GM shows a rating.
   */
  /**
   * Finance's and Medical's views (N12, D-071) read the React pages' routes' modules (Payroll, Contracts, Free Agents,
   * the injury report), Club Finances and the price of a win through Player Value's entry point and its snapshot reader,
   * the farm's next men through Major League Ops' door to the farm (`mlbEvidence`, as the roster map does), Player State,
   * and OSA's per-player mark; never the developmental stakes, the odds or the posture (D-050, D-060), or an AI.
   */
  it('officeViewsBuild.ts reads only the routes\' modules and the specialists\' public doors', () => {
    const allowed = new Set([
      'contracts', 'dashboard', 'dataStatus', 'freeagents', 'mlbEvidence', 'payroll', 'playerState', 'playerValue', 'playerValueSnapshot', 'scoutedEvidence',
    ]);
    const outside = valueImports('officeViewsBuild.ts').filter((s) => s.startsWith('./') && !s.startsWith('./presentation/')).map(moduleName)
      .filter((m) => !allowed.has(m));
    expect(outside).toEqual([]);
    const source = code('officeViewsBuild.ts');
    expect([...source.matchAll(/import \{([^}]*)\} from '\.\/scoutedEvidence\.js'/g)].map((m) => m[1].trim())).toEqual(['ratingFillOf']);
    for (const pattern of [/developmentalContext|evaluateDevelopmentProtection/, /posture|playoffs|oddsModel|deadlineRead|playoffPicture|clubWinValue/, /\bai\b|aiProvider|chat\.js/]) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('clubhouseViewsBuild.ts reads only the routes\' extracted modules', () => {
    const allowed = new Set([
      'dashboard', 'dataStatus', 'gameplan', 'lineup', 'org', 'pitching', 'roster', 'rosterops', 'schedule', 'scoutedEvidence', 'settings', 'trends', 'valuation',
    ]);
    const outside = valueImports('clubhouseViewsBuild.ts').filter((s) => s.startsWith('./') && !s.startsWith('./presentation/')).map(moduleName)
      .filter((m) => !allowed.has(m));
    expect(outside).toEqual([]);
    const source = code('clubhouseViewsBuild.ts');
    // From the evidence module, only the per-player mark of OSA's view filling in for our scouts
    expect([...source.matchAll(/import \{([^}]*)\} from '\.\/scoutedEvidence\.js'/g)].map((m) => m[1].trim())).toEqual(['ratingFillOf']);
    for (const pattern of [
      /developmentalContext|openDevelopmentalContext|evaluateDevelopmentProtection/,
      /philosophy|Philosophy|assignmentPreference|resolvePhilosophy/,
      /posture|playoffs|oddsModel|deadlineRead|playoffPicture/,
    ]) {
      expect(source, `clubhouseViewsBuild.ts matches ${pattern}`).not.toMatch(pattern);
    }
    expect([...source.matchAll(/loadSettings\(\)\.(\w+)/g)].map((m) => m[1])).toEqual(['roundRatingsToFive']);
    expect(valueImports('clubhouseViewsBuild.ts').filter((s) => ['providers', 'ai', 'chat', 'storylines'].includes(moduleName(s)))).toEqual([]);
  });

  /** The farm's views name the farm's parts through its public module only (N10): no farm module reached past it. */
  it.each(filesUnder('presentation/farm'))('%s names the farm\'s parts only through farmOperations', (file) => {
    const farmModules = [...code(file).matchAll(/from\s+'\.\.\/\.\.\/(farm\w*|playingTime)\.js'/g)].map((m) => m[1]);
    expect(farmModules.filter((m) => m !== 'farmOperations' && m !== 'farmConsequence')).toEqual([]);
  });

  it('keeps the Front Office service to the routes, the start and the import: no specialist calls it', () => {
    const importers = (name: string) => filesUnder('')
      .filter((f) => new RegExp(`from\\s+'\\./${name}\\.js'`).test(code(f)));
    // N7: the attention put on the Front Office when served, and Around the League (the club reports it builds), are
    // served views over it, like the routes; no specialist calls either
    // N10: the farm's views are kept on the Front Office's inputs and built in its worker, a served view like the others
    // N9: Major League Ops' clubhouse tools, kept and built the same way; N11: the player window's dossiers are kept on
    // the Front Office's inputs and our club's built in its worker
    expect(importers('frontOfficeService').sort()).toEqual([
      'api.ts', 'aroundTheLeague.ts', 'clubhouseViewService.ts', 'farmViewService.ts', 'frontOfficeAttention.ts', 'index.ts', 'officeViewService.ts',
      'playerViewService.ts', 'v2Routes.ts',
    ]);
    // N12: Finance's and Medical's views, kept and built the same way
    expect(importers('officeViewService').sort()).toEqual(['v2Routes.ts']);
    expect(importers('officeViewsBuild').sort()).toEqual(['frontOfficeBuild.ts', 'frontOfficeWorker.ts', 'officeViewService.ts']);
    expect(code('frontOfficeBuild.ts')).not.toMatch(/import \{[^}]*\} from '\.\/officeViewsBuild\.js'/);
    expect(importers('farmViewService').sort()).toEqual(['v2Routes.ts']);
    expect(importers('clubhouseViewService').sort()).toEqual(['v2Routes.ts']);
    expect(importers('clubhouseViewsBuild').sort()).toEqual(['clubhouseViewService.ts', 'frontOfficeBuild.ts', 'frontOfficeWorker.ts']);
    expect(code('frontOfficeBuild.ts')).toMatch(/import type \{[^}]*\} from '\.\/clubhouseViewsBuild\.js'/);
    expect(code('frontOfficeBuild.ts')).not.toMatch(/import \{[^}]*\} from '\.\/clubhouseViewsBuild\.js'/);
    expect(importers('playerViewService').sort()).toEqual(['v2Routes.ts']);
    expect(importers('playerDossierBuild').sort()).toEqual(['frontOfficeBuild.ts', 'frontOfficeWorker.ts', 'playerViewService.ts']);
    expect(code('frontOfficeBuild.ts')).toMatch(/import type \{[^}]*\} from '\.\/playerDossierBuild\.js'/);
    expect(code('frontOfficeBuild.ts')).not.toMatch(/import \{[^}]*\} from '\.\/playerDossierBuild\.js'/);
    // frontOfficeBuild.ts names the farm's two jobs in the worker's one list of jobs (`WorkerJob`), by type only
    expect(importers('farmViewsBuild').sort()).toEqual(['farmViewService.ts', 'frontOfficeBuild.ts', 'frontOfficeWorker.ts']);
    expect(code('frontOfficeBuild.ts')).toMatch(/import type \{[^}]*\} from '\.\/farmViewsBuild\.js'/);
    expect(code('frontOfficeBuild.ts')).not.toMatch(/import \{[^}]*\} from '\.\/farmViewsBuild\.js'/);
    expect(importers('frontOfficeAttention').sort()).toEqual(['api.ts', 'v2Routes.ts']);
    // N11: the player window's notes read and write through Following's door (a note lives on the follow)
    expect(importers('aroundTheLeague').sort()).toEqual(['frontOfficeAttention.ts', 'playerViewService.ts', 'v2Routes.ts']);
    expect(importers('frontOfficeBuild').sort()).toEqual(['frontOfficeService.ts', 'frontOfficeWorker.ts']);
  });

  it('is imported only by the modules that serve it, never by a specialist', () => {
    // The API and the v2 routes serve its words; the event stream names its import note; the theme pack store reads the
    // pack files and hands them to the pack check (D-062)
    // N7: the served views that put the GM's attention on the Front Office, Around the League, and search's index (the
    // catalog's views)
    // N10: Farm & Development's views, read in the build and kept by their service; N9: Major League Ops' clubhouse tools
    const allowed = new Set(['api.ts', 'v2Routes.ts', 'serverEvents.ts', 'frontOfficeService.ts', 'frontOfficeBuild.ts', 'themePackStore.ts',
      'frontOfficeAttention.ts', 'aroundTheLeague.ts', 'search.ts', 'farmViewsBuild.ts', 'farmViewService.ts', 'clubhouseViewsBuild.ts',
      'clubhouseViewService.ts',
      // N11: the player window's views, read in the build and kept by their service
      'playerDossierBuild.ts', 'playerViewService.ts',
      // N12: Finance's and Medical's views, read in the build and kept by their service
      'officeViewsBuild.ts', 'officeViewService.ts']);
    const importers = filesUnder('')
      .filter((f) => !f.startsWith('presentation/') && !f.startsWith('contract/'))
      .filter((f) => /from\s+'\.\/presentation\//.test(code(f)));
    expect(importers.filter((f) => !allowed.has(f))).toEqual([]);
  });
});
