import { Chip, Finding, Section, Unknowns, STATUS_CLASS, STATUS_TEXT, VERDICT_CLASS, VERDICT_TEXT } from './common';
import type { AffiliateView, FarmSystem } from './types';
import type { Route } from './route';

/*
 * One affiliate, read twice.
 *
 * This page can be dense: the GM drilled into it deliberately. The one thing it must not do is mix
 * the two readings, because they answer different questions and a real club is often fine on one and
 * not the other. OPERATIONAL HEALTH is "can this club field a team and cover a schedule"; DEVELOPMENTAL
 * HEALTH is "are the players here developing appropriately".
 */

function AffiliateBody({ a, go }: { a: AffiliateView; go: (r: Route) => void }) {
  const dev = a.developmental;

  return (
    <div className="mlo-affiliate">
      <section className="mlo-affiliate-hero">
        <div>
          <h2>{a.label}</h2>
          <p className="muted">
            {a.levelName} · {a.leagueName} · {a.games} games played · {a.operational.roster.total} on the active list
            ({a.operational.roster.positionPlayers} position players, {a.operational.roster.pitchers} pitchers)
          </p>
        </div>
        <div className="mlo-affiliate-states">
          <div>
            <span className="farm-kicker">Operational health</span>
            <Chip cls={STATUS_CLASS[a.operational.status]}>{STATUS_TEXT[a.operational.status]}</Chip>
            <small>Can the club field a team and cover a schedule?</small>
          </div>
          <div>
            <span className="farm-kicker">Developmental health</span>
            <Chip cls={dev.findings.some((f) => f.severity === 'critical') ? 'ineligible' : dev.findings.some((f) => f.severity === 'attention') ? 'indeterminate' : 'eligible'}>
              {dev.findings.some((f) => f.severity === 'critical')
                ? 'Costing development'
                : dev.findings.some((f) => f.severity === 'attention')
                  ? 'Worth a look'
                  : 'No issue found'}
            </Chip>
            <small>Are the players here developing appropriately?</small>
          </div>
        </div>
      </section>

      <Section kicker="Operational" title="Can the club do its job?" note="A shortage only. Carrying more men than the club has work for is a developmental matter, below.">
        {a.operational.findings.length === 0 ? (
          <div className="farm-empty">Nothing is short: the club can field its eight positions and cover a pitching schedule.</div>
        ) : (
          <div className="mlo-findings">{a.operational.findings.map((f) => <Finding key={f.id} f={f} open={f.severity === 'critical'} />)}</div>
        )}

        <div className="mlo-table-scroll">
          <table className="compact">
            <thead>
              <tr><th>Position</th><th>Graded cover</th><th>Listed only</th><th>Strong</th></tr>
            </thead>
            <tbody>
              {a.operational.coverage.map((c) => (
                <tr key={c.position}>
                  <th scope="row">
                    {c.position}
                    {c.critical ? <span className="muted" title="A shortage here cannot be covered by moving somebody else"> *</span> : null}
                  </th>
                  <td><Chip cls={c.graded + c.listedOnly === 0 ? 'ineligible' : c.graded + c.listedOnly === 1 ? 'indeterminate' : 'eligible'}>{c.graded}</Chip></td>
                  <td>{c.listedOnly > 0 ? <span className="muted">{c.listedOnly}</span> : '—'}</td>
                  <td>{c.strong}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          A graded cover has a visible fielding grade at the position. One covered only by a roster label is counted
          separately: the label is an objective fact, the grade is what says how well he can play there. * marks a
          position whose loss cannot be covered by moving somebody else.
        </p>
        <p className="muted">
          Pitching: {a.operational.pitching.starters} assigned to start against {a.operational.pitching.rotationSpots} rotation
          spots, {a.operational.pitching.relievers} relief arms. {a.operational.fieldablePositions} of 8 positions can be
          filled at once.
        </p>
      </Section>

      <Section kicker="Developmental" title="Are the players here developing?" note="Separate from whether the club can field a team. A club can do one and not the other.">
        <p className="muted">
          Player Development can read {dev.assessment.assessed} of this club's players.{' '}
          {dev.assessment.indeterminate > 0 ? `${dev.assessment.indeterminate} cannot be judged on the evidence available. ` : ''}
          {dev.assessment.notAssessable > 0 ? `${dev.assessment.notAssessable} have no season to read yet.` : ''}
        </p>

        {dev.findings.length === 0 ? (
          <div className="farm-empty">No developmental issue was found on this club.</div>
        ) : (
          <div className="mlo-findings">{dev.findings.map((f) => <Finding key={f.id} f={f} open={f.severity === 'critical'} />)}</div>
        )}

        {dev.concerns.length > 0 && (
          <>
            <h3>Assignments worth reviewing</h3>
            <table className="compact">
              <thead><tr><th>Player</th><th>Age</th><th>What the level is doing</th><th>Whose question</th><th>Where it leaves him</th><th /></tr></thead>
              <tbody>
                {dev.concerns.map((c) => (
                  <tr key={c.playerId}>
                    <th scope="row">{c.name}</th>
                    <td>{c.age}</td>
                    <td><Chip cls={VERDICT_CLASS[c.verdict] ?? ''}>{VERDICT_TEXT[c.verdict] ?? c.verdict}</Chip></td>
                    <td className="muted">{c.question === 'none' ? '—' : c.question}</td>
                    <td>{c.summary}</td>
                    <td><button className="link" onClick={() => go({ view: 'decision', id: c.playerId })}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      {(a.rosterTreatment.rehab.length > 0 || a.rosterTreatment.ambiguous.length > 0 || a.rosterTreatment.injured.length > 0) && (
        <Section kicker="Roster context" title="Players not counted as ordinary members of this club" note="A parent-club player on a rehab assignment is temporary roster context, not affiliate depth; an injured man is not cover today.">
          <ul>
            {a.rosterTreatment.injured.map((p) => (
              <li key={p.playerId}>
                <strong>{p.name}</strong> ({p.listedPosition}) — injured{p.daysLeft !== null ? `, ${p.daysLeft} days` : ''}. He is not counted as
                cover or as a man taking starts, and he competes for no job while he is out.
              </li>
            ))}
            {a.rosterTreatment.rehab.map((p) => (
              <li key={p.playerId}>
                <strong>{p.name}</strong> — on an injury-rehab assignment from the parent club. He is here, and he is
                not counted in anything above.
              </li>
            ))}
            {a.rosterTreatment.ambiguous.map((p) => (
              <li key={p.playerId}>
                <strong>{p.name}</strong> — <span className="muted">{p.reason}</span> He IS counted, because nothing
                establishes otherwise; if he is in fact on rehab, this club's depth is overstated.
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Unknowns items={a.unknowns} />
    </div>
  );
}

export function AffiliatesView({ data, selected, go }: { data: FarmSystem; selected: number | null; go: (r: Route) => void }) {
  const affiliate = data.affiliates.find((a) => a.teamId === selected) ?? data.affiliates[0];

  return (
    <div>
      <nav className="mlo-affiliate-nav" aria-label="Affiliates">
        {data.affiliates.map((a) => (
          <button
            key={a.teamId}
            className={a.teamId === affiliate?.teamId ? 'active' : ''}
            aria-current={a.teamId === affiliate?.teamId ? 'page' : undefined}
            onClick={() => go({ view: 'affiliates', id: a.teamId })}
          >
            {a.label} <span className="muted">{a.levelName}</span>
          </button>
        ))}
      </nav>
      {affiliate ? <AffiliateBody a={affiliate} go={go} /> : <div className="farm-empty">This organization has no minor-league affiliates.</div>}
    </div>
  );
}
