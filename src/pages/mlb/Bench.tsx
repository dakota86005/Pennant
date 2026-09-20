import { PlayerLink } from '../../playerModal';
import { Chip, ord, QUALITY_CLASS, QUALITY_TEXT, POSITION_ABBR } from './common';
import type { Route } from './route';
import type { BenchFunction, Overview } from './types';

/*
 * The bench: a collection of functions, never one score. Each function says who covers it and how well, and where nobody does. Being able to
 * stand at a position is not being a backup for it: covers are read against the peers who actually play the position.
 */

const STRENGTH_TEXT: Record<BenchFunction['strength'], string> = { covered: 'Covered', thin: 'Thin', none: 'Nobody', unknown: 'Not established' };
const STRENGTH_CLASS: Record<BenchFunction['strength'], string> = { covered: 'eligible', thin: 'ineligible', none: 'ineligible', unknown: 'indeterminate' };
const TAG_TEXT: Record<string, string> = { pinch_hitter: 'pinch-hit bat', defensive_replacement: 'defensive replacement', pinch_runner: 'runner', platoon_partner: 'platoon partner', flexible: 'flexible' };
const REQUIRED = ['catcher', 'middle_infield', 'center_field'];

export function BenchView({ data, go }: { data: Overview; go: (r: Route) => void }) {
  const b = data.review.find((g) => g.bench)?.bench;
  if (!b) return <p className="muted">No bench review is available.</p>;
  const gapOf = (key: string) => b.gaps.find((g) => g.key === key);
  return (
    <div>
      <p className="muted mlb-lede">A bench is for something. Three positions need somebody who can really play them (catcher, middle infield, center field); the rest of what a bench does, a bat to send up, a glove for late innings, a runner, flexibility, is shown as functions that are covered or not. Nothing here is a bench score.</p>
      <section className="mlb-panel">
        <h3>What the bench is for</h3>
        <div className="mlb-functions">
          {b.functions.map((f) => (
            <div key={f.key} className={`mlb-function ${f.strength}`}>
              <div className="mlb-function-head"><b>{f.label}</b> <Chip cls={STRENGTH_CLASS[f.strength]}>{STRENGTH_TEXT[f.strength]}</Chip></div>
              <div>{f.text}</div>
              {f.by.length > 0 && <ul className="mlb-option-costs">{f.by.slice(0, 4).map((x) => <li key={`${x.playerId}:${x.note}`}><PlayerLink id={x.playerId}>{x.name}</PlayerLink> <span className="muted">{x.note}</span>{x.quality && REQUIRED.includes(f.key) ? <> <Chip cls={QUALITY_CLASS[x.quality]}>{QUALITY_TEXT[x.quality]}</Chip></> : null}</li>)}</ul>}
              {REQUIRED.includes(f.key) && gapOf(f.key) && <button className="link" onClick={() => go({ view: 'decision', needId: `mlb:bench_coverage:${f.key}` })}>Who could cover it? →</button>}
            </div>
          ))}
        </div>
      </section>
      <section className="mlb-panel">
        <h3>The bench</h3>
        {b.rows.length === 0 ? <p className="muted">There is no bench: every active position player is a regular.</p> : (
          <div className="mlb-scroll"><table>
            <thead><tr><th>Player</th><th>Bats</th><th>For</th><th>Can play</th><th>Also</th><th>Bat</th><th>PA</th></tr></thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.playerId}>
                  <td className="name"><PlayerLink id={r.playerId}>{r.name}</PlayerLink></td>
                  <td>{r.bats ?? '—'}</td>
                  <td>{r.role}{r.partnerAt ? <span className="muted"> · shares {POSITION_ABBR[r.partnerAt]}</span> : null}</td>
                  <td className="mlb-covers">{r.coverReads.length ? r.coverReads.map((c) => <span key={c.position} className={`mlb-tag ${c.quality === 'emergency' ? 'minus' : c.quality === 'unknown' ? '' : 'plus'}`} title={`${QUALITY_TEXT[c.quality]}${c.pct !== null ? `, ${Math.round(c.pct)}th percentile of those listed there` : ''}`}>{POSITION_ABBR[c.position]}{c.quality === 'emergency' ? ' (emergency)' : ''}</span>) : <span className="muted">no visible grade</span>}</td>
                  <td>{r.tags.filter((t) => t !== 'platoon_partner').map((t) => <span key={t} className="mlb-tag">{TAG_TEXT[t] ?? t}</span>)}</td>
                  <td>{ord(r.batValue)}</td><td>{r.pa}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {b.findings.filter((f) => !b.gaps.some((g) => g.text === f)).map((f) => <div key={f} className="muted">⚑ {f}</div>)}
        <p className="muted">Bench hands: {b.hands.L} left, {b.hands.R} right, {b.hands.S} switch.</p>
      </section>
    </div>
  );
}
