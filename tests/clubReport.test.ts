import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { forgetHistoryKey } from '../server/historyIdentity.js';
import { clubReportNow } from '../server/aroundTheLeague.js';
import { forgetMemoryCaches } from '../server/frontOfficeMemory.js';
import { afterImport, resetAttention, rivalsWarmed } from '../server/frontOfficeAttention.js';
import { frontOfficeStats, frontOfficeSummary, holdFrontOfficeRebuilds, invalidateFrontOffice, resetFrontOfficeCache, warmClubReports } from '../server/frontOfficeService.js';
import { forgetWire } from '../server/leagueWire.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { readClubReport } from '../server/clubReport.js';
import { getDataStatus } from '../server/dataStatus.js';
import { clubReportWords } from '../server/presentation/frontOffice/clubReport.js';
import { buildSave, dropColumn, type BuiltSave } from './syntheticSave';

/**
 * A club report for any club (BEHAVIOR_CASES.md "Pennant for Mac", `clubReport.test.ts`, case 19; D-059): the same modules
 * as ours, under our organization's scouting, with objective facts about the two clubs, and no odds or posture (D-060).
 */

const settle = () => new Promise((resolve) => setImmediate(resolve));

const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\bcontend/i, /\brebuild/i, /\bthreat/i];

describe('another club\'s report (case 19)', () => {
  let save: BuiltSave;
  let them = 0;
  const realStamp = importedAt.value;

  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    them = save.clubs.find((c) => c !== save.org)!;
  });
  afterAll(() => {
    importedAt.value = realStamp;
  });
  beforeEach(() => {
    forgetHistoryKey();
    forgetMemoryCaches();
    forgetWire();
    resetFrontOfficeCache();
    importedAt.value = '2040-05-06T10:00:00.000Z';
  });

  it('is built by the same modules as our Morning Report: the same record, places and roster map the club would see as its own', async () => {
    const report = await clubReportNow(String(them));
    const asOurs = await frontOfficeSummary(them);
    expect(report.teamSeason!.record!.text).toBe(asOurs.teamSeason!.record!.text);
    expect(report.clubProfile!.dimensions.map((d) => [d.id, d.place])).toEqual(asOurs.clubProfile!.dimensions.map((d) => [d.id, d.place]));
    expect(report.rosterMap!.positions.map((p) => [p.pos, p.holder?.playerId ?? null, p.value?.likely ?? null]))
      .toEqual(asOurs.rosterMap!.positions.map((p) => [p.pos, p.holder?.playerId ?? null, p.value?.likely ?? null]));
    // Where our report says "us", theirs names the club it is about
    const standing = report.teamSeason!.place!.claim.basis.because.map((b) => b.label).join(' ');
    expect(standing).toMatch(/\(this club\)/);
    expect(standing).not.toMatch(/\(us\)/);
    expect(report.ours).toBe(false);
  });

  it('reads their players through our scouting and says what our scouts can\'t see, filling nothing in', async () => {
    const full = await clubReportNow(String(them));
    const players = Number(full.scouting.basis.because.find((b) => b.label === 'Players on the club')!.value);
    expect(full.scouting.text).toMatch(new RegExp(`all ${players} players|of ${players} players`));
    // Our scouts lose sight of one of their hitters: his tools are no longer in the export
    const hidden = (db.prepare(`SELECT player_id FROM players WHERE team_id = ? AND position <> 1 LIMIT 1`).get(them) as { player_id: number }).player_id;
    const saved = db.prepare(`SELECT batting_ratings_overall_contact AS c FROM players_batting WHERE player_id = ?`).get(hidden) as { c: number };
    db.prepare(`UPDATE players_batting SET batting_ratings_overall_contact = 0 WHERE player_id = ?`).run(hidden);
    resetFrontOfficeCache();
    const partial = await clubReportNow(String(them));
    expect(partial.scouting.text).toBe(`Our scouts have a full report on ${players - 1} of ${players} players`);
    expect(partial.scouting.basis.unknown.join(' ')).toMatch(/what they can't see is left out, never filled in/);
    expect(partial.scouting.basis.because).toContainEqual({ label: 'The same as ours', value: 'Every club\'s players are read through our organization\'s scouting, never the game\'s own ratings.' });
    db.prepare(`UPDATE players_batting SET batting_ratings_overall_contact = ? WHERE player_id = ?`).run(saved.c, hidden);
  });

  it('states their record against us and their next series with us from the export\'s games', async () => {
    const report = await clubReportNow(String(them));
    const games = db.prepare(`SELECT home_team, runs0, runs1 FROM games WHERE played = 1 AND game_type = 0 AND ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?))`)
      .all(them, save.org, save.org, them) as Array<{ home_team: number; runs0: number; runs1: number }>;
    const won = games.filter((g) => (g.home_team === them ? g.runs1 > g.runs0 : g.runs0 > g.runs1)).length;
    const lost = games.filter((g) => (g.home_team === them ? g.runs1 < g.runs0 : g.runs0 < g.runs1)).length;
    expect(report.headToHead!.text).toMatch(new RegExp(`^${won}–${lost}(–\\d+)? against the `));
    expect(report.nextSeries ?? report.nextSeriesNote).not.toBeNull();
    if (report.nextSeries) expect(report.nextSeries.text).toMatch(/^\d+ games? from .+, in (our park|theirs)$/);
  });

  it('ranks nothing and reads the club as no buyer, seller or threat (D-060)', async () => {
    const report = await clubReportNow(String(them));
    const text = JSON.stringify(report);
    for (const p of ODDS_OR_POSTURE) expect(text, String(p)).not.toMatch(p);
  });

  it('is built once for an import and kept, and our own club\'s report says it is ours', async () => {
    await clubReportNow(String(them));
    const built = frontOfficeStats().clubBuilds;
    await clubReportNow(String(them));
    expect(frontOfficeStats().clubBuilds).toBe(built);
    expect(frontOfficeStats().clubHits).toBeGreaterThan(0);
    const ours = await clubReportNow(String(save.org));
    expect(ours.ours).toBe(true);
    expect(ours.headToHead).toBeNull();
    expect(ours.headToHeadNote).toBeNull();
  });

  it('says why there is no record against us when there is none, never nothing (L7)', () => {
    const status = getDataStatus({ importedAt: importedAt.value });
    const build = { orgId: them, club: 'Them', importStamp: importedAt.value, reportStamp: 'r1', gameDate: null, subject: 'theirs' as const };
    const material = readClubReport(them, save.org, status);
    expect(clubReportWords(build, material, 'Us', null).headToHeadNote).toBeNull();
    // Our club not known yet
    const noClub = clubReportWords(build, readClubReport(them, null, status), null, null);
    expect(noClub.headToHead).toBeNull();
    expect(noClub.headToHeadNote).toMatchObject({ display: 'Their record against your club shows once your club is chosen', tone: 'unknown' });
    // The export without its games: the reason in the hint
    const noGames = clubReportWords(build, { ...material, headToHead: null, nextSeries: null, scheduleWhy: 'Not in the export: games.runs0' }, 'Us', null);
    expect(noGames.headToHeadNote).toMatchObject({ display: "Their record against the Us isn't known", tone: 'unknown', hint: 'Not in the export: games.runs0' });
  });

  it('has our division\'s reports built ahead once per import, after the refits\' hold, never again for a rebuild of the same import (M5)', async () => {
    resetAttention();
    // The refits after an import hold the rebuilds: the rivals wait for them
    const release = holdFrontOfficeRebuilds();
    const before = frontOfficeStats().clubBuilds;
    await afterImport();
    await settle();
    expect(frontOfficeStats().clubBuilds).toBe(before);
    release();
    await rivalsWarmed();
    const ahead = frontOfficeStats().clubBuilds;
    expect(ahead).toBe(before + save.clubs.length - 1);
    await clubReportNow(String(them));
    expect(frontOfficeStats().clubBuilds).toBe(ahead);

    // A rebuild of the same import (Player Value's adopted refit, a new copy of the live log) warms nothing again: a
    // rival's report is built when opened
    invalidateFrontOffice();
    await afterImport();
    await rivalsWarmed();
    expect(frontOfficeStats().clubBuilds).toBe(ahead);
    await clubReportNow(String(them));
    expect(frontOfficeStats().clubBuilds).toBe(ahead + 1);
  });

  it('stops building an import\'s rivals ahead once a newer import is served (its own warm-up builds them)', async () => {
    invalidateFrontOffice();
    const before = frontOfficeStats().clubBuilds;
    const stamp = importedAt.value;
    const rivals = save.clubs.filter((c) => c !== save.org);
    const warm = warmClubReports(rivals, save.org, () => importedAt.value === stamp);
    await settle();
    importedAt.value = '2040-05-07T10:00:00.000Z';
    await warm;
    expect(frontOfficeStats().clubBuilds - before).toBeLessThan(rivals.length);
    importedAt.value = stamp;
  });

  it('builds a rival\'s report ahead only after our own Front Office\'s build that is running (M5)', async () => {
    invalidateFrontOffice();
    const before = frontOfficeStats().clubBuilds;
    const ours = frontOfficeSummary(save.org);
    const warm = warmClubReports([them], save.org);
    await ours;
    expect(frontOfficeStats().clubBuilds).toBe(before);
    await warm;
    expect(frontOfficeStats().clubBuilds).toBe(before + 1);
  });

  it('says an injured list or a list of players the export lacks isn\'t known, never "nobody" (D-018)', () => {
    const status = getDataStatus({ importedAt: importedAt.value });
    const build = { orgId: them, club: 'Them', importStamp: importedAt.value, reportStamp: 'r1', gameDate: null, subject: 'theirs' as const };
    // A column the injured list is read from is missing: the reader names it, the words say it isn't known
    dropColumn('players_roster_status', 'dl_days_this_year');
    const material = readClubReport(them, save.org, status);
    expect(material.injuriesWhy).toBe('Not in the export: players_roster_status.dl_days_this_year');
    const words = clubReportWords(build, material, 'Us', null);
    expect(words.injuries).toEqual([]);
    expect(words.injuriesNote).toMatchObject({ display: 'Their injured list isn\'t in this export', tone: 'unknown', hint: 'Not in the export: players_roster_status.dl_days_this_year' });
    // Their players can't be listed: what our scouts see is unknown, never "nobody on the club"
    const unlisted = clubReportWords(build, { ...material, playersWhy: 'Not in the export: players.team_id', scouting: { ...material.scouting, players: 0, complete: 0, partial: 0, unknown: 0 } }, 'Us', null);
    expect(unlisted.scouting.text).toBe('The export doesn\'t list their players, so what our scouts see of them isn\'t known');
    expect(unlisted.scouting.tone).toBe('unknown');
    expect(unlisted.scouting.basis.unknown.join(' ')).toMatch(/players\.team_id/);
  });
});
