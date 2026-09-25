import { Tip } from '../../Tip';
import type { Overview } from './types';

/**
 * Where the roster review's yardsticks come from (D-053): one plain line, with the detail in a hover. The server writes both
 * (`server/mlbCalibration.ts`); the record behind them (checks, windows, verdicts) is in the API for anyone who wants it.
 */
export function Yardsticks({ data }: { data: Overview }) {
  const y = data.yardsticks;
  if (!y) return null;
  return (
    <p className="muted mlb-yardsticks">
      <Tip label={y.line} tip={y.tip} focusable />
    </p>
  );
}
