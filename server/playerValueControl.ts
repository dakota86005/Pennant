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
 *                      status he would fall to)
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
  /** Which arbitration year, on each edge, for an arbitration season. */
  arbitrationYear: { low: number; high: number } | null;
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
      season, status: 'indeterminate', arbitrationYear: null, between: [], cost: costOfStatus('indeterminate'),
      from: 'player_rights', basis: 'Arbitration and free-agency eligibility could not be stated.', reasons: blocking, crossings: [],
    };
  }
  const status = statusOfStanding(e.standing);
  const between = e.between.map(statusOfStanding);
  const reasonsFor = status === 'indeterminate' ? missingText(e) : [];
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
    season, status, arbitrationYear: status === 'arbitration' ? e.arbitration.trip : null, between,
    cost: costOfStatus(status), from: 'player_rights', basis, reasons: [...reasonsFor, ...e.crossings.map((c) => c.message)],
    crossings: e.crossings,
  };
}

const OPTION_STATUS: Record<NonNullable<ContractSeason['option']>, ControlStatus> = {
  club: 'club_option', player: 'player_option', vesting: 'vesting_option',
};

export interface ControlInput {
  playerId: number;
  holder: Sourced<number>;
  contract: ContractFacts;
  /** Player Rights' answer for this player, from this season on; null when it could not be asked. */
  eligibility: ContractControlEligibility | null;
  /** How many seasons to lay out, this one included (the horizon, Q-3). */
  horizon: number;
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
      notes: [...notes, `The current season is not known, so no season can be laid out: ${why}.`],
    };
  }

  const blocking = (eligibility?.missing ?? []).map((m) => m.message);
  const minorLeague = contract.kind.value === 'minor_league';
  const seasons: ControlSeason[] = [];
  let controlEnds: number | null = null;

  for (let k = 0; k < Math.max(1, input.horizon); k += 1) {
    const season = thisSeason + k;
    const e = eligibility?.seasons.find((x) => x.season === season);
    const covered = contractSeasonFor(contract, season);

    if (covered) {
      const status = covered.option ? OPTION_STATUS[covered.option] : 'under_contract';
      const fallback = fromEligibility(e, season, blocking);
      const salaryText = covered.salary.value !== null ? `$${covered.salary.value.toLocaleString('en-US')}` : 'a salary the export does not state';
      seasons.push({
        season, status, arbitrationYear: null, between: [],
        cost: salaryBand(covered.salary),
        declined: covered.option
          ? {
              buyout: (covered.from === 'extension' ? contract.extension : contract.term)?.buyout
                ?? unknownBecause('not_exported_by_ootp', 'players_contract.last_year_option_buyout'),
              status: fallback.status, between: fallback.between, cost: fallback.cost,
            }
          : null,
        from: covered.from,
        basis: covered.option
          ? `A ${covered.option} option season: exercised, ${salaryText}; declined, the buyout and then ${fallback.status.replace('_', ' ')}.`
          : `Under ${covered.from === 'extension' ? 'a signed extension' : 'contract'} at ${salaryText}.`,
        reasons: covered.option ? fallback.reasons : [],
        crossings: covered.option ? fallback.crossings : [],
      });
      continue;
    }

    if (k === 0 && contract.standing === 'no_terms') {
      // On a club this season with no exported term covering it: held, at a cost the export does not state
      seasons.push({
        season, status: 'under_contract', arbitrationYear: null, between: [],
        cost: unknownBecause('not_exported_by_ootp', 'players_contract.years', minorLeague
          ? 'A minor-league contract whose salary and term the export does not carry; unknown, never $0 (Q-5).'
          : 'The contract row carries no term for this season.'),
        declined: null, from: 'contract',
        basis: 'On the club this season under a contract whose term the export does not carry.',
        reasons: [], crossings: [],
      });
      continue;
    }

    if (contract.standing === 'no_contract_row' || contract.standing === 'unavailable' || contract.kind.value === null) {
      seasons.push({
        season, status: 'indeterminate', arbitrationYear: null, between: [], cost: costOfStatus('indeterminate'),
        declined: null, from: 'none',
        basis: 'His contract is not in the export, so what holds him cannot be stated.',
        reasons: contract.notes, crossings: [],
      });
      continue;
    }

    if (minorLeague) {
      seasons.push({
        season, status: 'indeterminate', arbitrationYear: null, between: [], cost: costOfStatus('indeterminate'),
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
  if (continuesPastHorizon) notes.push(`Control continues past ${last.season}, the last season the timeline shows.`);
  return { ...base, standing: 'held', thisSeason, seasons, controlEnds, continuesPastHorizon, notes };
}
