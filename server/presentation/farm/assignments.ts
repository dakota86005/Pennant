/**
 * Farm & Development ▸ Assignments (N10; React's Assignments view): every minor leaguer's assignment and what the
 * organization makes of it. Most rows say the assignment is defensible, and that is the point: the farm is not a
 * promotion leaderboard (D-044). The stated order is whether the GM needs to look, then name; each column sorts by a
 * served key, except developmental stakes, which has none (D-050: a tier is never a rank).
 */
import type { FarmSystemView } from '../../farmOperations.js';
import { cell, row } from '../claim.js';
import { decisionTarget, headOf } from './common.js';
import type { FarmContext } from './input.js';
import type { FarmAssignmentRow, FarmAssignmentsView } from './types.js';
import { ATTENTION_ORDER, conclusionWord, opportunityWord, ordinal, plain, standingWord, tierWord, windowWord } from './words.js';

type Review = FarmSystemView['assignments'][number];

/** The farm's stated order of conclusions, so like sorts with like (the attention order's own, then the rest). */
const CONCLUSION_ORDER = [
  'organizational_blockage', 'opportunity_conflict', 'demotion_direction_defensible', 'promotion_direction_defensible',
  'organizational_question', 'indeterminate', 'current_assignment_defensible', 'not_assessable',
];

/** Like with like: the level's reading from clearly ahead to clearly behind, the work from regular to none; unknown last. */
const STANDING_ORDER: Record<string, number> = { mastered: 0, holding: 1, overmatched: 2 };
const WORK_ORDER: Record<string, number> = { regular_work: 0, shared_work: 1, bat_only: 2, insufficient_work: 3, not_playing: 4 };

export function assignmentRow(a: Review): FarmAssignmentRow {
  const conclusion = conclusionWord(a.conclusion);
  const work = opportunityWord(a.opportunity.verdict);
  const results = a.production.percentile !== null
    ? cell(`${ordinal(a.production.percentile)} in the ${a.production.leagueName}`, { hint: 'His results against the league, park-adjusted: 50th is the middle' })
    : cell(plain(a.production.unassessableDetail ?? '') || 'Not established', { tone: 'unknown' });
  const stakesHint = a.protection.reasons.length ? plain(a.protection.reasons[0]) : undefined;
  return {
    ...row(
      `assignment:${a.playerId}`,
      {
        player: cell(a.name),
        age: cell(String(a.age)),
        club: cell(`${a.levelName} · ${a.team}`),
        level: cell(`${standingWord(a.current.standing)} · ${windowWord(a.current.window)}`),
        results,
        work: cell(work.text, { tone: work.tone }),
        stakes: cell(tierWord(a.protection.tier), {
          tone: a.protection.tier === null ? 'unknown' : 'neutral',
          hint: stakesHint && stakesHint.length <= 75 ? stakesHint : 'How careful to be with his development; not where he plays',
        }),
        conclusion: cell(conclusion.text, { tone: conclusion.tone }),
      },
      {
        player: a.name,
        age: a.age,
        club: `${String(a.level).padStart(2, '0')} ${a.team}`,
        level: STANDING_ORDER[a.current.standing] ?? null,
        results: a.production.percentile,
        work: WORK_ORDER[a.opportunity.verdict] ?? null,
        // Developmental stakes are never a sort key (D-050)
        stakes: null,
        conclusion: (ATTENTION_ORDER[a.attention] ?? 3) * 100 + Math.max(0, CONCLUSION_ORDER.indexOf(a.conclusion)),
      },
    ),
    playerId: a.playerId,
    teamId: a.teamId,
    levelId: String(a.level),
    inQuestion: a.attention !== 'routine',
    open: decisionTarget(a.playerId),
  };
}

export function assignmentsView(ctx: FarmContext, system: FarmSystemView): FarmAssignmentsView {
  const ordered = [...system.assignments].sort(
    (x, y) => (ATTENTION_ORDER[x.attention] ?? 3) - (ATTENTION_ORDER[y.attention] ?? 3) || x.name.localeCompare(y.name),
  );
  const levels = [...new Map(ordered.map((a) => [a.level, a.levelName])).entries()].sort((x, y) => x[0] - y[0]).map(([id, name]) => ({ id: String(id), name }));
  return {
    ...headOf(ctx),
    note: cell('Player Development says whether the level is developing him; Minor League Operations says whether he can get the work there. Both are shown, with who said what.'),
    order: cell('Whether you need to look, then by name', { hint: 'Needs attention, then worth a look, then routine' }),
    levels,
    rows: ordered.map(assignmentRow),
    emptyInQuestion: cell('No assignment is in question here. Every one Player Development could read is defensible, and nobody is short of work.'),
    emptyAll: cell('No players.'),
  };
}
