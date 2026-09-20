import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet } from '../api';
import { PlayerLink } from '../playerModal';

/*
 * Major League Operations: what needs the GM's attention on the active roster,
 * what could address it, what each would require and what follows. Nothing here
 * ranks players or chooses a move; every verdict is the owning specialist's,
 * labelled with who said it. See docs/MLB_OPERATIONS.md.
 */

interface Need {
  id: string;
  kind: 'role_below_standard' | 'open_active_spot' | 'il_return_crunch';
  origin: 'observed' | 'hypothetical';
  role: { kind: string; label: string } | null;
  title: string;
  summary: string;
  severity: 'critical' | 'elevated' | 'watch';
  urgency: { label: string; days: number | null };
  horizon: { kind: string; days: number | null; basis: string };
  causes: Array<{ playerId: number; name: string; role: string | null; status: string; daysLeft: number | null; assumed: boolean }>;
  facts: Array<{ label: string; value: string }>;
  unknowns: string[];
}

interface Overview {
  organization: { orgId: number; label: string } | null;
  freshness: { level: string; headline: string; action: string | null; log: string };
  roster: { active: { count: number | null; limit: number | null }; fortyMan: { count: number | null; limit: number | null }; injuredList: number };
  standards: Array<{ role: string; count: number; label: string }>;
  needs: Need[];
  activePlayers: Array<{ playerId: number; name: string; role: string | null; available: boolean }>;
  unknowns: string[];
}

type Status = 'eligible' | 'ineligible' | 'indeterminate';
interface Step {
  seq: number; action: string; playerName: string; label: string;
  status: Status | 'not_a_transaction' | 'not_evaluated';
  reasons: Array<{ message: string; basis: string }>;
  requirements: Array<{ status: string; message: string }>;
  missing: Array<{ message: string }>; limitation: string | null;
}
interface FarmChange { label: string; before: string; after: string }
interface Farm { affiliate: { label: string; levelName: string }; overall: { before: string; after: string }; changes: FarmChange[]; issuesAfter: string[] }
interface Candidate {
  playerId: number; name: string; age: number | null; level: number | null;
  pathKind: 'role_change' | 'recall' | 'add_to_forty_man'; group: string; why: string[];
  discovery: { source: string; evidence: string[] };
  availability: { status: string; label: string | null; daysLeft: number | null };
  development: { status: string; message?: string; reasons?: string[]; blockers?: string[]; missing?: string[] };
  path: { status: string; steps: Step[]; requirementsUnmet: string[]; unknowns: string[] };
  roleFit: { classification: string | null; evidence: { compositePercentile: number | null; weakestCorePercentile: number | null; unassessed: string[]; evidenceStatus: string; notes: string[] } } | null;
  performance: { year: number; level: number; sample: number; sampleUnit: string; lines: Array<{ label: string; value: string }> } | null;
  consequences: {
    active: { before: number | null; change: number; limit: number | null; note: string | null };
    fortyMan: { before: number | null; change: number; limit: number | null };
    vacatedRole: { role: string; availableAfter: number; standard: number; belowStandard: boolean } | null;
    farm: Farm | null;
    facts: Array<{ label: string; value: string }>;
  };
  philosophy: { status: string; stance: string | null; reasons: Array<{ dimension: string; direction: string; message: string }>; note: string | null };
}
interface ClearingOption {
  playerId: number; name: string; role: { label: string } | null;
  option: { status: Status; label: string; reasons: Array<{ message: string; basis: string }>; missing: Array<{ message: string }> };
  designate: { status: Status; label: string };
  optionYears: { used: number | null; remaining: number | null };
  roleEffect: { role: string; availableAfter: number; standard: number; belowStandard: boolean } | null;
  farm: Farm | null; assignment: string | null; group: string;
}
interface Packet {
  need: Need;
  direction: 'fill' | 'clear' | 'role_needed';
  groups: Array<{ group: string; label: string; candidates: Candidate[] }>;
  clearing: {
    returning: { name: string; daysLeft: number | null };
    activation: { status: Status; label: string; reasons: Array<{ message: string }>; missing: Array<{ message: string }> } | null;
    options: ClearingOption[]; note: string;
  } | null;
  notConsidered: Array<{ reason: string; count: number }>;
  unknowns: string[];
}

const PATH_LABEL: Record<Candidate['pathKind'], string> = {
  role_change: 'Change role', recall: 'Recall (40-man)', add_to_forty_man: 'Add to 40-man',
};
const STANCE: Record<string, string> = { preferred: 'Org prefers', acceptable: 'Acceptable', disfavored: 'Org disfavors', no_preference: 'No preference' };
const DEV: Record<string, string> = {
  defensible: 'Defensible', indefensible: 'Not defensible', indeterminate: 'Cannot judge', unassessed: 'Not assessed', not_applicable: 'n/a',
};
const DEV_CLASS: Record<string, string> = {
  defensible: 'eligible', indefensible: 'ineligible', indeterminate: 'indeterminate', unassessed: 'indeterminate', not_applicable: '',
};
const PATH: Record<string, string> = {
  open: 'Open', open_with_requirements: 'Open, needs room', indeterminate: 'Not established', blocked: 'Blocked',
};
const PATH_CLASS: Record<string, string> = {
  open: 'eligible', open_with_requirements: 'eligible', indeterminate: 'indeterminate', blocked: 'ineligible',
};
const BASIS: Record<string, string> = {
  export_state: 'stated by the export', observed: 'observed in OOTP', documented: 'OOTP documentation', observed_and_documented: 'observed and documented',
};

const Chip = ({ cls, title, children }: { cls: string; title?: string; children: ReactNode }) => (
  <span className={`rights-chip ${cls}`} title={title}>{children}</span>
);

function needBadge(n: Need) {
  const cls = n.severity === 'critical' ? 'demote' : n.severity === 'elevated' ? 'watch' : '';
  return <span className={`badge ${cls}`}>{n.origin === 'hypothetical' ? 'What-if' : n.severity}</span>;
}

function horizonText(n: Need): string {
  const h = n.horizon;
  if (h.kind === 'unknown') return 'Duration not established';
  const word = h.kind === 'temporary' ? 'Short-term' : h.kind === 'extended' ? 'Extended' : 'Long-term';
  return `${word} · about ${h.days} day${h.days === 1 ? '' : 's'}`;
}

function FarmView({ farm }: { farm: Farm | null }) {
  if (!farm) return <span className="muted">Unknown</span>;
  const moved = farm.changes.filter((c) => c.before !== c.after);
  return (
    <div>
      <div>{farm.affiliate.label} ({farm.affiliate.levelName}): {farm.overall.before === farm.overall.after ? `stays ${farm.overall.after}` : `${farm.overall.before} → ${farm.overall.after}`}</div>
      {moved.length === 0
        ? <div className="muted">No change to its structure by Minor League Operations' standards.</div>
        : moved.map((c) => <div key={c.label}>{c.label}: {c.before} → <b>{c.after}</b></div>)}
      {farm.issuesAfter.map((i) => <div key={i} className="muted">{i}</div>)}
    </div>
  );
}

function CandidateDetail({ c }: { c: Candidate }) {
  const cons = c.consequences;
  return (
    <div className="mlb-detail">
      <div>
        <h4>Why he is here</h4>
        {c.why.map((w) => <div key={w}>{w}</div>)}
        {c.discovery.evidence.map((w) => <div key={w} className="muted">{w}</div>)}
        <h4>Development</h4>
        {c.development.status === 'unassessed' || c.development.status === 'not_applicable'
          ? <div>{c.development.message}</div>
          : <>
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
        {c.path.steps.map((s) => (
          <div key={s.seq} className="mlb-step">
            <Chip cls={s.status === 'not_evaluated' ? 'indeterminate' : s.status === 'not_a_transaction' ? '' : s.status}>{s.seq}. {s.label}</Chip>
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
          <div>Leaves {cons.vacatedRole.role} with {cons.vacatedRole.availableAfter} available against a standard of {cons.vacatedRole.standard}{cons.vacatedRole.belowStandard ? ' — below it' : ''}.</div>
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

function CandidateRow({ c }: { c: Candidate }) {
  const [open, setOpen] = useState(false);
  const stance = c.philosophy.status === 'applied' ? c.philosophy.stance : null;
  return (
    <>
      <tr className="mlb-row" onClick={() => setOpen(!open)}>
        <td className="name"><PlayerLink id={c.playerId}>{c.name}</PlayerLink> <span className="muted">{c.age ?? '?'}</span></td>
        <td>{PATH_LABEL[c.pathKind]}</td>
        <td><Chip cls={DEV_CLASS[c.development.status]} title={c.development.message ?? (c.development.reasons ?? []).join('\n')}>{DEV[c.development.status]}</Chip></td>
        <td><Chip cls={PATH_CLASS[c.path.status]}>{PATH[c.path.status]}</Chip></td>
        <td>{c.roleFit?.classification ? <Chip cls="">{c.roleFit.classification}</Chip> : <span className="muted">—</span>}</td>
        <td>{stance ? <Chip cls="">{STANCE[stance]}</Chip> : <span className="muted">—</span>}</td>
        <td className="muted">{open ? '▾' : '▸'}</td>
      </tr>
      {open && <tr><td colSpan={7}><CandidateDetail c={c} /></td></tr>}
    </>
  );
}

function Workspace({ orgId, needId, need }: { orgId: number; needId: string; need: Need | undefined }) {
  const [packet, setPacket] = useState<Packet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('');

  useEffect(() => {
    setPacket(null); setError(null);
    const q = `need=${encodeURIComponent(needId)}${role ? `&role=${role}` : ''}`;
    apiGet<Packet>(`/api/mlb-operations/${orgId}/responses?${q}`).then(setPacket).catch((e) => setError(e.message));
  }, [orgId, needId, role]);

  useEffect(() => setRole(''), [needId]);

  if (error) return <div className="banner error">{error}</div>;
  if (!packet) return <p className="muted">Assessing…</p>;
  const n = packet.need;

  return (
    <div className="mlb-workspace">
      <div className="mlb-need-head">
        <h2>{n.title}</h2>
        <div>{needBadge(n)} <span className="rights-chip">{n.urgency.label}</span> <span className="rights-chip">{horizonText(n)}</span></div>
        <p>{n.summary}</p>
        <details>
          <summary>Why Pennant says this</summary>
          {n.causes.map((c) => (
            <div key={c.playerId}><PlayerLink id={c.playerId}>{c.name}</PlayerLink>: {c.assumed ? 'assumed unavailable (your scenario)' : `${c.status}${c.daysLeft ? `, ${c.daysLeft} days left` : ''}`}</div>
          ))}
          {n.facts.map((f) => <div key={f.label}>{f.label}: {f.value}</div>)}
          <div className="muted">{n.horizon.basis}</div>
        </details>
        {packet.unknowns.map((u) => <div key={u} className="muted">⚑ {u}</div>)}
      </div>

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

      {packet.direction === 'fill' && (
        <>
          {packet.groups.length === 0 && <p>No internal player was found who could take this role.</p>}
          {packet.groups.map((g) => (
            <details key={g.group} open={['open', 'open_development_unassessed', 'creates_shortfall', 'role_concern', 'indeterminate'].includes(g.group)}>
              <summary><b>{g.label}</b> <span className="muted">({g.candidates.length})</span></summary>
              <table>
                <thead><tr><th>Player</th><th>Response</th><th>Development</th><th>Transaction</th><th>MLB fit</th><th>Organization</th><th /></tr></thead>
                <tbody>{g.candidates.map((c) => <CandidateRow key={`${c.pathKind}:${c.playerId}`} c={c} />)}</tbody>
              </table>
            </details>
          ))}
          {packet.notConsidered.map((x) => <div key={x.reason} className="muted">Not considered ({x.count}): {x.reason}</div>)}
        </>
      )}

      {packet.direction === 'clear' && packet.clearing && (
        <>
          <h3>Who could be moved so {packet.clearing.returning.name} can be activated</h3>
          {packet.clearing.activation && (
            <p><Chip cls={packet.clearing.activation.status}>{packet.clearing.activation.label}</Chip>{' '}
              <span className="muted">{packet.clearing.activation.missing.map((m) => m.message).join(' ')}</span></p>
          )}
          <p className="muted">{packet.clearing.note}</p>
          <table>
            <thead><tr><th>Player</th><th>Role</th><th>Option</th><th>DFA</th><th>His role if he goes</th><th>Below</th></tr></thead>
            <tbody>
              {packet.clearing.options.map((o) => (
                <tr key={o.playerId}>
                  <td className="name"><PlayerLink id={o.playerId}>{o.name}</PlayerLink></td>
                  <td>{o.role?.label ?? '—'}</td>
                  <td><Chip cls={o.option.status} title={[...o.option.reasons.map((r) => `${r.message} (${BASIS[r.basis] ?? r.basis})`), ...o.option.missing.map((m) => m.message)].join('\n')}>{o.option.label}</Chip></td>
                  <td><Chip cls={o.designate.status}>{o.designate.label || o.designate.status}</Chip></td>
                  <td>{o.roleEffect ? `${o.roleEffect.availableAfter} of ${o.roleEffect.standard}${o.roleEffect.belowStandard ? ' — below standard' : ''}` : <span className="muted">no standard</span>}</td>
                  <td className="mlb-farm">{o.farm ? <FarmView farm={o.farm} /> : <span className="muted">{o.option.status === 'eligible' ? 'Unknown' : '—'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="muted mlb-footnote">Pennant lists options and their consequences. It does not rank them or make the move: that decision is yours as GM.{need?.origin === 'hypothetical' ? ' This is a scenario you posed, not a current problem.' : ''}</p>
    </div>
  );
}

export function MlbOperations({ orgId }: { orgId: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [whatIf, setWhatIf] = useState('');

  useEffect(() => {
    setData(null); setSelected(null); setWhatIf('');
    apiGet<Overview>(`/api/mlb-operations/${orgId}`).then(setData).catch((e) => setError(e.message));
  }, [orgId]);

  const needs = data?.needs ?? [];
  const activeId = whatIf ? `mlb:what_if:${whatIf}` : selected ?? needs[0]?.id ?? null;
  const active = useMemo(() => needs.find((n) => n.id === activeId), [needs, activeId]);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Reading the roster…</p>;
  const r = data.roster;

  return (
    <div>
      <div className="cards">
        <div className="card"><span className="card-label">Active roster</span><span className="card-value">{r.active.count ?? '?'}/{r.active.limit ?? '?'}</span></div>
        <div className="card"><span className="card-label">40-man</span><span className="card-value">{r.fortyMan.count ?? '?'}/{r.fortyMan.limit ?? '?'}</span></div>
        <div className="card"><span className="card-label">Injured list</span><span className="card-value">{r.injuredList}</span></div>
        <div className="card"><span className="card-label">Roster data</span><span className="card-value">{data.freshness.level}</span></div>
      </div>
      {data.freshness.level !== 'current' && <p className="muted">{data.freshness.headline}. Rights that depend on the transaction log are stated as not established.</p>}
      {data.unknowns.map((u) => <div key={u} className="muted">⚑ {u}</div>)}

      <div className="mlb-layout">
        <aside className="mlb-issues">
          <h3>Roster issues</h3>
          {needs.length === 0 && <p className="muted">Nothing on the active roster needs attention against Pennant's standards ({data.standards.map((s) => s.label).join(', ')}).</p>}
          {needs.map((n) => (
            <button key={n.id} className={`mlb-issue ${activeId === n.id ? 'active' : ''}`} onClick={() => { setWhatIf(''); setSelected(n.id); }}>
              <span>{needBadge(n)} <span className="muted">{n.urgency.label}</span></span>
              <span className="mlb-issue-title">{n.title}</span>
            </button>
          ))}
          <h3>Ask a what-if</h3>
          <select className="mlb-whatif" value={whatIf} onChange={(e) => { setWhatIf(e.target.value); setSelected(null); }}>
            <option value="">If this player is unavailable…</option>
            {data.activePlayers.map((p) => <option key={p.playerId} value={p.playerId}>{p.name}{p.role ? ` — ${p.role}` : ''}</option>)}
          </select>
        </aside>
        <main>
          {activeId
            ? <Workspace orgId={orgId} needId={activeId} need={active} />
            : <p className="muted">Choose an issue, or ask what happens if a player is unavailable.</p>}
        </main>
      </div>
    </div>
  );
}
