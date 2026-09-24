import { useEffect, useMemo, useState } from 'react';
import { getOrgComparison, type OrgClub, type OrgComparisonResponse, type OrgMoney, type OrgSum } from '../api';
import { costMoney } from '../costBand';
import { PlayerLink } from '../playerModal';
import { formatWins } from '../productionConeGeometry';
import { TeamLogo } from '../TeamLogo';
import { Tip } from '../Tip';
import { freshnessWords, rangeText, signedMoney } from '../valueWords';

/**
 * Org Comparison (Player Value phase 6d, PLAYER_VALUE.md Part 8): every organization in the league side by side on what its
 * major-league roster is expected to add the rest of the way, what its farm is about to send up, what its roster's contracts
 * are worth and what it spends. Every figure is Player Value's as each player is served, or a fact of the export
 * (`/api/org-comparison/:orgId`); the browser computes nothing about a player. It used to add up OOTP's own talent values and
 * rank the clubs by them; now nothing is ranked: the table starts in club order and sorts only by a column it shows, a club
 * whose figure is unknown after every known one. Plain words on the page, the explanations in the hovers (AGENTS.md
 * "Writing for the GM").
 */

export type ClubSortKey = 'team' | 'record' | 'rosterWins' | 'farmWins' | 'contract' | 'payroll' | 'top' | 'players';
type Dir = 'asc' | 'desc';

/** A sum's most likely reading as one number to sort by: the central, or the middle of its range of readings. */
const likely = (s: OrgSum): number | null => {
  const f = s.status === 'known' ? s.figure : null;
  if (!f) return null;
  return f.central ?? (f.centralRange ? (f.centralRange.low + f.centralRange.high) / 2 : null);
};

const ORDER: Record<ClubSortKey, (c: OrgClub) => number | string | null> = {
  team: (c) => c.team,
  record: (c) => (c.record && c.record.w + c.record.l > 0 ? c.record.w / (c.record.w + c.record.l) : null),
  rosterWins: (c) => likely(c.roster.wins),
  farmWins: (c) => likely(c.farm.wins),
  contract: (c) => likely(c.roster.contract),
  payroll: (c) => c.payroll.value,
  top: (c) => c.farm.top?.wins.central ?? null,
  players: (c) => c.farm.players,
};

/**
 * The clubs ordered by a column the page shows. A club whose figure is unknown sorts after every known one whichever way
 * the column is ordered (it is not a zero, D-018); ties keep club order.
 */
export function sortClubs<T extends OrgClub>(clubs: T[], key: ClubSortKey, dir: Dir): T[] {
  const read = ORDER[key];
  const sign = dir === 'asc' ? 1 : -1;
  return clubs
    .map((c, i) => ({ c, i, v: read(c) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const d = typeof a.v === 'string' ? a.v.localeCompare(b.v as string) : (a.v as number) - (b.v as number);
      return d !== 0 ? sign * d : a.i - b.i;
    })
    .map((x) => x.c);
}

// ── the columns ──────────────────────────────────────────────────────────────

const TIP_ROSTER_WINS = (season: number) =>
  `What the players on the club's major-league roster (active or on the injured list) are expected to add over the rest of ${season}, ` +
  'in wins above replacement (WAR), added up. The first figure is the most likely; the line under it is the range it could be. ' +
  "Players are combined as if their seasons were independent, so the range is a reasonable reading, not a promise. It's who is " +
  "there now, not who might arrive; a player whose production can't be projected is left out and named.";
const TIP_FARM_WINS = (next: number) =>
  `What the organization's minor leaguers are expected to add in the majors in ${next}, in WAR, added up: each one's chance of ` +
  "reaching the majors times what he'd do there. It says how much help is close, not how good the system is in the long run: a " +
  'teenager years away adds little here however high his ceiling.';
const TIP_CONTRACT =
  "What the major-league roster's contracts are worth beyond what they pay, added up: the same figure as Contract value on each " +
  "player's card, over the seasons he is signed or controlled, seasons further out counting a little less, summed the way " +
  'Payroll adds players. Cheap, productive players push it up; big contracts for fading players pull it down. A player whose ' +
  "value isn't known yet is left out and named.";
const TIP_PAYROLL =
  "This season's payroll, with the budget under it, as OOTP's club finances state them. A figure the export doesn't carry says " +
  "so; it's never read as $0.";
const TIP_TOP =
  'The minor leaguer expected to add the most in the majors next season, with his expected wins: the nearest help, not ' +
  'necessarily the best prospect.';

const COLUMNS: Array<{ key: ClubSortKey; label: (d: OrgComparisonResponse) => string; tip: (d: OrgComparisonResponse) => string; num: boolean; first: Dir }> = [
  { key: 'team', label: () => 'Club', tip: () => 'Every major-league club in your league; yours is highlighted. Open a player from his name.', num: false, first: 'asc' },
  { key: 'record', label: () => 'Record', tip: () => 'Wins and losses this season, as the export states them.', num: true, first: 'desc' },
  { key: 'rosterWins', label: (d) => `Roster, rest of ${d.season}`, tip: (d) => TIP_ROSTER_WINS(d.season), num: true, first: 'desc' },
  { key: 'farmWins', label: (d) => `Farm, ${d.nextSeason}`, tip: (d) => TIP_FARM_WINS(d.nextSeason), num: true, first: 'desc' },
  { key: 'contract', label: () => 'Contract value', tip: () => TIP_CONTRACT, num: true, first: 'desc' },
  { key: 'payroll', label: () => 'Payroll', tip: () => TIP_PAYROLL, num: true, first: 'desc' },
  { key: 'top', label: () => "Farm's top contributor", tip: () => TIP_TOP, num: false, first: 'desc' },
  { key: 'players', label: () => 'Players', tip: () => 'On the major-league roster · in the farm system.', num: true, first: 'desc' },
];

// ── the cells ────────────────────────────────────────────────────────────────

const OPEN_READING =
  'No single most likely figure: it depends on seasons that could go more than one way (an option, a status still open, or ' +
  'whether a player stays), so the most likely is the range of those readings.';

const winsFmt = (v: number) => formatWins(v);
const moneyFmt = (v: number) => signedMoney(v);

/** Who a sum leaves out, in one short line with the names and reasons on hover. */
function LeftOut({ sum }: { sum: OrgSum }) {
  const n = sum.excluded.length;
  if (n === 0) return null;
  const shown = sum.excluded.slice(0, 12).map((x) => `${x.name}: ${x.reason}`);
  const more = n > 12 ? ` And ${n - 12} more.` : '';
  return (
    <span className="contracts-sub">
      <Tip label={`${n} not counted`} tip={`Left out because their figure isn't known, never counted as zero. ${shown.join(' ')}${more}`} />
    </span>
  );
}

/** A sum: most likely over the range it could be, with who it leaves out; unknown with its reason. */
function SumCell({ sum, none }: { sum: OrgSum; none: string }) {
  const f = sum.status === 'known' ? sum.figure : null;
  if (!f) {
    return (
      <>
        <span className="contracts-figure muted"><Tip label={none} tip={sum.text} /></span>
        <LeftOut sum={sum} />
      </>
    );
  }
  const fmt = sum.unit === 'wins' ? winsFmt : moneyFmt;
  const main = f.central !== null ? fmt(f.central) : rangeText(f.centralRange?.low ?? f.low, f.centralRange?.high ?? f.high, fmt);
  const unit = sum.unit === 'wins' ? ' wins' : '';
  return (
    <>
      <span className="contracts-figure"><Tip label={`${main}${unit}`} tip={f.central !== null ? sum.text : `${OPEN_READING} ${sum.text}`} /></span>
      <span className="contracts-sub">could be {rangeText(f.low, f.high, fmt)}</span>
      <LeftOut sum={sum} />
    </>
  );
}

function MoneyCell({ payroll, budget }: { payroll: OrgMoney; budget: OrgMoney }) {
  const missing = (m: OrgMoney) => m.note ?? "The export doesn't state it.";
  return (
    <>
      {payroll.value !== null
        ? <span className="contracts-figure">{costMoney(payroll.value)}</span>
        : <span className="contracts-figure muted"><Tip label="not in the export" tip={missing(payroll)} /></span>}
      <span className="contracts-sub">
        {budget.value !== null ? `budget ${costMoney(budget.value)}` : <Tip label="budget not known" tip={missing(budget)} />}
      </span>
    </>
  );
}

function TopCell({ c }: { c: OrgClub }) {
  const t = c.farm.top;
  if (!t) return <span className="muted"><Tip label="none projected" tip={c.farm.wins.text} /></span>;
  return (
    <>
      <span className="contracts-figure"><PlayerLink id={t.player_id}>{t.name}</PlayerLink></span>
      <span className="contracts-sub">
        {formatWins(t.wins.central)} wins · {[t.positionName, t.age !== null ? `${t.age}` : null, t.team].filter(Boolean).join(', ')}
      </span>
    </>
  );
}

function SortHeader({ col, data, sort, onSort }: {
  col: (typeof COLUMNS)[number]; data: OrgComparisonResponse; sort: { key: ClubSortKey; dir: Dir }; onSort: (k: ClubSortKey) => void;
}) {
  const active = sort.key === col.key;
  const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className={`sortable${active ? ' sorted' : ''}${col.num ? ' num' : ''}`} aria-sort={aria} scope="col">
      <button type="button" onClick={() => onSort(col.key)}>
        <Tip label={col.label(data)} tip={col.tip(data)} />
        {active && <span className="sort-arrow" aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

/** One figure for the viewer's club, with the league's middle club beside it for scale (never a rank). */
function ViewerCard({ label, value, line, tip }: { label: string; value: string; line: string | null; tip: string }) {
  return (
    <div className="card org-card">
      <span className="card-label"><Tip label={label} tip={tip} focusable /></span>
      <span className="card-value">{value}</span>
      {line && <span className="org-card-line muted">{line}</span>}
    </div>
  );
}

function ViewerCards({ data }: { data: OrgComparisonResponse }) {
  const me = data.clubs.find((c) => c.isViewer);
  if (!me) return null;
  /** A sum's most likely reading in words: one figure, or the range of its readings (never a midpoint of them). */
  const reading = (s: OrgSum, fmt: (x: number) => string, none: string) => {
    const f = s.status === 'known' ? s.figure : null;
    if (!f) return none;
    return f.central !== null ? fmt(f.central) : rangeText(f.centralRange?.low ?? f.low, f.centralRange?.high ?? f.high, fmt);
  };
  const middle = (v: { low: number; high: number } | null, fmt: (x: number) => string) =>
    (v === null ? null : `League middle: ${rangeText(v.low, v.high, fmt)}`);
  const winsFig = (x: number) => `${formatWins(x)} wins`;
  const contractUnit = me.roster.contract.unit;
  return (
    <div className="cards org-cards" aria-label={`${me.team} at a glance`}>
      <ViewerCard label={`Roster, rest of ${data.season}`} value={reading(me.roster.wins, winsFig, 'not projected')} line={middle(data.league.rosterWins, winsFig)} tip={TIP_ROSTER_WINS(data.season)} />
      <ViewerCard label={`Farm, ${data.nextSeason}`} value={reading(me.farm.wins, winsFig, 'not projected')} line={middle(data.league.farmWins, winsFig)} tip={TIP_FARM_WINS(data.nextSeason)} />
      <ViewerCard label="Contract value" value={reading(me.roster.contract, contractUnit === 'wins' ? winsFig : signedMoney, 'not valued')}
        line={contractUnit === 'dollars' ? middle(data.league.contract, signedMoney) : null}
        tip={me.roster.contract.figure && me.roster.contract.figure.central === null ? `${TIP_CONTRACT} ${OPEN_READING}` : TIP_CONTRACT} />
      <ViewerCard label="Payroll" value={me.payroll.value === null ? 'not known' : costMoney(me.payroll.value)}
        line={data.league.payroll === null ? null : `League middle: ${costMoney(data.league.payroll)}`} tip={TIP_PAYROLL} />
    </div>
  );
}

function ClubRow({ c }: { c: OrgClub }) {
  return (
    <tr className={c.isViewer ? 'row-us' : undefined} aria-current={c.isViewer ? 'true' : undefined}>
      <td>
        <span className="standings-team org-club">
          <TeamLogo teamId={c.team_id} size={40} className="logo-sm" />
          <span>{c.team}</span>
        </span>
      </td>
      <td className="num">{c.record ? `${c.record.w}–${c.record.l}` : <span className="muted">—</span>}</td>
      <td className="num"><SumCell sum={c.roster.wins} none="not projected" /></td>
      <td className="num"><SumCell sum={c.farm.wins} none="not projected" /></td>
      <td className="num"><SumCell sum={c.roster.contract} none="not valued" /></td>
      <td className="num"><MoneyCell payroll={c.payroll} budget={c.budget} /></td>
      <td><TopCell c={c} /></td>
      <td className="num">{c.roster.players} · {c.farm.players}</td>
    </tr>
  );
}

/** The page's body, with its loading, empty and error states: pure, renders what it is given (the tests render it straight from the route). */
export function OrgComparisonPanel({ data, loading, error, onRetry }: {
  data: OrgComparisonResponse | null; loading: boolean; error: string | null; onRetry: () => void;
}) {
  const [sort, setSort] = useState<{ key: ClubSortKey; dir: Dir }>({ key: 'team', dir: 'asc' });
  const clubs = useMemo(() => (data ? sortClubs(data.clubs, sort.key, sort.dir) : []), [data, sort]);

  if (error) {
    return (
      <div className="banner error">
        Org Comparison couldn&rsquo;t be loaded: {error}{' '}
        <button type="button" className="link-button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (loading || !data) return <p className="muted">Sizing up the league…</p>;

  const fresh = freshnessWords(data.freshness);
  const onSort = (key: ClubSortKey) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: COLUMNS.find((c) => c.key === key)?.first ?? 'asc' }));

  return (
    <div className="org-compare">
      <div className="contracts-head">
        <h2>How the organizations compare</h2>
        <span className={`contracts-asof dossier-asof-${fresh.tone}`}>
          <Tip label={[fresh.asOf, fresh.warning].filter(Boolean).join(' · ') || 'Date not known'} tip={fresh.tip} focusable />
        </span>
      </div>
      <p className="muted hint-line">
        Where each club stands: what its roster is expected to add the rest of the way, how much help its farm is about to
        send up, what its contracts are worth and what it spends. Most likely figures, with the range they could be under
        them; hover a heading for how to read it, and click one to sort.
      </p>

      {data.clubs.length === 0 ? (
        <p className="muted contracts-empty">No clubs to compare: the export has no major-league clubs in your league.</p>
      ) : (
        <>
          <ViewerCards data={data} />
          <div className="contracts-table-scroll">
            <table className="contracts-table org-compare-table">
              <thead>
                <tr>{COLUMNS.map((c) => <SortHeader key={c.key} col={c} data={data} sort={sort} onSort={onSort} />)}</tr>
              </thead>
              <tbody>
                {clubs.map((c) => <ClubRow key={c.team_id} c={c} />)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function OrgComparison({ orgId }: { orgId: number }) {
  const [data, setData] = useState<OrgComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    getOrgComparison(orgId).then((d) => { if (live) setData(d); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [orgId, attempt]);

  return <OrgComparisonPanel key={orgId} data={data} loading={!data && !error} error={error} onRetry={() => setAttempt((n) => n + 1)} />;
}
