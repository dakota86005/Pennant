import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiGet } from '../api';
import { AffiliatesView } from './farm/Affiliates';
import { AssignmentsView } from './farm/Assignments';
import { Decision } from './farm/Decision';
import { OrganizationView } from './farm/Organization';
import { OverviewView } from './farm/Overview';
import { OVERVIEW, parseRoute, routeHash, type Route, type View } from './farm/route';
import type { FarmSystem } from './farm/types';

/*
 * Minor League Operations: the farm system as a workspace, and the sibling of MLB Operations.
 *
 * It answers, in order, what needs my attention (Overview), what shape is the system in
 * (Organization), what is each club doing (Affiliates), whose assignment is in question
 * (Assignments), and, for one player opened, what are my choices and what follows from each
 * (Decision). The shell, the hash routing, the view boundary and the chip vocabulary are MLB
 * Operations' own, so a GM moving between the two modules does not have to learn a second language
 * (D-046). What differs is the baseball workflow, not the interface.
 *
 * See docs/MINOR_LEAGUE_OPERATIONS.md for what each view owns.
 */

const TABS: Array<{ view: Exclude<View, 'decision'>; label: string }> = [
  { view: 'overview', label: 'Overview' },
  { view: 'organization', label: 'Organization' },
  { view: 'affiliates', label: 'Affiliates' },
  { view: 'assignments', label: 'Assignments' },
];

/** A view that fails to draw says so, in place, and leaves the rest of the module standing. */
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

export function MinorLeagueOperations({ orgId }: { orgId: number }) {
  const [data, setData] = useState<FarmSystem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  const go = useCallback((r: Route) => {
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
    setData(null);
    setError(null);
    apiGet<FarmSystem>(`/api/farm-operations/${orgId}`).then(setData).catch((e) => setError(e.message));
  }, [orgId]);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Reading the farm system…</p>;

  const counts: Record<Exclude<View, 'decision'>, number> = {
    overview: data.attention.filter((a) => a.severity !== 'noted').length,
    organization: data.organization.findings.filter((f) => f.severity !== 'noted').length,
    affiliates: data.affiliates.filter(
      (a) => a.operational.status !== 'healthy' || a.developmental.findings.some((f) => f.severity === 'critical')
    ).length,
    assignments: data.assignments.filter((a) => a.attention === 'needs_attention').length,
  };

  return (
    <div className="mlb-module mlo-module">
      <nav className="mlb-tabs" aria-label="Minor League Operations">
        {TABS.map((t) => (
          <button
            key={t.view}
            className={route.view === t.view ? 'active' : ''}
            aria-current={route.view === t.view ? 'page' : undefined}
            onClick={() => go(t.view === 'overview' ? OVERVIEW : { view: t.view, id: null })}
          >
            {t.label}{counts[t.view] > 0 ? <span className="mlb-count">{counts[t.view]}</span> : null}
          </button>
        ))}
        {route.view === 'decision' && <button className="active" aria-current="page">Decision</button>}
      </nav>
      <ViewBoundary view={`${route.view}:${route.id ?? ''}`}>
        {route.view === 'overview' && <OverviewView data={data} go={go} />}
        {route.view === 'organization' && <OrganizationView data={data} go={go} />}
        {route.view === 'affiliates' && <AffiliatesView data={data} selected={route.id} go={go} />}
        {route.view === 'assignments' && <AssignmentsView data={data} go={go} />}
        {route.view === 'decision' && route.id !== null && (
          <Decision orgId={orgId} playerId={route.id} data={data} go={go} />
        )}
      </ViewBoundary>
    </div>
  );
}
