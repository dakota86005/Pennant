import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { FARM_RULES, FARM_TOOL_RULES, NO_ADVICE, NULL_MEANS_UNKNOWN, VALUE_FIGURES_NOTE, WRITER_GUARDRAILS } from '../server/aiGuardrails.js';
import { briefingContext, briefingSystem } from '../server/ai.js';
import { TOOLS, systemPrompt, toolPayload } from '../server/chat.js';
import { promotionDirectionOf, prospectsForAi } from '../server/farmOperations.js';
import { personasFor } from '../server/staff.js';
import request from './request.js';
import type { AssignmentReview } from '../server/farmAssignments.js';
import { assembleContext, storylinesSystem } from '../server/storylines.js';
import { teamFinances } from '../server/valuation.js';
import { IDS, SEASON } from './fixture.js';

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

  it('the Staff room\'s prospects carry the review\'s conclusion per man, not Player Development\'s codes, and null where it has not judged him', () => {
    const decision = { recommendation: 'strong_promotion_case', possibleRecommendations: ['consider_promotion', 'mlb_ready_discussion'] };
    const assignments = [{ level: 2, judgment: 'defensible' }];
    const out = prospectsForAi({
      batters: [
        { player_id: 1, name: 'A Prospect', pa: 300, decision, assignments },
        { player_id: 2, name: 'B Prospect', pa: 250, decision, assignments },
        { player_id: 3, name: 'C Prospect', pa: 90, decision, assignments },
      ],
      pitchers: [],
      baselines: {},
    }, [review({ playerId: 1 }), review({ playerId: 2, conclusion: 'current_assignment_defensible' })]);
    expect(out.batters).toEqual([
      { player_id: 1, name: 'A Prospect', pa: 300, farmReview: { review: 'Beyond AA; a more demanding assignment is defensible.', defensibleAt: ['AAA'] } },
      { player_id: 2, name: 'B Prospect', pa: 250, farmReview: { review: 'AA is a defensible assignment.', defensibleAt: [] } },
      { player_id: 3, name: 'C Prospect', pa: 90, farmReview: null },
    ]);
    expect(JSON.stringify(out)).not.toMatch(LEGACY_CODES);
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

describe('the Staff room reads the farm as the writers do (B-63, review M1)', () => {
  /*
   * A minor leaguer with a real line at AAA this season, so Player Development's engine has something to judge and the
   * prospects list is not empty: the legacy codes are there to leak, and the Staff room must not be handed them.
   */
  const seeded = db.prepare(
    `INSERT INTO players_career_batting_stats VALUES (?, ?, ?, ?, 2, 1, 240, 210, 75, 15, 2, 12, 25, 1, 2, 2, 40, 6, 2, 35, 40, 2.1)`
  );
  beforeAll(async () => {
    seeded.run(IDS.minorDeal, SEASON, IDS.aaaTeam, IDS.league);
    await request('/api/status'); // the tools answer through the app's own API
  }, 30_000);
  afterAll(() => {
    db.prepare('DELETE FROM players_career_batting_stats WHERE player_id = ? AND year = ? AND level_id = 2').run(IDS.minorDeal, SEASON);
  });

  it('the prospects route still carries Player Development\'s codes, so the seed reaches the engine', async () => {
    const raw = (await request(`/api/prospects/${IDS.mlbTeam}`)) as { batters: Array<{ player_id: number }> };
    expect(raw.batters.map((b) => b.player_id)).toContain(IDS.minorDeal);
    expect(JSON.stringify(raw)).toMatch(LEGACY_CODES);
  });

  it('the prospects tool hands over his line and the farm review\'s conclusion, and no legacy code', async () => {
    const out = (await toolPayload('get_prospects', { team_id: IDS.mlbTeam })) as { batters: Array<Record<string, unknown>> };
    const him = out.batters.find((b) => b.player_id === IDS.minorDeal)!;
    expect(him).toBeDefined();
    expect(him.pa).toBe(240);
    expect(him).not.toHaveProperty('decision');
    expect(him).not.toHaveProperty('assignments');
    expect(him).toHaveProperty('farmReview');
    if (him.farmReview !== null) expect(Object.keys(him.farmReview as object).sort()).toEqual(['defensibleAt', 'review']);
    expect(JSON.stringify(out)).not.toMatch(LEGACY_CODES);
    expect(JSON.stringify(out)).not.toMatch(/possibleRecommendations|mlb_ready|consider_demotion/);
    // Still listed by name, as the tool says
    const names = out.batters.map((b) => String(b.name));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('every voice in the Staff room is given the farm rules and told a null is not known', () => {
    for (const persona of personasFor(IDS.mlbTeam)) {
      const system = systemPrompt(IDS.mlbTeam, persona);
      expect(system, persona.id).toContain(FARM_TOOL_RULES);
      expect(system, persona.id).toContain(NULL_MEANS_UNKNOWN);
      expect(system, persona.id).not.toMatch(LEGACY_CODES);
    }
  });

  it('the Staff room\'s farm rules hold the writers\' no-verdict lines word for word, and name only its own field', () => {
    const noVerdict = FARM_RULES.slice(FARM_RULES.indexOf('Never say a player'));
    expect(noVerdict).toMatch(/^Never say a player has earned/);
    expect(FARM_TOOL_RULES.endsWith(noVerdict)).toBe(true);
    expect(FARM_TOOL_RULES).toMatch(/'farmReview'/);
    expect(FARM_TOOL_RULES).not.toMatch(/farm\.attention|farm\.promotionDirection/);
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
