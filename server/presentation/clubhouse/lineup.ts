/**
 * Lineup (N9): the staff's card for one ask, worded from what `computeLineup` built (the React page's `/api/lineup`) and
 * the next game (`computeNextGame`). The card is the staff's view, never an order (D-001), and Pennant never writes it
 * to OOTP. Every word the React page wrote on the client (the hint line, the tips, the bench, unavailable and not
 * scouted lines, the next-game banner) is served here; the bat and glove are our scouts' (D-017), and a grade that is
 * OSA's view filling in for them says so (D-067).
 */
import type { Cell } from '../../contract/presentation.js';
import type { NextGame } from '../../dashboard.js';
import type { LineupAsk, LineupCard } from '../../lineup.js';
import { cell } from '../claim.js';
import { block, column, line, tableRow } from '../majorLeague/common.js';
import type { MlbBlock, MlbLine, MlbRow } from '../majorLeague/types.js';
import { BATTING_STATS } from '../statCatalog.js';
import { factClaim, head, HAND_WORDS, dayWords, player, statCell, statSort, type ClubhouseContext } from './common.js';
import type { MlbLineupChoice, MlbLineupChoices, MlbLineupQuery, MlbLineupView } from './types.js';
import { withFill, type RatingFill } from './fill.js';

const CARD = 'The lineup card';
const stat = (key: string) => BATTING_STATS.find((s) => s.key === key)!;

export interface LineupInput {
  ask: LineupAsk;
  /** The card, or the sentence the route refuses with. */
  card: LineupCard | string;
  next: NextGame;
  /** OSA's view filling in for our scouts, per player (D-067); absent when our scouts rate him. */
  fills: ReadonlyMap<number, RatingFill>;
}

const queryOf = (ask: LineupAsk): MlbLineupQuery => ({ vs: ask.vs, style: ask.style, dh: ask.dh, sort: ask.sort });

const handWord = (vs: 'r' | 'l') => (vs === 'r' ? 'right-handers' : 'left-handers');

const TIP_BAT = (vs: 'r' | 'l') =>
  `What your scouts' hitting grades against ${vs === 'r' ? 'right' : 'left'}-handed pitching say he'd hit, in points of wOBA above an average ` +
  'major-league hitter: +20 is a good regular, −20 a bench bat. It reads contact, power, eye and gap power the way they have predicted ' +
  'results in this league\'s history, and the order is built from it. Where a hitter has no split grades it is read on his overall ' +
  'grades, and says so. It isn\'t this season\'s production (read it beside OPS+ and wRC+), and it isn\'t OOTP\'s own valuation, which ' +
  'your front office can\'t see.';
const TIP_GLOVE =
  'Your scouts\' 20–80 grade for him at the position he\'s assigned. Positions are chosen on the bat adjusted for the glove: the best ' +
  'bat plays a spot he can actually field, and a player only plays where the game has shown a grade for him.';

function choice(text: string, selected: boolean, ask: LineupAsk, hint?: string): MlbLineupChoice {
  return { text: cell(text, hint ? { hint } : {}), selected, query: queryOf(ask) };
}

function choices(ask: LineupAsk, card: LineupCard | null): MlbLineupChoices[] {
  const groups: MlbLineupChoices[] = [
    {
      title: cell('Against'),
      choices: [
        choice('Right-handers', ask.vs === 'r', { ...ask, vs: 'r' }),
        choice('Left-handers', ask.vs === 'l', { ...ask, vs: 'l' }),
      ],
    },
    {
      title: cell('Order'),
      choices: [
        choice('Sabermetric', ask.style === 'saber', { ...ask, style: 'saber' }, 'Best three hitters bat first, second and fourth'),
        choice('Traditional', ask.style === 'trad', { ...ask, style: 'trad' }, 'Speed leads off, best hitter third, power cleanup'),
      ],
    },
    {
      title: cell('Built from'),
      choices: [
        choice('Scouts\' Grades', ask.sort === 'talent', { ...ask, sort: 'talent' }, 'Your scouts\' view of each bat against this hand'),
        choice('This Season', ask.sort === 'production', { ...ask, sort: 'production' }, 'This season\'s hitting, steadied by playing time'),
      ],
    },
  ];
  // The rule is read from the save; a choice only changes the card on screen (the React page's DH tabs)
  if (card) {
    groups.push({
      title: cell('Designated hitter'),
      choices: [
        choice('With DH', card.usesDH, { ...ask, dh: card.leagueUsesDH === true ? 'auto' : 'on' }),
        choice('No DH', !card.usesDH, { ...ask, dh: card.leagueUsesDH === false ? 'auto' : 'off' }),
      ],
    });
  }
  return groups;
}

function tonight(v: ClubhouseContext, next: NextGame): MlbBlock | null {
  if (!next) return null;
  const lines: MlbLine[] = [line(`${next.isHome ? 'vs' : 'at'} ${next.opponent}`)];
  if (next.theirStarter) {
    lines.push(line(`Their probable: ${next.theirStarter.name}, ${HAND_WORDS[next.theirStarter.throws] ?? 'hand not in the export'}`, {
      players: [player(next.theirStarter.player_id, next.theirStarter.name, next.oppId)],
    }));
  } else {
    lines.push(line('Their starter isn\'t projected yet', { quiet: true }));
  }
  if (next.ourStarter) {
    lines.push(line(`Ours: ${next.ourStarter.name}`, { players: [player(next.ourStarter.player_id, next.ourStarter.name, v.ctx.build.orgId)] }));
  }
  return block(`Next game · ${dayWords(next.date)}`, lines);
}

function signedBat(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}`;
}

function orderRows(v: ClubhouseContext, card: LineupCard, ask: LineupAsk, fills: LineupInput['fills']): MlbRow[] {
  const orgId = v.ctx.build.orgId;
  return card.lineup.map((l) => {
    const pitcherBatting = l.positionName === 'P';
    const bat: Cell = l.off === null || l.off === undefined
      ? cell(pitcherBatting ? 'Doesn\'t apply' : 'Not graded', { tone: 'unknown', hint: pitcherBatting ? 'A pitcher batting has no bat read' : 'His hitting tools haven\'t been graded' })
      : cell(`${signedBat(l.off)}${l.batBasis === 'overall' ? ' overall' : ''}`, {
        hint: l.batBasis === 'overall' ? `No split grades against ${handWord(ask.vs)}: his overall grades` : `Against ${handWord(ask.vs)}, in points of wOBA`,
      });
    const glove: Cell = l.defRating === null
      ? cell(l.positionName === 'DH' ? 'Doesn\'t field' : 'Not graded', { tone: 'unknown', hint: l.positionName === 'DH' ? 'A designated hitter doesn\'t field' : 'No grade at this position' })
      : cell(String(l.defRating), { hint: 'Your scouts\' 20–80 grade at this position' });
    const name = l.dayToDay ? `${l.name} (day-to-day)` : l.name;
    const fill = fills.get(l.player_id) ?? null;
    // A line he has whose league-relative part can't be worked out is not known; no line at all is said as such
    const none = l.pa === null ? 'No line' : 'Not known';
    const cells: Record<string, Cell> = {
      slot: cell(String(l.slot)),
      player: cell(name, l.dayToDay ? { tone: 'caution', hint: 'Day-to-day: OOTP will let him play, so check him first' } : {}),
      position: cell(l.positionName),
      glove,
      bats: cell(l.bats),
      bat,
      pa: statCell(stat('pa'), l.pa, null, none),
      ops: statCell(stat('ops'), l.ops, null, none),
      opsPlus: statCell(stat('opsPlus'), l.opsPlus, null, none),
      wrcPlus: statCell(stat('wrcPlus'), l.wrcPlus, null, none),
      war: statCell(stat('war'), l.war, null, none),
      why: cell(l.why),
    };
    const why: MlbLine[] = [line(l.why)];
    if (l.dayToDay) why.push(line('Day-to-day: OOTP will let him play, so he is still on the card, but check him before you post it.', { quiet: true, tone: 'caution' }));
    const batLines: MlbLine[] = [];
    if (l.off !== null && l.off !== undefined) {
      batLines.push(line(`${signedBat(l.off)} against ${handWord(ask.vs)}, in points of wOBA above an average major-league hitter`));
      if (l.batBasis === 'overall') batLines.push(line(`No split grades against ${handWord(ask.vs)} for him in the export, so this reads his overall grades.`, { quiet: true }));
    } else {
      batLines.push(line(pitcherBatting ? 'A pitcher batting ninth has no bat read: a number would read as a measured one.' : 'His hitting tools haven\'t been graded by your scouts, so his bat can\'t be ranked against the others.', { quiet: true }));
    }
    const detail = withFill(fill, cells, ['bat', 'glove'], [block('Why he bats here', why), block('His bat', batLines)]);
    return tableRow(`slot-${l.slot}`, cells, {
      slot: l.slot,
      player: l.name,
      position: l.positionName,
      glove: l.defRating,
      bats: l.bats,
      bat: l.off ?? null,
      pa: statSort(l.pa),
      ops: statSort(l.ops),
      opsPlus: statSort(l.opsPlus),
      wrcPlus: statSort(l.wrcPlus),
      war: statSort(l.war),
      why: l.slot,
    }, { player: player(l.player_id, l.name, orgId), detail });
  });
}

function headline(v: ClubhouseContext, card: LineupCard, ask: LineupAsk) {
  const ordering = ask.style === 'saber'
    ? 'Ordering per The Book (Tango et al.): your three best hitters bat first, second and fourth, not third, fourth and fifth.'
    : 'Classic ordering: speed leads off, bat control second, the best hitter third, power cleanup.';
  const ranked = ask.sort === 'talent'
    ? `Ranked on your scouts' view of each bat against ${handWord(ask.vs)}: a projection from their grades, not this season's results.`
    : 'Ranked on this season\'s wRC+, steadied toward the league average by plate appearances so a hot twenty at-bats doesn\'t lead off. ' +
      'It reads the whole season, not the split, so the choice of hand moves only who plays where.';
  const because = [
    { label: 'How the order is written', value: ordering },
    { label: 'What it is built from', value: ranked },
    { label: 'The bat', value: TIP_BAT(ask.vs) },
    { label: 'The glove', value: TIP_GLOVE },
    { label: 'OPS+ and wRC+', value: `${stat('opsPlus').desc} ${stat('wrcPlus').desc}` },
  ];
  return factClaim(v, `Staff's view: the card against ${handWord(ask.vs)}`, {
    specialist: CARD,
    because,
    hint: ask.sort === 'talent' ? 'Built from your scouts\' grades' : 'Built from this season\'s hitting',
    unknown: card.notScouted.length ? ['Hitters your scouts haven\'t graded can\'t be ranked, so the card leaves them out unless a position needs them.'] : [],
    wouldChange: ['A new export, a different opposing hand, or another way of ordering.'],
    how: 'policy',
    stamp: 'How the staff writes a card: stated, not fitted',
  });
}

function notes(v: ClubhouseContext, card: LineupCard) {
  const out = [];
  const search = card.runSearch;
  if (search?.moved && search.gain >= 1) {
    out.push(factClaim(v, `Then searched: swapping pairs moved the card ${search.gain.toFixed(1)} runs a season`, {
      specialist: CARD,
      because: [
        { label: 'Before the search', value: `${search.seededRuns.toFixed(1)} runs a season` },
        { label: 'After the search', value: `${search.optimisedRuns.toFixed(1)} runs a season` },
        { label: 'Tries', value: String(search.evaluations) },
        { label: 'How', value: 'Pairs were swapped against an expected-runs model built from the hitters\' season lines; a man moved by the search keeps what he is, and says the search placed him.' },
      ],
      unknown: ['The model leaves out double plays and steals, so read the runs as an estimate.'],
      how: 'policy',
      stamp: 'How the staff searches a card: stated, not fitted',
    }));
  }
  if (card.dhOverridden) {
    out.push(factClaim(v, card.usesDH ? 'Showing a DH card, which this league doesn\'t use' : 'Showing a no-DH card, which this league doesn\'t use', {
      specialist: CARD,
      tone: 'caution',
      because: [{ label: 'The league\'s rule', value: card.leagueUsesDH === true ? 'Uses the designated hitter' : card.leagueUsesDH === false ? 'No designated hitter' : 'Not in the export' }],
    }));
  } else if (card.usesDH === false) {
    out.push(factClaim(v, 'No designated hitter here: eight position players, with tonight\'s starting pitcher batting ninth', {
      specialist: CARD,
      because: [{ label: 'The league\'s rule', value: 'No designated hitter' }],
    }));
  }
  return out;
}

const playersLine = (label: string, people: Array<{ player_id: number; name: string; positionName: string; extra?: string }>, orgId: number, hint?: string): MlbLine | null =>
  people.length === 0
    ? null
    : line(`${label} ${people.map((p) => `${p.name} (${p.positionName}${p.extra ? ` · ${p.extra}` : ''})`).join(', ')}`, {
      quiet: true,
      players: people.map((p) => player(p.player_id, p.name, orgId)),
      ...(hint ? { hint } : {}),
    });

export function lineupView(v: ClubhouseContext, input: LineupInput): MlbLineupView {
  const { ask, card, next, fills } = input;
  const built = typeof card === 'string' ? null : card;
  const orgId = v.ctx.build.orgId;
  const base = head(v, 'Lineup', {
    text: 'The staff\'s card for the next game; your choices only change the card shown here',
    full: 'The staff\'s batting order against the hand you choose, with each slot\'s reason. It is advice: Pennant never writes a lineup to OOTP, and changing a choice here builds the card again without touching your save.',
    specialist: CARD,
  });
  const theirHand = next?.theirStarter?.throws === 'L' ? 'l' : next?.theirStarter ? 'r' : null;
  return {
    ...base,
    query: queryOf(ask),
    tonight: tonight(v, next),
    againstTonight: theirHand && theirHand !== ask.vs && next?.theirStarter
      ? choice(`Against ${next.theirStarter.name}`, false, { ...ask, vs: theirHand }, 'Build the card against their probable starter\'s hand')
      : null,
    choices: choices(ask, built),
    headline: built ? headline(v, built, ask) : null,
    notes: built ? notes(v, built) : [],
    order: {
      columns: [
        column('slot', '#', true), column('player', 'Player'), column('position', 'Pos'), column('glove', 'Glove'),
        column('bats', 'B'), column('bat', `Bat vs ${ask.vs === 'r' ? 'RHP' : 'LHP'}`), column('pa', 'PA', true),
        column('ops', 'OPS', true), column('opsPlus', 'OPS+', true), column('wrcPlus', 'wRC+', true), column('war', 'WAR', true),
        column('why', 'Why here'),
      ],
      rows: built ? orderRows(v, built, ask, fills) : [],
      empty: built ? cell('No card: nobody is available to play.') : null,
    },
    bench: built ? playersLine('Bench:', built.bench, orgId) : null,
    notScouted: built
      ? playersLine('Not scouted:', built.notScouted ?? [], orgId, 'Their bat hasn\'t been graded, so the card leaves them out')
      : null,
    unavailable: built
      ? playersLine('Unavailable:', built.unavailable.map((u) => ({ ...u, extra: `${u.status}${u.daysLeft ? `, ${u.daysLeft} days` : ''}` })), orgId)
      : null,
    empty: built ? null : cell(typeof card === 'string' ? `${card}.` : 'No card.'),
  };
}
