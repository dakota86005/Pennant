import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every Office table the Mac app draws with its chosen row's detail beneath it (`OfficeTablePane`) serves the sentence it
 * shows while no row is chosen (`choose`): the app writes no sentence of its own (D-056). Read from the committed contract
 * fixtures, so a view that starts serving such a table without it fails here.
 */
const FIXTURES = join(__dirname, '..', 'contract', 'fixtures', 'responses');

type Table = { rows: unknown[]; choose?: { display: string } };
type View = Record<string, any>;
const sections = (list: View[] | null | undefined): Table[] => (list ?? []).map((s) => s.table as Table);

/** Each view's tables that the app draws in an `OfficeTablePane`, as its Swift view picks them. */
const PANES: Record<string, (v: View) => Table[]> = {
  getLeagueStandings: (v) => [...(v.all ? [v.all.table] : []), ...(v.groups ?? []).flatMap((g: View) => sections(g.divisions))],
  getLeagueLeaders: (v) => (v.groups ?? []).flatMap((g: View) => sections(g.sections)),
  getLeagueUsVsThem: (v) => sections(v.sections),
  getLeagueOrgComparison: (v) => [v.clubs],
  getLeagueFranchiseHistory: (v) => [v.seasons.table, ...(v.tenure ? [v.tenure.seasons.table] : [])],
  'getScoutingDraftBoard-published': (v) => [v.board],
  getScoutingPlayerSearch: (v) => [v.results],
  getFinanceContracts: (v) => [v.table],
  getFinancePayroll: (v) => [v.contracts],
  getFinanceFreeAgents: (v) => (v.lists ?? []).map((l: View) => l.table),
  getMedicalInjuryReport: (v) => [v.table],
};

describe('Office tables drawn with a detail pane', () => {
  it.each(Object.keys(PANES))('%s serves what its pane says while no row is chosen', (name) => {
    const view = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as View;
    const tables = PANES[name](view);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table.choose).toEqual({ display: 'Select a row to see more.' });
  });

  it('is served by the fixtures with rows in them, so the sentence is the one the GM sees', () => {
    const withRows = Object.entries(PANES).flatMap(([name, pick]) =>
      pick(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as View).filter((t) => t.rows.length > 0));
    expect(withRows.length).toBeGreaterThan(5);
  });
});
