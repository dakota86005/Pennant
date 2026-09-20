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
  kind: 'role_below_standard' | 'open_active_spot' | 'il_return_crunch' | 'role_holder_review' | 'platoon_complement' | 'bench_coverage';
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
  shading?: Shade[];
  review?: { strength: 'strong' | 'moderate' | 'watch' | 'none' };
}

interface Shade { dimension: string; value: number | null; effect: string; text: string }
interface Context {
  window: { label: string; value: number | null }; season: { read: string; odds: number | null; headline: string | null };
  urgency: 'high' | 'normal' | 'low'; headline: string; lines: string[]; conflict: string | null; used: string[]; notUsed: string[];
}

interface PlatoonRead {
  verdict: string; weakSide: string | null; weakBy: number | null; reliability: number; reasons: string[]; basis?: string; ratingDeparture?: number | null;
  vsLeft: { pa: number; observed: number | null; expected: number | null }; vsRight: { pa: number; observed: number | null; expected: number | null };
}
interface LineupPlayer { playerId: number; name: string; bats: string | null; amount: number; share: number; pa: number }
interface LineupSpot { position: number; label: string; regular: LineupPlayer | null; backups: LineupPlayer[]; settled: boolean }
interface Lineup { spots: LineupSpot[]; dh: LineupSpot; bench: Array<{ playerId: number; name: string; bats: string | null; pa: number; gs: number }>; games: number; basis: string }
interface BenchRow { playerId: number; name: string; bats: string | null; pa: number; role: string; coverLabels: string[]; batValue: number | null }
interface BenchReview { rows: BenchRow[]; gaps: Array<{ key: string; label: string; text: string }>; hands: { L: number; R: number; S: number }; findings: string[] }
interface Deployment { text: string; gap: number }
interface ReviewHolder {
  position?: number; platoon?: PlatoonRead | null; role?: { label: string } | null; tier?: string | null; stakes?: string | null;
  estimate: { value: number | null; ratingsPct: number | null; resultsPct: number | null; weightOnResults: number; basis: string; batValue?: number | null; defensePct?: number | null; weightOnDefense?: number; runningPct?: number | null; weightOnRunning?: number };
  playerId: number; name: string; age: number | null; rank: number | null; groupSize: number; isWeakest: boolean;
  kind: string; strength: 'strong' | 'moderate' | 'watch' | 'none';
  reasons: string[]; explanations: string[]; wouldChange: string[]; usage: string[];
  evidence: {
    sample: number; sampleUnit: string; reliability: number; toolsBasis?: string; toolsExpected?: number | null;
    defense?: { pct: number | null; grade: number | null; visible: boolean; resultsPct?: number | null; resultsInnings?: number };
    running?: { ability: number | null; toolsPct: number | null; resultsPct: number | null; perSixHundred: number | null };
  };
}
interface ReviewGroup { kind: string; role: string; holders: ReviewHolder[]; notReviewed: number; lineup?: Lineup; deployment?: Deployment[]; bench?: BenchReview }
interface Overview {
  organization: { orgId: number; label: string } | null;
  freshness: { level: string; headline: string; action: string | null; log: string };
  roster: { active: { count: number | null; limit: number | null }; fortyMan: { count: number | null; limit: number | null }; injuredList: number };
  coverage: { basis: string; source: string; floors: Array<{ role: string; count: number; label: string }> };
  needs: Need[];
  context: Context | null;
  review: ReviewGroup[];
  activePlayers: Array<{ playerId: number; name: string; role: string | null; available: boolean }>;
  unknowns: string[];
}

type Status = 'eligible' | 'ineligible' | 'indeterminate';
interface Step {
  seq: number; action: string; playerName: string; label: string;
  status: Status | 'not_a_transaction';
  reasons: Array<{ message: string; basis: string }>;
  requirements: Array<{ status: string; message: string }>;
  missing: Array<{ message: string }>; limitation: string | null;
}
interface FarmChange { label: string; before: string; after: string }
interface Farm { affiliate: { label: string; levelName: string }; overall: { before: string; after: string }; changes: FarmChange[]; issuesAfter: string[]; rosterNotes: string[] }
interface Candidate {
  complement?: { weakSide: string; fit: { fits: boolean; advantage: number | null; reasons: string[] }; candidate: { vsLeft: number | null; vsRight: number | null }; glove: { candidate: number | null; regular: number | null } } | null;
  preference?: { score: number; reasons: Shade[] } | null;
  comparison?: { verdict: string; delta: number | null; toolsDelta: number | null; resultsDelta: number | null; certainty: string; reasons: string[] } | null;
  playerId: number; name: string; age: number | null; level: number | null;
  pathKind: 'role_change' | 'recall' | 'add_to_forty_man'; group: string; why: string[];
  discovery: { source: string; evidence: string[] };
  availability: { status: string; label: string | null; daysLeft: number | null };
  requiresClearing: { active: boolean; fortyMan: boolean };
  development: {
    status: string; message?: string; reasons?: string[]; blockers?: string[]; missing?: string[]; context?: string | null;
    duration?: { matters: boolean; explanation: string; resolvedBy: string | null; verdicts: Array<{ context: string; label: string; judgment: string; assessed: boolean; blockers: string[]; missing: string[] }> } | null;
    contextual?: { contextLabel: string; stakesTier: string | null; requiredReadiness: number | null; durableReadiness: number | null; routes: { production: string; established: string } | null; experience: { plateAppearances: number; inningsPitched: number } | null } | null;
  };
  path: { status: string; steps: Step[]; chain: ChainLink[]; requirementsUnmet: string[]; unknowns: string[] };
  roleFit: { classification: string | null; evidence: { compositePercentile: number | null; weakestCorePercentile: number | null; unassessed: string[]; evidenceStatus: string; notes: string[] } } | null;
  performance: { year: number; level: number; sample: number; sampleUnit: string; lines: Array<{ label: string; value: string }> } | null;
  consequences: {
    active: { before: number | null; change: number; limit: number | null; note: string | null };
    fortyMan: { before: number | null; change: number; limit: number | null };
    vacatedRole: { role: string; availableAfter: number; floor: number; belowFloor: boolean } | null;
    farm: Farm | null;
    facts: Array<{ label: string; value: string }>;
  };
  philosophy: { status: string; stance: string | null; reasons: Array<{ dimension: string; direction: string; message: string }>; note: string | null };
}
interface ChainLink { seq: number; kind: 'clear_spot' | 'transaction'; constraint: string | null; action: string; status: Status | 'not_a_transaction'; label: string; detail: string }
interface ClearingOption {
  playerId: number; name: string; role: { label: string } | null;
  constraint: string; transaction: 'option' | 'designate_for_assignment' | 'place_on_sixty_day_il'; class: string;
  rights: { status: Status; label: string; reasons: Array<{ message: string; basis: string }>; missing: Array<{ message: string }> };
  costs: string[]; rosterEffect: { activeSpot: string; fortyManSpot: string };
  facts: Array<{ label: string; value: string }>;
  roleEffect: { role: string; availableAfter: number; floor: number; belowFloor: boolean } | null;
  farm: Farm | null;
}
interface RoleRow {
  playerId: number; name: string; age: number | null; relation: 'incumbent' | 'subject'; status: string;
  composite: number | null; resultsPct: number | null; estimate: number | null; weightOnResults: number;
  sample: number; sampleUnit: string; reliability: number; usage: string[]; underReview?: boolean;
  comparison?: { verdict: string; delta: number | null; toolsDelta: number | null; resultsDelta: number | null; certainty: string } | null;
  weakestCore: number | null; evidenceStatus: string;
  performance: { sample: number; sampleUnit: string; lines: Array<{ label: string; value: string }> } | null;
  standing: { verdict: string; rank: number | null; assessed: number; gapToWeakest: number | null } | null;
  group: string | null;
  complement?: { weakSide: string; expected: number | null; advantage: number | null; fits: boolean } | null;
}
interface Pathway {
  id: string; title: string; why: string[]; steps: string[];
  moves: Array<{ playerId: number; name: string; role: string | null; transaction: string; class: string; rights: string; note: string }>;
  moreMoves: number; consequences: string[]; certainty: string; certaintyNote: string;
}
interface Recommendation {
  stance: 'act' | 'explore' | 'monitor' | 'hold'; headline: string; because: string[]; toSettle: string[]; wouldChange: string[];
  confidence: 'high' | 'moderate' | 'low'; basis: string; shading?: Shade[]; neutralStance?: 'act' | 'explore' | 'monitor' | 'hold' | null;
}
interface Report {
  recommendation?: Recommendation | null;
  headline: string; situation: string[];
  read: { verdict: string | null; text: string; caveats: string[] };
  rolePicture: { role: string; standard: { label: string; count: number; healthy: number } | null; rows: RoleRow[]; basis: string } | null;
  pathways: Pathway[]; orderingNote: string;
}
interface ConstraintClearing {
  constraint: 'active_roster' | 'forty_man'; label: string; state: 'clearing_needed' | 'spot_open' | 'unknown';
  count: number | null; limit: number | null; feasibility: string | null;
  classes: Array<{ class: string; label: string; description: string; options: ClearingOption[] }>;
  note: string;
}
interface PlanStep { seq: number; text: string; status: string; note: string | null }
interface GroupEffect {
  label: string; healthyBefore: number; healthyAfter: number; floor: number | null; meanBefore: number | null; meanAfter: number | null;
  change: number | null; weakestBefore: { name: string; estimate: number } | null; weakestAfter: { name: string; estimate: number } | null; unknown: number;
}
interface Plan {
  id: string; title: string; summary: string; steps: PlanStep[]; groups: GroupEffect[]; counts: { active: string; fortyMan: string };
  followUp: { text: string; chosen: { name: string; estimate: number | null; class: string } | null; alternatives: Array<{ name: string; estimate: number | null }> } | null;
  costs: string[]; problems: string[]; certainty: string; certaintyNote: string;
}
interface Packet {
  need: Need;
  plans?: Plan[] | null;
  assignment: { context: string | null; evaluated: string[]; label: string; basis: string; explanation: string; choices: Array<{ context: string; label: string }> } | null;
  direction: 'fill' | 'clear' | 'role_needed' | 'replace' | 'complement';
  context?: Context | null;
  report: Report | null;
  groups: Array<{ group: string; label: string; candidates: Candidate[] }>;
  clearing: {
    returning: { name: string; daysLeft: number | null } | null;
    activation: {
      status: Status; label: string; reasons: Array<{ message: string }>; missing: Array<{ message: string }>;
      requirements: Array<{ status: string; message: string }>; limitation: string | null;
    } | null;
    constraints: ConstraintClearing[];
    chain: ChainLink[];
    chainStatus: string | null;
    note: string;
  } | null;
  notConsidered: Array<{ reason: string; count: number }>;
  unknowns: string[];
}

const PATH_LABEL: Record<Candidate['pathKind'], string> = {
  role_change: 'Change role', recall: 'Recall (40-man)', add_to_forty_man: 'Add to 40-man',
};
const STANCE: Record<string, string> = { preferred: 'Org prefers', acceptable: 'Acceptable', disfavored: 'Org disfavors', no_preference: 'No preference' };
const DEV: Record<string, string> = {
  defensible: 'Defensible', indefensible: 'Not defensible', indeterminate: 'Incomplete', unassessed: 'Incomplete', not_applicable: 'n/a',
  context_dependent: 'Depends on duration',
};
const DEV_CLASS: Record<string, string> = {
  defensible: 'eligible', indefensible: 'ineligible', indeterminate: 'indeterminate', unassessed: 'indeterminate', not_applicable: '',
  context_dependent: 'indeterminate',
};
const PATH: Record<string, string> = {
  open: 'Open', open_with_requirements: 'Needs a clearing move', indeterminate: 'Not established', blocked: 'Blocked',
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
  // The badge names the STRENGTH of the case; the colour is the urgency, which the club's window and season may have raised.
  const strength = n.review?.strength === 'strong' ? 'Strong case' : n.review?.strength === 'moderate' ? 'Moderate case' : 'Case';
  const label = n.origin === 'hypothetical' ? 'What-if' : n.kind === 'role_holder_review' ? strength : n.kind === 'platoon_complement' ? 'Platoon' : n.kind === 'bench_coverage' ? 'Coverage' : n.severity;
  const raised = n.shading?.some((x) => x.effect === 'raises') ? ' · raised for your club' : '';
  return <span className={`badge ${cls}`} title={n.shading?.map((x) => x.text).join('\n')}>{label}{raised}</span>;
}

function horizonText(n: Need): string {
  const h = n.horizon;
  if (n.kind === 'role_holder_review') return 'Duration not assumed';
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
      {farm.rosterNotes.map((i) => <div key={i} className="muted">⚑ {i}</div>)}
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

/** The path as an ordered chain: each clearing move a step needs first, then the transaction Player Rights owns. */
function Chain({ chain, status }: { chain: ChainLink[]; status?: string | null }) {
  return (
    <div className="mlb-chain">
      {status && <div className="muted">Whole path: <Chip cls={PATH_CLASS[status]}>{PATH[status]}</Chip> — only as certain as its least certain link.</div>}
      <ol>
        {chain.map((l) => (
          <li key={l.seq}>
            <Chip cls={l.status === 'not_a_transaction' ? '' : l.status}>{l.label}</Chip>
            {l.detail && <span className="muted"> {l.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ClearingTables({ k }: { k: ConstraintClearing }) {
  if (k.state !== 'clearing_needed') return <p className="muted mlb-constraint">{k.note}</p>;
  return (
    <div className="mlb-constraint">
      <h3>{k.constraint === 'active_roster' ? 'Every way to clear an active-roster spot' : 'Every way to clear a 40-man spot'} <span className="muted">— {k.label}: {k.count ?? '?'} of {k.limit ?? '?'}</span></h3>
      <p className="muted">{k.note}</p>
      {k.feasibility === 'unresolved_only' && <div className="muted">⚑ Every way to clear this is one Player Rights cannot yet establish.</div>}
      {k.feasibility === 'none' && <div className="muted">⚑ No player can be moved to clear this.</div>}
      {k.classes.map((c) => (
        <details key={c.class} open={c.class === 'routine' || c.class === 'higher_cost'}>
          <summary><b>{c.label}</b> <span className="muted">({c.options.length}) — {c.description}</span></summary>
          <div className="mlb-cards">
            {c.options.map((o) => (
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

const COMPARE_TEXT: Record<string, string> = {
  clear_upgrade: 'Clear upgrade', upgrade_uncertain: 'Upgrade, not firm', marginal: 'Marginal upgrade', sidegrade: 'Sidegrade',
  downgrade: 'Downgrade', cannot_judge: 'Cannot compare',
};
const COMPARE_CLASS: Record<string, string> = {
  clear_upgrade: 'eligible', upgrade_uncertain: 'indeterminate', marginal: 'indeterminate', sidegrade: '', downgrade: 'ineligible', cannot_judge: 'indeterminate',
};
const FINDING_TEXT: Record<string, string> = {
  ratings_and_results_weak: 'Tools and results agree: weak', weak_estimate: 'Weakest read in the group', tools_weak_results_fine: 'Tools lag results (watch)',
  results_weak_tools_fine: 'Results lag tools (watch)', too_early: 'Too early to read', no_concern: 'No concern', cannot_judge: 'Cannot judge',
};
const STRENGTH_CLASS: Record<string, string> = { strong: 'ineligible', moderate: 'indeterminate', watch: 'indeterminate', none: 'eligible' };
const ord = (n: number | null) => {
  if (n === null) return '—';
  const r = Math.round(n); const v = r % 100;
  return `${r}${v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][r % 10] ?? 'th')}`;
};

const VERDICT_TEXT: Record<string, string> = {
  strengthens: 'Improves the group', comparable: 'Comparable to the back of the group', behind: 'Would not improve the group', cannot_judge: 'Cannot be placed',
};
const VERDICT_CLASS: Record<string, string> = { strengthens: 'eligible', comparable: 'indeterminate', behind: 'ineligible', cannot_judge: 'indeterminate' };

function perfText(p: RoleRow['performance']): string {
  return p ? `${p.lines.map((l) => `${l.label} ${l.value}`).join(' · ')} (${p.sample} ${p.sampleUnit})` : '—';
}

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

const URGENCY_TEXT: Record<string, string> = { high: 'Pressing', normal: 'Steady', low: 'Patient' };

function ContextBanner({ ctx }: { ctx: Context }) {
  return (
    <section className={`mlb-context ${ctx.urgency}`}>
      <div><b>How your club is read:</b> <Chip cls={ctx.urgency === 'high' ? 'ineligible' : ctx.urgency === 'low' ? '' : 'indeterminate'}>{URGENCY_TEXT[ctx.urgency]}</Chip> <span>{ctx.headline}</span></div>
      <ul className="mlb-why">{ctx.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      {ctx.conflict && <div className="mlb-conflict">⚑ {ctx.conflict}</div>}
      <details><summary className="muted">What leans on the advice, and what does not</summary>
        <p className="muted">Your philosophy and the season shade the <b>order and wording</b> of advice: how urgently a flag is raised, which of several equivalent replacements leads, how high the bar for "recommend" is. They never change a scouting read, a right or a development finding, and every lean is listed with the recommendation.</p>
        <p className="muted">Used: {ctx.used.join(', ')}. Not used yet: {ctx.notUsed.join(', ')} (contract and prospect-capital data are not part of the review).</p>
      </details>
    </section>
  );
}

const DIMENSION_LABEL: Record<string, string> = {
  competitiveWindow: 'Window and season', riskTolerance: 'Risk tolerance', ageCurveSensitivity: 'Age-curve sensitivity', upsidePreference: 'Upside preference',
  defenseEmphasis: 'Defense emphasis', rosterDepth: 'Roster depth', pitchingDepth: 'Pitching depth', versatility: 'Versatility', usage: 'How he is used',
};

function ShadingList({ items }: { items: Shade[] }) {
  if (items.length === 0) return null;
  return <ul className="mlb-why mlb-shading">{items.map((x) => <li key={x.text}><span className="muted">{DIMENSION_LABEL[x.dimension] ?? x.dimension}{x.value !== null && x.dimension !== 'competitiveWindow' ? ` (${x.value})` : ''}:</span> {x.text}</li>)}</ul>;
}

function RolePictureView({ pic }: { pic: NonNullable<Report['rolePicture']> }) {
  return (
    <section className="mlb-section">
      <h3>The {pic.role} picture</h3>
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

const PLAN_STATUS_CLASS: Record<string, string> = { eligible: 'eligible', ineligible: 'ineligible', indeterminate: 'indeterminate', not_a_transaction: '' };

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

function LineupTable({ g, onOpen, onOpenId }: { g: ReviewGroup; onOpen: (playerId: number) => void; onOpenId: (id: string) => void }) {
  const lineup = g.lineup;
  const byId = new Map(g.holders.map((h) => [h.playerId, h]));
  const spots = lineup ? [...lineup.spots, lineup.dh] : [];
  return (
    <div className="mlb-review-group">
      <h4>Lineup</h4>
      <div className="mlb-scroll"><table>
        <thead><tr><th>Spot</th><th>Regular</th><th>Estimate</th><th>Bat</th><th>Glove</th><th>Running</th><th>Platoon</th><th>Read</th><th /></tr></thead>
        <tbody>
          {spots.map((sp) => {
            const h = sp.regular ? byId.get(sp.regular.playerId) : undefined;
            if (!sp.regular) return <tr key={sp.position}><td>{sp.label}</td><td colSpan={8} className="muted">Unsettled: {sp.backups.length ? sp.backups.map((b) => b.name).join(', ') : 'nobody has played it'}</td></tr>;
            return (
              <tr key={sp.position}>
                <td>{sp.label}</td>
                <td className="name"><PlayerLink id={sp.regular.playerId}>{sp.regular.name}</PlayerLink> <span className="muted">{sp.regular.bats ?? '?'} · {Math.round(sp.regular.share * 100)}%</span></td>
                <td>{h ? ord(h.estimate.value) : '—'}</td>
                <td title={h?.evidence.toolsExpected != null ? `His visible tools imply ${Math.round(h.evidence.toolsExpected * 1000) >= 0 ? '+' : ''}${Math.round(h.evidence.toolsExpected * 1000)} points of wOBA against the league; results ${h.estimate.resultsPct === null ? 'have no sample' : `${ord(h.estimate.resultsPct)}, trusted ${Math.round(h.evidence.reliability * 100)}%`}.` : undefined}>{h ? ord(h.estimate.batValue ?? h.estimate.value) : '—'}</td>
                <td>{h && h.estimate.defensePct !== null && h.estimate.defensePct !== undefined
                  ? <>{ord(h.estimate.defensePct)}{(h.estimate.weightOnDefense ?? 0) > 0 ? <span className="muted"> ({Math.round((h.estimate.weightOnDefense ?? 0) * 100)}% of value)</span> : null}
                    {h.evidence.defense?.resultsPct != null && <div className="muted mlb-option-line">grade {h.evidence.defense.pct === null ? '—' : ord(h.evidence.defense.pct)} · zone results {ord(h.evidence.defense.resultsPct)} ({Math.round(h.evidence.defense.resultsInnings ?? 0)} inn)</div>}</>
                  : <span className="muted">{sp.position === 10 ? 'n/a' : 'not shown'}</span>}</td>
                <td>{h && h.estimate.runningPct !== null && h.estimate.runningPct !== undefined ? <>{ord(h.estimate.runningPct)}<span className="muted"> ({Math.round((h.estimate.weightOnRunning ?? 0) * 100)}%)</span></> : <span className="muted">—</span>}</td>
                <td>{h?.platoon ? <><Chip cls={h.platoon.verdict === 'problem' ? 'ineligible' : h.platoon.verdict === 'no_issue' ? 'eligible' : 'indeterminate'} title={h.platoon.reasons.join('\n')}>{h.platoon.verdict === 'problem' ? `weak vs ${h.platoon.weakSide === 'L' ? 'LHP' : 'RHP'}` : h.platoon.verdict === 'no_issue' ? 'no issue' : 'not enough'}</Chip>{h.platoon.basis && <div className="muted mlb-option-line">{h.platoon.basis.replace(/_/g, ' ')}</div>}</> : <span className="muted">—</span>}</td>
                <td>{h ? <Chip cls={STRENGTH_CLASS[h.strength]} title={[...h.reasons, ...h.explanations].join('\n')}>{FINDING_TEXT[h.kind]}</Chip> : '—'}</td>
                <td>{h && (h.strength === 'strong' || h.strength === 'moderate') ? <button className="link" onClick={() => onOpen(h.playerId)}>Options</button> : ''}{h?.platoon?.verdict === 'problem' && <button className="link" onClick={() => onOpenId(`mlb:platoon_complement:${h.playerId}`)}>Platoon partner</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {lineup && <p className="muted">{lineup.basis}</p>}
    </div>
  );
}

const TIER_TEXT: Record<string, string> = { closer: 'Closer', high_leverage: 'High leverage', middle: 'Middle', low_leverage: 'Low leverage', long: 'Long man', unknown: 'Not yet clear' };

function BenchPanel({ g, onOpenId }: { g: ReviewGroup; onOpenId: (id: string) => void }) {
  const b = g.bench;
  if (!b) return null;
  return (
    <div className="mlb-review-group">
      <h4>Bench</h4>
      {b.rows.length === 0 ? <p className="muted">There is no bench: every active position player is a regular.</p> : (
        <div className="mlb-scroll"><table>
          <thead><tr><th>Player</th><th>Bats</th><th>For</th><th>Can play</th><th>Bat</th><th>PA</th></tr></thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.playerId}>
                <td className="name"><PlayerLink id={r.playerId}>{r.name}</PlayerLink></td>
                <td>{r.bats ?? '—'}</td><td>{r.role}</td>
                <td>{r.coverLabels.length ? r.coverLabels.join(', ') : <span className="muted">no visible grade</span>}</td>
                <td>{ord(r.batValue)}</td><td>{r.pa}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {b.findings.map((f) => <div key={f} className="muted">⚑ {f}</div>)}
      {b.gaps.map((gap) => <button key={gap.key} className="link" onClick={() => onOpenId(`mlb:bench_coverage:${gap.key}`)}>Who could cover {gap.label}?</button>)}
    </div>
  );
}

function ReviewPanel({ groups, onOpen, onOpenId }: { groups: ReviewGroup[]; onOpen: (playerId: number) => void; onOpenId: (id: string) => void }) {
  if (groups.length === 0) return null;
  return (
    <section className="mlb-review">
      <h3 className="mlb-detail-title first">Scouting review of the roster</h3>
      <p className="muted">Each player is read on two lenses, tools against MLB peers and results (league-relative, several seasons, weighted by sample), blended into a working estimate; a hitter's estimate is his bat plus his glove at the position he plays (visible grade and zone-rating results) and a little for running, each weighted and shown. A flag is a reason to look, not a recommendation to move him.</p>
      {groups.filter((g) => g.kind !== 'position_player').map((g) => (
        <div key={g.kind} className="mlb-review-group">
          <h4>{g.role}s</h4>
          <div className="mlb-scroll"><table>
            <thead><tr><th>Pitcher</th>{g.kind === 'relief_pitcher' && <th>Used as</th>}<th>Estimate</th><th>Tools</th><th>Results</th><th>Read</th><th /></tr></thead>
            <tbody>
              {g.holders.map((h) => (
                <tr key={h.playerId}>
                  <td className="name"><PlayerLink id={h.playerId}>{h.name}</PlayerLink> <span className="muted">{h.age ?? '?'}</span></td>
                  {g.kind === 'relief_pitcher' && <td title={h.usage.join('\n')}>{h.tier ? TIER_TEXT[h.tier] : '—'}{h.stakes ? <span className="muted"> · {h.stakes} stakes</span> : null}</td>}
                  <td>{ord(h.estimate.value)}</td>
                  <td>{ord(h.estimate.ratingsPct)}</td>
                  <td>{h.estimate.resultsPct === null ? <span className="muted">no sample</span> : `${ord(h.estimate.resultsPct)} (${Math.round(h.evidence.reliability * 100)}% trusted)`}</td>
                  <td><Chip cls={STRENGTH_CLASS[h.strength]} title={[...h.reasons, ...h.explanations].join('\n')}>{FINDING_TEXT[h.kind]}</Chip></td>
                  <td>{(h.strength === 'strong' || h.strength === 'moderate') ? <button className="link" onClick={() => onOpen(h.playerId)}>Replacement options</button> : <span className="muted">{h.strength === 'watch' ? 'watch' : ''}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {(g.deployment ?? []).map((d) => <div key={d.text} className="muted">⚑ {d.text}</div>)}
        </div>
      ))}
      {groups.filter((g) => g.kind === 'position_player' && g.role === 'lineup regular').map((g) => <LineupTable key="lineup" g={g} onOpen={onOpen} onOpenId={onOpenId} />)}
      {groups.filter((g) => g.bench).map((g) => <BenchPanel key="bench" g={g} onOpenId={onOpenId} />)}
    </section>
  );
}

const STANCE_TEXT: Record<string, string> = { act: 'Recommend', explore: 'Worth pursuing', monitor: 'Monitor', hold: 'Hold' };
const STANCE_CLASS: Record<string, string> = { act: 'eligible', explore: 'indeterminate', monitor: '', hold: '' };

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

function ReportView({ r, plans, context }: { r: Report; plans?: Plan[] | null; context?: Context | null }) {
  return (
    <div className="mlb-report">
      {context && <ContextBanner ctx={context} />}
      {r.recommendation && <RecommendationView r={r.recommendation} />}
      <section className="mlb-section">
        <h3>Situation</h3>
        <ul className="mlb-why">{r.situation.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>
      <section className={`mlb-read ${r.read.verdict ?? ''}`}>
        <h3>The staff read</h3>
        <p>{r.read.text}</p>
        {r.read.caveats.map((c) => <div key={c} className="muted">⚑ {c}</div>)}
      </section>
      {r.rolePicture && <RolePictureView pic={r.rolePicture} />}
      {plans && plans.length > 0 && (
        <section className="mlb-section">
          <h3>{plans.every((p) => p.id === 'platoon' || p.id === 'shift' || p.id === 'lineup_change') ? 'The lineup options, followed through' : 'Ways to make room, followed through'}</h3>
          <p className="muted">{r.orderingNote}</p>
          {plans.map((p) => <PlanCard key={p.id} p={p} />)}
        </section>
      )}
      {r.pathways.length > 0 && (
        <section className="mlb-section">
          <h3>Pathways</h3>
          <p className="muted">{r.orderingNote}</p>
          {r.pathways.map((p) => <PathwayCard key={p.id} p={p} />)}
        </section>
      )}
    </div>
  );
}

function CandidateRow({ c, mode }: { c: Candidate; mode: Packet['direction'] }) {
  const showComparison = mode === 'replace' || mode === 'complement';
  const [open, setOpen] = useState(false);
  const stance = c.philosophy.status === 'applied' ? c.philosophy.stance : null;
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
        <td>{stance ? <Chip cls="">{STANCE[stance]}</Chip> : <span className="muted">—</span>}</td>
        <td className="muted">{open ? '▾' : '▸'}</td>
      </tr>
      {open && <tr><td colSpan={showComparison ? 8 : 7}><CandidateDetail c={c} /></td></tr>}
    </>
  );
}

const DURATIONS: Array<[string, string]> = [['', 'Duration not stated'], ['6', 'About a week'], ['14', 'Two weeks'], ['40', 'About six weeks'], ['120', 'Rest of the season']];

function Workspace({ orgId, needId, need }: { orgId: number; needId: string; need: Need | undefined }) {
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

  if (error) return <div className="banner error">{error}</div>;
  if (!packet) return <p className="muted">Assessing…</p>;
  const n = packet.need;

  return (
    <div className="mlb-workspace">
      <div className="mlb-need-head">
        <h2>{packet.report?.headline ?? n.title}</h2>
        <div>{needBadge(n)} <span className="rights-chip">{n.urgency.label}</span> <span className="rights-chip">{horizonText(n)}</span></div>
        {!packet.report && <p>{n.summary}</p>}
        <details>
          <summary>Why Pennant says this</summary>
          {n.causes.map((c) => (
            <div key={c.playerId}><PlayerLink id={c.playerId}>{c.name}</PlayerLink>: {c.assumed ? 'assumed unavailable (your scenario)' : `${c.status}${c.daysLeft ? `, ${c.daysLeft} days left` : ''}`}</div>
          ))}
          {n.facts.map((f) => <div key={f.label}>{f.label}: {f.value}</div>)}
          <div className="muted">{n.horizon.basis}</div>
        </details>
        {packet.unknowns.map((u) => <div key={u} className="muted">⚑ {u}</div>)}
        {whatIf && (
          <label className="muted">How long would he be out?{' '}
            <select className="mlb-whatif mlb-inline" value={days} onChange={(e) => setDays(e.target.value)}>
              {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>

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

      {packet.report && <ReportView r={packet.report} plans={packet.plans} context={packet.context} />}

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

      {(packet.direction === 'fill' || packet.direction === 'replace' || packet.direction === 'complement') && (
        <>
          <h3 className="mlb-detail-title">Every candidate, with the evidence behind each verdict</h3>
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
        </>
      )}

      {(packet.direction === 'fill' || packet.direction === 'replace' || packet.direction === 'complement') && packet.clearing && packet.clearing.constraints.map((k) => <ClearingTables key={k.constraint} k={k} />)}

      {packet.direction === 'clear' && packet.clearing && (
        <>
          <h3 className="mlb-detail-title">The full path for {packet.clearing.returning?.name}, and every option</h3>
          {packet.clearing.activation && (
            <div className="mlb-activation">
              <Chip cls={packet.clearing.activation.status}>{packet.clearing.activation.label}</Chip>
              {packet.clearing.activation.requirements.map((r) => <div key={r.message} className={r.status === 'unmet' ? '' : 'muted'}>{r.status === 'unmet' ? 'Requires: ' : ''}{r.message}</div>)}
              {packet.clearing.activation.missing.map((m) => <div key={m.message} className="muted">⚑ {m.message}</div>)}
              {packet.clearing.activation.limitation && <div className="muted">{packet.clearing.activation.limitation}</div>}
            </div>
          )}
          <Chain chain={packet.clearing.chain} status={packet.clearing.chainStatus} />
          <p className="muted">{packet.clearing.note}</p>
          {packet.clearing.constraints.map((k) => <ClearingTables key={k.constraint} k={k} />)}
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

      {data.context && <ContextBanner ctx={data.context} />}
      <ReviewPanel groups={data.review ?? []} onOpen={(pid) => { setWhatIf(''); setSelected(`mlb:role_holder_review:${pid}`); }} onOpenId={(id) => { setWhatIf(''); setSelected(id); }} />

      <div className="mlb-layout">
        <aside className="mlb-issues">
          <h3>Roster issues</h3>
          {needs.length === 0 && <p className="muted">Nothing on the active roster is below Pennant's minimum coverage floors ({data.coverage.floors.map((s) => s.label).join(', ')}), and the scouting review raises no strong case.</p>}
          {needs.map((n) => (
            <button key={n.id} className={`mlb-issue ${activeId === n.id ? 'active' : ''}`} onClick={() => { setWhatIf(''); setSelected(n.id); }}>
              <span>{needBadge(n)} <span className="muted">{n.kind === 'role_holder_review' ? 'Scouting review' : n.kind === 'platoon_complement' ? 'Platoon' : n.kind === 'bench_coverage' ? 'Bench' : n.urgency.label}</span></span>
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
