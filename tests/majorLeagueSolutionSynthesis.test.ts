import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../server/config.js';
import { db } from '../server/db.js';
import type { MajorLeagueOrganizationalConsequences } from '../server/majorLeagueOrganizationalConsequences.js';
import type { MajorLeagueNeed, MajorLeagueNeedRole } from '../server/majorLeagueOperations.js';
import type { InternalResponder } from '../server/majorLeagueResponders.js';
import {
  classifyMajorLeagueSolutionCompleteness,
  synthesizeMajorLeagueSolutions,
  synthesizeMajorLeagueSolutionsForResponders,
  type MajorLeagueFarmVariant,
} from '../server/majorLeagueSolutionSynthesis.js';
import type { TransactionSolution } from '../server/majorLeagueTransactionPlan.js';
import { DEFAULT_PHILOSOPHY_VALUES, normalizePhilosophyProfile, type PhilosophyValues } from '../server/philosophy.js';
import { organizationRosterTransactionState } from '../server/rosterTransactionState.js';
import { IDS, SEASON } from './fixture.js';

const START = 930_000;
const AA_ONE = 930_100;
const AA_TWO = 930_101;
const SETTINGS = path.join(DATA_DIR, 'settings.json');
const shortstop: MajorLeagueNeedRole = { kind: 'position', position: 6, label: 'shortstop', provenance: 'observed' };
const catcher: MajorLeagueNeedRole = { kind: 'position', position: 2, label: 'catcher', provenance: 'observed' };

let settingsBefore: string | null = null;

function need(overrides: Partial<MajorLeagueNeed> = {}): MajorLeagueNeed {
  return {
    id: 'phase-5-open-need', organizationId: IDS.mlbTeam, mlbTeamId: IDS.mlbTeam,
    category: 'role_coverage', role: shortstop, causalPlayer: { playerId: 999, name: 'Unavailable Player' },
    cause: { kind: 'injury', provenance: 'corroborated' }, detectedAt: '2030-06-01T00:00:00.000Z',
    status: 'open', lifecycle: 'continuing', horizon: { kind: 'temporary', expectedDays: 14, evidence: [] },
    evidence: [], unknowns: [], ...overrides,
  };
}

function setPhilosophy(values: Partial<PhilosophyValues>): void {
  const existing = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) as Record<string, unknown> : {};
  fs.writeFileSync(SETTINGS, JSON.stringify({
    ...existing,
    organizationPhilosophies: {
      ...((existing.organizationPhilosophies as Record<string, unknown> | undefined) ?? {}),
      [String(IDS.mlbTeam)]: normalizePhilosophyProfile({ manual: { ...DEFAULT_PHILOSOPHY_VALUES, ...values } }),
    },
  }, null, 2));
}

function addTeam(id: number, level = 3): void {
  db.prepare(`INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team, human_team)
    VALUES (?, 'Phase', ?, 'P5', ?, ?, 0, 0, ?, 0, 0)`).run(id, String(id), level, IDS.league, IDS.mlbTeam);
}

function addPlayer(id: number, options: {
  teamId?: number; level?: number; position?: number; role?: number; active?: boolean; fortyMan?: boolean;
  offense?: number; defense?: number; extraPositions?: number[]; prospect?: 'strong' | 'weak'; ratings?: boolean; il?: boolean;
} = {}): void {
  const level = options.level ?? (options.active ? 1 : 2);
  const teamId = options.teamId ?? (level === 1 ? IDS.mlbTeam : IDS.aaaTeam);
  const position = options.position ?? 6;
  const role = options.role ?? 0;
  db.prepare(`INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
    VALUES (?, 'Solution', ?, 25, ?, ?, 1, 1, 0, ?, ?, 0, 0, 0, 0)`).run(id, String(id), position, role, teamId, IDS.mlbTeam);
  db.prepare(`INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary, mlb_service_years, mlb_service_days, mlb_service_days_this_year)
    VALUES (?, ?, ?, 0, ?, 0, 0, 0)`).run(id, options.active ? 1 : 0, options.il ? 1 : 0, options.fortyMan ? 1 : 0);
  db.prepare('INSERT INTO team_roster (team_id, player_id, list_id) VALUES (?, ?, 2)').run(teamId, id);
  if (options.ratings !== false && position !== 1) {
    const positions = [...new Set([position, ...(options.extraPositions ?? [])])];
    const row: Record<string, number> = { player_id: id, position };
    for (const ratedPosition of positions) {
      row[`fielding_rating_pos${ratedPosition}`] = ratedPosition === position ? (options.defense ?? 50) : Math.max(35, (options.defense ?? 50) - 5);
      row[`fielding_experience${ratedPosition - 1}`] = 100;
    }
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO players_fielding (${keys.join(', ')}) VALUES (${keys.map((key) => `@${key}`).join(', ')})`).run(row);
    const offense = options.offense ?? 50;
    db.prepare('INSERT INTO players_batting VALUES (?, ?, ?, ?, ?, ?, 50, ?, ?, ?, ?, ?)')
      .run(id, offense, offense, offense, offense, offense, offense + 5, offense + 5, offense + 5, offense + 5, offense + 5);
  } else if (options.ratings !== false && position === 1) {
    const value = options.offense ?? 55;
    db.prepare(`INSERT INTO players_pitching (player_id, pitching_ratings_overall_stuff, pitching_ratings_overall_movement,
      pitching_ratings_overall_control, pitching_ratings_talent_stuff, pitching_ratings_talent_movement,
      pitching_ratings_talent_control, pitching_ratings_misc_stamina, pitching_ratings_pitches_fastball,
      pitching_ratings_pitches_changeup, pitching_ratings_pitches_curveball)
      VALUES (?, ?, ?, ?, ?, ?, ?, 60, 60, 55, 50)`).run(id, value, value, value, value + 5, value + 5, value + 5);
  }
  if (options.prospect) {
    const strong = options.prospect === 'strong';
    db.prepare('INSERT INTO players_value VALUES (?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)').run(id, strong ? 70 : 30, strong ? 70 : 30, strong ? 70 : 30, strong ? 70 : 30);
    if (position !== 1) {
      db.prepare(`INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa, ab, h, d, t, hr, bb, ibb, hp, sf, k, sb, cs, r, rbi, war)
        VALUES (?, ?, ?, ?, ?, 1, 250, 210, ?, 10, 0, ?, 25, 0, 0, 0, 35, 0, 0, 50, 50, ?)`)
        .run(id, SEASON, teamId, IDS.league, level, strong ? 105 : 30, strong ? 25 : 1, strong ? 4 : -1);
    }
  }
}

function development(status: 'approved' | 'not_applicable'): InternalResponder['development'] {
  return status === 'not_applicable'
    ? { status, gate: null, message: 'Veteran/depth gate is not applicable.' }
    : {
        status, message: 'Player Development supports MLB discussion.',
        gate: { playerId: -1, eligible: true, reasons: ['Developmentally defensible.'], blockers: [], evidence: { readiness: 85, performance: 90, ratingsMaturity: 75, sampleConfidence: 80 }, requirements: { readiness: 70, performance: null, ratingsMaturity: null, sampleConfidence: 45 } },
      };
}

function responder(id: number, role: MajorLeagueNeedRole, source: InternalResponder['source'], options: { fit?: 'direct' | 'secondary'; development?: 'approved' | 'not_applicable'; fortyMan?: boolean } = {}): InternalResponder {
  return {
    playerId: id, name: `Solution ${id}`, source,
    assignment: { teamId: source === 'active_mlb' ? IDS.mlbTeam : IDS.aaaTeam, level: source === 'active_mlb' ? 1 : 2 },
    roleFit: { fit: options.fit ?? 'direct', role, evidence: [{ kind: options.fit === 'secondary' ? 'visible_fielding_rating' : role.kind === 'position' ? 'listed_position' : 'pitching_role', message: 'Established role fit.', ...(options.fit === 'secondary' ? { rating: 50 } : {}) }] },
    availability: { status: 'available', evidence: ['Available.'] },
    development: source === 'minor_league_call_up' ? development(options.development ?? 'not_applicable') : null,
    transactionContext: { fortyMan: options.fortyMan ?? null, majorLeagueContract: source === 'active_mlb', note: 'Baseball discussion only; transaction feasibility is deferred.' },
  };
}

function installLimits(activeOpen: number, fortyOpen: number): void {
  const state = organizationRosterTransactionState(IDS.mlbTeam);
  db.exec('ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER');
  db.exec('ALTER TABLE leagues ADD COLUMN rules_secondary_roster_limit INTEGER');
  db.prepare('UPDATE leagues SET rules_active_roster_limit = ?, rules_secondary_roster_limit = ? WHERE league_id = ?')
    .run((state.capacity.active.count ?? 0) + activeOpen, (state.capacity.fortyMan.count ?? 0) + fortyOpen, IDS.league);
}

function synthesize(selectedNeed: MajorLeagueNeed, responders: InternalResponder[]) {
  return synthesizeMajorLeagueSolutionsForResponders(selectedNeed, responders);
}

beforeEach(() => {
  settingsBefore = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
  setPhilosophy({});
});

afterEach(() => {
  for (const table of ['players_career_batting_stats', 'players_career_pitching_stats', 'players_batting', 'players_pitching', 'players_fielding', 'team_roster', 'players_roster_status', 'players_value', 'players']) {
    db.prepare(`DELETE FROM ${table} WHERE player_id >= ?`).run(START);
  }
  db.prepare('DELETE FROM teams WHERE team_id IN (?, ?)').run(AA_ONE, AA_TWO);
  const columns = (db.prepare('PRAGMA table_info(leagues)').all() as Array<{ name: string }>).map((column) => column.name);
  if (columns.includes('rules_secondary_roster_limit')) db.exec('ALTER TABLE leagues DROP COLUMN rules_secondary_roster_limit');
  if (columns.includes('rules_active_roster_limit')) db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
  if (settingsBefore === null) {
    if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  } else fs.writeFileSync(SETTINGS, settingsBefore);
});

describe('complete MLB solution variants', () => {
  it('creates one coherent no-farm variant for one active MLB responder', () => {
    addPlayer(START, { active: true, fortyMan: true });
    const result = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({ responder: { playerId: START }, farm: { kind: 'not_applicable' }, completeness: 'fully_actionable' });
  });

  it('creates a stable no-move farm variant when source coverage remains healthy', () => {
    addPlayer(START, { fortyMan: true });
    addPlayer(START + 1);
    addPlayer(START + 2);
    installLimits(1, 1);
    const result = synthesize(need(), [responder(START, shortstop, 'minor_league_call_up', { fortyMan: true })]);
    expect(result.variants).toEqual([expect.objectContaining({ farm: expect.objectContaining({ kind: 'stable_no_move' }), completeness: 'fully_actionable' })]);
  });

  it('expands two materially distinct complete cascades into two variants for one responder', () => {
    addTeam(AA_ONE); addTeam(AA_TWO);
    addPlayer(START, { position: 2, fortyMan: true });
    addPlayer(START + 1, { position: 2 });
    for (const [teamId, offset] of [[AA_ONE, 10], [AA_TWO, 20]] as const) {
      addPlayer(START + offset, { teamId, level: 3, position: 2, prospect: 'strong' });
      addPlayer(START + offset + 1, { teamId, level: 3, position: 2 });
      addPlayer(START + offset + 2, { teamId, level: 3, position: 2 });
      addPlayer(START + offset + 3, { teamId, level: 3, position: 3, prospect: 'weak' });
    }
    installLimits(1, 5);
    const selectedNeed = need({ role: catcher });
    const result = synthesize(selectedNeed, [responder(START, catcher, 'minor_league_call_up', { fortyMan: true, development: 'not_applicable' })]);
    expect(result.variants).toHaveLength(2);
    expect(new Set(result.variants.map((variant) => variant.farm.kind === 'cascade_plan' ? variant.farm.plan.moves[0].from.teamId : 0))).toEqual(new Set([AA_ONE, AA_TWO]));
  });

  it('never attaches a cascade or consequence to another responder identity', () => {
    addPlayer(START, { fortyMan: true }); addPlayer(START + 1); addPlayer(START + 2);
    addPlayer(START + 3, { fortyMan: true });
    installLimits(2, 2);
    const result = synthesize(need(), [
      responder(START, shortstop, 'minor_league_call_up', { fortyMan: true }),
      responder(START + 3, shortstop, 'minor_league_call_up', { fortyMan: true }),
    ]);
    expect(result.variants.every((variant) => variant.responder.playerId === variant.transaction.responder.playerId && variant.responder.playerId === variant.consequences.responder.playerId)).toBe(true);
  });

  it('uses stable causal variant IDs and declares stable ordering non-preferential', () => {
    addPlayer(START, { active: true, fortyMan: true });
    const variant = synthesize(need(), [responder(START, shortstop, 'active_mlb')]).variants[0];
    expect(variant.id).toContain(`${need().id}:responder:${START}:farm:not_applicable`);
    expect(variant.preference.ordering).toBe('stable_variant_id_non_preferential_within_equal_tier');
  });

  it('gives every retained cascade alternative a unique stable variant identity', () => {
    addPlayer(START, { active: true, fortyMan: true });
    addPlayer(START + 1, { active: true, fortyMan: true });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), [responder(START, shortstop, 'active_mlb'), responder(START + 1, shortstop, 'active_mlb')]);
    expect(new Set(result.variants.map((variant) => variant.id)).size).toBe(result.variants.length);
  });
});

describe('completeness before preference', () => {
  const transaction = (feasibility: TransactionSolution['feasibility'], decisions = 0, unknowns = 0) => ({
    feasibility, correspondingDecisions: Array.from({ length: decisions }, () => ({ kind: 'active_roster_space', status: 'required', description: 'Choose outgoing player.', selectedPlayerId: null })),
    unknowns: Array.from({ length: unknowns }, () => ({ code: 'unknown', message: 'Unknown.' })),
  }) as unknown as TransactionSolution;
  const consequences = (decisions = 0) => ({ unresolvedMlbDecisions: Array.from({ length: decisions }, () => ({})) }) as unknown as MajorLeagueOrganizationalConsequences;
  const farm = (status: MajorLeagueFarmVariant['status'], cascadeStatus: MajorLeagueFarmVariant['cascadeStatus'] = 'complete') => ({ kind: 'cascade_unresolved', status, cascadeStatus, plan: null, delegatedPreference: null, unknowns: [] }) as MajorLeagueFarmVariant;

  it('classifies fully actionable solutions separately', () => {
    expect(classifyMajorLeagueSolutionCompleteness(transaction('feasible'), consequences(), farm('partial', 'complete'))).toBe('partial_organizational_solution');
    expect(classifyMajorLeagueSolutionCompleteness(transaction('feasible'), consequences(), { kind: 'stable_no_move', status: 'complete', cascadeStatus: 'complete', plan: null, delegatedPreference: null, unknowns: [] })).toBe('fully_actionable');
  });

  it('preserves unresolved GM roster decisions', () => {
    expect(classifyMajorLeagueSolutionCompleteness(transaction('feasible_with_corresponding_decisions', 1), consequences(1), { kind: 'stable_no_move', status: 'complete', cascadeStatus: 'complete', plan: null, delegatedPreference: null, unknowns: [] })).toBe('feasible_requires_gm_decision');
  });

  it('keeps partial farm solutions partial', () => {
    expect(classifyMajorLeagueSolutionCompleteness(transaction('feasible'), consequences(), farm('partial'))).toBe('partial_organizational_solution');
  });

  it('keeps indeterminate transactions indeterminate', () => {
    expect(classifyMajorLeagueSolutionCompleteness(transaction('indeterminate', 0, 1), consequences(), farm('partial'))).toBe('indeterminate');
  });

  it('keeps search truncation distinct from a negative judgment', () => {
    expect(classifyMajorLeagueSolutionCompleteness(transaction('feasible'), consequences(), farm('truncated', 'truncated'))).toBe('search_truncated');
  });

  it('keeps deterministic ineligibility outside normal comparison', () => {
    expect(classifyMajorLeagueSolutionCompleteness(transaction('ineligible'), consequences(), farm('partial'))).toBe('ineligible');
  });
});

describe('Player Development and transaction authority', () => {
  it('keeps a development-prohibited AAA player out of Phase 5 variants', () => {
    addPlayer(START, { prospect: 'weak' });
    const result = synthesizeMajorLeagueSolutions(need());
    expect(result.variants.some((variant) => variant.responder.playerId === START)).toBe(false);
    expect(result.excludedResponders).toEqual(expect.arrayContaining([expect.objectContaining({ playerId: START, reason: 'developmentally_prohibited' })]));
  });

  it('does not let aggressive philosophy revive a Player Development veto', () => {
    addPlayer(START, { prospect: 'weak' });
    setPhilosophy({ promotionAggressiveness: 100, upsidePreference: 100 });
    const result = synthesizeMajorLeagueSolutions(need());
    expect(result.variants.some((variant) => variant.responder.playerId === START)).toBe(false);
  });

  it('preserves not-applicable veteran depth separately from prospect approval', () => {
    addPlayer(START, { fortyMan: true }); addPlayer(START + 1); addPlayer(START + 2);
    installLimits(1, 1);
    const result = synthesizeMajorLeagueSolutions(need());
    expect(result.variants.find((variant) => variant.responder.playerId === START)?.development).toMatchObject({ status: 'not_applicable', gate: null });
  });

  it('preserves already-on-40-man versus requires-addition facts', () => {
    addPlayer(START, { fortyMan: true }); addPlayer(START + 1); addPlayer(START + 2);
    addPlayer(START + 3, { fortyMan: false });
    installLimits(2, 2);
    const result = synthesize(need(), [responder(START, shortstop, 'minor_league_call_up', { fortyMan: true }), responder(START + 3, shortstop, 'minor_league_call_up', { fortyMan: false })]);
    const on = result.variants.find((variant) => variant.responder.playerId === START)!;
    const off = result.variants.find((variant) => variant.responder.playerId === START + 3)!;
    expect(on.transaction.structuralFacts.requiresFortyManAddition).toBe(false);
    expect(off.transaction.structuralFacts.requiresFortyManAddition).toBe(true);
    expect(on.preference.axes.transaction_readiness).toBeGreaterThan(off.preference.axes.transaction_readiness ?? -1);
  });

  it('keeps full active and 40-man choices explicit and player-unselected', () => {
    addPlayer(START, { fortyMan: false }); addPlayer(START + 1); addPlayer(START + 2);
    installLimits(0, 0);
    const variant = synthesize(need(), [responder(START, shortstop, 'minor_league_call_up', { fortyMan: false })]).variants[0];
    expect(variant.completeness).toBe('feasible_requires_gm_decision');
    expect(variant.unresolvedDecisions.map((decision) => decision.kind)).toEqual(expect.arrayContaining(['active_roster_space', 'forty_man_space']));
    expect(variant.unresolvedDecisions.every((decision) => decision.selectedPlayerId === null)).toBe(true);
  });

  it('labels an otherwise attractive unresolved roster path as conditional', () => {
    addPlayer(START, { fortyMan: false }); addPlayer(START + 1); addPlayer(START + 2); installLimits(0, 0);
    const variant = synthesize(need(), [responder(START, shortstop, 'minor_league_call_up', { fortyMan: false })]).variants[0];
    expect(['preferred_conditional', 'conditional_alternative']).toContain(variant.preference.tier);
    expect(variant.completeness).toBe('feasible_requires_gm_decision');
  });

  it('does not let philosophy make an ineligible transaction feasible', () => {
    addPlayer(START, { il: true, fortyMan: true });
    installLimits(1, 1);
    setPhilosophy({ promotionAggressiveness: 100, upsidePreference: 100, competitiveWindow: 100 });
    const variant = synthesize(need(), [responder(START, shortstop, 'minor_league_call_up', { fortyMan: true, development: 'approved' })]).variants[0];
    expect(variant.completeness).toBe('ineligible');
    expect(variant.preference.tier).toBe('excluded');
  });

  it('does not present transaction-indeterminate solutions as fully known', () => {
    addPlayer(START, { fortyMan: true });
    const variant = synthesize(need(), [responder(START, shortstop, 'minor_league_call_up', { fortyMan: true })]).variants[0];
    expect(variant.completeness).toBe('indeterminate');
    expect(variant.preference.tier).toBe('cannot_responsibly_compare');
  });
});

describe('need horizon and shared Organizational Philosophy', () => {
  function temporaryPair() {
    addPlayer(START, { active: true, fortyMan: true, position: 2 });
    addPlayer(START + 1, { fortyMan: false, position: 2, prospect: 'strong' });
    addPlayer(START + 2, { position: 2 }); addPlayer(START + 3, { position: 2 });
    installLimits(2, 2);
    return [responder(START, catcher, 'active_mlb'), responder(START + 1, catcher, 'minor_league_call_up', { fortyMan: false, development: 'approved' })];
  }

  it('prefers the lower-disruption internal path for a short need under continuity/certainty philosophy', () => {
    const responders = temporaryPair();
    setPhilosophy({ rosterDepth: 80, riskTolerance: 25, promotionAggressiveness: 30 });
    const result = synthesize(need({ role: catcher }), responders);
    expect(result.variants.find((variant) => variant.responder.playerId === START)?.preference.tier).toBe('preferred');
    expect(result.variants.find((variant) => variant.responder.playerId === START + 1)?.philosophyInterpretations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'temporary_need_disruption_alignment', sentiment: 'tradeoff' })]));
  });

  it('makes the approved prospect more competitive when only the need becomes structural', () => {
    const responders = temporaryPair();
    setPhilosophy({ promotionAggressiveness: 80, upsidePreference: 80, competitiveWindow: 35 });
    const result = synthesize(need({ role: catcher, horizon: { kind: 'structural' }, cause: { kind: 'trade', provenance: 'corroborated' } }), responders);
    const prospect = result.variants.find((variant) => variant.responder.playerId === START + 1)!;
    expect(prospect.preference.tier).toBe('preferred');
    expect(prospect.philosophyInterpretations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'structural_need_development_alignment' })]));
  });

  it('does not hard-code temporary equals veteran when both paths are equally low disruption', () => {
    addPlayer(START, { active: true, fortyMan: true, position: 2 });
    addPlayer(START + 1, { fortyMan: true, position: 2, prospect: 'strong' });
    addPlayer(START + 2, { position: 2 }); addPlayer(START + 3, { position: 2 });
    installLimits(2, 2);
    setPhilosophy({ riskTolerance: 50, rosterDepth: 50, promotionAggressiveness: 80 });
    const result = synthesize(need({ role: catcher }), [responder(START, catcher, 'active_mlb'), responder(START + 1, catcher, 'minor_league_call_up', { fortyMan: true, development: 'approved' })]);
    expect(result.variants.filter((variant) => variant.preference.tier === 'preferred')).toHaveLength(2);
  });

  it('uses the actual persisted organization profile and exposes exact effective dimensions', () => {
    addPlayer(START, { active: true, fortyMan: true });
    setPhilosophy({ defenseEmphasis: 91, versatility: 72, rosterDepth: 63 });
    const result = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    expect(result.philosophy.dimensions).toMatchObject({ defenseEmphasis: { value: 91 }, versatility: { value: 72 }, rosterDepth: { value: 63 } });
  });

  it('keeps an unknown horizon neutral rather than manufacturing temporary or structural meaning', () => {
    addPlayer(START, { active: true, fortyMan: true }); setPhilosophy({ rosterDepth: 100, promotionAggressiveness: 100 });
    const variant = synthesize(need({ horizon: { kind: 'unknown' } }), [responder(START, shortstop, 'active_mlb')]).variants[0];
    expect(variant.preference.axes.need_horizon).toBe(0);
    expect(variant.philosophyInterpretations.some((item) => item.axis === 'need_horizon')).toBe(false);
  });
});

describe('structured MLB role-style preference', () => {
  function activePair() {
    addPlayer(START, { active: true, fortyMan: true, defense: 70, offense: 40 });
    addPlayer(START + 1, { active: true, fortyMan: true, defense: 50, offense: 70 });
    return [responder(START, shortstop, 'active_mlb'), responder(START + 1, shortstop, 'active_mlb')];
  }

  it('lets defense emphasis prefer stronger visible defense between adequate shortstops', () => {
    const responders = activePair(); setPhilosophy({ defenseEmphasis: 90 });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), responders);
    expect(result.variants.find((variant) => variant.responder.playerId === START)?.preference.axes.role_style).toBe(1);
    expect(result.variants.find((variant) => variant.responder.playerId === START + 1)?.preference.axes.role_style).toBe(-1);
  });

  it('lets bat-first philosophy prefer stronger visible offense between adequate shortstops', () => {
    const responders = activePair(); setPhilosophy({ defenseEmphasis: 10 });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), responders);
    expect(result.variants.find((variant) => variant.responder.playerId === START + 1)?.preference.axes.role_style).toBe(1);
  });

  it('permits a neutral philosophy tie', () => {
    const responders = activePair(); setPhilosophy({ defenseEmphasis: 50, versatility: 50 });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), responders);
    expect(result.variants.every((variant) => variant.preference.tier === 'preferred')).toBe(true);
    expect(result.variants[0].preference.tiedWithVariantIds).toContain(result.variants[1].id);
  });

  it('uses actual secondary-position evidence for versatility preference', () => {
    addPlayer(START, { active: true, fortyMan: true, extraPositions: [4, 5, 7] });
    addPlayer(START + 1, { active: true, fortyMan: true });
    setPhilosophy({ versatility: 90 });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), [responder(START, shortstop, 'active_mlb'), responder(START + 1, shortstop, 'active_mlb')]);
    expect(result.variants.find((variant) => variant.responder.playerId === START)?.preference.axes.versatility).toBe(1);
  });

  it('returns cannot-responsibly-compare when critical role-style evidence is missing', () => {
    addPlayer(START, { active: true, fortyMan: true, ratings: false });
    const variant = synthesize(need({ horizon: { kind: 'unknown' } }), [responder(START, shortstop, 'active_mlb')]).variants[0];
    expect(variant.roleSuitability.comparisonEvidence).toBe('insufficient');
    expect(variant.preference.tier).toBe('cannot_responsibly_compare');
  });

  it('does not let player style bypass the responder role-fit gate', () => {
    addPlayer(START, { position: 7, offense: 80, defense: 80 });
    const result = synthesizeMajorLeagueSolutions(need());
    expect(result.variants.some((variant) => variant.responder.playerId === START)).toBe(false);
    expect(result.excludedResponders).toEqual(expect.arrayContaining([expect.objectContaining({ playerId: START, reason: 'role_fit_not_established' })]));
  });

  it('keeps pitcher role/style evidence visible without an MLB-only style weight', () => {
    const pitcherRole: MajorLeagueNeedRole = { kind: 'starting_pitcher', position: 1, label: 'starting pitcher', provenance: 'observed' };
    addPlayer(START, { active: true, fortyMan: true, position: 1, role: 11, offense: 65 });
    const variant = synthesize(need({ role: pitcherRole, horizon: { kind: 'unknown' } }), [responder(START, pitcherRole, 'active_mlb')]).variants[0];
    expect(variant.roleSuitability.pitcher).toMatchObject({ role: 'starter', stamina: 60, repertoire: expect.any(Array) });
    expect(variant.philosophyInterpretations.some((item) => item.code.includes('pitcher_style'))).toBe(false);
  });
});

describe('farm ownership, internal alternatives, provenance, and determinism', () => {
  it('preserves Minor League Operations plan preference without rescoring its assignments', () => {
    addTeam(AA_ONE); addTeam(AA_TWO);
    addPlayer(START, { position: 2, fortyMan: true }); addPlayer(START + 1, { position: 2 });
    for (const [teamId, offset] of [[AA_ONE, 10], [AA_TWO, 20]] as const) {
      addPlayer(START + offset, { teamId, level: 3, position: 2, prospect: 'strong' });
      addPlayer(START + offset + 1, { teamId, level: 3, position: 2 }); addPlayer(START + offset + 2, { teamId, level: 3, position: 2 });
      addPlayer(START + offset + 3, { teamId, level: 3, position: 3, prospect: 'weak' });
    }
    installLimits(1, 5);
    const result = synthesize(need({ role: catcher }), [responder(START, catcher, 'minor_league_call_up', { fortyMan: true })]);
    expect(result.philosophy.farmPreferenceOwnership).toBe('minor_league_operations_consumed_without_rescoring');
    expect(result.variants.every((variant) => variant.farm.kind !== 'cascade_plan' || variant.facts.some((fact) => fact.provenance === 'delegated_minor_league_philosophy'))).toBe(true);
  });

  it('treats an altered secondary MLB role as a real consequence', () => {
    addPlayer(START, { active: true, fortyMan: true, position: 7, extraPositions: [6] });
    addPlayer(START + 1, { active: true, fortyMan: true, position: 6 });
    setPhilosophy({ rosterDepth: 90 });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), [responder(START, shortstop, 'active_mlb', { fit: 'secondary' }), responder(START + 1, shortstop, 'active_mlb')]);
    expect(result.variants.find((variant) => variant.responder.playerId === START)?.consequences.mlbRoleConsequence.status).toBe('role_altered');
    expect(result.variants.find((variant) => variant.responder.playerId === START)?.preference.axes.mlb_role_continuity).toBe(-1);
  });

  it('does not make no-transaction status an automatic winner', () => {
    addPlayer(START, { active: true, fortyMan: true, defense: 45, offense: 45 });
    addPlayer(START + 1, { fortyMan: true, defense: 70, offense: 70 }); addPlayer(START + 2); addPlayer(START + 3);
    installLimits(1, 1); setPhilosophy({ defenseEmphasis: 90 });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), [responder(START, shortstop, 'active_mlb'), responder(START + 1, shortstop, 'minor_league_call_up', { fortyMan: true })]);
    expect(result.variants.find((variant) => variant.responder.playerId === START + 1)?.preference.tier).toBe('preferred');
  });

  it('separates facts from philosophy interpretations and keeps need horizon inspectable', () => {
    addPlayer(START, { active: true, fortyMan: true }); setPhilosophy({ rosterDepth: 80 });
    const variant = synthesize(need(), [responder(START, shortstop, 'active_mlb')]).variants[0];
    expect(variant.need.horizon).toEqual(need().horizon);
    expect(variant.facts.every((item) => item.provenance === 'fact' || item.provenance === 'delegated_minor_league_philosophy')).toBe(true);
    expect(variant.philosophyInterpretations.every((item) => item.provenance === 'major_league_philosophy_interpretation')).toBe(true);
  });

  it('keeps development, transaction, farm, philosophy, and unknown evidence inspectable', () => {
    addPlayer(START, { fortyMan: false }); addPlayer(START + 1); addPlayer(START + 2); installLimits(0, 0);
    const variant = synthesize(need(), [responder(START, shortstop, 'minor_league_call_up', { development: 'approved', fortyMan: false })]).variants[0];
    expect(variant.development).toMatchObject({ status: 'approved' });
    expect(variant.transaction).toBeDefined(); expect(variant.farm).toBeDefined();
    expect(variant.unresolvedDecisions.length).toBeGreaterThan(0);
    expect(variant.philosophyInterpretations).toBeDefined(); expect(variant.unknowns).toBeDefined();
  });

  it('is deterministic across responder input order', () => {
    addPlayer(START, { active: true, fortyMan: true }); addPlayer(START + 1, { active: true, fortyMan: true });
    const selectedNeed = need({ horizon: { kind: 'unknown' } });
    const one = synthesize(selectedNeed, [responder(START + 1, shortstop, 'active_mlb'), responder(START, shortstop, 'active_mlb')]);
    const two = synthesize(selectedNeed, [responder(START, shortstop, 'active_mlb'), responder(START + 1, shortstop, 'active_mlb')]);
    expect(one.variants.map((variant) => ({ id: variant.id, tier: variant.preference.tier, axes: variant.preference.axes }))).toEqual(two.variants.map((variant) => ({ id: variant.id, tier: variant.preference.tier, axes: variant.preference.axes })));
  });

  it('returns identical tiering for identical data and persisted philosophy', () => {
    addPlayer(START, { active: true, fortyMan: true });
    const first = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    const second = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    expect(second.variants.map((variant) => variant.preference)).toEqual(first.variants.map((variant) => variant.preference));
  });

  it('returns stable ties without pretending stable ID order is baseball preference', () => {
    addPlayer(START, { active: true, fortyMan: true }); addPlayer(START + 1, { active: true, fortyMan: true });
    const result = synthesize(need({ horizon: { kind: 'unknown' } }), [responder(START + 1, shortstop, 'active_mlb'), responder(START, shortstop, 'active_mlb')]);
    expect(result.variants.map((variant) => variant.id)).toEqual([...result.variants.map((variant) => variant.id)].sort());
    expect(result.semantics.stableOrderingIsBaseballPreference).toBe(false);
  });

  it('uses no opaque master score and leaves the final decision to the GM', () => {
    addPlayer(START, { active: true, fortyMan: true });
    const result = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    expect(result.semantics).toMatchObject({ scoring: 'no_master_score_structured_non_dominance', finalDecision: 'gm' });
    expect(result.variants[0]).not.toHaveProperty('score');
  });

  it('does not consult prohibited continuous players_value fields or require AI', () => {
    addPlayer(START, { active: true, fortyMan: true });
    db.prepare('INSERT INTO players_value VALUES (?, 999999, 999999, 999999, 999999, 999999, 999999, 20, 20, 20, 20)').run(START);
    const result = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    expect(result.scoutingValuePolicy).toBe('prohibited_pending_provenance');
    expect(result.variants[0].roleSuitability.scoutingValuePolicy).toBe('prohibited_pending_provenance');
  });

  it('does not change variants or preference when prohibited continuous values change', () => {
    addPlayer(START, { active: true, fortyMan: true });
    db.prepare('INSERT INTO players_value VALUES (?, 1, 2, 3, 4, 5, 6, 50, 50, 50, 50)').run(START);
    const before = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    db.prepare('UPDATE players_value SET overall_value = 999999, talent_value = 999999, offensive_value = 999999, pitching_value = 999999 WHERE player_id = ?').run(START);
    const after = synthesize(need(), [responder(START, shortstop, 'active_mlb')]);
    expect(after.variants.map((variant) => ({ role: variant.roleSuitability, tier: variant.preference.tier, axes: variant.preference.axes }))).toEqual(before.variants.map((variant) => ({ role: variant.roleSuitability, tier: variant.preference.tier, axes: variant.preference.axes })));
  });
});
