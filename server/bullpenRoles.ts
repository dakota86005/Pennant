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
 * Pure: usage in, tiers and findings out, under the lines in force (`BullpenLines`, from `rosterReviewCalibration(...).bullpen`; no
 * reader holds a default). The leverage cut-offs are policy on the leverage scale, where 1.0 is an average plate appearance in the
 * league itself; the long-man line is a measurement of how long the league's own relievers work (D-053, cycle 3; docs/CALIBRATION.md
 * section 14), because leagues differ: this save's game works its relievers about a quarter longer than the real seasons it imported.
 */

import { policy, provisional, type CalibrationStamp } from './calibration.js';

export const BULLPEN_CALIBRATION: CalibrationStamp = policy(
  'The leverage cut-offs are policy on the league\'s own leverage scale (1.0 is an average plate appearance there; rescaled only when the league\'s mean is off 1.0 by more than the tolerance). The long-man line is measured on the league\'s own relievers where its checks pass (docs/CALIBRATION.md section 14), else the starting value. The deployment gap, the minimum appearances and the multi-inning line are policy.'
);
export const BULLPEN_POLICY: CalibrationStamp = policy('The minimum appearances, the multi-inning line, the deployment gap, the credible-arm line and the crowding counts are policy thresholds.');

/**
 * POLICY (on the league's own leverage scale). Average leverage per batter faced at which a reliever is used as a closer (with a save),
 * as a high-leverage arm, and below which he is in low-leverage spots: 60%, 30% more and 10% less at stake than an average plate
 * appearance. On the Arizona import (2026 to date) they sit at the 85th, 68th and 34th percentile of relievers (median 1.07, top quartile
 * 1.36; relievers with three or more saves average 2.07); that is evidence, not what sets them.
 */
export const LEVERAGE = { closer: 1.6, high: 1.3, low: 0.9 } as const;
/**
 * POLICY. How far the league's mean leverage per batter faced may sit from 1.0 before the cut-offs are rescaled to it (a guard against an
 * export whose leverage is not normalized to its league). Within it the cut-offs serve as written, so a season's wobble moves no tier.
 */
export const LEVERAGE_UNIT_TOLERANCE = 0.05;
/** POLICY. Fewest appearances before a role is read from usage. */
export const MIN_APPEARANCES = 8;
/** POLICY. Innings per appearance at or above which a reliever "throws multiple innings" (the pen-wide finding): a baseball meaning, not a league's. */
export const MULTI_INNING = 1.6;
/**
 * PROVISIONAL (the fallback prior). Innings per appearance at or above which a reliever below high leverage is a long man, until the
 * league's own is measured: where the real seasons 2019-2025 of the Arizona import put it (their 84th to 88th percentile).
 */
export const LONG_LINE_PRIOR = 1.6;
/** POLICY. Points of working estimate by which a lower-leverage arm must beat a higher-leverage one to call the deployment backwards. */
export const DEPLOYMENT_GAP = 15;

/** POLICY. Working estimate (percentile of MLB relievers) at or above which an arm is credible for high-leverage innings: about the median reliever. */
export const CREDIBLE_HIGH_LEVERAGE = 50;
/** POLICY. How many relievers in one role make the pen crowded there: three long men or three closers is more than a bullpen usually needs. */
export const CROWDED = { long: 3, closer: 3 } as const;
/** POLICY. Fewest relievers with a read role before a pen-wide finding ("nobody throws multiple innings") is made: early in a season most roles are not yet read. */
export const MIN_READ_ARMS = 5;

export const LONG_LINE_STAMP: CalibrationStamp = provisional('The starting long-man line (1.6 innings an appearance), until the league\'s own relievers are measured.');

/** The lines a pen is read under: the ones in force for the save (required everywhere; `BULLPEN_PRIOR` only where the fallback is chosen). */
export interface BullpenLines {
  /** The leverage cut-offs as served: the policy values, rescaled to the league's mean only beyond the tolerance. */
  leverage: { closer: number; high: number; low: number };
  /** Innings per appearance at or above which a reliever below high leverage is a long man. */
  long: number;
  /** Innings per appearance that count as "multiple innings" in the pen-wide finding (policy). */
  multiInning: number;
  /** Whether the long-man line is the league's own measurement or the starting value. */
  source: 'save' | 'starting';
  /** The league's mean leverage per batter faced the cut-offs were checked against (null: not read), and whether they were rescaled. */
  leagueLeverage: number | null;
  rescaled: boolean;
}

/** The starting lines: the policy cut-offs as written, the starting long-man line. */
export const BULLPEN_PRIOR: BullpenLines = {
  leverage: { ...LEVERAGE }, long: LONG_LINE_PRIOR, multiInning: MULTI_INNING, source: 'starting', leagueLeverage: null, rescaled: false,
};

/**
 * The leverage cut-offs on the league's own scale: as written while the league's mean leverage per batter faced is within the tolerance
 * of 1.0 (or unknown), else multiplied by it. A derivation, not a fit.
 */
export function leverageLines(leagueMean: number | null, tolerance = LEVERAGE_UNIT_TOLERANCE): { leverage: BullpenLines['leverage']; rescaled: boolean } {
  if (leagueMean === null || !(leagueMean > 0) || Math.abs(leagueMean - 1) <= tolerance) return { leverage: { ...LEVERAGE }, rescaled: false };
  const r = (x: number) => Math.round(x * leagueMean * 1000) / 1000;
  return { leverage: { closer: r(LEVERAGE.closer), high: r(LEVERAGE.high), low: r(LEVERAGE.low) }, rescaled: true };
}

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

export function roleOf(u: BullpenUsage, lines: BullpenLines): BullpenRole {
  if (u.g < MIN_APPEARANCES || u.leverage === null) {
    return { tier: 'unknown', stakes: null, text: u.g < MIN_APPEARANCES ? `Only ${u.g} appearances, too few to read a role from usage.` : 'The export carries no leverage for him.' };
  }
  const perApp = u.g > 0 ? u.ip / u.g : 0;
  let tier: BullpenTier;
  if (u.leverage >= lines.leverage.closer && u.sv > 0) tier = 'closer';
  else if (u.leverage >= lines.leverage.high) tier = 'high_leverage';
  else if (perApp >= lines.long) tier = 'long';
  else if (u.leverage < lines.leverage.low) tier = 'low_leverage';
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

export function penFindings(arms: PenArm[], lines: BullpenLines): PenFinding[] {
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
  const multi = read.filter((a) => a.tier === 'long' || (a.ipPerAppearance ?? 0) >= lines.multiInning);
  if (multi.length === 0) {
    const top = [...read].filter((a) => a.ipPerAppearance != null).sort((a, b) => (b.ipPerAppearance as number) - (a.ipPerAppearance as number))[0];
    out.push({
      kind: 'no_multi_inning',
      current: `No reliever works ${lines.multiInning} or more innings an appearance${top ? ` (the most is ${top.name}, ${(top.ipPerAppearance as number).toFixed(1)})` : ''}.`,
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
