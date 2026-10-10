/**
 * AI-written text in the served markdown subset (N13, D-074; `types.ts` has the subset), and its links.
 *
 * The models write markdown as they please: `##` headings, `-` bullets, now and then a rule or a quote. Swift reads the
 * served text with inline-only syntax, which would show those markers as they are, so they are rewritten here: a
 * heading becomes a line in bold, a bullet "• ", a quote's marker and a rule go. Inline markers pass through.
 *
 * Only the server makes links (N13 review H1): a link or image the model wrote keeps its words and loses its address,
 * and anything else a reader could take for a link (`[`, `]`, `<`, a `javascript:` or `scheme://` address) is escaped.
 * The same code reads a delta and the whole text, so what streams adds up to the final text exactly (review M3).
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
const SPACE = /\s/;

/** One whole line in the subset; null when the line goes (a rule, a heading with no words). */
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

/** Whether a line's start could still turn out to be a blank line, a rule, a quote, a heading or a bullet. */
function undecided(held: string): boolean {
  if (/^\s*([-*_])(\s*\1)*\s*$/.test(held)) return true;
  const body = held.replace(/^\s*/, '').replace(QUOTE, '');
  return /^\s*$/.test(body) || /^#{1,6}\s*$/.test(body) || /^[-*+]\s*$/.test(body);
}

/**
 * The block half of the subset, a character at a time (N13 review M3): each line read as `line` reads it, blank runs
 * folded to one, the ends trimmed. What it cannot decide yet it holds: a line's start until it shows what the line is,
 * whitespace (and a heading's closing `#`s) until something follows it, a heading's `*` until the next shows whether it
 * is `**`, and a line break until another line has words. Fed whole or in pieces, it writes the same text.
 */
class Blocks {
  private held = '';
  private phase: 'start' | 'body' | 'heading' = 'start';
  private tail = '';
  private star = false;
  private started = false;
  private owed = 0;
  private any = false;
  private cr = false;

  feed(ch: string): string {
    if (this.cr) {
      this.cr = false;
      if (ch === '\n') return '';
    }
    if (ch === '\r' || ch === '\n') {
      this.cr = ch === '\r';
      return this.lineEnd(true);
    }
    if (this.phase === 'start') {
      this.held += ch;
      return undecided(this.held) ? '' : this.decide();
    }
    return this.phase === 'heading' ? this.headingFeed(ch) : this.bodyChar(ch);
  }

  end(): string {
    return this.lineEnd(false);
  }

  /** Output for the line: the line breaks owed go first, once it has something to say. */
  private emit(s: string): string {
    if (!s) return '';
    if (this.started) return s;
    const lead = '\n'.repeat(this.owed);
    this.owed = 0;
    this.started = true;
    this.any = true;
    return lead + s;
  }

  private decide(): string {
    const held = this.held;
    this.held = '';
    const indent = /^\s*/.exec(held)![0];
    const body = held.slice(indent.length).replace(QUOTE, '');
    const heading = HEADING.exec(body);
    let out = '';
    if (heading) {
      this.phase = 'heading';
      for (const c of body.slice(heading[0].length)) out += this.headingFeed(c);
      return out;
    }
    this.phase = 'body';
    const bullet = BULLET.exec(body);
    out = this.emit(`${indent.length >= 2 ? '  ' : ''}${bullet ? '• ' : ''}`);
    for (const c of bullet ? body.slice(bullet[0].length) : body) out += this.bodyChar(c);
    return out;
  }

  private bodyChar(ch: string): string {
    if (SPACE.test(ch)) {
      this.tail += ch;
      return '';
    }
    const out = this.emit(this.tail + ch);
    this.tail = '';
    return out;
  }

  /** A heading's words: `**` dropped, a single `*` kept, its closing `#`s and the spaces at either end dropped. */
  private headingFeed(ch: string): string {
    if (ch === '*') {
      this.star = !this.star;
      return '';
    }
    let out = '';
    if (this.star) {
      this.star = false;
      out = this.headingChar('*');
    }
    return out + this.headingChar(ch);
  }

  private headingChar(ch: string): string {
    if (SPACE.test(ch) || ch === '#') {
      if (!this.started && !this.tail && SPACE.test(ch)) return '';
      this.tail += ch;
      return '';
    }
    const out = this.emit(`${this.started ? '' : '**'}${this.tail}${ch}`);
    this.tail = '';
    return out;
  }

  private lineEnd(broken: boolean): string {
    let out = '';
    if (this.phase === 'start') {
      const whole = this.held ? line(this.held) : broken ? '' : null;
      if (whole !== null && whole.trim() === '') {
        if (this.any) this.owed = 2;
      } else if (whole !== null) out = this.emit(whole);
    } else if (this.phase === 'heading') {
      if (this.star) {
        this.star = false;
        out = this.headingChar('*');
      }
      const words = this.tail.replace(/\s*#+\s*$/, '').replace(/\s+$/, '');
      this.tail = '';
      if (words) out += this.emit(`${this.started ? '' : '**'}${words}`);
      if (this.started) out += '**';
    }
    if (this.started) this.owed = 1;
    this.held = '';
    this.tail = '';
    this.phase = 'start';
    this.started = false;
    return out;
  }
}

/** Schemes whose address is never one to follow, wherever it is written. */
const NEVER = new Set(['javascript', 'vbscript', 'data', 'file', 'pennant']);
const PUNCT = /[!-/:-@[-`{-~]/;
const LONGEST_LABEL = 300;
const LONGEST_ADDRESS = 2000;

/**
 * The inline half (N13 review H1): only the server makes links. A link or image the model wrote becomes its words; any
 * other `[` or `]`, every `<` (an autolink, raw HTML), and the colon of a `javascript:`, `pennant:` or `scheme://` address
 * are escaped with a backslash, so they read as written and lead nowhere. Code spans stay as written, a code span being
 * a run of backticks closed by a run as long before a blank line; a run left open is escaped instead, so every reader
 * agrees where code starts and ends. Character by character, like `Blocks`, so a delta and the final text agree.
 */
class Inline {
  /** Where each code span is in the text written so far, start and end. */
  readonly code: Array<[number, number]> = [];
  private mode: 'text' | 'colon' | 'bang' | 'ticks' | 'code' | 'label' | 'after' | 'address' = 'text';
  private acc = '';
  private written = 0;
  private slashes = 0;
  private word = '';
  private raw = '';
  private label = '';
  private ticks = 0;
  private run = 0;
  private depth = 0;
  private image = false;
  private escaping = false;

  feed(ch: string): string {
    this.take(ch);
    const out = this.acc;
    this.acc = '';
    return out;
  }

  end(): string {
    while (this.mode !== 'text') {
      if (this.mode === 'colon' || this.mode === 'bang' || this.mode === 'ticks') {
        const held = this.mode === 'colon' ? ':' : this.mode === 'bang' ? '!' : '\\`'.repeat(this.ticks);
        this.mode = 'text';
        this.put(held);
      } else if (this.mode === 'code') {
        if (this.run === this.ticks) this.closeCode();
        else this.openCodeFails();
      } else this.notALink();
    }
    const out = this.acc;
    this.acc = '';
    return out;
  }

  private put(s: string): void {
    this.acc += s;
    this.written += s.length;
  }

  private take(ch: string): void {
    switch (this.mode) {
      case 'colon':
        this.mode = 'text';
        this.put(ch === '/' ? '\\:' : ':');
        return this.text(ch);
      case 'bang':
        this.mode = 'text';
        if (ch === '[') return this.openLabel(true);
        this.put('!');
        return this.text(ch);
      case 'ticks':
        if (ch === '`') {
          this.ticks += 1;
          return;
        }
        this.mode = 'code';
        this.raw = '';
        this.run = 0;
        return this.codeChar(ch);
      case 'code':
        return this.codeChar(ch);
      case 'label':
      case 'after':
      case 'address':
        return this.linkChar(ch);
      default:
        return this.text(ch);
    }
  }

  private text(ch: string): void {
    const escaped = this.slashes % 2 === 1 && PUNCT.test(ch);
    this.slashes = ch === '\\' ? this.slashes + 1 : 0;
    if (escaped || ch === '\\') {
      this.word = '';
      return this.put(ch);
    }
    if (ch === '`') {
      this.word = '';
      this.mode = 'ticks';
      this.ticks = 1;
      return;
    }
    if (ch === '[') return this.openLabel(false);
    if (ch === '!') {
      this.word = '';
      this.mode = 'bang';
      return;
    }
    if (ch === ']' || ch === '<') {
      this.word = '';
      return this.put(`\\${ch}`);
    }
    if (ch === ':' && this.word) {
      const scheme = this.word.toLowerCase();
      this.word = '';
      if (NEVER.has(scheme)) return this.put('\\:');
      this.mode = 'colon';
      return;
    }
    this.word = /[A-Za-z]/.test(ch) || (this.word && /[0-9+.-]/.test(ch)) ? this.word + ch : '';
    this.put(ch);
  }

  private openLabel(image: boolean): void {
    this.word = '';
    this.mode = 'label';
    this.image = image;
    this.raw = '';
    this.label = '';
  }

  private codeChar(ch: string): void {
    if (ch === '`') {
      this.run += 1;
      this.raw += ch;
      return;
    }
    if (this.run === this.ticks) {
      this.closeCode();
      return this.text(ch);
    }
    this.run = 0;
    if (ch === '\n' && this.raw.endsWith('\n')) {
      this.openCodeFails();
      return this.take(ch);
    }
    this.raw += ch;
  }

  private closeCode(): void {
    const start = this.written;
    this.put('`'.repeat(this.ticks) + this.raw);
    this.code.push([start, this.written]);
    this.mode = 'text';
    this.run = 0;
    this.raw = '';
  }

  /** A run of backticks with none to close it: escaped, and what followed it read again as text. */
  private openCodeFails(): void {
    const again = this.raw;
    this.mode = 'text';
    this.put('\\`'.repeat(this.ticks));
    this.raw = '';
    this.run = 0;
    for (const c of again) this.take(c);
  }

  private linkChar(ch: string): void {
    if (this.mode === 'label') {
      if (ch === ']') {
        this.mode = 'after';
        this.raw += ch;
        return;
      }
      if (ch === '[' || ch === '`' || ch === '\\' || ch === '\n' || this.label.length >= LONGEST_LABEL) return this.notALink(ch);
      this.label += ch;
      this.raw += ch;
      return;
    }
    if (this.mode === 'after') {
      if (ch !== '(') return this.notALink(ch);
      this.mode = 'address';
      this.depth = 1;
      this.escaping = false;
      this.raw += ch;
      return;
    }
    if (ch === '\n' || this.raw.length >= LONGEST_ADDRESS) return this.notALink(ch);
    this.raw += ch;
    if (this.escaping) {
      this.escaping = false;
      return;
    }
    if (ch === '\\') this.escaping = true;
    else if (ch === '(') this.depth += 1;
    else if (ch === ')' && --this.depth === 0) {
      // A link the model wrote: its words stay, the address goes
      const words = this.label;
      this.mode = 'text';
      this.image = false;
      this.raw = '';
      this.label = '';
      for (const c of words) this.text(c);
    }
  }

  /** Not a link after all: the `[` (and an image's `!`) escaped, and what followed read again as text. */
  private notALink(next?: string): void {
    const again = this.raw;
    this.mode = 'text';
    this.raw = '';
    this.label = '';
    if (this.image) this.put('!');
    this.image = false;
    this.put('\\[');
    for (const c of again) this.take(c);
    if (next !== undefined) this.take(next);
  }
}

/**
 * The subset while an answer streams, and the whole text's subset too (`inSubset` is this, fed at once): block markers
 * rewritten (`Blocks`), then only the server's links possible (`Inline`). Fed in any pieces it writes the same text, so
 * the deltas add up to the final text exactly; `answered` then brings that text with the server's links in it.
 */
export class StreamedSubset {
  private readonly blocks = new Blocks();
  private readonly inline = new Inline();

  /** The next piece of text in the subset (possibly empty while something is held). */
  push(delta: string): string {
    let out = '';
    for (const ch of delta) for (const c of this.blocks.feed(ch)) out += this.inline.feed(c);
    return out;
  }

  /** Whatever is still held, at the end of the answer. */
  end(): string {
    let out = '';
    for (const c of this.blocks.end()) out += this.inline.feed(c);
    return out + this.inline.end();
  }

  /** Where the code spans are in the text written so far. */
  get code(): ReadonlyArray<readonly [number, number]> {
    return this.inline.code;
  }
}

/** The whole text in the subset, with where its code spans are. */
function subsetOf(markdown: string): { text: string; code: ReadonlyArray<readonly [number, number]> } {
  const s = new StreamedSubset();
  const text = s.push(markdown) + s.end();
  return { text, code: s.code };
}

/** The whole text in the subset (what the deltas add up to): block markers rewritten, only the server's links possible. */
export const inSubset = (markdown: string): string => subsetOf(markdown).text;

/** The block half alone, for the tests that hold it to the whole-line reading. */
export function subsetBlocks(markdown: string): string {
  const b = new Blocks();
  let out = '';
  for (const ch of markdown) out += b.feed(ch);
  return out + b.end();
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

/** A name inside a link's words, escaped so a `]`, `*` or `_` in it is read as written. */
const linkWords = (words: string): string => words.replace(/[\\`*_[\]<>]/g, '\\$&');

/**
 * The text in the subset with its names linked, and the links listed once each in the order they first appear. The
 * model's own links are gone already (`Inline`), so every link in the text is one of these; names in code stay plain.
 */
export function linked(markdown: string, index: LinkIndex | null): AiText {
  const { text, code } = subsetOf(markdown);
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
    return `${lead}[${linkWords(link.text)}](${link.url})`;
  });
  for (const [start, end] of code) {
    out += linkPlain(text.slice(last, start)) + text.slice(start, end);
    last = end;
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
