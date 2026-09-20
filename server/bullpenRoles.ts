/**
 * The bullpen as it is actually used: who pitches when the game is on the line, and whether the
 * arms are where the estimates say they should be.
 *
 * A reliever's label says only that he relieves. Usage says how much his innings matter: the leverage
 * the game put him in (1.0 is neutral; a closer averages about 2), how many innings he throws per
 * appearance, and whether he finishes games or holds leads. Two things follow.
 *
 *   stakes       a weak arm in the highest-leverage role costs more than one in the seventh inning of a
 *                blowout, so the review weighs how concerning a finding is by his role
 *   deployment   the best arms belong in the highest-leverage spots. When a weaker arm is used in higher
 *                leverage than a clearly better one, that is a finding for the manager, not a roster
 *                move: it costs nothing to fix
 *
 * Pure: usage in, tiers and findings out. The thresholds come from the league's own distribution of
 * relievers' leverage (docs/CALIBRATION.md section 8): median 1.10, top quartile 1.39, closers (three
 * or more saves) 2.09 on average, setup men (three or more holds) 1.23.
 */

import { calibrated, provisional, type CalibrationStamp } from './calibration.js';

export const BULLPEN_CALIBRATION: CalibrationStamp = calibrated(
  'The leverage cut-offs sit on the league\'s own distribution of relievers (2026 to date: median 1.10, top quartile 1.39, closers 2.09 on average); the deployment gap and the minimum appearances are policy thresholds.'
);
export const BULLPEN_POLICY: CalibrationStamp = provisional('The minimum appearances, the long-man innings and the deployment gap are policy thresholds.');

/** CALIBRATED. Average leverage per batter faced at which a reliever is used as a closer (with a save), as a high-leverage arm, and below which he is in low-leverage spots. */
export const LEVERAGE = { closer: 1.6, high: 1.3, low: 0.9 } as const;
/** PROVISIONAL (policy). Fewest appearances before a role is read from usage. */
export const MIN_APPEARANCES = 8;
/** PROVISIONAL (policy). Innings per appearance at or above which a reliever below high leverage is a long man. */
export const LONG_INNINGS = 1.6;
/** PROVISIONAL (policy). Points of working estimate by which a lower-leverage arm must beat a higher-leverage one to call the deployment backwards. */
export const DEPLOYMENT_GAP = 15;

export type BullpenTier = 'closer' | 'high_leverage' | 'middle' | 'low_leverage' | 'long' | 'unknown';
export type Stakes = 'high' | 'medium' | 'low';

export interface BullpenUsage {
  playerId: number;
  name: string;
  /** Appearances this season. */
  g: number;
  /** Innings pitched this season. */
  ip: number;
  sv: number;
  hld: number;
  /** Average leverage per batter faced this season (1.0 neutral); null when the export carries none. */
  leverage: number | null;
}

export interface BullpenRole {
  tier: BullpenTier;
  stakes: Stakes | null;
  text: string;
}

const TIER_WORD: Record<BullpenTier, string> = {
  closer: 'closer', high_leverage: 'high-leverage arm', middle: 'middle reliever', low_leverage: 'low-leverage arm', long: 'long man', unknown: 'role not yet clear',
};
const STAKES: Record<BullpenTier, Stakes | null> = { closer: 'high', high_leverage: 'high', middle: 'medium', low_leverage: 'low', long: 'low', unknown: null };

export function roleOf(u: BullpenUsage): BullpenRole {
  if (u.g < MIN_APPEARANCES || u.leverage === null) {
    return { tier: 'unknown', stakes: null, text: u.g < MIN_APPEARANCES ? `Only ${u.g} appearances, too few to read a role from usage.` : 'The export carries no leverage for him.' };
  }
  const perApp = u.g > 0 ? u.ip / u.g : 0;
  let tier: BullpenTier;
  if (u.leverage >= LEVERAGE.closer && u.sv > 0) tier = 'closer';
  else if (u.leverage >= LEVERAGE.high) tier = 'high_leverage';
  else if (perApp >= LONG_INNINGS) tier = 'long';
  else if (u.leverage < LEVERAGE.low) tier = 'low_leverage';
  else tier = 'middle';
  const bits = [`leverage ${u.leverage.toFixed(2)}`, `${perApp.toFixed(1)} innings per appearance`, ...(u.sv > 0 ? [`${u.sv} save${u.sv === 1 ? '' : 's'}`] : []), ...(u.hld > 0 ? [`${u.hld} hold${u.hld === 1 ? '' : 's'}`] : [])];
  return { tier, stakes: STAKES[tier], text: `Used as a ${TIER_WORD[tier]} (${bits.join(', ')}).` };
}

export interface DeploymentFinding {
  /** The arm in the higher-leverage role, and the better arm in a lower one. */
  used: { playerId: number; name: string; tier: BullpenTier; estimate: number };
  better: { playerId: number; name: string; tier: BullpenTier; estimate: number };
  gap: number;
  text: string;
}

const RANK: Record<BullpenTier, number> = { closer: 0, high_leverage: 1, middle: 2, long: 3, low_leverage: 3, unknown: 9 };

/**
 * Where a clearly better arm is used in lower leverage than a clearly worse one. Only arms with a known estimate and a read role count; the most
 * telling pair (the biggest gap) is reported per higher-leverage arm, so one weak closer is one finding.
 */
export function deploymentFindings(arms: Array<{ playerId: number; name: string; tier: BullpenTier; estimate: number | null }>): DeploymentFinding[] {
  const known = arms.filter((a): a is typeof a & { estimate: number } => a.estimate !== null && a.tier !== 'unknown');
  const findings: DeploymentFinding[] = [];
  for (const worse of known.filter((a) => a.tier === 'closer' || a.tier === 'high_leverage')) {
    const better = known
      .filter((b) => RANK[b.tier] > RANK[worse.tier] && b.estimate - worse.estimate >= DEPLOYMENT_GAP)
      .sort((a, b) => b.estimate - a.estimate || a.name.localeCompare(b.name))[0];
    if (!better) continue;
    const gap = better.estimate - worse.estimate;
    findings.push({
      used: { playerId: worse.playerId, name: worse.name, tier: worse.tier, estimate: worse.estimate },
      better: { playerId: better.playerId, name: better.name, tier: better.tier, estimate: better.estimate },
      gap,
      text: `${worse.name} is used as a ${TIER_WORD[worse.tier]} (working estimate ${Math.round(worse.estimate)}th percentile) while ${better.name} (${Math.round(better.estimate)}th) works as a ${TIER_WORD[better.tier]}: the better arm is in the lower-leverage role. That is a usage decision for the manager, not a roster move.`,
    });
  }
  return findings.sort((a, b) => b.gap - a.gap || a.used.name.localeCompare(b.used.name));
}
