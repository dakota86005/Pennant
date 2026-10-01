/**
 * Another club's report in words (D-059, N7 Stage A): the Morning Report's own words for that club (`morningWords`, the
 * same modules, D-057), and the parts only a club report has: how much of the club our scouts see (case 19), its record
 * against us, its next series with us and its injured list. Objective facts and stated places only: nothing ranks the
 * club or reads it as a buyer, a seller or a threat (D-060).
 *
 * Pure: the reader (`clubReport.ts`) hands in what it read; nothing here reads a table.
 */
import type { Cell, Claim } from '../../contract/presentation.js';
import type { ClubMaterial } from '../../clubReport.js';
import { basis, cell, claim, target } from '../claim.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import { asOfCell, plural, type BuildContext } from './desk.js';
import { morningWords } from './morning.js';
import type { ClubInjury, ClubReport } from './leagueTypes.js';

const source = (build: BuildContext, specialist: string) => ({ department: 'league' as const, specialist, asOf: build.importStamp, gameDate: build.gameDate });

/** How much of the club our scouts see, with what they can't see as its basis (D-017, case 19). */
export function scoutingWords(build: BuildContext, m: ClubMaterial) {
  const s = m.scouting;
  const withheld = s.source.mode === 'none';
  // Their players can't be listed: what our scouts see of them is unknown, never "nobody" (D-018)
  const unlisted = m.playersWhy !== null;
  const text = unlisted
    ? 'The export doesn\'t list their players, so what our scouts see of them isn\'t known'
    : withheld
    ? 'The export carries no ratings, so no player here is judged on ability'
    : s.players === 0
      ? 'Nobody is on the club in this export'
      : s.complete === s.players
        ? `Our scouts have a full report on all ${plural(s.players, 'player')}`
        : `Our scouts have a full report on ${s.complete} of ${plural(s.players, 'player')}`;
  const unknown = [
    ...(unlisted ? [`The club's players couldn't be listed (${m.playersWhy}), so nothing about them is read.`] : []),
    ...(s.partial ? [`Our scouts see ${plural(s.partial, 'player')} only in part: what they can't see is left out, never filled in.`] : []),
    ...(s.unknown && !withheld ? [`Our scouts have no report on ${plural(s.unknown, 'player')}, so nothing about their ability is read.`] : []),
    ...(s.viewerOrgId === null ? ['The save doesn\'t say whose scouts these are: it names no one club as yours.'] : []),
  ];
  return claim({
    text,
    tone: unknown.length ? 'unknown' : 'neutral',
    hint: `Ratings: ${s.source.short}`,
    basis: basis({
      because: [
        { label: 'Ratings', value: s.source.text },
        ...(unlisted ? [] : [
          { label: 'Players on the club', value: String(s.players) },
          { label: 'A full report', value: String(s.complete) },
          { label: 'Seen in part', value: String(s.partial) },
          { label: 'No report', value: String(s.unknown) },
        ]),
        { label: 'The same as ours', value: 'Every club\'s players are read through our organization\'s scouting, never the game\'s own ratings.' },
      ],
      source: source(build, 'Scouting'),
      unknown,
      wouldChange: ['Our scouts seeing more of them in a later export.'],
      lean: null,
      certainty: 'fact',
    }),
  });
}

/**
 * Why there is no record against us, in a sentence, when there is none (L7, N7 review): our club not known yet, or the
 * export without its games. Null for our own club, or when the record is served.
 */
function headToHeadNote(m: ClubMaterial, ourName: string | null): Cell | null {
  if (m.ourTeamId === m.teamId || m.headToHead) return null;
  if (m.ourTeamId === null) return cell('Their record against your club shows once your club is chosen', { tone: 'unknown' });
  return cell(`Their record against ${ourName ? `the ${ourName}` : 'your club'} isn't known`, {
    tone: 'unknown', hint: m.scheduleWhy ?? 'The export has no game-by-game results.',
  });
}

function headToHeadWords(build: BuildContext, m: ClubMaterial, ourName: string | null): Claim | null {
  if (!m.headToHead || m.ourTeamId === null) return null;
  const h = m.headToHead;
  const us = ourName ?? 'your club';
  const record = `${h.w}–${h.l}${h.t ? `–${h.t}` : ''}`;
  return claim({
    text: h.games ? `${record} against the ${us}` : `Hasn't played the ${us} yet`,
    tone: 'neutral',
    hint: 'Their record against your club this season',
    basis: basis({
      because: [{ label: 'Games against you', value: String(h.games) }, { label: 'Their record in them', value: record }],
      source: source(build, 'The schedule'),
      unknown: [],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
    links: [target({ kind: 'view', department: 'majorLeague', view: 'scheduleGamePlans' })],
  });
}

function nextSeriesWords(build: BuildContext, m: ClubMaterial, ourName: string | null): { claim: Claim | null; note: Cell | null } {
  if (m.ourTeamId === null || m.ourTeamId === m.teamId) return { claim: null, note: null };
  if (m.nextSeries === null) return { claim: null, note: cell(m.scheduleWhy ?? 'The export has no game-by-game schedule.', { tone: 'unknown' }) };
  if (!m.nextSeries.length) return { claim: null, note: cell(`No more games with the ${ourName ?? 'your club'} this season`) };
  const games = m.nextSeries;
  const first = gameDateDisplay(games[0].date) ?? games[0].date;
  const last = gameDateDisplay(games[games.length - 1].date) ?? games[games.length - 1].date;
  const ourPark = !games[0].home;
  return {
    claim: claim({
      text: `${plural(games.length, 'game')} from ${first}, ${ourPark ? 'in our park' : 'in theirs'}`,
      tone: 'neutral',
      hint: 'Their next series with your club, as the schedule has it',
      basis: basis({
        because: [
          { label: 'First game', value: first },
          { label: 'Last game', value: last },
          { label: 'Where', value: ourPark ? 'At your park' : 'At their park' },
          { label: 'A series', value: 'Their games against you in one park, on consecutive days, from the league\'s day on' },
        ],
        source: source(build, 'The schedule'),
        unknown: [],
        wouldChange: ['OOTP changing the schedule.'],
        lean: null,
        certainty: 'fact',
      }),
      links: [target({ kind: 'view', department: 'majorLeague', view: 'scheduleGamePlans' })],
    }),
    note: null,
  };
}

function injuryWords(build: BuildContext, m: ClubMaterial): { list: ClubInjury[]; note: Cell | null } {
  const list = m.injuries.map((i) => ({
    playerId: Number(i.player_id),
    line: claim({
      text: `${i.name} · ${i.status}${i.daysLeft ? `, ${plural(Number(i.daysLeft), 'day')} left` : ''}`,
      tone: 'caution' as const,
      hint: `${i.positionName}, as the export has him`,
      basis: basis({
        because: [
          { label: 'Status', value: String(i.status) },
          { label: 'Days left', value: i.daysLeft === null || i.daysLeft === undefined ? 'Not in the export' : String(i.daysLeft) },
          { label: 'Position', value: String(i.positionName) },
        ],
        source: source(build, 'The injury report'),
        unknown: i.daysLeft === null || i.daysLeft === undefined ? ['The export doesn\'t say how long he is out.'] : [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
      links: [target({ kind: 'player', playerId: Number(i.player_id) })],
    }),
  }));
  // An injured list the export can't give is unknown, never empty (D-018)
  if (m.injuriesWhy !== null) return { list: [], note: cell('Their injured list isn\'t in this export', { tone: 'unknown', hint: m.injuriesWhy }) };
  return { list, note: list.length ? null : cell('Nobody on their injured list') };
}

/**
 * The club report's words, as built in the worker: everything but what the GM follows and the recent moves, which the
 * service puts on it when served (the wire is gathered on the server's own thread).
 */
export function clubReportWords(build: BuildContext, m: ClubMaterial, ourName: string | null, abbreviation: string | null): ClubReport {
  const morning = morningWords(build, m.morning);
  const series = nextSeriesWords(build, m, ourName);
  const injuries = injuryWords(build, m);
  return {
    teamId: m.teamId,
    club: build.club ?? `Club ${m.teamId}`,
    abbreviation,
    importStamp: build.importStamp,
    reportStamp: build.reportStamp,
    asOf: asOfCell(build),
    followed: false,
    ours: m.ourTeamId === m.teamId,
    teamSeason: morning.teamSeason,
    lede: morning.lede,
    clubProfile: morning.clubProfile,
    rosterMap: morning.rosterMap,
    scouting: scoutingWords(build, m),
    headToHead: headToHeadWords(build, m, ourName),
    headToHeadNote: headToHeadNote(m, ourName),
    nextSeries: series.claim,
    nextSeriesNote: series.note,
    moves: [],
    movesNote: null,
    injuries: injuries.list,
    injuriesNote: injuries.note,
    openWire: target({ kind: 'view', department: 'league', view: 'wire' }),
  };
}
