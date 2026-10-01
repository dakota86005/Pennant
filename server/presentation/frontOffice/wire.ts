/**
 * The league wire in words (D-059, N7 Stage A): each fact the reader gathered (`leagueWire.ts`) as a `WireEntry` whose
 * headline is a claim with its basis, and the wire's stated order.
 *
 * - **The source's own words** (D-020, case 17): a move from OOTP's transaction log reads exactly as the log wrote it, a
 *   trade as the export's trade record summarises it. League news is not on the wire: the export files it with the GM's
 *   own mail (a staff note, another club's trade offer), so it is named as a gap (N7 review, H1). Pennant words only what it
 *   reads from a table whose meaning is established (an injury, a streak, an award, a standings move), and a roster
 *   difference between two exports, which it states as a change and never as a transaction.
 * - **A stated order, no hidden score** (case 18): followed clubs and players first when asked, then the newest day,
 *   then the kind in a stated order (trades, moves, injuries, awards, streaks, standings), then the source's own
 *   order. Following changes the order only, never an entry's words (case 20).
 *
 * Pure: the service hands in the facts and what the GM follows; nothing here reads a table.
 */
import type { Cell } from '../../contract/presentation.js';
import type { WireFact, WireFacts, WireGap, SnapshotChange } from '../../leagueWire.js';
import { basis, cell, claim, target } from '../claim.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import { gamesWords, ordinal } from './morning.js';
import type { Wire, WireEntry, WireKind, WireKindChoice, WireOrder, WireTop } from './leagueTypes.js';

/** The kinds in the wire's stated order within a day. */
export const KIND_ORDER: readonly WireKind[] = ['trade', 'move', 'injury', 'award', 'streak', 'standings'];

const KIND_NAMES: Record<WireKind, string> = {
  trade: 'Trades', move: 'Moves', injury: 'Injuries', award: 'Awards', streak: 'Streaks', standings: 'Standings',
};

/** The rule, in the words the order's help tag carries. */
export const WIRE_ORDER_RULE = 'Followed first if asked, then newest, then by kind, trades first';

const SOURCE_WORDS: Record<WireFact['source'], string> = {
  log: 'OOTP\'s transaction log',
  trades: 'The export\'s trade record',
  injuries: 'The export\'s injury history',
  streaks: 'The export\'s streaks',
  awards: 'The export\'s awards',
  standings: 'The standings at the last two exports',
  snapshots: 'Pennant\'s roster snapshots at the last two exports',
};

export interface Followed {
  clubs: ReadonlySet<number>;
  players: ReadonlySet<number>;
}

export interface WireContext {
  importStamp: string | null;
  gameDate: string | null;
  /**
   * Each player's organization's club, when the export says (his chip's `open` target, the nearest view a client opens
   * for him); asked once per answer for the entries it shows. Left out, no player's club is known.
   */
  playerOrgs?: (playerIds: readonly number[]) => ReadonlyMap<number, number | null>;
}

type PlayerOrgs = ReadonlyMap<number, number | null>;

/** The organizations of the players on the entries shown, asked once. */
const orgsOf = (facts: readonly WireFact[], ctx: WireContext): PlayerOrgs => {
  const ids = [...new Set(facts.flatMap((f) => f.players.map((p) => p.playerId)).filter((id) => id > 0))];
  return ids.length && ctx.playerOrgs ? ctx.playerOrgs(ids) : new Map();
};

/** Many facts as the wire shows them, each player's club asked once for all of them. */
export const wireEntries = (facts: readonly WireFact[], followed: Followed, ctx: WireContext): WireEntry[] => {
  const orgs = orgsOf(facts, ctx);
  return facts.map((f) => wireEntry(f, followed, ctx, orgs));
};

const source = (ctx: WireContext) => ({ department: 'league' as const, specialist: 'The league wire', asOf: ctx.importStamp, gameDate: ctx.gameDate });

const dayWords = (f: WireFact): string => gameDateDisplay(f.date) ?? 'Day not known';

function snapshotText(name: string, change: SnapshotChange): string {
  switch (change.what) {
    case 'organization':
      return change.to ? `${name}: now with the ${change.to.name}` : `${name}: no longer with the ${change.from?.name ?? 'club'}`;
    case 'injuredList':
      return change.on ? `${name}: now on the injured list` : `${name}: no longer on the injured list`;
    case 'fortyMan':
      return change.on ? `${name}: now on the 40-man roster` : `${name}: no longer on the 40-man roster`;
    case 'activeRoster':
      return change.on ? `${name}: now on the ${change.club?.name ?? 'club\'s'} active roster` : `${name}: no longer on the active roster`;
    default:
      return name;
  }
}

/** A standings move, stated from the two exports' places: "San Diego Padres: 1st in the NL West (was 2nd)". */
function standingsText(f: WireFact & { detail: { kind: 'standings' } }): string {
  const d = f.detail;
  const club = f.clubs[0]?.name ?? 'A club';
  const where = d.division ? ` in the ${d.division}` : '';
  const back = d.now.pos !== 1 && d.now.gb !== null && d.now.gb > 0 ? ` · ${gamesWords(d.now.gb)} back` : '';
  return `${club}: ${ordinal(d.now.pos ?? 0)}${where} (was ${ordinal(d.before.pos ?? 0)})${back}`;
}

/** The headline's line, in the source's own words where it has them. */
function headlineText(f: WireFact): string {
  const who = f.players[0]?.name ?? 'A player';
  switch (f.detail.kind) {
    case 'log':
    case 'trade':
      return f.ownWords ?? who;
    case 'injury':
      return `${who} was hurt${f.detail.dayToDay ? ' (day-to-day)' : ''}`;
    case 'streak':
      return f.detail.streak === 'hitting' ? `${who} has hit in ${f.detail.games} straight games` : `${who} has reached base in ${f.detail.games} straight games`;
    case 'award':
      return `${who}: ${f.detail.league ? `${f.detail.league} ` : ''}${f.detail.award}`;
    case 'standings':
      return standingsText(f as WireFact & { detail: { kind: 'standings' } });
    case 'snapshot':
      return snapshotText(who, f.detail.change);
    default:
      return who;
  }
}

const HINTS: Record<WireFact['source'], string> = {
  log: 'In the transaction log\'s own words',
  trades: 'As the export\'s trade record words it',
  injuries: 'From the export\'s injury history',
  streaks: 'A streak still running',
  awards: 'From the export\'s awards',
  standings: 'The standings at this export against the last one',
  snapshots: 'A change between two exports, not a transaction',
};

function headline(f: WireFact, ctx: WireContext) {
  const because = [
    { label: 'From', value: SOURCE_WORDS[f.source] },
    { label: 'Day', value: dayWords(f) },
    ...(f.clubs.length ? [{ label: f.clubs.length === 1 ? 'Club' : 'Clubs', value: f.clubs.map((c) => c.name).join(', ') }] : []),
  ];
  const unknown: string[] = [];
  let certainty: 'fact' | 'policy' = 'fact';
  let stamp: string | undefined;
  switch (f.detail.kind) {
    case 'log':
      if (!f.detail.supported) unknown.push('Pennant doesn\'t read this wording, so it is shown as the log wrote it.');
      break;
    case 'injury':
      because.push({ label: 'Day-to-day', value: f.detail.dayToDay === null ? 'Not in the export' : f.detail.dayToDay ? 'Yes' : 'No' });
      if (f.detail.length !== null) because.push({ label: 'Length, as the export records it', value: String(f.detail.length) });
      else unknown.push('The export doesn\'t say how long he is out.');
      break;
    case 'streak':
      because.push({ label: 'Games', value: String(f.detail.games) });
      if (f.detail.started) because.push({ label: 'Began', value: gameDateDisplay(f.detail.started) ?? f.detail.started });
      because.push({ label: 'Shown from', value: `${f.detail.line} games` });
      certainty = 'policy';
      stamp = 'The wire shows hitting streaks of 15 games or more and on-base streaks of 25 or more, for players on a major-league club.';
      break;
    case 'award':
      because.push({ label: 'Award', value: f.detail.award });
      break;
    case 'standings': {
      const d = f.detail;
      because.push({ label: 'Now', value: d.now.pos !== null ? `${ordinal(d.now.pos)} of ${d.now.of ?? '?'}${d.now.w !== null && d.now.l !== null ? ` · ${d.now.w}–${d.now.l}` : ''}` : 'Not placed' });
      because.push({ label: 'At the last export', value: d.before.pos !== null ? `${ordinal(d.before.pos)} of ${d.before.of ?? '?'}${d.before.w !== null && d.before.l !== null ? ` · ${d.before.w}–${d.before.l}` : ''}` : 'Not placed' });
      because.push({ label: 'Why it is here', value: d.why === 'leader' ? 'A club that now leads its division alone' : 'A place that moved in your division' });
      break;
    }
    case 'snapshot':
      unknown.push('Two exports show that his roster state changed, not which move changed it.');
      break;
    default:
      break;
  }
  return claim({
    text: headlineText(f),
    tone: 'neutral',
    hint: HINTS[f.source],
    basis: basis({
      because,
      source: source(ctx),
      unknown,
      wouldChange: [],
      lean: null,
      certainty,
      ...(stamp ? { stamp } : {}),
    }),
    links: [
      ...f.players.slice(0, 1).filter((p) => p.playerId > 0).map((p) => target({ kind: 'player', playerId: p.playerId })),
      ...f.clubs.slice(0, 2).map((c) => target({ kind: 'club', teamId: c.teamId })),
    ],
  });
}

/** One fact as the wire shows it. */
export function wireEntry(f: WireFact, followed: Followed, ctx: WireContext, orgs: PlayerOrgs = orgsOf([f], ctx)): WireEntry {
  const clubs = f.clubs.map((c) => ({ teamId: c.teamId, name: c.name, abbreviation: c.abbr, followed: followed.clubs.has(c.teamId) }));
  const players = f.players.map((p) => {
    const org = p.playerId > 0 ? orgs.get(p.playerId) ?? null : null;
    return {
      playerId: p.playerId, name: p.name, followed: followed.players.has(p.playerId),
      open: org !== null ? target({ kind: 'player', playerId: p.playerId, teamId: org }) : null,
    };
  });
  return {
    id: f.id,
    date: f.date,
    when: cell(dayWords(f), f.date === null ? { tone: 'unknown' } : {}),
    kind: f.kind,
    clubs,
    players,
    headline: headline(f, ctx),
    source: f.source,
    followed: clubs.some((c) => c.followed) || players.some((p) => p.followed),
  };
}

const isFollowed = (f: WireFact, followed: Followed): boolean =>
  f.clubs.some((c) => followed.clubs.has(c.teamId)) || f.players.some((p) => followed.players.has(p.playerId));

/** The stated order: followed first when asked, then newest day (a day not known last), then kind, then the source's order. */
export function wireOrder(facts: readonly WireFact[], followed: Followed, followedFirst: boolean): WireFact[] {
  return facts
    .map((f, i) => ({ f, i, followed: followedFirst && isFollowed(f, followed) ? 0 : 1 }))
    .sort((a, b) =>
      a.followed - b.followed
      || (b.f.day ?? '').localeCompare(a.f.day ?? '')
      || KIND_ORDER.indexOf(a.f.kind) - KIND_ORDER.indexOf(b.f.kind)
      || a.i - b.i)
    .map(({ f }) => f);
}

function orderOf(followedFirst: boolean): WireOrder {
  return { line: cell(followedFirst ? 'Followed first, then newest' : 'Newest first', { hint: WIRE_ORDER_RULE }), followedFirst };
}

/** A source the wire could not read, in a sentence. */
export function gapWords(g: WireGap): Cell {
  const line = ((): string => {
    switch (g.why) {
      case 'log_unavailable':
        return 'OOTP\'s transaction log couldn\'t be read, so moves are shown as changes between exports.';
      case 'log_reading':
        return 'The transaction log is still being read, so moves will follow.';
      case 'no_snapshots':
        return 'Without the log, moves come from two exports compared, and there is only one so far.';
      case 'not_read':
        return 'League news isn\'t on the wire: the export files it with your own mail, and Pennant can\'t tell the two apart.';
      case 'no_earlier_standings':
        return 'Standings moves start with the next export: there is no earlier one to compare.';
      case 'unreadable':
        return ({
          trades: 'Trades couldn\'t be read this time.',
          injuries: 'Injuries couldn\'t be read this time.',
          streaks: 'Streaks couldn\'t be read this time.',
          awards: 'Awards couldn\'t be read this time.',
        } as Partial<Record<WireGap['source'], string>>)[g.source] ?? 'Part of the wire couldn\'t be read this time.';
      default:
        // A column the source needs is missing: named in the hover
        if (g.detail?.includes('.')) {
          return ({
            trades: 'The export\'s trade record lacks what the wire needs, so trades aren\'t on the wire.',
            injuries: 'The export\'s injury history lacks what the wire needs, so injuries aren\'t on the wire.',
            streaks: 'The export\'s streaks lack what the wire needs.',
            awards: 'The export\'s awards lack what the wire needs.',
          } as Partial<Record<WireGap['source'], string>>)[g.source] ?? 'Part of the wire isn\'t in the export.';
        }
        return ({
          trades: 'The export has no trade record, so trades aren\'t on the wire.',
          injuries: 'The export has no injury history, so injuries aren\'t on the wire.',
          streaks: 'The export has no streaks.',
          awards: 'The export has no awards.',
        } as Partial<Record<WireGap['source'], string>>)[g.source] ?? 'Part of the wire couldn\'t be read.';
    }
  })();
  const hint = g.why === 'not_read'
    ? 'The export mixes headlines with staff notes and trade offers'
    : g.why === 'not_in_export' && g.detail ? `Not in the export: ${g.detail}` : undefined;
  return cell(line, { tone: 'unknown', ...(hint ? { hint } : {}) });
}

/** Whether a fact is on or after a day (both compared as ISO days); a fact with no day is never "since". */
const onOrAfter = (f: WireFact, day: string | null): boolean => day === null || (f.day !== null && f.day >= day);

export interface WireQuery {
  /** Entries on or after this day (ISO); null for the whole season. */
  sinceDay: string | null;
  /** The day as the GM or the export wrote it, for the words. */
  sinceRaw: string | null;
  /** How the since day was chosen. */
  sinceFrom: 'lastExport' | 'asked' | 'season';
  club: number | null;
  kind: WireKind | null;
  followedOnly: boolean;
  followedFirst: boolean;
  limit: number;
}

/** The whole wire for a query (League Office ▸ Wire). */
export function wireWords(orgId: number, facts: WireFacts, followed: Followed, q: WireQuery, ctx: WireContext): Wire {
  const inWindow = facts.facts.filter((f) => onOrAfter(f, q.sinceDay));
  const kinds: WireKindChoice[] = KIND_ORDER.map((kind) => ({ kind, name: KIND_NAMES[kind], count: inWindow.filter((f) => f.kind === kind).length }));
  const matched = inWindow.filter((f) => (q.club === null || f.clubs.some((c) => c.teamId === q.club))
    && (q.kind === null || f.kind === q.kind)
    && (!q.followedOnly || isFollowed(f, followed)));
  const ordered = wireOrder(matched, followed, q.followedFirst);
  const shown = ordered.slice(0, q.limit);
  const day = gameDateDisplay(q.sinceRaw);
  const since = q.sinceFrom === 'season' || !day
    ? cell('This season')
    : q.sinceFrom === 'lastExport' ? cell(`Since the export of ${day}`, { hint: 'On or after the day the last export reflected' }) : cell(`Since ${day}`);
  return {
    orgId,
    importStamp: ctx.importStamp,
    title: cell('Around the league'),
    since,
    sinceDate: q.sinceRaw,
    order: orderOf(q.followedFirst),
    entries: wireEntries(shown, followed, ctx),
    total: matched.length,
    more: matched.length > shown.length ? cell(`Showing the newest ${shown.length} of ${matched.length}`) : null,
    gaps: facts.gaps.map(gapWords),
    empty: matched.length === 0 ? cell(q.followedOnly ? 'Nothing from the clubs and players you follow' : 'Nothing around the league in this window') : null,
    kinds,
  };
}

/** How many entries the Morning Report's column shows (a stated line, D-041). */
export const WIRE_TOP = 5;

/** The Morning Report's column: the top entries since the last export, followed clubs first. */
export function wireTopWords(facts: WireFacts, followed: Followed, sinceDay: string | null, sinceRaw: string | null, ctx: WireContext): WireTop {
  const inWindow = facts.facts.filter((f) => onOrAfter(f, sinceDay));
  const ordered = wireOrder(inWindow, followed, true);
  const shown = ordered.slice(0, WIRE_TOP);
  const day = gameDateDisplay(sinceRaw);
  return {
    title: cell('Around the league'),
    order: orderOf(true),
    entries: wireEntries(shown, followed, ctx),
    more: inWindow.length > shown.length
      ? cell(`${inWindow.length - shown.length} more${day ? ` since ${day}` : ''}`, { hint: 'Open the wire' })
      : null,
    gaps: facts.gaps.map(gapWords),
    empty: inWindow.length === 0 ? cell(day ? `Nothing around the league since ${day}` : 'Nothing around the league yet') : null,
    open: target({ kind: 'view', department: 'league', view: 'wire' }),
  };
}
