import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { FARM_RULES, NO_ADVICE, NULL_MEANS_UNKNOWN, VALUE_FIGURES_NOTE, WRITER_GUARDRAILS } from '../server/aiGuardrails.js';
import { briefingContext, briefingSystem } from '../server/ai.js';
import { TOOLS } from '../server/chat.js';
import { promotionDirectionOf } from '../server/farmOperations.js';
import type { AssignmentReview } from '../server/farmAssignments.js';
import { assembleContext, storylinesSystem } from '../server/storylines.js';
import { teamFinances } from '../server/valuation.js';
import { IDS } from './fixture.js';

/*
 * B-63 (SRVAI-07, SRVAI-09, SRVFARM-23, SRVSTATS-22): the AI writers share one set of guardrails, are handed the farm
 * review's conclusions rather than legacy recommendation codes, are told the truth about how a list is ordered, and are
 * never handed an unknown as zero (D-001, D-003, D-018, D-044). BEHAVIOR_CASES.md "The AI never quotes odds" and
 * "AI writers explain, never decide".
 */

/** The legacy Player Development recommendation codes (prospectDecision.ts) no writer is handed. */
const LEGACY_CODES = /consider_promotion|strong_promotion_case|mlb_ready_discussion|"recommendation"/;

describe('the storylines and the briefing write under the same guardrails', () => {
  const briefing = briefingSystem('the Club', 'MLB rules.');
  const storylines = storylinesSystem('the Club', 'MLB rules.');

  it('both carry every shared rule: the farm\'s, null means not known, no advice, and the value figures', () => {
    for (const system of [briefing, storylines]) {
      expect(system).toContain(WRITER_GUARDRAILS);
      for (const rule of [FARM_RULES, NULL_MEANS_UNKNOWN, NO_ADVICE, VALUE_FIGURES_NOTE]) expect(system).toContain(rule);
    }
  });

  it('the storylines no longer ask who is earning a promotion, or for any promotion verdict', () => {
    expect(storylines).not.toMatch(/earning a promotion|who deserves|should be promoted/i);
    expect(storylines).toMatch(/never a promotion verdict/);
  });

  it('neither writer names a legacy recommendation code', () => {
    for (const system of [briefing, storylines]) expect(system).not.toMatch(LEGACY_CODES);
  });
});

describe('the farm the writers are handed is the farm review\'s conclusions (SRVFARM-23)', () => {
  const review = (over: Partial<AssignmentReview>): AssignmentReview => ({
    playerId: 1, name: 'A Prospect', age: 22, kind: 'hitter', teamId: 10, team: 'Affiliate', level: 3, levelName: 'AA', leagueName: 'L',
    conclusion: 'promotion_direction_defensible', attention: 'worth_a_look', reasons: [], ownership: [], missing: [], wouldResolve: [], gmDecision: [],
    alternatives: [
      { kind: 'normal_promotion', direction: 'promotion', level: 2, levelName: 'AAA', teams: [], judgment: 'defensible', preference: null, blockers: [], missingEvidence: [], destinationOpportunity: null },
      { kind: 'skip_level_promotion', direction: 'promotion', level: 1, levelName: 'MLB', teams: [], judgment: 'indefensible', preference: null, blockers: [], missingEvidence: [], destinationOpportunity: null },
    ],
    ...over,
  } as AssignmentReview);

  it('lists only the review\'s promotion-direction conclusions, with what it found and the defensible levels', () => {
    const listed = promotionDirectionOf([
      review({ name: 'B Prospect' }),
      review({ name: 'A Prospect', conclusion: 'current_assignment_defensible' }),
      review({ name: 'C Prospect', conclusion: 'organizational_question' }),
    ]);
    expect(listed).toEqual([
      { name: 'B Prospect', age: 22, level: 'AA', team: 'Affiliate', review: 'Beyond AA; a more demanding assignment is defensible.', defensibleAt: ['AAA'] },
    ]);
    expect(JSON.stringify(listed)).not.toMatch(LEGACY_CODES);
  });

  it('an unknown age is null, never 0', () => {
    for (const age of [null, 0, Number.NaN] as unknown as number[]) {
      expect(promotionDirectionOf([review({ age })])[0].age).toBeNull();
    }
  });

  it('the briefing\'s and the storylines\' farm carries no legacy recommendation code', () => {
    for (const context of [briefingContext(IDS.mlbTeam), assembleContext(IDS.mlbTeam)]) {
      expect(JSON.stringify(context.farm)).not.toMatch(LEGACY_CODES);
      for (const p of context.farm.promotionDirection) expect(Object.keys(p).sort()).toEqual(['age', 'defensibleAt', 'level', 'name', 'review', 'team']);
    }
  });
});

describe('the prospects tool is described as it is ordered (SRVAI-09)', () => {
  it('says the list is by name and not a ranking, and offers no promotion signal', () => {
    const tool = TOOLS.find((t) => t.name === 'get_prospects')!;
    expect(tool.description).toMatch(/Listed by name/);
    expect(tool.description).toMatch(/not a ranking/);
    expect(tool.description).not.toMatch(/ranked by|promotion signal|reasoning behind each ranking/i);
  });
});

describe('an unknown budget, market or fan interest is null to the writers, never 0 (SRVSTATS-22)', () => {
  it('a blank figure in the export is null', () => {
    const before = db.prepare('SELECT * FROM team_financials WHERE team_id = ?').get(IDS.mlbTeam) as Record<string, unknown>;
    try {
      db.prepare('UPDATE team_financials SET budget = NULL, market = NULL, fan_interest = NULL WHERE team_id = ?').run(IDS.mlbTeam);
      const f = teamFinances(IDS.mlbTeam)!;
      expect(f.budget).toBeNull();
      expect(f.market).toBeNull();
      expect(f.fanInterest).toBeNull();
      expect(f.payroll).toBe(before.player_payroll);
    } finally {
      db.prepare('UPDATE team_financials SET budget = ?, market = ?, fan_interest = ? WHERE team_id = ?')
        .run(before.budget, before.market, before.fan_interest, IDS.mlbTeam);
    }
  });

  it('a club with no row has no finances, and the dead cash field is never read as the club\'s money', () => {
    expect(teamFinances(987_654)).toBeNull();
    const f = teamFinances(IDS.mlbTeam)!;
    const row = db.prepare('SELECT cash_trades_available AS c FROM team_financials WHERE team_id = ?').get(IDS.mlbTeam) as { c: unknown };
    expect(f.cash).toBe(typeof row.c === 'number' ? row.c : null);
  });
});
