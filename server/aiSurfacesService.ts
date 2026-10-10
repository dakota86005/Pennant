/**
 * The AI surfaces, served for the Mac app (N13, Stage A; D-074): the Staff room's people and conversations, Storylines
 * and the GM Briefing, read from the files the React app keeps and worded by `presentation/ai/`.
 *
 * This module reaches no AI module (D-001: the evidence boundary's list is unchanged). The AI modules (`chat.ts`,
 * `storylines.ts`, `ai.ts`) register the routes, ask the model, and hand this module whether AI is on; this module reads
 * and writes the kept files and words what they hold.
 *
 * Kept per import, never per write of OOTP's live log: a view is kept on the served database's generation, the import's
 * time, the file it reads (its size and time), the job's state and whether AI is on. The league's names for linking are
 * kept on the generation alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { databaseGeneration, db, tableColumns, tableExists } from './db.js';
import { jobStatus } from './jobs.js';
import { resolveOrg } from './orgParam.js';
import { importedAt } from './playerStateRoutes.js';
import { assertAuthored } from './presentation/claim.js';
import { aiKeysView, keyCheckAnswer, type KeyCheckOutcome, type ProviderReading } from './presentation/ai/keys.js';
import { StreamedSubset, type LinkIndex } from './presentation/ai/markdown.js';
import { cell } from './presentation/claim.js';
import {
  ROOM_ID, aboutQuestion, conversationView, failureClaim, messageIdOf, messageOf, questionCount, staffRoomView, stepWords,
  type KeptMessage, type StaffPerson,
} from './presentation/ai/staffRoom.js';
import type { AiContext, AiOnOff } from './presentation/ai/surface.js';
import type {
  AiKeyCheckAnswer, AiKeysView, BriefingView, StaffRoomConversation, StaffRoomEvent, StaffRoomFailedEvent, StaffRoomMessage,
  StaffRoomCleared, StaffRoomNoticeEvent, StaffRoomStartedEvent, StaffRoomView, StorylinesView,
} from './presentation/ai/types.js';
import { briefingView, storylinesView, type JobReading } from './presentation/ai/writing.js';
import { personasFor } from './staff.js';
import { currentGameDate } from './valuation.js';

// ── The files the React app keeps (moved here from `chat.ts`, `storylines.ts` and `ai.ts`, unchanged) ────────────────

const suffix = (persona: string) => (persona === 'analyst' ? '' : `-${persona}`);
/** A conversation with one person (or the room) for one club. Peter keeps the original filename. */
export const historyPath = (orgId: number, persona: string) => path.join(DATA_DIR, `chat-${orgId}${suffix(persona)}.json`);
/** What the model has seen of that conversation, tool results and all (`chat.ts`'s stored transcript). */
export const contextPath = (orgId: number, persona: string) => path.join(DATA_DIR, `chat-context-${orgId}${suffix(persona)}.json`);
export const storylinesPath = (orgId: number) => path.join(DATA_DIR, `storylines-${orgId}.json`);
export const briefingPath = (orgId: number) => path.join(DATA_DIR, `briefing-${orgId}.json`);

/** How many messages a conversation keeps (the React chat's own number). */
export const KEEP_MESSAGES = 40;

/** A person's id as a request names it: lower-case letters only, else the analyst (the React route's rule). */
export const personaId = (raw: unknown): string => {
  const s = String(raw ?? 'analyst');
  return /^[a-z]+$/.test(s) ? s : 'analyst';
};

const validMessages = (parsed: unknown): KeptMessage[] => (Array.isArray(parsed)
  ? parsed.filter((m): m is KeptMessage => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
  : []);

/** The conversation as kept; empty when there is none or it cannot be read. */
export function readConversation(orgId: number, persona: string): KeptMessage[] {
  try {
    return validMessages(JSON.parse(fs.readFileSync(historyPath(orgId, persona), 'utf8')));
  } catch {
    return [];
  }
}

/** Writes the conversation, its last `KEEP_MESSAGES` messages, as the React chat writes it. */
export function writeConversation(orgId: number, persona: string, messages: KeptMessage[]): void {
  fs.writeFileSync(historyPath(orgId, persona), JSON.stringify(messages.slice(-KEEP_MESSAGES)));
}

const fileStamp = (file: string): string => {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return 'none';
  }
};

const readJson = (file: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

// ── What every surface's words are built from ───────────────────────────────

/** The club's name, the import read and the export's game date. */
export function aiContextFor(orgId: number): AiContext {
  const team = db.prepare('SELECT name, nickname, league_id FROM teams WHERE team_id = ?').get(orgId) as
    | { name: string | null; nickname: string | null; league_id: number } | undefined;
  const name = String(team?.name ?? '').trim();
  const nickname = String(team?.nickname ?? '').trim();
  const club = !name ? nickname || 'club' : !nickname || name === nickname ? name : `${name} ${nickname}`;
  return { importStamp: importedAt.value, gameDate: team ? currentGameDate(team.league_id) : null, club };
}

let names: { generation: number; orgId: number; index: LinkIndex } | null = null;

/**
 * Who can be linked in AI-written text: the major leagues' players and this organization's own (the React app's name
 * index), each with his organization's club, and the major-league clubs. Kept on the served database's generation.
 */
export function linkIndexFor(orgId: number): LinkIndex | null {
  if (!tableExists('players') || !tableExists('teams')) return null;
  const generation = databaseGeneration();
  if (names && names.generation === generation && names.orgId === orgId) return names.index;
  const players = (db.prepare(
    `SELECT p.player_id AS id, p.first_name || ' ' || p.last_name AS name, p.organization_id AS org,
            CASE WHEN p.organization_id = ? THEN 1 ELSE 0 END AS ours
     FROM players p JOIN teams t ON t.team_id = p.team_id
     WHERE p.retired = 0 AND p.first_name IS NOT NULL AND p.last_name IS NOT NULL AND (t.level = 1 OR p.organization_id = ?)`,
  ).all(orgId, orgId) as Array<{ id: number; name: string; org: number | null; ours: number }>)
    .map((p) => ({ id: p.id, name: p.name, ours: p.ours === 1, teamId: typeof p.org === 'number' && p.org > 0 ? p.org : null }));
  // Schema-tolerant: an export without the all-star flag has no all-star clubs to leave out
  const allStar = tableColumns('teams').includes('allstar_team') ? ' AND COALESCE(allstar_team, 0) = 0' : '';
  const clubs = (db.prepare(
    `SELECT team_id AS teamId, name, nickname FROM teams WHERE level = 1${allStar}`,
  ).all() as Array<{ teamId: number; name: string | null; nickname: string | null }>)
    .map((c) => ({ teamId: c.teamId, name: `${c.name ?? ''} ${c.nickname ?? ''}`.trim(), nickname: String(c.nickname ?? '').trim() }))
    .filter((c) => c.name.length > 0);
  const index: LinkIndex = { players, clubs };
  names = { generation, orgId, index };
  return index;
}

/** Who this club can put on the phone (the save's staff, `staff.ts`). */
export const staffFor = (orgId: number): StaffPerson[] => personasFor(orgId).map((p) => ({ id: p.id, name: p.name, role: p.role }));

/**
 * Who a message in the room is aimed at, when it is aimed at anybody (moved from the React chat): a name at the start
 * of the message, or anywhere with an @ in front of it; null when none or more than one person matches.
 */
export function addressedIn(text: string, people: StaffPerson[]): StaffPerson | null {
  const hit = new Set<string>();
  for (const p of people) {
    if (p.id === ROOM_ID) continue;
    const parts = p.name.split(/\s+/);
    for (const form of [p.name, parts[0], parts[parts.length - 1]]) {
      if (!form || form.length < 2) continue;
      const safe = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`^\\s*@?${safe}\\b`, 'i').test(text) || new RegExp(`@${safe}\\b`, 'i').test(text)) hit.add(p.id);
    }
  }
  return hit.size === 1 ? people.find((p) => p.id === [...hit][0]) ?? null : null;
}

/** "Ask about him": the question a player dragged into the Staff room puts; null when the save has no such player. */
export function aboutQuestionFor(orgId: number, playerId: number): string | null {
  if (!Number.isInteger(playerId) || playerId <= 0 || !tableExists('players')) return null;
  const p = db.prepare(
    `SELECT p.first_name || ' ' || p.last_name AS name, p.position, p.organization_id AS org, t.nickname AS club
     FROM players p LEFT JOIN teams t ON t.team_id = p.organization_id WHERE p.player_id = ?`,
  ).get(playerId) as { name: string | null; position: number | null; org: number | null; club: string | null } | undefined;
  if (!p?.name?.trim()) return null;
  const ours = p.org === orgId;
  return aboutQuestion({ name: p.name.trim(), position: typeof p.position === 'number' ? p.position : null, ours, club: !ours && (p.org ?? 0) > 0 ? p.club?.trim() || null : null });
}

// ── The views, kept per import ─────────────────────────────────────────────

const kept = new Map<string, unknown>();
const MAX_KEPT = 32;
const stats = { builds: 0, hits: 0 };

/** Counts, for the tests' "served from the cache" guard. */
export function aiSurfaceStats(): Readonly<typeof stats & { kept: number }> {
  return { ...stats, kept: kept.size };
}

/** For the tests: an empty cache and zero counts. */
export function resetAiSurfaces(): void {
  kept.clear();
  names = null;
  Object.assign(stats, { builds: 0, hits: 0 });
}

/** What every view is kept on: the served database, the import, and the club's export game date (never the live log). */
const importKey = (orgId: number): string => `${databaseGeneration()}|${importedAt.value ?? ''}|${orgId}`;

function keptView<T>(key: string, build: () => T): T {
  const hit = kept.get(key) as T | undefined;
  if (hit !== undefined) {
    stats.hits += 1;
    return hit;
  }
  const view = build();
  stats.builds += 1;
  assertAuthored(view);
  kept.set(key, view);
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
  return view;
}

const short = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Who can be asked, and whether AI is on (`GET /api/v2/staff-room/:org`). */
export function staffRoomNow(org: string, ai: AiOnOff): StaffRoomView {
  const orgId = resolveOrg(org);
  return keptView(`staff|${importKey(orgId)}|${ai.available}|${ai.offReason ?? ''}`, () => staffRoomView(aiContextFor(orgId), staffFor(orgId), ai));
}

/** The person a request names on this club: one of its staff, or the room when it has more than one; else its first. */
export function personOn(orgId: number, withId: string): { withId: string; person: StaffPerson } {
  const people = staffFor(orgId);
  if (withId === ROOM_ID && people.length > 1) return { withId, person: { id: ROOM_ID, name: 'The Room', role: 'group' } };
  const person = people.find((p) => p.id === withId) ?? people[0];
  return { withId: person.id, person };
}

/** "Start over": the conversation emptied, served again with a line saying so. */
export function staffRoomCleared(org: string, withId: string, person: StaffPerson, ai: AiOnOff): StaffRoomCleared {
  return { conversation: conversationNow(org, withId, ai), done: cell(withId === ROOM_ID ? 'Started over with the room.' : `Started over with ${person.name}.`) };
}

/** The conversation's stamp: it moves whenever the file is written. */
export const conversationStamp = (orgId: number, persona: string): string => short(`${orgId}|${persona}|${fileStamp(historyPath(orgId, persona))}`);

/** The conversation with one person (or the room), as kept (`GET …/conversation?with=`). */
export function conversationNow(org: string, withRaw: unknown, ai: AiOnOff): StaffRoomConversation {
  const orgId = resolveOrg(org);
  const { withId, person } = personOn(orgId, personaId(withRaw));
  const stamp = conversationStamp(orgId, withId);
  return keptView(`talk|${importKey(orgId)}|${withId}|${stamp}|${ai.available}|${ai.offReason ?? ''}`, () =>
    conversationView(aiContextFor(orgId), withId, person, readConversation(orgId, withId), linkIndexFor(orgId), ai, stamp));
}

const jobReading = (kind: string, orgId: number): JobReading => {
  const j = jobStatus(kind, orgId);
  return { state: j.state, error: j.error, finishedAt: j.finishedAt };
};

const noticeOf = (raw: unknown): { message: string } | null =>
  raw && typeof raw === 'object' && typeof (raw as { message?: unknown }).message === 'string' ? { message: (raw as { message: string }).message } : null;

/** Storylines as written and the state of a new set (`GET /api/v2/storylines/:org`). */
export function storylinesNow(org: string, ai: AiOnOff): StorylinesView {
  const orgId = resolveOrg(org);
  const job = jobReading('storylines', orgId);
  const file = storylinesPath(orgId);
  const stamp = short(`${orgId}|${fileStamp(file)}|${job.state}|${job.finishedAt ?? ''}`);
  return keptView(`stories|${importKey(orgId)}|${stamp}|${ai.available}|${ai.offReason ?? ''}`, () => {
    const raw = readJson(file);
    const stories = Array.isArray(raw?.storylines) ? (raw!.storylines as unknown[]).filter((s): s is { category: string; headline: string; body: string } =>
      !!s && typeof s === 'object' && typeof (s as { headline?: unknown }).headline === 'string' && typeof (s as { body?: unknown }).body === 'string') : null;
    const written = raw && stories ? {
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
      gameDate: typeof raw.gameDate === 'string' ? raw.gameDate : null,
      notice: noticeOf(raw.notice),
      storylines: stories,
    } : null;
    return storylinesView(aiContextFor(orgId), job, written, linkIndexFor(orgId), ai, stamp);
  });
}

/** The briefing as written and the state of a new one (`GET /api/v2/briefing/:org`). */
export function briefingNow(org: string, ai: AiOnOff): BriefingView {
  const orgId = resolveOrg(org);
  const job = jobReading('briefing', orgId);
  const file = briefingPath(orgId);
  const stamp = short(`${orgId}|${fileStamp(file)}|${job.state}|${job.finishedAt ?? ''}`);
  return keptView(`brief|${importKey(orgId)}|${stamp}|${ai.available}|${ai.offReason ?? ''}`, () => {
    const raw = readJson(file);
    const written = raw && typeof raw.markdown === 'string' ? {
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
      gameDate: typeof raw.gameDate === 'string' ? raw.gameDate : null,
      notice: noticeOf(raw.notice),
      markdown: raw.markdown,
    } : null;
    return briefingView(aiContextFor(orgId), job, written, linkIndexFor(orgId), ai, stamp);
  });
}

// ── The AI providers and keys (words only: whether a key is set comes from `settings.ts`, through `ai.ts`) ──────────

export type { ProviderReading };

const keysContext = (): AiContext => ({ importStamp: importedAt.value, gameDate: null, club: '' });

/** Every provider, where keys are kept, and whether any AI surface is on (`GET /api/v2/ai/keys`). Never a key. */
export function aiKeysNow(
  providers: ProviderReading[], featureProviders: Record<string, string>, keptIn: 'keychain' | 'stored' | 'env', anyOn: boolean,
): AiKeysView {
  const view = aiKeysView(keysContext(), providers, featureProviders, keptIn, anyOn);
  assertAuthored(view);
  return view;
}

/** A key check's outcome in words, never the key (`POST /api/v2/ai/keys/check`). */
export function keyCheckNow(provider: ProviderReading, outcome: KeyCheckOutcome, why: string): AiKeyCheckAnswer {
  const answer = keyCheckAnswer(keysContext(), provider, outcome, why);
  assertAuthored(answer);
  return answer;
}

// ── One question to the Staff room, as it streams ───────────────────────────

/**
 * The Staff room's stream in words (`POST /api/v2/staff-room/:org/ask`): `chat.ts` asks the model through the React
 * chat's own function and hands each of its events here; this turns them into the contract's events and keeps the
 * conversation in the React chat's file, as the React page keeps it: the question at once, each answer as it ends, and
 * whatever had arrived when an answer fails or the app stops listening.
 */
export class StaffRoomAnswer {
  private readonly index: LinkIndex | null;
  private readonly ctx: AiContext;
  private readonly thread: KeptMessage[];
  private current: { message: KeptMessage; id: string; stream: StreamedSubset } | null = null;
  private closed = false;

  constructor(
    private readonly orgId: number,
    private readonly withId: string,
    private readonly solo: StaffPerson | null,
    history: KeptMessage[],
    question: string,
    private readonly answering: StaffPerson[],
  ) {
    this.index = linkIndexFor(orgId);
    this.ctx = aiContextFor(orgId);
    this.thread = [...history, { role: 'user', content: question, at: new Date().toISOString() }];
    writeConversation(orgId, withId, this.thread);
  }

  /** The thread the model is handed: what the React chat sends (role, words, and who said it in a room). */
  get history(): Array<{ role: 'user' | 'assistant'; content: string; speaker?: string }> {
    return this.thread.map(({ role, content, speaker }) => (speaker ? { role, content, speaker } : { role, content }));
  }

  get finished(): boolean {
    return this.closed;
  }

  private idOf(at: number): string {
    return messageIdOf(this.thread[at], at);
  }

  started(): StaffRoomStartedEvent {
    const at = this.thread.length - 1;
    return { type: 'started', question: messageOf(this.thread[at], this.idOf(at), this.index, null), answering: this.answering.map((p) => p.id) };
  }

  /** A person starts an answer (a room names each; one person's answer starts with him). */
  speaker(person: { name: string; role: string }): StaffRoomEvent[] {
    const events = this.endAnswer();
    const message: KeptMessage = this.solo
      ? { role: 'assistant', content: '', tools: [], at: new Date().toISOString() }
      : { role: 'assistant', content: '', tools: [], speaker: person.name, speakerRole: person.role, at: new Date().toISOString() };
    this.thread.push(message);
    const id = this.idOf(this.thread.length - 1);
    this.current = { message, id, stream: new StreamedSubset() };
    const shown = messageOf(message, id, null, this.solo);
    events.push({ type: 'speaker', messageId: id, speaker: shown.speaker! });
    return events;
  }

  text(delta: string): StaffRoomEvent[] {
    const events = this.current ? [] : this.speaker(this.solo ?? { name: 'Staff', role: 'staff' });
    const c = this.current!;
    c.message.content += delta;
    const shown = c.stream.push(delta);
    if (shown) events.push({ type: 'text', messageId: c.id, delta: shown });
    return events;
  }

  tool(name: string): StaffRoomEvent[] {
    const events = this.current ? [] : this.speaker(this.solo ?? { name: 'Staff', role: 'staff' });
    const c = this.current!;
    c.message.tools = [...(c.message.tools ?? []), name];
    events.push({ type: 'looking-up', messageId: c.id, step: cell(stepWords(name)) });
    return events;
  }

  notice(message: string): StaffRoomNoticeEvent {
    return { type: 'notice', notice: cell(message) };
  }

  /** Everyone has answered: the last answer ends, and the conversation is kept. */
  done(): StaffRoomEvent[] {
    const events = this.endAnswer();
    this.keep();
    events.push({ type: 'done', count: questionCount(this.thread.filter((m) => m.role === 'user').length), conversationStamp: conversationStamp(this.orgId, this.withId) });
    return events;
  }

  /** The answer could not be finished: what was asked and what had arrived are kept, and why is said in words. */
  failed(reason: 'keyRefused' | 'declined' | 'failed', sentence: string): StaffRoomFailedEvent {
    const c = this.current;
    this.current = null;
    let partial: StaffRoomMessage | null = null;
    if (c && c.message.content.trim()) partial = messageOf(c.message, c.id, this.index, this.solo);
    else if (c) this.thread.splice(this.thread.indexOf(c.message), 1);
    this.keep();
    const event: StaffRoomFailedEvent = {
      type: 'failed', reason, failure: failureClaim(this.ctx, reason, sentence), partial, conversationStamp: conversationStamp(this.orgId, this.withId),
    };
    assertAuthored(event);
    return event;
  }

  /**
   * Keeps the conversation as it stands (an answer stopped part-way keeps what arrived; an empty one is dropped). Never
   * throws (review M2): it runs when the app stops listening, where a throw would end the server, so a file that cannot
   * be written is logged and the answer still ends in words.
   */
  keep(): void {
    if (this.closed) return;
    this.closed = true;
    const thread = this.thread.filter((m) => m.role === 'user' || m.content.trim().length > 0);
    try {
      writeConversation(this.orgId, this.withId, thread);
    } catch (err) {
      console.error('[staff-room] the conversation couldn\'t be kept:', err instanceof Error ? err.message : 'unknown');
    }
  }

  private endAnswer(): StaffRoomEvent[] {
    const c = this.current;
    this.current = null;
    if (!c) return [];
    if (!c.message.content.trim()) {
      this.thread.splice(this.thread.indexOf(c.message), 1);
      return [];
    }
    const message = messageOf(c.message, c.id, this.index, this.solo);
    return [{ type: 'answered', message }];
  }
}
