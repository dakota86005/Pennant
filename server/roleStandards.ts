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
   * shortstop's below 35; for a pitcher it is the estimate's own scale. A finding needs the two lenses to agree. The built-in
   * starting value, and the line for any lens the save has not measured.
   */
  lensFloor: number;
  /**
   * Each lens's own line (owner decision 2026-09-24): where the save has measured a lens on its own scale, "weak for the role on this
   * lens" is the lowest tenth of the league's holders ON THAT LENS. Absent a measurement, both are `lensFloor`.
   */
  lensFloors: { tools: number; results: number };
  /** Where the numbers come from: the save's own measurement or the built-in starting values. */
  source: 'save' | 'starting';
}

/** A group whose roles share one pooled gap. */
export type StandardGroup = keyof typeof FLOOR_GAP;

/** The role keys a standard is measured and served under: `pos2` ... `pos10`, `starter`, `rel:<tier>`. */
export const hitterKey = (position: number): string => `pos${position}`;
export const relieverKey = (tier: BullpenTier): string => `rel:${tier}`;
export const STARTER_KEY = 'starter';
export const groupOfRole = (key: string): StandardGroup => (key.startsWith('pos') ? 'hitter' : key === STARTER_KEY ? 'starter' : 'reliever');

/**
 * The standards as served: each role's typical level (and a hitter's typical bat), each group's pooled gaps, and, where measured, each
 * lens's own typical level and gap. The built-in values below are one such set (the fallback prior); a save's measurement is another
 * (`mlbCalibrationFit.ts`), used only once it has passed its checks.
 */
export interface ServedStandards {
  source: 'save' | 'starting';
  roles: Record<string, { typical: number; bat?: number }>;
  gaps: Record<StandardGroup, { floor: number; deep: number }>;
  /** Each lens's own typical per role and floor gap per group; null for a lens not measured. */
  lenses: { tools: ServedLens | null; results: ServedLens | null };
}

export interface ServedLens {
  typical: Record<string, number>;
  gap: Partial<Record<StandardGroup, number>>;
}

/** DESCRIPTIVE, PROVISIONAL (the fallback prior). Median estimate and median bat of the league's regulars at each position (2 catcher ... 9 right field, 10 DH). */
export const HITTER_STANDARD_PRIOR: Record<number, { label: string; typical: number; bat: number }> = {
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

/** DESCRIPTIVE, PROVISIONAL (the fallback prior). Median estimate of the league's rotation members. */
export const STARTER_TYPICAL = 53;

/** DESCRIPTIVE, PROVISIONAL (the fallback prior). Median estimate of the league's relievers by the role their usage shows. */
export const RELIEVER_STANDARD_PRIOR: Record<BullpenTier, { label: string; typical: number }> = {
  closer: { label: 'closers', typical: 71 },
  high_leverage: { label: 'high-leverage arms', typical: 63 },
  middle: { label: 'middle relievers', typical: 51 },
  low_leverage: { label: 'low-leverage arms', typical: 49 },
  long: { label: 'long men', typical: 37 },
  unknown: { label: 'relievers whose role is not yet clear', typical: 38 },
};

/** The built-in standards as a served set: the fallback prior, stamped provisional (ROLE_STANDARDS_CALIBRATION). */
export const STARTING_STANDARDS: ServedStandards = {
  source: 'starting',
  roles: {
    ...Object.fromEntries(Object.entries(HITTER_STANDARD_PRIOR).map(([p, h]) => [hitterKey(Number(p)), { typical: h.typical, bat: h.bat }])),
    [STARTER_KEY]: { typical: STARTER_TYPICAL },
    ...Object.fromEntries(Object.entries(RELIEVER_STANDARD_PRIOR).map(([t, r]) => [relieverKey(t as BullpenTier), { typical: r.typical }])),
  },
  gaps: {
    hitter: { floor: FLOOR_GAP.hitter, deep: DEEP_GAP.hitter },
    starter: { floor: FLOOR_GAP.starter, deep: DEEP_GAP.starter },
    reliever: { floor: FLOOR_GAP.reliever, deep: DEEP_GAP.reliever },
  },
  lenses: { tools: null, results: null },
};

/** The standards a review is judged against: one lookup per kind of role. */
export interface RoleStandardsSet {
  source: 'save' | 'starting';
  hitter(position: number | undefined): RoleStandard | null;
  starter(): RoleStandard;
  reliever(tier: BullpenTier | null | undefined): RoleStandard;
}

/** Build the lookups from a served set (the save's measurement once adopted, else the built-in starting values). */
export function standardsFrom(served: ServedStandards = STARTING_STANDARDS): RoleStandardsSet {
  const make = (label: string, key: string, fallback: { typical: number; bat?: number }): RoleStandard => {
    const role = served.roles[key] ?? fallback;
    const group = groupOfRole(key);
    const gap = served.gaps[group] ?? STARTING_STANDARDS.gaps[group];
    const lensTypical = key.startsWith('pos') ? role.bat ?? fallback.bat ?? role.typical : role.typical;
    const lensFloor = lensTypical + gap.floor;
    const lensLine = (lens: ServedLens | null): number => {
      const t = lens?.typical[key];
      const g = lens?.gap[group];
      return t === undefined || g === undefined ? lensFloor : t + g;
    };
    return {
      label, typical: role.typical, floor: role.typical + gap.floor, deepFloor: role.typical + gap.deep, lensFloor,
      lensFloors: { tools: lensLine(served.lenses.tools), results: lensLine(served.lenses.results) }, source: served.source,
    };
  };
  return {
    source: served.source,
    hitter: (position) => {
      const h = position === undefined ? undefined : HITTER_STANDARD_PRIOR[position];
      return h ? make(h.label, hitterKey(position as number), { typical: h.typical, bat: h.bat }) : null;
    },
    starter: () => make('starters in a rotation', STARTER_KEY, { typical: STARTER_TYPICAL }),
    reliever: (tier) => {
      const t = tier ?? 'unknown';
      return make(RELIEVER_STANDARD_PRIOR[t].label, relieverKey(t), { typical: RELIEVER_STANDARD_PRIOR[t].typical });
    },
  };
}

const STARTING = standardsFrom(STARTING_STANDARDS);

/** The built-in standard for a lineup regular at a position; null for a position with none (it is then judged by the fallback rule). */
export function hitterStandard(position: number | undefined): RoleStandard | null {
  return STARTING.hitter(position);
}

/** The built-in standard for a rotation member. */
export function starterStandard(): RoleStandard {
  return STARTING.starter();
}

/** The built-in standard for a reliever of the tier his usage shows. */
export function relieverStandard(tier: BullpenTier | null | undefined): RoleStandard {
  return STARTING.reliever(tier);
}
