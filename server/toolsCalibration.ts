/**
 * The tools model's tuning in force for a league (D-053, cycle 4): one reader, so MLB Operations' roster review and the Lineup page read
 * the same slopes for a league. The starting values (`TOOLS_PRIOR`) serve until a save's own ratings, stored before a season, are
 * clearly better at forecasting it (`mlbToolsFit.ts`, `tools-1`, judged by the detector); on a save whose ratings have never been stored
 * before a season they cannot be checked, and the starting values serve with that reason (the roster review's yardsticks say it).
 *
 * Never through a season the league has not completed (a reverted save), like every per-save fit.
 */

import { calibrated } from './calibration.js';
import { adoptedCalibration } from './saveCalibrationStore.js';
import { completedThrough } from './saveIdentity.js';
import { MLB_CALIBRATION_SUBSYSTEM } from './mlbCalibrationFit.js';
import { TOOLS_METHOD, type ToolsModel } from './mlbToolsFit.js';
import { HITTER_TOOL_SLOPES, TOOLS_PRIOR, type ToolsParams } from './toolsModel.js';

/** The adopted tools fit in force for a league, or null (none, or none through a season the league has completed). */
export function toolsFitInForce(leagueId: number | null): { model: ToolsModel; basis: string } | null {
  if (leagueId === null) return null;
  try {
    const through = completedThrough(leagueId).season;
    const adopted = adoptedCalibration<ToolsModel>(leagueId, MLB_CALIBRATION_SUBSYSTEM, 'tools', TOOLS_METHOD, { throughMax: through ?? -1 });
    return adopted?.model ? { model: adopted.model, basis: adopted.basis } : null;
  } catch {
    return null;
  }
}

/** The tools params in force for a league: the league's own bat slopes where they serve, else the starting values. */
export function toolsParamsFor(leagueId: number | null): ToolsParams {
  const fit = toolsFitInForce(leagueId);
  if (!fit || fit.model.bat.source !== 'save') return TOOLS_PRIOR;
  const keys = Object.keys(HITTER_TOOL_SLOPES) as Array<keyof typeof HITTER_TOOL_SLOPES>;
  const slopes = Object.fromEntries(keys.map((k, i) => [k, fit.model.bat.served[i]])) as Record<keyof typeof HITTER_TOOL_SLOPES, number>;
  return {
    slopes, running: TOOLS_PRIOR.running, source: 'save',
    stamp: { ...calibrated('The save\'s own bat slopes: clearly better than the starting slopes at forecasting its forward seasons (ratings stored before a season against that season); the running slopes are the starting values.'), run: `save_calibration_fits ${TOOLS_METHOD} through ${fit.basis}` },
  };
}

/** The hitters' tools weight in force (`ResultsParams.toolsWeight.hitter`): the league's own where it serves, else the starting 1. */
export function hitterToolsWeightFor(leagueId: number | null): number {
  const fit = toolsFitInForce(leagueId);
  return fit && fit.model.blend.source === 'save' ? Math.max(1, fit.model.blend.served) : 1;
}
