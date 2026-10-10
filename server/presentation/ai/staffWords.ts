/**
 * The Staff room's one rule of address and its short titles (N13 review L1), read by the server (the Mac app's Staff room,
 * and `POST /api/chat` when the page names nobody) and by the React chat (`src/Chat.tsx`), so the two apps cannot drift.
 * Pure: no server module, so the React bundle can import it (as it does `glossary.ts` and `statCatalog.ts`).
 */

export const ROOM_ID = 'room';

/** Someone who can be asked, as both apps list them. */
export interface StaffMemberRef { id: string; name: string; role: string }

/**
 * Short titles for the tabs. The full role reads well in a sentence but not in a strip of five, and a name on its own is
 * no help to anyone who does not already know who Drew Toussaint is. The general manager is deliberately not here: his
 * title depends on the save, so anything unnamed falls back to its role, capitalised to sit beside the rest.
 */
export const ROLE_LABEL: Readonly<Record<string, string>> = {
  room: 'Group chat',
  analyst: 'Analyst',
  manager: 'Manager',
  pitching: 'Pitching Coach',
  hitting: 'Hitting Coach',
  trainer: 'Trainer',
  scout: 'Scout',
  owner: 'Owner',
};

/** The short title under a name. */
export const roleLabel = (p: { id: string; role: string }): string =>
  ROLE_LABEL[p.id] ?? p.role.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Who a message in the room is aimed at, when it is aimed at anybody.
 *
 * Typing "Hal what do you think about Austin Riley?" into a room of three got three answers, two of which were "I'm not
 * Hal". A name at the start of the message, or anywhere with an @ in front of it, sends the question to that man alone.
 * Only those two positions count: matching a name anywhere would catch every mention of a colleague inside an ordinary
 * question. Null when nobody, or more than one person, matches.
 */
export function addressedIn<T extends StaffMemberRef>(text: string, people: readonly T[]): T | null {
  const hit = new Set<string>();
  for (const p of people) {
    if (p.id === ROOM_ID) continue;
    const parts = p.name.split(/\s+/);
    for (const form of [p.name, parts[0], parts[parts.length - 1]]) {
      if (!form || form.length < 2) continue;
      const safe = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`^\\s*@?${safe}\\b`, 'i').test(text) || new RegExp(`@${safe}\\b`, 'i').test(text)) hit.add(p.id);
    }
  }
  return hit.size === 1 ? (people.find((p) => p.id === [...hit][0]) ?? null) : null;
}
