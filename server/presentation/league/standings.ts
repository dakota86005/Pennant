/**
 * League Office's Standings (N12 Track B, D-072): every major league club of the league, sub-league by sub-league and
 * division by division, worded from `computeStandings` (the React page's `/api/standings/:orgId`) with every column and
 * hover the React page has. Pure: it words what the reader (`leagueStandingsViews.ts`) hands it and reads nothing
 * (D-056).
 *
 * D-060: this is the one view where the season's odds and the deadline posture appear, as the staff's rough read: a
 * provisional number never fitted, every input in its basis, what it leaves out said on the face, and never the view's
 * headline (the lede and the race are facts only). The read's inputs reach this adapter as plain numbers: nothing here
 * imports the model that made them (`tests/presentationBoundary.test.ts`).
 */
import type { Cell } from '../../contract/presentation.js';
import type { Standings, StandingsTeam } from '../../league.js';
import { cell, servedValue } from '../claim.js';
import { factClaim, head, hintIf, plural, type ClubhouseContext } from '../clubhouse/common.js';
import { glossaryTable } from '../glossary.js';
import { clubCell, clubRow, column, officeClub, ordinal, pctText, signed } from './common.js';
import { choosable } from './office.js';
import type { LeagueStaffRead, LeagueStandingsView, OfficeRow, OfficeSection } from './types.js';

const STANDINGS = 'The standings';
const READ = 'The deadline read';

/** A place among clubs, as the reader worked it out (D-057: ties stated). */
export interface StatedPlace {
  rank: number;
  of: number;
  tiedWith: number;
}

/** Our club's place in the race, as facts: the division from the standings, the wild card from the playoff picture. */
export interface RaceFacts {
  division: string;
  /** Our place in the division by games back (level clubs share it); null before a game is played or with no games back. */
  divisionPlace: StatedPlace | null;
  divisionGb: number | null;
  /** Games clear of the nearest club in the division, when leading it. */
  divisionLead: number | null;
  /** Games played; null when the export gives neither games nor wins and losses (not known, never "none yet"). */
  gamesPlayed: number | null;
  /** How many wild cards the league gives (0: none); null when the race isn't read. */
  wildCards: number | null;
  /** `division` leading it, `wildcard` holding one, `out` otherwise; null when the race isn't read. */
  route: 'division' | 'wildcard' | 'out' | null;
  wildcardGb: number | null;
  wildcardRank: number | null;
  magicNumber: number | null;
}

/** The staff's rough read's inputs and outputs, as plain numbers (the deadline read's own, D-060). */
export interface StaffReadFacts {
  posture: 'buy' | 'lean-buy' | 'hold' | 'lean-sell' | 'sell';
  /** The chance as shown (within 1% to 99% while games are left). */
  odds: number;
  w: number;
  l: number;
  gamesPlayed: number;
  gamesLeft: number;
  rs: number;
  ra: number;
  /** The winning percentage this season's runs imply. */
  strength: number;
  /** The rival's stated strength. */
  rival: number;
  /** Wins this season's runs fit so far. */
  expectedWins: number;
  /** Games to close (negative: a cushion to defend). */
  gap: number;
  gapRead: 'race' | 'no_race' | 'no_rival';
  /** Whether the club holds a place now (the rival is then the closest chaser, not the club holding the place). */
  holding: boolean;
  /** The race in a line, as the playoff picture says it; null when not read. */
  raceSummary: string | null;
  daysToDeadline: number | null;
  deadlinePassed: boolean;
}

export interface StandingsInput {
  /** The standings, or the sentence they were refused with. */
  standings: Standings | string;
  race: RaceFacts | null;
  read: StaffReadFacts | null;
  /** Why the staff's read can't be made; null when it is made. */
  readWhy: string | null;
}

// ── the columns ─────────────────────────────────────────────────────────────

const GLOSSARY = glossaryTable();

const PACE_FULL = 'The record this club is on course for if it keeps playing at its current rate over the full schedule. It is arithmetic, not a projection: it takes no account of who is left to play, injuries, or trades.';
const MAGIC_FULL = 'Magic number: wins by this club plus losses by the closest chaser that would clinch the division. Shown only for a club that is leading; OOTP reports it for the leader alone.';

/** Each column: its title, the glossary entry it reads (the React page's hover), and a short help tag where that is long. */
const COLUMNS: ReadonlyArray<{ id: string; title: string; term: string | null; short: string; numeric: boolean; hidden?: boolean }> = [
  { id: 'team', title: 'Team', term: null, short: 'The club; yours is marked', numeric: false },
  { id: 'w', title: 'W', term: 'W', short: 'Wins', numeric: true },
  { id: 'l', title: 'L', term: 'L', short: 'Losses', numeric: true },
  { id: 'pct', title: 'Win %', term: 'PCT', short: 'Wins divided by games played', numeric: true },
  { id: 'gb', title: 'GB', term: 'GB', short: 'Games behind the division leader', numeric: true },
  { id: 'rs', title: 'RS', term: 'RS', short: 'Runs scored this season', numeric: true, hidden: true },
  { id: 'ra', title: 'RA', term: 'RA', short: 'Runs allowed this season', numeric: true, hidden: true },
  { id: 'diff', title: 'Run diff', term: 'DIFF', short: 'Runs scored minus runs allowed', numeric: true },
  { id: 'streak', title: 'Streak', term: 'STRK', short: 'Current streak: W3 is three straight wins', numeric: true },
  { id: 'pace', title: 'Pace', term: null, short: 'The record this club is on course for at its current rate', numeric: true },
  { id: 'magic', title: 'Magic #', term: null, short: 'Wins plus a chaser\'s losses that clinch the division', numeric: true },
];

const columns = () => COLUMNS.map((c) => column(c.id, c.title, c.numeric, {
  hint: hintIf(c.term ? GLOSSARY[c.term] : null) ?? c.short,
  ...(c.hidden ? { hidden: true } : {}),
}));

// ── a club's line ───────────────────────────────────────────────────────────

const notKnown = (hint: string): Cell => cell('Not known', { tone: 'unknown', hint });
const known = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** Games back as the standings write it: whole games plain, a half game as .5. */
export const gamesText = (gb: number): string => (Number.isInteger(gb) ? String(gb) : gb.toFixed(1));

/** The pace's wins over the full schedule (the React page's arithmetic); null when it can't be worked out. */
export function paceWins(t: Pick<StandingsTeam, 'pct' | 'g'>, scheduled: number | null): number | null {
  if (!known(scheduled) || scheduled <= 0 || !known(t.g) || t.g <= 0 || !known(t.pct)) return null;
  return Math.round(t.pct * scheduled);
}

/** A streak's sort key: W3 is 3, L2 is -2; none is null. */
const streakSort = (s: string): number | null => {
  const m = /^([WL])(\d+)$/.exec(s.trim());
  return m ? (m[1] === 'W' ? 1 : -1) * Number(m[2]) : null;
};

function teamRow(t: StandingsTeam, scheduled: number | null, leader: boolean): OfficeRow {
  const club = officeClub(t.team_id, t.team, t.abbr, t.isOrg);
  const played = known(t.g) ? t.g : known(t.w) && known(t.l) ? t.w + t.l : null;
  const count = (n: number | null, what: string): Cell => (known(n) ? cell(String(n)) : notKnown(`The export doesn't give the club's ${what}`));
  const pct: Cell = played === 0
    ? cell('–', { hint: 'No games played yet' })
    : known(t.pct) ? cell(pctText(t.pct)!) : notKnown('The export doesn\'t give the club\'s winning percentage');
  const gb: Cell = !known(t.gb) ? notKnown('The export doesn\'t give games back')
    : t.gb <= 0 ? cell('–', { hint: 'No games behind the division\'s leader' }) : cell(gamesText(t.gb));
  const diff: Cell = known(t.diff)
    ? cell(signed(t.diff), { tone: t.diff > 0 ? 'good' : t.diff < 0 ? 'bad' : 'neutral' })
    : notKnown('The export has no runs scored or allowed for the club');
  const streak: Cell = streakSort(t.streak) === null ? cell('–', { hint: 'No current streak in the export' }) : cell(t.streak);
  const wins = paceWins(t, scheduled);
  const pace: Cell = wins !== null
    ? cell(`${wins}–${scheduled! - wins}`, { hint: `At this rate over a ${scheduled}-game schedule` })
    : played === 0 ? cell('–', { hint: 'No games played yet' })
      : !known(scheduled) ? notKnown('The league\'s schedule length isn\'t in the export') : notKnown('The club\'s record isn\'t in the export');
  const magic: Cell = known(t.magicNumber)
    ? cell(String(t.magicNumber), { hint: 'Wins plus the chaser\'s losses that clinch it' })
    : leader ? notKnown('OOTP hasn\'t published one for this club') : cell('–', { hint: 'Shown only for a division leader' });
  return clubRow(`club-${t.team_id}`, club, {
    team: clubCell(club),
    w: count(t.w, 'wins'),
    l: count(t.l, 'losses'),
    pct,
    gb,
    rs: count(t.rs, 'runs scored'),
    ra: count(t.ra, 'runs allowed'),
    diff,
    streak,
    pace,
    magic,
  }, {
    team: club.name,
    w: known(t.w) ? t.w : null,
    l: known(t.l) ? t.l : null,
    pct: played === 0 || !known(t.pct) ? null : t.pct,
    gb: known(t.gb) ? t.gb : null,
    rs: known(t.rs) ? t.rs : null,
    ra: known(t.ra) ? t.ra : null,
    diff: known(t.diff) ? t.diff : null,
    streak: streakSort(t.streak),
    pace: wins,
    magic: known(t.magicNumber) ? t.magicNumber : null,
  });
}

/**
 * Every club of the league in one table, the React page's whole-league view (N12 Track B review, M5): a Division column
 * (its words, sorting in the served order of the divisions), then the division tables' columns, every club in the served
 * order (sub-league by sub-league, division by division, OOTP's own order within each).
 */
function allSection(s: Standings): OfficeSection {
  let order = 0;
  const rows = s.subLeagues.flatMap((sub) => sub.divisions.flatMap((d) => {
    order += 1;
    const place = order;
    return d.teams.map((t, i) => {
      const row = teamRow(t, s.scheduledGames, i === 0 && known(t.gb) && t.gb <= 0);
      return {
        ...row,
        cells: { team: row.cells.team, division: cell(d.name, s.subLeagues.length > 1 ? { hint: sub.name } : {}), ...row.cells },
        sort: { ...row.sort, division: place },
      };
    });
  }));
  const [team, ...rest] = columns();
  return {
    id: 'standings-all',
    title: cell('All divisions'),
    summary: null,
    table: choosable({
      columns: [team, column('division', 'Division', false, { hint: 'The club\'s division; sorts in the standings\' order' }), ...rest],
      rows,
      empty: cell('No major league clubs in this league\'s standings.'),
    }),
    note: null,
  };
}

function divisionSection(name: string, teams: StandingsTeam[], scheduled: number | null, id: string): OfficeSection {
  return {
    id,
    title: cell(name),
    summary: null,
    table: choosable({
      columns: columns(),
      // The served order is the standings' own (OOTP's place in the division, its tiebreakers respected)
      rows: teams.map((t, i) => teamRow(t, scheduled, i === 0 && known(t.gb) && t.gb <= 0)),
      empty: cell('No clubs in this division.'),
    }),
    note: null,
  };
}

// ── our place in the race, as facts ─────────────────────────────────────────

const games = (n: number): string => (n === 1 ? '1 game' : `${gamesText(n)} games`);
const placeText = (p: StatedPlace): string => `${p.tiedWith > 0 ? 'T-' : ''}${ordinal(p.rank)}`;

function raceClaims(v: ClubhouseContext, race: RaceFacts | null) {
  if (!race) return [];
  const out = [];
  if (race.gamesPlayed === 0) {
    out.push(factClaim(v, race.division, {
      specialist: STANDINGS,
      value: servedValue(0, 'games', 'No games played yet'),
      because: [{ label: 'Games played', value: 'None yet this season' }],
    }));
    return out;
  }
  const p = race.divisionPlace;
  const divisionWords = !p ? 'Place not known'
    : p.rank === 1 && p.tiedWith === 0 && race.divisionLead !== null && race.divisionLead > 0 ? `1st · ${games(race.divisionLead)} ahead`
      : p.rank === 1 ? `${placeText(p)} of ${p.of}`
        : `${placeText(p)} of ${p.of} · ${race.divisionGb !== null ? `${games(race.divisionGb)} back` : 'games back not known'}`;
  out.push(factClaim(v, p ? race.division : `${race.division}: place not known`, {
    specialist: STANDINGS,
    ...(p ? { value: servedValue(p.rank, 'place', divisionWords) } : {}),
    because: [
      ...(p ? [{ label: 'Place', value: `${placeText(p)} of ${p.of} in the division by games back${p.tiedWith > 0 ? `, level with ${plural(p.tiedWith, 'other club')}` : ''}` }] : []),
      ...(race.divisionGb !== null ? [{ label: 'Games back', value: race.divisionGb > 0 ? gamesText(race.divisionGb) : 'None' }] : []),
      ...(race.divisionLead !== null ? [{ label: 'Lead over the next club', value: games(race.divisionLead) }] : []),
    ],
    unknown: [
      ...(p ? [] : ['The export doesn\'t give the club\'s games back.']),
      ...(race.gamesPlayed === null ? ['The export doesn\'t give the club\'s games played.'] : []),
    ],
  }));
  if (race.wildCards !== null && race.wildCards > 0 && race.route !== 'division') {
    const words = race.route === 'wildcard'
      ? `Holding the ${ordinal(race.wildcardRank ?? 1)} of ${race.wildCards}${race.wildcardGb !== null ? ` · ${games(Math.abs(race.wildcardGb))} clear` : ''}`
      : race.wildcardGb !== null
        ? `${games(race.wildcardGb)} back of the last place${race.wildcardRank !== null ? ` · ${ordinal(race.wildcardRank)} in line` : ''}`
        : 'Not in a place';
    out.push(factClaim(v, 'The wild card', {
      specialist: STANDINGS,
      value: servedValue(race.wildcardGb ?? 0, 'games', words),
      because: [
        { label: 'Wild cards', value: `This league gives ${plural(race.wildCards, 'wild card')}` },
        { label: 'How it is counted', value: 'Among the clubs of the sub-league not leading a division, by winning percentage; games back of the last club in a place, or clear of the first club out.' },
      ],
    }));
  }
  if (race.magicNumber !== null) {
    out.push(factClaim(v, 'Magic number', {
      specialist: STANDINGS,
      value: servedValue(race.magicNumber, 'games', String(race.magicNumber)),
      because: [{ label: 'Magic number', value: MAGIC_FULL }],
    }));
  }
  return out;
}

// ── the staff's rough read (D-060) ──────────────────────────────────────────

/** The posture in the staff's voice: a description of how they read the club, never an instruction (D-001). */
const POSTURE_WORDS: Readonly<Record<StaffReadFacts['posture'], string>> = {
  buy: 'reads the club as a buyer',
  'lean-buy': 'leans toward buying',
  hold: 'hasn\'t decided yet',
  'lean-sell': 'leans toward selling',
  sell: 'reads the club as a seller',
};

const READ_STAMP = 'Provisional: a stated model, never fitted on this save';
const LEAVES_OUT = [
  'Injuries: who is hurt, and for how long.',
  'The roster as it stands: the read sees only the runs this season.',
  'The strength of the schedule left.',
  'More than one rival: the race is read as two clubs.',
  'Trades still to come.',
];

function staffRead(v: ClubhouseContext, r: StaffReadFacts): LeagueStaffRead {
  const chance = `${Math.round(r.odds * 100)}%`;
  const diff = r.rs - r.ra;
  const gapWords = r.gapRead === 'no_race'
    ? 'Not in a race the read can follow, so counted as level'
    : r.gapRead === 'no_rival'
      ? 'Nobody outside the place to measure against, so read as one game clear'
      : r.gap > 0 ? `${games(r.gap)} to close` : r.gap < 0 ? `${games(-r.gap)} clear, to defend` : 'Level with the place';
  const deadlineWords = r.deadlinePassed ? 'The trade deadline has passed'
    : r.daysToDeadline !== null ? `${plural(r.daysToDeadline, 'day')} to the trade deadline` : 'No trade deadline in the export';
  const because = [
    { label: 'Record', value: `${r.w}–${r.l} in ${plural(r.gamesPlayed, 'game')}` },
    { label: 'Runs', value: `${r.rs} scored, ${r.ra} allowed (${signed(diff)})` },
    { label: 'Strength read from the runs', value: `A ${pctText(r.strength)} club (Pythagorean expectation, exponent 1.83): over a season a club's runs say more about what comes next than its record does.` },
    {
      label: 'The rival',
      value: `A ${pctText(r.rival)} club, a stated strength never fitted on this save${r.gapRead === 'no_race' ? '' : r.holding ? ': the closest chaser, the club nearest to taking the place' : ': the club holding the place in question'}.`,
    },
    { label: 'The gap', value: gapWords },
    { label: 'Games left', value: String(r.gamesLeft) },
    { label: 'How the chance is worked out', value: 'Over the games left, the difference in wins between the two clubs is read as roughly normal; it is shown between 1% and 99% while games are left.' },
  ];
  const odds = factClaim(v, `The staff's rough read: about ${chance} to reach the postseason`, {
    specialist: READ,
    how: 'provisional',
    stamp: READ_STAMP,
    value: servedValue(r.odds, 'share', chance),
    because,
    unknown: LEAVES_OUT,
    wouldChange: ['A read built from the roster, planned to replace this one.'],
  });
  const posture = factClaim(v, `${r.deadlinePassed ? 'With the deadline passed, the staff\'s rough read of the season' : 'The staff\'s rough read at the deadline'} ${POSTURE_WORDS[r.posture]}`, {
    specialist: READ,
    how: 'provisional',
    stamp: READ_STAMP,
    because: [
      { label: 'The chance it rests on', value: chance },
      { label: 'Where the lines fall', value: 'At 75% or better the staff read the club as a buyer; at 55%, leaning toward buying; at 25%, undecided; at 10%, leaning toward selling; below that, as a seller. Lines stated by the staff, not fitted.' },
      { label: 'The deadline', value: deadlineWords },
      ...because,
    ],
    unknown: LEAVES_OUT,
    wouldChange: ['A read built from the roster, planned to replace this one.'],
  });
  const raceLine = r.gapRead === 'race' && r.raceSummary ? r.raceSummary.replace(/\.$/, '').replace(/ — /g, ': ') : gapWords;
  return {
    title: cell('The staff\'s rough read', { hint: 'A rough model, never fitted on this save: open it for what it uses' }),
    odds,
    posture,
    reasons: [
      cell(`${r.w}–${r.l}, ${r.rs} runs scored and ${r.ra} allowed (${signed(diff)})`),
      cell(`The runs fit about ${Math.round(r.expectedWins)} wins so far; the club has ${r.w}`),
      cell(raceLine),
      cell(`${plural(r.gamesLeft, 'game')} left`),
      cell(deadlineWords),
    ],
    caveat: cell('A rough read: it leaves out injuries, the roster, the schedule left and every rival but one.', { tone: 'caution' }),
  };
}

// ── the view ────────────────────────────────────────────────────────────────

function base(v: ClubhouseContext, race: RaceFacts | null) {
  const ours = race && race.gamesPlayed !== 0 && race.divisionPlace
    ? `; yours is ${placeText(race.divisionPlace)} in the ${race.division}${race.divisionGb !== null && race.divisionGb > 0 ? `, ${games(race.divisionGb)} back` : ''}`
    : '';
  return head(v, 'Standings', {
    text: `Every club's record, division by division${ours}`,
    full: 'Full league standings. Run differential is runs scored minus runs allowed: over a season it predicts future record better than the record itself does. Pace is the record a club is on course for at its current rate; the magic number is shown for a division leader.',
    specialist: STANDINGS,
  });
}

function note(v: ClubhouseContext) {
  return factClaim(v, 'How to read the standings', {
    specialist: STANDINGS,
    because: [
      ...COLUMNS.filter((c) => c.term && GLOSSARY[c.term]).map((c) => ({ label: c.title, value: GLOSSARY[c.term!] })),
      { label: 'Pace', value: PACE_FULL },
      { label: 'Magic #', value: MAGIC_FULL },
      { label: 'Order', value: 'Each division in OOTP\'s own order, its tiebreakers respected.' },
    ],
  });
}

export function standingsView(v: ClubhouseContext, input: StandingsInput): LeagueStandingsView {
  const s = input.standings;
  if (typeof s === 'string') return standingsUnreadView(v, s);
  const groups = s.subLeagues.map((sub, i) => ({
    title: cell(sub.name),
    divisions: sub.divisions.map((d, j) => divisionSection(d.name, d.teams, s.scheduledGames, `standings-${i + 1}-${j + 1}`)),
  }));
  const any = groups.some((g) => g.divisions.some((d) => d.table.rows.length));
  return {
    ...base(v, input.race),
    all: any ? allSection(s) : null,
    groups,
    race: raceClaims(v, input.race),
    staffRead: input.read ? staffRead(v, input.read) : null,
    ...(input.read ? {} : { staffReadWhy: cell(input.readWhy ?? 'The staff\'s rough read can\'t be made for this club.', { tone: 'unknown' }) }),
    note: note(v),
    empty: any ? null : cell('No major league clubs in this league\'s standings.'),
  };
}

/** The standings when they couldn't be read: the sentence why, nothing else. */
export function standingsUnreadView(v: ClubhouseContext, why: string): LeagueStandingsView {
  const text = /[.!?]$/.test(why.trim()) ? why.trim() : `${why.trim()}.`;
  return { ...base(v, null), all: null, groups: [], race: [], staffRead: null, note: note(v), empty: cell(text) };
}
