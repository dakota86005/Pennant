import { afterEach, describe, expect, it } from 'vitest';
import { decodeLogText, isoFromStored, parseTransaction, readTransactionLog } from '../server/transactionLog.js';
import { link, makeSave, tx, type FakeSave } from './liveLogFixture';

const ctx = (over: Partial<Parameters<typeof parseTransaction>[1]> = {}) => ({
  logId: 1, teamId: 1, rawType: 0, rawDate: '20300512', season: 2030, ...over,
});
const P: [number, string] = [28109, 'Merrill Kelly'];

describe('parsing the log wording', () => {
  it('reads each observed transaction type into a structured event', () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      [tx.optioned(P, 'SP', [59, 'Reno']), 'optioned', { to: expect.objectContaining({ id: 59, name: 'Reno', levelLabel: 'Triple A' }) }],
      [tx.recalled(P, 'SP', [59, 'Reno']), 'recalled', { from: expect.objectContaining({ id: 59, levelLabel: 'Triple A' }) }],
      [tx.purchased(P, 'SP', [59, 'Reno']), 'purchased_contract', { from: expect.objectContaining({ id: 59 }) }],
      [tx.ilPlaced(P, 'SP', '05/10/2030'), 'il_placed', { details: { days: 15, league: null, retroactiveTo: '2030-05-10' } }],
      [tx.ilActivated(P, 'SP'), 'il_activated', {}],
      [tx.restricted(P, 'SP'), 'restricted_list_placed', {}],
      [`Activated SP ${link.player(...P)} from the restricted list.`, 'restricted_list_activated', {}],
      [tx.released(P, 'SP'), 'released', {}],
      [tx.rehabSent(P, 'SP', [59, 'Reno']), 'rehab_assigned', { to: expect.objectContaining({ id: 59, name: 'Reno' }) }],
      [tx.rehabReceived(P, 'SP', [1, 'Arizona']), 'rehab_received', { from: expect.objectContaining({ id: 1, levelLabel: 'Major League' }) }],
      [tx.rehabReturned(P, 'SP'), 'rehab_returned', {}],
    ];
    for (const [text, kind, extra] of cases) {
      const event = parseTransaction(text, ctx());
      expect(event, text).toMatchObject({ kind, supported: true, playerId: 28109, playerName: 'Merrill Kelly', position: 'SP', ...extra });
      expect(event.provenance).toBe('explicit_log');
      expect(event.date).toBe('2030-05-12');
    }
  });

  it('distinguishes a DFA on irrevocable waivers from one on ordinary waivers', () => {
    expect(parseTransaction(tx.dfa(P, 'SP', true), ctx()).details).toMatchObject({ waiverStatus: 'irrevocable_waivers' });
    expect(parseTransaction(tx.dfa(P, 'SP', false), ctx()).details).toMatchObject({ waiverStatus: 'waivers' });
    const fromActive = parseTransaction(
      `RP ${link.player(...P)} was designated for assignment and placed on waivers (from active).`, ctx()
    );
    expect(fromActive).toMatchObject({ kind: 'designated_for_assignment', details: { waiverStatus: 'waivers', qualifier: 'from active' } });
  });

  it('reads both sides of a Rule 5 return, keeping the original wording', () => {
    const back = parseTransaction(
      `Released former Rule 5 draft pick RP ${link.player(37543, 'Roddery Munoz')}, returned to original Organization Cincinnati Reds.`, ctx()
    );
    expect(back).toMatchObject({ kind: 'rule5_return', details: { perspective: 'released_back', organization: 'Cincinnati Reds' } });
    expect(back.text).toContain('returned to original Organization Cincinnati Reds');
    const recv = parseTransaction(
      `Received former Rule 5 draft pick RP ${link.player(37543, 'Roddery Munoz')} from the Houston Astros.`, ctx()
    );
    expect(recv).toMatchObject({ kind: 'rule5_return', details: { perspective: 'received_back', organization: 'Houston Astros' } });
  });

  it('reads the IL wording variants: league-named, no retroactive date, doubled space', () => {
    const named = parseTransaction(
      `Placed SP ${link.player(...P)} on the International League 7-day injured list, retroactive to 05/12/2030.`, ctx()
    );
    expect(named.details).toMatchObject({ days: 7, league: 'International League', retroactiveTo: '2030-05-12' });
    expect(parseTransaction(`Placed RP ${link.player(...P)} on the 7-day injured list.`, ctx()).kind).toBe('il_placed');
    expect(parseTransaction(`Placed RP ${link.player(...P)}  on the 7-day injured list.`, ctx()).kind).toBe('il_placed');
  });

  it('keeps level moves as assignments with no rights meaning attached', () => {
    const promoted = parseTransaction(
      `Promoted RP ${link.player(...P)} from Double A ${link.team(78, 'Chattanooga')} to Triple A ${link.team(45, 'Louisville')}.`, ctx()
    );
    expect(promoted).toMatchObject({
      kind: 'minor_league_assignment', details: { verb: 'Promoted' },
      from: { id: 78, levelLabel: 'Double A' }, to: { id: 45, levelLabel: 'Triple A' },
    });
    const demoted = parseTransaction(`Demoted RP ${link.player(...P)} to Double A ${link.team(78, 'Chattanooga')}.`, ctx());
    expect(demoted).toMatchObject({ kind: 'minor_league_assignment', details: { verb: 'Demoted' }, to: { id: 78 } });
    // An option and a demotion are different things and stay different
    expect(demoted.kind).not.toBe('optioned');
  });

  it('keeps unrecognised wording as an explicit unsupported event instead of dropping it', () => {
    for (const text of [
      tx.signed(P, 'SP'),
      `Signed General Manager <a href="../coaches/coach_740.html">Jon Daniels</a>.`,
      `Traded ${link.player(...P)} to somewhere in a way nobody has seen yet.`,
    ]) {
      const event = parseTransaction(text, ctx());
      expect(event.kind).toBe('unsupported');
      expect(event.supported).toBe(false);
      expect(event.unsupportedReason).toBe('transaction_type_not_understood');
      expect(event.rawText).toBe(text);
      expect(event.text.length).toBeGreaterThan(0);
    }
    // An unparsed row is still attributable to the player it names
    expect(parseTransaction(tx.signed(P, 'SP'), ctx()).playerId).toBe(28109);
  });

  it('does not mistake an international-complex move for a position-coded one', () => {
    const event = parseTransaction(
      `Promoted international complex member RP ${link.player(22, 'X')} to Rookie League ${link.team(9, 'Somewhere')}.`, ctx()
    );
    expect(event.kind).toBe('unsupported');
  });

  it('keeps the raw type code and the source row, without interpreting the code', () => {
    const event = parseTransaction(tx.released(P, 'SP'), ctx({ logId: 77, teamId: 9, rawType: 1 }));
    expect(event.sources).toEqual([{ table: 'team_transactions', logId: 77, teamId: 9, rawType: 1 }]);
  });

  it('turns stored dates into ISO and refuses malformed ones', () => {
    expect(isoFromStored('20260515')).toBe('2026-05-15');
    expect(isoFromStored('2026-5-15')).toBeNull();
    expect(isoFromStored('')).toBeNull();
    expect(isoFromStored(undefined)).toBeNull();
    expect(parseTransaction(tx.released(P, 'SP'), ctx({ rawDate: 'garbage' })).date).toBeNull();
  });

  it('decodes legacy single-byte text instead of failing or corrupting it', () => {
    // 'latin1' writes á as the single byte 0xE1, which is not valid UTF-8
    const bytes = Buffer.from(`Demoted C ${link.player(26764, 'Christian Vázquez')} to Triple A.`, 'latin1');
    expect(bytes.includes(0xe1)).toBe(true);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
    expect(decodeLogText(bytes)).toContain('Vázquez');
    expect(decodeLogText(Buffer.from('Muñoz', 'utf8'))).toBe('Muñoz');
    expect(decodeLogText(null)).toBe('');
  });
});

const saves: FakeSave[] = [];
afterEach(() => saves.splice(0).forEach((s) => s.cleanup()));

describe('reading the live log', () => {
  it('builds a per-player chronology, oldest first, straight from the log', () => {
    const s = makeSave({
      rows: [
        { date: '20300505', teamId: 1, text: tx.rehabSent(P, 'SP', [59, 'Reno']) },
        { date: '20300505', teamId: 59, text: tx.rehabReceived(P, 'SP', [1, 'Arizona']) },
        { date: '20300520', teamId: 1, text: tx.released([5, 'Someone Else'], 'RP') },
      ],
    });
    saves.push(s);
    const log = readTransactionLog(s.files);
    const kelly = log.byPlayer.get(28109)!;
    expect(kelly.map((e) => [e.date, e.kind])).toEqual([['2030-05-05', 'rehab_assigned'], ['2030-05-05', 'rehab_received']]);
    expect(log.byPlayer.get(5)!.map((e) => e.kind)).toEqual(['released']);
    expect(log.counts.byKind).toMatchObject({ rehab_assigned: 1, rehab_received: 1, released: 1 });
  });

  it('coalesces one move logged for several clubs, and lists every source row', () => {
    const s = makeSave({
      rows: [
        { date: '20300513', teamId: 7, type: 1, text: tx.released([34993, 'Kevin Abel'], 'RP') },
        { date: '20300513', teamId: 12, type: 0, text: tx.released([34993, 'Kevin Abel'], 'RP') },
        { date: '20300514', teamId: 7, type: 1, text: tx.released([34993, 'Kevin Abel'], 'RP') },
      ],
    });
    saves.push(s);
    const events = readTransactionLog(s.files).byPlayer.get(34993)!;
    expect(events).toHaveLength(2); // two days, not three rows
    expect(events[0].sources.map((x) => [x.teamId, x.rawType])).toEqual([[7, 1], [12, 0]]);
  });

  it('does not coalesce unparsed rows: without a meaning nothing says they are the same', () => {
    const text = tx.signed(P, 'SP');
    const s = makeSave({ rows: [{ date: '20300513', text }, { date: '20300513', text }] });
    saves.push(s);
    const log = readTransactionLog(s.files);
    expect(log.counts.unsupported).toBe(2);
    expect(log.unsupportedSamples).toHaveLength(2);
  });

  it('reads text stored in a legacy encoding', () => {
    const bytes = Buffer.from(
      `Demoted C ${link.player(26764, 'Christian Vázquez')} to Triple A ${link.team(192, 'Sugar Land')}.`, 'latin1'
    );
    const s = makeSave({ rows: [{ date: '20300513', text: bytes }] });
    saves.push(s);
    expect(readTransactionLog(s.files).byPlayer.get(26764)![0].playerName).toBe('Christian Vázquez');
  });

  it('reads only the current and previous season', () => {
    const s = makeSave({
      rows: [
        { date: '20280601', text: tx.released([1, 'Ancient'], 'RP') },
        { date: '20290601', text: tx.released([2, 'Last Year'], 'RP') },
        { date: '20300601', text: tx.released([3, 'This Year'], 'RP') },
      ],
    });
    saves.push(s);
    const log = readTransactionLog(s.files);
    expect([...log.byPlayer.keys()].sort()).toEqual([2, 3]);
    expect(log.coverage.season).toBe(2030);
  });

  it('reports how far the database has been written, not just its newest transaction', () => {
    const s = makeSave({ rows: [{ date: '20300514', text: tx.released([1, 'A'], 'RP') }], keepWriterOpen: true });
    saves.push(s);
    // A quiet day: no transaction on the 15th, but the game wrote news for it
    s.writer!.prepare(`INSERT INTO league_news (league_id, news_date, news_text, season) VALUES (1, '20300515', 'x', 2030)`).run();
    const { coverage } = readTransactionLog(s.files);
    expect(coverage.lastTransactionDate).toBe('2030-05-14');
    expect(coverage.activityThrough).toBe('2030-05-15');
    expect(coverage.coveredThrough).toBe('2030-05-15');
    expect(coverage.firstTransactionDate).toBe('2030-05-14');
  });

  it('reads a log that is empty', () => {
    const s = makeSave({ rows: [] });
    saves.push(s);
    const log = readTransactionLog(s.files);
    expect(log.events).toEqual([]);
    expect(log.coverage.coveredThrough).toBeNull();
  });
});
