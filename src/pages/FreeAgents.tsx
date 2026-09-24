import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getFreeAgents, type FreeAgentRow, type FreeAgentsResponse, type MarketFigure } from '../freeAgentsApi';
import { costMoney } from '../costBand';
import { FreshnessCueLine } from '../FreshnessCue';
import { TIP_SCOUTED } from '../PlayerHeaderValue';
import { PlayerLink } from '../playerModal';
import { formatWins } from '../productionConeGeometry';
import { Tip } from '../Tip';
import { rangeText, signedMoney } from '../valueWords';
import { FinanceCards } from './Contracts';

/**
 * Free Agents (Player Value phase 6c, PLAYER_VALUE.md Part 8, consumer 4): the players no club holds in the league, and
 * everyone reaching free agency after this season. Each row shows what Player Value knows: his scouted tools (now and
 * ceiling, the organization's own grades), his expected wins, and what a season of his play costs at this league's market
 * (the league minimum plus his expected wins × what a win costs here). Every figure is the server's, as served
 * (`/api/free-agents/:orgId`); the browser computes nothing about a player. No percentile of OOTP's value and no signing
 * advice: the page describes, the GM decides (D-052). Plain words on the page, the explanations in the hovers (AGENTS.md
 * "Writing for the GM").
 */

// ── the hovers ────────────────────────────────────────────────────────────────

const tipWinsNow = (y: number | string) =>
  `His projected wins above replacement (WAR) for the rest of ${y} (the whole of it before it starts), most likely, with ` +
  'the range it could be. It rests on his major-league record and his scouted tools, and on how much he has played.';
const tipWinsNext = (y: number | string) =>
  `His projected wins above replacement (WAR) in ${y}, most likely, with the range it could be. A player whose production ` +
  "can't be projected shows why on hover and sorts last.";
const tipMarket = (y: number | string, price: FreeAgentsResponse['price']) =>
  `What this league's market pays for a season of his expected play in ${y}: the league minimum` +
  `${price?.minimum != null ? ` (${costMoney(price.minimum)})` : ''} plus his projected wins × what a win costs here` +
  `${price ? ` (about ${costMoney(price.band.central)})` : ''}. Most likely, with the range it could be. It isn't his asking ` +
  "price or an offer, and it isn't what he's worth to your club: fit, need and budget are yours to weigh. Below the " +
  'minimum means he is expected to play below a replacement-level player.';
const TIP_SALARY = "What he's paid this season by his current club, as the export states it.";
const TIP_AGE = 'His age as the export states it.';
const TIP_NAME = 'Click a name to open his card.';
const TIP_THINNEST =
  "Your positions whose best player is expected to add the fewest wins for the rest of this season, from Pennant's " +
  "projections. It says where your roster is thin, not who to sign: fit and role are yours to judge.";

// ── sorting ───────────────────────────────────────────────────────────────────

export type SortKey = 'name' | 'age' | 'scouted' | 'winsNow' | 'winsNext' | 'market' | 'salary';
type Dir = 'asc' | 'desc';

const ORDER: Record<SortKey, (r: FreeAgentRow) => number | string | null> = {
  name: (r) => r.name,
  age: (r) => r.age,
  scouted: (r) => r.scouted.now,
  winsNow: (r) => r.winsNow?.central ?? null,
  winsNext: (r) => r.winsNext?.central ?? null,
  market: (r) => (r.market.status === 'known' ? r.market.central : null),
  salary: (r) => r.salaryNow,
};

/**
 * The rows ordered by a column. An unknown figure sorts after every known one whichever way the column is ordered (it is
 * not a zero and not a low value, D-018); ties keep the server's order (expected wins next season, most first).
 */
export function sortFreeAgents<T extends FreeAgentRow>(rows: T[], key: SortKey | null, dir: Dir): T[] {
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

interface Column { key: SortKey; label: string; tip: string; num: boolean; first: Dir }

function columnsFor(list: List, season: number | null, next: number | null, price: FreeAgentsResponse['price']): Column[] {
  const y = season ?? 'this season';
  const n = next ?? 'next season';
  return [
    { key: 'name', label: 'Player', tip: TIP_NAME, num: false, first: 'asc' },
    { key: 'age', label: 'Age', tip: TIP_AGE, num: true, first: 'asc' },
    { key: 'scouted', label: 'Scouted', tip: TIP_SCOUTED, num: true, first: 'desc' },
    { key: 'winsNow', label: `${y} wins`, tip: tipWinsNow(y), num: true, first: 'desc' },
    { key: 'winsNext', label: `${n} wins`, tip: tipWinsNext(n), num: true, first: 'desc' },
    { key: 'market', label: `${n} at the market`, tip: tipMarket(n, price), num: true, first: 'desc' },
    ...(list === 'upcoming' ? [{ key: 'salary' as const, label: `${y} salary`, tip: TIP_SALARY, num: true, first: 'desc' as const }] : []),
  ];
}

// ── the cells ─────────────────────────────────────────────────────────────────

/** A figure over its range; an unknown is a short word with its reason on hover. */
function Figure({ main, sub, unknown, reason }: { main: string; sub?: string | null; unknown?: boolean; reason?: string | null }) {
  if (unknown) return <span className="contracts-figure muted"><Tip label={main} tip={reason ?? 'Not established.'} /></span>;
  return (
    <>
      <span className="contracts-figure">{main}</span>
      {sub ? <span className="contracts-sub">{sub}</span> : null}
    </>
  );
}

function WinsCell({ w, reason }: { w: { low: number; central: number; high: number } | null; reason: string | null }) {
  if (!w) return <Figure main="not known" unknown reason={reason} />;
  return <Figure main={formatWins(w.central)} sub={rangeText(w.low, w.high, formatWins)} />;
}

function MarketCell({ m }: { m: MarketFigure }) {
  if (m.status !== 'known' || m.low === null || m.high === null || m.central === null) return <Figure main="not known" unknown reason={m.reason} />;
  return (
    <>
      <span className="contracts-figure"><Tip label={signedMoney(m.central)} tip={`Most likely ${signedMoney(m.central)}, could be ${rangeText(m.low, m.high, signedMoney)}. ${m.text}`} /></span>
      <span className="contracts-sub">{rangeText(m.low, m.high, signedMoney)}</span>
    </>
  );
}

function ScoutedCell({ s }: { s: FreeAgentRow['scouted'] }) {
  if (s.now === null && s.ceiling === null) return <Figure main="not scouted" unknown reason="His tools haven't been graded by your scouts, so there's nothing to average." />;
  const part = (v: number | null) => (v === null ? 'not scouted' : `${v}`);
  return <Figure main={`${part(s.now)} → ${part(s.ceiling)}`} sub="now → ceiling" />;
}

function SortHeader({ col, sort, onSort }: { col: Column; sort: { key: SortKey | null; dir: Dir }; onSort: (k: SortKey) => void }) {
  const active = sort.key === col.key;
  const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className={`sortable${active ? ' sorted' : ''}${col.num ? ' num' : ''}`} aria-sort={aria} scope="col">
      <button type="button" onClick={() => onSort(col.key)}>
        <Tip label={col.label} tip={col.tip} />
        {active && <span className="sort-arrow" aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

function Row({ r, list, thin }: { r: FreeAgentRow; list: List; thin: FreeAgentsResponse['needs']['positions'][number] | null }) {
  const salary = r.salaryNow !== null ? <Figure main={costMoney(r.salaryNow)} /> : <Figure main="not known" unknown reason={r.salaryNote} />;
  return (
    <tr>
      <td className="name">
        <PlayerLink id={r.player_id}>{r.name}</PlayerLink>
        <span className="contracts-sub">
          {r.positionName}
          {r.team ? ` · ${r.team}` : ''}
          {thin?.best && (
            <span className="fa-tag">
              <Tip label="Thin spot" tip={`${r.positionName} is one of your thinnest positions: your best there, ${thin.best.name}, is expected to add ${formatWins(thin.best.wins)} wins the rest of this season.`} />
            </span>
          )}
        </span>
      </td>
      <td className="num">{r.age ?? <Figure main="not known" unknown reason="His age isn't in the export." />}</td>
      <td className="num"><ScoutedCell s={r.scouted} /></td>
      <td className="num"><WinsCell w={r.winsNow} reason={r.winsReason} /></td>
      <td className="num"><WinsCell w={r.winsNext} reason={r.winsReason} /></td>
      <td className="num"><MarketCell m={r.market} /></td>
      {list === 'upcoming' && <td className="num">{salary}</td>}
    </tr>
  );
}

// ── the page ──────────────────────────────────────────────────────────────────

type List = 'available' | 'upcoming';
type Side = 'all' | 'pitchers' | 'hitters';
type Ages = 'any' | 'young' | 'prime' | 'veteran';
const AGE_BANDS: Record<Ages, { label: string; test: (age: number | null) => boolean }> = {
  any: { label: 'Any age', test: () => true },
  young: { label: '27 and under', test: (a) => a !== null && a <= 27 },
  prime: { label: '28 to 31', test: (a) => a !== null && a >= 28 && a <= 31 },
  veteran: { label: '32 and over', test: (a) => a !== null && a >= 32 },
};

/** The club's thinnest positions in a line: each with its best player's expected wins; a position with nobody valued named apart. */
function NeedsLine({ needs }: { needs: FreeAgentsResponse['needs'] }) {
  const thin = needs.positions.filter((p) => p.best !== null).slice(0, 3);
  if (thin.length === 0 && needs.notEstablished.length === 0) return null;
  return (
    <p className="muted hint-line fa-needs">
      <Tip label="Your thinnest positions" tip={`${TIP_THINNEST} ${needs.basis}`} focusable />:{' '}
      {thin.length > 0
        ? thin.map((p, i) => (
          <span key={p.position}>
            {i > 0 ? ' · ' : ''}<strong>{p.positionName}</strong> (best: {p.best!.name}, {formatWins(p.best!.wins)} wins)
          </span>
        ))
        : 'none of your positions has a projected player yet'}
      {needs.notEstablished.length > 0 && <> · not known at {needs.notEstablished.join(', ')}</>}
    </p>
  );
}

/** The page's body: pure, renders what it is given (the tests render it straight from the route). */
export function FreeAgentsView({ data }: { data: FreeAgentsResponse }) {
  const [list, setList] = useState<List>(data.currentFAs.length > 0 || data.upcomingFAs.length === 0 ? 'available' : 'upcoming');
  const [side, setSide] = useState<Side>('all');
  const [pos, setPos] = useState('');
  const [ages, setAges] = useState<Ages>('any');
  const [thinOnly, setThinOnly] = useState(false);
  const [find, setFind] = useState('');
  const [sort, setSort] = useState<{ key: SortKey | null; dir: Dir }>({ key: null, dir: 'desc' });
  const season = data.seasonYear;
  const next = data.nextSeason;
  const rows = list === 'available' ? data.currentFAs : data.upcomingFAs;
  const columns = columnsFor(list, season, next, data.price);
  const thinBy = new Map(data.needs.positions.filter((p) => p.best !== null).slice(0, 3).map((p) => [p.positionName, p]));
  const positions = [...new Set(rows.map((r) => r.positionName))].sort();

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    const kept = rows.filter((r) =>
      (side === 'all' || (side === 'pitchers') === r.isPitcher)
      && (pos === '' || r.positionName === pos)
      && AGE_BANDS[ages].test(r.age)
      && (!thinOnly || thinBy.has(r.positionName))
      && (needle === '' || r.name.toLowerCase().includes(needle)));
    return sortFreeAgents(kept, sort.key, sort.dir);
  }, [rows, side, pos, ages, thinOnly, find, sort, thinBy]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: columns.find((c) => c.key === key)?.first ?? 'desc' }));
  const filtered = side !== 'all' || pos !== '' || ages !== 'any' || thinOnly || find.trim() !== '';
  const reset = () => { setSide('all'); setPos(''); setAges('any'); setThinOnly(false); setFind(''); };
  const choose = (l: List) => { setList(l); setPos(''); setSort({ key: null, dir: 'desc' }); };

  const lists: Array<{ key: List; count: number; label: string; tip: string }> = [
    { key: 'available', count: data.currentFAs.length, label: 'Available now', tip: 'Players no club holds, who last played in this league: free to sign today.' },
    {
      key: 'upcoming', count: data.upcomingFAs.length, label: `Free agents after ${season ?? 'this season'}`,
      tip: "Players around the league whose club's control ends after this season: they reach the market this winter. Players the club still controls through arbitration or renewal aren't here.",
    },
  ];

  let body: ReactNode;
  if (list === 'available' && data.currentNote) body = <p className="muted contracts-empty">{data.currentNote}</p>;
  else if (rows.length === 0) {
    body = (
      <p className="muted contracts-empty">
        {list === 'available' ? 'No free agents are available in this league right now.' : `No free agents are set to reach the market after ${season ?? 'this season'}.`}
      </p>
    );
  } else if (shown.length === 0) body = <p className="muted contracts-empty">No players match these filters.</p>;
  else {
    body = (
      <div className="contracts-table-scroll">
        <table className="contracts-table fa-table">
          <thead>
            <tr>{columns.map((c) => <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => <Row key={r.player_id} r={r} list={list} thin={thinBy.get(r.positionName) ?? null} />)}
          </tbody>
        </table>
      </div>
    );
  }

  const indeterminate = data.upcomingIndeterminate ?? 0;
  const undecided = data.upcomingUndecided ?? 0;

  return (
    <div className="contracts-page fa-page">
      <FinanceCards finances={data.finances} />

      <section>
        <div className="contracts-head">
          <h2>Free agents</h2>
          <FreshnessCueLine freshness={data.freshness} />
        </div>
        <p className="muted hint-line">
          What each player is expected to produce, and what that costs on this league&rsquo;s market. Figures are the most
          likely value with the range they could be; hover a heading or a figure for how to read it.
          {data.price && (
            <> <Tip label={`A win costs about ${costMoney(data.price.band.central)} here`} tip={`${data.price.label}: about ${costMoney(data.price.band.central)} a win, could be ${costMoney(data.price.band.low)} to ${costMoney(data.price.band.high)}. It's what clubs in this league pay above the minimum salary for each win a player adds.`} focusable />.</>
          )}
        </p>
        <NeedsLine needs={data.needs} />

        <div className="status-chips" role="group" aria-label="Which players">
          {lists.map((l) => (
            <button key={l.key} type="button" className={`status-chip ${list === l.key ? 'active' : ''}`} aria-pressed={list === l.key}
              title={l.tip} onClick={() => choose(l.key)}>
              <strong>{l.count}</strong>
              <span>{l.label}</span>
            </button>
          ))}
        </div>

        {list === 'upcoming' && (indeterminate > 0 || undecided > 0) && (
          <p className="muted hint-line fa-unsettled">
            {indeterminate > 0 && (
              <Tip label={`${indeterminate} more could go either way`} tip="The save can't yet say whether these players reach free agency: their service may cross the line only if they stay up, a rule isn't in the export, or the export is behind your save. They aren't listed as if they were coming." />
            )}
            {indeterminate > 0 && undecided > 0 && ' · '}
            {undecided > 0 && (
              <Tip label={`${undecided} more ${undecided === 1 ? 'has' : 'have'} an option or opt-out for next season`} tip="Whether they reach the market is a decision still to be made (the club's, the player's, or both), so they aren't listed." />
            )}
          </p>
        )}

        <div className="contracts-filters">
          <label>
            Show{' '}
            <select value={side} onChange={(e) => setSide(e.target.value as Side)}>
              <option value="all">All players</option>
              <option value="pitchers">Pitchers</option>
              <option value="hitters">Position players</option>
            </select>
          </label>
          <label>
            Position{' '}
            <select value={pos} onChange={(e) => setPos(e.target.value)}>
              <option value="">Any</option>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            Age{' '}
            <select value={ages} onChange={(e) => setAges(e.target.value as Ages)}>
              {(Object.keys(AGE_BANDS) as Ages[]).map((k) => <option key={k} value={k}>{AGE_BANDS[k].label}</option>)}
            </select>
          </label>
          {thinBy.size > 0 && (
            <label className="fa-check">
              <input type="checkbox" checked={thinOnly} onChange={(e) => setThinOnly(e.target.checked)} /> Only our thin spots
            </label>
          )}
          <input type="search" placeholder="Find a player" aria-label="Find a player" value={find} onChange={(e) => setFind(e.target.value)} />
          {filtered && <button type="button" className="link-button" onClick={reset}>Show everyone</button>}
          <span className="muted">{shown.length} of {rows.length}</span>
        </div>

        {body}
        {rows.length > 0 && sort.key === null && <p className="muted hint-line fa-order">{data.order}</p>}
      </section>
    </div>
  );
}

/** Loading and error, designed: the error says what failed and offers to try again. */
export function FreeAgentsState({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (error) {
    return (
      <div className="banner error">
        Free agents couldn&rsquo;t be loaded: {error}{' '}
        {onRetry && <button type="button" className="link-button" onClick={onRetry}>Try again</button>}
      </div>
    );
  }
  return <p className="muted" aria-live="polite">Loading free agents…</p>;
}

export function FreeAgents({ orgId }: { orgId: number }) {
  const [data, setData] = useState<FreeAgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    getFreeAgents(orgId).then((d) => { if (live) setData(d); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [orgId, attempt]);

  if (error || !data) return <FreeAgentsState error={error} onRetry={() => setAttempt((n) => n + 1)} />;
  return <FreeAgentsView key={orgId} data={data} />;
}
