import { Router } from 'express';
import { db, tableColumns, tableExists } from './db.js';
import { controlAfterThisSeason, contractSummaryOf, financeCards } from './contracts.js';
import { freshnessCue, getDataStatus, type DataStatus } from './dataStatus.js';
import { leagueRulesForLeague } from './leagueRules.js';
import {
  marketValueOf, playerValues, productionHeadlineOf, surplusMarketOf, type MarketValue, type PlayerValuation,
} from './playerValue.js';
import { POSITION_NAMES, positionNeeds, type PositionNeeds } from './positionNeeds.js';
import { loadScoutedAbilities } from './scoutedEvidence.js';

/**
 * Free Agents on Player Value (phase 6c; PLAYER_VALUE.md Part 8, consumer 4; D-052).
 *
 * Two lists: the players no club holds in the club's league (available now), and every major leaguer elsewhere whose
 * control Player Value's timeline ends after this season (hitting the market). Each shows what Player Value knows: his
 * expected wins (the rest of this season and next, most likely with the range they could be), what a season of his
 * production costs at this league's market (`marketValueOf`: the league minimum plus his wins next season × the price of a
 * win in force; a player no club holds has no contract, so no contract value), his scouted tools now and at their ceiling
 * through the evidence boundary (D-017), and his age. Nothing here reads `players_value`, a percentile or an OOTP rating,
 * and nothing tells the GM to sign anyone: the lists are ordered by a shown figure (expected wins next season, not known
 * last), and no value cut decides who appears. The club's thinnest positions are `positionNeeds`' (expected wins, shown).
 */
export const freeAgentRoutes = Router();

/** A season of expected wins as a row shows it. */
export interface WinsFigure { season: number; low: number; central: number; high: number }

export interface FreeAgentRow {
  player_id: number;
  name: string;
  age: number | null;
  position: number;
  positionName: string;
  isPitcher: boolean;
  /** His club now (hitting the market); null for a player no club holds. */
  team: string | null;
  /** This season's salary as his contract states it (hitting the market); null with the reason where it is not known. */
  salaryNow: number | null;
  salaryNote: string | null;
  /** His scouted tools now and at their ceiling, 20-80, from `scoutedEvidence.ts`; a missing grade leaves it unknown. */
  scouted: { now: number | null; ceiling: number | null; status: 'complete' | 'partial' | 'unknown' };
  /** Expected wins for the rest of this season (the whole of it before it starts). */
  winsNow: (WinsFigure & { part: 'rest_of_season' | 'season' }) | null;
  /** Expected wins next season, or null with `winsReason`. */
  winsNext: WinsFigure | null;
  winsReason: string | null;
  /** What a season of his production next season costs at this league's market, or why it is not known. */
  market: MarketValue;
}

export const FREE_AGENT_ORDER =
  'Ordered by expected wins next season, most likely, most first; players whose production is not known come last.';

const byExpectedWins = (a: FreeAgentRow, b: FreeAgentRow): number => {
  const x = a.winsNext?.central ?? null;
  const y = b.winsNext?.central ?? null;
  if (x === null || y === null) return x === null ? (y === null ? a.name.localeCompare(b.name) : 1) : -1;
  return y - x || a.name.localeCompare(b.name);
};

interface Listed { player_id: number; name: string; age: number | null; position: number; team: string | null }

/**
 * The page. `status` is how current the export is (D-022): handed to Player Value as `currentState`, so a stale export
 * leaves service, control and whether a man reaches the market not established (D-023), and said on the page (A-20).
 */
export function computeFreeAgents(orgId: number, status: DataStatus = getDataStatus()) {
  const org = db.prepare(`SELECT league_id, name, nickname FROM teams WHERE team_id = ?`).get(orgId) as
    | { league_id: number; name: string | null; nickname: string | null }
    | undefined;
  if (!org) throw Object.assign(new Error('Unknown org'), { status: 404 });
  // The season is the league's own, as exported; never the wall-clock year (D-022)
  const rules = leagueRulesForLeague(org.league_id).contract;
  const season = rules.season.value;
  const next = season === null ? null : season + 1;
  const cue = freshnessCue(status);
  const options = { currentState: cue.state };
  const columns = new Set(tableColumns('players'));

  // Players no club holds whose last league is this one. An export without the columns that say so lists none, and says why
  const canList = ['free_agent', 'last_league_id'].every((c) => columns.has(c));
  const available: Listed[] = canList
    ? (db.prepare(
      `SELECT player_id, first_name || ' ' || last_name AS name, age, position, NULL AS team FROM players
       WHERE free_agent = 1 AND retired = 0 AND last_league_id = ?`
    ).all(org.league_id) as Listed[])
    : [];

  // Every major leaguer elsewhere in the league: whether he reaches the market is Player Value's control timeline (D-052),
  // asked about each, never a free-agency rule assumed when the export does not state one, never a contract filtered out
  // before the timeline is asked (A-23), and never a value cut
  const elsewhere = db.prepare(
    `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.age, p.position,
            CASE WHEN t.name = t.nickname THEN t.name ELSE t.name || ' ' || t.nickname END AS team
     FROM players p JOIN teams t ON t.team_id = p.team_id
     WHERE t.level = 1 AND t.allstar_team = 0 AND t.league_id = ? AND p.team_id != ? AND p.retired = 0`
  ).all(org.league_id, orgId) as Listed[];

  const valuations = playerValues([...available, ...elsewhere].map((p) => p.player_id), options);
  const afterThisSeason = (id: number) => controlAfterThisSeason(valuations.get(id)?.control)?.status ?? null;
  // Whether these reach the market is not established (a threshold inside the projection, a rule the export does not
  // state, an export behind the save): counted and said, not listed as if they were coming
  const upcomingIndeterminate = elsewhere.filter((p) => afterThisSeason(p.player_id) === 'indeterminate').length;
  // Next season is an option or an opt-out: whether he reaches the market is a decision still to be made
  const upcomingUndecided = elsewhere.filter((p) => afterThisSeason(p.player_id) === 'option').length;
  const reaching = elsewhere.filter((p) => afterThisSeason(p.player_id) === 'leaving');

  const market = surplusMarketOf(org.league_id, options);
  const scouting = loadScoutedAbilities([...available, ...reaching].map((p) => p.player_id));
  const limitations = new Set<string>();

  const rowOf = (p: Listed): FreeAgentRow => {
    const v: PlayerValuation | undefined = valuations.get(p.player_id);
    if (v?.control.eligibility?.limitation) limitations.add(v.control.eligibility.limitation);
    const head = v ? productionHeadlineOf(v.production) : null;
    const a = scouting.for(p.player_id);
    const held = v !== undefined && v.control.standing === 'held';
    const contract = held ? contractSummaryOf(v) : null;
    return {
      player_id: p.player_id,
      name: p.name,
      age: typeof p.age === 'number' ? p.age : null,
      position: p.position,
      positionName: POSITION_NAMES[p.position] ?? '?',
      isPitcher: p.position === 1,
      team: p.team,
      salaryNow: contract?.salaryNow ?? null,
      salaryNote: contract ? contract.salaryNote : 'No club holds him: he has no contract.',
      scouted: { now: a.current, ceiling: a.potential, status: a.status },
      winsNow: head?.now ? { season: head.now.season, part: head.now.part, ...pick(head.now.wins) } : null,
      winsNext: head?.next ? { season: head.next.season, ...pick(head.next.wins) } : null,
      winsReason: head?.next ? null : head?.status === 'unknown'
        ? (head.reason ?? 'His production is not established.')
        : head?.nextReason ?? (v ? `His production in ${next ?? 'next season'} is not projected.` : "He isn't an active player in the export."),
      market: v
        ? marketValueOf({ production: v.production, market, season: next })
        : { status: 'unknown', season: next, low: null, central: null, high: null, reason: "He isn't an active player in the export.", text: "He isn't an active player in the export." },
    };
  };

  const currentFAs = available.map(rowOf).sort(byExpectedWins);
  const upcomingFAs = reaching.map(rowOf).sort(byExpectedWins);
  const needs: PositionNeeds = positionNeeds(orgId, options);
  const priced = market?.price.value ?? null;

  return {
    seasonYear: season,
    nextSeason: next,
    freshness: { ...cue, limitations: [...limitations] },
    organization: { id: orgId, name: [org.name, org.nickname].filter((x, i, all) => x && all.indexOf(x) === i).join(' ') || null },
    // Club Finances' figures, as Payroll shows them: unknown stays unknown, never $0 (D-18)
    finances: financeCards(orgId),
    /** The price of a win in force in the club's league and the minimum: what the market figures rest on. */
    price: market && priced ? { stage: market.stage, label: market.label, band: priced, minimum: market.minimumSalary.value } : null,
    needs,
    order: FREE_AGENT_ORDER,
    currentFAs,
    /** Why the available list could not be read from this export; null where it could. */
    currentNote: canList ? null : "This export doesn't say which league a free agent last played in, so the players available now can't be listed.",
    upcomingFAs,
    upcomingIndeterminate,
    upcomingUndecided,
  };
}

const pick = (w: { low: number; central: number; high: number }) => ({ low: w.low, central: w.central, high: w.high });

freeAgentRoutes.get('/free-agents/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players') || !tableExists('teams')) return res.status(400).json({ error: 'No data imported yet' });
  try {
    res.json(computeFreeAgents(orgId));
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
