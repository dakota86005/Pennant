/**
 * The player card's production cone (PLAYER_VALUE.md Part 8): Player Value's own two answers, expected
 * production (concern 3) and the control timeline (concern 2), joined season by season so the card can
 * draw them without recomputing either.
 *
 * Pure. It reads nothing and decides nothing: every band, central, coverage figure and control status is
 * carried exactly as production and control state them. It chooses only which seasons the card shows
 * (this season to the last controlled season, capped by the production horizon; the whole horizon where
 * the end of control is not established) and words them. Unknown production stays unknown: no season,
 * the reason stated, never a zero line or an average (D-018).
 */

import type { ControlSeason, ControlStatus, ControlTimeline } from './playerValueControl.js';
import type { PlayerProduction, ProductionSeason } from './playerValueProduction.js';

/** A season's control as the card labels it: Player Value's status, or no status where none is stated. */
export type ConeControlStatus = ControlStatus | 'not_established' | 'unsigned';

export interface ConeBand {
  low: number;
  high: number;
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

export interface ProductionCone {
  playerId: number;
  status: PlayerProduction['status'];
  /** Why production is unknown; null when projected. */
  reason: string | null;
  unit: string;
  seasons: ConeSeason[];
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

const NOT_ESTABLISHED: Labels = { label: 'Not established', short: 'Not est.', code: 'N/E' };
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
    };
  }
  const c = control.seasons.find((x) => x.season === season);
  if (!c) {
    return {
      status: 'not_established', ...NOT_ESTABLISHED, after: null,
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
  };
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
  if (b.source === 'ratings') {
    const a = b.ability;
    const arrival = b.arrival;
    const parts = [
      `Scouted ratings (${a?.evidence.status ?? 'unknown'}${a?.currentRate != null ? `: ${a.currentRate.toFixed(1)} WAR per 600 now` : ''}${a?.potentialRate != null ? `, ${a.potentialRate.toFixed(1)} at potential` : ''})`,
      arrival?.band
        ? `arrival from level ${arrival.level}, ages ${arrival.band.ageFrom}–${arrival.band.ageTo} on this save's history (${arrival.band.cases.toLocaleString('en-US')} player-seasons)`
        : `arrival from level ${arrival?.level ?? '—'}`,
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
    return {
      source: m.source, calibrated: false,
      status: `Not yet calibrated on this save: ${mapping}; ${DEVELOPMENT_WORDS[dev]}; not measured as a forecast`,
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
    status = `Not yet calibrated on this save (${w.seasons} season${w.seasons === 1 ? '' : 's'})`;
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
  const last = rows[rows.length - 1];

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
    basis: basisOf(production),
    control: { standing: control.standing, note },
    calibration: calibrationOf(production),
  };
}
