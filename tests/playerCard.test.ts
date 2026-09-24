import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { focusTrapTarget } from '../src/focusTrap';
import { PlayerCardFrame } from '../src/playerModal';
import { PriceOfWinLine } from '../src/pages/Payroll';

/*
 * The player card as a dialog, and Payroll's price of a win (hardening F2, 2026-09-23: S-01, S-02,
 * D-22, D-25/S-03). Keyboard behaviour is pinned through its pure helper, the markup through a static
 * render and the width through the stylesheet; the supervisor checks the rest in the browser.
 */

describe('the player card', () => {
  it('keeps Tab inside the card, wrapping at either end', () => {
    const items = ['close', 'watch', 'season'];
    expect(focusTrapTarget(items, 'season', false)).toBe('close');
    expect(focusTrapTarget(items, 'close', true)).toBe('season');
    // Inside, away from the ends, the browser moves focus itself
    expect(focusTrapTarget(items, 'watch', false)).toBeNull();
    // Focus that has escaped comes back in
    expect(focusTrapTarget(items, 'behind', false)).toBe('close');
    expect(focusTrapTarget(items, 'behind', true)).toBe('season');
    expect(focusTrapTarget([], 'behind', false)).toBeNull();
  });

  it('is a labelled modal dialog with a named close button', () => {
    const html = renderToStaticMarkup(createElement(PlayerCardFrame, { onClose: () => {}, label: 'Test Player' }, 'body'));
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-modal="true"/);
    expect(html).toMatch(/aria-label="Test Player"/);
    expect(html).toMatch(/<button[^>]*aria-label="Close the player card"/);
  });

  it('fits the window at any width, with a gutter, rather than a fixed 820 px', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src', 'styles.css'), 'utf8');
    const rule = /\.modal\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/max-width:\s*calc\(100vw\s*-\s*\d+px\)/);
    expect(rule).toMatch(/min-width:\s*0/);
  });
});

describe("Payroll's price of a win", () => {
  const price = (over: Record<string, unknown> = {}) => ({
    label: 'Opening price of a win (imported market)',
    unit: 'dollars_per_win' as const,
    price: { value: { central: 7_010_000, low: 6_050_000, high: 9_870_000 }, source: 'bases' },
    floor: { value: { low: 4_220_000, high: 4_330_000 }, source: 'bases A and A2', note: 'a floor' },
    bases: [
      { id: 'A', description: 'Every major leaguer', perWin: { value: 4_220_000, source: 'x' } },
      { id: 'B', description: 'Market contracts', perWin: { value: 7_010_000, source: 'x' } },
    ],
    population: { market: 212 },
    rules: { central: 'The central is the median.', band: 'The band spans the bases.' },
    narrowsWhen: 'It narrows as signings accumulate.',
    ...over,
  });

  it("shows the floor as the range it is, and the server's own label", () => {
    const html = renderToStaticMarkup(createElement(PriceOfWinLine, { price: price() }));
    expect(html).toMatch(/\$4\.22M–\$4\.33M/);
    expect(html).toMatch(/Opening price of a win \(imported market\)/);
  });

  it('lays the basis out as a list any keyboard can open, not a one-paragraph hover', () => {
    const html = renderToStaticMarkup(createElement(PriceOfWinLine, { price: price() }));
    expect(html).toMatch(/<details/);
    expect(html).toMatch(/<summary/);
    expect(html.match(/<li/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('names the price in force and why, and lists the price history across imports (phase 4b)', () => {
    const html = renderToStaticMarkup(createElement(PriceOfWinLine, {
      price: price({
        stage: 'opening',
        adoption: {
          inForce: 'opening',
          reason: 'The opening price stays: No off-season observed yet: the measured price needs two imports across a winter.',
          opening: { central: 7_010_000, low: 6_050_000, high: 9_870_000, comparable: { low: 5_900_000, high: 10_100_000 } },
          measured: { status: 'no_off_season', signings: 0, observed: 0, text: 'No off-season observed yet.', price: { value: null, source: null, note: 'No off-season observed yet.' } },
          rule: 'The measured price replaces the opening one when its band is narrower (Q-4).',
        },
      }),
      history: [
        { gameDate: '2026-05-16', season: 2026, inForce: 'opening', opening: { central: 7_250_000, low: 6_570_000, high: 9_780_000 }, measured: null, note: 'Measured reading not recorded at this import.' },
        { gameDate: '2027-04-20', season: 2027, inForce: 'measured', opening: { central: 7_400_000, low: 6_600_000, high: 9_900_000 }, measured: { status: 'measured', signings: 34, central: 8_100_000, low: 7_600_000, high: 8_700_000 }, note: null },
      ],
    }));
    expect(html).toMatch(/No off-season observed yet/);
    expect(html).toMatch(/Price history/);
    expect(html).toMatch(/2026-05-16/);
    expect(html).toMatch(/2027-04-20/);
    expect(html).toMatch(/\$8\.10M/);
    expect(html).toMatch(/34 signings/);
  });

  it('with the measured price in force, lists its bases with their unit and labels the opening bases as not in force (phase 4b review, R3-12)', () => {
    const html = renderToStaticMarkup(createElement(PriceOfWinLine, {
      price: price({
        label: 'measured: observed signings',
        stage: 'measured',
        adoption: {
          inForce: 'measured',
          reason: 'The measured price is in force: 120 free-agent signings observed; per projected win at signing and per realized win.',
          opening: { central: 7_010_000, low: 6_050_000, high: 9_870_000, comparable: { low: 5_900_000, high: 10_100_000 } },
          measured: {
            status: 'measured', signings: 120, observed: 120, text: 'Measured on 120 signings.',
            price: { value: { central: 6_100_000, low: 5_800_000, high: 6_400_000 }, source: 'signings' },
            bases: [
              { id: 'first', unit: 'projected', description: 'First season, per win projected at signing', status: 'measured', signings: 120, central: 6_050_000, low: 5_900_000, high: 6_200_000, text: 'x' },
              { id: 'realized', unit: 'realized', description: 'First season, per win he produced in it', status: 'measured', signings: 118, central: 6_300_000, low: 6_000_000, high: 6_400_000, text: 'y' },
            ],
          },
          rule: 'The measured price replaces the opening one when its band is narrower (Q-4).',
        },
      }),
    }));
    expect(html).toMatch(/per win he produced in it/);
    expect(html).toMatch(/\$6\.30M/);
    expect(html).toMatch(/opening reading, not in force/i);
  });

  it('shows a known floor even when the price itself is unknown', () => {
    const html = renderToStaticMarkup(createElement(PriceOfWinLine, {
      price: price({ price: { value: null, source: null, note: 'A single reading is not a band.' } }),
    }));
    expect(html).toMatch(/unknown/);
    expect(html).toMatch(/\$4\.22M–\$4\.33M/);
  });
});
