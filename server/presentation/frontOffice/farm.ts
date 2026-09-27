/**
 * Farm & Development on the desk: Minor League Operations' own attention list (`FarmSystemView.attention`, "the one list
 * that answers what needs my attention"), with its scale passed unchanged (`severity.ts`) and its own words as the
 * headline. The count is the workspace's: every item on that list, no more and no fewer.
 *
 * The same kind of finding about the same subject at several positions is one row listing the positions (the grouping
 * rule, `GROUPING_RULE`), so a thin farm does not fill the desk with one sentence repeated; each finding is in the row's
 * basis. The farm's items carry no id (V2 plan R6), so a row's key is its kind and subject (and, for a finding about no
 * position, a mark of its headline without its numbers): stable for one import.
 */
import type { Certainty } from '../../contract/presentation.js';
import type { FarmSystemView } from '../../farmOperations.js';
import { basis, cell, claim, servedValue, target } from '../claim.js';
import { farmSeverity } from '../severity.js';
import { item, sourceOf, type DepartmentContext, type DepartmentMaterial } from './desk.js';

/** What the Front Office reads from Minor League Operations. */
export type FarmInput = Pick<FarmSystemView, 'organization' | 'affiliates' | 'attention' | 'calibration' | 'unknowns'>;

const SPECIALIST = 'Minor League Operations';

/** The grouping rule, stated where a grouped row's basis names its line. */
export const GROUPING_RULE = 'The same kind of finding about the same club or the organization, at the same urgency, is one row listing its positions';
const TONE = { critical: 'bad', attention: 'caution', noted: 'neutral' } as const;
const KIND_WORDS: Record<FarmInput['attention'][number]['kind'], string> = {
  assignment: 'A player\'s assignment',
  affiliate: 'An affiliate',
  organization: 'The whole system',
  retention: 'Keeping a roster spot',
};

/** How the farm's lines are called: provisional when any line it used is, else policy (MINOR_LEAGUE_OPERATIONS.md Part 7). */
function linesCalled(view: FarmInput): { certainty: Certainty; stamp: string } {
  const provisional = view.calibration.filter((c) => c.status === 'provisional').length;
  return {
    certainty: provisional > 0 ? 'provisional' : 'policy',
    stamp: provisional > 0
      ? `The farm's stated lines, ${provisional} of ${view.calibration.length} still starting values`
      : `The farm's stated lines (${view.calibration.length})`,
  };
}

const subjectKey = (t: FarmInput['attention'][number]['target']): string =>
  t.kind === 'player' ? `player:${t.playerId}` : t.kind === 'affiliate' ? `affiliate:${t.teamId}` : 'organization';

/**
 * A short, stable mark for what an item is about: its headline with the numbers taken out (so "0 players" and "1 player"
 * are the same problem), hashed (FNV-1a). Two items on one subject stay apart; a count moving keeps the key.
 */
function mark(headline: string): string {
  let h = 0x811c9dc5;
  for (const ch of headline.replace(/\d+/g, '#').toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

type Attention = FarmInput['attention'][number];

/** "2B, C and SS" (and) or "2B, C or SS" (or). */
function positionList(positions: readonly string[], joiner: 'and' | 'or'): string {
  if (positions.length <= 1) return positions.join('');
  return `${positions.slice(0, -1).join(', ')} ${joiner} ${positions[positions.length - 1]}`;
}

/**
 * The headline of a group: the same kind of finding about the same subject at several positions, in one line. The
 * farm's own sentence for one position; for several, the positions listed (the grouping rule, stated in the basis).
 */
function groupText(members: readonly Attention[], club: string | null): string {
  const first = members[0];
  if (members.length === 1) return first.headline.trim();
  const positions = members.map((m) => m.position!).filter(Boolean);
  const at = club ? `${club}: ` : '';
  if (first.kind === 'organization' && first.severity === 'critical') {
    return `The major-league club is thin at ${positionList(positions, 'and')}, with little in the upper minors to step in.`;
  }
  if (first.kind === 'organization') return `Little depth in the upper minors at ${positionList(positions, 'and')}.`;
  if (first.code === 'position_uncovered') return `${at}Nobody on the roster covers ${positionList(positions, 'or')}.`;
  if (first.code === 'position_single_cover') return `${at}Only one man covers each of ${positionList(positions, 'and')}; a day off or an injury leaves a hole.`;
  return `${first.headline.trim()} (and ${members.length - 1} more like it)`;
}

/** Farm & Development's items, key figures and unknowns. */
export function farmMaterial(ctx: DepartmentContext, view: FarmInput): DepartmentMaterial {
  const called = linesCalled(view);
  // The grouping rule: the same kind of finding about the same subject, at the same severity, is one row listing its
  // positions; everything else is a row of its own. Stable, in the farm's own order.
  const groups = new Map<string, Attention[]>();
  for (const a of view.attention) {
    const key = a.position !== null
      ? `${a.code}:${subjectKey(a.target)}:${a.severity}`
      : `${a.code}:${subjectKey(a.target)}:${mark(a.headline)}`;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  const seen = new Map<string, number>();
  const items = [...groups.entries()].map(([groupKey, members]) => {
    const a = members[0];
    const n = (seen.get(groupKey) ?? 0) + 1;
    seen.set(groupKey, n);
    const severity = farmSeverity(a);
    const club = a.target.kind === 'affiliate' ? view.affiliates.find((x) => x.teamId === (a.target as { teamId: number }).teamId)?.label ?? null : null;
    // A reason adds to the line only for a player's assignment or roster spot; a finding's first evidence restates it
    const detail = a.kind === 'assignment' || a.kind === 'retention' ? a.detail.trim() : '';
    const link = a.target.kind === 'player'
      ? target({ kind: 'player', playerId: a.target.playerId })
      : a.target.kind === 'affiliate'
        ? target({ kind: 'club', teamId: a.target.teamId })
        : target({ kind: 'view', department: 'farm', view: 'organization' });
    const because = members.length > 1
      ? members.map((m) => ({ label: m.position ?? KIND_WORDS[m.kind], value: m.headline.trim() }))
      : [{ label: 'About', value: KIND_WORDS[a.kind] }, ...(a.detail.trim() ? [{ label: 'Why', value: a.detail.trim() }] : [])];
    const headline = claim({
      text: groupText(members, club),
      tone: TONE[severity.severity],
      hint: members.length > 1 ? `${members.length} findings, one row: each is in the breakdown` : undefined,
      links: [link],
      basis: basis({
        because,
        source: sourceOf(ctx, SPECIALIST),
        unknown: [],
        wouldChange: [],
        lean: null,
        ...called,
        stamp: members.length > 1 ? `${called.stamp}. ${GROUPING_RULE}` : called.stamp,
      }),
    });
    return item(ctx, {
      key: `farm:${groupKey}${n === 1 ? '' : `:${n}`}`,
      severity,
      shading: [],
      headline,
      detail: detail ? cell(detail) : null,
      count: members.length,
    });
  });

  const scope = view.organization.scope;
  const struggling = view.affiliates.filter((a) => a.operational.status !== 'healthy').length;
  const fact = (because: Array<{ label: string; value: string }>, unknown: string[] = []) =>
    basis({ because, source: sourceOf(ctx, SPECIALIST), unknown, wouldChange: [], lean: null, certainty: 'fact' });
  const figures = [
    claim({
      text: 'Players in the system',
      tone: 'neutral',
      value: servedValue(scope.players, 'count', String(scope.players)),
      basis: fact([
        { label: 'Players', value: String(scope.players) },
        { label: 'Read by Player Development', value: String(scope.assessed) },
        { label: 'Too little to read yet', value: String(scope.notAssessable) },
      ]),
    }),
    claim({
      text: 'Affiliates',
      tone: struggling > 0 ? 'caution' : 'neutral',
      value: servedValue(view.affiliates.length, 'count', String(view.affiliates.length)),
      hint: struggling > 0 ? `${struggling} short of what the club needs to play` : undefined,
      basis: fact(view.affiliates.map((a) => ({ label: `${a.label} (${a.levelName})`, value: a.operational.status === 'healthy' ? 'Can field its team' : a.operational.status === 'thin' ? 'Thin' : 'Short' }))
        .concat(view.affiliates.length ? [] : [{ label: 'Affiliates', value: 'None in the export' }])),
    }),
    claim({
      text: 'Players we have a read on',
      tone: 'neutral',
      value: servedValue(scope.assessed, 'count', `${scope.assessed} of ${scope.players}`),
      basis: fact(
        [{ label: 'Read', value: String(scope.assessed) }, { label: 'Players', value: String(scope.players) }],
        scope.players > scope.assessed ? [`${scope.players - scope.assessed} players could not be read on the evidence there is.`] : [],
      ),
    }),
  ];
  return { specialist: SPECIALIST, items, figures, unknowns: [...view.unknowns] };
}
