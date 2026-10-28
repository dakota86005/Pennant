/**
 * The stamp every constant that steers a scouting conclusion carries.
 *
 * A number that steers a conclusion is never a bare literal: it is declared once, in the module
 * that owns it, and says which of three kinds it is.
 *
 *   calibrated    estimated from historical evidence: a stabilization constant, a slope, an aging
 *                 rate. It is right or wrong, and `scripts/calibrate.ts` says how right, with what
 *                 it was tuned on.
 *   provisional   a MODEL parameter that ought to be estimated but has not been yet, because the
 *                 evidence does not exist or is too thin (one partial season of zone ratings). A
 *                 first-pass number, expected to move.
 *   policy        a product or organizational decision about WHEN to raise something or how loudly:
 *                 "moderate concern begins here", "a platoon problem is this many points". Not a
 *                 fact about baseball, so no backtest can call it optimal; it is chosen, stated and
 *                 shown, and changed by decision (docs/DECISIONS.md), never by fitting.
 *
 * The mechanisms themselves (results are sample-aware, a hitter is bat plus glove at his position,
 * philosophy shades only after validity) are ARCHITECTURE: they carry no stamp, they are the
 * design, and tests pin them.
 *
 * Re-running `scripts/calibrate.ts` on a fresh save and editing the declarations is how a calibrated
 * constant is refreshed; the run is recorded in docs/CALIBRATION.md and named here so every stamp
 * points at it. A policy constant is not re-run, it is decided.
 *
 * D-053 amends this for new work: calibration belongs to the save. A `calibrated` value is fitted on
 * the save's own history, stored per save with a run record that is its stamp, and refitted after an
 * import; code keeps the method, the policy and a `provisional` fallback prior (Player Value's
 * production is the first: playerValueProductionFit.ts, playerValueFitStore.ts). The constants stamped
 * with `calibrated()` below are not yet migrated (docs/ROADMAP.md).
 */

export interface CalibrationStamp {
  status: 'calibrated' | 'provisional' | 'policy';
  /**
   * What the numbers rest on: the developer's record (the method, the file, the command, the decision's id, the save it
   * was measured on). Never served: a page says a stamp in the GM's words (`stampWords`, presentation/claim.ts; B-01).
   */
  basis: string;
  /** The tuning run, for a calibrated stamp: the developer's record too, never served. */
  run: string | null;
  /**
   * The stamp in the GM's words, where a plain line says more than how it is called: a stated line's own terms ("a season
   * further out counts 5% less"). One short sentence with no file, command, doc id or save name; without it a page says the
   * stamp by its status alone.
   */
  says?: string;
}

/** The run the current calibrated constants come from. One edit here re-points every stamp. */
export const CALIBRATION_RUN = 'scripts/calibrate.ts on the 2026-05-16 Arizona save (real MLB history 2003-2025), recorded in docs/CALIBRATION.md';

/** `says`, where given, is the stamp's plain line for the GM (`CalibrationStamp.says`); `basis` stays the developer's record. */
const withSays = (stamp: CalibrationStamp, says: string | undefined): CalibrationStamp => (says ? { ...stamp, says } : stamp);
/** A constant fitted once on real major-league history (`CALIBRATION_RUN`), said so: never "this save's own" (D-053). */
export const MEASURED_ELSEWHERE = 'Measured on real major-league seasons, not on this save';
/**
 * A fit that serves the save's own values for some of its parts and the starting values for the rest, said so: never the
 * plain "measured on this save's own seasons" a whole fit earns (batch 13 review, L4; D-053).
 */
export const PARTLY_MEASURED_HERE = "Measured on this save in part; the rest are Pennant's starting values";
export const calibrated = (basis: string, says: string = MEASURED_ELSEWHERE): CalibrationStamp => withSays({ status: 'calibrated', basis, run: CALIBRATION_RUN }, says);

/**
 * The plain lines of Player Value's stated policies: each policy stamp's `says`, and what a page that states the policy
 * without reading the value modules says (Finance's Contracts and Payroll; B-01).
 */
export const VALUE_POLICY_SAYS = {
  surplus: "Pennant's value policy: a season further out counts 5% less, and the price of a win is held flat",
  clubRange: "Pennant's rule for the club's range: each player's range is added as if unrelated to the others'",
  dealRange: "Pennant's rule for a deal's range: each player's range is added as if unrelated to the others'",
} as const;
export const provisional = (basis: string, says?: string): CalibrationStamp => withSays({ status: 'provisional', basis, run: null }, says);
export const policy = (basis: string, says?: string): CalibrationStamp => withSays({ status: 'policy', basis, run: null }, says);
