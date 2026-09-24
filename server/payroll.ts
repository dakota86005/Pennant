import { Router } from 'express';
import { db, tableColumns, tableExists } from './db.js';
import { loadSettings } from './settings.js';
import { leagueRulesForLeague } from './leagueRules.js';
import { controlAfterThisSeason } from './contracts.js';
import { clubFinances, contractSeasonFor, payrollValuations, serviceReading, type ContractFacts, type PlayerValuation } from './playerValue.js';

export const payrollRoutes = Router();

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

/** How many future seasons the commitment curve covers. */
const HORIZON = 6;

/** A season the contract covers but whose salary is a decision: the club's (or either side's) option, or his opt-out. */
interface OptionYear {
  season: number;
  kind: 'club' | 'player' | 'vesting' | 'mutual' | 'opt_out';
  /** The salary if the option is exercised (or he stays); null when the export does not state it. */
  salary: number | null;
  /**
   * Whether the club is bound to it: a player option or an opt-out is his decision, so the club owes it
   * unless he leaves (counted in committed money, flagged); a club, vesting or mutual option is not
   * guaranteed money and is counted apart.
   */
  committed: boolean;
}

/**
 * What the contract says for one season, from Player Value's contract facts (A-14): the salary
 * owed, or null where no contract season covers it; an option season the club decides is not
 * committed money. A covered season whose salary the export does not state is `unstated`, never $0.
 */
function seasonMoney(contract: ContractFacts, thisSeason: number, year: number):
  { salary: number | null; unstated: boolean; option: OptionYear | null } {
  const cover = contractSeasonFor(contract, year);
  if (!cover) return { salary: null, unstated: false, option: null };
  const salary = cover.salary.value;
  // The season under way had its option decided before it began: he is playing it under contract (A-03)
  if (cover.option && year > thisSeason) {
    const committed = cover.option === 'player';
    return {
      salary: committed ? salary : null, unstated: committed && salary === null,
      option: { season: year, kind: cover.option, salary, committed },
    };
  }
  const optOutFrom = contract.optOutFrom;
  if (optOutFrom !== null && optOutFrom > thisSeason && year >= optOutFrom) {
    return { salary, unstated: salary === null, option: { season: year, kind: 'opt_out', salary, committed: true } };
  }
  return { salary, unstated: salary === null, option: null };
}

payrollRoutes.get('/payroll/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players_contract') || !tableExists('teams')) return res.status(400).json({ error: 'No data imported yet' });
  const teamColumns = new Set(tableColumns('teams'));
  if (!teamColumns.has('team_id') || !teamColumns.has('league_id')) {
    return res.status(400).json({ error: 'The export\'s teams table has no league_id column, so the club\'s league cannot be read.' });
  }

  const org = db.prepare(`SELECT league_id FROM teams WHERE team_id = ?`).get(orgId) as
    | { league_id: number }
    | undefined;
  if (!org) return res.status(404).json({ error: 'Unknown team' });
  // The season is the league's own, as exported; never the wall-clock year (D-022)
  const rules = leagueRulesForLeague(org.league_id).contract;
  const thisSeason = rules.season.value;
  if (thisSeason === null) {
    return res.status(400).json({ error: `The league's current season is not in the export: ${rules.season.note ?? 'no source states it'}` });
  }

  // The finance header is Club Finances' (D-052 phase 2): each figure with its source, a missing
  // one unknown rather than $0, the same answer /api/club-finances gives
  const finances = clubFinances(orgId);

  /*
   * Contract facts are Player Value's (A-14): one reading of players_contract for every consumer, with
   * its unknowns. Payroll means major-league contracts, which is what OOTP's own figure counts: a man on
   * the 40-man optioned to Triple-A is still paid his major-league salary, while a minor-league deal is
   * not payroll at all. Membership is the organization (a player optioned to the affiliate keeps it),
   * plus anyone the export names this club as carrying the contract of. A contract_team_id pointing at
   * this club does NOT by itself mean it pays: it is the club of record, which OOTP leaves behind when a
   * player moves; the contract's `retained` decides, and where the export does not populate it that is
   * not established, never $0 and never "nothing owed".
   */
  const valuations = payrollValuations(orgId);
  const years = Array.from({ length: HORIZON }, (_, i) => thisSeason + i);
  const major = [...valuations.values()].filter((v) => v.contract.kind.value === 'major_league' && v.contract.term !== null);
  const held = (v: PlayerValuation) => v.control.holder.value === orgId;
  const elsewhere = major.filter((v) => !held(v) && v.contract.payingClub.value === orgId);
  const retainedKnown = elsewhere.every((v) => v.contract.retained.value !== null);
  const counted = major.filter((v) => held(v) || v.contract.retained.value === true);

  const names = new Map<number, { first_name: string; last_name: string; age: number; position: number }>();
  const playerColumns = new Set(tableColumns('players'));
  if (counted.length > 0 && ['player_id', 'first_name', 'last_name', 'age', 'position'].every((c) => playerColumns.has(c))) {
    const ids = counted.map((v) => v.playerId);
    for (const r of db.prepare(`SELECT player_id, first_name, last_name, age, position FROM players WHERE player_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as Array<{ player_id: number; first_name: string; last_name: string; age: number; position: number }>) {
      names.set(r.player_id, r);
    }
  }

  const players = counted
    .map((v) => {
      const c = v.contract;
      const who = names.get(v.playerId);
      const money = years.map((y) => seasonMoney(c, thisSeason, y));
      const byYear = money.map((m) => m.salary);
      const covered = [...(c.term?.seasons ?? []), ...(c.extension?.seasons ?? [])].map((s) => s.season);
      const endYear = covered.length > 0 ? Math.max(...covered) : thisSeason;
      const yearsAfterThis = Math.max(endYear - thisSeason, 0);
      const options: string[] = [];
      const lastOption = c.term?.seasons[c.term.seasons.length - 1]?.option ?? null;
      if (lastOption) options.push(`${lastOption === 'club' ? 'team' : lastOption} option`);
      if (c.noTrade.value === true) options.push('no-trade');
      if (c.optOutFrom !== null && c.optOutFrom > thisSeason) options.push(`opt-out before ${c.optOutFrom}`);
      const service = v.control.eligibility?.service.now ?? null;
      const perYear = v.control.eligibility?.serviceDaysPerYear.value ?? null;
      return {
        player_id: v.playerId,
        name: who ? `${who.first_name} ${who.last_name}` : `Player ${v.playerId}`,
        // Owed to someone who has left AND whose salary this club retained
        deadMoney: !held(v) && c.retained.value === true,
        age: who?.age ?? null,
        positionName: who ? POSITION_NAMES[who.position] ?? '?' : '?',
        salaryNow: byYear[0],
        byYear,
        /** Seasons the contract covers whose salary the export does not state: unknown, never $0. */
        unstatedYears: years.filter((_, i) => money[i].unstated),
        /** Option and opt-out seasons, with the salary if exercised and whether the club is bound to it. */
        optionYears: money.map((m) => m.option).filter((o): o is OptionYear => o !== null),
        yearsAfterThis,
        endYear,
        expiring: yearsAfterThis === 0,
        /*
         * What actually happens to him, rather than merely that his deal ends. Arbitration years left is
         * not money coming off the books — the club still holds him and the salary is about to rise, not
         * vanish. Null for a man no club holds (a released player whose salary is retained).
         */
        control: controlAfterThisSeason(v.control),
        options,
        serviceYears: serviceReading(service, perYear).years,
        service: serviceReading(service, perYear).text,
      };
    })
    .sort((a, b) => (b.salaryNow ?? 0) - (a.salaryNow ?? 0));

  // Committed money per season, how many players it covers, and the option money counted apart
  const commitments = years.map((year, i) => {
    const withMoney = players.filter((p) => (p.byYear[i] ?? 0) > 0);
    const optional = players.flatMap((p) => p.optionYears.filter((o) => o.season === year && !o.committed));
    return {
      year,
      total: withMoney.reduce((sum, p) => sum + (p.byYear[i] ?? 0), 0),
      players: withMoney.length,
      /** Club, vesting and mutual option seasons: not guaranteed money, and not in the total. */
      options: { total: optional.reduce((sum, o) => sum + (o.salary ?? 0), 0), players: optional.length, unstated: optional.filter((o) => o.salary === null).length },
      /** Covered seasons whose salary the export does not state: not in the total, never $0. */
      unstated: players.filter((p) => p.unstatedYears.includes(year)).length,
    };
  });

  const budget = finances.budget.value;
  // What the owner is expected to allow next season. Only a number you have
  // entered counts — otherwise the flat assumption stands, and the response
  // says which of the two produced the headroom below.
  const entered = loadSettings().nextSeasonBudget?.[String(orgId)];
  const nextBudget = typeof entered === 'number' && entered > 0 ? entered : null;
  const endingAfterThisYear = players.filter((p) => p.expiring && !p.deadMoney);
  // Genuinely leaving, against still held but about to cost more
  const leaving = endingAfterThisYear.filter((p) => p.control?.status === 'leaving');
  const stillControlled = endingAfterThisYear.filter(
    (p) => p.control?.status === 'arbitration' || p.control?.status === 'pre-arbitration' || p.control?.status === 'reserve clause'
  );
  // Neither list: the export cannot establish whether he leaves or stays, and the page says so
  const controlIndeterminate = endingAfterThisYear.filter((p) => p.control?.status === 'indeterminate');
  const brief = (list: typeof players) => ({
    count: list.length,
    money: list.reduce((sum, p) => sum + (p.salaryNow ?? 0), 0),
    players: list
      .slice()
      .sort((a, b) => (b.salaryNow ?? 0) - (a.salaryNow ?? 0))
      // Every player counted is listed: the count shown equals the rows (owner, phase 2)
      .map((p) => ({
        player_id: p.player_id,
        name: p.name,
        age: p.age,
        salary: p.salaryNow,
        status: p.control?.status ?? null,
        arbYear: p.control?.arbYear ?? null,
        arbYearHigh: p.control?.arbYearHigh ?? null,
        superTwo: p.control?.superTwo ?? false,
        between: p.control?.between ?? [],
        reason: p.control?.reason ?? null,
      })),
  });

  // Money still owed to players who left: only where the export states the club retained it
  const owed = players.filter((p) => p.deadMoney && p.byYear.some((v) => (v ?? 0) > 0));
  // Retained salary unpopulated in the export (every held contract reads it as unknown): said, even when no
  // contract names this club for a player now elsewhere, so an empty list is never silent (A-14)
  const retainedUnread = major.find((v) => v.contract.retained.value === null)?.contract.retained.note ?? null;
  const deadMoney = retainedKnown
    ? {
        status: 'known' as const,
        total: owed.reduce((sum, p) => sum + (p.salaryNow ?? 0), 0),
        players: owed.map((p) => ({ player_id: p.player_id, name: p.name, salary: p.salaryNow })),
        candidates: elsewhere.length,
        note: elsewhere.length === 0 && retainedUnread !== null
          ? `None in the export: it names this club as carrying no contract of a player now elsewhere. Retained salary itself is not exported (${retainedUnread}).`
          : null,
      }
    : {
        status: 'not_established' as const,
        total: null,
        players: [],
        candidates: elsewhere.length,
        note: 'Whether this club still pays players it moved is not established: retained salary is not exported '
          + `(${elsewhere.find((v) => v.contract.retained.value === null)?.contract.retained.note ?? 'the column is blank'}). `
          + `The export names this club as carrying ${elsewhere.length} contract${elsewhere.length === 1 ? '' : 's'} of players now elsewhere; that is the club of record, not proof it pays.`,
      };

  res.json({
    seasonYear: thisSeason,
    years,
    finances,
    deadMoney,
    nextSeasonBudget: nextBudget,
    commitments: commitments.map((c) => ({
      ...c,
      // Seasons after this one measure against the budget you expect, when you
      // have given one. OOTP publishes no future budget, so without an entry
      // the only honest assumption is that today's holds flat.
      headroom:
        (c.year > thisSeason ? (nextBudget ?? budget) : budget) !== null
          ? (c.year > thisSeason ? (nextBudget ?? budget)! : budget!) - c.total
          : null,
      budgetUsed: c.year > thisSeason && nextBudget !== null ? 'expected' : 'flat',
    })),
    /*
     * Two lists, not one. Money only comes off the books when the man leaves;
     * an arbitration case is still yours and is about to get more expensive,
     * which is the opposite of relief.
     */
    comingOff: brief(leaving),
    stillControlled: brief(stillControlled),
    controlIndeterminate: brief(controlIndeterminate),
    players,
  });
});
