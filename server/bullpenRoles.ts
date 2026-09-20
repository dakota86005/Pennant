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

import { calibrated, policy, type CalibrationStamp } from './calibration.js';

export const BULLPEN_CALIBRATION: CalibrationStamp = calibrated(
  'The leverage cut-offs sit on the league\'s own distribution of relievers (2026 to date: median 1.10, top quartile 1.39, closers 2.09 on average); the deployment gap and the minimum appearances are policy thresholds.'
);
export const BULLPEN_POLICY: CalibrationStamp = policy('The minimum appearances, the long-man innings and the deployment gap are policy thresholds.');

/** CALIBRATED. Average leverage per batter faced at which a reliever is used as a closer (with a save), as a high-leverage arm, and below which he is in low-leverage spots. */
export const LEVERAGE = { closer: 1.6, high: 1.3, low: 0.9 } as const;
/** PROVISIONAL (policy). Fewest appearances before a role is read from usage. */
export const MIN_APPEARANCES = 8;
/** PROVISIONAL (policy). Innings per appearance at or above which a reliever below high leverage is a long man. */
export const LONG_INNINGS = 1.6;
/** PROVISIONAL (policy). Points of working estimate by which a lower-leverage arm must beat a higher-leverage one to call the deployment backwards. */
export const DEPLOYMENT_GAP = 15;

/** POLICY. Working estimate (percentile of MLB relievers) at or above which an arm is credible for high-leverage innings: about the median reliever. */
export const CREDIBLE_HIGH_LEVERAGE = 50;
/** POLICY. How many relievers in one role make the pen crowded there: three long men or three closers is more than a bullpen usually needs. */
export const CROWDED = { long: 3, closer: 3 } as const;
/** POLICY. Fewest relievers with a read role before a pen-wide finding ("nobody throws multiple innings") is made: early in a season most roles are not yet read. */
export const MIN_READ_ARMS = 5;

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
  /** What the pen appears to be doing, what the evidence supports instead, and why the difference matters: the three things a deployment finding must say. */
  current: string;
  supported: string;
  why: string;
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
      current: `${worse.name} (working estimate ${Math.round(worse.estimate)}th percentile) is used as a ${TIER_WORD[worse.tier]}; ${better.name} (${Math.round(better.estimate)}th) works as a ${TIER_WORD[better.tier]}.`,
      supported: `The evidence puts ${better.name} ahead of ${worse.name} by ${Math.round(gap)} points, so the better arm belongs in the higher-leverage role.`,
      why: `A ${TIER_WORD[worse.tier]}'s innings come in tighter games than a ${TIER_WORD[better.tier]}'s (a closer averages about 2.0 leverage, a low-leverage arm under 1.0), so the weaker arm is pitching the innings that matter most.`,
      text: `${worse.name} is used as a ${TIER_WORD[worse.tier]} (working estimate ${Math.round(worse.estimate)}th percentile) while ${better.name} (${Math.round(better.estimate)}th) works as a ${TIER_WORD[better.tier]}: the better arm is in the lower-leverage role. That is a usage decision for the manager, not a roster move.`,
    });
  }
  return findings.sort((a, b) => b.gap - a.gap || a.used.name.localeCompare(b.used.name));
}

export type PenFindingKind = 'no_credible_high_leverage' | 'no_multi_inning' | 'crowded_role' | 'starter_conflict';

/**
 * A finding about the pen as a whole, not about one pair of arms: what its roles are now, what the evidence says they should be, and why
 * the difference matters. Each is a fact about how the pen is built and used, never a roster move.
 */
export interface PenFinding {
  kind: PenFindingKind;
  /** What the pen appears to be doing. */
  current: string;
  /** What the evidence supports instead, or what is missing. */
  supported: string;
  /** Why the mismatch matters. */
  why: string;
  players: Array<{ playerId: number; name: string; tier: BullpenTier; estimate: number | null }>;
  text: string;
}

export interface PenArm { playerId: number; name: string; tier: BullpenTier; estimate: number | null; ipPerAppearance?: number | null }

export function penFindings(arms: PenArm[]): PenFinding[] {
  const read = arms.filter((a) => a.tier !== 'unknown');
  if (read.length < MIN_READ_ARMS) return [];
  const out: PenFinding[] = [];
  const brief = (a: PenArm) => ({ playerId: a.playerId, name: a.name, tier: a.tier, estimate: a.estimate });

  // Is there anybody in the pen worth the high-leverage innings? If the best arm is below the credible line the pen has no answer, wherever he is used.
  const graded = arms.filter((a): a is PenArm & { estimate: number } => a.estimate !== null);
  const best = [...graded].sort((a, b) => b.estimate - a.estimate || a.name.localeCompare(b.name))[0];
  if (best && best.estimate < CREDIBLE_HIGH_LEVERAGE && graded.length >= MIN_READ_ARMS) {
    out.push({
      kind: 'no_credible_high_leverage',
      current: `The best arm in the pen is ${best.name} (working estimate ${Math.round(best.estimate)}th percentile of MLB relievers), used as a ${TIER_WORD[best.tier]}.`,
      supported: `No reliever reaches the ${CREDIBLE_HIGH_LEVERAGE}th percentile, about the level of an ordinary major-league reliever.`,
      why: 'The highest-leverage innings are worth about twice a middle inning (a closer averages about 2.0 leverage, a middle reliever about 1.0), and nobody here is better than ordinary to pitch them.',
      players: [brief(best)],
      text: `No reliever in the pen is a credible high-leverage arm: the best, ${best.name}, is at the ${Math.round(best.estimate)}th percentile of MLB relievers.`,
    });
  }

  // Multi-inning coverage: with enough roles read, does anybody actually work multiple innings?
  const multi = read.filter((a) => a.tier === 'long' || (a.ipPerAppearance ?? 0) >= LONG_INNINGS);
  if (multi.length === 0) {
    const top = [...read].filter((a) => a.ipPerAppearance != null).sort((a, b) => (b.ipPerAppearance as number) - (a.ipPerAppearance as number))[0];
    out.push({
      kind: 'no_multi_inning',
      current: `No reliever works ${LONG_INNINGS} or more innings an appearance${top ? ` (the most is ${top.name}, ${(top.ipPerAppearance as number).toFixed(1)})` : ''}.`,
      supported: 'A pen usually has one arm who takes the innings after a short start or in extra innings.',
      why: 'When a starter leaves early, the innings fall on the arms who pitch one inning at a time: the same few, on consecutive days.',
      players: top ? [brief(top)] : [],
      text: 'Nobody in the pen throws multiple innings, so a short start or a long game is covered one inning at a time.',
    });
  }

  // Crowding: too many arms in one role.
  for (const tier of ['long', 'closer'] as const) {
    const here = read.filter((a) => a.tier === tier);
    if (here.length >= CROWDED[tier]) {
      out.push({
        kind: 'crowded_role',
        current: `${here.length} relievers are used as ${tier === 'long' ? 'long men' : 'closers'} (${here.map((a) => a.name).join(', ')}).`,
        supported: tier === 'long' ? 'A pen usually needs one or two arms for length.' : 'One arm closes; the others are high-leverage arms.',
        why: tier === 'long' ? 'Innings in low-leverage spots are worth the least, so an arm working there is not being used where he helps most.' : 'Saves are shared, so no arm has a settled role and the best one is not always used.',
        players: here.map(brief),
        text: `${here.length} relievers work as ${tier === 'long' ? 'long men' : 'closers'}: more than a pen usually needs in that role.`,
      });
    }
  }
  return out;
}

/**
 * The rotation and the pen compete for the same arms. A reliever whose visible tools AS A STARTER (and whose stamina supports starting)
 * beat the weakest man in the rotation by a clear margin is a role conflict: the club is paying for a rotation spot with the worse pitcher.
 * Tools are compared with tools (both percentiles among MLB starters), because a reliever has no results as a starter. A usage decision,
 * not a roster move, and never an assumption that he would be as good in the rotation: it is his tools only.
 */
export function starterConflicts(
  relievers: Array<{ playerId: number; name: string; tier: BullpenTier; estimate: number | null; toolsAsStarter: number | null }>,
  weakestStarter: { playerId: number; name: string; tools: number | null } | null
): PenFinding[] {
  if (!weakestStarter || weakestStarter.tools === null) return [];
  const ahead = relievers
    .filter((r): r is typeof r & { toolsAsStarter: number } => r.toolsAsStarter !== null && r.toolsAsStarter - (weakestStarter.tools as number) >= DEPLOYMENT_GAP)
    .sort((a, b) => b.toolsAsStarter - a.toolsAsStarter || a.name.localeCompare(b.name));
  return ahead.slice(0, 2).map((r) => ({
    kind: 'starter_conflict' as const,
    current: `${r.name} is used as a ${TIER_WORD[r.tier]}; ${weakestStarter.name} is in the rotation.`,
    supported: `${r.name}'s visible tools as a starter are at the ${Math.round(r.toolsAsStarter)}th percentile of MLB starters, against ${Math.round(weakestStarter.tools as number)}th for ${weakestStarter.name}, and his stamina supports starting.`,
    why: 'A rotation turn is about six innings; the difference between the two arms is spread across all of them, where a reliever\'s is spread over one. His results as a starter do not exist, so this is his tools only.',
    players: [{ playerId: r.playerId, name: r.name, tier: r.tier, estimate: r.estimate }],
    text: `${r.name} (a ${TIER_WORD[r.tier]}) has better visible tools for the rotation than ${weakestStarter.name} (${Math.round(r.toolsAsStarter)}th against ${Math.round(weakestStarter.tools as number)}th): a role decision for the manager, on tools alone.`,
  }));
}
