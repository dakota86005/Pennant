import { Component, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Group } from '@visx/group';
import { Area, Line, LinePath } from '@visx/shape';
import { getProductionCone, isStaticSite, type ConeSeason, type ConeUnestablished, type ProductionCone } from './api';
import { CHART_COLOR, CHART_MARK, CHART_OPACITY, CHART_TEXT, textWidth } from './chartTheme';
import { COST_BAND_WORDS, centralText, costBandText } from './costBand';
import {
  REPLACEMENT_LABEL, bandWords, coneGeometry, coneIsDrawable, coneLabel, coneSummary, coverageText, formatWins, type ConeGeometry,
} from './productionConeGeometry';

/**
 * The player card's production cone (PLAYER_VALUE.md Part 8): expected wins per season with the 80%
 * and 50% bands, like a hurricane map's cone, and each season's control beneath it. Everything drawn
 * is Player Value's answer as served (`/api/player-value/:id/cone`); the browser lays it out and
 * computes nothing about the player. Unknown production draws no cone, only its reason.
 */

const POP_WIDTH = 260;
/** Below this width the detail sits in the flow under the chart rather than beside a season. */
const NARROW = POP_WIDTH * 2 + 32;

/**
 * A season's cost as served (phase 4a, review): "$8.5M", "$4.6M–$25.3M if held", "$780K–$790K" (a band never reads
 * as a point), "none (control ends)", "none (no club holds him)" or "not established"; an option season adds its
 * declined branch. The basis paragraph stays in the detail, not here.
 */
const costText = (c: ConeSeason['control']): string => {
  const declined = c.declined
    ? `; declined: ${c.declined.label}${c.declined.cost ? ` ${costBandText(c.declined.cost.low, c.declined.cost.high)}${c.declined.ifHeld ? ' if held' : ''}` : c.declined.status === 'free_agent' ? ' (no cost to this club)' : ' (cost not established)'}`
    : '';
  if (!c.cost) {
    if (c.status === 'unsigned') return 'none (no club holds him)';
    return c.costDetail && /^Control ends/.test(c.costDetail) ? 'none (control ends)' : `not established${declined}`;
  }
  return `${costBandText(c.cost.low, c.cost.high)}${c.ifHeld ? ' if held' : ''}${declined}`;
};

/** Under the cost line: its central and what the band is, for a band (a contract's point needs neither). */
const costSubline = (c: ConeSeason['control']): string => {
  if (!c.cost || c.cost.low === c.cost.high) return '';
  const central = centralText(c.cost);
  return `${central ? `${central}; ` : ''}${COST_BAND_WORDS}${c.ifHeld ? '. If held: he may leave instead, or the player decides' : ''}.`;
};

/** Expected playing time for a season, per side: "about 560 PA (400–650)". */
const usageText = (u: ConeSeason['usage'][number]): string =>
  `about ${Math.round(u.central).toLocaleString('en-US')} ${u.unit} (${Math.round(u.low).toLocaleString('en-US')}–${Math.round(u.high).toLocaleString('en-US')})`;

/** The hover and focus detail for one season: values first, then what they rest on. */
export function SeasonDetail({ season: s, basis }: { season: ConeSeason; basis: string }) {
  return (
    <>
      <div className="cone-pop-head">
        <strong>{s.season}</strong> · age {s.age} · {s.control.label}
        {s.control.after ? ` · ${s.control.after.label.toLowerCase()}` : ''}
      </div>
      <table className="mini cone-pop-table">
        <tbody>
          <tr>
            <td className="muted">Expected</td>
            <td><strong>{formatWins(s.central)}</strong> wins</td>
          </tr>
          <tr>
            <td className="muted">80% band</td>
            <td>
              {formatWins(s.outer.low)} to {formatWins(s.outer.high)}
              <div className="muted">{coverageText(s.coverage.outer)}</div>
            </td>
          </tr>
          <tr>
            <td className="muted">50% band</td>
            <td>
              {formatWins(s.inner.low)} to {formatWins(s.inner.high)}
              <div className="muted">{coverageText(s.coverage.inner)}</div>
            </td>
          </tr>
          {s.toDate !== null && (
            <tr>
              <td className="muted">Banked</td>
              <td>{formatWins(s.toDate)} so far this season</td>
            </tr>
          )}
          {s.usage.length > 0 && (
            <tr>
              <td className="muted">Playing time</td>
              <td>{s.usage.map(usageText).join('; ')}</td>
            </tr>
          )}
          {s.control.costDetail !== undefined && (
            <tr>
              <td className="muted">Cost</td>
              <td>
                {costText(s.control)}
                {costSubline(s.control) && <div className="muted">{costSubline(s.control)}</div>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {basis && <div className="muted">Rests on: {basis}.</div>}
      <div className="muted">Control: {s.control.detail || s.control.label}</div>
      {s.control.costDetail && !(s.control.cost && s.control.cost.low === s.control.cost.high && !s.control.declined) && <div className="muted">Cost: {s.control.costDetail}</div>}
      {s.coverage.cases === null && <div className="muted">{s.coverage.note}</div>}
      {s.notes.map((n) => <div key={n} className="muted">{n}</div>)}
    </>
  );
}

/** The hover and focus detail for a season whose production is not established: its control and why, no figure. */
export function UnestablishedDetail({ season: s }: { season: ConeUnestablished }) {
  return (
    <>
      <div className="cone-pop-head">
        <strong>{s.season}</strong> · age {s.age} · {s.control.label}
        {s.control.after ? ` · ${s.control.after.label.toLowerCase()}` : ''}
      </div>
      <table className="mini cone-pop-table">
        <tbody>
          <tr>
            <td className="muted">Expected</td>
            <td><strong>Not established</strong></td>
          </tr>
          {s.control.costDetail !== undefined && (
            <tr>
              <td className="muted">Cost</td>
              <td>
                {costText(s.control)}
                {costSubline(s.control) && <div className="muted">{costSubline(s.control)}</div>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="muted">{s.reason}</div>
      <div className="muted">Control: {s.control.detail || s.control.label}</div>
      {s.control.costDetail && <div className="muted">Cost: {s.control.costDetail}</div>}
    </>
  );
}

/** The mark over the seasons not established: a muted, outlined region with its words, and no band or zero in it. */
function Unestablished({ g }: { g: ConeGeometry }) {
  const u = g.unestablished;
  if (!u) return null;
  const inset = 4;
  const w = Math.max(0, u.right - u.left - inset * 2);
  // Production, not control: a season's control label below may itself read "Not established"
  const words = ['Production not established', 'Not established', 'Not est.', 'N/E'].find((t) => textWidth(t) + 8 <= w) ?? '';
  return (
    <>
      <rect x={u.left + inset} y={g.plot.top} width={w} height={g.plot.bottom - g.plot.top} rx={4}
        fill={CHART_COLOR.surface} fillOpacity={0.75} stroke={CHART_COLOR.grid} strokeDasharray="4 4" />
      {words && (
        <text x={u.left + inset + w / 2} y={(g.plot.top + g.plot.bottom) / 2} dy="0.33em" textAnchor="middle"
          fill={CHART_COLOR.muted} fontSize={CHART_TEXT.size} fontFamily={CHART_TEXT.family}>
          {words}
        </text>
      )}
    </>
  );
}

function Cone({ g, active }: { g: ConeGeometry; active: number | null }) {
  const band = (spans: ConeGeometry['outer'], opacity: number) =>
    g.shape === 'area'
      ? <Area data={spans} x={(d) => d.x} y0={(d) => d.bottom} y1={(d) => d.top} fill={CHART_COLOR.mark} fillOpacity={opacity} />
      : spans.map((d) => (
        <rect key={d.x} x={d.x - CHART_MARK.interval / 2} width={CHART_MARK.interval} y={d.top} height={Math.max(1, d.bottom - d.top)}
          rx={3} fill={CHART_COLOR.mark} fillOpacity={opacity} />
      ));
  return (
    <>
      {g.ticks.filter((t) => t !== 0).map((t) => (
        <Line key={t} from={{ x: g.plot.left, y: g.y(t) }} to={{ x: g.plot.right, y: g.y(t) }} stroke={CHART_COLOR.grid} strokeWidth={1} />
      ))}
      {g.ticks.map((t) => (
        <text key={t} x={g.plot.left - 6} y={g.y(t)} dy="0.33em" textAnchor="end" fill={CHART_COLOR.muted}
          fontSize={CHART_TEXT.size} fontFamily={CHART_TEXT.family} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {t === 0 ? '0' : formatWins(t).replace(/\.0$/, '')}
        </text>
      ))}
      {band(g.outer, CHART_OPACITY.outerBand)}
      {band(g.inner, CHART_OPACITY.innerBand)}
      <Line from={{ x: g.plot.left, y: g.baseline }} to={{ x: g.plot.right, y: g.baseline }} stroke={CHART_COLOR.muted} strokeWidth={1} strokeDasharray="4 4" />
      {g.replacementLabel && (
        <text x={g.plot.right + 6} y={g.baseline} dy="0.33em" fill={CHART_COLOR.muted} fontSize={CHART_TEXT.size - 1} fontFamily={CHART_TEXT.family}>
          {REPLACEMENT_LABEL}
        </text>
      )}
      <Unestablished g={g} />
      {active !== null && (
        <Line from={{ x: g.x[active], y: g.plot.top }} to={{ x: g.x[active], y: g.plot.bottom }} stroke={CHART_COLOR.muted} strokeWidth={1} />
      )}
      {g.path.length > 1 && (
        <LinePath data={g.path} x={(d) => d.x} y={(d) => d.y} stroke={CHART_COLOR.mark} strokeWidth={CHART_MARK.line}
          strokeDasharray="0 5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {g.path.map((d, i) => (
        <circle key={d.x} cx={d.x} cy={d.y} r={i === active ? CHART_MARK.markerActive : CHART_MARK.marker}
          fill={CHART_COLOR.mark} stroke={CHART_COLOR.surface} strokeWidth={CHART_MARK.ring} />
      ))}
      {g.labels.map((l, i) => (
        <text key={l.x} x={l.x} y={g.labelTop} textAnchor="middle" fontFamily={CHART_TEXT.family} fontSize={CHART_TEXT.size}>
          {l.lines.map((line, k) => (
            <tspan key={k} x={l.x} dy={k === 0 ? '0.8em' : CHART_TEXT.lineHeight}
              fill={k === 0 ? CHART_COLOR.ink : CHART_COLOR.muted} fontWeight={k === 0 && i === active ? 700 : 400}>
              {line}
            </tspan>
          ))}
        </text>
      ))}
    </>
  );
}

/** The cone at a given width: legend, the chart, the calibration line, and a table for screen readers. */
export function ProductionConeChart({ cone, width }: { cone: ProductionCone; width: number }) {
  // Hover and keyboard focus are tracked apart, so leaving a hovered season never clears the focused one (D-22)
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const tipId = `${useId()}-season`;

  if (cone.status !== 'projected' || cone.seasons.length === 0) {
    return (
      <p className="muted cone-unknown">
        Expected production not yet established: {cone.reason ?? 'Player Value states no projection for him.'}
      </p>
    );
  }
  // One figure that is not a number would break the drawing; say so rather than draw it (D-24)
  if (!coneIsDrawable(cone)) {
    return <p className="muted cone-unknown">Expected production could not be drawn: a figure the server sent is not a number.</p>;
  }

  const active = dismissed ? null : hovered ?? focused;
  // The seasons after the established ones whose production is not established keep a slot, no band (hardening F6)
  const pending = cone.notEstablished ?? [];
  const known = cone.seasons.length;
  const g = coneGeometry(cone.seasons, width, pending);
  const words = bandWords(cone);
  const narrow = width < NARROW;
  const side = active !== null && g.x[active] > width / 2 ? 'left' : 'right';
  const popLeft = active === null || narrow ? 0 : side === 'right' ? g.x[active] + 16 : g.x[active] - 16 - POP_WIDTH;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    // Escape closes the season's detail first; only a second Escape reaches the card (D-22)
    if (e.key === 'Escape' && active !== null) {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      setHovered(null);
    }
  };
  const show = (set: (i: number | null) => void, i: number) => { setDismissed(false); set(i); };

  const detail = active !== null && (
    <div id={tipId} className={`chart-pop${narrow ? ' cone-pop-inline' : ''}`} role="tooltip"
      style={narrow ? undefined : { left: popLeft, top: g.plot.top, width: POP_WIDTH }}>
      {active < known
        ? <SeasonDetail season={cone.seasons[active]} basis={cone.basis} />
        : <UnestablishedDetail season={pending[active - known]} />}
    </div>
  );

  return (
    <>
      <div className="cone-legend" aria-hidden="true">
        <span className="cone-key"><span className="cone-swatch outer" />{words.outer}</span>
        <span className="cone-key"><span className="cone-swatch inner" />{words.inner}</span>
        <span className="cone-key">
          <svg width="22" height="10" aria-hidden="true">
            <line x1="2" y1="5" x2="20" y2="5" stroke={CHART_COLOR.mark} strokeWidth={CHART_MARK.line} strokeDasharray="0 5" strokeLinecap="round" />
            <circle cx="11" cy="5" r="3" fill={CHART_COLOR.mark} />
          </svg>
          Expected wins (WAR)
        </span>
        <span className="cone-key">
          <svg width="22" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="21" y2="5" stroke={CHART_COLOR.muted} strokeWidth={1} strokeDasharray="4 4" />
          </svg>
          Replacement level (0 wins)
        </span>
      </div>
      <div className="cone-plot" style={{ height: g.height }}>
        <svg width={g.width} height={g.height} role="img" aria-label={coneLabel(cone)}>
          <Group>
            <Cone g={g} active={active} />
          </Group>
        </svg>
        {[...cone.seasons, ...pending].map((s, i) => (
          <button
            key={s.season}
            type="button"
            className="cone-hit"
            tabIndex={0}
            style={{ left: g.x[i] - g.slot / 2, width: g.slot, top: g.plot.top, height: g.height - g.plot.top }}
            aria-label={'central' in s
              ? `${s.season}, ${s.control.label}: ${formatWins(s.central)} wins expected, 80% band ${formatWins(s.outer.low)} to ${formatWins(s.outer.high)} (${coverageText(s.coverage.outer)}), 50% band ${formatWins(s.inner.low)} to ${formatWins(s.inner.high)} (${coverageText(s.coverage.inner)})`
              : `${s.season}, ${s.control.label}: expected production not established. ${s.reason}`}
            aria-describedby={active === i ? tipId : undefined}
            aria-expanded={active === i}
            onMouseEnter={() => show(setHovered, i)}
            onMouseLeave={() => setHovered((a) => (a === i ? null : a))}
            onFocus={() => show(setFocused, i)}
            onBlur={() => setFocused((a) => (a === i ? null : a))}
            onKeyDown={onKeyDown}
          />
        ))}
        {!narrow && detail}
      </div>
      {narrow && detail}
      {g.key.length > 0 && (
        <p className="muted cone-foot">{g.key.map((k) => `${k.code} = ${k.label.toLowerCase()}`).join(' · ')}</p>
      )}
      {cone.control.note && <p className="muted cone-foot">{cone.control.note}</p>}
      <p className="muted cone-foot" title={cone.calibration.detail}>{cone.calibration.status}</p>
      {/* A table ignores width: 1px and grows to its content, so the hiding
          wrapper is a div; otherwise it pushes the card into horizontal scroll.
          It carries every figure the season detail shows (D-20). */}
      <div className="visually-hidden">
        <p>{coneSummary(cone)}</p>
        <table>
          <caption>Expected wins above replacement per season. {cone.basis ? `Rests on: ${cone.basis}.` : ''} {cone.calibration.status}.</caption>
          <thead>
            <tr>
              <th>Season</th><th>Age</th><th>Control</th><th>Cost</th><th>Expected</th><th>50% band</th><th>80% band</th>
              <th>Banked</th><th>Playing time</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {cone.seasons.map((s) => (
              <tr key={s.season}>
                <td>{s.season}</td>
                <td>{s.age}</td>
                <td>{s.control.label}{s.control.after ? `, ${s.control.after.label.toLowerCase()}` : ''}. {s.control.detail}</td>
                <td>{costText(s.control)}{s.control.cost && centralText(s.control.cost) ? ` (${centralText(s.control.cost)})` : ''}</td>
                <td>{formatWins(s.central)}</td>
                <td>{formatWins(s.inner.low)} to {formatWins(s.inner.high)} ({coverageText(s.coverage.inner)})</td>
                <td>{formatWins(s.outer.low)} to {formatWins(s.outer.high)} ({coverageText(s.coverage.outer)})</td>
                <td>{s.toDate === null ? 'none this season' : `${formatWins(s.toDate)} so far`}</td>
                <td>{s.usage.length > 0 ? s.usage.map(usageText).join('; ') : 'not stated'}</td>
                <td>{[s.coverage.cases === null ? s.coverage.note : '', ...s.notes].filter(Boolean).join(' ')}</td>
              </tr>
            ))}
            {pending.map((s) => (
              <tr key={s.season}>
                <td>{s.season}</td>
                <td>{s.age}</td>
                <td>{s.control.label}{s.control.after ? `, ${s.control.after.label.toLowerCase()}` : ''}. {s.control.detail}</td>
                <td>{costText(s.control)}{s.control.cost && centralText(s.control.cost) ? ` (${centralText(s.control.cost)})` : ''}</td>
                <td>not established</td>
                <td>not established</td>
                <td>not established</td>
                <td>none this season</td>
                <td>not established</td>
                <td>{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** A render error in the chart stays in the chart's section and never blanks the card or the app (D-24). */
class ConeBoundary extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { failed: error.message || 'unknown error' };
  }
  render() {
    return this.state.failed
      ? <p className="muted cone-unknown">Expected production could not be drawn: {this.state.failed}</p>
      : this.props.children;
  }
}

/** The card's section: fetches the cone and sizes the chart to the card's width. */
export function ProductionConeSection({ playerId }: { playerId: number }) {
  const ref = useRef<HTMLElement>(null);
  const [cone, setCone] = useState<ProductionCone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // A static export carries the card but not this route (server/exporter.ts)
    if (isStaticSite()) return;
    let live = true;
    setCone(null);
    setError(null);
    getProductionCone(playerId)
      .then((c) => { if (live) setCone(c); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [playerId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (isStaticSite()) return null;
  return (
    <section className="production-cone" ref={ref}>
      <h3>Expected production</h3>
      {error && <p className="muted">Expected production could not be loaded: {error}</p>}
      {!cone && !error && <p className="muted">Loading expected production…</p>}
      {cone && width > 0 && (
        <ConeBoundary key={playerId}>
          <ProductionConeChart cone={cone} width={width} />
        </ConeBoundary>
      )}
    </section>
  );
}
