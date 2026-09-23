import { Router } from 'express';
import { tableExists } from './db.js';
import { clubFinances, leagueFinances, marketLeagueOfClub } from './playerValue.js';
import { marketSnapshotHistory } from './playerValueSnapshot.js';

/**
 * The one domain route for Club Finances and the market (D-008, PLAYER_VALUE.md Part 2.4): the
 * club's finances, its league's financial regime, the opening price of a win and the replacement
 * level, and the market's recorded history across imports (Part 7), so drift can be seen. Payroll
 * reads its finance header and the league price of a win from here; the AI and every other page
 * read the same answer.
 */
export const clubFinanceRoutes = Router();

clubFinanceRoutes.get('/club-finances/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isInteger(orgId)) return res.status(400).json({ error: 'Bad organization id' });
  if (!tableExists('teams')) return res.status(400).json({ error: 'No data imported yet' });
  const marketId = marketLeagueOfClub(orgId);
  if (marketId === null) return res.status(404).json({ error: 'Unknown team' });
  res.json({
    club: clubFinances(orgId),
    league: leagueFinances(marketId),
    history: marketSnapshotHistory(marketId),
  });
});
