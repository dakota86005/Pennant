/**
 * The MLB ↔ farm contract: what follows one player's departure from an affiliate, or his arrival at
 * one. Minor League Operations OWNS both answers; MLB Operations asks through `mlbEvidence.ts` and
 * displays them, and rebuilds neither (D-045).
 *
 *   farmConsequenceFor   he leaves: the job he vacates, whether the club absorbs it, whose playing
 *                        time changes, who could take the job, the cascade and where it stops
 *   farmArrivalFor       he arrives: the job he takes up, who already holds it, whose developmental
 *                        work he pushes aside — the conflict that would exist with him on the club
 *
 * An unresolved farm consequence is information, never an illegality: whether the major-league
 * transaction is possible is Player Rights', and nothing here touches it. Both read the organization
 * through the caller's `FarmSession`, so a request asking about ten candidates reads it once.
 */

import { loadScoutedAbilities, scoutedGloves } from './scoutedEvidence.js';
import type { AffiliateRosterHealth } from './minorLeagueRoster.js';
import type { OperationalStatus } from './farmAffiliate.js';
import { clubUsage } from './farmUsage.js';
import { describeTenure } from './farmRecentUsage.js';
import {
  jobRead,
  ownWork,
  type ConflictTiming,
  type FarmJob,
  type PlayingTimeConflict,
  type UsageFacts,
  type WorkLevel,
  type WorkShare,
} from './playingTime.js';
import {
  planCascade,
  poolFor,
  summarizeCascade,
  type Cascade,
  type CascadeCandidate,
  type Vacancy,
} from './farmCascade.js';
import * as calibration from './farmCalibration.js';
import { POSITION_CAPACITY, RELIEF_CORPS, ROTATION_SPOTS } from './farmCalibration.js';
import {
  affiliateOperationalUnder,
  anyPlayer,
  castOf,
  farmJobOf,
  FIELDING_POSITIONS,
  OOTP_STARTER_ROLE,
  openFarmSession,
  POSITION_CODES,
  type AffiliateMeta,
  type AssembledPlayer,
  type FarmSession,
  type ProspectRow,
} from './farmOperations.js';

/* ── the MLB ↔ farm consequence contract ─────────────────────────────────────────────────────── */

export interface FarmConsequenceV2 {
  /** Who is leaving, and from where. */
  player: { playerId: number; name: string } | null;
  sourceAffiliate: { teamId: number; label: string; level: number; levelName: string } | null;

  /** The job he vacates. */
  lostRole: string | null;

  /**
   * What the affiliate can and cannot do afterwards. The statuses are the farm's own findings-derived
   * operational reading, before and after, so MLB Operations shows the same club the Affiliates view
   * does; `findingsAfter` are the shortages it would then carry, in the words the workspace uses.
   */
  affiliateImpact: {
    before: string;
    after: string;
    absorbed: boolean;
    statusBefore: OperationalStatus;
    statusAfter: OperationalStatus;
    findingsAfter: string[];
  } | null;

  /**
   * What he is actually doing at the club NOW, which is what the vacancy is: a regular's job, a share
   * of one, or a job he joined four games ago and has not established. The farm's own playing-time
   * read — the recent window where the export's game log allows it, the season where it does not — so
   * MLB Operations displays it and reconstructs nothing. null when there is nothing to read (a rehab
   * assignee, a club that has barely played).
   */
  currentOpportunity: CurrentOpportunity | null;

  /** Who else's playing time changes. */
  playingTimeImpact: Array<{ playerId: number; name: string; effect: string }>;

  /**
   * Who could take the job he vacates, from the level below: the first step's candidates, each with
   * Player Development's verdict on that exact move and philosophy's preference among the defensible
   * ones. Never a score; choosing among them is the GM's.
   */
  replacementOptions: Array<{
    playerId: number;
    name: string;
    from: string;
    judgment: string;
    preference: string | null;
    detail: string;
  }>;

  cascade: Cascade | null;

  /** Holes the chain leaves open. A non-empty list does not make the major-league move illegal. */
  unresolvedIssues: string[];

  /** How certain the answer is, and what is missing. */
  confidence: 'established' | 'indeterminate' | 'cannot_be_established';
  evidence: string[];

  /** One line MLB Operations can display without re-running anything. */
  summary: string;
}

/** How a man's present role at his club reads, for the contract. Structured states; never a score. */
export interface CurrentOpportunity {
  /** His current work level at the job; `unknown` when his role there is not established. */
  level: WorkLevel;
  /** What the level rests on: the recent window, the season alone, or OOTP's projected rotation. */
  basis: WorkShare['levelFrom'];
  /**
   * How much the recent read can carry. `season_only` means the export has no game log, so the season
   * to date is all there is and it may describe a competition that no longer exists.
   */
  evidence: 'sufficient' | 'thin' | 'none' | 'season_only';
  /** He joined the club inside the recent window: small destination totals are newness, not disuse. */
  recentArrival: boolean;
  /** The season and the recent read place him at different levels; both are in `detail`. */
  disagrees: boolean;
  /** Whether the competition at his job is the present, the past, or not yet readable. null when uncontested. */
  timing: ConflictTiming | null;
  /** What he holds, in words. */
  detail: string;
}

/** The contract's description of one man's present role, from his own work read. */
export function currentOpportunityOf(work: WorkShare | null, timing: ConflictTiming | null): CurrentOpportunity | null {
  if (!work) return null;
  const arrived = work.tenure?.status === 'recent_arrival' ? describeTenure(work.tenure) : null;
  const parts = [arrived, work.basis, work.disagrees ? `Over the season: ${work.season.basis}` : null].filter((x): x is string => x !== null);
  return {
    level: work.level,
    basis: work.levelFrom,
    evidence: work.recent ? work.recent.evidence : 'season_only',
    recentArrival: work.tenure?.status === 'recent_arrival',
    disagrees: work.disagrees,
    timing,
    detail: parts.join(' '),
  };
}

/** The read of one man's job at his club — contested or not — with him among the claimants. */
function jobReadFor(session: FarmSession, player: AssembledPlayer): PlayingTimeConflict | null {
  const job = farmJobOf(player);
  if (!job) return null;
  const { players, year } = session.assembled();
  const club = clubUsage(player.meta.teamId, year);
  const { claimants, alsoPlaying } = castOf(job, players.filter((p) => p.meta.teamId === player.meta.teamId));
  return jobRead(
    job,
    {
      claimants,
      alsoPlaying,
      clubInningsAtPosition: job.kind === 'position' ? (club.inningsByPosition[job.position] ?? 0) : undefined,
      clubGames: club.games,
      window: session.jobWindow(player.meta.teamId, job),
    },
    player.meta.teamId
  );
}

/** One man's own work at his job at his club, from the session. */
function workOf(session: FarmSession, player: AssembledPlayer): { work: WorkShare | null; timing: ConflictTiming | null } {
  const job = farmJobOf(player);
  if (!job || player.rehab || player.injured !== null) return { work: null, timing: null };
  const inConflict = session
    .conflicts(player.meta.teamId)
    .find((c) => sameJob(c.job, job) && c.claimants.some((s) => s.playerId === player.row.player_id));
  if (inConflict) return { work: inConflict.claimants.find((s) => s.playerId === player.row.player_id) ?? null, timing: inConflict.timing };
  const { players, year } = session.assembled();
  const club = clubUsage(player.meta.teamId, year);
  const { claimants, alsoPlaying } = castOf(job, players.filter((p) => p.meta.teamId === player.meta.teamId));
  return {
    work: ownWork(player.row.player_id, job, {
      claimants,
      alsoPlaying,
      clubInningsAtPosition: job.kind === 'position' ? (club.inningsByPosition[job.position] ?? 0) : undefined,
      clubGames: club.games,
      window: session.jobWindow(player.meta.teamId, job),
    }),
    timing: null,
  };
}

const sameJob = (a: FarmJob, b: FarmJob): boolean =>
  a.kind === b.kind && (a.kind !== 'position' || (b.kind === 'position' && a.position === b.position));

/**
 * "What happens to the farm if this player leaves?" — the question MLB Operations asks.
 *
 * Minor League Operations OWNS this calculation and MLB Operations displays it. The old branch's
 * answer was a health delta; this one is the vacancy, who could fill it, the chain and where the
 * chain stops. An unresolved farm consequence is information, not an illegality: whether the
 * major-league transaction is possible is Player Rights', and this never touches it.
 */
export function farmConsequenceFor(orgId: number, playerId: number, session: FarmSession = openFarmSession(orgId)): FarmConsequenceV2 {
  const { players, metas, year } = session.assembled();
  const leaving = players.find((p) => p.row.player_id === playerId);

  if (!leaving) {
    return {
      player: null,
      sourceAffiliate: null,
      lostRole: null,
      affiliateImpact: null,
      currentOpportunity: null,
      playingTimeImpact: [],
      replacementOptions: [],
      cascade: null,
      unresolvedIssues: [],
      confidence: 'cannot_be_established',
      evidence: ['He is not on a minor-league affiliate of this organization, so there is no farm consequence to report.'],
      summary: 'No farm consequence: he is not on an affiliate roster.',
    };
  }

  if (leaving.rehab) {
    return {
      player: { playerId, name: leaving.name },
      sourceAffiliate: {
        teamId: leaving.meta.teamId,
        label: leaving.meta.label,
        level: leaving.meta.level,
        levelName: leaving.meta.levelName,
      },
      lostRole: null,
      affiliateImpact: {
        before: `${leaving.meta.label} does not count him as one of its own.`,
        after: `${leaving.meta.label} is unchanged.`,
        absorbed: true,
        statusBefore: affiliateOperationalUnder(session, leaving.meta.teamId)?.status ?? 'healthy',
        statusAfter: affiliateOperationalUnder(session, leaving.meta.teamId)?.status ?? 'healthy',
        findingsAfter: affiliateOperationalUnder(session, leaving.meta.teamId)?.findings.map((f) => f.headline) ?? [],
      },
      currentOpportunity: null,
      playingTimeImpact: [],
      replacementOptions: [],
      cascade: null,
      unresolvedIssues: [],
      confidence: 'established',
      evidence: [
        'He is on an injury-rehab assignment from the parent club, so he was never counted as affiliate depth (D-026). His return costs the affiliate nothing.',
      ],
      summary: `${leaving.name} is on a rehab assignment, so ${leaving.meta.label} loses nothing.`,
    };
  }

  const before = session.health().find((h) => h.teamId === leaving.meta.teamId);
  const after = session.healthScenario(leaving.meta.teamId, { removePlayerIds: [playerId] });
  const operationalBefore = affiliateOperationalUnder(session, leaving.meta.teamId);
  const operationalAfter = affiliateOperationalUnder(session, leaving.meta.teamId, { removePlayerIds: [playerId] });

  const job = jobOf(leaving);
  const vacancy = vacancyOf(leaving.meta, after, job, operationalAfter?.rotationClaimants ?? 0);

  const cascade = planCascade(
    {
      playerId,
      name: leaving.name,
      fromTeamId: leaving.meta.teamId,
      fromTeam: leaving.meta.label,
      job,
      reason: 'He is under consideration for a major-league assignment.',
      vacancy,
    },
    cascadePorts(session)
  );

  /*
   * Whose playing time actually changes. A regular at the job is already getting his work and the
   * departure does not change that; listing him said "a rotation spot opens up: Yu-min Lin was
   * regular there", which is true and useless. The men who gain are the ones who were sharing it or
   * not getting it.
   *
   * His job is READ whether or not the club contests it. Two men sharing a position are no conflict,
   * and reading only the affiliate's conflicts said nothing about the man who now has the job to
   * himself; it used to say something only because a sharing prospect was wrongly "squeezed".
   */
  const read = jobReadFor(session, leaving);
  const departedJob = read && read.claimants.some((s) => s.playerId === playerId) ? read : null;
  const playingTimeImpact = departedJob
    ? departedJob.claimants
        .filter((s) => s.playerId !== playerId && s.level !== 'regular')
        .map((s) => ({
          playerId: s.playerId,
          name: s.name,
          effect:
            s.level === 'unknown'
              ? `${jobDescription(departedJob)} opens up; how much of it ${s.name} has been getting cannot be read yet${s.tenure?.status === 'recent_arrival' ? ', because he joined the club inside the recent window' : ''}.`
              : `${jobDescription(departedJob)} opens up: ${s.name} has been ${s.level.replace('_', ' ')} there. ${s.basis}`,
        }))
    : [];

  /*
   * The first step's candidates are the replacements for HIM; a later step's candidate replaces the
   * replacement at his own club, which the first version listed under the same heading.
   */
  const first = cascade.steps[0];
  const replacementOptions: FarmConsequenceV2['replacementOptions'] =
    first && first.candidate
      ? [
          {
            playerId: first.candidate.playerId,
            name: first.candidate.name,
            from: first.candidate.fromTeam,
            judgment: first.development.judgment,
            preference: first.preference,
            detail: first.consequence.destination,
          },
          ...first.alternatives.map((a) => ({
            playerId: a.playerId,
            name: a.name,
            from: a.fromTeam,
            judgment: 'defensible',
            preference: a.preference,
            detail: `${a.name} is as defensible a replacement as ${first.candidate!.name}; the chain follows the first in readiness order.`,
          })),
        ]
      : [];

  const mine = workOf(session, leaving);
  const currentOpportunity = currentOpportunityOf(mine.work, mine.timing);

  const evidence: string[] = [];
  if (leaving.ambiguous) {
    evidence.push(
      `Nothing in the export or the log explains why he is at ${leaving.meta.label}, so he is counted as one of its own; if he is in fact on a rehab assignment this overstates the cost (D-026).`
    );
  }
  /*
   * How the playing-time side of the answer was read. Whether the club can ABSORB the vacancy is a
   * roster count and needs no usage; who gains the reps, and what he himself was holding, do.
   */
  if (currentOpportunity?.evidence === 'season_only') {
    evidence.push(
      `${leaving.meta.label}'s playing time is read on the season to date: this export has no game log, so a man who has since left may still show as holding work.`
    );
  } else if (currentOpportunity && currentOpportunity.evidence !== 'sufficient') {
    evidence.push(
      `His own role at ${leaving.meta.label} is not established: ${currentOpportunity.recentArrival ? 'he joined the club inside the recent window' : 'too few of its recent games can be counted for him'}, so what the club would be losing at ${jobLabelOf(job)} is read from the roster, not from his usage.`
    );
  }
  evidence.push(
    `${leaving.meta.label} is measured on its active list with rehab assignees excluded, against ${ROTATION_SPOTS} rotation spots and ${RELIEF_CORPS.thinBelow} relief arms.`
  );

  return {
    player: { playerId, name: leaving.name },
    sourceAffiliate: {
      teamId: leaving.meta.teamId,
      label: leaving.meta.label,
      level: leaving.meta.level,
      levelName: leaving.meta.levelName,
    },
    lostRole: jobLabelOf(job),
    affiliateImpact: before
      ? {
          before: describeHealth(before),
          after: describeHealth(after),
          absorbed: vacancy.absorbed,
          statusBefore: operationalBefore?.status ?? 'healthy',
          statusAfter: operationalAfter?.status ?? 'healthy',
          findingsAfter: operationalAfter?.findings.map((f) => f.headline) ?? [],
        }
      : null,
    currentOpportunity,
    playingTimeImpact,
    replacementOptions,
    cascade,
    unresolvedIssues: cascade.unresolved.map((u) => `${u.team} is left short at ${u.job}: ${u.detail}`),
    confidence: cascade.certainty === 'indeterminate' ? 'indeterminate' : 'established',
    evidence,
    summary: summarizeCascade(cascade),
  };
}

function jobOf(player: AssembledPlayer): Vacancy['job'] {
  if (player.kind === 'pitcher') {
    return player.primaryJob === 'the rotation' ? { kind: 'rotation' } : { kind: 'relief' };
  }
  return { kind: 'position', position: player.primaryJob ?? '—' };
}

const jobLabelOf = (job: Vacancy['job']): string =>
  job.kind === 'position' ? job.position : job.kind === 'rotation' ? 'a rotation spot' : 'a relief spot';

const jobDescription = (c: PlayingTimeConflict): string =>
  c.job.kind === 'position' ? c.job.position : c.job.kind === 'rotation' ? 'A rotation spot' : 'A relief spot';

/**
 * The hole a departure leaves at one job.
 *
 * The rotation count is the men TAKING the starts, not the OOTP role codes, for the same reason the
 * affiliate view counts them that way: Reno assigns four men to start and gets its starts from six,
 * so counting role codes said a rotation was two short when it was not short at all.
 */
function vacancyOf(
  meta: AffiliateMeta,
  after: AffiliateRosterHealth | undefined,
  job: Vacancy['job'],
  rotationClaimantsAfter: number
): Vacancy {
  const held =
    job.kind === 'rotation'
      ? rotationClaimantsAfter
      : job.kind === 'relief'
        ? (after?.pitching.relievers ?? 0)
        : (after?.positionPlayers.coverage.find((c) => c.position === job.position)?.playable ?? 0);
  const floor =
    job.kind === 'rotation' ? ROTATION_SPOTS : job.kind === 'relief' ? RELIEF_CORPS.thinBelow : POSITION_CAPACITY.covered;

  return {
    teamId: meta.teamId,
    team: meta.label,
    level: meta.level,
    levelName: meta.levelName,
    job,
    after: held,
    floor,
    absorbed: held >= floor,
    detail:
      held >= floor
        ? `${held} remain at ${jobLabelOf(job)}, and it needs ${floor}.`
        : `${held} remain at ${jobLabelOf(job)}, ${floor - held} short of the ${floor} it needs.`,
  };
}

const describeHealth = (h: AffiliateRosterHealth | undefined): string =>
  h
    ? `${h.roster.positionPlayers} position players and ${h.roster.pitchers} pitchers; ${h.pitching.starters} starters, ${h.pitching.relievers} relief arms; ${h.positionPlayers.fieldablePositions} of 8 positions fillable at once.`
    : 'not established';

/**
 * Candidates for a vacancy, from the level below only, each with Player Development's own verdict.
 *
 * The verdict is read from `computeProspects`' assignment evaluations for THAT player to THAT level.
 * Nothing here decides defensibility, and an indeterminate verdict is carried through as
 * indeterminate rather than dropped — the exact failure in the branch planner this replaces.
 */
function cascadePorts(session: FarmSession) {
  const { players, metas } = session.assembled();
  const prospects = session.prospects();
  const byId = new Map<number, ProspectRow>([...prospects.batters, ...prospects.pitchers].map((r) => [r.player_id, r]));
  const levels = [...new Set(metas.map((m) => m.level))].sort((a, b) => a - b);

  /**
   * What a candidate's own club looks like without him. Computed only for a candidate the planner can
   * actually follow (defensible or indeterminate): a man Player Development ruled out or has not
   * evaluated is never chosen, and reading the roster scenario for each of fifteen of them was most
   * of the cost of a cascade.
   */
  const sourceAfterOf = (p: AssembledPlayer): Vacancy =>
    vacancyOf(
      p.meta,
      session.healthScenario(p.meta.teamId, { removePlayerIds: [p.row.player_id] }),
      jobOf(p),
      players.filter(
        (x) => x.meta.teamId === p.meta.teamId && !x.rehab && x.injured === null && x.primaryJob === 'the rotation' && x.row.player_id !== p.row.player_id
      ).length
    );

  const unread = (p: AssembledPlayer): Vacancy => ({
    teamId: p.meta.teamId,
    team: p.meta.label,
    level: p.meta.level,
    levelName: p.meta.levelName,
    job: jobOf(p),
    after: 0,
    floor: 0,
    absorbed: false,
    detail: 'Not read: Player Development would not have him move, so his club without him was not evaluated.',
  });

  return {
    hasLevelBelow(level: number): boolean {
      return levels.some((l) => l > level);
    },

    candidatesFor(vacancy: Vacancy): CascadeCandidate[] {
      const belowLevel = levels.filter((l) => l > vacancy.level).sort((a, b) => a - b)[0];
      if (belowLevel === undefined) return [];

      const pool = poolFor(
        vacancy,
        players.map((p) => ({
          playerId: p.row.player_id,
          kind: p.kind,
          primaryJob: p.primaryJob,
          coverage: p.coverage,
          level: p.meta.level,
          rehab: p.rehab,
          injured: p.injured !== null,
          player: p,
        })),
        belowLevel
      );

      const candidates: CascadeCandidate[] = pool.map(({ player: p }) => {
        const evaluation = byId
          .get(p.row.player_id)
          ?.assignments?.evaluations?.find((e) => e.target.level === vacancy.level && e.direction === 'promotion');
        const judgment = evaluation ? evaluation.judgment : 'not_evaluated';
        const followable = judgment === 'defensible' || judgment === 'indeterminate';

        return {
          playerId: p.row.player_id,
          name: p.name,
          age: Number(p.row.age),
          fromTeamId: p.meta.teamId,
          fromTeam: p.meta.label,
          fromLevel: p.meta.level,
          fromLevelName: p.meta.levelName,
          judgment,
          blockers: evaluation?.blockers ?? [
            'Player Development has not evaluated a promotion for him: he has no qualifying current-level sample.',
          ],
          missingEvidence: (evaluation?.missingEvidence ?? []) as CascadeCandidate['missingEvidence'],
          preference: evaluation?.judgment === 'defensible' ? (evaluation.preference ?? null) : null,
          preferenceBasis:
            evaluation?.judgment === 'defensible' && evaluation.preference
              ? 'Promotion aggressiveness, among the defensible assignments only.'
              : null,
          /*
           * The job is open because somebody left it. Asking the destination's CURRENT conflicts
           * whether it is contested double-counts the man who is going: it reported "already has six
           * with a claim on five spots" about the very vacancy being filled.
           */
          destinationOpportunity: {
            open: vacancy.after < vacancy.floor,
            detail:
              vacancy.after < vacancy.floor
                ? `The job is open: ${vacancy.team} has ${vacancy.after} of the ${vacancy.floor} it needs at ${jobLabelOf(vacancy.job)}.`
                : `${vacancy.team} already has ${vacancy.after} at ${jobLabelOf(vacancy.job)}, which supports ${vacancy.floor}, so the reps are not assured.`,
          },
          sourceAfter: followable ? sourceAfterOf(p) : unread(p),
        };
      });

      /*
       * Ordered by how ready the move is, not by a score of players (the MLB module's rule, D-030):
       * a defensible move first, then one that cannot be judged, then the rest, and within each by
       * name so the order is stable.
       */
      const rank = (c: CascadeCandidate): number =>
        c.judgment === 'defensible' ? 0 : c.judgment === 'indeterminate' ? 1 : 2;
      return candidates.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    },
  };
}

/* ── an arrival: what happens where a player is sent ────────────────────────────────────────── */

export interface FarmArrival {
  player: { playerId: number; name: string } | null;
  destination: { teamId: number; label: string; level: number; levelName: string } | null;
  /** The job he would take up there, from his role or his listed position. */
  job: string | null;
  /** Everyone who would then have a claim on it, him included with nothing yet, and what each is getting. */
  holders: Array<{ playerId: number; name: string; age: number; tier: string | null; level: string; basis: string }>;
  capacity: number | null;
  /** More men with a claim on the job than it supports, once he is there. */
  contested: boolean;
  /**
   * Whether the competition he would join is the present, the past, or not yet readable. `uncertain`
   * and `season_only` both mean the holders' roles should not be taken as settled.
   */
  timing: ConflictTiming | null;
  /** Men with developmental stakes who are already short of the job and would be pushed further. */
  displaced: Array<{ playerId: number; name: string; age: number; tier: string | null }>;
  confidence: 'established' | 'indeterminate' | 'cannot_be_established';
  evidence: string[];
  summary: string;
}

/**
 * "What happens to the affiliate if this player is sent there?" — the other direction of the
 * contract, for an option. Nothing is vacated, so there is no cascade; what there is, is the job he
 * takes up and who is already on it. Minor League Operations owns this answer as it owns the other.
 */
export function farmArrivalFor(orgId: number, playerId: number, teamId: number, session: FarmSession = openFarmSession(orgId)): FarmArrival {
  const { players, metas, year } = session.assembled();
  const meta = metas.find((m) => m.teamId === teamId);
  const row = anyPlayer(playerId);
  if (!meta || !row) {
    return {
      player: row ? { playerId, name: `${row.first_name} ${row.last_name}` } : null,
      destination: meta ? { teamId: meta.teamId, label: meta.label, level: meta.level, levelName: meta.levelName } : null,
      job: null,
      holders: [],
      capacity: null,
      contested: false,
      timing: null,
      displaced: [],
      confidence: 'cannot_be_established',
      evidence: [meta ? 'He could not be found in the export.' : 'The destination is not a minor-league affiliate of this organization.'],
      summary: meta ? 'No arrival consequence: he could not be found.' : 'No arrival consequence: the destination is not one of the organization\'s affiliates.',
    };
  }

  const name = `${row.first_name} ${row.last_name}`;
  const kind: 'hitter' | 'pitcher' = Number(row.position) === 1 ? 'pitcher' : 'hitter';
  const listed = POSITION_CODES[Number(row.position) - 1] ?? null;
  const existing = players.find((p) => p.row.player_id === playerId);
  const coverage =
    existing?.coverage ??
    (kind === 'hitter'
      ? (scoutedGloves(playerId)?.positions.filter((x) => (FIELDING_POSITIONS as readonly string[]).includes(x.code) && x.current > 0).map((x) => x.code) ?? [])
      : []);
  const job =
    kind === 'pitcher'
      ? Number(row.role) === OOTP_STARTER_ROLE
        ? 'the rotation'
        : 'the bullpen'
      : listed && (FIELDING_POSITIONS as readonly string[]).includes(listed)
        ? listed
        : (coverage[0] ?? null);
  /*
   * A man who is not on an affiliate yet — a major leaguer being optioned — is tiered by the same
   * reader, in the context of the club the export has him on NOW. Where he is being sent does not
   * change what is at stake in his development.
   */
  const tier =
    existing?.protection.tier ??
    session.stakes().protect({ age: row.age, teamId: Number(row.team_id), ability: loadScoutedAbilities([playerId]).for(playerId) }).tier;

  const club = clubUsage(teamId, year);
  const mine = players.filter((p) => p.meta.teamId === teamId && p.row.player_id !== playerId);
  const newcomer: UsageFacts = {
    playerId,
    name,
    age: Number(row.age),
    clubGames: club.games,
    games: 0,
    inningsByPosition: {},
    starts: 0,
    reliefAppearances: 0,
    inningsPitched: 0,
    tier,
    rehab: false,
  };

  const destination = { teamId: meta.teamId, label: meta.label, level: meta.level, levelName: meta.levelName };
  if (job === null) {
    return {
      player: { playerId, name },
      destination,
      job: null,
      holders: [],
      capacity: null,
      contested: false,
      timing: null,
      displaced: [],
      confidence: 'cannot_be_established',
      evidence: ['He has no listed position and no revealed fielding grade, so the job he would take up cannot be named.'],
      summary: `${name} would join ${meta.label}; the job he would take up cannot be named.`,
    };
  }

  /*
   * The arrival IS the conflict that would exist with him on the club. He is added as a claimant with
   * nothing yet, which is the truth of the day he arrives; the question is who is already on the job.
   */
  const farmJob: FarmJob = job === 'the rotation' ? { kind: 'rotation' } : job === 'the bullpen' ? { kind: 'relief' } : { kind: 'position', position: job };
  const cast = castOf(farmJob, mine);
  const claimants = cast.claimants;
  /* The same window the workspace reads the club on: the holders are read as they are NOW. */
  const window = session.jobWindow(teamId, farmJob);
  /*
   * The job is READ whether or not it is contested. Who holds it is a fact about the club, and asking
   * only for a contested job made the answer depend on the arriving man's own tier: a veteran the old
   * absolute composite gave developmental stakes was himself "squeezed" on the day he arrived, which
   * is what made a two-man job contested and its holders named (docs/DEVELOPMENTAL_STAKES.md B-1).
   */
  const conflict = jobRead(
    farmJob,
    {
      claimants: [...claimants, newcomer],
      alsoPlaying: cast.alsoPlaying,
      clubInningsAtPosition: farmJob.kind === 'position' ? (club.inningsByPosition[farmJob.position] ?? 0) : undefined,
      clubGames: club.games,
      window,
    },
    teamId
  );

  const capacity = job === 'the rotation' ? calibration.STARTER_CAPACITY : job === 'the bullpen' ? calibration.RELIEF_CAPACITY : POSITION_CAPACITY.covered;
  const evidence: string[] = [];
  if (club.games < calibration.MINIMUM_CLUB_GAMES) {
    evidence.push(`${meta.label} has played ${club.games} games, fewer than the ${calibration.MINIMUM_CLUB_GAMES} a work share needs, so who holds ${job} there cannot be read yet.`);
    return {
      player: { playerId, name },
      destination,
      job,
      holders: [],
      capacity,
      contested: claimants.length + 1 > capacity,
      timing: null,
      displaced: [],
      confidence: 'indeterminate',
      evidence,
      summary: `${name} would be one of ${claimants.length + 1} men with a claim on ${job} at ${meta.label}, which supports ${capacity}; how the club is using them cannot be read yet.`,
    };
  }

  const holders = (conflict?.claimants ?? [])
    .filter((c) => c.playerId !== playerId)
    .map((c) => ({ playerId: c.playerId, name: c.name, age: c.age, tier: c.tier, level: c.level, basis: c.basis }));
  const displaced = (conflict?.squeezed ?? [])
    .filter((c) => c.playerId !== playerId)
    .map((c) => ({ playerId: c.playerId, name: c.name, age: c.age, tier: c.tier }));
  const contested = claimants.length + 1 > capacity;
  const readOn = conflict?.window
    ? conflict.window.since
      ? `the ${conflict.window.counted} ${conflict.window.counted === 1 ? 'game' : 'games'} since ${conflict.window.since.name} last started there`
      : `its last ${conflict.window.games} games`
    : 'its usage this season';
  evidence.push(`${meta.label} is read on ${readOn}: ${claimants.length} ${claimants.length === 1 ? 'man has' : 'men have'} a claim on ${job} before he arrives, and it supports ${capacity}.`);
  if (conflict?.unknowns.length) evidence.push(...conflict.unknowns);

  const summary = contested
    ? `${name} would make ${claimants.length + 1} men with a claim on ${job} at ${meta.label}, which supports ${capacity}${displaced.length > 0 ? `; ${displaced.map((d) => `${d.name} (${d.age})`).join(', ')} ${displaced.length === 1 ? 'is' : 'are'} already short of it` : ''}.`
    : `${meta.label} has room for him at ${job}: ${claimants.length} ${claimants.length === 1 ? 'man holds' : 'men hold'} it and it supports ${capacity}.`;

  return {
    player: { playerId, name },
    destination,
    job,
    holders,
    capacity,
    contested,
    timing: conflict?.timing ?? null,
    displaced,
    confidence: conflict?.unknowns.length ? 'indeterminate' : 'established',
    evidence,
    summary,
  };
}
