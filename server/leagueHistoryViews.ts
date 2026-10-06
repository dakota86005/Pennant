/**
 * League Office's Org Comparison and Franchise History (N12 Track B, D-072), read: each reads what the React page's
 * route computes, through its extracted module (`computeOrgComparison`, `computeFranchise`, `computeTenure`), and hands
 * it to the pure adapters in `presentation/league/`. Run in the Front Office's worker (`leagueViewsBuild.ts`), once per
 * import, and served from the cache.
 *
 * Franchise History is one read of the club's record and one batched read of names, however long the history (a league
 * from 1930 has 85 seasons and more); the GM's own seasons are one read each of the manager's history and one batched
 * read of names. Org Comparison is Player Value's, as each player is served (D-052): it reads nothing of its own beyond
 * how Player Value's figures are called on this save (its own fit, or the starting numbers: D-041, D-053).
 */
import type { Certainty } from './contract/presentation.js';
import { getDataStatus } from './dataStatus.js';
import { computeFranchise, computeOrgComparison, franchiseRecordsCarry, franchiseResultYears } from './franchise.js';
import { computeTenure } from './gameplan.js';
import { catalogClubs } from './org.js';
import { marketLeagueOfClub, productionModelFor } from './playerValue.js';
import type { OfficeContext } from './presentation/league/common.js';
import { franchiseUnreadView, franchiseView } from './presentation/league/franchise.js';
import { orgComparisonUnreadView, orgComparisonView } from './presentation/league/orgComparison.js';
import type { LeagueFranchiseView, LeagueOrgComparisonView } from './presentation/league/types.js';

/** The club's name as the catalog labels it; null when the export names none. */
const clubName = (orgId: number): string | null => catalogClubs().find((c) => c.team_id === orgId)?.label ?? null;

/** How Player Value's production is called for the club's league: the save's own fit, or the starting numbers. */
function valueCalled(orgId: number): { how: Certainty; stamp: string } {
  const league = marketLeagueOfClub(orgId);
  if (league === null) return { how: 'provisional', stamp: 'Player Value: the starting numbers, not yet fitted on this save' };
  const stamp = productionModelFor(league).provenance.stamp;
  return { how: stamp.status, stamp: (stamp.run ?? stamp.basis).trim() || 'Player Value' };
}

export function orgComparisonViewOf(v: OfficeContext, orgId: number): LeagueOrgComparisonView {
  let comparison: ReturnType<typeof computeOrgComparison> | string;
  try {
    comparison = computeOrgComparison(orgId, getDataStatus({ importedAt: v.ctx.build.importStamp }));
  } catch (err) {
    // The route's refusals (an unknown club, a season the export doesn't state), said in words
    comparison = (err as Error).message;
  }
  return orgComparisonView(v, { comparison, valueCalled: valueCalled(orgId) });
}

export function orgComparisonUnread(v: OfficeContext, why: string): LeagueOrgComparisonView {
  return orgComparisonUnreadView(v, why);
}

export function franchiseViewOf(v: OfficeContext, orgId: number): LeagueFranchiseView {
  const computed = computeFranchise(orgId);
  const tenure = computeTenure(orgId);
  return franchiseView(v, {
    orgId,
    clubName: clubName(orgId),
    history: computed.ok ? computed.body : computed.error,
    carry: franchiseRecordsCarry(),
    resultYears: franchiseResultYears(orgId),
    tenure: tenure.ok ? tenure.body : null,
  });
}

export function franchiseUnread(v: OfficeContext, why: string): LeagueFranchiseView {
  return franchiseUnreadView(v, v.ctx.build.orgId, v.ctx.build.club, why);
}
