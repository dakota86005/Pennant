/**
 * What a holder of a role typically looks like in this league: the peer standard a concern is measured against.
 *
 * A working estimate is a percentile among ALL major-league hitters (or pitchers of a kind). The same estimate means different
 * things in different jobs: regulars at first base and designated hitter typically sit at the 73rd to 77th percentile, at
 * second base, third base and center field near the 50th, because those positions are paid for their gloves and their
 * bats are allowed to be ordinary. A reliever used as a long man is expected to be the weakest arm in the pen; a closer is
 * not. A concern that ignores the role flags the wrong men. Measured across the 30 clubs before this module existed, it
 * flagged a lineup regular on 25 of them, most of them shortstops and center fielders with ordinary bats and good gloves,
 * and never flagged a first baseman with a mediocre bat.
 *
 * So a holder is a concern when he is unusually weak FOR HIS ROLE: below the floor, the level under which only about a
 * tenth of the league's holders of that role sit. The role's typical level and that floor are shown with every finding, so
 * the reason is never a hidden adjustment: "regular left fielders typically work at about 68; below 48 is unusual".
 *
 * Three kinds of number live here and the stamps say which:
 *
 *   the typical levels   DESCRIPTIVE and PROVISIONAL. The median estimate of each role across the 30 clubs' production review
 *                        (`scripts/calibrate.ts standards`), one snapshot (43 games) of one league. They will move with the
 *                        season and the roster pool, so re-run the harness and edit them here.
 *   the spread           the pooled 10th-percentile deviation from each role's median. Stable, because it is pooled.
 *   the quantile         POLICY. That "unusually weak" means the lowest tenth is a decision, not a fact about baseball.
 *
 * Pure data and lookups: no table, no rating.
 */

import type { BullpenTier } from './bullpenRoles.js';
import { policy, provisional, type CalibrationStamp } from './calibration.js';

export const ROLE_STANDARDS_CALIBRATION: CalibrationStamp = provisional(
  'The typical estimate of each role is the median of the production review across the 30 clubs (2026-05-16, about 43 games; scripts/calibrate.ts standards): descriptive, one snapshot of one league, expected to move as the season and the rosters do. The pooled spread is stable.'
);

export const ROLE_FLOOR_POLICY: CalibrationStamp = policy(
  'That "unusually weak for the role" means the lowest tenth of the league\'s holders (FLOOR_QUANTILE), and "well below" the lowest twentieth (DEEP_QUANTILE), are decisions about when to raise a flag and how loudly, not facts about baseball.'
);

/** POLICY. The share of the league's holders of a role that sits below its floor: "unusually weak for the job" (a moderate case when both lenses agree). */
export const FLOOR_QUANTILE = 0.1;
/** POLICY. The share below the deep floor: "well below what the job takes" (a strong case when both lenses agree). */
export const DEEP_QUANTILE = 0.05;

/**
 * DERIVED. The pooled deviation of the 10th and the 5th percentile from each role's median: how far below typical "unusually weak"
 * and "well below" are, by group (scripts/calibrate.ts standards, STANDARD_QUANTILE 0.10 and 0.05). Pooled across a group's roles,
 * so it is steady where a single role's own tail (25 to 60 holders) is not.
 */
export const FLOOR_GAP = { hitter: -20, starter: -22, reliever: -18 } as const;
export const DEEP_GAP = { hitter: -26, starter: -25, reliever: -21 } as const;

export interface RoleStandard {
  /** What the role is called: "left field regulars", "closers". */
  label: string;
  /** The median working estimate of the league's holders of the role. */
  typical: number;
  /** Below this a holder is unusually weak for the role (the lowest tenth of the league's holders). */
  floor: number;
  /** Below this he is well below what the job takes (the lowest twentieth). */
  deepFloor: number;
  /**
   * The level under which ONE lens (his tools, or his results) is itself unusually weak for the role: the role's typical lens level
   * less the same gap. For a hitter the lens is his bat's percentile, so a first baseman's tools read as weak below 66 and a
   * shortstop's below 35; for a pitcher it is the estimate's own scale. A finding needs the two lenses to agree.
   */
  lensFloor: number;
}

const standard = (label: string, typical: number, group: keyof typeof FLOOR_GAP, lensTypical = typical): RoleStandard => ({
  label, typical, floor: typical + FLOOR_GAP[group], deepFloor: typical + DEEP_GAP[group], lensFloor: lensTypical + FLOOR_GAP[group],
});

/** DESCRIPTIVE, PROVISIONAL. Median estimate and median bat of the league's regulars at each position (2 catcher ... 9 right field, 10 DH). */
const HITTER: Record<number, { label: string; typical: number; bat: number }> = {
  2: { label: 'regular catchers', typical: 57, bat: 65 },
  3: { label: 'regular first basemen', typical: 77, bat: 86 },
  4: { label: 'regular second basemen', typical: 51, bat: 55 },
  5: { label: 'regular third basemen', typical: 49, bat: 51 },
  6: { label: 'regular shortstops', typical: 57, bat: 55 },
  7: { label: 'regular left fielders', typical: 68, bat: 75 },
  8: { label: 'regular center fielders', typical: 50, bat: 45 },
  9: { label: 'regular right fielders', typical: 62, bat: 65 },
  10: { label: 'regular designated hitters', typical: 73, bat: 76 },
};

/** The standard for a lineup regular at a position; null for a position with none (it is then judged by the fallback rule). */
export function hitterStandard(position: number | undefined): RoleStandard | null {
  const h = position === undefined ? undefined : HITTER[position];
  return h ? standard(h.label, h.typical, 'hitter', h.bat) : null;
}

/** DESCRIPTIVE, PROVISIONAL. Median estimate of the league's rotation members. */
export const STARTER_TYPICAL = 53;

export function starterStandard(): RoleStandard {
  return standard('starters in a rotation', STARTER_TYPICAL, 'starter');
}

/** DESCRIPTIVE, PROVISIONAL. Median estimate of the league's relievers by the role their usage shows. */
const RELIEVER: Record<BullpenTier, { label: string; typical: number }> = {
  closer: { label: 'closers', typical: 71 },
  high_leverage: { label: 'high-leverage arms', typical: 63 },
  middle: { label: 'middle relievers', typical: 51 },
  low_leverage: { label: 'low-leverage arms', typical: 49 },
  long: { label: 'long men', typical: 37 },
  unknown: { label: 'relievers whose role is not yet clear', typical: 38 },
};

export function relieverStandard(tier: BullpenTier | null | undefined): RoleStandard {
  const r = RELIEVER[tier ?? 'unknown'];
  return standard(r.label, r.typical, 'reliever');
}
