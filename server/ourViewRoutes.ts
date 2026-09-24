import { Router } from 'express';
import { db, tableExists } from './db.js';
import { getDataStatus } from './dataStatus.js';
import { resolvePhilosophy } from './philosophy.js';
import { clubWinValue, lensPhilosophyFrom, playerOurView } from './playerValue.js';
import { loadSettings, philosophyForOrg } from './settings.js';

/**
 * "Our view" of a player's value (Player Value phase 5b, PLAYER_VALUE.md Part 6) and the viewing club's value of a win
 * (Part 4.5), for the player card. A consumer of the entry point, outside Player Value's neutral path: it reads the
 * organization's configured philosophy from settings at read time and hands it to the lens, so a philosophy edit
 * recomputes nothing. The neutral valuation stays at `/api/player-value/:playerId/surplus`, unchanged.
 *
 * Whose view: the organization the page names (the one selected in the app), else the configured default organization,
 * else the club the save is played as (AGENTS.md: resolve the configured organization, then the human-managed one).
 */
export const ourViewRoutes = Router();

type Source = 'requested' | 'configured' | 'human';

function clubName(teamId: number): string | null {
  if (!tableExists('teams')) return null;
  const row = db.prepare(`SELECT name, nickname FROM teams WHERE team_id = ?`).get(teamId) as { name?: unknown; nickname?: unknown } | undefined;
  if (!row) return null;
  return [row.name, row.nickname].filter((x) => typeof x === 'string' && x.length > 0).join(' ') || null;
}

/** The organization whose view this is, and how it was found; null when none can be. */
export function viewingOrganization(requested: unknown): { id: number; source: Source } | null {
  const asked = Number(requested);
  if (requested !== undefined && requested !== '' && Number.isInteger(asked) && asked > 0) return { id: asked, source: 'requested' };
  const configured = loadSettings().defaultOrgId;
  if (typeof configured === 'number' && configured > 0) return { id: configured, source: 'configured' };
  if (!tableExists('teams')) return null;
  try {
    const human = db.prepare(`SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1`).get() as { team_id: number } | undefined;
    return human ? { id: human.team_id, source: 'human' } : null;
  } catch {
    return null;
  }
}

/**
 * The player card's "our view": the lens applied to his neutral valuation under the viewing organization's philosophy,
 * with every lean named and the neutral figure it started from, and that organization's value of a win now as context.
 */
ourViewRoutes.get('/player-value/:playerId/our-view', (req, res) => {
  const id = Number(req.params.playerId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad player id' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const org = viewingOrganization(req.query.orgId);
  if (!org) return res.status(404).json({ error: 'No organization to view from: choose one, or import a save with a managed club' });
  const philosophy = lensPhilosophyFrom(resolvePhilosophy(philosophyForOrg(org.id)));
  // As current as the export is, like the card's other reads (A-20)
  const read = playerOurView(id, philosophy, org.id, { currentState: getDataStatus().freshness.csv.state });
  if (!read) return res.status(404).json({ error: 'No such active player' });
  res.json({
    organization: { id: org.id, name: clubName(org.id), source: org.source },
    ourView: read.ourView,
    winValue: clubWinValue(org.id),
  });
});
