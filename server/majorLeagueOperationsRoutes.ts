/**
 * Read-only HTTP boundary for the reactive Major League Operations workspace.
 * The route deliberately exposes the existing domain packets; it does not add
 * a second decision model or make roster changes.
 */

import { Router } from 'express';
import { majorLeagueReactiveNeeds, type MajorLeagueNeed } from './majorLeagueOperations.js';
import { assembleInternalResponders } from './majorLeagueResponders.js';
import { synthesizeMajorLeagueSolutions } from './majorLeagueSolutionSynthesis.js';

export const majorLeagueOperationsRoutes = Router();

export interface MajorLeagueNeedQueueItem extends MajorLeagueNeed {
  responderSummary: {
    activeMlbCount: number;
    minorLeagueCallUpCount: number;
    hasDefensibleInternalSolution: boolean;
  };
}

function organizationId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function queueItem(need: MajorLeagueNeed): MajorLeagueNeedQueueItem {
  const responders = assembleInternalResponders(need);
  const activeMlbCount = responders.activeRosterResponders.length;
  const minorLeagueCallUpCount = responders.minorLeagueCallUpResponders.length;
  return {
    ...need,
    responderSummary: {
      activeMlbCount,
      minorLeagueCallUpCount,
      hasDefensibleInternalSolution: activeMlbCount + minorLeagueCallUpCount > 0,
    },
  };
}

/** Current open reactive needs, with only a compact responder-availability summary for queue scanning. */
majorLeagueOperationsRoutes.get('/mlb-operations/:orgId/needs', (req, res) => {
  const orgId = organizationId(req.params.orgId);
  if (orgId === null) return res.status(400).json({ error: 'A valid organization is required.' });
  const report = majorLeagueReactiveNeeds(orgId);
  return res.json({
    ...report,
    needs: report.needs.map(queueItem),
  });
});

/** One complete, already-synthesized decision packet for an open reactive need. */
majorLeagueOperationsRoutes.get('/mlb-operations/:orgId/needs/:needId/solutions', (req, res) => {
  const orgId = organizationId(req.params.orgId);
  if (orgId === null) return res.status(400).json({ error: 'A valid organization is required.' });
  const report = majorLeagueReactiveNeeds(orgId);
  const need = report.needs.find((item) => item.id === req.params.needId);
  if (!need) {
    return res.status(404).json({
      error: 'This need is not currently open for the selected organization. It may have been resolved by the latest import.',
    });
  }
  return res.json(synthesizeMajorLeagueSolutions(need));
});
