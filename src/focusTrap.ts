/**
 * Keeping keyboard focus inside a dialog (the player card, S-01). The choice of where Tab goes is a
 * pure function, tested without a browser (tests/playerCard.test.ts); the dialog supplies the list of
 * focusable elements and moves focus where it says.
 */

/** Elements a keyboard can reach, in document order. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab (or Shift+Tab) should send focus to keep it inside the dialog: the first element after the
 * last (and the last before the first), and back inside when focus has escaped. Null where the browser's
 * own move stays inside, or there is nothing to focus.
 */
export function focusTrapTarget<T>(items: readonly T[], current: T | null, backwards: boolean): T | null {
  if (items.length === 0) return null;
  const at = current === null ? -1 : items.indexOf(current);
  if (at === -1) return backwards ? items[items.length - 1] : items[0];
  if (!backwards && at === items.length - 1) return items[0];
  if (backwards && at === 0) return items[items.length - 1];
  return null;
}

/** The focusable elements inside a dialog that are rendered (a hidden one cannot take focus). */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}
