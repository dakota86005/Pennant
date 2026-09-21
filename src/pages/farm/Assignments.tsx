import { useState } from 'react';
import { Chip, CONCLUSION_CLASS, CONCLUSION_TEXT, ord, Section, STANDING_TEXT, TIER_TEXT, WINDOW_TEXT } from './common';
import type { AssignmentReview, FarmSystem } from './types';
import type { Route } from './route';

/*
 * Every minor leaguer's assignment, and what the organization makes of it.
 *
 * Most rows say the assignment is defensible, and that is the point: the farm is not a promotion
 * leaderboard and it is not ordered by one. It is ordered by whether the GM needs to look, then by
 * name, and it can be filtered to the men whose assignment is in question.
 */

const ATTENTION_ORDER: Record<AssignmentReview['attention'], number> = {
  needs_attention: 0,
  worth_a_look: 1,
  routine: 2,
};

export function AssignmentsView({ data, go }: { data: FarmSystem; go: (r: Route) => void }) {
  const [onlyQuestions, setOnlyQuestions] = useState(true);
  const [level, setLevel] = useState<string>('all');

  const levels = [...new Set(data.assignments.map((a) => a.levelName))];
  const rows = data.assignments
    .filter((a) => (onlyQuestions ? a.attention !== 'routine' : true))
    .filter((a) => (level === 'all' ? true : a.levelName === level))
    .slice()
    .sort((a, b) => ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention] || a.name.localeCompare(b.name));

  return (
    <div className="mlo-assignments">
      <Section
        kicker="Assignments"
        title="Whose assignment deserves a review?"
        note="Player Development says whether the level is developing him; Minor League Operations says whether he can get the work there. Both are shown, with who said what."
      >
        <div className="mlo-filters">
          <label>
            <input type="checkbox" checked={onlyQuestions} onChange={(e) => setOnlyQuestions(e.target.checked)} />{' '}
            Only assignments in question
          </label>
          <label>
            Level{' '}
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="all">All</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <span className="muted">
            {rows.length} of {data.assignments.length} players
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="farm-empty">
            {onlyQuestions
              ? 'No assignment is in question at this level. Every one Player Development could read is defensible, and nobody is short of work.'
              : 'No players.'}
          </div>
        ) : (
          <div className="mlo-table-scroll">
            <table className="compact mlo-assignment-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Age</th>
                  <th>Club</th>
                  <th>The level</th>
                  <th>His results</th>
                  <th>His work</th>
                  <th>Stakes</th>
                  <th>Conclusion</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.playerId}>
                    <th scope="row">{a.name}</th>
                    <td>{a.age}</td>
                    <td>{a.levelName} <span className="muted">{a.team}</span></td>
                    <td>
                      {STANDING_TEXT[a.current.standing] ?? a.current.standing}
                      <span className="muted"> · {WINDOW_TEXT[a.current.window] ?? a.current.window}</span>
                    </td>
                    <td>
                      {a.production.percentile !== null ? (
                        <>
                          {ord(a.production.percentile)} <span className="muted">in {a.production.leagueName}</span>
                        </>
                      ) : (
                        <span className="muted">{a.production.unassessableDetail ?? 'not established'}</span>
                      )}
                    </td>
                    <td className="muted">{a.opportunity.verdict.replace(/_/g, ' ')}</td>
                    <td>{a.protection.tier ? TIER_TEXT[a.protection.tier] ?? a.protection.tier : <span className="muted">indeterminate</span>}</td>
                    <td>
                      <Chip cls={CONCLUSION_CLASS[a.conclusion] ?? ''}>{CONCLUSION_TEXT[a.conclusion] ?? a.conclusion}</Chip>
                    </td>
                    <td><button className="link" onClick={() => go({ view: 'decision', id: a.playerId })}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
