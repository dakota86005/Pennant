import { Router } from 'express';
import { db, hasColumns, tableExists } from './db.js';
import { LEVEL_NAMES } from './valuation.js';
import {
  clubWinValue, contractSeasonFor, controlSummaryOf, lensPhilosophyFrom, ourViewOf, playerValues, productionHeadlineOf, tradeValueOf,
  type ClubWinValue, type LensPhilosophy, type PlayerValuation, type TradeControlSummary, type TradeDifference, type TradeEntryInput,
  type TradePlayerValue, type TradeProduction, type TradeUnit, type TradeValue,
} from './playerValue.js';
import { freshnessCue, getDataStatus, type DataStatus, type FreshnessCue } from './dataStatus.js';
import { resolvePhilosophy } from './philosophy.js';
import { POSITION_NAMES, clubDepth, positionNeeds, weakestOf } from './positionNeeds.js';
import { philosophyForOrg } from './settings.js';
import { viewingOrganization } from './ourViewRoutes.js';
import { padDate } from './rosterops.js';
import { contactProfiles } from './battedball.js';
import { POSITION_CODES, glovesLine } from './gloves.js';
import { computeBatting, computePitching, leagueBaseline } from './stats.js';
import { blockedIds } from './tradingblock.js';

/**
 * The Trade Center on Player Value (phase 6b; PLAYER_VALUE.md Part 8, consumer 3; D-052).
 *
 * Every figure a deal carries is Player Value's, read through its entry point: each player's contract value and value of
 * keeping him exactly as the player card serves them, his control season by season with its cost, and his expected
 * production; both sides and the difference between them (what comes in less what goes out) as a band with its parts,
 * combined by `tradeValueOf` (owner Q-8: never a point, a single score or a verdict). The viewing club's philosophy is read
 * here, at read time, and handed to the lens beside the neutral figures, which are the same whoever looks. The club's value
 * of a win is context from the standings. Nothing here reads `players_value`, a percentile or an OOTP rating (D-017).
 */
export const tradeRoutes = Router();

const teamLabel = `CASE WHEN t.name = t.nickname THEN t.name ELSE t.name || ' ' || t.nickname END`;

// ── who the players are ─────────────────────────────────────────────────────

interface PlayerFacts {
  player_id: number;
  name: string;
  age: number | null;
  position: number;
  team: string | null;
  teamAbbr: string | null;
  organizationId: number | null;
  level: number | null;
}

function playerFacts(ids: number[]): Map<number, PlayerFacts> {
  const out = new Map<number, PlayerFacts>();
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id));
  if (unique.length === 0 || !tableExists('players')) return out;
  for (let at = 0; at < unique.length; at += 500) {
    const chunk = unique.slice(at, at + 500);
    const rows = db
      .prepare(
        `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.age, p.position, p.organization_id,
                ${teamLabel} AS team, t.abbr AS team_abbr, t.level
         FROM players p LEFT JOIN teams t ON t.team_id = p.team_id
         WHERE p.player_id IN (${chunk.map(() => '?').join(',')})`
      )
      .all(...chunk) as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.set(r.player_id as number, {
        player_id: r.player_id as number,
        name: String(r.name ?? ''),
        age: typeof r.age === 'number' ? r.age : null,
        position: Number(r.position ?? 0),
        team: (r.team as string | null) ?? null,
        teamAbbr: (r.team_abbr as string | null) ?? null,
        organizationId: typeof r.organization_id === 'number' && r.organization_id > 0 ? r.organization_id : null,
        level: typeof r.level === 'number' ? r.level : null,
      });
    }
  }
  return out;
}

/** One player as a trade row shows him: who he is, his control with its cost, his expected production, his pay this season. */
export interface TradeRow {
  playerId: number;
  name: string;
  age: number | null;
  position: string;
  team: string | null;
  teamAbbr: string | null;
  organizationId: number | null;
  level: string;
  /** His own club has listed him for trade. */
  listed: boolean;
  control: TradeControlSummary;
  production: TradeProduction;
  /** His salary this season, where the export states it; null where it does not (never $0). */
  salaryNow: { season: number; amount: number } | null;
}

const NO_CONTROL: TradeControlSummary = { text: 'Control not established', controlled: null, pastHorizon: false, path: [] };
const NO_PRODUCTION: TradeProduction = { status: 'unknown', reason: "He isn't an active player in the export.", now: null, next: null, nextReason: null };

function rowOf(id: number, facts: PlayerFacts | undefined, value: PlayerValuation | undefined, listed: Set<number>): TradeRow {
  const season = value?.control.thisSeason ?? null;
  const salary = value && season !== null ? contractSeasonFor(value.contract, season)?.salary.value ?? null : null;
  return {
    playerId: id,
    name: facts?.name ?? `Player ${id}`,
    age: facts?.age ?? null,
    position: POSITION_NAMES[facts?.position ?? 0] ?? '?',
    team: facts?.team ?? null,
    teamAbbr: facts?.teamAbbr ?? null,
    organizationId: facts?.organizationId ?? null,
    level: facts?.level ? LEVEL_NAMES[facts.level] ?? `L${facts.level}` : 'unknown',
    listed: listed.has(id),
    control: value ? controlSummaryOf(value.control) : NO_CONTROL,
    production: value ? productionHeadlineOf(value.production) : NO_PRODUCTION,
    salaryNow: salary !== null && season !== null ? { season, amount: salary } : null,
  };
}

// ── the analysis ────────────────────────────────────────────────────────────

/** Whose view, and the philosophy the lens reads; null leaves our view out (the neutral figures stand alone). */
export interface TradeViewer {
  orgId: number | null;
  philosophy: LensPhilosophy | null;
}

export interface TradeAnalysis {
  organization: { id: number; name: string | null } | null;
  /** What the viewing club sends, and receives. */
  sent: TradeRow[];
  received: TradeRow[];
  /** Player Value's reading of the deal: each player's figures, the side totals and the difference as a band with its parts. */
  value: TradeValue;
  /** Salary this season on each side: the known sum, and the players whose salary the export does not state. */
  salary: { sent: SalarySide; received: SalarySide };
  /** Context from the standings, never part of any figure: the viewing club first, then the other clubs in the deal. */
  winValues: ClubWinValue[];
  /** How current the export is (A-20): handed to Player Value as `currentState`, and said on the page. */
  freshness: FreshnessCue & { limitations: string[] };
}

interface SalarySide {
  season: number | null;
  known: number;
  unknown: number[];
}

function salaryOf(rows: TradeRow[]): SalarySide {
  return {
    season: rows.find((r) => r.salaryNow)?.salaryNow?.season ?? null,
    known: rows.reduce((s, r) => s + (r.salaryNow?.amount ?? 0), 0),
    unknown: rows.filter((r) => !r.salaryNow).map((r) => r.playerId),
  };
}

function clubName(teamId: number): string | null {
  if (!tableExists('teams')) return null;
  const row = db.prepare(`SELECT name, nickname FROM teams WHERE team_id = ?`).get(teamId) as { name?: unknown; nickname?: unknown } | undefined;
  if (!row) return null;
  return [row.name, row.nickname].filter((x, i, all) => typeof x === 'string' && x.length > 0 && all.indexOf(x) === i).join(' ') || null;
}

/**
 * A deal read on Player Value: both sides and the difference between them, neutral, with our view beside it where the
 * viewer's philosophy is given. The neutral figures never depend on who looks (a contender and a seller read the same).
 */
export function analyzeTrade(sentIds: number[], receivedIds: number[], viewer: TradeViewer, status: DataStatus = getDataStatus()): TradeAnalysis {
  const sent = [...new Set(sentIds.map(Number).filter(Number.isInteger))];
  const received = [...new Set(receivedIds.map(Number).filter(Number.isInteger))].filter((id) => !sent.includes(id));
  const ids = [...sent, ...received];
  // As current as the export is (A-20): a stale export leaves service, control and what rests on them not established
  const cue = freshnessCue(status);
  const values = playerValues(ids, { currentState: cue.state });
  const facts = playerFacts(ids);
  const listed = blockedIds();

  const entry = (id: number): TradeEntryInput => {
    const v = values.get(id);
    const surplus = v?.surplus ?? null;
    if (!surplus || !viewer.philosophy) return { playerId: id, surplus };
    const holder = v!.control.holder.value;
    const ours = viewer.orgId === null || v!.control.standing === 'unknown' ? null : holder === viewer.orgId;
    return { playerId: id, surplus, ourView: ourViewOf({ neutral: surplus, philosophy: viewer.philosophy, ours }) };
  };
  const value = tradeValueOf({ sent: sent.map(entry), received: received.map(entry) });
  const sentRows = sent.map((id) => rowOf(id, facts.get(id), values.get(id), listed));
  const receivedRows = received.map((id) => rowOf(id, facts.get(id), values.get(id), listed));

  // Context: the viewing club's value of a win, then each other club whose players are in the deal
  const clubs = [
    ...(viewer.orgId !== null ? [viewer.orgId] : []),
    ...[...sentRows, ...receivedRows].map((r) => r.organizationId).filter((o): o is number => o !== null),
  ].filter((o, i, all) => all.indexOf(o) === i);
  const winValues = clubs.slice(0, 4).map((c) => clubWinValue(c));

  return {
    organization: viewer.orgId !== null ? { id: viewer.orgId, name: clubName(viewer.orgId) } : null,
    sent: sentRows,
    received: receivedRows,
    value,
    salary: { sent: salaryOf(sentRows), received: salaryOf(receivedRows) },
    winValues,
    freshness: { ...cue, limitations: limitationsOf(values) },
  };
}

/** Player Rights' limitations on the players read (the unverified export's, where it could not be checked), once each. */
function limitationsOf(values: Map<number, PlayerValuation>): string[] {
  return [...new Set([...values.values()].map((v) => v.control.eligibility?.limitation).filter((x): x is string => !!x))];
}

/** The viewer for a request: the organization it names (else the configured one, else the managed club) and its philosophy. */
function viewerFor(requested: unknown): TradeViewer {
  const org = viewingOrganization(requested);
  if (!org) return { orgId: null, philosophy: null };
  return { orgId: org.id, philosophy: lensPhilosophyFrom(resolvePhilosophy(philosophyForOrg(org.id))) };
}

tradeRoutes.post('/trade/analyze', (req, res) => {
  const { sideA, sideB, orgId } = req.body as { sideA?: unknown; sideB?: unknown; orgId?: unknown };
  if (!Array.isArray(sideA) || !Array.isArray(sideB)) {
    return res.status(400).json({ error: 'sideA and sideB arrays required' });
  }
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  res.json(analyzeTrade(sideA as number[], sideB as number[], viewerFor(orgId)));
});

// ── trade fits: expected wins by position ───────────────────────────────────

type FactsWithTeam = PlayerFacts & { teamId: number };

function majorLeagueDepth(currentState?: FreshnessCue['state']): { clubs: Array<{ teamId: number; label: string }>; values: Map<number, PlayerValuation>; facts: Map<number, FactsWithTeam> } {
  const clubs = (db
    .prepare(`SELECT t.team_id, ${teamLabel} AS label FROM teams t WHERE t.level = 1 AND t.allstar_team = 0`)
    .all() as Array<{ team_id: number; label: string }>).map((c) => ({ teamId: c.team_id, label: c.label }));
  const rows = db
    .prepare(
      `SELECT p.player_id, p.team_id FROM players p JOIN teams t ON t.team_id = p.team_id
       WHERE t.level = 1 AND t.allstar_team = 0 AND p.retired = 0 AND p.position != 1`
    )
    .all() as Array<{ player_id: number; team_id: number }>;
  const ids = rows.map((r) => r.player_id);
  const base = playerFacts(ids);
  const facts = new Map<number, FactsWithTeam>();
  for (const r of rows) {
    const f = base.get(r.player_id);
    if (f) facts.set(r.player_id, { ...f, teamId: r.team_id });
  }
  return { clubs, values: playerValues(ids, { currentState }), facts };
}

/**
 * Trade fits: where another club is weakest, a player of yours who is not your starter there but is expected to add more
 * wins this season than their best there; and the same the other way. Each match shows both figures (expected wins, the
 * most likely reading, from Player Value); the clubs are ordered by how many matches they have, a shown count. A lead for
 * the GM, not a verdict: the bands behind the figures are wide, and roster fit is his judgment.
 */
tradeRoutes.get('/trade/fits/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players') || !tableExists('teams')) return res.status(400).json({ error: 'No data imported yet' });
  const cue = freshnessCue(getDataStatus());
  const { clubs, values, facts } = majorLeagueDepth(cue.state);
  const me = clubs.find((c) => c.teamId === orgId);
  if (!me) return res.status(404).json({ error: 'Unknown org' });
  const myDepth = clubDepth(orgId, values, facts.values());
  const mine = weakestOf(myDepth);

  const fits = clubs
    .filter((c) => c.teamId !== orgId)
    .map((club) => {
      const theirDepth = clubDepth(club.teamId, values, facts.values());
      const theirs = weakestOf(theirDepth);
      const theyNeed = theirs.weakest
        .map((w) => ({
          positionName: w.positionName,
          theirBest: w.best,
          myCandidates: (myDepth.find((d) => d.position === w.position)?.players ?? []).slice(1).filter((p) => p.wins > w.best.wins),
        }))
        .filter((n) => n.myCandidates.length > 0);
      const theyOffer = mine.weakest
        .map((w) => ({
          positionName: w.positionName,
          myBest: w.best,
          players: (theirDepth.find((d) => d.position === w.position)?.players ?? []).slice(1).filter((p) => p.wins > w.best.wins),
        }))
        .filter((o) => o.players.length > 0);
      return { orgId: club.teamId, label: club.label, matches: theyNeed.length + theyOffer.length, theyNeed, theyOffer };
    })
    .filter((f) => f.matches > 0)
    .sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label));

  res.json({
    myWeakest: mine.weakest,
    notEstablished: mine.notEstablished,
    fits: fits.slice(0, 10),
    freshness: cue,
    basis:
      "Expected wins this season (the part still to be played, most likely), from Player Value's production. A match is a player " +
      "who isn't his club's starter at a position yet is expected to add more wins than the other club's best there. Players whose " +
      'production is not established are left out and never counted as zero.',
  });
});

tradeRoutes.get('/search-players', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2 || !tableExists('players')) return res.json([]);
  const rows = db
    .prepare(
      `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.age, p.position,
              ${teamLabel} AS team, t.level
       FROM players p LEFT JOIN teams t ON t.team_id = p.team_id
       WHERE p.retired = 0 AND p.team_id > 0
         AND (p.first_name || ' ' || p.last_name) LIKE ?
       ORDER BY t.level, p.age LIMIT 20`
    )
    .all(`%${q}%`) as Array<Record<string, unknown>>;
  res.json(rows.map((r) => ({ ...r, positionName: POSITION_NAMES[r.position as number] ?? '?' })));
});

/**
 * Actual offers sitting in the OOTP inbox.
 *
 * These were missed for a long time because of how they are stored. A proposal
 * looks almost exactly like the "would it make sense to target X?" notes from
 * your own staff — same message_type, same sender_type, same recipient — and
 * the earlier reader keyed on `team_id_0` and `team_id_1`, which a proposal
 * leaves empty. So every real offer was filtered out and only the suggestions
 * came through.
 *
 * What identifies a proposal is `sender_id` naming a club and `trade_id`
 * naming a deal. Which players go which way is not stored at all: the message
 * lists them together, and the sides are recovered by asking who each man
 * currently plays for. That reconstruction is checked against OOTP's own
 * wording — a Braves offer of Dylan Lee and Ivan Gomez for Henry Lalane comes
 * back exactly that way.
 *
 * Deliberately structural rather than textual. Reading the subject line would
 * work in English and quietly fail in every other language OOTP ships.
 *
 * Each offer carries the same reading the analyser gives (phase 6b): the difference as a band, never a verdict.
 */
tradeRoutes.get('/trade-proposals/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('messages') || !tableExists('players')) return res.json({ proposals: [] });

  const msgs = db
    .prepare(
      `SELECT m.message_id, m.subject, m.date, m.sender_id, m.trade_id,
              m.player_id_0, m.player_id_1, m.player_id_2, m.player_id_3, m.player_id_4,
              m.player_id_5, m.player_id_6, m.player_id_7, m.player_id_8, m.player_id_9,
              ${teamLabel} AS sender_label
       FROM messages m
       LEFT JOIN teams t ON t.team_id = m.sender_id
       WHERE m.recipient_id = 1 AND m.deleted = 0
         AND m.sender_id > 0 AND m.trade_id != 0 AND m.player_id_0 != 0`
    )
    .all() as Array<Record<string, number | string | null>>;

  const orgOf = db.prepare(`SELECT organization_id AS org FROM players WHERE player_id = ?`);
  const viewer = viewerFor(orgId);

  const proposals = msgs
    .map((m) => {
      const sender = Number(m.sender_id);
      const ids = Array.from({ length: 10 }, (_, i) => Number(m[`player_id_${i}`] ?? 0)).filter(Boolean);
      const theirs: number[] = [];
      const ours: number[] = [];
      for (const id of ids) {
        const org = (orgOf.get(id) as { org: number } | undefined)?.org;
        if (org === sender) theirs.push(id);
        else if (org === orgId) ours.push(id);
      }
      // A message naming players on only one side is not an offer to weigh
      if (theirs.length === 0 || ours.length === 0) return null;
      // The same reading the analyser gives, so an offer read here and one loaded into the builder never disagree
      const analysis = analyzeTrade(ours, theirs, { orgId: viewer.orgId ?? orgId, philosophy: null });
      const brief = (r: TradeRow) => ({ player_id: r.playerId, name: r.name, age: r.age, positionName: r.position, team: r.team });
      return {
        message_id: Number(m.message_id),
        trade_id: Number(m.trade_id),
        subject: String(m.subject ?? ''),
        date: padDate(m.date),
        from: { team_id: sender, label: String(m.sender_label ?? 'Unknown') },
        theySend: { players: analysis.received.map(brief) },
        weSend: { players: analysis.sent.map(brief) },
        unit: analysis.value.unit,
        difference: analysis.value.difference,
        salary: analysis.salary,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

  res.json({ proposals });
});

/** A player's contract value as a talk card or the trading block shows it: most likely and its range, or why it is not known. */
export interface ValueGlance {
  status: 'known' | 'unknown';
  unit: TradeUnit | null;
  low: number | null;
  central: number | null;
  high: number | null;
  centralRange: { low: number; high: number } | null;
  reason: string | null;
}

export function valueGlance(p: TradePlayerValue | undefined, unit: TradeUnit | null): ValueGlance {
  if (!p || !p.counted || !p.contract) {
    return { status: 'unknown', unit, low: null, central: null, high: null, centralRange: null, reason: p?.notCounted ?? 'Not valued yet.' };
  }
  return { status: 'known', unit, ...p.contract, reason: null };
}

tradeRoutes.get('/trade-talk/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('messages') || !tableExists('players')) return res.json({ items: [] });
  const rows = db
    .prepare(
      `SELECT m.message_id, m.subject, m.date, m.team_id_0 AS other_team, m.player_id_0 AS player_id,
              ${teamLabel} AS other_label
       FROM messages m
       JOIN players p ON p.player_id = m.player_id_0
       LEFT JOIN teams t ON t.team_id = m.team_id_0
       WHERE m.recipient_id = 1 AND m.sender_type = 0 AND m.deleted = 0
         AND m.team_id_0 != 0 AND m.team_id_1 = ? AND m.player_id_0 != 0
         AND p.retired = 0`
    )
    .all(orgId) as Array<Record<string, unknown>>;

  // The same player is asked about more than once as the season goes on; the
  // newest message is the live one, and repeating him is just noise
  const seen = new Set<number>();
  const fresh = rows
    // OOTP writes dates unpadded, so newest-first has to sort on a padded copy
    .sort((a, b) => String(padDate(b.date) ?? '').localeCompare(String(padDate(a.date) ?? '')))
    .filter((r) => !seen.has(r.player_id as number) && seen.add(r.player_id as number));
  const ids = fresh.map((r) => r.player_id as number);
  // Each target read as the analyser reads a player coming in
  const analysis = analyzeTrade([], ids, { orgId, philosophy: null });
  const items = fresh.map((r) => {
    const id = r.player_id as number;
    const row = analysis.received.find((x) => x.playerId === id)!;
    return {
      message_id: r.message_id as number,
      subject: r.subject as string,
      date: r.date as string,
      otherTeam: { orgId: r.other_team as number, label: (r.other_label as string) ?? 'Unknown' },
      player: {
        player_id: id,
        name: row.name,
        age: row.age,
        positionName: row.position,
        levelName: row.level,
        value: valueGlance(analysis.value.received.players.find((p) => p.playerId === id), analysis.value.unit),
        control: row.control.text,
        salaryNow: row.salaryNow,
      },
    };
  });
  res.json({ items });
});

/**
 * One club's whole organisation, ready to pick from.
 *
 * Typing each name is the slow part of judging an offer — a five-man deal is
 * five searches, and you are copying names off another screen while you do it.
 * An offer already names a club, so this hands back that club's players to
 * click through instead. Prospects are included because they are usually what
 * the other side is asking for. Ordered by level and name: no hidden score.
 */
tradeRoutes.get('/trade/roster/:teamId', (req, res) => {
  const teamId = Number(req.params.teamId);
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const rows = db
    .prepare(
      `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.age, p.position,
              ${teamLabel} AS team, t.level
       FROM players p LEFT JOIN teams t ON t.team_id = p.team_id
       WHERE p.organization_id = ? AND p.retired = 0 AND p.team_id > 0
         AND p.player_id IN (SELECT player_id FROM team_roster WHERE list_id = 1)`
    )
    .all(teamId) as Array<Record<string, unknown>>;
  const players = rows
    .map((r) => ({
      player_id: r.player_id as number,
      name: r.name as string,
      age: r.age as number,
      positionName: POSITION_NAMES[r.position as number] ?? '?',
      team: r.team as string,
      level: (r.level as number | null) ?? 99,
      levelName: LEVEL_NAMES[r.level as number] ?? 'R',
    }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map(({ level: _level, ...p }) => p);
  res.json({ players });
});

// ── Context for judging a trade ─────────────────────────────────────────

const ROLE_NAMES: Record<number, string> = { 11: 'Starter', 12: 'Reliever', 13: 'Closer' };

/**
 * A player as a trade needs him described: what he is, how he is playing, where he would actually stand on this club,
 * and Player Value's reading of him (contract value, value of keeping him, control with its cost, expected wins).
 */
function tradePlayer(id: number, statYear: number | null, reading: { row: TradeRow; value: TradePlayerValue | null; unit: TradeUnit | null }) {
  const p = db
    .prepare(
      `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.age, p.position, p.role,
              p.bats, p.throws, ${teamLabel} AS team, t.level, t.league_id, p.organization_id
       FROM players p
       LEFT JOIN teams t ON t.team_id = p.team_id
       WHERE p.player_id = ?`
    )
    .get(id) as Record<string, number | string | null> | undefined;
  if (!p) return null;

  const level = p.level as number | null;
  const isPitcher = p.position === 1;

  /*
   * The season line, at whatever level he played it — a Double-A ERA is not a
   * major-league one and the reader must be able to tell them apart.
   *
   * The baseline has to come from the league he actually played in. Measuring
   * an A-ball arm against the major-league average is how ERA+ came back null
   * for every minor leaguer, which is worse than useless in a comparison the
   * whole point of which is to place him.
   */
  let line: Record<string, number | null> | null = null;
  const league = p.league_id as number | null;
  if (statYear !== null && level !== null && league) {
    const baseline = leagueBaseline(league, statYear, level);
    const table = isPitcher ? 'players_career_pitching_stats' : 'players_career_batting_stats';
    const cols = isPitcher
      ? `SUM(outs) AS outs, SUM(er) AS er, SUM(ra) AS ra, SUM(ha) AS ha, SUM(bb) AS bb,
         SUM(k) AS k, SUM(hra) AS hra, SUM(bf) AS bf, SUM(g) AS g, SUM(gs) AS gs,
         SUM(w) AS w, SUM(l) AS l, SUM(s) AS sv, SUM(hld) AS hld, SUM(war) AS war`
      : `SUM(pa) AS pa, SUM(ab) AS ab, SUM(h) AS h, SUM(d) AS d, SUM(t) AS t3, SUM(hr) AS hr,
         SUM(bb) AS bb, SUM(ibb) AS ibb, SUM(hp) AS hp, SUM(sf) AS sf, SUM(k) AS k,
         SUM(sb) AS sb, SUM(cs) AS cs, SUM(r) AS r, SUM(rbi) AS rbi, SUM(war) AS war`;
    try {
      const row = db
        .prepare(
          `SELECT player_id, ${cols} FROM ${table}
           WHERE player_id = ? AND year = ? AND split_id = 1 AND league_id != 0 GROUP BY player_id`
        )
        .get(id, statYear) as Record<string, number> | undefined;
      if (row) line = isPitcher ? computePitching(row, baseline, 0) : computeBatting(row, baseline, 0);
    } catch {
      // An export without a column the line needs: the line is unknown, never a guess
      line = null;
    }
  }

  const v = reading.value;
  return {
    player_id: id,
    name: p.name,
    age: p.age,
    position: POSITION_NAMES[p.position as number] ?? '?',
    role: isPitcher ? (ROLE_NAMES[p.role as number] ?? 'Pitcher') : null,
    bats: ({ 1: 'R', 2: 'L', 3: 'S' } as Record<number, string>)[p.bats as number] ?? '?',
    throws: ({ 1: 'R', 2: 'L' } as Record<number, string>)[p.throws as number] ?? '?',
    currentClub: p.team,
    level: LEVEL_NAMES[level ?? 0] ?? 'unknown',
    isMajorLeaguer: level === 1,
    salaryNow: reading.row.salaryNow,
    seasonLine: line,
    /*
     * Player Value's reading of him (phase 6b): his contract value (the trade view) and the value of keeping him, each
     * most likely with its range, in the deal's unit; or, where he is not valued, the reason. The desk quotes these and
     * never makes up a value of its own.
     */
    value: v
      ? {
        unit: reading.unit,
        counted: v.counted,
        contractValue: v.contract,
        valueOfKeepingHim: v.keeping,
        seasons: v.seasons,
        ifKeptOnly: v.ifHeld,
        dependsOn: v.dependsOn,
        notValued: v.notCounted,
        why: v.reason,
        ourView: v.ours ? { leaning: v.ours.leaning, contractValue: v.ours.contract, valueOfKeepingHim: v.ours.keeping, leans: v.ours.leans.map((l) => l.text), notes: v.ours.notes.map((n) => n.text) } : null,
      }
      : null,
    /*
     * What happens to him when the deal ends, not merely that it ends: each season of control with what it costs, from
     * Player Value's control timeline (Player Rights' statuses). A man with two arbitration years left is not a rental.
     */
    control: reading.row.control,
    expectedWins: reading.row.production,
    contact: isPitcher ? null : (contactProfiles([id]).get(id) ?? null),
    /*
     * Where he can play, and how well. Without this the desk was judging men
     * on their bats alone — and said so when asked whether a second baseman
     * could be moved to short, which is exactly the question a trade raises.
     */
    fielding: glovesLine(id),
    fieldingStats: fieldingRecord(id, statYear),
  };
}

/**
 * What he has actually done in the field, position by position.
 *
 * The ratings say what he is; this says what happened. A man rated 60 at short
 * who has made fourteen errors in forty games is a different proposition from
 * one who has not, and only one of those two facts is in the ratings.
 *
 * The current season is stored under split 0 and completed ones under split 1,
 * which is worth knowing: filtering on split 1 alone returns every year except
 * the one being asked about. Last season is carried too, because a handful of
 * games at a position he no longer plays is the strongest evidence there is
 * that he can — which is the question a trade actually raises. An export without
 * zone rating or double plays reads without them (schema-tolerant).
 */
function fieldingRecord(id: number, statYear: number | null): string | null {
  const table = 'players_career_fielding_stats';
  if (statYear === null || !hasColumns(table, 'player_id', 'year', 'position', 'level_id', 'split_id', 'g', 'po', 'a', 'e')) return null;
  const zr = hasColumns(table, 'zr');
  const rows = db
    .prepare(
      `SELECT year, position, level_id, SUM(g) AS g, SUM(po) AS po, SUM(a) AS a,
              SUM(e) AS e${zr ? ', AVG(zr) AS zr' : ''}
       FROM players_career_fielding_stats
       -- The season in progress is split 0; the ones behind it are split 1
       --
       -- Level is in the grouping rather than the filter. A man who spent half
       -- the year at Triple-A has two records at the same position and they are
       -- two different pieces of evidence: a clean glove in the minors is not a
       -- clean glove in the majors, and merging them says he has one when the
       -- desk cannot tell which
       WHERE player_id = ? AND year >= ? AND split_id IN (0, 1)
       GROUP BY year, position, level_id HAVING g > 0
       ORDER BY year DESC, g DESC`
    )
    .all(id, statYear - 1) as Array<Record<string, number>>;
  if (rows.length === 0) return null;
  return rows
    .slice(0, 5)
    .map((r) => {
      const chances = (r.po ?? 0) + (r.a ?? 0) + (r.e ?? 0);
      const pct = chances > 0 ? ((r.po + r.a) / chances).toFixed(3).replace(/^0/, '') : '—';
      const zone = r.zr ? `, ${r.zr > 0 ? '+' : ''}${r.zr.toFixed(2)} ZR` : '';
      const when = r.year === statYear ? 'this year' : `${r.year}`;
      // Named, so a Triple-A glove is never read as a major-league one
      const where = LEVEL_NAMES[r.level_id] ?? `L${r.level_id}`;
      return `${POSITION_CODES[(r.position ?? 1) - 1] ?? '?'} ${when} (${where}): ` +
        `${r.g}g, ${r.e}E, ${pct} fpct${zone}`;
    })
    .join('; ');
}

/** The difference as the desk reads it: most likely, its range and its parts, or why it is not a number. */
function differenceForDesk(d: TradeDifference) {
  return {
    status: d.status,
    reason: d.reason,
    figure: d.figure,
    everyPlayerAtHisEdge: d.edges,
    parts: d.components.map((c) => ({ playerId: c.playerId, side: c.side === 'sent' ? 'weGive' : 'weReceive', part: c.part })),
    leftOut: d.excluded,
    basis: d.text,
  };
}

/**
 * Everything needed to judge a trade rather than merely price it.
 *
 * A deal's value alone produces a reading about numbers. A club does not run on numbers alone — it runs on a roster with
 * a fixed number of places, each already occupied by somebody. So the incoming players arrive with their season line at
 * the level they played it and Player Value's reading of each, and beside them the men they would actually have to
 * displace, plus where the club is weakest; the deal itself is Player Value's reading, both sides and the difference as a
 * band with its parts (the same figures the page shows), which the desk explains and never replaces (D-001).
 */
export function tradeContext(orgId: number, giveIds: number[], getIds: number[]) {
  const statYear = hasColumns('players_career_batting_stats', 'year')
    ? ((db.prepare(`SELECT MAX(year) AS y FROM players_career_batting_stats`).get() as { y: number | null }).y ?? null)
    : null;

  const viewer = viewerFor(orgId || undefined);
  const analysis = analyzeTrade(giveIds, getIds, { orgId: orgId || viewer.orgId, philosophy: viewer.philosophy });
  const cue = analysis.freshness;
  const readingOf = (id: number) => ({
    row: [...analysis.sent, ...analysis.received].find((r) => r.playerId === id)!,
    value: [...analysis.value.sent.players, ...analysis.value.received.players].find((p) => p.playerId === id) ?? null,
    unit: analysis.value.unit,
  });
  const give = analysis.sent.map((r) => tradePlayer(r.playerId, statYear, readingOf(r.playerId))).filter(Boolean);
  const get = analysis.received.map((r) => tradePlayer(r.playerId, statYear, readingOf(r.playerId))).filter(Boolean);

  // Who already holds the jobs the incoming men would want. Only the
  // major-league roster: a prospect is not competing with anybody yet.
  /*
   * Grouped by the job, which for a pitcher is his role rather than "P".
   * Listing Max Fried as a man a relief arm would displace is not a comparison
   * anybody would make: a reliever competes with relievers.
   */
  const jobOf = (p: { position: string; role: string | null }): string => p.role ?? p.position;
  const incomingPositions = new Set(
    get.filter((p) => p && p.isMajorLeaguer).map((p) => jobOf(p!))
  );
  const leaving = new Set(analysis.sent.map((r) => r.playerId));
  const incumbents: Record<string, unknown[]> = {};
  if (incomingPositions.size > 0 && tableExists('team_roster')) {
    const roster = (db
      .prepare(
        `SELECT p.player_id FROM players p
         WHERE p.organization_id = ? AND p.retired = 0
           AND p.player_id IN (SELECT player_id FROM team_roster WHERE team_id = ? AND list_id = 1)`
      )
      .all(orgId, orgId) as Array<{ player_id: number }>).map((r) => r.player_id).filter((id) => !leaving.has(id));
    const held = analyzeTrade(roster, [], { orgId, philosophy: null });
    for (const row of held.sent) {
      const man = tradePlayer(row.playerId, statYear, {
        row, value: held.value.sent.players.find((p) => p.playerId === row.playerId) ?? null, unit: held.value.unit,
      });
      if (!man || !man.isMajorLeaguer) continue;
      if (!incomingPositions.has(jobOf(man))) continue;
      (incumbents[jobOf(man)] ??= []).push(man);
    }
    // Most expected wins first (the shown figure), so the man actually holding the job leads; unknown last, never zero
    for (const pos of Object.keys(incumbents)) {
      const now = (m: unknown) => (m as { expectedWins: TradeProduction }).expectedWins.now?.wins.central ?? null;
      (incumbents[pos] as unknown[]).sort((a, b) => {
        const x = now(a);
        const y = now(b);
        return x === null ? (y === null ? 0 : 1) : y === null ? -1 : y - x;
      });
      incumbents[pos] = (incumbents[pos] as unknown[]).slice(0, 4);
    }
  }

  // The club's thinnest positions, one reading with Free Agents' and the draft board's (positionNeeds.ts)
  const needs = tableExists('teams') ? positionNeeds(orgId, { currentState: cue.state }) : null;

  /*
   * Whether the men in this deal are actually on the market.
   *
   * It changes the read entirely and the desk had no way to know it. A club
   * that has listed a player is telling you it wants to move him and the price
   * starts lower; a club that has not is being asked for a favour. The save
   * has carried this in the trading block all along.
   */
  const onTheBlock = {
    weGive: analysis.sent.filter((r) => r.listed).map((r) => r.name),
    weReceive: analysis.received.filter((r) => r.listed).map((r) => r.name),
  };

  return {
    weGive: give,
    weReceive: get,
    /*
     * Player Value's reading of the deal, the same figures the page shows beside the desk's answer: each side's contract
     * value and the difference (what comes in less what goes out) as a band with its parts, in `unit`; our view where the
     * club's philosophy leans. The desk quotes these and never makes up a value of its own.
     */
    value: {
      unit: analysis.value.unit,
      unitReason: analysis.value.unitReason,
      weGive: { total: analysis.value.sent.total.figure, everyPlayerAtHisEdge: analysis.value.sent.total.edges, leftOut: analysis.value.sent.total.excluded },
      weReceive: { total: analysis.value.received.total.figure, everyPlayerAtHisEdge: analysis.value.received.total.edges, leftOut: analysis.value.received.total.excluded },
      difference: differenceForDesk(analysis.value.difference),
      ourView: analysis.value.ourView
        ? { leaning: analysis.value.ourView.leaning, difference: differenceForDesk(analysis.value.ourView.difference) }
        : null,
      basis: analysis.value.basis,
    },
    salaryThisSeason: analysis.salary,
    clubValueOfAWin: analysis.winValues.map((w) => ({ club: w.club, status: w.status, text: w.text, reason: w.reason })),
    whoTheyWouldDisplace: incumbents,
    /** Named here are the men their own clubs have listed for trade. */
    onTheBlock,
    clubNeeds: needs
      ? { weakestPositions: needs.positions.filter((p) => p.best !== null).slice(0, 3), positionsNotEstablished: needs.notEstablished }
      : null,
    /** How current the data is: the export's game date, and a warning where it is behind the save or could not be checked. */
    dataFreshness: { asOf: cue.asOf, warning: cue.line },
  };
}
