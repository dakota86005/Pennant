import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { leadersUnread, leadersViewOf } from '../server/leagueLeadersViews.js';
import { officeContextFor } from '../server/leagueViewsBuild.js';
import type { OfficeContext } from '../server/presentation/league/common.js';
import type { LeagueLeadersView } from '../server/presentation/league/types.js';
import { computeLeaderboards, leaderQualifier, type Leaderboards } from '../server/rosterops.js';
import { bannedInPayload } from './bannedJargon';
import request from './request.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * League Office's Leaders (N12 Track B, D-072): the league's top ten in each category, worded from what the React page's
 * route computes (`computeLeaderboards`), in its order, our players marked, every row opening its player.
 */

let save: BuiltSave;
let v: OfficeContext;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true });
  v = officeContextFor({ orgId: save.org, importStamp: null, reportStamp: 'r1' }, 'league');
}, 120_000);

afterAll(() => {
  db.prepare('UPDATE leagues SET season_year = 2040 WHERE league_id = ?').run(save.leagueId);
});

/** Every visible string in a payload (`display`, `text`, `hint`). */
function visible(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(visible);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) => (typeof x === 'string' && ['display', 'text', 'hint'].includes(k) ? [x] : visible(x)));
}

const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\bcontend/i, /\brebuild/i];

const body = (): Leaderboards => {
  const c = computeLeaderboards(save.org);
  if (!c.ok) throw new Error(c.error);
  return c.body;
};

describe('the leaderboards route, extracted (N12)', () => {
  it('sends exactly what computeLeaderboards computes, for the club, an unknown club and an export without lines', async () => {
    expect(await request(`/api/leaderboards/${save.org}`)).toEqual(JSON.parse(JSON.stringify(body())));
    const res = await fetch(`${process.env.OOTP_FO_PORT ? `http://127.0.0.1:${process.env.OOTP_FO_PORT}` : ''}/api/leaderboards/99999`);
    const unknown = computeLeaderboards(99999);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(res.status).toBe(unknown.status);
      expect(await res.json()).toEqual({ error: unknown.error });
    }
  });

  it('works out who qualifies from the club\'s games, as the page always has: 3.1 plate appearances and an inning a game', () => {
    const q = leaderQualifier(save.org);
    const g = (db.prepare('SELECT g FROM team_record WHERE team_id = ?').get(save.org) as { g: number }).g;
    expect(q).toEqual({ games: g, gamesFromExport: true, minPA: Math.round(g * 3.1), minOuts: Math.round(g * 3) });
    expect(body().minPA).toBe(q.minPA);
    expect(body().minIP).toBe(Math.round(q.minOuts / 3));
  });
});

describe('Leaders says what the route computed (N12)', () => {
  let view: LeagueLeadersView;
  beforeAll(() => {
    view = leadersViewOf(v, save.org);
  });

  it('serves every category of the route, batting then pitching, in the route\'s order with its figures', () => {
    const b = body();
    expect(view.groups.map((g) => g.id)).toEqual(['batting', 'pitching']);
    for (const g of view.groups) {
      const route = g.id === 'batting' ? b.batting : b.pitching;
      expect(g.sections.map((s) => s.id.split('.')[1])).toEqual(Object.keys(route));
      for (const s of g.sections) {
        const leaders = (route as Record<string, Leaderboards['batting']['AVG']>)[s.id.split('.')[1]];
        expect(s.table.columns.map((c) => c.id)).toEqual(['rank', 'player', 'club', 'value']);
        expect(s.table.rows.map((r) => r.player?.playerId)).toEqual(leaders.map((l) => l.player_id));
        expect(s.table.rows.map((r) => r.cells.rank.display)).toEqual(leaders.map((_, i) => String(i + 1)));
        s.table.rows.forEach((r, i) => {
          const value = leaders[i].value;
          if (value === null || value === undefined) {
            expect(r.cells.value.display).toBe('Not known');
            expect(r.sort.value).toBeNull();
          } else {
            expect(r.cells.value.display).toBe(String(value));
            expect(typeof r.sort.value).toBe('number');
          }
          // Every row opens its player
          expect(r.player?.open).toMatchObject({ kind: 'player', playerId: leaders[i].player_id });
        });
      }
    }
    expect(view.groups[0].sections.reduce((n, s) => n + s.table.rows.length, 0)).toBeGreaterThan(0);
  });

  it('marks our players, and names their club as ours in words (never colour alone)', () => {
    const b = body();
    const rows = view.groups.flatMap((g) => g.sections.flatMap((s) => s.table.rows));
    const ours = [...Object.values(b.batting), ...Object.values(b.pitching)].flat().filter((l) => l.isOrg).length;
    expect(ours).toBeGreaterThan(0);
    expect(rows.filter((r) => r.ours).length).toBe(ours);
    for (const r of rows.filter((x) => x.ours)) expect(r.cells.club.hint).toBe('Your club');
    for (const r of rows.filter((x) => !x.ours)) expect(r.cells.club.hint).toBeUndefined();
  });

  it('says who qualifies, with how it is worked out in its basis, and which tables count qualified players only', () => {
    const b = body();
    expect(view.qualifier?.text).toBe(`Rate leaders need ${b.minPA}+ plate appearances or ${b.minIP}+ innings`);
    expect(view.qualifier?.basis.because.map((l) => l.label)).toEqual(['Hitters', 'Pitchers', 'Which leaders']);
    expect(view.qualifier?.basis.certainty).toBe('policy');
    const summary = (id: string) => view.groups.flatMap((g) => g.sections).find((s) => s.id === id)?.summary?.display ?? null;
    expect(summary('batting.AVG')).toBe(`Qualified hitters only: ${b.minPA}+ plate appearances`);
    expect(summary('pitching.ERA')).toBe(`Lowest first · Qualified pitchers only: ${b.minIP}+ innings`);
    expect(summary('batting.HR')).toBeNull();
  });

  it('names the season and the league from the league\'s own row, and no season when the row states none', () => {
    expect(view.season?.display).toBe('2040');
    expect(view.lede.text).toBe('2040 Fictional League leaders: the top ten in each category, your players marked');
    db.prepare('UPDATE leagues SET season_year = NULL WHERE league_id = ?').run(save.leagueId);
    try {
      const without = leadersViewOf(v, save.org);
      expect(without.season).toBeNull();
      expect(without.lede.text).not.toMatch(/\d{4}/);
    } finally {
      db.prepare('UPDATE leagues SET season_year = 2040 WHERE league_id = ?').run(save.leagueId);
    }
  });

  it('says the route\'s refusal in words, and a part that could not be read', () => {
    const unknown = leadersViewOf(v, 99999);
    expect(unknown.groups).toEqual([]);
    expect(unknown.empty?.display).toBe('This club isn\'t in the export.');
    const unread = leadersUnread(v, 'The league leaders couldn\'t be read this time');
    expect(unread.empty?.display).toBe('The league leaders couldn\'t be read this time.');
    expect(bannedInPayload(unknown)).toEqual([]);
    expect(bannedInPayload(unread)).toEqual([]);
  });

  it('carries no jargon, no grade and no odds or posture words', () => {
    expect(bannedInPayload(view)).toEqual([]);
    const words = visible(view).join('\n');
    for (const p of ODDS_OR_POSTURE) expect(words).not.toMatch(p);
    expect(JSON.stringify(view)).not.toMatch(/ratingsFill/);
  });

  it('reads no rating, in the reader or its adapter', () => {
    for (const file of ['server/leagueLeadersViews.ts', 'server/presentation/league/leaders.ts']) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/_ratings_|fielding_rating|players_value|\boa\b|\bpot\b|overall_value|talent_value|scoutedEvidence/);
    }
  });
});
