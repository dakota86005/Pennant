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
 */

export interface CalibrationStamp {
  status: 'calibrated' | 'provisional' | 'policy';
  /** What the numbers rest on, in words. */
  basis: string;
  /** The tuning run, for a calibrated stamp. */
  run: string | null;
}

/** The run the current calibrated constants come from. One edit here re-points every stamp. */
export const CALIBRATION_RUN = 'scripts/calibrate.ts on the 2026-05-16 Arizona save (real MLB history 2003-2025), recorded in docs/CALIBRATION.md';

export const calibrated = (basis: string): CalibrationStamp => ({ status: 'calibrated', basis, run: CALIBRATION_RUN });
export const provisional = (basis: string): CalibrationStamp => ({ status: 'provisional', basis, run: null });
export const policy = (basis: string): CalibrationStamp => ({ status: 'policy', basis, run: null });
