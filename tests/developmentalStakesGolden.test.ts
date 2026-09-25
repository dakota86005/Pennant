import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateDevelopmentProtection,
  TIER_ORDER,
  type DevelopmentalContext,
  type DevelopmentProtectionTier,
} from '../server/developmentFit.js';
import { startingLines } from '../server/developmentFit.js';
const STARTING = startingLines('not_measured');
import { evaluateMlbAssignmentContext, STAKES_WEIGHT, type ContextInput } from '../server/mlbAssignmentContext.js';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { positionConflict } from '../server/playingTime.js';
import { reviewRetention, type RetentionInput } from '../server/farmRetention.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { currentInput, tierOf, usage } from './farmGolden.js';

/**
 * Developmental stakes: the golden cases (docs/DEVELOPMENTAL_STAKES.md, D-050).
 *
 * The tier answers one question — how high are the developmental stakes if the organization
 * mishandles this player? — from his organization-visible ceiling (the absolute anchor) and how much
 * of the development that would realize it is still ahead of him (the context). Each case states one
 * baseball invariant. None names a player, and none says who ranks first: this is not a prospect list.
 */

/** A league whose rostered average age is `averageAge`, thick enough to describe itself. */
const at = (levelName: string, level: number, averageAge: number, age: number, leagueName = `${levelName} League`): DevelopmentalContext => ({
  level,
  levelName,
  leagueName,
  ageRelativeToLevel: averageAge - age,
  ageProfile: { scope: 'league', players: 300, averageAge },
});

/* The rostered average ages measured on the real import, so the cases sit where real players do. */
const DSL = (age: number) => at('R', 6, 18.3, age, 'Dominican Rookie League');
const COMPLEX = (age: number) => at('R', 6, 20.7, age, 'Arizona Complex League');
const LOW_A = (age: number) => at('A', 4, 21.6, age, 'Carolina League');
const HIGH_A = (age: number) => at('A', 4, 22.8, age, 'Northwest League');
const AA = (age: number) => at('AA', 3, 24.7, age, 'Texas League');
const AAA = (age: number) => at('AAA', 2, 26.0, age, 'Pacific Coast League');

const stakes = (
  age: number,
  current: number | null,
  potential: number | null,
  context: DevelopmentalContext | null = null,
  kind: 'hitter' | 'pitcher' = 'hitter'
) => evaluateDevelopmentProtection({ lines: STARTING,  age, ability: syntheticScoutedAbility({ current, potential, kind }), context });

const rank = (tier: DevelopmentProtectionTier | null): number => (tier === null ? -1 : TIER_ORDER.indexOf(tier));
const why = (p: { reasons: string[] }): string => p.reasons.join(' ');

describe('youth is not talent', () => {
  it('1. an 18-year-old in the Dominican league with ordinary tools is not core, protected or a priority merely for being young', () => {
    const p = stakes(18, 25, 39, DSL(18));
    expect(p.tier).toBe('normal');
    expect(p.reading!.remaining.state).toBe('most');
    expect(why(p)).toMatch(/No major-league projection is visible/);
    /* ...however wide the gap to a ceiling nobody sees as a major leaguer's. */
    expect(stakes(17, 20, 44, DSL(17)).tier).toBe('normal');
    expect(stakes(16, 20, 41, DSL(16)).tier).toBe('normal');
  });

  it('2. an 18-year-old in the Dominican league with strong visible upside gets meaningful protection', () => {
    expect(stakes(18, 28, 52, DSL(18)).tier).toBe('protected_prospect');
    expect(stakes(18, 30, 57, DSL(18)).tier).toBe('core_prospect');
    expect(rank(stakes(18, 28, 47, DSL(18)).tier)).toBeGreaterThanOrEqual(rank('development_priority'));
  });
});

describe('the same ratings mean different things in different developmental contexts', () => {
  it('3. a 20-year-old at an advanced level is read on his ceiling and his age, and his level is said', () => {
    const p = stakes(20, 44, 51, AAA(20));
    expect(p.tier).toBe('protected_prospect');
    expect(p.reading!.remaining.schedule).toBe('young_for_level');
    expect(why(p)).toMatch(/Young for his level: 6\.0 years under the rostered average of Pacific Coast League/);
  });

  it('4. a 24-year-old repeating a level with modest tools gets no prospect inflation', () => {
    expect(stakes(24, 38, 46, HIGH_A(24)).tier).toBe('normal');
    expect(stakes(24, 38, 44, HIGH_A(24)).tier).toBe('organizational_depth');
    /* The absolute composite called the first of them a development priority's neighbour; a wide gap does not reopen his window. */
    expect(stakes(24, 30, 47, LOW_A(24)).tier).toBe('normal');
  });

  it('says he is behind his level\'s schedule only when that is what shortened the reading', () => {
    /* A 29-year-old is "old for Triple-A" too, and his age has already said everything that says. */
    const veteran = stakes(29, 47, 47, AAA(29));
    expect(veteran.reading!.remaining).toMatchObject({ schedule: 'far_behind', boundBy: ['age'] });
    expect(why(veteran)).not.toMatch(/rostered average/);
    expect(why(stakes(21, 30, 47, DSL(21)))).toMatch(/behind his level's schedule/);
  });

  it('5. a 27-year-old Triple-A depth player with decent current ability and no upside left is not a prospect of any kind', () => {
    const p = stakes(27, 50, 50, AAA(27));
    expect(p.tier).toBe('organizational_depth');
    expect(why(p)).toMatch(/his developmental years are behind him/);
    expect(why(p)).toMatch(/nearly all realized/);
    /* It says his development is not what is at stake, not that he is no use: his ceiling is still named. */
    expect(why(p)).toMatch(/Visible ceiling of a major-league regular/);
  });

  it('6. an older player with genuine visible upside is not organizational depth because of his age alone', () => {
    for (const age of [25, 26]) {
      const p = stakes(age, 42, 52, AAA(age));
      expect(p.tier).not.toBe('organizational_depth');
      expect(rank(p.tier)).toBeGreaterThanOrEqual(rank('normal'));
    }
    /* A top ceiling still in view at 25 is still a priority; the same man with nothing left to project is not. */
    expect(stakes(25, 44, 57, AAA(25)).tier).toBe('development_priority');
    expect(stakes(25, 52, 52, AAA(25)).tier).toBe('organizational_depth');
  });

  it('7. the same visible ratings at 18 and at 27 are read differently, and the ceiling is read the same', () => {
    const young = stakes(18, 40, 50, LOW_A(18));
    const old = stakes(27, 40, 50, AAA(27));
    expect(young.reading!.ceiling).toEqual(old.reading!.ceiling);
    expect(young.tier).toBe('protected_prospect');
    expect(old.tier).toBe('organizational_depth');
    expect(rank(young.tier) - rank(old.tier)).toBeGreaterThanOrEqual(2);
  });

  it('the same profile in the Dominican league and at Triple-A is not automatically the same thing', () => {
    /* 21, 30 / 47: on schedule in full-season ball, 2.7 years behind the Dominican league's. */
    expect(stakes(21, 30, 47, LOW_A(21)).tier).toBe('development_priority');
    const behind = stakes(21, 30, 47, DSL(21));
    expect(behind.tier).toBe('normal');
    expect(behind.reading!.remaining).toMatchObject({ schedule: 'behind', byAge: 'most', state: 'some', boundBy: ['age', 'schedule'] });
    expect(why(behind)).toMatch(/2\.7 years older than the rostered average of Dominican Rookie League/);
  });
});

describe('a peer group is context, never the anchor', () => {
  it('8. moving between affiliates does not change his tier merely because the men around him change', () => {
    /* Two Dominican clubs, two Single-A leagues, a promotion and a demotion: the same 19-year-old. */
    const tiers = [DSL(19), COMPLEX(19), LOW_A(19), HIGH_A(19), AA(19), AAA(19)].map((c) => stakes(19, 36, 52, c).tier);
    expect(new Set(tiers)).toEqual(new Set(['protected_prospect']));
  });

  it('9. a weak peer cohort cannot manufacture a core prospect', () => {
    /* However old and however weak his league, a fringe ceiling is a fringe ceiling. */
    const weakLeague: DevelopmentalContext = { ...DSL(17), ageRelativeToLevel: 8, ageProfile: { scope: 'league', players: 400, averageAge: 25 } };
    const p = stakes(17, 30, 47, weakLeague);
    expect(p.tier).toBe('development_priority');
    expect(p.tier).toBe(stakes(17, 30, 47, DSL(17)).tier);
    expect(p.reading!.ceiling.band).toBe('fringe');
  });

  it('10. a strong peer cohort cannot erase genuinely strong absolute evidence', () => {
    /* A league of teenagers makes him "old for it"; it does not make a 58 ceiling anything less. */
    const prodigies: DevelopmentalContext = { ...LOW_A(19), ageRelativeToLevel: -1.4, ageProfile: { scope: 'league', players: 400, averageAge: 17.6 } };
    const p = stakes(19, 40, 58, prodigies);
    expect(p.tier).toBe('core_prospect');
    expect(p.reading!.ceiling.band).toBe('impact');
  });
});

describe('unknown stays unknown', () => {
  it('11. a missing potential leaves the stakes unknown, never a lower tier', () => {
    const p = stakes(19, 40, null, LOW_A(19));
    expect(p.tier).toBeNull();
    expect(p.reading).toBeNull();
    expect(p.missingEvidence.map((m) => m.dimension)).toEqual(['potential_ability']);
    expect(why(p)).toMatch(/indeterminate/);
  });

  it('a missing current rating leaves them unknown too, and what is known is still said', () => {
    const p = stakes(19, null, 58, LOW_A(19));
    expect(p.tier).toBeNull();
    expect(why(p)).toMatch(/Visible ceiling of an impact major leaguer/);
  });

  it('an unknown age leaves them unknown', () => {
    const p = stakes(Number.NaN, 40, 55, null);
    expect(p.tier).toBeNull();
    expect(why(p)).toMatch(/his age is not known/);
  });

  it('a missing level context, or a league too thin to have an age profile, is said and discounts nothing', () => {
    const none = stakes(21, 30, 47, null);
    expect(none.tier).toBe('development_priority');
    expect(none.reading!.remaining.schedule).toBe('not_established');
    expect(why(none)).toMatch(/No level context was supplied/);

    const thin: DevelopmentalContext = { ...DSL(21), ageRelativeToLevel: null, ageProfile: { scope: 'unavailable', players: 6, averageAge: null } };
    const p = stakes(21, 30, 47, thin);
    expect(p.tier).toBe('development_priority');
    expect(p.reading!.remaining.schedule).toBe('not_established');
    expect(why(p)).toMatch(/could not be established/);
    /* Missing context may never lower a man's stakes. */
    expect(rank(p.tier)).toBeGreaterThanOrEqual(rank(stakes(21, 30, 47, DSL(21)).tier));
  });

  it('a league described by its level pool says so', () => {
    const pooled: DevelopmentalContext = { ...COMPLEX(24), ageProfile: { scope: 'level', players: 900, averageAge: 20.7 } };
    expect(why(stakes(24, 33, 47, pooled))).toMatch(/too thin to describe itself/);
  });
});

describe('what the tier is not', () => {
  it('12. philosophy does not alter the tier: the evaluator has nowhere to put one', () => {
    const source = fs
      .readFileSync(path.join(process.cwd(), 'server', 'developmentFit.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).not.toMatch(/from '\.\/(philosophy|settings|assignmentPreference|staffPreference)\.js'/);
    expect(source).not.toMatch(/prospectPreservation|promotionAggressiveness|competitiveWindow|upsidePreference|dimensions\./);
    /* ...and its whole input is ability, age, the ceiling lines in force, context and the manual control. */
    const input = { age: 20, ability: syntheticScoutedAbility({ current: 38, potential: 52 }), lines: STARTING, context: LOW_A(20) };
    const smuggled = { ...input, philosophy: { prospectPreservation: 100 }, promotionAggressiveness: 0 };
    expect(evaluateDevelopmentProtection(smuggled)).toEqual(evaluateDevelopmentProtection(input));
  });

  it('13 and 14. no line of production is an input, so a hot month cannot raise a tier and a cold one cannot lower it', () => {
    const source = fs
      .readFileSync(path.join(process.cwd(), 'server', 'developmentFit.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).not.toMatch(/from '\.\/(farmResults|resultsMetrics|resultsEvidence|farmUsage|farmRecentUsage|playingTime|prospectDecision)\.js'/);
    expect(source).not.toMatch(/\b(ops|woba|era|fip|percentile|plateAppearances|inningsPitched|readiness)\b/i);

    /* Organizational depth dominating his league is still organizational depth; a core prospect slumping is still core. */
    const depth = stakes(28, 44, 44, AA(28));
    const core = stakes(19, 40, 58, AA(19));
    const dominating = evaluateCurrentAssignment(currentInput({ leaguePercentile: 99, reliability: 0.6, ageRelativeToLevel: -3.3, tier: depth.tier }));
    const slumping = evaluateCurrentAssignment(currentInput({ leaguePercentile: 2, reliability: 0.6, ageRelativeToLevel: 5.7, tier: core.tier }));
    expect(dominating.standing).toBe('mastered');
    expect(slumping.standing).toBe('overmatched');
    /* The level reading moves with the line; the stakes it is shown beside do not. */
    expect(dominating.parts.find((x) => x.label === 'Developmental stakes')!.value).toBe('organizational_depth');
    expect(slumping.parts.find((x) => x.label === 'Developmental stakes')!.value).toBe('core_prospect');
  });

  it('a core prospect can be ready and a depth player can be defensible: the tier authorizes and forbids nothing', () => {
    /* Player Development's authorization never reads the tier. */
    for (const file of ['prospectDecision.ts', 'prospectAssignments.ts', 'destinationFit.ts']) {
      const source = fs.readFileSync(path.join(process.cwd(), 'server', file), 'utf8');
      expect(source, file).not.toMatch(/evaluateDevelopmentProtection|DevelopmentProtection|protection\.tier/);
    }
    /* A core prospect whose production clears the durable bar is defensible even with no relief at all. */
    const ready = evaluateMlbAssignmentContext({
      context: 'temporary_depth', kind: 'hitter',
      protection: evaluateDevelopmentProtection({ lines: STARTING,  age: 20, ability: syntheticScoutedAbility({ current: 50, potential: 58 }), context: AAA(20) }),
      experience: null,
      currentLevel: { readiness: 90, readinessRange: { min: 90, max: 90 }, sampleConfidence: 70, promotionThreshold: 80 },
    });
    expect(ready.stakes.tier).toBe('core_prospect');
    expect(ready.readiness.relief).toBe(0);
    expect(ready.judgment).toBe('defensible');
  });
});

describe('downstream: the tier is read, never rewritten', () => {
  const ability = syntheticScoutedAbility({ current: 40, potential: 54, kind: 'pitcher' });
  const mlb = (over: Partial<ContextInput>): ContextInput => ({
    context: 'temporary_depth', kind: 'pitcher', protection: evaluateDevelopmentProtection({ lines: STARTING,  age: 22, ability, context: AAA(22) }),
    experience: { plateAppearances: 0, inningsPitched: 300 }, currentLevel: null, ...over,
  });

  it('15. a contemplated major-league role reads his stakes and cannot change them', () => {
    const own = evaluateDevelopmentProtection({ lines: STARTING,  age: 22, ability, context: AAA(22) });
    expect(own.tier).toBe('core_prospect');
    for (const context of ['temporary_depth', 'short_bullpen', 'spot_start'] as const) {
      const a = evaluateMlbAssignmentContext(mlb({ context }));
      expect(a.stakes.tier).toBe(own.tier);
      expect(a.stakes.reasons).toEqual(own.reasons);
      expect(a.stakes.weight).toBe(STAKES_WEIGHT.core_prospect);
      expect(a.readiness.relief).toBe(0); // a core prospect gets no relief, whichever role is contemplated
    }
  });

  it('re-tiering never makes a high-stakes prospect easier to use as temporary cover than ordinary veteran depth', () => {
    const line = { readiness: 70, readinessRange: { min: 70, max: 70 }, sampleConfidence: 60, promotionThreshold: 80 };
    const prospect = evaluateMlbAssignmentContext(mlb({ currentLevel: line }));
    const veteran = evaluateMlbAssignmentContext(
      mlb({ protection: evaluateDevelopmentProtection({ lines: STARTING,  age: 31, ability: syntheticScoutedAbility({ current: 47, potential: 47, kind: 'pitcher' }), context: AAA(31) }), currentLevel: line })
    );
    expect(veteran.stakes.tier).toBe('organizational_depth');
    expect(prospect.readiness.required!).toBeGreaterThan(veteran.readiness.required!);
    /* Experience alone establishes the veteran and never the prospect. */
    expect(veteran.routes.established).toBe('satisfied');
    expect(prospect.routes.established).toBe('not_satisfied');
  });

  it('16. a playing-time conflict reacts to the tier while the opportunity evidence underneath it does not move', () => {
    const cast = (tier: DevelopmentProtectionTier) => [
      usage({ playerId: 1, name: 'Regular', inningsByPosition: { SS: 800 }, games: 90, tier: 'normal' }),
      usage({ playerId: 2, name: 'Sharing', inningsByPosition: { SS: 60 }, games: 8, tier: 'normal' }),
      usage({ playerId: 3, name: 'Behind', inningsByPosition: { SS: 10 }, games: 2, tier }),
    ];
    const asProspect = positionConflict(10, 'SS', cast('protected_prospect'), 900)!;
    const asDepth = positionConflict(10, 'SS', cast('organizational_depth'), 900)!;
    const work = (c: typeof asProspect) => c.claimants.map((s) => ({ name: s.name, level: s.level, share: s.share, basis: s.basis }));
    expect(work(asProspect)).toEqual(work(asDepth));
    expect(asProspect.squeezed.map((s) => s.name)).toEqual(['Behind']);
    expect(asProspect.severity).toBe('blocking');
    expect(asDepth.squeezed).toEqual([]);
    expect(asDepth.severity).not.toBe('blocking');
  });

  it('17. a cascade step is defensible or not on Player Development\'s authorization, which never reads the tier', () => {
    const cascade = fs.readFileSync(path.join(process.cwd(), 'server', 'farmCascade.ts'), 'utf8');
    expect(cascade).not.toMatch(/protection|DevelopmentProtectionTier|hasDevelopmentalStakes|tier\b/);
  });

  it('18. a decision another process owns stays that process\'s at every tier and every philosophy', () => {
    const retention = (over: Partial<RetentionInput>): RetentionInput => ({
      playerId: 1, name: 'A Minor Leaguer', age: 28, teamId: 10, team: 'A Club', level: 2, levelName: 'AAA',
      protection: tierOf('organizational_depth'),
      current: evaluateCurrentAssignment(currentInput({ leaguePercentile: 50, ageRelativeToLevel: -4, tier: 'organizational_depth' })),
      assignmentConclusion: 'organizational_question', proServiceYears: 7,
      state: { onFortyMan: true, majorLeagueContract: false, mustBeActive: false, onInjuredList: false },
      waiting: [{ playerId: 2, name: 'A Prospect', age: 21, what: 'developmental work at 1B' }], clubCrowded: true,
      philosophy: { prospectPreservation: 50, rosterDepth: 50 }, facts: [], ...over,
    });
    for (const tier of ['organizational_depth', 'normal', 'development_priority'] as const) {
      for (const prospectPreservation of [0, 50, 100]) {
        const r = reviewRetention(retention({ protection: tierOf(tier), philosophy: { prospectPreservation, rosterDepth: 50 } }));
        expect(r.guardrails.map((g) => g.code)).toContain('on_forty_man');
        expect(r.conclusion).toBe('not_a_farm_decision');
        expect(r.guardrails.find((g) => g.code === 'on_forty_man')!.owner).toBe('Player Rights and MLB Operations');
      }
    }
    /* Off the 40-man the same man is a question for the farm; the guardrail did not come from his tier. */
    expect(reviewRetention(retention({ state: { onFortyMan: false, majorLeagueContract: false, mustBeActive: false, onInjuredList: false } })).conclusion).toBe('review');
  });

  it('retention: a young player with upside is never a release question because his results are sparse', () => {
    const young = reviewRetention({
      playerId: 1, name: 'A Teenager', age: 18, teamId: 10, team: 'A Club', level: 6, levelName: 'R',
      protection: stakes(18, 28, 52, DSL(18)),
      current: evaluateCurrentAssignment(currentInput({ leaguePercentile: null, reliability: 0, unassessable: 'His club has played ten games.', ageRelativeToLevel: 0.3, tier: 'protected_prospect' })),
      assignmentConclusion: 'not_assessable', proServiceYears: 1,
      state: { onFortyMan: false, majorLeagueContract: false, mustBeActive: false, onInjuredList: false },
      waiting: [{ playerId: 2, name: 'Another', age: 19, what: 'developmental work at SS' }], clubCrowded: true,
      philosophy: { prospectPreservation: 0, rosterDepth: 0 }, facts: [],
    });
    expect(young.conclusion).toBe('retain');
    expect(young.guardrails.map((g) => g.code)).toContain('protected_prospect');
  });
});

describe('the explanation', () => {
  it('says the ceiling, then what is left of his development, and never shows a score', () => {
    const p = stakes(19, 36, 52, HIGH_A(19));
    expect(p.reasons[0]).toMatch(/^Visible ceiling of a major-league regular: a potential of 52/);
    expect(p.reasons[1]).toBe('At 19 most of his development is still ahead of him.');
    expect(JSON.stringify(p)).not.toMatch(/"score"/);
  });

  it('ends by saying how the two readings made the tier, so a tier under the ceiling\'s own is never a mystery', () => {
    expect(stakes(19, 36, 52, HIGH_A(19)).reasons.at(-1)).toBe(
      'Developmental stakes: protected prospect, which is what that ceiling sets with most of his development still ahead of him.'
    );
    expect(stakes(25, 44, 51, AAA(25)).reasons.at(-1)).toBe(
      'Developmental stakes: ordinary. That ceiling alone would set protected prospect; it is lowered two steps for the development that has run out.'
    );
    /* A man already at the lowest tier is not said to have been lowered further than it goes. */
    expect(stakes(33, 39, 39, AAA(33)).reasons.at(-1)).toMatch(/lowered one step .* \(the lowest tier; it goes no further\)/);
    /* Never a claim about the man's worth, his rank or a hidden number. */
    for (const p of [stakes(19, 36, 52), stakes(25, 44, 51), stakes(33, 39, 39), stakes(17, 20, 44)]) {
      expect(why(p)).not.toMatch(/not much of a prospect|valued|rank|#\d|true talent|score/i);
    }
  });

  it('says why a reading differs from the absolute composite it replaced, and that reading decides nothing', () => {
    const lifted = stakes(19, 36, 52, HIGH_A(19));
    expect(lifted.reading!.supersededComposite.tier).toBe('development_priority');
    expect(lifted.reading!.supersededComposite.differs).toMatch(/Reads higher .* could not be reached/);

    const teenager = stakes(17, 23, 41, DSL(17));
    expect(teenager.reading!.supersededComposite.tier).toBe('development_priority');
    expect(teenager.tier).toBe('normal');
    expect(teenager.reading!.supersededComposite.differs).toMatch(/youth and a wide gap added points/);

    const same = stakes(28, 30, 30, AA(28));
    expect(same.reading!.supersededComposite.differs).toBeNull();
  });

  it('reads a pitcher\'s ceiling against pitchers and a hitter\'s against hitters', () => {
    /* A 48 is the median major-league pitcher's composite and under the median hitter's. */
    expect(stakes(20, 38, 48, LOW_A(20), 'pitcher').reading!.ceiling.band).toBe('regular');
    expect(stakes(20, 38, 48, LOW_A(20), 'hitter').reading!.ceiling.band).toBe('fringe');
    expect(stakes(20, 38, 53, LOW_A(20), 'pitcher').tier).toBe('core_prospect');
    expect(stakes(20, 38, 53, LOW_A(20), 'hitter').tier).toBe('protected_prospect');
  });
});
