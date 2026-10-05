import { beforeAll, describe, expect, it } from 'vitest';
import { computePlayerDossier, type PlayerDossierBody } from '../server/player.js';
import { buildPlayerDossiers } from '../server/playerDossierBuild.js';
import { dossierView } from '../server/presentation/player/dossier.js';
import type { DossierInput } from '../server/presentation/player/input.js';
import type { PlayerDossierView } from '../server/presentation/player/types.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { BANNED_JARGON, BANNED_VERDICTS, basisStrings, bannedIn, bannedInPayload, shownStrings } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The player window's dossier (N11; BEHAVIOR_CASES.md "Player card"): it shows only what the organization can see, its
 * value is ranges with their basis, and its contract, rights and history keep their sources apart. Built from the
 * synthetic save through the reader (`buildPlayerDossiers`), and from the reader's own input with one fact changed
 * (`dossierView`), so each case is the words' own behaviour on evidence the case states.
 */

let save: BuiltSave;
let base: DossierInput;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const view = (change: (input: DossierInput) => void = () => {}): PlayerDossierView => {
  const input = clone(base);
  change(input);
  return dossierView(input);
};
const allShown = (v: unknown): string => shownStrings(v).map((s) => s.text).join('\n');

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 2, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true });
  resetFrontOfficeCache();
  const computed = computePlayerDossier(save.regular);
  if (!computed.ok) throw new Error('the synthetic regular has no dossier');
  base = {
    playerId: save.regular, orgId: save.org, orgName: 'Club 1', importStamp: '2040-05-06T12:00:00.000Z', reportStamp: 'r1', gameDate: '2040-5-6',
    body: computed.body, state: null, chronology: null, chronologyNote: null, cone: null, surplus: null, ourView: null,
    history: { rows: [], sourceSwitch: null }, rating: { scaleMax: 80, roundToFive: false }, ratingSource: { short: 'Your scouts\' view', text: 'Your scouts\' full reports.' },
  };
}, 120_000);

describe('the player window shows only what the organization can see (D-017, D-067)', () => {
  it('reads every grade as the card\'s scouted evidence reads it, and never OOTP\'s own figures', () => {
    const [built] = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [save.regular] }).views;
    const body = base.body as PlayerDossierBody & { battingRatings: Record<string, number[]> };
    const batting = built.ratings.groups.find((g) => g.id === 'batting')!;
    expect(batting.rows.length).toBeGreaterThan(0);
    for (const r of batting.rows) expect([r.now, r.ceiling]).toEqual(body.battingRatings[r.id].map((n) => (typeof n === 'number' ? n : null)));
    expect(bannedInPayload(built, 'getPlayerDossier')).toEqual([]);
    expect(allShown(built)).not.toMatch(/Overall|Potential|\bOA\b|\bPOT\b/);
  });

  it('marks every grade, the header and the source line when his grades are OSA\'s view filling in for our scouts', () => {
    const fill = { mark: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' };
    const v = view((input) => { (input.body as { ratingsFill: unknown }).ratingsFill = fill; });
    expect(v.header.ratingsFill).toMatchObject({ display: 'OSA', hint: fill.hint });
    expect(v.ratings.ratingsFill).toMatchObject({ display: 'OSA', hint: fill.hint });
    expect(v.ratings.source.text).toBe(fill.hint);
    for (const g of v.ratings.groups) for (const r of g.rows) expect(r.cells.grade.hint).toBe(fill.hint);
    // And none for a player our scouts rate
    const ours = view();
    expect(ours.header.ratingsFill).toBeNull();
    expect(ours.ratings.groups.flatMap((g) => g.rows).every((r) => r.cells.grade.hint !== fill.hint)).toBe(true);
  });

  it('says "Not scouted" for a grade the scouts haven\'t given, never a midpoint', () => {
    const v = view((input) => { (input.body as { battingRatings: Record<string, unknown> }).battingRatings = { contact: [null, null], power: [55, 60] }; });
    const rows = v.ratings.groups.find((g) => g.id === 'batting')!.rows;
    expect(rows.find((r) => r.id === 'contact')).toMatchObject({ now: null, ceiling: null, cells: { grade: { display: 'Not scouted', tone: 'unknown' } }, sort: { grade: null } });
    expect(rows.find((r) => r.id === 'power')!.cells.grade.display).toBe('55 → 60');
  });

  it('says a change of rating source in his history and draws only the rows it is handed', () => {
    const rows = [
      { game_date: '2040-4-1', player_id: save.regular, team_id: 1, org_id: 1, level: 1, age: 30, cur: 50, pot: 55, con: null, gap: null, pow: null, eye: null, avk: null, spd: null, stu: null, mov: null, ctl: null },
      { game_date: '2040-5-1', player_id: save.regular, team_id: 1, org_id: 1, level: 1, age: 30, cur: 52, pot: 55, con: null, gap: null, pow: null, eye: null, avk: null, spd: null, stu: null, mov: null, ctl: null },
    ];
    const v = view((input) => { input.history = { rows, sourceSwitch: 'His ratings came from OSA\'s view, then from your scouts\' full reports' }; });
    expect(v.ratings.history.points.map((p) => [p.date, p.now, p.ceiling])).toEqual([['2040-4-1', 50, 55], ['2040-5-1', 52, 55]]);
    expect(v.ratings.history.sourceSwitch?.text).toMatch(/OSA's view/);
    expect(v.ratings.history.sourceSwitch?.basis.unknown.join(' ')).toMatch(/left out of the chart/);
    expect(view().ratings.history.empty?.display).toBe('No rating history for him in this save yet');
  });
});

describe('his value is ranges with their basis, never a verdict (D-052, D-018, D-060)', () => {
  it('serves each total as Player Value answered it: most likely and the range, or one sentence and no figure', () => {
    const [built] = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [save.regular] }).views;
    const known = built.value.totals.filter((t) => t.known);
    expect(known.length).toBeGreaterThan(0);
    for (const t of known) {
      expect(t.headline.text).toMatch(/^Most likely |depending on/);
      expect(t.headline.value?.low).toBeLessThanOrEqual(t.headline.value?.high ?? -Infinity);
      expect(t.couldBe?.display).toMatch(/^could be /);
    }
    for (const t of built.value.totals.filter((x) => !x.known)) {
      expect(t.headline.text).toMatch(/^Not valued yet/);
      expect(t.headline.value?.n).toBeNull();
    }
  });

  it('keeps a season whose production is not established as a slot with its reason: no range, no zero', () => {
    const [built] = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [save.regular] }).views;
    for (const s of built.value.cone.seasons.filter((x) => !x.established)) {
      expect(s).toMatchObject({ expected: null, outer: null, inner: null });
      expect(s.detail.value?.n).toBeNull();
      expect(s.detail.basis.unknown.length).toBeGreaterThan(0);
    }
    for (const s of built.value.cone.seasons.filter((x) => x.established)) {
      expect(s.outer!.low).toBeLessThanOrEqual(s.inner!.low);
      expect(s.outer!.high).toBeGreaterThanOrEqual(s.inner!.high);
    }
  });

  it('carries no verdict, no playoff odds and no posture anywhere, its bases included', () => {
    const { views } = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [...save.hitters.slice(0, 6), save.reliever] });
    for (const v of views) {
      for (const s of shownStrings(v)) expect(bannedIn(s.text, [BANNED_JARGON, BANNED_VERDICTS]), s.path).toEqual([]);
      for (const s of basisStrings(v)) expect(bannedIn(s.text, [BANNED_VERDICTS]), s.path).toEqual([]);
      expect(JSON.stringify(v)).not.toMatch(/playoff|postseason|odds|deadline|buyer|seller/i);
    }
  });

  it('says plainly when no club holds him, and values nothing for him', () => {
    const v = view((input) => {
      input.surplus = { status: 'not_held', reason: 'No club holds his contract, so it has no contract value.' } as unknown as DossierInput['surplus'];
    });
    expect(v.value.status).toBe('not_held');
    expect(v.value.totals).toEqual([]);
    expect(v.value.note?.text).toBe('No club holds his contract, so it has no contract value.');
  });
});

describe('contract & rights and history keep their sources apart (D-020, D-023)', () => {
  it('states rights as Player Rights answered them, each with its reasons, and says once when the export is too old to', () => {
    const [built] = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [save.regular] }).views;
    for (const r of built.contract.rights) {
      expect(['Can be done', 'Can\'t be done now', 'Not established']).toContain(r.status.display);
      expect(r.claim.basis.source.specialist).toBe('Player Rights');
    }
    const stale = view((input) => {
      const rights = input.body.rights!;
      rights.evidence.currentState = 'behind';
    });
    expect(stale.contract.rights).toEqual([]);
    expect(stale.contract.rightsNote?.display.length).toBeGreaterThan(0);
  });

  it('says what the log says, in its words, and never names a move the log does not', () => {
    const event = {
      id: 'team_transactions:1', provenance: 'explicit_log', kind: 'unsupported', supported: false, date: '2040-05-02', rawDate: '2040-5-2', season: 2040,
      playerId: save.regular, playerName: 'P', position: null, from: null, to: null, details: {}, text: 'P was sent to the instructional league.', rawText: '', sources: [],
    };
    const v = view((input) => { input.chronology = [event] as unknown as DossierInput['chronology']; });
    expect(v.history.log.map((e) => e.line.text)).toEqual(['P was sent to the instructional league.']);
    expect(v.history.log[0].line.basis.unknown.join(' ')).toMatch(/draws no conclusion/);
    expect(v.history.logNote).toBeNull();
    const noLog = view();
    expect(noLog.history.log).toEqual([]);
    expect(noLog.history.logNote?.display).toMatch(/log is unavailable/);
    expect(allShown(noLog.history)).not.toMatch(/\b(optioned|recalled|designated for assignment|DFA)\b/i);
  });

  it('says where he is now as the export states it, apart from the log', () => {
    const [built] = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [save.regular] }).views;
    expect(built.history.now.map((f) => f.label.display)).toEqual(['Club', 'Active roster', '40-man roster', 'Injured list']);
    expect(built.history.nowSource.display).toMatch(/as the export states it/);
  });
});
