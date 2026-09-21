/*
 * The module's address. Minor League Operations is one place in the app with several views; the view
 * (and, for a decision, the player or affiliate opened) lives in the URL hash so a decision can be
 * linked to, reloaded and returned to with the back button. The same shape as MLB Operations'
 * (`src/pages/mlb/route.ts`) so the two modules behave the same way:
 *
 *   #/farm · #/farm/organization · #/farm/affiliates · #/farm/affiliates/<team id>
 *   #/farm/assignments · #/farm/decision/<player id>
 */

export type View = 'overview' | 'organization' | 'affiliates' | 'assignments' | 'decision';

export interface Route {
  view: View;
  /** The affiliate opened on the Affiliates view, or the player opened on Decision. */
  id: number | null;
}

export const OVERVIEW: Route = { view: 'overview', id: null };
const VIEWS: View[] = ['overview', 'organization', 'affiliates', 'assignments'];

export function parseRoute(hash: string): Route {
  const m = /^#\/farm(?:\/([a-z]+)(?:\/(\d+))?)?$/.exec(hash);
  if (!m) return OVERVIEW;
  const view = m[1];
  const id = m[2] ? Number(m[2]) : null;
  if (view === 'decision') return id === null ? OVERVIEW : { view: 'decision', id };
  if (view === 'affiliates') return { view: 'affiliates', id };
  return VIEWS.includes(view as View) ? { view: view as View, id: null } : OVERVIEW;
}

export function routeHash(r: Route): string {
  if (r.view === 'overview') return '#/farm';
  if (r.id !== null) return `#/farm/${r.view}/${r.id}`;
  return `#/farm/${r.view}`;
}

/** Whether the address belongs to this module (so the app can open it on load). */
export const isFarmHash = (hash: string) => hash.startsWith('#/farm');
