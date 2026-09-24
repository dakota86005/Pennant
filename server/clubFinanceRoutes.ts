import { Router } from 'express';
import { tableExists } from './db.js';
import { clubFinances, clubWinValue, leagueFinances, marketLeagueOfClub } from './playerValue.js';
import { marketSnapshotHistory, priceHistory, priceHistoryReport } from './playerValueSnapshot.js';

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
  const league = leagueFinances(marketId);
  res.json({
    club: clubFinances(orgId),
    // Each observed change is served by the price-history route; here each pair is its counts (phase 4b)
    league: { ...league, observed: { ...league.observed, pairs: league.observed.pairs.map(({ changes: _changes, ...pair }) => pair) } },
    history: marketSnapshotHistory(marketId),
    // Phase 4b: the price of a win across imports (opening, measured, which was in force)
    priceHistory: priceHistory(marketId),
    // Phase 5b: this club's value of a win now (Part 4.5), in playoff odds, beside the league's price of a win; never in any value
    winValue: clubWinValue(orgId),
  });
});

/**
 * The price of a win's history across the save's imports (phase 4b, PLAYER_VALUE.md 4.2): which price is in force now
 * and why (owner Q-4), the measured reading, what the imports observed, and each import's recorded readings.
 */
clubFinanceRoutes.get('/club-finances/:orgId/price-history', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isInteger(orgId)) return res.status(400).json({ error: 'Bad organization id' });
  if (!tableExists('teams')) return res.status(400).json({ error: 'No data imported yet' });
  const marketId = marketLeagueOfClub(orgId);
  if (marketId === null) return res.status(404).json({ error: 'Unknown team' });
  res.json(priceHistoryReport(marketId));
});
