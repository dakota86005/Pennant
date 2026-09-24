import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, tableExists } from './db.js';
import { jobStatus, startJob } from './jobs.js';
import { orgInjuries } from './dashboard.js';
import { DATA_DIR } from './config.js';
import {
  activeProvider, featureModel, featureProvider, providerCredential,
} from './settings.js';
import { PROVIDERS, describeError, providerFor, toolLoop, type FallbackNotice } from './providers.js';
import { TOOLS, runTool } from './chat.js';
import { computeProspects } from './org.js';
import { farmBriefing } from './farmOperations.js';
import { computeContracts } from './contracts.js';
import { tradeContext } from './trade.js';
import { tradingBlock } from './tradingblock.js';
import { tradeVoice, type Persona } from './staff.js';
import {
  VALUE_PERCENTILE_NOTE, calendarBriefing, currentGameDate, rulesBriefing, seasonYear, teamFinances,
} from './valuation.js';

export const aiRoutes = Router();

/** Names the provider actually selected, since it may not be Anthropic. */
const noKeyMessage = (provider = activeProvider()): string => {
  const p = PROVIDERS.find((x) => x.id === provider);
  return `No ${p?.label ?? 'API'} key set. Open Settings and add your key — you can get one at ${p?.console ?? 'the provider console'}.`;
};

/**
 * A missing key is ours to explain. Everything else has already been put into
 * words by callOpusThread, so it is passed along as it stands.
 */
function aiErrorStatus(e: Error & { status?: number }): { status: number; message: string } {
  if (!providerCredential()) return { status: 401, message: noKeyMessage() };
  return { status: e.status === 401 ? 401 : 500, message: e.message };
}

async function callOpus(
  system: string, user: string, maxTokens = 16000,
  onFallback?: (n: FallbackNotice) => void
): Promise<string> {
  return callOpusThread(system, [{ role: 'user', content: user }], maxTokens, onFallback);
}

/** The same call, for the places that carry a conversation rather than one turn. */
async function callOpusThread(
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens = 16000,
  onFallback?: (notice: FallbackNotice) => void
): Promise<string> {
  const provider = featureProvider('briefing');
  const model = featureModel('briefing');
  const key = providerCredential(provider);
  if (!key) throw Object.assign(new Error(noKeyMessage(provider)), { status: 401 });
  /*
   * Translated at the call rather than at each route. The briefing runs as a
   * background job whose failure is read back long afterwards, so a raw
   * response body would be what the page eventually showed.
   */
  return providerFor(provider)
    .complete({ key, model, system, messages, maxTokens, onFallback })
    .catch((err: unknown) => {
      throw Object.assign(new Error(describeError(provider, err)), {
        status: (err as { status?: number }).status,
      });
    });
}

// ── GM Briefing ─────────────────────────────────────────────────────────

const briefingPath = (orgId: number) => path.join(DATA_DIR, `briefing-${orgId}.json`);

function briefingContext(orgId: number) {
  const team = db
    .prepare(
      `SELECT name, nickname, league_id, sub_league_id, division_id FROM teams WHERE team_id = ?`
    )
    .get(orgId) as Record<string, unknown>;
  const standings = db
    .prepare(
      `SELECT t.name || ' ' || t.nickname AS team, r.w, r.l, r.pos, r.gb, r.streak
       FROM teams t JOIN team_record r ON r.team_id = t.team_id
       WHERE t.league_id = ? AND t.sub_league_id = ? AND t.division_id = ? AND t.level = 1 AND t.allstar_team = 0
       ORDER BY r.pos`
    )
    .all(team.league_id, team.sub_league_id, team.division_id);
  const prospects = computeProspects(orgId);
  let contracts: unknown = null;
  try {
    const c = computeContracts(orgId);
    contracts = (c.players as unknown[]).slice(0, 15);
  } catch { /* no contract data */ }
  const injuries = orgInjuries(orgId);
  return {
    organization: `${team.name} ${team.nickname}`,
    gameDate: currentGameDate(team.league_id as number),
    seasonYear: seasonYear(team.league_id as number),
    standings,
    /*
     * The farm as its own department describes it: what needs a decision, and Player Development's
     * promotion-direction recommendations. Not a "top prospects" slice — the prospect payload is
     * ordered by name, so the first five were the first five alphabetically.
     */
    farm: farmBriefing(orgId, prospects),
    contractSituations: contracts,
    /*
     * Who is genuinely for sale, which is most of what a deadline briefing is
     * for. Trimmed to the best of them: the whole list runs to a hundred and
     * fifty in a selling year, and the briefing is 500 words.
     */
    tradingBlock: tradingBlock({ limit: 12 }),
    injuries,
    finances: teamFinances(orgId),
    leagueRules: rulesBriefing(team.league_id as number, orgId),
    // The briefing is about what needs deciding, and most of that is timing
    keyDates: calendarBriefing(team.league_id as number),
  };
}

aiRoutes.get('/briefing/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  const job = jobStatus('briefing', orgId);
  try {
    res.json({ ...JSON.parse(fs.readFileSync(briefingPath(orgId), 'utf8')), job });
  } catch {
    res.json({ markdown: null, job });
  }
});

/** The generation itself, so both the route and the importer can start it. */
async function generateBriefing(orgId: number): Promise<void> {
  const context = briefingContext(orgId);
  // A model that had to be swapped is worth saying so on the page rather than
  // only in a log nobody opens
  let notice: FallbackNotice | null = null;
  const markdown = await callOpus(
    `You are the assistant GM of the ${context.organization} in a saved game of Out of the Park ` +
    `Baseball, writing the weekly briefing for the GM. Everything below is from that save — the ` +
    `standings, statistics and contracts are outcomes the simulation generated, and the names come ` +
    `from the game's database. LEAGUE RULES: ${context.leagueRules} Everything you advise must fit ` +
    `these rules rather than the modern game. Be direct and decision-oriented: what happened, what ` +
    `needs a decision now, what to watch. Ground everything in the provided data with real numbers. ` +
    `STRICT DATA RULES: Never infer a player's position, role, handedness, injury, contract demand, ` +
    `salary demand, or roster status from his name or from outside baseball knowledge. Use only fields ` +
    `explicitly present in the supplied data. If a fact is absent, omit it rather than guess. ` +
    `FARM: 'farm.attention' is what Minor League Operations says needs a decision (a prospect who cannot ` +
    `get the work, an affiliate that cannot field a team, a roster spot in question); 'farm.promotionDirection' ` +
    `lists players for whom Player Development finds a promotion ONE AFFILIATE LEVEL developmentally defensible — ` +
    `never a call-up. 'mlb_ready_discussion' is a discussion, not a call-up. Only a player currently at AAA may be ` +
    `described as an MLB call-up candidate, and do not say a minor-league promotion fills an MLB bench or bullpen ` +
    `need. Do not rank prospects or invent a top-prospect list. CONTRACTS: 'contractSituations' describe each contract ` +
    `(salary, term, what happens after this season, next season's cost, expected wins, contract value and value of keeping ` +
    `him as ranges with a most-likely figure); they carry no recommendation, so never present one as the app's advice, ` +
    `and say 'not known' where a figure is null. Do not invent extension years or dollar figures. ` +
    `Only MLB-level injuries directly create major-league roster holes; affiliate injuries affect organizational ` +
    `depth. Respect the game date: before Opening Day, 0-0 standings are not a development and expiring-after-season ` +
    `contracts generally are not immediate weekly decisions. Do not escape markdown punctuation with backslashes. ` +
    `Structure with short markdown headers (## Status, ## Decisions Needed, ## Watch List, ` +
    `## Recommendation of the Week). Keep it under 500 words. ${VALUE_PERCENTILE_NOTE}`,
    `Today is ${context.gameDate}, ${context.seasonYear} season. Organizational data:\n\n` +
      JSON.stringify(context, null, 1),
    16000,
    (n) => { notice = n; }
  );
  fs.writeFileSync(
    briefingPath(orgId),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), gameDate: context.gameDate, markdown, notice },
      null,
      2
    )
  );
}

/** Used by the importer when the club has asked for this to happen by itself. */
export function startBriefingJob(orgId: number): void {
  startJob('briefing', orgId, () => generateBriefing(orgId));
}

/**
 * Starts the briefing and returns at once. It takes long enough that holding
 * the request open meant the page had to be watched while it ran.
 */
aiRoutes.post('/briefing/:orgId', (req, res) => {
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const orgId = Number(req.params.orgId);
  const briefingProvider = featureProvider('briefing');
  if (!providerCredential(briefingProvider)) {
    return res.status(401).json({ error: noKeyMessage(briefingProvider) });
  }
  const { started, status } = startJob('briefing', orgId, () => generateBriefing(orgId));
  res.json({ started, job: status });
});

// ── AI trade evaluation ─────────────────────────────────────────────────

/**
 * The brief the trade desk answers under, in the voice of the club's own
 * general manager rather than an anonymous "AI". Shared by the first verdict
 * and every reply after it, so the follow-ups do not drift into a different
 * man with different standards halfway down the thread.
 */
export function tradeSystem(voice: Persona, orgLabel: string | undefined, leagueId?: number): string {
  const who =
    voice.name === 'the front office'
      ? `You are the front office of ${orgLabel ?? 'this club'}`
      : `You are ${voice.name}, ${voice.role} of ${orgLabel ?? 'this club'}`;
  return (
    `${who}, judging a proposed trade in a saved game of Out of the Park ` +
    `Baseball. Everything below comes from that save. You are talking to the person who runs ` +
    `this club with you, and you speak as yourself — first person, no preamble, no restating ` +
    `the question.\n\n` +
    (voice.facts.length > 0
      ? `This is who you are; let it colour the read without being recited:\n` +
        voice.facts.map((f) => `- ${f}`).join('\n') + '\n\n'
      : '') +
    // The desk is the one place the deadline is always the question
    (leagueId !== undefined ? calendarBriefing(leagueId) + '\n\n' : '') +
    `"weGive" leaves the organisation; "weReceive" joins it.\n\n` +
      `Judge the deal as a roster decision, not an exchange of ratings. In particular:\n` +
      `- Say what each man actually is — his position, his role if he pitches, and the level he is ` +
      `playing at. A reliever and a shortstop with the same value are not the same asset.\n` +
      `- Use the season line, and read it against the level it was produced at. OPS+ and ERA+ are ` +
      `scaled so 100 is average for that league, so they compare across levels; the raw rates do ` +
      `not. Say when a sample is too small to mean anything.\n` +
    // Player Value phase 6b (D-001, D-052): the desk explains Pennant's reading of the deal and never replaces it
    `- "value" is Pennant's reading of the deal, the same figures the page shows beside your answer: each side's contract ` +
    `value (what the players' contracts are worth to whoever holds them: their projected wins at what a win costs on this ` +
    `league's market, less what they cost, later seasons counting a little less), in "unit", and "difference": what comes in ` +
    `less what goes out, a most likely figure (or a range of them where an option, a status or whether a man stays is open) ` +
    `with the range it could be and each player's part. Each man's own "value" gives his contract value and the value of ` +
    `keeping him (what his club would give up by letting him go; money owed either way does not count). Quote these as ` +
    `ranges, say what drives the difference, and say plainly when a man is left out because his value is not known. You never ` +
    `produce a value number of your own: no dollar figure, rating or score for a player or the deal that is not in the data. ` +
    `"ourView", where present, is the same reading through this club's philosophy, with each lean named.\n` +
    `- "expectedWins" is each man's projected wins above replacement for the rest of this season (or the whole of it) and ` +
    `next season, with the likely range. "clubValueOfAWin" is context from the standings (how much one more win moves a club's ` +
    `playoff odds), never part of any value figure.\n` +
    `- "onTheBlock" names the men in this deal whose own club has listed them for trade. A club ` +
    `that has listed a player wants to move him and the price starts lower; a club that has not ` +
    `is being asked for a favour and will charge for it. Say which of these you are dealing with.\n` +
    `- Judge the glove as well as the bat. "fielding" gives his rating at each position he can ` +
    `play, on the 20-80 scale, with his ceiling where he has one — "60 at 2B, 35 at SS ` +
    `(ceiling 55)" means he is a good second baseman who is not a shortstop yet and may never ` +
    `be. "fieldingStats" is what he has actually done out there, this season and last: games, ` +
    `errors, fielding percentage and zone rating. Say what a move down the defensive spectrum ` +
    `costs, and never claim a man can play a position his ratings do not support. Only the ` +
    `positions the game has actually rated him at appear — a position missing from the list is ` +
    `one nobody has graded yet, not one he is known to be incapable of, so treat it as unknown ` +
    `and say so if it matters.\n` +
      `- Name who the incoming player would displace. "whoTheyWouldDisplace" lists the men already ` +
      `holding that job on the major-league roster, with their own lines. If he is not better than ` +
      `the man in the job, say so — an upgrade that does not upgrade anything is not one. If he is ` +
      `not major-league ready, say where he actually slots and when he might matter.\n` +
      `- Weigh it against what the club is short of. "clubNeeds" gives the weakest positions and ` +
      `the spare ones: value bought where you are already deep is worth less than the number says.\n` +
      `- Then the ordinary things: age, contract years, salary, and what the money commits you to.\n` +
    `- A season line covers every club a man played for that year. Where somebody changed hands ` +
    `mid-season, say what he has done since the move as well as across the year — a hot six weeks ` +
    `in a new park is a different fact from a full season, and the reader wants both.\n` +
    `- A contract ending is not a player leaving. Each man carries a "control" field: "text" is his control season by ` +
    `season ("Signed 2026 · arbitration 2027–2028 · free agent from 2029"), and "path" gives each controlled season with what ` +
    `it costs (a contract's salary, or a projected arbitration or pre-arbitration cost as a range). "arbitration" means he is ` +
    `kept and paid more, "pre-arb" kept cheaply, "reserve clause" cannot leave; a season named as two statuses ("arbitration ` +
    `or free agency") is one the save cannot yet settle — say so, never pick one. An option or opt-out season has two ` +
    `branches: give both and never call him signed for that season. ` +
    `Never call somebody a rental or a walk-year player ` +
    `from years-remaining alone — arbitration years are years of control, and they are worth ` +
    `paying for.\n` +
      `- "salaryThisSeason" is the salary each side carries this season, with the men whose salary the export does ` +
    `not state named.\n` +
    `- A read that only restates "value" is not worth writing: say what the figures mean for this club's roster.\n\n` +
    `Never invent a number that is not in the data you are given. The decision is the GM's: you explain the deal, the ` +
    `figures and the roster; you do not accept or reject it for him.`
  );
}

/**
 * The opening read's shape. Replies are conversation and are left alone. No accept-or-reject line: the application
 * decides nothing here and neither does the desk (D-001, D-004); it explains what the deal does (phase 6b).
 */
export const TRADE_ANSWER_FORMAT =
  '\n\nAnswer in short markdown: a one-line **Read** that says what the deal does for this club in plain words ' +
  '(no accept or reject: the decision is the GM\'s), then 4-6 sentences that name players and cite figures from the ' +
  'data (the difference as its range), then what would change the picture, if anything. Under 220 words.';

/**
 * The trade desk, with the run of the organisation.
 *
 * It used to be handed the two sides of the deal and nothing else, which held
 * up until the conversation moved past the deal itself. Asked who could cover
 * shortstop from the farm, it answered that it had nothing in front of it
 * beyond the players already named — true, and useless, and it said what it
 * needed: the actual system list. It now has the same tools the staff chat
 * does and can go and read the roster, the farm and anybody in the league.
 */
async function askTheDesk(
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onFallback: (n: FallbackNotice) => void
): Promise<string> {
  const provider = featureProvider('trade');
  const model = featureModel('trade');
  const key = providerCredential(provider);
  if (!key) throw Object.assign(new Error(noKeyMessage(provider)), { status: 401 });
  try {
    const { answer } = await toolLoop(provider)({
      key,
      model,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: TOOLS,
      onText: () => {},
      onTool: (name) => console.log('[trade] looked up', name),
      runTool: (name, input) => runTool(name, input),
      onFallback,
      /*
       * Enough to sweep the farm. Asked who could cover shortstop, it reads
       * the roster of each affiliate in turn — six lookups before it has seen
       * the whole system — and a cap that cuts it off mid-sweep produces a
       * confident answer drawn from half the organisation.
       */
      maxTurns: 12,
    });
    return answer;
  } catch (err) {
    throw Object.assign(new Error(describeError(provider, err)), {
      status: (err as { status?: number }).status,
    });
  }
}

interface TradeBody {
  orgId?: number;
  sideA?: number[];
  sideB?: number[];
  orgLabel?: string;
  message?: string;
  thread?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Both routes want the same validation and the same context assembly. */
function tradeSetup(body: TradeBody): { orgId: number; voice: Persona; context: unknown; leagueId?: number } {
  const { sideA, sideB } = body;
  if (!Array.isArray(sideA) || !Array.isArray(sideB) || sideA.length === 0 || sideB.length === 0) {
    throw Object.assign(new Error('Both sides need at least one player'), { status: 400 });
  }
  const orgId = Number(body.orgId) || 0;
  const league = (db.prepare(`SELECT league_id FROM teams WHERE team_id = ?`).get(orgId) as
    | { league_id: number }
    | undefined)?.league_id;
  return {
    orgId,
    voice: tradeVoice(orgId),
    context: tradeContext(orgId, sideA, sideB),
    leagueId: league,
  };
}

/** Who will answer, so the page can put a name on the button before asking. */
aiRoutes.get('/trade/voice/:orgId', (req, res) => {
  const { name, role } = tradeVoice(Number(req.params.orgId));
  res.json({ name, role });
});

aiRoutes.post('/trade/ai-eval', async (req, res) => {
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const body = req.body as TradeBody;
  try {
    const { voice, context, leagueId } = tradeSetup(body);
    let notice: FallbackNotice | null = null;
    const verdict = await askTheDesk(
      tradeSystem(voice, body.orgLabel, leagueId) + TRADE_ANSWER_FORMAT,
      [{ role: 'user', content: JSON.stringify(context, null, 1) }],
      (n) => { notice = n; }
    );
    res.json({ verdict, voice: { name: voice.name, role: voice.role }, notice });
  } catch (err) {
    const { status, message } = aiErrorStatus(err as Error);
    if (status === 500) console.error('[trade-eval] failed:', err);
    res.status(status).json({ error: message });
  }
});

/**
 * Answering back.
 *
 * A verdict you cannot argue with is a worse tool than one you can — half the
 * value of asking is "what if I keep Caballero out of it". The thread is held
 * by the page rather than on disk: it belongs to the two lists of players
 * currently on screen, and both change with every click.
 */
aiRoutes.post('/trade/ai-reply', async (req, res) => {
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const body = req.body as TradeBody;
  if (!body.message?.trim()) return res.status(400).json({ error: 'Nothing to send' });
  try {
    const { voice, context, leagueId } = tradeSetup(body);
    let notice: FallbackNotice | null = null;
    const history = (body.thread ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
      // Enough to keep the argument coherent without resending an hour of it
      .slice(-12);
    const reply = await askTheDesk(
      tradeSystem(voice, body.orgLabel, leagueId) +
        '\n\nYou have already given your read of this deal and are now being asked about it. ' +
        'Answer the question actually put to you, in a few sentences — no headings, and do not ' +
        'restate the read unless it has changed. If it has changed, say so plainly.\n\n' +
        'The question may move past the deal — who else could fill the hole, who is close in the ' +
        'system, what the roster looks like without these men. Use your tools and go and read it ' +
        'rather than saying you have not got the data: the roster, the farm and every player in ' +
        'the league are yours to look up.',
      [
        { role: 'user', content: `The deal on the table:\n${JSON.stringify(context, null, 1)}` },
        ...history,
        { role: 'user', content: body.message.trim() },
      ],
      (n) => { notice = n; }
    );
    res.json({ reply, voice: { name: voice.name, role: voice.role }, notice });
  } catch (err) {
    const { status, message } = aiErrorStatus(err as Error);
    if (status === 500) console.error('[trade-reply] failed:', err);
    res.status(status).json({ error: message });
  }
});
