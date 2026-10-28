import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  count, innings, inningsOf, inningsWords, listWords, money, moneyRange, moneyRangeWords, num, numberWord, ordinal, ordinalWord,
  percent, plural, rangeWith, record, signed, signedMoney, span,
} from '../server/numberWords.js';
import { statText } from '../server/presentation/clubhouse/common.js';
import { dollars } from '../server/presentation/frontOffice/finance.js';
import { pitcherLineWords } from '../server/presentation/frontOffice/morning.js';
import { costRangeText, money as playerMoney, ordinal as playerOrdinal, signedMoney as playerSignedMoney } from '../server/presentation/player/words.js';
import { PITCHING_STATS } from '../server/presentation/statCatalog.js';

/**
 * The one number, money and count formatter (B-06, B-09): grouped counts and true plurals, ordinals past ten, money
 * with a carry and the sign before the dollar sign, real minus signs, en dashes, and innings from outs.
 */
describe('counts and plurals', () => {
  it('groups thousands and says one only for one', () => {
    expect(count(0)).toBe('0');
    expect(count(1)).toBe('1');
    expect(count(999)).toBe('999');
    expect(count(1000)).toBe('1,000');
    expect(count(2076)).toBe('2,076');
    expect(count(999_600)).toBe('999,600');
    expect(plural(0, 'game')).toBe('0 games');
    expect(plural(1, 'game')).toBe('1 game');
    expect(plural(2, 'game')).toBe('2 games');
    expect(plural(2076, 'player')).toBe('2,076 players');
    expect(plural(1, 'position without a backup', 'positions without a backup')).toBe('1 position without a backup');
  });

  it('reads a figure that is not whole as a decimal, never "1.0 days" (review 10 L4)', () => {
    expect(plural(1.04, 'day')).toBe('1.04 days');
    expect(plural(0.96, 'day')).toBe('0.96 days');
    expect(plural(2.5, 'day')).toBe('2.5 days');
    expect(plural(1.0004, 'day')).toBe('1.000 days');
    expect(numberWord(1.04)).toBe('1.04');
    expect(numberWord(2.5)).toBe('2.5');
  });

  it('writes a negative with a real minus sign, and a rounded zero without one', () => {
    expect(num(-29)).toBe('−29');
    expect(num(-1500)).toBe('−1,500');
    expect(num(-0.04, 1)).toBe('0.0');
    expect(num(-3.25, 1)).toBe('−3.3');
    expect(signed(12)).toBe('+12');
    expect(signed(-4)).toBe('−4');
    expect(signed(0)).toBe('0');
    expect(signed(1.5, 1)).toBe('+1.5');
  });

  it('says small counts in words and places as ordinals, right past ten', () => {
    expect(numberWord(0)).toBe('zero');
    expect(numberWord(7)).toBe('seven');
    expect(numberWord(21)).toBe('21');
    expect(numberWord(2076)).toBe('2,076');
    for (const [n, text] of [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'],
      [22, '22nd'], [23, '23rd'], [101, '101st'], [111, '111th'], [112, '112th'], [1001, '1,001st']] as const) {
      expect(ordinal(n)).toBe(text);
    }
    expect(ordinalWord(1)).toBe('first');
    expect(ordinalWord(10)).toBe('tenth');
    expect(ordinalWord(21)).toBe('21st');
  });

  it('writes percentages from a share', () => {
    expect(percent(0)).toBe('0%');
    expect(percent(0.34)).toBe('34%');
    expect(percent(0.125, 1)).toBe('12.5%');
    expect(percent(-0.03)).toBe('−3%');
  });
});

describe('money', () => {
  it('carries a rounding into the next unit, never "$1000K"', () => {
    expect(money(0)).toBe('$0');
    expect(money(1000)).toBe('$1K');
    expect(money(780_000)).toBe('$780K');
    expect(money(999_400)).toBe('$999K');
    expect(money(999_600)).toBe('$1M');
    expect(money(9_996_000)).toBe('$10M');
  });

  it('has one precision rule: two places under ten million, one from ten million, trailing zeros dropped', () => {
    expect(money(2_345_000)).toBe('$2.35M');
    expect(money(8_500_000)).toBe('$8.5M');
    expect(money(7_250_000)).toBe('$7.25M');
    expect(money(1_000_000)).toBe('$1M');
    expect(money(12_500_000)).toBe('$12.5M');
    expect(money(28_000_000)).toBe('$28M');
  });

  it('rounds anything under $1K to the nearest $1K: a value is never known to the dollar (review 10 L4)', () => {
    expect(money(1)).toBe('$0');
    expect(money(437)).toBe('$0');
    expect(money(499)).toBe('$0');
    expect(money(500)).toBe('$1K');
    expect(money(999)).toBe('$1K');
    expect(money(-12)).toBe('$0');
    expect(signedMoney(437)).toBe('$0');
    expect(signedMoney(-700)).toBe('−$1K');
    // A range whose ends would both read "$0" is told apart in whole dollars
    expect(moneyRange(120, 380)).toBe('$120–$380');
  });

  it('writes billions as billions, with the carry: "$1.25B", never "$1,250M" (review 10 L4)', () => {
    expect(money(1_250_000_000)).toBe('$1.25B');
    expect(money(12_500_000_000)).toBe('$12.5B');
    expect(money(999_960_000)).toBe('$1B');
    expect(money(999_940_000)).toBe('$999.9M');
    expect(money(-2_000_000_000)).toBe('−$2B');
  });

  it('puts the sign before the dollar sign, never "$-3.2M"', () => {
    expect(money(-3_200_000)).toBe('−$3.2M');
    expect(money(-999_600)).toBe('−$1M');
    expect(money(-400)).toBe('$0');
    expect(money(-600)).toBe('−$1K');
    expect(money(-0.4)).toBe('$0');
    expect(signedMoney(1_500_000)).toBe('+$1.5M');
    expect(signedMoney(-900_000)).toBe('−$900K');
    expect(signedMoney(0)).toBe('$0');
  });

  it('writes a range with an en dash, and ends that differ never print alike', () => {
    expect(moneyRange(4_600_000, 25_300_000)).toBe('$4.6M–$25.3M');
    expect(moneyRange(780_000, 790_000)).toBe('$780K–$790K');
    expect(moneyRange(9_000_000, 9_000_000)).toBe('$9M');
    expect(moneyRange(780_100, 780_400)).toBe('$780.1K–$780.4K');
    expect(moneyRange(-1_000_000, 2_000_000)).toBe('−$1M–$2M');
  });

  it('writes a range in words with " to ", and ends that differ never read as a point (review 10 M2)', () => {
    expect(money(12_310_000)).toBe('$12.3M');
    expect(money(12_340_000)).toBe('$12.3M');
    expect(moneyRange(12_310_000, 12_340_000, ' to ')).toBe('$12.31M to $12.34M');
    expect(moneyRangeWords(12_310_000, 12_340_000)).toBe('$12.31M to $12.34M');
    expect(moneyRangeWords(4_600_000, 25_300_000)).toBe('$4.6M to $25.3M');
    expect(moneyRangeWords(9_000_000, 9_000_000)).toBe('$9M');
    expect(moneyRangeWords(-3_200_000, 1_000_000)).toBe('−$3.2M to $1M');
  });

  it('a range through a formatter goes through the money rule when the formatter is money (review 10 M2)', () => {
    expect(rangeWith(12_310_000, 12_340_000, money)).toBe('$12.31M to $12.34M');
    expect(rangeWith(12_310_000, 12_340_000, signedMoney)).toBe('+$12.31M to +$12.34M');
    expect(rangeWith(-12_340_000, -12_310_000, signedMoney)).toBe('−$12.34M to −$12.31M');
    expect(rangeWith(12_310_000, 12_340_000, money, '–')).toBe('$12.31M–$12.34M');
    expect(rangeWith(1.2, 3.4, (v) => `${v.toFixed(1)} wins`)).toBe('1.2 wins to 3.4 wins');
    expect(rangeWith(2, 2, (v) => `${v} wins`)).toBe('2 wins');
  });
});

describe('ranges, records and lists', () => {
  it('uses an en dash', () => {
    expect(span(2026, 2030)).toBe('2026–2030');
    expect(span(-3, 5)).toBe('−3–5');
    expect(span('2026', '2030')).toBe('2026–2030');
    expect(span(45, 45)).toBe('45');
    expect(record(30, 30)).toBe('30–30');
    expect(record(0, 15)).toBe('0–15');
    expect(record(88, 74, 1)).toBe('88–74–1');
    expect(record(1204, 1180)).toBe('1,204–1,180');
  });

  it('joins a list as a sentence does', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['a glove late'])).toBe('a glove late');
    expect(listWords(['a', 'b'], 'or')).toBe('a or b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('innings in baseball notation (B-09)', () => {
  it('writes outs as innings and thirds, never a decimal', () => {
    expect(innings(0)).toBe('0.0');
    expect(innings(1)).toBe('0.1');
    expect(innings(2)).toBe('0.2');
    expect(innings(3)).toBe('1.0');
    expect(innings(32)).toBe('10.2');
    expect(innings(101)).toBe('33.2');
    expect(innings(3 * 1204 + 1)).toBe('1,204.1');
  });

  it('reads innings kept as a decimal back to outs', () => {
    expect(inningsOf(32 / 3)).toBe('10.2');
    expect(inningsOf(10.7)).toBe('10.2');
    expect(inningsOf(10.3)).toBe('10.1');
    expect(inningsOf(33.7)).toBe('33.2');
    expect(inningsOf(38.3)).toBe('38.1');
    expect(inningsOf(6)).toBe('6.0');
  });

  it('says innings in a sentence', () => {
    expect(inningsWords(3)).toBe('1 inning');
    expect(inningsWords(36)).toBe('12 innings');
    expect(inningsWords(37)).toBe('12.1 innings');
    expect(inningsWords(2)).toBe('0.2 innings');
  });
});

describe('the pages write numbers through it (B-06, B-09)', () => {
  it('the money formatters agree, carry, and put the sign first (SRVHEALTH-05)', () => {
    // Before the fix: "$1000K" from both, "$-1.5M", "−$1000K", and $2,345,000 as "$2.3M" on one page and "$2.35M" on another
    expect(playerMoney(999_600)).toBe('$1M');
    expect(dollars(999_600)).toBe('$1M');
    expect(playerMoney(-1_500_000)).toBe('−$1.5M');
    expect(playerSignedMoney(-999_700)).toBe('−$1M');
    expect(playerMoney(2_345_000)).toBe(dollars(2_345_000));
    expect(costRangeText(780_000, 790_000)).toBe('$780K–$790K');
    expect(playerOrdinal(21)).toBe('21st');
  });

  it('writes the IP column in baseball notation, and every other integer stat grouped with a real minus', () => {
    const ip = PITCHING_STATS.find((d) => d.key === 'ip')!;
    expect(ip.format).toBe('ip');
    expect(statText(ip, 32 / 3)).toBe('10.2');
    expect(statText(ip, 10.7)).toBe('10.2');
    expect(statText(ip, 33.7)).toBe('33.2');
    expect(statText(ip, 0)).toBe('0.0');
    const k = PITCHING_STATS.find((d) => d.key === 'k')!;
    expect(statText(k, 2076)).toBe('2,076');
    const war = PITCHING_STATS.find((d) => d.key === 'war')!;
    expect(statText(war, -0.1)).toBe('−0.1');
  });

  it('a pitcher\'s line says innings from outs, one inning singular, and a record with an en dash', () => {
    const line = { playerId: 1, name: 'A', w: 7, l: 4, saves: null, er: null, outs: 37, games: 5, starts: 5 };
    expect(pitcherLineWords(line, 'starter')).toBe('7–4 · 12.1 innings');
    expect(pitcherLineWords({ ...line, w: null, outs: 3 }, 'reliever')).toContain('1 inning');
    expect(pitcherLineWords({ ...line, w: null, outs: 3 }, 'reliever')).not.toContain('1 innings');
  });
});

describe('the module is a leaf', () => {
  it('imports nothing, so it can reach no rating, philosophy or judgment', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'server', 'numberWords.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bimport\b|\brequire\(/);
  });
});
