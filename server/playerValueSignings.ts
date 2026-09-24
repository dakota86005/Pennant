/**
 * Player Value, phase 4b: what the save's own clubs did between two imports, and what it measures (PLAYER_VALUE.md
 * 4.2 to 4.4, R-6). Reviewed 2026-09-24 (R3 correctness, R4 method).
 *
 * Pure. It is handed the contract snapshots the imports recorded (`playerValueContractStore.ts`) and:
 *
 *   follows           the save's timeline (`contractTimeline`): imports in the order they were recorded; an import
 *                     dated at or before the one before it (the save went back), or a date imported again whose
 *                     season's play differs (a reloaded save played again), starts a new timeline, and nothing is
 *                     compared across it (review R3-05).
 *   observes          each change between two consecutive imports of one timeline: a contract whose first season,
 *                     length or club changed. It names what changed and reads it through Player Rights' standing AT
 *                     THE EARLIER IMPORT for the new contract's first season: a free-agent market signing, an
 *                     arbitration salary (award or settlement: the export does not say which), a renewal, a
 *                     reserve-clause renewal, an extension, a term changed within its seasons. A club change on the
 *                     same terms is the contract moving with him; a controlled player no club in this league holds
 *                     later was not tendered, was released or is held outside it. It never gives a change a
 *                     transaction type the export does not carry (D-020), and an ambiguous change is named, counted
 *                     and left out of every measurement. A winter is read by the calendar: an import before its
 *                     season's Opening Day is inside it (review R3-01), and a pair of imports a winter or more apart
 *                     says so and is not priced as one winter (R4-12).
 *   measures          the price of a win from free-agent signings, as a set of bases like the opening price's (review
 *                     R4-01, R4-02): per win projected at signing over the deal and in the first season, per win
 *                     expected in the first season if he plays, and per win produced in the first season once it is
 *                     completed (the opening's own unit), each a ratio of sums with its resampled band (by winter once
 *                     two winters are observed, R4-05); observed arbitration salaries scored against the band the
 *                     earlier import priced (with the band's width beside the coverage, R4-08), and read as a class
 *                     line once a class has the ladder's minimum; reserve-clause renewals, as the renewal spread;
 *                     replacement from freely available talent, per 600 opportunities, shown and never applied to the
 *                     price (R3-06, R4-06).
 *   adopts            the measured price only when it holds the realized reading, its signings cover each third of
 *                     the winter's free-agent class, and its band is narrower than the opening band with its sampling
 *                     (owner Q-4); otherwise the opening price stays and says why, naming the unit of each reading.
 *
 * It reads no rating, no `players_value`, no service time and no live log: the standing, trip and production are the
 * answers the earlier import recorded from Player Rights and Player Value; the realized wins and whether a club held a
 * player during a season are handed in from the export's own lines. Describes, never authorizes (D-052).
 */

import type { ArbitrationRegime, ControlStanding } from './playerRights.js';
import {
  COST_PENDING_OBSERVED_PAY, COST_POLICY, MEASURED_PRICE_LABEL, OPENING_PRICE_MINIMUMS, SIGNINGS_POLICY, SIGNINGS_POLICY_CALIBRATION,
} from './playerValueCalibration.js';
import type { ControlSeason, ControlStatus, ControlTimeline, CostBand, CostBasis } from './playerValueControl.js';
import { lineOf, upperBoundOfQuantile, type CostReading } from './playerValueCost.js';
import { bootstrapRatio, type PriceBand, type PriceOfWin } from './playerValueFinances.js';
import { parseGameDate } from './dataFreshness.js';
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
  /**
   * The chance of any major-league playing time that season, for a player projected on one side (review R4-03): his
   * expected wins if he plays are the central over it (he produces nothing when he does not play). Null where he is
   * projected on two sides or the chance is not stated.
   */
  chance?: number | null;
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
  /** The cost band the import's timeline priced for the season the coming winter sets (this season before Opening Day, else the next), where it priced one. */
  nextCost: { season: number; low: number; high: number; method: string | null; source: string | null } | null;
}

/** One import's recorded contracts for one market league. */
export interface ContractSnapshot {
  leagueId: number;
  /** ISO game date (`parseGameDate`): the key. */
  gameDate: string;
  season: number | null;
  /**
   * The share of the season played at the import; 0 where the season has not begun (before Opening Day by the
   * schedule, or no game of it has a line: review R3-01); null where not established (read as begun).
   */
  seasonPlayed: number | null;
  minimum: number | null;
  financials: boolean | null;
  arbitration: Pick<ArbitrationRegime, 'status' | 'classes' | 'mlb'>;
  rows: ContractSnapshotRow[];
}

// ── the save's timeline (review R3-05) ───────────────────────────────────────

export interface TimelineImport {
  gameDate: string;
  /** The order the import was recorded in. */
  seq: number;
}

/** A break recorded after the import `afterSeq`: the date the save was found on another timeline, and why. */
export interface TimelineBreak {
  afterSeq: number;
  gameDate: string;
  reason: string;
}

export interface Timeline {
  /** The consecutive imports of one timeline that are compared, oldest first. */
  pairs: Array<{ earlier: string; later: string }>;
  /** Imports left out: dated after the point the save went back to, on a timeline since abandoned. */
  superseded: string[];
  text: string | null;
}

const keyOf = (d: string): string => parseGameDate(d) ?? d;

/**
 * The save's timeline (review R3-05): its imports in the order they were recorded. An import dated at or before the
 * one recorded before it means the save went back, and a break recorded after an import (a date imported again whose
 * play differs) means the next import is on another timeline: either starts a new segment, and no pair is formed
 * across it. What an earlier segment observed after the date the new one starts from is superseded (it covers a
 * period the save played again) and left out, as is anything dated after this export (`now`), since the save went
 * back since. Pairs are consecutive imports within a segment.
 */
export function contractTimeline(imports: TimelineImport[], breaks: TimelineBreak[], now: string | null): Timeline {
  const sorted = [...imports].sort((a, b) => a.seq - b.seq);
  const segments: Array<{ start: string | null; items: TimelineImport[] }> = [];
  const words: string[] = [];
  for (const imp of sorted) {
    const current = segments[segments.length - 1];
    const prev = current?.items[current.items.length - 1];
    if (!prev) {
      segments.push({ start: null, items: [imp] });
      continue;
    }
    const br = breaks.find((b) => b.afterSeq >= prev.seq && b.afterSeq < imp.seq);
    if (keyOf(imp.gameDate) <= keyOf(prev.gameDate)) {
      segments.push({ start: keyOf(imp.gameDate), items: [imp] });
      words.push(`the save went back: the import of ${keyOf(imp.gameDate)} was recorded after one of ${keyOf(prev.gameDate)}`);
    } else if (br) {
      segments.push({ start: keyOf(br.gameDate), items: [imp] });
      words.push(`${br.reason} (at ${keyOf(br.gameDate)})`);
    } else {
      current.items.push(imp);
    }
  }
  for (const b of breaks) {
    const last = sorted[sorted.length - 1];
    if (last && b.afterSeq >= last.seq) words.push(`${b.reason} (at ${keyOf(b.gameDate)}; the next import starts a new timeline)`);
  }
  const superseded = new Set<string>();
  segments.forEach((seg, i) => {
    for (const later of segments.slice(i + 1)) {
      for (const imp of seg.items) if (later.start !== null && keyOf(imp.gameDate) > later.start) superseded.add(keyOf(imp.gameDate));
    }
  });
  const nowKey = now === null ? null : keyOf(now);
  const future = nowKey === null ? [] : sorted.filter((x) => keyOf(x.gameDate) > nowKey).map((x) => keyOf(x.gameDate));
  for (const f of future) superseded.add(f);
  const pairs: Timeline['pairs'] = [];
  for (const seg of segments) {
    for (let i = 1; i < seg.items.length; i += 1) {
      const e = seg.items[i - 1];
      const l = seg.items[i];
      if (superseded.has(keyOf(e.gameDate)) || superseded.has(keyOf(l.gameDate))) continue;
      pairs.push({ earlier: e.gameDate, later: l.gameDate });
    }
  }
  const out = [...superseded].sort();
  const parts: string[] = [];
  if (words.length > 0) parts.push(`Not compared across a change of timeline: ${words.join('; ')}.`);
  if (out.length > 0) {
    parts.push(`${plural(out.length, 'import')} (${out.join(', ')}) ${out.length === 1 ? 'belongs' : 'belong'} to a timeline the save went back from${future.length > 0 ? ` (dated after this export, ${nowKey})` : ''}: what ${out.length === 1 ? 'it' : 'they'} observed is left out.`);
  }
  return { pairs, superseded: out, text: parts.length > 0 ? parts.join(' ') : null };
}

// ── observed changes ─────────────────────────────────────────────────────────

export type ObservedKind =
  | 'free_agent_signing' | 'retained_at_free_agency' | 'extension' | 'extension_known' | 'term_changed' | 'arbitration_salary'
  | 'arbitration_at_minimum' | 'renewal' | 'reserve_clause_renewal' | 'not_retained' | 'moved_while_controlled'
  | 'transferred' | 'moved_no_terms' | 'standing_not_established' | 'minor_league_signing' | 'own_organization' | 'not_read_earlier';

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
  /** For a market signing: the first season's salary above the later import's minimum (never clipped, as the opening reads it). */
  firstMoney?: number;
  /** Over the deal's seasons the earlier import projected: salary above the minimum, expected wins and opportunities. */
  money?: number;
  wins?: number;
  opportunities?: number;
  pricedSeasons?: number;
  /** The deal runs past the seasons the earlier import projected (or a season's salary is not stated): left out of the whole-deal basis. */
  pastHorizon?: boolean;
  /** The first season's expected wins at the earlier import, and those if he plays (one side projected with its chance). */
  firstWins?: number;
  firstWinsIfPlays?: number | null;
  /** The production model the earlier import projected him with. */
  model?: string;
  /** Which third of the winter's free-agent class by expected first-season wins (0 the lowest); null where the class was not split. */
  third?: number | null;
  /** For an arbitration salary: his trip (the later import's reading for the season where recorded, else the earlier's), and the band the earlier import priced for the season. */
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
  /** The winters the pair spans, by the season each leads into: an import before its season's Opening Day is inside that winter. */
  winters: number[];
  /** The pair spans a winter (at least one). Only a pair spanning exactly one is measured. */
  spansWinter: boolean;
  /** Why the pair is not measured as one winter, where it is not. */
  note: string | null;
  /**
   * The winter's free-agent class at the earlier import (players whose deal ends before the winter's season and whom
   * Player Rights had free-agency eligible for it, with expected wins): how many, and the edges of its thirds.
   */
  market: { season: number; players: number; thirds: [number, number] | null } | null;
  changes: ObservedChange[];
  counts: Partial<Record<ObservedKind, number>>;
  /** The reading's version (`SIGNINGS_POLICY.method`). */
  method: string;
}

/** What the export can say about a pair beyond the two snapshots: whether an organization held a player during a season (his lines there). */
export interface PairContext {
  /** True: his lines in that season show a stint with a club of the organization; false: they show none; null: his lines cannot be read. */
  heldDuring?: (playerId: number, orgId: number, season: number) => boolean | null;
}

const millions = (n: number): string => `$${(n / 1_000_000).toFixed(2)}M`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const words = (s: string): string => s.replace(/_/g, ' ');
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function lastSeasonOf(r: ContractSnapshotRow): number | null {
  return r.firstSeason !== null && r.years !== null && r.years > 0 ? r.firstSeason + r.years - 1 : null;
}

/** A row with no exported term: no contract kind, or no length. */
const noTerm = (r: ContractSnapshotRow): boolean => r.kind === null || r.years === null || r.years <= 0;

function describeChange(e: ContractSnapshotRow | null, l: ContractSnapshotRow | null): string {
  const parts: string[] = [];
  const term = (r: ContractSnapshotRow | null) => (r === null || r.teamId === null ? 'no club' : `club ${r.teamId}`);
  if (e?.firstSeason !== l?.firstSeason) parts.push(`first season ${e?.firstSeason ?? 'none'} → ${l?.firstSeason ?? 'none'}`);
  if (e?.years !== l?.years) parts.push(`length ${e?.years ?? 'none'} → ${l?.years ?? 'none'}`);
  if (e?.teamId !== l?.teamId) parts.push(`${term(e)} → ${term(l)}`.replace(/^club (\d+) → club (\d+)$/, 'club $1 → $2'));
  if (e?.kind !== l?.kind) parts.push(`kind ${words(e?.kind ?? 'none')} → ${words(l?.kind ?? 'none')}`);
  return parts.length > 0 ? parts.join('; ') : 'nothing in the contract';
}

/** Whether the season had begun at the import: a share of 0 is a season not begun; an unknown share is read as begun (a deal then is left out, never priced on a guess). */
const begun = (s: ContractSnapshot): boolean => s.seasonPlayed === null || s.seasonPlayed > 0;

/**
 * The winters a pair spans, each by the season it leads into (review R3-01, R3-11): an import in a season under way
 * is before the next winter; an import before its season's Opening Day is inside that season's winter.
 */
function wintersBetween(e: ContractSnapshot, l: ContractSnapshot): number[] {
  if (e.season === null || l.season === null) return [];
  const from = begun(e) ? e.season + 1 : e.season;
  const out: number[] = [];
  for (let s = from; s <= l.season; s += 1) out.push(s);
  return out;
}

/** Whether a deal's first season was already under way at the earlier import: its salary is paid for part of a season the export does not date. */
function underWay(earlier: ContractSnapshot, first: number | null): boolean {
  if (first === null || earlier.season === null) return true;
  if (first < earlier.season) return true;
  return first === earlier.season && begun(earlier);
}

type Priced = Pick<ObservedChange, 'firstMoney' | 'money' | 'wins' | 'opportunities' | 'pricedSeasons' | 'pastHorizon' | 'firstWins' | 'firstWinsIfPlays' | 'model'>;

/**
 * A market signing's money and expected wins (review R4-01, R4-07): the first season's salary above the minimum,
 * and, where the earlier import projected him, his expected wins that season (and if he plays) and over the deal's
 * seasons it projected. Money is salary less the later import's minimum, never clipped (the opening reads it so).
 */
function priceSigning(e: ContractSnapshotRow, l: ContractSnapshotRow, minimum: number | null): { priced: Priced; projected: string | null } | { reason: string } {
  if (minimum === null) return { reason: 'The league minimum is not established at the later import, so salary above it cannot be read.' };
  if (l.kind !== 'major_league' || l.firstSeason === null || l.years === null || l.years <= 0) return { reason: 'Not a major-league deal with a stated term.' };
  const pay0 = l.salaries[0] ?? null;
  if (pay0 === null) return { reason: `His salary for ${l.firstSeason} is not stated, so the deal is not priced.` };
  const priced: Priced = { firstMoney: pay0 - minimum };
  const p = e.production;
  if (p === null || p.status !== 'projected') {
    return { priced, projected: 'His production was not established at the earlier import: left out of the projected readings (the realized reading, once his first season is completed, needs none).' };
  }
  const first = p.seasons.find((x) => x.season === l.firstSeason);
  if (!first) {
    return { priced, projected: `His production for ${l.firstSeason} was not established at the earlier import: left out of the projected readings.` };
  }
  let money = 0;
  let wins = 0;
  let opportunities = 0;
  let seasons = 0;
  for (let i = 0; i < l.years; i += 1) {
    const season = l.firstSeason + i;
    const pay = l.salaries[i] ?? null;
    const s = p.seasons.find((x) => x.season === season);
    if (pay === null || s === undefined) break;
    money += pay - minimum;
    wins += s.central;
    opportunities += s.opportunities;
    seasons += 1;
  }
  const chance = first.chance ?? null;
  Object.assign(priced, {
    money, wins, opportunities, pricedSeasons: seasons, pastHorizon: seasons < l.years,
    firstWins: first.central, firstWinsIfPlays: chance !== null && chance > 0 ? first.central / chance : null, model: p.label,
  });
  return { priced, projected: null };
}

/** The winter's free-agent class at the earlier import, split in thirds by expected wins in the winter's season (review R4-02). */
function marketClass(e: ContractSnapshot, season: number): WinterPair['market'] {
  const values: number[] = [];
  for (const r of e.rows) {
    if (r.teamId === null || r.kind !== 'major_league') continue;
    const last = lastSeasonOf(r);
    if (last === null || last >= season) continue;
    if (r.extension && r.extension.firstSeason !== null && r.extension.firstSeason <= season) continue;
    if (r.rights?.find((x) => x.season === season)?.standing !== 'free_agency') continue;
    const w = r.production?.status === 'projected' ? r.production.seasons.find((x) => x.season === season)?.central : undefined;
    if (w !== undefined) values.push(w);
  }
  values.sort((a, b) => a - b);
  const n = values.length;
  return { season, players: n, thirds: n >= 3 ? [values[Math.floor(n / 3)], values[Math.floor((2 * n) / 3)]] : null };
}

const thirdOf = (w: number, thirds: [number, number] | null): number | null => (thirds === null ? null : w < thirds[0] ? 0 : w < thirds[1] ? 1 : 2);

/**
 * Everything that changed between two consecutive imports of one timeline, read through Player Rights at the earlier
 * one (D-020, R-6). The context says what the export's lines establish (whether a club held a player during a season);
 * without it, that is not read, and a signing that needs it is left out.
 */
export function observeChanges(earlier: ContractSnapshot, later: ContractSnapshot, context: PairContext = {}): WinterPair {
  const before = new Map(earlier.rows.map((r) => [r.playerId, r]));
  const after = new Map(later.rows.map((r) => [r.playerId, r]));
  const minimum = later.minimum;
  const winters = wintersBetween(earlier, later);
  const oneWinter = winters.length === 1;
  const market = oneWinter ? marketClass(earlier, winters[0]) : null;
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
    /** A market signing priced, or left out with the reason (under way, not priced, or no longer one winter). */
    const priceMarket = (change: ObservedChange, la: ContractSnapshotRow, first: number | null): ObservedChange => {
      const priced = priceSigning(e as ContractSnapshotRow, la, minimum);
      if (underWay(earlier, first)) change.left = `His deal's first season (${first}) was already under way at the earlier import: its salary pays for part of a season the export does not date, so it is left out of the price.`;
      else if ('reason' in priced) change.left = priced.reason;
      else {
        change.uses.push('price');
        Object.assign(change, priced.priced);
        change.left = priced.projected;
      }
      return change;
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
      // Held and controlled at the earlier import, and no club in this league holds him now
      const next = later.season ?? (earlier.season !== null ? earlier.season + 1 : null);
      const controlled = controlledAt(e, next);
      if (controlled === null) continue;
      changes.push(base('not_retained',
        `No club in this league holds him at the later import though Player Rights had him ${words(controlled.standing)} for ${next}: he was not tendered, was released, or is held outside this league; the export does not say which${l === null ? ' (he is not in the later record at all: retired, unsigned with no established production, or held by a club of another league)' : ''}.`,
        [], 'Not a signing: there is no contract in this league to read.', controlled.standing));
      continue;
    }
    const la = l!;

    if (!eHeld) {
      // No club held him at the earlier import: he signed from outside every organization
      const reading = 'No club held him at the earlier import: a signing from outside every organization.';
      if (la.kind === 'major_league') {
        const change = priceMarket(base('free_agent_signing', reading, [], null), la, la.firstSeason);
        if (e.majorRecord && minimum !== null && (la.salaries[0] ?? Infinity) <= minimum) change.uses.push('replacement');
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
      if (noTerm(e) && noTerm(la)) {
        changes.push(base('moved_no_terms', 'He is with another organization, and neither row exports a term: how he moved (a trade, a claim, a release and a new deal) is not in the export.', [], 'Ambiguous: left out of every measurement.'));
      } else {
        changes.push(base('transferred', 'His contract moved with him to another organization on the same terms: a trade or a claim; the export does not say which. Not a signing.', [], 'Not a signing: the terms did not change.'));
      }
      continue;
    }
    // The extension the earlier import held taking effect, whether or not he moved with it (review R3-02)
    if (e.extension && e.extension.firstSeason === la.firstSeason && e.extension.years === la.years) {
      changes.push(base('extension_known',
        `The extension the earlier import already held took effect: signed before the earlier import, not observed between them${orgChanged ? '; he moved to another organization with it (a trade or a claim; the export does not say which)' : ''}.`,
        [], 'Signed before the earlier import: not a change observed between the two.'));
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
    if ((e.kind === 'minor_league' || noTerm(e)) && !orgChanged) {
      changes.push(base('own_organization', `A major-league deal with the organization that held him on ${e.kind === 'minor_league' ? 'a minor-league deal' : 'a row with no exported term'}.`, [], 'Not a market price: his own organization added him.'));
      continue;
    }
    const eLast = lastSeasonOf(e);
    if (eLast !== null && first !== null && first <= eLast) {
      if (orgChanged) {
        changes.push(base('moved_while_controlled', `A new deal with another organization over seasons his earlier contract still covered (through ${eLast}): the export does not say how he left.`, [], 'Ambiguous: left out of every measurement.'));
        continue;
      }
      const lLast = lastSeasonOf(la);
      if (lLast !== null && lLast <= eLast) {
        // A term that now ends no later than it did is not an extension (review R3-09)
        changes.push(base('term_changed',
          `His term changed within the seasons it already covered (it now ends in ${lLast}, not ${eLast}): an option declined, a buyout, an opt-out or a restructure; the export does not say which.`,
          [], 'Not a new deal the market priced: left out of every measurement.'));
      } else {
        changes.push(base('extension', `A new deal with his club over seasons his earlier contract still covered (through ${eLast}), running to ${lLast ?? 'a season not stated'}: an extension.`, [], 'An extension is not a market price.'));
      }
      continue;
    }
    const r = first === null ? null : e.rights?.find((x) => x.season === first) ?? null;
    if (r === null) {
      changes.push(base('standing_not_established', `Player Rights' standing for ${first ?? 'its first season'} was not recorded at the earlier import${e.rights === null ? ' (his row there kept its terms only)' : ''}.`, [],
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
      if (!orgChanged) {
        changes.push(base('retained_at_free_agency', `Free-agency eligible for ${first} at the earlier import, he signed again with the club that held him.`, [],
          'Left out of the price: whether he re-signed before or after he reached the market is not in the export (policy).', s));
        continue;
      }
      // A club that held him during the season before is not the open market either (review R3-04): the last season
      // played at the earlier import (the one before it, when that import was taken before its season began)
      const season = earlier.season === null ? null : begun(earlier) ? earlier.season : earlier.season - 1;
      const held = season === null || la.orgId === null ? null : context.heldDuring?.(id, la.orgId, season) ?? null;
      if (held === true) {
        changes.push(base('retained_at_free_agency',
          `Free-agency eligible for ${first} at the earlier import, he signed with an organization his ${season} lines show held him during that season (it acquired him after the earlier import): whether he reached the market first is not in the export.`,
          [], 'Left out of the price: a club that held him re-signed him (policy).', s));
        continue;
      }
      if (held === null) {
        changes.push(base('free_agent_signing', `Free-agency eligible for ${first} at the earlier import, he signed with an organization that did not hold him then.`, [],
          `Left out of the price: whether the organization he signed with held him during ${season ?? 'that season'} cannot be read (his lines are not in the export).`, s));
        continue;
      }
      changes.push(priceMarket(base('free_agent_signing',
        `Free-agency eligible for ${first} at the earlier import, he signed with an organization that did not hold him (his ${season} lines show no stint with it): a market price.`, [], null, s), la, first));
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
      // His class as the ladder reads the same contract once its season is current: the later import's trip, else the earlier's
      const laterTrip = first === null ? null : la.rights?.find((x) => x.season === first)?.trip ?? null;
      const trip = laterTrip ?? r.trip;
      if (pay !== null && minimum !== null && pay <= minimum) {
        changes.push({ ...base('arbitration_at_minimum', `A one-year deal at the league minimum for a player in arbitration for ${first}: read as not tendered and signed again, not an arbitration salary (as the ladder reads it).`, [],
          'At the minimum: not read as an arbitration salary.', s), arbitrationClass: trip });
      } else {
        changes.push({ ...base('arbitration_salary', `A one-year deal with his club for ${first}, when Player Rights had him in arbitration: an arbitration salary, an award or a settlement; the export does not say which.`,
          pay === null ? [] : ['awards'], pay === null ? 'The salary is not stated.' : null, s), arbitrationClass: trip, nextCost: e.nextCost !== null && e.nextCost.season === first ? { low: e.nextCost.low, high: e.nextCost.high } : null });
      }
      continue;
    }
    if (s === 'reserve_clause') {
      changes.push(base('reserve_clause_renewal', `A one-year deal with his club for ${first} under a reserve clause: a reserve-clause renewal.`, pay === null ? [] : ['reserve'], pay === null ? 'The salary is not stated.' : null, s));
      continue;
    }
    changes.push(base('renewal', `A one-year deal with his club for ${first} before arbitration: a renewal.`, [], null, s));
  }

  // The thirds, now the class is known
  for (const c of changes) if (c.firstWins !== undefined) c.third = thirdOf(c.firstWins, market?.thirds ?? null);

  // A pair a winter or more apart is counted, never measured as one winter (review R4-12)
  let note: string | null = null;
  if (winters.length > 1) {
    note = `The imports are ${winters.length} winters apart (the winters before ${winters.join(' and ')}): what changed between them is counted and not measured as one winter's signings; a deal signed in the later winter would be read against expectations ${winters.length} winters old, and several deals in between collapse into the last one.`;
    for (const c of changes) {
      if (c.uses.length === 0) continue;
      c.uses = [];
      c.left = `The imports are ${winters.length} winters apart: left out of every measurement.`;
    }
  }
  const counts: Partial<Record<ObservedKind, number>> = {};
  for (const c of changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return {
    earlier: earlier.gameDate, later: later.gameDate, seasons: { earlier: earlier.season, later: later.season },
    winters, spansWinter: winters.length > 0, note, market, changes, counts, method: SIGNINGS_POLICY.method,
  };
}

/** Every consecutive pair of the snapshots given, oldest first (one timeline: the caller follows `contractTimeline`). */
export function observePairs(snapshots: ContractSnapshot[], context: PairContext = {}): WinterPair[] {
  const out: WinterPair[] = [];
  for (let i = 1; i < snapshots.length; i += 1) out.push(observeChanges(snapshots[i - 1], snapshots[i], context));
  return out;
}

/** The pairs a measurement reads: those spanning exactly one winter. */
const measurable = (pairs: WinterPair[]): WinterPair[] => pairs.filter((p) => p.winters.length === 1);

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
  /** Freely acquired players with major-league opportunities for the club that took them, in the season he joined it. */
  players: number;
  /** Freely acquired players observed, and those of them with no major-league opportunities for that club that season. */
  acquired: number;
  didNotPlay: number;
  opportunities: number;
  war: number;
  /** Their WAR per 600 opportunities, with its resampled band; unknown until measured. */
  per600: Sourced<PriceBand>;
  text: string;
  stamp: CalibrationStamp;
}

/**
 * Replacement from freely available talent (4.3): the major-league WAR per opportunity of the players who joined a
 * club for nothing, for that club, in the season he joined it (review R4-06: a pickup who became a regular does not
 * keep adding seasons). Only pickups who played are in it, which pushes it up, and it says how many did not. Below the
 * policy minimum the export's WAR convention stays (provisional). Shown, never applied: the price of a win, the cost
 * ladder and production stay in the export's WAR until surplus applies one level to both sides (phase 5).
 */
export function measureReplacement(acquisitions: FreeAcquisition[], after: Map<number, { war: number; opportunities: number }>): ReplacementReading {
  const per = SIGNINGS_POLICY.replacement.per;
  const cases = acquisitions.map((a) => after.get(a.playerId)).filter((x): x is { war: number; opportunities: number } => x !== undefined && x.opportunities > 0);
  const war = cases.reduce((s, c) => s + c.war, 0);
  const opportunities = cases.reduce((s, c) => s + c.opportunities, 0);
  const didNotPlay = acquisitions.length - cases.length;
  const need = SIGNINGS_POLICY.replacement.minimumPlayers;
  const source = 'observed signings across imports + players_career_*_stats (war, pa, bf) for the club that took him, the season he joined it';
  const who = `${didNotPlay} of ${acquisitions.length} did not play for the club that took them that season and are not in it: it rests only on the pickups who played, which pushes it up`;
  const shown = "Shown, never applied: the price of a win, the cost ladder and production stay in the export's WAR until surplus (phase 5) applies one level to both sides.";
  const base = { players: cases.length, acquired: acquisitions.length, didNotPlay, opportunities, war, stamp: SIGNINGS_POLICY_CALIBRATION };
  if (cases.length < need) {
    const text = `Replacement stays the export's WAR convention (provisional): ${plural(acquisitions.length, 'freely acquired player')} observed, ${cases.length} with major-league opportunities for the club that took him in the season he joined it, fewer than the ${need} a measurement needs.`;
    return { status: 'not_measured', ...base, per600: unknownBecause('not_exported_by_ootp', source, text), text };
  }
  const central = (war / opportunities) * per;
  const band = bootstrapRatio(cases.map((c) => c.war * per), cases.map((c) => c.opportunities));
  const value = band && band.high !== null ? { central, low: Math.min(central, band.low), high: Math.max(central, band.high) } : null;
  const text = value
    ? `Measured on ${cases.length} freely acquired players (${Math.round(opportunities)} opportunities for the clubs that took them, in the season each joined): ${central.toFixed(2)} WAR per ${per} opportunities, 80% of resampled readings ${value.low.toFixed(2)} to ${value.high.toFixed(2)}; ${who}. The export's WAR sets replacement at 0. ${shown}`
    : `Not measured: the resampled band of ${cases.length} freely acquired players has no upper edge; ${who}.`;
  return {
    status: value ? 'measured' : 'not_measured', ...base,
    per600: value ? derivedFrom(value, source, text) : unknownBecause('not_exported_by_ootp', source, text), text,
  };
}

// ── the measured price of a win ──────────────────────────────────────────────

export type MeasuredBasisId = 'whole' | 'first' | 'if_plays' | 'realized';

/** One measured basis (review R4-01, R4-02): a ratio of sums over its signings, with its resampled band. */
export interface MeasuredBasis {
  id: MeasuredBasisId;
  /** What its wins are: projected at signing, or produced in the season (the opening's unit). */
  unit: 'projected' | 'realized';
  description: string;
  status: 'measured' | 'not_computed' | 'unbounded';
  signings: number;
  money: number | null;
  wins: number | null;
  /** The ratio of sums, and its 80% resampled band (holding the central). */
  central: number | null;
  low: number | null;
  high: number | null;
  text: string;
}

export interface MeasuredPrice {
  status: 'measured' | 'not_measured' | 'no_off_season' | 'unknown';
  label: string;
  /** Free-agent signings priced, and observed (priced or not), over the winters measured. */
  signings: number;
  observed: number;
  /** Distinct winters observed (a winter seen by several pairs of imports counts once), and imports recorded. */
  winters: number;
  imports: number;
  bases: MeasuredBasis[];
  /** Dollars per win: the median of the bases, the band their spread with each one's sampling; unknown with the reason. */
  price: Sourced<PriceBand>;
  /** Whether the realized reading (the opening's own unit) is among the bases measured. */
  realized: boolean;
  /** The priced signings in each third of their winter's free-agent class, and whether each third holds the policy minimum. */
  coverage: { thirds: [number, number, number] | null; enough: boolean; text: string };
  /** The wins are always the export's own WAR: a measured replacement is shown beside, never applied (review R3-06, R4-06). */
  replacement: 'export_convention';
  text: string;
  stamp: CalibrationStamp;
}

export interface MeasuredPriceInput {
  pairs: WinterPair[];
  /** How many imports the save holds, and their dates (for the words). */
  imports: number;
  importDates?: string[];
  /** Replacement from free talent: shown with the price, never applied to it. */
  replacement: ReplacementReading | null;
  /** Whether the league prices in dollars at all; a league without financials is valued in wins. */
  dollars?: string | null;
  /**
   * A signing's WAR in his first season, on its schedule's footing, once that season is completed in the export;
   * null while it is not (or not readable).
   */
  realized?: (playerId: number, season: number) => number | null;
}

interface BasisCase { money: number; wins: number; winter: number; playerId: number }

/** One basis: its ratio of sums and resampled band, resampled by winter once two winters are in it (review R4-05). */
function basisOf(id: MeasuredBasisId, unit: MeasuredBasis['unit'], description: string, cases: BasisCase[], extra = ''): MeasuredBasis {
  const need = OPENING_PRICE_MINIMUMS.contracts;
  const out = (status: MeasuredBasis['status'], text: string, v: Partial<MeasuredBasis> = {}): MeasuredBasis => ({
    id, unit, description, status, signings: cases.length, money: null, wins: null, central: null, low: null, high: null, text, ...v,
  });
  if (cases.length < need) return out('not_computed', `${description}: not computed, ${plural(cases.length, 'signing')}, fewer than the ${need} a basis rests on.${extra}`);
  const money = cases.reduce((s, c) => s + c.money, 0);
  const wins = cases.reduce((s, c) => s + c.wins, 0);
  if (!(wins > 0)) return out('not_computed', `${description}: not computed, its ${cases.length} signings sum to no win.${extra}`, { money, wins });
  const central = money / wins;
  const winters = [...new Set(cases.map((c) => c.winter))];
  const clusters = winters.length >= 2 ? cases.map((c) => c.winter) : undefined;
  const band = bootstrapRatio(cases.map((c) => c.money), cases.map((c) => c.wins), clusters);
  const how = clusters ? `resampled by winter (${winters.length} winters), then by signing within each` : 'resampled by signing';
  if (!band || band.high === null) {
    return out('unbounded', `${description}: ${millions(central)} a win on ${cases.length} signings, but ${how}, too many readings price no positive win: its band has no upper edge.${extra}`, { money, wins, central });
  }
  const low = Math.min(central, band.low);
  const high = Math.max(central, band.high);
  return out('measured',
    `${description}: ${millions(central)} a win on ${cases.length} signings (${millions(money)} above the minimum ÷ ${wins.toFixed(1)} wins); ${how}, 80% of readings ${millions(low)} to ${millions(high)}.${extra}`,
    { money, wins, central, low, high });
}

const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * The price of a win the save's own free-agent signings set (4.2), read like the opening price (review R4-01, R4-02):
 * a set of bases over the signings of every winter observed, each a ratio of sums with its resampled band, the price
 * their median and its band their spread with each one's sampling. Each basis rests on at least the opening basis's
 * minimum of signings. The wins are the export's own WAR throughout.
 */
export function measurePriceOfWin(input: MeasuredPriceInput): MeasuredPrice {
  const usable = measurable(input.pairs);
  const signings = usable.flatMap((p) => p.changes.filter((c) => c.kind === 'free_agent_signing').map((c) => ({ c, winter: p.winters[0] })));
  const priced = signings.filter((x) => x.c.uses.includes('price') && x.c.firstMoney !== undefined);
  const winters = [...new Set(usable.map((p) => p.winters[0]))].sort((a, b) => a - b);
  const source = 'observed free-agent signings (salary above the minimum at the later import ÷ wins projected at the earlier import, or produced in the first season)';
  const need = OPENING_PRICE_MINIMUMS.contracts;
  const perThird = SIGNINGS_POLICY.coverage.perThird;

  // The bases (review R4-01, R4-03, R4-07)
  const whole = priced.filter((x) => x.c.money !== undefined && x.c.wins !== undefined && !x.c.pastHorizon);
  const pastHorizon = priced.filter((x) => x.c.pastHorizon).length;
  const wholeMoney = whole.map((x) => x.c.money as number);
  const largest = wholeMoney.length > 0 ? Math.max(...wholeMoney) / Math.max(1, wholeMoney.reduce((s, m) => s + Math.max(0, m), 0)) : null;
  const realizedOf = input.realized ?? (() => null);
  const realizedCases = priced
    .map((x) => ({ x, w: x.c.firstSeason === null ? null : realizedOf(x.c.playerId, x.c.firstSeason) }))
    .filter((y): y is { x: typeof priced[number]; w: number } => y.w !== null);
  const bases: MeasuredBasis[] = [
    basisOf('whole', 'projected', 'Over the deal, per win projected at signing (salary above the minimum over the seasons the earlier import projected ÷ their expected wins)',
      whole.map((x) => ({ money: x.c.money as number, wins: x.c.wins as number, winter: x.winter, playerId: x.c.playerId })),
      ` ${plural(pastHorizon, 'deal')} running past the projection's horizon (or with a season's salary not stated) left out of it, never cut short${largest !== null ? `; the largest signing is ${pct(largest)} of its money` : ''}.`),
    basisOf('first', 'projected', 'The first season, per win projected at signing (its salary above the minimum ÷ his expected wins that season)',
      priced.filter((x) => x.c.firstWins !== undefined).map((x) => ({ money: x.c.firstMoney as number, wins: x.c.firstWins as number, winter: x.winter, playerId: x.c.playerId }))),
    basisOf('if_plays', 'projected', 'The first season, per win expected if he plays (his expected wins over his chance of any major-league playing time, one side projected)',
      priced.filter((x) => x.c.firstWinsIfPlays !== undefined && x.c.firstWinsIfPlays !== null).map((x) => ({ money: x.c.firstMoney as number, wins: x.c.firstWinsIfPlays as number, winter: x.winter, playerId: x.c.playerId }))),
    basisOf('realized', 'realized', "The first season, per win he produced in it (its salary above the minimum ÷ his WAR that season on its schedule's footing, once it is completed: the opening's own unit)",
      realizedCases.map(({ x, w }) => ({ money: x.c.firstMoney as number, wins: w, winter: x.winter, playerId: x.c.playerId })),
      priced.length > realizedCases.length ? ` ${priced.length - realizedCases.length} of the ${priced.length} signings' first seasons are not completed yet.` : ''),
  ];

  // Coverage of the free-agent class (review R4-02: a tightening)
  const split = usable.every((p) => p.market?.thirds);
  const thirds: [number, number, number] | null = split
    ? [0, 1, 2].map((k) => priced.filter((x) => x.c.third === k).length) as [number, number, number]
    : null;
  const enough = thirds !== null && thirds.every((n) => n >= perThird);
  const coverage = {
    thirds, enough,
    text: thirds === null
      ? "The winter's free-agent class could not be split in thirds by expected wins (fewer than 3 players with expected wins whose deals ended), so whether the signings cover it is not established."
      : `The priced signings cover the winter's free-agent class by expected wins: ${thirds[0]}, ${thirds[1]} and ${thirds[2]} in its lowest, middle and top third${enough ? '' : `, fewer than the ${perThird} each third needs (a winter of cheap deals, or of stars alone, does not set the price of every win)`}.`,
  };

  const out = (status: MeasuredPrice['status'], price: Sourced<PriceBand>, text: string): MeasuredPrice => ({
    status, label: MEASURED_PRICE_LABEL, signings: priced.length, observed: signings.length, winters: winters.length, imports: input.imports,
    bases, price, realized: bases.some((b) => b.id === 'realized' && b.status === 'measured'), coverage, replacement: 'export_convention', text, stamp: SIGNINGS_POLICY_CALIBRATION,
  });
  const unknown = (status: MeasuredPrice['status'], text: string) => out(status, unknownBecause('not_exported_by_ootp', source, text), text);
  if (input.dollars) return unknown('unknown', input.dollars);
  if (usable.length === 0) {
    const apart = input.pairs.filter((p) => p.winters.length > 1);
    if (apart.length > 0) {
      return unknown('not_measured', `Not measured: no pair of imports spans exactly one winter. ${apart.map((p) => `${p.earlier} and ${p.later}: ${p.note}`).join(' ')}`);
    }
    const dates = input.importDates && input.importDates.length > 0 ? ` (${input.importDates.join(', ')})` : '';
    const held = input.imports === 0
      ? 'This save has no import recorded yet: its contracts are recorded at each import from now on.'
      : `This save has ${plural(input.imports, 'import')} recorded${dates}${input.imports > 1 ? ', none across a winter' : ''}.`;
    return unknown('no_off_season', `No off-season observed yet: the measured price needs two imports across a winter (one before its signings and one after). ${held}`);
  }
  const leftOut = signings.length - priced.length;
  const apart = input.pairs.filter((p) => p.winters.length > 1).length;
  const counted = `${plural(signings.length, 'free-agent signing')} observed over ${plural(winters.length, 'winter')}, ${priced.length} priced` +
    `${leftOut > 0 ? ` (${leftOut} left out: a first season already under way, a club that held him, or a salary not stated)` : ''}` +
    `${apart > 0 ? `; ${plural(apart, 'pair')} of imports a winter or more apart counted and not measured (winters apart)` : ''}`;
  const unbounded = bases.filter((b) => b.status === 'unbounded');
  if (unbounded.length > 0) return unknown('not_measured', `Not measured: ${counted}; ${unbounded.map((b) => b.text).join(' ')}`);
  const measured = bases.filter((b) => b.status === 'measured');
  if (measured.length === 0) return unknown('not_measured', `Not measured: ${counted}; each basis rests on at least ${need} signings (the opening basis's policy minimum). ${bases.map((b) => b.text).join(' ')}`);
  // The central in the opening's own unit, per realized win, once that reading exists (until the owner rules on the
  // unit, review R4-01); before it, the median of the projected bases, shown and never in force
  const realizedBasis = measured.find((b) => b.id === 'realized');
  const central = realizedBasis ? realizedBasis.central as number : medianOf(measured.map((b) => b.central as number));
  const centralWords = realizedBasis ? 'per realized win, the opening\'s own unit' : `the median of ${plural(measured.length, 'basis', 'bases')} per win projected at signing, never in force until the realized reading exists`;
  const value = { central, low: Math.min(...measured.map((b) => b.low as number)), high: Math.max(...measured.map((b) => b.high as number)) };
  const text = `Measured on ${counted}: ${millions(value.central)} a win (${centralWords}), band ${millions(value.low)} to ${millions(value.high)}: ` +
    `the spread of the bases with each one's sampling. ${measured.map((b) => b.text).join(' ')} ` +
    "Wins are the export's own WAR (replacement at its convention): a replacement measured from free talent is shown beside it, never applied. " +
    "Each signing is in its own winter's dollars, and nothing is discounted. The projected bases read the earlier import's expected wins, which include the chance a player does not play at all: " +
    'for the players who did sign they sit below what signed players go on to produce, so the price per projected win reads high (the if-he-plays basis removes that chance, and the realized basis needs no projection). ' +
    'Each band is a percentile bootstrap: at 20 to 40 signings it covers less than its 80% (about 75% in a Monte Carlo on the Arizona market; review R4-09).';
  return out('measured', derivedFrom(value, source, text), text);
}

// ── adoption (owner Q-4) ─────────────────────────────────────────────────────

const ADOPTION_RULE =
  'The measured price replaces the opening one only when its band is narrower than the opening band with its sampling (owner Q-4): the evidence decides, not a ' +
  "count of signings. It is compared only when it holds the realized reading, per win produced in the first season (the opening's own unit), and when its signings " +
  "cover each third of the winter's free-agent class (review 2026-09-24, a tightening): a price per projected win is never swapped in for a price per realized win, " +
  'and a winter of cheap deals alone never sets the price.';

/** The measured bases in their units, in words. */
function unitWords(m: MeasuredPrice): string {
  const b = (id: MeasuredBasisId) => m.bases.find((x) => x.id === id && x.status === 'measured');
  const projected = (['whole', 'first', 'if_plays'] as const).map((id) => b(id)).filter((x): x is MeasuredBasis => !!x);
  const names: Record<MeasuredBasisId, string> = { whole: 'over the deal', first: 'first season', if_plays: 'if he plays', realized: 'first season' };
  const parts: string[] = [];
  if (projected.length > 0) parts.push(`per win projected at signing (${projected.map((x) => `${names[x.id]} ${millions(x.central as number)}`).join(', ')})`);
  const r = b('realized');
  if (r) parts.push(`per realized win (${names.realized} ${millions(r.central as number)}, on its schedule's footing, as the opening reads a season)`);
  return parts.join(' and ');
}

/** Flags on a measured central against the opening (review R4-11): below the floor, or outside the opening band with its sampling. */
function flagsOf(opening: PriceOfWin, m: PriceBand, band: { low: number; high: number } | null): string[] {
  const out: string[] = [];
  const floor = opening.floor.value;
  if (floor && m.central < floor.high) {
    out.push(`Flag: the measured central ${millions(m.central)} is below the opening floor (${millions(floor.low)}–${millions(floor.high)}), what the league pays every major leaguer per win, pay held below the market included: a market price below it suggests the projection or the signings observed are off.`);
  }
  if (band && (m.central < band.low || m.central > band.high)) {
    out.push(`Flag: the measured central ${millions(m.central)} lies outside the opening band with its sampling (${millions(band.low)}–${millions(band.high)}).`);
  }
  return out;
}

/**
 * The price of a win in force (owner Q-4, reviewed 2026-09-24): the measured price only when it holds the realized
 * reading, covers the free-agent class, and its band is narrower than the opening band with its sampling; otherwise
 * the opening price, saying why and naming each reading's unit. An opening band whose sampling has no upper edge is
 * wider than any bounded band. The floor stays the opening's floor either way.
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
  const units = unitWords(measured);
  const flags = flagsOf(opening, m, comparable ?? (o ? { low: o.low, high: o.high } : null));
  const flagged = flags.length > 0 ? ` ${flags.join(' ')}` : '';
  const takes = (reason: string): PriceOfWin => ({
    ...opening, stage: 'measured', label: MEASURED_PRICE_LABEL, price: measured.price, unit: 'dollars_per_win',
    rules: {
      ...opening.rules,
      band: 'The band runs over the measured bases with each basis\'s resampled band in it: the spread of defensible readings of the signings observed, with their sampling (the opening bases below are the opening reading, not in force).',
      central: 'The realized basis: per win the signings produced in their first season, the opening price\'s own unit (until the owner rules on which unit the price in force uses).',
    },
    stamps: { ...opening.stamps, bases: SIGNINGS_POLICY_CALIBRATION },
    adoption: { inForce: 'measured', reason: `The measured price is in force: ${reason}${flagged}`, opening: openingSummary, measured, rule: ADOPTION_RULE },
  });
  const unmet: string[] = [];
  if (!measured.realized) {
    unmet.push(`its bases are ${units}; the opening price is per realized win (salary over the WAR a season produced), and the realized reading, per win the signings produced in their first season, waits for that season to be completed, so the two are not yet compared like for like (an open owner question: which unit the price in force uses)`);
  }
  if (!measured.coverage.enough) unmet.push(measured.coverage.text.replace(/\.$/, '').replace(/^The /, 'the '));
  if (unmet.length > 0) return stays(`${counted}; the measured band ${measuredBand} is not compared: ${unmet.join('; ')}.${flagged}`);
  if (o === null) return takes(`${counted}; the opening price is unknown (${opening.price.note ?? 'not stated'}), so the measured band ${measuredBand} is the only one. Its bases are ${units}.`);
  if (comparable === null) {
    return takes(`${counted}; the measured band ${measuredBand} is narrower than the opening band with its sampling, which has no upper edge (a basis's resampled band is unbounded). Its bases are ${units}.`);
  }
  const openWords = `${millions(comparable.low)}–${millions(comparable.high)} (${millions(comparable.high - comparable.low)} wide, its bases with their sampling)`;
  if (m.high - m.low < comparable.high - comparable.low) {
    return takes(`${counted}; the measured band ${measuredBand} is narrower than the opening band ${openWords}. Its bases are ${units}.`);
  }
  return stays(`${counted}; the measured band ${measuredBand} is wider than the opening band ${openWords}, so the opening price stays until the signings narrow it (Q-4). Its bases are ${units}.${flagged}`);
}

// ── observed arbitration salaries ────────────────────────────────────────────

/** An award's class as the ladder reads it (the lowest class of his trip, capped at the top class), or null where the trip is not recorded. */
function awardClass(c: ObservedChange, classes: number | null): number | null {
  if (!c.arbitrationClass) return null;
  return classes === null ? c.arbitrationClass.low : Math.min(c.arbitrationClass.low, classes);
}

export interface AwardScore {
  status: 'scored' | 'none' | 'no_arbitration' | 'unknown';
  /** Arbitration salaries observed, and those the earlier import had priced a band for. */
  awards: number;
  scored: number;
  covered: number;
  coverage: number | null;
  /** How sharp the bands scored were (review R4-08): their median ratio of top to bottom, and their median width as a share of the salary. */
  sharpness: { medianRatio: number | null; medianWidthShare: number | null };
  byClass: Array<{ arbitrationClass: number; scored: number; covered: number }>;
  /** Scored awards whose trip was not recorded: in the total, in no class. */
  unclassed: number;
  text: string;
}

/**
 * Observed arbitration salaries against the band the earlier import's ladder priced for that season (4.4): how many
 * fell inside it, beside how wide the bands were (a band six times as high at its top as its bottom covers nearly
 * anything). A range of reasonable readings, not a calibrated interval, so it is reported, never gated. Each is read
 * in the class the ladder reads it in (a later trip in the top class); a trip not recorded is in no class.
 */
export function scoreAwards(pairs: WinterPair[], regime: Pick<ArbitrationRegime, 'status' | 'classes' | 'mlb'>): AwardScore {
  const empty = { awards: 0, scored: 0, covered: 0, coverage: null, sharpness: { medianRatio: null, medianWidthShare: null }, byClass: [], unclassed: 0 };
  if (regime.status === 'no_arbitration' || regime.status === 'reserve_clause') {
    return { status: 'no_arbitration', ...empty, text: 'This league has no salary arbitration: there are no arbitration salaries to score the ladder against.' };
  }
  if (regime.status !== 'arbitration') return { status: 'unknown', ...empty, text: "The league's arbitration rule is not read, so no salary is read as an arbitration salary." };
  const awards = measurable(pairs).flatMap((p) => p.changes.filter((c) => c.kind === 'arbitration_salary' && c.salary !== null));
  const scored = awards.filter((c) => c.nextCost !== null && c.nextCost !== undefined);
  if (awards.length === 0) return { status: 'none', ...empty, text: 'No arbitration salary observed across a winter yet: the ladder is measured on each import and not yet tested against one.' };
  const inBand = (c: ObservedChange) => (c.salary as number) >= (c.nextCost as { low: number }).low && (c.salary as number) <= (c.nextCost as { high: number }).high;
  const covered = scored.filter(inBand).length;
  const classes = new Map<number, { scored: number; covered: number }>();
  let unclassed = 0;
  let capped = 0;
  for (const c of scored) {
    const k = awardClass(c, regime.classes);
    if (k === null) {
      unclassed += 1;
      continue;
    }
    if (c.arbitrationClass && regime.classes !== null && c.arbitrationClass.low > regime.classes) capped += 1;
    const e = classes.get(k) ?? { scored: 0, covered: 0 };
    e.scored += 1;
    if (inBand(c)) e.covered += 1;
    classes.set(k, e);
  }
  const ratios = scored.map((c) => c.nextCost as { low: number; high: number }).filter((b) => b.low > 0).map((b) => b.high / b.low);
  const widths = scored.map((c) => ((c.nextCost as { low: number; high: number }).high - (c.nextCost as { low: number }).low) / (c.salary as number)).filter((x) => Number.isFinite(x));
  const sharpness = { medianRatio: ratios.length > 0 ? medianOf(ratios) : null, medianWidthShare: widths.length > 0 ? medianOf(widths) : null };
  const coverage = scored.length > 0 ? covered / scored.length : null;
  const sharp = sharpness.medianRatio !== null
    ? ` The bands scored were a median ${sharpness.medianRatio.toFixed(1)} times as high at their top as at their bottom${sharpness.medianWidthShare !== null ? ` (${pct(sharpness.medianWidthShare)} of the salary wide)` : ''}: coverage follows partly from that width, so it is read beside it.`
    : '';
  const where = `${capped > 0 ? ` ${plural(capped, 'award')} on a trip beyond the top class ${capped === 1 ? 'is' : 'are'} read in class ${regime.classes}, the top class, as the ladder reads a later trip.` : ''}` +
    `${unclassed > 0 ? ` ${plural(unclassed, 'award')} whose trip was not recorded ${unclassed === 1 ? 'is' : 'are'} scored in the total and in no class.` : ''}`;
  const text = scored.length > 0
    ? `${covered} of ${scored.length} observed arbitration salaries fell inside the band the earlier import priced for them (${Math.round((coverage as number) * 100)}%); ${awards.length - scored.length} had no band priced then.${sharp}${where} The ladder's bands are ranges of reasonable readings, not calibrated intervals: reported, not gated.`
    : `${plural(awards.length, 'arbitration salary', 'arbitration salaries')} observed; the earlier import priced no band for any of them, so none is scored.`;
  return {
    status: 'scored', awards: awards.length, scored: scored.length, covered, coverage, sharpness,
    byClass: [...classes].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ arbitrationClass: k, ...v })), unclassed, text,
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
 * line (a base and a share of the price per platform win), once the class holds the ladder's minimum of them. Each is
 * read in the class the ladder reads it in (the lowest class of his trip, a later trip in the top class); an award
 * whose trip was not recorded, or whose platform the export cannot read, is counted and left out. The platform is
 * each player's, read from the export (`platformOf`); each salary is in its own winter's dollars.
 */
export function awardReadings(
  pairs: WinterPair[], platformOf: (playerId: number, firstSeason: number) => number | null, priceCentral: number, classes: number | null,
): { readings: AwardReading[]; leftOut: number; capped: number; text: string } {
  const byClass = new Map<number, Array<{ platform: number; above: number }>>();
  let leftOut = 0;
  let capped = 0;
  for (const p of measurable(pairs)) {
    for (const c of p.changes) {
      if (c.kind !== 'arbitration_salary' || c.salary === null || c.minimum === null || c.firstSeason === null) continue;
      const k = awardClass(c, classes);
      const platform = k === null ? null : platformOf(c.playerId, c.firstSeason);
      if (k === null || platform === null) {
        leftOut += 1;
        continue;
      }
      if (c.arbitrationClass && classes !== null && c.arbitrationClass.low > classes) capped += 1;
      const list = byClass.get(k) ?? [];
      list.push({ platform, above: c.salary - c.minimum });
      byClass.set(k, list);
    }
  }
  const need = COST_POLICY.ladder.minimumCases;
  const readings = [...byClass].sort((a, b) => a[0] - b[0]).map(([k, cases]): AwardReading => {
    const line = cases.length >= need ? lineOf(cases, priceCentral) : null;
    return line
      ? { arbitrationClass: k, cases: cases.length, status: 'measured', reading: line, text: `Class ${k}: ${cases.length} observed arbitration salaries, pooled over the winters observed, joined its readings: a reading of the class beside this import's cross-section (the band covers both).` }
      : { arbitrationClass: k, cases: cases.length, status: 'thin', reading: null, text: `Class ${k}: ${plural(cases.length, 'observed arbitration salary', 'observed arbitration salaries')}, fewer than the ${need} a reading needs: scored, not used.` };
  });
  const text = [
    capped > 0 ? `${plural(capped, 'observed arbitration salary', 'observed arbitration salaries')} on a trip beyond the top class ${capped === 1 ? 'is' : 'are'} read in class ${classes}, the top class, as the ladder reads a later trip.` : '',
    leftOut > 0 ? `${plural(leftOut, 'observed arbitration salary', 'observed arbitration salaries')} left out of the class readings: the trip was not recorded, or the platform cannot be read from the export.` : '',
  ].filter(Boolean).join(' ');
  return { readings, leftOut, capped, text };
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
  const renewals = measurable(pairs).flatMap((p) => p.changes.filter((c) => c.kind === 'reserve_clause_renewal' && c.salary !== null));
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
