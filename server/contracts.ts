import { Router } from 'express';
import { db, tableExists } from './db.js';
import { seasonFormByPlayer, type SeasonForm } from './form.js';
import { leagueRulesForLeague } from './leagueRules.js';
import { clubFinances, playerValues, serviceReading, type ControlSeason, type ControlTimeline } from './playerValue.js';
import type { Sourced } from './provenance.js';
import {
  contractsByPlayer, currentGameDate, mlbPercentiler, ON_ROSTER, seasonYear, valuesByPlayer,
} from './valuation.js';

export const contractRoutes = Router();

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

interface Recommendation {
  action: string;
  reasons: string[];
}

/**
 * The recommendations that amount to "commit to this man".
 *
 * These are the ones that must not rest on the Value figure alone, because
 * that figure counts playing time: a long reliever with an earned run average
 * over six can sit in the top tenth of the reliever pool purely for the number
 * of innings he has soaked up, and the advice was telling its reader to extend
 * him before somebody else did.
 */
const COMMITTING = new Set([
  'Core keeper', 'Extension candidate', 'Extend now', 'Re-sign', 'Re-sign short-term',
]);

/**
 * The value-based reading, before the season is allowed to speak.
 *
 * Kept whole and separate so the two arguments stay legible: this is what a
 * man is worth on paper, and the gate below is what he has actually done.
 */
function recommendOnValue(args: {
  age: number;
  yearsAfterThis: number;
  /** Null when his control after this season is indeterminate. */
  reachingFA: boolean | null;
  /** Null when the league's free-agency rule is not in the export. */
  hasFreeAgency: boolean | null;
  overallPct: number | null;
  talentPct: number | null;
  salaryNow: number;
}): Recommendation | null {
  const { age, yearsAfterThis, reachingFA, hasFreeAgency, overallPct, talentPct, salaryNow } = args;
  if (overallPct === null) return null;
  // No advice that turns on control when control itself is not established (D-018)
  if (hasFreeAgency === null) return null;
  if (yearsAfterThis === 0 && reachingFA === null) return null;
  const declining = talentPct !== null && overallPct - talentPct >= 15;

  // Under the reserve clause there is no market to lose a player to, so the
  // question is never "extend before he walks" — it is whether he is worth
  // keeping and what he will hold out for.
  if (!hasFreeAgency) {
    if (overallPct >= 70 && age <= 29) {
      return { action: 'Core keeper', reasons: [`top ${100 - overallPct}% value, prime years ahead — renew`] };
    }
    if (declining && age >= 32) {
      return { action: 'Consider moving', reasons: ['talent slipping below production — sell while value holds'] };
    }
    if (overallPct < 30) {
      return { action: 'Release candidate', reasons: [`bottom ${overallPct}% value`] };
    }
    return null;
  }

  if (yearsAfterThis === 0 && !reachingFA) {
    // Deal ends but the player lacks the service time to leave — auto-renews
    if (overallPct >= 75 && age <= 28) {
      return { action: 'Extension candidate', reasons: ['team-controlled — buy out arb/FA years while cheap'] };
    }
    return null;
  }

  if (yearsAfterThis === 0) {
    // Expiring after this season
    const reasons: string[] = [];
    if (declining) reasons.push('scouted talent below current production — decline risk');
    if (overallPct >= 70 && age <= 29) {
      return { action: 'Extend now', reasons: [`top ${100 - overallPct}% MLB value, prime years ahead`, ...reasons] };
    }
    if (overallPct >= 70 && age <= 33) {
      return { action: 'Re-sign', reasons: [`top ${100 - overallPct}% MLB value`, ...reasons] };
    }
    if (overallPct >= 70) {
      return { action: 'Re-sign short-term', reasons: [`still productive but age ${age} — limit years`, ...reasons] };
    }
    if (overallPct < 40) {
      return { action: 'Let walk', reasons: [`bottom ${overallPct}% MLB value`, ...reasons] };
    }
    return { action: 'Market-dependent', reasons: [`middling value (${overallPct}th pct) — replaceable`, ...reasons] };
  }

  // Not expiring: surface extension candidates and decline warnings
  if (yearsAfterThis <= 2 && overallPct >= 75 && age <= 28) {
    return {
      action: 'Extension candidate',
      reasons: [`${yearsAfterThis} yr${yearsAfterThis === 1 ? '' : 's'} left after this one — buy out prime early`],
    };
  }
  if (declining && age >= 32 && salaryNow >= 10_000_000) {
    return { action: 'Watch decline', reasons: ['expensive veteran with talent slipping below production'] };
  }
  return null;
}

/**
 * The same reading, with this season's results given a veto.
 *
 * A man is not extended on his Value percentile alone. Where he has played
 * enough for the line to mean anything and it is clearly below the league, the
 * recommendation becomes "hold off" and says which two facts disagree — that
 * is a genuinely useful thing to be told, and far better than either advising
 * the extension or silently dropping him from the list.
 *
 * Where he has not played enough, the recommendation stands and says so. A man
 * with nine innings has shown nothing, and treating that as evidence against
 * him would be the same mistake pointing the other way.
 */
function recommend(
  args: Parameters<typeof recommendOnValue>[0] & { form: SeasonForm | null }
): Recommendation | null {
  const rec = recommendOnValue(args);
  if (!rec || !COMMITTING.has(rec.action)) return rec;

  const form = args.form;
  if (!form || form.verdict === 'unknown') {
    return {
      ...rec,
      reasons: [
        ...rec.reasons,
        form?.line
          ? `only ${form.line} so far — too little to judge, this is the value figure alone`
          : 'no meaningful playing time yet — this is the value figure alone',
      ],
    };
  }
  if (form.verdict === 'poor') {
    return {
      action: 'Hold off',
      reasons: [
        `${rec.reasons[0]} — but ${form.line}`,
        'the value figure counts playing time, not results; the season does not back an extension yet',
      ],
    };
  }
  return { ...rec, reasons: [...rec.reasons, `${form.line} backs it`] };
}

/**
 * What happens to a man when his deal runs out.
 *
 * "Expiring" and "leaving" are not the same thing, and the payroll page was
 * treating them as one: a player with arbitration years left was counted as
 * money coming off the books, when the club still holds him and his salary is
 * about to go up rather than away. A reader reported it, and he is right —
 * the two belong in different columns.
 *
 * The answer is Player Value's control timeline (D-052), read for the season
 * after this one; eligibility itself is Player Rights' (Q-1). Nothing here
 * compares service time with a threshold any more, so the pages cannot come to
 * disagree about the same player, and a rule or a service time the export does
 * not state is `indeterminate` with its reason — never six years, never three,
 * never zero service.
 */
export type ControlStatus =
  | 'signed'          // still under contract next season
  | 'extended'        // next season is a signed extension's
  | 'option'          // next season is an option (or an opt-out): both branches, see `option`
  | 'leaving'         // reaches free agency — the money genuinely comes off
  | 'arbitration'     // still controlled, and about to cost more
  | 'pre-arbitration' // still controlled, renewed by the club
  | 'reserve clause'  // no free agency in this league; he simply stays
  | 'indeterminate';  // the export cannot establish which

export interface Control {
  status: ControlStatus;
  /** Which arbitration trip this would be, when that is where he lands (the low edge). */
  arbYear: number | null;
  /** The high edge, when staying up all season would make it a later trip. */
  arbYearHigh: number | null;
  /** Arbitration reached as a Super Two (owner ruling, 2026-09-22). */
  superTwo: boolean;
  /** For an indeterminate status: the statuses it lies between. */
  between: ControlStatus[];
  /**
   * For an option season: whose decision it is, and where he stands if it is declined (or he opts
   * out). Exercised, he is under contract at the salary. Never collapsed into "signed" (A-04).
   */
  option: { kind: 'club' | 'player' | 'vesting' | 'mutual' | 'opt_out'; ifDeclined: ControlStatus; between: ControlStatus[] } | null;
  /** Why, in a line: the basis, or what is missing. */
  reason: string | null;
}

const OPTION_KIND: Partial<Record<ControlTimeline['seasons'][number]['status'], NonNullable<Control['option']>['kind']>> = {
  club_option: 'club', player_option: 'player', vesting_option: 'vesting', mutual_option: 'mutual', opt_out: 'opt_out',
};

const LEGACY: Record<ControlTimeline['seasons'][number]['status'], ControlStatus> = {
  under_contract: 'signed',
  club_option: 'option',
  player_option: 'option',
  vesting_option: 'option',
  mutual_option: 'option',
  opt_out: 'option',
  pre_arbitration: 'pre-arbitration',
  arbitration: 'arbitration',
  free_agent: 'leaving',
  reserve_clause: 'reserve clause',
  indeterminate: 'indeterminate',
};

/**
 * Where he stands the season after this one, read from his control timeline.
 * Null for a player no club holds.
 */
export function controlAfterThisSeason(timeline: ControlTimeline | null | undefined): Control | null {
  const unknown = (reason: string): Control => ({ status: 'indeterminate', arbYear: null, arbYearHigh: null, superTwo: false, between: [], option: null, reason });
  if (!timeline) return unknown('His contract and control could not be read from the export.');
  if (timeline.standing === 'unsigned') return null;
  if (timeline.thisSeason === null) return unknown(timeline.notes[timeline.notes.length - 1] ?? 'The current season is not known.');
  const next = timeline.seasons.find((s) => s.season === timeline.thisSeason! + 1);
  if (!next) {
    // Control ends this season: nothing holds him beyond it (A-19)
    if (timeline.controlEnds !== null && timeline.controlEnds <= timeline.thisSeason) {
      const now = timeline.seasons.find((s) => s.season === timeline.thisSeason);
      return {
        status: 'leaving', arbYear: null, arbYearHigh: null, superTwo: false, between: [], option: null,
        reason: now?.basis ?? 'He is past the free-agency line and nothing holds him beyond this season.',
      };
    }
    return unknown('His control after this season could not be stated.');
  }
  // "Extended" only when next season is the extension's, never while the current deal runs on (A-18)
  const status: ControlStatus = next.status === 'under_contract' && next.from === 'extension' ? 'extended' : LEGACY[next.status];
  const optionKind = OPTION_KIND[next.status];
  return {
    status,
    arbYear: next.arbitrationYear?.low ?? null,
    arbYearHigh: next.arbitrationYear && next.arbitrationYear.high !== next.arbitrationYear.low ? next.arbitrationYear.high : null,
    superTwo: next.superTwo,
    between: [...new Set(next.between.map((b) => LEGACY[b]))],
    option: optionKind && next.declined
      ? { kind: optionKind, ifDeclined: LEGACY[next.declined.status], between: [...new Set(next.declined.between.map((b) => LEGACY[b]))] }
      : null,
    reason: status === 'indeterminate' ? (next.reasons[0] ?? next.basis) : next.basis,
  };
}

/**
 * A season's cost as Player Value's timeline serves it (phase 4a), for display: the band (a point for a
 * contract season), its basis in words, and whether it was measured on this save or rests on the
 * provisional prior. Nothing is priced here; an unknown cost keeps its reason, never $0.
 */
export interface SeasonCost {
  season: number;
  status: ControlSeason['status'];
  low: number | null;
  high: number | null;
  /**
   * The reading at the centre of the band (phase 4a review); a contract's salary is its own. Null where the season
   * lies between statuses Player Rights leaves open: `centrals` then names each status's, and none is chosen.
   */
  central: number | null;
  centrals: Array<{ status: string; central: number; arbitrationClass?: number }> | null;
  /** The basis in words, or why the cost is unknown. */
  text: string;
  /** measured, provisional_prior or measured_thin_with_prior; null for a contract season or an unknown cost. */
  source: string | null;
  /** He may be a free agent instead, or the player decides: the band is what he costs if the club holds him. */
  ifHeld: boolean;
  /**
   * For an option or opt-out season: the declined branch, with what he falls to and its cost (null where control
   * ends there: no cost to this club), so the option is shown on both branches (review R1-06).
   */
  declined: { kind: string; status: ControlSeason['status']; cost: SeasonCost | null } | null;
}

type CostOf = Pick<ControlSeason, 'season' | 'status' | 'cost' | 'costBasis'>;

function costOf(season: CostOf): SeasonCost | null {
  if (season.cost === null) return null;
  const v = season.cost.value;
  const point = v !== null && v.low === v.high && season.costBasis == null;
  return {
    season: season.season,
    status: season.status,
    low: v?.low ?? null,
    high: v?.high ?? null,
    central: v === null ? null : v.central !== undefined ? v.central : point ? v.low : null,
    centrals: season.costBasis?.centrals ?? null,
    text: season.cost.note ?? (point ? 'The contract\'s salary.' : 'Not established.'),
    source: season.costBasis?.source ?? null,
    ifHeld: season.costBasis?.ifHeld ?? false,
    declined: null,
  };
}

export function seasonCost(season: ControlSeason | undefined | null): SeasonCost | null {
  if (!season) return null;
  const own = costOf(season);
  if (own === null || !season.declined) return own;
  const d = season.declined;
  return {
    ...own,
    declined: { kind: d.kind, status: d.status, cost: costOf({ season: season.season, status: d.status, cost: d.cost, costBasis: d.costBasis ?? null }) },
  };
}

/** "arbitration 2" or "arbitration 2-3" when the rest of the season or an earlier winter leaves it open. */
export function arbitrationLabel(control: Control): string {
  const n = control.arbYearHigh !== null ? `${control.arbYear}-${control.arbYearHigh}` : `${control.arbYear ?? ''}`;
  return `arbitration ${n}`.trim() + (control.superTwo ? ' (Super Two)' : '');
}

/** "club option" or "opt-out", for a flag. */
export function optionLabel(control: Control): string {
  const kind = control.option?.kind;
  return kind === 'opt_out' ? 'opt-out' : kind ? `${kind} option` : 'option';
}


/**
 * The club finance cards on Contracts and Free Agents, from Club Finances (D-052): the same figure
 * Payroll shows, and a figure the export does not state is null, never $0 (D-18).
 */
export interface FinanceCards {
  budget: number | null;
  payroll: number | null;
  payrollNextSeason: number | null;
  cash: number | null;
  /** Where each figure comes from, or why it is unknown. */
  sources: Record<'budget' | 'payroll' | 'payrollNextSeason' | 'cash', string | null>;
}

export function financeCards(teamId: number): FinanceCards {
  const f = clubFinances(teamId);
  const why = (s: Sourced<number>) => [s.source, s.note].filter(Boolean).join(' — ') || null;
  return {
    budget: f.budget.value,
    payroll: f.payroll.now.value,
    payrollNextSeason: f.payroll.nextSeason.value,
    cash: f.cashForTrades.value,
    sources: { budget: why(f.budget), payroll: why(f.payroll.now), payrollNextSeason: why(f.payroll.nextSeason), cash: why(f.cashForTrades) },
  };
}

export function computeContracts(orgId: number) {
  const org = db.prepare(`SELECT league_id FROM teams WHERE team_id = ?`).get(orgId) as
    | { league_id: number }
    | undefined;
  if (!org) throw new Error('Unknown org');
  const year = seasonYear(org.league_id);

  const contracts = contractsByPlayer();
  const values = valuesByPlayer();
  const { overallPct, talentPct } = mlbPercentiler(values);
  // What each man has actually done this season, so a percentile built out of
  // playing time cannot recommend an extension by itself
  const formByPlayer = seasonFormByPlayer(orgId);
  // The contract regime, resolved through the parent league; a rule the export
  // does not state stays unknown (D-052)
  const rules = leagueRulesForLeague(org.league_id).contract;
  const hasFreeAgency = rules.freeAgencyYears.value === null ? null : rules.freeAgencyYears.value > 0;

  const players = db
    .prepare(
      `SELECT p.player_id, p.first_name, p.last_name, p.age, p.position
       FROM players p
       LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id
       WHERE p.team_id = ? AND p.retired = 0 AND ${ON_ROSTER}`
    )
    .all(orgId) as Array<{
    player_id: number; first_name: string; last_name: string; age: number; position: number;
  }>;

  // Contract facts and the control timeline, from the one Player Value entry point
  const valuations = playerValues(players.map((p) => p.player_id));

  const rows = players
    .map((p) => {
      const c = contracts.get(p.player_id);
      // Placeholder rows: zero-year deals or ones with no valid end year
      if (!c || c.totalYears < 1 || c.controlledThrough < year) return null;
      // A signed extension is the club's real commitment, so it drives both the
      // years-left column and the recommendation
      const endYear = c.controlledThrough;
      const yearsAfterThis = c.extension
        ? Math.max(c.controlledThrough - year, 0)
        : c.yearsAfterThis;
      const timeline = valuations.get(p.player_id)?.control ?? null;
      /*
       * Where he lands next winter, as Player Value's timeline states it. The
       * projection adds only the part of this season still to be played (the
       * banked days already count what he has earned), and a threshold inside
       * that band leaves the season indeterminate rather than guessed.
       */
      const control = controlAfterThisSeason(timeline);
      const reachingFA = control === null || control.status === 'indeterminate' ? null : control.status === 'leaving';
      const arbYear = control?.status === 'arbitration' ? control.arbYear : null;
      // Service in the league's own service-year length, as years.days; unknown stays unknown, never 0
      const service = timeline?.eligibility?.service.now ?? null;
      const perYear = timeline?.eligibility?.serviceDaysPerYear.value ?? null;
      const serviceRead = serviceReading(service, perYear);
      const serviceYears = serviceRead.years;
      const oPct = overallPct(p.player_id);
      const tPct = talentPct(p.player_id);
      const form = formByPlayer.get(p.player_id) ?? null;
      const rec = recommend({
        age: p.age,
        yearsAfterThis,
        reachingFA,
        hasFreeAgency,
        overallPct: oPct,
        talentPct: tPct,
        salaryNow: c.salaryNow,
        form,
      });
      const flags: string[] = [];
      if (c.extension) {
        // Already locked up beyond the current deal — not a decision to make
        flags.push(`extended thru ${c.extension.endYear}`);
      } else if (yearsAfterThis === 0 && control) {
        if (control.status === 'reserve clause') {
          // The deal ends but he cannot leave — the club simply renews him
          flags.push('reserve clause');
        } else if (control.status === 'leaving') flags.push('expiring');
        else if (control.status === 'arbitration') {
          // Saying "team control" for an arbitration-eligible player hid the fact
          // that he still has arbitration years left, which read as "expiring"
          flags.push(arbitrationLabel(control));
        } else if (control.status === 'pre-arbitration') flags.push('pre-arbitration');
        else if (control.status === 'option') flags.push(optionLabel(control));
        // The export cannot establish which: said, not guessed
        else if (control.status === 'indeterminate') flags.push('control indeterminate');
      }
      if (c.lastYearTeamOption) flags.push('team option');
      if (c.lastYearPlayerOption) flags.push('player option');
      if (c.lastYearVestingOption) flags.push('vesting option');
      if (c.noTrade) flags.push('no-trade');
      const optOutFrom = valuations.get(p.player_id)?.contract.optOutFrom ?? null;
      if (optOutFrom !== null && optOutFrom > year) flags.push(`opt-out before ${optOutFrom}`);
      return {
        sortKey: yearsAfterThis + (yearsAfterThis === 0 && reachingFA !== true ? 0.5 : 0),
        player_id: p.player_id,
        name: `${p.first_name} ${p.last_name}`,
        age: p.age,
        positionName: POSITION_NAMES[p.position] ?? '?',
        salaryNow: c.salaryNow,
        totalYears: c.totalYears,
        yearsAfterThis,
        endYear,
        extension: c.extension,
        /** Whole years of service (for sorting); `service` is the years.days text. */
        serviceYears,
        service: serviceRead.text,
        arbYear,
        /** What happens after this season, with its basis; `indeterminate` names what is missing. */
        control,
        /** Next season's cost exactly as the timeline serves it (phase 4a): a band with its basis, or why it is unknown. */
        nextCost: seasonCost(timeline?.seasons.find((s) => s.season === year + 1)),
        overallPct: oPct,
        talentPct: tPct,
        /*
         * Sent whether or not it changed the recommendation, because this is
         * also what the assistants read. Handed a percentile and nothing else,
         * the GM briefing described a 93rd-percentile Value as a man
         * "performing at a 93rd-percentile MLB value" — a claim that figure
         * never made, and one it had nothing in front of it to doubt.
         */
        seasonForm: form,
        flags,
        recommendation: rec,
      };
    })
    .filter(Boolean) as Array<{ salaryNow: number; sortKey: number }>;

  rows.sort((a, b) => a.sortKey - b.sortKey || b.salaryNow - a.salaryNow);

  return {
    seasonYear: year,
    gameDate: currentGameDate(org.league_id),
    // Surfaced so the page can explain why it is talking about a reserve
    // clause instead of free agency
    rules,
    finances: financeCards(orgId),
    players: rows,
  };
}

contractRoutes.get('/contracts/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players') || !tableExists('players_contract')) {
    return res.status(400).json({ error: 'No contract data imported yet' });
  }
  try {
    res.json(computeContracts(Number(req.params.orgId)));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});
