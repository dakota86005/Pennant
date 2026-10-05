/**
 * Schedule & Game Plans (N9): the season's games, worded from `computeSchedule` (the React page's `/api/schedule`), and
 * one game's plan from `computeGamePlan` (`/api/game-plan`) with the lineup card for the starter's hand. Every word the
 * React page and its game plan wrote on the client is served. An opponent's record is the standings' fact; nothing
 * here is odds or a posture (D-060). A plan is the staff's preparation, never an order (D-001), and every head-to-head
 * line carries its sample.
 */
import type { Cell } from '../../contract/presentation.js';
import type { GamePlan } from '../../gameplan.js';
import type { LineupCard } from '../../lineup.js';
import type { Schedule } from '../../schedule.js';
import { cell, servedValue } from '../claim.js';
import { block, column, line, tableRow } from '../majorLeague/common.js';
import type { MlbRow } from '../majorLeague/types.js';
import { ageWords, dayOrder, dayWords, factClaim, HAND_WORDS, head, plural, player, type ClubhouseContext } from './common.js';
import type { MlbGamePlanView, MlbScheduleView, MlbTableSection } from './types.js';

const SCHEDULE = 'The schedule';
const PLAN = 'The game plan';

type Full = Extract<Schedule, { nextSeriesIndex: number }>;
const isFull = (s: Schedule): s is Full => typeof (s as { nextSeriesIndex?: unknown }).nextSeriesIndex === 'number';
type Game = Full['series'][number]['games'][number];

export const gameRowId = (gameId: number): string => `game-${gameId}`;

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

function recordFigures(v: ClubhouseContext, s: Full) {
  const r = s.record;
  if (!r || r.w + r.l === 0) return [];
  const diff = r.runsFor - r.runsAgainst;
  return [
    factClaim(v, 'Record', { specialist: SCHEDULE, value: servedValue(r.w, 'wins', `${r.w}–${r.l}`), because: [{ label: 'Won', value: String(r.w) }, { label: 'Lost', value: String(r.l) }] }),
    factClaim(v, 'Home and away', { specialist: SCHEDULE, value: servedValue(r.w, 'wins', `${r.home} home · ${r.away} away`), because: [{ label: 'At home', value: r.home }, { label: 'Away', value: r.away }] }),
    factClaim(v, 'Runs', {
      specialist: SCHEDULE,
      tone: diff > 0 ? 'good' : diff < 0 ? 'bad' : 'neutral',
      value: servedValue(diff, 'runs', `${r.runsFor} scored · ${r.runsAgainst} allowed (${signed(diff)})`),
      because: [{ label: 'Scored', value: String(r.runsFor) }, { label: 'Allowed', value: String(r.runsAgainst) }],
    }),
  ];
}

function headToHead(s: Full): MlbTableSection | null {
  const rows = (s.headToHead ?? []).map((h): MlbRow => {
    const diff = h.rf - h.ra;
    return tableRow(`club-${h.opponentId}`, {
      opponent: cell(h.opponent),
      record: cell(`${h.w}–${h.l}`, { tone: h.w > h.l ? 'good' : h.l > h.w ? 'bad' : 'neutral' }),
      runs: cell(`${h.rf}–${h.ra}`, { hint: 'Runs scored and allowed against them' }),
      diff: cell(signed(diff), { tone: diff > 0 ? 'good' : diff < 0 ? 'bad' : 'neutral' }),
    }, { opponent: h.opponent, record: h.w - h.l, runs: h.rf, diff });
  });
  if (!rows.length) return null;
  return {
    id: 'headToHead',
    title: cell('Against each opponent'),
    summary: null,
    table: {
      columns: [column('opponent', 'Opponent'), column('record', 'W–L', true), column('runs', 'Runs', true), column('diff', '+/−', true)],
      rows,
      empty: null,
    },
    note: null,
  };
}

function starterCell(starter: Game['ourStarter'], played: boolean, projected: boolean): Cell {
  if (starter) return cell(`${starter.name} (${starter.throws})`, played ? {} : { hint: 'Projected: it can change as the season is simmed' });
  if (played) return cell('Not in the export', { tone: 'unknown' });
  // A club OOTP projects no starters for at all is said as such, never "past" a projection it doesn't have
  return cell('Not named yet', { tone: 'unknown', hint: projected ? 'OOTP\'s projected starts don\'t reach this game' : 'OOTP hasn\'t projected this club\'s starters' });
}

function gameRows(s: Full, orgId: number, projected: ReadonlySet<number>): { rows: MlbRow[]; played: string[]; upcoming: string[] } {
  const rows: MlbRow[] = [];
  const played: string[] = [];
  const upcoming: string[] = [];
  // Whether the export carries runs by inning at all (the route reads them for its last 24 games played)
  const anyInnings = Object.keys(s.lineScores ?? {}).length > 0;
  s.series.forEach((series, si) => {
    const next = si === s.nextSeriesIndex;
    series.games.forEach((g, gi) => {
      const id = gameRowId(g.game_id);
      (g.played ? played : upcoming).push(id);
      const lines = s.lineScores?.[g.game_id];
      const ours = lines ? (g.isHome ? lines.home : lines.away) : null;
      const result: Cell = g.played && g.us !== null && g.them !== null
        ? cell(`${g.won ? 'W' : 'L'} ${g.us}–${g.them}${g.extraInnings ? ' (extra innings)' : ''}`, { tone: g.won ? 'good' : 'bad' })
        : g.played ? cell('Not in the export', { tone: 'unknown' }) : cell('To play', { tone: 'neutral' });
      const innings: Cell = !g.played
        ? cell('–', { hint: 'Not played yet' })
        : ours && ours.length
          ? cell(ours.join(' '), { hint: 'Our runs by inning' })
          : anyInnings
            ? cell('Not read', { tone: 'unknown', hint: 'Innings are read for the last 24 games played' })
            : cell('Not in the export', { tone: 'unknown', hint: 'The export has no runs by inning' });
      const seriesWords = `Game ${gi + 1} of ${series.games.length}${next && !g.played && gi === series.games.findIndex((x) => !x.played) ? ' · next up' : ''}`;
      rows.push(tableRow(id, {
        date: cell(dayWords(g.date)),
        opponent: cell(`${g.isHome ? 'vs' : 'at'} ${g.opponent}`),
        oppRecord: g.opponentRecord ? cell(`${g.opponentRecord.w}–${g.opponentRecord.l}`, { hint: 'Their record in the standings' }) : cell('Not in the export', { tone: 'unknown' }),
        result,
        innings,
        ourStarter: starterCell(g.ourStarter, g.played, projected.has(orgId)),
        theirStarter: starterCell(g.theirStarter, g.played, projected.has(g.oppId)),
        series: cell(seriesWords),
      }, {
        date: dayOrder(g.date),
        opponent: g.opponent,
        oppRecord: g.opponentRecord ? g.opponentRecord.pct : null,
        result: g.played && g.us !== null && g.them !== null ? g.us - g.them : null,
        innings: null,
        ourStarter: g.ourStarter?.name ?? null,
        theirStarter: g.theirStarter?.name ?? null,
        series: si * 100 + gi,
      }));
    });
  });
  return { rows, played, upcoming };
}

/** What the plan's place says before a game is chosen. */
const CHOOSE = 'Choose a game for the staff\'s plan.';

export interface ScheduleInput {
  schedule: Schedule | string;
  /** The clubs the export projects starters for (`projectedClubs`): a club missing has none at all. */
  projectedClubs: number[];
}

export function scheduleView(v: ClubhouseContext, input: ScheduleInput): MlbScheduleView {
  const base = head(v, 'Schedule & Game Plans', {
    text: 'The season game by game; choose a game for the staff\'s plan',
    full: 'Every game of the season with its result or its probable starters, how the club has done against each opponent, and for any game the staff\'s preparation: their starter, our card against his hand, how our hitters have done against him and his club, and their most dangerous bats.',
    specialist: SCHEDULE,
  });
  const note = factClaim(v, 'How the schedule is read', {
    specialist: SCHEDULE,
    because: [
      { label: 'Series', value: 'Grouped from consecutive games against the same opponent at the same venue.' },
      { label: 'Starters', value: 'For games already played, the actual ones; for games to come, each club\'s projected rotation, read at the game\'s place among that club\'s own games still to play. They change as the season is simmed.' },
      { label: 'Past the projection', value: 'OOTP projects a club\'s next several starts; a game further out has no starter named yet, and a club OOTP hasn\'t projected has none named at all.' },
      { label: 'How the projection is read', value: 'As the pattern the exports show: a five-man turn, then its first three again. Off days aren\'t modelled, so a day off that lets a club skip a starter isn\'t seen.' },
    ],
  });
  const empty = (text: string): MlbScheduleView => ({
    ...base, record: [], headToHead: null,
    games: { id: 'games', title: cell('Games'), summary: null, table: { columns: [], rows: [], empty: cell(text) }, note: null },
    filters: [], nextRow: null, note, empty: cell(text), choose: cell(CHOOSE),
  });
  const s = input.schedule;
  if (typeof s === 'string') return empty(`${s}.`);
  if (!isFull(s)) return empty('No games scheduled for this club.');
  const { rows, played, upcoming } = gameRows(s, v.ctx.build.orgId, new Set(input.projectedClubs));
  const nextSeries = s.series[s.nextSeriesIndex];
  const nextGame = nextSeries?.games.find((g) => !g.played) ?? null;
  return {
    ...base,
    record: recordFigures(v, s),
    headToHead: headToHead(s),
    games: {
      id: 'games',
      title: cell('Games'),
      summary: cell(`${plural(played.length, 'game')} played · ${upcoming.length} to play`),
      table: {
        columns: [
          column('date', 'Date', true), column('opponent', 'Opponent'), column('oppRecord', 'Their W–L', true), column('result', 'Result', true),
          column('innings', 'By inning'), column('ourStarter', 'Our starter'), column('theirStarter', 'Their starter'), column('series', 'Series', true),
        ],
        rows,
        empty: cell('No games scheduled for this club.'),
      },
      note: null,
    },
    filters: [
      { text: cell('Full Season'), rows: rows.map((r) => r.id) },
      { text: cell('Still to Play'), rows: upcoming },
      // The latest first, so the games just played open at the top
      { text: cell('Played'), rows: [...played].reverse() },
    ],
    nextRow: nextGame ? gameRowId(nextGame.game_id) : null,
    note,
    empty: null,
    choose: cell(CHOOSE),
  };
}

// ── a game's plan ───────────────────────────────────────────────────────────

type Matchup = GamePlan['matchups']['vsPitcher'][number];

const avg3 = (n: number | null): string | null => (n === null ? null : n.toFixed(3).replace(/^0\./, '.'));

function matchupSection(v: ClubhouseContext, id: string, title: string, lines: Matchup[], empty: string): MlbTableSection {
  const orgId = v.ctx.build.orgId;
  return {
    id,
    title: cell(title),
    summary: null,
    table: {
      columns: [column('player', 'Hitter'), column('position', 'Pos'), column('line', 'H–AB', true), column('avg', 'AVG', true), column('hr', 'HR', true)],
      rows: lines.slice(0, 8).map((m) => tableRow(`${id}-${m.player_id}`, {
        player: cell(m.name),
        position: cell(m.positionName),
        line: cell(`${m.h}-for-${m.ab}`, { hint: 'Hits and at-bats: the sample this rests on' }),
        avg: avg3(m.avg) === null ? cell('No at-bats', { tone: 'unknown' }) : cell(avg3(m.avg)!),
        hr: cell(String(m.hr)),
      }, { player: m.name, position: m.positionName, line: m.ab, avg: m.avg, hr: m.hr }, { player: player(m.player_id, m.name, orgId) })),
      empty: cell(empty),
    },
    note: null,
  };
}

export interface GamePlanInput {
  plan: GamePlan | string;
  /** The lineup card for the starter's hand, or the sentence it was refused with. */
  card: LineupCard | string | null;
  gameId: number;
  /** The plan couldn't be read this time (the build's part failed): the game is one of the club's, said as such. */
  unreadable?: boolean;
}

export function gamePlanView(v: ClubhouseContext, input: GamePlanInput): MlbGamePlanView {
  const base = head(v, 'Game Plan', {
    text: 'The staff\'s preparation for one game',
    full: 'Who is starting against us, the staff\'s card against his hand, how our hitters have actually fared against that man and that club, and which of their bats hit the ball hardest. Every head-to-head line carries its sample: a .667 average in three at-bats is noise.',
    specialist: PLAN,
  });
  const rowId = gameRowId(input.gameId);
  const plan = input.plan;
  if (typeof plan === 'string') {
    return {
      ...base, rowId, query: { game: input.gameId }, game: cell(input.unreadable ? 'This game' : 'A game not in the export'),
      starter: line(`${plan}.`, { quiet: true }), missing: null, card: block(null, []), sections: [],
    };
  }
  const orgId = v.ctx.build.orgId;
  const oppId = plan.game.opponent.team_id;
  const s = plan.starter;
  const starter = s
    ? line(`Their starter: ${s.name}, ${HAND_WORDS[s.throws] ?? 'hand not in the export'}, ${ageWords(s.age) ?? 'age not known'}${s.confirmed ? '' : ' (projected, and liable to change)'}`, {
      players: [player(s.player_id, s.name, oppId)],
    })
    : plan.game.played
      // A played game's starter is a fact the export gives or doesn't; a projection is never read for it (D-069, D-018)
      ? line('The export doesn\'t name who started this game.', { quiet: true })
      : line('No starter projected for this game yet.', { quiet: true });
  const hand = plan.lineupVs === 'l' ? 'left-handers' : 'right-handers';
  const card = input.card;
  const cardLines = card === null
    ? [line('The card isn\'t built yet.', { quiet: true })]
    : typeof card === 'string'
      ? [line(`${card}.`, { quiet: true })]
      : [
        ...card.lineup.map((l) => line(`${l.slot}. ${l.name}, ${l.positionName}`, { players: [player(l.player_id, l.name, orgId)] })),
        s
          ? line('The lineup card\'s order for this starter\'s hand, injured players left out: the card Lineup gives for this matchup.', { quiet: true })
          // The route falls back to the right-handers' card with nobody to read a hand from: say so, never imply a matchup
          : line('No starter is known for this game, so this is the card against right-handers, not one built for him.', { quiet: true }),
      ];
  const dangerous: MlbTableSection = {
    id: 'dangerous',
    title: cell('Their most dangerous bats', { hint: 'Their hitters by barrel rate, from every batted ball' }),
    summary: null,
    table: {
      columns: [column('player', 'Hitter'), column('position', 'Pos'), column('barrel', 'Brl%', true), column('ev', 'EV', true)],
      rows: plan.opponent.dangerous.map((h) => tableRow(`dangerous-${h.player_id}`, {
        player: cell(h.name),
        position: cell(h.positionName),
        barrel: h.barrelPct === null || h.barrelPct === undefined ? cell('Not known', { tone: 'unknown' }) : cell(`${h.barrelPct}%`, { hint: 'Batted balls hit hard at a damaging angle' }),
        ev: h.avgExitVelo === null || h.avgExitVelo === undefined ? cell('Not known', { tone: 'unknown' }) : cell(`${h.avgExitVelo} mph`, { hint: 'Average exit velocity' }),
      }, { player: h.name, position: h.positionName, barrel: h.barrelPct ?? null, ev: h.avgExitVelo ?? null }, { player: player(h.player_id, h.name, oppId) })),
      empty: cell('Not enough batted-ball data on this club yet.'),
    },
    note: null,
  };
  return {
    ...base,
    rowId,
    query: { game: input.gameId },
    game: cell(`${dayWords(plan.game.date)} · ${plan.game.isHome ? 'vs' : 'at'} ${plan.game.opponent.label}`),
    starter,
    missing: plan.missing?.length
      ? cell(`This export doesn't carry ${plan.missing.join(' or ')}, so that part of the plan is blank; the rest is unaffected.`, { tone: 'unknown' })
      : null,
    card: block(`Staff's view: our card against ${hand}`, cardLines),
    sections: [
      matchupSection(v, 'vsPitcher', 'Our hitters against him', plan.matchups.vsPitcher, s ? 'Nobody on this roster has faced him.' : 'No starter to look up yet.'),
      matchupSection(v, 'vsTeam', `Our hitters against ${plan.game.opponent.label}`, plan.matchups.vsTeam, 'No history against this club yet.'),
      dangerous,
    ],
  };
}
