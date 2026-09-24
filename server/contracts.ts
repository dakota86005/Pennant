import { Router } from 'express';
import { db, tableExists } from './db.js';
import { freshnessCue, getDataStatus, type DataStatus } from './dataStatus.js';
import { seasonFormByPlayer } from './form.js';
import { leagueRulesForLeague } from './leagueRules.js';
import { resolvePhilosophy } from './philosophy.js';
import {
  clubFinances, contractSeasonFor, controlEndOf, controlSeasonLabel, lensPhilosophyFrom, ourViewOf, playerValues, serviceReading,
  type ContractFacts, type ControlEnd, type ControlSeason, type ControlTimeline, type LensPhilosophy, type OurView, type PlayerSurplus,
  type PlayerValuation, type SurplusTotal,
} from './playerValue.js';
import type { Sourced } from './provenance.js';
import { philosophyForOrg } from './settings.js';
import { currentGameDate, ON_ROSTER } from './valuation.js';

/**
 * The Contracts page (Player Value phase 6a, PLAYER_VALUE.md Part 8): each contract the club holds, what happens after
 * this season and when control ends, next season's cost and his cost path, his expected wins, his contract value and the
 * value of keeping him, and our view under the club's philosophy, every figure Player Value's answer as the card is
 * served it. It describes and never authorizes (D-052): no recommendation, no percentile of OOTP's value (the
 * percentile advice and the `players_value` reads were deleted in this change). The GM decides.
 */
export const contractRoutes = Router();

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

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
  /** The arbitration classes the band covers (more than one is a range of classes: Payroll keeps it at its edges); null where none. */
  classes: number[] | null;
  /** Each covered arbitration class's central (the class range's edges for Payroll's sum); null where none. */
  classCentrals: number[] | null;
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
    classes: season.costBasis?.classes && season.costBasis.classes.length > 0 ? season.costBasis.classes : null,
    classCentrals: season.costBasis?.classCentrals && season.costBasis.classCentrals.length > 0 ? season.costBasis.classCentrals.map((c) => c.central) : null,
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

// ── the page's reading of one player (shared with the card's header) ───────────

/** Where he stands after this season, in the page's groups: the order a GM works through them. */
export type ContractGroup = 'leaving' | 'option' | 'arbitration' | 'pre_arbitration' | 'reserve' | 'not_settled' | 'signed' | 'long_term';

/** Signed three seasons or more past this one: a long-term commitment. */
const LONG_TERM = 3;

/**
 * His contract in a phrase's parts, from Player Value's contract facts and control (the card's header and each row on
 * Contracts): this season's salary, how long he is signed, what happens after this season and when control ends. A
 * salary the export does not state is null with the reason, never $0 (D-018).
 */
export interface ContractSummary {
  standing: ContractFacts['standing'];
  kind: 'major_league' | 'minor_league' | null;
  thisSeason: number | null;
  salaryNow: number | null;
  /** Why this season's salary is not known; null where it is. */
  salaryNote: string | null;
  /** The last season a signed contract (or its extension) covers; null where none does. */
  signedThrough: number | null;
  extension: { from: number; to: number } | null;
  /** The contract's clauses in plain words: options by season, an opt-out, no-trade. */
  clauses: string[];
  /** Clauses the export does not state for a season still to come (an option flag it leaves blank), in words. */
  clauseNotes: string[];
  /** Next season, in words; null for a player no club holds. */
  after: { status: ControlStatus; label: string; phrase: string; detail: string | null } | null;
  controlEnd: ControlEnd;
}

const OPTION_WORDS: Record<string, string> = { club: 'Club option', player: 'Player option', vesting: 'Vesting option', mutual: 'Mutual option' };

/** Next season in words: a short label for a column and a phrase for the header. */
function afterWords(control: Control, thisSeason: number, signedThrough: number | null): NonNullable<ContractSummary['after']> {
  const next = thisSeason + 1;
  const detail = control.reason;
  switch (control.status) {
    case 'leaving': return { status: control.status, label: 'Free agent', phrase: `Free agent after ${thisSeason}`, detail };
    case 'signed': return { status: control.status, label: 'Signed', phrase: `Signed through ${signedThrough ?? next}`, detail };
    case 'extended': return { status: control.status, label: 'Extension', phrase: `Extension from ${next}`, detail };
    case 'option': {
      const kind = control.option?.kind;
      if (kind === 'opt_out') return { status: control.status, label: 'Can opt out', phrase: `Can opt out after ${thisSeason}`, detail };
      const words = OPTION_WORDS[kind ?? ''] ?? 'Option';
      return { status: control.status, label: words, phrase: `${words} for ${next}`, detail };
    }
    case 'arbitration': {
      const n = control.arbYear === null ? '' : control.arbYearHigh !== null ? ` ${control.arbYear}–${control.arbYearHigh}` : ` ${control.arbYear}`;
      const two = control.superTwo ? ' (Super Two)' : '';
      return { status: control.status, label: `Arbitration${n}${two}`, phrase: `Arbitration in ${next}${two}`, detail };
    }
    case 'pre-arbitration': return { status: control.status, label: 'Pre-arbitration', phrase: `Pre-arbitration in ${next}`, detail };
    case 'reserve clause': return { status: control.status, label: 'Reserve clause', phrase: `Reserve clause: stays in ${next}`, detail };
    default: return { status: control.status, label: 'Not settled', phrase: `${next} not settled yet`, detail };
  }
}

export function contractSummaryOf(v: PlayerValuation): ContractSummary {
  const c = v.contract;
  const thisSeason = v.control.thisSeason;
  const seasons = [...(c.term?.seasons ?? []), ...(c.extension?.seasons ?? [])];
  const signedThrough = seasons.length > 0 ? Math.max(...seasons.map((s) => s.season)) : null;
  const now = thisSeason === null ? null : contractSeasonFor(c, thisSeason);
  const salaryNow = now?.salary.value ?? null;
  const salaryNote = now === null
    ? (c.standing === 'signed' ? `No season of his contract covers ${thisSeason ?? 'this season'}.` : c.notes[0] ?? "His contract terms aren't in the export.")
    : salaryNow === null ? (now.salary.note ?? "His salary this season isn't in the export.") : null;
  const ext = c.extension?.seasons ?? [];
  const clauses: string[] = [];
  const clauseNotes: string[] = [];
  for (const s of seasons) {
    // The season under way had its option decided before it began (A-03): only a season still to come is open
    if (thisSeason !== null && s.season <= thisSeason) continue;
    if (s.option) clauses.push(`${OPTION_WORDS[s.option] ?? 'Option'} ${s.season}`);
    if (s.optionUnknown) clauseNotes.push(`${s.season}: ${s.optionUnknown}`);
  }
  if (c.optOutFrom !== null && (thisSeason === null || c.optOutFrom > thisSeason)) clauses.push(`Can opt out before ${c.optOutFrom}`);
  if (c.noTrade.value === true) clauses.push('No-trade');
  const control = controlAfterThisSeason(v.control);
  return {
    standing: c.standing,
    kind: c.kind.value,
    thisSeason,
    salaryNow,
    salaryNote,
    signedThrough,
    extension: ext.length > 0 ? { from: Math.min(...ext.map((s) => s.season)), to: Math.max(...ext.map((s) => s.season)) } : null,
    clauses,
    clauseNotes,
    after: control === null || thisSeason === null ? null : afterWords(control, thisSeason, signedThrough),
    controlEnd: controlEndOf(v.control),
  };
}

/** The Value section's headline totals as served (no seasons: the card's section and its breakdown carry those). */
export interface ValueSummary {
  status: PlayerSurplus['status'];
  reason: string | null;
  unit: PlayerSurplus['unit'];
  contract: SurplusTotal;
  retention: SurplusTotal;
  wins: SurplusTotal;
}

export function valueSummaryOf(s: PlayerSurplus | undefined): ValueSummary | null {
  if (!s) return null;
  return { status: s.status, reason: s.reason, unit: s.unit, contract: s.contract, retention: s.retention, wins: s.wins };
}

/** Our view as a row shows it: the lens's totals and each lean in a few words with its amount (the full read is the card's). */
export interface OurViewSummary {
  status: OurView['status'];
  leaning: boolean;
  contract: OurView['contract'];
  retention: OurView['retention'];
  wins: OurView['wins'];
  leans: Array<Pick<OurView['leans'][number], 'id' | 'short' | 'text' | 'by'>>;
  notes: Array<Pick<OurView['notes'][number], 'id' | 'short' | 'text'>>;
}

function ourViewSummaryOf(v: OurView): OurViewSummary {
  return {
    status: v.status, leaning: v.leaning, contract: v.contract, retention: v.retention, wins: v.wins,
    leans: v.leans.map((l) => ({ id: l.id, short: l.short, text: l.text, by: l.by })),
    notes: v.notes.map((n) => ({ id: n.id, short: n.short, text: n.text })),
  };
}

/** One season of his path: its control, what it costs this club and what he is expected to produce. */
export interface PathSeason {
  season: number;
  label: string;
  detail: string;
  cost: SeasonCost | null;
  wins: { low: number; central: number; high: number } | null;
}

/** The seasons after this one through the end of his control (or the last the timeline lays out). */
function pathOf(v: PlayerValuation, end: ControlEnd): PathSeason[] {
  const thisSeason = v.control.thisSeason;
  if (thisSeason === null || v.control.standing !== 'held') return [];
  const last = end.high ?? v.control.seasons[v.control.seasons.length - 1]?.season ?? thisSeason;
  return v.control.seasons
    .filter((s: ControlSeason) => s.season > thisSeason && s.season <= last && s.status !== 'free_agent')
    .map((s) => {
      const p = v.production.seasons.find((x) => x.season === s.season);
      return {
        season: s.season,
        label: controlSeasonLabel(s),
        detail: [s.basis, ...s.reasons].filter(Boolean).join(' '),
        cost: seasonCost(s),
        wins: p ? { low: p.wins.low, central: p.wins.central, high: p.wins.high } : null,
      };
    });
}

/** His expected wins next season, or why they are not established. */
function nextWins(v: PlayerValuation, next: number): { wins: { season: number; low: number; central: number; high: number } | null; reason: string | null } {
  const p = v.production.seasons.find((x) => x.season === next);
  if (p) return { wins: { season: next, low: p.wins.low, central: p.wins.central, high: p.wins.high }, reason: null };
  if (v.production.status !== 'projected') return { wins: null, reason: v.production.reason ?? 'His production is not established.' };
  const pending = v.production.notEstablished.find((x) => x.season === next);
  return { wins: null, reason: pending?.reason ?? `His production in ${next} is not projected.` };
}

function groupOf(control: Control | null, signedThrough: number | null, thisSeason: number): ContractGroup {
  switch (control?.status) {
    case 'leaving': return 'leaving';
    case 'option': return 'option';
    case 'arbitration': return 'arbitration';
    case 'pre-arbitration': return 'pre_arbitration';
    case 'reserve clause': return 'reserve';
    case 'signed':
    case 'extended': return signedThrough !== null && signedThrough - thisSeason >= LONG_TERM ? 'long_term' : 'signed';
    default: return 'not_settled';
  }
}

const GROUP_ORDER: ContractGroup[] = ['leaving', 'option', 'arbitration', 'pre_arbitration', 'reserve', 'not_settled', 'signed', 'long_term'];

/**
 * The page. `status` is how current the export is (D-022): handed to Player Value as `currentState`, so a stale export
 * leaves service-dependent figures not established (D-023), and said on the page with the game date (A-20).
 */
export function computeContracts(orgId: number, status: DataStatus = getDataStatus()) {
  const org = db.prepare(`SELECT league_id, name, nickname FROM teams WHERE team_id = ?`).get(orgId) as
    | { league_id: number; name: string | null; nickname: string | null }
    | undefined;
  if (!org) throw new Error('Unknown org');
  // The season is the league's own, as exported; never the wall-clock year (D-022)
  const rules = leagueRulesForLeague(org.league_id).contract;
  const year = rules.season.value;
  if (year === null) throw new Error(`The league's current season is not in the export: ${rules.season.note ?? 'no source states it'}`);
  const cue = freshnessCue(status);

  // What each man has done this season, as a fact beside his value (the assistants read it too)
  const formByPlayer = seasonFormByPlayer(orgId);
  // Our view: the club's philosophy, read here and handed to the lens at read time (Part 6); the neutral value never sees it
  const philosophy: LensPhilosophy = lensPhilosophyFrom(resolvePhilosophy(philosophyForOrg(orgId)));

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

  // Contract facts, control, production and value, from the one Player Value entry point, as current as the export is
  const valuations = playerValues(players.map((p) => p.player_id), { currentState: cue.state });
  const limitations = new Set<string>();

  const rows = players.flatMap((p) => {
    const v = valuations.get(p.player_id);
    if (!v) return [];
    const summary = contractSummaryOf(v);
    const control = controlAfterThisSeason(v.control);
    if (v.control.eligibility?.limitation) limitations.add(v.control.eligibility.limitation);
    // Service in the league's own service-year length, as years.days; unknown stays unknown, never 0
    const serviceRead = serviceReading(v.control.eligibility?.service.now ?? null, v.control.eligibility?.serviceDaysPerYear.value ?? null);
    const yearsAfterThis = summary.signedThrough === null ? null : Math.max(summary.signedThrough - year, 0);
    const flags: string[] = [];
    if (summary.extension) flags.push(`extended thru ${summary.extension.to}`);
    else if (control && (summary.signedThrough === null || summary.signedThrough <= year)) {
      if (control.status === 'reserve clause') flags.push('reserve clause');
      else if (control.status === 'leaving') flags.push('expiring');
      else if (control.status === 'arbitration') flags.push(arbitrationLabel(control));
      else if (control.status === 'pre-arbitration') flags.push('pre-arbitration');
      else if (control.status === 'option') flags.push(optionLabel(control));
      else if (control.status === 'indeterminate') flags.push('control indeterminate');
    }
    if (v.contract.noTrade.value === true) flags.push('no-trade');
    const surplus = v.surplus;
    const ours = surplus && v.control.standing !== 'unknown'
      ? ourViewOf({ neutral: surplus, philosophy, ours: v.control.holder.value === orgId })
      : null;
    const next = nextWins(v, year + 1);
    return [{
      player_id: p.player_id,
      name: `${p.first_name} ${p.last_name}`,
      age: p.age,
      positionName: POSITION_NAMES[p.position] ?? '?',
      group: groupOf(control, summary.signedThrough, year),
      ...summary,
      /** The last season his contract covers (the summary's `signedThrough`), for the assistants' older reading. */
      endYear: summary.signedThrough,
      yearsAfterThis,
      /** Whole years of service (for sorting); `service` is the years.days text. */
      serviceYears: serviceRead.years,
      service: serviceRead.text,
      arbYear: control?.status === 'arbitration' ? control.arbYear : null,
      /** What happens after this season, with its basis; `indeterminate` names what is missing. */
      control,
      /** Next season's cost exactly as the timeline serves it (phase 4a): a band with its basis, or why it is unknown. */
      nextCost: seasonCost(v.control.seasons.find((s) => s.season === year + 1)),
      path: pathOf(v, summary.controlEnd),
      wins: next.wins,
      winsReason: next.reason,
      value: valueSummaryOf(surplus),
      ourView: ours ? ourViewSummaryOf(ours) : null,
      /** This season's line, a fact beside the value (also what the assistants read). */
      seasonForm: formByPlayer.get(p.player_id) ?? null,
      flags,
    }];
  });

  // The groups in the order a GM works through them, the biggest salary first within each
  rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (b.salaryNow ?? -1) - (a.salaryNow ?? -1));

  const priced = rows.map((r) => valuations.get(r.player_id)?.surplus?.price).find((x) => x != null) ?? null;
  return {
    seasonYear: year,
    gameDate: currentGameDate(org.league_id),
    freshness: { ...cue, limitations: [...limitations] },
    organization: { id: orgId, name: [org.name, org.nickname].filter(Boolean).join(' ') || null },
    // Surfaced so the page can explain why it is talking about a reserve clause instead of free agency
    rules,
    finances: financeCards(orgId),
    /** The price of a win in force for the club's league, as the surplus reads it: context for the value columns. */
    price: priced ? { stage: priced.stage, band: priced.band, text: priced.text } : null,
    players: rows,
  };
}

contractRoutes.get('/contracts/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players') || !tableExists('players_contract')) {
    return res.status(400).json({ error: 'No contract data imported yet' });
  }
  try {
    res.json(computeContracts(orgId));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});
