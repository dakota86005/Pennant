import { Fragment, useState } from 'react';
import { PlayerLink } from '../../playerModal';
import { Chip, FINDING_TEXT, ord, signed, STRENGTH_CLASS } from './common';
import type { Route } from './route';
import type { LineupSpot, Overview, ReviewGroup, ReviewHolder } from './types';

/*
 * Position players: the lineup as usage shows it, each regular read on his bat, his glove at the position and his running, against the
 * standard for his job. The main row is what a GM scans; the detail under it is what a scout would say if asked.
 */

function PlatoonChip({ h }: { h: ReviewHolder }) {
  const p = h.platoon;
  if (!p) return <span className="muted">—</span>;
  const cls = p.verdict === 'problem' ? 'ineligible' : p.verdict === 'no_issue' ? 'eligible' : 'indeterminate';
  const text = p.verdict === 'problem' ? `weak vs ${p.weakSide === 'L' ? 'LHP' : 'RHP'}` : p.verdict === 'no_issue' ? 'no issue' : 'not enough';
  return <Chip cls={cls} title={p.reasons.join('\n')}>{text}</Chip>;
}

function Detail({ h, spot, go }: { h: ReviewHolder; spot: LineupSpot; go: (r: Route) => void }) {
  const e = h.evidence;
  const prof = e.toolsProfile;
  const est = h.estimate;
  const p = h.platoon;
  return (
    <div className="mlb-detail three">
      <div>
        <h4>The bat</h4>
        {prof && <div>{prof.text}</div>}
        {prof && <div className="mlb-chips">{prof.contributions.filter((c) => c.tool !== 'avoidK').map((c) => <span key={c.tool} className={`mlb-tag ${c.points >= 9 ? 'plus' : c.points <= -9 ? 'minus' : ''}`}>{c.tool === 'gap' ? 'gap' : c.tool} {c.rating} <i>{signed(c.points)}</i></span>)}</div>}
        <div className="mlb-option-line">Tools {ord(est.ratingsPct)} · results {est.resultsPct === null ? 'no sample' : `${ord(est.resultsPct)} (trusted ${Math.round(e.reliability * 100)}%)`}</div>
        {e.toolsExpected != null && <div className="muted mlb-option-line">His visible tools imply {signed(e.toolsExpected * 1000)} points of wOBA against the league average.</div>}
        {h.standard && <div className="muted mlb-option-line">{h.standard.label}: typical {Math.round(h.standard.typical)}, unusually weak under {Math.round(h.standard.floor)}, well under {Math.round(h.standard.deepFloor)}.</div>}
      </div>
      <div>
        <h4>Glove and running</h4>
        {(est.weightOnDefense ?? 0) > 0 && est.defensePct != null
          ? <div>Glove {ord(est.defensePct)} at {spot.label}, {Math.round((est.weightOnDefense ?? 0) * 100)}% of his estimate.</div>
          : <div className="muted">{spot.position === 10 ? 'A designated hitter is his bat alone.' : 'His glove at the position is not visible: the estimate is his bat alone.'}</div>}
        {e.defense?.visible && <div className="muted mlb-option-line">Visible grade {e.defense.grade ?? '—'} ({ord(e.defense.pct)} among those listed there){e.defense.resultsPct != null ? `; zone results ${ord(e.defense.resultsPct)} over ${Math.round(e.defense.resultsInnings ?? 0)} innings` : ''}.</div>}
        {est.runningPct != null
          ? <div className="mlb-option-line">Running {ord(est.runningPct)}, {Math.round((est.weightOnRunning ?? 0) * 100)}% of his estimate{e.running?.perSixHundred != null ? `; ${signed(e.running.perSixHundred)} baserunning runs per 600 PA` : ''}.</div>
          : <div className="muted mlb-option-line">No running evidence.</div>}
        {h.usage.filter((u) => !u.startsWith('His visible tools imply')).map((u) => <div key={u} className="muted mlb-option-line">{u}</div>)}
      </div>
      <div>
        <h4>Platoon</h4>
        {p ? (
          <>
            <div>{p.verdict === 'problem' ? `Weak against ${p.weakSide === 'L' ? 'left' : 'right'}-handers.` : p.verdict === 'no_issue' ? 'No platoon problem.' : 'Not enough to read a platoon split.'} <span className="muted">Basis: {(p.basis ?? 'none').replace(/_/g, ' ')}.</span></div>
            {p.drivers && p.drivers.league !== null && p.difference != null && (
              <div className="muted mlb-option-line">Against right minus left, {signed(p.difference * 1000)} points: league norm {signed((p.drivers.league as number) * 1000)}{p.drivers.ratings !== null ? `, his ratings ${signed(p.drivers.ratings * 1000)}` : ''}{p.drivers.record !== null ? `, his record ${signed(p.drivers.record * 1000)}` : ''}.</div>
            )}
            {p.reasons.map((t) => <div key={t} className="muted mlb-option-line">{t}</div>)}
          </>
        ) : <div className="muted">No platoon read.</div>}
        {spot.partner && <div className="mlb-option-line">Shares the spot with <PlayerLink id={spot.partner.playerId}>{spot.partner.name}</PlayerLink> ({Math.round(spot.partner.share * 100)}% of the innings).</div>}
        <div className="mlb-actions">
          {(h.strength === 'strong' || h.strength === 'moderate') && <button className="link" onClick={() => go({ view: 'decision', needId: `mlb:role_holder_review:${h.playerId}` })}>Replacement options →</button>}
          {p?.verdict === 'problem' && <button className="link" onClick={() => go({ view: 'decision', needId: `mlb:platoon_complement:${h.playerId}` })}>Platoon partner →</button>}
        </div>
      </div>
    </div>
  );
}

export function PositionPlayers({ data, go }: { data: Overview; go: (r: Route) => void }) {
  const g: ReviewGroup | undefined = data.review.find((x) => x.role === 'lineup regular');
  const [open, setOpen] = useState<number | null>(null);
  if (!g || !g.lineup) return <p className="muted">No lineup usage is available, so the lineup cannot be reviewed.</p>;
  const byId = new Map(g.holders.map((h) => [h.playerId, h]));
  const spots = [...g.lineup.spots, g.lineup.dh];
  return (
    <div>
      <p className="muted mlb-lede">Each regular is read on two lenses, tools against MLB peers and results (league-relative, park-adjusted, several seasons, weighted by sample), blended into a working estimate; his estimate is his bat, his glove at the position he plays and a little for running. A flag means he is unusually weak <b>for the job he is doing</b>: what regulars at his position typically are is shown with him. It is a reason to look, not a recommendation to move him.</p>
      <div className="mlb-scroll"><table className="mlb-lineup">
        <thead><tr><th>Spot</th><th>Regular</th><th>Estimate</th><th>Bat</th><th>Glove</th><th>Run</th><th>Platoon</th><th>Read</th><th /></tr></thead>
        <tbody>
          {spots.map((sp) => {
            if (!sp.regular) {
              return <tr key={sp.position}><td>{sp.label}</td><td colSpan={8} className="muted">Unsettled: {sp.backups.length ? sp.backups.map((b) => `${b.name} (${Math.round(b.share * 100)}%)`).join(', ') : 'nobody has played it'}</td></tr>;
            }
            const h = byId.get(sp.regular.playerId);
            const est = h?.estimate;
            const isOpen = open === sp.position;
            return (
              <Fragment key={sp.position}>
                <tr className="mlb-row" onClick={() => setOpen(isOpen ? null : sp.position)}>
                  <td>{sp.label}</td>
                  <td className="name"><PlayerLink id={sp.regular.playerId}>{sp.regular.name}</PlayerLink> <span className="muted">{sp.regular.bats ?? '?'} · {Math.round(sp.regular.share * 100)}%{sp.partner ? ` · shares with ${sp.partner.name}` : ''}</span></td>
                  <td>{h ? <>{ord(est?.value)}{h.standard && <div className="muted mlb-option-line">role typical {Math.round(h.standard.typical)}</div>}</> : '—'}</td>
                  <td>{h ? ord(est?.batValue ?? est?.value) : '—'}</td>
                  <td>{est?.defensePct != null && (est.weightOnDefense ?? 0) > 0 ? ord(est.defensePct) : <span className="muted">{sp.position === 10 ? 'n/a' : 'not shown'}</span>}</td>
                  <td>{est?.runningPct != null ? ord(est.runningPct) : <span className="muted">—</span>}</td>
                  <td>{h ? <PlatoonChip h={h} /> : '—'}</td>
                  <td>{h ? <Chip cls={STRENGTH_CLASS[h.strength]} title={[...h.reasons, ...h.explanations].join('\n')}>{FINDING_TEXT[h.kind]}</Chip> : '—'}</td>
                  <td className="muted">{isOpen ? '▾' : '▸'}</td>
                </tr>
                {isOpen && h && <tr><td colSpan={9}><Detail h={h} spot={sp} go={go} /></td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table></div>
      <p className="muted">{g.lineup.basis}</p>
    </div>
  );
}
