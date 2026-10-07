/**
 * OSA's view filling in for our scouts (D-067), as the clubhouse tools say it: the same way N8's views do. Every cell
 * that rests on his grades carries the sentence in its hint (the sentence alone where both would not fit a help tag),
 * and his detail opens with it as a quiet line, so the Mac can draw the mark beside them. Nothing changes for a player
 * our scouts rate.
 */
import type { Cell } from '../../contract/presentation.js';
import { cell } from '../claim.js';
import { block, line } from '../majorLeague/common.js';
import type { MlbBlock } from '../majorLeague/types.js';

/** The per-player mark and its sentence (`ratingFillOf`), or null for a player our scouts rate. */
export type RatingFill = { mark: string; hint: string } | null;

/**
 * The mark a row or an entry carries beside his grades (`ratingsFill`, N11), as N8's rows carry it, so the Mac draws it
 * with the sentence as its help tag and VoiceOver label; null for a player our scouts rate.
 */
export function fillMark(fill: RatingFill): Cell | null {
  return fill ? cell(fill.mark, { hint: fill.hint }) : null;
}

/** A cell resting on his grades, with the fill's sentence in its hint. */
export function fillHint(c: Cell, fill: RatingFill): Cell {
  if (!fill) return c;
  const joined = c.hint ? `${c.hint}. ${fill.hint}` : fill.hint;
  return { ...c, hint: joined.length <= 75 ? joined : fill.hint };
}

/** Marks the cells resting on his grades and opens his detail with the fill's sentence; the detail as it was otherwise. */
export function withFill(fill: RatingFill, cells: Record<string, Cell>, keys: readonly string[], detail: MlbBlock[]): MlbBlock[] {
  if (!fill) return detail;
  for (const k of keys) if (cells[k]) cells[k] = fillHint(cells[k], fill);
  const note = line(fill.hint, { quiet: true });
  const [first, ...rest] = detail;
  return first ? [{ ...first, lines: [note, ...first.lines] }, ...rest] : [block(null, [note])];
}
