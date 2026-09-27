/**
 * "How we win and lose" (D-057, SWIFTUI_REBUILD.md section 3.4): each dimension of the club's season as a stated place
 * among its league's clubs, from objective team statistics (`teamSeason.ts`). Pure: it reads nothing and judges nothing
 * beyond the stated policy lines.
 *
 * - A place counts only the clubs that have the figure ("of N" is the clubs placed; a club missing it, or whose row the
 *   export gives twice, is left out and named, never placed last). Clubs level at the figure as shown share the best
 *   place, and the tie is stated (D-018, D-057).
 * - A strength is a place in the top fifth of the clubs placed, a weakness a place in the bottom fifth; below 20 games
 *   the club's dimensions read "too early". These are policy lines (D-041), stamped as such, never fitted.
 * - The recent place reads each club's last 15 games; a club whose last 15 games the export's game log does not hold is
 *   not placed there, with why.
 * - No dimension is combined with another into a club grade, and nothing here reads a philosophy, a record's odds or a
 *   posture: the profile is the same whatever the club's situation.
 *
 * In the landing folders (`tests/presentationBoundary.test.ts`): it reaches neither the odds nor the posture.
 */
import type { ClubFacts, GameLogLine, TeamSeasonFacts } from './teamSeason.js';
import { clubGames } from './teamSeason.js';

/** The profile's lines: chosen and stated, never fitted (D-041). */
export const CLUB_PROFILE_POLICY = {
  /** Below this many games played by the club, every dimension reads "too early". */
  minGames: 20,
  /** A strength is a place within this share of the top of the clubs placed; a weakness within it of the bottom. */
  fifth: 0.2,
  /** The recent window, in each club's own games. */
  recentGames: 15,
  stamp: 'A strength is a place in the top fifth of the clubs that have the figure and a weakness a place in the bottom fifth; '
    + 'below 20 games it is too early to call either. Lines chosen and stated, not fitted.',
} as const;

export type DimensionId = 'scoring' | 'preventing' | 'onBase' | 'power' | 'rotation' | 'bullpen' | 'defense' | 'baserunning';
export type ProfileGroup = 'strength' | 'weakness' | 'rest' | 'tooEarly' | 'notPlaced';

/** One club's figure on a dimension, with the counts it was made from. */
export interface Figure {
  value: number | null;
  /** The counts behind it (runs, games, at-bats ...), for the basis. */
  parts: Record<string, number>;
  /** Why it is not known; null when it is. */
  why: string | null;
}

export interface DimensionSpec {
  id: DimensionId;
  /** Which way is better. */
  better: 'higher' | 'lower';
  /** Decimals the figure is shown and compared at: clubs level at this precision share a place. */
  digits: number;
  season: (club: ClubFacts, games: number | null) => Figure;
  recent: (club: RecentWindow) => Figure;
}

/** One club's last games and their lines in the per-game log. */
export interface RecentWindow {
  teamId: number;
  games: Array<{ gameId: number; scored: number; allowed: number }>;
  batting: Array<Record<string, number | null>> | null;
  starting: Array<Record<string, number | null>> | null;
  relief: Array<Record<string, number | null>> | null;
  /** Why the log cannot give this window; null when it holds every game of it. */
  logWhy: string | null;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** The named counts when every one is known; null when any is missing. */
function counts<K extends string>(t: Readonly<Record<string, number | null | undefined>> | null | undefined, keys: readonly K[]): Record<K, number> | null {
  if (!t) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const v = t[k];
    if (!isNum(v)) return null;
    out[k] = v;
  }
  return out;
}
const none = (why: string): Figure => ({ value: null, parts: {}, why });
const sumOf = (rows: Array<Record<string, number | null>>, key: string): number | null => {
  let total = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) return null;
    total += v;
  }
  return total;
};

function onBase(t: Record<string, number | null>): Figure {
  const c = counts(t, ['ab', 'h', 'bb', 'hp', 'sf'] as const);
  if (c && c.ab + c.bb + c.hp + c.sf > 0) return { value: (c.h + c.bb + c.hp) / (c.ab + c.bb + c.hp + c.sf), parts: c, why: null };
  if (isNum(t.obp)) return { value: t.obp, parts: {}, why: null };
  return none('The export has no times on base for the club.');
}

function power(t: Record<string, number | null>): Figure {
  const tb = counts(t, ['ab', 'h', 'tb'] as const);
  if (tb && tb.ab > 0) return { value: (tb.tb - tb.h) / tb.ab, parts: tb, why: null };
  const xb = counts(t, ['ab', 'd', 't', 'hr'] as const);
  if (xb && xb.ab > 0) return { value: (xb.d + 2 * xb.t + 3 * xb.hr) / xb.ab, parts: xb, why: null };
  if (isNum(t.slg) && isNum(t.avg)) return { value: t.slg - t.avg, parts: {}, why: null };
  return none('The export has no extra-base hits for the club.');
}

function earnedRuns(t: Record<string, number | null> | null, who: string): Figure {
  if (!t) return none(`The export has no ${who} totals for the club.`);
  const outs = isNum(t.outs) ? t.outs : isNum(t.ip) ? t.ip * 3 + (isNum(t.ipf) ? t.ipf : 0) : null;
  if (isNum(t.er) && outs !== null && outs > 0) return { value: (t.er * 27) / outs, parts: { er: t.er, outs }, why: null };
  if (isNum(t.era)) return { value: t.era, parts: {}, why: null };
  return none(`The export has no earned runs or innings for the club's ${who}.`);
}

function efficiency(t: Record<string, number | null> | null): Figure {
  if (!t) return none('The export has no pitching totals for the club.');
  const c = counts(t, ['ha', 'hra', 'bf', 'k', 'bb', 'hp'] as const);
  if (!c) return none('The export lacks the hits, walks and strikeouts allowed it takes.');
  const inPlay = c.bf - c.bb - c.hp - c.k - c.hra;
  if (inPlay <= 0) return none('No balls in play yet.');
  return { value: 1 - (c.ha - c.hra) / inPlay, parts: c, why: null };
}

const logged = (rows: Array<Record<string, number | null>> | null, why: string | null, f: (t: Record<string, number | null>) => Figure): Figure => {
  if (!rows) return none(why ?? 'The export has no game-by-game lines.');
  const keys = new Set(rows.flatMap((r) => Object.keys(r)));
  return f(Object.fromEntries([...keys].map((k) => [k, sumOf(rows, k)])));
};

/** The dimensions, in the order the page lists them. */
export const DIMENSIONS: readonly DimensionSpec[] = [
  {
    id: 'scoring', better: 'higher', digits: 2,
    season: (c, g) => {
      const r = c.totals.batting?.r;
      return isNum(r) && isNum(g) && g > 0 ? { value: r / g, parts: { runs: r, games: g }, why: null } : none('The export has no runs scored for the club.');
    },
    recent: (w) => ({ value: w.games.reduce((s, x) => s + x.scored, 0) / w.games.length, parts: { runs: w.games.reduce((s, x) => s + x.scored, 0), games: w.games.length }, why: null }),
  },
  {
    id: 'preventing', better: 'lower', digits: 2,
    season: (c, g) => {
      const r = c.totals.pitching?.r;
      return isNum(r) && isNum(g) && g > 0 ? { value: r / g, parts: { runs: r, games: g }, why: null } : none('The export has no runs allowed for the club.');
    },
    recent: (w) => ({ value: w.games.reduce((s, x) => s + x.allowed, 0) / w.games.length, parts: { runs: w.games.reduce((s, x) => s + x.allowed, 0), games: w.games.length }, why: null }),
  },
  {
    id: 'onBase', better: 'higher', digits: 3,
    season: (c) => (c.totals.batting ? onBase(c.totals.batting) : none('The export has no batting totals for the club.')),
    recent: (w) => logged(w.batting, w.logWhy, onBase),
  },
  {
    id: 'power', better: 'higher', digits: 3,
    season: (c) => (c.totals.batting ? power(c.totals.batting) : none('The export has no batting totals for the club.')),
    recent: (w) => logged(w.batting, w.logWhy, power),
  },
  {
    id: 'rotation', better: 'lower', digits: 2,
    season: (c) => earnedRuns(c.totals.starting, 'starters\''),
    recent: (w) => logged(w.starting, w.logWhy, (t) => earnedRuns(t, 'starters\'')),
  },
  {
    id: 'bullpen', better: 'lower', digits: 2,
    season: (c) => earnedRuns(c.totals.bullpen, 'relievers\''),
    recent: (w) => logged(w.relief, w.logWhy, (t) => earnedRuns(t, 'relievers\'')),
  },
  {
    id: 'defense', better: 'higher', digits: 3,
    season: (c) => efficiency(c.totals.pitching),
    recent: (w) => {
      if (!w.starting || !w.relief) return none(w.logWhy ?? 'The export has no game-by-game pitching lines.');
      return logged([...w.starting, ...w.relief], w.logWhy, efficiency);
    },
  },
  {
    id: 'baserunning', better: 'higher', digits: 2,
    season: (c, g) => (isNum(c.baserunningRuns) && isNum(g) && g > 0
      ? { value: c.baserunningRuns / g, parts: { runs: c.baserunningRuns, games: g }, why: null }
      : none('The export has no base-running runs for the club\'s players.')),
    recent: (w) => logged(w.batting, w.logWhy, (t) => (isNum(t.ubr) ? { value: t.ubr / w.games.length, parts: { runs: t.ubr, games: w.games.length }, why: null } : none('The export\'s game log has no base-running runs.'))),
  },
];

/** A place among the clubs that have the figure, at the precision it is shown. */
export interface StatedPlace {
  rank: number;
  of: number;
  tiedWith: number;
}

/**
 * Each club's place: clubs with no figure are left out (not placed, not counted); clubs level at the figure as shown
 * share the best place. A better figure never takes a worse place.
 */
export function placesOf(values: ReadonlyMap<number, number | null>, better: 'higher' | 'lower', digits: number): Map<number, StatedPlace> {
  const shown = new Map<number, number>();
  for (const [id, v] of values) if (v !== null && Number.isFinite(v)) shown.set(id, Number(v.toFixed(digits)));
  const all = [...shown.values()];
  const out = new Map<number, StatedPlace>();
  for (const [id, v] of shown) {
    const ahead = all.filter((x) => (better === 'higher' ? x > v : x < v)).length;
    const level = all.filter((x) => x === v).length - 1;
    out.set(id, { rank: ahead + 1, of: shown.size, tiedWith: level });
  }
  return out;
}

/** Strength, weakness or the rest, by the stated fifths of the clubs placed (integer arithmetic: no rounding at the line). */
export function groupOf(place: StatedPlace): 'strength' | 'weakness' | 'rest' {
  const fifths = Math.round(1 / CLUB_PROFILE_POLICY.fifth);
  if (place.rank * fifths <= place.of) return 'strength';
  if ((place.of - place.rank + 1) * fifths <= place.of) return 'weakness';
  return 'rest';
}

/**
 * Where the stated lines fall among `of` clubs placed, in the arithmetic `groupOf` uses: a place at or above
 * `strengthThrough` is a strength, at or below `weaknessFrom` a weakness. Null in a league too small to have a top or
 * bottom fifth (then no place is either).
 */
export function bandsOf(of: number): { strengthThrough: number; weaknessFrom: number } | null {
  const fifths = Math.round(1 / CLUB_PROFILE_POLICY.fifth);
  const through = Math.floor(of / fifths);
  return through >= 1 ? { strengthThrough: through, weaknessFrom: of - through + 1 } : null;
}

export interface DimensionReading {
  id: DimensionId;
  better: 'higher' | 'lower';
  digits: number;
  group: ProfileGroup;
  /** The club's own figure. */
  figure: Figure;
  place: StatedPlace | null;
  /** The league's middle (the median of the clubs placed), shown beside the place. */
  middle: number | null;
  /** The clubs level with ours, by name. */
  tiedWith: string[];
  /** Clubs not placed, by name, each with why. */
  leftOut: Array<{ club: string; why: string }>;
  recent: { figure: Figure; place: StatedPlace | null; why: string | null };
  /** The clubs that have the figure (the strip's clubs), and where the stated lines fall among them (`bandsOf`). */
  strip: { of: number; strengthThrough: number | null; weaknessFrom: number | null };
}

export interface ClubProfileReading {
  /** The lines it was read at (handed on, so the words quote the lines in force). */
  policy: typeof CLUB_PROFILE_POLICY;
  /** The club's games played; null when its record is not exported. */
  games: number | null;
  tooEarly: boolean;
  clubs: number;
  dimensions: DimensionReading[];
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Each club's last games (the stated window) with their lines in the per-game log, or why the log cannot give them. */
export function recentWindows(facts: TeamSeasonFacts, size: number = CLUB_PROFILE_POLICY.recentGames): Map<number, RecentWindow | { teamId: number; why: string }> {
  const index = (lines: GameLogLine[] | null) => {
    if (!lines) return null;
    const m = new Map<string, Record<string, number | null>>();
    for (const l of lines) m.set(`${l.teamId}:${l.gameId}`, l.values);
    return m;
  };
  const bat = index(facts.log.batting);
  const start = index(facts.log.starting);
  const relief = index(facts.log.relief);
  const out = new Map<number, RecentWindow | { teamId: number; why: string }>();
  for (const club of facts.clubs) {
    if (facts.gamesWhy) {
      out.set(club.teamId, { teamId: club.teamId, why: facts.gamesWhy });
      continue;
    }
    const games = clubGames(facts, club.teamId).slice(-size);
    if (games.length < size) {
      out.set(club.teamId, { teamId: club.teamId, why: `Fewer than ${size} games played.` });
      continue;
    }
    const pick = (m: Map<string, Record<string, number | null>> | null) => {
      if (!m) return null;
      const rows = games.map((g) => m.get(`${club.teamId}:${g.gameId}`));
      return rows.every(Boolean) ? rows as Array<Record<string, number | null>> : undefined;
    };
    const b = pick(bat);
    const s = pick(start);
    // A game with no relief appearance has no relief line: an empty line, not a missing game
    const r = relief ? games.map((g) => relief.get(`${club.teamId}:${g.gameId}`) ?? { outs: 0, er: 0, ha: 0, hra: 0, bf: 0, k: 0, bb: 0, hp: 0 }) : null;
    const missing = b === undefined || s === undefined;
    out.set(club.teamId, {
      teamId: club.teamId,
      games: games.map((g) => ({ gameId: g.gameId, scored: g.scored, allowed: g.allowed })),
      batting: b ?? null,
      starting: s ?? null,
      relief: s ? r : null,
      logWhy: missing
        ? `The export's game log doesn't hold all of the club's last ${size} games.`
        : facts.log.why,
    });
  }
  return out;
}

/** The club's profile: every dimension's place among the league's clubs, its group and its recent place. */
export function clubProfileOf(facts: TeamSeasonFacts): ClubProfileReading {
  const me = facts.clubs.find((c) => c.teamId === facts.orgId) ?? null;
  const gamesOf = (c: ClubFacts): number | null => c.record?.g ?? c.totals.batting?.g ?? null;
  const games = me ? gamesOf(me) : null;
  const tooEarly = games === null || games < CLUB_PROFILE_POLICY.minGames;
  const windows = recentWindows(facts);
  const dimensions = DIMENSIONS.map((spec): DimensionReading => {
    const figures = new Map<number, Figure>();
    for (const c of facts.clubs) {
      const dup = spec.id === 'scoring' || spec.id === 'onBase' || spec.id === 'power'
        ? c.duplicated.includes('batting')
        : spec.id === 'rotation' ? c.duplicated.includes('starting')
          : spec.id === 'bullpen' ? c.duplicated.includes('bullpen')
            : spec.id === 'baserunning' ? false
              : c.duplicated.includes('pitching');
      figures.set(c.teamId, dup ? none('The export gives the club more than one season row, so its total is not established.') : spec.season(c, gamesOf(c)));
    }
    const places = placesOf(new Map([...figures].map(([id, f]) => [id, f.value])), spec.better, spec.digits);
    const place = me ? places.get(me.teamId) ?? null : null;
    const nameOf = (id: number) => facts.clubs.find((c) => c.teamId === id)?.name ?? `Club ${id}`;
    const mine = me ? figures.get(me.teamId)! : none('The club is not in its league\'s clubs.');
    const shownMine = mine.value === null ? null : Number(mine.value.toFixed(spec.digits));
    const recentFigures = new Map<number, Figure>();
    for (const [id, w] of windows) recentFigures.set(id, 'why' in w ? none(w.why) : spec.recent(w));
    const recentPlaces = placesOf(new Map([...recentFigures].map(([id, f]) => [id, f.value])), spec.better, spec.digits);
    const recentMine = me ? recentFigures.get(me.teamId) ?? none('No recent games.') : none('No recent games.');
    const of = places.size;
    const bands = bandsOf(of);
    return {
      id: spec.id, better: spec.better, digits: spec.digits,
      group: tooEarly ? 'tooEarly' : place === null ? 'notPlaced' : groupOf(place),
      figure: mine,
      place,
      middle: median([...figures.values()].map((f) => f.value).filter((v): v is number => v !== null)),
      tiedWith: place && shownMine !== null
        ? [...figures].filter(([id, f]) => id !== me!.teamId && f.value !== null && Number(f.value.toFixed(spec.digits)) === shownMine).map(([id]) => nameOf(id))
        : [],
      leftOut: [...figures].filter(([, f]) => f.value === null).map(([id, f]) => ({ club: nameOf(id), why: f.why ?? 'Not known.' })),
      recent: {
        figure: recentMine,
        place: me ? recentPlaces.get(me.teamId) ?? null : null,
        why: recentMine.value === null ? recentMine.why : null,
      },
      strip: { of, strengthThrough: bands?.strengthThrough ?? null, weaknessFrom: bands?.weaknessFrom ?? null },
    };
  });
  return { policy: CLUB_PROFILE_POLICY, games, tooEarly, clubs: facts.clubs.length, dimensions };
}
