import { Router, type Response } from 'express';
import { db, tableExists } from './db.js';
import { loadScoutedAbilities, summarizeEvidence } from './scoutedEvidence.js';
import { LEVEL_NAMES } from './valuation.js';
import { resolvePhilosophy } from './philosophy.js';
import { philosophyForOrg } from './settings.js';
import {
  evaluateProspectDecision,
  type ProspectNextAssignment,
} from './prospectDecision.js';
import {
  evaluateProspectAssignments,
  type ProspectAssignmentEvaluation,
} from './prospectAssignments.js';
import type { DevelopmentalJudgment, MissingEvidence } from './developmentJudgment.js';
import {
  evaluateMlbAssignmentContext,
  type ContextAssessment,
  type MlbAssignmentContext,
  type UpperLevelExperience,
} from './mlbAssignmentContext.js';
import {
  applyDestinationFitToAssignments,
} from './destinationFit.js';
import {
  expressAssignmentPreference,
} from './assignmentPreference.js';
import { openDevelopmentalContext } from './developmentalContext.js';
import type { Integer } from './contract/primitives.js';

export const orgRoutes = Router();


/** A major-league club as `GET /api/orgs` lists it. */
export interface Org {
  team_id: Integer;
  label: string;
  isHuman: boolean;
  colors: { bg: string | null; fg: string | null; secondary: string | null; cap: string | null };
}

/** MLB parent clubs, with the human-controlled org flagged and team colors. */
orgRoutes.get('/orgs', (_req, res: Response<Org[]>) => {
  if (!tableExists('teams')) return res.json([]);
  const rows = db
    .prepare(
      `SELECT team_id, name, nickname, human_team,
              background_color_id AS bg, text_color_id AS fg,
              jersey_secondary_color_id AS secondary, ballcaps_main_color_id AS cap
       FROM teams WHERE level = 1 AND allstar_team = 0 ORDER BY name`
    )
    .all() as Array<{
    team_id: number; name: string; nickname: string; human_team: number;
    bg: string | null; fg: string | null; secondary: string | null; cap: string | null;
  }>;
  res.json(
    rows.map((r) => ({
      team_id: r.team_id,
      label: r.name === r.nickname ? r.name : `${r.name} ${r.nickname}`,
      isHuman: r.human_team === 1,
      colors: { bg: r.bg, fg: r.fg, secondary: r.secondary, cap: r.cap },
    }))
  );
});

/** The column signings nobody has assigned yet are gathered under. */
const UNASSIGNED_TEAM = -1;

/**
 * The organization's clubs, walked recursively: an affiliate's affiliate is still the organization's.
 * The same walk Minor League Operations uses, so the two modules never see a different ladder.
 */
function orgTeams(orgId: number) {
  return db
    .prepare(
      `WITH RECURSIVE org AS (
         SELECT team_id, name, nickname, level, league_id FROM teams WHERE team_id = ?
         UNION ALL
         SELECT t.team_id, t.name, t.nickname, t.level, t.league_id FROM teams t JOIN org o ON t.parent_team_id = o.team_id
       )
       SELECT DISTINCT team_id, name, nickname, level, league_id FROM org ORDER BY level, team_id`
    )
    .all(orgId) as Array<{ team_id: number; name: string; nickname: string; level: number; league_id: number }>;
}

interface OrgPlayer {
  player_id: number;
  team_id: number;
  first_name: string;
  last_name: string;
  age: number;
  position: number;
  role: number;
  /** 0 when the save has him on no roster — signed, not yet assigned. */
  rostered: number;
}

/**
 * The organization's players. Who they are is an objective roster fact; what
 * their ratings say comes only from the scouted-evidence adapter
 * (`loadScoutedAbilities`), never from a column read here.
 */
function orgPlayers(orgId: number): OrgPlayer[] {
  return db
    .prepare(
      `SELECT p.player_id, p.team_id, p.first_name, p.last_name, p.age, p.position, p.role,
              /*
               * Whether he is on a roster anywhere.
               *
               * OOTP parks a signing nobody has assigned yet on the parent
               * club's team_id with no roster entry at all, which is how a
               * dozen sixteen-year-olds out of the international complex came
               * to be listed among the major-league pitchers. Every one of the
               * thirty clubs in this save carries a few. A man actually on the
               * club appears in team_roster; these do not.
               */
              EXISTS (SELECT 1 FROM team_roster r WHERE r.player_id = p.player_id) AS rostered
       FROM players p
       WHERE p.organization_id = ? AND p.team_id > 0 AND p.retired = 0`
    )
    .all(orgId) as OrgPlayer[];
}

orgRoutes.get('/depth-chart/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const teams = orgTeams(orgId).map((t) => ({
    ...t,
    label: `${t.name} ${t.nickname}`,
    levelName: LEVEL_NAMES[t.level] ?? `L${t.level}`,
  }));
  const roster = orgPlayers(orgId);
  const abilities = loadScoutedAbilities(roster.map((p) => p.player_id));
  /*
   * A signing nobody has assigned yet sits on the parent club's team_id with
   * no roster entry, so the depth chart had a dozen sixteen-year-olds out of
   * the international complex standing among the major-league pitchers. They
   * belong to the organisation and not to that club, so they get a column of
   * their own rather than being hidden — every one of the thirty clubs in this
   * save has some, and quietly dropping them would lose real prospects.
   */
  const unassigned = roster.some((p) => !p.rostered);
  if (unassigned) {
    teams.push({
      team_id: UNASSIGNED_TEAM,
      name: 'Unassigned',
      nickname: '',
      level: 99,
      league_id: 0,
      label: 'Unassigned',
      levelName: 'ORG',
    });
  }
  const players = roster.map((p) => {
    const { current: cur, potential: pot } = abilities.for(p.player_id);
    return {
      player_id: p.player_id,
      team_id: p.rostered ? p.team_id : UNASSIGNED_TEAM,
      name: `${p.first_name} ${p.last_name}`,
      age: p.age,
      position: p.position,
      role: p.role,
      cur,
      pot,
    };
  });
  res.json({ teams, players });
});

/** Aggregate latest-season stats per player (split 1 = overall). */
/**
 * OOTP keeps a drafted amateur's school season in career stats alongside his
 * professional one, under no league at all (`league_id = 0`, levels 10 and 11
 * for college and high school). Summing every row therefore credits a new
 * draftee with what he did to high schoolers — six WAR and a full season of
 * plate appearances — which sails past the promotion gates the moment he signs
 * and is assigned to an affiliate.
 *
 * Only professional lines count. In this save the two are cleanly separable:
 * every `league_id = 0` row is level 10 or 11, and no real league uses either.
 */
/**
 * One line per level, not one line per man.
 *
 * A reader wrote in about a prospect credited with "a 1.120 OPS and 21 HR in
 * just 181 PAs" at Triple-A, where he was in fact hitting .200 — all 21 home
 * runs were struck at Double-A, and the two seasons had been added together
 * and then labelled with whichever club he happened to be on. A promotion case
 * built on that is a promotion case for somebody who does not exist, and it
 * was compared against the Triple-A average as well, so the mismatch was
 * counted twice in his favour.
 *
 * Keying by level costs nothing and it is what the question means: how is he
 * doing where he is now.
 */
const statKey = (playerId: number, level: number): string => `${playerId}:${level}`;

function seasonBatting(): Map<string, Record<string, number>> {
  const t = 'players_career_batting_stats';
  const out = new Map<string, Record<string, number>>();
  if (!tableExists(t)) return out;
  const year = (db.prepare(`SELECT MAX(year) AS y FROM "${t}"`).get() as { y: number }).y;
  const rows = db
    .prepare(
      `SELECT player_id, level_id, SUM(pa) AS pa, SUM(ab) AS ab, SUM(h) AS h, SUM(d) AS d,
              SUM(t) AS t, SUM(hr) AS hr, SUM(bb) AS bb, SUM(hp) AS hp, SUM(k) AS k,
              SUM(sf) AS sf, SUM(sb) AS sb, SUM(war) AS war
       FROM "${t}" WHERE year = ? AND split_id = 1 AND league_id != 0
       GROUP BY player_id, level_id`
    )
    .all(year) as Array<Record<string, number>>;
  for (const r of rows) out.set(statKey(r.player_id, r.level_id), r);
  return out;
}

/** Professional lines only, per level, for the same reasons as {@link seasonBatting}. */
function seasonPitching(): Map<string, Record<string, number>> {
  const t = 'players_career_pitching_stats';
  const out = new Map<string, Record<string, number>>();
  if (!tableExists(t)) return out;
  const year = (db.prepare(`SELECT MAX(year) AS y FROM "${t}"`).get() as { y: number }).y;
  const rows = db
    .prepare(
      `SELECT player_id, level_id, SUM(outs) AS outs, SUM(er) AS er, SUM(bb) AS bb,
              SUM(k) AS k, SUM(bf) AS bf, SUM(ha) AS ha, SUM(g) AS g, SUM(gs) AS gs,
              SUM(war) AS war
       FROM "${t}" WHERE year = ? AND split_id = 1 AND league_id != 0
       GROUP BY player_id, level_id`
    )
    .all(year) as Array<Record<string, number>>;
  for (const r of rows) out.set(statKey(r.player_id, r.level_id), r);
  return out;
}

const ops = (s: Record<string, number>): number | null => {
  const ab = s.ab ?? 0;
  if (!ab) return null;
  const singles = s.h - s.d - s.t - s.hr;
  const obpDen = ab + s.bb + s.hp + s.sf;
  const obp = obpDen ? (s.h + s.bb + s.hp) / obpDen : 0;
  const slg = (singles + 2 * s.d + 3 * s.t + 4 * s.hr) / ab;
  return obp + slg;
};

/**
 * League-wide per-level baselines (avg age of rostered players; avg OPS / ERA / K%
 * of players with a meaningful sample), computed from THIS save's data so the
 * thresholds self-calibrate to the league environment.
 *
 * A peer has to be on a roster. OOTP parks a signing nobody has assigned yet on the parent club's
 * `team_id` with no `team_roster` entry, so without the membership test the major-league level's
 * average age is built partly out of sixteen-year-olds out of the international complex: on the
 * Arizona import 148 such players (ages 16 to 19, mean 16.2) pulled it from 28.87 to 27.10. That
 * 1.77-year error is 2.66 points of the +/-5 the age context may move the promotion threshold by,
 * and it was printed to the reader as "level avg". Same defect as D-039 in the major-league peer
 * pools, same fix. (docs/MINOR_LEAGUE_OPERATIONS.md F-0-farm.)
 *
 * The rate baselines are level-wide and therefore pool leagues with different run environments.
 * They remain here as display context only: the production evidence a development judgment rests on
 * is league-relative and park-adjusted (`farmResults.ts`, F-1-farm).
 */
export interface RateBaseline {
  avgAge: number | null;
  avgOps: number | null;
  avgEra: number | null;
  avgKpct: number | null;
  /** How many rostered players it was built from. */
  players: number;
  /** Whether it describes one league or a whole level. */
  basis: 'league' | 'level';
}

/** A league baseline needs this many rostered players before it beats the level pool. */
const LEAGUE_BASELINE_MINIMUM = 60;

interface BaselineAccumulator {
  ages: number[];
  ops: number[];
  era: number[];
  kpct: number[];
}

const emptyAccumulator = (): BaselineAccumulator => ({ ages: [], ops: [], era: [], kpct: [] });

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null;

function summarize(a: BaselineAccumulator, basis: 'league' | 'level'): RateBaseline {
  return {
    avgAge: mean(a.ages),
    avgOps: mean(a.ops),
    avgEra: mean(a.era),
    avgKpct: mean(a.kpct),
    players: a.ages.length,
    basis,
  };
}

interface BaselineSet {
  /** Per level, for display and as the fallback. */
  byLevel: Record<number, RateBaseline>;
  /** Per `level:leagueId`, the comparison a judgment actually rests on. */
  byLeague: Record<string, RateBaseline>;
}

function levelBaselines(
  batting: Map<string, Record<string, number>>,
  pitching: Map<string, Record<string, number>>
): BaselineSet {
  const players = db
    .prepare(
      `SELECT p.player_id, p.age, p.position, t.level, t.league_id FROM players p
       JOIN teams t ON t.team_id = p.team_id
       WHERE p.retired = 0 AND t.level >= 1 AND t.allstar_team = 0
         AND EXISTS (SELECT 1 FROM team_roster r WHERE r.player_id = p.player_id)`
    )
    .all() as Array<{ player_id: number; age: number; position: number; level: number; league_id: number }>;

  const byLevelAcc = new Map<number, BaselineAccumulator>();
  const byLeagueAcc = new Map<string, BaselineAccumulator>();

  for (const p of players) {
    const leagueKey = `${p.level}:${p.league_id}`;
    if (!byLevelAcc.has(p.level)) byLevelAcc.set(p.level, emptyAccumulator());
    if (!byLeagueAcc.has(leagueKey)) byLeagueAcc.set(leagueKey, emptyAccumulator());
    const targets = [byLevelAcc.get(p.level)!, byLeagueAcc.get(leagueKey)!];

    for (const a of targets) a.ages.push(p.age);

    // The line he produced AT this level, so the level's own average is not
    // built partly out of what its players did somewhere else
    const b = batting.get(statKey(p.player_id, p.level));
    if (b && (b.pa ?? 0) >= 50) {
      const o = ops(b);
      if (o !== null) for (const a of targets) a.ops.push(o);
    }
    const pi = pitching.get(statKey(p.player_id, p.level));
    if (pi && (pi.outs ?? 0) >= 45) {
      const era = ((pi.er ?? 0) / (pi.outs / 3)) * 9;
      for (const a of targets) {
        a.era.push(era);
        if (pi.bf > 0) a.kpct.push(pi.k / pi.bf);
      }
    }
  }

  const byLevel: Record<number, RateBaseline> = {};
  for (const [level, a] of byLevelAcc) byLevel[level] = summarize(a, 'level');

  const byLeague: Record<string, RateBaseline> = {};
  for (const [key, a] of byLeagueAcc) byLeague[key] = summarize(a, 'league');

  return { byLevel, byLeague };
}

/**
 * The comparison one player's line is measured against: his own league at his own level.
 *
 * A level is not a peer group. Measured on the Arizona import the two Triple-A leagues are 35 OPS
 * points apart, the two Arizona A-ball affiliates play in leagues 43 points apart, and the Dominican
 * Rookie League's rostered average age is 2.5 years below the complex leagues' — so a level-pooled
 * baseline penalises one affiliate and flatters another by roughly a quarter of the model's "strong
 * promotion" band, and makes every Arizona Complex League player read as older than his level when
 * he is average for his league. (docs/MINOR_LEAGUE_OPERATIONS.md F-1-farm.)
 *
 * A league too thin to describe itself falls back to the level pool, and says which it used.
 */
function baselineFor(set: BaselineSet, level: number, leagueId: number): RateBaseline {
  const league = set.byLeague[`${level}:${leagueId}`];
  if (league && league.players >= LEAGUE_BASELINE_MINIMUM) return league;
  return set.byLevel[level] ?? { avgAge: null, avgOps: null, avgEra: null, avgKpct: null, players: 0, basis: 'level' };
}

export function computeProspects(orgId: number): {
  batters: unknown[];
  pitchers: unknown[];
  baselines: unknown;
  leagueBaselines: unknown;
} {
  const batting = seasonBatting();
  const pitching = seasonPitching();
  const baselines = levelBaselines(batting, pitching);

  const teamList = orgTeams(orgId);
  const teams = new Map(teamList.map((t) => [t.team_id, t]));

  const philosophy = resolvePhilosophy(philosophyForOrg(orgId));
  const promotionAggressiveness =
    philosophy.dimensions.promotionAggressiveness.value;

  /*
   * OOTP levels count downward toward MLB. Read the actual affiliate
   * structure from this save rather than assuming a fixed ladder.
   */
  const orgLevels = [...new Set(teamList.map((team) => team.level))]
    .sort((a, b) => a - b);

  const nextAssignmentFor = (
    currentLevel: number
  ): ProspectNextAssignment | null => {
    const nextLevel = orgLevels
      .filter((level) => level < currentLevel)
      .sort((a, b) => b - a)[0];

    if (nextLevel === undefined) return null;

    return {
      level: nextLevel,
      levelName: LEVEL_NAMES[nextLevel] ?? `L${nextLevel}`,
      teams: teamList
        .filter((team) => team.level === nextLevel)
        .map((team) => ({
          teamId: team.team_id,
          label:
            team.name === team.nickname
              ? team.name
              : `${team.name} ${team.nickname}`,
        })),
      isMajorLeague: nextLevel === 1,
    };
  };

  const demotionAssignmentFor = (
    currentLevel: number
  ): ProspectNextAssignment | null => {
    const lowerLevel = orgLevels
      .filter((level) => level > currentLevel)
      .sort((a, b) => a - b)[0];

    if (lowerLevel === undefined) return null;

    return {
      level: lowerLevel,
      levelName: LEVEL_NAMES[lowerLevel] ?? `L${lowerLevel}`,
      teams: teamList
        .filter((team) => team.level === lowerLevel)
        .map((team) => ({
          teamId: team.team_id,
          label:
            team.name === team.nickname
              ? team.name
              : `${team.name} ${team.nickname}`,
        })),
      isMajorLeague: false,
    };
  };

  const promotionAssignmentsFor = (
    currentLevel: number
  ): ProspectNextAssignment[] => {
    return orgLevels
      .filter((level) => level < currentLevel)
      .sort((a, b) => b - a)
      .map((level) => ({
        level,
        levelName:
          LEVEL_NAMES[level] ?? `L${level}`,
        teams: teamList
          .filter((team) => team.level === level)
          .map((team) => ({
            teamId: team.team_id,
            label:
              team.name === team.nickname
                ? team.name
                : `${team.name} ${team.nickname}`,
          })),
        isMajorLeague: level === 1,
      }));
  };

  const demotionAssignmentsFor = (
    currentLevel: number
  ): ProspectNextAssignment[] => {
    return orgLevels
      .filter((level) => level > currentLevel)
      .sort((a, b) => a - b)
      .map((level) => ({
        level,
        levelName:
          LEVEL_NAMES[level] ?? `L${level}`,
        teams: teamList
          .filter((team) => team.level === level)
          .map((team) => ({
            teamId: team.team_id,
            label:
              team.name === team.nickname
                ? team.name
                : `${team.name} ${team.nickname}`,
          })),
        isMajorLeague: false,
      }));
  };

  /*
   * Keep objective decision evidence and assignment selection together in the
   * Prospect API while preserving their separate responsibilities.
   *
   * evaluateProspectDecision:
   *   Should movement be discussed?
   *
   * evaluateProspectAssignments:
   *   Which organizational levels are developmentally defensible?
   */
  const decisionBundle = (
    playerId: number,
    currentLevel: number,
    input: Parameters<
      typeof evaluateProspectDecision
    >[0]
  ) => {
    const decision =
      evaluateProspectDecision(input);

    const rawAssignments =
      evaluateProspectAssignments({
        decision,
        higherAssignments:
          promotionAssignmentsFor(
            currentLevel
          ),
        lowerAssignments:
          demotionAssignmentsFor(
            currentLevel
          ),
      });

    /*
     * Authorization first, with no philosophy in it: which assignments are
     * developmentally defensible is the same for every organization. Only then
     * does philosophy say which of the defensible ones this organization
     * prefers. The preference annotates; it cannot change a judgment.
     */
    const assignments =
      expressAssignmentPreference(
        applyDestinationFitToAssignments(
          playerId,
          rawAssignments
        ),
        promotionAggressiveness
      );

    return {
      decision,
      assignments,
    };
  };

  const batters: unknown[] = [];
  const pitchers: unknown[] = [];

  /*
   * The bottom of the organisation, so nobody is told to send a man below it.
   * Read rather than assumed: an org may have two rookie clubs and no Single-A,
   * or a level this app has never seen, and "demote" only means something if
   * there is somewhere for him to go.
   */
  const lowestLevel = Math.max(...[...teams.values()].map((t) => t.level));

  const players = orgPlayers(orgId);
  const abilities = loadScoutedAbilities(players.map((p) => p.player_id));

  for (const p of players) {
    const team = teams.get(p.team_id);
    if (!team || team.level <= 1) continue; // only minor leaguers
    /*
     * His own league at his own level, not the level pool: see `baselineFor`. The level pool is
     * still returned to the reader as context, and is the fallback for a league too thin to
     * describe itself.
     */
    const base = baselineFor(baselines, team.level, team.league_id);
    if (base.players === 0) continue;
    const ability = abilities.for(p.player_id);
    const { current: cur, potential: pot } = ability;
    const ageDiff = base.avgAge !== null ? base.avgAge - p.age : null;
    const common = {
      player_id: p.player_id,
      team_id: p.team_id,
      name: `${p.first_name} ${p.last_name}`,
      age: p.age,
      team: `${team.name} ${team.nickname}`,
      level: team.level,
      levelName: LEVEL_NAMES[team.level] ?? `L${team.level}`,
      cur,
      pot,
      /** What cur/pot rest on: organization-visible scouted tools, and what is missing. */
      ratingEvidence: summarizeEvidence(ability),
      ageDiff,
    };

    if (p.position === 1) {
      const s = pitching.get(statKey(p.player_id, team.level));
      // ~15 IP minimum, at the level he is actually pitching at. A man who has
      // just moved up has to earn the case again there rather than carry the
      // one he made below.
      if (!s || (s.outs ?? 0) < 45) continue;
      const ip = s.outs / 3;
      const era = ((s.er ?? 0) / ip) * 9;
      const kpct = s.bf > 0 ? s.k / s.bf : 0;
      const eraDiff = base.avgEra !== null ? base.avgEra - era : 0;
      const kDiff = base.avgKpct !== null ? kpct - base.avgKpct : 0;
      const reasons: string[] = [];
      if (eraDiff >= 1.0) reasons.push(`ERA ${era.toFixed(2)} vs level avg ${base.avgEra!.toFixed(2)}`);
      /*
       * The case against him, said out loud. Without this a man carried a
       * DEMOTE badge beside an empty column: the app asserting something and
       * showing nothing for it, which is the one thing every other
       * recommendation in here is careful not to do.
       */
      if (eraDiff <= -1.25) {
        reasons.push(`ERA ${era.toFixed(2)} against a level average of ${base.avgEra!.toFixed(2)}`);
        if (ageDiff !== null && ageDiff < 0) {
          reasons.push(`and ${Math.abs(ageDiff).toFixed(1)} years older than the level`);
        }
      }
      if (kDiff >= 0.05) reasons.push(`K% ${(kpct * 100).toFixed(0)} vs level avg ${(base.avgKpct! * 100).toFixed(0)}`);
      if (ageDiff !== null && ageDiff >= 1.5) reasons.push(`young for level (${p.age} vs avg ${base.avgAge!.toFixed(1)})`);
      if (cur !== null && pot !== null && pot - cur <= 5) reasons.push('near ceiling — development mostly done');
      pitchers.push({
        ...common, role: p.role, ip: Number(ip.toFixed(1)), era: Number(era.toFixed(2)),
        kpct: Number((kpct * 100).toFixed(1)), war: s.war ?? 0,
        reasons,
      ...decisionBundle(p.player_id, team.level, {
        kind: 'pitcher',
        primaryPerformanceDiff: eraDiff,
        secondaryPerformanceDiff: kDiff,
        ip,
        ageDiff,
        ability,
        nextAssignment: nextAssignmentFor(team.level),
        demotionAssignment: demotionAssignmentFor(team.level),
        canDemote: team.level !== lowestLevel,
      }),
      });
    } else {
      const s = batting.get(statKey(p.player_id, team.level));
      if (!s || (s.pa ?? 0) < 60) continue;
      const o = ops(s);
      if (o === null) continue;
      const opsDiff = base.avgOps !== null ? o - base.avgOps : 0;
      const reasons: string[] = [];
      if (opsDiff >= 0.1) reasons.push(`OPS ${o.toFixed(3)} vs level avg ${base.avgOps!.toFixed(3)}`);
      // The case against him, for the same reason as the pitchers above
      if (opsDiff <= -0.1) {
        reasons.push(`OPS ${o.toFixed(3)} against a level average of ${base.avgOps!.toFixed(3)}`);
        if (ageDiff !== null && ageDiff < 0) {
          reasons.push(`and ${Math.abs(ageDiff).toFixed(1)} years older than the level`);
        }
      }
      if (ageDiff !== null && ageDiff >= 1.5) reasons.push(`young for level (${p.age} vs avg ${base.avgAge!.toFixed(1)})`);
      if (cur !== null && pot !== null && pot - cur <= 5) reasons.push('near ceiling — development mostly done');
      if (cur !== null && pot !== null && pot - cur >= 15) reasons.push('high remaining upside');
      batters.push({
        ...common, pa: s.pa, opsVal: Number(o.toFixed(3)), hr: s.hr, sb: s.sb, war: s.war ?? 0,
        reasons,
      ...decisionBundle(p.player_id, team.level, {
        kind: 'batter',
        primaryPerformanceDiff: opsDiff,
        pa: s.pa,
        ageDiff,
        ability,
        nextAssignment: nextAssignmentFor(team.level),
        demotionAssignment: demotionAssignmentFor(team.level),
        canDemote: team.level !== lowestLevel,
      }),
      });
    }
  }

  /*
   * Ordered by name, not by a score.
   *
   * The list used to be sorted by `opsDiff * 300 + ageDiff * 8` and carried a `signal` of
   * promote / demote / watch from a raw statistical rule — `OPS above the level average by .075
   * over 100 plate appearances` was a promotion. That made the payload a promotion leaderboard
   * topped, on the real Arizona import, by three organizational-depth players aged 26, 29 and 26,
   * and it was a SECOND Player Development verdict beside `decision` and `assignments`, disagreeing
   * with them for six of seventy-five players. The Dashboard counted its non-null values and
   * announced "Promotion signals: 42" for an organization whose farm system proposed nothing.
   *
   * Removed (D-044). The statistics themselves are objective facts and stay; the judgment comes
   * from the engine below, and what needs attention comes from Minor League Operations.
   */
  const byName = (a: unknown, b: unknown) =>
    String((a as { name: string }).name).localeCompare(String((b as { name: string }).name));
  batters.sort(byName);
  pitchers.sort(byName);
  return { batters, pitchers, baselines: baselines.byLevel, leagueBaselines: baselines.byLeague };
}

/**
 * Player Development's AAA -> MLB assessment for one minor leaguer, exposed to
 * other domains (MLB Operations) with the full three-state judgment.
 *
 * Absence from the returned map means Player Development has NOT assessed the
 * player: `computeProspects` only evaluates a minor leaguer with enough
 * production at his current level. That is not a pass and not a rejection.
 * `eligible: false` is not a rejection either; read `judgment` (D-018).
 */
export interface MlbDiscussionAssessment {
  playerId: number;
  level: number;
  judgment: DevelopmentalJudgment;
  eligible: boolean;
  reasons: string[];
  blockers: string[];
  missingEvidence: MissingEvidence[];
  evidence: ProspectAssignmentEvaluation['evidence'];
  requirements: ProspectAssignmentEvaluation['requirements'];
}

export function mlbDiscussionAssessments(orgId: number): Map<number, MlbDiscussionAssessment> {
  const prospects = computeProspects(orgId);
  const out = new Map<number, MlbDiscussionAssessment>();
  for (const candidate of [...prospects.batters, ...prospects.pitchers]) {
    const row = candidate as {
      player_id?: unknown;
      level?: unknown;
      assignments?: { evaluations?: ProspectAssignmentEvaluation[] };
    };
    if (typeof row.player_id !== 'number' || typeof row.level !== 'number') continue;
    const evaluation = row.assignments?.evaluations?.find((item) => item.kind === 'mlb_discussion');
    if (!evaluation) continue;
    out.set(row.player_id, {
      playerId: row.player_id,
      level: row.level,
      judgment: evaluation.judgment,
      eligible: evaluation.eligible,
      reasons: evaluation.reasons,
      blockers: evaluation.blockers,
      missingEvidence: evaluation.missingEvidence,
      evidence: evaluation.evidence,
      requirements: evaluation.requirements,
    });
  }
  return out;
}

/**
 * Player Development's answer to "is THIS kind of major-league assignment
 * defensible for him?" (see `mlbAssignmentContext.ts`).
 *
 * A durable role is the existing AAA-to-MLB assessment, unchanged. A temporary
 * context (depth, bench, short bullpen, spot start) is judged by the contextual
 * pathway from his stakes, visible ratings, upper-level experience and any
 * current-level production. Only Triple-A players are assessed. Absence from the
 * map means Player Development has not assessed the player (not a pass, not a
 * rejection); `judgment` may be `indeterminate` and then says what is missing.
 */
export interface MlbAssignmentAssessment {
  playerId: number;
  level: number;
  context: MlbAssignmentContext;
  basis: 'durable_discussion' | 'contextual';
  judgment: DevelopmentalJudgment;
  eligible: boolean;
  reasons: string[];
  blockers: string[];
  missingEvidence: MissingEvidence[];
  /** The contextual detail (stakes, bars, routes, experience); null for a durable role. */
  contextual: ContextAssessment | null;
}

/** Career Triple-A and major-league volume: objective statistics, not a rating. */
function upperLevelExperience(playerIds: number[]): Map<number, UpperLevelExperience> | null {
  if (!tableExists('players_career_batting_stats') || !tableExists('players_career_pitching_stats')) return null;
  const out = new Map<number, UpperLevelExperience>();
  const bump = (id: number, patch: Partial<UpperLevelExperience>) => {
    const cur = out.get(id) ?? { plateAppearances: 0, inningsPitched: 0 };
    out.set(id, { ...cur, ...patch });
  };
  for (let at = 0; at < playerIds.length; at += 500) {
    const chunk = playerIds.slice(at, at + 500);
    const marks = chunk.map(() => '?').join(',');
    for (const r of db.prepare(
      `SELECT player_id, SUM(pa) AS pa FROM players_career_batting_stats
       WHERE split_id = 1 AND level_id IN (1, 2) AND player_id IN (${marks}) GROUP BY player_id`
    ).all(...chunk) as Array<{ player_id: number; pa: number | null }>) bump(r.player_id, { plateAppearances: r.pa ?? 0 });
    for (const r of db.prepare(
      `SELECT player_id, SUM(outs) AS outs FROM players_career_pitching_stats
       WHERE split_id = 1 AND level_id IN (1, 2) AND player_id IN (${marks}) GROUP BY player_id`
    ).all(...chunk) as Array<{ player_id: number; outs: number | null }>) bump(r.player_id, { inningsPitched: (r.outs ?? 0) / 3 });
  }
  for (const id of playerIds) if (!out.has(id)) out.set(id, { plateAppearances: 0, inningsPitched: 0 });
  return out;
}

export function mlbAssignmentAssessments(
  orgId: number,
  context: MlbAssignmentContext,
  playerIds: number[]
): Map<number, MlbAssignmentAssessment> {
  const out = new Map<number, MlbAssignmentAssessment>();
  if (playerIds.length === 0) return out;
  if (context === 'durable_role') {
    for (const [id, a] of mlbDiscussionAssessments(orgId)) {
      if (!playerIds.includes(id)) continue;
      out.set(id, {
        playerId: id, level: a.level, context, basis: 'durable_discussion', judgment: a.judgment, eligible: a.eligible,
        reasons: a.reasons, blockers: a.blockers, missingEvidence: a.missingEvidence, contextual: null,
      });
    }
    return out;
  }

  // Only Triple-A players are assessed (as for the durable gate).
  const levels = new Map(orgTeams(orgId).map((t) => [t.team_id, t.level]));
  const players = orgPlayers(orgId).filter((p) => playerIds.includes(p.player_id) && levels.get(p.team_id) === 2);
  if (players.length === 0) return out;

  const prospects = computeProspects(orgId);
  const decisions = new Map<number, { readiness: number | null; range: { min: number; max: number }; sample: number; threshold: number }>();
  for (const row of [...prospects.batters, ...prospects.pitchers]) {
    const r = row as {
      player_id?: unknown;
      decision?: {
        evidence?: { readiness: number | null; readinessRange: { min: number; max: number }; sampleConfidence: number };
        development?: { promotionThreshold: number };
      };
    };
    if (typeof r.player_id !== 'number' || !r.decision?.evidence || !r.decision.development) continue;
    decisions.set(r.player_id, {
      readiness: r.decision.evidence.readiness, range: r.decision.evidence.readinessRange,
      sample: r.decision.evidence.sampleConfidence, threshold: r.decision.development.promotionThreshold,
    });
  }
  const abilities = loadScoutedAbilities(players.map((p) => p.player_id));
  const experience = upperLevelExperience(players.map((p) => p.player_id));
  /* His stakes here are the stakes every other module reads: the same context, from the same reader. */
  const stakes = openDevelopmentalContext();

  for (const p of players) {
    const d = decisions.get(p.player_id);
    const assessed = evaluateMlbAssignmentContext({
      context,
      kind: p.position === 1 ? 'pitcher' : 'hitter',
      protection: stakes.protect({ age: p.age, teamId: p.team_id, ability: abilities.for(p.player_id) }),
      experience: experience?.get(p.player_id) ?? null,
      currentLevel: d ? { readiness: d.readiness, readinessRange: d.range, sampleConfidence: d.sample, promotionThreshold: d.threshold } : null,
    });
    out.set(p.player_id, {
      playerId: p.player_id, level: 2, context, basis: 'contextual', judgment: assessed.judgment, eligible: assessed.eligible,
      reasons: assessed.reasons, blockers: assessed.blockers, missingEvidence: assessed.missingEvidence, contextual: assessed,
    });
  }
  return out;
}

orgRoutes.get('/prospects/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  res.json(computeProspects(orgId));
});


