/**
 * The Staff room's words (N13, D-074): who can be asked and what each is for, a conversation as kept, the steps an
 * answer takes, the question "Ask about him" puts, and a failure in a sentence. Moved from the React chat
 * (`src/Chat.tsx`: the role labels, the openers, the intros, the tool labels), so the two clients say the same.
 */
import { AI_STATE_CERTAINTY } from '../aiMarking.js';
import { basis, cell, claim } from '../claim.js';
import { clockWords, dayWords, timestampWords } from '../../timeWords.js';
import { linked, type LinkIndex } from './markdown.js';
import { ROOM_ID, roleLabel } from './staffWords.js';
import { aiSurface, aiWritten, sourceOf, type AiContext, type AiOnOff } from './surface.js';
import type { StaffMemberView, StaffRoomConversation, StaffRoomMessage, StaffRoomView } from './types.js';

/** A person who can be asked (the save's staff, `staff.ts`). */
export interface StaffPerson { id: string; name: string; role: string }

/** A message as the conversation file keeps it (the React chat's own shape). */
export interface KeptMessage {
  role: 'user' | 'assistant';
  content: string;
  speaker?: string;
  speakerRole?: string;
  tools?: string[];
  at?: string;
}

export { ROOM_ID, roleLabel };
export const ROOM_LIMIT = 4;
/** Who is in the room until the GM chooses (the React chat's default). */
export const ROOM_DEFAULT = ['trainer', 'pitching', 'manager'];

/**
 * Openers worth asking each of them. Not the React chat's list: these are worded as questions, never as an order to
 * the GM ("Who are you thinking of starting tonight?", not "Who should I start tonight?"; D-001), so the Mac's own.
 */
const STARTERS: Record<string, string[]> = {
  analyst: ['How is my team actually playing so far?', 'Who in the minors is closest to helping us?', 'Which contracts are a concern?'],
  manager: ['Who are you thinking of starting tonight?', 'Who needs a day off?', 'How do you want to use the bullpen this week?'],
  pitching: ['Who can pitch tonight?', 'Is anyone being overworked?', 'Who is due for a step forward?'],
  hitting: ['Who is pressing at the plate right now?', 'Is anyone hitting into bad luck?', 'Which of our young bats is closest to figuring it out?'],
  room: ['Who is hurt, and how do we handle him when he is back?', 'Is a starter worth going after, and can we afford one?', 'What is the biggest problem with this team right now?'],
  trainer: ['Who is hurt and how long are they out?', 'Is anyone at risk of breaking down?', 'Who is close to a rehab assignment?'],
  scout: ['Which prospect is closest to helping us?', 'Who is overrated on our farm?', 'What are you looking for in the draft?'],
  owner: ['Can we afford to add salary?', 'Is this roster worth what we are paying for it?', 'What do you expect from this season?'],
};
const STARTERS_ANY = ['How is my team actually playing so far?', 'Who in the minors is closest to helping us?', 'Which contracts are a concern?', 'Who can pitch tonight?'];

/** What each lookup is, as a step the GM sees while an answer is written (every tool the staff can reach for). */
const STEPS: Record<string, string> = {
  search_players: 'Searching players',
  get_player: 'Reading a player card',
  get_roster: 'Reading the roster',
  get_franchise_history: 'Reading the club\'s history',
  get_standings: 'Checking the standings',
  get_pitching_staff: 'Checking the pitching staff',
  get_schedule: 'Reading the schedule',
  get_lineup: 'Looking at the lineup',
  get_payroll: 'Looking at the books',
  get_injuries: 'Checking the training room',
  get_prospects: 'Reviewing prospects',
  get_leaderboards: 'Checking the league leaders',
  get_teams: 'Looking up the clubs',
  get_dashboard: 'Reading the club\'s summary',
  get_contracts: 'Reading the contracts',
  get_free_agents: 'Looking at free agents',
  get_roster_crunch: 'Checking roster space',
  get_trading_block: 'Looking at the trading block',
};

/** A lookup as a step in words; one this list doesn't name is still a step, never its code name. */
export const stepWords = (tool: string): string => STEPS[tool] ?? 'Looking something up';

const speakerLine = (p: StaffPerson): string => `${p.name} · ${roleLabel(p)}`;

function memberOf(ctx: AiContext, p: StaffPerson, room: boolean): StaffMemberView {
  return {
    id: p.id,
    name: cell(p.name),
    role: cell(room ? 'Group chat' : roleLabel(p), room ? {} : { hint: `${p.name}, ${p.role}`.slice(0, 75) }),
    intro: cell(room
      ? `Everyone you put in the room answers the same question in turn, each seeing what the others said. Ask about the ${ctx.club} or the league: they won't always agree, which is the point. Start a message with a name, or type @, to ask one of them alone.`
      : `${p.name} is your ${p.role}. Ask him about the ${ctx.club} or the league: every number comes out of your save rather than his memory, and he answers from where he sits, so he won't always agree with the others.`),
    starters: (STARTERS[p.id] ?? STARTERS_ANY).map((s) => cell(s)),
    placeholder: cell(room ? 'Message: @ to ask one person' : 'Message'),
    room,
  };
}

/** Who can be asked, and whether AI is on. */
export function staffRoomView(ctx: AiContext, people: StaffPerson[], ai: AiOnOff): StaffRoomView {
  const hasRoom = people.length > 1;
  const staff = people.map((p) => memberOf(ctx, p, false));
  if (hasRoom) staff.push(memberOf(ctx, { id: ROOM_ID, name: 'The Room', role: 'group' }, true));
  return {
    title: cell('Staff room'),
    lede: cell(`Ask your staff about the ${ctx.club} or the league. They answer from Pennant's figures; the decisions are yours.`),
    staff,
    room: hasRoom ? {
      members: ROOM_DEFAULT.filter((id) => people.some((p) => p.id === id)),
      limit: ROOM_LIMIT,
      title: cell('In the room:'),
      hint: cell('They answer in order and see what the others said. Add or remove anyone at any point: a new voice reads the conversation so far. Start a message with a name, or put an @ in front of one, to ask that person alone.'),
      pickOne: cell('Pick at least one.'),
    } : null,
    ai: aiSurface(ctx, 'staffRoom', ai),
    askAbout: cell('Ask about him'),
    startOver: cell('Start over'),
    stop: cell('Stop'),
  };
}

/**
 * A message's id: from when it was said and who said it, so it stays the same while an answer streams, after the
 * conversation is trimmed, and when it is read again; a message kept before times were is known by its place.
 */
export function messageIdOf(m: KeptMessage, at: number): string {
  if (!m.at) return `m${at}`;
  const key = `${m.role}|${m.at}|${m.speaker ?? ''}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `t${(h >>> 0).toString(36)}`;
}

/** One kept message as served: the GM's words as typed, or an answer in the subset with its links. */
export function messageOf(
  m: KeptMessage, id: string, index: LinkIndex | null, answering: StaffPerson | null,
): StaffRoomMessage {
  const gm = m.role === 'user';
  const speaker = gm ? null : m.speaker
    ? `${m.speaker}${m.speakerRole ? ` · ${m.speakerRole.replace(/\b\w/g, (c) => c.toUpperCase())}` : ''}`
    : answering ? speakerLine(answering) : null;
  const time = clockWords(m.at);
  const day = dayWords(m.at);
  return {
    id,
    from: gm ? 'gm' : 'staff',
    speaker: speaker ? cell(speaker) : null,
    typed: gm ? m.content : null,
    answer: gm ? null : linked(m.content, index),
    lookedUp: gm ? [] : (m.tools ?? []).map((t) => cell(stepWords(t))),
    at: m.at && timestampWords(m.at) ? m.at : null,
    clock: time ? cell(time) : null,
    calendarDay: day ? cell(day) : null,
  };
}

/** A conversation as kept (the React chat's file), served. */
export function conversationView(
  ctx: AiContext, withId: string, person: StaffPerson, kept: KeptMessage[], index: LinkIndex | null, ai: AiOnOff, stamp: string,
): StaffRoomConversation {
  const room = withId === ROOM_ID;
  const asked = kept.filter((m) => m.role === 'user').length;
  return {
    with: withId,
    speaker: cell(room ? 'The Room · Group chat' : speakerLine(person)),
    messages: kept.map((m, i) => messageOf(m, messageIdOf(m, i), index, room ? null : person)),
    count: questionCount(asked),
    written: aiWritten(ctx, 'staffRoom', 'Answers are written by AI from Pennant\'s figures, in a staff member\'s voice.', ['Another question, or a newer export.']),
    ai: aiSurface(ctx, 'staffRoom', ai),
    conversationStamp: stamp,
  };
}

export const questionCount = (n: number) => (n > 0 ? cell(`${n} question${n === 1 ? '' : 's'}`) : null);

const POSITION_WORDS: Record<number, string> = {
  1: 'pitcher', 2: 'catcher', 3: 'first baseman', 4: 'second baseman', 5: 'third baseman', 6: 'shortstop',
  7: 'left fielder', 8: 'center fielder', 9: 'right fielder', 10: 'designated hitter',
};

/** "Ask about him": the question a player dragged into the Staff room puts, worded here so the app writes none. */
export function aboutQuestion(p: { name: string; position: number | null; ours: boolean; club: string | null }): string {
  const what = (p.position !== null ? POSITION_WORDS[p.position] : undefined) ?? 'player';
  if (p.ours) return `What do you make of ${p.name}, our ${what}?`;
  if (p.club) return `What do you make of ${p.name}, the ${what} for the ${p.club}?`;
  return `What do you make of ${p.name}, the ${what} without a club?`;
}

/** Why an answer could not be finished, in a sentence, with what to do in its basis. */
export function failureClaim(ctx: AiContext, reason: 'keyRefused' | 'declined' | 'failed', sentence: string) {
  return claim({
    text: reason === 'declined' ? 'The model declined to answer that.' : reason === 'keyRefused' ? 'The AI provider refused the key.' : 'The answer couldn\'t be finished.',
    tone: 'caution',
    links: [],
    basis: basis({
      because: [{ label: 'What happened', value: sentence }, { label: 'What was kept', value: 'Your question, and the answer as far as it got.' }],
      source: sourceOf(ctx, 'The staff room'),
      unknown: [],
      wouldChange: reason === 'keyRefused' ? ['A working key in Settings.'] : reason === 'declined' ? ['Asking it another way.'] : ['Asking again.'],
      lean: null, certainty: AI_STATE_CERTAINTY,
    }),
  });
}
