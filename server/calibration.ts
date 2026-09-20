/**
 * The stamp every calibrated or provisional constant carries.
 *
 * A number that steers a scouting conclusion is never a bare literal: it is declared once, in the
 * module that owns it, and says whether it has been tuned against outcomes (`calibrated`, with
 * what it was tuned on) or is still a first-pass judgment (`provisional`). Re-running
 * `scripts/calibrate.ts` on a fresh save and editing the declarations is how a constant is
 * refreshed; the run is recorded in docs/CALIBRATION.md and named here so every stamp points at it.
 */

export interface CalibrationStamp {
  status: 'calibrated' | 'provisional';
  /** What the numbers rest on, in words. */
  basis: string;
  /** The tuning run, for a calibrated stamp. */
  run: string | null;
}

/** The run the current calibrated constants come from. One edit here re-points every stamp. */
export const CALIBRATION_RUN = 'scripts/calibrate.ts on the 2026-05-16 Arizona save (real MLB history 2003-2025), recorded in docs/CALIBRATION.md';

export const calibrated = (basis: string): CalibrationStamp => ({ status: 'calibrated', basis, run: CALIBRATION_RUN });
export const provisional = (basis: string): CalibrationStamp => ({ status: 'provisional', basis, run: null });
