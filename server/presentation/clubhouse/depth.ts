/**
 * Depth Chart (N9): the organization's players at each position, club by club, worded from `computeDepthChart` (the
 * React page's `/api/depth-chart`). The order at a position is the scouts' grade of him now, deepest first, as the React
 * page orders it; a man the scouts haven't graded is listed after every graded one (unknown, never low; D-018). The
 * grades are our scouts' (`loadScoutedAbilities`, D-017), with OSA's view filling in said per player (D-067).
 */
import type { DepthChart } from '../../org.js';
import { cell } from '../claim.js';
import { factClaim, head, player, type ClubhouseContext } from './common.js';
import { fillHint, type RatingFill } from './fill.js';
import type { MlbDepthChartView, MlbDepthClub, MlbDepthEntry, MlbDepthPosition } from './types.js';

const DEPTH = 'The depth chart';

type Player = DepthChart['players'][number];

/** The positions as the React page lists them: the staff first, then the field from catcher to designated hitter. */
const POSITIONS: Array<{ id: string; title: string; match: (p: Player) => boolean }> = [
  { id: 'SP', title: 'Starting pitchers', match: (p) => p.position === 1 && p.role === 11 },
  { id: 'RP', title: 'Relief pitchers', match: (p) => p.position === 1 && p.role !== 11 },
  { id: 'C', title: 'Catcher', match: (p) => p.position === 2 },
  { id: '1B', title: 'First base', match: (p) => p.position === 3 },
  { id: '2B', title: 'Second base', match: (p) => p.position === 4 },
  { id: '3B', title: 'Third base', match: (p) => p.position === 5 },
  { id: 'SS', title: 'Shortstop', match: (p) => p.position === 6 },
  { id: 'LF', title: 'Left field', match: (p) => p.position === 7 },
  { id: 'CF', title: 'Center field', match: (p) => p.position === 8 },
  { id: 'RF', title: 'Right field', match: (p) => p.position === 9 },
  { id: 'DH', title: 'Designated hitter', match: (p) => p.position === 10 },
];

export interface DepthInput {
  chart: DepthChart | string;
  fills: ReadonlyMap<number, RatingFill>;
  /** How grades are shown in this save (the scale's top and whether they are rounded to fives). */
  rating: { scaleMax: number; roundToFive: boolean };
}

function grade(n: number | null, rating: DepthInput['rating']): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return String(rating.roundToFive && rating.scaleMax === 80 ? Math.round(n / 5) * 5 : Math.round(n));
}

function entry(p: Player, orgId: number, input: DepthInput): MlbDepthEntry {
  const now = grade(p.cur, input.rating);
  const ceiling = grade(p.pot, input.rating);
  const graded = now === null && ceiling === null
    ? 'not scouted'
    : ceiling === null || ceiling === now ? (now ?? 'not scouted now') : `${now ?? 'not scouted now'} → ${ceiling}`;
  const c = cell(`${p.age} · ${graded}`, { hint: 'Age · the scouts\' grade now → his ceiling' });
  return { player: player(p.player_id, p.name, orgId), line: fillHint(c, input.fills.get(p.player_id) ?? null) };
}

/** Graded now, highest first; ungraded after every graded one, in the export's order. */
function deepestFirst(players: Player[]): Player[] {
  const graded = players.filter((p) => p.cur !== null && p.cur !== undefined).sort((a, b) => (b.cur ?? 0) - (a.cur ?? 0));
  return [...graded, ...players.filter((p) => p.cur === null || p.cur === undefined)];
}

export function depthChartView(v: ClubhouseContext, input: DepthInput): MlbDepthChartView {
  const base = head(v, 'Depth Chart', {
    text: 'Who plays each position at every level of the organization',
    full: 'Every player in the organization at his listed position, club by club from the major league club down, deepest first by the scouts\' grade of him now. Signings nobody has assigned yet have a column of their own rather than being hidden.',
    specialist: DEPTH,
  });
  const note = factClaim(v, 'Deepest first by the scouts\' grade now', {
    specialist: DEPTH,
    because: [
      { label: 'Position', value: 'His listed position in the export; a pitcher is a starter or a reliever by his listed role.' },
      { label: 'Order', value: 'The scouts\' grade of him now, highest first; a player the scouts haven\'t graded comes after every graded one.' },
      { label: 'Unassigned', value: 'A signing nobody has assigned yet sits on the parent club in the export with no roster spot, so he is listed apart.' },
    ],
    unknown: ['A grade the scouts haven\'t given is not known, never low.'],
  });
  const chart = input.chart;
  if (typeof chart === 'string') return { ...base, clubs: [], note, empty: cell(`${chart}.`) };
  const orgId = v.ctx.build.orgId;
  const clubs: MlbDepthClub[] = chart.teams.map((t) => {
    const mine = chart.players.filter((p) => p.team_id === t.team_id);
    const positions: MlbDepthPosition[] = POSITIONS.map((pos) => {
      const players = deepestFirst(mine.filter(pos.match)).map((p) => entry(p, orgId, input));
      return { id: pos.id, title: cell(pos.title), players, empty: players.length ? null : cell('Nobody listed here') };
    });
    return { teamId: t.team_id, title: cell(t.label.trim() || t.name), level: cell(t.levelName === 'ORG' ? 'Not assigned' : t.levelName), positions };
  });
  return { ...base, clubs, note, empty: clubs.length ? null : cell('No clubs in this organization.') };
}
