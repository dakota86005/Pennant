import { db, tableExists } from './db.js';
import type { Integer } from './contract/primitives.js';
import { loadSettings } from './settings.js';

/**
 * Whose organization a view is about (AGENTS.md: resolve the configured organization, then the human-managed OOTP
 * organization). One resolver for the server and every client: the player card's "our view", the trade desk, and the
 * Mac app's current club (served on `GET /api/settings`), so no client re-implements the rule.
 */
export type ViewingSource = 'requested' | 'configured' | 'human';

/** The organization whose view this is, and how it was found; null when none can be. */
export function viewingOrganization(requested: unknown): { id: number; source: ViewingSource } | null {
  const asked = Number(requested);
  if (requested !== undefined && requested !== '' && Number.isInteger(asked) && asked > 0) return { id: asked, source: 'requested' };
  const configured = loadSettings().defaultOrgId;
  if (typeof configured === 'number' && configured > 0) return { id: configured, source: 'configured' };
  const human = humanClubs()[0];
  return human === undefined ? null : { id: human, source: 'human' };
}

/**
 * The clubs the save's human manages, in a stable order (team id), so "the human-managed club" is the same club every
 * time: the first of them. A save can have several (one GM running two clubs); none is chosen by accident of row order.
 */
export function humanClubs(): number[] {
  if (!tableExists('teams')) return [];
  try {
    return (db.prepare(`SELECT team_id FROM teams WHERE human_team = 1 ORDER BY team_id`).all() as Array<{ team_id: number }>)
      .map((r) => r.team_id);
  } catch {
    return [];
  }
}

/**
 * The club the app is about when nothing names one: the configured organization, else the one the save's human
 * manages; null when neither is known. A configured id is taken as configured even when the club list no longer has it
 * (the server's rule for every view), so a client shows that club as not found rather than quietly switching clubs.
 */
export interface CurrentOrganization {
  id: Integer;
  source: 'configured' | 'human';
  /** How many clubs the save's human manages (automatic follows the first, by team id). */
  humanClubs: Integer;
  /** When automatic had to pick among several human clubs, which one it follows and why, in a sentence; else null. */
  note: string | null;
}

export function currentOrganization(): CurrentOrganization | null {
  const found = viewingOrganization(undefined);
  if (!found || found.source === 'requested') return null;
  const human = humanClubs();
  const note = found.source === 'human' && human.length > 1
    ? `You manage ${human.length} clubs in this save. Pennant follows ${clubName(found.id)}; choose another in Settings.`
    : null;
  return { id: found.id, source: found.source, humanClubs: human.length, note };
}

function clubName(teamId: number): string {
  try {
    const row = db.prepare(`SELECT name, nickname FROM teams WHERE team_id = ?`).get(teamId) as { name?: string; nickname?: string } | undefined;
    if (row?.name) return row.nickname && row.nickname !== row.name ? `${row.name} ${row.nickname}` : row.name;
  } catch {
    // An export without the nickname column still has the club; it is named by the fallback below
  }
  return 'the first of them';
}
