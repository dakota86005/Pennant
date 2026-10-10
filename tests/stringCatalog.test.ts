import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNED_JARGON, BANNED_VERDICTS, bannedIn } from './bannedJargon';

/**
 * The Mac app's String Catalogs hold only structural labels (menu, tab, column and section names, D-055, D-056), and
 * they read in the GM's plain words: every key and every translation passes the same banned-jargon and verdict lists
 * as the server's `/v2` text (`tests/bannedJargon.ts`).
 */
const catalogs = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'macos'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.endsWith('.xcstrings'));

interface Catalog {
  sourceLanguage: string;
  strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
}

/** Every key and every localized value in a catalog. */
function catalogStrings(file: string): string[] {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8')) as Catalog;
  return Object.entries(catalog.strings).flatMap(([key, entry]) => [
    key,
    ...Object.values(entry.localizations ?? {}).flatMap((l) => (l.stringUnit?.value ? [l.stringUnit.value] : [])),
  ]);
}

describe('the Mac app\'s String Catalogs', () => {
  it('finds the app\'s catalog', () => {
    expect(catalogs).toContain('macos/Pennant/Localizable.xcstrings');
  });

  it.each(catalogs)('%s: no banned jargon or verdict word', (file) => {
    const offending = catalogStrings(file)
      .map((text) => ({ text, patterns: bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS]).map(String) }))
      .filter(({ patterns }) => patterns.length > 0);
    expect(offending).toEqual([]);
  });
});

/**
 * A structural label is a name (a menu, a tab, a column, a section), never an explanation: at most eight words and no
 * sentence break inside it. An explanation (a certainty in words, a legend, a reason) is the server's, served as a
 * sentence (review S5). The exceptions are the app's own words about itself from before the rule, none about baseball:
 * its setup, its server, its backups and its development build. A new one fails.
 */
const LABEL_WORDS_MAX = 8;
const APP_SENTENCES = new Set([
  'An import is running. Choose a save when it has finished.',
  'Automatic follows the club you manage in the save.',
  'Pennant reads the save\'s export each time it imports.',
  'Pennant reads the transaction log from the save\'s folder, which it finds from the export. Name the folder here only if it isn\'t found.',
  'Pennant stops its server, puts back the files it copied before it first ran on this folder, and starts again. The files it replaces are kept in the backups folder.',
  'Set PENNANT_DEV_DATA_DIR (or -PennantDevDataFolder) to a scratch folder, or choose the real folder on purpose with PENNANT_DEV_USE_REAL_DATA=1 (or -PennantUseRealDataFolder YES).',
  'The save\'s folder, or the folder that holds your saves',
]);

/** Whether a catalog key reads as a sentence rather than a label. */
function readsAsSentence(key: string): boolean {
  return key.split(/\s+/).filter(Boolean).length > LABEL_WORDS_MAX || /\S(?:\. |; |: | · )\S/.test(key);
}

describe('a structural label is a name, not an explanation (review S5)', () => {
  it('tells a label from a sentence', () => {
    expect(readsAsSentence('How it\'s called')).toBe(false);
    expect(readsAsSentence('Not known')).toBe(false);
    expect(readsAsSentence('Ring: the last 15 games')).toBe(true);
    expect(readsAsSentence('Hover for more; click for the basis')).toBe(true);
    expect(readsAsSentence('A starting number, not yet fitted on this save, as stated')).toBe(true);
  });

  it('holds every key of the app\'s catalog to it, but the app\'s own sentences from before the rule', () => {
    const keys = Object.keys((JSON.parse(fs.readFileSync('macos/Pennant/Localizable.xcstrings', 'utf8')) as Catalog).strings);
    expect(keys.filter((key) => readsAsSentence(key) && !APP_SENTENCES.has(key))).toEqual([]);
    // An exception that is gone from the catalog leaves the list too
    expect([...APP_SENTENCES].filter((key) => !keys.includes(key))).toEqual([]);
  });
});

/**
 * The structural labels the Swift sources write, the way SwiftUI looks them up: a string literal given to `Text`,
 * `Button`, `Label`, `Section`, `Menu` and the other labelled views, to `.navigationTitle`, `.navigationSubtitle`,
 * `.help`, `.alert` and `.confirmationDialog`, a `prompt:`, a `title:`, a `LocalizedStringResource` or
 * `LocalizedStringKey`, a `String(localized:)`, either side of a ternary, or a `case` returning a label. `Text(verbatim:)` is served text and is
 * not one (see `verbatimLiterals`); SF Symbol names are skipped.
 */
function structuralLiterals(source: string): string[] {
  const code = source.replace(/\/\/[^\n]*/g, '');
  const lit = '"((?:[^"\\\\\\n]|\\\\.)*)"';
  const views = [
    'Text', 'Button', 'Label', 'Section', 'LabeledContent', 'Tab', 'CommandMenu', 'CommandGroup', 'Window', 'Picker',
    'TextField', 'SecureField', 'Toggle', 'Menu', 'ControlGroup', 'ContentUnavailableView', 'confirmationDialog', 'alert',
    'navigationTitle', 'navigationSubtitle', 'help', 'item', 'row',
  ].join('|');
  const patterns = [
    new RegExp(`\\b(?:${views})\\(\\s*${lit}`, 'g'),
    new RegExp(`\\b(?:title|prompt): ${lit}`, 'g'),
    new RegExp(`(?:LocalizedStringResource|LocalizedStringKey) = ${lit}`, 'g'),
    new RegExp(`\\bString\\(localized: ${lit}`, 'g'),
    new RegExp(`\\? ${lit} : ${lit}`, 'g'),
    new RegExp(`\\bcase [^\\n"]*: ${lit}`, 'g'),
  ];
  const symbol = /^[a-z0-9]+(\.[a-z0-9]+)+$|^[a-z]+$/;
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      for (const text of match.slice(1)) if (text !== undefined && !symbol.test(text)) found.add(text);
    }
  }
  return [...found];
}

/**
 * `Text(verbatim:)` given a literal with words in it: `verbatim` is only for served values (a literal that is nothing
 * but an interpolation of one is allowed); a label written in Swift belongs in the catalog.
 */
function verbatimLiterals(source: string): string[] {
  const code = source.replace(/\/\/[^\n]*/g, '');
  return [...code.matchAll(/\bverbatim: "((?:[^"\\\n]|\\.)*)"/g)]
    .map((m) => m[1])
    .filter((text) => text.replace(/\\\((?:[^()]|\([^()]*\))*\)/g, '').trim() !== '');
}

describe('finding the Swift sources\' labels', () => {
  it.each([
    ['a Text', 'Text("Evidence")', 'Evidence'],
    ['a Button', 'Button("Try Again") {}', 'Try Again'],
    ['a Menu', 'Menu("Sort By") {}', 'Sort By'],
    ['a navigation title', '.navigationTitle("Front Office")', 'Front Office'],
    ['a navigation subtitle', '.navigationSubtitle("Today")', 'Today'],
    ['a help tag', '.help("Back")', 'Back'],
    ['an alert', '.alert("Restore the backup?", isPresented: $shown) {}', 'Restore the backup?'],
    ['a prompt', 'TextField(text: $path, prompt: "Folder path")', 'Folder path'],
    ['a LocalizedStringKey', 'let title: LocalizedStringKey = "Starting…"', 'Starting…'],
    ['a LocalizedStringResource', 'static let title: LocalizedStringResource = "Scouting"', 'Scouting'],
    ['a String(localized:)', 'String(localized: "Set Budget")', 'Set Budget'],
    ['a ternary', 'shown ? "Hide Inspector" : "Show Inspector"', 'Show Inspector'],
    ['a case', 'case .ready: "Ready"', 'Ready'],
  ])('finds %s', (_what, source, label) => {
    expect(structuralLiterals(source)).toContain(label);
  });

  it('skips served text and SF Symbol names', () => {
    expect(structuralLiterals('Text(verbatim: status.headline)')).toEqual([]);
    expect(structuralLiterals('Label("Back", systemImage: "chevron.backward")')).toEqual(['Back']);
  });

  it('flags a verbatim literal with words, and passes a verbatim served value', () => {
    expect(verbatimLiterals('Text(verbatim: "…/Your Save.lg")')).toEqual(['…/Your Save.lg']);
    expect(verbatimLiterals('Text(verbatim: "\\(save.csvCount)")')).toEqual([]);
    expect(verbatimLiterals('Text(verbatim: save.name)')).toEqual([]);
  });
});

describe('the Mac app\'s structural labels', () => {
  const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'macos'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.endsWith('.swift') && (file.startsWith('macos/Pennant/') || /^macos\/Packages\/[^/]+\/Sources\//.test(file)));
  const keys = new Set(Object.keys((JSON.parse(fs.readFileSync('macos/Pennant/Localizable.xcstrings', 'utf8')) as Catalog).strings));

  it('finds labels to check, so the check cannot pass vacuously', () => {
    expect(sources.flatMap((file) => structuralLiterals(fs.readFileSync(file, 'utf8'))).length).toBeGreaterThan(50);
  });

  /**
   * A label with an interpolation (`Open in \(name)`, `\(count) to decide`) is keyed by SwiftUI with a format
   * specifier in its place (`Open in %@`, `%lld to decide`), so it is looked up as one.
   */
  const inCatalog = (text: string): boolean => {
    if (keys.has(text)) return true;
    if (!text.includes('\\(')) return false;
    const pattern = new RegExp(
      '^' + text.split(/\\\((?:[^()]|\([^()]*\))*\)/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('%(?:@|lld|ld|d|\\.\\d+f)') + '$',
    );
    return [...keys].some((key) => pattern.test(key));
  };

  it('looks a label with an interpolation up by its format key', () => {
    expect(inCatalog('Open in \\(name)')).toBe(keys.has('Open in %@'));
    expect(inCatalog('\\(count) to decide')).toBe(keys.has('%lld to decide'));
    expect(inCatalog('Nothing \\(here)')).toBe(false);
  });

  // The packages' views look their labels up in the app's bundle, so every label lives in the app's one catalog
  it.each(sources)('%s: every label is in the app\'s String Catalog', (file) => {
    const missing = structuralLiterals(fs.readFileSync(file, 'utf8')).filter((text) => !inCatalog(text));
    expect(missing).toEqual([]);
  });

  it.each(sources)('%s: Text(verbatim:) only for served values', (file) => {
    expect(verbatimLiterals(fs.readFileSync(file, 'utf8'))).toEqual([]);
  });
});
