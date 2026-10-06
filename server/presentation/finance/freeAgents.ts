/**
 * Finance's Free Agents for the Mac app (N12, D-071): who is on the market now, who reaches it after this season and who
 * might, as `computeFreeAgents` reads them (Player Value phase 6c), worded as the React page (`src/pages/FreeAgents.tsx`)
 * words them. A player's figure is a season of his production at the market (`marketValueOf`), never an asking price,
 * an offer or what he is worth to this club; his tools come only through `scoutedEvidence.ts` with the OSA mark (D-017,
 * D-067). Everyone reaching the market is listed (no value cut), ordered by expected wins next season, unknown last; no
 * row says sign him. Pure.
 */
import type { computeFreeAgents, FreeAgentRow, MightReachRow } from '../../freeagents.js';
import type { BasisLine, Cell } from '../../contract/presentation.js';
import { basis, cell, claim } from '../claim.js';
import {
  column, fact, filterChoice, hintIf, officeHead, officeLede, officePlayer, officeRow, officeSource,
  type OfficeContext, type OfficeFact, type OfficeFilterGroup, type OfficeRow, type OfficeTable,
} from '../officeTable.js';
import { TIP_SCOUTED } from '../player/words.js';
import type { FinanceFreeAgentList, FinanceFreeAgentsView } from './types.js';
import { financeCards, money, perWinLine, rangeText, signedMoney, signedTenths, winsCell } from './words.js';

type FreeAgents = ReturnType<typeof computeFreeAgents>;
/** The mark beside his grades when they are OSA's view filling in for our scouts (D-067), or null. */
export type FillOf = (playerId: number) => { mark: string; hint: string } | null;

const SPECIALIST = 'Player Value';

const TIP_THINNEST =
  "Your positions whose best player is expected to add the fewest wins for the rest of this season, from Pennant's " +
  "projections. It says where your roster is thin, not who to sign: fit and role are yours to judge.";

/** The column tips the React page's headings carried, in each list's lede. */
function columnWords(y: string, n: string, price: FreeAgents['price']): BasisLine[] {
  const minimum = price?.minimum != null ? ` (${money(price.minimum)})` : '';
  const perWin = price ? ` (about ${money(price.band.central)})` : '';
  return [
    { label: 'Player', value: 'Every name opens his own window.' },
    { label: 'Age', value: 'His age as the export states it.' },
    { label: 'Scouted', value: TIP_SCOUTED },
    { label: `${y} wins`, value: `His projected wins above replacement (WAR) for the rest of ${y} (the whole of it before it starts), most likely, with the range it could be. It rests on his major-league record and his scouted tools, and on how much he has played.` },
    { label: `${n} wins`, value: `His projected wins above replacement (WAR) in ${n}, most likely, with the range it could be. A player whose production can't be projected says why and sorts last.` },
    { label: `${n} at the market`, value: `What this league's market pays for a season of his expected play in ${n}: the league minimum${minimum} plus his projected wins × what a win costs here${perWin}. Most likely, with the range it could be. It isn't his asking price or an offer, and it isn't what he's worth to your club: fit, need and budget are yours to weigh. Below the minimum means he is expected to play below a replacement-level player.` },
    { label: `${y} salary`, value: "What he's paid this season by his current club, as the export states it." },
  ];
}

const AGE_BANDS: Array<{ id: string; title: string; keeps: (age: number) => boolean }> = [
  { id: 'young', title: '27 and under', keeps: (a) => a <= 27 },
  { id: 'prime', title: '28 to 31', keeps: (a) => a >= 28 && a <= 31 },
  { id: 'older', title: '32 and over', keeps: (a) => a >= 32 },
];

function rowOf(ctx: OfficeContext, p: FreeAgentRow | MightReachRow, thin: Map<string, { name: string; wins: number }>, fillOf: FillOf, y: string, n: string): OfficeRow {
  const why = 'why' in p ? p.why : null;
  const fill = fillOf(p.player_id);
  const scoutedKnown = p.scouted.now !== null && p.scouted.ceiling !== null;
  const scouted = scoutedKnown
    ? cell(`${p.scouted.now} → ${p.scouted.ceiling}`, { hint: fill ? fill.hint : 'Now → ceiling, on the scouts\' scale' })
    : p.scouted.now !== null || p.scouted.ceiling !== null
      ? cell(`${p.scouted.now ?? 'Not scouted'} → ${p.scouted.ceiling ?? 'not scouted'}`, { hint: fill ? fill.hint : 'Now → ceiling; a grade not given is left blank' })
      : cell('Not scouted', { tone: 'unknown', hint: "His tools haven't been graded by your scouts" });
  const winsNow = winsCell(p.winsNow, p.winsReason);
  const winsNext = winsCell(p.winsNext, p.winsReason);
  const m = p.market;
  const known = m.status === 'known' && m.central !== null && m.low !== null && m.high !== null;
  const market = known
    ? { cell: cell(signedMoney(m.central!), { hint: hintIf(`Could be ${rangeText(m.low!, m.high!, signedMoney)}`) }), sort: m.central }
    : { cell: cell('Not known', { tone: 'unknown', hint: hintIf(m.reason) ?? 'Not established' }), sort: null };
  const salary = p.salaryNow === null
    ? { cell: cell('Not known', { tone: 'unknown', hint: hintIf(p.salaryNote) ?? "His salary isn't in the export" }), sort: null }
    : { cell: cell(money(p.salaryNow)), sort: p.salaryNow };
  const thinHere = thin.get(p.positionName);
  const position = p.positionName && p.positionName !== '?' ? p.positionName : null;
  const facts: OfficeFact[] = [];
  if (p.team) facts.push(fact('His club now', p.team));
  if (why) facts.push(fact('Why he might reach it', why.label));
  if (thinHere) facts.push(fact('Thin spot', `${p.positionName} is one of your thinnest positions: your best there, ${thinHere.name}, is expected to add ${signedTenths(thinHere.wins)} wins the rest of this season.`));
  if (p.salaryNote) facts.push(fact('Salary', p.salaryNote));
  if ((!p.winsNext || !p.winsNow) && p.winsReason) facts.push(fact('Production', p.winsReason));
  const marketClaim = claim({
    text: `${n} at the market: ${market.cell.display}`,
    tone: known ? 'neutral' : 'unknown',
    basis: basis({
      because: known
        ? [{ label: 'Most likely', value: signedMoney(m.central!) }, { label: 'Could be', value: rangeText(m.low!, m.high!, signedMoney) }, { label: 'How it is read', value: m.text }]
        : [{ label: 'Why not', value: m.reason ?? m.text }],
      source: officeSource(ctx, SPECIALIST),
      unknown: known ? [] : [m.reason ?? m.text],
      wouldChange: [],
      lean: null,
      certainty: known ? 'policy' : 'unknown',
      ...(known ? { stamp: "One season of his production at the league's price of a win: never an asking price" } : {}),
    }),
  });
  return officeRow(`fa-${p.player_id}`, {
    player: cell(p.name),
    position: position ? cell(position, thinHere ? { hint: 'One of your thinnest positions' } : {}) : cell('Not given', { tone: 'unknown' }),
    why: why ? cell(why.label, { hint: hintIf(why.reason) }) : cell('—', { hint: 'Not on the might-reach list' }),
    club: cell(p.team ?? 'No club', p.team ? {} : { hint: 'No club holds him' }),
    age: p.age === null ? cell('Not known', { tone: 'unknown', hint: "His age isn't in the export" }) : cell(String(p.age)),
    scouted,
    winsNow: winsNow.cell,
    winsNext: winsNext.cell,
    market: market.cell,
    salary: salary.cell,
  }, {
    player: p.name,
    position,
    why: why ? why.label : null,
    club: p.team,
    age: p.age,
    scouted: p.scouted.now,
    winsNow: winsNow.sort,
    winsNext: winsNext.sort,
    market: market.sort,
    salary: salary.sort,
  }, {
    player: officePlayer(p.player_id, p.name),
    facts,
    claims: why
      ? [marketClaim, claim({
          text: `Why he might reach the market: ${why.label}`,
          tone: 'unknown',
          basis: basis({
            because: [{ label: 'Why', value: why.reason }],
            source: officeSource(ctx, 'Player Rights, through Player Value'),
            unknown: [why.reason],
            wouldChange: ['The option decided, or his service settled at the next import.'],
            lean: null,
            certainty: 'unknown',
          }),
        })]
      : [marketClaim],
    ratingsFill: fill ? cell(fill.mark, { hint: fill.hint }) : null,
  });
}

function listOf(
  ctx: OfficeContext,
  id: 'available' | 'upcoming' | 'mightReach',
  title: string,
  explain: string,
  players: ReadonlyArray<FreeAgentRow | MightReachRow>,
  args: { thin: Map<string, { name: string; wins: number }>; fillOf: FillOf; y: string; n: string; empty: string; note: string | null; order: string; price: FreeAgents['price'] },
): FinanceFreeAgentList {
  const rows = players.map((p) => rowOf(ctx, p, args.thin, args.fillOf, args.y, args.n));
  const ids = (keep: (p: FreeAgentRow) => boolean) => players.filter(keep).map((p) => `fa-${p.player_id}`);
  const filters: OfficeFilterGroup[] = [];
  const all = rows.map((r) => r.id);
  if (players.some((p) => p.isPitcher) && players.some((p) => !p.isPitcher)) {
    filters.push({ id: 'side', title: cell('Players'), choices: [filterChoice('all', cell('All players'), all), filterChoice('pitchers', cell('Pitchers'), ids((p) => p.isPitcher)), filterChoice('hitters', cell('Position players'), ids((p) => !p.isPitcher))] });
  }
  const positions = [...new Set(players.map((p) => p.positionName).filter((x) => x && x !== '?'))].sort();
  if (positions.length > 1) {
    filters.push({ id: 'position', title: cell('Position'), choices: [filterChoice('all', cell('Any position'), all), ...positions.map((pos) => filterChoice(pos, cell(pos), ids((p) => p.positionName === pos)))] });
  }
  if (players.length > 0) {
    filters.push({ id: 'age', title: cell('Age'), choices: [filterChoice('all', cell('Any age'), all), ...AGE_BANDS.map((b) => filterChoice(b.id, cell(b.title), ids((p) => p.age !== null && b.keeps(p.age))))] });
  }
  if (args.thin.size > 0 && players.some((p) => args.thin.has(p.positionName))) {
    filters.push({ id: 'thin', title: cell('Thin spots'), choices: [filterChoice('all', cell('Every position'), all), filterChoice('thin', cell('Only our thin spots'), ids((p) => args.thin.has(p.positionName)))] });
  }
  const columns = [
    column('player', 'Player'),
    column('position', 'Pos'),
    ...(id === 'mightReach' ? [column('why', 'Why')] : []),
    column('club', 'Club', { hidden: id === 'available' }),
    column('age', 'Age', { numeric: true }),
    column('scouted', 'Scouted', { numeric: true, hint: 'Now → ceiling, your scouts\' grades' }),
    column('winsNow', `${args.y} wins`, { numeric: true }),
    column('winsNext', `${args.n} wins`, { numeric: true }),
    column('market', `${args.n} at the market`, { numeric: true }),
    ...(id === 'available' ? [] : [column('salary', `${args.y} salary`, { numeric: true })]),
  ];
  // A column not shown in this list is left out of each row too (every row carries exactly the table's columns)
  const shown = new Set(columns.map((c) => c.id));
  const trimmed = rows.map((r) => ({
    ...r,
    cells: Object.fromEntries(Object.entries(r.cells).filter(([k]) => shown.has(k))),
    sort: Object.fromEntries(Object.entries(r.sort).filter(([k]) => shown.has(k))),
  }));
  const table: OfficeTable = { columns, rows: trimmed, empty: cell(args.note ?? args.empty) };
  return {
    id,
    title: cell(title),
    count: players.length,
    explain: claim({
      text: title,
      tone: 'neutral',
      basis: basis({
        because: [{ label: 'Who is listed', value: explain }, { label: 'Order', value: args.order }, ...columnWords(args.y, args.n, args.price)],
        source: officeSource(ctx, 'Player Rights, through Player Value'),
        unknown: args.note ? [args.note] : [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
    }),
    note: id === 'mightReach' && rows.length > 0 ? cell('Each could stay or reach the market; the Why column says why.', { hint: 'An option or opt-out, or a season the save can\'t settle yet' }) : null,
    order: rows.length > 0 ? cell(args.order) : null,
    filters,
    table,
  };
}

export function freeAgentsView(ctx: OfficeContext, f: FreeAgents, fillOf: FillOf): FinanceFreeAgentsView {
  const y = f.seasonYear !== null ? String(f.seasonYear) : 'this season';
  const n = f.nextSeason !== null ? String(f.nextSeason) : 'next season';
  const thinList = f.needs.positions.filter((p) => p.best !== null).slice(0, 3);
  const thin = new Map(thinList.map((p) => [p.positionName, { name: p.best!.name, wins: p.best!.wins }]));
  const args = { thin, fillOf, y, n, order: f.order, price: f.price };
  const lists = [
    listOf(ctx, 'available', 'Available now', "Players no club holds, who last played in this league: free to sign today.", f.currentFAs,
      { ...args, empty: 'No free agents are available in this league right now.', note: f.currentNote }),
    listOf(ctx, 'upcoming', `Free agents after ${y}`, "Players around the league whose club's control ends after this season: they reach the market this winter. Players the club still controls through arbitration or renewal aren't here.", f.upcomingFAs,
      { ...args, empty: `No free agents are set to reach the market after ${y}.`, note: null }),
    listOf(ctx, 'mightReach', 'Might reach the market', "Players around the league who could reach the market after this season or stay: an option or opt-out that would make him a free agent if it's declined, or a season the save can't settle yet. They aren't counted with the free agents, and a player his club keeps whichever way it goes isn't here.", f.mightReach ?? [],
      { ...args, empty: `Nobody else could reach the market after ${y}.`, note: null }),
  ];
  const needsText = thinList.length > 0
    ? `Your thinnest positions: ${thinList.map((p) => `${p.positionName} (best: ${p.best!.name}, ${signedTenths(p.best!.wins)} wins)`).join(' · ')}`
    : 'None of your positions has a projected player yet';
  const notKnown = f.needs.notEstablished.length > 0 ? ` · not known at ${f.needs.notEstablished.join(', ')}` : '';
  const needs = thinList.length > 0 || f.needs.notEstablished.length > 0
    ? claim({
        text: `${needsText}${notKnown}`,
        tone: 'neutral',
        basis: basis({
          because: [{ label: 'What it is', value: TIP_THINNEST }, { label: 'How it is read', value: f.needs.basis },
            ...f.needs.positions.map((p) => ({ label: p.positionName, value: p.best ? `${p.best.name}, ${signedTenths(p.best.wins)} wins` : 'Nobody valued there' }))],
          source: officeSource(ctx, SPECIALIST),
          unknown: f.needs.notEstablished.map((pos) => `Nobody at ${pos} has production established.`),
          wouldChange: [],
          lean: null,
          certainty: 'policy',
          stamp: 'The three positions whose best player is expected to add the fewest wins',
        }),
      })
    : null;
  const price = f.price
    ? perWinLine(ctx, `A win costs about ${money(f.price.band.central)} here`,
        `${f.price.label}: about ${money(f.price.band.central)} a win, could be ${money(f.price.band.low)} to ${money(f.price.band.high)}. It's what clubs in this league pay above the minimum salary for each win a player adds.`, f.price.stage)
    : null;
  const lede = officeLede(ctx, SPECIALIST, "What each player is expected to produce, and what that costs on this league's market", [
    { label: 'How to read it', value: 'Figures are the most likely value with the range they could be; the range is in each figure\'s help tag.' },
    { label: 'Order', value: f.order },
  ]);
  return {
    ...officeHead(ctx, 'Free Agents', lede, SPECIALIST),
    cards: financeCards(ctx, f.finances),
    price,
    needs,
    lists,
    opensOn: f.currentFAs.length > 0 || f.upcomingFAs.length === 0 ? 'available' : 'upcoming',
  };
}
