import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  applyDestinationFitToAssignments,
  evaluateDestinationFit,
  evaluatePitcherDevelopmentalRole,
  skipLevelDestinationGate,
  type DestinationFit,
} from '../server/destinationFit.js';
import { evaluateProspectDecision, type ProspectNextAssignment } from '../server/prospectDecision.js';
import { evaluateProspectAssignments } from '../server/prospectAssignments.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';

const ability = (current: number | null, potential: number | null) =>
  syntheticScoutedAbility({ current, potential });

/**
 * Destination fit compares a player's visible tools with the active players in
 * the actual destination league, and gates exceptional skip-level moves on it.
 *
 * The populations are synthetic: a large league (30 hitters, contact 30..59),
 * a small one (10 hitters) and an empty one, so population size and low-sample
 * behavior are exactly what each test says they are.
 */

const BIG = { league: 501, team: 511 };
const SMALL = { league: 502, team: 512 };
const EMPTY = { league: 503, team: 513 };
const HOME = 519;

let nextId = 70_000;

function addPlayer(opts: {
  team: number; position: number; role?: number; age?: number;
  contact?: number | null; gap?: number | null; power?: number | null; eye?: number | null; avoidK?: number | null;
  stuff?: number | null; movement?: number | null; control?: number | null; stamina?: number | null;
  pitches?: number[]; rostered?: boolean;
}): number {
  const id = nextId++;
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, team_id, organization_id, retired, hidden)
     VALUES (?, 'Syn', ?, ?, ?, ?, ?, ?, 0, 0)`
  ).run(id, `P${id}`, opts.age ?? 21, opts.position, opts.role ?? 0, opts.team, HOME);
  if (opts.position !== 1) {
    db.prepare(
      `INSERT INTO players_batting (player_id, batting_ratings_overall_contact, batting_ratings_overall_gap,
         batting_ratings_overall_power, batting_ratings_overall_eye, batting_ratings_overall_strikeouts)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, opts.contact ?? null, opts.gap ?? null, opts.power ?? null, opts.eye ?? null, opts.avoidK ?? null);
  } else {
    const pitchColumns = ['fastball', 'slider', 'curveball', 'changeup', 'sinker'];
    const pitches = pitchColumns.map((_, i) => opts.pitches?.[i] ?? 0);
    db.prepare(
      `INSERT INTO players_pitching (player_id, pitching_ratings_overall_stuff, pitching_ratings_overall_movement,
         pitching_ratings_overall_control, pitching_ratings_misc_stamina,
         ${pitchColumns.map((c) => `pitching_ratings_pitches_${c}`).join(', ')})
       VALUES (?, ?, ?, ?, ?, ${pitchColumns.map(() => '?').join(', ')})`
    ).run(id, opts.stuff ?? null, opts.movement ?? null, opts.control ?? null, opts.stamina ?? null, ...pitches);
  }
  if (opts.rostered !== false) db.prepare(`INSERT INTO team_roster VALUES (?, ?, 2)`).run(opts.team, id);
  return id;
}

beforeAll(() => {
  for (const [league, team, name] of [
    [BIG.league, BIG.team, 'Big League'],
    [SMALL.league, SMALL.team, 'Small League'],
    [EMPTY.league, EMPTY.team, 'Empty League'],
    [504, HOME, 'Home League'],
  ] as const) {
    db.prepare(`INSERT INTO leagues (league_id, name, league_level) VALUES (?, ?, 3)`).run(league, name);
    db.prepare(
      `INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, parent_team_id, allstar_team)
       VALUES (?, ?, ?, 'SYN', 3, ?, ?, 0)`
    ).run(team, name, 'Synths', league, HOME);
  }
  // Contact 30..59, everything else flat at 50, so only contact separates the population
  for (let contact = 30; contact < 60; contact++) {
    addPlayer({ team: BIG.team, position: 7, contact, gap: 50, power: 50, eye: 50, avoidK: 50 });
  }
  for (let contact = 30; contact < 40; contact++) {
    addPlayer({ team: SMALL.team, position: 7, contact, gap: 50, power: 50, eye: 50, avoidK: 50 });
  }
  // A fringe of un-rostered and zero-rated people who must not count toward a population
  addPlayer({ team: BIG.team, position: 7, contact: 80, gap: 80, power: 80, eye: 80, avoidK: 80, rostered: false });
  addPlayer({ team: BIG.team, position: 7, contact: 0, gap: 0, power: 0, eye: 0, avoidK: 0 });
});

const hitter = (ratings: Parameters<typeof addPlayer>[0] extends infer T ? Partial<T> : never = {}) =>
  addPlayer({
    team: HOME, position: 7, contact: 45, gap: 50, power: 50, eye: 50, avoidK: 50, ...ratings,
  } as Parameters<typeof addPlayer>[0]);

describe('destination-fit population', () => {
  it('ranks a tool by midrank percentile within the destination league', () => {
    const fit = evaluateDestinationFit(hitter({ contact: 45 }), BIG.team)!;
    const contact = fit.components.find((c) => c.key === 'contact')!;
    // Fifteen values below 45, one tied, out of thirty
    expect(contact.percentile).toBe(51.7);
    expect(contact.playerRating).toBe(45);
  });

  it('counts only rostered active players with a real (positive) rating', () => {
    const fit = evaluateDestinationFit(hitter(), BIG.team)!;
    // The 80s who are not on the active roster and the zero-rated player are excluded
    expect(fit.components.every((c) => c.population === 30)).toBe(true);
    expect(fit.populationMinimum).toBe(30);
    expect(fit.kind).toBe('hitter');
  });

  it('places a player who beats everybody at the top and one below everybody at the bottom', () => {
    const top = evaluateDestinationFit(hitter({ contact: 75 }), BIG.team)!;
    const bottom = evaluateDestinationFit(hitter({ contact: 25 }), BIG.team)!;
    expect(top.components.find((c) => c.key === 'contact')!.percentile).toBe(100);
    expect(bottom.components.find((c) => c.key === 'contact')!.percentile).toBe(0);
    expect(top.compositePercentile).toBeGreaterThan(bottom.compositePercentile);
  });

  it('keeps the weakest core tool from being hidden by an elite one', () => {
    const lopsided = evaluateDestinationFit(hitter({ contact: 75, eye: 20 }), BIG.team)!;
    expect(lopsided.weakestCorePercentile).toBe(0);
    expect(lopsided.classification).toBe('poor');
  });
});

describe('destination-fit low-sample and missing behavior', () => {
  it('reports the smallest population behind any component', () => {
    const fit = evaluateDestinationFit(hitter(), SMALL.team)!;
    expect(fit.populationMinimum).toBe(10);
  });

  it('reports no components and a population of zero for an empty destination', () => {
    const fit = evaluateDestinationFit(hitter(), EMPTY.team)!;
    expect(fit.components).toEqual([]);
    expect(fit.populationMinimum).toBe(0);
    expect(fit.compositePercentile).toBe(0);
    expect(fit.classification).toBe('poor');
  });

  it('leaves a missing tool out and says so, instead of scoring it as zero', () => {
    const fit = evaluateDestinationFit(hitter({ eye: null }), BIG.team)!;
    expect(fit.components.map((c) => c.key)).not.toContain('eye');
    expect(fit.components).toHaveLength(4);
    expect(fit.unassessedComponents).toEqual([{ label: 'Eye', core: true, reason: 'no_visible_rating' }]);
    expect(fit.notes.join(' ')).toMatch(/Not evaluated: Eye \(no organization-visible rating\)/);
    // Not dragged down by a phantom zero: the rest of the composite is re-weighted
    const complete = evaluateDestinationFit(hitter({ eye: 50 }), BIG.team)!;
    expect(fit.compositePercentile).toBeGreaterThan(0);
    expect(Math.abs(fit.compositePercentile - complete.compositePercentile)).toBeLessThan(15);
  });

  it('keeps a skip-level move from being authorized on an unevaluated core tool', () => {
    const fit = evaluateDestinationFit(hitter({ contact: 59, eye: null, avoidK: 59 }), BIG.team)!;
    const gate = skipLevelDestinationGate(fit, 1);
    expect(gate.passes).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/not evaluated for lack of organization-visible evidence: Eye/);
  });

  it('treats a zero rating as unknown too, since no scale grades anyone zero', () => {
    const fit = evaluateDestinationFit(hitter({ eye: 0 }), BIG.team)!;
    expect(fit.unassessedComponents.map((u) => u.label)).toEqual(['Eye']);
  });

  it('has nothing to say about a player or destination that does not exist', () => {
    expect(evaluateDestinationFit(1, 9_999_999)).toBeNull();
    expect(evaluateDestinationFit(9_999_999, BIG.team)).toBeNull();
  });
});

describe('the skip-level destination gate', () => {
  const fit = (composite: number, weakest: number, population = 30): DestinationFit => ({
    playerId: 1, destinationTeamId: 2, destinationTeam: 'X', leagueId: 3, leagueName: 'L', leagueLevel: 3,
    kind: 'hitter', roleAssessment: null, components: [], unassessedComponents: [], compositePercentile: composite,
    weakestCorePercentile: weakest, classification: 'viable', populationMinimum: population, notes: [],
  });

  it('asks more of the player for every level skipped', () => {
    const g = (levels: number) => skipLevelDestinationGate(fit(50, 25), levels);
    expect([g(1), g(2), g(3)].map((x) => [x.requiredCompositePercentile, x.requiredWeakestCorePercentile]))
      .toEqual([[30, 10], [45, 20], [60, 30]]);
    expect(g(1).passes).toBe(true);
    expect(g(2).passes).toBe(true);
    expect(g(3).passes).toBe(false);
  });

  it('rejects a comparison built on fewer than 25 comparable players', () => {
    const gate = skipLevelDestinationGate(fit(90, 90, 24), 1);
    expect(gate.passes).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/only 24; at least 25/);
    expect(skipLevelDestinationGate(fit(90, 90, 25), 1).passes).toBe(true);
  });

  it('rejects a catastrophic core weakness behind a good composite', () => {
    const gate = skipLevelDestinationGate(fit(80, 5), 1);
    expect(gate.passes).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/Weakest core-skill percentile/);
  });
});

describe('destination fit applied to an assignment plan', () => {
  const team = (t: { team: number }, level: number, name: string): ProspectNextAssignment => ({
    level, levelName: name, teams: [{ teamId: t.team, label: name }], isMajorLeague: false,
  });
  const lower = team({ team: HOME }, 4, 'A');

  const planFor = (playerId: number, destinationTeams: Array<{ team: number }>) => {
    const decision = evaluateProspectDecision({
      kind: 'batter', primaryPerformanceDiff: 0.2, pa: 250, ageDiff: 0, ability: ability(50, 50),
      promotionAggressiveness: 50,
      nextAssignment: team(destinationTeams[0], 3, 'AA'),
      demotionAssignment: lower, canDemote: true,
    });
    const higher = destinationTeams.map((t, i) => team(t, 3 - i, `L${3 - i}`));
    return applyDestinationFitToAssignments(
      playerId,
      evaluateProspectAssignments({ decision, higherAssignments: higher, lowerAssignments: [lower] })
    );
  };

  it('keeps a well-supported skip-level move and tells Operations which affiliates remain', () => {
    const plan = planFor(hitter({ contact: 55, eye: 55, avoidK: 55 }), [{ team: SMALL.team }, { team: BIG.team }]);
    const skip = plan.evaluations.find((e) => e.kind === 'skip_level_promotion')!;
    expect(skip.eligible).toBe(true);
    expect(skip.destinationFit!.eligibleTeamIds).toEqual([BIG.team]);
    expect(skip.reasons.join(' ')).toMatch(/empirical destination-level range/);
  });

  it('rejects a skip-level move when the destination has too small a population', () => {
    const plan = planFor(hitter({ contact: 55, eye: 55, avoidK: 55 }), [{ team: HOME }, { team: SMALL.team }]);
    const skip = plan.evaluations.find((e) => e.kind === 'skip_level_promotion')!;
    expect(skip.eligible).toBe(false);
    expect(skip.recommendation).toBe('not_recommended');
    expect(skip.blockers.join(' ')).toMatch(/comparison sample is only 10/);
    expect(plan.eligible.every((e) => e.kind !== 'skip_level_promotion')).toBe(true);
  });

  it('rejects rather than guesses when no destination population exists at all', () => {
    const plan = planFor(hitter({ contact: 55, eye: 55, avoidK: 55 }), [{ team: HOME }, { team: EMPTY.team }]);
    const skip = plan.evaluations.find((e) => e.kind === 'skip_level_promotion')!;
    expect(skip.eligible).toBe(false);
  });

  it('never gates an ordinary promotion on destination fit', () => {
    const plan = planFor(hitter({ contact: 25, eye: 25, avoidK: 25 }), [{ team: BIG.team }]);
    const normal = plan.evaluations.find((e) => e.kind === 'normal_promotion')!;
    expect(normal.eligible).toBe(true);
    expect(normal.destinationFit!.eligibleTeamIds).toEqual([BIG.team]);
  });
});

describe('pitcher developmental role', () => {
  it('keeps starting in play for a reliever with the stamina and repertoire for it', () => {
    const id = addPlayer({
      team: HOME, position: 1, role: 12, stuff: 50, movement: 50, control: 50, stamina: 45,
      pitches: [60, 55, 50, 0, 0],
    });
    const role = evaluatePitcherDevelopmentalRole(id)!;
    expect(role.currentRole).toBe('reliever');
    expect(role.developmentalRole).toBe('starter');
    expect(role.establishedPitches).toBe(3);
  });

  it('evaluates a low-stamina, two-pitch reliever in relief', () => {
    const id = addPlayer({
      team: HOME, position: 1, role: 12, stuff: 50, movement: 50, control: 50, stamina: 30,
      pitches: [60, 55, 0, 0, 0],
    });
    expect(evaluatePitcherDevelopmentalRole(id)!.developmentalRole).toBe('reliever');
  });

  it('has no role assessment for a hitter', () => {
    expect(evaluatePitcherDevelopmentalRole(hitter())).toBeNull();
  });
});
