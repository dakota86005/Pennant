/**
 * The roster map's places (N6, D-057; the D-052 amendment of 2026-09-25): at each position, each club's holder by one
 * stated rule, and our holder's league place counted on the figure Player Value serves, with how many clubs he is clearly
 * ahead of, not separable from and clearly behind. Pure: the valuations, the game log's starts, the farm's next man and
 * the needs arrive as data (the reader, `morningReport.ts`, asks Player Value, the export, Player Development and Major
 * League Ops); nothing here values a player, judges readiness or raises a need.
 *
 * - **The holder** of a club at a position is the regular the export shows (N6 review, the supervisor's call (c)): the
 *   man now on the club with the most starts there this season in the club's own game log, among the men who started
 *   there in its last 15 games (so a regular who has stopped starting there, hurt or moved, does not hold it); level on
 *   starts, the one with more of the last 15, then by name. Only where the log shows no such start (it is absent, or
 *   nobody now on the club started there lately) is it the club's player listed there with the most expected wins, and
 *   the node says so. The same rule for every club, the designated hitter included. A club with no valued holder is not
 *   placed, not counted in "of N", and named as left out with why, never placed last (D-018).
 * - **The place** is a count of clubs on that figure as shown (a tenth of a win): clubs level share the best place and
 *   the tie is stated. Two holders are told apart only on the range each lands in half the time (Player Value's 50% band;
 *   the supervisor's call (b)): ours is clearly ahead of a club whose holder's half-time range lies wholly below his,
 *   clearly behind one wholly above, and not separable from the rest. Nothing is combined across positions into a club
 *   score.
 *
 * In the landing folders (`tests/presentationBoundary.test.ts`): type-only imports, so it reaches neither the odds nor
 * the posture.
 */
import { placesOf, type StatedPlace } from './clubProfile.js';

/** Expected wins as Player Value serves them: the most likely value inside its range (80%), and the 50% range inside it. */
export interface WinsRange {
  low: number;
  likely: number;
  high: number;
  /** The range he lands in half the time; null where Player Value served none (a valuation kept from before it did). */
  inner: { low: number; high: number } | null;
}

export interface PositionPlayer {
  playerId: number;
  name: string;
  teamId: number;
  /** His listed position (1 pitcher, 2 catcher ... 9 right field, 10 designated hitter). */
  position: number;
  /** His expected wins this season (the rest of it once under way); null when Player Value does not value him. */
  wins: WinsRange | null;
  /** Which part of the season the wins cover. */
  part: 'rest_of_season' | 'season' | null;
  /** Why he is not valued; null when he is. */
  why: string | null;
  /** How Player Value's production model in force is called, and on what it rests; null when he is not valued. */
  stamp?: { status: 'calibrated' | 'provisional' | 'policy'; basis: string } | null;
}

/** A man's starts at a position for his club this season, from the club's own game log. */
export interface PositionStarts {
  playerId: number;
  /** Starts there this season. */
  season: number;
  /** Starts there in the club's last games (the window the log read). */
  recent: number;
}

/** The club's game log as the holder rule reads it: per club, its window of last games and each position's starts. */
export interface StartsLog {
  /** The window of last games the rule reads (15). */
  window: number;
  byClub: Map<number, { games: number; at: Map<number, PositionStarts[]> }>;
  /** Why the log cannot be read at all; null when it can. */
  why: string | null;
}

/** How a club's holder was chosen. */
export type HolderBasis =
  | { rule: 'starts'; season: number; recent: number; games: number }
  | { rule: 'listed'; why: string };

export interface PositionReading {
  position: number;
  /** Our holder by the stated rule; null when nobody holds it. */
  holder: PositionPlayer | null;
  /** How our holder was chosen. */
  holderBasis: HolderBasis;
  /** The others there: the men who started there this season by starts, then the others listed there. */
  behind: PositionPlayer[];
  /** Our holder's place among the clubs whose holder is valued; null when ours is not valued. */
  place: StatedPlace | null;
  /** How many other placed clubs' holders he is not separable from (their half-time ranges meet); null when not placed. */
  overlap: number | null;
  /** Those clubs, by name. */
  overlapping: string[];
  /** The placed clubs whose holder he is clearly ahead of, and clearly behind, by name. */
  clearlyAhead: string[];
  clearlyBehind: string[];
  /** The clubs level with ours on the figure as shown, by name. */
  tiedWith: string[];
  /** Clubs with no valued holder there, by name, with why. */
  leftOut: Array<{ club: string; why: string }>;
  /** How many clubs' holders chose by the listed position, the log being silent there. */
  listedClubs: number;
  /** The league's middle holder figure (the median of the valued holders). */
  middle: number | null;
}

/** The decimals the figure is shown and compared at (a tenth of a win). */
export const WINS_DIGITS = 1;

/** The last games of each club the holder rule reads. */
export const HOLDER_WINDOW = 15;

const byWins = (a: PositionPlayer, b: PositionPlayer) =>
  (b.wins?.likely ?? -Infinity) - (a.wins?.likely ?? -Infinity) || a.name.localeCompare(b.name) || a.playerId - b.playerId;

/** A club's listed players at a position, the valued ones first by expected wins, then the rest by name. */
export function depthAt(players: readonly PositionPlayer[], teamId: number, position: number): PositionPlayer[] {
  const here = players.filter((p) => p.teamId === teamId && p.position === position);
  return [...here.filter((p) => p.wins).sort(byWins), ...here.filter((p) => !p.wins).sort((a, b) => a.name.localeCompare(b.name))];
}

/** A club's holder at a position by the stated rule, the others there, and how the holder was chosen. */
export function holderAt(
  players: readonly PositionPlayer[], log: StartsLog | null, teamId: number, position: number,
): { holder: PositionPlayer | null; behind: PositionPlayer[]; basis: HolderBasis } {
  const onClub = new Map(players.filter((p) => p.teamId === teamId).map((p) => [p.playerId, p]));
  const club = log?.byClub.get(teamId);
  const starts = (club?.at.get(position) ?? []).filter((s) => onClub.has(s.playerId) && s.season > 0);
  const listed = depthAt(players, teamId, position);
  const lately = starts.filter((s) => s.recent > 0);
  if (lately.length && club) {
    const order = (a: PositionStarts, b: PositionStarts) => b.season - a.season || b.recent - a.recent
      || onClub.get(a.playerId)!.name.localeCompare(onClub.get(b.playerId)!.name) || a.playerId - b.playerId;
    const top = [...lately].sort(order)[0];
    const started = [...starts].sort(order).filter((s) => s.playerId !== top.playerId).map((s) => onClub.get(s.playerId)!);
    const seen = new Set([top.playerId, ...started.map((p) => p.playerId)]);
    return {
      holder: onClub.get(top.playerId)!,
      behind: [...started, ...listed.filter((p) => !seen.has(p.playerId))],
      basis: { rule: 'starts', season: top.season, recent: top.recent, games: club.games },
    };
  }
  const why = !log || log.why ? log?.why ?? 'The export has no game-by-game lines to show who starts there.'
    : !club || club.games === 0 ? 'The club hasn\'t played a game yet.'
      : `Nobody now on the club started there in its last ${club.games} games.`;
  return { holder: listed[0] ?? null, behind: listed.slice(1), basis: { rule: 'listed', why } };
}

/** The range two holders are told apart on: the half-time range where served, else the drawn range (said so by the reader). */
const apart = (w: WinsRange) => w.inner ?? { low: w.low, high: w.high };

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Which side of another's range one range lies on, as the map reads two half-time ranges (D-057): wholly above is ahead,
 * wholly below behind, and ranges that meet are level (not separable). Compare reads players the same way (N11).
 */
export function separationOf(ours: { low: number; high: number }, theirs: { low: number; high: number }): 'ahead' | 'behind' | 'level' {
  return ours.low > theirs.high ? 'ahead' : ours.high < theirs.low ? 'behind' : 'level';
}

/** Our holder at each position and his place among the league's clubs. */
export function positionReadings(
  orgId: number,
  clubs: ReadonlyArray<{ teamId: number; name: string }>,
  players: readonly PositionPlayer[],
  positions: readonly number[],
  log: StartsLog | null = null,
): PositionReading[] {
  return positions.map((position) => {
    const chosen = new Map(clubs.map((c) => [c.teamId, holderAt(players, log, c.teamId, position)]));
    const holders = new Map<number, PositionPlayer | null>([...chosen].map(([id, h]) => [id, h.holder]));
    const valued = new Map([...holders].map(([id, h]) => [id, h?.wins?.likely ?? null]));
    const places = placesOf(valued, 'higher', WINS_DIGITS);
    const mine = chosen.get(orgId) ?? holderAt(players, log, orgId, position);
    const holder = mine.holder;
    const place = places.get(orgId) ?? null;
    const nameOf = (id: number) => clubs.find((c) => c.teamId === id)?.name ?? `Club ${id}`;
    const others = [...holders].filter(([id, h]) => id !== orgId && h?.wins);
    const ours = holder?.wins && place ? apart(holder.wins) : null;
    const side = (w: WinsRange): 'ahead' | 'behind' | 'level' => separationOf(ours!, apart(w));
    const named = (want: 'ahead' | 'behind' | 'level') => (ours ? others.filter(([, h]) => side(h!.wins!) === want).map(([id]) => nameOf(id)) : []);
    const overlapping = named('level');
    const shown = (v: number) => Number(v.toFixed(WINS_DIGITS));
    return {
      position,
      holder,
      holderBasis: mine.basis,
      behind: mine.behind,
      place,
      overlap: place ? overlapping.length : null,
      overlapping,
      clearlyAhead: named('ahead'),
      clearlyBehind: named('behind'),
      tiedWith: place && holder?.wins
        ? others.filter(([, h]) => shown(h!.wins!.likely) === shown(holder.wins!.likely)).map(([id]) => nameOf(id))
        : [],
      leftOut: [...holders].filter(([, h]) => !h?.wins).map(([id, h]) => ({
        club: nameOf(id),
        why: h ? `Its man there isn't valued yet (${h.name}: ${h.why ?? 'not valued'}).` : 'Nobody is listed there.',
      })),
      listedClubs: [...chosen.values()].filter((h) => h.holder && h.basis.rule === 'listed').length,
      middle: median([...valued.values()].filter((v): v is number => v !== null)),
    };
  });
}

/** The scale every range on the map shares: whole wins holding every range shown, and zero. Null when nothing is valued. */
export function valueScaleOf(ranges: ReadonlyArray<WinsRange | null>): { low: number; high: number } | null {
  const known = ranges.filter((r): r is WinsRange => r !== null);
  if (!known.length) return null;
  const low = Math.floor(Math.min(0, ...known.map((r) => r.low)));
  const high = Math.ceil(Math.max(...known.map((r) => r.high)));
  return { low, high: high > low ? high : low + 1 };
}

/** A pitcher beside the map, as the reader hands him in. */
export interface StaffInput {
  playerId: number;
  name: string;
  kind: 'starter' | 'closer' | 'reliever';
  /** His place in OOTP's projected starts (0 is the next game); null when not projected. */
  projected: number | null;
  /** Outs recorded this season, for the bullpen's order; null when not exported. */
  outs: number | null;
  wins: WinsRange | null;
  why: string | null;
  stamp?: { status: 'calibrated' | 'provisional' | 'policy'; basis: string } | null;
}

/**
 * The rotation in OOTP's projected order from the next start (starters not projected after, by name), and the bullpen
 * with the club's closer first, then by the outs each has recorded this season (the work the club has given him, a
 * fact), then by name. An order of the export's facts, never of value.
 */
export function staffOrder(pitchers: readonly StaffInput[]): { rotation: StaffInput[]; bullpen: StaffInput[] } {
  const rotation = pitchers.filter((p) => p.kind === 'starter' || p.projected !== null)
    .sort((a, b) => (a.projected ?? Infinity) - (b.projected ?? Infinity) || a.name.localeCompare(b.name));
  const inRotation = new Set(rotation.map((p) => p.playerId));
  const bullpen = pitchers.filter((p) => !inRotation.has(p.playerId))
    .sort((a, b) => (a.kind === 'closer' ? 0 : 1) - (b.kind === 'closer' ? 0 : 1) || (b.outs ?? -1) - (a.outs ?? -1) || a.name.localeCompare(b.name));
  return { rotation, bullpen };
}
