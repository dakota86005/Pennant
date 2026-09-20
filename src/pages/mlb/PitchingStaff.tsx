import { Fragment, useState } from 'react';
import { PlayerLink } from '../../playerModal';
import { Chip, FINDING_TEXT, ord, STRENGTH_CLASS, TIER_TEXT } from './common';
import type { Route } from './route';
import type { Overview, PenFinding, ReviewGroup, ReviewHolder } from './types';

/*
 * The pitching staff: the rotation and the bullpen, each arm read on his tools and his results against the standard for his job, and the
 * bullpen read as it is actually used. A deployment finding says what the arm's role appears to be, what the evidence supports instead, and why
 * the difference matters; it is a usage decision for the manager, never a roster move.
 */

const KIND_HEADING: Record<string, string> = {
  no_credible_high_leverage: 'No credible high-leverage arm', no_multi_inning: 'Nobody throws multiple innings', crowded_role: 'A crowded role', starter_conflict: 'The rotation and the pen compete for an arm',
};

function Finding({ f }: { f: { heading: string; current: string; supported: string; why: string; players?: PenFinding['players'] } }) {
  return (
    <div className="mlb-finding">
      <b>{f.heading}</b>
      <dl>
        <dt>Now</dt><dd>{f.current}</dd>
        <dt>Evidence says</dt><dd>{f.supported}</dd>
        <dt>Why it matters</dt><dd>{f.why}</dd>
      </dl>
    </div>
  );
}

function ArmDetail({ h, go }: { h: ReviewHolder; go: (r: Route) => void }) {
  return (
    <div className="mlb-detail">
      <div>
        <h4>The read</h4>
        {h.reasons.map((t) => <div key={t}>{t}</div>)}
        {h.standard && <div className="muted mlb-option-line">{h.standard.label}: typical {Math.round(h.standard.typical)}, unusually weak under {Math.round(h.standard.floor)}, well under {Math.round(h.standard.deepFloor)}.</div>}
      </div>
      <div>
        <h4>What could explain it</h4>
        {h.explanations.length ? h.explanations.map((t) => <div key={t}>{t}</div>) : <div className="muted">Nothing unusual.</div>}
        {h.usage.map((u) => <div key={u} className="muted mlb-option-line">{u}</div>)}
        {(h.strength === 'strong' || h.strength === 'moderate') && <div className="mlb-actions"><button className="link" onClick={() => go({ view: 'decision', needId: `mlb:role_holder_review:${h.playerId}` })}>Replacement options →</button></div>}
      </div>
    </div>
  );
}

function ArmTable({ g, relief, go }: { g: ReviewGroup; relief: boolean; go: (r: Route) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mlb-scroll"><table>
      <thead><tr><th>Pitcher</th>{relief && <th>Used as</th>}<th>Estimate</th><th>Tools</th><th>Results</th><th>Read</th><th /></tr></thead>
      <tbody>
        {g.holders.map((h) => (
          <Fragment key={h.playerId}>
            <tr className="mlb-row" onClick={() => setOpen(open === h.playerId ? null : h.playerId)}>
              <td className="name"><PlayerLink id={h.playerId}>{h.name}</PlayerLink> <span className="muted">{h.age ?? '?'}</span></td>
              {relief && <td title={h.usage.join('\n')}>{h.tier ? TIER_TEXT[h.tier] : '—'}{h.stakes ? <span className="muted"> · {h.stakes} stakes</span> : null}</td>}
              <td>{ord(h.estimate.value)}{relief && h.standard && <div className="muted mlb-option-line">role typical {Math.round(h.standard.typical)}</div>}</td>
              <td>{ord(h.estimate.ratingsPct)}</td>
              <td>{h.estimate.resultsPct === null ? <span className="muted">no sample</span> : <>{ord(h.estimate.resultsPct)}<span className="muted"> ({Math.round(h.evidence.reliability * 100)}% trusted)</span></>}</td>
              <td><Chip cls={STRENGTH_CLASS[h.strength]} title={[...h.reasons, ...h.explanations].join('\n')}>{FINDING_TEXT[h.kind]}</Chip></td>
              <td className="muted">{open === h.playerId ? '▾' : '▸'}</td>
            </tr>
            {open === h.playerId && <tr><td colSpan={relief ? 7 : 6}><ArmDetail h={h} go={go} /></td></tr>}
          </Fragment>
        ))}
      </tbody>
    </table></div>
  );
}

export function PitchingStaff({ data, go }: { data: Overview; go: (r: Route) => void }) {
  const rotation = data.review.find((g) => g.kind === 'starting_pitcher');
  const pen = data.review.find((g) => g.kind === 'relief_pitcher');
  if (!rotation && !pen) return <p className="muted">There are no available pitchers to review.</p>;
  const findings = [
    ...(pen?.deployment ?? []).map((d) => ({ heading: 'A better arm in a lower role', current: d.current, supported: d.supported, why: d.why })),
    ...(pen?.pen ?? []).map((f) => ({ heading: KIND_HEADING[f.kind] ?? f.kind, current: f.current, supported: f.supported, why: f.why })),
  ];
  return (
    <div>
      <p className="muted mlb-lede">Each arm is read on his tools against MLB pitchers of his kind and on his results (peripherals first: strikeouts, walks, home runs; runs allowed keep a small share), blended by how much sample stands behind the results. A flag means he is unusually weak <b>for the job he is doing</b>: a long man is measured against long men, a closer against closers.</p>
      {rotation && <section className="mlb-panel"><h3>Rotation</h3><ArmTable g={rotation} relief={false} go={go} /></section>}
      {pen && (
        <section className="mlb-panel">
          <h3>Bullpen</h3>
          {findings.length > 0 && <div className="mlb-findings">{findings.map((f) => <Finding key={`${f.heading}:${f.current}`} f={f} />)}</div>}
          {findings.length === 0 && <p className="muted">No deployment notes: the arms are used about where the evidence puts them.</p>}
          <ArmTable g={pen} relief go={go} />
          <p className="muted">A reliever's role is what his usage shows this season: the leverage of the innings he is given, how long he throws, and saves and holds. Too few appearances, or no exported leverage, is "not yet clear", never a guess.</p>
        </section>
      )}
    </div>
  );
}
