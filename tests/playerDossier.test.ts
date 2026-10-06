import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolvePhilosophy } from '../server/philosophy.js';
import { computePlayerDossier, dossierShared, type PlayerDossierBody } from '../server/player.js';
import { lensPhilosophyFrom, ourViewOf, playerValue, productionCone } from '../server/playerValue.js';
import { playerState } from '../server/playerState.js';
import { compareView } from '../server/presentation/player/compare.js';
import { philosophyForOrg } from '../server/settings.js';
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

  it('states option years as Player Rights does, behind the same stale-export gate, with a hover and a basis (review M1)', () => {
    const optionYears = (v: PlayerDossierView) => v.contract.rightsFacts.find((f) => f.label.display === 'Option years left')!;
    const withYears = (oy: Partial<NonNullable<PlayerDossierBody['rights']>['optionYears']>, stale = false) => view((input) => {
      const rights = input.body.rights!;
      Object.assign(rights.optionYears, oy);
      if (stale) rights.evidence.currentState = 'behind';
    });
    const known = optionYears(withYears({ used: 1, remaining: 2, usedThisSeason: 0, standing: 'available', reason: null }));
    expect(known.value.display).toBe('2');
    expect(known.value.hint?.length).toBeGreaterThan(0);
    expect(known.claim?.basis.source.specialist).toBe('Player Rights');
    // The options rule not observed: Rights' reason, never a count
    const rule = optionYears(withYears({ used: 1, remaining: 2, usedThisSeason: 0, standing: 'indeterminate', reason: 'The league\'s minor-league options rule is not in the export.' }));
    expect(rule.value).toMatchObject({ display: 'Not established', tone: 'unknown' });
    expect(rule.claim?.basis.unknown.join(' ')).toMatch(/options rule/);
    // All three used, this season unknown: remaining 0 is not stated as "none left"
    const spent = optionYears(withYears({ used: 3, remaining: 0, usedThisSeason: null, standing: 'indeterminate', reason: 'He has used 3 option years; whether one was charged this season is not in the export.' }));
    expect(spent.value.display).toBe('Not established');
    expect(spent.claim?.basis.unknown.join(' ')).toMatch(/charged this season/);
    // A stale export: the gate the actions have, whatever Rights counted
    const stale = optionYears(withYears({ used: 1, remaining: 2, usedThisSeason: 0, standing: 'available', reason: null }, true));
    expect(stale.value.display).toBe('Not established');
    expect(stale.claim?.basis.certainty).toBe('unknown');
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

/*
 * Fuller player payloads than the contract's synthetic save makes (no rating history, no log, no honours), worded by the
 * real words from the synthetic save's own dossier with those facts added, for the Mac app's previews and snapshots
 * (`contract/fixtures/player/`). Written with `npm run contract:fixtures`, checked here otherwise.
 */
describe('fixtures for the Mac app\'s player previews (N11)', () => {
  const FOLDER = path.join(process.cwd(), 'contract', 'fixtures', 'player');
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const fixture = (name: string, value: unknown): void => {
    const file = path.join(FOLDER, name);
    if (process.env.CONTRACT_FIXTURES === 'write') {
      fs.mkdirSync(FOLDER, { recursive: true });
      fs.writeFileSync(file, json(value));
      return;
    }
    expect(fs.existsSync(file), `${name} is missing: run npm run contract:fixtures`).toBe(true);
    expect(fs.readFileSync(file, 'utf8'), `${name} differs: run npm run contract:fixtures`).toBe(json(value));
  };
  const rich = (fill: boolean): PlayerDossierView => {
    const valuation = playerValue(save.regular, { currentState: 'current' });
    const shared = dossierShared([save.regular]);
    return view((input) => {
      input.state = playerState(save.regular);
      input.cone = valuation ? productionCone(valuation.production, valuation.control) : null;
      input.surplus = valuation?.surplus ?? null;
      input.ourView = input.surplus ? ourViewOf({ neutral: input.surplus, philosophy: lensPhilosophyFrom(resolvePhilosophy(philosophyForOrg(save.org))), ours: true }) : null;
      input.body = computePlayerDossier(save.regular, shared).ok ? (computePlayerDossier(save.regular, shared) as { body: PlayerDossierBody }).body : input.body;
      const body = input.body as PlayerDossierBody & { awards: unknown[]; leagueLeader: unknown[]; ratingsFill: unknown };
      body.awards = [{ year: 2039, award: 'All-Star', positionName: null, rank: 6 }, { year: 2038, award: 'All-Star', positionName: null, rank: 6 }, { year: 2039, award: 'Silver Slugger', positionName: '3B', rank: 5 }];
      body.leagueLeader = [{ year: 2039, place: 2, category: 'Doubles', amount: 41 }];
      if (fill) body.ratingsFill = { mark: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' };
      input.history = {
        rows: [['2039-6-1', 50, 56], ['2039-9-28', 52, 56], ['2040-4-30', 54, 57]].map(([d, cur, pot]) => ({
          game_date: d as string, player_id: save.regular, team_id: save.org, org_id: save.org, level: 1, age: 32, cur: cur as number, pot: pot as number,
          con: null, gap: null, pow: null, eye: null, avk: null, spd: null, stu: null, mov: null, ctl: null,
        })),
        sourceSwitch: fill ? 'His ratings came from your scouts\' full reports, then from OSA\'s view' : null,
      };
      input.chronology = [
        { id: 'team_transactions:2', provenance: 'explicit_log', kind: 'activated', supported: true, date: '2040-04-20', rawDate: '2040-4-20', season: 2040, playerId: save.regular, playerName: 'P', position: '3B', from: null, to: null, details: {}, text: 'Activated P from the 10-day injured list.', rawText: '', sources: [] },
        { id: 'team_transactions:1', provenance: 'explicit_log', kind: 'injured_list', supported: true, date: '2040-04-08', rawDate: '2040-4-8', season: 2040, playerId: save.regular, playerName: 'P', position: '3B', from: null, to: null, details: {}, text: 'Placed P on the 10-day injured list with a strained hamstring.', rawText: '', sources: [] },
      ] as unknown as DossierInput['chronology'];
    });
  };

  it('a dossier with his rating history, the log, his honours and his value', () => {
    const v = rich(false);
    expect(bannedInPayload(v, 'getPlayerDossier')).toEqual([]);
    fixture('dossier-rich.json', v);
  });

  it('a dossier whose grades are OSA\'s view filling in, with a change of source in his history (D-067)', () => {
    const v = rich(true);
    expect(v.header.ratingsFill?.display).toBe('OSA');
    fixture('dossier-filled.json', v);
  });

  it('three players side by side, one whose grades are OSA\'s view', () => {
    const others = buildPlayerDossiers({ orgId: save.org, importStamp: base.importStamp, reportStamp: 'r1', playerIds: [save.hitters.find((h) => h !== save.regular)!, save.reliever] }).views;
    const c = compareView([rich(false), ...others.map((o, i) => (i === 0 ? { ...o, header: { ...o.header, ratingsFill: { display: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' } } } : o))], save.org, base.importStamp);
    expect(bannedInPayload(c, 'getPlayerCompare')).toEqual([]);
    fixture('compare-three.json', c);
  });
});
