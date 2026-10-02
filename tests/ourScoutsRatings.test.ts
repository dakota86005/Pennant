import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db, forgetImportRecord, LAST_IMPORT_PATH } from '../server/db.js';
import { historyDb, modeFilter, snapshotModes, stampSnapshotMode } from '../server/history.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { takeImportSnapshots } from '../server/importSnapshots.js';
import { indexesFor } from '../server/importWorker.js';
import { RATING_MODE_WORDS, type RatingMode } from '../server/ratingMode.js';
import {
  clearFieldingPopulationCache,
  evidenceRatingMode,
  loadScoutedAbilities,
  loadScoutedGlovesAtPosition,
  loadScoutedHitterProfiles,
  ourScoutsRatings,
  ratingSource,
  scoutedGloves,
  scoutedRatingRow,
  UNRATED_BY_OUR_SCOUTS,
} from '../server/scoutedEvidence.js';
import { IDS } from './fixture';
import { setExportRatingMode } from './ratingModeFixture';
import request from './request';

/**
 * Our scouts' full reports are the scouted evidence when the export carries them (D-067, BEHAVIOR_CASES "Our scouts'
 * complete ratings"). A synthetic `players_scouted_ratings`, shaped like OOTP's: one row per player per scouting
 * organisation, `scouting_team_id` 0 for OSA, the human club's id for ours, another club's id for theirs.
 */

const OURS = IDS.mlbTeam; // the fixture's human-managed club
const OSA = 0;
const THEIRS = IDS.otherMlbTeam;
/** A hitter every source rates. */
const RATED = IDS.optioned;
/** A hitter OSA and another club rate, and our scouts don't. */
const UNRATED = IDS.starter;
const OUR_GRADE = 75;
const OSA_GRADE = 25;
const THEIR_GRADE = 65;

const columnsOf = (table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

const RATING = /^(batting_ratings_|pitching_ratings_|fielding_rating|running_ratings_)/;
let ratingColumns: string[] = [];

function scoutRow(playerId: number, scoutingTeamId: number, grade: number): void {
  const position = (db.prepare('SELECT position FROM players WHERE player_id = ?').get(playerId) as { position: number }).position;
  const values: Record<string, unknown> = {
    player_id: playerId, team_id: 0, league_id: IDS.league, position, role: 0,
    scouting_coach_id: scoutingTeamId === OSA ? -1 : 500 + scoutingTeamId, scouting_team_id: scoutingTeamId,
    overall: 99, talent: 99, overall_rating: 80, talent_rating: 80, scouting_accuracy: 5,
  };
  for (const c of ratingColumns) {
    // Fielding grades only at his own position (a dash elsewhere); every other grade the same, so a read shows whose it is
    const pos = /^fielding_rating_pos(\d)/.exec(c);
    values[c] = pos ? (Number(pos[1]) === position ? grade : 0) : grade;
  }
  const keys = Object.keys(values);
  db.prepare(`INSERT INTO players_scouted_ratings (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`).run(values);
}

/** The import record, as `setExportRatingMode` writes it, with the table stale (kept from an earlier import) when asked. */
function setImport(mode: RatingMode | null, opts: { staleScouted?: boolean } = {}): void {
  setExportRatingMode(mode);
  if (opts.staleScouted && mode !== null) {
    const row = db.prepare(`SELECT value FROM pennant_import WHERE key = 'import'`).get() as { value: string };
    const record = JSON.parse(row.value) as Record<string, unknown>;
    record.stale = [{ file: 'players_scouted_ratings.csv', table: 'players_scouted_ratings', writtenAt: null }];
    record.tables = [{ table: 'players_scouted_ratings', source: 'carried' }];
    db.prepare(`UPDATE pennant_import SET value = ? WHERE key = 'import'`).run(JSON.stringify(record));
    fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ tables: 0, rows: 0, startedAt: record.startedAt, finishedAt: record.startedAt, files: [] }));
    forgetImportRecord();
  }
  clearFieldingPopulationCache();
}

const contactOf = (playerId: number): number | null | undefined =>
  loadScoutedAbilities([playerId]).for(playerId).currentTools.contact;

describe('our scouts\' full reports as the scouted evidence (D-067)', () => {
  let mainContact: number;
  beforeAll(() => {
    ratingColumns = [...new Set(['players_batting', 'players_pitching', 'players_fielding'].flatMap(columnsOf).filter((c) => RATING.test(c)))];
    // OOTP's file carries the splits and running the main fixture table lacks; ours carries them too
    for (const extra of ['batting_ratings_vsl_contact', 'batting_ratings_vsr_contact', 'running_ratings_baserunning', 'running_ratings_stealing']) {
      if (!ratingColumns.includes(extra)) ratingColumns.push(extra);
    }
    db.exec(`DROP TABLE IF EXISTS players_scouted_ratings`);
    db.exec(`CREATE TABLE players_scouted_ratings (
      player_id INTEGER, team_id INTEGER, league_id INTEGER, position INTEGER, role INTEGER,
      scouting_coach_id INTEGER, scouting_team_id INTEGER,
      ${ratingColumns.map((c) => `${c} INTEGER`).join(', ')},
      overall INTEGER, talent INTEGER, overall_rating INTEGER, talent_rating INTEGER, scouting_accuracy INTEGER
    )`);
    setImport('osa');
    mainContact = (db.prepare('SELECT batting_ratings_overall_contact AS c FROM players_batting WHERE player_id = ?').get(RATED) as { c: number }).c;
    expect([OUR_GRADE, OSA_GRADE, THEIR_GRADE]).not.toContain(mainContact);
    scoutRow(RATED, OSA, OSA_GRADE);
    scoutRow(RATED, OURS, OUR_GRADE);
    scoutRow(RATED, THEIRS, THEIR_GRADE);
    scoutRow(UNRATED, OSA, OSA_GRADE);
    scoutRow(UNRATED, THEIRS, THEIR_GRADE);
    clearFieldingPopulationCache();
  });
  afterEach(() => setImport('osa'));
  afterAll(() => {
    db.exec(`DROP TABLE IF EXISTS players_scouted_ratings`);
    setImport(null);
  });

  it.each(['osa', 'real', 'scouted', 'unknown'] as const)(
    'reads our scouts\' grades whatever the main tables carry (%s), never OSA\'s, another club\'s or the main table\'s', (mode) => {
      setImport(mode);
      expect(ourScoutsRatings()).toEqual({ teamId: OURS, players: 1 });
      expect(evidenceRatingMode()).toBe('scouted-complete');
      const ability = loadScoutedAbilities([RATED]).for(RATED);
      expect(ability.currentTools.contact).toBe(OUR_GRADE);
      expect(ability.potentialTools.power).toBe(OUR_GRADE);
      expect(ability.current).toBe(OUR_GRADE);
      const profile = loadScoutedHitterProfiles([RATED]).get(RATED)!;
      expect(profile.vsLeft.contact).toBe(OUR_GRADE);
      expect(profile.running.baserunning).toBe(OUR_GRADE);
      expect(loadScoutedGlovesAtPosition([RATED]).get(RATED)?.current).toBe(OUR_GRADE);
      expect(ratingSource()).toMatchObject({ mode: 'scouted-complete', short: 'Your scouts\' view' });
    });

  it('leaves a player our scouts haven\'t rated unknown: never OSA\'s view, another club\'s or the main table\'s', () => {
    expect(UNRATED_BY_OUR_SCOUTS).toBe('unknown');
    const mainHas = db.prepare('SELECT batting_ratings_overall_contact AS c FROM players_batting WHERE player_id = ?').get(UNRATED) as { c: number };
    expect(mainHas.c).toBeGreaterThan(0);
    for (const mode of ['osa', 'real'] as const) {
      setImport(mode);
      const ability = loadScoutedAbilities([UNRATED]).for(UNRATED);
      expect(ability.status).toBe('unknown');
      expect(ability.current).toBeNull();
      expect(ability.currentTools.contact ?? null).toBeNull();
      expect(loadScoutedHitterProfiles([UNRATED]).has(UNRATED)).toBe(false);
      expect(loadScoutedGlovesAtPosition([UNRATED]).has(UNRATED)).toBe(false);
      expect(scoutedGloves(UNRATED)).toBeNull();
    }
  });

  it('changes nothing without a row of ours, with an unresolved club, or with a file kept from an earlier export', () => {
    // A file kept from an earlier import (not rewritten by this export) is not this export's reports
    setImport('osa', { staleScouted: true });
    expect(ourScoutsRatings()).toBeNull();
    expect(contactOf(RATED)).toBe(mainContact);
    expect(ratingSource().mode).toBe('osa');

    // Two clubs marked human: whose scouts is not settled, so nobody's rows are ours
    db.prepare('UPDATE teams SET human_team = 1 WHERE team_id = ?').run(THEIRS);
    try {
      setImport('osa');
      expect(ourScoutsRatings()).toBeNull();
      expect(contactOf(RATED)).toBe(mainContact);
    } finally {
      db.prepare('UPDATE teams SET human_team = 0 WHERE team_id = ?').run(THEIRS);
    }

    // No row for our club: the main tables, as before
    db.prepare('UPDATE players_scouted_ratings SET scouting_team_id = 999 WHERE scouting_team_id = ?').run(OURS);
    try {
      setImport('osa');
      expect(ourScoutsRatings()).toBeNull();
      expect(evidenceRatingMode()).toBe('osa');
      expect(contactOf(RATED)).toBe(mainContact);
      expect(contactOf(UNRATED)).not.toBeNull();
    } finally {
      db.prepare('UPDATE players_scouted_ratings SET scouting_team_id = ? WHERE scouting_team_id = 999').run(OURS);
    }
  });

  it('withholds every rating under "Show no player ratings", the file included', () => {
    setImport('none');
    expect(ourScoutsRatings()).toBeNull();
    expect(loadScoutedAbilities([RATED]).for(RATED).status).toBe('unknown');
    expect(loadScoutedHitterProfiles([RATED]).size).toBe(0);
  });

  it('shows on the player card the grades the evidence uses, the rest of the row as exported', async () => {
    const row = scoutedRatingRow('batting', RATED)!;
    expect(row.batting_ratings_overall_contact).toBe(OUR_GRADE);
    expect(row.player_id).toBe(RATED);
    // A player our scouts haven't rated: his grades are unknown on the card too, never the main table's
    expect(scoutedRatingRow('batting', UNRATED)!.batting_ratings_overall_contact).toBeNull();
    const card = await request(`/api/player/${RATED}`);
    expect(card.battingRatings.contact[0]).toBe(OUR_GRADE);
    // And the roster's grades column, for both men
    const teamOf = (id: number) => (db.prepare('SELECT team_id FROM players WHERE player_id = ?').get(id) as { team_id: number }).team_id;
    for (const [id, expected] of [[RATED, OUR_GRADE], [UNRATED, null]] as const) {
      const roster = await request(`/api/roster/${teamOf(id)}`);
      const man = roster.players.find((p: { player_id: number }) => p.player_id === id);
      // He may not be on a served roster list (the fixture's optioned man is); one who is shows our scouts' grade or none
      if (id === RATED) expect(man).toBeDefined();
      if (man) expect(man.ratings.contact ?? null).toBe(expected);
    }
  });

  it('stamps a snapshot read from our scouts\' reports as their own kind, and never compares it with another kind', async () => {
    const outcome = await takeImportSnapshots({
      importFinishedAt: null, importStartedAt: '2040-07-01T12:00:00.000Z',
      ratingMode: { mode: 'osa', additionalScouted: true, source: 'export_settings', reason: null },
    }, async () => {});
    const date = outcome.ratings!.gameDate;
    try {
      expect(outcome.ratings!.ourScouts).toBe(true);
      expect(snapshotModes().get(date)).toBe('scouted-complete');
      const kept = historyDb.prepare('SELECT con FROM save_rating_snapshots WHERE save_key = ? AND game_date = ? AND player_id = ?')
        .get(currentHistoryKey(), date, RATED) as { con: number | null };
      expect(kept.con).toBe(OUR_GRADE);
      const unrated = historyDb.prepare('SELECT con FROM save_rating_snapshots WHERE save_key = ? AND game_date = ? AND player_id = ?')
        .get(currentHistoryKey(), date, UNRATED) as { con: number | null } | undefined;
      expect(unrated?.con ?? null).toBeNull();
      // The earlier build's copy, where it is written, carries a kind that build never compares
      const legacy = historyDb.prepare('SELECT mode FROM rating_snapshot_modes WHERE game_date = ?').all(date) as Array<{ mode: string }>;
      for (const r of legacy) expect(r.mode).toBe('unknown');

      // Today our scouts' reports: a snapshot of OSA's view is a switch, left out; one of our scouts' reports is kept
      stampSnapshotMode('2029-3-1', { mode: 'osa', additionalScouted: null, source: 'export_settings', reason: null }, null);
      expect(modeFilter().excluded.has('2029-3-1')).toBe(true);
      expect(modeFilter().excluded.has(date)).toBe(false);
      // And the day the export stops carrying them, the snapshots of our scouts' reports are the other kind
      db.prepare('UPDATE players_scouted_ratings SET scouting_team_id = 999 WHERE scouting_team_id = ?').run(OURS);
      try {
        setImport('osa');
        expect(modeFilter().excluded.has(date)).toBe(true);
        expect(modeFilter().switches.some((s) => /your scouts' full reports/.test(s.text))).toBe(true);
      } finally {
        db.prepare('UPDATE players_scouted_ratings SET scouting_team_id = ? WHERE scouting_team_id = 999').run(OURS);
      }
    } finally {
      historyDb.prepare('DELETE FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date IN (?, ?)').run(currentHistoryKey(), date, '2029-3-1');
      historyDb.prepare('DELETE FROM rating_snapshot_modes WHERE game_date = ?').run(date);
    }
  });

  it('indexes one scouting organisation\'s view of a player, so our scouts\' row is read directly', () => {
    const names = indexesFor('players_scouted_ratings', new Set(['player_id', 'scouting_team_id', 'team_id'])).map((i) => i.columns.join(','));
    expect(names).toContain('scouting_team_id,player_id');
    expect(indexesFor('players_batting', new Set(['player_id'])).map((i) => i.columns.join(','))).not.toContain('scouting_team_id,player_id');
  });

  it('tells the GM whose view it is: "Your scouts\' view", with the source in the hint', async () => {
    const status = await request('/api/v2/data-status');
    const line = JSON.stringify(status);
    expect(line).toContain(RATING_MODE_WORDS['scouted-complete'].hint);
    expect(RATING_MODE_WORDS['scouted-complete'].hint.length).toBeLessThanOrEqual(75);
    const raw = await request('/api/data-status');
    expect(raw.import.ourScouts).toEqual({ teamId: OURS, players: 1 });
    expect(raw.import.ratingMode.mode).toBe('osa');
  });
});
