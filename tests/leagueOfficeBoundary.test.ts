import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * League Office's and Scouting's readers, pinned (N12 Track B review, L9; D-017, D-060): each reader's own imports are
 * listed here, so a new one is a deliberate change seen in review. The postseason odds and the deadline posture
 * (`posture`, `playoffs`) reach only Standings' reader; the ratings (`scoutedEvidence`, a rating module) reach only
 * Scouting's reader, which grades the draft class through the scouted evidence. The adapters they hand data to import
 * neither (`presentationBoundary.test.ts`).
 */

const SERVER = path.join(process.cwd(), 'server');

/** A module's own imports (static and dynamic), as the names of the server modules they are (`./presentation/x.js` → `presentation/x`). */
function importsOf(file: string): string[] {
  const source = fs.readFileSync(path.join(SERVER, file), 'utf8');
  const found = [...source.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)].map((m) => m[1]);
  return [...new Set(found.map((s) => s.replace(/^\.\//, '').replace(/\.js$/, '')))].sort();
}

const PINNED: Record<string, string[]> = {
  'leagueStandingsViews.ts': [
    'computed', 'dashboard', 'db', 'frontOffice/clubProfile', 'frontOffice/teamSeason', 'league', 'playoffs', 'posture',
    'presentation/league/common', 'presentation/league/standings', 'presentation/league/types', 'presentation/league/usVsThem', 'schedule',
  ],
  'leagueHistoryViews.ts': [
    'contract/presentation', 'dataStatus', 'franchise', 'gameplan', 'org', 'playerValue', 'presentation/league/common',
    'presentation/league/franchise', 'presentation/league/orgComparison', 'presentation/league/types',
  ],
  'leagueLeadersViews.ts': ['db', 'presentation/league/common', 'presentation/league/leaders', 'presentation/league/types', 'rosterops'],
  'scoutingViews.ts': [
    'db', 'league', 'positionNeeds', 'presentation/league/common', 'presentation/scouting/draftBoard', 'presentation/scouting/playerSearch',
    'presentation/scouting/types', 'rosterops', 'scoutedEvidence', 'search', 'settings', 'valuation',
  ],
  'leagueViewsBuild.ts': [
    'contract/presentation', 'dataStatus', 'leagueHistoryViews', 'leagueLeadersViews', 'leagueStandingsViews', 'org', 'presentation/catalog',
    'presentation/frontOffice/desk', 'presentation/league/common', 'presentation/league/types', 'presentation/scouting/types', 'scoutingViews',
  ],
  'leagueViewService.ts': [
    'db', 'frontOfficeService', 'leagueViewsBuild', 'playerStateRoutes', 'presentation/claim', 'presentation/league/types',
    'presentation/scouting/draftBoard', 'presentation/scouting/types', 'scoutingViews', 'viewingOrganization',
  ],
};

const ODDS = /^(?:posture|playoffs)$/;
const RATINGS = /^(?:scoutedEvidence|ratings\w*|\w*[Rr]atings?)$/;

describe('League Office\'s and Scouting\'s readers import only what they are pinned to (review, L9)', () => {
  it.each(Object.keys(PINNED))('%s imports exactly its pinned modules', (file) => {
    expect(importsOf(file)).toEqual([...PINNED[file]].sort());
  });

  it('lets the odds and the posture reach only Standings\' reader (D-060)', () => {
    const reaching = Object.keys(PINNED).filter((file) => importsOf(file).some((m) => ODDS.test(m)));
    expect(reaching).toEqual(['leagueStandingsViews.ts']);
  });

  it('lets the ratings reach only Scouting\'s reader, through the scouted evidence (D-017, D-067)', () => {
    const reaching = Object.keys(PINNED).filter((file) => importsOf(file).some((m) => RATINGS.test(m)));
    expect(reaching).toEqual(['scoutingViews.ts']);
    expect(importsOf('scoutingViews.ts').filter((m) => RATINGS.test(m))).toEqual(['scoutedEvidence']);
  });

  it('keeps the adapters free of both: they word what the readers hand them', () => {
    const adapters = ['presentation/league', 'presentation/scouting'].flatMap((dir) =>
      fs.readdirSync(path.join(SERVER, dir)).filter((f) => f.endsWith('.ts')).map((f) => `${dir}/${f}`));
    expect(adapters.length).toBeGreaterThan(8);
    for (const file of adapters) {
      const names = importsOf(file).map((m) => m.split('/').pop()!);
      expect(names.filter((m) => ODDS.test(m) || RATINGS.test(m)), file).toEqual([]);
    }
  });
});
