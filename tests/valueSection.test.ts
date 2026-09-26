import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ClubWinValue, OurView, OurViewResponse, PlayerSurplus, SurplusSeason } from '../src/api';
import { ValueView } from '../src/ValueSection';
import { bannedIn } from './bannedJargon';

/*
 * The player card's Value section (Player Value phases 5a and 5b, BEHAVIOR_CASES.md "Player Value"): the contract value
 * (the API's contract surplus) and the value of keeping him (the retention margin) side by side, each most likely with
 * its range, the season-by-season breakdown (wins, price, cost, discount, both views) with what it rests on, and what is
 * unknown saying so; our view beside the neutral figure with its leans; the club's value of a win as context. The words
 * are plain, the explanations in the hovers. The card computes nothing: every figure is served. No view is a verdict.
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
  weight: 1 / 1.05 ** (y - 2026), status: 'under_contract', between: [], control: 'Signed', ifHeld: false,
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
  basis: ['Contract surplus: his production value less his cost, season by season, discounted and summed; a central from the centrals, edge against edge.'],
  stamp: { status: 'policy', basis: 'owner, 2026-09-24' },
  ...over,
});

const lens = (over: Partial<OurView> = {}): OurView => ({
  playerId: 1, status: 'valued', unit: 'dollars', leaning: true,
  contract: { status: 'known', reason: null, from: 2026, to: 2028, neutral: { low: -9_000_000, central: 28_000_000, high: 100_000_000, centralRange: null }, ours: { low: -8_000_000, central: 21_500_000, high: 80_000_000, centralRange: null }, established: null },
  retention: { status: 'known', reason: null, from: 2026, to: 2028, neutral: { low: 25_000_000, central: 63_000_000, high: 130_000_000, centralRange: null }, ours: { low: 22_000_000, central: 55_000_000, high: 110_000_000, centralRange: null }, established: null },
  wins: { status: 'known', reason: null, from: 2026, to: 2028, neutral: { low: 3.4, central: 8.9, high: 13.8, centralRange: null }, ours: { low: 3.1, central: 8.1, high: 12.5, centralRange: null }, established: null },
  leans: [{
    kind: 'dimension', id: 'competitiveWindow', label: 'Competitive window', value: 85, short: 'win-now: later seasons count less',
    text: 'Competitive window 85 (win-now): later seasons are discounted at 11.3% a season instead of the neutral 5%.', seasons: [2027, 2028],
    by: { contract: { low: -6_500_000, high: -6_500_000 }, retention: { low: -8_000_000, high: -8_000_000 }, wins: { low: -0.8, high: -0.8 } },
  }],
  notes: [], read: [], seasons: [], discount: { neutral: 0.05, ours: 0.113, text: 'Discounted at 11.3% a season (neutral 5%).' },
  basis: ['Our view leans on the neutral value at read time.'], stamp: { status: 'policy', basis: 'policy' },
  ...over,
});

const winValue = (over: Partial<ClubWinValue> = {}): ClubWinValue => ({
  teamId: 1, club: 'Arizona Diamondbacks', status: 'known', reason: null, unit: 'playoff odds', odds: 0.71, perWin: 0.032,
  curve: [{ wins: 0, odds: 0.71 }, { wins: 1, odds: 0.742 }], gamesLeft: 119, gamesPlayed: 43,
  text: 'One more win moves the Arizona Diamondbacks\' playoff odds from 71% to 74.2%.', basis: ['The deadline read\'s odds model.'],
  stamp: { status: 'provisional', basis: 'odds model' }, ...over,
});

const response = (over: Partial<OurViewResponse> = {}): OurViewResponse => ({
  organization: { id: 1, name: 'Arizona Diamondbacks', source: 'requested' }, ourView: lens(), winValue: winValue(), ...over,
});

const html = (s: PlayerSurplus, ours: OurViewResponse | null = null) => renderToStaticMarkup(createElement(ValueView, { surplus: s, ours }));
/** What the card shows before any hover: the markup without the hover popups, as text. */
const visible = (markup: string) => markup
  .replace(/<span class="tip-pop">[^<]*<\/span>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

describe('the card\'s Value section', () => {
  it('shows the contract value and the value of keeping him side by side, each most likely with the range it could be', () => {
    const out = html(surplus());
    const text = visible(out);
    expect(text).toMatch(/Contract value/);
    expect(text).toMatch(/Value of keeping him/);
    expect(text).toMatch(/What he's worth beyond what he's paid/);
    expect(text).toMatch(/What you'd give up by letting him go/);
    expect(text).toMatch(/Most likely \$28\.0M/);
    expect(text).toMatch(/could be −\$9\.0M to \$100\.0M \(2026–2028\)/);
    expect(text).toMatch(/\$63\.0M/);
    expect(text).toMatch(/\$130\.0M/);
    // The explanation is in the hover
    expect(out).toMatch(/tip-pop">What this contract is worth to any team that holds it/);
    expect(out).toMatch(/tip-pop">Keeping him compared with replacing him with a minimum-salary player/);
    expect(out).toMatch(/tip-pop">The range covers every reasonable combination/);
  });

  it('lays out every season with its wins, price, cost, discount and both views, each header explained on hover, and what it rests on in plain words', () => {
    const out = html(surplus());
    for (const h of ['Season', 'Wins', 'Price', 'Cost', 'Discount', 'Contract value', 'Keeping him']) expect(out).toContain(`>${h}<`);
    expect(out).toMatch(/Season-by-season breakdown/);
    expect(out).toMatch(/tip-pop">Projected wins above replacement/);
    expect(out).toMatch(/tip-pop">How much the season counts today/);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/rest of season/i);
    expect(out).toMatch(/95%/);
    const text = visible(out);
    expect(text).toMatch(/\$7\.25M/);
    expect(text).toMatch(/5% less for each year/);
    expect(text).toMatch(/1\.4 wins/);
    expect(text).toMatch(/40-man/);
  });

  it('says what is unknown in one short sentence, never a zero; the reasons are in the breakdown', () => {
    const out = html(surplus({
      seasons: [season(2026), season(2027, { contract: unknownView('2027: the renewal pay is not measured.'), retention: unknownView('2027: the renewal pay is not measured.') })],
      contract: { status: 'unknown', from: 2026, to: 2027, low: null, central: null, high: null, centralRange: null, missing: [2027], reason: 'No sum over 2026–2027: 2027: the renewal pay is not measured.', established: { from: 2026, to: 2026, low: 1, central: 2, high: 3, centralRange: null }, ifHeld: false },
    }));
    const text = visible(out);
    expect(text).toMatch(/Not valued yet: 2027 isn't established\./);
    expect(text).toMatch(/renewal pay is not measured/);
    expect(text).toMatch(/2026 only/);
  });

  it('in wins only, shows wins above replacement and says why on hover', () => {
    const out = html(surplus({
      status: 'wins_only', unit: 'wins', price: null, reason: 'The league runs no financials: value is in wins, and dollars are unknown.',
      contract: { status: 'unknown', from: 2026, to: 2028, low: null, central: null, high: null, centralRange: null, missing: [], reason: 'The league runs no financials: value is in wins, and dollars are unknown.', established: null, ifHeld: false },
      retention: { status: 'unknown', from: 2026, to: 2028, low: null, central: null, high: null, centralRange: null, missing: [], reason: 'The league runs no financials: value is in wins, and dollars are unknown.', established: null, ifHeld: false },
    }));
    expect(visible(out)).toMatch(/Wins above replacement/);
    expect(out).toMatch(/tip-pop">This league has no finances, so value is shown in wins only/);
    expect(out).toMatch(/8\.9/);
  });

  it('marks a season that counts only if he is kept, and a sum that depends on how an open season goes', () => {
    const out = html(surplus({
      seasons: [season(2026), season(2027, { status: 'club_option', ifHeld: true, contract: view(-10_000_000, null, 20_000_000, { ifHeld: true, centrals: [{ reading: 'the option exercised', low: 9_000_000, high: 9_000_000 }, { reading: 'the option declined, then free agency', low: -2_000_000, high: 0 }] }) })],
      contract: { status: 'known', from: 2026, to: 2027, low: -13_000_000, central: null, high: 56_000_000, centralRange: { low: 8_900_000, high: 19_900_000 }, missing: [], reason: null, established: null, ifHeld: true },
    }));
    const text = visible(out);
    expect(text).toMatch(/if kept/);
    expect(out).toMatch(/tip-pop">Counts only if the club keeps him that season/);
    expect(text).toMatch(/\$8\.9M to \$19\.9M depending on the 2027 option/);
    expect(text).toMatch(/option declined/);
  });

  it('the visible text carries none of the old jargon', () => {
    const cases = [
      html(surplus(), response()),
      html(surplus({ seasons: [season(2026), season(2027, { status: 'club_option', ifHeld: true, contract: view(-10_000_000, null, 20_000_000, { ifHeld: true, centrals: [{ reading: 'the option exercised', low: 9_000_000, high: 9_000_000 }] }) })] }), response()),
      html(surplus({ status: 'wins_only', unit: 'wins', price: null, reason: 'No financials.' }), response()),
    ];
    for (const out of cases) {
      const text = visible(out);
      expect(bannedIn(text)).toEqual([]);
    }
  });

  it('shows our view beside the neutral figure: our figure, the neutral one it started from, and each lean as a short phrase', () => {
    const out = html(surplus(), response());
    const text = visible(out);
    expect(text).toMatch(/Our view/);
    expect(text).toMatch(/\$21\.5M \(neutral \$28\.0M\)/);
    expect(text).toMatch(/\$55\.0M \(neutral \$63\.0M\)/);
    expect(text).toMatch(/win-now: later seasons count less/);
    expect(out).toMatch(/tip-pop">Competitive window 85/);
    // The neutral figures stay first and unchanged
    expect(text.indexOf('$28.0M')).toBeLessThan(text.indexOf('Our view'));
  });

  it('says so when the philosophy does not lean on him, and names whose philosophy it is', () => {
    const quiet = lens({ leaning: false, leans: [], contract: { ...lens().contract, ours: lens().contract.neutral }, retention: { ...lens().retention, ours: lens().retention.neutral } });
    const text = visible(html(surplus(), response({ ourView: quiet })));
    expect(text).toMatch(/Our view/);
    expect(text).toMatch(/Arizona Diamondbacks/);
    expect(text).toMatch(/doesn't lean/);
  });

  it('labels the club\'s value of a win as context from the standings, never part of the value', () => {
    const out = html(surplus(), response());
    const text = visible(out);
    expect(text).toMatch(/A win right now moves the Arizona Diamondbacks' playoff odds by about 3\.2 points/);
    expect(out).toMatch(/tip-pop">[^<]*not part of (the|his) value/i);
    const unknown = visible(html(surplus(), response({ winValue: winValue({ status: 'unknown', odds: null, perWin: null, curve: [], reason: 'No game has been played yet this season.', text: 'Unknown.' }) })));
    expect(unknown).toMatch(/No game has been played yet this season/);
  });

  it('is no verdict', () => {
    const out = visible(html(surplus(), response()));
    expect(out).not.toMatch(/\b(should|recommend|release him|keep him|trade him|extend him|sign him|buy|sell)\b/i);
  });
});
