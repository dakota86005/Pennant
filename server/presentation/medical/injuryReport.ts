/**
 * Medical's Injury Report for the Mac app (N12, D-071): every injured player in the organization, majors to rookie
 * ball, as the trainer's report lists them (`orgInjuries`, read through `health.ts`'s one rule for who is hurt). The
 * React page's words (`src/pages/Injuries.tsx` and its column tips) are served here; a date the export doesn't give is
 * said to be missing, never a dash read as zero (D-018). Pure: it words what it is handed.
 */
import type { orgInjuries } from '../../dashboard.js';
import type { Cell, Claim } from '../../contract/presentation.js';
import { cell, claim, servedValue } from '../claim.js';
import {
  column, counted, fact, filterChoice, hintIf, officeFacts, officeHead, officeLede, officePlayer, officeRow,
  type OfficeContext, type OfficeFilterGroup, type OfficeTable, type OfficeViewHead,
} from '../officeTable.js';

type Injury = ReturnType<typeof orgInjuries>[number];

/** The Injury Report: the figures, every injured player as a table, and what the export doesn't say. */
export interface MedicalInjuryReportView extends OfficeViewHead {
  figures: Claim[];
  table: OfficeTable;
  /** Narrowing the table by level (the major league club, the farm). */
  filters: OfficeFilterGroup[];
  /** What the report can't see, as short sentences; empty when nothing is missing. */
  unknowns: Cell[];
}

const SPECIALIST = 'The injury report';

/** The levels in the organization's order, the major league club first. */
const LEVEL_ORDER = ['MLB', 'AAA', 'AA', 'A', 'R'];

const STATUS: Record<string, { text: string; hint: string }> = {
  'IL-60': { text: '60-day IL', hint: 'On the 60-day injured list' },
  IL: { text: 'Injured list', hint: 'On the injured list' },
  'Day-to-day': { text: 'Day-to-day', hint: 'Day-to-day' },
  Injured: { text: 'Injured', hint: 'Injured, and not on an injured list' },
};

/** The column tips the React page's headings carried (its glossary), in the lede's basis. */
const COLUMN_WORDS = [
  { label: 'Player', value: 'Every name opens his own window: ratings, contract, career and injuries.' },
  { label: 'Age', value: "The player's age as of this point in the season. OOTP ages players on their real birthday, so an age-27 season may end at 28." },
  { label: 'Pos', value: 'Primary fielding position, the one OOTP lists him at.' },
  { label: 'Club', value: 'His level and club: for a minor leaguer, the affiliate, not the parent club.' },
  { label: 'Status', value: 'The injured list he is on, or day-to-day. A day-to-day player on the active roster can play through it: that is the manager\'s call.' },
  { label: 'Back in', value: 'Estimated days until he is back. OOTP revises this as the injury progresses.' },
  { label: 'IL days this season', value: 'Days spent on the injured list this season.' },
];

function backIn(days: number | null): { cell: Cell; sort: number | null } {
  if (days === null) return { cell: cell('Not given', { tone: 'unknown', hint: "The export doesn't say when he is due back" }), sort: null };
  if (days <= 0) return { cell: cell('Due back now'), sort: 0 };
  return { cell: cell(`About ${counted(days, 'day')}`, { hint: 'OOTP revises this as the injury progresses' }), sort: days };
}

export function injuryReportView(ctx: OfficeContext, injuries: readonly Injury[]): MedicalInjuryReportView {
  const rows = injuries.map((p) => {
    const playerId = Number(p.player_id);
    const status = STATUS[p.status] ?? { text: String(p.status), hint: 'Injured' };
    const dayToDay = p.status === 'Day-to-day';
    const playable = (p as { playable?: boolean }).playable === true;
    const back = backIn(p.daysLeft ?? null);
    const level = String(p.levelName);
    const ilDays = p.dlDaysThisYear === null || p.dlDaysThisYear === undefined ? null : Number(p.dlDaysThisYear);
    const position = p.positionName && p.positionName !== '?' ? String(p.positionName) : null;
    const statusHint = dayToDay && playable ? 'On the active roster: he can play through it' : status.hint;
    const cells: Record<string, Cell> = {
      player: cell(String(p.name)),
      age: p.age === null || p.age === undefined ? cell('Not given', { tone: 'unknown', hint: "His age isn't in the export" }) : cell(String(p.age)),
      position: position ? cell(position) : cell('Not given', { tone: 'unknown', hint: "His position isn't in the export" }),
      club: cell(`${level} · ${p.team}`),
      status: cell(status.text, { tone: dayToDay ? 'neutral' : 'caution', hint: hintIf(statusHint) }),
      back: back.cell,
      ilDays: ilDays === null ? cell('Not given', { tone: 'unknown', hint: "The export doesn't say how long he has spent on the list" }) : cell(String(ilDays)),
    };
    const levelRank = LEVEL_ORDER.indexOf(level);
    return officeRow(`injury-${playerId}`, cells, {
      player: String(p.name),
      age: typeof p.age === 'number' ? p.age : null,
      position,
      club: levelRank >= 0 ? levelRank : null,
      status: dayToDay ? 0 : p.status === 'Injured' ? 1 : p.status === 'IL' ? 2 : 3,
      back: back.sort,
      ilDays,
    }, {
      player: officePlayer(playerId, String(p.name), ctx.orgId),
      facts: [
        fact('Status', status.hint),
        fact('Back in', back.cell.display, back.cell.hint),
        ...(dayToDay ? [fact('Can he play?', playable ? 'Yes: he is on the active roster, so it is the manager\'s call' : 'Not while he is off the active roster')] : []),
        fact('Club', `${level} · ${p.team}`),
        fact('Injured list this season', ilDays === null ? 'Not in the export' : counted(ilDays, 'day')),
      ],
    });
  });

  const all = injuries.length;
  const majors = injuries.filter((p) => p.levelName === 'MLB').length;
  const dayToDay = injuries.filter((p) => p.status === 'Day-to-day').length;
  const noDate = injuries.filter((p) => p.daysLeft === null).length;
  const fact1 = (label: string, value: number) => officeFacts(ctx, SPECIALIST, [{ label, value: String(value) }]);
  const figures = [
    claim({ text: 'Injured', tone: 'neutral', value: servedValue(all, 'count', String(all)), basis: fact1('Injured in the organization', all) }),
    claim({ text: 'With the major league club', tone: 'neutral', value: servedValue(majors, 'count', String(majors)), basis: fact1('Injured major leaguers', majors) }),
    claim({ text: 'Day-to-day', tone: 'neutral', value: servedValue(dayToDay, 'count', String(dayToDay)), basis: fact1('Playing through it or day-to-day', dayToDay) }),
  ];

  const levels = LEVEL_ORDER.filter((l) => injuries.some((p) => p.levelName === l));
  const filters: OfficeFilterGroup[] = levels.length > 1
    ? [{
        id: 'level',
        title: cell('Level'),
        choices: [
          filterChoice('all', cell('Every level'), rows.map((r) => r.id)),
          ...levels.map((l) => filterChoice(l, cell(l === 'MLB' ? 'Major league club' : l), rows.filter((_, i) => injuries[i].levelName === l).map((r) => r.id))),
        ],
      }]
    : [];

  const lede = officeLede(ctx, SPECIALIST, 'Every injured player in the organization, majors to rookie ball', COLUMN_WORDS,
    noDate > 0 ? [`The export has no return date for ${counted(noDate, 'injured player')}.`] : []);
  return {
    ...officeHead(ctx, 'Injury Report', lede, SPECIALIST),
    figures,
    table: {
      columns: [
        column('player', 'Player'),
        column('age', 'Age', { numeric: true }),
        column('position', 'Pos'),
        column('club', 'Club'),
        column('status', 'Status'),
        column('back', 'Back in', { numeric: true }),
        column('ilDays', 'IL days this season', { numeric: true }),
      ],
      rows,
      empty: cell('Everyone is healthy across the organization.'),
    },
    filters,
    unknowns: noDate > 0 ? [cell(`The export has no return date for ${counted(noDate, 'injured player')}.`)] : [],
  };
}
