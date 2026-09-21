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
  RECENT_MINIMUM_GAMES,
  RECENT_ROTATION_SHARE,
  REGULAR_PLAY_SHARE,
  REGULAR_SHARE,
  RELIEF_CAPACITY,
  RELIEF_EVEN_SHARE_PART_TIME,
  ROTATION_SHARE,
  STARTER_CAPACITY,
} from './farmCalibration.js';
import type { DevelopmentProtectionTier } from './developmentFit.js';
import { describeTenure, gamesAgo, type RecentEvidence, type RecentUsage, type Tenure } from './farmRecentUsage.js';

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

  /**
   * What the game log shows him doing over the club's last few games, measured only over the games he
   * could have played in. Absent or null when the export has no game log: the recent read is then
   * UNAVAILABLE and every function here reads the season exactly as it did before the window existed.
   */
  recent?: RecentUsage | null;

  /**
   * He is one of the men OOTP has lined up to start the club's next games. Current state, exported,
   * and the only such statement the export makes about a role; null when it does not say. Pitchers.
   */
  projectedStarter?: boolean | null;
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

/** One read of how much of a job a man holds. */
export interface WorkRead {
  level: WorkLevel;
  /** Share of the job, 0 to 1; null when it cannot be read. */
  share: number | null;
  /** The facts behind it, in words. */
  basis: string;
}

/** The recent read, with how much it rests on. */
export interface RecentWorkRead extends WorkRead {
  /** His starts at the job (or, in relief, his appearances) in the games counted. */
  work: number;
  /**
   * The games counted: the window's, less any from before he arrived, before the job last changed
   * hands, inside an injury spell, or started by a rehab assignee. This is the sample.
   */
  games: number;
  /** Club games the window covers. */
  windowGames: number;
  evidence: RecentEvidence;
}

export interface WorkShare {
  playerId: number;
  name: string;
  age: number;
  tier: DevelopmentProtectionTier | null;

  /**
   * His CURRENT work level: the recent read when it can be read, the season's when there is no recent
   * read at all, and `unknown` when there is one but it is too thin to establish a role. History is
   * never allowed to stand in for a present it does not describe.
   */
  level: WorkLevel;
  /** The share behind `level`. */
  share: number | null;
  /** The facts behind `level`, in words. */
  basis: string;

  /**
   * What `level` rests on. `current_state` is a pitcher OOTP has in its next five starters whose usage
   * has not caught up: an exported fact about now outranks a usage read of the past (D-020).
   */
  levelFrom: 'recent' | 'season' | 'current_state';

  /** The season to date. Always kept: it is context, and it is what the recent read is set beside. */
  season: WorkRead;
  /** The recent window. null when the export has no game log. */
  recent: RecentWorkRead | null;
  /** How long he has been on the club, when the recent read exists. */
  tenure: Tenure | null;
  /** The season and the recent read place him at different levels of work. Both are shown. */
  disagrees: boolean;
}

/** Whether a conflict is the present, the past, or not yet readable. */
export type ConflictTiming =
  /** No recent read is available: this is the season to date, as it always was. */
  | 'season_only'
  /** The recent read shows it too. */
  | 'current'
  /** The recent read shows it and the season does not: newly emerging. */
  | 'emerging'
  /** The season shows it and the recent read does not. */
  | 'historical'
  /** Historical, and a man who held the job has since left it. */
  | 'recently_resolved'
  /** The recent evidence is too thin to say whether the season's conflict still stands. */
  | 'uncertain';

/** A man with work at the job who is not competing for it now. His usage is history, not competition. */
export interface GoneHolder {
  playerId: number;
  name: string;
  /**
   * `departed` is on another club (or none); `inactive` is still with this club but off its active
   * list — an injured list, usually; `injured` is on the active list and hurt past the operational
   * week; `rehab` is a parent-club player on a rehab assignment (D-026). All four are current state.
   */
  why: 'departed' | 'inactive' | 'injured' | 'rehab';
  /** His share of the season's work at the job, when it can be read. */
  seasonShare: number | null;
  /** His starts at the job inside the window, and how long ago the last one was. */
  windowStarts: number;
  lastStartGamesAgo: number | null;
  /** Where the export has him now. */
  nowAt: string | null;
  /**
   * He HELD the job while he was here — a regular's share of the window's games up to the last one he
   * played for the club in any role — so the competition since he left is a different one and everyone
   * else's recent read begins after his last start there. Anyone less is not material: his starts are
   * set aside, so they neither count for nor against the men who remain. A rehab assignee is never
   * material; he was never competition.
   *
   * Measured to his last APPEARANCE, not his last start at the job. A man who started twice at first
   * base early in the window and stayed with the club another week held a fifth of it, not two-fifths;
   * reading it the second way made him "the man who held first base" and threw away the regular's
   * evidence (a real case: docs/MINOR_LEAGUE_OPERATIONS.md §8.6).
   */
  material: boolean;
}

/** What the game log says about one job over the window. Supplied by the service; absent without a game log. */
export interface JobWindow {
  /** Who started at the job in each window game, oldest first; null where the log names nobody. */
  starters: ReadonlyArray<number | null>;
  /**
   * Men with work at the job this season who are not on the club's active list now. `withClub` is a
   * man the export still has on this club — on an injured list, say — rather than on another.
   */
  departed: ReadonlyArray<{
    playerId: number;
    name: string;
    seasonWork: number;
    nowAt: string | null;
    withClub?: boolean;
    /** The last window game he appeared in for the club, in any role; null or absent when he did not. */
    lastSeen?: number | null;
  }>;
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

  /**
   * Whether this is the present, the past, or not yet readable. A conflict the season shows and the
   * recent read does not is still reported — history is not erased — but quietly, and nobody in it is
   * `squeezed`.
   */
  timing: ConflictTiming;

  /** Men the season's numbers show were short of work. With `squeezed`, this is what `timing` compares. */
  squeezedOverSeason: WorkShare[];

  /** Men with work at the job who are not competing for it now: departed, injured, or on rehab. */
  gone: GoneHolder[];

  /**
   * The games the recent read of this job rests on, when there is one. `since` names the man whose
   * leaving the job restarted the count.
   */
  window: { games: number; counted: number; since: { playerId: number; name: string; why: GoneHolder['why'] } | null } | null;

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

/* ── the recent read, shared by every job ────────────────────────────────────────────────────── */

const evidenceOf = (counted: number, tenure: Tenure): RecentEvidence =>
  counted === 0 ? 'none' : counted < RECENT_MINIMUM_GAMES || tenure.status === 'unknown' ? 'thin' : 'sufficient';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Why a recent read that exists is not being read as a role, in words. */
function thinBecause(name: string, recent: RecentUsage, counted: number, since: GoneHolder | null): string {
  const tenure = describeTenure(recent.tenure);
  if (recent.tenure.status === 'unknown' && tenure) return `${name}: ${tenure}`;
  if (recent.tenure.status === 'recent_arrival' && tenure) {
    return `${name}: ${tenure} ${plural(counted, 'game')} is too few to establish his role.`;
  }
  if (since) {
    return `${name}: the job changed hands ${gamesAgo(since.lastStartGamesAgo ?? 0)}, when ${since.name} last started there, and ${plural(counted, 'game')} since is too few to establish who holds it.`;
  }
  if (recent.gamesMissedInjured > 0) {
    return `${name}: he missed ${plural(recent.gamesMissedInjured, 'game')} of the window to an injury, and ${plural(counted, 'game')} since is too few to establish his role.`;
  }
  return `${name}: only ${plural(counted, 'game')} of the window can be counted for him, too few to establish his role.`;
}

/** Work levels in order, for comparing two reads. A designated hitter's glove is getting an occasional man's work. */
const WORK_RANK: Record<WorkLevel, number> = { unknown: -1, not_used: 0, occasional: 1, bat_only: 1, part_time: 2, regular: 3 };

/**
 * The two reads put him at MATERIALLY different levels of work: two or more apart — a regular who has
 * become an occasional player, a man the season calls unused who is now sharing the job. One step is
 * not a disagreement. A farm club moves men through positions enough that the job-holder starts about
 * four games in ten at one spot, so half of all claimants sit one level apart between a season and a
 * fortnight on noise alone (50.2% of 1,896 on the real import; 8.7% are two apart), and a flag raised
 * for half the organization says nothing.
 */
const readsDisagree = (season: WorkRead, recent: RecentWorkRead | null): boolean =>
  recent !== null &&
  recent.level !== 'unknown' &&
  season.level !== 'unknown' &&
  Math.abs(WORK_RANK[recent.level] - WORK_RANK[season.level]) >= 2;

/**
 * The men a job's window shows who are not competing for it now, from who started there and who is on
 * the club. `heldWhileHere` says whether a man's starts, over the window games up to his last one,
 * amount to holding the job: a position's regular share, or a rotation member's turns.
 */
function goneFrom(
  starters: ReadonlyArray<number | null>,
  everyone: readonly UsageFacts[],
  departed: JobWindow['departed'],
  seasonShareOf: (playerId: number) => number | null,
  heldWhileHere: (starts: number, gamesWhileHere: number) => boolean
): GoneHolder[] {
  const onClub = new Map(everyone.map((c) => [c.playerId, c]));
  const left = new Map(departed.map((d) => [d.playerId, d]));
  const startsOf = new Map<number, number[]>();
  starters.forEach((id, i) => {
    if (id !== null) startsOf.set(id, [...(startsOf.get(id) ?? []), i]);
  });

  const out: GoneHolder[] = [];
  const consider = new Set<number>([...startsOf.keys(), ...left.keys()]);
  for (const id of consider) {
    const member = onClub.get(id);
    if (member && competing(member)) continue;
    const why: GoneHolder['why'] = member ? (member.rehab ? 'rehab' : 'injured') : left.get(id)?.withClub ? 'inactive' : 'departed';
    const games = startsOf.get(id) ?? [];
    const last = games.length > 0 ? games[games.length - 1] : null;
    const lastSeen = Math.max(last ?? -1, member?.recent?.lastAppearance ?? -1, left.get(id)?.lastSeen ?? -1);
    out.push({
      playerId: id,
      name: member?.name ?? left.get(id)?.name ?? `Player ${id}`,
      why,
      seasonShare: seasonShareOf(id),
      windowStarts: games.length,
      lastStartGamesAgo: last === null ? null : starters.length - last,
      nowAt: member || why === 'inactive' ? null : (left.get(id)?.nowAt ?? null),
      material: why !== 'rehab' && last !== null && heldWhileHere(games.length, lastSeen + 1),
    });
  }
  return out.sort((a, b) => b.windowStarts - a.windowStarts || (b.seasonShare ?? 0) - (a.seasonShare ?? 0));
}

/** Present, past, or not yet readable: what the two reads of a conflict say together. */
function timingOf(
  hasRecent: boolean,
  now: readonly WorkShare[],
  overSeason: readonly WorkShare[],
  gone: readonly GoneHolder[]
): ConflictTiming {
  if (!hasRecent) return 'season_only';
  if (now.length > 0) return overSeason.length > 0 ? 'current' : 'emerging';
  if (overSeason.length === 0) return 'current';
  if (overSeason.some((s) => s.level === 'unknown')) return 'uncertain';
  return gone.some((g) => g.material) ? 'recently_resolved' : 'historical';
}

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
 *
 * With a game log (`job`) every man is read twice — the season in innings, the recent window in
 * starts — and his CURRENT level is the recent one. Three rules keep the window honest, one per way a
 * competition changes (docs/MINOR_LEAGUE_OPERATIONS.md §8.4):
 *
 *   he arrived, or came back from an injury   he is measured only over the games he could have played
 *   a man who held the job left it            everyone is measured from the game after his last start
 *                                             there: usage from before describes another competition
 *   a rehab assignee took starts              those games are set aside; he is not competition (D-026)
 *
 * Fewer than `RECENT_MINIMUM_GAMES` left to count is THIN: the facts are shown and the role is
 * `unknown`, so a man four games into a new club is neither "bench depth" nor "the regular".
 */
export function positionConflict(
  teamId: number,
  position: string,
  claimants: readonly UsageFacts[],
  clubInningsAtPosition: number,
  alsoPlaying: readonly UsageFacts[] = [],
  job: JobWindow | null = null
): PlayingTimeConflict | null {
  const built = buildPositionConflict(teamId, position, claimants, clubInningsAtPosition, alsoPlaying, job);
  return built && built.contested ? built.conflict : null;
}

/** The read of a job, and whether anybody is actually competing for it. `ownWork` reads the first without the second. */
interface BuiltConflict {
  conflict: PlayingTimeConflict;
  contested: boolean;
}

function buildPositionConflict(
  teamId: number,
  position: string,
  claimants: readonly UsageFacts[],
  clubInningsAtPosition: number,
  alsoPlaying: readonly UsageFacts[],
  job: JobWindow | null
): BuiltConflict | null {
  const members = claimants.filter(competing);
  if (members.length === 0) return null;
  /*
   * A club that has not played has not shown how it is using anyone. The complex affiliates of the
   * real import carry forty-man rosters by design and had played ten games and none at all; reading
   * congestion there reported twenty-two men competing for a bullpen out of a season that had not
   * happened. The affiliate view says how many games the club has played instead.
   */
  if (members[0].clubGames < MINIMUM_CLUB_GAMES) return null;

  const hasRecent = job !== null && members.some((c) => c.recent != null);
  const everyone = [...claimants, ...alsoPlaying];

  const seasonShareOf = (innings: number): number | null => (clubInningsAtPosition > 0 ? innings / clubInningsAtPosition : null);
  const departedWork = new Map((job?.departed ?? []).map((d) => [d.playerId, d.seasonWork]));
  const gone = hasRecent
    ? goneFrom(
        job!.starters,
        everyone,
        job!.departed,
        (id) => seasonShareOf(everyone.find((c) => c.playerId === id)?.inningsByPosition[position] ?? departedWork.get(id) ?? 0),
        (starts, gamesWhileHere) => starts / gamesWhileHere >= REGULAR_SHARE
      )
    : [];

  /* The job's own window opens after the last start there by a man who held it and no longer competes for it. */
  const material = gone.filter((g) => g.material && g.lastStartGamesAgo !== null);
  const since = material.sort((a, b) => (a.lastStartGamesAgo as number) - (b.lastStartGamesAgo as number))[0] ?? null;
  const windowGames = job?.starters.length ?? 0;
  const opensAt = since ? windowGames - (since.lastStartGamesAgo as number) + 1 : 0;
  /*
   * Games started there by anybody who is not competing for it now — a departed part-timer, a man on
   * the injured list, a rehab assignee — are set aside: they were never available to the men who
   * remain, so they count neither for nor against them.
   */
  const goneIds = new Set(gone.map((g) => g.playerId));
  const setAside = new Set<number>();
  job?.starters.forEach((id, i) => {
    if (id !== null && goneIds.has(id)) setAside.add(i);
  });

  const thin: string[] = [];

  const shareOf = (c: UsageFacts, coverHolder = false): WorkShare => {
    const innings = c.inningsByPosition[position] ?? 0;
    const share = seasonShareOf(innings);
    /* A cover holder's games are at his own job; only a claimant can be batting instead of fielding here. */
    const gameShare = !coverHolder && c.clubGames > 0 ? c.games / c.clubGames : null;
    const level = workLevel(share, c.clubGames, gameShare);
    const season: WorkRead = {
      level,
      share,
      basis:
        clubInningsAtPosition > 0
          ? level === 'bat_only'
            ? `${Math.round(innings)} of the club's ${Math.round(clubInningsAtPosition)} innings at ${position}, but in the lineup for ${c.games} of its ${c.clubGames} games: he is batting, not fielding.`
            : `${Math.round(innings)} of the club's ${Math.round(clubInningsAtPosition)} innings at ${position}.`
          : `The club has played ${c.clubGames} games; innings at ${position} are not yet a share.`,
    };
    const identity = { playerId: c.playerId, name: c.name, age: c.age, tier: c.tier };
    if (!hasRecent || c.recent == null) {
      return { ...identity, ...season, levelFrom: 'season', season, recent: null, tenure: null, disagrees: false };
    }

    const counted = c.recent.observable.filter((i) => i >= opensAt && !setAside.has(i));
    const inCount = new Set(counted);
    const starts = (c.recent.startGames[position] ?? []).filter((i) => inCount.has(i)).length;
    const lineup = c.recent.lineupStartGames.filter((i) => inCount.has(i)).length;
    const evidence = evidenceOf(counted.length, c.recent.tenure);
    const recentShare = counted.length > 0 ? starts / counted.length : null;
    const recentLevel: WorkLevel =
      evidence === 'sufficient'
        ? workLevel(recentShare, c.clubGames, coverHolder ? null : lineup / counted.length)
        : 'unknown';

    const over = since
      ? `the ${plural(counted.length, 'game')} since ${since.name} last started there`
      : c.recent.tenure.status === 'recent_arrival'
        ? `the ${plural(counted.length, 'game')} since he joined the club`
        : counted.length < c.recent.windowGames
          ? `the ${plural(counted.length, 'game')} of the club's last ${c.recent.windowGames} that can be counted for him`
          : `the club's last ${plural(counted.length, 'game')}`;
    const recent: RecentWorkRead = {
      level: recentLevel,
      share: recentShare,
      work: starts,
      games: counted.length,
      windowGames: c.recent.windowGames,
      evidence,
      basis:
        counted.length === 0
          ? `None of the club's last ${plural(c.recent.windowGames, 'game')} can be counted for him.`
          : recentLevel === 'bat_only'
            ? `Started ${starts} of ${over} at ${position}, but was in the lineup for ${lineup} of them: he is batting, not fielding.`
            : `Started ${starts} of ${over} at ${position}.`,
    };
    if (evidence !== 'sufficient' && !coverHolder) thin.push(thinBecause(c.name, c.recent, counted.length, since));

    return {
      ...identity,
      level: recent.level,
      share: recent.share,
      basis: recent.basis,
      levelFrom: 'recent',
      season,
      recent,
      tenure: c.recent.tenure,
      disagrees: readsDisagree(season, recent),
    };
  };

  const byShare = (a: WorkShare, b: WorkShare) => (b.share ?? -1) - (a.share ?? -1);
  const shares: WorkShare[] = members.map((c) => shareOf(c)).sort(byShare);
  const worksHere = (c: UsageFacts): boolean =>
    (c.inningsByPosition[position] ?? 0) > 0 || (c.recent?.startGames[position]?.length ?? 0) > 0;
  const others: WorkShare[] = alsoPlaying
    .filter((c) => competing(c) && worksHere(c) && !members.some((m) => m.playerId === c.playerId))
    .map((c) => shareOf(c, true))
    .sort(byShare);

  const capacity = POSITION_CAPACITY.covered;
  const squeezed = shares.filter((s) => hasDevelopmentalStakes(s.tier) && SQUEEZED_LEVELS.has(s.level));
  const squeezedOverSeason = shares.filter((s) => hasDevelopmentalStakes(s.tier) && SQUEEZED_LEVELS.has(s.season.level));

  const unknowns: string[] = [];
  if (shares.some((s) => s.season.level === 'unknown')) {
    unknowns.push(`Some shares cannot be read yet: the club has played fewer than ${MINIMUM_CLUB_GAMES} games.`);
  }
  if (members.some((c) => c.tier === null)) {
    unknowns.push(
      'Developmental stakes are indeterminate for at least one claimant, so whether the shortage costs development is unknown for him.'
    );
  }
  unknowns.push(...thin);
  /*
   * Usage is the season to date, and a club is not. When a regular has been promoted or released his
   * innings still stand in the denominator and nobody on the roster shows as holding them. With a game
   * log those men are named in `gone` and the recent read starts after them; without one this note is
   * all that can be said, and it is said rather than leaving a vacated job to read as a crowded one.
   */
  if (!hasRecent) {
    const rosteredInnings = everyone.reduce((sum, c) => sum + (c.inningsByPosition[position] ?? 0), 0);
    const departed = clubInningsAtPosition - rosteredInnings;
    if (clubInningsAtPosition > 0 && departed / clubInningsAtPosition >= DEPARTED_SHARE_NOTED) {
      unknowns.push(
        `${Math.round(departed)} of the club's ${Math.round(clubInningsAtPosition)} innings at ${position} were played by men no longer on its roster, so the shares describe the season so far, not the competition as it stands.`
      );
    }
  }

  /*
   * A conflict needs competition. One man not playing is a fact about HIM — his own assignment
   * review says so — and calling it a positional conflict reported the same problem twice and put a
   * one-claimant "conflict" on the affiliate page. A conflict the season showed and the recent read
   * does not is still a conflict worth a quiet line: history is not erased.
   */
  const contested = members.length > capacity || (members.length > 1 && (squeezed.length > 0 || squeezedOverSeason.length > 0));

  const conflict: PlayingTimeConflict = {
    teamId,
    job: { kind: 'position', position },
    capacity,
    claimants: shares,
    alsoPlaying: others,
    squeezed,
    severity: squeezed.length > 0 ? 'blocking' : members.length >= POSITION_CAPACITY.congestedAt ? 'crowded' : 'noted',
    timing: timingOf(hasRecent, squeezed, squeezedOverSeason, gone),
    squeezedOverSeason,
    gone,
    window: hasRecent
      ? {
          games: windowGames,
          counted: windowGames - opensAt,
          since: since ? { playerId: since.playerId, name: since.name, why: since.why } : null,
        }
      : null,
    unknowns,
  };
  return { conflict, contested };
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
 *
 * With a game log a man is read on his own turns over the window: fifteen games is three turns, and
 * two of three is a rotation member (`RECENT_ROTATION_SHARE`). The rotation is also the one job the
 * export states the present of: a man OOTP has among the club's next five starters holds a spot now,
 * and when his usage has not caught up — he arrived four games ago, or he has relieved all year and
 * was moved yesterday — the exported fact is believed over the usage (D-020), and a usage read that
 * CONTRADICTS it is reported as a role change under way rather than as a man blocked from starting.
 */
export function rotationConflict(
  teamId: number,
  rotationClaimants: readonly UsageFacts[],
  clubGames: number,
  job: JobWindow | null = null
): PlayingTimeConflict | null {
  const built = buildRotationConflict(teamId, rotationClaimants, clubGames, job);
  return built && built.contested ? built.conflict : null;
}

function buildRotationConflict(
  teamId: number,
  rotationClaimants: readonly UsageFacts[],
  clubGames: number,
  job: JobWindow | null
): BuiltConflict | null {
  const members = rotationClaimants.filter(competing);
  if (members.length === 0) return null;
  if (clubGames < MINIMUM_CLUB_GAMES) return null;

  const hasRecent = job !== null && members.some((c) => c.recent != null);
  const thin: string[] = [];
  const roleChanges: string[] = [];

  /* A five-man rotation over the club's games is roughly a fifth of the starts each. */
  const clubStarts = clubGames;
  const shares: WorkShare[] = members
    .map((c) => {
      const share = clubStarts > 0 ? c.starts / (clubStarts / STARTER_CAPACITY) : null;
      const capped = share === null ? null : Math.min(1, share * REGULAR_SHARE + (share >= ROTATION_SHARE.regular ? REGULAR_SHARE : 0));
      const season: WorkRead = {
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
      const identity = { playerId: c.playerId, name: c.name, age: c.age, tier: c.tier };
      if (!hasRecent || c.recent == null) {
        return { ...identity, ...season, levelFrom: 'season' as const, season, recent: null, tenure: null, disagrees: false };
      }

      const counted = c.recent.observable.length;
      const starts = c.recent.pitchingStartGames.length;
      const evidence = evidenceOf(counted, c.recent.tenure);
      const turns = counted > 0 ? starts / (counted / STARTER_CAPACITY) : null;
      const usageLevel: WorkLevel =
        evidence !== 'sufficient'
          ? 'unknown'
          : starts === 0
            ? 'not_used'
            : (turns as number) >= RECENT_ROTATION_SHARE.regular
              ? 'regular'
              : (turns as number) >= RECENT_ROTATION_SHARE.partTime
                ? 'part_time'
                : 'occasional';
      const over =
        c.recent.tenure.status === 'recent_arrival'
          ? `the ${plural(counted, 'game')} since he joined the club`
          : counted < c.recent.windowGames
            ? `the ${plural(counted, 'game')} of the club's last ${c.recent.windowGames} that can be counted for him`
            : `the club's last ${plural(counted, 'game')}`;
      const recent: RecentWorkRead = {
        level: usageLevel,
        share: turns === null ? null : Math.min(1, turns),
        work: starts,
        games: counted,
        windowGames: c.recent.windowGames,
        evidence,
        basis: counted === 0 ? `None of the club's last ${plural(c.recent.windowGames, 'game')} can be counted for him.` : `Started ${starts} of ${over}.`,
      };

      /* Current state: OOTP has him among the next five. It outranks a usage read that has not caught up. */
      if (c.projectedStarter === true && usageLevel !== 'regular') {
        if (evidence === 'sufficient') {
          roleChanges.push(
            `${c.name}: OOTP has him among the club's next five starters, but he started ${starts} of ${over}. A change of role appears to be under way, and his rotation work cannot be read from usage yet.`
          );
          return { ...identity, level: 'unknown' as WorkLevel, share: recent.share, basis: `${recent.basis} OOTP has him among the club's next five starters.`, levelFrom: 'current_state' as const, season, recent, tenure: c.recent.tenure, disagrees: readsDisagree(season, recent) };
        }
        return {
          ...identity,
          level: 'regular' as WorkLevel,
          share: recent.share,
          basis: `OOTP has him among the club's next five starters. ${recent.basis}`,
          levelFrom: 'current_state' as const,
          season,
          recent,
          tenure: c.recent.tenure,
          disagrees: false,
        };
      }

      if (evidence !== 'sufficient') thin.push(thinBecause(c.name, c.recent, counted, null));
      return { ...identity, level: recent.level, share: recent.share, basis: recent.basis, levelFrom: 'recent' as const, season, recent, tenure: c.recent.tenure, disagrees: readsDisagree(season, recent) };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

  const short = (level: WorkLevel): boolean => level === 'not_used' || level === 'occasional';
  const squeezed = shares.filter((s) => hasDevelopmentalStakes(s.tier) && short(s.level));
  const squeezedOverSeason = shares.filter((s) => hasDevelopmentalStakes(s.tier) && short(s.season.level));

  const contested = members.length > STARTER_CAPACITY || (members.length > 1 && (squeezed.length > 0 || squeezedOverSeason.length > 0));

  const gone = hasRecent
    ? goneFrom(
        job!.starters,
        rotationClaimants,
        job!.departed,
        (id) => {
          const work = rotationClaimants.find((c) => c.playerId === id)?.starts ?? job!.departed.find((d) => d.playerId === id)?.seasonWork ?? 0;
          return clubStarts > 0 ? Math.min(1, work / (clubStarts / STARTER_CAPACITY)) : null;
        },
        (starts, gamesWhileHere) => starts / (gamesWhileHere / STARTER_CAPACITY) >= RECENT_ROTATION_SHARE.regular
      )
    : [];

  const unknowns: string[] = [];
  if (shares.some((s) => s.season.level === 'unknown')) unknowns.push(`The club has played fewer than ${MINIMUM_CLUB_GAMES} games, so a starter's share cannot be read.`);
  if (members.some((c) => c.tier === null)) {
    unknowns.push('Developmental stakes are indeterminate for at least one starter.');
  }
  unknowns.push(...thin, ...roleChanges);

  const conflict: PlayingTimeConflict = {
    teamId,
    job: { kind: 'rotation' },
    capacity: STARTER_CAPACITY,
    claimants: shares,
    alsoPlaying: [],
    squeezed,
    severity: squeezed.length > 0 ? 'blocking' : members.length > STARTER_CAPACITY ? 'crowded' : 'noted',
    timing: timingOf(hasRecent, squeezed, squeezedOverSeason, gone),
    squeezedOverSeason,
    gone,
    window: hasRecent ? { games: job!.starters.length, counted: job!.starters.length, since: null } : null,
    unknowns,
  };
  return { conflict, contested };
}

/** Relief arms competing for innings. Crowding here costs innings, not a role. */
export function reliefConflict(
  teamId: number,
  relievers: readonly UsageFacts[],
  clubGames: number
): PlayingTimeConflict | null {
  const built = buildReliefConflict(teamId, relievers, clubGames);
  return built && built.contested ? built.conflict : null;
}

function buildReliefConflict(teamId: number, relievers: readonly UsageFacts[], clubGames: number): BuiltConflict | null {
  const members = relievers.filter(competing);
  if (members.length === 0) return null;
  if (clubGames < MINIMUM_CLUB_GAMES) return null;

  const hasRecent = members.some((c) => c.recent != null);
  const thin: string[] = [];

  const totalInnings = members.reduce((sum, c) => sum + c.inningsPitched, 0);
  /*
   * The recent even share is a RATE — relief outs per game a man could have pitched in — so an arm
   * that joined the club five games ago is measured against five games of the corps' work, not
   * fifteen. Season innings among the men on the club never included a departed arm's; the window
   * does not either.
   */
  const reliefOuts = (c: UsageFacts): number => (c.recent?.reliefGames ?? []).reduce((sum, g) => sum + g.outs, 0);
  const recentOuts = members.reduce((sum, c) => sum + reliefOuts(c), 0);
  const recentGames = members.reduce((sum, c) => sum + (c.recent?.observable.length ?? 0), 0);
  const evenRate = recentGames > 0 ? recentOuts / recentGames : 0;

  const shares: WorkShare[] = members
    .map((c) => {
      const share = totalInnings > 0 ? c.inningsPitched / totalInnings : null;
      const even = 1 / members.length;
      const season: WorkRead = {
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
      const identity = { playerId: c.playerId, name: c.name, age: c.age, tier: c.tier };
      if (!hasRecent || c.recent == null) {
        return { ...identity, ...season, levelFrom: 'season' as const, season, recent: null, tenure: null, disagrees: false };
      }

      const counted = c.recent.observable.length;
      const outs = reliefOuts(c);
      const evidence = evidenceOf(counted, c.recent.tenure);
      const rate = counted > 0 ? outs / counted : 0;
      const level: WorkLevel =
        evidence !== 'sufficient'
          ? 'unknown'
          : outs <= 0
            ? 'not_used'
            : rate >= evenRate
              ? 'regular'
              : rate >= evenRate * RELIEF_EVEN_SHARE_PART_TIME
                ? 'part_time'
                : 'occasional';
      const over =
        c.recent.tenure.status === 'recent_arrival'
          ? `the ${plural(counted, 'game')} since he joined the club`
          : counted < c.recent.windowGames
            ? `the ${plural(counted, 'game')} of the club's last ${c.recent.windowGames} that can be counted for him`
            : `the club's last ${plural(counted, 'game')}`;
      const recent: RecentWorkRead = {
        level,
        share: recentOuts > 0 ? outs / recentOuts : null,
        work: c.recent.reliefGames.length,
        games: counted,
        windowGames: c.recent.windowGames,
        evidence,
        basis:
          counted === 0
            ? `None of the club's last ${plural(c.recent.windowGames, 'game')} can be counted for him.`
            : `${plural(c.recent.reliefGames.length, 'relief appearance')} and ${(outs / 3).toFixed(1)} innings over ${over}; an even share of the corps' work over those games is ${((evenRate * counted) / 3).toFixed(1)}.`,
      };
      if (evidence !== 'sufficient') {
        thin.push(thinBecause(c.name, c.recent, counted, null));
        return { ...identity, level: recent.level, share: recent.share, basis: recent.basis, levelFrom: 'recent' as const, season, recent, tenure: c.recent.tenure, disagrees: false };
      }
      /*
       * In relief the window may CONFIRM or CLEAR what the season says; it may not raise a shortage by
       * itself. Relief work is lumpy: on the real import a man's share of his corps' innings correlated
       * 0.31 from one fifteen-game window to the next against 0.57 for a position's starts, and a
       * fifth of the arms that were NOT short in one window read as short in the next. So his current
       * level is the better of the two reads — short of work only when both say so — and both are shown.
       */
      const better = WORK_RANK[recent.level] >= WORK_RANK[season.level] ? recent : season;
      return {
        ...identity,
        level: better.level,
        share: better.share,
        basis: better.basis,
        levelFrom: better === recent ? ('recent' as const) : ('season' as const),
        season,
        recent,
        tenure: c.recent.tenure,
        disagrees: readsDisagree(season, recent),
      };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

  const short = (level: WorkLevel): boolean => level === 'occasional' || level === 'not_used';
  const squeezed = shares.filter((s) => hasDevelopmentalStakes(s.tier) && short(s.level));
  const squeezedOverSeason = shares.filter((s) => hasDevelopmentalStakes(s.tier) && short(s.season.level));

  const unknowns: string[] = [];
  if (shares.some((s) => s.season.level === 'unknown')) unknowns.push(`The club has played fewer than ${MINIMUM_CLUB_GAMES} games, so an innings share cannot be read.`);
  unknowns.push(...thin);

  const windowGames = members.find((c) => c.recent != null)?.recent?.windowGames ?? 0;
  const conflict: PlayingTimeConflict = {
    teamId,
    job: { kind: 'relief' },
    capacity: RELIEF_CAPACITY,
    claimants: shares,
    alsoPlaying: [],
    squeezed,
    severity: squeezed.length > 0 ? 'blocking' : 'crowded',
    timing: timingOf(hasRecent, squeezed, squeezedOverSeason, []),
    squeezedOverSeason,
    gone: [],
    window: hasRecent ? { games: windowGames, counted: windowGames, since: null } : null,
    unknowns,
  };
  return { conflict, contested: members.length > RELIEF_CAPACITY };
}

/* ── one man's own work, contested or not ────────────────────────────────────────────────────── */

/** Everything a job's read needs: the men with a claim on it, and what the club's season and game log say about it. */
export interface JobContext {
  claimants: readonly UsageFacts[];
  /** Position jobs: the club's season innings there, and the men with innings there from another job. */
  clubInningsAtPosition?: number;
  alsoPlaying?: readonly UsageFacts[];
  clubGames: number;
  window?: JobWindow | null;
}

/**
 * What one man has been getting at his job — the season, the recent window and how long he has been
 * on the club — whether or not anybody is competing with him for it.
 *
 * A conflict needs competition, so most players are in none; but "he joined four games ago and has
 * started three of them" is the answer to "is he getting the work?" for a newly promoted prospect, and
 * it should not depend on somebody else wanting his position. null when the club has not played enough
 * for a share to be read, or he is not competing for anything (rehab, injured).
 */
export function ownWork(playerId: number, job: FarmJob, context: JobContext): WorkShare | null {
  return jobRead(job, context)?.claimants.find((s) => s.playerId === playerId) ?? null;
}

/**
 * The read of one job whether or not anybody is competing for it: who has a claim, what each is
 * getting, who is covering it from elsewhere and who has left. `positionConflict` and its siblings
 * return this only when the job is contested; a man's own opportunity is a question about him either
 * way.
 */
export function jobRead(job: FarmJob, context: JobContext, teamId = 0): PlayingTimeConflict | null {
  const built =
    job.kind === 'position'
      ? buildPositionConflict(teamId, job.position, context.claimants, context.clubInningsAtPosition ?? 0, context.alsoPlaying ?? [], context.window ?? null)
      : job.kind === 'rotation'
        ? buildRotationConflict(teamId, context.claimants, context.clubGames, context.window ?? null)
        : buildReliefConflict(teamId, context.claimants, context.clubGames);
  return built?.conflict ?? null;
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
  /** How long he has been on the club, when the game log says: a man who arrived last week is ahead on four games. */
  tenure: Tenure | null;
}

export interface OpportunityRead {
  verdict: OpportunityVerdict;
  /** The job his usage says he is competing for; null when nothing does. */
  job: FarmJob | null;
  /** Who is ahead of him at it, claimants and cover holders alike, most work first. */
  ahead: AheadOfHim[];
  /**
   * His own work at the job: the season, the recent window and his tenure, side by side. From the
   * conflict he is in, or — for a man nobody is competing with — supplied by the service (`ownWork`).
   * null when the club has not played enough to read anything.
   */
  work: WorkShare | null;
  /** Whether the conflict behind the verdict is the present, the past, or not yet readable. null when he is in none. */
  timing: ConflictTiming | null;
  /** Men who held work at his job and are not competing for it now. History, never competition. */
  gone: GoneHolder[];
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
    return { verdict: 'regular_work', job: null, ahead: [], work: null, timing: null, gone: [], reasons: ['No job on this club is contested for him.'], unknowns: [] };
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
    .map((s) => ({ playerId: s.playerId, name: s.name, age: s.age, share: s.share, level: s.level, claimant: s.claimant, tenure: s.tenure }));

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
  /*
   * When the two reads disagree both are said: the season is what happened, the recent window is what
   * is happening, and a reader shown only one of them cannot tell a lost job from a won one.
   */
  if (me.disagrees && me.recent) {
    reasons.push(`Over the season: ${me.season.basis} The recent read is the current one; the season is shown because it disagrees.`);
  }
  /* The men who matter are the ones holding a real share of it; an occasional cover is in the data, not the sentence. */
  const named = ahead.filter((a) => a.level === 'regular' || a.level === 'part_time');
  const mention = named.length > 0 ? named : ahead;
  if (mention.length > 0) {
    const describe = (a: AheadOfHim) => {
      const who = a.claimant ? a.name : `${a.name} (covering it from another position)`;
      /* A man ahead on four games at a new club is ahead, and is not yet anybody's blocker. */
      return a.level === 'unknown' && a.tenure?.status === 'recent_arrival' ? `${who} (who joined the club ${gamesAgo(a.tenure.clubGamesSince ?? 0)})` : who;
    };
    const names = mention.map(describe);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    reasons.push(`${list} ${names.length === 1 ? 'is' : 'are'} ahead of him at ${jobLabel(conflict.job)}.`);
  }
  if (conflict.claimants.length > conflict.capacity) {
    reasons.push(
      `${conflict.claimants.length} men have a claim on ${jobLabel(conflict.job)}, which supports ${conflict.capacity}.`
    );
  }

  return { verdict, job: conflict.job, ahead, work: me, timing: conflict.timing, gone: conflict.gone, reasons, unknowns: conflict.unknowns };
}

/**
 * Who, of the men ahead of him, is actually HOLDING the job: a regular there. A part-time man ahead
 * of a prospect is not occupying his path — the reps are split, or were taken by somebody since gone —
 * and naming him as the blocker made a twenty-three-year-old with a fifth of centre field the man
 * "occupying the developmental path" of the prospect behind him. With nobody regular the prospect's
 * problem is real and is an opportunity conflict, not a blockage by a named man.
 */
export function blockersOf(read: OpportunityRead): AheadOfHim[] {
  /*
   * A man whose own work cannot be read has no blocker: four games into a new club, the regular there
   * is ahead of him and is not standing in his way. The service only asks this of a man it has read as
   * not playing, but the answer should not depend on the caller remembering to.
   */
  if (read.verdict === 'indeterminate') return [];
  return read.ahead.filter((a) => a.level === 'regular');
}

/** Whether a player appeared often enough for his rate statistics to describe regular work. */
export function playedRegularly(usage: UsageFacts): boolean {
  return usage.clubGames > 0 && usage.games / usage.clubGames >= REGULAR_PLAY_SHARE;
}
