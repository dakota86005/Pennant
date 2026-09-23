/**
 * Every constant that steers a Player Value answer, declared once and stamped (D-041, D-052).
 *
 * The register is docs/PLAYER_VALUE.md Part 11. Phase 1 (contract facts and control) needs almost
 * none: the league's rules are READ (free-agency and arbitration lines, the minimum salary, the
 * service-year length), never assumed, and a missing one is unknown. What is left is one policy
 * and the words that say why a cost is not yet stated.
 *
 * The mechanisms carry no stamp and tests pin them: unknown is never a default, a minor leaguer's
 * control is read from his parent league, eligibility comes from Player Rights and is never
 * re-derived here, an option is shown on both branches.
 *
 * `tests/playerValueBoundary.test.ts` fails if another Player Value module declares a number of
 * its own.
 */

import { policy, provisional, type CalibrationStamp } from './calibration.js';

/**
 * How many seasons a control timeline runs: to the end of control, capped here (owner, Q-3). The
 * horizon is what the club owns; a longer contract is shown in full in the contract facts, and
 * the timeline says control continues past its last season.
 */
export const CONTROL_HORIZON_SEASONS = 7;

export const CONTROL_HORIZON_CALIBRATION: CalibrationStamp = policy(
  'The horizon runs to the end of control, capped at seven seasons (owner answer Q-3, PLAYER_VALUE.md Part 12). ' +
    'Control is what the club owns; beyond seven seasons no projection means anything.'
);

/**
 * Why a pre-arbitration or arbitration season has no cost band yet. Both bands are priced in wins
 * against the league's price of a win (PLAYER_VALUE.md Part 4.4, R-5, R-6), which phases 2 and 4
 * build. Until then the cost is unknown: never the league minimum, never a point.
 */
export const COST_PENDING_PRICE_OF_A_WIN = 'pending price of a win (phase 2/4)';

/** Why a reserve-clause renewal has no cost band yet: it is read from the league's observed pay (phase 2). */
export const COST_PENDING_OBSERVED_PAY = "pending the league's observed pay (phase 2)";

// ── phase 2: Club Finances and the opening price of a win (PLAYER_VALUE.md Parts 2.4, 4.1, 4.3) ──

/**
 * What the opening price is, in its own words: the imported market (R-1). A historical start ships
 * the real world's contracts, so the price describes that market, not how OOTP prices players. It
 * keeps this label until observed signings replace it (phase 4).
 */
export const OPENING_PRICE_LABEL = 'opening: the imported market';

/** When the opening price gives way (owner, Q-4). Nothing in one import narrows it. */
export const PRICE_NARROWS_WHEN =
  'Only observed signings across imports narrow it: a measured price replaces this one when its band is narrower (owner Q-4, phase 4). Nothing in a single import narrows it.';

/**
 * Which contracts are market prices: those of players Player Rights finds free-agency eligible THIS
 * season, i.e. by service at the last winter, when this season's salary was set. A player whose
 * answer is indeterminate is neither market nor held below it. The alternative (service including
 * this season's days, R-5's reading) is named in the basis and not used.
 */
export const MARKET_CONTRACT_CALIBRATION: CalibrationStamp = policy(
  'A market contract is one whose holder Player Rights finds free-agency eligible this season (service at the last winter, when the salary was set). ' +
    'What "the market" is taken to mean is a decision (PLAYER_VALUE.md 4.1, Part 11), not a fit.'
);

/**
 * The opening price's bases and its band: R-5's bases, computed from this import, and the band is
 * their spread (lowest to highest market basis), not a statistical interval.
 */
export const OPENING_PRICE_CALIBRATION: CalibrationStamp = provisional(
  "R-5's bases on this import: free-agency-eligible salary above the minimum over prior-season WAR, the two-season mean and this season's pace, " +
    'and the same for contracts starting this season (salary, average annual value, pace). The band is their spread. Replaced by observed signings (phase 4).'
);

/** The central reading is the median of the market bases: no basis is preferred over another. */
export const OPENING_PRICE_CENTRAL_CALIBRATION: CalibrationStamp = policy(
  'The central value is the median of the market bases that could be computed. R-5 prefers none of them, so none is chosen; the median is the reading that leans on no single one.'
);

/**
 * The opening replacement level: the one the export's own WAR implies, (league wins − league WAR) ÷
 * league games, measured per season (R-4). OOTP's convention, not a measurement of the talent a club
 * can get for the minimum; phase 4 measures that from freely available talent.
 */
export const REPLACEMENT_LEVEL_CALIBRATION: CalibrationStamp = provisional(
  "The level the export's WAR implies, measured per season from the export's standings and WAR (R-4: .288 in 2024, .293 in 2026 to date on the imported save). " +
    'OOTP\'s convention, not a measurement of freely available talent (phase 4).'
);

/**
 * Which financial row is authoritative (R-7 leaves it unresolved): each figure comes from the one
 * row that states its season. This season is `team_financials` (the export's current state); a past
 * season is `team_history_financials` for that year. `team_last_financials` states no season, so it
 * is named and compared, never used and never blended.
 */
export const FINANCE_ROW_CALIBRATION: CalibrationStamp = policy(
  'Each figure is read from the row that names its season: team_financials for this season, team_history_financials for a past one. ' +
    'team_last_financials names no season; it is reported beside last season where it disagrees, and never used or averaged (R-7).'
);

/**
 * A financial row whose every money field is zero is a placeholder the export wrote without figures
 * (every club-season before 2025 on the imported save, and one club in 2025), read as unknown and
 * never as $0 (R-1, D-018).
 */
export const PLACEHOLDER_ROW_CALIBRATION: CalibrationStamp = policy(
  'A financial row whose every money field is zero carries no figures: each of its values is unknown, never $0 (R-1). A zero in a row that has other figures is read as exported.'
);
