import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Rules of the Mac app's design language that a reading of the Swift sources can hold (SWIFTUI_REBUILD.md section 3.7,
 * D-062). The server checks every served text colour against the colour it sits on; a Swift view that fades one of those
 * colours draws a pair nobody checked. So text takes a served colour as served: no `.opacity` on a palette colour given
 * to `foregroundStyle` (a shape's fill or stroke may be faded; it carries no words).
 */
const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'macos'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.endsWith('.swift') && /^macos\/(Pennant\/|Packages\/[^/]+\/Sources\/)/.test(file));

/** A served palette colour faded where it colours text: `foregroundStyle(palette.x.opacity(…))`. */
function fadedTextColours(source: string): string[] {
  const code = source.replace(/\/\/[^\n]*/g, '');
  return [...code.matchAll(/foregroundStyle\(\s*(palette\.\w+)\.opacity\(/g)].map((m) => m[1]);
}

describe('text on a served colour takes it as served (review S3)', () => {
  it('finds a faded palette colour on text, and passes a shape\'s faded fill', () => {
    expect(fadedTextColours('Text(deck).foregroundStyle(palette.mastheadText.opacity(0.94))')).toEqual(['palette.mastheadText']);
    expect(fadedTextColours('Circle().fill(palette.mastheadText.opacity(0.7))')).toEqual([]);
    expect(fadedTextColours('Text(deck).foregroundStyle(palette.mastheadText)')).toEqual([]);
  });

  it('finds the sources to check', () => {
    expect(sources.some((file) => file.endsWith('PennantDesign/Typography.swift'))).toBe(true);
  });

  it.each(sources)('%s: no served text colour is faded', (file) => {
    expect(fadedTextColours(fs.readFileSync(file, 'utf8'))).toEqual([]);
  });
});
