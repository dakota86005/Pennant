/**
 * The Morning Report's own parts in the GM's words (N6, Stage A; SWIFTUI_REBUILD.md section 3.4): the masthead's box
 * score, the lede, "How we win and lose" and the roster map, from what the reader (`morningReport.ts`) gathered.
 *
 * Pure: it words what the specialists answered and decides nothing (D-001). Objective facts on the masthead and in the
 * lede, never odds, posture or a window label (D-060); places stated with their "of N" and ties, the policy lines
 * stamped as policy (D-041, D-057); a figure the export lacks is one sentence, never a zero (D-018); control and ranges
 * are served structured, so the app computes nothing (D-056).
 */
import type { Cell, Claim, Place, Target } from '../../contract/presentation.js';
import type { ClubProfileReading, DimensionId, DimensionReading, ProfileGroup } from '../../frontOffice/clubProfile.js';
import type { WinsRange } from '../../frontOffice/rosterMap.js';
import type { ClubFacts, DivisionPlace, PitcherLine, TeamSeasonFacts } from '../../frontOffice/teamSeason.js';
import type { FarmNext } from '../../mlbEvidence.js';
import type { ControlReading, MapPitcher, MapPosition, MorningMaterial, RosterMaterial } from '../../morningReport.js';
import { basis, cell, claim, servedValue, target } from '../claim.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import { asOfCell, listWords, plural, type BuildContext } from './desk.js';
import { needText, type MajorLeagueInput } from './majorLeague.js';
import type { MlbNeed } from '../../mlbNeeds.js';
import type {
  ClubProfile, ControlTerm, DeadlineNote, FarmNextMan, GameLetter, LastFive, MissingPart, MorningParts, PlayerRef, ProbableStarter,
  ProfileDimension, ReadinessState, RosterMap, RosterNode, RunsFigure, StaffPitcher, StandingLine, TeamSeason, TonightGame, WinsValue,
} from './morningTypes.js';

// ── words ────────────────────────────────────────────────────────────────────

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** "7th", "21st", "112th". */
export function ordinal(n: number): string {
  const s = n % 100;
  const suffix = s >= 11 && s <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
const ordinalWord = (n: number) => ORDINAL_WORDS[n - 1] ?? ordinal(n);
const numberWord = (n: number) => SMALL[n] ?? String(n);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Games back as the standings write them: "2½", "½", "3". */
export function gamesWords(gb: number): string {
  const whole = Math.floor(gb + 1e-9);
  const half = gb - whole >= 0.25;
  return whole === 0 && half ? '½' : `${whole}${half ? '½' : ''}`;
}

/** Games back in a sentence: "half a game", "a game", "two and a half games". */
function gamesSentence(gb: number): string {
  const whole = Math.floor(gb + 1e-9);
  const half = gb - whole >= 0.25;
  if (whole === 0) return half ? 'half a game' : 'no games';
  if (whole === 1 && !half) return 'a game';
  if (whole === 1) return 'a game and a half';
  return `${numberWord(whole)}${half ? ' and a half' : ''} games`;
}

/** A place as the strips write it: "6th of 30", "T-26th of 30". */
export function placeWords(p: { rank: number; of: number; tiedWith: number }): string {
  return `${p.tiedWith > 0 ? 'T-' : ''}${ordinal(p.rank)} of ${p.of}`;
}

const signed = (n: number, digits = 0) => (n > 0 ? `+${n.toFixed(digits)}` : n < 0 ? `−${Math.abs(n).toFixed(digits)}` : n.toFixed(digits));
const rate3 = (v: number) => v.toFixed(3).replace(/^0(?=\.)/, '').replace(/^-0(?=\.)/, '-');

/** "Ketel Marte" to "K. Marte"; a one-word name stays as it is. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name.trim() : `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`;
}

/** OOTP's start time (1905) as "7:05 PM"; null when not a time. */
function timeWords(t: number | null): string | null {
  if (t === null || t < 0 || t >= 2400 || t % 100 >= 60) return null;
  const h = Math.floor(t / 100);
  const m = t % 100;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "May 18" from an OOTP date; null when not a date. */
function dayWords(raw: string | null): string | null {
  const m = raw ? /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw) : null;
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : null;
}

/** "Colorado Rockies' record", "Club 1's record". */
const possessive = (name: string) => (/s$/.test(name) ? `${name}'` : `${name}'s`);

/** A need in Major League Ops' own words on the desk (`needText`); a need tied to a node never counts the roster. */
const NO_ROSTER: MajorLeagueInput['overview'] = { needs: [], roster: { active: { count: null, limit: null }, fortyMan: { count: null, limit: null }, injuredList: 0 }, unknowns: [], yardsticks: { line: '', tip: '', groups: [], longMan: '' } };
const needWords = (n: MlbNeed) => needText(n, NO_ROSTER).text;

const recordWords = (w: number, l: number, t: number) => `${w}–${l}${t > 0 ? `–${t}` : ''}`;

/** A help tag cut to the HIG's length at a word, never mid-word (the full sentence is in the basis). */
function fit(text: string, max = 75): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return cut.slice(0, at > 0 ? at : max).replace(/[\s,;:·–-]+$/, '').trim();
}

// ── the source of every claim here ───────────────────────────────────────────

function source(build: BuildContext, specialist: string, sample?: string) {
  const s: { department: 'frontOffice'; specialist: string; asOf: string | null; gameDate: string | null; sample?: string } = {
    department: 'frontOffice', specialist, asOf: build.importStamp, gameDate: build.gameDate,
  };
  if (sample) s.sample = sample;
  return s;
}

const STANDINGS = 'The standings in the export';
const TOTALS = 'The clubs\' season totals in the export';
const SCHEDULE = 'The schedule in the export';
const VALUE = 'Player Value, Player Rights and Player Development';

// ── the masthead ─────────────────────────────────────────────────────────────

function divisionMembers(facts: TeamSeasonFacts, me: ClubFacts): ClubFacts[] {
  return facts.clubs.filter((c) => c.subLeagueId === me.subLeagueId && c.divisionId === me.divisionId && c.record);
}

function standingLine(build: BuildContext, facts: TeamSeasonFacts, me: ClubFacts, place: DivisionPlace): StandingLine {
  const where = place.division ? `in the ${place.division}` : 'in the league';
  const tied = place.tiedWith > 0;
  const lead = place.rank === 1;
  const text = lead
    ? tied ? `Tied for 1st ${where}` : `1st ${where}${place.gamesAhead !== null && place.gamesAhead > 0 ? ` · ${gamesWords(place.gamesAhead)} ahead` : ''}`
    : `${tied ? 'Tied for ' : ''}${ordinal(place.rank)} ${where} · ${gamesWords(place.gamesBack)} back`;
  const members = divisionMembers(facts, me).sort((a, b) => (a.record!.gb ?? 0) - (b.record!.gb ?? 0) || a.name.localeCompare(b.name));
  const lineOf = (c: ClubFacts) => {
    const r = c.record!;
    const gb = place.source === 'exported' ? r.gb ?? 0 : null;
    return `${recordWords(r.w, r.l, r.t)}${gb === null ? '' : gb === 0 ? ' · leads' : ` · ${gamesWords(gb)} back`}`;
  };
  return {
    claim: claim({
      text,
      tone: 'neutral',
      hint: 'Games back of the division\'s leader, as the standings have it',
      place: { rank: place.rank, of: place.of, tiedWith: place.tiedWith },
      basis: basis({
        because: members.slice(0, 8).map((c) => ({ label: c.teamId === me.teamId ? `${c.name} (us)` : c.name, value: lineOf(c) })),
        source: source(build, STANDINGS),
        unknown: place.source === 'records' ? ['The standings give no games back, so it is counted from the wins and losses.'] : [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
      links: [target({ kind: 'view', department: 'league', view: 'standings' })],
    }),
    gamesBack: place.gamesBack,
    gamesAhead: place.gamesAhead,
  };
}

function starterOf(line: PitcherLine | undefined, id: number | null): ProbableStarter | null {
  if (id === null || !line) return null;
  return { playerId: id, name: line.name, short: shortName(line.name), line: cell(pitcherLineWords(line, 'starter')) };
}

/** "7–4 · 3.21 ERA", "21 saves · 2.70 ERA", "3.38 ERA · 24 innings", or why there is no line. */
export function pitcherLineWords(l: PitcherLine, kind: 'starter' | 'closer' | 'reliever'): string {
  const era = l.er !== null && l.outs !== null && l.outs > 0 ? `${((l.er * 27) / l.outs).toFixed(2)} ERA` : null;
  const innings = l.outs !== null ? `${Math.floor(l.outs / 3)}${l.outs % 3 ? `.${l.outs % 3}` : ''} innings` : null;
  if (l.outs === null || l.outs === 0) return 'No major-league innings this season';
  if (kind === 'starter') {
    const wl = l.w !== null && l.l !== null ? `${l.w}–${l.l}` : null;
    return [wl, era ?? innings].filter(Boolean).join(' · ');
  }
  if (kind === 'closer' && l.saves !== null) return [plural(l.saves, 'save'), era ?? innings].filter(Boolean).join(' · ');
  return [era, innings].filter(Boolean).join(' · ');
}

function tonight(build: BuildContext, m: MorningMaterial): TonightGame | null {
  const { facts } = m;
  const next = facts.next;
  if (!next) return null;
  const home = next.home === facts.orgId;
  const oppId = home ? next.away : next.home;
  const opp = facts.clubs.find((c) => c.teamId === oppId);
  const oppName = opp?.name ?? `Club ${oppId}`;
  const time = timeWords(next.time);
  const gap = facts.currentDate ? daysBetweenRaw(facts.currentDate, next.date) : null;
  const day = gap === 0 ? (next.time !== null && next.time >= 1700 ? 'Tonight' : 'Today') : gap === 1 ? 'Tomorrow' : dayWords(next.date) ?? next.date;
  const firstOf = (teamId: number) => facts.projected.find((p) => p.teamId === teamId)?.starters[0] ?? null;
  const lines = new Map(m.starters.map((l) => [l.playerId, l]));
  const ours = starterOf(lines.get(firstOf(facts.orgId) ?? -1), firstOf(facts.orgId));
  const theirs = starterOf(lines.get(firstOf(oppId) ?? -1), firstOf(oppId));
  const brief = (s: ProbableStarter | null) => (s ? `${s.short} (${s.line.display})` : 'not projected');
  const starters = ours || theirs
    ? cell(`${brief(ours)} vs ${brief(theirs)}`, { hint: 'The probable starters, as OOTP projects them' })
    : cell(facts.projectedWhy ? 'Starters not known' : 'Starters not projected yet', { tone: 'unknown', hint: facts.projectedWhy ?? 'OOTP hasn\'t projected the starters' });
  const oppRecord = opp?.record ? cell(recordWords(opp.record.w, opp.record.l, opp.record.t), { hint: `${possessive(oppName)} record` }) : null;
  const when = cell(time ? `${day} · ${time}` : day, { hint: `${gameDateDisplay(next.date) ?? next.date}${time ? `, ${time}` : ''}` });
  const matchup = cell(`${home ? 'vs' : 'at'} ${oppName}`);
  return {
    gameId: next.gameId,
    gameDate: next.date,
    when,
    homeAway: home ? 'home' : 'away',
    opponent: { teamId: oppId, name: oppName, abbr: opp?.abbr ?? null, record: oppRecord },
    matchup,
    ours, theirs, starters,
    open: target({ kind: 'view', department: 'majorLeague', view: 'scheduleGamePlans' }),
    claim: claim({
      text: `${day}: ${matchup.display}`,
      tone: 'neutral',
      hint: 'Open the schedule and game plans',
      basis: basis({
        because: [
          { label: 'Date', value: gameDateDisplay(next.date) ?? next.date },
          { label: 'Start', value: time ?? 'Not in the export' },
          { label: 'Where', value: home ? 'At home' : `At ${oppName}` },
          { label: 'Our starter', value: ours ? `${ours.name} · ${ours.line.display}` : 'Not projected' },
          { label: 'Their starter', value: theirs ? `${theirs.name} · ${theirs.line.display}` : 'Not projected' },
          ...(oppRecord ? [{ label: `${possessive(oppName)} record`, value: oppRecord.display }] : []),
        ],
        source: source(build, SCHEDULE),
        unknown: [...(ours && theirs ? [] : ['OOTP hasn\'t projected both starters, so who starts is not known.'])],
        wouldChange: ['OOTP changes its projected starters as the rotation turns over.'],
        lean: null,
        certainty: 'fact',
      }),
      links: [target({ kind: 'view', department: 'majorLeague', view: 'scheduleGamePlans' })],
    }),
  };
}

/** Days from one OOTP date to another (unpadded dates allowed); null when either is not a date. */
function daysBetweenRaw(from: string, to: string): number | null {
  const at = (raw: string) => {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = at(from);
  const b = at(to);
  return a === null || b === null ? null : Math.round((b - a) / 86_400_000);
}

function deadlineNote(build: BuildContext, facts: TeamSeasonFacts): DeadlineNote | null {
  if (!facts.deadline || !facts.currentDate) return null;
  const days = daysBetweenRaw(facts.currentDate, facts.deadline.date);
  if (days === null) return null;
  const date = gameDateDisplay(facts.deadline.date) ?? facts.deadline.date;
  const passed = days < 0;
  const count = passed ? 'Passed' : days === 0 ? 'Today' : plural(days, 'day');
  return {
    gameDate: facts.deadline.date,
    daysLeft: days,
    passed,
    count: cell(count),
    text: cell(passed ? `the deadline was ${date}` : `to the deadline · ${date}`, { hint: 'The trade deadline, as the league\'s own rules give it' }),
    claim: claim({
      text: passed ? `The trade deadline passed on ${date}` : days === 0 ? 'The trade deadline is today' : `${plural(days, 'day')} to the trade deadline`,
      tone: 'neutral',
      value: servedValue(days, 'days', count),
      basis: basis({
        because: [
          { label: 'The league\'s trade deadline', value: date },
          { label: 'The league\'s day', value: gameDateDisplay(facts.currentDate) ?? facts.currentDate },
        ],
        source: source(build, 'The league\'s rules in the export'),
        unknown: [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
      links: [],
    }),
  };
}

function runsFigure(build: BuildContext, facts: TeamSeasonFacts, me: ClubFacts, games: ReturnType<typeof clubSide>): RunsFigure | null {
  const g = me.record?.g ?? me.totals.batting?.g ?? null;
  let scored = me.totals.batting?.r ?? null;
  let allowed = me.totals.pitching?.r ?? null;
  let from = TOTALS;
  if ((scored === null || allowed === null) && games.length) {
    scored = games.reduce((s, x) => s + x.scored, 0);
    allowed = games.reduce((s, x) => s + x.allowed, 0);
    from = SCHEDULE;
  }
  if (scored === null || allowed === null) return null;
  const diff = scored - allowed;
  const per = (n: number) => (g && g > 0 ? ` · ${(n / g).toFixed(2)} a game` : '');
  let running = 0;
  const trend = games.map((x) => (running += x.scored - x.allowed)).slice(-20);
  const last20 = games.slice(-20);
  return {
    claim: claim({
      text: 'Run differential',
      tone: 'neutral',
      hint: 'Runs scored less runs allowed, this season',
      value: servedValue(diff, 'runs', signed(diff)),
      basis: basis({
        because: [
          { label: 'Runs scored', value: `${scored}${per(scored)}` },
          { label: 'Runs allowed', value: `${allowed}${per(allowed)}` },
          ...(last20.length ? [{ label: `Last ${last20.length} games`, value: signed(last20.reduce((s, x) => s + x.scored - x.allowed, 0)) }] : []),
        ],
        source: source(build, from),
        unknown: [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
      links: [target({ kind: 'view', department: 'majorLeague', view: 'seasonTrends' })],
    }),
    line: cell(`${scored} scored · ${allowed} allowed`),
    scored, allowed, diff,
    trend: trend.length >= 2 ? trend : [],
  };
}

const clubSide = (facts: TeamSeasonFacts) => {
  const out: Array<{ scored: number; allowed: number }> = [];
  for (const g of facts.games) {
    if (g.home === facts.orgId) out.push({ scored: g.homeRuns, allowed: g.awayRuns });
    else if (g.away === facts.orgId) out.push({ scored: g.awayRuns, allowed: g.homeRuns });
  }
  return out;
};

const streakWords = (n: number) => (n > 0 ? `Won ${n}` : `Lost ${Math.abs(n)}`);

/** The masthead's box score. */
export function teamSeasonWords(build: BuildContext, m: MorningMaterial): TeamSeason {
  const { facts } = m;
  const place = m.division;
  const me = facts.clubs.find((c) => c.teamId === facts.orgId) ?? null;
  const missing: MissingPart[] = [];
  const miss = (part: MissingPart['part'], line: string) => missing.push({ part, line: cell(line, { tone: 'unknown' }) });
  const today = gameDateDisplay(facts.currentDate);
  const kicker = {
    club: build.club ? cell(build.club) : null,
    today: today ? cell(today, { hint: 'The league\'s day in the export' }) : cell('Date not known', { tone: 'unknown' }),
    through: asOfCell(build),
  };
  if (!me) {
    for (const part of ['record', 'place', 'runs', 'lastFive', 'streak', 'tonight', 'deadline'] as const) miss(part, 'The club isn\'t in its league\'s clubs in the export.');
    return { kicker, record: null, place: null, runs: null, lastFive: null, streak: null, tonight: null, deadline: null, missing };
  }
  const games = clubSide(facts);
  const r = me.record;
  let record: Claim | null = null;
  if (r) {
    const homeRoad = (home: boolean) => {
      const mine = facts.games.filter((g) => (home ? g.home : g.away) === facts.orgId);
      const won = mine.filter((g) => (home ? g.homeRuns > g.awayRuns : g.awayRuns > g.homeRuns)).length;
      const lost = mine.filter((g) => (home ? g.homeRuns < g.awayRuns : g.awayRuns < g.homeRuns)).length;
      return `${won}–${lost}`;
    };
    const ten = games.slice(-10);
    record = claim({
      text: `Won ${r.w}, lost ${r.l}${r.t > 0 ? `, tied ${r.t}` : ''}`,
      tone: 'neutral',
      hint: `Won ${r.w}, lost ${r.l}${r.t > 0 ? `, tied ${r.t}` : ''}, as the standings have it`,
      value: servedValue(r.w, 'games', recordWords(r.w, r.l, r.t)),
      basis: basis({
        because: [
          { label: 'Games played', value: String(r.g) },
          ...(games.length ? [
            { label: 'At home', value: homeRoad(true) },
            { label: 'On the road', value: homeRoad(false) },
            { label: `Last ${ten.length}`, value: `${ten.filter((x) => x.scored > x.allowed).length}–${ten.filter((x) => x.scored < x.allowed).length}` },
          ] : []),
        ],
        source: source(build, STANDINGS),
        unknown: games.length ? [] : ['The export has no game-by-game results, so the home and road records are not known.'],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
      links: [target({ kind: 'view', department: 'league', view: 'standings' })],
    });
  } else miss('record', 'The standings don\'t have the club\'s record.');

  const standing = r && place ? standingLine(build, facts, me, place) : null;
  if (!standing) miss('place', r ? 'The standings don\'t give the club\'s place.' : 'The standings don\'t have the club\'s record.');

  const runs = runsFigure(build, facts, me, games);
  if (!runs) miss('runs', 'The export has no runs scored and allowed for the club.');

  let lastFive: LastFive | null = null;
  const streakN = r?.streak ?? null;
  const streak = streakN !== null && streakN !== 0 ? cell(streakWords(streakN), { hint: 'The current run of wins or losses' }) : null;
  if (games.length) {
    const five = games.slice(-5);
    const results: GameLetter[] = five.map((x) => (x.scored > x.allowed ? 'W' : x.scored < x.allowed ? 'L' : 'T'));
    const won = results.filter((x) => x === 'W').length;
    const lost = results.filter((x) => x === 'L').length;
    lastFive = {
      results,
      line: cell([streak?.display, `last ${five.length === 5 ? 'five' : numberWord(five.length)} ${won}–${lost}`].filter(Boolean).join(' · ').replace(/^last/, 'Last')),
    };
  } else miss('lastFive', facts.gamesWhy ?? 'The club hasn\'t played a game yet.');
  if (!streak) miss('streak', streakN === 0 || games.length === 0 ? 'No streak yet.' : 'The standings don\'t give the club\'s streak.');

  const next = tonight(build, m);
  if (!next) miss('tonight', facts.nextWhy ?? 'The export doesn\'t schedule the club\'s next game.');
  const deadline = deadlineNote(build, facts);
  if (!deadline) miss('deadline', facts.deadlineWhy ?? 'The league\'s day isn\'t known, so the days to the deadline aren\'t either.');

  return { kicker, record, place: standing, runs, lastFive, streak, tonight: next, deadline, missing };
}

// ── the lede ─────────────────────────────────────────────────────────────────

const LEDE_SUBJECT: Record<DimensionId, string> = {
  scoring: 'Run scoring', preventing: 'Run prevention', onBase: 'Getting on base', power: 'Hitting for power', rotation: 'The rotation',
  bullpen: 'The bullpen', defense: 'The defense', baserunning: 'Baserunning',
};

const LEDE_RULE = 'The lede says only what is on this page: the division place and games back; the first dimension, in the page\'s order, '
  + 'whose place over the last 15 games moved from its season place by a fifth of the league or more, else the club\'s best-placed strength; and '
  + 'the days to the trade deadline while it is ahead. It adds nothing that is not shown with its own basis.';

/** One or two sentences built only from facts on the page; null when there is too little to say. */
export function ledeWords(build: BuildContext, season: TeamSeason, division: DivisionPlace | null, profile: ClubProfile | null, reading: ClubProfileReading | null): Claim | null {
  const place = season.place;
  if (!place || !season.record || !division) return null;
  const sentences: string[] = [];
  const because: Array<{ label: string; value: string }> = [];
  const where = division.division ? `in the ${division.division}` : 'in the league';
  const tied = division.tiedWith > 0;
  if (division.rank === 1) {
    sentences.push(tied ? `Tied for first ${where}.` : `First ${where}${place.gamesAhead ? `, ${gamesSentence(place.gamesAhead)} ahead` : ''}.`);
  } else {
    const nth = ordinalWord(division.rank);
    sentences.push(`${tied ? `Tied for ${nth}` : capital(nth)} ${where}, ${gamesSentence(place.gamesBack)} back.`);
  }
  because.push({ label: 'Place', value: place.claim.text });

  if (profile && reading && !reading.tooEarly) {
    // The first dimension in the page's order whose recent place moved from its season place by a fifth of the league
    const moved = reading.dimensions
      .filter((d) => d.place && d.recent.place)
      .map((d) => ({ d, move: d.recent.place!.rank - d.place!.rank }))
      .find(({ d, move }) => Math.abs(move) * Math.round(1 / reading.policy.fifth) >= d.place!.of);
    if (moved) {
      const r = moved.d.recent.place!;
      const to = r.tiedWith > 0 ? `into a tie for ${ordinal(r.rank)}` : `to ${ordinal(r.rank)}`;
      sentences.push(`${LEDE_SUBJECT[moved.d.id]} has ${moved.move > 0 ? 'slipped' : 'climbed'} ${to} over the last ${numberWord(reading.policy.recentGames)}.`);
      const shown = profile.dimensions.find((x) => x.id === moved.d.id);
      because.push({ label: shown?.name ?? moved.d.id, value: `${shown?.placeText ?? ''} this season; ${shown?.recent.text ?? ''}`.trim() });
    } else {
      const best = reading.dimensions.filter((d) => d.group === 'strength' && d.place).sort((a, b) => a.place!.rank - b.place!.rank)[0];
      if (best) {
        const shown = profile.dimensions.find((x) => x.id === best.id)!;
        sentences.push(`${LEDE_SUBJECT[best.id]} is ${ordinal(best.place!.rank)} in the league.`);
        because.push({ label: shown.name, value: shown.placeText });
      }
    }
  }
  const d = season.deadline;
  if (d && !d.passed) {
    sentences.push(d.daysLeft === 0 ? 'The deadline is today.' : `The deadline is ${d.daysLeft <= 20 ? numberWord(d.daysLeft) : d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} out.`);
    because.push({ label: 'Trade deadline', value: `${d.count.display} ${d.text.display}` });
  }
  return claim({
    text: sentences.join(' '),
    tone: 'neutral',
    hint: 'Written from the facts on this page; each is below with its basis',
    basis: basis({
      because,
      source: source(build, 'The Morning Report'),
      unknown: [],
      wouldChange: [],
      lean: null,
      certainty: 'policy',
      stamp: LEDE_RULE,
    }),
    links: [],
  });
}

// ── how we win and lose ──────────────────────────────────────────────────────

const DIMENSION_WORDS: Record<DimensionId, { name: string; symbol: string; hint: string; figure: (v: number) => string; measure: string }> = {
  scoring: { name: 'Scoring runs', symbol: 'figure.baseball', hint: 'Runs scored a game', figure: (v) => `${v.toFixed(2)} runs a game`, measure: 'Runs scored over games played.' },
  preventing: { name: 'Preventing runs', symbol: 'shield', hint: 'Runs allowed a game (fewer is better)', figure: (v) => `${v.toFixed(2)} allowed a game`, measure: 'Runs allowed over games played.' },
  onBase: { name: 'Getting on base', symbol: 'figure.walk', hint: 'How often the club reaches base', figure: (v) => `${rate3(v)} on base`, measure: 'Hits, walks and hit batsmen over at-bats, walks, hit batsmen and sacrifice flies.' },
  power: { name: 'Hitting for power', symbol: 'bolt', hint: 'Extra bases an at-bat', figure: (v) => `${rate3(v)} extra bases an at-bat`, measure: 'Total bases less hits, over at-bats (isolated power).' },
  rotation: { name: 'Rotation', symbol: 'arrow.trianglehead.2.clockwise', hint: 'Starters\' earned runs a nine innings', figure: (v) => `${v.toFixed(2)} starters' ERA`, measure: 'The starters\' earned runs a nine innings.' },
  bullpen: { name: 'Bullpen', symbol: 'phone.arrow.up.right', hint: 'Relievers\' earned runs a nine innings', figure: (v) => `${v.toFixed(2)} relievers' ERA`, measure: 'The relievers\' earned runs a nine innings.' },
  defense: { name: 'Turning balls into outs', symbol: 'hand.raised', hint: 'Balls in play turned into outs', figure: (v) => `${rate3(v)} of balls in play made outs`, measure: 'One less the hits allowed in play (not home runs) over the balls put in play (batters faced less walks, hit batsmen, strikeouts and home runs).' },
  baserunning: { name: 'Baserunning', symbol: 'figure.run', hint: 'Runs gained on the bases a game', figure: (v) => `${signed(v, 2)} runs a game on the bases`, measure: 'The players\' base-running runs, summed for the club, over games played.' },
};

const GROUP_WORDS: Record<ProfileGroup, string> = { strength: 'A strength', weakness: 'A weakness', rest: 'Neither', tooEarly: 'Too early', notPlaced: 'Not placed' };

function dimensionWords(build: BuildContext, d: DimensionReading, reading: ClubProfileReading, clubs: number): ProfileDimension {
  const w = DIMENSION_WORDS[d.id];
  const recentGames = reading.policy.recentGames;
  const place: Place | null = reading.tooEarly || !d.place ? null : { rank: d.place.rank, of: d.place.of, tiedWith: d.place.tiedWith };
  const placeText = reading.tooEarly ? 'Too early' : d.place ? placeWords(d.place) : 'Not placed';
  const recentPlace: Place | null = d.recent.place && !reading.tooEarly ? { ...d.recent.place } : null;
  const recentText = recentPlace
    ? `Last ${recentGames}: ${recentPlace.tiedWith > 0 ? 'T-' : ''}${ordinal(recentPlace.rank)}`
    : `Last ${recentGames}: ${d.recent.figure.value === null && /Fewer than/.test(d.recent.why ?? '') ? 'too few' : 'not known'}`;
  const figure = d.figure.value === null ? null : w.figure(d.figure.value);
  // The league's middle only where enough clubs are placed for it to say something
  const placed = d.place?.of ?? Math.max(0, clubs - d.leftOut.length);
  const middle = d.middle === null || placed < MIDDLE_MIN_PLACED ? null : w.figure(d.middle).replace(/ (starters'|relievers') ERA$/, ' ERA');
  const detail = cell(figure ? `${figure}${middle ? ` · league middle ${middle.split(' ')[0]}` : ''}` : 'Not known', {
    tone: figure ? undefined : 'unknown',
    hint: figure ? undefined : fit(d.figure.why ?? 'The export lacks the figure'),
  });
  const because = [
    { label: 'This season', value: figure ? `${figure}${d.place ? ` · ${placeWords(d.place)}` : ''}` : d.figure.why ?? 'Not known' },
    ...(middle ? [{ label: 'League middle', value: middle }] : []),
    ...(d.tiedWith.length ? [{ label: 'Level with', value: listWords(d.tiedWith) }] : []),
    {
      label: `Last ${recentGames} games`,
      value: d.recent.figure.value !== null ? `${w.figure(d.recent.figure.value)}${recentPlace ? ` · ${placeWords(recentPlace)}` : ''}` : d.recent.why ?? 'Not known',
    },
    { label: 'How it is read', value: w.measure },
    { label: 'Where it falls', value: GROUP_WORDS[reading.tooEarly ? 'tooEarly' : d.group] },
  ];
  const unknown = [
    ...(d.leftOut.length ? [`${plural(d.leftOut.length, 'club')} not placed: ${d.leftOut.slice(0, 5).map((l) => `${l.club} (${l.why.replace(/\.$/, '')})`).join('; ')}${d.leftOut.length > 5 ? '; and others' : ''}.`] : []),
    ...(d.recent.why && !recentPlace ? [`Over the last ${recentGames} games: ${d.recent.why}`] : []),
    ...(reading.tooEarly ? [`The club has played ${reading.games ?? 'no'} games; below ${reading.policy.minGames} it is too early to call a strength or a weakness.`] : []),
  ];
  const text = `${w.name}: ${placeText}`;
  const others = Math.max(0, (d.place?.of ?? clubs) - 1);
  return {
    id: d.id,
    name: w.name,
    symbol: w.symbol,
    place,
    placeText,
    recent: { place: recentPlace, text: recentText, why: recentPlace ? null : d.recent.why },
    detail,
    group: reading.tooEarly ? 'tooEarly' : d.group,
    claim: claim({
      text,
      tone: d.figure.value === null ? 'unknown' : 'neutral',
      hint: fit(`${w.hint}, against the other ${others} clubs`),
      ...(place ? { place } : {}),
      basis: d.figure.value === null && !d.place
        ? basis({ because, source: source(build, TOTALS), unknown: [...new Set([d.figure.why ?? 'The export lacks the figure.', ...unknown])], wouldChange: [], lean: null, certainty: 'unknown' })
        : basis({ because, source: source(build, TOTALS, reading.games !== null ? plural(reading.games, 'game') : undefined), unknown: [...new Set(unknown)], wouldChange: [], lean: null, certainty: 'policy', stamp: reading.policy.stamp }),
      links: [target({ kind: 'view', department: 'majorLeague', view: 'seasonTrends' })],
    }),
  };
}

export function clubProfileWords(build: BuildContext, m: MorningMaterial): ClubProfile {
  const lines = {
    strength: cell('Top fifth of the league', { hint: 'A place in the top fifth of the clubs that have the figure' }),
    weakness: cell('Bottom fifth', { hint: 'A place in the bottom fifth of the clubs that have the figure' }),
    rest: cell('The rest', { hint: 'Neither a strength nor a weakness' }),
    tooEarly: cell('Fewer than 20 games', { hint: 'Too early to call a strength or a weakness' }),
    notPlaced: cell('Not placed', { hint: 'The export lacks the figure for the club' }),
  };
  const through = asOfCell(build).display;
  if ('why' in m.profile) {
    return { note: cell(through), lines, dimensions: [], unavailable: cell(m.profile.why, { tone: 'unknown' }) };
  }
  const reading = m.profile;
  const small = reading.clubs < Math.round(1 / reading.policy.fifth);
  return {
    note: cell(`${through}${reading.games !== null ? ` · ${plural(reading.games, 'game')}` : ''}`, {
      hint: small
        ? `With ${reading.clubs} clubs the league has no top or bottom fifth`
        : `Places among the league's ${reading.clubs} clubs`,
    }),
    lines,
    dimensions: reading.dimensions.map((d) => dimensionWords(build, d, reading, reading.clubs)),
    unavailable: null,
  };
}

// ── the roster map ───────────────────────────────────────────────────────────

const POSITIONS: Record<number, { pos: string; name: string; at: string }> = {
  2: { pos: 'C', name: 'Catcher', at: 'catcher' }, 3: { pos: '1B', name: 'First base', at: 'first base' },
  4: { pos: '2B', name: 'Second base', at: 'second base' }, 5: { pos: '3B', name: 'Third base', at: 'third base' },
  6: { pos: 'SS', name: 'Shortstop', at: 'shortstop' }, 7: { pos: 'LF', name: 'Left field', at: 'left field' },
  8: { pos: 'CF', name: 'Center field', at: 'center field' }, 9: { pos: 'RF', name: 'Right field', at: 'right field' },
  10: { pos: 'DH', name: 'Designated hitter', at: 'designated hitter' },
};
/**
 * OOTP's level numbers in words. Checked against a real save (N6 review): level 4 holds both the High-A and the Low-A
 * leagues (the Northwest, South Atlantic and Midwest with the California, Carolina and Florida State), level 5 holds
 * none, and level 6 the complex and Dominican leagues, so 4 and 5 are both "Single-A": the level number cannot tell the
 * two A levels apart, and the words never claim to.
 */
const LEVEL_WORDS: Record<number, string> = { 2: 'Triple-A', 3: 'Double-A', 4: 'Single-A', 5: 'Single-A', 6: 'Rookie ball' };

const wins1 = (v: number) => v.toFixed(1).replace(/^-0\.0$/, '0.0').replace(/^-/, '−');

function winsValue(w: WinsRange | null): WinsValue | null {
  if (!w) return null;
  return {
    low: w.low, likely: w.likely, high: w.high, unit: 'wins',
    text: `Most likely ${wins1(w.likely)} wins · could be ${wins1(w.low)} to ${wins1(w.high)}`,
    short: `${wins1(w.likely)} wins`,
  };
}

const ref = (p: { playerId: number; name: string }): PlayerRef => ({ playerId: p.playerId, name: p.name, short: shortName(p.name) });

/** Player Development's readiness against its bar, as it serves them (whole points); null where either is not known. */
function barOf(f: FarmNext): FarmNextMan['bar'] {
  const a = f.assessment;
  return a && a.readiness !== null && a.required !== null ? { readiness: Math.round(a.readiness), required: Math.round(a.required) } : null;
}

function farmMan(f: FarmNext): FarmNextMan {
  const level = LEVEL_WORDS[f.level] ?? `Level ${f.level}`;
  const a = f.assessment;
  const state: ReadinessState = !a ? 'notAssessed' : a.judgment === 'defensible' ? 'ready' : a.judgment === 'indefensible' ? 'notYet' : 'cantTell';
  const bar = barOf(f);
  const against = bar ? ` (readiness ${bar.readiness}, bar ${bar.required})` : '';
  const words: Record<ReadinessState, { text: string; hint: string }> = {
    ready: { text: 'Ready for a look', hint: `Player Development: a major-league look is defensible now${against}` },
    notYet: { text: 'Not ready yet', hint: `Player Development: not yet, by its bar${against}` },
    cantTell: { text: 'Can\'t tell yet', hint: 'Player Development can\'t judge it without more evidence' },
    notAssessed: { text: 'Not assessed', hint: 'Player Development hasn\'t assessed him for the majors' },
  };
  return {
    ...ref(f),
    level,
    state,
    readiness: cell(words[state].text, { tone: state === 'ready' ? 'good' : state === 'notYet' ? 'neutral' : 'unknown', hint: fit(words[state].hint) }),
    bar,
    text: `${shortName(f.name)} · ${level} · ${words[state].text.toLowerCase()}`,
  };
}

/**
 * Where our holder stands against the other clubs placed, told apart on the range each lands in half the time: "Clearly
 * ahead of 4 · not separable from 22 · clearly behind 3", and a universal overlap once, "Not separable from the other 29".
 */
export function separationWords(ahead: number, level: number, behind: number): string {
  const others = ahead + level + behind;
  if (others === 0) return 'The only club placed here';
  if (level === others) return `Not separable from the other ${others}`;
  if (ahead === others) return `Clearly ahead of the other ${others}`;
  if (behind === others) return `Clearly behind the other ${others}`;
  return capital([ahead ? `clearly ahead of ${ahead}` : null, level ? `not separable from ${level}` : null, behind ? `clearly behind ${behind}` : null]
    .filter(Boolean).join(' · '));
}

/** The fewest clubs placed for the league's middle to be shown (fewer, and the middle says little). */
export const MIDDLE_MIN_PLACED = 5;

/** Control as the map draws it, from Player Value's reading of Player Rights' answer (the app computes none of it). */
export function controlTerm(c: ControlReading | null): ControlTerm {
  const unknown = (text: string, hint: string): ControlTerm => ({ kind: 'unknown', text, hint, through: null, latest: null, seasonsLeft: null, atLeast: false, clock: null });
  if (!c) return unknown('Control not known', 'Player Value has no reading of his contract');
  if (c.standing === 'unsigned') return unknown('No club holds him', 'The export shows no club holding his contract');
  const { end, thisSeason } = c;
  const left = (y: number) => (thisSeason === null ? null : Math.max(1, y - thisSeason + 1));
  if (end.high === null && end.low === null) {
    if (end.heldThrough !== null) {
      return {
        kind: 'through', text: `Through ${end.heldThrough} at least`, hint: 'Held on every branch through it; the export doesn\'t settle later seasons',
        through: end.heldThrough, latest: null, seasonsLeft: left(end.heldThrough), atLeast: true, clock: null,
      };
    }
    return unknown('Control not known', 'Player Rights can\'t lay it out from the export');
  }
  if (end.laterUnknown || end.high === null) {
    const low = end.low!;
    return { kind: 'through', text: `Through ${low} at least`, hint: 'Seasons after it may be free agency; the export doesn\'t settle them', through: low, latest: null, seasonsLeft: left(low), atLeast: true, clock: null };
  }
  const low = end.low ?? end.high;
  if (end.pastHorizon) {
    return { kind: 'through', text: `Through ${end.high} at least`, hint: 'Control runs past the seasons laid out', through: end.high, latest: null, seasonsLeft: left(end.high), atLeast: true, clock: null };
  }
  if (low !== end.high) {
    return {
      kind: 'through', text: `Through ${low} or ${end.high === low + 1 ? end.high : `as late as ${end.high}`}`,
      hint: 'An option or an unsettled season decides which', through: low, latest: end.high, seasonsLeft: left(low), atLeast: false, clock: null,
    };
  }
  if (thisSeason !== null && end.high === thisSeason) {
    return { kind: 'clock', text: 'Free agent after this season', hint: 'The club\'s control ends with this season', through: end.high, latest: null, seasonsLeft: 1, atLeast: false, clock: 'freeAgentAfterSeason' };
  }
  if (c.next === 'arbitration' && c.now !== 'arbitration') {
    return { kind: 'clock', text: 'Arbitration this winter', hint: `Controlled through ${end.high}; arbitration from next season`, through: end.high, latest: null, seasonsLeft: left(end.high), atLeast: false, clock: 'arbitration' };
  }
  return { kind: 'through', text: `Through ${end.high}`, hint: 'The last season the club controls him', through: end.high, latest: null, seasonsLeft: left(end.high), atLeast: false, clock: null };
}

const NOT_VALUED_HINT = 'Not valued yet: Player Value can\'t read his production';

function nodeWords(build: BuildContext, p: MapPosition, clubs: number, part: RosterMaterial['part'], window: number): RosterNode {
  const where = POSITIONS[p.position];
  const holder = p.holder;
  const value = winsValue(holder?.wins ?? null);
  const placeText = p.place ? placeWords(p.place) : 'Not placed';
  const others = p.overlap ?? 0;
  const ahead = p.clearlyAhead.length;
  const trailing = p.clearlyBehind.length;
  const halfTime = holder?.wins?.inner != null;
  const overlapText = p.place
    ? cell(separationWords(ahead, others, trailing), { hint: 'Clubs are told apart on the range each lands in half the time' })
    : cell(holder ? 'Not placed: he isn\'t valued yet' : `Not placed: nobody plays ${where.at}`, { tone: 'unknown' });
  const behindValued = p.behind.filter((b) => b.wins);
  const behind = p.behind.length
    ? cell(p.behind.slice(0, 2).map((b) => shortName(b.name)).join(', ') + (p.behind.length > 2 ? ` and ${p.behind.length - 2} more` : ''), {
      hint: behindValued.length ? `${shortName(behindValued[0].name)}: ${wins1(behindValued[0].wins!.likely)} wins most likely` : 'Not valued yet',
    })
    : cell(`Nobody else plays ${where.at}`);
  const farm = p.farmNext ? farmMan(p.farmNext) : null;
  const farmText = farm
    ? cell(farm.text + (p.farmMore ? ` · ${p.farmMore} more there` : ''), { hint: farm.readiness.hint })
    : cell(`Nobody in the farm listed at ${where.at}`);
  const control = holder ? controlTerm(p.control)
    : { kind: 'unknown' as const, text: 'Nobody there', hint: `Nobody on the club plays ${where.at}`, through: null, latest: null, seasonsLeft: null, atLeast: false, clock: null };
  const need = p.needs.length > 0;
  const partWords = part === 'rest_of_season' ? 'the rest of this season' : 'this season';
  const stamp = holder?.stamp ?? null;
  const placed = p.place?.of ?? Math.max(0, clubs - p.leftOut.length);
  const showMiddle = p.middle !== null && placed >= MIDDLE_MIN_PLACED;
  const hb = p.holderBasis;
  const chosen = hb.rule === 'starts'
    ? `The club's regular: the most starts at ${where.at} this season (${hb.season}) among the men who started there in its last ${plural(hb.games, 'game')} (${hb.recent} of them).`
    : holder ? `Listed at ${where.at}, the club's man there with the most expected wins: ${hb.why}` : hb.why;
  const listNames = (names: string[]) => (names.length ? listWords(names.slice(0, 8)) + (names.length > 8 ? ` and ${names.length - 8} more` : '') : 'None');
  const because = [
    { label: `Expected wins, ${partWords}`, value: value?.text ?? (holder ? `Not valued: ${holder.why ?? 'not established'}` : 'Nobody there') },
    { label: `At ${where.at} in the league`, value: p.place ? `${placeText}${p.tiedWith.length ? `, level with ${listWords(p.tiedWith)}` : ''}` : 'Not placed' },
    ...(p.place ? [
      { label: 'Against the other clubs', value: overlapText.display },
      ...(ahead ? [{ label: 'Clearly ahead of', value: listNames(p.clearlyAhead) }] : []),
      ...(others && others < placed - 1 ? [{ label: 'Not separable from', value: listNames(p.overlapping) }] : []),
      ...(trailing ? [{ label: 'Clearly behind', value: listNames(p.clearlyBehind) }] : []),
      {
        label: 'How clubs are told apart',
        value: 'On the range each holder lands in half the time: two whose half-time ranges meet aren\'t said to differ. The range drawn is the one he lands in four times in five.',
      },
    ] : []),
    ...(showMiddle ? [{ label: 'League middle', value: `${wins1(p.middle!)} wins` }] : []),
    { label: 'Behind him', value: p.behind.length ? p.behind.map((b) => `${b.name}${b.wins ? ` (${wins1(b.wins.likely)})` : ' (not valued)'}`).join(', ') : 'Nobody else there' },
    { label: 'The farm\'s next man', value: farm ? `${farm.name}, ${farm.level}: ${farm.readiness.display}${farm.bar ? ` (readiness ${farm.bar.readiness} against the ${farm.bar.required} its bar asks)` : ''}` : 'Nobody listed there' },
    { label: 'How the farm\'s next man is chosen', value: `The man Player Development reads as readiest at ${where.at}, at the highest level where anyone is listed there; men it hasn't assessed follow, by name.` },
    { label: 'Control', value: control.text },
    ...(p.standing ? [{ label: 'Standing', value: p.standing }] : []),
    { label: 'Major League Ops', value: need ? p.needs.map(needWords).join('; ') : 'No need raised here' },
    { label: 'How the holder is chosen', value: chosen },
    { label: 'The same rule for every club', value: `The man now on the club with the most starts there this season, among those who started there in its last ${window} games; where the game log shows no such start, its man listed there with the most expected wins.` },
  ];
  const a = p.farmNext?.assessment ?? null;
  const unknown = [
    ...(holder && !holder.wins ? [`${holder.name} isn't valued: ${holder.why ?? 'his production is not established'}`] : []),
    ...(p.place && !halfTime ? ['Player Value served no half-time range for him, so clubs are told apart on the range drawn.'] : []),
    ...(p.leftOut.length ? [`${plural(p.leftOut.length, 'club')} not placed at ${where.at}: ${p.leftOut.slice(0, 5).map((l) => l.club).join(', ')}${p.leftOut.length > 5 ? ' and others' : ''}.`] : []),
    ...(p.listedClubs > 0 ? [`${p.listedClubs === 1 ? 'One club\'s holder' : `${p.listedClubs} clubs' holders`} at ${where.at} ${p.listedClubs === 1 ? 'is its listed man' : 'are their listed men'}: the game log shows nobody now on the club starting there lately.`] : []),
    ...(farm?.state === 'notAssessed' ? [`Player Development hasn't assessed ${farm.name} for the majors (it assesses Triple-A players with enough of a season).`] : []),
    ...(a?.judgment === 'indeterminate' ? a.missing.map((x) => `${p.farmNext!.name}: ${x}`) : []),
    ...(control.kind === 'unknown' && p.control?.end.reason ? [`Control: ${p.control.end.reason}`] : []),
  ];
  const text = holder ? `${holder.name} at ${where.at}` : `Nobody at ${where.at}`;
  return {
    pos: where.pos,
    name: where.name,
    holder: holder ? ref(holder) : null,
    holderRule: holder ? hb.rule : null,
    value,
    valueText: value?.short ?? 'Not valued',
    place: p.place ? { rank: p.place.rank, of: p.place.of, tiedWith: p.place.tiedWith, overlap: others } : null,
    placeText,
    overlap: p.place ? others : null,
    clearlyAhead: p.place ? ahead : null,
    clearlyBehind: p.place ? trailing : null,
    overlapText,
    behind,
    farmNext: farm,
    farmText,
    control,
    need,
    claim: claim({
      text,
      tone: holder && !holder.wins ? 'unknown' : 'neutral',
      hint: value ? fit(`${value.text}, ${part === 'rest_of_season' ? 'rest of season' : 'this season'}`) : holder ? NOT_VALUED_HINT : `Nobody on the club plays ${where.at}`,
      ...(p.place ? { place: { rank: p.place.rank, of: p.place.of, tiedWith: p.place.tiedWith, overlap: others } } : {}),
      basis: stamp && value
        ? basis({ because, source: source(build, VALUE, plural(clubs, 'club')), unknown: [...new Set(unknown)], wouldChange: [], lean: null, certainty: stamp.status, stamp: stamp.basis })
        : basis({ because, source: source(build, VALUE, plural(clubs, 'club')), unknown: [...new Set(unknown.length ? unknown : ['He isn\'t valued, so he isn\'t placed.'])], wouldChange: [], lean: null, certainty: 'unknown' }),
      links: [
        ...(holder ? [target({ kind: 'player', playerId: holder.playerId })] : []),
        target({ kind: 'view', department: 'majorLeague', view: 'positionPlayers' }),
      ],
    }),
  };
}

function pitcherWords(build: BuildContext, p: MapPitcher, role: string, part: RosterMaterial['part'], pen: boolean): StaffPitcher {
  const value = winsValue(p.wins);
  const kind = pen ? (p.kind === 'closer' ? 'closer' : 'reliever') : 'starter';
  const line = pitcherLineWords(p.line, kind);
  const note = p.next ? cell('Next game', { hint: 'OOTP\'s projected starter for the club\'s next game' }) : p.standing ? cell(p.standing, { tone: 'caution' }) : null;
  const partWords = part === 'rest_of_season' ? 'the rest of this season' : 'this season';
  const hint = value ? fit(`${value.text}, ${part === 'rest_of_season' ? 'rest of season' : 'this season'}`) : NOT_VALUED_HINT;
  const stamp = p.stamp ?? null;
  const because = [
    { label: 'Role', value: pen ? (p.kind === 'closer' ? 'The club\'s closer, as the export lists him' : 'Relief') : p.projected !== null ? `Projected to start ${p.projected === 0 ? 'the next game' : `the ${ordinal(p.projected + 1)} game from now`}` : 'A starter not in the projected turn' },
    { label: 'This season', value: line },
    { label: `Expected wins, ${partWords}`, value: value?.text ?? `Not valued: ${p.why ?? 'not established'}` },
    ...(p.standing ? [{ label: 'Standing', value: p.standing }] : []),
    ...(p.needs.length ? [{ label: 'Major League Ops', value: p.needs.map(needWords).join('; ') }] : []),
  ];
  return {
    playerId: p.playerId,
    role,
    name: p.name,
    short: shortName(p.name),
    line: cell(line),
    value,
    note,
    hint,
    need: p.needs.length > 0,
    claim: claim({
      text: `${p.name}, ${pen ? (p.kind === 'closer' ? 'closer' : 'reliever') : 'starter'}`,
      tone: value ? 'neutral' : 'unknown',
      hint,
      basis: stamp && value
        ? basis({ because, source: source(build, VALUE), unknown: [], wouldChange: [], lean: null, certainty: stamp.status, stamp: stamp.basis })
        : basis({ because, source: source(build, VALUE), unknown: [`${p.name} isn't valued: ${p.why ?? 'his production is not established'}`], wouldChange: [], lean: null, certainty: 'unknown' }),
      links: [target({ kind: 'player', playerId: p.playerId }), target({ kind: 'view', department: 'majorLeague', view: 'pitchingStaff' })],
    }),
  };
}

const ROTATION_ROLES = ['Next', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export function rosterMapWords(build: BuildContext, m: MorningMaterial): RosterMap {
  if ('why' in m.map) {
    return { positions: [], valueScale: null, rotation: [], bullpen: [], rotationNeeds: [], bullpenNeeds: [], notes: [], unavailable: cell(m.map.why, { tone: 'unknown' }) };
  }
  const map = m.map;
  const notes = [
    ...(map.noDh ? [cell(map.noDh)] : []),
    map.logWhy
      ? cell('Holders are each club\'s listed men: the game log doesn\'t show who starts', {
        hint: fit(`${map.logWhy} Each club's man listed there with the most expected wins.`),
      })
      : cell('Each club\'s holder is its regular: the man who\'s been starting there', {
        hint: `Most starts this season among those starting there in the last ${map.holderWindow} games`,
      }),
  ];
  return {
    positions: map.positions.map((p) => nodeWords(build, p, map.clubs, map.part, map.holderWindow)),
    valueScale: map.scale ? { low: map.scale.low, high: map.scale.high, unit: 'wins' } : null,
    rotation: map.rotation.map((p, i) => pitcherWords(build, p, ROTATION_ROLES[i] ?? ordinal(i + 1), map.part, false)),
    bullpen: map.bullpen.map((p) => pitcherWords(build, p, p.kind === 'closer' ? 'CL' : 'RP', map.part, true)),
    rotationNeeds: map.rotationNeeds.map((n) => cell(needWords(n), { tone: 'caution', hint: 'Raised by Major League Ops' })),
    bullpenNeeds: map.bullpenNeeds.map((n) => cell(needWords(n), { tone: 'caution', hint: 'Raised by Major League Ops' })),
    notes,
    unavailable: null,
  };
}

// ── all of it ────────────────────────────────────────────────────────────────

/** The Morning Report's own parts, worded; a part that cannot be worded says so and leaves the others (the defect to the log). */
export function morningWords(build: BuildContext, m: MorningMaterial): MorningParts {
  const fallback = morningUnavailable(build, 'This part couldn\'t be put together this time.');
  const guarded = <T>(what: string, run: () => T, instead: T): T => {
    try {
      return run();
    } catch (err) {
      console.error(`[front office] ${what} could not be worded:`, err);
      return instead;
    }
  };
  const teamSeason = guarded('the masthead', () => teamSeasonWords(build, m), fallback.teamSeason!);
  const clubProfile = guarded('the club profile', () => clubProfileWords(build, m), fallback.clubProfile!);
  const rosterMap = guarded('the roster map', () => rosterMapWords(build, m), fallback.rosterMap!);
  const lede = guarded('the lede', () => ledeWords(build, teamSeason, m.division, clubProfile, 'why' in m.profile ? null : m.profile), null);
  return { teamSeason, lede, clubProfile, rosterMap };
}

/** The parts when the Morning Report's reader failed as a whole: each says so. */
export function morningUnavailable(build: BuildContext, why: string): MorningParts {
  const line = cell(why, { tone: 'unknown' });
  return {
    teamSeason: {
      kicker: { club: build.club ? cell(build.club) : null, today: cell('Date not known', { tone: 'unknown' }), through: asOfCell(build) },
      record: null, place: null, runs: null, lastFive: null, streak: null, tonight: null, deadline: null,
      missing: (['record', 'place', 'runs', 'lastFive', 'streak', 'tonight', 'deadline'] as const).map((part) => ({ part, line })),
    },
    lede: null,
    clubProfile: {
      note: asOfCell(build),
      lines: {
        strength: cell('Top fifth of the league'), weakness: cell('Bottom fifth'), rest: cell('The rest'),
        tooEarly: cell('Fewer than 20 games'), notPlaced: cell('Not placed'),
      },
      dimensions: [],
      unavailable: line,
    },
    rosterMap: { positions: [], valueScale: null, rotation: [], bullpen: [], rotationNeeds: [], bullpenNeeds: [], notes: [], unavailable: line },
  };
}

