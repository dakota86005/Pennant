import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearImportCaches } from '../server/importCache.js';
import { clearProductionCaches } from '../server/playerValue.js';
import { buildPlayerDossiers } from '../server/playerDossierBuild.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import type { PlayerDossierView } from '../server/presentation/player/types.js';
import { bannedInPayload, servedStrings } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * A contract with an opt-out, through the player window (batch 13 review, M2): the opt-out is said in words ("he may
 * opt out before 2042"), never by its export column, in the control season's line, the cone's notes and every other
 * served string. No synthetic player has an opt-out, so the fixture walk never reaches this path; this case does.
 */

let save: BuiltSave;
let view: PlayerDossierView;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 2, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true });
  // A four-season deal signed this season, the opt-out read as after its second year (so before 2042)
  db.prepare(`UPDATE players_contract SET season_year = 2040, years = 4, current_year = 0, opt_out = 2,
    salary0 = 8000000, salary1 = 8000000, salary2 = 8000000, salary3 = 8000000 WHERE player_id = ?`).run(save.regular);
  clearImportCaches();
  clearProductionCaches();
  resetFrontOfficeCache();
  const built = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [save.regular] });
  view = built.views[0];
}, 120_000);

describe('an opt-out on the player window is said in words, never by its column (B-11)', () => {
  it('reaches the window: the seasons after it show both branches and say he may opt out', () => {
    expect(view, 'the regular has a window').toBeDefined();
    const texts = servedStrings(view).map((s) => s.text);
    expect(texts.some((t) => /may opt out before 2042/.test(t)), 'the opt-out is served').toBe(true);
  });

  it('serves no column name, code or provenance anywhere on the window', () => {
    expect(servedStrings(view).filter((s) => /opt_out/.test(s.text))).toEqual([]);
    expect(bannedInPayload(view, 'getPlayerDossier')).toEqual([]);
  });
});
