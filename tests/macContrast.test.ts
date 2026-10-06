import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Words on the system accent (N9 review, M7): macOS lets the GM pick any accent, and white on a yellow one reads about
 * 1.5:1. In the system's colours a badge or chip draws Pennant's fixed, checked pair (`readableHeadingText` on
 * `readableHeadingFill`, `Theme.Palette.badgeText` / `badgeFill`; ThemeTests checks the ratios), never white on the accent.
 */

function swiftFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.build' || e.name.startsWith('.')) return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? swiftFiles(full) : e.name.endsWith('.swift') ? [full] : [];
  });
}

describe('no words drawn white on the system accent (N9 review, M7)', () => {
  it('draws no neutral badge or chip as white on Color.accentColor', () => {
    const offenders: string[] = [];
    for (const file of swiftFiles(path.join(process.cwd(), 'macos'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of [/isNeutral \? (?:Color)?\.white\b/, /\.foregroundStyle\((?:Color)?\.white\)[^\n]*\.background\((?:Color)?\.accentColor/]) {
        if (pattern.test(source)) offenders.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
