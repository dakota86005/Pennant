/**
 * Minor League Operations' API: the whole organization, one player's consequence, one arrival.
 * Read-only, like everything in the module.
 */

import { Router } from 'express';
import { tableExists } from './db.js';
import { farmArrivalFor, farmConsequenceFor } from './farmConsequence.js';
import { computeFarmSystem } from './farmOperations.js';

export const farmRoutes = Router();

farmRoutes.get('/farm-operations/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid organization id' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  res.json(computeFarmSystem(orgId));
});

farmRoutes.get('/farm-operations/:orgId/arrival/:playerId/:teamId', (req, res) => {
  const orgId = Number(req.params.orgId);
  const playerId = Number(req.params.playerId);
  const teamId = Number(req.params.teamId);
  if (!Number.isFinite(orgId) || !Number.isFinite(playerId) || !Number.isFinite(teamId)) {
    return res.status(400).json({ error: 'Invalid organization, player or team id' });
  }
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  res.json(farmArrivalFor(orgId, playerId, teamId));
});

farmRoutes.get('/farm-operations/:orgId/consequence/:playerId', (req, res) => {
  const orgId = Number(req.params.orgId);
  const playerId = Number(req.params.playerId);
  if (!Number.isFinite(orgId) || !Number.isFinite(playerId)) {
    return res.status(400).json({ error: 'Invalid organization or player id' });
  }
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  res.json(farmConsequenceFor(orgId, playerId));
});
