/**
 * The organization the app is being viewed as (the one selected in the header). Set during App's render, like the
 * rating scale, so the player card (opened from anywhere) can ask Player Value for "our view" through that club's
 * philosophy without prop drilling. Null before an organization is chosen: the server then resolves the configured
 * organization, then the human-managed one.
 */
let viewer: number | null = null;

export function setViewerOrg(id: number | null): void {
  viewer = id;
}

export function viewerOrg(): number | null {
  return viewer;
}
