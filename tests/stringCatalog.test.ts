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
 * The structural labels the Swift sources write, the way SwiftUI looks them up: a string literal given to `Text`,
 * `Button`, `Label`, `Section`, `Menu` and the other labelled views, to `.navigationTitle`, `.navigationSubtitle`,
 * `.help`, `.alert` and `.confirmationDialog`, a `prompt:`, a `title:`, a `LocalizedStringResource` or
 * `LocalizedStringKey`, either side of a ternary, or a `case` returning a label. `Text(verbatim:)` is served text and is
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
