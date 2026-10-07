/**
 * Pitching Availability (N9): who can pitch tonight, worded from what `computePitchingStaff` read (the React page's
 * `/api/pitching`): the bullpen as a rest calendar (each of the last five days' pitches, the last three days' load and
 * the availability the staff reads from it), the rotation and the starting depth. The availability reading is the
 * route's own (`bullpenStatus`): it is worded here from its code, never re-derived, and as what his workload is, never
 * an order ("sit him", D-001). A workload the export cannot show is not known, never zero (D-018).
 */
import type { Cell, Tone } from '../../contract/presentation.js';
import type { BullpenCode, PitchingStaff } from '../../pitching.js';
import { cell } from '../claim.js';
import { block, column, line, tableRow } from '../majorLeague/common.js';
import type { MlbBlock, MlbLine, MlbRow, MlbTable } from '../majorLeague/types.js';
import { PITCHING_STATS } from '../statCatalog.js';
import { ageCell, factClaim, head, plural, player, statCell, statSort, type ClubhouseContext } from './common.js';
import { fillMark, withFill } from './fill.js';
import type { MlbPitchingAvailabilityView, MlbTableSection } from './types.js';

const STAFF = 'The pitching staff\'s workload';
const stat = (key: string) => PITCHING_STATS.find((s) => s.key === key)!;

type Staff = Extract<PitchingStaff, { starterDepth: unknown[] }>;
type Reliever = Staff['bullpen'][number];
type Starter = Staff['starterDepth'][number];
type AnyArm = Reliever | Starter;

/** The calendar's days: today (the last game played) and the four before it. */
const DAYS = [4, 3, 2, 1, 0] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day `back` days before a date key (YYYYMMDD) in words ("May 3"). */
function dayBefore(key: number, back: number): string {
  const d = new Date(Date.UTC(Math.floor(key / 10000), (Math.floor(key / 100) % 100) - 1, key % 100) - back * 86_400_000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The availability reading in words, from the route's code and count, with its tone (rested, limited, down). */
function availability(code: BullpenCode | null, count: number | null, gameLog: boolean, workloadKnown = true): Cell {
  if (code === null) return cell('Not known', { tone: 'unknown', hint: 'No game has been played yet' });
  if (!gameLog && code !== 'injured') return cell('Not known', { tone: 'unknown', hint: 'The export has no game-by-game pitching log' });
  // A reading from pitches, when an outing it rests on has no pitch count, is not known (D-018), never read as 0
  if (!workloadKnown && FROM_PITCHES.has(code)) {
    return cell('Not known', { tone: 'unknown', hint: 'A recent outing\'s pitch count isn\'t in the export' });
  }
  const n = count ?? 0;
  const words: Record<BullpenCode, [string, Tone]> = {
    injured: [count ? `Out about ${n} more days` : 'Out: on the injured list', 'bad'],
    two_straight: ['Pitched the last two days', 'bad'],
    heavy_three_days: [`${n} pitches in 3 days`, 'bad'],
    heavy_today: [`${n} pitches today`, 'bad'],
    back_to_back: [`Would be back-to-back (${n} today)`, 'caution'],
    heavy_yesterday: [`${n} pitches yesterday`, 'caution'],
    busy_three_days: [`${n} pitches in 3 days`, 'caution'],
    pitched_yesterday: [`Available (${n} yesterday)`, 'good'],
    no_appearances: ['No appearances yet', 'good'],
    rested: [`Rested ${plural(n, 'day')}`, 'good'],
  };
  const [text, tone] = words[code] ?? ['Not known', 'unknown'];
  return cell(text, { tone });
}

/** The readings that rest on pitch counts (the rest rest on days, appearances or the injured list). */
const FROM_PITCHES: ReadonlySet<BullpenCode> = new Set(['heavy_three_days', 'heavy_today', 'back_to_back', 'heavy_yesterday', 'busy_three_days', 'pitched_yesterday']);

/** Rested first, then limited, then down; not known last (a null key). */
const TONE_ORDER: Record<string, number> = { good: 0, caution: 1, bad: 2 };

function healthCell(arm: AnyArm): Cell {
  if (!arm.injury) return cell('Healthy', { tone: 'good' });
  const days = arm.injury.daysLeft ? `, about ${arm.injury.daysLeft} days left` : '';
  return cell(`${arm.injury.status}${days}`, { tone: arm.injury.playable ? 'caution' : 'bad' });
}

function lastOuting(arm: AnyArm, gameLog: boolean, today: number | null): MlbLine {
  if (!gameLog) return line('His outings aren\'t in the export, so his rest and recent load are not known.', { quiet: true });
  if (!arm.lastOuting) return line('No appearance yet this season.', { quiet: true });
  const ago = arm.daysRest === null ? '' : arm.daysRest === 0 ? ' (the last game played)' : ` (${plural(arm.daysRest, 'day')} before the last game played)`;
  const date = today === null ? arm.lastOuting.date : dayBefore(today, arm.daysRest ?? 0);
  const pitches = arm.lastOutingPitches === null ? 'pitch count not in the export' : plural(arm.lastOutingPitches, 'pitch', 'pitches');
  return line(`Last outing ${date}${ago}: ${pitches}, ${plural(arm.lastOuting.outs, 'out')}`);
}

function stamina(arm: AnyArm): Cell {
  return arm.stamina === null ? cell('Not graded', { tone: 'unknown', hint: 'His stamina hasn\'t been graded' }) : cell(String(arm.stamina), { hint: 'Your scouts\' stamina grade' });
}

function bullpenTable(v: ClubhouseContext, staff: Staff): { table: MlbTable; limited: number; total: number } {
  const orgId = v.ctx.build.orgId;
  const today = staff.today;
  const gameLog = staff.gameLog;
  // Day-to-day men stay in their place (OOTP lets a manager use them); the injured list goes last, as React hides it
  const pen = [...staff.bullpen.filter((p) => p.injury?.playable !== false), ...staff.bullpen.filter((p) => p.injury?.playable === false)];
  const dayColumns = today === null ? [] : DAYS.map((back) => column(`day${back}`, dayBefore(today, back), true));
  const rows: MlbRow[] = pen.map((p) => {
    const tonight = availability(today === null ? null : (p.statusCode as BullpenCode | null), p.statusCount, gameLog, p.workloadKnown);
    const cells: Record<string, Cell> = {
      pitcher: cell(p.name),
      role: cell(p.isCloser ? 'Closer' : 'Reliever'),
      throws: cell(p.throws),
      tonight,
      p3: !gameLog
        ? cell('Not known', { tone: 'unknown' })
        : p.workloadKnown
          ? cell(String(p.pitchesLast3), { hint: 'Pitches over the last three days' })
          : cell('Not known', { tone: 'unknown', hint: 'A recent outing\'s pitch count isn\'t in the export' }),
      apps3: gameLog ? cell(String(p.appearancesLast3), { hint: 'Games pitched in the last three days' }) : cell('Not known', { tone: 'unknown' }),
      ip: statCell(stat('ip'), p.stats?.ip, p.stats, 'No line'),
      era: statCell(stat('era'), p.stats?.era, p.stats, 'No line'),
      eraPlus: statCell(stat('eraPlus'), p.stats?.eraPlus, p.stats, 'No line'),
      fip: statCell(stat('fip'), p.stats?.fip, p.stats, 'No line'),
      sv: statCell(stat('sv'), p.stats?.sv, p.stats, 'No line'),
      hld: statCell(stat('hld'), p.stats?.hld, p.stats, 'No line'),
      health: healthCell(p),
    };
    const sort: Record<string, number | string | null> = {
      pitcher: p.name, role: p.isCloser ? 0 : 1, throws: p.throws,
      tonight: tonight.tone && tonight.tone in TONE_ORDER ? TONE_ORDER[tonight.tone] : null,
      p3: gameLog && p.workloadKnown ? p.pitchesLast3 : null, apps3: gameLog ? p.appearancesLast3 : null,
      ip: statSort(p.stats?.ip), era: statSort(p.stats?.era), eraPlus: statSort(p.stats?.eraPlus), fip: statSort(p.stats?.fip),
      sv: statSort(p.stats?.sv), hld: statSort(p.stats?.hld), health: p.injury ? (p.injury.playable ? 1 : 2) : 0,
    };
    if (today !== null) {
      for (const back of DAYS) {
        const outings = p.recentOutings.filter((o) => o.daysAgo === back);
        const counted = outings.every((o) => o.pitches !== null);
        const pitches = outings.reduce((s, o) => s + (o.pitches ?? 0), 0);
        const outs = outings.reduce((s, o) => s + o.outs, 0);
        cells[`day${back}`] = !gameLog
          ? cell('Not known', { tone: 'unknown' })
          : !outings.length
            ? cell('–', { hint: 'Didn\'t pitch' })
            : counted
              ? cell(String(pitches), { hint: `${plural(pitches, 'pitch', 'pitches')}, ${plural(outs, 'out')}` })
              // He pitched, but the log doesn't carry the count: said, never a 0 (D-018)
              : cell('Pitched', { tone: 'unknown', hint: `Pitch count not in the export, ${plural(outs, 'out')}` });
        sort[`day${back}`] = gameLog && counted ? pitches : null;
      }
    }
    const detail: MlbBlock[] = [block('Tonight', [line(tonight.display, { tone: tonight.tone }), lastOuting(p, gameLog, today)])];
    return tableRow(`pen-${p.player_id}`, cells, sort, {
      player: player(p.player_id, p.name, orgId), detail: withFill(p.ratingsFill, cells, [], detail), ratingsFill: fillMark(p.ratingsFill),
    });
  });
  const limited = pen.filter((p) => p.tone !== 'ok').length;
  return {
    table: {
      columns: [
        column('pitcher', 'Pitcher'), column('role', 'Role'), column('throws', 'T'), ...dayColumns,
        column('p3', 'P/3d', true), column('apps3', 'G/3d', true), column('tonight', 'Tonight'),
        column('ip', 'IP', true), column('era', 'ERA', true), column('eraPlus', 'ERA+', true), column('fip', 'FIP', true),
        column('sv', 'SV', true), column('hld', 'HLD', true), column('health', 'Health'),
      ],
      rows,
      empty: cell('No relievers on the roster.'),
    },
    limited,
    total: pen.length,
  };
}

function starterRow(v: ClubhouseContext, p: Starter, gameLog: boolean, today: number | null, depth: boolean): MlbRow {
  const orgId = v.ctx.build.orgId;
  const rest: Cell = p.daysRest !== null
    ? cell(plural(p.daysRest, 'day'), { hint: 'Days since he last pitched' })
    : gameLog ? cell('No outing yet', { tone: 'unknown' }) : cell('Not known', { tone: 'unknown', hint: 'The export has no game-by-game pitching log' });
  const next: Cell = p.nextStartInDays === null
    ? cell('Not known', { tone: 'unknown', hint: p.projected ? 'His last start isn\'t in the export' : 'Not in the projected rotation' })
    : cell(p.nextStartInDays === 0 ? 'Next game' : `In ${plural(p.nextStartInDays, 'day')}`, { hint: 'A five-day turn from his last start' });
  const cells: Record<string, Cell> = {
    slot: p.slot === null ? cell('Depth', { tone: 'neutral' }) : cell(String(p.slot)),
    pitcher: cell(p.name),
    throws: cell(p.throws),
    age: ageCell(p.age),
    wl: !p.stats
      ? cell('No line', { tone: 'unknown' })
      : p.stats.w === null || p.stats.w === undefined || p.stats.l === null || p.stats.l === undefined
        ? cell('Not known', { tone: 'unknown', hint: 'His wins and losses aren\'t in the export' })
        : cell(`${p.stats.w}-${p.stats.l}`),
    ip: statCell(stat('ip'), p.stats?.ip, p.stats, 'No line'),
    era: statCell(stat('era'), p.stats?.era, p.stats, 'No line'),
    eraPlus: statCell(stat('eraPlus'), p.stats?.eraPlus, p.stats, 'No line'),
    fip: statCell(stat('fip'), p.stats?.fip, p.stats, 'No line'),
    whip: statCell(stat('whip'), p.stats?.whip, p.stats, 'No line'),
    k9: statCell(stat('k9'), p.stats?.k9, p.stats, 'No line'),
    stamina: stamina(p),
    rest,
    next,
    health: healthCell(p),
  };
  const sort: Record<string, number | string | null> = {
    slot: p.slot, pitcher: p.name, throws: p.throws, age: p.age ?? null, wl: statSort(p.stats?.w),
    ip: statSort(p.stats?.ip), era: statSort(p.stats?.era), eraPlus: statSort(p.stats?.eraPlus), fip: statSort(p.stats?.fip),
    whip: statSort(p.stats?.whip), k9: statSort(p.stats?.k9), stamina: p.stamina, rest: p.daysRest, next: p.nextStartInDays,
    health: p.injury ? (p.injury.playable ? 1 : 2) : 0,
  };
  const detail = withFill(p.ratingsFill, cells, ['stamina'], [block(depth ? 'Starting depth' : 'His turn', [lastOuting(p, gameLog, today)])]);
  return tableRow(`${depth ? 'depth' : 'rotation'}-${p.player_id}`, cells, sort, { player: player(p.player_id, p.name, orgId), detail, ratingsFill: fillMark(p.ratingsFill) });
}

const ROTATION_COLUMNS = [
  column('slot', '#', true), column('pitcher', 'Pitcher'), column('throws', 'T'), column('age', 'Age', true), column('wl', 'W-L', true),
  column('ip', 'IP', true), column('era', 'ERA', true), column('eraPlus', 'ERA+', true), column('fip', 'FIP', true),
  column('whip', 'WHIP', true), column('k9', 'K/9', true), column('stamina', 'Stam', true), column('rest', 'Rest', true),
  column('next', 'Next start', true), column('health', 'Health'),
];
const DEPTH_COLUMNS = [
  column('pitcher', 'Pitcher'), column('throws', 'T'), column('age', 'Age', true), column('ip', 'IP', true), column('era', 'ERA', true),
  column('eraPlus', 'ERA+', true), column('stamina', 'Stam', true), column('health', 'Status'),
];

export interface PitchingInput {
  staff: PitchingStaff | string;
}

export function pitchingAvailabilityView(v: ClubhouseContext, input: PitchingInput): MlbPitchingAvailabilityView {
  const base = head(v, 'Pitching Availability', {
    text: 'Who can pitch tonight, from each arm\'s actual pitch counts game by game',
    full: 'Rotation order comes from the save\'s own projected starters. Bullpen availability is worked out from the pitches each arm actually threw, game by game, so it reflects who can really pitch tonight rather than who has the best season line. "Today" is the last game played.',
    specialist: STAFF,
  });
  const staff = input.staff;
  if (typeof staff === 'string') return { ...base, through: null, sections: [], empty: cell(`${staff}.`) };
  if (!('starterDepth' in staff)) return { ...base, through: null, sections: [], empty: cell('No pitchers on this roster.') };
  const today = staff.today;
  const pen = bullpenTable(v, staff);
  const rule = factClaim(v, 'How availability is read', {
    specialist: STAFF,
    because: [
      { label: 'Down', value: 'He pitched the last two days, threw 50 or more pitches over three days, or 30 or more in the last game; or he is on the injured list.' },
      { label: 'Limited', value: 'He pitched in the last game, threw 30 or more the game before, or 40 or more over three days.' },
      { label: 'Rested', value: 'Anything lighter; the days since he last pitched are counted from the last game played.' },
      { label: 'Day-to-day', value: 'OOTP lets a manager use a day-to-day arm, so his workload is read like anyone\'s.' },
    ],
    unknown: staff.gameLog ? [] : ['The export has no game-by-game pitching log, so rest and recent workload are not known.'],
    how: 'policy',
    stamp: 'Common bullpen practice: stated, not fitted',
  });
  const sections: MlbTableSection[] = [
    {
      id: 'bullpen',
      title: cell('Bullpen'),
      summary: !pen.total
        ? null
        : staff.gameLog
          ? cell(`${pen.limited} of ${pen.total} limited or unavailable`, { tone: pen.limited ? 'caution' : 'neutral' })
          // Without the game log nobody's workload is known: never "0 of N" (D-018)
          : cell('Availability not known', { tone: 'unknown', hint: 'No game-by-game pitching log, so who is limited isn\'t known' }),
      table: pen.table,
      note: rule,
    },
    {
      id: 'rotation',
      title: cell('Rotation'),
      summary: null,
      table: { columns: ROTATION_COLUMNS, rows: staff.rotation.map((p) => starterRow(v, p, staff.gameLog, today, false)), empty: cell('No projected rotation in this save.') },
      note: null,
    },
  ];
  if (staff.starterDepth.length) {
    sections.push({
      id: 'depth',
      title: cell('Starting depth'),
      summary: cell('Spot starters, long men, and starters on the injured list'),
      table: { columns: DEPTH_COLUMNS, rows: staff.starterDepth.map((p) => starterRow(v, p, staff.gameLog, today, true)), empty: null },
      note: null,
    });
  }
  return {
    ...base,
    through: today === null ? null : cell(`Counting back from ${dayBefore(today, 0)}, the last game played`),
    sections,
    empty: null,
  };
}

