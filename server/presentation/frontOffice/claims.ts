/**
 * The evidence trail an item opens on demand (`GET /api/v2/claims/:key`; V2 plan R8). For a Major League Ops need it is
 * the staff's responses: every player Major League Ops found for the need, grouped as it grouped them (Player
 * Development's and Player Rights' answers), in its own stable order. Nothing here ranks a player or recommends one: the
 * groups say what each path would take, and the GM decides (D-001, D-024).
 *
 * The season's odds and the club's window, which the packet carries for the MLB workspace, are not read (D-060).
 */
import type { MlbNeed } from '../../mlbNeeds.js';
import type { ResponseCandidate, ResponseGroup, ResponsePacket } from '../../mlbResponses.js';
import { basis, cell, claim, target } from '../claim.js';
import { plural, sourceOf, type DepartmentContext } from './desk.js';
import { needText, type MajorLeagueInput } from './majorLeague.js';
import type { ClaimTrail, TrailSection } from './types.js';

/** Each group in the GM's words (the MLB workspace's labels name the specialists; these say what the path would take). */
const GROUP_WORDS: Record<ResponseGroup, string> = {
  open: 'Can be done now',
  open_requires_clearing: 'Can be done once a spot is cleared',
  role_concern: 'Can be done, but a poor fit for the role',
  creates_shortfall: 'Can be done, but it opens a hole behind him',
  context_dependent: 'Depends on how long he\'d be needed',
  evaluation_incomplete: 'Player Development can\'t say yet',
  indeterminate: 'Whether the move is allowed isn\'t known',
  blocked_by_development: 'Player Development doesn\'t support it',
  blocked_by_rights: 'Not a move the rules allow',
  unavailable: 'Not available',
};

const PATH_WORDS: Record<ResponseCandidate['pathKind'], string> = {
  role_change: 'a change of role',
  recall: 'a call-up',
  add_to_forty_man: 'a call-up and a 40-man spot',
};

const lines = (texts: readonly string[], label: string) =>
  [...new Set(texts.map((t) => t.trim()).filter(Boolean))].map((value) => ({ label, value }));

/** A level's name as the league's pages write it (`LEVEL_NAMES`, handed in by the service: this module reads nothing). */
export type LevelName = (level: number) => string | null;

/** Where a player's grades come from when it needs saying (D-067: "OSA's view: our scouts haven't rated him"); null otherwise. */
export type RatingsNote = (playerId: number) => string | null;

function candidateClaim(ctx: DepartmentContext, c: ResponseCandidate, levelName: LevelName, ratingsNote: RatingsNote) {
  const level = c.level === null ? null : levelName(c.level);
  const where = level ? `, in ${level}` : '';
  const because = [
    ...lines(c.why, 'Why he is here'),
    { label: 'The move', value: PATH_WORDS[c.pathKind] ?? 'a roster move' },
    ...lines(c.path.requirementsUnmet, 'First'),
    ...lines([ratingsNote(c.playerId) ?? ''], 'His ratings'),
  ];
  return claim({
    text: `${c.name}${where}: ${PATH_WORDS[c.pathKind] ?? 'a roster move'}`,
    tone: c.group === 'open' ? 'good' : c.group.startsWith('blocked') || c.group === 'unavailable' ? 'bad' : 'neutral',
    links: [target({ kind: 'player', playerId: c.playerId })],
    basis: basis({
      because,
      source: sourceOf(ctx, 'Major League Ops\' responses'),
      unknown: [...new Set(c.path.unknowns.map((u) => u.trim()).filter(Boolean))],
      wouldChange: [],
      lean: null,
      certainty: 'policy',
      stamp: 'Grouped by what Player Development and Player Rights say each move would take',
    }),
  });
}

/** The trail behind one Major League Ops need: the need, and every response grouped as the workspace groups them. */
export function needTrail(
  ctx: DepartmentContext,
  key: string,
  need: MlbNeed,
  packet: Pick<ResponsePacket, 'groups' | 'notConsidered' | 'unknowns'>,
  overview: MajorLeagueInput['overview'],
  levelName: LevelName,
  ratingsNote: RatingsNote = () => null,
): ClaimTrail {
  const { text, hint } = needText(need, overview);
  const found = packet.groups.reduce((n, g) => n + g.candidates.length, 0);
  const sections: TrailSection[] = packet.groups
    .filter((g) => g.candidates.length > 0)
    .map((g) => ({
      title: cell(GROUP_WORDS[g.group] ?? 'Other responses'),
      claims: g.candidates.map((c) => candidateClaim(ctx, c, levelName, ratingsNote)),
      empty: null,
    }));
  if (sections.length === 0) {
    sections.push({ title: cell('Responses'), claims: [], empty: cell('Nobody in the organization fits this yet') });
  }
  return {
    key,
    importStamp: ctx.build.importStamp,
    reportStamp: ctx.build.reportStamp,
    title: cell('The staff\'s options'),
    headline: claim({
      text,
      hint,
      tone: 'neutral',
      basis: basis({
        because: [
          { label: 'Players found', value: String(found) },
          ...packet.notConsidered.map((n) => ({ label: 'Not considered', value: `${plural(n.count, 'player')}: ${n.reason}` })),
        ],
        source: sourceOf(ctx, 'Major League Ops\' responses'),
        unknown: [...new Set(packet.unknowns.map((u) => u.trim()).filter(Boolean))],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
    }),
    sections,
  };
}
