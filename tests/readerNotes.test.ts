import { describe, expect, it } from 'vitest';
import { leagueRulesFromRow, type LeagueRuleRow } from '../server/leagueRules';
import { clubFinancesOf, type ClubFinances } from '../server/playerValueFinances';
import { fromExport, type Sourced } from '../server/provenance';
import { CODE_TEXT, PROVENANCE, bannedIn } from './bannedJargon';
import { MLB, contractRow, factsOf, majorLeagueRow, minorLeagueRow, tablesOf } from './playerValueFixtures';
import { CONTRACT_COLUMNS } from '../server/playerValueContract';

/**
 * A reader's note on a column the export lacks or leaves blank is served (B-11; batch 13 review, M1): it reaches the
 * price's and the cost's "not established (...)" lines, Player Rights' service reason and Payroll's cards. It is said
 * in words ("This league setting is blank in the export"); the column stays in the source, the developer's locator.
 * The synthetic save has every column, so neither the fixture walk nor the contract walk reaches these notes: each
 * reader is run here on a row with a column missing and one with it blank.
 */

const notesOf = (value: unknown): string[] => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'note' && typeof v === 'string') out.push(v);
        else walk(v);
      }
    }
  };
  walk(value);
  return out;
};

const coded = (notes: string[]): Array<{ note: string; pattern: string }> =>
  notes.flatMap((note) => bannedIn(note, [CODE_TEXT, PROVENANCE]).map((p) => ({ note, pattern: String(p) })));

const unknownNote = (s: Sourced<unknown>): string => {
  expect(s.value, s.source).toBeNull();
  return s.note ?? '';
};

describe('league rules: a missing or blank setting is said in words', () => {
  it('a missing column, a blank value and an unusable value', () => {
    const row = majorLeagueRow({ rules_minimum_salary: null, rules_min_service_days: 0 }) as Record<string, unknown>;
    delete row.rules_fa_minimum_years;
    const rules = leagueRulesFromRow(row as LeagueRuleRow, new Set(Object.keys(row)));
    const notes = [
      unknownNote(rules.contract.minimumSalary), unknownNote(rules.contract.freeAgencyYears),
      unknownNote(rules.contract.serviceDaysPerYear), unknownNote(rules.gamesPerTeam),
    ];
    expect(notes).toContain('This league setting is blank in the export.');
    expect(notes).toContain('The export does not carry this league setting.');
    expect(coded(notes)).toEqual([]);
    expect(coded(notesOf(rules))).toEqual([]);
  });

  it('a parent chain the export does not carry, leaves blank, loops or breaks', () => {
    const minor = minorLeagueRow(204, MLB) as Record<string, unknown>;
    const cases: Array<{ row: LeagueRuleRow; present: Set<string>; lookup: (id: number) => LeagueRuleRow | null }> = [
      // No parent column at all
      (() => { const r = { ...minor }; delete r.parent_league_id; return { row: r as LeagueRuleRow, present: new Set(Object.keys(r)), lookup: () => null }; })(),
      // Blank
      { row: { ...minor, parent_league_id: null } as LeagueRuleRow, present: new Set(Object.keys(minor)), lookup: () => null },
      // A parent with no row
      { row: { ...minor, parent_league_id: 555 } as LeagueRuleRow, present: new Set(Object.keys(minor)), lookup: () => null },
      // A loop
      { row: minor as LeagueRuleRow, present: new Set(Object.keys(minor)), lookup: (id) => (id === MLB ? ({ ...majorLeagueRow(), parent_league_id: 204 } as LeagueRuleRow) : (minor as LeagueRuleRow)) },
    ];
    for (const c of cases) {
      const rules = leagueRulesFromRow(c.row, c.present, c.lookup);
      const notes = notesOf(rules);
      expect(rules.contract.minimumSalary.value).toBeNull();
      expect(coded(notes)).toEqual([]);
    }
    // No table, no row
    expect(coded(notesOf(leagueRulesFromRow(null, null)))).toEqual([]);
    expect(coded(notesOf(leagueRulesFromRow(null, new Set(Object.keys(minor)))))).toEqual([]);
  });
});

describe('club finances: a missing table, row, column or figure is said in words', () => {
  const MONEY = { team_id: 1, year: 2026, total_revenue: 250e6, total_expenses: 200e6, budget: 240e6, gate_revenue: 60e6, media_revenue: 90e6 };
  const finances = (current: { present: Set<string> | null; row: Record<string, unknown> | null }, history: Array<Record<string, unknown>> = []): ClubFinances =>
    clubFinancesOf({
      teamId: 1, season: 2026, financials: fromExport(true, 'leagues.rules_financials'),
      current, last: { present: null, row: null }, history: { present: history.length ? new Set(Object.keys(history[0])) : null, rows: history },
    });

  it('a blank figure and a missing column', () => {
    const row: Record<string, unknown> = { ...MONEY, budget: null };
    delete row.total_expenses;
    const club = finances({ present: new Set(Object.keys(row)), row }, [{ ...MONEY, year: 2025, total_revenue: null }]);
    const notes = [unknownNote(club.budget), unknownNote(club.expenses), ...notesOf(club)];
    expect(notes).toContain('This figure is blank in the export.');
    expect(notes).toContain('The export does not carry this figure.');
    expect(coded(notes)).toEqual([]);
  });

  it('no table and no row for the club', () => {
    const noTable = finances({ present: null, row: null });
    const noRow = finances({ present: new Set(Object.keys(MONEY)), row: null });
    expect(unknownNote(noTable.budget)).toBe("This season's club finances are not in the export.");
    expect(unknownNote(noRow.budget)).toBe("This season's club finances have no row for this club.");
    expect(coded([...notesOf(noTable), ...notesOf(noRow)])).toEqual([]);
  });
});

describe('a contract: a salary season the export lacks or leaves blank is said in words', () => {
  it('a blank salary and a salary column the export does not carry', () => {
    const blank = { ...contractRow({ years: 3 }), salary1: null };
    const lacking = contractRow({ years: 3 });
    const tables = tablesOf();
    const short = { ...tables, contract: new Set(CONTRACT_COLUMNS.filter((c) => c !== 'salary2')) };
    const a = factsOf(blank);
    const b = factsOf(lacking, { tables: short });
    const notes = [unknownNote(a.term!.seasons[1].salary), unknownNote(b.term!.seasons[2].salary), ...notesOf(a), ...notesOf(b)];
    expect(notes).toContain("This season's salary is blank in the export.");
    expect(notes).toContain('The export carries no salary for this season of the contract.');
    expect(coded(notes)).toEqual([]);
  });
});
