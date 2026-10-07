/**
 * Finance's Contracts for the Mac app (N12, D-071): what each deal costs, how long the club controls him and what he is
 * worth, as `computeContracts` reads it through Player Value (D-052) and Player Rights (D-023), worded as the React page
 * (`src/pages/Contracts.tsx`) words it. Value describes and never authorizes: no row says re-sign, extend or let go, and
 * nothing is ranked by a hidden score (the table keeps the page's order until the GM sorts a shown column). Pure.
 */
import type { computeContracts } from '../../contracts.js';
import type { BasisLine, Cell } from '../../contract/presentation.js';
import { basis, cell, claim } from '../claim.js';
import {
  column, counted, fact, filterChoice, hintIf, officeHead, officeLede, officePlayer, officeRow, officeSource, paneTable,
  type OfficeContext, type OfficeFact, type OfficeFilterGroup, type OfficeGrid, type OfficeRow,
} from '../officeTable.js';
import { TIP_CONTRACT_VALUE, TIP_KEEPING_HIM } from '../player/words.js';
import type { FinanceContractsView } from './types.js';
import {
  controlEndCell, costCell, costExplanation, costRangeText, financeCards, money, perWinLine, rangeText, signedMoney, signedTenths,
  totalCell, winsCell,
} from './words.js';

type Contracts = ReturnType<typeof computeContracts>;
type ContractRow = Contracts['players'][number];

const SPECIALIST = 'Player Value';
/** How a contract's value is called: the owner's stated surplus policy over Player Value's figures (D-052, Q-3). */
export const VALUE_STAMP = "The owner's value policy: seasons further out count 5% a season less, the price of a win held flat";

/** The groups in the order a GM works through them after the season, with what each means. */
const GROUPS = ['leaving', 'option', 'arbitration', 'pre_arbitration', 'reserve', 'not_settled', 'signed', 'long_term'] as const;
const GROUP_WORDS: Record<(typeof GROUPS)[number], (y: number) => { label: string; tip: string }> = {
  leaving: (y) => ({ label: `Free agents after ${y}`, tip: 'His deal ends and nothing holds him: he can sign anywhere once the season is over.' }),
  option: (y) => ({ label: `Options for ${y + 1}`, tip: 'Next season is an option (the club\'s, his, or both) or he can opt out: it could go either way.' }),
  arbitration: (y) => ({ label: `Arbitration in ${y + 1}`, tip: 'The club still controls him, and an arbitration salary is set for next season: usually a raise, never below this season\'s.' }),
  pre_arbitration: (y) => ({ label: `Pre-arbitration in ${y + 1}`, tip: 'The club renews him at a salary it sets, at or near the league minimum.' }),
  reserve: () => ({ label: 'Reserve clause', tip: 'This league has no free agency: he stays with the club.' }),
  not_settled: (y) => ({ label: `${y + 1} not settled`, tip: "The save can't yet say where he stands next season: his service may cross a line only if he stays up, or a rule isn't in the export. Choose his row for why." }),
  signed: () => ({ label: 'Signed, short term', tip: 'Under contract next season, for one or two more seasons.' }),
  long_term: () => ({ label: 'Long-term deals', tip: 'Under contract three seasons or more past this one: the club\'s long-term commitments.' }),
};

/** The column tips the React page's headings carried, in the lede's basis (a help tag holds about 75 characters). */
function columnWords(y: number): BasisLine[] {
  return [
    { label: 'Player', value: 'Every name opens his own window, with the full value breakdown.' },
    { label: `${y} salary`, value: "What he's paid this season, as the export states it." },
    { label: 'Signed through', value: 'The last season his contract covers, a signed extension included. Options and clauses are listed with his row.' },
    { label: 'Service', value: 'Major-league service in years.days: 2.126 is two years and 126 days of a service year, not 2.1 years. 2.xxx means only whole years are exported.' },
    { label: 'Free agent after', value: 'The last season the club controls him, through his contract, arbitration or renewal. Two seasons means the later one may itself be free agency (an option, or service that crosses the line only if he stays up).' },
    { label: `${y + 1} cost`, value: "What next season costs the club: his salary if a contract covers it, or the projected arbitration or renewal salary, most likely with the range it could be. A projection isn't committed money. \"If kept\" means he may leave instead." },
    { label: `${y + 1} wins`, value: 'His projected wins above replacement (WAR) next season, most likely with the range it could be.' },
    { label: 'Contract value', value: TIP_CONTRACT_VALUE },
    { label: 'Keeping him', value: TIP_KEEPING_HIM },
    { label: 'Our view', value: "His contract value read through the club's philosophy: how it weighs near seasons against far ones, risk, salary, club control and guaranteed money. \"Same\" means the philosophy doesn't lean on him." },
  ];
}

const unitOf = (r: ContractRow): 'dollars' | 'wins' => (r.value?.unit === 'wins' ? 'wins' : 'dollars');

/** Our view's figure: "Same" where the philosophy doesn't lean, the leans in the help tag and the row's claim. */
function oursCell(r: ContractRow): { cell: Cell; sort: number | null } {
  const v = r.ourView;
  const unit = unitOf(r);
  const t = unit === 'wins' ? v?.wins : v?.contract;
  if (!v || !t || t.status !== 'known' || !t.ours) {
    return { cell: cell('Not valued', { tone: 'unknown', hint: hintIf(t?.reason) ?? 'Not valued, so the philosophy has nothing to lean on' }), sort: null };
  }
  const f = t.ours;
  // Sorted on the most likely figure, else the low edge of what it could be: never a midpoint nobody stated (D-018)
  const order = f.central ?? f.centralRange?.low ?? f.low;
  if (!v.leaning) return { cell: cell('Same', { hint: "The philosophy doesn't lean on him" }), sort: order };
  const fmt = unit === 'wins' ? (x: number) => `${signedTenths(x)} wins` : signedMoney;
  const main = f.central !== null ? fmt(f.central) : rangeText(f.centralRange?.low ?? f.low, f.centralRange?.high ?? f.high, fmt);
  const leans = v.leans.map((l) => l.short).join('; ');
  return { cell: cell(main, { hint: hintIf(leans) ?? 'The philosophy leans on him: choose his row for why' }), sort: order };
}

/** His seasons under control: season, status, cost (the declined branch beside it) and wins. */
function seasonsGrid(r: ContractRow): OfficeGrid {
  return {
    title: cell('His seasons under control'),
    columns: [cell('Season'), cell('Status'), cell('Cost'), cell('Wins')],
    rows: r.path.map((s) => {
      const cost = costCell(s.cost, 'Not a cost to this club').cell;
      const declined = s.cost?.declined?.cost
        ? ` · declined: ${s.cost.declined.cost.low !== null && s.cost.declined.cost.high !== null ? costRangeText(s.cost.declined.cost.low, s.cost.declined.cost.high) : 'not known'}`
        : '';
      const wins = s.wins ? cell(signedTenths(s.wins.central), { hint: `Could be ${rangeText(s.wins.low, s.wins.high, signedTenths)} wins` }) : cell('Not projected', { tone: 'unknown' });
      return [cell(String(s.season)), cell(s.label), declined ? cell(`${cost.display}${declined}`, cost.hint ? { hint: cost.hint } : {}) : cost, wins];
    }),
    empty: cell("No seasons under the club's control after this one."),
  };
}

/** What goes with his row on screen: his contract's clauses and what happens after this season, in short words. */
function factsOf(r: ContractRow): OfficeFact[] {
  const out: OfficeFact[] = [];
  if (r.clauses.length > 0) out.push(fact('Contract', r.clauses.join(' · ')));
  if (r.after) out.push(fact('After this season', r.after.label));
  if (r.salaryNow === null) out.push(fact('Salary', 'Not in the export'));
  if (r.ourView?.leaning) out.push(fact('Our view', `${r.ourView.leans.map((l) => l.short).join('; ')}.`));
  return out;
}

/** The notes the React page listed under his seasons, each with its label, for the row's breakdown. */
function notesOf(r: ContractRow): BasisLine[] {
  const out: BasisLine[] = [];
  if (r.after?.detail) out.push({ label: 'After this season', value: r.after.detail });
  if (r.controlEnd.reason) out.push({ label: 'End of control', value: r.controlEnd.reason });
  if (r.salaryNote) out.push({ label: 'Salary', value: r.salaryNote });
  for (const n of r.clauseNotes ?? []) out.push({ label: 'Contract', value: n });
  if (r.value && r.value.status !== 'valued') {
    const why = (unitOf(r) === 'wins' ? r.value.wins : r.value.contract).reason ?? r.value.reason;
    if (why) out.push({ label: 'Value', value: why });
  }
  if (!r.wins && r.winsReason) out.push({ label: 'Wins next season', value: r.winsReason });
  if (r.seasonForm?.line) out.push({ label: 'This season', value: `${r.seasonForm.line}.` });
  return out;
}

function rowOf(ctx: OfficeContext, r: ContractRow, y: number): OfficeRow {
  const unit = unitOf(r);
  const salary = r.salaryNow === null
    ? { cell: cell('Not known', { tone: 'unknown', hint: hintIf(r.salaryNote) ?? "His salary isn't in the export" }), sort: null }
    : { cell: cell(money(r.salaryNow)), sort: r.salaryNow };
  const signed = r.signedThrough === null
    ? { cell: cell('No terms', { tone: 'unknown', hint: hintIf(r.salaryNote) ?? "His contract's terms aren't in the export" }), sort: null }
    : { cell: cell(String(r.signedThrough), { hint: hintIf(r.clauses.join(' · ')) }), sort: r.signedThrough };
  const service = r.service
    ? { cell: cell(r.service), sort: Number.parseFloat(r.service.replace(/x+$/, '0')) }
    : { cell: cell('Not known', { tone: 'unknown', hint: "His service time isn't in the export" }), sort: null };
  const control = controlEndCell(r.controlEnd);
  const afterLabel = r.after?.label;
  const controlCell = afterLabel ? cell(control.cell.display, { ...(control.cell.tone ? { tone: control.cell.tone } : {}), hint: hintIf(control.cell.hint ? `${afterLabel}. ${control.cell.hint}` : afterLabel) ?? afterLabel }) : control.cell;
  const next = costCell(r.nextCost, r.group === 'leaving' ? 'A free agent after this season: no cost to this club' : 'Not established');
  const wins = winsCell(r.wins, r.winsReason);
  const contract = totalCell(unit === 'wins' ? r.value?.wins : r.value?.contract, unit, r.value?.reason ?? null);
  const keeping = unit === 'wins'
    ? totalCell(null, 'wins', 'In a league without dollars, only his wins are shown.')
    : totalCell(r.value?.retention, 'dollars', r.value?.reason ?? null);
  const ours = oursCell(r);
  const position = r.positionName && r.positionName !== '?' ? r.positionName : null;

  // The two value figures and our view with their full explanation, a click away
  const valueClaim = (text: string, total: { explain: string; cell: Cell }, tip: string) => claim({
    text: `${text}: ${total.cell.display}`,
    tone: total.cell.tone === 'unknown' ? 'unknown' : 'neutral',
    basis: basis({
      because: [{ label: 'What it is', value: tip }, { label: 'His figure', value: total.explain }],
      source: officeSource(ctx, SPECIALIST),
      unknown: total.cell.tone === 'unknown' ? [total.explain] : [],
      wouldChange: [],
      lean: null,
      certainty: total.cell.tone === 'unknown' ? 'unknown' : 'policy',
      ...(total.cell.tone === 'unknown' ? {} : { stamp: VALUE_STAMP }),
    }),
  });
  const claims = [
    valueClaim('Contract value', contract, TIP_CONTRACT_VALUE),
    ...(unit === 'dollars' ? [valueClaim('Keeping him', keeping, TIP_KEEPING_HIM)] : []),
  ];
  if (r.nextCost) {
    claims.push(claim({
      text: `${y + 1} cost: ${next.cell.display}`,
      tone: r.nextCost.low === null ? 'unknown' : 'neutral',
      basis: basis({
        because: [{ label: 'His cost', value: costExplanation(r.nextCost) }],
        source: officeSource(ctx, SPECIALIST),
        unknown: r.nextCost.low === null ? [r.nextCost.text] : [],
        wouldChange: [],
        lean: null,
        certainty: r.nextCost.low === null ? 'unknown' : r.nextCost.source === 'measured' ? 'calibrated' : 'provisional',
        ...(r.nextCost.low === null ? {} : { stamp: r.nextCost.source === 'measured' ? 'Measured on this save\'s contracts' : 'Partly a starting estimate, not yet measured on this save' }),
      }),
    }));
  }
  const notes = notesOf(r);
  if (notes.length > 0) {
    claims.push(claim({
      text: 'What his figures rest on',
      tone: 'neutral',
      basis: basis({ because: notes, source: officeSource(ctx, SPECIALIST), unknown: [], wouldChange: [], lean: null, certainty: 'fact' }),
    }));
  }
  if (r.ourView?.leaning) {
    claims.push(claim({
      text: `Our view: ${ours.cell.display}`,
      tone: 'neutral',
      basis: basis({
        because: r.ourView.leans.map((l) => ({ label: l.short, value: l.text })),
        source: officeSource(ctx, 'Player Value, read through the club\'s philosophy'),
        unknown: [],
        wouldChange: ['Changing the club\'s philosophy.'],
        lean: { neutral: `Contract value ${contract.cell.display}`, why: r.ourView.leans.map((l) => l.text) },
        certainty: 'policy',
        stamp: 'The club\'s philosophy, as set',
      }),
    }));
  }

  return officeRow(`contract-${r.player_id}`, {
    player: cell(r.name),
    position: position ? cell(position) : cell('Not given', { tone: 'unknown' }),
    age: cell(String(r.age)),
    salary: salary.cell,
    signed: signed.cell,
    service: service.cell,
    control: controlCell,
    nextCost: next.cell,
    wins: wins.cell,
    contract: contract.cell,
    keeping: keeping.cell,
    ours: ours.cell,
  }, {
    player: r.name,
    position,
    age: r.age,
    salary: salary.sort,
    signed: signed.sort,
    service: service.sort,
    control: control.sort,
    nextCost: next.sort,
    wins: wins.sort,
    contract: contract.sort,
    keeping: keeping.sort,
    ours: ours.sort,
  }, {
    player: officePlayer(r.player_id, r.name, ctx.orgId),
    facts: factsOf(r),
    claims,
    grid: seasonsGrid(r),
    filterKeys: { group: r.group, side: r.positionName === 'P' ? 'pitchers' : 'hitters' },
  });
}

export function contractsView(ctx: OfficeContext, c: Contracts): FinanceContractsView {
  const y = c.seasonYear;
  const rows = c.players.map((r) => rowOf(ctx, r, y));
  const groups = GROUPS.filter((g) => c.players.some((r) => r.group === g)).map((g) => {
    const members = c.players.filter((r) => r.group === g);
    const known = members.filter((r) => r.salaryNow !== null);
    const sum = known.reduce((s, r) => s + (r.salaryNow ?? 0), 0);
    const unknown = members.length - known.length;
    const words = GROUP_WORDS[g](y);
    const title = `${members.length} · ${words.label} · ${money(sum)} in ${y}${unknown > 0 ? ` + ${unknown} not known` : ''}`;
    // What the group means is the title's help tag; its count, salary and any salary not in the export are in the title
    return filterChoice(g, cell(title, { hint: hintIf(words.tip) }));
  });
  const filters: OfficeFilterGroup[] = [];
  if (groups.length > 0) {
    filters.push({ id: 'group', title: cell('Group'), choices: [filterChoice('all', cell('Every group')), ...groups] });
  }
  if (c.players.some((r) => r.positionName === 'P') && c.players.some((r) => r.positionName !== 'P')) {
    filters.push({
      id: 'side',
      title: cell('Players'),
      choices: [filterChoice('all', cell('All players')), filterChoice('pitchers', cell('Pitchers')), filterChoice('hitters', cell('Position players'))],
    });
  }

  const lede = officeLede(ctx, SPECIALIST, "What each deal costs, how long the club controls him and what he's worth", [
    { label: 'How to read it', value: 'Figures are the most likely value with the range they could be; the range is in each figure\'s help tag.' },
    ...columnWords(y),
  ]);
  const price = c.price
    ? perWinLine(ctx, `A win costs about ${'$'}${(c.price.band.central / 1e6).toFixed(2)}M on this league's market`, c.price.text, c.price.stage)
    : null;
  return {
    ...officeHead(ctx, 'Contracts', lede, SPECIALIST),
    heading: cell(`Contracts after ${y}`),
    cards: financeCards(ctx, c.finances),
    price,
    filters,
    table: paneTable({
      columns: [
        column('player', 'Player'),
        column('position', 'Pos'),
        column('age', 'Age', true),
        column('salary', `${y} salary`, true),
        column('signed', 'Signed through', true),
        column('service', 'Service', true, { hint: 'Years.days of major-league service' }),
        column('control', 'Free agent after', true),
        column('nextCost', `${y + 1} cost`, true),
        column('wins', `${y + 1} wins`, true),
        column('contract', 'Contract value', true),
        column('keeping', 'Keeping him', true),
        column('ours', 'Our view', true),
      ],
      rows,
      empty: cell('No contracts on the club\'s roster to show.'),
    }),
  };
}
