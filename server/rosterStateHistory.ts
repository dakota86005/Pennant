/**
 * Longitudinal, observed roster-state history.
 *
 * Its role in the source hierarchy (D-020) is deliberately the smallest one:
 *
 *   - a record of what Pennant saw at each import (`observed_snapshot`);
 *   - a fallback history when OOTP's live transaction log is unavailable;
 *   - a consistency check on the explicit sources;
 *   - a way to notice a state change nothing explicit accounts for.
 *
 * It never overrides the CSV's current state and never overrides the live
 * transaction log. A difference between two snapshots is evidence that state
 * CHANGED. It is not proof of which transaction changed it, so this module
 * never names one: no "optioned", "recalled", "DFA'd" is ever produced here.
 * Where an explicit log event falls inside the interval between two snapshots
 * it is attached as evidence, and where none does the change is flagged as
 * unexplained instead of being given a cause.
 */

import { createHash } from 'node:crypto';
import { db, tableColumns, tableExists } from './db.js';
import { loadConfig } from './config.js';
import { historyDb } from './history.js';
import { allPlayerStates, type PlayerState } from './playerState.js';
import { playerRosterEventHistory, type PlayerRosterEvent } from './transactionHistory.js';
import { currentTransactionLog } from './dataStatus.js';
import { parseGameDate, addDays } from './dataFreshness.js';
import type { TransactionEvent, TransactionKind, TransactionLog } from './transactionLog.js';
import type { Provenance, UnknownReason } from './provenance.js';

historyDb.exec(`
  CREATE TABLE IF NOT EXISTS roster_state_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_name TEXT NOT NULL,
    league_id INTEGER,
    game_date TEXT,
    observed_at TEXT NOT NULL,
    state_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_roster_state_snapshot_save
    ON roster_state_snapshots (save_name, id);
  CREATE TABLE IF NOT EXISTS roster_state_snapshot_players (
    snapshot_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    organization_id INTEGER,
    team_id INTEGER,
    team_level INTEGER,
    position INTEGER,
    role INTEGER,
    active_mlb INTEGER,
    forty_man INTEGER,
    on_il INTEGER,
    on_il60 INTEGER,
    injury_active INTEGER,
    injury_day_to_day INTEGER,
    injury_days_left INTEGER,
    designated_for_assignment INTEGER,
    on_waivers INTEGER,
    major_league_contract INTEGER,
    unknowns_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_roster_state_player
    ON roster_state_snapshot_players (player_id, snapshot_id);
  CREATE TABLE IF NOT EXISTS roster_state_transitions (
    snapshot_id INTEGER NOT NULL,
    prior_snapshot_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    transition_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, player_id)
  );
`);

export interface RosterStateUnknown {
  code: UnknownReason | string;
  message: string;
}

export interface PersistentRosterState {
  playerId: number;
  name: string;
  organizationId: number | null;
  teamId: number | null;
  teamLevel: number | null;
  position: number | null;
  role: number | null;
  activeMlb: boolean | null;
  fortyMan: boolean | null;
  onIl: boolean | null;
  onIl60: boolean | null;
  injuryActive: boolean | null;
  injuryDayToDay: boolean | null;
  injuryDaysLeft: number | null;
  designatedForAssignment: boolean | null;
  onWaivers: boolean | null;
  majorLeagueContract: boolean | null;
  unknowns: RosterStateUnknown[];
}

export interface RosterStateSnapshot {
  id: number;
  saveName: string;
  leagueId: number | null;
  gameDate: string | null;
  observedAt: string;
  stateHash: string;
  players: PersistentRosterState[];
}

export interface RosterStateFieldChange {
  field:
    | 'organizationId'
    | 'teamId'
    | 'teamLevel'
    | 'activeMlb'
    | 'fortyMan'
    | 'onIl'
    | 'onIl60'
    | 'designatedForAssignment'
    | 'onWaivers'
    | 'majorLeagueContract';
  before: number | boolean | null;
  after: number | boolean | null;
}

export interface ObservedRosterTransition {
  provenance: Extract<Provenance, 'observed_snapshot'>;
  playerId: number;
  playerName: string;
  priorSnapshotId: number;
  snapshotId: number;
  firstObservedAt: string;
  kind: 'appeared' | 'disappeared' | 'changed';
  changes: RosterStateFieldChange[];
}

export interface RosterCausalEvidence {
  provenance: Extract<Provenance, 'explicit_export' | 'observed_snapshot'>;
  event: PlayerRosterEvent | {
    kind: 'injury';
    date: string | null;
    source: 'normalized_roster_state';
    details: { injuryActive: true; dayToDay: boolean | null; daysLeft: number | null };
  };
}

/** An association supported by explicit export tables. It says nothing about a roster move. */
export interface RosterCausalCorrelation {
  conclusion: 'trade_associated_organization_change' | 'injury_associated_il_change' | 'unknown';
  provenance: Extract<Provenance, 'derived' | 'unknown'>;
  evidence: RosterCausalEvidence[];
}

/**
 * What the live transaction log holds for a changed player in the interval
 * between two snapshots.
 *
 *   events_in_window  explicit events exist that may account for the change.
 *                     They are attached as evidence; nothing is inferred.
 *   none_in_window    the log covers the interval and holds nothing for him,
 *                     so the change is unexplained by the log.
 *   log_behind        the log does not reach the end of the interval.
 *   log_unavailable   no transaction log could be read.
 */
export interface LogEvidence {
  status: 'events_in_window' | 'none_in_window' | 'log_behind' | 'log_unavailable';
  events: Array<{ kind: TransactionKind; date: string | null; text: string; logId: number }>;
}

/** A transition, plus everything explicit that bears on it. */
export interface StructuredRosterEvent {
  transition: ObservedRosterTransition;
  causalCorrelation: RosterCausalCorrelation;
  logEvidence: LogEvidence;
  /**
   * A change to a tracked field that neither the transaction log (which covers
   * the interval) nor an explicit export table accounts for. A prompt to look,
   * not a conclusion.
   */
  unexplained: boolean;
}

export interface RosterStateCapture {
  status: 'created' | 'duplicate' | 'unavailable';
  snapshot: RosterStateSnapshot | null;
  events: StructuredRosterEvent[];
}

const boolFromDb = (value: unknown): boolean | null =>
  value === null || value === undefined ? null : value === 1;
const dbBool = (value: boolean | null): number | null => value === null ? null : value ? 1 : 0;
const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function currentSaveName(): string {
  return loadConfig().saveName ?? 'unknown';
}

function importedLeagueIdentity(): { leagueId: number | null; gameDate: string | null } {
  if (!tableExists('leagues') || !tableExists('teams')) return { leagueId: null, gameDate: null };
  const leagueColumns = new Set(tableColumns('leagues'));
  const teamColumns = new Set(tableColumns('teams'));
  if (!['league_id', 'current_date'].every((column) => leagueColumns.has(column)) ||
      !['league_id', 'level'].every((column) => teamColumns.has(column))) return { leagueId: null, gameDate: null };
  const row = db.prepare(
    `SELECT l.league_id, l."current_date" AS game_date
     FROM leagues l
     WHERE l.league_id IN (SELECT DISTINCT league_id FROM teams WHERE level = 1)
     ORDER BY l.league_id
     LIMIT 1`
  ).get() as { league_id: number | null; game_date: string | null } | undefined;
  return { leagueId: numberOrNull(row?.league_id), gameDate: typeof row?.game_date === 'string' ? row.game_date : null };
}

/** The fields that carry a roster fact; a missing one is recorded with its reason. */
function unknownsOf(state: PlayerState): RosterStateUnknown[] {
  const tracked: Array<[string, { value: unknown; reason?: UnknownReason; source: string | null; note?: string }]> = [
    ['activeRoster', state.activeRoster], ['fortyMan', state.fortyMan],
    ['onIl', state.injuredList.onIl], ['onIl60', state.injuredList.onIl60],
    ['designated', state.dfa.designated], ['onWaivers', state.dfa.onWaivers],
    ['majorLeagueContract', state.contract.majorLeague], ['level', state.level],
  ];
  return tracked
    .filter(([, field]) => field.value === null)
    .map(([name, field]) => ({
      code: field.reason ?? 'not_exported_by_ootp',
      message: `${name}: ${field.note ?? field.source ?? 'unavailable'}`,
    }));
}

function persistedState(state: PlayerState): PersistentRosterState {
  return {
    playerId: state.playerId,
    name: state.name,
    organizationId: state.organizationId.value,
    teamId: state.teamId.value,
    teamLevel: state.level.value,
    // Descriptive rather than roster state, and not part of the state model
    position: null,
    role: null,
    activeMlb: state.activeRoster.value,
    fortyMan: state.fortyMan.value,
    onIl: state.injuredList.onIl.value,
    onIl60: state.injuredList.onIl60.value,
    injuryActive: state.injury.injured.value,
    injuryDayToDay: state.injury.dayToDay.value,
    injuryDaysLeft: state.injury.daysLeft.value,
    designatedForAssignment: state.dfa.designated.value,
    onWaivers: state.dfa.onWaivers.value,
    majorLeagueContract: state.contract.majorLeague.value,
    unknowns: unknownsOf(state),
  };
}

function stateHash(players: PersistentRosterState[]): string {
  const canonical = [...players]
    .sort((a, b) => a.playerId - b.playerId)
    .map(({ unknowns: _unknowns, name: _name, ...state }) => state);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function snapshotFromRows(
  snapshot: Omit<RosterStateSnapshot, 'players'>,
  rows: Array<Record<string, unknown>>
): RosterStateSnapshot {
  return {
    ...snapshot,
    players: rows.map((row) => ({
      playerId: numberOrNull(row.player_id) ?? 0,
      name: typeof row.name === 'string' ? row.name : '',
      organizationId: numberOrNull(row.organization_id),
      teamId: numberOrNull(row.team_id),
      teamLevel: numberOrNull(row.team_level),
      position: numberOrNull(row.position),
      role: numberOrNull(row.role),
      activeMlb: boolFromDb(row.active_mlb),
      fortyMan: boolFromDb(row.forty_man),
      onIl: boolFromDb(row.on_il),
      onIl60: boolFromDb(row.on_il60),
      injuryActive: boolFromDb(row.injury_active),
      injuryDayToDay: boolFromDb(row.injury_day_to_day),
      injuryDaysLeft: numberOrNull(row.injury_days_left),
      designatedForAssignment: boolFromDb(row.designated_for_assignment),
      onWaivers: boolFromDb(row.on_waivers),
      majorLeagueContract: boolFromDb(row.major_league_contract),
      unknowns: (() => {
        try { return JSON.parse(typeof row.unknowns_json === 'string' ? row.unknowns_json : '[]') as RosterStateUnknown[]; } catch { return []; }
      })(),
    })),
  };
}

function readSnapshotById(id: number): RosterStateSnapshot | null {
  const meta = historyDb.prepare(
    `SELECT id, save_name, league_id, game_date, observed_at, state_hash
     FROM roster_state_snapshots WHERE id = ?`
  ).get(id) as Record<string, unknown> | undefined;
  if (!meta) return null;
  const rows = historyDb.prepare(
    `SELECT player_id, name, organization_id, team_id, team_level, position, role,
            active_mlb, forty_man, on_il, on_il60, injury_active,
            injury_day_to_day, injury_days_left, designated_for_assignment,
            on_waivers, major_league_contract, unknowns_json
     FROM roster_state_snapshot_players WHERE snapshot_id = ? ORDER BY player_id`
  ).all(id) as Array<Record<string, unknown>>;
  return snapshotFromRows({
    id: numberOrNull(meta.id) ?? id,
    saveName: typeof meta.save_name === 'string' ? meta.save_name : 'unknown',
    leagueId: numberOrNull(meta.league_id),
    gameDate: typeof meta.game_date === 'string' ? meta.game_date : null,
    observedAt: typeof meta.observed_at === 'string' ? meta.observed_at : '',
    stateHash: typeof meta.state_hash === 'string' ? meta.state_hash : '',
  }, rows);
}

/** Read a persisted snapshot by id. */
export function rosterStateSnapshotById(id: number): RosterStateSnapshot | null {
  return readSnapshotById(id);
}

function latestSnapshot(saveName: string): RosterStateSnapshot | null {
  const row = historyDb.prepare(
    `SELECT id FROM roster_state_snapshots WHERE save_name = ? ORDER BY id DESC LIMIT 1`
  ).get(saveName) as { id: number } | undefined;
  return row ? readSnapshotById(row.id) : null;
}

export function latestRosterStateSnapshot(saveName = currentSaveName()): RosterStateSnapshot | null {
  return latestSnapshot(saveName);
}

function valuesDiffer(before: number | boolean | null, after: number | boolean | null): boolean {
  // An absent optional column becoming available is useful snapshot metadata,
  // not proof of a baseball move.
  return before !== null && after !== null && before !== after;
}

const comparableFields: Array<RosterStateFieldChange['field']> = [
  'organizationId', 'teamId', 'teamLevel', 'activeMlb',
  'fortyMan', 'onIl', 'onIl60', 'designatedForAssignment', 'onWaivers', 'majorLeagueContract',
];

/** Deterministically compare two persisted factual snapshots; no causes are guessed here. */
export function compareRosterStateSnapshots(
  previous: RosterStateSnapshot,
  current: RosterStateSnapshot
): ObservedRosterTransition[] {
  const before = new Map(previous.players.map((player) => [player.playerId, player]));
  const after = new Map(current.players.map((player) => [player.playerId, player]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  const transitions: ObservedRosterTransition[] = [];
  for (const playerId of ids) {
    const oldState = before.get(playerId);
    const newState = after.get(playerId);
    if (!oldState || !newState) {
      transitions.push({
        provenance: 'observed_snapshot', playerId, playerName: (newState ?? oldState)!.name,
        priorSnapshotId: previous.id, snapshotId: current.id, firstObservedAt: current.observedAt,
        kind: oldState ? 'disappeared' : 'appeared', changes: [],
      });
      continue;
    }
    const changes = comparableFields.flatMap((field) => {
      const oldValue = oldState[field] as number | boolean | null;
      const newValue = newState[field] as number | boolean | null;
      return valuesDiffer(oldValue, newValue) ? [{ field, before: oldValue, after: newValue }] : [];
    });
    if (changes.length) transitions.push({
      provenance: 'observed_snapshot', playerId, playerName: newState.name,
      priorSnapshotId: previous.id, snapshotId: current.id, firstObservedAt: current.observedAt,
      kind: 'changed', changes,
    });
  }
  return transitions;
}

function dateNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (!match) return null;
  const result = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(result) ? result : null;
}

function eventInSnapshotInterval(event: PlayerRosterEvent, previous: RosterStateSnapshot, current: RosterStateSnapshot): boolean {
  if (!event.date || !previous.gameDate || !current.gameDate) return false;
  const eventDate = dateNumber(event.date);
  const firstDate = dateNumber(previous.gameDate);
  const lastDate = dateNumber(current.gameDate);
  if (eventDate === null || firstDate === null || lastDate === null) return false;
  return eventDate >= Math.min(firstDate, lastDate) && eventDate <= Math.max(firstDate, lastDate);
}

function hasChange(transition: ObservedRosterTransition, field: RosterStateFieldChange['field'], before?: boolean, after?: boolean): boolean {
  return transition.changes.some((change) =>
    change.field === field &&
    (before === undefined || change.before === before) &&
    (after === undefined || change.after === after)
  );
}

function tradeMatchesOrganizationChange(event: PlayerRosterEvent, transition: ObservedRosterTransition): boolean {
  if (event.kind !== 'trade' || !hasChange(transition, 'organizationId')) return false;
  const change = transition.changes.find((candidate) => candidate.field === 'organizationId')!;
  const teams = [event.details.teamId0, event.details.teamId1].filter((id): id is number => typeof id === 'number');
  return typeof change.before === 'number' && typeof change.after === 'number' &&
    teams.includes(change.before) && teams.includes(change.after);
}

/**
 * Associate only explicit OOTP export tables (trade history, injury history)
 * with an observed transition. The result remains unknown for ordinary
 * assignments, options, releases, and anything those tables do not cover.
 */
export function correlateRosterTransition(
  transition: ObservedRosterTransition,
  previous: RosterStateSnapshot,
  current: RosterStateSnapshot
): RosterCausalCorrelation {
  const events = playerRosterEventHistory(transition.playerId)
    .filter((event) => eventInSnapshotInterval(event, previous, current));
  const tradeEvidence = events.filter((event) => tradeMatchesOrganizationChange(event, transition));
  if (tradeEvidence.length) return {
    conclusion: 'trade_associated_organization_change', provenance: 'derived',
    evidence: tradeEvidence.map((event) => ({ provenance: 'explicit_export', event })),
  };
  const enteredIl = hasChange(transition, 'onIl', false, true) || hasChange(transition, 'onIl60', false, true);
  const injuryEvidence: RosterCausalEvidence[] = enteredIl
    ? events.filter((event) => event.kind === 'injury').map((event) => ({ provenance: 'explicit_export', event }))
    : [];
  const currentPlayer = enteredIl
    ? current.players.find((player) => player.playerId === transition.playerId)
    : undefined;
  if (currentPlayer?.injuryActive === true) {
    injuryEvidence.push({
      provenance: 'observed_snapshot',
      event: {
        kind: 'injury',
        date: current.gameDate,
        source: 'normalized_roster_state',
        details: {
          injuryActive: true,
          dayToDay: currentPlayer.injuryDayToDay,
          daysLeft: currentPlayer.injuryDaysLeft,
        },
      },
    });
  }
  if (injuryEvidence.length) return {
    conclusion: 'injury_associated_il_change', provenance: 'derived',
    evidence: injuryEvidence,
  };
  return { conclusion: 'unknown', provenance: 'unknown', evidence: [] };
}

/** Who may have a log event in the interval, and whether the log even covers it. */
export interface LogWindowSource {
  log: TransactionLog | null;
}

/**
 * Explicit log events for one player between two snapshots. The interval is
 * the two snapshots' in-game dates, inclusive at both ends: a move logged on a
 * snapshot's own date may be on either side of that export, and this only says
 * such an event exists, not that it caused the change.
 */
export function logEvidenceForTransition(
  transition: ObservedRosterTransition,
  previous: RosterStateSnapshot,
  current: RosterStateSnapshot,
  source: LogWindowSource
): LogEvidence {
  const log = source.log;
  if (!log) return { status: 'log_unavailable', events: [] };
  const from = previous.gameDate ? parseGameDate(previous.gameDate) : null;
  const to = current.gameDate ? parseGameDate(current.gameDate) : null;
  const inWindow = (log.byPlayer.get(transition.playerId) ?? []).filter(
    (e: TransactionEvent) => !!e.date && !!from && !!to && e.date >= from && e.date <= to
  );
  if (inWindow.length) {
    return {
      status: 'events_in_window',
      events: inWindow.map((e) => ({ kind: e.kind, date: e.date, text: e.text, logId: e.sources[0].logId })),
    };
  }
  // The snapshot reflects the day before its current_date; a log that stops
  // short of that has not yet recorded what happened
  const covered = log.coverage.coveredThrough;
  if (!to || !covered || covered < addDays(to, -1)) return { status: 'log_behind', events: [] };
  return { status: 'none_in_window', events: [] };
}

function structure(
  transition: ObservedRosterTransition,
  previous: RosterStateSnapshot,
  current: RosterStateSnapshot,
  source: LogWindowSource
): StructuredRosterEvent {
  const causalCorrelation = correlateRosterTransition(transition, previous, current);
  const logEvidence = logEvidenceForTransition(transition, previous, current, source);
  return {
    transition,
    causalCorrelation,
    logEvidence,
    unexplained:
      transition.kind === 'changed' &&
      logEvidence.status === 'none_in_window' &&
      causalCorrelation.conclusion === 'unknown',
  };
}

function persistEvents(events: StructuredRosterEvent[]): void {
  const insert = historyDb.prepare(
    `INSERT OR REPLACE INTO roster_state_transitions
     (snapshot_id, prior_snapshot_id, player_id, transition_json) VALUES (?, ?, ?, ?)`
  );
  for (const event of events) {
    insert.run(event.transition.snapshotId, event.transition.priorSnapshotId, event.transition.playerId, JSON.stringify(event));
  }
}

/**
 * Capture a roster state only after a completed import. The immediate prior
 * snapshot is the dedupe comparator, so A → B → A on one OOTP date is retained
 * while a repeated import of A is not.
 */
export function captureRosterStateSnapshot(
  source: LogWindowSource = { log: currentTransactionLog().log }
): RosterStateCapture {
  const players = allPlayerStates().map(persistedState).filter((player) => player.playerId > 0);
  if (!players.length) return { status: 'unavailable', snapshot: null, events: [] };
  const saveName = currentSaveName();
  const { leagueId, gameDate } = importedLeagueIdentity();
  const hash = stateHash(players);
  const previous = latestSnapshot(saveName);
  if (previous && previous.gameDate === gameDate && previous.stateHash === hash) {
    return { status: 'duplicate', snapshot: previous, events: [] };
  }
  const observedAt = new Date().toISOString();
  const insertSnapshot = historyDb.prepare(
    `INSERT INTO roster_state_snapshots (save_name, league_id, game_date, observed_at, state_hash)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertPlayer = historyDb.prepare(
    `INSERT INTO roster_state_snapshot_players
     (snapshot_id, player_id, name, organization_id, team_id, team_level, position, role,
      active_mlb, forty_man, on_il, on_il60, injury_active, injury_day_to_day,
      injury_days_left, designated_for_assignment, on_waivers, major_league_contract,
      unknowns_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let snapshotId = 0;
  historyDb.transaction(() => {
    const result = insertSnapshot.run(saveName, leagueId, gameDate, observedAt, hash);
    snapshotId = Number(result.lastInsertRowid);
    for (const player of players) {
      insertPlayer.run(
        snapshotId, player.playerId, player.name, player.organizationId, player.teamId, player.teamLevel,
        player.position, player.role, dbBool(player.activeMlb), dbBool(player.fortyMan), dbBool(player.onIl),
        dbBool(player.onIl60), dbBool(player.injuryActive), dbBool(player.injuryDayToDay),
        player.injuryDaysLeft, dbBool(player.designatedForAssignment), dbBool(player.onWaivers),
        dbBool(player.majorLeagueContract), JSON.stringify(player.unknowns)
      );
    }
  })();
  const snapshot = readSnapshotById(snapshotId)!;
  const events = previous
    ? compareRosterStateSnapshots(previous, snapshot).map((transition) => structure(transition, previous, snapshot, source))
    : [];
  if (events.length) persistEvents(events);
  return { status: 'created', snapshot, events };
}

/** Read the recorded changes first observed in one snapshot. */
export function rosterStateEventsForSnapshot(snapshotId: number): StructuredRosterEvent[] {
  return (historyDb.prepare(
    `SELECT transition_json FROM roster_state_transitions WHERE snapshot_id = ? ORDER BY player_id`
  ).all(snapshotId) as Array<{ transition_json: string }>).flatMap((row) => {
    try { return [JSON.parse(row.transition_json) as StructuredRosterEvent]; } catch { return []; }
  });
}

/**
 * Read the observed-change timeline for one save. Consumers still have to
 * validate each observed change against current state; this is history, not a
 * list of perpetually open work items.
 */
export function rosterStateEventsForSave(saveName = currentSaveName()): StructuredRosterEvent[] {
  return (historyDb.prepare(
    `SELECT t.transition_json
     FROM roster_state_transitions t
     JOIN roster_state_snapshots s ON s.id = t.snapshot_id
     WHERE s.save_name = ?
     ORDER BY t.snapshot_id, t.player_id`
  ).all(saveName) as Array<{ transition_json: string }>).flatMap((row) => {
    try { return [JSON.parse(row.transition_json) as StructuredRosterEvent]; } catch { return []; }
  });
}
