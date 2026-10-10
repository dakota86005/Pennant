/**
 * The club a `/v2` request names, and why it cannot be answered (N4, moved out of `frontOfficeService.ts` at N13 so the
 * AI surfaces' service resolves a club the one way without reaching the Front Office's cache). `frontOfficeService.ts`
 * re-exports every name here, so its importers are unchanged.
 */
import { clubOwed } from './clubOwed.js';
import { tableExists } from './db.js';
import { catalogClubs } from './org.js';
import { currentOrganization } from './viewingOrganization.js';

/** Why a Front Office request cannot be answered, as a sentence. */
export class FrontOfficeRefusal extends Error {
  constructor(message: string, readonly status: 404) {
    super(message);
    this.name = 'FrontOfficeRefusal';
  }
}

export const NO_DATA = 'Nothing is imported yet, so there is no report to read.';
export const NO_CLUB = 'No club is chosen, and the save doesn\'t say which club you run. Choose one in Settings.';
export const UNKNOWN_CLUB = 'Pennant doesn\'t know that club in this save.';

/** The club a request names: a team id, or `automatic` (the served resolution: configured, else the human's club). */
export function resolveOrg(param: string): number {
  if (!tableExists('players') || !tableExists('teams')) throw new FrontOfficeRefusal(NO_DATA, 404);
  // The club question still open (N7): the automatic club is not served as if it had been chosen
  const owed = param === 'automatic' ? clubOwed() : null;
  if (owed) throw new FrontOfficeRefusal(owed.text, 404);
  const id = param === 'automatic' ? currentOrganization()?.id ?? null : Number(param);
  if (id === null) throw new FrontOfficeRefusal(NO_CLUB, 404);
  if (!Number.isInteger(id) || id <= 0 || !catalogClubs().some((c) => c.team_id === id)) throw new FrontOfficeRefusal(UNKNOWN_CLUB, 404);
  return id;
}
