/**
 * The player card's production cone (PLAYER_VALUE.md Part 8): Player Value's own two answers, expected
 * production (concern 3) and the control timeline (concern 2), joined season by season so the card can
 * draw them without recomputing either.
 *
 * Pure. It reads nothing and decides nothing: every band, central, coverage figure and control status is
 * carried exactly as production and control state them. It chooses only which seasons the card shows
 * (this season to the last controlled season, capped by the production horizon; the whole horizon where
 * the end of control is not established) and words them. Unknown production stays unknown: no season,
 * the reason stated, never a zero line or an average (D-018); a season not established after established ones
 * (hardening F6) keeps its slot and control, with its reason and no band.
 */

import type { ControlSeason, ControlStatus, ControlTimeline, CostBand } from './playerValueControl.js';
import type { PlayerProduction, ProductionSeason } from './playerValueProduction.js';

/** A season's control as the card labels it: Player Value's status, or no status where none is stated. */
export type ConeControlStatus = ControlStatus | 'not_established' | 'unsigned';

export interface ConeBand {
  low: number;
  high: number;
}

/** A season's cost on the card: a band with its central (null between statuses), or a contract's point. */
export interface ConeCost extends ConeBand {
  central?: number | null;
}

/** An option or opt-out season's declined branch on the card. */
export interface ConeDeclined {
  status: ControlStatus;
  label: string;
  cost: ConeCost | null;
  /** The player decides the branch: what he costs if the club still holds him. */
  ifHeld: boolean;
  costDetail: string;
}

/** A band's coverage target beside what the fit in force observed; observed is null when not measured. */
export interface ConeCoverage {
  target: number;
  observed: number | null;
}

/** Three lengths of one label: in full, shortened, and a code for the narrowest card (with a key). */
interface Labels {
  label: string;
  short: string;
  code: string;
}

export interface ConeControl extends Labels {
  status: ConeControlStatus;
  /** Why this status, in words: the timeline's basis and what is missing. */
  detail: string;
  /**
   * What the club would pay that season, exactly as the timeline serves it (phase 4a): the contract's salary, or a
   * priced renewal or arbitration band (a range of reasonable readings, with its central); null where it is unknown
   * or where control has ended (no cost to this club).
   */
  cost: ConeCost | null;
  /** The cost's basis in words, or why it is unknown; an option's names its declined branch too. */
  costDetail: string;
  /** He may be a free agent instead: the band is what he costs if held (phase 4a review). */
  ifHeld: boolean;
  /** An option or opt-out season's declined branch: what he falls to and its cost (review R1-06). */
  declined: ConeDeclined | null;
  /** Set on the last controlled season when free agency follows it. */
  after: Labels | null;
}

export interface ConeSeason {
  season: number;
  age: number;
  central: number;
  /** The 80% band. */
  outer: ConeBand;
  /** The 50% band, inside the 80%. */
  inner: ConeBand;
  /** This season only: the WAR he has banked, a fact. */
  toDate: number | null;
  /** Expected opportunities per side, with the usage band (80%): plate appearances or batters faced. */
  usage: Array<{ unit: 'PA' | 'BF'; low: number; central: number; high: number }>;
  coverage: { outer: ConeCoverage; inner: ConeCoverage; cases: number | null; note: string };
  control: ConeControl;
  notes: string[];
}

/**
 * A season of the cone whose production is not established (hardening F6: the arrival model adopted horizon by
 * horizon). The card keeps its slot and its control, and draws no band and no central there: only why.
 */
export interface ConeUnestablished {
  season: number;
  age: number;
  reason: string;
  control: ConeControl;
}

export interface ProductionCone {
  playerId: number;
  status: PlayerProduction['status'];
  /** Why production is unknown; null when projected. */
  reason: string | null;
  unit: string;
  seasons: ConeSeason[];
  /** The seasons after `seasons`, within control and the horizon, whose production is not established (hardening F6). */
  notEstablished: ConeUnestablished[];
  /** What the projection rests on: the seasons read and their plate appearances or batters faced. */
  basis: string;
  control: { standing: ControlTimeline['standing']; note: string | null };
  calibration: {
    source: 'save_fit' | 'fallback_prior';
    calibrated: boolean;
    /** One line: "Calibrated on this save: 2006–2025, refit after the 2025 season" or "Not yet calibrated …". */
    status: string;
    /** The model's own label, in full. */
    detail: string;
  };
}

const STATUS_WORDS: Record<ControlStatus, string> = {
  under_contract: 'under contract', club_option: 'club option', player_option: 'player option',
  vesting_option: 'vesting option', mutual_option: 'mutual option', opt_out: 'under contract unless he opts out',
  pre_arbitration: 'pre-arbitration', arbitration: 'arbitration',
  free_agent: 'free agency', reserve_clause: 'reserve clause', indeterminate: 'not established',
};

const NOT_ESTABLISHED: Labels = { label: 'Control not established', short: 'Not est.', code: 'N/E' };
const FREE_AGENT_AFTER: Labels = { label: 'Free agent after', short: 'FA after', code: 'FA›' };

function labelsOf(c: ControlSeason): Labels {
  switch (c.status) {
    // An extension season has its own short label and code, so the narrow key never merges it with the current deal (D-21)
    case 'under_contract': return c.from === 'extension'
      ? { label: 'Signed (extension)', short: 'Extension', code: 'Ext' }
      : { label: 'Signed', short: 'Signed', code: 'Sgn' };
    case 'opt_out': return { label: 'Signed, opt-out', short: 'Opt-out', code: 'OO' };
    case 'mutual_option': return { label: 'Mutual option', short: 'Mutual opt.', code: 'MO' };
    case 'club_option': return { label: 'Club option', short: 'Club opt.', code: 'CO' };
    case 'player_option': return { label: 'Player option', short: 'Plyr opt.', code: 'PO' };
    case 'vesting_option': return { label: 'Vesting option', short: 'Vest opt.', code: 'VO' };
    case 'pre_arbitration': return { label: 'Pre-arbitration', short: 'Pre-arb', code: 'Pre' };
    case 'arbitration': {
      const y = c.arbitrationYear;
      const n = y === null ? '' : y.low === y.high ? `${y.low}` : `${y.low}–${y.high}`;
      return { label: `Arbitration${n ? ` ${n}` : ''}`, short: `Arb${n ? ` ${n}` : ''}`, code: n ? `A${n}` : 'Arb' };
    }
    case 'reserve_clause': return { label: 'Reserve clause', short: 'Reserve', code: 'Res' };
    case 'free_agent': return { label: 'Free agent', short: 'Free agent', code: 'FA' };
    case 'indeterminate': return NOT_ESTABLISHED;
  }
}

function controlOf(season: number, control: ControlTimeline, after: boolean): ConeControl {
  if (control.standing === 'unsigned') {
    return {
      status: 'unsigned', label: 'Unsigned', short: 'Unsigned', code: 'Uns', after: null,
      detail: control.notes[control.notes.length - 1] ?? 'No club holds him.',
      cost: null, costDetail: 'No club holds him, so no club pays him.', ifHeld: false, declined: null,
    };
  }
  const c = control.seasons.find((x) => x.season === season);
  if (!c) {
    return {
      status: 'not_established', ...NOT_ESTABLISHED, after: null, cost: null, ifHeld: false, declined: null,
      costDetail: 'His control that season is not established, so neither is its cost.',
      detail: control.standing === 'unknown'
        ? control.notes[control.notes.length - 1] ?? 'His control cannot be laid out from the export.'
        : `His control in ${season} is not in the timeline.`,
    };
  }
  const between = c.status === 'indeterminate' && c.between.length > 0
    ? `Between ${c.between.map((b) => STATUS_WORDS[b]).join(' and ')}.`
    : '';
  return {
    status: c.status, ...labelsOf(c), after: after ? FREE_AGENT_AFTER : null,
    detail: [c.basis, c.superTwo ? 'Reached as a Super Two.' : '', between, ...c.reasons].filter(Boolean).join(' '),
    ...costOf(c),
  };
}

/** A served band as the card carries it: its edges, and its central where it has one (a contract's point is its own). */
function coneCost(v: CostBand): ConeCost {
  return { low: v.low, high: v.high, ...(v.central !== undefined ? { central: v.central } : {}) };
}

/**
 * The season's cost as the timeline serves it, and its basis or why it is unknown (phase 4a). Nothing is priced
 * here. An option or opt-out season carries its declined branch and that branch's cost beside the exercised salary
 * (an option is shown on both branches; review R1-06).
 */
function costOf(c: ControlSeason): Pick<ConeControl, 'cost' | 'costDetail' | 'ifHeld' | 'declined'> {
  const d = c.declined;
  const declined: ConeDeclined | null = d === null ? null : {
    status: d.status,
    label: STATUS_WORDS[d.status],
    cost: d.cost?.value ? coneCost(d.cost.value) : null,
    ifHeld: d.costBasis?.ifHeld ?? false,
    costDetail: d.cost === null ? 'Control ends: no cost to this club.' : d.cost.note ?? 'Not established.',
  };
  const declinedText = declined === null ? '' : ` Declined (${d!.kind === 'opted_out' ? 'he opts out' : 'the option declined'}): the buyout (${d!.buyout.value === null ? 'not in the export' : `$${(d!.buyout.value / 1_000_000).toFixed(2)}M`}) and then ${declined.label}${declined.cost ? ', a range of reasonable readings' : ''}. ${declined.costDetail}`;
  if (c.cost === null) return { cost: null, costDetail: 'Control ends: no cost to this club.', ifHeld: false, declined };
  if (c.cost.value === null) return { cost: null, costDetail: `${c.cost.note ?? 'Not established.'}${declinedText}`, ifHeld: false, declined };
  const detail = c.cost.note
    ?? (c.cost.value.low === c.cost.value.high ? `The contract's salary${c.cost.source ? ` (${c.cost.source})` : ''}.` : 'A band.');
  return { cost: coneCost(c.cost.value), costDetail: `${detail}${declinedText}`, ifHeld: c.costBasis?.ifHeld ?? false, declined };
}

const coverageOf = (s: ProductionSeason): ConeSeason['coverage'] => ({
  outer: { target: s.coverage.target.outer, observed: s.coverage.observed?.outer ?? null },
  inner: { target: s.coverage.target.inner, observed: s.coverage.observed?.inner ?? null },
  cases: s.coverage.observed?.cases ?? null,
  note: s.coverage.note,
});

const DEVELOPMENT_WORDS: Record<'save_fit' | 'fallback_prior' | 'unknown', string> = {
  save_fit: "development fitted on this save's rating snapshots",
  fallback_prior: 'development not yet calibrated (the provisional prior)',
  unknown: 'no development assumed (potential not known)',
};

/**
 * What the projection rests on, in one line, from what it actually used (A-08, D-11, C-10): major-league
 * results with the seasons and opportunities read (and the ratings' share where they were blended), or, for a
 * player projected from ratings alone, the ratings, the arrival evidence and the development path. Never
 * "results" that do not exist.
 */
function basisOf(production: PlayerProduction): string {
  const b = production.basis;
  if (b.source === 'none') return 'No major-league results in the window and no usable scouted ratings';
  if (b.source === 'ratings') {
    const a = b.ability;
    const arrival = b.arrival;
    const parts = [
      `Scouted ratings (${a?.evidence.status ?? 'unknown'}${a?.currentRate != null ? `: ${a.currentRate.toFixed(1)} WAR per 600 now` : ''}${a?.potentialRate != null ? `, ${a.potentialRate.toFixed(1)} at potential` : ''})`,
      arrival?.band
        ? `arrival from level ${arrival.level}, ages ${arrival.band.ageFrom}–${arrival.band.ageTo} on this save's history (${arrival.band.cases.toLocaleString('en-US')} player-seasons)`
        : arrival ? `arrival from level ${arrival.level ?? '—'}` : 'arrival not established',
      a?.development ? DEVELOPMENT_WORDS[a.development.source] : 'development not established',
    ];
    return parts.join('; ');
  }
  const sides = b.sides.map((side) => {
    const years = side.seasons.map((x) => x.season);
    const span = years.length === 0 ? '' : years[0] === years[years.length - 1] ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`;
    const unit = side.side === 'batting' ? 'PA' : 'BF';
    const blend = side.blend && side.blend.ratings > 0 ? ` (scouted ratings ${Math.round(side.blend.ratings * 100)}% of his rate)` : '';
    return `${span}: ${Math.round(side.opportunities).toLocaleString('en-US')} ${unit} as a ${side.kind}${blend}`;
  });
  return sides.length > 0 ? `Major-league results ${sides.join('; ')}` : '';
}

const span = (hs: number[]): string => (hs.length === 0 ? '' : hs.length === 1 ? `${hs[0]}` : `${hs[0]}–${hs[hs.length - 1]}`);

/**
 * The one-line calibration status. "Calibrated on this save" only when every part the projection rests on is
 * (D-10, C-11): a projection from ratings is a same-time mapping and an unbacktested arrival-and-development
 * path, never "calibrated"; a fit whose later horizons are still the prior says which horizons are its own.
 */
function calibrationOf(production: PlayerProduction): ProductionCone['calibration'] {
  const m = production.basis.model;
  if (production.basis.source === 'ratings') {
    const dev = production.basis.ability?.development?.source ?? 'unknown';
    const mapping = m.source === 'save_fit' ? "ratings → rate fitted on this save (same-time: it describes, it does not forecast)" : 'ratings → rate from the provisional prior';
    // An arrival model adopted horizon by horizon says how far (hardening F6), never plain "calibrated"
    const through = production.basis.arrival?.adoptedThrough ?? null;
    const later = production.notEstablished.map((s) => s.season);
    const arrival = through === null
      ? ''
      : `; arrival calibrated through ${through === 1 ? '1 season' : `${through} seasons`} out` +
        (later.length > 0 ? ` (${later.length === 1 ? later[0] : `${later[0]}–${later[later.length - 1]}`} not established)` : '');
    return {
      source: m.source, calibrated: false,
      status: `Not yet calibrated on this save: ${mapping}${arrival}; ${DEVELOPMENT_WORDS[dev]}; not measured as a forecast`,
      detail: m.label,
    };
  }
  const w = m.window;
  const calibrated = m.source === 'save_fit' && w?.calibrated === true;
  let status: string;
  if (w && calibrated) {
    const years = w.first !== null && w.last !== null ? `${w.first}–${w.last}` : `${w.seasons} seasons`;
    const prior = w.horizons?.prior ?? [];
    const own = w.horizons?.calibrated ?? [];
    const which = prior.length > 0 ? ` (horizons ${span(own)}; ${span(prior)} mostly the fallback prior)` : '';
    status = `Calibrated on this save: ${years}${w.refitAfter !== null ? `, refit after the ${w.refitAfter} season` : ''}${which}`;
  } else if (w) {
    status = `Not yet calibrated on this save (${w.note ?? `${w.seasons} season${w.seasons === 1 ? '' : 's'}`})`;
  } else {
    status = m.label.charAt(0).toUpperCase() + m.label.slice(1);
    if (/^calibrated/i.test(status)) status = `Not yet calibrated on this save: ${m.label}`;
  }
  return { source: m.source, calibrated, status, detail: m.label };
}

/**
 * Join a player's expected production with his control timeline for the card. Seasons run from this
 * season through the last one before free agency, within the production horizon; where the end of
 * control is not established (unsigned, unknown, or past the horizon) the whole horizon is shown and each
 * season says so.
 */
export function productionCone(production: PlayerProduction, control: ControlTimeline): ProductionCone {
  const ends = control.controlEnds;
  let rows = production.seasons.filter((s) => ends === null || s.season < ends);
  // Free agent already this season: still show this season, labelled as it is
  if (rows.length === 0 && production.seasons.length > 0) rows = [production.seasons[0]];
  // The seasons not established follow the established ones, within control (hardening F6): slot and control kept, no band
  const pending = rows.length === production.seasons.length
    ? production.notEstablished.filter((s) => ends === null || s.season < ends)
    : [];
  const lastSeason = pending.length > 0 ? pending[pending.length - 1].season : rows[rows.length - 1]?.season;
  const last = lastSeason === undefined ? undefined : { season: lastSeason };

  const seasons: ConeSeason[] = rows.map((s) => ({
    season: s.season,
    age: s.age,
    central: s.wins.central,
    outer: { low: s.wins.low, high: s.wins.high },
    inner: { low: s.inner.low, high: s.inner.high },
    toDate: s.toDate,
    usage: s.sides.map((side) => ({
      unit: side.side === 'batting' ? 'PA' as const : 'BF' as const,
      low: side.usage.low, central: side.usage.central, high: side.usage.high,
    })),
    coverage: coverageOf(s),
    control: controlOf(s.season, control, ends !== null && s.season === ends - 1),
    notes: s.notes,
  }));
  const notEstablished: ConeUnestablished[] = pending.map((s) => ({
    season: s.season, age: s.age, reason: s.reason,
    control: controlOf(s.season, control, ends !== null && s.season === ends - 1),
  }));

  let note: string | null = null;
  if (control.standing === 'unsigned') note = 'No club holds him, so no control is shown.';
  else if (control.standing === 'unknown') note = `Control not established: ${control.notes[control.notes.length - 1] ?? 'the export cannot lay it out.'}`;
  else if (ends !== null && last && last.season === ends - 1) {
    // Where the last controlled seasons may themselves be free agency, the mark names the earliest too (C-12)
    let earliest = last.season;
    for (let y = last.season; ; y -= 1) {
      const c = control.seasons.find((x) => x.season === y);
      // An unsettled season that may be free agency, or an option (or opt-out) whose other branch is
      const mayBeFree = c !== undefined && (
        (c.status === 'indeterminate' && c.between.includes('free_agent'))
        || (c.declined !== null && (c.declined.status === 'free_agent' || c.declined.between.includes('free_agent'))));
      if (!mayBeFree) break;
      earliest = y - 1;
    }
    note = earliest < last.season
      ? `Free agent after ${earliest === last.season - 1 ? `${earliest} or ${last.season}` : `${earliest} to ${last.season}`}: ${earliest + 1 === last.season ? `${last.season} may itself be` : `each season from ${earliest + 1} may be`} free agency.`
      : `Free agent after ${last.season}.`;
  }
  else if (control.continuesPastHorizon && last) {
    // A deal he can walk away from does not simply continue (A-05)
    const optOut = control.seasons.find((x) => x.status === 'opt_out');
    note = optOut
      ? `Under contract past ${last.season}, the last season projected, unless he opts out before ${optOut.season}.`
      : `Control continues past ${last.season}, the last season projected.`;
  }

  return {
    playerId: production.playerId,
    status: production.status,
    reason: production.reason,
    unit: production.unit,
    seasons,
    notEstablished,
    basis: basisOf(production),
    control: { standing: control.standing, note },
    calibration: calibrationOf(production),
  };
}
