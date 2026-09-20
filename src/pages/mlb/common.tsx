import type { ReactNode } from 'react';
import { PlayerLink } from '../../playerModal';
import type { ChainLink, Context, Farm, Need, Shade, Status } from './types';

/*
 * What the MLB Operations views share: the vocabulary of chips and labels, and the small pieces that say the same thing the same way
 * wherever it appears (a percentile, a need's badge, a roster path, how the club is read).
 */

export const Chip = ({ cls, title, children }: { cls: string; title?: string; children: ReactNode }) => (
  <span className={`rights-chip ${cls}`} title={title}>{children}</span>
);

export const STANCE_TEXT: Record<string, string> = { act: 'Recommend', explore: 'Worth pursuing', monitor: 'Monitor', hold: 'Hold' };
export const STANCE_CLASS: Record<string, string> = { act: 'eligible', explore: 'indeterminate', monitor: '', hold: '' };
export const PREFERENCE: Record<string, string> = { preferred: 'Org prefers', acceptable: 'Acceptable', disfavored: 'Org disfavors', no_preference: 'No preference' };
export const DEV: Record<string, string> = {
  defensible: 'Defensible', indefensible: 'Not defensible', indeterminate: 'Incomplete', unassessed: 'Incomplete', not_applicable: 'n/a', context_dependent: 'Depends on duration',
};
export const DEV_CLASS: Record<string, string> = {
  defensible: 'eligible', indefensible: 'ineligible', indeterminate: 'indeterminate', unassessed: 'indeterminate', not_applicable: '', context_dependent: 'indeterminate',
};
export const PATH: Record<string, string> = { open: 'Open', open_with_requirements: 'Needs a clearing move', indeterminate: 'Not established', blocked: 'Blocked' };
export const PATH_CLASS: Record<string, string> = { open: 'eligible', open_with_requirements: 'eligible', indeterminate: 'indeterminate', blocked: 'ineligible' };
export const BASIS: Record<string, string> = {
  export_state: 'stated by the export', observed: 'observed in OOTP', documented: 'OOTP documentation', observed_and_documented: 'observed and documented',
};
export const PATH_LABEL: Record<string, string> = { role_change: 'Change role', recall: 'Recall (40-man)', add_to_forty_man: 'Add to 40-man' };

export const COMPARE_TEXT: Record<string, string> = {
  clear_upgrade: 'Clear upgrade', upgrade_uncertain: 'Upgrade, not firm', marginal: 'Marginal upgrade', sidegrade: 'Sidegrade', downgrade: 'Downgrade', cannot_judge: 'Cannot compare',
};
export const COMPARE_CLASS: Record<string, string> = {
  clear_upgrade: 'eligible', upgrade_uncertain: 'indeterminate', marginal: 'indeterminate', sidegrade: '', downgrade: 'ineligible', cannot_judge: 'indeterminate',
};
export const FINDING_TEXT: Record<string, string> = {
  ratings_and_results_weak: 'Tools and results agree: weak', weak_estimate: 'Weak for the role', tools_weak_results_fine: 'Tools lag results (watch)',
  results_weak_tools_fine: 'Results lag tools (watch)', too_early: 'Too early to read', no_concern: 'No concern', cannot_judge: 'Cannot judge',
};
export const STRENGTH_CLASS: Record<string, string> = { strong: 'ineligible', moderate: 'indeterminate', watch: 'indeterminate', none: 'eligible' };
export const STRENGTH_WORD: Record<string, string> = { strong: 'Strong case', moderate: 'Moderate case', watch: 'Watch', none: 'No concern' };
export const TIER_TEXT: Record<string, string> = { closer: 'Closer', high_leverage: 'High leverage', middle: 'Middle', low_leverage: 'Low leverage', long: 'Long man', unknown: 'Not yet clear' };
export const VERDICT_TEXT: Record<string, string> = { strengthens: 'Improves the group', comparable: 'Comparable to the back of the group', behind: 'Would not improve the group', cannot_judge: 'Cannot be placed' };
export const VERDICT_CLASS: Record<string, string> = { strengthens: 'eligible', comparable: 'indeterminate', behind: 'ineligible', cannot_judge: 'indeterminate' };
export const QUALITY_TEXT: Record<string, string> = { regular_quality: 'regular quality', credible: 'credible backup', emergency: 'emergency only', unknown: 'quality not established' };
export const QUALITY_CLASS: Record<string, string> = { regular_quality: 'eligible', credible: 'eligible', emergency: 'ineligible', unknown: 'indeterminate' };
export const DIMENSION_LABEL: Record<string, string> = {
  competitiveWindow: 'Window and season', riskTolerance: 'Risk tolerance', ageCurveSensitivity: 'Age-curve sensitivity', upsidePreference: 'Upside preference',
  defenseEmphasis: 'Defense emphasis', rosterDepth: 'Roster depth', pitchingDepth: 'Pitching depth', versatility: 'Versatility', usage: 'How he is used',
};
export const POSITION_ABBR: Record<number, string> = { 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };

export const ord = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const r = Math.round(n); const v = r % 100;
  return `${r}${v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][r % 10] ?? 'th')}`;
};
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;

/** The strength of the case, and how urgent the club's context makes it. The wording is the case's; the colour is the urgency. */
export function NeedBadge({ n }: { n: Need }) {
  const cls = n.severity === 'critical' ? 'demote' : n.severity === 'elevated' ? 'watch' : '';
  const strength = n.review?.strength === 'strong' ? 'Strong case' : n.review?.strength === 'moderate' ? 'Moderate case' : 'Case';
  const label = n.origin === 'hypothetical' ? 'What-if' : n.kind === 'role_holder_review' ? strength : n.kind === 'platoon_complement' ? 'Platoon' : n.kind === 'bench_coverage' ? 'Coverage' : n.severity;
  const raised = n.shading?.some((x) => x.effect === 'raises') ? ' · raised for your club' : '';
  return <span className={`badge ${cls}`} title={n.shading?.map((x) => x.text).join('\n')}>{label}{raised}</span>;
}

export function horizonText(n: Need): string {
  const h = n.horizon;
  if (n.kind === 'role_holder_review') return 'Duration not assumed';
  if (h.kind === 'unknown') return 'Duration not established';
  const word = h.kind === 'temporary' ? 'Short-term' : h.kind === 'extended' ? 'Extended' : 'Long-term';
  return `${word} · about ${h.days} day${h.days === 1 ? '' : 's'}`;
}

export const KIND_LABEL: Record<Need['kind'], string> = {
  role_below_standard: 'Roster floor', open_active_spot: 'Open spot', il_return_crunch: 'IL return', role_holder_review: 'Scouting review', platoon_complement: 'Platoon', bench_coverage: 'Bench coverage',
};

export function FarmView({ farm }: { farm: Farm | null }) {
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

/** The path as an ordered chain: each clearing move a step needs first, then the transaction Player Rights owns. */
export function Chain({ chain, status }: { chain: ChainLink[]; status?: string | null }) {
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

export function ShadingList({ items }: { items: Shade[] }) {
  if (items.length === 0) return null;
  return <ul className="mlb-why mlb-shading">{items.map((x) => <li key={x.text}><span className="muted">{DIMENSION_LABEL[x.dimension] ?? x.dimension}{x.value !== null && x.dimension !== 'competitiveWindow' ? ` (${x.value})` : ''}:</span> {x.text}</li>)}</ul>;
}

const URGENCY_TEXT: Record<string, string> = { high: 'Pressing', normal: 'Steady', low: 'Patient' };

/** How the club is read: one line, with the detail behind it. `compact` is the strip at the top of a view. */
export function ContextStrip({ ctx }: { ctx: Context }) {
  return (
    <section className={`mlb-context ${ctx.urgency}`}>
      <div><b>How your club is read:</b> <Chip cls={ctx.urgency === 'high' ? 'ineligible' : ctx.urgency === 'low' ? '' : 'indeterminate'}>{URGENCY_TEXT[ctx.urgency]}</Chip> <span>{ctx.headline}</span></div>
      {ctx.conflict && <div className="mlb-conflict">⚑ {ctx.conflict}</div>}
      <details>
        <summary className="muted">What this rests on, and what it leans on</summary>
        <ul className="mlb-why">{ctx.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="muted">Your philosophy and the season shade the <b>order and wording</b> of advice: how urgently a flag is raised, which of several equivalent replacements leads, how high the bar for "recommend" is. They never change a scouting read, a right or a development finding, and every lean is listed with the recommendation.</p>
        <p className="muted">Used: {ctx.used.join(', ')}. Not used yet: {ctx.notUsed.join(', ')} (contract and prospect-capital data are not part of the review).</p>
      </details>
    </section>
  );
}

/** A percentile and the share of the estimate it accounts for. */
export function Part({ label, value, weight, note }: { label: string; value: number | null; weight?: number | null; note?: string }) {
  return (
    <span className="mlb-part" title={note}>
      <span className="muted">{label}</span> {value === null ? <span className="muted">—</span> : <b>{ord(value)}</b>}
      {weight !== undefined && weight !== null && weight > 0 ? <span className="muted"> · {Math.round(weight * 100)}%</span> : null}
    </span>
  );
}

export const PlayerName = ({ id, name, age }: { id: number; name: string; age?: number | null }) => (
  <><PlayerLink id={id}>{name}</PlayerLink>{age !== undefined && age !== null ? <span className="muted"> {age}</span> : null}</>
);

export function statusClass(s: Status | 'not_a_transaction'): string { return s === 'not_a_transaction' ? '' : s; }
