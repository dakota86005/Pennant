import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { Group } from '@visx/group';
import { Area, Line, LinePath } from '@visx/shape';
import { getProductionCone, isStaticSite, type ConeSeason, type ProductionCone } from './api';
import { CHART_COLOR, CHART_MARK, CHART_OPACITY, CHART_TEXT } from './chartTheme';
import { REPLACEMENT_LABEL, coneGeometry, coneSummary, coverageText, formatWins, type ConeGeometry } from './productionConeGeometry';

/**
 * The player card's production cone (PLAYER_VALUE.md Part 8): expected wins per season with the 80%
 * and 50% bands, like a hurricane map's cone, and each season's control beneath it. Everything drawn
 * is Player Value's answer as served (`/api/player-value/:id/cone`); the browser lays it out and
 * computes nothing about the player. Unknown production draws no cone, only its reason.
 */

const POP_WIDTH = 260;

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
        </tbody>
      </table>
      {basis && <div className="muted">Rests on: {basis}.</div>}
      <div className="muted">Control: {s.control.detail || s.control.label}</div>
      {s.coverage.cases === null && <div className="muted">{s.coverage.note}</div>}
      {s.notes.map((n) => <div key={n} className="muted">{n}</div>)}
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
  const [active, setActive] = useState<number | null>(null);

  if (cone.status !== 'projected' || cone.seasons.length === 0) {
    return (
      <p className="muted cone-unknown">
        Expected production not yet established: {cone.reason ?? 'Player Value states no projection for him.'}
      </p>
    );
  }

  const g = coneGeometry(cone.seasons, width);
  const summary = coneSummary(cone);
  const side = active !== null && g.x[active] > width / 2 ? 'left' : 'right';
  const popLeft = active === null ? 0
    : width < POP_WIDTH * 2 + 32
      ? Math.min(Math.max(0, g.x[active] - POP_WIDTH / 2), Math.max(0, width - POP_WIDTH))
      : side === 'right' ? g.x[active] + 16 : g.x[active] - 16 - POP_WIDTH;
  const popTop = width < POP_WIDTH * 2 + 32 ? g.height + 4 : g.plot.top;

  return (
    <>
      <div className="cone-legend" aria-hidden="true">
        <span className="cone-key"><span className="cone-swatch outer" />80% of outcomes fall inside</span>
        <span className="cone-key"><span className="cone-swatch inner" />50% of outcomes fall inside</span>
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
        <svg width={g.width} height={g.height} role="img" aria-label={summary}>
          <Group>
            <Cone g={g} active={active} />
          </Group>
        </svg>
        {cone.seasons.map((s, i) => (
          <button
            key={s.season}
            type="button"
            className="cone-hit"
            tabIndex={0}
            style={{ left: g.x[i] - g.slot / 2, width: g.slot, top: g.plot.top, height: g.height - g.plot.top }}
            aria-label={`${s.season}, ${s.control.label}: ${formatWins(s.central)} wins expected, 80% band ${formatWins(s.outer.low)} to ${formatWins(s.outer.high)} (${coverageText(s.coverage.outer)}), 50% band ${formatWins(s.inner.low)} to ${formatWins(s.inner.high)} (${coverageText(s.coverage.inner)})`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((a) => (a === i ? null : a))}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((a) => (a === i ? null : a))}
          />
        ))}
        {active !== null && (
          <div className="chart-pop" role="tooltip" style={{ left: popLeft, top: popTop, width: POP_WIDTH }}>
            <SeasonDetail season={cone.seasons[active]} basis={cone.basis} />
          </div>
        )}
      </div>
      {g.key.length > 0 && (
        <p className="muted cone-foot">{g.key.map((k) => `${k.code} = ${k.label.toLowerCase()}`).join(' · ')}</p>
      )}
      {cone.control.note && <p className="muted cone-foot">{cone.control.note}</p>}
      <p className="muted cone-foot" title={cone.calibration.detail}>{cone.calibration.status}</p>
      {/* A table ignores width: 1px and grows to its content, so the hiding
          wrapper is a div; otherwise it pushes the card into horizontal scroll */}
      <div className="visually-hidden">
      <table>
        <caption>Expected wins above replacement per season</caption>
        <thead>
          <tr><th>Season</th><th>Control</th><th>Expected</th><th>50% band</th><th>80% band</th></tr>
        </thead>
        <tbody>
          {cone.seasons.map((s) => (
            <tr key={s.season}>
              <td>{s.season}</td>
              <td>{s.control.label}{s.control.after ? `, ${s.control.after.label.toLowerCase()}` : ''}</td>
              <td>{formatWins(s.central)}</td>
              <td>{formatWins(s.inner.low)} to {formatWins(s.inner.high)} ({coverageText(s.coverage.inner)})</td>
              <td>{formatWins(s.outer.low)} to {formatWins(s.outer.high)} ({coverageText(s.coverage.outer)})</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
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
      {cone && width > 0 && <ProductionConeChart cone={cone} width={width} />}
    </section>
  );
}
