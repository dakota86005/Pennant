/**
 * Rosters (N9): one of the organization's clubs, its hitters and its pitchers, worded from `computeRoster` (the React
 * page's `/api/roster`). The scouts' grades are read as the evidence reads them (D-017, D-067: OSA's view filling in is
 * said per player); the one scouting figure is the scouts' now and ceiling, and a part they haven't graded is "not
 * scouted", never a stand-in (D-018). Every season line the React page's column picker offers is a column here: the
 * React page's defaults are shown, the rest are hidden until the GM shows them from the table's own columns.
 */
import type { Cell } from '../../contract/presentation.js';
import type { ClubRoster } from '../../roster.js';
import { cell } from '../claim.js';
import { block, column, line, tableRow } from '../majorLeague/common.js';
import type { MlbColumn, MlbRow } from '../majorLeague/types.js';
import { BATTING_STATS, CONTACT_STATS, FIELDING_STATS, PITCHING_STATS, type StatDef } from '../statCatalog.js';
import { factClaim, head, hintIf, player, statCell, statSort, type ClubhouseContext } from './common.js';
import { withFill } from './fill.js';
import type { MlbRosterChoice, MlbRostersView, MlbTableSection } from './types.js';

const ROSTER = 'The club\'s roster';

type RosterPlayer = ClubRoster['players'][number];

const DEFAULT_BATTING = ['pa', 'avg', 'obp', 'slg', 'ops', 'opsPlus', 'wrcPlus', 'hr', 'rbi', 'sb', 'war'];
const DEFAULT_PITCHING = ['g', 'gs', 'w', 'l', 'sv', 'ip', 'era', 'eraPlus', 'fip', 'whip', 'k9', 'war'];
const BATTER_RATINGS: Array<[string, string, string]> = [
  ['contact', 'Con', 'Contact'], ['gap', 'Gap', 'Gap power'], ['power', 'Pow', 'Power'], ['eye', 'Eye', 'Eye'],
  ['avoidK', 'AvK', 'Avoiding strikeouts'], ['speed', 'Spd', 'Speed'],
];
const PITCHER_RATINGS: Array<[string, string, string]> = [['stuff', 'Stu', 'Stuff'], ['movement', 'Mov', 'Movement'], ['control', 'Ctl', 'Control']];

const CONTACT_KEYS = new Set(CONTACT_STATS.map((s) => s.key));
const FIELDING_KEYS = new Set(FIELDING_STATS.map((s) => s.key));

export interface RostersInput {
  teamId: number;
  roster: ClubRoster | string;
  /** The organization's clubs, the major league club first. */
  clubs: Array<{ teamId: number; label: string; levelName: string }>;
}

function scoutedCell(s: RosterPlayer['scouted']): { cell: Cell; sort: number | null } {
  if (!s || (s.now === null && s.ceiling === null)) return { cell: cell('Not scouted', { tone: 'unknown', hint: 'Your scouts haven\'t graded his tools' }), sort: null };
  const part = (n: number | null) => (n === null ? 'not scouted' : String(n));
  return {
    cell: cell(`${part(s.now)} → ${part(s.ceiling)}`, { hint: 'His scouted tools now → at their ceiling, 20–80' }),
    sort: s.now === null ? null : s.now * 100 + (s.ceiling ?? 0),
  };
}

function standingCell(p: RosterPlayer): { cell: Cell; sort: number } {
  const s = p.standing;
  if (!s) return { cell: cell('Not in the export', { tone: 'unknown' }), sort: 9 };
  const label = s.label === 'DFA' ? 'Designated for assignment' : s.label === 'Waivers' ? 'On waivers' : s.label;
  const days = s.daysLeft ? ` · ${s.daysLeft} days left` : '';
  return { cell: cell(`${label}${days}`, { tone: s.label === 'Active' ? 'neutral' : s.available ? 'caution' : 'bad' }), sort: s.label === 'Active' ? 0 : s.available ? 1 : 2 };
}

const statsFor = (pitching: boolean): StatDef[] => (pitching ? [...PITCHING_STATS, ...FIELDING_STATS] : [...BATTING_STATS, ...CONTACT_STATS, ...FIELDING_STATS]);

function section(v: ClubhouseContext, roster: ClubRoster, pitching: boolean): MlbTableSection {
  const orgId = v.ctx.build.orgId;
  const players = roster.players.filter((p) => (p.position === 1) === pitching);
  const ratings = (pitching ? PITCHER_RATINGS : BATTER_RATINGS).filter(([k]) => roster.ratingKeys.includes(k));
  const defs = statsFor(pitching);
  const shown = new Set(pitching ? DEFAULT_PITCHING : DEFAULT_BATTING);
  const columns: MlbColumn[] = [
    column('player', 'Player'), column('age', 'Age', true), column('position', 'Pos'), column('bt', 'B/T'), column('standing', 'Standing'),
    column('scouted', 'Scouted', true),
    ...ratings.map(([k, label, name]) => ({ ...column(`rating.${k}`, label, true), title: cell(label, { hint: `Your scouts' ${name.toLowerCase()} grade` }) })),
    ...defs.map((d) => ({ ...column(`stat.${d.key}`, d.label, true), title: cell(d.label, hintIf(d.desc) ? { hint: hintIf(d.desc) } : {}), ...(shown.has(d.key) ? {} : { hidden: true }) })),
  ];
  const rows: MlbRow[] = players.map((p) => {
    const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    const stats = (pitching ? p.pitching : p.batting) as Record<string, number | null> | null;
    const scouted = scoutedCell(p.scouted);
    const standing = standingCell(p);
    const cells: Record<string, Cell> = {
      player: cell(name || 'Unnamed player'),
      age: p.age === null || p.age === undefined ? cell('Not known', { tone: 'unknown' }) : cell(String(p.age)),
      position: cell(p.positionName),
      bt: cell(`${p.batsName}/${p.throwsName}`),
      standing: standing.cell,
      scouted: scouted.cell,
    };
    const sort: Record<string, number | string | null> = {
      player: `${p.last_name ?? ''} ${p.first_name ?? ''}`.trim(), age: (p.age as number | null) ?? null, position: (p.position as number | null) ?? null,
      bt: `${p.batsName}/${p.throwsName}`, standing: standing.sort, scouted: scouted.sort,
    };
    for (const [k] of ratings) {
      const value = p.ratings[k] as number | null | undefined;
      cells[`rating.${k}`] = typeof value === 'number' ? cell(String(value)) : cell('Not graded', { tone: 'unknown' });
      sort[`rating.${k}`] = typeof value === 'number' ? value : null;
    }
    for (const d of defs) {
      const block = (FIELDING_KEYS.has(d.key) ? p.fielding : CONTACT_KEYS.has(d.key) ? p.contact : stats) as Record<string, number | null> | null;
      const value = block?.[d.key] ?? null;
      cells[`stat.${d.key}`] = statCell(d, value, block, 'No line');
      sort[`stat.${d.key}`] = statSort(value);
    }
    const a = p.assignment;
    const lines = [
      line(`Scouted ${scouted.cell.display}`, { quiet: scouted.sort === null }),
      ...(p.scouted?.missing.now.length ? [line(`Not graded now: ${p.scouted.missing.now.join(', ')}`, { quiet: true, tone: 'unknown' })] : []),
      ...(a ? [line(`${a.label}${a.note ? `: ${a.note}` : ''}`, { quiet: true })] : []),
    ];
    const detail = withFill(p.ratingsFill, cells, ['scouted', ...ratings.map(([k]) => `rating.${k}`)], [block('His card', lines)]);
    return tableRow(`${pitching ? 'pitcher' : 'hitter'}-${p.player_id}`, cells, sort, { player: player(p.player_id, name, orgId), detail });
  });
  return {
    id: pitching ? 'pitchers' : 'hitters',
    title: cell(pitching ? 'Pitchers' : 'Hitters'),
    summary: null,
    table: { columns, rows, empty: cell(pitching ? 'No pitchers on this roster.' : 'No position players on this roster.') },
    note: factClaim(v, 'What the columns mean', {
      specialist: ROSTER,
      because: [
        { label: 'Scouted', value: 'His scouted tools averaged now and at their ceiling, 20–80: your scouts\' view, never OOTP\'s own overall, which your front office can\'t see. A tool they haven\'t graded leaves the figure not scouted.' },
        { label: 'Season lines', value: 'This season, at this club\'s level only: a player who has moved between levels has a line at each, and they are never added together.' },
        ...defs.filter((d) => !hintIf(d.desc)).map((d) => ({ label: d.label, value: d.desc })),
      ],
    }),
  };
}

export function rostersView(v: ClubhouseContext, input: RostersInput): MlbRostersView {
  const base = head(v, 'Rosters', {
    text: 'Any of the organization\'s clubs: the scouts\' grades and the season\'s lines',
    full: 'A club\'s roster as OOTP lists it (the active roster and the injured list for the major league club, the full roster for an affiliate), with the scouts\' grades and this season\'s lines at that club\'s level. Show or hide season lines from the table\'s columns.',
    specialist: ROSTER,
  });
  const clubs: MlbRosterChoice[] = input.clubs.map((c) => ({
    text: cell(c.label, { hint: hintIf(c.levelName) }),
    selected: c.teamId === input.teamId,
    query: { team: c.teamId },
  }));
  const roster = input.roster;
  if (typeof roster === 'string') return { ...base, query: { team: input.teamId }, clubs, sections: [], empty: cell(`${roster}.`) };
  return {
    ...base,
    query: { team: input.teamId },
    clubs,
    sections: [section(v, roster, false), section(v, roster, true)],
    empty: roster.players.length ? null : cell('Nobody is on this roster in the export.'),
  };
}
