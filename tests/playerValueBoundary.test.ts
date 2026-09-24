import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The Player Value boundary (D-052, docs/PLAYER_VALUE.md Part 10), static, in the family of
 * evidenceBoundary.test.ts, developmentalStakesBoundary.test.ts and farmOperationsBoundary.test.ts.
 *
 * Runtime tests prove today's code honours it; this proves the next change does. It reads the server
 * source through the TypeScript parser (hardening, A-16): comments are blanked by the parser, so a
 * comment marker inside a string hides no code; every import is seen, whatever its quotes, whether it
 * is static, dynamic (`import()`) or `require`, a bare package or a file in a subdirectory; and every
 * database call is inspected by its receiver and its SQL, whatever the SQL's case or quoting. Each
 * hardened check was shown to fail on a deliberate mutation of the code it guards.
 *
 * Phase 1 built contract facts and control; phase 2 Club Finances, the opening price of a win and
 * the per-import market snapshot; phase 3a expected production from major-league results, fitted
 * per save (D-053); phase 3b expected production from scouted ratings, which arrive only through
 * `scoutedEvidence.ts` (D-017). Two modules write, and only to history.db: the market snapshot and the
 * fit store. The allow-lists below grow phase by phase: the imports a value module may make and the
 * consumers migrated to the entry point. The `players_value` allow-list in evidenceBoundary.test.ts
 * shrinks as each consumer moves (Part 8). To add a module or a consumer, add it to the list it
 * belongs to; nothing else here should need to change.
 */

const SERVER = path.join(process.cwd(), 'server');

// ── reading the source ───────────────────────────────────────────────────────

/** Every .ts file under server/, recursively, as a path relative to it ("x.ts", "sub/y.ts"). */
const SERVER_FILES: string[] = (() => {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.ts')) out.push(`${prefix}${entry.name}`);
    }
  };
  walk(SERVER, '');
  return out.sort();
})();

const memo = <T>(f: (file: string) => T) => {
  const cache = new Map<string, T>();
  return (file: string): T => {
    if (!cache.has(file)) cache.set(file, f(file));
    return cache.get(file) as T;
  };
};

const sourceOf = memo((file) => fs.readFileSync(path.join(SERVER, file), 'utf8'));
const astOf = memo((file) => ts.createSourceFile(file, sourceOf(file), ts.ScriptTarget.Latest, true));

/** Every node of a file, depth first. */
const nodesOf = memo((file) => {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => { out.push(n); ts.forEachChild(n, visit); };
  visit(astOf(file));
  return out;
});

/**
 * The source with every comment blanked (newlines kept, so positions and lines hold). The comments are
 * the parser's trivia, never a regular expression's guess: `'a // b'` and `` `/* x *\/` `` are text.
 */
const code = memo((file) => {
  const text = sourceOf(file);
  const sf = astOf(file);
  const chars = text.split('');
  const seen = new Set<number>();
  const blank = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? []) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      for (let i = r.pos; i < r.end; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
    }
  };
  const visit = (n: ts.Node) => {
    blank(ts.getLeadingCommentRanges(text, n.pos));
    blank(ts.getTrailingCommentRanges(text, n.end));
    for (const child of n.getChildren(sf)) visit(child);
  };
  visit(sf);
  return chars.join('');
});

interface ImportRecord { spec: string; typeOnly: boolean; dynamic: boolean }

/** Every import of a file: static, `export … from`, `import x = require()`, dynamic `import()`, `require()` and type imports. */
const importRecordsOf = memo((file): { records: ImportRecord[]; nonLiteral: string[] } => {
  const records: ImportRecord[] = [];
  const nonLiteral: string[] = [];
  const sf = astOf(file);
  for (const n of nodesOf(file)) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const clause = n.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
      const typeOnly = !!clause && (clause.isTypeOnly
        || (!clause.name && named !== null && named.length > 0 && named.every((e) => e.isTypeOnly)));
      records.push({ spec: n.moduleSpecifier.text, typeOnly, dynamic: false });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      records.push({ spec: n.moduleSpecifier.text, typeOnly: n.isTypeOnly, dynamic: false });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const e = n.moduleReference.expression;
      if (ts.isStringLiteral(e)) records.push({ spec: e.text, typeOnly: n.isTypeOnly, dynamic: false });
      else nonLiteral.push(n.getText(sf));
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      records.push({ spec: n.argument.literal.text, typeOnly: true, dynamic: false });
    } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      const arg = n.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) records.push({ spec: arg.text, typeOnly: false, dynamic: true });
      else nonLiteral.push(n.getText(sf).slice(0, 80));
    }
  }
  return { records, nonLiteral };
});

/** The module specifiers a file imports, in any form ("./db.js", "express", "../x.js"). */
const importsOf = (file: string): string[] => importRecordsOf(file).records.map((r) => r.spec);

/** A relative import resolved to a server file ("playerValueControl.js" from "./" or "../server/"), or null for a package. */
const resolvedOf = (file: string, spec: string): string | null =>
  spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : null;

/** Every string a file holds: literals and templates (a substitution reads `${…}`). */
const stringsOf = memo((file): string[] => {
  const out: string[] = [];
  for (const n of nodesOf(file)) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text + n.templateSpans.map((s) => `\${…}${s.literal.text}`).join(''));
  }
  return out;
});

/**
 * What SQL an argument can be, following a template's leading substitution, an identifier or a
 * conditional to the declarations in the same file. Null where it cannot be established: an SQL the
 * test cannot read is treated as a write.
 */
function sqlCandidates(file: string, e: ts.Expression, depth = 0): string[] | null {
  if (depth > 6) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isParenthesizedExpression(e)) return sqlCandidates(file, e.expression, depth + 1);
  if (ts.isConditionalExpression(e)) {
    const a = sqlCandidates(file, e.whenTrue, depth + 1);
    const b = sqlCandidates(file, e.whenFalse, depth + 1);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(e)) {
    // Lexical scope: the declaration in the innermost block that encloses the use
    const scopeOf = (n: ts.Node): ts.Node => {
      let at: ts.Node = n.parent;
      while (!ts.isBlock(at) && !ts.isSourceFile(at) && !ts.isModuleBlock(at)) at = at.parent;
      return at;
    };
    const visible = nodesOf(file)
      .filter((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text && !!n.initializer)
      .map((d) => ({ d, scope: scopeOf(d) }))
      .filter(({ scope }) => scope.pos <= e.pos && e.end <= scope.end)
      .sort((a, b) => b.scope.pos - a.scope.pos);
    if (visible.length === 0) return null;
    return sqlCandidates(file, visible[0].d.initializer as ts.Expression, depth + 1);
  }
  if (ts.isTemplateExpression(e)) {
    const rest = e.templateSpans.map((s) => `\${…}${s.literal.text}`).join('');
    if (e.head.text.trim().length > 0) return [e.head.text + rest];
    // The statement's first word is a substitution: what can it be?
    const first = sqlCandidates(file, e.templateSpans[0].expression, depth + 1);
    const after = e.templateSpans[0].literal.text + e.templateSpans.slice(1).map((s) => `\${…}${s.literal.text}`).join('');
    return first ? first.map((f) => f + after) : null;
  }
  return null;
}

/** A statement that cannot write: a SELECT (better-sqlite3 prepares one statement), or reading a table's columns. */
const READ_ONLY_SQL = /^\s*(SELECT\b|PRAGMA\s+table_x?info\b)/i;
/** The first word of a statement that writes. */
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA\s+\w+\s*=)\b/i;

/** Database methods that execute or configure rather than prepare. */
const EXECUTING = new Set(['exec', 'run', 'pragma', 'transaction', 'backup', 'serialize', 'loadExtension', 'function', 'aggregate', 'table', 'unsafeMode']);

interface DbCall { receiver: string; method: string; sql: string[] | null; text: string }

/** Every call of a database method (`x.prepare(…)`, `x['exec'](…)`), with its receiver and what its SQL can be. */
const dbCallsOf = memo((file): DbCall[] => {
  const sf = astOf(file);
  const out: DbCall[] = [];
  for (const n of nodesOf(file)) {
    if (!ts.isCallExpression(n)) continue;
    const callee = n.expression;
    let method: string | null = null;
    let receiver: ts.Expression | null = null;
    if (ts.isPropertyAccessExpression(callee)) { method = callee.name.text; receiver = callee.expression; }
    else if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
      method = callee.argumentExpression.text; receiver = callee.expression;
    }
    if (method === null || receiver === null || (method !== 'prepare' && !EXECUTING.has(method))) continue;
    const arg = n.arguments[0];
    out.push({ receiver: receiver.getText(sf), method, sql: arg ? sqlCandidates(file, arg) : null, text: n.getText(sf).replace(/\s+/g, ' ').slice(0, 90) });
  }
  return out;
});

/** A module-level declaration whose value is a number of its own (a literal, arithmetic of literals, or an object or array holding one). */
const ownNumbersOf = memo((file): string[] => {
  const numeric = (e: ts.Expression): boolean => {
    if (ts.isNumericLiteral(e)) return true;
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) return numeric(e.expression);
    if (ts.isPrefixUnaryExpression(e)) return numeric(e.operand);
    if (ts.isBinaryExpression(e)) return numeric(e.left) && numeric(e.right);
    return false;
  };
  // Inside an object or array, 0 and 1 are structure (none, all, a share of one), not a tunable
  const structural = (e: ts.Expression) => ts.isNumericLiteral(e) && (e.text === '0' || e.text === '1');
  const holds = (e: ts.Expression, top = false): boolean => {
    if (numeric(e)) return top || !structural(e);
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return holds(e.expression, top);
    if (ts.isObjectLiteralExpression(e)) return e.properties.some((p) => ts.isPropertyAssignment(p) && holds(p.initializer));
    if (ts.isArrayLiteralExpression(e)) return e.elements.some((x) => holds(x));
    return false;
  };
  const sf = astOf(file);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) if (d.initializer && holds(d.initializer, true)) out.push(d.name.getText(sf));
  }
  return out;
});

// ── the modules and the allow-lists ──────────────────────────────────────────

/** Every Player Value module, found by name so a new one is covered the day it is added. */
const VALUE_MODULES = SERVER_FILES.filter((f) => /^playerValue[A-Za-z]*\.ts$/.test(f));

/** What a value module may import in phase 3b: proneness only through its reader, ratings only through the adapter (below). */
const ALLOWED_IMPORTS = new Set([
  './dataFreshness.js', './leagueRules.js', './playerRights.js', './playerState.js', './provenance.js',
  './calibration.js', './playerValue.js', './playerValueCalibration.js', './playerValueContract.js', './playerValueControl.js',
  './playerValueFinances.js', './playerValueHistory.js', './playerValueProduction.js', './playerValueProductionFit.js',
  './playerValueFitStore.js', './injuryProneness.js', './playerValueRatings.js', './playerValueRatingsFit.js', './playerValueCone.js',
  './playerValueCost.js', './playerValueSignings.js', './playerValueContractStore.js', './playerValueSurplus.js',
]);

/** The modules that open league.db at all: the readers, the snapshot writer (its game date) and the route (a table check). The pure modules never do. */
const DB_READERS = ['playerValue.ts', 'playerValueHistory.ts', 'playerValueSnapshot.ts', 'playerValueRoutes.ts'];

/** Packages a value module may import: the router its routes mount on. Nothing else (no fs, no database driver). */
const PACKAGE_IMPORTS: Record<string, string[]> = {
  'playerValueRoutes.ts': ['express'],
  // The refit runs off the event loop (A-17): the entry point starts the worker, the worker reports back
  'playerValue.ts': ['node:worker_threads'],
  'playerValueRefitWorker.ts': ['node:worker_threads'],
};

/** Phase 3b: the modules that may name the adapter at all. Only the reader loads ratings; the pure ratings modules take its types. */
const ADAPTER_READER = 'playerValue.ts';
const ADAPTER_TYPES_ONLY = ['playerValueRatings.ts', 'playerValueRatingsFit.ts'];

/** The ratings modules (phase 3b). */
const RATINGS_MODULES = ['playerValueRatings.ts', 'playerValueRatingsFit.ts'];

/** The writers, and the one extra import they alone may make: the history store (Part 7, D-009, D-053). */
const SNAPSHOT_WRITER = 'playerValueSnapshot.ts';
const FIT_STORE = 'playerValueFitStore.ts';
/** Phase 4b: the per-import contract snapshot, the third writer (history.db only). */
const CONTRACT_STORE = 'playerValueContractStore.ts';
const WRITERS = [CONTRACT_STORE, FIT_STORE, SNAPSHOT_WRITER];
const WRITER_IMPORTS = new Set(['./history.js']);

/** The production modules (phase 3a). */
const PRODUCTION_MODULES = ['playerValueProduction.ts', 'playerValueProductionFit.ts', 'playerValueHistory.ts', 'playerValueFitStore.ts'];

/** Consumers migrated to the entry point, phase by phase (Part 8). Phase 1: control. Phase 2: club finances. */
const MIGRATED_CONSUMERS = ['contracts.ts', 'payroll.ts', 'trade.ts', 'player.ts', 'freeagents.ts', 'clubFinanceRoutes.ts', 'playerValueRoutes.ts'];

/** Who may call the snapshot writer: the import, and the one route that serves the history. */
const SNAPSHOT_CALLERS = ['api.ts', 'clubFinanceRoutes.ts'];

/** Who may mount the Player Value routes. */
const ROUTE_MOUNTERS = ['api.ts'];

/**
 * Service arithmetic of a consumer's own: service divided, multiplied or taken modulo, in any spelling
 * (`service.low / perYear`, `svc.days % perYear`), or anything divided by a year length. Reading the
 * exported service columns for display is an objective fact and is not arithmetic.
 */
const SERVICE_ARITHMETIC = /\b(?:\w*service\w*|\w*Service\w*|svc\w*)(?:\.\w+|\[[^\]]+\])*\s*[/*%](?![/*])|[/*%]\s*(?:\w*[pP]erYear|\w*[yY]earLength|SERVICE_DAYS_PER_YEAR)\b|\bSERVICE_DAYS_PER_YEAR\b|\bserviceRemainingThisSeason\b/g;

/** A query of the contract tables: a migrated consumer reads contract facts through the entry point (Part 8). */
const CONTRACT_QUERY = /\b(?:FROM|JOIN)\s+players_contract(?:_extension)?\b/gi;

/**
 * Known violations whose fix belongs to another change, each with its finding. Each is asserted to be
 * STILL there, exactly as listed: when the fix lands the entry fails and is removed, and a new violation
 * in the same file is not hidden by it. The list only empties.
 */
const PENDING: Array<{ check: 'service' | 'contract-query'; file: string; matches: string[]; finding: string }> = [
  { check: 'contract-query', file: 'player.ts', matches: ['FROM players_contract'], finding: 'unassigned (A-16 sweep): the player card reads players_contract directly' },
];

/** The matches of a check in a consumer, as text; a pending entry is compared with them exactly. */
function consumerMatches(check: 'service' | 'contract-query', file: string): string[] {
  if (check === 'service') return [...code(file).matchAll(SERVICE_ARITHMETIC)].map((m) => m[0].trim());
  return stringsOf(file).flatMap((s) => [...s.matchAll(CONTRACT_QUERY)].map((m) => m[0].replace(/\s+/g, ' ')));
}

describe('the Player Value boundary', () => {
  it('finds the value modules', () => {
    expect(VALUE_MODULES).toEqual([
      'playerValue.ts', 'playerValueCalibration.ts', 'playerValueCone.ts', 'playerValueContract.ts', 'playerValueContractStore.ts',
      'playerValueControl.ts', 'playerValueCost.ts', 'playerValueFinances.ts', 'playerValueFitStore.ts', 'playerValueHistory.ts',
      'playerValueProduction.ts', 'playerValueProductionFit.ts', 'playerValueRatings.ts', 'playerValueRatingsFit.ts', 'playerValueRefitWorker.ts',
      'playerValueRoutes.ts', 'playerValueSignings.ts', 'playerValueSnapshot.ts', 'playerValueSurplus.ts',
    ]);
  });

  it('reads the source the way the compiler does: a comment marker in a string hides no code, and every import form is seen', () => {
    // The helpers are the enforcement, so they are pinned on the forms a regular expression missed (A-16)
    const probe = 'probe.ts';
    const text = [
      "const a = 'x // y'; db.exec('DROP TABLE t');",
      'const s = `/* not a comment */`; // a real comment: db.exec(\'hidden\')',
      'import { p } from "./philosophy.js";',
      "const m = await import('./settings.js');",
      "const r = require('./staffPreference.js');",
      "export { q } from './developmentFit.js';",
    ].join('\n');
    const sf = ts.createSourceFile(probe, text, ts.ScriptTarget.Latest, true);
    const blanked = (() => {
      const chars = text.split('');
      const visit = (n: ts.Node) => {
        for (const r of [...(ts.getLeadingCommentRanges(text, n.pos) ?? []), ...(ts.getTrailingCommentRanges(text, n.end) ?? [])]) {
          for (let i = r.pos; i < r.end; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
        }
        for (const c of n.getChildren(sf)) visit(c);
      };
      visit(sf);
      return chars.join('');
    })();
    expect(blanked).toMatch(/db\.exec\('DROP TABLE t'\)/);
    expect(blanked).toMatch(/\/\* not a comment \*\//);
    expect(blanked).not.toMatch(/hidden/);
    // The real helpers on the real tree: every value module parses and yields its imports
    for (const file of VALUE_MODULES) expect(importsOf(file).length, file).toBeGreaterThan(0);
    expect(SERVER_FILES.length).toBeGreaterThan(VALUE_MODULES.length);
  });

  it.each(VALUE_MODULES)('%s imports only what phase 3b allows, in any form (static, dynamic, require, package)', (file) => {
    const { records, nonLiteral } = importRecordsOf(file);
    expect(nonLiteral, `${file} imports a module it names at run time`).toEqual([]);
    const outside = records.map((r) => r.spec).filter((i) =>
      !ALLOWED_IMPORTS.has(i)
      && !(i === './db.js' && DB_READERS.includes(file))
      && !(WRITERS.includes(file) && WRITER_IMPORTS.has(i))
      && !(PACKAGE_IMPORTS[file] ?? []).includes(i)
      && !(i === './scoutedEvidence.js' && (file === ADAPTER_READER || ADAPTER_TYPES_ONLY.includes(file))));
    expect(outside, `${file} imports ${outside.join(', ')}`).toEqual([]);
  });

  it('ratings reach Player Value only through the adapter: the reader loads them, the pure ratings modules take its types only (3b, D-017)', () => {
    const naming = VALUE_MODULES.filter((f) => importsOf(f).includes('./scoutedEvidence.js'));
    expect(naming.sort()).toEqual([ADAPTER_READER, ...ADAPTER_TYPES_ONLY].sort());
    for (const file of ADAPTER_TYPES_ONLY) {
      // A type import only: nothing from the adapter runs in the pure modules
      const adapter = importRecordsOf(file).records.filter((r) => r.spec === './scoutedEvidence.js');
      expect(adapter.length, file).toBeGreaterThan(0);
      for (const r of adapter) expect(r.typeOnly && !r.dynamic, file).toBe(true);
    }
    // The reader loads ability, splits, running and the glove at his position through the adapter's loaders
    expect(code(ADAPTER_READER)).toMatch(/loadScoutedAbilities\(/);
    expect(code(ADAPTER_READER)).toMatch(/loadScoutedHitterProfiles\(/);
    expect(code(ADAPTER_READER)).toMatch(/loadScoutedGlovesAtPosition\(/);
    expect(code(ADAPTER_READER)).toMatch(/loadScoutedObservations\(/);
    // ...and nobody reads the rating snapshots' table but the adapter
    for (const file of VALUE_MODULES) expect(code(file), file).not.toMatch(/rating_snapshots/);
  });

  it('no minor-league WAR: the minor-league reader selects usage only, and the arrival history carries none (3b, Q-9)', () => {
    const history = code('playerValueHistory.ts');
    const columns = history.match(/const MINOR_USAGE_COLUMNS = \[([^\]]*)\]/);
    expect(columns).not.toBeNull();
    expect(columns![1]).not.toMatch(/war/i);
    const reader = history.slice(history.indexOf('export function minorLeagueUsage'), history.indexOf('export function affiliatedLevels'));
    expect(reader.length).toBeGreaterThan(0);
    expect(reader).not.toMatch(/\bwar\b|ra9war/i);
    // The major-league reader sums WAR at the major-league level only (level 1, or an independent market league's own top level)
    expect(history).toMatch(/const where = \[levelWhere\.sql, `split_id = 1`/);
    expect(history).toMatch(/sql: 'level_id = 1'/);
    // The ratings fit's arrival history is usage: no WAR field anywhere in it
    const fit = code('playerValueRatingsFit.ts');
    const arrival = fit.slice(fit.indexOf('export interface ArrivalPlayer'), fit.indexOf('}', fit.indexOf('export interface ArrivalPlayer')));
    expect(arrival).not.toMatch(/war/i);
    // ...and nothing reads a WAR off the minor-league usage it is handed (a message may say so; a read may not)
    for (const file of RATINGS_MODULES) expect(code(file), file).not.toMatch(/(minors|minor)\b[^;`]*(\.war\b|\[['"`]war['"`]\])/);
  });

  it.each(RATINGS_MODULES)('%s (ratings, phase 3b) names no rating column, no players_value, no philosophy, no tier and no defensibility', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(/_ratings_|fielding_rating|players_batting\b|players_pitching\b|players_fielding\b|players_value|overall_value|talent_value/);
    expect(importsOf(file).join(' '), file).not.toMatch(/philosophy|settings|staffPreference|assignmentPreference|developmentFit|developmentalContext|prospectDecision|prospectAssignments|destinationFit|db\.js|history\.js/);
  });

  it('Club Finances reads no ratings, no players_value and no scouting at all: it needs none', () => {
    for (const file of ['playerValueFinances.ts', 'playerValueSnapshot.ts', 'playerValueSignings.ts', 'playerValueContractStore.ts']) {
      const source = code(file);
      expect(source, file).not.toMatch(/scoutedEvidence|_ratings_|players_value|overall_value|talent_value|valuesByPlayer|mlbPercentiler/);
    }
    // ...and neither does the reader's finance half, nor the route
    expect(code('clubFinanceRoutes.ts')).not.toMatch(/scoutedEvidence|players_value|valuation\.js/);
  });

  it.each(PRODUCTION_MODULES)('%s (production, phase 3a) reads no rating at all: no scoutedEvidence, no rating column, no players_value', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(/scoutedEvidence|ScoutedAbility|_ratings_|fielding_rating|players_batting\b|players_pitching\b|players_value|overall_value|talent_value/);
    expect(importsOf(file).join(' '), file).not.toMatch(/scoutedEvidence|philosophy|settings|staffPreference|assignmentPreference|developmentFit|developmentalContext|prospectDecision|prospectAssignments|destinationFit/);
  });

  it('injury proneness is read only through its one declared reader (D-053)', () => {
    const readers = SERVER_FILES.filter((f) => /prone_(overall|leg|back|arm)/.test(code(f)));
    expect(readers).toEqual(['injuryProneness.ts']);
    // ...schema-tolerant: its columns are selected only where the export has them
    expect(code('injuryProneness.ts')).toMatch(/PRONENESS_COLUMNS\.filter\(\(c\) => present\.has\(c\)\)/);
  });

  it('production\'s fitted numbers come from the save\'s stored fit; the only fitted artefacts in code are the provisional priors (D-053)', () => {
    const calibration = code('playerValueCalibration.ts');
    // One ProductionModel and one RatingsModel in code, each stamped provisional
    expect([...calibration.matchAll(/export const ([A-Z_]+): ProductionModel =/g)].map((m) => m[1])).toEqual(['PRODUCTION_PRIOR']);
    expect([...calibration.matchAll(/export const ([A-Z_]+): RatingsModel =/g)].map((m) => m[1])).toEqual(['RATINGS_PRIOR']);
    expect(calibration).toMatch(/PRODUCTION_PRIOR_CALIBRATION: CalibrationStamp = provisional\(/);
    expect(calibration).toMatch(/RATINGS_PRIOR_CALIBRATION: CalibrationStamp = provisional\(/);
    // The ratings prior measures no arrivals: those are the save's or unknown
    expect(calibration).toMatch(/export const RATINGS_PRIOR: RatingsModel = \{[\s\S]*?\n  arrival: null,/);
    // The projection and the fit are handed a model; neither reaches for a prior itself
    for (const file of ['playerValueProduction.ts', 'playerValueProductionFit.ts', ...RATINGS_MODULES]) expect(code(file), file).not.toMatch(/PRODUCTION_PRIOR\b|RATINGS_PRIOR\b/);
    // The reader serves the adopted fit from the store, and the prior only when there is none
    const reader = code('playerValue.ts');
    expect(reader).toMatch(/adoptedProductionFit\(leagueId, PRODUCTION_METHOD, done\.season\)/);
    expect(reader).toMatch(/return priorInForce\(leagueId, season\);/);
    expect(reader).toMatch(/adoptedProductionFit<RatingsModel, RatingsFitRecord>\(leagueId, RATINGS_METHOD, completedThrough\(leagueId, rules\)\.season\)/);
    // No other module fits, stores or reads a fit
    for (const file of SERVER_FILES.filter((f) => f !== 'playerValue.ts' && f !== FIT_STORE)) {
      expect(code(file), file).not.toMatch(/value_production_fits|recordProductionFit|adoptedProductionFit/);
    }
  });

  it('the refit runs after an import, once, off the event loop, and can never fail it (D-053, A-17)', () => {
    const api = code('api.ts');
    // In a worker thread, recorded only if no import started while it read; any failure is caught and logged
    expect(api.match(/refitOffThread\(/g) ?? []).toHaveLength(1);
    expect(api).toMatch(/refitOffThread\(\{ compute, stale: \(\) => importState\.importing \|\| generation !== importGeneration \}\)/);
    expect(api).toMatch(/refitInWorker\(\)\.catch\(/);
    expect(api).toMatch(/\.catch\(\(err\) => console\.error\('\[value\] production refit failed:', err\)\)/);
    // The worker computes both refits (the ratings after the results model they read) and records nothing
    expect(code('playerValueRefitWorker.ts')).toMatch(/computeRefits\(\)/);
    expect(code('playerValue.ts')).toMatch(/const production = computeProductionRefits\(\);[\s\S]*?const ratings = computeRatingsRefits\(/);
    // After the import has finished, only when it succeeded
    expect(api).toMatch(/\} finally \{[\s\S]*?importState\.importing = false;[\s\S]*?\}\s*if \(imported\) refitAfterImport\(\);/);
  });

  it.each(VALUE_MODULES)('%s reads ratings only through the adapter: no rating column or ratings table (1)', (file) => {
    expect(code(file), file).not.toMatch(/_ratings_|fielding_rating|players_batting|players_pitching|players_fielding/);
  });

  it.each(VALUE_MODULES)('%s names no players_value field (2)', (file) => {
    expect(code(file), file).not.toMatch(
      /players_value|overall_value|talent_value|\boa\b|\bpot\b|oa_rating|pot_rating|valuesByPlayer|mlbPercentiler/
    );
  });

  it('consumers reach value only through the entry point, and compute no cost of their own (3)', () => {
    for (const file of SERVER_FILES.filter((f) => !VALUE_MODULES.includes(f))) {
      const source = code(file);
      // Only the entry point, in any import form; the snapshot writer and the routes only for their one caller each
      for (const spec of importsOf(file)) {
        const target = resolvedOf(file, spec);
        if (target === null || !/^playerValue[A-Za-z]*\.js$/.test(target)) continue;
        const allowed = target === 'playerValue.js'
          || (target === 'playerValueSnapshot.js' && SNAPSHOT_CALLERS.includes(file))
          || (target === 'playerValueRoutes.js' && ROUTE_MOUNTERS.includes(file));
        expect(allowed, `${file} reaches past the entry point: ${spec}`).toBe(true);
      }
      expect(importRecordsOf(file).nonLiteral.filter((t) => /playerValue/.test(t)), file).toEqual([]);
      // Eligibility is asked of Player Rights by the value reader only; nobody else composes a timeline
      if (file !== 'playerRights.ts') expect(source, file).not.toMatch(/\bevaluateContractControl\b|\bcomposeControlTimeline\b/);
      // Nobody else prices a win, puts a season on a schedule's footing or reads the market's history (named at all, so an alias does not hide it)
      expect(source, file).not.toMatch(/value_market_snapshots|value_contract_snapshots|value_contract_imports|\bopeningPriceOfWin\b|\breplacementLevelOf\b|\bclubFinancesOf\b|\bscheduleShareOf\b|\bobserveChanges\b|\bmeasurePriceOfWin\b|\badoptPrice\b/);
    }
    for (const file of MIGRATED_CONSUMERS) {
      const source = code(file);
      expect(importsOf(file), `${file} is migrated and must read the entry point`).toContain('./playerValue.js');
      expect(source, file).not.toMatch(/CostBand|COST_PENDING|priceOfWin|price of a win/i);
    }
  });

  it.each(MIGRATED_CONSUMERS)('%s does no service arithmetic of its own and queries no contract table: Player Rights and the contract facts answer (3)', (file) => {
    for (const check of ['service', 'contract-query'] as const) {
      const found = consumerMatches(check, file);
      const pending = PENDING.find((p) => p.check === check && p.file === file);
      if (pending) {
        expect(found, `${file}: ${pending.finding}. If it is fixed, remove its PENDING entry`).toEqual(pending.matches);
      } else {
        expect(found, `${file} (${check})`).toEqual([]);
      }
    }
  });

  it('every pending violation names its finding and a migrated consumer', () => {
    for (const p of PENDING) {
      expect(MIGRATED_CONSUMERS).toContain(p.file);
      expect(p.finding).toMatch(/^(A|B|C|D)-\d+|^unassigned/);
    }
  });

  it.each(VALUE_MODULES)('%s puts no philosophy in the neutral path (4)', (file) => {
    expect(importsOf(file).join(' '), file).not.toMatch(/philosophy|settings|staffPreference|assignmentPreference/);
  });

  it.each(VALUE_MODULES)('%s reads no protection tier and no defensibility (5)', (file) => {
    expect(importsOf(file).join(' '), file).not.toMatch(
      /developmentFit|developmentalContext|prospectDecision|prospectAssignments|destinationFit|mlbAssignmentContext|currentAssignment/
    );
  });

  it.each(VALUE_MODULES)('%s rebuilds no right: no option, DFA, waiver or service-threshold reading (6)', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(
      /options_used|designated_for_assignment|days_on_dfa|is_on_waivers|waiver|rules_fa_minimum_years|rules_salary_arbitration|rules_min_service_days|mlb_service_days|mlb_service_years|has_received_arbitration/
    );
    // It reads eligibility as Player Rights states it, never the thresholds or the service behind it:
    // named at all (a property, a destructuring, a bracket), not only as `.name`
    expect(source, file).not.toMatch(/\b(freeAgencyYears|arbitrationYears|serviceDaysPerYear|serviceTime)\b/);
  });

  it('only the reader asks Player Rights for eligibility', () => {
    const askers = VALUE_MODULES.filter((f) => /\bevaluateContractControl\b/.test(code(f)));
    expect(askers).toEqual(['playerValue.ts']);
  });

  it.each(VALUE_MODULES.filter((f) => !WRITERS.includes(f)))('%s writes nothing, and touches no history (7)', (file) => {
    const source = code(file);
    // No statement that writes, whatever its case or quotes
    expect(stringsOf(file).filter((s) => WRITE_SQL.test(s)), file).toEqual([]);
    // No database call that executes; every prepared statement is league.db's and provably a read
    for (const call of dbCallsOf(file)) {
      expect(EXECUTING.has(call.method), `${file}: ${call.text}`).toBe(false);
      expect(call.receiver, `${file}: ${call.text}`).toBe('db');
      expect(call.sql !== null && call.sql.every((s) => READ_ONLY_SQL.test(s)), `${file}: ${call.text}`).toBe(true);
    }
    expect(source, file).not.toMatch(/history\.js|historyDb|writeFileSync|appendFileSync|createWriteStream/);
  });

  it('only the two writers touch history.db, and neither writes league.db (7)', () => {
    const touching = VALUE_MODULES.filter((f) => /history\.js|historyDb/.test(code(f)));
    expect(touching).toEqual(WRITERS);
    for (const writer of WRITERS) {
      const calls = dbCallsOf(writer);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        // history.db takes the writes; league.db is only ever read, by a statement that provably reads
        if (call.receiver === 'historyDb') continue;
        if (call.method === 'run' || call.method === 'transaction') {
          // a statement's run: its prepare is checked where the statement was made
          expect(call.receiver, `${writer}: ${call.text}`).not.toBe('db');
          continue;
        }
        expect(call.receiver, `${writer}: ${call.text}`).toBe('db');
        expect(call.method, `${writer}: ${call.text}`).toBe('prepare');
        expect(call.sql !== null && call.sql.every((s) => READ_ONLY_SQL.test(s)), `${writer}: ${call.text}`).toBe(true);
      }
      // Neither hands a database handle to anything under another name
      const aliases = nodesOf(writer).filter((n) => ts.isVariableDeclaration(n) && !!n.initializer
        && ts.isIdentifier(n.initializer) && ['db', 'historyDb'].includes(n.initializer.text));
      expect(aliases.length, writer).toBe(0);
      expect(code(writer), writer).not.toMatch(/writeFileSync|appendFileSync|createWriteStream|DROP\s+TABLE|ALTER\s+TABLE/i);
      // Owner decision 4 (2026-09-24): the contract store alone deletes, and only its own full snapshots (value_contract_snapshots),
      // keyed by the save's identity, league and game date; never an import's header, a stored pair or an event, never league.db
      const deletes = stringsOf(writer).filter((x) => /DELETE\s+FROM/i.test(x));
      if (writer !== CONTRACT_STORE) expect(deletes, writer).toEqual([]);
      else {
        expect(deletes.length, writer).toBeGreaterThan(0);
        for (const d of deletes) expect(d, writer).toMatch(/^\s*DELETE FROM value_contract_snapshots WHERE save_name = \? AND league_id = \? AND game_date = \?\s*$/);
      }
    }
    // The fit store: additive, keyed by save, league, last completed season and method, idempotent unless forced
    const store = code(FIT_STORE);
    expect(store).toMatch(/CREATE TABLE IF NOT EXISTS value_production_fits/);
    expect(store).toMatch(/PRIMARY KEY \(save_name, league_id, through_season, method\)/);
    expect(store).toMatch(/meta\.force \? 'INSERT OR REPLACE' : 'INSERT OR IGNORE'/);
    const source = code(SNAPSHOT_WRITER);
    // Additive: the table is created only if it is not there, as every history.db table is
    expect(source).toMatch(/CREATE TABLE IF NOT EXISTS value_market_snapshots/);
    // Idempotent per key: the key is the primary key and a second write of it is ignored
    expect(source).toMatch(/PRIMARY KEY \(save_name, league_id, game_date\)/);
    expect(source).toMatch(/INSERT OR IGNORE INTO value_market_snapshots/);
    // Phase 4b: the contract snapshot, additive and idempotent per save identity, league, game date (and player)
    const contracts = code(CONTRACT_STORE);
    expect(contracts).toMatch(/CREATE TABLE IF NOT EXISTS value_contract_imports/);
    expect(contracts).toMatch(/CREATE TABLE IF NOT EXISTS value_contract_snapshots/);
    expect(contracts).toMatch(/PRIMARY KEY \(save_name, league_id, game_date\)/);
    expect(contracts).toMatch(/PRIMARY KEY \(save_name, league_id, game_date, player_id\)/);
    expect(contracts).toMatch(/INSERT OR IGNORE INTO value_contract_imports/);
    expect(contracts).toMatch(/INSERT OR IGNORE INTO value_contract_snapshots/);
    // Keyed by the save's identity (name and league fingerprint), never the name alone (D-01)
    expect(contracts).toMatch(/saveIdentity\(/);
    expect(contracts).not.toMatch(/currentSaveName\(/);
    // Phase 4b review: the stored pairs (with the reading's method) and the timeline's events, additive and idempotent
    expect(contracts).toMatch(/CREATE TABLE IF NOT EXISTS value_contract_pairs/);
    expect(contracts).toMatch(/PRIMARY KEY \(save_name, league_id, earlier_date, later_date, method\)/);
    expect(contracts).toMatch(/CREATE TABLE IF NOT EXISTS value_contract_events/);
    expect(contracts).toMatch(/INSERT OR IGNORE INTO value_contract_pairs/);
    expect(contracts).toMatch(/INSERT OR IGNORE INTO value_contract_events/);
    // Owner decision 4: a pruned import is recorded as an event (the durable record), inside the writer's transaction
    expect(contracts).toMatch(/'pruned'/);
    expect(contracts).toMatch(/historyDb\.transaction\(/);
    // Recording an import and reading the market read one import at a time, never the whole history (review R3-03)
    for (const file of ['playerValue.ts', SNAPSHOT_WRITER]) expect(code(file), file).not.toMatch(/\bcontractSnapshots\(/);
  });

  it('the import records the market once, and a failed snapshot cannot fail the import (7)', () => {
    const api = code('api.ts');
    const calls = api.match(/captureMarketSnapshot\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(api).toMatch(/try \{\s*(const \w+ = )?captureMarketSnapshot\(/);
    // No timer anywhere near it: data changes only on import (D-009)
    for (const file of [...VALUE_MODULES, 'clubFinanceRoutes.ts']) expect(code(file), file).not.toMatch(/setInterval|setTimeout/);
  });

  it('an observed change is read from Player Rights\' answers at the earlier import, never from service time, and names no transaction the export does not carry (phase 4b, D-020)', () => {
    const signings = code('playerValueSignings.ts');
    // The standing for the new contract's first season, as Player Rights stated it at the earlier import
    expect(signings).toMatch(/\.standing\b/);
    expect(signings).not.toMatch(/serviceDays|\.service\b|endOfSeason|mlbDays|thresholdDays|lineDays|MLB_CONTRACT_REGIME/);
    // Pure: it opens no database and reads no rating, no players_value, no live log
    expect(importsOf('playerValueSignings.ts').join(' ')).not.toMatch(/db\.js|history\.js|scoutedEvidence|playerValueRatings|liveLog|transactionLog/);
    // A snapshot difference never becomes a transaction type the export does not give
    for (const s of stringsOf('playerValueSignings.ts')) expect(s).not.toMatch(/\boptioned\b|\brecalled\b|\bDFA\b|designated for assignment|\boutright/i);
    // The import records the contracts once, before the market it prices from them
    const writer = code(SNAPSHOT_WRITER);
    expect(writer).toMatch(/recordContractSnapshot\(/);
    expect(writer.indexOf('recordContractSnapshot(')).toBeLessThan(writer.indexOf('insert.run('));
  });

  it('the market is priced from Player Rights\' free-agency answer, never from service time (6)', () => {
    const finances = code('playerValueFinances.ts');
    expect(finances).toMatch(/freeAgency\.status/);
    expect(finances).not.toMatch(/serviceDays|\.service\b|endOfSeason|mlbDays|thresholdDays|lineDays/);
  });

  it('the cost of a controlled season is priced from Player Rights\' answers, never from service time (phase 4a)', () => {
    const cost = code('playerValueCost.ts');
    // The status, the arbitration trip and the regime's classes are Player Rights' (the standing, trip and arbitrationRegimeOf)
    expect(cost).toMatch(/\.standing\b/);
    expect(cost).toMatch(/\.trip\b/);
    expect(cost).toMatch(/tripIfEligible/);
    expect(cost).not.toMatch(/serviceDays|\.service\b|endOfSeason|mlbDays|thresholdDays|lineDays|MLB_CONTRACT_REGIME/);
    // It reads no rating and no players_value: production arrives as the production answer
    expect(importsOf('playerValueCost.ts').join(' ')).not.toMatch(/scoutedEvidence|playerValueRatings|db\.js/);
  });

  it('the surplus (phase 5a) is pure: it reads Player Value\'s own answers and the market as handed to it, opens no table, reads no rating, no tier and no philosophy, and says no verdict', () => {
    const surplus = code('playerValueSurplus.ts');
    expect(importsOf('playerValueSurplus.ts').filter((i) => !['./provenance.js', './calibration.js', './playerValueCalibration.js', './playerValueControl.js', './playerValueProduction.js', './playerValueFinances.js'].includes(i))).toEqual([]);
    expect(surplus).not.toMatch(/\bdb\.|prepare\(|scoutedEvidence|players_value|evaluateContractControl|serviceDays|\.service\b|philosophy|protection/);
    // Only the reader hands it the market; no consumer computes a surplus of its own
    for (const file of SERVER_FILES.filter((f) => !VALUE_MODULES.includes(f))) expect(code(file), file).not.toMatch(/\bsurplusOf\b/);
    // No verdict in its words
    expect(surplus).not.toMatch(/\b(should|recommend\w*|release him|keep him|trade him|extend him|sign him)\b/i);
  });

  it('every constant is declared once, stamped, in the calibration module (8)', () => {
    // A number of its own at module level, whatever its name, keyword or type: a literal, literal arithmetic, or an object or array holding one
    for (const file of VALUE_MODULES.filter((f) => f !== 'playerValueCalibration.ts')) {
      expect(ownNumbersOf(file), `${file} declares a number of its own`).toEqual([]);
    }
    const calibration = code('playerValueCalibration.ts');
    const numbers = [...calibration.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*-?\d/g)].map((m) => m[1]);
    const stamps = [...calibration.matchAll(/export const ([A-Z][A-Z0-9_]*): CalibrationStamp = (calibrated|provisional|policy)\(/g)];
    expect(numbers).toEqual(['CONTROL_HORIZON_SEASONS']);
    expect(stamps.map((m) => [m[1], m[2]])).toEqual([
      ['CONTROL_HORIZON_CALIBRATION', 'policy'],
      ['MARKET_CONTRACT_CALIBRATION', 'policy'],
      ['OPENING_PRICE_CALIBRATION', 'provisional'],
      ['OPENING_PRICE_CENTRAL_CALIBRATION', 'policy'],
      ['OPENING_PRICE_MINIMUMS_CALIBRATION', 'policy'],
      ['REPLACEMENT_LEVEL_CALIBRATION', 'provisional'],
      ['FINANCE_ROW_CALIBRATION', 'policy'],
      ['PLACEHOLDER_ROW_CALIBRATION', 'policy'],
      ['PRODUCTION_POLICY_CALIBRATION', 'policy'],
      ['RATINGS_POLICY_CALIBRATION', 'policy'],
      ['PRODUCTION_PRIOR_CALIBRATION', 'provisional'],
      ['PRODUCTION_PRIOR_SOURCE_CALIBRATION', 'provisional'],
      ['RATINGS_PRIOR_CALIBRATION', 'provisional'],
      ['COST_POLICY_CALIBRATION', 'policy'],
      ['COST_PRIOR_CALIBRATION', 'provisional'],
      ['SIGNINGS_POLICY_CALIBRATION', 'policy'],
      // Owner decision 2 (2026-09-24): how Payroll combines players
      ['COST_COMBINATION_POLICY_CALIBRATION', 'policy'],
      // Phase 5a (owner, 2026-09-24): the neutral view's discount rate and how the surplus is read
      ['SURPLUS_POLICY_CALIBRATION', 'policy'],
    ]);
    // Every policy object of numbers in the calibration module is stamped beside it
    for (const name of ownNumbersOf('playerValueCalibration.ts').filter((n) => n !== 'CONTROL_HORIZON_SEASONS')) {
      const stamp = name.replace(/(_POLICY|_MINIMUMS|_PRIOR)?$/, (s) => `${s}_CALIBRATION`);
      expect(calibration, `${name} has no stamp`).toMatch(new RegExp(`export const ${stamp}: CalibrationStamp =`));
    }
    // Nothing in code is stamped calibrated for production: a save's fit is stamped by its own run record (D-053)
    expect(calibration).not.toMatch(/\bcalibrated\(/);
    // Declared once: nobody else defines the horizon
    for (const file of SERVER_FILES.filter((f) => f !== 'playerValueCalibration.ts')) {
      expect(code(file), file).not.toMatch(/\bCONTROL_HORIZON_SEASONS\s*[=:]/);
    }
  });

  it('reads every contract and rule column through a column check (9)', () => {
    for (const file of [...VALUE_MODULES, 'leagueRules.ts']) {
      expect(stringsOf(file).filter((s) => /\bSELECT\s+(DISTINCT\s+)?([\w"]+\.)?\*/i.test(s)), `${file} selects columns it has not checked`).toEqual([]);
    }
    // The reader selects only the columns the export has, for the contract tables and the leagues table
    expect(code('playerValue.ts')).toMatch(/wanted\.filter\(\(c\) => present\.has\(c\)\)/);
    // ...and for the financial tables and the WAR tables (R-10: WAR is unguarded elsewhere)
    expect(code('playerValue.ts')).toMatch(/FINANCE_COLUMNS\.filter\(\(c\) => present\.has\(c\)\)/);
    expect(code('playerValue.ts')).toMatch(/WAR_COLUMNS\.filter\(\(c\) => !present\.has\(c\)\)/);
    expect(code('leagueRules.ts')).toMatch(/COLUMNS\.filter\(\(c\) => present\.has\(c\)\)/);
  });
});

describe('one LeagueRules (Part 9, phase 1)', () => {
  const RULE_COLUMNS = /rules_fa_minimum_years|rules_salary_arbitration_minimum_years|rules_min_service_days|rules_minimum_salary|financial_coefficient|rules_financials|rules_minor_league_fa_minimum_years/;

  it('only leagueRules.ts reads the contract rules from the export', () => {
    // A read is a query naming the column, in any quotes; a column named in a message or a source label is not one
    const queries = (file: string): string[] => stringsOf(file).filter((t) => /\bSELECT\b/i.test(t));
    const readers = SERVER_FILES
      .filter((f) => queries(f).some((q) => RULE_COLUMNS.test(q)) || (f !== 'leagueRules.ts' && /\[[^\]]*['"`]rules_fa_minimum_years['"`]/.test(code(f))));
    expect(readers).toEqual([]);
    // leagueRules.ts reads them from its declared column list, filtered by what the export has
    expect(code('leagueRules.ts')).toMatch(/'rules_fa_minimum_years', 'rules_salary_arbitration_minimum_years'/);
  });

  it('no module declares a LeagueRules of its own, or assumes six, three or 172', () => {
    /*
     * One declaration is allowed: MLB's contract regime in playerRights.ts, which a league's rules as
     * READ are compared against to decide whether Super Two applies (owner, 2026-09-22). It is never
     * used in place of a league's own rule.
     */
    const REGIME = /export const MLB_CONTRACT_REGIME = \{ freeAgencyYears: 6, arbitrationYears: 3, serviceDaysPerYear: 172 \} as const;/;
    expect(code('playerRights.ts')).toMatch(REGIME);
    for (const file of SERVER_FILES) {
      const source = code(file).replace(REGIME, '');
      if (file !== 'leagueRules.ts') expect(source, file).not.toMatch(/interface LeagueRules\b|function leagueRules\(/);
      // A service-year length of 172 (never a digit run inside a fitted decimal such as 1.172)
      expect(source, file).not.toMatch(/(?<![\d.])172(?![\d.])|SERVICE_DAYS_PER_YEAR|faMinYears|arbMinYears|MLB_CONTRACT_REGIME\s*=/);
    }
    // ...and only the Super Two regime check reads it
    const uses = SERVER_FILES.filter((f) => /MLB_CONTRACT_REGIME\./.test(code(f)));
    expect(uses).toEqual(['playerRights.ts']);
  });
});
