import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerSurplus, SurplusSeason } from '../src/api';
import { ValueView } from '../src/ValueSection';

/*
 * The player card's Value section (Player Value phase 5a, BEHAVIOR_CASES.md "Player Value"): the contract surplus
 * and the retention margin side by side, each a band with its central, the season-by-season breakdown (wins, price,
 * cost, discount, surplus) with the basis, and what is unknown saying so. The card computes nothing: every figure is
 * served. No view is a verdict.
 */

const view = (low: number, central: number | null, high: number, over: Partial<SurplusSeason['contract']> = {}): SurplusSeason['contract'] => ({
  status: 'known', reason: null, band: { low, central, high }, discounted: { low, central, high }, centrals: [], ifHeld: false,
  text: 'His production value less his cost.', ...over,
});

const unknownView = (reason: string): SurplusSeason['contract'] => ({
  status: 'unknown', reason, band: null, discounted: null, centrals: [], ifHeld: false, text: reason,
});

const season = (y: number, over: Partial<SurplusSeason> = {}): SurplusSeason => ({
  season: y, age: 27 + (y - 2026), part: y === 2026 ? 'rest_of_season' : 'season', share: y === 2026 ? 0.72 : 1,
  weight: 1 / 1.05 ** (y - 2026), status: 'under_contract', control: 'Signed', ifHeld: false,
  wins: { low: 1.2, central: 3.1, high: 4.8 }, banked: y === 2026 ? 1.4 : null,
  price: { low: 6_570_000, central: 7_250_000, high: 9_780_000 },
  cost: { low: 12_000_000, central: 12_000_000, high: 12_000_000 }, costText: 'Under contract at $12,000,000.',
  paid: y === 2026 ? 3_300_000 : null, replacement: 780_000,
  owedEitherWay: { low: 12_000_000, central: 12_000_000, high: 12_000_000 }, onlyIfKept: { low: 0, central: 0, high: 0 },
  branches: [], contract: view(-3_000_000, 10_900_000, 36_000_000), retention: view(8_700_000, 23_000_000, 48_000_000),
  ...over,
});

const surplus = (over: Partial<PlayerSurplus> = {}): PlayerSurplus => ({
  playerId: 1, status: 'valued', reason: null, unit: 'dollars',
  price: { stage: 'opening', label: 'the opening price (the imported market)', band: { low: 6_570_000, central: 7_250_000, high: 9_780_000 }, text: 'The price of a win in force: the opening price, $7.25M a win, held flat across the seasons.' },
  minimum: 780_000,
  discount: { rate: 0.05, text: 'A season s seasons from now weighs 1/1.05^s (5% a season; owner, 2026-09-24).' },
  replacement: { text: "His wins are above the export's replacement level; a replacement is 0 WAR there and costs the league minimum.", measured: 'Not measured yet; shown, never applied.' },
  fortyMan: { onFortyMan: true, text: 'Keeping him holds a 40-man spot; stated, not priced.' },
  seasons: [season(2026), season(2027), season(2028)],
  contract: { status: 'known', from: 2026, to: 2028, low: -9_000_000, central: 28_000_000, high: 100_000_000, centralRange: null, missing: [], reason: null, established: null, ifHeld: false },
  retention: { status: 'known', from: 2026, to: 2028, low: 25_000_000, central: 63_000_000, high: 130_000_000, centralRange: null, missing: [], reason: null, established: null, ifHeld: false },
  wins: { status: 'known', from: 2026, to: 2028, low: 3.4, central: 8.9, high: 13.8, centralRange: null, missing: [], reason: null, established: null, ifHeld: false },
  excluded: ['What he has banked in 2026 (1.4 wins) and the salary paid for the part played ($3.3M) are sunk: shown, never counted.'],
  basis: ['Contract surplus: his production value less his cost, season by season, discounted and summed.'],
  stamp: { status: 'policy', basis: 'owner, 2026-09-24' },
  ...over,
});

const html = (s: PlayerSurplus) => renderToStaticMarkup(createElement(ValueView, { surplus: s }));

describe('the card\'s Value section', () => {
  it('shows the contract surplus and the retention margin side by side, each a band with its central', () => {
    const out = html(surplus());
    expect(out).toMatch(/Contract surplus/);
    expect(out).toMatch(/Retention margin/);
    expect(out).toMatch(/\$28\.0M/);
    expect(out).toMatch(/\$63\.0M/);
    expect(out).toMatch(/−\$9\.0M|-\$9\.0M/);
    expect(out).toMatch(/\$130\.0M/);
  });

  it('lays out every season with its wins, price, cost, discount and both views, and the basis', () => {
    const out = html(surplus());
    for (const h of ['Season', 'Wins', 'Price', 'Cost', 'Discount', 'Contract surplus', 'Retention margin']) expect(out).toContain(`>${h}<`);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/rest of season/i);
    expect(out).toMatch(/0\.952/);
    expect(out).toMatch(/opening price/);
    expect(out).toMatch(/5% a season/);
    expect(out).toMatch(/sunk/);
    expect(out).toMatch(/40-man/);
  });

  it('says what is unknown, never a zero: an unknown season and a sum that names the seasons it cannot include', () => {
    const out = html(surplus({
      seasons: [season(2026), season(2027, { contract: unknownView('2027: the renewal pay is not measured.'), retention: unknownView('2027: the renewal pay is not measured.') })],
      contract: { status: 'unknown', from: 2026, to: 2027, low: null, central: null, high: null, centralRange: null, missing: [2027], reason: 'No sum over 2026–2027: 2027 is unknown.', established: { from: 2026, to: 2026, low: 1, central: 2, high: 3, centralRange: null }, ifHeld: false },
    }));
    expect(out).toMatch(/renewal pay is not measured/);
    expect(out).toMatch(/No sum over 2026–2027/);
    expect(out).toMatch(/2026 only/);
  });

  it('in wins only, says dollars are unknown and why', () => {
    const out = html(surplus({
      status: 'wins_only', unit: 'wins', price: null, reason: 'The league runs no financials: value is in wins, and dollars are unknown.',
      contract: { status: 'unknown', from: 2026, to: 2028, low: null, central: null, high: null, centralRange: null, missing: [], reason: 'The league runs no financials: value is in wins, and dollars are unknown.', established: null, ifHeld: false },
      retention: { status: 'unknown', from: 2026, to: 2028, low: null, central: null, high: null, centralRange: null, missing: [], reason: 'The league runs no financials: value is in wins, and dollars are unknown.', established: null, ifHeld: false },
    }));
    expect(out).toMatch(/runs no financials/);
    expect(out).toMatch(/8\.9/);
  });

  it('marks a season that is only if held, and a sum with no single central', () => {
    const out = html(surplus({
      seasons: [season(2026), season(2027, { ifHeld: true, contract: view(-10_000_000, null, 20_000_000, { ifHeld: true, centrals: [{ reading: 'the option exercised', low: 9_000_000, high: 9_000_000 }, { reading: 'the option declined, then free agency', low: -2_000_000, high: 0 }] }) })],
      contract: { status: 'known', from: 2026, to: 2027, low: -13_000_000, central: null, high: 56_000_000, centralRange: { low: 8_900_000, high: 19_900_000 }, missing: [], reason: null, established: null, ifHeld: true },
    }));
    expect(out).toMatch(/if held/);
    expect(out).toMatch(/no single central/i);
    expect(out).toMatch(/option declined/);
  });

  it('is no verdict', () => {
    const out = html(surplus()).replace(/<[^>]+>/g, ' ');
    expect(out).not.toMatch(/\b(should|recommend|release him|keep him|trade him|extend him|sign him|buy|sell)\b/i);
  });
});
