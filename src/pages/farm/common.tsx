import type { ReactNode } from 'react';
import { PlayerLink } from '../../playerModal';
import { Chip, ord } from '../mlb/common';
import type { FarmFinding, PlayingTimeConflict, RosterStatus, WorkLevel } from './types';

/*
 * What the Minor League Operations views share.
 *
 * The chip vocabulary, the validity colours and the uncertainty language come from MLB Operations'
 * own (`src/pages/mlb/common.tsx`) so a GM moving between the two modules reads the same words for
 * the same things: eligible / ineligible / indeterminate colouring, `Chip`, ordinals. What differs is
 * what the farm talks ABOUT, not how it talks (D-046).
 */

export { Chip, ord };

/* ── the two readings of a club ──────────────────────────────────────────────────────────────── */

export const STATUS_TEXT: Record<RosterStatus, string> = {
  critical: 'Short',
  thin: 'Thin',
  healthy: 'Able',
};

export const STATUS_CLASS: Record<RosterStatus, string> = {
  critical: 'ineligible',
  thin: 'indeterminate',
  healthy: 'eligible',
};

export const SEVERITY_CLASS: Record<FarmFinding['severity'], string> = {
  critical: 'ineligible',
  attention: 'indeterminate',
  noted: '',
};

/* ── what Player Development says about where a man is ───────────────────────────────────────── */

export const VERDICT_TEXT: Record<string, string> = {
  appropriate: 'The level is developing him',
  too_advanced: 'The level is ahead of him',
  no_longer_developmental: 'Nothing left to learn here',
  indeterminate: 'Cannot be judged',
  not_assessable: 'Nothing to read yet',
};

export const VERDICT_CLASS: Record<string, string> = {
  appropriate: 'eligible',
  too_advanced: 'ineligible',
  no_longer_developmental: 'indeterminate',
  indeterminate: 'indeterminate',
  not_assessable: '',
};

export const STANDING_TEXT: Record<string, string> = {
  mastered: 'clearly better than the league',
  holding: 'holding his own',
  overmatched: 'clearly worse than the league',
  indeterminate: 'not established',
};

export const WINDOW_TEXT: Record<string, string> = {
  ample: 'young for the level',
  normal: 'ordinary for the level',
  closing: 'old for the level',
  closed: 'past the developmental window',
  indeterminate: 'not established',
};

export const CONCLUSION_TEXT: Record<string, string> = {
  current_assignment_defensible: 'Assignment defensible',
  promotion_direction_defensible: 'Ready for more',
  demotion_direction_defensible: 'Level too advanced',
  opportunity_conflict: 'Not getting the work',
  organizational_blockage: 'Blocked',
  organizational_question: 'Organizational question',
  indeterminate: 'Cannot be judged',
  not_assessable: 'Nothing to read yet',
};

export const CONCLUSION_CLASS: Record<string, string> = {
  current_assignment_defensible: 'eligible',
  promotion_direction_defensible: 'eligible',
  demotion_direction_defensible: 'ineligible',
  opportunity_conflict: 'ineligible',
  organizational_blockage: 'ineligible',
  organizational_question: 'indeterminate',
  indeterminate: 'indeterminate',
  not_assessable: '',
};

export const WORK_TEXT: Record<WorkLevel, string> = {
  regular: 'Regular',
  part_time: 'Sharing',
  occasional: 'Occasional',
  not_used: 'Not playing',
  bat_only: 'Batting, not fielding',
  unknown: 'Not yet readable',
};

export const WORK_CLASS: Record<WorkLevel, string> = {
  regular: 'eligible',
  part_time: '',
  occasional: 'indeterminate',
  not_used: 'ineligible',
  bat_only: 'indeterminate',
  unknown: 'indeterminate',
};

/** Player Development's stakes, in the GM's words rather than the model's. */
export const TIER_TEXT: Record<string, string> = {
  core_prospect: 'Core prospect',
  protected_prospect: 'Protected prospect',
  development_priority: 'Development priority',
  normal: 'Ordinary',
  organizational_depth: 'Organizational depth',
};

export const ATTENTION_TEXT: Record<string, string> = {
  needs_attention: 'Needs attention',
  worth_a_look: 'Worth a look',
  routine: 'Routine',
};

export const jobLabel = (job: PlayingTimeConflict['job']): string =>
  job.kind === 'position' ? job.position : job.kind === 'rotation' ? 'the rotation' : 'the bullpen';

export const OWNER_TEXT: Record<string, string> = {
  minor_league_operations: 'Minor League Operations',
  player_development: 'Player Development',
};

/* ── shared pieces ───────────────────────────────────────────────────────────────────────────── */

/** One finding, with its evidence, what is missing and what would settle it. Nothing is a score. */
export function Finding({ f, open = false }: { f: FarmFinding; open?: boolean }) {
  return (
    <details className="mlo-finding" open={open}>
      <summary>
        <Chip cls={SEVERITY_CLASS[f.severity]}>{f.severity === 'critical' ? 'Short' : f.severity === 'attention' ? 'Attention' : 'Noted'}</Chip>{' '}
        {f.headline}
        <span className="muted"> · {OWNER_TEXT[f.owner] ?? f.owner}</span>
      </summary>
      <div className="mlo-finding-body">
        {f.evidence.length > 0 && (
          <table className="compact">
            <tbody>
              {f.evidence.map((e, i) => (
                <tr key={i}>
                  <th scope="row">{e.label}</th>
                  <td><strong>{e.value}</strong></td>
                  <td className="muted">{e.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {f.players.length > 0 && (
          <ul className="mlo-finding-players">
            {f.players.map((p) => (
              <li key={p.playerId}>
                <PlayerLink id={p.playerId}>{p.name}</PlayerLink> <span className="muted">— {p.note}</span>
              </li>
            ))}
          </ul>
        )}
        {f.missing.length > 0 && (
          <p className="muted"><strong>Not established:</strong> {f.missing.join(' ')}</p>
        )}
        {f.wouldResolve.length > 0 && (
          <p className="muted"><strong>What would settle it:</strong> {f.wouldResolve.join(' ')}</p>
        )}
      </div>
    </details>
  );
}

/** Who is competing for one job, and what each is getting. Represented, never scored. */
export function Conflict({ c }: { c: PlayingTimeConflict }) {
  return (
    <details className="mlo-conflict">
      <summary>
        <Chip cls={c.severity === 'blocking' ? 'ineligible' : c.severity === 'crowded' ? 'indeterminate' : ''}>
          {c.severity === 'blocking' ? 'Costing development' : c.severity === 'crowded' ? 'Crowded' : 'Noted'}
        </Chip>{' '}
        {c.claimants.length} men on {jobLabel(c.job)}, which supports {c.capacity}
      </summary>
      <table className="compact">
        <thead>
          <tr><th>Player</th><th>Age</th><th>Getting</th><th>Stakes</th><th>On what basis</th></tr>
        </thead>
        <tbody>
          {c.claimants.map((s) => (
            <tr key={s.playerId} className={c.squeezed.some((x) => x.playerId === s.playerId) ? 'mlo-squeezed' : ''}>
              <td><PlayerLink id={s.playerId}>{s.name}</PlayerLink></td>
              <td>{s.age}</td>
              <td><Chip cls={WORK_CLASS[s.level]}>{WORK_TEXT[s.level]}</Chip></td>
              <td>{s.tier ? TIER_TEXT[s.tier] ?? s.tier : <span className="muted">indeterminate</span>}</td>
              <td className="muted">{s.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.alsoPlaying.length > 0 && (
        <p className="muted">
          Also getting innings here from another position: {c.alsoPlaying.map((s) => `${s.name} (${WORK_TEXT[s.level].toLowerCase()})`).join(', ')}.
          They count against nobody's claim on the job.
        </p>
      )}
      {c.unknowns.length > 0 && <p className="muted">{c.unknowns.join(' ')}</p>}
    </details>
  );
}

/** A statement of what is not known, in the same words everywhere it appears. */
export function Unknowns({ items, label = 'Not established' }: { items: string[]; label?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mlo-unknowns">
      <strong>{label}:</strong>
      <ul>{items.map((u, i) => <li key={i}>{u}</li>)}</ul>
    </div>
  );
}

export const Section = ({ kicker, title, note, children }: { kicker: string; title: string; note?: ReactNode; children: ReactNode }) => (
  <section>
    <div className="farm-section-head">
      <div>
        <div className="farm-kicker">{kicker}</div>
        <h2>{title}</h2>
      </div>
      {note ? <p>{note}</p> : null}
    </div>
    {children}
  </section>
);
