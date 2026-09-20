import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AssignmentContext, AssignmentKind } from '../server/assignmentContext';
import { leagueRulesFromRow, type LeagueRules } from '../server/leagueRules';
import type { PlayerState } from '../server/playerState';
import {
  evaluatePlayerRights, rosterCounts, type PlayerRights, type RightsContext, type RightsEvidence,
} from '../server/playerRights';
import { derivedFrom, fromExport, unknownBecause, type Sourced } from '../server/provenance';

/*
 * Synthetic states shaped by what was observed in controlled copied-save
 * experiments (docs/RIGHTS_RESEARCH.md). Nothing here reads a real save.
 */

const known = <T>(value: T, source = 'test'): Sourced<T> => fromExport(value, source);
const unknown = <T>(): Sourced<T> => unknownBecause<T>('not_exported_by_ootp', 'test', 'blank');

interface Spec {
  level?: number | null;
  active?: boolean | null;
  forty?: boolean | null;
  il?: boolean;
  il60?: boolean;
  designated?: boolean;
  onWaivers?: boolean;
  dfaDaysLeft?: number;
  waiverDaysLeft?: number;
  mlbYears?: number | null;
  used?: number | null;
  usedThisYear?: number | null;
  injuryDaysLeft?: number;
}

function stateOf(spec: Spec = {}): PlayerState {
  const pick = <T>(v: T | null | undefined, fallback: T): Sourced<T> =>
    v === null ? unknown<T>() : known(v === undefined ? fallback : v);
  return {
    playerId: 1,
    name: 'Test Player',
    age: 27,
    organizationId: known(1),
    teamId: known(1),
    level: pick(spec.level, 1),
    activeRoster: pick(spec.active, true),
    fortyMan: pick(spec.forty, true),
    injuredList: { onIl: known(spec.il ?? false), onIl60: known(spec.il60 ?? false) },
    injury: { injured: known(false), dayToDay: known(false), daysLeft: known(spec.injuryDaysLeft ?? 0) },
    dfa: {
      designated: known(spec.designated ?? false),
      daysLeft: known(spec.dfaDaysLeft ?? 0),
      onWaivers: known(spec.onWaivers ?? false),
      waiverDaysLeft: known(spec.waiverDaysLeft ?? 0),
      irrevocableWaivers: known(false),
    },
    serviceTime: {
      mlbYears: pick(spec.mlbYears, 2), mlbDays: known(0), mlbDaysThisSeason: known(0),
      professionalYears: known(6), professionalDays: known(0),
    },
    options: {
      used: pick(spec.used, 0), usedThisYear: pick(spec.usedThisYear, 0), yearsProtectedFromRule5: known(4),
    },
    contract: { majorLeague: known(true) },
    wasTraded: known(false),
    health: derivedFrom(null, 'test'),
    standing: derivedFrom('active' as PlayerState['standing']['value'], 'test'),
  } as PlayerState;
}

function league(over: Partial<Record<string, number | null>> = {}): LeagueRules {
  const row = {
    league_id: 203, rules_minor_league_options: 1, rules_rule_5: 1, rules_dfa_period_length: 7,
    rules_waiver_period_length: 3, rules_active_roster_limit: 26, rules_expanded_roster_limit: 28,
    rosters_expanded: 0, rules_secondary_roster_limit: 40, ...over,
  };
  return leagueRulesFromRow(row, new Set(Object.keys(row)));
}

function assignment(kind: AssignmentKind, since: string | null = '2030-05-10'): AssignmentContext {
  return {
    kind, label: kind, sinceLabel: null, since,
    ordinaryOption: kind === 'optioned' ? true : kind === 'unattributed' ? null : false,
    provenance: kind === 'unattributed' ? 'unknown' : 'explicit_log',
    source: 'test', exportAgrees: true, rehab: null, details: {}, evidence: [],
  };
}

const CURRENT: RightsEvidence = { currentState: 'current', chronology: 'current' };

function rights(spec: Spec, over: Partial<RightsContext> = {}): PlayerRights {
  return evaluatePlayerRights({
    state: stateOf(spec),
    assignment: null,
    league: league(),
    counts: { active: 25, fortyMan: 38 },
    evidence: CURRENT,
    ...over,
  });
}

const codes = (r: { reasons: Array<{ code: string }> }): string[] => r.reasons.map((x) => x.code);

describe('option', () => {
  it('is eligible for an active player with option years left and under five years of service', () => {
    // Carroll (3 yrs, 0 used), Hoffmann (0 yrs, 1 used), Perdomo (4 yrs, 1 used): all accepted in OOTP
    for (const [years, used] of [[3, 0], [0, 1], [4, 1], [1, 2]]) {
      const r = rights({ mlbYears: years, used }).actions.option;
      expect(r.status).toBe('eligible');
      expect(r.facts.optionYearsRemaining).toBe(3 - used);
      expect(r.reasons[0].basis).toBe('observed_and_documented');
    }
  });

  it('is ineligible when all three option years are used and none was charged this season (Ross)', () => {
    const r = rights({ mlbYears: 4, used: 3, usedThisYear: 0 }).actions.option;
    expect(r.status).toBe('ineligible');
    expect(codes(r)).toEqual(['out_of_options']);
  });

  it('is ineligible at five or more years of service: the player refuses (Ginkel 5, Clarke 6, Arenado 13)', () => {
    for (const years of [5, 6, 13]) {
      const r = rights({ mlbYears: years, used: 1 }).actions.option;
      expect(r.status).toBe('ineligible');
      expect(codes(r)).toEqual(['may_refuse_assignment']);
    }
    expect(rights({ mlbYears: 4, used: 1 }).actions.option.status).toBe('eligible');
  });

  it('reports both reasons when a veteran is also out of options', () => {
    expect(codes(rights({ mlbYears: 8, used: 3, usedThisYear: 0 }).actions.option)).toEqual(['may_refuse_assignment', 'out_of_options']);
  });

  it('is ineligible on the injured list, off the active roster, and in the minors', () => {
    expect(codes(rights({ il: true }).actions.option)).toEqual(['on_injured_list']);
    // An inactive IL player is refused for the list, the reason OOTP gives (Mena), not for being inactive
    expect(codes(rights({ il: true, active: false }).actions.option)).toEqual(['on_injured_list']);
    expect(codes(rights({ active: false }).actions.option)).toEqual(['not_on_active_roster']);
    expect(codes(rights({ level: 2, active: false }).actions.option)).toEqual(['not_on_major_league_club']);
  });

  it('is indeterminate, not eligible, when the counters are not exported', () => {
    for (const spec of [{ used: null }, { usedThisYear: null }, { mlbYears: null }] as Spec[]) {
      const r = rights(spec).actions.option;
      expect(r.status).toBe('indeterminate');
      expect(r.missing[0].code).toBe('field_not_exported');
    }
  });

  it('is indeterminate when the league has no option rule, or options are switched off', () => {
    const noColumn = leagueRulesFromRow({ league_id: 203 }, new Set(['league_id']));
    expect(rights({}, { league: noColumn }).actions.option.status).toBe('indeterminate');
    const off = rights({}, { league: league({ rules_minor_league_options: 0 }) }).actions.option;
    expect(off.status).toBe('indeterminate');
    expect(off.missing[0].code).toBe('rule_not_established');
  });

  it('does not guess when the last option year was already charged this season', () => {
    const r = rights({ used: 3, usedThisYear: 1, mlbYears: 4 }).actions.option;
    expect(r.status).toBe('indeterminate');
    expect(codes(r)).toEqual(['option_year_already_charged']);
    // ...while an earlier year already charged still leaves years available
    expect(rights({ used: 1, usedThisYear: 1, mlbYears: 4 }).actions.option.status).toBe('eligible');
  });

  it('a rehab player is not on the club to be optioned', () => {
    const r = rights({ level: 2, active: false }, { assignment: assignment('rehab_assignment') }).actions.option;
    expect(r.status).toBe('ineligible');
    expect(r.reasons[0].message).toMatch(/rehab/i);
  });
});

describe('option years', () => {
  it('states standing independently of where the player is', () => {
    const at = (used: number, thisYear: number) => rights({ level: 2, active: false, used, usedThisYear: thisYear }).optionYears;
    expect(at(0, 0)).toMatchObject({ standing: 'available', remaining: 3 });
    expect(at(2, 0)).toMatchObject({ standing: 'available', remaining: 1 });
    expect(at(3, 0)).toMatchObject({ standing: 'exhausted', remaining: 0 });
    expect(at(3, 1)).toMatchObject({ standing: 'exhausted_charged_this_season' });
    expect(rights({ used: null }).optionYears.standing).toBe('indeterminate');
    expect(rights({}, { league: league({ rules_minor_league_options: 0 }) }).optionYears.standing).toBe('indeterminate');
  });
});

describe('recall', () => {
  const below: Spec = { level: 2, active: false, forty: true };

  it('is eligible for an optioned 40-man player when the chronology is current and a spot is open', () => {
    const r = rights(below, { assignment: assignment('optioned') }).actions.recall;
    expect(r.status).toBe('eligible');
    expect(r.requirements).toMatchObject([{ kind: 'active_roster_spot', status: 'met' }]);
    expect(r.reasons[0].basis).toBe('observed');
  });

  it('enforces no waiting period: a player optioned today or yesterday is recallable', () => {
    // Carroll returned the same day; Hoffmann after one night; AI clubs did the same
    for (const since of ['2030-06-01', '2030-05-31', null]) {
      expect(rights(below, { assignment: assignment('optioned', since) }).actions.recall.status).toBe('eligible');
    }
    expect(rights(below, { assignment: assignment('optioned') }).actions.recall.limitation).toMatch(/10\/15-day/);
  });

  it('is still eligible, but names the unmet requirement, when the active roster is full', () => {
    const r = rights(below, { assignment: assignment('optioned'), counts: { active: 26, fortyMan: 38 } }).actions.recall;
    expect(r.status).toBe('eligible');
    expect(r.requirements[0]).toMatchObject({ kind: 'active_roster_spot', status: 'unmet' });
    expect(r.label).toMatch(/full/);
  });

  it('uses the expanded limit while rosters are expanded', () => {
    const expanded = league({ rosters_expanded: 1 });
    const r = rights(below, { assignment: assignment('optioned'), league: expanded, counts: { active: 26, fortyMan: 38 } }).actions.recall;
    expect(r.requirements[0].status).toBe('met');
  });

  it('is indeterminate, not eligible, when roster size is unknown', () => {
    const r = rights(below, { assignment: assignment('optioned'), counts: { active: null, fortyMan: 38 } }).actions.recall;
    expect(r.status).toBe('indeterminate');
  });

  it('is ineligible for a player already with the club, in DFA, or off the 40-man', () => {
    expect(codes(rights({ level: 1 }).actions.recall)).toEqual(['already_with_major_league_club']);
    expect(codes(rights({ ...below, designated: true }).actions.recall)).toEqual(['designated_for_assignment']);
    expect(codes(rights({ ...below, forty: false }).actions.recall)).toEqual(['not_on_forty_man']);
  });

  it('does not treat a rehab assignment as an ordinary recall', () => {
    const r = rights(below, { assignment: assignment('rehab_assignment') }).actions.recall;
    expect(r.status).toBe('indeterminate');
    expect(codes(r)).toEqual(['rehab_assignment']);
  });

  it('cannot tell a rehab assignment from an option without the log', () => {
    const r = rights(below, {
      assignment: assignment('unattributed'),
      evidence: { currentState: 'current', chronology: 'unavailable' },
    }).actions.recall;
    expect(r.status).toBe('indeterminate');
    expect(r.missing.map((m) => m.code)).toEqual(['chronology_unavailable', 'assignment_cause_unknown']);
  });

  it('is indeterminate when an explicit option is in a log that is behind the save', () => {
    // The export cannot say whether a later rehab assignment is missing from a lagging log
    const r = rights(below, {
      assignment: assignment('optioned'),
      evidence: { currentState: 'current', chronology: 'behind' },
    }).actions.recall;
    expect(r.status).toBe('indeterminate');
    expect(r.missing.map((m) => m.code)).toEqual(['chronology_behind']);
  });
});

describe('stale evidence propagates per action, not to the whole object', () => {
  it('a lagging log makes only the chronology-dependent action indeterminate', () => {
    const r = rights(
      { level: 2, active: false },
      { assignment: assignment('optioned'), evidence: { currentState: 'current', chronology: 'behind' } }
    );
    expect(r.actions.recall.status).toBe('indeterminate');
    // Current-state-only conclusions stay valid
    expect(r.actions.option.status).toBe('ineligible');
    expect(r.actions.addToFortyMan.status).toBe('ineligible');
    expect(r.actions.designateForAssignment.status).toBe('eligible');
  });

  it('a stale export makes every action indeterminate, whatever the log says', () => {
    const r = rights({ mlbYears: 2, used: 0 }, { evidence: { currentState: 'behind', chronology: 'current' } });
    for (const action of Object.values(r.actions)) {
      expect(action.status).toBe('indeterminate');
      expect(action.missing[0].code).toBe('current_state_stale');
    }
  });

  it('a missing export is reported as unavailable, not stale', () => {
    const r = rights({}, { evidence: { currentState: 'unavailable', chronology: 'unavailable' } });
    expect(r.actions.option.missing[0].code).toBe('current_state_unavailable');
  });

  it('an export that cannot be dated is used, with the limitation stated', () => {
    const r = rights({ mlbYears: 2, used: 0 }, { evidence: { currentState: 'unverified', chronology: 'current' } });
    expect(r.actions.option.status).toBe('eligible');
    expect(r.actions.option.limitation).toBeTruthy();
    const noLimitation = rights({ il: true }, { evidence: { currentState: 'unverified', chronology: 'current' } }).actions.activateFromInjuredList;
    expect(noLimitation.status).toBe('indeterminate');
  });
});

describe('40-man', () => {
  it('addToFortyMan is eligible with an open spot and names the unmet requirement when full', () => {
    const off: Spec = { level: 2, active: false, forty: false };
    expect(rights(off).actions.addToFortyMan.requirements[0].status).toBe('met');
    const full = rights(off, { counts: { active: 26, fortyMan: 40 } }).actions.addToFortyMan;
    expect(full.status).toBe('eligible');
    expect(full.requirements[0]).toMatchObject({ kind: 'forty_man_spot', status: 'unmet' });
    // An over-full 40-man (29 of a lowered limit 28) is full too
    const over = rights(off, { league: league({ rules_secondary_roster_limit: 28 }), counts: { active: 25, fortyMan: 29 } });
    expect(over.actions.addToFortyMan.requirements[0].status).toBe('unmet');
  });

  it('is ineligible for a player already on it', () => {
    expect(codes(rights({ forty: true }).actions.addToFortyMan)).toEqual(['already_on_forty_man']);
  });

  it('a designated player can be restored, as OOTP did with Ross', () => {
    const r = rights({ level: 1, active: false, forty: false, designated: true, onWaivers: true, dfaDaysLeft: 0 }).actions.addToFortyMan;
    expect(r.status).toBe('eligible');
    expect(codes(r)).toEqual(['restore_from_dfa']);
  });

  it('the 60-day IL is off the 40-man and its return is not established', () => {
    const sixty: Spec = { active: false, forty: false, il: true, il60: true, injuryDaysLeft: 20 };
    const r = rights(sixty);
    expect(r.actions.addToFortyMan.status).toBe('indeterminate');
    expect(r.actions.activateFromInjuredList.status).toBe('indeterminate');
    expect(r.actions.activateFromInjuredList.facts.injuryDaysLeft).toBe(20);
    expect(r.actions.activateFromInjuredList.missing[0].code).toBe('rule_not_established');
  });

  it('a ten-day IL player is still on the 40-man and his activation is not established either', () => {
    const r = rights({ active: false, forty: true, il: true }).actions.activateFromInjuredList;
    expect(r.status).toBe('indeterminate');
    expect(codes(r)).toEqual(['ten_day_il']);
    expect(rights({}).actions.activateFromInjuredList.status).toBe('ineligible');
  });

  it('counts come from the exported flags and are unknown if any flag is', () => {
    const roster = [stateOf({ active: true, forty: true }), stateOf({ active: false, forty: true }), stateOf({ active: false, forty: false })];
    expect(rosterCounts(roster)).toEqual({ active: 1, fortyMan: 2 });
    expect(rosterCounts([...roster, stateOf({ active: null, forty: true })])).toEqual({ active: null, fortyMan: 3 });
  });
});

describe('DFA, waivers, outright', () => {
  it('designating is eligible for a 40-man player and states the league periods', () => {
    const r = rights({ mlbYears: 8 }).actions.designateForAssignment;
    expect(r.status).toBe('eligible');
    expect(r.facts).toMatchObject({ dfaPeriodDays: 7, waiverPeriodDays: 3, mayRefuseOutright: true });
  });

  it('designating is ineligible if already designated (with the countdown) or off the 40-man', () => {
    const r = rights({ designated: true, forty: false, dfaDaysLeft: 4 }).actions.designateForAssignment;
    expect(r.status).toBe('ineligible');
    expect(r.label).toMatch(/4 days left/);
    expect(codes(rights({ forty: false }).actions.designateForAssignment)).toEqual(['not_on_forty_man']);
  });

  it('designating an injured or rehabbing player has not been observed', () => {
    expect(rights({ il: true }).actions.designateForAssignment.status).toBe('indeterminate');
    expect(rights({ level: 2, active: false }, { assignment: assignment('rehab_assignment') }).actions.designateForAssignment.status).toBe('indeterminate');
  });

  it('outright is ineligible until waivers clear, then eligible (Tawa)', () => {
    const designated = { designated: true, onWaivers: true, forty: false, active: false, mlbYears: 0 };
    const open = rights({ ...designated, waiverDaysLeft: 2, dfaDaysLeft: 6 }).actions.outrightAssignment;
    expect(open.status).toBe('ineligible');
    expect(open.requirements[0]).toMatchObject({ kind: 'waivers_cleared', status: 'unmet' });
    // Day 7: the claim window has ended, the flag is still on, the DFA period is at zero
    const cleared = rights({ ...designated, waiverDaysLeft: 0, dfaDaysLeft: 0 }).actions.outrightAssignment;
    expect(cleared.status).toBe('eligible');
    expect(cleared.requirements[0].status).toBe('met');
  });

  it('outright is ineligible at five years of service: he refuses (Ross)', () => {
    const r = rights({ designated: true, onWaivers: true, forty: false, active: false, mlbYears: 8, waiverDaysLeft: 0 }).actions.outrightAssignment;
    expect(r.status).toBe('ineligible');
    expect(codes(r)).toEqual(['may_refuse_assignment']);
  });

  it('outright is ineligible for a player who is not designated', () => {
    expect(codes(rights({}).actions.outrightAssignment)).toEqual(['not_designated']);
  });
});

describe('Rule 5 and unsupported rules never guess', () => {
  it('reports Rule 5 as indeterminate off the 40-man, and protected on it', () => {
    expect(rights({ forty: false, level: 3, active: false }).ruleFive).toMatchObject({ status: 'indeterminate' });
    expect(rights({ forty: true }).ruleFive.status).toBe('protected_by_forty_man');
    expect(rights({ forty: false }, { league: league({ rules_rule_5: 0 }) }).ruleFive.status).toBe('not_applicable');
  });

  it('every reason names a basis and a source', () => {
    const all = rights({ level: 2, active: false, forty: true }, { assignment: assignment('optioned') });
    for (const action of Object.values(all.actions)) {
      for (const reason of action.reasons) {
        expect(['export_state', 'observed', 'documented', 'observed_and_documented']).toContain(reason.basis);
        expect(reason.source).toBeTruthy();
      }
    }
  });
});

describe('league rules', () => {
  it('reads each rule as exported and keeps a missing one unknown', () => {
    const l = league();
    expect(l.dfaPeriodDays.value).toBe(7);
    expect(l.minorLeagueOptions).toMatchObject({ value: true, provenance: 'explicit_export' });
    const partial = leagueRulesFromRow({ league_id: 203, rules_dfa_period_length: 7 }, new Set(['league_id', 'rules_dfa_period_length']));
    expect(partial.dfaPeriodDays.value).toBe(7);
    expect(partial.waiverPeriodDays).toMatchObject({ value: null, reason: 'not_exported_by_ootp' });
    expect(leagueRulesFromRow(null, null).fortyManLimit).toMatchObject({ value: null, reason: 'source_unavailable' });
  });
});

describe('the evaluator depends only on the shared layers', () => {
  /** Source with comments removed, so prose about a column is not mistaken for reading it. */
  const read = (file: string): string =>
    fs.readFileSync(path.join(__dirname, '..', 'server', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('reads no table, log, or snapshot itself', () => {
    const source = read('playerRights.ts');
    const imports = [...source.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      './assignmentContext.js', './dataFreshness.js', './leagueRules.js', './playerState.js', './provenance.js',
    ]);
    expect(source).not.toMatch(/\.prepare\(|players_roster_status\b.*FROM|rosterStateHistory|liveLogSnapshot|transactionLog/);
  });

  it('roster crunch no longer reconstructs rights from raw columns', () => {
    const source = read('rosterops.ts');
    const crunch = source.slice(source.indexOf("'/roster-crunch/:orgId'"), source.indexOf('// ── Leaderboards'));
    expect(crunch).not.toMatch(/options_used|years_protected_from_rule_5|is_on_secondary|days_on_dfa_left|\brs\./);
    expect(crunch).toMatch(/rightsFor\(/);
  });
});

describe('composed component: place on the active roster after a 40-man addition', () => {
  const offForty = { level: 2, active: false, forty: false } as const;

  it('exists only for a minor leaguer who is not on the 40-man', () => {
    expect(rights({ level: 2, active: false, forty: true }).composed.promoteToActive).toBeNull();
    expect(rights({}).composed.promoteToActive).toBeNull();
    expect(rights(offForty).composed.promoteToActive?.status).toBe('eligible');
  });

  it('owns the active-roster spot and leaves the 40-man spot to addToFortyMan', () => {
    const open = rights(offForty, { counts: { active: 25, fortyMan: 40 } });
    expect(open.composed.promoteToActive?.requirements).toEqual([expect.objectContaining({ kind: 'active_roster_spot', status: 'met' })]);
    // a full 40-man is the first component's requirement, not this one's
    expect(open.actions.addToFortyMan.requirements[0]).toMatchObject({ kind: 'forty_man_spot', status: 'unmet' });
    const full = rights(offForty, { counts: { active: 26, fortyMan: 30 } });
    expect(full.composed.promoteToActive).toMatchObject({ status: 'eligible', label: expect.stringMatching(/active roster full/) });
    expect(full.composed.promoteToActive?.requirements[0].status).toBe('unmet');
  });

  it('is not a recall: it needs no chronology', () => {
    const r = rights(offForty, { evidence: { currentState: 'current', chronology: 'unavailable' } });
    expect(r.composed.promoteToActive?.status).toBe('eligible');
    expect(r.actions.recall.status).toBe('ineligible');
  });

  it('is blocked by DFA, indeterminate on an injured list, and indeterminate on a stale export', () => {
    expect(rights({ ...offForty, designated: true }).composed.promoteToActive?.status).toBe('ineligible');
    expect(rights({ ...offForty, il: true }).composed.promoteToActive?.status).toBe('indeterminate');
    expect(rights(offForty, { evidence: { currentState: 'behind', chronology: 'current' } }).composed.promoteToActive?.status).toBe('indeterminate');
  });
});

describe('activation from an injured list stays indeterminate, and says exactly why', () => {
  it('states what is known: list, days left, healed, and each roster spot', () => {
    const a = rights({ il: true, active: false, injuryDaysLeft: 8 }, { counts: { active: 26, fortyMan: 30 } }).actions.activateFromInjuredList;
    expect(a.status).toBe('indeterminate');
    expect(a.facts).toMatchObject({ list: '10-day', injuryDaysLeft: 8, healed: false, activeRosterCount: 26 });
    expect(a.requirements).toEqual([expect.objectContaining({ kind: 'active_roster_spot', status: 'unmet' })]);
    const codes = a.missing.map((m) => m.message).join(' ');
    expect(codes).toMatch(/injury day\(s\) left/);
    expect(codes).toMatch(/active roster is full/);
    expect(a.limitation).toMatch(/AI clubs/);
  });

  it('a healed player with a spot open is still not established: the rule was never observed', () => {
    const a = rights({ il: true, active: false, injuryDaysLeft: 0 }, { counts: { active: 25, fortyMan: 30 } }).actions.activateFromInjuredList;
    expect(a.status).toBe('indeterminate');
    expect(a.facts.healed).toBe(true);
    expect(a.requirements[0].status).toBe('met');
    expect(a.missing[0].message).toMatch(/even with a healed player and a spot open/);
  });

  it('adds the 40-man requirement from the 60-day list', () => {
    const a = rights({ il60: true, active: false, forty: false, injuryDaysLeft: 30 }, { counts: { active: 25, fortyMan: 40 } }).actions.activateFromInjuredList;
    expect(a.facts.list).toBe('60-day');
    expect(a.requirements.map((r) => [r.kind, r.status])).toEqual([['active_roster_spot', 'met'], ['forty_man_spot', 'unmet']]);
  });

  it('is ineligible off the list and indeterminate on a stale export, as before', () => {
    expect(rights({}).actions.activateFromInjuredList.status).toBe('ineligible');
    expect(rights({ il: true }, { evidence: { currentState: 'behind', chronology: 'current' } }).actions.activateFromInjuredList.status).toBe('indeterminate');
  });
});

describe('activation states its prerequisite clearing moves and stays separate from them', () => {
  it('an unmet spot is a requirement on the activation, never a rejection of it', () => {
    const a = rights({ il: true, active: false, injuryDaysLeft: 0 }, { counts: { active: 26, fortyMan: 30 } }).actions.activateFromInjuredList;
    expect(a.status).toBe('indeterminate');
    expect(a.facts).toMatchObject({ needsActiveSpot: true, needsFortyManSpot: false, activeClearingNeeded: true, fortyManClearingNeeded: false });
    expect(a.status).not.toBe('ineligible');
  });

  it('a 60-day return onto a full 40-man says a 40-man clearing move is needed first, in addition to any active one', () => {
    const a = rights({ il60: true, active: false, forty: false, injuryDaysLeft: 0 }, { counts: { active: 26, fortyMan: 40 } }).actions.activateFromInjuredList;
    expect(a.status).toBe('indeterminate');
    expect(a.facts).toMatchObject({ needsFortyManSpot: true, fortyManClearingNeeded: true, activeClearingNeeded: true });
    expect(a.requirements.map((r) => [r.kind, r.status])).toEqual([['active_roster_spot', 'unmet'], ['forty_man_spot', 'unmet']]);
    expect(a.missing.map((m) => m.message).join(' ')).toMatch(/refuses the activation or forces a corresponding move has not been observed/);
  });

  it('with a spot on each roster no clearing is needed, and the rule is still not established', () => {
    const a = rights({ il60: true, active: false, forty: false, injuryDaysLeft: 0 }, { counts: { active: 25, fortyMan: 30 } }).actions.activateFromInjuredList;
    expect(a.facts).toMatchObject({ activeClearingNeeded: false, fortyManClearingNeeded: false });
    expect(a.status).toBe('indeterminate');
  });

  it('unknown roster counts leave the clearing need unknown, not false', () => {
    const a = rights({ il: true, active: false }, { counts: { active: null, fortyMan: null } }).actions.activateFromInjuredList;
    expect(a.facts.activeClearingNeeded).toBeNull();
    expect(a.requirements[0].status).toBe('unknown');
  });
});

describe('placeOnSixtyDayIl (opens a 40-man spot)', () => {
  it('is not established for an injured 40-man player: one refusal at 7 days is not a rule', () => {
    const a = rights({ il: true, active: false, injuryDaysLeft: 50 }).actions.placeOnSixtyDayIl;
    expect(a.status).toBe('indeterminate');
    expect(a.facts).toMatchObject({ injuryDaysLeft: 50, observedRefusalAtDays: 7, opensFortyManSpot: true });
    expect(codes(a)).toEqual(['sixty_day_leaves_forty_man']);
    expect(a.missing[0].code).toBe('rule_not_established');
    expect(a.missing[0].message).toMatch(/has not been measured/);
  });

  it('carries the observed refusal when the injury is no longer than the one that was refused', () => {
    const a = rights({ il: true, active: false, injuryDaysLeft: 7 }).actions.placeOnSixtyDayIl;
    expect(a.status).toBe('indeterminate');
    expect(codes(a)).toEqual(['sixty_day_leaves_forty_man', 'at_or_below_observed_refusal']);
  });

  it('is ineligible when there is nothing to list: already on it, not on the 40-man, or not injured', () => {
    expect(codes(rights({ il60: true, active: false, forty: false, injuryDaysLeft: 40 }).actions.placeOnSixtyDayIl)).toEqual(['already_sixty_day']);
    expect(codes(rights({ il: true, active: false, forty: false, injuryDaysLeft: 40 }).actions.placeOnSixtyDayIl)).toEqual(['not_on_forty_man']);
    const healthy = rights({}).actions.placeOnSixtyDayIl;
    expect(healthy.status).toBe('ineligible');
    expect(codes(healthy)).toEqual(['no_injury_to_list']);
    expect(healthy.limitation).toMatch(/one observed refusal/);
  });

  it('a stale export or an unknown injury leaves it indeterminate', () => {
    expect(rights({ il: true, injuryDaysLeft: 50 }, { evidence: { currentState: 'behind', chronology: 'current' } }).actions.placeOnSixtyDayIl.status).toBe('indeterminate');
  });

  it('never returns eligible from what has been observed', () => {
    for (const days of [1, 7, 8, 30, 60, 120]) {
      expect(rights({ il: true, active: false, injuryDaysLeft: days }).actions.placeOnSixtyDayIl.status).not.toBe('eligible');
    }
  });
});
