/**
 * The tools model's tuning in force for a league (D-053, cycle 4): one reader, so MLB Operations' roster review and the Lineup page read
 * the same slopes for a league. The starting values (`TOOLS_PRIOR`) serve until a save's own ratings, stored before a season, are
 * clearly better at forecasting it (`mlbToolsFit.ts`, `tools-1`); on a save whose ratings have never been stored before a season they
 * cannot be checked, and the starting values say so.
 */

import { TOOLS_PRIOR, type ToolsParams } from './toolsModel.js';

/** The tools params in force for a league (the starting values where the league's own are not in force). */
export function toolsParamsFor(_leagueId: number | null): ToolsParams {
  return TOOLS_PRIOR;
}
