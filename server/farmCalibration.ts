/**
 * Every number that steers a Minor League Operations conclusion, declared once.
 *
 * The audit (docs/MINOR_LEAGUE_OPERATIONS.md §1.3) found the same roster thresholds written by
 * hand in three modules, retention thresholds scattered through a decision cascade, and no way
 * to tell a product decision from an estimate. The three kinds of stamp are D-041's:
 *
 *   calibrated    estimated from historical evidence; right or wrong, and the harness says how right.
 *   provisional   a model parameter that ought to be estimated and has not been.
 *   policy        a product decision about WHEN to raise something. Chosen, stated, shown; never fitted.
 *
 * The mechanisms are architecture and carry no stamp: operational health and developmental health
 * are separate; a level is not a peer group; unknown stays unknown; philosophy applies only after
 * defensibility. Tests pin those.
 *
 * `tests/farmCalibration.test.ts` fails if a farm module declares one of these itself.
 */

import { policy, provisional, type CalibrationStamp } from './calibration.js';
import { REGULAR_SHARE } from './lineupPicture.js';

/* ── affiliate operational structure ─────────────────────────────────────────────────────────── */

export const AFFILIATE_STRUCTURE_CALIBRATION: CalibrationStamp = policy(
  'What a functioning affiliate needs to field a team and cover a schedule. Minor-league active ' +
    'rosters are not league-limited the way a major-league roster is, so these are Pennant\'s ' +
    'statement of when a club is short, not an OOTP rule. Chosen from the eight fielding positions ' +
    'plus rest, and a five-man rotation with relief coverage.'
);

/**
 * Body counts. `thinBelow` is where rest and injury margin starts to go; two under that is
 * critical; `surplusAt` is where the club is carrying more bodies than it has work for.
 */
export const BODY_COUNT = {
  hitters: { thinBelow: 12, surplusAt: 17 },
  pitchers: { thinBelow: 12, surplusAt: 18 },
} as const;

/** Rotation spots a minor-league club fills. OOTP runs five-man rotations at every full-season level. */
export const ROTATION_SPOTS = 5;

/** Relief arms a club needs to cover a schedule, and the point past which arms outnumber the innings. */
export const RELIEF_CORPS = { thinBelow: 7, criticalBelow: 5, crowdedAt: 9 } as const;

/** Positions whose loss cannot be covered by moving someone else: a shortage here is structural. */
export const CRITICAL_POSITIONS = ['C', 'SS', 'CF'] as const;

/**
 * Days of injury remaining past which a player on the active list is not counted as cover or as a
 * man taking starts. A two-day injury is a lineup problem; past a week he cannot cover the schedule
 * the operational reading is about. On the real import 111 of 6,411 rostered minor leaguers were
 * injured, most for a day or two.
 */
export const INJURED_DAYS_NOT_COUNTED = 7;

/* ── visible fielding grades ─────────────────────────────────────────────────────────────────── */

export const GLOVE_GRADE_CALIBRATION: CalibrationStamp = policy(
  'Where a visible fielding grade stops being usable at a position. Inherited from the farm v1 ' +
    'thresholds (35 playable, 50 strong) on the 20-80 scale, kept so affiliate coverage does not ' +
    'move for reasons unrelated to this phase. Unlike MLB Operations these are absolute grades, ' +
    'not percentiles among the position\'s peers: a minor-league position group is too small to ' +
    'rank against.'
);

/** A revealed grade at or above which a position counts as covered. Shared with MLB Operations. */
export const PLAYABLE_GRADE = 35;

/** A revealed grade at or above which the cover is a real one rather than a body. */
export const STRONG_GRADE = 50;

/* ── playing time ────────────────────────────────────────────────────────────────────────────── */

export const PLAYING_TIME_CALIBRATION: CalibrationStamp = policy(
  'What counts as enough work for development, and how many men a job supports. A developing ' +
    'player needs regular reps, not appearances; these say where "regular" stops. Derived from the ' +
    'shape of a baseball roster (nine lineup spots, five rotation spots) rather than fitted: a ' +
    'backtest cannot say when a GM should be told his prospect is not playing.'
);

/**
 * How many men a position supports before one of them is not getting developmental reps.
 * Two is healthy cover; the third man at a position is a part-time player somewhere.
 */
export const POSITION_CAPACITY = { covered: 2, congestedAt: 4 } as const;

/**
 * Share of his club's innings at a position that makes a player its regular there.
 *
 * The same concept and the same number as the major-league lineup's, so it is the same declaration:
 * `lineupPicture.ts` owns it (D-041's rule that a constant is declared once), and the farm reads it
 * rather than writing a second copy that could drift.
 */
export { REGULAR_SHARE } from './lineupPicture.js';

/**
 * Share of his club's games a player must appear in for his sample to be read as regular work.
 * Below it he is a part-time player whatever his rate statistics say.
 */
export const REGULAR_PLAY_SHARE = 0.55;

/**
 * Share of a job below which a claimant is an occasional player at it rather than sharing it. With
 * `REGULAR_SHARE` this splits the job into regular / sharing / occasional.
 */
export const PART_TIME_SHARE = 0.15;

/**
 * A starter's share of a five-man rotation's starts: at or above `regular` he is in the rotation, at
 * or above `partTime` he is spot-starting, below it he is not being used as a starter.
 */
export const ROTATION_SHARE = { regular: 0.7, partTime: 0.35 } as const;

/** A reliever's innings against an even share of the corps: below this fraction of even he is sharing, not regular. */
export const RELIEF_EVEN_SHARE_PART_TIME = 0.5;

/**
 * Share of a job's innings played by men no longer on the club above which the shares are said to
 * lag the roster. Usage is the season to date; a promoted regular's innings still stand in the
 * denominator, and past this much the competition as it stands is not what the shares show.
 */
export const DEPARTED_SHARE_NOTED = 0.25;

/* ── recent usage: what has been happening lately ────────────────────────────────────────────── */

export const RECENT_USAGE_CALIBRATION: CalibrationStamp = provisional(
  'How far back "recently" reaches and how much of it must be observable before it is read. Chosen ' +
    'from a backtest on the export\'s own game log (`npm run farm:usage-window`): after each club game ' +
    'from the twentieth on, does a trailing window predict who starts the NEXT five? Measured on the ' +
    '120 full-season minor-league clubs of one import, roster-aware. Fifteen club games is three ' +
    'turns of a five-man rotation; "two starts in the last fifteen" identifies a rotation member with ' +
    '86.8% precision against 79.4% for the season equivalent, and a 40% share of a position\'s starts ' +
    'holds the season\'s 70% precision while recalling 38% of the men about to play there against 31%. ' +
    'Ten games is noisier at a position (65.7%). The result is flat between twelve and fifteen. ' +
    'Provisional, not calibrated: one partial season of one save, and no harness re-fits it.'
);

/**
 * Club games the recent read looks back over. Games, not days: a club's off days and a complex
 * league's short schedule make a calendar window mean different things at different affiliates, and a
 * rotation turns over in games.
 */
export const RECENT_WINDOW_GAMES = 15;

/**
 * Club games a man must have been observable for — on the club and not in a recorded injury spell —
 * before his recent share is read as his role. Below it the read is THIN and his current role is not
 * established. Measured on 626 real arrivals: below six games the 40% rule's precision swings between
 * 56% and 77% on integer effects (one start in two games is "half the job"); from six on it holds at
 * 74–76%, the full window's level.
 */
export const RECENT_MINIMUM_GAMES = 6;

/**
 * A starter's share of his turns over the recent window: at or above `regular` he is in the rotation,
 * at or above `partTime` he is spot-starting.
 *
 * Deliberately not `ROTATION_SHARE`. Three turns fit in fifteen games, so the only shares a man can
 * have are 0, 1/3, 2/3 and 1: the season's 0.7 line would demand every turn (precision 91.8%, recall
 * 63.1% — a third of the men actually in a rotation read as out of it) and its 0.35 line would call
 * one start in three turns "not used". Two of three turns is the better line (86.8% / 78.4%).
 */
export const RECENT_ROTATION_SHARE = { regular: 0.6, partTime: 0.3 } as const;

/** A starter needs a rotation spot. Beyond this many starters per club, somebody is not starting. */
export const STARTER_CAPACITY = ROTATION_SPOTS;

/** Relief arms past which the pen cannot give each man meaningful innings. */
export const RELIEF_CAPACITY = RELIEF_CORPS.crowdedAt;

/**
 * Games a club must have played before its work is read at all — a share of a job, or the shape of
 * who is on which developmental path.
 *
 * At ten games a regular has started eight or nine and a part-time player two, which is not yet a
 * pattern. On the real import the complex affiliates had played ten games and none at all, and
 * reading them manufactured conflicts out of a season that had not happened.
 */
export const MINIMUM_CLUB_GAMES = 20;

/* ── production evidence ─────────────────────────────────────────────────────────────────────── */

export const FARM_RESULTS_CALIBRATION: CalibrationStamp = provisional(
  'Sample thresholds for reading a minor leaguer\'s line. The MLB results model is calibrated ' +
    'against 23 seasons of real major-league history (docs/CALIBRATION.md); no equivalent ' +
    'minor-league history exists in the export, so the stabilization constants here are the ' +
    'major-league ones and the qualifying minimums are first-pass. They are expected to move.'
);

/**
 * Plate appearances / innings at the current level below which a line is not read as evidence of
 * anything. A player below it is reported as NOT ASSESSABLE with the reason, never omitted.
 */
export const MINIMUM_SAMPLE = { pa: 40, ip: 12 } as const;

/** Sample at which the current-level line is treated as mature. */
export const MATURE_SAMPLE = { pa: 250, ip: 60 } as const;

/**
 * Players a MINOR-LEAGUE league population needs before a percentile taken in it means anything.
 *
 * Deliberately not `resultsMetrics.POPULATION_MINIMUM`, which is the 150 a major-league peer group
 * needs: a minor league is a smaller population read for a coarser purpose, and the two numbers
 * answer different questions.
 */
export const LEAGUE_POPULATION_MINIMUM = 25;

/* ── age relative to level ───────────────────────────────────────────────────────────────────── */

export const AGE_LEVEL_CALIBRATION: CalibrationStamp = policy(
  'Age relative to the level he is playing at. The farm v1 model read "older than the level" as ' +
    'developmental urgency and LOWERED the promotion bar for it, which made a 29-year-old crushing ' +
    'Double-A a promotion case. Age does not change what a player has shown; it changes how much ' +
    'developmental time is left and therefore what the assignment is FOR. These say where a player ' +
    'stops being young for a level and where he stops being a development case there at all.'
);

/** Years younger than his level\'s rostered average at which a player is notably young for it. */
export const YOUNG_FOR_LEVEL = 1.5;

/** Years older than his level\'s rostered average at which a player is notably old for it. */
export const OLD_FOR_LEVEL = 1.5;

/**
 * Years older than his level average past which the assignment stops being a development question.
 * He may still be the right player for the club; the reason is organizational, not developmental.
 */
export const AGE_LEVEL_DEVELOPMENT_LIMIT = 3.0;

/* ── organizational depth and congestion ─────────────────────────────────────────────────────── */

export const ORG_DEPTH_CALIBRATION: CalibrationStamp = policy(
  'When the organization as a whole is thin or piled up at something. A count, not a quality ' +
    'judgment: quality is Player Development\'s and is shown beside it.'
);

/** Players with a defensible claim on a position across the upper minors below which the org is thin there. */
export const UPPER_MINORS_DEPTH_FLOOR = 2;

/** Levels counted as the upper minors for depth behind a major-league position. */
export const UPPER_MINORS_LEVELS = [2, 3] as const;

/**
 * Development-priority-or-better players at one position and one level past which the
 * organization is competing with itself.
 */
export const PRIORITY_CONGESTION_AT = 2;

/* ── cascades ────────────────────────────────────────────────────────────────────────────────── */

export const CASCADE_CALIBRATION: CalibrationStamp = policy(
  'How far a chain of moves is followed. A cascade exists to show the GM the consequence of one ' +
    'move, not to redistribute an organization: past a few steps the chain is speculation about ' +
    'decisions nobody has made.'
);

/** Steps followed before the chain is reported as continuing rather than resolved. */
export const CASCADE_MAX_STEPS = 4;

/* ── retention ───────────────────────────────────────────────────────────────────────────────── */

export const RETENTION_CALIBRATION: CalibrationStamp = policy(
  'When a minor leaguer no longer has an organizational case. Every one of these is a product ' +
    'decision about how loudly to raise a question the GM decides; none can be backtested, because ' +
    'the outcome of a release Pennant did not make is not in the save. The farm v1 model folded ' +
    'philosophy into a development score and then compared it with numbers like these, which made ' +
    'the same player expendable at one club and retained at another (D-044).'
);

/** Age at which an ordinary developmental runway at a full-season level is treated as closing. */
export const RUNWAY_CLOSING_AGE = { upperMinors: 26, lowerMinors: 24, complex: 23 } as const;

/** Seasons of professional service past which a player at a low level has had his developmental look. */
export const RUNWAY_SERVICE_LIMIT = 5;

/** Protection tiers that are never routine release or roster-filler material. */
export const PROTECTED_TIERS = ['core_prospect', 'protected_prospect'] as const;
