/**
 * The Trade Desk and a deal weighed, worded (N12 Track C, D-073): pure adapters over what the analyser already answered
 * (`analyzeTrade`, `computeTradeFits`, `computeTradeProposals`, `computeTradeTalk` in `server/trade.ts`). They read
 * nothing and decide nothing: every figure is Player Value's, every order the analyser's, and nothing is a verdict
 * (D-001, D-052). The club's value of a win is left to the standings (D-060).
 */
import type { BasisLine, Cell, Claim, Tone } from '../../contract/presentation.js';
import type { CalibrationStamp } from '../../calibration.js';
import type { FreshnessCue } from '../../dataStatus.js';
import type { TradeFigure, TradePlayerValue, TradeSideTotal, TradeUnit } from '../../playerValue.js';
import type { TradeAnalysis, TradeBrief, TradeFits, TradeProposal, TradeRow, TradeTalkItem, ValueGlance } from '../../trade.js';
import { basis, cell, claim, row, servedValue, target } from '../claim.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import { plainAll } from '../farm/words.js';
import { listSeasons, money } from '../player/words.js';
import type { MlbColumn, MlbPlayer, MlbRow, MlbTable } from '../majorLeague/types.js';
import type {
  TradeAnalysisView, TradeDeal, TradeDealRow, TradeDealSide, TradeDeskAI, TradeDeskPlayer, TradeDeskView, TradeDifferenceView,
  TradeFitClub, TradeFitLine, TradeFitsView, TradeOffer, TradeRangeChart, TradeTalkTarget, TradesViewHead,
} from './types.js';
import {
  PLAYER_VALUE, THE_INBOX, TIP_BAR, TIP_DIFFERENCE, TIP_EXPECTED, TIP_FITS, TIP_KEEPING_ROW, TIP_OFFER, TIP_OUR_VIEW_DEAL, TIP_SALARY,
  TIP_TOGETHER, TRADES, amountFor, evenDealText, fitWins, holdsEven, likelyText, matchesText, metaLine, scaleOf, sideTitle, signed, spanText, type Fmt,
} from './words.js';

/** What every Trade Desk payload is built for: the club, the build, the department's byline and the export's date. */
export interface TradesContext {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
  gameDate: string | null;
  /** "Prepared by Mike Hazen, general manager". */
  preparedBy: Cell;
  /** The club's name as its side reads ("Diamondbacks", "Arizona Diamondbacks"). */
  club: string;
}

const source = (ctx: TradesContext, specialist: string) =>
  ({ department: TRADES, specialist, asOf: ctx.importStamp, gameDate: ctx.gameDate });

const lines = (pairs: ReadonlyArray<readonly [string, string | null | undefined]>): BasisLine[] =>
  pairs.filter((p): p is readonly [string, string] => typeof p[1] === 'string' && p[1].trim().length > 0)
    .map(([label, value]) => ({ label, value: value.trim() }));

/** A help tag is one short line; a longer one goes in the basis only. */
const tag = (text: string | null | undefined): { hint?: string } => (text && text.trim().length > 0 && text.trim().length <= 75 ? { hint: text.trim() } : {});

/** How the analyser's figures are called (D-041): its stamp, as the player card's value is called. */
function valueBasis(ctx: TradesContext, stamp: CalibrationStamp, because: BasisLine[], unknown: string[] = [], wouldChange: string[] = []) {
  return basis({
    because: because.length ? because : [{ label: 'From', value: PLAYER_VALUE }],
    source: source(ctx, PLAYER_VALUE),
    unknown: plainAll(unknown), wouldChange: plainAll(wouldChange), lean: null,
    certainty: stamp.status, stamp: stamp.run ?? (stamp.basis || PLAYER_VALUE),
  });
}

function factBasis(ctx: TradesContext, specialist: string, because: BasisLine[], unknown: string[] = []) {
  return basis({
    because: because.length ? because : [{ label: 'Read from', value: 'The imported export' }],
    source: source(ctx, specialist), unknown: plainAll(unknown), wouldChange: [], lean: null, certainty: 'fact',
  });
}

const policyBasis = (ctx: TradesContext, specialist: string, because: BasisLine[]) => basis({
  because, source: source(ctx, specialist), unknown: [], wouldChange: [], lean: null, certainty: 'policy',
  stamp: 'How the desk reads it: stated, not fitted',
});

export function headOf(ctx: TradesContext): TradesViewHead {
  const day = gameDateDisplay(ctx.gameDate);
  const asOf = day ? `Through ${day}` : 'Game date not known';
  return {
    orgId: ctx.orgId,
    importStamp: ctx.importStamp,
    reportStamp: ctx.reportStamp,
    title: cell('Trade Desk'),
    byline: cell(`${ctx.preparedBy.display} · ${asOf}`, ctx.preparedBy.hint ? { hint: ctx.preparedBy.hint } : {}),
  };
}

/** A player a card or a row names, opening his own window (`teamId`: his organization's club when known). */
export function playerOf(playerId: number, name: string, teamId: number | null): MlbPlayer {
  const open = playerId > 0 ? target({ kind: 'player', playerId, ...(teamId !== null && teamId > 0 ? { teamId } : {}) }) : null;
  return { playerId, name: name.trim() || 'Unnamed player', open };
}

const briefPlayer = (b: TradeBrief, teamId: number | null): TradeDeskPlayer => ({
  player: playerOf(b.player_id, b.name, teamId),
  line: cell(metaLine([b.positionName, b.age, b.team]) || 'Not placed in the export'),
});

/** How current the export is, said only when there is something to say (A-20). */
export function freshnessClaim(ctx: TradesContext, cue: FreshnessCue & { limitations?: string[] }): Claim | null {
  if (!cue.line) return null;
  return claim({
    text: cue.line,
    tone: cue.state === 'behind' || cue.state === 'unavailable' ? 'bad' : 'caution',
    links: [],
    basis: basis({
      because: lines([['How current', cue.detail]]),
      source: source(ctx, 'Data status'),
      unknown: plainAll(cue.limitations ?? []), wouldChange: ['A newer export.'], lean: null,
      certainty: cue.asOf ? 'fact' : 'unknown',
    }),
  });
}

// ── the desk ─────────────────────────────────────────────────────────────────

/** A difference in one line: most likely and what it could be, or why there is none (`differenceLine`). */
export function differenceWords(d: TradeAnalysis['value']['difference'], unit: TradeUnit | null): string {
  if (d.status !== 'known' || !d.figure) return 'Not a number yet: no one on one side could be valued.';
  const s = signed(amountFor(unit));
  if (holdsEven(d.figure)) return evenDealText(d.figure, s);
  return `Coming in less going out: most likely ${likelyText(d.figure, s)} · could be ${spanText(d.figure, s)}`;
}

function offerOf(ctx: TradesContext, p: TradeProposal, stamp: CalibrationStamp): TradeOffer {
  const known = p.difference.status === 'known' && p.difference.figure;
  const s = signed(amountFor(p.unit));
  const reading = claim({
    text: differenceWords(p.difference, p.unit),
    tone: known ? 'neutral' : 'unknown',
    ...(known && p.difference.figure && p.difference.figure.central !== null
      ? { value: servedValue(p.difference.figure.central, p.unit === 'wins' ? 'wins' : 'dollars', s(p.difference.figure.central), { low: p.difference.figure.low, high: p.difference.figure.high }) }
      : {}),
    links: [],
    basis: valueBasis(ctx, stamp, lines([
      ['How it is read', TIP_OFFER],
      ['How the sides are added up', p.difference.text],
    ]), p.difference.status === 'known' ? p.difference.excluded.map((x) => x.reason) : [p.difference.reason ?? 'No one on one side could be valued.'],
    ['A newer export, or a change to either side.']),
  });
  return {
    id: `offer-${p.message_id}`,
    date: cell(gameDateDisplay(p.date) ?? 'Date not known', p.date ? {} : { tone: 'unknown' }),
    from: cell(p.from.label),
    subject: cell(p.subject.trim() || 'Trade proposal'),
    theySend: p.theySend.players.map((b) => briefPlayer(b, p.from.team_id)),
    weSend: p.weSend.players.map((b) => briefPlayer(b, ctx.orgId)),
    reading,
    deal: { sent: p.weSend.players.map((b) => b.player_id), received: p.theySend.players.map((b) => b.player_id) },
    review: cell('Review This Offer', { hint: 'Puts both sides on the builder, as the offer has them' }),
  };
}

/** A player's contract value in a few words, or the short reason it is not known (`glance`). */
function glanceClaim(ctx: TradesContext, v: ValueGlance, stamp: CalibrationStamp) {
  const fmt = amountFor(v.unit);
  if (v.status !== 'known' || v.low === null || v.high === null) {
    return claim({ text: v.reason ?? 'Not valued yet.', tone: 'unknown', links: [], basis: valueBasis(ctx, stamp, [], [v.reason ?? 'Not established.']) });
  }
  const f: TradeFigure = { low: v.low, central: v.central, high: v.high, centralRange: v.centralRange };
  return claim({
    text: `Contract value most likely ${likelyText(f, fmt)} (could be ${spanText(f, fmt)})`,
    tone: 'neutral',
    ...(v.central !== null ? { value: servedValue(v.central, v.unit === 'wins' ? 'wins' : 'dollars', fmt(v.central), { low: v.low, high: v.high }) } : {}),
    links: [],
    basis: valueBasis(ctx, stamp, lines([['Contract value', "What this contract is worth to any team that holds it: the wins he's projected to add, priced at what a win costs on this league's market, minus the salary still to be paid."]])),
  });
}

function talkOf(ctx: TradesContext, t: TradeTalkItem, stamp: CalibrationStamp): TradeTalkTarget {
  const p = t.player;
  return {
    id: `talk-${t.message_id}`,
    date: cell(gameDateDisplay(t.date) ?? 'Date not known', t.date ? {} : { tone: 'unknown' }),
    subject: cell(t.subject.trim() || 'Trade talk'),
    club: cell(t.otherTeam.label),
    player: { player: playerOf(p.player_id, p.name, t.otherTeam.orgId), line: cell(metaLine([p.positionName, p.age, t.otherTeam.label]) || 'Not placed in the export') },
    value: glanceClaim(ctx, p.value, stamp),
    control: cell(metaLine([p.control, p.salaryNow ? `${money(p.salaryNow.amount)} in ${p.salaryNow.season}` : null])),
    deal: { sent: [], received: [p.player_id] },
    review: cell('Review This Target', { hint: 'Puts him on the side you would receive; what he costs is yours to fill in' }),
  };
}

function fitLine(text: string, players: Array<{ player_id: number; name: string; wins: number }>, teamId: number): TradeFitLine {
  return {
    text: cell(text),
    players: players.map((p) => ({ player: { player: playerOf(p.player_id, p.name, teamId), line: cell(fitWins(p.wins)) }, wins: cell(fitWins(p.wins)) })),
  };
}

function fitsView(ctx: TradesContext, fits: TradeFits | null): TradeFitsView {
  if (!fits) {
    return { weakest: null, clubs: [], empty: cell('Fits are read for a major-league club, and this club isn\'t one in the export.') };
  }
  const spots = fits.myWeakest.map((w) => `${w.positionName} (${w.best.name}, ${fitWins(w.best.wins)})`).join(', ');
  const weakest = claim({
    text: spots ? `Your weakest spots by expected wins: ${spots}` : 'No weakest spots could be read: no starter\'s production is established.',
    tone: spots ? 'neutral' : 'unknown',
    links: [],
    basis: policyBasis(ctx, PLAYER_VALUE, lines([['How fits are read', TIP_FITS], ['What the wins are', fits.basis]])),
    ...(fits.notEstablished.length > 0 ? { hint: `Not established: ${fits.notEstablished.join(', ')}`.slice(0, 75) } : {}),
  });
  const clubs: TradeFitClub[] = fits.fits.map((f) => ({
    teamId: f.orgId,
    club: cell(f.label),
    matches: cell(matchesText(f.matches)),
    theyNeed: f.theyNeed.map((n) => fitLine(`They're thin at ${n.positionName} (best: ${n.theirBest.name}, ${fitWins(n.theirBest.wins)}); you have`, n.myCandidates, ctx.orgId)),
    theyOffer: f.theyOffer.map((o) => fitLine(`You're thin at ${o.positionName} (${o.myBest.name}, ${fitWins(o.myBest.wins)}); they have`, o.players, f.orgId)),
  }));
  return { weakest, clubs, empty: clubs.length === 0 ? cell('No club has a match either way right now.') : null };
}

/** Whether the AI desk is on, and who would answer (`/api/trade/voice/:orgId`). */
export interface TradeAiState {
  available: boolean;
  voice: { name: string; role: string };
  /** Why it is off, in a sentence (no key for the provider chosen for trades). */
  offReason: string | null;
}

export function tradeDeskAi(ctx: TradesContext, ai: TradeAiState): TradeDeskAI {
  const first = ai.voice.name.split(' ')[0] || ai.voice.name;
  const named = ai.voice.name !== 'the front office';
  return {
    available: ai.available,
    voice: cell(named ? `${ai.voice.name} · ${ai.voice.role}` : 'The front office'),
    ask: cell(named ? `Ask ${ai.voice.name}` : 'Ask the Front Office'),
    followUp: cell(named ? `Ask ${first} a follow-up` : 'Ask a follow-up'),
    off: ai.available ? null : claim({
      text: 'AI is off. Everything on the desk works without it.',
      tone: 'neutral',
      hint: 'Add a key in Settings to ask the front office about a deal',
      links: [],
      basis: basis({
        because: lines([
          ['Why', ai.offReason ?? 'No AI key is set for trades.'],
          ['What still works', 'Building a deal, its figures and the difference between the sides, the offers, the trade talk and the league\'s fits are all worked out by Pennant itself.'],
        ]),
        source: source(ctx, 'Settings'), unknown: [], wouldChange: ['An AI key in Settings.'], lean: null, certainty: 'fact',
      }),
    }),
    note: claim({
      text: 'The AI explains the figures above. It decides nothing.',
      tone: 'neutral',
      links: [],
      basis: policyBasis(ctx, 'The front office', lines([
        ['What it is given', 'The deal on the builder with every figure Pennant worked out for it, and the run of the organization to look things up.'],
        ['What it is not', 'Pennant\'s answer: the analysis is. It reads the deal and gives no answer of yes or no: the decision is yours.'],
      ])),
    }),
  };
}

export interface TradeDeskInput {
  fits: TradeFits | null;
  proposals: TradeProposal[];
  talk: TradeTalkItem[];
  ai: TradeAiState;
  freshness: FreshnessCue;
  stamp: CalibrationStamp;
}

export function tradeDeskView(ctx: TradesContext, input: TradeDeskInput): TradeDeskView {
  return {
    ...headOf(ctx),
    lede: claim({
      text: 'Build a deal and see what each side is worth. The decision is yours.',
      tone: 'neutral',
      links: [],
      basis: policyBasis(ctx, PLAYER_VALUE, lines([
        ['How to read it', 'Put the players you would send on one side and the ones you would receive on the other: drag them in from anywhere, search, or load an offer or a target from your inbox. Each player shows what his contract is worth, and below, the difference between the sides.'],
        ['What it is not', 'A verdict. It reads contract value only: not fit, need, or what the other club wants.'],
      ])),
    }),
    sides: { sent: cell(sideTitle(ctx.club, 'send')), received: cell(sideTitle(ctx.club, 'receive')) },
    emptyDeal: cell('Add players to each side to see what the deal is worth: drag them here, search, or load an offer or a target.'),
    builder: {
      find: { sent: cell('Find a player to send'), received: cell('Find a player to receive') },
      remove: cell('Take him off the deal'),
      weighing: cell('Weighing the deal'),
    },
    offers: input.proposals.map((p) => offerOf(ctx, p, input.stamp)),
    offersNote: claim({
      text: 'Proposals in your OOTP inbox. Check the sides against the mail.',
      tone: 'neutral',
      links: [],
      basis: factBasis(ctx, THE_INBOX, lines([['How the sides are read', "The message doesn't store which way each player goes, so the sides are worked out from who each one plays for now."]])),
    }),
    talk: input.talk.map((t) => talkOf(ctx, t, input.stamp)),
    talkNote: claim({
      text: 'Targets your staff has raised, newest first.',
      tone: 'neutral',
      links: [],
      basis: factBasis(ctx, THE_INBOX, lines([['What a message says', "OOTP's messages name the player and the club but never the price, so reviewing one puts him on the side you'd receive and leaves what you give up to you."]])),
    }),
    fits: fitsView(ctx, input.fits),
    ai: tradeDeskAi(ctx, input.ai),
    freshness: freshnessClaim(ctx, input.freshness),
  };
}

// ── a deal, weighed ─────────────────────────────────────────────────────────

const unitOf = (unit: TradeUnit | null) => (unit === 'wins' ? 'wins' as const : 'dollars' as const);

function figureValue(f: TradeFigure, unit: TradeUnit | null, fmt: Fmt) {
  const n = f.central ?? (f.centralRange ? (f.centralRange.low + f.centralRange.high) / 2 : null);
  if (n === null) return {};
  // The most likely reading's own words, never a midpoint said as one: a stretch keeps "to" in its display
  return { value: servedValue(Math.min(Math.max(n, f.low), f.high), unitOf(unit), likelyText(f, fmt), { low: f.low, high: f.high }) };
}

function controlClaim(ctx: TradesContext, r: TradeRow) {
  const path = r.control.path.map((s) => ({ label: String(s.season), value: `${s.label}, ${s.costText}${s.ifHeld ? ' (if kept)' : ''}` }));
  return claim({
    text: r.control.text,
    tone: r.control.controlled === null && r.control.path.length === 0 ? 'unknown' : 'neutral',
    links: [],
    basis: basis({
      because: path.length ? path : [{ label: 'Control', value: r.control.text }],
      source: source(ctx, 'Player Rights'), unknown: r.control.controlled === null ? ['How long the club controls him is not established.'] : [],
      wouldChange: ['A newer export, or a new contract.'], lean: null, certainty: 'fact',
    }),
  });
}

function productionClaim(ctx: TradesContext, r: TradeRow, stamp: CalibrationStamp) {
  const p = r.production;
  if (!p.now) {
    return claim({ text: 'Production not established', tone: 'unknown', links: [], basis: valueBasis(ctx, stamp, [], [p.reason ?? 'Not established.']) });
  }
  const now = `${fitWins(p.now.wins.central)} ${p.now.part === 'rest_of_season' ? `rest of ${p.now.season}` : `in ${p.now.season}`}`;
  const text = p.next ? `${now} · ${fitWins(p.next.wins.central)} in ${p.next.season}` : now;
  const band = (w: { low: number; high: number }) => `${fitWins(w.low)} to ${fitWins(w.high)}`;
  return claim({
    text,
    tone: 'neutral',
    value: servedValue(p.now.wins.central, 'wins', fitWins(p.now.wins.central), { low: p.now.wins.low, high: p.now.wins.high }),
    links: [],
    basis: valueBasis(ctx, stamp, lines([
      ['Expected wins', TIP_EXPECTED],
      [`${p.now.season}`, `likely ${band(p.now.wins)}`],
      [p.next ? `${p.next.season}` : 'Next season', p.next ? `likely ${band(p.next.wins)}` : p.nextReason],
    ])),
  });
}

function dealRow(ctx: TradesContext, r: TradeRow, v: TradePlayerValue | null, unit: TradeUnit | null, stamp: CalibrationStamp): TradeDealRow {
  const fmt = amountFor(unit);
  const valued = v !== null && v.counted && v.contract !== null;
  const value = valued
    ? claim({
      text: likelyText(v!.contract!, fmt),
      tone: 'neutral',
      ...figureValue(v!.contract!, unit, fmt),
      links: [],
      basis: valueBasis(ctx, stamp, lines([
        ['Contract value', "What this contract is worth to any team that holds it: the wins he's projected to add, priced at what a win costs on this league's market, minus the salary still to be paid. Seasons further out count a little less."],
        ['Could be', `${spanText(v!.contract!, fmt)}: every reasonable combination of how he plays, what a win costs and what he'll be paid; a range of outcomes, not a forecast.`],
        ['Depends on', v!.dependsOn],
      ])),
    })
    : claim({
      text: 'Not valued',
      tone: 'unknown',
      links: [],
      basis: valueBasis(ctx, stamp, [], [v?.reason ?? v?.notCounted ?? 'Not established.']),
    });
  const range = valued
    ? cell(`could be ${spanText(v!.contract!, fmt)}`, v!.dependsOn ? tag(`Depends on ${v!.dependsOn}`) : {})
    : cell(v?.notCounted ?? 'Not valued yet.', { tone: 'unknown', ...tag(v?.reason) });
  const keeping = valued && v!.keeping
    ? claim({
      text: `Keeping him ${likelyText(v!.keeping, fmt)}`,
      tone: 'neutral',
      links: [],
      basis: valueBasis(ctx, stamp, lines([['Keeping him', TIP_KEEPING_ROW], ['Could be', spanText(v!.keeping, fmt)]])),
    })
    : null;
  const lean = valued && v!.ours?.leaning && v!.ours.contract ? v!.ours : null;
  const ours = lean
    ? claim({
      text: `Our view ${likelyText(lean.contract!, fmt)}: ${lean.leans.map((l) => l.short).join('; ')}`,
      tone: 'neutral',
      links: [],
      basis: basis({
        because: lean.leans.length ? lean.leans.map((l) => ({ label: l.short, value: l.text })) : [{ label: 'Our view', value: TIP_OUR_VIEW_DEAL }],
        source: source(ctx, 'Organizational Philosophy'), unknown: [], wouldChange: ['A change to the club\'s philosophy.'],
        lean: { neutral: likelyText(v!.contract!, fmt), why: lean.leans.map((l) => l.text) },
        certainty: 'policy', stamp: 'The club\'s philosophy settings',
      }),
    })
    : null;
  return {
    player: playerOf(r.playerId, r.name, r.organizationId),
    line: cell(metaLine([r.position, r.age, r.teamAbbr ?? r.team]) || 'Not placed in the export'),
    listed: r.listed ? cell('Listed', { hint: 'His club has put him on the trading block' }) : null,
    value,
    range,
    control: controlClaim(ctx, r),
    production: productionClaim(ctx, r, stamp),
    keeping,
    ifKept: valued && v!.ifHeld.length > 0 ? cell(`${listSeasons(v!.ifHeld)} if kept`, { hint: 'Counts only if he stays: he could leave, or be let go, first' }) : null,
    ours,
  };
}

function totalClaim(ctx: TradesContext, t: TradeSideTotal, fmt: Fmt, unit: TradeUnit | null, stamp: CalibrationStamp): Claim | null {
  if (t.status !== 'known' || !t.figure) {
    return t.excluded.length > 0
      ? claim({ text: 'No one on this side could be valued yet.', tone: 'unknown', links: [], basis: valueBasis(ctx, stamp, [], t.excluded.map((x) => x.reason)) })
      : null;
  }
  return claim({
    text: `Together ${likelyText(t.figure, fmt)} · could be ${spanText(t.figure, fmt)}`,
    tone: 'neutral',
    ...figureValue(t.figure, unit, fmt),
    links: [],
    basis: valueBasis(ctx, stamp, lines([
      ['Together', TIP_TOGETHER],
      ['Every player at his lowest and highest at once', t.edges ? spanText(t.edges, fmt) : null],
      ['How the side is added up', t.text],
    ]), t.excluded.map((x) => x.reason)),
  });
}

function sideOf(ctx: TradesContext, a: TradeAnalysis, id: 'sent' | 'received', title: string, stamp: CalibrationStamp): TradeDealSide {
  const unit = a.value.unit;
  const fmt = amountFor(unit);
  const rows = a[id].map((r) => dealRow(ctx, r, a.value[id].players.find((p) => p.playerId === r.playerId) ?? null, unit, stamp));
  const names = new Map(a[id].map((r) => [r.playerId, r.name]));
  const total = a.value[id].total;
  const out = total.excluded.map((x) => names.get(x.playerId) ?? 'a player');
  return {
    id,
    title: cell(title),
    rows,
    total: rows.length ? totalClaim(ctx, total, fmt, unit, stamp) : null,
    leavesOut: out.length && total.status === 'known' ? cell(`Leaves out ${out.join(', ')} (not valued yet).`) : null,
    empty: rows.length ? null : cell('No players yet.'),
  };
}

function chartOf(f: TradeFigure, unit: TradeUnit | null, fmt: Fmt): TradeRangeChart {
  const s = scaleOf(f);
  const sf = signed(fmt);
  return {
    unit: unitOf(unit),
    low: f.low,
    high: f.high,
    likelyLow: s.likelyLow,
    likelyHigh: s.likelyHigh,
    scaleLow: s.low,
    scaleHigh: s.high,
    zero: cell('even', { hint: 'Zero is an even deal' }),
    left: cell('← More going out'),
    right: cell('More coming in →'),
    summary: cell(holdsEven(f)
      ? `Coming in less going out: ${evenDealText(f, sf, false)}. Zero is an even deal.`
      : `Coming in less going out: most likely ${likelyText(f, sf)}, could be ${spanText(f, sf)}. Zero is an even deal.`),
    marks: [cell(`Lowest ${sf(f.low)}`), cell(`Most likely ${likelyText(f, sf)}`), cell(`Highest ${sf(f.high)}`)],
  };
}

const PART_COLUMNS: MlbColumn[] = [
  { id: 'player', title: cell('Player'), numeric: false },
  { id: 'side', title: cell('Side'), numeric: false },
  { id: 'likely', title: cell('Most likely'), numeric: true },
  { id: 'could', title: cell('Could be'), numeric: true },
];

function differenceOf(ctx: TradesContext, a: TradeAnalysis, stamp: CalibrationStamp): TradeDifferenceView {
  const v = a.value;
  const d = v.difference;
  const fmt = amountFor(v.unit);
  const sf = signed(fmt);
  const rows = new Map([...a.sent, ...a.received].map((r) => [r.playerId, r]));
  const name = (id: number) => rows.get(id)?.name ?? 'a player';
  const known = d.status === 'known' && d.figure !== null;
  const restsOn = v.basis;
  const headline = known
    ? claim({
      text: holdsEven(d.figure!)
        ? evenDealText(d.figure!, sf)
        : `Most likely ${likelyText(d.figure!, sf)}${d.figure!.central === null ? ' depending on how an open season goes' : ''} · could be ${spanText(d.figure!, sf)}`,
      tone: 'neutral',
      ...figureValue(d.figure!, v.unit, sf),
      links: [],
      basis: valueBasis(ctx, stamp, lines([
        ['The difference', TIP_DIFFERENCE],
        ['The chart', TIP_BAR],
        ['Every player at his lowest and highest at once', d.edges ? spanText(d.edges, sf) : null],
        ['How the sides are added up', d.text],
        ...restsOn.map((b, i) => [i === 0 ? 'What it rests on' : 'And', b] as const),
      ]), d.excluded.map((x) => x.reason), ['A change to either side, or a newer export.']),
    })
    : claim({
      text: 'Not a number yet: no one on one side could be valued.',
      tone: 'unknown',
      links: [],
      basis: valueBasis(ctx, stamp, [], [d.reason ?? 'Not established.']),
    });
  const parts: MlbTable | null = known && d.components.length > 0
    ? {
      columns: PART_COLUMNS,
      rows: d.components.map((c, i): MlbRow => {
        const r = rows.get(c.playerId);
        const cells = {
          player: cell(name(c.playerId)),
          side: cell(c.side === 'sent' ? 'Going out' : 'Coming in'),
          likely: cell(likelyText(c.part, sf)),
          could: cell(spanText(c.part, sf)),
        };
        const sort = {
          player: name(c.playerId),
          side: c.side === 'sent' ? 0 : 1,
          likely: c.part.central ?? (c.part.centralRange ? c.part.centralRange.low : null),
          could: c.part.low,
        };
        return { ...row(`part-${c.side}-${c.playerId}-${i}`, cells, sort), player: r ? playerOf(r.playerId, r.name, r.organizationId) : null, detail: [], actions: [] };
      }),
      empty: null,
    }
    : null;
  const leavesOut = d.excluded.length
    ? cell(`Leaves out ${d.excluded.map((x) => `${name(x.playerId)} (${x.reason.replace(/^Not valued( yet)?:\s*/i, '').replace(/\.$/, '').toLowerCase() || 'not valued yet'})`).join('; ')}.`)
    : null;
  return {
    title: cell(v.unit === 'wins' ? 'Coming in less going out, in wins' : 'Coming in less going out'),
    headline,
    chart: known ? chartOf(d.figure!, v.unit, fmt) : null,
    leavesOut,
    inWins: v.unit === 'wins' && v.unitReason
      ? claim({ text: 'Shown in wins: dollars aren\'t known for everyone in this deal.', tone: 'caution', links: [], basis: valueBasis(ctx, stamp, lines([['Why in wins', v.unitReason]])) })
      : null,
    parts,
    partsNotes: parts ? [
      cell('Each player\'s figures are the ones on his player window; a player going out counts with his range reversed.'),
      cell('Seasons further out count a little less, and only the part of this season still to be played counts.'),
      cell('The range covers the reasonable readings of each player; it isn\'t a forecast with a stated chance.'),
    ] : [],
  };
}

function ourViewClaim(ctx: TradesContext, a: TradeAnalysis): Claim | null {
  const ov = a.value.ourView;
  const club = a.organization?.name ?? ctx.club;
  if (!ov) return null;
  const sf = signed(amountFor(a.value.unit));
  if (ov.leaning && ov.difference.figure) {
    return claim({
      text: holdsEven(ov.difference.figure)
        ? `Our view (${club}): ${evenDealText(ov.difference.figure, sf, false)}`
        : `Our view (${club}): most likely ${likelyText(ov.difference.figure, sf)} · could be ${spanText(ov.difference.figure, sf)}`,
      tone: 'neutral',
      links: [],
      basis: basis({
        because: lines([['Our view', TIP_OUR_VIEW_DEAL]]),
        source: source(ctx, 'Organizational Philosophy'), unknown: [], wouldChange: ['A change to the club\'s philosophy.'],
        lean: { neutral: a.value.difference.figure ? likelyText(a.value.difference.figure, sf) : 'Not a number yet', why: ['Each lean is named on its player.'] },
        certainty: 'policy', stamp: 'The club\'s philosophy settings',
      }),
    });
  }
  return claim({
    text: `${club}${club.endsWith('s') ? '\'' : '\'s'} philosophy doesn't lean on these players: our view is the same.`,
    tone: 'neutral',
    links: [],
    basis: basis({
      because: lines([['Our view', TIP_OUR_VIEW_DEAL]]),
      source: source(ctx, 'Organizational Philosophy'), unknown: [], wouldChange: ['A change to the club\'s philosophy.'], lean: null,
      certainty: 'policy', stamp: 'The club\'s philosophy settings',
    }),
  });
}

function salaryClaim(ctx: TradesContext, a: TradeAnalysis) {
  const s = a.salary;
  const part = (side: typeof s.sent, words: string) => `${money(side.known)} ${words}${side.unknown.length > 0 ? ` (${side.unknown.length} not known)` : ''}`;
  const season = s.sent.season ?? s.received.season;
  const unknown = s.sent.unknown.length + s.received.unknown.length;
  return claim({
    text: `Salary${season ? ` in ${season}` : ' this season'}: ${part(s.sent, 'going out')} · ${part(s.received, 'coming in')}`,
    tone: unknown > 0 ? 'caution' : 'neutral',
    links: [],
    basis: factBasis(ctx, 'The export', lines([['Salary', TIP_SALARY]]), unknown > 0 ? [`${unknown === 1 ? 'One salary isn\'t' : `${unknown} salaries aren't`} in the export; never counted as zero.`] : []),
  });
}

export function tradeAnalysisView(ctx: TradesContext, a: TradeAnalysis, deal: TradeDeal): TradeAnalysisView {
  const stamp = a.value.stamp;
  const sides = [
    sideOf(ctx, a, 'sent', sideTitle(ctx.club, 'send'), stamp),
    sideOf(ctx, a, 'received', sideTitle(ctx.club, 'receive'), stamp),
  ];
  const sentEmpty = deal.sent.length === 0;
  const receivedEmpty = deal.received.length === 0;
  const status = sentEmpty && receivedEmpty
    ? cell('Add players to each side to see what the deal is worth: drag them here, search, or load an offer or a target.')
    : sentEmpty ? cell('Add a player to the side you\'d send.')
      : receivedEmpty ? cell('Add a player to the side you\'d receive.') : null;
  const weighed = status === null;
  return {
    ...headOf(ctx),
    deal,
    sides,
    status,
    difference: weighed ? differenceOf(ctx, a, stamp) : null,
    ourView: weighed ? ourViewClaim(ctx, a) : null,
    salary: weighed ? salaryClaim(ctx, a) : null,
    freshness: freshnessClaim(ctx, a.freshness),
  };
}

/** The AI desk's answer, marked as its own words (D-001: it explains the analysis; it decides nothing). */
export function tradeAnswerAbout(ctx: TradesContext, voice: { name: string; role: string }, tone: Tone = 'neutral') {
  return claim({
    text: `${voice.name === 'the front office' ? 'The front office' : voice.name}'s read, written by AI from the figures above.`,
    tone,
    links: [],
    basis: basis({
      because: lines([
        ['What it was given', 'The deal on the builder with every figure Pennant worked out for it, and the run of the organization to look things up.'],
        ['What it is', 'An explanation of Pennant\'s analysis in a staff member\'s voice. It decides nothing, and the decision is yours.'],
      ]),
      source: source(ctx, 'The front office'), unknown: ['An AI can be wrong about what it reads; the figures above are Pennant\'s own.'],
      wouldChange: ['A change to either side, or another question.'], lean: null, certainty: 'unknown',
    }),
  });
}
