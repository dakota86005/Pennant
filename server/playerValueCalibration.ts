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

import { policy, type CalibrationStamp } from './calibration.js';

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
