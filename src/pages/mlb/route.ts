/*
 * The module's address. MLB Operations is one place in the app with several views; the view (and, for a decision, the need) lives in the URL
 * hash so a decision can be linked to, reloaded and returned to with the back button. The rest of the app routes by state, so this stays inside
 * the module: `#/mlb`, `#/mlb/players`, `#/mlb/pitching`, `#/mlb/bench`, `#/mlb/decision/<need id>`.
 */

export type View = 'overview' | 'players' | 'pitching' | 'bench' | 'decision';
export interface Route { view: View; needId: string | null }

export const OVERVIEW: Route = { view: 'overview', needId: null };
const VIEWS: View[] = ['overview', 'players', 'pitching', 'bench'];

export function parseRoute(hash: string): Route {
  const m = /^#\/mlb(?:\/([a-z]+)(?:\/(.+))?)?$/.exec(hash);
  if (!m) return OVERVIEW;
  const view = m[1];
  if (view === 'decision' && m[2]) {
    try { return { view: 'decision', needId: decodeURIComponent(m[2]) }; } catch { return OVERVIEW; }
  }
  return VIEWS.includes(view as View) ? { view: view as View, needId: null } : OVERVIEW;
}

export function routeHash(r: Route): string {
  if (r.view === 'overview') return '#/mlb';
  if (r.view === 'decision' && r.needId) return `#/mlb/decision/${encodeURIComponent(r.needId)}`;
  return `#/mlb/${r.view}`;
}

/** Whether the address belongs to this module (so the app can open it on load). */
export const isMlbHash = (hash: string) => hash.startsWith('#/mlb');
