import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet } from '../api';
import { BenchView } from './mlb/Bench';
import { Decision } from './mlb/Decision';
import { OverviewView } from './mlb/Overview';
import { PitchingStaff } from './mlb/PitchingStaff';
import { PositionPlayers } from './mlb/PositionPlayers';
import { OVERVIEW, parseRoute, routeHash, type Route, type View } from './mlb/route';
import type { Overview } from './mlb/types';

/*
 * Major League Operations: a workspace, not a report. It answers, in order, what needs my attention (Overview), what does the staff make of
 * the players (Position players, Pitching staff, Bench), and, for one need opened, what are my choices and what follows from each (Decision).
 * Nothing here ranks players or chooses a move; every verdict is the owning specialist's, labelled with who said it.
 * See docs/MLB_OPERATIONS.md and docs/MLB_OPERATIONS_HARDENING.md (section 8) for what each view owns.
 */

const TABS: Array<{ view: Exclude<View, 'decision'>; label: string }> = [
  { view: 'overview', label: 'Overview' }, { view: 'players', label: 'Position players' }, { view: 'pitching', label: 'Pitching staff' }, { view: 'bench', label: 'Bench and coverage' },
];

/** A view that fails to draw says so, in place, and leaves the rest of the app (and the module's tabs) standing. */
class ViewBoundary extends Component<{ view: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  componentDidUpdate(prev: { view: string }) { if (prev.view !== this.props.view && this.state.error) this.setState({ error: null }); }
  render() {
    return this.state.error
      ? <div className="banner error">This view could not be drawn: {this.state.error}. The other views are unaffected.</div>
      : this.props.children;
  }
}

export function MlbOperations({ orgId }: { orgId: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [whatIf, setWhatIf] = useState('');

  const go = useCallback((r: Route) => {
    if (r.view !== 'decision' || !r.needId?.startsWith('mlb:what_if:')) setWhatIf('');
    setRoute(r);
    const hash = routeHash(r);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    window.scrollTo?.({ top: 0 });
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onPop); };
  }, []);

  useEffect(() => {
    setData(null); setError(null);
    apiGet<Overview>(`/api/mlb-operations/${orgId}`).then(setData).catch((e) => setError(e.message));
  }, [orgId]);

  const need = useMemo(() => data?.needs.find((n) => n.id === route.needId), [data, route.needId]);
  const counts = useMemo(() => {
    const flags = (role: (g: Overview['review'][number]) => boolean) => data?.review.filter(role).flatMap((g) => g.holders).filter((h) => h.strength === 'strong' || h.strength === 'moderate').length ?? 0;
    return {
      overview: data?.needs.length ?? 0,
      players: flags((g) => g.role === 'lineup regular'),
      pitching: flags((g) => g.kind === 'starting_pitcher' || g.kind === 'relief_pitcher') + (data?.review.filter((g) => g.kind === 'relief_pitcher').reduce((n, g) => n + (g.deployment?.length ?? 0) + (g.pen?.length ?? 0), 0) ?? 0),
      bench: data?.review.find((g) => g.bench)?.bench?.gaps.length ?? 0,
    };
  }, [data]);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Reading the roster…</p>;

  return (
    <div className="mlb-module">
      <nav className="mlb-tabs" aria-label="MLB Operations">
        {TABS.map((t) => (
          <button key={t.view} className={route.view === t.view ? 'active' : ''} aria-current={route.view === t.view ? 'page' : undefined} onClick={() => go(t.view === 'overview' ? OVERVIEW : { view: t.view, needId: null })}>
            {t.label}{counts[t.view] > 0 ? <span className="mlb-count">{counts[t.view]}</span> : null}
          </button>
        ))}
        {route.view === 'decision' && <button className="active" aria-current="page">Decision</button>}
      </nav>
      <ViewBoundary view={`${route.view}:${route.needId ?? ''}`}>
        {route.view === 'overview' && <OverviewView data={data} go={go} whatIf={whatIf} setWhatIf={setWhatIf} />}
        {route.view === 'players' && <PositionPlayers data={data} go={go} />}
        {route.view === 'pitching' && <PitchingStaff data={data} go={go} />}
        {route.view === 'bench' && <BenchView data={data} go={go} />}
        {route.view === 'decision' && route.needId && <Decision orgId={orgId} needId={route.needId} need={need} onBack={() => go(OVERVIEW)} />}
      </ViewBoundary>
    </div>
  );
}
