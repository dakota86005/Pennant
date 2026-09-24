import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getContracts, type ClubFinanceCards, type ContractGroup, type ContractRow, type ContractsResponse, type SeasonCostData,
} from '../api';
import { costBandText, costMoney } from '../costBand';
import { openPlayer, PlayerLink } from '../playerModal';
import { formatWins } from '../productionConeGeometry';
import { Tip } from '../Tip';
import { TIP_CONTRACT_VALUE, TIP_KEEPING_HIM } from '../ValueSection';
import { controlEndWords, freshnessWords, rangeText, signedMoney, totalWords, type TotalWords } from '../valueWords';

/**
 * The Contracts page (Player Value phase 6a, PLAYER_VALUE.md Part 8): every contract on the club's roster, what happens
 * after this season and when control ends, next season's cost and the cost of each controlled season, his expected wins,
 * his contract value and the value of keeping him, and our view under the club's philosophy. Every figure is Player
 * Value's, as served (`/api/contracts/:orgId`); the browser computes nothing about a player. It describes and never
 * authorizes (D-052): the GM reads the facts and the ranges and decides. Plain words on the page, the explanations in
 * the hovers (AGENTS.md "Writing for the GM").
 */

export const money = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
};

/**
 * Club Finances' figures (D-052), the same Payroll shows: a figure the export does not state reads
 * "unknown", never $0, and room is only worked out from two known figures (D-18).
 */
export function FinanceCards({ finances }: { finances: ClubFinanceCards | null }) {
  if (!finances) return null;
  const figure = (v: number | null) => (v === null ? 'unknown' : money(v));
  const room = finances.budget !== null && finances.payroll !== null ? finances.budget - finances.payroll : null;
  const roomNext = finances.budget !== null && finances.payrollNextSeason !== null ? finances.budget - finances.payrollNextSeason : null;
  const tone = (v: number | null) => (v === null ? undefined : v < 0 ? 'bad' : 'good');
  const cards: Array<[string, string, string | undefined, string | null | undefined]> = [
    ['Budget', figure(finances.budget), undefined, finances.sources?.budget],
    ['Payroll now', figure(finances.payroll), undefined, finances.sources?.payroll],
    ['Room now', figure(room), tone(room), null],
    ['Payroll next season (OOTP estimate)', figure(finances.payrollNextSeason), undefined, finances.sources?.payrollNextSeason],
    ['Room next season', figure(roomNext), tone(roomNext), null],
    ['Cash for trades', figure(finances.cash), undefined, finances.sources?.cash],
  ];
  return (
    <div className="cards">
      {cards.map(([label, value, t, source]) => (
        <div key={label} className="card" title={source ?? undefined}>
          <span className="card-label">{label}</span>
          <span className={`card-value ${t ?? ''}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/** "$4.6M–$25.3M", or "$780K–$790K" where the edges round alike: a band never reads as a point (phase 4a review). */
export const band = (low: number, high: number): string => costBandText(low, high);

// ── the groups ───────────────────────────────────────────────────────────────

/** The groups in the order a GM works through them after the season. */
const GROUPS: ContractGroup[] = ['leaving', 'option', 'arbitration', 'pre_arbitration', 'reserve', 'not_settled', 'signed', 'long_term'];

const GROUP_WORDS: Record<ContractGroup, (season: number) => { label: string; tip: string }> = {
  leaving: (y) => ({ label: `Free agents after ${y}`, tip: 'His deal ends and nothing holds him: he can sign anywhere once the season is over.' }),
  option: (y) => ({ label: `Options for ${y + 1}`, tip: 'Next season is an option (the club\'s, his, or both) or he can opt out: it could go either way.' }),
  arbitration: (y) => ({ label: `Arbitration in ${y + 1}`, tip: 'The club still controls him, and an arbitration salary is set for next season: usually a raise, never below this season\'s.' }),
  pre_arbitration: (y) => ({ label: `Pre-arbitration in ${y + 1}`, tip: 'The club renews him at a salary it sets, at or near the league minimum.' }),
  reserve: () => ({ label: 'Reserve clause', tip: 'This league has no free agency: he stays with the club.' }),
  not_settled: (y) => ({ label: `${y + 1} not settled`, tip: "The save can't yet say where he stands next season: his service may cross a line only if he stays up, or a rule isn't in the export. Open his row for why." }),
  signed: () => ({ label: 'Signed, short term', tip: 'Under contract next season, for one or two more seasons.' }),
  long_term: () => ({ label: 'Long-term deals', tip: 'Under contract three seasons or more past this one: the club\'s long-term commitments.' }),
};

// ── the columns ──────────────────────────────────────────────────────────────

export type SortKey = 'name' | 'salary' | 'signed' | 'service' | 'control' | 'nextCost' | 'wins' | 'contract' | 'keeping' | 'ours';
type Dir = 'asc' | 'desc';

const unitOf = (r: ContractRow): 'dollars' | 'wins' => (r.value?.unit === 'wins' ? 'wins' : 'dollars');
const contractWords = (r: ContractRow): TotalWords => totalWords(unitOf(r) === 'wins' ? r.value?.wins : r.value?.contract, unitOf(r), r.value?.reason ?? null);
const keepingWords = (r: ContractRow): TotalWords =>
  (unitOf(r) === 'wins' ? totalWords(null, 'wins', 'In a league without dollars, only his wins are shown.') : totalWords(r.value?.retention, 'dollars', r.value?.reason ?? null));

/** The cost of a season to sort by: its most likely figure, or the middle of its band; null where unknown. */
function costOrder(c: SeasonCostData | null | undefined): number | null {
  if (!c || c.low === null || c.high === null) return null;
  return c.central ?? (c.low + c.high) / 2;
}

/** Our view's contract figure to sort by. */
function oursOrder(r: ContractRow): number | null {
  const t = unitOf(r) === 'wins' ? r.ourView?.wins : r.ourView?.contract;
  const f = t?.ours;
  if (!f || t?.status !== 'known') return null;
  return f.central ?? (f.centralRange ? (f.centralRange.low + f.centralRange.high) / 2 : (f.low + f.high) / 2);
}

const ORDER: Record<SortKey, (r: ContractRow) => number | string | null> = {
  name: (r) => r.name,
  salary: (r) => r.salaryNow,
  signed: (r) => r.signedThrough,
  service: (r) => (r.service ? Number.parseFloat(r.service.replace(/x+$/, '0')) : null),
  control: (r) => (r.controlEnd.high !== null ? r.controlEnd.high + (r.controlEnd.pastHorizon ? 0.5 : 0)
    : r.controlEnd.laterUnknown && r.controlEnd.low !== null ? r.controlEnd.low + 0.25 : null),
  nextCost: (r) => costOrder(r.nextCost),
  wins: (r) => r.wins?.central ?? null,
  contract: (r) => contractWords(r).order,
  keeping: (r) => keepingWords(r).order,
  ours: oursOrder,
};

/**
 * The rows ordered by a column. An unknown figure sorts after every known one whichever way the column is ordered (it is
 * not a zero and not a low value, D-018); ties keep the page's order (group, then salary).
 */
export function sortRows<T extends ContractRow>(rows: T[], key: SortKey | null, dir: Dir): T[] {
  if (key === null) return rows;
  const read = ORDER[key];
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: read(r) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === 'string' ? a.v.localeCompare(b.v as string) : (a.v as number) - (b.v as number);
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.r);
}

const COLUMNS: Array<{ key: SortKey; label: (y: number) => string; tip: string; num: boolean; first: Dir }> = [
  { key: 'name', label: () => 'Player', tip: 'Click a row to open his card.', num: false, first: 'asc' },
  { key: 'salary', label: (y) => `${y} salary`, tip: "What he's paid this season, as the export states it.", num: true, first: 'desc' },
  { key: 'signed', label: () => 'Signed through', tip: 'The last season his contract covers, a signed extension included. Options and clauses are listed under it.', num: true, first: 'asc' },
  { key: 'service', label: () => 'Service', tip: 'Major-league service in years.days: 2.126 is two years and 126 days of a service year, not 2.1 years. 2.xxx means only whole years are exported.', num: true, first: 'desc' },
  { key: 'control', label: () => 'Free agent after', tip: "The last season the club controls him, through his contract, arbitration or renewal. Two seasons means the later one may itself be free agency (an option, or service that crosses the line only if he stays up).", num: true, first: 'asc' },
  { key: 'nextCost', label: (y) => `${y + 1} cost`, tip: "What next season costs the club: his salary if a contract covers it, or the projected arbitration or renewal salary, most likely with the range it could be. A projection isn't committed money. \"If kept\" means he may leave instead.", num: true, first: 'desc' },
  { key: 'wins', label: (y) => `${y + 1} wins`, tip: 'His projected wins above replacement (WAR) next season, most likely with the range it could be.', num: true, first: 'desc' },
  { key: 'contract', label: () => 'Contract value', tip: TIP_CONTRACT_VALUE, num: true, first: 'desc' },
  { key: 'keeping', label: () => 'Keeping him', tip: TIP_KEEPING_HIM, num: true, first: 'desc' },
  { key: 'ours', label: () => 'Our view', tip: "His contract value read through the club's philosophy: how it weighs near seasons against far ones, risk, salary, club control and guaranteed money. \"Same\" means the philosophy doesn't lean on him. Hover a figure for what moved it.", num: true, first: 'desc' },
];

// ── the cells ────────────────────────────────────────────────────────────────

/** A figure over its range, both at the pages' precision; an unknown is a short word with its reason on hover. */
function Figure({ main, sub, unknown, reason }: { main: string; sub?: string | null; unknown?: boolean; reason?: string | null }) {
  if (unknown) return <span className="contracts-figure muted"><Tip label={main} tip={reason ?? 'Not established.'} /></span>;
  return (
    <>
      <span className="contracts-figure">{main}</span>
      {sub ? <span className="contracts-sub">{sub}</span> : null}
    </>
  );
}

function TotalCell({ w }: { w: TotalWords }) {
  if (!w.known) return <Figure main="not valued" unknown reason={w.reason} />;
  const over = w.seasons ? `Over ${w.seasons}, seasons further out counting a little less: ` : '';
  const tip = w.mostLikely
    ? `${over}most likely ${w.figure}, could be ${w.couldBe}.`
    : `${over}no single most likely figure: ${w.figure} depending on a season that could go more than one way (open his card for which); could be ${w.couldBe}.`;
  return (
    <>
      <span className="contracts-figure"><Tip label={w.figure} tip={tip} /></span>
      <span className="contracts-sub">{w.couldBe}</span>
    </>
  );
}

/** A season's cost: most likely over its range, "if kept" where he may leave; unknown with its reason. */
function CostCell({ c, none }: { c: SeasonCostData | null | undefined; none: string }) {
  if (!c) return <Figure main="—" unknown reason={none} />;
  if (c.low === null || c.high === null) return <Figure main="not known" unknown reason={c.text} />;
  const held = c.ifHeld ? ' if kept' : '';
  if (c.low === c.high) return <Figure main={`${costMoney(c.low)}${held}`} />;
  const main = c.central !== null ? costMoney(c.central) : costBandText(c.low, c.high);
  return <Figure main={`${main}${held}`} sub={costBandText(c.low, c.high)} />;
}

function WinsCell({ r }: { r: ContractRow }) {
  if (!r.wins) return <Figure main="not known" unknown reason={r.winsReason} />;
  return <Figure main={formatWins(r.wins.central)} sub={rangeText(r.wins.low, r.wins.high, formatWins)} />;
}

function OursCell({ r }: { r: ContractRow }) {
  const v = r.ourView;
  const unit = unitOf(r);
  const t = unit === 'wins' ? v?.wins : v?.contract;
  if (!v || !t || t.status !== 'known' || !t.ours) return <Figure main="—" unknown reason={t?.reason ?? 'Not valued, so the philosophy has nothing to lean on.'} />;
  if (!v.leaning) return <span className="muted">same</span>;
  const f = t.ours;
  const fmt = unit === 'wins' ? (x: number) => `${formatWins(x)} wins` : signedMoney;
  const main = f.central !== null ? fmt(f.central) : rangeText(f.centralRange?.low ?? f.low, f.centralRange?.high ?? f.high, fmt);
  const leans = v.leans.map((l) => l.text).join(' ');
  return <span className="contracts-figure"><Tip label={main} tip={leans || 'The philosophy leans on him.'} /></span>;
}

function SortHeader({ col, season, sort, onSort }: {
  col: (typeof COLUMNS)[number]; season: number; sort: { key: SortKey | null; dir: Dir }; onSort: (k: SortKey) => void;
}) {
  const active = sort.key === col.key;
  const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className={`sortable${active ? ' sorted' : ''}${col.num ? ' num' : ''}`} aria-sort={aria} scope="col">
      <button type="button" onClick={() => onSort(col.key)}>
        <Tip label={col.label(season)} tip={col.tip} />
        {active && <span className="sort-arrow" aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

/** What his row opens to: the seasons of his control with their cost and wins, and what the figures rest on. */
function Detail({ r, span }: { r: ContractRow; span: number }) {
  const notes: ReactNode[] = [];
  if (r.after?.detail) notes.push(<>After this season: {r.after.detail}</>);
  if (r.controlEnd.reason) notes.push(<>End of control: {r.controlEnd.reason}</>);
  if (r.salaryNote) notes.push(<>Salary: {r.salaryNote}</>);
  for (const n of r.clauseNotes ?? []) notes.push(<>Contract: {n}</>);
  if (r.value && r.value.status !== 'valued') {
    const why = (unitOf(r) === 'wins' ? r.value.wins : r.value.contract).reason ?? r.value.reason;
    if (why) notes.push(<>Value: {why}</>);
  }
  if (!r.wins && r.winsReason) notes.push(<>Wins next season: {r.winsReason}</>);
  if (r.ourView?.leaning) notes.push(<>Our view: {r.ourView.leans.map((l) => l.short).join('; ')}.</>);
  if (r.seasonForm?.line) notes.push(<>This season: {r.seasonForm.line}.</>);
  return (
    <tr className="contracts-detail-row">
      <td colSpan={span}>
        <div className="contracts-detail">
          {r.path.length > 0 ? (
            <table className="mini contracts-path">
              <caption className="muted">His seasons under control</caption>
              <thead>
                <tr><th scope="col">Season</th><th scope="col">Status</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Wins</th></tr>
              </thead>
              <tbody>
                {r.path.map((s) => (
                  <tr key={s.season}>
                    <td>{s.season}</td>
                    <td>{s.label}</td>
                    <td className="num"><CostCell c={s.cost} none="Not a cost to this club." />{s.cost?.declined?.cost ? <span className="contracts-sub">declined: {s.cost.declined.cost.low !== null && s.cost.declined.cost.high !== null ? costBandText(s.cost.declined.cost.low, s.cost.declined.cost.high) : 'not known'}</span> : null}</td>
                    <td className="num">{s.wins ? <Figure main={formatWins(s.wins.central)} sub={rangeText(s.wins.low, s.wins.high, formatWins)} /> : <span className="muted">not projected</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No seasons under the club's control after this one.</p>
          )}
          {notes.length > 0 && <ul className="contracts-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <button type="button" className="link-button" onClick={() => openPlayer(r.player_id)}>Open his card for the full value breakdown</button>
        </div>
      </td>
    </tr>
  );
}

function Row({ r, open, onToggle, span }: { r: ContractRow; open: boolean; onToggle: () => void; span: number }) {
  const salary = r.salaryNow !== null ? <Figure main={costMoney(r.salaryNow)} /> : <Figure main="not known" unknown reason={r.salaryNote} />;
  const end = controlEndWords(r.controlEnd);
  const noCost = r.group === 'leaving' ? 'A free agent after this season: no cost to this club.' : 'Not established.';
  return (
    <Fragment>
      <tr className={`contracts-row${open ? ' open' : ''}`} onClick={() => openPlayer(r.player_id)}>
        <td className="contracts-toggle">
          <button type="button" className="contracts-expand" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${r.name}'s seasons`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        </td>
        <td className="name">
          <span onClick={(e) => e.stopPropagation()}><PlayerLink id={r.player_id}>{r.name}</PlayerLink></span>
          <span className="contracts-sub">{r.positionName} · {r.age}</span>
        </td>
        <td className="num">{salary}</td>
        <td className="num">
          {r.signedThrough !== null ? <span className="contracts-figure">{r.signedThrough}</span> : <Figure main="no terms" unknown reason={r.salaryNote} />}
          {r.clauses.length > 0 && <span className="contracts-sub">{r.clauses.join(' · ')}</span>}
        </td>
        <td className="num">{r.service ? r.service : <Figure main="not known" unknown reason="His service time isn't in the export." />}</td>
        <td className="num">
          {end.known
            ? (r.controlEnd.reason ? <span className="contracts-figure"><Tip label={end.short} tip={r.controlEnd.reason} /></span> : <span className="contracts-figure">{end.short}</span>)
            : <Figure main="not known" unknown reason={r.controlEnd.reason} />}
          {r.after && <span className="contracts-sub">{r.after.detail ? <Tip label={r.after.label} tip={r.after.detail} /> : r.after.label}</span>}
        </td>
        <td className="num"><CostCell c={r.nextCost} none={noCost} /></td>
        <td className="num"><WinsCell r={r} /></td>
        <td className="num"><TotalCell w={contractWords(r)} /></td>
        <td className="num"><TotalCell w={keepingWords(r)} /></td>
        <td className="num"><OursCell r={r} /></td>
      </tr>
      {open && <Detail r={r} span={span} />}
    </Fragment>
  );
}

type Side = 'all' | 'pitchers' | 'hitters';

/** The page's body: pure, renders what it is given (the tests render it straight from the route). */
export function ContractsView({ data }: { data: ContractsResponse }) {
  const [only, setOnly] = useState<ContractGroup | null>(null);
  const [side, setSide] = useState<Side>('all');
  const [find, setFind] = useState('');
  const [sort, setSort] = useState<{ key: SortKey | null; dir: Dir }>({ key: null, dir: 'asc' });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const season = data.seasonYear;

  const groups = GROUPS
    .map((key) => {
      const players = data.players.filter((p) => p.group === key);
      const known = players.filter((p) => p.salaryNow !== null);
      return { key, players, money: known.reduce((sum, p) => sum + (p.salaryNow ?? 0), 0), unknown: players.length - known.length };
    })
    .filter((g) => g.players.length > 0);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    const rows = data.players.filter((p) =>
      (only === null || p.group === only)
      && (side === 'all' || (side === 'pitchers') === (p.positionName === 'P'))
      && (needle === '' || p.name.toLowerCase().includes(needle)));
    return sortRows(rows, sort.key, sort.dir);
  }, [data.players, only, side, find, sort]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: COLUMNS.find((c) => c.key === key)?.first ?? 'asc' }));
  const toggle = (id: number) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const fresh = freshnessWords(data.freshness);
  const span = COLUMNS.length + 1;
  const filtered = only !== null || side !== 'all' || find.trim() !== '';

  return (
    <div className="contracts-page">
      <FinanceCards finances={data.finances} />

      <section>
        <div className="contracts-head">
          <h2>Contracts after {season}</h2>
          <span className={`contracts-asof dossier-asof-${fresh.tone}`}>
            <Tip label={[fresh.asOf, fresh.warning].filter(Boolean).join(' · ') || 'Date not known'} tip={fresh.tip} focusable />
          </span>
        </div>
        <p className="muted hint-line">
          What each deal costs, how long the club controls him and what he&rsquo;s worth. Figures are the most likely value
          with the range they could be; hover a heading or a figure for how to read it.
          {data.price && (
            <> <Tip label={`A win costs about $${(data.price.band.central / 1_000_000).toFixed(2)}M on this league's market`} tip={data.price.text} focusable />.</>
          )}
        </p>

        {data.players.length === 0 ? (
          <p className="muted contracts-empty">No contracts on the club&rsquo;s roster to show.</p>
        ) : (
          <>
            <div className="status-chips" role="group" aria-label="Show a group">
              {groups.map((g) => {
                const words = GROUP_WORDS[g.key](season);
                return (
                  <button key={g.key} type="button" className={`status-chip ${only === g.key ? 'active' : ''}`} aria-pressed={only === g.key}
                    title={words.tip} onClick={() => setOnly(only === g.key ? null : g.key)}>
                    <strong>{g.players.length}</strong>
                    <span>{words.label}</span>
                    <span className="muted">{money(g.money)} in {season}{g.unknown > 0 ? ` + ${g.unknown} not known` : ''}</span>
                  </button>
                );
              })}
            </div>

            <div className="contracts-filters">
              <label>
                Show{' '}
                <select value={side} onChange={(e) => setSide(e.target.value as Side)}>
                  <option value="all">All players</option>
                  <option value="pitchers">Pitchers</option>
                  <option value="hitters">Position players</option>
                </select>
              </label>
              <input type="search" placeholder="Find a player" aria-label="Find a player" value={find} onChange={(e) => setFind(e.target.value)} />
              {filtered && <button type="button" className="link-button" onClick={() => { setOnly(null); setSide('all'); setFind(''); }}>Show everyone</button>}
              <span className="muted">{shown.length} of {data.players.length}</span>
            </div>

            {shown.length === 0 ? (
              <p className="muted contracts-empty">No players match these filters.</p>
            ) : (
              <div className="contracts-table-scroll">
                <table className="contracts-table">
                  <thead>
                    <tr>
                      <th className="contracts-toggle" aria-label="Show his seasons" />
                      {COLUMNS.map((c) => <SortHeader key={c.key} col={c} season={season} sort={sort} onSort={onSort} />)}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => <Row key={r.player_id} r={r} open={open.has(r.player_id)} onToggle={() => toggle(r.player_id)} span={span} />)}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function Contracts({ orgId }: { orgId: number }) {
  const [data, setData] = useState<ContractsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    getContracts(orgId).then((d) => { if (live) setData(d); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [orgId, attempt]);

  if (error) {
    return (
      <div className="banner error">
        Contracts couldn&rsquo;t be loaded: {error}{' '}
        <button type="button" className="link-button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="muted">Loading contracts…</p>;
  return <ContractsView key={orgId} data={data} />;
}
