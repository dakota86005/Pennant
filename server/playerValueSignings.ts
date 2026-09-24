/**
 * Player Value, phase 4b: what the save's own clubs did between two imports, and what it measures (PLAYER_VALUE.md
 * 4.2 to 4.4, R-6).
 *
 * Pure. It is handed the contract snapshots the imports recorded (`playerValueContractStore.ts`), oldest first, and:
 *
 *   observes          each change between two consecutive imports: a contract whose first season, length or club
 *                     changed. It names what changed and reads it through Player Rights' standing AT THE EARLIER
 *                     IMPORT for the new contract's first season: a free-agent market signing, an arbitration salary
 *                     (award or settlement: the export does not say which), a renewal, a reserve-clause renewal, an
 *                     extension. A club change on the same terms is the contract moving with him; a controlled
 *                     player no club holds later was not tendered or was released. It never gives a change a
 *                     transaction type the export does not carry (D-020), and an ambiguous change (a free agent
 *                     staying with the club that held him, a controlled player's new deal elsewhere, an
 *                     indeterminate standing) is named, counted and left out of every measurement.
 *   measures          the price of a win from free-agent signings only: salary above the minimum over the signed
 *                     player's expected wins at the earlier import, a ratio of sums over every signing observed, with
 *                     the signings resampled for its band (`bootstrapRatio`); observed arbitration salaries scored
 *                     against the band the earlier import priced for them, and read as a class line once a class
 *                     has the ladder's minimum; reserve-clause renewals, as the renewal spread; replacement from
 *                     freely available talent, per 600 opportunities.
 *   adopts            the measured price only when its band is narrower than the opening band with its sampling
 *                     (owner Q-4); otherwise the opening price stays and says why.
 *
 * It reads no rating, no `players_value`, no service time and no live log: the standing, trip and production are the
 * answers the earlier import recorded from Player Rights and Player Value. Describes, never authorizes (D-052).
 */

import type { ArbitrationRegime, ControlStanding } from './playerRights.js';
import {
  COST_PENDING_OBSERVED_PAY, COST_POLICY, MEASURED_PRICE_LABEL, OPENING_PRICE_MINIMUMS, SIGNINGS_POLICY, SIGNINGS_POLICY_CALIBRATION,
} from './playerValueCalibration.js';
import type { ControlSeason, ControlStatus, ControlTimeline, CostBand, CostBasis } from './playerValueControl.js';
import { lineOf, upperBoundOfQuantile, type CostReading } from './playerValueCost.js';
import { bootstrapRatio, type PriceBand, type PriceOfWin } from './playerValueFinances.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';
import type { CalibrationStamp } from './calibration.js';

// ── what an import recorded ──────────────────────────────────────────────────

/** Player Rights' standing for one season, as the import recorded it. */
export interface SnapshotRights {
  season: number;
  standing: ControlStanding;
  between: ControlStanding[];
  /** Which arbitration trip (by class), for an arbitration standing. */
  trip: { low: number; high: number } | null;
  tripIfEligible: { low: number; high: number } | null;
}

/** Expected production for one season at the import (the entry point's projection), in wins. */
export interface SnapshotProduction {
  season: number;
  central: number;
  low: number;
  high: number;
  /** Expected opportunities (plate appearances plus batters faced). */
  opportunities: number;
}

/** One player as an import recorded him. */
export interface ContractSnapshotRow {
  playerId: number;
  /** His club and organization at the import; null where no club holds him. */
  teamId: number | null;
  orgId: number | null;
  /** The contract's kind; null where there is no contract or no term. */
  kind: 'major_league' | 'minor_league' | null;
  firstSeason: number | null;
  years: number | null;
  /** Each season of the term's salary, in order; null where the export does not state it. */
  salaries: Array<number | null>;
  /** A signed extension that follows the term, as exported. */
  extension: { firstSeason: number | null; years: number | null } | null;
  placement: 'active' | 'injured' | 'other';
  /** He has a line in the league's own statistics (a major-league record). */
  majorRecord: boolean;
  /** Player Rights' standing for this season and the next (`SIGNINGS_POLICY.rightsSeasons`); null: no answer (no club holds him, or not recorded). */
  rights: SnapshotRights[] | null;
  /** Player Rights' reading of his major-league service banked at the import (days, a band); null where not recorded or unknown. Recorded, never compared with a threshold here. */
  serviceNow?: { low: number; high: number } | null;
  /** His expected production at the import; null where it was not recorded (a minor-league deal). */
  production: { status: 'projected' | 'unknown'; label: string; seasons: SnapshotProduction[] } | null;
  /** The cost band the import's timeline priced for next season, where it priced one. */
  nextCost: { season: number; low: number; high: number; method: string | null; source: string | null } | null;
}

/** One import's recorded contracts for one market league. */
export interface ContractSnapshot {
  leagueId: number;
  /** ISO game date (`parseGameDate`): the key. */
  gameDate: string;
  season: number | null;
  /** The share of the season played at the import; null where not established. */
  seasonPlayed: number | null;
  minimum: number | null;
  financials: boolean | null;
  arbitration: Pick<ArbitrationRegime, 'status' | 'classes' | 'mlb'>;
  rows: ContractSnapshotRow[];
}

// ── observed changes ─────────────────────────────────────────────────────────

export type ObservedKind =
  | 'free_agent_signing' | 'retained_at_free_agency' | 'extension' | 'extension_known' | 'arbitration_salary'
  | 'arbitration_at_minimum' | 'renewal' | 'reserve_clause_renewal' | 'not_retained' | 'moved_while_controlled'
  | 'transferred' | 'standing_not_established' | 'minor_league_signing' | 'own_organization' | 'not_read_earlier';

export type ObservationUse = 'price' | 'awards' | 'reserve' | 'replacement';

export interface ObservedChange {
  playerId: number;
  kind: ObservedKind;
  /** The new contract's first season and length, where he has one. */
  firstSeason: number | null;
  years: number | null;
  club: { earlier: number | null; later: number | null };
  org: { earlier: number | null; later: number | null };
  /** Player Rights' standing for the new contract's first season at the earlier import, where recorded. */
  standing: ControlStanding | null;
  /** What changed, in words: the fields, from and to. */
  changed: string;
  /** How the change is read, and what the export does not say. */
  reading: string;
  /** The measurements it enters. */
  uses: ObservationUse[];
  /** Why it is left out of a measurement it could have entered; null where it is not. */
  left: string | null;
  /** The first season's salary, where stated. */
  salary: number | null;
  /** For a priced signing: salary above the minimum and expected wins, summed over the seasons priced. */
  money?: number;
  wins?: number;
  opportunities?: number;
  pricedSeasons?: number;
  /** For an arbitration salary: his trip at the earlier import, and the band it priced for the season. */
  arbitrationClass?: { low: number; high: number } | null;
  nextCost?: { low: number; high: number } | null;
  /** The league minimum the later import states. */
  minimum: number | null;
}

/** Two consecutive imports and what changed between them. */
export interface WinterPair {
  earlier: string;
  later: string;
  seasons: { earlier: number | null; later: number | null };
  /** The pair spans a winter: the season rolled over, or the earlier import was before the season began. */
  spansWinter: boolean;
  changes: ObservedChange[];
  counts: Partial<Record<ObservedKind, number>>;
}

const millions = (n: number): string => `$${(n / 1_000_000).toFixed(2)}M`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const words = (s: string): string => s.replace(/_/g, ' ');

function lastSeasonOf(r: ContractSnapshotRow): number | null {
  return r.firstSeason !== null && r.years !== null && r.years > 0 ? r.firstSeason + r.years - 1 : null;
}

function describeChange(e: ContractSnapshotRow | null, l: ContractSnapshotRow | null): string {
  const parts: string[] = [];
  const term = (r: ContractSnapshotRow | null) => (r === null || r.teamId === null ? 'no club' : `club ${r.teamId}`);
  if (e?.firstSeason !== l?.firstSeason) parts.push(`first season ${e?.firstSeason ?? 'none'} → ${l?.firstSeason ?? 'none'}`);
  if (e?.years !== l?.years) parts.push(`length ${e?.years ?? 'none'} → ${l?.years ?? 'none'}`);
  if (e?.teamId !== l?.teamId) parts.push(`${term(e)} → ${term(l)}`.replace(/^club (\d+) → club (\d+)$/, 'club $1 → $2'));
  if (e?.kind !== l?.kind) parts.push(`kind ${words(e?.kind ?? 'none')} → ${words(l?.kind ?? 'none')}`);
  return parts.length > 0 ? parts.join('; ') : 'nothing in the contract';
}

/** The span of the new contract whose production the earlier import established: its first seasons, in order. */
function priceSigning(e: ContractSnapshotRow, l: ContractSnapshotRow, minimum: number | null):
  { money: number; wins: number; opportunities: number; seasons: number } | { reason: string } {
  if (minimum === null) return { reason: 'The league minimum is not established at the later import, so salary above it cannot be read.' };
  if (l.kind !== 'major_league' || l.firstSeason === null || l.years === null) return { reason: 'Not a major-league deal with a stated term.' };
  const p = e.production;
  if (p === null || p.status !== 'projected') return { reason: 'His production was not established at the earlier import, so no expected wins can be set against the salary.' };
  let money = 0;
  let wins = 0;
  let opportunities = 0;
  let seasons = 0;
  for (let i = 0; i < l.years; i += 1) {
    const season = l.firstSeason + i;
    const pay = l.salaries[i] ?? null;
    const s = p.seasons.find((x) => x.season === season);
    if (pay === null || s === undefined) break;
    money += Math.max(0, pay - minimum);
    wins += s.central;
    opportunities += s.opportunities;
    seasons += 1;
  }
  if (seasons === 0) {
    return { reason: `His production for ${l.firstSeason} was not established at the earlier import, or the salary is not stated, so the deal is not priced.` };
  }
  return { money, wins, opportunities, seasons };
}

/** Whether a deal's first season was already under way at the earlier import: its salary is paid for part of a season the export does not date. */
function underWay(earlier: ContractSnapshot, first: number | null): boolean {
  if (first === null || earlier.season === null) return true;
  if (first < earlier.season) return true;
  return first === earlier.season && (earlier.seasonPlayed === null || earlier.seasonPlayed > 0);
}

/**
 * Everything that changed between two consecutive imports, read through Player Rights at the earlier one (D-020, R-6).
 */
export function observeChanges(earlier: ContractSnapshot, later: ContractSnapshot): WinterPair {
  const before = new Map(earlier.rows.map((r) => [r.playerId, r]));
  const after = new Map(later.rows.map((r) => [r.playerId, r]));
  const minimum = later.minimum;
  const changes: ObservedChange[] = [];
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);

  for (const id of ids) {
    const e = before.get(id) ?? null;
    const l = after.get(id) ?? null;
    const base = (kind: ObservedKind, reading: string, uses: ObservationUse[], left: string | null, standing: ControlStanding | null = null): ObservedChange => ({
      playerId: id, kind, firstSeason: l?.firstSeason ?? null, years: l?.years ?? null,
      club: { earlier: e?.teamId ?? null, later: l?.teamId ?? null }, org: { earlier: e?.orgId ?? null, later: l?.orgId ?? null },
      standing, changed: describeChange(e, l), reading, uses, left, salary: l?.salaries[0] ?? null, minimum,
    });
    const eHeld = e !== null && e.teamId !== null;
    const lHeld = l !== null && l.teamId !== null;
    const controlledAt = (row: ContractSnapshotRow, season: number | null) => {
      const r = season === null ? null : row.rights?.find((x) => x.season === season) ?? null;
      return r !== null && ['pre_arbitration', 'arbitration', 'reserve_clause'].includes(r.standing) ? r : null;
    };

    if (e === null) {
      // Not recorded at the earlier import (a newcomer, an amateur signed, or unsigned with no established production)
      if (lHeld && l!.firstSeason !== null && (earlier.season === null || l!.firstSeason >= earlier.season)) {
        changes.push(base('not_read_earlier', 'A contract for a player the earlier import did not record: how he was held before is not read.', [], 'Not recorded at the earlier import, so nothing he signed can be read against what was expected of him then.'));
      }
      continue;
    }

    if (!lHeld) {
      if (!eHeld) continue;
      // Held and controlled at the earlier import, and no club holds him now
      const next = later.season ?? (earlier.season !== null ? earlier.season + 1 : null);
      const controlled = controlledAt(e, next);
      if (controlled === null) continue;
      changes.push(base('not_retained',
        `No club holds him at the later import though Player Rights had him ${words(controlled.standing)} for ${next}: he was not tendered or was released; the export does not say which${l === null ? ', and he is not in the later record at all (retired, or unsigned with no established production)' : ''}.`,
        [], 'Not a signing: there is no contract to read.', controlled.standing));
      continue;
    }
    const la = l!;

    if (!eHeld) {
      // No club held him at the earlier import: he signed from outside every organization
      const reading = 'No club held him at the earlier import: a signing from outside every organization.';
      if (la.kind === 'major_league') {
        const uses: ObservationUse[] = [];
        let left: string | null = null;
        const priced = priceSigning(e, la, minimum);
        const change = base('free_agent_signing', reading, uses, null);
        if (underWay(earlier, la.firstSeason)) left = `His deal's first season (${la.firstSeason}) was already under way at the earlier import: its salary pays for part of a season the export does not date, so it is left out of the price.`;
        else if ('reason' in priced) left = priced.reason;
        else {
          uses.push('price');
          Object.assign(change, { money: priced.money, wins: priced.wins, opportunities: priced.opportunities, pricedSeasons: priced.seasons });
        }
        if (e.majorRecord && minimum !== null && (la.salaries[0] ?? Infinity) <= minimum) uses.push('replacement');
        change.left = left;
        changes.push(change);
      } else {
        const free = e.majorRecord;
        const deal = la.kind === 'minor_league' ? 'A minor-league deal' : 'A contract row with no term (not a major-league deal)';
        changes.push(base('minor_league_signing', `${reading} ${deal}${free ? ' for a player with a major-league record: freely available talent' : ''}.`,
          free ? ['replacement'] : [], free ? null : 'No major-league record: not a measure of freely available major-league talent.'));
      }
      continue;
    }

    const termChanged = e.firstSeason !== la.firstSeason || e.years !== la.years;
    const orgChanged = e.orgId !== la.orgId;
    if (!termChanged && !orgChanged) continue;
    if (!termChanged) {
      changes.push(base('transferred', 'His contract moved with him to another organization on the same terms: a trade or a claim; the export does not say which. Not a signing.', [], 'Not a signing: the terms did not change.'));
      continue;
    }
    if (e.extension && e.extension.firstSeason === la.firstSeason && e.extension.years === la.years && !orgChanged) {
      changes.push(base('extension_known', 'The extension the earlier import already held took effect: signed before the earlier import, not observed between them.', [], 'Signed before the earlier import: not a change observed between the two.'));
      continue;
    }
    const first = la.firstSeason;
    if (la.kind === 'minor_league') {
      if (orgChanged) {
        const free = e.majorRecord;
        changes.push(base('minor_league_signing', `A new minor-league deal with an organization that did not hold him${free ? ': freely available talent (he has a major-league record)' : ''}; how his earlier deal ended is not in the export.`,
          free ? ['replacement'] : [], free ? null : 'No major-league record: not a measure of freely available major-league talent.'));
      } else {
        changes.push(base('own_organization', 'A new minor-league deal with the organization that held him.', [], 'Not a market price: his own organization renewed him.'));
      }
      continue;
    }
    if (e.kind === 'minor_league' && !orgChanged) {
      changes.push(base('own_organization', 'A major-league deal with the organization that held him on a minor-league deal.', [], 'Not a market price: his own organization added him.'));
      continue;
    }
    const eLast = lastSeasonOf(e);
    if (eLast !== null && first !== null && first <= eLast) {
      changes.push(orgChanged
        ? base('moved_while_controlled', `A new deal with another organization over seasons his earlier contract still covered (through ${eLast}): the export does not say how he left.`, [], 'Ambiguous: left out of every measurement.')
        : base('extension', `A new deal with his club over seasons his earlier contract still covered (through ${eLast}): an extension.`, [], 'An extension is not a market price.'));
      continue;
    }
    const r = first === null ? null : e.rights?.find((x) => x.season === first) ?? null;
    if (r === null) {
      changes.push(base('standing_not_established', `Player Rights' standing for ${first ?? 'its first season'} was not recorded at the earlier import.`, [],
        `Left out of every measurement: his standing for ${first ?? 'its first season'} was not read at the earlier import.`));
      continue;
    }
    const s = r.standing;
    if (s === 'indeterminate') {
      changes.push(base('standing_not_established', `Player Rights could not say at the earlier import what he would be in ${first}.`, [],
        `Left out of every measurement: his standing for ${first} was indeterminate at the earlier import${r.between.length > 0 ? `, between ${r.between.map(words).join(' and ')}` : ''}.`, s));
      continue;
    }
    if (s === 'free_agency') {
      if (orgChanged) {
        const change = base('free_agent_signing', `Free-agency eligible for ${first} at the earlier import, he signed with an organization that did not hold him: a market price.`, [], null, s);
        const priced = priceSigning(e, la, minimum);
        if (underWay(earlier, first)) change.left = `His deal's first season (${first}) was already under way at the earlier import: its salary pays for part of a season the export does not date, so it is left out of the price.`;
        else if ('reason' in priced) change.left = priced.reason;
        else {
          change.uses.push('price');
          Object.assign(change, { money: priced.money, wins: priced.wins, opportunities: priced.opportunities, pricedSeasons: priced.seasons });
        }
        changes.push(change);
      } else {
        changes.push(base('retained_at_free_agency', `Free-agency eligible for ${first} at the earlier import, he signed again with the club that held him.`, [],
          'Left out of the price: whether he re-signed before or after he reached the market is not in the export (policy).', s));
      }
      continue;
    }
    // Controlled for its first season: arbitration, pre-arbitration or a reserve clause
    if (orgChanged) {
      changes.push(base('moved_while_controlled', `Controlled (${words(s)}) for ${first} at the earlier import, he has a new deal with another organization: not tendered or released and signed elsewhere, or moved and signed; the export does not say which.`, [],
        'Ambiguous: left out of every measurement.', s));
      continue;
    }
    if ((la.years ?? 0) > 1) {
      changes.push(base('extension', `A deal of ${la.years} seasons with his club while he was ${words(s)} for ${first}: an extension.`, [], 'An extension is not a market price, an award or a renewal.', s));
      continue;
    }
    const pay = la.salaries[0] ?? null;
    if (s === 'arbitration') {
      if (pay !== null && minimum !== null && pay <= minimum) {
        changes.push({ ...base('arbitration_at_minimum', `A one-year deal at the league minimum for a player in arbitration for ${first}: read as not tendered and signed again, not an arbitration salary (as the ladder reads it).`, [],
          'At the minimum: not read as an arbitration salary.', s), arbitrationClass: r.trip });
      } else {
        changes.push({ ...base('arbitration_salary', `A one-year deal with his club for ${first}, when Player Rights had him in arbitration: an arbitration salary, an award or a settlement; the export does not say which.`,
          pay === null ? [] : ['awards'], pay === null ? 'The salary is not stated.' : null, s), arbitrationClass: r.trip, nextCost: e.nextCost !== null && e.nextCost.season === first ? { low: e.nextCost.low, high: e.nextCost.high } : null });
      }
      continue;
    }
    if (s === 'reserve_clause') {
      changes.push(base('reserve_clause_renewal', `A one-year deal with his club for ${first} under a reserve clause: a reserve-clause renewal.`, pay === null ? [] : ['reserve'], pay === null ? 'The salary is not stated.' : null, s));
      continue;
    }
    changes.push(base('renewal', `A one-year deal with his club for ${first} before arbitration: a renewal.`, [], null, s));
  }

  const counts: Partial<Record<ObservedKind, number>> = {};
  for (const c of changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  const spansWinter = earlier.season !== null && later.season !== null
    && (later.season > earlier.season || (later.season === earlier.season && earlier.seasonPlayed === 0));
  return { earlier: earlier.gameDate, later: later.gameDate, seasons: { earlier: earlier.season, later: later.season }, spansWinter, changes, counts };
}

/** Every consecutive pair of the save's imports, oldest first. */
export function observePairs(snapshots: ContractSnapshot[]): WinterPair[] {
  const out: WinterPair[] = [];
  for (let i = 1; i < snapshots.length; i += 1) out.push(observeChanges(snapshots[i - 1], snapshots[i]));
  return out;
}

// ── replacement from freely available talent ─────────────────────────────────

export interface FreeAcquisition {
  playerId: number;
  /** The organization that took him, and the first season he could play for it. */
  orgId: number;
  firstSeason: number;
  how: 'minor_league_deal' | 'major_league_minimum';
  gameDate: string;
}

/** Players who joined a club for nothing, with a major-league record: the population replacement is measured on. */
export function freeAcquisitions(pairs: WinterPair[]): FreeAcquisition[] {
  const out = new Map<number, FreeAcquisition>();
  for (const p of pairs) {
    for (const c of p.changes) {
      if (!c.uses.includes('replacement') || c.org.later === null) continue;
      const first = c.firstSeason ?? p.seasons.later;
      if (first === null) continue;
      // His first acquisition observed: a later one starts his production for another club
      if (!out.has(c.playerId)) {
        out.set(c.playerId, { playerId: c.playerId, orgId: c.org.later, firstSeason: first, how: c.kind === 'minor_league_signing' ? 'minor_league_deal' : 'major_league_minimum', gameDate: p.later });
      }
    }
  }
  return [...out.values()];
}

export interface ReplacementReading {
  status: 'measured' | 'not_measured';
  /** Freely acquired players with major-league opportunities for the club that took them. */
  players: number;
  opportunities: number;
  war: number;
  /** Their WAR per 600 opportunities, with its resampled band; unknown until measured. */
  per600: Sourced<PriceBand>;
  text: string;
  stamp: CalibrationStamp;
}

/**
 * Replacement from freely available talent (4.3): the major-league WAR per opportunity of the players who joined a
 * club for nothing, for that club, from the season he joined it. Below the policy minimum the export's WAR convention
 * stays (provisional); nothing is assumed about the players not yet measured.
 */
export function measureReplacement(acquisitions: FreeAcquisition[], after: Map<number, { war: number; opportunities: number }>): ReplacementReading {
  const per = SIGNINGS_POLICY.replacement.per;
  const cases = acquisitions.map((a) => after.get(a.playerId)).filter((x): x is { war: number; opportunities: number } => x !== undefined && x.opportunities > 0);
  const war = cases.reduce((s, c) => s + c.war, 0);
  const opportunities = cases.reduce((s, c) => s + c.opportunities, 0);
  const need = SIGNINGS_POLICY.replacement.minimumPlayers;
  const source = 'observed signings across imports + players_career_*_stats (war, pa, bf) for the club that took him';
  if (cases.length < need) {
    const text = `Replacement stays the export's WAR convention (provisional): ${plural(acquisitions.length, 'freely acquired player')} observed, ${cases.length} with major-league opportunities for the club that took him, fewer than the ${need} a measurement needs.`;
    return { status: 'not_measured', players: cases.length, opportunities, war, per600: unknownBecause('not_exported_by_ootp', source, text), text, stamp: SIGNINGS_POLICY_CALIBRATION };
  }
  const central = (war / opportunities) * per;
  const band = bootstrapRatio(cases.map((c) => c.war * per), cases.map((c) => c.opportunities));
  const value = band && band.high !== null ? { central, low: Math.min(central, band.low), high: Math.max(central, band.high) } : null;
  const text = value
    ? `Measured on ${cases.length} freely acquired players (${Math.round(opportunities)} opportunities for the clubs that took them): ${central.toFixed(2)} WAR per ${per} opportunities, 80% of resampled readings ${value.low.toFixed(2)} to ${value.high.toFixed(2)}. The export's WAR sets replacement at 0.`
    : `Not measured: the resampled band of ${cases.length} freely acquired players has no upper edge.`;
  return {
    status: value ? 'measured' : 'not_measured', players: cases.length, opportunities, war,
    per600: value ? derivedFrom(value, source, text) : unknownBecause('not_exported_by_ootp', source, text), text, stamp: SIGNINGS_POLICY_CALIBRATION,
  };
}

// ── the measured price of a win ──────────────────────────────────────────────

export interface MeasuredPrice {
  status: 'measured' | 'not_measured' | 'no_off_season' | 'unknown';
  label: string;
  /** Free-agent signings priced, and observed (priced or not). */
  signings: number;
  observed: number;
  /** Winters observed (pairs of imports spanning one), and imports recorded. */
  winters: number;
  imports: number;
  /** Dollars per win, the ratio of sums, with its resampled 80% band; unknown with the reason. */
  price: Sourced<PriceBand>;
  /** Which replacement the wins are counted above. */
  replacement: 'export_convention' | 'measured';
  text: string;
  stamp: CalibrationStamp;
}

export interface MeasuredPriceInput {
  pairs: WinterPair[];
  /** How many imports the save holds, and their dates (for the words). */
  imports: number;
  importDates?: string[];
  replacement: ReplacementReading | null;
  /** Whether the league prices in dollars at all; a league without financials is valued in wins. */
  dollars?: string | null;
}

/**
 * The price of a win the save's own free-agent signings set (4.2): summed salary above the minimum over summed expected
 * wins at signing, over every signing observed across the save's winters. Its band resamples the signings. It rests
 * on at least the opening basis's minimum of contracts.
 */
export function measurePriceOfWin(input: MeasuredPriceInput): MeasuredPrice {
  const winters = input.pairs.filter((p) => p.spansWinter);
  const signings = winters.flatMap((p) => p.changes.filter((c) => c.kind === 'free_agent_signing'));
  const priced = signings.filter((c) => c.uses.includes('price') && c.money !== undefined && c.wins !== undefined);
  const source = 'observed free-agent signings (salary above the minimum at the later import ÷ expected wins at the earlier import)';
  const out = (status: MeasuredPrice['status'], price: Sourced<PriceBand>, text: string, replacement: MeasuredPrice['replacement'] = 'export_convention'): MeasuredPrice => ({
    status, label: MEASURED_PRICE_LABEL, signings: priced.length, observed: signings.length, winters: winters.length, imports: input.imports,
    price, replacement, text, stamp: SIGNINGS_POLICY_CALIBRATION,
  });
  const unknown = (status: MeasuredPrice['status'], text: string) => out(status, unknownBecause('not_exported_by_ootp', source, text), text);
  if (input.dollars) return unknown('unknown', input.dollars);
  if (winters.length === 0) {
    const dates = input.importDates && input.importDates.length > 0 ? ` (${input.importDates.join(', ')})` : '';
    const held = input.imports === 0
      ? 'This save has no import recorded yet: its contracts are recorded at each import from now on.'
      : `This save has ${plural(input.imports, 'import')} recorded${dates}${input.imports > 1 ? ', none across a winter' : ''}.`;
    return unknown('no_off_season', `No off-season observed yet: the measured price needs two imports across a winter (one before its signings and one after). ${held}`);
  }
  const leftOut = signings.length - priced.length;
  const counted = `${plural(signings.length, 'free-agent signing')} observed over ${plural(winters.length, 'winter')}, ${priced.length} priced${leftOut > 0 ? ` (${leftOut} left out: a first season already under way, or production not established at the earlier import)` : ''}`;
  const need = OPENING_PRICE_MINIMUMS.contracts;
  if (priced.length < need) return unknown('not_measured', `Not measured: ${counted}; a measured reading rests on at least ${need} (the opening basis's policy minimum).`);
  const r = input.replacement?.status === 'measured' ? input.replacement.per600.value : null;
  const per = SIGNINGS_POLICY.replacement.per;
  const wins = priced.map((c) => (r ? (c.wins as number) - (r.central * (c.opportunities ?? 0)) / per : (c.wins as number)));
  const money = priced.map((c) => c.money as number);
  const totalWins = wins.reduce((s, w) => s + w, 0);
  const above = r ? `wins above freely available talent (${r.central.toFixed(2)} WAR per ${per} opportunities)` : "wins in the export's own WAR (replacement at its convention, provisional)";
  if (!(totalWins > 0)) return unknown('not_measured', `Not measured: ${counted}, and their expected ${above} sum to nothing, so they price no win.`);
  const central = money.reduce((s, m) => s + m, 0) / totalWins;
  const band = bootstrapRatio(money, wins);
  if (!band || band.high === null) {
    return unknown('not_measured', `Not measured: ${counted}; resampled, too many readings price no positive win, so the band has no upper edge.`);
  }
  const value = { central, low: Math.min(central, band.low), high: Math.max(central, band.high) };
  const text = `Measured on ${plural(priced.length, 'free-agent signing')} over ${plural(winters.length, 'winter')}: ${millions(value.central)} a win, 80% of resampled readings ${millions(value.low)} to ${millions(value.high)}; ` +
    `salary above the minimum over expected ${above}, each at the earlier import. Each signing is in its own winter's dollars.`;
  return out('measured', derivedFrom(value, source, text), text, r ? 'measured' : 'export_convention');
}

// ── adoption (owner Q-4) ─────────────────────────────────────────────────────

const ADOPTION_RULE = 'The measured price replaces the opening one only when its band is narrower than the opening band with its sampling (owner Q-4): the evidence decides, not a count of signings.';

/**
 * The price of a win in force (owner Q-4): the measured price only when its band is narrower than the opening band with
 * its sampling; otherwise the opening price, saying why. The floor stays the opening's floor either way.
 */
export function adoptPrice(opening: PriceOfWin, measured: MeasuredPrice): PriceOfWin {
  const o = opening.price.value;
  const comparable = opening.sampling?.comparable ?? null;
  const openingSummary = o ? { central: o.central, low: o.low, high: o.high, comparable } : null;
  const stays = (reason: string): PriceOfWin => ({
    ...opening, stage: 'opening',
    adoption: { inForce: 'opening', reason: `The opening price stays: ${reason}`, opening: openingSummary, measured, rule: ADOPTION_RULE },
  });
  const m = measured.price.value;
  if (measured.status !== 'measured' || m === null) return stays(measured.price.note ?? measured.text);
  const measuredBand = `${millions(m.low)}–${millions(m.high)} (${millions(m.high - m.low)} wide)`;
  const counted = `${plural(measured.observed, 'free-agent signing')} observed`;
  const takes = (reason: string): PriceOfWin => ({
    ...opening, stage: 'measured', label: MEASURED_PRICE_LABEL, price: measured.price, unit: 'dollars_per_win',
    adoption: { inForce: 'measured', reason: `The measured price is in force: ${reason}`, opening: openingSummary, measured, rule: ADOPTION_RULE },
  });
  if (o === null) return takes(`${counted}; the opening price is unknown (${opening.price.note ?? 'not stated'}), so the measured band ${measuredBand} is the only one.`);
  const openBand = comparable ?? { low: o.low, high: o.high };
  const openWords = `${millions(openBand.low)}–${millions(openBand.high)} (${millions(openBand.high - openBand.low)} wide${comparable ? ', its bases with their sampling' : ''})`;
  if (m.high - m.low < openBand.high - openBand.low) {
    return takes(`${counted}; the measured band ${measuredBand} is narrower than the opening band ${openWords}.`);
  }
  return stays(`${counted}; the measured band ${measuredBand} is wider than the opening band ${openWords}, so the opening price stays until the signings narrow it (Q-4).`);
}

// ── observed arbitration salaries ────────────────────────────────────────────

export interface AwardScore {
  status: 'scored' | 'none' | 'no_arbitration' | 'unknown';
  /** Arbitration salaries observed, and those the earlier import had priced a band for. */
  awards: number;
  scored: number;
  covered: number;
  coverage: number | null;
  byClass: Array<{ arbitrationClass: number; scored: number; covered: number }>;
  text: string;
}

/**
 * Observed arbitration salaries against the band the earlier import's ladder priced for that season (4.4): how many
 * fell inside it. A range of reasonable readings, not a calibrated interval, so it is reported, never gated.
 */
export function scoreAwards(pairs: WinterPair[], regime: Pick<ArbitrationRegime, 'status' | 'classes' | 'mlb'>): AwardScore {
  const empty = { awards: 0, scored: 0, covered: 0, coverage: null, byClass: [] };
  if (regime.status === 'no_arbitration' || regime.status === 'reserve_clause') {
    return { status: 'no_arbitration', ...empty, text: 'This league has no salary arbitration: there are no arbitration salaries to score the ladder against.' };
  }
  if (regime.status !== 'arbitration') return { status: 'unknown', ...empty, text: "The league's arbitration rule is not read, so no salary is read as an arbitration salary." };
  const awards = pairs.filter((p) => p.spansWinter).flatMap((p) => p.changes.filter((c) => c.kind === 'arbitration_salary' && c.salary !== null));
  const scored = awards.filter((c) => c.nextCost !== null && c.nextCost !== undefined);
  if (awards.length === 0) return { status: 'none', ...empty, text: 'No arbitration salary observed across a winter yet: the ladder is measured on each import and not yet tested against one.' };
  const inBand = (c: ObservedChange) => (c.salary as number) >= (c.nextCost as { low: number }).low && (c.salary as number) <= (c.nextCost as { high: number }).high;
  const covered = scored.filter(inBand).length;
  const classes = new Map<number, { scored: number; covered: number }>();
  for (const c of scored) {
    const k = Math.min(c.arbitrationClass?.low ?? 0, regime.classes ?? 0);
    const e = classes.get(k) ?? { scored: 0, covered: 0 };
    e.scored += 1;
    if (inBand(c)) e.covered += 1;
    classes.set(k, e);
  }
  const coverage = scored.length > 0 ? covered / scored.length : null;
  const text = scored.length > 0
    ? `${covered} of ${scored.length} observed arbitration salaries fell inside the band the earlier import priced for them (${Math.round((coverage as number) * 100)}%); ${awards.length - scored.length} had no band priced then. The ladder's bands are ranges of reasonable readings, not calibrated intervals: reported, not gated.`
    : `${plural(awards.length, 'arbitration salary', 'arbitration salaries')} observed; the earlier import priced no band for any of them, so none is scored.`;
  return {
    status: 'scored', awards: awards.length, scored: scored.length, covered, coverage,
    byClass: [...classes].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ arbitrationClass: k, ...v })), text,
  };
}

export interface AwardReading {
  arbitrationClass: number;
  /** Observed arbitration salaries above the minimum in the class, pooled over the winters observed. */
  cases: number;
  status: 'measured' | 'thin';
  /** The class's line on those salaries (the ladder's own method), once the class has the ladder's minimum. */
  reading: CostReading | null;
  text: string;
}

/**
 * Observed arbitration salaries as a reading of each class (4.4), pooled over the winters observed: the ladder's own
 * line (a base and a share of the price per platform win), once the class holds the ladder's minimum of them. The
 * platform is each player's, read from the export (`platformOf`); each salary is in its own winter's dollars.
 */
export function awardReadings(pairs: WinterPair[], platformOf: (playerId: number, firstSeason: number) => number | null, priceCentral: number): AwardReading[] {
  const byClass = new Map<number, Array<{ platform: number; above: number }>>();
  for (const p of pairs.filter((x) => x.spansWinter)) {
    for (const c of p.changes) {
      if (c.kind !== 'arbitration_salary' || c.salary === null || c.minimum === null || c.firstSeason === null || !c.arbitrationClass) continue;
      const platform = platformOf(c.playerId, c.firstSeason);
      if (platform === null) continue;
      const list = byClass.get(c.arbitrationClass.low) ?? [];
      list.push({ platform, above: c.salary - c.minimum });
      byClass.set(c.arbitrationClass.low, list);
    }
  }
  const need = COST_POLICY.ladder.minimumCases;
  return [...byClass].sort((a, b) => a[0] - b[0]).map(([k, cases]) => {
    const line = cases.length >= need ? lineOf(cases, priceCentral) : null;
    return line
      ? { arbitrationClass: k, cases: cases.length, status: 'measured' as const, reading: line, text: `Class ${k}: ${cases.length} observed arbitration salaries, pooled over the winters observed: a reading of the class beside this import's cross-section.` }
      : { arbitrationClass: k, cases: cases.length, status: 'thin' as const, reading: null, text: `Class ${k}: ${plural(cases.length, 'observed arbitration salary', 'observed arbitration salaries')}, fewer than the ${need} a reading needs: scored, not used.` };
  });
}

// ── reserve-clause renewals ──────────────────────────────────────────────────

export interface ReserveRenewalSpread {
  status: 'measured' | 'unknown';
  band: Sourced<CostBand>;
  cases: number;
  atMinimum: number;
  text: string;
}

/**
 * What a reserve-clause renewal costs, from the renewals observed across imports: the league minimum to the upper
 * confidence bound of their 90th percentile, the pre-arbitration renewal spread's own method. Below the ladder's
 * minimum of renewals, unknown with the count.
 */
export function reserveRenewals(pairs: WinterPair[], minimum: number | null, regime: Pick<ArbitrationRegime, 'status'> | null = null): ReserveRenewalSpread {
  const renewals = pairs.filter((p) => p.spansWinter).flatMap((p) => p.changes.filter((c) => c.kind === 'reserve_clause_renewal' && c.salary !== null));
  const pay = renewals.map((c) => c.salary as number).sort((a, b) => a - b);
  const atMinimum = minimum === null ? 0 : pay.filter((x) => x <= minimum).length;
  const source = 'observed reserve-clause renewals across imports';
  const need = COST_POLICY.renewal.minimumCases;
  const unknown = (text: string): ReserveRenewalSpread => ({ status: 'unknown', band: unknownBecause('not_exported_by_ootp', source, text), cases: pay.length, atMinimum, text });
  if (minimum === null) return unknown('The league minimum is not established, so a renewal band cannot start from it.');
  if (regime !== null && regime.status !== 'reserve_clause' && pay.length === 0) {
    return unknown('No reserve clause binds this league\'s players as its rules are read: there is no reserve-clause renewal to measure.');
  }
  if (pay.length < need) {
    return unknown(`${plural(pay.length, 'reserve-clause renewal')} observed across imports, fewer than the ${need} a renewal band needs: a reserve-clause season stays unknown, never the minimum.`);
  }
  const bound = upperBoundOfQuantile(pay, COST_POLICY.renewal.quantile, COST_POLICY.renewal.confidence);
  if (bound === null) return unknown(`${pay.length} reserve-clause renewals observed: too few for the renewal band's upper bound.`);
  const band = { low: minimum, high: Math.max(minimum, bound) };
  const text = `Measured on ${pay.length} reserve-clause renewals observed across imports (${atMinimum} at the minimum): ${millions(band.low)} to ${millions(band.high)}, the pre-arbitration renewal spread's method.`;
  return { status: 'measured', band: derivedFrom(band, source, text), cases: pay.length, atMinimum, text };
}

/**
 * A control timeline's reserve-clause seasons priced from the renewals observed across imports (phase 4b), where the
 * timeline left them for this (`COST_PENDING_OBSERVED_PAY`); until the spread is measured each stays unknown and says
 * how many renewals were seen. Nothing else in the timeline changes.
 */
export function priceReserveSeasons(control: ControlTimeline, spread: ReserveRenewalSpread | null): ControlTimeline {
  if (spread === null || control.seasons.length === 0) return control;
  const price = (status: ControlStatus, cost: Sourced<CostBand> | null): { cost: Sourced<CostBand>; basis: CostBasis | null } | null => {
    if (status !== 'reserve_clause' || cost === null || cost.value !== null || cost.note !== COST_PENDING_OBSERVED_PAY) return null;
    if (spread.band.value === null) return { cost: { ...cost, note: `${COST_PENDING_OBSERVED_PAY} ${spread.text}` }, basis: null };
    return {
      cost: derivedFrom({ ...spread.band.value }, spread.band.source ?? 'observed reserve-clause renewals across imports', `Reserve-clause renewal: ${spread.text}`),
      basis: { method: 'renewal_spread', source: 'measured', classes: [], cases: spread.cases, platform: null, price: null, ifHeld: false, text: spread.text },
    };
  };
  let changed = false;
  const seasons: ControlSeason[] = control.seasons.map((s) => {
    let next = s;
    const own = price(s.status, s.cost);
    if (own) { next = { ...next, cost: own.cost, costBasis: own.basis }; changed = true; }
    const declined = s.declined ? price(s.declined.status, s.declined.cost) : null;
    if (declined && s.declined) { next = { ...next, declined: { ...s.declined, cost: declined.cost, costBasis: declined.basis } }; changed = true; }
    return next;
  });
  return changed ? { ...control, seasons } : control;
}
