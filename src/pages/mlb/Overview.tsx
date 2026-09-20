import { ContextStrip, KIND_LABEL, NeedBadge, POSITION_ABBR } from './common';
import type { Need, Overview } from './types';
import type { Route } from './route';

/*
 * The landing view: an operational inbox. It answers one question, what needs my attention, and links to where each answer lives. It
 * deliberately carries no lineup table, no bullpen table, no bench table and no candidate list: those are the scouting book, and are one
 * click away in the views the summary cards below open.
 */

const STATE_KINDS: Array<Need['kind']> = ['il_return_crunch', 'role_below_standard', 'open_active_spot'];

function NeedRow({ n, go }: { n: Need; go: (r: Route) => void }) {
  const first = n.summary.split(/(?<=[.!?])\s/)[0] ?? n.summary;
  return (
    <button className="mlb-need" onClick={() => go({ view: 'decision', needId: n.id })}>
      <span className="mlb-need-top"><NeedBadge n={n} /> <span className="muted">{KIND_LABEL[n.kind]}{n.role && n.kind !== 'role_below_standard' ? ` · ${n.role.label}` : ''}</span></span>
      <span className="mlb-need-title">{n.title}</span>
      <span className="mlb-need-sub muted">{first.length > 190 ? `${first.slice(0, 187)}…` : first}</span>
    </button>
  );
}

function Glance({ title, lines, onOpen }: { title: string; lines: string[]; onOpen: () => void }) {
  return (
    <button className="mlb-glance" onClick={onOpen}>
      <b>{title}</b>
      {lines.map((l) => <span key={l} className="muted">{l}</span>)}
      <span className="mlb-glance-go">Open →</span>
    </button>
  );
}

const count = (needs: Need[], f: (n: Need) => boolean) => needs.filter(f).length;

export function OverviewView({ data, go, whatIf, setWhatIf }: { data: Overview; go: (r: Route) => void; whatIf: string; setWhatIf: (v: string) => void }) {
  const r = data.roster;
  const needs = data.needs;
  const state = needs.filter((n) => STATE_KINDS.includes(n.kind));
  const strong = needs.filter((n) => n.kind === 'role_holder_review' && n.review?.strength === 'strong');
  const rest = needs.filter((n) => !state.includes(n) && !strong.includes(n));

  const lineup = data.review.find((g) => g.role === 'lineup regular');
  const rotation = data.review.find((g) => g.kind === 'starting_pitcher');
  const pen = data.review.find((g) => g.kind === 'relief_pitcher');
  const bench = data.review.find((g) => g.bench)?.bench;
  const flags = (holders: Array<{ strength: string }> | undefined) => (holders ?? []).filter((h) => h.strength === 'strong' || h.strength === 'moderate').length;
  const unsettled = lineup?.lineup ? [...lineup.lineup.spots, lineup.lineup.dh].filter((s) => !s.settled).map((s) => POSITION_ABBR[s.position]) : [];

  return (
    <div className="mlb-overview">
      {data.context && <ContextStrip ctx={data.context} />}

      <div className="mlb-statusline">
        <span><span className="card-label">Active</span> <b>{r.active.count ?? '?'}/{r.active.limit ?? '?'}</b></span>
        <span><span className="card-label">40-man</span> <b>{r.fortyMan.count ?? '?'}/{r.fortyMan.limit ?? '?'}</b></span>
        <span><span className="card-label">Injured list</span> <b>{r.injuredList}</b></span>
        <span><span className="card-label">Roster data</span> <b>{data.freshness.level}</b></span>
      </div>
      {data.freshness.level !== 'current' && <p className="muted">{data.freshness.headline}. Rights that depend on the transaction log are stated as not established.</p>}
      {data.unknowns.map((u) => <div key={u} className="muted">⚑ {u}</div>)}

      <section className="mlb-inbox">
        <h3>Needs your attention</h3>
        {needs.length === 0 && <p className="muted">Nothing on the active roster is below Pennant's minimum coverage floors ({data.coverage.floors.map((s) => s.label).join(', ')}), and the scouting review raises no case.</p>}
        {state.length > 0 && <div className="mlb-need-group"><h4>Roster</h4>{state.map((n) => <NeedRow key={n.id} n={n} go={go} />)}</div>}
        {strong.length > 0 && <div className="mlb-need-group"><h4>Scouting review — strongest cases</h4>{strong.map((n) => <NeedRow key={n.id} n={n} go={go} />)}</div>}
        {rest.length > 0 && (
          <details className="mlb-need-group" open={rest.length <= 3 && state.length + strong.length === 0}>
            <summary><b>Also worth a look</b> <span className="muted">({rest.length}: moderate cases, platoon and coverage flags)</span></summary>
            {rest.map((n) => <NeedRow key={n.id} n={n} go={go} />)}
          </details>
        )}
      </section>

      <section>
        <h3>The staff at a glance</h3>
        <div className="mlb-glances">
          <Glance
            title="Position players" onOpen={() => go({ view: 'players', needId: null })}
            lines={lineup ? [
              `${lineup.holders.length} regulars reviewed · ${flags(lineup.holders)} flagged`,
              count(needs, (n) => n.kind === 'platoon_complement') > 0 ? `${count(needs, (n) => n.kind === 'platoon_complement')} platoon flag${count(needs, (n) => n.kind === 'platoon_complement') === 1 ? '' : 's'}` : 'No platoon problems',
              unsettled.length ? `Unsettled: ${unsettled.join(', ')}` : 'Every position has a regular',
            ] : ['No lineup usage available']}
          />
          <Glance
            title="Pitching staff" onOpen={() => go({ view: 'pitching', needId: null })}
            lines={[
              `${rotation?.holders.length ?? 0} starters · ${flags(rotation?.holders)} flagged`,
              `${pen?.holders.length ?? 0} relievers · ${flags(pen?.holders)} flagged`,
              (pen?.deployment?.length ?? 0) + (pen?.pen?.length ?? 0) > 0 ? `${(pen?.deployment?.length ?? 0) + (pen?.pen?.length ?? 0)} deployment note${(pen?.deployment?.length ?? 0) + (pen?.pen?.length ?? 0) === 1 ? '' : 's'}` : 'No deployment notes',
            ]}
          />
          <Glance
            title="Bench and coverage" onOpen={() => go({ view: 'bench', needId: null })}
            lines={bench ? [
              `${bench.rows.length} on the bench`,
              bench.gaps.length ? `Not covered: ${bench.gaps.map((g) => g.label.replace(/^an? /, '')).join('; ')}` : 'Catcher, middle infield and center field covered',
              (() => { const missing = bench.functions.filter((f) => f.strength === 'none' && !['catcher', 'middle_infield', 'center_field'].includes(f.key)); return missing.length ? `No ${missing.map((f) => f.label.toLowerCase().replace(/^an? /, '')).join(', ')}` : 'Every bench function has someone'; })(),
            ] : ['No bench review available']}
          />
        </div>
      </section>

      <section className="mlb-whatif-panel">
        <h3>Ask a what-if</h3>
        <select className="mlb-whatif" value={whatIf} onChange={(e) => { setWhatIf(e.target.value); if (e.target.value) go({ view: 'decision', needId: `mlb:what_if:${e.target.value}` }); }}>
          <option value="">If this player is unavailable…</option>
          {data.activePlayers.map((p) => <option key={p.playerId} value={p.playerId}>{p.name}{p.role ? ` — ${p.role}` : ''}</option>)}
        </select>
        <p className="muted">Pose a scenario to see how the club would respond if a player were out. It is a scenario, not a current problem.</p>
      </section>
    </div>
  );
}
