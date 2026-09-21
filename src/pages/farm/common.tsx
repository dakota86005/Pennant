import type { ReactNode } from 'react';
import { PlayerLink } from '../../playerModal';
import { Chip, ord } from '../mlb/common';
import type { ConflictTiming, FarmFinding, GoneHolder, PlayingTimeConflict, RosterStatus, Tenure, WorkLevel, WorkShare } from './types';

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

/**
 * Whether a conflict is the present, the past or not yet readable. Shown only when it is NOT simply
 * the present: the ordinary case carries no extra chip.
 */
export const TIMING_TEXT: Partial<Record<ConflictTiming, string>> = {
  emerging: 'Newly emerging',
  historical: 'Earlier this season',
  recently_resolved: 'Recently resolved',
  uncertain: 'Not yet readable',
};

const games = (n: number): string => `${n} ${n === 1 ? 'game' : 'games'}`;

/** "joined 4 games ago", for a man who arrived inside the recent window. */
export const tenureTag = (tenure: Tenure | null): string | null =>
  tenure?.status === 'recent_arrival' ? `joined ${tenure.clubGamesSince === 0 ? 'after the last game' : `${games(tenure.clubGamesSince ?? 0)} ago`}` : null;

const goneText = (g: GoneHolder): string => {
  const where =
    g.why === 'departed' ? `now at ${g.nowAt ?? 'another club'}` : g.why === 'inactive' ? 'off the active list' : g.why === 'rehab' ? 'on a rehab assignment' : 'injured';
  const held = g.seasonShare !== null && g.seasonShare > 0 ? `${Math.round(g.seasonShare * 100)}% of the season's work here` : 'work here this season';
  const last = g.lastStartGamesAgo !== null ? `, last started there ${games(g.lastStartGamesAgo)} ago` : '';
  return `${g.name} (${where}; ${held}${last})`;
};

/** The men with work at a job who are not competing for it now. History, said as history. */
export function Gone({ gone }: { gone: GoneHolder[] }) {
  const worth = gone.filter((g) => g.material || g.windowStarts > 0 || (g.seasonShare ?? 0) >= 0.15);
  if (worth.length === 0) return null;
  return <p className="muted">No longer competing for it: {worth.map(goneText).join('; ')}. Their usage is history, not competition.</p>;
}

const EVIDENCE_TEXT: Record<string, string> = {
  sufficient: '',
  thin: 'too few games to establish his role',
  none: 'no game can be counted for him yet',
};

const LEVEL_FROM_TEXT: Record<WorkShare['levelFrom'], string> = {
  recent: 'from the club\'s recent games',
  season: 'from the season to date',
  current_state: 'from OOTP\'s projected rotation',
};

/**
 * One man's work, read three ways and kept apart: what the season says, what the club's recent games
 * say, and the reading that follows. When the first two disagree both are shown, and neither is
 * silently chosen. A three-row table rather than three more columns on every list.
 */
export function WorkEvidence({ work, timing }: { work: WorkShare; timing: ConflictTiming | null }) {
  const share = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const arrived = tenureTag(work.tenure);
  return (
    <table className="compact mlo-work-evidence">
      <tbody>
        <tr>
          <th scope="row">Season</th>
          <td><Chip cls={WORK_CLASS[work.season.level]}>{WORK_TEXT[work.season.level]}</Chip> {share(work.season.share)}</td>
          <td className="muted">{work.season.basis}</td>
        </tr>
        <tr>
          <th scope="row">Recent</th>
          {work.recent ? (
            <>
              <td>
                <Chip cls={WORK_CLASS[work.recent.level]}>{WORK_TEXT[work.recent.level]}</Chip> {share(work.recent.share)}
              </td>
              <td className="muted">
                {work.recent.basis}
                {EVIDENCE_TEXT[work.recent.evidence] ? ` ${work.recent.games} of the last ${work.recent.windowGames} counted: ${EVIDENCE_TEXT[work.recent.evidence]}.` : ''}
                {arrived ? ` He ${arrived}${work.tenure?.from ? `, from ${work.tenure.from}` : ''}.` : ''}
              </td>
            </>
          ) : (
            <td colSpan={2} className="muted">Not available: this export carries no game log, so only the season can be read.</td>
          )}
        </tr>
        <tr>
          <th scope="row">Now</th>
          <td><Chip cls={WORK_CLASS[work.level]}>{WORK_TEXT[work.level]}</Chip></td>
          <td className="muted">
            Read {LEVEL_FROM_TEXT[work.levelFrom]}
            {work.disagrees ? '; the season and the recent games disagree, and both are shown.' : '.'}
            {timing && TIMING_TEXT[timing] ? ` The competition at his job: ${TIMING_TEXT[timing]!.toLowerCase()}.` : ''}
          </td>
        </tr>
      </tbody>
    </table>
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
