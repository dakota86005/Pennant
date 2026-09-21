/**
 * Playing-time opportunity and role congestion, as conflicts rather than a score.
 *
 * A developmentally appropriate level can still be a poor assignment if the player cannot get
 * meaningful work there. The farm v1 model had no vocabulary for this at all: it counted bodies,
 * called a surplus healthy, and on the real import reported an affiliate carrying twenty-eight
 * pitchers — twenty-three of them relievers — as healthy, and another carrying nine left fielders
 * against one shortstop as having only a shortstop problem.
 *
 * Two deliberate rules, both from the MLB hardening phase:
 *
 *   * No opaque playing-time score (lesson E). A conflict is a named set of players competing for a
 *     named job, with what each has been getting, so the GM can see who is squeezed and decide.
 *   * Standing at a position is not playing there (D-042). Usage says who has the job; the roster
 *     says who is available for it. Both are shown.
 *
 * Pure: usage, roster membership and developmental stakes in, conflicts out. It reads no table and
 * no rating, and it judges nobody's ability — which player should get the reps is a Player
 * Development and philosophy question, asked elsewhere.
 */

import {
  DEPARTED_SHARE_NOTED,
  MINIMUM_CLUB_GAMES,
  PART_TIME_SHARE,
  POSITION_CAPACITY,
  REGULAR_PLAY_SHARE,
  REGULAR_SHARE,
  RELIEF_CAPACITY,
  RELIEF_EVEN_SHARE_PART_TIME,
  ROTATION_SHARE,
  STARTER_CAPACITY,
} from './farmCalibration.js';
import type { DevelopmentProtectionTier } from './developmentFit.js';

/** A job on an affiliate that a player can hold. */
export type FarmJob =
  | { kind: 'position'; position: string }
  | { kind: 'rotation' }
  | { kind: 'relief' };

export const jobLabel = (job: FarmJob): string =>
  job.kind === 'position' ? job.position : job.kind === 'rotation' ? 'the rotation' : 'the bullpen';

/** What a player has actually been getting at his club, from usage. Objective. */
export interface UsageFacts {
  playerId: number;
  name: string;
  age: number;

  /** Games his club has played, so a small number can be told from a small share. */
  clubGames: number;

  /** Games he has appeared in, at any position. */
  games: number;

  /** Innings at each position, keyed by position code. Hitters only. */
  inningsByPosition: Record<string, number>;

  /** Games started as a pitcher, and relief appearances. Pitchers only. */
  starts: number;
  reliefAppearances: number;

  /** Innings pitched. Pitchers only. */
  inningsPitched: number;

  /**
   * The developmental stakes of his getting work, from Player Development's protection tier.
   * null when the tier is indeterminate: unknown stakes stay unknown and never become "low".
   */
  tier: DevelopmentProtectionTier | null;

  /** He is a parent-club player on a rehab assignment, not a member of this club (D-026). */
  rehab: boolean;

  /**
   * He is injured (not merely day-to-day), so he is competing for nothing while he is out. An
   * injured prospect's zero innings are a fact about his health, not about who holds his job.
   */
  injured?: boolean;
}

/** How much of the job a player is getting. */
export type WorkLevel =
  | 'regular'
  | 'part_time'
  | 'occasional'
  | 'not_used'
  /**
   * In the lineup most days but not in the field at this job: a designated hitter. His bat is
   * getting its work and his glove is not, which for a player whose development includes the
   * position is a different problem from not playing.
   */
  | 'bat_only'
  /** His club has barely played, so there is no share to read yet. */
  | 'unknown';

export interface WorkShare {
  playerId: number;
  name: string;
  age: number;
  tier: DevelopmentProtectionTier | null;
  level: WorkLevel;
  /** Share of the job he holds, 0 to 1; null when it cannot be read. */
  share: number | null;
  /** The facts behind it, in words. */
  basis: string;
}

/** Players competing for one job, and who is being squeezed. */
export interface PlayingTimeConflict {
  teamId: number;
  job: FarmJob;

  /** How many the job supports before somebody is not getting developmental work. */
  capacity: number;

  /** Everyone with a claim on the job, most work first. */
  claimants: WorkShare[];

  /**
   * Men on the club who are getting innings at this job without it being the one they are competing
   * for: a corner outfielder covering centre, a two-way player at first base. They do not count
   * against the job's capacity — one man, one job — but they are a fact about who is actually ahead
   * of a claimant, and leaving them out named a part-time man as the one "occupying" a path when the
   * reps were being taken by somebody the model had filed under another position.
   */
  alsoPlaying: WorkShare[];

  /**
   * Those whose development the shortage is actually costing: a claimant with real developmental
   * stakes who is not getting regular work. Empty is a real answer — a crowded job whose extra men
   * are organizational depth is congestion, not a development problem.
   */
  squeezed: WorkShare[];

  /** How pressing it is, from the stakes and the shortfall. Never a number. */
  severity: 'blocking' | 'crowded' | 'noted';

  /** What is unknown, named. */
  unknowns: string[];
}

/** Stakes that make being squeezed a development problem rather than ordinary depth. */
const STAKES_ORDER: DevelopmentProtectionTier[] = [
  'organizational_depth',
  'normal',
  'development_priority',
  'protected_prospect',
  'core_prospect',
];

const stakesRank = (tier: DevelopmentProtectionTier | null): number =>
  tier === null ? -1 : STAKES_ORDER.indexOf(tier);

/** A tier for whom missing reps is a developmental cost, not a roster detail. */
export const hasDevelopmentalStakes = (tier: DevelopmentProtectionTier | null): boolean =>
  tier !== null && stakesRank(tier) >= STAKES_ORDER.indexOf('development_priority');

function workLevel(share: number | null, clubGames: number, gameShare: number | null = null): WorkLevel {
  if (clubGames < MINIMUM_CLUB_GAMES) return 'unknown';
  if (share === null) return 'unknown';
  if (share >= REGULAR_SHARE) return 'regular';
  if (share >= PART_TIME_SHARE) return 'part_time';
  /*
   * Little or nothing in the field, but in the lineup most days: the designated hitter. Read before
   * "not used", because a man batting every day is not a man the club has forgotten.
   */
  if (gameShare !== null && gameShare >= REGULAR_PLAY_SHARE) return 'bat_only';
  if (share <= 0) return 'not_used';
  return 'occasional';
}

/** Work levels at which a claimant with developmental stakes is being squeezed. */
const SQUEEZED_LEVELS: ReadonlySet<WorkLevel> = new Set<WorkLevel>(['occasional', 'not_used', 'part_time', 'bat_only']);

/** Men who are competing for something. Rehab assignees and injured players are not. */
const competing = (c: UsageFacts): boolean => !c.rehab && c.injured !== true;

/* ── position players ────────────────────────────────────────────────────────────────────────── */

/**
 * Who has the reps at one position, and who is competing for it but not getting them.
 *
 * One man, one job. A claim is the job he is actually trying to win — the position his usage shows
 * he plays, or his listed position when usage shows nothing — not every position he could stand at.
 * The first version counted a claim at every position a player had a revealed grade for, so one
 * versatile twenty-year-old with grades at five spots was reported as blocked five times and the
 * organization's attention list ran to 137 items. Versatility is COVER, which belongs to the
 * operational reading; it is not five developmental claims (the farm's version of D-042's
 * "standing at a position is not covering it", and of F-6's "one man, one spot").
 */
export function positionConflict(
  teamId: number,
  position: string,
  claimants: readonly UsageFacts[],
  clubInningsAtPosition: number,
  alsoPlaying: readonly UsageFacts[] = []
): PlayingTimeConflict | null {
  const members = claimants.filter(competing);
  if (members.length === 0) return null;
  /*
   * A club that has not played has not shown how it is using anyone. The complex affiliates of the
   * real import carry forty-man rosters by design and had played ten games and none at all; reading
   * congestion there reported twenty-two men competing for a bullpen out of a season that had not
   * happened. The affiliate view says how many games the club has played instead.
   */
  if (members[0].clubGames < MINIMUM_CLUB_GAMES) return null;

  const shareOf = (c: UsageFacts, coverHolder = false): WorkShare => {
    const innings = c.inningsByPosition[position] ?? 0;
    const share = clubInningsAtPosition > 0 ? innings / clubInningsAtPosition : null;
    /* A cover holder's games are at his own job; only a claimant can be batting instead of fielding here. */
    const gameShare = !coverHolder && c.clubGames > 0 ? c.games / c.clubGames : null;
    const level = workLevel(share, c.clubGames, gameShare);
    return {
      playerId: c.playerId,
      name: c.name,
      age: c.age,
      tier: c.tier,
      level,
      share,
      basis:
        clubInningsAtPosition > 0
          ? level === 'bat_only'
            ? `${Math.round(innings)} of the club's ${Math.round(clubInningsAtPosition)} innings at ${position}, but in the lineup for ${c.games} of its ${c.clubGames} games: he is batting, not fielding.`
            : `${Math.round(innings)} of the club's ${Math.round(clubInningsAtPosition)} innings at ${position}.`
          : `The club has played ${c.clubGames} games; innings at ${position} are not yet a share.`,
    };
  };

  const byShare = (a: WorkShare, b: WorkShare) => (b.share ?? -1) - (a.share ?? -1);
  const shares: WorkShare[] = members.map((c) => shareOf(c)).sort(byShare);
  const others: WorkShare[] = alsoPlaying
    .filter((c) => competing(c) && (c.inningsByPosition[position] ?? 0) > 0 && !members.some((m) => m.playerId === c.playerId))
    .map((c) => shareOf(c, true))
    .sort(byShare);

  const capacity = POSITION_CAPACITY.covered;
  const squeezed = shares.filter((s) => hasDevelopmentalStakes(s.tier) && SQUEEZED_LEVELS.has(s.level));

  const unknowns: string[] = [];
  if (shares.some((s) => s.level === 'unknown')) {
    unknowns.push(`Some shares cannot be read yet: the club has played fewer than ${MINIMUM_CLUB_GAMES} games.`);
  }
  if (members.some((c) => c.tier === null)) {
    unknowns.push(
      'Developmental stakes are indeterminate for at least one claimant, so whether the shortage costs development is unknown for him.'
    );
  }
  /*
   * Usage is the season to date, and a club is not. When a regular has been promoted or released his
   * innings still stand in the denominator and nobody on the roster shows as holding them; the
   * competition as it stands today is then thinner than the shares say, and the GM is told so
   * rather than left to read a vacated job as a crowded one.
   */
  const rosteredInnings = [...members, ...alsoPlaying].reduce((sum, c) => sum + (c.inningsByPosition[position] ?? 0), 0);
  const departed = clubInningsAtPosition - rosteredInnings;
  if (clubInningsAtPosition > 0 && departed / clubInningsAtPosition >= DEPARTED_SHARE_NOTED) {
    unknowns.push(
      `${Math.round(departed)} of the club's ${Math.round(clubInningsAtPosition)} innings at ${position} were played by men no longer on its roster, so the shares describe the season so far, not the competition as it stands.`
    );
  }

  /*
   * A conflict needs competition. One man not playing is a fact about HIM — his own assignment
   * review says so — and calling it a positional conflict reported the same problem twice and put a
   * one-claimant "conflict" on the affiliate page.
   */
  if (members.length <= capacity && !(members.length > 1 && squeezed.length > 0)) return null;

  return {
    teamId,
    job: { kind: 'position', position },
    capacity,
    claimants: shares,
    alsoPlaying: others,
    squeezed,
    severity: squeezed.length > 0 ? 'blocking' : members.length >= POSITION_CAPACITY.congestedAt ? 'crowded' : 'noted',
    unknowns,
  };
}

/* ── pitchers ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Who is starting and who is not.
 *
 * A pitcher the club is using as a starter and who is not getting starts is the pitching analogue of
 * a blocked position prospect, and it is the question the farm v1 model could not ask: it counted
 * role codes and called seven starters a surplus.
 *
 * The claimants are pitchers actually competing for the rotation — the club's assigned starters and
 * anyone who has started a game — not every arm whose stamina and repertoire would ALLOW starting.
 * The first version used the second set, which at Triple-A made eight men claimants for five spots
 * because most relief arms clear a stamina line. Whether a relief arm should be starting instead is
 * a role-conversion question Player Development owns, and it is reported as one.
 */
export function rotationConflict(
  teamId: number,
  rotationClaimants: readonly UsageFacts[],
  clubGames: number
): PlayingTimeConflict | null {
  const members = rotationClaimants.filter(competing);
  if (members.length === 0) return null;
  if (clubGames < MINIMUM_CLUB_GAMES) return null;

  /* A five-man rotation over the club's games is roughly a fifth of the starts each. */
  const clubStarts = clubGames;
  const shares: WorkShare[] = members
    .map((c) => {
      const share = clubStarts > 0 ? c.starts / (clubStarts / STARTER_CAPACITY) : null;
      const capped = share === null ? null : Math.min(1, share * REGULAR_SHARE + (share >= ROTATION_SHARE.regular ? REGULAR_SHARE : 0));
      return {
        playerId: c.playerId,
        name: c.name,
        age: c.age,
        tier: c.tier,
        level:
          clubStarts < MINIMUM_CLUB_GAMES
            ? ('unknown' as WorkLevel)
            : c.starts === 0
              ? ('not_used' as WorkLevel)
              : share !== null && share >= ROTATION_SHARE.regular
                ? ('regular' as WorkLevel)
                : share !== null && share >= ROTATION_SHARE.partTime
                  ? ('part_time' as WorkLevel)
                  : ('occasional' as WorkLevel),
        share: capped,
        basis: `${c.starts} starts and ${Math.round(c.inningsPitched)} innings while the club played ${clubStarts} games.`,
      };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

  const squeezed = shares.filter(
    (s) => hasDevelopmentalStakes(s.tier) && (s.level === 'not_used' || s.level === 'occasional')
  );

  if (members.length <= STARTER_CAPACITY && !(members.length > 1 && squeezed.length > 0)) return null;

  const unknowns: string[] = [];
  if (shares.some((s) => s.level === 'unknown')) unknowns.push(`The club has played fewer than ${MINIMUM_CLUB_GAMES} games, so a starter's share cannot be read.`);
  if (members.some((c) => c.tier === null)) {
    unknowns.push('Developmental stakes are indeterminate for at least one starter.');
  }

  return {
    teamId,
    job: { kind: 'rotation' },
    capacity: STARTER_CAPACITY,
    claimants: shares,
    alsoPlaying: [],
    squeezed,
    severity: squeezed.length > 0 ? 'blocking' : members.length > STARTER_CAPACITY ? 'crowded' : 'noted',
    unknowns,
  };
}

/** Relief arms competing for innings. Crowding here costs innings, not a role. */
export function reliefConflict(
  teamId: number,
  relievers: readonly UsageFacts[],
  clubGames: number
): PlayingTimeConflict | null {
  const members = relievers.filter(competing);
  if (members.length <= RELIEF_CAPACITY) return null;
  if (clubGames < MINIMUM_CLUB_GAMES) return null;

  const totalInnings = members.reduce((sum, c) => sum + c.inningsPitched, 0);
  const shares: WorkShare[] = members
    .map((c) => {
      const share = totalInnings > 0 ? c.inningsPitched / totalInnings : null;
      const even = 1 / members.length;
      return {
        playerId: c.playerId,
        name: c.name,
        age: c.age,
        tier: c.tier,
        level:
          clubGames < MINIMUM_CLUB_GAMES
            ? ('unknown' as WorkLevel)
            : share === null || share <= 0
              ? ('not_used' as WorkLevel)
              : share >= even
                ? ('regular' as WorkLevel)
                : share >= even * RELIEF_EVEN_SHARE_PART_TIME
                  ? ('part_time' as WorkLevel)
                  : ('occasional' as WorkLevel),
        share,
        basis: `${Math.round(c.inningsPitched)} of the relief corps' ${Math.round(totalInnings)} innings.`,
      };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

  const squeezed = shares.filter(
    (s) => hasDevelopmentalStakes(s.tier) && (s.level === 'occasional' || s.level === 'not_used')
  );

  const unknowns: string[] = [];
  if (shares.some((s) => s.level === 'unknown')) unknowns.push(`The club has played fewer than ${MINIMUM_CLUB_GAMES} games, so an innings share cannot be read.`);

  return {
    teamId,
    job: { kind: 'relief' },
    capacity: RELIEF_CAPACITY,
    claimants: shares,
    alsoPlaying: [],
    squeezed,
    severity: squeezed.length > 0 ? 'blocking' : 'crowded',
    unknowns,
  };
}

/* ── reading one player's own opportunity ────────────────────────────────────────────────────── */

export type OpportunityVerdict =
  | 'regular_work'
  | 'shared_work'
  | 'insufficient_work'
  | 'not_playing'
  /** In the lineup most days as the designated hitter, and not in the field at his job. */
  | 'bat_only'
  /** The club has barely played, or usage is not exported: unknown stays unknown. */
  | 'indeterminate';

/** A man getting more of the job than the player being read, and how much of it he holds. */
export interface AheadOfHim {
  playerId: number;
  name: string;
  age: number;
  share: number | null;
  level: WorkLevel;
  /** He is on the job's developmental path (a claimant), not merely covering it. */
  claimant: boolean;
}

export interface OpportunityRead {
  verdict: OpportunityVerdict;
  /** The job his usage says he is competing for; null when nothing does. */
  job: FarmJob | null;
  /** Who is ahead of him at it, claimants and cover holders alike, most work first. */
  ahead: AheadOfHim[];
  reasons: string[];
  unknowns: string[];
}

/**
 * Is this player getting the work his development needs where he is?
 *
 * Deliberately blind to how good he is. "He is not playing" is a fact about the assignment; whether
 * he deserves to play is Player Development's, and whether the organization prefers to move him is
 * philosophy's.
 */
export function readOpportunity(playerId: number, conflicts: readonly PlayingTimeConflict[]): OpportunityRead {
  const mine = conflicts
    .map((c) => ({ conflict: c, me: c.claimants.find((s) => s.playerId === playerId) }))
    .filter((x): x is { conflict: PlayingTimeConflict; me: WorkShare } => x.me !== undefined);

  if (mine.length === 0) {
    return { verdict: 'regular_work', job: null, ahead: [], reasons: ['No job on this club is contested for him.'], unknowns: [] };
  }

  /* The job where he is worst off is the one that describes his situation. */
  const order: Record<WorkLevel, number> = { not_used: 0, occasional: 1, bat_only: 2, part_time: 3, regular: 4, unknown: 5 };
  mine.sort((a, b) => order[a.me.level] - order[b.me.level]);
  const { conflict, me } = mine[0];

  const ahead: AheadOfHim[] = [
    ...conflict.claimants.map((s) => ({ ...s, claimant: true })),
    ...conflict.alsoPlaying.map((s) => ({ ...s, claimant: false })),
  ]
    .filter((s) => s.playerId !== playerId && (s.share ?? 0) > (me.share ?? 0))
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1))
    .map((s) => ({ playerId: s.playerId, name: s.name, age: s.age, share: s.share, level: s.level, claimant: s.claimant }));

  const verdict: OpportunityVerdict =
    me.level === 'unknown'
      ? 'indeterminate'
      : me.level === 'not_used'
        ? 'not_playing'
        : me.level === 'occasional'
          ? 'insufficient_work'
          : me.level === 'bat_only'
            ? 'bat_only'
            : me.level === 'part_time'
              ? 'shared_work'
              : 'regular_work';

  const reasons = [me.basis];
  /* The men who matter are the ones holding a real share of it; an occasional cover is in the data, not the sentence. */
  const named = ahead.filter((a) => a.level === 'regular' || a.level === 'part_time');
  const mention = named.length > 0 ? named : ahead;
  if (mention.length > 0) {
    const describe = (a: AheadOfHim) => (a.claimant ? a.name : `${a.name} (covering it from another position)`);
    const names = mention.map(describe);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    reasons.push(`${list} ${names.length === 1 ? 'is' : 'are'} ahead of him at ${jobLabel(conflict.job)}.`);
  }
  if (conflict.claimants.length > conflict.capacity) {
    reasons.push(
      `${conflict.claimants.length} men have a claim on ${jobLabel(conflict.job)}, which supports ${conflict.capacity}.`
    );
  }

  return { verdict, job: conflict.job, ahead, reasons, unknowns: conflict.unknowns };
}

/**
 * Who, of the men ahead of him, is actually HOLDING the job: a regular there. A part-time man ahead
 * of a prospect is not occupying his path — the reps are split, or were taken by somebody since gone —
 * and naming him as the blocker made a twenty-three-year-old with a fifth of centre field the man
 * "occupying the developmental path" of the prospect behind him. With nobody regular the prospect's
 * problem is real and is an opportunity conflict, not a blockage by a named man.
 */
export function blockersOf(read: OpportunityRead): AheadOfHim[] {
  return read.ahead.filter((a) => a.level === 'regular');
}

/** Whether a player appeared often enough for his rate statistics to describe regular work. */
export function playedRegularly(usage: UsageFacts): boolean {
  return usage.clubGames > 0 && usage.games / usage.clubGames >= REGULAR_PLAY_SHARE;
}
