import { useEffect, useState } from 'react';
import { apiGet } from '../../api';
import { Chip, CONCLUSION_CLASS, CONCLUSION_TEXT, jobLabel, ord, Section, STANDING_TEXT, STATUS_CLASS, STATUS_TEXT, TIER_TEXT, Unknowns, VERDICT_CLASS, VERDICT_TEXT, WINDOW_TEXT, WORK_TEXT } from './common';
import type { AssignmentReview, Cascade, FarmConsequence, FarmSystem, RetentionReview } from './types';
import type { Route } from './route';

/*
 * One player's assignment, in the order a GM decides.
 *
 * The eleven questions this view exists to answer, in this order: why is his assignment being
 * reviewed; what does Player Development say; what alternatives are defensible; what does Philosophy
 * prefer among them; what playing-time consequences follow; what happens to his club; what happens to
 * the destination; does the move cause a cascade; where does the cascade stop; what is uncertain; and
 * what remains the GM's. Nothing on this page is a transaction.
 */

const JUDGMENT_TEXT: Record<string, string> = {
  defensible: 'Defensible',
  indefensible: 'Not defensible',
  indeterminate: 'Cannot be judged',
  not_evaluated: 'Not evaluated',
};

const JUDGMENT_CLASS: Record<string, string> = {
  defensible: 'eligible',
  indefensible: 'ineligible',
  indeterminate: 'indeterminate',
  not_evaluated: 'indeterminate',
};

const PREFERENCE_TEXT: Record<string, string> = {
  preferred: 'Org prefers',
  acceptable: 'Acceptable',
  disfavored: 'Org disfavors',
};

const STOP_TEXT: Record<string, string> = {
  absorbed: 'The club can absorb it',
  no_defensible_move: 'No defensible move exists',
  indeterminate: 'The next step cannot be judged',
  relocates_the_same_shortage: 'It would only move the same shortage',
  reached_lowest_level: 'There is nothing below to draw from',
  step_limit: 'Followed as far as is useful',
};

function CascadeChain({ cascade }: { cascade: Cascade }) {
  return (
    <div className="mlo-cascade">
      {cascade.steps.length === 0 ? (
        <p className="muted">No move follows: {cascade.stopDetail}</p>
      ) : (
        <ol className="mlo-cascade-steps">
          {cascade.steps.map((s) => (
            <li key={s.index}>
              <div className="mlo-cascade-head">
                <Chip cls={s.usable ? 'eligible' : JUDGMENT_CLASS[s.development.judgment] ?? 'indeterminate'}>
                  {JUDGMENT_TEXT[s.development.judgment] ?? s.development.judgment}
                </Chip>
                <strong>
                  {s.vacancy.team} needs {jobLabel(s.vacancy.job)} ({s.vacancy.after} of {s.vacancy.floor})
                </strong>
              </div>
              {s.candidate ? (
                <p>
                  <strong>{s.candidate.name}</strong> ({s.candidate.age}, {s.candidate.fromLevelName} {s.candidate.fromTeam})
                  {s.preference ? <> · <Chip cls="">{PREFERENCE_TEXT[s.preference] ?? s.preference}</Chip></> : null}
                </p>
              ) : (
                <p className="muted">
                  {s.development.judgment === 'not_evaluated' && s.uncertainty.length > 0
                    ? 'Nobody below could be judged for it.'
                    : 'Nobody below is a defensible replacement.'}
                </p>
              )}
              {s.alternatives.length > 0 && (
                <p className="muted">
                  As defensible: {s.alternatives.map((a) => `${a.name} (${a.age}, ${a.fromTeam}${a.preference ? `, ${(PREFERENCE_TEXT[a.preference] ?? a.preference).toLowerCase()}` : ''})`).join('; ')}.
                  The chain follows the first in readiness order; which to use is your decision.
                </p>
              )}
              <ul className="mlo-cascade-consequence">
                <li>{s.consequence.destination}</li>
                <li>{s.consequence.source}</li>
                <li className="muted">{s.consequence.destinationOpportunity}</li>
              </ul>
              {s.development.blockers.length > 0 && <p className="muted">Player Development: {s.development.blockers.join(' ')}</p>}
              {s.uncertainty.length > 0 && <p className="muted">{s.uncertainty.join(' ')}</p>}
              {s.preferenceBasis ? <p className="muted">{s.preferenceBasis}</p> : null}
            </li>
          ))}
        </ol>
      )}
      <p className="mlo-cascade-stop">
        <Chip cls={cascade.unresolved.length === 0 ? 'eligible' : 'indeterminate'}>
          {STOP_TEXT[cascade.stop] ?? cascade.stop}
        </Chip>{' '}
        {cascade.stopDetail}
      </p>
      {cascade.unresolved.length > 0 && (
        <div className="mlo-unresolved">
          <strong>What the chain leaves open:</strong>
          <ul>{cascade.unresolved.map((u, i) => <li key={i}>{u.team} at {u.job} — {u.detail}</li>)}</ul>
          <p className="muted">
            An unresolved hole is information, not an illegality: it does not make a major-league move impossible.
          </p>
        </div>
      )}
      {cascade.certainty === 'indeterminate' && (
        <p className="muted">The chain is only as certain as its least certain step, and one step cannot be judged.</p>
      )}
    </div>
  );
}

export function Decision({
  orgId,
  playerId,
  data,
  go,
}: {
  orgId: number;
  playerId: number;
  data: FarmSystem;
  go: (r: Route) => void;
}) {
  const review: AssignmentReview | undefined = data.assignments.find((a) => a.playerId === playerId);
  const retention: RetentionReview | undefined = data.retention.find((r) => r.playerId === playerId);
  const [consequence, setConsequence] = useState<FarmConsequence | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConsequence(null);
    setError(null);
    apiGet<FarmConsequence>(`/api/farm-operations/${orgId}/consequence/${playerId}`)
      .then(setConsequence)
      .catch((e) => setError(e.message));
  }, [orgId, playerId]);

  if (!review) {
    return (
      <div className="banner">
        This player is not on a minor-league affiliate of the organization.{' '}
        <button className="link" onClick={() => go({ view: 'overview', id: null })}>Back to the overview</button>
      </div>
    );
  }

  return (
    <div className="mlo-decision">
      <div className="mlo-decision-head">
        <button className="link" onClick={() => go({ view: 'overview', id: null })}>← What needs your attention</button>
        <h2>
          {review.name} <span className="muted">({review.age}, {review.kind === 'pitcher' ? 'pitcher' : 'position player'})</span>
        </h2>
        <p className="muted">
          {review.levelName} · {review.team} · {review.leagueName}
          {review.protection.tier ? <> · {TIER_TEXT[review.protection.tier] ?? review.protection.tier}</> : <> · developmental stakes indeterminate</>}
        </p>
        <Chip cls={CONCLUSION_CLASS[review.conclusion] ?? ''}>{CONCLUSION_TEXT[review.conclusion] ?? review.conclusion}</Chip>
      </div>

      <Section kicker="1" title="Why his assignment is being reviewed">
        <ul className="mlo-reasons">{review.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </Section>

      <Section kicker="2" title="What Player Development says" note="The same answer at every club: no philosophy enters it.">
        <p>
          <Chip cls={VERDICT_CLASS[review.current.verdict] ?? ''}>{VERDICT_TEXT[review.current.verdict] ?? review.current.verdict}</Chip>
          {' — his results are '}
          {STANDING_TEXT[review.current.standing] ?? review.current.standing}
          {', and he is '}
          {WINDOW_TEXT[review.current.window] ?? review.current.window}.
        </p>
        <table className="compact">
          <tbody>
            {review.current.parts.map((p, i) => (
              <tr key={i}>
                <th scope="row">{p.label}</th>
                <td><strong>{TIER_TEXT[p.value] ?? p.value}</strong></td>
                <td className="muted">{p.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details>
          <summary>His results, league-relative and park-adjusted</summary>
          <table className="compact">
            <tbody>
              <tr>
                <th scope="row">Against {review.production.leagueName}</th>
                <td>{review.production.percentile !== null ? `${ord(review.production.percentile)} percentile` : (review.production.unassessableDetail ?? 'not established')}</td>
              </tr>
              <tr>
                <th scope="row">Sample</th>
                <td>
                  {Math.round(review.production.sample.opportunities)} {review.kind === 'pitcher' ? 'innings' : 'plate appearances'} over{' '}
                  {review.production.sample.clubGames} club games; {Math.round(review.production.sample.reliability * 100)}% trusted
                </td>
              </tr>
              {review.production.rates.woba !== null && (
                <tr><th scope="row">wOBA</th><td>{review.production.rates.woba.toFixed(3)} against the league's {review.production.leagueContext.woba.toFixed(3)}</td></tr>
              )}
              {review.production.rates.era !== null && (
                <tr><th scope="row">ERA</th><td>{review.production.rates.era.toFixed(2)} against the league's {review.production.leagueContext.era.toFixed(2)}</td></tr>
              )}
            </tbody>
          </table>
        </details>
      </Section>

      <Section kicker="3 and 4" title="What else is defensible, and what this club prefers" note="Philosophy ranks only among the defensible. A disfavoured assignment is exactly as defensible as a preferred one.">
        {review.alternatives.length === 0 ? (
          <p className="muted">
            {review.production.unassessableDetail
              ? `Player Development has not evaluated an alternative assignment for him: ${review.production.unassessableDetail.charAt(0).toLowerCase()}${review.production.unassessableDetail.slice(1)} An assignment cannot be judged without a current-level line to judge it against.`
              : 'No alternative assignment was evaluated: the organization has no other level to move him to.'}
          </p>
        ) : (
          <table className="compact">
            <thead><tr><th>Assignment</th><th>Player Development</th><th>Philosophy</th><th>Would he play there?</th></tr></thead>
            <tbody>
              {review.alternatives.map((alt, i) => (
                <tr key={i}>
                  <th scope="row">{alt.kind.replace(/_/g, ' ')} to {alt.levelName}</th>
                  <td>
                    <Chip cls={JUDGMENT_CLASS[alt.judgment] ?? ''}>{JUDGMENT_TEXT[alt.judgment] ?? alt.judgment}</Chip>
                    {alt.blockers.length > 0 && <div className="muted">{alt.blockers.join(' ')}</div>}
                    {alt.missingEvidence.length > 0 && <div className="muted">{alt.missingEvidence.map((m) => m.detail).join(' ')}</div>}
                  </td>
                  <td>{alt.preference ? <Chip cls="">{PREFERENCE_TEXT[alt.preference] ?? alt.preference}</Chip> : <span className="muted">no preference: not defensible</span>}</td>
                  <td className="muted">{alt.destinationOpportunity?.detail ?? 'not established'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section kicker="5" title="What he is getting where he is" note="Usage, not a roster label.">
        {/* The men ahead of him are listed below with what each holds; the sentence naming them is not repeated here. */}
        <p>{review.opportunity.reasons.filter((r) => !/ahead of him at/.test(r)).join(' ')}</p>
        {review.opportunity.ahead.length > 0 && (
          <p>
            Ahead of him at {review.opportunity.job ? jobLabel(review.opportunity.job) : 'his job'}:{' '}
            {review.opportunity.ahead
              .map((a) => `${a.name} (${a.age}, ${WORK_TEXT[a.level].toLowerCase()}${a.claimant ? '' : ', covering it from another position'})`)
              .join('; ')}.
            {review.opportunity.ahead.some((a) => a.level === 'regular')
              ? ' A regular there holds the job.'
              : ' Nobody is regular there: the job is split, not held.'}
          </p>
        )}
      </Section>

      <Section kicker="6 to 9" title="What follows if he moves" note="Minor League Operations owns this chain; each step is defensible on its own or the chain stops there.">
        {error && <div className="banner error">{error}</div>}
        {!consequence && !error && <p className="muted">Following the chain…</p>}
        {consequence && (
          <>
            <p><strong>{consequence.summary}</strong></p>
            {consequence.affiliateImpact && (
              <table className="compact">
                <tbody>
                  <tr>
                    <th scope="row">{consequence.sourceAffiliate?.label} now</th>
                    <td><Chip cls={STATUS_CLASS[consequence.affiliateImpact.statusBefore]}>{STATUS_TEXT[consequence.affiliateImpact.statusBefore]}</Chip> {consequence.affiliateImpact.before}</td>
                  </tr>
                  <tr>
                    <th scope="row">Without him</th>
                    <td>
                      <Chip cls={STATUS_CLASS[consequence.affiliateImpact.statusAfter]}>{STATUS_TEXT[consequence.affiliateImpact.statusAfter]}</Chip> {consequence.affiliateImpact.after}
                      {consequence.affiliateImpact.findingsAfter.length > 0 && (
                        <ul className="mlo-reasons">{consequence.affiliateImpact.findingsAfter.map((f, i) => <li key={i}>{f}</li>)}</ul>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">The job he vacates</th>
                    <td>
                      {consequence.lostRole ?? '—'}{' '}
                      <Chip cls={consequence.affiliateImpact.absorbed ? 'eligible' : 'indeterminate'}>
                        {consequence.affiliateImpact.absorbed ? 'can be absorbed' : 'leaves a hole'}
                      </Chip>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            {consequence.playingTimeImpact.length > 0 && (
              <>
                <h3>Whose playing time changes</h3>
                <ul>{consequence.playingTimeImpact.map((p) => <li key={p.playerId}>{p.effect}</li>)}</ul>
              </>
            )}
            {consequence.replacementOptions.length > 0 && (
              <>
                <h3>Who could take the job</h3>
                <ul>
                  {consequence.replacementOptions.map((r) => (
                    <li key={r.playerId}>
                      <Chip cls={JUDGMENT_CLASS[r.judgment] ?? 'indeterminate'}>{JUDGMENT_TEXT[r.judgment] ?? r.judgment}</Chip>{' '}
                      <strong>{r.name}</strong> <span className="muted">({r.from})</span>
                      {r.preference ? <> · <Chip cls="">{PREFERENCE_TEXT[r.preference] ?? r.preference}</Chip></> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {consequence.cascade && <CascadeChain cascade={consequence.cascade} />}
            <Unknowns items={consequence.evidence} label="How this was measured" />
          </>
        )}
      </Section>

      {retention && retention.conclusion !== 'retain' && (
        <Section kicker="Retention" title="Does he still have an organizational case?" note="Three questions with three owners, never one score.">
          <table className="compact">
            <tbody>
              <tr>
                <th scope="row">Developmental outlook</th>
                <td><Chip cls={retention.outlook.state === 'developing' ? 'eligible' : retention.outlook.state === 'indeterminate' ? 'indeterminate' : ''}>{retention.outlook.state}</Chip></td>
                <td className="muted">{retention.outlook.reasons.join(' ')} <em>Player Development.</em></td>
              </tr>
              <tr>
                <th scope="row">Operational pressure</th>
                <td><Chip cls={retention.pressure.state === 'none' ? 'eligible' : 'indeterminate'}>{retention.pressure.state}</Chip></td>
                <td className="muted">{retention.pressure.reasons.join(' ')} <em>Minor League Operations.</em></td>
              </tr>
              <tr>
                <th scope="row">Organizational stance</th>
                <td><Chip cls="">{retention.stance.lean}</Chip></td>
                <td className="muted">
                  {retention.stance.reasons.map((r) => `${r.dimension} at ${r.value}: ${r.effect}`).join(' ')}
                  {' '}A club with no stated philosophy would hear <strong>{retention.stance.neutralWouldSay}</strong>.
                </td>
              </tr>
            </tbody>
          </table>
          {retention.guardrails.length > 0 && (
            <ul className="mlo-guardrails">
              {retention.guardrails.map((g) => (
                <li key={g.code}><strong>{g.owner}:</strong> {g.detail}</li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section kicker="10" title="What is uncertain">
        {review.missing.length === 0 && review.current.unknowns.length === 0 ? (
          <p className="muted">Nothing required for this reading is missing.</p>
        ) : (
          <Unknowns items={[...new Set([...review.missing, ...review.current.unknowns])]} />
        )}
        {review.wouldResolve.length > 0 && (
          <p><strong>What would settle it:</strong> {review.wouldResolve.join(' ')}</p>
        )}
      </Section>

      <Section kicker="11" title="What remains your decision">
        <ul className="mlo-reasons">{review.gmDecision.map((g, i) => <li key={i}>{g}</li>)}</ul>
        <details>
          <summary>Who decided what</summary>
          <table className="compact">
            <thead><tr><th>Question</th><th>Owner</th><th>Answer</th></tr></thead>
            <tbody>
              {review.ownership.map((o, i) => (
                <tr key={i}><th scope="row">{o.question}</th><td>{o.owner}</td><td className="muted">{o.answer}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </Section>
    </div>
  );
}
