/**
 * Finance's Horizon Board for the Mac app (N12, D-071; D-057's horizon, SWIFTUI_REBUILD.md section 3.6): each position
 * against the next three seasons, every cell saying who the club controls there and how (signed, an option, arbitration,
 * pre-arbitration, not settled), from Player Value's control timeline (Player Rights' answers, D-023). The farm's next man
 * at each position sits in a pipeline lane with Player Development's readiness against its bar, never placed in a season:
 * no arrival year is invented (D-057). Committed payroll by season runs beneath it against the club's budget as exported.
 * Nothing is ranked or scored; a season the timeline can't settle says so. Pure: it words what it is handed.
 */
import type { FarmNextMan } from '../frontOffice/morningTypes.js';
import { basis, cell, claim } from '../claim.js';
import { counted, hintIf, officeHead, officeLede, officePlayer, officeSource, type OfficeContext } from '../officeTable.js';
import type { FinanceHorizonCell, FinanceHorizonEntry, FinanceHorizonRow, FinanceHorizonView } from './types.js';
import { money } from './words.js';

/** One season of a player's control, as the timeline serves it. */
export interface HorizonSeasonInput {
  season: number;
  status: string;
  /** The timeline's label ("Arbitration 2", "Club option", "Signed (extension)"). */
  label: string;
  /** For a season not settled: the statuses it lies between. */
  between: string[];
  /** Why this status, in one line. */
  basis: string;
}

/** A major leaguer and his control, season by season (empty where the timeline couldn't be read). */
export interface HorizonPlayerInput {
  playerId: number;
  name: string;
  /** OOTP's listed position (1 pitcher … 10 DH); null when the export doesn't give it. */
  position: number | null;
  /** A pitcher's assignment (11 starter, 12 reliever, 13 closer); null when not given. */
  role: number | null;
  seasons: HorizonSeasonInput[];
  /**
   * The first season he is a free agent, when the timeline reaches it. The timeline stops there, so a later season he
   * is missing from is control ended, never unread; null when it doesn't reach free agency.
   */
  controlEnds: number | null;
  /** Why his control couldn't be read, when it couldn't. */
  unknown: string | null;
}

/**
 * Where a player stands in one season of the board: a season of the timeline, control ended (he is not the club's),
 * or unread (his control couldn't be read, or the timeline stops before this season without reaching free agency).
 */
export function horizonSeasonOf(p: HorizonPlayerInput, season: number): HorizonSeasonInput | 'ended' | 'unread' {
  const s = p.seasons.find((x) => x.season === season);
  if (s) return s.status === 'free_agent' ? 'ended' : s;
  if (p.unknown === null && p.controlEnds !== null && season > p.controlEnds) return 'ended';
  return 'unread';
}

export interface HorizonInput {
  thisSeason: number;
  /** The seasons the board lays out (the next three). */
  seasons: number[];
  players: HorizonPlayerInput[];
  /** The farm's next man at each listed position (2 … 10), as the roster map words him. */
  farmNext: Map<number, FarmNextMan[]>;
  /** Committed salary by season (Payroll's), with the budget each is read against; empty when payroll couldn't be read. */
  payroll: Array<{ season: number; committed: number; budget: number | null }>;
  budget: number | null;
  payrollUnknown: string | null;
  /** The OSA mark for a prospect whose readiness rests on OSA's view of him (D-067), or null. */
  fillOf: (playerId: number) => { mark: string; hint: string } | null;
}

const SPECIALIST = 'Player Value';

/** The board's rows: the field's positions, then the pitchers by their assignment. */
const ROWS: Array<{ id: string; title: string; keeps: (p: HorizonPlayerInput) => boolean; farm: number | null }> = [
  { id: 'c', title: 'C', keeps: (p) => p.position === 2, farm: 2 },
  { id: '1b', title: '1B', keeps: (p) => p.position === 3, farm: 3 },
  { id: '2b', title: '2B', keeps: (p) => p.position === 4, farm: 4 },
  { id: '3b', title: '3B', keeps: (p) => p.position === 5, farm: 5 },
  { id: 'ss', title: 'SS', keeps: (p) => p.position === 6, farm: 6 },
  { id: 'lf', title: 'LF', keeps: (p) => p.position === 7, farm: 7 },
  { id: 'cf', title: 'CF', keeps: (p) => p.position === 8, farm: 8 },
  { id: 'rf', title: 'RF', keeps: (p) => p.position === 9, farm: 9 },
  { id: 'dh', title: 'DH', keeps: (p) => p.position === 10, farm: 10 },
  { id: 'sp', title: 'Starters', keeps: (p) => p.position === 1 && p.role === 11, farm: null },
  { id: 'rp', title: 'Relievers', keeps: (p) => p.position === 1 && (p.role === 12 || p.role === 13), farm: null },
  { id: 'p', title: 'Pitchers, role not given', keeps: (p) => p.position === 1 && p.role !== 11 && p.role !== 12 && p.role !== 13, farm: null },
  { id: 'other', title: 'Position not given', keeps: (p) => p.position === null || p.position < 1 || p.position > 10, farm: null },
];

/** How a status reads in a cell: its tone (colour is never the only signal: the words say it too). */
const TONE: Record<string, 'neutral' | 'caution' | 'unknown'> = {
  under_contract: 'neutral', pre_arbitration: 'neutral', arbitration: 'neutral', reserve_clause: 'neutral',
  club_option: 'caution', player_option: 'caution', vesting_option: 'caution', mutual_option: 'caution', opt_out: 'caution',
  indeterminate: 'unknown',
};
const BETWEEN: Record<string, string> = {
  free_agent: 'free agency', arbitration: 'arbitration', pre_arbitration: 'pre-arbitration', under_contract: 'under contract',
  reserve_clause: 'reserve clause', indeterminate: 'not known',
};

function entryOf(ctx: OfficeContext, p: HorizonPlayerInput, s: HorizonSeasonInput): FinanceHorizonEntry {
  const notSettled = s.status === 'indeterminate';
  const words = notSettled ? (s.between.length > 0 ? `Not settled: ${s.between.map((b) => BETWEEN[b] ?? b.replace(/_/g, ' ')).join(' or ')}` : 'Not settled') : s.label;
  return {
    player: officePlayer(p.playerId, p.name, ctx.orgId),
    status: cell(words, { tone: TONE[s.status] ?? 'neutral', hint: hintIf(s.basis) }),
    why: claim({
      text: `${p.name}, ${s.season}: ${words}`,
      tone: TONE[s.status] === 'unknown' ? 'unknown' : 'neutral',
      basis: basis({
        because: [{ label: 'Why', value: s.basis }],
        source: officeSource(ctx, 'Player Rights, through Player Value'),
        unknown: notSettled ? [s.basis] : [],
        wouldChange: [],
        lean: null,
        certainty: notSettled ? 'unknown' : 'fact',
      }),
    }),
  };
}

function rowOf(ctx: OfficeContext, def: (typeof ROWS)[number], players: HorizonPlayerInput[], input: HorizonInput): FinanceHorizonRow {
  const cells: FinanceHorizonCell[] = input.seasons.map((season) => {
    const entries: FinanceHorizonEntry[] = [];
    let unread = 0;
    for (const p of players) {
      const s = horizonSeasonOf(p, season);
      // Control has ended: he is not the club's that season, so he is not in the cell
      if (s === 'ended') continue;
      if (s === 'unread') {
        unread += 1;
        continue;
      }
      entries.push(entryOf(ctx, p, s));
    }
    // Unread players are said whether or not the cell has entries: a mixed cell never hides them
    const unreadNote = unread > 0
      ? cell(entries.length > 0 ? `Not known for ${unread} more` : `Not known for ${counted(unread, 'player')}`, {
          tone: 'unknown',
          hint: unread === 1 ? "His control that season couldn't be read" : "Their control that season couldn't be read",
        })
      : null;
    const empty = entries.length === 0
      ? unreadNote ?? cell('Nobody controlled', { hint: 'No major leaguer here is the club\'s that season' })
      : null;
    return { season, entries, empty, unread, unreadNote: entries.length > 0 ? unreadNote : null };
  });
  const next = def.farm !== null ? input.farmNext.get(def.farm) ?? [] : [];
  return {
    id: def.id,
    position: cell(def.title),
    cells,
    pipeline: next.map((f) => {
      const fill = input.fillOf(f.playerId);
      return {
        player: officePlayer(f.playerId, f.name, ctx.orgId),
        level: cell(f.level),
        readiness: f.readiness,
        ...(fill ? { ratingsFill: cell(fill.mark, { hint: fill.hint }) } : {}),
      };
    }),
    pipelineEmpty: def.farm === null
      ? null
      : next.length === 0 ? cell('Nobody at this position in the farm') : null,
  };
}

export function horizonView(ctx: OfficeContext, input: HorizonInput): FinanceHorizonView {
  const rows = ROWS
    .map((def) => ({ def, players: input.players.filter(def.keeps) }))
    .filter(({ def, players }) => players.length > 0 || (def.farm !== null && def.id !== 'dh'))
    .map(({ def, players }) => rowOf(ctx, def, players, input));
  const unreadPlayers = input.players.filter((p) => p.unknown !== null);
  const lede = officeLede(ctx, SPECIALIST, 'Who the club controls at each position over the next three seasons, and how', [
    { label: 'Each cell', value: 'The major leaguers listed at that position whom the club controls that season, and how: signed, an option, arbitration, pre-arbitration, a reserve clause, or not settled. A season he may reach free agency in says so; one where control has ended leaves him out.' },
    { label: 'Where it comes from', value: "Player Value's control timeline, which reads Player Rights: service time, the league's rules and the contract as exported." },
    { label: 'The pipeline', value: "The farm's next man at each position, at its highest level, with Player Development's readiness against its bar. He is never placed in a season: no arrival year is invented." },
    { label: 'Payroll', value: "Committed salary by season, beneath the board, against the club's budget as exported. Seasons after this one read against the budget you expect, when you have entered one." },
  ], unreadPlayers.map((p) => `${p.name}: ${p.unknown}`));
  const budgetRule = input.budget === null
    ? null
    : { amount: input.budget, label: cell(`Budget ${money(input.budget)}`) };
  return {
    ...officeHead(ctx, 'Horizon Board', lede, SPECIALIST),
    seasons: input.seasons,
    seasonTitles: input.seasons.map((s) => cell(String(s))),
    rows,
    pipelineTitle: cell('In the pipeline', { hint: 'Never placed in a season: no arrival year is guessed' }),
    payroll: input.payroll.map((p) => ({
      season: p.season,
      committed: p.committed,
      budget: p.budget,
      claim: claim({
        text: `${p.season}: ${money(p.committed)} committed`,
        tone: 'neutral',
        basis: basis({
          because: [
            { label: 'Committed', value: money(p.committed) },
            { label: 'Measured against', value: p.budget === null ? "No budget in the export" : money(p.budget) },
          ],
          source: officeSource(ctx, 'Payroll'),
          unknown: p.budget === null ? ["The club's budget isn't in the export."] : [],
          wouldChange: [],
          lean: null,
          certainty: 'fact',
        }),
      }),
    })),
    budget: budgetRule,
    payrollNote: input.payrollUnknown ? cell(input.payrollUnknown, { tone: 'unknown' }) : null,
    chartSummary: cell(input.payroll.length > 0
      ? `Committed salary: ${input.payroll.map((p) => `${p.season} ${money(p.committed)}`).join(', ')}${input.budget !== null ? `; budget ${money(input.budget)}` : '; budget not known'}.`
      : 'Committed salary not known.'),
    unknowns: unreadPlayers.length > 0 ? [cell(`Control couldn't be read for ${counted(unreadPlayers.length, 'player')}.`, { tone: 'unknown' })] : [],
  };
}

