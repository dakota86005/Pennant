import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { frontOfficeSummaryNow } from '../server/frontOfficeAttention.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { glanceNow, spotlightNow } from '../server/glanceService.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { GLANCE_DESK_ITEMS, glanceWords } from '../server/presentation/frontOffice/glance.js';
import type { FrontOfficeSummary } from '../server/presentation/frontOffice/types.js';
import { forgetSearchIndex } from '../server/search.js';
import { shownStrings } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * Pennant outside its windows (BEHAVIOR_CASES.md "Pennant for Mac", the N14 rows; D-075): the glance the widget and the
 * menu bar extra show is the Morning Report's own parts and words, the desk counted as the Dock's badge counts it; the
 * list Spotlight is given is our organization's players and the league's clubs, in the search's words, nothing more.
 */
describe('Pennant at a glance and in Spotlight (N14)', () => {
  let save: BuiltSave;
  let summary: FrontOfficeSummary;
  const realStamp = importedAt.value;

  beforeAll(async () => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, minors: true, teamSeason: true });
    importedAt.value = '2040-05-06T10:00:00.000Z';
    resetFrontOfficeCache();
    forgetSearchIndex();
    summary = await frontOfficeSummaryNow(save.org);
  }, 60_000);
  afterAll(() => {
    importedAt.value = realStamp;
  });

  it('serves the Morning Report\'s record, next game and desk, as served there', async () => {
    const glance = await glanceNow(save.org);
    expect(glance.orgId).toBe(save.org);
    expect(glance.record).toEqual(summary.teamSeason!.record);
    expect(glance.record?.value?.display).toMatch(/^\d+–\d+$/);
    const tonight = summary.teamSeason!.tonight;
    if (tonight) expect(glance.nextGame).toEqual({ when: tonight.when, matchup: tonight.matchup, claim: tonight.claim, open: tonight.open });
    else expect(glance.missing.length).toBeGreaterThan(0);
    expect(glance.desk.count).toBe(summary.desk.openCount);
    expect(glance.desk.top.map((t) => t.key)).toEqual(summary.desk.items.slice(0, GLANCE_DESK_ITEMS).map((i) => i.key));
    expect(glance.desk.top.every((t, i) => t.headline === summary.desk.items[i].headline || JSON.stringify(t.headline) === JSON.stringify(summary.desk.items[i].headline))).toBe(true);
    expect(glance.asOf).toEqual(summary.asOf);
    expect(glance.open).toEqual({ kind: 'view', department: 'frontOffice', view: 'morningReport' });
    expect(glance.deskStamp).toBe(summary.deskStamp);
  });

  it('names each desk item\'s department as the catalog does, never by its id', async () => {
    const glance = await glanceNow(save.org);
    for (const item of glance.desk.top) expect(item.department.display).not.toMatch(/^[a-z]+[A-Z]/);
  });

  it('words the desk\'s count, and says a floor when a department could not be read', () => {
    const names = () => 'Major League Ops';
    const withDesk = (openCount: number, incomplete: boolean): FrontOfficeSummary => ({
      ...summary,
      desk: { ...summary.desk, openCount, incomplete: incomplete ? { display: 'Farm & Development could not be read' } : null },
    });
    expect(glanceWords(withDesk(3, false), names).desk.line.display).toBe('3 to decide');
    expect(glanceWords(withDesk(1, false), names).desk.line.display).toBe('1 to decide');
    expect(glanceWords(withDesk(0, false), names).desk.line.display).toBe('Nothing to decide');
    expect(glanceWords(withDesk(2, true), names).desk.line.display).toBe('At least 2 to decide');
    expect(glanceWords(withDesk(0, true), names).desk.line.display).toBe('Nothing to decide from the departments read');
    // The count is the served one, never recounted from the items shown
    expect(glanceWords(withDesk(9, false), names).desk.count).toBe(9);
  });

  it('says why the record or the next game is missing rather than leaving a blank (D-018)', () => {
    const season = summary.teamSeason!;
    const bare: FrontOfficeSummary = {
      ...summary,
      teamSeason: {
        ...season, record: null, tonight: null,
        missing: [{ part: 'record', line: { display: 'The standings aren\'t in the export' } }, { part: 'tonight', line: { display: 'No game ahead in the export' } }],
      },
    };
    const glance = glanceWords(bare, () => 'Front Office');
    expect(glance.record).toBeNull();
    expect(glance.nextGame).toBeNull();
    expect(glance.missing.map((m) => m.display)).toEqual(['The standings aren\'t in the export', 'No game ahead in the export']);
  });

  it('shows no odds, posture or window label (D-060)', async () => {
    const shown = shownStrings([await glanceNow(save.org)]).join('\n');
    expect(shown).not.toMatch(/postseason|playoff|\bodds\b|\bposture\b|\bbuy(?:er|ing)?\b|\bsell(?:er|ing)?\b|contend|rebuild/i);
  });

  it('gives Spotlight our organization\'s players at every level the search holds, and the league\'s clubs', () => {
    const list = spotlightNow(save.org);
    const ours = db.prepare(`SELECT COUNT(*) AS n FROM players WHERE organization_id = ? AND COALESCE(retired, 0) = 0`).get(save.org) as { n: number };
    expect(list.players.length).toBe(ours.n);
    expect(list.players.every((p) => p.kind === 'player' && p.open.kind === 'player' && p.open.teamId === save.org)).toBe(true);
    // The farm too, as the search offers it
    expect(list.players.some((p) => !/Majors/.test(p.line))).toBe(true);
    expect(list.clubs.map((c) => Number(c.id)).sort((a, b) => a - b)).toEqual([...save.clubs].sort((a, b) => a - b));
    // By name, as stated; names, positions and clubs only
    const names = list.players.map((p) => p.title);
    expect(names).toEqual([...names].sort(new Intl.Collator('en', { sensitivity: 'base' }).compare));
    expect(JSON.stringify({ players: list.players, clubs: list.clubs })).not.toMatch(/rating|value|potential/i);
  });
});
