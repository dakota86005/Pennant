/**
 * An affiliate read twice: as a roster that has to function, and as a place players develop.
 *
 * The farm v1 model had one status per club and prose `issues[]`. Two consequences, both measured on
 * the real Arizona import: an affiliate carrying twenty-eight pitchers, twenty-three of them
 * relievers, was reported `healthy` because surplus is not a shortage; and the reason for every flag
 * had to be read out of a sentence (docs/MINOR_LEAGUE_OPERATIONS.md C-1, the farm's F-10).
 *
 * Here the two readings are separate outputs and stay separate. A club can field nine competent
 * players and still be developmentally wrong for half of them; a club can be developmentally ideal
 * and unable to cover a doubleheader. Collapsing them loses the question the GM is asking.
 *
 * Every finding is structured: what was flagged, the evidence with its basis, who it is about, what
 * is missing, what would settle it, and which subsystem owns the judgment. Nothing is a score.
 *
 * This composes: `minorLeagueRoster` (operational counts and coverage, and its rehab screen),
 * `playingTime` (congestion and opportunity), `currentAssignment` (Player Development's reading of
 * each man's level). It decides no ability question and reads no rating column.
 */

import {
  BODY_COUNT,
  CRITICAL_POSITIONS,
  MINIMUM_CLUB_GAMES,
  PART_TIME_SHARE,
  PLAYABLE_GRADE,
  RELIEF_CORPS,
  ROTATION_SPOTS,
} from './farmCalibration.js';
import type { AffiliateRosterHealth } from './minorLeagueRoster.js';
import {
  jobLabel,
  type PlayingTimeConflict,
  type WorkShare,
} from './playingTime.js';
import type { CurrentAssignmentVerdict } from './currentAssignment.js';

/* ── findings ────────────────────────────────────────────────────────────────────────────────── */

export type FindingOwner = 'minor_league_operations' | 'player_development';

export type FarmFindingCode =
  /* operational: the club cannot do something it has to do */
  | 'position_uncovered'
  | 'position_single_cover'
  | 'cannot_field_defense'
  | 'hitter_bodies_short'
  | 'pitcher_bodies_short'
  | 'rotation_short'
  | 'relief_short'
  /* developmental: the players here are not being developed well */
  | 'position_congested'
  | 'rotation_crowded'
  | 'relief_crowded'
  | 'player_blocked'
  | 'role_conversion_available'
  | 'level_too_advanced'
  | 'level_no_longer_developmental'
  | 'assignment_indeterminate'
  | 'no_production_evidence';

export interface FarmEvidenceItem {
  label: string;
  value: string;
  /** Where the value comes from, so nothing has to be taken on trust. */
  basis: string;
}

export interface FarmFinding {
  id: string;
  code: FarmFindingCode;
  /** Which reading it belongs to. The two are never mixed in one list. */
  lens: 'operational' | 'developmental';
  severity: 'critical' | 'attention' | 'noted';
  owner: FindingOwner;

  /** One sentence a GM can act on. */
  headline: string;

  evidence: FarmEvidenceItem[];

  /** Who it is about, when it is about people. */
  players: Array<{ playerId: number; name: string; note: string }>;

  /** Evidence that is absent. Unknown stays unknown: this is never read as a negative. */
  missing: string[];

  /** What would settle it. */
  wouldResolve: string[];
}

let findingSeq = 0;
const nextId = (prefix: string): string => `${prefix}-${++findingSeq}`;

/** Reset between requests so ids are stable within one response. */
export function resetFarmFindingIds(): void {
  findingSeq = 0;
}

/* ── the affiliate view ──────────────────────────────────────────────────────────────────────── */

/**
 * Can the club do its job? Only a SHORTAGE is an operational state: `critical` when a finding is
 * critical, `thin` when there is any finding, `healthy` otherwise. Carrying more men than the club
 * has work for is a developmental matter and never appears here.
 */
export type OperationalStatus = 'critical' | 'thin' | 'healthy';

export interface AffiliateOperational {
  status: OperationalStatus;
  roster: AffiliateRosterHealth['roster'];
  /** Positions covered by a revealed grade, and positions covered only by a roster label. */
  coverage: Array<{
    position: string;
    graded: number;
    listedOnly: number;
    strong: number;
    critical: boolean;
  }>;
  canFieldDefense: boolean;
  fieldablePositions: number;
  pitching: {
    /** Assigned to start by OOTP role; the rotation finding counts the men taking the starts. */
    starters: number;
    relievers: number;
    rotationSpots: number;
  };
  findings: FarmFinding[];
  /** What the operational reading could not establish (a position covered only by labels). */
  unknowns: string[];
}

export interface AffiliateDevelopmental {
  /** How many of this club's players Player Development could and could not assess, and why. */
  assessment: {
    assessed: number;
    indeterminate: number;
    notAssessable: number;
    reasons: Record<string, number>;
  };
  /** Players whose current level Player Development does not read as developing them. */
  concerns: Array<{
    playerId: number;
    name: string;
    age: number;
    verdict: CurrentAssignmentVerdict;
    question: 'developmental' | 'organizational' | 'none';
    summary: string;
  }>;
  conflicts: PlayingTimeConflict[];
  findings: FarmFinding[];
}

export interface AffiliateView {
  teamId: number;
  label: string;
  level: number;
  levelName: string;
  leagueId: number;
  leagueName: string;
  /** Games the club has played, which is how a thin line is told from a short season. */
  games: number;

  operational: AffiliateOperational;
  developmental: AffiliateDevelopmental;

  /** Parent-club players on this club's list who are not ordinary members (D-026). */
  rosterTreatment: AffiliateRosterHealth['rosterTreatment'];

  unknowns: string[];
}

export interface AffiliateInput {
  health: AffiliateRosterHealth;
  leagueId: number;
  leagueName: string;
  games: number;
  conflicts: readonly PlayingTimeConflict[];
  assignments: ReadonlyArray<{
    playerId: number;
    name: string;
    age: number;
    verdict: CurrentAssignmentVerdict;
    question: 'developmental' | 'organizational' | 'none';
    summary: string;
    unassessableReason: string | null;
  }>;
  /** Positions covered only by a roster label rather than a revealed grade, per position. */
  listedOnly: Record<string, number>;
  /**
   * Pitchers the club is getting starts from: assigned to start, or having started a game.
   *
   * The operational read used the OOTP role code alone, which on the real import said Reno's rotation
   * was a man short while the congestion read said six men were competing for five spots — both true
   * of the same club and reading as a contradiction. A rotation is short when nobody is taking the
   * starts, not when the role codes do not add up.
   */
  rotationClaimants: number;
  /**
   * Pitchers the club is using in relief whose stamina and repertoire would support starting. A
   * developmental question for Player Development, never a shortage and never a claim on a rotation
   * spot nobody is giving them.
   */
  roleConversions: ReadonlyArray<{ playerId: number; name: string; age: number; tier: string | null; basis: string }>;
}

const nameList = (shares: readonly WorkShare[]): string =>
  shares.map((s) => `${s.name} (${s.age})`).join(', ');

/** What the operational reading needs: counts and coverage, and who is taking the starts. */
export interface OperationalInput {
  health: AffiliateRosterHealth;
  listedOnly: Record<string, number>;
  rotationClaimants: number;
}

/**
 * One club as a roster that has to function: can it field a team and cover a schedule?
 *
 * Exported on its own because it is the reading MLB Operations displays for a club before and after
 * a move, and the two modules must describe one farm: the old health delta read the rotation off
 * OOTP's role codes and called Reno thin while this module counted six men taking starts and called
 * it able. The status is derived from the findings, so the status and the list can never disagree.
 */
export function operationalReading(input: OperationalInput): AffiliateOperational {
  const { health } = input;
  const operationalFindings: FarmFinding[] = [];
  const injuredAt = (position: string) =>
    health.rosterTreatment.injured
      .filter((p) => p.listedPosition === position)
      .map((p) => ({ playerId: p.playerId, name: p.name, note: `injured${p.daysLeft !== null ? ` (${p.daysLeft} days)` : ''}, not counted as cover` }));
  const unknowns: string[] = [];

  const coverage = health.positionPlayers.coverage.map((c) => ({
    position: c.position,
    graded: c.players.filter((p) => p.rating !== null && p.rating >= PLAYABLE_GRADE).length,
    listedOnly: input.listedOnly[c.position] ?? 0,
    strong: c.strong,
    critical: (CRITICAL_POSITIONS as readonly string[]).includes(c.position),
  }));

  for (const c of coverage) {
    const total = c.graded + c.listedOnly;
    if (total === 0) {
      operationalFindings.push({
        id: nextId('op'),
        code: 'position_uncovered',
        lens: 'operational',
        severity: 'critical',
        owner: 'minor_league_operations',
        headline: `Nobody on the roster covers ${c.position}.`,
        evidence: [
          { label: 'Players with a revealed grade there', value: '0', basis: `A visible fielding grade of ${PLAYABLE_GRADE} or better.` },
          { label: 'Players listed there', value: '0', basis: 'The roster\'s own listed position.' },
        ],
        players: injuredAt(c.position),
        missing: [],
        wouldResolve: ['A player assigned to the club who can play the position.'],
      });
      continue;
    }
    if (total === 1 && c.critical) {
      operationalFindings.push({
        id: nextId('op'),
        code: 'position_single_cover',
        lens: 'operational',
        severity: 'attention',
        owner: 'minor_league_operations',
        headline: `Only one man covers ${c.position}; a day off or an injury leaves the club without it.`,
        evidence: [
          { label: 'Revealed grades there', value: String(c.graded), basis: `A visible fielding grade of ${PLAYABLE_GRADE} or better.` },
          { label: 'Covered by a roster label only', value: String(c.listedOnly), basis: 'Listed at the position with no visible grade for it.' },
        ],
        players: health.positionPlayers.coverage
          .find((x) => x.position === c.position)!
          .players.map((p) => ({ playerId: p.playerId, name: p.name, note: p.rating === null ? 'listed there, no visible grade' : `grade ${p.rating}` }))
          .concat(injuredAt(c.position)),
        missing: c.listedOnly > 0 ? ['A visible fielding grade for at least one cover at this position.'] : [],
        wouldResolve: ['A second player who can play the position.'],
      });
    }
    if (c.graded === 0 && c.listedOnly > 0) {
      unknowns.push(
        `${c.position} is covered only by roster labels: no player on the club has a visible fielding grade there.`
      );
    }
  }

  if (!health.positionPlayers.canFieldDefense) {
    operationalFindings.push({
      id: nextId('op'),
      code: 'cannot_field_defense',
      lens: 'operational',
      severity: 'critical',
      owner: 'minor_league_operations',
      headline: `The club can fill only ${health.positionPlayers.fieldablePositions} of the eight fielding positions at once.`,
      evidence: [
        {
          label: 'Positions fillable simultaneously',
          value: `${health.positionPlayers.fieldablePositions} of 8`,
          basis: 'Maximum matching of players to positions, so one utility man is not counted three times.',
        },
      ],
      players: [],
      missing: [],
      wouldResolve: ['A player who covers one of the positions nobody can fill.'],
    });
  }

  const hitters = health.roster.positionPlayers;
  if (hitters < BODY_COUNT.hitters.thinBelow) {
    operationalFindings.push({
      id: nextId('op'),
      code: 'hitter_bodies_short',
      lens: 'operational',
      severity: hitters < BODY_COUNT.hitters.thinBelow - 2 ? 'critical' : 'attention',
      owner: 'minor_league_operations',
      headline: `${hitters} position players is short of what the club needs to rest a lineup.`,
      evidence: [
        { label: 'Position players', value: String(hitters), basis: 'Active list, rehab assignees excluded.' },
        { label: 'Short below', value: String(BODY_COUNT.hitters.thinBelow), basis: 'Eight fielding positions plus rest.' },
      ],
      players: [],
      missing: [],
      wouldResolve: ['A position player assigned to the club.'],
    });
  }

  const pitchers = health.roster.pitchers;
  if (pitchers < BODY_COUNT.pitchers.thinBelow) {
    operationalFindings.push({
      id: nextId('op'),
      code: 'pitcher_bodies_short',
      lens: 'operational',
      severity: pitchers < BODY_COUNT.pitchers.thinBelow - 2 ? 'critical' : 'attention',
      owner: 'minor_league_operations',
      headline: `${pitchers} pitchers is short of what the club needs to cover a schedule.`,
      evidence: [
        { label: 'Pitchers', value: String(pitchers), basis: 'Active list, rehab assignees excluded.' },
        { label: 'Short below', value: String(BODY_COUNT.pitchers.thinBelow), basis: 'A five-man rotation plus relief coverage.' },
      ],
      players: [],
      missing: [],
      wouldResolve: ['A pitcher assigned to the club.'],
    });
  }

  if (input.rotationClaimants < ROTATION_SPOTS) {
    const short = ROTATION_SPOTS - input.rotationClaimants;
    operationalFindings.push({
      id: nextId('op'),
      code: 'rotation_short',
      lens: 'operational',
      severity: input.rotationClaimants < ROTATION_SPOTS - 1 ? 'critical' : 'attention',
      owner: 'minor_league_operations',
      headline: `${input.rotationClaimants} pitchers are taking this club's starts; the rotation is ${short} short of ${ROTATION_SPOTS}.`,
      evidence: [
        {
          label: 'Taking starts',
          value: String(input.rotationClaimants),
          basis: 'Assigned to start, or has started a game this season. Rehab assignees excluded.',
        },
        { label: 'Assigned to start by OOTP role', value: String(health.pitching.starters), basis: 'OOTP role 11, rehab assignees excluded.' },
        { label: 'Rotation spots', value: String(ROTATION_SPOTS), basis: 'A five-man rotation, the shape OOTP runs at every full-season level.' },
        { label: 'Relief arms on the club', value: String(health.pitching.relievers), basis: 'OOTP role; one of them may be taking the open start.' },
      ],
      players: [
        ...health.rosterTreatment.rehab.map((r) => ({
          playerId: r.playerId,
          name: r.name,
          note: 'on a rehab assignment from the parent club, so he is not counted as one of this club\'s starters',
        })),
        ...health.rosterTreatment.injured
          .filter((p) => p.listedPosition === 'P')
          .map((p) => ({ playerId: p.playerId, name: p.name, note: `injured${p.daysLeft !== null ? ` (${p.daysLeft} days)` : ''}, not counted` })),
      ],
      missing: [],
      wouldResolve: [
        'A starter assigned to the club, or a relief arm on it stretched into the open start.',
      ],
    });
  }

  if (health.pitching.relievers < RELIEF_CORPS.thinBelow) {
    operationalFindings.push({
      id: nextId('op'),
      code: 'relief_short',
      lens: 'operational',
      severity: health.pitching.relievers < RELIEF_CORPS.criticalBelow ? 'critical' : 'attention',
      owner: 'minor_league_operations',
      headline: `${health.pitching.relievers} relief arms is short of the ${RELIEF_CORPS.thinBelow} a schedule takes.`,
      evidence: [
        { label: 'Relief arms', value: String(health.pitching.relievers), basis: 'OOTP role, closers included, rehab assignees excluded.' },
        { label: 'Short below', value: String(RELIEF_CORPS.thinBelow), basis: 'Relief coverage over a normal week.' },
      ],
      players: [],
      missing: [],
      wouldResolve: ['A relief arm assigned to the club.'],
    });
  }

  return {
    /*
     * The status is what the findings say, not a separate calculation. Only a SHORTAGE is an
     * operational state: carrying more men than the club has work for is a developmental problem,
     * and the farm v1 model reporting it as `surplus` in the same field as `critical` is what let an
     * affiliate with twenty-three relief arms read as fine.
     */
    status: operationalFindings.some((f) => f.severity === 'critical')
      ? 'critical'
      : operationalFindings.length > 0
        ? 'thin'
        : 'healthy',
    roster: health.roster,
    coverage,
    canFieldDefense: health.positionPlayers.canFieldDefense,
    fieldablePositions: health.positionPlayers.fieldablePositions,
    pitching: {
      starters: health.pitching.starters,
      relievers: health.pitching.relievers,
      rotationSpots: ROTATION_SPOTS,
    },
    findings: operationalFindings,
    unknowns,
  };
}

/**
 * Build one affiliate's two readings.
 *
 * Pure: everything it needs is passed in. `farmOperations.ts` does the reading from tables.
 */
export function buildAffiliateView(input: AffiliateInput): AffiliateView {
  const { health } = input;
  const developmentalFindings: FarmFinding[] = [];
  const operational = operationalReading({ health, listedOnly: input.listedOnly, rotationClaimants: input.rotationClaimants });
  const unknowns: string[] = [...operational.unknowns];

  /* ── developmental: are the players here developing? ───────────────────────────────────────── */

  for (const conflict of input.conflicts) {
    const code: FarmFindingCode =
      conflict.job.kind === 'position'
        ? 'position_congested'
        : conflict.job.kind === 'rotation'
          ? 'rotation_crowded'
          : 'relief_crowded';

    const squeezedNames = nameList(conflict.squeezed);
    const job = jobLabel(conflict.job);
    /* A level in the reader's words: `unknown` is a role that cannot be read yet, not a missing value. */
    const levelText = (level: string): string =>
      level === 'unknown' ? 'not yet readable' : level === 'bat_only' ? 'batting, not fielding' : level.replace('_', ' ');
    const overSeason = nameList(conflict.squeezedOverSeason);
    const left = conflict.gone.find((g) => g.material);
    /*
     * A conflict is said in the tense it is true in. One the season shows and the club's recent games
     * do not is still said — history is not erased — but as history, quietly, with nobody named as
     * short of work today. One the recent games cannot yet confirm is said to be unreadable.
     */
    const headline =
      conflict.squeezed.length > 0
        ? `${squeezedNames} ${conflict.squeezed.length === 1 ? 'is' : 'are'} not getting developmental work at ${job}${conflict.timing === 'emerging' ? ', which is recent: the season\'s totals do not show it' : ''}.`
        : conflict.timing === 'recently_resolved'
          ? `${job}: the season's totals show ${overSeason} short of work, but ${left?.name ?? 'the man who held it'} has left it and the club's recent games show no shortage.`
          : conflict.timing === 'historical'
            ? `${job}: the season's totals show ${overSeason} short of work; the club's recent games do not.`
            : conflict.timing === 'uncertain'
              ? `${job}: whether ${overSeason} ${conflict.squeezedOverSeason.length === 1 ? 'is' : 'are'} getting the work cannot be read yet.`
              : `${conflict.claimants.length} men have a claim on ${job}, which supports ${conflict.capacity}.`;

    developmentalFindings.push({
      id: nextId('dev'),
      code,
      lens: 'developmental',
      severity: conflict.severity === 'blocking' ? 'critical' : conflict.severity === 'crowded' ? 'attention' : 'noted',
      owner: 'minor_league_operations',
      headline,
      evidence: [
        { label: 'Claimants', value: String(conflict.claimants.length), basis: 'Men on the club with a claim on the job.' },
        { label: 'The job supports', value: String(conflict.capacity), basis: 'What the job can give developmental work to.' },
        ...(conflict.window
          ? [
              {
                label: 'Read over',
                value: conflict.window.since
                  ? `the ${conflict.window.counted} ${conflict.window.counted === 1 ? 'game' : 'games'} since ${conflict.window.since.name} last started there`
                  : `the club's last ${conflict.window.games} games`,
                basis: 'The recent window, from the export\'s game log. The season to date is shown beside each man where it differs.',
              },
            ]
          : []),
        ...conflict.claimants.map((c) => ({
          label: `${c.name} (${c.age})`,
          value: levelText(c.level),
          basis: c.recent && (c.disagrees || c.level === 'unknown') ? `${c.basis} Season: ${c.season.basis}` : c.basis,
        })),
        ...conflict.gone
          .filter((g) => g.material || g.windowStarts > 0 || (g.seasonShare ?? 0) >= PART_TIME_SHARE)
          .map((g) => ({
            label: `${g.name} (not competing: ${g.why === 'departed' ? `now at ${g.nowAt ?? 'another club'}` : g.why === 'inactive' ? 'off the active list' : g.why === 'rehab' ? 'rehab assignment' : 'injured'})`,
            value: g.seasonShare === null ? 'history' : `${Math.round(g.seasonShare * 100)}% of the season's work`,
            basis:
              g.windowStarts > 0
                ? `Started ${g.windowStarts} of the club's last ${conflict.window?.games ?? 0} games there, the last ${g.lastStartGamesAgo} ${g.lastStartGamesAgo === 1 ? 'game' : 'games'} ago. History, not competition.`
                : 'No start there in the recent window. History, not competition.',
          })),
      ],
      players: conflict.claimants.map((c) => ({
        playerId: c.playerId,
        name: c.name,
        note: `${levelText(c.level)}${c.tier ? `, ${c.tier.replace(/_/g, ' ')}` : ', developmental stakes indeterminate'}`,
      })),
      missing: conflict.unknowns,
      wouldResolve:
        conflict.squeezed.length > 0
          ? [
              'Moving one of the claimants to a club where the job is open.',
              'A change in how the affiliate uses them, which is the affiliate\'s own decision.',
            ]
          : conflict.timing === 'uncertain'
            ? ['More games: the club\'s next several will show who is getting the work.']
            : conflict.timing === 'recently_resolved' || conflict.timing === 'historical'
              ? ['Nothing: the shortage the season\'s totals show is not in the club\'s recent games. It is kept here as history.']
              : ['Nothing needs resolving unless one of them has developmental stakes.'],
    });
  }

  if (input.roleConversions.length > 0) {
    developmentalFindings.push({
      id: nextId('dev'),
      code: 'role_conversion_available',
      lens: 'developmental',
      severity: 'noted',
      owner: 'player_development',
      headline: `${input.roleConversions.length} ${input.roleConversions.length === 1 ? 'arm is' : 'arms are'} being used in relief with the structure to start.`,
      evidence: input.roleConversions.map((r) => ({
        label: `${r.name} (${r.age})`,
        value: r.tier ? r.tier.replace(/_/g, ' ') : 'stakes indeterminate',
        basis: r.basis,
      })),
      players: input.roleConversions.map((r) => ({ playerId: r.playerId, name: r.name, note: r.basis })),
      missing: input.roleConversions.some((r) => r.tier === null)
        ? ['Developmental stakes are indeterminate for at least one of them.']
        : [],
      wouldResolve: [
        'A development decision about whether he should be starting, which Player Development owns.',
      ],
    });
  }

  const concerns: AffiliateDevelopmental['concerns'] = [];
  const reasons: Record<string, number> = {};
  let assessed = 0;
  let indeterminate = 0;
  let notAssessable = 0;

  for (const a of input.assignments) {
    if (a.verdict === 'not_assessable') {
      notAssessable++;
      const key = a.unassessableReason ?? 'unknown';
      reasons[key] = (reasons[key] ?? 0) + 1;
      continue;
    }
    if (a.verdict === 'indeterminate') {
      indeterminate++;
      concerns.push({ playerId: a.playerId, name: a.name, age: a.age, verdict: a.verdict, question: a.question, summary: a.summary });
      continue;
    }
    assessed++;
    if (a.verdict !== 'appropriate') {
      concerns.push({ playerId: a.playerId, name: a.name, age: a.age, verdict: a.verdict, question: a.question, summary: a.summary });
    }
  }

  const tooAdvanced = concerns.filter((c) => c.verdict === 'too_advanced');
  if (tooAdvanced.length > 0) {
    developmentalFindings.push({
      id: nextId('dev'),
      code: 'level_too_advanced',
      lens: 'developmental',
      severity: 'attention',
      owner: 'player_development',
      headline: `${tooAdvanced.length} ${tooAdvanced.length === 1 ? 'player is' : 'players are'} at a level ahead of what they have shown.`,
      evidence: tooAdvanced.map((c) => ({ label: `${c.name} (${c.age})`, value: 'level too advanced', basis: c.summary })),
      players: tooAdvanced.map((c) => ({ playerId: c.playerId, name: c.name, note: c.summary })),
      missing: [],
      wouldResolve: ['A less demanding assignment, if one is defensible and the organization has room for it.'],
    });
  }

  /*
   * "Nothing left to learn here" is two different findings and they were one.
   *
   * A prospect who has mastered the level is a development question and wants attention. A man past
   * the level's age window is the organizational depth every affiliate is partly built from, and
   * there are many of him: on the real import that read as "nine players have nothing left to learn"
   * at Double-A, of nineteen assessed, which buries the two prospects among seven journeymen. They
   * are separated, and only the first is raised.
   */
  const beyond = concerns.filter((c) => c.verdict === 'no_longer_developmental');
  const developmental = beyond.filter((c) => c.question === 'developmental');
  const organizational = beyond.filter((c) => c.question === 'organizational');

  if (developmental.length > 0) {
    developmentalFindings.push({
      id: nextId('dev'),
      code: 'level_no_longer_developmental',
      lens: 'developmental',
      severity: 'attention',
      owner: 'player_development',
      headline:
        developmental.length === 1
          ? 'One player has outgrown this level and still has developmental time.'
          : `${developmental.length} players have outgrown this level and still have developmental time.`,
      evidence: developmental.map((c) => ({ label: `${c.name} (${c.age})`, value: 'a developmental question', basis: c.summary })),
      players: developmental.map((c) => ({ playerId: c.playerId, name: c.name, note: c.summary })),
      missing: [],
      wouldResolve: ['A more demanding assignment, where one is defensible.'],
    });
  }

  if (organizational.length > 0) {
    developmentalFindings.push({
      id: nextId('dev'),
      code: 'level_no_longer_developmental',
      lens: 'developmental',
      severity: 'noted',
      owner: 'player_development',
      headline: `${organizational.length} of the club's players are past this level's developmental window.`,
      evidence: organizational.map((c) => ({ label: `${c.name} (${c.age})`, value: 'an organizational question', basis: c.summary })),
      players: organizational.map((c) => ({ playerId: c.playerId, name: c.name, note: c.summary })),
      missing: [],
      wouldResolve: [
        'Nothing, unless the organization wants the spot: the level has no developmental value left for them, so where they play is about what the club needs and who else needs the reps.',
      ],
    });
  }

  if (indeterminate > 0) {
    developmentalFindings.push({
      id: nextId('dev'),
      code: 'assignment_indeterminate',
      lens: 'developmental',
      severity: 'noted',
      owner: 'player_development',
      headline: `${indeterminate} ${indeterminate === 1 ? 'assignment cannot' : 'assignments cannot'} be judged on the evidence available.`,
      evidence: concerns
        .filter((c) => c.verdict === 'indeterminate')
        .map((c) => ({ label: `${c.name} (${c.age})`, value: 'indeterminate', basis: c.summary })),
      players: concerns.filter((c) => c.verdict === 'indeterminate').map((c) => ({ playerId: c.playerId, name: c.name, note: c.summary })),
      missing: ['The evidence each player names in his own review.'],
      wouldResolve: ['Scouting that fills in the missing grades, or more of the season.'],
    });
  }

  if (notAssessable > 0) {
    developmentalFindings.push({
      id: nextId('dev'),
      code: 'no_production_evidence',
      lens: 'developmental',
      severity: 'noted',
      owner: 'player_development',
      headline: `${notAssessable} of the club's players have no production to read yet.`,
      evidence: Object.entries(reasons).map(([reason, count]) => ({
        label: reason,
        value: String(count),
        basis: 'Why no current-level line could be read.',
      })),
      players: [],
      missing: ['A season long enough to read.'],
      wouldResolve: ['More games played.'],
    });
    unknowns.push(
      `${notAssessable} of this club's players have no readable production this season, so their assignments are not assessed rather than judged.`
    );
    if (input.games < MINIMUM_CLUB_GAMES) {
      unknowns.push(
        `This club has played ${input.games} games, fewer than the ${MINIMUM_CLUB_GAMES} a work share needs, so how it is using its roster cannot be read yet and no playing-time conflict is reported for it.`
      );
    }
  }

  return {
    teamId: health.teamId,
    label: health.label,
    level: health.level,
    levelName: health.levelName,
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    games: input.games,

    operational,

    developmental: {
      assessment: { assessed, indeterminate, notAssessable, reasons },
      concerns,
      conflicts: [...input.conflicts],
      findings: developmentalFindings,
    },

    rosterTreatment: health.rosterTreatment,
    unknowns,
  };
}
