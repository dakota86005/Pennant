import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet } from '../api';
import { PlayerLink } from '../playerModal';

type NeedHorizon = { kind: 'temporary'; expectedDays: number } | { kind: 'structural' } | { kind: 'unknown' };
type Need = {
  id: string;
  organizationId: number;
  category: 'active_roster_capacity' | 'role_coverage';
  role: { label: string; provenance: 'observed' | 'unknown' } | null;
  causalPlayer: { playerId: number; name: string } | null;
  cause: { kind: 'injury' | 'trade' | 'availability_loss_unknown'; provenance: 'corroborated' | 'unknown' } | null;
  detectedAt: string | null;
  horizon: NeedHorizon;
  evidence: Array<{ kind: string; provenance: string; details: Record<string, unknown> }>;
  unknowns: Array<{ code: string; message: string }>;
  responderSummary: {
    activeMlbCount: number;
    minorLeagueCallUpCount: number;
    hasDefensibleInternalSolution: boolean;
    matchingStatus: 'responders_identified' | 'no_defensible_responder' | 'role_not_established';
  };
};

type NeedReport = {
  organization: { orgId: number; label: string } | null;
  needs: Need[];
  unknowns: Array<{ code: string; message: string }>;
};

type Reason = {
  code: string;
  sentiment: 'supporting' | 'tradeoff' | 'unknown' | 'neutral';
  provenance: 'fact' | 'major_league_philosophy_interpretation' | 'delegated_minor_league_philosophy';
  message: string;
  philosophyDimension?: string;
};

type CascadeMove = {
  playerId: number;
  playerName: string;
  kind: string;
  from: { team: string; level: number };
  to: { teamId: number; team: string; level: number };
  role: string;
  development: { status: 'authorized' | 'not_applicable'; recommendation: string | null; reasons: string[]; destinationFit: unknown | null };
};

type Farm = {
  kind: 'not_applicable' | 'stable_no_move' | 'cascade_plan' | 'cascade_unresolved';
  status: 'complete' | 'partial' | 'truncated' | 'indeterminate';
  cascadeStatus: 'complete' | 'partial' | 'truncated' | 'indeterminate' | null;
  plan: {
    depth: number;
    moves: CascadeMove[];
    unresolvedProblems: Array<{ message: string }>;
    resolvedProblems: Array<{ message: string }>;
  } | null;
  unknowns: Array<{ code: string; message: string }>;
};

type Variant = {
  id: string;
  responder: {
    playerId: number;
    name: string;
    source: 'active_mlb' | 'minor_league_call_up';
    assignment: { level: number | null };
    roleFit: { fit: 'direct' | 'secondary'; evidence: Array<{ message: string }> };
    development: { status: 'approved' | 'not_applicable'; message: string; gate: { recommendation?: string; reasons?: string[]; destinationFit?: unknown } | null } | null;
  };
  roleSuitability: {
    comparisonEvidence: 'sufficient' | 'limited' | 'insufficient';
    positionPlayer: {
      offense: { currentRatings: Array<{ label: string; value: number }>; speed: number | null; performance: HittingLine | null };
      defense: { targetRating: number | null; targetExperience: number | null; visiblePlayablePositions: number; components: Record<string, number> };
    } | null;
    pitcher: {
      role: 'starter' | 'reliever';
      currentRatings: Array<{ label: string; value: number }>;
      stamina: number | null;
      performance: PitchingLine | null;
      workload: { fatiguePoints: number | null; playedToday: boolean | null };
    } | null;
    unknowns: Array<{ code: string; message: string }>;
  };
  transaction: {
    feasibility: 'immediately_usable' | 'feasible' | 'feasible_with_corresponding_decisions' | 'ineligible' | 'indeterminate';
    steps: Array<{ kind: string; status: string; description: string }>;
    correspondingDecisions: Array<{ kind: 'active_roster_space' | 'forty_man_space'; description: string; selectedPlayerId: null }>;
  };
  consequences: { mlbRoleConsequence: { status: string; message: string } };
  farm: Farm;
  completeness: 'fully_actionable' | 'feasible_requires_gm_decision' | 'partial_organizational_solution' | 'indeterminate' | 'search_truncated' | 'ineligible';
  facts: Reason[];
  philosophyInterpretations: Reason[];
  unknowns: Array<{ code: string; message: string }>;
  preference: { tier: PreferenceTier };
};

type HittingLine = { year: number; level: number; pa: number; average: number | null; onBasePercentage: number | null; sluggingPercentage: number | null; ops: number | null; war: number | null };
type PitchingLine = { year: number; level: number; innings: number; era: number | null; strikeoutRate: number | null; walkRate: number | null; games: number; starts: number; war: number | null };
export type PreferenceTier = 'preferred' | 'preferred_conditional' | 'strong_alternative' | 'viable_alternative' | 'conditional_alternative' | 'cannot_responsibly_compare' | 'excluded';
type Comparison = { need: Need; variants: Variant[]; excludedResponders: Array<{ name: string; message: string }>; unknowns: Array<{ code: string; message: string }>; philosophy: { dimensions: Record<string, number> } };

export function horizonLabel(horizon: NeedHorizon): string {
  if (horizon.kind === 'temporary') return `Temporary · about ${horizon.expectedDays} days`;
  if (horizon.kind === 'structural') return 'Structural need';
  return 'Horizon not established';
}

export function causeLabel(need: Need): string {
  if (need.category === 'active_roster_capacity') return 'Active-roster opening';
  if (need.cause?.kind === 'injury') return 'Documented injury';
  if (need.cause?.kind === 'trade') return 'Trade departure';
  return 'Availability change; cause unknown';
}

export function responderSummaryLabel(need: Need): string {
  const summary = need.responderSummary;
  if (summary.matchingStatus === 'role_not_established') return 'Role not established; responder matching unavailable';
  if (!summary.hasDefensibleInternalSolution) return 'No defensible internal responder identified';
  const count = summary.activeMlbCount + summary.minorLeagueCallUpCount;
  return `${count} internal path${count === 1 ? '' : 's'} to review`;
}

export function preferenceLabel(tier: PreferenceTier): string {
  return ({
    preferred: 'Organizationally preferred',
    preferred_conditional: 'Preferred if roster decisions are resolved',
    strong_alternative: 'Strong alternative',
    viable_alternative: 'Viable alternative',
    conditional_alternative: 'Conditional alternative',
    cannot_responsibly_compare: 'Comparison incomplete',
    excluded: 'Not currently eligible',
  })[tier];
}

export function completenessLabel(value: Variant['completeness']): string {
  return ({
    fully_actionable: 'Complete organizational path',
    feasible_requires_gm_decision: 'Viable, with GM roster decision required',
    partial_organizational_solution: 'Partial organizational path',
    indeterminate: 'Important state is indeterminate',
    search_truncated: 'Farm search reached its limit',
    ineligible: 'Not currently eligible',
  })[value];
}

export function farmSummary(farm: Farm): string {
  if (farm.kind === 'not_applicable') return 'Internal MLB reassignment';
  if (farm.kind === 'stable_no_move') return 'Source affiliate remains stable';
  if (farm.kind === 'cascade_plan') return farm.status === 'complete' ? `Farm cascade stabilizes in ${farm.plan?.depth ?? 0} move${farm.plan?.depth === 1 ? '' : 's'}` : 'Farm cascade remains partial';
  return farm.status === 'truncated' ? 'Farm search did not prove resolution' : 'Farm consequence unresolved';
}

/** A path label prevents different cascades for one responder from collapsing into one row. */
export function farmPathLabel(farm: Farm): string | null {
  if (farm.kind !== 'cascade_plan' || !farm.plan?.moves.length) return null;
  return farm.plan.moves.map((move) => `${levelLabel(move.to.level)} ← ${move.playerName}`).join(' · ');
}

/** Presentation-only selection helper; backend ordering remains authoritative. */
export function selectedById<T extends { id: string }>(items: T[], id: string | null): T | null {
  return items.find((item) => item.id === id) ?? items[0] ?? null;
}

function levelLabel(level: number): string {
  return ({ 1: 'MLB', 2: 'AAA', 3: 'AA', 4: 'A+' } as Record<number, string>)[level] ?? `Level ${level}`;
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function decimal(value: number | null): string {
  return value === null ? '—' : value.toFixed(3).replace(/^0/, '');
}

function DetailSection({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return <section className="mlb-ops-section">
    {eyebrow && <div className="mlb-ops-eyebrow">{eyebrow}</div>}
    <h3>{title}</h3>
    {children}
  </section>;
}

function ReasonList({ title, items, tone }: { title: string; items: Reason[]; tone: 'supporting' | 'tradeoff' | 'unknown' | 'philosophy' }) {
  if (!items.length) return null;
  return <div className={`mlb-reason-list ${tone}`}>
    <h4>{title}</h4>
    <ul>{items.map((item) => <li key={`${item.code}:${item.message}`}>{item.message}{tone === 'philosophy' && item.philosophyDimension ? <small>Influenced by {item.philosophyDimension.replace(/([A-Z])/g, ' $1').toLowerCase()}</small> : null}</li>)}</ul>
  </div>;
}

function RoleProfile({ variant }: { variant: Variant }) {
  const profile = variant.roleSuitability;
  if (profile.pitcher) {
    const { pitcher } = profile;
    return <DetailSection title="MLB role profile" eyebrow={`Visible evidence · ${profile.comparisonEvidence}`}>
      <p className="mlb-ops-intro">Direct {pitcher.role} fit. Current scouting ratings and {levelLabel(variant.responder.assignment.level ?? 2)} results are shown separately.</p>
      <RatingStrip items={[...pitcher.currentRatings, ...(pitcher.stamina === null ? [] : [{ label: 'Stamina', value: pitcher.stamina }])]} />
      {pitcher.performance && <div className="mlb-stat-line"><strong>{levelLabel(pitcher.performance.level)} {pitcher.performance.year}</strong><span>{pitcher.performance.era === null ? 'ERA unavailable' : `${pitcher.performance.era.toFixed(2)} ERA`}</span><span>{percent(pitcher.performance.strikeoutRate)} K</span><span>{percent(pitcher.performance.walkRate)} BB</span><span>{pitcher.performance.innings.toFixed(1)} IP</span></div>}
      {profile.unknowns.length > 0 && <p className="muted">Visible role evidence is incomplete: {profile.unknowns[0].message}</p>}
    </DetailSection>;
  }
  const hitter = profile.positionPlayer;
  if (!hitter) return null;
  return <DetailSection title="MLB role profile" eyebrow={`Visible evidence · ${profile.comparisonEvidence}`}>
    <p className="mlb-ops-intro">{variant.responder.roleFit.fit === 'direct' ? 'Direct' : 'Secondary'} fit for the requested role. Ratings are the organization’s visible current scouting evidence.</p>
    <div className="mlb-role-columns">
      <div><h4>Offensive profile</h4><RatingStrip items={hitter.offense.currentRatings} />{hitter.offense.speed !== null && <span className="mlb-small-fact">Speed {hitter.offense.speed}</span>}</div>
      <div><h4>Defense</h4><p className="mlb-small-fact">Target rating {hitter.defense.targetRating ?? 'unavailable'} · Experience {hitter.defense.targetExperience ?? 'unavailable'}</p><p className="mlb-small-fact">{hitter.defense.visiblePlayablePositions} visible playable position{hitter.defense.visiblePlayablePositions === 1 ? '' : 's'}</p></div>
    </div>
    {hitter.offense.performance && <div className="mlb-stat-line"><strong>{levelLabel(hitter.offense.performance.level)} {hitter.offense.performance.year}</strong><span>{decimal(hitter.offense.performance.average)} AVG</span><span>{decimal(hitter.offense.performance.onBasePercentage)} OBP</span><span>{decimal(hitter.offense.performance.sluggingPercentage)} SLG</span><span>{hitter.offense.performance.pa} PA</span></div>}
    {profile.unknowns.length > 0 && <p className="muted">Visible role evidence is incomplete: {profile.unknowns[0].message}</p>}
  </DetailSection>;
}

function RatingStrip({ items }: { items: Array<{ label: string; value: number }> }) {
  if (!items.length) return <p className="muted">Visible current ratings are unavailable.</p>;
  return <div className="mlb-rating-strip">{items.map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}</div>;
}

function Development({ variant }: { variant: Variant }) {
  const development = variant.responder.development;
  if (!development) return <DetailSection title="Player Development"><p className="muted">This is an active MLB reassignment; no promotion gate applies.</p></DetailSection>;
  const gate = development.gate;
  return <DetailSection title="Player Development" eyebrow={development.status === 'approved' ? 'AAA → MLB discussion approved' : 'Not a prospect-development assessment'}>
    <p>{development.message}</p>
    {gate?.recommendation && <p className="mlb-small-fact">Assignment character: {gate.recommendation.replaceAll('_', ' ')}.</p>}
    <details><summary>Development evidence</summary><ul>{gate?.reasons?.length ? gate.reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No separate prospect gate applies to this organizational depth player.</li>}</ul></details>
  </DetailSection>;
}

function TransactionPath({ variant }: { variant: Variant }) {
  return <DetailSection title="Transaction path" eyebrow="Roster mechanics">
    {variant.transaction.steps.map((step) => <div className={`mlb-transaction-step ${step.status}`} key={`${step.kind}:${step.description}`}><span>{step.status === 'blocked' ? 'Blocked' : step.status === 'indeterminate' ? 'Unknown' : 'Required'}</span><p>{step.description}</p></div>)}
    {variant.transaction.correspondingDecisions.length > 0 && <div className="mlb-gm-decisions"><h4>GM decisions still required</h4>{variant.transaction.correspondingDecisions.map((decision) => <p key={decision.kind}><strong>{decision.kind === 'forty_man_space' ? 'Create 40-man space' : 'Create active-roster space'}:</strong> {decision.description}</p>)}</div>}
  </DetailSection>;
}

function FarmCascade({ variant }: { variant: Variant }) {
  const farm = variant.farm;
  return <DetailSection title="Farm consequence" eyebrow="Minor League Operations">
    {farm.kind === 'not_applicable' && <p>No affiliate is changed. This is an internal MLB reassignment.</p>}
    {farm.kind === 'stable_no_move' && <p>The source affiliate remains adequately covered after the recall; no downstream assignment is needed.</p>}
    {farm.kind === 'cascade_plan' && <>
      <div className="mlb-cascade"><div><strong>MLB</strong><span>← {variant.responder.name}</span></div>{farm.plan?.moves.map((move) => <div key={`${move.playerId}:${move.to.teamId}`}><strong>{levelLabel(move.to.level)}</strong><span>← {move.playerName} · {move.from.team}</span></div>)}</div>
      {farm.plan?.moves.some((move) => move.development.status === 'authorized') && <details><summary>Player Development evidence for farm moves</summary>{farm.plan.moves.filter((move) => move.development.status === 'authorized').map((move) => <div className="mlb-development-move" key={move.playerId}><strong>{move.playerName} → {move.to.team}</strong><ul>{move.development.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>)}</details>}
      {farm.plan?.unresolvedProblems.length ? <div className="mlb-farm-warning"><strong>Unresolved farm problem</strong>{farm.plan.unresolvedProblems.map((problem) => <p key={problem.message}>{problem.message}</p>)}</div> : <p className="ok">The displayed farm path stabilizes the scenario.</p>}
    </>}
    {farm.kind === 'cascade_unresolved' && <div className="mlb-farm-warning"><strong>{farm.status === 'truncated' ? 'Farm search uncertainty' : 'Farm response unresolved'}</strong><p>{farm.status === 'truncated' ? 'The bounded search did not prove a downstream resolution.' : 'No complete source-affiliate response is established.'}</p></div>}
    {farm.unknowns.length > 0 && <p className="muted">{farm.unknowns[0].message}</p>}
  </DetailSection>;
}

function VariantDetail({ variant }: { variant: Variant }) {
  const facts = variant.facts;
  const supporting = facts.filter((item) => item.sentiment === 'supporting');
  const tradeoffs = facts.filter((item) => item.sentiment === 'tradeoff');
  const uncertainty = [...facts.filter((item) => item.sentiment === 'unknown'), ...variant.unknowns.map((item) => ({ code: item.code, sentiment: 'unknown' as const, provenance: 'fact' as const, message: item.message }))];
  const relevantPhilosophy = variant.philosophyInterpretations;
  return <>
    <div className="mlb-variant-detail-head">
      <div><div className="mlb-ops-eyebrow">Selected organizational solution</div><h2><PlayerLink id={variant.responder.playerId}>{variant.responder.name}</PlayerLink></h2><p>{variant.responder.source === 'active_mlb' ? 'Active MLB coverage alternative' : 'AAA call-up discussion'} · {variant.responder.roleFit.fit} role fit</p></div>
      <div className={`mlb-completeness ${variant.completeness}`}><strong>{completenessLabel(variant.completeness)}</strong><span>{preferenceLabel(variant.preference.tier)}</span></div>
    </div>
    <div className="mlb-reason-grid">
      <ReasonList title="Why this fits" items={supporting} tone="supporting" />
      <ReasonList title="Tradeoffs" items={tradeoffs} tone="tradeoff" />
      <ReasonList title="Unknowns" items={uncertainty} tone="unknown" />
    </div>
    {relevantPhilosophy.length > 0 && <DetailSection title="Organizational interpretation" eyebrow="Current philosophy">
      <p className="mlb-ops-intro">These are preferences among defensible paths, not new baseball facts or instructions to act.</p>
      <ReasonList title="Influenced by current philosophy" items={relevantPhilosophy} tone="philosophy" />
    </DetailSection>}
    <RoleProfile variant={variant} />
    <div className="mlb-detail-pair"><TransactionPath variant={variant} /><FarmCascade variant={variant} /></div>
    <Development variant={variant} />
    {variant.consequences.mlbRoleConsequence.status !== 'not_applicable' && <DetailSection title="Immediate MLB role consequence" eyebrow="Fact"><p>{variant.consequences.mlbRoleConsequence.message}</p></DetailSection>}
  </>;
}

export function MajorLeagueOperations({ orgId, orgLabel }: { orgId: number; orgLabel: string }) {
  const [report, setReport] = useState<NeedReport | null>(null);
  const [selectedNeedId, setSelectedNeedId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [solutionsError, setSolutionsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null); setComparison(null); setSelectedVariantId(null); setError(null); setSolutionsError(null);
    apiGet<NeedReport>(`/api/mlb-operations/${orgId}/needs`).then((next) => {
      if (cancelled) return;
      setReport(next);
      setSelectedNeedId((current) => next.needs.some((need) => need.id === current) ? current : next.needs[0]?.id ?? null);
    }).catch((err: Error) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [orgId]);

  useEffect(() => {
    if (!selectedNeedId) return;
    let cancelled = false;
    setComparison(null); setSelectedVariantId(null); setSolutionsError(null);
    apiGet<Comparison>(`/api/mlb-operations/${orgId}/needs/${encodeURIComponent(selectedNeedId)}/solutions`).then((next) => {
      if (cancelled) return;
      setComparison(next);
      setSelectedVariantId(next.variants[0]?.id ?? null);
    }).catch((err: Error) => !cancelled && setSolutionsError(err.message));
    return () => { cancelled = true; };
  }, [orgId, selectedNeedId]);

  const selectedNeed = useMemo(() => report ? selectedById(report.needs, selectedNeedId) : null, [report, selectedNeedId]);
  const selectedVariant = useMemo(() => comparison ? selectedById(comparison.variants, selectedVariantId) : null, [comparison, selectedVariantId]);

  if (error) return <section className="mlb-operations-page"><div className="page-title">Front Office / Major League Operations</div><div className="banner error">Unable to load Major League Operations: {error}</div></section>;
  if (!report) return <section className="mlb-operations-page"><div className="page-title">Front Office / Major League Operations</div><p className="muted">Reviewing current MLB roster operations…</p></section>;

  return <section className="mlb-operations-page">
    <div className="page-title">Front Office / Major League Operations</div>
    <header className="mlb-ops-hero"><div><div className="mlb-ops-eyebrow">{orgLabel}</div><h1>Major League Operations</h1><p>Reactive roster issues and complete internal decision packets. Your staff compares the paths; you make the decision.</p></div><span>Read only · current import</span></header>
    {report.needs.length === 0 ? <div className="mlb-empty-state"><h2>No current MLB roster needs require review.</h2><p>This workspace surfaces reactive operational issues, not general upgrade opportunities.</p>{report.unknowns.length > 0 && <p className="muted">Some roster context remains unavailable in this export.</p>}</div> : <div className="mlb-operations-inbox">
      <aside className="mlb-need-queue" aria-label="Current MLB needs"><div className="mlb-need-queue-head"><strong>Current MLB needs</strong><span>{report.needs.length} open</span></div><div className="mlb-need-items">{report.needs.map((need) => <button type="button" key={need.id} onClick={() => setSelectedNeedId(need.id)} className={need.id === selectedNeedId ? 'active' : ''} aria-pressed={need.id === selectedNeedId}><strong>{need.role?.label ?? 'Active roster opening'}</strong><span>{need.causalPlayer?.name ?? causeLabel(need)}</span><small>{horizonLabel(need.horizon)}</small><em>{responderSummaryLabel(need)}</em></button>)}</div></aside>
      <section className="mlb-need-detail">
        {selectedNeed && <><header className="mlb-need-head"><div><div className="mlb-ops-eyebrow">Selected roster need</div><h2>{selectedNeed.role?.label ?? 'Active roster opening'}</h2><p><strong>Fact:</strong> {selectedNeed.causalPlayer ? `${selectedNeed.causalPlayer.name} · ${causeLabel(selectedNeed)}` : causeLabel(selectedNeed)}.</p><p><strong>Interpretation:</strong> {selectedNeed.role ? `${selectedNeed.role.label} coverage is currently unresolved.` : 'The active MLB roster has an unfilled opening.'}</p></div><div className="mlb-need-horizon"><strong>{horizonLabel(selectedNeed.horizon)}</strong><span>{selectedNeed.cause?.provenance === 'corroborated' ? 'Cause corroborated' : 'Cause remains uncertain'}</span></div></header>
          {selectedNeed.unknowns.length > 0 && <p className="mlb-inline-unknown">Need context is incomplete: {selectedNeed.unknowns[0].message}</p>}
          {selectedNeed.evidence.length > 0 && <details className="mlb-need-evidence"><summary>Need evidence</summary><ul>{selectedNeed.evidence.map((item, index) => <li key={`${item.kind}:${index}`}>{item.kind.replaceAll('_', ' ')} · {item.provenance} evidence</li>)}</ul></details>}
        </>}
        {solutionsError && <div className="banner error">Unable to load this decision packet: {solutionsError}</div>}
        {!comparison && !solutionsError && <p className="muted">Preparing complete organizational paths…</p>}
        {comparison && comparison.variants.length === 0 && <div className="mlb-empty-state compact"><h2>{selectedNeed?.responderSummary.matchingStatus === 'role_not_established' ? 'Role-specific responder matching is unavailable.' : 'No defensible internal solution was identified.'}</h2><p>{selectedNeed?.responderSummary.matchingStatus === 'role_not_established' ? 'This is an objective roster-capacity opening, but no affected role was established for responsible player matching.' : 'Available players did not meet the current role and Player Development boundaries. No candidate has been invented.'}</p>{comparison.excludedResponders.length > 0 && <details><summary>Why other internal players are unavailable</summary><ul>{comparison.excludedResponders.map((item) => <li key={`${item.name}:${item.message}`}>{item.name}: {item.message}</li>)}</ul></details>}</div>}
        {comparison && comparison.variants.length > 0 && <><div className="mlb-solutions-head"><div><div className="mlb-ops-eyebrow">Organizational solutions</div><h3>Compare complete paths, not just players</h3></div><span>{comparison.variants.length} path{comparison.variants.length === 1 ? '' : 's'} · equal tiers are not ranked</span></div><div className="mlb-variant-list">{comparison.variants.map((variant) => <button type="button" key={variant.id} className={`mlb-variant-row ${variant.id === selectedVariant?.id ? 'active' : ''} ${variant.preference.tier}`} onClick={() => setSelectedVariantId(variant.id)} aria-pressed={variant.id === selectedVariant?.id}><div><strong>{variant.responder.name}</strong><span>{variant.responder.source === 'active_mlb' ? 'Active MLB coverage' : 'AAA call-up discussion'} · {farmSummary(variant.farm)}</span>{farmPathLabel(variant.farm) && <small>Farm path: {farmPathLabel(variant.farm)}</small>}</div><div><em>{preferenceLabel(variant.preference.tier)}</em><small>{completenessLabel(variant.completeness)}</small></div></button>)}</div>{selectedVariant && <article className="mlb-variant-packet"><VariantDetail variant={selectedVariant} /></article>}</>}
      </section>
    </div>}
  </section>;
}
