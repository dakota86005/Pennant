/**
 * Farm & Development on the desk: Minor League Operations' own attention list (`FarmSystemView.attention`, "the one list
 * that answers what needs my attention"), with its scale passed unchanged (`severity.ts`) and its own words as the
 * headline. The count is the workspace's: every item on that list, no more and no fewer.
 *
 * The farm's items carry no id (V2 plan R6), so the key is the item's kind, its subject and a mark of what it says (its
 * headline without its numbers): stable for one import, and kept when only a count in it moves.
 */
import type { Certainty } from '../../contract/presentation.js';
import type { FarmSystemView } from '../../farmOperations.js';
import { basis, cell, claim, servedValue, target } from '../claim.js';
import { farmSeverity } from '../severity.js';
import { item, sourceOf, type DepartmentContext, type DepartmentMaterial } from './desk.js';

/** What the Front Office reads from Minor League Operations. */
export type FarmInput = Pick<FarmSystemView, 'organization' | 'affiliates' | 'attention' | 'calibration' | 'unknowns'>;

const SPECIALIST = 'Minor League Operations';
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

/** Farm & Development's items, key figures and unknowns. */
export function farmMaterial(ctx: DepartmentContext, view: FarmInput): DepartmentMaterial {
  const called = linesCalled(view);
  const seen = new Map<string, number>();
  const items = view.attention.map((a) => {
    const subject = `${a.kind}:${subjectKey(a.target)}:${mark(a.headline)}`;
    const n = (seen.get(subject) ?? 0) + 1;
    seen.set(subject, n);
    const severity = farmSeverity(a);
    const detail = a.detail.trim();
    const link = a.target.kind === 'player'
      ? target({ kind: 'player', playerId: a.target.playerId })
      : a.target.kind === 'affiliate'
        ? target({ kind: 'club', teamId: a.target.teamId })
        : target({ kind: 'view', department: 'farm', view: 'organization' });
    const headline = claim({
      text: a.headline.trim(),
      tone: TONE[severity.severity],
      links: [link],
      basis: basis({
        because: [{ label: 'About', value: KIND_WORDS[a.kind] }, ...(detail ? [{ label: 'Why', value: detail }] : [])],
        source: sourceOf(ctx, SPECIALIST),
        unknown: [],
        wouldChange: [],
        lean: null,
        ...called,
      }),
    });
    return item(ctx, {
      key: n === 1 ? `farm:${subject}` : `farm:${subject}:${n}`,
      severity,
      shading: [],
      headline,
      detail: detail ? cell(detail) : null,
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
      text: 'Assignments read',
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
