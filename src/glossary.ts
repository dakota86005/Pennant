import { glossaryTable } from '../server/presentation/glossary';

/**
 * One definition for every stat, rating, and derived value the app puts on
 * screen, so a column means the same thing on every page.
 *
 * The definitions are the server's (`server/presentation/glossary.ts`), which
 * the Mac app is served too, so the two clients cannot define a term two ways.
 */

const TABLE: Record<string, string> = glossaryTable();

const normalize = (label: string): string => label.trim().replace(/\s+/g, ' ');

/** The definition for a column label, or undefined if there isn't one. */
export function define(label: string): string | undefined {
  const key = normalize(label);
  if (TABLE[key]) return TABLE[key];
  const lower = key.toLowerCase();
  const hit = Object.keys(TABLE).find((k) => k.toLowerCase() === lower);
  return hit ? TABLE[hit] : undefined;
}

/** Every term that has a definition, for the in-app glossary listing. */
export const allTerms = (): Array<{ term: string; definition: string }> =>
  Object.entries(TABLE)
    .map(([term, definition]) => ({ term, definition }))
    .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }));
