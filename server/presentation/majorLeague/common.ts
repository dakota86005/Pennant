/**
 * The pieces every Major League Ops view is built from: its head (title, lede, yardsticks), a player, a line, a block,
 * a table row and a decision link, each authored once so the views say the same thing the same way. Pure: it words what
 * it is handed and reads nothing (D-056).
 */
import type { Cell, Certainty, Claim, Target, Tone } from '../../contract/presentation.js';
import type { MlbOverview } from '../../mlbOperations.js';
import { ratingFillOf } from '../../scoutedEvidence.js';
import { basis, cell, claim, row, target } from '../claim.js';
import { sourceOf, type DepartmentContext } from '../frontOffice/desk.js';
import type { MlbAction, MlbBlock, MlbColumn, MlbLine, MlbPlayer, MlbRow, MlbViewHead } from './types.js';
import { sentences, stakesWords } from './words.js';

/** Who answered, in words, for the views' bases. */
export const REVIEW = 'Major League Ops\' roster review';
export const RESPONSES = 'Major League Ops\' responses';

/** What a view is built from: the department's context (its source, the build) and the yardsticks the review used. */
export interface ViewContext {
  ctx: DepartmentContext;
  overview: Pick<MlbOverview, 'yardsticks'>;
}

/** A standing view's context: the whole overview the department answered. */
export interface OverviewContext extends ViewContext {
  overview: MlbOverview;
}

/** A player our club names, opening his organization's club (the nearest view a client opens until player windows). */
export function player(v: ViewContext, playerId: number, name: string): MlbPlayer {
  const open = playerId > 0 ? target({ kind: 'player', playerId, teamId: v.ctx.build.orgId }) : null;
  return { playerId, name: name.trim() || 'Unnamed player', open };
}

/** A line of words, with its chips and the players it names. */
export function line(text: string, opts: { quiet?: boolean; chips?: Cell[]; players?: MlbPlayer[]; tone?: Tone; hint?: string } = {}): MlbLine {
  return {
    // The stakes tier named as these views name it ("development-sensitive"), whoever wrote the sentence
    text: cell(stakesWords(text.trim()), { ...(opts.tone ? { tone: opts.tone } : {}), ...(opts.hint ? { hint: opts.hint } : {}) }),
    quiet: opts.quiet ?? false,
    chips: opts.chips ?? [],
    players: opts.players ?? [],
  };
}

/** Lines from a specialist's sentences (blanks and repeats left out), quiet unless said otherwise. */
export const linesOf = (texts: ReadonlyArray<string | null | undefined>, quiet = true): MlbLine[] => sentences(texts).map((t) => line(t, { quiet }));

/** A titled block of lines. */
export function block(title: string | null, lines: MlbLine[], opts: { claims?: Claim[]; chips?: Cell[]; player?: MlbPlayer | null; collapsed?: boolean } = {}): MlbBlock {
  return {
    title: title ? cell(title) : null,
    player: opts.player ?? null,
    chips: opts.chips ?? [],
    claims: opts.claims ?? [],
    lines,
    collapsed: opts.collapsed ?? false,
  };
}

/** A decision the department can open: a need's id (an observed need, a review's flag or a what-if). */
export const decision = (needId: string): Target => target({ kind: 'decision', department: 'majorLeague', key: needId });

/** Another Major League Ops view. */
export const view = (id: string): Target => target({ kind: 'view', department: 'majorLeague', view: id });

export const action = (text: string, open: Target): MlbAction => ({ text: cell(text), open });

/** How the review's lines are called: fitted on this save when every yardstick is the league's own, else starting values. */
export function reviewCertainty(overview: Pick<MlbOverview, 'yardsticks'>): { certainty: Certainty; stamp: string } {
  const groups = overview.yardsticks.groups;
  const fitted = groups.length > 0 && groups.every((g) => g.source === 'save');
  return { certainty: fitted ? 'calibrated' : 'provisional', stamp: overview.yardsticks.line };
}

/** A claim about the review: its words, its evidence lines, what is not known and what would change it. */
export function reviewClaim(
  v: ViewContext,
  text: string,
  input: { tone?: Tone; hint?: string; because: Array<{ label: string; value: string }>; unknown?: string[]; wouldChange?: string[]; links?: Target[]; specialist?: string },
) {
  const because = input.because
    .map((l) => ({ label: l.label.trim(), value: l.value.trim() }))
    .filter((l) => l.label && l.value);
  return claim({
    text: text.trim(),
    tone: input.tone ?? 'neutral',
    ...(input.hint ? { hint: input.hint } : {}),
    links: input.links ?? [],
    basis: basis({
      because: because.length ? because : [{ label: 'Read by', value: input.specialist ?? REVIEW }],
      source: sourceOf(v.ctx, input.specialist ?? REVIEW),
      unknown: sentences(input.unknown ?? []),
      wouldChange: sentences(input.wouldChange ?? []),
      lean: null,
      ...reviewCertainty(v.overview),
    }),
  });
}

/** Lines of explanation as a claim's evidence (each sentence its own line, under one label). */
export const because = (label: string, texts: ReadonlyArray<string | null | undefined>) => sentences(texts).map((value) => ({ label, value }));

/** The head every view carries: its build, title, one-line lede (the full explanation in its basis) and the yardsticks. */
export function head(v: ViewContext, title: string, lede: { text: string; full: string }): MlbViewHead {
  const y = v.overview.yardsticks;
  return {
    orgId: v.ctx.build.orgId,
    importStamp: v.ctx.build.importStamp,
    reportStamp: v.ctx.build.reportStamp,
    title: cell(title),
    lede: claim({
      text: lede.text,
      tone: 'neutral',
      links: [],
      basis: basis({
        because: [{ label: 'How to read it', value: lede.full }],
        source: sourceOf(v.ctx, REVIEW),
        unknown: [],
        wouldChange: [],
        lean: null,
        certainty: 'policy',
        stamp: 'How Major League Ops reads its roster: stated, not fitted',
      }),
    }),
    yardsticks: y.line.trim()
      ? claim({
        text: y.line.trim(),
        tone: 'neutral',
        links: [],
        basis: basis({
          because: because('Where the lines come from', y.tip.split(/(?<=\.)\s+/)),
          source: sourceOf(v.ctx, REVIEW),
          unknown: [],
          wouldChange: ['A new import refits them on the league\'s own seasons where it can.'],
          lean: null,
          ...reviewCertainty(v.overview),
        }),
      })
      : null,
  };
}

/** A table row: its cells and sort keys (the same columns in both), the player it is about, its detail and actions. */
export function tableRow(
  id: string,
  cells: Record<string, Cell>,
  sort: Record<string, number | string | null>,
  extra: { player?: MlbPlayer | null; detail?: MlbBlock[]; actions?: MlbAction[]; claim?: Claim; ratingsFill?: Cell | null; players?: MlbPlayer[] } = {},
): MlbRow {
  const base = row(id, cells, sort, extra.claim);
  return {
    ...base, player: extra.player ?? null, detail: extra.detail ?? [], actions: extra.actions ?? [],
    ...(extra.ratingsFill ? { ratingsFill: extra.ratingsFill } : {}),
    ...(extra.players?.length ? { players: extra.players } : {}),
  };
}

/** A column. */
export const column = (id: string, title: string, numeric = false): MlbColumn => ({ id, title: cell(title), numeric });

/** A number's cell: its words, or the sentence for an unknown (never a zero), with its tone. */
export function numberCell(display: string | null, unknown: string, extra: { tone?: Tone; hint?: string } = {}): Cell {
  return display === null ? cell(unknown, { tone: 'unknown', ...(extra.hint ? { hint: extra.hint } : {}) }) : cell(display, extra);
}

/** The mark a row carries beside his grades when they are OSA's view filling in for our scouts (N11), or null. */
export function fillMark(playerId: number): Cell | null {
  const fill = ratingFillOf(playerId);
  return fill ? cell(fill.mark, { hint: fill.hint }) : null;
}

/**
 * A row whose grades are OSA's view filling in for our scouts (D-067): every cell that rests on his grades carries the
 * sentence in its hint, and his detail opens with it as a quiet line, so the Mac can draw the mark ("OSA") beside them.
 * Nothing changes for a player our scouts rate.
 */
export function markFill(playerId: number, cells: Record<string, Cell>, ratingKeys: readonly string[], detail: MlbBlock[]): MlbBlock[] {
  const note = ratingFillOf(playerId)?.hint ?? null;
  if (!note) return detail;
  for (const k of ratingKeys) {
    const c = cells[k];
    if (c) cells[k] = { ...c, hint: c.hint ? `${c.hint}. ${note}` : note };
  }
  const [first, ...rest] = detail;
  return first ? [{ ...first, lines: [line(note, { quiet: true }), ...first.lines] }, ...rest] : [block(null, [line(note, { quiet: true })])];
}
