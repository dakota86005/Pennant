import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group } from '@visx/group';
import { Bar, Line } from '@visx/shape';
import { CHART_COLOR, CHART_MARK, CHART_OPACITY, CHART_TEXT } from './chartTheme';
import { costMoney } from './costBand';
import { FreshnessCueLine } from './FreshnessCue';
import { formatWins } from './productionConeGeometry';
import { PlayerLink } from './playerModal';
import { Tip } from './Tip';
import { ClubWinValueLine, TIP_CONTRACT_VALUE, TIP_KEEPING_HIM } from './ValueSection';
import { differenceGeometry } from './tradeDifferenceGeometry';
import type {
  TradeAnalysis, TradeFigure, TradePick, TradePlayerValue, TradeProduction, TradeRow, TradeSideTotal, TradeUnit,
} from './tradeApi';

/**
 * The Trade Center's analysis (Player Value phase 6b, PLAYER_VALUE.md Part 8, consumer 3): the two sides side by side,
 * each player a compact row (who he is, his control, his contract value most likely and what it could be, the value of
 * keeping him, his expected wins), each side's total, then the difference between the sides (what comes in less what goes
 * out) drawn as a range around zero with its parts, our view beside it, and each club's value of a win as context.
 * Plain words on the page, the explanations in the hovers (AGENTS.md "Writing for the GM"). Everything shown is the
 * server's answer as served; the page computes nothing about a player or the deal, and nothing here is a verdict.
 */

type Fmt = (v: number) => string;

/** Signed money at the pages' precision ("$12.3M", "−$4.0M", "$780K"), or wins ("1.2 wins"). */
const fmtFor = (unit: TradeUnit | null): Fmt =>
  (unit === 'wins' ? (v) => `${formatWins(v)} wins` : (v) => (v < 0 ? `−${costMoney(-v)}` : costMoney(v)));
/** A difference always carries its sign: "+$12.3M", "−$4.0M". */
const signedFmt = (fmt: Fmt): Fmt => (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));
const likelyText = (f: TradeFigure, fmt: Fmt): string =>
  (f.central !== null ? fmt(f.central) : f.centralRange ? `${fmt(f.centralRange.low)} to ${fmt(f.centralRange.high)}` : `${fmt(f.low)} to ${fmt(f.high)}`);
const rangeText = (f: { low: number; high: number }, fmt: Fmt): string => (f.low === f.high ? fmt(f.low) : `${fmt(f.low)} to ${fmt(f.high)}`);
const listYears = (ys: number[]): string => {
  const s = [...ys].sort((a, b) => a - b);
  if (s.length <= 1) return s.join('');
  return s.every((y, i) => i === 0 || y === s[i - 1] + 1) ? `${s[0]}–${s[s.length - 1]}` : s.join(', ');
};

// ── the hovers ────────────────────────────────────────────────────────────────

export const TIP_DIFFERENCE =
  "What you'd receive less what you'd send, each player at his contract value: his projected wins priced at what a win " +
  "costs on this league's market, minus the salary still to be paid, later seasons counting a little less. A trade moves " +
  "a player's salary with him, so this is the view a deal is read on. It isn't a verdict: it doesn't see either club's " +
  'roster, needs or money, and the decision is yours. The range is wide because each player\'s is; the players are added ' +
  'as if each one\'s ups and downs were separate from the others\', so they aren\'t all at their best or worst at once ' +
  '(players combined as independent; not a calibrated interval).';
const TIP_BAR =
  'Zero is an even deal. The shaded stretch is the range the difference could be; the marker is the most likely figure ' +
  "(a darker stretch where it depends on an option or on whether a player stays). Right of zero, more value comes in than " +
  "goes out; left of zero, the reverse. It measures contract value only: not fit, need, or what the other club wants.";
const TIP_KEEPING_ROW =
  `${TIP_KEEPING_HIM} In a trade his salary goes with him, so the deal is read on contract value; this is shown for context.`;
const TIP_OUR_VIEW =
  "The same figures read through your club's philosophy: it can weigh near seasons against far ones, read the ranges more " +
  'cautiously, and weigh salary, club control and guaranteed money more or less. It never changes the figures above, and ' +
  'each lean is named on its player.';
const TIP_EXPECTED =
  'Projected wins above replacement for the rest of this season (or the whole of it before it starts), most likely; the ' +
  'hover on each gives the likely range.';
const TIP_COULD_BE =
  "The range covers every reasonable combination of how he plays, what a win costs and what he'll be paid. It is " +
  'deliberately wide: a range of outcomes, not a forecast.';
const TIP_SALARY ="Salary this season as the export states it. A salary the export doesn't state isn't counted as zero.";

const togetherTip = (t: TradeSideTotal, fmt: Fmt): string =>
  "The players on this side added up at their contract value: the most likely figures summed, and a range that treats " +
  "each player's ups and downs as separate from the others', so they aren't all at their best or worst at once. A player " +
  "whose value isn't known is left out and named, never counted as zero." +
  (t.edges ? ` Every player at his lowest and highest at once: ${rangeText(t.edges, fmt)}.` : '') +
  ` (${t.text})`;

// ── a row ─────────────────────────────────────────────────────────────────────

function productionText(p: TradeProduction): string {
  if (!p.now) return 'Production not established';
  const now = `${formatWins(p.now.wins.central)} wins ${p.now.part === 'rest_of_season' ? `rest of ${p.now.season}` : `in ${p.now.season}`}`;
  return p.next ? `${now} · ${formatWins(p.next.wins.central)} in ${p.next.season}` : now;
}
function productionTip(p: TradeProduction): string {
  if (!p.now) return p.reason ?? 'Not established.';
  const band = (w: { low: number; high: number }) => `${formatWins(w.low)} to ${formatWins(w.high)}`;
  return `${TIP_EXPECTED} ${p.now.season}: likely ${band(p.now.wins)}.` +
    (p.next ? ` ${p.next.season}: likely ${band(p.next.wins)}.` : p.nextReason ? ` Next season: ${p.nextReason}` : '');
}
const controlTip = (r: TradeRow): string =>
  (r.control.path.length === 0 ? r.control.text : `What each season costs: ${r.control.path.map((s) => `${s.season} ${s.label}, ${s.costText}${s.ifHeld ? ' (if kept)' : ''}`).join('; ')}.`);

function TradeRowView({ pick, row, value, unit, pending, onRemove }: {
  pick: TradePick; row: TradeRow | null; value: TradePlayerValue | null; unit: TradeUnit | null; pending: boolean; onRemove?: () => void;
}) {
  const fmt = fmtFor(unit);
  const meta = [row?.position ?? pick.positionName, row?.age ?? pick.age, row?.teamAbbr ?? pick.team].filter((x) => x !== null && x !== undefined && x !== '').join(' · ');
  const leaning = value?.ours?.leaning && value.ours.contract;
  return (
    <li className="trade-row">
      <div className="trade-row-who">
        <PlayerLink id={pick.player_id}>{row?.name ?? pick.name}</PlayerLink>
        <span className="muted"> {meta}</span>
        {row?.listed && <span className="trade-tag">Listed</span>}
      </div>
      <div className="trade-row-value">
        {pending || !value ? <span className="muted">…</span>
          : value.counted && value.contract ? <strong>{likelyText(value.contract, fmt)}</strong>
            : <span className="muted">Not valued</span>}
      </div>
      {onRemove ? (
        <button type="button" className="chip-x trade-row-remove" aria-label={`Remove ${row?.name ?? pick.name}`} onClick={onRemove}>✕</button>
      ) : <span />}
      {row && (
        <div className="trade-row-line muted">
          <Tip label={row.control.text} tip={controlTip(row)} focusable />
        </div>
      )}
      {value && !pending && (
        <div className="trade-row-range muted">
          {value.counted && value.contract ? (
            value.dependsOn ? (
              <><Tip label="could be" tip={`${TIP_COULD_BE} His most likely figure is a range because it depends on ${value.dependsOn}.`} /> {rangeText(value.contract, fmt)}</>
            ) : <>could be {rangeText(value.contract, fmt)}</>
          ) : (
            <Tip label={value.notCounted ?? 'Not valued yet.'} tip={value.reason ?? 'Not established.'} focusable />
          )}
        </div>
      )}
      {row && value && !pending && (
        <div className="trade-row-line trade-row-more muted">
          <Tip label={productionText(row.production)} tip={productionTip(row.production)} />
          {value.keeping && (
            <> · <Tip label="Keeping him" tip={TIP_KEEPING_ROW} /> {likelyText(value.keeping, fmt)}</>
          )}
          {value.ifHeld.length > 0 && <> · {listYears(value.ifHeld)} if kept</>}
        </div>
      )}
      {leaning && (
        <div className="trade-row-line trade-row-ours">
          Our view {likelyText(value!.ours!.contract!, fmt)}:{' '}
          {value!.ours!.leans.map((l, i) => (
            <span key={l.short}>{i > 0 && '; '}<Tip label={l.short} tip={l.text} /></span>
          ))}
        </div>
      )}
    </li>
  );
}

// ── a side ────────────────────────────────────────────────────────────────────

function SideTotalLine({ total, fmt, names }: { total: TradeSideTotal; fmt: Fmt; names: Map<number, string> }) {
  if (total.status !== 'known' || !total.figure) {
    return total.excluded.length > 0 ? <div className="trade-total muted">No one on this side could be valued yet.</div> : null;
  }
  return (
    <div className="trade-total">
      <Tip label="Together" tip={togetherTip(total, fmt)} focusable />{' '}
      <strong>{likelyText(total.figure, fmt)}</strong>
      <span className="muted"> · could be {rangeText(total.figure, fmt)}</span>
      {total.excluded.length > 0 && (
        <div className="muted">Leaves out {total.excluded.map((x) => names.get(x.playerId) ?? 'a player').join(', ')} (not valued yet).</div>
      )}
    </div>
  );
}

export function TradeSideColumn({ title, side, picks, analysis, pending, onRemove, search }: {
  title: string; side: 'sent' | 'received'; picks: TradePick[]; analysis: TradeAnalysis | null; pending: boolean;
  onRemove?: (id: number) => void; search?: ReactNode;
}) {
  const rows = analysis ? analysis[side] : [];
  const values = analysis ? analysis.value[side].players : [];
  const unit = analysis?.value.unit ?? null;
  const names = new Map(rows.map((r) => [r.playerId, r.name]));
  const known = new Set(rows.map((r) => r.playerId));
  const stale = pending || picks.some((p) => !known.has(p.player_id));
  return (
    <div className="trade-side">
      <h3>{title}</h3>
      {search}
      {picks.length === 0 ? (
        <p className="muted trade-side-empty">No players yet.</p>
      ) : (
        <>
          <div className="trade-rows-head muted">
            <span>Player</span>
            <Tip label="Contract value" tip={TIP_CONTRACT_VALUE} focusable />
          </div>
          <ul className="trade-rows">
            {picks.map((p) => (
              <TradeRowView
                key={p.player_id} pick={p} row={rows.find((r) => r.playerId === p.player_id) ?? null}
                value={values.find((v) => v.playerId === p.player_id) ?? null} unit={unit} pending={stale}
                onRemove={onRemove ? () => onRemove(p.player_id) : undefined}
              />
            ))}
          </ul>
          {analysis && !stale && <SideTotalLine total={analysis.value[side].total} fmt={fmtFor(unit)} names={names} />}
        </>
      )}
    </div>
  );
}

// ── the difference ────────────────────────────────────────────────────────────

const BAR_HEIGHT = 46;
const BAR_MID = 18;

/** The difference drawn around zero: the range as a wash, the most likely as a marker (or a darker stretch), zero dashed. */
export function DifferenceBar({ figure, fmt }: { figure: TradeFigure; fmt: Fmt }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(Math.max(200, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = differenceGeometry(figure, width);
  const signed = signedFmt(fmt);
  const summary = `Coming in less going out: most likely ${likelyText(figure, signed)}, could be ${rangeText(figure, signed)}. Zero is an even deal.`;
  const point = g.likelyHigh - g.likelyLow < 1;
  return (
    <div className="tip trade-bar" tabIndex={0} ref={ref}>
      <svg width={width} height={BAR_HEIGHT} role="img" aria-label={summary}>
        <Group>
          <Line from={{ x: g.x(g.domain[0]), y: BAR_MID }} to={{ x: g.x(g.domain[1]), y: BAR_MID }} stroke={CHART_COLOR.grid} strokeWidth={1} />
          <Bar x={g.low} y={BAR_MID - 8} width={Math.max(2, g.high - g.low)} height={16} rx={3} fill={CHART_COLOR.mark} fillOpacity={CHART_OPACITY.outerBand} />
          {point ? (
            <circle cx={g.likelyLow} cy={BAR_MID} r={CHART_MARK.markerActive} fill={CHART_COLOR.mark} stroke={CHART_COLOR.surface} strokeWidth={CHART_MARK.ring} />
          ) : (
            <Bar x={g.likelyLow} y={BAR_MID - 8} width={Math.max(2, g.likelyHigh - g.likelyLow)} height={16} rx={2} fill={CHART_COLOR.mark} fillOpacity={CHART_OPACITY.innerBand} />
          )}
          <Line from={{ x: g.zero, y: 2 }} to={{ x: g.zero, y: BAR_MID + 12 }} stroke={CHART_COLOR.ink} strokeWidth={1} strokeDasharray="3 3" />
          <text x={g.zero} y={BAR_HEIGHT - 3} textAnchor="middle" fill={CHART_COLOR.muted} fontFamily={CHART_TEXT.family} fontSize={CHART_TEXT.size}>even</text>
        </Group>
      </svg>
      <span className="tip-pop">{TIP_BAR}</span>
      <table className="visually-hidden">
        <caption>Coming in less going out</caption>
        <tbody>
          <tr><th scope="row">Lowest</th><td>{signed(figure.low)}</td></tr>
          <tr><th scope="row">Most likely</th><td>{likelyText(figure, signed)}</td></tr>
          <tr><th scope="row">Highest</th><td>{signed(figure.high)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function DifferenceView({ analysis }: { analysis: TradeAnalysis }) {
  const v = analysis.value;
  const d = v.difference;
  const fmt = fmtFor(v.unit);
  const signed = signedFmt(fmt);
  const names = new Map([...analysis.sent, ...analysis.received].map((r) => [r.playerId, r.name]));
  const club = analysis.organization?.name ?? 'Your club';
  return (
    <section className="trade-diff" aria-label="The difference between the sides">
      <div className="trade-diff-head">
        <span className="trade-diff-title"><Tip label="The difference" tip={TIP_DIFFERENCE} focusable /></span>
        <span className="muted"> Coming in less going out{v.unit === 'wins' ? ', in wins' : ''}</span>
        <FreshnessCueLine freshness={analysis.freshness} />
      </div>
      {d.status === 'known' && d.figure ? (
        <>
          <div className="trade-diff-figure">
            <span className="value-view-lead">Most likely</span> {likelyText(d.figure, signed)}
            {d.figure.central === null && <span className="value-view-lead"> depending on how an open season goes</span>}
            <span className="muted trade-diff-range"> · could be {rangeText(d.figure, signed)}</span>
          </div>
          <DifferenceBar figure={d.figure} fmt={fmt} />
          <div className="trade-bar-ends muted" aria-hidden="true"><span>← More going out</span><span>More coming in →</span></div>
        </>
      ) : (
        <div className="trade-diff-figure trade-diff-unknown">
          <Tip label="Not a number yet: no one on one side could be valued." tip={d.reason ?? 'Not established.'} focusable />
        </div>
      )}
      {d.excluded.length > 0 && (
        <p className="muted trade-diff-note">
          Leaves out {d.excluded.map((x) => `${names.get(x.playerId) ?? 'a player'} (${x.reason.replace(/^Not valued( yet)?:\s*/i, '').replace(/\.$/, '').toLowerCase() || 'not valued yet'})`).join('; ')}.
        </p>
      )}
      {v.unit === 'wins' && v.unitReason && <p className="muted trade-diff-note"><Tip label="Shown in wins" tip={v.unitReason} focusable />: dollars aren't known for everyone in this deal.</p>}
      {d.status === 'known' && d.components.length > 0 && (
        <details className="value-details trade-parts">
          <summary>What makes up the difference</summary>
          <div className="history-scroll">
            <table className="mini">
              <thead>
                <tr><th>Player</th><th>Side</th><th className="num">Most likely</th><th className="num">Could be</th></tr>
              </thead>
              <tbody>
                {d.components.map((c) => (
                  <tr key={`${c.side}-${c.playerId}`}>
                    <td>{names.get(c.playerId) ?? c.playerId}</td>
                    <td>{c.side === 'sent' ? 'Going out' : 'Coming in'}</td>
                    <td className="num">{likelyText(c.part, signed)}</td>
                    <td className="num">{rangeText(c.part, signed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="value-basis">
            <li>Each player's figures are the ones on his player card; a player going out counts with his range reversed.</li>
            <li>Seasons further out count a little less, and only the part of this season still to be played counts.</li>
            <li>
              The range covers the reasonable readings of each player; it isn't a forecast with a stated chance.{' '}
              <Tip label="How the sides are added up" tip={d.text} focusable />
            </li>
          </ul>
        </details>
      )}
      {v.ourView && (v.ourView.leaning && v.ourView.difference.figure ? (
        <div className="trade-ours">
          <Tip label="Our view" tip={TIP_OUR_VIEW} focusable /> <span className="muted">({club})</span>:{' '}
          most likely <strong>{likelyText(v.ourView.difference.figure, signed)}</strong>
          <span className="muted"> · could be {rangeText(v.ourView.difference.figure, signed)}</span>
        </div>
      ) : (
        <div className="trade-ours muted">{club}{club.endsWith('s') ? "'" : "'s"} philosophy doesn't lean on these players: our view is the same.</div>
      ))}
      <SalaryLine analysis={analysis} />
      {analysis.winValues.map((w) => <ClubWinValueLine key={w.teamId} value={w} />)}
    </section>
  );
}

function SalaryLine({ analysis }: { analysis: TradeAnalysis }) {
  const s = analysis.salary;
  const part = (side: typeof s.sent, words: string) =>
    `${costMoney(side.known)} ${words}${side.unknown.length > 0 ? ` (${side.unknown.length} not known)` : ''}`;
  const season = s.sent.season ?? s.received.season;
  return (
    <div className="muted trade-salary">
      <Tip label={`Salary${season ? ` in ${season}` : ' this season'}`} tip={TIP_SALARY} focusable />: {part(s.sent, 'going out')} · {part(s.received, 'coming in')}
    </div>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────────

const picksOf = (rows: TradeRow[]): TradePick[] =>
  rows.map((r) => ({ player_id: r.playerId, name: r.name, age: r.age, positionName: r.position, team: r.teamAbbr ?? r.team }));

/**
 * The Trade Center's analysis area: both sides with their rows and totals, then the difference. Designed states: empty
 * ("add players to each side"), one side empty, loading (rows shown, figures pending), error (with a retry). Pure: it
 * renders what it is given.
 */
export function TradeAnalysisPanel({
  orgLabel, sent, received, loading, error, analysis, onRetry, onRemove, searchSent, searchReceived, middle,
}: {
  orgLabel: string;
  sent?: TradePick[];
  received?: TradePick[];
  loading: boolean;
  error: string | null;
  analysis: TradeAnalysis | null;
  onRetry: () => void;
  onRemove?: (side: 'sent' | 'received', id: number) => void;
  searchSent?: ReactNode;
  searchReceived?: ReactNode;
  middle?: ReactNode;
}) {
  const sentPicks = sent ?? (analysis ? picksOf(analysis.sent) : []);
  const receivedPicks = received ?? (analysis ? picksOf(analysis.received) : []);
  const ready = !!analysis && !loading && !error;
  const current = ready
    && sentPicks.every((p) => analysis!.sent.some((r) => r.playerId === p.player_id))
    && receivedPicks.every((p) => analysis!.received.some((r) => r.playerId === p.player_id));

  let status: ReactNode = null;
  if (sentPicks.length === 0 && receivedPicks.length === 0) {
    status = <p className="trade-state">Add players to each side to see what the deal is worth: search above, or load an offer or a target from your inbox.</p>;
  } else if (sentPicks.length === 0) {
    status = <p className="trade-state">Add a player to the side you'd send.</p>;
  } else if (receivedPicks.length === 0) {
    status = <p className="trade-state">Add a player to the side you'd receive.</p>;
  } else if (error) {
    status = (
      <div className="trade-state trade-state-error" role="alert">
        <p>The deal couldn't be weighed: {error}</p>
        <button type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  } else if (loading || !current) {
    status = <p className="trade-state muted" aria-live="polite">Weighing the deal…</p>;
  }

  return (
    <>
      <div className="trade-builder">
        <TradeSideColumn
          title={`${orgLabel} send`} side="sent" picks={sentPicks} analysis={analysis} pending={!current}
          onRemove={onRemove ? (id) => onRemove('sent', id) : undefined} search={searchSent}
        />
        <div className="trade-middle">{middle ?? <span className="trade-arrows" aria-hidden="true">⇄</span>}</div>
        <TradeSideColumn
          title={`${orgLabel} receive`} side="received" picks={receivedPicks} analysis={analysis} pending={!current}
          onRemove={onRemove ? (id) => onRemove('received', id) : undefined} search={searchReceived}
        />
      </div>
      {status ?? (analysis && <DifferenceView analysis={analysis} />)}
    </>
  );
}

