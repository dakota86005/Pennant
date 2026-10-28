/**
 * Numbers in words: the one way the server writes a count, a plural, an ordinal, money, a percentage, a signed change,
 * a range or record, and innings, in every string it serves (B-06, B-09). A count is grouped ("2,076"), a negative
 * carries a real minus sign ("−21", never "-21"), money puts the sign before the dollar sign and carries a rounding
 * into the next unit ("−$3.2M", "$1M", never "$-3.2M" or "$1000K"), a range or record takes an en dash ("15–15"), and
 * innings are written in baseball notation from outs ("10.2", never "10.7").
 *
 * Pure and dependency-free, beside `timeWords.ts`: the presentation layer and the specialists that write served text
 * (Player Value, MLB Operations, the farm, Player Rights, the staff) all import it, and it imports nothing, so it can
 * reach no rating, philosophy or judgment (`tests/numberWords.test.ts` holds it to that). It formats what it is handed:
 * an unknown is the caller's to say in words, never turned into a zero here.
 */

/** The minus sign (U+2212), for every negative number the GM reads. */
export const MINUS = '−';
/** The en dash (U+2013), for a range ("2026–2030") and a record ("30–30"). */
export const EN_DASH = '–';

const FORMATS = new Map<string, Intl.NumberFormat>();
/** A cached en-US formatter: grouped, at least `min` and at most `max` decimals. */
function formatter(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = FORMATS.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true });
    FORMATS.set(key, f);
  }
  return f;
}

/** A magnitude grouped, then signed with a real minus when it is negative and doesn't round to zero. */
function signedWith(n: number, body: (a: number) => string, plus = false): string {
  const text = body(Math.abs(n));
  const zero = !/[1-9]/.test(text);
  if (zero) return text;
  return n < 0 ? `${MINUS}${text}` : plus ? `+${text}` : text;
}

/**
 * A number with thousands grouped and a real minus sign, to `digits` decimals: "2,076", "−21", "3.5". A value that
 * rounds to zero is "0", never "−0".
 */
export function num(n: number, digits = 0): string {
  return signedWith(n, (a) => formatter(digits, digits).format(a));
}

/** A count: rounded to a whole number, grouped ("2,076"). */
export const count = (n: number): string => num(Math.round(n));

/**
 * A figure that is not whole, as a decimal: one place, or more where one place would read as a whole number it is not
 * ("2.5", "1.04", never "1.0"), up to three.
 */
function decimal(n: number): string {
  for (const digits of [1, 2]) {
    const text = num(n, digits);
    if (!/\.0+$/.test(text)) return text;
  }
  return num(n, 3);
}

/**
 * A count and its noun, singular only for exactly one: "1 game", "4 games", "2,076 players", "0 errors". A figure that is
 * not whole is read as a decimal with a plural noun ("2.5 days", "1.04 days"), never "1.0 days".
 */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${Number.isInteger(n) ? num(n) : decimal(n)} ${n === 1 ? one : many}`;

/** A signed change, grouped, with a plus for a gain and a real minus for a loss; zero has no sign: "+12", "−4", "0". */
export const signed = (n: number, digits = 0): string => signedWith(n, (a) => formatter(digits, digits).format(a), true);

/** "1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "22nd", "101st", "112th". Rounded to a whole number first. */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const tens = Math.abs(r) % 100;
  const ones = Math.abs(r) % 10;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  return `${num(r)}${suffix}`;
}

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
/** "first" to "tenth" in words, then "11th", "21st": the way a sentence says a place. */
export const ordinalWord = (n: number): string => ORDINAL_WORDS[Math.round(n) - 1] ?? ordinal(n);

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** "zero" to "twenty" in words, then figures ("21", "2,076"): the way a sentence says a small count. */
export const numberWord = (n: number): string => (Number.isInteger(n) && n >= 0 ? NUMBER_WORDS[n] : undefined) ?? (Number.isInteger(n) ? num(n) : decimal(n));

/**
 * A share of a whole (0.34) as a percentage: "34%", "12.5%" at one decimal, "−3%". The caller passes a fraction; a
 * figure already on 0–100 goes through `percentOf100`.
 */
export const percent = (fraction: number, digits = 0): string => `${num(fraction * 100, digits)}%`;

/** A figure already on 0–100 (a stat line's BB%) as a percentage: "8.5%". */
export const percentOf100 = (value: number, digits = 0): string => `${num(value, digits)}%`;

// ── money ────────────────────────────────────────────────────────────────────

/** Places for a figure in millions or billions: two under ten, one from ten (after rounding to the hundredth), plus `extra`. */
const placesFor = (v: number, extra: number): number => (Math.round(v * 100) >= 1_000 ? 1 : 2) + extra;
/** `v` rounded to `places` decimals, as a number: whether a rounding carries into the next unit. */
const roundedTo = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

/**
 * The one money precision rule: whole thousands ("$780K"; anything under $500 is "$0" and $500 to $999 is "$1K", because
 * a value is never known to the dollar), millions to two places under ten million and one place from ten million
 * ("$2.35M", "$8.5M", "$1M", "$12.5M", "$28M"), and billions the same way ("$1.25B", "$12.5B"), trailing zeros dropped. A
 * rounding carries into the next unit ($999,600 is "$1M", never "$1000K"; $999.96M is "$1B", never "$1,000M"). `extra`
 * adds places (a range whose ends would otherwise print alike: "$780.1K–$780.4K"); under $1K, a range like that is told
 * apart in whole dollars ("$120–$380").
 */
function moneyBody(a: number, extra = 0): string {
  if (extra > 0 && Math.round(a) < 1_000) return `$${Math.round(a)}`;
  const thousands = Math.round(a / 1_000);
  if (thousands === 0) return '$0';
  if (thousands < 1_000) return `$${formatter(0, extra).format(extra === 0 ? thousands : a / 1_000)}K`;
  const m = a / 1_000_000;
  const mPlaces = placesFor(m, extra);
  if (roundedTo(m, mPlaces) < 1_000) return `$${formatter(0, mPlaces).format(m)}M`;
  const b = a / 1_000_000_000;
  const bPlaces = placesFor(b, extra);
  return `$${formatter(0, bPlaces).format(b)}B`;
}

/** Money with the sign before the dollar sign: "$2.35M", "$780K", "−$3.2M", "$0". */
export const money = (v: number): string => signedWith(v, (a) => moneyBody(a));

/** Money with a plus for a gain: "+$1.5M", "−$900K", "$0". */
export const signedMoney = (v: number): string => signedWith(v, (a) => moneyBody(a), true);

/**
 * A money range: "$4.6M–$25.3M", "$780K–$790K", or one figure for a point. Ends that differ never print alike: they take
 * more places until they part ("$12.31M to $12.34M", never "$12.3M to $12.3M"). The ends are joined by an en dash, or by
 * `separator` where a sentence says it in words (`' to '`).
 */
export function moneyRange(low: number, high: number, separator: string = EN_DASH): string {
  return moneyEnds(low, high, separator, false);
}

/** Two money ends that never print alike, each signed with a plus for a gain when `plus` is set. */
function moneyEnds(low: number, high: number, separator: string, plus: boolean): string {
  if (low === high) return signedWith(low, (a) => moneyBody(a), plus);
  for (const extra of [0, 1, 2]) {
    const a = signedWith(low, (x) => moneyBody(x, extra), plus);
    const b = signedWith(high, (x) => moneyBody(x, extra), plus);
    if (a !== b) return `${a}${separator}${b}`;
  }
  return `${signedWith(low, (x) => moneyBody(x, 3), plus)}${separator}${signedWith(high, (x) => moneyBody(x, 3), plus)}`;
}

/** A money range in a sentence: "$4.6M to $25.3M" (`moneyRange` with " to "). */
export const moneyRangeWords = (low: number, high: number): string => moneyRange(low, high, ' to ');

/**
 * Two ends written by `fmt` and joined by `separator` (" to " by default), or one figure where they meet. Money written
 * by `money` or `signedMoney` goes through `moneyRange`'s rule, so ends that differ never print alike.
 */
export function rangeWith(low: number, high: number, fmt: (v: number) => string, separator = ' to '): string {
  if (fmt === money || fmt === signedMoney) return moneyEnds(low, high, separator, fmt === signedMoney);
  return low === high ? fmt(low) : `${fmt(low)}${separator}${fmt(high)}`;
}

// ── ranges, records and lists ────────────────────────────────────────────────

/**
 * Two ends with an en dash: "2026–2030", "45–55", "−3–5"; one figure when they meet. A number end is written whole and
 * ungrouped (a season or a grade, never "2,026"), with a real minus sign.
 */
export function span(from: number | string, to: number | string): string {
  const end = (v: number | string) => (typeof v === 'number' ? (v < 0 ? `${MINUS}${Math.abs(v)}` : String(v)) : v);
  const a = end(from);
  const b = end(to);
  return a === b ? a : `${a}${EN_DASH}${b}`;
}

/** A won–lost record with an en dash, ties when there are any: "30–30", "88–74–1", "1,204–1,180". */
export const record = (w: number, l: number, t?: number | null): string =>
  `${num(w)}${EN_DASH}${num(l)}${t ? `${EN_DASH}${num(t)}` : ''}`;

/** A list in a sentence: "a", "a and b", "a, b and c" (or "or"). */
export function listWords(items: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

// ── innings ──────────────────────────────────────────────────────────────────

/**
 * Innings in baseball notation, from outs: the figure after the point is the outs of a partial inning, so it is only
 * ever 0, 1 or 2 ("10.2" is ten and two-thirds innings, never "10.7"). 0 outs is "0.0", 1 is "0.1", 2 is "0.2".
 */
export function innings(outs: number): string {
  const o = Math.max(0, Math.round(outs));
  return `${num(Math.floor(o / 3))}.${o % 3}`;
}

/** The outs in innings kept as a decimal (outs / 3, perhaps rounded to a tenth): 10.7 → 32. */
export const outsOf = (decimalInnings: number): number => Math.round(decimalInnings * 3);

/** Innings kept as a decimal (outs / 3) in baseball notation: 10.67 → "10.2". */
export const inningsOf = (decimalInnings: number): string => innings(outsOf(decimalInnings));

/** Innings in a sentence: "1 inning", "12 innings", "12.1 innings", "0.2 innings". */
export function inningsWords(outs: number): string {
  const o = Math.max(0, Math.round(outs));
  const text = o % 3 === 0 ? num(o / 3) : innings(o);
  return `${text} ${o === 3 ? 'inning' : 'innings'}`;
}
