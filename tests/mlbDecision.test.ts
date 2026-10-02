import { describe, expect, it } from 'vitest';
import { DEFAULT_COVERAGE_FLOORS, whatIfNeed } from '../server/mlbNeeds.js';
import { buildResponsePacket, type ResponsePacket } from '../server/mlbResponses.js';
import { assertAuthored } from '../server/presentation/claim.js';
import { departmentOffice, servedDepartments } from '../server/presentation/catalog.js';
import type { DepartmentContext } from '../server/presentation/frontOffice/desk.js';
import { decisionView, type DecisionAsk } from '../server/presentation/majorLeague/decision.js';
import type { MlbDecisionView } from '../server/presentation/majorLeague/types.js';
import { DURATIONS } from '../server/presentation/majorLeague/words.js';
import { bannedInPayload, basisStrings, shownStrings } from './bannedJargon';
import { ARMS, CLUBS, LENS, candidatesOf, replacePacket } from './mlbGolden';
import { fakePorts, healthy26, mkState, viewOf } from './mlbFixtures';

/**
 * A decision, worded (BEHAVIOR_CASES.md "Pennant for Mac", `mlbDecision.test.ts`, N8): Major League Ops' response packet in
 * the GM's order, authorizing nothing. Built from the golden scenario (a fifth starter far below what a rotation takes,
 * Triple-A arms who are upgrades on paper) under every kind of organization, and a what-if.
 */

const ctx: DepartmentContext = {
  build: { orgId: 1, club: 'Test Club', importStamp: '2040-07-01T00:00:00.000Z', reportStamp: 'r1', gameDate: '2040-7-1' },
  department: servedDepartments(null).find((d) => d.id === 'majorLeague')!,
  office: departmentOffice('majorLeague'),
};
const yardsticks = { line: 'Using starting yardsticks for now', tip: 'Each line is a starting value. It is measured at the next import.', groups: [], longMan: 'Two innings or more.' };
const word = (packet: ResponsePacket, ask: DecisionAsk = { need: packet.need.id }): MlbDecisionView =>
  decisionView({ ctx, overview: { yardsticks } }, packet, ask);

/** Odds and the posture: nowhere, basis included (D-060). */
const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\d+% to reach/i];
/** The window's labels and the season's shading words: never on the face. */
const WINDOW_LABELS = [/\bcontend/i, /win-now/i, /\bwin now\b/i, /\brebuild/i, /building for the future/i, /\bwindow\b/i, /does not press/i, /\bpatient\b/i];

describe('a decision is Major League Ops\' packet, in the GM\'s order, and authorizes nothing', () => {
  const packets = Object.entries(CLUBS).map(([name, organization]) => [name, replacePacket({ organization })] as const);

  it.each(packets)('%s: every claim is authored, every word plain, nothing an odds or a posture, no window label on the face', (_name, packet) => {
    const view = word(packet);
    expect(() => assertAuthored(view)).not.toThrow();
    expect(bannedInPayload(view, 'getMajorLeagueDecision')).toEqual([]);
    const everything = [...shownStrings(view), ...basisStrings(view)].filter(({ text }) => ODDS_OR_POSTURE.some((p) => p.test(text)));
    expect(everything).toEqual([]);
    expect(shownStrings(view).filter(({ text }) => WINDOW_LABELS.some((p) => p.test(text)))).toEqual([]);
  });

  it('runs problem → why → the staff\'s call → the ways to respond → every candidate → the mechanics', () => {
    const view = word(replacePacket({ organization: CLUBS.contending }));
    const keys = Object.keys(view);
    const order = ['problem', 'why', 'picture', 'read', 'call', 'assignment', 'responses', 'roleChoice', 'candidates', 'mechanics'];
    expect(order.map((k) => keys.indexOf(k))).toEqual([...order.map((k) => keys.indexOf(k))].sort((a, b) => a - b));
    expect(view.why).not.toBeNull();
    expect(view.call).not.toBeNull();
    expect(view.candidates).not.toBeNull();
  });

  it('keeps every candidate in the group Major League Ops gave him, in its order, with nobody added or left out', () => {
    for (const [, packet] of packets) {
      const view = word(packet);
      const served = view.candidates!.groups.map((g) => [g.title.display, g.table.rows.map((r) => r.player?.playerId)]);
      const given = packet.groups.filter((g) => g.candidates.length).map((g) => [g.label, g.candidates.map((c) => c.playerId)]);
      expect(served).toEqual(given);
      expect(view.candidates!.count).toBe(candidatesOf(packet).length);
    }
  });

  it('says a move Player Rights cannot establish is "not established", never allowed', () => {
    const packet = replacePacket({ ports: { evidence: { currentState: 'current', chronology: 'unavailable' } } });
    const view = word(packet);
    const rows = view.candidates!.groups.flatMap((g) => g.table.rows);
    const unsettled = candidatesOf(packet).filter((c) => c.path.status === 'indeterminate');
    for (const c of unsettled) {
      const cell = rows.find((r) => r.player?.playerId === c.playerId)!.cells.transaction;
      expect(cell.display.startsWith('Not established')).toBe(true);
      expect(cell.tone).toBe('unknown');
    }
  });

  it('calls the staff\'s stance advice, with its rubric and any lean in the basis beside what a club with no philosophy would hear', () => {
    for (const [, packet] of packets) {
      const call = word(packet).call;
      const rec = packet.report?.recommendation;
      if (!rec || !call) continue;
      expect(call.headline.basis.certainty).toBe('policy');
      expect(call.headline.basis.because.some((b) => b.label === 'How the staff decides')).toBe(true);
      if ((rec.shading ?? []).length) {
        expect(call.headline.basis.lean?.neutral).toMatch(/no stated philosophy/);
        expect(call.headline.basis.lean?.why.length).toBe(new Set((rec.shading ?? []).map((s) => s.text)).size);
      } else {
        expect(call.headline.basis.lean).toBeNull();
      }
    }
  });

  it('shows Minor League Operations\' answer as it served it, never recomputed (D-045)', () => {
    const farm = {
      direction: 'leaves' as const, affiliate: { teamId: 2, label: 'Reno', level: 2, levelName: 'AAA' },
      overall: { before: 'healthy', after: 'thin' }, changes: [{ label: 'Rotation', before: '5', after: '4' }], issuesAfter: ['Reno is down to four starters.'],
      rosterNotes: [], farm: null, arrival: null,
    };
    const packet = replacePacket({ ports: { farm } });
    const view = word(packet);
    const recall = view.candidates!.groups.flatMap((g) => g.table.rows).find((r) => r.cells.response.display !== 'Change role')!;
    const lines = recall.detail.find((b) => b.title?.display === 'Minor-league consequence')!.lines.map((l) => l.text.display);
    expect(lines).toContain('Rotation: 5 → 4');
    expect(lines).toContain('Reno is down to four starters.');
    expect(lines.some((l) => l.startsWith('Reno (AAA)'))).toBe(true);
  });

  it('says a what-if is a scenario, assumes no duration, and offers only the served durations, each sent back as served (D-027)', () => {
    const specs = [...healthy26(), ...ARMS];
    const view = viewOf(specs);
    const ports = {
      ...fakePorts({
        states: specs.map(mkState), assignments: Object.fromEntries(ARMS.map((a) => [a.id, 'optioned' as const])),
        development: Object.fromEntries(ARMS.map((a) => [a.id, {}])), holderEvidence: (id) => LENS[id],
      }),
      organization: null,
    };
    const need = whatIfNeed(view, 100, DEFAULT_COVERAGE_FLOORS, null)!;
    const packet = buildResponsePacket(need, view, ports);
    const plain = word(packet, { need: need.id });
    expect(plain.scenario).toBe(true);
    expect(plain.footnote.display).toMatch(/scenario you posed/);
    const choices = plain.duration!.choices;
    expect(choices.map((c) => c.text.display)).toEqual(DURATIONS.map(([, text]) => text));
    expect(choices.filter((c) => c.selected).map((c) => c.text.display)).toEqual(['Duration not stated']);
    expect(choices.map((c) => c.query)).toEqual(DURATIONS.map(([days]) => (days === null ? { need: need.id } : { need: need.id, days })));
    const fortnight = word(buildResponsePacket(whatIfNeed(view, 100, DEFAULT_COVERAGE_FLOORS, 14)!, view, ports), { need: need.id, days: 14 });
    expect(fortnight.duration!.choices.filter((c) => c.selected).map((c) => c.text.display)).toEqual(['Two weeks']);
  });
});
