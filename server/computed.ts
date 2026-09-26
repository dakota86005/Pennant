/**
 * A route's answer, computed without HTTP (the route extractions of SWIFTUI_REBUILD.md milestone N4, V2 plan R7): the
 * body, or a refusal with the status and sentence the route answers. The old routes send exactly this, so a module the
 * Mac app's presentation layer calls and the page the React app reads cannot drift apart.
 */
export type Computed<T> = { ok: true; body: T } | { ok: false; status: 400 | 404; error: string };

export const answer = <T>(body: T): Computed<T> => ({ ok: true, body });
export const refuse = <T>(status: 400 | 404, error: string): Computed<T> => ({ ok: false, status, error });
