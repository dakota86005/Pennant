/**
 * League Office's Standings and Us vs Them, read (N12 Track B, D-072): each reads what the React page's route computes
 * (`computeStandings`, `league.ts`) and the modules beside it, works out the places it states, and hands plain data to
 * the pure adapters in `presentation/league/`, which word it.
 *
 * - **Standings** reads the standings, our place in the race (`playoffPicture`) and, for the staff's rough read only,
 *   the deadline read's odds model (`oddsModelOf`, `deadlineRead`). D-060: this is the one view the odds and the posture
 *   reach, and they reach the adapter as numbers; the adapter never imports `posture` or `playoffs`.
 * - **Us vs Them** reads the standings, the clubs' season totals (`readTeamSeason`, the Club Profile's own reading: the
 *   club's one row at the major league this season), the places among the league's clubs (`placesOf`, D-057), our next
 *   game (`computeNextGame`) and our schedule's head-to-head (`computeSchedule`). It reads no odds and no posture.
 */
import type { Computed } from './computed.js';
import { computeNextGame, nextGames } from './dashboard.js';
import { tableExists } from './db.js';
import { placesOf, type StatedPlace } from './frontOffice/clubProfile.js';
import { readTeamSeason, type ClubFacts } from './frontOffice/teamSeason.js';
import { computeStandings, type Standings, type StandingsTeam } from './league.js';
import { playoffPicture } from './playoffs.js';
import { deadlineRead, oddsModelOf } from './posture.js';
import type { OfficeContext } from './presentation/league/common.js';
import { standingsUnreadView, standingsView, type RaceFacts, type StaffReadFacts } from './presentation/league/standings.js';
import type { LeagueStandingsView, LeagueUsVsThemView } from './presentation/league/types.js';
import { usVsThemUnreadView, usVsThemView, type Measure, type MeasureFigure, type SideFacts } from './presentation/league/usVsThem.js';
import { computeSchedule } from './schedule.js';

const known = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The standings' refusal in the GM's words. */
function refusalWords(c: Extract<Computed<Standings>, { ok: false }>): string {
  return c.status === 404 ? 'This club isn\'t in the export\'s standings' : 'No standings have been imported yet';
}

/** Every club of the standings, in the served order, with its division's name. */
function linesOf(s: Standings): Array<{ team: StandingsTeam; division: string; teams: StandingsTeam[] }> {
  return s.subLeagues.flatMap((sub) => sub.divisions.flatMap((d) => d.teams.map((team) => ({ team, division: d.name, teams: d.teams }))));
}

/** A club's place in its division by games back: level clubs share it (D-057); null without games back. */
function divisionPlaceOf(team: StandingsTeam, teams: StandingsTeam[]): StatedPlace | null {
  if (!known(team.gb)) return null;
  const values = new Map(teams.map((t) => [t.team_id, known(t.gb) ? t.gb : null]));
  return placesOf(values, 'lower', 1).get(team.team_id) ?? null;
}

// ── Standings ───────────────────────────────────────────────────────────────

function raceOf(orgId: number, s: Standings): RaceFacts | null {
  const mine = linesOf(s).find((x) => x.team.team_id === orgId);
  if (!mine) return null;
  const t = mine.team;
  // Games played not in the export stays not known (D-018), never "no games played yet"
  const played = known(t.g) ? t.g : known(t.w) && known(t.l) ? t.w + t.l : null;
  const picture = playoffPicture(orgId);
  const leads = known(t.gb) && t.gb <= 0;
  return {
    division: mine.division,
    divisionPlace: divisionPlaceOf(t, mine.teams),
    divisionGb: known(t.gb) ? t.gb : null,
    divisionLead: leads && picture?.route === 'division' && picture.cushion !== null ? picture.cushion : null,
    gamesPlayed: played,
    wildCards: picture ? picture.spots : null,
    route: picture ? picture.route : null,
    wildcardGb: picture?.wildcardGb ?? null,
    wildcardRank: picture?.wildcardRank ?? null,
    magicNumber: known(t.magicNumber) ? t.magicNumber : picture?.magicNumber ?? null,
  };
}

export const SEASON_DECIDED = 'The regular season is over, so the race is decided: the staff make no read of the odds or the deadline.';
export const NO_SCHEDULE = 'The staff\'s rough read can\'t be made: the export has no schedule to count the games left.';

/**
 * Whether the club's regular season has a game left to play, from the export's schedule (the next game's own filter:
 * regular-season games not yet played); null when the export can't say (no schedule, or one this reading can't read).
 */
function regularSeasonGameLeft(orgId: number): boolean | null {
  if (!tableExists('games')) return null;
  try {
    return nextGames(orgId, 1).length > 0;
  } catch {
    return null;
  }
}

/**
 * The staff's rough read's numbers, or why it can't be made (D-060: only Standings reads it). No read once the regular
 * season is decided (no game left for the club), and none on a schedule the export doesn't carry (the model would assume
 * 162 games: D-018).
 */
function staffReadOf(orgId: number): { read: StaffReadFacts | null; why: string | null } {
  const m = oddsModelOf(orgId);
  if (!m.model) {
    const why = m.reason.startsWith('No game has been played')
      ? 'The staff\'s rough read waits for the first game: it reads the club\'s strength from this season\'s runs.'
      : `The staff's rough read can't be made: ${m.reason.charAt(0).toLowerCase()}${m.reason.slice(1)}`;
    return { read: null, why };
  }
  if (m.model.scheduleRead !== 'games') return { read: null, why: NO_SCHEDULE };
  if (m.model.gamesLeft === 0 || regularSeasonGameLeft(orgId) === false) return { read: null, why: SEASON_DECIDED };
  const d = deadlineRead(orgId);
  if (!d) return { read: null, why: 'The staff\'s rough read can\'t be made for this club.' };
  const model = m.model;
  return {
    read: {
      posture: d.posture,
      odds: d.odds,
      w: model.w,
      l: model.l,
      gamesPlayed: model.gamesPlayed,
      gamesLeft: model.gamesLeft,
      rs: model.rs,
      ra: model.ra,
      strength: model.talent,
      rival: model.rival,
      expectedWins: d.pythagoreanWins,
      gap: model.gap,
      gapRead: model.gapRead,
      holding: model.picture !== null && model.picture.route !== 'out',
      raceSummary: model.picture?.summary ?? null,
      daysToDeadline: d.daysToDeadline,
      deadlinePassed: d.deadlinePassed,
    },
    why: null,
  };
}

export function standingsViewOf(v: OfficeContext, orgId: number): LeagueStandingsView {
  const c = computeStandings(orgId);
  if (!c.ok) return standingsView(v, { standings: refusalWords(c), race: null, read: null, readWhy: null });
  const race = raceOf(orgId, c.body);
  const { read, why } = race ? staffReadOf(orgId) : { read: null, why: 'The staff\'s rough read is made only for a club in these standings.' };
  return standingsView(v, { standings: c.body, race, read, readWhy: why });
}

export function standingsUnread(v: OfficeContext, why: string): LeagueStandingsView {
  return standingsUnreadView(v, why);
}

// ── Us vs Them ──────────────────────────────────────────────────────────────

/** The clubs Us vs Them can set beside ours: the other major league clubs of our league, in the standings' order. */
export function opponentsOf(orgId: number): number[] {
  const c = computeStandings(orgId);
  if (!c.ok) return [];
  return linesOf(c.body).map((x) => x.team.team_id).filter((id) => id !== orgId);
}

type Totals = Record<string, number | null> | null;
const none = (why: string) => ({ value: null, why });
const isNum = known;

/** A total's innings as outs: the export's `outs`, else innings and their thirds. */
const outsOf = (t: NonNullable<Totals>): number | null => (isNum(t.outs) ? t.outs : isNum(t.ip) ? t.ip * 3 + (isNum(t.ipf) ? t.ipf : 0) : null);

/** The batting and pitching lines Us vs Them shows: how each is read from a club's totals, and which way is better. */
const TOTAL_LINES: ReadonlyArray<{
  id: string; section: 'batting' | 'pitching'; label: string; hint: string; format: Measure['format']; better: 'higher' | 'lower';
  read: (c: ClubFacts) => { value: number | null; why: string | null };
}> = [
  {
    id: 'avg', section: 'batting', label: 'Batting average', hint: 'Hits per at-bat', format: 'rate3', better: 'higher',
    read: (c) => {
      const t = c.totals.batting;
      if (!t) return none('The export has no batting totals for the club');
      if (isNum(t.h) && isNum(t.ab) && t.ab > 0) return { value: t.h / t.ab, why: null };
      return isNum(t.avg) ? { value: t.avg, why: null } : none('The export has no hits or at-bats for the club');
    },
  },
  {
    id: 'obp', section: 'batting', label: 'On-base percentage', hint: 'How often a batter reaches base', format: 'rate3', better: 'higher',
    read: (c) => obpOf(c.totals.batting),
  },
  {
    id: 'slg', section: 'batting', label: 'Slugging', hint: 'Total bases per at-bat', format: 'rate3', better: 'higher',
    read: (c) => slgOf(c.totals.batting),
  },
  {
    id: 'ops', section: 'batting', label: 'OPS', hint: 'On-base plus slugging', format: 'rate3', better: 'higher',
    read: (c) => {
      const obp = obpOf(c.totals.batting);
      const slg = slgOf(c.totals.batting);
      if (obp.value !== null && slg.value !== null) return { value: obp.value + slg.value, why: null };
      const t = c.totals.batting;
      return t && isNum(t.ops) ? { value: t.ops, why: null } : none(obp.why ?? slg.why ?? 'The export has no on-base or slugging for the club');
    },
  },
  { id: 'hr', section: 'batting', label: 'Home runs', hint: 'Home runs hit this season', format: 'count', better: 'higher', read: (c) => count(c.totals.batting, 'hr', 'batting') },
  { id: 'bb', section: 'batting', label: 'Walks', hint: 'Walks drawn this season', format: 'count', better: 'higher', read: (c) => count(c.totals.batting, 'bb', 'batting') },
  { id: 'k', section: 'batting', label: 'Strikeouts', hint: 'Times struck out this season', format: 'count', better: 'lower', read: (c) => count(c.totals.batting, 'k', 'batting') },
  { id: 'sb', section: 'batting', label: 'Stolen bases', hint: 'Bases stolen this season', format: 'count', better: 'higher', read: (c) => count(c.totals.batting, 'sb', 'batting') },
  { id: 'era', section: 'pitching', label: 'ERA', hint: 'Earned runs allowed per nine innings', format: 'dec2', better: 'lower', read: (c) => eraOf(c.totals.pitching, 'pitching') },
  { id: 'rotationEra', section: 'pitching', label: 'Starters\' ERA', hint: 'The rotation\'s earned runs per nine innings', format: 'dec2', better: 'lower', read: (c) => eraOf(c.totals.starting, 'starters\'') },
  { id: 'bullpenEra', section: 'pitching', label: 'Bullpen ERA', hint: 'The relievers\' earned runs per nine innings', format: 'dec2', better: 'lower', read: (c) => eraOf(c.totals.bullpen, 'relievers\'') },
  {
    id: 'whip', section: 'pitching', label: 'WHIP', hint: 'Walks and hits allowed per inning', format: 'dec2', better: 'lower',
    read: (c) => {
      const t = c.totals.pitching;
      if (!t) return none('The export has no pitching totals for the club');
      const outs = outsOf(t);
      if (isNum(t.ha) && isNum(t.bb) && outs !== null && outs > 0) return { value: ((t.ha + t.bb) * 3) / outs, why: null };
      return isNum(t.whip) ? { value: t.whip, why: null } : none('The export has no hits, walks or innings for the club');
    },
  },
  { id: 'kp', section: 'pitching', label: 'Strikeouts', hint: 'Batters struck out this season', format: 'count', better: 'higher', read: (c) => count(c.totals.pitching, 'k', 'pitching') },
  { id: 'bbp', section: 'pitching', label: 'Walks allowed', hint: 'Batters walked this season', format: 'count', better: 'lower', read: (c) => count(c.totals.pitching, 'bb', 'pitching') },
  { id: 'hra', section: 'pitching', label: 'Home runs allowed', hint: 'Home runs given up this season', format: 'count', better: 'lower', read: (c) => count(c.totals.pitching, 'hra', 'pitching') },
];

function count(t: Totals, key: string, what: string): { value: number | null; why: string | null } {
  if (!t) return none(`The export has no ${what} totals for the club`);
  return isNum(t[key]) ? { value: t[key], why: null } : none('Not in the club\'s season totals');
}

function obpOf(t: Totals): { value: number | null; why: string | null } {
  if (!t) return none('The export has no batting totals for the club');
  const parts = ['ab', 'h', 'bb', 'hp', 'sf'].map((k) => t[k]);
  if (parts.every(isNum)) {
    const [ab, h, bb, hp, sf] = parts as number[];
    if (ab + bb + hp + sf > 0) return { value: (h + bb + hp) / (ab + bb + hp + sf), why: null };
  }
  return isNum(t.obp) ? { value: t.obp, why: null } : none('The export has no times on base for the club');
}

function slgOf(t: Totals): { value: number | null; why: string | null } {
  if (!t) return none('The export has no batting totals for the club');
  if (isNum(t.ab) && t.ab > 0) {
    if (isNum(t.tb)) return { value: t.tb / t.ab, why: null };
    if ([t.h, t.d, t.t, t.hr].every(isNum)) return { value: (t.h! + t.d! + 2 * t.t! + 3 * t.hr!) / t.ab, why: null };
  }
  return isNum(t.slg) ? { value: t.slg, why: null } : none('The export has no total bases for the club');
}

function eraOf(t: Totals, who: string): { value: number | null; why: string | null } {
  if (!t) return none(`The export has no ${who} totals for the club`);
  const outs = outsOf(t);
  if (isNum(t.er) && outs !== null && outs > 0) return { value: (t.er * 27) / outs, why: null };
  return isNum(t.era) ? { value: t.era, why: null } : none(`The export has no earned runs or innings for the club's ${who}`);
}

/** Each club's figure for a line, and the two clubs' figures with their places among the league's clubs. */
function measureOf(
  spec: { id: string; section: Measure['section']; label: string; hint: string; format: Measure['format']; better: 'higher' | 'lower' },
  figures: Map<number, { value: number | null; why: string | null }>,
  us: number,
  them: number,
): Measure {
  const digits = spec.format === 'rate3' ? 3 : spec.format === 'dec2' ? 2 : 0;
  const places = placesOf(new Map([...figures].map(([id, f]) => [id, f.value])), spec.better, digits);
  const side = (id: number): MeasureFigure => {
    const f = figures.get(id) ?? none('The club isn\'t among the league\'s clubs in the export');
    return { value: f.value, why: f.why, place: f.value === null ? null : places.get(id) ?? null };
  };
  return { ...spec, us: side(us), them: side(them) };
}

/** The club set beside ours when the GM didn't choose: the next opponent, else the closest in our division, else the first. */
function defaultOpponent(orgId: number, s: Standings, opponents: number[]): { team: number | null; by: 'next' | 'closest' | 'first' | null } {
  if (!opponents.length) return { team: null, by: null };
  const next = computeNextGame(orgId);
  if (next && opponents.includes(next.oppId)) return { team: next.oppId, by: 'next' };
  const mine = linesOf(s).find((x) => x.team.team_id === orgId);
  if (mine && known(mine.team.gb)) {
    const ours = mine.team.gb;
    const near = mine.teams.filter((t) => t.team_id !== orgId && known(t.gb))
      .map((t) => ({ id: t.team_id, by: Math.abs(t.gb! - ours) }))
      // The served order breaks a tie (OOTP's own place in the division)
      .reduce<{ id: number; by: number } | null>((best, x) => (best === null || x.by < best.by ? x : best), null);
    if (near) return { team: near.id, by: 'closest' };
  }
  return { team: opponents[0], by: 'first' };
}

export function usVsThemOf(v: OfficeContext, orgId: number, team: number | null): LeagueUsVsThemView {
  const c = computeStandings(orgId);
  const usName = v.ctx.build.club;
  if (!c.ok) return usVsThemUnreadView(v, { teamId: orgId, name: usName }, team, refusalWords(c));
  const all = linesOf(c.body);
  const mine = all.find((x) => x.team.team_id === orgId);
  const opponentIds = all.map((x) => x.team.team_id).filter((id) => id !== orgId);
  // Our division first, then the rest in the standings' order
  const ordered = mine ? [...all.filter((x) => x.division === mine.division), ...all.filter((x) => x.division !== mine.division)] : all;
  const opponents = ordered.filter((x) => x.team.team_id !== orgId).map((x) => ({ teamId: x.team.team_id, name: x.team.team, division: x.division }));
  const chosen = team === null ? defaultOpponent(orgId, c.body, opponentIds) : { team: opponentIds.includes(team) ? team : null, by: null };

  const side = (id: number, ours: boolean): SideFacts => {
    const x = all.find((y) => y.team.team_id === id);
    const t = x?.team;
    return {
      teamId: id,
      name: t?.team ?? (ours ? usName ?? '' : ''),
      abbr: t?.abbr ?? null,
      ours,
      w: known(t?.w) ? t!.w : null,
      l: known(t?.l) ? t!.l : null,
      gb: known(t?.gb) ? t!.gb : null,
      streak: t?.streak ?? null,
      division: x?.division ?? null,
      divisionPlace: x ? divisionPlaceOf(x.team, x.teams) : null,
    };
  };
  const us = side(orgId, true);
  const base = {
    us,
    opponents,
    clubs: all.length,
    chosenBy: chosen.by,
  };
  if (chosen.team === null) {
    return usVsThemView(v, {
      ...base, them: null, measures: [], headToHead: null, series: null, scheduleWhy: null,
      themWhy: team !== null ? 'That club isn\'t one Us vs Them can set beside yours.' : 'There is no other major league club in this league to set beside yours.',
    });
  }
  const themId = chosen.team;
  const them = side(themId, false);

  // The season: the standings' own figures, each placed among the league's clubs
  const games = (t: StandingsTeam) => (known(t.g) && t.g > 0 ? t.g : known(t.w) && known(t.l) && t.w + t.l > 0 ? t.w + t.l : null);
  const seasonFigure = (f: (t: StandingsTeam) => number | null, why: string) =>
    new Map(all.map((x) => {
      const value = f(x.team);
      return [x.team.team_id, value === null ? none(why) : { value, why: null }] as const;
    }));
  const measures: Measure[] = [
    measureOf({ id: 'pct', section: 'season', label: 'Winning percentage', hint: 'Wins divided by games played', format: 'rate3', better: 'higher' },
      seasonFigure((t) => (games(t) !== null && known(t.pct) ? t.pct : null), 'No games played yet, or no record in the export'), orgId, themId),
    measureOf({ id: 'rsPerGame', section: 'season', label: 'Runs scored a game', hint: 'Runs scored divided by games played', format: 'dec2', better: 'higher' },
      seasonFigure((t) => (games(t) !== null && known(t.rs) ? t.rs / games(t)! : null), 'No runs scored or games played in the export'), orgId, themId),
    measureOf({ id: 'raPerGame', section: 'season', label: 'Runs allowed a game', hint: 'Runs allowed divided by games played', format: 'dec2', better: 'lower' },
      seasonFigure((t) => (games(t) !== null && known(t.ra) ? t.ra / games(t)! : null), 'No runs allowed or games played in the export'), orgId, themId),
    measureOf({ id: 'diff', section: 'season', label: 'Run differential', hint: 'Runs scored minus runs allowed', format: 'signed', better: 'higher' },
      seasonFigure((t) => (games(t) !== null && known(t.diff) ? t.diff : null), 'No runs scored or allowed in the export'), orgId, themId),
  ];

  // At the plate and on the mound: the clubs' season totals (the Club Profile's own reading)
  const facts = readTeamSeason(orgId);
  const clubs = new Map(facts.clubs.map((x) => [x.teamId, x]));
  for (const spec of TOTAL_LINES) {
    const figures = new Map(all.map((x) => {
      const club = clubs.get(x.team.team_id);
      if (!club) return [x.team.team_id, none('The club\'s season totals aren\'t in the export')] as const;
      const dup = club.duplicated.includes(spec.section === 'batting' ? 'batting' : spec.id === 'rotationEra' ? 'starting' : spec.id === 'bullpenEra' ? 'bullpen' : 'pitching');
      return [x.team.team_id, dup ? none('The export gives the club two season rows, so its total isn\'t known') : spec.read(club)] as const;
    }));
    measures.push(measureOf(spec, figures, orgId, themId));
  }

  // Against each other: our schedule's head-to-head and the series between us
  const schedule = computeSchedule(orgId);
  let headToHead: { w: number; l: number; rf: number; ra: number } | null = null;
  let series: Array<{ startDate: string; endDate: string; atHome: boolean; games: number; played: number; wins: number; losses: number }> | null = null;
  let scheduleWhy: string | null = null;
  if (!schedule.ok) scheduleWhy = 'The schedule isn\'t in the export.';
  else {
    const h = (schedule.body.headToHead ?? []).find((x) => x.opponentId === themId);
    headToHead = h ? { w: h.w, l: h.l, rf: h.rf, ra: h.ra } : null;
    series = schedule.body.series.filter((s) => s.oppId === themId).map((s) => ({
      startDate: s.startDate,
      endDate: s.endDate,
      atHome: s.isHome,
      games: s.games.length,
      played: s.games.filter((g) => g.played).length,
      wins: s.wins,
      losses: s.losses,
    }));
  }

  return usVsThemView(v, { ...base, them, themWhy: null, measures, headToHead, series, scheduleWhy });
}

export function usVsThemUnread(v: OfficeContext, team: number | null, why: string): LeagueUsVsThemView {
  return usVsThemUnreadView(v, { teamId: v.ctx.build.orgId, name: v.ctx.build.club }, team, why);
}
