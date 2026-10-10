/**
 * AI-written text in the served markdown subset (N13, D-074; `types.ts` has the subset), and its links.
 *
 * The models write markdown as they please: `##` headings, `-` bullets, now and then a rule or a quote. Swift reads the
 * served text with inline-only syntax, which would show those markers as they are, so they are rewritten here: a
 * heading becomes a line in bold, a bullet "• ", a quote's marker and a rule go. Inline markers pass through.
 *
 * Links are the server's: a player's or a club's full name, matched against the league's own index after the text is
 * complete (as the React app links names), becomes `[name](pennant://player/<id>)` with the target listed beside it. A
 * name two men share is linked only where exactly one of them is ours; otherwise it stays plain rather than open the
 * wrong man.
 */
import type { Integer } from '../../contract/primitives.js';
import { target } from '../claim.js';
import type { AiLink, AiText } from './types.js';

const HEADING = /^#{1,6}\s+/;
const BULLET = /^[-*+]\s+/;
const QUOTE = /^>\s?/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/** One line in the subset. */
function line(raw: string): string | null {
  const text = raw.replace(/\s+$/, '');
  if (RULE.test(text)) return null;
  const indent = /^\s*/.exec(text)![0];
  let body = text.slice(indent.length).replace(QUOTE, '');
  if (HEADING.test(body)) {
    const words = body.replace(HEADING, '').replace(/\*\*/g, '').replace(/\s*#+\s*$/, '').trim();
    return words ? `**${words}**` : null;
  }
  if (BULLET.test(body)) body = `• ${body.replace(BULLET, '')}`;
  return `${indent.length >= 2 ? '  ' : ''}${body}`;
}

/** The whole text in the subset: block markers rewritten, runs of blank lines folded to one, the ends trimmed. */
export function inSubset(markdown: string): string {
  const out: string[] = [];
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const l = line(raw);
    if (l === null) continue;
    if (l.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue;
    out.push(l.trim() === '' ? '' : l);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

/**
 * The subset while an answer streams: only a line's first few characters are held back, until they show whether the line
 * is a heading, a bullet, a quote or a rule, so the text keeps flowing. A heading is opened in bold at its start and closed
 * at its end. The final text (`inSubset`) replaces what was streamed, links and all.
 */
export class StreamedSubset {
  private held = '';
  private atStart = true;
  private inHeading = false;

  /** The next piece of text in the subset (possibly empty while a line's start is held). */
  push(delta: string): string {
    let out = '';
    for (const ch of delta) out += this.take(ch);
    return out;
  }

  /** Whatever is still held, at the end of the answer. */
  end(): string {
    const out = this.atStart ? this.resolve(true) : '';
    const close = this.inHeading ? '**' : '';
    this.inHeading = false;
    return out + close;
  }

  private take(ch: string): string {
    if (ch === '\n') {
      const pending = this.atStart ? this.resolve(true) : '';
      const close = this.inHeading ? '**' : '';
      this.inHeading = false;
      this.atStart = true;
      return `${pending}${close}\n`;
    }
    if (!this.atStart) return this.inHeading && ch === '*' ? '' : ch;
    this.held += ch;
    // Decided once the held start is no longer a possible marker, or long enough to be plain text
    if (!/^\s*(#{0,6}|[-*+_>]*)\s*$/.test(this.held) || this.held.length > 8) return this.resolve(false);
    return '';
  }

  private resolve(lineEnded: boolean): string {
    const held = this.held;
    this.held = '';
    this.atStart = false;
    if (lineEnded && RULE.test(held)) return '';
    const indent = /^\s*/.exec(held)![0];
    const body = held.slice(indent.length).replace(QUOTE, '');
    if (HEADING.test(body)) {
      this.inHeading = true;
      return `**${body.replace(HEADING, '').replace(/\*/g, '')}`;
    }
    if (BULLET.test(body)) return `${indent.length >= 2 ? '  ' : ''}• ${body.replace(BULLET, '')}`;
    return `${indent.length >= 2 ? '  ' : ''}${body}`;
  }
}

/** Who can be linked: the league's players (with whether he is ours and his organization's club) and its clubs. */
export interface LinkIndex {
  players: ReadonlyArray<{ id: Integer; name: string; ours: boolean; teamId: Integer | null }>;
  clubs: ReadonlyArray<{ teamId: Integer; name: string; nickname: string }>;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Matcher { pattern: RegExp; byName: Map<string, AiLink> }

const matchers = new WeakMap<LinkIndex, Matcher | null>();

function matcherOf(index: LinkIndex): Matcher | null {
  if (matchers.has(index)) return matchers.get(index)!;
  const byName = new Map<string, AiLink>();
  // Players: full names only (a surname alone would light up ordinary words); a shared name only where one man is ours
  const named = new Map<string, Array<LinkIndex['players'][number]>>();
  for (const p of index.players) {
    const name = p.name.trim().replace(/\s+/g, ' ');
    if (name.split(' ').length < 2) continue;
    named.set(name, [...(named.get(name) ?? []), p]);
  }
  for (const [name, men] of named) {
    const ours = men.filter((m) => m.ours);
    const man = men.length === 1 ? men[0] : ours.length === 1 ? ours[0] : null;
    if (!man) continue;
    byName.set(name, { url: `pennant://player/${man.id}`, text: name, target: target({ kind: 'player', playerId: man.id, teamId: man.teamId }) });
  }
  // Clubs: the full name ("Arizona Diamondbacks"), and the nickname after "the" where only one club has it
  const nicknames = new Map<string, number>();
  for (const c of index.clubs) nicknames.set(c.nickname, (nicknames.get(c.nickname) ?? 0) + 1);
  for (const c of index.clubs) {
    const link = (text: string): AiLink => ({ url: `pennant://club/${c.teamId}`, text, target: target({ kind: 'club', teamId: c.teamId }) });
    const full = c.name.trim();
    if (full.split(/\s+/).length >= 2 && !byName.has(full)) byName.set(full, link(full));
    if (c.nickname.trim().length > 2 && nicknames.get(c.nickname) === 1) {
      for (const the of ['the', 'The']) byName.set(`${the} ${c.nickname.trim()}`, link(c.nickname.trim()));
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const matcher = names.length === 0 ? null : { pattern: new RegExp(`(?<![\\w\\[])(${names.map(escapeRe).join('|')})(?![\\w\\]])`, 'g'), byName };
  matchers.set(index, matcher);
  return matcher;
}

/** Text already a link or code, which a name inside is left alone in. */
const PROTECTED = /\[[^\]]*\]\([^)]*\)|`[^`]*`/g;

/** The text in the subset with its names linked, and the links listed once each in the order they first appear. */
export function linked(markdown: string, index: LinkIndex | null): AiText {
  const text = inSubset(markdown);
  const matcher = index ? matcherOf(index) : null;
  if (!matcher) return { markdown: text, links: [] };
  const links = new Map<string, AiLink>();
  let out = '';
  let last = 0;
  const linkPlain = (plain: string): string => plain.replace(matcher.pattern, (whole: string) => {
    const link = matcher.byName.get(whole)!;
    if (!links.has(link.url)) links.set(link.url, { url: link.url, text: link.text, target: link.target });
    // "the Diamondbacks": the article stays outside the link
    const lead = whole.slice(0, whole.length - link.text.length);
    return `${lead}[${link.text}](${link.url})`;
  });
  for (const m of text.matchAll(PROTECTED)) {
    out += linkPlain(text.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  out += linkPlain(text.slice(last));
  return { markdown: out, links: [...links.values()] };
}

/** A briefing's sections: each heading line (`## Status`) starts one; text before the first has no heading. */
export function sectionsOf(markdown: string): Array<{ heading: string | null; body: string }> {
  const sections: Array<{ heading: string | null; body: string[] }> = [];
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const body = raw.trim().replace(QUOTE, '');
    if (HEADING.test(body)) {
      const heading = body.replace(HEADING, '').replace(/\*\*/g, '').replace(/\s*#+\s*$/, '').trim();
      sections.push({ heading: heading || null, body: [] });
      continue;
    }
    if (sections.length === 0) sections.push({ heading: null, body: [] });
    sections[sections.length - 1].body.push(raw);
  }
  return sections
    .map((s) => ({ heading: s.heading, body: s.body.join('\n') }))
    .filter((s) => s.heading !== null || s.body.trim() !== '');
}
