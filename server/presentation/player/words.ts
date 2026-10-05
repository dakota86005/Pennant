/**
 * The player window's words (N11): what the React card wrote on the client (`src/costBand.ts`, `src/valueWords.ts`,
 * `src/productionConeGeometry.ts`, `src/ratingScale.ts`, `src/ValueSection.tsx`, `src/PlayerHeaderValue.tsx`,
 * `src/ProductionCone.tsx`, `src/PlayerRights.tsx`), moved to the server so the Mac app writes none of it (D-056). The
 * React card keeps its own copy until the cutover (D-066's precedent); these say the same things, in the GM's words, and
 * keep the method words (`central`, `band`, `edge`, `surplus`, `retention`, ...) off the screen: they are in the bases.
 * Nothing here computes a figure about a player: every number is Player Value's, Player Rights' or the export's, as handed in.
 */

// ── numbers ──────────────────────────────────────────────────────────────────

/** Dollars at a precision: millions to `digits` places, or thousands below a million. */
function dollars(v: number, digits: number): string {
  if (v === 0) return '$0';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(digits)}M`;
  return `$${Math.round(v / 1_000)}K`;
}

/** One figure as the pages print money: "$8.5M", "$780K". */
export const money = (v: number): string => dollars(v, 1);

/** Signed money: "$28.0M", "−$9.0M". */
export const signedMoney = (v: number): string => (v < 0 ? `−${money(-v)}` : money(v));

/** A price of a win to the hundredth of a million: "$7.25M". */
export const perWin = (v: number): string => `$${(v / 1_000_000).toFixed(2)}M`;

/**
 * "$4.6M–$25.3M", "$780K–$790K", or "$9.0M" for a point. Ends that differ never print alike: a range whose ends round to
 * the same tenth of a million prints to the hundredth (`src/costBand.ts`).
 */
export function costRangeText(low: number, high: number): string {
  if (low === high) return dollars(low, 1);
  for (const digits of [1, 2, 3]) {
    const a = dollars(low, digits);
    const b = dollars(high, digits);
    if (a !== b) return `${a}–${b}`;
  }
  return `${dollars(low, 3)}–${dollars(high, 3)}`;
}

/**
 * A number with a true minus sign, one decimal. A value that is not zero but rounds to it prints "<0.1" (or "−<0.1"), so a
 * range just above replacement never reads as touching it (`src/chartTheme.ts`).
 */
export function signedTenths(v: number): string {
  if (!Number.isFinite(v)) return 'not known';
  const text = v.toFixed(1);
  if (Number(text) === 0) {
    if (v === 0) return '0.0';
    return v > 0 ? '<0.1' : '−<0.1';
  }
  return text.replace('-', '−');
}

/** "3.1 wins", "<0.1 wins". */
export const winsText = (v: number): string => `${signedTenths(v)} wins`;

/** "$A to $B", or one figure where the ends meet. */
export const rangeText = (low: number, high: number, fmt: (v: number) => string): string =>
  (low === high ? fmt(low) : `${fmt(low)} to ${fmt(high)}`);

/** "2026–2030", or one season. */
export const seasonsText = (from: number | null, to: number | null): string =>
  (from === null ? '' : from === to || to === null ? `${from}` : `${from}–${to}`);

/** Seasons as a list: "2027–2029" when consecutive, else "2027, 2029". */
export function listSeasons(ys: readonly number[]): string {
  if (ys.length <= 1) return ys.join('');
  const sorted = [...ys].sort((a, b) => a - b);
  return sorted.every((y, i) => i === 0 || y === sorted[i - 1] + 1) ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(', ');
}

/** A rate the way a box score prints it: ".281", "1.012". */
export const rate3 = (n: number | null | undefined): string | null =>
  (n === null || n === undefined || !Number.isFinite(n) ? null : n.toFixed(3).replace(/^0\./, '.'));

/** "1 game", "4 games". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Upper-cases a sentence's first letter. */
export const capitalized = (text: string): string => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text);

/** Lower-cases a served reason's first letter, so it reads after a colon. */
export const afterColon = (t: string): string => (t.length > 0 ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);

/** A sentence ends with one full stop. */
export const sentence = (t: string): string => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** "1st", "2nd", "3rd". */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const tens = r % 100;
  if (tens >= 11 && tens <= 13) return `${r}th`;
  return `${r}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th'}`;
}

// ── the hovers, in the GM's words (`src/ValueSection.tsx`, `src/PlayerHeaderValue.tsx`) ──────────────────────

export const TIP_CONTRACT =
  "His deal as the export states it: this season's salary, the last season it covers (a signed extension included), and " +
  "what happens after this season: signed, an option, arbitration, pre-arbitration or free agency, with when the club's " +
  'control of him ends. Options and a no-trade clause are listed where the export records them.';
export const TIP_SCOUTED =
  "Your scouts' grades for his tools, averaged on the rating scale: what he is now, and his ceiling. It's the " +
  "organization's own view. It isn't the game's hidden rating of him, which weighs the tools by position and isn't " +
  "something your front office can see. Where a tool hasn't been graded, the average is left blank rather than guessed.";
export const TIP_COULD_BE =
  "The range covers every reasonable combination of how he plays, what a win costs and what he'll be paid. It is " +
  'deliberately wide: a range of outcomes, not a forecast.';
export const TIP_CONTRACT_VALUE =
  "What this contract is worth to any team that holds it: the wins he's projected to add, priced at what a win costs on " +
  "this league's free-agent market, minus the salary still to be paid. Seasons further out count a little less (5% a " +
  "year). Positive means he's worth more than he's paid; negative means he's paid more than his wins are worth. This is " +
  'the view that matters in a trade.';
export const TIP_KEEPING_HIM =
  'Keeping him compared with replacing him with a minimum-salary player. Money you owe either way (a guaranteed contract ' +
  "is paid even if he's released) doesn't count, because it's spent no matter what; so a big contract never makes " +
  "keeping him look better or worse. Only costs you'd avoid by moving on count, like future arbitration raises or an " +
  "option you'd pick up. Positive means he's still the better use of the roster spot. Salary already paid this season " +
  'counts in neither view.';
export const TIP_WINS_ONLY = "This league's dollars aren't known here, so his value is his projected wins above a minimum-salary replacement.";
export const TIP_IF_KEPT = 'Counts only if the club keeps him that season: he could leave, or be let go, first.';
export const TIP_NO_SINGLE =
  "There's no single most likely figure: it depends on a season that could go more than one way (an option, or whether " +
  'he stays).';
export const TIP_OUR_VIEW =
  "The same figures read through the club's philosophy: it can weigh near seasons against far ones, read the ranges more " +
  'cautiously, and weigh his salary, club control and guaranteed money more or less. It never changes the figures ' +
  'above, and every difference is listed with how much it moved.';
export const TIP_CONTACT =
  'Measured from every batted ball he has hit: OOTP records the exit velocity and launch angle of each one and shows ' +
  'none of it. Strikeouts and walks are left out: they have no batted ball.';
export const TIP_SPLITS =
  'Cut from the base-out state recorded on every plate appearance. Single-season splits are small samples: read the ' +
  'plate-appearance column before drawing a conclusion from any line here.';

// ── his contract (`src/PlayerHeaderValue.tsx`, `src/valueWords.ts`) ───────────────────────────────────────

export interface ControlEndInput {
  low: number | null;
  high: number | null;
  pastHorizon: boolean;
  optOutBefore: number | null;
  laterUnknown: boolean;
  heldThrough?: number | null;
  reason: string | null;
}

/** When his control ends, in a phrase: "Free agent after 2028", "Free agent after 2026 or 2027", "Controlled past 2032". */
export function controlEndWords(end: ControlEndInput): { text: string; known: boolean } {
  if (end.high === null && end.laterUnknown && end.low !== null) return { text: `Free agent after ${end.low} at the earliest`, known: true };
  if (end.high === null && end.heldThrough != null) return { text: `Controlled through ${end.heldThrough} at least`, known: true };
  if (end.high === null) return { text: 'End of control not known', known: false };
  if (end.pastHorizon) {
    const out = end.optOutBefore !== null ? `, unless he opts out before ${end.optOutBefore}` : '';
    return { text: `Controlled past ${end.high}${out}`, known: true };
  }
  if (end.low === null || end.low === end.high) return { text: `Free agent after ${end.high}`, known: true };
  if (end.high - end.low === 1) return { text: `Free agent after ${end.low} or ${end.high}`, known: true };
  return { text: `Free agent after ${end.low} at the earliest, ${end.high} at the latest`, known: true };
}

export interface ContractSummaryInput {
  standing: string;
  kind: 'major_league' | 'minor_league' | null;
  thisSeason: number | null;
  salaryNow: number | null;
  salaryNote: string | null;
  signedThrough: number | null;
  extension: { from: number; to: number } | null;
  clauses: string[];
  clauseNotes?: string[];
  after: { status: string; phrase: string; detail: string | null } | null;
  controlEnd: ControlEndInput;
}

/** "$18.7M in 2026", or why this season's salary isn't shown. */
export function salaryLine(c: ContractSummaryInput): { text: string; why: string | null } {
  if (c.salaryNow !== null && c.thisSeason !== null) return { text: `${money(c.salaryNow)} in ${c.thisSeason}`, why: null };
  if (c.kind === 'minor_league') return { text: 'Minor-league deal', why: c.salaryNote };
  if (c.standing !== 'signed') return { text: 'No contract terms', why: c.salaryNote };
  return { text: 'Salary not known', why: c.salaryNote };
}

/** "Signed through 2028 (extension from 2027)", "Signed for 2026 only". */
export function termLine(c: ContractSummaryInput): string | null {
  if (c.signedThrough === null) return null;
  const ext = c.extension ? ` (extension from ${c.extension.from})` : '';
  return c.signedThrough === c.thisSeason ? `Signed for ${c.signedThrough} only` : `Signed through ${c.signedThrough}${ext}`;
}

/** What happens after this season, and when control ends, without saying the same thing twice. */
export function afterLine(c: ContractSummaryInput): { text: string; why: string | null } | null {
  const end = controlEndWords(c.controlEnd);
  const parts: string[] = [];
  if (c.after && c.after.status !== 'signed' && c.after.status !== 'extended') parts.push(c.after.phrase);
  if (!parts.includes(end.text)) parts.push(end.known ? end.text : 'end of control not known');
  if (parts.length === 0) return null;
  const why = [c.after?.detail, c.controlEnd.reason].filter((x): x is string => typeof x === 'string' && x.length > 0).join(' ') || null;
  return { text: capitalized(parts.join(' · ')), why };
}

// ── value totals (`src/ValueSection.tsx`) ───────────────────────────────────────────────────────────────

export interface TotalInput {
  status: 'known' | 'unknown';
  from: number | null;
  to: number | null;
  low: number | null;
  central: number | null;
  high: number | null;
  centralRange: { low: number; high: number } | null;
  missing: number[];
  reason: string | null;
  established: { from: number; to: number; low: number; central: number | null; high: number; centralRange: { low: number; high: number } | null } | null;
  ifHeld: boolean;
}

export interface SeasonInput {
  season: number;
  status: string;
  ifHeld: boolean;
  wins: { low: number; central: number; high: number } | null;
  cost: { low: number; central: number | null; high: number } | null;
  contract: ViewInput;
  retention: ViewInput;
}

export interface ViewInput {
  status: 'known' | 'unknown';
  reason: string | null;
  band: { low: number; central: number | null; high: number } | null;
  centrals: Array<{ reading: string; low: number; high: number }>;
  ifHeld: boolean;
}

/** What a total with no single most-likely figure depends on: an option, a status, or whether he stays. */
export function dependsOn(seasons: readonly SeasonInput[], pick: (s: SeasonInput) => ViewInput): string {
  const open = seasons.filter((s) => {
    const v = pick(s);
    return v.status === 'known' && v.band !== null && v.band.central === null;
  });
  if (open.length === 0) return 'how an open season goes';
  const words = open.map((s) => (/option|opt_out/.test(s.status) ? `the ${s.season} option`
    : s.status === 'indeterminate' ? `his ${s.season} status` : `whether he stays in ${s.season}`));
  return words.filter((w, i) => words.indexOf(w) === i).join(' and ');
}

/** The short reason a total is not valued: which seasons lack his pay or his production. */
export function notValuedLine(surplusStatus: string, seasons: readonly SeasonInput[], total: TotalInput): string {
  if (total.missing.length === 0) {
    if (surplusStatus === 'unknown') return "Not valued yet: his production isn't established.";
    return 'Not valued yet.';
  }
  const missing = seasons.filter((x) => total.missing.includes(x.season));
  const noWins = missing.filter((x) => x.wins === null).map((x) => x.season);
  const noPay = missing.filter((x) => x.wins !== null && x.cost === null).map((x) => x.season);
  const lastWins = seasons.filter((x) => x.wins !== null).map((x) => x.season).pop();
  const parts: string[] = [];
  if (noPay.length > 0) parts.push(`his pay for ${listSeasons(noPay)} isn't known`);
  if (noWins.length > 0) {
    parts.push(lastWins !== undefined && noWins.every((y) => y > lastWins)
      ? `his production is only projected through ${lastWins}`
      : `his production for ${listSeasons(noWins)} isn't established`);
  }
  const other = total.missing.filter((y) => !noWins.includes(y) && !noPay.includes(y));
  if (other.length > 0) parts.push(`${listSeasons(other)} ${other.length === 1 ? "isn't" : "aren't"} established`);
  return `Not valued yet: ${parts.join(', and ')}.`;
}

/** A total's headline and its range: "Most likely $28.0M", "$20.0M to $26.0M depending on the 2027 option". */
export function totalHeadline(total: TotalInput, fmt: (v: number) => string, seasons: readonly SeasonInput[], pick: (s: SeasonInput) => ViewInput): {
  text: string; couldBe: string | null; mostLikely: boolean;
} {
  const couldBe = total.low !== null && total.high !== null ? `could be ${rangeText(total.low, total.high, fmt)}${seasonsText(total.from, total.to) ? ` (${seasonsText(total.from, total.to)})` : ''}` : null;
  if (total.central !== null) return { text: `Most likely ${fmt(total.central)}`, couldBe, mostLikely: true };
  const r = total.centralRange ?? (total.low !== null && total.high !== null ? { low: total.low, high: total.high } : null);
  const figure = r ? rangeText(r.low, r.high, fmt) : 'not valued';
  return { text: `${figure} depending on ${dependsOn(seasons, pick)}`, couldBe, mostLikely: false };
}

// ── the cone (`src/ProductionCone.tsx`, `src/productionConeGeometry.ts`) ─────────────────────────────────

export interface ConeCostInput {
  status: string;
  label: string;
  cost: { low: number; high: number; central?: number | null } | null;
  costDetail: string;
  ifHeld: boolean;
  declined: { label: string; cost: { low: number; high: number } | null; ifHeld: boolean; status: string } | null;
}

/**
 * A season's cost: "$8.5M", "$4.6M–$25.3M if kept", "none (control ends)", "none (no club holds him)" or "not
 * established"; an option season adds its declined way.
 */
export function coneCostText(c: ConeCostInput): string {
  const declined = c.declined
    ? `; declined: ${c.declined.label}${c.declined.cost ? ` ${costRangeText(c.declined.cost.low, c.declined.cost.high)}${c.declined.ifHeld ? ' if kept' : ''}` : c.declined.status === 'free_agent' ? ' (no cost to this club)' : ' (cost not established)'}`
    : '';
  if (!c.cost) {
    if (c.status === 'unsigned') return 'none (no club holds him)';
    return /^Control ends/.test(c.costDetail) ? 'none (control ends)' : `not established${declined}`;
  }
  return `${costRangeText(c.cost.low, c.cost.high)}${c.ifHeld ? ' if kept' : ''}${declined}`;
}

/** Each range's words: what it is meant to hold, and whether this save's seasons have checked it. */
export function coneRangeWords(checked: boolean): { outer: string; inner: string; tip: string } {
  return checked
    ? {
      outer: '80% range', inner: '50% range',
      tip: "The wider range is meant to hold 8 seasons in 10 and the narrower 5 in 10, checked against this save's own seasons.",
    }
    : {
      outer: '80% range (not yet checked)', inner: '50% range',
      tip: "A range of outcomes not yet checked against how this save's players did, so not a claim 8 in 10 land inside it.",
    };
}

/** How often a range held its seasons: "80% target · 77% observed", or not measured. */
export function heldText(target: number, observed: number | null): string {
  return `${Math.round(target * 100)}% target · ${observed === null ? 'not measured on this save' : `${Math.round(observed * 100)}% observed`}`;
}

/** Expected playing time for a season, per side: "about 560 PA (400–650)". */
export const usageText = (u: { unit: string; low: number; central: number; high: number }): string =>
  `about ${Math.round(u.central).toLocaleString('en-US')} ${u.unit} (${Math.round(u.low).toLocaleString('en-US')}–${Math.round(u.high).toLocaleString('en-US')})`;

// ── ratings (`src/ratingScale.ts`) ─────────────────────────────────────────────────────────────────────

/** The bottom of each scale OOTP offers, for the bars and the chart (20–80, 1–20, 1–10, 2–8, 1–5). */
export function scaleLow(high: number): number {
  if (high === 80) return 20;
  if (high === 8) return 2;
  return 1;
}

/** "On the 20–80 scale". */
export const scaleWords = (low: number, high: number): string => `On the ${low}–${high} scale`;
