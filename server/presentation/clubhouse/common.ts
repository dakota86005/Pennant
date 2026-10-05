/**
 * What every clubhouse tool is built from (N9, D-069): its context (the department's, as N8's views have it), its head,
 * a player who opens, dates in words and the season's lines formatted the way the React pages format them. Pure: it
 * words what it is handed and reads nothing (D-056).
 */
import type { Cell, Certainty, ServedValue, Tone } from '../../contract/presentation.js';
import { basis, cell, claim, target } from '../claim.js';
import { sourceOf, type DepartmentContext } from '../frontOffice/desk.js';
import type { MlbPlayer, MlbViewHead } from '../majorLeague/types.js';
import type { StatDef } from '../statCatalog.js';

/** A clubhouse tool's context: the department's (its source, the build). */
export interface ClubhouseContext {
  ctx: DepartmentContext;
}

/** A player a tool names, opening his club (`teamId`: his organization's club, or the opponent's for their players). */
export function player(playerId: number, name: string, teamId: number | null): MlbPlayer {
  const open = playerId > 0 ? target({ kind: 'player', playerId, ...(teamId !== null && teamId > 0 ? { teamId } : {}) }) : null;
  return { playerId, name: name.trim() || 'Unnamed player', open };
}

/** A claim about a fact a tool reads (from the export, or the module behind the React page), with its evidence lines. */
export function factClaim(
  v: ClubhouseContext,
  text: string,
  input: {
    specialist: string;
    because: Array<{ label: string; value: string }>;
    tone?: Tone;
    hint?: string;
    unknown?: string[];
    wouldChange?: string[];
    /** How the reading is called: a fact by default; `policy` for a stated rule of the staff's (with its stamp). */
    how?: Certainty;
    stamp?: string;
    value?: ServedValue;
  },
) {
  const because = input.because.map((l) => ({ label: l.label.trim(), value: l.value.trim() })).filter((l) => l.label && l.value);
  const certainty = input.how ?? 'fact';
  return claim({
    text: text.trim(),
    tone: input.tone ?? 'neutral',
    ...(input.hint ? { hint: input.hint } : {}),
    ...(input.value ? { value: input.value } : {}),
    links: [],
    basis: basis({
      because: because.length ? because : [{ label: 'Read by', value: input.specialist }],
      source: sourceOf(v.ctx, input.specialist),
      unknown: input.unknown ?? [],
      wouldChange: input.wouldChange ?? [],
      lean: null,
      certainty,
      ...(certainty === 'fact' ? {} : { stamp: input.stamp ?? 'How the staff reads it: stated, not fitted' }),
    }),
  });
}

/** The head every clubhouse tool carries: its build, its title and the one line saying how to read it. */
export function head(v: ClubhouseContext, title: string, lede: { text: string; full: string; specialist: string }): MlbViewHead {
  return {
    orgId: v.ctx.build.orgId,
    importStamp: v.ctx.build.importStamp,
    reportStamp: v.ctx.build.reportStamp,
    title: cell(title),
    lede: claim({
      text: lede.text,
      tone: 'neutral',
      links: [],
      basis: basis({
        because: [{ label: 'How to read it', value: lede.full }],
        source: sourceOf(v.ctx, lede.specialist),
        unknown: [],
        wouldChange: [],
        lean: null,
        certainty: 'policy',
        stamp: 'How the staff reads it: stated, not fitted',
      }),
    }),
    yardsticks: null,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A game date as OOTP writes it (`2026-5-9`, unpadded) in words ("May 9"); the text as given when it is not one. */
export function dayWords(date: string | null | undefined, long = false): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((date ?? '').trim());
  if (!m) return (date ?? '').trim() || 'a date not in the export';
  const month = Number(m[2]);
  return `${(long ? MONTHS_LONG : MONTHS)[month - 1] ?? m[2]} ${Number(m[3])}`;
}

/** A game date's order (year, month, day as one number), for a sort key; null when it is not a date. */
export function dayOrder(date: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((date ?? '').trim());
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

export const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`;

/** A hand in words ("right-handed"), from the export's letter. */
export const HAND_WORDS: Readonly<Record<string, string>> = { R: 'right-handed', L: 'left-handed', S: 'switch' };

/**
 * A season line's value as the React pages format it (`src/stats.ts` `formatStat`): null when the line has none, and a
 * pitcher with a 0.00 ERA has an infinite ERA+.
 */
export function statText(def: StatDef, value: number | null | undefined, raw?: Record<string, number | null> | null): string | null {
  if (def.key === 'eraPlus' && (value === null || value === undefined) && raw && raw.era === 0 && (raw.ip ?? 0) > 0) return '∞';
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  switch (def.format) {
    case 'avg3': return value.toFixed(3).replace(/^0\./, '.').replace(/^-0\./, '-.');
    case 'dec1': return value.toFixed(1);
    case 'dec2': return value.toFixed(2);
    case 'pct': return `${value.toFixed(1)}%`;
    default: return String(Math.round(value));
  }
}

/**
 * A league-relative line's tone (OPS+, wRC+, ERA+: 100 is the league): good or bad once it is clearly off average, the
 * React pages' rule (`plusColor`: within about 7 of 100 reads as ordinary), never a tone for any other stat.
 */
export function plusTone(def: StatDef, value: number | null | undefined): Tone | undefined {
  if (def.format !== 'plus' || value === null || value === undefined || !Number.isFinite(value)) return undefined;
  const delta = Math.max(-60, Math.min(60, value - 100));
  if (Math.abs(delta) / 60 < 0.12) return undefined;
  return delta > 0 ? 'good' : 'bad';
}

/** A season line's cell: its value, or the served words for a line he does not have (never a zero). */
export function statCell(def: StatDef, value: number | null | undefined, raw: Record<string, number | null> | null, none: string): Cell {
  const text = statText(def, value, raw);
  if (text === null) {
    // He has a line, but not this part of it: not known. No line at all at this level is said as such (never a zero)
    const known = raw !== null || none !== 'No line';
    return cell(known ? 'Not known' : none, { tone: 'unknown', hint: known ? 'Not in his line this season' : 'No line at this level this season' });
  }
  const tone = plusTone(def, value);
  return cell(text, tone ? { tone } : {});
}

/** A season line's sort key: the value, or null (unknown sorts last) when he has none. */
export function statSort(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** A hint only when it fits a help tag (75 characters); a longer reason goes in a line or a basis, never cut. */
export const hintIf = (text: string | null | undefined): string | undefined => {
  const t = (text ?? '').trim();
  return t && t.length <= 75 ? t : undefined;
};
