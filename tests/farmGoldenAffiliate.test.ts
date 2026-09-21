import { describe, expect, it } from 'vitest';
import { buildAffiliateView, operationalReading, resetFarmFindingIds, type AffiliateInput } from '../server/farmAffiliate.js';
import type { AffiliateRosterHealth } from '../server/minorLeagueRoster.js';
import { positionConflict } from '../server/playingTime.js';
import { usage } from './farmGolden.js';

/**
 * Operational health and developmental health are two readings of one club, and they stay apart.
 *
 * A club can field nine competent players and be developmentally wrong for half of them; a club can
 * be developmentally ideal and unable to cover a doubleheader. The farm v1 model had one status and
 * so could say neither.
 */

const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;

const coverage = (counts: Partial<Record<(typeof POSITIONS)[number], number>>) =>
  POSITIONS.map((position) => {
    const n = counts[position] ?? 3;
    return {
      position,
      playable: n,
      strong: 0,
      players: Array.from({ length: n }, (_, i) => ({
        playerId: 1000 + i,
        name: `Cover ${i}`,
        listedPosition: position,
        rating: 50,
        primary: i === 0,
      })),
    };
  });

const health = (overrides: Partial<AffiliateRosterHealth> = {}): AffiliateRosterHealth => ({
  teamId: 10,
  label: 'A Club',
  level: 3,
  levelName: 'AA',
  roster: { total: 26, positionPlayers: 13, pitchers: 13, dayToDay: 0 },
  positionPlayers: { fieldablePositions: 8, canFieldDefense: true, coverage: coverage({}) },
  pitching: { starters: 5, relievers: 8 },
  rosterTreatment: { rehab: [], ambiguous: [], injured: [] },
  ...overrides,
});

const view = (overrides: Partial<AffiliateInput> = {}) => {
  resetFarmFindingIds();
  return buildAffiliateView({
    health: health(),
    leagueId: 300,
    leagueName: 'A League',
    games: 100,
    conflicts: [],
    listedOnly: {},
    rotationClaimants: 5,
    roleConversions: [],
    assignments: [],
    ...overrides,
  });
};

describe('an affiliate as a roster that has to function', () => {
  it('is healthy when nothing is short, however much it is carrying', () => {
    const v = view({
      health: health({
        roster: { total: 42, positionPlayers: 14, pitchers: 28, dayToDay: 0 },
        pitching: { ...health().pitching, relievers: 23, bodyCountStatus: 'surplus', bullpenStatus: 'surplus' },
      }),
    });
    // A surplus is a developmental problem, never an operational state
    expect(v.operational.status).toBe('healthy');
    expect(v.operational.findings).toEqual([]);
  });

  it('is critical when nobody covers a position at all', () => {
    const v = view({ health: health({ positionPlayers: { ...health().positionPlayers, coverage: coverage({ C: 0 }) } }) });
    expect(v.operational.status).toBe('critical');
    expect(v.operational.findings.map((f) => f.code)).toContain('position_uncovered');
  });

  it('raises a single cover only at a position nobody else can fill in for', () => {
    const shortstop = view({ health: health({ positionPlayers: { ...health().positionPlayers, coverage: coverage({ SS: 1 }) } }) });
    expect(shortstop.operational.findings.map((f) => f.code)).toContain('position_single_cover');
    const firstBase = view({ health: health({ positionPlayers: { ...health().positionPlayers, coverage: coverage({ '1B': 1 }) } }) });
    expect(firstBase.operational.findings.map((f) => f.code)).not.toContain('position_single_cover');
  });

  it('counts the men taking the starts, not the role codes, when it calls a rotation short', () => {
    // Four men carry the role and two relief arms are starting: the rotation is not short
    const v = view({ health: health({ pitching: { ...health().pitching, starters: 4 } }), rotationClaimants: 6 });
    expect(v.operational.findings.map((f) => f.code)).not.toContain('rotation_short');
    expect(v.operational.status).toBe('healthy');
  });

  it('says a rotation is short when nobody is taking the starts, and shows both counts', () => {
    const v = view({ health: health({ pitching: { ...health().pitching, starters: 3 } }), rotationClaimants: 3 });
    const finding = v.operational.findings.find((f) => f.code === 'rotation_short')!;
    expect(finding.evidence.map((e) => e.label)).toContain('Taking starts');
    expect(finding.evidence.map((e) => e.label)).toContain('Assigned to start by OOTP role');
  });

  it('names a rehab assignee in the rotation finding rather than counting him', () => {
    const v = view({
      health: health({
        pitching: { ...health().pitching, starters: 3 },
        rosterTreatment: { rehab: [{ playerId: 55, name: 'Rehabbing Starter' }], ambiguous: [], injured: [] },
      }),
      rotationClaimants: 3,
    });
    const finding = v.operational.findings.find((f) => f.code === 'rotation_short')!;
    expect(finding.players.map((p) => p.name)).toContain('Rehabbing Starter');
    expect(finding.players[0].note).toMatch(/rehab assignment/);
  });

  it('gives every finding its evidence with a basis, and what would resolve it', () => {
    const v = view({ health: health({ positionPlayers: { ...health().positionPlayers, coverage: coverage({ C: 0 }) } }) });
    for (const f of v.operational.findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      for (const e of f.evidence) expect(e.basis.length).toBeGreaterThan(0);
      expect(f.wouldResolve.length).toBeGreaterThan(0);
      expect(f.owner).toBeDefined();
    }
  });

  it('tells a position covered by a revealed grade from one covered only by a roster label', () => {
    const v = view({
      health: health({ positionPlayers: { ...health().positionPlayers, coverage: coverage({ CF: 1 }) } }),
      listedOnly: { CF: 1 },
    });
    const cf = v.operational.coverage.find((c) => c.position === 'CF')!;
    expect(cf.listedOnly).toBe(1);
    expect(v.unknowns.join(' ')).not.toMatch(/CF is covered only by roster labels/);
  });
});

describe('an affiliate as a place players develop', () => {
  it('reports congestion the operational reading calls healthy', () => {
    const conflict = positionConflict(
      10,
      'SS',
      [
        usage({ playerId: 1, name: 'Regular', inningsByPosition: { SS: 700 } }),
        usage({ playerId: 2, name: 'Squeezed', inningsByPosition: { SS: 5 } }),
        usage({ playerId: 3, name: 'Third', inningsByPosition: { SS: 60 } }),
      ],
      900
    )!;
    const v = view({ conflicts: [conflict] });
    expect(v.operational.status).toBe('healthy');
    expect(v.developmental.findings.map((f) => f.code)).toContain('position_congested');
    expect(v.developmental.conflicts).toHaveLength(1);
  });

  it('separates a prospect who has outgrown the level from a depth player past its age window', () => {
    const v = view({
      assignments: [
        { playerId: 1, name: 'Prospect', age: 21, verdict: 'no_longer_developmental', question: 'developmental', summary: 'Beyond AA.', unassessableReason: null },
        { playerId: 2, name: 'Journeyman', age: 29, verdict: 'no_longer_developmental', question: 'organizational', summary: 'Past the window.', unassessableReason: null },
      ],
    });
    const beyond = v.developmental.findings.filter((f) => f.code === 'level_no_longer_developmental');
    expect(beyond).toHaveLength(2);
    expect(beyond.find((f) => f.severity === 'attention')!.players.map((p) => p.name)).toEqual(['Prospect']);
    expect(beyond.find((f) => f.severity === 'noted')!.players.map((p) => p.name)).toEqual(['Journeyman']);
  });

  it('counts a player with no readable line as not assessed, never as a negative', () => {
    const v = view({
      games: 8,
      assignments: [
        { playerId: 1, name: 'Too Early', age: 18, verdict: 'not_assessable', question: 'none', summary: 'Nothing to read.', unassessableReason: 'His club has played 8 games.' },
      ],
    });
    expect(v.developmental.assessment.notAssessable).toBe(1);
    expect(v.developmental.assessment.assessed).toBe(0);
    expect(v.developmental.concerns).toEqual([]);
    expect(v.unknowns.join(' ')).toMatch(/played 8 games/);
  });

  it('reports an arm used in relief with the structure to start as a development question, not a shortage', () => {
    const v = view({
      roleConversions: [{ playerId: 7, name: 'Relief Arm', age: 22, tier: 'development_priority', basis: 'The club has him in relief.' }],
    });
    const finding = v.developmental.findings.find((f) => f.code === 'role_conversion_available')!;
    expect(finding.severity).toBe('noted');
    expect(finding.owner).toBe('player_development');
    expect(v.operational.findings).toEqual([]);
  });
});

describe('an injured player', () => {
  it('is not counted as cover, and is named as injured at the position he is listed at', () => {
    const v = view({
      health: health({
        positionPlayers: { fieldablePositions: 8, canFieldDefense: true, coverage: coverage({ SS: 1 }) },
        rosterTreatment: { rehab: [], ambiguous: [], injured: [{ playerId: 66, name: 'Hurt Shortstop', listedPosition: 'SS', daysLeft: 45 }] },
      }),
    });
    const finding = v.operational.findings.find((f) => f.code === 'position_single_cover')!;
    expect(finding).toBeDefined();
    expect(finding.players.find((p) => p.playerId === 66)?.note).toMatch(/injured \(45 days\), not counted as cover/);
    expect(v.rosterTreatment.injured).toHaveLength(1);
  });

  it('is named in the rotation finding when he is a pitcher, rather than counted as a starter', () => {
    const v = view({
      health: health({ pitching: { ...health().pitching, starters: 4 }, rosterTreatment: { rehab: [], ambiguous: [], injured: [{ playerId: 67, name: 'Hurt Starter', listedPosition: 'P', daysLeft: 60 }] } }),
      rotationClaimants: 4,
    });
    const finding = v.operational.findings.find((f) => f.code === 'rotation_short')!;
    expect(finding.players.map((p) => p.name)).toContain('Hurt Starter');
  });
});

describe('the operational reading on its own', () => {
  it('is the same reading the affiliate view carries, status and findings alike', () => {
    const h = health({ pitching: { ...health().pitching, starters: 3 } });
    resetFarmFindingIds();
    const alone = operationalReading({ health: h, listedOnly: {}, rotationClaimants: 3 });
    const inView = view({ health: h, rotationClaimants: 3 }).operational;
    expect(alone.status).toBe(inView.status);
    expect(alone.findings.map((f) => f.code)).toEqual(inView.findings.map((f) => f.code));
  });

  it('never reports a status the findings do not justify', () => {
    for (const rotationClaimants of [2, 3, 4, 5, 6]) {
      const op = view({ rotationClaimants }).operational;
      const critical = op.findings.some((f) => f.severity === 'critical');
      expect(op.status).toBe(critical ? 'critical' : op.findings.length > 0 ? 'thin' : 'healthy');
    }
  });
});
