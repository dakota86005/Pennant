/**
 * Farm & Development ▸ Development tracking (N10; React's Scouted Development page, `Development.tsx`): what our scouts
 * have seen of each minor leaguer over this save's own rating history (D-064), and how fast it is moving against his
 * peers. Every comparison is first against latest of this save's usable snapshots; a snapshot in another kind of ratings
 * than today's export is left out (a switch, never movement; D-061). With fewer than two snapshots there is no change to
 * show, and it says so, never a change of zero (D-018).
 *
 * The movers React worked out on the client are served: the biggest changes are the largest observed changes either
 * way (`MOVERS_SHOWN`, stated), set over the whole organization before any level is chosen.
 */
import type { ScoutedDevelopmentPlayer } from '../../scoutedDevelopment.js';
import { cell, claim, row, servedValue, unknownValue } from '../claim.js';
import { decisionTarget, factBasis, factRow, headOf, sentenceCells } from './common.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import type { DevelopmentHistoryInput, FarmContext, HistoryRowInput } from './input.js';
import type { FarmDevelopmentDetail, FarmDevelopmentRow, FarmDevelopmentTab, FarmDevelopmentView, FarmMovementRow, FarmSnapshotRow } from './types.js';
import { PLAYER_DEVELOPMENT, paceWords, plain, plural, ratingText, roleWords, signed, type RatingDisplay } from './words.js';

/** How many of the biggest changes the movers tab lists: a stated presentation line, not a judgment. */
export const MOVERS_SHOWN = 25;

const PITCHER_TOOLS: ReadonlyArray<readonly [keyof HistoryRowInput, string]> = [['stu', 'Stuff'], ['mov', 'Movement'], ['ctl', 'Control']];
const HITTER_TOOLS: ReadonlyArray<readonly [keyof HistoryRowInput, string]> = [
  ['con', 'Contact'], ['gap', 'Gap'], ['pow', 'Power'], ['eye', 'Eye'], ['avk', 'Avoid strikeouts'], ['spd', 'Speed'],
];

/** A composite as our scouts' read: one decimal, on the save's scale. */
const composite = (n: number | null, rating: RatingDisplay): string => (n === null ? 'Not seen' : rating.roundToFive && rating.scaleMax === 80 ? ratingText(n, rating) : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ''));

const SNAPSHOT_RULE = 'A trend needs three snapshots over 75 days of the season; a pace against his peers also needs 20 comparable players';

/** The summary of one man's history, as the React page said it, plainly. */
function summaryText(player: ScoutedDevelopmentPlayer): string {
  const h = player.evidence.developmentHistory;
  const pace = player.evidence.peerDevelopment.pace;
  if (h.status === 'insufficient' || h.currentDelta === null) return 'There isn\'t enough scouting history yet for a steady trend.';
  const changed = `Our scouts' read of his current skills has changed ${signed(h.currentDelta)}`;
  if (pace === 'ahead') return `${changed}, faster than comparable players.`;
  if (pace === 'behind') return `${changed}, slower than comparable players.`;
  if (pace === 'insufficient') return `${changed}; there aren't enough comparable players yet to say how that compares.`;
  return `${changed} over the history there is, near what is typical for comparable players.`;
}

interface Tracked {
  player: ScoutedDevelopmentPlayer;
  snaps: HistoryRowInput[];
}

function detailOf(ctx: FarmContext, t: Tracked, rating: RatingDisplay): FarmDevelopmentDetail {
  const { player, snaps } = t;
  const h = player.evidence.developmentHistory;
  const first = snaps[0];
  const latest = snaps[snaps.length - 1];
  const pace = paceWords(player.evidence.peerDevelopment.pace, player.evidence.peerDevelopment.percentile);
  const tools = first.position === 1 ? PITCHER_TOOLS : HITTER_TOOLS;
  const movement: FarmMovementRow[] = [];
  if (snaps.length >= 2) {
    for (const [key, label] of tools) {
      const from = first[key];
      const to = latest[key];
      if (typeof from !== 'number' || typeof to !== 'number' || from === to) continue;
      const delta = to - from;
      movement.push(row(
        `move:${player.playerId}:${String(key)}`,
        {
          tool: cell(label),
          from: cell(ratingText(from, rating)),
          to: cell(ratingText(to, rating)),
          change: cell(signed(delta), { tone: delta > 0 ? 'good' : 'bad' }),
        },
        { tool: label, from, to, change: delta },
      ));
    }
    movement.sort((a, b) => Math.abs(Number(b.sort.change)) - Math.abs(Number(a.sort.change)));
  }
  const snapshots: FarmSnapshotRow[] = snaps.map((s, i) => row(
    `snap:${player.playerId}:${i}`,
    {
      date: cell(gameDateDisplay(s.game_date) ?? s.game_date),
      level: cell(s.levelName),
      current: cell(composite(s.cur, rating), s.cur === null ? { tone: 'unknown' } : {}),
      ceiling: cell(composite(s.pot, rating), s.pot === null ? { tone: 'unknown' } : {}),
    },
    { date: i, level: s.level, current: s.cur, ceiling: s.pot },
  ));
  const delta = h.currentDelta;
  return {
    ...headOf(ctx),
    playerId: player.playerId,
    teamId: player.teamId,
    name: player.name,
    line: cell(`${player.age} · ${roleWords(player.kind, player.role)} · ${player.levelName} · ${player.team}`),
    pace: cell(pace.text, { tone: pace.tone }),
    first: cell(composite(first.cur, rating)),
    latest: cell(composite(latest.cur, rating)),
    change: claim({
      text: 'Change in our scouts\' read',
      tone: delta === null || delta === 0 ? 'neutral' : delta > 0 ? 'good' : 'bad',
      value: delta === null ? unknownValue('count', 'Not enough history yet') : servedValue(delta, 'count', signed(delta)),
      basis: factBasis(ctx, PLAYER_DEVELOPMENT, [
        { label: 'First snapshot', value: `${gameDateDisplay(first.game_date) ?? first.game_date}: ${composite(first.cur, rating)}` },
        { label: 'Latest snapshot', value: `${gameDateDisplay(latest.game_date) ?? latest.game_date}: ${composite(latest.cur, rating)}` },
        { label: 'Snapshots in this save', value: String(snaps.length) },
        ...h.reasons.map((r) => ({ label: 'History', value: plain(r) })),
      ], delta === null ? [SNAPSHOT_RULE] : []),
    }),
    ceilingChange: h.potentialDelta === null ? cell('Not enough history yet', { tone: 'unknown' }) : cell(signed(h.potentialDelta)),
    summary: claim({
      text: summaryText(player),
      tone: 'neutral',
      basis: factBasis(ctx, PLAYER_DEVELOPMENT, [
        ...h.reasons.map((r) => ({ label: 'History', value: plain(r) })),
        ...player.evidence.peerDevelopment.reasons.map((r) => ({ label: 'Against his peers', value: plain(r) })),
      ]),
    }),
    snapshots,
    movement,
    movementEmpty: movement.length ? null : cell(snaps.length >= 2 ? 'None of his visible scouting grades changed across these snapshots.' : 'One snapshot so far: nothing to compare yet.'),
    peers: sentenceCells(player.evidence.peerDevelopment.reasons),
    open: decisionTarget(player.playerId),
    fogNote: cell('These snapshots keep what the organization could see at the time. A change can be real development, a revised scouting read, or both; Pennant never puts OOTP\'s hidden ratings in their place.'),
  };
}

export interface DevelopmentViews {
  view: FarmDevelopmentView;
  details: FarmDevelopmentDetail[];
}

export function developmentViews(
  ctx: FarmContext,
  players: readonly ScoutedDevelopmentPlayer[],
  history: DevelopmentHistoryInput,
  rating: RatingDisplay,
): DevelopmentViews {
  const byPlayer = new Map<number, HistoryRowInput[]>();
  for (const r of history.rows) {
    const list = byPlayer.get(r.player_id);
    if (list) list.push(r);
    else byPlayer.set(r.player_id, [r]);
  }
  // Every minor leaguer with at least one snapshot of this save, in the roster's order (level, then name)
  const tracked: Tracked[] = players.filter((p) => byPlayer.has(p.playerId)).map((player) => ({ player, snaps: byPlayer.get(player.playerId)! }));

  const ready = history.snapshots >= 2;
  const change = (t: Tracked) => t.player.evidence.developmentHistory.currentDelta;
  const place = (t: Tracked) => t.player.evidence.peerDevelopment.percentile;
  const ahead = tracked.filter((t) => t.player.evidence.peerDevelopment.pace === 'ahead');
  const behind = tracked.filter((t) => t.player.evidence.peerDevelopment.pace === 'behind');
  // The movers: the largest observed changes either way, over the whole organization, ties in the roster's order
  const movers = tracked
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => { const d = change(t); return d !== null && Number.isFinite(d) && Math.abs(d) > 0; })
    .sort((a, b) => Math.abs(change(b.t)!) - Math.abs(change(a.t)!) || a.i - b.i)
    .slice(0, MOVERS_SHOWN)
    .map(({ t }) => t);
  const byPlace = (list: Tracked[], dir: 1 | -1) =>
    list.map((t, i) => ({ t, i })).sort((a, b) => {
      const pa = place(a.t);
      const pb = place(b.t);
      if (pa === null && pb === null) return a.i - b.i;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return dir * (pb - pa) || a.i - b.i;
    }).map(({ t }) => t);
  const id = (t: Tracked) => `development:${t.player.playerId}`;
  // While the history is building nobody has a pace or a change yet: the pace tabs say so, never a count of zero (D-018)
  const paceTab = new Set(['ahead', 'behind', 'changes']);
  const labelled = (tabsIn: Array<Omit<FarmDevelopmentTab, 'label'>>): FarmDevelopmentTab[] =>
    tabsIn.map((t) => ({ ...t, label: !ready && paceTab.has(t.id) ? `${t.name} · not yet` : `${t.name} · ${t.count}` }));
  const tabs: FarmDevelopmentTab[] = labelled([
    { id: 'ahead', name: 'Ahead', count: ahead.length, title: cell('Ahead of his peers'), order: byPlace(ahead, 1).map(id), rule: cell('Furthest ahead first') },
    { id: 'behind', name: 'Behind', count: behind.length, title: cell('Behind his peers'), order: byPlace(behind, -1).map(id), rule: cell('Furthest behind first') },
    {
      id: 'changes',
      name: 'Biggest changes',
      count: movers.length,
      title: cell('Largest changes'),
      order: movers.map(id),
      rule: cell(`The ${MOVERS_SHOWN} largest changes in our scouts' read, up or down`, { hint: 'Across the whole organization, before a level is chosen' }),
    },
    { id: 'all', name: 'All', count: tracked.length, title: cell('Every player we track'), order: byPlace(tracked, 1).map(id), rule: cell('Furthest ahead of his peers first; no pace yet last') },
  ]);
  const initialTab = ahead.length ? 'ahead' : movers.length ? 'changes' : 'all';

  const rows: FarmDevelopmentRow[] = tracked.map((t) => {
    const p = t.player;
    const d = change(t);
    const pace = paceWords(p.evidence.peerDevelopment.pace, p.evidence.peerDevelopment.percentile);
    const latest = t.snaps[t.snaps.length - 1];
    return {
      ...row(
        id(t),
        {
          player: cell(p.name),
          age: cell(String(p.age)),
          club: cell(`${p.levelName} · ${p.team}`),
          role: cell(roleWords(p.kind, p.role)),
          current: cell(composite(latest.cur, rating), latest.cur === null ? { tone: 'unknown' } : {}),
          change: d === null ? cell('Not enough history yet', { tone: 'unknown' }) : cell(signed(d), { tone: d > 0 ? 'good' : d < 0 ? 'bad' : 'neutral' }),
          pace: cell(pace.text, { tone: pace.tone }),
          history: cell(plural(t.snaps.length, 'snapshot')),
        },
        {
          player: p.name,
          age: p.age,
          club: `${String(p.level).padStart(2, '0')} ${p.team}`,
          role: roleWords(p.kind, p.role),
          current: latest.cur,
          change: d,
          pace: p.evidence.peerDevelopment.pace === 'insufficient' ? null : place(t),
          history: t.snaps.length,
        },
      ),
      playerId: p.playerId,
      teamId: p.teamId,
      levelId: String(p.level),
      listLine: cell(`${p.age} · ${p.levelName} · ${p.team}`),
      open: decisionTarget(p.playerId),
    };
  });

  const dates = history.dates;
  const span = dates.length ? `${gameDateDisplay(dates[0]) ?? dates[0]} to ${gameDateDisplay(dates[dates.length - 1]) ?? dates[dates.length - 1]}` : 'None yet';
  const basisOf = (because: Array<{ label: string; value: string }>) => factBasis(ctx, PLAYER_DEVELOPMENT, because);
  // A count of players ahead or behind says nothing until there is a pace to compare: "Not yet" while the history is
  // building, never zero (D-018); the basis names how many tracked players have no pace yet
  const noPace = tracked.filter((t) => t.player.evidence.peerDevelopment.pace === 'insufficient').length;
  const paceFigure = (text: string, hint: string, label: string, n: number) => claim({
    text,
    tone: ready ? 'neutral' : 'unknown',
    hint,
    value: ready ? servedValue(n, 'count', String(n)) : unknownValue('count', 'Not yet'),
    basis: basisOf([
      { label, value: ready ? String(n) : 'Not yet' },
      { label: 'Tracked', value: String(tracked.length) },
      { label: 'No pace yet', value: String(ready ? noPace : tracked.length) },
    ]),
  });
  const figures = [
    claim({
      text: 'Scouting snapshots',
      tone: 'neutral',
      hint: dates.length > 1 ? span : undefined,
      value: servedValue(history.snapshots, 'count', String(history.snapshots)),
      basis: basisOf([{ label: 'Snapshots in this save', value: String(history.snapshots) }, { label: 'From', value: span }]),
    }),
    claim({
      text: 'Days of history',
      tone: 'neutral',
      hint: 'Days of the season between the first and latest snapshot',
      value: history.observationDays === null ? unknownValue('days', 'Not yet') : servedValue(history.observationDays, 'days', String(history.observationDays)),
      basis: basisOf([{ label: 'From', value: span }]),
    }),
    paceFigure('Ahead of their peers', 'Moving as fast as or faster than four in five comparable players', 'Ahead', ahead.length),
    paceFigure('Behind their peers', 'Moving as slowly as or slower than four in five comparable players', 'Behind', behind.length),
  ];

  const view: FarmDevelopmentView = {
    ...headOf(ctx),
    ready,
    building: ready
      ? null
      : claim({
        text: history.snapshots === 0
          ? 'No snapshot of our scouts\' ratings is kept for this organization yet. Import a later point in the save to start comparing.'
          : 'One snapshot of our scouts\' ratings is kept so far. Import a later point in the save to start comparing how our read changes.',
        tone: 'unknown',
        basis: factBasis(ctx, PLAYER_DEVELOPMENT, [{ label: 'Snapshots in this save', value: String(history.snapshots) }], [SNAPSHOT_RULE]),
      }),
    figures,
    historyNotes: sentenceCells([...(history.history.note ? [history.history.note] : []), ...history.ratingModeSwitches.map((s) => s.text)]),
    guide: [
      factRow('guide:composite', 'Our scouts\' read', 'An average of the scouting grades kept at each export, on the save\'s scale.'),
      factRow('guide:pace', 'Against his peers', 'The change in that read against similar minor leaguers: the same kind of player, the same age range and, where there are enough, the same starting level.'),
      factRow('guide:change', 'What a change means', 'Real development, a revised scouting read, or both.'),
      factRow('guide:rule', 'When it shows', `${SNAPSHOT_RULE}; until then the history says it is building.`),
    ],
    tabs,
    initialTab,
    levels: [...new Map(tracked.map((t) => [t.player.level, t.player.levelName])).entries()].sort((a, b) => a[0] - b[0]).map(([lv, name]) => ({ id: String(lv), name })),
    rows,
    empty: cell('No players match this view.'),
    tableNote: cell('Every minor leaguer with scouting history in this save. Where he plays is decided on Prospects and his Decision.'),
    model: cell('What our scouts have seen, kept at each export, and how fast it is changing against comparable minor leaguers. Neither is OOTP\'s hidden rating.'),
  };
  return { view, details: tracked.map((t) => detailOf(ctx, t, rating)) };
}
