import { useEffect, useState } from 'react';
import { getContracts, type ClubFinanceCards, type ContractsResponse } from '../api';
import { PlayerLink, Tip, TIP_TALENT, TIP_VALUE } from '../playerModal';
import { Th } from '../Th';

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

export function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const hue = (value / 100) * 120;
  return <span style={{ color: `hsl(${hue}, 65%, 55%)` }}>{value}</span>;
}

/**
 * What happens to this man at the end of the season, in the order a GM worries
 * about it. The flags already say this per player, but a page of thirty rows
 * does not answer "who am I about to lose" at a glance — which is the question
 * the offseason is actually about.
 */
type Status = 'freeAgency' | 'arbitration' | 'preArb' | 'reserve' | 'indeterminate' | 'signed';

const STATUS_LABEL: Record<Status, string> = {
  freeAgency: 'Hitting free agency',
  arbitration: 'Arbitration',
  preArb: 'Pre-arbitration',
  reserve: 'Reserve clause',
  indeterminate: 'Not yet established',
  signed: 'Under contract',
};

/** The seasons whose cost is projected rather than contracted (phase 4a). */
const CONTROLLED = new Set(['pre_arbitration', 'arbitration', 'indeterminate']);

/** "$0.8M", or "$4.1M–$31.7M" where the edges print apart. */
const band = (low: number, high: number): string => (money(low) === money(high) ? money(low) : `${money(low)}–${money(high)}`);

/** Same precedence the flags use, so the two can never disagree. */
function statusOf(p: ContractsResponse['players'][number]): Status {
  if (p.flags.some((f: string) => f.startsWith('extended thru'))) return 'signed';
  if (p.flags.includes('reserve clause')) return 'reserve';
  if (p.flags.includes('expiring')) return 'freeAgency';
  if (p.flags.some((f: string) => f.startsWith('arbitration'))) return 'arbitration';
  if (p.flags.includes('pre-arbitration')) return 'preArb';
  if (p.flags.includes('control indeterminate')) return 'indeterminate';
  return 'signed';
}

export function Contracts({ orgId }: { orgId: number }) {
  const [data, setData] = useState<ContractsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<Status | null>(null);

  useEffect(() => {
    setData(null);
    setOnly(null);
    getContracts(orgId).then(setData).catch((e) => setError(e.message));
  }, [orgId]);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Loading contracts…</p>;

  // Groups in the order they matter, skipping any the club does not have
  const groups = (['freeAgency', 'arbitration', 'preArb', 'reserve', 'indeterminate', 'signed'] as Status[])
    .map((key) => {
      const players = data.players.filter((p) => statusOf(p) === key);
      return { key, players, money: players.reduce((sum, p) => sum + (p.salaryNow ?? 0), 0) };
    })
    .filter((g) => g.players.length > 0);

  const shown = only ? data.players.filter((p) => statusOf(p) === only) : data.players;

  return (
    <div>
      <FinanceCards finances={data.finances} />

      <section>
        <h2>After {data.seasonYear}</h2>
        <div className="status-chips">
          {groups.map((g) => (
            <button
              key={g.key}
              className={`status-chip ${only === g.key ? 'active' : ''}`}
              onClick={() => setOnly(only === g.key ? null : g.key)}
            >
              <strong>{g.players.length}</strong>
              <span>{STATUS_LABEL[g.key]}</span>
              <span className="muted">{money(g.money)}</span>
            </button>
          ))}
          {only && (
            <button className="link-button" onClick={() => setOnly(null)}>
              Show everyone
            </button>
          )}
        </div>
        <p className="muted hint-line">
          Free agency means he can leave; arbitration and pre-arbitration mean the club keeps him
          whether he likes it or not, at a price the process sets. Money shown is this season&rsquo;s
          salary; under the flags, &ldquo;next&rdquo; is what next season is projected to cost where no
          contract covers it (a band; hover for its basis), never committed money. &ldquo;Not yet established&rdquo; means the save cannot
          say which: his service will cross a line only if he stays up, or the league&rsquo;s rule is not in
          the export. Hover the flag for why.
        </p>
      </section>

      <p className="muted hint-line">
        Sorted by urgency: expiring deals first, largest salary first. Value/Talent are percentiles against
        MLB-rostered players in the same role — position players, starters and relievers ranked separately.
        They are OOTP&rsquo;s own figures, and they are worth to the club rather than performance: playing time
        counts towards them, so a man who has soaked up innings or plate appearances badly can still rank
        high. That is why every recommendation here quotes what he has actually done this season.
      </p>
      <table>
        <thead>
          <tr>
            <Th>Player</Th>
            <Th>Pos</Th>
            <Th>Age</Th>
            <Th>Salary</Th>
            <Th>Thru</Th>
            <Th>Yrs left</Th>
            <Th tip="Major-league service in years.days: 2.126 is two years and 126 days of a service year, not 2.1 years. 2.xxx means only whole years are exported.">Svc</Th>
            <th><Tip label="Value" tip={TIP_VALUE} /></th>
            <th><Tip label="Talent" tip={TIP_TALENT} /></th>
            <Th>Flags</Th>
            <Th>Recommendation</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.player_id}>
              <td className="name"><PlayerLink id={p.player_id}>{p.name}</PlayerLink></td>
              <td>{p.positionName}</td>
              <td>{p.age}</td>
              <td className="num">{money(p.salaryNow)}</td>
              <td className="num">{p.endYear}</td>
              <td className="num">{p.yearsAfterThis}</td>
              <td className="num">{p.service ?? '—'}</td>
              <td className="num"><Pct value={p.overallPct} /></td>
              <td className="num"><Pct value={p.talentPct} /></td>
              <td>
                {p.flags.map((f) => (
                  <span
                    key={f}
                    className={`flag ${f === 'expiring' ? 'flag-hot' : ''}${
                      f.startsWith('extended thru') ? 'flag-locked' : ''
                    }`}
                    title={f === 'control indeterminate' || f.endsWith('option') || f.startsWith('opt-out') ? (p.control?.reason ?? undefined) : undefined}
                  >
                    {f}
                  </span>
                ))}
                {/* Phase 4a: next season's projected cost where no contract covers it, as the timeline serves it */}
                {p.nextCost && CONTROLLED.has(p.nextCost.status) && (
                  <span className="muted next-cost" title={`Projected, not committed. ${p.nextCost.text}`}>
                    <em>next: {p.nextCost.low === null || p.nextCost.high === null ? 'cost unknown' : band(p.nextCost.low, p.nextCost.high)}</em>
                  </span>
                )}
              </td>
              <td className="reasons">
                {p.recommendation && (
                  <>
                    <strong className="rec-action">{p.recommendation.action}</strong>
                    {p.recommendation.reasons.length > 0 && <> — {p.recommendation.reasons.join('; ')}</>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
