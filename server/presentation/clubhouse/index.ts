/**
 * Major League Ops' clubhouse tools (N9, D-069): the adapters, one per view. Pure: each words what the reader
 * (`clubhouseViewsBuild.ts`) hands it, and reads nothing.
 */
export { depthChartView, type DepthInput } from './depth.js';
export { fortyManView, type FortyManInput } from './fortyMan.js';
export { lineupView, type LineupInput } from './lineup.js';
export { pitchingAvailabilityView, type PitchingInput } from './pitching.js';
export { rostersView, type RostersInput } from './rosters.js';
export { gamePlanView, gameRowId, scheduleView, type GamePlanInput, type ScheduleInput } from './schedule.js';
export { seasonTrendsView, type TrendsInput } from './trends.js';
export type { ClubhouseContext } from './common.js';
export type { RatingFill } from './fill.js';
