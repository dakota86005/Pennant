/**
 * The Morning Report's reader (N6, Stage A; SWIFTUI_REBUILD.md section 3.4): gathers what the masthead, "How we win and
 * lose" and the roster map show, from the specialists that own each answer, for the Front Office's build to word.
 *
 * - The season's facts and the club profile: `frontOffice/teamSeason.ts` and `frontOffice/clubProfile.ts` (objective
 *   team statistics, in the landing folders).
 * - Each player's expected wins and control: Player Value's entry point, `playerValue.ts`, as current as the export is
 *   (D-052; control is Player Rights' answer as Player Value composes it). Every club's players are valued the same
 *   way, under our organization's fog of war (D-017).
 * - The farm's next man and his readiness: `mlbEvidence.ts`, the one door to the farm (D-045), which asks Player State
 *   where he is and Player Development whether a look is defensible.
 * - Whether Major League Ops raised a need at a position: the needs its overview already served, handed in by the build.
 *
 * It judges nothing of its own and ranks nothing by a hidden score; the places are `frontOffice/rosterMap.ts`'s stated
 * counts. It lives outside the landing folders because Player Value's entry point reaches the deadline read's odds model
 * (the club's value of a win); nothing of that is read here or copied into the payload (D-060,
 * `tests/frontOfficeLanding.test.ts`).
 */
import { db, tableColumns, tableExists } from './db.js';
import { freshnessCue, type DataStatus } from './dataStatus.js';
import { clubProfileOf, type ClubProfileReading } from './frontOffice/clubProfile.js';
import { positionReadings, staffOrder, valueScaleOf, type PositionPlayer, type PositionReading, type StaffInput, type WinsRange } from './frontOffice/rosterMap.js';
import { divisionPlace, pitcherLines, readTeamSeason, type DivisionPlace, type PitcherLine, type TeamSeasonFacts } from './frontOffice/teamSeason.js';
import { farmNextByPosition, type FarmNext } from './mlbEvidence.js';
import type { MlbNeed } from './mlbNeeds.js';
import { controlEndOf, playerValues, productionHeadlineOf, type ControlEnd, type ControlStatus, type PlayerValuation } from './playerValue.js';
import { organizationPlayerStates } from './playerState.js';

/** How long the club holds a player, as Player Value lays out Player Rights' answer. */
export interface ControlReading {
  end: ControlEnd;
  thisSeason: number | null;
  /** This season's and next season's status, where the timeline lays them out. */
  now: ControlStatus | null;
  next: ControlStatus | null;
  standing: 'held' | 'unsigned' | 'unknown';
  /**
   * The last season of the run from this season that the timeline lays out with the club holding him on every branch
   * (no season in it is, or may be, free agency); null when this season is not surely held. Read from Player Value's
   * statuses (Player Rights' answer), never a rule of its own: where `end` cannot say when control ends because the last
   * season laid out is unsettled between two held statuses, he is still surely held through it.
   */
  heldThrough: number | null;
}

export interface MapPosition extends PositionReading {
  farmNext: FarmNext | null;
  /** How many more of the farm's men are listed there at his level. */
  farmMore: number;
  control: ControlReading | null;
  /** The club's standing for the holder (IL, Day-to-day ...), as Player State reads it; null when active or not known. */
  standing: string | null;
  /** Major League Ops' needs at the position (its role), as it served them. */
  needs: MlbNeed[];
}

export interface MapPitcher extends StaffInput {
  line: PitcherLine;
  standing: string | null;
  /** He is OOTP's projected starter for the club's next game. */
  next: boolean;
  /** Major League Ops' needs about him by name (a flag on his work, his return), as it served them. */
  needs: MlbNeed[];
}

export interface RosterMaterial {
  positions: MapPosition[];
  /** The designated hitter's node is left out: why (the league plays without one); null when it is there. */
  noDh: string | null;
  /** Major League Ops' needs at the rotation's or the bullpen's role that name no pitcher listed here. */
  rotationNeeds: MlbNeed[];
  bullpenNeeds: MlbNeed[];
  rotation: MapPitcher[];
  bullpen: MapPitcher[];
  scale: { low: number; high: number } | null;
  /** Which part of the season the expected wins cover. */
  part: 'rest_of_season' | 'season' | null;
  season: number | null;
  clubs: number;
}

export interface MorningMaterial {
  facts: TeamSeasonFacts;
  /** The club's place in its division, from games back; null when the standings lack its record. */
  division: DivisionPlace | null;
  profile: ClubProfileReading | { why: string };
  map: RosterMaterial | { why: string };
  /** Tonight's probable starters' season lines. */
  starters: PitcherLine[];
  ms: Record<string, number>;
}

type Stamp = { status: 'calibrated' | 'provisional' | 'policy'; basis: string };
const winsOf = (v: PlayerValuation | undefined): { wins: WinsRange | null; part: 'rest_of_season' | 'season' | null; why: string | null; stamp: Stamp | null } => {
  if (!v) return { wins: null, part: null, why: 'Player Value has no reading of him.', stamp: null };
  const h = productionHeadlineOf(v.production);
  if (!h.now) return { wins: null, part: null, why: h.reason ?? 'His production is not established.', stamp: null };
  const c = v.production.basis.calibration;
  return { wins: { low: h.now.wins.low, likely: h.now.wins.central, high: h.now.wins.high }, part: h.now.part, why: null, stamp: { status: c.status, basis: c.basis } };
};

function controlOf(v: PlayerValuation | undefined): ControlReading | null {
  if (!v) return null;
  const c = v.control;
  const season = (y: number | null) => (y === null ? null : c.seasons.find((s) => s.season === y)?.status ?? null);
  const mayBeFree = (s: PlayerValuation['control']['seasons'][number]) => s.status === 'free_agent'
    || (s.status === 'indeterminate' && (s.between.length === 0 || s.between.includes('free_agent')))
    || (s.declined !== null && (s.declined.status === 'free_agent' || s.declined.between.includes('free_agent')));
  let heldThrough: number | null = null;
  if (c.standing === 'held' && c.thisSeason !== null) {
    for (let y = c.thisSeason; ; y += 1) {
      const s = c.seasons.find((x) => x.season === y);
      if (!s || mayBeFree(s)) break;
      heldThrough = y;
    }
  }
  return {
    end: controlEndOf(c), thisSeason: c.thisSeason, now: season(c.thisSeason),
    next: season(c.thisSeason === null ? null : c.thisSeason + 1), standing: c.standing, heldThrough,
  };
}

/** Every club's major-league position players by listed position (2 to 10). */
function positionPlayers(clubIds: readonly number[]): Array<{ player_id: number; name: string; position: number; team_id: number }> {
  if (!tableExists('players') || !clubIds.length) return [];
  const cols = new Set(tableColumns('players'));
  if (!['player_id', 'team_id', 'position'].every((c) => cols.has(c))) return [];
  const name = cols.has('first_name') && cols.has('last_name') ? `TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))` : `'Player ' || player_id`;
  const retired = cols.has('retired') ? 'AND COALESCE(retired, 0) = 0' : '';
  return db.prepare(`SELECT player_id, ${name} AS name, position, team_id FROM players
    WHERE team_id IN (${clubIds.join(',')}) AND position BETWEEN 2 AND 10 ${retired}`).all() as Array<{ player_id: number; name: string; position: number; team_id: number }>;
}

const NOT_SHOWN_STANDINGS = new Set(['Active', 'Reserve']);

/** Where a need sits on the map: a fielder's listed position, or the rotation (1) or the bullpen (0). */
function needSpot(n: MlbNeed): number | null {
  if (!n.role) return null;
  if (n.role.kind === 'starting_pitcher') return 1;
  if (n.role.kind === 'relief_pitcher') return 0;
  return n.role.position;
}

function readMap(facts: TeamSeasonFacts, status: DataStatus, needs: readonly MlbNeed[] | null): RosterMaterial {
  const orgId = facts.orgId;
  const clubs = facts.clubs.map((c) => ({ teamId: c.teamId, name: c.name }));
  const me = facts.clubs.find((c) => c.teamId === orgId);
  const listed = positionPlayers(clubs.map((c) => c.teamId));
  const dhRule = facts.subLeagues.find((s) => s.subLeagueId === me?.subLeagueId)?.dh ?? null;
  // The designated hitter's node, where the league uses one and a club lists a player there (OOTP lists most players at
  // their fielding position, so a league where nobody is listed at DH has no DH holder to place)
  const listsDh = listed.some((p) => p.position === 10);
  const withDh = dhRule !== false && listsDh;
  const noDh = withDh ? null
    : dhRule === false ? 'The league plays without a designated hitter.'
      : 'No club lists a player at designated hitter, so the DH isn\'t on the map.';
  const positions = [2, 3, 4, 5, 6, 7, 8, 9, ...(withDh ? [10] : [])];

  // Our major-league pitchers, as Player State places them: on the active roster, or projected to start
  const states = organizationPlayerStates(orgId).filter((s) => s.level.value === 1);
  const projected = facts.projected.find((p) => p.teamId === orgId)?.starters ?? [];
  const pitchers = states.filter((s) => s.position.value === 1 && (s.activeRoster.value === true || projected.includes(s.playerId)));

  const values = playerValues([...listed.map((p) => p.player_id), ...pitchers.map((p) => p.playerId)], { currentState: freshnessCue(status).state });
  const players: PositionPlayer[] = listed.map((p) => ({ playerId: p.player_id, name: p.name, teamId: p.team_id, position: p.position, ...winsOf(values.get(p.player_id)) }));
  const readings = positionReadings(orgId, clubs, players, positions);

  const farm = farmNextByPosition(orgId);
  const standingOf = (id: number | undefined): string | null => {
    if (id === undefined) return null;
    const s = states.find((x) => x.playerId === id)?.standing.value ?? null;
    return s && !NOT_SHOWN_STANDINGS.has(s.label) ? s.label + (s.daysLeft ? ` · ${s.daysLeft} days` : '') : null;
  };
  const needsAt = (spot: number) => (needs ?? []).filter((n) => needSpot(n) === spot);
  const aboutHim = (n: MlbNeed) => n.subject?.playerId ?? n.returning?.playerId ?? null;

  const lines = pitcherLines(pitchers.map((p) => p.playerId), facts.leagueId ?? 0, facts.season);
  const staffInputs: StaffInput[] = pitchers.map((p) => {
    const role = p.role.value;
    const at = projected.indexOf(p.playerId);
    return {
      playerId: p.playerId, name: p.name,
      kind: role === 11 ? 'starter' : role === 13 ? 'closer' : 'reliever',
      projected: at >= 0 ? at : null,
      outs: lines.get(p.playerId)?.outs ?? null,
      ...(({ wins, why, stamp }) => ({ wins, why, stamp }))(winsOf(values.get(p.playerId))),
    };
  });
  const order = staffOrder(staffInputs);
  const nextStarter = facts.next ? projected[0] ?? null : null;
  // A pitcher carries a need only where it names him; a need at the role that names no one listed here is the group's
  const staff = (list: StaffInput[], spot: number): MapPitcher[] => list.map((p) => ({
    ...p, line: lines.get(p.playerId)!, standing: standingOf(p.playerId), next: p.playerId === nextStarter,
    needs: needsAt(spot).filter((n) => aboutHim(n) === p.playerId),
  }));
  const rotation = staff(order.rotation, 1);
  const bullpen = staff(order.bullpen, 0);
  const groupNeeds = (spot: number, shown: MapPitcher[]) => needsAt(spot).filter((n) => !shown.some((p) => p.playerId === aboutHim(n)));

  const mapped: MapPosition[] = readings.map((r) => {
    const next = farm.get(r.position) ?? [];
    return {
      ...r,
      farmNext: next[0] ?? null,
      farmMore: Math.max(0, next.length - 1),
      control: r.holder ? controlOf(values.get(r.holder.playerId)) : null,
      standing: standingOf(r.holder?.playerId),
      needs: needsAt(r.position),
    };
  });
  const firstPart = players.find((p) => p.teamId === orgId && p.part)?.part ?? null;
  return {
    positions: mapped,
    noDh,
    rotationNeeds: groupNeeds(1, rotation),
    bullpenNeeds: groupNeeds(0, bullpen),
    rotation, bullpen,
    scale: valueScaleOf([...mapped.map((p) => p.holder?.wins ?? null), ...rotation.map((p) => p.wins), ...bullpen.map((p) => p.wins)]),
    part: firstPart,
    season: facts.season,
    clubs: clubs.length,
  };
}

const failed = (what: string, err: unknown): { why: string } => {
  console.error(`[front office] ${what} could not be read:`, err);
  return { why: `${what} couldn't be read this time.` };
};

/** Everything the Morning Report's own parts show, each part read on its own: one failing leaves the others. */
export function readMorning(orgId: number, status: DataStatus, needs: readonly MlbNeed[] | null): MorningMaterial {
  const ms: Record<string, number> = {};
  const timed = <T>(name: string, run: () => T): T => {
    const started = performance.now();
    try {
      return run();
    } finally {
      ms[name] = Math.round((performance.now() - started) * 10) / 10;
    }
  };
  const facts = timed('teamSeason', () => readTeamSeason(orgId));
  let profile: MorningMaterial['profile'];
  try {
    profile = timed('clubProfile', () => clubProfileOf(facts));
  } catch (err) {
    profile = failed('How the club wins and loses', err);
  }
  let map: MorningMaterial['map'];
  try {
    map = timed('rosterMap', () => readMap(facts, status, needs));
  } catch (err) {
    map = failed('The roster map', err);
  }
  let starters: PitcherLine[] = [];
  if (facts.next && facts.leagueId !== null) {
    const opponent = facts.next.home === orgId ? facts.next.away : facts.next.home;
    const ids = [orgId, opponent].map((t) => facts.projected.find((p) => p.teamId === t)?.starters[0] ?? null).filter((id): id is number => id !== null);
    starters = [...pitcherLines(ids, facts.leagueId, facts.season).values()];
  }
  return { facts, division: divisionPlace(facts), profile, map, starters, ms };
}
