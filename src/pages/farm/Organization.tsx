import { Finding, Section, Chip } from './common';
import type { FarmSystem } from './types';
import type { Route } from './route';

/*
 * The farm as one organization: where it is piled up and where it is thin.
 *
 * These are the issues no affiliate page can show, because they are about the relationship between
 * affiliates. Three prospects who each need everyday shortstop reps are not a problem at any one
 * club. Counts, never quality: whether a player is good is Player Development's and is shown beside
 * the count. No chart that does not lead to a decision.
 */

export function OrganizationView({ data, go }: { data: FarmSystem; go: (r: Route) => void }) {
  const { organization, assignments } = data;
  const levels = organization.startersByLevel;
  const beyondWindow = assignments.filter((a) => a.conclusion === 'organizational_question');

  return (
    <div className="mlo-organization">
      <Section
        kicker="Organization"
        title="System-wide issues"
        note="Congestion, depth and cascade pressure. Each is about how the affiliates relate, not about one of them."
      >
        {organization.findings.length === 0 ? (
          <div className="farm-empty">
            No system-wide congestion or depth problem is visible: no position has two priority prospects on the
            same developmental path at one level, and no level is developing more starters than it has rotation spots.
          </div>
        ) : (
          <div className="mlo-findings">
            {organization.findings
              .slice()
              .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : a.severity === 'attention' ? -1 : 1))
              .map((f) => <Finding key={f.id} f={f} />)}
          </div>
        )}
      </Section>

      <Section
        kicker="Depth"
        title="Who the organization could reach for"
        note="Players who can play each position, by level. Depth counts what a man CAN play; congestion counts the one path he is on."
      >
        <div className="mlo-table-scroll">
          <table className="compact">
            <thead>
              <tr>
                <th>Position</th>
                {levels.map((l) => <th key={l.level}>{l.levelName}</th>)}
                <th>Upper minors</th>
              </tr>
            </thead>
            <tbody>
              {organization.distribution.map((d) => (
                <tr key={d.position}>
                  <th scope="row">{d.position}</th>
                  {levels.map((l) => {
                    const at = d.byLevel.find((b) => b.level === l.level);
                    return (
                      <td key={l.level}>
                        {at?.players ?? 0}
                        {at && at.priority > 0 ? <span className="muted"> ({at.priority} priority)</span> : null}
                      </td>
                    );
                  })}
                  <td>
                    <Chip cls={d.upperMinors < 2 ? 'ineligible' : d.upperMinors < 3 ? 'indeterminate' : 'eligible'}>{d.upperMinors}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        kicker="Pitching"
        title="Starters against rotation spots"
        note="Pitchers each club is using as starters, against the spots the level has. A man past the spots is a man not starting."
      >
        <table className="compact">
          <thead><tr><th>Level</th><th>Used as starters</th><th>Rotation spots</th><th /></tr></thead>
          <tbody>
            {levels.map((l) => (
              <tr key={l.level}>
                <th scope="row">{l.levelName}</th>
                <td>{l.developmentalStarters}</td>
                <td>{l.rotationSpots}</td>
                <td>
                  {l.developmentalStarters > l.rotationSpots ? (
                    <Chip cls="indeterminate">{l.developmentalStarters - l.rotationSpots} without a spot</Chip>
                  ) : (
                    <Chip cls="eligible">Every man has a spot</Chip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {beyondWindow.length > 0 && (
        <Section
          kicker="Depth players"
          title={`${beyondWindow.length} players are past their level's developmental window`}
          note="The level has no developmental value left for them, so where each plays is a question about what the organization needs and who else needs the reps — not about his development."
        >
          <table className="compact">
            <thead><tr><th>Player</th><th>Age</th><th>Level</th><th>Club</th><th /></tr></thead>
            <tbody>
              {beyondWindow.map((a) => (
                <tr key={a.playerId}>
                  <th scope="row">{a.name}</th>
                  <td>{a.age}</td>
                  <td>{a.levelName}</td>
                  <td>{a.team}</td>
                  <td><button className="link" onClick={() => go({ view: 'decision', id: a.playerId })}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
