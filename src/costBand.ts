/**
 * How a controlled season's cost band is printed (Player Value phase 4a, review 2026-09-23). One set of words for
 * Payroll, Contracts and the card's cone, so none of them can say something different about the same band:
 *
 *   - a band never reads as a point: where its edges round alike they print finer ($780K–$790K, not $0.8M);
 *   - it is a range of reasonable readings, edge against edge: not an interval with a stated chance, and never
 *     "expected";
 *   - a season that may be free agency, or a branch the player decides, says "if held" beside the figure.
 *
 * Nothing is computed here: every figure is Player Value's, as served.
 */

export interface CostFigure {
  low: number;
  high: number;
  /** The reading at the centre of each component; null between statuses (none chosen); absent on a contract's point. */
  central?: number | null;
}

/** What every cost band is, in the pages' own words. */
export const COST_BAND_WORDS =
  'a range of reasonable readings, edge against edge (every component at its low edge, every component at its high edge): not an interval with a stated chance, and not an expectation';

/** Dollars at a precision: millions to `digits` places, or thousands below a million. */
function dollars(v: number, digits: number): string {
  if (v === 0) return '$0';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(digits)}M`;
  return `$${Math.round(v / 1_000)}K`;
}

/** One figure as the pages print money: "$8.5M", "$780K". */
export const costMoney = (v: number): string => dollars(v, 1);

/**
 * "$4.6M–$25.3M", "$780K–$790K", or "$9.0M" for a point. Edges that differ never print alike: a band whose edges
 * round to the same tenth of a million prints to the hundredth.
 */
export function costBandText(low: number, high: number): string {
  if (low === high) return dollars(low, 1);
  for (const digits of [1, 2, 3]) {
    const a = dollars(low, digits);
    const b = dollars(high, digits);
    if (a !== b) return `${a}–${b}`;
  }
  return `${dollars(low, 3)}–${dollars(high, 3)}`;
}

/** "central $780K", "no single central (between statuses)", or '' for a point. */
export function centralText(c: CostFigure): string {
  if (c.central === undefined || c.low === c.high) return '';
  if (c.central === null) return 'no single central (between statuses)';
  return `central ${costMoney(c.central)}`;
}
