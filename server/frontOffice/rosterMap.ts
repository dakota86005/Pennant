/**
 * The roster map's places (N6, D-057; the D-052 amendment of 2026-09-25): at each position, each club's holder by one
 * stated rule, and our holder's league place counted on the figure Player Value serves, with how many clubs' ranges
 * overlap his. Pure: the valuations, the farm's next man and the needs arrive as data (the reader, `morningReport.ts`,
 * asks Player Value, Player Development and Major League Ops); nothing here values a player, judges readiness or raises
 * a need.
 *
 * - **The holder** of a club at a position is its major-league player listed there with the most expected wins this
 *   season (the rest of it once it is under way), most likely, as Player Value serves them; the same rule for every club.
 *   A club with nobody valued there has no valued holder: it is not placed, not counted in "of N", and named as left out
 *   with why, never placed last (D-018).
 * - **The place** is a count of clubs on that figure as shown (a tenth of a win): clubs level share the best place and
 *   the tie is stated. It is stated with how many other placed clubs' holders' ranges overlap his: two whose ranges
 *   overlap are not said to differ. Nothing is combined across positions into a club score.
 *
 * In the landing folders (`tests/presentationBoundary.test.ts`): type-only imports, so it reaches neither the odds nor
 * the posture.
 */
import { placesOf, type StatedPlace } from './clubProfile.js';

/** Expected wins as Player Value serves them: the most likely value inside its range. */
export interface WinsRange {
  low: number;
  likely: number;
  high: number;
}

export interface PositionPlayer {
  playerId: number;
  name: string;
  teamId: number;
  /** His listed position (2 catcher ... 9 right field, 10 designated hitter). */
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

export interface PositionReading {
  position: number;
  /** Our holder: the valued player with the most expected wins, else the first listed (not valued); null when nobody is listed. */
  holder: PositionPlayer | null;
  /** The others listed there, valued ones by expected wins, then the ones not valued. */
  behind: PositionPlayer[];
  /** Our holder's place among the clubs whose holder is valued; null when ours is not valued. */
  place: StatedPlace | null;
  /** How many other placed clubs' holders' ranges overlap his; null when he is not placed. */
  overlap: number | null;
  /** Those clubs, by name. */
  overlapping: string[];
  /** The clubs level with ours on the figure as shown, by name. */
  tiedWith: string[];
  /** Clubs with no valued holder there, by name, with why. */
  leftOut: Array<{ club: string; why: string }>;
  /** The league's middle holder figure (the median of the valued holders). */
  middle: number | null;
}

/** The decimals the figure is shown and compared at (a tenth of a win). */
export const WINS_DIGITS = 1;

const byWins = (a: PositionPlayer, b: PositionPlayer) =>
  (b.wins?.likely ?? -Infinity) - (a.wins?.likely ?? -Infinity) || a.name.localeCompare(b.name) || a.playerId - b.playerId;

/** A club's listed players at a position, the valued ones first by expected wins, then the rest by name. */
export function depthAt(players: readonly PositionPlayer[], teamId: number, position: number): PositionPlayer[] {
  const here = players.filter((p) => p.teamId === teamId && p.position === position);
  return [...here.filter((p) => p.wins).sort(byWins), ...here.filter((p) => !p.wins).sort((a, b) => a.name.localeCompare(b.name))];
}

const overlaps = (a: WinsRange, b: WinsRange) => a.low <= b.high && b.low <= a.high;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Our holder at each position and his place among the league's clubs. */
export function positionReadings(
  orgId: number,
  clubs: ReadonlyArray<{ teamId: number; name: string }>,
  players: readonly PositionPlayer[],
  positions: readonly number[],
): PositionReading[] {
  return positions.map((position) => {
    const holders = new Map<number, PositionPlayer | null>(clubs.map((c) => [c.teamId, depthAt(players, c.teamId, position)[0] ?? null]));
    const valued = new Map([...holders].map(([id, h]) => [id, h?.wins?.likely ?? null]));
    const places = placesOf(valued, 'higher', WINS_DIGITS);
    const mine = depthAt(players, orgId, position);
    const holder = mine[0] ?? null;
    const place = places.get(orgId) ?? null;
    const nameOf = (id: number) => clubs.find((c) => c.teamId === id)?.name ?? `Club ${id}`;
    const others = [...holders].filter(([id, h]) => id !== orgId && h?.wins);
    const overlapping = holder?.wins && place ? others.filter(([, h]) => overlaps(h!.wins!, holder.wins!)).map(([id]) => nameOf(id)) : [];
    const shown = (v: number) => Number(v.toFixed(WINS_DIGITS));
    return {
      position,
      holder,
      behind: mine.slice(1),
      place,
      overlap: place ? overlapping.length : null,
      overlapping,
      tiedWith: place && holder?.wins
        ? others.filter(([, h]) => shown(h!.wins!.likely) === shown(holder.wins!.likely)).map(([id]) => nameOf(id))
        : [],
      leftOut: [...holders].filter(([, h]) => !h?.wins).map(([id, h]) => ({
        club: nameOf(id),
        why: h ? `Nobody listed there is valued yet (${h.name}: ${h.why ?? 'not valued'}).` : 'Nobody is listed there.',
      })),
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
