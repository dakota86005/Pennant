import { Router } from 'express';
import { db, tableExists } from './db.js';
import { contractsByPlayer, mlbPercentiler, rosterHoles, valuesByPlayer } from './valuation.js';
import { controlAfterThisSeason, financeCards } from './contracts.js';
import { playerValues } from './playerValue.js';

export const freeAgentRoutes = Router();

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

freeAgentRoutes.get('/free-agents/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const org = db.prepare(`SELECT league_id FROM teams WHERE team_id = ?`).get(orgId) as
    | { league_id: number }
    | undefined;
  if (!org) return res.status(404).json({ error: 'Unknown org' });

  const values = valuesByPlayer();
  const { overallPct, talentPct } = mlbPercentiler(values);
  const contracts = contractsByPlayer();

  const decorate = (p: {
    player_id: number; first_name: string; last_name: string; age: number; position: number;
    team_label?: string;
  }) => {
    const c = contracts.get(p.player_id);
    return {
      player_id: p.player_id,
      name: `${p.first_name} ${p.last_name}`,
      age: p.age,
      position: p.position,
      positionName: POSITION_NAMES[p.position] ?? '?',
      team: p.team_label ?? null,
      overallPct: overallPct(p.player_id),
      talentPct: talentPct(p.player_id),
      lastSalary: c?.salaryNow ?? null,
    };
  };

  // Players currently without a club in this org's league
  const currentFAs = (
    db
      .prepare(
        `SELECT player_id, first_name, last_name, age, position FROM players
         WHERE free_agent = 1 AND retired = 0 AND last_league_id = ?`
      )
      .all(org.league_id) as Array<{
      player_id: number; first_name: string; last_name: string; age: number; position: number;
    }>
  ).map(decorate);

  // Contracts around the league — the offseason market. Control matters:
  // pre-arb/arb players on expiring 1-year deals stay team-controlled and never
  // reach the market. Whether a man reaches it is Player Value's control
  // timeline (D-052), asked about every major leaguer elsewhere, never a
  // free-agency rule assumed when the export does not state one, and never a
  // contract filtered out before the timeline is asked (A-23).
  const upcoming = db
    .prepare(
      `SELECT p.player_id, p.first_name, p.last_name, p.age, p.position,
              CASE WHEN t.name = t.nickname THEN t.name ELSE t.name || ' ' || t.nickname END AS team_label,
              rs.mlb_service_years AS service_years
       FROM players p
       JOIN teams t ON t.team_id = p.team_id
       LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id
       WHERE t.level = 1 AND t.allstar_team = 0 AND t.league_id = ?
         AND p.team_id != ? AND p.retired = 0`
    )
    .all(org.league_id, orgId) as Array<{
    player_id: number; first_name: string; last_name: string; age: number; position: number;
    team_label: string; service_years: number | null;
  }>;
  const valuations = playerValues(upcoming.map((p) => p.player_id), { production: false });
  const nextSeason = (id: number) => controlAfterThisSeason(valuations.get(id)?.control)?.status ?? null;
  // Whether these reach the market is not established (a threshold inside the projection, a rule
  // the export does not state): counted and said, not listed as if they were coming
  const upcomingIndeterminate = upcoming.filter((p) => nextSeason(p.player_id) === 'indeterminate').length;
  // Next season is an option or an opt-out: whether he reaches the market is a decision still to be made
  const upcomingUndecided = upcoming.filter((p) => nextSeason(p.player_id) === 'option').length;
  const reaching = upcoming.filter((p) => nextSeason(p.player_id) === 'leaving');
  const upcomingFAs = reaching
    .map(decorate)
    .filter((p) => (p.overallPct ?? 0) >= 40);

  const byValue = (a: { overallPct: number | null }, b: { overallPct: number | null }) =>
    (b.overallPct ?? -1) - (a.overallPct ?? -1);
  currentFAs.sort(byValue);
  upcomingFAs.sort(byValue);

  res.json({
    // Club Finances' figures, as Payroll shows them: unknown stays unknown, never $0 (D-18)
    finances: financeCards(orgId),
    holes: rosterHoles(orgId),
    currentFAs,
    upcomingFAs: upcomingFAs.slice(0, 80),
    /** Everyone reaching free agency after this season, before the value cut below which the list stops. */
    upcomingLeaving: reaching.length,
    upcomingIndeterminate,
    upcomingUndecided,
  });
});
