import { Chip, Section, Unknowns } from './common';
import type { AttentionItem, FarmSystem } from './types';
import type { Route } from './route';

/*
 * "What needs my attention across the farm?"
 *
 * An inbox, and deliberately nothing else: no player table, no affiliate roster, no roster mechanic.
 * The farm v1 Overview opened with four metric tiles counting outputs that were 0, 0, 0 and 1 on a
 * real 247-player organization, then listed every affiliate as a card. The path here is attention →
 * issue → evidence → consequences → the GM's decision, and detail arrives only as he drills.
 */

const SEVERITY_CLASS: Record<AttentionItem['severity'], string> = {
  critical: 'ineligible',
  attention: 'indeterminate',
  noted: '',
};

const SEVERITY_WORD: Record<AttentionItem['severity'], string> = {
  critical: 'Short',
  attention: 'Attention',
  noted: 'Noted',
};

const KIND_WORD: Record<AttentionItem['kind'], string> = {
  assignment: 'Assignment',
  affiliate: 'Affiliate',
  organization: 'Organization',
  retention: 'Retention',
};

const targetRoute = (item: AttentionItem): Route =>
  item.target.kind === 'player'
    ? { view: 'decision', id: item.target.playerId }
    : item.target.kind === 'affiliate'
      ? { view: 'affiliates', id: item.target.teamId }
      : { view: 'organization', id: null };

export function OverviewView({ data, go }: { data: FarmSystem; go: (r: Route) => void }) {
  const { scope } = data.organization;
  const pressing = data.attention.filter((a) => a.severity !== 'noted');
  const worthALook = data.attention.filter((a) => a.severity === 'noted');

  const Row = ({ item }: { item: AttentionItem }) => (
    <li>
      <button className="mlo-attention-row" onClick={() => go(targetRoute(item))}>
        <Chip cls={SEVERITY_CLASS[item.severity]}>{SEVERITY_WORD[item.severity]}</Chip>
        <span className="mlo-attention-kind">{KIND_WORD[item.kind]}</span>
        <span className="mlo-attention-headline">{item.headline}</span>
      </button>
      {item.detail ? <p className="muted mlo-attention-detail">{item.detail}</p> : null}
    </li>
  );

  return (
    <div className="mlo-overview">
      <p className="mlo-read">
        {scope.players} players across {data.affiliates.length} affiliates. Player Development can read{' '}
        {scope.assessed} of them; {scope.indeterminate} cannot be judged on the evidence available and{' '}
        {scope.notAssessable} have no season to read yet. {scope.rehab > 0 ? `${scope.rehab} on rehab from the parent club are not counted as affiliate depth.` : ''}
      </p>

      <Section
        kicker="Organization"
        title="What needs your attention"
        note="Every item opens the place that owns it. Nothing here is a transaction."
      >
        {data.attention.length === 0 ? (
          <div className="farm-empty">
            Nothing in the farm system needs a decision from you right now. Every assignment Player Development
            could read is defensible, every affiliate can field a team, and no prospect is blocked.
          </div>
        ) : (
          <>
            {pressing.length > 0 && <ul className="mlo-attention">{pressing.map((a, i) => <Row key={i} item={a} />)}</ul>}
            {worthALook.length > 0 && (
              <details className="mlo-also">
                <summary>Also worth a look ({worthALook.length})</summary>
                <ul className="mlo-attention">{worthALook.map((a, i) => <Row key={i} item={a} />)}</ul>
              </details>
            )}
          </>
        )}
      </Section>

      <Section kicker="Affiliates" title="Can each club do its job?" note="Operational health only. What each club is doing for its players is on the Affiliates view.">
        <div className="mlo-affiliate-strip">
          {data.affiliates.map((a) => (
            <button key={a.teamId} className="mlo-affiliate-chip" onClick={() => go({ view: 'affiliates', id: a.teamId })}>
              <strong>{a.label}</strong>
              <span className="muted">{a.levelName} · {a.leagueName}</span>
              <Chip cls={a.operational.status === 'critical' ? 'ineligible' : a.operational.status === 'thin' ? 'indeterminate' : 'eligible'}>
                {a.operational.status === 'critical' ? 'Short' : a.operational.status === 'thin' ? 'Thin' : 'Able'}
              </Chip>
              {a.developmental.findings.some((f) => f.severity === 'critical') && (
                <span className="muted">development issues</span>
              )}
            </button>
          ))}
        </div>
      </Section>

      <Unknowns items={data.unknowns} label="What the farm cannot establish" />

      <details className="mlo-also">
        <summary>The thresholds this reading used</summary>
        <table className="compact">
          <thead><tr><th>Name</th><th>Value</th><th>Kind</th><th>On what basis</th></tr></thead>
          <tbody>
            {data.calibration.map((c) => (
              <tr key={c.name}>
                <th scope="row">{c.name}</th>
                <td>{c.value}</td>
                <td><Chip cls="">{c.status}</Chip></td>
                <td className="muted">{c.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
