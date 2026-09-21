/**
 * The farm system as one organization: where it is piled up and where it is thin.
 *
 * These are issues no affiliate page can show, because they are about the relationship between
 * affiliates. Three prospects who each need everyday shortstop reps are not a problem at any one
 * club — they are a problem for the organization that has to develop all three. Nor is a hole behind
 * a major-league position visible from below: it is only visible from the top.
 *
 * Counts, not quality. Whether a player is good is Player Development's and is shown beside the
 * count; which of several defensible arrangements the club prefers is philosophy's. This module says
 * what the shape of the organization is.
 *
 * Pure: the per-player facts are passed in.
 */

import {
  MINIMUM_CLUB_GAMES,
  PRIORITY_CONGESTION_AT,
  UPPER_MINORS_DEPTH_FLOOR,
  UPPER_MINORS_LEVELS,
} from './farmCalibration.js';
import type { DevelopmentProtectionTier } from './developmentFit.js';
import type { FarmFinding } from './farmAffiliate.js';
import type { AssignmentConclusion } from './farmAssignments.js';

export interface OrgPlayerFact {
  playerId: number;
  name: string;
  age: number;
  teamId: number;
  team: string;
  level: number;
  levelName: string;
  kind: 'hitter' | 'pitcher';
  /**
   * The ONE job he is competing for: the position his usage shows he plays, else his listed
   * position; for a pitcher, the rotation when his club is using him there, else the bullpen. This is
   * what CONGESTION is measured on — two men on one developmental path.
   */
  primaryJob: string | null;
  /**
   * Every position he has a revealed grade for. Empty is a real answer, never an assumption. This is
   * what DEPTH is measured on — who the organization could reach for.
   *
   * The two are deliberately different. Counting congestion on coverage reported one versatile
   * twenty-year-old as competing at five positions and put fourteen "priority prospects at left
   * field" in the Rookie complex, because almost every outfielder there has a grade in all three
   * outfield spots. Being able to play a position is not being on its developmental path.
   */
  coverage: string[];
  /** Whether his structure would support starting. A tools reading, not what his club is doing. */
  developmentalStarter: boolean | null;
  tier: DevelopmentProtectionTier | null;
  conclusion: AssignmentConclusion;
  /** Games his club has played, so a shape read off a season that has not happened is not reported. */
  clubGames: number;
  /** He is a parent-club player on rehab, so he is not organizational depth (D-026). */
  rehab: boolean;
}

export interface PositionDistribution {
  position: string;
  /** Players per level who can play it, by level. */
  byLevel: Array<{ level: number; levelName: string; players: number; priority: number }>;
  /** Total across the upper minors, which is the depth a major-league club can reach. */
  upperMinors: number;
  upperMinorsPriority: number;
}

export interface OrganizationView {
  /** How many players the system carries, and how much of it Player Development could read. */
  scope: {
    players: number;
    assessed: number;
    indeterminate: number;
    notAssessable: number;
    rehab: number;
  };

  /** Where the organization's prospects sit, by position and level. */
  distribution: PositionDistribution[];

  /** Pitchers the organization is developing as starters, by level, against the rotation spots there. */
  startersByLevel: Array<{ level: number; levelName: string; developmentalStarters: number; rotationSpots: number }>;

  findings: FarmFinding[];
}

export interface OrganizationInput {
  players: readonly OrgPlayerFact[];
  /** Affiliates in the organization, so rotation capacity can be counted per level. */
  affiliates: ReadonlyArray<{ teamId: number; team: string; level: number; levelName: string }>;
  /** Positions the major-league club is thin at, from MLB Operations' own coverage read. */
  majorLeagueThinAt: readonly string[];
  rotationSpots: number;
  nextFindingId: (prefix: string) => string;
}

const isPriority = (tier: DevelopmentProtectionTier | null): boolean =>
  tier === 'core_prospect' || tier === 'protected_prospect' || tier === 'development_priority';

const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;

export function buildOrganizationView(input: OrganizationInput): OrganizationView {
  const findings: FarmFinding[] = [];
  const members = input.players.filter((p) => !p.rehab);

  const levels = [...new Set(input.affiliates.map((a) => a.level))].sort((a, b) => a - b);
  const levelName = (level: number): string =>
    input.affiliates.find((a) => a.level === level)?.levelName ?? `L${level}`;

  /* ── where the organization's players are, by position and level ───────────────────────────── */

  const distribution: PositionDistribution[] = POSITIONS.map((position) => {
    const canPlay = members.filter((p) => p.coverage.includes(position) || p.primaryJob === position);
    const onPath = members.filter((p) => p.primaryJob === position);
    const byLevel = levels.map((level) => {
      const at = canPlay.filter((p) => p.level === level);
      return {
        level,
        levelName: levelName(level),
        players: at.length,
        /* On the path, not merely able to play it. */
        priority: onPath.filter((p) => p.level === level && isPriority(p.tier)).length,
      };
    });
    const upper = canPlay.filter((p) => (UPPER_MINORS_LEVELS as readonly number[]).includes(p.level));
    return {
      position,
      byLevel,
      upperMinors: upper.length,
      upperMinorsPriority: upper.filter((p) => isPriority(p.tier)).length,
    };
  });

  /* ── congestion: the organization competing with itself ────────────────────────────────────── */

  for (const dist of distribution) {
    for (const level of dist.byLevel) {
      if (level.priority < PRIORITY_CONGESTION_AT) continue;
      const at = members.filter(
        (p) => p.level === level.level && isPriority(p.tier) && p.primaryJob === dist.position
      );
      /*
       * A shape read off a season that has not been played is not a finding. The complex affiliates
       * of the real import had played ten games and none at all, where nothing yet shows who is on
       * which path.
       */
      if (at.every((p) => p.clubGames < MINIMUM_CLUB_GAMES)) continue;
      findings.push({
        id: input.nextFindingId('org'),
        code: 'position_congested',
        lens: 'developmental',
        severity: level.priority > PRIORITY_CONGESTION_AT ? 'attention' : 'noted',
        owner: 'minor_league_operations',
        headline: `${level.priority} priority prospects at ${level.levelName} all need developmental reps at ${dist.position}.`,
        evidence: [
          {
            label: `Priority prospects at ${dist.position}, ${level.levelName}`,
            value: String(level.priority),
            basis: 'Players with a revealed grade there, or listed there, whose protection tier is development priority or better.',
          },
          {
            label: 'Competing with itself above',
            value: String(dist.upperMinorsPriority),
            basis: 'Priority prospects at the position across the upper minors.',
          },
          ...at.map((p) => ({
            label: `${p.name} (${p.age})`,
            value: p.tier ? p.tier.replace(/_/g, ' ') : 'stakes indeterminate',
            basis: `${p.team}; ${p.conclusion.replace(/_/g, ' ')}.`,
          })),
        ],
        players: at.map((p) => ({ playerId: p.playerId, name: p.name, note: `${p.team}, ${p.conclusion.replace(/_/g, ' ')}` })),
        missing: at.some((p) => p.tier === null)
          ? ['Developmental stakes are indeterminate for at least one of them.']
          : [],
        wouldResolve: [
          'Separating them across levels, where the assignment is defensible for each.',
          'One of them moving to another position, which is a development decision and not a roster one.',
        ],
      });
    }
  }

  /* ── depth: what the organization could reach for ───────────────────────────────────────────── */

  for (const dist of distribution) {
    if (dist.upperMinors >= UPPER_MINORS_DEPTH_FLOOR) continue;
    const thinAbove = input.majorLeagueThinAt.includes(dist.position);
    findings.push({
      id: input.nextFindingId('org'),
      code: 'position_single_cover',
      lens: 'operational',
      severity: thinAbove ? 'critical' : 'attention',
      owner: 'minor_league_operations',
      headline: thinAbove
        ? `The major-league club is thin at ${dist.position} and the upper minors have ${dist.upperMinors} to reach for.`
        : `The upper minors carry ${dist.upperMinors} players who can play ${dist.position}.`,
      evidence: [
        {
          label: `Upper-minors players at ${dist.position}`,
          value: String(dist.upperMinors),
          basis: `Players at ${(UPPER_MINORS_LEVELS as readonly number[]).map(levelName).join(' or ')} with a revealed grade there or listed there.`,
        },
        { label: 'Thin below', value: String(UPPER_MINORS_DEPTH_FLOOR), basis: 'What the organization needs to be able to answer an injury from within.' },
        ...(thinAbove
          ? [{ label: 'Major-league club', value: `thin at ${dist.position}`, basis: 'MLB Operations\' own coverage read.' }]
          : []),
      ],
      players: members
        .filter((p) => (UPPER_MINORS_LEVELS as readonly number[]).includes(p.level) && (p.coverage.includes(dist.position) || p.primaryJob === dist.position))
        .map((p) => ({ playerId: p.playerId, name: p.name, note: `${p.team}, age ${p.age}` })),
      missing: [],
      wouldResolve: [
        'A player developing toward the position from a lower level.',
        'Acquisition, which is outside this module.',
      ],
    });
  }

  /* ── starters against rotation spots, level by level ───────────────────────────────────────── */

  const startersByLevel = levels.map((level) => {
    const clubs = input.affiliates.filter((a) => a.level === level).length;
    /*
     * Pitchers the organization is USING as starters, not every arm whose stamina would allow it.
     * The first version used the second and reported thirty-one developmental starters against
     * fifteen Rookie-level rotation spots, which describes a stamina threshold rather than anything
     * the organization is doing.
     */
    const starters = members.filter((p) => p.level === level && p.primaryJob === 'the rotation').length;
    return {
      level,
      levelName: levelName(level),
      developmentalStarters: starters,
      rotationSpots: clubs * input.rotationSpots,
    };
  });

  for (const row of startersByLevel) {
    if (row.developmentalStarters <= row.rotationSpots) continue;
    const surplus = row.developmentalStarters - row.rotationSpots;
    const at = members.filter((p) => p.level === row.level && p.primaryJob === 'the rotation');
    if (at.every((p) => p.clubGames < MINIMUM_CLUB_GAMES)) continue;
    findings.push({
      id: input.nextFindingId('org'),
      code: 'rotation_crowded',
      lens: 'developmental',
      /* Two over ten spots across two clubs is a shape, not a problem; three is worth raising. */
      severity: surplus >= 3 && at.some((p) => isPriority(p.tier)) ? 'attention' : 'noted',
      owner: 'minor_league_operations',
      headline: `${row.developmentalStarters} pitchers are being used as starters at ${row.levelName}, which has ${row.rotationSpots} rotation spots.`,
      evidence: [
        { label: 'Used as starters', value: String(row.developmentalStarters), basis: 'Pitchers their clubs assign to start or have started a game.' },
        { label: 'Rotation spots at the level', value: String(row.rotationSpots), basis: `${input.rotationSpots} per affiliate.` },
        { label: 'Without a spot', value: String(surplus), basis: 'The difference.' },
      ],
      players: at.map((p) => ({ playerId: p.playerId, name: p.name, note: `${p.team}, ${p.tier ? p.tier.replace(/_/g, ' ') : 'stakes indeterminate'}` })),
      missing: at.some((p) => p.developmentalStarter === null)
        ? ['Whether at least one of them has the structure to start could not be established.']
        : [],
      wouldResolve: [
        'Separating them across levels, where the assignment is defensible for each.',
        'A role change for one of them, which Player Development owns.',
      ],
    });
  }

  const assessed = members.filter(
    (p) => p.conclusion !== 'indeterminate' && p.conclusion !== 'not_assessable'
  ).length;

  return {
    scope: {
      players: input.players.length,
      assessed,
      indeterminate: members.filter((p) => p.conclusion === 'indeterminate').length,
      notAssessable: members.filter((p) => p.conclusion === 'not_assessable').length,
      rehab: input.players.filter((p) => p.rehab).length,
    },
    distribution,
    startersByLevel,
    findings,
  };
}
