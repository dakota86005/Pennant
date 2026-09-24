import { db, tableExists } from './db.js';
import { playoffPicture, type PlayoffPicture } from './playoffs.js';
import { currentGameDate } from './valuation.js';

/**
 * Buy, hold or sell — and the arithmetic behind it.
 *
 * The question a deadline actually poses is not "are we good" but "can we
 * still get there from here", and those come apart badly. A club five games
 * out in May and a club five games out in September are the same line in the
 * standings and opposite answers.
 *
 * So the verdict is driven by one number: the chance of reaching the
 * postseason, worked out rather than felt. Talent comes from run differential
 * instead of won-lost record, because a club's runs predict its future better
 * than its results do — a 45-46 team outscoring its opponents by fifty is a
 * good team having bad luck, and it should be buying.
 *
 * Deliberately willing to say hold. Most clubs most of the time genuinely are
 * on the fence, and a tool that manufactures a decision to seem useful is
 * worse than one that admits the season has not decided yet.
 */

export type Posture = 'buy' | 'lean-buy' | 'hold' | 'lean-sell' | 'sell';

export interface DeadlineRead {
  posture: Posture;
  /** Chance of reaching the postseason, 0-1. */
  odds: number;
  headline: string;
  /** The two or three facts doing the work, for the page to list. */
  reasons: string[];
  gamesPlayed: number;
  gamesLeft: number;
  runDiff: number;
  /** Wins the run differential says they should have, against what they do. */
  pythagoreanWins: number;
  actualWins: number;
  /** Null when the save has no deadline, or it has already passed. */
  daysToDeadline: number | null;
  deadlinePassed: boolean;
}

/** Pythagorean expectation at the exponent that fits modern scoring. */
const pythag = (rs: number, ra: number): number => {
  if (rs <= 0 && ra <= 0) return 0.5;
  const rs18 = Math.pow(rs, 1.83);
  return rs18 / (rs18 + Math.pow(ra, 1.83));
};

/** The normal CDF, for turning a games-back gap into a probability. */
function normalCdf(z: number): number {
  // Abramowitz & Stegun 26.2.17 — plenty for a number shown to the nearest %
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (1.330274429 * t ** 4 - 1.821255978 * t ** 3 + 1.781477937 * t ** 2 - 0.356563782 * t + 0.319381530);
  return z > 0 ? 1 - p : p;
}

function runsFor(teamId: number): { rs: number; ra: number } {
  const rs = tableExists('team_batting_stats')
    ? Number((db.prepare(`SELECT SUM(r) AS r FROM team_batting_stats WHERE team_id = ?`).get(teamId) as { r: number | null })?.r ?? 0)
    : 0;
  // `r` is runs allowed here; `ra` is a different measure entirely
  const ra = tableExists('team_pitching_stats')
    ? Number((db.prepare(`SELECT SUM(r) AS r FROM team_pitching_stats WHERE team_id = ?`).get(teamId) as { r: number | null })?.r ?? 0)
    : 0;
  return { rs, ra };
}

/** Parses OOTP's loose date strings — '2026-8-3' as readily as '2026-08-03'. */
function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * The rival for the place: whoever holds it is read as a .520 club — near enough for every league, and it avoids
 * reading one rival's hot streak as permanent talent. PROVISIONAL (not fitted on the save).
 */
export const RIVAL_TALENT = 0.52;

/**
 * The odds model's inputs for one club, as the deadline read uses them: its record, its runs (the talent they imply),
 * the games left on its schedule, and the gap in games to a playoff place (negative: a cushion). Player Value reads the
 * club's value of a win on the same model (PLAYER_VALUE.md Part 4.5).
 */
export interface OddsModel {
  teamId: number;
  leagueId: number;
  w: number;
  l: number;
  gamesPlayed: number;
  gamesLeft: number;
  rs: number;
  ra: number;
  /** Pythagorean winning percentage from this season's runs. */
  talent: number;
  rival: number;
  picture: PlayoffPicture | null;
  /** Games to close (negative: a cushion to defend). */
  gap: number;
  /**
   * How the gap was read: from the race; or, where the race is not read, the deadline read's own default: level
   * (`no_race`: the club is not in its conference's standings) or a one-game cushion (`no_rival`: nobody is outside its place).
   */
  gapRead: 'race' | 'no_race' | 'no_rival';
}

/** The club's odds model, or why it cannot be read. */
export function oddsModelOf(teamId: number): { model: OddsModel; reason: null } | { model: null; reason: string } {
  if (!tableExists('teams') || !tableExists('team_record')) return { model: null, reason: 'The standings are not in the export.' };

  const team = db
    .prepare(`SELECT league_id FROM teams WHERE team_id = ?`)
    .get(teamId) as { league_id: number } | undefined;
  if (!team) return { model: null, reason: "The club is not in the export's standings." };
  const record = db
    .prepare(`SELECT w, l FROM team_record WHERE team_id = ?`)
    .get(teamId) as { w: number; l: number } | undefined;
  if (!record) return { model: null, reason: "The club has no row in the export's standings." };

  const played = record.w + record.l;
  if (played === 0) {
    return { model: null, reason: "No game has been played yet this season: the odds model reads the club's strength from this season's runs." };
  }

  const scheduled = tableExists('games')
    ? Number((db
        .prepare(`SELECT COUNT(*) AS n FROM games WHERE home_team = ? OR away_team = ?`)
        .get(teamId, teamId) as { n: number }).n)
    : 162;
  const gamesLeft = Math.max(0, scheduled - played);

  const { rs, ra } = runsFor(teamId);
  const talent = pythag(rs, ra);
  const picture = playoffPicture(teamId);

  /*
   * The gap to close, in games. A club already in a place is defending one, so
   * its gap is negative and the arithmetic runs the same way — the chance of
   * still being ahead at the end rather than of catching up.
   */
  const gap = picture
    ? picture.route === 'out'
      ? (picture.wildcardGb ?? picture.divisionGb)
      // In a place: the gap is the cushion, negative, so the same arithmetic
      // asks how likely they are to still be there rather than to catch up
      : -(picture.cushion ?? 1)
    : 0;
  const gapRead: OddsModel['gapRead'] = !picture ? 'no_race' : picture.route !== 'out' && picture.cushion === null ? 'no_rival' : 'race';

  return {
    model: {
      teamId, leagueId: team.league_id, w: record.w, l: record.l, gamesPlayed: played, gamesLeft, rs, ra, talent,
      rival: RIVAL_TALENT, picture, gap, gapRead,
    },
    reason: null,
  };
}

/**
 * The chance of reaching the postseason on the model, with `extraWins` more wins over the rest of the season (a loss
 * turned into a win closes the gap by a game; negative for fewer). Unbounded: the deadline read shows it within 1%–99%.
 *
 * Over the games that remain, the difference between two clubs' win totals is roughly normal.
 */
export function oddsAt(m: OddsModel, extraWins = 0): number {
  const gap = m.gap - extraWins;
  if (m.gamesLeft === 0) return gap <= 0 ? 1 : 0;
  const expectedGain = m.gamesLeft * (m.talent - m.rival);
  const sigma = Math.sqrt(Math.max(1, m.gamesLeft) * (m.talent * (1 - m.talent) + m.rival * (1 - m.rival)));
  return normalCdf((expectedGain - gap) / sigma);
}

/** The chance as the deadline read shows it: never quite certain either way while games are left. */
export function shownOdds(m: OddsModel): number {
  return m.gamesLeft === 0 ? oddsAt(m) : Math.min(0.99, Math.max(0.01, oddsAt(m)));
}

export function deadlineRead(teamId: number): DeadlineRead | null {
  const read = oddsModelOf(teamId);
  if (!read.model) return null;
  const m = read.model;
  const { rs, ra, talent, picture, gamesLeft } = m;
  const played = m.gamesPlayed;
  const record = { w: m.w, l: m.l };
  const team = { league_id: m.leagueId };
  const odds = shownOdds(m);

  const deadline = parseDate(
    (db.prepare(`SELECT trade_deadline_date AS d FROM leagues WHERE league_id = ?`).get(team.league_id) as { d?: string } | undefined)?.d
  );
  /*
   * Through the shared helper, which quotes the column name. SQLite has a
   * built-in CURRENT_DATE keyword that silently shadows the column of that
   * name, so the unquoted version returns the real-world date rather than the
   * league's — and reported a deadline nine days past that is in fact
   * twenty-eight days away.
   */
  const today = parseDate(currentGameDate(team.league_id));
  const daysToDeadline = deadline && today
    ? Math.round((deadline.getTime() - today.getTime()) / 86_400_000)
    : null;
  const deadlinePassed = daysToDeadline !== null && daysToDeadline < 0;

  const pythagoreanWins = talent * played;
  const luck = record.w - pythagoreanWins;

  let posture: Posture;
  if (odds >= 0.75) posture = 'buy';
  else if (odds >= 0.55) posture = 'lean-buy';
  else if (odds >= 0.25) posture = 'hold';
  else if (odds >= 0.10) posture = 'lean-sell';
  else posture = 'sell';

  const reasons: string[] = [];
  reasons.push(
    `${record.w}-${record.l} with a ${rs - ra >= 0 ? '+' : ''}${rs - ra} run differential — ` +
    `the runs say a ${(talent * 162).toFixed(0)}-win pace.`
  );
  if (Math.abs(luck) >= 3) {
    reasons.push(
      luck > 0
        ? `Winning ${luck.toFixed(0)} more than the runs support, which tends not to last.`
        : `Losing ${Math.abs(luck).toFixed(0)} more than the runs support — better than the record looks.`
    );
  }
  if (picture) reasons.push(picture.summary);
  reasons.push(`${gamesLeft} games left to settle it.`);
  if (deadlinePassed) reasons.push('The deadline has passed — this reads the season, not the market.');
  else if (daysToDeadline !== null) reasons.push(`${daysToDeadline} days to the deadline.`);

  const chance = `${Math.round(odds * 100)}%`;
  const headline = {
    buy: `Buy — ${chance} to reach the postseason.`,
    'lean-buy': `Lean buy — ${chance}, and the games left are enough.`,
    hold: `Hold — ${chance}. The season has not decided yet.`,
    'lean-sell': `Lean sell — ${chance}, and running out of road.`,
    sell: `Sell — ${chance}. Play for next year.`,
  }[posture];

  return {
    posture, odds, headline, reasons,
    gamesPlayed: played, gamesLeft,
    runDiff: rs - ra,
    pythagoreanWins: Number(pythagoreanWins.toFixed(1)),
    actualWins: record.w,
    daysToDeadline, deadlinePassed,
  };
}
