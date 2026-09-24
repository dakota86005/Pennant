import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Player Value phase 6e (BEHAVIOR_CASES.md "Player Value", phase 6e row): a table that scrolls in its own box (Contracts, Free
 * Agents, Org Comparison) clips anything that pokes out of the box, because a box that scrolls sideways cannot let content
 * spill downward. A hover opened on one of the bottom rows used to open downward, past the box, and was cut off. It opens
 * upward there now, into the table. A static check on the stylesheet, since the pages are not rendered in a browser here.
 */

const css = fs.readFileSync('src/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector list matches `selector`, joined. */
function declarationsFor(selector: RegExp): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => selector.test(s.trim()))) out.push(m[2]);
  }
  return out.join(';');
}

describe('a hover near the bottom of a scrolling table opens upward', () => {
  it('the bottom rows\' hovers in the shared scroll box open above their row, not below it', () => {
    const rule = declarationsFor(/^\.contracts-table-scroll\s+tbody\s+tr:nth-last-child\(-n\s*\+\s*\d+\)\s+\.tip-pop$/);
    expect(rule).toMatch(/top:\s*auto/);
    expect(rule).toMatch(/bottom:\s*calc\(100%\s*\+\s*\d+px\)/);
  });

  it('the scroll box still scrolls sideways and never widens the page', () => {
    expect(declarationsFor(/^\.contracts-table-scroll$/)).toMatch(/overflow-x:\s*auto/);
  });
});
