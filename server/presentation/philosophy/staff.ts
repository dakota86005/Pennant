/**
 * Coaching Staff, worded (N12 Track C, D-073): the club's staff, the farm's staff and who down there out-rates the
 * major-league incumbent at a seat, exactly as `computeStaff` (`server/rosterops.ts`, the route `/api/staff/:orgId`
 * serves) reads them from the export. Pure. A coach's ratings are OOTP's own 1–200 scale for coaches (the save's staff
 * facts, not a judgment of a player, D-017); the order is the export's seats, the farm's levels, and the gap the export's
 * seat ratings make, the record shown as context and never in the order.
 */
import type { Claim } from '../../contract/presentation.js';
import type { FarmStaffClub, PromotionCandidate, StaffMember, StaffReading } from '../../rosterops.js';
import { basis, cell, claim, row, servedValue, target } from '../claim.js';
import type { MlbBlock, MlbColumn, MlbRow, MlbTable } from '../majorLeague/types.js';
import { money } from '../player/words.js';
import { headOf, source, type PhilosophyContext } from './editor.js';
import type { CoachingStaffView, StaffSection } from './types.js';

const THE_EXPORT = 'The save\'s staff';
const SCALE = 'OOTP rates coaches on its own 1–200 scale; higher is better. These are the export\'s figures as stated.';

const col = (id: string, title: string, numeric = false): MlbColumn => ({ id, title: cell(title), numeric });

const fact = (ctx: PhilosophyContext, because: Array<{ label: string; value: string }>, unknown: string[] = []) => basis({
  because: because.filter((b) => b.value.trim()).length ? because.filter((b) => b.value.trim()) : [{ label: 'Read from', value: 'The imported export' }],
  source: source(ctx, THE_EXPORT), unknown, wouldChange: ['A newer export.'], lean: null, certainty: 'fact',
});

/** One rating as a line with its value on the 1–200 scale, so the app can draw it against the whole. */
function ratingClaim(ctx: PhilosophyContext, label: string, value: number | null) {
  const known = rated(value) !== null;
  return claim({
    text: `${label}: ${known ? value : 'not known'}`,
    tone: known ? 'neutral' : 'unknown',
    ...(known ? { value: servedValue(value!, 'count', String(value), { whole: 200 }) } : {}),
    links: [],
    basis: fact(ctx, [{ label, value: known ? `${value} of 200` : 'Not in the export' }, { label: 'The scale', value: SCALE }],
      known ? [] : [`${label} isn't in the export for him.`]),
  });
}

/** A rating the export states: a number on the 1–200 scale; a blank, a zero or a missing column is not known (D-018). */
const rated = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** An age as exported, or "Not known" where the export leaves it blank (never "null" or 0). */
const ageOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const ageCell = (v: unknown) => {
  const age = ageOf(v);
  return age === null ? cell('Not known', { tone: 'unknown' }) : cell(String(age));
};

/** "manager seat", "manager and hitting coach seats". */
const seatsText = (seats: readonly string[]): string => {
  const names = seats.map((s) => s.toLowerCase());
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? 'seat' : 'seats'}`;
};

function ratingsText(ratings: Array<{ label: string; value: number }>): string {
  if (ratings.length === 0) return 'No coaching ratings for this seat';
  if (ratings.every((r) => rated(r.value) === null)) return 'Not in the export';
  return ratings.map((r) => `${r.label} ${rated(r.value) ?? 'not known'}`).join(' · ');
}

const recordText = (r: { w: number; l: number } | null): string | null => (r ? `${r.w}-${r.l}` : null);

function ratingsBlock(ctx: PhilosophyContext, title: string, ratings: Array<{ label: string; value: number }>): MlbBlock {
  return { title: cell(title), player: null, chips: [], claims: ratings.map((r) => ratingClaim(ctx, r.label, r.value)), lines: [], collapsed: false };
}

const MAJOR_COLUMNS: MlbColumn[] = [
  col('role', 'Role'), col('coach', 'Coach'), col('age', 'Age', true), col('experience', 'Experience', true), col('contract', 'Contract'),
  col('ratings', 'Ratings'),
];

function majorRow(ctx: PhilosophyContext, s: StaffMember, index: number): MlbRow {
  const contract = s.salary ? `${money(s.salary)} a year · ${s.yearsLeft} ${s.yearsLeft === 1 ? 'year' : 'years'} left` : 'Not in the export';
  const coach = `${s.name}${s.formerPlayer ? ' · former player' : ''}`;
  return {
    ...row(`major-${s.coach_id}`, {
      role: cell(s.role),
      coach: cell(coach),
      age: ageCell(s.age),
      experience: typeof s.experience === 'number' && Number.isFinite(s.experience) && s.experience >= 0
        ? cell(`${s.experience} ${s.experience === 1 ? 'year' : 'years'}`)
        : cell('Not known', { tone: 'unknown' }),
      contract: cell(contract, s.salary ? {} : { tone: 'unknown' }),
      ratings: cell(ratingsText(s.ratings), s.ratings.some((r) => rated(r.value) !== null)
        ? { hint: 'OOTP\'s 1–200 scale for coaches' }
        : s.ratings.length ? { tone: 'unknown' } : {}),
    }, {
      role: index,
      coach: s.name,
      age: ageOf(s.age),
      experience: typeof s.experience === 'number' && Number.isFinite(s.experience) && s.experience >= 0 ? s.experience : null,
      contract: s.salary ? s.salary : null,
      ratings: null,
    }),
    player: null,
    detail: [ratingsBlock(ctx, `${s.role} · ${s.name}`, s.ratings)],
    actions: [],
  };
}

const READY_COLUMNS: MlbColumn[] = [
  col('coach', 'Coach'), col('now', 'Now'), col('club', 'Club'), col('seat', 'Could take over as'), col('rating', 'Rating', true), col('incumbent', 'Incumbent'),
];

function readyRow(ctx: PhilosophyContext, c: PromotionCandidate, clubIds: Map<string, number>): MlbRow {
  const teamId = clubIds.get(c.team);
  return {
    ...row(`ready-${c.coach_id}-${c.seat}`, {
      coach: cell(ageOf(c.age) === null ? c.name : `${c.name} · ${c.age}`),
      now: cell(c.currentRole),
      club: cell([c.levelName, c.team, recordText(c.record)].filter(Boolean).join(' · '), { hint: 'The record is context, not part of the order' }),
      seat: cell(c.seat),
      rating: cell(`${c.value} (+${c.gap})`, { tone: 'good', hint: `${c.gap} above the man in the seat now, on OOTP's 1–200 scale` }),
      incumbent: cell(`${c.incumbent} ${c.incumbentValue}`),
    }, {
      coach: c.name,
      now: c.currentRole,
      club: c.team,
      seat: c.seat,
      rating: c.gap,
      incumbent: c.incumbentValue,
    }, claim({
      text: `${c.name} rates ${c.value} as ${c.seat.toLowerCase()}, ${c.gap} above ${c.incumbent} (${c.incumbentValue}).`,
      tone: 'neutral',
      links: [],
      basis: fact(ctx, [
        { label: 'His rating for the seat', value: `${c.value} of 200` },
        { label: 'The man in it now', value: `${c.incumbent}, ${c.incumbentValue} of 200` },
        { label: 'How he is listed', value: 'OOTP rates every coach for every seat, not only the one he holds, so each farm coach is measured against the major-league incumbent at each seat. A gap of 10 or more is listed, largest first. His club\'s record is shown but left out of the order: a coach doesn\'t pick his roster.' },
        { label: 'The scale', value: SCALE },
      ]),
    })),
    player: null,
    detail: [],
    actions: teamId ? [{ text: cell(`Open ${c.team}`), open: target({ kind: 'club', teamId }) }] : [],
  };
}

const FARM_COLUMNS: MlbColumn[] = [
  col('club', 'Club'), col('role', 'Role'), col('coach', 'Coach'), col('age', 'Age', true),
  col('teachHitting', 'Teach Hitting', true), col('teachPitching', 'Teach Pitching', true), col('handleRookies', 'Handle Rookies', true),
];

function farmRows(ctx: PhilosophyContext, clubs: FarmStaffClub[]): MlbRow[] {
  return clubs.flatMap((club, ci) => club.coaches.map((c, j): MlbRow => {
    const rating = (label: string) => rated(c.ratings.find((r) => r.label === label)?.value);
    const shown = (v: number | null) => (v === null ? cell('Not known', { tone: 'unknown' }) : cell(String(v)));
    const th = rating('Teach Hitting');
    const tp = rating('Teach Pitching');
    const hr = rating('Handle Rookies');
    return {
      ...row(`farm-${club.team_id}-${c.coach_id}-${j}`, {
        club: cell([club.levelName, club.team, recordText(club.record)].filter(Boolean).join(' · ')),
        role: cell(c.role),
        coach: cell(c.name),
        age: ageCell(c.age),
        teachHitting: shown(th),
        teachPitching: shown(tp),
        handleRookies: shown(hr),
      }, {
        // The farm's own order: its levels, then the three seats
        club: ci,
        role: j,
        coach: c.name,
        age: ageOf(c.age),
        teachHitting: th,
        teachPitching: tp,
        handleRookies: hr,
      }),
      player: null,
      detail: [ratingsBlock(ctx, `${c.role} · ${c.name}`, c.ratings)],
      actions: [{ text: cell(`Open ${club.team}`), open: target({ kind: 'club', teamId: club.team_id }) }],
    };
  }));
}

export function coachingStaffView(ctx: PhilosophyContext, reading: StaffReading): CoachingStaffView {
  const head = headOf(ctx, 'Coaching Staff');
  const lede = claim({
    text: 'The club\'s coaches as the save has them, and who on the farm out-rates the man in a major-league seat.',
    tone: 'neutral',
    links: [],
    basis: fact(ctx, [
      { label: 'The ratings', value: SCALE },
      { label: 'What it is not', value: 'A call on who to hire or fire: the ratings are OOTP\'s, as exported, and the decision is yours.' },
    ]),
  });
  if (reading.status !== 'read') {
    return {
      ...head, lede, sections: [],
      empty: cell(reading.status === 'no_data' ? 'The export has no staff to read.' : 'The export has no staff for this club.', { tone: 'unknown' }),
    };
  }
  const clubIds = new Map(reading.farmStaff.map((c) => [c.team, c.team_id]));
  const major: MlbTable = { columns: MAJOR_COLUMNS, rows: reading.staff.map((s, i) => majorRow(ctx, s, i)), empty: cell('No major-league staff in the export.') };
  const ready: MlbTable = {
    columns: READY_COLUMNS,
    rows: reading.promotionCandidates.map((c) => readyRow(ctx, c, clubIds)),
    empty: reading.seatsUnread.length
      ? cell(`Not known for the ${seatsText(reading.seatsUnread)}: the export has no rating there to measure against.`, { tone: 'unknown' })
      : cell('Nobody on the farm out-rates a major-league coach at a seat by 10 or more.'),
  };
  const counted = reading.promotionCandidates.length
    ? `${reading.promotionCandidates.length} ${reading.promotionCandidates.length === 1 ? 'coach' : 'coaches'} out-rate a major-league incumbent`
    : null;
  // A seat nobody could be measured against is said beside the others' candidates, never left to read as nobody
  const unread = reading.seatsUnread.length && counted ? ` · not known for the ${seatsText(reading.seatsUnread)}` : '';
  const farm: MlbTable = { columns: FARM_COLUMNS, rows: farmRows(ctx, reading.farmStaff), empty: cell('No affiliate staff in the export.') };
  const sections: StaffSection[] = [
    { id: 'major', title: cell('Major League Staff'), summary: cell(`${reading.staff.length} ${reading.staff.length === 1 ? 'seat' : 'seats'} filled`), table: major, note: null },
    {
      id: 'ready',
      title: cell('Ready for a Job Up Here'),
      summary: counted
        ? cell(`${counted}${unread}`, unread ? { hint: 'No rating there to measure against: a blank or zero is not known' } : {})
        : null,
      table: ready,
      note: claim({
        text: 'Records are context and left out of the order: a coach doesn\'t pick his roster.',
        tone: 'neutral',
        links: [],
        basis: fact(ctx, [{ label: 'How the list is made', value: 'OOTP rates every coach for every seat, not only the one he holds, so each farm coach is measured against whoever has the major-league job at each seat, including seats he doesn\'t hold now. A gap of 10 or more is listed, largest first.' }]),
      }),
    },
    { id: 'farm', title: cell('Farm System Staff'), summary: cell(`${reading.farmStaff.length} ${reading.farmStaff.length === 1 ? 'affiliate' : 'affiliates'}`), table: farm, note: null },
  ];
  return { ...head, lede, sections, empty: null };
}
