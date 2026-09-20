import { useEffect, useState } from 'react';
import { apiGet } from '../../api';
import { PlayerLink } from '../../playerModal';
import {
  BASIS, Chain, Chip, COMPARE_CLASS, COMPARE_TEXT, ContextStrip, DEV, DEV_CLASS, FarmView, horizonText, KIND_LABEL, NeedBadge, ord, PATH, PATH_CLASS, PATH_LABEL,
  PREFERENCE, ShadingList, STANCE_CLASS, STANCE_TEXT, VERDICT_CLASS, VERDICT_TEXT,
} from './common';
import type { Candidate, ConstraintClearing, ClearingOption, Explanation, Need, Packet, Pathway, Plan, Recommendation, Report, RoleRow } from './types';

/*
 * A decision: one need, opened. The order is the GM's: the problem, why it was flagged and on what evidence, what the staff recommends,
 * the ways to respond followed through to their consequences, and only then the candidates and roster mechanics behind them. Nothing
 * here ranks players or chooses a move; every verdict is the owning specialist's, labelled with who said it.
 */

const PLAN_STATUS_CLASS: Record<string, string> = { eligible: 'eligible', ineligible: 'ineligible', indeterminate: 'indeterminate', not_a_transaction: '' };
const DURATIONS: Array<[string, string]> = [['', 'Duration not stated'], ['6', 'About a week'], ['14', 'Two weeks'], ['40', 'About six weeks'], ['120', 'Rest of the season']];

// ── why it was flagged ───────────────────────────────────────────────────────

/** Where he stands against the role's line: the deep floor, the floor and the typical level, and his estimate on the same scale. */
function Gauge({ x }: { x: Explanation }) {
  const s = x.why.standard;
  if (!s || x.why.estimate === null) return null;
  const pos = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  return (
    <div className="mlb-gauge" role="img" aria-label={`His working estimate ${Math.round(x.why.estimate)} against a floor of ${Math.round(s.floor)} and a typical ${Math.round(s.typical)}`}>
      <div className="mlb-gauge-bar">
        <span className="mlb-gauge-zone" style={{ left: 0, width: pos(s.deepFloor) }} />
        <span className="mlb-gauge-zone soft" style={{ left: pos(s.deepFloor), width: `${Math.max(0, s.floor - s.deepFloor)}%` }} />
        <span className="mlb-gauge-mark typical" style={{ left: pos(s.typical) }}><i>typical {Math.round(s.typical)}</i></span>
        <span className="mlb-gauge-mark him" style={{ left: pos(x.why.estimate) }}><i>him {Math.round(x.why.estimate)}</i></span>
      </div>
      <div className="mlb-gauge-key muted">{s.label}: unusually weak under {Math.round(s.floor)}, well under below {Math.round(s.deepFloor)}.</div>
    </div>
  );
}

function WhyFlagged({ need }: { need: Need }) {
  const x = need.explanation;
  if (!x) {
    return (
      <section className="mlb-panel">
        <h3>Why Pennant says this</h3>
        <p>{need.summary}</p>
        {need.causes.map((c) => (
          <div key={c.playerId}><PlayerLink id={c.playerId}>{c.name}</PlayerLink>: {c.assumed ? 'assumed unavailable (your scenario)' : `${c.status}${c.daysLeft ? `, ${c.daysLeft} days left` : ''}`}</div>
        ))}
        {need.facts.map((f) => <div key={f.label}>{f.label}: {f.value}</div>)}
        <div className="muted">{need.horizon.basis}</div>
        {need.unknowns.map((u) => <div key={u} className="muted">⚑ {u}</div>)}
      </section>
    );
  }
  const raised = need.severity !== x.neutralSeverity;
  return (
    <section className="mlb-panel">
      <h3>Why it was flagged</h3>
      <p>{x.why.text}</p>
      <Gauge x={x} />
      <table className="mlb-parts">
        <tbody>
          {x.parts.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td className="num">{p.value === null ? <span className="muted">—</span> : ord(p.value)}</td>
              <td className="num">{p.weight !== null && p.weight > 0 ? `${Math.round(p.weight * 100)}%` : <span className="muted">—</span>}</td>
              <td className="muted">{p.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>What your club's context did</h4>
      {x.context.changed.length === 0
        ? <p className="muted">Nothing: a club with no philosophy would have read this the same way{raised ? '' : ', at the same urgency'}.</p>
        : <>
          <ShadingList items={x.context.changed} />
          <p className="muted">A club with no philosophy would have seen this at <b>{x.neutralSeverity === 'elevated' ? 'elevated' : 'watch'}</b> urgency; yours sees it at <b>{need.severity === 'elevated' ? 'elevated' : 'watch'}</b>.</p>
        </>}
      <details>
        <summary className="muted">What the context never changes</summary>
        <ul className="mlb-why">{x.context.notChanged.map((t) => <li key={t}>{t}</li>)}</ul>
      </details>
      {x.unknown.length > 0 && <><h4>Not known</h4><ul className="mlb-why">{x.unknown.map((t) => <li key={t}>{t}</li>)}</ul></>}
      {(x.explanations ?? []).length > 0 && <><h4>What could explain it</h4><ul className="mlb-why">{(x.explanations ?? []).map((t) => <li key={t}>{t}</li>)}</ul></>}
      <h4>What would change this</h4>
      <ul className="mlb-why">{x.wouldChange.map((t) => <li key={t}>{t}</li>)}</ul>
    </section>
  );
}

// ── the evidence ─────────────────────────────────────────────────────────────

function LensBars({ tools, results, estimate, weight }: { tools: number | null; results: number | null; estimate: number | null; weight: number }) {
  const bar = (label: string, v: number | null, cls = '') => (
    <div className={`mlb-bar ${cls}`} title={label}>
      <div className="mlb-bar-fill" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} />
      <span>{label}: {v === null ? 'no evidence' : ord(v)}</span>
    </div>
  );
  return (
    <div className="mlb-lenses">
      {bar('Estimate', estimate, 'estimate')}
      {bar('Tools', tools)}
      {bar('Results', results)}
      {estimate !== null && tools !== null && results !== null && <div className="muted mlb-option-line">Estimate is {Math.round(weight * 100)}% results, {Math.round((1 - weight) * 100)}% tools.</div>}
    </div>
  );
}

const perfText = (p: RoleRow['performance']): string => (p ? `${p.lines.map((l) => `${l.label} ${l.value}`).join(' · ')} (${p.sample} ${p.sampleUnit})` : '—');

function Evidence({ pic }: { pic: NonNullable<Report['rolePicture']> }) {
  return (
    <section className="mlb-panel">
      <h3>The evidence: the {pic.role} picture</h3>
      {pic.standard && <p className="muted">{pic.standard.healthy} healthy on the active roster against a floor of {pic.standard.count}.</p>}
      <div className="mlb-cards mlb-picture">
        {pic.rows.map((r) => (
          <div key={`${r.relation}:${r.playerId}`} className={`mlb-person ${r.relation}${r.underReview ? ' review' : ''}`}>
            <div className="mlb-person-head">
              <PlayerLink id={r.playerId}>{r.name}</PlayerLink> <span className="muted">{r.age ?? '?'}</span>
              <span className="muted"> · {r.relation === 'subject' ? r.status : r.underReview ? 'Under review' : 'Current'}</span>
            </div>
            <LensBars tools={r.composite} results={r.resultsPct} estimate={r.estimate} weight={r.weightOnResults} />
            {r.weakestCore !== null && <div className="muted mlb-option-line">Weakest core tool: {ord(r.weakestCore)} percentile{r.evidenceStatus !== 'complete' ? ` · ratings ${r.evidenceStatus}` : ''}</div>}
            <div className="mlb-option-line">This season: {perfText(r.performance)}</div>
            {r.usage.map((u) => <div key={u} className="muted mlb-option-line">{u}</div>)}
            {r.comparison && (
              <div className="mlb-option-line">
                <Chip cls={COMPARE_CLASS[r.comparison.verdict]}>{COMPARE_TEXT[r.comparison.verdict]}</Chip>
                {r.comparison.delta !== null && <span className="muted"> {r.comparison.delta >= 0 ? '+' : ''}{Math.round(r.comparison.delta)} over him · read {r.comparison.certainty}</span>}
                {r.group && <div className="muted">{r.group.replace(/_/g, ' ')}</div>}
              </div>
            )}
            {r.complement && (
              <div className="mlb-option-line">
                Against {r.complement.weakSide === 'L' ? 'left' : 'right'}-handers: {r.complement.expected === null ? 'no read' : `${r.complement.expected.toFixed(3).replace(/^0/, '')} expected wOBA`}
                {r.complement.advantage !== null && <> <Chip cls={r.complement.fits ? 'eligible' : ''}>{r.complement.fits ? 'complements him' : 'not enough'}</Chip><span className="muted"> {r.complement.advantage >= 0 ? '+' : ''}{Math.round(r.complement.advantage * 1000)} points</span></>}
              </div>
            )}
            {r.standing && <div className="mlb-option-line"><Chip cls={VERDICT_CLASS[r.standing.verdict]}>{VERDICT_TEXT[r.standing.verdict]}</Chip>{r.standing.rank !== null && <span className="muted"> ranks {r.standing.rank} of {r.standing.assessed + 1}</span>}</div>}
          </div>
        ))}
      </div>
      <details><summary className="muted">What this comparison is</summary><p className="muted">{pic.basis}</p></details>
    </section>
  );
}

// ── the recommendation, the plans ────────────────────────────────────────────

function RecommendationView({ r }: { r: Recommendation }) {
  return (
    <section className={`mlb-recommendation ${r.stance}`}>
      <h3>The staff recommendation <Chip cls={STANCE_CLASS[r.stance]}>{STANCE_TEXT[r.stance]}</Chip> <span className="muted">confidence {r.confidence}</span></h3>
      <p><b>{r.headline}</b></p>
      <ul className="mlb-why">{r.because.map((b) => <li key={b}>{b}</li>)}</ul>
      {r.toSettle.length > 0 && <div><b>To settle first:</b><ul className="mlb-why">{r.toSettle.map((b) => <li key={b}>{b}</li>)}</ul></div>}
      {r.shading && r.shading.length > 0 && (
        <div><b>How your philosophy and the season leaned on this:</b><ShadingList items={r.shading} />
          {r.neutralStance && <p className="muted">A club with no stated philosophy would have been told: <b>{STANCE_TEXT[r.neutralStance]}</b>.</p>}
        </div>
      )}
      <details><summary className="muted">What would change this, and how the staff decides</summary>
        <ul className="mlb-why">{r.wouldChange.map((b) => <li key={b}>{b}</li>)}</ul>
        <p className="muted">{r.basis}</p>
      </details>
    </section>
  );
}

function PlanCard({ p }: { p: Plan }) {
  return (
    <div className="mlb-pathway">
      <div className="mlb-pathway-head">
        <b>{p.title}</b>
        <Chip cls={PATH_CLASS[p.certainty]} title={p.certaintyNote}>{PATH[p.certainty]}</Chip>
      </div>
      <div className="muted">{p.summary}</div>
      <ol className="mlb-steps">
        {p.steps.map((st) => (
          <li key={st.seq}>
            {st.status !== 'not_a_transaction' && <Chip cls={PLAN_STATUS_CLASS[st.status]}>{st.status === 'eligible' ? 'allowed' : st.status === 'indeterminate' ? 'not established' : 'not allowed'}</Chip>} {st.text}
            {st.note && <div className="muted mlb-option-line">{st.note}</div>}
          </li>
        ))}
      </ol>
      {p.followUp && (
        <div className="mlb-option-line">
          <b>What follows:</b> {p.followUp.text}
          {p.followUp.alternatives.length > 0 && <span className="muted"> Or: {p.followUp.alternatives.map((a) => `${a.name}${a.estimate === null ? '' : ` (${ord(a.estimate)})`}`).join(', ')}.</span>}
        </div>
      )}
      <div className="mlb-effects">
        {p.groups.map((g) => (
          <div key={g.label} className="mlb-effect">
            <b>{g.label}</b>
            <div>Healthy {g.healthyBefore} → {g.healthyAfter}{g.floor !== null ? ` (floor ${g.floor})` : ''}</div>
            <div>Mean estimate {g.meanBefore === null ? '—' : ord(g.meanBefore)} → {g.meanAfter === null ? '—' : ord(g.meanAfter)}{g.change !== null && Math.abs(g.change) >= 0.5 ? ` (${g.change >= 0 ? '+' : ''}${g.change.toFixed(1)})` : ''}</div>
            {g.weakestBefore && g.weakestAfter && g.weakestBefore.name !== g.weakestAfter.name && <div className="muted">Weakest: {g.weakestBefore.name} ({ord(g.weakestBefore.estimate)}) → {g.weakestAfter.name} ({ord(g.weakestAfter.estimate)})</div>}
            {g.unknown > 0 && <div className="muted">{g.unknown} without an estimate</div>}
          </div>
        ))}
        <div className="mlb-effect"><b>Rosters</b><div>Active: {p.counts.active}</div><div>40-man: {p.counts.fortyMan}</div></div>
      </div>
      {p.problems.length > 0 && <div className="mlb-option-line">⚑ {p.problems.join(' ')}</div>}
      {p.costs.length > 0 && <details><summary className="muted">Costs and risks</summary><ul className="mlb-option-costs">{p.costs.map((c) => <li key={c}>{c}</li>)}</ul></details>}
      <div className="muted mlb-option-line">{p.certaintyNote}</div>
    </div>
  );
}

function PathwayCard({ p }: { p: Pathway }) {
  return (
    <div className="mlb-pathway">
      <div className="mlb-pathway-head">
        <b>{p.title}</b>
        <Chip cls={PATH_CLASS[p.certainty]} title={p.certaintyNote}>{PATH[p.certainty]}</Chip>
      </div>
      <ul className="mlb-why">{p.why.map((w) => <li key={w}>{w}</li>)}</ul>
      <ol className="mlb-steps">{p.steps.map((st) => <li key={st}>{st}</li>)}</ol>
      {p.moves.length > 0 && (
        <div className="mlb-moves">
          {p.moves.map((m) => (
            <div key={m.playerId} className="mlb-move" title={`${m.rights}. ${m.note}`}>
              <PlayerLink id={m.playerId}>{m.name}</PlayerLink>
              <span className="muted"> {m.role ?? ''} · {m.transaction} · {m.class}</span>
              <div className="muted mlb-option-line">{m.note}</div>
            </div>
          ))}
          {p.moreMoves > 0 && <div className="muted">and {p.moreMoves} more of the same kind, in the full list below.</div>}
        </div>
      )}
      {p.consequences.length > 0 && <div className="mlb-consequences"><b>What follows</b><ul>{p.consequences.map((c) => <li key={c}>{c}</li>)}</ul></div>}
      <div className="muted mlb-option-line">{p.certaintyNote}</div>
    </div>
  );
}

// ── candidates and roster mechanics (drill-down) ─────────────────────────────

function CandidateDetail({ c }: { c: Candidate }) {
  const cons = c.consequences;
  return (
    <div className="mlb-detail">
      <div>
        <h4>Why he is here</h4>
        {c.why.map((w) => <div key={w}>{w}</div>)}
        {c.discovery.evidence.map((w) => <div key={w} className="muted">{w}</div>)}
        <h4>Development{c.development.duration ? ' — judged for each duration' : c.development.contextual ? ` — assessed as: ${c.development.contextual.contextLabel.toLowerCase()}` : c.development.context === 'durable_role' ? ' — assessed as: durable role' : ''}</h4>
        {c.development.status === 'unassessed' || c.development.status === 'not_applicable'
          ? <div>{c.development.message}</div>
          : <>
            {c.development.duration && (
              <div className={c.development.status === 'context_dependent' ? 'mlb-duration' : ''}>
                <div><b>{c.development.duration.explanation}</b></div>
                {c.development.duration.verdicts.map((v) => (
                  <div key={v.context} className="muted">
                    {v.label}: {v.assessed ? (DEV[v.judgment] ?? v.judgment) : 'not assessed'}
                    {[...v.blockers, ...v.missing].map((t) => <div key={t}>— {t}</div>)}
                  </div>
                ))}
                {c.development.duration.resolvedBy && <div className="muted">{c.development.duration.resolvedBy}</div>}
              </div>
            )}
            {c.development.contextual && (
              <div className="muted">
                Stakes: {c.development.contextual.stakesTier?.replace(/_/g, ' ') ?? 'unknown'}
                {c.development.contextual.requiredReadiness !== null && <> · readiness bar {c.development.contextual.requiredReadiness} (durable role: {c.development.contextual.durableReadiness})</>}
                {c.development.contextual.experience && <> · Triple-A/MLB career {Math.round(c.development.contextual.experience.plateAppearances)} PA, {Math.round(c.development.contextual.experience.inningsPitched)} IP</>}
              </div>
            )}
            {(c.development.reasons ?? []).map((r) => <div key={r}>{r}</div>)}
            {(c.development.blockers ?? []).map((r) => <div key={r}>{r}</div>)}
            {(c.development.missing ?? []).map((r) => <div key={r} className="muted">Missing: {r}</div>)}
          </>}
        {c.roleFit && (
          <>
            <h4>Fit at the MLB level (Player Development)</h4>
            <div>
              {c.roleFit.classification ?? 'Not computable'}
              {c.roleFit.evidence.compositePercentile !== null && <> · composite {c.roleFit.evidence.compositePercentile.toFixed(0)}th percentile of MLB peers</>}
            </div>
            <div className="muted">Visible tool ratings: {c.roleFit.evidence.evidenceStatus}{c.roleFit.evidence.unassessed.length ? `; not assessed: ${c.roleFit.evidence.unassessed.join(', ')}` : ''}</div>
          </>
        )}
        {c.performance && (
          <>
            <h4>Season line ({c.performance.sample} {c.performance.sampleUnit}, level {c.performance.level})</h4>
            <div>{c.performance.lines.map((l) => `${l.label} ${l.value}`).join(' · ')}</div>
          </>
        )}
      </div>
      <div>
        <h4>Transaction path</h4>
        {c.path.chain.some((l) => l.kind === 'clear_spot') && <Chain chain={c.path.chain} />}
        {c.path.steps.map((s) => (
          <div key={s.seq} className="mlb-step">
            <Chip cls={s.status === 'not_a_transaction' ? '' : s.status}>{s.seq}. {s.label}</Chip>
            {s.reasons.map((r) => <div key={r.message} className="muted">{r.message} ({BASIS[r.basis] ?? r.basis})</div>)}
            {s.requirements.filter((r) => r.status !== 'met').map((r) => <div key={r.message}>Requires: {r.message}</div>)}
            {s.missing.map((m) => <div key={m.message} className="muted">Missing: {m.message}</div>)}
            {s.limitation && <div className="muted">{s.limitation}</div>}
          </div>
        ))}
        <h4>Roster effect</h4>
        <div>Active roster: {cons.active.before ?? '?'} of {cons.active.limit ?? '?'}{cons.active.change ? ' (+1)' : ' (no change)'}{cons.active.note ? ` — ${cons.active.note}` : ''}</div>
        <div>40-man: {cons.fortyMan.before ?? '?'} of {cons.fortyMan.limit ?? '?'}{cons.fortyMan.change ? ' (+1)' : ' (no change)'}</div>
        {cons.vacatedRole && (
          <div>Leaves {cons.vacatedRole.role} with {cons.vacatedRole.availableAfter} available against a minimum floor of {cons.vacatedRole.floor}{cons.vacatedRole.belowFloor ? ' — below it' : ''}.</div>
        )}
        {c.pathKind !== 'role_change' && <><h4>Minor-league consequence</h4><FarmView farm={cons.farm} /></>}
        <h4>Contract and control</h4>
        {cons.facts.map((f) => <div key={f.label}>{f.label}: {f.value}</div>)}
        <h4>Organizational preference</h4>
        {c.philosophy.status === 'applied'
          ? c.philosophy.reasons.length
            ? c.philosophy.reasons.map((r) => <div key={r.dimension}>{r.message} <span className="muted">({r.dimension})</span></div>)
            : <div className="muted">{c.philosophy.note}</div>
          : <div className="muted">{c.philosophy.note}</div>}
      </div>
    </div>
  );
}

function CandidateRow({ c, mode }: { c: Candidate; mode: Packet['direction'] }) {
  const [open, setOpen] = useState(false);
  const stance = c.philosophy.status === 'applied' ? c.philosophy.stance : null;
  const cols = 7 + (mode === 'replace' || mode === 'complement' ? 1 : 0);
  return (
    <>
      <tr className="mlb-row" onClick={() => setOpen(!open)}>
        <td className="name"><PlayerLink id={c.playerId}>{c.name}</PlayerLink> <span className="muted">{c.age ?? '?'}</span></td>
        <td>{PATH_LABEL[c.pathKind]}</td>
        {mode === 'complement' && <td>{c.complement ? <Chip cls={c.complement.fit.fits ? 'eligible' : ''} title={c.complement.fit.reasons.join('\n')}>{c.complement.fit.fits ? 'complements' : 'not enough'}{c.complement.fit.advantage !== null ? ` (${c.complement.fit.advantage >= 0 ? '+' : ''}${Math.round(c.complement.fit.advantage * 1000)})` : ''}</Chip> : <span className="muted">no read</span>}</td>}
        {mode === 'replace' && <td>{c.comparison ? <Chip cls={COMPARE_CLASS[c.comparison.verdict]} title={c.comparison.reasons.join('\n')}>{COMPARE_TEXT[c.comparison.verdict]}{c.comparison.delta !== null ? ` (${c.comparison.delta >= 0 ? '+' : ''}${Math.round(c.comparison.delta)})` : ''}</Chip> : <span className="muted">—</span>}</td>}
        <td><Chip cls={DEV_CLASS[c.development.status]} title={c.development.message ?? (c.development.reasons ?? []).join('\n')}>{DEV[c.development.status]}</Chip></td>
        <td>
          <Chip cls={PATH_CLASS[c.path.status]}>{PATH[c.path.status]}</Chip>
          {c.requiresClearing.fortyMan && <Chip cls="indeterminate">40-man spot</Chip>}
          {c.requiresClearing.active && <Chip cls="indeterminate">active spot</Chip>}
        </td>
        <td>{c.roleFit?.classification ? <Chip cls="">{c.roleFit.classification}</Chip> : <span className="muted">—</span>}</td>
        <td>{stance ? <Chip cls="">{PREFERENCE[stance]}</Chip> : <span className="muted">—</span>}</td>
        <td className="muted">{open ? '▾' : '▸'}</td>
      </tr>
      {open && <tr><td colSpan={cols}><CandidateDetail c={c} /></td></tr>}
    </>
  );
}

function ClearingTables({ k }: { k: ConstraintClearing }) {
  if (k.state !== 'clearing_needed') return <p className="muted mlb-constraint">{k.note}</p>;
  return (
    <div className="mlb-constraint">
      <h4>{k.constraint === 'active_roster' ? 'Every way to clear an active-roster spot' : 'Every way to clear a 40-man spot'} <span className="muted">— {k.label}: {k.count ?? '?'} of {k.limit ?? '?'}</span></h4>
      <p className="muted">{k.note}</p>
      {k.feasibility === 'unresolved_only' && <div className="muted">⚑ Every way to clear this is one Player Rights cannot yet establish.</div>}
      {k.feasibility === 'none' && <div className="muted">⚑ No player can be moved to clear this.</div>}
      {k.classes.map((c) => (
        <details key={c.class} open={c.class === 'routine' || c.class === 'higher_cost'}>
          <summary><b>{c.label}</b> <span className="muted">({c.options.length}) — {c.description}</span></summary>
          <div className="mlb-cards">
            {c.options.map((o: ClearingOption) => (
              <div key={`${o.constraint}:${o.playerId}`} className="mlb-option">
                <div className="mlb-option-head">
                  <PlayerLink id={o.playerId}>{o.name}</PlayerLink>
                  <span className="muted">{o.role?.label ?? 'role unknown'}</span>
                </div>
                <Chip cls={o.rights.status} title={[...o.rights.reasons.map((r) => `${r.message} (${BASIS[r.basis] ?? r.basis})`), ...o.rights.missing.map((m) => m.message)].join('\n')}>{o.rights.label}</Chip>
                <div className="mlb-option-line">Opens: {[o.rosterEffect.activeSpot === 'opens' ? 'an active spot' : '', o.rosterEffect.fortyManSpot === 'opens' ? 'a 40-man spot' : ''].filter(Boolean).join(' and ') || 'nothing'}.</div>
                {o.roleEffect && <div className="mlb-option-line">{o.roleEffect.role}: {o.roleEffect.availableAfter} available against a floor of {o.roleEffect.floor}{o.roleEffect.belowFloor ? ' — below it' : ''}.</div>}
                <ul className="mlb-option-costs">{o.costs.map((t) => <li key={t}>{t}</li>)}</ul>
                {o.farm && <details><summary className="muted">Minor-league effect</summary><FarmView farm={o.farm} /></details>}
                {o.facts.length > 0 && <div className="muted mlb-option-line">{o.facts.map((f) => `${f.label}: ${f.value}`).join(' · ')}</div>}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

// ── the decision ─────────────────────────────────────────────────────────────

export function Decision({ orgId, needId, need, onBack }: { orgId: number; needId: string; need: Need | undefined; onBack: () => void }) {
  const [packet, setPacket] = useState<Packet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [context, setContext] = useState('');
  const [days, setDays] = useState('');
  const whatIf = needId.startsWith('mlb:what_if:');

  useEffect(() => { setRole(''); setContext(''); setDays(''); }, [needId]);
  useEffect(() => {
    setPacket(null); setError(null);
    const q = `need=${encodeURIComponent(needId)}${role ? `&role=${role}` : ''}${context ? `&context=${context}` : ''}${days ? `&days=${days}` : ''}`;
    apiGet<Packet>(`/api/mlb-operations/${orgId}/responses?${q}`).then(setPacket).catch((e) => setError(e.message));
  }, [orgId, needId, role, context, days]);

  const back = <button className="link mlb-back" onClick={onBack}>← Overview</button>;
  if (error) return <div>{back}<div className="banner error">{error}</div></div>;
  if (!packet) return <div>{back}<p className="muted">Assessing…</p></div>;
  const n = packet.need;
  const r = packet.report;
  const hasCandidates = packet.direction === 'fill' || packet.direction === 'replace' || packet.direction === 'complement';
  const candidateCount = packet.groups.reduce((sum, g) => sum + g.candidates.length, 0);
  const plans = packet.plans ?? [];

  return (
    <div className="mlb-workspace">
      {back}
      <header className="mlb-need-head">
        <div className="mlb-kicker muted">{KIND_LABEL[n.kind]}{n.role ? ` · ${n.role.label}` : ''}</div>
        <h2>{r?.headline ?? n.title}</h2>
        <div><NeedBadge n={n} /> <span className="rights-chip">{n.urgency.label}</span> <span className="rights-chip">{horizonText(n)}</span></div>
        {/* A review's competing explanations are answered in the panel below; the header keeps only the plain statement of what the flag is. */}
        {(n.explanation ? packet.unknowns.slice(0, 1) : packet.unknowns).map((u) => <div key={u} className="muted">⚑ {u}</div>)}
        {whatIf && (
          <label className="muted">How long would he be out?{' '}
            <select className="mlb-whatif mlb-inline" value={days} onChange={(e) => setDays(e.target.value)}>
              {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </header>

      <div className="mlb-decision">
        <div className="mlb-decision-side">
          <WhyFlagged need={n} />
          {r?.rolePicture && <Evidence pic={r.rolePicture} />}
          {r && (
            <section className={`mlb-read ${r.read.verdict ?? ''}`}>
              <h3>The staff read</h3>
              <p>{r.read.text}</p>
              {r.read.caveats.map((c) => <div key={c} className="muted">⚑ {c}</div>)}
            </section>
          )}
        </div>

        <div className="mlb-decision-main">
          {(packet.context ?? null) && <ContextStrip ctx={packet.context as NonNullable<Packet['context']>} />}
          {r?.recommendation && <RecommendationView r={r.recommendation} />}

          {packet.assignment && (
            <div className="mlb-assignment">
              <b>Player Development is judging: {packet.assignment.label.toLowerCase()}.</b>{' '}
              <span className="muted">{packet.assignment.explanation}</span>
              <div className="tabs">
                {packet.assignment.basis !== 'derived_from_horizon' || packet.assignment.context === null
                  ? <button className={packet.assignment.basis === 'duration_unknown' ? 'active' : ''} onClick={() => setContext('')}>Duration unknown: judge both</button>
                  : null}
                {packet.assignment.choices.map((c) => (
                  <button key={c.context} className={packet.assignment?.context === c.context ? 'active' : ''} onClick={() => setContext(c.context)}>{c.label}</button>
                ))}
              </div>
              <div className="muted">A temporary assignment can be defensible where a durable role is not. Pennant does not assume how long a player would be needed: where the answer depends on it, it says so. What is defensible is Player Development's call, not this page's.</div>
            </div>
          )}

          {plans.length > 0 && (
            <section className="mlb-section">
              <h3>{plans.every((p) => p.id === 'platoon' || p.id === 'shift' || p.id === 'lineup_change') ? 'The lineup options, followed through' : 'Ways to respond, followed through'}</h3>
              {r && <p className="muted">{r.orderingNote}</p>}
              {plans.map((p, i) => <PlanCard key={`${p.id}:${i}`} p={p} />)}
            </section>
          )}
          {r && r.pathways.length > 0 && (
            <section className="mlb-section">
              <h3>Pathways</h3>
              <p className="muted">{r.orderingNote}</p>
              {r.pathways.map((p) => <PathwayCard key={p.id} p={p} />)}
            </section>
          )}

          {packet.direction === 'role_needed' && (
            <div>
              <p>Which role should Pennant explore for the open spot?</p>
              <div className="tabs">
                {[['starting_pitcher', 'Starting pitcher'], ['relief_pitcher', 'Relief pitcher'], ['catcher', 'Catcher']].map(([k, l]) => (
                  <button key={k} className={role === k ? 'active' : ''} onClick={() => setRole(k)}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {hasCandidates && (
            <details className="mlb-drill">
              <summary><b>Every candidate, with the evidence behind each verdict</b> <span className="muted">({candidateCount})</span></summary>
              {packet.groups.length === 0 && <p>No internal player was found who could take this role.</p>}
              {packet.groups.map((g) => (
                <details key={g.group} open={['open', 'open_requires_clearing', 'creates_shortfall', 'role_concern', 'context_dependent', 'evaluation_incomplete', 'indeterminate'].includes(g.group)}>
                  <summary><b>{g.label}</b> <span className="muted">({g.candidates.length})</span></summary>
                  <div className="mlb-scroll"><table>
                    <thead><tr><th>Player</th><th>Response</th>{packet.direction === 'replace' && <th>Against him</th>}{packet.direction === 'complement' && <th>Against the weak hand</th>}<th>Development</th><th>Transaction</th><th>MLB fit</th><th>Organization</th><th /></tr></thead>
                    <tbody>{g.candidates.map((c) => <CandidateRow key={`${c.pathKind}:${c.playerId}`} c={c} mode={packet.direction} />)}</tbody>
                  </table></div>
                </details>
              ))}
              {packet.notConsidered.map((x) => <div key={x.reason} className="muted">Not considered ({x.count}): {x.reason}</div>)}
            </details>
          )}

          {hasCandidates && packet.clearing && packet.clearing.constraints.some((k) => k.state === 'clearing_needed') && (
            <details className="mlb-drill">
              <summary><b>Every way to clear a roster spot</b></summary>
              {packet.clearing.constraints.map((k) => <ClearingTables key={k.constraint} k={k} />)}
            </details>
          )}

          {packet.direction === 'clear' && packet.clearing && (
            <section className="mlb-section">
              <h3>The full path for {packet.clearing.returning?.name}, and every option</h3>
              {packet.clearing.activation && (
                <div className="mlb-activation">
                  <Chip cls={packet.clearing.activation.status}>{packet.clearing.activation.label}</Chip>
                  {packet.clearing.activation.requirements.map((q) => <div key={q.message} className={q.status === 'unmet' ? '' : 'muted'}>{q.status === 'unmet' ? 'Requires: ' : ''}{q.message}</div>)}
                  {packet.clearing.activation.missing.map((m) => <div key={m.message} className="muted">⚑ {m.message}</div>)}
                  {packet.clearing.activation.limitation && <div className="muted">{packet.clearing.activation.limitation}</div>}
                </div>
              )}
              <Chain chain={packet.clearing.chain} status={packet.clearing.chainStatus} />
              <p className="muted">{packet.clearing.note}</p>
              {packet.clearing.constraints.map((k) => <ClearingTables key={k.constraint} k={k} />)}
            </section>
          )}

          <p className="muted mlb-footnote">Pennant lists options and their consequences. It does not rank them or make the move: that decision is yours as GM.{n.origin === 'hypothetical' ? ' This is a scenario you posed, not a current problem.' : ''}</p>
        </div>
      </div>
    </div>
  );
}
