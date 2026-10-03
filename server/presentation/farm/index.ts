/**
 * Farm & Development's views, assembled from one build's reading (N10). Pure: `farmViewsBuild.ts` reads the
 * specialists and hands their answers here.
 */
import type { FarmConsequenceV2 } from '../../farmConsequence.js';
import type { FarmSystemView } from '../../farmOperations.js';
import { affiliatesView } from './affiliates.js';
import { assignmentsView } from './assignments.js';
import { decisionView } from './decision.js';
import { developmentViews } from './development.js';
import type { FarmContext, FarmViewsInput } from './input.js';
import { organizationView } from './organization.js';
import { prospectsView } from './prospects.js';
import type {
  FarmAffiliatesView, FarmAssignmentsView, FarmDecisionView, FarmDevelopmentDetail, FarmDevelopmentView, FarmOrganizationView, FarmProspectsView,
} from './types.js';

/** Every farm view of one build, and the decisions and development details it worked out ahead. */
export interface FarmViews {
  organization: FarmOrganizationView;
  affiliates: FarmAffiliatesView;
  assignments: FarmAssignmentsView;
  prospects: FarmProspectsView;
  development: FarmDevelopmentView;
  developmentDetails: FarmDevelopmentDetail[];
  decisions: FarmDecisionView[];
}

/** One player's Decision, or null when he is not on one of the organization's minor-league clubs. */
export function farmDecision(
  ctx: FarmContext,
  system: FarmSystemView,
  playerId: number,
  consequence: FarmConsequenceV2 | { problem: string } | null,
): FarmDecisionView | null {
  const review = system.assignments.find((a) => a.playerId === playerId);
  return review ? decisionView(ctx, system, review, consequence) : null;
}

export function farmViews(input: FarmViewsInput): FarmViews {
  const { ctx, system } = input;
  const development = developmentViews(ctx, input.scouted.players, input.history, input.rating);
  const decisions: FarmDecisionView[] = [];
  for (const [playerId, consequence] of input.consequences) {
    const view = farmDecision(ctx, system, playerId, consequence);
    if (view) decisions.push(view);
  }
  return {
    organization: organizationView(ctx, system),
    affiliates: affiliatesView(ctx, system, input.majorLeague),
    assignments: assignmentsView(ctx, system),
    prospects: prospectsView(ctx, input.scouted.players, input.prospects, input.rating),
    development: development.view,
    developmentDetails: development.details,
    decisions,
  };
}

export type { FarmContext, FarmViewsInput } from './input.js';
