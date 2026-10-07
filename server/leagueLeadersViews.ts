/**
 * League Office's Leaders (N12 Track B, D-072): the reader. It reads what the React page's route computes
 * (`computeLeaderboards`) and who qualifies (`leaderQualifier`), and the league's own season and name, and hands them to
 * the pure adapter (`presentation/league/leaders.ts`). The season is worded only when the league's own row states it
 * (D-018, D-022): the route falls back to the calendar year, which is never shown as the league's season.
 */
import { db, tableColumns, tableExists } from './db.js';
import type { OfficeContext } from './presentation/league/common.js';
import { leadersUnreadView, leadersView } from './presentation/league/leaders.js';
import type { LeagueLeadersView } from './presentation/league/types.js';
import { computeLeaderboards, leaderQualifier } from './rosterops.js';

/** The club's league's own season and name, as its row states them (null where it states none). */
function leagueOf(orgId: number): { season: number | null; name: string | null } {
  if (!tableExists('teams') || !tableExists('leagues')) return { season: null, name: null };
  const cols = new Set(tableColumns('leagues'));
  const row = db.prepare(`SELECT ${cols.has('season_year') ? 'l.season_year' : 'NULL'} AS season, ${cols.has('name') ? 'l.name' : 'NULL'} AS name
    FROM teams t JOIN leagues l ON l.league_id = t.league_id WHERE t.team_id = ?`).get(orgId) as { season: unknown; name: unknown } | undefined;
  const season = typeof row?.season === 'number' && Number.isInteger(row.season) && row.season > 0 ? row.season : null;
  const name = typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : null;
  return { season, name };
}

export function leadersViewOf(v: OfficeContext, orgId: number): LeagueLeadersView {
  const computed = computeLeaderboards(orgId);
  const league = leagueOf(orgId);
  return leadersView(v, {
    leaders: computed.ok ? computed.body : computed.error,
    season: league.season,
    leagueName: league.name,
    qualifier: computed.ok ? leaderQualifier(orgId) : null,
  });
}

export function leadersUnread(v: OfficeContext, why: string): LeagueLeadersView {
  return leadersUnreadView(v, why);
}
