/**
 * Player Value, concern 2: the control and cost path, season by season (PLAYER_VALUE.md Part 2.2).
 *
 * Pure. It composes two answers it does not own: the contract facts (concern 1) and Player
 * Rights' arbitration and free-agency eligibility (owner Q-1, D-023). It never compares service
 * time with a threshold itself; a season the contract does not cover takes Player Rights'
 * standing as it is, indeterminate included.
 *
 * What it owns is the COST attached to each status:
 *
 *   under contract     the contract's salary, a point, where the export states it
 *   option             both branches: exercised (the salary) and declined (the buyout, and the
 *                      status he would fall to). Only a FUTURE season: the season under way had
 *                      its option decided before it began, so it is under contract
 *   opt-out            both branches: he stays (the salary) or walks away (his Player Rights
 *                      standing), for every season from the one the exported count reads
 *   pre-arbitration    unknown until the price of a win exists (phases 2 and 4) — never the minimum
 *   arbitration (n)    unknown likewise — never the minimum, never a point
 *   free agent         control ends: no cost to this club
 *   reserve clause     unknown until the league's observed pay is read (phase 2)
 *   indeterminate      unknown, with the statuses it lies between
 *
 * Nothing here reads a rating, `players_value`, philosophy, the protection tier or defensibility.
 */

import type { ContractFacts, ContractSeason } from './playerValueContract.js';
import { contractSeasonFor } from './playerValueContract.js';
import { COST_PENDING_OBSERVED_PAY, COST_PENDING_PRICE_OF_A_WIN } from './playerValueCalibration.js';
import type { ContractControlEligibility, ControlStanding, SeasonControlEligibility, ThresholdCrossing } from './playerRights.js';
import { fromExport, unknownBecause, UNKNOWN_REASON_TEXT, type Sourced } from './provenance.js';

export type ControlStatus =
  | 'under_contract'
  | 'club_option'
  | 'player_option'
  | 'vesting_option'
  /** Either side may decline it. */
  | 'mutual_option'
  /** Under the deal at its salary unless he opts out before it (the declined branch). */
  | 'opt_out'
  | 'pre_arbitration'
  | 'arbitration'
  /** Control ends: he can leave. */
  | 'free_agent'
  | 'reserve_clause'
  | 'indeterminate';

/** What the club would pay in a season, low to high, in the save's dollars. A point has low = high. */
export interface CostBand {
  low: number;
  high: number;
}

export interface DeclinedBranch {
  /** An option declined, or the player opting out of the deal. */
  kind: 'option_declined' | 'opted_out';
  /** The buyout the club (or player) pays to decline; unknown where the export does not populate it. */
  buyout: Sourced<number>;
  /** What he falls to that season if the option is declined. */
  status: ControlStatus;
  between: ControlStatus[];
  cost: Sourced<CostBand> | null;
}

export interface ControlSeason {
  season: number;
  status: ControlStatus;
  /** Which arbitration year by service class (3.x years is the first), on each edge, for an arbitration season. */
  arbitrationYear: { low: number; high: number } | null;
  /** An arbitration season reached as a Super Two, from the year before the arbitration line. */
  superTwo: boolean;
  /** For an indeterminate season: the statuses it lies between, in order; empty when nothing bounds it. */
  between: ControlStatus[];
  /** The club's cost that season; null only for a free agent (control ends, no cost to this club). */
  cost: Sourced<CostBand> | null;
  /** For an option season: the declined branch. The exercised branch is `cost`. */
  declined: DeclinedBranch | null;
  /** Where the status comes from. */
  from: 'contract' | 'extension' | 'player_rights' | 'none';
  /** One line: why this status. */
  basis: string;
  /** What is missing or uncertain, in words. */
  reasons: string[];
  /** A threshold inside the service projection: the season on each side. */
  crossings: ThresholdCrossing[];
}

export interface ControlTimeline {
  playerId: number;
  /** `players.organization_id` — the organization holding him. */
  holder: Sourced<number>;
  /** Held by a club, with no club, or not establishable. */
  standing: 'held' | 'unsigned' | 'unknown';
  thisSeason: number | null;
  seasons: ControlSeason[];
  /** The first season he is a free agent on every edge; null when that is not within the timeline. */
  controlEnds: number | null;
  /** Control runs past the last season shown (the horizon, Q-3). */
  continuesPastHorizon: boolean;
  /** A signed extension follows the current deal (it may start past the last season shown). */
  extensionSigned: boolean;
  /** Player Rights' eligibility the timeline was composed from. */
  eligibility: ContractControlEligibility | null;
  notes: string[];
}

const STANDING_STATUS: Record<Exclude<ControlStanding, 'indeterminate'>, ControlStatus> = {
  pre_arbitration: 'pre_arbitration',
  arbitration: 'arbitration',
  free_agency: 'free_agent',
  reserve_clause: 'reserve_clause',
};

const statusOfStanding = (s: ControlStanding): ControlStatus => (s === 'indeterminate' ? 'indeterminate' : STANDING_STATUS[s]);

const pending = (note: string): Sourced<CostBand> => unknownBecause<CostBand>('rule_not_implemented', null, note);

/** The cost that attaches to a status Player Rights decided (not a contract season). */
function costOfStatus(status: ControlStatus): Sourced<CostBand> | null {
  switch (status) {
    case 'free_agent':
      return null;
    case 'reserve_clause':
      return pending(COST_PENDING_OBSERVED_PAY);
    case 'indeterminate':
      return pending(`The season's control status is indeterminate; the cost of each status it could be is ${COST_PENDING_PRICE_OF_A_WIN}.`);
    default:
      return pending(COST_PENDING_PRICE_OF_A_WIN);
  }
}

function salaryBand(salary: Sourced<number>): Sourced<CostBand> {
  if (salary.value === null) {
    return { value: null, provenance: 'unknown', source: salary.source, reason: salary.reason, ...(salary.note ? { note: salary.note } : {}) };
  }
  return fromExport({ low: salary.value, high: salary.value }, salary.source ?? 'players_contract');
}

const missingText = (e: SeasonControlEligibility): string[] => {
  const out = new Set<string>();
  for (const m of [...e.freeAgency.missing, ...e.arbitration.missing]) out.add(m.message);
  return [...out];
};

/** A season the contract does not cover, as Player Rights' eligibility states it. */
function fromEligibility(e: SeasonControlEligibility | undefined, season: number, blocking: string[]): Omit<ControlSeason, 'declined'> {
  if (!e) {
    return {
      season, status: 'indeterminate', arbitrationYear: null, superTwo: false, between: [], cost: costOfStatus('indeterminate'),
      from: 'player_rights', basis: 'Arbitration and free-agency eligibility could not be stated.', reasons: blocking, crossings: [],
    };
  }
  const status = statusOfStanding(e.standing);
  const between = e.between.map(statusOfStanding);
  const reasonsFor = status === 'indeterminate' ? missingText(e) : [];
  if (status === 'arbitration' && e.arbitration.tripNote) reasonsFor.push(e.arbitration.tripNote);
  let basis: string;
  switch (status) {
    case 'free_agent': basis = e.freeAgency.reasons[0]?.message ?? 'Past the free-agency line.'; break;
    case 'arbitration': basis = e.arbitration.reasons[0]?.message ?? 'Past the arbitration line.'; break;
    case 'pre_arbitration': basis = e.arbitration.reasons[0]?.message ?? e.freeAgency.reasons[0]?.message ?? 'Short of the arbitration line.'; break;
    case 'reserve_clause': basis = e.freeAgency.reasons[0]?.message ?? 'A reserve clause binds him.'; break;
    default: basis = between.length > 0
      ? `Between ${between.map((s) => s.replace('_', ' ')).join(' and ')}: which one is not yet established.`
      : 'His control status cannot be stated.';
  }
  return {
    season, status, arbitrationYear: status === 'arbitration' ? e.arbitration.trip : null,
    superTwo: status === 'arbitration' && e.arbitration.superTwo, between,
    cost: costOfStatus(status), from: 'player_rights', basis, reasons: [...reasonsFor, ...e.crossings.map((c) => c.message)],
    crossings: e.crossings,
  };
}

const OPTION_STATUS: Record<NonNullable<ContractSeason['option']>, ControlStatus> = {
  club: 'club_option', player: 'player_option', vesting: 'vesting_option', mutual: 'mutual_option',
};

const OPT_OUT_TIMING =
  "The export carries the opt-out as a count, read here as after that contract year; the timing is read, not established (R-6).";

/** What a blank contract row leaves open after this season, where he is not on a major-league club with service. */
const AFTER_BLANK_ROW =
  'What follows a blank contract row (renewal, a place on the 40-man, or minor-league free agency) is not established from the export.';

export interface ControlInput {
  playerId: number;
  holder: Sourced<number>;
  contract: ContractFacts;
  /** Player Rights' answer for this player, from this season on; null when it could not be asked. */
  eligibility: ContractControlEligibility | null;
  /** How many seasons to lay out, this one included (the horizon, Q-3). */
  horizon: number;
  /**
   * Whether Player State places him on a major-league club (`teams.level` 1); null when unknown. A
   * blank contract row there, with major-league service, is read through his Player Rights standing.
   */
  majorLeagueClub?: boolean | null;
}

/**
 * The season-by-season control timeline: from this season until control ends, at most `horizon`
 * seasons. Every season carries its status, cost band and basis.
 */
export function composeControlTimeline(input: ControlInput): ControlTimeline {
  const { contract, eligibility } = input;
  const notes = [...contract.notes];
  const base = { playerId: input.playerId, holder: input.holder, eligibility, extensionSigned: contract.extension !== null };
  const thisSeason = eligibility?.thisSeason.value ?? null;

  if (contract.standing === 'unsigned') {
    return {
      ...base, standing: 'unsigned', thisSeason, seasons: [], controlEnds: null, continuesPastHorizon: false,
      notes: [...notes, 'No club holds him (players.team_id is 0): he is under no club\'s control.'],
    };
  }
  if (thisSeason === null) {
    const why = eligibility?.thisSeason.note
      ?? (eligibility?.thisSeason.reason ? UNKNOWN_REASON_TEXT[eligibility.thisSeason.reason] : 'the league\'s rules are not available');
    return {
      ...base, standing: 'unknown', thisSeason, seasons: [], controlEnds: null, continuesPastHorizon: false,
      notes: [...notes, `The current season is not known, so no season can be laid out: ${why.replace(/\.$/, '')}.`],
    };
  }

  const blocking = (eligibility?.missing ?? []).map((m) => m.message);
  const minorLeague = contract.kind.value === 'minor_league';
  const blankRow = contract.standing === 'no_terms' && contract.kind.value === null;
  const seasons: ControlSeason[] = [];
  let controlEnds: number | null = null;

  // ── the opt-out, as the exported count reads (A-05) ──
  const optOutFrom = contract.optOutFrom;
  const covered = [...(contract.term?.seasons ?? []), ...(contract.extension?.seasons ?? [])].map((c) => c.season);
  const lastCovered = covered.length > 0 ? Math.max(...covered) : null;
  let optOutLive = false;
  if (optOutFrom !== null && contract.optOut.value !== null) {
    const n = contract.optOut.value;
    if (optOutFrom <= thisSeason) {
      notes.push(`An opt-out is exported (opt_out ${n}); read as after contract year ${n}, before ${optOutFrom}, it has passed and he is playing under the deal. ${OPT_OUT_TIMING}`);
    } else if (lastCovered === null || optOutFrom > lastCovered) {
      notes.push(`An opt-out is exported (opt_out ${n}); read as after contract year ${n}, before ${optOutFrom}, it lies past the seasons the contract covers, so which season it follows is not established (R-6).`);
    } else {
      optOutLive = true;
      notes.push(`An opt-out is exported (opt_out ${n}): read as after contract year ${n}, he may opt out before ${optOutFrom}, so every season from ${optOutFrom} shows both branches. ${OPT_OUT_TIMING}`);
    }
  }

  for (let k = 0; k < Math.max(1, input.horizon); k += 1) {
    const season = thisSeason + k;
    const e = eligibility?.seasons.find((x) => x.season === season);
    const cover = contractSeasonFor(contract, season);

    if (cover) {
      const fallback = fromEligibility(e, season, blocking);
      const salaryText = cover.salary.value !== null ? `$${cover.salary.value.toLocaleString('en-US')}` : 'a salary the export does not state';
      const deal = cover.from === 'extension' ? 'a signed extension' : 'contract';
      const term = cover.from === 'extension' ? contract.extension : contract.term;
      const afterOptOut = optOutLive && optOutFrom !== null && season >= optOutFrom;
      const optOutReason = afterOptOut
        ? `He may opt out before ${optOutFrom} (opt_out ${contract.optOut.value}); if he does, he is ${fallback.status.replace('_', ' ')} this season. ${OPT_OUT_TIMING}`
        : null;
      const unknownOption = k > 0 && cover.optionUnknown ? cover.optionUnknown : null;
      const extra = [optOutReason, unknownOption].filter((x): x is string => x !== null);

      if (cover.option && k === 0) {
        // The season under way: its option was decided before it began (A-03)
        seasons.push({
          season, status: 'under_contract', arbitrationYear: null, superTwo: false, between: [],
          cost: salaryBand(cover.salary), declined: null, from: cover.from,
          basis: `Under ${deal} at ${salaryText}: this season's ${cover.option} option was decided before it began, and he is playing it.`,
          reasons: extra, crossings: [],
        });
        continue;
      }
      if (cover.option) {
        seasons.push({
          season, status: OPTION_STATUS[cover.option], arbitrationYear: null, superTwo: false, between: [],
          cost: salaryBand(cover.salary),
          declined: {
            kind: 'option_declined',
            buyout: term?.buyout ?? unknownBecause('not_exported_by_ootp', 'players_contract.last_year_option_buyout'),
            status: fallback.status, between: fallback.between, cost: fallback.cost,
          },
          from: cover.from,
          basis: `A ${cover.option} option season: exercised, ${salaryText}; declined, the buyout and then ${fallback.status.replace('_', ' ')}.`,
          reasons: [...fallback.reasons, ...extra],
          crossings: fallback.crossings,
        });
        continue;
      }
      if (afterOptOut && k > 0) {
        seasons.push({
          season, status: 'opt_out', arbitrationYear: null, superTwo: false, between: [],
          cost: salaryBand(cover.salary),
          declined: {
            kind: 'opted_out',
            buyout: unknownBecause('not_exported_by_ootp', 'players_contract.opt_out', 'The export carries no payment for an opt-out.'),
            status: fallback.status, between: fallback.between, cost: fallback.cost,
          },
          from: cover.from,
          basis: `Under ${deal} at ${salaryText} unless he opts out before ${optOutFrom}; if he opts out, ${fallback.status.replace('_', ' ')}.`,
          reasons: [...extra, ...fallback.reasons],
          crossings: fallback.crossings,
        });
        continue;
      }
      seasons.push({
        season, status: 'under_contract', arbitrationYear: null, superTwo: false, between: [],
        cost: salaryBand(cover.salary), declined: null, from: cover.from,
        basis: `Under ${deal} at ${salaryText}.`,
        reasons: extra, crossings: [],
      });
      continue;
    }

    if (k === 0 && contract.standing === 'no_terms') {
      // On a club this season with no exported term covering it: held, at a cost the export does not state
      seasons.push({
        season, status: 'under_contract', arbitrationYear: null, superTwo: false, between: [],
        cost: unknownBecause('not_exported_by_ootp', 'players_contract.years', blankRow
          ? 'His contract row is blank (no term, salary or paying club): what he is paid this season is not exported; unknown, never $0.'
          : 'The contract row carries no term for this season.'),
        declined: null, from: 'contract',
        basis: blankRow
          ? 'On the club this season under a contract the export leaves blank.'
          : 'On the club this season under a contract whose term the export does not carry.',
        reasons: [], crossings: [],
      });
      continue;
    }

    if (blankRow) {
      // A blank row is not a minor-league contract (C-07). Where Player State places him on a major-league club
      // with major-league service, what follows this season is his Player Rights standing, the blank row named
      const service = eligibility?.service.now ?? null;
      if (input.majorLeagueClub === true && service !== null && service.low > 0) {
        const row = fromEligibility(e, season, blocking);
        const named = `His contract row is blank, so a deal the export does not carry could still cover ${season}; ${row.status === 'free_agent' ? 'free agency is therefore not certain' : 'the standing shown is his Player Rights answer'}.`;
        if (row.status === 'free_agent' || (row.status === 'indeterminate' && row.between.includes('free_agent'))) {
          seasons.push({
            ...row, status: 'indeterminate', declined: null, arbitrationYear: null, superTwo: false,
            between: ['under_contract', ...row.between.filter((b) => b !== 'under_contract'), ...(row.status === 'free_agent' ? ['free_agent' as const] : [])],
            cost: costOfStatus('indeterminate'),
            basis: `Past the free-agency line by his service, unless a deal the export does not carry holds him: his contract row is blank.`,
            reasons: [named, ...row.reasons],
          });
          continue;
        }
        seasons.push({ ...row, declined: null, reasons: [named, ...row.reasons] });
        continue;
      }
      seasons.push({
        season, status: 'indeterminate', arbitrationYear: null, superTwo: false, between: [], cost: costOfStatus('indeterminate'),
        declined: null, from: 'none',
        basis: 'After a contract row the export leaves blank.',
        reasons: [AFTER_BLANK_ROW],
        crossings: [],
      });
      continue;
    }

    if (contract.standing === 'no_contract_row' || contract.standing === 'unavailable' || contract.kind.value === null) {
      seasons.push({
        season, status: 'indeterminate', arbitrationYear: null, superTwo: false, between: [], cost: costOfStatus('indeterminate'),
        declined: null, from: 'none',
        basis: 'His contract is not in the export, so what holds him cannot be stated.',
        reasons: contract.notes, crossings: [],
      });
      continue;
    }

    if (minorLeague) {
      seasons.push({
        season, status: 'indeterminate', arbitrationYear: null, superTwo: false, between: [], cost: costOfStatus('indeterminate'),
        declined: null, from: 'none',
        basis: 'After a minor-league contract.',
        reasons: [
          'What follows a minor-league contract (renewal, a place on the 40-man, or minor-league free agency under rules_minor_league_fa_minimum_years, counted on a service the export does not name) is not established from the export.',
        ],
        crossings: [],
      });
      continue;
    }

    const row = fromEligibility(e, season, blocking);
    seasons.push({ ...row, declined: null });
    if (row.status === 'free_agent') {
      controlEnds = season;
      break;
    }
  }

  const last = seasons[seasons.length - 1];
  const continuesPastHorizon = controlEnds === null && last !== undefined && last.status !== 'indeterminate';
  if (continuesPastHorizon) {
    notes.push(optOutLive && optOutFrom !== null
      ? `Under contract past ${last.season}, the last season the timeline shows, unless he opts out before ${optOutFrom}.`
      : `Control continues past ${last.season}, the last season the timeline shows.`);
  }
  return { ...base, standing: 'held', thisSeason, seasons, controlEnds, continuesPastHorizon, notes };
}
