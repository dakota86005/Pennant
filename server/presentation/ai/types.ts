/**
 * The AI surfaces on the Mac (N13, Stage A; D-074): the Staff room, Storylines, the GM Briefing and the AI keys, as the
 * contract serves them. Every visible word is the server's; Swift lays it out.
 *
 * AI-written text travels as `AiText`: a markdown subset Swift reads with `AttributedString(markdown:)` and inline-only
 * syntax (`.inlineOnlyPreservingWhitespace`), with the links in it listed beside it. The subset: `**bold**`, `*italic*`,
 * `` `code` `` and `[words](pennant://player/<id>)` or `[words](pennant://club/<teamId>)` links; lines end with "\n" and
 * paragraphs are separated by a blank line; a list item begins "• "; a heading is a line in bold. Nothing else (no `#`
 * headings, no `-` bullets, no tables, no images) reaches the app. A backslash before a character means it is read as
 * written (`\[`, `\]`, `\<`, `\:`, `` \` ``): the model's own links and addresses arrive that way, as words. Every link in
 * the text is the server's and is listed in `links`; the app opens only a URL listed there.
 */
import type { Cell, Claim, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';

/** Whether a surface's AI can answer, in served words. */
export interface AiSurfaceState {
  available: boolean;
  /** With AI off: one calm line that the rest of Pennant works without it, the reason in its basis; null when on. */
  off: Claim | null;
  /** What the AI is and is not: it explains Pennant's figures and decides nothing. */
  note: Claim;
}

/** A link inside AI-written text: the URL the text carries, the words linked and where it leads. */
export interface AiLink {
  /** `pennant://player/<id>` or `pennant://club/<teamId>`, exactly as it appears in the markdown. */
  url: string;
  /** The words linked, as they appear in the text ("Gerrit Cole"). */
  text: string;
  /** A player (with his organization's club when known) or a club. */
  target: Target;
}

/** AI-written text in the served markdown subset, with its links (see the file's header). */
export interface AiText {
  markdown: string;
  links: AiLink[];
}

// ── The Staff room ──────────────────────────────────────────────────────────

/** One person who can be asked, or the room (several at once). */
export interface StaffMemberView {
  /** `analyst`, `manager`, `pitching`, `hitting`, `trainer`, `scout`, `gm`, `owner`, or `room`. */
  id: string;
  /** "Hal Harper"; "The Room". */
  name: Cell;
  /** A short title for a tab ("Pitching Coach", "Group chat"), the full role in its help tag. */
  role: Cell;
  /** What he is for and how he answers, shown before the first question. */
  intro: Cell;
  /** Questions worth asking him, as the GM would put them. */
  starters: Cell[];
  /** The compose field's placeholder. */
  placeholder: Cell;
  room: boolean;
}

/** The room: who can be put in it, who is in by default, and how it works. */
export interface StaffRoomPicker {
  /** The ids put in the room by default (the Mac app keeps the GM's own choice). */
  members: string[];
  /** The most people in the room at once. */
  limit: Integer;
  /** "In the room:". */
  title: Cell;
  /** How the room works, in a line. */
  hint: Cell;
  /** Said when nobody is in it. */
  pickOne: Cell;
}

/** `GET /api/v2/staff-room/:org`: who can be asked, what each is for, and whether AI is on. */
export interface StaffRoomView {
  title: Cell;
  lede: Cell;
  staff: StaffMemberView[];
  /** Null when there is only one person to ask. */
  room: StaffRoomPicker | null;
  ai: AiSurfaceState;
  /** "Ask about him": what dragging a player in does. */
  askAbout: Cell;
  startOver: Cell;
  stop: Cell;
}

/** One message in a conversation: the GM's question as typed, or a staff member's answer. */
export interface StaffRoomMessage {
  /** Stable within a conversation ("m3"); an answer streamed in keeps the id its `speaker` event named. */
  id: string;
  /** `gm` or `staff`. */
  from: 'gm' | 'staff';
  /** Who answered ("Hal Harper · Pitching Coach"); null for the GM. */
  speaker: Cell | null;
  /** The GM's words exactly as typed; null for an answer. */
  typed: string | null;
  /** The answer, written by AI; null for the GM's question. */
  answer: AiText | null;
  /** What the staff member looked up while answering ("Read a player card"). */
  lookedUp: Cell[];
  /** When it was said (ISO 8601), for ordering; null in a conversation kept before times were. */
  at: string | null;
  /** The time of day in words ("3:04 PM"); null when not known. */
  clock: Cell | null;
  /** The day in words ("Oct 10, 2026"), for a divider where it changes; null when not known. */
  calendarDay: Cell | null;
}

/** `GET /api/v2/staff-room/:org/conversation?with=`: the conversation with one person (or the room), kept per club. */
export interface StaffRoomConversation {
  with: string;
  /** "Peter · Front-office analyst". */
  speaker: Cell;
  messages: StaffRoomMessage[];
  /** "3 questions"; null with none. */
  count: Cell | null;
  /** That every answer is the AI's explanation in a staff member's voice and decides nothing. */
  written: Claim;
  ai: AiSurfaceState;
  /** Moves whenever the conversation is written. */
  conversationStamp: string;
}

/** `POST /api/v2/staff-room/:org/ask`: a question for one person or the room. */
export interface StaffRoomAsk {
  /** Who is asked: a person's id, or `room`. */
  with: string;
  /** The question as typed. Leave out with `about`. */
  question?: string;
  /** "Ask about him": a player dragged in; the server words the question. */
  about?: { playerId: Integer };
  /** In the room: who is in it (at most the room's limit). */
  members?: string[];
}

/** `DELETE …/conversation?with=`: the conversation started over. */
export interface StaffRoomCleared {
  conversation: StaffRoomConversation;
  /** "Started over with Peter." */
  done: Cell;
}

// ── The Staff room's stream (`POST …/ask`, server-sent events) ─────────────
//
// Each event is `event: <type>` with `data: <JSON>` whose `type` is the same. In order: `started`; then for each person
// answering, `speaker`, any `looking-up` and `text` events, and `answered` with the final text and its links; a `notice`
// may come at any point; the last event is exactly one of `done` or `failed`. A stream that ends without either (the
// connection dropped) is a failure: what was asked, and what had arrived, are kept, and the conversation says so.

/** The question was taken: the GM's message as kept, and who will answer. */
export interface StaffRoomStartedEvent {
  type: 'started';
  question: StaffRoomMessage;
  /** The ids of who will answer, in order. */
  answering: string[];
}

/** A person starts an answer: the message id the deltas after it belong to. */
export interface StaffRoomSpeakerEvent {
  type: 'speaker';
  messageId: string;
  speaker: Cell;
}

/** A step while he works ("Reading a player card"). */
export interface StaffRoomLookingUpEvent {
  type: 'looking-up';
  messageId: string;
  step: Cell;
}

/**
 * More of the answer, in the markdown subset: the deltas add up exactly to `answered`'s text without its links (a line
 * break arrives with the next line's words). Links arrive only with `answered`.
 */
export interface StaffRoomTextEvent {
  type: 'text';
  messageId: string;
  delta: string;
}

/** Not a failure: another model answered, and why. */
export interface StaffRoomNoticeEvent {
  type: 'notice';
  notice: Cell;
}

/** One person's answer is complete: the message as kept, its text final, with its links. Replaces the streamed text. */
export interface StaffRoomAnsweredEvent {
  type: 'answered';
  message: StaffRoomMessage;
}

/** Everyone has answered; the conversation is kept. */
export interface StaffRoomDoneEvent {
  type: 'done';
  count: Cell | null;
  conversationStamp: string;
}

/** The answer could not be finished. What was asked, and what had arrived, are kept. */
export interface StaffRoomFailedEvent {
  type: 'failed';
  /** `keyRefused` (the provider refused the key), `declined` (the model declined), or `failed`. */
  reason: 'keyRefused' | 'declined' | 'failed';
  /** What happened, in a sentence, with what to do in its basis. */
  failure: Claim;
  /** The answer as far as it got, kept; null when nothing arrived. */
  partial: StaffRoomMessage | null;
  conversationStamp: string;
}

export type StaffRoomEvent =
  | StaffRoomStartedEvent
  | StaffRoomSpeakerEvent
  | StaffRoomLookingUpEvent
  | StaffRoomTextEvent
  | StaffRoomNoticeEvent
  | StaffRoomAnsweredEvent
  | StaffRoomDoneEvent
  | StaffRoomFailedEvent;

// ── Storylines and the GM Briefing ──────────────────────────────────────────

/** `never` written, `writing` now, `written`, or the last try `failed` (what was written before stays). */
export type AiWritingState = 'never' | 'writing' | 'written' | 'failed';

/** Where a piece of AI writing stands: when it was written and from what, or why not. */
export interface AiWritingStatus {
  state: AiWritingState;
  /** "Written Oct 10, 2026, 3:04 PM, from the export of May 9, 2040", "Writing now", "Not written yet", or the failure. */
  status: Claim;
  /**
   * Said when what is shown was written from another export than the one imported now ("Written from an earlier
   * export", or "a different export" when it is dated after it); null when it is the same day's, or a date is unknown.
   */
  older: Claim | null;
  /** "Write storylines" or "Write fresh storylines". */
  write: Cell;
  /** Whether asking for a new one can be done now (AI on, nothing being written). */
  canWrite: boolean;
  /** Another model wrote it, and why; null when the chosen one did. */
  notice: Cell | null;
  /** Beside the writing: written by AI from Pennant's figures, which decides nothing; null with nothing written. */
  written: Claim | null;
  ai: AiSurfaceState;
  /** Moves whenever the writing or its state changes. */
  writingStamp: string;
}

export interface AiStory {
  /** "The Club", "Player Spotlight", "Down on the Farm", "Front Office", "Looking Ahead". */
  category: Cell;
  /** The AI's own headline, as written (plain text, not markdown). */
  headline: string;
  body: AiText;
}

/** `GET|POST /api/v2/storylines/:org`. */
export interface StorylinesView extends AiWritingStatus {
  title: Cell;
  lede: Cell;
  stories: AiStory[];
}

export interface BriefingSection {
  /** The AI's own heading ("Status", "Decisions Needed"), as written; null for text before the first heading. */
  heading: string | null;
  body: AiText;
}

/** `GET|POST /api/v2/briefing/:org`. */
export interface BriefingView extends AiWritingStatus {
  title: Cell;
  lede: Cell;
  sections: BriefingSection[];
}

// ── AI providers and keys ──────────────────────────────────────────────────

/** One AI provider: whether its key is set and where it comes from, never the key itself. */
export interface AiProviderRow {
  /** `anthropic`, `openai`, `gemini`, `opencode`, `ollama`. */
  id: string;
  name: Cell;
  /** "Key set, from the Keychain (ends 4f2a)", "No key", "No key needed: it runs on this Mac". */
  status: Claim;
  configured: boolean;
  needsKey: boolean;
  /** `keychain`, `env` or `stored`; null with no key. */
  source: 'keychain' | 'env' | 'stored' | null;
  /** "From the Keychain"; null with no key. */
  sourceText: Cell | null;
  /** "Get a key at console.claude.com"; null where none is needed. */
  getOne: Cell | null;
  /** "Used for the Staff room and Storylines"; null when no AI feature uses it. */
  usedFor: Cell | null;
  /** "Check key". */
  check: Cell | null;
}

/** `GET /api/v2/ai/keys`: every provider, where keys are kept, and whether any AI surface is on. */
export interface AiKeysView {
  title: Cell;
  lede: Cell;
  providers: AiProviderRow[];
  /** Where keys are kept ("In your Mac's Keychain; Pennant never writes them to a file"). */
  where: Claim;
  /** Said when no AI surface has a key: everything else in Pennant works without one; null otherwise. */
  off: Claim | null;
}

/** `POST /api/v2/ai/keys/check`: a key to test with its provider (never kept, logged or served back). */
export interface AiKeyCheck {
  provider: string;
  /** The key to test; left out, the key the server already holds for the provider is tested. */
  key?: string;
}

/** What the check found, in words, never repeating the key. */
export interface AiKeyCheckAnswer {
  provider: string;
  /** `works`, `refused` (the provider turned it down), `unchecked` (the provider could not be reached), `misshapen`. */
  outcome: 'works' | 'refused' | 'unchecked' | 'misshapen';
  result: Claim;
}
