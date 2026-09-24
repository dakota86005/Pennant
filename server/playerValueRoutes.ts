import { Router } from 'express';
import { tableExists } from './db.js';
import { getDataStatus } from './dataStatus.js';
import { marketLeagueOfClub, playerProductionCone, playerSurplus, playerValue, playerValues, productionCalibration } from './playerValue.js';

/**
 * The domain routes for a player's value (D-008, PLAYER_VALUE.md Part 7): contract facts, the
 * control timeline and, from phase 3a, expected production in wins per season (80% and 50% bands
 * with their basis), plus the production model's calibration status for the club's league (D-053).
 * Every consumer, the static export and the AI read these same answers; no page computes its own.
 */
export const playerValueRoutes = Router();

/**
 * How current the export is, for the one-player reads (A-20, phase 6a): the card's header, its cone and its Value section
 * are read with the same freshness Contracts reads, so a stale export leaves the same answers not established on each.
 */
const current = () => ({ currentState: getDataStatus().freshness.csv.state });

/** The production fit in force for the club's league: window, held-out coverage, when it was refit, the prior's weight. */
playerValueRoutes.get('/player-value/production-fit/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isInteger(orgId)) return res.status(400).json({ error: 'Bad organization id' });
  if (!tableExists('teams')) return res.status(400).json({ error: 'No data imported yet' });
  const leagueId = marketLeagueOfClub(orgId);
  if (leagueId === null) return res.status(404).json({ error: 'Unknown team' });
  res.json(productionCalibration(leagueId));
});

/** Several players at once: `?ids=1,2,3` (at most 500). */
playerValueRoutes.get('/player-value', (req, res) => {
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const ids = String(req.query.ids ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0 || ids.length > 500) return res.status(400).json({ error: 'Give 1 to 500 player ids as ?ids=1,2,3' });
  res.json(Object.fromEntries(playerValues(ids)));
});

/**
 * The player card's production cone: expected production joined with control, season by season, from
 * this season to the end of control within the production horizon, with the calibration status line.
 */
playerValueRoutes.get('/player-value/:playerId/cone', (req, res) => {
  const id = Number(req.params.playerId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad player id' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const cone = playerProductionCone(id, current());
  if (!cone) return res.status(404).json({ error: 'No such active player' });
  res.json(cone);
});

/**
 * The player card's Value section (phase 5a): the neutral contract surplus and the retention margin, season by season
 * with every component (wins, price, cost, discount) and the basis; the same valuation the league-wide read serves.
 */
playerValueRoutes.get('/player-value/:playerId/surplus', (req, res) => {
  const id = Number(req.params.playerId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad player id' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const surplus = playerSurplus(id, current());
  if (!surplus) return res.status(404).json({ error: 'No such active player' });
  res.json(surplus);
});

playerValueRoutes.get('/player-value/:playerId', (req, res) => {
  const id = Number(req.params.playerId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad player id' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const value = playerValue(id, current());
  if (!value) return res.status(404).json({ error: 'No such active player' });
  res.json(value);
});
